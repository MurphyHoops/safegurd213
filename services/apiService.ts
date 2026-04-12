
let lastSuccessfulProxy: string | null = null;

/**
 * Robust fetcher with multiple fallbacks for CORS/Network restrictions.
 * Strategy: Direct Connection -> Stable Proxies -> High Speed Proxies -> Backup
 */
export const fetchWithFallback = async (url: string, options?: RequestInit & { timeout?: number }, validator?: (data: any) => boolean, directMode: boolean = false): Promise<Response> => {
    
    // DETECT HEAVY PAYLOAD: The '24hr' endpoint returns ~6MB JSON.
    const isHeavyPayload = url.includes('ticker/24hr');
    const isKlinePayload = url.includes('/klines');
    
    // Increase timeout significantly for heavy payloads.
    const TIMEOUT_MS = options?.timeout || (isHeavyPayload || isKlinePayload ? 45000 : 15000); 

    // 1. Direct Mode Bypass
    if (directMode) {
        let timeoutId: any;
        try {
            const controller = new AbortController();
            timeoutId = setTimeout(() => {
                console.warn(`[API] Direct fetch timed out for ${url}`);
                controller.abort();
            }, TIMEOUT_MS);
            const { timeout, ...restOptions } = options || {};
            
            console.log(`[API] Calling fetch directly for ${url}`);
            let res = await fetch(url, {
                ...restOptions,
                signal: controller.signal
            });
            console.log(`[API] Direct fetch returned for ${url}, status: ${res.status}`);
            
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
            
            // Read body while timeout is active to prevent hanging
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
            // Fall through to proxy logic instead of throwing
        } finally {
            clearTimeout(timeoutId);
        }
    }

    // Encode the URL for proxies that pass it as a query parameter
    const encodedUrl = encodeURIComponent(url);

    // Proxy List Strategy
    const proxyCorsProxyIO = `https://corsproxy.io/?${encodedUrl}`;
    const proxyAllOriginsRaw = `https://api.allorigins.win/raw?url=${encodedUrl}`;
    const proxyAllOriginsGet = `https://api.allorigins.win/get?url=${encodedUrl}`; // JSON wrapped
    const proxyThingProxy = `https://thingproxy.freeboard.io/fetch/${encodedUrl}`;
    const proxyCodeTabs = `https://api.codetabs.com/v1/proxy?quest=${encodedUrl}`;

    let proxies: string[] = [
        proxyCorsProxyIO,
        proxyCodeTabs,
        proxyAllOriginsRaw,
        proxyThingProxy,
        proxyAllOriginsGet,
        url // Last resort: Try direct if all proxies fail
    ];

    // If we have a known good proxy, try it first
    if (lastSuccessfulProxy) {
        const preferredProxy = proxies.find(p => p.includes(lastSuccessfulProxy!));
        if (preferredProxy) {
            proxies = [preferredProxy, ...proxies.filter(p => p !== preferredProxy)];
        }
    }

    // Helper function to fetch a single proxy
    const fetchProxy = async (proxyUrl: string): Promise<Response> => {
        let timeoutId: any;
        try {
            const controller = new AbortController();
            // Use a longer timeout for proxies if it's a heavy payload (up to 30s)
            const proxyTimeout = Math.min(TIMEOUT_MS, isHeavyPayload || isKlinePayload ? 30000 : 15000);
            timeoutId = setTimeout(() => controller.abort(), proxyTimeout);

            // Clean headers to avoid CORS preflight issues on proxies
            const { headers, timeout, ...restOptions } = options || {};
            
            console.log(`[API] Calling proxy: ${proxyUrl}`);
            const res = await fetch(proxyUrl, {
                ...restOptions,
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json'
                }
            });
            console.log(`[API] Proxy returned: ${proxyUrl}, status: ${res.status}`);
            
            if (!res.ok) {
                if (res.status === 451) throw new Error(`HTTP 451 (Geo-blocked) from ${proxyUrl}`);
                throw new Error(`HTTP ${res.status} from ${proxyUrl}`);
            }

            const clone = res.clone();
            let textData = '';
            
            try {
                textData = await clone.text();
            } catch (readErr: any) {
                if (readErr.name === 'AbortError') {
                    throw new Error(`Timeout while reading response body from ${proxyUrl}`);
                }
                throw new Error(`Failed to read response body from ${proxyUrl}: ${readErr.message}`);
            }

            if (textData.trim().startsWith('<') || textData.toLowerCase().includes('doctype html')) {
                throw new Error("Received HTML (Error Page) instead of JSON");
            }

            let data: any;
            try {
                data = JSON.parse(textData);
            } catch (jsonErr) {
                const snippet = textData.substring(0, 50).replace(/\n/g, ' ');
                throw new Error(`Invalid JSON from ${proxyUrl}: "${snippet}..."`);
            }

            let content = data;
            if (data.contents && (proxyUrl.includes('allorigins.win/get') || typeof data.contents === 'string')) {
                if (data.status && data.status.http_code) {
                    if (data.status.http_code === 451) throw new Error(`Upstream Error 451 (Geo-blocked)`);
                    if (data.status.http_code !== 200) throw new Error(`Upstream Error ${data.status.http_code}`);
                }

                try {
                    const inner = typeof data.contents === 'string' ? JSON.parse(data.contents) : data.contents;
                    content = inner;
                } catch (e) {
                    content = data.contents;
                }
            }
            
            if (validator) {
                if (validator(content)) {
                    // Save successful proxy base URL
                    try {
                        const urlObj = new URL(proxyUrl);
                        lastSuccessfulProxy = urlObj.hostname;
                    } catch (e) {}
                    
                    return new Response(JSON.stringify(content), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                } else {
                    if (content.code && content.msg) {
                        throw new Error(`Binance Error: [${content.code}] ${content.msg}`);
                    }
                    const preview = JSON.stringify(content).slice(0, 100);
                    throw new Error(`Validation failed for ${proxyUrl}. Data: ${preview}...`);
                }
            } else {
                // Save successful proxy base URL
                try {
                    const urlObj = new URL(proxyUrl);
                    lastSuccessfulProxy = urlObj.hostname;
                } catch (e) {}
                
                return new Response(JSON.stringify(content), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        } finally {
            clearTimeout(timeoutId);
        }
    };

    // Try sequentially instead of Promise.any to avoid flooding the browser's connection pool
    // This solves the issue where the K-line chart hangs because the background scanner
    // exhausts all available connections by firing 6 requests per symbol simultaneously.
    let lastError: any;
    for (const proxy of proxies) {
        try {
            const response = await fetchProxy(proxy);
            return response;
        } catch (e: any) {
            lastError = e;
            // If it's a 451 geo-block, we shouldn't fail immediately, just try the next proxy
            // because some proxies might be blocked while others are not.
            console.warn(`[API] Proxy failed: ${proxy} - ${e.message}`);
        }
    }
    
    // If all failed
    if (lastError && (lastError.message.includes('451') || lastError.message.includes('Geo-blocked'))) {
         throw new Error("访问受限 (HTTP 451): 您的IP或代理节点可能位于受限制地区(如美国/限制区)。请尝试开启VPN切换节点或使用[直连模式]。");
    }
    
    throw new Error(lastError?.message || "网络连接失败: 所有线路均无法连接数据源。请尝试开启[直连模式]或检查网络。");
};
