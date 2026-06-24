
import React from 'react';
import { ProfitSettings } from '../../../types';
import { Target, Activity } from 'lucide-react';

interface Props {
    settings: ProfitSettings;
    updateNested: (subsection: string, key: string, value: any) => void;
}

export const AtrTrendMode: React.FC<Props> = ({ settings, updateNested }) => {
    const config = settings.atr || { multiplier: 3, volatilityPercent: 1, chandelierEnabled: true, emaEnabled: false, emaPeriod: 80, emaTimeframe: 'AUTO' };

    const updateAtr = (key: string, value: any) => {
        updateNested('atr', key, value);
    };

    return (
        <div className="space-y-4 animate-in fade-in slide-in-from-top-1 duration-300">
            {/* Chandelier Exit */}
            <div className={`p-2 rounded border transition-colors ${config.chandelierEnabled ? 'bg-indigo-900/10 border-indigo-500/30' : 'bg-slate-800/20 border-slate-700'}`}>
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-1.5">
                        <Target size={12} className={config.chandelierEnabled ? 'text-indigo-400' : 'text-slate-500'} />
                        <span className={`text-[10px] font-bold ${config.chandelierEnabled ? 'text-indigo-300' : 'text-slate-500'}`}>吊灯止盈 (Chandelier Exit)</span>
                    </div>
                    <div 
                        onClick={() => updateAtr('chandelierEnabled', !config.chandelierEnabled)}
                        className={`w-7 h-3.5 rounded-full p-0.5 cursor-pointer transition-colors ${config.chandelierEnabled ? 'bg-indigo-600' : 'bg-slate-700'}`}
                    >
                        <div className={`w-2.5 h-2.5 bg-white rounded-full transition-transform ${config.chandelierEnabled ? 'translate-x-3.5' : 'translate-x-0'}`} />
                    </div>
                </div>

                {config.chandelierEnabled && (
                    <div className="grid grid-cols-2 gap-3 pb-1">
                        <div className="space-y-1">
                            <label className="text-[9px] text-slate-500">ATR 乘数</label>
                            <div className="flex items-center bg-slate-900/60 rounded px-1.5 py-0.5 border border-slate-700">
                                <input 
                                    type="number" 
                                    step="0.1"
                                    value={config.multiplier} 
                                    onChange={(e) => updateAtr('multiplier', Number(e.target.value))}
                                    className="w-full bg-transparent text-[11px] font-mono focus:outline-none"
                                />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <label className="text-[9px] text-slate-500">预估波动率 (%)</label>
                            <div className="flex items-center bg-slate-900/60 rounded px-1.5 py-0.5 border border-slate-700">
                                <input 
                                    type="number" 
                                    step="0.1"
                                    value={config.volatilityPercent} 
                                    onChange={(e) => updateAtr('volatilityPercent', Number(e.target.value))}
                                    className="w-full bg-transparent text-[11px] font-mono focus:outline-none"
                                />
                                <span className="text-[9px] text-slate-600 ml-1">%</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* EMA Intersection */}
            <div className={`p-2 rounded border transition-colors ${config.emaEnabled ? 'bg-cyan-900/10 border-cyan-500/30' : 'bg-slate-800/20 border-slate-700'}`}>
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-1.5">
                        <Activity size={12} className={config.emaEnabled ? 'text-cyan-400' : 'text-slate-500'} />
                        <span className={`text-[10px] font-bold ${config.emaEnabled ? 'text-cyan-300' : 'text-slate-500'}`}>EMA 相交平仓</span>
                    </div>
                    <div 
                        onClick={() => updateAtr('emaEnabled', !config.emaEnabled)}
                        className={`w-7 h-3.5 rounded-full p-0.5 cursor-pointer transition-colors ${config.emaEnabled ? 'bg-cyan-600' : 'bg-slate-700'}`}
                    >
                        <div className={`w-2.5 h-2.5 bg-white rounded-full transition-transform ${config.emaEnabled ? 'translate-x-3.5' : 'translate-x-0'}`} />
                    </div>
                </div>

                {config.emaEnabled && (
                    <div className="space-y-3 pb-1">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <label className="text-[9px] text-slate-500">EMA 周期</label>
                                <select 
                                    value={config.emaPeriod}
                                    onChange={(e) => updateAtr('emaPeriod', Number(e.target.value))}
                                    className="w-full bg-slate-900/60 rounded px-1.5 py-1 border border-slate-700 text-[10px] focus:outline-none"
                                >
                                    {[10, 20, 30, 40, 60, 80, 100, 120, 140, 160, 180, 200].map(p => (
                                        <option key={p} value={p}>{p}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[9px] text-slate-500">周期切换</label>
                                <select 
                                    value={config.emaTimeframe || 'AUTO'}
                                    onChange={(e) => updateAtr('emaTimeframe', e.target.value)}
                                    className="w-full bg-slate-900/60 rounded px-1.5 py-1 border border-slate-700 text-[10px] focus:outline-none"
                                >
                                    <option value="AUTO">自动感知</option>
                                    <option value="5m">5分钟</option>
                                    <option value="15m">15分钟</option>
                                    <option value="30m">30分钟</option>
                                    <option value="1h">1小时</option>
                                    <option value="2h">2小时</option>
                                    <option value="4h">4小时</option>
                                    <option value="8h">8小时</option>
                                    <option value="1d">1天</option>
                                </select>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
