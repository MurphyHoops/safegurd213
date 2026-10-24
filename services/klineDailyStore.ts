/**
 * 🔒 [全域日K长效持久化缓存引擎 (24小时常驻 + IndexedDB 本地持久化)]
 * 
 * 核心设计目标：
 * 1. 彻底解决冷启动丢币与每轮逐级累积 (第1轮3个、第2轮8个...) 的缺陷，首轮秒出 36+ 全量初筛币种。
 * 2. 内存 (window.KLINE_LIMIT_CACHE) 与 浏览器 IndexedDB 双重存储，页面刷新/重载/重启后秒级预热。
 * 3. 历史日K线在当天 (8:00 AM 至次日 8:00 AM) 完全不可变，设为 24 小时绝对可信常驻缓存。
 * 4. 针对上市不足 300 天的次新币记录最大上市日线根数，杜绝反复穿透网络。
 */

import { klineMultiTfStore } from './klineMultiTfStore';
import { fetchWithFallback } from './apiService';
import { KLineSynthesizer } from './klineSynthesizer';

export interface CachedKlineEntry {
    symbol: string;
    timestamp: number;
    klines: any[];
    count: number;
    isListingEnd: boolean; // 上市不足300天但已获取币安全部可用历史K线
}

export interface CachedTickerEntry {
    symbol: string;
    lastPrice: string;
    openPrice: string;
    highPrice: string;
    lowPrice: string;
    volume: string;
    quoteVolume: string;
    priceChangePercent: string;
    timestamp: number;
}

export interface CachedShortlistTfEntry {
    key: string; // `${symbol}_${tf}`
    symbol: string;
    tf: string;
    timestamp: number;
    klines: any[];
    count: number;
}

const DB_NAME = 'SaviorDailyKlineDB';
const STORE_NAME = 'daily_klines_v1';
const STORE_TICKERS = 'market_tickers_24h_v1';
const STORE_SHORTLIST_TF = 'shortlist_multi_tf_300_v1';
const DB_VERSION = 2;
const CACHE_VALIDITY_1D = 86400000; // 24小时有效

class KlineDailyStore {
    private db: IDBDatabase | null = null;
    private initPromise: Promise<void> | null = null;
    private memoryMap = new Map<string, CachedKlineEntry>();
    private tickerMemoryMap = new Map<string, CachedTickerEntry>();
    private rawTickersList: any[] = [];
    private shortlistTfMemoryMap = new Map<string, CachedShortlistTfEntry>();
    private lastTickerPurgeTime = 0;
    private isSyncingDaily = false;
    private lastDailySyncTime = 0;
    private dailyScheduleTimer: any = null;
    private tickerSaveTimer: any = null;
    private shortlistSaveTimer: any = null;
    private pendingTickerSaves: CachedTickerEntry[] = [];
    private pendingShortlistSaves: CachedShortlistTfEntry[] = [];

    constructor() {
        if (typeof window !== 'undefined') {
            this.initMemoryFromWindow();
            this.initDB();
            this.startDaily8AmScheduler();
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
                    if (!db.objectStoreNames.contains(STORE_TICKERS)) {
                        db.createObjectStore(STORE_TICKERS, { keyPath: 'symbol' });
                    }
                    if (!db.objectStoreNames.contains(STORE_SHORTLIST_TF)) {
                        db.createObjectStore(STORE_SHORTLIST_TF, { keyPath: 'key' });
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
                // 1. 预热日K数据
                if (this.db.objectStoreNames.contains(STORE_NAME)) {
                    const tx = this.db.transaction(STORE_NAME, 'readonly');
                    const store = tx.objectStore(STORE_NAME);
                    const req = store.getAll();
                    req.onsuccess = () => {
                        const entries: CachedKlineEntry[] = req.result || [];
                        const now = Date.now();
                        let loaded = 0;
                        entries.forEach((item) => {
                            if (item && item.symbol && Array.isArray(item.klines) && item.klines.length >= 30) {
                                if (now - (item.timestamp || 0) < CACHE_VALIDITY_1D) {
                                    this.syncToWindowCache(item.symbol, item.klines, item.timestamp);
                                    this.memoryMap.set(item.symbol, item);
                                    loaded++;
                                }
                            }
                        });
                        console.log(`[KlineDailyStore] 成功预热载入 ${loaded} 个币种的 300 天日K常驻缓存！`);
                    };
                }

                // 2. 预热 24 小时全量行情广播数据 (严格限定 1 分钟内的最新推送)
                if (this.db.objectStoreNames.contains(STORE_TICKERS)) {
                    const txTickers = this.db.transaction(STORE_TICKERS, 'readonly');
                    const tickerStore = txTickers.objectStore(STORE_TICKERS);
                    const reqTickers = tickerStore.getAll();
                    reqTickers.onsuccess = () => {
                        const tickers: CachedTickerEntry[] = reqTickers.result || [];
                        const now = Date.now();
                        if (tickers.length > 0) {
                            const rawList: any[] = [];
                            tickers.forEach(t => {
                                if (t && t.symbol && (now - (t.timestamp || 0) < 60000)) {
                                    this.tickerMemoryMap.set(t.symbol, t);
                                    rawList.push(t);
                                }
                            });
                            this.rawTickersList = rawList;
                            console.log(`[KlineDailyStore] 成功预热载入 ${rawList.length} 个币种的 24H 实时行情快照 (1分钟滚动窗口)！`);
                        }
                    };
                }

                // 3. 预热初筛币种 12 周期 300 根多周期 K 线高速数据
                if (this.db.objectStoreNames.contains(STORE_SHORTLIST_TF)) {
                    const txTf = this.db.transaction(STORE_SHORTLIST_TF, 'readonly');
                    const tfStore = txTf.objectStore(STORE_SHORTLIST_TF);
                    const reqTf = tfStore.getAll();
                    reqTf.onsuccess = () => {
                        const tfEntries: CachedShortlistTfEntry[] = reqTf.result || [];
                        let tfCount = 0;
                        tfEntries.forEach(entry => {
                            if (entry && entry.symbol && entry.tf && Array.isArray(entry.klines) && entry.klines.length > 0) {
                                this.shortlistTfMemoryMap.set(entry.key, entry);
                                klineMultiTfStore.saveKlines(entry.symbol, entry.tf, entry.klines);
                                tfCount++;
                            }
                        });
                        console.log(`[KlineDailyStore] 成功预热载入初筛币种 ${tfCount} 个多周期 300 根基线 K 线！`);
                        resolve(this.memoryMap.size);
                    };
                    reqTf.onerror = () => resolve(this.memoryMap.size);
                } else {
                    resolve(this.memoryMap.size);
                }
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

        // 仅在K线数量达到200根或以上时才写入300大回溯缓存
        if (klines.length >= 200) {
            winCache[norm][300] = { klines, timestamp };
            winCache[symbol][300] = { klines, timestamp };
        }
        winCache[norm]['1d'] = { klines, timestamp };
        winCache[symbol]['1d'] = { klines, timestamp };
        winCache[`${norm}_1d`] = klines;
        winCache[`${symbol}_1d`] = klines;

        if (this.memoryMap.size > 300) {
            this.purgeStaleMemoryCache();
        }
    }

    /**
     * 🛡️ [内存卫兵]: 彻底清理旧/非活跃 K 线对象与全局 window.KLINE_LIMIT_CACHE，防止长时间运行 OOM 崩溃
     */
    public purgeStaleMemoryCache(): void {
        const now = Date.now();
        if (this.memoryMap.size > 200) {
            for (const [key, entry] of this.memoryMap.entries()) {
                if (now - entry.timestamp > 30 * 60 * 1000 || this.memoryMap.size > 150) {
                    this.memoryMap.delete(key);
                }
            }
        }

        if (typeof window !== 'undefined') {
            const winCache = (window as any).KLINE_LIMIT_CACHE;
            if (winCache && typeof winCache === 'object') {
                const keys = Object.keys(winCache);
                if (keys.length > 300) {
                    const toDelete = keys.slice(0, keys.length - 120);
                    for (const k of toDelete) {
                        delete winCache[k];
                    }
                }
            }
        }
    }

    /**
     * 极速同步查询（0 毫秒响应）
     */
    public getCachedKlinesSync(symbol: string, minRequiredLength: number = 300): any[] | null {
        const norm = this.normalizeSym(symbol);
        const now = Date.now();

        // 1. 检查类内部缓存 (本地数据库只要有 >=30 根有效日K即视为完整有效数据，杜绝无意义网络穿透)
        const entry = this.memoryMap.get(norm) || this.memoryMap.get(symbol);
        if (entry && (now - entry.timestamp < CACHE_VALIDITY_1D) && Array.isArray(entry.klines) && entry.klines.length > 0) {
            if (entry.klines.length >= minRequiredLength || entry.klines.length >= 30 || entry.isListingEnd) {
                return entry.klines;
            }
            if (minRequiredLength < 30 && entry.klines.length >= minRequiredLength) {
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
                    if (Array.isArray(cand) && cand.length > 0) {
                        if (cand.length >= minRequiredLength || cand.length >= 30 || (entry && entry.isListingEnd)) {
                            return cand;
                        }
                        if (minRequiredLength < 30 && cand.length >= minRequiredLength) {
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
    public async saveKlines(symbol: string, klines: any[], requestedLimit: number = 300): Promise<void> {
        if (!Array.isArray(klines) || klines.length < 2) return;
        const norm = this.normalizeSym(symbol);
        const timestamp = Date.now();
        // 🔒 只有在主动请求>=200天历史时，币安返回少于requestedLimit的币种才算真实上市不足的次新币
        const isListingEnd = requestedLimit >= 200 && klines.length < requestedLimit;

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
        klineMultiTfStore.saveKlines(symbol, '1d', klines);

        // 只有达到30根及以上完整K线才持久化存储到IndexedDB，杜绝10根片段污染数据库
        if (this.db && klines.length >= 30) {
            try {
                const tx = this.db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                store.put(entry);
            } catch (e) {
                console.warn('[KlineDailyStore] Failed to write entry to IndexedDB:', e);
            }
        }
    }

    /**
     * 极速本地切片读取：按需截取任意天数日K，0毫秒响应，0网络开销
     */
    public getDailyKlinesSliceSync(symbol: string, days: number = 300): any[] | null {
        const full = this.getCachedKlinesSync(symbol, Math.min(days, 30));
        if (!full || !Array.isArray(full) || full.length === 0) return null;
        if (full.length <= days) return full;
        return full.slice(-days);
    }

    /**
     * 判断币种是否有有效的日K缓存
     */
    public hasSymbolDailyKlines(symbol: string, minDays: number = 30): boolean {
        return this.getCachedKlinesSync(symbol, minDays) !== null;
    }

    /**
     * 🏛️ [24小时全量行情数据总线]: 实时推流保存与快照读取
     */
    public save24hTickers(tickers: any[]): void {
        if (!Array.isArray(tickers) || tickers.length === 0) return;
        const now = Date.now();
        const rawList: any[] = [];

        tickers.forEach(t => {
            if (!t || !t.symbol) return;
            const norm = this.normalizeSym(t.symbol);
            const existing = this.tickerMemoryMap.get(t.symbol) || this.tickerMemoryMap.get(norm);

            const incomingLastPrice = String(t.lastPrice || t.price || t.close || '0');
            const incomingOpenPrice = String(t.openPrice || t.open || '0');
            const incomingHighPrice = String(t.highPrice || t.high || '0');
            const incomingLowPrice = String(t.lowPrice || t.low || '0');
            const incomingVol = String(t.volume || '0');
            const incomingQuoteVol = String(t.quoteVolume || t.quoteAssetVolume || '0');
            const incomingChange = String(t.priceChangePercent || '0');

            // 🔒 [防暴跌归零防护]: 若推送的数据没有成交额或为0，但内存已存有真实成交额，坚决继承既有真实成交额，绝不篡改归零！
            const safeQuoteVol = (parseFloat(incomingQuoteVol) > 0 || !existing) ? incomingQuoteVol : existing.quoteVolume;
            const safeVol = (parseFloat(incomingVol) > 0 || !existing) ? incomingVol : existing.volume;
            const safeChange = (incomingChange !== '0' || !existing) ? incomingChange : existing.priceChangePercent;
            const safeLastPrice = (parseFloat(incomingLastPrice) > 0 || !existing) ? incomingLastPrice : existing.lastPrice;

            const entry: CachedTickerEntry = {
                symbol: t.symbol,
                lastPrice: safeLastPrice,
                openPrice: incomingOpenPrice !== '0' ? incomingOpenPrice : (existing?.openPrice || safeLastPrice),
                highPrice: incomingHighPrice !== '0' ? incomingHighPrice : (existing?.highPrice || safeLastPrice),
                lowPrice: incomingLowPrice !== '0' ? incomingLowPrice : (existing?.lowPrice || safeLastPrice),
                volume: safeVol,
                quoteVolume: safeQuoteVol,
                priceChangePercent: safeChange,
                timestamp: now
            };

            this.tickerMemoryMap.set(t.symbol, entry);
            this.tickerMemoryMap.set(norm, entry);
            this.pendingTickerSaves.push(entry);
            rawList.push(entry);
        });

        // 🔒 [1分钟滑动窗口自动熔断与垃圾回收]: 
        // 接收到广播传来的推送数据只保留1分钟，自动循环更新，1分钟以前的数据自动删除，防止撑死浏览器
        if (now - this.lastTickerPurgeTime > 15000) {
            this.lastTickerPurgeTime = now;
            for (const [key, entry] of Array.from(this.tickerMemoryMap.entries())) {
                if (now - entry.timestamp > 60000) {
                    this.tickerMemoryMap.delete(key);
                }
            }
        }

        // 🔒 [全量增量无缝防蒸发铁律]: 
        // 基于 tickerMemoryMap 保留 1 分钟内的有效行情，绝不无限堆积旧历史数据！
        const uniqueEntries = new Map<string, CachedTickerEntry>();
        this.tickerMemoryMap.forEach(v => {
            if (v && v.symbol && (now - v.timestamp <= 60000)) {
                uniqueEntries.set(v.symbol, v);
            }
        });
        this.rawTickersList = Array.from(uniqueEntries.values());

        // 防抖异步批量持久化至 IndexedDB (5秒防抖批处理，绝不阻塞主线程)
        if (this.db && !this.tickerSaveTimer) {
            this.tickerSaveTimer = setTimeout(() => {
                this.tickerSaveTimer = null;
                if (!this.db || this.pendingTickerSaves.length === 0) return;
                try {
                    // 仅保留每个币种最新一条记录，避免大量重复冗余写入 IndexedDB
                    const uniqueToSave = new Map<string, CachedTickerEntry>();
                    this.pendingTickerSaves.forEach(item => uniqueToSave.set(item.symbol, item));
                    this.pendingTickerSaves = [];
                    const curTime = Date.now();
                    const tx = this.db.transaction(STORE_TICKERS, 'readwrite');
                    const store = tx.objectStore(STORE_TICKERS);
                    uniqueToSave.forEach(item => {
                        if (curTime - item.timestamp < 60000) {
                            store.put(item);
                        } else {
                            store.delete(item.symbol);
                        }
                    });
                } catch (e) {
                    console.warn('[KlineDailyStore] Failed to persist 24h tickers to IndexedDB:', e);
                }
            }, 5000);
        }
    }

    /**
     * 本地 0ms 瞬间获取 24 小时全量币种行情快照 (供列表1秒级初筛)
     */
    public get24hTickersSync(): any[] {
        if (this.rawTickersList.length > 0) return this.rawTickersList;
        return Array.from(this.tickerMemoryMap.values());
    }

    /**
     * 本地 0ms 获取单个币种 24 小时实时行情
     */
    public get24hTickerSync(symbol: string): CachedTickerEntry | undefined {
        const norm = this.normalizeSym(symbol);
        return this.tickerMemoryMap.get(norm) || this.tickerMemoryMap.get(symbol);
    }

    /**
     * 🏛️ [初筛入选币 12 周期 300 根 K 线高速总线]: 存储与 IndexedDB 持久化
     */
    public saveShortlistMultiTfKlines(symbol: string, tf: string, rawKlines: any[]): void {
        if (!symbol || !tf || !Array.isArray(rawKlines) || rawKlines.length === 0) return;
        const norm = this.normalizeSym(symbol);
        const tfClean = tf.toLowerCase().trim();
        const key = `${norm}_${tfClean}`;
        const now = Date.now();

        // 规范为 UnifiedKline 格式并存入 klineMultiTfStore
        klineMultiTfStore.saveKlines(symbol, tfClean, rawKlines);

        const entry: CachedShortlistTfEntry = {
            key,
            symbol: norm,
            tf: tfClean,
            timestamp: now,
            klines: rawKlines,
            count: rawKlines.length
        };

        this.shortlistTfMemoryMap.set(key, entry);
        this.pendingShortlistSaves.push(entry);

        // 防抖异步持久化到 IndexedDB
        if (this.db && !this.shortlistSaveTimer) {
            this.shortlistSaveTimer = setTimeout(() => {
                this.shortlistSaveTimer = null;
                if (!this.db || this.pendingShortlistSaves.length === 0) return;
                try {
                    const uniqueMap = new Map<string, CachedShortlistTfEntry>();
                    this.pendingShortlistSaves.forEach(item => uniqueMap.set(item.key, item));
                    this.pendingShortlistSaves = [];
                    const toSave = Array.from(uniqueMap.values());
                    const tx = this.db.transaction(STORE_SHORTLIST_TF, 'readwrite');
                    const store = tx.objectStore(STORE_SHORTLIST_TF);
                    toSave.forEach(item => store.put(item));
                } catch (e) {
                    console.warn('[KlineDailyStore] Failed to persist shortlist klines to IndexedDB:', e);
                }
            }, 3000);
        }
    }

    /**
     * 0ms 本地读取初筛币特定周期的 300 根 K 线
     */
    public getShortlistKlineSync(symbol: string, tf: string, minLength: number = 20): any[] | null {
        // 先查 klineMultiTfStore
        const multi = klineMultiTfStore.getKlinesSync(symbol, tf, minLength);
        if (multi && multi.length >= minLength) return multi;

        const norm = this.normalizeSym(symbol);
        const key = `${norm}_${tf.toLowerCase().trim()}`;
        const entry = this.shortlistTfMemoryMap.get(key);
        if (entry && Array.isArray(entry.klines) && entry.klines.length >= minLength) {
            return entry.klines;
        }

        return null;
    }

    /**
     * 获取当前列表2激活的K线周期（杜绝盲目拉取全量12个周期）
     */
    public getActiveList2Timeframes(): string[] {
        if (typeof window !== 'undefined') {
            const winTfs = (window as any).SAVIOR_LIST2_ACTIVE_TIMEFRAMES;
            if (Array.isArray(winTfs) && winTfs.length > 0) return winTfs;
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k && k.startsWith('SCANNER_LIST2_CONFIG')) {
                        const parsed = JSON.parse(localStorage.getItem(k) || '{}');
                        if (Array.isArray(parsed?.timeframes) && parsed.timeframes.length > 0) {
                            return parsed.timeframes;
                        }
                    }
                }
            } catch (_) {}
        }
        return ['15m'];
    }

    /**
     * 批量自动拉取初筛币在列表2所选周期的 300 根基线 K 线 (仅针对初筛通过币种执行)
     */
    public async syncShortlistMultiTfKlines(
        symbols: string[],
        timeframes?: string[],
        limit: number = 300
    ): Promise<void> {
        const uniqueSymbols = Array.from(new Set(symbols.map(s => this.normalizeSym(s)).filter(Boolean)));
        if (uniqueSymbols.length === 0) return;

        // 严格锁定为列表2所选周期（以前是盲目拉取12个周期，现在仅根据列表2所需拉取）
        const targetTfs = (timeframes && timeframes.length > 0) ? timeframes : this.getActiveList2Timeframes();

        // 仅抓取未缓存或已陈旧的周期
        const tasks: { sym: string; tf: string }[] = [];
        for (const sym of uniqueSymbols) {
            for (const tf of targetTfs) {
                const existing = this.getShortlistKlineSync(sym, tf, 200);
                if (!existing || existing.length < 200) {
                    tasks.push({ sym, tf });
                }
            }
        }

        if (tasks.length === 0) return;

        // 4 并发轻量平滑拉取
        const BATCH_SIZE = 4;
        for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
            const batch = tasks.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async ({ sym, tf }) => {
                try {
                    const safeSym = sym.endsWith('USDT') ? sym : `${sym}USDT`;
                    let data: any = null;

                    // 若目标周期可以通过 5m 本地合成（如 10m, 15m, 30m, 60m/1h）且已有 5m 数据，则 0ms 本地瞬时合成
                    const targetMinutes = tf === '10m' ? 10 : tf === '15m' ? 15 : tf === '30m' ? 30 : (tf === '1h' || tf === '60m') ? 60 : 0;
                    if (targetMinutes > 0) {
                        const klines5m = this.getShortlistKlineSync(safeSym, '5m', 100);
                        if (klines5m && klines5m.length >= 100) {
                            const synth = KLineSynthesizer.synthesizeFrom5mRaw(klines5m, targetMinutes);
                            if (synth && synth.length >= 20) {
                                this.saveShortlistMultiTfKlines(safeSym, tf, synth);
                                return;
                            }
                        }
                    }

                    if (tf === '10m') {
                        // 基于 5m K线合成 10m
                        const klines5m = this.getShortlistKlineSync(safeSym, '5m', 100);
                        let source5m = klines5m;
                        if (!source5m || source5m.length < 100) {
                            const url5m = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSym}&interval=5m&limit=${limit * 2}&isScanner=true`;
                            try {
                                const res = await fetch(`/api/proxy?url=${encodeURIComponent(url5m)}&priority=normal`);
                                if (res.ok) source5m = await res.json();
                            } catch (_) {}
                            if (!Array.isArray(source5m) || source5m.length === 0) {
                                try {
                                    const res2 = await fetchWithFallback(url5m, { cache: "no-store", timeout: 4000, priority: 'NORMAL' }, (d) => Array.isArray(d));
                                    if (res2.ok) source5m = await res2.json();
                                } catch (_) {}
                            }
                            if (Array.isArray(source5m) && source5m.length > 0) {
                                this.saveShortlistMultiTfKlines(safeSym, '5m', source5m);
                            }
                        }

                        if (Array.isArray(source5m) && source5m.length > 0) {
                            const synth10m = KLineSynthesizer.synthesizeFrom5mRaw(source5m, 10);
                            if (synth10m.length > 0) {
                                this.saveShortlistMultiTfKlines(safeSym, '10m', synth10m);
                            }
                        }
                    } else {
                        const targetUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSym}&interval=${tf}&limit=${limit}&isScanner=true`;
                        try {
                            const res = await fetch(`/api/proxy?url=${encodeURIComponent(targetUrl)}&priority=normal`);
                            if (res.ok) data = await res.json();
                        } catch (_) {}

                        if (!Array.isArray(data) || data.length === 0) {
                            try {
                                const res2 = await fetchWithFallback(targetUrl, { cache: "no-store", timeout: 4000, priority: 'NORMAL' }, (d) => Array.isArray(d));
                                if (res2.ok) data = await res2.json();
                            } catch (_) {}
                        }

                        if (Array.isArray(data) && data.length > 0) {
                            this.saveShortlistMultiTfKlines(safeSym, tf, data);
                        }
                    }
                } catch (_) {}
            }));
            await new Promise(r => setTimeout(r, 40));
        }
    }

    /**
     * 🛡️ [退池即焚 (Purge on Eviction)]:
     * 当初筛币种淘汰或未再入选初筛时，立即从内存 Map 及 IndexedDB 中彻底焚毁其多周期 K 线缓存
     */
    public evictStaleCandidates(activeSymbols: string[]): void {
        if (!activeSymbols) return;
        const activeNormSet = new Set(
            activeSymbols.map(s => this.normalizeSym(s)).filter(Boolean)
        );

        const keysToDelete: string[] = [];
        const symbolsToEvict: string[] = [];

        for (const [key, entry] of this.shortlistTfMemoryMap.entries()) {
            const symNorm = this.normalizeSym(entry.symbol);
            if (!activeNormSet.has(symNorm)) {
                keysToDelete.push(key);
                symbolsToEvict.push(entry.symbol);
            }
        }

        for (const k of keysToDelete) {
            this.shortlistTfMemoryMap.delete(k);
        }

        // 同步通知 klineMultiTfStore 焚毁多周期缓存
        if (symbolsToEvict.length > 0) {
            klineMultiTfStore.evictSymbols(symbolsToEvict);
        }

        // 异步从 IndexedDB 中删除
        if (this.db && keysToDelete.length > 0) {
            try {
                const tx = this.db.transaction(STORE_SHORTLIST_TF, 'readwrite');
                const store = tx.objectStore(STORE_SHORTLIST_TF);
                keysToDelete.forEach(k => store.delete(k));
            } catch (_) {}
        }
    }

    /**
     * 获取当前常驻内存的币种总数
     */
    public getLoadedSymbolsCount(): number {
        return this.memoryMap.size;
    }

    /**
     * 获取数据总线同步运行状态
     */
    public getStoreStatus() {
        return {
            totalCached: this.memoryMap.size,
            isSyncing: this.isSyncingDaily,
            lastSyncTime: this.lastDailySyncTime,
            isDbReady: !!this.db
        };
    }

    /**
     * 全域中央日K线批次同步（统一单通道平滑拉取，杜绝多策略重复向币安发起并发请求）
     */
    public async syncAllDailyKlines(
        symbols: string[], 
        force = false,
        onProgress?: (curr: number, total: number) => void
    ): Promise<{ successful: number; total: number }> {
        if (this.isSyncingDaily) {
            return { successful: this.memoryMap.size, total: symbols.length };
        }

        const uniqueSymbols = Array.from(new Set(
            symbols.map(s => this.normalizeSym(s)).filter(Boolean)
        ));

        if (uniqueSymbols.length === 0) {
            return { successful: 0, total: 0 };
        }

        this.isSyncingDaily = true;
        let successful = 0;
        const total = uniqueSymbols.length;

        try {
            // 先筛选出确实需要从网络拉取的币种（内存已有且未过期的直接复用）
            const symbolsToFetch: string[] = [];
            const now = Date.now();

            for (const sym of uniqueSymbols) {
                const existing = this.memoryMap.get(sym);
                const hasValid = existing && (now - existing.timestamp < CACHE_VALIDITY_1D) && (existing.klines.length >= 200 || (existing.isListingEnd && existing.klines.length >= 30));
                if (hasValid && !force) {
                    successful++;
                } else {
                    symbolsToFetch.push(sym);
                }
            }

            if (symbolsToFetch.length > 0) {
                console.log(`[KlineDailyStore] 中央日K数据总线启动同步: ${symbolsToFetch.length}/${total} 个币种需网络拉取，其余已直接命中内存缓存...`);
                
                // 采用温和批次请求 (每批 4 个，间隔 40ms，确保 API 权重安全)
                const BATCH_SIZE = 4;
                for (let i = 0; i < symbolsToFetch.length; i += BATCH_SIZE) {
                    const batch = symbolsToFetch.slice(i, i + BATCH_SIZE);
                    await Promise.all(batch.map(async (sym) => {
                        try {
                            const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1d&limit=320&isScanner=true`;
                            const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}&priority=normal`);
                            if (res.ok) {
                                const data = await res.json();
                                if (Array.isArray(data) && data.length >= 2) {
                                    await this.saveKlines(sym, data, 300);
                                    successful++;
                                }
                            }
                        } catch (_) {
                            // 失败静默，不中断整体批次
                        }
                    }));

                    if (onProgress) {
                        onProgress(successful, total);
                    }
                    await new Promise(r => setTimeout(r, 40));
                }
            }

            this.lastDailySyncTime = Date.now();
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('CENTRAL_DAILY_KLINES_UPDATED', {
                    detail: { totalCached: this.memoryMap.size, timestamp: this.lastDailySyncTime }
                }));
            }
            console.log(`[KlineDailyStore] 中央日K数据总线同步完成！内存常驻币种: ${this.memoryMap.size}/${total}`);
        } catch (err) {
            console.warn('[KlineDailyStore] syncAllDailyKlines error:', err);
        } finally {
            this.isSyncingDaily = false;
        }

        return { successful, total };
    }

    /**
     * 每日早 8:00 (UTC+8 / 日K收盘) 自动增量守护器
     */
    private startDaily8AmScheduler() {
        if (typeof window === 'undefined') return;
        if (this.dailyScheduleTimer) clearInterval(this.dailyScheduleTimer);

        let lastCheckedDay = new Date().getDate();

        this.dailyScheduleTimer = setInterval(() => {
            try {
                const now = new Date();
                const currentDay = now.getDate();
                const currentHour = now.getHours(); // 本地小时

                // 每天只在达到或跨越早 8:00 时触发一次
                if (currentDay !== lastCheckedDay && currentHour >= 8) {
                    lastCheckedDay = currentDay;
                    console.log('[KlineDailyStore] 每日早 8:00 日K收盘时间到达，中央总线启动静默增量刷新...');
                    const allKeys = Array.from(this.memoryMap.keys());
                    if (allKeys.length > 0) {
                        this.syncAllDailyKlines(allKeys, true);
                    }
                }
            } catch (_) {}
        }, 60000); // 每分钟检查一次
    }
}

export const klineDailyStore = new KlineDailyStore();
if (typeof window !== 'undefined') {
    (window as any).klineDailyStore = klineDailyStore;
}
