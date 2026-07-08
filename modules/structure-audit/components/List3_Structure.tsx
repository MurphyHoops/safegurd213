import React, { useMemo, useEffect, useRef, useState } from "react";
import {
  Loader2,
  Search,
  Activity,
  Eye,
  ShieldCheck,
  Maximize2,
  Trash2,
  History,
} from "lucide-react";
import {
  List3Config,
  ScannerItem,
  ActionConfig,
  COLUMN_WIDTH_CLASS,
  StructureScanStatus,
} from "../../../components/Scanner/scannerTypes";
import { PositionSide, Position } from "../../../types";
import { List3Control } from "./Control";
import { List3Item } from "./Item";
import { ScannerVisualizerModal } from "../../../components/ScannerVisualizerModal";
import { ScannerHistoryModal, useAutoHistoryLogger } from "../../momentum-audit/components/ScannerHistoryModal";

interface Props {
  config: List3Config;
  setConfig: React.Dispatch<React.SetStateAction<List3Config>>;
  countdowns: Record<string, string>;
  list3: ScannerItem[];
  setChartData: (data: any) => void;
  executeTradeSafe: (
    symbol: string,
    side: PositionSide,
    price: number,
    reason: string,
    signalTf?: string,
    signalCandle?: any,
    entryEmas?: any,
  ) => boolean;
  actionConfig: ActionConfig;
  scanningStatus: StructureScanStatus | null;
  activePositions: Position[];
  onRemoveItem: (symbol: string) => void;
  onClearItems: () => void;
}

const List3_Structure: React.FC<Props> = ({
  config,
  setConfig,
  countdowns,
  list3,
  setChartData,
  executeTradeSafe,
  actionConfig,
  scanningStatus,
  activePositions,
  onRemoveItem,
  onClearItems,
}) => {
  // Auto History Logger for List 3 (Structure Audit)
  useAutoHistoryLogger('LIST3', list3 || [], activePositions || []);

  const [showVisualizer, setShowVisualizer] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // --- DYNAMIC FILTERING LOGIC ---
  const filteredList = useMemo(() => {
    if (!list3) return [];
    return list3
      .map((item) => {
        // Defensive Check: Ensure item and list3Results exist
        if (!item || !item.list3Results) return null;

        let validResults = item.list3Results?.filter((r) => r.latched) || [];

        // 1. Minimum Results Check
        if (validResults.length === 0) return null;

        // 2. Multi-Resonance Filtering (Adjacent Strict Trend)
        if (config.enableMultiResonance && item.adjacentStrictTrends) {
          const ALL_TFS = [
            "1m",
            "3m",
            "5m",
            "15m",
            "30m",
            "1h",
            "2h",
            "4h",
            "8h",
            "1d",
          ];
          validResults = validResults.filter((vr) => {
            const idx = ALL_TFS.indexOf(vr.tf);
            if (idx === -1) return true; // Fallback if tf not found

            const prevTf = idx > 0 ? ALL_TFS[idx - 1] : null;
            const nextTf = idx < ALL_TFS.length - 1 ? ALL_TFS[idx + 1] : null;

            const dir = vr.direction;
            const prevOk = prevTf
              ? item.adjacentStrictTrends![`${prevTf}-${dir}`]
              : false;
            const nextOk = nextTf
              ? item.adjacentStrictTrends![`${nextTf}-${dir}`]
              : false;

            return prevOk || nextOk;
          });
          if (validResults.length === 0) return null;
        }

        return { ...item, list3Results: validResults };
      })
      .filter(Boolean) as ScannerItem[];
  }, [list3]);

  // --- AUTO EXECUTE LOGIC ---
  const executedRef = useRef<Set<string>>(new Set());
  const activePositionsRef = useRef(activePositions);
  const executeTradeSafeRef = useRef(executeTradeSafe);

  useEffect(() => { activePositionsRef.current = activePositions; }, [activePositions]);
  useEffect(() => { executeTradeSafeRef.current = executeTradeSafe; }, [executeTradeSafe]);

  useEffect(() => {
    const isMasterAutoOn = actionConfig?.autoExecute;

    if (!config.autoSimOpen) {
      return;
    }

    if (!isMasterAutoOn) {
      // If master auto is off but L3 auto is ON, warn via console to assist debugging
      if (filteredList.length > 0) {
        console.log(
          `[List3 Auto] Master switch (List 6) is OFF. Auto execution skipped.`,
        );
      }
      return;
    }

    if (filteredList.length > 0) {
      console.log(
        `[List3 Auto] Checking ${filteredList.length} items for potential execution...`,
      );
    }

    filteredList.forEach((item) => {
      if (!item.list3Results) return;

      item.list3Results.forEach((res) => {
        const side =
          res.direction === "LONG" ? PositionSide.LONG : PositionSide.SHORT;
        const uniqueId = `${item.symbol}-${side}-${res.tf}-${res.structure.signalTime || 0}`;

        // Check 1: Have we already executed this specific signal in this session?
        const alreadyExecutedSession = executedRef.current.has(uniqueId);

        // Check 2: Do we ALREADY have an open position for this symbol + direction?
        const alreadyHasPosition = activePositionsRef.current.some(
          (p) => p.symbol === item.symbol && p.side === side,
        );

        if (!alreadyExecutedSession && !alreadyHasPosition) {
          console.log(
            `[List3 Auto] Triggering executeTradeSafe for ${uniqueId} @ ${item.price}`,
          );

          const success = (executeTradeSafeRef.current as any)(
            item.symbol,
            side,
            item.price,
            `Auto L3 Structure (${res.tf})`,
            res.tf,
          );

          if (success) {
            executedRef.current.add(uniqueId);
          } else {
            console.log(
              `[List3 Auto] Trade execution blocked by master risk controls for ${uniqueId}`,
            );
          }
        } else if (alreadyHasPosition) {
          // Position already open, skip silently in logs to avoid noise
        }
      });
    });
  }, [filteredList, config.autoSimOpen, actionConfig?.autoExecute]);

  // Active Rules for Display (IDLE State)
  const activeRules = useMemo(() => {
    if (!config) return "Loading...";
    const rules = [];
    if (config.strictTrend) rules.push("Strict Trend");
    if (config.enableMultiResonance)
      rules.push(`Resonance(min:${config.minResonanceCount})`);
    if (config.enableAmplitudeAudit) rules.push("Amplitude");
    if (config.checkCandleColor) rules.push("Color");
    return rules.length > 0 ? rules.join(" | ") : "Standard Audit";
  }, [config]);

  return (
    <div
      className={`flex flex-col h-full bg-slate-900 border-r border-slate-800 ${COLUMN_WIDTH_CLASS}`}
    >
      <List3Control
        config={config}
        setConfig={setConfig}
        countdowns={countdowns}
      />

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
                {Math.round(
                  (scanningStatus.current / (scanningStatus.total || 1)) * 100,
                )}
                %
              </span>
            </div>

            <div className="h-1 bg-indigo-900/50 rounded-full overflow-hidden mb-1.5 relative z-10">
              <div
                className="h-full bg-indigo-500 transition-all duration-300 ease-out"
                style={{
                  width: `${(scanningStatus.current / (scanningStatus.total || 1)) * 100}%`,
                }}
              />
            </div>

            <div className="flex flex-col gap-0.5 relative z-10">
              <div className="flex justify-between items-center text-[9px] text-slate-400">
                <span className="italic opacity-80">
                  {scanningStatus.currentAction || "Initializing..."}
                </span>
                <div className="flex gap-1 overflow-hidden max-w-[80px]">
                  {(scanningStatus.symbols || [])
                    .slice(scanningStatus.current, scanningStatus.current + 2)
                    .map((s, idx) => (
                      <span
                        key={`${s}-${idx}`}
                        className="font-mono text-white"
                      >
                        {s.replace("USDT", "")}
                      </span>
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
        <div className="flex items-center gap-2">
          <div className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
            <Activity size={12} /> 3. 爆发结构
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClearItems();
              }}
              className="flex items-center gap-1.5 px-2 py-1 bg-red-900/20 hover:bg-red-900/40 rounded border border-red-500/30 text-red-400 transition-all text-[10px] font-bold mr-1"
              title="清空审计列表"
            >
              <Trash2 size={12} />
              <span>清空</span>
            </button>
            <button
              onClick={() => setShowHistory(true)}
              className="flex items-center gap-1.5 px-2 py-1 bg-slate-800 hover:bg-emerald-900/50 rounded border border-emerald-500/30 text-emerald-500 transition-all text-[10px] font-bold mr-1"
              title="查看历史记录"
            >
              <History size={12} />
              <span>历史</span>
            </button>
            <button
              onClick={() => setShowVisualizer(true)}
              className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-indigo-400 transition-all border border-transparent hover:border-indigo-500/30"
              title="放大查看 K 线大图"
            >
              <Maximize2 size={12} />
            </button>
          </div>
        </div>
        <div className="text-xs font-mono font-bold text-white">
          {filteredList.length}
        </div>
      </div>

      {showVisualizer && (
        <ScannerVisualizerModal
          title="3. 爆发结构"
          items={filteredList.map((i) => ({
            symbol: i.symbol,
            timeframe: i.tf,
          }))}
          defaultTf="15m"
          onClose={() => setShowVisualizer(false)}
        />
      )}
      {showHistory && (
        <ScannerHistoryModal listType="LIST3" setChartData={setChartData} onClose={() => setShowHistory(false)} />
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar bg-slate-950/20">
        {filteredList.length === 0 && !scanningStatus && (
          <div className="flex flex-col items-center justify-center h-24 opacity-30 text-slate-500">
            <Search size={24} className="mb-1" />
            <span className="text-[10px]">等待符合条件的信号...</span>
          </div>
        )}
        {filteredList.map((item, idx) => (
          <List3Item
            key={`${item.symbol}-${idx}`}
            item={item}
            results={item.list3Results}
            setChartData={setChartData}
            executeTradeSafe={executeTradeSafe}
            onRemove={() => onRemoveItem(item.symbol)}
          />
        ))}
      </div>
    </div>
  );
};

export default List3_Structure;
