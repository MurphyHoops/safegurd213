/**
 * 🔒 [全域多周期 K 线高速内存共享注册中心 (0ms 极速直通总线)]
 * 
 * 核心目标：
 * 1. 为所有 K 线大图弹窗 (KlineChartModal, ScannerVisualizerModal, 各列表弹窗) 提供 0ms 瞬间秒开直调能力。
 * 2. 统一承接列表 1 预热、列表 2/3/4 扫描与 WebSocket 实时推流的 200 根基线 K 线。
 * 3. 彻底消除点击看盘时的白屏 Loading 转圈与重复网络请求，消灭 HTTP 418/429 惩罚。
 */

import { normalizeSymbol, formatToBinanceSymbol } from './symbolUtils';

export interface UnifiedKline {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

class KlineMultiTfStore {
    // 内存高速映射: key = `${normSymbol}-${tf}` 和 `${safeSymbol}-${tf}`
    private memoryMap = new Map<string, UnifiedKline[]>();

    constructor() {
        if (typeof window !== 'undefined') {
            (window as any).KLINE_MULTI_TF_CACHE = (window as any).KLINE_MULTI_TF_CACHE || {};
        }
    }

    private getKeys(symbol: string, tf: string): string[] {
        if (!symbol || !tf) return [];
        const norm = normalizeSymbol(symbol).toUpperCase().replace(/[\/_]/g, '').trim();
        const safe = formatToBinanceSymbol(symbol).toUpperCase();
        const raw = symbol.toUpperCase().replace(/[\/_]/g, '').trim();
        const tfClean = tf.toLowerCase().trim();

        return Array.from(new Set([
            `${norm}-${tfClean}`,
            `${safe}-${tfClean}`,
            `${raw}-${tfClean}`,
            `${norm}USDT-${tfClean}`
        ]));
    }

    /**
     * 保存/更新多周期 K 线数组到共享内存总线
     */
    public saveKlines(symbol: string, tf: string, rawKlines: any[]): void {
        if (!symbol || !tf || !Array.isArray(rawKlines) || rawKlines.length === 0) return;

        // 标准化为 UnifiedKline 格式
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

        const keys = this.getKeys(symbol, tf);
        for (const k of keys) {
            this.memoryMap.set(k, klines);
        }

        // 同步全局 window 缓存，供第三方调试与兼容
        if (typeof window !== 'undefined') {
            const winCache = (window as any).KLINE_MULTI_TF_CACHE;
            if (winCache) {
                for (const k of keys) {
                    winCache[k] = klines;
                }
            }
        }
    }

    /**
     * 极速同步查询（0 毫秒瞬间响应）
     */
    public getKlinesSync(symbol: string, tf: string, minLength: number = 20): UnifiedKline[] | null {
        if (!symbol || !tf) return null;
        const keys = this.getKeys(symbol, tf);

        // 1. 查询类内部高速映射
        for (const k of keys) {
            const cached = this.memoryMap.get(k);
            if (cached && cached.length >= minLength) {
                return cached;
            }
        }

        // 2. 查询全局 window 缓存
        if (typeof window !== 'undefined') {
            const winCache = (window as any).KLINE_MULTI_TF_CACHE;
            if (winCache) {
                for (const k of keys) {
                    const cached = winCache[k];
                    if (Array.isArray(cached) && cached.length >= minLength) {
                        return cached;
                    }
                }
            }
        }

        return null;
    }

    /**
     * WebSocket 实时 Tick 原位增量推送更新
     */
    public updateRealtimeKline(symbol: string, tf: string, update: { time: number; open: number; high: number; low: number; close: number; volume: number }): void {
        const keys = this.getKeys(symbol, tf);
        let existing: UnifiedKline[] | null = null;

        for (const k of keys) {
            const list = this.memoryMap.get(k);
            if (list && list.length > 0) {
                existing = list;
                break;
            }
        }

        if (!existing || existing.length === 0) return;

        const updated = [...existing];
        const lastIdx = updated.length - 1;
        const last = updated[lastIdx];

        if (last && last.time === update.time) {
            updated[lastIdx] = { ...update };
        } else if (last && update.time > last.time) {
            updated.push({ ...update });
            if (updated.length > 300) {
                updated.shift();
            }
        }

        for (const k of keys) {
            this.memoryMap.set(k, updated);
        }
    }
}

export const klineMultiTfStore = new KlineMultiTfStore();
