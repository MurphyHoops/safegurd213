
import React from 'react';
import { Activity } from 'lucide-react';
import { List2Config, ScanConfig } from '../../../components/Scanner/scannerTypes';
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
    pollingStatus?: string;
}

export const List2Control: React.FC<List2PanelProps> = ({ config, setConfig, scanConfig, setScanConfig, countdowns, tfCounts, activeFilterTf, isLocked, onTfInteraction, activeScanTfs, pollingStatus }) => {
    
    return (
        <div className="p-3 bg-slate-900 border-b border-slate-800 space-y-3 shrink-0">
            <div className="flex flex-col gap-2.5">
                {/* Row 1: Title */}
                <div className="font-bold text-blue-400 text-sm flex items-center gap-2">
                    <Activity size={14} className="text-blue-500" /> 
                    <span>2. 均线穿越 (Grand Crossing)</span>
                </div>
                
                {/* Row 2: Secondary Controls */}
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

                    {/* Batch Input */}
                    <div className="flex items-center gap-2">
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
            </div>
            
            <TimeframeSelector 
                timeframes={config.timeframes}
                countdowns={countdowns}
                tfCounts={tfCounts}
                activeFilterTf={activeFilterTf}
                isLocked={isLocked}
                onTfInteraction={onTfInteraction}
                activeScanTfs={activeScanTfs}
                pollingStatus={pollingStatus}
            />

            <ConfigSection config={config} setConfig={setConfig} />
        </div>
    );
};
