import React from 'react';
import { Position, PositionSide } from '../../../types';
import { Shield, Target, Zap, History, BarChart2, Settings, Brain } from 'lucide-react';
import { formatPrice } from '../../../services/symbolUtils';

interface Props {
    p: Position;
    idx: number;
    livePrice: number;
    currentPnl: number;
    currentPnlPct: number;
    showHedgeStats: boolean;
    totalDebt: number;
    isHedgedMode: boolean;
    isModule1Active: boolean;
    hasAmmo: boolean;
    onOpenChart: (symbol: string, price: number, time: number) => void;
    onShowHistory: (symbol: string) => void;
    onClosePosition: (symbol: string, side: PositionSide) => void;
    onOpenSettings?: (position: Position) => void;
}

export const PositionItem: React.FC<Props> = ({
    p, idx, livePrice, currentPnl, currentPnlPct, showHedgeStats, totalDebt, isHedgedMode, isModule1Active, hasAmmo,
    onOpenChart, onShowHistory, onClosePosition, onOpenSettings
}) => {
    const isHedgedActive = p.isHedged || !!p.mainPositionId;

    return (
        <div 
            onClick={() => onOpenChart(p.symbol, p.entryPrice, p.entryTime)}
            className={`flex items-center px-4 py-2 border-b border-slate-800/40 hover:bg-[#1e2329]/50 transition-colors group relative overflow-hidden shrink-0 cursor-pointer ${p.isHedged ? 'bg-indigo-900/5' : ''}`}
        >
            <div className={`absolute left-0 top-1 bottom-1 w-0.5 rounded-r ${currentPnl >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
            
            {/* 1. Symbol, Direction & Tags */}
            <div className="w-[20%] flex items-center gap-2 pr-2">
                <div className="flex items-center gap-1.5 shrink-0">
                    <span className="font-black text-sm text-white tracking-tight">{p.symbol.replace('USDT','')}</span>
                    <span className={`text-[9px] px-1.5 rounded-sm font-bold ${p.side === PositionSide.LONG ? 'text-emerald-500 bg-emerald-500/10' : 'text-red-500 bg-red-500/10'}`}>
                        {p.side === PositionSide.LONG ? '多' : '空'}
                    </span>
                </div>
                <div className="flex items-center gap-1 shrink-0 hidden sm:flex">
                    {p.isBacktestRecord && (
                        <div className="flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded-sm border bg-amber-600/20 text-amber-500 border-amber-500/30">
                            <History size={8} />
                            <span>回测记录</span>
                        </div>
                    )}
                    {isHedgedMode ? (
                        <>
                            <div className={`flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded-sm border ${p.mainPositionId ? 'bg-purple-900/30 text-purple-300 border-purple-500/30' : 'bg-indigo-900/30 text-indigo-300 border-indigo-500/30'}`} title="模块4已接管">
                                <Shield size={8} fill="currentColor"/>
                                <span>{p.mainPositionId ? '对冲仓位' : '原仓位'}</span>
                            </div>
                            {p.mainPositionId && p.triggerReason && (
                                <div className="flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded-sm border bg-slate-800/50 text-slate-400 border-slate-700/50 max-w-[120px]" title={p.triggerReason}>
                                    <span className="truncate">{p.triggerReason}</span>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className={`flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded-sm border ${isModule1Active ? 'bg-emerald-900/20 text-emerald-400 border-emerald-500/20' : 'bg-slate-800 text-slate-500 border-slate-600'}`}>
                            <Target size={8} />
                            <span>{isModule1Active ? '标准风控' : '手动模式'}</span>
                        </div>
                    )}
                    {hasAmmo && (
                        <div className="flex items-center gap-1 bg-amber-900/30 text-amber-400 text-[8px] font-bold px-1.5 py-0.5 rounded-sm border border-amber-500/30">
                            <Zap size={8} fill="currentColor"/>
                            <span>+{(p.cumulativeHedgeProfit || 0).toFixed(1)}U</span>
                        </div>
                    )}
                    {p.customProfitSettings && (
                        isHedgedActive ? (
                            <div className="flex items-center gap-1 bg-[#1a232e] text-slate-500 text-[8px] font-bold px-1.5 py-0.5 rounded-sm border border-slate-800" title="该币有单币AI智能配置，但由于已启动对冲，智能平仓已自动解锁停用">
                                <Brain size={8} />
                                <span className="line-through scale-[0.95] origin-left">AI智能</span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-1 bg-emerald-500/10 text-emerald-400 text-[8px] font-black px-1.5 py-0.5 rounded-sm border border-emerald-500/35 animate-pulse" title="该币已启动单币AI智能托管监控">
                                <Brain size={8} />
                                <span>AI智能</span>
                            </div>
                        )
                    )}
                </div>
            </div>

            {/* 2. Prices & Times */}
            <div className="w-[35%] flex items-center gap-4">
                <div className="flex items-center gap-1.5 font-mono text-[10px] shrink-0">
                    <span className="text-slate-500">{new Date(p.isBacktestRecord ? (p.backtestEntryTime || p.entryTime) : (p.entryTime)).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'})}</span>
                    <span className="text-slate-400">{formatPrice(p.entryPrice)}</span>
                </div>
                <div className="flex items-center gap-1.5 font-mono text-[10px] shrink-0">
                    <span className="text-slate-500">{new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'})}</span>
                    <span className={`font-bold ${currentPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatPrice(livePrice)}</span>
                </div>
            </div>

            {/* 3. PnL & Stats */}
            <div className="w-[25%] flex items-center justify-end gap-3 pr-4">
                <div className="flex items-center gap-0.5 text-[10px] font-mono bg-slate-800/80 px-1.5 py-0.5 rounded-sm border border-slate-700 shrink-0">
                    <span className="font-bold text-slate-200">{(p.amount * livePrice).toFixed(0)}</span>
                    <span className="text-slate-500">U</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`font-mono text-xs font-bold ${currentPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {currentPnl >= 0 ? '+' : ''}{p.amount > 1000 ? currentPnl.toFixed(2) : currentPnl.toFixed(4)}
                    </span>
                    <span className="text-slate-700 text-[10px]">/</span>
                    <span className={`font-mono text-xs font-bold ${currentPnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {currentPnlPct >= 0 ? '+' : ''}{currentPnlPct.toFixed(3)}%
                    </span>
                </div>
                {showHedgeStats && (
                    <div className="flex items-center gap-1 text-[9px] text-slate-400 bg-slate-800/50 px-1.5 py-0.5 rounded shrink-0">
                        <span>负债:</span>
                        <span className="text-red-400 font-mono font-bold">{totalDebt.toFixed(2)}U</span>
                    </div>
                )}
            </div>

            {/* 4. Actions */}
            <div className="w-[20%] flex items-center justify-end gap-2 shrink-0">
                <div className="hidden xl:flex bg-blue-900/20 border border-blue-500/20 rounded-sm px-1.5 py-0.5 items-center gap-1" title="预计强平价格 / 防守线">
                    <span className="text-[8px] text-blue-400 font-bold uppercase">Def:</span>
                    <span className="text-[9px] font-mono text-blue-100">{formatPrice(p.entryPrice * (p.side === PositionSide.LONG ? 0.99 : 1.01))}</span>
                </div>
                <div className="flex items-center gap-1 opacity-80 hover:opacity-100 transition-opacity z-10 relative">
                    {isHedgedActive ? (
                        <div 
                            className="px-1.5 py-1 rounded-md bg-[#13171e] text-slate-500 border border-slate-800/80 flex items-center gap-1 cursor-not-allowed select-none" 
                            title="该币已进入对冲保护状态，智能平仓自动锁定停用"
                        >
                            <Brain size={11} className="text-slate-600" />
                            <span className="text-[10px] scale-[0.9] origin-left line-through font-bold">智能平仓</span>
                        </div>
                    ) : (
                        <button 
                            onClick={(e) => { e.stopPropagation(); onOpenSettings?.(p); }} 
                            className={`px-1.5 py-1 rounded-md transition-all flex items-center gap-1 cursor-pointer font-bold ${p.customProfitSettings ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.15)]' : 'bg-[#141a22] text-slate-400 hover:bg-slate-800 hover:text-white border border-slate-800'}`} 
                            title="单币AI智能平仓 (参数设置与算法启动)"
                        >
                            <Brain size={11} className={p.customProfitSettings ? 'animate-pulse text-emerald-400' : 'text-slate-400'} />
                            <span className="text-[10px] scale-[0.9] origin-left">智能平仓</span>
                        </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); onShowHistory(p.symbol); }} className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors" title="历史记录"><History size={12}/></button>
                    <button onClick={(e) => { e.stopPropagation(); onOpenChart(p.symbol, p.entryPrice, p.entryTime); }} className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors" title="K线图"><BarChart2 size={12}/></button>
                    <button 
                        onClick={(e) => { e.stopPropagation(); onClosePosition(p.symbol, p.side); }} 
                        className="px-2 py-0.5 bg-slate-800 hover:bg-red-600 text-slate-300 hover:text-white rounded text-[10px] font-bold border border-slate-600 hover:border-red-500 transition-all z-10 relative"
                    >
                        平仓
                    </button>
                </div>
            </div>
        </div>
    );
};
