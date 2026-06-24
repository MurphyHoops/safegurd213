import { normalizeSymbol, formatPrice } from './symbolUtils';

type Unsubscribe = () => void;

interface PriceRegEntry {
    element: HTMLElement;
    decimals: number;
    prefix: string;
    suffix: string;
    flashColor: boolean;
    prevPrice?: number;
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
    private listeners: Set<(prices: Record<string, number>) => void> = new Set();
    
    // symbol -> Set of element registrations
    private priceElements = new Map<string, Set<PriceRegEntry>>();
    
    // symbol -> Set of PnL calculation registrations
    private pnlElements = new Map<string, Set<PnlRegEntry>>();

    public registerListener(callback: (prices: Record<string, number>) => void): Unsubscribe {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
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

                // Define aliases for broadcasting (e.g., PEPE <-> 1000PEPE)
                const aliases: { sym: string; price: number }[] = [{ sym: symbol, price }];
                if (symbol.startsWith('1000')) {
                    aliases.push({ sym: symbol.replace(/^1000/, ''), price: price / 1000 });
                } else {
                    aliases.push({ sym: '1000' + symbol, price: price * 1000 });
                }

                // Update all affected elements (self + aliases)
                for (const alias of aliases) {
                    const targetSym = alias.sym;
                    const targetPrice = alias.price;

                    // 1. Direct DOM pricing updates
                    const prEntries = this.priceElements.get(targetSym);
                    if (prEntries) {
                        prEntries.forEach(entry => {
                            const text = `${entry.prefix}${formatPrice(targetPrice)}${entry.suffix}`;
                            if (entry.element.innerText !== text) {
                                entry.element.innerText = text;
                                
                                if (entry.flashColor && prevPrice !== undefined) {
                                    // Note: Flash uses the original price direction for simplicity
                                    if (price > prevPrice) {
                                        entry.element.classList.add('text-emerald-400');
                                        entry.element.classList.remove('text-red-400');
                                        setTimeout(() => entry.element.classList.remove('text-emerald-400'), 180);
                                    } else if (price < prevPrice) {
                                        entry.element.classList.add('text-red-400');
                                        entry.element.classList.remove('text-emerald-400');
                                        setTimeout(() => entry.element.classList.remove('text-red-400'), 180);
                                    }
                                }
                            }
                        });
                    }

                    // 2. Direct DOM Position PnL calculation and updates
                    const pnlEntries = this.pnlElements.get(targetSym);
                    if (pnlEntries) {
                        pnlEntries.forEach(entry => {
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
                                if (entry.element.innerText !== text) {
                                    entry.element.innerText = text;
                                    if (pnlPct >= 0) {
                                        entry.element.className = entry.element.className
                                            .replace(/\btext-red-\d+\b/g, '')
                                            .replace(/\btext-emerald-\d+\b/g, '') + ' text-emerald-500';
                                    } else {
                                        entry.element.className = entry.element.className
                                            .replace(/\btext-emerald-\d+\b/g, '')
                                            .replace(/\btext-red-\d+\b/g, '') + ' text-red-500';
                                    }
                                }
                            } else {
                                const pnlVal = diff * entry.amount;
                                const text = `${pnlVal >= 0 ? '+' : ''}${pnlVal.toFixed(2)}`;
                                if (entry.element.innerText !== text) {
                                    entry.element.innerText = text;
                                    if (pnlVal >= 0) {
                                        entry.element.className = entry.element.className
                                            .replace(/\btext-red-\d+\b/g, '')
                                            .replace(/\btext-emerald-\d+\b/g, '') + ' text-emerald-400 font-bold';
                                    } else {
                                        entry.element.className = entry.element.className
                                            .replace(/\btext-emerald-\d+\b/g, '')
                                            .replace(/\btext-red-\d+\b/g, '') + ' text-red-400 font-bold';
                                    }
                                }
                            }
                        });
                    }
                }
            }
        }

        if (hasChanges) {
            this.listeners.forEach(fn => fn(this.prices));
        }
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

        // Render initial price if available in cache
        const lastVal = this.getPrice(cleanSymbol);
        if (lastVal !== undefined && !isNaN(lastVal)) {
            element.innerText = `${entry.prefix}${formatPrice(lastVal)}${entry.suffix}`;
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

        // Render initial PnL if available
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
                element.innerText = `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`;
                if (pnlPct >= 0) {
                    element.className = element.className
                        .replace(/\btext-red-\d+\b/g, '')
                        .replace(/\btext-emerald-\d+\b/g, '') + ' text-emerald-500';
                } else {
                    element.className = element.className
                        .replace(/\btext-emerald-\d+\b/g, '')
                        .replace(/\btext-red-\d+\b/g, '') + ' text-red-500';
                }
            } else {
                const pnlVal = diff * entry.amount;
                element.innerText = `${pnlVal >= 0 ? '+' : ''}${pnlVal.toFixed(2)}`;
                if (pnlVal >= 0) {
                    element.className = element.className
                        .replace(/\btext-red-\d+\b/g, '')
                        .replace(/\btext-emerald-\d+\b/g, '') + ' text-emerald-400 font-bold';
                } else {
                    element.className = element.className
                        .replace(/\btext-emerald-\d+\b/g, '')
                        .replace(/\btext-red-\d+\b/g, '') + ' text-red-400 font-bold';
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
}

export const priceRegistry = new PriceRegistry();
