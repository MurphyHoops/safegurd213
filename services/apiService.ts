
/**
 * Robust fetcher with multiple fallbacks for CORS/Network restrictions.
 * Strategy: Direct Connection -> Stable Proxies -> High Speed Proxies -> Backup
 */
export const fetchWithFallback = async (url: string, options?: RequestInit & { timeout?: number }, validator?: (data: any) => boolean, directMode: boolean = false): Promise<Response> => {
    
    // 1. Direct Mode Bypass
    if (directMode) {
        try {
            const res = await fetch(url, options);
            if (!res.ok) throw new Error(`Direct fetch failed: ${res.status}`);
            return res;
        } catch (e: any) {
            throw new Error(`直连模式失败 (Direct Failed): ${e.message || e}`);
        }
    }

    // Encode the URL for proxies that pass it as a query parameter
    const encodedUrl = encodeURIComponent(url);
    
    // DETECT HEAVY PAYLOAD: The 'tradingDay' and '24hr' endpoints return ~6MB JSON.
    const isHeavyPayload = url.includes('ticker/tradingDay') || url.includes('ticker/24hr');
    
    // Increase timeout significantly for heavy payloads.
    const TIMEOUT_MS = options?.timeout || (isHeavyPayload ? 45000 : 15000); 

    // Proxy List Strategy
    const proxyCorsProxyIO = `https://corsproxy.io/?${encodedUrl}`;
    const proxyAllOriginsRaw = `https://api.allorigins.win/raw?url=${encodedUrl}`;
    const proxyAllOriginsGet = `https://api.allorigins.win/get?url=${encodedUrl}`; // JSON wrapped
    const proxyThingProxy = `https://thingproxy.freeboard.io/fetch/${encodedUrl}`;
    const proxyCodeTabs = `https://api.codetabs.com/v1/proxy?quest=${encodedUrl}`;

    let proxies: string[] = [];

    if (isHeavyPayload) {
        // HEAVY PAYLOAD STRATEGY (Size > 5MB)
        // Removed 'url' (Direct) from default proxy list to prevent CORS console spam if user hasn't enabled Direct Mode.
        // CodeTabs is often more reliable for larger files than AllOrigins.
        proxies = [
            proxyCorsProxyIO,
            proxyCodeTabs,
            proxyAllOriginsRaw, 
            proxyThingProxy,
        ];
    } else {
        // STANDARD STRATEGY (Light payloads like single Kline)
        proxies = [
            proxyCorsProxyIO,
            proxyCodeTabs,
            proxyAllOriginsRaw,
            proxyThingProxy,
            proxyAllOriginsGet,
            url // Last resort: Try direct if all proxies fail (might work if same origin or non-CORS)
        ];
    }

    let lastError: any;

    for (const proxyUrl of proxies) {
        let timeoutId: any;
        try {
            const controller = new AbortController();
            timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

            // Clean headers to avoid CORS preflight issues on proxies
            const { headers, timeout, ...restOptions } = options || {};
            
            const res = await fetch(proxyUrl, {
                ...restOptions,
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            clearTimeout(timeoutId);

            if (res.ok) {
                // IMPORTANT: Clone the response to safely inspect body without locking the stream
                // We use clone because we might return the original 'res' or a new Response object
                const clone = res.clone();
                let textData = '';
                
                try {
                    textData = await clone.text();
                } catch (readErr) {
                    throw new Error("Failed to read response body");
                }

                // CRITICAL FIX: Check for HTML error pages (Common with Proxies)
                if (textData.trim().startsWith('<') || textData.toLowerCase().includes('doctype html')) {
                    throw new Error("Received HTML (Error Page) instead of JSON");
                }

                // Attempt Parse
                let data: any;
                try {
                    data = JSON.parse(textData);
                } catch (jsonErr) {
                    // Snippet for debug
                    const snippet = textData.substring(0, 50).replace(/\n/g, ' ');
                    throw new Error(`Invalid JSON from ${proxyUrl}: "${snippet}..."`);
                }

                // Unwrap AllOrigins 'get' wrapper if present
                let content = data;
                if (data.contents && (proxyUrl.includes('allorigins.win/get') || typeof data.contents === 'string')) {
                    // Check upstream status code
                    if (data.status && data.status.http_code) {
                        if (data.status.http_code === 451) throw new Error(`Upstream Error 451 (Geo-blocked)`);
                        if (data.status.http_code !== 200) throw new Error(`Upstream Error ${data.status.http_code}`);
                    }

                    try {
                        const inner = typeof data.contents === 'string' ? JSON.parse(data.contents) : data.contents;
                        content = inner;
                    } catch (e) {
                        content = data.contents; // Fallback
                    }
                }
                
                // If validator provided, verify structure
                if (validator) {
                    if (validator(content)) {
                        // Return a new Response with the clean JSON content
                        return new Response(JSON.stringify(content), {
                            status: 200,
                            headers: { 'Content-Type': 'application/json' }
                        });
                    } else {
                        // Check for Binance specific error codes
                        if (content.code && content.msg) {
                            throw new Error(`Binance Error: [${content.code}] ${content.msg}`);
                        }
                        const preview = JSON.stringify(content).slice(0, 100);
                        throw new Error(`Validation failed for ${proxyUrl}. Data: ${preview}...`);
                    }
                } else {
                    // No validator, trust the parsed JSON and return new Response
                    return new Response(JSON.stringify(content), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

            } else {
                lastError = new Error(`HTTP ${res.status} from ${proxyUrl}`);
                if (res.status === 451) {
                    lastError = new Error(`HTTP 451 (Geo-blocked) from ${proxyUrl}`);
                }
                continue;
            }
        } catch (e: any) {
            clearTimeout(timeoutId);
            lastError = e;
            // Continue to next proxy
        }
    }

    const msg = lastError?.message || "Unknown Network Error";
    if (msg.includes('451') || msg.includes('Geo-blocked')) {
         throw new Error("访问受限 (HTTP 451): 您的IP或代理节点可能位于受限制地区(如美国/限制区)。请尝试开启VPN切换节点或使用[直连模式]。");
    }
    
    throw new Error(msg || "网络连接失败: 所有线路均无法连接数据源。请尝试开启[直连模式]或检查网络。");
};
