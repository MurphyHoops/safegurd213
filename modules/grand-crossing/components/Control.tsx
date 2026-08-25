
import React, { useState } from 'react';
import { Activity, History, ChevronDown, ChevronUp } from 'lucide-react';
import { List2Config, ScanConfig } from '../../../components/Scanner/scannerTypes';
import { TimeframeSelector } from './TimeframeSelector';
import { ConfigSection } from './ConfigSection';
import { ScannerHistoryModal } from '../../momentum-audit/components/ScannerHistoryModal';

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
}

export const List2Control: React.FC<List2PanelProps> = ({ config, setConfig, scanConfig, setScanConfig, countdowns, tfCounts, activeFilterTf, isLocked, onTfInteraction, activeScanTfs, scanningSymbols, pollingStatus }) => {
    const [showHistory, setShowHistory] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(() => localStorage.getItem('list2_control_collapsed') === 'true');

    const toggleCollapse = () => {
        setIsCollapsed(prev => {
            const next = !prev;
            localStorage.setItem('list2_control_collapsed', String(next));
            return next;
        });
    };
    
    return (
        <div className="p-3 bg-slate-900 border-b border-slate-800 space-y-3 shrink-0">
            <div className="flex flex-col gap-2.5">
                {/* Row 1: Title & Batch */}
                <div className="flex items-center justify-between cursor-pointer select-none" onClick={toggleCollapse}>
                    <div className="flex items-center gap-3">
                        <div className="font-bold text-blue-400 text-sm flex items-center gap-2">
                            <Activity size={14} className="text-blue-500" /> 
                            <span>2. 均线穿越</span>
                        </div>
                        {/* Batch Input moved here */}
                        <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                            <span className="text-[10px] text-slate-400 font-bold">批次</span>
                            <input 
                                type="number" 
                                min="1" 
                                max="100" 
                                value={Number.isNaN(scanConfig.batchSize) ? '' : scanConfig.batchSize} 
                                onChange={(e) => setScanConfig(p => ({...p, batchSize: parseInt(e.target.value) || 40}))} 
                                className="w-10 h-6 bg-slate-800 border border-slate-700 rounded text-center text-[11px] text-orange-400 outline-none font-bold select-text focus:border-blue-500/50" 
                            />
                        </div>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300">
                        <span>{isCollapsed ? '展开设置' : '折叠设置'}</span>
                        {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                    </div>
                </div>
                
                {/* Row 2: Secondary Controls */}
                {!isCollapsed && (
                    <div className="flex items-center gap-5">
                        {/* Crossing Toggle */}
                        <div className="flex items-center gap-2" title="开启后必须满足均线穿越条件">
                            <span className="text-[10px] text-slate-400 font-bold">穿越</span>
                            <div onClick={() => setConfig(p => ({...p, requireCrossing: !p.requireCrossing}))} className={`w-7 h-3.5 rounded-full p-0.5 cursor-pointer transition-all ${config.requireCrossing !== false ? 'bg-amber-600' : 'bg-slate-700'}`}>
                                <div className={`w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${config.requireCrossing !== false ? 'translate-x-3.5' : ''}`} />
                            </div>
                        </div>

                        {/* Divergence Toggle */}
                        <div className="flex items-center gap-2" title="开启后必须满足均线顺势发散 (EMA 10>20>30>40)">
                            <span className="text-[10px] text-slate-400 font-bold">发散</span>
                            <div onClick={() => setConfig(p => ({...p, requireAlignment: !p.requireAlignment}))} className={`w-7 h-3.5 rounded-full p-0.5 cursor-pointer transition-all ${config.requireAlignment ? 'bg-indigo-600' : 'bg-slate-700'}`}>
                                <div className={`w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${config.requireAlignment ? 'translate-x-3.5' : ''}`} />
                            </div>
                        </div>

                        <div className="w-[1px] h-3 bg-slate-800" />

                        {/* Long / Short / All Selector (replaced batch position) */}
                        <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded border border-slate-800">
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
                )}
            </div>
            
            {!isCollapsed && (
                <>
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
                    />

                    <ConfigSection config={config} setConfig={setConfig} />
                </>
            )}
        </div>
    );
};
