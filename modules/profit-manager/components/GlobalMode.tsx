
import React from 'react';
import { ProfitSettings, SmartProfitTier } from '../../../types';
import { Globe, DollarSign, Percent, Plus, Trash2 } from 'lucide-react';

interface Props {
    settings: ProfitSettings;
    updateNested: (subsection: string, key: string, value: any) => void;
}

export const GlobalMode: React.FC<Props> = ({ settings, updateNested }) => {
    const config = settings.global;
    const tiers = Array.isArray(config.tiers) ? config.tiers : [];

    const addTier = () => {
        const lastTier = tiers[tiers.length - 1] || { threshold: 0, callback: 1, expiry: 2 };
        const newTier: SmartProfitTier = {
            threshold: lastTier.expiry,
            callback: Math.max(0.2, lastTier.callback - 0.2),
            expiry: lastTier.expiry + (lastTier.expiry - lastTier.threshold || 2)
        };
        updateNested('global', 'tiers', [...tiers, newTier]);
    };

    const removeTier = (index: number) => {
        updateNested('global', 'tiers', tiers.filter((_, i) => i !== index));
    };

    const updateTier = (index: number, key: keyof SmartProfitTier, value: number) => {
        const newTiers = [...tiers];
        newTiers[index] = { ...newTiers[index], [key]: value };
        updateNested('global', 'tiers', newTiers);
    };

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
            <div className="space-y-2 border-b border-slate-700/50 pb-3">
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

            {/* Global Step-by-Step Safety Floor Lock Scheme */}
            <div className="space-y-2">
                <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                        <div 
                            onClick={() => updateNested('global', 'conventionalEnabled', !config.conventionalEnabled)} 
                            className={`w-3 h-3 rounded border flex items-center justify-center cursor-pointer transition-colors ${config.conventionalEnabled ? 'bg-indigo-600 border-indigo-500' : 'border-slate-600'}`}
                        >
                            {config.conventionalEnabled && <div className="w-1.5 h-1.5 bg-white rounded-full shadow-sm" />}
                        </div>
                        <span className="text-[10px] text-slate-300 font-bold">全局阶梯保底锁定方案</span>
                    </div>
                    {config.conventionalEnabled && (
                        <button 
                            onClick={addTier}
                            className="text-[9px] bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 px-2 py-0.5 rounded border border-slate-700 flex items-center gap-1 transition-all"
                        >
                            <Plus size={10} /> 增加阶梯
                        </button>
                    )}
                </div>

                {config.conventionalEnabled && (
                    <div className="space-y-1 max-h-[160px] overflow-y-auto pr-1 custom-scrollbar">
                        {tiers.length === 0 ? (
                            <div className="text-center py-4 text-[9px] text-slate-600 italic border border-dashed border-slate-800 rounded">
                                点击“增加阶梯”开始配置
                            </div>
                        ) : (
                            tiers.map((tier, idx) => (
                                <div key={idx} className="bg-slate-800/40 border border-slate-700/50 rounded p-2 flex items-center gap-2 group/tier animate-in slide-in-from-right-2 duration-300">
                                    <div className="w-4 h-4 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center text-[8px] text-slate-500 flex-shrink-0 group-hover/tier:border-indigo-500/50 group-hover/tier:text-indigo-400 transition-colors">
                                        {idx + 1}
                                    </div>
                                    <div className="grid grid-cols-3 gap-1 flex-1">
                                        <div className="flex flex-col">
                                            <span className="text-[7px] text-slate-500 scale-90 origin-left">阈值%</span>
                                            <input 
                                                type="number" 
                                                value={tier.threshold}
                                                onChange={(e) => updateTier(idx, 'threshold', Number(e.target.value))}
                                                className="bg-slate-900/60 border border-slate-700 rounded px-1 py-0.5 text-[10px] font-mono text-emerald-400 focus:outline-none"
                                            />
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[7px] text-slate-500 scale-90 origin-left">回撤%</span>
                                            <input 
                                                type="number" 
                                                value={tier.callback}
                                                onChange={(e) => updateTier(idx, 'callback', Number(e.target.value))}
                                                className="bg-slate-900/60 border border-slate-700 rounded px-1 py-0.5 text-[10px] font-mono text-orange-400 focus:outline-none"
                                            />
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[7px] text-slate-500 scale-90 origin-left">失效%</span>
                                            <input 
                                                type="number" 
                                                value={tier.expiry}
                                                onChange={(e) => updateTier(idx, 'expiry', Number(e.target.value))}
                                                className="bg-slate-900/60 border border-slate-700 rounded px-1 py-0.5 text-[10px] font-mono text-indigo-400 focus:outline-none"
                                            />
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => removeTier(idx)}
                                        className="p-1 text-slate-600 hover:text-red-400 hover:bg-red-950/20 rounded transition-colors"
                                    >
                                        <Trash2 size={10} />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
