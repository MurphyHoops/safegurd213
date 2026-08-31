
import React, { useState, useEffect } from 'react';
import { Zap, CheckSquare, Square, Trash2, Download, Loader2, Sparkles, Brain, TrendingUp } from 'lucide-react';
import { ScannerItem, ScanConfig } from '../../../components/Scanner/scannerTypes';
import { fetchWithFallback } from '../../../services/apiService';

interface Props {
    item: ScannerItem;
    idx: number;
    scanConfig: ScanConfig;
    fixedModeView: 'MONITOR' | 'SEARCH';
    customSymbolSet: Set<string>;
    onToggleSymbol: (symbol: string) => void;
    onDeleteSymbol: (symbol: string) => void;
    setChartData: (data: any) => void;
    mode?: 'LIVE' | 'BACKTEST' | 'SMART';
    extremeMetrics?: {
        maxDeclinePct: number;
        maxIncreasePct: number;
        lowToCurrentIncreasePct: number;
        highToCurrentDeclinePct: number;
        lowDaysAgo: number;
        highDaysAgo: number;
        loading: boolean;
        minPeriodLow?: number;
        maxPeriodHigh?: number;
    };
    downloadProgress?: number; // 0-100
    onDownload?: (symbol: string) => void;
}

// Global cache to avoid duplicate API requests for the same token and looking back period
const KLINE_LIMIT_CACHE: Record<string, Record<number, { timestamp: number; klines: any[] }>> = 
    ((window as any).KLINE_LIMIT_CACHE = (window as any).KLINE_LIMIT_CACHE || {});

const KLINE_1H_CACHE: Record<string, { timestamp: number; klines: any[] }> = 
    ((window as any).KLINE_1H_CACHE = (window as any).KLINE_1H_CACHE || {});

export const List1Item: React.FC<Props> = ({ 
    item, idx, scanConfig, fixedModeView, customSymbolSet, onToggleSymbol, onDeleteSymbol, setChartData,
    mode = 'LIVE', extremeMetrics, downloadProgress, onDownload
}) => {
    if (!item || !item.symbol) return null;
    
    const isChecked = customSymbolSet.has(item.symbol.replace('USDT', '').toUpperCase());
    const showCheckbox = true; // Always allow rapid toggling to/from Watchlist (M1 -> Watchlist transfer)
    const changeVal = item.change8am || 0; // Safe Fallback
    const isSmart = mode === 'SMART' && item.smartScore !== undefined;

    const lookbackDays = scanConfig.majorTrend?.lookbackDays || 300;

    const [klines, setKlines] = useState<any[]>([]);
    const [loadingKlines, setLoadingKlines] = useState(false);

    useEffect(() => {
        if (extremeMetrics) {
            // Already calculated and cached by parent, no need to fetch daily history
            return;
        }
        if (mode === 'BACKTEST') {
            return;
        }
        // In LIVE mode, the parent List1_Selection pre-calculates and caches daily history sequentially.
        // Child components should skip making duplicate parallel fetches to prevent network storms.
        return;
    }, [item.symbol, lookbackDays, extremeMetrics, mode]);

    const [intervalsData, setIntervalsData] = useState<Record<string, { klines: any[]; loading: boolean }>>({
        '1h': { klines: [], loading: false },
        '4h': { klines: [], loading: false },
        '24h': { klines: [], loading: false },
        '72h': { klines: [], loading: false },
        '168h': { klines: [], loading: false },
    });

    const [isIntervalsFetched, setIsIntervalsFetched] = useState(false);
    const [showDetails, setShowDetails] = useState(false);

    const intervalMap = [
        { key: '1h', interval: '1h' },
        { key: '4h', interval: '4h' },
        { key: '24h', interval: '1d' },
        { key: '72h', interval: '3d' },
        { key: '168h', interval: '1w' }
    ];

    const fetchAllIntervals = async () => {
        setIsIntervalsFetched(true);
        if (mode === 'BACKTEST') return;

        const limit = 30;
        const now = Date.now();

        setIntervalsData(prev => {
            const updated = { ...prev };
            for (const cfg of intervalMap) {
                updated[cfg.key] = { ...updated[cfg.key], loading: true };
            }
            return updated;
        });

        const promises = intervalMap.map(async (cfg) => {
            const KLINE_INTERVAL_CACHE = (window as any).KLINE_INTERVAL_CACHE = (window as any).KLINE_INTERVAL_CACHE || {};
            if (!KLINE_INTERVAL_CACHE[item.symbol]) {
                KLINE_INTERVAL_CACHE[item.symbol] = {};
            }

            const cached = KLINE_INTERVAL_CACHE[item.symbol][cfg.interval];
            if (cached && now - cached.timestamp < 5 * 60 * 1000) { // 5 mins cache
                return { key: cfg.key, klines: cached.klines };
            }

            try {
                const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${item.symbol}&interval=${cfg.interval}&limit=${limit}`;
                const res = await fetchWithFallback(url, { timeout: 15000 }, (d) => Array.isArray(d));
                const data = await res.json();
                if (Array.isArray(data)) {
                    KLINE_INTERVAL_CACHE[item.symbol][cfg.interval] = {
                        timestamp: now,
                        klines: data
                    };
                    return { key: cfg.key, klines: data };
                }
            } catch (err) {
                console.error(`Failed to fetch ${cfg.interval} klines for ${item.symbol}`, err);
            }
            return { key: cfg.key, klines: [] };
        });

        const results = await Promise.all(promises);

        setIntervalsData(prev => {
            const updated = { ...prev };
            for (const res of results) {
                updated[res.key] = { klines: res.klines, loading: false };
            }
            return updated;
        });
    };

    const currentPrice = item.price;

    const getStatsForInterval = (key: string) => {
        const data = intervalsData[key];
        const klinesList = data?.klines;
        if (!klinesList || klinesList.length < 28) {
            return { changePct: null, ratio1: null, ratio2: null, buyRatio1: null, buyRatio2: null };
        }

        const N = klinesList.length;

        // 1. Price change percentage compared to the close of the last closed bar (index N-2)
        const lastClosedClose = parseFloat(klinesList[N-2][4]);
        let changePct: number | null = null;
        if (!isNaN(lastClosedClose) && lastClosedClose !== 0) {
            changePct = ((currentPrice - lastClosedClose) / lastClosedClose) * 100;
        }

        // 2. Volume Ratio 1:
        // "量比1即当前最后一根结束的K线交易量与过去24根K线交易量平均值比例"
        const lastClosedVol = parseFloat(klinesList[N-2][5]);

        let sumPast24Vol = 0;
        let validPast24Count = 0;
        for (let i = N - 26; i <= N - 3; i++) {
            if (i >= 0 && klinesList[i]) {
                const vol = parseFloat(klinesList[i][5]);
                if (!isNaN(vol)) {
                    sumPast24Vol += vol;
                    validPast24Count++;
                }
            }
        }
        const avgPast24Vol = validPast24Count > 0 ? (sumPast24Vol / validPast24Count) : 0;

        let ratio1: number | null = null;
        if (avgPast24Vol > 0 && !isNaN(lastClosedVol)) {
            ratio1 = lastClosedVol / avgPast24Vol;
        }

        // 3. Volume Ratio 2:
        // "量比2即当前最后4根结束的K线交易量平均交易量与过去24根K线交易量平均值比例"
        let sumLast4Vol = 0;
        let validLast4Count = 0;
        for (let i = N - 5; i <= N - 2; i++) {
            if (i >= 0 && klinesList[i]) {
                const vol = parseFloat(klinesList[i][5]);
                if (!isNaN(vol)) {
                    sumLast4Vol += vol;
                    validLast4Count++;
                }
            }
        }
        const avgLast4Vol = validLast4Count > 0 ? (sumLast4Vol / validLast4Count) : 0;

        let ratio2: number | null = null;
        if (avgPast24Vol > 0 && avgLast4Vol > 0) {
            ratio2 = avgLast4Vol / avgPast24Vol;
        }

        // 4. Active Buy Ratio (Taker Buy Volume Ratio)
        // Last closed bar buy ratio (buyRatio1):
        const lastClosedTakerBuyVol = klinesList[N-2][9] !== undefined ? parseFloat(klinesList[N-2][9]) : NaN;
        let buyRatio1: number | null = null;
        if (!isNaN(lastClosedTakerBuyVol) && !isNaN(lastClosedVol) && lastClosedVol > 0) {
            buyRatio1 = (lastClosedTakerBuyVol / lastClosedVol) * 100;
        }

        // Last 4 closed bars buy ratio (buyRatio2):
        let sumTakerBuyLast4 = 0;
        for (let i = N - 5; i <= N - 2; i++) {
            if (i >= 0 && klinesList[i] && klinesList[i][9] !== undefined) {
                const takerBuy = parseFloat(klinesList[i][9]);
                if (!isNaN(takerBuy)) {
                    sumTakerBuyLast4 += takerBuy;
                }
            }
        }
        let buyRatio2: number | null = null;
        if (sumLast4Vol > 0 && sumTakerBuyLast4 > 0) {
            buyRatio2 = (sumTakerBuyLast4 / sumLast4Vol) * 100;
        }

        return { changePct, ratio1, ratio2, buyRatio1, buyRatio2 };
    };

    const periodKlines = klines.slice(-lookbackDays);
    const highs = periodKlines.map((k: any) => parseFloat(k[2]));
    const lows = periodKlines.map((k: any) => parseFloat(k[3]));
    const closes = periodKlines.map((k: any) => parseFloat(k[4]));

    const enableSideways = scanConfig.majorTrend?.enabled && scanConfig.majorTrend?.enableSideways !== false;
    const sidewaysDays = scanConfig.majorTrend?.sidewaysDays ?? 7;

    let histHighs = highs;
    let histLows = lows;
    if (enableSideways && highs.length > sidewaysDays) {
        const endIdx = Math.max(1, highs.length - sidewaysDays);
        histHighs = highs.slice(0, endIdx);
        histLows = lows.slice(0, endIdx);
    }

    const maxPeriodHigh = histHighs.length > 0 ? Math.max(...histHighs) : currentPrice;
    const minPeriodLow = histLows.length > 0 ? Math.min(...histLows) : currentPrice;

    const safeNum = (v: number) => (isNaN(v) || !isFinite(v)) ? 0 : v;
    
    // Leverage pre-calculated metrics if available to completely bypass rendering overhead
    const hasMetrics = !!extremeMetrics;
    const loadingHistory = hasMetrics ? extremeMetrics.loading : loadingKlines;
    const minPeriodLowVal = hasMetrics ? (extremeMetrics.minPeriodLow ?? currentPrice) : minPeriodLow;
    const maxPeriodHighVal = hasMetrics ? (extremeMetrics.maxPeriodHigh ?? currentPrice) : maxPeriodHigh;

    const maxDeclinePct = hasMetrics ? extremeMetrics.maxDeclinePct : (klines.length > 0 ? safeNum(maxPeriodHighVal > 0 ? ((minPeriodLowVal - maxPeriodHighVal) / maxPeriodHighVal) * 100 : 0) : 0);
    const highToCurrentDeclinePct = safeNum(maxPeriodHighVal > 0 ? ((currentPrice - maxPeriodHighVal) / maxPeriodHighVal) * 100 : 0);
    const maxIncreasePct = hasMetrics ? extremeMetrics.maxIncreasePct : (klines.length > 0 ? safeNum(minPeriodLowVal > 0 ? ((maxPeriodHighVal - minPeriodLowVal) / minPeriodLowVal) * 100 : 0) : 0);
    const lowToCurrentIncreasePct = safeNum(minPeriodLowVal > 0 ? ((currentPrice - minPeriodLowVal) / minPeriodLowVal) * 100 : 0);

    const minLowIdx = histLows.indexOf(minPeriodLow);
    const maxHighIdx = histHighs.indexOf(maxPeriodHigh);
    const lowDaysAgo = hasMetrics ? extremeMetrics.lowDaysAgo : (klines.length > 0 ? (minLowIdx !== -1 ? (periodKlines.length - 1 - minLowIdx) : 0) : 0);
    const highDaysAgo = hasMetrics ? extremeMetrics.highDaysAgo : (klines.length > 0 ? (maxHighIdx !== -1 ? (periodKlines.length - 1 - maxHighIdx) : 0) : 0);

    // Core item metrics have been calculated and are ready for presentation.

    const renderPercent = (val: number | null) => {
        if (val === null) return <span className="text-slate-600 font-bold">--</span>;
        const formatted = val > 0 ? `+${val.toFixed(1)}%` : `${val.toFixed(1)}%`;
        const colorClass = val > 0 ? 'text-emerald-400' : val < 0 ? 'text-red-400' : 'text-slate-400';
        return <span className={`${colorClass} font-extrabold`}>{formatted}</span>;
    };

    const renderRatio = (val: number | null) => {
        if (val === null) return <span className="text-slate-600 font-bold">--</span>;
        const formatted = val.toFixed(2);
        const colorClass = val >= 1.5 ? 'text-amber-400 font-extrabold' : val <= 0.5 ? 'text-slate-500' : 'text-slate-300';
        return <span className={`${colorClass}`}>{formatted}</span>;
    };

    const renderCombinedRatio = (r1: number | null | undefined, r2: number | null | undefined) => {
        if (r1 == null || r2 == null) return <span className="text-slate-600">--</span>;
        const f1 = r1.toFixed(1);
        const f2 = r2.toFixed(1);
        
        const getRatioColor = (val: number) => {
            return val >= 1.5 ? 'text-amber-400 font-extrabold' : val <= 0.5 ? 'text-slate-500' : 'text-slate-300';
        };
        
        return (
            <span className="text-slate-400" title={`量比1 (最后1根K线): ${r1.toFixed(2)} | 量比2 (最后4根平均): ${r2.toFixed(2)}`}>
                <span className={getRatioColor(r1)}>{f1}</span>
                <span className="text-slate-600 font-normal mx-0.5">/</span>
                <span className={getRatioColor(r2)}>{f2}</span>
            </span>
        );
    };

    const renderBuyRatio = (br1: number | null | undefined, br2: number | null | undefined) => {
        if (br1 == null) return <span className="text-slate-600">--</span>;
        const f1 = br1.toFixed(0);
        const f2 = br2 != null ? br2.toFixed(0) : '--';
        
        const getBuyColor = (val: number) => {
            return val >= 53 ? 'text-emerald-400 font-extrabold' : val <= 47 ? 'text-rose-400 font-bold' : 'text-slate-300';
        };

        return (
            <span className="text-slate-400" title={`主动买占比 (最后1根K线: ${br1.toFixed(1)}% | 最后4根K线平均: ${br2 != null ? br2.toFixed(1) : '--'}%)`}>
                <span className={getBuyColor(br1)}>{f1}%</span>
                <span className="text-slate-600 font-normal mx-[1px]">/</span>
                <span className={getBuyColor(br2 != null ? br2 : 50)}>{f2}%</span>
            </span>
        );
    };

    return (
        <div 
            onClick={() => setChartData({ 
                symbol: item.symbol, 
                tf: scanConfig.list1DefaultTf || '1d',
                timeframe: scanConfig.list1DefaultTf || '1d', 
                lookbackDays 
            })}
            className={`bg-slate-800/50 p-1.5 px-2 rounded border text-[11px] group hover:bg-slate-800 transition-colors cursor-pointer relative ${item.isNew ? 'border-indigo-500/50 bg-indigo-900/10' : 'border-slate-700/50'} ${isSmart ? 'border-purple-500/30 shadow-lg shadow-purple-950/10 hover:border-purple-400/50' : ''}`}
        >
            {/* Absolute positioned hover Delete Button */}
            <button 
                onClick={(e) => { 
                    e.stopPropagation(); 
                    onDeleteSymbol(item.symbol); 
                }}
                className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 p-0.5 bg-slate-900/90 hover:bg-red-950/40 rounded border border-slate-800 hover:border-red-500/30 transition-all z-20"
                title="从列表中删除"
            >
                <Trash2 size={10} />
            </button>

            {/* Smart Stats Area */}
            {isSmart && (
                <div className="bg-purple-950/20 rounded p-1 mb-1 border border-purple-500/10 space-y-0.5 animate-in fade-in slide-in-from-top-1">
                    <div className="flex justify-between items-center text-[8px] font-bold">
                        <div className="flex items-center gap-1 text-purple-300">
                            <Brain size={8} />
                            <span>热度: <span className="text-purple-400">{item.heat}%</span></span>
                        </div>
                        <div className="flex items-center gap-1 text-emerald-400 bg-emerald-950/30 px-1 rounded transform scale-90">
                            <TrendingUp size={8} />
                            <span>{item.potential}x 潜力</span>
                        </div>
                    </div>
                    <div className="flex gap-1.5 items-center">
                        <div className="flex-1 h-0.5 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-purple-500" style={{ width: `${item.heat}%` }} />
                        </div>
                        <div className="text-[6px] text-slate-500 font-mono uppercase whitespace-nowrap">{item.sentimentLabel} / {item.whaleSignal}</div>
                    </div>
                    <div className="text-[7px] text-purple-300/80 italic line-clamp-1 leading-tight">{item.potentialReason}</div>
                </div>
            )}

            {/* Premium Horizontal Layout */}
            <div className="flex flex-row items-center justify-between gap-2 font-mono py-1 px-1">
                {/* Basic Info Row */}
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <div className="flex items-center gap-1 shrink-0">
                        {showCheckbox && (
                            <button 
                                onClick={(e) => { e.stopPropagation(); onToggleSymbol(item.symbol); }}
                                className={`${isSmart ? 'text-purple-600 hover:text-purple-400' : 'text-slate-600 hover:text-cyan-400'} transition-colors`}
                            >
                                {isChecked ? <CheckSquare size={11} className={isSmart ? "text-purple-400" : "text-cyan-400"} /> : <Square size={11} />}
                            </button>
                        )}
                        <span className="text-[9px] text-slate-500 font-bold" title={`列表编号: ${idx + 1}`}>{idx + 1}.</span>
                        <span className="text-[9.5px] text-slate-300 font-extrabold" title={`回溯天数: ${lookbackDays}天`}>{lookbackDays}d</span>
                        {item.isNew && <span className="text-[6.5px] bg-indigo-600 text-white px-0.5 rounded font-bold animate-pulse shrink-0">N</span>}
                        {isSmart && <span className="text-[6.5px] bg-purple-600 text-white px-0.5 rounded font-bold shrink-0">S</span>}
                    </div>

                    <div className="text-[11.5px] font-black text-slate-100 shrink-0" title={item.symbol}>
                        {item.symbol.replace('USDT','')}
                    </div>

                    {(() => {
                        const rawChange = item.change !== undefined && item.change !== null ? item.change : (item.change8am !== undefined && item.change8am !== null ? item.change8am : 0);
                        const changeVal = Number(rawChange) || 0;
                        const vol24h = Number(item.volume24h) || 0;
                        const vol8am = item.volume8am !== undefined && item.volume8am !== null ? Number(item.volume8am) : undefined;

                        return (
                            <>
                                <div className={`text-[10.5px] font-extrabold shrink-0 px-1.5 py-0.5 rounded ${changeVal >= 0 ? 'text-emerald-400 bg-emerald-950/40 border border-emerald-500/20' : 'text-rose-400 bg-rose-950/40 border border-rose-500/20'}`}>
                                    {(changeVal >= 0 ? '+' : '') + changeVal.toFixed(2)}%
                                </div>

                                <div className="text-[9px] text-slate-400 font-semibold shrink-0">
                                    24H额: <span className="text-slate-200 font-bold">{vol24h > 0 ? `${vol24h.toFixed(1)}M` : '-'}</span>
                                </div>

                                {vol8am !== undefined && !isNaN(vol8am) && (
                                    <div className="text-[9px] text-slate-400 font-semibold shrink-0 hidden sm:block">
                                        8AM额: <span className="text-blue-400 font-bold">{`${vol8am.toFixed(1)}M`}</span>
                                    </div>
                                )}
                            </>
                        );
                    })()}
                </div>

                {/* Details Switch Button */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        const next = !showDetails;
                        setShowDetails(next);
                        if (next && !isIntervalsFetched) {
                            fetchAllIntervals();
                        }
                    }}
                    className={`px-2 py-1 rounded text-[9px] font-bold border transition-all flex items-center gap-1 shrink-0 ${showDetails ? 'bg-indigo-600 border-indigo-500 text-white shadow' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'}`}
                    title="点击展开/收起极值信息与多周期K线数据大图面板"
                >
                    <span>{showDetails ? '收起详情' : '详情'}</span>
                </button>
            </div>

            {showDetails && (
                <div className="flex flex-row justify-between items-stretch gap-1.5 font-mono mt-1.5 pt-1.5 border-t border-slate-800 animate-in fade-in duration-200">
                    {/* Column 2: Extreme Audit Stats (极值审计) */}
                    <div className="flex flex-col gap-[1px] text-[10px] shrink-0 min-w-[110px] max-w-[114px] pr-1 border-r border-slate-800/80 pl-1 justify-center">
                        <div className="flex justify-between items-center gap-0.5">
                            <span className="text-slate-500 font-bold">极低点时间</span>
                            <span className="text-cyan-400 font-extrabold">
                                {loadingHistory ? '...' : `${lowDaysAgo}d`}
                            </span>
                        </div>
                        <div className="flex justify-between items-center gap-0.5">
                            <span className="text-slate-500 font-bold">极高点时间</span>
                            <span className="text-pink-400 font-extrabold">
                                {loadingHistory ? '...' : `${highDaysAgo}d`}
                            </span>
                        </div>
                        <div className="flex justify-between items-center gap-0.5">
                            <span className="text-slate-500 font-bold">极值最大跌幅</span>
                            <span className="text-red-400 font-extrabold">
                                {loadingHistory ? '...' : `${maxDeclinePct.toFixed(1)}%`}
                            </span>
                        </div>
                        <div className="flex justify-between items-center gap-0.5">
                            <span className="text-slate-500 font-bold">极值当前涨幅</span>
                            <span className="text-emerald-400 font-extrabold">
                                {loadingHistory ? '...' : `+${lowToCurrentIncreasePct.toFixed(1)}%`}
                            </span>
                        </div>
                        <div className="flex justify-between items-center gap-0.5">
                            <span className="text-slate-500 font-bold">极值最大涨幅</span>
                            <span className="text-emerald-400 font-extrabold">
                                {loadingHistory ? '...' : `+${maxIncreasePct.toFixed(1)}%`}
                            </span>
                        </div>
                        <div className="flex justify-between items-center gap-0.5">
                            <span className="text-slate-500 font-bold">极值当前跌幅</span>
                            <span className="text-rose-400 font-extrabold">
                                {loadingHistory ? '...' : `${highToCurrentDeclinePct.toFixed(1)}%`}
                            </span>
                        </div>
                    </div>

                    {/* Column 3: Multi-interval Stats & Volume Ratios */}
                    <div className="flex-1 flex flex-col gap-[1px] text-[10px] font-mono justify-center pl-1">
                        {/* Header */}
                        <div className="flex justify-between items-center gap-0.5 text-[8.5px] text-slate-500 font-black border-b border-slate-800 pb-0.5 mb-[1px]">
                            <span className="w-[24px]">周期</span>
                            <span className="w-[32px] text-right">涨跌</span>
                            <span className="w-[38px] text-right" title="量比1 (最后1根) / 量比2 (最后4根平均)">量1/2</span>
                            <span className="w-[44px] text-right" title="买单成交占比 (最后1根 / 最后4根平均)">买%</span>
                        </div>
                        
                        {/* Rows or Load Button */}
                        {!isIntervalsFetched ? (
                            <div className="flex flex-col items-center justify-center py-3 text-center">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        fetchAllIntervals();
                                    }}
                                    className="px-2 py-1 bg-indigo-600/30 hover:bg-indigo-600 text-indigo-300 hover:text-white rounded text-[9px] font-bold border border-indigo-500/30 transition-all flex items-center gap-1 shadow"
                                    title="点击手动按需计算该币种的 1h/4h/24h/72h/168h 多周期数据"
                                >
                                    <Sparkles size={9} />
                                    <span>按需计算多周期</span>
                                </button>
                                <span className="text-[7.5px] text-slate-500 mt-1">默认关闭以节省网络流量</span>
                            </div>
                        ) : (
                            intervalMap.map((cfg) => {
                                const stats = getStatsForInterval(cfg.key);
                                const isLoading = intervalsData[cfg.key]?.loading;

                                return (
                                    <div key={cfg.key} className="flex justify-between items-center gap-0.5 py-[1px] hover:bg-slate-800/30 rounded px-0.5">
                                        <span className="w-[24px] text-slate-400 font-bold">{cfg.key}</span>
                                        <span className="w-[32px] text-right">
                                            {isLoading ? (
                                                <span className="text-[8.5px] text-slate-600 animate-pulse">...</span>
                                            ) : (
                                                renderPercent(stats.changePct)
                                            )}
                                        </span>
                                        <span className="w-[38px] text-right font-bold">
                                            {isLoading ? (
                                                <span className="text-[8.5px] text-slate-600 animate-pulse">...</span>
                                            ) : (
                                                renderCombinedRatio(stats.ratio1, stats.ratio2)
                                            )}
                                        </span>
                                        <span className="w-[44px] text-right font-bold">
                                            {isLoading ? (
                                                <span className="text-[8.5px] text-slate-600 animate-pulse">...</span>
                                            ) : (
                                                renderBuyRatio(stats.buyRatio1, stats.buyRatio2)
                                            )}
                                        </span>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}

            {downloadProgress !== undefined && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-700 overflow-hidden rounded-b">
                    <div className="h-full bg-amber-500 transition-all duration-300" style={{ width: `${downloadProgress}%` }} />
                </div>
            )}
        </div>
    );
};
