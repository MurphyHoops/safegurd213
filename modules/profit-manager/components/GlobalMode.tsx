
import React from 'react';
import { ProfitSettings } from '../../../types';
import { Globe, DollarSign, Percent } from 'lucide-react';

interface Props {
    settings: ProfitSettings;
    updateNested: (subsection: string, key: string, value: any) => void;
}

export const GlobalMode: React.FC<Props> = ({ settings, updateNested }) => {
    const config = settings.global;

    return (
        <div className="space-y-4 animate-in fade-in slide-in-from-top-1 duration-300">
            <div className="flex items-center gap-2 mb-1 p-2 bg-indigo-900/10 border border-indigo-500/20 rounded-lg">
                <Globe size={14} className="text-indigo-400" />
                <span className="text-[10px] text-indigo-300 font-medium">全局止盈止损将计算所有活跃持仓的总盈亏</span>
            </div>

            {/* Profit Targets */}
            <div className="space-y-2 border-b border-slate-700/50 pb-3">
                <div className="flex items-center gap-1.5 mb-1">
                    <DollarSign size={12} className="text-emerald-400" />
                    <span className="text-[10px] font-bold text-slate-300">总金额目标 (USDT)</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-800/40 p-2 rounded border border-slate-700 group hover:border-emerald-500/30 transition-all">
                        <label className="text-[9px] text-slate-500 block mb-1">全局总止盈金额</label>
                        <div className="flex items-center gap-1">
                            <span className="text-[9px] text-emerald-500">+</span>
                            <input 
                                type="number" 
                                value={config.profitAmount} 
                                onChange={(e) => updateNested('global', 'profitAmount', Number(e.target.value))}
                                className="w-full bg-transparent text-[11px] font-mono text-emerald-400 focus:outline-none"
                            />
                        </div>
                    </div>
                    <div className="bg-slate-800/40 p-2 rounded border border-slate-700 group hover:border-red-500/30 transition-all">
                        <label className="text-[9px] text-slate-500 block mb-1">全局总止损金额</label>
                        <div className="flex items-center gap-1">
                            <span className="text-[9px] text-red-500">-</span>
                            <input 
                                type="number" 
                                value={config.lossAmount} 
                                onChange={(e) => updateNested('global', 'lossAmount', Number(e.target.value))}
                                className="w-full bg-transparent text-[11px] font-mono text-red-400 focus:outline-none"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Percentage Targets */}
            <div className="space-y-2">
                <div className="flex items-center gap-1.5 mb-1">
                    <Percent size={12} className="text-cyan-400" />
                    <span className="text-[10px] font-bold text-slate-300">总资产比例目标 (%)</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-800/40 p-2 rounded border border-slate-700 group hover:border-emerald-500/30 transition-all">
                        <label className="text-[9px] text-slate-500 block mb-1">收益率目标</label>
                        <div className="flex items-center gap-1">
                            <span className="text-[9px] text-emerald-500">+</span>
                            <input 
                                type="number" 
                                step="0.1"
                                value={config.profitPercent} 
                                onChange={(e) => updateNested('global', 'profitPercent', Number(e.target.value))}
                                className="w-full bg-transparent text-[11px] font-mono text-emerald-400 focus:outline-none"
                            />
                            <span className="text-[9px] text-slate-600">%</span>
                        </div>
                    </div>
                    <div className="bg-slate-800/40 p-2 rounded border border-slate-700 group hover:border-red-500/30 transition-all">
                        <label className="text-[9px] text-slate-500 block mb-1">亏损率红线</label>
                        <div className="flex items-center gap-1">
                            <span className="text-[9px] text-red-500">-</span>
                            <input 
                                type="number" 
                                step="0.1"
                                value={config.lossPercent} 
                                onChange={(e) => updateNested('global', 'lossPercent', Number(e.target.value))}
                                className="w-full bg-transparent text-[11px] font-mono text-red-400 focus:outline-none"
                            />
                            <span className="text-[9px] text-slate-600">%</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
