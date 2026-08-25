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

function startBinanceWSBridge() {
  const binanceUrls = [
    'wss://fstream.binance.com/ws/!bookTicker',
    'wss://fstream.binance.me/ws/!bookTicker',
    'wss://fstream.binance.info/ws/!bookTicker'
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
  app.use(express.json());

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
                return data;
            }
        } catch (e) {
            console.error("Failed to fetch exchangeInfo:", e);
        }
        return cachedExchangeInfo;
    }

    function formatBinanceSymbol(symbol: string): string {
        const clean = symbol.toUpperCase().trim();
        if (clean.endsWith("USDT")) {
            return clean;
        }
        return clean + "USDT";
    }

    async function fetchWithFallback(urlStr: string, options: RequestInit = {}): Promise<Response> {
        const baseUrls = [
            "https://fapi.binance.com",
            "https://fapi.binance.me",
            "https://fapi.binance.info"
        ];
        let lastError: any = null;
        for (const baseUrl of baseUrls) {
            const targetUrl = urlStr.replace("https://fapi.binance.com", baseUrl);
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 6000); // 6s timeout per node
                const res = await fetch(targetUrl, {
                    ...options,
                    signal: controller.signal
                });
                clearTimeout(timeout);
                // If we get an active non-server error response (e.g. 4xx parameters error, 401 unauthorized),
                // it means we successfully reached Binance and the request is rejected due to user input/auth.
                // We do NOT need to fallback to other nodes. Return it immediately.
                if (res.ok || res.status < 500) {
                    return res;
                }
                lastError = new Error(`Node ${baseUrl} returned status ${res.status}`);
            } catch (err: any) {
                lastError = err;
            }
        }
        throw lastError || new Error("All Binance nodes failed to respond");
    }

    app.post("/api/binance/order", async (req, res) => {
        const { apiKey, apiSecret, symbol, side, action, quantity, amountUsdt, leverage } = req.body;
        if (!apiKey || !apiSecret || !symbol || !side || !action) {
            return res.status(400).json({ success: false, error: "缺少必要参数 (apiKey, apiSecret, symbol, side, action)" });
        }

        const formattedSymbol = formatBinanceSymbol(symbol);
        let appliedLeverage: number = parseInt(leverage || "20");

        try {
            // 1. Set leverage if action is OPEN
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
                        console.warn(`[Binance Order] Failed to set leverage to ${targetLeverage}x: ${levErrText}. Attempting auto-adaptive leverage fallback...`);
                        
                        // Auto-adaptive fallback: Try querying leverage brackets or stepping down (15, 10, 8, 5, 4, 3, 2, 1)
                        let adaptiveSuccess = false;
                        
                        // Attempt 1: Fetch leverageBracket for exact max leverage
                        try {
                            const bTimestamp = Date.now();
                            const bQuery = `symbol=${formattedSymbol}&timestamp=${bTimestamp}&recvWindow=5000`;
                            const bSig = crypto.createHmac("sha256", apiSecret).update(bQuery).digest("hex");
                            const bRes = await fetchWithFallback(`https://fapi.binance.com/fapi/v1/leverageBracket?${bQuery}&signature=${bSig}`, {
                                headers: { "X-MBX-APIKEY": apiKey }
                            });
                            if (bRes.ok) {
                                const bData = await bRes.json();
                                const brackets = Array.isArray(bData) ? (bData[0]?.brackets || []) : (bData?.brackets || []);
                                if (brackets.length > 0) {
                                    // Find maximum allowed initial leverage
                                    const maxAllowed = Math.max(...brackets.map((b: any) => parseInt(b.initialLeverage || "0")));
                                    if (maxAllowed > 0 && maxAllowed < targetLeverage) {
                                        console.log(`[Binance Order] Found symbol max leverage bracket: ${maxAllowed}x for ${formattedSymbol}. Retrying with ${maxAllowed}x...`);
                                        const retryRes = await setLeverageFn(maxAllowed);
                                        if (retryRes.ok) {
                                            const rJson = await retryRes.json();
                                            appliedLeverage = rJson.leverage || maxAllowed;
                                            adaptiveSuccess = true;
                                            console.log(`[Binance Order] Auto-adaptive leverage matched: ${appliedLeverage}x`);
                                        }
                                    }
                                }
                            }
                        } catch (bracketErr) {
                            console.warn(`[Binance Order] Error querying leverage bracket:`, bracketErr);
                        }

                        // Attempt 2: If bracket query didn't succeed, step down sequentially
                        if (!adaptiveSuccess) {
                            const stepLevels = [15, 12, 10, 8, 5, 4, 3, 2, 1].filter(l => l < targetLeverage);
                            for (const stepLev of stepLevels) {
                                const retryRes = await setLeverageFn(stepLev);
                                if (retryRes.ok) {
                                    const rJson = await retryRes.json();
                                    appliedLeverage = rJson.leverage || stepLev;
                                    adaptiveSuccess = true;
                                    console.log(`[Binance Order] Auto-adaptive leverage step-down matched: ${appliedLeverage}x for ${formattedSymbol}`);
                                    break;
                                }
                            }
                        }

                        if (!adaptiveSuccess) {
                            try {
                                const levErrJson = JSON.parse(levErrText);
                                if (levErrJson.msg) {
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

            // 2. Get current ticker price to calculate quantity or validate notional value
            console.log(`[Binance Order] Fetching price for ${formattedSymbol} to calculate qty/validate notional...`);
            let priceResponse;
            try {
                priceResponse = await fetchWithFallback(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${formattedSymbol}`);
            } catch (err: any) {
                return res.status(502).json({ success: false, error: `获取 ${formattedSymbol} 当前价格失败。错误: ${err.message || err}` });
            }

            let currentPrice = 0;
            if (priceResponse.ok) {
                const priceData = await priceResponse.json();
                currentPrice = parseFloat(priceData.price);
            } else {
                return res.status(502).json({ success: false, error: `获取 ${formattedSymbol} 当前价格失败。` });
            }

            let finalQty = quantity;
            if (!finalQty && amountUsdt && currentPrice > 0) {
                finalQty = amountUsdt / currentPrice;
                console.log(`[Binance Order] Calculated qty for ${formattedSymbol}: ${finalQty} (${amountUsdt} USDT @ ${currentPrice})`);
            }

            if (!finalQty || isNaN(finalQty) || finalQty <= 0) {
                return res.status(400).json({ success: false, error: "无法确定合法的交易数量 (quantity 必须大于0)" });
            }

            // 2. Adjust quantity according to exchangeInfo LOT_SIZE stepSize, precision and MIN_NOTIONAL
            let minNotional = 20.0; // Default minimum notional for Binance Futures USDⓈ-M contracts
            let stepSize = 0.0001;
            let qtyPrecision = 4;
            let minQty = 0.0001;

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
            let isHedgeMode = false;
            const timestamp = Date.now();
            const dualQueryString = `timestamp=${timestamp}&recvWindow=5000`;
            const dualSignature = crypto
                .createHmac("sha256", apiSecret)
                .update(dualQueryString)
                .digest("hex");

            let dualResponse;
            try {
                dualResponse = await fetchWithFallback(`https://fapi.binance.com/fapi/v1/positionSide/dual?${dualQueryString}&signature=${dualSignature}`, {
                    headers: { "X-MBX-APIKEY": apiKey }
                });

                if (dualResponse.ok) {
                    const dualData = await dualResponse.json();
                    isHedgeMode = dualData.dualSidePosition === true;
                    console.log(`[Binance Order] Position mode detected: ${isHedgeMode ? "Hedge Mode (双向持仓)" : "One-way Mode (单向持仓)"}`);
                } else {
                    console.warn("[Binance Order] Failed to fetch position mode, defaulting to One-way Mode");
                }
            } catch (err: any) {
                console.warn(`[Binance Order] Exception while fetching position mode: ${err.message || err}. Defaulting to One-way Mode`);
            }

            // 3.5 Handle CLOSE action safety checks (Optimized for lightning-fast execution & zero slippage delay)
            if (action === "CLOSE") {
                const cancelTimestamp = Date.now();
                const cancelQueryString = `symbol=${formattedSymbol}&timestamp=${cancelTimestamp}&recvWindow=5000`;
                const cancelSignature = crypto
                    .createHmac("sha256", apiSecret)
                    .update(cancelQueryString)
                    .digest("hex");

                const posTimestamp = Date.now();
                const posQueryString = `symbol=${formattedSymbol}&timestamp=${posTimestamp}&recvWindow=5000`;
                const posSignature = crypto
                    .createHmac("sha256", apiSecret)
                    .update(posQueryString)
                    .digest("hex");

                await Promise.all([
                    fetchWithFallback(`https://fapi.binance.com/fapi/v1/allOpenOrders?${cancelQueryString}&signature=${cancelSignature}`, {
                        method: "DELETE",
                        headers: { "X-MBX-APIKEY": apiKey }
                    }).catch(err => console.warn(`[Binance Order] [Fast-Close] Open orders cancel warning:`, err)),

                    fetchWithFallback(`https://fapi.binance.com/fapi/v2/positionRisk?${posQueryString}&signature=${posSignature}`, {
                        headers: { "X-MBX-APIKEY": apiKey }
                    }).then(async posRes => {
                        if (posRes.ok) {
                            const positionsData = await posRes.json();
                            if (Array.isArray(positionsData)) {
                                let targetAmt = 0;
                                if (isHedgeMode) {
                                    const targetSide = side === "LONG" ? "LONG" : "SHORT";
                                    const matched = positionsData.find((p: any) => p.positionSide === targetSide);
                                    if (matched) targetAmt = Math.abs(parseFloat(matched.positionAmt));
                                } else {
                                    const matched = positionsData.find((p: any) => p.positionSide === "BOTH");
                                    if (matched) targetAmt = Math.abs(parseFloat(matched.positionAmt));
                                }
                                if (targetAmt > 0 && targetAmt < finalQty) {
                                    finalQty = targetAmt;
                                }
                            }
                        }
                    }).catch(err => console.warn(`[Binance Order] [Fast-Close] Position risk fetch warning:`, err))
                ]);
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
                return res.json({
                    success: true,
                    orderId: orderData.orderId,
                    clientOrderId: orderData.clientOrderId,
                    symbol: formattedSymbol,
                    side: binanceSide,
                    positionSide: binancePositionSide,
                    qty: finalQty,
                    price: currentPrice,
                    leverage: appliedLeverage,
                    message: `成功在币安下单: ${action === "OPEN" ? "开仓" : "平仓"} ${side} ${formattedSymbol} ${finalQty} 手（杠杆: ${appliedLeverage}x）！`
                });
            } else {
                const errorCode = orderData.code;
                const errorMsg = orderData.msg || orderText;
                
                let userFriendlyError = `币安交易所请求失败: ${errorMsg}`;
                if (errorCode === -2015) {
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
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout per node
                    
                    console.log(`[Binance API Validation] Trying node: ${baseUrl}`);
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
                            entryId: `real_${p.symbol}_${side}`,
                            entryTime: Date.now(),
                            leverage: leverage,
                            maintMargin: maintMargin
                        };
                    });

                return res.json({
                    success: true,
                    marginBalance,
                    walletBalance,
                    availableBalance,
                    activePositions,
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

    app.post("/api/binance/transfer", async (req, res) => {
        const { apiKey, apiSecret, asset, amount, type } = req.body;
        if (!apiKey || !apiSecret) {
            return res.status(400).json({ success: false, error: "请提供完整的 API Key 和 Secret Key" });
        }
        if (!asset || !amount || !type) {
            return res.status(400).json({ success: false, error: "请提供资产币种 (asset)、金额 (amount) 以及划转类型 (type)" });
        }

        try {
            const timestamp = Date.now();
            const queryString = `type=${type}&asset=${asset}&amount=${amount}&timestamp=${timestamp}&recvWindow=5000`;
            const signature = crypto
                .createHmac("sha256", apiSecret)
                .update(queryString)
                .digest("hex");

            const baseUrls = [
                "https://api.binance.com",
                "https://api.binance.me",
                "https://api.binance.info"
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

      const maxRetries = fetchCandidates.length;
      let attempt = 0;

      for (const candidate of fetchCandidates) {
          attempt++;
          const urlToFetch = candidate.url;

          try {
              const controller = new AbortController();
              const timeoutMs = candidate.isPublicProxy ? 5000 : 6000;
              const timeoutId = setTimeout(() => {
                  if (!controller.signal.aborted) {
                      controller.abort();
                  }
              }, timeoutMs);

              const headers: Record<string, string> = {
                  "Accept": "application/json"
              };
              if (!candidate.isPublicProxy) {
                  headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
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
                  continue;
              }

              if (response.status === 429 || response.status === 418) {
                  continue;
              }

              throw new Error(`Response status ${response.status}`);
          } catch (error: any) {
              // Failover to next candidate in cluster
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

      if (targetUrl.includes("/ticker/price")) {
          try {
              console.log(`[Proxy Fallback] Upstream failed for ticker/price. Creating server-side mock prices.`);
              const parsedUrl = new URL(targetUrl);
              const symbolInput = parsedUrl.searchParams.get("symbol");
              if (symbolInput) {
                  return res.json({ symbol: symbolInput, price: "60000.00" });
              } else {
                  return res.json([{ symbol: "BTCUSDT", price: "60000.00" }, { symbol: "ETHUSDT", price: "3000.00" }]);
              }
          } catch (e) {
              console.error("[Proxy Fallback] Error generating mock prices:", e);
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
