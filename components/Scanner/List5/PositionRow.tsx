
import React from 'react';
import { Position, PositionSide } from '../../../types';
import { Activity, Trash2, Clock } from 'lucide-react';

interface Props {
    position: Position;
    realPrice: number;
    setChartData: (data: { symbol: string, tf: string, signals?: { time: number, type: 'LONG' | 'SHORT' }[], entryPrice?: number, entryTime?: number, currentPrice?: number } | null) => void;
    onClosePosition: (symbol: string, side: PositionSide) => void;
    auditStatus?: {
        label: string;
        color: string;
        desc?: string;
    };
    detectedTf?: string; 
}

export const LivePositionRow: React.FC<Props> = ({ position, realPrice, setChartData, onClosePosition, auditStatus, detectedTf = '15m' }) => {
    const isLong = position.side === PositionSide.LONG;
    const currentPrice = realPrice || position.markPrice || position.entryPrice; 
    
    // === FIXED ALGORITHM ===
    // 1. Diff based on Direction
    const diff = isLong ? currentPrice - position.entryPrice : position.entryPrice - currentPrice;
    
    // 2. PnL Value
    const pnl = diff * position.amount;
    
    // 3. PnL % (NO LEVERAGE)
    const leverage = position.leverage || 20;
    let pnlPct = 0;
    if (position.entryPrice > 0) {
        pnlPct = (diff / position.entryPrice) * 100; // Removed * leverage
    }
    if (!isFinite(pnlPct)) pnlPct = 0;

    // Determine Timeframe to show (Signal > Prop > Default)
    const displayTf = position.signalTf || detectedTf;

    return (
        <div className="bg-slate-800/80 p-2 rounded border border-slate-700 relative overflow-hidden group animate-in fade-in">
             <div className={`absolute left-0 top-0 bottom-0 w-1 ${pnl >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
             <div className="flex justify-between items-center mb-1 pl-2">
                 <div className="flex items-center gap-2">
                     <span className="text-xs font-bold text-white">{position.symbol.replace('USDT','')}</span>
                     <span className={`text-[9px] px-1 rounded font-bold ${isLong ? 'bg-emerald-900/30 text-emerald-400' : 'bg-red-900/30 text-red-400'}`}>{isLong ? '多' : '空'}</span>
                     <span className="text-[9px] text-slate-500 font-mono">x{leverage}</span>
                 </div>
                 <div className="flex flex-col items-end">
                     <span className={`text-xs font-mono font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}</span>
                     <span className={`text-[9px] font-mono ${pnlPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{pnlPct.toFixed(2)}%</span>
                 </div>
             </div>
             
             {auditStatus && auditStatus.label.includes("BLOCKED") && (
                 <div className="flex justify-end mb-1 pl-2">
                     <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold border flex items-center gap-1 ${auditStatus.color}`}>
                         {auditStatus.label}
                     </span>
                 </div>
             )}

             <div className="flex justify-between items-center pl-2 mt-1 border-t border-slate-700/50 pt-1">
                 <div className="flex items-center gap-2">
                    <button onClick={() => setChartData({ symbol: position.symbol, tf: displayTf, entryPrice: position.entryPrice, entryTime: position.entryTime, signals: [], currentPrice: currentPrice })} className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white flex items-center gap-1" title="K线">
                        <Activity size={10}/>
                        <span className="text-[9px] font-bold">{displayTf}</span>
                    </button>
                    <span className="text-[8px] text-slate-500 font-mono flex items-center gap-1">
                        <Clock size={8}/>
                        {new Date(position.entryTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </span>
                 </div>
                 <button 
                    onClick={() => onClosePosition(position.symbol, position.side)} 
                    className="flex items-center gap-1 px-1.5 py-0.5 bg-slate-700 hover:bg-red-900/50 text-slate-400 hover:text-red-400 rounded text-[9px] transition-colors"
                 >
                    <Trash2 size={10}/> 平仓
                 </button>
             </div>
        </div>
    );
};
