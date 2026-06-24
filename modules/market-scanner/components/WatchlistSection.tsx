
import React, { useState, useMemo } from 'react';
import { ScanConfig } from '../../../components/Scanner/scannerTypes';
import { Globe, Lock, List, PlusCircle, Target, Trash2, RotateCcw, History, Play, Square, Download, Clock, Loader2, Sparkles, Brain, Zap, Megaphone, Activity, Power } from 'lucide-react';
import { processMarketData } from '../../../services/rules/list1_market';

interface Props {
    scanConfig: ScanConfig;
    setScanConfig: React.Dispatch<React.SetStateAction<ScanConfig>>;
    fixedModeView: 'MONITOR' | 'SEARCH';
    setFixedModeView: (v: 'MONITOR' | 'SEARCH') => void;
    onClearWatchlist?: () => void;
    onClearBlacklist?: () => void;
    // New Props for Backtest Mode
    scannerMode?: 'LIVE' | 'BACKTEST' | 'SMART';
    setScannerMode?: (mode: 'LIVE' | 'BACKTEST' | 'SMART') => void;
    backtestProps?: {
        speed: number;
        setSpeed: (s: number) => void;
        intervals: string[];
        setIntervals: (tf: string[]) => void;
        isPlaying: boolean;
        onStart: () => void;
        onStop: () => void;
        downloadRange: { start: string, end: string };
        setDownloadRange: (range: { start: string, end: string }) => void;
        onDownload: () => void;
        isDownloading: boolean;
        syncProgress: { current: number, total: number, percent: number } | null;
        virtualTime: number;
        customSymbols: string;
        setCustomSymbols: (s: string) => void;
        useCustomOnly: boolean;
        setUseCustomOnly: (v: boolean) => void;
    };
}

export const WatchlistSection: React.FC<Props> = ({ 
    scanConfig, setScanConfig, fixedModeView, setFixedModeView, onClearWatchlist, onClearBlacklist,
    scannerMode = 'LIVE', setScannerMode, backtestProps
}) => {
    const [manualInput, setManualInput] = useState('');

    const autoCandidates = useMemo(() => {
        try {
            const raw = localStorage.getItem('SCANNER_RAW_DATA_CACHE');
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            const { list1: filtered } = processMarketData(
                parsed,
                { ...scanConfig, useCustomOnly: false },
                new Set(),
                'MONITOR'
            );
            return filtered;
        } catch (e) {
            return [];
        }
    }, [scanConfig]);

    const handleSelectDropdown = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value;
        if (!val) return;
        
        if (val === '__ADD_ALL__') {
            const current = scanConfig.customSymbols.split(',').map(s => s.trim()).filter(Boolean);
            const set = new Set(current);
            autoCandidates.forEach(item => {
                set.add(item.symbol.replace('USDT', ''));
            });
            setScanConfig(p => ({ ...p, customSymbols: Array.from(set).join(', ') }));
        } else {
            const current = scanConfig.customSymbols.split(',').map(s => s.trim()).filter(Boolean);
            const set = new Set(current);
            const cleanVal = val.replace('USDT', '');
            if (set.has(cleanVal)) {
                set.delete(cleanVal);
            } else {
                set.add(cleanVal);
            }
            setScanConfig(p => ({ ...p, customSymbols: Array.from(set).join(', ') }));
        }
        
        // Reset dropdown choice
        e.target.value = '';
    };

    const handleAddSymbol = () => { 
        if (!manualInput) return; 
        const inputs = manualInput.toUpperCase().split(/[\s,]+/).filter(s => s); 
        
        if (scannerMode === 'BACKTEST' && backtestProps) {
            const current = backtestProps.customSymbols.split(',').map(s => s.trim()).filter(s => s);
            const set = new Set(current);
            inputs.forEach(val => {
                const cleanVal = val.replace('USDT', '');
                if (cleanVal) set.add(cleanVal);
            });
            backtestProps.setCustomSymbols(Array.from(set).join(', '));
            setManualInput('');
            return;
        }

        const current = scanConfig.customSymbols.split(',').map(s => s.trim()).filter(s => s); 
        const set = new Set(current); 
        inputs.forEach(val => { 
            const cleanVal = val.replace('USDT', ''); 
            if (cleanVal) set.add(cleanVal); 
        }); 
        setScanConfig(p => ({ ...p, customSymbols: Array.from(set).join(', ') })); 
        setManualInput(''); 
    };

    return (
        <div className="space-y-3">
            {/* Mode Switch - Now 4-Way */}
            <div className="flex bg-slate-800 p-1 rounded border border-slate-700 overflow-x-auto custom-scrollbar no-scrollbar items-center gap-1">
                <button 
                    onClick={() => {
                        setScannerMode?.('LIVE');
                        setScanConfig(p => ({...p, useCustomOnly: false}));
                    }} 
                    className={`flex-1 min-w-[60px] py-2 text-[10px] font-bold rounded transition-all flex items-center justify-center gap-1.5 ${scannerMode === 'LIVE' && !scanConfig.useCustomOnly ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    <Globe size={11} /> 自动选币
                </button>
                <div className="flex-1 min-w-[120px] flex gap-1 items-center">
                    <button 
                        onClick={() => { 
                            setScannerMode?.('LIVE');
                            setScanConfig(p => ({...p, useCustomOnly: true})); 
                            setFixedModeView('MONITOR'); 
                        }} 
                        className={`flex-grow py-1.5 text-[10px] font-bold rounded transition-all flex items-center justify-center gap-1.5 ${scannerMode === 'LIVE' && scanConfig.useCustomOnly ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                        <Lock size={11} /> 固定选币
                    </button>
                    {scannerMode === 'LIVE' && scanConfig.useCustomOnly && (
                        <select 
                            onChange={handleSelectDropdown}
                            defaultValue=""
                            className="bg-slate-900 border border-cyan-500/30 text-[9px] text-cyan-400 font-bold rounded px-1 py-0.5 outline-none focus:border-cyan-400 transition-all cursor-pointer h-6 max-w-[80px]"
                            title="选择初筛币种"
                        >
                            <option value="" disabled>🔍 备选({autoCandidates.length})</option>
                            <option value="__ADD_ALL__">➕ 一键导入全部</option>
                            {autoCandidates.map(item => {
                                const rawSym = item.symbol.replace('USDT', '');
                                const isAdded = scanConfig.customSymbols.split(',').map(s => s.trim()).filter(Boolean).includes(rawSym);
                                return (
                                    <option key={item.symbol} value={rawSym}>
                                        {isAdded ? '✅ ' : '➕ '}{rawSym} ({item.change > 0 ? '+' : ''}{item.change.toFixed(1)}%)
                                    </option>
                                );
                            })}
                        </select>
                    )}
                </div>
                <button 
                    onClick={() => setScannerMode?.('SMART')} 
                    className={`flex-1 min-w-[60px] py-1.5 text-[10px] font-bold rounded transition-all flex items-center justify-center gap-1.5 ${scannerMode === 'SMART' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    <Sparkles size={11} /> 智能选币
                </button>
                <button 
                    onClick={() => setScannerMode?.('BACKTEST')} 
                    className={`flex-1 min-w-[60px] py-1.5 text-[10px] font-bold rounded transition-all flex items-center justify-center gap-1.5 ${scannerMode === 'BACKTEST' ? 'bg-amber-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    <History size={11} /> 回测模式
                </button>
            </div>

            {/* Smart Selection Settings - Shown when in SMART mode */}
            {scannerMode === 'SMART' && (
                <div className="bg-purple-950/20 border border-purple-500/20 rounded p-2.5 space-y-2.5 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                            <span className="text-[10px] text-purple-400 font-bold uppercase flex items-center gap-1">
                                <Brain size={12}/> 超人类大脑选币系统
                            </span>
                            <span className="text-[8px] text-slate-500 font-mono">NEURAL NETWORK ACTIVE</span>
                        </div>
                        <div className="flex items-center gap-2">
                            {scanConfig.smartMode?.isActive && <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />}
                            <button 
                                onClick={() => {
                                    setScanConfig(p => ({
                                        ...p,
                                        smartMode: { 
                                            ...(p.smartMode || { enabled: true, isActive: false, minHeat: 60, minPotential: 10, sentimentSource: ['AI', 'COMMUNITY'], enableWhaleTracking: true, enableOnChainAnalysis: true, alertSensitivity: 'MEDIUM' }),
                                            isActive: !p.smartMode?.isActive
                                        }
                                    }));
                                }}
                                className={`px-3 py-1 rounded text-[10px] font-black transition-all border flex items-center gap-1.5 ${scanConfig.smartMode?.isActive ? 'bg-emerald-600 border-emerald-400 text-white shadow-[0_0_15px_rgba(5,150,105,0.3)]' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}
                            >
                                {scanConfig.smartMode?.isActive ? <><Activity size={12} className="animate-spin-slow" /> 已启动</> : <><Power size={12} /> 未启动</>}
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pb-1 border-b border-purple-500/10">
                        {/* Discussion Heat */}
                        <div className="space-y-1">
                            <div className="flex justify-between text-[9px] text-slate-400 uppercase font-bold">
                                <span>讨论热度</span>
                                <span className="text-purple-400">{scanConfig.smartMode?.minHeat || 60}%+</span>
                            </div>
                            <input 
                                type="range" min="0" max="100" step="5"
                                value={scanConfig.smartMode?.minHeat || 60}
                                onChange={e => {
                                    const val = Number(e.target.value);
                                    setScanConfig(p => ({
                                        ...p, 
                                        smartMode: { ...(p.smartMode || { enabled: true, isActive: false, minHeat: 60, minPotential: 10, sentimentSource: ['AI', 'COMMUNITY'], enableWhaleTracking: true, enableOnChainAnalysis: true, alertSensitivity: 'MEDIUM' }), minHeat: val }
                                    }));
                                }}
                                className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                            />
                        </div>

                        {/* Potential Multiplier */}
                        <div className="space-y-1">
                            <div className="flex justify-between text-[9px] text-slate-400 uppercase font-bold">
                                <span>爆发潜力</span>
                                <span className="text-emerald-400">{scanConfig.smartMode?.minPotential || 10}x</span>
                            </div>
                            <select 
                                value={scanConfig.smartMode?.minPotential || 10}
                                onChange={e => {
                                    const val = Number(e.target.value);
                                    setScanConfig(p => ({
                                        ...p, 
                                        smartMode: { ...(p.smartMode || { enabled: true, isActive: false, minHeat: 60, minPotential: 10, sentimentSource: ['AI', 'COMMUNITY'], enableWhaleTracking: true, enableOnChainAnalysis: true, alertSensitivity: 'MEDIUM' }), minPotential: val }
                                    }));
                                }}
                                className="w-full bg-slate-900 border border-slate-800 text-[10px] text-white rounded px-1.5 py-0.5 outline-none focus:border-purple-500"
                            >
                                <option value={2}>2x (稳健)</option>
                                <option value={5}>5x (爆发)</option>
                                <option value={10}>10x (黑马)</option>
                                <option value={50}>50x (百倍)</option>
                                <option value={100}>100x (登月)</option>
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        {/* Data Sources Compact */}
                        <div className="flex items-center gap-1.5 bg-slate-900/40 p-1.5 rounded border border-slate-800/50">
                            <input 
                                type="checkbox" 
                                checked={scanConfig.smartMode?.enableWhaleTracking ?? true} 
                                onChange={e => {
                                    const checked = e.target.checked;
                                    setScanConfig(p => ({
                                        ...p, 
                                        smartMode: { ...(p.smartMode || { enabled: true, isActive: false, minHeat: 60, minPotential: 10, sentimentSource: ['AI', 'COMMUNITY'], enableWhaleTracking: true, enableOnChainAnalysis: true, alertSensitivity: 'MEDIUM' }), enableWhaleTracking: checked }
                                    }));
                                }}
                                className="accent-purple-500 h-3 w-3"
                            />
                            <span className="text-[9px] text-slate-400">巨鲸异动</span>
                        </div>
                        <div className="flex items-center gap-1.5 bg-slate-900/40 p-1.5 rounded border border-slate-800/50">
                            <input 
                                type="checkbox" 
                                checked={scanConfig.smartMode?.enableOnChainAnalysis ?? true} 
                                onChange={e => {
                                    const checked = e.target.checked;
                                    setScanConfig(p => ({
                                        ...p, 
                                        smartMode: { ...(p.smartMode || { enabled: true, isActive: false, minHeat: 60, minPotential: 10, sentimentSource: ['AI', 'COMMUNITY'], enableWhaleTracking: true, enableOnChainAnalysis: true, alertSensitivity: 'MEDIUM' }), enableOnChainAnalysis: checked }
                                    }));
                                }}
                                className="accent-purple-500 h-3 w-3"
                            />
                            <span className="text-[9px] text-slate-400">筹码追踪</span>
                        </div>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                        <label className="text-[9px] text-slate-500 uppercase font-bold whitespace-nowrap">预警灵敏度</label>
                        <div className="flex-1 grid grid-cols-3 gap-1">
                            {(['LOW', 'MEDIUM', 'HIGH'] as const).map(lev => (
                                <button 
                                    key={lev}
                                    onClick={() => {
                                        setScanConfig(p => ({
                                            ...p, 
                                            smartMode: { ...(p.smartMode || { enabled: true, isActive: false, minHeat: 60, minPotential: 10, sentimentSource: ['AI', 'COMMUNITY'], enableWhaleTracking: true, enableOnChainAnalysis: true, alertSensitivity: 'MEDIUM' }), alertSensitivity: lev }
                                        }));
                                    }}
                                    className={`py-0.5 text-[9px] font-bold rounded border transition-all ${scanConfig.smartMode?.alertSensitivity === lev ? 'bg-purple-600 border-purple-400 text-white' : 'bg-slate-900 border-slate-800 text-slate-500'}`}
                                >
                                    {lev === 'LOW' ? '守' : lev === 'MEDIUM' ? '衡' : '攻'}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="bg-slate-900/80 border border-purple-500/20 rounded p-1.5 text-[9px] text-purple-300 leading-tight">
                        <div className="flex items-center gap-1.5 mb-0.5 text-purple-400 font-black">
                            <Zap size={10} className="animate-pulse" />
                            <span>AI智能扫描策略:</span>
                        </div>
                        {scanConfig.smartMode?.isActive ? (
                            <span className="text-emerald-400 uppercase font-mono tracking-tighter">AI 24H High-Speed Analysis Engaged... Scanning 10,000+ signals...</span>
                        ) : (
                            <span className="opacity-60 text-slate-400 px-1 italic">深度情感扫描与链上挖掘已就绪，请启动开关</span>
                        )}
                    </div>
                </div>
            )}

            {/* Backtest Controls - Shown when in Backtest mode */}
            {scannerMode === 'BACKTEST' && backtestProps && (
                <div className="bg-amber-950/20 border border-amber-500/20 rounded p-3 space-y-3 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] text-amber-500 font-bold uppercase flex items-center gap-1">
                            <History size={12}/> 回测设置
                        </span>
                        {backtestProps.isPlaying && (
                            <div className="flex items-center gap-1.5 text-[9px] text-slate-300 font-mono">
                                <Clock size={10} className="text-amber-500" />
                                {new Date(backtestProps.virtualTime).toLocaleString()}
                            </div>
                        )}
                    </div>

                    {/* Backtest Symbol Mode Selector */}
                    <div className="flex gap-1 p-0.5 bg-slate-900/50 rounded border border-slate-800">
                        <button 
                            onClick={() => backtestProps.setUseCustomOnly(false)}
                            className={`flex-1 py-1 text-[9px] font-bold rounded transition-all ${!backtestProps.useCustomOnly ? 'bg-amber-600/30 text-amber-400 border border-amber-500/30' : 'text-slate-500'}`}
                        >
                            初筛结果
                        </button>
                        <button 
                            onClick={() => backtestProps.setUseCustomOnly(true)}
                            className={`flex-1 py-1 text-[9px] font-bold rounded transition-all ${backtestProps.useCustomOnly ? 'bg-amber-600/30 text-amber-400 border border-amber-500/30' : 'text-slate-500'}`}
                        >
                            手动输入
                        </button>
                    </div>

                    {/* Manual Symbol Input for Backtest */}
                    {backtestProps.useCustomOnly && (
                        <div className="animate-in fade-in slide-in-from-right-2 space-y-2">
                             <div className="flex gap-1">
                                <input 
                                    type="text" 
                                    value={manualInput} 
                                    onChange={e => setManualInput(e.target.value)} 
                                    onKeyDown={(e) => e.key === 'Enter' && handleAddSymbol()} 
                                    placeholder="增加币种 (如 DOGE)" 
                                    className="flex-1 bg-slate-900 border border-amber-500/30 rounded px-2 py-1 text-xs text-white focus:border-amber-400 outline-none uppercase"
                                />
                                <button onClick={handleAddSymbol} className="bg-amber-600 hover:bg-amber-500 text-white px-3 rounded text-xs font-bold transition-colors"><PlusCircle size={14} /></button>
                            </div>
                            <textarea 
                                value={backtestProps.customSymbols} 
                                onChange={e => backtestProps.setCustomSymbols(e.target.value)} 
                                placeholder="BTC, ETH, SOL..." 
                                className="w-full bg-slate-900 border border-amber-500/50 rounded p-2 text-xs text-white focus:outline-none h-16 font-mono resize-none focus:border-amber-400 transition-colors"
                            />
                            <div className="flex justify-between items-center text-[8px] text-slate-500 px-1">
                                <span>回测币种: <span className="text-amber-400 font-mono">{backtestProps.customSymbols.split(',').filter(s=>s.trim()).length}</span></span>
                                <button onClick={() => backtestProps.setCustomSymbols('')} className="text-red-400 hover:text-red-300 flex items-center gap-1">
                                    <Trash2 size={10} /> 清空
                                </button>
                            </div>
                        </div>
                    )}

                    {!backtestProps.useCustomOnly && (
                        <div className="text-[9px] text-slate-400 text-center py-2 border border-slate-800 rounded bg-slate-900/30">
                            将对当前列表1的所有初筛结果进行回测
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                            <label className="text-[9px] text-slate-500 uppercase font-bold">步进速度</label>
                            <select 
                                value={backtestProps.speed} 
                                onChange={(e) => backtestProps.setSpeed(Number(e.target.value))}
                                className="w-full bg-slate-900 border border-slate-800 text-[10px] text-white rounded px-2 py-1 outline-none focus:border-amber-500"
                            >
                                <option value={1}>1x 逐K线</option>
                                <option value={20}>20x 快速</option>
                                <option value={100}>100x 极速</option>
                                <option value={300}>300x 狂暴</option>
                                <option value={1000}>1000x 瞬移</option>
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-[9px] text-slate-500 uppercase font-bold">K线周期</label>
                            <div className="flex flex-wrap gap-1">
                                {['1m', '5m', '15m', '1h', '4h'].map(tf => (
                                    <button 
                                        key={tf}
                                        onClick={() => {
                                            const next = backtestProps.intervals.includes(tf) 
                                                ? backtestProps.intervals.filter(t => t !== tf) 
                                                : [...backtestProps.intervals, tf];
                                            backtestProps.setIntervals(next);
                                        }}
                                        className={`text-[8px] px-1.5 py-0.5 rounded border transition-all ${backtestProps.intervals.includes(tf) ? 'bg-amber-600/20 border-amber-500 text-amber-400' : 'bg-slate-900 border-slate-800 text-slate-500'}`}
                                    >
                                        {tf}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-[9px] text-slate-500 uppercase font-bold text-center block">回测时间范围 (历史同步)</label>
                        <div className="flex items-center gap-2">
                            <input 
                                type="date" 
                                value={backtestProps.downloadRange.start}
                                onChange={(e) => backtestProps.setDownloadRange({ ...backtestProps.downloadRange, start: e.target.value })}
                                className="flex-1 bg-slate-900 border border-slate-800 text-[10px] text-white rounded px-2 py-1 outline-none"
                            />
                            <span className="text-slate-500">-</span>
                            <input 
                                type="date" 
                                value={backtestProps.downloadRange.end}
                                onChange={(e) => backtestProps.setDownloadRange({ ...backtestProps.downloadRange, end: e.target.value })}
                                className="flex-1 bg-slate-900 border border-slate-800 text-[10px] text-white rounded px-2 py-1 outline-none"
                            />
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <button 
                            onClick={backtestProps.onDownload}
                            disabled={backtestProps.isDownloading}
                            className={`flex-1 py-1.5 rounded transition-all flex items-center justify-center gap-2 text-[10px] font-bold ${backtestProps.isDownloading ? 'bg-slate-800 text-slate-500' : 'bg-slate-800 hover:bg-slate-700 text-amber-500 border border-amber-500/30'}`}
                        >
                            {backtestProps.isDownloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                            {backtestProps.isDownloading ? '正在同步...' : '同步数据'}
                        </button>
                        <button 
                            onClick={backtestProps.isPlaying ? backtestProps.onStop : backtestProps.onStart}
                            className={`flex-[1.5] py-1.5 rounded text-[10px] font-bold flex items-center justify-center gap-2 transition-all ${backtestProps.isPlaying ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20'}`}
                        >
                            {backtestProps.isPlaying ? <Square size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
                            {backtestProps.isPlaying ? '停止模拟' : '开始回测'}
                        </button>
                    </div>

                    {backtestProps.syncProgress && (
                        <div className="pt-1">
                            <div className="flex justify-between text-[8px] text-amber-500 font-bold mb-1">
                                <span>同步进度</span>
                                <span>{backtestProps.syncProgress.percent}%</span>
                            </div>
                            <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                                <div className="h-full bg-amber-500 transition-all duration-300" style={{ width: `${backtestProps.syncProgress.percent}%` }} />
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Watchlist Body */}
            {scannerMode === 'LIVE' && scanConfig.useCustomOnly && (
                <div className="space-y-3 pt-3 border-t border-slate-800 animate-in fade-in slide-in-from-right-2 duration-300">
                    <div className="flex bg-slate-900 rounded p-0.5 border border-slate-700/50">
                        <button onClick={() => setFixedModeView('MONITOR')} className={`flex-1 py-1.5 text-[9px] font-bold rounded transition-all flex items-center justify-center gap-1 ${fixedModeView === 'MONITOR' ? 'bg-cyan-900/50 text-cyan-400 border-cyan-500/30' : 'text-slate-500'}`}><List size={10} /> 监控列表</button>
                        <button onClick={() => setFixedModeView('SEARCH')} className={`flex-1 py-1.5 text-[9px] font-bold rounded transition-all flex items-center justify-center gap-1 ${fixedModeView === 'SEARCH' ? 'bg-orange-900/50 text-orange-400 border-orange-500/30' : 'text-slate-500'}`}><PlusCircle size={10} /> 市场搜索</button>
                    </div>
                    
                    {fixedModeView === 'MONITOR' ? (
                        <div className="bg-cyan-900/10 border border-cyan-500/30 rounded p-3 text-center animate-in fade-in zoom-in-95 relative group">
                            <div className="text-cyan-400 font-bold text-xs mb-2 flex items-center justify-center gap-2"><Target size={14} /> 重点监控池</div>
                            <div className="flex gap-1 mb-2">
                                <input type="text" value={manualInput} onChange={e => setManualInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddSymbol()} placeholder="输入币名 (如 DOGE)" className="flex-1 bg-slate-900 border border-cyan-500/30 rounded px-2 py-1 text-xs text-white focus:border-cyan-400 outline-none uppercase"/>
                                <button onClick={handleAddSymbol} className="bg-cyan-600 hover:bg-cyan-500 text-white px-3 rounded text-xs font-bold transition-colors shadow-lg shadow-cyan-900/20"><PlusCircle size={14} /></button>
                            </div>
                            {autoCandidates.length > 0 && (
                                <div className="flex gap-1 mb-2">
                                    <select 
                                        onChange={handleSelectDropdown}
                                        defaultValue=""
                                        className="flex-1 bg-slate-900 border border-cyan-500/30 text-xs text-cyan-400 font-bold rounded px-2 py-1.5 outline-none focus:border-cyan-400 cursor-pointer h-8"
                                        title="点击下拉框选择初筛漏斗中的币种"
                                    >
                                        <option value="" disabled>📋 从初筛候选池精选币种 ({autoCandidates.length}个)</option>
                                        <option value="__ADD_ALL__">➕ 一键导入全部初筛候选币 &gt;&gt;</option>
                                        {autoCandidates.map(item => {
                                            const rawSym = item.symbol.replace('USDT', '');
                                            const isAdded = scanConfig.customSymbols.split(',').map(s => s.trim()).filter(Boolean).includes(rawSym);
                                            return (
                                                <option key={item.symbol} value={rawSym}>
                                                    {isAdded ? '🔴 [已选] ' : '🟢 [未选] '}{rawSym} ({item.change > 0 ? '+' : ''}{item.change.toFixed(1)}%)
                                                </option>
                                            );
                                        })}
                                    </select>
                                </div>
                            )}
                            <textarea value={scanConfig.customSymbols} onChange={e => setScanConfig(p => ({...p, customSymbols: e.target.value}))} placeholder="BTC, ETH, SOL..." className="w-full bg-slate-900 border border-cyan-500/50 rounded p-2 text-xs text-white focus:outline-none h-16 font-mono resize-none focus:border-cyan-400 transition-colors"/>
                            <div className="flex justify-between items-center text-[9px] text-slate-500 mt-1 px-1">
                                <span>数量: <span className="text-white font-mono">{scanConfig.customSymbols.split(',').filter(s=>s.trim()).length}</span></span>
                                <div className="flex gap-2">
                                    {onClearBlacklist && <button type="button" onClick={(e) => { e.preventDefault(); if (window.confirm('确定要清空已删除列表吗？')) onClearBlacklist(); }} className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors hover:bg-slate-800 px-1.5 py-0.5 rounded active:scale-95" title="清空已删除列表"><RotateCcw size={10}/> 恢复</button>}
                                    {onClearWatchlist && <button type="button" onClick={(e) => { e.preventDefault(); onClearWatchlist(); }} className="flex items-center gap-1 text-red-400 hover:text-red-300 transition-colors hover:bg-red-900/20 px-1.5 py-0.5 rounded active:scale-95"><Trash2 size={10}/> 清空</button>}
                                </div>
                            </div>
                            
                            {/* Visual List of Monitored Coins */}
                            {scanConfig.customSymbols.split(',').map(s=>s.trim()).filter(Boolean).length > 0 && (
                                <div className="mt-3 pt-3 border-t border-slate-800/60 text-left">
                                    <div className="text-[10px] text-cyan-400 font-bold mb-1.5 flex items-center justify-between">
                                        <span>当前监控中 ({scanConfig.customSymbols.split(',').map(s=>s.trim()).filter(Boolean).length}个币种)</span>
                                    </div>
                                    <div className="flex flex-wrap gap-1 max-h-[140px] overflow-y-auto custom-scrollbar p-1.5 bg-slate-950/40 rounded border border-slate-800/40">
                                        {scanConfig.customSymbols.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean).map(sym => (
                                            <div key={sym} className="flex items-center gap-1 bg-cyan-950/30 text-cyan-400 text-[10px] font-mono px-1.5 py-0.5 rounded border border-cyan-500/15 group/chip">
                                                <span>{sym}</span>
                                                <button 
                                                    type="button"
                                                    onClick={() => {
                                                        const remaining = scanConfig.customSymbols.split(',').map(s => s.trim()).filter(s => s.toUpperCase() !== sym.toUpperCase()).join(', ');
                                                        setScanConfig(p => ({ ...p, customSymbols: remaining }));
                                                    }}
                                                    className="hover:text-red-400 transition-colors cursor-pointer text-slate-500 font-bold ml-0.5"
                                                    title={`移除 ${sym}`}
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="bg-orange-900/10 border border-orange-500/30 rounded p-2 animate-in fade-in zoom-in-95">
                            <div className="text-[9px] text-orange-300 text-center font-bold mb-1">勾选下方币种以添加至监控</div>
                            <div className="text-[8px] text-slate-500 text-center">使用上方过滤器来查找币种</div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
