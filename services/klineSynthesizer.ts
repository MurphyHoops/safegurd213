import { KLine } from '../types';

/**
 * 核心：本地 K 线合成器
 * 功能：通过 1m 数据精准合成任意周期数据，减少 90% 的网络请求
 */
export class KLineSynthesizer {
    /**
     * 将 1m K 线数组聚合为目标周期 K 线
     * @param oneMinKlines 原始 1m 数据
     * @param targetMinutes 目标分钟数 (如 15 代表 15m)
     */
    static synthesize(oneMinKlines: KLine[], targetMinutes: number): KLine[] {
        if (!oneMinKlines || oneMinKlines.length === 0) return [];
        if (targetMinutes === 1) return oneMinKlines;

        const results: KLine[] = [];
        let currentGroup: KLine[] = [];
        const intervalMs = targetMinutes * 60 * 1000;

        for (const kl of oneMinKlines) {
            const bucketStartTime = Math.floor(kl.time / intervalMs) * intervalMs;
            
            if (currentGroup.length > 0) {
                const groupStartTime = Math.floor(currentGroup[0].time / intervalMs) * intervalMs;
                if (groupStartTime !== bucketStartTime) {
                    results.push(this.mergeLines(currentGroup, targetMinutes));
                    currentGroup = [];
                }
            }
            currentGroup.push(kl);
        }

        if (currentGroup.length > 0) {
            results.push(this.mergeLines(currentGroup, targetMinutes));
        }

        return results;
    }

    private static mergeLines(lines: KLine[], targetMinutes: number): KLine {
        const intervalMs = targetMinutes * 60 * 1000;
        return {
            time: Math.floor(lines[0].time / intervalMs) * intervalMs,
            open: lines[0].open,
            high: Math.max(...lines.map(l => l.high)),
            low: Math.min(...lines.map(l => l.low)),
            close: lines[lines.length - 1].close,
            volume: lines.reduce((sum, l) => sum + (l.volume || 0), 0)
        };
    }

    /**
     * 将 5m 原始数组格式数据 ([time, open, high, low, close, volume, closeTime, quoteVolume]) 本地合成任意目标周期 (10m, 15m, 30m, 60m)
     * 0ms 纯内存重采样，减少 80%+ 的网络请求
     */
    static synthesizeFrom5mRaw(fiveMinKlines: any[], targetMinutes: number): any[] {
        if (!Array.isArray(fiveMinKlines) || fiveMinKlines.length === 0) return [];
        if (targetMinutes === 5) return fiveMinKlines;

        const results: any[] = [];
        let currentBucket: any[] | null = null;
        let currentBucketStart = 0;
        const bucketIntervalMs = targetMinutes * 60 * 1000;

        for (const k of fiveMinKlines) {
            const openTime = Number(k[0]);
            const open = parseFloat(k[1]);
            const high = parseFloat(k[2]);
            const low = parseFloat(k[3]);
            const close = parseFloat(k[4]);
            const vol = parseFloat(k[5]) || 0;
            const closeTime = Number(k[6]) || (openTime + bucketIntervalMs - 1);
            const quoteVol = parseFloat(k[7]) || 0;

            const bucketStart = Math.floor(openTime / bucketIntervalMs) * bucketIntervalMs;
            if (!currentBucket || bucketStart !== currentBucketStart) {
                if (currentBucket) {
                    results.push(currentBucket);
                }
                currentBucketStart = bucketStart;
                currentBucket = [
                    bucketStart,
                    open.toString(),
                    high.toString(),
                    low.toString(),
                    close.toString(),
                    vol.toString(),
                    closeTime,
                    quoteVol.toString()
                ];
            } else {
                currentBucket[2] = Math.max(parseFloat(currentBucket[2]), high).toString();
                currentBucket[3] = Math.min(parseFloat(currentBucket[3]), low).toString();
                currentBucket[4] = close.toString();
                currentBucket[5] = (parseFloat(currentBucket[5]) + vol).toString();
                currentBucket[6] = closeTime;
                currentBucket[7] = (parseFloat(currentBucket[7]) + quoteVol).toString();
            }
        }
        if (currentBucket) {
            results.push(currentBucket);
        }
        return results;
    }
}
