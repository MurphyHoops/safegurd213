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

export interface PendingKlineItem {
  symbol: string;
  tf: string;
  update?: WsKlineUpdate;
  rawKlineData?: any;
  isClosed: boolean;
}

class L234DataStoreService {
  private registeredSymbols: Set<string> = new Set();
  private registeredSymbolTfs: Map<string, Set<string>> = new Map();
  private klineCache: Map<string, Map<string, KLine[]>> = new Map();
  private emaCache: Map<string, Map<string, EMASet>> = new Map();
  private evictionTimers: Map<string, NodeJS.Timeout> = new Map();
  private listeners: Set<(symbol: string, tf: string) => void> = new Set();

  // 150ms 高速消息缓冲池
  private klineUpdateBuffer: Map<string, PendingKlineItem[]> = new Map();
  private flushTimer: any = null;
  private readonly BATCH_INTERVAL_MS = 150;

  constructor() {
    this.startBatchProcessor();
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

  private startBatchProcessor(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      this.flushKlineBuffer();
    }, this.BATCH_INTERVAL_MS);
  }

  public enqueueRealtimeKline(symbol: string, interval: string, rawKlineData: any): void {
    const normSym = normalizeSymbol(symbol);
    if (!normSym) return;

    const isClosed = Boolean(rawKlineData?.x || rawKlineData?.isFinal);
    const updateTime = Number(rawKlineData?.t || rawKlineData?.time || rawKlineData?.T || Date.now());

    const update: WsKlineUpdate = {
      symbol: normSym,
      tf: interval,
      time: updateTime,
      open: parseFloat(rawKlineData.o || rawKlineData.open || 0),
      high: parseFloat(rawKlineData.h || rawKlineData.high || 0),
      low: parseFloat(rawKlineData.l || rawKlineData.low || 0),
      close: parseFloat(rawKlineData.c || rawKlineData.close || 0),
      volume: parseFloat(rawKlineData.v || rawKlineData.volume || 0),
      isFinal: isClosed,
    };

    this.enqueueUpdateItem({
      symbol: normSym,
      tf: interval,
      update,
      rawKlineData,
      isClosed,
    });
  }

  public updateRealtimeKline(update: WsKlineUpdate): void {
    const symbol = normalizeSymbol(update.symbol);
    if (!symbol || !this.registeredSymbols.has(symbol)) return;

    const isClosed = Boolean(update.isFinal);
    this.enqueueUpdateItem({
      symbol,
      tf: update.tf,
      update,
      isClosed,
    });
  }

  private enqueueUpdateItem(item: PendingKlineItem): void {
    const key = `${item.symbol}_${item.tf}`;
    const candleTimeSec = item.update ? Math.floor(item.update.time / 1000) : 0;

    if (!this.klineUpdateBuffer.has(key)) {
      this.klineUpdateBuffer.set(key, [item]);
      return;
    }

    const items = this.klineUpdateBuffer.get(key)!;
    const existingIdx = items.findIndex(i => {
      const t = i.update ? Math.floor(i.update.time / 1000) : 0;
      return t === candleTimeSec;
    });

    if (existingIdx >= 0) {
      const existing = items[existingIdx];
      // 收盘保护：若已捕获该时间戳的收盘帧，绝不允许迟到的未收盘价格跳动将其覆盖
      if (existing.isClosed && !item.isClosed) {
        return;
      }
      items[existingIdx] = item;
    } else {
      items.push(item);
    }
  }

  private flushKlineBuffer(): void {
    if (this.klineUpdateBuffer.size === 0) return;

    const pendingBatch = new Map(this.klineUpdateBuffer);
    this.klineUpdateBuffer.clear();

    const updatedPairs = new Map<string, Set<string>>();

    pendingBatch.forEach((items) => {
      for (const item of items) {
        if (item.update) {
          this.applyRealtimeKlineUpdate(item.update);
          if (!updatedPairs.has(item.symbol)) {
            updatedPairs.set(item.symbol, new Set());
          }
          updatedPairs.get(item.symbol)!.add(item.tf);
        }
      }
    });

    updatedPairs.forEach((tfs, symbol) => {
      tfs.forEach(tf => {
        this.notifyListeners(symbol, tf);
      });
    });
  }

  private applyRealtimeKlineUpdate(update: WsKlineUpdate): void {
    const symbol = update.symbol;
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

    if (update.tf === '5m' && registeredTfs && registeredTfs.has('10m')) {
      const klines5m = symbolMap.get('5m') || [];
      const klines10m = this.synthesize10mFrom5m(klines5m);
      symbolMap.set('10m', klines10m);
      this.recalculateEMA(symbol, '10m', klines10m);
    }
  }

  private recalculateEMA(symbol: string, tf: string, klines: KLine[]): void {
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

  public registerSymbol(rawSymbol: string, tf: string = '15m'): string {
    const symbol = normalizeSymbol(rawSymbol);
    if (!symbol) return '';

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

    this.ensureKlinesPrefetched(symbol, [tf]);
    return symbol;
  }

  public unregisterSymbol(rawSymbol: string): void {
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

  public syncActiveCandidates(activeItems: Array<string | { symbol: string; tf?: string }>, protectedPositions?: string[]): void {
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

    for (const [sym, activeTfs] of activeMap.entries()) {
      if (this.evictionTimers.has(sym)) {
        clearTimeout(this.evictionTimers.get(sym)!);
        this.evictionTimers.delete(sym);
      }
      for (const tf of activeTfs) {
        this.registerSymbol(sym, tf);
      }
    }

    for (const registeredSym of Array.from(this.registeredSymbols)) {
      if (protectedSet.has(registeredSym)) {
        if (this.evictionTimers.has(registeredSym)) {
          clearTimeout(this.evictionTimers.get(registeredSym)!);
          this.evictionTimers.delete(registeredSym);
        }
        continue;
      }

      if (!activeMap.has(registeredSym)) {
        if (!this.evictionTimers.has(registeredSym)) {
          const timer = setTimeout(() => {
            this.evictionTimers.delete(registeredSym);
            this.unregisterSymbol(registeredSym);
          }, 5 * 60 * 1000);
          this.evictionTimers.set(registeredSym, timer);
        }
      }
    }
  }

  public hasSymbol(rawSymbol: string): boolean {
    const symbol = normalizeSymbol(rawSymbol);
    return this.registeredSymbols.has(symbol);
  }

  public getAllSymbols(): string[] {
    return Array.from(this.registeredSymbols);
  }

  public synthesize10mFrom5m(klines5m: KLine[]): KLine[] {
    if (!klines5m || klines5m.length === 0) return [];
    const map10m = new Map<number, KLine>();

    for (const k of klines5m) {
      const tenMinTime = Math.floor(k.time / 600) * 600;
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

  public async ensureKlinesPrefetched(rawSymbol: string, timeframes: string[]): Promise<void> {
    const symbol = normalizeSymbol(rawSymbol);
    if (!symbol) return;

    const symbolKlines = this.klineCache.get(symbol) || new Map();
    this.klineCache.set(symbol, symbolKlines);

    for (let targetTf of timeframes) {
      const is10m = targetTf === '10m';
      const fetchTf = is10m ? '5m' : targetTf;
      const fetchLimit = is10m ? 600 : 300;

      const existing = symbolKlines.get(targetTf);
      if (existing && existing.length >= 280) {
        this.recalculateEMA(symbol, targetTf, existing);
        continue;
      }

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
      } catch (err) {}
    }
  }

  public getKlines(rawSymbol: string, tf: string): KLine[] {
    const symbol = normalizeSymbol(rawSymbol);
    if (!symbol) return [];

    const symbolMap = this.klineCache.get(symbol);
    if (symbolMap && symbolMap.has(tf)) {
      return symbolMap.get(tf)!;
    }

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

  public getPrecomputedEMA(rawSymbol: string, tf: string): EMASet | null {
    const symbol = normalizeSymbol(rawSymbol);
    if (!symbol) return null;

    const symbolEmaMap = this.emaCache.get(symbol);
    if (symbolEmaMap && symbolEmaMap.has(tf)) {
      return symbolEmaMap.get(tf)!;
    }
    return null;
  }

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

  public addListener(cb: (symbol: string, tf: string) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notifyListeners(symbol: string, tf: string): void {
    for (const listener of this.listeners) {
      try {
        listener(symbol, tf);
      } catch (_) {}
    }
  }

  public destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.klineUpdateBuffer.clear();
  }
}

export const l234DataStore = new L234DataStoreService();
