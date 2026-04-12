
import React from 'react';
import { Zap, CheckSquare, Square, Trash2, Download, Loader2 } from 'lucide-react';
import { ScannerItem, ScanConfig } from '../scannerTypes';

interface Props {
    item: ScannerItem;
    idx: number;
    scanConfig: ScanConfig;
    fixedModeView: 'MONITOR' | 'SEARCH';
    customSymbolSet: Set<string>;
    onToggleSymbol: (symbol: string) => void;
    onDeleteSymbol: (symbol: string) => void;
    setChartData: (data: any) => void;
    mode?: 'LIVE' | 'BACKTEST';
    downloadProgress?: number; // 0-100
    onDownload?: (symbol: string) => void;
}

export const List1Item: React.FC<Props> = ({ 
    item, idx, scanConfig, fixedModeView, customSymbolSet, onToggleSymbol, onDeleteSymbol, setChartData,
    mode = 'LIVE', downloadProgress, onDownload
}) => {
    if (!item || !item.symbol) return null;
    
    const isChecked = customSymbolSet.has(item.symbol.replace('USDT', ''));
    const showCheckbox = scanConfig.useCustomOnly && fixedModeView === 'SEARCH';
    const changeVal = item.change8am || 0; // Safe Fallback
    
    return (
        <div 
            onClick={() => setChartData({ symbol: item.symbol, tf: '15m', signals: [], currentPrice: item.price })}
            className={`bg-slate-800/50 p-2 rounded border text-[10px] group hover:bg-slate-800 transition-colors cursor-pointer relative ${item.isNew ? 'border-indigo-500/50 bg-indigo-900/10' : 'border-slate-700/50'}`}
        >
            <div className="flex justify-between items-center mb-1">
                <div className="flex items-center gap-2">
                    {showCheckbox && (
                        <button 
                            onClick={(e) => { e.stopPropagation(); onToggleSymbol(item.symbol); }}
                            className="text-slate-600 hover:text-cyan-400 transition-colors"
                        >
                            {isChecked ? <CheckSquare size={14} className="text-cyan-400" /> : <Square size={14} />}
                        </button>
                    )}
                    <span className="text-sm font-bold text-slate-200">{item.symbol.replace('USDT','')}</span>
                    {item.isNew && <span className="text-[8px] bg-indigo-600 text-white px-1 rounded animate-pulse font-bold flex items-center gap-0.5"><Zap size={8} fill="currentColor"/> NEW</span>}
                </div>
                <div className="flex items-center gap-2">
                    {mode === 'BACKTEST' && (
                        <button 
                            onClick={(e) => { e.stopPropagation(); onDownload?.(item.symbol); }}
                            className={`p-1 rounded transition-all ${downloadProgress !== undefined ? 'text-amber-500' : 'text-slate-500 hover:text-amber-400 opacity-0 group-hover:opacity-100'}`}
                            title="下载历史数据"
                        >
                            {downloadProgress !== undefined ? (
                                <div className="relative w-4 h-4 flex items-center justify-center">
                                    <Loader2 size={12} className="animate-spin" />
                                    <span className="absolute text-[6px] font-bold">{Math.round(downloadProgress)}</span>
                                </div>
                            ) : <Download size={14} />}
                        </button>
                    )}
                    <span className={`text-sm font-mono font-bold ${changeVal > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{changeVal > 0 ? '+' : ''}{changeVal.toFixed(2)}%</span>
                    <button 
                        onClick={(e) => { 
                            e.stopPropagation(); 
                            onDeleteSymbol(item.symbol); 
                        }}
                        className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 p-1 transition-all"
                        title="从列表中删除"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>
            <div className="flex justify-between items-center text-[10px] font-mono text-slate-500">
                <span>量: {item.volume24h?.toFixed(1)}M</span>
                <span>{item.price.toFixed(8)}</span>
            </div>
            {downloadProgress !== undefined && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-700 overflow-hidden rounded-b">
                    <div className="h-full bg-amber-500 transition-all duration-300" style={{ width: `${downloadProgress}%` }} />
                </div>
            )}
        </div>
    );
};
