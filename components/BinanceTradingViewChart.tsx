import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Loader2, ExternalLink, RefreshCw, BarChart2 } from 'lucide-react';
import { normalizeSymbol } from '../services/symbolUtils';

interface Props {
  symbol: string;
  timeframe?: string;
  isFutures?: boolean;
  entryPrice?: number;
  entryTime?: number;
  side?: 'LONG' | 'SHORT' | string;
  className?: string;
}

/**
 * 币安官方主推 TradingView 专业图表组件 (Binance TradingView Advanced Chart)
 * 采用 TradingView 官方嵌入式脚本引擎 (embed-widget-advanced-chart.js)
 * - 永续合约代码规范: BINANCE:${symbol}USDT.P (例如 BINANCE:BTCUSDT.P, BINANCE:ETHUSDT.P)
 * - 现货代码规范: BINANCE:${symbol}USDT
 * - 纯硬件加速渲染，彻底脱离主线程 React 渲染队列与本地跨域代理限制，无论持仓多少币种均 0 延迟秒开
 */
export const BinanceTradingViewChart: React.FC<Props> = ({
  symbol,
  timeframe = '15m',
  isFutures = true,
  entryPrice,
  side,
  className = ''
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // 转换周期到 TradingView 规范
  const tvInterval = useMemo(() => {
    const tf = (timeframe || '15m').toLowerCase();
    switch (tf) {
      case '1m': return '1';
      case '3m': return '3';
      case '5m': return '5';
      case '15m': return '15';
      case '30m': return '30';
      case '1h': return '60';
      case '2h': return '120';
      case '4h': return '240';
      case '8h': return '480';
      case '1d': return 'D';
      case '1w': return 'W';
      case '1M': return 'M';
      default: return '15';
    }
  }, [timeframe]);

  // 格式化为币安 TradingView 专用交易对符号 (支持 1000 开头 Meme 币种如 1000PEPE, 1000SHIB, 1000BONK)
  const tvSymbol = useMemo(() => {
    let clean = normalizeSymbol(symbol).toUpperCase().replace(/_PREP$/, '');
    if (!clean.endsWith('USDT')) {
      clean = `${clean}USDT`;
    }
    const cleanBase = clean.replace(/^1000/, '').replace(/USDT$/, '');
    const scaleMemeSymbols = ['PEPE', 'SHIB', 'BONK', 'FLOKI', 'LUNC', 'SATS', 'RATS', 'XEC', 'BABYDOGE', 'CATI', 'CAT'];
    const isMeme = scaleMemeSymbols.includes(cleanBase);

    let finalPair = clean;
    if (isFutures) {
      if (isMeme && !clean.startsWith('1000')) {
        finalPair = `1000${cleanBase}USDT`;
      }
      return `BINANCE:${finalPair}.P`;
    } else {
      if (clean.startsWith('1000')) {
        finalPair = `${cleanBase}USDT`;
      }
      return `BINANCE:${finalPair}`;
    }
  }, [symbol, isFutures]);

  // 币安官方交易页面直达链接
  const binanceUrl = useMemo(() => {
    let clean = normalizeSymbol(symbol).toUpperCase();
    if (!clean.endsWith('USDT')) clean = `${clean}USDT`;
    return isFutures
      ? `https://www.binance.com/zh-CN/futures/${clean}`
      : `https://www.binance.com/zh-CN/trade/${clean}`;
  }, [symbol, isFutures]);

  const [useIframeFallback, setUseIframeFallback] = useState(false);

  // 使用 TradingView 官方标准嵌入式脚本动态挂载
  useEffect(() => {
    if (useIframeFallback) return;
    if (!containerRef.current) return;
    const currentContainer = containerRef.current;
    currentContainer.innerHTML = '';

    const widgetWrapper = document.createElement('div');
    widgetWrapper.className = 'tradingview-widget-container';
    widgetWrapper.style.width = '100%';
    widgetWrapper.style.height = '100%';

    const widgetBox = document.createElement('div');
    widgetBox.className = 'tradingview-widget-container__widget';
    widgetBox.style.width = '100%';
    widgetBox.style.height = '100%';
    widgetWrapper.appendChild(widgetBox);

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.onerror = () => {
      console.warn('[TradingView] CDN script load error, switching to direct iframe widget');
      setUseIframeFallback(true);
    };
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval: tvInterval,
      timezone: 'Asia/Shanghai',
      theme: 'dark',
      style: '1',
      locale: 'zh_CN',
      enable_publishing: false,
      allow_symbol_change: true,
      calendar: false,
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: true,
      support_host: 'https://www.tradingview.com',
      studies: [
        'MASimple@tv-basicstudies',
        'EMA@tv-basicstudies'
      ]
    });

    widgetWrapper.appendChild(script);
    currentContainer.appendChild(widgetWrapper);

    // Timeout check: if after 4.5 seconds no iframe is created, fallback to direct iframe
    const fallbackTimer = setTimeout(() => {
      if (currentContainer && !currentContainer.querySelector('iframe')) {
        console.info('[TradingView] Script did not render iframe within 4.5s, switching to direct iframe');
        setUseIframeFallback(true);
      }
    }, 4500);

    return () => {
      clearTimeout(fallbackTimer);
      currentContainer.innerHTML = '';
    };
  }, [tvSymbol, tvInterval, reloadKey, useIframeFallback]);

  return (
    <div className={`relative w-full h-full flex flex-col bg-[#161A25] overflow-hidden ${className}`}>
      {/* 顶部行情状态条与外部跳转按钮 */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#1b202c] border-b border-slate-800 text-[11px] text-slate-300 shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-100 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            币安 TradingView 主推图表:
          </span>
          <span className="font-mono text-cyan-400 font-bold px-1.5 py-0.5 bg-cyan-950/60 rounded border border-cyan-800/50">
            {tvSymbol}
          </span>
          <span className="text-slate-400 font-mono">
            [{timeframe}]
          </span>
          {entryPrice && entryPrice > 0 && (
            <span className="flex items-center gap-1 text-slate-300 ml-2 px-1.5 py-0.5 bg-slate-800/80 rounded border border-slate-700">
              <span>持仓开仓价:</span>
              <span className={`font-mono font-bold ${side === 'SHORT' ? 'text-rose-400' : 'text-emerald-400'}`}>
                ${entryPrice}
              </span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setReloadKey(k => k + 1)}
            className="flex items-center gap-1 px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded border border-slate-700 transition-colors"
            title="重新加载图表"
          >
            <RefreshCw size={11} />
            <span>刷新</span>
          </button>
          <a
            href={binanceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-2 py-0.5 bg-amber-950/60 hover:bg-amber-600 text-amber-300 hover:text-white rounded border border-amber-800/60 transition-colors"
            title="在币安官方交易所页面中打开"
          >
            <ExternalLink size={11} />
            <span>币安原网直达</span>
          </a>
        </div>
      </div>

      {/* 主图表容器：由 TradingView 官方嵌入脚本直接挂载或直连 iframe 镜像 */}
      {useIframeFallback ? (
        <iframe
          key={`${tvSymbol}-${tvInterval}-${reloadKey}`}
          src={`https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(tvSymbol)}&interval=${tvInterval}&theme=dark&style=1&locale=zh_CN&enable_publishing=false&allow_symbol_change=true&calendar=false&support_host=https%3A%2F%2Fwww.tradingview.com`}
          className="relative flex-1 w-full h-full border-0 bg-[#161A25]"
          title="Binance TradingView Advanced Chart"
          allow="fullscreen"
        />
      ) : (
        <div ref={containerRef} className="relative flex-1 w-full h-full bg-[#161A25]" />
      )}
    </div>
  );
};

export default BinanceTradingViewChart;
