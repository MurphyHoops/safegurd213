import React, { useState } from 'react';
import { AppSettings } from '../../../types';

interface Props {
    availableMarginWithLeverage: number;
    walletBalance: number;
    calculatedMarginRatio: number;
    totalPnL: number;
    totalPnLPercentage: number;
    totalPositionValue: number;
    longValue: number;
    shortValue: number;
    totalHedgeSLAmount: number;
    onResetBalance?: (balance: number) => void;
    settings?: AppSettings;
}

export const FinanceStatsPanel: React.FC<Props> = ({
    availableMarginWithLeverage, walletBalance, calculatedMarginRatio, totalPnL, totalPnLPercentage,
    totalPositionValue, longValue, shortValue, totalHedgeSLAmount, onResetBalance, settings
}) => {
    const [isEditingBalance, setIsEditingBalance] = useState(false);
    const [tempBalance, setTempBalance] = useState('10000');

    const isRealTrading = settings?.system?.realTrading;

    return (
        <div className="w-full bg-[#0b0e11] rounded border border-slate-800 p-1.5 shadow-inner h-full flex flex-col justify-center">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="flex flex-col justify-center pl-2">
                    <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[9px] text-slate-500 font-bold uppercase tracking-tight">可用/余额 (U)</span>
                        {isRealTrading ? (
                            <span className="text-[8px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-1 py-0.2 rounded font-black uppercase tracking-wider flex items-center gap-1">
                                <span className="w-1 h-1 rounded-full bg-emerald-400 animate-ping"></span>
                                实盘
                            </span>
                        ) : (
                            onResetBalance && (
                                <div className="flex items-center gap-1">
                                    {!isEditingBalance ? (
                                        <>
                                            <button 
                                                onClick={() => onResetBalance(10000)}
                                                className="text-[8px] bg-slate-800 hover:bg-slate-700 text-slate-400 px-1 py-0.5 rounded border border-slate-700 transition-colors"
                                            >
                                                恢复
                                            </button>
                                            <button 
                                                onClick={() => setIsEditingBalance(true)}
                                                className="text-[8px] bg-indigo-900/40 hover:bg-indigo-800/60 text-indigo-300 px-1 py-0.5 rounded border border-indigo-700/50 transition-colors"
                                            >
                                                设置
                                            </button>
                                        </>
                                    ) : (
                                        <div className="flex items-center gap-1">
                                            <input 
                                                type="number"
                                                value={tempBalance}
                                                onChange={(e) => setTempBalance(e.target.value)}
                                                className="w-12 text-[8px] bg-slate-900 border border-indigo-500/50 rounded px-1 py-0.5 text-white outline-none"
                                                autoFocus
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        onResetBalance(Number(tempBalance));
                                                        setIsEditingBalance(false);
                                                    } else if (e.key === 'Escape') {
                                                        setIsEditingBalance(false);
                                                    }
                                                }}
                                            />
                                        </div>
                                    )}
                                </div>
                            )
                        )}
                    </div>
                    <div className="flex items-baseline gap-1">
                        <span className="text-lg font-mono text-slate-100 font-bold">{availableMarginWithLeverage.toFixed(0)}</span>
                        <span className="text-slate-700 text-[10px]">/</span>
                        <span className="text-md font-mono text-slate-400">{walletBalance.toFixed(0)}</span>
                    </div>
                </div>

                <div className="flex flex-col justify-center pl-3 border-l border-slate-800/50">
                    <span className="text-[9px] text-slate-500 font-bold uppercase mb-0.5">健康度 / 浮盈</span>
                    <div className="flex items-baseline gap-1">
                        <span className={`text-lg font-mono font-bold ${calculatedMarginRatio >= 50 ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {calculatedMarginRatio.toFixed(1)}%
                        </span>
                        <span className="text-slate-700 text-[10px]">/</span>
                        <div className={`flex items-baseline gap-1 text-[13px] font-mono font-bold ${totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            <span>{totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(1)}</span>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col justify-center pl-3 border-l border-slate-800/50">
                    <span className="text-[9px] text-slate-500 font-bold uppercase mb-0.5">持仓/多/空 (U)</span>
                    <div className="flex items-baseline gap-1">
                        <span className="text-lg font-mono text-white font-bold">{totalPositionValue.toFixed(0)}</span>
                        <span className="text-slate-700 text-[10px]">/</span>
                        <span className="text-md font-mono text-emerald-400">{longValue.toFixed(0)}</span>
                        <span className="text-slate-700 text-[10px]">/</span>
                        <span className="text-md font-mono text-red-400">{shortValue.toFixed(0)}</span>
                    </div>
                </div>

                <div className="flex flex-col justify-center pl-3 border-l border-slate-800/50">
                    <span className="text-[9px] text-slate-500 font-bold uppercase mb-0.5">系统负债 (H-SL)</span>
                    <div className="flex items-baseline gap-1">
                        <span className="text-lg font-mono text-amber-500 font-bold">{totalHedgeSLAmount.toFixed(1)}</span>
                        <span className="text-[10px] text-slate-600 ml-1 font-bold">U</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
