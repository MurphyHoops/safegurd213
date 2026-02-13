
import React, { useMemo, useState, useRef } from 'react';
import { FinanceMonitorProps } from './types';
import { PositionSide } from '../../types';
import { Play, Pause, Trash2, AlertCircle, List } from 'lucide-react';

export const FinanceMonitorModule: React.FC<FinanceMonitorProps> = ({ 
    account, positions, realPrices, isSimulating, 
    onToggleSimulation, onBatchClose, onOpenTradeModal 
}) => {
    const [confirmClear, setConfirmClear] = useState(false);
    const confirmTimeoutRef = useRef<any>(null);

    // Calculate Real-time PnL & Margin
    const totalPnL = useMemo(() => {
        return positions.reduce((sum, p) => {
            const livePrice = realPrices[p.symbol] || p.markPrice;
            const diff = p.side === PositionSide.LONG ? livePrice - p.entryPrice : p.entryPrice - livePrice;
            return sum + (diff * p.amount);
        }, 0);
    }, [positions, realPrices]);
    
    const walletBalance = account.marginBalance; 
    const equity = walletBalance + totalPnL;   
    const usedMargin = positions.reduce((sum, p) => (p.amount * p.entryPrice) / p.leverage, 0);
    const realAvailableMargin = Math.max(0, equity - usedMargin);
    const calculatedMarginRatio = walletBalance > 0 ? (realAvailableMargin / walletBalance * 100) : 0;
    const totalPnLPercentage = walletBalance > 0 ? (totalPnL / walletBalance) * 100 : 0;
    const totalDebt = positions.reduce((s,p)=>s+(p.cumulativeHedgeLoss||0), 0);

    const handleBatchCloseWithConfirm = () => {
        if (!confirmClear) {
            setConfirmClear(true);
            if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
            confirmTimeoutRef.current = setTimeout(() => setConfirmClear(false), 3000);
        } else {
            onBatchClose();
            setConfirmClear(false);
            if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
        }
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 shrink-0">
            {/* Finance Stats Panel */}
            <div className="md:col-span-4 bg-[#0b0e11] rounded border border-slate-800 p-2 shadow-inner">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div className="flex flex-col justify-center pl-3">
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">可用保证金 / 钱包余额</span>
                        <div className="flex items-baseline gap-1">
                            <span className="text-xl font-mono text-slate-100 font-bold">{realAvailableMargin.toFixed(0)}</span>
                            <span className="text-slate-700 mx-1">/</span>
                            <span className="text-lg font-mono text-slate-400">{walletBalance.toFixed(0)}</span>
                            <span className="text-[10px] text-slate-600 ml-1">U</span>
                        </div>
                    </div>
                    <div className="flex flex-col justify-center pl-3 border-l border-slate-800/50">
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">账户健康度 / 浮动盈亏</span>
                        <div className="flex items-baseline gap-1">
                            <span className={`text-lg font-mono font-bold ${calculatedMarginRatio >= 50 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                {calculatedMarginRatio.toFixed(1)}%
                            </span>
                            <span className="text-slate-700 mx-1">/</span>
                            <div className={`flex items-baseline gap-1 text-sm font-mono ${totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                <span>{totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(0)}</span>
                                <span className="text-[9px] opacity-70">({totalPnLPercentage.toFixed(1)}%)</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-col justify-center pl-3 border-l border-slate-800/50">
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">活动仓位 / 币种数</span>
                        <div className="flex items-baseline gap-2">
                            <span className="text-lg font-mono text-white font-bold">{positions.length}</span>
                            <span className="text-[10px] text-slate-600 font-bold tracking-widest uppercase">POSITIONS</span>
                        </div>
                    </div>
                    <div className="flex flex-col justify-center pl-3 border-l border-slate-800/50">
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">债务总额 (Hedge Debt)</span>
                        <div className="flex items-baseline gap-1">
                            <span className="text-lg font-mono text-red-500 font-bold">-{totalDebt.toFixed(0)}</span>
                            <span className="text-[10px] text-slate-600 ml-1 uppercase">USDT</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Global Actions Panel */}
            <div className="bg-[#0b0e11] p-2 rounded border border-slate-800 flex flex-col justify-center gap-2">
                <div className="flex gap-2">
                    <button onClick={onToggleSimulation} className={`flex-1 py-1.5 rounded text-[10px] font-bold flex items-center justify-center gap-1 transition-all ${isSimulating ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}>
                        {isSimulating ? <Pause size={12}/> : <Play size={12}/>} {isSimulating ? '暂停' : '启动'}
                    </button>
                    <button onClick={handleBatchCloseWithConfirm} className={`flex-1 py-1.5 rounded text-[10px] font-bold transition-all flex items-center justify-center gap-1 border ${confirmClear ? 'bg-red-600 hover:bg-red-700 text-white border-red-400 animate-pulse' : 'bg-slate-800 hover:bg-red-900/50 text-slate-400 border-slate-700'}`}>
                        {confirmClear ? <AlertCircle size={12}/> : <Trash2 size={12}/>} {confirmClear ? '确认?' : '清仓'}
                    </button>
                </div>
                <button onClick={onOpenTradeModal} className="w-full py-1.5 rounded text-[10px] font-bold bg-[#1e2329] hover:bg-[#2b3139] text-slate-300 border border-slate-700 flex items-center justify-center gap-2">
                    <List size={12}/> 交易历史流水 (Trade Logs)
                </button>
            </div>
        </div>
    );
};
