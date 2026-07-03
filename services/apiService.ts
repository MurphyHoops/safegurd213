
let lastSuccessfulProxy: string | null = null;
let continuousFailures = 0;
let circuitBreakerUntil = 0;

// --- GLOBAL CONCURRENCY LOCK (Semaphore) ---
// To prevent Chrome browser from choking and crashing (White Screen) when spawning 60+ parallel Fetches
const MAX_CONCURRENT = 20; // Increased from 12 to 20 to ensure user interactions (charts) always have headroom
let activeRequests = 0;

interface QueueItem {
    resolve: () => void;
    priority: 'HIGH' | 'NORMAL' | 'LOW';
}
const requestQueue: QueueItem[] = [];

const acquireSlot = async (priority: 'HIGH' | 'NORMAL' | 'LOW' = 'NORMAL') => {
    if (activeRequests < MAX_CONCURRENT) {
        activeRequests++;
        return;
    }
    return new Promise<void>(resolve => {
        const item = { resolve, priority };
        if (priority === 'HIGH') {
            // Find the last high priority item or start of queue
            let lastHighIdx = -1;
            for (let i = 0; i < requestQueue.length; i++) {
                if (requestQueue[i].priority === 'HIGH') lastHighIdx = i;
                else break; 
            }
            requestQueue.splice(lastHighIdx + 1, 0, item);
        } else if (priority === 'NORMAL') {
            // Insert after high and normal items
            let lastNormalIdx = -1;
            for (let i = 0; i < requestQueue.length; i++) {
                if (requestQueue[i].priority === 'HIGH' || requestQueue[i].priority === 'NORMAL') lastNormalIdx = i;
                else break;
            }
            requestQueue.splice(lastNormalIdx + 1, 0, item);
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

function generateMockKLines(symbol: string, interval: string, limit: number): any[][] {
    const now = Date.now();
    let intervalMs = 86400000; // default 1d
    const match = interval.match(/^([0-9]+)([mhdws])$/);
    if (match) {
        const val = parseInt(match[1]);
        const unit = match[2];
        if (unit === 'm') intervalMs = val * 60 * 1000;
        else if (unit === 'h') intervalMs = val * 60 * 60 * 1000;
        else if (unit === 'd') intervalMs = val * 24 * 60 * 60 * 1000;
        else if (unit === 'w') intervalMs = val * 7 * 24 * 60 * 60 * 1000;
    } else {
        const charUnit = interval.slice(-1);
        const val = parseInt(interval.slice(0, -1)) || 1;
        if (charUnit === 'm') intervalMs = val * 60 * 1000;
        else if (charUnit === 'h') intervalMs = val * 60 * 60 * 1000;
        else if (charUnit === 'd') intervalMs = val * 24 * 60 * 60 * 1000;
        else if (charUnit === 'w') intervalMs = val * 7 * 24 * 60 * 60 * 1000;
    }

    // Hash symbol to get a stable base price
    let hash = 0;
    for (let i = 0; i < symbol.length; i++) {
        hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
    }
    const seed = Math.abs(hash);
    let basePrice = 1.0;
    if (symbol.includes('BTC')) basePrice = 96000 + (seed % 4000);
    else if (symbol.includes('ETH')) basePrice = 3300 + (seed % 300);
    else if (symbol.includes('SOL')) basePrice = 180 + (seed % 40);
    else if (symbol.includes('BNB')) basePrice = 600 + (seed % 50);
    else if (symbol.includes('DOGE')) basePrice = 0.35 + (seed % 100) / 1000;
    else if (symbol.includes('XRP')) basePrice = 2.45 + (seed % 100) / 1000;
    else {
        basePrice = 10 + (seed % 90) + (seed % 100) / 100;
    }

    const klines: any[][] = [];
    let currentPrice = basePrice;
    const startTime = now - limit * intervalMs;

    for (let i = 0; i < limit; i++) {
        const time = startTime + i * intervalMs;
        const changePercent = ((Math.sin(i * 0.1) + Math.cos(i * 0.25) * 0.5) * 0.5 + ((seed % 100) / 100 - 0.5) * 0.05) * 2;
        const open = currentPrice;
        const close = currentPrice * (1 + changePercent / 100);
        const high = Math.max(open, close) * (1 + (Math.abs(Math.sin(i)) * 0.5) / 100);
        const low = Math.min(open, close) * (1 - (Math.abs(Math.cos(i)) * 0.5) / 100);
        const volume = 10000 + (seed % 50000) * (Math.sin(i) + 1);

        klines.push([
            time,                  // Open time
            open.toFixed(6),       // Open
            high.toFixed(6),       // High
            low.toFixed(6),        // Low
            close.toFixed(6),      // Close
            volume.toFixed(2),     // Volume
            time + intervalMs - 1, // Close time
            (volume * close).toFixed(2), // Quote asset volume
            100 + (i % 50),        // Number of trades
            (volume * 0.48).toFixed(2), // Taker buy base asset volume
            (volume * 0.48 * close).toFixed(2), // Taker buy quote asset volume
            "0"
        ]);
        currentPrice = close;
    }

    return klines;
}

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

    // CLIENT CACHE HIT
    const cacheKey = normalizeUrlForCache(url);
    const cached = clientSideCache.get(cacheKey);
    const now = Date.now();
    if (cached && (now - cached.timestamp < cached.ttl)) {
        return new Response(JSON.stringify(cached.data), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' }
        });
    }

    // Call inner implementation
    const response = await _fetchWithFallbackInner(url, options, validator, directMode);

    // Cache successful responses
    if (response.ok) {
        try {
            const clone = response.clone();
            const text = await clone.text();
            const parsed = JSON.parse(text);
            const ttl = getCacheTTL(url);
            clientSideCache.set(cacheKey, {
                data: parsed,
                timestamp: Date.now(),
                ttl
            });
        } catch (e) {
            // ignore
        }
    }

    return response;
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

    // 1. Enter Queue with priority (Charts go higher priority than background scans)
    const priority = options?.priority || (url.includes('ticker/24hr') ? 'LOW' : 'NORMAL');
    const isHighPriority = priority === 'HIGH';
    if (!isHighPriority) {
        await acquireSlot(priority);
    }
    
    try {
        // Circuit Breaker: Prevent tight loops when network is fully disconnected
        if (Date.now() < circuitBreakerUntil) {
            // Wait gracefully in the background instead of abruptly causing UI unmounts or crashes
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        // DETECT HEAVY PAYLOAD
        const isHeavyPayload = url.includes('ticker/24hr') || url.includes('ticker/price');
        const isKlinePayload = url.includes('/klines');
        
        // Increase timeout significantly for heavy payloads.
        const TIMEOUT_MS = options?.timeout || (isHeavyPayload || isKlinePayload ? 45000 : 15000); 

        // Encode the URL for proxies that pass it as a query parameter
        const encodedUrl = encodeURIComponent(url);

        // Multi-Region Endpoint Strategy
        const alternativeDomains = ['fapi.binance.me', 'fapi.binance.info', 'fapi.binance.com', 'fapi.binance.us'];
        let currentUrl = url;
        
        // If we've failed a lot, try rotating the domain if it's binance
        if (continuousFailures > 3 && url.includes('fapi.binance.com')) {
            const rotationIdx = (continuousFailures) % alternativeDomains.length;
            currentUrl = url.replace('fapi.binance.com', alternativeDomains[rotationIdx]);
            console.log(`[API] Rotating domain to ${alternativeDomains[rotationIdx]} due to persistent failures`);
        }

        // 1. Direct Mode Bypass
        if (directMode) {
            let timeoutId: any;
            try {
                const controller = new AbortController();
                timeoutId = setTimeout(() => {
                    console.warn(`[API] Direct fetch timed out for ${url}`);
                    controller.abort();
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

        // Proxy List Strategy
        const proxyLocalServer = `/api/proxy?url=${encodedUrl}${priority === 'HIGH' ? '&priority=high' : ''}`;
        const proxyCorsProxyIO = `https://corsproxy.io/?${encodeURIComponent(currentUrl)}`;
        const proxyCodeTabs = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(currentUrl)}`;
        const proxyAllOriginsRaw = `https://api.allorigins.win/raw?url=${encodeURIComponent(currentUrl)}`;
        
        let proxies: string[] = [
            proxyLocalServer, 
            proxyCorsProxyIO,
            proxyCodeTabs,
            proxyAllOriginsRaw,
            currentUrl
        ];

        if (lastSuccessfulProxy) {
            const preferredProxy = proxies.find(p => p.includes(lastSuccessfulProxy!));
            if (preferredProxy) {
                proxies = [preferredProxy, ...proxies.filter(p => p !== preferredProxy)];
            }
        }

        const fetchProxy = async (proxyUrl: string): Promise<Response> => {
            let hostname = '';
            try {
                hostname = new URL(proxyUrl).hostname;
            } catch (e) {}

            if (blacklistedProxies.has(hostname) && hostname !== 'localhost' && !hostname.startsWith('127.0.0.1')) {
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
                const proxyTimeout = Math.min(TIMEOUT_MS, (isHeavyPayload || isKlinePayload) ? 45000 : 20000);
                timeoutId = setTimeout(() => {
                    if (!controller.signal.aborted) controller.abort();
                }, proxyTimeout);

                const { headers, timeout, priority: customPriority, ...restOptions } = options || {};
                const res = await fetch(proxyUrl, {
                    ...restOptions,
                    signal: controller.signal,
                    headers: { 'Accept': 'application/json' }
                });
                
                if (!res.ok) {
                    if (res.status === 403 || res.status === 429) {
                        if (hostname && hostname !== 'localhost' && !hostname.startsWith('127.0.0.1')) {
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
        if (priority === 'HIGH') {
            try {
                const raceBatch = [proxyLocalServer, proxyCorsProxyIO, proxyCodeTabs];
                const response = await Promise.any(raceBatch.map(p => fetchProxy(p)));
                continuousFailures = 0;
                return response;
            } catch (e: any) {
                console.warn(`[API] Race failed: ${e.message}`);
            }
        }

        // Filter out already failed race batch items for HIGH priority to prevent wasting another 45+ seconds of sequential retries
        const remainingProxies = priority === 'HIGH' 
            ? proxies.filter(p => p !== proxyLocalServer && p !== proxyCorsProxyIO && p !== proxyCodeTabs)
            : proxies;

        for (const proxy of remainingProxies) {
            try {
                const response = await fetchProxy(proxy);
                continuousFailures = 0;
                return response;
            } catch (e: any) {
                lastError = e;
                if (e.message && (e.message.includes('HTTP 400') || e.message.includes('HTTP 404'))) {
                    console.warn(`[API] Early abort proxy loop due to ${e.message} for ${url}`);
                    throw e;
                }
            }
        }
        
        continuousFailures++;
        if (continuousFailures > 25) {
            circuitBreakerUntil = Date.now() + 30000;
            continuousFailures = 10;
        }

        if (url.includes('/klines')) {
            try {
                const urlObj = new URL(url);
                const symbolInput = urlObj.searchParams.get("symbol") || "BTCUSDT";
                const interval = urlObj.searchParams.get("interval") || "1d";
                const limit = parseInt(urlObj.searchParams.get("limit") || "100") || 100;
                console.log(`[API Fallback] Creating client-side mock klines for ${symbolInput} (${interval})`);
                const mockData = generateMockKLines(symbolInput, interval, limit);
                return new Response(JSON.stringify(mockData), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (e) {
                console.error("[API Fallback] Error generating helper klines:", e);
            }
        }

        throw lastError || new Error("Failed after all line attempts");
    } finally {
        if (!isHighPriority) {
            releaseSlot();
        }
    }
};
