
import { KLine } from '../../types';

const DB_NAME = 'SaviorBacktestDB';
const STORE_NAME = 'klines';
const DB_VERSION = 2;

export class BacktestDB {
    private db: IDBDatabase | null = null;

    async init(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    store.createIndex('symbol_interval', ['symbol', 'interval'], { unique: false });
                    store.createIndex('symbol_interval_time', ['symbol', 'interval', 'time'], { unique: true });
                }
                if (!db.objectStoreNames.contains('reports')) {
                    db.createObjectStore('reports', { keyPath: 'id' });
                }
            };
        });
    }

    private getStore(mode: IDBTransactionMode = 'readonly'): IDBObjectStore {
        if (!this.db) throw new Error('DB not initialized');
        const transaction = this.db.transaction(STORE_NAME, mode);
        return transaction.objectStore(STORE_NAME);
    }

    async saveKLines(symbol: string, interval: string, klines: KLine[]): Promise<void> {
        const store = this.getStore('readwrite');
        return new Promise((resolve, reject) => {
            const transaction = store.transaction;
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);

            klines.forEach(k => {
                const id = `${symbol}_${interval}_${k.time}`;
                store.put({ ...k, id, symbol, interval });
            });
        });
    }

    async getKLines(symbol: string, interval: string, startTime: number, endTime: number): Promise<KLine[]> {
        const store = this.getStore();
        const index = store.index('symbol_interval_time');
        const range = IDBKeyRange.bound([symbol, interval, startTime], [symbol, interval, endTime]);
        
        return new Promise((resolve, reject) => {
            const request = index.getAll(range);
            request.onsuccess = () => {
                resolve(request.result as KLine[]);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async clearData(): Promise<void> {
        const store = this.getStore('readwrite');
        return new Promise((resolve, reject) => {
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async saveReport(report: any): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction('reports', 'readwrite');
            const store = transaction.objectStore('reports');
            const request = store.put(report);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getReports(): Promise<any[]> {
        if (!this.db) await this.init();
        if (!this.db!.objectStoreNames.contains('reports')) {
            return [];
        }
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction('reports', 'readonly');
            const store = transaction.objectStore('reports');
            const request = store.getAll();
            request.onsuccess = () => {
                const list = request.result || [];
                list.sort((a: any, b: any) => b.runTime - a.runTime);
                resolve(list);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async deleteReport(id: string): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction('reports', 'readwrite');
            const store = transaction.objectStore('reports');
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}

export const backtestDb = new BacktestDB();
