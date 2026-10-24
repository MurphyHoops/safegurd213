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

  // Multi-timeframe Kline memory cache: symbol -> (tf -> KLine[])
  private klineCache: Map<string, Map<string, KLine[]>> = new Map();

  // Precomputed EMA cache: symbol -> (tf -> EMASet)
  private emaCache: Map<string, Map<string, EMASet>> = new Map();

  // Active timeframes to auto-maintain
  private activeTimeframes: Set<string> = new Set([
    '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d'
  ]);

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
            if (sym) {
              this.registerSymbol(sym);
            }
          }
        }
      }
    } catch (_) {}
  }

  /**
   * Register a symbol into the L234 Data Store.
   * Guarantees persistence and real-time subscription protection.
   */
  public registerSymbol(rawSymbol: string): string {
    const symbol = normalizeSymbol(rawSymbol);
    if (!symbol) return '';

    if (!this.registeredSymbols.has(symbol)) {
      this.registeredSymbols.add(symbol);
      if (!this.klineCache.has(symbol)) {
        this.klineCache.set(symbol, new Map());
      }
      if (!this.emaCache.has(symbol)) {
        this.emaCache.set(symbol, new Map());
      }

      // Prefetch 200 bars for standard timeframes in background
      this.ensureKlinesPrefetched(symbol);
    }
    return symbol;
  }

  /**
   * Unregister a symbol when it is naturally expired or evicted from List 2/3/4.
   */
  public unregisterSymbol(rawSymbol: string) {
    const symbol = normalizeSymbol(rawSymbol);
    if (!symbol) return;
    this.registeredSymbols.delete(symbol);
    this.klineCache.delete(symbol);
    this.emaCache.delete(symbol);
  }

  /**
   * Sync active candidates in Market Selection List / List 2.
   * Evicts unselected symbols to immediately free memory.
   */
  public syncActiveCandidates(activeSymbols: string[]) {
    if (!Array.isArray(activeSymbols)) return;
    const activeSet = new Set(
      activeSymbols.map(s => normalizeSymbol(s)).filter(Boolean)
    );
    for (const sym of Array.from(this.registeredSymbols)) {
      if (!activeSet.has(sym)) {
        this.unregisterSymbol(sym);
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
   * Ensure 200 Klines exist in cache for requested timeframes
   */
  public async ensureKlinesPrefetched(rawSymbol: string, timeframes?: string[]) {
    const symbol = normalizeSymbol(rawSymbol);
    if (!symbol) return;

    const tfsToFetch = timeframes || Array.from(this.activeTimeframes);
    const symbolKlines = this.klineCache.get(symbol) || new Map();
    this.klineCache.set(symbol, symbolKlines);

    for (const tf of tfsToFetch) {
      // 1. Check if already in L234 store with >= 280 bars
      const existing = symbolKlines.get(tf);
      if (existing && existing.length >= 280) {
        this.recalculateEMA(symbol, tf, existing);
        continue;
      }

      // 2. Check klineMultiTfStore
      const multiStoreKlines = klineMultiTfStore.getKlinesSync(symbol, tf, 300);
      if (multiStoreKlines && multiStoreKlines.length >= 280) {
        const converted: KLine[] = multiStoreKlines.map(k => ({
          time: k.time > 2000000000 ? Math.floor(k.time / 1000) : k.time,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
          volume: k.volume,
        }));
        symbolKlines.set(tf, converted);
        this.recalculateEMA(symbol, tf, converted);
        continue;
      }

      // 3. REST API Fetch fallback (300 bars guaranteed)
      try {
        const binanceSymbol = symbol.toUpperCase().endsWith('USDT') ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
        const res: any = await fetchWithFallback(`/fapi/v1/klines?symbol=${binanceSymbol}&interval=${tf}&limit=300`);
        if (Array.isArray(res) && res.length > 0) {
          const parsed: KLine[] = res.map(row => ({
            time: Math.floor(Number(row[0]) / 1000),
            open: Number(row[1]),
            high: Number(row[2]),
            low: Number(row[3]),
            close: Number(row[4]),
            volume: Number(row[5]),
          })).sort((a, b) => a.time - b.time);

          symbolKlines.set(tf, parsed);
          klineMultiTfStore.saveKlines(symbol, tf, parsed);
          this.recalculateEMA(symbol, tf, parsed);
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

    let klines = symbolMap.get(update.tf) || [];
    if (klines.length === 0) {
      // Fallback load from klineMultiTfStore
      const multiStoreKlines = klineMultiTfStore.getKlinesSync(symbol, update.tf, 1);
      if (multiStoreKlines && multiStoreKlines.length > 0) {
        klines = multiStoreKlines.map(k => ({
          time: k.time > 2000000000 ? Math.floor(k.time / 1000) : k.time,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
          volume: k.volume,
        }));
      }
    }

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
        // Update current forming candle in-place
        klines[lastIndex] = candle;
      } else if (candle.time > lastCandle.time) {
        // Append new completed/forming candle
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

    // Recalculate EMAs instantly
    this.recalculateEMA(symbol, update.tf, klines);

    // Notify subscribers
    this.notifyListeners(symbol, update.tf);
  }

  /**
   * Recalculate EMA10, 20, 30, 40 for instantaneous access
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
      // Find index of signal candle
      const signalIdx = klines.findIndex(k => k.time === signalTimeSec || Math.abs(k.time - signalTimeSec) < 60);
      if (signalIdx >= 0) {
        const start = Math.max(0, signalIdx - 2);
        const end = Math.min(klines.length, signalIdx + 3);
        return klines.slice(start, end);
      }
    }

    // Default to last 5 candles
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
