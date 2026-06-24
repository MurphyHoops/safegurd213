
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
    downloadProgress?: number; // 0-100
    onDownload?: (symbol: string) => void;
}

// Global cache to avoid duplicate API requests for the same token and looking back period
const KLINE_LIMIT_CACHE: Record<string, Record<number, { timestamp: number; klines: any[] }>> = {};

export const List1Item: React.FC<Props> = ({ 
    item, idx, scanConfig, fixedModeView, customSymbolSet, onToggleSymbol, onDeleteSymbol, setChartData,
    mode = 'LIVE', downloadProgress, onDownload
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
        let active = true;
        const fetchHistory = async () => {
            const limit = lookbackDays + 20;
            const now = Date.now();
            
            const symbolCache = KLINE_LIMIT_CACHE[item.symbol] || {};
            const cached = symbolCache[lookbackDays];
            if (cached && now - cached.timestamp < 10 * 60 * 1000) { // 10 minutes cache
                setKlines(cached.klines);
                return;
            }

            setLoadingKlines(true);
            try {
                const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${item.symbol}&interval=1d&limit=${limit}`;
                const res = await fetchWithFallback(url, { timeout: 15000 }, (d) => Array.isArray(d));
                const data = await res.json();
                if (Array.isArray(data) && active) {
                    if (!KLINE_LIMIT_CACHE[item.symbol]) {
                        KLINE_LIMIT_CACHE[item.symbol] = {};
                    }
                    KLINE_LIMIT_CACHE[item.symbol][lookbackDays] = {
                        timestamp: now,
                        klines: data
                    };
                    setKlines(data);
                }
            } catch (err) {
                console.error("Failed to fetch klines for " + item.symbol, err);
            } finally {
                if (active) {
                    setLoadingKlines(false);
                }
            }
        };

        fetchHistory();
        return () => {
            active = false;
        };
    }, [item.symbol, lookbackDays]);

    const periodKlines = klines.slice(-lookbackDays);
    const highs = periodKlines.map((k: any) => parseFloat(k[2]));
    const lows = periodKlines.map((k: any) => parseFloat(k[3]));
    const closes = periodKlines.map((k: any) => parseFloat(k[4]));

    const currentPrice = item.price;
    const maxPeriodHigh = highs.length > 0 ? Math.max(...highs) : currentPrice;
    const minPeriodLow = lows.length > 0 ? Math.min(...lows) : currentPrice;

    const maxDeclinePct = maxPeriodHigh > 0 ? ((minPeriodLow - maxPeriodHigh) / maxPeriodHigh) * 100 : 0;
    const highToCurrentDeclinePct = maxPeriodHigh > 0 ? ((currentPrice - maxPeriodHigh) / maxPeriodHigh) * 100 : 0;
    const maxIncreasePct = minPeriodLow > 0 ? ((maxPeriodHigh - minPeriodLow) / minPeriodLow) * 100 : 0;
    const lowToCurrentIncreasePct = minPeriodLow > 0 ? ((currentPrice - minPeriodLow) / minPeriodLow) * 100 : 0;


    return (
        <div 
            onClick={() => setChartData({ symbol: item.symbol, tf: '15m', signals: [], currentPrice: item.price })}
            className={`bg-slate-800/50 p-1.5 rounded border text-[10px] group hover:bg-slate-800 transition-colors cursor-pointer relative ${item.isNew ? 'border-indigo-500/50 bg-indigo-900/10' : 'border-slate-700/50'} ${isSmart ? 'border-purple-500/30 shadow-lg shadow-purple-950/10 hover:border-purple-400/50' : ''}`}
        >
            <div className="flex justify-between items-center text-[10px] gap-1 font-mono">
                {/* 币名 & Checkbox */}
                <div className="flex items-center gap-1 min-w-[68px] shrink-0">
                    {showCheckbox && (
                        <button 
                            onClick={(e) => { e.stopPropagation(); onToggleSymbol(item.symbol); }}
                            className={`${isSmart ? 'text-purple-600 hover:text-purple-400' : 'text-slate-600 hover:text-cyan-400'} transition-colors`}
                        >
                            {isChecked ? <CheckSquare size={11} className={isSmart ? "text-purple-400" : "text-cyan-400"} /> : <Square size={11} />}
                        </button>
                    )}
                    <span className="text-[11px] font-bold text-slate-100">{item.symbol.replace('USDT','')}</span>
                    {item.isNew && <span className="text-[6px] bg-indigo-600 text-white px-0.5 rounded font-bold animate-pulse">N</span>}
                    {isSmart && <span className="text-[6px] bg-purple-600 text-white px-0.5 rounded font-bold">S</span>}
                </div>

                {/* 交易额 (24h Volume) */}
                <span className="text-slate-450 text-[9.5px] min-w-[45px] text-right shrink-0">
                    {item.volume24h ? `${item.volume24h.toFixed(1)}M` : '-'}
                </span>

                {/* 单价 (Current Price) */}
                <span className="text-slate-300 min-w-[70px] text-right shrink-0">
                    ${item.price.toFixed(item.price < 1 ? (item.price < 0.001 ? 6 : 4) : 2)}
                </span>

                {/* 涨跌幅 & 辅助操作 */}
                <div className="flex items-center gap-1 justify-end min-w-[65px] shrink-0">
                    {mode === 'BACKTEST' && (
                        <button 
                            onClick={(e) => { e.stopPropagation(); onDownload?.(item.symbol); }}
                            className={`p-0.5 rounded transition-all ${downloadProgress !== undefined ? 'text-amber-500' : 'text-slate-500 hover:text-amber-400 opacity-0 group-hover:opacity-100'}`}
                            title="下载历史数据"
                        >
                            {downloadProgress !== undefined ? (
                                <div className="relative w-3.5 h-3.5 flex items-center justify-center">
                                    <Loader2 size={10} className="animate-spin" />
                                    <span className="absolute text-[5px] font-bold">{Math.round(downloadProgress)}</span>
                                </div>
                            ) : <Download size={11} />}
                        </button>
                    )}
                    <span className={`text-[10.5px] font-bold ${changeVal > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {changeVal > 0 ? '+' : ''}{changeVal.toFixed(2)}%
                    </span>
                    <button 
                        onClick={(e) => { 
                            e.stopPropagation(); 
                            onDeleteSymbol(item.symbol); 
                        }}
                        className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 p-0.5 transition-all"
                        title="从列表中删除"
                    >
                        <Trash2 size={11} />
                    </button>
                </div>
            </div>

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

            {/* 极端涨跌指标统计 */}
            <div className="mt-1.5 pt-1.5 border-t border-slate-700/30 space-y-1 text-[11px] text-slate-200">
                <div className="flex items-center justify-between text-[9px] font-mono text-cyan-400 bg-cyan-950/20 px-1 py-0.5 rounded border border-cyan-800/10">
                    <span className="flex items-center gap-1">
                        ⏱️ 回测周期: <span className="font-bold text-cyan-300">{lookbackDays}天</span>
                    </span>
                    {loadingKlines ? (
                        <span className="flex items-center gap-0.5 text-slate-400 scale-90">
                            <Loader2 size={8} className="animate-spin" /> 载入中
                        </span>
                    ) : (
                        <span className="text-cyan-400 font-bold scale-90">📈 统计已就绪</span>
                    )}
                </div>
                
                {/* 跌幅统计 */}
                <div className="grid grid-cols-2 gap-1 bg-red-950/10 p-1 rounded border border-red-900/10">
                    <div className="flex flex-col">
                        <span className="text-slate-450 text-[9px] scale-95 origin-left">期间最大跌幅:</span>
                        <span className="text-red-400 font-bold font-mono text-xs">
                            {loadingKlines && klines.length === 0 ? '加载中...' : `${maxDeclinePct.toFixed(2)}%`}
                        </span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-slate-450 text-[9px] scale-95 origin-left">最高点➔当前跌幅:</span>
                        <span className="text-rose-400 font-bold font-mono text-xs">
                            {loadingKlines && klines.length === 0 ? '加载中...' : `${highToCurrentDeclinePct.toFixed(2)}%`}
                        </span>
                    </div>
                </div>

                {/* 涨幅统计 */}
                <div className="grid grid-cols-2 gap-1 bg-emerald-950/10 p-1 rounded border border-emerald-900/10">
                    <div className="flex flex-col">
                        <span className="text-slate-450 text-[9px] scale-95 origin-left">期间最大涨幅:</span>
                        <span className="text-emerald-400 font-bold font-mono text-xs">
                            {loadingKlines && klines.length === 0 ? '加载中...' : `+${maxIncreasePct.toFixed(2)}%`}
                        </span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-slate-450 text-[9px] scale-95 origin-left">最低点➔当前涨幅:</span>
                        <span className="text-green-400 font-bold font-mono text-xs">
                            {loadingKlines && klines.length === 0 ? '加载中...' : `+${lowToCurrentIncreasePct.toFixed(2)}%`}
                        </span>
                    </div>
                </div>
            </div>


            
            {downloadProgress !== undefined && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-700 overflow-hidden rounded-b">
                    <div className="h-full bg-amber-500 transition-all duration-300" style={{ width: `${downloadProgress}%` }} />
                </div>
            )}
        </div>
    );
};
