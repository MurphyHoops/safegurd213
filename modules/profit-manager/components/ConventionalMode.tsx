
// 🔒 LOCKED_MODULE: 模块 1 [多级阶梯式保底平仓 / 常规止盈配置组件]
// @LOCKED: 严格原子化锁定。未经用户明确下达的专属指令，严禁擅自触碰、修改、重构或变动任何算法与流转逻辑。

import React, { useMemo } from 'react';
import { ProfitSettings, VariableTrailingTier } from '../../../types';
import { Plus, Trash2, Shield, Sparkles } from 'lucide-react';

interface Props {
    settings: ProfitSettings;
    updateNested: (subsection: string, key: string, value: any) => void;
}

const DEFAULT_VARIABLE_TIERS: VariableTrailingTier[] = [
    { minProfit: 1, maxProfit: 10, retentionPercent: 30 },
    { minProfit: 10, maxProfit: 30, retentionPercent: 33 },
    { minProfit: 30, maxProfit: 50, retentionPercent: 35 },
    { minProfit: 50, maxProfit: 70, retentionPercent: 40 },
    { minProfit: 70, maxProfit: 100, retentionPercent: 45 },
    { minProfit: 100, maxProfit: 150, retentionPercent: 50 },
    { minProfit: 150, maxProfit: 250, retentionPercent: 55 },
    { minProfit: 250, maxProfit: 400, retentionPercent: 60 },
    { minProfit: 400, maxProfit: 600, retentionPercent: 65 },
    { minProfit: 600, maxProfit: 900, retentionPercent: 70 },
    { minProfit: 900, maxProfit: 3000, retentionPercent: 75 }
];

export const ConventionalMode: React.FC<Props> = ({ settings, updateNested }) => {
    const config = settings.conventional;
    const rawVariableTiers = config.variableTrailingTiers;
    
    // Auto-heal and normalize data from localStorage
    const variableTiers: VariableTrailingTier[] = useMemo(() => {
        if (!Array.isArray(rawVariableTiers) || rawVariableTiers.length === 0) {
            return DEFAULT_VARIABLE_TIERS;
        }
        const isValid = rawVariableTiers.every(
            (t) => typeof t?.minProfit === 'number' && typeof t?.maxProfit === 'number' && typeof t?.retentionPercent === 'number'
        );
        if (!isValid) {
            return DEFAULT_VARIABLE_TIERS;
        }
        return rawVariableTiers;
    }, [rawVariableTiers]);

    const addVariableTier = () => {
        const lastTier = variableTiers[variableTiers.length - 1] || { minProfit: 1, maxProfit: 10, retentionPercent: 30 };
        const newTier: VariableTrailingTier = {
            minProfit: lastTier.maxProfit,
            maxProfit: lastTier.maxProfit * 1.5,
            retentionPercent: Math.min(95, lastTier.retentionPercent + 5)
        };
        updateNested('conventional', 'variableTrailingTiers', [...variableTiers, newTier]);
    };

    const removeVariableTier = (index: number) => {
        const newTiers = variableTiers.filter((_, idx) => idx !== index);
        updateNested('conventional', 'variableTrailingTiers', newTiers);
    };

    const updateVariableTier = (index: number, field: keyof VariableTrailingTier, value: number) => {
        const newTiers = variableTiers.map((t, idx) => idx === index ? { ...t, [field]: value } : t);
        updateNested('conventional', 'variableTrailingTiers', newTiers);
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

            {/* 变量托底平仓规则 */}
            <div className="flex items-center justify-between group">
                <div className="flex flex-col">
                    <label className="text-[11px] font-bold text-slate-200 group-hover:text-emerald-300 transition-colors flex items-center gap-1.5 select-none">
                        <Shield size={14} className="text-emerald-400" /> 阶梯式变量托底平仓
                    </label>
                    <span className="text-[9px] text-slate-400 mt-0.5">按最高浮盈匹配阶梯区间，按比例动态锁定利润</span>
                </div>
                <input 
                    type="checkbox" 
                    checked={config.trailingEnabled ?? false} 
                    onChange={(e) => updateNested('conventional', 'trailingEnabled', e.target.checked)}
                    className="accent-emerald-500 h-4 w-4 cursor-pointer rounded bg-slate-800 border-slate-700"
                />
            </div>

            {(config.trailingEnabled ?? false) && (
                <div className="pl-3 border-l border-emerald-500/20 space-y-3 mt-2 animate-in fade-in slide-in-from-left-1 duration-200">
                    {/* 激活起征点 */}
                    <div className="flex items-center justify-between group bg-slate-900/60 p-2.5 rounded border border-slate-800">
                        <div className="flex flex-col">
                            <div className="flex items-center gap-1.5">
                                <Sparkles size={13} className="text-emerald-400" />
                                <span className="text-[11px] font-bold text-slate-200">激活起征点盈利 (%)</span>
                            </div>
                            <span className="text-[9px] text-slate-400 mt-0.5">最高盈利达到此值时正式启动变量托底</span>
                        </div>
                        <div className="flex items-center bg-slate-800 rounded px-2.5 py-1 border border-slate-700 focus-within:border-emerald-500/50 transition-all">
                            <input 
                                type="number" 
                                step="0.1"
                                value={config.trailingTriggerProfit ?? 1} 
                                onChange={(e) => updateNested('conventional', 'trailingTriggerProfit', Number(e.target.value))}
                                className="w-16 bg-transparent text-right text-[12px] font-mono focus:outline-none text-emerald-400 font-bold"
                            />
                            <span className="text-[10px] text-slate-400 ml-1">%</span>
                        </div>
                    </div>

                    {/* Header with add button */}
                    <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-slate-200">多级阶梯式保底留存表</span>
                            <span className="text-[9px] text-slate-400">({variableTiers.length} 阶)</span>
                        </div>
                        <button 
                            type="button"
                            onClick={addVariableTier}
                            className="text-[9px] bg-slate-800 hover:bg-slate-700 text-slate-200 px-2 py-0.5 rounded border border-slate-700 flex items-center gap-1 transition-all shadow-sm font-medium"
                        >
                            <Plus size={10} /> 增加阶梯
                        </button>
                    </div>

                    {/* Unified Table Header */}
                    <div className="grid grid-cols-[16px_1fr_auto_1fr_46px_20px] gap-1 items-center px-1.5 py-1 bg-slate-900/80 rounded border border-slate-800 text-[10px] font-bold select-none text-center">
                        <span className="text-slate-500">#</span>
                        <span className="text-emerald-400 text-left pl-1">起始%</span>
                        <span className="text-slate-500 text-[9px]">~</span>
                        <span className="text-cyan-400 text-left pl-1">截止%</span>
                        <span className="text-amber-400">保底%</span>
                        <span className="text-slate-500 text-[9px]">操作</span>
                    </div>

                    {/* Variable Trailing Tiers list */}
                    <div className="space-y-1 max-h-[300px] overflow-y-auto pr-0.5 custom-scrollbar">
                        {variableTiers.length === 0 ? (
                            <div className="text-center py-3 text-[10px] text-slate-400 italic border border-dashed border-slate-800/80 rounded">
                                点击上方“增加阶梯”添加规则
                            </div>
                        ) : (
                            variableTiers.map((tier, idx) => (
                                <div key={idx} className="grid grid-cols-[16px_1fr_auto_1fr_46px_20px] gap-1 items-center bg-slate-800/60 hover:bg-slate-800/90 border border-slate-700/60 rounded p-1 group/tier transition-colors">
                                    {/* 序号 */}
                                    <span className="text-center text-[9px] font-bold text-slate-400">
                                        {idx + 1}
                                    </span>

                                    {/* 起始% */}
                                    <div className="flex items-center bg-slate-900/90 border border-slate-700 rounded px-1 py-0.5 focus-within:border-emerald-500/80 transition-all overflow-hidden">
                                        <input 
                                            type="number" 
                                            step="0.1"
                                            value={tier.minProfit ?? ''}
                                            onChange={(e) => updateVariableTier(idx, 'minProfit', Number(e.target.value))}
                                            className="w-full bg-transparent text-center text-[11px] font-mono font-bold text-emerald-400 focus:outline-none p-0"
                                        />
                                    </div>

                                    {/* ~ 分隔符 */}
                                    <span className="text-slate-500 text-[9px] font-bold text-center">~</span>

                                    {/* 截止% */}
                                    <div className="flex items-center bg-slate-900/90 border border-slate-700 rounded px-1 py-0.5 focus-within:border-cyan-500/80 transition-all overflow-hidden">
                                        <input 
                                            type="number" 
                                            step="0.1"
                                            value={tier.maxProfit ?? ''}
                                            onChange={(e) => updateVariableTier(idx, 'maxProfit', Number(e.target.value))}
                                            className="w-full bg-transparent text-center text-[11px] font-mono font-bold text-cyan-400 focus:outline-none p-0"
                                        />
                                    </div>

                                    {/* 保底留存% - 固定 46px */}
                                    <div className="flex items-center bg-slate-900/90 border border-slate-700 rounded px-1 py-0.5 focus-within:border-amber-500/80 transition-all overflow-hidden">
                                        <input 
                                            type="number" 
                                            step="0.1"
                                            max="100"
                                            value={tier.retentionPercent ?? ''}
                                            onChange={(e) => updateVariableTier(idx, 'retentionPercent', Number(e.target.value))}
                                            className="w-full bg-transparent text-center text-[11px] font-mono font-bold text-amber-400 focus:outline-none p-0"
                                        />
                                        <span className="text-[8px] text-amber-400/80 font-bold ml-0.5">%</span>
                                    </div>

                                    {/* 删除操作 */}
                                    <button 
                                        type="button"
                                        onClick={() => removeVariableTier(idx)}
                                        className="w-5 h-5 flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-red-950/30 rounded transition-colors justify-self-center"
                                        title="删除此阶梯"
                                    >
                                        <Trash2 size={11} />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
