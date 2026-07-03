
import React, { useState } from 'react';
import { Clock, Zap, Rocket, ArrowUpDown, Activity, ChevronDown, ChevronUp } from 'lucide-react';
import { List3Config } from '../../../components/Scanner/scannerTypes';

interface List3PanelProps {
    config: List3Config;
    setConfig: React.Dispatch<React.SetStateAction<List3Config>>;
    countdowns: Record<string, string>; 
}

export const List3Control: React.FC<List3PanelProps> = ({ config, setConfig, countdowns }) => {
    const ALL_TFS = ['5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
    const toggleTf = (tf: string) => setConfig(prev => ({ ...prev, timeframes: prev.timeframes.includes(tf) ? prev.timeframes.filter(t => t !== tf) : [...prev.timeframes, tf] }));
    const isActive = config.timeframes.length > 0;
    
    return (
        <div className="p-3 bg-slate-900 border-b border-slate-800 space-y-2 shrink-0">
            <div className="flex items-center justify-between mb-1">
                <div className="font-bold text-slate-200 text-sm flex items-center gap-2">3. 结构审计 (Structure Audit)</div>
            </div>
            <div className="flex items-center justify-between bg-blue-900/20 px-2 py-1.5 rounded border border-blue-500/30">
                <div className="flex items-center gap-1 text-blue-300 font-bold text-[10px]"><Zap size={11} className="text-blue-400" />自动策略开仓 (Auto Strategy)</div>
                <div onClick={() => setConfig(p => ({...p, autoSimOpen: !p.autoSimOpen}))} className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${config.autoSimOpen ? 'bg-blue-600' : 'bg-slate-700'}`}><div className={`w-3 h-3 bg-white rounded-full transition-transform shadow-sm ${config.autoSimOpen ? 'translate-x-4' : ''}`} /></div>
            </div>

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

            {/* Compact Row: Same Color */}
            <div className="flex items-center justify-between bg-slate-800 rounded border border-slate-700 px-1.5 py-1 mb-1">
                <span className="text-[9px] text-slate-400 font-bold whitespace-nowrap">同色交叉</span>
                <div onClick={() => setConfig(p => ({...p, checkCandleColor: !p.checkCandleColor}))} className={`w-6 h-3 rounded-full p-0.5 cursor-pointer transition-colors ${config.checkCandleColor ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                    <div className={`w-2 h-2 bg-white rounded-full transition-transform shadow-sm ${config.checkCandleColor ? 'translate-x-3' : ''}`} />
                </div>
            </div>

            {/* Row: Strict Trend & Spacetime Resonance */}
            <div className="grid grid-cols-2 gap-1 mb-1">
                <div className={`flex items-center justify-between bg-slate-800/50 rounded border ${config.strictTrend ? 'border-emerald-500/50' : 'border-slate-700'} px-2 py-1.5`}>
                    <span className="text-[9px] text-slate-300 font-bold whitespace-nowrap">严格趋势</span>
                    <div onClick={() => setConfig(p => ({...p, strictTrend: !p.strictTrend}))} className={`w-6 h-3 rounded-full p-0.5 cursor-pointer transition-colors ${config.strictTrend ? 'bg-emerald-600' : 'bg-slate-700'}`}>
                        <div className={`w-2 h-2 bg-white rounded-full transition-transform shadow-sm ${config.strictTrend ? 'translate-x-3' : ''}`} />
                    </div>
                </div>

                <div className={`flex items-center justify-between bg-slate-800/50 rounded border ${config.enableMultiResonance ? 'border-yellow-500/50' : 'border-slate-700'} px-2 py-1.5`}>
                    <div className="flex items-center gap-1">
                        <ArrowUpDown size={10} className="text-yellow-400" />
                        <span className="text-[9px] text-slate-300 font-bold whitespace-nowrap" title="需大小级别之一符合严格趋势">时空共振</span>
                    </div>
                    <div onClick={() => setConfig(p => ({...p, enableMultiResonance: !p.enableMultiResonance}))} className={`w-6 h-3 rounded-full p-0.5 cursor-pointer transition-colors ${config.enableMultiResonance ? 'bg-yellow-600' : 'bg-slate-700'}`}>
                        <div className={`w-2 h-2 bg-white rounded-full shadow transition-transform ${config.enableMultiResonance ? 'translate-x-3' : ''}`} />
                    </div>
                </div>
            </div>

            {/* 2. 波幅审计 (Amplitude Audit) */}
            <div>
                <div className="flex items-center justify-between mb-1">
                    <div className="text-[9px] text-slate-500 flex items-center gap-1 uppercase font-bold"><ArrowUpDown size={10}/> 2. 波幅审计</div>
                    <div onClick={() => setConfig(p => ({...p, enableAmplitudeAudit: !p.enableAmplitudeAudit}))} className={`w-7 h-3.5 rounded-full p-0.5 cursor-pointer transition-colors ${config.enableAmplitudeAudit ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                        <div className={`w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${config.enableAmplitudeAudit ? 'translate-x-3.5' : ''}`} />
                    </div>
                </div>
                
                <div className={`grid grid-cols-4 gap-1 transition-opacity ${config.enableAmplitudeAudit ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                    <div className="bg-slate-800/80 rounded border border-slate-700 px-1.5 py-1 flex items-center justify-between">
                        <span className="text-[9px] text-slate-500">回溯</span>
                        <input type="number" value={Number.isNaN(config.lookback) ? '' : config.lookback} onChange={(e) => setConfig(p => ({...p, lookback: parseFloat(e.target.value)}))} className="w-8 bg-transparent text-right text-[10px] font-bold text-white outline-none"/>
                    </div>
                    <div className="bg-slate-800/80 rounded border border-slate-700 px-1.5 py-1 flex items-center justify-between">
                        <span className="text-[9px] text-slate-500">穿越</span>
                        <input type="number" value={Number.isNaN(config.minCrossCount) ? '' : config.minCrossCount} onChange={(e) => setConfig(p => ({...p, minCrossCount: parseFloat(e.target.value)}))} className="w-8 bg-transparent text-right text-[10px] font-bold text-orange-400 outline-none"/>
                    </div>
                    <div className="bg-slate-800/80 rounded border border-slate-700 px-1.5 py-1 flex items-center justify-between">
                        <span className="text-[9px] text-slate-500">位置</span>
                        <input type="number" value={Number.isNaN(config.maxLocation) ? '' : config.maxLocation} onChange={(e) => setConfig(p => ({...p, maxLocation: parseFloat(e.target.value)}))} className="w-8 bg-transparent text-right text-[10px] font-bold text-blue-400 outline-none"/>
                    </div>
                    <div className="bg-slate-800/80 rounded border border-slate-700 px-1.5 py-1 flex items-center justify-between">
                        <span className="text-[9px] text-slate-500">带宽</span>
                        <input type="number" step="0.001" value={Number.isNaN(config.maxBBW) ? '' : config.maxBBW} onChange={(e) => setConfig(p => ({...p, maxBBW: parseFloat(e.target.value)}))} className="w-8 bg-transparent text-right text-[10px] font-bold text-emerald-400 outline-none"/>
                    </div>
                </div>
            </div>

            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between bg-slate-800 rounded border border-slate-700 px-2 py-1.5">
                    <div className="text-[9px] text-slate-400 font-bold flex items-center gap-1">
                        <Activity size={10} className="text-pink-500"/>
                        启用 RSI 动能过滤
                    </div>
                    <div onClick={() => setConfig(p => ({...p, enableRsi: p.enableRsi === undefined ? false : !p.enableRsi}))} className={`w-6 h-3 rounded-full p-0.5 cursor-pointer transition-colors ${config.enableRsi !== false ? 'bg-pink-600' : 'bg-slate-700'}`}>
                        <div className={`w-2 h-2 bg-white rounded-full transition-transform shadow-sm ${config.enableRsi !== false ? 'translate-x-3' : ''}`} />
                    </div>
                </div>
                
                <div className={`grid grid-cols-2 gap-2 transition-opacity ${config.enableRsi !== false ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                    <div className="flex flex-col bg-slate-800 rounded border border-slate-700 p-1">
                        <span className="text-[8px] text-slate-500 mb-0.5 flex items-center justify-center gap-1"><Activity size={8}/> RSI (多) 区间</span>
                        <div className="flex items-center justify-center gap-1">
                            <input type="number" value={Number.isNaN(config.rsiLongMin) ? '' : config.rsiLongMin} onChange={(e) => setConfig(p => ({...p, rsiLongMin: parseFloat(e.target.value)}))} className="w-12 bg-slate-700 border border-slate-600 rounded text-center text-sm font-bold text-white outline-none"/>
                            <span className="text-[8px] text-slate-600">-</span>
                            <input type="number" value={Number.isNaN(config.rsiLongMax) ? '' : config.rsiLongMax} onChange={(e) => setConfig(p => ({...p, rsiLongMax: parseFloat(e.target.value)}))} className="w-12 bg-slate-700 border border-slate-600 rounded text-center text-sm font-bold text-white outline-none"/>
                        </div>
                    </div>
                    <div className="flex flex-col bg-slate-800 rounded border border-slate-700 p-1">
                        <span className="text-[8px] text-slate-500 mb-0.5 flex items-center justify-center gap-1"><Activity size={8}/> RSI (空) 区间</span>
                        <div className="flex items-center justify-center gap-1">
                            <input type="number" value={Number.isNaN(config.rsiShortMin) ? '' : config.rsiShortMin} onChange={(e) => setConfig(p => ({...p, rsiShortMin: parseFloat(e.target.value)}))} className="w-12 bg-slate-700 border border-slate-600 rounded text-center text-sm font-bold text-white outline-none"/>
                            <span className="text-[8px] text-slate-600">-</span>
                            <input type="number" value={Number.isNaN(config.rsiShortMax) ? '' : config.rsiShortMax} onChange={(e) => setConfig(p => ({...p, rsiShortMax: parseFloat(e.target.value)}))} className="w-12 bg-slate-700 border border-slate-600 rounded text-center text-sm font-bold text-white outline-none"/>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
