import { normalizeSymbol, formatPrice } from './symbolUtils';

type Unsubscribe = () => void;

interface PriceRegEntry {
    element: HTMLElement;
    decimals: number;
    prefix: string;
    suffix: string;
    flashColor: boolean;
    prevPrice?: number;
    flashTimer?: any;
}

interface PnlRegEntry {
    element: HTMLElement;
    entryPrice: number;
    amount: number;
    side: 'LONG' | 'SHORT';
    isPct: boolean;
}

class PriceRegistry {
    private prices: Record<string, number> = {};
    private cachedPricesCopy: Record<string, number> | null = null;
    private listeners: Set<(prices: Record<string, number>) => void> = new Set();
    
    // symbol -> Set of element registrations
    private priceElements = new Map<string, Set<PriceRegEntry>>();
    
    // symbol -> Set of PnL calculation registrations
    private pnlElements = new Map<string, Set<PnlRegEntry>>();

    // 🛡️ [HIGH-FREQUENCY ANTI-EXPLOSION REINFORCEMENT]
    // 1. Pending DOM update buffers for requestAnimationFrame consolidation (0 layout thrashing)
    private pendingDomUpdates: Record<string, { price: number; prevPrice?: number }> = {};
    private isRafScheduled = false;

    // 2. Throttled listener notification (max 10Hz) to prevent event-loop choking
    private lastListenerNotification = 0;
    private listenerTimer: any = null;

    constructor() {
        if (typeof window !== 'undefined') {
            setInterval(() => this.sweepZombieElements(), 5000);
            if (typeof document !== 'undefined') {
                document.addEventListener('visibilitychange', () => {
                    if (!document.hidden) {
                        this.refreshAllDomElements();
                    }
                });
            }
        }
    }

    public registerListener(callback: (prices: Record<string, number>) => void): Unsubscribe {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    public getAllPrices(): Record<string, number> {
        if (!this.cachedPricesCopy) {
            this.cachedPricesCopy = { ...this.prices };
        }
        return this.cachedPricesCopy;
    }
    
    public updatePrices(newPrices: Record<string, number>) {
        let hasChanges = false;
        
        for (const rawSymbol in newPrices) {
            const price = newPrices[rawSymbol];
            if (price === undefined || isNaN(price) || price <= 0) continue;

            const symbol = normalizeSymbol(rawSymbol);
            const prevPrice = this.prices[symbol];
            if (prevPrice !== price) {
                this.prices[symbol] = price;
                hasChanges = true;
                this.pendingDomUpdates[symbol] = { price, prevPrice };
            }
        }

        if (hasChanges) {
            this.cachedPricesCopy = null;
            // 1. Batch direct DOM updates using requestAnimationFrame (syncs with 60fps monitor vsync)
            if (!this.isRafScheduled) {
                this.isRafScheduled = true;
                const scheduleFrame = typeof requestAnimationFrame !== 'undefined' 
                    ? requestAnimationFrame 
                    : (cb: () => void) => setTimeout(cb, 16);
                scheduleFrame(() => this.flushDomUpdates());
            }

            // 2. Throttle subscriber notifications to max 10Hz (every 100ms) to prevent freezing the main thread
            const now = Date.now();
            if (now - this.lastListenerNotification >= 100) {
                this.lastListenerNotification = now;
                if (this.listenerTimer) {
                    clearTimeout(this.listenerTimer);
                    this.listenerTimer = null;
                }
                this.listeners.forEach(fn => {
                    try { fn(this.prices); } catch (_) {}
                });
            } else if (!this.listenerTimer) {
                this.listenerTimer = setTimeout(() => {
                    this.listenerTimer = null;
                    this.lastListenerNotification = Date.now();
                    this.listeners.forEach(fn => {
                        try { fn(this.prices); } catch (_) {}
                    });
                }, 100);
            }
        }
    }

    private flushDomUpdates() {
        this.isRafScheduled = false;

        // 🛡️ [ANTI-EXPLOSION SHIELD]: If tab is in background, drop DOM writes to prevent browser tab throttling/freeze
        if (typeof document !== 'undefined' && document.hidden) {
            this.pendingDomUpdates = {};
            return;
        }

        const updates = this.pendingDomUpdates;
        this.pendingDomUpdates = {};

        for (const symbol in updates) {
            const { price, prevPrice } = updates[symbol];

            // Define aliases for broadcasting (e.g., PEPE <-> 1000PEPE)
            const aliases: { sym: string; price: number }[] = [{ sym: symbol, price }];
            if (symbol.startsWith('1000')) {
                aliases.push({ sym: symbol.replace(/^1000/, ''), price: price / 1000 });
            } else {
                aliases.push({ sym: '1000' + symbol, price: price * 1000 });
            }

            for (const alias of aliases) {
                const targetSym = alias.sym;
                const targetPrice = alias.price;

                // 1. Direct DOM pricing updates (Zero Reflow using textContent)
                const prEntries = this.priceElements.get(targetSym);
                if (prEntries) {
                    prEntries.forEach(entry => {
                        try {
                            if (!entry.element || !entry.element.isConnected) {
                                if (entry.flashTimer) {
                                    clearTimeout(entry.flashTimer);
                                    entry.flashTimer = null;
                                }
                                prEntries.delete(entry);
                                return;
                            }
                            const text = `${entry.prefix}${formatPrice(targetPrice)}${entry.suffix}`;
                            if (entry.element.textContent !== text) {
                                entry.element.textContent = text;
                                
                                if (entry.flashColor && prevPrice !== undefined) {
                                    if (price > prevPrice) {
                                        if (!entry.element.classList.contains('text-emerald-400')) {
                                            entry.element.classList.add('text-emerald-400');
                                            entry.element.classList.remove('text-red-400');
                                        }
                                    } else if (price < prevPrice) {
                                        if (!entry.element.classList.contains('text-red-400')) {
                                            entry.element.classList.add('text-red-400');
                                            entry.element.classList.remove('text-emerald-400');
                                        }
                                    }
                                }
                            }
                        } catch (err) {
                            // Ignore silent errors for unmounted or stale components
                        }
                    });
                    if (prEntries.size === 0) {
                        this.priceElements.delete(targetSym);
                    }
                }

                // 2. Direct DOM Position PnL calculation and updates (Zero Reflow with textContent)
                const pnlEntries = this.pnlElements.get(targetSym);
                if (pnlEntries) {
                    pnlEntries.forEach(entry => {
                        try {
                            if (!entry.element || !entry.element.isConnected) {
                                pnlEntries.delete(entry);
                                return;
                            }
                            const isLong = entry.side === 'LONG';
                            
                            // Detect and fix 1000x scale mismatch between entryPrice and targetPrice
                            let calcPrice = targetPrice;
                            if (entry.entryPrice > 0 && targetPrice > 0) {
                                const ratio = targetPrice / entry.entryPrice;
                                if (ratio > 500) calcPrice = targetPrice / 1000;
                                else if (ratio < 0.002) calcPrice = targetPrice * 1000;
                            }

                            const diff = isLong ? calcPrice - entry.entryPrice : entry.entryPrice - calcPrice;
                            
                            if (entry.isPct) {
                                let pnlPct = 0;
                                if (entry.entryPrice > 0) {
                                    pnlPct = (diff / entry.entryPrice) * 100;
                                }
                                if (!isFinite(pnlPct)) pnlPct = 0;
                                
                                const text = `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`;
                                if (entry.element.textContent !== text) {
                                    entry.element.textContent = text;
                                    if (pnlPct >= 0) {
                                        if (!entry.element.classList.contains('text-emerald-500')) {
                                            entry.element.classList.remove('text-red-500', 'text-red-400');
                                            entry.element.classList.add('text-emerald-500');
                                        }
                                    } else {
                                        if (!entry.element.classList.contains('text-red-500')) {
                                            entry.element.classList.remove('text-emerald-500', 'text-emerald-400');
                                            entry.element.classList.add('text-red-500');
                                        }
                                    }
                                }
                            } else {
                                const pnlVal = diff * entry.amount;
                                const text = `${pnlVal >= 0 ? '+' : ''}${pnlVal.toFixed(2)}`;
                                if (entry.element.textContent !== text) {
                                    entry.element.textContent = text;
                                    if (pnlVal >= 0) {
                                        if (!entry.element.classList.contains('text-emerald-400')) {
                                            entry.element.classList.remove('text-red-400', 'text-red-500');
                                            entry.element.classList.add('text-emerald-400', 'font-bold');
                                        }
                                    } else {
                                        if (!entry.element.classList.contains('text-red-400')) {
                                            entry.element.classList.remove('text-emerald-400', 'text-emerald-500');
                                            entry.element.classList.add('text-red-400', 'font-bold');
                                        }
                                    }
                                }
                            }
                        } catch (err) {
                            // Ignore silent errors for unmounted or stale components
                        }
                    });
                    if (pnlEntries.size === 0) {
                        this.pnlElements.delete(targetSym);
                    }
                }
            }
        }
    }

    public forceUpdatePrice(symbol: string, price: number) {
        const cleanSymbol = normalizeSymbol(symbol);
        this.updatePrices({ [cleanSymbol]: price });
    }

    public getPrice(symbol: string): number | undefined {
        const cleanSymbol = normalizeSymbol(symbol);
        if (this.prices[cleanSymbol] !== undefined) return this.prices[cleanSymbol];
        
        // Try simple scaling aliases
        if (cleanSymbol.startsWith('1000')) {
            const base = cleanSymbol.replace(/^1000/, '');
            if (this.prices[base] !== undefined) return this.prices[base] * 1000;
        } else {
            const scaled = '1000' + cleanSymbol;
            if (this.prices[scaled] !== undefined) return this.prices[scaled] / 1000;
        }
        
        return undefined;
    }

    public registerPriceElement(
        symbol: string,
        element: HTMLElement,
        options: { decimals?: number; prefix?: string; suffix?: string; flashColor?: boolean } = {}
    ): Unsubscribe {
        const cleanSymbol = normalizeSymbol(symbol);
        if (!this.priceElements.has(cleanSymbol)) {
            this.priceElements.set(cleanSymbol, new Set());
        }

        const entry: PriceRegEntry = {
            element,
            decimals: options.decimals ?? 4,
            prefix: options.prefix ?? '',
            suffix: options.suffix ?? '',
            flashColor: !!options.flashColor,
            prevPrice: this.getPrice(cleanSymbol)
        };

        this.priceElements.get(cleanSymbol)!.add(entry);

        // Render initial price if available in cache (Zero Reflow with textContent)
        const lastVal = this.getPrice(cleanSymbol);
        if (lastVal !== undefined && !isNaN(lastVal)) {
            element.textContent = `${entry.prefix}${formatPrice(lastVal)}${entry.suffix}`;
        }

        return () => {
            const set = this.priceElements.get(cleanSymbol);
            if (set) {
                set.delete(entry);
                if (set.size === 0) {
                    this.priceElements.delete(cleanSymbol);
                }
            }
        };
    }

    public registerPnlElement(
        symbol: string,
        element: HTMLElement,
        options: { entryPrice: number; amount: number; side: 'LONG' | 'SHORT'; isPct: boolean }
    ): Unsubscribe {
        const cleanSymbol = normalizeSymbol(symbol);
        if (!this.pnlElements.has(cleanSymbol)) {
            this.pnlElements.set(cleanSymbol, new Set());
        }

        const entry: PnlRegEntry = {
            element,
            entryPrice: options.entryPrice,
            amount: options.amount,
            side: options.side,
            isPct: options.isPct
        };

        this.pnlElements.get(cleanSymbol)!.add(entry);

        // Render initial PnL if available (Zero Reflow with textContent)
        const lastPrice = this.getPrice(cleanSymbol);
        if (lastPrice !== undefined && !isNaN(lastPrice)) {
            const isLong = entry.side === 'LONG';
            
            // Detect and fix 1000x scale mismatch
            let calcPrice = lastPrice;
            if (entry.entryPrice > 0 && lastPrice > 0) {
                const ratio = lastPrice / entry.entryPrice;
                if (ratio > 500) calcPrice = lastPrice / 1000;
                else if (ratio < 0.002) calcPrice = lastPrice * 1000;
            }

            const diff = isLong ? calcPrice - entry.entryPrice : entry.entryPrice - calcPrice;
            
            if (entry.isPct) {
                const pnlPct = entry.entryPrice > 0 ? (diff / entry.entryPrice) * 100 : 0;
                element.textContent = `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`;
                if (pnlPct >= 0) {
                    element.classList.remove('text-red-500', 'text-red-400');
                    element.classList.add('text-emerald-500');
                } else {
                    element.classList.remove('text-emerald-500', 'text-emerald-400');
                    element.classList.add('text-red-500');
                }
            } else {
                const pnlVal = diff * entry.amount;
                element.textContent = `${pnlVal >= 0 ? '+' : ''}${pnlVal.toFixed(2)}`;
                if (pnlVal >= 0) {
                    element.classList.remove('text-red-400', 'text-red-500');
                    element.classList.add('text-emerald-400', 'font-bold');
                } else {
                    element.classList.remove('text-emerald-400', 'text-emerald-500');
                    element.classList.add('text-red-400', 'font-bold');
                }
            }
        }

        return () => {
            const set = this.pnlElements.get(cleanSymbol);
            if (set) {
                set.delete(entry);
                if (set.size === 0) {
                    this.pnlElements.delete(cleanSymbol);
                }
            }
        };
    }

    // --- FULL MARKET TICKER BROADCAST (For List 1 Zero-Latency Streaming) ---
    private rawTickers: any[] = [];
    private rawTickerMap = new Map<string, any>();
    private tickerListeners: Set<(tickers: any[]) => void> = new Set();

    public updateMarketTickers(tickers: any[]) {
        if (!Array.isArray(tickers) || tickers.length === 0) return;
        tickers.forEach(t => {
            if (t && t.symbol) {
                const norm = normalizeSymbol(t.symbol);
                if (!norm) return;
                const existing = this.rawTickerMap.get(norm);
                if (existing) {
                    const newQuoteVol = parseFloat(t.quoteVolume || t.quoteAssetVolume || '0');
                    const existingQuoteVol = parseFloat(existing.quoteVolume || existing.quoteAssetVolume || '0');
                    if (newQuoteVol <= 0 && existingQuoteVol > 0) {
                        t.quoteVolume = existing.quoteVolume;
                    }
                    const newChange = parseFloat(t.priceChangePercent || '0');
                    const existingChange = parseFloat(existing.priceChangePercent || '0');
                    if (newChange === 0 && existingChange !== 0) {
                        t.priceChangePercent = existing.priceChangePercent;
                    }
                }
                this.rawTickerMap.set(norm, t);
            }
        });
        const fullList = Array.from(this.rawTickerMap.values());
        this.rawTickers = fullList;
        this.tickerListeners.forEach(cb => {
            try {
                cb(fullList);
            } catch (_) {}
        });
    }

    public getMarketTickers(): any[] {
        return this.rawTickers;
    }

    public registerTickerListener(callback: (tickers: any[]) => void): Unsubscribe {
        this.tickerListeners.add(callback);
        if (this.rawTickers.length > 0) {
            try { callback(this.rawTickers); } catch (_) {}
        }
        return () => this.tickerListeners.delete(callback);
    }

    /**
     * 🛡️ Refreshes all currently connected DOM elements when tab regains focus or visibility
     */
    public refreshAllDomElements() {
        if (typeof document !== 'undefined' && document.hidden) return;
        this.priceElements.forEach((entries, sym) => {
            const price = this.getPrice(sym);
            if (price === undefined || isNaN(price)) return;
            entries.forEach(entry => {
                try {
                    if (entry.element && entry.element.isConnected) {
                        entry.element.textContent = `${entry.prefix}${formatPrice(price)}${entry.suffix}`;
                    }
                } catch (_) {}
            });
        });
    }

    /**
     * 🛡️ Periodically purges unmounted elements and stale timers to prevent memory leaks
     */
    public sweepZombieElements(): { cleanedPrice: number; cleanedPnl: number } {
        let cleanedPrice = 0;
        let cleanedPnl = 0;

        this.priceElements.forEach((entries, sym) => {
            entries.forEach(entry => {
                if (!entry.element || !entry.element.isConnected) {
                    if (entry.flashTimer) {
                        clearTimeout(entry.flashTimer);
                        entry.flashTimer = null;
                    }
                    entries.delete(entry);
                    cleanedPrice++;
                }
            });
            if (entries.size === 0) {
                this.priceElements.delete(sym);
            }
        });

        this.pnlElements.forEach((entries, sym) => {
            entries.forEach(entry => {
                if (!entry.element || !entry.element.isConnected) {
                    entries.delete(entry);
                    cleanedPnl++;
                }
            });
            if (entries.size === 0) {
                this.pnlElements.delete(sym);
            }
        });

        return { cleanedPrice, cleanedPnl };
    }

    public getRegistryStats(): { totalPriceRegistered: number; totalPnlRegistered: number } {
        let totalPriceRegistered = 0;
        let totalPnlRegistered = 0;
        this.priceElements.forEach(set => { totalPriceRegistered += set.size; });
        this.pnlElements.forEach(set => { totalPnlRegistered += set.size; });
        return { totalPriceRegistered, totalPnlRegistered };
    }
}

export const priceRegistry = new PriceRegistry();
