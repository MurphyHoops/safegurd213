
import React from 'react';
import { ProfitSettings, TrailingTier } from '../../../types';
import { Plus, Trash2 } from 'lucide-react';

interface Props {
    settings: ProfitSettings;
    updateNested: (subsection: string, key: string, value: any) => void;
}

export const ConventionalMode: React.FC<Props> = ({ settings, updateNested }) => {
    const config = settings.conventional;
    const trailingTiers = Array.isArray(config.trailingTiers) ? config.trailingTiers : [];

    const addTrailingTier = () => {
        const newTiers = [...trailingTiers, { threshold: 6, floor: 2 }];
        updateNested('conventional', 'trailingTiers', newTiers);
    };

    const removeTrailingTier = (index: number) => {
        const newTiers = trailingTiers.filter((_, idx) => idx !== index);
        updateNested('conventional', 'trailingTiers', newTiers);
    };

    const updateTrailingTier = (index: number, field: keyof TrailingTier, value: number) => {
        const newTiers = trailingTiers.map((t, idx) => idx === index ? { ...t, [field]: value } : t);
        updateNested('conventional', 'trailingTiers', newTiers);
    };

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
                    {/* Header with add button */}
                    <div className="flex items-center justify-between">
                        <span className="text-[9px] font-bold text-slate-400">多组阶梯式托底</span>
                        <button 
                            type="button"
                            onClick={addTrailingTier}
                            className="text-[8px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded border border-slate-700 flex items-center gap-1 transition-all"
                        >
                            <Plus size={8} /> 增加阶梯
                        </button>
                    </div>

                    {/* Trailing Tiers list */}
                    <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1 custom-scrollbar">
                        {trailingTiers.length === 0 ? (
                            <div className="text-center py-2 text-[8px] text-slate-500 italic border border-dashed border-slate-800/80 rounded">
                                未配置多组阶梯，将使用下方单组托底
                            </div>
                        ) : (
                            trailingTiers.map((tier, idx) => (
                                <div key={idx} className="bg-slate-800/30 border border-slate-700/40 rounded p-1.5 flex items-center gap-2 group/tier animate-in slide-in-from-right-1 duration-200">
                                    <div className="w-3.5 h-3.5 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center text-[7px] text-slate-500 flex-shrink-0 group-hover/tier:border-emerald-500/50 group-hover/tier:text-emerald-400 transition-colors">
                                        {idx + 1}
                                    </div>
                                    <div className="grid grid-cols-2 gap-1.5 flex-1">
                                        <div className="flex flex-col">
                                            <span className="text-[7px] text-slate-500 scale-90 origin-left">触发盈利%</span>
                                            <div className="flex items-center bg-slate-900/60 border border-slate-700 rounded px-1.5 py-0.5">
                                                <input 
                                                    type="number" 
                                                    step="0.1"
                                                    value={tier.threshold}
                                                    onChange={(e) => updateTrailingTier(idx, 'threshold', Number(e.target.value))}
                                                    className="w-full bg-transparent text-right text-[10px] font-mono text-emerald-400 focus:outline-none"
                                                />
                                                <span className="text-[7px] text-slate-600 ml-0.5">%</span>
                                            </div>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[7px] text-slate-500 scale-90 origin-left">托底盈利%</span>
                                            <div className="flex items-center bg-slate-900/60 border border-slate-700 rounded px-1.5 py-0.5">
                                                <input 
                                                    type="number" 
                                                    step="0.1"
                                                    value={tier.floor}
                                                    onChange={(e) => updateTrailingTier(idx, 'floor', Number(e.target.value))}
                                                    className="w-full bg-transparent text-right text-[10px] font-mono text-rose-400 focus:outline-none"
                                                />
                                                <span className="text-[7px] text-slate-600 ml-0.5">%</span>
                                            </div>
                                        </div>
                                    </div>
                                    <button 
                                        type="button"
                                        onClick={() => removeTrailingTier(idx)}
                                        className="p-1 text-slate-500 hover:text-red-400 hover:bg-red-950/20 rounded transition-colors self-end"
                                    >
                                        <Trash2 size={10} />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>

                    <div className="border-t border-slate-800/40 my-1" />

                    {/* Single tier as fallback / secondary */}
                    <div className="space-y-2">
                        <div className="text-[8px] text-slate-500 uppercase tracking-wider select-none font-semibold">单组默认托底 (备用)</div>
                        
                        <div className="flex items-center justify-between group">
                            <div className="flex flex-col">
                                <label className="text-[10px] text-slate-400 group-hover:text-slate-200 transition-colors">当盈利大于 (%)</label>
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
                </div>
            )}
        </div>
    );
};
