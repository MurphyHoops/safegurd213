
import React from 'react';
import { StopLossSettings } from '../../../types';

interface Props {
    settings: StopLossSettings;
    onChange: (key: string, value: any) => void;
    toggleFeature: (feature: keyof StopLossSettings) => void;
}

const Strategy2_HedgeProfit: React.FC<Props> = ({ settings, onChange, toggleFeature }) => {
    return (
        <div className="space-y-2 border border-slate-700/50 rounded bg-slate-900/30 p-2">
            <div className="flex items-center justify-between pb-1 border-b border-slate-700/50 mb-2">
                <span className="text-xs text-indigo-400 font-bold">2. 对冲盈利解套</span>
                <div 
                    onClick={() => toggleFeature('hedgeProfitClear')} 
                    className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.hedgeProfitClear ? 'bg-indigo-600' : 'bg-slate-700'}`}
                >
                    <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.hedgeProfitClear ? 'translate-x-4' : 'translate-x-0'}`}/>
                </div>
            </div>
            {settings.hedgeProfitClear && (
                <div className="space-y-2 animate-in fade-in">
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-[10px] text-slate-500 block mb-1">对冲加仓倍率 (%)</label>
                            <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white" value={settings.hedgeOpenRatio} onChange={(e) => onChange('hedgeOpenRatio', parseFloat(e.target.value))} />
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-500 block mb-1">覆盖盈余阈值 (%)</label>
                            <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-emerald-400" value={settings.hedgeCoverPercent} onChange={(e) => onChange('hedgeCoverPercent', parseFloat(e.target.value))} />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                            <div>
                            <label className="text-[10px] text-slate-500 block mb-1">对冲仓位止损 (Hedge SL) %</label>
                            <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-red-400" value={settings.hedgeProfitClearStopLoss} onChange={(e) => onChange('hedgeProfitClearStopLoss', parseFloat(e.target.value))} />
                        </div>
                    </div>
                    <div className="text-[9px] text-slate-500 bg-slate-800/50 p-1.5 rounded leading-relaxed border border-slate-700/30">
                        当对冲仓位盈利覆盖【原仓位当前亏损】并多出 {settings.hedgeCoverPercent}% 时，清空双向仓位。
                    </div>
                </div>
            )}
        </div>
    );
};

export default Strategy2_HedgeProfit;
