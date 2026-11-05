// 🔒 智能交易系统 - 高性能定长环形内存库与幂等 EMA 隔离引擎
import { UnifiedKline } from '../types';
import { normalizeSymbol, formatToBinanceSymbol } from './symbolUtils';

export interface EmaState {
  closedEma: number;           // 已收盘基准 EMA (静态只读)
  currentEma: number;          // 盘中实时推演 EMA (基于 closedEma 计算)
  lastClosedOpenTime?: number; // 幂等去重锁：防止同开盘时间收盘帧重复累加
}

/**
 * 高性能定长环形缓冲区 (RingBuffer)
 * 物理杜绝内存重新分配，实现 O(1) 零拷贝逆向检索与动态按需快照
 */
export class KlineRingBuffer {
  private buffer: Array<UnifiedKline>;
  private capacity: number;
  private head: number = 0;
  private count: number = 0;
  private snapshotCache: UnifiedKline[] | null = null; // 快照缓存

  constructor(capacity = 300) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  /**
   * 写入或更新 K 线 (0 动态内存分配)
   */
  public push(kline: UnifiedKline, isClosed: boolean): void {
    this.snapshotCache = null; // 发生数据变更时清空快照缓存

    if (this.count > 0) {
      const lastIdx = ((this.head - 1) % this.capacity + this.capacity) % this.capacity;
      if (this.buffer[lastIdx] && this.buffer[lastIdx].time === kline.time) {
        this.buffer[lastIdx] = kline; // 原地覆盖未完结 K 线
        return;
      }
    }

    // 产生新 K 线，覆盖最老节点
    this.buffer[this.head] = kline;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /**
   * O(1) 零内存分配逆向索引取值 (安全双重取模，彻底防止负数越界)
   * @param offset 0 表示最新 K 线，1 表示前 1 根，以此类推
   */
  public getFromEnd(offset: number): UnifiedKline | null {
    if (offset < 0 || offset >= this.count) return null;
    const physicalIdx = ((this.head - 1 - offset) % this.capacity + this.capacity) % this.capacity;
    return this.buffer[physicalIdx] || null;
  }

  /**
   * 按需按时间顺序获取快照 (仅在 K 线确认收盘或进入二级临界池时才重建)
   */
  public getSnapshot(): UnifiedKline[] {
    if (this.snapshotCache) {
      return this.snapshotCache;
    }

    const result = new Array(this.count);
    if (this.count < this.capacity) {
      for (let i = 0; i < this.count; i++) {
        result[i] = this.buffer[i];
      }
    } else {
      for (let i = 0; i < this.capacity; i++) {
        result[i] = this.buffer[(this.head + i) % this.capacity];
      }
    }
    this.snapshotCache = result;
    return result;
  }

  public get size(): number {
    return this.count;
  }
}

// 全局内存映射管理器
const symbolTfBufferMap = new Map<string, KlineRingBuffer>();
const symbolTfEmaMap = new Map<string, Record<string, EmaState>>(); // key: "SYMBOL:TF", val: { ema10: EmaState... }

function makeKey(symbol: string, tf: string): string {
  if (!symbol || !tf) return '';
  const cleanRaw = symbol.toUpperCase().replace(/[\/_]/g, '').replace(/_(LONG|SHORT|多|空)$/i, '').trim();
  const norm = normalizeSymbol(cleanRaw).toUpperCase();
  return `${norm}:${tf.toLowerCase()}`;
}

export const klineMultiTfStore = {
  /**
   * 获取或初始化币种周期的 RingBuffer
   */
  getBuffer(symbol: string, tf: string): KlineRingBuffer {
    const key = makeKey(symbol, tf);
    let buf = symbolTfBufferMap.get(key);
    if (!buf) {
      buf = new KlineRingBuffer(300);
      symbolTfBufferMap.set(key, buf);
    }
    return buf;
  },

  /**
   * 兼容方法：写入/保存多周期 K 线数组
   */
  saveKlines(symbol: string, tf: string, rawKlines: any[]): void {
    if (!symbol || !tf || !Array.isArray(rawKlines) || rawKlines.length === 0) return;
    const klines: UnifiedKline[] = rawKlines.map((k: any) => {
      if (Array.isArray(k)) {
        return {
          time: Number(k[0]),
          open: parseFloat(k[1]) || 0,
          high: parseFloat(k[2]) || 0,
          low: parseFloat(k[3]) || 0,
          close: parseFloat(k[4]) || 0,
          volume: parseFloat(k[5]) || 0,
        };
      }
      return {
        time: Number(k.time || k.t || 0),
        open: parseFloat(k.open || k.o) || 0,
        high: parseFloat(k.high || k.h) || 0,
        low: parseFloat(k.low || k.l) || 0,
        close: parseFloat(k.close || k.c) || 0,
        volume: parseFloat(k.volume || k.v) || 0,
      };
    }).filter(k => k.time > 0);

    if (klines.length === 0) return;
    this.setKlines(symbol, tf, klines);
  },

  /**
   * 兼容方法：0 毫秒极速同步查询快照 K 线数组
   */
  getKlinesSync(symbol: string, tf: string, minLength: number = 20): UnifiedKline[] | null {
    if (!symbol || !tf) return null;
    const buf = this.getBuffer(symbol, tf);
    if (buf.size >= minLength) {
      return buf.getSnapshot();
    }
    return null;
  },

  /**
   * 写入批量 K 线 (初始化/预热阶段)
   */
  setKlines(symbol: string, tf: string, klines: UnifiedKline[]): void {
    const buf = this.getBuffer(symbol, tf);
    for (let i = 0; i < klines.length; i++) {
      buf.push(klines[i], true);
    }
    this.recalculateClosedEma(symbol, tf);
  },

  /**
   * 盘中递推计算双状态 EMA (具备收盘幂等去重防污染锁)
   */
  updateRealtimeKline(symbol: string, tf: string, kline: UnifiedKline, isClosed: boolean = false): void {
    const buf = this.getBuffer(symbol, tf);
    buf.push(kline, isClosed);

    const key = makeKey(symbol, tf);
    let emaRecord = symbolTfEmaMap.get(key);
    if (!emaRecord) {
      this.recalculateClosedEma(symbol, tf);
      emaRecord = symbolTfEmaMap.get(key);
    }

    if (!emaRecord) return;

    const periods = [10, 20, 30, 40, 80];
    const price = kline.close;

    periods.forEach(p => {
      const state = emaRecord![`ema${p}`];
      if (state) {
        const alpha = 2 / (p + 1);
        if (isClosed) {
          // 幂等去重防污染：检查该 time 是否已固化过 closedEma
          if (state.lastClosedOpenTime !== kline.time) {
            state.closedEma = alpha * price + (1 - alpha) * state.closedEma;
            state.lastClosedOpenTime = kline.time; // 加锁记录
          }
          state.currentEma = state.closedEma;
        } else {
          // 盘中未收盘：仅更新 currentEma，严格基于 closedEma 基准递推
          state.currentEma = alpha * price + (1 - alpha) * state.closedEma;
        }
      }
    });
  },

  /**
   * 静态重新计算基准 closedEma
   */
  recalculateClosedEma(symbol: string, tf: string): void {
    const buf = this.getBuffer(symbol, tf);
    const snapshot = buf.getSnapshot();
    if (snapshot.length === 0) return;

    const key = makeKey(symbol, tf);
    const periods = [10, 20, 30, 40, 80];
    const newRecord: Record<string, EmaState> = {};

    periods.forEach(p => {
      if (snapshot.length < p) return;
      let ema = snapshot[0].close;
      const alpha = 2 / (p + 1);
      for (let i = 1; i < snapshot.length; i++) {
        ema = alpha * snapshot[i].close + (1 - alpha) * ema;
      }
      const lastKline = snapshot[snapshot.length - 1];
      newRecord[`ema${p}`] = {
        closedEma: ema,
        currentEma: ema,
        lastClosedOpenTime: lastKline ? lastKline.time : undefined
      };
    });

    symbolTfEmaMap.set(key, newRecord);
  },

  /**
   * 获取 EMA 双状态
   */
  getEmaState(symbol: string, tf: string, period: number): EmaState | null {
    const key = makeKey(symbol, tf);
    const record = symbolTfEmaMap.get(key);
    return record ? record[`ema${period}`] || null : null;
  },

  /**
   * 退池清除指定币种所有缓存
   */
  evictSymbols(symbolsToEvict: string[]): void {
    if (!symbolsToEvict || symbolsToEvict.length === 0) return;
    const normSet = new Set(symbolsToEvict.map(s => normalizeSymbol(s).toUpperCase().replace(/[\/_]/g, '').trim()));
    for (const key of Array.from(symbolTfBufferMap.keys())) {
      const symPart = key.split(':')[0];
      if (normSet.has(symPart)) {
        symbolTfBufferMap.delete(key);
        symbolTfEmaMap.delete(key);
      }
    }
  },

  purgeStaleEntries(): void {
    if (symbolTfBufferMap.size > 600) {
      let countToRemove = symbolTfBufferMap.size - 400;
      for (const key of symbolTfBufferMap.keys()) {
        symbolTfBufferMap.delete(key);
        symbolTfEmaMap.delete(key);
        if (--countToRemove <= 0) break;
      }
    }
  }
};
