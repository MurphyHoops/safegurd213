import React, { useState, useEffect } from 'react';
import { X, Zap, TrendingUp, TrendingDown, ShieldAlert, DollarSign, ArrowRight } from 'lucide-react';
import { PositionSide } from '../types';
import { formatPrice } from '../services/symbolUtils';
import { getCoinChineseName } from '../services/coinNames';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    symbol: string;
    initialDirection?: 'LONG' | 'SHORT';
    initialPrice?: number;
    livePrices?: Record<string, number>;
    onConfirmTrade: (symbol: string, side: PositionSide, price: number, amountUsdt: number, reason: string) => void;
}

export const QuickTradeModal: React.FC<Props> = ({
    isOpen,
    onClose,
    symbol,
    initialDirection = 'LONG',
    initialPrice = 0,
    livePrices = {},
    onConfirmTrade
}) => {
    const [side, setSide] = useState<PositionSide>(initialDirection === 'SHORT' ? PositionSide.SHORT : PositionSide.LONG);
    const [amountUsdtStr, setAmountUsdtStr] = useState<string>('20');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setSide(initialDirection === 'SHORT' ? PositionSide.SHORT : PositionSide.LONG);
            setSubmitting(false);
        }
    }, [isOpen, initialDirection]);

    if (!isOpen || !symbol) return null;

    const cleanSymbol = symbol.replace('USDT', '').toUpperCase();
    const chineseName = getCoinChineseName(cleanSymbol);
    const realPrice = (livePrices[symbol] && livePrices[symbol] > 0) 
        ? livePrices[symbol] 
        : (initialPrice > 0 ? initialPrice : 0);

    const amountUsdt = parseFloat(amountUsdtStr) || 0;
    const tokenQty = realPrice > 0 ? (amountUsdt / realPrice) : 0;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (amountUsdt <= 0 || realPrice <= 0) return;
        setSubmitting(true);

        const tradeSide = side;
        const reason = `[右键快速开仓] 手动${tradeSide === PositionSide.LONG ? '做多' : '做空'} ${cleanSymbol}`;

        onConfirmTrade(symbol, tradeSide, realPrice, amountUsdt, reason);
        setTimeout(() => {
            setSubmitting(false);
            onClose();
        }, 150);
    };

    const quickAmounts = [10, 20, 50, 100, 200, 500];

    return (
        <div 
            className="fixed inset-0 z-[10000] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
            onClick={onClose}
        >
            <div 
                className="bg-slate-900 border border-indigo-500/40 rounded-xl shadow-2xl w-full max-w-md overflow-hidden text-slate-200 text-xs select-none"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-4 py-3 bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950/40 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                            <Zap size={16} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="font-black text-sm text-white tracking-wide">{cleanSymbol}/USDT</span>
                                {chineseName && (
                                    <span className="text-[11px] text-slate-400 font-medium">({chineseName})</span>
                                )}
                            </div>
                            <div className="text-[10px] text-slate-400">右键快捷下单终端</div>
                        </div>
                    </div>
                    <button 
                        onClick={onClose}
                        className="text-slate-500 hover:text-slate-300 p-1 hover:bg-slate-800 rounded transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Body Form */}
                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    {/* Current Price Banner */}
                    <div className="bg-slate-950/60 rounded-lg p-2.5 border border-slate-800/80 flex items-center justify-between">
                        <span className="text-slate-400">当前参考市价:</span>
                        <span className="font-mono text-sm font-bold text-amber-400">
                            {realPrice > 0 ? `$${formatPrice(realPrice)}` : '行情获取中...'}
                        </span>
                    </div>

                    {/* Direction Selection */}
                    <div>
                        <label className="block text-[11px] font-bold text-slate-400 mb-1.5">开仓方向:</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setSide(PositionSide.LONG)}
                                className={`py-2 px-3 rounded-lg border font-bold flex items-center justify-center gap-1.5 transition-all ${
                                    side === PositionSide.LONG
                                        ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300 shadow-lg shadow-emerald-950/40'
                                        : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:bg-slate-800'
                                }`}
                            >
                                <TrendingUp size={14} /> 做多 (LONG)
                            </button>
                            <button
                                type="button"
                                onClick={() => setSide(PositionSide.SHORT)}
                                className={`py-2 px-3 rounded-lg border font-bold flex items-center justify-center gap-1.5 transition-all ${
                                    side === PositionSide.SHORT
                                        ? 'bg-red-600/30 border-red-500 text-red-300 shadow-lg shadow-red-950/40'
                                        : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:bg-slate-800'
                                }`}
                            >
                                <TrendingDown size={14} /> 做空 (SHORT)
                            </button>
                        </div>
                    </div>

                    {/* Amount Input & Quick Select */}
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="text-[11px] font-bold text-slate-400">下单名义价值 (USDT):</label>
                            {tokenQty > 0 && (
                                <span className="text-[10px] text-slate-500 font-mono">
                                    ≈ {tokenQty.toFixed(tokenQty > 10 ? 2 : 4)} {cleanSymbol}
                                </span>
                            )}
                        </div>
                        <div className="relative">
                            <input
                                type="number"
                                step="any"
                                min="1"
                                value={amountUsdtStr}
                                onChange={(e) => setAmountUsdtStr(e.target.value)}
                                placeholder="输入USDT金额"
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono font-bold text-sm focus:border-indigo-500 focus:outline-none pr-12"
                            />
                            <span className="absolute right-3 top-2.5 text-slate-500 font-bold text-xs">USDT</span>
                        </div>

                        {/* Quick Presets */}
                        <div className="grid grid-cols-6 gap-1 mt-2">
                            {quickAmounts.map(amt => (
                                <button
                                    key={amt}
                                    type="button"
                                    onClick={() => setAmountUsdtStr(amt.toString())}
                                    className={`py-1 rounded text-[10px] font-bold border transition-colors ${
                                        amountUsdtStr === amt.toString()
                                            ? 'bg-indigo-600 text-white border-indigo-400'
                                            : 'bg-slate-800/60 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-white'
                                    }`}
                                >
                                    {amt}U
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="pt-2 flex gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-bold transition-colors"
                        >
                            取消
                        </button>
                        <button
                            type="submit"
                            disabled={submitting || amountUsdt <= 0 || realPrice <= 0}
                            className={`flex-[2] py-2 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-all shadow-lg ${
                                side === PositionSide.LONG
                                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/40 border border-emerald-400'
                                    : 'bg-red-600 hover:bg-red-500 text-white shadow-red-950/40 border border-red-400'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            <Zap size={14} /> 确认立即开仓 ({side === PositionSide.LONG ? '多单' : '空单'})
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
