
class SimpleEventEmitter {
  private listeners: Map<string, Function[]> = new Map();
  on(event: string, listener: Function) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)?.push(listener);
  }
  off(event: string, listener: Function) {
    const l = this.listeners.get(event);
    if (l) this.listeners.set(event, l.filter(f => f !== listener));
  }
  emit(event: string, data: any) {
    this.listeners.get(event)?.forEach(l => l(data));
  }
}

class BinanceRealtimeService extends SimpleEventEmitter {
  private ws: WebSocket | null = null;
  private prices: Map<string, number> = new Map();

  constructor() {
    super();
    this.connect();
  }

  private connect() {
    this.ws = new WebSocket('wss://fstream.binance.com/ws/!miniTicker@arr');
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (Array.isArray(data)) {
        data.forEach(ticker => {
          this.prices.set(ticker.s, parseFloat(ticker.c));
        });
        this.emit('pricesUpdated', this.prices);
      }
    };
    this.ws.onclose = () => setTimeout(() => this.connect(), 5000);
  }

  getPrice(symbol: string): number | undefined {
    return this.prices.get(symbol);
  }
}

export const binanceRealtimeService = new BinanceRealtimeService();
