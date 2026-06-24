
import React from 'react';
import { HedgeGuardianProps } from './types';
import { Activity } from 'lucide-react';
import { HedgeTriggerMethods } from './components/HedgeTriggerMethods';
import { SafeClearSection } from './components/SafeClearSection';

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

                     <HedgeTriggerMethods settings={settings} onChange={onChange} />
                     <SafeClearSection settings={settings} onChange={onChange} />
                </>
            )}
        </div>
    );
};
