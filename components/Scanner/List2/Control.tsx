
import React from 'react';
import { Activity } from 'lucide-react';
import { List2Config, ScanConfig } from '../scannerTypes';
import { TimeframeSelector } from './TimeframeSelector';
import { ConfigSection } from './ConfigSection';

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
}

export const List2Control: React.FC<List2PanelProps> = ({ config, setConfig, scanConfig, setScanConfig, countdowns, tfCounts, activeFilterTf, isLocked, onTfInteraction, activeScanTfs }) => {
    
    return (
        <div className="p-3 bg-slate-900 border-b border-slate-800 space-y-3 shrink-0">
            <div className="font-bold text-blue-400 text-sm flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Activity size={14} /> 2. 均线穿越 (Grand Crossing)
                </div>
                {/* Batch Input Moved Here */}
                <div className="flex items-center gap-1">
                    <span className="text-[9px] text-slate-500 font-bold">批次</span>
                    <input 
                        type="number" 
                        min="1" 
                        max="100" 
                        value={scanConfig.batchSize} 
                        onChange={(e) => setScanConfig(p => ({...p, batchSize: parseInt(e.target.value) || 40}))} 
                        className="w-8 h-5 bg-slate-800 border border-slate-700 rounded text-center text-[10px] text-orange-400 outline-none font-bold select-text" 
                    />
                </div>
            </div>
            
            <TimeframeSelector 
                timeframes={config.timeframes}
                countdowns={countdowns}
                tfCounts={tfCounts}
                activeFilterTf={activeFilterTf}
                isLocked={isLocked}
                onTfInteraction={onTfInteraction}
                activeScanTfs={activeScanTfs}
            />

            <ConfigSection config={config} setConfig={setConfig} />
        </div>
    );
};
