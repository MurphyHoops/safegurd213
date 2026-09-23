import React, { useState } from 'react';
import { MajorTrendConfig, StartTrendGroup } from '../../../components/Scanner/scannerTypes';
import { SmartNumberInput } from '../../../components/Scanner/ScannerUIHelpers';
import { TrendingUp, ChevronDown, ChevronUp, Link2, Unlink } from 'lucide-react';
import { usePersistedState } from '../../../hooks/usePersistedState';

interface Props {
    config?: MajorTrendConfig;
    setConfig: (config: MajorTrendConfig) => void;
}

const DEFAULT_GROUPS: StartTrendGroup[] = [
    { enabled: true, days: 1, minLong: 1, maxLong: 9, maxPullbackLong: 5, minShort: 1, maxShort: 9, maxPullbackShort: 5 },
    { enabled: false, days: 2, minLong: 1, maxLong: 9, maxPullbackLong: 5, minShort: 1, maxShort: 9, maxPullbackShort: 5 },
    { enabled: false, days: 3, minLong: 2, maxLong: 20, maxPullbackLong: 8, minShort: 2, maxShort: 20, maxPullbackShort: 8 },
    { enabled: false, days: 7, minLong: 4, maxLong: 30, maxPullbackLong: 10, minShort: 4, maxShort: 30, maxPullbackShort: 10 }
];

export const StartTrendSection: React.FC<Props> = ({ config, setConfig }) => {
    const [isCollapsed, setIsCollapsed] = usePersistedState<boolean>('SCANNER_START_TREND_SECTION_COLLAPSED', false);

    const activeConfig: MajorTrendConfig = {
        enabled: true,
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
        enableSidewaysLong: true,
        enableSidewaysShort: true,
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
        startTrendGroups: DEFAULT_GROUPS,
        ...config
    };

    const isSyncLocked = activeConfig.syncDirectionLock !== false;

    const updateField = (field: keyof MajorTrendConfig, value: any) => {
        setConfig({ ...activeConfig, [field]: value });
    };

    const rawGroups = activeConfig.startTrendGroups && activeConfig.startTrendGroups.length > 0 
        ? activeConfig.startTrendGroups 
        : DEFAULT_GROUPS;

    const groups = rawGroups;

    const ensureActiveGroups = (groupsList: StartTrendGroup[]) => {
        if (!groupsList || groupsList.length === 0) return DEFAULT_GROUPS;
        if (!groupsList.some(g => g.enabled)) {
            return groupsList.map((g, idx) => idx === 0 ? { ...g, enabled: true } : g);
        }
        return groupsList;
    };

    const isAnyActive = activeConfig.enableStartTrendLong || activeConfig.enableStartTrendShort;

    const toggleLongDirection = () => {
        const newVal = !activeConfig.enableStartTrendLong;
        const updatedGroups = newVal ? ensureActiveGroups(groups) : groups;
        
        if (isSyncLocked) {
            // 🔗 联动模式：三大过滤（行情启动、横盘蓄势、回溯周期）全域自动同步多头方向
            setConfig({
                ...activeConfig,
                enableStartTrendLong: newVal,
                enableStartTrend: newVal || !!activeConfig.enableStartTrendShort,
                enableSidewaysLong: newVal,
                enableSideways: newVal || (activeConfig.enableSidewaysShort !== false),
                enableLong: newVal,
                enableLookbackFilter: newVal || (activeConfig.enableShort !== false),
                startTrendGroups: updatedGroups
            });
        } else {
            // 独立模式
            setConfig({
                ...activeConfig,
                enableStartTrendLong: newVal,
                enableStartTrend: newVal || !!activeConfig.enableStartTrendShort,
                startTrendGroups: updatedGroups
            });
        }
    };

    const toggleShortDirection = () => {
        const newVal = !activeConfig.enableStartTrendShort;
        const updatedGroups = newVal ? ensureActiveGroups(groups) : groups;
        
        if (isSyncLocked) {
            // 🔗 联动模式：三大过滤（行情启动、横盘蓄势、回溯周期）全域自动同步空头方向
            setConfig({
                ...activeConfig,
                enableStartTrendShort: newVal,
                enableStartTrend: !!activeConfig.enableStartTrendLong || newVal,
                enableSidewaysShort: newVal,
                enableSideways: (activeConfig.enableSidewaysLong !== false) || newVal,
                enableShort: newVal,
                enableLookbackFilter: (activeConfig.enableLong !== false) || newVal,
                startTrendGroups: updatedGroups
            });
        } else {
            // 独立模式
            setConfig({
                ...activeConfig,
                enableStartTrendShort: newVal,
                enableStartTrend: !!activeConfig.enableStartTrendLong || newVal,
                startTrendGroups: updatedGroups
            });
        }
    };

    const handleQuickDirection = (mode: 'LONG_ONLY' | 'SHORT_ONLY' | 'BOTH') => {
        const updatedGroups = ensureActiveGroups(groups);
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
                enableLookbackFilter: true,
                startTrendGroups: updatedGroups
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
                enableLookbackFilter: true,
                startTrendGroups: updatedGroups
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
                enableLookbackFilter: true,
                startTrendGroups: updatedGroups
            });
        }
    };

    return (
        <div className="border border-slate-700/80 rounded-lg bg-[#151922] overflow-hidden shadow-sm transition-all duration-200">
            {/* Header with Title, Multi-direction Switches, Sync Toggle and Collapse Toggle */}
            <div 
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="p-2 bg-slate-800/60 hover:bg-slate-800/90 flex items-center justify-between cursor-pointer transition-colors select-none"
            >
                <div className="flex items-center gap-2">
                    <div className={`p-1 rounded ${isAnyActive ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'bg-slate-800 text-slate-500 border border-slate-700'}`}>
                        <TrendingUp size={13} />
                    </div>
                    <div>
                        <div className="text-[10px] font-bold text-white tracking-wide flex items-center gap-1.5">
                            行情启动趋势
                            {isAnyActive && <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />}
                        </div>
                        <div className="text-[8px] text-slate-400">
                            多/空独立：做多限制指定周期涨幅，做空限制跌幅与回撤
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                    {/* Direction Sync Lock Button */}
                    <button
                        type="button"
                        onClick={() => updateField('syncDirectionLock', !isSyncLocked)}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold border transition-colors ${
                            isSyncLocked 
                                ? 'bg-indigo-950/80 text-indigo-300 border-indigo-500/50 hover:bg-indigo-900/80' 
                                : 'bg-slate-900/80 text-slate-400 border-slate-700 hover:text-slate-200'
                        }`}
                        title={isSyncLocked ? '已开启多空联动：在任一过滤点击选多/选空，三大过滤自动同步' : '已解除联动：各过滤多空方向独立设置'}
                    >
                        {isSyncLocked ? <Link2 size={10} className="text-indigo-400 shrink-0" /> : <Unlink size={10} className="text-slate-500 shrink-0" />}
                        <span>{isSyncLocked ? '3组联动' : '独立'}</span>
                    </button>

                    {/* Long Toggle Switch */}
                    <div className="flex items-center gap-1 bg-slate-950/60 px-1.5 py-0.5 rounded border border-slate-800/80">
                        <span className="text-[8px] font-bold text-emerald-400">做多</span>
                        <button 
                            type="button"
                            onClick={toggleLongDirection}
                            className={`relative inline-flex h-3.5 w-7 items-center rounded-full transition-colors duration-200 focus:outline-none ${activeConfig.enableStartTrendLong ? 'bg-emerald-600' : 'bg-slate-700'}`}
                            title={isSyncLocked ? '点击切换做多（三大过滤自动同步）' : '点击切换行情启动趋势做多'}
                        >
                            <span className={`inline-block h-2 w-2 transform rounded-full bg-white transition-transform duration-200 ${activeConfig.enableStartTrendLong ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
                        </button>
                    </div>

                    {/* Short Toggle Switch */}
                    <div className="flex items-center gap-1 bg-slate-950/60 px-1.5 py-0.5 rounded border border-slate-800/80">
                        <span className="text-[8px] font-bold text-rose-400">做空</span>
                        <button 
                            type="button"
                            onClick={toggleShortDirection}
                            className={`relative inline-flex h-3.5 w-7 items-center rounded-full transition-colors duration-200 focus:outline-none ${activeConfig.enableStartTrendShort ? 'bg-rose-600' : 'bg-slate-700'}`}
                            title={isSyncLocked ? '点击切换做空（三大过滤自动同步）' : '点击切换行情启动趋势做空'}
                        >
                            <span className={`inline-block h-2 w-2 transform rounded-full bg-white transition-transform duration-200 ${activeConfig.enableStartTrendShort ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
                        </button>
                    </div>

                    {/* Collapse Button */}
                    <button
                        type="button"
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        className="text-slate-400 hover:text-white p-0.5 transition-colors"
                    >
                        {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                    </button>
                </div>
            </div>

            {/* Expandable Group Content */}
            {!isCollapsed && (
                <div className="p-2 space-y-2 border-t border-slate-800 bg-[#0e1219]/90 animate-in slide-in-from-top-1 duration-200">
                    {/* Quick Sync Direction Selector */}
                    <div className="flex items-center justify-between pb-1 border-b border-slate-800/50 text-[8px]">
                        <span className="text-slate-400 flex items-center gap-1">
                            快捷多空预设:
                            {isSyncLocked && <span className="text-indigo-400 font-mono">(全域同步中)</span>}
                        </span>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={() => handleQuickDirection('LONG_ONLY')}
                                className={`px-1.5 py-0.2 rounded font-bold transition-colors ${
                                    activeConfig.enableStartTrendLong && !activeConfig.enableStartTrendShort 
                                        ? 'bg-emerald-600 text-white' 
                                        : 'bg-slate-900 text-slate-400 hover:text-emerald-400'
                                }`}
                            >
                                仅做多
                            </button>
                            <button
                                type="button"
                                onClick={() => handleQuickDirection('SHORT_ONLY')}
                                className={`px-1.5 py-0.2 rounded font-bold transition-colors ${
                                    !activeConfig.enableStartTrendLong && activeConfig.enableStartTrendShort 
                                        ? 'bg-rose-600 text-white' 
                                        : 'bg-slate-900 text-slate-400 hover:text-rose-400'
                                }`}
                            >
                                仅做空
                            </button>
                            <button
                                type="button"
                                onClick={() => handleQuickDirection('BOTH')}
                                className={`px-1.5 py-0.2 rounded font-bold transition-colors ${
                                    activeConfig.enableStartTrendLong && activeConfig.enableStartTrendShort 
                                        ? 'bg-cyan-600 text-white' 
                                        : 'bg-slate-900 text-slate-400 hover:text-cyan-400'
                                }`}
                            >
                                多空双选
                            </button>
                        </div>
                    </div>

                    {isAnyActive ? (
                        <div className="space-y-1.5">
                            {groups.map((group, idx) => (
                                <div key={idx} className="bg-slate-900/90 border border-slate-800/90 rounded p-1.5 space-y-1">
                                    <div className="flex items-center justify-between border-b border-slate-800/60 pb-1">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[10px] font-bold text-slate-200">组合 {idx}</span>
                                            {group.enabled && (
                                                idx === 0 ? (
                                                    <div className="flex items-center gap-1 bg-slate-950/80 px-1.5 py-0.5 rounded border border-slate-800 font-mono">
                                                        <span className="text-[9px] text-indigo-400 font-bold">从今日08:00起</span>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-1 bg-slate-950/80 px-1.5 py-0.5 rounded border border-slate-800 font-mono">
                                                        <span className="text-[9px] text-slate-400">距当前</span>
                                                        <SmartNumberInput 
                                                            value={group.days !== undefined ? group.days : (idx === 1 ? 2 : (idx === 2 ? 3 : 7))} 
                                                            onChange={v => {
                                                                const updated = [...groups];
                                                                updated[idx] = { ...updated[idx], days: v };
                                                                updateField("startTrendGroups", updated);
                                                            }}
                                                            className="w-8 bg-transparent font-bold text-[10px] text-center outline-none text-indigo-400"
                                                        />
                                                        <span className="text-[9px] text-slate-400 font-bold">天</span>
                                                    </div>
                                                )
                                            )}
                                        </div>

                                        <button 
                                            type="button"
                                            onClick={() => {
                                                const updated = [...groups];
                                                updated[idx] = { ...updated[idx], enabled: !updated[idx].enabled };
                                                updateField('startTrendGroups', updated);
                                            }}
                                            className={`relative inline-flex h-3 w-6 items-center rounded-full transition-colors duration-200 focus:outline-none ${group.enabled ? 'bg-indigo-600' : 'bg-slate-700'}`}
                                        >
                                            <span className={`inline-block h-1.5 w-1.5 transform rounded-full bg-white transition-transform duration-200 ${group.enabled ? 'translate-x-[12px]' : 'translate-x-[2px]'}`} />
                                        </button>
                                    </div>

                                    {group.enabled ? (
                                        <div className="space-y-1 pt-1">
                                            {/* 做多设置 */}
                                            {activeConfig.enableStartTrendLong && (
                                                <div className="flex items-center gap-2 text-[9px]">
                                                    <span className="text-emerald-400 font-bold shrink-0 w-[42px]">做多启动:</span>
                                                    <div className="flex items-center gap-1 bg-slate-950/60 px-1.5 py-0.5 rounded border border-slate-800">
                                                        <span className="text-slate-500 text-[8.5px]">最低涨幅</span>
                                                        <SmartNumberInput 
                                                            value={group.minLong} 
                                                            onChange={v => {
                                                                const updated = [...groups];
                                                                updated[idx] = { ...updated[idx], minLong: v };
                                                                updateField('startTrendGroups', updated);
                                                            }}
                                                            className="w-7 bg-transparent text-center outline-none text-emerald-400 font-bold"
                                                        />
                                                        <span className="text-slate-600 font-mono">~</span>
                                                        <SmartNumberInput 
                                                            value={group.maxLong} 
                                                            onChange={v => {
                                                                const updated = [...groups];
                                                                updated[idx] = { ...updated[idx], maxLong: v };
                                                                updateField('startTrendGroups', updated);
                                                            }}
                                                            className="w-7 bg-transparent text-center outline-none text-emerald-400 font-bold"
                                                        />
                                                        <span className="text-[8.5px] text-slate-500 font-mono">%</span>
                                                    </div>
                                                    <div className="flex items-center gap-1 bg-slate-950/60 px-1.5 py-0.5 rounded border border-slate-800">
                                                        <span className="text-slate-500 text-[8.5px]">且回撤 &lt;</span>
                                                        <SmartNumberInput 
                                                            value={group.maxPullbackLong !== undefined ? group.maxPullbackLong : 2} 
                                                            onChange={v => {
                                                                const updated = [...groups];
                                                                updated[idx] = { ...updated[idx], maxPullbackLong: v };
                                                                updateField('startTrendGroups', updated);
                                                            }}
                                                            className="w-6 bg-transparent text-center outline-none text-emerald-400 font-bold"
                                                        />
                                                        <span className="text-[8.5px] text-slate-500 font-mono">%</span>
                                                    </div>
                                                </div>
                                            )}

                                            {/* 做空设置 */}
                                            {activeConfig.enableStartTrendShort && (
                                                <div className="flex items-center gap-2 text-[9px]">
                                                    <span className="text-rose-400 font-bold shrink-0 w-[42px]">做空启动:</span>
                                                    <div className="flex items-center gap-1 bg-slate-950/60 px-1.5 py-0.5 rounded border border-slate-800">
                                                        <span className="text-slate-500 text-[8.5px]">最高跌幅</span>
                                                        <SmartNumberInput 
                                                            value={group.minShort} 
                                                            onChange={v => {
                                                                const updated = [...groups];
                                                                updated[idx] = { ...updated[idx], minShort: v };
                                                                updateField('startTrendGroups', updated);
                                                            }}
                                                            className="w-7 bg-transparent text-center outline-none text-rose-400 font-bold"
                                                        />
                                                        <span className="text-slate-600 font-mono">~</span>
                                                        <SmartNumberInput 
                                                            value={group.maxShort} 
                                                            onChange={v => {
                                                                const updated = [...groups];
                                                                updated[idx] = { ...updated[idx], maxShort: v };
                                                                updateField('startTrendGroups', updated);
                                                            }}
                                                            className="w-7 bg-transparent text-center outline-none text-rose-400 font-bold"
                                                        />
                                                        <span className="text-[8.5px] text-slate-500 font-mono">%</span>
                                                    </div>
                                                    <div className="flex items-center gap-1 bg-slate-950/60 px-1.5 py-0.5 rounded border border-slate-800">
                                                        <span className="text-slate-500 text-[8.5px]">且回撤 &lt;</span>
                                                        <SmartNumberInput 
                                                            value={group.maxPullbackShort !== undefined ? group.maxPullbackShort : 2} 
                                                            onChange={v => {
                                                                const updated = [...groups];
                                                                updated[idx] = { ...updated[idx], maxPullbackShort: v };
                                                                updateField('startTrendGroups', updated);
                                                            }}
                                                            className="w-6 bg-transparent text-center outline-none text-rose-400 font-bold"
                                                        />
                                                        <span className="text-[8.5px] text-slate-500 font-mono">%</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="text-[9px] text-slate-600 italic py-0.5 text-center">
                                            组合 {idx} 处于停用状态
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-[8.5px] text-slate-500 italic py-2 text-center bg-black/20 rounded border border-dashed border-slate-800">
                            行情启动趋势多/空开关未开启（开启后可对交易额过滤底池中的币种进行精细趋势筛选）
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

