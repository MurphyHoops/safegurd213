import React from 'react';
import { Position, PositionSide } from '../../../types';
import { Shield, Target, Zap, History, BarChart2, Settings, Brain, RefreshCw } from 'lucide-react';
import { formatPrice } from '../../../services/symbolUtils';
import { RealtimePriceSpan } from '../../../components/RealtimePriceSpan';
import { RealtimePnlSpan } from '../../../components/RealtimePnlSpan';

/**
 * 本地获取 AI 智能开启的真实百分比阈值，避免循环依赖
 */
function getAiActivationThreshold(aiSettings: any): number {
    if (!aiSettings) return 3.5;
    if (aiSettings.activationProfitPercent !== undefined && aiSettings.activationProfitPercent !== null) {
        return aiSettings.activationProfitPercent;
    }
    if (aiSettings.activationProfit !== undefined && aiSettings.activationProfit !== null) {
        const val = aiSettings.activationProfit;
        if (val === 60) {
            return 6.0;
        }
        return val;
    }
    return 3.5;
}

function getStrategyNameById(id?: string): string {
    if (!id) return '';
    if (id === 'manual') return '手动';
    try {
        const saved = localStorage.getItem('SCANNER_STRATEGIES_LIST');
        if (saved) {
            const list = JSON.parse(saved);
            if (Array.isArray(list)) {
                const found = list.find((s: any) => s.id === id);
                if (found && found.name) {
                    return found.name;
                }
            }
        }
    } catch (e) {}
    const num = id.replace('strat-', '');
    if (num && !isNaN(Number(num)) && Number(num) < 1000) {
        return `自动选币 ${num}`;
    }
    return id;
}

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
    onVerifyPosition: (position: Position) => void;
    onOpenSettings?: (position: Position) => void;
    onManualHedge?: (position: Position) => void;
    aiSmartMasterEnabled?: boolean;
    globalProfitSettings?: any;
    globalHedgingSettings?: any;
    isManuallyClosed?: boolean;
    hasCustomSettings?: boolean;
}

// @LOCKED: PositionItem logic
export const PositionItem: React.FC<Props> = ({
    p, idx, livePrice, currentPnl, currentPnlPct, showHedgeStats, totalDebt, isHedgedMode, isModule1Active, hasAmmo,
    onOpenChart, onShowHistory, onClosePosition, onVerifyPosition, onOpenSettings, onManualHedge, aiSmartMasterEnabled = true, globalProfitSettings, globalHedgingSettings, isManuallyClosed, hasCustomSettings
}) => {
    const isHedgedActive = p.isHedged || !!p.mainPositionId;

    // AI Dynamic Status & Activation Checks
    const profitSettings = p.customProfitSettings || globalProfitSettings;
    const currentProfitMode = profitSettings?.profitMode;
    const oEnabledMap = profitSettings?.oEnabledMap || {};
    const isAiMode = currentProfitMode === 'AI' || oEnabledMap['AI'] === true;
    const isAiEnabled = (aiSmartMasterEnabled ?? true) && isAiMode;

    const aiSettings = profitSettings?.ai || {
        activationProfitPercent: 3.5,
        fallbackProfitPercent: 1.0,
        aiSmartModeEnabled: true,
        minPosition: 100
    };
    const actThreshold = getAiActivationThreshold(aiSettings);
    const fallbackThreshold = aiSettings.fallbackProfitPercent ?? 1.0;
    const minPosition = aiSettings.minPosition ?? 100;

    const maxPnl = p.maxPnLPercent || 0;
    const positionValue = p.amount * p.entryPrice;
    const isPositionSizeMet = positionValue >= minPosition;
    const isAiActivated = isAiEnabled && (maxPnl >= actThreshold) && (currentPnlPct >= fallbackThreshold) && isPositionSizeMet;

    // @LOCKED: Parallel Protection & Hedging Triggers list setup (亏损值, 极值防爆, EMA防爆, 破位防爆)
    let activeHedgeTriggerPrice: number | null = null;
    let activeHedgeLabel: string = "防爆";
    const candidates: Array<{ price: number; label: string }> = [];

    if (globalHedgingSettings?.enabled !== false) {
        // Parallel closest-trigger calculation:
        // We evaluate all enabled trigger conditions and find the one that will be hit FIRST.
        // For LONG positions: Whichever condition has the HIGHEST target price triggers first.
        // For SHORT positions: Whichever condition has the LOWEST target price triggers first.

        // 1. 亏损值触发
        if (globalHedgingSettings?.triggerLossEnabled !== false) {
            const triggerLossPercent = Number(globalHedgingSettings?.triggerLossPercent ?? 1.0);
            const price = p.entryPrice * (1 + (triggerLossPercent / 100) * (p.side === PositionSide.LONG ? -1 : 1));
            candidates.push({ price, label: '亏损值' });
        }

        // 2. 300天极值比例对冲
        if (globalHedgingSettings?.extremeHedgeEnabled && p.extremeHedgeTriggerPrice) {
            candidates.push({ price: Number(p.extremeHedgeTriggerPrice), label: '极值防爆' });
        }

        // 3. 趋势防爆 EMA
        if (globalHedgingSettings?.trendHedgeEnabled && p.entryEmas) {
            const period = Number(globalHedgingSettings.trendHedgeEmaPeriod || 80);
            let firewallPrice = 0;
            switch (period) {
                case 10: firewallPrice = p.entryEmas.ema10; break;
                case 20: firewallPrice = p.entryEmas.ema20; break;
                case 40: firewallPrice = p.entryEmas.ema40; break;
                case 80: firewallPrice = p.entryEmas.ema80; break;
                default: firewallPrice = p.entryEmas.ema80;
            }
            if (firewallPrice > 0) {
                candidates.push({ price: firewallPrice, label: 'EMA防爆' });
            }
        }

        // 4. 破位防爆 (Break K-Line)
        if (globalHedgingSettings?.breakKLineEnabled && p.signalCandle) {
            const signalHigh = p.signalCandle.high;
            const signalLow = p.signalCandle.low;
            const ratio = Number(globalHedgingSettings.breakKLineRatio ?? 20) / 100;
            const triggerDistanceAbsolute = (signalHigh - signalLow) * (1 + ratio);
            const price = p.side === PositionSide.LONG ? signalHigh - triggerDistanceAbsolute : signalLow + triggerDistanceAbsolute;
            candidates.push({ price, label: '破位防爆' });
        }

        // Choose the closest trigger candidate
        if (candidates.length > 0) {
            if (p.side === PositionSide.LONG) {
                let best = candidates[0];
                for (let i = 1; i < candidates.length; i++) {
                    if (candidates[i].price > best.price) {
                        best = candidates[i];
                    }
                }
                activeHedgeTriggerPrice = best.price;
                activeHedgeLabel = best.label;
            } else {
                let best = candidates[0];
                for (let i = 1; i < candidates.length; i++) {
                    if (candidates[i].price < best.price) {
                        best = candidates[i];
                    }
                }
                activeHedgeTriggerPrice = best.price;
                activeHedgeLabel = best.label;
            }
        }
    }

    return (
        <div 
            onClick={() => onOpenChart(p.symbol, p.entryPrice, p.entryTime)}
            className={`flex items-center px-4 py-2 border-b border-slate-800/40 hover:bg-[#1e2329]/50 transition-colors group relative overflow-hidden shrink-0 cursor-pointer ${p.isHedged ? 'bg-indigo-900/5' : ''} ${isManuallyClosed ? 'bg-amber-900/20' : ''} ${hasCustomSettings ? (currentProfitMode === 'AI' ? 'bg-emerald-950/10 border-l-4 border-l-emerald-500/80 shadow-[inset_1px_0_0_rgba(16,185,129,0.2)]' : 'bg-red-950/20 border-l-4 border-l-red-500/80 shadow-[inset_1px_0_0_rgba(239,68,68,0.2)]') : ''}`}
        >
            <div className={`absolute left-0 top-1 bottom-1 w-0.5 rounded-r ${currentPnl >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
            
            {/* 1. Symbol, Direction & Tags */}
            <div className="w-[15%] flex items-center gap-2 pr-2">
                <div className="flex items-center gap-1.5 shrink-0">
                    <span className="font-black text-sm text-white tracking-tight">{p.symbol.replace('USDT','')}</span>
                    <span className={`text-[9px] px-1.5 rounded-sm font-bold ${p.side === PositionSide.LONG ? 'text-emerald-500 bg-emerald-500/10' : 'text-red-500 bg-red-500/10'}`}>
                        {p.side === PositionSide.LONG ? '多' : '空'}
                    </span>
                    {p.strategyId && (
                        <span className="text-[9px] px-1.5 rounded-sm font-bold bg-indigo-950 text-indigo-400 border border-indigo-500/20" title={p.strategyId}>
                            {getStrategyNameById(p.strategyId)}
                        </span>
                    )}
                    {p.isReopened && (
                        <div className="flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded-sm border bg-blue-900/20 text-blue-400 border-blue-500/30" title="原仓位复开">
                            <Shield size={8} />
                            <span>复开仓位 (编号{p.reopenCount || 1})</span>
                        </div>
                    )}
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
                                <span>{p.mainPositionId ? (p.reopenCount ? `对冲仓位 (编号${p.reopenCount})` : '对冲仓位') : '原仓位'}</span>
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
                    {isAiEnabled && (
                        isHedgedActive ? (
                            <div className="flex items-center gap-1 bg-[#1a232e] text-slate-500 text-[8px] font-bold px-1.5 py-0.5 rounded-sm border border-slate-800" title="该币有单币AI智能配置，但由于已启动对冲，AI智能平仓已自动解锁停用">
                                <Brain size={8} />
                                <span className="line-through scale-[0.95] origin-left">AI智能</span>
                            </div>
                        ) : isAiActivated ? (
                            <div className="flex items-center gap-1 bg-emerald-500/10 text-emerald-400 text-[8px] font-black px-1.5 py-0.5 rounded-sm border border-emerald-500/35 animate-pulse" title={`AI智能逃顶已激活！最高利润: ${maxPnl.toFixed(2)}% (已越过 ${actThreshold}% 启动线)`}>
                                <Brain size={8} />
                                <span>AI智能-追盈中</span>
                            </div>
                        ) : !isPositionSizeMet ? (
                            <div className="flex items-center gap-1 bg-red-500/10 text-red-400 text-[8px] font-bold px-1.5 py-0.5 rounded-sm border border-red-500/30" title={`金额未达标！当前持仓金额: ${positionValue.toFixed(1)}U < AI起投金额: ${minPosition}U`}>
                                <Brain size={8} className="text-red-400/70" />
                                <span>金额未达标</span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-1 bg-slate-800/40 text-slate-400 text-[8px] font-bold px-1.5 py-0.5 rounded-sm border border-slate-700/60" title={`AI智能监控中 (待触发启动门槛)。当前最高利润: ${maxPnl.toFixed(2)}% / 启动门槛: ${actThreshold}%`}>
                                <Brain size={8} className="text-slate-500" />
                                <span>AI待命</span>
                            </div>
                        )
                    )}
                </div>
            </div>

            {/* 2. Prices & Times */}
            <div className="w-[25%] flex items-center gap-4">
                <div className="flex items-center gap-1.5 font-mono text-[10px] shrink-0">
                    <span className="text-slate-500">{new Date(p.isBacktestRecord ? (p.backtestEntryTime || p.entryTime) : (p.entryTime)).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'})}</span>
                    <span className="text-slate-400">{formatPrice(p.entryPrice)}</span>
                </div>
                <div className="flex items-center gap-1.5 font-mono text-[10px] shrink-0">
                    <span className="text-slate-500">{new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'})}</span>
                    {p.isBacktestRecord ? (
                        <span className={`font-bold ${currentPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatPrice(livePrice)}</span>
                    ) : (
                        <RealtimePriceSpan symbol={p.symbol} fallbackPrice={livePrice} className={`font-bold ${currentPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`} />
                    )}
                </div>
            </div>

            {/* 3. PnL & Stats */}
            <div className="w-[20%] flex items-center justify-end gap-3 pr-4">
                <div className="flex items-center gap-0.5 text-[10px] font-mono bg-slate-800/80 px-1.5 py-0.5 rounded-sm border border-slate-700 shrink-0">
                    <span className="font-bold text-slate-200">{(p.amount * livePrice).toFixed(0)}</span>
                    <span className="text-slate-500">U</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    {p.isBacktestRecord ? (
                        <>
                            <span className={`font-mono text-xs font-bold ${currentPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {currentPnl >= 0 ? '+' : ''}{p.amount > 1000 ? currentPnl.toFixed(2) : currentPnl.toFixed(4)}
                            </span>
                            <span className="text-slate-700 text-[10px]">/</span>
                            <span className={`font-mono text-xs font-bold ${currentPnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {currentPnlPct >= 0 ? '+' : ''}{currentPnlPct.toFixed(3)}%
                            </span>
                        </>
                    ) : (
                        <>
                            <RealtimePnlSpan 
                                symbol={p.symbol} 
                                entryPrice={p.entryPrice} 
                                amount={p.amount} 
                                side={p.side === PositionSide.LONG ? 'LONG' : 'SHORT'} 
                                isPct={false} 
                                fallbackValue={currentPnl} 
                                className={`font-mono text-xs font-bold ${currentPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`} 
                            />
                            <span className="text-slate-700 text-[10px]">/</span>
                            <RealtimePnlSpan 
                                symbol={p.symbol} 
                                entryPrice={p.entryPrice} 
                                amount={p.amount} 
                                side={p.side === PositionSide.LONG ? 'LONG' : 'SHORT'} 
                                isPct={true} 
                                fallbackValue={currentPnlPct} 
                                className={`font-mono text-xs font-bold ${currentPnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`} 
                            />
                        </>
                    )}
                </div>
                {showHedgeStats && (
                    <div className="flex items-center gap-1 text-[9px] text-slate-400 bg-slate-800/50 px-1.5 py-0.5 rounded shrink-0">
                        <span>负债:</span>
                        <span className="text-red-400 font-mono font-bold">{totalDebt.toFixed(2)}U</span>
                    </div>
                )}
            </div>

            {/* 4. Actions */}
            <div className="w-[40%] flex items-center justify-end gap-2 shrink-0">
                {/* @LOCKED: Display all active triggers with custom labels & distance percentages */}
                {candidates.length > 0 && (
                    (() => {
                        return (
                            <div className="flex items-center gap-1.5">
                                <div 
                                    className="flex bg-blue-900/20 border border-blue-500/20 rounded-sm px-1.5 py-0.5 items-center gap-1 whitespace-nowrap" 
                                    title={candidates.map(c => `${c.label}启动价格: ${formatPrice(c.price)}`).join(' | ')}
                                >
                                    {candidates.map((cand, idx) => {
                                        const distPct = livePrice > 0 ? Math.abs((livePrice - cand.price) / livePrice) * 100 : 0;
                                        return (
                                            <span key={idx} className="font-mono text-[9px] text-blue-100 flex items-center">
                                                <span className="text-[8px] text-blue-400 font-bold mr-0.5">{cand.label}</span>
                                                <span>{distPct.toFixed(2)}%</span>
                                                {idx < candidates.length - 1 && <span className="mx-1 text-blue-500/60 font-sans">;</span>}
                                            </span>
                                        );
                                    })}
                                </div>
                                {!isHedgedActive && (
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); onManualHedge?.(p); }} 
                                        className="px-1.5 py-0.5 bg-indigo-950/40 hover:bg-indigo-600 text-indigo-300 hover:text-white rounded text-[9px] font-bold border border-indigo-800/60 hover:border-indigo-500 transition-all z-10 relative whitespace-nowrap"
                                        title="手动立即开启对冲保护"
                                    >
                                        手动对冲
                                    </button>
                                )}
                            </div>
                        );
                    })()
                )}
                <div className="flex items-center gap-1 opacity-80 hover:opacity-100 transition-opacity z-10 relative">
                    <button 
                        onClick={(e) => { e.stopPropagation(); onVerifyPosition(p); }} 
                        className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-emerald-400 transition-colors" 
                        title="核对/刷新开仓价格"
                    >
                        <RefreshCw size={12}/>
                    </button>
                    {isHedgedActive ? (
                        <div 
                            className="px-1.5 py-1 rounded-md bg-[#13171e] text-slate-500 border border-slate-800/80 flex items-center gap-1 cursor-not-allowed select-none whitespace-nowrap" 
                            title="该币已进入对冲保护状态，AI智能平仓自动锁定停用"
                        >
                            <Brain size={11} className="text-slate-600" />
                            <span className="text-[10px] scale-[0.9] origin-left line-through font-bold whitespace-nowrap">AI智能平仓</span>
                        </div>
                    ) : (() => {
                        const getButtonDetails = () => {
                            if (p.customProfitSettings) {
                                if (!p.customProfitSettings.enabled) {
                                    return {
                                        text: '❌ 托管关闭',
                                        classes: 'bg-slate-900 text-slate-500 border border-slate-800 hover:bg-slate-800 hover:text-slate-300',
                                        title: '当前币种已关闭平仓托管 (点击开启/设置)',
                                        iconColor: 'text-slate-600'
                                    };
                                }
                                if (p.customProfitSettings.profitMode === 'AI') {
                                    return {
                                        text: isAiActivated ? '🤖 AI智能逃顶中' : '🧠 AI智能逃顶 (单币)',
                                        classes: isAiActivated 
                                            ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/35 border border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.2)] animate-pulse'
                                            : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30',
                                        title: `单币AI智能自适应托管中 (最高浮盈: ${maxPnl.toFixed(2)}% / 启动阈值: ${actThreshold}%)(点击修改)`,
                                        iconColor: 'text-emerald-400'
                                    };
                                } else if (p.customProfitSettings.profitMode === 'ATR') {
                                    return {
                                        text: '📈 ATR趋势平仓 (单币)',
                                        classes: 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30',
                                        title: `单币ATR趋势平仓自适应托管中 (点击修改)`,
                                        iconColor: 'text-red-400'
                                    };
                                } else if (p.customProfitSettings.profitMode === 'SMART') {
                                    return {
                                        text: '🔒 智能阶梯保底 (单币)',
                                        classes: 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30',
                                        title: `单币智能阶梯保底自适应托管中 (点击修改)`,
                                        iconColor: 'text-red-400'
                                    };
                                } else {
                                    return {
                                        text: '⚙️ 常规止盈回调 (单币)',
                                        classes: 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30',
                                        title: `单币常规止盈回调自适应托管中 (点击修改)`,
                                        iconColor: 'text-red-400'
                                    };
                                }
                            } else {
                                // Inheriting Global
                                if (!globalProfitSettings?.enabled) {
                                    return {
                                        text: '❌ 托管关闭 (全局)',
                                        classes: 'bg-[#141a22] text-slate-500 border border-slate-850 hover:bg-slate-800 hover:text-slate-300',
                                        title: '正在继承全局禁用状态：未开启平仓托管 (点击分配单币托管)',
                                        iconColor: 'text-slate-600'
                                    };
                                }
                                if (globalProfitSettings?.profitMode === 'AI') {
                                    return {
                                        text: isAiActivated ? '🤖 AI智能逃顶中' : '🤖 AI智能 (全局)',
                                        classes: isAiActivated
                                            ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/35 shadow-[0_0_10px_rgba(16,185,129,0.2)] animate-pulse'
                                            : 'bg-[#141a22] text-slate-400 hover:bg-slate-800 hover:text-slate-300 border border-slate-800',
                                        title: `继承全局AI智能平仓规则。最高浮盈: ${maxPnl.toFixed(2)}% / 启动阈值: ${actThreshold}% (点击分配单币托管)`,
                                        iconColor: 'text-emerald-500/70'
                                    };
                                } else {
                                    return {
                                        text: '⚙️ 常规智能 (全局)',
                                        classes: 'bg-[#141a22] text-slate-400 hover:bg-slate-800 hover:text-slate-300 border border-slate-800',
                                        title: `继承全局常规固化平仓规则 (点击分配单币托管)`,
                                        iconColor: 'text-amber-500/70'
                                    };
                                }
                            }
                        };
                        const btn = getButtonDetails();
                        return (
                            <button 
                                onClick={(e) => { e.stopPropagation(); onOpenSettings?.(p); }} 
                                className={`px-1.5 py-1 rounded-md transition-all flex items-center gap-1 cursor-pointer font-bold whitespace-nowrap ${btn.classes}`}
                                title={btn.title}
                            >
                                <Brain size={11} className={btn.iconColor} />
                                <span className="text-[10px] scale-[0.9] origin-left whitespace-nowrap">
                                    {btn.text}
                                </span>
                            </button>
                        );
                    })()}
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
