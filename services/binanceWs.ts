import { audioService } from './audioService';
import { normalizeSymbol } from './symbolUtils';
import { fetchWithFallback } from './apiService';
import { priceRegistry } from './priceRegistry';
import { recordBreadcrumb } from './monitor/monitorService';
import { klineDailyStore } from './klineDailyStore';

type PriceCallback = (prices: Record<string, number>) => void;
type StatusCallback = (status: { isConnected: boolean, lastMessageTime: number }) => void;

function cleanSymbol(s: string): string {
    if (!s) return '';
    let clean = s.toUpperCase().trim();
    clean = clean.replace(/_PREP$/, '');
    clean = clean.replace(/USDT$/, '');
    clean = clean.replace(/[^A-Z0-9\u4e00-\u9fa5]/g, '');
    return clean;
}

export class BinanceWebSocket {
    private ws: WebSocket | null = null;
    private callbacks: Set<PriceCallback> = new Set();
    private statusCallbacks: Set<StatusCallback> = new Set();
    private isIntentionalClose = false;
    private urls = [
        'wss://fstream.binance.com/ws/!ticker@arr',
        'wss://fstream.binance.com/ws/!miniTicker@arr',
        'wss://stream.binance.com:443/ws/!miniTicker@arr'
    ];
    private currentUrlIndex = 0;
    public lastMessageTime = Date.now();
    private isConnected = false;
    private consecutiveFailures = 0;
    private reconnectTimer: any = null;
    private reconnectLock = false;
    private fallbackTimer: any = null;
    private statusCheckTimer: any = null;
    private lastRestFetchTime = 0;
    private lastTickersEmitTime = 0;

    // 🛡️ [HIGH-FREQUENCY RAF UPDATE BUFFER POOL]
    private pendingPriceBuffer: Record<string, number> = {};
    private isFlushScheduled = false;
    private lastBreadcrumbTime = 0;

    private getLocalWsUrl(): string | null {
        if (typeof window === 'undefined') return null;
        try {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            return `${protocol}//${window.location.host}/api/ws-prices`;
        } catch (e) {
            return null;
        }
    }

    constructor() {
        const localUrl = this.getLocalWsUrl();
        if (localUrl) {
            this.urls = [localUrl, ...this.urls];
        }

        this.connect();
        this.setupEventListeners();
        this.startFallbackPoller();

        // Broadcast real-time network health every 1 second
        this.statusCheckTimer = setInterval(() => {
            this.notifyStatus();
        }, 1000);

        // 🛡️ [CLOUD RUN & PROXY KEEPALIVE]: Ping local server every 20s to keep both WS & HTTP containers alive
        setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                try {
                    this.ws.send(JSON.stringify({ type: 'PING' }));
                } catch (_) {}
            }
            // Keep Cloud Run container warm via lightweight HTTP health probe
            if (typeof window !== 'undefined') {
                try {
                    fetch('/api/health', { cache: 'no-store' }).then(() => {
                        // If socket got disconnected, revive it once health is verified
                        if (!this.isConnected && (!this.ws || this.ws.readyState === WebSocket.CLOSED)) {
                            this.currentUrlIndex = 0;
                            this.connect();
                        }
                    }).catch(() => {});
                } catch (_) {}
            }
        }, 20000);
    }

    private rotateUrl() {
        // If localUrl exists (index 0), prioritize it; only try others transiently
        this.currentUrlIndex = (this.currentUrlIndex + 1) % this.urls.length;
    }

    private connect() {
        if (typeof window === 'undefined') return;
        if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
            return;
        }

        // Clean up old socket cleanly
        if (this.ws) {
            try {
                this.ws.onopen = null;
                this.ws.onmessage = null;
                this.ws.onerror = null;
                this.ws.onclose = null;
                this.ws.close();
            } catch (_) {}
            this.ws = null;
        }

        const currentUrl = this.urls[this.currentUrlIndex];
        try {
            const ws = new WebSocket(currentUrl);
            this.ws = ws;

            ws.onopen = () => {
                if (this.ws !== ws) return;
                this.isConnected = true;
                this.consecutiveFailures = 0;
                this.lastMessageTime = Date.now();
                this.notifyStatus();
            };

            ws.onmessage = (event) => {
                if (this.ws !== ws) return;
                this.lastMessageTime = Date.now();
                if (!this.isConnected) {
                    this.isConnected = true;
                    this.notifyStatus();
                }

                try {
                    const json = JSON.parse(event.data);
                    if (json && (json.type === 'HEARTBEAT' || json.type === 'PONG')) {
                        return;
                    }
                    const data = json.data || json;
                    const newPrices: Record<string, number> = {};
                    const rawTickers: any[] = [];
                    const now = Date.now();
                    const shouldEmitTickers = (now - this.lastTickersEmitTime > 2500);

                    const processItem = (item: any) => {
                        if (!item) return;
                        const rawSymbol = item.s || item.symbol;
                        const symbol = cleanSymbol(rawSymbol);
                        if (!symbol) return;

                        let priceVal: number | null = null;
                        if (item.b !== undefined && item.a !== undefined) {
                            const bid = parseFloat(item.b);
                            const ask = parseFloat(item.a);
                            if (!isNaN(bid) && !isNaN(ask)) {
                                priceVal = (bid + ask) / 2;
                            }
                        } else {
                            const rawPrice = item.c || item.price || item.lastPrice || item.p;
                            priceVal = parseFloat(rawPrice);
                        }

                        if (priceVal !== null && !isNaN(priceVal) && priceVal > 0) {
                            newPrices[symbol] = priceVal;
                        }

                        const rawQuoteVol = item.q || item.quoteVolume;
                        const hasVolumeData = rawQuoteVol !== undefined && parseFloat(rawQuoteVol) > 0;
                        if (shouldEmitTickers && rawSymbol && rawSymbol.endsWith('USDT') && (item.c || item.lastPrice) && hasVolumeData) {
                            rawTickers.push({
                                symbol: rawSymbol,
                                lastPrice: item.c || item.lastPrice || '0',
                                openPrice: item.o || item.openPrice || item.c || '0',
                                highPrice: item.h || item.highPrice || item.c || '0',
                                lowPrice: item.l || item.lowPrice || item.c || '0',
                                volume: item.v || item.volume || '0',
                                quoteVolume: rawQuoteVol,
                                priceChangePercent: item.P || item.priceChangePercent || '0',
                            });
                        }
                    };

                    if (Array.isArray(data)) {
                        for (let i = 0; i < data.length; i++) {
                            processItem(data[i]);
                        }
                    } else if (data && typeof data === 'object') {
                        processItem(data);
                    }

                    if (Object.keys(newPrices).length > 0) {
                        this.enqueuePriceUpdates(newPrices);
                    }

                    if (shouldEmitTickers && rawTickers.length > 0) {
                        this.lastTickersEmitTime = now;
                        priceRegistry.updateMarketTickers(rawTickers);
                        klineDailyStore.save24hTickers(rawTickers);
                    }
                } catch (parseErr) {
                    // Ignore transient json parsing glitch
                }
            };

            ws.onclose = () => {
                if (this.ws !== ws) return;
                this.isConnected = false;
                this.notifyStatus();
                if (!this.isIntentionalClose) {
                    this.rotateUrl();
                    this.scheduleReconnect();
                }
            };

            ws.onerror = () => {
                if (this.ws !== ws) return;
                this.isConnected = false;
                this.notifyStatus();
                try { ws.close(); } catch (_) {}
            };
        } catch (err) {
            this.isConnected = false;
            this.notifyStatus();
            this.rotateUrl();
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect() {
        if (this.reconnectLock) return;
        this.reconnectLock = true;
        this.consecutiveFailures++;

        // Exponential backoff: 2s -> 5s -> 10s -> 20s (prevents reconnect thrashing)
        const delay = Math.min(20000, 1000 * Math.pow(1.6, Math.min(this.consecutiveFailures, 6)));
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectLock = false;
            this.connect();
        }, delay);
    }

    private startFallbackPoller() {
        this.fallbackTimer = setInterval(() => {
            if (typeof document !== 'undefined' && document.hidden) return;

            const now = Date.now();
            const timeSinceLastMsg = now - this.lastMessageTime;
            const timeSinceLastFetch = now - this.lastRestFetchTime;
            
            if (!this.isConnected || timeSinceLastMsg > 6000) {
                if (timeSinceLastFetch > 3500) {
                    this.lastRestFetchTime = now;
                    this.fetchRestPrices();
                }
            }
        }, 1000);
    }

    public async fetchRestPrices() {
        const endpoints = [
            'https://fapi.binance.com/fapi/v1/ticker/price',
            'https://api.binance.com/api/v3/ticker/price',
            'https://api.binance.me/api/v3/ticker/price',
            'https://fapi.binance.me/fapi/v1/ticker/price'
        ];

        for (const url of endpoints) {
            try {
                const res = await fetchWithFallback(url, { timeout: 6000, priority: 'LOW' });
                if (res.ok) {
                    const data = await res.json();
                    const newPrices: Record<string, number> = {};
                    if (Array.isArray(data)) {
                        data.forEach(item => {
                            const symbol = normalizeSymbol(item.symbol || item.s);
                            const price = parseFloat(item.price || item.c || item.p);
                            if (symbol && !isNaN(price) && price > 0) {
                                newPrices[symbol] = price;
                            }
                        });
                        
                        if (Object.keys(newPrices).length > 0) {
                            this.enqueuePriceUpdates(newPrices);
                            this.lastMessageTime = Date.now();
                            return;
                        }
                    }
                }
            } catch (e) {
                // Try next
            }
        }
    }

    private setupEventListeners() {
        if (typeof window !== 'undefined') {
            window.addEventListener('online', () => {
                this.forceReconnect();
            });

            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    const now = Date.now();
                    if (now - this.lastMessageTime > 10000) {
                        this.forceReconnect();
                    }
                }
            });
        }
    }

    private notifyStatus() {
        const status = { isConnected: this.isConnected, lastMessageTime: this.lastMessageTime };
        this.statusCallbacks.forEach(cb => cb(status));
    }

    public subscribeStatus(callback: StatusCallback) {
        this.statusCallbacks.add(callback);
        callback({ isConnected: this.isConnected, lastMessageTime: this.lastMessageTime });
        return () => {
            this.statusCallbacks.delete(callback);
        };
    }

    public forceReconnect() {
        this.isIntentionalClose = false;
        this.rotateUrl();
        this.connect();
        this.fetchRestPrices();
    }

    public syncActivePositions(symbols: string[]) {
        // Native multiplexed stream covers all symbols with zero per-symbol sockets needed
    }

    public subscribe(callback: PriceCallback) {
        this.callbacks.add(callback);
        return () => {
            this.callbacks.delete(callback);
        };
    }

    public enqueuePriceUpdates(prices: Record<string, number>) {
        if (!prices) return;
        let added = 0;
        for (const k in prices) {
            this.pendingPriceBuffer[k] = prices[k];
            added++;
        }
        if (added > 0) {
            this.scheduleBatchFlush();
        }
    }

    private scheduleBatchFlush() {
        if (this.isFlushScheduled) return;
        this.isFlushScheduled = true;

        if (typeof document !== 'undefined' && document.hidden) {
            // Background fallback: throttle to 100ms so background strategy/safety monitoring keeps running smoothly
            setTimeout(() => this.flushPendingPrices(), 100);
        } else {
            // Foreground: lock frame flush to display vsync (max 60Hz) with requestAnimationFrame
            const scheduleFrame = typeof requestAnimationFrame !== 'undefined'
                ? requestAnimationFrame
                : (cb: () => void) => setTimeout(cb, 16);

            scheduleFrame(() => {
                this.flushPendingPrices();
            });
        }
    }

    private flushPendingPrices() {
        this.isFlushScheduled = false;
        const batch = this.pendingPriceBuffer;
        this.pendingPriceBuffer = {};

        const symbols = Object.keys(batch);
        if (symbols.length === 0) return;

        // Throttle telemetry breadcrumb to max once every 10 seconds to eliminate micro-task clogging
        const now = Date.now();
        if (now - this.lastBreadcrumbTime > 10000) {
            this.lastBreadcrumbTime = now;
            recordBreadcrumb('WS_PRICES_BATCH_FLUSH', { count: symbols.length });
        }

        // 1. Dispatch consolidated batch to price registry
        priceRegistry.updatePrices(batch);

        // 2. Notify subscribers with merged batch
        this.notifyCallbacks(batch);
    }

    private notifyCallbacks(prices: Record<string, number>) {
        this.callbacks.forEach(cb => {
            try { cb(prices); } catch (_) {}
        });
    }

    public disconnect() {
        this.isIntentionalClose = true;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        clearInterval(this.fallbackTimer);
        clearInterval(this.statusCheckTimer);
        this.pendingPriceBuffer = {};
        this.isFlushScheduled = false;
        
        if (this.ws) {
            try {
                this.ws.onopen = null;
                this.ws.onmessage = null;
                this.ws.onerror = null;
                this.ws.onclose = null;
                this.ws.close();
            } catch (_) {}
            this.ws = null;
        }
        
        this.isConnected = false;
        this.notifyStatus();
    }
}

// Singleton instance
export const binanceWs = new BinanceWebSocket();
