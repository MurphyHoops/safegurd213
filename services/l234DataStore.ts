/**
 * @file l234DataStore.ts
 * @description Dedicated High-Speed Memory Storage & Cache Registry for List 2, List 3, and List 4.
 * Once a symbol enters List 2, this store maintains 0-latency multi-timeframe Klines, EMA indicators, 
 * and 5K window snapshots, guaranteeing independent data persistence even if the symbol exits List 1.
 */

import { KLine } from '../types';
import { normalizeSymbol } from './symbolUtils';
import { klineMultiTfStore } from './klineMultiTfStore';
import { getLatestEMA } from './indicators';
import { fetchWithFallback } from './apiService';

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

export interface EMASet {
  ema10: number;
  ema20: number;
  ema30: number;
  ema40: number;
}

class L234DataStoreService {
  // Registered symbols that have entered List 2/3/4
  private registeredSymbols: Set<string> = new Set();

  // Active target timeframes per symbol: symbol -> Set<tf>
  private registeredSymbolTfs: Map<string, Set<string>> = new Map();

  // Multi-timeframe Kline memory cache: symbol -> (tf -> KLine[])
  private klineCache: Map<string, Map<string, KLine[]>> = new Map();

  // Precomputed EMA cache: symbol -> (tf -> EMASet)
  private emaCache: Map<string, Map<string, EMASet>> = new Map();

  // 5-Minute (300,000ms) Debounce Eviction Buffer Timers: symbol -> NodeJS.Timeout
  private evictionTimers: Map<string, NodeJS.Timeout> = new Map();

  // Listeners for data store updates
  private listeners: Set<(symbol: string, tf: string) => void> = new Set();

  constructor() {
    // Auto sync from localStorage if existing list2 signals present
    try {
      const savedList2 = localStorage.getItem('GRAND_CROSSING_RESULTS');
      if (savedList2) {
        const items = JSON.parse(savedList2);
        if (Array.isArray(items)) {
          for (const item of items) {
            const sym = item.symbol || item.rawSymbol;
            const tf = item.tf || item.period || '15m';
            if (sym) {
              this.registerSymbol(sym, tf);
            }
          }
        }
      }
    } catch (_) {}
  }

  /**
   * Register a symbol and its signal timeframe into the L234 Data Store.
   * Clears any pending 5-minute eviction timer instantly.
   */
  public registerSymbol(rawSymbol: string, tf: string = '15m'): string {
    const symbol = normalizeSymbol(rawSymbol);
    if (!symbol) return '';

    // Clear any 5-minute pending eviction timer
    if (this.evictionTimers.has(symbol)) {
      clearTimeout(this.evictionTimers.get(symbol)!);
      this.evictionTimers.delete(symbol);
    }

    let symbolTfs = this.registeredSymbolTfs.get(symbol);
    if (!symbolTfs) {
      symbolTfs = new Set<string>();
      this.registeredSymbolTfs.set(symbol, symbolTfs);
    }

    symbolTfs.add(tf);
    this.registeredSymbols.add(symbol);

    if (!this.klineCache.has(symbol)) {
      this.klineCache.set(symbol, new Map());
    }
    if (!this.emaCache.has(symbol)) {
      this.emaCache.set(symbol, new Map());
    }

    // Prefetch 300 bars ONLY for the target List 2 signal timeframe
    this.ensureKlinesPrefetched(symbol, [tf]);
    return symbol;
  }

  /**
   * Unregister a symbol when 5-minute eviction timer expires.
   */
  public unregisterSymbol(rawSymbol: string) {
    const symbol = normalizeSymbol(rawSymbol);
    if (!symbol) return;
    this.registeredSymbols.delete(symbol);
    this.registeredSymbolTfs.delete(symbol);
    this.klineCache.delete(symbol);
    this.emaCache.delete(symbol);
    if (this.evictionTimers.has(symbol)) {
      clearTimeout(this.evictionTimers.get(symbol)!);
      this.evictionTimers.delete(symbol);
    }
  }

  /**
   * Sync active candidates in List 2/3/4 with a 5-minute (300秒) debounce eviction buffer.
   * Protected active positions are permanently locked in memory until closed.
   */
  public syncActiveCandidates(activeItems: Array<string | { symbol: string; tf?: string }>, protectedPositions?: string[]) {
    const activeMap = new Map<string, Set<string>>();
    
    if (Array.isArray(activeItems)) {
      for (const item of activeItems) {
        if (typeof item === 'string') {
          const sym = normalizeSymbol(item);
          if (!sym) continue;
          if (!activeMap.has(sym)) activeMap.set(sym, new Set());
          activeMap.get(sym)!.add('15m');
        } else if (item && typeof item === 'object') {
          const sym = normalizeSymbol(item.symbol);
          if (!sym) continue;
          const tf = item.tf || '15m';
          if (!activeMap.has(sym)) activeMap.set(sym, new Set());
          activeMap.get(sym)!.add(tf);
        }
      }
    }

    const protectedSet = new Set((protectedPositions || []).map(s => normalizeSymbol(s)).filter(Boolean));

    // Register/reactivate all active candidates and cancel any pending 5m eviction
    for (const [sym, activeTfs] of activeMap.entries()) {
      if (this.evictionTimers.has(sym)) {
        clearTimeout(this.evictionTimers.get(sym)!);
        this.evictionTimers.delete(sym);
      }
      for (const tf of activeTfs) {
        this.registerSymbol(sym, tf);
      }
    }

    // Check currently registered symbols that no longer appear in active candidates
    for (const registeredSym of Array.from(this.registeredSymbols)) {
      if (protectedSet.has(registeredSym)) {
        // Protected active position: permanently cancel eviction timer
        if (this.evictionTimers.has(registeredSym)) {
          clearTimeout(this.evictionTimers.get(registeredSym)!);
          this.evictionTimers.delete(registeredSym);
        }
        continue;
      }

      if (!activeMap.has(registeredSym)) {
        // Symbol disappeared from List 2 candidate list: Start 5-minute (300s) debounce eviction buffer
        if (!this.evictionTimers.has(registeredSym)) {
          const timer = setTimeout(() => {
            this.evictionTimers.delete(registeredSym);
            this.unregisterSymbol(registeredSym);
          }, 5 * 60 * 1000); // 5 minutes debounce buffer
          this.evictionTimers.set(registeredSym, timer);
        }
      }
    }
  }

  /**
   * Check if a symbol is in L234 Store
   */
  public hasSymbol(rawSymbol: string): boolean {
    const symbol = normalizeSymbol(rawSymbol);
    return this.registeredSymbols.has(symbol);
  }

  /**
   * Get all currently registered symbols
   */
  public getAllSymbols(): string[] {
    return Array.from(this.registeredSymbols);
  }

  /**
   * Synthesize 10m Klines from 5m Klines
   */
  public synthesize10mFrom5m(klines5m: KLine[]): KLine[] {
    if (!klines5m || klines5m.length === 0) return [];
    const map10m = new Map<number, KLine>();

    for (const k of klines5m) {
      const tenMinTime = Math.floor(k.time / 600) * 600; // 10m = 600 seconds
      const existing = map10m.get(tenMinTime);

      if (!existing) {
        map10m.set(tenMinTime, {
          time: tenMinTime,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
          volume: k.volume,
        });
      } else {
        existing.high = Math.max(existing.high, k.high);
        existing.low = Math.min(existing.low, k.low);
        existing.close = k.close;
        existing.volume += k.volume;
      }
    }

    return Array.from(map10m.values()).sort((a, b) => a.time - b.time);
  }

  /**
   * Ensure 300 Klines exist in cache ONLY for requested signal timeframes.
   * If tf === '10m', fetches 5m data and synthesizes 10m Klines.
   */
  public async ensureKlinesPrefetched(rawSymbol: string, timeframes: string[]) {
    const symbol = normalizeSymbol(rawSymbol);
    if (!symbol) return;

    const symbolKlines = this.klineCache.get(symbol) || new Map();
    this.klineCache.set(symbol, symbolKlines);

    for (let targetTf of timeframes) {
      const is10m = targetTf === '10m';
      const fetchTf = is10m ? '5m' : targetTf;
      const fetchLimit = is10m ? 600 : 300;

      // 1. Check if target TF already exists with >= 280 bars
      const existing = symbolKlines.get(targetTf);
      if (existing && existing.length >= 280) {
        this.recalculateEMA(symbol, targetTf, existing);
        continue;
      }

      // 2. Check klineMultiTfStore
      const multiStoreKlines = klineMultiTfStore.getKlinesSync(symbol, fetchTf, fetchLimit);
      if (multiStoreKlines && multiStoreKlines.length >= 100) {
        let converted: KLine[] = multiStoreKlines.map(k => ({
          time: k.time > 2000000000 ? Math.floor(k.time / 1000) : k.time,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
          volume: k.volume,
        }));

        if (is10m) {
          converted = this.synthesize10mFrom5m(converted);
        }

        symbolKlines.set(targetTf, converted);
        this.recalculateEMA(symbol, targetTf, converted);
        continue;
      }

      // 3. REST API Fetch fallback (300 bars for target TF, 600 for 5m->10m)
      try {
        const binanceSymbol = symbol.toUpperCase().endsWith('USDT') ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
        const res: any = await fetchWithFallback(`/fapi/v1/klines?symbol=${binanceSymbol}&interval=${fetchTf}&limit=${fetchLimit}`);
        if (Array.isArray(res) && res.length > 0) {
          let parsed: KLine[] = res.map(row => ({
            time: Math.floor(Number(row[0]) / 1000),
            open: Number(row[1]),
            high: Number(row[2]),
            low: Number(row[3]),
            close: Number(row[4]),
            volume: Number(row[5]),
          })).sort((a, b) => a.time - b.time);

          if (is10m) {
            parsed = this.synthesize10mFrom5m(parsed);
          }

          symbolKlines.set(targetTf, parsed);
          klineMultiTfStore.saveKlines(symbol, targetTf, parsed);
          this.recalculateEMA(symbol, targetTf, parsed);
        }
      } catch (err) {
        // Fallback silently
      }
    }
  }

  /**
   * Update realtime WebSocket Kline into memory store
   */
  public updateRealtimeKline(update: WsKlineUpdate) {
    const symbol = normalizeSymbol(update.symbol);
    if (!symbol || !this.registeredSymbols.has(symbol)) return;

    let symbolMap = this.klineCache.get(symbol);
    if (!symbolMap) {
      symbolMap = new Map();
      this.klineCache.set(symbol, symbolMap);
    }

    const registeredTfs = this.registeredSymbolTfs.get(symbol);
    const isTargetTf = registeredTfs ? (registeredTfs.has(update.tf) || (update.tf === '5m' && registeredTfs.has('10m'))) : true;
    if (!isTargetTf) return;

    let klines = symbolMap.get(update.tf) || [];
    const candle: KLine = {
      time: Math.floor(update.time / 1000),
      open: update.open,
      high: update.high,
      low: update.low,
      close: update.close,
      volume: update.volume,
    };

    if (klines.length > 0) {
      const lastIndex = klines.length - 1;
      const lastCandle = klines[lastIndex];

      if (lastCandle.time === candle.time) {
        klines[lastIndex] = candle;
      } else if (candle.time > lastCandle.time) {
        klines.push(candle);
        if (klines.length > 300) {
          klines.shift();
        }
      }
    } else {
      klines = [candle];
    }

    symbolMap.set(update.tf, klines);
    klineMultiTfStore.saveKlines(symbol, update.tf, klines);
    this.recalculateEMA(symbol, update.tf, klines);

    // If 5m update received and 10m is registered for this symbol, synthesize 10m update instantly
    if (update.tf === '5m' && registeredTfs && registeredTfs.has('10m')) {
      const klines5m = symbolMap.get('5m') || [];
      const klines10m = this.synthesize10mFrom5m(klines5m);
      symbolMap.set('10m', klines10m);
      this.recalculateEMA(symbol, '10m', klines10m);
      this.notifyListeners(symbol, '10m');
    }

    // Notify subscribers
    this.notifyListeners(symbol, update.tf);
  }

  /**
   * Recalculate EMA10, 20, 30, 40, 80 for instantaneous access
   */
  private recalculateEMA(symbol: string, tf: string, klines: KLine[]) {
    if (klines.length < 10) return;
    const closes = klines.map(k => k.close);
    const ema10 = getLatestEMA(closes, 10);
    const ema20 = getLatestEMA(closes, 20);
    const ema30 = getLatestEMA(closes, 30);
    const ema40 = getLatestEMA(closes, 40);

    let symbolEmaMap = this.emaCache.get(symbol);
    if (!symbolEmaMap) {
      symbolEmaMap = new Map();
      this.emaCache.set(symbol, symbolEmaMap);
    }

    symbolEmaMap.set(tf, { ema10, ema20, ema30, ema40 });
  }

  /**
   * Get Klines for a symbol and timeframe (instant 0-latency memory lookup)
   */
  public getKlines(rawSymbol: string, tf: string): KLine[] {
    const symbol = normalizeSymbol(rawSymbol);
    if (!symbol) return [];

    const symbolMap = this.klineCache.get(symbol);
    if (symbolMap && symbolMap.has(tf)) {
      return symbolMap.get(tf)!;
    }

    // Fallback to klineMultiTfStore
    const multiStoreKlines = klineMultiTfStore.getKlinesSync(symbol, tf, 1);
    if (multiStoreKlines && multiStoreKlines.length > 0) {
      return multiStoreKlines.map(k => ({
        time: k.time > 2000000000 ? Math.floor(k.time / 1000) : k.time,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
        volume: k.volume,
      }));
    }
    return [];
  }

  /**
   * Get precalculated EMAs (0-latency memory lookup)
   */
  public getPrecomputedEMA(rawSymbol: string, tf: string): EMASet | null {
    const symbol = normalizeSymbol(rawSymbol);
    if (!symbol) return null;

    const symbolEmaMap = this.emaCache.get(symbol);
    if (symbolEmaMap && symbolEmaMap.has(tf)) {
      return symbolEmaMap.get(tf)!;
    }
    return null;
  }

  /**
   * Get 5-candle window centered around signal candle or latest candle for List 4 5K audit
   */
  public get5CandleWindow(rawSymbol: string, tf: string, signalTimeSec?: number): KLine[] {
    const klines = this.getKlines(rawSymbol, tf);
    if (klines.length < 5) return klines;

    if (signalTimeSec && signalTimeSec > 0) {
      const signalIdx = klines.findIndex(k => k.time === signalTimeSec || Math.abs(k.time - signalTimeSec) < 60);
      if (signalIdx >= 0) {
        const start = Math.max(0, signalIdx - 2);
        const end = Math.min(klines.length, signalIdx + 3);
        return klines.slice(start, end);
      }
    }

    return klines.slice(-5);
  }

  /**
   * Subscribe to L234 DataStore updates
   */
  public addListener(cb: (symbol: string, tf: string) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notifyListeners(symbol: string, tf: string) {
    for (const listener of this.listeners) {
      try {
        listener(symbol, tf);
      } catch (_) {}
    }
  }
}

export const l234DataStore = new L234DataStoreService();
