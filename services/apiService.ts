
let lastSuccessfulProxy: string | null = null;
let continuousFailures = 0;
let circuitBreakerUntil = 0;

// --- GLOBAL CONCURRENCY LOCK (Semaphore) ---
// High-throughput concurrency limit to ensure 20+ position background checks never block List 1 market scanning
const MAX_CONCURRENT = 60; // Increased from 20 to 60 to prevent scanner starvation when holding 20+ positions
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

const clientSideCache = new Map<string, CacheEntry>();
const inflightRequests = new Map<string, Promise<any>>();

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
        return 60000; // 60 seconds for daily/weekly/monthly klines
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
        clientSideCache.set(cacheKey, {
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

    // 1. Enter Queue with priority (Charts, Klines and 24hr Ticker go higher priority than background scans)
    const isKlinePayload = url.includes('/klines');
    const isHeavyPayload = url.includes('ticker/24hr') || url.includes('ticker/price');
    const priority = options?.priority || (url.includes('ticker/24hr') || isKlinePayload ? 'HIGH' : 'NORMAL');
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
        const proxyLocalServer = `/api/proxy?url=${encodedUrl}${priority === 'HIGH' ? '&priority=high' : ''}`;
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

                const clone = res.clone();
                const textData = await clone.text();

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

        // Clean sequential execution: Local server proxy (/api/proxy) is always #1 and handles upstream routing reliably
        for (let idx = 0; idx < proxies.length; idx++) {
            const proxy = proxies[idx];
            try {
                const response = await fetchProxy(proxy);
                continuousFailures = 0;
                return response;
            } catch (e: any) {
                lastError = e;
                if (url.includes('/klines') && proxy === proxyLocalServer) {
                    // If local server proxy failed for klines, try at most 1 external fallback
                    continue;
                }
                if (e.message && (e.message.includes('HTTP 404') || e.message.includes('HTTP 400'))) {
                    console.warn(`[API] Early abort proxy loop due to ${e.message} for ${url}`);
                    break;
                }
            }
        }
        
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
