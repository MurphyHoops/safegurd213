import { audioService } from './audioService';

type PriceCallback = (prices: Record<string, number>) => void;
type StatusCallback = (status: { isConnected: boolean, lastMessageTime: number }) => void;

export class BinanceWebSocket {
    private ws: WebSocket | null = null;
    private callbacks: Set<PriceCallback> = new Set();
    private statusCallbacks: Set<StatusCallback> = new Set();
    private reconnectTimer: any = null;
    private isIntentionalClose = false;
    private url = 'wss://fstream.binance.com/ws/!ticker@arr';
    private lastMessageTime = 0;
    private watchdogTimer: any = null;
    private isConnected = false;
    private consecutiveFailures = 0;

    constructor() {
        this.connect();
        this.startWatchdog();
        this.setupEventListeners();
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
                    // If we haven't received a message in 5 seconds and we are visible, reconnect immediately
                    if (now - this.lastMessageTime > 5000) {
                        console.log('👁️ Tab became visible and connection seems stale. Forcing reconnect...');
                        this.forceReconnect();
                    }
                }
            });
        }
    }

    private updateStatus(connected: boolean) {
        this.isConnected = connected;
        this.notifyStatus();
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
        console.log('🔄 Manual reconnect triggered...');
        this.isIntentionalClose = false;
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.onerror = null;
            try { this.ws.close(); } catch (e) {}
            this.ws = null;
        }
        this.updateStatus(false);
        this.lastMessageTime = Date.now();
        
        // Ensure watchdog is running
        clearInterval(this.watchdogTimer);
        this.startWatchdog();
        
        this.connect();
    }

    private connect() {
        if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
            // Check if it's been stuck in CONNECTING for too long (e.g., > 10s)
            if (this.ws.readyState === WebSocket.CONNECTING && Date.now() - this.lastMessageTime > 10000) {
                console.warn('⚠️ WebSocket stuck in CONNECTING state. Forcing close...');
                try { this.ws.close(); } catch (e) {}
                this.ws = null;
            } else {
                return;
            }
        }

        console.log('🔄 Connecting to Binance WebSocket...');
        this.updateStatus(false);
        this.lastMessageTime = Date.now(); // Reset timer to give it 10s to establish connection
        try {
            this.ws = new WebSocket(this.url);

            this.ws.onopen = () => {
                console.log('✅ Connected to Binance WebSocket');
                this.lastMessageTime = Date.now();
                this.updateStatus(true);
            };

            this.ws.onmessage = (event) => {
                this.lastMessageTime = Date.now();
                this.consecutiveFailures = 0; // Reset on successful message
                this.notifyStatus(); // Update lastMessageTime for subscribers
                try {
                    const data = JSON.parse(event.data);
                    if (Array.isArray(data)) {
                        const newPrices: Record<string, number> = {};
                        let hasUpdates = false;
                        
                        for (const item of data) {
                            // item.s = symbol, item.c = last price
                            if (item.e === '24hrTicker' && item.s && item.c) {
                                newPrices[item.s] = parseFloat(item.c) || 0;
                                hasUpdates = true;
                            }
                        }

                        if (hasUpdates) {
                            this.notifyCallbacks(newPrices);
                        }
                    }
                } catch (e) {
                    console.error('Failed to parse Binance WS message', e);
                }
            };

            this.ws.onclose = () => {
                if (this.isIntentionalClose) return;
                console.log('❌ Disconnected from Binance WebSocket. Reconnecting in 3s...');
                this.updateStatus(false);
                this.scheduleReconnect();
            };

            this.ws.onerror = (error) => {
                console.error('Binance WebSocket error:', error);
                this.ws?.close(); // Force close to trigger reconnect
            };
        } catch (e) {
            console.error('Failed to create Binance WebSocket:', e);
            this.updateStatus(false);
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect() {
        if (this.isIntentionalClose) return;
        this.consecutiveFailures++;
        if (this.consecutiveFailures === 3) {
            audioService.speak('警告，币安连接极度不稳定');
        }
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
            this.connect();
        }, 3000);
    }

    private startWatchdog() {
        this.watchdogTimer = setInterval(() => {
            if (this.isIntentionalClose) return;
            
            const now = Date.now();
            // If no message received for 10 seconds, assume connection is dead or stuck
            if (now - this.lastMessageTime > 10000) {
                console.warn('⚠️ Binance WebSocket dead or stuck (no messages for 10s). Forcing reconnect...');
                if (this.ws) {
                    // Remove listeners to prevent double reconnect scheduling
                    this.ws.onclose = null;
                    this.ws.onerror = null;
                    try { this.ws.close(); } catch (e) {}
                    this.ws = null;
                }
                this.updateStatus(false);
                this.lastMessageTime = now; // Reset so we don't trigger again immediately
                this.scheduleReconnect();
            }
            
            // Also notify status periodically so UI can update the "seconds ago" counter
            this.notifyStatus();
        }, 1000); // Check every second to update UI
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
        clearTimeout(this.reconnectTimer);
        clearInterval(this.watchdogTimer);
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.updateStatus(false);
    }
}

// Singleton instance
export const binanceWs = new BinanceWebSocket();
