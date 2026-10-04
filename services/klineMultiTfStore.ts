/**
 * 🔒 [全域 K 线长效持久化缓存与本地增量计算引擎]
 * Multi-Timeframe K-Line In-Memory Ring Buffer & IndexedDB Persistent Store
 * 
 * 核心架构：
 * 1. 内存滑动环形缓冲区 (Sliding Ring Buffer)：常驻各周期历史 K 线 (上限 150 根)。
 * 2. 浏览器 IndexedDB 持久化 (`SaviorMultiTfKlineDB`)：页面刷新/重启 0 秒预热。
 * 3. 与 `binanceKlineWs` 实时推流打通：毫秒级增量更新最新未收盘打点，收盘 (isFinal) 瞬间自动压入新 K 线。
 * 4. 0 网络请求、0 IP 权重消耗，支持全币种毫秒级本地增量计算。
 */

import { KLine } from '../types';
import { WsKlineUpdate, binanceKlineWs } from './binanceKlineWs';
import { formatToBinanceSymbol, normalizeSymbol } from './symbolUtils';
import { fetchWithFallback } from './apiService';

const DB_NAME = 'SaviorMultiTfKlineDB';
const STORE_NAME = 'multi_tf_klines_v1';
const DB_VERSION = 1;
const MAX_RING_BUFFER_SIZE = 150;

export interface CachedTfEntry {
  key: string; // symbol_tf, e.g. "BTCUSDT_15m"
  symbol: string;
  tf: string;
  timestamp: number;
  klines: KLine[];
}

class KlineMultiTfStore {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;
  // Key: "SYMBOL_TF" -> KLine[]
  private ringBuffers = new Map<string, KLine[]>();
  // Key: "SYMBOL_TF" -> last update timestamp
  private updateTimestamps = new Map<string, number>();
  // Set of symbols currently warming up to prevent duplicate concurrent network hits
  private warmingUpSet = new Set<string>();
  // Set of keys already subscribed to avoid duplicate WS subscriptions
  private subscribedKeys = new Set<string>();
  // Throttled IndexedDB persistence queue
  private pendingDbPersist = new Set<string>();
  private dbPersistTimer: any = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.initDB();
      // Auto-attach to real-time Binance Kline WebSocket stream
      binanceKlineWs.addListener((update) => this.handleWsKlineUpdate(update));
    }
  }

  private getKey(symbol: string, tf: string): string {
    const s = normalizeSymbol(symbol).toUpperCase();
    const t = (tf || '15m').toLowerCase();
    return `${s}_${t}`;
  }

  private async initDB(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    if (typeof window === 'undefined' || !window.indexedDB) return;

    this.initPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => {
          console.warn('[KlineMultiTfStore] IndexedDB open error, fallback to memory');
          resolve();
        };
        request.onsuccess = () => {
          this.db = request.result;
          this.preloadFromDB().then(() => resolve());
        };
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          }
        };
      } catch (err) {
        console.warn('[KlineMultiTfStore] Failed to initialize DB:', err);
        resolve();
      }
    });

    return this.initPromise;
  }

  /**
   * 预热：启动时从 IndexedDB 批量载入近期 K 线到内存环形缓冲区
   */
  private async preloadFromDB(): Promise<number> {
    if (!this.db) return 0;
    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          const entries: CachedTfEntry[] = req.result || [];
          const now = Date.now();
          let loaded = 0;
          entries.forEach((item) => {
            if (item && item.key && Array.isArray(item.klines) && item.klines.length >= 30) {
              // 缓存有效期：6 小时以内的历史分时数据直接预热恢复
              if (now - (item.timestamp || 0) < 6 * 3600 * 1000) {
                this.ringBuffers.set(item.key, item.klines.slice(-MAX_RING_BUFFER_SIZE));
                this.updateTimestamps.set(item.key, item.timestamp);
                loaded++;
              }
            }
          });
          console.log(`[KlineMultiTfStore] ⚡ 成功秒级预热 ${loaded} 组多周期历史 K 线环形缓存！`);
          resolve(loaded);
        };
        req.onerror = () => resolve(0);
      } catch (_) {
        resolve(0);
      }
    });
  }

  /**
   * 极速同步查询（0 毫秒响应，零网络消耗）
   */
  public getKlinesSync(symbol: string, tf: string, minRequiredLength: number = 40): KLine[] | null {
    const key = this.getKey(symbol, tf);
    const buffer = this.ringBuffers.get(key);
    if (buffer && buffer.length >= minRequiredLength) {
      return buffer;
    }
    return null;
  }

  /**
   * 存入或更新完整历史 K 线数组（存入环形缓冲区并异步同步到 IndexedDB）
   */
  public setKlines(symbol: string, tf: string, klines: KLine[]): void {
    if (!symbol || !tf || !Array.isArray(klines) || klines.length === 0) return;
    const key = this.getKey(symbol, tf);
    const cleanBuffer = klines.slice(-MAX_RING_BUFFER_SIZE);
    this.ringBuffers.set(key, cleanBuffer);
    this.updateTimestamps.set(key, Date.now());

    // Schedule throttled IndexedDB persistence
    this.pendingDbPersist.add(key);
    this.scheduleDbPersist();
  }

  /**
   * 实时 WebSocket K 线打点处理（极速增量滑动维护）
   */
  public handleWsKlineUpdate(update: WsKlineUpdate): void {
    if (!update || !update.symbol || !update.tf) return;
    const key = this.getKey(update.symbol, update.tf);
    let buffer = this.ringBuffers.get(key);

    const candle: KLine = {
      time: update.time,
      open: update.open,
      high: update.high,
      low: update.low,
      close: update.close,
      volume: update.volume,
    };

    if (!buffer || buffer.length === 0) {
      // Buffer not yet initialized with history, store single candle
      this.ringBuffers.set(key, [candle]);
      return;
    }

    const lastIdx = buffer.length - 1;
    const lastCandle = buffer[lastIdx];

    if (lastCandle && lastCandle.time === candle.time) {
      // 正在同一根 K 线周期内跳动：原地修改最后一位（0 内存分配开销）
      lastCandle.high = Math.max(lastCandle.high, candle.high);
      lastCandle.low = Math.min(lastCandle.low, candle.low);
      lastCandle.close = candle.close;
      lastCandle.volume = candle.volume;
    } else if (lastCandle && candle.time > lastCandle.time) {
      // 新 K 线生成或上一根正式收盘：滑动压入新 K 线
      buffer.push(candle);
      if (buffer.length > MAX_RING_BUFFER_SIZE) {
        buffer.shift(); // 维持固定滑动窗口大小
      }
    }

    this.updateTimestamps.set(key, Date.now());

    // 当 K 线正式收盘时，向全系统分发广播事件并异步持久化
    if (update.isFinal) {
      this.pendingDbPersist.add(key);
      this.scheduleDbPersist();

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('kline_candle_closed', {
            detail: {
              symbol: update.symbol,
              tf: update.tf,
              candle,
              key,
            },
          })
        );
      }
    }
  }

  /**
   * 静默预热流水线：当币种进入初筛池时，后台异步拉取历史并启动 WS 监听
   */
  public async warmupSymbolKlines(
    rawSymbol: string,
    timeframes: string[] = ['1m', '3m', '5m', '15m', '30m', '1h'],
    directMode: boolean = false
  ): Promise<void> {
    const safeSymbol = formatToBinanceSymbol(rawSymbol);
    if (!safeSymbol) return;

    for (const tf of timeframes) {
      const key = this.getKey(safeSymbol, tf);
      const existing = this.ringBuffers.get(key);
      if (existing && existing.length >= 80) {
        // Already warm, subscribe WS directly if not yet subscribed
        if (!this.subscribedKeys.has(key)) {
          this.subscribedKeys.add(key);
          binanceKlineWs.subscribe(safeSymbol, tf);
        }
        continue;
      }

      const warmKey = `${safeSymbol}_${tf}`;
      if (this.warmingUpSet.has(warmKey)) continue;
      this.warmingUpSet.add(warmKey);

      // Async one-time REST prefetch
      (async () => {
        try {
          const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=${tf}&limit=100&_t=${Date.now()}`;
          const res = await fetchWithFallback(
            url,
            { cache: 'no-store', timeout: 5000, priority: 'HIGH' },
            (d) => Array.isArray(d),
            directMode
          );
          if (res.ok) {
            const raw = await res.json();
            if (Array.isArray(raw) && raw.length > 0) {
              const klines: KLine[] = raw.map((k: any) => ({
                time: Number(k[0]),
                open: parseFloat(k[1]),
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                close: parseFloat(k[4]),
                volume: parseFloat(k[5]),
              }));
              this.setKlines(safeSymbol, tf, klines);
              // Subscribe real-time WebSocket stream for ongoing updates
              if (!this.subscribedKeys.has(key)) {
                this.subscribedKeys.add(key);
                binanceKlineWs.subscribe(safeSymbol, tf);
              }
            }
          }
        } catch (_) {
          // Ignore transient prefetch errors
        } finally {
          this.warmingUpSet.delete(warmKey);
        }
      })();
    }
  }

  private scheduleDbPersist() {
    if (this.dbPersistTimer) return;
    this.dbPersistTimer = setTimeout(() => {
      this.dbPersistTimer = null;
      this.flushPendingToDb();
    }, 2000);
  }

  private flushPendingToDb() {
    if (!this.db || this.pendingDbPersist.size === 0) return;
    try {
      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const keysToPersist = Array.from(this.pendingDbPersist);
      this.pendingDbPersist.clear();

      keysToPersist.forEach((key) => {
        const klines = this.ringBuffers.get(key);
        if (klines && klines.length >= 30) {
          const [symbol, tf] = key.split('_');
          store.put({
            key,
            symbol,
            tf,
            timestamp: this.updateTimestamps.get(key) || Date.now(),
            klines,
          });
        }
      });
    } catch (_) {}
  }
}

export const klineMultiTfStore = new KlineMultiTfStore();
