
import React, { useState } from 'react';
import { Activity, History, ChevronDown, ChevronUp, Maximize2, Layers, Search, Eye, TrendingUp, GitMerge } from 'lucide-react';
import { List2Config, ScanConfig } from '../../../components/Scanner/scannerTypes';
import { TimeframeSelector } from './TimeframeSelector';
import { ConfigSection } from './ConfigSection';
import { ScannerHistoryModal } from '../../momentum-audit/components/ScannerHistoryModal';
import { TimeframeDiagnosticsModal } from './TimeframeDiagnosticsModal';
import { TimeframeDiagnosticRecord } from '../types';

interface List2PanelProps {
    config: List2Config;
    setConfig: React.Dispatch<React.SetStateAction<List2Config>>;
    scanConfig: ScanConfig;
    setScanConfig: React.Dispatch<React.SetStateAction<ScanConfig>>;
    countdowns: Record<string, string>; 
    tfCounts: Record<string, number>; 
    activeFilterTf: string | null;
    isLocked: boolean;
    onTfInteraction: (tf: string, type: 'SINGLE' | 'LONG_2' | 'LONG_3' | 'RESET') => void;
    activeScanTfs?: Set<string>;
    scanningSymbols?: Record<string, string>;
    pollingStatus?: string;
    diagnostics?: Record<string, TimeframeDiagnosticRecord>;
    totalScanCount?: number;
    list2Items?: any[];
    setChartData?: (data: any) => void;
}

export const List2Control: React.FC<List2PanelProps> = ({ config, setConfig, scanConfig, setScanConfig, countdowns, tfCounts, activeFilterTf, isLocked, onTfInteraction, activeScanTfs, scanningSymbols, pollingStatus, diagnostics = {}, totalScanCount = 0, list2Items = [], setChartData }) => {
    const [showHistory, setShowHistory] = useState(false);
    const [showDiagnosticsModal, setShowDiagnosticsModal] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(() => localStorage.getItem('list2_control_collapsed') === 'true');

    const toggleCollapse = () => {
        setIsCollapsed(prev => {
            const next = !prev;
            localStorage.setItem('list2_control_collapsed', String(next));
            return next;
        });
    };

    const handleSelectSymbol = (sym: string, tf?: string) => {
        if (setChartData) {
            setChartData({
                symbol: sym,
                tf: tf || activeFilterTf || config.timeframes[0] || '5m',
                list2Config: config,
                showAuditLines: false
            });
        }
    };
    
    return (
        <div className="p-3 bg-slate-900 border-b border-slate-800 shrink-0 flex flex-col">
            {/* Row 1: Title & Start/Stop Switch */}
            <div className="flex items-center justify-between select-none pb-1.5">
                <div className="flex items-center gap-3">
                    <div className="font-bold text-blue-400 text-sm flex items-center gap-2 cursor-pointer" onClick={toggleCollapse}>
                        <Activity size={14} className="text-blue-500" /> 
                        <span>2. 均线穿越</span>
                    </div>

                    {/* 🔒 [列表2 运行/停止 控制开关] */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setConfig(p => ({ ...p, isStopped: !p.isStopped }));
                        }}
                        className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-bold transition-all shadow-sm ${
                            config.isStopped
                                ? 'bg-red-950/90 hover:bg-red-900 text-red-300 border border-red-700/80'
                                : 'bg-emerald-950/90 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/80'
                        }`}
                        title={config.isStopped ? "点击启动列表2均线穿越扫描" : "点击停止列表2均线穿越扫描"}
                    >
                        <span className={`w-2 h-2 rounded-full ${config.isStopped ? 'bg-red-500' : 'bg-emerald-400 animate-pulse'}`} />
                        <span>{config.isStopped ? '停止 (点击启动)' : '运行中 (点击停止)'}</span>
                    </button>
                </div>
                <div className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 cursor-pointer" onClick={toggleCollapse}>
                    <span>{isCollapsed ? '展开设置' : '折叠设置'}</span>
                    {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                </div>
            </div>
            
            {/* Expandable Scrollable Settings Area */}
            {!isCollapsed && (
                <div className="mt-2 space-y-3 max-h-[380px] 2xl:max-h-[480px] overflow-y-auto pr-1.5 custom-scrollbar border-t border-slate-800/60 pt-2.5">
                    {/* 🎯 筛选模式选择面板 (移至最顶端) */}
                    <div className="space-y-2 bg-slate-950/60 p-2 rounded border border-slate-800">
                        <div className="flex items-center justify-between pb-1 border-b border-slate-800/60 mb-1">
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                                <span>🎯 筛选模式选择</span>
                            </span>
                            {/* Long / Short / All Selector */}
                            <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded border border-slate-800">
                                <button
                                    onClick={() => setConfig(p => ({ ...p, viewMode: 'ALL' }))}
                                    className={`px-2 py-0.5 rounded text-[9px] font-bold transition-all ${(!config.viewMode || config.viewMode === 'ALL') ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                >
                                    全部
                                </button>
                                <button
                                    onClick={() => setConfig(p => ({ ...p, viewMode: 'LONG' }))}
                                    className={`px-2 py-0.5 rounded text-[9px] font-bold transition-all ${config.viewMode === 'LONG' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-emerald-400'}`}
                                >
                                    多
                                </button>
                                <button
                                    onClick={() => setConfig(p => ({ ...p, viewMode: 'SHORT' }))}
                                    className={`px-2 py-0.5 rounded text-[9px] font-bold transition-all ${config.viewMode === 'SHORT' ? 'bg-red-600 text-white shadow' : 'text-slate-400 hover:text-red-400'}`}
                                >
                                    空
                                </button>
                            </div>
                        </div>

                        {/* 3大主筛选条件: K线穿越, 均线穿越, 均线发散 */}
                        <div className="grid grid-cols-3 gap-1.5">
                            {/* 1. K线穿越 */}
                            <div className="flex flex-col justify-between bg-slate-800/50 p-2 rounded border border-slate-700/50">
                                <div className="flex items-center justify-between">
                                    <div className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                                        <TrendingUp size={10}/> K线穿越
                                    </div>
                                    <div onClick={() => setConfig(p => {
                                        const next = p.requireCandleCross !== undefined ? !p.requireCandleCross : !p.requireCrossing;
                                        return {...p, requireCandleCross: next, requireCrossing: next};
                                    })} className={`w-7 h-3.5 rounded-full p-0.5 cursor-pointer transition-colors ${(config.requireCandleCross ?? config.requireCrossing) ? 'bg-emerald-600' : 'bg-slate-700'}`}>
                                        <div className={`w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${(config.requireCandleCross ?? config.requireCrossing) ? 'translate-x-3.5' : ''}`} />
                                    </div>
                                </div>
                                <div className="text-[7px] text-slate-500 italic mt-1 leading-none">实体/影线穿EMA簇</div>
                            </div>

                            {/* 2. 均线穿越 */}
                            <div className="flex flex-col justify-between bg-slate-800/50 p-2 rounded border border-slate-700/50">
                                <div className="flex items-center justify-between">
                                    <div className="text-[10px] text-purple-400 font-bold flex items-center gap-1">
                                        <GitMerge size={10}/> 均线穿越
                                    </div>
                                    <div onClick={() => setConfig(p => ({...p, requireMaCross: !p.requireMaCross}))} className={`w-7 h-3.5 rounded-full p-0.5 cursor-pointer transition-colors ${config.requireMaCross ? 'bg-purple-600' : 'bg-slate-700'}`}>
                                        <div className={`w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${config.requireMaCross ? 'translate-x-3.5' : ''}`} />
                                    </div>
                                </div>
                                <div className="text-[7px] text-slate-500 italic mt-1 leading-none">EMA10穿20-30-40</div>
                            </div>

                            {/* 3. 均线发散 */}
                            <div className="flex flex-col justify-between bg-slate-800/50 p-2 rounded border border-slate-700/50">
                                <div className="flex items-center justify-between">
                                    <div className="text-[10px] text-cyan-400 font-bold flex items-center gap-1">
                                        <TrendingUp size={10}/> 均线发散
                                    </div>
                                    <div onClick={() => setConfig(p => ({...p, requireAlignment: !p.requireAlignment}))} className={`w-7 h-3.5 rounded-full p-0.5 cursor-pointer transition-colors ${config.requireAlignment ? 'bg-cyan-600' : 'bg-slate-700'}`}>
                                        <div className={`w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${config.requireAlignment ? 'translate-x-3.5' : ''}`} />
                                    </div>
                                </div>
                                <div className="text-[7px] text-slate-500 italic mt-1 leading-none">10-20-30-40顺向发散</div>
                            </div>
                        </div>

                        {/* 子开关面板: 仅限首次穿越 & 发散回溯穿越 */}
                        <div className="grid grid-cols-2 gap-1.5">
                            {/* 【均线穿越】子开关：仅限首次穿越 & 穿越回溯K线根数 */}
                            <div className={`p-1.5 rounded border transition-all ${config.requireMaCross ? 'bg-purple-950/30 border-purple-800/40' : 'bg-slate-800/30 border-slate-800 opacity-60'}`}>
                                <div className="flex items-center justify-between">
                                    <span className="text-[9px] text-purple-300 font-bold whitespace-nowrap flex items-center gap-1">
                                        <span>🎯 仅限首次穿越</span>
                                    </span>
                                    <div 
                                        onClick={() => {
                                            if (!config.requireMaCross) return;
                                            setConfig(p => ({...p, requireFirstMaCrossOnly: !p.requireFirstMaCrossOnly}));
                                        }} 
                                        className={`w-6 h-3 rounded-full p-0.5 transition-colors shrink-0 ${config.requireMaCross ? 'cursor-pointer' : 'cursor-not-allowed'} ${(config.requireFirstMaCrossOnly && config.requireMaCross) ? 'bg-purple-600' : 'bg-slate-700'}`}
                                        title="开启后过滤震荡市重复交叉，仅抓EMA10初次穿越EMA20/30/40第一根"
                                    >
                                        <div className={`w-2 h-2 bg-white rounded-full shadow transition-transform ${(config.requireFirstMaCrossOnly && config.requireMaCross) ? 'translate-x-3' : ''}`} />
                                    </div>
                                </div>
                                {config.requireMaCross && (
                                    <div className="flex items-center justify-between mt-1 pt-1 border-t border-purple-800/30 animate-in fade-in slide-in-from-top-1">
                                        <span className="text-[8px] text-purple-200/80 font-bold whitespace-nowrap">回溯K线根数</span>
                                        <div className="flex items-center gap-1">
                                            <input 
                                                type="number" 
                                                min={1}
                                                max={100}
                                                value={Number.isNaN(config.maCrossLookbackBars) ? '' : (config.maCrossLookbackBars ?? 15)} 
                                                onChange={(e) => { 
                                                    e.stopPropagation(); 
                                                    const val = parseInt(e.target.value) || 1;
                                                    setConfig(p => ({...p, maCrossLookbackBars: val})); 
                                                }} 
                                                className="w-12 bg-slate-900/90 text-center text-[10px] font-bold text-purple-300 outline-none px-1 py-0.5 rounded border border-purple-500/40 focus:border-purple-400 font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
                                            />
                                            <span className="text-[8px] text-slate-400 font-bold whitespace-nowrap">根</span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* 【均线发散】子开关：发散回溯穿越 */}
                            <div className={`p-1.5 rounded border transition-all ${config.requireAlignment ? 'bg-cyan-950/30 border-cyan-800/40' : 'bg-slate-800/30 border-slate-800 opacity-60'}`}>
                                <div className="flex items-center justify-between">
                                    <span className="text-[9px] text-cyan-300 font-bold whitespace-nowrap flex items-center gap-1">
                                        <span>🔍 发散回溯穿越</span>
                                    </span>
                                    <div 
                                        onClick={() => {
                                            if (!config.requireAlignment) return;
                                            setConfig(p => ({...p, enableDivergenceCrossCheck: !p.enableDivergenceCrossCheck}));
                                        }} 
                                        className={`w-6 h-3 rounded-full p-0.5 transition-colors shrink-0 ${config.requireAlignment ? 'cursor-pointer' : 'cursor-not-allowed'} ${((config.enableDivergenceCrossCheck ?? true) && config.requireAlignment) ? 'bg-cyan-600' : 'bg-slate-700'}`}
                                        title="开启后发散前置需在过去N根K线内EMA10穿越过EMA20/30/40"
                                    >
                                        <div className={`w-2 h-2 bg-white rounded-full shadow transition-transform ${((config.enableDivergenceCrossCheck ?? true) && config.requireAlignment) ? 'translate-x-3' : ''}`} />
                                    </div>
                                </div>
                                {((config.enableDivergenceCrossCheck ?? true) && config.requireAlignment) && (
                                    <div className="flex items-center justify-between mt-1 pt-1 border-t border-cyan-800/30 animate-in fade-in slide-in-from-top-1">
                                        <span className="text-[8px] text-cyan-200/80 font-bold whitespace-nowrap">回溯K线根数</span>
                                        <div className="flex items-center gap-1">
                                            <input 
                                                type="number" 
                                                min={1}
                                                max={100}
                                                value={Number.isNaN(config.divergenceLookbackBars ?? config.divergenceCrossLookback) ? '' : (config.divergenceLookbackBars ?? config.divergenceCrossLookback ?? 20)} 
                                                onChange={(e) => { 
                                                    e.stopPropagation(); 
                                                    const val = parseInt(e.target.value) || 1;
                                                    setConfig(p => ({...p, divergenceLookbackBars: val, divergenceCrossLookback: val})); 
                                                }} 
                                                className="w-12 bg-slate-900/90 text-center text-[10px] font-bold text-cyan-300 outline-none px-1 py-0.5 rounded border border-cyan-500/40 focus:border-cyan-400 font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
                                            />
                                            <span className="text-[8px] text-slate-400 font-bold whitespace-nowrap">根</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* AND / OR / WAIT Logic Selector */}
                        <div className="flex flex-col gap-1.5 bg-slate-800/50 p-2 rounded border border-slate-700/50">
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-slate-300 font-bold">条件组合关系 (Logic)</span>
                                <div className="flex bg-slate-900 rounded p-0.5 border border-slate-700 items-center">
                                    <button 
                                        onClick={() => setConfig(p => ({...p, crossingDivergenceLogic: 'AND'}))}
                                        className={`px-2 py-0.5 text-[9px] font-bold rounded transition-all ${(config.crossingDivergenceLogic || 'AND') === 'AND' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                                    >
                                        且 (AND)
                                    </button>
                                    <button 
                                        onClick={() => setConfig(p => ({...p, crossingDivergenceLogic: 'OR'}))}
                                        className={`px-2 py-0.5 text-[9px] font-bold rounded transition-all ${(config.crossingDivergenceLogic || 'AND') === 'OR' ? 'bg-amber-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                                    >
                                        或 (OR)
                                    </button>
                                    <button 
                                        onClick={() => setConfig(p => ({...p, crossingDivergenceLogic: 'WAIT'}))}
                                        className={`px-2 py-0.5 text-[9px] font-bold rounded transition-all ${(config.crossingDivergenceLogic || 'AND') === 'WAIT' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
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
                                            className="w-12 bg-slate-900/90 text-center text-[10px] font-bold text-indigo-300 outline-none px-1 py-0.5 rounded border border-indigo-500/50 focus:border-indigo-400 font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
                                        />
                                        <span className="text-[9px] text-slate-400 font-bold whitespace-nowrap">根</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Timeframe Grid */}
                    <TimeframeSelector 
                        timeframes={config.timeframes}
                        countdowns={countdowns}
                        tfCounts={tfCounts}
                        activeFilterTf={activeFilterTf}
                        isLocked={isLocked}
                        onTfInteraction={onTfInteraction}
                        activeScanTfs={activeScanTfs}
                        scanningSymbols={scanningSymbols}
                        pollingStatus={pollingStatus}
                        totalScanCount={totalScanCount}
                        diagnostics={diagnostics}
                        list2Items={list2Items}
                        setChartData={setChartData}
                        config={config}
                    />

                    {/* 🔍 放大图与周期数据透视看板按钮 (位于周期列表下方) */}
                    <div className="pt-0.5">
                        <button
                            onClick={() => setShowDiagnosticsModal(true)}
                            className="w-full flex items-center justify-between px-2.5 py-1.5 bg-gradient-to-r from-blue-950/90 via-indigo-950/80 to-slate-900 border border-blue-500/40 hover:border-blue-400 text-blue-200 rounded-md transition-all shadow-sm group hover:shadow-[0_0_12px_rgba(59,130,246,0.25)] text-[10px] font-bold"
                            title="打开每个周期的K线获取情况、EMA具体数值与未入榜原因诊断透视看板"
                        >
                            <div className="flex items-center gap-1.5">
                                <Maximize2 size={12} className="text-blue-400 group-hover:scale-110 transition-transform" />
                                <span>🔍 打开各周期获取与实际数据看板 (放大图)</span>
                            </div>
                            <div className="flex items-center gap-1 text-[9px] text-blue-300 font-mono">
                                <span>点击透视</span>
                                <span className="text-xs">»</span>
                            </div>
                        </button>
                    </div>

                    <ConfigSection config={config} setConfig={setConfig} />
                </div>
            )}

            {/* Timeframe Diagnostics Modal */}
            <TimeframeDiagnosticsModal 
                isOpen={showDiagnosticsModal}
                onClose={() => setShowDiagnosticsModal(false)}
                diagnostics={diagnostics}
                activeTimeframes={config.timeframes}
                countdowns={countdowns}
                scanningSymbols={scanningSymbols}
                onSelectSymbol={handleSelectSymbol}
            />
        </div>
    );
};
