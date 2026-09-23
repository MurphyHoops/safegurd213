
import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Activity, Settings2, PlayCircle, Loader2, CheckCircle2, Clock, Plus, Trash2, Layers, Link2, Unlink } from 'lucide-react';
import { MajorTrendConfig, SidewaysRuleGroup } from '../../../components/Scanner/scannerTypes';
import { SmartNumberInput } from '../../../components/Scanner/ScannerUIHelpers';
import { usePersistedState } from '../../../hooks/usePersistedState';

interface Props {
    config?: MajorTrendConfig;
    setConfig: (cfg: MajorTrendConfig) => void;
    isMajorScanning?: boolean;
    majorProgress?: { 
        current: number; 
        total: number; 
        stage?: string; 
        group1Total?: number;
        group1Current?: number;
        group1Passed?: number; 
        group2Total?: number;
        group2Current?: number;
        group2Passed?: number; 
        currentSymbol?: string; 
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
    sidewaysLogic: 'OR',
    sidewaysGroups: [
        { id: 'g1', enabled: true, days: 7, maxDrop: 10, maxPump: 10 }
    ],
    autoTransfer: false,
    enableLong: true,
    enableShort: true,
    enableSideways: true,
    enableSidewaysLong: true,
    enableSidewaysShort: true,
    enableLookbackFilter: true,
    syncDirectionLock: true,
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
    const [isCollapsed, setIsCollapsed] = usePersistedState<boolean>('SCANNER_MAJOR_TREND_SECTION_COLLAPSED', false);
    const isExpanded = !isCollapsed;
    const [isEditingInterval, setIsEditingInterval] = useState(false);
    const activeConfig = { ...DEFAULT_CONFIG, ...config };
    if (activeConfig.enableStartTrend) {
        if (activeConfig.enableStartTrendLong === undefined) activeConfig.enableStartTrendLong = true;
        if (activeConfig.enableStartTrendShort === undefined) activeConfig.enableStartTrendShort = true;
    }

    const isSyncLocked = activeConfig.syncDirectionLock !== false;

    const toggleEnabled = (e: React.MouseEvent) => {
        e.stopPropagation();
        setConfig({ ...activeConfig, enabled: !activeConfig.enabled });
    };

    const updateField = (field: keyof MajorTrendConfig, value: any) => {
        setConfig({ ...activeConfig, [field]: value });
    };

    const toggleLong = (source: 'SIDEWAYS' | 'LOOKBACK') => {
        const currentVal = source === 'SIDEWAYS' 
            ? (activeConfig.enableSidewaysLong !== false) 
            : (activeConfig.enableLong !== false);
        const newVal = !currentVal;

        if (isSyncLocked) {
            // 🔗 联动模式：三大过滤（行情启动、横盘蓄势、回溯周期）全域自动同步多头方向
            setConfig({
                ...activeConfig,
                enableStartTrendLong: newVal,
                enableStartTrend: newVal || !!activeConfig.enableStartTrendShort,
                enableSidewaysLong: newVal,
                enableSideways: newVal || (activeConfig.enableSidewaysShort !== false),
                enableLong: newVal,
                enableLookbackFilter: newVal || (activeConfig.enableShort !== false)
            });
        } else {
            // 独立模式
            if (source === 'SIDEWAYS') {
                updateField('enableSidewaysLong', newVal);
            } else {
                updateField('enableLong', newVal);
            }
        }
    };

    const toggleShort = (source: 'SIDEWAYS' | 'LOOKBACK') => {
        const currentVal = source === 'SIDEWAYS' 
            ? (activeConfig.enableSidewaysShort !== false) 
            : (activeConfig.enableShort !== false);
        const newVal = !currentVal;

        if (isSyncLocked) {
            // 🔗 联动模式：三大过滤（行情启动、横盘蓄势、回溯周期）全域自动同步空头方向
            setConfig({
                ...activeConfig,
                enableStartTrendShort: newVal,
                enableStartTrend: !!activeConfig.enableStartTrendLong || newVal,
                enableSidewaysShort: newVal,
                enableSideways: (activeConfig.enableSidewaysLong !== false) || newVal,
                enableShort: newVal,
                enableLookbackFilter: (activeConfig.enableLong !== false) || newVal
            });
        } else {
            // 独立模式
            if (source === 'SIDEWAYS') {
                updateField('enableSidewaysShort', newVal);
            } else {
                updateField('enableShort', newVal);
            }
        }
    };

    const handleQuickDirection = (mode: 'LONG_ONLY' | 'SHORT_ONLY' | 'BOTH') => {
        if (mode === 'LONG_ONLY') {
            setConfig({
                ...activeConfig,
                enableStartTrendLong: true,
                enableStartTrendShort: false,
                enableStartTrend: true,
                enableSidewaysLong: true,
                enableSidewaysShort: false,
                enableSideways: true,
                enableLong: true,
                enableShort: false,
                enableLookbackFilter: true
            });
        } else if (mode === 'SHORT_ONLY') {
            setConfig({
                ...activeConfig,
                enableStartTrendLong: false,
                enableStartTrendShort: true,
                enableStartTrend: true,
                enableSidewaysLong: false,
                enableSidewaysShort: true,
                enableSideways: true,
                enableLong: false,
                enableShort: true,
                enableLookbackFilter: true
            });
        } else {
            setConfig({
                ...activeConfig,
                enableStartTrendLong: true,
                enableStartTrendShort: true,
                enableStartTrend: true,
                enableSidewaysLong: true,
                enableSidewaysShort: true,
                enableSideways: true,
                enableLong: true,
                enableShort: true,
                enableLookbackFilter: true
            });
        }
    };

    const rawSidewaysGroups: SidewaysRuleGroup[] = activeConfig.sidewaysGroups && activeConfig.sidewaysGroups.length > 0
        ? activeConfig.sidewaysGroups
        : [
            { id: 'g1', enabled: true, days: activeConfig.sidewaysDays || 7, maxDrop: activeConfig.sidewaysMaxDrop || 10, maxPump: activeConfig.sidewaysMaxPump || 10 }
        ];

    const updateSidewaysGroup = (index: number, partial: Partial<SidewaysRuleGroup>) => {
        const next = [...rawSidewaysGroups];
        next[index] = { ...next[index], ...partial };
        const firstActive = next.find(g => g.enabled !== false) || next[0];
        setConfig({
            ...activeConfig,
            sidewaysGroups: next,
            sidewaysDays: firstActive.days,
            sidewaysMaxDrop: firstActive.maxDrop,
            sidewaysMaxPump: firstActive.maxPump
        });
    };

    const addSidewaysGroup = () => {
        if (rawSidewaysGroups.length >= 6) return;
        const newDays = rawSidewaysGroups.length === 1 ? 3 : (rawSidewaysGroups.length === 2 ? 14 : (rawSidewaysGroups.length === 3 ? 1 : 30));
        const newGroup: SidewaysRuleGroup = {
            id: 'g_' + Date.now(),
            enabled: true,
            days: newDays,
            maxDrop: 10,
            maxPump: 10
        };
        const next = [...rawSidewaysGroups, newGroup];
        setConfig({
            ...activeConfig,
            sidewaysGroups: next
        });
    };

    const removeSidewaysGroup = (index: number) => {
        if (rawSidewaysGroups.length <= 1) return;
        const next = rawSidewaysGroups.filter((_, idx) => idx !== index);
        const firstActive = next.find(g => g.enabled !== false) || next[0];
        setConfig({
            ...activeConfig,
            sidewaysGroups: next,
            sidewaysDays: firstActive.days,
            sidewaysMaxDrop: firstActive.maxDrop,
            sidewaysMaxPump: firstActive.maxPump
        });
    };

    return (
        <div className="border border-slate-800 rounded-lg bg-slate-900/50 overflow-hidden transition-all duration-300">
            {/* Header with Integrated Switch */}
            <div 
                className={`p-2 flex items-center justify-between cursor-pointer select-none hover:bg-slate-800/80 ${activeConfig.enabled ? 'bg-indigo-900/20' : ''}`} 
                onClick={() => setIsCollapsed(!isCollapsed)}
            >
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
                    <div className="flex items-center bg-slate-950/80 rounded border border-slate-700/80 p-0.5" title="大行情发现运行模式：自动运行 / 手动点击运行">
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

                    {/* 单币扫描间隔时间按钮 (默认3秒) */}
                    <div 
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 hover:border-indigo-500/60 text-[9px] text-slate-300 cursor-pointer transition-colors"
                        title="点击调整每个币扫描间隔时间(秒)"
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
                                value={activeConfig.intervalSeconds ?? (activeConfig.intervalMinutes ? Math.min(activeConfig.intervalMinutes, 60) : 3)}
                                onChange={(e) => {
                                    const val = Math.max(1, parseInt(e.target.value) || 1);
                                    updateField('intervalSeconds', val);
                                }}
                                onBlur={() => setIsEditingInterval(false)}
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                                className="w-8 bg-slate-950 text-white font-mono text-center text-[9px] outline-none border-b border-indigo-500"
                            />
                        ) : (
                            <span className="font-mono font-bold text-indigo-300">
                                ({activeConfig.intervalSeconds ?? (activeConfig.intervalMinutes ? Math.min(activeConfig.intervalMinutes, 60) : 3)})秒
                            </span>
                        )}
                    </div>

                    {/* 3组多空联动开关 */}
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            updateField('syncDirectionLock', !isSyncLocked);
                        }}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[8.5px] font-bold border transition-colors ${
                            isSyncLocked
                                ? 'bg-indigo-950/80 border-indigo-500/80 text-indigo-300 shadow-sm'
                                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                        }`}
                        title="3组过滤多空自动联动：行情启动趋势、横盘蓄势过滤、回溯周期过滤任意一项点击多/空，三个过滤全自动同步！"
                    >
                        {isSyncLocked ? <Link2 size={10} className="text-indigo-400" /> : <Unlink size={10} className="text-slate-500" />}
                        <span>{isSyncLocked ? '3组联动' : '独立多空'}</span>
                    </button>

                    {/* Integrated Switch */}
                    <button 
                        onClick={toggleEnabled}
                        title={activeConfig.enabled ? "点击关闭大行情发现" : "点击开启大行情发现"}
                        className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors duration-200 focus:outline-none ${activeConfig.enabled ? 'bg-indigo-600' : 'bg-slate-700'}`}
                    >
                        <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform duration-200 ${activeConfig.enabled ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
                    </button>

                    {/* Collapse Button */}
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsCollapsed(!isCollapsed);
                        }}
                        className="text-slate-400 hover:text-white p-0.5 transition-colors focus:outline-none"
                        title={isCollapsed ? "展开大行情发现" : "折叠大行情发现"}
                    >
                        {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                    </button>
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

                    {/* Stage 1: Sideways Filter (横盘蓄势过滤 - 多组支持 + OR/AND 组合) */}
                    <div className="bg-black/20 p-2 rounded border border-slate-800/50 space-y-2">
                        {/* Header Row */}
                        <div className="flex items-center justify-between pb-1 border-b border-slate-800/60">
                            <div className="flex items-center gap-2">
                                <span className="text-[9.5px] font-bold text-slate-300 uppercase tracking-wider">
                                    Stage 1: 横盘蓄势过滤
                                </span>
                                <span className="text-[7.5px] text-slate-500">
                                    (读取行情启动底池数据)
                                </span>
                                {activeConfig.enableSideways && (
                                    <span className="text-[8px] font-mono text-cyan-400 bg-cyan-950/60 border border-cyan-800/50 px-1.5 py-0.2 rounded whitespace-nowrap">
                                        {rawSidewaysGroups.filter(g => g.enabled !== false).length} 组生效
                                    </span>
                                )}
                            </div>
                            <button 
                                type="button"
                                onClick={() => updateField('enableSideways', !activeConfig.enableSideways)}
                                className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors duration-200 focus:outline-none shrink-0 ${activeConfig.enableSideways ? 'bg-indigo-600' : 'bg-slate-700'}`}
                                title={activeConfig.enableSideways ? "关闭横盘蓄势过滤" : "开启横盘蓄势过滤"}
                            >
                                <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform duration-200 ${activeConfig.enableSideways ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
                            </button>
                        </div>

                        {activeConfig.enableSideways ? (
                            <div className="space-y-2">
                                {/* Direction & Logic Mode Control Bar */}
                                <div className="flex items-center justify-between bg-slate-950/40 px-2 py-1.5 rounded border border-slate-800/40">
                                    {/* Direction Switches */}
                                    <div className="flex items-center gap-3">
                                        <span className="text-[8.5px] font-bold text-slate-400 uppercase tracking-tight">方向开关</span>
                                        <div className="flex items-center gap-3">
                                            {/* Long Switch */}
                                            <div 
                                                className="flex items-center gap-1.5 cursor-pointer select-none"
                                                onClick={() => toggleLong('SIDEWAYS')}
                                                title="横盘蓄势过滤 - 做多筛选开关"
                                            >
                                                <button 
                                                    type="button"
                                                    className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors duration-200 focus:outline-none ${activeConfig.enableSidewaysLong !== false ? 'bg-emerald-600' : 'bg-slate-700'}`}
                                                >
                                                    <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform duration-200 ${activeConfig.enableSidewaysLong !== false ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
                                                </button>
                                                <span className={`text-[9px] font-bold ${activeConfig.enableSidewaysLong !== false ? 'text-emerald-400' : 'text-slate-500'}`}>
                                                    多 (Long)
                                                </span>
                                            </div>

                                            {/* Short Switch */}
                                            <div 
                                                className="flex items-center gap-1.5 cursor-pointer select-none"
                                                onClick={() => toggleShort('SIDEWAYS')}
                                                title="横盘蓄势过滤 - 做空筛选开关"
                                            >
                                                <button 
                                                    type="button"
                                                    className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors duration-200 focus:outline-none ${activeConfig.enableSidewaysShort !== false ? 'bg-rose-600' : 'bg-slate-700'}`}
                                                >
                                                    <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform duration-200 ${activeConfig.enableSidewaysShort !== false ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
                                                </button>
                                                <span className={`text-[9px] font-bold ${activeConfig.enableSidewaysShort !== false ? 'text-rose-400' : 'text-slate-500'}`}>
                                                    空 (Short)
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Multi-group Combination Logic */}
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[8px] text-slate-500 font-medium">多组逻辑:</span>
                                        <div className="flex items-center bg-slate-950 rounded border border-slate-700/80 p-0.5" title="多组横盘规则组合方式：'或'满足任一组入选，'且'必须全部满足共振">
                                            <button
                                                type="button"
                                                onClick={() => updateField('sidewaysLogic', 'OR')}
                                                className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-colors ${activeConfig.sidewaysLogic !== 'AND' ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                                            >
                                                或 (OR)
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => updateField('sidewaysLogic', 'AND')}
                                                className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-colors ${activeConfig.sidewaysLogic === 'AND' ? 'bg-amber-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                                            >
                                                且 (AND)
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Rule Groups List */}
                                <div className="space-y-1.5">
                                    {rawSidewaysGroups.map((group, gIdx) => {
                                        const isGroupActive = group.enabled !== false;
                                        return (
                                            <div 
                                                key={group.id || `group_${gIdx}`} 
                                                className={`p-1.5 rounded border transition-colors ${isGroupActive ? 'bg-slate-900/60 border-slate-800' : 'bg-slate-950/30 border-slate-900 opacity-60'}`}
                                            >
                                                {/* Group Header */}
                                                <div className="flex items-center justify-between pb-1 mb-1 border-b border-slate-800/40">
                                                    <div className="flex items-center gap-1.5">
                                                        <input 
                                                            type="checkbox"
                                                            checked={isGroupActive}
                                                            onChange={e => updateSidewaysGroup(gIdx, { enabled: e.target.checked })}
                                                            className="w-3 h-3 rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer"
                                                        />
                                                        <span className="text-[9px] font-bold text-slate-200">
                                                            横盘规则组 {gIdx + 1}
                                                        </span>
                                                        <span className="text-[7.5px] text-slate-500 font-mono">
                                                            (多/空独立横盘振幅监测)
                                                        </span>
                                                    </div>
                                                    {rawSidewaysGroups.length > 1 && (
                                                        <button 
                                                            type="button"
                                                            onClick={() => removeSidewaysGroup(gIdx)}
                                                            className="text-slate-500 hover:text-rose-400 p-0.5 rounded transition-colors"
                                                            title="删除该规则组"
                                                        >
                                                            <Trash2 size={10} />
                                                        </button>
                                                    )}
                                                </div>

                                                {/* Independent Long & Short Setting Blocks */}
                                                {isGroupActive ? (
                                                    <div className="space-y-1.5 pt-0.5">
                                                        {/* 做多横盘设置 */}
                                                        {activeConfig.enableSidewaysLong !== false && (
                                                            <div className="flex items-center gap-2 text-[9px] bg-black/30 p-1.5 rounded border border-emerald-900/30">
                                                                <span className="text-emerald-400 font-bold shrink-0 w-[54px] flex items-center gap-1">
                                                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                                                    做多横盘:
                                                                </span>
                                                                <div className="flex items-center gap-1 bg-slate-950/80 px-1.5 py-0.5 rounded border border-slate-800">
                                                                    <span className="text-slate-500 text-[8px]">观察周期</span>
                                                                    <SmartNumberInput 
                                                                        value={group.daysLong ?? group.days} 
                                                                        onChange={v => updateSidewaysGroup(gIdx, { daysLong: v, days: v })}
                                                                        className="w-7 bg-transparent text-center outline-none text-indigo-400 font-bold font-mono"
                                                                    />
                                                                    <span className="text-slate-500 text-[8px]">天</span>
                                                                </div>
                                                                <div className="flex items-center gap-1 bg-slate-950/80 px-1.5 py-0.5 rounded border border-slate-800">
                                                                    <span className="text-slate-500 text-[8px]">跌幅 ≤</span>
                                                                    <SmartNumberInput 
                                                                        value={group.maxDropLong ?? group.maxDrop} 
                                                                        onChange={v => updateSidewaysGroup(gIdx, { maxDropLong: v, maxDrop: v })}
                                                                        className="w-7 bg-transparent text-center outline-none text-rose-400 font-bold font-mono"
                                                                    />
                                                                    <span className="text-slate-500 text-[8px]">%</span>
                                                                </div>
                                                                <div className="flex items-center gap-1 bg-slate-950/80 px-1.5 py-0.5 rounded border border-slate-800">
                                                                    <span className="text-slate-500 text-[8px]">涨幅 ≤</span>
                                                                    <SmartNumberInput 
                                                                        value={group.maxPumpLong ?? group.maxPump} 
                                                                        onChange={v => updateSidewaysGroup(gIdx, { maxPumpLong: v, maxPump: v })}
                                                                        className="w-7 bg-transparent text-center outline-none text-emerald-400 font-bold font-mono"
                                                                    />
                                                                    <span className="text-slate-500 text-[8px]">%</span>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* 做空横盘设置 */}
                                                        {activeConfig.enableSidewaysShort !== false && (
                                                            <div className="flex items-center gap-2 text-[9px] bg-black/30 p-1.5 rounded border border-rose-900/30">
                                                                <span className="text-rose-400 font-bold shrink-0 w-[54px] flex items-center gap-1">
                                                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                                                                    做空横盘:
                                                                </span>
                                                                <div className="flex items-center gap-1 bg-slate-950/80 px-1.5 py-0.5 rounded border border-slate-800">
                                                                    <span className="text-slate-500 text-[8px]">观察周期</span>
                                                                    <SmartNumberInput 
                                                                        value={group.daysShort ?? group.days} 
                                                                        onChange={v => updateSidewaysGroup(gIdx, { daysShort: v })}
                                                                        className="w-7 bg-transparent text-center outline-none text-indigo-400 font-bold font-mono"
                                                                    />
                                                                    <span className="text-slate-500 text-[8px]">天</span>
                                                                </div>
                                                                <div className="flex items-center gap-1 bg-slate-950/80 px-1.5 py-0.5 rounded border border-slate-800">
                                                                    <span className="text-slate-500 text-[8px]">跌幅 ≤</span>
                                                                    <SmartNumberInput 
                                                                        value={group.maxDropShort ?? group.maxDrop} 
                                                                        onChange={v => updateSidewaysGroup(gIdx, { maxDropShort: v })}
                                                                        className="w-7 bg-transparent text-center outline-none text-rose-400 font-bold font-mono"
                                                                    />
                                                                    <span className="text-slate-500 text-[8px]">%</span>
                                                                </div>
                                                                <div className="flex items-center gap-1 bg-slate-950/80 px-1.5 py-0.5 rounded border border-slate-800">
                                                                    <span className="text-slate-500 text-[8px]">涨幅 ≤</span>
                                                                    <SmartNumberInput 
                                                                        value={group.maxPumpShort ?? group.maxPump} 
                                                                        onChange={v => updateSidewaysGroup(gIdx, { maxPumpShort: v })}
                                                                        className="w-7 bg-transparent text-center outline-none text-emerald-400 font-bold font-mono"
                                                                    />
                                                                    <span className="text-slate-500 text-[8px]">%</span>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {activeConfig.enableSidewaysLong === false && activeConfig.enableSidewaysShort === false && (
                                                            <div className="text-[8.5px] text-slate-500 italic py-1 text-center bg-black/20 rounded border border-dashed border-slate-800">
                                                                横盘蓄势多/空方向未开启（请在上方开启做多或做空）
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div className="text-[8.5px] text-slate-600 italic py-0.5 text-center">
                                                        横盘规则组 {gIdx + 1} 处于停用状态
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Actions & Help Tip */}
                                <div className="flex items-center justify-between pt-1 border-t border-slate-800/40 text-[8px]">
                                    {rawSidewaysGroups.length < 5 ? (
                                        <button
                                            type="button"
                                            onClick={addSidewaysGroup}
                                            className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-semibold transition-colors bg-cyan-950/40 hover:bg-cyan-900/40 px-2 py-0.5 rounded border border-cyan-800/40"
                                        >
                                            <Plus size={10} /> 添加横盘规则组 ({rawSidewaysGroups.length}/5)
                                        </button>
                                    ) : (
                                        <span className="text-slate-500">已达规则组上限 (5组)</span>
                                    )}

                                    <span className="text-slate-500 italic">
                                        {activeConfig.sidewaysLogic === 'AND' 
                                            ? '🔗 且(AND)模式：必须全部满足开启的规则组（多周期共振）' 
                                            : '🎯 或(OR)模式：满足任意一组开启的规则即可入选'}
                                    </span>
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
                            <div className="flex items-center gap-2">
                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Stage 2: 回溯周期过滤 (读取横盘蓄势底池 -&gt; 市场初筛)</span>
                                <button 
                                    type="button"
                                    onClick={() => updateField('enableLookbackFilter', activeConfig.enableLookbackFilter !== false ? false : true)}
                                    className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors duration-200 focus:outline-none ${activeConfig.enableLookbackFilter !== false ? 'bg-indigo-600' : 'bg-slate-700'}`}
                                    title="开启/关闭 回溯周期过滤"
                                >
                                    <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform duration-200 ${activeConfig.enableLookbackFilter !== false ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
                                </button>
                            </div>
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
                                <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => toggleLong('LOOKBACK')}>
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
                                <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => toggleShort('LOOKBACK')}>
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

                            {/* Step 1: Sideways Filter (横盘蓄势过滤) */}
                            <div className="flex items-center justify-between py-0.5 border-t border-slate-900/40 pt-1 text-[9px]">
                                <div className="flex items-center gap-1">
                                    {majorProgress.stage === 'group1' ? (
                                        <Loader2 size={10} className="text-indigo-400 animate-spin shrink-0" />
                                    ) : (majorProgress.stage === 'group2' || majorProgress.stage === 'completed') ? (
                                        <CheckCircle2 size={10} className="text-emerald-400 shrink-0" />
                                    ) : (
                                        <span className="w-1.5 h-1.5 rounded-full bg-slate-800 shrink-0 inline-block ml-[2px]" />
                                    )}
                                    <span className={majorProgress.stage === 'group1' ? 'text-indigo-300 font-bold' : (majorProgress.stage === 'group2' || majorProgress.stage === 'completed') ? 'text-slate-400' : 'text-slate-500'}>
                                        第一组: 横盘蓄势过滤
                                    </span>
                                </div>
                                <div className="font-mono text-right shrink-0">
                                    {majorProgress.stage === 'group1' ? (
                                        <span className="text-indigo-300 font-bold">
                                            <span className="text-slate-400" title="扫描待测总数">{majorProgress.group1Total ?? majorProgress.total ?? 0}</span>
                                            <span className="text-slate-600 mx-1">/</span>
                                            <span className="text-indigo-300 font-bold" title="当前筛选进度">{majorProgress.group1Current ?? majorProgress.current ?? 0}</span>
                                            <span className="text-slate-600 mx-1">/</span>
                                            <span className="text-emerald-400 font-bold" title="已符合横盘蓄势规则个数">{majorProgress.group1Passed || 0}</span>
                                        </span>
                                    ) : (majorProgress.stage === 'group2' || majorProgress.stage === 'completed') ? (
                                        <span className="text-emerald-400 font-bold">
                                            <span className="text-slate-400" title="扫描待测总数">{majorProgress.group1Total ?? majorProgress.total ?? 0}</span>
                                            <span className="text-slate-600 mx-1">/</span>
                                            <span className="text-slate-400" title="全部已筛选完成">{majorProgress.group1Total ?? majorProgress.total ?? 0}</span>
                                            <span className="text-slate-600 mx-1">/</span>
                                            <span className="text-emerald-400 font-bold" title="已符合横盘蓄势规则个数">{majorProgress.group1Passed || 0}</span>
                                        </span>
                                    ) : (
                                        <span className="text-slate-600">⏳ 等待中</span>
                                    )}
                                </div>
                            </div>

                            {/* Step 2: Lookback Space Filter (回溯周期过滤 - 扫描横盘蓄势底池) */}
                            <div className="flex items-center justify-between py-0.5 border-t border-slate-900/40 pt-1 text-[9px]">
                                <div className="flex items-center gap-1">
                                    {majorProgress.stage === 'group2' ? (
                                        <Loader2 size={10} className="text-indigo-400 animate-spin shrink-0" />
                                    ) : majorProgress.stage === 'completed' ? (
                                        <CheckCircle2 size={10} className="text-emerald-400 shrink-0" />
                                    ) : (
                                        <span className="w-1.5 h-1.5 rounded-full bg-slate-800 shrink-0 inline-block ml-[2px]" />
                                    )}
                                    <span className={majorProgress.stage === 'group2' ? 'text-indigo-300 font-bold' : majorProgress.stage === 'completed' ? 'text-slate-400' : 'text-slate-500'}>
                                        第二组: 回溯周期过滤 (横盘蓄势底池)
                                    </span>
                                </div>
                                <div className="font-mono text-right shrink-0">
                                    {majorProgress.stage === 'group2' ? (
                                        <span className="text-indigo-300 font-bold">
                                            <span className="text-slate-400" title="横盘蓄势底池总数">{majorProgress.group2Total ?? majorProgress.group1Passed ?? 0}</span>
                                            <span className="text-slate-600 mx-1">/</span>
                                            <span className="text-indigo-300 font-bold" title="当前回溯筛选进度">{majorProgress.group2Current ?? majorProgress.current ?? 0}</span>
                                            <span className="text-slate-600 mx-1">/</span>
                                            <span className="text-emerald-400 font-bold" title="已符合回溯周期规则个数">{majorProgress.group2Passed || 0}</span>
                                        </span>
                                    ) : majorProgress.stage === 'completed' ? (
                                        <span className="text-emerald-400 font-bold">
                                            <span className="text-slate-400" title="横盘蓄势底池总数">{majorProgress.group2Total ?? majorProgress.group1Passed ?? 0}</span>
                                            <span className="text-slate-600 mx-1">/</span>
                                            <span className="text-slate-400" title="全部已筛选完成">{majorProgress.group2Total ?? majorProgress.group1Passed ?? 0}</span>
                                            <span className="text-slate-600 mx-1">/</span>
                                            <span className="text-emerald-400 font-bold" title="已符合回溯周期规则个数">{majorProgress.group2Passed || 0}</span>
                                        </span>
                                    ) : majorProgress.stage === 'group1' ? (
                                        <span className="text-slate-500 font-mono text-[8.5px]">
                                            <span>{majorProgress.group1Passed || 0}</span>
                                            <span className="text-slate-600 mx-1">/</span>
                                            <span className="text-slate-600">0</span>
                                            <span className="text-slate-600 mx-1">/</span>
                                            <span className="text-slate-600">0</span>
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
