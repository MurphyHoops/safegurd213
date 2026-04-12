
import React, { useMemo, useState, useRef } from 'react';
import { FinanceMonitorProps } from './types';
import { PositionSide } from '../../types';
import { Play, Pause, Trash2, AlertCircle, List } from 'lucide-react';

export const FinanceMonitorModule: React.FC<FinanceMonitorProps> = ({ 
    account, positions, realPrices, isSimulating, 
    onToggleSimulation, onBatchClose, onOpenTradeModal, onResetBalance, networkStatus 
}) => {
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
    const usedMargin = positions.reduce((sum, p) => sum + (p.amount * p.entryPrice), 0);
    const realAvailableMargin = Math.max(0, equity - usedMargin);
    const calculatedMarginRatio = walletBalance > 0 ? (realAvailableMargin / walletBalance * 100) : 0;
    const totalPnLPercentage = walletBalance > 0 ? (totalPnL / walletBalance) * 100 : 0;
    
    // Calculate position values in U
    const totalPositionValue = positions.reduce((sum, p) => sum + (p.amount * p.entryPrice), 0);
    const longValue = positions.filter(p => p.side === PositionSide.LONG).reduce((sum, p) => sum + (p.amount * p.entryPrice), 0);
    const shortValue = positions.filter(p => p.side === PositionSide.SHORT).reduce((sum, p) => sum + (p.amount * p.entryPrice), 0);
    
    // Calculate total hedge SL amount in U
    const totalHedgeSLAmount = positions.reduce((s,p)=>s+(p.cumulativeHedgeLoss||0), 0);

    return (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 shrink-0">
            {/* Finance Stats Panel */}
            <div className="md:col-span-4 bg-[#0b0e11] rounded border border-slate-800 p-2 shadow-inner">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div className="flex flex-col justify-center pl-3">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">可用保证金 / 钱包余额</span>
                            {onResetBalance && (
                                <button 
                                    onClick={() => onResetBalance(10000)}
                                    className="text-[9px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded border border-slate-700 transition-colors"
                                    title="恢复钱包余额为 10000"
                                >
                                    恢复10000
                                </button>
                            )}
                        </div>
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
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">总持仓 / 多单 / 空单 (U)</span>
                        <div className="flex items-baseline gap-1">
                            <span className="text-lg font-mono text-white font-bold">{totalPositionValue.toFixed(0)}</span>
                            <span className="text-slate-700 mx-1">/</span>
                            <span className="text-lg font-mono text-emerald-400 font-bold">{longValue.toFixed(0)}</span>
                            <span className="text-slate-700 mx-1">/</span>
                            <span className="text-lg font-mono text-red-400 font-bold">{shortValue.toFixed(0)}</span>
                        </div>
                    </div>
                    <div className="flex flex-col justify-center pl-3 border-l border-slate-800/50">
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">负债总数 (Hedge SL)</span>
                        <div className="flex items-baseline gap-1">
                            <span className="text-lg font-mono text-amber-500 font-bold">{totalHedgeSLAmount.toFixed(2)}</span>
                            <span className="text-[10px] text-slate-600 ml-1 uppercase">U</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Global Actions Panel */}
            <div className="bg-[#0b0e11] p-2 rounded border border-slate-800 flex flex-col justify-between gap-2">
                <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">网络状态</span>
                    <div className="flex items-center gap-1">
                        <div className={`w-2 h-2 rounded-full ${
                            networkStatus === 'healthy' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' :
                            networkStatus === 'delayed' ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)] animate-pulse' :
                            'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)] animate-pulse'
                        }`} />
                        <span className="text-[10px] font-mono font-medium text-slate-300">
                            {networkStatus === 'healthy' ? '正常' :
                             networkStatus === 'delayed' ? '延迟' :
                             '断开'}
                        </span>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button onClick={onToggleSimulation} className={`flex-1 py-1.5 rounded text-[10px] font-bold flex items-center justify-center gap-1 transition-all ${isSimulating ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}>
                        {isSimulating ? <Pause size={12}/> : <Play size={12}/>} {isSimulating ? '暂停' : '启动'}
                    </button>
                </div>
            </div>
        </div>
    );
};
