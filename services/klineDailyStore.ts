/**
 * 🔒 [全域日K长效持久化缓存引擎 (24小时常驻 + IndexedDB 本地持久化)]
 * 
 * 核心设计目标：
 * 1. 彻底解决冷启动丢币与每轮逐级累积 (第1轮3个、第2轮8个...) 的缺陷，首轮秒出 36+ 全量初筛币种。
 * 2. 内存 (window.KLINE_LIMIT_CACHE) 与 浏览器 IndexedDB 双重存储，页面刷新/重载/重启后秒级预热。
 * 3. 历史日K线在当天 (8:00 AM 至次日 8:00 AM) 完全不可变，设为 24 小时绝对可信常驻缓存。
 * 4. 针对上市不足 300 天的次新币记录最大上市日线根数，杜绝反复穿透网络。
 */

export interface CachedKlineEntry {
    symbol: string;
    timestamp: number;
    klines: any[];
    count: number;
    isListingEnd: boolean; // 上市不足300天但已获取币安全部可用历史K线
}

const DB_NAME = 'SaviorDailyKlineDB';
const STORE_NAME = 'daily_klines_v1';
const DB_VERSION = 1;
const CACHE_VALIDITY_1D = 86400000; // 24小时有效

class KlineDailyStore {
    private db: IDBDatabase | null = null;
    private initPromise: Promise<void> | null = null;
    private memoryMap = new Map<string, CachedKlineEntry>();

    constructor() {
        if (typeof window !== 'undefined') {
            this.initMemoryFromWindow();
            this.initDB();
        }
    }

    private initMemoryFromWindow() {
        if (typeof window === 'undefined') return;
        (window as any).KLINE_LIMIT_CACHE = (window as any).KLINE_LIMIT_CACHE || {};
    }

    private async initDB(): Promise<void> {
        if (this.initPromise) return this.initPromise;
        if (typeof window === 'undefined' || !window.indexedDB) return;

        this.initPromise = new Promise((resolve) => {
            try {
                const request = indexedDB.open(DB_NAME, DB_VERSION);
                request.onerror = () => {
                    console.warn('[KlineDailyStore] IndexedDB open error, fallback to memory cache');
                    resolve();
                };
                request.onsuccess = () => {
                    this.db = request.result;
                    this.preloadFromDB().then(() => resolve());
                };
                request.onupgradeneeded = (event) => {
                    const db = (event.target as IDBOpenDBRequest).result;
                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        db.createObjectStore(STORE_NAME, { keyPath: 'symbol' });
                    }
                };
            } catch (err) {
                console.warn('[KlineDailyStore] Failed to initialize IndexedDB:', err);
                resolve();
            }
        });

        return this.initPromise;
    }

    /**
     * 预热：从 IndexedDB 批量同步读取到内存
     */
    private async preloadFromDB(): Promise<number> {
        if (!this.db) return 0;
        return new Promise((resolve) => {
            try {
                const tx = this.db!.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.getAll();
                req.onsuccess = () => {
                    const entries: CachedKlineEntry[] = req.result || [];
                    const now = Date.now();
                    let loaded = 0;
                    entries.forEach((item) => {
                        if (item && item.symbol && Array.isArray(item.klines) && item.klines.length > 0) {
                            if (now - (item.timestamp || 0) < CACHE_VALIDITY_1D) {
                                this.syncToWindowCache(item.symbol, item.klines, item.timestamp);
                                this.memoryMap.set(item.symbol, item);
                                loaded++;
                            }
                        }
                    });
                    console.log(`[KlineDailyStore] 成功预热载入 ${loaded} 个币种的 300 天日K常驻缓存！`);
                    resolve(loaded);
                };
                req.onerror = () => resolve(0);
            } catch (_) {
                resolve(0);
            }
        });
    }

    private normalizeSym(sym: string): string {
        return (sym || '').toUpperCase().replace(/_LONG$|_SHORT$/i, '').replace(/[\/_]/g, '').trim();
    }

    private syncToWindowCache(symbol: string, klines: any[], timestamp: number) {
        if (typeof window === 'undefined') return;
        const norm = this.normalizeSym(symbol);
        const winCache = (window as any).KLINE_LIMIT_CACHE || ((window as any).KLINE_LIMIT_CACHE = {});
        
        if (!winCache[norm]) winCache[norm] = {};
        if (!winCache[symbol]) winCache[symbol] = {};

        winCache[norm][300] = { klines, timestamp };
        winCache[symbol][300] = { klines, timestamp };
        winCache[norm]['1d'] = { klines, timestamp };
        winCache[symbol]['1d'] = { klines, timestamp };
        winCache[`${norm}_1d`] = klines;
        winCache[`${symbol}_1d`] = klines;
    }

    /**
     * 极速同步查询（0 毫秒响应）
     */
    public getCachedKlinesSync(symbol: string, minRequiredLength: number = 300): any[] | null {
        const norm = this.normalizeSym(symbol);
        const now = Date.now();

        // 1. 检查类内部缓存
        const entry = this.memoryMap.get(norm) || this.memoryMap.get(symbol);
        if (entry && (now - entry.timestamp < CACHE_VALIDITY_1D) && Array.isArray(entry.klines) && entry.klines.length >= 2) {
            if (entry.klines.length >= minRequiredLength || entry.isListingEnd) {
                return entry.klines;
            }
        }

        // 2. 检查全局 window.KLINE_LIMIT_CACHE
        if (typeof window !== 'undefined') {
            const winCache = (window as any).KLINE_LIMIT_CACHE;
            if (winCache) {
                const candidates = [
                    winCache[norm]?.[minRequiredLength]?.klines,
                    winCache[symbol]?.[minRequiredLength]?.klines,
                    winCache[norm]?.[300]?.klines,
                    winCache[symbol]?.[300]?.klines,
                    winCache[`${norm}_1d`],
                    winCache[`${symbol}_1d`],
                    winCache[norm]?.['1d']?.klines,
                    winCache[symbol]?.['1d']?.klines
                ];

                for (const cand of candidates) {
                    if (Array.isArray(cand) && cand.length >= 2) {
                        if (cand.length >= minRequiredLength || (entry && entry.isListingEnd)) {
                            return cand;
                        }
                    }
                }
            }
        }

        return null;
    }

    /**
     * 保存日K线到内存与持久化存储
     */
    public async saveKlines(symbol: string, klines: any[]): Promise<void> {
        if (!Array.isArray(klines) || klines.length < 2) return;
        const norm = this.normalizeSym(symbol);
        const timestamp = Date.now();
        // 若上市时间不足300天但币安已经返回其全部历史
        const isListingEnd = klines.length < 300;

        const entry: CachedKlineEntry = {
            symbol: norm,
            timestamp,
            klines,
            count: klines.length,
            isListingEnd
        };

        this.memoryMap.set(norm, entry);
        this.memoryMap.set(symbol, entry);
        this.syncToWindowCache(symbol, klines, timestamp);

        if (this.db) {
            try {
                const tx = this.db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                store.put(entry);
            } catch (e) {
                console.warn('[KlineDailyStore] Failed to write entry to IndexedDB:', e);
            }
        }
    }
}

export const klineDailyStore = new KlineDailyStore();
