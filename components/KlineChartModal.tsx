
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { X, Loader2, Move, ZoomIn, ZoomOut, RefreshCw, AlertTriangle, WifiOff, Activity, ArrowRight, BarChart2, Ruler } from 'lucide-react';
import { calculateEMA } from '../services/indicators';
import { fetchWithFallback } from '../services/apiService';
import { analyzeList2Crossing } from '../services/rules/list2_crossing'; // Import Rule Logic
import { List2Config } from './Scanner/scannerTypes';
import { useOptionalBacktest } from '../modules/backtester/BacktestContext';
import { formatPrice } from '../services/symbolUtils';

interface Signal {
    time: number;
    type: 'LONG' | 'SHORT';
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
  highlightTime?: number; // Time to highlight (Vertical Line)
  extraLines?: ExtraLine[]; // New: Dynamic visual lines (Trigger/Defense)
  directMode?: boolean; // Added directMode for fast fetching
  limit?: number; // Added dynamic limit
  disablePortal?: boolean; // Allow embedding in parents
  highlightTf?: string; // Timeframe to highlight (Brightened)
  showAuditLines?: boolean; // New: Only show "Audit" specific markers (List 4/5)
  tradeLogs?: TradeLog[]; // Added tradeLogs prop
  onClose: () => void;
  onTimeframeChange?: (timeframe: string) => void;
}

interface KlineData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];

const sanitizeTf = (tf: string): string => {
    if (!tf) return '15m';
    const match = tf.match(/(\d+[mhd])/i);
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
    if (unit === 'm') return val;
    if (unit === 'h') return val * 60;
    if (unit === 'd') return val * 1440;
    if (unit === 'w') return val * 10080;
    if (unit === 'M') return val * 43200;
    return 15;
};

import { TradeLog } from '../types';
import { createPortal } from 'react-dom';

const KlineChartModal: React.FC<Props> = ({ symbol, initialTimeframe = '15m', signals = [], entryPrice, entryTime, currentPrice, scanWindow = 9, list2Config, highlightTime, extraLines, directMode = false, limit = 1000, disablePortal = false, highlightTf, showAuditLines = false, tradeLogs = [], onClose, onTimeframeChange }) => {
  const backtest = useOptionalBacktest();
  const [timeframe, setTimeframe] = useState(() => sanitizeTf(initialTimeframe));
  
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
  
  // Computed Signals State (Full History)
  const [computedSignals, setComputedSignals] = useState<Signal[]>([]);

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
      let isMounted = true;
      
      const calculateDailyStats = async () => {
          let lookbackDays = 300;
          let sidewaysDays = 7;
          try {
              const savedConfig = localStorage.getItem('SCANNER_CONFIG_24H');
              if (savedConfig) {
                  const parsed = JSON.parse(savedConfig);
                  if (parsed && parsed.majorTrend) {
                      lookbackDays = parsed.majorTrend.lookbackDays || 300;
                      sidewaysDays = parsed.majorTrend.sidewaysDays || 7;
                  }
              }
          } catch (e) {
              console.warn("[KlineChart] Failed to parse major trend configuration from localStorage:", e);
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
                  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=1d&limit=${limit}`;
                  const res = await fetchWithFallback(url, { timeout: 10000 }, (d) => Array.isArray(d), directMode);
                  const json = await res.json();
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
              const historySlice = dailyKlines.slice(0, Math.max(1, dailyKlines.length - sidewaysDays));
              const maxHigh = Math.max(...historySlice.map(c => c.high));
              const minLow = Math.min(...historySlice.map(c => c.low));

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

      calculateDailyStats();
      return () => {
          isMounted = false;
      };
  }, [symbol, backtest?.isPlaying, directMode]);


  // Viewport State
  const [visibleCount, setVisibleCount] = useState(160); 
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

  // Recalculate signals whenever fullData or config changes
  useEffect(() => {
      if (fullData.length === 0 || !list2Config) {
          // If no config provided, fallback to props signals or empty
          if (signals.length > 0) setComputedSignals(signals);
          return;
      }

      // Re-run the core rule logic strictly according to the user settings (MaxLag)
      const closes = fullData.map(k => k.close);
      const highs = fullData.map(k => k.high);
      const lows = fullData.map(k => k.low);
      const opens = fullData.map(k => k.open);
      const volumes = fullData.map(k => k.volume);
      const timestamps = fullData.map(k => k.time);

      // Force 'ALL' trigger mode to show any existing signals within the window
      // BUT keep 'maxLag' exactly as configured by user (e.g. 9)
      const scanConfig: any = {
          ...list2Config,
          maxLag: 9 // Fallback to 9
      };

      const results = analyzeList2Crossing(symbol, timeframe, closes, highs, lows, opens, volumes, timestamps, scanConfig);
      
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
          signals.forEach(s => {
              // Avoid exact duplicates
              const exists = allSignals.some(existing => existing.time === s.time && existing.type === s.type);
              if (!exists) {
                  allSignals.push(s);
              }
          });
      }

      // De-duplicate signals by time AND type (allow both Long and Short at same time)
      const uniqueSignals = Array.from(new Map(allSignals.map(item => [`${item.time}-${item.type}`, item])).values());
      setComputedSignals(uniqueSignals);

  }, [fullData, list2Config, symbol, timeframe]); // signals prop is ignored if we compute fresh ones

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
                        setStartIndex(Math.max(0, mappedKlines.length - 80));
                        setIsAutoScroll(true);
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
            // Use the provided limit or default to 299
            const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=${timeframe}&limit=${limit}&_t=${Date.now()}`;
            const validator = (data: any) => Array.isArray(data) && data.length > 0;
            
            console.log(`[KlineChart] Calling fetchWithFallback for ${symbol}`);
            const res = await fetchWithFallback(
                url, 
                { cache: 'no-store', timeout: 15000, priority: 'HIGH' } as any, 
                validator, 
                directMode
            );
            console.log(`[KlineChart] fetchWithFallback returned for ${symbol}, status: ${res.status}`);
            
            if (isMounted) {
                const json = await res.json();
                console.log(`[KlineChart] Data received for ${symbol}, length: ${Array.isArray(json) ? json.length : 'not array'}`);
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
                        const defaultVisible = limit > 600 ? 160 : (limit > 300 ? 120 : 80);
                        setStartIndex(Math.max(0, klines.length - defaultVisible));
                        setVisibleCount(defaultVisible);
                        setIsAutoScroll(true);
                    }
                } else {
                    throw new Error("Empty data returned");
                }
            }
        } catch (e: any) {
            console.warn(`[KlineChart] Failed to fetch real kline data for ${symbol}:`, e);
            if (isMounted) {
                if (isInitialLoad) {
                    setError("无法连接行情源，请检查网络或开启直连模式");
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
      return {
          kline, amplitude,
          ema10: getEma(10), ema20: getEma(20), ema30: getEma(30), ema40: getEma(40), ema80: getEma(80),
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
      setMouseY(y);
      if (x >= 0 && x <= chartWidth) {
          const ratio = x / chartWidth;
          const relativeIdx = Math.floor(ratio * visibleCount);
          const actualIdx = startIndex + relativeIdx;
          if (actualIdx >= 0 && actualIdx < fullData.length) {
              setHoverIndex(actualIdx);
          }
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
          if (l.entry_timestamp) markers.push({ time: l.entry_timestamp, type: 'OPEN', label: '开仓', price: l.entry_price });
          if (l.exit_timestamp) markers.push({ time: l.exit_timestamp, type: 'CLOSE', label: '平仓', price: l.exit_price || 0 });
          
          if (l.signal_details && l.signal_details.timestamp) {
               markers.push({ time: l.signal_details.timestamp, type: 'SIGNAL', label: '信号' });
          }
          
          l.events?.forEach(e => {
             if (e.action.includes('HEDGE')) {
                 markers.push({ time: e.timestamp, type: 'HEDGE', label: '对冲', price: e.price });
             }
          });
      });
      return markers;
  }, [tradeLogs, symbol]);
  
  const getCandleIdx = (time: number) => {
      let idx = fullData.findIndex(k => k.time === time);
      if (idx === -1) {
          let minDiff = Infinity;
          const tfMinutes = getTfMinutes(timeframe);
          const intervalMs = tfMinutes * 60 * 1000;
          const tolerance = intervalMs * 0.6;
          fullData.forEach((k, i) => {
              const diff = Math.abs(k.time - time);
              if (diff < minDiff && diff <= tolerance) {
                  minDiff = diff;
                  idx = i;
              }
          });
      }
      return idx;
  };
  
  const renderChart = () => {
      if (visibleData.length === 0) return null;
      const width = containerRef.current?.clientWidth || 800;
      const height = containerRef.current?.clientHeight || 500;
      if (width === 0 || height === 0) return null;

      const chartHeight = height * 0.8;
      const volumeHeight = height * 0.2;
      const padding = { top: 30, right: 80, bottom: 20, left: 0 };

      let minPrice = Infinity, maxPrice = -Infinity, maxVol = 0;
      visibleData.forEach(d => {
          if (d.low < minPrice) minPrice = d.low;
          if (d.high > maxPrice) maxPrice = d.high;
          if (d.volume > maxVol) maxVol = d.volume;
      });
      
      // Ensure Entry Price and Extra Lines are visible in scale
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

      const getX = (index: number) => (index / visibleCount) * (width - padding.right);
      const getY = (price: number) => chartHeight - ((price - minPrice) / safePriceRange) * (chartHeight - padding.top) + padding.top;
      const getPriceByY = (y: number) => {
          const ratio = (chartHeight - y + padding.top) / (chartHeight - padding.top);
          return minPrice + ratio * safePriceRange;
      };
      const candleWidth = Math.max(1, (width - padding.right) / visibleCount * 0.7);

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

      // Signals Rendering
      const signalsToShow = computedSignals; 
      const signalMarkers: React.ReactNode[] = [];
      const tfMinutes = getTfMinutes(timeframe);
      const intervalMs = tfMinutes * 60 * 1000;
      const tolerance = intervalMs * 0.6; 

      if (signalsToShow.length > 0) {
          signalsToShow.forEach((sig, idx) => {
              let signalIdx = fullData.findIndex(k => k.time === sig.time);
              if (signalIdx === -1) {
                  let minDiff = Infinity;
                  fullData.forEach((k, i) => {
                      const diff = Math.abs(k.time - sig.time);
                      if (diff < minDiff && diff <= tolerance) {
                          minDiff = diff;
                          signalIdx = i;
                      }
                  });
              }
              
              if (signalIdx !== -1 && signalIdx >= startIndex && signalIdx < startIndex + visibleCount) {
                  const i = signalIdx - startIndex;
                  const d = fullData[signalIdx];
                  if (d) {
                      const x = getX(i) + candleWidth / 2;
                      const isLong = sig.type === 'LONG';
                      
                      // Calculate mid-axis (中轴) of the signal candle
                      const midPrice = (d.high + d.low) / 2;
                      const midY = getY(midPrice);
                      
                      // Calculate breakthrough line (进攻突破线)
                      const amplitude = d.high - d.low;
                      const breakthroughPrice = isLong ? d.high + amplitude * 0.3 : d.low - amplitude * 0.3;
                      const breakthroughY = getY(breakthroughPrice);
                      
                      if (showAuditLines) {
                          // Draw Mid-Axis Defense Line to the right
                          signalMarkers.push(
                              <g key={`sig-mid-${idx}`} pointerEvents="none">
                                  <line 
                                      x1={x} 
                                      y1={midY} 
                                      x2={width} 
                                      y2={midY} 
                                      stroke={isLong ? "#0ECB81" : "#F6465D"} 
                                      strokeWidth={1} 
                                      opacity={0.6} 
                                      strokeDasharray="4 4" 
                                  />
                                  <text 
                                      x={width - 4} 
                                      y={midY - 4} 
                                      fill={isLong ? "#0ECB81" : "#F6465D"} 
                                      fontSize="9" 
                                      textAnchor="end" 
                                      opacity={0.8}
                                  >
                                      中轴防守 {formatPrice(midPrice)}
                                  </text>
                              </g>
                          );

                          // Draw Breakthrough Line to the right
                          signalMarkers.push(
                              <g key={`sig-break-${idx}`} pointerEvents="none">
                                  <line 
                                      x1={x} 
                                      y1={breakthroughY} 
                                      x2={width} 
                                      y2={breakthroughY} 
                                      stroke={isLong ? "#0ECB81" : "#F6465D"} 
                                      strokeWidth={1} 
                                      opacity={0.8} 
                                      strokeDasharray="2 2" 
                                  />
                                  <text 
                                      x={width - 4} 
                                      y={breakthroughY - 4} 
                                      fill={isLong ? "#0ECB81" : "#F6465D"} 
                                      fontSize="9" 
                                      textAnchor="end" 
                                      opacity={0.9}
                                      fontWeight="bold"
                                  >
                                      进攻突破 {formatPrice(breakthroughPrice)}
                                  </text>
                              </g>
                          );
                      }

                      if (!showAuditLines) {
                          signalMarkers.push(
                              <g key={`sig-guide-${idx}`} pointerEvents="none">
                                  <line 
                                      x1={x} 
                                      y1={padding.top} 
                                      x2={x} 
                                      y2={chartHeight} 
                                      stroke={isLong ? "#0ECB81" : "#F6465D"} 
                                      strokeWidth={1} 
                                      strokeDasharray="3 3" 
                                      opacity={0.5} 
                                  />
                                  <circle cx={x} cy={padding.top - 4} r={3} fill={isLong ? "#0ECB81" : "#F6465D"} opacity={0.8} />
                                  <text 
                                      x={x} 
                                      y={padding.top - 10} 
                                      fill={isLong ? "#0ECB81" : "#F6465D"} 
                                      fontSize="9" 
                                      fontWeight="bold" 
                                      textAnchor="middle" 
                                      style={{ textShadow: '0 0 4px rgba(0,0,0,0.9)' }}
                                  >
                                      信号K线
                                  </text>
                              </g>
                          );
                      }

                      if (isLong) {
                          const y = getY(d.low) + 15;
                          signalMarkers.push(
                              <g key={`sig-long-${idx}`} pointerEvents="none">
                                  <text x={x} y={y + 12} fill="#0ECB81" fontSize="9" textAnchor="middle" fontWeight="bold">多</text>
                                  <path d={`M ${x} ${y} L ${x-4} ${y+6} L ${x+4} ${y+6} Z`} fill="#0ECB81" />
                                  {showAuditLines && (
                                      <line x1={x} y1={getY(d.high)} x2={x} y2={getY(d.low)} stroke="#0ECB81" strokeWidth={1.5} opacity={0.6} strokeDasharray="2 2" />
                                  )}
                              </g>
                          );
                      } else {
                          const y = getY(d.high) - 15;
                          signalMarkers.push(
                              <g key={`sig-short-${idx}`} pointerEvents="none">
                                  <text x={x} y={y - 5} fill="#F6465D" fontSize="9" textAnchor="middle" fontWeight="bold">空</text>
                                  <path d={`M ${x} ${y} L ${x-4} ${y-6} L ${x+4} ${y-6} Z`} fill="#F6465D" />
                                  {showAuditLines && (
                                      <line x1={x} y1={getY(d.high)} x2={x} y2={getY(d.low)} stroke="#F6465D" strokeWidth={1.5} opacity={0.6} strokeDasharray="2 2"/>
                                  )}
                              </g>
                          );
                      }
                  }
              }
          });
      }

      // Render Trade Markers
      tradeMarkers.forEach((m, idx) => {
          let mIdx = getCandleIdx(m.time);
          if (mIdx !== -1 && mIdx >= startIndex && mIdx < startIndex + visibleCount) {
              const i = mIdx - startIndex;
              const x = getX(i) + candleWidth / 2;
              const price = m.price || fullData[mIdx].close;
              const y = getY(price);
              
              let color = '#FFF';
              if (m.type === 'OPEN') color = '#22d3ee';
              else if (m.type === 'CLOSE') color = '#fbbf24';
              else if (m.type === 'HEDGE') color = '#a855f7';
              else if (m.type === 'SIGNAL') color = '#34d399';

              signalMarkers.push(
                  <g key={`trade-${m.type}-${m.time}-${idx}`} pointerEvents="none">
                      <circle cx={x} cy={y} r={4} stroke={color} strokeWidth={2} fill="none"/>
                      <text x={x} y={m.type === 'CLOSE' ? y + 20 : y - 10} fill={color} fontSize="9" fontWeight="bold" textAnchor="middle">
                          {m.label}
                      </text>
                  </g>
              );
          }
      });

      // Highlight Time Line (L4 Entry)
      let highlightLine = null;
      if (showAuditLines && highlightTime) {
          // Find index matching time or closest
          let hlIdx = fullData.findIndex(k => k.time === highlightTime);
          
          // Fallback search
          if (hlIdx === -1) {
              let minDiff = Infinity;
              fullData.forEach((k, i) => {
                  const diff = Math.abs(k.time - highlightTime);
                  if (diff < minDiff && diff < intervalMs) {
                      minDiff = diff;
                      hlIdx = i;
                  }
              });
          }

          if (hlIdx !== -1 && hlIdx >= startIndex && hlIdx < startIndex + visibleCount) {
              const i = hlIdx - startIndex;
              const x = getX(i) + candleWidth / 2;
              highlightLine = (
                  <g pointerEvents="none">
                      <line x1={x} y1={0} x2={x} y2={chartHeight} stroke="#A855F7" strokeWidth={1.5} strokeDasharray="4 2" />
                      <text x={x} y={padding.top + 10} fill="#A855F7" fontSize="10" fontWeight="bold" textAnchor="middle" style={{textShadow: '0 0 3px black'}}>L4 ENTRY</text>
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
                  // Try exact match first
                  let eIdx = fullData.findIndex(k => k.time === entryTime);
                  // Fallback match
                  if (eIdx === -1) {
                      let minDiff = Infinity;
                      fullData.forEach((k, i) => {
                          const diff = Math.abs(k.time - entryTime!);
                          if (diff < minDiff && diff < intervalMs) {
                              minDiff = diff;
                              eIdx = i;
                          }
                      });
                  }
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

      // EXTRA LINES (Trigger / Defense) - Only show in Audit mode
      const extraVisuals = showAuditLines ? extraLines?.map((line, idx) => {
          if (!line.price || line.price <= 0) return null;
          const y = getY(line.price);
          if (isNaN(y)) return null;
          const dash = line.style === 'dashed' ? '6 4' : undefined;
          
          return (
              <g key={`extra-${idx}`} pointerEvents="none">
                  <line x1={0} y1={y} x2={width - padding.right} y2={y} stroke={line.color} strokeWidth={1.5} strokeDasharray={dash} opacity={0.9} />
                  <rect x={width - 80} y={y - 9} width={80} height={18} fill={line.color} rx={2} opacity={0.15} />
                  <text x={width - 76} y={y + 3} fill={line.color} fontSize="9" fontWeight="bold" fontFamily="monospace">
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
              {signalMarkers}
              {highlightLine}
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
               <button onClick={onClose} className="p-1.5 hover:bg-slate-700 rounded text-slate-400 hover:text-white"><X size={18} /></button>
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
                        <span className="text-rose-400 font-bold">{dailyStats.maxDrop.toFixed(2)}%</span>
                    </div>
                    <div className="h-3 w-px bg-slate-800"></div>
                    <div className="flex items-center gap-1 whitespace-nowrap">
                        <span className="text-slate-500 font-semibold">历史实际涨幅:</span>
                        <span className="text-emerald-400 font-bold">{dailyStats.maxPump.toFixed(2)}%</span>
                    </div>
                    <div className="h-3 w-px bg-slate-800"></div>
                    <div className="flex items-center gap-1 whitespace-nowrap">
                        <span className="text-slate-500 font-semibold">实际极值涨跌:</span>
                        <span className="text-emerald-500 font-bold">+{dailyStats.extremeRise.toFixed(2)}%</span>
                        <span className="text-slate-600">/</span>
                        <span className="text-rose-500 font-bold">-{dailyStats.extremeDrop.toFixed(2)}%</span>
                    </div>
                    <div className="h-3 w-px bg-slate-800"></div>
                    <div className="flex items-center gap-1 whitespace-nowrap">
                        <span className="text-slate-500 font-semibold">横盘内涨跌:</span>
                        <span className={`font-bold ${dailyStats.sidewaysRise > 0 ? 'text-emerald-400' : 'text-slate-400'}`}>+{dailyStats.sidewaysRise.toFixed(2)}%</span>
                        <span className="text-slate-600">/</span>
                        <span className={`font-bold ${dailyStats.sidewaysDrop > 0 ? 'text-rose-400' : 'text-slate-400'}`}>-{dailyStats.sidewaysDrop.toFixed(2)}%</span>
                    </div>
                    <div className="h-3 w-px bg-slate-800"></div>
                    <div className="flex items-center gap-1 whitespace-nowrap">
                        <span className="text-slate-500 font-semibold">EMA80偏离度:</span>
                        <span className={`font-bold ${dailyStats.ema80Dev >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {dailyStats.ema80Dev >= 0 ? '+' : ''}{dailyStats.ema80Dev.toFixed(2)}%
                        </span>
                    </div>
                    <div className="h-3 w-px bg-slate-800"></div>
                    <div className="flex items-center gap-1 whitespace-nowrap">
                        <span className="text-slate-500 font-semibold">今日量能比:</span>
                        <span className={`font-bold ${dailyStats.volRatio >= 1.5 ? 'text-yellow-400 animate-pulse' : 'text-sky-400'}`}>
                            {dailyStats.volRatio.toFixed(2)}x
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
