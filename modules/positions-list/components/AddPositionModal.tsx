import React, { useState, useMemo } from 'react';
import { Position, PositionSide } from '../../../types';
import { X, PlusCircle, ArrowUpRight, ArrowDownRight, Zap, Shield, DollarSign } from 'lucide-react';
import { formatPrice } from '../../../services/symbolUtils';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    position: Position | null;
    livePrice?: number;
    walletBalance?: number;
    onConfirmAddPosition: (symbol: string, side: PositionSide, amountUsdt: number, livePrice: number) => void;
}

export const AddPositionModal: React.FC<Props> = ({
    isOpen,
    onClose,
    position,
    livePrice: propLivePrice,
    walletBalance = 10000,
    onConfirmAddPosition
}) => {
    if (!isOpen || !position) return null;

    const livePrice = (propLivePrice && propLivePrice > 0) ? propLivePrice : (position.markPrice || position.entryPrice);
    const [selectedSide, setSelectedSide] = useState<PositionSide>(position.side);
    const currentPositionValueUsdt = (position.amount || 0) * (position.entryPrice || livePrice);
    
    // Default add amount (e.g. 50% of current position value or 20 USDT)
    const [amountUsdtStr, setAmountUsdtStr] = useState<string>(() => {
        const defaultVal = Math.max(10, Math.round(currentPositionValueUsdt * 0.5));
        return defaultVal.toString();
    });

    const amountUsdt = parseFloat(amountUsdtStr) || 0;
    const isSameSide = selectedSide === position.side;

    // Calculations
    const deltaTokenAmount = livePrice > 0 ? (amountUsdt / livePrice) : 0;
    const currentTokenAmount = position.amount || 0;
    const currentEntryPrice = position.entryPrice || livePrice;

    // Projected new average price for same side
    const projectedNewEntryPrice = useMemo(() => {
        if (!isSameSide || livePrice <= 0 || amountUsdt <= 0) return currentEntryPrice;
        const totalToken = currentTokenAmount + deltaTokenAmount;
        if (totalToken <= 0) return currentEntryPrice;
        const totalCost = (currentTokenAmount * currentEntryPrice) + (deltaTokenAmount * livePrice);
        return totalCost / totalToken;
    }, [isSameSide, livePrice, amountUsdt, currentTokenAmount, currentEntryPrice, deltaTokenAmount]);

    const handleQuickPct = (pct: number) => {
        const val = Math.max(5, Math.round(currentPositionValueUsdt * (pct / 100)));
        setAmountUsdtStr(val.toString());
    };

    const handleQuickFixed = (val: number) => {
        setAmountUsdtStr(val.toString());
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (amountUsdt <= 0 || livePrice <= 0) return;
        onConfirmAddPosition(position.symbol, selectedSide, amountUsdt, livePrice);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-[#0f172a] border border-slate-700/80 rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col text-slate-200">
                {/* Modal Header */}
                <div className="px-4 py-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded-lg border border-emerald-500/20">
                            <PlusCircle size={16} />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                                一键加仓 / 增减调仓
                                <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono border border-slate-700">
                                    {position.symbol}
                                </span>
                            </h3>
                            <p className="text-[10px] text-slate-400">快速增加持仓规模或开立反向独立仓位</p>
                        </div>
                    </div>
                    <button 
                        onClick={onClose}
                        className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    {/* Current Position Status Card */}
                    <div className="p-3 bg-slate-900/50 rounded-lg border border-slate-800 grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="flex flex-col items-center justify-center p-1.5 bg-slate-800/40 rounded border border-slate-700/40">
                            <span className="text-[9px] text-slate-400 mb-0.5">当前持仓方向</span>
                            <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${position.side === PositionSide.LONG ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60' : 'bg-red-950/60 text-red-400 border border-red-800/60'}`}>
                                {position.side === PositionSide.LONG ? '多 (LONG)' : '空 (SHORT)'}
                            </span>
                        </div>
                        <div className="flex flex-col items-center justify-center p-1.5 bg-slate-800/40 rounded border border-slate-700/40">
                            <span className="text-[9px] text-slate-400 mb-0.5">原持仓均价</span>
                            <span className="text-[11px] font-mono font-bold text-slate-200">
                                {formatPrice(currentEntryPrice)}
                            </span>
                        </div>
                        <div className="flex flex-col items-center justify-center p-1.5 bg-slate-800/40 rounded border border-slate-700/40">
                            <span className="text-[9px] text-slate-400 mb-0.5">当前实时市价</span>
                            <span className="text-[11px] font-mono font-bold text-cyan-400">
                                {formatPrice(livePrice)}
                            </span>
                        </div>
                    </div>

                    {/* Choose Direction */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-300 flex items-center justify-between">
                            <span>选择加仓方向</span>
                            <span className="text-[10px] text-slate-500">
                                {isSameSide ? '💡 同向加仓：将与原持仓合并并重算均价' : '⚡ 反向开仓：将独立建立反向仓位'}
                            </span>
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setSelectedSide(PositionSide.LONG)}
                                className={`py-2 px-3 rounded-lg border font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
                                    selectedSide === PositionSide.LONG 
                                        ? 'bg-emerald-600 text-white border-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.3)]' 
                                        : 'bg-slate-800/60 text-slate-400 border-slate-700 hover:bg-slate-800 hover:text-slate-200'
                                }`}
                            >
                                <ArrowUpRight size={14} /> 做多 (LONG)
                            </button>
                            <button
                                type="button"
                                onClick={() => setSelectedSide(PositionSide.SHORT)}
                                className={`py-2 px-3 rounded-lg border font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
                                    selectedSide === PositionSide.SHORT 
                                        ? 'bg-red-600 text-white border-red-400 shadow-[0_0_12px_rgba(239,68,68,0.3)]' 
                                        : 'bg-slate-800/60 text-slate-400 border-slate-700 hover:bg-slate-800 hover:text-slate-200'
                                }`}
                            >
                                <ArrowDownRight size={14} /> 做空 (SHORT)
                            </button>
                        </div>
                    </div>

                    {/* Input Amount in USDT */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-bold text-slate-300">加仓保证金金额 (USDT)</label>
                            <span className="text-[10px] text-slate-400 font-mono">
                                预计折合: <strong className="text-cyan-400">{deltaTokenAmount.toFixed(4)}</strong> {position.symbol.replace(/USDT$/i, '')}
                            </span>
                        </div>
                        <div className="relative flex items-center">
                            <input
                                type="number"
                                step="any"
                                min="1"
                                value={amountUsdtStr}
                                onChange={(e) => setAmountUsdtStr(e.target.value)}
                                placeholder="输入加仓金额"
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm font-mono font-bold text-white focus:outline-none focus:border-emerald-500 transition-colors pr-14"
                                autoFocus
                            />
                            <span className="absolute right-3 text-xs font-bold text-slate-400 pointer-events-none">
                                USDT
                            </span>
                        </div>

                        {/* Quick Selection Buttons */}
                        <div className="flex flex-wrap gap-1.5 pt-1">
                            <span className="text-[10px] text-slate-500 self-center mr-1">快捷比例:</span>
                            <button type="button" onClick={() => handleQuickPct(25)} className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-mono border border-slate-700 transition-colors">+25%</button>
                            <button type="button" onClick={() => handleQuickPct(50)} className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-mono border border-slate-700 transition-colors">+50%</button>
                            <button type="button" onClick={() => handleQuickPct(100)} className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-mono border border-slate-700 transition-colors">+100%</button>
                            <span className="text-[10px] text-slate-500 self-center mx-1">固定额:</span>
                            <button type="button" onClick={() => handleQuickFixed(10)} className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-mono border border-slate-700 transition-colors">10U</button>
                            <button type="button" onClick={() => handleQuickFixed(20)} className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-mono border border-slate-700 transition-colors">20U</button>
                            <button type="button" onClick={() => handleQuickFixed(50)} className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-mono border border-slate-700 transition-colors">50U</button>
                            <button type="button" onClick={() => handleQuickFixed(100)} className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-mono border border-slate-700 transition-colors">100U</button>
                        </div>
                    </div>

                    {/* Projected Results Card (For same-side add) */}
                    {isSameSide && amountUsdt > 0 && (
                        <div className="p-3 bg-emerald-950/20 border border-emerald-500/30 rounded-lg space-y-1.5 animate-in fade-in duration-200">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-slate-400">加仓后预计总持仓:</span>
                                <span className="font-mono font-bold text-white">
                                    {(currentTokenAmount + deltaTokenAmount).toFixed(4)} {position.symbol.replace(/USDT$/i, '')} (~{(currentPositionValueUsdt + amountUsdt).toFixed(2)} U)
                                </span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-slate-400">加仓后预计新均价:</span>
                                <span className="font-mono font-bold text-emerald-400 text-sm">
                                    {formatPrice(projectedNewEntryPrice)}
                                </span>
                            </div>
                            <p className="text-[9px] text-emerald-500/80 pt-0.5">
                                💡 成功加仓后，系统的多阶梯托底平仓与止盈止损将自动以新成本均价继续追踪保护。
                            </p>
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-bold transition-colors"
                        >
                            取消
                        </button>
                        <button
                            type="submit"
                            disabled={amountUsdt <= 0}
                            className={`px-5 py-2 rounded-lg text-xs font-bold text-white transition-all shadow-lg flex items-center gap-1.5 ${
                                selectedSide === PositionSide.LONG 
                                    ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/30' 
                                    : 'bg-red-600 hover:bg-red-500 shadow-red-900/30'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            <Zap size={14} />
                            确认加仓 ({selectedSide === PositionSide.LONG ? '多' : '空'} {amountUsdt} U)
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
