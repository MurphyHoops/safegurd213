// LOCKED
// Rule Lock: The core logic for List 4 Advanced Filter UI is now locked.
// Any modifications to this UI must be authorized by a special directive.

import React, { useState } from "react";
import {
  Flame,
  Zap,
  Target,
  ShieldCheck,
  Info,
  Hourglass,
  Rocket,
  ChevronRight,
  CircleDot,
  History,
} from "lucide-react";
import { List4Config } from "../../../components/Scanner/scannerTypes";
import { RulesModal } from "./RulesModal";
import { ScannerHistoryModal } from "./ScannerHistoryModal";

interface List4PanelProps {
  config: List4Config;
  setConfig: React.Dispatch<React.SetStateAction<List4Config>>;
}

export const List4Control: React.FC<List4PanelProps> = ({
  config,
  setConfig,
}) => {
  const [showRules, setShowRules] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isAntiChaseCollapsed, setIsAntiChaseCollapsed] = useState(true);
  const [isAutoDirGuardCollapsed, setIsAutoDirGuardCollapsed] = useState(true);
  const [isAdvancedFilterCollapsed, setIsAdvancedFilterCollapsed] = useState(true);
  const [isAutoRemoveCollapsed, setIsAutoRemoveCollapsed] = useState(true);

  const setAntiChase = (field: string, val: number) => {
    setConfig((p) => ({
      ...p,
      antiChaseConfig: { ...p.antiChaseConfig, [field]: val },
    }));
  };

  const setAutoDir = (field: string, val: number) => {
    setConfig((p) => {
      const current = p.autoDirConfig || {
        limit1Q: 0,
        limit1M: 0,
        limit1W: 0,
        limit1D: 0,
        limit1H: 0
      };
      return {
        ...p,
        autoDirConfig: { ...current, [field]: val },
      };
    });
  };

  const setAdvancedFilterGroup = (groupId: number, field: string, val: any) => {
    setConfig((p) => {
      const groups = p.advancedFilterGroups ? [...p.advancedFilterGroups] : [];
      for (let i = 1; i <= 5; i++) {
        if (!groups.some(g => g.id === i)) {
          if (i === 1) {
            groups.push({
              id: 1,
              enabled: p.enableAdvancedFilter ?? false,
              filterTimeParam: p.advancedFilterConfig?.filterTimeParam ?? 300,
              filterKLinePeriod: p.advancedFilterConfig?.filterKLinePeriod ?? '1d',
              filterEmaPeriod: p.advancedFilterConfig?.filterEmaPeriod ?? 80,
              filterCrossingCount: p.advancedFilterConfig?.filterCrossingCount ?? 3,
              filterLongMaxPump: p.advancedFilterConfig?.filterLongMaxPump ?? 5,
              filterShortMinDrop: p.advancedFilterConfig?.filterShortMinDrop ?? -5,
            });
          } else {
            groups.push({
              id: i,
              enabled: false,
              filterTimeParam: 300,
              filterKLinePeriod: '1d',
              filterEmaPeriod: 80,
              filterCrossingCount: 3,
              filterLongMaxPump: 5,
              filterShortMinDrop: -5,
            });
          }
        }
      }
      const targetIdx = groups.findIndex(g => g.id === groupId);
      if (targetIdx !== -1) {
        groups[targetIdx] = { ...groups[targetIdx], [field]: val };
      }
      return {
        ...p,
        advancedFilterGroups: groups,
        advancedFilterConfig: groupId === 1 ? {
          filterTimeParam: groups[0].filterTimeParam,
          filterKLinePeriod: groups[0].filterKLinePeriod as any,
          filterEmaPeriod: groups[0].filterEmaPeriod,
          filterCrossingCount: groups[0].filterCrossingCount,
          filterLongMaxPump: groups[0].filterLongMaxPump,
          filterShortMinDrop: groups[0].filterShortMinDrop,
        } : p.advancedFilterConfig
      };
    });
  };

  const toggleGroupEnabled = (groupId: number) => {
    setConfig((p) => {
      const groups = p.advancedFilterGroups ? [...p.advancedFilterGroups] : [];
      for (let i = 1; i <= 5; i++) {
        if (!groups.some(g => g.id === i)) {
          groups.push({
            id: i,
            enabled: i === 1 ? (p.enableAdvancedFilter ?? false) : false,
            filterTimeParam: i === 1 ? (p.advancedFilterConfig?.filterTimeParam ?? 300) : 300,
            filterKLinePeriod: i === 1 ? (p.advancedFilterConfig?.filterKLinePeriod ?? '1d') : '1d',
            filterEmaPeriod: i === 1 ? (p.advancedFilterConfig?.filterEmaPeriod ?? 80) : 80,
            filterCrossingCount: i === 1 ? (p.advancedFilterConfig?.filterCrossingCount ?? 3) : 3,
            filterLongMaxPump: i === 1 ? (p.advancedFilterConfig?.filterLongMaxPump ?? 5) : 5,
            filterShortMinDrop: i === 1 ? (p.advancedFilterConfig?.filterShortMinDrop ?? -5) : -5,
          });
        }
      }
      const targetIdx = groups.findIndex(g => g.id === groupId);
      if (targetIdx !== -1) {
        groups[targetIdx].enabled = !groups[targetIdx].enabled;
      }
      const anyEnabled = groups.some(g => g.enabled);
      return {
        ...p,
        enableAdvancedFilter: anyEnabled,
        advancedFilterGroups: groups
      };
    });
  };

  const activeGroups = Array.from({ length: 5 }, (_, index) => {
    const groupId = index + 1;
    const existingGroup = config.advancedFilterGroups?.find((g) => g.id === groupId);
    if (existingGroup) return existingGroup;
    if (groupId === 1) {
      return {
        id: 1,
        enabled: config.enableAdvancedFilter ?? false,
        filterTimeParam: config.advancedFilterConfig?.filterTimeParam ?? 300,
        filterKLinePeriod: config.advancedFilterConfig?.filterKLinePeriod ?? '1d',
        filterEmaPeriod: config.advancedFilterConfig?.filterEmaPeriod ?? 80,
        filterCrossingCount: config.advancedFilterConfig?.filterCrossingCount ?? 3,
        filterLongMaxPump: config.advancedFilterConfig?.filterLongMaxPump ?? 5,
        filterShortMinDrop: config.advancedFilterConfig?.filterShortMinDrop ?? -5,
      };
    }
    return {
      id: groupId,
      enabled: false,
      filterTimeParam: 300,
      filterKLinePeriod: '1d' as const,
      filterEmaPeriod: 80,
      filterCrossingCount: 3,
      filterLongMaxPump: 5,
      filterShortMinDrop: -5,
    };
  });

  const periodPresets = [
    { label: "5m", val: 5 },
    { label: "1h", val: 60 },
    { label: "4h", val: 240 },
    { label: "1天", val: 1440 },
    { label: "1周", val: 10080 },
    { label: "1月", val: 43200 },
    { label: "1季", val: 129600 },
  ];

  return (
    <div className="p-3 bg-slate-900 border-b border-slate-800 space-y-2 shrink-0 relative overflow-y-auto max-h-[500px] custom-scrollbar">
      <div className="flex items-center justify-between">
        <div className="font-bold text-amber-500 text-sm flex items-center gap-2">
          <Flame size={14} /> 4. 动能审计 (MOMENTUM)
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowRules(true)}
            className="text-slate-500 hover:text-amber-400 transition-colors"
            title="查看防守线规则"
          >
            <Info size={12} />
          </button>
        </div>
      </div>

      {/* Rules & History Modals */}
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}

      <div className="space-y-2">
        <div className="flex items-center justify-between bg-amber-900/30 px-3 py-2 rounded border border-amber-500/40 shadow-sm">
          <div className="flex items-center gap-1.5 text-amber-300 font-bold text-[11px]">
            <Zap size={14} className="text-amber-400 fill-amber-400/20" />
            离弦之箭：自动执行开仓
          </div>
          <div
            onClick={() =>
              setConfig((p) => ({ ...p, autoExecute: !p.autoExecute }))
            }
            className={`w-9 h-4.5 rounded-full p-0.5 transition-colors cursor-pointer ${config.autoExecute ? "bg-amber-500" : "bg-slate-700"}`}
          >
            <div
              className={`w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${config.autoExecute ? "translate-x-[18px]" : "translate-x-0"}`}
            />
          </div>
        </div>

        <div className="flex bg-slate-800 rounded p-1 border border-slate-700">
          {["LONG", "BOTH", "SHORT"].map((mode) => (
            <button
              key={mode}
              onClick={() =>
                setConfig((p) => ({ ...p, directionFilter: mode as any }))
              }
              className={`flex-1 py-1 text-[9px] font-bold rounded transition-colors ${
                config.directionFilter === mode
                  ? mode === "LONG"
                    ? "bg-emerald-600 text-white"
                    : mode === "SHORT"
                      ? "bg-red-600 text-white"
                      : "bg-amber-600 text-white"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {mode === "BOTH" ? "双向" : mode === "LONG" ? "仅做多" : "仅做空"}
            </button>
          ))}
        </div>

        {/* Threshold Logic & Retention */}
        <div
          className={`space-y-1 ${config.enableThresholds ? "" : "opacity-60"}`}
        >
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-1">
              <Target size={10} /> 阈值限制 (Thresholds)
            </span>
            <div
              onClick={() =>
                setConfig((p) => ({
                  ...p,
                  enableThresholds: !p.enableThresholds,
                }))
              }
              className={`w-7 h-3.5 rounded-full p-0.5 transition-colors cursor-pointer ${config.enableThresholds ? "bg-indigo-500" : "bg-slate-700"}`}
            >
              <div
                className={`w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${config.enableThresholds ? "translate-x-3.5" : "translate-x-0"}`}
              />
            </div>
          </div>

          <div
            className={`grid grid-cols-2 gap-2 ${config.enableThresholds ? "" : "pointer-events-none"}`}
          >
            <div className="bg-slate-800 p-2 rounded border border-slate-700 flex flex-col gap-1">
              <span className="text-[9px] text-slate-500 font-bold uppercase">
                中轴防守线
              </span>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[8px] text-slate-600">% Amp</span>
                <input
                  type="number"
                  value={
                    config.midlineThreshold === undefined ||
                    Number.isNaN(config.midlineThreshold)
                      ? ""
                      : config.midlineThreshold
                  }
                  onChange={(e) =>
                    setConfig((p) => ({
                      ...p,
                      midlineThreshold: parseFloat(e.target.value),
                    }))
                  }
                  className="w-12 bg-slate-900 border border-slate-700 rounded text-center text-[10px] text-emerald-400 font-bold outline-none"
                />
              </div>
            </div>
            <div className="bg-slate-800 p-2 rounded border border-slate-700 flex flex-col gap-1">
              <span className="text-[9px] text-slate-500 font-bold uppercase">
                进攻突破线
              </span>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[8px] text-slate-600">% Amp</span>
                <input
                  type="number"
                  value={
                    config.breakoutThreshold === undefined ||
                    Number.isNaN(config.breakoutThreshold)
                      ? ""
                      : config.breakoutThreshold
                  }
                  onChange={(e) =>
                    setConfig((p) => ({
                      ...p,
                      breakoutThreshold: parseFloat(e.target.value),
                    }))
                  }
                  className="w-12 bg-slate-900 border border-slate-700 rounded text-center text-[10px] text-amber-400 font-bold outline-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* NEW: Independent Momentum Conditions (3K & 7K) */}
        <div className="grid grid-cols-2 gap-2 py-1">
          <div className="bg-slate-800 p-1.5 rounded border border-slate-700 flex items-center justify-between">
            <span className="text-[8px] text-slate-400 font-bold">
              逆势三连K拦截
            </span>
            <div
              onClick={() =>
                setConfig((p) => ({ ...p, enableRev3K: !p.enableRev3K }))
              }
              className={`w-6 h-3 rounded-full p-0.5 transition-colors cursor-pointer ${config.enableRev3K ? "bg-red-500" : "bg-slate-700"}`}
            >
              <div
                className={`w-2 h-2 bg-white rounded-full shadow transition-transform ${config.enableRev3K ? "translate-x-3" : "translate-x-0"}`}
              />
            </div>
          </div>

          <div className="bg-slate-800 p-1.5 rounded border border-slate-700 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Rocket
                size={10}
                className={
                  config.enableThrust ? "text-orange-400" : "text-slate-500"
                }
              />
              <span className="text-[8px] text-slate-400 font-bold">
                7K爆发推进
              </span>
            </div>
            <div
              onClick={() =>
                setConfig((p) => ({ ...p, enableThrust: !p.enableThrust }))
              }
              className={`w-6 h-3 rounded-full p-0.5 transition-colors cursor-pointer ${config.enableThrust ? "bg-orange-500" : "bg-slate-700"}`}
            >
              <div
                className={`w-2 h-2 bg-white rounded-full shadow transition-transform ${config.enableThrust ? "translate-x-3" : "translate-x-0"}`}
              />
            </div>
          </div>
        </div>

        {/* Anti-Chase Fuse - Collapsible with Time Settings */}
        <div className={`space-y-1 pt-1 border-t border-slate-800/50`}>
          <div
            className="flex items-center justify-between px-1 cursor-pointer hover:bg-slate-800/30 rounded py-1 transition-colors"
            onClick={() => setIsAntiChaseCollapsed(!isAntiChaseCollapsed)}
          >
            <span className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-1">
              <ShieldCheck
                size={10}
                className={config.enableAntiChase ? "text-red-400" : ""}
              />{" "}
              4. 防追高熔断 (Anti-Chase)
              <ChevronRight
                size={10}
                className={`transition-transform duration-200 ${!isAntiChaseCollapsed ? "rotate-90" : ""}`}
              />
            </span>
            <div
              onClick={(e) => {
                e.stopPropagation();
                setConfig((p) => ({
                  ...p,
                  enableAntiChase: !p.enableAntiChase,
                }));
              }}
              className={`w-7 h-3.5 rounded-full p-0.5 transition-colors cursor-pointer ${config.enableAntiChase ? "bg-red-600" : "bg-slate-700"}`}
            >
              <div
                className={`w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${config.enableAntiChase ? "translate-x-3.5" : "translate-x-0"}`}
              />
            </div>
          </div>

          {!isAntiChaseCollapsed && (
            <div
              className={`space-y-3 pt-2 animate-in slide-in-from-top-1 duration-200 max-h-[320px] overflow-y-auto pr-1.5 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent ${config.enableAntiChase ? "opacity-100" : "opacity-40 pointer-events-none"}`}
            >
              <div className="bg-slate-800/50 p-2 rounded border border-slate-700/50 space-y-2">
                <div className="text-[9px] font-bold text-emerald-500/80 uppercase flex items-center gap-1.5 bg-emerald-500/5 py-0.5 rounded px-1 w-fit">
                  做多锁定限制 (禁止追高)
                </div>
                <div className="space-y-1">
                    {[
                        { label: "1季度", hours: 2160 },
                        { label: "1月", hours: 720 },
                        { label: "1周", hours: 168 },
                        { label: "1天", hours: 24 },
                        { label: "1小时", hours: 1 },
                    ].map((p) => (
                        <div key={p.hours} className="grid grid-cols-2 gap-2 items-center bg-slate-900 p-1.5 rounded border border-slate-700">
                            <span className="text-[10px] text-slate-300">{p.label}</span>
                            <input
                                type="number"
                                value={config.antiChaseConfig.longThresholds[p.hours.toString()] || 0}
                                onChange={(e) => {
                                    const val = parseFloat(e.target.value) || 0;
                                    setConfig(c => ({...c, antiChaseConfig: {...c.antiChaseConfig, longThresholds: {...c.antiChaseConfig.longThresholds, [p.hours]: val}}}));
                                }}
                                className="w-full bg-slate-800 border border-slate-700 rounded text-[10px] text-white font-bold outline-none py-1 px-2 text-right"
                            />
                        </div>
                    ))}
                </div>
              </div>

              <div className="bg-slate-800/50 p-2 rounded border border-slate-700/50 space-y-2 mt-2">
                <div className="text-[9px] font-bold text-red-500/80 uppercase flex items-center gap-1.5 bg-red-500/5 py-0.5 rounded px-1 w-fit">
                  做空锁定限制 (禁止追跌)
                </div>
                <div className="space-y-1">
                    {[
                        { label: "1季度", hours: 2160 },
                        { label: "1月", hours: 720 },
                        { label: "1周", hours: 168 },
                        { label: "1天", hours: 24 },
                        { label: "1小时", hours: 1 },
                    ].map((p) => (
                        <div key={p.hours} className="grid grid-cols-2 gap-2 items-center bg-slate-900 p-1.5 rounded border border-slate-700">
                            <span className="text-[10px] text-slate-300">{p.label}</span>
                            <input
                                type="number"
                                value={config.antiChaseConfig.shortThresholds[p.hours.toString()] || 0}
                                onChange={(e) => {
                                    const val = parseFloat(e.target.value) || 0;
                                    setConfig(c => ({...c, antiChaseConfig: {...c.antiChaseConfig, shortThresholds: {...c.antiChaseConfig.shortThresholds, [p.hours]: val}}}));
                                }}
                                className="w-full bg-slate-800 border border-slate-700 rounded text-[10px] text-white font-bold outline-none py-1 px-2 text-right"
                            />
                        </div>
                    ))}
                </div>
              </div>
            </div>
          )}
        </div>

                {/* NEW: Auto Direction Guard Section */}
        <div className="space-y-1 pt-1 border-t border-slate-800/50">
          <div
            className="flex items-center justify-between px-1 cursor-pointer hover:bg-slate-800/30 rounded py-1 transition-colors"
            onClick={() => setIsAutoDirGuardCollapsed(!isAutoDirGuardCollapsed)}
          >
            <span className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-1">
              <CircleDot
                size={10}
                className={config.enableAutoDirGuard ? "text-amber-400" : ""}
              />{" "}
              4. 动态方向锁 (Dir Guard)
              <ChevronRight
                size={10}
                className={`transition-transform duration-200 ${!isAutoDirGuardCollapsed ? "rotate-90" : ""}`}
              />
            </span>
            <div
              onClick={(e) => {
                e.stopPropagation();
                setConfig((p) => ({
                  ...p,
                  enableAutoDirGuard: !p.enableAutoDirGuard,
                }));
              }}
              className={`w-7 h-3.5 rounded-full p-0.5 transition-colors cursor-pointer ${config.enableAutoDirGuard ? "bg-amber-600" : "bg-slate-700"}`}
            >
              <div
                className={`w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${config.enableAutoDirGuard ? "translate-x-3.5" : "translate-[0px]"}`}
              />
            </div>
          </div>

          {!isAutoDirGuardCollapsed && (
            <div
              className={`space-y-3 pt-2 animate-in slide-in-from-top-1 duration-200 max-h-[320px] overflow-y-auto pr-1.5 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent ${config.enableAutoDirGuard ? "opacity-100" : "opacity-40 pointer-events-none"}`}
            >
              <div className="space-y-2 border-l-2 border-emerald-500/30 pl-2">
                <div className="text-[8px] font-bold text-emerald-500/80 uppercase flex items-center gap-1.5 bg-emerald-500/5 py-0.5 rounded px-1 w-fit">
                  做多锁定限制 (禁止追高)
                </div>
                {['1Q', '1M', '1W', '1D', '1H'].map((period) => {
                  const pField = `limit${period}` as any;
                  const currentDist = config.autoDirConfig?.[pField] ?? 0;

                  return (
                    <div
                      key={period}
                      className="bg-slate-800/50 p-2 rounded border border-slate-700/50 flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px] text-slate-400 font-bold">{period === '1Q' ? '1季度' : period === '1M' ? '1月' : period === '1W' ? '1周' : period === '1D' ? '1天' : '1小时'}</span>
                        <input
                            type="number"
                            value={currentDist}
                            onChange={(e) => setAutoDir(pField, parseFloat(e.target.value) || 0)}
                            className="w-16 bg-slate-900 border border-slate-700 rounded text-center text-[9px] text-white font-bold outline-none py-0.5"
                            placeholder="限制 %"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2 border-l-2 border-red-500/30 pl-2 mt-2">
                <div className="text-[8px] font-bold text-red-500/80 uppercase flex items-center gap-1.5 bg-red-500/5 py-0.5 rounded px-1 w-fit">
                  做空锁定限制 (禁止追跌)
                </div>
                {['1Q', '1M', '1W', '1D', '1H'].map((period) => {
                  const pField = `limit${period}` as any;
                  const currentDist = config.autoDirConfig?.[pField] ?? 0;

                  return (
                    <div
                      key={period}
                      className="bg-slate-800/50 p-2 rounded border border-slate-700/50 flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px] text-slate-400 font-bold">{period === '1Q' ? '1季度' : period === '1M' ? '1月' : period === '1W' ? '1周' : period === '1D' ? '1天' : '1小时'}</span>
                        <input
                            type="number"
                            value={currentDist}
                            onChange={(e) => setAutoDir(pField, parseFloat(e.target.value) || 0)}
                            className="w-16 bg-slate-900 border border-slate-700 rounded text-center text-[9px] text-white font-bold outline-none py-0.5"
                            placeholder="限制 %"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 4. Advanced Filtering Section */}
        <div className="space-y-1 pt-1 border-t border-slate-800/50">
          <div
            className="flex items-center justify-between px-1 cursor-pointer hover:bg-slate-800/30 rounded py-1 transition-colors"
            onClick={() => setIsAdvancedFilterCollapsed(!isAdvancedFilterCollapsed)}
          >
            <span className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-1">
              <Target
                size={10}
                className={config.enableAdvancedFilter ? "text-indigo-400" : ""}
              />{" "}
              4. 高级过滤 (Advanced Filter)
              <ChevronRight
                size={10}
                className={`transition-transform duration-200 ${!isAdvancedFilterCollapsed ? "rotate-90" : ""}`}
              />
            </span>
            <div
              onClick={(e) => {
                e.stopPropagation();
                setConfig((p) => {
                  const newEnabled = !p.enableAdvancedFilter;
                  const groups = p.advancedFilterGroups ? [...p.advancedFilterGroups] : [];
                  for (let i = 1; i <= 5; i++) {
                    if (!groups.some(g => g.id === i)) {
                      groups.push({
                        id: i,
                        enabled: i === 1 ? newEnabled : false,
                        filterTimeParam: i === 1 ? (p.advancedFilterConfig?.filterTimeParam ?? 300) : 300,
                        filterKLinePeriod: i === 1 ? (p.advancedFilterConfig?.filterKLinePeriod ?? '1d') : '1d',
                        filterEmaPeriod: i === 1 ? (p.advancedFilterConfig?.filterEmaPeriod ?? 80) : 80,
                        filterCrossingCount: i === 1 ? (p.advancedFilterConfig?.filterCrossingCount ?? 3) : 3,
                        filterLongMaxPump: i === 1 ? (p.advancedFilterConfig?.filterLongMaxPump ?? 5) : 5,
                        filterShortMinDrop: i === 1 ? (p.advancedFilterConfig?.filterShortMinDrop ?? -5) : -5,
                      });
                    } else if (i === 1) {
                      groups.find(g => g.id === 1)!.enabled = newEnabled;
                    }
                  }
                  return {
                    ...p,
                    enableAdvancedFilter: newEnabled,
                    advancedFilterGroups: groups
                  };
                });
              }}
              className={`w-7 h-3.5 rounded-full p-0.5 transition-colors cursor-pointer ${config.enableAdvancedFilter ? "bg-indigo-600" : "bg-slate-700"}`}
            >
              <div
                className={`w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${config.enableAdvancedFilter ? "translate-x-3.5" : "translate-[0px]"}`}
              />
            </div>
          </div>

          {!isAdvancedFilterCollapsed && (
            <div className={`space-y-2 pt-2 animate-in slide-in-from-top-1 duration-200 ${config.enableAdvancedFilter ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
              {activeGroups.map((group) => (
                <div key={group.id} className="bg-black/20 p-2 rounded border border-slate-800/50 space-y-1.5">
                  <div className="flex items-center justify-between border-b border-slate-800/30 pb-1">
                    <span className="text-[9px] text-slate-300 font-bold flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${group.enabled ? 'bg-indigo-400 animate-pulse' : 'bg-slate-600'}`}></span>
                      高级过滤限制 - 第 {group.id} 组
                    </span>
                    <div
                      onClick={() => toggleGroupEnabled(group.id)}
                      className={`w-7 h-3.5 rounded-full p-0.5 transition-colors cursor-pointer ${group.enabled ? "bg-indigo-600" : "bg-slate-700"}`}
                    >
                      <div
                        className={`w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${group.enabled ? "translate-x-3.5" : "translate-[0px]"}`}
                      />
                    </div>
                  </div>

                  {group.enabled && (
                    <div className="space-y-1.5 pt-1">
                      <div className="grid grid-cols-3 gap-1">
                        <div className="bg-slate-800/60 p-1 rounded">
                          <span className="text-[7px] text-slate-500 uppercase">K线数量</span>
                          <input
                            type="number"
                            value={group.filterTimeParam}
                            onChange={e => setAdvancedFilterGroup(group.id, 'filterTimeParam', parseInt(e.target.value) || 0)}
                            className="w-full bg-slate-900 text-white text-[9px] text-center outline-none rounded mt-0.5"
                          />
                        </div>
                        <div className="bg-slate-800/60 p-1 rounded">
                          <span className="text-[7px] text-slate-500 uppercase">K线周期</span>
                          <select
                            value={group.filterKLinePeriod}
                            onChange={e => setAdvancedFilterGroup(group.id, 'filterKLinePeriod', e.target.value)}
                            className="w-full bg-slate-900 text-white text-[9px] outline-none rounded mt-0.5 py-0.5"
                          >
                            <option value="1h">1h (小时)</option>
                            <option value="4h">4h (4小时)</option>
                            <option value="1d">1d (天)</option>
                            <option value="1w">1w (周)</option>
                            <option value="1M">1M (月)</option>
                            <option value="1Q">1Q (季)</option>
                          </select>
                        </div>
                        <div className="bg-slate-800/60 p-1 rounded">
                          <span className="text-[7px] text-slate-500 uppercase">EMA基线</span>
                          <select
                            value={group.filterEmaPeriod}
                            onChange={e => setAdvancedFilterGroup(group.id, 'filterEmaPeriod', parseInt(e.target.value))}
                            className="w-full bg-slate-900 text-white text-[9px] outline-none rounded mt-0.5 py-0.5"
                          >
                            {[10, 20, 30, 40, 80, 100, 120, 200].map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                      </div>
                      
                      <div className="bg-slate-800/60 p-1 rounded">
                        <span className="text-[7px] text-slate-400 uppercase font-semibold">EMA 相交次数上限限制 (Max Intersections)</span>
                        <input
                          type="number"
                          value={group.filterCrossingCount}
                          onChange={e => setAdvancedFilterGroup(group.id, 'filterCrossingCount', parseInt(e.target.value) || 0)}
                          className="w-full bg-slate-900 text-white text-[9px] text-center outline-none rounded mt-0.5"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-1">
                        <div className="bg-slate-800/60 p-1 rounded">
                          <span className="text-[7px] text-emerald-400 uppercase">多头涨幅限制 &lt; %</span>
                          <input
                            type="number"
                            value={group.filterLongMaxPump}
                            onChange={e => setAdvancedFilterGroup(group.id, 'filterLongMaxPump', parseFloat(e.target.value) || 0)}
                            className="w-full bg-slate-900 text-white text-[9px] text-center outline-none rounded mt-0.5"
                          />
                        </div>
                        <div className="bg-slate-800/60 p-1 rounded">
                          <span className="text-[7px] text-rose-400 uppercase">空头跌幅限制 &gt; %</span>
                          <input
                            type="number"
                            value={group.filterShortMinDrop}
                            onChange={e => setAdvancedFilterGroup(group.id, 'filterShortMinDrop', parseFloat(e.target.value) || 0)}
                            className="w-full bg-slate-900 text-white text-[9px] text-center outline-none rounded mt-0.5"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Auto Remove Settings */}
        <div className="space-y-1 pt-1 border-t border-slate-800/50">
          <div
            className="flex items-center justify-between px-1 mb-1 cursor-pointer hover:bg-slate-800/50 rounded"
            onClick={() => setIsAutoRemoveCollapsed(!isAutoRemoveCollapsed)}
          >
            <span className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-1">
              <Hourglass size={10} /> 自动清理 (Auto Remove)
            </span>
            <ChevronRight
              size={12}
              className={`text-slate-500 transition-transform ${!isAutoRemoveCollapsed ? "rotate-90" : ""}`}
            />
          </div>

          <div
            className={`transition-all duration-300 overflow-hidden ${isAutoRemoveCollapsed ? "max-h-0 opacity-0" : "max-h-[500px] opacity-100"}`}
          >
            <div className="grid grid-cols-2 gap-2 mt-1">
              <div className="bg-slate-800 p-1.5 rounded border border-slate-700 flex flex-col gap-1">
                <span className="text-[8px] text-slate-500 font-bold">
                  高级过滤拦截后按分钟
                </span>
                <div className="flex items-center justify-between gap-1">
                  <input
                    type="number"
                    min="0"
                    value={
                      Number.isNaN(config.autoClearAdvancedFilterMinutes)
                        ? ""
                        : config.autoClearAdvancedFilterMinutes || 0
                    }
                    onChange={(e) =>
                      setConfig((p) => ({
                        ...p,
                        autoClearAdvancedFilterMinutes: parseInt(e.target.value) || 0,
                      }))
                    }
                    className="w-10 bg-slate-900 border border-slate-700 rounded text-center text-[10px] text-indigo-400 font-bold outline-none"
                  />
                  <span className="text-[8px] text-slate-600">分钟</span>
                </div>
              </div>
              <div className="bg-slate-800 p-1.5 rounded border border-slate-700 flex flex-col gap-1">
                <span className="text-[8px] text-slate-500 font-bold">
                  结构破坏后按分钟
                </span>
                <div className="flex items-center justify-between gap-1">
                  <input
                    type="number"
                    min="0"
                    value={
                      Number.isNaN(config.removeInvalidMinutes)
                        ? ""
                        : config.removeInvalidMinutes || 0
                    }
                    onChange={(e) =>
                      setConfig((p) => ({
                        ...p,
                        removeInvalidMinutes: parseInt(e.target.value) || 0,
                      }))
                    }
                    className="w-10 bg-slate-900 border border-slate-700 rounded text-center text-[10px] text-red-500 font-bold outline-none"
                  />
                  <span className="text-[8px] text-slate-600">分钟</span>
                </div>
              </div>
              <div className="bg-slate-800 p-1.5 rounded border border-slate-700 flex flex-col gap-1">
                <span className="text-[8px] text-slate-500 font-bold">
                  已触发突破后按分钟
                </span>
                <div className="flex items-center justify-between gap-1">
                  <input
                    type="number"
                    min="0"
                    value={
                      Number.isNaN(config.removeTriggeredMinutes)
                        ? ""
                        : config.removeTriggeredMinutes || 0
                    }
                    onChange={(e) =>
                      setConfig((p) => ({
                        ...p,
                        removeTriggeredMinutes: parseInt(e.target.value) || 0,
                      }))
                    }
                    className="w-10 bg-slate-900 border border-slate-700 rounded text-center text-[10px] text-yellow-500 font-bold outline-none"
                  />
                  <span className="text-[8px] text-slate-600">分钟</span>
                </div>
              </div>
              <div className="bg-slate-800 p-1.5 rounded border border-slate-700 flex flex-col gap-1">
                <span className="text-[8px] text-slate-500 font-bold">
                  熔断拦截后按分钟
                </span>
                <div className="flex items-center justify-between gap-1">
                  <input
                    type="number"
                    min="0"
                    value={
                      Number.isNaN(config.removeFuseMinutes)
                        ? ""
                        : config.removeFuseMinutes || 0
                    }
                    onChange={(e) =>
                      setConfig((p) => ({
                        ...p,
                        removeFuseMinutes: parseInt(e.target.value) || 0,
                      }))
                    }
                    className="w-10 bg-slate-900 border border-slate-700 rounded text-center text-[10px] text-orange-500 font-bold outline-none"
                  />
                  <span className="text-[8px] text-slate-600">分钟</span>
                </div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <div className="bg-slate-800 p-1.5 rounded border border-slate-700 flex flex-col gap-1">
              <span className="text-[8px] text-slate-500 font-bold">
                结构破坏后按K线
              </span>
              <div className="flex items-center justify-between gap-1">
                <input
                  type="number"
                  min="0"
                  value={
                    Number.isNaN(config.removeInvalidCandles)
                      ? ""
                      : config.removeInvalidCandles || 0
                  }
                  onChange={(e) =>
                    setConfig((p) => ({
                      ...p,
                      removeInvalidCandles: parseInt(e.target.value) || 0,
                    }))
                  }
                  className="w-10 bg-slate-900 border border-slate-700 rounded text-center text-[10px] text-red-400 font-bold outline-none"
                />
                <span className="text-[8px] text-slate-600">根K线</span>
              </div>
            </div>
            <div className="bg-slate-800 p-1.5 rounded border border-slate-700 flex flex-col gap-1">
              <span className="text-[8px] text-slate-500 font-bold">
                已开仓后按K线
              </span>
              <div className="flex items-center justify-between gap-1">
                <input
                  type="number"
                  min="0"
                  value={
                    Number.isNaN(config.removeTradedCandles)
                      ? ""
                      : config.removeTradedCandles || 0
                  }
                  onChange={(e) =>
                    setConfig((p) => ({
                      ...p,
                      removeTradedCandles: parseInt(e.target.value) || 0,
                    }))
                  }
                  className="w-10 bg-slate-900 border border-slate-700 rounded text-center text-[10px] text-emerald-400 font-bold outline-none"
                />
                <span className="text-[8px] text-slate-600">根K线</span>
              </div>
            </div>
          </div>
          <div className="text-[8px] text-slate-600 px-1 text-center mt-1">
            * 设为 0 表示不自动消除
          </div>
        </div>
      </div>
    </div>
  );
};
