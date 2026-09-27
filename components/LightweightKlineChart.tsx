import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { 
  createChart, 
  CandlestickSeries, 
  HistogramSeries, 
  LineSeries, 
  ColorType, 
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  HistogramData,
  LineData,
  UTCTimestamp
} from 'lightweight-charts';
import { Loader2, Zap, RefreshCw, BarChart2 } from 'lucide-react';
import { calculateEMA } from '../services/indicators';
import { binanceKlineWs, WsKlineUpdate } from '../services/binanceKlineWs';
import { formatToBinanceSymbol, normalizeSymbol, formatPrice } from '../services/symbolUtils';

interface ExtraLine {
  price: number;
  label: string;
  color: string;
  style?: 'solid' | 'dashed';
}

interface Props {
  symbol: string;
  timeframe: string;
  klines: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  entryPrice?: number;
  side?: 'LONG' | 'SHORT' | string;
  extraLines?: ExtraLine[];
  className?: string;
  onRefresh?: () => void;
}

/**
 * 币安/TradingView 官方 Lightweight Charts 极速 Canvas K线引擎
 * 采用硬件加速 Canvas 渲染，帧率高达 60fps，毫秒级响应
 * 即使持仓 50+ 个币，内存消耗极低，缩放、平移极度丝滑
 */
export const LightweightKlineChart: React.FC<Props> = ({
  symbol,
  timeframe,
  klines,
  entryPrice,
  side,
  extraLines = [],
  className = '',
  onRefresh
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<any> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<any> | null>(null);
  const ema10SeriesRef = useRef<ISeriesApi<any> | null>(null);
  const ema20SeriesRef = useRef<ISeriesApi<any> | null>(null);
  const ema30SeriesRef = useRef<ISeriesApi<any> | null>(null);
  const ema40SeriesRef = useRef<ISeriesApi<any> | null>(null);
  const ema80SeriesRef = useRef<ISeriesApi<any> | null>(null);

  const [lastLiveTick, setLastLiveTick] = useState<number>(Date.now());
  const [currentHoverPrice, setCurrentHoverPrice] = useState<{
    time?: number;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    volume?: number;
  } | null>(null);

  // 初始化图表实例
  useEffect(() => {
    if (!containerRef.current) return;

    // 清理旧 DOM 内容
    containerRef.current.innerHTML = '';

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth || 800,
      height: containerRef.current.clientHeight || 500,
      layout: {
        background: { type: ColorType.Solid, color: '#161A25' },
        textColor: '#848E9C',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(43, 49, 57, 0.5)' },
        horzLines: { color: 'rgba(43, 49, 57, 0.5)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: '#758696',
          width: 1,
          style: 3,
          labelBackgroundColor: '#2B3139',
        },
        horzLine: {
          color: '#758696',
          width: 1,
          style: 3,
          labelBackgroundColor: '#2B3139',
        },
      },
      timeScale: {
        borderColor: '#2B3139',
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: '#2B3139',
        autoScale: true,
      },
    });

    // 1. K线 Series (币安配色: 涨绿跌红)
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#0ECB81',
      downColor: '#F6465D',
      borderVisible: false,
      wickUpColor: '#0ECB81',
      wickDownColor: '#F6465D',
    });

    // 2. 成交量 Series (底层柱状图)
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    // 3. EMA 均线组 (EMA10, EMA20, EMA30, EMA40, EMA80)
    const ema10Series = chart.addSeries(LineSeries, { color: '#FACC15', lineWidth: 1, title: 'EMA10' });
    const ema20Series = chart.addSeries(LineSeries, { color: '#A855F7', lineWidth: 1, title: 'EMA20' });
    const ema30Series = chart.addSeries(LineSeries, { color: '#3B82F6', lineWidth: 1, title: 'EMA30' });
    const ema40Series = chart.addSeries(LineSeries, { color: '#F97316', lineWidth: 1, title: 'EMA40' });
    const ema80Series = chart.addSeries(LineSeries, { color: '#06B6D4', lineWidth: 2, title: 'EMA80' });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    ema10SeriesRef.current = ema10Series;
    ema20SeriesRef.current = ema20Series;
    ema30SeriesRef.current = ema30Series;
    ema40SeriesRef.current = ema40Series;
    ema80SeriesRef.current = ema80Series;

    // 监听十字光标移动
    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time || !param.seriesData) {
        setCurrentHoverPrice(null);
        return;
      }
      const candleData = param.seriesData.get(candleSeries) as any;
      const volData = param.seriesData.get(volumeSeries) as any;
      if (candleData) {
        setCurrentHoverPrice({
          time: typeof param.time === 'number' ? param.time * 1000 : 0,
          open: candleData.open,
          high: candleData.high,
          low: candleData.low,
          close: candleData.close,
          volume: volData ? volData.value : undefined,
        });
      }
    });

    // 监听容器大小自动重绘 (ResizeObserver)
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length > 0 && chartRef.current && containerRef.current) {
        const { width, height } = entries[0].contentRect;
        chartRef.current.applyOptions({
          width: width || 800,
          height: height || 500,
        });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // 绑定数据到图表
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || !klines || klines.length === 0) return;

    // 格式化并去重
    const sorted = [...klines].sort((a, b) => a.time - b.time);
    const seenTimes = new Set<number>();
    const formattedCandles: CandlestickData<UTCTimestamp>[] = [];
    const formattedVolumes: HistogramData<UTCTimestamp>[] = [];

    sorted.forEach((k) => {
      const sec = Math.floor(k.time / 1000) as UTCTimestamp;
      if (seenTimes.has(sec)) return;
      seenTimes.add(sec);

      formattedCandles.push({
        time: sec,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
      });

      formattedVolumes.push({
        time: sec,
        value: k.volume,
        color: k.close >= k.open ? 'rgba(14, 203, 129, 0.35)' : 'rgba(246, 70, 93, 0.35)',
      });
    });

    candleSeriesRef.current.setData(formattedCandles);
    volumeSeriesRef.current.setData(formattedVolumes);

    // 计算各周期 EMA 并填充
    const closes = sorted.map((k) => k.close);
    const calculateEmaData = (period: number): LineData<UTCTimestamp>[] => {
      const emaVals = calculateEMA(closes, period);
      const res: LineData<UTCTimestamp>[] = [];
      sorted.forEach((k, idx) => {
        const val = emaVals[idx];
        if (val !== undefined && !isNaN(val)) {
          res.push({
            time: Math.floor(k.time / 1000) as UTCTimestamp,
            value: val,
          });
        }
      });
      return res;
    };

    if (ema10SeriesRef.current) ema10SeriesRef.current.setData(calculateEmaData(10));
    if (ema20SeriesRef.current) ema20SeriesRef.current.setData(calculateEmaData(20));
    if (ema30SeriesRef.current) ema30SeriesRef.current.setData(calculateEmaData(30));
    if (ema40SeriesRef.current) ema40SeriesRef.current.setData(calculateEmaData(40));
    if (ema80SeriesRef.current) ema80SeriesRef.current.setData(calculateEmaData(80));

    // 开仓均线标记
    if (entryPrice && entryPrice > 0 && candleSeriesRef.current) {
      try {
        candleSeriesRef.current.createPriceLine({
          price: entryPrice,
          color: side === 'SHORT' ? '#F6465D' : '#0ECB81',
          lineWidth: 2,
          lineStyle: 0, // Solid
          axisLabelVisible: true,
          title: `开仓价 (${side === 'SHORT' ? '空' : '多'})`,
        });
      } catch (e) {}
    }

    // 战术防守与进攻附加线
    if (extraLines && extraLines.length > 0 && candleSeriesRef.current) {
      extraLines.forEach((line) => {
        if (line.price > 0) {
          try {
            candleSeriesRef.current.createPriceLine({
              price: line.price,
              color: line.color || '#3B82F6',
              lineWidth: 1,
              lineStyle: line.style === 'solid' ? 0 : 2, // Dashed
              axisLabelVisible: true,
              title: line.label,
            });
          } catch (e) {}
        }
      });
    }

    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [klines, entryPrice, side, extraLines]);

  // ⚡ 实时 WebSocket 秒级增量渲染更新（无 DOM 开销，直接 Canvas 绘制）
  useEffect(() => {
    const safeSymbol = formatToBinanceSymbol(symbol);
    if (!safeSymbol || !candleSeriesRef.current || !volumeSeriesRef.current) return;

    binanceKlineWs.subscribe(safeSymbol, timeframe);

    const unsubscribe = binanceKlineWs.addListener((update: WsKlineUpdate) => {
      const updateSym = formatToBinanceSymbol(update.symbol);
      if (updateSym === safeSymbol && update.tf.toLowerCase() === timeframe.toLowerCase()) {
        const sec = Math.floor(update.time / 1000) as UTCTimestamp;
        try {
          if (candleSeriesRef.current) {
            candleSeriesRef.current.update({
              time: sec,
              open: update.open,
              high: update.high,
              low: update.low,
              close: update.close,
            });
          }
          if (volumeSeriesRef.current) {
            volumeSeriesRef.current.update({
              time: sec,
              value: update.volume,
              color: update.close >= update.open ? 'rgba(14, 203, 129, 0.35)' : 'rgba(246, 70, 93, 0.35)',
            });
          }
          setLastLiveTick(Date.now());
        } catch (e) {}
      }
    });

    return () => {
      unsubscribe();
      binanceKlineWs.unsubscribe(safeSymbol, timeframe);
    };
  }, [symbol, timeframe]);

  const latestKline = klines && klines.length > 0 ? klines[klines.length - 1] : null;
  const displayKline = currentHoverPrice || latestKline;

  return (
    <div className={`relative w-full h-full flex flex-col bg-[#161A25] select-none ${className}`}>
      {/* 顶部 OHLCV 实时状态栏 */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#1B202C] border-b border-slate-800 text-[11px] font-mono text-slate-300 shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-bold text-slate-100 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            TradingView 极速 Canvas 引擎:
          </span>
          {displayKline && (
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-slate-400">开: <span className="text-slate-200">{formatPrice(displayKline.open || 0)}</span></span>
              <span className="text-slate-400">高: <span className="text-emerald-400">{formatPrice(displayKline.high || 0)}</span></span>
              <span className="text-slate-400">低: <span className="text-rose-400">{formatPrice(displayKline.low || 0)}</span></span>
              <span className="text-slate-400">收: <span className={`font-bold ${(displayKline.close || 0) >= (displayKline.open || 0) ? 'text-emerald-400' : 'text-rose-400'}`}>{formatPrice(displayKline.close || 0)}</span></span>
              {displayKline.volume !== undefined && (
                <span className="text-slate-400">量: <span className="text-cyan-300">{(displayKline.volume).toFixed(1)}</span></span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* EMA 图例 */}
          <div className="hidden md:flex items-center gap-2 text-[9px]">
            <span className="text-yellow-400">EMA10</span>
            <span className="text-purple-400">EMA20</span>
            <span className="text-blue-400">EMA30</span>
            <span className="text-orange-400">EMA40</span>
            <span className="text-cyan-400">EMA80</span>
          </div>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/50 flex items-center gap-1">
            <Zap size={9} className="animate-pulse" />
            <span>60FPS流畅硬件加速</span>
          </span>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors"
              title="刷新数据"
            >
              <RefreshCw size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Canvas 渲染容器 */}
      <div ref={containerRef} className="relative flex-1 w-full h-full bg-[#161A25]" />
    </div>
  );
};

export default LightweightKlineChart;
