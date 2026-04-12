
import React, { useState } from 'react';
import { Flame, Zap, Target, ShieldCheck, Info, Hourglass } from 'lucide-react';
import { List4Config } from '../scannerTypes';
import { RulesModal } from './RulesModal';

interface List4PanelProps {
    config: List4Config;
    setConfig: React.Dispatch<React.SetStateAction<List4Config>>;
}

export const List4Control: React.FC<List4PanelProps> = ({ config, setConfig }) => {
    const [showRules, setShowRules] = useState(false);

    return (
        <div className="p-3 bg-slate-900 border-b border-slate-800 space-y-2 shrink-0 relative">
            <div className="flex items-center justify-between">
                <div className="font-bold text-amber-500 text-sm flex items-center gap-2">
                    <Flame size={14} /> 4. 动能审计 (MOMENTUM)
                </div>
                <button 
                    onClick={() => setShowRules(true)} 
                    className="text-slate-500 hover:text-amber-400 transition-colors"
                    title="查看防守线规则"
                >
                    <Info size={12} />
                </button>
            </div>

            {/* Rules Modal Overlay */}
            {showRules && <RulesModal onClose={() => setShowRules(false)} />}
            
            <div className="space-y-2">
                <div className="flex items-center justify-between bg-amber-900/30 px-3 py-2 rounded border border-amber-500/40 shadow-sm">
                    <div className="flex items-center gap-1.5 text-amber-300 font-bold text-[11px]"><Zap size={14} className="text-amber-400 fill-amber-400/20" />离弦之箭：自动执行开仓</div>
                    <div onClick={() => setConfig(p => ({ ...p, autoExecute: !p.autoExecute }))} className={`w-9 h-4.5 rounded-full p-0.5 transition-colors cursor-pointer ${config.autoExecute ? 'bg-amber-500' : 'bg-slate-700'}`}>
                        <div className={`w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${config.autoExecute ? 'translate-x-[18px]' : 'translate-x-0'}`} />
                    </div>
                </div>

                <div className="flex bg-slate-800 rounded p-1 border border-slate-700">
                    {['LONG', 'BOTH', 'SHORT'].map(mode => (
                        <button 
                            key={mode}
                            onClick={() => setConfig(p => ({...p, directionFilter: mode as any}))}
                            className={`flex-1 py-1 text-[9px] font-bold rounded transition-colors ${
                                config.directionFilter === mode 
                                ? (mode === 'LONG' ? 'bg-emerald-600 text-white' : mode === 'SHORT' ? 'bg-red-600 text-white' : 'bg-amber-600 text-white')
                                : 'text-slate-500 hover:text-slate-300'
                            }`}
                        >
                            {mode === 'BOTH' ? '双向' : mode === 'LONG' ? '仅做多' : '仅做空'}
                        </button>
                    ))}
                </div>

                {/* Threshold Logic & Retention */}
                <div className={`space-y-1 ${config.enableThresholds ? '' : 'opacity-60'}`}>
                     <div className="flex items-center justify-between px-1">
                         <span className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-1">
                             <Target size={10} /> 阈值限制 (Thresholds)
                         </span>
                         <div onClick={() => setConfig(p => ({ ...p, enableThresholds: !p.enableThresholds }))} className={`w-7 h-3.5 rounded-full p-0.5 transition-colors cursor-pointer ${config.enableThresholds ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                             <div className={`w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${config.enableThresholds ? 'translate-x-3.5' : 'translate-x-0'}`} />
                         </div>
                     </div>

                     <div className={`grid grid-cols-2 gap-2 ${config.enableThresholds ? '' : 'pointer-events-none'}`}>
                         <div className="bg-slate-800 p-2 rounded border border-slate-700 flex flex-col gap-1">
                             <span className="text-[9px] text-slate-500 font-bold uppercase">中轴防守线</span>
                             <div className="flex items-center justify-between gap-1">
                                 <span className="text-[8px] text-slate-600">% Amp</span>
                                 <input type="number" value={(config.midlineThreshold === undefined || Number.isNaN(config.midlineThreshold)) ? '' : config.midlineThreshold} onChange={e => setConfig(p => ({ ...p, midlineThreshold: parseFloat(e.target.value) }))} className="w-12 bg-slate-900 border border-slate-700 rounded text-center text-[10px] text-emerald-400 font-bold outline-none" />
                             </div>
                         </div>
                         <div className="bg-slate-800 p-2 rounded border border-slate-700 flex flex-col gap-1">
                             <span className="text-[9px] text-slate-500 font-bold uppercase">进攻突破线</span>
                             <div className="flex items-center justify-between gap-1">
                                 <span className="text-[8px] text-slate-600">% Amp</span>
                                 <input type="number" value={(config.breakoutThreshold === undefined || Number.isNaN(config.breakoutThreshold)) ? '' : config.breakoutThreshold} onChange={e => setConfig(p => ({ ...p, breakoutThreshold: parseFloat(e.target.value) }))} className="w-12 bg-slate-900 border border-slate-700 rounded text-center text-[10px] text-amber-400 font-bold outline-none" />
                             </div>
                         </div>
                     </div>
                </div>

                {/* Anti-Chase Fuse */}
                <div className={`space-y-1 pt-1 border-t border-slate-800/50 ${config.enableAntiChase ? '' : 'opacity-60'}`}>
                     <div className="flex items-center justify-between px-1">
                         <span className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-1">
                             <ShieldCheck size={10} className={config.enableAntiChase ? 'text-red-400' : ''} /> 防追高熔断 (Anti-Chase)
                         </span>
                         <div onClick={() => setConfig(p => ({ ...p, enableAntiChase: !p.enableAntiChase }))} className={`w-7 h-3.5 rounded-full p-0.5 transition-colors cursor-pointer ${config.enableAntiChase ? 'bg-red-600' : 'bg-slate-700'}`}>
                             <div className={`w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${config.enableAntiChase ? 'translate-x-3.5' : 'translate-x-0'}`} />
                         </div>
                     </div>

                     <div className={`grid grid-cols-2 gap-2 ${config.enableAntiChase ? 'animate-in fade-in slide-in-from-top-1' : 'hidden'}`}>
                         <div className="bg-slate-800 p-1.5 rounded border border-slate-700 flex flex-col">
                             <span className="text-[8px] text-slate-500">24H 涨跌 &gt; %</span>
                             <input type="number" value={(config.antiChaseConfig?.maxChange24h === undefined || Number.isNaN(config.antiChaseConfig?.maxChange24h)) ? '' : (config.antiChaseConfig?.maxChange24h ?? 15)} onChange={e => setConfig(p => ({ ...p, antiChaseConfig: { ...p.antiChaseConfig, maxChange24h: parseFloat(e.target.value) } }))} className="w-full bg-slate-900 border border-slate-700 rounded text-center text-[9px] text-white font-bold outline-none mt-0.5" />
                         </div>
                         <div className="bg-slate-800 p-1.5 rounded border border-slate-700 flex flex-col">
                             <span className="text-[8px] text-slate-500">EMA80 乖离 &gt; %</span>
                             <input type="number" value={(config.antiChaseConfig?.maxDeviation === undefined || Number.isNaN(config.antiChaseConfig?.maxDeviation)) ? '' : (config.antiChaseConfig?.maxDeviation ?? 20)} onChange={e => setConfig(p => ({ ...p, antiChaseConfig: { ...p.antiChaseConfig, maxDeviation: parseFloat(e.target.value) } }))} className="w-full bg-slate-900 border border-slate-700 rounded text-center text-[9px] text-white font-bold outline-none mt-0.5" />
                         </div>
                         <div className="col-span-2 bg-slate-800 p-1.5 rounded border border-slate-700 flex items-center justify-between">
                             <div className="flex items-center gap-1.5">
                                 <span className="text-[9px] text-slate-500 font-bold">逆势三连K拦截</span>
                                 <span className="text-[8px] text-slate-600 bg-slate-900 px-1 rounded">Rev 3K</span>
                             </div>
                             <div onClick={() => setConfig(p => ({ ...p, antiChaseConfig: { ...p.antiChaseConfig, enableRev3K: !p.antiChaseConfig.enableRev3K } }))} className={`w-6 h-3 rounded-full p-0.5 transition-colors cursor-pointer ${config.antiChaseConfig.enableRev3K ? 'bg-red-500' : 'bg-slate-700'}`}>
                                 <div className={`w-2 h-2 bg-white rounded-full shadow transition-transform ${config.antiChaseConfig.enableRev3K ? 'translate-x-3' : 'translate-x-0'}`} />
                             </div>
                         </div>
                     </div>
                 </div>
                {/* Auto Remove Settings */}
                <div className="space-y-1 pt-1 border-t border-slate-800/50">
                     <div className="flex items-center justify-between px-1 mb-1">
                         <span className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-1">
                             <Hourglass size={10} /> 自动清理 (Auto Remove)
                         </span>
                     </div>
                     <div className="grid grid-cols-2 gap-2">
                         <div className="bg-slate-800 p-1.5 rounded border border-slate-700 flex flex-col gap-1">
                             <span className="text-[8px] text-slate-500 font-bold">结构破坏后消除</span>
                             <div className="flex items-center justify-between gap-1">
                                 <input type="number" min="0" value={Number.isNaN(config.removeInvalidCandles) ? '' : (config.removeInvalidCandles || 0)} onChange={e => setConfig(p => ({ ...p, removeInvalidCandles: parseInt(e.target.value) || 0 }))} className="w-10 bg-slate-900 border border-slate-700 rounded text-center text-[10px] text-red-400 font-bold outline-none" />
                                 <span className="text-[8px] text-slate-600">根K线</span>
                             </div>
                         </div>
                         <div className="bg-slate-800 p-1.5 rounded border border-slate-700 flex flex-col gap-1">
                             <span className="text-[8px] text-slate-500 font-bold">已开仓后消除</span>
                             <div className="flex items-center justify-between gap-1">
                                 <input type="number" min="0" value={Number.isNaN(config.removeTradedCandles) ? '' : (config.removeTradedCandles || 0)} onChange={e => setConfig(p => ({ ...p, removeTradedCandles: parseInt(e.target.value) || 0 }))} className="w-10 bg-slate-900 border border-slate-700 rounded text-center text-[10px] text-emerald-400 font-bold outline-none" />
                                 <span className="text-[8px] text-slate-600">根K线</span>
                             </div>
                         </div>
                     </div>
                     <div className="text-[8px] text-slate-600 px-1 text-center mt-1">
                         * 设为 0 表示不自动消除
                     </div>
                </div>
            </div>
        </div>
    );
};
