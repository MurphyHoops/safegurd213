
import React, { useState } from 'react';
import { Clock, Zap, Rocket, ArrowUpDown, Activity, ShieldCheck, ChevronDown, ChevronUp } from 'lucide-react';
import { List3Config } from '../scannerTypes';

interface List3PanelProps {
    config: List3Config;
    setConfig: React.Dispatch<React.SetStateAction<List3Config>>;
    countdowns: Record<string, string>; 
}

export const List3Control: React.FC<List3PanelProps> = ({ config, setConfig, countdowns }) => {
    const ALL_TFS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h'];
    const toggleTf = (tf: string) => setConfig(prev => ({ ...prev, timeframes: prev.timeframes.includes(tf) ? prev.timeframes.filter(t => t !== tf) : [...prev.timeframes, tf] }));
    const isActive = config.timeframes.length > 0;
    const [showAntiChase, setShowAntiChase] = useState(false);
    
    // Ensure nested object exists
    const antiChase = config.antiChase || { enabled: true, maxRise: 100, maxFall: 50 };

    return (
        <div className="p-3 bg-slate-900 border-b border-slate-800 space-y-2 shrink-0">
            <div className="font-bold text-slate-200 text-sm flex items-center gap-2 mb-1">3. 结构审计 (Structure Audit)</div>
            <div className="mb-2">
                <div className="flex justify-between items-center mb-1.5">
                    <div className="text-[9px] text-slate-500 flex gap-1 items-center"><Clock size={10}/> 结构确认周期 (Structure TF)</div>
                    <div className={`w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse transition-opacity duration-300 ${isActive ? 'opacity-100' : 'opacity-0'}`} />
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                    {ALL_TFS.map(tf => {
                        const isSelected = config.timeframes.includes(tf);
                        return (
                            <button key={tf} onClick={() => toggleTf(tf)} className={`text-[9px] border rounded py-1 font-bold transition-all flex items-center justify-center gap-1 ${isSelected ? 'bg-indigo-600 border-indigo-500 text-white shadow-[0_0_8px_rgba(99,102,241,0.4)]' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'}`}>
                                <span>{tf}</span>
                                {isSelected && countdowns[tf] && <span className="font-mono text-[8px] opacity-90 scale-90">{countdowns[tf] || '--:--'}</span>}
                            </button>
                        );
                    })}
                </div>
            </div>
            
            <div className="flex items-center justify-between bg-blue-900/20 px-2 py-1.5 rounded border border-blue-500/30">
                <div className="flex items-center gap-1 text-blue-300 font-bold text-[10px]"><Zap size={11} className="text-blue-400" />自动策略开仓 (Auto Strategy)</div>
                <div onClick={() => setConfig(p => ({...p, autoSimOpen: !p.autoSimOpen}))} className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${config.autoSimOpen ? 'bg-blue-600' : 'bg-slate-700'}`}><div className={`w-3 h-3 bg-white rounded-full transition-transform shadow-sm ${config.autoSimOpen ? 'translate-x-4' : ''}`} /></div>
            </div>

            {/* Anti-Chase Panel (Accordion) */}
            <div className={`rounded border transition-all duration-300 ${showAntiChase ? 'bg-slate-800 border-slate-600' : 'bg-slate-900 border-slate-700 hover:bg-slate-800/50'}`}>
                <div 
                    onClick={() => setShowAntiChase(!showAntiChase)}
                    className="flex items-center justify-between p-2 cursor-pointer"
                >
                    <div className="flex items-center gap-1.5">
                        <ShieldCheck size={12} className={antiChase.enabled ? "text-emerald-400" : "text-slate-500"} />
                        <span className={`text-[10px] font-bold ${antiChase.enabled ? 'text-emerald-400' : 'text-slate-500'}`}>趋势过热熔断 (Anti-Chase)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {antiChase.enabled && !showAntiChase && <span className="text-[8px] bg-slate-700 px-1 rounded text-slate-400">ON</span>}
                        {showAntiChase ? <ChevronUp size={10} className="text-slate-400"/> : <ChevronDown size={10} className="text-slate-400"/>}
                    </div>
                </div>
                
                {showAntiChase && (
                    <div className="p-2 border-t border-slate-700 space-y-2 animate-in fade-in slide-in-from-top-1">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[9px] text-slate-400">启用熔断过滤器</span>
                            <div onClick={() => setConfig(p => ({...p, antiChase: {...p.antiChase!, enabled: !p.antiChase!.enabled}}))} className={`w-6 h-3 rounded-full p-0.5 cursor-pointer transition-colors ${antiChase.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}>
                                <div className={`w-2 h-2 bg-white rounded-full transition-transform shadow-sm ${antiChase.enabled ? 'translate-x-3' : ''}`} />
                            </div>
                        </div>
                        <div className={`grid grid-cols-2 gap-2 ${antiChase.enabled ? '' : 'opacity-40 pointer-events-none'}`}>
                            <div>
                                <label className="text-[8px] text-slate-500 block mb-0.5">多头：最大涨幅 %</label>
                                <input 
                                    type="number" 
                                    value={antiChase.maxRise} 
                                    onChange={e => setConfig(p => ({...p, antiChase: {...p.antiChase!, maxRise: parseFloat(e.target.value)}}))}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-1 py-1 text-[10px] text-emerald-400 font-bold text-center outline-none focus:border-emerald-500"
                                />
                            </div>
                            <div>
                                <label className="text-[8px] text-slate-500 block mb-0.5">空头：最大跌幅 %</label>
                                <input 
                                    type="number" 
                                    value={antiChase.maxFall} 
                                    onChange={e => setConfig(p => ({...p, antiChase: {...p.antiChase!, maxFall: parseFloat(e.target.value)}}))}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-1 py-1 text-[10px] text-red-400 font-bold text-center outline-none focus:border-red-500"
                                />
                            </div>
                        </div>
                        <div className="text-[8px] text-slate-500 text-center pt-1 border-t border-slate-700/50">
                            * 基于K线图周期内的涨跌幅计算
                        </div>
                    </div>
                )}
            </div>

            {/* Compact Row: 7K Thrust | Same Color | Strict Trend (Left-Right Layout) */}
            <div className="grid grid-cols-3 gap-1">
                <div className="flex items-center justify-between bg-slate-800 rounded border border-slate-700 px-1.5 py-1">
                    <div className="flex items-center gap-1 text-orange-400 font-bold text-[9px] whitespace-nowrap">
                        <Rocket size={10} className="text-orange-500" />7K推进
                    </div>
                    <div onClick={() => setConfig(p => ({...p, enableThrust: !p.enableThrust}))} className={`w-6 h-3 rounded-full p-0.5 cursor-pointer transition-colors ${config.enableThrust ? 'bg-orange-600' : 'bg-slate-700'}`}>
                        <div className={`w-2 h-2 bg-white rounded-full transition-transform shadow-sm ${config.enableThrust ? 'translate-x-3' : ''}`} />
                    </div>
                </div>
                
                <div className="flex items-center justify-between bg-slate-800 rounded border border-slate-700 px-1.5 py-1">
                    <span className="text-[9px] text-slate-400 font-bold whitespace-nowrap">同色交叉</span>
                    <div onClick={() => setConfig(p => ({...p, checkCandleColor: !p.checkCandleColor}))} className={`w-6 h-3 rounded-full p-0.5 cursor-pointer transition-colors ${config.checkCandleColor ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                        <div className={`w-2 h-2 bg-white rounded-full transition-transform shadow-sm ${config.checkCandleColor ? 'translate-x-3' : ''}`} />
                    </div>
                </div>

                <div className="flex items-center justify-between bg-slate-800 rounded border border-slate-700 px-1.5 py-1">
                    <span className="text-[9px] text-slate-400 font-bold whitespace-nowrap">严格趋势</span>
                    <div onClick={() => setConfig(p => ({...p, strictTrend: !p.strictTrend}))} className={`w-6 h-3 rounded-full p-0.5 cursor-pointer transition-colors ${config.strictTrend ? 'bg-emerald-600' : 'bg-slate-700'}`}>
                        <div className={`w-2 h-2 bg-white rounded-full transition-transform shadow-sm ${config.strictTrend ? 'translate-x-3' : ''}`} />
                    </div>
                </div>
            </div>

            {/* Resonance Section (Left-Right Layout for Inputs) */}
            <div>
                <div className="flex items-center justify-between mb-1">
                    <div className="text-[9px] text-slate-500 flex items-center gap-1 uppercase font-bold"><ArrowUpDown size={10}/> 时空共振与波幅审计</div>
                    <div onClick={() => setConfig(p => ({...p, enableResonance: !p.enableResonance}))} className={`w-7 h-3.5 rounded-full p-0.5 cursor-pointer transition-colors ${config.enableResonance ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                        <div className={`w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${config.enableResonance ? 'translate-x-3.5' : ''}`} />
                    </div>
                </div>
                
                <div className={`grid grid-cols-4 gap-1 transition-opacity ${config.enableResonance ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                    <div className="bg-slate-800/80 rounded border border-slate-700 px-1.5 py-1 flex items-center justify-between">
                        <span className="text-[9px] text-slate-500">回溯</span>
                        <input type="number" value={config.lookback} onChange={(e) => setConfig(p => ({...p, lookback: parseFloat(e.target.value)}))} className="w-8 bg-transparent text-right text-[10px] font-bold text-white outline-none"/>
                    </div>
                    <div className="bg-slate-800/80 rounded border border-slate-700 px-1.5 py-1 flex items-center justify-between">
                        <span className="text-[9px] text-slate-500">穿越</span>
                        <input type="number" value={config.minCrossCount} onChange={(e) => setConfig(p => ({...p, minCrossCount: parseFloat(e.target.value)}))} className="w-8 bg-transparent text-right text-[10px] font-bold text-orange-400 outline-none"/>
                    </div>
                    <div className="bg-slate-800/80 rounded border border-slate-700 px-1.5 py-1 flex items-center justify-between">
                        <span className="text-[9px] text-slate-500">位置</span>
                        <input type="number" value={config.maxLocation} onChange={(e) => setConfig(p => ({...p, maxLocation: parseFloat(e.target.value)}))} className="w-8 bg-transparent text-right text-[10px] font-bold text-blue-400 outline-none"/>
                    </div>
                    <div className="bg-slate-800/80 rounded border border-slate-700 px-1.5 py-1 flex items-center justify-between">
                        <span className="text-[9px] text-slate-500">带宽</span>
                        <input type="number" step="0.001" value={config.maxBBW} onChange={(e) => setConfig(p => ({...p, maxBBW: parseFloat(e.target.value)}))} className="w-8 bg-transparent text-right text-[10px] font-bold text-emerald-400 outline-none"/>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2"><div className="flex flex-col bg-slate-800 rounded border border-slate-700 p-1"><span className="text-[8px] text-slate-500 mb-0.5 flex items-center justify-center gap-1"><Activity size={8}/> RSI (多) 区间</span><div className="flex items-center justify-center gap-1"><input type="number" value={config.rsiLongMin} onChange={(e) => setConfig(p => ({...p, rsiLongMin: parseFloat(e.target.value)}))} className="w-12 bg-slate-700 border border-slate-600 rounded text-center text-sm font-bold text-white outline-none"/><span className="text-[8px] text-slate-600">-</span><input type="number" value={config.rsiLongMax} onChange={(e) => setConfig(p => ({...p, rsiLongMax: parseFloat(e.target.value)}))} className="w-12 bg-slate-700 border border-slate-600 rounded text-center text-sm font-bold text-white outline-none"/></div></div><div className="flex flex-col bg-slate-800 rounded border border-slate-700 p-1"><span className="text-[8px] text-slate-500 mb-0.5 flex items-center justify-center gap-1"><Activity size={8}/> RSI (空) 区间</span><div className="flex items-center justify-center gap-1"><input type="number" value={config.rsiShortMin} onChange={(e) => setConfig(p => ({...p, rsiShortMin: parseFloat(e.target.value)}))} className="w-12 bg-slate-700 border border-slate-600 rounded text-center text-sm font-bold text-white outline-none"/><span className="text-[8px] text-slate-600">-</span><input type="number" value={config.rsiShortMax} onChange={(e) => setConfig(p => ({...p, rsiShortMax: parseFloat(e.target.value)}))} className="w-12 bg-slate-700 border border-slate-600 rounded text-center text-sm font-bold text-white outline-none"/></div></div></div>
        </div>
    );
};
