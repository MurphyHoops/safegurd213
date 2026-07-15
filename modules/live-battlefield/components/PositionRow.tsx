import React from 'react';
import { Position, PositionSide } from '../../../types';
import { Activity, Trash2, Clock, Target, TrendingUp } from 'lucide-react';
import { RealtimePnlSpan } from '../../../components/RealtimePnlSpan';
import { RealtimePriceSpan } from '../../../components/RealtimePriceSpan';
import { formatPrice } from '../../../services/symbolUtils';

interface Props {
    position: Position;
    realPrice: number;
    setChartData: (data: { 
        symbol: string, 
        tf: string, 
        signals?: { time: number, type: 'LONG' | 'SHORT' }[], 
        entryPrice?: number, 
        entryTime?: number, 
        currentPrice?: number,
        showAuditLines?: boolean
    } | null) => void;
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
    const rawCurrentPrice = realPrice || position.markPrice || position.entryPrice; 
    
    const getStrategyLabel = (id?: string) => {
        if (!id) return null;
        if (id === 'manual') return '手动';
        const num = id.replace('strat-', '');
        if (num && !isNaN(Number(num))) {
            return `选币 ${num}`;
        }
        return id;
    };
    
    // Auto-scale currentPrice to match entryPrice magnitude to prevent giant flash glitches
    let currentPrice = rawCurrentPrice;
    if (position.entryPrice > 0 && rawCurrentPrice > 0) {
        const ratio = rawCurrentPrice / position.entryPrice;
        if (ratio > 500) currentPrice = rawCurrentPrice / 1000;
        else if (ratio < 0.002) currentPrice = rawCurrentPrice * 1000;
    }
    
    // === FIXED ALGORITHM ===
    // 1. Diff based on Direction
    const diff = isLong ? currentPrice - position.entryPrice : position.entryPrice - currentPrice;
    
    // 2. PnL Value
    const pnl = diff * position.amount;
    
    // 3. PnL % (NO LEVERAGE)
    let pnlPct = 0;
    if (position.entryPrice > 0) {
        pnlPct = (diff / position.entryPrice) * 100;
    }
    if (!isFinite(pnlPct)) pnlPct = 0;

    // Determine Timeframe to show (Signal > Prop > Default)
    const tfMatch = (position.signalTf || detectedTf || '15m').match(/(\d+[mhd])/i);
    const rawTf = tfMatch ? tfMatch[1].toLowerCase() : '15m';
    const displayTf = rawTf;

    const handleOpenChart = (e?: React.MouseEvent) => {
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }
        
        setChartData({ 
            symbol: position.symbol, 
            tf: rawTf, // CRITICAL: Use raw TF for Binance API compatibility
            entryPrice: position.entryPrice, 
            entryTime: position.entryTime, 
            signals: [], 
            currentPrice: currentPrice,
            showAuditLines: false
        });
    };

    return (
        <div 
            onClick={(e) => handleOpenChart(e)}
            className="bg-slate-800/80 p-2 rounded border border-slate-700 relative overflow-hidden group animate-in fade-in shrink-0 cursor-pointer hover:border-indigo-500/50 transition-colors"
        >
             <div className={`absolute left-0 top-0 bottom-0 w-1 ${pnl >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
             <div className="flex justify-between items-center mb-1 pl-2">
                 <div className="flex flex-col">
                     <div className="flex items-center gap-2">
                         <span className="text-xs font-bold text-white" title={position.symbol}>{position.symbol || 'UNKNOWN'}</span>
                         <span className={`text-[9px] px-1 rounded font-bold ${isLong ? 'bg-emerald-900/30 text-emerald-400' : 'bg-red-900/30 text-red-400'}`}>{isLong ? '多' : '空'}</span>
                         {position.strategyId && (
                              <span className="text-[8px] px-1.5 rounded font-bold bg-indigo-900/40 text-indigo-400 border border-indigo-500/30">
                                  {getStrategyLabel(position.strategyId)}
                              </span>
                         )}
                         {position.isBacktestRecord && (
                              <span className="text-[8px] px-1 rounded font-bold bg-amber-600/20 text-amber-500 border border-amber-500/30">回测</span>
                         )}
                     </div>
                     <div className="flex items-center gap-2 mt-0.5">
                        <div className="flex items-center gap-0.5 text-[8px] text-slate-400">
                            <Target size={8} className="text-cyan-400 opacity-60"/>
                            <span className="font-mono">{formatPrice(position.entryPrice)}</span>
                        </div>
                        <div className="flex items-center gap-0.5 text-[8px] text-slate-400">
                            <TrendingUp size={8} className="text-indigo-400 opacity-60"/>
                            <RealtimePriceSpan 
                                symbol={position.symbol} 
                                className="font-mono text-slate-300"
                                fallbackPrice={realPrice || position.markPrice}
                            />
                        </div>
                     </div>
                 </div>
                 <div className="flex flex-col items-end">
                     <RealtimePnlSpan 
                         symbol={position.symbol}
                         entryPrice={position.entryPrice}
                         amount={position.amount}
                         side={position.side as any}
                         isPct={false}
                         className={`text-xs font-mono font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                         fallbackValue={pnl}
                     />
                     <RealtimePnlSpan 
                         symbol={position.symbol}
                         entryPrice={position.entryPrice}
                         amount={position.amount}
                         side={position.side as any}
                         isPct={true}
                         className={`text-[9px] font-mono ${pnlPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}
                         fallbackValue={pnlPct}
                     />
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
                    <div 
                        onClick={handleOpenChart}
                        className="p-1 rounded text-slate-400 flex items-center gap-1 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer z-10 relative" 
                        title="点击打开 K 线图"
                    >
                        <Activity size={10}/>
                        <span className="text-[9px] font-bold">{displayTf}</span>
                    </div>
                    <span className="text-[8px] text-slate-500 font-mono flex items-center gap-1">
                        <Clock size={8}/>
                        {new Date(position.isBacktestRecord ? (position.backtestEntryTime || position.entryTime) : position.entryTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </span>
                 </div>
                 <button 
                    onClick={(e) => { e.stopPropagation(); onClosePosition(position.symbol, position.side); }} 
                    className="flex items-center gap-1 px-1.5 py-0.5 bg-slate-700 hover:bg-red-900/50 text-slate-400 hover:text-red-400 rounded text-[9px] transition-colors z-10 relative"
                 >
                    <Trash2 size={10}/> 平仓
                 </button>
             </div>
        </div>
    );
};
