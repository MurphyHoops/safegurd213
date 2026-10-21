
import React from 'react';
import { History, GitMerge, Droplet, Filter, Hourglass, TrendingUp } from 'lucide-react';
import { List2Config } from '../../../components/Scanner/scannerTypes';
import { SmartNumberInput } from '../../../components/Scanner/ScannerUIHelpers';

interface Props {
    config: List2Config;
    setConfig: React.Dispatch<React.SetStateAction<List2Config>>;
}

export const ConfigSection: React.FC<Props> = ({ config, setConfig }) => {
    return (
        <div className="space-y-3">
            {/* ROW 1: Signal Retention & Lookback */}
            <div className="bg-slate-800/50 p-2 rounded border border-slate-700/50 space-y-2">
                <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-bold">
                    <History size={11} className="text-emerald-500"/> 信号存续
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center justify-between bg-slate-900/50 rounded px-2 py-1 border border-slate-800/50">
                        <span className="text-[9px] text-slate-500 font-bold whitespace-nowrap">访问过去</span>
                        <div className="flex items-center gap-1">
                            <input 
                                type="number" 
                                value={Number.isNaN(config.lookbackBars) ? '' : (config.lookbackBars ?? 5)} 
                                onChange={(e) => { e.stopPropagation(); setConfig(p => ({...p, lookbackBars: parseInt(e.target.value) || 0})); }} 
                                className="w-6 bg-transparent text-right text-[10px] font-bold text-cyan-400 outline-none p-0 border-b border-cyan-500/30 focus:border-cyan-500" 
                            />
                            <span className="text-[9px] text-slate-500 font-bold">根</span>
                        </div>
                    </div>
                    <div className="flex items-center justify-between bg-slate-900/50 rounded px-2 py-1 border border-slate-800/50">
                        <span className="text-[9px] text-slate-500 font-bold whitespace-nowrap">寿命根数</span>
                        <div className="flex items-center gap-1">
                            <input 
                                type="number" 
                                value={Number.isNaN(config.newModeRetention) ? '' : (config.newModeRetention ?? 9)} 
                                onChange={(e) => { e.stopPropagation(); setConfig(p => ({...p, newModeRetention: parseInt(e.target.value) || 0})); }} 
                                className="w-6 bg-transparent text-right text-[10px] font-bold text-orange-400 outline-none p-0 border-b border-orange-500/30 focus:border-orange-500" 
                            />
                            <span className="text-[9px] text-slate-500 font-bold">根</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* ROW 1.5: 信号K线振幅偏离限制 (Price Deviation Filter from Signal Candle) */}
            <div className="bg-slate-800/50 p-2 rounded border border-slate-700/50 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                    <div className="flex items-center gap-1 text-[10px] text-amber-400 font-bold whitespace-nowrap">
                        <TrendingUp size={10} className="text-amber-500 shrink-0" /> 振幅偏离限制
                    </div>
                    {(config.enableSignalDeviationFilter ?? false) && (
                        <div className="flex items-center gap-1 animate-in fade-in slide-in-from-left-2 ml-1">
                            <span className="text-[9px] text-slate-500 font-bold whitespace-nowrap">阈值</span>
                            <div className="flex items-center gap-1 bg-slate-900/80 px-2 py-0.5 rounded border border-slate-700/60">
                                <input 
                                    type="number" 
                                    min={0}
                                    max={1000}
                                    value={Number.isNaN(config.maxSignalDeviationPercent) ? '' : (config.maxSignalDeviationPercent ?? 50)} 
                                    onChange={(e) => { e.stopPropagation(); setConfig(p => ({...p, maxSignalDeviationPercent: parseInt(e.target.value) || 0})); }} 
                                    className="w-10 bg-transparent text-right text-[11px] font-bold text-amber-300 outline-none p-0 border-b border-amber-500/40 focus:border-amber-400" 
                                />
                                <span className="text-[9px] text-slate-400 font-bold whitespace-nowrap">%</span>
                            </div>
                        </div>
                    )}
                </div>
                <div 
                    onClick={() => setConfig(p => ({...p, enableSignalDeviationFilter: !p.enableSignalDeviationFilter}))} 
                    className={`w-7 h-3.5 rounded-full p-0.5 cursor-pointer transition-colors shrink-0 ml-2 ${config.enableSignalDeviationFilter ? 'bg-amber-600' : 'bg-slate-700'}`}
                >
                    <div className={`w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${config.enableSignalDeviationFilter ? 'translate-x-3.5' : ''}`} />
                </div>
            </div>

            {/* ROW 2: EMA80 Trend */}
            <div className="flex items-center justify-between bg-slate-800/50 p-2 rounded border border-slate-700/50">
                <div className="flex items-center gap-1.5 text-[10px] text-blue-400 font-bold"><GitMerge size={11} className="text-blue-500" /> EMA80 趋势过滤 (主线趋势保护)</div>
                <div onClick={() => setConfig(p => ({...p, checkEma80Conflict: !p.checkEma80Conflict}))} className={`w-7 h-3.5 rounded-full p-0.5 cursor-pointer transition-colors ${config.checkEma80Conflict ? 'bg-blue-600' : 'bg-slate-700'}`}><div className={`w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${config.checkEma80Conflict ? 'translate-x-3.5' : ''}`} /></div>
            </div>

            {/* NEW: Decoupled Crossing & Divergence Triggers */}
            <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center justify-between bg-slate-800/50 p-2 rounded border border-slate-700/50">
                        <div className="flex flex-col gap-0.5">
                            <div className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                                <TrendingUp size={10}/> K线穿越实体
                            </div>
                            <div className="text-[7px] text-slate-500 italic leading-none">实体穿越EMA10-40簇</div>
                        </div>
                        <div onClick={() => setConfig(p => ({...p, requireCrossing: !p.requireCrossing}))} className={`w-8 h-4 rounded-full p-0.5 cursor-pointer transition-colors ${config.requireCrossing ? 'bg-emerald-600' : 'bg-slate-700'}`}>
                            <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${config.requireCrossing ? 'translate-x-4' : ''}`} />
                        </div>
                    </div>

                    <div className="flex items-center justify-between bg-slate-800/50 p-2 rounded border border-slate-700/50">
                        <div className="flex flex-col gap-0.5">
                            <div className="text-[10px] text-cyan-400 font-bold flex items-center gap-1">
                                <TrendingUp size={10}/> EMA均线发散
                            </div>
                            <div className="text-[7px] text-slate-500 italic leading-none">10-20-30-40完美排列</div>
                        </div>
                        <div onClick={() => setConfig(p => ({...p, requireAlignment: !p.requireAlignment}))} className={`w-8 h-4 rounded-full p-0.5 cursor-pointer transition-colors ${config.requireAlignment ? 'bg-cyan-600' : 'bg-slate-700'}`}>
                            <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${config.requireAlignment ? 'translate-x-4' : ''}`} />
                        </div>
                    </div>
                </div>

                {/* AND / OR / WAIT Logic Selector */}
                <div className="flex flex-col gap-1.5 bg-slate-800/50 p-2 rounded border border-slate-700/50">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-300 font-bold">条件组合关系 (Logic)</span>
                        <div className="flex bg-slate-900 rounded p-0.5 border border-slate-700 items-center">
                            <button 
                                onClick={() => setConfig(p => ({...p, crossingDivergenceLogic: 'AND'}))}
                                className={`px-2.5 py-1 text-[9px] font-bold rounded transition-all ${(config.crossingDivergenceLogic || 'AND') === 'AND' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                            >
                                且 (AND)
                            </button>
                            <button 
                                onClick={() => setConfig(p => ({...p, crossingDivergenceLogic: 'OR'}))}
                                className={`px-2.5 py-1 text-[9px] font-bold rounded transition-all ${(config.crossingDivergenceLogic || 'AND') === 'OR' ? 'bg-amber-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                            >
                                或 (OR)
                            </button>
                            <button 
                                onClick={() => setConfig(p => ({...p, crossingDivergenceLogic: 'WAIT'}))}
                                className={`px-2.5 py-1 text-[9px] font-bold rounded transition-all ${(config.crossingDivergenceLogic || 'AND') === 'WAIT' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                            >
                                等待 (WAIT)
                            </button>
                        </div>
                    </div>
                    {/* 等待模式下展开：等待发散根数配置 */}
                    {config.crossingDivergenceLogic === 'WAIT' && (
                        <div className="flex items-center justify-between bg-slate-900/80 px-2 py-1 rounded border border-indigo-500/30 animate-in fade-in slide-in-from-top-1">
                            <span className="text-[9px] text-indigo-300 font-bold whitespace-nowrap">⏳ 穿越后等待发散K线</span>
                            <div className="flex items-center gap-1">
                                <input 
                                    type="number" 
                                    min={1}
                                    max={100}
                                    value={Number.isNaN(config.waitDivergenceBars) ? '' : (config.waitDivergenceBars ?? 5)} 
                                    onChange={(e) => { e.stopPropagation(); setConfig(p => ({...p, waitDivergenceBars: parseInt(e.target.value) || 1})); }} 
                                    className="w-8 bg-transparent text-right text-[10px] font-bold text-indigo-300 outline-none p-0 border-b border-indigo-500/50 focus:border-indigo-400 font-mono" 
                                />
                                <span className="text-[9px] text-slate-400 font-bold whitespace-nowrap">根</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Sub-config for EMA Divergence: Cross Backtrack toggle and Bars input */}
                <div className="bg-slate-800/40 p-2 rounded border border-slate-700/40 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                        <div className="flex items-center gap-1 text-[10px] text-cyan-400 font-bold whitespace-nowrap">
                            <GitMerge size={10} className="text-cyan-500 shrink-0" /> 发散回溯穿越
                        </div>
                        {(config.enableDivergenceCrossCheck ?? true) && (
                            <div className="flex items-center gap-1 animate-in fade-in slide-in-from-left-2 ml-1">
                                <span className="text-[9px] text-slate-500 font-bold whitespace-nowrap">数量</span>
                                <div className="flex items-center gap-1 bg-slate-900/80 px-2 py-0.5 rounded border border-slate-700/60">
                                    <input 
                                        type="number" 
                                        min={1}
                                        max={500}
                                        value={Number.isNaN(config.divergenceLookbackBars) ? '' : (config.divergenceLookbackBars ?? 20)} 
                                        onChange={(e) => { e.stopPropagation(); setConfig(p => ({...p, divergenceLookbackBars: parseInt(e.target.value) || 0})); }} 
                                        className="w-12 bg-transparent text-right text-[11px] font-bold text-cyan-300 outline-none p-0 border-b border-cyan-500/40 focus:border-cyan-400" 
                                    />
                                    <span className="text-[9px] text-slate-400 font-bold whitespace-nowrap">根</span>
                                </div>
                            </div>
                        )}
                    </div>

                    <div 
                        onClick={() => setConfig(p => ({...p, enableDivergenceCrossCheck: p.enableDivergenceCrossCheck !== undefined ? !p.enableDivergenceCrossCheck : false}))} 
                        className={`w-7 h-3.5 rounded-full p-0.5 cursor-pointer transition-colors shrink-0 ${(config.enableDivergenceCrossCheck ?? true) ? 'bg-cyan-600' : 'bg-slate-700'}`}
                        title="开启后发散前置需在过去N根K线内EMA10穿越过EMA20/30/40"
                    >
                        <div className={`w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${(config.enableDivergenceCrossCheck ?? true) ? 'translate-x-3.5' : ''}`} />
                    </div>
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
            <div className={`transition-opacity ${config.strictFiltering ? 'opacity-100' : 'opacity-60'}`}>
                <div className="flex items-center justify-between mb-1.5">
                    <div className="text-[9px] text-amber-400 flex gap-1 items-center font-bold">
                        <Filter size={10}/> 严格过滤条件 (STRICT RULES)
                    </div>
                    <div className="flex items-center gap-1.5" title="开启后严格执行形态振幅与周期点火放量过滤">
                        <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">严格过滤开关</span>
                        <div onClick={() => setConfig(p => ({...p, strictFiltering: !p.strictFiltering}))} className={`w-8 h-4 rounded-full p-0.5 cursor-pointer transition-colors ${config.strictFiltering ? 'bg-emerald-600' : 'bg-slate-700'}`}>
                            <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${config.strictFiltering ? 'translate-x-4' : ''}`} />
                        </div>
                    </div>
                </div>
                {/* 第一排：形态结构 (SHAPE) */}
                <div className="grid grid-cols-3 gap-1 mb-1.5">
                    <div className="space-y-1 relative group" title="最小振幅门槛：过滤死水横盘币">
                        <div className="absolute -top-1 -right-1 text-[6px] bg-amber-500 text-black px-0.5 rounded font-bold">MIN</div>
                        <label className="text-[8px] text-slate-400 block text-center font-medium">振幅 &ge; (%)</label>
                        <input type="number" step="0.1" value={Number.isNaN(config.squeezeThreshold) ? '' : config.squeezeThreshold} onChange={e => setConfig(p => ({...p, squeezeThreshold: parseFloat(e.target.value)}))} className="w-full bg-slate-800 border border-amber-500/50 rounded text-center text-[10px] text-amber-400 outline-none py-1 font-bold shadow-[0_0_5px_rgba(245,158,11,0.2)]" />
                    </div>
                    <div className="space-y-1 relative group" title="最大振幅限制：拦截插针过激币">
                        <div className="absolute -top-1 -right-1 text-[6px] bg-amber-500 text-black px-0.5 rounded font-bold">MAX</div>
                        <label className="text-[8px] text-slate-400 block text-center font-medium">振幅 &le; (%)</label>
                        <input type="number" step="0.1" value={Number.isNaN(config.maxAmplitude) ? '' : config.maxAmplitude} onChange={e => setConfig(p => ({...p, maxAmplitude: parseFloat(e.target.value)}))} className="w-full bg-slate-800 border border-amber-500/50 rounded text-center text-[10px] text-amber-400 outline-none py-1 font-bold shadow-[0_0_5px_rgba(245,158,11,0.2)]" />
                    </div>
                    <div className="space-y-1 relative group" title="K线实体占比：确保推升坚决，剔除影线过长震荡K线">
                        <div className="absolute -top-1 -right-1 text-[6px] bg-emerald-500 text-white px-0.5 rounded font-bold">BODY</div>
                        <label className="text-[8px] text-slate-400 block text-center font-medium">实体 &ge; (%)</label>
                        <input type="number" value={Number.isNaN(config.minBodyRatio) ? '' : config.minBodyRatio} onChange={e => setConfig(p => ({...p, minBodyRatio: parseFloat(e.target.value)}))} className="w-full bg-slate-800 border border-emerald-500/50 rounded text-center text-[10px] text-white outline-none py-1 font-bold shadow-[0_0_5px_rgba(16,185,129,0.2)]" />
                    </div>
                </div>
                {/* 第二排：周期点火放量 (VOLUME IGNITION) - 移植列表1动能精髓 */}
                <div className="grid grid-cols-3 gap-1">
                    <div className="space-y-1 relative group" title="点火放量考察窗口：考察最新K线及前N-1根K线内是否存在放量点火">
                        <div className="absolute -top-1 -right-1 text-[6px] bg-blue-500 text-white px-0.5 rounded font-bold">WIN</div>
                        <label className="text-[8px] text-slate-400 block text-center font-medium">考察K线(根)</label>
                        <input type="number" min="1" max="20" value={config.strictVolWindow ?? 3} onChange={e => setConfig(p => ({...p, strictVolWindow: Math.max(1, parseInt(e.target.value) || 1)}))} className="w-full bg-slate-800 border border-blue-500/50 rounded text-center text-[10px] text-blue-400 outline-none py-1 font-bold shadow-[0_0_5px_rgba(59,130,246,0.2)]" />
                    </div>
                    <div className="space-y-1 relative group" title="放量倍数：考察窗口内单根成交量相对于基准均量的放大倍数">
                        <div className="absolute -top-1 -right-1 text-[6px] bg-blue-500 text-white px-0.5 rounded font-bold">VOL</div>
                        <label className="text-[8px] text-slate-400 block text-center font-medium">放量倍数(x)</label>
                        <input type="number" step="0.1" value={Number.isNaN(config.volMultiplier) ? '' : config.volMultiplier} onChange={e => setConfig(p => ({...p, volMultiplier: parseFloat(e.target.value)}))} className="w-full bg-slate-800 border border-blue-500/50 rounded text-center text-[10px] text-white outline-none py-1 font-bold shadow-[0_0_5px_rgba(59,130,246,0.2)]" />
                    </div>
                    <div className="space-y-1 relative group" title="周期成交额门槛(USDT)：窗口内单根成交额必须达到该门槛，0为不限制">
                        <div className="absolute -top-1 -right-1 text-[6px] bg-purple-500 text-white px-0.5 rounded font-bold">USDT</div>
                        <label className="text-[8px] text-slate-400 block text-center font-medium">周期额&ge;(U)</label>
                        <input type="number" step="10000" value={config.strictMinQuoteVolume ?? 100000} onChange={e => setConfig(p => ({...p, strictMinQuoteVolume: Math.max(0, parseFloat(e.target.value) || 0)}))} className="w-full bg-slate-800 border border-purple-500/50 rounded text-center text-[10px] text-purple-300 outline-none py-1 font-bold shadow-[0_0_5px_rgba(168,85,247,0.2)]" />
                    </div>
                </div>

                {/* 🐉 龙抬头防伪双轨制：单根爆发 或 连续阶梯递增放量 */}
                <div className="mt-1.5 pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[9px]">
                    <div className="flex items-center gap-1.5" title="双轨放量机制：单根爆发放量 (≥VOL) 或 连续阶梯放量 (龙抬头) 均可激活放量点火">
                        <span className="text-amber-400 font-bold flex items-center gap-1">
                            <span>🐉</span> 龙抬头递增放量:
                        </span>
                        <div className="flex items-center gap-1 bg-slate-900 border border-slate-700/60 rounded px-1.5 py-0.5">
                            <span className="text-slate-400 text-[8px]">连续</span>
                            <input 
                                type="number" 
                                min="2" 
                                max="5" 
                                value={config.consecutiveVolBars ?? 2} 
                                onChange={e => setConfig(p => ({...p, consecutiveVolBars: Math.max(2, parseInt(e.target.value) || 2)}))} 
                                className="w-5 bg-slate-800 text-amber-300 text-center font-bold outline-none rounded text-[9px] py-0.2"
                            />
                            <span className="text-slate-400 text-[8px]">根递增(≥1.2x)</span>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setConfig(p => ({...p, enableConsecutiveVolRise: p.enableConsecutiveVolRise !== undefined ? !p.enableConsecutiveVolRise : false}))}
                        className={`px-2 py-0.5 rounded text-[8px] font-bold transition-all ${
                            (config.enableConsecutiveVolRise ?? true)
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-[0_0_6px_rgba(245,158,11,0.2)]'
                                : 'bg-slate-800 text-slate-500 border border-slate-700'
                        }`}
                        title={(config.enableConsecutiveVolRise ?? true) ? '已开启双轨制：单根爆发或连续递增均可触发' : '已关闭龙抬头：仅严格限制单根爆发'}
                    >
                        {(config.enableConsecutiveVolRise ?? true) ? '双轨开启' : '仅单根'}
                    </button>
                </div>
            </div>
        </div>
    );
};
