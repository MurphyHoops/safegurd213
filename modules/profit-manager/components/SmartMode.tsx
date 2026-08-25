
import React from 'react';
import { ProfitSettings, SmartProfitTier } from '../../../types';
import { Plus, Trash2, Zap, Sparkles } from 'lucide-react';

interface Props {
    settings: ProfitSettings;
    updateNested: (subsection: string, key: string, value: any) => void;
}

export const SmartMode: React.FC<Props> = ({ settings, updateNested }) => {
    const config = settings.smart;
    const isSmartEnabled = config.enabled ?? false;
    const isDecayEnabled = config.decayEnabled ?? true;
    const tiers = Array.isArray(config.tiers) ? config.tiers : [];

    const addTier = () => {
        const lastTier = tiers[tiers.length - 1] || { threshold: 0, callback: 1, expiry: 2 };
        const newTier: SmartProfitTier = {
            threshold: lastTier.expiry,
            callback: Math.max(0.2, lastTier.callback - 0.2),
            expiry: lastTier.expiry + (lastTier.expiry - lastTier.threshold)
        };
        updateNested('smart', 'tiers', [...tiers, newTier]);
    };

    const removeTier = (index: number) => {
        updateNested('smart', 'tiers', tiers.filter((_, i) => i !== index));
    };

    const updateTier = (index: number, key: keyof SmartProfitTier, value: number) => {
        const newTiers = [...tiers];
        newTiers[index] = { ...newTiers[index], [key]: value };
        updateNested('smart', 'tiers', newTiers);
    };

    return (
        <div className="space-y-4 animate-in fade-in slide-in-from-top-1 duration-300">
            {/* 智能止盈总开关 (Smart Master Switch) */}
            <div className={`p-2.5 rounded border transition-colors flex items-center justify-between ${
                isSmartEnabled 
                    ? 'bg-emerald-950/30 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.15)]' 
                    : 'bg-slate-800/30 border-slate-700/60'
            }`}>
                <div className="flex items-center gap-2">
                    <div className={`p-1 rounded ${isSmartEnabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700/40 text-slate-500'}`}>
                        <Sparkles size={13} />
                    </div>
                    <div className="flex flex-col">
                        <span className={`text-[11px] font-bold ${isSmartEnabled ? 'text-emerald-300' : 'text-slate-400'}`}>
                            智能止盈总开关
                        </span>
                        <span className="text-[8px] text-slate-500">
                            {isSmartEnabled ? '已开启：智能平仓规则将正式参与计算' : '未开启：仅浏览/配置参数，系统绝不触发智能平仓'}
                        </span>
                    </div>
                </div>
                <div 
                    onClick={() => updateNested('smart', 'enabled', !isSmartEnabled)} 
                    className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${isSmartEnabled ? 'bg-emerald-600' : 'bg-slate-700'}`}
                    title={isSmartEnabled ? '点击关闭智能止盈' : '点击开启智能止盈'}
                >
                    <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${isSmartEnabled ? 'translate-x-4' : 'translate-x-0'}`}/>
                </div>
            </div>

            {/* AI Optimization Mode - 指数衰减锁定模式 */}
            <div className={`border rounded p-3 relative overflow-hidden group transition-colors ${
                isDecayEnabled && isSmartEnabled
                    ? 'bg-emerald-950/20 border-emerald-500/30' 
                    : 'bg-slate-800/20 border-slate-700/40 opacity-75'
            }`}>
                <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-30 transition-opacity pointer-events-none">
                    <Zap size={40} className="text-emerald-400" />
                </div>
                <div className="flex items-center justify-between mb-3 relative z-10">
                    <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                            <span className={`text-[10px] font-bold ${isDecayEnabled && isSmartEnabled ? 'text-emerald-400' : 'text-slate-400'}`}>
                                指数衰减锁定模式
                            </span>
                        </div>
                        <span className="text-[8px] text-slate-500">根据盈利倍数动态调整回撤容忍度</span>
                    </div>
                    {/* 指数衰减锁定模式单独开关 */}
                    <div 
                        onClick={() => updateNested('smart', 'decayEnabled', !isDecayEnabled)}
                        className={`w-7 h-3.5 rounded-full p-0.5 cursor-pointer transition-colors ${isDecayEnabled ? 'bg-emerald-600' : 'bg-slate-700'}`}
                        title={isDecayEnabled ? '点击关闭指数衰减锁定模式' : '点击开启指数衰减锁定模式'}
                    >
                        <div className={`w-2.5 h-2.5 bg-white rounded-full transition-transform ${isDecayEnabled ? 'translate-x-3.5' : 'translate-x-0'}`} />
                    </div>
                </div>
                
                <div className="flex items-center justify-between group/item relative z-10">
                    <label className="text-[10px] text-slate-400 group-hover/item:text-slate-200 transition-colors">激活收益率 (%)</label>
                    <div className="flex items-center bg-slate-900/60 rounded px-2 py-1 border border-slate-700 focus-within:border-emerald-500/50 transition-all">
                        <input 
                            type="number" 
                            value={config.activationProfit} 
                            onChange={(e) => updateNested('smart', 'activationProfit', Number(e.target.value))}
                            className="w-16 bg-transparent text-right text-[11px] font-mono focus:outline-none text-emerald-400"
                        />
                        <span className="text-[9px] text-slate-500 ml-1">%</span>
                    </div>
                </div>
            </div>

            {/* Step-by-Step Recovery Mode - 阶梯保底锁定方案 */}
            <div className="space-y-2">
                <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                        <div 
                            onClick={() => updateNested('smart', 'conventionalEnabled', !config.conventionalEnabled)} 
                            className={`w-3 h-3 rounded border flex items-center justify-center cursor-pointer transition-colors ${config.conventionalEnabled ? 'bg-indigo-600 border-indigo-500' : 'border-slate-600'}`}
                        >
                            {config.conventionalEnabled && <div className="w-1.5 h-1.5 bg-white rounded-full shadow-sm" />}
                        </div>
                        <span className="text-[10px] text-slate-300 font-bold">阶梯保底锁定方案</span>
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
