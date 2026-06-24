import { audioService } from './audioService';
import { normalizeSymbol } from './symbolUtils';
import { fetchWithFallback } from './apiService';
import { priceRegistry } from './priceRegistry';

type PriceCallback = (prices: Record<string, number>) => void;
type StatusCallback = (status: { isConnected: boolean, lastMessageTime: number }) => void;

// Embedded high-performance, multithreaded Web Worker code
const WORKER_CODE = `
let ws = null;
let urls = [];
let currentUrlIndex = 0;
let reconnectTimer = null;
let lastMessageTime = Date.now();
let watchdogTimer = null;
let isConnected = false;

function cleanSymbol(s) {
    if (!s) return '';
    let clean = s.toUpperCase().trim();
    clean = clean.replace(/_PREP$/, '');
    clean = clean.replace(/USDT$/, '');
    clean = clean.replace(/[^A-Z0-9]/g, '');
    return clean;
}

function rotateUrl() {
    currentUrlIndex = (currentUrlIndex + 1) % urls.length;
}

function connect() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) {
        return;
    }

    const currentUrl = urls[currentUrlIndex];
    lastMessageTime = Date.now();
    isConnected = false;
    postMessage({ type: 'status', isConnected: false, lastMessageTime });

    try {
        ws = new WebSocket(currentUrl);

        ws.onopen = () => {
            isConnected = true;
            lastMessageTime = Date.now();
            postMessage({ type: 'status', isConnected: true, lastMessageTime });
        };

        ws.onmessage = (event) => {
            lastMessageTime = Date.now();
            try {
                const json = JSON.parse(event.data);
                const data = json.data || json;
                const newPrices = {};
                let hasUpdates = false;

                const processItem = (item) => {
                    const rawSymbol = item.s || item.symbol;
                    const symbol = cleanSymbol(rawSymbol);
                    if (!symbol) return;

                    let priceVal = null;
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
                        hasUpdates = true;
                    }
                };

                if (Array.isArray(data)) {
                    for (let i = 0; i < data.length; i++) {
                        processItem(data[i]);
                    }
                } else if (data && typeof data === 'object') {
                    processItem(data);
                }

                if (hasUpdates) {
                    postMessage({ type: 'prices', prices: newPrices });
                }
            } catch (err) {
                // Ignore parsing exceptions
            }
        };

        ws.onclose = () => {
            isConnected = false;
            postMessage({ type: 'status', isConnected: false, lastMessageTime });
            rotateUrl();
            scheduleReconnect();
        };

        ws.onerror = () => {
            if (ws) {
                try { ws.close(); } catch(e){}
            }
        };
    } catch (e) {
        isConnected = false;
        postMessage({ type: 'status', isConnected: false, lastMessageTime });
        rotateUrl();
        scheduleReconnect();
    }
}

function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
        connect();
    }, 1500);
}

function startWatchdog() {
    watchdogTimer = setInterval(() => {
        const now = Date.now();
        if (now - lastMessageTime > 12000) {
            if (ws) {
                ws.onclose = null;
                ws.onerror = null;
                try { ws.close(); } catch (e) {}
                ws = null;
            }
            isConnected = false;
            postMessage({ type: 'status', isConnected: false, lastMessageTime: now });
            scheduleReconnect();
        }
    }, 1000);
}

self.onmessage = (e) => {
    const { cmd, payload } = e.data;
    if (cmd === 'init') {
        urls = payload.urls;
        currentUrlIndex = payload.currentUrlIndex || 0;
        connect();
        startWatchdog();
    } else if (cmd === 'forceReconnect') {
        if (ws) {
            ws.onclose = null;
            ws.onerror = null;
            try { ws.close(); } catch (e) {}
            ws = null;
        }
        isConnected = false;
        connect();
    } else if (cmd === 'disconnect') {
        clearInterval(watchdogTimer);
        clearTimeout(reconnectTimer);
        if (ws) {
            try { ws.close(); } catch (e){}
            ws = null;
        }
    }
};
`;

export class BinanceWebSocket {
    private worker: Worker | null = null;
    private callbacks: Set<PriceCallback> = new Set();
    private statusCallbacks: Set<StatusCallback> = new Set();
    private isIntentionalClose = false;
    private urls = [
        'wss://fstream.binance.com/ws/!bookTicker',       
        'wss://fstream.binance.me/ws/!bookTicker',        
        'wss://fstream.binance.com/ws/!ticker@arr',
        'wss://fstream.binance.me/ws/!ticker@arr',
        'wss://fstream.binance.com/ws/!markPrice@arr@1s', 
        'wss://fstream.binance.me/ws/!markPrice@arr@1s',  
        'wss://stream.binance.com:9443/ws/!miniTicker@arr',
        'wss://stream.binance.me:9443/ws/!miniTicker@arr',
        'wss://stream.binance.com:443/ws/!ticker@arr',
        'wss://nbstream.binance.com/lapi/v1/stream?streams=!ticker@arr'
    ];
    private currentUrlIndex = 0;
    private lastMessageTime = Date.now();
    private isConnected = false;
    private consecutiveFailures = 0;
    private fallbackTimer: any = null;
    private lastRestFetchTime = 0;

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
        // Prepend our local server active push pricing proxy WebSocket as Priority 1 fallback
        const localUrl = this.getLocalWsUrl();
        if (localUrl) {
            this.urls = [localUrl, ...this.urls];
        }

        this.initWorker();
        this.setupEventListeners();
        this.startFallbackPoller();
    }

    private initWorker() {
        if (typeof window === 'undefined' || typeof Worker === 'undefined') return;

        try {
            const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(blob);
            this.worker = new Worker(workerUrl);

            this.worker.onmessage = (event) => {
                const { type, prices, isConnected, lastMessageTime } = event.data;
                
                if (type === 'prices') {
                    this.lastMessageTime = Date.now();
                    this.consecutiveFailures = 0;
                    
                    // Directly broadcast prices to DOM Bypass Registry first
                    priceRegistry.updatePrices(prices);

                    // Notify standard app callbacks
                    this.notifyCallbacks(prices);
                } else if (type === 'status') {
                    this.isConnected = isConnected;
                    if (lastMessageTime) {
                        this.lastMessageTime = lastMessageTime;
                    }
                    this.notifyStatus();
                }
            };

            // Start connection via worker
            this.worker.postMessage({
                cmd: 'init',
                payload: {
                    urls: this.urls,
                    currentUrlIndex: this.currentUrlIndex
                }
            });
        } catch (err) {
            console.error('Failed to initialize Web Worker for Binance WS. Falling back to main thread...', err);
        }
    }

    private startFallbackPoller() {
        // Fast, adaptive poller that checks health every 1 second
        this.fallbackTimer = setInterval(() => {
            const now = Date.now();
            const timeSinceLastMsg = now - this.lastMessageTime;
            const timeSinceLastFetch = now - this.lastRestFetchTime;
            
            // If WebSocket is disconnected OR has been silent for more than 4 seconds
            if (!this.isConnected || timeSinceLastMsg > 4000) {
                // Limit REST requests to once every 1.8 seconds max to optimize network usage & avoid rate limits
                if (timeSinceLastFetch > 1800) {
                    console.log(`🌐 [BinanceWS-Worker] WS offline/silent state. Fetching REST prices fallback...`);
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

        this.notifyStatus(); 

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
                            priceRegistry.updatePrices(newPrices);
                            this.notifyCallbacks(newPrices);
                            
                            if (Date.now() - this.lastMessageTime > 5000) {
                                this.lastMessageTime = Date.now();
                            }
                            return;
                        }
                    }
                }
            } catch (e) {
                // Silent catch to try next host
            }
        }
    }

    private setupEventListeners() {
        if (typeof window !== 'undefined') {
            window.addEventListener('online', () => {
                console.log('🌐 Network online detected. Forcing reconnect...');
                this.forceReconnect();
            });

            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    const now = Date.now();
                    if (now - this.lastMessageTime > 10000) {
                        console.log('👁️ Tab became visible and connection stale (>10s). Forcing reconnect...');
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
        console.log('🔄 Worker reconnect forced...');
        this.isIntentionalClose = false;
        
        if (this.worker) {
            this.worker.postMessage({ cmd: 'forceReconnect' });
        } else {
            this.initWorker();
        }
        
        this.isConnected = false;
        this.notifyStatus();
    }

    public subscribe(callback: PriceCallback) {
        this.callbacks.add(callback);
        return () => {
            this.callbacks.delete(callback);
        };
    }

    private notifyCallbacks(prices: Record<string, number>) {
        this.callbacks.forEach(cb => cb(prices));
    }

    public disconnect() {
        this.isIntentionalClose = true;
        clearInterval(this.fallbackTimer);
        
        if (this.worker) {
            this.worker.postMessage({ cmd: 'disconnect' });
            this.worker.terminate();
            this.worker = null;
        }
        
        this.isConnected = false;
        this.notifyStatus();
    }
}

// Singleton instance
export const binanceWs = new BinanceWebSocket();
