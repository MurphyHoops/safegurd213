
import React from 'react';
import { ProfitSettings } from '../../../types';

interface Props {
    settings: ProfitSettings;
    updateNested: (subsection: string, key: string, value: any) => void;
}

export const ConventionalMode: React.FC<Props> = ({ settings, updateNested }) => {
    const config = settings.conventional;

    return (
        <div className="space-y-3 animate-in fade-in slide-in-from-top-1 duration-300">
            <div className="flex items-center justify-between group">
                <label className="text-[10px] text-slate-400 group-hover:text-slate-200 transition-colors">激活门槛 (本金 USDT)</label>
                <div className="flex items-center bg-slate-800 rounded px-2 py-1 border border-slate-700 focus-within:border-emerald-500/50 transition-all">
                    <input 
                        type="number" 
                        value={config.minPosition} 
                        onChange={(e) => updateNested('conventional', 'minPosition', Number(e.target.value))}
                        className="w-16 bg-transparent text-right text-[11px] font-mono focus:outline-none"
                    />
                    <span className="text-[9px] text-slate-500 ml-1">U</span>
                </div>
            </div>

            <div className="flex items-center justify-between group">
                <label className="text-[10px] text-slate-400 group-hover:text-slate-200 transition-colors">触发收益率 (%)</label>
                <div className="flex items-center bg-slate-800 rounded px-2 py-1 border border-slate-700 focus-within:border-emerald-500/50 transition-all">
                    <input 
                        type="number" 
                        value={config.profitPercent} 
                        onChange={(e) => updateNested('conventional', 'profitPercent', Number(e.target.value))}
                        className="w-16 bg-transparent text-right text-[11px] font-mono focus:outline-none text-emerald-400"
                    />
                    <span className="text-[9px] text-slate-500 ml-1">%</span>
                </div>
            </div>

            <div className="flex items-center justify-between group">
                <div className="flex flex-col">
                    <label className="text-[10px] text-slate-400 group-hover:text-slate-200 transition-colors">回撤平仓比例 (%)</label>
                    <span className="text-[8px] text-slate-500">从最高点回跌达到此比例平仓</span>
                </div>
                <div className="flex items-center bg-slate-800 rounded px-2 py-1 border border-slate-700 focus-within:border-emerald-500/50 transition-all">
                    <input 
                        type="number" 
                        step="0.1"
                        value={config.callbackPercent} 
                        onChange={(e) => updateNested('conventional', 'callbackPercent', Number(e.target.value))}
                        className="w-16 bg-transparent text-right text-[11px] font-mono focus:outline-none text-orange-400"
                    />
                    <span className="text-[9px] text-slate-500 ml-1">%</span>
                </div>
            </div>

            <div className="flex items-center justify-between group">
                <label className="text-[10px] text-slate-400 group-hover:text-slate-200 transition-colors">平仓数量权重 (%)</label>
                <div className="flex items-center bg-slate-800 rounded px-2 py-1 border border-slate-700 focus-within:border-emerald-500/50 transition-all">
                    <input 
                        type="number" 
                        value={config.closePercent} 
                        onChange={(e) => updateNested('conventional', 'closePercent', Number(e.target.value))}
                        className="w-16 bg-transparent text-right text-[11px] font-mono focus:outline-none"
                    />
                    <span className="text-[9px] text-slate-500 ml-1">%</span>
                </div>
            </div>
        </div>
    );
};
