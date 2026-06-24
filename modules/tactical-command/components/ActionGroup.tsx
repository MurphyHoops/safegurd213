
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
    const [confirmPanic, setConfirmPanic] = React.useState(false);
    const timeoutRef = React.useRef<any>(null);

    const handlePanicClick = () => {
        if (!confirmPanic) {
            setConfirmPanic(true);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            timeoutRef.current = setTimeout(() => setConfirmPanic(false), 3000);
        } else {
            onPanicSell();
            setConfirmPanic(false);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        }
    };

    return (
        <div className="space-y-4">
            {/* 1. Global Panic Button */}
            <div className="space-y-1">
                <span className="text-[9px] text-slate-500 font-bold uppercase ml-1">紧急制动</span>
                <button 
                    onClick={handlePanicClick}
                    className={`w-full py-3 font-bold rounded shadow-lg flex items-center justify-center gap-2 transition-all active:scale-95 ${confirmPanic ? 'bg-red-700 animate-pulse ring-2 ring-red-400' : 'bg-red-600 hover:bg-red-500 shadow-red-900/30'} text-white`}
                >
                    {confirmPanic ? <Skull size={18} className="animate-bounce" /> : <Skull size={16} />}
                    {confirmPanic ? '确认立即全部清仓？' : '全部清仓 (PANIC SELL)'}
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
