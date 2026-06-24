
import React from 'react';
import { ScannerItem, List3SignalResult } from '../../../components/Scanner/scannerTypes';
import { PositionSide } from '../../../types';
import { AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';

interface Props {
    item: ScannerItem;
    results?: List3SignalResult[]; // Optional prop for filtered results
    setChartData: (data: any) => void;
    executeTradeSafe: (symbol: string, side: PositionSide, price: number, reason: string, signalTf?: string, signalCandle?: any, entryEmas?: any) => void;
    onRemove: () => void;
}

export const List3Item: React.FC<Props> = ({ item, results, setChartData, executeTradeSafe, onRemove }) => {
    // Use passed results if available, otherwise fall back to item.list3Results
    const signals = results || item.list3Results || [];
    
    if (signals.length === 0) return null; // Should not render if empty

    const isLongDominant = signals.some(r => r.direction === 'LONG');
    const isShortDominant = signals.some(r => r.direction === 'SHORT');
    const borderColor = isLongDominant && isShortDominant ? 'border-indigo-500/20' : isLongDominant ? 'border-emerald-500/20' : 'border-red-500/20';
    const hoverColor = isLongDominant && isShortDominant ? 'hover:border-indigo-500/40' : isLongDominant ? 'hover:border-emerald-500/40' : 'hover:border-red-500/40';

    const handleRowClick = () => {
        if (signals.length > 0) {
            const res = signals[0];
            setChartData({ 
                symbol: item.symbol, 
                tf: res.tf, 
                signals: res.structure.signalTime ? [{ time: res.structure.signalTime, type: res.direction }] : [],
                currentPrice: item.price
            });
        }
    };

    return (
        <div onClick={handleRowClick} className={`bg-slate-800/50 p-2 rounded border text-[10px] cursor-pointer hover:bg-slate-800 transition-colors group relative ${borderColor} ${hoverColor}`}>
            {/* Individual Remove Button (Far Right) */}
            <button 
                onClick={(e) => {
                    e.stopPropagation();
                    onRemove();
                }}
                className="absolute top-2 right-2 text-slate-500 hover:text-red-400 transition-all p-1 bg-red-900/10 rounded border border-red-500/10 hover:border-red-500/40 z-20 group-hover:scale-110"
                title="移除审计结果"
            >
                <Trash2 size={12} />
            </button>

            <div className="flex justify-between font-bold text-slate-300 mb-1 border-b border-slate-700/50 pb-1 pr-6">
                <span>{item.symbol.replace('USDT', '')}</span>
                <span className="text-slate-500">{item.price.toFixed(8)}</span>
            </div>
            
            {/* Chip Grid */}
            <div className="flex flex-wrap gap-1.5 mt-1">
                {signals.map((res, rIdx) => {
                    const isL = res.direction === 'LONG';
                    return (
                        <div 
                            key={rIdx} 
                            onClick={(e) => {
                                e.stopPropagation();
                                setChartData({ 
                                    symbol: item.symbol, 
                                    tf: res.tf, 
                                    signals: res.structure.signalTime ? [{ time: res.structure.signalTime, type: res.direction }] : [],
                                    currentPrice: item.price
                                });
                            }}
                            className={`relative overflow-hidden flex flex-col items-center justify-between border rounded cursor-pointer transition-all px-2 py-1 min-w-[36px] ${isL ? 'bg-emerald-900/20 border-emerald-500/30 hover:bg-emerald-900/40' : 'bg-red-900/20 border-red-500/30 hover:bg-red-900/40'}`}
                            title={`RSI: ${res.structure.rsi.toFixed(1)} | Strict: ${res.structure.isStrictTrend ? 'Yes' : 'No'}`}
                        >
                            <div className="text-[9px] font-bold text-white">{res.tf}</div>
                            <div className={`text-[8px] font-bold ${isL ? 'text-emerald-400' : 'text-red-400'}`}>{isL ? '↑' : '↓'}</div>
                            
                            {/* Indicators for Strict/Thrust */}
                            <div className="absolute top-0 right-0 flex gap-0.5">
                                {res.structure.isStrictTrend ? (
                                    <CheckCircle2 size={8} className="text-emerald-500 bg-emerald-900/80 rounded-full" />
                                ) : (
                                    <AlertTriangle size={8} className="text-amber-500 bg-amber-900/80 rounded-full" />
                                )}
                                {res.structure.thrustValid && (
                                    <div className="w-1.5 h-1.5 bg-orange-500 rounded-full shadow-sm" title="Thrust Valid" />
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Execution Buttons (Compact) */}
            <div className="flex gap-1 mt-2">
                {isLongDominant && (
                    <button 
                        onClick={(e) => { 
                            e.stopPropagation(); 
                            const targetTf = signals.find(s => s.direction === 'LONG')?.tf;
                            executeTradeSafe(item.symbol, PositionSide.LONG, item.price, "Manual L3 Long", targetTf); 
                        }}
                        className="flex-1 py-1 bg-emerald-600/80 hover:bg-emerald-500 text-white rounded text-[9px] font-bold"
                    >
                        开多 (Long)
                    </button>
                )}
                {isShortDominant && (
                    <button 
                        onClick={(e) => { 
                            e.stopPropagation(); 
                            const targetTf = signals.find(s => s.direction === 'SHORT')?.tf;
                            executeTradeSafe(item.symbol, PositionSide.SHORT, item.price, "Manual L3 Short", targetTf); 
                        }}
                        className="flex-1 py-1 bg-red-600/80 hover:bg-red-500 text-white rounded text-[9px] font-bold"
                    >
                        开空 (Short)
                    </button>
                )}
            </div>
        </div>
    );
};
