
import React from 'react';
import { Skull, TrendingUp, TrendingDown, Wallet, Ban } from 'lucide-react';

interface Props {
    onPanicSell: () => void;
    onSecureProfit: () => void;
    onCutLosses: () => void;
    onCloseLongs: () => void;
    onCloseShorts: () => void;
}

export const List6ActionGroup: React.FC<Props> = ({ 
    onPanicSell, onSecureProfit, onCutLosses, onCloseLongs, onCloseShorts 
}) => {
    return (
        <div className="space-y-4">
            {/* 1. Global Panic Button */}
            <div className="space-y-1">
                <span className="text-[9px] text-slate-500 font-bold uppercase ml-1">紧急制动</span>
                <button 
                    onClick={() => { if(window.confirm('⚠️ 确认要清空所有持仓吗？此操作不可逆！')) onPanicSell(); }}
                    className="w-full py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded shadow-lg shadow-red-900/30 flex items-center justify-center gap-2 transition-all active:scale-95"
                >
                    <Skull size={16} /> 全部清仓 (PANIC SELL)
                </button>
            </div>

            {/* 2. PnL Based Actions */}
            <div className="space-y-1">
                <span className="text-[9px] text-slate-500 font-bold uppercase ml-1">盈亏管理</span>
                <div className="grid grid-cols-2 gap-2">
                    <button 
                        onClick={onSecureProfit}
                        className="py-2.5 bg-emerald-600/90 hover:bg-emerald-500 text-white font-bold rounded flex items-center justify-center gap-1.5 transition-colors border border-emerald-500/50"
                    >
                        <Wallet size={14} /> 止盈落袋
                    </button>
                    <button 
                        onClick={onCutLosses}
                        className="py-2.5 bg-amber-600/90 hover:bg-amber-500 text-white font-bold rounded flex items-center justify-center gap-1.5 transition-colors border border-amber-500/50"
                    >
                        <Ban size={14} /> 一键止损
                    </button>
                </div>
            </div>

            {/* 3. Directional Actions */}
            <div className="space-y-1">
                <span className="text-[9px] text-slate-500 font-bold uppercase ml-1">方向管理</span>
                <div className="grid grid-cols-2 gap-2">
                    <button 
                        onClick={onCloseLongs}
                        className="py-2 bg-slate-800 hover:bg-slate-700 text-emerald-400 font-bold rounded border border-slate-700 flex items-center justify-center gap-1.5 transition-colors"
                    >
                        <TrendingUp size={14} /> 平多 (Close Long)
                    </button>
                    <button 
                        onClick={onCloseShorts}
                        className="py-2 bg-slate-800 hover:bg-slate-700 text-red-400 font-bold rounded border border-slate-700 flex items-center justify-center gap-1.5 transition-colors"
                    >
                        <TrendingDown size={14} /> 平空 (Close Short)
                    </button>
                </div>
            </div>
        </div>
    );
};
