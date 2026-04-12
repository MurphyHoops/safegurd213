
import React from 'react';
import { StopLossSettings } from '../../../types';
import { Info } from 'lucide-react';

interface Props {
    settings: StopLossSettings;
    onChange: (key: string, value: any) => void;
    toggleFeature: (feature: keyof StopLossSettings) => void;
    onShowStrategyInfo: () => void;
}

const Strategy3_CallbackProfit: React.FC<Props> = ({ settings, onChange, toggleFeature, onShowStrategyInfo }) => {
    return (
        <div className="space-y-2 border border-slate-700/50 rounded bg-slate-900/30 p-2">
            <div className="flex items-center justify-between pb-1 border-b border-slate-700/50 mb-2">
                <div className="flex items-center gap-2">
                    <span className="text-xs text-amber-400 font-bold">2. 回调盈利清仓</span>
                    <button onClick={onShowStrategyInfo} className="text-slate-500 hover:text-white" title="查看运行规则"><Info size={12}/></button>
                </div>
                <div 
                    onClick={() => toggleFeature('callbackProfitClear')} 
                    className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.callbackProfitClear ? 'bg-amber-600' : 'bg-slate-700'}`}
                >
                    <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.callbackProfitClear ? 'translate-x-4' : 'translate-x-0'}`}/>
                </div>
            </div>
            {settings.callbackProfitClear && (
                <div className="space-y-2 animate-in fade-in">
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-[10px] text-slate-500 block mb-1">对冲仓位开仓数量 (%)</label>
                            <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white" value={Number.isNaN(settings.callbackHedgeRatio) ? '' : (settings.callbackHedgeRatio ?? 150)} onChange={(e) => onChange('callbackHedgeRatio', parseFloat(e.target.value))} />
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-500 block mb-1">覆盖亏损盈利阈值 (%)</label>
                            <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-emerald-400" value={Number.isNaN(settings.callbackCoverPercent) ? '' : settings.callbackCoverPercent} onChange={(e) => onChange('callbackCoverPercent', parseFloat(e.target.value))} />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-[10px] text-slate-500 block mb-1">对冲盈利目标 (%)</label>
                            <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-emerald-400" value={Number.isNaN(settings.callbackTargetProfit) ? '' : settings.callbackTargetProfit} onChange={(e) => onChange('callbackTargetProfit', parseFloat(e.target.value))} />
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-500 block mb-1">回调比例 (%)</label>
                            <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-amber-400" value={Number.isNaN(settings.callbackRate) ? '' : settings.callbackRate} onChange={(e) => onChange('callbackRate', parseFloat(e.target.value))} />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                        <div>
                            <label className="text-[10px] text-slate-500 block mb-1">对冲止损 (%)</label>
                            <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-red-400" value={Number.isNaN(settings.callbackStopLoss) ? '' : settings.callbackStopLoss} onChange={(e) => onChange('callbackStopLoss', parseFloat(e.target.value))} />
                        </div>
                    </div>
                    <div className="text-[9px] text-slate-500 bg-slate-800/50 p-1.5 rounded leading-relaxed border border-slate-700/30">
                        对冲盈利达标后回调收割，或止损控制。利润积攒至总子弹 &gt; 亏损 * (1+阈值) 时清仓。
                    </div>
                </div>
            )}
        </div>
    );
};

export default Strategy3_CallbackProfit;
