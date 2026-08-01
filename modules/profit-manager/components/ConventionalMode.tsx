
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

            <div className="border-t border-slate-800/60 my-2" />

            {/* 托底平仓规则 */}
            <div className="flex items-center justify-between group">
                <div className="flex flex-col">
                    <label className="text-[10px] font-bold text-slate-300 group-hover:text-slate-200 transition-colors flex items-center gap-1.5 select-none">
                        🛡️ 托底平仓规则
                    </label>
                    <span className="text-[8px] text-slate-500">盈利达标后又回撤，至剩余盈利比例时平仓</span>
                </div>
                <input 
                    type="checkbox" 
                    checked={config.trailingEnabled ?? false} 
                    onChange={(e) => updateNested('conventional', 'trailingEnabled', e.target.checked)}
                    className="accent-emerald-500 h-3.5 w-3.5 cursor-pointer rounded bg-slate-800 border-slate-700"
                />
            </div>

            {(config.trailingEnabled ?? false) && (
                <div className="pl-3 border-l border-emerald-500/20 space-y-3 mt-2 animate-in fade-in slide-in-from-left-1 duration-200">
                    <div className="flex items-center justify-between group">
                        <div className="flex flex-col">
                            <label className="text-[10px] text-slate-400 group-hover:text-slate-200 transition-colors">当盈利大于 (%)</label>
                            <span className="text-[8px] text-slate-500">满足托底保护的触发门槛</span>
                        </div>
                        <div className="flex items-center bg-slate-800 rounded px-2 py-1 border border-slate-700 focus-within:border-emerald-500/50 transition-all">
                            <input 
                                type="number" 
                                step="0.1"
                                value={config.trailingTriggerProfit ?? 5} 
                                onChange={(e) => updateNested('conventional', 'trailingTriggerProfit', Number(e.target.value))}
                                className="w-16 bg-transparent text-right text-[11px] font-mono focus:outline-none text-emerald-400"
                            />
                            <span className="text-[9px] text-slate-500 ml-1">%</span>
                        </div>
                    </div>

                    <div className="flex items-center justify-between group">
                        <div className="flex flex-col">
                            <label className="text-[10px] text-slate-400 group-hover:text-slate-200 transition-colors">盈利还剩余 (%) 时平仓</label>
                            <span className="text-[8px] text-slate-500">从高点滑落至此盈利比率即平仓</span>
                        </div>
                        <div className="flex items-center bg-slate-800 rounded px-2 py-1 border border-slate-700 focus-within:border-emerald-500/50 transition-all">
                            <input 
                                type="number" 
                                step="0.1"
                                value={config.trailingRemainingProfit ?? 2} 
                                onChange={(e) => updateNested('conventional', 'trailingRemainingProfit', Number(e.target.value))}
                                className="w-16 bg-transparent text-right text-[11px] font-mono focus:outline-none text-rose-400"
                            />
                            <span className="text-[9px] text-slate-500 ml-1">%</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
