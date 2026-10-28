
// 🔒 LOCKED_MODULE: LIST 3 [结构深度审计 过滤器控制面板组件]
// @LOCKED: 严格原子化单独锁定。未经用户明确的专属书面指令，严禁擅自修改、重构或变动任何功能与代码。

import React, { useState } from 'react';
import { Clock, Zap, Rocket, ArrowUpDown, Activity, ChevronDown, ChevronUp } from 'lucide-react';
import { List3Config } from '../../../components/Scanner/scannerTypes';

interface List3PanelProps {
    config: List3Config;
    setConfig: React.Dispatch<React.SetStateAction<List3Config>>;
    countdowns: Record<string, string>; 
}

export const List3Control: React.FC<List3PanelProps> = ({ config, setConfig, countdowns }) => {
    const ALL_TFS = ['1m', '3m', '5m', '10m', '15m', '30m', '1h', '2h', '4h', '8h', '1d', '3d'];
    const toggleTf = (tf: string) => setConfig(prev => ({ ...prev, timeframes: prev.timeframes.includes(tf) ? prev.timeframes.filter(t => t !== tf) : [...prev.timeframes, tf] }));
    const isActive = config.timeframes.length > 0;
    const [isCollapsed, setIsCollapsed] = useState(() => localStorage.getItem('list3_control_collapsed') === 'true');

    const toggleCollapse = () => {
        setIsCollapsed(prev => {
            const next = !prev;
            localStorage.setItem('list3_control_collapsed', String(next));
            return next;
        });
    };
    
    return (
        <div className="p-3 bg-slate-900 border-b border-slate-800 space-y-2 shrink-0">
            <div className="flex items-center justify-between mb-1 cursor-pointer select-none" onClick={toggleCollapse}>
                <div className="font-bold text-slate-200 text-sm flex items-center gap-2">3. 结构审计 (Structure Audit)</div>
                <div className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300">
                    <span>{isCollapsed ? '展开设置' : '折叠设置'}</span>
                    {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                </div>
            </div>

            {!isCollapsed && (
                <>
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

                    {/* Compact Row: Same Color (同色交叉) */}
                    <div className="flex items-center justify-between bg-slate-800 rounded border border-slate-700 px-1.5 py-1 mb-1">
                        <div className="flex items-center gap-1.5">
                            <span className="text-[9px] text-slate-300 font-bold whitespace-nowrap">同色交叉</span>
                            {config.checkCandleColor && (
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setConfig(p => ({ ...p, checkCandleColorMode: p.checkCandleColorMode === 'STAR' ? 'FILTER' : 'STAR' })); }}
                                    className={`px-1.5 py-0.2 rounded text-[7px] font-bold transition-all ${
                                        (config.checkCandleColorMode || 'FILTER') === 'STAR'
                                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-[0_0_5px_rgba(245,158,11,0.2)]'
                                            : 'bg-red-950/60 text-red-300 border border-red-500/40'
                                    }`}
                                    title={(config.checkCandleColorMode || 'FILTER') === 'STAR' ? '当前模式: 仅打星标⭐不淘汰' : '当前模式: 强门禁不达标淘汰'}
                                >
                                    {(config.checkCandleColorMode || 'FILTER') === 'STAR' ? '⭐ 仅星标' : '🚫 强拦截'}
                                </button>
                            )}
                        </div>
                        <div onClick={() => setConfig(p => ({...p, checkCandleColor: !p.checkCandleColor}))} className={`w-6 h-3 rounded-full p-0.5 cursor-pointer transition-colors ${config.checkCandleColor ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                            <div className={`w-2 h-2 bg-white rounded-full transition-transform shadow-sm ${config.checkCandleColor ? 'translate-x-3' : ''}`} />
                        </div>
                    </div>

                    {/* Row: Strict Trend & Spacetime Resonance */}
                    <div className="grid grid-cols-2 gap-1 mb-1">
                        <div className={`flex items-center justify-between bg-slate-800/50 rounded border ${config.strictTrend ? 'border-emerald-500/50' : 'border-slate-700'} px-1.5 py-1`}>
                            <div className="flex items-center gap-1">
                                <span className="text-[9px] text-slate-300 font-bold whitespace-nowrap">严格趋势</span>
                                {config.strictTrend && (
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setConfig(p => ({ ...p, strictTrendMode: p.strictTrendMode === 'STAR' ? 'FILTER' : 'STAR' })); }}
                                        className={`px-1 py-0.2 rounded text-[7px] font-bold transition-all ${
                                            (config.strictTrendMode || 'FILTER') === 'STAR'
                                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-[0_0_5px_rgba(245,158,11,0.2)]'
                                                : 'bg-red-950/60 text-red-300 border border-red-500/40'
                                        }`}
                                        title={(config.strictTrendMode || 'FILTER') === 'STAR' ? '当前模式: 仅打星标⭐不淘汰' : '当前模式: 强门禁不达标淘汰'}
                                    >
                                        {(config.strictTrendMode || 'FILTER') === 'STAR' ? '⭐ 星标' : '🚫 强降'}
                                    </button>
                                )}
                            </div>
                            <div onClick={() => setConfig(p => ({...p, strictTrend: !p.strictTrend}))} className={`w-6 h-3 rounded-full p-0.5 cursor-pointer transition-colors ${config.strictTrend ? 'bg-emerald-600' : 'bg-slate-700'}`}>
                                <div className={`w-2 h-2 bg-white rounded-full transition-transform shadow-sm ${config.strictTrend ? 'translate-x-3' : ''}`} />
                            </div>
                        </div>

                        <div className={`flex items-center justify-between bg-slate-800/50 rounded border ${config.enableMultiResonance ? 'border-yellow-500/50' : 'border-slate-700'} px-1.5 py-1`}>
                            <div className="flex items-center gap-1">
                                <ArrowUpDown size={9} className="text-yellow-400 shrink-0" />
                                <span className="text-[9px] text-slate-300 font-bold whitespace-nowrap" title="信号K线小两级周期均线必须同时呈相对应发散形态">时空共振</span>
                                {config.enableMultiResonance && (
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setConfig(p => ({ ...p, multiResonanceMode: p.multiResonanceMode === 'STAR' ? 'FILTER' : 'STAR' })); }}
                                        className={`px-1 py-0.2 rounded text-[7px] font-bold transition-all ${
                                            (config.multiResonanceMode || 'FILTER') === 'STAR'
                                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-[0_0_5px_rgba(245,158,11,0.2)]'
                                                : 'bg-red-950/60 text-red-300 border border-red-500/40'
                                        }`}
                                        title={(config.multiResonanceMode || 'FILTER') === 'STAR' ? '当前模式: 仅打星标⭐不淘汰' : '当前模式: 强门禁不达标淘汰'}
                                    >
                                        {(config.multiResonanceMode || 'FILTER') === 'STAR' ? '⭐ 星标' : '🚫 强降'}
                                    </button>
                                )}
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
                            <div onClick={() => setConfig(p => ({...p, enableRsi: !p.enableRsi}))} className={`w-6 h-3 rounded-full p-0.5 cursor-pointer transition-colors ${config.enableRsi ? 'bg-pink-600' : 'bg-slate-700'}`}>
                                <div className={`w-2 h-2 bg-white rounded-full transition-transform shadow-sm ${config.enableRsi ? 'translate-x-3' : ''}`} />
                            </div>
                        </div>
                        
                        <div className={`grid grid-cols-2 gap-2 transition-opacity ${config.enableRsi ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
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

                    {/* 3. 高级过滤 (EMA80 震荡结构审计) */}
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5">
                                <div className="text-[9px] text-purple-300 font-bold flex items-center gap-1 uppercase" title="根据EMA80相交次数与回溯周期根数，过滤频繁相交的死水震荡币，保留强趋势/长期回调后初次启动币">
                                    <Activity size={10} className="text-purple-400"/>
                                    3. 高级过滤 (EMA80)
                                </div>
                                {config.enableAdvancedFilter && (
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setConfig(p => ({ ...p, advancedFilterMode: p.advancedFilterMode === 'STAR' ? 'FILTER' : 'STAR' })); }}
                                        className={`px-1.5 py-0.2 rounded text-[7px] font-bold transition-all ${
                                            (config.advancedFilterMode || 'FILTER') === 'STAR'
                                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-[0_0_5px_rgba(245,158,11,0.2)]'
                                                : 'bg-red-950/60 text-red-300 border border-red-500/40'
                                        }`}
                                        title={(config.advancedFilterMode || 'FILTER') === 'STAR' ? '当前模式: 仅打星标⭐不淘汰' : '当前模式: 强门禁不达标淘汰'}
                                    >
                                        {(config.advancedFilterMode || 'FILTER') === 'STAR' ? '⭐ 仅星标' : '🚫 强拦截'}
                                    </button>
                                )}
                            </div>
                            <div onClick={() => setConfig(p => ({...p, enableAdvancedFilter: !p.enableAdvancedFilter}))} className={`w-7 h-3.5 rounded-full p-0.5 cursor-pointer transition-colors ${config.enableAdvancedFilter ? 'bg-purple-600' : 'bg-slate-700'}`}>
                                <div className={`w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${config.enableAdvancedFilter ? 'translate-x-3.5' : ''}`} />
                            </div>
                        </div>

                        <div className={`space-y-1 transition-opacity ${config.enableAdvancedFilter ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                            <div className="grid grid-cols-2 gap-1">
                                <button
                                    onClick={() => setConfig(p => ({...p, filterPeriodMode: 'AUTO_LIST2'}))}
                                    className={`text-[8px] py-1 px-1 rounded border font-bold transition-all ${config.filterPeriodMode !== 'CUSTOM' ? 'bg-purple-900/60 border-purple-500 text-purple-200' : 'bg-slate-800 border-slate-700 text-slate-500'}`}
                                >
                                    跟随列表2周期
                                </button>
                                <button
                                    onClick={() => setConfig(p => ({...p, filterPeriodMode: 'CUSTOM'}))}
                                    className={`text-[8px] py-1 px-1 rounded border font-bold transition-all ${config.filterPeriodMode === 'CUSTOM' ? 'bg-purple-900/60 border-purple-500 text-purple-200' : 'bg-slate-800 border-slate-700 text-slate-500'}`}
                                >
                                    固定周期 ({config.filterKLinePeriod || '1h'})
                                </button>
                            </div>

                            {config.filterPeriodMode === 'CUSTOM' && (
                                <div className="grid grid-cols-4 gap-1">
                                    {(['15m', '1h', '4h', '1d'] as const).map(p => (
                                        <button
                                            key={p}
                                            onClick={() => setConfig(prev => ({...prev, filterKLinePeriod: p}))}
                                            className={`text-[8px] py-0.5 rounded border font-bold ${config.filterKLinePeriod === p ? 'bg-purple-600 text-white border-purple-400' : 'bg-slate-800 border-slate-700 text-slate-400'}`}
                                        >
                                            {p}
                                        </button>
                                    ))}
                                </div>
                            )}

                            <div className="grid grid-cols-3 gap-1">
                                <div className="bg-slate-800/80 rounded border border-slate-700 px-1.5 py-1 flex items-center justify-between">
                                    <span className="text-[9px] text-slate-500">EMA</span>
                                    <input type="number" value={config.filterEmaPeriod ?? 80} onChange={(e) => setConfig(p => ({...p, filterEmaPeriod: parseFloat(e.target.value)}))} className="w-8 bg-transparent text-right text-[10px] font-bold text-purple-300 outline-none"/>
                                </div>
                                <div className="bg-slate-800/80 rounded border border-slate-700 px-1.5 py-1 flex items-center justify-between">
                                    <span className="text-[9px] text-slate-500">回溯</span>
                                    <input type="number" value={config.filterTimeParam ?? 100} onChange={(e) => setConfig(p => ({...p, filterTimeParam: parseFloat(e.target.value)}))} className="w-8 bg-transparent text-right text-[10px] font-bold text-white outline-none"/>
                                </div>
                                <div className="bg-slate-800/80 rounded border border-slate-700 px-1.5 py-1 flex items-center justify-between">
                                    <span className="text-[9px] text-slate-500">相交上限</span>
                                    <input type="number" value={config.filterCrossingCount ?? 2} onChange={(e) => setConfig(p => ({...p, filterCrossingCount: parseFloat(e.target.value)}))} className="w-8 bg-transparent text-right text-[10px] font-bold text-orange-400 outline-none"/>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 4. 前置洗盘V反发散 (倒钩/洗盘起爆) */}
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5">
                                <div className="text-[9px] text-purple-300 font-bold flex items-center gap-1 uppercase" title="开启后检测发散起爆前N根K线内是否存在反向发散形态">
                                    <Zap size={10} className="text-purple-400 shrink-0"/>
                                    4. 前置洗盘V反发散
                                </div>
                                {config.enablePriorReverseDivergence && (
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setConfig(p => ({ ...p, priorReverseMode: p.priorReverseMode === 'STAR' ? 'FILTER' : 'STAR' })); }}
                                        className={`px-1.5 py-0.2 rounded text-[7px] font-bold transition-all ${
                                            (config.priorReverseMode || 'FILTER') === 'STAR'
                                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-[0_0_5px_rgba(245,158,11,0.2)]'
                                                : 'bg-red-950/60 text-red-300 border border-red-500/40'
                                        }`}
                                        title={(config.priorReverseMode || 'FILTER') === 'STAR' ? '当前模式: 仅打星标⭐不淘汰' : '当前模式: 强门禁不达标淘汰'}
                                    >
                                        {(config.priorReverseMode || 'FILTER') === 'STAR' ? '⭐ 仅星标' : '🚫 强拦截'}
                                    </button>
                                )}
                            </div>
                            <div onClick={() => setConfig(p => ({...p, enablePriorReverseDivergence: !p.enablePriorReverseDivergence}))} className={`w-7 h-3.5 rounded-full p-0.5 cursor-pointer transition-colors ${config.enablePriorReverseDivergence ? 'bg-purple-600' : 'bg-slate-700'}`}>
                                <div className={`w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${config.enablePriorReverseDivergence ? 'translate-x-3.5' : ''}`} />
                            </div>
                        </div>

                        <div className={`space-y-1 transition-opacity ${config.enablePriorReverseDivergence ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                            <div className="bg-slate-800/80 rounded border border-slate-700 px-2 py-1 flex items-center justify-between">
                                <span className="text-[9px] text-slate-400 font-bold whitespace-nowrap">追溯历史检测范围</span>
                                <div className="flex items-center gap-1">
                                    <input 
                                        type="number" 
                                        min={1}
                                        max={100}
                                        value={Number.isNaN(config.priorReverseLookbackBars) ? '' : (config.priorReverseLookbackBars ?? 20)} 
                                        onChange={(e) => { e.stopPropagation(); setConfig(p => ({...p, priorReverseLookbackBars: parseInt(e.target.value) || 1})); }} 
                                        className="w-10 bg-slate-900/90 text-center text-[10px] font-bold text-purple-300 outline-none py-0.5 px-1 rounded border border-purple-500/40 focus:border-purple-400 font-mono" 
                                    />
                                    <span className="text-[9px] text-slate-400 font-bold">根 K线</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
