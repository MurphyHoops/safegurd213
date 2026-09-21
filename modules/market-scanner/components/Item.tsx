
import React from 'react';
import { CheckSquare, Square, Trash2, Brain, TrendingUp } from 'lucide-react';
import { ScannerItem, ScanConfig } from '../../../components/Scanner/scannerTypes';
import { getVolume8am } from '../../../services/volume8amService';

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
}

export const List1Item: React.FC<Props> = ({ 
    item, idx, scanConfig, fixedModeView, customSymbolSet, onToggleSymbol, onDeleteSymbol, setChartData,
    mode = 'LIVE', extremeMetrics, downloadProgress, onDownload, pushRank
}) => {
    if (!item || !item.symbol) return null;
    
    const isChecked = customSymbolSet.has(item.symbol.replace('USDT', '').toUpperCase());
    const showCheckbox = true; // Always allow rapid toggling to/from Watchlist (M1 -> Watchlist transfer)
    const isSmart = mode === 'SMART' && item.smartScore !== undefined;
    const lookbackDays = scanConfig.majorTrend?.lookbackDays || 300;

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

            {/* Premium Clean Horizontal Layout with strict vertical column alignment */}
            <div className="flex items-center gap-1.5 font-mono py-1 px-1">
                {/* Basic Info Row */}
                <div className="flex items-center gap-1.5 shrink-0">
                    <div className="flex items-center gap-0.5 shrink-0 w-[30px]">
                        {showCheckbox && (
                            <button 
                                onClick={(e) => { e.stopPropagation(); onToggleSymbol(item.symbol); }}
                                className={`${isSmart ? 'text-purple-600 hover:text-purple-400' : 'text-slate-600 hover:text-cyan-400'} transition-colors shrink-0`}
                            >
                                {isChecked ? <CheckSquare size={10} className={isSmart ? "text-purple-400" : "text-cyan-400"} /> : <Square size={10} />}
                            </button>
                        )}
                        <span className="text-[8.5px] text-slate-500 font-bold font-mono" title={`列表编号: ${idx + 1}`}>{idx + 1}.</span>
                        {item.isNew && <span className="text-[6px] bg-indigo-600 text-white px-0.5 rounded font-bold animate-pulse shrink-0">N</span>}
                        {isSmart && <span className="text-[6px] bg-purple-600 text-white px-0.5 rounded font-bold shrink-0">S</span>}
                    </div>

                    {/* 币名 (已移除中文显示，固定宽度紧靠左侧，保证纵向对齐) */}
                    <div className="w-[52px] shrink-0 font-black text-[11px] text-slate-100 truncate text-left flex items-center gap-1" title={item.symbol}>
                        <span>{item.symbol.replace('USDT','')}</span>
                        {pushRank !== undefined && pushRank > 0 && (
                            <span 
                                className="text-[7.5px] bg-amber-500/20 text-amber-300 border border-amber-500/50 px-0.5 rounded font-mono font-bold shrink-0 tracking-tight"
                                title={`Top N截取: 第 ${pushRank} 名推入列表2`}
                            >
                                #{pushRank}
                            </span>
                        )}
                    </div>

                    {(() => {
                        const cached8am = getVolume8am(item.symbol);
                        const vol24h = Number(item.volume24h) || (Number(item.quoteVolume) ? Number(item.quoteVolume) / 1000000 : 0);
                        const vol8am = item.volume8am !== undefined && item.volume8am !== null ? Number(item.volume8am) : cached8am?.volume8am;
                        const chg8am = item.change8am !== undefined && item.change8am !== null ? Number(item.change8am) : cached8am?.change8am;
                        const chg24h = item.change !== undefined && item.change !== null ? Number(item.change) : 0;

                        return (
                            <div className="flex items-center gap-1 shrink-0 font-mono text-[9.5px]">
                                {/* 前面：24小时数据 (涨跌幅 / 交易额，紧凑纵向对齐) */}
                                <div className="flex items-center gap-0.5 shrink-0 w-[96px]" title={`24小时: 涨跌幅 ${(chg24h >= 0 ? '+' : '') + chg24h.toFixed(2)}% / 成交额 ${vol24h > 0 ? `${vol24h.toFixed(1)}M` : '-'} USDT`}>
                                    <span 
                                        className={`w-[52px] text-center font-extrabold text-[9.5px] px-0.5 py-0.5 rounded border inline-block tabular-nums shrink-0 ${chg24h >= 0 ? 'text-emerald-400 bg-emerald-950/40 border-emerald-500/20' : 'text-rose-400 bg-rose-950/40 border-rose-500/20'}`}
                                    >
                                        {(chg24h >= 0 ? '+' : '') + chg24h.toFixed(1)}%
                                    </span>
                                    <span className="text-slate-600 font-bold shrink-0">/</span>
                                    <span className="w-[38px] text-right text-[9.5px] text-slate-300 font-bold tabular-nums shrink-0">
                                        {vol24h > 0 ? `${vol24h >= 100 ? vol24h.toFixed(0) : vol24h.toFixed(1)}M` : '-'}
                                    </span>
                                </div>

                                <span className="text-slate-700 font-normal shrink-0 px-0.5">|</span>

                                {/* 后面：今早8点起数据 (涨跌幅 / 交易额，紧凑纵向对齐，全部显示完) */}
                                <div className="flex items-center gap-0.5 shrink-0 w-[96px]" title={`今早8点起: 涨跌幅 ${chg8am !== undefined && !isNaN(chg8am) ? `${chg8am >= 0 ? '+' : ''}${chg8am.toFixed(2)}%` : '计算中...'} / 成交额 ${vol8am !== undefined && !isNaN(vol8am) ? `${vol8am.toFixed(1)}M` : '计算中...'} USDT`}>
                                    <span 
                                        className={`w-[52px] text-center font-extrabold text-[9.5px] px-0.5 py-0.5 rounded border inline-block tabular-nums shrink-0 ${
                                            chg8am !== undefined && !isNaN(chg8am) 
                                                ? (chg8am >= 0 ? 'text-emerald-400 bg-emerald-950/40 border-emerald-500/20' : 'text-rose-400 bg-rose-950/40 border-rose-500/20')
                                                : 'text-slate-500 bg-slate-900 border-slate-800'
                                        }`}
                                    >
                                        {chg8am !== undefined && !isNaN(chg8am) 
                                            ? `${chg8am >= 0 ? '+' : ''}${chg8am.toFixed(1)}%` 
                                            : '--'}
                                    </span>
                                    <span className="text-slate-600 font-bold shrink-0">/</span>
                                    <span className="w-[38px] text-right text-[9.5px] text-blue-300/90 font-bold tabular-nums shrink-0">
                                        {vol8am !== undefined && !isNaN(vol8am) ? `${vol8am >= 100 ? vol8am.toFixed(0) : vol8am.toFixed(1)}M` : '--'}
                                    </span>
                                </div>
                            </div>
                        );
                    })()}
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

