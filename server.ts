import express from "express";
import { createServer as createViteServer } from "vite";
import WebSocket, { WebSocketServer } from "ws";
import http from "http";
import cors from "cors";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { ZipArchive } from "archiver";

// Maintain a registry of browser clients subscribing to active prices
const priceSubscribers = new Set<WebSocket>();
const lastRequestTime = new Map<string, number>();
const latestTickerPrices = new Map<string, number>();

function startBinanceWSBridge() {
  const binanceUrls = [
    'wss://fstream.binance.com/ws/!bookTicker',
    'wss://fstream.binance.com/ws/!miniTicker@arr',
    'wss://fstream.binance.com/ws/!ticker@arr'
  ];
  let currentIndex = 0;
  let bws: WebSocket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let lastMessageTime = Date.now();

  const connectToBinance = () => {
    const url = binanceUrls[currentIndex];
    console.log(`📡 [Server WS Bridge] Connecting to Binance Stream: ${url}`);
    
    try {
      bws = new WebSocket(url);
      
      bws.on('open', () => {
        console.log(`📡 [Server WS Bridge] Successfully established push stream with ${url}`);
        lastMessageTime = Date.now();
      });

      let batchedUpdates: Record<string, any> = {};
      let batchTimer: NodeJS.Timeout | null = null;

      bws.on('message', (data) => {
        lastMessageTime = Date.now();
        try {
          const parsed = JSON.parse(data.toString());
          const items = Array.isArray(parsed) ? parsed : [parsed];
          for (const item of items) {
            if (item && item.s) {
               batchedUpdates[item.s] = item;
               const p = parseFloat(item.c || item.b || item.a || item.p || "0");
               if (p > 0) {
                 latestTickerPrices.set(item.s.toUpperCase(), p);
               }
            }
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
                   try { client.send(msg); } catch(e){}
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

  // Watchdog check: rotate and reconnect if no messages received from Binance for 10 seconds
  setInterval(() => {
    const silentDuration = Date.now() - lastMessageTime;
    if (silentDuration > 10000) {
      console.warn(`⚠️ [Server WS Bridge] Connection went silent for ${Math.round(silentDuration / 1000)}s. Rotating and reconnecting...`);
      lastMessageTime = Date.now();
      rotateAndSchedule();
    }
  }, 2000);

  connectToBinance();
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  app.get("/api/network/ip", async (req, res) => {
      try {
          const response = await fetch("https://api.ipify.org?format=json");
          const data = await response.json();
          res.json({ ip: data.ip });
      } catch (error) {
          console.error("Failed to fetch external IP:", error);
          res.status(500).json({ error: "Failed to fetch IP" });
      }
  });

  // Create HTTP server
  const server = http.createServer(app);

  // maintain browser clients connected to default websocket (trade updates & account events)
  const generalSubscribers = new Set<WebSocket>();

  // 🔒 [第三层：服务端防连续重复补仓全局硬锁]
  const serverRefillFloodGuard = new Map<string, number>();

  function broadcastToGeneralSubscribers(msgObj: any) {
    const jsonStr = JSON.stringify(msgObj);
    for (const client of generalSubscribers) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(jsonStr);
        } catch (e) {}
      }
    }
  }

  interface UserStreamInstance {
    apiKey: string;
    listenKey: string;
    ws: WebSocket | null;
    keepAliveTimer: NodeJS.Timeout | null;
    lastConnected: number;
  }

  const activeUserStreams = new Map<string, UserStreamInstance>();

  async function ensureUserDataStream(apiKey: string) {
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 10) return;
    const cleanKey = apiKey.trim();
    
    const existing = activeUserStreams.get(cleanKey);
    if (existing && existing.ws && (existing.ws.readyState === WebSocket.OPEN || existing.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    console.log(`📡 [Binance UserData Stream] Initiating User Data Stream for API Key: ${cleanKey.slice(0, 8)}...`);

    try {
      let listenKey = "";
      let isAuthError = false;
      try {
        const res = await fetchWithFallback(`https://fapi.binance.com/fapi/v1/listenKey`, {
          method: "POST",
          headers: { "X-MBX-APIKEY": cleanKey }
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.listenKey) {
            listenKey = data.listenKey;
          }
        } else {
          const errData = await res.json().catch(() => null);
          console.warn(`[Binance UserData Stream] listenKey rejected (HTTP ${res.status}): ${errData?.msg || res.statusText}`);
          if (res.status === 401 || res.status === 400 || res.status === 403) {
            isAuthError = true;
          }
        }
      } catch (err: any) {
        console.warn(`[Binance UserData Stream] Network error acquiring listenKey:`, err.message || err);
      }

      if (!listenKey) {
        const retryDelay = isAuthError ? 60000 : 10000;
        console.warn(`[Binance UserData Stream] Could not acquire listenKey for API Key: ${cleanKey.slice(0, 8)}... Next retry in ${Math.round(retryDelay / 1000)}s`);
        setTimeout(() => ensureUserDataStream(cleanKey), retryDelay);
        return;
      }

      console.log(`📡 [Binance UserData Stream] Obtained listenKey: ${listenKey.slice(0, 10)}... Connecting WS...`);

      const wsUrls = [
        `wss://fstream.binance.com/ws/${listenKey}`
      ];

      let wsIndex = 0;
      const connectUserWs = () => {
        const targetWsUrl = wsUrls[wsIndex % wsUrls.length];
        const uws = new WebSocket(targetWsUrl);

        const instance: UserStreamInstance = {
          apiKey: cleanKey,
          listenKey,
          ws: uws,
          keepAliveTimer: null,
          lastConnected: Date.now()
        };

        uws.on('open', () => {
          console.log(`🟢 [Binance UserData Stream] Successfully connected to ${targetWsUrl}`);
          instance.lastConnected = Date.now();
          if (instance.keepAliveTimer) clearInterval(instance.keepAliveTimer);
          instance.keepAliveTimer = setInterval(async () => {
            try {
              await fetchWithFallback(`https://fapi.binance.com/fapi/v1/listenKey`, {
                method: "PUT",
                headers: { "X-MBX-APIKEY": cleanKey }
              });
              console.log(`🔄 [Binance UserData Stream] listenKey keep-alive ping sent successfully`);
            } catch (e: any) {
              console.warn(`[Binance UserData Stream] Keepalive error:`, e.message || e);
            }
          }, 20 * 60 * 1000);
        });

        uws.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString());
            if (!msg || !msg.e) return;

            if (msg.e === 'ORDER_TRADE_UPDATE' && msg.o) {
              const o = msg.o;
              console.log(`⚡ [Binance Instant Push] ORDER_TRADE_UPDATE received: ${o.s} ${o.S} ${o.X} | AvgPrice: ${o.ap || o.L} | Qty: ${o.z || o.q} | PnL: ${o.rp}`);
              
              broadcastToGeneralSubscribers({
                type: "BINANCE_ORDER_TRADE_UPDATE",
                data: {
                  symbol: o.s,
                  clientOrderId: o.c,
                  side: o.S,
                  orderType: o.o,
                  timeInForce: o.f,
                  origQty: parseFloat(o.q || "0"),
                  price: parseFloat(o.p || "0"),
                  avgPrice: parseFloat(o.ap || o.L || "0"),
                  executionType: o.x,
                  orderStatus: o.X,
                  orderId: String(o.i),
                  lastFilledQty: parseFloat(o.l || "0"),
                  cumFilledQty: parseFloat(o.z || "0"),
                  lastFilledPrice: parseFloat(o.L || "0"),
                  commission: parseFloat(o.n || "0"),
                  commissionAsset: o.N,
                  tradeTime: o.T || Date.now(),
                  tradeId: o.t,
                  positionSide: o.ps,
                  realizedPnl: parseFloat(o.rp || "0")
                }
              });
            } else if (msg.e === 'ACCOUNT_UPDATE' && msg.a) {
              broadcastToGeneralSubscribers({
                type: "BINANCE_ACCOUNT_UPDATE",
                data: msg.a
              });
            } else if (msg.e === 'listenKeyExpired') {
              console.warn(`⚠️ [Binance UserData Stream] listenKey expired. Reconnecting...`);
              if (instance.keepAliveTimer) clearInterval(instance.keepAliveTimer);
              activeUserStreams.delete(cleanKey);
              setTimeout(() => ensureUserDataStream(cleanKey), 1000);
            }
          } catch (err) {}
        });

        uws.on('close', () => {
          console.log(`🔴 [Binance UserData Stream] Connection closed for ${cleanKey.slice(0, 8)}... Auto-reconnecting in 2s`);
          if (instance.keepAliveTimer) clearInterval(instance.keepAliveTimer);
          activeUserStreams.delete(cleanKey);
          wsIndex++;
          setTimeout(() => ensureUserDataStream(cleanKey), 2000);
        });

        uws.on('error', (err: any) => {
          console.warn(`⚠️ [Binance UserData Stream] Error:`, err.message || err);
          try { uws.close(); } catch (e) {}
        });

        activeUserStreams.set(cleanKey, instance);
      };

      connectUserWs();

    } catch (err: any) {
      console.warn(`[Binance UserData Stream] Initialization error:`, err.message || err);
      setTimeout(() => ensureUserDataStream(cleanKey), 5000);
    }
  }

  // Initialize WebSocket server instance
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws, req) => {
    const clientUrl = req.url || '';
    
    if (clientUrl.includes('/api/ws-prices')) {
      console.log("🟢 Browser client subscribed to real-time prices stream");
      priceSubscribers.add(ws);
      
      // Immediately push latest cached prices so the browser has instant market data upon connection
      if (latestTickerPrices.size > 0) {
        const snapshot: any[] = [];
        for (const [symbol, price] of latestTickerPrices.entries()) {
          snapshot.push({ s: symbol, c: price.toString() });
        }
        try {
          ws.send(JSON.stringify(snapshot));
        } catch (e) {}
      }
      
      ws.on("close", () => {
        console.log("🔴 Browser client unsubscribed from real-time prices stream");
        priceSubscribers.delete(ws);
      });
      
      ws.on("error", () => {
        priceSubscribers.delete(ws);
      });
    } else {
      console.log("🟢 Client connected to default WebSocket (User Data & Trade Updates)");
      generalSubscribers.add(ws);
      
      // Send initial connection success message for general terminal
      ws.send(JSON.stringify({ type: "SYSTEM", message: "Connected to Trading Engine Server" }));
  
      ws.on("message", (message) => {
        try {
          const parsed = JSON.parse(message.toString());
          if (parsed && parsed.type === "REGISTER_BINANCE_API" && parsed.apiKey) {
            ensureUserDataStream(parsed.apiKey);
          }
        } catch (e) {}
      });
  
      ws.on("close", () => {
        console.log("🔴 Client disconnected from default WebSocket");
        generalSubscribers.delete(ws);
      });

      ws.on("error", () => {
        generalSubscribers.delete(ws);
      });
    }
  });

  // Start the server-side active WebSocket pricing bridge
  startBinanceWSBridge();

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

    let cachedExchangeInfo: any = null;
    let lastExchangeInfoFetch = 0;

    async function getExchangeInfo() {
        const now = Date.now();
        if (cachedExchangeInfo && (now - lastExchangeInfoFetch < 12 * 60 * 60 * 1000)) {
            return cachedExchangeInfo;
        }
        try {
            console.log("🔄 Fetching Binance Futures exchangeInfo...");
            const response = await fetch("https://fapi.binance.com/fapi/v1/exchangeInfo");
            if (response.ok) {
                const data = await response.json();
                cachedExchangeInfo = data;
                lastExchangeInfoFetch = now;
                if (data && Array.isArray(data.symbols)) {
                    for (const s of data.symbols) {
                        const lotFilter = s.filters?.find((f: any) => f.filterType === "LOT_SIZE");
                        const notionalFilter = s.filters?.find((f: any) => f.filterType === "MIN_NOTIONAL" || f.filterType === "NOTIONAL");
                        symbolFilterCache.set(s.symbol, {
                            stepSize: lotFilter ? parseFloat(lotFilter.stepSize || "0.0001") : 0.0001,
                            minQty: lotFilter ? parseFloat(lotFilter.minQty || "0.0001") : 0.0001,
                            qtyPrecision: parseInt(s.quantityPrecision || "4"),
                            minNotional: notionalFilter ? parseFloat(notionalFilter.notional || notionalFilter.minNotional || "20") : 20.0
                        });
                    }
                }
                return data;
            }
        } catch (e) {
            console.error("Failed to fetch exchangeInfo:", e);
        }
        return cachedExchangeInfo;
    }

    // Pre-warm exchangeInfo on server startup
    getExchangeInfo().catch(err => console.warn("ExchangeInfo pre-warm warning:", err));

    function formatBinanceSymbol(symbol: string): string {
        const clean = symbol.toUpperCase().trim();
        if (clean.endsWith("USDT")) {
            return clean;
        }
        return clean + "USDT";
    }

    async function fetchWithFallback(urlStr: string, options: RequestInit = {}): Promise<Response> {
        // Binance official endpoint
        const targetUrl = urlStr;
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 6000); // 6s timeout
            const res = await fetch(targetUrl, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(timeout);
            return res;
        } catch (err: any) {
            console.error(`[Binance Fetch] Request to ${urlStr} failed:`, err.message || err);
            throw err;
        }
    }

    // Cache for dual-side position mode (Hedge Mode vs One-way Mode) per API key (24h TTL)
    const dualSideModeCache = new Map<string, { isHedge: boolean, expiry: number }>();
    // High-performance pre-parsed symbol filter memory cache
    const symbolFilterCache = new Map<string, { stepSize: number, minQty: number, qtyPrecision: number, minNotional: number }>();
    // Cache for account balance and active positions to prevent 429 rate limit
    const accountStateCache = new Map<string, { data: any, timestamp: number }>();
    const userTradesCache = new Map<string, { data: any, timestamp: number }>();

    app.post("/api/binance/order", async (req, res) => {
        const { apiKey, apiSecret, symbol, side, action, quantity, amountUsdt, leverage } = req.body;
        if (!apiKey || !apiSecret || !symbol || !side || !action) {
            return res.status(400).json({ success: false, error: "缺少必要参数 (apiKey, apiSecret, symbol, side, action)" });
        }

        const formattedSymbol = formatBinanceSymbol(symbol);
        let appliedLeverage: number = parseInt(leverage || "20");

        try {
            // 1. Set leverage ONLY if action is OPEN (skipping for CLOSE/amputation to eliminate unnecessary REST roundtrip delay)
            if (action === "OPEN") {
                const targetLeverage = parseInt(leverage || "20");
                appliedLeverage = targetLeverage;
                try {
                    console.log(`[Binance Order] Setting leverage to ${targetLeverage}x for ${formattedSymbol}...`);
                    const setLeverageFn = async (lev: number) => {
                        const levTimestamp = Date.now();
                        const levQueryString = `leverage=${lev}&symbol=${formattedSymbol}&timestamp=${levTimestamp}&recvWindow=5000`;
                        const levSignature = crypto
                            .createHmac("sha256", apiSecret)
                            .update(levQueryString)
                            .digest("hex");
                        return await fetchWithFallback(`https://fapi.binance.com/fapi/v1/leverage?${levQueryString}&signature=${levSignature}`, {
                            method: "POST",
                            headers: { "X-MBX-APIKEY": apiKey }
                        });
                    };

                    let levResponse = await setLeverageFn(targetLeverage);
                    
                    if (levResponse.ok) {
                        const levJson = await levResponse.json();
                        appliedLeverage = levJson.leverage || targetLeverage;
                        console.log(`[Binance Order] Successfully set leverage to ${appliedLeverage}x`);
                    } else {
                        const levErrText = await levResponse.text();
                        console.log(`[Binance Order] Leverage setting note: ${targetLeverage}x returned ${levErrText}. Auto-adapting leverage...`);
                        
                        let adaptiveSuccess = false;

                        // Fast Path 1: Check if error message explicitly tells us the maximum leverage limit (e.g. "cannot exceed 5x leverage")
                        const exceedMatch = levErrText.match(/cannot exceed\s+(\d+)x/i) || levErrText.match(/maximum leverage is\s+(\d+)x/i) || levErrText.match(/max(?:imum)?\s+(\d+)x/i);
                        if (exceedMatch && exceedMatch[1]) {
                            const maxLimit = parseInt(exceedMatch[1]);
                            if (maxLimit > 0 && maxLimit < targetLeverage) {
                                console.log(`[Binance Order] Detected exact symbol leverage limit: ${maxLimit}x for ${formattedSymbol}. Retrying...`);
                                const retryRes = await setLeverageFn(maxLimit);
                                if (retryRes.ok) {
                                    const rJson = await retryRes.json();
                                    appliedLeverage = rJson.leverage || maxLimit;
                                    adaptiveSuccess = true;
                                    console.log(`[Binance Order] Auto-adaptive leverage matched directly: ${appliedLeverage}x`);
                                }
                            }
                        }
                        
                        // Fast Path 2: If not matched via message, probe 10x or 5x directly in 1 fast step (skip 10 sequential roundtrips)
                        if (!adaptiveSuccess) {
                            const candidateLevs = [10, 5, 2].filter(l => l < targetLeverage);
                            for (const cLev of candidateLevs) {
                                const retryRes = await setLeverageFn(cLev);
                                if (retryRes.ok) {
                                    const rJson = await retryRes.json();
                                    appliedLeverage = rJson.leverage || cLev;
                                    adaptiveSuccess = true;
                                    console.log(`[Binance Order] Fast auto-adaptive leverage matched: ${appliedLeverage}x for ${formattedSymbol}`);
                                    break;
                                }
                            }
                        }

                        if (!adaptiveSuccess) {
                            try {
                                const levErrJson = JSON.parse(levErrText);
                                if (levErrJson.msg) {
                                    if (levErrJson.code === -2015) {
                                        return res.status(400).json({
                                            success: false,
                                            error: `【币安 API Key 或 IP 权限受限】${levErrJson.msg}。如果您的币安 API Key 开启了 IP 白名单限制，请将当前服务器出口 IP 添加至币安 API 白名单中，或在币安 API 设置中勾选“允许合约/期货交易”权限！`
                                        });
                                    } else if (levErrJson.code === -4028) {
                                        return res.status(400).json({
                                            success: false,
                                            error: `【杠杆倍数不支持】${levErrJson.msg}。币安限制了该币种允许的最大杠杆倍数（例如部分新币或高波动币种最高仅支持 10x 或 5x），请在设置中调低全局/单币杠杆倍数！`
                                        });
                                    }
                                    return res.status(400).json({
                                        success: false,
                                        error: `【杠杆设置失败】${levErrJson.msg}。币安限制了该币种的最大杠杆倍数，自动匹配未能成功，请检查币安账户权限或在设置中调低杠杆！`
                                    });
                                }
                            } catch {}
                        }
                    }
                } catch (e: any) {
                    console.warn(`[Binance Order] Exception while setting leverage:`, e);
                }
            }

            // 2. Get current ticker price to calculate quantity or validate notional value (only fetch REST if quantity not provided)
            let currentPrice = latestTickerPrices.get(formattedSymbol) || 0;
            let finalQty = quantity;

            if ((!finalQty || finalQty <= 0) && currentPrice <= 0) {
                console.log(`[Binance Order] Fetching price for ${formattedSymbol} from Binance REST...`);
                try {
                    const priceResponse = await fetchWithFallback(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${formattedSymbol}`);
                    if (priceResponse.ok) {
                        const priceData = await priceResponse.json();
                        currentPrice = parseFloat(priceData.price || "0");
                        if (currentPrice > 0) {
                            latestTickerPrices.set(formattedSymbol, currentPrice);
                        }
                    }
                } catch (err: any) {
                    console.warn(`[Binance Order] REST price fetch warning:`, err.message || err);
                }
            }

            if (!finalQty && amountUsdt && currentPrice > 0) {
                finalQty = amountUsdt / currentPrice;
                console.log(`[Binance Order] Calculated qty for ${formattedSymbol}: ${finalQty} (${amountUsdt} USDT @ ${currentPrice})`);
            }

            if (!finalQty || isNaN(finalQty) || finalQty <= 0) {
                return res.status(400).json({ success: false, error: "无法确定合法的交易数量 (quantity 必须大于0)" });
            }

            // 2. Adjust quantity according to symbol filter (LOT_SIZE stepSize, precision and MIN_NOTIONAL)
            let minNotional = 20.0;
            let stepSize = 0.0001;
            let qtyPrecision = 4;
            let minQty = 0.0001;

            const symCachedFilter = symbolFilterCache.get(formattedSymbol);
            if (symCachedFilter) {
                stepSize = symCachedFilter.stepSize;
                minQty = symCachedFilter.minQty;
                qtyPrecision = symCachedFilter.qtyPrecision;
                minNotional = symCachedFilter.minNotional;
            } else {
                const exchangeInfo = await getExchangeInfo();
                if (exchangeInfo && exchangeInfo.symbols) {
                    const symInfo = exchangeInfo.symbols.find((s: any) => s.symbol === formattedSymbol);
                    if (symInfo) {
                        qtyPrecision = parseInt(symInfo.quantityPrecision || "4");
                        const lotFilter = symInfo.filters?.find((f: any) => f.filterType === "LOT_SIZE");
                        if (lotFilter) {
                            stepSize = parseFloat(lotFilter.stepSize || "0.0001");
                            minQty = parseFloat(lotFilter.minQty || "0.0001");
                        }
                        const notionalFilter = symInfo.filters?.find((f: any) => f.filterType === "MIN_NOTIONAL" || f.filterType === "NOTIONAL");
                        if (notionalFilter) {
                            const parsedNotional = parseFloat(notionalFilter.notional || notionalFilter.minNotional || "20");
                            if (!isNaN(parsedNotional) && parsedNotional > 0) {
                                minNotional = parsedNotional;
                            }
                        }
                    }
                }
            }

            // Round down to stepSize initially
            let roundedQty = Math.floor(finalQty / stepSize) * stepSize;
            finalQty = parseFloat(roundedQty.toFixed(qtyPrecision));

            // Ensure notional requirement (MIN_NOTIONAL) for OPEN orders
            if (action === "OPEN" && currentPrice > 0) {
                const notionalValue = finalQty * currentPrice;
                if (notionalValue < minNotional) {
                    // Check if rounding or input was slightly under minNotional (e.g. 19.8 USDT instead of 20 USDT)
                    const minNeededQty = Math.ceil((minNotional / currentPrice) / stepSize) * stepSize;
                    const adjustedQty = parseFloat(minNeededQty.toFixed(qtyPrecision));
                    
                    // If user passed an amount or requested opening and it's close to minNotional, auto-align upward to satisfy minNotional
                    if (amountUsdt && amountUsdt >= minNotional * 0.75) {
                        console.log(`[Binance Order] Auto-adjusting quantity for ${formattedSymbol} from ${finalQty} to ${adjustedQty} (${(adjustedQty * currentPrice).toFixed(2)} USDT) to satisfy Binance MIN_NOTIONAL (${minNotional} USDT)`);
                        finalQty = adjustedQty;
                    } else if (finalQty * currentPrice < minNotional) {
                        return res.status(400).json({ 
                            success: false, 
                            error: `订单名义价值 (Notional Value) 为 ${(finalQty * currentPrice).toFixed(2)} USDT，低于币安该币种的最低下单限制 (${minNotional} USDT)。请将开仓金额设置为至少 ${minNotional} USDT。` 
                        });
                    }
                }
            }

            // Ensure it is not less than minQty
            if (finalQty < minQty) {
                if (action === "OPEN") {
                    finalQty = minQty;
                } else {
                    return res.status(400).json({ 
                        success: false, 
                        error: `交易数量 ${finalQty} 低于该币种的最小下单量限制 (${minQty})。请增加开仓金额。` 
                    });
                }
            }

            // 3. Check Dual Position Side mode (Hedge Mode vs One-way Mode)
            let isHedgeMode = true; // Binance Perpetual Futures default to Hedge Mode
            const cacheKey = `${apiKey.slice(0, 8)}_${apiSecret.slice(0, 8)}`;
            const cachedDual = dualSideModeCache.get(cacheKey);
            if (cachedDual && cachedDual.expiry > Date.now()) {
                isHedgeMode = cachedDual.isHedge;
            } else {
                const timestamp = Date.now();
                const dualQueryString = `timestamp=${timestamp}&recvWindow=5000`;
                const dualSignature = crypto
                    .createHmac("sha256", apiSecret)
                    .update(dualQueryString)
                    .digest("hex");

                try {
                    const dualResponse = await fetchWithFallback(`https://fapi.binance.com/fapi/v1/positionSide/dual?${dualQueryString}&signature=${dualSignature}`, {
                        headers: { "X-MBX-APIKEY": apiKey }
                    });

                    if (dualResponse.ok) {
                        const dualData = await dualResponse.json();
                        isHedgeMode = dualData.dualSidePosition === true;
                        dualSideModeCache.set(cacheKey, { isHedge: isHedgeMode, expiry: Date.now() + 24 * 60 * 60 * 1000 });
                        console.log(`[Binance Order] Position mode detected: ${isHedgeMode ? "Hedge Mode (双向持仓)" : "One-way Mode (单向持仓)"}`);
                    } else {
                        dualSideModeCache.set(cacheKey, { isHedge: true, expiry: Date.now() + 5 * 60 * 1000 });
                    }
                } catch (err: any) {
                    dualSideModeCache.set(cacheKey, { isHedge: true, expiry: Date.now() + 5 * 60 * 1000 });
                    console.warn(`[Binance Order] Exception while fetching position mode: ${err.message || err}. Defaulting to Hedge Mode`);
                }
            }

            // 3.5 Handle CLOSE action safety checks (Optimized for lightning-fast execution & zero slippage delay)
            if (action === "CLOSE") {
                const cancelTimestamp = Date.now();
                const cancelQueryString = `symbol=${formattedSymbol}&timestamp=${cancelTimestamp}&recvWindow=5000`;
                const cancelSignature = crypto
                    .createHmac("sha256", apiSecret)
                    .update(cancelQueryString)
                    .digest("hex");

                // Asynchronously cancel any open limit/stop orders in the background without blocking the market close order
                fetchWithFallback(`https://fapi.binance.com/fapi/v1/allOpenOrders?${cancelQueryString}&signature=${cancelSignature}`, {
                    method: "DELETE",
                    headers: { "X-MBX-APIKEY": apiKey }
                }).catch(err => {
                    console.warn(`[Binance Order] [Background Fast-Close] Open orders cancel warning:`, err.message || err);
                });
            }

            // 3.6 Handle OPEN action duplicate prevention (Physical Interceptor on Binance with rapid 1.5s non-blocking check)
            // 🔒 [第三层：服务端网关级防连续重复补仓硬锁]
            if (action === "OPEN" && req.body.isRefill === true) {
                const refillKey = `${apiKey.slice(-6)}_${formattedSymbol}_${side}`;
                const lastRefillReq = serverRefillFloodGuard.get(refillKey) || 0;
                const now = Date.now();
                if (now - lastRefillReq < 10000) {
                    console.warn(`[Binance Order] 🛡️ [防连续重复补仓拦截] ${formattedSymbol} ${side} 距离上次补仓仅 ${now - lastRefillReq}ms，10秒内严禁连续重复补仓！已由服务端原地拦截。`);
                    return res.status(200).json({
                        success: false,
                        orderId: "REFILL_FLOOD_PREVENTED",
                        error: `[防连续重复补仓拦截] ${formattedSymbol} ${side} 10秒内严禁连续重复补仓 (距离上次: ${((now - lastRefillReq) / 1000).toFixed(1)}秒)`
                    });
                }
                serverRefillFloodGuard.set(refillKey, now);
            }

            // 🔒 REFILL (断臂求生补仓/对冲加仓) 允许在现有持仓上继续开仓买回，严禁拦截！
            const isRefillOrHedge = req.body.isRefill === true || req.body.allowExisting === true || req.body.isHedge === true;
            if (action === "OPEN" && !isRefillOrHedge) {
                try {
                    const posTimestamp = Date.now();
                    const posQueryString = `symbol=${formattedSymbol}&timestamp=${posTimestamp}&recvWindow=5000`;
                    const posSignature = crypto
                        .createHmac("sha256", apiSecret)
                        .update(posQueryString)
                        .digest("hex");

                    const posRes = await Promise.race([
                        fetchWithFallback(`https://fapi.binance.com/fapi/v2/positionRisk?${posQueryString}&signature=${posSignature}`, {
                            headers: { "X-MBX-APIKEY": apiKey }
                        }),
                        new Promise<null>(resolve => setTimeout(() => resolve(null), 1500))
                    ]);
                    if (posRes && posRes.ok) {
                        const positionsData = await posRes.json();
                        if (Array.isArray(positionsData)) {
                            let currentExistingAmt = 0;
                            if (isHedgeMode) {
                                const targetSide = side === "LONG" ? "LONG" : "SHORT";
                                const matched = positionsData.find((p: any) => p.positionSide === targetSide);
                                if (matched) {
                                    currentExistingAmt = Math.abs(parseFloat(matched.positionAmt || "0"));
                                }
                            } else {
                                const matched = positionsData.find((p: any) => p.positionSide === "BOTH");
                                if (matched) {
                                    const rawAmt = parseFloat(matched.positionAmt || "0");
                                    if ((side === "LONG" && rawAmt > 0) || (side === "SHORT" && rawAmt < 0)) {
                                        currentExistingAmt = Math.abs(rawAmt);
                                    }
                                }
                            }

                            // 🔒 If position already exists on Binance with valid size, intercept duplicate open!
                            if (currentExistingAmt > 0) {
                                console.log(`[Binance Order] [Anti-Duplicate] ${formattedSymbol} (${side}) already exists on Binance with amount ${currentExistingAmt}. Intercepting duplicate OPEN order!`);
                                return res.json({
                                    success: false,
                                    intercepted: true,
                                    orderId: "EXISTING_POSITION_INTERCEPTED",
                                    symbol: formattedSymbol,
                                    side: side === "LONG" ? "BUY" : "SELL",
                                    positionSide: isHedgeMode ? (side === "LONG" ? "LONG" : "SHORT") : undefined,
                                    qty: currentExistingAmt,
                                    price: currentPrice,
                                    leverage: appliedLeverage,
                                    error: `币安已存在 ${formattedSymbol} (${side}) 真实持仓 (${currentExistingAmt})，系统已物理拦截重复开仓！`
                                });
                            }
                        }
                    }
                } catch (err) {
                    console.warn(`[Binance Order] [Anti-Duplicate] Position risk check warning:`, err);
                }
            }

            // 4. Map Action & Side to Binance Futures parameters
            // Side in request: "LONG" or "SHORT"
            // Action in request: "OPEN" or "CLOSE"
            let binanceSide: "BUY" | "SELL";
            let binancePositionSide: "LONG" | "SHORT" | undefined = undefined;

            if (isHedgeMode) {
                binancePositionSide = side === "LONG" ? "LONG" : "SHORT";
                if (action === "OPEN") {
                    binanceSide = side === "LONG" ? "BUY" : "SELL";
                } else { // CLOSE
                    binanceSide = side === "LONG" ? "SELL" : "BUY";
                }
            } else {
                // One-way mode
                if (action === "OPEN") {
                    binanceSide = side === "LONG" ? "BUY" : "SELL";
                } else { // CLOSE
                    binanceSide = side === "LONG" ? "SELL" : "BUY";
                }
            }

            // 5. Construct order parameters
            const orderParams: any = {
                symbol: formattedSymbol,
                side: binanceSide,
                type: "MARKET",
                quantity: finalQty.toString(),
                timestamp: Date.now().toString(),
                recvWindow: "5000"
            };

            if (binancePositionSide) {
                orderParams.positionSide = binancePositionSide;
            } else if (action === "CLOSE") {
                orderParams.reduceOnly = "true";
            }

            // Convert parameters to sorted query string for signature
            const orderQueryString = Object.keys(orderParams)
                .sort()
                .map(key => `${key}=${encodeURIComponent(orderParams[key])}`)
                .join("&");

            const orderSignature = crypto
                .createHmac("sha256", apiSecret)
                .update(orderQueryString)
                .digest("hex");

            const finalOrderUrl = `https://fapi.binance.com/fapi/v1/order?${orderQueryString}&signature=${orderSignature}`;

            console.log(`[Binance Order] Executing real MARKET order on Binance: ${formattedSymbol} | Side: ${binanceSide} | positionSide: ${binancePositionSide || 'N/A'} | Qty: ${finalQty}`);

            const orderResponse = await fetchWithFallback(finalOrderUrl, {
                method: "POST",
                headers: {
                    "X-MBX-APIKEY": apiKey,
                    "Content-Type": "application/json"
                }
            });

            const orderText = await orderResponse.text();
            let orderData;
            try {
                orderData = JSON.parse(orderText);
            } catch (e) {
                console.warn(`[Binance Order] Failed to parse response as JSON. Raw response: ${orderText}`);
                return res.status(502).json({
                    success: false,
                    error: `币安交易所返回了非 JSON 格式的响应: ${orderResponse.status} - ${orderText.substring(0, 100)}`
                });
            }

            if (orderResponse.ok) {
                console.log(`[Binance Order] Success! Order ID: ${orderData.orderId}`);
                const rawAvgPrice = parseFloat(orderData.avgPrice || "0");
                const rawExecQty = parseFloat(orderData.executedQty || "0");
                const rawCumQuote = parseFloat(orderData.cumQuote || "0");
                const avgPrice = rawAvgPrice > 0 ? rawAvgPrice : (rawExecQty > 0 && rawCumQuote > 0 ? (rawCumQuote / rawExecQty) : currentPrice);
                const executedQty = rawExecQty > 0 ? rawExecQty : finalQty;
                const executedQuote = rawCumQuote > 0 ? rawCumQuote : (executedQty * avgPrice);

                // Invalidate account cache immediately so UI sync receives new position state instantly
                const userCacheKey = `${apiKey.substring(0, 10)}_${apiKey.slice(-6)}`;
                accountStateCache.delete(userCacheKey);

                // 🔒 核心提速：立即清除该 API Key 的成交流水缓存，绝不让后续抓取命中陈旧缓存
                const apiKeyPrefix = apiKey.substring(0, 10);
                for (const key of userTradesCache.keys()) {
                    if (key.startsWith(apiKeyPrefix)) {
                        userTradesCache.delete(key);
                    }
                }

                // Auto ensure User Data Stream is alive for this API Key
                ensureUserDataStream(apiKey);

                // ⚡ 1. Immediately push instant execution update to browser WebSocket (0ms delay)
                broadcastToGeneralSubscribers({
                    type: "BINANCE_ORDER_TRADE_UPDATE",
                    data: {
                        symbol: formattedSymbol,
                        clientOrderId: orderData.clientOrderId,
                        side: binanceSide,
                        orderType: "MARKET",
                        origQty: executedQty,
                        price: avgPrice,
                        avgPrice: avgPrice,
                        executionType: "TRADE",
                        orderStatus: orderData.status || "FILLED",
                        orderId: String(orderData.orderId),
                        lastFilledQty: executedQty,
                        cumFilledQty: executedQty,
                        lastFilledPrice: avgPrice,
                        tradeTime: orderData.updateTime || Date.now(),
                        positionSide: binancePositionSide || (side === "LONG" ? "LONG" : "SHORT"),
                        realizedPnl: 0,
                        action: action
                    }
                });

                // ⚡ 2. Instant 0ms synchronous trade probe before responding, to include executed trades directly in response
                let initialTrades: any[] = [];
                let matchingTrade: any = null;
                try {
                    const timeOffset = await syncBinanceServerTime();
                    const immediateTimestamp = Date.now() + timeOffset;
                    const immediateQueryString = `symbol=${formattedSymbol}&timestamp=${immediateTimestamp}&recvWindow=10000`;
                    const immediateSignature = crypto
                        .createHmac("sha256", apiSecret)
                        .update(immediateQueryString)
                        .digest("hex");

                    const userTradeController = new AbortController();
                    const userTradeTimeout = setTimeout(() => userTradeController.abort(), 800);
                    const userTradeRes = await fetchWithFallback(`https://fapi.binance.com/fapi/v1/userTrades?${immediateQueryString}&limit=5&signature=${immediateSignature}`, {
                        headers: { "X-MBX-APIKEY": apiKey },
                        signal: userTradeController.signal
                    });
                    clearTimeout(userTradeTimeout);
                    if (userTradeRes.ok) {
                        const trades = await userTradeRes.json();
                        if (Array.isArray(trades) && trades.length > 0) {
                            initialTrades = trades;
                            matchingTrade = trades.find((t: any) => String(t.orderId) === String(orderData.orderId)) || trades[trades.length - 1];
                            if (matchingTrade) {
                                const instantPnl = matchingTrade.realizedPnl !== undefined ? parseFloat(matchingTrade.realizedPnl) : 0;
                                const fillPrice = matchingTrade.price ? parseFloat(matchingTrade.price) : avgPrice;
                                const fillQty = matchingTrade.qty ? parseFloat(matchingTrade.qty) : executedQty;
                                broadcastToGeneralSubscribers({
                                    type: "BINANCE_ORDER_TRADE_UPDATE",
                                    data: {
                                        symbol: formattedSymbol,
                                        clientOrderId: orderData.clientOrderId,
                                        side: binanceSide,
                                        orderType: "MARKET",
                                        origQty: fillQty,
                                        price: fillPrice,
                                        avgPrice: fillPrice,
                                        executionType: "TRADE",
                                        orderStatus: "FILLED",
                                        orderId: String(matchingTrade.orderId || orderData.orderId),
                                        lastFilledQty: fillQty,
                                        cumFilledQty: fillQty,
                                        lastFilledPrice: fillPrice,
                                        tradeTime: matchingTrade.time || Date.now(),
                                        positionSide: binancePositionSide || (side === "LONG" ? "LONG" : "SHORT"),
                                        realizedPnl: instantPnl,
                                        action: action
                                    }
                                });
                            }
                        }
                    }
                } catch (tradeProbeErr) {
                    // Silent catch for immediate trade probe
                }

                // ⚡ 3. High-velocity millisecond multi-burst active probe to grab latest trades & match records in background
                const runActiveTradeProbe = async (delayMs: number) => {
                    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
                    try {
                        const timeOffset = await syncBinanceServerTime();
                        const immediateTimestamp = Date.now() + timeOffset;
                        const immediateQueryString = `symbol=${formattedSymbol}&timestamp=${immediateTimestamp}&recvWindow=10000`;
                        const immediateSignature = crypto
                            .createHmac("sha256", apiSecret)
                            .update(immediateQueryString)
                            .digest("hex");

                        const userTradeRes = await fetchWithFallback(`https://fapi.binance.com/fapi/v1/userTrades?${immediateQueryString}&limit=10&signature=${immediateSignature}`, {
                            headers: { "X-MBX-APIKEY": apiKey }
                        });
                        if (userTradeRes.ok) {
                            const trades = await userTradeRes.json();
                            if (Array.isArray(trades) && trades.length > 0) {
                                const matchingTrade = trades.find((t: any) => String(t.orderId) === String(orderData.orderId)) || trades[trades.length - 1];
                                if (matchingTrade) {
                                    const instantPnl = matchingTrade.realizedPnl !== undefined ? parseFloat(matchingTrade.realizedPnl) : 0;
                                    const fillPrice = matchingTrade.price ? parseFloat(matchingTrade.price) : avgPrice;
                                    const fillQty = matchingTrade.qty ? parseFloat(matchingTrade.qty) : executedQty;
                                    broadcastToGeneralSubscribers({
                                        type: "BINANCE_ORDER_TRADE_UPDATE",
                                        data: {
                                            symbol: formattedSymbol,
                                            clientOrderId: orderData.clientOrderId,
                                            side: binanceSide,
                                            orderType: "MARKET",
                                            origQty: fillQty,
                                            price: fillPrice,
                                            avgPrice: fillPrice,
                                            executionType: "TRADE",
                                            orderStatus: "FILLED",
                                            orderId: String(matchingTrade.orderId || orderData.orderId),
                                            lastFilledQty: fillQty,
                                            cumFilledQty: fillQty,
                                            lastFilledPrice: fillPrice,
                                            tradeTime: matchingTrade.time || Date.now(),
                                            positionSide: binancePositionSide || (side === "LONG" ? "LONG" : "SHORT"),
                                            realizedPnl: instantPnl,
                                            action: action
                                        }
                                    });
                                }
                            }
                        }
                    } catch (tradeProbeErr) {
                        // Silent catch for background probe
                    }
                };

                // Multi-burst probes at 80ms, 250ms, 600ms, 1200ms
                runActiveTradeProbe(80);
                runActiveTradeProbe(250);
                runActiveTradeProbe(600);
                runActiveTradeProbe(1200);

                return res.json({
                    success: true,
                    orderId: orderData.orderId,
                    clientOrderId: orderData.clientOrderId,
                    symbol: formattedSymbol,
                    side: binanceSide,
                    positionSide: binancePositionSide,
                    qty: executedQty,
                    price: avgPrice,
                    cumQuote: executedQuote,
                    realizedPnl: 0,
                    status: orderData.status,
                    updateTime: orderData.updateTime || Date.now(),
                    leverage: appliedLeverage,
                    trades: initialTrades,
                    latestTrade: matchingTrade,
                    message: `成功在币安下单: ${action === "OPEN" ? "开仓" : "平仓"} ${side} ${formattedSymbol} ${executedQty} 手（杠杆: ${appliedLeverage}x）！`
                });
            } else {
                const errorCode = orderData.code;
                const errorMsg = orderData.msg || orderText;

                // Handle code -2022: "ReduceOnly Order is rejected"
                if (errorCode === -2022 && action === "CLOSE") {
                    console.log(`[Binance Order] ReduceOnly rejected for ${formattedSymbol} (${side}). Checking if position is already closed on Binance...`);
                    try {
                        const checkPosTimestamp = Date.now();
                        const checkPosQuery = `symbol=${formattedSymbol}&timestamp=${checkPosTimestamp}&recvWindow=5000`;
                        const checkPosSig = crypto.createHmac("sha256", apiSecret).update(checkPosQuery).digest("hex");
                        const checkPosRes = await fetchWithFallback(`https://fapi.binance.com/fapi/v2/positionRisk?${checkPosQuery}&signature=${checkPosSig}`, {
                            headers: { "X-MBX-APIKEY": apiKey }
                        });
                        if (checkPosRes.ok) {
                            const pData = await checkPosRes.json();
                            if (Array.isArray(pData)) {
                                let remAmt = 0;
                                if (isHedgeMode) {
                                    const tSide = side === "LONG" ? "LONG" : "SHORT";
                                    const match = pData.find((p: any) => p.positionSide === tSide);
                                    if (match) remAmt = Math.abs(parseFloat(match.positionAmt || "0"));
                                } else {
                                    const match = pData.find((p: any) => p.positionSide === "BOTH");
                                    if (match) {
                                        const raw = parseFloat(match.positionAmt || "0");
                                        if ((side === "LONG" && raw > 0) || (side === "SHORT" && raw < 0)) {
                                            remAmt = Math.abs(raw);
                                        }
                                    }
                                }
                                if (remAmt === 0) {
                                    console.log(`[Binance Order] Verified position for ${formattedSymbol} (${side}) is already 0. Treating as successful close.`);
                                    return res.json({
                                        success: true,
                                        orderId: "ALREADY_CLOSED",
                                        symbol: formattedSymbol,
                                        side: binanceSide,
                                        positionSide: binancePositionSide,
                                        qty: 0,
                                        price: currentPrice,
                                        leverage: appliedLeverage,
                                        message: `仓位在币安已处于已结清/已平仓状态`
                                    });
                                }
                            }
                        }
                    } catch (e) {
                        console.warn(`[Binance Order] Error re-checking position on -2022:`, e);
                    }
                }
                
                let userFriendlyError = `币安交易所请求失败: ${errorMsg}`;
                if (errorCode === -2022) {
                    userFriendlyError = "【只减仓订单被拒绝/仓位已平】该仓位在币安当前已无持仓或已被平仓完毕，无需重复提交平仓。";
                } else if (errorCode === -2015) {
                    userFriendlyError = "币安 API 密钥无效或权限不足！请检查：1. 是否已在币安开启“期货交易 (Enable Futures)”权限；2. API Key 是否正确；3. 是否设置了 IP 限制。";
                } else if (errorCode === -4411 || (typeof errorMsg === 'string' && (errorMsg.includes("Please sign TradFi-Perps agreement") || errorMsg.includes("agreement contract")))) {
                    userFriendlyError = "【需要签署币安合约协议】请登录您的币安 Web 网页端 or 币安 App，在合约/期权交易页面根据提示同意并签署《永续合约服务协议/TradFi-Perps Agreement》，然后再重新尝试下单。";
                } else if (errorCode === -4164 || (typeof errorMsg === 'string' && (errorMsg.includes("Order's notional must be no smaller than") || errorMsg.includes("notional must be no smaller than")))) {
                    userFriendlyError = "【订单名义价值过低】币安规定单笔订单名义价值（价格 * 数量）不能小于 20 USDT。请在设置中增加下单本金/子弹金额，或提高杠杆倍数，确保开仓价值不低于 20 USDT！";
                } else if (errorCode === -2027) {
                    userFriendlyError = "【超出当前杠杆最大持仓限额】下单数量或金额已超出您当前杠杆倍数下允许的最大持仓额度。请前往币安 App 或网页端调低该币种的杠杆倍数（例如降至 20x 或以下），或者在设置中减小下单本金/子弹金额。";
                } else if (errorCode === -4140) {
                    userFriendlyError = "【该交易对当前状态无法开仓】该币种在币安当前不可开仓（正处于非交易状态、停牌、清算或交易所已下线该合约且仅允许平仓）。请在设置中将其加入黑名单，或换其他币种。";
                } else if (errorCode === -1015) {
                    userFriendlyError = "【下单过于频繁，触发币安限频】系统在 10 秒内触发了多于 20 笔订单，触及了交易所的安全风控。请稍微等待 10-15 秒后再尝试，或者调大系统扫描或运行间隔。";
                }
                
                console.warn(`[Binance Order] Failed: ${JSON.stringify(orderData)}`);
                return res.status(orderResponse.status).json({
                    success: false,
                    error: userFriendlyError,
                    code: errorCode
                });
            }

        } catch (e: any) {
            console.warn("[Binance Order] Unexpected error:", e);
            return res.status(500).json({
                success: false,
                error: `下单执行异常: ${e.message || e}`
            });
        }
    });

    // 动态维护本地与币安服务器的时间偏差 (毫秒)
    let binanceTimeOffsetMs = 0;
    let lastTimeSyncTimestamp = 0;

    async function syncBinanceServerTime(): Promise<number> {
        const now = Date.now();
        if (lastTimeSyncTimestamp > 0 && (now - lastTimeSyncTimestamp < 60000)) {
            return binanceTimeOffsetMs;
        }
        const timeEndpoints = [
            "https://fapi.binance.com/fapi/v1/time",
            "https://api.binance.com/api/v3/time",
            "https://fapi1.binance.com/fapi/v1/time",
            "https://fapi2.binance.com/fapi/v1/time"
        ];
        for (const endpoint of timeEndpoints) {
            try {
                const reqStart = Date.now();
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 3000);
                const res = await fetch(endpoint, { signal: controller.signal });
                clearTimeout(timeout);
                if (res.ok) {
                    const data = await res.json();
                    const reqEnd = Date.now();
                    const rtt = reqEnd - reqStart;
                    if (data && typeof data.serverTime === 'number') {
                        binanceTimeOffsetMs = data.serverTime - (reqEnd - Math.floor(rtt / 2));
                        lastTimeSyncTimestamp = Date.now();
                        console.log(`[Binance TimeSync] Server time synced offset: ${binanceTimeOffsetMs}ms (RTT: ${rtt}ms)`);
                        return binanceTimeOffsetMs;
                    }
                }
            } catch (e) {}
        }
        return binanceTimeOffsetMs;
    }

    app.get("/api/server-ip", async (req, res) => {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);
            const response = await fetch("https://api.ipify.org?format=json", { signal: controller.signal });
            clearTimeout(timeout);
            if (response.ok) {
                const data = await response.json();
                return res.json({ success: true, ip: data.ip });
            } else {
                throw new Error(`Failed with status ${response.status}`);
            }
        } catch (e: any) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 4000);
                const response = await fetch("https://icanhazip.com", { signal: controller.signal });
                clearTimeout(timeout);
                if (response.ok) {
                    const ip = (await response.text()).trim();
                    return res.json({ success: true, ip });
                }
            } catch (inner: any) {}
            return res.json({ success: false, error: "无法获取出口IP: " + (e.message || e) });
        }
    });

    app.post("/api/binance/validate-and-balance", async (req, res) => {
        let { apiKey, apiSecret, force, bypassCache } = req.body;
        if (!apiKey || !apiSecret) {
            return res.json({ success: false, error: "请提供完整的 API Key 和 Secret Key" });
        }

        apiKey = typeof apiKey === 'string' ? apiKey.trim() : apiKey;
        apiSecret = typeof apiSecret === 'string' ? apiSecret.trim() : apiSecret;

        const cacheKey = `${apiKey.substring(0, 10)}_${apiKey.slice(-6)}`;
        const now = Date.now();
        const cached = accountStateCache.get(cacheKey);

        // Return fresh cache if within 5 seconds to reduce rate limit pressure (unless explicitly forced)
        if (!force && !bypassCache && cached && (now - cached.timestamp < 5000)) {
            return res.json(cached.data);
        }

        try {
            const timeOffset = await syncBinanceServerTime();
            const timestamp = Date.now() + timeOffset;
            const queryString = `timestamp=${timestamp}&recvWindow=60000`;
            const signature = crypto
                .createHmac("sha256", apiSecret)
                .update(queryString)
                .digest("hex");

            const baseUrls = [
                "https://fapi.binance.com",
                "https://fapi1.binance.com",
                "https://fapi2.binance.com",
                "https://fapi3.binance.com",
                "https://fapi4.binance.com"
            ];

            let lastError = null;
            let success = false;
            let resultData: any = null;
            let isRateLimitHit = false;

            for (const baseUrl of baseUrls) {
                const url = `${baseUrl}/fapi/v2/account?${queryString}&signature=${signature}`;
                try {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout
                    
                    const response = await fetch(url, {
                        method: "GET",
                        headers: {
                            "X-MBX-APIKEY": apiKey,
                            "Content-Type": "application/json"
                        },
                        signal: controller.signal
                    });
                    
                    clearTimeout(timeout);

                    if (response.ok) {
                        const responseText = await response.text();
                        if (responseText.trim().startsWith('<') || responseText.toLowerCase().includes('doctype html')) {
                            throw new Error("Received HTML error page instead of JSON");
                        }
                        const data = JSON.parse(responseText);
                        success = true;
                        resultData = data;
                        break; // Stop trying other URLs if successful
                    } else {
                        if (response.status === 429 || response.status === 418) {
                            isRateLimitHit = true;
                        }
                        const errText = await response.text();
                        let errMsg = errText;
                        try {
                            const errJson = JSON.parse(errText);
                            errMsg = errJson.msg || errText;
                        } catch (e) {}
                        lastError = `币安报错 (HTTP ${response.status}): ${errMsg}`;
                    }
                } catch (err: any) {
                    lastError = `连接币安网络错误: ${err.message || err}`;
                }
            }

            if (success && resultData) {
                const usdtAsset = resultData.assets?.find((a: any) => a.asset === "USDT");
                const marginBalance = usdtAsset ? parseFloat(usdtAsset.marginBalance) : 0;
                const walletBalance = usdtAsset ? parseFloat(usdtAsset.walletBalance) : 0;
                const availableBalance = usdtAsset ? parseFloat(usdtAsset.availableBalance) : 0;

                // Extract active positions where positionAmt is non-zero
                const activePositions = (resultData.positions || [])
                    .filter((p: any) => p && parseFloat(p.positionAmt || "0") !== 0)
                    .map((p: any) => {
                        const amount = parseFloat(p.positionAmt);
                        const side = amount > 0 ? "LONG" : "SHORT";
                        const entryPrice = parseFloat(p.entryPrice || "0");
                        const unrealizedPnL = parseFloat(p.unrealizedProfit || "0");
                        const liquidationPrice = parseFloat(p.liquidationPrice || "0");
                        const leverage = parseFloat(p.leverage || "20");
                        const maintMargin = parseFloat(p.maintMargin || "0");
                        
                        return {
                            symbol: p.symbol,
                            side: side,
                            amount: Math.abs(amount),
                            entryPrice: entryPrice,
                            markPrice: entryPrice, // Fallback, updated via realPrices
                            liquidationPrice: liquidationPrice,
                            unrealizedPnL: unrealizedPnL,
                            unrealizedPnLPercentage: entryPrice > 0 ? (unrealizedPnL / (Math.abs(amount) * entryPrice)) * 100 : 0,
                            entryId: `real_${p.symbol}_${side}_${p.updateTime || Date.now()}`,
                            entryTime: Date.now(),
                            leverage: leverage,
                            maintMargin: maintMargin
                        };
                    });

                const formattedResult = {
                    success: true,
                    marginBalance,
                    walletBalance,
                    availableBalance,
                    activePositions,
                    message: "API 校验连接成功！"
                };

                // Store in memory cache
                accountStateCache.set(cacheKey, {
                    data: formattedResult,
                    timestamp: Date.now()
                });

                // Auto ensure User Data Stream is alive for this API Key
                ensureUserDataStream(apiKey);

                return res.json(formattedResult);
            }

            // If rate limited or transient error but we have recent cache, return cache smoothly
            if (cached && (now - cached.timestamp < 120000)) {
                return res.json({
                    ...cached.data,
                    isCachedFallback: true,
                    rateLimited: isRateLimitHit
                });
            }

            if (isRateLimitHit) {
                return res.json({
                    success: false,
                    rateLimited: true,
                    error: `币安接口请求频率受限 (429 Rate Exceeded)，系统已启动自动退避与平滑重试机制。`
                });
            }

            return res.json({
                success: false,
                error: `API 校验连接失败: ${lastError || "无法连接至币安 API 节点。"}`
            });

        } catch (e: any) {
            return res.json({
                success: false,
                error: `系统在准备签名或发送请求时遇到错误: ${e.message || e}`
            });
        }
    });

    app.post("/api/binance/transfer", async (req, res) => {
        const { apiKey, apiSecret, asset, amount, type } = req.body;
        if (!apiKey || !apiSecret) {
            return res.status(400).json({ success: false, error: "请提供完整的 API Key 和 Secret Key" });
        }
        if (!asset || !amount || !type) {
            return res.status(400).json({ success: false, error: "请提供资产币种 (asset)、金额 (amount) 以及划转类型 (type)" });
        }

        try {
            const timeOffset = await syncBinanceServerTime();
            const timestamp = Date.now() + timeOffset;
            const queryString = `type=${type}&asset=${asset}&amount=${amount}&timestamp=${timestamp}&recvWindow=60000`;
            const signature = crypto
                .createHmac("sha256", apiSecret)
                .update(queryString)
                .digest("hex");

            const baseUrls = [
                "https://api.binance.com",
                "https://api1.binance.com",
                "https://api2.binance.com",
                "https://api3.binance.com"
            ];

            let lastError = null;
            let success = false;
            let resultData: any = null;

            for (const baseUrl of baseUrls) {
                const url = `${baseUrl}/sapi/v1/asset/transfer?${queryString}&signature=${signature}`;
                try {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout per node
                    
                    console.log(`[Binance API Transfer] Trying node: ${baseUrl}`);
                    const response = await fetch(url, {
                        method: "POST",
                        headers: {
                            "X-MBX-APIKEY": apiKey,
                            "Content-Type": "application/json"
                        },
                        signal: controller.signal
                    });
                    
                    clearTimeout(timeout);

                    const responseText = await response.text();
                    if (response.ok) {
                        if (responseText.trim().startsWith('<') || responseText.toLowerCase().includes('doctype html')) {
                            throw new Error("Received HTML error page instead of JSON");
                        }
                        const data = JSON.parse(responseText);
                        success = true;
                        resultData = data;
                        break; // Stop trying other URLs if successful
                    } else {
                        let errMsg = responseText;
                        try {
                            const errJson = JSON.parse(responseText);
                            errMsg = errJson.msg || responseText;
                        } catch (e) {}
                        lastError = `节点 ${baseUrl} 报错 (状态码 ${response.status}): ${errMsg}`;
                    }
                } catch (err: any) {
                    lastError = `连接节点 ${baseUrl} 发生错误: ${err.message || err}`;
                }
            }

            if (success && resultData) {
                return res.json({
                    success: true,
                    tranId: resultData.tranId,
                    message: "资产划转成功！"
                });
            }

            return res.status(502).json({
                success: false,
                error: `资产划转失败。${lastError || "无法连接至任何币安 API 节点。"}`
            });

        } catch (e: any) {
            return res.status(500).json({
                success: false,
                error: `系统在划转执行时遇到未知错误: ${e.message || e}`
            });
        }
    });

    // 启动/维持币安用户数据流 WebSocket (POST /api/binance/user-stream/start)
    app.post("/api/binance/user-stream/start", async (req, res) => {
        const { apiKey } = req.body || {};
        if (!apiKey) {
            return res.status(400).json({ success: false, error: "Missing apiKey" });
        }
        try {
            await ensureUserDataStream(apiKey);
            return res.json({ success: true, active: true });
        } catch (e: any) {
            return res.status(500).json({ success: false, error: e.message || e });
        }
    });

    // 币安实盘历史成交/交易账本对账接口 (POST /api/binance/user-trades)
    app.post("/api/binance/user-trades", async (req, res) => {
        const { apiKey, apiSecret, symbol, startTime, limit, force, bypassCache } = req.body;
        if (!apiKey || !apiSecret) {
            return res.status(400).json({ success: false, error: "请提供完整的 API Key 和 Secret Key" });
        }

        const startTimestamp = startTime ? parseInt(String(startTime)) : 0;
        const cacheKey = `${apiKey.substring(0, 10)}_${symbol || (Array.isArray(req.body.symbols) ? req.body.symbols.join(',') : "ALL")}`;
        const now = Date.now();
        const cached = userTradesCache.get(cacheKey);

        // 2 seconds cache for trades during fast polling (bypass if forced)
        if (!force && !bypassCache && cached && (now - cached.timestamp < 2000)) {
            const filteredCached = startTimestamp > 0 
                ? (cached.data || []).filter((t: any) => (parseInt(t.time || t.timestamp || "0") || 0) > startTimestamp)
                : cached.data;
            return res.json({ success: true, trades: filteredCached });
        }

        try {
            const timestamp = Date.now();
            const baseUrls = [
                "https://fapi.binance.com"
            ];

            let allTrades: any[] = [];
            let lastError = null;
            let isRateLimited = false;

            // 1. Determine target symbols list
            const targetSymbols: string[] = [];
            if (symbol) {
                targetSymbols.push(formatBinanceSymbol(symbol));
            } else if (Array.isArray(req.body.symbols) && req.body.symbols.length > 0) {
                for (const s of req.body.symbols) {
                    if (s) targetSymbols.push(formatBinanceSymbol(s));
                }
            }

            if (targetSymbols.length === 0) {
                return res.json({ success: true, trades: [] });
            }

            // Fetch true executed userTrades for each target symbol
            const fetchTradesForSymbol = async (sym: string) => {
                const queryParts: string[] = [
                    `symbol=${sym}`,
                    `limit=${Math.min(parseInt(limit || "50") || 50, 100)}`,
                    `timestamp=${Date.now()}`,
                    `recvWindow=5000`
                ];
                const effectiveStartTime = startTime || (Date.now() - 3600000);
                queryParts.push(`startTime=${effectiveStartTime}`);
                const queryString = queryParts.join("&");
                const signature = crypto.createHmac("sha256", apiSecret).update(queryString).digest("hex");

                for (const baseUrl of baseUrls) {
                    const url = `${baseUrl}/fapi/v1/userTrades?${queryString}&signature=${signature}`;
                    try {
                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), 8000);
                        const response = await fetch(url, {
                            method: "GET",
                            headers: { "X-MBX-APIKEY": apiKey, "Content-Type": "application/json" },
                            signal: controller.signal
                        });
                        clearTimeout(timeout);
                        if (response.ok) {
                            const data = await response.json();
                            if (Array.isArray(data)) {
                                return data;
                            }
                        } else {
                            if (response.status === 429 || response.status === 418) isRateLimited = true;
                            const errText = await response.text();
                            lastError = errText;
                        }
                    } catch (err: any) {
                        lastError = err.message || err;
                    }
                }
                return [];
            };

            const results = await Promise.all(targetSymbols.slice(0, 25).map(s => fetchTradesForSymbol(s)));
            allTrades = results.flat();

            if (allTrades.length > 0) {
                userTradesCache.set(cacheKey, {
                    data: allTrades,
                    timestamp: Date.now()
                });
            } else if (cached) {
                allTrades = cached.data;
            }

            return res.json({
                success: true,
                trades: allTrades,
                rateLimited: isRateLimited
            });

        } catch (e: any) {
            return res.status(500).json({
                success: false,
                error: `获取币安成交账单异常: ${e.message || e}`
            });
        }
    });

    // 彻底清空币安历史成交流水服务端缓存 (POST /api/binance/clear-trade-cache)
    app.post("/api/binance/clear-trade-cache", (req, res) => {
        try {
            const { apiKey } = req.body || {};
            if (apiKey) {
                const prefix = apiKey.substring(0, 10);
                for (const key of userTradesCache.keys()) {
                    if (key.startsWith(prefix)) {
                        userTradesCache.delete(key);
                    }
                }
            } else {
                userTradesCache.clear();
            }
            return res.json({ success: true, message: "已彻底清空交易对账缓存" });
        } catch (e: any) {
            return res.json({ success: true });
        }
    });

    // ⚡ 极速单币成交流水快速抓取通道 (POST /api/binance/fast-user-trades)
    app.post("/api/binance/fast-user-trades", async (req, res) => {
        let { apiKey, apiSecret, symbol, limit } = req.body;
        if (!apiKey || !apiSecret || !symbol) {
            return res.status(400).json({ success: false, error: "缺少参数" });
        }
        apiKey = typeof apiKey === 'string' ? apiKey.trim() : apiKey;
        apiSecret = typeof apiSecret === 'string' ? apiSecret.trim() : apiSecret;
        const formattedSymbol = formatBinanceSymbol(symbol);

        try {
            const timeOffset = await syncBinanceServerTime();
            const timestamp = Date.now() + timeOffset;
            const queryString = `symbol=${formattedSymbol}&limit=${Math.min(parseInt(limit || "10") || 10, 25)}&timestamp=${timestamp}&recvWindow=10000`;
            const signature = crypto.createHmac("sha256", apiSecret).update(queryString).digest("hex");

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);
            const response = await fetchWithFallback(`https://fapi.binance.com/fapi/v1/userTrades?${queryString}&signature=${signature}`, {
                headers: { "X-MBX-APIKEY": apiKey, "Content-Type": "application/json" },
                signal: controller.signal
            });
            clearTimeout(timeout);

            if (response.ok) {
                const trades = await response.json();
                return res.json({
                    success: true,
                    symbol: formattedSymbol,
                    trades: Array.isArray(trades) ? trades : []
                });
            } else {
                const errText = await response.text();
                return res.json({ success: false, error: errText, trades: [] });
            }
        } catch (e: any) {
            return res.json({ success: false, error: e.message || e, trades: [] });
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

      const isHighPriority = (req.query.priority === "high") || targetUrl.includes("/klines");
      let parsedTarget: URL | null = null;
      try {
          parsedTarget = new URL(targetUrl);
      } catch (e) {
          return res.status(400).json({ error: "Invalid target URL" });
      }

      const rawSymbol = parsedTarget.searchParams.get("symbol") || "";
      const is1000Symbol = rawSymbol.startsWith("1000") && rawSymbol.endsWith("USDT");
      const spotSymbol = is1000Symbol ? rawSymbol.slice(4) : rawSymbol;
      const isKlineReq = targetUrl.includes("/klines");
      const isTickerPriceReq = targetUrl.includes("/ticker/price");
      const isTicker24hrReq = targetUrl.includes("/ticker/24hr");

      // Build prioritized candidate URL list
      const fetchCandidates: { url: string; isPublicProxy: boolean; isSpotScale1000: boolean }[] = [];

      if (targetUrl.includes("binance")) {
          const queryParams = new URLSearchParams(parsedTarget.searchParams);
          if (is1000Symbol) {
              queryParams.set("symbol", spotSymbol);
          }
          const spotQuery = queryParams.toString();
          const rawQuery = parsedTarget.searchParams.toString();

          if (isKlineReq) {
              // Direct Futures endpoints first if target is fapi or symbol is futures, then spot fallbacks
              if (targetUrl.includes("/fapi/") || is1000Symbol) {
                  fetchCandidates.push({ url: `https://fapi.binance.com/fapi/v1/klines?${rawQuery}`, isPublicProxy: false, isSpotScale1000: false });
              }
              fetchCandidates.push({ url: `https://data-api.binance.vision/api/v3/klines?${spotQuery}`, isPublicProxy: false, isSpotScale1000: is1000Symbol });
              fetchCandidates.push({ url: `https://api.binance.com/api/v3/klines?${spotQuery}`, isPublicProxy: false, isSpotScale1000: is1000Symbol });
              fetchCandidates.push({ url: `https://api1.binance.com/api/v3/klines?${spotQuery}`, isPublicProxy: false, isSpotScale1000: is1000Symbol });
              fetchCandidates.push({ url: `https://api3.binance.com/api/v3/klines?${spotQuery}`, isPublicProxy: false, isSpotScale1000: is1000Symbol });
              if (!targetUrl.includes("/fapi/")) {
                  fetchCandidates.push({ url: `https://fapi.binance.com/fapi/v1/klines?${rawQuery}`, isPublicProxy: false, isSpotScale1000: false });
              }
          } else if (isTickerPriceReq) {
              if (targetUrl.includes("/fapi/") || is1000Symbol) {
                  fetchCandidates.push({ url: `https://fapi.binance.com/fapi/v1/ticker/price?${rawQuery}`, isPublicProxy: false, isSpotScale1000: false });
              }
              fetchCandidates.push({ url: `https://data-api.binance.vision/api/v3/ticker/price?${spotQuery}`, isPublicProxy: false, isSpotScale1000: is1000Symbol });
              fetchCandidates.push({ url: `https://api.binance.com/api/v3/ticker/price?${spotQuery}`, isPublicProxy: false, isSpotScale1000: is1000Symbol });
              fetchCandidates.push({ url: `https://api1.binance.com/api/v3/ticker/price?${spotQuery}`, isPublicProxy: false, isSpotScale1000: is1000Symbol });
              if (!targetUrl.includes("/fapi/")) {
                  fetchCandidates.push({ url: `https://fapi.binance.com/fapi/v1/ticker/price?${rawQuery}`, isPublicProxy: false, isSpotScale1000: false });
              }
          } else if (isTicker24hrReq) {
              if (targetUrl.includes("/fapi/") || is1000Symbol) {
                  fetchCandidates.push({ url: `https://fapi.binance.com/fapi/v1/ticker/24hr?${rawQuery}`, isPublicProxy: false, isSpotScale1000: false });
              }
              fetchCandidates.push({ url: `https://data-api.binance.vision/api/v3/ticker/24hr?${spotQuery}`, isPublicProxy: false, isSpotScale1000: is1000Symbol });
              fetchCandidates.push({ url: `https://api.binance.com/api/v3/ticker/24hr?${spotQuery}`, isPublicProxy: false, isSpotScale1000: is1000Symbol });
              fetchCandidates.push({ url: `https://api1.binance.com/api/v3/ticker/24hr?${spotQuery}`, isPublicProxy: false, isSpotScale1000: is1000Symbol });
          } else {
              // Other generic Binance requests
              if (targetUrl.includes("/fapi/")) {
                  fetchCandidates.push({ url: `https://fapi.binance.com${parsedTarget.pathname}?${rawQuery}`, isPublicProxy: false, isSpotScale1000: false });
              }
              const spotPath = parsedTarget.pathname.replace(/^\/fapi\/v[12]/, "/api/v3");
              fetchCandidates.push({ url: `https://data-api.binance.vision${spotPath}?${spotQuery}`, isPublicProxy: false, isSpotScale1000: false });
              fetchCandidates.push({ url: `https://api.binance.com${spotPath}?${spotQuery}`, isPublicProxy: false, isSpotScale1000: false });
          }
      } else {
          fetchCandidates.push({ url: targetUrl, isPublicProxy: false, isSpotScale1000: false });
          fetchCandidates.push({ url: `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, isPublicProxy: true, isSpotScale1000: false });
      }

      const officialCandidates = fetchCandidates.filter(c => !c.isPublicProxy);
      const publicCandidates = fetchCandidates.filter(c => c.isPublicProxy);

      let isInvalidSymbolError = false;

      const fetchCandidate = async (candidate: typeof fetchCandidates[0]) => {
          const controller = new AbortController();
          const timeoutMs = isTicker24hrReq 
              ? 15000 
              : (candidate.isPublicProxy ? 4000 : (isHighPriority ? 3000 : 5000));
          const timeoutId = setTimeout(() => {
              if (!controller.signal.aborted) {
                  controller.abort();
              }
          }, timeoutMs);

          try {
              const headers: Record<string, string> = {
                  "Accept": "application/json"
              };
              if (!candidate.isPublicProxy) {
                  headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
                  headers["Cache-Control"] = "no-cache";
              }

              const response = await fetch(candidate.url, {
                  headers,
                  signal: controller.signal
              });

              if (!response.ok) {
                  if (response.status === 400 || response.status === 404) {
                      isInvalidSymbolError = true;
                  }
                  throw new Error(`HTTP ${response.status}`);
              }

              const text = await response.text();
              if (!text || text.trim() === '') {
                  throw new Error("Empty response from upstream");
              }
              if (text.trim().startsWith('<') || text.toLowerCase().includes('doctype html')) {
                  throw new Error("Received HTML error page from proxy/upstream");
              }
              let data = JSON.parse(text);

              // Scale 1000-prefixed contracts if served from spot
              if (candidate.isSpotScale1000) {
                  if (Array.isArray(data) && Array.isArray(data[0])) {
                      // K-Line data array: [openTime, open, high, low, close, volume, closeTime, quoteAssetVolume, ...]
                      data = data.map((k: any[]) => {
                          const open = (parseFloat(k[1]) * 1000).toString();
                          const high = (parseFloat(k[2]) * 1000).toString();
                          const low = (parseFloat(k[3]) * 1000).toString();
                          const close = (parseFloat(k[4]) * 1000).toString();
                          return [k[0], open, high, low, close, k[5], k[6], k[7], k[8], k[9], k[10], k[11]];
                      });
                  } else if (data && typeof data === 'object' && 'price' in data) {
                      data = { ...data, symbol: rawSymbol, price: (parseFloat(data.price) * 1000).toString() };
                  } else if (data && typeof data === 'object' && 'lastPrice' in data) {
                      data = { 
                          ...data, 
                          symbol: rawSymbol, 
                          lastPrice: (parseFloat(data.lastPrice) * 1000).toString(),
                          highPrice: (parseFloat(data.highPrice || "0") * 1000).toString(),
                          lowPrice: (parseFloat(data.lowPrice || "0") * 1000).toString()
                      };
                  }
              }
              return data;
          } finally {
              clearTimeout(timeoutId);
          }
      };

      // 1. Race all official Binance endpoints in parallel (Instant 20-80ms response)
      if (officialCandidates.length > 0) {
          try {
              const data = await Promise.any(officialCandidates.map(c => fetchCandidate(c)));
              const ttl = getServerCacheTTL(targetUrl);
              serverCache.set(cacheKey, {
                  data,
                  timestamp: Date.now(),
                  ttl
              });
              return res.json(data);
          } catch (raceErr) {
              if (isInvalidSymbolError) {
                  return res.status(400).json({ code: -1121, msg: "Invalid symbol." });
              }
              console.warn(`[Proxy Race] Official candidates failed for ${targetUrl}, trying public proxies...`);
          }
      }

      // 2. Fallback to public proxies sequentially if official candidates failed
      if (!isInvalidSymbolError) {
          for (const candidate of publicCandidates) {
              try {
                  const data = await fetchCandidate(candidate);
                  const ttl = getServerCacheTTL(targetUrl);
                  serverCache.set(cacheKey, {
                      data,
                      timestamp: Date.now(),
                      ttl
                  });
                  return res.json(data);
              } catch (pubErr) {
                  // try next public proxy
              }
          }
      }

      return res.status(502).json({ error: "All backend proxy and rotation paths exhausted. Upstream is unreachable." });
    });

  // 一键下载 PC 电脑安装版
  app.get("/api/download-pc-installer", (req, res) => {
    const pcFile = path.join(process.cwd(), "public", "0211自动找币防爆仓救世之星_PC电脑安装版.zip");
    if (fs.existsSync(pcFile)) {
      res.download(pcFile, "0211自动找币防爆仓救世之星_PC电脑安装版.zip");
    } else {
      res.redirect("/api/export-project");
    }
  });

  // 一键下载 手机 APP 安装包
  app.get("/api/download-mobile-app", (req, res) => {
    const mobileFile = path.join(process.cwd(), "public", "0211自动找币防爆仓救世之星_手机APP安装包.zip");
    if (fs.existsSync(mobileFile)) {
      res.download(mobileFile, "0211自动找币防爆仓救世之星_手机APP安装包.zip");
    } else {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>0211自动找币防爆仓救世之星 - 手机APP一键安装</title>
</head>
<body style="background:#0b0f19;color:#fff;text-align:center;padding:40px;font-family:sans-serif;">
    <h2>📱 手机APP一键安装程序</h2>
    <p>正在为您打开手机端应用并生成桌面图标...</p>
    <a href="/" style="display:inline-block;background:#10b981;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:20px;">点击立即打开</a>
    <script>setTimeout(function(){ window.location.href = '/'; }, 800);</script>
</body></html>`);
    }
  });

  // Export Full Project Source Code as ZIP
  app.get("/api/export-project", async (req, res) => {
    const tempZipPath = path.join("/tmp", `CryptoScanner_FullSource_${Date.now()}.zip`);
    try {
      console.log("📦 [Server] Generating full project source ZIP download to disk...");
      const output = fs.createWriteStream(tempZipPath);
      const archive = new ZipArchive({
        zlib: { level: 9 }
      });

      await new Promise<void>((resolve, reject) => {
        output.on("close", () => resolve());
        output.on("error", (err) => reject(err));
        archive.on("error", (err: any) => reject(err));

        archive.pipe(output);

        const rootDir = process.cwd();
        archive.glob("**/*", {
          cwd: rootDir,
          ignore: [
            "node_modules/**",
            "dist/**",
            ".git/**",
            ".cache/**",
            "release/**",
            "*.log",
            ".DS_Store"
          ],
          dot: true
        });

        archive.finalize();
      });

      const stats = fs.statSync(tempZipPath);
      console.log(`✅ [Server] ZIP package generated successfully (${(stats.size / 1024 / 1024).toFixed(2)} MB, ${stats.size} bytes)`);

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Length", stats.size.toString());
      res.setHeader("Content-Disposition", 'attachment; filename="CryptoScanner_FullSource.zip"');

      const readStream = fs.createReadStream(tempZipPath);
      readStream.pipe(res);

      readStream.on("close", () => {
        try {
          fs.unlinkSync(tempZipPath);
        } catch (e) {}
      });
    } catch (err: any) {
      console.error("Failed to export project ZIP:", err);
      try {
        if (fs.existsSync(tempZipPath)) fs.unlinkSync(tempZipPath);
      } catch (e) {}
      if (!res.headersSent) {
        res.status(500).json({ error: "导出源码失败: " + (err.message || err) });
      }
    }
  });

  // --- REAL-NAME ACTIVATION & HARDWARE LOCK ENDPOINTS (Admin: 541232585@qq.com) ---
  const ADMIN_EMAIL = "541232585@qq.com";
  const activationFile = path.join(process.cwd(), "data", "activation.json");

  function ensureActivationDir() {
    const dir = path.dirname(activationFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  app.get("/api/activation/status", (req, res) => {
    try {
      ensureActivationDir();
      const machineId = (req.query.machineId as string) || "";
      if (!fs.existsSync(activationFile)) {
        return res.json({ isActivated: false });
      }
      const data = JSON.parse(fs.readFileSync(activationFile, "utf-8"));
      if (data && data.isActivated && (!machineId || data.machineId === machineId)) {
        return res.json({ isActivated: true });
      }
      res.json({ isActivated: false });
    } catch (err) {
      res.json({ isActivated: false });
    }
  });

  app.post("/api/activation/register", async (req, res) => {
    try {
      const { machineId, phone, name, idCard, senderEmail, senderPassword, photo } = req.body;
      if (!machineId || !phone || !name || !idCard || !senderEmail || !senderPassword) {
        return res.status(400).json({ error: "缺少必要的实名注册或发件邮箱/授权码信息" });
      }

      ensureActivationDir();
      
      const record = {
        machineId,
        phone,
        name,
        idCard,
        senderEmail,
        photo: photo ? photo.slice(0, 100) + "..." : "",
        fullPhoto: photo,
        createdAt: Date.now(),
        isActivated: false
      };

      fs.writeFileSync(activationFile, JSON.stringify(record, null, 2), "utf-8");
      console.log(`🔒 [Activation] New real-name registration received from Machine ID: ${machineId}, Name: ${name}, Phone: ${phone}, Sender: ${senderEmail}`);

      const masterCode = "888888";
      const machineCode = crypto.createHash('md5').update(machineId + ADMIN_EMAIL).digest('hex').slice(0, 6).toUpperCase();
      console.log(`🔑 [Activation] Admin Email: ${ADMIN_EMAIL} | Master Code: ${masterCode} | Machine-specific Code: ${machineCode}`);

      try {
        const nodemailer = await import("nodemailer");
        let smtpHost = "smtp.qq.com";
        if (senderEmail.includes("@163.com")) {
          smtpHost = "smtp.163.com";
        } else if (senderEmail.includes("@gmail.com")) {
          smtpHost = "smtp.gmail.com";
        }

        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: 465,
          secure: true,
          auth: {
            user: senderEmail,
            pass: senderPassword
          }
        });

        await transporter.sendMail({
          from: `"防爆仓救世之星实名认证" <${senderEmail}>`,
          to: ADMIN_EMAIL,
          subject: `【新用户实名激活申请】姓名: ${name} - 手机: ${phone} - 机器码: ${machineId}`,
          html: `
            <h2>新用户实名认证与授权申请</h2>
            <p><b>发件用户邮箱:</b> ${senderEmail}</p>
            <p><b>姓名:</b> ${name}</p>
            <p><b>手机号:</b> ${phone}</p>
            <p><b>身份证号:</b> ${idCard}</p>
            <p><b>机器码:</b> ${machineId}</p>
            <p><b>申请时间:</b> ${new Date().toLocaleString()}</p>
            <hr/>
            <p><b>本机专属激活码:</b> <span style="color:red; font-size:20px; font-weight:bold;">${machineCode}</span></p>
            <p><b>通用主激活码:</b> <span style="color:blue; font-size:20px; font-weight:bold;">${masterCode}</span></p>
          `
        });
        console.log(`✉️ [Activation] Email successfully sent from user ${senderEmail} to admin ${ADMIN_EMAIL}`);
      } catch (mailErr: any) {
        console.error("❌ [Activation] Failed to send email using user credentials:", mailErr);
        return res.status(400).json({ error: "邮件发送失败，请检查您的发件邮箱地址及授权码/密码是否正确！错误: " + (mailErr.message || mailErr) });
      }

      res.json({ success: true, message: "注册信息与实名照片已通过您的邮箱成功发送至管理员邮箱 (541232585@qq.com)！请等待管理员人工审核并告知验证码。" });
    } catch (err: any) {
      console.error("Failed to process registration:", err);
      res.status(500).json({ error: "处理注册请求失败: " + (err.message || err) });
    }
  });

  app.post("/api/activation/verify", (req, res) => {
    try {
      const { machineId, code } = req.body;
      if (!machineId || !code) {
        return res.status(400).json({ error: "缺少机器码或验证码" });
      }

      const masterCode = "888888";
      const machineCode = crypto.createHash('md5').update(machineId + ADMIN_EMAIL).digest('hex').slice(0, 6).toUpperCase();

      const cleanCode = code.trim().toUpperCase();
      if (cleanCode === masterCode || cleanCode === machineCode) {
        ensureActivationDir();
        let record: any = {};
        if (fs.existsSync(activationFile)) {
          try {
            record = JSON.parse(fs.readFileSync(activationFile, "utf-8"));
          } catch (e) {}
        }
        record.machineId = machineId;
        record.isActivated = true;
        record.activatedAt = Date.now();
        fs.writeFileSync(activationFile, JSON.stringify(record, null, 2), "utf-8");

        console.log(`✅ [Activation] System successfully activated for Machine ID: ${machineId}`);
        return res.json({ success: true });
      }

      res.status(400).json({ success: false, error: "激活验证码错误！请向管理员 (541232585@qq.com) 索取正确的验证码。" });
    } catch (err: any) {
      res.status(500).json({ success: false, error: "验证失败: " + (err.message || err) });
    }
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
