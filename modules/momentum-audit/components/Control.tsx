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
} from "lucide-react";
import { List4Config } from "../../../components/Scanner/scannerTypes";
import { RulesModal } from "./RulesModal";

interface List4PanelProps {
  config: List4Config;
  setConfig: React.Dispatch<React.SetStateAction<List4Config>>;
}

export const List4Control: React.FC<List4PanelProps> = ({
  config,
  setConfig,
}) => {
  const [showRules, setShowRules] = useState(false);
  const [isAntiChaseCollapsed, setIsAntiChaseCollapsed] = useState(true);
  const [isAutoDirGuardCollapsed, setIsAutoDirGuardCollapsed] = useState(true);
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
        longMaxDist1: 40, longMaxDist2: 35, longMaxDist3: 30, longMaxDist4: 25, longMaxDist5: 20, longMaxDist6: 15, longMaxDist7: 10,
        longPeriod1: 43200, longPeriod2: 10080, longPeriod3: 1440, longPeriod4: 240, longPeriod5: 60, longPeriod6: 5, longPeriod7: 1,
        shortMaxDist1: 40, shortMaxDist2: 35, shortMaxDist3: 30, shortMaxDist4: 25, shortMaxDist5: 20, shortMaxDist6: 15, shortMaxDist7: 10,
        shortPeriod1: 43200, shortPeriod2: 10080, shortPeriod3: 1440, shortPeriod4: 240, shortPeriod5: 60, shortPeriod6: 5, shortPeriod7: 1
      };
      return {
        ...p,
        autoDirConfig: { ...current, [field]: val },
      };
    });
  };

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
    <div className="p-3 bg-slate-900 border-b border-slate-800 space-y-2 shrink-0 relative">
      <div className="flex items-center justify-between">
        <div className="font-bold text-amber-500 text-sm flex items-center gap-2">
          <Flame size={14} /> 4. 动能审计 (MOMENTUM)
        </div>
        <button
          onClick={() => setShowRules(true)}
          className="text-slate-500 hover:text-amber-400 transition-colors"
          title="查看防守线规则"
        >
          <Info size={12} />
        </button>
      </div>

      {/* Rules Modal Overlay */}
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
              <div className="space-y-2 border-l-2 border-emerald-500/30 pl-2">
                <div className="text-[8px] font-bold text-emerald-500/80 uppercase flex items-center gap-1.5 bg-emerald-500/5 py-0.5 rounded px-1 w-fit">
                  做多熔断限制 (LONG)
                </div>
                {[1, 2, 3, 4, 5, 6, 7].map((idx) => {
                  const pField = `longPeriod${idx}` as keyof typeof config.antiChaseConfig;
                  const mField = `longMaxDist${idx}` as keyof typeof config.antiChaseConfig;
                  const val = config.antiChaseConfig?.[pField] ?? 0;
                  
                  return (
                    <div
                      key={idx}
                      className="bg-slate-800/50 p-2 rounded border border-slate-700/50 flex flex-col gap-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex-1 flex flex-col">
                          <span className="text-[7px] text-slate-500 uppercase">
                            时间周期 {idx}
                          </span>
                          <select
                            value={val}
                            onChange={(e) => setAntiChase(pField, parseInt(e.target.value) || 0)}
                            className="w-full bg-slate-900 border border-slate-700 rounded text-[9px] text-indigo-400 font-bold outline-none mt-0.5 py-0.5 px-1"
                          >
                            <option value={0}>禁用</option>
                            {periodPresets.slice().reverse().map(p => (
                                <option key={p.val} value={p.val}>{p.label}</option>
                            ))}
                            <option value={1}>自定义</option>
                          </select>
                          {![0, 5, 60, 240, 1440, 10080, 43200].includes(val) && val !== 0 && (
                            <input
                                type="number"
                                value={val}
                                onChange={(e) => setAntiChase(pField, parseInt(e.target.value) || 0)}
                                className="w-full bg-slate-800 border-x border-b border-slate-700 rounded-b text-center text-[8px] text-indigo-300 outline-none py-0.5"
                                placeholder="输入分钟"
                            />
                          )}
                        </div>
                        <div className="flex-1 flex flex-col">
                          <span className="text-[7px] text-slate-500 uppercase">
                            距低点阈值(%)
                          </span>
                          <input
                            type="number"
                            value={config.antiChaseConfig?.[mField] ?? 0}
                            onChange={(e) =>
                              setAntiChase(
                                mField,
                                parseFloat(e.target.value) || 0,
                              )
                            }
                            className="w-full bg-slate-900 border border-slate-700 rounded text-center text-[9px] text-white font-bold outline-none mt-0.5 py-0.5"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2 border-l-2 border-red-500/30 pl-2 mt-2">
                <div className="text-[8px] font-bold text-red-500/80 uppercase flex items-center gap-1.5 bg-red-500/5 py-0.5 rounded px-1 w-fit">
                  做空熔断限制 (SHORT)
                </div>
                {[1, 2, 3, 4, 5, 6, 7].map((idx) => {
                  const pField = `shortPeriod${idx}` as keyof typeof config.antiChaseConfig;
                  const mField = `shortMaxDist${idx}` as keyof typeof config.antiChaseConfig;
                  const val = config.antiChaseConfig?.[pField] ?? 0;
                  
                  return (
                    <div
                      key={idx}
                      className="bg-slate-800/50 p-2 rounded border border-slate-700/50 flex flex-col gap-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex-1 flex flex-col">
                          <span className="text-[7px] text-slate-500 uppercase">
                            时间周期 {idx}
                          </span>
                          <select
                            value={val}
                            onChange={(e) => setAntiChase(pField, parseInt(e.target.value) || 0)}
                            className="w-full bg-slate-900 border border-slate-700 rounded text-[9px] text-indigo-400 font-bold outline-none mt-0.5 py-0.5 px-1"
                          >
                            <option value={0}>禁用</option>
                            {periodPresets.slice().reverse().map(p => (
                                <option key={p.val} value={p.val}>{p.label}</option>
                            ))}
                            <option value={1}>自定义</option>
                          </select>
                          {![0, 5, 60, 240, 1440, 10080, 43200].includes(val) && val !== 0 && (
                            <input
                                type="number"
                                value={val}
                                onChange={(e) => setAntiChase(pField, parseInt(e.target.value) || 0)}
                                className="w-full bg-slate-800 border-x border-b border-slate-700 rounded-b text-center text-[8px] text-indigo-300 outline-none py-0.5"
                                placeholder="输入分钟"
                            />
                          )}
                        </div>
                        <div className="flex-1 flex flex-col">
                          <span className="text-[7px] text-slate-500 uppercase">
                            距高点阈值(%)
                          </span>
                          <input
                            type="number"
                            value={config.antiChaseConfig?.[mField] ?? 0}
                            onChange={(e) =>
                              setAntiChase(
                                mField,
                                parseFloat(e.target.value) || 0,
                              )
                            }
                            className="w-full bg-slate-900 border border-slate-700 rounded text-center text-[9px] text-white font-bold outline-none mt-0.5 py-0.5"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
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
                {[1, 2, 3, 4, 5, 6, 7].map((idx) => {
                  const pField = `longPeriod${idx}` as any;
                  const mField = `longMaxDist${idx}` as any;
                  const currentPeriod = config.autoDirConfig?.[pField] ?? 0;
                  const currentDist = config.autoDirConfig?.[mField] ?? 0;

                  return (
                    <div
                      key={idx}
                      className="bg-slate-800/50 p-2 rounded border border-slate-700/50 flex flex-col gap-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex-1 flex flex-col">
                          <span className="text-[7px] text-slate-500 uppercase">
                            时间周期 {idx}
                          </span>
                          <select
                            value={currentPeriod}
                            onChange={(e) => setAutoDir(pField, parseInt(e.target.value) || 0)}
                            className="w-full bg-slate-900 border border-slate-700 rounded text-[9px] text-indigo-400 font-bold outline-none mt-0.5 py-0.5 px-1"
                          >
                             <option value={0}>禁用</option>
                            {periodPresets.slice().reverse().map(p => (
                                <option key={p.val} value={p.val}>{p.label}</option>
                            ))}
                            <option value={1}>自定义</option>
                          </select>
                          {![0, 5, 60, 240, 1440, 10080, 43200].includes(currentPeriod) && currentPeriod !== 0 && (
                            <input
                                type="number"
                                value={currentPeriod}
                                onChange={(e) => setAutoDir(pField, parseInt(e.target.value) || 0)}
                                className="w-full bg-slate-800 border-x border-b border-slate-700 rounded-b text-center text-[8px] text-indigo-300 outline-none py-0.5"
                                placeholder="输入分钟"
                            />
                          )}
                        </div>
                        <div className="flex-1 flex flex-col">
                          <span className="text-[7px] text-slate-500 uppercase">
                            距低点限制(%)
                          </span>
                          <input
                            type="number"
                            value={currentDist}
                            onChange={(e) =>
                              setAutoDir(
                                mField,
                                parseFloat(e.target.value) || 0,
                              )
                            }
                            className="w-full bg-slate-900 border border-slate-700 rounded text-center text-[9px] text-white font-bold outline-none mt-0.5 py-0.5"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2 border-l-2 border-red-500/30 pl-2 mt-2">
                <div className="text-[8px] font-bold text-red-500/80 uppercase flex items-center gap-1.5 bg-red-500/5 py-0.5 rounded px-1 w-fit">
                  做空锁定限制 (禁止追跌)
                </div>
                {[1, 2, 3, 4, 5, 6, 7].map((idx) => {
                  const pField = `shortPeriod${idx}` as any;
                  const mField = `shortMaxDist${idx}` as any;
                  const currentPeriod = config.autoDirConfig?.[pField] ?? 0;
                  const currentDist = config.autoDirConfig?.[mField] ?? 0;

                  return (
                    <div
                      key={idx}
                      className="bg-slate-800/50 p-2 rounded border border-slate-700/50 flex flex-col gap-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex-1 flex flex-col">
                          <span className="text-[7px] text-slate-500 uppercase">
                            时间周期 {idx}
                          </span>
                          <select
                            value={currentPeriod}
                            onChange={(e) => setAutoDir(pField, parseInt(e.target.value) || 0)}
                            className="w-full bg-slate-900 border border-slate-700 rounded text-[9px] text-indigo-400 font-bold outline-none mt-0.5 py-0.5 px-1"
                          >
                             <option value={0}>禁用</option>
                            {periodPresets.slice().reverse().map(p => (
                                <option key={p.val} value={p.val}>{p.label}</option>
                            ))}
                            <option value={1}>自定义</option>
                          </select>
                          {![0, 5, 60, 240, 1440, 10080, 43200].includes(currentPeriod) && currentPeriod !== 0 && (
                            <input
                                type="number"
                                value={currentPeriod}
                                onChange={(e) => setAutoDir(pField, parseInt(e.target.value) || 0)}
                                className="w-full bg-slate-800 border-x border-b border-slate-700 rounded-b text-center text-[8px] text-indigo-300 outline-none py-0.5"
                                placeholder="输入分钟"
                            />
                          )}
                        </div>
                        <div className="flex-1 flex flex-col">
                          <span className="text-[7px] text-slate-500 uppercase">
                            距高点限制(%)
                          </span>
                          <input
                            type="number"
                            value={currentDist}
                            onChange={(e) =>
                              setAutoDir(
                                mField,
                                parseFloat(e.target.value) || 0,
                              )
                            }
                            className="w-full bg-slate-900 border border-slate-700 rounded text-center text-[9px] text-white font-bold outline-none mt-0.5 py-0.5"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
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
