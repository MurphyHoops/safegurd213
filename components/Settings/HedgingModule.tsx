
import React from 'react';
import { HedgingSettings } from '../../types';
import { Activity } from 'lucide-react';

interface Props {
    settings: HedgingSettings;
    onChange: (key: string, value: any) => void;
}

const HedgingModule: React.FC<Props> = ({ settings, onChange }) => {
    return (
        <div className="p-4 bg-slate-800/30 space-y-4 border-b border-slate-800">
            <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400">对冲总开关</span>
                <div onClick={() => onChange('enabled', !settings.enabled)} className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.enabled ? 'bg-indigo-600' : 'bg-slate-700'}`}>
                    <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.enabled ? 'translate-x-4' : 'translate-x-0'}`}/>
                </div>
            </div>
            {settings.enabled && (
                <>
                     {/* Row 1: Min Position & Hedge Ratio */}
                     <div className="grid grid-cols-2 gap-3">
                         <div className="space-y-1">
                            <label className="text-[10px] text-slate-500 block">持仓触发门槛 (U)</label>
                            <input 
                                type="number" 
                                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white focus:border-indigo-500 font-mono" 
                                value={settings.minPosition} 
                                onChange={(e) => onChange('minPosition', parseFloat(e.target.value))} 
                            />
                         </div>
                         <div className="space-y-1">
                            <label className="text-[10px] text-slate-500 block">对冲仓位比例 (%)</label>
                            <input 
                                type="number" 
                                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white focus:border-indigo-500 font-mono" 
                                value={settings.hedgeRatio} 
                                onChange={(e) => onChange('hedgeRatio', parseFloat(e.target.value))} 
                            />
                         </div>
                     </div>

                     {/* Row 2: Loss Trigger & Trend Hedge */}
                     <div className="grid grid-cols-2 gap-3">
                         <div className="space-y-1">
                            <div className="flex items-center justify-between">
                                <label className="text-[10px] text-slate-500">亏损触发值 (%)</label>
                                {/* New Toggle for Loss Trigger */}
                                <div 
                                    onClick={() => onChange('triggerLossEnabled', !settings.triggerLossEnabled)} 
                                    className={`w-6 h-3 rounded-full p-0.5 transition-colors cursor-pointer ${settings.triggerLossEnabled !== false ? 'bg-red-600' : 'bg-slate-700'}`}
                                    title="开启/关闭基于亏损比例的对冲"
                                >
                                    <div className={`w-2 h-2 bg-white rounded-full shadow transition-transform ${settings.triggerLossEnabled !== false ? 'translate-x-3' : 'translate-x-0'}`}/>
                                </div>
                            </div>
                            <div className={`relative ${settings.triggerLossEnabled === false ? 'opacity-40 pointer-events-none' : ''}`}>
                                <input 
                                    type="number" 
                                    step="0.1"
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-red-400 focus:border-red-500 font-mono font-bold pl-5" 
                                    value={settings.triggerLossPercent} 
                                    onChange={(e) => onChange('triggerLossPercent', parseFloat(e.target.value))} 
                                />
                                <span className="absolute left-2 top-1.5 text-slate-500 text-xs">-</span>
                            </div>
                         </div>
                         
                         {/* Trend Hedge Toggle (Deprecated or Placeholder) -> Now effectively replaced/augmented by Break K-Line below */}
                         <div className={`rounded border border-slate-700 p-1.5 flex flex-col justify-center transition-colors ${settings.trendHedgeEnabled ? 'bg-indigo-900/20 border-indigo-500/50' : 'bg-slate-900'}`}>
                             <div className="flex items-center justify-between mb-0.5">
                                 <span className={`text-[10px] font-bold ${settings.trendHedgeEnabled ? 'text-indigo-300' : 'text-slate-500'}`}>趋势防爆 (基础)</span>
                                 <div onClick={() => onChange('trendHedgeEnabled', !settings.trendHedgeEnabled)} className={`w-7 h-3.5 rounded-full p-0.5 transition-colors cursor-pointer ${settings.trendHedgeEnabled ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                                     <div className={`w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${settings.trendHedgeEnabled ? 'translate-x-3.5' : 'translate-x-0'}`}/>
                                 </div>
                             </div>
                             <span className="text-[8px] text-slate-600 scale-90 origin-left block">
                                 EMA80 简单穿越触发
                             </span>
                         </div>
                     </div>

                     {/* Row 3: Break K-Line Logic (New) */}
                     <div className="mt-2 bg-slate-900/50 p-2 rounded border border-slate-700/50">
                         <div className="flex items-center justify-between mb-2">
                             <span className={`text-[10px] font-bold flex items-center gap-1 ${settings.breakKLineEnabled ? 'text-orange-400' : 'text-slate-500'}`}>
                                 <Activity size={10} /> 破K线防爆 (Grand Crossing)
                             </span>
                             <div 
                                onClick={() => onChange('breakKLineEnabled', !settings.breakKLineEnabled)} 
                                className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.breakKLineEnabled ? 'bg-orange-600' : 'bg-slate-700'}`}
                             >
                                 <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.breakKLineEnabled ? 'translate-x-4' : 'translate-x-0'}`}/>
                             </div>
                         </div>
                         
                         {settings.breakKLineEnabled && (
                             <div className="flex flex-col gap-2 animate-in fade-in">
                                 <div className="flex items-center gap-2">
                                     <div className="flex-1">
                                         <label className="text-[9px] text-slate-500 block mb-1">K线振幅比例 (%)</label>
                                         <div className="relative">
                                             <input 
                                                 type="number" 
                                                 className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-white font-bold text-center" 
                                                 value={settings.breakKLineRatio || 20} 
                                                 onChange={(e) => onChange('breakKLineRatio', parseFloat(e.target.value))} 
                                             />
                                             <span className="absolute right-6 top-1 text-[9px] text-slate-500">%</span>
                                         </div>
                                     </div>
                                 </div>
                                 <div className="flex items-center justify-between gap-2 border-t border-slate-700 pt-2">
                                     <label className="text-[10px] text-slate-500">亏损限制启动 (%)</label>
                                     <div className="flex items-center gap-2">
                                         <div 
                                             onClick={() => onChange('combinedLossLimitEnabled', !settings.combinedLossLimitEnabled)} 
                                             className={`w-6 h-3 rounded-full p-0.5 transition-colors cursor-pointer ${settings.combinedLossLimitEnabled ? 'bg-orange-600' : 'bg-slate-700'}`}
                                         >
                                             <div className={`w-2 h-2 bg-white rounded-full shadow transition-transform ${settings.combinedLossLimitEnabled ? 'translate-x-3' : 'translate-x-0'}`}/>
                                         </div>
                                         <input 
                                             type="number" 
                                             step="0.1"
                                             className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-orange-400 focus:border-orange-500 font-mono font-bold" 
                                             value={settings.combinedLossLimitPercent ?? 2} 
                                             onChange={(e) => onChange('combinedLossLimitPercent', parseFloat(e.target.value))} 
                                             disabled={!settings.combinedLossLimitEnabled}
                                         />
                                     </div>
                                 </div>
                                 <div className="text-[9px] text-slate-500 leading-tight">
                                     触发线 = 信号K线 ± (振幅 × {settings.breakKLineRatio || 20}%)<br/>
                                     <span className="text-[8px] opacity-60 text-orange-300 font-bold">* 信号K线：必须同时穿越 4根+ EMA均线 (10/20/30/40/80)</span>
                                 </div>
                             </div>
                         )}
                     </div>
                     
                     {/* Safe Clear Logic */}
                     <div className="mt-3 border-t border-slate-700/50 pt-3">
                         <div className="flex items-center justify-between mb-2">
                             <span className="text-[11px] font-bold text-indigo-300">防爆对冲安全止损清仓</span>
                             <div onClick={() => onChange('safeClearEnabled', !settings.safeClearEnabled)} className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.safeClearEnabled ? 'bg-indigo-600' : 'bg-slate-700'}`}>
                                 <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.safeClearEnabled ? 'translate-x-4' : 'translate-x-0'}`}/>
                             </div>
                         </div>
                         
                         {settings.safeClearEnabled && (
                             <>
                                 <div className="grid grid-cols-2 gap-2">
                                     <div>
                                         <label className="text-[10px] text-slate-500 block mb-1">任一盈利 &ge; %</label>
                                         <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-emerald-400" value={settings.safeClearProfit} onChange={(e) => onChange('safeClearProfit', parseFloat(e.target.value))} />
                                     </div>
                                     <div>
                                         <label className="text-[10px] text-slate-500 block mb-1">任一亏损 &ge; %</label>
                                         <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-red-400" value={settings.safeClearLoss} onChange={(e) => onChange('safeClearLoss', parseFloat(e.target.value))} />
                                     </div>
                                 </div>
                                 <div className="mt-2 p-2 bg-amber-900/10 border border-amber-500/20 rounded text-[9px] text-amber-500/80 leading-relaxed">
                                     ⚠️ 功能限制说明：开启此选项后，所有处于【对冲状态】的仓位将<strong>屏蔽</strong>常规止盈与止损策略，仅依据上方设定的【安全清仓】比例执行多空双开平仓。未对冲的独立仓位不受影响。
                                 </div>
                             </>
                         )}
                     </div>
                </>
            )}
        </div>
    );
};

export default HedgingModule;
