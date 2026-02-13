
import React, { useMemo } from 'react';
import { Loader2, Search, Activity, Eye, ShieldCheck } from 'lucide-react';
import { List3Config, ScannerItem, ActionConfig, COLUMN_WIDTH_CLASS, StructureScanStatus } from './scannerTypes';
import { PositionSide } from '../../types';
import { List3Control } from './List3/Control';
import { List3Item } from './List3/Item';

interface Props {
    config: List3Config;
    setConfig: React.Dispatch<React.SetStateAction<List3Config>>;
    countdowns: Record<string, string>;
    list3: ScannerItem[];
    setChartData: (data: any) => void;
    executeTradeSafe: (symbol: string, side: PositionSide, price: number, reason: string, signalTf?: string) => void;
    actionConfig: ActionConfig;
    scanningStatus: StructureScanStatus | null;
}

const List3_Structure: React.FC<Props> = ({ config, setConfig, countdowns, list3, setChartData, executeTradeSafe, actionConfig, scanningStatus }) => {
    
    // --- DYNAMIC FILTERING LOGIC ---
    const filteredList = useMemo(() => {
        return list3.map(item => {
             const validResults = item.list3Results?.filter(r => {
                 if (config.strictTrend && !r.structure.isStrictTrend) return false;
                 if (config.checkCandleColor && !r.structure.isColorValid) return false;
                 if (config.enableThrust && !r.structure.thrustValid) return false;
                 
                 if (config.enableResonance) {
                     if (r.structure.locationPct > config.maxLocation) return false;
                     if (r.structure.crossCount < config.minCrossCount) return false;
                     if (r.structure.bbw > config.maxBBW) return false;
                 }
                 
                 const rsi = r.structure.rsi;
                 if (r.direction === 'LONG') {
                     if (rsi < config.rsiLongMin || rsi > config.rsiLongMax) return false;
                 } else {
                     if (rsi < config.rsiShortMin || rsi > config.rsiShortMax) return false;
                 }
                 
                 if (!config.timeframes.includes(r.tf)) return false;

                 if (config.antiChase?.enabled && r.structure.periodChange !== undefined) {
                     const change = r.structure.periodChange;
                     if (r.direction === 'LONG') {
                         if (change > config.antiChase.maxRise) return false;
                     } else {
                         if (change < -config.antiChase.maxFall) return false;
                     }
                 }

                 return true;
             }) || [];
             
             if (validResults.length === 0) return null;
             return { ...item, list3Results: validResults };
        }).filter(Boolean) as ScannerItem[];
    }, [list3, config]);

    // Active Rules for Display (IDLE State)
    const activeRules = useMemo(() => {
        const rules = [];
        if (config.strictTrend) rules.push("Strict Trend");
        if (config.enableThrust) rules.push("7K Thrust");
        if (config.enableResonance) rules.push("Resonance");
        if (config.checkCandleColor) rules.push("Color");
        if (config.antiChase?.enabled) rules.push("Anti-Chase");
        return rules.length > 0 ? rules.join(' | ') : "Standard Audit";
    }, [config]);

    return (
        <div className={`flex flex-col h-full bg-slate-900 border-r border-slate-800 ${COLUMN_WIDTH_CLASS}`}>
            <List3Control config={config} setConfig={setConfig} countdowns={countdowns} />
            
            {/* PERSISTENT STATUS WINDOW */}
            <div className="mx-3 mt-2 mb-1 bg-indigo-900/10 border border-indigo-500/20 rounded p-2 relative overflow-hidden transition-all min-h-[52px] flex flex-col justify-center">
                {scanningStatus ? (
                    <>
                        <div className="absolute inset-0 bg-indigo-500/5 animate-pulse"></div>
                        <div className="flex justify-between items-center mb-1 relative z-10">
                            <span className="text-[10px] font-bold text-indigo-300 flex items-center gap-1">
                                <Loader2 size={10} className="animate-spin" /> 深度审计中...
                            </span>
                            <span className="text-[10px] font-mono text-indigo-200">
                                {Math.round((scanningStatus.current / (scanningStatus.total || 1)) * 100)}%
                            </span>
                        </div>
                        
                        <div className="h-1 bg-indigo-900/50 rounded-full overflow-hidden mb-1.5 relative z-10">
                            <div 
                                className="h-full bg-indigo-500 transition-all duration-300 ease-out" 
                                style={{ width: `${(scanningStatus.current / (scanningStatus.total || 1)) * 100}%` }}
                            />
                        </div>

                        <div className="flex flex-col gap-0.5 relative z-10">
                            <div className="flex justify-between items-center text-[9px] text-slate-400">
                                <span className="italic opacity-80">{scanningStatus.currentAction || "Initializing..."}</span>
                                <div className="flex gap-1 overflow-hidden max-w-[80px]">
                                    {scanningStatus.symbols.slice(scanningStatus.current, scanningStatus.current + 2).map(s => (
                                        <span key={s} className="font-mono text-white">{s.replace('USDT','')}</span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex flex-col justify-center items-center h-full relative z-10 opacity-70">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 mb-1">
                            <Eye size={12} className="text-emerald-500" />
                            <span>实时监控就绪 (Standby)</span>
                        </div>
                        <div className="text-[9px] text-indigo-400/80 flex items-center gap-1 bg-indigo-900/20 px-2 py-0.5 rounded border border-indigo-500/10">
                            <ShieldCheck size={9} />
                            Active: {activeRules}
                        </div>
                    </div>
                )}
            </div>

            <div className="px-3 py-2 bg-slate-950/50 border-b border-slate-800 flex justify-between items-center sticky top-0">
                <div className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                    <Activity size={12} /> 3. 爆发结构
                </div>
                <div className="text-xs font-mono font-bold text-white">{filteredList.length}</div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar bg-slate-950/20">
                {filteredList.length === 0 && !scanningStatus && (
                    <div className="flex flex-col items-center justify-center h-24 opacity-30 text-slate-500">
                        <Search size={24} className="mb-1"/>
                        <span className="text-[10px]">等待符合条件的信号...</span>
                    </div>
                )}
                {filteredList.map((item, idx) => (
                    <List3Item 
                        key={idx}
                        item={item}
                        results={item.list3Results} 
                        setChartData={setChartData}
                        executeTradeSafe={executeTradeSafe}
                    />
                ))}
            </div>
        </div>
    );
};

export default List3_Structure;
