/**
 * 早上8点起（北京时间 08:00:00 起至当前时刻）交易额与涨跌幅服务
 * 
 * 核心原理：
 * 1. 币安日线（1d K线）固定在每日 00:00:00 UTC（即北京时间 08:00:00）开盘；
 * 2. 正在运行的 1d K线即代表【从今天早上8点到当前时刻】的实时行情；
 * 3. K线 index 7 (quoteAssetVolume) 是以 USDT 计价的累计交易额，除以 1,000,000 即为百万 (M) USDT 交易额；
 * 4. K线 index 1 (openPrice) 是早上8点的开盘价，最新价相比开盘价即为【早上8点起涨跌幅】。
 */

export interface Volume8amItem {
    symbol: string;
    volume8am: number;    // 百万 USDT (M)
    change8am: number;    // 百分比 (%)
    openPrice: number;    // 早上8点开盘价
    highPrice: number;    // 早上8点以来最高价
    lowPrice: number;     // 早上8点以来最低价
    lastPrice: number;    // 当前最新价
    openTime: number;     // 早上8点对应毫秒时间戳
    updatedAt: number;    // 本地缓存时间
}

const CACHE_STORAGE_KEY = 'SCANNER_8AM_FUTURES_CACHE_V2';
const memoryCache = new Map<string, Volume8amItem>();
let isInitialized = false;

// 初始化从本地存储读取
function initCache() {
    if (isInitialized) return;
    isInitialized = true;
    try {
        // 清理旧的现货缓存
        localStorage.removeItem('SCANNER_8AM_CACHE');
        const saved = localStorage.getItem(CACHE_STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && typeof parsed === 'object') {
                Object.keys(parsed).forEach(sym => {
                    const item = parsed[sym];
                    if (item && item.symbol && typeof item.volume8am === 'number') {
                        memoryCache.set(sym, item);
                    }
                });
            }
        }
    } catch (_) {}
}

// 写入本地存储 (防抖)
let saveTimer: any = null;
function persistCache() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        try {
            const obj: Record<string, Volume8amItem> = {};
            memoryCache.forEach((v, k) => {
                obj[k] = v;
            });
            localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(obj));
        } catch (_) {}
    }, 2000);
}

/**
 * 获取指定币种从早上8点起的缓存数据
 */
export function getVolume8am(symbol: string): Volume8amItem | undefined {
    initCache();
    return memoryCache.get(symbol);
}

/**
 * 获取全部已有早上8点起的数据
 */
export function getAllVolume8am(): Map<string, Volume8amItem> {
    initCache();
    return new Map(memoryCache);
}

/**
 * 判断指定时间戳是否属于“今天”早上8点开始的日K线
 */
export function isCurrentTradingDay(openTimeMs: number): boolean {
    if (!openTimeMs || openTimeMs <= 0) return false;
    const now = new Date();
    // 今天的 00:00:00 UTC（对应北京时间 08:00:00）
    const today00Utc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
    // 只要属于当前的 UTC 天即可
    return openTimeMs >= today00Utc;
}

let isBatchFetching = false;
const activeFetchSymbols = new Set<string>();

/**
 * 并发分批拉取指定币种的 1d K线，获取【北京时间早上8点到当前】的真实交易额和涨跌幅
 */
export async function fetchVolume8amBatch(
    symbols: string[], 
    forceRefresh: boolean = false
): Promise<Map<string, Volume8amItem>> {
    initCache();
    if (!Array.isArray(symbols) || symbols.length === 0) return memoryCache;

    const nowTime = Date.now();
    const CACHE_VALID_MS = 10 * 60 * 1000; // 10分钟内缓存有效，彻底阻断高频重复穿透

    // 过滤出需要更新的币种 (优先处理前40个活跃币种，杜绝全域300+币种瞬时并发轰炸)
    const targets = symbols.filter(sym => {
        if (!sym || !sym.endsWith('USDT')) return false;
        if (activeFetchSymbols.has(sym)) return false;
        if (forceRefresh) return true;
        const cached = memoryCache.get(sym);
        if (!cached) return true;
        if (nowTime - cached.updatedAt > CACHE_VALID_MS) return true;
        if (!isCurrentTradingDay(cached.openTime)) return true;
        return false;
    }).slice(0, 40);

    if (targets.length === 0) {
        return memoryCache;
    }

    targets.forEach(s => activeFetchSymbols.add(s));
    isBatchFetching = true;

    // 分批平稳并发处理 (每批 4 个请求，契合浏览器连接池且绝不引发主线程卡顿或崩溃)
    const BATCH_SIZE = 4;
    let hasUpdates = false;

    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
        const batch = targets.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (symbol) => {
            try {
                const targetUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=1`;
                let klines: any = null;

                // 优先使用后端 /api/proxy
                try {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), 3500);
                    const res = await fetch(`/api/proxy?url=${encodeURIComponent(targetUrl)}&priority=high`, {
                        signal: controller.signal
                    });
                    clearTimeout(timer);
                    if (res.ok) {
                        klines = await res.json();
                    }
                } catch (_) {}

                // 后端失败时直连币安兜底
                if (!Array.isArray(klines) || klines.length === 0) {
                    try {
                        const controller2 = new AbortController();
                        const timer2 = setTimeout(() => controller2.abort(), 3000);
                        const res2 = await fetch(targetUrl, { signal: controller2.signal });
                        clearTimeout(timer2);
                        if (res2.ok) {
                            klines = await res2.json();
                        }
                    } catch (_) {}
                }

                if (Array.isArray(klines) && klines.length > 0) {
                    const k = klines[0];
                    const openTime = Number(k[0]) || 0;
                    const openPrice = parseFloat(k[1]) || 0;
                    const highPrice = parseFloat(k[2]) || 0;
                    const lowPrice = parseFloat(k[3]) || 0;
                    const lastPrice = parseFloat(k[4]) || 0;
                    // kline index 7 为 USDT 计价累计成交额
                    const quoteVolumeUSDT = parseFloat(k[7]) || 0;
                    const volume8am = +(quoteVolumeUSDT / 1000000).toFixed(2);
                    const change8am = openPrice > 0 ? +(((lastPrice - openPrice) / openPrice) * 100).toFixed(2) : 0;

                    const item: Volume8amItem = {
                        symbol,
                        volume8am,
                        change8am,
                        openPrice,
                        highPrice,
                        lowPrice,
                        lastPrice,
                        openTime,
                        updatedAt: Date.now()
                    };

                    memoryCache.set(symbol, item);
                    hasUpdates = true;
                }
            } catch (err) {
                // 单币拉取失败不影响整体
            } finally {
                activeFetchSymbols.delete(symbol);
            }
        }));

        // 微小让渡保证 UI 不卡顿
        if (i + BATCH_SIZE < targets.length) {
            await new Promise(r => setTimeout(r, 40));
        }
    }

    isBatchFetching = false;

    if (hasUpdates) {
        persistCache();
        try {
            window.dispatchEvent(new CustomEvent('scanner_8am_cache_updated', {
                detail: { timestamp: Date.now() }
            }));
        } catch (_) {}
    }

    return memoryCache;
}

/**
 * 🔒 LOCKED_MODULE: 列表1 [配置A 常规模式 - 交易额范围过滤规则与独立开关判定]
 * 包含 24H 交易额区间校验、早上8点起交易额独立开关门禁校验、0 与 999999+ 无上限识别。
 * 未获用户直接指令严禁擅自修改！
 * 
 * 统一的交易额刚性过滤判定器
 * 严格遵从规则：
 * 1. 24H 交易额：只要大于设定值，或在设定值范围内即可，后面为 0 是无上限；
 * 2. 早上8点起交易额：从北京时间早上8点到当前的累计交易额，大于设定值或在设定值范围即可，后面为 0 是无上限；
 * 3. 绝不将 24H 交易额错误当作早上8点交易额！
 */
export function checkVolumeRule(
    item: { symbol: string; volume24h?: number; volume8am?: number; volume?: number | string },
    config: {
        enableVol24h?: boolean;
        minVolume?: number;
        maxVolume?: number;
        enableVol8am?: boolean;
        minVolume8am?: number;
        maxVolume8am?: number;
        timeBasis?: string;
    }
): boolean {
    if (!item) return false;

    // 1. 24H 交易额校验
    const enable24h = config.enableVol24h !== false;
    if (enable24h) {
        let min24h = Number(config.minVolume) || 0;
        let max24h = Number(config.maxVolume) || 0;

        // 防呆换算：若用户输入为原始 USDT (如输入 50000000 即 50M)，自动安全换算为 M；若输入 999999+ (如9999999) 意为无上限，直接视为 0 (不设上限)
        if (min24h >= 100000) min24h = +(min24h / 1000000).toFixed(2);
        if (max24h >= 999999) {
            max24h = 0; // 视为无上限
        } else if (max24h >= 100000) {
            max24h = +(max24h / 1000000).toFixed(2);
        }

        // 防呆容错：若最大值非零且小于最小值 (如 min=50, max=10)，属于无效倒挂区间，最大值自动视为无上限 (0)
        const effectiveMax24h = (max24h > 0 && min24h > 0 && max24h <= min24h) ? 0 : max24h;

        // 全面提取 24H 交易额 (支持 volume24h / quoteVolume / volume / q)
        let vol24h = 0;
        if (item.volume24h !== undefined && !isNaN(Number(item.volume24h))) {
            vol24h = Number(item.volume24h);
        } else if ((item as any).quoteVolume !== undefined && !isNaN(Number((item as any).quoteVolume))) {
            const raw = Number((item as any).quoteVolume);
            vol24h = raw > 10000 ? +(raw / 1000000).toFixed(2) : (raw > 0 ? raw : 0);
        } else if (item.volume !== undefined && !isNaN(Number(item.volume))) {
            const raw = Number(item.volume);
            vol24h = raw > 10000 ? +(raw / 1000000).toFixed(2) : (raw > 0 ? raw : 0);
        } else if ((item as any).q !== undefined && !isNaN(Number((item as any).q))) {
            const raw = Number((item as any).q);
            vol24h = raw > 10000 ? +(raw / 1000000).toFixed(2) : (raw > 0 ? raw : 0);
        }

        // 最小交易额校验（大于或等于设定值）
        if (min24h > 0 && vol24h < min24h) {
            return false;
        }
        // 最大交易额校验（后面为0是无上限）
        if (effectiveMax24h > 0 && vol24h > effectiveMax24h) {
            return false;
        }
    }

    // 2. 早上8点起交易额校验 (北京时间 08:00:00 至今)
    // 🔒 修复独立判定：严格由独立开关 enableVol8am 决定，绝不因 timeBasis === '8AM' 强行越界开启
    const enable8am = Boolean(config.enableVol8am);
    if (enable8am) {
        let min8am = Number(config.minVolume8am !== undefined ? config.minVolume8am : 0) || 0;
        let max8am = Number(config.maxVolume8am !== undefined ? config.maxVolume8am : 0) || 0;

        if (min8am >= 100000) min8am = +(min8am / 1000000).toFixed(2);
        if (max8am >= 999999) {
            max8am = 0; // 视为无上限
        } else if (max8am >= 100000) {
            max8am = +(max8am / 1000000).toFixed(2);
        }

        const effectiveMax8am = (max8am > 0 && min8am > 0 && max8am <= min8am) ? 0 : max8am;

        // 获取真实的 8AM 数据（绝不回退至 24H 交易额）
        let vol8am: number | undefined = undefined;
        if (item.volume8am !== undefined && !isNaN(Number(item.volume8am))) {
            vol8am = Number(item.volume8am);
        } else {
            const cached = getVolume8am(item.symbol);
            if (cached && typeof cached.volume8am === 'number') {
                vol8am = cached.volume8am;
            }
        }

        // 如果已获取到早上8点的真实交易额，进行严格范围比对
        if (vol8am !== undefined && !isNaN(vol8am)) {
            // 最小交易额校验
            if (min8am > 0 && vol8am < min8am) {
                return false;
            }
            // 最大交易额校验（后面为0是无上限）
            if (effectiveMax8am > 0 && vol8am > effectiveMax8am) {
                return false;
            }
        }
    }

    return true;
}

