
import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Activity, Settings2, PlayCircle, Loader2 } from 'lucide-react';
import { MajorTrendConfig } from '../../../components/Scanner/scannerTypes';
import { SmartNumberInput } from '../../../components/Scanner/ScannerUIHelpers';

interface Props {
    config?: MajorTrendConfig;
    setConfig: (cfg: MajorTrendConfig) => void;
    isMajorScanning?: boolean;
    majorProgress?: { current: number, total: number };
    candidateCount: number;
    onRunDiscovery?: (isManual?: boolean) => void;
    isPrimaryMode?: boolean;
}

const DEFAULT_CONFIG: MajorTrendConfig = {
    enabled: false,
    updateIntervalHours: 4,
    requestPerMinute: 20,
    lookbackDays: 300,
    minHistoryDrop: 50,
    minHistoryPump: 100,
    maxExtremeDistance: 5,
    sidewaysDays: 7,
    sidewaysMaxPump: 10,
    sidewaysMaxDrop: 10,
    autoTransfer: false
};

export const MajorTrendSection: React.FC<Props> = ({ 
    config, setConfig, isMajorScanning, majorProgress, candidateCount, onRunDiscovery, isPrimaryMode 
}) => {
    const [isExpanded, setIsExpanded] = useState(isPrimaryMode || false);
    const activeConfig = config || DEFAULT_CONFIG;

    const toggleEnabled = (e: React.MouseEvent) => {
        e.stopPropagation();
        setConfig({ ...activeConfig, enabled: !activeConfig.enabled });
    };

    const updateField = (field: keyof MajorTrendConfig, value: any) => {
        setConfig({ ...activeConfig, [field]: value });
    };

    return (
        <div className="border border-slate-800 rounded-lg bg-slate-900/50 overflow-hidden transition-all duration-300">
            {/* Header with Integrated Switch */}
            <div className={`p-2 flex items-center justify-between cursor-pointer hover:bg-slate-800/80 ${activeConfig.enabled ? 'bg-indigo-900/20' : ''}`} onClick={() => setIsExpanded(!isExpanded)}>
                <div className="flex items-center gap-2">
                    <div className={`p-1 rounded ${activeConfig.enabled ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-500'}`}>
                        <DiscoveryIcon isScanning={isMajorScanning} />
                    </div>
                    <div>
                        <div className="text-[10px] font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                            大行情发现
                            {activeConfig.enabled && <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse" />}
                        </div>
                        <div className="text-[9px] text-slate-500">
                            候选池: {candidateCount} 个币种
                        </div>
                    </div>
                </div>
                
                <div className="flex items-center gap-3">
                    {/* Integrated Switch */}
                    <button 
                        onClick={toggleEnabled}
                        className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors focus:outline-none ${activeConfig.enabled ? 'bg-indigo-600' : 'bg-slate-700'}`}
                    >
                        <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${activeConfig.enabled ? 'translate-x-3.5' : 'translate-x-1'}`} />
                    </button>
                    {isExpanded ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
                </div>
            </div>

            {/* Compact Content */}
            {isExpanded && (
                <div className="p-2 border-t border-slate-800 space-y-3 animate-in slide-in-from-top-1 duration-200">
                    {/* Scanning Setup */}
                    <div className="grid grid-cols-2 gap-1.5">
                        <InputField label="更新频率(h)" value={activeConfig.updateIntervalHours} onChange={v => updateField('updateIntervalHours', v)} />
                        <InputField label="速率(币/分)" value={activeConfig.requestPerMinute} onChange={v => updateField('requestPerMinute', v)} />
                    </div>

                    {/* Transfer Mode Switch */}
                    <div className="bg-black/20 p-1.5 rounded border border-slate-800/50">
                        <div className="flex items-center justify-between">
                            <span className="text-[8.5px] font-bold text-slate-400">移入监控列表方式</span>
                            <div className="flex bg-slate-950 p-0.5 rounded border border-slate-800">
                                <button 
                                    onClick={() => updateField('autoTransfer', false)}
                                    className={`px-2 py-0.5 text-[8.5px] rounded font-bold transition-all ${!activeConfig.autoTransfer ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                                >
                                    手动
                                </button>
                                <button 
                                    onClick={() => updateField('autoTransfer', true)}
                                    className={`px-2 py-0.5 text-[8.5px] rounded font-bold transition-all ${activeConfig.autoTransfer ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                                >
                                    自动
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Core Discovery Args */}
                    <div className="bg-black/20 p-1.5 rounded border border-slate-800/50">
                        <div className="text-[8px] font-bold text-slate-500 uppercase mb-1 flex justify-between">
                            <span>Stage 1: 核心参数</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                            <InputField label="回测周期" value={activeConfig.lookbackDays} onChange={v => updateField('lookbackDays', v)} />
                            <InputField label="极值距离" value={activeConfig.maxExtremeDistance} onChange={v => updateField('maxExtremeDistance', v)} />
                            <InputField label="历史跌幅" value={activeConfig.minHistoryDrop} onChange={v => updateField('minHistoryDrop', v)} color="text-rose-400" />
                            <InputField label="历史涨幅" value={activeConfig.minHistoryPump} onChange={v => updateField('minHistoryPump', v)} color="text-emerald-400" />
                        </div>
                    </div>

                    {/* Sideways Filter */}
                    <div className="bg-black/20 p-1.5 rounded border border-slate-800/50">
                        <div className="text-[8px] font-bold text-slate-500 uppercase mb-1">Stage 1: 横盘蓄势 (相对Z天)</div>
                        <div className="grid grid-cols-1 gap-1">
                            <div className="grid grid-cols-3 gap-1">
                                <InputField label="Z天前" value={activeConfig.sidewaysDays} onChange={v => updateField('sidewaysDays', v)} />
                                <InputField label="涨<A%" value={activeConfig.sidewaysMaxPump} onChange={v => updateField('sidewaysMaxPump', v)} />
                                <InputField label="跌<B%" value={activeConfig.sidewaysMaxDrop} onChange={v => updateField('sidewaysMaxDrop', v)} />
                            </div>
                        </div>
                    </div>

                    {/* Action Button */}
                    <button 
                        disabled={isMajorScanning || !activeConfig.enabled}
                        onClick={() => onRunDiscovery && onRunDiscovery(true)}
                        className="w-full flex items-center justify-center gap-2 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 rounded text-[10px] font-bold text-white transition-all border border-indigo-400/30"
                    >
                        {isMajorScanning ? (
                            <><Loader2 size={12} className="animate-spin" /> {Math.round((majorProgress?.current || 0) / (majorProgress?.total || 1) * 100)}% 完成</>
                        ) : (
                            <><PlayCircle size={14} /> 运行全周期大行情寻找</>
                        )}
                    </button>
                </div>
            )}
        </div>
    );
};

const InputField: React.FC<{ label: string, value: number, onChange: (v: number) => void, color?: string }> = ({ label, value, onChange, color }) => (
    <div className="bg-black/30 border border-slate-800/50 rounded px-1.5 py-0.5 flex items-center justify-between gap-2">
        <span className="text-[8px] text-slate-500 whitespace-nowrap">{label}</span>
        <SmartNumberInput 
            value={value} 
            onChange={onChange}
            className={`w-10 bg-transparent font-mono text-[10px] text-right outline-none ${color || 'text-white'}`}
        />
    </div>
);

const DiscoveryIcon: React.FC<{ isScanning?: boolean }> = ({ isScanning }) => {
    if (isScanning) return <Loader2 size={12} className="animate-spin" />;
    return <Activity size={12} />;
};
