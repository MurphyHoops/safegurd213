
import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Activity, Settings2, PlayCircle, Loader2, CheckCircle2, Clock } from 'lucide-react';
import { MajorTrendConfig } from '../../../components/Scanner/scannerTypes';
import { SmartNumberInput } from '../../../components/Scanner/ScannerUIHelpers';

interface Props {
    config?: MajorTrendConfig;
    setConfig: (cfg: MajorTrendConfig) => void;
    isMajorScanning?: boolean;
    majorProgress?: { 
        current: number, 
        total: number, 
        stage?: string, 
        group1Passed?: number, 
        group2Passed?: number, 
        group3Passed?: number, 
        currentSymbol?: string 
    };
    onRunDiscovery?: (isManual?: boolean) => void;
    onCancelDiscovery?: () => void;
    isPrimaryMode?: boolean;
}

const DEFAULT_CONFIG: MajorTrendConfig = {
    enabled: false,
    updateIntervalHours: 4,
    intervalMinutes: 4,
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
        { enabled: false, days: 1, minLong: 1, maxLong: 9, maxPullbackLong: 5, minShort: 1, maxShort: 9, maxPullbackShort: 5 },
        { enabled: false, days: 2, minLong: 1, maxLong: 9, maxPullbackLong: 5, minShort: 1, maxShort: 9, maxPullbackShort: 5 },
        { enabled: false, days: 3, minLong: 2, maxLong: 20, maxPullbackLong: 8, minShort: 2, maxShort: 20, maxPullbackShort: 8 },
        { enabled: false, days: 7, minLong: 4, maxLong: 30, maxPullbackLong: 10, minShort: 4, maxShort: 30, maxPullbackShort: 10 }
    ]
};

export const MajorTrendSection: React.FC<Props> = ({ 
    config, setConfig, isMajorScanning, majorProgress, onRunDiscovery, onCancelDiscovery, isPrimaryMode 
}) => {
    const [isExpanded, setIsExpanded] = useState(isPrimaryMode || false);
    const [isEditingInterval, setIsEditingInterval] = useState(false);
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
                            全周期大行情寻找与过滤
                        </div>
                    </div>
                </div>
                
                <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    {/* (手动/自动) 读取运行开关 */}
                    <div className="flex items-center bg-slate-950/80 rounded border border-slate-700/80 p-0.5" title="大行情发现运行模式：自动读取行情启动底池 / 手动点击运行">
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                updateField('autoMode', false);
                            }}
                            className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold transition-all ${
                                !activeConfig.autoMode 
                                    ? 'bg-amber-600 text-white shadow-sm' 
                                    : 'text-slate-400 hover:text-slate-200'
                            }`}
                        >
                            手动
                        </button>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                updateField('autoMode', true);
                            }}
                            className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold transition-all ${
                                activeConfig.autoMode 
                                    ? 'bg-indigo-600 text-white shadow-sm' 
                                    : 'text-slate-400 hover:text-slate-200'
                            }`}
                        >
                            自动
                        </button>
                    </div>

                    {/* 访问行情启动底池速度按钮 (默认4分钟) */}
                    <div 
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 hover:border-indigo-500/60 text-[9px] text-slate-300 cursor-pointer transition-colors"
                        title="点击调整访问行情启动底池的速度(分钟)"
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsEditingInterval(!isEditingInterval);
                        }}
                    >
                        <Clock size={10} className="text-indigo-400" />
                        {isEditingInterval ? (
                            <input
                                type="number"
                                min={1}
                                max={60}
                                value={activeConfig.intervalMinutes ?? 4}
                                onChange={(e) => updateField('intervalMinutes', Math.max(1, parseInt(e.target.value) || 1))}
                                onBlur={() => setIsEditingInterval(false)}
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                                className="w-8 bg-slate-950 text-white font-mono text-center text-[9px] outline-none border-b border-indigo-500"
                            />
                        ) : (
                            <span className="font-mono font-bold text-indigo-300">
                                ({activeConfig.intervalMinutes ?? 4})分钟
                            </span>
                        )}
                    </div>

                    {/* Integrated Switch */}
                    <button 
                        onClick={toggleEnabled}
                        title={activeConfig.enabled ? "点击关闭大行情发现" : "点击开启大行情发现"}
                        className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors duration-200 focus:outline-none ${activeConfig.enabled ? 'bg-indigo-600' : 'bg-slate-700'}`}
                    >
                        <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform duration-200 ${activeConfig.enabled ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
                    </button>
                    {isExpanded ? <ChevronUp size={14} className="text-slate-500 cursor-pointer" /> : <ChevronDown size={14} className="text-slate-500 cursor-pointer" />}
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

                    {/* Stage 1: Sideways Filter (横盘蓄势过滤 - 优先访问行情启动底池) */}
                    <div className="bg-black/20 p-2 rounded border border-slate-800/50 space-y-2.5">
                        <div className="flex items-center justify-between pb-1.5 border-b border-slate-800/60">
                            <div className="flex flex-col">
                                <span className="text-[9px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                                    Stage 1: 横盘蓄势过滤 (Z, X%, Y%)
                                </span>
                                <span className="text-[7.5px] text-slate-500">
                                    优先从行情启动底池读取数据，限制过去 Z 天内最高/最低点到当前价格的幅差
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
                                横盘蓄势过滤机制已停用 (Stage 1 将直接放行所有候选币)
                            </div>
                        )}
                    </div>

                    {/* Stage 2: Lookback Period Filter (回溯周期过滤) */}
                    <div className="bg-black/20 p-2 rounded border border-slate-800/50 space-y-2.5">
                        {/* Header Row */}
                        <div className="flex items-center justify-between border-b border-slate-800/60 pb-1.5">
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Stage 2: 回溯周期过滤</span>
                            <div className="flex items-center gap-1.5 bg-black/40 border border-slate-800 px-2 py-0.5 rounded">
                                <span className="text-[8.5px] text-slate-500 font-medium">回溯周期</span>
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
                    
                    {/* Multi-Stage Pipeline Progress */}
                    {isMajorScanning && majorProgress && (
                        <div className="bg-slate-950/85 border border-slate-800/80 rounded p-2 space-y-1.5 text-[10px] text-slate-300 my-2">
                            <div className="flex items-center justify-between border-b border-slate-800/60 pb-1 mb-1">
                                <span className="font-bold text-slate-100 flex items-center gap-1">
                                    <Activity size={10} className="text-indigo-400 animate-pulse shrink-0" />
                                    <span>顺序过滤管道</span>
                                </span>
                                <span className="text-[9px] font-mono text-indigo-400 font-bold bg-indigo-950/40 px-1 py-0.2 rounded border border-indigo-900/30 max-w-[100px] truncate">
                                    {majorProgress.currentSymbol ? `${majorProgress.currentSymbol}` : '正在准备...'}
                                </span>
                            </div>

                            {/* Step 0: Volume Filter */}
                            <div className="flex items-center justify-between py-0.5 text-[9px]">
                                <div className="flex items-center gap-1 text-emerald-400">
                                    <CheckCircle2 size={10} className="shrink-0" />
                                    <span>交易额初筛 (Step 0)</span>
                                </div>
                                <span className="text-slate-400 font-mono">✅ 已完成</span>
                            </div>

                            {/* Step 1: Sideways Filter (横盘蓄势过滤 - 优先访问行情启动底池) */}
                            <div className="flex items-center justify-between py-0.5 border-t border-slate-900/40 pt-1 text-[9px]">
                                <div className="flex items-center gap-1">
                                    {majorProgress.stage === 'group1' ? (
                                        <Loader2 size={10} className="text-indigo-400 animate-spin shrink-0" />
                                    ) : (majorProgress.stage === 'group2' || majorProgress.stage === 'group3') ? (
                                        <CheckCircle2 size={10} className="text-emerald-400 shrink-0" />
                                    ) : (
                                        <span className="w-1.5 h-1.5 rounded-full bg-slate-800 shrink-0 inline-block ml-[2px]" />
                                    )}
                                    <span className={majorProgress.stage === 'group1' ? 'text-indigo-300 font-bold' : (majorProgress.stage === 'group2' || majorProgress.stage === 'group3') ? 'text-slate-400' : 'text-slate-500'}>
                                        第一组: 横盘蓄势过滤 (优先访问底池)
                                    </span>
                                </div>
                                <div className="font-mono text-right shrink-0">
                                    {majorProgress.stage === 'group1' ? (
                                        <span className="text-indigo-400">
                                            ({majorProgress.current}/{majorProgress.total}) 
                                            <span className="ml-1 text-emerald-400">过:{majorProgress.group1Passed || 0}</span>
                                        </span>
                                    ) : (majorProgress.stage === 'group2' || majorProgress.stage === 'group3') ? (
                                        <span className="text-emerald-400">✅ 通过 {majorProgress.group1Passed || 0}</span>
                                    ) : (
                                        <span className="text-slate-600">⏳ 等待中</span>
                                    )}
                                </div>
                            </div>

                            {/* Step 2: Lookback Space Filter (回溯周期过滤) */}
                            <div className="flex items-center justify-between py-0.5 border-t border-slate-900/40 pt-1 text-[9px]">
                                <div className="flex items-center gap-1">
                                    {majorProgress.stage === 'group2' ? (
                                        <Loader2 size={10} className="text-indigo-400 animate-spin shrink-0" />
                                    ) : majorProgress.stage === 'group3' ? (
                                        <CheckCircle2 size={10} className="text-emerald-400 shrink-0" />
                                    ) : (
                                        <span className="w-1.5 h-1.5 rounded-full bg-slate-800 shrink-0 inline-block ml-[2px]" />
                                    )}
                                    <span className={majorProgress.stage === 'group2' ? 'text-indigo-300 font-bold' : majorProgress.stage === 'group3' ? 'text-slate-400' : 'text-slate-500'}>
                                        第二组: 回溯周期过滤 (空间与极值)
                                    </span>
                                </div>
                                <div className="font-mono text-right shrink-0">
                                    {majorProgress.stage === 'group2' ? (
                                        <span className="text-indigo-400">
                                            ({majorProgress.current}/{majorProgress.total})
                                            <span className="ml-1 text-emerald-400">过:{majorProgress.group2Passed || 0}</span>
                                        </span>
                                    ) : majorProgress.stage === 'group3' ? (
                                        <span className="text-emerald-400">✅ 通过 {majorProgress.group2Passed || 0}</span>
                                    ) : (
                                        <span className="text-slate-600">⏳ 等待中</span>
                                    )}
                                </div>
                            </div>

                            {/* Step 3: Start Trend Filter */}
                            <div className="flex items-center justify-between py-0.5 border-t border-slate-900/40 pt-1 text-[9px]">
                                <div className="flex items-center gap-1">
                                    {majorProgress.stage === 'group3' ? (
                                        <Loader2 size={10} className="text-indigo-400 animate-spin shrink-0" />
                                    ) : (
                                        <span className="w-1.5 h-1.5 rounded-full bg-slate-800 shrink-0 inline-block ml-[2px]" />
                                    )}
                                    <span className={majorProgress.stage === 'group3' ? 'text-indigo-300 font-bold' : 'text-slate-500'}>
                                        第三组: 行情启动趋势
                                    </span>
                                </div>
                                <div className="font-mono text-right shrink-0">
                                    {majorProgress.stage === 'group3' ? (
                                        <span className="text-indigo-400 flex items-center gap-1 justify-end">
                                            <span>({majorProgress.current}/{majorProgress.total})</span>
                                            <span className="text-emerald-400">选:{majorProgress.group3Passed || 0}</span>
                                        </span>
                                    ) : (
                                        <span className="text-slate-600">⏳ 等待中</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-2">
                        <button 
                            disabled={isMajorScanning || !activeConfig.enabled}
                            onClick={() => onRunDiscovery && onRunDiscovery(true)}
                            className="flex-1 flex items-center justify-center gap-2 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 rounded text-[10px] font-bold text-white transition-all border border-indigo-400/30"
                        >
                            {isMajorScanning ? (
                                <><Loader2 size={12} className="animate-spin" /> {Math.round((majorProgress?.current || 0) / (majorProgress?.total || 1) * 100)}% 完成</>
                            ) : (
                                <><PlayCircle size={14} /> 运行全周期大行情寻找</>
                            )}
                        </button>
                        {isMajorScanning && onCancelDiscovery && (
                            <button
                                onClick={onCancelDiscovery}
                                className="px-3 py-1.5 bg-rose-600/80 hover:bg-rose-500 text-white rounded text-[10px] font-bold transition-all border border-rose-500/30 flex items-center gap-1"
                            >
                                取消
                            </button>
                        )}
                    </div>
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
