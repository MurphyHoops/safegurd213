
import { fetchWithFallback } from '../apiService';
import { KLine } from '../../types';
import { backtestDb } from './db';

export class BacktestDownloader {
    async downloadHistoricalData(
        symbol: string,
        interval: string,
        startTime: number,
        endTime: number,
        onProgress?: (progress: number, current: number, total: number) => void,
        directMode: boolean = false
    ): Promise<void> {
        try {
            await backtestDb.init();
            let currentStart = startTime;
            const totalMs = endTime - startTime;

            while (currentStart < endTime) {
                const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&startTime=${currentStart}&limit=1000`;
                
                const response = await fetchWithFallback(url, {}, (data) => Array.isArray(data), directMode);
                const data = await response.json();

                if (!Array.isArray(data) || data.length === 0) break;

                const klines: KLine[] = data.map((d: any) => ({
                    time: d[0],
                    open: parseFloat(d[1]),
                    high: parseFloat(d[2]),
                    low: parseFloat(d[3]),
                    close: parseFloat(d[4]),
                    volume: parseFloat(d[5])
                }));

                await backtestDb.saveKLines(symbol, interval, klines);

                const lastTime = klines[klines.length - 1].time;
                currentStart = lastTime + 1;

                const progress = Math.min(100, ((currentStart - startTime) / totalMs) * 100);
                if (onProgress) {
                    onProgress(progress, currentStart, endTime);
                }

                // Reduced delay for parallel efficiency, but still respectful
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        } catch (err) {
            console.error(`Download error for ${symbol} ${interval}:`, err);
            throw err;
        }
    }
}

export const backtestDownloader = new BacktestDownloader();
