
import React from 'react';
import { ProfitSettings } from '../../../types';
import { Cpu, Zap, Activity, ShieldCheck, Thermometer } from 'lucide-react';

interface Props {
    settings: ProfitSettings;
    updateNested: (subsection: string, key: string, value: any) => void;
    onOpenSaviorLab?: (tab: 'DNA' | 'BACKTEST') => void;
}

export const AiMode: React.FC<Props> = ({ settings, updateNested, onOpenSaviorLab }) => {
    const config = settings.ai || { sensitivity: 5, aggressiveness: 5, minPosition: 100, activationProfit: 60 };

    const updateAi = (key: string, value: any) => {
        updateNested('ai', key, value);
    };

    return (
        <div className="space-y-5 animate-in fade-in slide-in-from-top-1 duration-300">
            {/* Header info */}
            <div className="flex gap-3">
                <div className="flex-1 bg-gradient-to-br from-indigo-900/20 to-purple-900/10 border border-indigo-500/30 rounded-lg p-3 relative group">
                    <div className="flex items-center gap-2 mb-1.5">
                        <div className="p-1 bg-indigo-500/20 rounded shadow-[0_0_10px_rgba(99,102,241,0.3)]">
                            <Cpu size={14} className="text-indigo-400 animate-pulse" />
                        </div>
                        <span className="text-[11px] font-black text-white italic tracking-tighter">AI ORACLE v2.0</span>
                    </div>
                    <p className="text-[9px] text-slate-400 leading-relaxed mb-3">AI 预言机基于 5D 实时动能数据进行动态锁定。能够感知极端的抛物线顶峰并执行毫秒级平仓。</p>
                    
                    <button 
                        onClick={() => onOpenSaviorLab?.('DNA')}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold rounded shadow-lg transition-all active:scale-95 group"
                    >
                        <Activity size={12} className="group-hover:rotate-12 transition-transform" /> 进入 AI 训练实验室 (Savior Lab)
                    </button>
                </div>
            </div>

            {/* AI Controls */}
            <div className="space-y-4">
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                            <Zap size={12} className="text-amber-400" />
                            <span className="text-[10px] font-bold text-slate-300 uppercase">感知灵敏度 (Sensitivity)</span>
                        </div>
                        <span className="text-[11px] font-mono text-amber-400">{config.sensitivity}</span>
                    </div>
                    <input 
                        type="range" 
                        min="1" 
                        max="10" 
                        step="1"
                        value={config.sensitivity}
                        onChange={(e) => updateAi('sensitivity', Number(e.target.value))}
                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                    />
                    <div className="flex justify-between text-[8px] text-slate-600 px-1 font-mono uppercase">
                        <span>Conservative</span>
                        <span>Hyper-Sensitive</span>
                    </div>
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                            <ShieldCheck size={12} className="text-emerald-400" />
                            <span className="text-[10px] font-bold text-slate-300 uppercase">贪婪指数 (Greed Bias)</span>
                        </div>
                        <span className="text-[11px] font-mono text-emerald-400">{config.aggressiveness}</span>
                    </div>
                    <input 
                        type="range" 
                        min="1" 
                        max="10" 
                        step="1"
                        value={config.aggressiveness}
                        onChange={(e) => updateAi('aggressiveness', Number(e.target.value))}
                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    />
                    <div className="flex justify-between text-[8px] text-slate-600 px-1 font-mono uppercase">
                        <span>Safe Exit</span>
                        <span>Moon Search</span>
                    </div>
                </div>
            </div>

            {/* Thresholds */}
            <div className="grid grid-cols-2 gap-3 pt-1">
                 <div className="bg-black/40 border border-slate-800 rounded p-2 transition-colors hover:border-slate-700">
                    <div className="flex items-center gap-1 mb-1 opacity-60">
                        <Activity size={10} className="text-slate-400" />
                        <span className="text-[9px] text-slate-500 font-mono">THRESHOLD</span>
                    </div>
                    <div className="text-[12px] font-mono font-bold text-slate-200">
                        <input 
                            type="number" 
                            value={config.activationProfit} 
                            onChange={(e) => updateAi('activationProfit', Number(e.target.value))}
                            className="w-full bg-transparent focus:outline-none"
                        />
                        <span className="text-[9px] text-slate-600 font-normal">% AI收割线</span>
                    </div>
                 </div>
                 <div className="bg-black/40 border border-slate-800 rounded p-2 transition-colors hover:border-slate-700">
                    <div className="flex items-center gap-1 mb-1 opacity-60">
                        <Thermometer size={10} className="text-slate-400" />
                        <span className="text-[9px] text-slate-500 font-mono">MIN VALUE</span>
                    </div>
                    <div className="text-[12px] font-mono font-bold text-slate-200">
                        <input 
                            type="number" 
                            value={config.minPosition} 
                            onChange={(e) => updateAi('minPosition', Number(e.target.value))}
                            className="w-full bg-transparent focus:outline-none"
                        />
                        <span className="text-[9px] text-slate-600 font-normal"> USDT</span>
                    </div>
                 </div>
            </div>
        </div>
    );
};
