/**
 * 🔒 LOCKED_MODULE: 网络请求限速与并发控制总引擎 (`services/apiService.ts`)
 * 全局并发信号量 (Max 4)、令牌桶限速 (350ms pacing)、LRU 缓存、Inflight 去重与重试退避。
 * 绝对固化锁定，无指令严禁触碰修改！
 */

import { binanceRateLimiter } from './binanceRateLimiter';

let lastSuccessfulProxy: string | null = null;
let continuousFailures = 0;
let circuitBreakerUntil = 0;

// === 模拟运行模式开关与拦截逻辑 ===
let isSimulationMode = false; // 默认实盘运行

export function setSimulationMode(enabled: boolean) {
    isSimulationMode = enabled;
    console.log(`[Mode Switch] 当前运行模式: ${enabled ? '模拟运行 (Simulation - 零外网/零API)' : '实盘运行 (Live Trading - 正常连接)'}`);
}

export function getSimulationMode(): boolean {
    return isSimulationMode;
}

export const sanitizeSymbol = (symbol: string): string => {
    if (!symbol || typeof symbol !== 'string') return '';
    let clean = symbol.toUpperCase().trim();
    const usdtIdx = clean.indexOf('USDT');
    if (usdtIdx !== -1) {
        clean = clean.substring(0, usdtIdx + 4);
    }
    clean = clean.replace(/[^A-Z0-9]/g, '');
    return clean;
};

function isTradingEndpoint(url: string): boolean {
    return url.includes('/fapi/') ||
           url.includes('/api/proxy/fapi') ||
           url.includes('/order') ||
           url.includes('/account') ||
           url.includes('/positionRisk') ||
           url.includes('/klines') ||
           url.includes('/ticker/');
}

function getMockResponse(url: string, options: any): Response {
    let payload: any;
    if (url.includes('/order')) {
        payload = {
            orderId: Date.now(),
            status: 'NEW',
            clientOrderId: 'sim_mock_' + Date.now(),
            price: '0',
            origQty: '1',
            executedQty: '0',
            cumQuote: '0',
            time: Date.now(),
            simulated: true
        };
    } else if (url.includes('/account')) {
        payload = {
            totalWalletBalance: "10000.00",
            totalUnrealizedProfit: "0.00",
            totalMarginBalance: "10000.00",
            availableBalance: "10000.00",
            simulated: true
        };
    } else if (url.includes('/positionRisk')) {
        payload = [];
    } else if (url.includes('/klines')) {
        const now = Date.now();
        const bars = [];
        let price = 50000;
        for (let i = 50; i >= 0; i--) {
            const time = now - i * 60000;
            const open = price;
            const high = price * 1.005;
            const low = price * 0.995;
            const close = price * (1 + (Math.random() - 0.49) * 0.01);
            price = close;
            bars.push([
                time,
                open.toFixed(2),
                high.toFixed(2),
                low.toFixed(2),
                close.toFixed(2),
                "100.5",
                time + 59999,
                "5000000",
                100,
                "50",
                "2500000",
                "0"
            ]);
        }
        payload = bars;
    } else if (url.includes('ticker/price')) {
        payload = { symbol: "BTCUSDT", price: "68000.00" };
    } else if (url.includes('ticker/24hr')) {
        payload = {
            symbol: "BTCUSDT",
            priceChange: "1500.00",
            priceChangePercent: "2.25",
            lastPrice: "68000.00",
            highPrice: "69000.00",
            lowPrice: "66500.00",
            volume: "45000",
            quoteVolume: "3000000000"
        };
    } else {
        payload = { success: true, simulated: true, data: [] };
    }
    return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Simulation': 'TRUE' }
    });
}

// --- GLOBAL CONCURRENCY LOCK (Semaphore) ---
// Bounded concurrency limit restricted to max 4 concurrent requests to prevent net::ERR_INSUFFICIENT_RESOURCES socket exhaustion
const MAX_CONCURRENT = 4;
let activeRequests = 0;

interface QueueItem {
    resolve: () => void;
    priority: 'HIGH' | 'NORMAL' | 'LOW';
}
const requestQueue: QueueItem[] = [];

const acquireSlot = async (priority: 'HIGH' | 'NORMAL' | 'LOW' = 'NORMAL') => {
    // High priority requests can always acquire immediate capacity
    if (priority === 'HIGH' || activeRequests < MAX_CONCURRENT) {
        activeRequests++;
        return;
    }
    return new Promise<void>(resolve => {
        const item = { resolve, priority };
        if (priority === 'NORMAL') {
            // Insert after any existing high priority items
            let insertIdx = 0;
            while (insertIdx < requestQueue.length && requestQueue[insertIdx].priority === 'HIGH') {
                insertIdx++;
            }
            requestQueue.splice(insertIdx, 0, item);
        } else {
            requestQueue.push(item);
        }
    });
};

const releaseSlot = () => {
    if (requestQueue.length > 0) {
        const next = requestQueue.shift();
        next?.resolve();
    } else {
        activeRequests--;
    }
};

// --- GLOBAL TOKEN BUCKET & RATE LIMITER ---
// Enforce max ~2.8 requests per second (minimum 350ms pacing between outgoing HTTP requests) to eliminate HTTP 429 Too Many Requests
const MIN_REQUEST_INTERVAL_MS = 350;
let lastRequestTimestamp = 0;
const rateLimitQueue: (() => void)[] = [];
let isRateLimitProcessing = false;

const acquireRateLimitSlot = async (priority: 'HIGH' | 'NORMAL' | 'LOW' = 'NORMAL') => {
    return new Promise<void>(resolve => {
        if (priority === 'HIGH') {
            rateLimitQueue.unshift(resolve);
        } else {
            rateLimitQueue.push(resolve);
        }
        processRateLimitQueue();
    });
};

const processRateLimitQueue = () => {
    if (isRateLimitProcessing || rateLimitQueue.length === 0) return;
    isRateLimitProcessing = true;

    const now = Date.now();
    const elapsed = now - lastRequestTimestamp;
    const delay = Math.max(0, MIN_REQUEST_INTERVAL_MS - elapsed);

    setTimeout(() => {
        lastRequestTimestamp = Date.now();
        const next = rateLimitQueue.shift();
        isRateLimitProcessing = false;
        if (next) next();
        if (rateLimitQueue.length > 0) {
            processRateLimitQueue();
        }
    }, delay);
};

// --- ERROR TRACKING ---
const blacklistedProxies = new Set<string>();
let lastBlacklistReset = Date.now();

/**
 * Robust fetcher with multiple fallbacks for CORS/Network restrictions.
 * Strategy: Direct Connection -> Stable Proxies -> High Speed Proxies -> Backup
 */
interface CacheEntry {
    data: any;
    timestamp: number;
    ttl: number;
}

const MAX_CLIENT_CACHE_ENTRIES = 200;
const clientSideCache = new Map<string, CacheEntry>();
const inflightRequests = new Map<string, Promise<any>>();

export const clearClientSideCache = () => {
    clientSideCache.clear();
    inflightRequests.clear();
};

export const getProxyUrl = (targetUrl: string, priority?: string): string => {
    const encoded = encodeURIComponent(targetUrl);
    const isFileProtocol = typeof window !== 'undefined' && window.location && (window.location.protocol === 'file:' || !window.location.origin.startsWith('http'));
    const base = isFileProtocol ? 'http://127.0.0.1:3000/api/proxy' : '/api/proxy';
    return `${base}?url=${encoded}${priority === 'high' ? '&priority=high' : ''}`;
};

const setWithLruCap = (key: string, entry: CacheEntry) => {
    // Evict expired entries or oldest entry if over capacity
    const now = Date.now();
    if (clientSideCache.size >= MAX_CLIENT_CACHE_ENTRIES) {
        for (const [k, v] of clientSideCache.entries()) {
            if (now - v.timestamp >= v.ttl || clientSideCache.size >= MAX_CLIENT_CACHE_ENTRIES) {
                clientSideCache.delete(k);
            }
        }
    }
    clientSideCache.set(key, entry);
};

const normalizeUrlForCache = (urlStr: string): string => {
    try {
        const urlObj = new URL(urlStr, typeof window !== 'undefined' ? window.location.origin : undefined);
        urlObj.searchParams.delete('_t');
        urlObj.searchParams.delete('cb');
        return urlObj.toString();
    } catch (e) {
        return urlStr;
    }
};

const getCacheTTL = (url: string): number => {
    if (url.includes('interval=1d') || url.includes('interval=1w') || url.includes('interval=1M')) {
        return 300000; // 5 minutes for daily/weekly/monthly klines
    }
    if (url.includes('/klines')) {
        return 15000; // 15 seconds for shorter klines (1m, 15m, etc.)
    }
    if (url.includes('ticker/price')) {
        return 2000; // 2 seconds for ticker price
    }
    if (url.includes('ticker/24hr')) {
        return 10000; // 10 seconds for 24h ticker info
    }
    return 5000; // 5 seconds default
};

export const fetchWithFallback = async (
    rawUrl: string, 
    options?: Omit<RequestInit, 'priority'> & { timeout?: number, priority?: 'HIGH' | 'NORMAL' | 'LOW' }, 
    validator?: (data: any) => boolean, 
    directMode: boolean = false
): Promise<Response> => {
    
    // 🛡️ URL Normalization & Symbol Sanitization
    let url = rawUrl;
    if (url && typeof url === 'string') {
        if (url.startsWith('/fapi/')) {
            url = `https://fapi.binance.com${url}`;
        } else if (url.startsWith('/api/') && !url.startsWith('/api/proxy')) {
            url = `https://api.binance.com${url}`;
        }

        // Clean malformed symbols in query parameters (e.g. LTCUSDTLTONGUSDT -> LTCUSDT)
        try {
            const urlObj = new URL(url, typeof window !== 'undefined' ? window.location.origin : undefined);
            const sym = urlObj.searchParams.get('symbol');
            if (sym) {
                const cleanedSym = sanitizeSymbol(sym);
                if (cleanedSym && cleanedSym !== sym) {
                    urlObj.searchParams.set('symbol', cleanedSym);
                    url = urlObj.toString();
                }
            }
        } catch (e) {}
    }

    // 【铁律】如果是模拟运行，且属于交易/账户敏感接口，直接本地 Mock 拦截，绝不外发请求！
    if (isSimulationMode && isTradingEndpoint(url)) {
        console.warn(`[Simulation Bypass] 模拟模式拦截真实外网请求: ${url}`);
        return getMockResponse(url, options);
    }

    // GUARD: Internet connectivity check
    if (typeof window !== 'undefined' && window.navigator && window.navigator.onLine === false) {
        throw new Error("Network is offline. Fetch aborted.");
    }
    
    // GUARD: Never fetch empty/malformed symbols
    if (url.includes('symbol=USDT&') || url.includes('symbol=&') || url.endsWith('symbol=USDT') || url.endsWith('symbol=')) {
        return new Response(JSON.stringify([]), { status: 200 }); // Return empty array to avoid unhandled rejections
    }

    // GUARD: Handle mock/custom/simulation symbols directly with zero network footprint
    let symbolParam = '';
    try {
        const urlObj = new URL(url, typeof window !== 'undefined' ? window.location.origin : undefined);
        symbolParam = urlObj.searchParams.get("symbol") || "";
    } catch(e) {}
    
    if (symbolParam) {
        const upperSymbol = symbolParam.toUpperCase();
        if (upperSymbol.includes('MOCK') || upperSymbol.includes('TEST') || upperSymbol.includes('FAKE')) {
            // It is a mock/simulation symbol!
            if (url.includes('ticker/price')) {
                let hash = 0;
                for (let i = 0; i < symbolParam.length; i++) {
                    hash = symbolParam.charCodeAt(i) + ((hash << 5) - hash);
                }
                const seed = Math.abs(hash);
                const price = 10 + (seed % 90) + (seed % 100) / 100;
                return new Response(JSON.stringify({ symbol: symbolParam, price: price.toString() }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            if (url.includes('ticker/24hr') || url.includes('premiumIndex')) {
                let hash = 0;
                for (let i = 0; i < symbolParam.length; i++) {
                    hash = symbolParam.charCodeAt(i) + ((hash << 5) - hash);
                }
                const seed = Math.abs(hash);
                const price = 10 + (seed % 90) + (seed % 100) / 100;
                return new Response(JSON.stringify({
                    symbol: symbolParam,
                    priceChange: "0.15",
                    priceChangePercent: "1.50",
                    weightedAvgPrice: price.toString(),
                    lastPrice: price.toString(),
                    lastQty: "1",
                    openPrice: (price * 0.985).toString(),
                    highPrice: (price * 1.02).toString(),
                    lowPrice: (price * 0.97).toString(),
                    volume: "5000000",
                    quoteVolume: (5000000 * price).toString(),
                    openTime: Date.now() - 86400000,
                    closeTime: Date.now(),
                    firstId: 1,
                    lastId: 100,
                    count: 100,
                    markPrice: price.toString(),
                    indexPrice: price.toString(),
                    estimatedSettlePrice: price.toString(),
                    lastFundingRate: "0.000100",
                    interestRate: "0.000300",
                    nextFundingTime: Date.now() + 4 * 3600 * 1000
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }
    }

    // CLIENT CACHE HIT
    const cacheKey = normalizeUrlForCache(url);
    const cached = clientSideCache.get(cacheKey);
    const now = Date.now();
    if (cached && (now - cached.timestamp < cached.ttl)) {
        if (!validator || validator(cached.data)) {
            return new Response(JSON.stringify(cached.data), {
                status: 200,
                headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' }
            });
        } else {
            // Invalidate corrupted/invalid cache entry
            clientSideCache.delete(cacheKey);
        }
    }

    // CLIENT INFLIGHT DEDUPLICATION (Thundering Herd Protection)
    let inflight = inflightRequests.get(cacheKey);
    if (inflight) {
        try {
            const data = await inflight;
            return new Response(JSON.stringify(data), {
                status: 200,
                headers: { 'Content-Type': 'application/json', 'X-Cache': 'DEDUPLICATED' }
            });
        } catch (err) {
            // Fallback: If inflight request failed, we attempt to fetch ourselves
        }
    }

    // Wrap the inner fetch and response cloning/parsing in a promise
    const fetchPromise = (async () => {
        const response = await _fetchWithFallbackInner(url, options, validator, directMode);
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }
        const text = await response.text();
        const parsed = JSON.parse(text);
        
        // Cache successful responses
        const ttl = getCacheTTL(url);
        setWithLruCap(cacheKey, {
            data: parsed,
            timestamp: Date.now(),
            ttl
        });
        
        return parsed;
    })();

    inflightRequests.set(cacheKey, fetchPromise);

    try {
        const data = await fetchPromise;
        return new Response(JSON.stringify(data), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err: any) {
        // 🛡️ Stale Cache Fallback: If network fails or receives HTML/error, serve stale cache if available
        const staleCached = clientSideCache.get(cacheKey);
        if (staleCached && (!validator || validator(staleCached.data))) {
            console.warn(`[API] Network error (${err?.message || err}), serving stale cache for ${url}`);
            return new Response(JSON.stringify(staleCached.data), {
                status: 200,
                headers: { 'Content-Type': 'application/json', 'X-Cache': 'STALE_FALLBACK' }
            });
        }
        throw err;
    } finally {
        inflightRequests.delete(cacheKey);
    }
};

const _fetchWithFallbackInner = async (
    url: string, 
    options?: Omit<RequestInit, 'priority'> & { timeout?: number, priority?: 'HIGH' | 'NORMAL' | 'LOW' }, 
    validator?: (data: any) => boolean, 
    directMode: boolean = false
): Promise<Response> => {
    
    // GUARD: Internet connectivity check
    if (typeof window !== 'undefined' && window.navigator && window.navigator.onLine === false) {
        throw new Error("Network is offline. Fetch aborted.");
    }
    
    // GUARD: Never fetch empty/malformed symbols
    if (url.includes('symbol=USDT&') || url.includes('symbol=&') || url.endsWith('symbol=USDT') || url.endsWith('symbol=')) {
        return new Response(JSON.stringify([]), { status: 200 }); // Return empty array to avoid unhandled rejections
    }

    // 🛡️ [全局熔断器出站门禁]: 若处于 429/418 静默期，立即抛出本地异常，绝不在网络层发包！
    const isCoreOrder = Boolean((options as any)?.isCoreOrder) ||
        url.includes('/order') || 
        url.includes('/batchOrders') || 
        url.includes('/leverage') || 
        url.includes('/marginType') || 
        url.includes('/positionSide') || 
        url.includes('/listenKey') || 
        url.includes('/time');
    binanceRateLimiter.checkCanRequest(isCoreOrder);

    // 1. Enter Token Bucket Rate Limiter & Concurrency Queue
    const isKlinePayload = url.includes('/klines');
    const isHeavyPayload = url.includes('ticker/24hr') || url.includes('ticker/price');
    const priority = options?.priority || (url.includes('ticker/24hr') || isKlinePayload ? 'HIGH' : 'NORMAL');
    
    await acquireRateLimitSlot(priority);
    const isHighPriority = priority === 'HIGH';
    if (!isHighPriority) {
        await acquireSlot(priority);
    }
    
    try {
        // Increase timeout appropriately for payloads
        const TIMEOUT_MS = options?.timeout || (isHeavyPayload || isKlinePayload ? 30000 : 15000); 

        // Always keep valid canonical URL
        const currentUrl = url;
        const encodedUrl = encodeURIComponent(currentUrl);

        // 1. Direct Mode Bypass
        if (directMode) {
            let timeoutId: any;
            try {
                const controller = new AbortController();
                timeoutId = setTimeout(() => {
                    console.warn(`[API] Direct fetch timed out for ${url}`);
                    try {
                        controller.abort(new DOMException("Direct fetch timed out", "TimeoutError"));
                    } catch (e) {
                        controller.abort();
                    }
                }, TIMEOUT_MS);
                const { timeout, priority: customPriority, ...restOptions } = options || {};
                
                console.log(`[API] Calling fetch directly for ${url}`);
                let res = await fetch(url, {
                    ...restOptions,
                    signal: controller.signal
                });
                
                // Retry once on 429 Too Many Requests
                if (res.status === 429) {
                    console.warn(`[API] Rate limit hit (429) for ${url}. Retrying in 3 seconds...`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    res = await fetch(url, {
                        ...restOptions,
                        signal: controller.signal
                    });
                }
                
                if (!res.ok) throw new Error(`Direct fetch failed: ${res.status}`);
                
                const textData = await res.text();
                let data: any;
                try {
                    data = JSON.parse(textData);
                } catch (jsonErr) {
                    throw new Error(`Invalid JSON from direct fetch`);
                }
                
                if (validator && !validator(data)) {
                    if (data.code && data.msg) {
                        throw new Error(`Binance Error: [${data.code}] ${data.msg}`);
                    }
                    throw new Error(`Validation failed for direct fetch`);
                }
                
                return new Response(JSON.stringify(data), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (e: any) {
                console.warn(`[API] 直连模式失败 (Direct Failed), falling back to proxies: ${e.message || e}`);
            } finally {
                clearTimeout(timeoutId);
            }
        }

        // Proxy List Strategy: Always prioritize the high-performance local server proxy (/api/proxy)
        const proxyLocalServer = getProxyUrl(currentUrl, priority);
        let proxies: string[] = [proxyLocalServer];

        const fetchProxy = async (proxyUrl: string): Promise<Response> => {
            let hostname = '';
            try {
                hostname = new URL(proxyUrl).hostname;
            } catch (e) {}

            if (blacklistedProxies.has(hostname) && hostname !== 'localhost' && !hostname.startsWith('127.0.0.1') && !hostname.includes('binance')) {
                if (Date.now() - lastBlacklistReset > 300000) {
                    blacklistedProxies.clear();
                    lastBlacklistReset = Date.now();
                } else {
                    throw new Error(`Proxy ${hostname} is blacklisted`);
                }
            }

            let timeoutId: any;
            try {
                const controller = new AbortController();
                if (options?.signal) {
                    if (options.signal.aborted) {
                        controller.abort();
                    } else {
                        options.signal.addEventListener('abort', () => controller.abort(), { once: true });
                    }
                }
                const isLocalProxy = proxyUrl.startsWith('/api/proxy');
                // Give local server proxy enough time (30s) while capping external public proxies appropriately
                const proxyTimeout = options?.timeout
                    ? options.timeout
                    : (isLocalProxy
                        ? Math.min(TIMEOUT_MS, isHeavyPayload ? 30000 : 15000)
                        : (isHeavyPayload ? 15000 : (priority === 'HIGH' ? 8000 : 10000)));
                timeoutId = setTimeout(() => {
                    if (!controller.signal.aborted) {
                        try {
                            controller.abort(new DOMException(`Proxy fetch timed out (${proxyTimeout}ms)`, "TimeoutError"));
                        } catch (e) {
                            controller.abort();
                        }
                    }
                }, proxyTimeout);

                const { headers, timeout, priority: customPriority, signal: optSignal, ...restOptions } = options || {};
                const res = await fetch(proxyUrl, {
                    ...restOptions,
                    signal: controller.signal,
                    headers: { 'Accept': 'application/json' }
                });
                
                if (!res.ok) {
                    if (res.status === 400 || res.status === 404) {
                        throw new Error(`HTTP ${res.status}: Invalid symbol or resource`);
                    }
                    if (res.status === 403 || res.status === 429) {
                        if (hostname && hostname !== 'localhost' && !hostname.startsWith('127.0.0.1') && !hostname.includes('binance')) {
                            blacklistedProxies.add(hostname);
                        }
                    }
                    throw new Error(`HTTP ${res.status}`);
                }

                const textData = await res.text();

                if (textData.trim().startsWith('<') || textData.toLowerCase().includes('doctype html')) {
                    throw new Error("Received HTML instead of JSON");
                }

                let data: any;
                try {
                    data = JSON.parse(textData);
                } catch (jsonErr) {
                    throw new Error(`Invalid JSON`);
                }

                let content = data;
                if (data.contents && (proxyUrl.includes('allorigins.win/get') || typeof data.contents === 'string')) {
                    if (data.status && data.status.http_code !== 200) throw new Error(`Upstream ${data.status.http_code}`);
                    try {
                        content = typeof data.contents === 'string' ? JSON.parse(data.contents) : data.contents;
                    } catch (e) {
                        content = data.contents;
                    }
                }
                
                if (validator && !validator(content)) {
                    throw new Error(`Validation failed`);
                }
                
                try {
                    lastSuccessfulProxy = new URL(proxyUrl).hostname;
                } catch (e) {}
                
                return new Response(JSON.stringify(content), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            } finally {
                clearTimeout(timeoutId);
            }
        };

        let lastError: any;

        // Clean sequential execution with retry and exponential backoff (up to 3 attempts for resource/network exhaustion)
        for (let idx = 0; idx < proxies.length; idx++) {
            const proxy = proxies[idx];
            let attempts = 0;
            const maxAttempts = 3;
            while (attempts < maxAttempts) {
                attempts++;
                try {
                    const response = await fetchProxy(proxy);
                    continuousFailures = 0;
                    return response;
                } catch (e: any) {
                    lastError = e;
                    const errStr = e?.message || String(e);
                    const isResourceOrNetworkError = errStr.includes('INSUFFICIENT_RESOURCES') || errStr.includes('Failed to fetch') || errStr.includes('NetworkError') || errStr.includes('timed out');
                    if (attempts < maxAttempts && isResourceOrNetworkError) {
                        const backoffMs = attempts * 1000; // 1000ms, 2000ms backoff
                        await new Promise(resolve => setTimeout(resolve, backoffMs));
                        continue;
                    }
                    if (errStr.includes('HTTP 404') || errStr.includes('HTTP 400')) {
                        break;
                    }
                    if (attempts >= maxAttempts) {
                        break;
                    }
                }
            }
        }

        // 🛡️ Direct fetch fallback: ensures uninterrupted connectivity in Electron or during local server boot
        try {
            const directController = new AbortController();
            const dTimeout = setTimeout(() => {
                try { directController.abort(); } catch (_) {}
            }, isHeavyPayload ? 15000 : 8000);

            const directRes = await fetch(url, {
                signal: directController.signal,
                headers: { 'Accept': 'application/json' }
            });
            clearTimeout(dTimeout);

            if (directRes.ok) {
                const text = await directRes.text();
                const json = JSON.parse(text);
                if (!validator || validator(json)) {
                    continuousFailures = 0;
                    return new Response(JSON.stringify(json), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
            }
        } catch (_) {}
        
        continuousFailures++;
        if (continuousFailures > 25) {
            circuitBreakerUntil = Date.now() + 30000;
            continuousFailures = 10;
        }

        throw lastError || new Error("Failed after all line attempts");
    } finally {
        if (!isHighPriority) {
            releaseSlot();
        }
    }
};
