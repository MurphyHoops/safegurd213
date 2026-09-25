// ⚡ Binance Real-Time Kline WebSocket Service (Active Push Architecture)
// Maintains low-latency multiplexed WebSocket connection for live K-line streams

export interface WsKlineUpdate {
  symbol: string;
  tf: string;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isFinal: boolean;
}

type KlineCallback = (update: WsKlineUpdate) => void;

class BinanceKlineWsService {
  private ws: WebSocket | null = null;
  private isConnected: boolean = false;
  private subscribedStreams: Set<string> = new Set();
  private pendingSubscribe: Set<string> = new Set();
  private pendingUnsubscribe: Set<string> = new Set();
  private listeners: Set<KlineCallback> = new Set();
  private reconnectTimer: any = null;
  private batchFlushTimer: any = null;
  private msgIdCounter: number = 1;
  private watchdogTimer: any = null;
  private lastMsgTime: number = Date.now();

  private wsUrls = [
    'wss://fstream.binance.com/ws',
    'wss://fstream.binance.com/stream',
    'wss://fstream-auth.binance.com/ws',
  ];
  private currentUrlIdx = 0;

  constructor() {
    this.startWatchdog();
  }

  public subscribe(symbol: string, tf: string) {
    const stream = this.formatStreamName(symbol, tf);
    if (!stream) return;

    if (this.pendingUnsubscribe.has(stream)) {
      this.pendingUnsubscribe.delete(stream);
    }

    if (!this.subscribedStreams.has(stream) && !this.pendingSubscribe.has(stream)) {
      this.pendingSubscribe.add(stream);
      this.scheduleBatchFlush();
    }

    if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      this.connect();
    }
  }

  public unsubscribe(symbol: string, tf: string) {
    const stream = this.formatStreamName(symbol, tf);
    if (!stream) return;

    if (this.pendingSubscribe.has(stream)) {
      this.pendingSubscribe.delete(stream);
    }

    if (this.subscribedStreams.has(stream)) {
      this.pendingUnsubscribe.add(stream);
      this.scheduleBatchFlush();
    }
  }

  public syncSubscriptions(requiredPairs: { symbol: string; tf: string }[]) {
    const targetStreams = new Set<string>();
    for (const item of requiredPairs) {
      const stream = this.formatStreamName(item.symbol, item.tf);
      if (stream) targetStreams.add(stream);
    }

    // Identify streams to unsubscribe
    for (const sub of this.subscribedStreams) {
      if (!targetStreams.has(sub)) {
        this.pendingUnsubscribe.add(sub);
      }
    }

    // Identify streams to subscribe
    for (const tgt of targetStreams) {
      if (!this.subscribedStreams.has(tgt)) {
        this.pendingSubscribe.add(tgt);
      }
    }

    if (this.pendingSubscribe.size > 0 || this.pendingUnsubscribe.size > 0) {
      this.scheduleBatchFlush();
    }

    if (targetStreams.size > 0 && (!this.ws || this.ws.readyState === WebSocket.CLOSED)) {
      this.connect();
    }
  }

  public addListener(cb: KlineCallback): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private formatStreamName(symbol: string, tf: string): string | null {
    if (!symbol) return null;
    let cleanSym = symbol.toUpperCase().replace(/_PREP$/, '').trim();
    if (!cleanSym.endsWith('USDT')) {
      cleanSym += 'USDT';
    }
    // Binance WebSocket supports: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M
    const tfLower = tf.toLowerCase();
    const validTfs = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1m'];
    if (!validTfs.includes(tfLower)) {
      return null;
    }
    return `${cleanSym.toLowerCase()}@kline_${tfLower}`;
  }

  private connect() {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    const url = this.wsUrls[this.currentUrlIdx];
    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.lastMsgTime = Date.now();
        // Re-subscribe all active streams upon reconnection
        const allStreams = Array.from(new Set([...this.subscribedStreams, ...this.pendingSubscribe]));
        this.subscribedStreams.clear();
        this.pendingSubscribe = new Set(allStreams);
        this.flushSubscriptions();
      };

      this.ws.onmessage = (event) => {
        this.lastMsgTime = Date.now();
        try {
          const raw = JSON.parse(event.data);
          const data = raw.data || raw;

          if (data && data.e === 'kline' && data.k) {
            const k = data.k;
            const update: WsKlineUpdate = {
              symbol: (data.s || k.s || '').toUpperCase(),
              tf: k.i,
              time: Number(k.t),
              open: parseFloat(k.o),
              high: parseFloat(k.h),
              low: parseFloat(k.l),
              close: parseFloat(k.c),
              volume: parseFloat(k.v),
              isFinal: !!k.x,
            };

            this.listeners.forEach((cb) => {
              try {
                cb(update);
              } catch (e) {
                // Prevent individual callback failure from breaking loop
              }
            });
          }
        } catch (e) {
          // JSON parse error
        }
      };

      this.ws.onerror = () => {
        this.rotateUrl();
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.scheduleReconnect();
      };
    } catch (e) {
      this.scheduleReconnect();
    }
  }

  private rotateUrl() {
    this.currentUrlIdx = (this.currentUrlIdx + 1) % this.wsUrls.length;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  private scheduleBatchFlush() {
    if (this.batchFlushTimer) return;
    this.batchFlushTimer = setTimeout(() => {
      this.batchFlushTimer = null;
      this.flushSubscriptions();
    }, 300);
  }

  private flushSubscriptions() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // 1. Process UNSUBSCRIBE
    if (this.pendingUnsubscribe.size > 0) {
      const streamsToUnsub = Array.from(this.pendingUnsubscribe);
      this.pendingUnsubscribe.clear();
      streamsToUnsub.forEach((s) => this.subscribedStreams.delete(s));

      const chunkSize = 20;
      for (let i = 0; i < streamsToUnsub.length; i += chunkSize) {
        const chunk = streamsToUnsub.slice(i, i + chunkSize);
        try {
          this.ws.send(
            JSON.stringify({
              method: 'UNSUBSCRIBE',
              params: chunk,
              id: this.msgIdCounter++,
            })
          );
        } catch (e) {}
      }
    }

    // 2. Process SUBSCRIBE
    if (this.pendingSubscribe.size > 0) {
      const streamsToSub = Array.from(this.pendingSubscribe);
      this.pendingSubscribe.clear();
      streamsToSub.forEach((s) => this.subscribedStreams.add(s));

      const chunkSize = 20;
      for (let i = 0; i < streamsToSub.length; i += chunkSize) {
        const chunk = streamsToSub.slice(i, i + chunkSize);
        try {
          this.ws.send(
            JSON.stringify({
              method: 'SUBSCRIBE',
              params: chunk,
              id: this.msgIdCounter++,
            })
          );
        } catch (e) {}
      }
    }
  }

  private startWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = setInterval(() => {
      if (this.subscribedStreams.size > 0) {
        const now = Date.now();
        if (now - this.lastMsgTime > 15000) {
          // If no messages received in 15 seconds with active subscriptions, reconnect
          if (this.ws) {
            try {
              this.ws.close();
            } catch (e) {}
          }
        }
      }
    }, 5000);
  }
}

export const binanceKlineWs = new BinanceKlineWsService();
