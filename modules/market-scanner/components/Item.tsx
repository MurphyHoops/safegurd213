
import React from 'react';
import { CheckSquare, Square, Trash2, Brain, TrendingUp } from 'lucide-react';
import { ScannerItem, ScanConfig } from '../../../components/Scanner/scannerTypes';
import { getVolume8am } from '../../../services/volume8amService';
import { eventBus } from '../../../core/EventBus';

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
    pushRank?: number;
    symbolList?: string[];
}

export const List1Item: React.FC<Props> = ({ 
    item, idx, scanConfig, fixedModeView, customSymbolSet, onToggleSymbol, onDeleteSymbol, setChartData,
    mode = 'LIVE', extremeMetrics, downloadProgress, onDownload, pushRank, symbolList
}) => {
    if (!item || !item.symbol) return null;
    
    const normSym = item.symbol.toUpperCase().replace(/_LONG$|_SHORT$/i, '').replace(/[\/_]/g, '').replace(/USDT$/i, '').trim();
    const isChecked = customSymbolSet.has(normSym);
    const showCheckbox = true; // Always allow rapid toggling to/from Watchlist (M1 -> Watchlist transfer)
    const isSmart = mode === 'SMART' && item.smartScore !== undefined;
    const lookbackDays = scanConfig.majorTrend?.lookbackDays || 300;
    const isShortMode = scanConfig.instantOpenDirection === 'SHORT';

    const cached8am = getVolume8am(item.symbol) || getVolume8am(`${normSym}USDT`);
    const vol24h = Number(item.volume24h) || (Number(item.quoteVolume) ? Number(item.quoteVolume) / 1000000 : 0);
    const vol8am = item.volume8am !== undefined && item.volume8am !== null ? Number(item.volume8am) : cached8am?.volume8am;
    const chg8am = item.change8am !== undefined && item.change8am !== null ? Number(item.change8am) : cached8am?.change8am;
    const chg24h = item.change !== undefined && item.change !== null ? Number(item.change) : 0;

    // 解析当前价格及 24H / 8AM 极值价格，计算 24H8AM 最低/高到当前的涨跌幅
    let rawLow24 = Number(item.lowPrice || (item as any).low || 0);
    let rawHigh24 = Number(item.highPrice || (item as any).high || 0);
    let rawLastPrice = Number(item.price || cached8am?.lastPrice || 0);
    if ((rawLow24 <= 0 || rawHigh24 <= 0 || rawLastPrice <= 0) && typeof window !== 'undefined' && Array.isArray((window as any).__SCANNER_RAW_DATA_MEM__)) {
        const rawArr = (window as any).__SCANNER_RAW_DATA_MEM__;
        const matchedRaw = rawArr.find((d: any) => d && (d.symbol === `${normSym}USDT` || d.symbol === item.symbol || d.symbol === normSym));
        if (matchedRaw) {
            if (rawLow24 <= 0) rawLow24 = parseFloat(matchedRaw.lowPrice || '0') || 0;
            if (rawHigh24 <= 0) rawHigh24 = parseFloat(matchedRaw.highPrice || '0') || 0;
            if (rawLastPrice <= 0) rawLastPrice = parseFloat(matchedRaw.lastPrice || '0') || 0;
        }
    }

    const low8am = Number((item as any).lowPrice8am || cached8am?.lowPrice || 0);
    const high8am = Number((item as any).highPrice8am || cached8am?.highPrice || 0);

    // 做多：最低点到当前的涨幅 (+)；做空：最高点到当前的跌幅 (-)
    const ext24hPct: number | null = isShortMode
        ? (rawHigh24 > 0 && rawLastPrice > 0 ? -Math.max(0, ((rawHigh24 - rawLastPrice) / rawHigh24) * 100) : null)
        : (rawLow24 > 0 && rawLastPrice > 0 ? Math.max(0, ((rawLastPrice - rawLow24) / rawLow24) * 100) : null);

    const ext8amPct: number | null = isShortMode
        ? (high8am > 0 && rawLastPrice > 0 ? -Math.max(0, ((high8am - rawLastPrice) / high8am) * 100) : null)
        : (low8am > 0 && rawLastPrice > 0 ? Math.max(0, ((rawLastPrice - low8am) / low8am) * 100) : null);

    const displayCoin6 = normSym.slice(0, 6);

    return (
        <div 
            onClick={() => setChartData({ 
                symbol: item.symbol, 
                tf: scanConfig.list1DefaultTf || '1d',
                timeframe: scanConfig.list1DefaultTf || '1d', 
                lookbackDays,
                symbolList: symbolList || undefined,
                symbolIndex: idx,
                source: 'list1'
            })}
            onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                eventBus.emit('OPEN_COIN_CONTEXT_MENU', {
                    x: e.clientX,
                    y: e.clientY,
                    symbol: item.symbol,
                    direction: item.direction || 'LONG',
                    currentPrice: item.price
                });
            }}
            className={`crypto-virtual-card flex items-center flex-nowrap whitespace-nowrap gap-0.5 font-mono text-[10px] bg-slate-800/50 py-1 px-1 rounded border group hover:bg-slate-800 transition-colors cursor-pointer relative shrink-0 overflow-hidden ${item.isNew ? 'border-indigo-500/50 bg-indigo-900/10' : 'border-slate-700/50'} ${isSmart ? 'border-purple-500/30 shadow-lg shadow-purple-950/10 hover:border-purple-400/50' : ''}`}
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

            {/* Col 1: Checkbox + Index number (w-[26px] matching header #) */}
            <div className="w-[26px] shrink-0 flex items-center gap-0.5">
                {showCheckbox && (
                    <button 
                        onClick={(e) => { e.stopPropagation(); onToggleSymbol(item.symbol); }}
                        className={`${isSmart ? 'text-purple-600 hover:text-purple-400' : 'text-slate-600 hover:text-cyan-400'} transition-colors shrink-0 p-0`}
                    >
                        {isChecked ? <CheckSquare size={9.5} className={isSmart ? "text-purple-400" : "text-cyan-400"} /> : <Square size={9.5} />}
                    </button>
                )}
                <span className="text-[8px] text-slate-500 font-bold font-mono shrink-0 text-left leading-none" title={`列表编号: ${idx + 1}`}>
                    {idx + 1}.
                </span>
            </div>

            {/* Col 2: Symbol Name reserved 6 chars (w-[42px] matching header 币种) */}
            <div className="w-[42px] shrink-0 flex items-center gap-0.5 overflow-hidden" title={ pushRank ? `${normSym} (推送排名 #${pushRank})` : normSym }>
                <span className="font-black text-[10px] text-slate-100 tracking-tighter truncate leading-none">
                    {displayCoin6}
                </span>
                {pushRank !== undefined && pushRank > 0 && (
                    <span 
                        className="text-[6.5px] bg-amber-500/20 text-amber-300 border border-amber-500/50 px-0.5 rounded font-mono font-bold shrink-0 leading-none"
                        title={`Top N截取: 第 ${pushRank} 名推入列表2`}
                    >
                        #{pushRank}
                    </span>
                )}
            </div>

            {/* Col 3: 第一组 24H (涨跌/额) - 组内斜线左右靠拢，组间留白 */}
            <div className="w-[74px] shrink-0 flex items-center justify-center gap-[1.5px]">
                <span 
                    className={`px-1 py-0.5 text-center font-extrabold text-[9px] rounded border inline-block tabular-nums shrink-0 leading-none tracking-tight ${chg24h >= 0 ? 'text-emerald-400 bg-emerald-950/40 border-emerald-500/20' : 'text-rose-400 bg-rose-950/40 border-rose-500/20'}`}
                    title={`24小时: 涨跌幅 ${(chg24h >= 0 ? '+' : '') + chg24h.toFixed(2)}% / 成交额 ${vol24h > 0 ? `${vol24h.toFixed(1)}M` : '-'} USDT`}
                >
                    {(chg24h >= 0 ? '+' : '') + chg24h.toFixed(1)}%
                </span>
                <span className="text-slate-500 font-bold shrink-0 text-[8.5px] leading-none">/</span>
                <span className="text-left text-[9px] text-slate-200 font-bold tabular-nums shrink-0 leading-none tracking-tight" title="24小时成交额">
                    {vol24h > 0 ? `${vol24h >= 100 ? vol24h.toFixed(0) : vol24h.toFixed(1)}M` : '-'}
                </span>
            </div>

            <span className="w-[10px] text-center text-slate-700/80 font-normal shrink-0 text-[8.5px] select-none">|</span>

            {/* Col 4: 第二组 8AM (涨跌/额) - 组内斜线左右靠拢，组间留白 */}
            <div className="w-[74px] shrink-0 flex items-center justify-center gap-[1.5px]">
                <span 
                    className={`px-1 py-0.5 text-center font-extrabold text-[9px] rounded border inline-block tabular-nums shrink-0 leading-none tracking-tight ${
                        chg8am !== undefined && !isNaN(chg8am) 
                            ? (chg8am >= 0 ? 'text-emerald-400 bg-emerald-950/40 border-emerald-500/20' : 'text-rose-400 bg-rose-950/40 border-rose-500/20')
                            : 'text-slate-500 bg-slate-900 border-slate-800'
                    }`}
                    title={`今早8点起: 涨跌幅 ${chg8am !== undefined && !isNaN(chg8am) ? `${chg8am >= 0 ? '+' : ''}${chg8am.toFixed(2)}%` : '计算中...'} / 成交额 ${vol8am !== undefined && !isNaN(vol8am) ? `${vol8am.toFixed(1)}M` : '计算中...'} USDT`}
                >
                    {chg8am !== undefined && !isNaN(chg8am) 
                        ? `${chg8am >= 0 ? '+' : ''}${chg8am.toFixed(1)}%` 
                        : '--'}
                </span>
                <span className="text-slate-500 font-bold shrink-0 text-[8.5px] leading-none">/</span>
                <span className="text-left text-[9px] text-blue-300/95 font-bold tabular-nums shrink-0 leading-none tracking-tight" title="今早8点起成交额">
                    {vol8am !== undefined && !isNaN(vol8am) ? `${vol8am >= 100 ? vol8am.toFixed(0) : vol8am.toFixed(1)}M` : '--'}
                </span>
            </div>

            <span className="w-[10px] text-center text-slate-700/80 font-normal shrink-0 text-[8.5px] select-none">|</span>

            {/* Col 5: 第三组 24H8AM最低/高到当前的涨跌幅 - 组内斜线左右靠拢，消除两端拉伸 */}
            <div 
                className="flex-1 min-w-[84px] shrink-0 flex items-center justify-center gap-[2px]"
                title={
                    isShortMode
                        ? `24H最高点到当前跌幅: ${ext24hPct !== null ? `${ext24hPct.toFixed(2)}%` : '--'} / 8AM最高点到当前跌幅: ${ext8amPct !== null ? `${ext8amPct.toFixed(2)}%` : '--'}`
                        : `24H最低点到当前涨幅: ${ext24hPct !== null ? `+${ext24hPct.toFixed(2)}%` : '--'} / 8AM最低点到当前涨幅: ${ext8amPct !== null ? `+${ext8amPct.toFixed(2)}%` : '--'}`
                }
            >
                <span 
                    className={`px-1 py-0.5 text-center font-extrabold text-[9px] rounded border inline-block tabular-nums shrink-0 leading-none tracking-tight ${
                        ext24hPct !== null && !isNaN(ext24hPct)
                            ? (isShortMode ? 'text-rose-400 bg-rose-950/40 border-rose-500/20' : 'text-emerald-400 bg-emerald-950/40 border-emerald-500/20')
                            : 'text-slate-500 bg-slate-900 border-slate-800'
                    }`}
                >
                    {ext24hPct !== null && !isNaN(ext24hPct)
                        ? `${ext24hPct >= 0 && !isShortMode ? '+' : ''}${ext24hPct.toFixed(1)}%`
                        : '--'}
                </span>
                <span className="text-slate-500 font-bold shrink-0 text-[8.5px] leading-none">/</span>
                <span 
                    className={`px-1 py-0.5 text-center font-extrabold text-[9px] rounded border inline-block tabular-nums shrink-0 leading-none tracking-tight ${
                        ext8amPct !== null && !isNaN(ext8amPct)
                            ? (isShortMode ? 'text-rose-300 bg-rose-950/30 border-rose-500/20' : 'text-teal-300 bg-teal-950/40 border-teal-500/20')
                            : 'text-slate-500 bg-slate-900 border-slate-800'
                    }`}
                >
                    {ext8amPct !== null && !isNaN(ext8amPct)
                        ? `${ext8amPct >= 0 && !isShortMode ? '+' : ''}${ext8amPct.toFixed(1)}%`
                        : '--'}
                </span>
            </div>

            {downloadProgress !== undefined && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-700 overflow-hidden rounded-b">
                    <div className="h-full bg-amber-500 transition-all duration-300" style={{ width: `${downloadProgress}%` }} />
                </div>
            )}
        </div>
    );
};
