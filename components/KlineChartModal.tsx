
import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { X, Loader2, Move, ZoomIn, ZoomOut, RefreshCw, AlertTriangle, WifiOff, Activity, ArrowRight, BarChart2, Ruler, Zap } from 'lucide-react';
import { calculateEMA } from '../services/indicators';
import { fetchWithFallback } from '../services/apiService';
import { analyzeList2Crossing } from '../services/rules/list2_crossing'; // Import Rule Logic
import { List2Config } from './Scanner/scannerTypes';
import { useOptionalBacktest } from '../modules/backtester/BacktestContext';
import { formatPrice } from '../services/symbolUtils';
import { KLineSynthesizer } from '../services/klineSynthesizer';

interface Signal {
    time: number;
    type: 'LONG' | 'SHORT';
}

interface ComputedSignal extends Signal {
    signalIdx?: number;
    midPrice?: number;
    breakthroughPrice?: number;
    breakoutThreshold?: number;
    midlineThreshold?: number;
    ampVal?: number;
    volRatioVal?: number;
    bodyRatioVal?: number;
    drop300?: number;
    rise300?: number;
    openRiseFromMin?: number;
    openDropFromMax?: number;
}

interface ExtraLine {
    price: number;
    label: string;
    color: string;
    style?: 'solid' | 'dashed';
}

interface Props {
  symbol: string;
  initialTimeframe?: string;
  signals?: Signal[]; 
  entryPrice?: number; 
  entryTime?: number; 
  currentPrice?: number; // New prop for accurate simulation target
  scanWindow?: number; 
  list2Config?: List2Config; 
  list4Config?: any;
  highlightTime?: number; // Time to highlight (Vertical Line)
  extraLines?: ExtraLine[]; // New: Dynamic visual lines (Trigger/Defense)
  directMode?: boolean; // Added directMode for fast fetching
  limit?: number; // Added dynamic limit
  disablePortal?: boolean; // Allow embedding in parents
  highlightTf?: string; // Timeframe to highlight (Brightened)
  showAuditLines?: boolean; // New: Only show "Audit" specific markers (List 4/5)
  tradeLogs?: TradeLog[]; // Added tradeLogs prop
  appearedTime?: number; // Time the signal appeared
  disappearedTime?: number; // Time the signal disappeared
  onClose: () => void;
  onTimeframeChange?: (timeframe: string) => void;
  lookbackDays?: number;
  sidewaysDays?: number;
  hasPrev?: boolean;
  hasNext?: boolean;
  currentIndexLabel?: string;
  onPrev?: () => void;
  onNext?: () => void;
}

interface KlineData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const TIMEFRAMES = ['15s', '30s', '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d', '1w', '1M', '3M'];

const sanitizeTf = (tf: string): string => {
    if (!tf) return '15m';
    const match = tf.match(/(\d+[smhd])/i);
    if (match) {
        const clean = match[1].toLowerCase();
        if (TIMEFRAMES.includes(clean)) return clean;
    }
    return '15m';
};

// Binance Colors & Theme
const COLOR_UP = '#0ECB81'; // Green
const COLOR_DOWN = '#F6465D'; // Red
const COLOR_BG = '#161A25'; // Dark BG
const COLOR_GRID = '#2B3139'; // Grid Lines
const COLOR_TEXT = '#848E9C';
const COLOR_CROSSHAIR = '#FFFFFF';

const MIN_CANDLES_VISIBLE = 20;
const MAX_CANDLES_VISIBLE = 500; 

// Replicate Helper: Generate Mock Kline Data
const getTfMinutes = (tf: string) => {
    if (!tf) return 15;
    const unit = tf.slice(-1);
    const val = parseInt(tf);
    if (unit === 's') return val / 60;
    if (unit === 'm') return val;
    if (unit === 'h') return val * 60;
    if (unit === 'd') return val * 1440;
    if (unit === 'w') return val * 10080;
    if (unit === 'M') return val * 43200;
    return 15;
};

import { TradeLog, PositionSide } from '../types';
import { createPortal } from 'react-dom';

async function fetchKlinesViaWebSocket(safeSymbol: string, timeframe: string, limit: number, isFutures: boolean, delayMs: number = 0): Promise<{ data: any[][], source: string }> {
    if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    if (typeof WebSocket === 'undefined') {
        throw new Error('WebSocket not supported in this environment');
    }
    return new Promise((resolve, reject) => {
        const primaryUrl = isFutures ? 'wss://ws-fapi.binance.com/ws-fapi/v1' : 'wss://ws-api.binance.com/ws-api/v3';
        const backupUrl = isFutures ? 'wss://ws-fapi.binance.me/ws-fapi/v1' : 'wss://ws-api.binance.me/ws-api/v3';
        
        let ws: WebSocket;
        let activeDomain = isFutures ? 'ws-fapi.binance.com' : 'ws-api.binance.com';
        
        try {
            ws = new WebSocket(primaryUrl);
        } catch (e) {
            try {
                activeDomain = isFutures ? 'ws-fapi.binance.me' : 'ws-api.binance.me';
                ws = new WebSocket(backupUrl);
            } catch (e2: any) {
                reject(e2);
                return;
            }
        }

        const reqId = "ws_" + Math.random().toString(36).substring(2, 11);
        
        const timeoutId = setTimeout(() => {
            try { ws.close(); } catch(e){}
            reject(new Error(`WebSocket timeout (${activeDomain})`));
        }, 2500); // Strict 2.5s timeout for the WS request

        ws.onopen = () => {
            const payload = {
                id: reqId,
                method: "klines",
                params: {
                    symbol: safeSymbol,
                    interval: timeframe,
                    limit: limit
                }
            };
            try {
                ws.send(JSON.stringify(payload));
            } catch (e: any) {
                clearTimeout(timeoutId);
                try { ws.close(); } catch(err){}
                reject(e);
            }
        };

        ws.onmessage = (event) => {
            try {
                const response = JSON.parse(event.data);
                if (response.id === reqId) {
                    clearTimeout(timeoutId);
                    try { ws.close(); } catch(e){}
                    if (response.status === 200 && Array.isArray(response.result)) {
                        console.log(`[KlineWS] Winner via ${activeDomain}! Loaded ${response.result.length} klines.`);
                        resolve({ data: response.result, source: `WS-${isFutures ? 'Futures' : 'Spot'}` });
                    } else if (response.error) {
                        reject(new Error(`WS Error: ${response.error.message || 'Unknown error'}`));
                    } else {
                        reject(new Error('Invalid WS structure'));
                    }
                }
            } catch (e: any) {
                clearTimeout(timeoutId);
                try { ws.close(); } catch(err){}
                reject(e);
            }
        };

        ws.onerror = (err) => {
            clearTimeout(timeoutId);
            try { ws.close(); } catch(e){}
            reject(new Error(`WebSocket error on ${activeDomain}`));
        };

        ws.onclose = () => {
            clearTimeout(timeoutId);
            reject(new Error(`WebSocket closed on ${activeDomain}`));
        };
    });
}

async function fetchFirstValid(channels: Array<Promise<{ data: any[][], source: string }>>): Promise<{ data: any[][], source: string }> {
    return new Promise((resolve, reject) => {
        let rejectedCount = 0;
        let isResolved = false;
        const total = channels.length;
        if (total === 0) {
            reject(new Error("No channels provided"));
            return;
        }
        channels.forEach((p) => {
            p.then((res) => {
                if (!isResolved && res && Array.isArray(res.data) && res.data.length > 0) {
                    isResolved = true;
                    resolve(res);
                } else {
                    rejectedCount++;
                    if (rejectedCount >= total && !isResolved) {
                        reject(new Error("All channels returned invalid or empty data"));
                    }
                }
            }).catch(() => {
                rejectedCount++;
                if (rejectedCount >= total && !isResolved) {
                    reject(new Error("All racing channels failed"));
                }
            });
        });
    });
}

async function raceFetchKlines(safeSymbol: string, timeframe: string, limit: number): Promise<{ data: any[][], source: string }> {
    // 15s and 30s synthesized seconds klines
    if (timeframe === '15s' || timeframe === '30s') {
        const targetMin = timeframe === '15s' ? 0.25 : 0.5;
        const spot1sUrl = `https://api.binance.com/api/v3/klines?symbol=${safeSymbol}&interval=1s&limit=1000`;
        try {
            const res = await fetchWithFallback(spot1sUrl, { priority: 'HIGH', timeout: 5000 });
            if (res.ok) {
                const raw = await res.json();
                if (Array.isArray(raw) && raw.length > 0) {
                    const secKlines = raw.map((k: any) => ({
                        time: Number(k[0]),
                        open: parseFloat(k[1]),
                        high: parseFloat(k[2]),
                        low: parseFloat(k[3]),
                        close: parseFloat(k[4]),
                        volume: parseFloat(k[5]),
                    }));
                    const synthesized = KLineSynthesizer.synthesize(secKlines, targetMin);
                    if (synthesized.length > 0) {
                        return {
                            data: synthesized.map(k => [k.time, k.open, k.high, k.low, k.close, k.volume]),
                            source: 'Spot-1s-Synthesized'
                        };
                    }
                }
            }
        } catch (e) {
            console.warn("[KlineRace] 1s synthesis fetch failed, continuing to standard kline race", e);
        }
    }

    const futuresUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=${timeframe}&limit=${limit}`;
    const spotUrl = `https://api.binance.com/api/v3/klines?symbol=${safeSymbol}&interval=${timeframe}&limit=${limit}`;

    const fetchWithTimeout = async (url: string, sourceName: string, timeout = 3500): Promise<{ data: any[][], source: string }> => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
            const res = await fetch(url, { signal: controller.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                return { data, source: sourceName };
            }
            throw new Error('Empty data');
        } finally {
            clearTimeout(timeoutId);
        }
    };

    const fetchViaFallbackService = async (url: string, sourceName: string): Promise<{ data: any[][], source: string }> => {
        const res = await fetchWithFallback(url, { priority: 'HIGH', timeout: 4000 });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            return { data, source: sourceName };
        }
        throw new Error('Empty data');
    };

    // Parallel multi-channel racing (Promise.any equivalent that ignores fast rejections)
    const raceChannels: Array<Promise<{ data: any[][], source: string }>> = [
        // 1. High-speed local backend proxy (Futures)
        fetchWithTimeout(`/api/proxy?url=${encodeURIComponent(futuresUrl)}&priority=high`, 'Local-Proxy-Futures', 3000),
        // 2. High-speed local backend proxy (Spot)
        fetchWithTimeout(`/api/proxy?url=${encodeURIComponent(spotUrl)}&priority=high`, 'Local-Proxy-Spot', 3000),
        // 3. Direct Futures WebSocket API
        fetchKlinesViaWebSocket(safeSymbol, timeframe, limit, true),
        // 4. Direct Spot WebSocket API
        fetchKlinesViaWebSocket(safeSymbol, timeframe, limit, false),
        // 5. Fallback engine with multi-proxy rotation
        fetchViaFallbackService(futuresUrl, 'FallbackService-Futures'),
        // 6. Direct Spot endpoint (Fastest if client has non-blocked network)
        fetchWithTimeout(spotUrl, 'Direct-Spot', 2000),
        // 7. Direct Futures endpoint
        fetchWithTimeout(futuresUrl, 'Direct-Futures', 2000)
    ];

    try {
        const winner = await fetchFirstValid(raceChannels);
        return winner;
    } catch (raceErr) {
        console.warn("[KlineRace] All fast race channels failed, trying final fallback sequence...");
    }

    // Final fallback sequence
    try {
        const res = await fetchWithFallback(futuresUrl, { priority: 'HIGH', timeout: 6000 });
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            return { data, source: 'Final-Fallback-Futures' };
        }
    } catch (e) {}

    try {
        const res = await fetchWithFallback(spotUrl, { priority: 'HIGH', timeout: 6000 });
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            return { data, source: 'Final-Fallback-Spot' };
        }
    } catch (e) {}

    throw new Error(`无法获取 ${safeSymbol} 的 K 线数据，请检查网络连接或稍后重试`);
}

const KlineChartModal: React.FC<Props> = ({ symbol, initialTimeframe = '15m', signals = [], entryPrice, entryTime, currentPrice, scanWindow = 9, list2Config, list4Config: propList4Config, highlightTime, extraLines, directMode = false, limit = 299, disablePortal = false, highlightTf, showAuditLines = false, tradeLogs = [], appearedTime, disappearedTime, onClose, onTimeframeChange, lookbackDays: propLookbackDays, sidewaysDays: propSidewaysDays, hasPrev, hasNext, currentIndexLabel, onPrev, onNext }) => {
  const backtest = useOptionalBacktest();
  const [timeframe, setTimeframe] = useState(() => sanitizeTf(initialTimeframe));
  const serializedConfig = JSON.stringify(list2Config);

  // 🔒 [SECURITY_LOCK: KLINE_KEYBOARD_NAV]
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' && hasPrev && onPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.key === 'ArrowDown' && hasNext && onNext) {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasPrev, hasNext, onPrev, onNext]);
  
  // Sync timeframe with initialTimeframe if it changes (e.g. when clicking a different row for same symbol)
  useEffect(() => {
    const cleanTf = sanitizeTf(initialTimeframe);
    if (cleanTf && cleanTf !== timeframe) {
      setTimeframe(cleanTf);
    }
  }, [initialTimeframe]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [fullData, setFullData] = useState<KlineData[]>([]);
  const [emaData, setEmaData] = useState<Record<number, number[]>>({});
  const [lastUpdated, setLastUpdated] = useState<number>(0);
  const [showDivergenceMarkers, setShowDivergenceMarkers] = useState<boolean>(true);
  
  // Computed Signals State (Full History)
  const [computedSignals, setComputedSignals] = useState<Signal[]>([]);

  // List 2 EMA Alignment & Divergence Markers across full candlestick history (ONLY the 1st candle of each divergence run that passes crossing validation)
  const divergenceMarkers = useMemo(() => {
      if (fullData.length === 0) return [];
      const markers: {
          index: number;
          time: number;
          direction: 'LONG' | 'SHORT';
          isStart: boolean;
          divergenceStartIdx?: number;
          delayBars?: number;
          e10: number;
          e20: number;
          e30: number;
          e40: number;
          e80?: number;
      }[] = [];

      const getEmaAt = (period: number, idx: number) => {
          const arr = emaData[period];
          if (!arr) return null;
          const offsetIdx = idx - (period - 1);
          return (offsetIdx >= 0 && offsetIdx < arr.length) ? arr[offsetIdx] : null;
      };

      const enableDivergenceCrossCheck = list2Config?.enableDivergenceCrossCheck !== undefined ? !!list2Config.enableDivergenceCrossCheck : true;
      const divergenceLookbackBars = (list2Config?.divergenceLookbackBars !== undefined && !Number.isNaN(list2Config.divergenceLookbackBars)) 
          ? Math.max(1, list2Config.divergenceLookbackBars) 
          : 20;
      const scanLookbackLimit = (list2Config?.lookbackLimit !== undefined && !Number.isNaN(list2Config.lookbackLimit)) 
          ? Math.max(1, list2Config.lookbackLimit) 
          : 8;

      let prevDir: 'LONG' | 'SHORT' | null = null;

      for (let i = 0; i < fullData.length; i++) {
          const e10 = getEmaAt(10, i);
          const e20 = getEmaAt(20, i);
          const e30 = getEmaAt(30, i);
          const e40 = getEmaAt(40, i);
          const e80 = getEmaAt(80, i);

          if (e10 === null || e20 === null || e30 === null || e40 === null) {
              prevDir = null;
              continue;
          }

          // Bullish alignment: 10 > 20 > 30 > 40
          const isLongDiv = e10 > e20 && e20 > e30 && e30 > e40;
          // Bearish alignment: 10 < 20 < 30 < 40
          const isShortDiv = e10 < e20 && e20 < e30 && e30 < e40;

          if (isLongDiv) {
              const isStart = prevDir !== 'LONG';
              if (isStart) {
                  let crossedAllL = true;
                  if (enableDivergenceCrossCheck) {
                      let crossed20L = false;
                      let crossed30L = false;
                      let crossed40L = false;
                      let was10Below20 = false;
                      let was10Below30 = false;
                      let was10Below40 = false;

                      for (let b = 0; b < divergenceLookbackBars; b++) {
                          const bIdx = i - b;
                          if (bIdx - 1 < 0) break;

                          const cur10 = getEmaAt(10, bIdx);
                          const cur20 = getEmaAt(20, bIdx);
                          const cur30 = getEmaAt(30, bIdx);
                          const cur40 = getEmaAt(40, bIdx);

                          const prev10 = getEmaAt(10, bIdx - 1);
                          const prev20 = getEmaAt(20, bIdx - 1);
                          const prev30 = getEmaAt(30, bIdx - 1);
                          const prev40 = getEmaAt(40, bIdx - 1);

                          if (cur10 !== null) {
                              if (cur20 !== null && cur10 <= cur20) was10Below20 = true;
                              if (cur30 !== null && cur10 <= cur30) was10Below30 = true;
                              if (cur40 !== null && cur10 <= cur40) was10Below40 = true;
                          }

                          if (cur10 !== null && prev10 !== null) {
                              if (cur20 !== null && prev20 !== null && ((prev10 <= prev20 && cur10 >= cur20) || (prev10 < prev20 && cur10 > cur20))) crossed20L = true;
                              if (cur30 !== null && prev30 !== null && ((prev10 <= prev30 && cur10 >= cur30) || (prev10 < prev30 && cur10 > cur30))) crossed30L = true;
                              if (cur40 !== null && prev40 !== null && ((prev10 <= prev40 && cur10 >= cur40) || (prev10 < prev40 && cur10 > cur40))) crossed40L = true;
                          }
                      }

                      if (e10 > e20 && was10Below20) crossed20L = true;
                      if (e10 > e30 && was10Below30) crossed30L = true;
                      if (e10 > e40 && was10Below40) crossed40L = true;

                      crossedAllL = crossed20L && crossed30L && crossed40L;
                  }

                  if (crossedAllL) {
                      // 🔒 [USER MANDATORY RULE] 发散K线同向确认：必须为阳线(Close > Open)。
                      // 若发散起点为阴线，在 scanLookbackLimit 内寻找第一根收阳K线确认；超时未收阳则作废不予标记。
                      if (fullData[i].close > fullData[i].open) {
                          markers.push({
                              index: i,
                              time: fullData[i].time,
                              direction: 'LONG',
                              isStart: true,
                              e10,
                              e20,
                              e30,
                              e40,
                              e80: e80 !== null ? e80 : undefined
                          });
                      } else {
                          const maxForward = Math.min(fullData.length - 1, i + scanLookbackLimit);
                          let foundIdx = -1;
                          for (let j = i + 1; j <= maxForward; j++) {
                              const j10 = getEmaAt(10, j);
                              const j20 = getEmaAt(20, j);
                              const j30 = getEmaAt(30, j);
                              // 🔒 铁律门禁：向后确认期间若多头形态破坏，立即终止并作废
                              if (j10 === null || j20 === null || j10 <= j20 || (j30 !== null && j10 <= j30)) {
                                  break;
                              }
                              if (fullData[j].close > fullData[j].open) {
                                  foundIdx = j;
                                  break;
                              }
                          }
                          if (foundIdx !== -1) {
                              markers.push({
                                  index: foundIdx,
                                  time: fullData[foundIdx].time,
                                  direction: 'LONG',
                                  isStart: true,
                                  divergenceStartIdx: i,
                                  delayBars: foundIdx - i,
                                  e10,
                                  e20,
                                  e30,
                                  e40,
                                  e80: e80 !== null ? e80 : undefined
                              });
                          }
                      }
                  }
              }
              prevDir = 'LONG';
          } else if (isShortDiv) {
              const isStart = prevDir !== 'SHORT';
              if (isStart) {
                  let crossedAllS = true;
                  if (enableDivergenceCrossCheck) {
                      let crossed20S = false;
                      let crossed30S = false;
                      let crossed40S = false;
                      let was10Above20 = false;
                      let was10Above30 = false;
                      let was10Above40 = false;

                      for (let b = 0; b < divergenceLookbackBars; b++) {
                          const bIdx = i - b;
                          if (bIdx - 1 < 0) break;

                          const cur10 = getEmaAt(10, bIdx);
                          const cur20 = getEmaAt(20, bIdx);
                          const cur30 = getEmaAt(30, bIdx);
                          const cur40 = getEmaAt(40, bIdx);

                          const prev10 = getEmaAt(10, bIdx - 1);
                          const prev20 = getEmaAt(20, bIdx - 1);
                          const prev30 = getEmaAt(30, bIdx - 1);
                          const prev40 = getEmaAt(40, bIdx - 1);

                          if (cur10 !== null) {
                              if (cur20 !== null && cur10 >= cur20) was10Above20 = true;
                              if (cur30 !== null && cur10 >= cur30) was10Above30 = true;
                              if (cur40 !== null && cur10 >= cur40) was10Above40 = true;
                          }

                          if (cur10 !== null && prev10 !== null) {
                              if (cur20 !== null && prev20 !== null && ((prev10 >= prev20 && cur10 <= cur20) || (prev10 > prev20 && cur10 < cur20))) crossed20S = true;
                              if (cur30 !== null && prev30 !== null && ((prev10 >= prev30 && cur10 <= cur30) || (prev10 > prev30 && cur10 < cur30))) crossed30S = true;
                              if (cur40 !== null && prev40 !== null && ((prev10 >= prev40 && cur10 <= cur40) || (prev10 > prev40 && cur10 < cur40))) crossed40S = true;
                          }
                      }

                      if (e10 < e20 && was10Above20) crossed20S = true;
                      if (e10 < e30 && was10Above30) crossed30S = true;
                      if (e10 < e40 && was10Above40) crossed40S = true;

                      crossedAllS = crossed20S && crossed30S && crossed40S;
                  }

                  if (crossedAllS) {
                      // 🔒 [USER MANDATORY RULE] 发散K线同向确认：必须为阴线(Close < Open)。
                      // 若发散起点为阳线，在 scanLookbackLimit 内寻找第一根收阴K线确认；超时未收阴则作废不予标记。
                      if (fullData[i].close < fullData[i].open) {
                          markers.push({
                              index: i,
                              time: fullData[i].time,
                              direction: 'SHORT',
                              isStart: true,
                              e10,
                              e20,
                              e30,
                              e40,
                              e80: e80 !== null ? e80 : undefined
                          });
                      } else {
                          const maxForward = Math.min(fullData.length - 1, i + scanLookbackLimit);
                          let foundIdx = -1;
                          for (let j = i + 1; j <= maxForward; j++) {
                              const j10 = getEmaAt(10, j);
                              const j20 = getEmaAt(20, j);
                              const j30 = getEmaAt(30, j);
                              // 🔒 铁律门禁：向后确认期间若空头形态破坏，立即终止并作废
                              if (j10 === null || j20 === null || j10 >= j20 || (j30 !== null && j10 >= j30)) {
                                  break;
                              }
                              if (fullData[j].close < fullData[j].open) {
                                  foundIdx = j;
                                  break;
                              }
                          }
                          if (foundIdx !== -1) {
                              markers.push({
                                  index: foundIdx,
                                  time: fullData[foundIdx].time,
                                  direction: 'SHORT',
                                  isStart: true,
                                  divergenceStartIdx: i,
                                  delayBars: foundIdx - i,
                                  e10,
                                  e20,
                                  e30,
                                  e40,
                                  e80: e80 !== null ? e80 : undefined
                              });
                          }
                      }
                  }
              }
              prevDir = 'SHORT';
          } else {
              prevDir = null;
          }
      }

      return markers;
  }, [fullData, emaData, list2Config]);

  const bullishDivergenceCount = useMemo(() => divergenceMarkers.filter(m => m.direction === 'LONG').length, [divergenceMarkers]);
  const bearishDivergenceCount = useMemo(() => divergenceMarkers.filter(m => m.direction === 'SHORT').length, [divergenceMarkers]);

  // Optimized O(log N) candle index lookup helper using binary search on timestamps
  const getCandleIdxFast = useCallback((time: number, data: KlineData[] = fullData): number => {
      if (data.length === 0) return -1;
      let left = 0;
      let right = data.length - 1;
      while (left <= right) {
          const mid = Math.floor((left + right) / 2);
          if (data[mid].time === time) return mid;
          if (data[mid].time < time) left = mid + 1;
          else right = mid - 1;
      }
      // If exact timestamp not found, check closest neighbor within interval tolerance
      const tfMinutes = getTfMinutes(timeframe);
      const intervalMs = tfMinutes * 60 * 1000;
      const tolerance = intervalMs * 0.8;
      let bestIdx = -1;
      let minDiff = Infinity;
      const candidates = [left - 1, left, left + 1];
      for (const idx of candidates) {
          if (idx >= 0 && idx < data.length) {
              const diff = Math.abs(data[idx].time - time);
              if (diff <= tolerance && diff < minDiff) {
                  minDiff = diff;
                  bestIdx = idx;
              }
          }
      }
      if (bestIdx !== -1) return bestIdx;
      // Fallback: check if time falls within candle duration
      for (let i = Math.max(0, left - 2); i <= Math.min(data.length - 1, left + 2); i++) {
          if (time >= data[i].time && time < data[i].time + intervalMs) {
              return i;
          }
      }
      // Final fallback: closest existing candle
      if (left >= 0 && left < data.length) return left;
      if (left - 1 >= 0) return left - 1;
      return -1;
  }, [fullData, timeframe]);

  // Analyze whether the current coin/timeframe signal is Crossing (穿越) or Divergence/Spread (发散)
  const signalPattern = useMemo(() => {
      if (fullData.length === 0 || !list2Config) return null;
      try {
          const closes = fullData.map(k => k.close);
          const highs = fullData.map(k => k.high);
          const lows = fullData.map(k => k.low);
          const opens = fullData.map(k => k.open);
          const volumes = fullData.map(k => k.volume);
          const timestamps = fullData.map(k => k.time);
          const scanConfig = { ...list2Config, maxLag: 9 };
          const results = analyzeList2Crossing(symbol, timeframe, closes, highs, lows, opens, volumes, timestamps, scanConfig);
          if (results && results.length > 0) {
              const hasAligned = results.some(r => r.isAligned);
              const hasCrossing = results.some(r => !r.isAligned && r.crossingTimes && r.crossingTimes.length > 0);
              if (hasAligned && hasCrossing) return '穿越/发散';
              if (hasAligned) return '发散';
              return '穿越';
          }
      } catch (e) {
          // fallback
      }
      return null;
  }, [fullData, serializedConfig, symbol, timeframe]);

  // Memoize signal statistics calculation to prevent heavy re-calculation on every mouse move
  const computedSignalsWithStats = useMemo<ComputedSignal[]>(() => {
      if (computedSignals.length === 0 || fullData.length === 0) return [];
      
      return computedSignals.map((sig) => {
          const signalIdx = getCandleIdxFast(sig.time, fullData);
          if (signalIdx === -1) {
              return { ...sig, signalIdx: -1 };
          }

          const d = fullData[signalIdx];
          const isLong = sig.type === 'LONG';
          
          // Calculate amplitude with safe minimum threshold matching list4_momentum.ts
          const signalHigh = d.high;
          const signalLow = d.low;
          const amplitude = signalHigh - signalLow;
          const safeAmplitude = amplitude > (d.close * 0.0005) ? amplitude : (d.close * 0.0005);
          
          let list4Config: any = propList4Config || null;
          if (!list4Config) {
            try {
              const selectedId = typeof window !== 'undefined' ? localStorage.getItem('SCANNER_SELECTED_STRATEGY_ID') : '';
              const savedL4 = (selectedId ? localStorage.getItem(`SCANNER_LIST4_CONFIG_${selectedId}`) : null) || 
                              localStorage.getItem('SCANNER_LIST4_CONFIG');
              if (savedL4) list4Config = JSON.parse(savedL4);
            } catch(e) {}
          }

          const midlineThreshold = (list4Config && typeof list4Config.midlineThreshold === 'number' && !isNaN(list4Config.midlineThreshold)) ? list4Config.midlineThreshold : 80;
          const breakoutThreshold = (list4Config && typeof list4Config.breakoutThreshold === 'number' && !isNaN(list4Config.breakoutThreshold)) ? list4Config.breakoutThreshold : 10;
          
          const high = signalHigh;
          const low = signalLow;
          const price_range = safeAmplitude;
          const breakout_pct = breakoutThreshold / 100;
          const defense_pct = midlineThreshold / 100;

          // 进攻突破价格计算
          // long_breakout = high + price_range * breakout_pct
          // short_breakout = low - price_range * breakout_pct
          const long_breakout = high + price_range * breakout_pct;
          const short_breakout = low - price_range * breakout_pct;

          // 中轴防守价格计算
          // long_defense = high - price_range * defense_pct
          // short_defense = low + price_range * defense_pct
          const long_defense = high - price_range * defense_pct;
          const short_defense = low + price_range * defense_pct;

          // 优先采用从外部卡片传入的精确进攻与防守线价格（仅对当前聚焦的信号生效）
          const triggerExtra = extraLines?.find(l => l.label && (l.label.includes('TRIGGER') || l.label.includes('攻') || l.label.includes('突破')));
          const defenseExtra = extraLines?.find(l => l.label && (l.label.includes('DEFENSE') || l.label.includes('守') || l.label.includes('防守')));

          const isCurrentSignal = entryTime ? sig.time === entryTime : true;
          const midPrice = (isCurrentSignal && defenseExtra && defenseExtra.price > 0) ? defenseExtra.price : (isLong ? long_defense : short_defense);
          const breakthroughPrice = (isCurrentSignal && triggerExtra && triggerExtra.price > 0) ? triggerExtra.price : (isLong ? long_breakout : short_breakout);

          // Compute signal parameters
          const refPrice = (signalIdx > 0 && fullData[signalIdx - 1]) ? fullData[signalIdx - 1].close : d.open;
          const ampVal = refPrice > 0 ? ((d.high - d.low) / refPrice) * 100 : 0;
          
          const volumeLookback = 20;
          let sumVol = 0;
          let countVol = 0;
          const lookbackStart = Math.max(0, signalIdx - volumeLookback);
          for (let idx = lookbackStart; idx < signalIdx; idx++) {
              sumVol += fullData[idx].volume;
              countVol++;
          }
          const avgVol = countVol > 0 ? (sumVol / countVol) : d.volume;
          const volRatioVal = avgVol > 0 ? (d.volume / avgVol) * 100 : 100;
          
          const bodyRatioVal = d.high > d.low ? (Math.abs(d.close - d.open) / (d.high - d.low)) * 100 : 0;
          
          let maxHigh300 = d.high;
          let minLow300 = d.low;
          const lookback300Start = Math.max(0, signalIdx - 300);
          for (let idx = lookback300Start; idx <= signalIdx; idx++) {
              if (fullData[idx].high > maxHigh300) {
                  maxHigh300 = fullData[idx].high;
              }
              if (fullData[idx].low < minLow300) {
                  minLow300 = fullData[idx].low;
              }
          }
          
          const drop300 = maxHigh300 > 0 ? ((maxHigh300 - d.close) / maxHigh300) * 100 : 0;
          const rise300 = minLow300 > 0 ? ((d.close - minLow300) / minLow300) * 100 : 0;
          
          const openRiseFromMin = minLow300 > 0 ? ((d.open - minLow300) / minLow300) * 100 : 0;
          const openDropFromMax = maxHigh300 > 0 ? ((maxHigh300 - d.open) / maxHigh300) * 100 : 0;

          return {
              ...sig,
              signalIdx,
              midPrice,
              breakthroughPrice,
              breakoutThreshold,
              midlineThreshold,
              ampVal,
              volRatioVal,
              bodyRatioVal,
              drop300,
              rise300,
              openRiseFromMin,
              openDropFromMax
          };
      });
  }, [computedSignals, fullData, timeframe, getCandleIdxFast, extraLines, propList4Config]);

  // Daily (Major Trend) Stats State
  interface DailyStats {
      lookbackDays: number;
      maxDrop: number;
      maxPump: number;
      extremeRise: number;
      extremeDrop: number;
      sidewaysRise: number;
      sidewaysDrop: number;
      ema80Dev: number;
      volRatio: number;
  }
  const [dailyStats, setDailyStats] = useState<DailyStats | null>(null);

  // Background fetch of daily (1d) klines for Major Trend Statistics Dashboard
  useEffect(() => {
      if (loading) return;
      
      let isMounted = true;
      let timerId: any;
      
      const calculateDailyStats = async () => {
          let lookbackDays = propLookbackDays || 300;
          let sidewaysDays = propSidewaysDays !== undefined ? propSidewaysDays : 7;
          
          if (!propLookbackDays) {
              try {
                  const savedConfig = localStorage.getItem('SCANNER_CONFIG_24H');
                  if (savedConfig) {
                      const parsed = JSON.parse(savedConfig);
                      if (parsed && parsed.majorTrend) {
                          lookbackDays = parsed.majorTrend.lookbackDays || 300;
                          sidewaysDays = parsed.majorTrend.sidewaysDays !== undefined ? parsed.majorTrend.sidewaysDays : 7;
                      }
                  }
              } catch (e) {
                  console.warn("[KlineChart] Failed to parse major trend configuration from localStorage:", e);
              }
          }

          const limit = lookbackDays + 25;
          const safeSymbol = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
          let dailyKlines: KlineData[] = [];

          if (backtest && backtest.isPlaying) {
              try {
                  const virtualDaily = await backtest.fetchVirtualKlines(symbol, '1d', limit);
                  dailyKlines = virtualDaily.map(k => ({
                      time: k.time,
                      open: k.open,
                      high: k.high,
                      low: k.low,
                      close: k.close,
                      volume: k.volume
                  }));
              } catch (e) {
                  console.warn("[KlineChart] Failed to load virtual daily stats:", e);
              }
          } else {
              try {
                  const { data: json, source } = await raceFetchKlines(safeSymbol, '1d', limit);
                  console.log(`[KlineChart] Loaded daily stats from ${source}, ${json.length} records`);
                  if (Array.isArray(json) && json.length > 0) {
                      dailyKlines = json.map((k: any) => ({
                          time: k[0],
                          open: parseFloat(k[1]) || 0,
                          high: parseFloat(k[2]) || 0,
                          low: parseFloat(k[3]) || 0,
                          close: parseFloat(k[4]) || 0,
                          volume: parseFloat(k[5]) || 0
                      }));
                  }
              } catch (e) {
                  console.warn("[KlineChart] Failed to load real daily stats:", e);
              }
          }

          if (!isMounted || dailyKlines.length === 0) return;

          try {
              const currentPrice = dailyKlines[dailyKlines.length - 1].close;
              
              // Align with Item.tsx: slice to exactly lookbackDays
              const periodKlines = dailyKlines.slice(-lookbackDays);
              const historySlice = periodKlines.slice(0, Math.max(1, periodKlines.length - sidewaysDays));
              const maxHigh = historySlice.length > 0 ? Math.max(...historySlice.map(c => c.high)) : currentPrice;
              const minLow = historySlice.length > 0 ? Math.min(...historySlice.map(c => c.low)) : currentPrice;

              const actualDrop = maxHigh > 0 ? ((maxHigh - currentPrice) / maxHigh) * 100 : 0;
              const actualPump = minLow > 0 ? ((currentPrice - minLow) / minLow) * 100 : 0;

              // Extreme ranges
              const extremeRise = minLow > 0 ? ((maxHigh - minLow) / minLow) * 100 : 0;
              const extremeDrop = maxHigh > 0 ? ((maxHigh - minLow) / maxHigh) * 100 : 0;

              // Sideways stats
              let sidewaysRise = 0;
              let sidewaysDrop = 0;
              const sidewaysIndex = dailyKlines.length - 1 - sidewaysDays;
              if (sidewaysIndex >= 0) {
                  const referencePrice = dailyKlines[sidewaysIndex].close;
                  const sidewaysSlice = dailyKlines.slice(sidewaysIndex);
                  const sidewaysHigh = Math.max(...sidewaysSlice.map(c => c.high));
                  const sidewaysLow = Math.min(...sidewaysSlice.map(c => c.low));
                  sidewaysRise = referencePrice > 0 ? ((sidewaysHigh - referencePrice) / referencePrice) * 100 : 0;
                  sidewaysDrop = referencePrice > 0 ? ((referencePrice - sidewaysLow) / referencePrice) * 100 : 0;
              }

              // Indicators & suggestions
              const dailyCloses = dailyKlines.map(k => k.close);
              const ema80Array = calculateEMA(dailyCloses, 80);
              const currentEma80 = ema80Array[ema80Array.length - 1];
              const ema80Dev = currentEma80 ? ((currentPrice - currentEma80) / currentEma80) * 100 : 0;

              const lastVol = dailyKlines[dailyKlines.length - 1].volume;
              const volSlice = dailyKlines.slice(-20);
              const volAvg20 = volSlice.reduce((sum, k) => sum + k.volume, 0) / volSlice.length;
              const volRatio = volAvg20 > 0 ? (lastVol / volAvg20) : 1;

              setDailyStats({
                  lookbackDays,
                  maxDrop: actualDrop,
                  maxPump: actualPump,
                  extremeRise,
                  extremeDrop,
                  sidewaysRise,
                  sidewaysDrop,
                  ema80Dev,
                  volRatio
              });
          } catch (e) {
              console.error("[KlineChart] Daily stats calculation error:", e);
          }
      };

      timerId = setTimeout(() => {
          calculateDailyStats();
      }, 300);

      return () => {
          isMounted = false;
          clearTimeout(timerId);
      };
  }, [symbol, backtest?.isPlaying, directMode, loading, propLookbackDays, propSidewaysDays]);


  // Viewport State
  const [visibleCount, setVisibleCount] = useState(showAuditLines ? 48 : 200); 
  const [startIndex, setStartIndex] = useState(0); 
  const [hoverIndex, setHoverIndex] = useState<number | null>(null); 
  const [mouseY, setMouseY] = useState<number | null>(null); 
  const [isAutoScroll, setIsAutoScroll] = useState(true); 
  
  // Drag State
  const [isDragging, setIsDragging] = useState(false);

  // Measure State
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [measureStart, setMeasureStart] = useState<{x: number, y: number, price: number, index: number} | null>(null);
  const [measureEnd, setMeasureEnd] = useState<{x: number, y: number, price: number, index: number} | null>(null);
  const dragStartX = useRef<number>(0);
  const startIndexRef = useRef<number>(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });

  useEffect(() => {
    if (!containerRef.current) return;
    let animationFrameId: number;
    const observer = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      cancelAnimationFrame(animationFrameId);
      animationFrameId = requestAnimationFrame(() => {
        setDimensions({ width: width || 800, height: height || 500 });
      });
    });
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  // Recalculate signals whenever fullData or config changes
  useEffect(() => {
      if (fullData.length === 0 || !list2Config) {
          // If no config provided, fallback to props signals or empty
          if (signals.length > 0) {
              setComputedSignals(prev => {
                  if (JSON.stringify(prev) === JSON.stringify(signals)) return prev;
                  return signals;
              });
          }
          return;
      }

      // Re-run the core rule logic strictly according to the user settings (MaxLag)
      const closes = fullData.map(k => k.close);
      const highs = fullData.map(k => k.high);
      const lows = fullData.map(k => k.low);
      const opens = fullData.map(k => k.open);
      const volumes = fullData.map(k => k.volume);
      const timestamps = fullData.map(k => k.time);

      const results = analyzeList2Crossing(
          symbol, 
          timeframe, 
          closes, 
          highs, 
          lows, 
          opens, 
          volumes, 
          timestamps, 
          list2Config,
          list2Config.lookbackBars ?? 5
      );
      
      const allSignals: Signal[] = [];
      results.forEach(res => {
          if (res.crossingTimes) {
              res.crossingTimes.forEach(t => {
                  allSignals.push({ time: t, type: res.direction || 'LONG' });
              });
          }
      });

      // NEW: Merge signals passed from parent (Scanner) to ensure consistency
      // Only merge if we are on the initial requested timeframe to avoid polluting other TFs
      if (timeframe === initialTimeframe && signals && signals.length > 0) {
          const e10Arr = calculateEMA(closes, 10);
          const e20Arr = calculateEMA(closes, 20);
          const e30Arr = calculateEMA(closes, 30);
          signals.forEach(s => {
              const sIdx = getCandleIdxFast(s.time, fullData);
              if (sIdx !== -1 && sIdx >= 30) {
                  const val10 = e10Arr[sIdx];
                  const val20 = e20Arr[sIdx];
                  const val30 = e30Arr[sIdx];
                  if (val10 !== undefined && val20 !== undefined) {
                      // 🔒 铁律门禁：做多信号所在K线绝不可处于空头死叉 (EMA10 < EMA20 且 EMA10 < EMA30)
                      if (s.type === 'LONG' && val10 < val20 && (val30 === undefined || val10 < val30)) {
                          return;
                      }
                      // 做空信号所在K线绝不可处于多头金叉 (EMA10 > EMA20 且 EMA10 > EMA30)
                      if (s.type === 'SHORT' && val10 > val20 && (val30 === undefined || val10 > val30)) {
                          return;
                      }
                  }
              }
              // Avoid exact duplicates
              const exists = allSignals.some(existing => existing.time === s.time && existing.type === s.type);
              if (!exists) {
                  allSignals.push(s);
              }
          });
      }

      // De-duplicate signals by time AND type (allow both Long and Short at same time)
      const uniqueSignals = Array.from(new Map(allSignals.map(item => [`${item.time}-${item.type}`, item])).values());
      setComputedSignals(prev => {
          if (JSON.stringify(prev) === JSON.stringify(uniqueSignals)) return prev;
          return uniqueSignals;
      });

  }, [fullData, serializedConfig, symbol, timeframe]); // signals prop is ignored if we compute fresh ones

  useEffect(() => {
    console.log("[KlineChart] Effect running with dependencies:", {symbol, timeframe, retryCount});
    let isMounted = true;
    let timerId: any;

    const fetchData = async (isInitialLoad: boolean) => {
        console.log(`[KlineChart] Fetching data for ${symbol} ${timeframe}, initial: ${isInitialLoad}, directMode: ${directMode}, time: ${new Date().toISOString()}`);
        
        // IF BACKTEST MODE: Use virtual data
        if (backtest && backtest.isPlaying) {
            if (isInitialLoad) setLoading(true);
            try {
                const klines = await backtest.fetchVirtualKlines(symbol, timeframe, 300);
                if (isMounted) {
                    const mappedKlines: KlineData[] = klines.map(k => ({
                        time: k.time,
                        open: k.open,
                        high: k.high,
                        low: k.low,
                        close: k.close,
                        volume: k.volume
                    }));
                    
                    const closes = mappedKlines.map(k => k.close);
                    const emas = {
                        10: calculateEMA(closes, 10),
                        20: calculateEMA(closes, 20),
                        30: calculateEMA(closes, 30),
                        40: calculateEMA(closes, 40),
                        80: calculateEMA(closes, 80)
                    };

                    setFullData(mappedKlines);
                    setEmaData(emas);
                    setError(null);
                    setLastUpdated(Date.now());

                    if (isInitialLoad) {
                        const defaultVisible = showAuditLines ? 48 : 200;
                        setVisibleCount(defaultVisible);
                        
                        let targetIdx = -1;
                        if (appearedTime) {
                            targetIdx = getCandleIdxFast(appearedTime, mappedKlines);
                        } else if (signals && signals.length > 0) {
                            targetIdx = getCandleIdxFast(signals[0].time, mappedKlines);
                        } else if (highlightTime) {
                            targetIdx = getCandleIdxFast(highlightTime, mappedKlines);
                        } else if (entryTime) {
                            targetIdx = getCandleIdxFast(entryTime, mappedKlines);
                        }

                        if (targetIdx !== -1) {
                            const offsetFromLeft = showAuditLines ? Math.floor(defaultVisible * 0.35) : (defaultVisible - 1 - 18);
                            const calculatedStart = targetIdx - offsetFromLeft;
                            setStartIndex(Math.max(0, Math.min(calculatedStart, mappedKlines.length - defaultVisible)));
                            setIsAutoScroll(false);
                        } else {
                            setStartIndex(Math.max(0, mappedKlines.length - defaultVisible));
                            setIsAutoScroll(true);
                        }
                    }
                }
            } catch (e) {
                console.error("[KlineChart] Backtest fetch error:", e);
                if (isMounted) setError("无法获取回测K线数据");
            } finally {
                if (isMounted) {
                    if (isInitialLoad) setLoading(false);
                    // In backtest mode, poll more frequently to sync with simulation
                    timerId = setTimeout(() => fetchData(false), 2000); 
                }
            }
            return;
        }

        if (isInitialLoad) {
            setLoading(true);
            setError(null);
        }

        try {
            // Fix missing USDT issue
            const safeSymbol = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
            
            console.log(`[KlineChart] Starting parallel race fetch for ${safeSymbol} (${timeframe})`);
            const { data: json, source } = await raceFetchKlines(safeSymbol, timeframe, limit);
            console.log(`[KlineChart] Winner of race: ${source}, loaded ${json.length} records`);
            
            if (isMounted) {
                if (Array.isArray(json) && json.length > 0) {
                    const klines: KlineData[] = json.map((k: any) => ({
                        time: k[0],
                        open: parseFloat(k[1]) || 0,
                        high: parseFloat(k[2]) || 0,
                        low: parseFloat(k[3]) || 0,
                        close: parseFloat(k[4]) || 0, 
                        volume: parseFloat(k[5]) || 0
                    }));
                    
                    const closes = klines.map(k => k.close);
                    const emas = {
                        10: calculateEMA(closes, 10),
                        20: calculateEMA(closes, 20),
                        30: calculateEMA(closes, 30),
                        40: calculateEMA(closes, 40),
                        80: calculateEMA(closes, 80)
                    };

                    setFullData(klines);
                    setEmaData(emas);
                    setError(null);
                    setLastUpdated(Date.now());

                    if (isInitialLoad) {
                        const defaultVisible = showAuditLines ? 48 : 200;
                        setVisibleCount(defaultVisible);
                        
                        let targetIdx = -1;
                        if (appearedTime) {
                            targetIdx = getCandleIdxFast(appearedTime, klines);
                        } else if (signals && signals.length > 0) {
                            targetIdx = getCandleIdxFast(signals[0].time, klines);
                        } else if (highlightTime) {
                            targetIdx = getCandleIdxFast(highlightTime, klines);
                        } else if (entryTime) {
                            targetIdx = getCandleIdxFast(entryTime, klines);
                        }

                        if (targetIdx !== -1) {
                            const offsetFromLeft = showAuditLines ? Math.floor(defaultVisible * 0.35) : (defaultVisible - 1 - 18);
                            const calculatedStart = targetIdx - offsetFromLeft;
                            setStartIndex(Math.max(0, Math.min(calculatedStart, klines.length - defaultVisible)));
                            setIsAutoScroll(false);
                        } else {
                            setStartIndex(Math.max(0, klines.length - defaultVisible));
                            setIsAutoScroll(true);
                        }
                    }
                } else {
                    throw new Error("Empty data returned");
                }
            }
        } catch (e: any) {
            console.warn(`[KlineChart] Failed to fetch real kline data for ${symbol}:`, e);
            if (isMounted) {
                if (isInitialLoad) {
                    if (e.isInvalidSymbol || e.message?.includes("400")) {
                        setError(`交易对 ${symbol} 在币安暂未上市或不支持，暂无K线数据。`);
                    } else {
                        setError("无法连接行情源，请检查网络或开启直连模式");
                    }
                    setFullData([]);
                }
                setLoading(false);
            }
        } finally {
            if (isMounted) {
                if (isInitialLoad) setLoading(false);
                timerId = setTimeout(() => fetchData(false), 15000);
            }
        }
    };

    fetchData(true);
    return () => { 
        console.log(`[KlineChart] Effect cleanup for ${symbol}`);
        isMounted = false; 
        clearTimeout(timerId); 
    };
  }, [symbol, timeframe, retryCount]);

  // Auto-scroll
  useEffect(() => {
      if (fullData.length > 0 && isAutoScroll && !isDragging) {
          setStartIndex(Math.max(0, fullData.length - visibleCount));
      }
  }, [fullData.length, visibleCount, isAutoScroll, isDragging]);

  const visibleData = useMemo(() => {
      const end = Math.min(startIndex + visibleCount, fullData.length);
      return fullData.slice(startIndex, end);
  }, [fullData, startIndex, visibleCount]);

  const infoData = useMemo(() => {
      const targetIndex = hoverIndex !== null ? hoverIndex : (fullData.length - 1);
      const kline = fullData[targetIndex];
      if (!kline) return null;
      const getEma = (period: number) => {
          const arr = emaData[period];
          if (!arr) return 0;
          const offsetIdx = targetIndex - (period - 1);
          return (offsetIdx >= 0 && offsetIdx < arr.length) ? arr[offsetIdx] : null;
      };
      const amplitude = ((kline.high - kline.low) / kline.open) * 100;
      const e10 = getEma(10);
      const e20 = getEma(20);
      const e30 = getEma(30);
      const e40 = getEma(40);
      const e80 = getEma(80);

      let divergenceStatus: 'LONG' | 'SHORT' | null = null;
      if (e10 !== null && e20 !== null && e30 !== null && e40 !== null && e10 > 0 && e20 > 0 && e30 > 0 && e40 > 0) {
          if (e10 > e20 && e20 > e30 && e30 > e40) divergenceStatus = 'LONG';
          else if (e10 < e20 && e20 < e30 && e30 < e40) divergenceStatus = 'SHORT';
      }

      return {
          kline, amplitude,
          ema10: e10, ema20: e20, ema30: e30, ema40: e40, ema80: e80,
          divergenceStatus
      };
  }, [fullData, emaData, hoverIndex]);

  // Mouse Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
      setIsDragging(true);
      setIsAutoScroll(false); 
      dragStartX.current = e.clientX;
      startIndexRef.current = startIndex;
  };
  const handleMouseMove = (e: React.MouseEvent) => {
      if (!containerRef.current || fullData.length === 0) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const width = rect.width;
      const paddingRight = 80; 
      const chartWidth = width - paddingRight;
      const rightBuffer = 20;
      const effectiveCount = visibleCount + rightBuffer;
      setMouseY(y);
      if (x >= 0 && x <= chartWidth) {
          const ratio = x / chartWidth;
          const relativeIdx = Math.floor(ratio * effectiveCount);
          const actualIdx = startIndex + relativeIdx;
          if (actualIdx >= startIndex && actualIdx < startIndex + visibleCount && actualIdx < fullData.length) {
              setHoverIndex(actualIdx);
          } else { setHoverIndex(null); }
      } else { setHoverIndex(null); }
      if (isDragging) {
          const deltaX = e.clientX - dragStartX.current;
          const candleWidth = chartWidth / visibleCount;
          const deltaCandles = Math.round(deltaX / candleWidth);
          let newStart = startIndexRef.current - deltaCandles;
          newStart = Math.max(0, newStart);
          newStart = Math.min(newStart, fullData.length - visibleCount);
          setStartIndex(newStart);
      }
  };
  const handleMouseUp = () => setIsDragging(false);
  const handleResetToLatest = () => { setIsAutoScroll(true); setStartIndex(Math.max(0, fullData.length - visibleCount)); };
  const handleWheel = (e: React.WheelEvent) => {
      e.preventDefault(); // Prevent page scroll
      const delta = Math.sign(e.deltaY); 
      // Scale zoom speed by current visible count for smoother feel
      const zoomStep = Math.max(2, Math.floor(visibleCount / 20));
      let newCount = visibleCount + (delta * zoomStep * 2);
      newCount = Math.max(MIN_CANDLES_VISIBLE, Math.min(newCount, MAX_CANDLES_VISIBLE));
      
      if (newCount !== visibleCount) {
          // Adjust start index to keep the right side mostly fixed while zooming
          let newStart = startIndex + (delta > 0 ? -Math.floor(zoomStep) : Math.floor(zoomStep)); 
          newStart = Math.max(0, Math.min(newStart, fullData.length - newCount));
          setVisibleCount(newCount);
          setStartIndex(newStart);
          setIsAutoScroll(false); 
      }
  };

  // Trade Logs Marker Logic
  const tradeMarkers = useMemo(() => {
      const markers: { time: number; type: string; label: string; price?: number }[] = [];
      if (!tradeLogs) return markers;

      tradeLogs.filter(l => l.symbol === symbol).forEach(l => {
          const dirLabel = ((l.direction as any) === PositionSide.LONG || (l.direction as any) === 'LONG' || (l.direction as any) === 'BUY' || (l.direction as any) === '多') ? '多' : '空';
          const isHedge = l.is_hedge || !!l.main_entry_id;
          const isCut = !!l.parent_entry_id && (l.entry_id?.includes('_cut_') || l.exit_reason?.includes('减仓') || l.exit_reason?.includes('砍仓'));
          const isRefill = l.entry_id?.includes('_refill_');
          const isClear = l.exit_reason?.includes('解套') || l.exit_reason?.includes('断臂') || l.exit_reason?.includes('对冲清仓') || l.exit_reason?.includes('防爆安全') || l.exit_reason?.includes('断臂全清');

          if (l.entry_timestamp) {
              if (isHedge) {
                  markers.push({ time: l.entry_timestamp, type: 'HEDGE_OPEN', label: `防爆对冲(${dirLabel})`, price: l.entry_price });
              } else if (isRefill) {
                  markers.push({ time: l.entry_timestamp, type: 'HEDGE_REFILL', label: `防爆对冲补仓(${dirLabel})`, price: l.entry_price });
              } else {
                  markers.push({ time: l.entry_timestamp, type: 'OPEN', label: `开仓(${dirLabel})`, price: l.entry_price });
              }
          }
          if (l.exit_timestamp && l.status === 'CLOSED') {
              if (isCut) {
                  markers.push({ time: l.exit_timestamp, type: 'HEDGE_CUT', label: `砍仓(${dirLabel})`, price: l.exit_price || l.entry_price });
              } else if (isClear) {
                  markers.push({ time: l.exit_timestamp, type: 'HEDGE_CLEAR', label: `防爆对冲清仓(${dirLabel})`, price: l.exit_price || 0 });
              } else if (l.profit_usdt !== undefined && l.profit_usdt >= 0) {
                  markers.push({ time: l.exit_timestamp, type: 'PROFIT_CLOSE', label: `盈利平仓(${dirLabel})`, price: l.exit_price || 0 });
              } else {
                  markers.push({ time: l.exit_timestamp, type: 'LOSS_CLOSE', label: `止损平仓(${dirLabel})`, price: l.exit_price || 0 });
              }
          }
          
          if (l.signal_details && l.signal_details.timestamp) {
                markers.push({ time: l.signal_details.timestamp, type: 'SIGNAL', label: '信号' });
          }
          
          l.events?.forEach(e => {
             const eventDir = (e.action.includes('LONG') || e.action.includes('(多)') || e.action.includes('多')) ? '多' : ((e.action.includes('SHORT') || e.action.includes('(空)') || e.action.includes('空')) ? '空' : dirLabel);
             if (e.action.includes('对冲开') || e.action.includes('HEDGE_OPEN') || e.action.includes('对冲开启')) {
                 markers.push({ time: e.timestamp, type: 'HEDGE_OPEN', label: `防爆对冲(${eventDir})`, price: e.price });
             } else if (e.action.includes('砍仓') || e.action.includes('减仓')) {
                 markers.push({ time: e.timestamp, type: 'HEDGE_CUT', label: `砍仓(${eventDir})`, price: e.price });
             } else if (e.action.includes('补仓') || e.action.includes('补回')) {
                 markers.push({ time: e.timestamp, type: 'HEDGE_REFILL', label: `防爆对冲补仓(${eventDir})`, price: e.price });
             } else if (e.action.includes('清仓')) {
                 markers.push({ time: e.timestamp, type: 'HEDGE_CLEAR', label: `防爆对冲清仓(${eventDir})`, price: e.price });
             }
          });
      });

      // Deduplicate markers by time and label
      const unique = new Map<string, { time: number; type: string; label: string; price?: number }>();
      markers.forEach(m => {
          const key = `${m.time}-${m.label}`;
          if (!unique.has(key)) unique.set(key, m);
      });
      return Array.from(unique.values());
  }, [tradeLogs, symbol]);
  
  const getCandleIdx = (time: number) => {
      return getCandleIdxFast(time, fullData);
  };
  
  const renderChart = () => {
      if (visibleData.length === 0) return null;
      const { width, height } = dimensions;
      if (width === 0 || height === 0) return null;

      const chartHeight = height * 0.8;
      const volumeHeight = height * 0.2;
      const padding = { top: 30, right: 80, bottom: 20, left: 0 };
      const rightBuffer = 20;
      const effectiveCount = visibleCount + rightBuffer;

      let minPrice = Infinity, maxPrice = -Infinity, maxVol = 0;
      visibleData.forEach(d => {
          if (d.low < minPrice) minPrice = d.low;
          if (d.high > maxPrice) maxPrice = d.high;
          if (d.volume > maxVol) maxVol = d.volume;
      });
      
      // Ensure Entry Price and Extra Lines / Defense / Breakout lines are visible in scale
      if (entryPrice && entryPrice > 0) {
          minPrice = Math.min(minPrice, entryPrice * 0.995);
          maxPrice = Math.max(maxPrice, entryPrice * 1.005);
      }
      
      if (extraLines && extraLines.length > 0) {
          extraLines.forEach(line => {
              if (line.price && line.price > 0) {
                  minPrice = Math.min(minPrice, line.price * 0.995);
                  maxPrice = Math.max(maxPrice, line.price * 1.005);
              }
          });
      }
      
      const priceRange = maxPrice - minPrice;
      minPrice -= priceRange * 0.05; maxPrice += priceRange * 0.05;
      const safePriceRange = (maxPrice - minPrice) || 1; 

      const getX = (index: number) => (index / effectiveCount) * (width - padding.right);
      const getY = (price: number) => chartHeight - ((price - minPrice) / safePriceRange) * (chartHeight - padding.top) + padding.top;
      const getPriceByY = (y: number) => {
          const ratio = (chartHeight - y + padding.top) / (chartHeight - padding.top);
          return minPrice + ratio * safePriceRange;
      };
      const candleWidth = Math.max(1, (width - padding.right) / effectiveCount * 0.7);

      const candles = visibleData.map((d, i) => {
          const x = getX(i);
          const yOpen = getY(d.open);
          const yClose = getY(d.close);
          const yHigh = getY(d.high);
          const yLow = getY(d.low);
          if (isNaN(x) || isNaN(yOpen) || isNaN(yClose) || isNaN(yHigh) || isNaN(yLow)) return null;
          const isUp = d.close >= d.open;
          const color = isUp ? COLOR_UP : COLOR_DOWN;
          const vHeight = maxVol > 0 ? (d.volume / maxVol) * (volumeHeight - 5) : 0;
          const vy = height - padding.bottom - vHeight;
          return (
              <g key={d.time}>
                  <rect x={x} y={vy} width={candleWidth} height={vHeight} fill={color} opacity={0.3} />
                  <line x1={x + candleWidth/2} y1={yHigh} x2={x + candleWidth/2} y2={yLow} stroke={color} strokeWidth={1} />
                  <rect x={x} y={Math.min(yOpen, yClose)} width={candleWidth} height={Math.max(1, Math.abs(yOpen - yClose))} fill={color} />
              </g>
          );
      });

      const renderEMA = (period: number, color: string) => {
          const arr = emaData[period];
          if (!arr) return null;
          let dPath = "";
          let first = true;
          visibleData.forEach((d, i) => {
              const fullIdx = startIndex + i;
              const emaIdx = fullIdx - (period - 1);
              if (emaIdx >= 0 && emaIdx < arr.length) {
                  const val = arr[emaIdx];
                  if (val !== undefined && !isNaN(val)) {
                      const x = getX(i) + candleWidth / 2;
                      const y = getY(val);
                      if (!isNaN(x) && !isNaN(y)) {
                          if (first) { dPath += `M ${x} ${y}`; first = false; } else { dPath += ` L ${x} ${y}`; }
                      }
                  }
              }
          });
          return dPath ? <path d={dPath} fill="none" stroke={color} strokeWidth={1.5} /> : null;
      };

      const yLabels = [0, 0.2, 0.4, 0.6, 0.8, 1].map(pct => {
          const val = maxPrice - (pct * safePriceRange);
          const y = getY(val);
          if (isNaN(y)) return null;
          return (
              <g key={pct}>
                  <line x1={0} y1={y} x2={width - padding.right} stroke={COLOR_GRID} strokeDasharray="3 3" />
                  <text x={width - 75} y={y + 3} fill={COLOR_TEXT} fontSize="9" style={{ fontFamily: 'monospace' }}>{val.toFixed(8)}</text>
              </g>
          );
      });

      // -------------------------------------------------------------
      // Precise Signal Markers & Defense/Breakout Ray Calculations
      // -------------------------------------------------------------
      const signalMarkers: React.ReactNode[] = [];
      const signalsToShow = computedSignalsWithStats;

      // Identify the single Focal Signal to anchor defense & breakout lines
      let focalTime: number | null = entryTime || appearedTime || highlightTime || null;
      let focalIdx = focalTime ? getCandleIdxFast(focalTime, fullData) : -1;

      if (focalIdx === -1 && signalsToShow.length > 0) {
          const latest = signalsToShow[signalsToShow.length - 1];
          focalIdx = latest.signalIdx ?? getCandleIdxFast(latest.time, fullData);
      }
      if (focalIdx === -1 && showAuditLines && fullData.length > 0) {
          focalIdx = fullData.length - 1;
      }

      // Calculate the exact prices for the focal signal
      let focalDefensePrice: number | null = null;
      let focalBreakoutPrice: number | null = null;
      let focalIsLong = true;
      let focalMidlinePct = 80;
      let focalBreakoutPct = 10;
      let focalX: number | null = null;

      if (focalIdx !== -1 && focalIdx < fullData.length) {
          const fd = fullData[focalIdx];
          const matchedSig = signalsToShow.find(s => s.signalIdx === focalIdx);
          focalIsLong = matchedSig ? matchedSig.type === 'LONG' : true;
          
          if (extraLines) {
              const hasShortExtra = extraLines.some(l => l.label && l.label.includes('空'));
              if (hasShortExtra) focalIsLong = false;
          }

          const amp = fd.high - fd.low;
          const safeAmp = amp > (fd.close * 0.0005) ? amp : (fd.close * 0.0005);

          focalMidlinePct = matchedSig?.midlineThreshold ?? (propList4Config?.midlineThreshold ?? 80);
          focalBreakoutPct = matchedSig?.breakoutThreshold ?? (propList4Config?.breakoutThreshold ?? 10);

          const triggerExtra = extraLines?.find(l => l.label && (l.label.includes('TRIGGER') || l.label.includes('攻') || l.label.includes('突破')));
          const defenseExtra = extraLines?.find(l => l.label && (l.label.includes('DEFENSE') || l.label.includes('守') || l.label.includes('防守')));

          focalBreakoutPrice = (triggerExtra && triggerExtra.price > 0)
              ? triggerExtra.price
              : (focalIsLong ? fd.high + safeAmp * (focalBreakoutPct / 100) : fd.low - safeAmp * (focalBreakoutPct / 100));

          focalDefensePrice = (defenseExtra && defenseExtra.price > 0)
              ? defenseExtra.price
              : (focalIsLong ? fd.high - safeAmp * (focalMidlinePct / 100) : fd.low + safeAmp * (focalMidlinePct / 100));

          if (focalIdx >= startIndex && focalIdx < startIndex + visibleCount) {
              focalX = getX(focalIdx - startIndex) + candleWidth / 2;
          }
      }

      // 🎯 通用标记空间布局与避障计算函数 (纵向保留1~3厘米距离，避开K线及EMA均线，多在下方，空在上方)
      const getMarkerLayout = (
          candleIdx: number,
          dir: 'LONG' | 'SHORT',
          candle: { high: number; low: number }
      ) => {
          const gap1to3cm = 48; // 纵向靠近K线的一端保留1~3厘米(~48px)距离
          const yHigh = getY(candle.high);
          const yLow = getY(candle.low);

          if (dir === 'LONG') {
              // 多方标记：置于K线及所有EMA均线下方
              let lowestEmaY = yLow;
              [10, 20, 30, 40, 80].forEach(p => {
                  const arr = emaData[p];
                  if (!arr) return;
                  for (let offset = -2; offset <= 2; offset++) {
                      const sIdx = candleIdx + offset;
                      const eIdx = sIdx - (p - 1);
                      if (eIdx >= 0 && eIdx < arr.length) {
                          const val = arr[eIdx];
                          if (val !== undefined && !isNaN(val)) {
                              const yE = getY(val);
                              if (!isNaN(yE) && yE > lowestEmaY) {
                                  lowestEmaY = yE;
                              }
                          }
                      }
                  }
              });

              const dashStartY = yLow + gap1to3cm;
              const labelY = Math.min(chartHeight - 12, Math.max(dashStartY + 26, lowestEmaY + 28));
              const dashEndY = Math.max(dashStartY, labelY - 6);

              return {
                  dashStartY,
                  dashEndY,
                  labelY,
                  hasDashedLine: dashEndY > dashStartY
              };
          } else {
              // 空方标记：置于K线及所有EMA均线上方
              let highestEmaY = yHigh;
              [10, 20, 30, 40, 80].forEach(p => {
                  const arr = emaData[p];
                  if (!arr) return;
                  for (let offset = -2; offset <= 2; offset++) {
                      const sIdx = candleIdx + offset;
                      const eIdx = sIdx - (p - 1);
                      if (eIdx >= 0 && eIdx < arr.length) {
                          const val = arr[eIdx];
                          if (val !== undefined && !isNaN(val)) {
                              const yE = getY(val);
                              if (!isNaN(yE) && yE < highestEmaY) {
                                  highestEmaY = yE;
                              }
                          }
                      }
                  }
              });

              const dashStartY = yHigh - gap1to3cm;
              const labelY = Math.max(padding.top + 12, Math.min(dashStartY - 26, highestEmaY - 28));
              const dashEndY = Math.min(dashStartY, labelY + 6);

              return {
                  dashStartY,
                  dashEndY,
                  labelY,
                  hasDashedLine: dashEndY < dashStartY
              };
          }
      };

      // Render all signal markers (无背景框，无边框，多在下方，空在上方，虚线指引端保留1~3cm距离)
      signalsToShow.forEach((sig, idx) => {
          const signalIdx = sig.signalIdx ?? -1;
          if (signalIdx === -1 || signalIdx < startIndex || signalIdx >= startIndex + visibleCount) return;

          const i = signalIdx - startIndex;
          const d = fullData[signalIdx];
          if (!d) return;

          const x = getX(i) + candleWidth / 2;
          const isLong = sig.type === 'LONG';
          const isFocal = signalIdx === focalIdx;
          const guideColor = isLong ? '#0ECB81' : '#F6465D';
          const layout = getMarkerLayout(signalIdx, isLong ? 'LONG' : 'SHORT', d);

          if (isFocal) {
              const badgeText = isLong ? '做多信号K线' : '做空信号K线';

              signalMarkers.push(
                  <g key={`sig-focal-anchor-${idx}`} pointerEvents="none">
                      {/* 纵向指引虚线 (靠近K线的一端保留1~3cm距离) */}
                      {layout.hasDashedLine && (
                          <line 
                              x1={x} 
                              y1={layout.dashStartY} 
                              x2={x} 
                              y2={layout.dashEndY} 
                              stroke={guideColor} 
                              strokeWidth={1.5} 
                              strokeDasharray="4 2" 
                              opacity={0.85} 
                          />
                      )}
                      {/* 指引小三角 */}
                      {isLong ? (
                          <polygon 
                              points={`${x},${layout.dashStartY - 3} ${x - 3.5},${layout.dashStartY + 3} ${x + 3.5},${layout.dashStartY + 3}`} 
                              fill={guideColor} 
                          />
                      ) : (
                          <polygon 
                              points={`${x},${layout.dashStartY + 3} ${x - 3.5},${layout.dashStartY - 3} ${x + 3.5},${layout.dashStartY - 3}`} 
                              fill={guideColor} 
                          />
                      )}
                      {/* 纯文字标记 (无背景、无边框) */}
                      <text 
                          x={x} 
                          y={isLong ? layout.labelY + 2 : layout.labelY - 2} 
                          fill={guideColor} 
                          fontSize="10.5" 
                          fontWeight="bold" 
                          textAnchor="middle" 
                          fontFamily="monospace"
                      >
                          {badgeText}
                      </text>
                  </g>
              );
          } else {
              // 历史非焦点信号 (无背景、无边框，多在下方，空在上方)
              signalMarkers.push(
                  <g key={`sig-historical-${idx}`} pointerEvents="none">
                      {layout.hasDashedLine && (
                          <line 
                              x1={x} 
                              y1={layout.dashStartY} 
                              x2={x} 
                              y2={layout.dashEndY} 
                              stroke={guideColor} 
                              strokeWidth={1.2} 
                              strokeDasharray="3 2" 
                              opacity={0.65} 
                          />
                      )}
                      {isLong ? (
                          <polygon 
                              points={`${x},${layout.dashStartY - 2} ${x - 3},${layout.dashStartY + 3} ${x + 3},${layout.dashStartY + 3}`} 
                              fill={guideColor} 
                              opacity={0.8}
                          />
                      ) : (
                          <polygon 
                              points={`${x},${layout.dashStartY + 2} ${x - 3},${layout.dashStartY - 3} ${x + 3},${layout.dashStartY - 3}`} 
                              fill={guideColor} 
                              opacity={0.8}
                          />
                      )}
                      <text 
                          x={x} 
                          y={isLong ? layout.labelY + 2 : layout.labelY - 2} 
                          fill={guideColor} 
                          fontSize="9.5" 
                          textAnchor="middle" 
                          fontWeight="bold" 
                          fontFamily="monospace"
                      >
                          {isLong ? '▲ 多' : '▼ 空'}
                      </text>
                  </g>
              );
          }
      });

      // Render the Stepped Orthogonal Lines for 进攻突破线 & 中轴防守线
      // Layout faithfully matches the user's diagram:
      // - Dashed lines start shifted 2 candles to the right (不接触信号K线)
      // - Upper line extends horizontally, then turns UPWARDS with vertical dashed line and 2-row label above
      // - Lower line extends horizontally, then turns DOWNWARDS with vertical dashed line and 2-row label below
      // - Labels stacked vertically directly without border/background: Line 1 Title, Line 2 Price & Ratio
      let focalLinesVisual: React.ReactNode = null;
      if (focalBreakoutPrice !== null && focalDefensePrice !== null) {
          const yBreakout = getY(focalBreakoutPrice);
          const yDefense = getY(focalDefensePrice);
          const xStart = focalX !== null ? focalX : 0;
          const xEnd = width - padding.right;

          // Colors
          const breakoutColor = focalIsLong ? '#10B981' : '#F43F5E';
          const defenseColor = '#F59E0B';

          if (!isNaN(yBreakout) && !isNaN(yDefense)) {
              // Stepped branch X position:
              // 1. Start point is shifted 2 candles to the right from the signal candle (不接触信号K线)
              const candleStep = (width - padding.right) / (effectiveCount || 1);
              const shift2Candles = candleStep * 2;
              const xLineStart = focalX !== null ? Math.min(xEnd - 50, focalX + shift2Candles) : 0;

              // Stepped branch turn position:
              const branchDist = Math.max(80, Math.min(180, candleWidth * 7));
              const xTurn = Math.min(xEnd - 75, Math.max(xLineStart + 45, xLineStart + branchDist));

              // Vertical offsets: Breakout turns UP (or DOWN if short), Defense turns DOWN (or UP if short)
              const vOffset = 42;
              
              const yBreakoutVertical = focalIsLong 
                  ? Math.max(padding.top + 36, yBreakout - vOffset) 
                  : Math.min(chartHeight - 36, yBreakout + vOffset);

              const yDefenseVertical = focalIsLong 
                  ? Math.min(chartHeight - 36, yDefense + vOffset) 
                  : Math.max(padding.top + 36, yDefense - vOffset);

              const breakoutTitle = `${focalIsLong ? '多' : '空'}进攻突破线`;
              const breakoutValue = `${formatPrice(focalBreakoutPrice)} (${focalIsLong ? '+' : '-'}${focalBreakoutPct}%)`;

              const defenseTitle = '中轴防守线';
              const defenseValue = `${formatPrice(focalDefensePrice)} (${focalMidlinePct}%)`;

              focalLinesVisual = (
                  <g key="focal-defense-breakout-stepped-group" pointerEvents="none">
                      {/* --- 1. 进攻突破线 (Breakout Line) --- */}
                      {/* Horizontal dashed line: starts 2 candles to the right of signal candle (does NOT touch signal K-line) */}
                      <line 
                          x1={xLineStart} 
                          y1={yBreakout} 
                          x2={xTurn} 
                          y2={yBreakout} 
                          stroke={breakoutColor} 
                          strokeWidth={1.8} 
                          strokeDasharray="5 3" 
                          opacity={0.95} 
                      />
                      {/* Faint continuation across to right edge for reference */}
                      <line 
                          x1={xTurn} 
                          y1={yBreakout} 
                          x2={xEnd} 
                          y2={yBreakout} 
                          stroke={breakoutColor} 
                          strokeWidth={1} 
                          strokeDasharray="2 3" 
                          opacity={0.25} 
                      />
                      {/* Corner joint anchor */}
                      <circle cx={xTurn} cy={yBreakout} r={3} fill={breakoutColor} />
                      {/* Vertical line branching UP (for Long) or DOWN (for Short) */}
                      <line 
                          x1={xTurn} 
                          y1={yBreakout} 
                          x2={xTurn} 
                          y2={yBreakoutVertical} 
                          stroke={breakoutColor} 
                          strokeWidth={1.8} 
                          strokeDasharray="4 2" 
                          opacity={0.95} 
                      />
                      {/* Breakout Label: Stacked vertically without border/background */}
                      <g transform={`translate(${xTurn}, ${yBreakoutVertical})`}>
                          {/* Line 1: Title */}
                          <text 
                              x={0} 
                              y={focalIsLong ? -18 : 13} 
                              fill={breakoutColor} 
                              fontSize="10.5" 
                              fontWeight="bold" 
                              textAnchor="middle" 
                          >
                              {breakoutTitle}
                          </text>
                          {/* Line 2: Price & Pct */}
                          <text 
                              x={0} 
                              y={focalIsLong ? -5 : 26} 
                              fill={breakoutColor} 
                              fontSize="10" 
                              fontWeight="bold" 
                              textAnchor="middle" 
                              fontFamily="monospace"
                          >
                              {breakoutValue}
                          </text>
                      </g>

                      {/* --- 2. 中轴防守线 (Defense Line) --- */}
                      {/* Horizontal dashed line: starts 2 candles to the right of signal candle (does NOT touch signal K-line) */}
                      <line 
                          x1={xLineStart} 
                          y1={yDefense} 
                          x2={xTurn} 
                          y2={yDefense} 
                          stroke={defenseColor} 
                          strokeWidth={1.8} 
                          strokeDasharray="5 3" 
                          opacity={0.95} 
                      />
                      {/* Faint continuation across to right edge for reference */}
                      <line 
                          x1={xTurn} 
                          y1={yDefense} 
                          x2={xEnd} 
                          y2={yDefense} 
                          stroke={defenseColor} 
                          strokeWidth={1} 
                          strokeDasharray="2 3" 
                          opacity={0.25} 
                      />
                      {/* Corner joint anchor */}
                      <circle cx={xTurn} cy={yDefense} r={3} fill={defenseColor} />
                      {/* Vertical line branching DOWN (for Long) or UP (for Short) */}
                      <line 
                          x1={xTurn} 
                          y1={yDefense} 
                          x2={xTurn} 
                          y2={yDefenseVertical} 
                          stroke={defenseColor} 
                          strokeWidth={1.8} 
                          strokeDasharray="4 2" 
                          opacity={0.95} 
                      />
                      {/* Defense Label: Stacked vertically without border/background */}
                      <g transform={`translate(${xTurn}, ${yDefenseVertical})`}>
                          {/* Line 1: Title */}
                          <text 
                              x={0} 
                              y={focalIsLong ? 13 : -18} 
                              fill={defenseColor} 
                              fontSize="10.5" 
                              fontWeight="bold" 
                              textAnchor="middle" 
                          >
                              {defenseTitle}
                          </text>
                          {/* Line 2: Price & Pct */}
                          <text 
                              x={0} 
                              y={focalIsLong ? 26 : -5} 
                              fill={defenseColor} 
                              fontSize="10" 
                              fontWeight="bold" 
                              textAnchor="middle" 
                              fontFamily="monospace"
                          >
                              {defenseValue}
                          </text>
                      </g>
                  </g>
              );
          }
      }

      // List 2 Divergence (发散) Visual Markers - ONLY rendered on the 1st candle of each divergence onset
      const divergenceVisuals: React.ReactNode[] = [];
      if (showDivergenceMarkers && divergenceMarkers.length > 0) {
          divergenceMarkers.forEach((m) => {
              if (m.index >= startIndex && m.index < startIndex + visibleCount) {
                  const i = m.index - startIndex;
                  const x = getX(i) + candleWidth / 2;
                  const d = fullData[m.index];
                  if (!d) return;

                  const isLong = m.direction === 'LONG';
                  const layout = getMarkerLayout(m.index, isLong ? 'LONG' : 'SHORT', d);
                  const color = isLong ? '#10B981' : '#F43F5E';
                  const textLabel = isLong ? '▲ 多发散' : '▼ 空发散';

                  divergenceVisuals.push(
                      <g key={`div-start-${isLong ? 'long' : 'short'}-${m.index}`} pointerEvents="none">
                          {/* 纵向指引虚线 (靠近K线的一端保留1~3cm距离) */}
                          {layout.hasDashedLine && (
                              <line 
                                  x1={x} 
                                  y1={layout.dashStartY} 
                                  x2={x} 
                                  y2={layout.dashEndY} 
                                  stroke={color} 
                                  strokeWidth={1.2} 
                                  strokeDasharray="3 2" 
                                  opacity={0.75} 
                              />
                          )}
                          {/* 指引小三角 */}
                          {isLong ? (
                              <polygon 
                                  points={`${x},${layout.dashStartY - 3} ${x - 3.5},${layout.dashStartY + 3} ${x + 3.5},${layout.dashStartY + 3}`} 
                                  fill={color} 
                              />
                          ) : (
                              <polygon 
                                  points={`${x},${layout.dashStartY + 3} ${x - 3.5},${layout.dashStartY - 3} ${x + 3.5},${layout.dashStartY - 3}`} 
                                  fill={color} 
                              />
                          )}
                          {/* 纯文字标记 (无背景、无边框) */}
                          <text 
                              x={x} 
                              y={isLong ? layout.labelY + 2 : layout.labelY - 2} 
                              fill={color} 
                              fontSize="9.5" 
                              fontWeight="bold" 
                              textAnchor="middle" 
                              fontFamily="monospace"
                          >
                              {textLabel}
                          </text>
                      </g>
                  );
              }
          });
      }

      // Render Trade Markers (无背景、无边框，多标记在下方，空标记在上方，虚线指引端保留1~3cm距离)
      tradeMarkers.forEach((m, idx) => {
          let mIdx = getCandleIdx(m.time);
          if (mIdx !== -1 && mIdx >= startIndex && mIdx < startIndex + visibleCount) {
              const i = mIdx - startIndex;
              const x = getX(i) + candleWidth / 2;
              const d = fullData[mIdx];
              if (!d) return;

              const price = m.price || d.close;
              const yPrice = getY(price);
              
              let color = '#22d3ee';
              if (m.type === 'OPEN') {
                  color = '#22d3ee'; // cyan
              } else if (m.type === 'PROFIT_CLOSE') {
                  color = '#10b981'; // emerald
              } else if (m.type === 'LOSS_CLOSE') {
                  color = '#ef4444'; // red
              } else if (m.type === 'HEDGE_OPEN') {
                  color = '#c084fc'; // purple
              } else if (m.type === 'HEDGE_CUT') {
                  color = '#fb923c'; // orange
              } else if (m.type === 'HEDGE_REFILL') {
                  color = '#60a5fa'; // blue
              } else if (m.type === 'HEDGE_CLEAR') {
                  color = '#34d399'; // teal
              } else if (m.type === 'HEDGE_CLOSE') {
                  color = '#c084fc'; // purple
              } else if (m.type === 'CLOSE') {
                  color = '#fbbf24'; // amber
              } else if (m.type === 'SIGNAL') {
                  color = '#34d399';
              }

              // 判断多空归属：空相关在K线上方，多相关在K线下方
              const isShort = m.label.includes('空') || (m.type === 'LOSS_CLOSE' && m.label.includes('(空)'));
              const layout = getMarkerLayout(mIdx, isShort ? 'SHORT' : 'LONG', d);

              signalMarkers.push(
                  <g key={`trade-${m.type}-${m.time}-${idx}`} pointerEvents="none">
                      {/* 价格锚点 */}
                      <circle cx={x} cy={yPrice} r={3} fill={color} opacity={0.85} />
                      {/* 纵向指引虚线 (靠近K线的一端保留1~3cm距离) */}
                      {layout.hasDashedLine && (
                          <line 
                              x1={x} 
                              y1={layout.dashStartY} 
                              x2={x} 
                              y2={layout.dashEndY} 
                              stroke={color} 
                              strokeWidth={1.2} 
                              strokeDasharray="3 2" 
                              opacity={0.75} 
                          />
                      )}
                      {/* 指引小箭头 */}
                      {isShort ? (
                          <polygon 
                              points={`${x},${layout.dashStartY + 3} ${x - 3},${layout.dashStartY - 2} ${x + 3},${layout.dashStartY - 2}`} 
                              fill={color} 
                          />
                      ) : (
                          <polygon 
                              points={`${x},${layout.dashStartY - 3} ${x - 3},${layout.dashStartY + 2} ${x + 3},${layout.dashStartY + 2}`} 
                              fill={color} 
                          />
                      )}
                      {/* 纯文字标记 (无背景、无边框) */}
                      <text 
                          x={x} 
                          y={isShort ? layout.labelY - (m.price ? 5 : 0) : layout.labelY + (m.price ? 0 : 2)} 
                          fill={color} 
                          fontSize="9.5" 
                          fontWeight="bold" 
                          textAnchor="middle" 
                          fontFamily="monospace"
                      >
                          {m.label}
                      </text>
                      {m.price !== undefined && m.price > 0 && (
                          <text 
                              x={x} 
                              y={isShort ? layout.labelY + 7 : layout.labelY + 12} 
                              fill={color} 
                              fontSize="8.5" 
                              opacity={0.9} 
                              textAnchor="middle" 
                              fontFamily="monospace"
                          >
                              {formatPrice(m.price)}
                          </text>
                      )}
                  </g>
              );
          }
      });

      // Highlight Time Line (L4 Entry)
      let highlightLine = null;
      if (showAuditLines && highlightTime) {
          const hlIdx = getCandleIdxFast(highlightTime, fullData);

          if (hlIdx !== -1 && hlIdx !== focalIdx && hlIdx >= startIndex && hlIdx < startIndex + visibleCount) {
              const i = hlIdx - startIndex;
              const x = getX(i) + candleWidth / 2;
              highlightLine = (
                  <g pointerEvents="none">
                      <line x1={x} y1={padding.top} x2={x} y2={padding.top + 45} stroke="#A855F7" strokeWidth={1.5} strokeDasharray="4 2" opacity={0.8} />
                      <text x={x} y={padding.top + 12} fill="#C084FC" fontSize="9.5" fontWeight="bold" textAnchor="middle" fontFamily="monospace">L4 ENTRY</text>
                  </g>
              );
          }
      }

      // Appeared Line (发生) - 无背景无边框
      let appearedLine = null;
      if (appearedTime) {
          const hlIdx = getCandleIdxFast(appearedTime, fullData);

          if (hlIdx !== -1 && hlIdx >= startIndex && hlIdx < startIndex + visibleCount) {
              const i = hlIdx - startIndex;
              const x = getX(i) + candleWidth / 2;
              appearedLine = (
                  <g pointerEvents="none">
                      <line x1={x} y1={padding.top + 5} x2={x} y2={padding.top + 42} stroke="#0ECB81" strokeWidth={1.2} strokeDasharray="3 3" opacity={0.8} />
                      <text x={x} y={padding.top + 14} fill="#0ECB81" fontSize="9.5" fontWeight="bold" textAnchor="middle" fontFamily="monospace">发生</text>
                  </g>
              );
          }
      }

      // Disappeared Line (消失) - 无背景无边框
      let disappearedLine = null;
      if (disappearedTime) {
          const hlIdx = getCandleIdxFast(disappearedTime, fullData);

          if (hlIdx !== -1 && hlIdx >= startIndex && hlIdx < startIndex + visibleCount) {
              const i = hlIdx - startIndex;
              const x = getX(i) + candleWidth / 2;
              disappearedLine = (
                  <g pointerEvents="none">
                      <line x1={x} y1={padding.top + 5} x2={x} y2={padding.top + 42} stroke="#F6465D" strokeWidth={1.2} strokeDasharray="3 3" opacity={0.8} />
                      <text x={x} y={padding.top + 14} fill="#F6465D" fontSize="9.5" fontWeight="bold" textAnchor="middle" fontFamily="monospace">消失</text>
                  </g>
              );
          }
      }

      // Waiting / Triggered Line (等待 / 已触发 - for active coins in list) - 无背景无边框
      let waitingLine = null;
      if (!disappearedTime && fullData.length > 0) {
          const lastIdx = fullData.length - 1;
          if (lastIdx >= startIndex && lastIdx < startIndex + visibleCount) {
              const i = lastIdx - startIndex;
              const x = getX(i) + candleWidth / 2;
              
              // Check if extraLines indicates a breakout trigger has been reached
              const triggerLine = extraLines?.find(l => l.label.includes('突破') || l.label.includes('Trigger') || l.label.includes('TRIGGER') || l.label.includes('攻'));
              let isTriggeredByChart = false;
              if (triggerLine && triggerLine.price > 0) {
                  const lastCandle = fullData[lastIdx];
                  const isShort = triggerLine.label.includes('空') || signals.some(s => s.type === 'SHORT');
                  // For LONG: high >= trigger; For SHORT: low <= trigger
                  if (isShort) {
                      if (lastCandle.low <= triggerLine.price || lastCandle.close <= triggerLine.price) {
                          isTriggeredByChart = true;
                      }
                  } else {
                      if (lastCandle.high >= triggerLine.price || lastCandle.close >= triggerLine.price) {
                          isTriggeredByChart = true;
                      }
                  }
              }

              const tagText = isTriggeredByChart ? "已触发" : "等待";
              const tagColor = isTriggeredByChart ? "#0ECB81" : "#FACC15";

              waitingLine = (
                  <g pointerEvents="none">
                      <line x1={x} y1={padding.top + 5} x2={x} y2={padding.top + 42} stroke={tagColor} strokeWidth={1.2} strokeDasharray="2 2" opacity={0.8} />
                      <text x={x} y={padding.top + 14} fill={tagColor} fontSize="9.5" fontWeight="bold" textAnchor="middle" fontFamily="monospace">{tagText}</text>
                  </g>
              );
          }
      }

      // Current Price Line
      let currentPriceLine = null;
      if (fullData.length > 0) {
          const lastCandle = fullData[fullData.length - 1];
          const yCurrent = getY(lastCandle.close);
          if (!isNaN(yCurrent)) {
              currentPriceLine = (
                  <g>
                      <line x1={0} y1={yCurrent} x2={width - padding.right} stroke={lastCandle.close >= lastCandle.open ? COLOR_UP : COLOR_DOWN} strokeDasharray="2 2" opacity={0.7} />
                      <rect x={width - 80} y={yCurrent - 10} width={80} height={20} fill={lastCandle.close >= lastCandle.open ? COLOR_UP : COLOR_DOWN} rx={2} />
                      <text x={width - 40} y={yCurrent + 4} fill="black" fontSize="10" fontWeight="bold" textAnchor="middle">{lastCandle.close.toFixed(8)}</text>
                  </g>
              );
          }
      }

      // ENTRY PRICE & TIME VISUALIZATION
      let entryVisuals = null;
      if (entryPrice && entryPrice > 0) {
          const yEntry = getY(entryPrice);
          if (!isNaN(yEntry)) {
              const entryColor = "#22d3ee"; // Cyan-400
              
              let entryX = -1;
              // Find Entry Candle X if visible
              if (entryTime) {
                  const eIdx = getCandleIdxFast(entryTime, fullData);
                  if (eIdx !== -1 && eIdx >= startIndex && eIdx < startIndex + visibleCount) {
                      entryX = getX(eIdx - startIndex) + candleWidth / 2;
                  }
              }

              entryVisuals = (
                  <g pointerEvents="none">
                      {/* Horizontal Line */}
                      <line x1={0} y1={yEntry} x2={width - padding.right} y2={yEntry} stroke={entryColor} strokeWidth={1} strokeDasharray="4 2" opacity={0.8} />
                      
                      {/* Right Axis Label */}
                      <rect x={width - 80} y={yEntry - 9} width={80} height={18} fill={entryColor} rx={2} opacity={0.2} />
                      <text x={width - 76} y={yEntry + 3} fill={entryColor} fontSize="9" fontWeight="bold" fontFamily="monospace">
                          ENTRY: {formatPrice(entryPrice)}
                      </text>

                      {/* Specific Entry Time Marker (if visible) */}
                      {entryX !== -1 && !isNaN(entryX) && (
                          <g>
                              <circle cx={entryX} cy={yEntry} r={4} fill={entryColor} />
                              <circle cx={entryX} cy={yEntry} r={8} stroke={entryColor} strokeWidth={1} fill="none" opacity={0.5} />
                          </g>
                      )}
                  </g>
              );
          }
      }

      // EXTRA LINES (Other custom indicators) - Only show lines not already rendered by focalLinesVisual
      const extraVisuals = showAuditLines ? extraLines?.map((line, idx) => {
          if (!line.price || line.price <= 0) return null;
          // Skip defense/breakout if already rendered by focalLinesVisual
          if (focalLinesVisual && (line.label.includes('防守') || line.label.includes('突破') || line.label.includes('TRIGGER') || line.label.includes('DEFENSE') || line.label.includes('攻') || line.label.includes('守'))) {
              return null;
          }
          const y = getY(line.price);
          if (isNaN(y)) return null;
          const dash = line.style === 'dashed' ? '6 4' : undefined;
          
          return (
              <g key={`extra-${idx}`} pointerEvents="none">
                  <line x1={0} y1={y} x2={width - padding.right} y2={y} stroke={line.color} strokeWidth={1.5} strokeDasharray={dash} opacity={0.9} />
                  <rect x={width - padding.right - 145} y={y - 9} width={145} height={18} fill={line.color} rx={2} opacity={0.15} />
                  <text x={width - padding.right - 141} y={y + 3} fill={line.color} fontSize="9" fontWeight="bold" fontFamily="monospace">
                      {line.label}: {formatPrice(line.price)}
                  </text>
              </g>
          );
      }) : null;

      let crosshair: React.ReactNode = null;
      if (hoverIndex !== null && hoverIndex >= startIndex && hoverIndex < startIndex + visibleCount && mouseY !== null) {
          const i = hoverIndex - startIndex;
          const x = getX(i) + candleWidth / 2;
          const d = fullData[hoverIndex];

          const ratio = (chartHeight - mouseY + padding.top) / (chartHeight - padding.top);
          const price = minPrice + ratio * safePriceRange;
          const timeStr = d ? new Date(d.time).toLocaleTimeString([], {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}) : '';

          crosshair = (
              <g pointerEvents="none">
                  <line x1={0} y1={mouseY} x2={width - padding.right} y2={mouseY} stroke={COLOR_CROSSHAIR} strokeDasharray="3 3" opacity={0.5} />
                  <line x1={x} y1={0} x2={x} y2={height - padding.bottom} stroke={COLOR_CROSSHAIR} strokeDasharray="3 3" opacity={0.5} />
                  <line x1={width - padding.right} y1={mouseY} x2={width} y2={mouseY} stroke={COLOR_CROSSHAIR} strokeDasharray="1 2" opacity={0.3} />
                  <g transform={`translate(${width - padding.right}, ${mouseY})`}>
                      <path d="M 0 0 L 6 -10 L 80 -10 L 80 10 L 6 10 Z" fill="#363A45" />
                      <text x="43" y="4" fill="white" fontSize="10" textAnchor="middle" fontWeight="bold" fontFamily="monospace">
                          {formatPrice(price)}
                      </text>
                  </g>
                  {d && (
                      <g transform={`translate(${x}, ${height - padding.bottom + 2})`}>
                          <rect x="-40" y="0" width="80" height="16" fill="#363A45" rx="2" />
                          <text x="0" y="11" fill="white" fontSize="10" textAnchor="middle" fontWeight="bold" fontFamily="monospace">
                              {timeStr}
                          </text>
                      </g>
                  )}
              </g>
          );
      }

      // Measurement Visuals
      let measurementLines = null;
      if (measureStart) {
          const x1 = measureStart.x;
          const y1 = measureStart.y;
          
          let x2 = x1, y2 = y1;
          if (measureEnd) {
              x2 = measureEnd.x;
              y2 = measureEnd.y;
          } else if (hoverIndex !== null && containerRef.current) {
               // Show live line
               const rect = containerRef.current.getBoundingClientRect();
               // Need to map hoverIndex back to X/Y
               // This is tricky inside renderChart scoped. Let's just use mouse position if available.
          }
          
          if (measureEnd) {
             const price1 = measureStart.price;
             const price2 = measureEnd.price;
             const diff = ((price2 - price1) / price1) * 100;
             const color = diff >= 0 ? COLOR_UP : COLOR_DOWN;
             
             measurementLines = (
                 <g pointerEvents="none">
                     <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={2} />
                     <circle cx={x1} cy={y1} r={4} fill={color} />
                     <circle cx={x2} cy={y2} r={4} fill={color} />
                     <text x={x2} y={y2 + 20} fill={color} fontSize="12" fontWeight="bold" textAnchor="middle">
                         {diff.toFixed(2)}%
                     </text>
                 </g>
             );
          } else {
             measurementLines = (
                 <g pointerEvents="none">
                     <circle cx={x1} cy={y1} r={4} fill="#FACC15" />
                 </g>
             );
          }
      }

      return (
          <svg width="100%" height="100%" className="overflow-visible" onClick={(e) => {
              if (!isMeasuring || !containerRef.current) return;
              const rect = containerRef.current.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const y = e.clientY - rect.top;
              const price = getPriceByY(y);
              
              if (!measureStart) {
                  setMeasureStart({x, y, price, index: 0});
              } else {
                  setMeasureEnd({x, y, price, index: 0});
              }
          }}>
              {yLabels}
              {candles}
              {renderEMA(10, '#FACC15')}
              {renderEMA(20, '#A855F7')}
              {renderEMA(30, '#3B82F6')}
              {renderEMA(40, '#F97316')}
              {renderEMA(80, '#06B6D4')}
              {divergenceVisuals}
              {signalMarkers}
              {focalLinesVisual}
              {highlightLine}
              {appearedLine}
              {disappearedLine}
              {waitingLine}
              {entryVisuals}
              {extraVisuals}
              {measurementLines}
              {currentPriceLine}
              {crosshair}
          </svg>
      );
  };

  const modalContent = (
    <div className={`${disablePortal ? 'relative w-full h-full' : 'fixed inset-0 flex items-center justify-center bg-black/98 backdrop-blur-xl p-2'} `} style={{ zIndex: disablePortal ? 1 : 2147483647 }} onClick={onClose}>
      <div className={`bg-[#161A25] border border-slate-700/50 rounded-lg shadow-2xl flex flex-col ${disablePortal ? 'w-full h-full' : 'w-[95vw] h-[85vh]'} overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.8)]`} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-slate-800 bg-[#1E2329] shrink-0">
           <div className="flex items-center gap-4">
               <div className="flex items-center gap-2">
                   <h2 className="text-lg font-bold text-slate-100">{symbol}</h2>
                    {signalPattern && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border shadow-sm ${signalPattern === "发散" ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40" : signalPattern === "穿越" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" : "bg-indigo-500/20 text-indigo-300 border-indigo-500/40"}`}>
                            🎯 信号源: {signalPattern}
                        </span>
                    )}
                   <button 
                       onClick={() => {
                           setIsMeasuring(!isMeasuring);
                           setMeasureStart(null);
                           setMeasureEnd(null);
                       }} 
                       className={`p-1 rounded ${isMeasuring ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-300'}`}
                       title="测量涨跌幅"
                   >
                       <Ruler size={14} />
                   </button>
                   <button
                       onClick={() => setShowDivergenceMarkers(!showDivergenceMarkers)}
                       className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold transition-all border ${
                           showDivergenceMarkers 
                               ? 'bg-cyan-950/70 border-cyan-500/50 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.2)]' 
                               : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                       }`}
                       title="在K线图上标记列表2多/空发散形态的第1根K线（多在下方，空在上方）"
                   >
                       <Zap size={11} className={showDivergenceMarkers ? 'text-cyan-400 fill-cyan-400' : 'text-slate-500'} />
                       <span>首根发散: {showDivergenceMarkers ? '开启' : '关闭'}</span>
                       {showDivergenceMarkers && (
                           <span className="flex items-center gap-1 ml-0.5 text-[9px] font-mono">
                               <span className="text-emerald-400">多{bullishDivergenceCount}</span>
                               <span className="text-slate-500">/</span>
                               <span className="text-rose-400">空{bearishDivergenceCount}</span>
                           </span>
                       )}
                   </button>
                   <span className="text-[10px] text-slate-400 bg-slate-800 px-1 rounded">永续合约</span>
                   <span className={`text-[9px] px-2 py-0.5 rounded border flex items-center gap-1 transition-colors ${lastUpdated > Date.now() - 5000 ? 'bg-emerald-900/30 border-emerald-500/30 text-emerald-400' : 'bg-slate-800 border-slate-600 text-slate-500'}`}>
                       <Activity size={10} className={lastUpdated > Date.now() - 5000 ? 'animate-pulse' : ''}/>
                       {lastUpdated > Date.now() - 5000 ? '实时数据' : '连接中...'}
                   </span>
               </div>
               <div className="h-4 w-px bg-slate-700"></div>
               <div className="flex gap-1">
                   {TIMEFRAMES.map(tf => {
                       const isTriggered = highlightTf === tf;
                       return (
                           <button 
                               key={tf} 
                               onClick={() => {
                                   setTimeframe(tf);
                                   if (onTimeframeChange) onTimeframeChange(tf);
                               }} 
                               className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all relative ${
                                   timeframe === tf 
                                       ? 'bg-slate-700 text-white shadow-sm ring-1 ring-slate-600' 
                                       : isTriggered 
                                           ? 'text-indigo-400 bg-indigo-500/10' 
                                           : 'text-slate-500 hover:text-slate-300'
                               }`}
                           >
                               {tf}
                               {isTriggered && (
                                   <span className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse shadow-[0_0_5px_rgba(99,102,241,0.5)]" title="规则触发周期" />
                               )}
                           </button>
                       );
                   })}
               </div>
           </div>
           <div className="flex items-center gap-3">
               {!isAutoScroll && (
                   <button 
                       onClick={handleResetToLatest}
                       className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded text-[10px] font-bold transition-colors animate-pulse"
                   >
                       <ArrowRight size={10} /> 回到最新
                   </button>
               )}
               <button 
                   onClick={() => { setFullData([]); setStartIndex(0); setError(null); setLoading(true); }}
                   className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-white px-2 py-1 rounded text-[10px] font-bold transition-colors"
               >
                   <RefreshCw size={10} /> 刷新
               </button>
               <button 
    onClick={() => (window as any).setManualSymbol(symbol)}
    className="flex items-center gap-1 bg-amber-600 hover:bg-amber-500 text-white px-2 py-1 rounded text-[10px] font-bold transition-colors mr-2"
    title="币名转移到手动开仓"
>
    <ArrowRight size={10} /> 币名转移
</button>
<button onClick={() => { onClose(); }} className="p-1.5 hover:bg-slate-700 rounded text-slate-400 hover:text-white"><X size={18} /></button>
           </div>
        </div>

        {/* Chart Area */}
        <div 
            ref={containerRef} 
            className={`flex-1 relative w-full h-full select-none touch-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'} ${loading ? 'opacity-70 pointer-events-none' : ''}`} 
            onMouseDown={handleMouseDown} 
            onMouseMove={handleMouseMove} 
            onMouseUp={handleMouseUp} 
            onMouseLeave={() => { handleMouseUp(); setHoverIndex(null); setMouseY(null); }} 
            onWheel={handleWheel}
        >
            {/* Top Center Statistics Overlay */}
            {dailyStats && !error && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-[#1e2329]/95 border border-slate-700/50 px-3 py-1.5 rounded-lg shadow-xl text-[10px] font-mono text-slate-300 pointer-events-auto select-text max-w-[90vw]">
                    <div className="flex items-center gap-1 whitespace-nowrap">
                        <span className="text-slate-500 font-semibold">回测周期:</span>
                        <span className="text-yellow-400 font-bold">{dailyStats.lookbackDays}天</span>
                    </div>
                    <div className="h-3 w-px bg-slate-800"></div>
                    <div className="flex items-center gap-1 whitespace-nowrap">
                        <span className="text-slate-500 font-semibold">历史实际跌幅:</span>
                        <span className="text-rose-400 font-bold">{(dailyStats.maxDrop ?? 0).toFixed(2)}%</span>
                    </div>
                    <div className="h-3 w-px bg-slate-800"></div>
                    <div className="flex items-center gap-1 whitespace-nowrap">
                        <span className="text-slate-500 font-semibold">历史实际涨幅:</span>
                        <span className="text-emerald-400 font-bold">{(dailyStats.maxPump ?? 0).toFixed(2)}%</span>
                    </div>
                    <div className="h-3 w-px bg-slate-800"></div>
                    <div className="flex items-center gap-1 whitespace-nowrap">
                        <span className="text-slate-500 font-semibold">实际极值涨跌:</span>
                        <span className="text-emerald-500 font-bold">+{(dailyStats.extremeRise ?? 0).toFixed(2)}%</span>
                        <span className="text-slate-600">/</span>
                        <span className="text-rose-500 font-bold">-{(dailyStats.extremeDrop ?? 0).toFixed(2)}%</span>
                    </div>
                    <div className="h-3 w-px bg-slate-800"></div>
                    <div className="flex items-center gap-1 whitespace-nowrap">
                        <span className="text-slate-500 font-semibold">横盘内涨跌:</span>
                        <span className={`font-bold ${(dailyStats.sidewaysRise ?? 0) > 0 ? 'text-emerald-400' : 'text-slate-400'}`}>+{(dailyStats.sidewaysRise ?? 0).toFixed(2)}%</span>
                        <span className="text-slate-600">/</span>
                        <span className={`font-bold ${(dailyStats.sidewaysDrop ?? 0) > 0 ? 'text-rose-400' : 'text-slate-400'}`}>-{(dailyStats.sidewaysDrop ?? 0).toFixed(2)}%</span>
                    </div>
                    <div className="h-3 w-px bg-slate-800"></div>
                    <div className="flex items-center gap-1 whitespace-nowrap">
                        <span className="text-slate-500 font-semibold">EMA80偏离度:</span>
                        <span className={`font-bold ${(dailyStats.ema80Dev ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {(dailyStats.ema80Dev ?? 0) >= 0 ? '+' : ''}{(dailyStats.ema80Dev ?? 0).toFixed(2)}%
                        </span>
                    </div>
                    <div className="h-3 w-px bg-slate-800"></div>
                    <div className="flex items-center gap-1 whitespace-nowrap">
                        <span className="text-slate-500 font-semibold">今日量能比:</span>
                        <span className={`font-bold ${(dailyStats.volRatio ?? 0) >= 1.5 ? 'text-yellow-400 animate-pulse' : 'text-sky-400'}`}>
                            {(dailyStats.volRatio ?? 0).toFixed(2)}x
                        </span>
                    </div>
                </div>
            )}

            {loading && !error && fullData.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-[#161A25]/90">
                    <Loader2 size={32} className="animate-spin text-[#FCD535] mb-2" />
                    <span className="text-xs text-slate-400">正在连接节点加载数据...</span>
                </div>
            )}
            
            {loading && !error && fullData.length > 0 && (
                <div className="absolute top-4 right-4 flex items-center gap-2 z-20 bg-slate-800/80 px-3 py-1.5 rounded-full border border-slate-700 shadow-lg backdrop-blur-sm">
                    <Loader2 size={14} className="animate-spin text-[#FCD535]" />
                    <span className="text-[10px] font-bold text-slate-300">切换周期中...</span>
                </div>
            )}
            
            {!loading && !error && fullData.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center z-20 text-slate-500">
                    <BarChart2 size={40} className="mb-2 opacity-50" />
                    <span className="text-xs font-bold">暂无 K 线数据</span>
                    <span className="text-[10px] mt-1">请尝试切换周期或刷新</span>
                </div>
            )}
            
            {error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-[#161A25]/95 p-6 overflow-y-auto">
                    <AlertTriangle size={36} className="text-amber-500 mb-3 animate-bounce" />
                    <span className="text-sm font-bold text-slate-100 mb-2">{error}</span>
                    
                    <div className="max-w-md bg-slate-800/60 p-4 rounded-lg border border-slate-700/50 text-[11px] text-slate-300 space-y-2.5 mb-4 text-left leading-relaxed">
                        <p className="font-bold text-amber-400 border-b border-slate-700 pb-1.5 flex items-center gap-1.5">
                            🌐 为什么价格正常，而K线无法加载？
                        </p>
                        <p>
                            • <b className="text-white">实时价格：</b>使用浏览器直接订阅 Binance WebSockets 长连接，不设跨域约束且直连，因此变动完美流畅。<br />
                            • <b className="text-white">K线图：</b>使用 HTTP REST 接口拉取历史数据。因 Binance API 限制浏览器直接跨域（CORS），必须经由服务器中转。系统托管节点由于地理 IP（US / Japan 等云提供商网段）常被币安严厉封锁，导致中转失效。
                        </p>
                        <p className="font-bold text-yellow-400 mt-2">💡 救世方案 A（100% 成功且速度最快 - 推荐）：</p>
                        <ol className="list-decimal list-inside space-y-1 pl-1 text-slate-200">
                            <li>在系统模块设置中，开启 <span className="text-yellow-400 font-mono font-bold">直连模式 (Direct Mode)</span>。</li>
                            <li>确保您的 VPN 节点畅通（推荐香港、新加坡等非美非日限制区）。</li>
                            <li>
                                浏览器安装任一免费跨域解除插件，例如：<br />
                                <span className="text-indigo-400 font-semibold italic">Allow CORS: Access-Control-Allow-Origin</span> 或 <span className="text-indigo-400 font-semibold italic">CORS Unblock</span>。
                            </li>
                        </ol>
                        <p className="text-slate-400 text-[10px] italic">
                            配置好跨域插件后，K线请求将完全绕过云端，直接通过您的浏览器代理高速获取，彻底告别卡顿或加载失败！
                        </p>
                    </div>

                    <div className="flex gap-3">
                        <button 
                            onClick={() => { setError(null); setLoading(true); setRetryCount(c => c + 1); }} 
                            className="px-5 py-1.5 bg-yellow-600 hover:bg-yellow-500 text-white rounded text-[11px] font-bold transition-all shadow shadow-yellow-600/25"
                        >
                            重试连接 (Retry)
                        </button>
                    </div>
                </div>
            )}

            {/* Hover Info */}
            {infoData && !loading && !error && (
                <div className="absolute top-4 left-4 z-10 text-[11px] font-mono bg-[#1E2329]/90 p-3 rounded border border-slate-700 shadow-lg pointer-events-none transition-opacity duration-200">
                    <div className="flex gap-4 mb-2">
                        <span className={`font-bold ${infoData.kline.close >= infoData.kline.open ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>O: {infoData.kline.open.toFixed(8)}</span>
                        <span className={`font-bold ${infoData.kline.close >= infoData.kline.open ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>H: {infoData.kline.high.toFixed(8)}</span>
                        <span className={`font-bold ${infoData.kline.close >= infoData.kline.open ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>L: {infoData.kline.low.toFixed(8)}</span>
                        <span className={`font-bold ${infoData.kline.close >= infoData.kline.open ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>C: {infoData.kline.close.toFixed(8)}</span>
                    </div>
                    <div className="flex gap-3 text-[10px] opacity-80">
                        <span className="text-[#FACC15]">EMA10: {infoData.ema10?.toFixed(8) || '-'}</span>
                        <span className="text-[#A855F7]">EMA20: {infoData.ema20?.toFixed(8) || '-'}</span>
                        <span className="text-[#3B82F6]">EMA30: {infoData.ema30?.toFixed(8) || '-'}</span>
                        <span className="text-[#F97316]">EMA40: {infoData.ema40?.toFixed(8) || '-'}</span>
                        <span className="text-[#06B6D4]">EMA80: {infoData.ema80?.toFixed(8) || '-'}</span>
                    </div>
                    {infoData.divergenceStatus && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                            {infoData.divergenceStatus === 'LONG' ? (
                                <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-500/50 flex items-center gap-1">
                                    <span>▲</span> 列表2多头发散 (10 &gt; 20 &gt; 30 &gt; 40)
                                </span>
                            ) : (
                                <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-rose-950/80 text-rose-400 border border-rose-500/50 flex items-center gap-1">
                                    <span>▼</span> 列表2空头发散 (10 &lt; 20 &lt; 30 &lt; 40)
                                </span>
                            )}
                        </div>
                    )}
                    <div className="mt-2 text-[9px] text-slate-500">时间: {new Date(infoData.kline.time).toLocaleString()} | 量: {infoData.kline.volume.toFixed(2)} | 振幅: {infoData.amplitude.toFixed(2)}%</div>
                </div>
            )}
            
            {!loading && !error && renderChart()}
        </div>
      </div>
    </div>
  );

  if (disablePortal) return modalContent;
  return createPortal(modalContent, document.body);
};

export default KlineChartModal;
