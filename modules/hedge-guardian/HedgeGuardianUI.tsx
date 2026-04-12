
import React from 'react';
import { HedgeGuardianProps } from './types';
import { Activity } from 'lucide-react';

export const HedgeGuardianModule: React.FC<HedgeGuardianProps> = ({ settings, onChange }) => {
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
                                value={Number.isNaN(settings.minPosition) ? '' : settings.minPosition} 
                                onChange={(e) => onChange('minPosition', parseFloat(e.target.value))} 
                            />
                         </div>
                         <div className="space-y-1">
                            <label className="text-[10px] text-slate-500 block">对冲仓位比例 (%)</label>
                            <input 
                                type="number" 
                                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white focus:border-indigo-500 font-mono" 
                                value={Number.isNaN(settings.hedgeRatio) ? '' : settings.hedgeRatio} 
                                onChange={(e) => onChange('hedgeRatio', parseFloat(e.target.value))} 
                            />
                         </div>
                     </div>

                     <div className="mt-4 space-y-3">
                        <span className="text-[10px] font-bold text-slate-400 block border-b border-slate-800 pb-1">对冲触发方式：</span>
                        
                        {/* Method 1: Loss Trigger */}
                        <div className="flex items-center justify-between bg-slate-900/50 p-2 rounded border border-slate-700/50">
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-300">1. 亏损值触发</span>
                                <div className="relative w-16">
                                    <input 
                                        type="number" 
                                        step="0.1"
                                        className="w-full bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-red-400 text-center font-bold" 
                                        value={Number.isNaN(settings.triggerLossPercent) ? '' : settings.triggerLossPercent} 
                                        onChange={(e) => onChange('triggerLossPercent', Math.abs(parseFloat(e.target.value)))} 
                                    />
                                    <span className="absolute right-1 top-0.5 text-[9px] text-slate-500">%</span>
                                </div>
                            </div>
                            <div 
                                onClick={() => onChange('triggerLossEnabled', !settings.triggerLossEnabled)} 
                                className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.triggerLossEnabled ? 'bg-indigo-600' : 'bg-slate-700'}`}
                            >
                                <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.triggerLossEnabled ? 'translate-x-4' : 'translate-x-0'}`}/>
                            </div>
                        </div>

                        {/* Combined Loss Limit Setting */}
                        <div className="flex items-center justify-between bg-slate-900/50 p-2 rounded border border-slate-700/50">
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-400">亏损触发限制 (对趋势/破位有效)</span>
                                <div className="relative w-16">
                                    <input 
                                        type="number" 
                                        step="0.1"
                                        className="w-full bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-red-400 text-center font-bold" 
                                        value={Number.isNaN(settings.combinedLossLimitPercent) ? '' : (settings.combinedLossLimitPercent || 2)} 
                                        onChange={(e) => onChange('combinedLossLimitPercent', Math.abs(parseFloat(e.target.value)))} 
                                    />
                                    <span className="absolute right-1 top-0.5 text-[9px] text-slate-500">%</span>
                                </div>
                            </div>
                            <div 
                                onClick={() => onChange('combinedLossLimitEnabled', !settings.combinedLossLimitEnabled)} 
                                className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.combinedLossLimitEnabled ? 'bg-indigo-600' : 'bg-slate-700'}`}
                            >
                                <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.combinedLossLimitEnabled ? 'translate-x-4' : 'translate-x-0'}`}/>
                            </div>
                        </div>

                        {/* Method 2: Trend Firewall */}
                        <div className="flex items-center justify-between bg-slate-900/50 p-2 rounded border border-slate-700/50">
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-300">2. 趋势防火墙，价格突破 EMA</span>
                                <select 
                                    className="bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-indigo-400 font-bold"
                                    value={settings.trendHedgeEmaPeriod || 80}
                                    onChange={(e) => onChange('trendHedgeEmaPeriod', parseInt(e.target.value))}
                                >
                                    <option value={80}>80</option>
                                    <option value={40}>40</option>
                                    <option value={20}>20</option>
                                    <option value={10}>10</option>
                                </select>
                            </div>
                            <div 
                                onClick={() => onChange('trendHedgeEnabled', !settings.trendHedgeEnabled)} 
                                className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.trendHedgeEnabled ? 'bg-indigo-600' : 'bg-slate-700'}`}
                            >
                                <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.trendHedgeEnabled ? 'translate-x-4' : 'translate-x-0'}`}/>
                            </div>
                        </div>

                        {/* Method 3: Break K-Line */}
                        <div className="flex items-center justify-between bg-slate-900/50 p-2 rounded border border-slate-700/50">
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-300">3. 破位大K线，振幅</span>
                                <div className="relative w-16">
                                    <input 
                                        type="number" 
                                        className="w-full bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-orange-400 text-center font-bold" 
                                        value={Number.isNaN(settings.breakKLineRatio) ? '' : (settings.breakKLineRatio || 40)} 
                                        onChange={(e) => onChange('breakKLineRatio', parseFloat(e.target.value))} 
                                    />
                                    <span className="absolute right-1 top-0.5 text-[9px] text-slate-500">%</span>
                                </div>
                            </div>
                            <div 
                                onClick={() => onChange('breakKLineEnabled', !settings.breakKLineEnabled)} 
                                className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.breakKLineEnabled ? 'bg-indigo-600' : 'bg-slate-700'}`}
                            >
                                <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.breakKLineEnabled ? 'translate-x-4' : 'translate-x-0'}`}/>
                            </div>
                        </div>
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
                                         <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-emerald-400" value={Number.isNaN(settings.safeClearProfit) ? '' : settings.safeClearProfit} onChange={(e) => onChange('safeClearProfit', parseFloat(e.target.value))} />
                                     </div>
                                     <div>
                                         <label className="text-[10px] text-slate-500 block mb-1">任一亏损 &ge; %</label>
                                         <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-red-400" value={Number.isNaN(settings.safeClearLoss) ? '' : settings.safeClearLoss} onChange={(e) => onChange('safeClearLoss', parseFloat(e.target.value))} />
                                     </div>
                                 </div>
                             </>
                         )}
                     </div>
                </>
            )}
        </div>
    );
};
