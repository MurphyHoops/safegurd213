
import React, { useState } from 'react';
import { Loader2, RefreshCw, Play, Pause, ChevronDown, ChevronRight } from 'lucide-react';
import { ScanConfig } from '../../../components/Scanner/scannerTypes';
import { SmartNumberInput } from '../../../components/Scanner/ScannerUIHelpers';

interface Props {
    scanConfig: ScanConfig;
    setScanConfig: React.Dispatch<React.SetStateAction<ScanConfig>>;
    scanInterval: number;
    setScanInterval: (v: number) => void;
    isScanning: boolean;
    isPaused: boolean;
    setIsPaused: (v: boolean) => void;
    countdown: string;
    scanStatusText: string;
    onScan: () => void;
}

export const ActionSection: React.FC<Props> = ({ scanConfig, setScanConfig, scanInterval, setScanInterval, isScanning, isPaused, setIsPaused, countdown, scanStatusText, onScan }) => {
    const [isBreakerExpanded, setIsBreakerExpanded] = useState(false);

    return (
        <div className="space-y-3">
            {/* Unified Status Row */}
            <div className="flex items-center justify-between bg-slate-800/50 rounded p-1.5 mb-1 border border-slate-700/50 h-9">
                {/* Left: Loop Input */}
                <div className="flex items-center gap-1.5 border-r border-slate-700 pr-2 mr-2">
                    <span className="text-[9px] text-slate-500 font-bold whitespace-nowrap">循环(min)</span>
                    <input type="number" min="1" value={Number.isNaN(scanInterval) ? '' : scanInterval} onChange={(e) => setScanInterval(Math.max(1, parseInt(e.target.value) || 1))} className="w-8 h-5 bg-slate-900 border border-slate-700 rounded text-center text-[10px] text-white outline-none font-bold focus:border-emerald-500" />
                </div>
                
                {/* Center: Countdown */}
                <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-emerald-400 border-r border-slate-700 pr-2 mr-2">
                    {isPaused ? (
                        <span className="text-amber-400 text-[10px]">已暂停</span>
                    ) : (
                        <>
                            <RefreshCw size={10} className={isScanning ? 'animate-spin' : ''} />
                            {countdown}
                        </>
                    )}
                </div>

                {/* Right: System Status */}
                <div className="flex-1 flex justify-end overflow-hidden">
                    {isScanning ? (
                        <div className="flex items-center gap-1.5 text-[9px] text-orange-300 animate-pulse">
                            <Loader2 size={10} className="animate-spin" />
                            <span className="truncate">运行中...</span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5 text-[9px] text-emerald-400">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.8)]" />
                            <span className="truncate">待机中</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Breaker Config with Folding/Collapsible Support */}
            <div className="bg-[#1e2329] border border-slate-700 rounded p-2 text-[10px] space-y-2 mt-2">
                <div 
                    className="flex items-center justify-between cursor-pointer select-none"
                    onClick={() => setIsBreakerExpanded(!isBreakerExpanded)}
                >
                    <div className="flex items-center gap-1">
                        {isBreakerExpanded ? <ChevronDown size={11} className="text-slate-400" /> : <ChevronRight size={11} className="text-slate-400" />}
                        <span className="text-slate-400 font-bold">防恐慌熔断</span>
                    </div>
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <span className={`text-[8px] px-1 rounded ${scanConfig?.breakerConfig?.enabled ? 'bg-emerald-950 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
                            {scanConfig?.breakerConfig?.enabled ? '运行中' : '未启用'}
                        </span>
                        <button 
                            onClick={() => {
                                if (!scanConfig) {
                                    console.error("[Monitor] ActionSection: Missing scanConfig on click");
                                    return;
                                }
                                setScanConfig(p => ({
                                    ...p, 
                                    breakerConfig: { ...(p.breakerConfig || { enabled: false, triggerMinutes: 15, minDropPercent: 3, minCoinsPercent: 50, autoRecoverMinutes: 30 }), enabled: !p.breakerConfig?.enabled }
                                }))
                            }}
                            className={`w-8 h-4 rounded-full relative transition-colors ${scanConfig?.breakerConfig?.enabled ? 'bg-emerald-600' : 'bg-slate-700'}`}
                        >
                            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${scanConfig?.breakerConfig?.enabled ? 'right-0.5' : 'left-0.5'}`} />
                        </button>
                    </div>
                </div>
                {isBreakerExpanded && (
                    <div className="space-y-2 border-t border-slate-800/80 pt-2">
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                 <span className="text-slate-500">监测(分)</span>
                                 <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded text-white text-center h-5" value={scanConfig.breakerConfig?.triggerMinutes ?? 15} onChange={e => setScanConfig(p => ({...p, breakerConfig: {...(p.breakerConfig || { enabled: false, triggerMinutes: 15, minDropPercent: 3, minCoinsPercent: 50, autoRecoverMinutes: 30 }), triggerMinutes: parseInt(e.target.value) || 0}}))} />
                            </div>
                             <div>
                                 <span className="text-slate-500">触发跌幅%</span>
                                 <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded text-white text-center h-5" value={scanConfig.breakerConfig?.minDropPercent ?? 3} onChange={e => setScanConfig(p => ({...p, breakerConfig: {...(p.breakerConfig || { enabled: false, triggerMinutes: 15, minDropPercent: 3, minCoinsPercent: 50, autoRecoverMinutes: 30 }), minDropPercent: parseInt(e.target.value) || 0}}))} />
                            </div>
                            <div>
                                 <span className="text-slate-500">币种占比%</span>
                                 <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded text-white text-center h-5" value={scanConfig.breakerConfig?.minCoinsPercent ?? 50} onChange={e => setScanConfig(p => ({...p, breakerConfig: {...(p.breakerConfig || { enabled: false, triggerMinutes: 15, minDropPercent: 3, minCoinsPercent: 50, autoRecoverMinutes: 30 }), minCoinsPercent: parseInt(e.target.value) || 0}}))} />
                            </div>
                             <div>
                                 <span className="text-slate-500">锁定(分)</span>
                                 <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded text-white text-center h-5" value={scanConfig.breakerConfig?.autoRecoverMinutes ?? 30} onChange={e => setScanConfig(p => ({...p, breakerConfig: {...(p.breakerConfig || { enabled: false, triggerMinutes: 15, minDropPercent: 3, minCoinsPercent: 50, autoRecoverMinutes: 30 }), autoRecoverMinutes: parseInt(e.target.value) || 0}}))} />
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Big Action Button */}
            <div className="flex gap-2">
                <div className="bg-[#1e2329] border border-slate-700 rounded p-1.5 flex flex-col justify-center px-2 w-20">
                    <span className="text-[9px] text-slate-500">数量限制</span>
                    <SmartNumberInput 
                        value={scanConfig.limit} 
                        onChange={val => setScanConfig(p => ({...p, limit: val}))} 
                        className="w-full bg-transparent text-center font-mono text-white text-xs outline-none select-text mt-0.5"
                    />
                </div>
                <button 
                    onClick={() => setIsPaused(!isPaused)}
                    className={`w-10 h-10 shrink-0 flex items-center justify-center rounded border transition-colors ${
                        isPaused ? 'bg-amber-900/50 text-amber-400 border-amber-500/50' : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-white'
                    }`}
                    title={isPaused ? "恢复自动更新" : "暂停自动更新"}
                >
                    {isPaused ? <Play size={14} /> : <Pause size={14} />}
                </button>
                <button 
                    onClick={onScan} 
                    className={`flex-1 h-10 font-bold rounded text-xs flex items-center justify-center gap-2 shadow-lg transition-all ${
                        isScanning 
                        ? 'bg-amber-900/50 hover:bg-amber-800/50 text-amber-400 border border-amber-500/50' 
                        : 'bg-[#0f766e] hover:bg-[#0d9488] text-white shadow-emerald-900/30 border border-emerald-500/50'
                    }`}
                >
                    {isScanning ? <Pause size={14} fill="currentColor" /> : <RefreshCw size={14} />}
                    {isScanning ? `暂停 (${scanStatusText})` : '手动更新候选池'}
                </button>
            </div>
        </div>
    );
};
