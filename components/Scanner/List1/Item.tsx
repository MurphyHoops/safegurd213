
import React from 'react';
import { Zap, CheckSquare, Square } from 'lucide-react';
import { ScannerItem, ScanConfig } from '../scannerTypes';

interface Props {
    item: ScannerItem;
    idx: number;
    scanConfig: ScanConfig;
    fixedModeView: 'MONITOR' | 'SEARCH';
    customSymbolSet: Set<string>;
    onToggleSymbol: (symbol: string) => void;
}

export const List1Item: React.FC<Props> = ({ item, idx, scanConfig, fixedModeView, customSymbolSet, onToggleSymbol }) => {
    const isChecked = customSymbolSet.has(item.symbol.replace('USDT', ''));
    const showCheckbox = scanConfig.useCustomOnly && fixedModeView === 'SEARCH';
    const changeVal = item.change8am || 0; // Safe Fallback
    
    return (
        <div className={`bg-slate-800/50 p-2 rounded border text-[10px] group hover:bg-slate-800 transition-colors ${item.isNew ? 'border-indigo-500/50 bg-indigo-900/10' : 'border-slate-700/50'}`}>
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
                <span className={`text-sm font-mono font-bold ${changeVal > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{changeVal > 0 ? '+' : ''}{changeVal.toFixed(2)}%</span>
            </div>
            <div className="flex justify-between items-center text-[10px] font-mono text-slate-500"><span>量: {item.volume24h?.toFixed(1)}M</span><span>{item.price.toFixed(8)}</span></div>
        </div>
    );
};
