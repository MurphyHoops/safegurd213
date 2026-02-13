
import React from 'react';
import { PositionsListProps } from './types';
import { PositionSide } from '../../types';
import { Shield, Target, Zap, History, BarChart2, BarChart4 } from 'lucide-react';

export const PositionsListModule: React.FC<PositionsListProps> = ({
    positions,
    realPrices,
    walletBalance,
    settings,
    onShowHistory,
    onClosePosition,
    onOpenChart,
    onOpenScanner
}) => {
    
    // Sort logic internal to the presentation module
    const sortedPositions = [...positions].sort((a, b) => b.unrealizedPnL - a.unrealizedPnL);

    if (sortedPositions.length === 0) {
        return (
            <div className="flex-1 overflow-y-auto rounded border border-slate-800 bg-[#0b0e11] flex flex-col items-center justify-center h-48 text-slate-500 animate-in fade-in">
                <BarChart4 size={48} className="mb-4 opacity-20" />
                <p className="text-sm font-bold text-slate-400">暂无持仓</p>
                <p className="text-xs text-slate-600 mt-1">系统待机中，等待信号触发...</p>
                <button onClick={onOpenScanner} className="mt-4 px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full text-xs font-bold transition-all shadow-lg shadow-indigo-900/20 flex items-center gap-2">
                    <BarChart2 size={14}/> 前往全域扫描
                </button>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto rounded border border-slate-800 bg-[#0b0e11] custom-scrollbar">
            {sortedPositions.map((p) => {
                const livePrice = realPrices[p.symbol] || p.markPrice || p.entryPrice;
                const diff = p.side === PositionSide.LONG ? livePrice - p.entryPrice : p.entryPrice - livePrice;
                const currentPnl = diff * p.amount;
                const leverage = p.leverage || 20;
                let currentPnlPct = 0;
                if (p.entryPrice > 0) {
                    currentPnlPct = (diff / p.entryPrice) * 100;
                }
                if (!isFinite(currentPnlPct)) currentPnlPct = 0;
                
                const posMargin = (p.amount * p.entryPrice) / leverage;
                const mPct = (walletBalance > 0 && posMargin > 0) ? (posMargin / walletBalance) * 100 : 0;
                const peak = p.maxPnLPercent || currentPnlPct;
                const cPct = peak > 0 ? peak - currentPnlPct : 0;
                const hasAmmo = (p.cumulativeHedgeProfit || 0) > 0;
                const isHedgedMode = p.isHedged || !!p.mainPositionId;
                const isModule1Active = settings.profit.enabled || settings.profit.stopLoss.enabled;

                return (
                    <div key={`${p.symbol}-${p.side}-${p.entryId}`} className={`flex items-center px-4 py-3 border-b border-slate-800/40 hover:bg-[#1e2329]/50 transition-colors group relative overflow-hidden ${p.isHedged ? 'bg-indigo-900/5' : ''}`}>
                        <div className={`absolute left-0 top-1 bottom-1 w-0.5 rounded-r ${currentPnl >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                        
                        {/* 1. Symbol & Direction */}
                        <div className="w-1/4 md:w-[22%] flex flex-col justify-center">
                            <div className="flex items-center gap-2">
                                <span className="font-black text-sm text-white tracking-tight">{p.symbol.replace('USDT','')}</span>
                                <div className="flex items-center gap-1">
                                    <span className={`text-[9px] px-1.5 rounded-sm font-bold ${p.side === PositionSide.LONG ? 'text-emerald-500 bg-emerald-500/10' : 'text-red-500 bg-red-500/10'}`}>
                                        {p.side === PositionSide.LONG ? '多' : '空'}
                                    </span>
                                    <span className="text-[9px] text-slate-500 bg-slate-800/80 px-1 rounded-sm border border-slate-700 font-mono">{leverage}x</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-1.5 mt-1.5">
                                {isHedgedMode ? (
                                    <div className="flex items-center gap-1 bg-indigo-900/30 text-indigo-300 text-[8px] font-bold px-1.5 py-0.5 rounded-sm border border-indigo-500/30 animate-pulse" title="模块4已接管">
                                        <Shield size={8} fill="currentColor"/>
                                        <span>策略托管中</span>
                                    </div>
                                ) : (
                                    <div className={`flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded-sm border ${isModule1Active ? 'bg-emerald-900/20 text-emerald-400 border-emerald-500/20' : 'bg-slate-800 text-slate-500 border-slate-600'}`}>
                                        <Target size={8} />
                                        <span>{isModule1Active ? '标准风控' : '手动模式'}</span>
                                    </div>
                                )}
                                {hasAmmo && (
                                    <div className="flex items-center gap-1 bg-amber-900/30 text-amber-400 text-[8px] font-bold px-1.5 py-0.5 rounded-sm border border-amber-500/30 animate-pulse">
                                        <Zap size={8} fill="currentColor"/>
                                        <span>子弹: +{(p.cumulativeHedgeProfit || 0).toFixed(1)}U</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 2. Position Size */}
                        <div className="w-1/4 md:w-[15%] text-center">
                            <span className="text-sm font-mono font-bold text-slate-200">{(p.amount * livePrice).toFixed(0)}</span>
                            <span className="text-[10px] text-slate-500 ml-1">U</span>
                        </div>

                        {/* 3. Entry Price & Time (Desktop) */}
                        <div className="hidden md:flex w-[15%] text-center flex-col items-center gap-0 font-mono text-[10px] text-slate-500">
                            <span className="text-slate-300 font-bold">{p.entryPrice.toFixed(4)}</span>
                            <span className="text-[9px] opacity-40">{new Date(p.entryTime || Date.now()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'})}</span>
                        </div>

                        {/* 4. Live Price (Desktop) */}
                        <div className="hidden md:block w-[12%] text-center">
                            <span className={`text-sm font-mono font-bold tabular-nums transition-all ${currentPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {livePrice.toFixed(4)}
                            </span>
                        </div>

                        {/* 5. PnL & Stats */}
                        <div className="w-1/4 md:w-[24%] text-right flex flex-col items-end justify-center pr-2">
                            <div className="flex items-center gap-1.5">
                                <span className={`font-mono text-xs font-bold ${currentPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {currentPnl >= 0 ? '+' : ''}{currentPnl.toFixed(2)}
                                </span>
                                <span className="text-slate-700 text-[10px]">/</span>
                                <span className={`font-mono text-xs font-bold ${currentPnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {currentPnlPct >= 0 ? '+' : ''}{currentPnlPct.toFixed(2)}%
                                </span>
                            </div>
                            <div className="flex items-center gap-2 mt-1 font-mono text-[9px] font-bold">
                                <span className="text-slate-500" title="保证金占比">M:<span className="text-slate-300 ml-0.5">{mPct.toFixed(1)}%</span></span>
                                <span className="text-slate-700">/</span>
                                <span className="text-orange-400" title="当前回撤幅度">C:<span className="ml-0.5">{cPct.toFixed(1)}%</span></span>
                            </div>
                        </div>

                        {/* 6. Actions */}
                        <div className="w-1/4 md:w-[12%] text-right flex flex-col items-end justify-center gap-2">
                            <div className="bg-blue-900/20 border border-blue-500/20 rounded-sm px-1.5 py-0.5 flex items-center gap-1" title="预计强平价格 / 防守线">
                                <span className="text-[8px] text-blue-400 font-bold uppercase">Def:</span>
                                <span className="text-[9px] font-mono text-blue-100">{(p.entryPrice * (p.side === PositionSide.LONG ? 0.99 : 1.01)).toFixed(4)}</span>
                            </div>
                            <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => onShowHistory(p.symbol)} className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors" title="历史记录"><History size={12}/></button>
                                <button onClick={() => onOpenChart(p.symbol)} className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors" title="K线图"><BarChart2 size={12}/></button>
                                <button 
                                    onClick={() => onClosePosition(p.symbol, p.side)} 
                                    className="px-2 py-0.5 bg-slate-800 hover:bg-red-600 text-slate-300 hover:text-white rounded text-[10px] font-bold border border-slate-600 hover:border-red-500 transition-all"
                                >
                                    平仓
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
