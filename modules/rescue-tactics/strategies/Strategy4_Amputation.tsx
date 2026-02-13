
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
                            <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-emerald-400 font-bold" value={settings.amputationTriggerProfit} onChange={(e) => onChange('amputationTriggerProfit', parseFloat(e.target.value))} />
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-500 block mb-1">每次砍仓比例 (%)</label>
                            <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-red-400 font-bold" value={settings.amputationRatio} onChange={(e) => onChange('amputationRatio', parseFloat(e.target.value))} />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-[10px] text-slate-500 block mb-1">盈利覆盖安全垫 (%)</label>
                            <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white" value={settings.amputationVictoryBuffer} onChange={(e) => onChange('amputationVictoryBuffer', parseFloat(e.target.value))} />
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-500 block mb-1">补仓回调触发 (%)</label>
                            <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white" value={settings.amputationRefillRetrace} onChange={(e) => onChange('amputationRefillRetrace', parseFloat(e.target.value))} />
                        </div>
                    </div>
                    <div className="text-[9px] text-slate-500 bg-slate-800/50 p-1.5 rounded leading-relaxed border border-slate-700/30">
                        <strong>弃卒保车：</strong> 当顺势单大赚时，主动砍掉逆势单以释放保证金（断臂）。若行情回调或反转，则自动补回对冲（接回）。最终利用顺势利润覆盖所有断臂债务后清仓。
                    </div>
                </div>
            )}
        </div>
    );
};

export default Strategy4_Amputation;
