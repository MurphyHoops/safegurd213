
import React from 'react';
import { StopLossSettings } from '../../../types';
import { Scissors } from 'lucide-react';

interface Props {
    settings: StopLossSettings;
    onChange: (key: string, value: any) => void;
    toggleFeature: (feature: keyof StopLossSettings) => void;
}

const Strategy4_Amputation: React.FC<Props> = ({ settings, onChange, toggleFeature }) => {
    return (
        <div className="space-y-2 border border-slate-700/50 rounded bg-slate-900/30 p-2">
            <div className="flex items-center justify-between pb-1 border-b border-slate-700/50 mb-2">
                <div className="flex items-center gap-2">
                    <span className="text-xs text-purple-400 font-bold flex items-center gap-1"><Scissors size={12}/> 4. 断臂求生</span>
                </div>
                <div 
                    onClick={() => toggleFeature('amputationEnabled')} 
                    className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.amputationEnabled ? 'bg-purple-600' : 'bg-slate-700'}`}
                >
                    <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.amputationEnabled ? 'translate-x-4' : 'translate-x-0'}`}/>
                </div>
            </div>
            {settings.amputationEnabled && (
                <div className="space-y-2 animate-in fade-in">
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-[10px] text-slate-500 block mb-1">触发断臂盈利率 (%)</label>
                            <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-emerald-400 font-bold" value={Number.isNaN(settings.amputationTriggerProfit) ? '' : settings.amputationTriggerProfit} onChange={(e) => onChange('amputationTriggerProfit', parseFloat(e.target.value))} />
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-500 block mb-1">每次砍仓比例 (%)</label>
                            <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-red-400 font-bold" value={Number.isNaN(settings.amputationRatio) ? '' : settings.amputationRatio} onChange={(e) => onChange('amputationRatio', parseFloat(e.target.value))} />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-[10px] text-slate-500 block mb-1">盈利覆盖安全垫 (%)</label>
                            <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white" value={Number.isNaN(settings.amputationVictoryBuffer) ? '' : settings.amputationVictoryBuffer} onChange={(e) => onChange('amputationVictoryBuffer', parseFloat(e.target.value))} />
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-500 block mb-1">解套回撤清仓 (%)</label>
                            <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-sky-400 font-bold" value={Number.isNaN(settings.amputationBreathingSpace) ? '' : settings.amputationBreathingSpace} onChange={(e) => onChange('amputationBreathingSpace', parseFloat(e.target.value))} />
                        </div>
                    </div>
                    <div className="text-[9px] text-slate-500 bg-slate-800/50 p-1.5 rounded leading-relaxed border border-slate-700/30">
                        <strong>弃卒保车：</strong> 当一方盈利达到触发标准时，砍掉亏损方一半仓位。若亏损方回本(亏损为0)，则补回之前砍掉的仓位。最终利用盈利覆盖所有砍仓亏损和历史止损后，双向清仓。
                    </div>
                </div>
            )}
        </div>
    );
};

export default Strategy4_Amputation;
