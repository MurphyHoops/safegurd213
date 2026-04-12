
import { AppSettings, KLine } from '../../types';
import { backtestDb } from './db';

export interface BacktestConfig {
    symbols: string[];
    intervals: string[];
    startTime: number;
    endTime: number;
    initialBalance: number;
    settings: AppSettings;
    scannerConfig: any;
    speed?: number;
}

export class BacktestEngine {
    private worker: Worker | null = null;

    async run(config: BacktestConfig, onProgress: (p: number) => void): Promise<any> {
        await backtestDb.init();
        
        // 1. Load data for all symbols and intervals
        const klinesMap: Record<string, Record<string, KLine[]>> = {};
        for (const symbol of config.symbols) {
            klinesMap[symbol] = {};
            for (const interval of config.intervals) {
                const data = await backtestDb.getKLines(symbol, interval, config.startTime, config.endTime);
                if (data.length > 0) {
                    klinesMap[symbol][interval] = data;
                }
            }
        }

        if (Object.keys(klinesMap).length === 0) {
            throw new Error('No historical data found in local database for selected period/symbols. Please download data first.');
        }

        return new Promise((resolve, reject) => {
            try {
                this.worker = new Worker(new URL('./backtest.worker.ts', import.meta.url), { type: 'module' });
                
                this.worker.onmessage = (e) => {
                    const { type, progress, results } = e.data;
                    if (type === 'PROGRESS') {
                        onProgress(progress);
                    } else if (type === 'COMPLETE') {
                        this.worker?.terminate();
                        resolve(results);
                    }
                };

                this.worker.onerror = (err) => {
                    this.worker?.terminate();
                    reject(err);
                };

                this.worker.postMessage({
                    klinesMap,
                    settings: config.settings,
                    initialBalance: config.initialBalance,
                    symbols: config.symbols,
                    scannerConfig: config.scannerConfig,
                    speed: config.speed || 1
                });
            } catch (err) {
                reject(new Error('Failed to start Backtest Worker. Browser may not support Web Workers or path is incorrect.'));
            }
        });
    }

    stop() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }
}

export const backtestEngine = new BacktestEngine();
