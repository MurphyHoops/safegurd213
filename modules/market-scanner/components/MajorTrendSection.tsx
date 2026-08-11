
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
    autoTransfer: false,
    enableLong: true,
    enableShort: true,
    enableSideways: true,
    maxExtremeDistanceLong: 5,
    maxExtremeDistanceShort: 5,
    minExtremeDistanceLong: 0,
    minExtremeDistanceShort: 0,
    extremeDaysMinLong: 0,
    extremeDaysMaxLong: 300,
    extremeDaysMinShort: 0,
    extremeDaysMaxShort: 300,
    enableStartTrend: false,
    enableStartTrendLong: false,
    enableStartTrendShort: false,
    startTrendGroups: [
        { enabled: false, hours: 4, minLong: 1, maxLong: 5, minShort: 1, maxShort: 5 },
        { enabled: false, hours: 12, minLong: 2, maxLong: 10, minShort: 2, maxShort: 10 },
        { enabled: false, hours: 24, minLong: 4, maxLong: 20, minShort: 4, maxShort: 20 }
    ]
};

export const MajorTrendSection: React.FC<Props> = ({ 
    config, setConfig, isMajorScanning, majorProgress, candidateCount, onRunDiscovery, isPrimaryMode 
}) => {
    const [isExpanded, setIsExpanded] = useState(isPrimaryMode || false);
    const activeConfig = { ...DEFAULT_CONFIG, ...config };
    if (activeConfig.enableStartTrend) {
        if (activeConfig.enableStartTrendLong === undefined) activeConfig.enableStartTrendLong = true;
        if (activeConfig.enableStartTrendShort === undefined) activeConfig.enableStartTrendShort = true;
    }

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
                        className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors duration-200 focus:outline-none ${activeConfig.enabled ? 'bg-indigo-600' : 'bg-slate-700'}`}
                    >
                        <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform duration-200 ${activeConfig.enabled ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
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
                    <div className="bg-black/20 p-2 rounded border border-slate-800/50 space-y-2.5">
                        {/* Header Row */}
                        <div className="flex items-center justify-between border-b border-slate-800/60 pb-1.5">
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">核心参数</span>
                            <div className="flex items-center gap-1.5 bg-black/40 border border-slate-800 px-2 py-0.5 rounded">
                                <span className="text-[8.5px] text-slate-500 font-medium">回测周期</span>
                                <SmartNumberInput 
                                    value={activeConfig.lookbackDays} 
                                    onChange={v => updateField('lookbackDays', v)}
                                    className="w-10 bg-transparent font-mono text-[10px] text-right outline-none text-white font-bold"
                                />
                                <span className="text-[8.5px] text-slate-500">天</span>
                            </div>
                        </div>

                        {/* Direction Switches in Traditional Horizontal Way */}
                        <div className="flex items-center justify-between bg-slate-950/40 px-2 py-1.5 rounded border border-slate-800/40">
                            <span className="text-[8.5px] font-bold text-slate-400 uppercase tracking-tight">方向开关</span>
                            <div className="flex items-center gap-4">
                                {/* Long Switch */}
                                <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => updateField('enableLong', activeConfig.enableLong !== false ? false : true)}>
                                    <button 
                                        className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors duration-200 focus:outline-none ${activeConfig.enableLong !== false ? 'bg-emerald-600' : 'bg-slate-700'}`}
                                    >
                                        <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform duration-200 ${activeConfig.enableLong !== false ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
                                    </button>
                                    <span className={`text-[9px] font-bold ${activeConfig.enableLong !== false ? 'text-emerald-400' : 'text-slate-500'}`}>
                                        多 (Long)
                                    </span>
                                </div>

                                {/* Short Switch */}
                                <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => updateField('enableShort', activeConfig.enableShort !== false ? false : true)}>
                                    <button 
                                        className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors duration-200 focus:outline-none ${activeConfig.enableShort !== false ? 'bg-rose-600' : 'bg-slate-700'}`}
                                    >
                                        <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform duration-200 ${activeConfig.enableShort !== false ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
                                    </button>
                                    <span className={`text-[9px] font-bold ${activeConfig.enableShort !== false ? 'text-rose-400' : 'text-slate-500'}`}>
                                        空 (Short)
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Dual Column Layout (多 on Left, 空 on Right) */}
                        <div className="grid grid-cols-2 gap-2.5 text-[9px]">
                            {/* Column 1: 多 */}
                            <div className="space-y-2 pr-1 border-r border-slate-800/50">
                                <div className="flex items-center justify-between pb-0.5 border-b border-slate-800/30">
                                    <span className={`font-bold uppercase flex items-center gap-1 ${activeConfig.enableLong !== false ? 'text-emerald-400' : 'text-slate-500'}`}>
                                        <span className={`w-1.5 h-1.5 rounded-full ${activeConfig.enableLong !== false ? 'bg-emerald-500' : 'bg-slate-700'}`} />
                                        多头参数
                                    </span>
                                </div>

                                <div className={`space-y-1.5 transition-all duration-200 ${activeConfig.enableLong !== false ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                                    <div className="bg-black/30 border border-slate-800/50 rounded p-1">
                                        <div className="text-[8px] text-slate-500 mb-0.5">历史跌幅大于</div>
                                        <div className="flex items-center justify-between">
                                            <SmartNumberInput 
                                                value={activeConfig.minHistoryDrop} 
                                                onChange={v => updateField('minHistoryDrop', v)}
                                                className="w-full bg-transparent font-mono text-[10px] text-left outline-none text-rose-400 font-bold"
                                            />
                                            <span className="text-[8.5px] text-slate-500">%</span>
                                        </div>
                                    </div>

                                    <div className="bg-black/30 border border-slate-800/50 rounded p-1">
                                        <div className="text-[8px] text-slate-500 mb-0.5">最低点到当前涨幅区间</div>
                                        <div className="flex items-center gap-1 font-mono">
                                            <SmartNumberInput 
                                                value={activeConfig.minExtremeDistanceLong ?? 0} 
                                                onChange={v => updateField('minExtremeDistanceLong', v)}
                                                className="w-10 bg-transparent text-[10px] text-left outline-none text-emerald-400 font-bold"
                                            />
                                            <span className="text-slate-600">~</span>
                                            <SmartNumberInput 
                                                value={activeConfig.maxExtremeDistanceLong !== undefined ? activeConfig.maxExtremeDistanceLong : activeConfig.maxExtremeDistance} 
                                                onChange={v => {
                                                    setConfig({
                                                        ...activeConfig,
                                                        maxExtremeDistanceLong: v,
                                                        maxExtremeDistance: v
                                                    });
                                                }}
                                                className="w-10 bg-transparent text-[10px] text-left outline-none text-emerald-400 font-bold"
                                            />
                                            <span className="text-[8.5px] text-slate-500">%</span>
                                        </div>
                                    </div>

                                    <div className="bg-black/30 border border-slate-800/50 rounded p-1">
                                        <div className="text-[8px] text-slate-500 mb-0.5">最低点距今日天数区间</div>
                                        <div className="flex items-center gap-1 font-mono">
                                            <SmartNumberInput 
                                                value={activeConfig.extremeDaysMinLong ?? 0} 
                                                onChange={v => updateField('extremeDaysMinLong', v)}
                                                className="w-10 bg-transparent text-[10px] text-left outline-none text-sky-400 font-bold"
                                            />
                                            <span className="text-slate-600">~</span>
                                            <SmartNumberInput 
                                                value={activeConfig.extremeDaysMaxLong ?? 300} 
                                                onChange={v => updateField('extremeDaysMaxLong', v)}
                                                className="w-10 bg-transparent text-[10px] text-left outline-none text-sky-400 font-bold"
                                            />
                                            <span className="text-[8.5px] text-slate-500">天</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Column 2: 空 */}
                            <div className="space-y-2 pl-1">
                                <div className="flex items-center justify-between pb-0.5 border-b border-slate-800/30">
                                    <span className={`font-bold uppercase flex items-center gap-1 ${activeConfig.enableShort !== false ? 'text-rose-400' : 'text-slate-500'}`}>
                                        <span className={`w-1.5 h-1.5 rounded-full ${activeConfig.enableShort !== false ? 'bg-rose-500' : 'bg-slate-700'}`} />
                                        空头参数
                                    </span>
                                </div>

                                <div className={`space-y-1.5 transition-all duration-200 ${activeConfig.enableShort !== false ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                                    <div className="bg-black/30 border border-slate-800/50 rounded p-1">
                                        <div className="text-[8px] text-slate-500 mb-0.5">历史涨幅大于</div>
                                        <div className="flex items-center justify-between">
                                            <SmartNumberInput 
                                                value={activeConfig.minHistoryPump} 
                                                onChange={v => updateField('minHistoryPump', v)}
                                                className="w-full bg-transparent font-mono text-[10px] text-left outline-none text-emerald-400 font-bold"
                                            />
                                            <span className="text-[8.5px] text-slate-500">%</span>
                                        </div>
                                    </div>

                                    <div className="bg-black/30 border border-slate-800/50 rounded p-1">
                                        <div className="text-[8px] text-slate-500 mb-0.5">最高点到当前跌幅区间</div>
                                        <div className="flex items-center gap-1 font-mono">
                                            <SmartNumberInput 
                                                value={activeConfig.minExtremeDistanceShort ?? 0} 
                                                onChange={v => updateField('minExtremeDistanceShort', v)}
                                                className="w-10 bg-transparent text-[10px] text-left outline-none text-rose-400 font-bold"
                                            />
                                            <span className="text-slate-600">~</span>
                                            <SmartNumberInput 
                                                value={activeConfig.maxExtremeDistanceShort !== undefined ? activeConfig.maxExtremeDistanceShort : activeConfig.maxExtremeDistance} 
                                                onChange={v => {
                                                    setConfig({
                                                        ...activeConfig,
                                                        maxExtremeDistanceShort: v,
                                                        maxExtremeDistance: v
                                                    });
                                                }}
                                                className="w-10 bg-transparent text-[10px] text-left outline-none text-rose-400 font-bold"
                                            />
                                            <span className="text-[8.5px] text-slate-500">%</span>
                                        </div>
                                    </div>

                                    <div className="bg-black/30 border border-slate-800/50 rounded p-1">
                                        <div className="text-[8px] text-slate-500 mb-0.5">最高点距今日天数区间</div>
                                        <div className="flex items-center gap-1 font-mono">
                                            <SmartNumberInput 
                                                value={activeConfig.extremeDaysMinShort ?? 0} 
                                                onChange={v => updateField('extremeDaysMinShort', v)}
                                                className="w-10 bg-transparent text-[10px] text-left outline-none text-sky-400 font-bold"
                                            />
                                            <span className="text-slate-600">~</span>
                                            <SmartNumberInput 
                                                value={activeConfig.extremeDaysMaxShort ?? 300} 
                                                onChange={v => updateField('extremeDaysMaxShort', v)}
                                                className="w-10 bg-transparent text-[10px] text-left outline-none text-sky-400 font-bold"
                                            />
                                            <span className="text-[8.5px] text-slate-500">天</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Sideways Filter */}
                    <div className="bg-black/20 p-2 rounded border border-slate-800/50 space-y-2.5">
                        <div className="flex items-center justify-between pb-1.5 border-b border-slate-800/60">
                            <div className="flex flex-col">
                                <span className="text-[9px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                                    Stage 1.5: 横盘蓄势过滤 (Z, X%, Y%)
                                </span>
                                <span className="text-[7.5px] text-slate-500">
                                    限制过去 Z 天内最高/最低点到当前价格的幅差
                                </span>
                            </div>
                            <button 
                                onClick={() => updateField('enableSideways', !activeConfig.enableSideways)}
                                className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors duration-200 focus:outline-none ${activeConfig.enableSideways ? 'bg-indigo-600' : 'bg-slate-700'}`}
                            >
                                <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform duration-200 ${activeConfig.enableSideways ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
                            </button>
                        </div>
                        {activeConfig.enableSideways ? (
                            <div className="grid grid-cols-3 gap-2 text-[9px]">
                                <div className="bg-black/30 border border-slate-800/50 rounded p-1.5 flex flex-col justify-between h-[42px]">
                                    <div className="text-[7.5px] text-slate-500 mb-0.5 font-semibold">观察周期 (Z天)</div>
                                    <div className="flex items-center justify-between">
                                        <SmartNumberInput 
                                            value={activeConfig.sidewaysDays} 
                                            onChange={v => updateField('sidewaysDays', v)}
                                            className="w-full bg-transparent font-mono text-[10px] text-left outline-none text-indigo-400 font-bold"
                                        />
                                        <span className="text-[8px] text-slate-500 font-bold ml-1">天</span>
                                    </div>
                                </div>
                                <div className="bg-black/30 border border-slate-800/50 rounded p-1.5 flex flex-col justify-between h-[42px]">
                                    <div className="text-[7.5px] text-slate-500 mb-0.5 font-semibold">跌幅上限 (X%)</div>
                                    <div className="flex items-center justify-between">
                                        <SmartNumberInput 
                                            value={activeConfig.sidewaysMaxDrop} 
                                            onChange={v => updateField('sidewaysMaxDrop', v)}
                                            className="w-full bg-transparent font-mono text-[10px] text-left outline-none text-rose-400 font-bold"
                                        />
                                        <span className="text-[8px] text-slate-500 font-bold ml-1">%</span>
                                    </div>
                                </div>
                                <div className="bg-black/30 border border-slate-800/50 rounded p-1.5 flex flex-col justify-between h-[42px]">
                                    <div className="text-[7.5px] text-slate-500 mb-0.5 font-semibold">涨幅上限 (Y%)</div>
                                    <div className="flex items-center justify-between">
                                        <SmartNumberInput 
                                            value={activeConfig.sidewaysMaxPump} 
                                            onChange={v => updateField('sidewaysMaxPump', v)}
                                            className="w-full bg-transparent font-mono text-[10px] text-left outline-none text-emerald-400 font-bold"
                                        />
                                        <span className="text-[8px] text-slate-500 font-bold ml-1">%</span>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="text-[8.5px] text-slate-500 italic py-2 text-center bg-black/10 rounded border border-dashed border-slate-800/40">
                                横盘蓄势过滤机制已停用 (Stage 1 将直接放行所有结果)
                            </div>
                        )}
                    </div>

                    {/* Market Start Trend Filter */}
                    <div className="bg-black/20 p-2 rounded border border-slate-800/50 space-y-2.5">
                        <div className="flex items-center justify-between pb-1.5 border-b border-slate-800/60">
                            <div className="flex flex-col">
                                <span className="text-[9px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                                    Stage 1.8: 行情启动趋势
                                </span>
                                <span className="text-[7.5px] text-slate-500">
                                    多/空独立：做多限制 X 小时内涨幅，做空限制 Y 小时内跌幅
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1 bg-slate-950/40 px-1.5 py-0.5 rounded border border-slate-800/60">
                                    <span className="text-[7.5px] font-bold text-emerald-400">做多开关</span>
                                    <button 
                                        onClick={() => {
                                            const newVal = !activeConfig.enableStartTrendLong;
                                            setConfig({
                                                ...activeConfig,
                                                enableStartTrendLong: newVal,
                                                enableStartTrend: newVal || !!activeConfig.enableStartTrendShort
                                            });
                                        }}
                                        className={`relative inline-flex h-3 w-6 items-center rounded-full transition-colors duration-200 focus:outline-none ${activeConfig.enableStartTrendLong ? 'bg-emerald-600' : 'bg-slate-700'}`}
                                    >
                                        <span className={`inline-block h-1.5 w-1.5 transform rounded-full bg-white transition-transform duration-200 ${activeConfig.enableStartTrendLong ? 'translate-x-[11px]' : 'translate-x-[3px]'}`} />
                                    </button>
                                </div>
                                <div className="flex items-center gap-1 bg-slate-950/40 px-1.5 py-0.5 rounded border border-slate-800/60">
                                    <span className="text-[7.5px] font-bold text-rose-400">做空开关</span>
                                    <button 
                                        onClick={() => {
                                            const newVal = !activeConfig.enableStartTrendShort;
                                            setConfig({
                                                ...activeConfig,
                                                enableStartTrendShort: newVal,
                                                enableStartTrend: !!activeConfig.enableStartTrendLong || newVal
                                            });
                                        }}
                                        className={`relative inline-flex h-3 w-6 items-center rounded-full transition-colors duration-200 focus:outline-none ${activeConfig.enableStartTrendShort ? 'bg-rose-600' : 'bg-slate-700'}`}
                                    >
                                        <span className={`inline-block h-1.5 w-1.5 transform rounded-full bg-white transition-transform duration-200 ${activeConfig.enableStartTrendShort ? 'translate-x-[11px]' : 'translate-x-[3px]'}`} />
                                    </button>
                                </div>
                            </div>
                        </div>
                        {(activeConfig.enableStartTrendLong || activeConfig.enableStartTrendShort) ? (
                            <div className="space-y-1.5">
                                {(activeConfig.startTrendGroups || [
                                    { enabled: false, hours: 4, minLong: 1, maxLong: 5, maxPullbackLong: 2, minShort: 1, maxShort: 5, maxPullbackShort: 2 },
                                    { enabled: false, hours: 12, minLong: 2, maxLong: 10, maxPullbackLong: 4, minShort: 2, maxShort: 10, maxPullbackShort: 4 },
                                    { enabled: false, hours: 24, minLong: 4, maxLong: 20, maxPullbackLong: 6, minShort: 4, maxShort: 20, maxPullbackShort: 6 }
                                ]).map((group, idx) => (
                                    <div key={idx} className="bg-black/40 border border-slate-800/80 rounded p-1 space-y-1">
                                        <div className="flex items-center justify-between border-b border-slate-800/40 pb-1">
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-[11px] font-bold text-slate-200">组合 {idx + 1}</span>
                                                {group.enabled && (
                                                    <div className="flex items-center gap-1 bg-slate-950/60 px-1.5 py-0.5 rounded border border-slate-800/40 font-mono">
                                                        <span className="text-[10px] text-slate-400">周期:</span>
                                                        <SmartNumberInput 
                                                            value={group.hours} 
                                                            onChange={v => {
                                                                const currentGroups = activeConfig.startTrendGroups || [];
                                                                const updated = [...currentGroups];
                                                                updated[idx] = { ...updated[idx], hours: v };
                                                                updateField('startTrendGroups', updated);
                                                            }}
                                                            className="w-7 bg-transparent font-bold text-[11px] text-center outline-none text-indigo-400"
                                                        />
                                                        <span className="text-[10px] text-slate-400 font-bold">h</span>
                                                    </div>
                                                )}
                                            </div>
                                            <button 
                                                onClick={() => {
                                                    const currentGroups = activeConfig.startTrendGroups || [
                                                        { enabled: false, hours: 4, minLong: 1, maxLong: 5, maxPullbackLong: 2, minShort: 1, maxShort: 5, maxPullbackShort: 2 },
                                                        { enabled: false, hours: 12, minLong: 2, maxLong: 10, maxPullbackLong: 4, minShort: 2, maxShort: 10, maxPullbackShort: 4 },
                                                        { enabled: false, hours: 24, minLong: 4, maxLong: 20, maxPullbackLong: 6, minShort: 4, maxShort: 20, maxPullbackShort: 6 }
                                                    ];
                                                    const updated = [...currentGroups];
                                                    updated[idx] = { ...updated[idx], enabled: !updated[idx].enabled };
                                                    updateField('startTrendGroups', updated);
                                                }}
                                                className={`relative inline-flex h-3.5 w-7 items-center rounded-full transition-colors duration-200 focus:outline-none ${group.enabled ? 'bg-indigo-600' : 'bg-slate-700'}`}
                                            >
                                                <span className={`inline-block h-2 w-2 transform rounded-full bg-white transition-transform duration-200 ${group.enabled ? 'translate-x-[13px]' : 'translate-x-[3px]'}`} />
                                            </button>
                                        </div>
                                        {group.enabled ? (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                                                {/* 做多设置 (只在启用做多时显示) */}
                                                {activeConfig.enableStartTrendLong && (
                                                    <div className="bg-emerald-950/10 border border-emerald-900/10 px-1.5 py-1 rounded space-y-1">
                                                        <div className="text-[10px] font-bold text-emerald-400">做多启动:</div>
                                                        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                                                            <div className="bg-slate-950/40 px-1.5 py-0.5 rounded border border-slate-800/30">
                                                                <div className="text-[9px] text-slate-400 mb-0.5">距最低点涨幅</div>
                                                                <div className="flex items-center gap-0.5 font-mono">
                                                                    <SmartNumberInput 
                                                                        value={group.minLong} 
                                                                        onChange={v => {
                                                                            const currentGroups = activeConfig.startTrendGroups || [];
                                                                            const updated = [...currentGroups];
                                                                            updated[idx] = { ...updated[idx], minLong: v };
                                                                            updateField('startTrendGroups', updated);
                                                                        }}
                                                                        className="w-8 bg-transparent text-left outline-none text-emerald-400 font-bold text-[11px]"
                                                                    />
                                                                    <span className="text-slate-600">~</span>
                                                                    <SmartNumberInput 
                                                                        value={group.maxLong} 
                                                                        onChange={v => {
                                                                            const currentGroups = activeConfig.startTrendGroups || [];
                                                                            const updated = [...currentGroups];
                                                                            updated[idx] = { ...updated[idx], maxLong: v };
                                                                            updateField('startTrendGroups', updated);
                                                                        }}
                                                                        className="w-8 bg-transparent text-left outline-none text-emerald-400 font-bold text-[11px]"
                                                                    />
                                                                    <span className="text-[9px] text-slate-400">%</span>
                                                                </div>
                                                            </div>
                                                            <div className="bg-slate-950/40 px-1.5 py-0.5 rounded border border-slate-800/30">
                                                                <div className="text-[9px] text-slate-400 mb-0.5">距最高点跌幅</div>
                                                                <div className="flex items-center gap-0.5 font-mono">
                                                                    <span className="text-slate-500 text-[10px]">&lt;</span>
                                                                    <SmartNumberInput 
                                                                        value={group.maxPullbackLong !== undefined ? group.maxPullbackLong : 2} 
                                                                        onChange={v => {
                                                                            const currentGroups = activeConfig.startTrendGroups || [];
                                                                            const updated = [...currentGroups];
                                                                            updated[idx] = { ...updated[idx], maxPullbackLong: v };
                                                                            updateField('startTrendGroups', updated);
                                                                        }}
                                                                        className="w-8 bg-transparent text-left outline-none text-emerald-400 font-bold text-[11px]"
                                                                    />
                                                                    <span className="text-[9px] text-slate-400">%</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* 做空设置 (只在启用做空时显示) */}
                                                {activeConfig.enableStartTrendShort && (
                                                    <div className="bg-rose-950/10 border border-rose-900/10 px-1.5 py-1 rounded space-y-1">
                                                        <div className="text-[10px] font-bold text-rose-400">做空启动:</div>
                                                        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                                                            <div className="bg-slate-950/40 px-1.5 py-0.5 rounded border border-slate-800/30">
                                                                <div className="text-[9px] text-slate-400 mb-0.5">距最高点跌幅</div>
                                                                <div className="flex items-center gap-0.5 font-mono">
                                                                    <SmartNumberInput 
                                                                        value={group.minShort} 
                                                                        onChange={v => {
                                                                            const currentGroups = activeConfig.startTrendGroups || [];
                                                                            const updated = [...currentGroups];
                                                                            updated[idx] = { ...updated[idx], minShort: v };
                                                                            updateField('startTrendGroups', updated);
                                                                        }}
                                                                        className="w-8 bg-transparent text-left outline-none text-rose-400 font-bold text-[11px]"
                                                                    />
                                                                    <span className="text-slate-600">~</span>
                                                                    <SmartNumberInput 
                                                                        value={group.maxShort} 
                                                                        onChange={v => {
                                                                            const currentGroups = activeConfig.startTrendGroups || [];
                                                                            const updated = [...currentGroups];
                                                                            updated[idx] = { ...updated[idx], maxShort: v };
                                                                            updateField('startTrendGroups', updated);
                                                                        }}
                                                                        className="w-8 bg-transparent text-left outline-none text-rose-400 font-bold text-[11px]"
                                                                    />
                                                                    <span className="text-[9px] text-slate-400">%</span>
                                                                </div>
                                                            </div>
                                                            <div className="bg-slate-950/40 px-1.5 py-0.5 rounded border border-slate-800/30">
                                                                <div className="text-[9px] text-slate-400 mb-0.5">距最低点涨幅</div>
                                                                <div className="flex items-center gap-0.5 font-mono">
                                                                    <span className="text-slate-500 text-[10px]">&lt;</span>
                                                                    <SmartNumberInput 
                                                                        value={group.maxPullbackShort !== undefined ? group.maxPullbackShort : 2} 
                                                                        onChange={v => {
                                                                            const currentGroups = activeConfig.startTrendGroups || [];
                                                                            const updated = [...currentGroups];
                                                                            updated[idx] = { ...updated[idx], maxPullbackShort: v };
                                                                            updateField('startTrendGroups', updated);
                                                                        }}
                                                                        className="w-8 bg-transparent text-left outline-none text-rose-400 font-bold text-[11px]"
                                                                    />
                                                                    <span className="text-[9px] text-slate-400">%</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="text-[10px] text-slate-600 italic py-1 text-center">
                                                组合 {idx + 1} 已停用
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-[8.5px] text-slate-500 italic py-2 text-center bg-black/10 rounded border border-dashed border-slate-800/40">
                                行情启动趋势过滤机制已停用 (Stage 1 将直接放行所有结果)
                            </div>
                        )}
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
