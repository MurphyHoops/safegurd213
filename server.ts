import express from "express";
import { createServer as createViteServer } from "vite";
import WebSocket, { WebSocketServer } from "ws";
import http from "http";
import cors from "cors";
import crypto from "crypto";

// Maintain a registry of browser clients subscribing to active prices
const priceSubscribers = new Set<WebSocket>();

function startBinanceWSBridge() {
  const binanceUrls = [
    'wss://fstream.binance.com/ws/!bookTicker',
    'wss://fstream.binance.me/ws/!bookTicker',
    'wss://fstream.binance.info/ws/!bookTicker'
  ];
  let currentIndex = 0;
  let bws: WebSocket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;

  const connectToBinance = () => {
    const url = binanceUrls[currentIndex];
    console.log(`📡 [Server WS Bridge] Connecting to Binance Stream: ${url}`);
    
    try {
      bws = new WebSocket(url);
      
      bws.on('open', () => {
        console.log(`📡 [Server WS Bridge] Successfully established push stream with ${url}`);
      });

      let batchedUpdates: Record<string, any> = {};
      let batchTimer: NodeJS.Timeout | null = null;

      bws.on('message', (data) => {
        try {
          const item = JSON.parse(data.toString());
          if (item && item.s) {
             batchedUpdates[item.s] = item;
          }
        } catch(e) {
             // Ignore malformed JSON
        }
        
        if (!batchTimer) {
          batchTimer = setTimeout(() => {
             const updates = Object.values(batchedUpdates);
             batchedUpdates = {};
             batchTimer = null;
             
             if (updates.length > 0) {
               const msg = JSON.stringify(updates);
               for (const client of priceSubscribers) {
                 if (client.readyState === WebSocket.OPEN) {
                   client.send(msg);
                 }
               }
             }
          }, 100); // 10Hz batching
        }
      });

      bws.on('close', () => {
        console.log(`📡 [Server WS Bridge] Binance connection closed. Rotating stream nodes and reconnecting...`);
        rotateAndSchedule();
      });

      bws.on('error', (err: any) => {
        console.error(`📡 [Server WS Bridge] Binance connection error:`, err.message || err);
        bws?.close();
      });
    } catch (e: any) {
      console.error(`📡 [Server WS Bridge] Failed to instantiate socket client:`, e.message || e);
      rotateAndSchedule();
    }
  };

  const rotateAndSchedule = () => {
    currentIndex = (currentIndex + 1) % binanceUrls.length;
    if (bws) {
      try { bws.terminate(); } catch (e) {}
      bws = null;
    }
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectToBinance, 3000);
  };

  connectToBinance();
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // Create HTTP server
  const server = http.createServer(app);

  // Initialize WebSocket server instance
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws, req) => {
    const clientUrl = req.url || '';
    
    if (clientUrl.includes('/api/ws-prices')) {
      console.log("🟢 Browser client subscribed to real-time prices stream");
      priceSubscribers.add(ws);
      
      ws.on("close", () => {
        console.log("🔴 Browser client unsubscribed from real-time prices stream");
        priceSubscribers.delete(ws);
      });
      
      ws.on("error", () => {
        priceSubscribers.delete(ws);
      });
    } else {
      console.log("🟢 Client connected to default WebSocket");
      
      // Send initial connection success message for general terminal
      ws.send(JSON.stringify({ type: "SYSTEM", message: "Connected to Trading Engine Server" }));
  
      ws.on("message", (message) => {
        console.log("Received:", message.toString());
      });
  
      ws.on("close", () => {
        console.log("🔴 Client disconnected from default WebSocket");
      });
    }
  });

  // Start the server-side active WebSocket pricing bridge
  startBinanceWSBridge();

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

    // --- SERVER-SIDE PROXY (KERNEL BYPASS) ---
    // This bypasses browser CORS and IP restrictions by fetching data from the server node.
    interface ServerCacheEntry {
        data: any;
        timestamp: number;
        ttl: number;
    }

    const serverCache = new Map<string, ServerCacheEntry>();

    const getServerCacheTTL = (url: string): number => {
        if (url.includes("/klines")) {
            if (url.includes("interval=1d") || url.includes("interval=1w")) return 30000; // 30s
            return 10000; // 10s for other klines
        }
        if (url.includes("ticker/price")) return 2000; // 2s
        if (url.includes("ticker/24hr")) return 5000; // 5s
        return 2000; // 2s default
    };

    const normalizeUrlForCache = (urlStr: string): string => {
        try {
            const urlObj = new URL(urlStr);
            urlObj.searchParams.delete('_t');
            urlObj.searchParams.delete('cb');
            return urlObj.toString();
        } catch (e) {
            return urlStr;
        }
    };

    app.post("/api/binance/validate-and-balance", async (req, res) => {
        const { apiKey, apiSecret } = req.body;
        if (!apiKey || !apiSecret) {
            return res.status(400).json({ success: false, error: "请提供完整的 API Key 和 Secret Key" });
        }

        try {
            const timestamp = Date.now();
            const queryString = `timestamp=${timestamp}&recvWindow=5000`;
            const signature = crypto
                .createHmac("sha256", apiSecret)
                .update(queryString)
                .digest("hex");

            const baseUrls = [
                "https://fapi.binance.com",
                "https://fapi.binance.me",
                "https://fapi.binance.info"
            ];

            let lastError = null;
            let success = false;
            let resultData: any = null;

            for (const baseUrl of baseUrls) {
                const url = `${baseUrl}/fapi/v2/account?${queryString}&signature=${signature}`;
                try {
                    console.log(`[Binance API Validation] Trying node: ${baseUrl}`);
                    const response = await fetch(url, {
                        method: "GET",
                        headers: {
                            "X-MBX-APIKEY": apiKey,
                            "Content-Type": "application/json"
                        }
                    });

                    if (response.ok) {
                        const data = await response.json();
                        success = true;
                        resultData = data;
                        break; // Stop trying other URLs if successful
                    } else {
                        const errText = await response.text();
                        let errMsg = errText;
                        try {
                            const errJson = JSON.parse(errText);
                            errMsg = errJson.msg || errText;
                        } catch (e) {}
                        lastError = `节点 ${baseUrl} 报错 (状态码 ${response.status}): ${errMsg}`;
                    }
                } catch (err: any) {
                    lastError = `连接节点 ${baseUrl} 发生错误: ${err.message || err}`;
                }
            }

            if (success && resultData) {
                const usdtAsset = resultData.assets?.find((a: any) => a.asset === "USDT");
                const marginBalance = usdtAsset ? parseFloat(usdtAsset.marginBalance) : 0;
                const walletBalance = usdtAsset ? parseFloat(usdtAsset.walletBalance) : 0;
                const availableBalance = usdtAsset ? parseFloat(usdtAsset.availableBalance) : 0;

                return res.json({
                    success: true,
                    marginBalance,
                    walletBalance,
                    availableBalance,
                    message: "API 校验连接成功！"
                });
            }

            return res.status(502).json({
                success: false,
                error: `API 校验连接失败。${lastError || "无法连接至任何币安 API 节点。"}`
            });

        } catch (e: any) {
            return res.status(500).json({
                success: false,
                error: `系统在准备签名或发送请求时遇到未知错误: ${e.message || e}`
            });
        }
    });

    app.get("/api/proxy", async (req, res) => {
      let targetUrl = req.query.url as string;
      if (!targetUrl) return res.status(400).json({ error: "Missing URL parameter" });

      // INTERCEPT MOCK/CUSTOM/SIMULATION SYMBOLS
      let symbolParam = "";
      try {
          const parsedUrl = new URL(targetUrl);
          symbolParam = parsedUrl.searchParams.get("symbol") || "";
      } catch (e) {}

      if (symbolParam) {
          const upperSymbol = symbolParam.toUpperCase();
          if (/[^\x00-\x7F]/.test(symbolParam) || upperSymbol.includes('MOCK') || upperSymbol.includes('TEST') || upperSymbol.includes('FAKE')) {
              // It is a mock/simulation symbol!
              if (targetUrl.includes("/klines")) {
                  let interval = "5m";
                  let limit = 100;
                  try {
                      const parsedUrl = new URL(targetUrl);
                      interval = parsedUrl.searchParams.get("interval") || "5m";
                      limit = parseInt(parsedUrl.searchParams.get("limit") || "100") || 100;
                  } catch (e) {}
                  console.log(`[Proxy Mock] Generating mock klines for ${symbolParam} (${interval})`);
                  const mockData = generateMockKLines(symbolParam, interval, limit);
                  return res.json(mockData);
              }
              if (targetUrl.includes("ticker/price")) {
                  let hash = 0;
                  for (let i = 0; i < symbolParam.length; i++) {
                      hash = symbolParam.charCodeAt(i) + ((hash << 5) - hash);
                  }
                  const seed = Math.abs(hash);
                  const price = 10 + (seed % 90) + (seed % 100) / 100;
                  return res.json({ symbol: symbolParam, price: price.toString() });
              }
              if (targetUrl.includes("ticker/24hr") || targetUrl.includes("premiumIndex")) {
                  let hash = 0;
                  for (let i = 0; i < symbolParam.length; i++) {
                      hash = symbolParam.charCodeAt(i) + ((hash << 5) - hash);
                  }
                  const seed = Math.abs(hash);
                  const price = 10 + (seed % 90) + (seed % 100) / 100;
                  return res.json({
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
                  });
              }
          }
      }

      // SERVER-SIDE CACHE HIT
      const cacheKey = normalizeUrlForCache(targetUrl);
      const cached = serverCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < cached.ttl) {
          return res.json(cached.data);
      }
  
      // Handle missing USDT suffix for binance kline/ticker queries
      if (targetUrl.includes("binance")) {
          try {
              const parsedUrl = new URL(targetUrl);
              const symbolParam = parsedUrl.searchParams.get("symbol");
              if (symbolParam && !symbolParam.endsWith("USDT") && !symbolParam.includes("USDC")) {
                  const updatedSymbol = `${symbolParam}USDT`;
                  parsedUrl.searchParams.set("symbol", updatedSymbol);
                  targetUrl = parsedUrl.toString();
                  console.log(`[Proxy] Automatically appended USDT. New URL: ${targetUrl}`);
              }
          } catch (e) {
              console.error(`[Proxy] Error parsing target URL for symbol check:`, e);
          }
      }
  
      const isHighPriority = (req.query.priority === "high") || targetUrl.includes("/klines");
      const maxRetries = isHighPriority ? 6 : 2;
      let attempt = 0;
      let urlToFetch = targetUrl;
  
      while (attempt < maxRetries) {
          attempt++;
          
          // Determine the URL to fetch for this attempt
          if (targetUrl.includes("binance")) {
              if (attempt === 1) {
                  urlToFetch = targetUrl.replace(/fapi(?:-gcp|[0-9]*)\.binance\.(com|me|info)/, "fapi.binance.com");
              } else if (attempt === 2) {
                  urlToFetch = targetUrl.replace(/fapi(?:-gcp|[0-9]*)\.binance\.(com|me|info)/, "fapi.binance.me");
              } else {
                  // Public proxies - always map to the standard fapi.binance.com domain
                  const standardTargetUrl = targetUrl.replace(/fapi(?:-gcp|[0-9]*)\.binance\.(com|me|info)/, "fapi.binance.com");
                  const encodedOrig = encodeURIComponent(standardTargetUrl);
                  const cacheBuster = `cb=${Date.now()}`;
                  
                  if (attempt === 3) {
                      urlToFetch = `https://corsproxy.io/?${encodedOrig}&${cacheBuster}`;
                  } else if (attempt === 4) {
                      urlToFetch = `https://api.codetabs.com/v1/proxy?quest=${encodedOrig}`;
                  } else if (attempt === 5) {
                      urlToFetch = `https://api.allorigins.win/raw?url=${encodedOrig}&${cacheBuster}`;
                  } else {
                      urlToFetch = `https://corsproxy.org/?${encodedOrig}`;
                  }
              }
          } else {
              if (attempt === 1) {
                  urlToFetch = targetUrl;
              } else {
                  const encodedOrig = encodeURIComponent(targetUrl);
                  urlToFetch = `https://api.allorigins.win/raw?url=${encodedOrig}&cb=${Date.now()}`;
              }
          }

          try {
              console.log(`[Proxy] Attempt ${attempt} / ${maxRetries}: Fetching ${urlToFetch}`);
              
              const controller = new AbortController();
              const isPublicProxy = urlToFetch.includes("allorigins") || 
                                    urlToFetch.includes("corsproxy") || 
                                    urlToFetch.includes("codetabs");
                                    
              const timeoutMs = isPublicProxy ? 15000 : 3500;
              const timeoutId = setTimeout(() => {
                  if (controller.signal.aborted) return;
                  controller.abort();
              }, timeoutMs);
  
              // Distribute across different user agents to reduce blocking
              const userAgents = [
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
                  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1"
              ];
  
              const headers: Record<string, string> = {
                  "Accept": "application/json"
              };
              
              // Only add scraper-like custom headers if we are hitting Binance directly
              if (!isPublicProxy) {
                  headers["User-Agent"] = userAgents[attempt % userAgents.length];
                  headers["Cache-Control"] = "no-cache";
              }
  
              const response = await fetch(urlToFetch, {
                  headers,
                  signal: controller.signal
              });
              clearTimeout(timeoutId);
  
              if (response.ok) {
                  const text = await response.text();
                  if (!text || text.trim() === '') {
                      throw new Error("Empty response from upstream");
                  }
                  if (text.trim().startsWith('<') || text.toLowerCase().includes('doctype html')) {
                      throw new Error("Received HTML error page from proxy/upstream");
                  }
                  const data = JSON.parse(text);
                  console.log(`[Proxy] Success on attempt ${attempt} for ${urlToFetch}`);
                  
                  // Cache successful responses
                  const ttl = getServerCacheTTL(targetUrl);
                  serverCache.set(cacheKey, {
                      data,
                      timestamp: Date.now(),
                      ttl
                  });
  
                  return res.json(data);
              }
  
              if (response.status === 400 || response.status === 404) {
                  console.log(`[Proxy] Attempt ${attempt} returned status ${response.status} (invalid symbol/resource) for ${urlToFetch}`);
              } else {
                  console.warn(`[Proxy] Attempt ${attempt} failed with status ${response.status} for ${urlToFetch}`);
              }
              
              if (response.status === 400 || response.status === 404) {
                  // If it's 400 Bad Request due to "Invalid symbol", check if appending USDT works
                  if (response.status === 400 && urlToFetch.includes("binance") && !urlToFetch.includes("USDT")) {
                      try {
                          const parsedUrl = new URL(urlToFetch);
                          const symbolParam = parsedUrl.searchParams.get("symbol");
                          if (symbolParam) {
                              parsedUrl.searchParams.set("symbol", `${symbolParam}USDT`);
                              targetUrl = parsedUrl.toString();
                              attempt--; // Retrying the same attempt index with USDT
                              continue;
                          }
                      } catch (e) {}
                  }
                  
                  // Otherwise, return 400/404 immediately to avoid wasting time with retries!
                  console.log(`[Proxy] Immediately stopping on status ${response.status} for ${urlToFetch} (no retries for 400/404)`);
                  const text = await response.text();
                  try {
                      return res.status(response.status).json(JSON.parse(text));
                  } catch (e) {
                      return res.status(response.status).send(text);
                  }
              }
              
              throw new Error(`Response status ${response.status}`);
          } catch (error: any) {
              console.error(`[Proxy] Attempt ${attempt} encountered error: ${error.message || error}`);
          }
      }
  
      if (targetUrl.includes("/klines")) {
          try {
              const parsedUrl = new URL(targetUrl);
              const symbolInput = parsedUrl.searchParams.get("symbol") || "BTCUSDT";
              const interval = parsedUrl.searchParams.get("interval") || "1d";
              const limit = parseInt(parsedUrl.searchParams.get("limit") || "100") || 100;
              console.log(`[Proxy Fallback] Upstream failed. Creating server-side mock klines for ${symbolInput} (${interval})`);
              const mockData = generateMockKLines(symbolInput, interval, limit);
              return res.json(mockData);
          } catch (e) {
              console.error("[Proxy Fallback] Error generating helper klines:", e);
          }
      }

      return res.status(502).json({ error: "All backend proxy and rotation paths exhausted. Upstream is unreachable." });
    });

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Trading Engine is running" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const path = await import('path');
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.use((req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Trading Engine Server running on http://localhost:${PORT}`);
  });
}

// High-level Node.js safety locks to prevent uncaught promise rejections or exceptions from terminating the server process
process.on('uncaughtException', (err) => {
    console.error('🔥 CRITICAL ERROR: Uncaught Exception caught by savior guard:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🔥 CRITICAL ERROR: Unhandled Promise Rejection at:', promise, 'reason:', reason);
});

startServer();
