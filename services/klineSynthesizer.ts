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
}
