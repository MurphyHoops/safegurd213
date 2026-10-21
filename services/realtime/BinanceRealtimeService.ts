import { priceRegistry } from '../priceRegistry';
import { normalizeSymbol } from '../symbolUtils';

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
    this.listeners.get(event)?.forEach(l => {
      try { l(data); } catch (_) {}
    });
  }
  hasListeners(event: string): boolean {
    return (this.listeners.get(event)?.length || 0) > 0;
  }
}

/**
 * 🛡️ [HIGH-FREQUENCY ANTI-EXPLOSION REINFORCED]
 * Bridges directly to the central priceRegistry instead of opening a redundant,
 * unmanaged raw WebSocket that exhausts socket connections and floods React with 20+ FPS updates.
 * Emits throttled updates at maximum 2Hz (every 500ms) only when active listeners exist.
 */
class BinanceRealtimeService extends SimpleEventEmitter {
  private prices: Map<string, number> = new Map();
  private lastEmitTime = 0;
  private throttleTimer: any = null;

  constructor() {
    super();
    this.initBridge();
  }

  private initBridge() {
    priceRegistry.registerListener((newPrices) => {
      for (const sym in newPrices) {
        this.prices.set(sym, newPrices[sym]);
      }

      if (!this.hasListeners('pricesUpdated')) return;

      const now = Date.now();
      if (now - this.lastEmitTime >= 500) {
        this.lastEmitTime = now;
        if (this.throttleTimer) {
          clearTimeout(this.throttleTimer);
          this.throttleTimer = null;
        }
        this.emit('pricesUpdated', this.prices);
      } else if (!this.throttleTimer) {
        this.throttleTimer = setTimeout(() => {
          this.throttleTimer = null;
          this.lastEmitTime = Date.now();
          this.emit('pricesUpdated', this.prices);
        }, 500);
      }
    });
  }

  getPrice(symbol: string): number | undefined {
    const norm = normalizeSymbol(symbol);
    return priceRegistry.getPrice(norm) ?? this.prices.get(symbol);
  }
}

export const binanceRealtimeService = new BinanceRealtimeService();
