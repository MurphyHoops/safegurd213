
import React from 'react';
import { StopLossSettings } from '../../../types';

interface Props {
    settings: StopLossSettings;
    onChange: (key: string, value: any) => void;
    toggleFeature: (feature: keyof StopLossSettings) => void;
}

const Strategy1_OriginalProfit: React.FC<Props> = ({ settings, onChange, toggleFeature }) => {
    return (
        <div className="space-y-2 border border-slate-700/50 rounded bg-slate-900/30 p-2">
            <div className="flex items-center justify-between pb-1 border-b border-slate-700/50 mb-2">
                <span className="text-xs text-blue-400 font-bold">1. 原仓盈利解套</span>
                <div 
                    onClick={() => toggleFeature('originalProfitClear')} 
                    className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.originalProfitClear ? 'bg-blue-600' : 'bg-slate-700'}`}
                >
                    <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.originalProfitClear ? 'translate-x-4' : 'translate-x-0'}`}/>
                </div>
            </div>
            {settings.originalProfitClear && (
                <div className="space-y-2 animate-in fade-in">
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-[10px] text-slate-500 block mb-1">对冲仓硬止损 (%)</label>
                            <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-red-400" value={settings.hedgeStopLossPercent} onChange={(e) => onChange('hedgeStopLossPercent', parseFloat(e.target.value))} />
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-500 block mb-1">覆盖盈余阈值 (%)</label>
                            <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-emerald-400" value={settings.originalCoverPercent} onChange={(e) => onChange('originalCoverPercent', parseFloat(e.target.value))} />
                        </div>
                    </div>
                    <div className="text-[9px] text-slate-500 bg-slate-800/50 p-1.5 rounded leading-relaxed border border-slate-700/30">
                        <strong>解套原理：</strong> 当行情V型反转回原方向，原仓位(富豪)赚的钱足以帮对冲单(败家子)还债，并多赚 {settings.originalCoverPercent}% 时，强制双向平仓，落袋为安。
                    </div>
                </div>
            )}
        </div>
    );
};

export default Strategy1_OriginalProfit;
