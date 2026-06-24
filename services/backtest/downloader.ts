
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
            
            // Optimization: Check if we already have data covering this range to avoid redundant network calls
            const existing = await backtestDb.getKLines(symbol, interval, startTime, endTime);
            
            let currentStart = startTime;
            if (existing.length > 0) {
                // Find the latest timestamp in the existing klines
                const latest = existing[existing.length - 1].time;
                // If it covers our range (allow 1 candle gap for in-progress klines)
                if (latest >= endTime - 60000) {
                    if (onProgress) onProgress(100, endTime, endTime);
                    return;
                }
                // Otherwise start from the next candle
                currentStart = latest + 1;
            }

            const totalMs = endTime - startTime;
            if (totalMs <= 0) return;

            while (currentStart < endTime) {
                const safeSymbol = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
                const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=${interval}&startTime=${currentStart}&limit=1000`;
                
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

                // Further reduced delay for high-speed fiber connections, but still respectful of API limits
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        } catch (err) {
            console.error(`Download error for ${symbol} ${interval}:`, err);
            throw err;
        }
    }
}

export const backtestDownloader = new BacktestDownloader();
