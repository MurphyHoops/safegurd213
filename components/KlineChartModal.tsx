
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { X, Loader2, Move, ZoomIn, ZoomOut, RefreshCw, AlertTriangle, WifiOff, Activity, ArrowRight, BarChart2 } from 'lucide-react';
import { calculateEMA } from '../services/indicators';
import { fetchWithFallback } from '../services/apiService';
import { analyzeList2Crossing } from '../services/rules/list2_crossing'; // Import Rule Logic
import { List2Config } from './Scanner/scannerTypes';

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

const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'];

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
const MAX_CANDLES_VISIBLE = 150; 

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

import { createPortal } from 'react-dom';

const KlineChartModal: React.FC<Props> = ({ symbol, initialTimeframe = '15m', signals = [], entryPrice, entryTime, currentPrice, scanWindow = 9, list2Config, highlightTime, extraLines, directMode = false, onClose, onTimeframeChange }) => {
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

  // Viewport State
  const [visibleCount, setVisibleCount] = useState(80); 
  const [startIndex, setStartIndex] = useState(0); 
  const [hoverIndex, setHoverIndex] = useState<number | null>(null); 
  const [mouseY, setMouseY] = useState<number | null>(null); 
  const [isAutoScroll, setIsAutoScroll] = useState(true); 
  
  // Drag State
  const [isDragging, setIsDragging] = useState(false);
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
      const scanConfig: List2Config = {
          ...list2Config,
          triggerMode: 'ALL',
          maxLag: list2Config.maxLag // Strict adherence: Only scan the backtrace window
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
        if (isInitialLoad) {
            setLoading(true);
            setError(null);
        }

        try {
            // OPTIMIZED: Reduced limit from 1000 to 299 to speed up fetch time.
            const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${timeframe}&limit=299&_t=${Date.now()}`;
            const validator = (data: any) => Array.isArray(data) && data.length > 0;
            
            console.log(`[KlineChart] Calling fetchWithFallback for ${symbol}`);
            const res = await fetchWithFallback(url, { cache: 'no-store', timeout: 10000 }, validator, directMode);
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
                        setStartIndex(Math.max(0, klines.length - 80));
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
      const delta = Math.sign(e.deltaY); 
      let newCount = visibleCount + (delta * 4);
      newCount = Math.max(MIN_CANDLES_VISIBLE, Math.min(newCount, MAX_CANDLES_VISIBLE));
      if (newCount !== visibleCount) {
          let newStart = startIndex + (delta > 0 ? -2 : 2); 
          newStart = Math.max(0, Math.min(newStart, fullData.length - newCount));
          setVisibleCount(newCount);
          setStartIndex(newStart);
          setIsAutoScroll(false); 
      }
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
                                  中轴防守 {midPrice.toFixed(4)}
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
                                  进攻突破 {breakthroughPrice.toFixed(4)}
                              </text>
                          </g>
                      );

                      if (isLong) {
                          const y = getY(d.low) + 15;
                          signalMarkers.push(
                              <g key={`sig-long-${idx}`} pointerEvents="none">
                                  <text x={x} y={y + 12} fill="#0ECB81" fontSize="9" textAnchor="middle" fontWeight="bold">多</text>
                                  <path d={`M ${x} ${y} L ${x-4} ${y+6} L ${x+4} ${y+6} Z`} fill="#0ECB81" />
                                  <line x1={x} y1={getY(d.high)} x2={x} y2={getY(d.low)} stroke="#0ECB81" strokeWidth={1.5} opacity={0.6} strokeDasharray="2 2" />
                              </g>
                          );
                      } else {
                          const y = getY(d.high) - 15;
                          signalMarkers.push(
                              <g key={`sig-short-${idx}`} pointerEvents="none">
                                  <text x={x} y={y - 5} fill="#F6465D" fontSize="9" textAnchor="middle" fontWeight="bold">空</text>
                                  <path d={`M ${x} ${y} L ${x-4} ${y-6} L ${x+4} ${y-6} Z`} fill="#F6465D" />
                                  <line x1={x} y1={getY(d.high)} x2={x} y2={getY(d.low)} stroke="#F6465D" strokeWidth={1.5} opacity={0.6} strokeDasharray="2 2"/>
                              </g>
                          );
                      }
                  }
              }
          });
      }

      // Highlight Time Line (L4 Entry)
      let highlightLine = null;
      if (highlightTime) {
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
                          ENTRY: {entryPrice.toFixed(4)}
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

      // EXTRA LINES (Trigger / Defense)
      const extraVisuals = extraLines?.map((line, idx) => {
          if (!line.price || line.price <= 0) return null;
          const y = getY(line.price);
          if (isNaN(y)) return null;
          const dash = line.style === 'dashed' ? '6 4' : undefined;
          
          return (
              <g key={`extra-${idx}`} pointerEvents="none">
                  <line x1={0} y1={y} x2={width - padding.right} y2={y} stroke={line.color} strokeWidth={1.5} strokeDasharray={dash} opacity={0.9} />
                  <rect x={width - 80} y={y - 9} width={80} height={18} fill={line.color} rx={2} opacity={0.15} />
                  <text x={width - 76} y={y + 3} fill={line.color} fontSize="9" fontWeight="bold" fontFamily="monospace">
                      {line.label}: {line.price.toFixed(4)}
                  </text>
              </g>
          );
      });

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
                          {price.toFixed(price < 1 ? 6 : 4)}
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

      return (
          <svg width="100%" height="100%" className="overflow-visible">
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
              {currentPriceLine}
              {crosshair}
          </svg>
      );
  };

  const modalContent = (
    <div className="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm p-2" style={{ zIndex: 2147483647 }} onClick={onClose}>
      <div className="bg-[#161A25] border border-slate-700 rounded-lg shadow-2xl flex flex-col w-[95vw] h-[85vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-slate-800 bg-[#1E2329] shrink-0">
           <div className="flex items-center gap-4">
               <div className="flex items-center gap-2">
                   <h2 className="text-lg font-bold text-slate-100">{symbol}</h2>
                   <span className="text-[10px] text-slate-400 bg-slate-800 px-1 rounded">永续合约</span>
                   <span className={`text-[9px] px-2 py-0.5 rounded border flex items-center gap-1 transition-colors ${lastUpdated > Date.now() - 5000 ? 'bg-emerald-900/30 border-emerald-500/30 text-emerald-400' : 'bg-slate-800 border-slate-600 text-slate-500'}`}>
                       <Activity size={10} className={lastUpdated > Date.now() - 5000 ? 'animate-pulse' : ''}/>
                       {lastUpdated > Date.now() - 5000 ? '实时数据' : '连接中...'}
                   </span>
               </div>
               <div className="h-4 w-px bg-slate-700"></div>
               <div className="flex gap-1">
                   {TIMEFRAMES.map(tf => (
                       <button key={tf} onClick={() => {
                           setTimeframe(tf);
                           if (onTimeframeChange) onTimeframeChange(tf);
                       }} className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${timeframe === tf ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>{tf}</button>
                   ))}
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
        <div ref={containerRef} className={`flex-1 relative w-full h-full select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'} ${loading ? 'opacity-70 pointer-events-none' : ''}`} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={() => { handleMouseUp(); setHoverIndex(null); setMouseY(null); }} onWheel={handleWheel}>
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
                <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-[#161A25]/90">
                    <AlertTriangle size={40} className="text-red-500 mb-2" />
                    <span className="text-sm font-bold text-slate-300 mb-2">{error}</span>
                    <button onClick={() => { setError(null); setLoading(true); setRetryCount(c => c + 1); }} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-bold">重试连接</button>
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

  return createPortal(modalContent, document.body);
};

export default KlineChartModal;
