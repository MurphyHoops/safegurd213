
import React from 'react';
import { History, GitMerge, Droplet, Filter, Hourglass } from 'lucide-react';
import { List2Config } from '../scannerTypes';
import { SmartNumberInput } from '../ScannerUIHelpers';

interface Props {
    config: List2Config;
    setConfig: React.Dispatch<React.SetStateAction<List2Config>>;
}

export const ConfigSection: React.FC<Props> = ({ config, setConfig }) => {
    return (
        <div className="space-y-3">
            {/* ROW 1: Trigger Mode & Retention/Backtrace Split Layout */}
            <div className="grid grid-cols-2 gap-1.5">
                {/* Block 1: ONLY NEW (仅限新增) */}
                <div 
                    onClick={() => setConfig(p => ({...p, triggerMode: 'NEW'}))}
                    className={`flex flex-col gap-1 p-1.5 rounded border transition-all cursor-pointer select-none ${config.triggerMode === 'NEW' ? 'bg-emerald-900/20 border-emerald-500/50 shadow-sm' : 'bg-slate-800/50 border-slate-700 hover:bg-slate-800 opacity-70 hover:opacity-100'}`}
                >
                    <div className={`text-[10px] font-bold text-center ${config.triggerMode === 'NEW' ? 'text-emerald-400' : 'text-slate-500'}`}>仅限新增</div>
                    <div className="flex items-center justify-center gap-1 bg-slate-900/50 rounded px-1 py-1 border border-slate-800/50">
                        <span className="text-[9px] text-slate-500 font-bold whitespace-nowrap">消失</span>
                        <input 
                            type="number" 
                            value={Number.isNaN(config.newModeRetention) ? '' : (config.newModeRetention ?? 9)} 
                            onChange={(e) => { e.stopPropagation(); setConfig(p => ({...p, newModeRetention: parseInt(e.target.value) || 0})); }} 
                            className="w-8 bg-transparent text-center text-[10px] font-bold text-orange-400 outline-none p-0 border-b border-orange-500/30 focus:border-orange-500" 
                        />
                        <Hourglass size={10} className="text-orange-500/70"/>
                    </div>
                </div>

                {/* Block 2: INCLUDE EXISTING (包含存续) */}
                <div 
                    onClick={() => setConfig(p => ({...p, triggerMode: 'ALL'}))}
                    className={`flex flex-col gap-1 p-1.5 rounded border transition-all cursor-pointer select-none ${config.triggerMode === 'ALL' ? 'bg-indigo-900/20 border-indigo-500/50 shadow-sm' : 'bg-slate-800/50 border-slate-700 hover:bg-slate-800 opacity-70 hover:opacity-100'}`}
                >
                    <div className={`text-[10px] font-bold text-center ${config.triggerMode === 'ALL' ? 'text-indigo-400' : 'text-slate-500'}`}>包含存续</div>
                    <div className="flex items-center justify-center gap-1 bg-slate-900/50 rounded px-1 py-1 border border-slate-800/50">
                        <span className="text-[9px] text-slate-500 font-bold whitespace-nowrap">回溯</span>
                        <input 
                            type="number" 
                            value={Number.isNaN(config.maxLag) ? '' : config.maxLag} 
                            onChange={(e) => { e.stopPropagation(); setConfig(p => ({...p, maxLag: parseInt(e.target.value) || 0})); }} 
                            className="w-8 bg-transparent text-center text-[10px] font-bold text-white outline-none p-0 border-b border-slate-600 focus:border-indigo-500" 
                        />
                        <History size={10} className="text-indigo-500/70"/>
                    </div>
                </div>
            </div>

            {/* ROW 2: EMA80 Trend & Sort Mode */}
            <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between bg-slate-800/50 p-1.5 rounded border border-slate-700/50">
                    <div className="flex items-center gap-1 text-[9px] text-blue-400 font-bold"><GitMerge size={10} /> EMA80趋势</div>
                    <div onClick={() => setConfig(p => ({...p, checkEma80Conflict: !p.checkEma80Conflict}))} className={`w-6 h-3 rounded-full p-0.5 cursor-pointer transition-colors ${config.checkEma80Conflict ? 'bg-blue-600' : 'bg-slate-700'}`}><div className={`w-2 h-2 bg-white rounded-full shadow transition-transform ${config.checkEma80Conflict ? 'translate-x-3' : ''}`} /></div>
                </div>
                
                <div className="flex bg-slate-800/50 rounded p-0.5 border border-slate-700/50 items-center">
                    <button 
                        onClick={() => setConfig(p => ({...p, sortMode: 'LATEST'}))}
                        className={`flex-1 h-full text-[9px] font-bold rounded transition-all ${config.sortMode === 'LATEST' ? 'bg-slate-700 text-white shadow-sm border border-slate-600' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                        最新
                    </button>
                    <button 
                        onClick={() => setConfig(p => ({...p, sortMode: 'MOST'}))}
                        className={`flex-1 h-full text-[9px] font-bold rounded transition-all ${config.sortMode === 'MOST' ? 'bg-slate-700 text-white shadow-sm border border-slate-600' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                        最多
                    </button>
                </div>
            </div>
            
            {/* ZOMBIE FILTER UI */}
            <div className="bg-slate-800/50 p-2 rounded border border-slate-700/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 text-[10px] text-orange-400 font-bold"><Droplet size={11} /> 僵尸过滤</div>
                    <div onClick={() => setConfig(p => ({...p, enableFlatFilter: !p.enableFlatFilter}))} className={`w-6 h-3 rounded-full p-0.5 cursor-pointer transition-colors ${config.enableFlatFilter ? 'bg-orange-600' : 'bg-slate-700'}`}>
                        <div className={`w-2 h-2 bg-white rounded-full shadow transition-transform ${config.enableFlatFilter ? 'translate-x-3' : ''}`} />
                    </div>
                </div>
                {config.enableFlatFilter && (
                    <div className="flex items-center gap-1.5 animate-in fade-in slide-in-from-right-2">
                        <span className="text-[9px] text-slate-500 font-bold">回</span>
                        <SmartNumberInput value={config.flatLookback} onChange={val => setConfig(p => ({...p, flatLookback: val}))} className="w-10 bg-slate-900 border border-slate-700 rounded text-center text-[10px] text-white outline-none font-mono py-0.5" />
                        <span className="text-[9px] text-slate-500 font-bold">阈</span>
                        <SmartNumberInput value={config.flatThreshold} onChange={val => setConfig(p => ({...p, flatThreshold: val}))} className="w-10 bg-slate-900 border border-slate-700 rounded text-center text-[10px] text-orange-400 outline-none font-mono font-bold py-0.5" />
                    </div>
                )}
            </div>

            {/* STRICT RULES */}
            <div>
                <div className="text-[9px] text-amber-500 mb-1.5 flex gap-1 items-center font-bold">
                    <Filter size={10}/> 严格过滤条件 (STRICT RULES)
                </div>
                <div className="grid grid-cols-4 gap-1">
                    <div className="space-y-1 relative group">
                        <div className="absolute -top-1 -right-1 text-[6px] bg-amber-500 text-black px-0.5 rounded font-bold">MIN</div>
                        <label className="text-[8px] text-slate-500 block text-center">振幅 &ge;</label>
                        <input type="number" step="0.1" value={Number.isNaN(config.squeezeThreshold) ? '' : config.squeezeThreshold} onChange={e => setConfig(p => ({...p, squeezeThreshold: parseFloat(e.target.value)}))} className="w-full bg-slate-800 border border-amber-500/50 rounded text-center text-[10px] text-amber-400 outline-none py-1 font-bold shadow-[0_0_5px_rgba(245,158,11,0.2)]" />
                    </div>
                    <div className="space-y-1 relative group">
                        <div className="absolute -top-1 -right-1 text-[6px] bg-amber-500 text-black px-0.5 rounded font-bold">MAX</div>
                        <label className="text-[8px] text-slate-500 block text-center">振幅 &le;</label>
                        <input type="number" step="0.1" value={Number.isNaN(config.maxAmplitude) ? '' : config.maxAmplitude} onChange={e => setConfig(p => ({...p, maxAmplitude: parseFloat(e.target.value)}))} className="w-full bg-slate-800 border border-amber-500/50 rounded text-center text-[10px] text-amber-400 outline-none py-1 font-bold shadow-[0_0_5px_rgba(245,158,11,0.2)]" />
                    </div>
                    <div className="space-y-1 relative">
                        <div className="absolute -top-1 -right-1 text-[6px] bg-blue-500 text-white px-0.5 rounded font-bold">VOL</div>
                        <label className="text-[8px] text-slate-500 block text-center">放量(x)</label>
                        <input type="number" step="0.1" value={Number.isNaN(config.volMultiplier) ? '' : config.volMultiplier} onChange={e => setConfig(p => ({...p, volMultiplier: parseFloat(e.target.value)}))} className="w-full bg-slate-800 border border-blue-500/50 rounded text-center text-[10px] text-white outline-none py-1 font-bold shadow-[0_0_5px_rgba(59,130,246,0.2)]" />
                    </div>
                    <div className="space-y-1 relative">
                        <div className="absolute -top-1 -right-1 text-[6px] bg-emerald-500 text-white px-0.5 rounded font-bold">BODY</div>
                        <label className="text-[8px] text-slate-500 block text-center">实体(%)</label>
                        <input type="number" value={Number.isNaN(config.minBodyRatio) ? '' : config.minBodyRatio} onChange={e => setConfig(p => ({...p, minBodyRatio: parseFloat(e.target.value)}))} className="w-full bg-slate-800 border border-emerald-500/50 rounded text-center text-[10px] text-white outline-none py-1 font-bold shadow-[0_0_5px_rgba(16,185,129,0.2)]" />
                    </div>
                </div>
            </div>
        </div>
    );
};
