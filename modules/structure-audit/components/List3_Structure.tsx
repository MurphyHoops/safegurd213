// 🔒 LOCKED_MODULE: LIST 3 [结构深度审计 视图展示组件]
// @LOCKED: 严格原子化单独锁定。未经用户明确的专属书面指令，严禁擅自修改、重构或变动任何功能与代码。

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
  List3SignalResult,
} from "../../../components/Scanner/scannerTypes";
import { PositionSide, Position } from "../../../types";
import { List3Control } from "./Control";
import { List3Item } from "./Item";
import { ScannerVisualizerModal } from "../../../components/ScannerVisualizerModal";
import { ScannerHistoryModal, useAutoHistoryLogger } from "../../momentum-audit/components/ScannerHistoryModal";
import { checkList3SignalPasses } from "../../../services/rules/list3_structure";
import { normalizeSymbol } from "../../../services/symbolUtils";

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
  const [showVisualizer, setShowVisualizer] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // --- DYNAMIC FILTERING LOGIC ---
  const filteredList = useMemo(() => {
    if (!list3) return [];

    // 🔒 [STRICT DE-DUPLICATION]: 绝对保证列表3每个币种只保留唯一卡片，同币种同周期绝不重复显示
    const dedupedCoinsMap = new Map<string, ScannerItem>();

    list3.forEach((item) => {
      // Defensive Check: Ensure item and list3Results exist
      if (!item || !item.symbol || !item.list3Results) return;

      const validResults = item.list3Results.filter((r) =>
        checkList3SignalPasses(r, config, item.adjacentStrictTrends)
      );

      // Minimum Results Check
      if (validResults.length === 0) return;

      // 周期去重：确保同一个币种下同一个周期绝不重复存在
      const tfMap = new Map<string, List3SignalResult>();
      validResults.forEach((r) => {
        const sigKey = `${r.tf}_${r.direction || 'LONG'}`;
        const cur = tfMap.get(sigKey);
        if (!cur || (r.structure?.lag || 0) <= (cur.structure?.lag || 0)) {
          tfMap.set(sigKey, r);
        }
      });
      const uniqueResults = Array.from(tfMap.values());
      if (uniqueResults.length === 0) return;

      const norm = normalizeSymbol(item.symbol);
      const existing = dedupedCoinsMap.get(norm);
      if (!existing) {
        dedupedCoinsMap.set(norm, { ...item, list3Results: uniqueResults });
      } else {
        // 合并重复币种卡片的信号，并再次去重周期
        const mergedMap = new Map<string, List3SignalResult>();
        (existing.list3Results || []).forEach((r) => {
          mergedMap.set(`${r.tf}_${r.direction || 'LONG'}`, r);
        });
        uniqueResults.forEach((r) => {
          const sigKey = `${r.tf}_${r.direction || 'LONG'}`;
          const cur = mergedMap.get(sigKey);
          if (!cur || (r.structure?.lag || 0) <= (cur.structure?.lag || 0)) {
            mergedMap.set(sigKey, r);
          }
        });
        existing.list3Results = Array.from(mergedMap.values());
      }
    });

    return Array.from(dedupedCoinsMap.values());
  }, [list3, config]);

  useAutoHistoryLogger('LIST3', filteredList || [], activePositions || []);

  // --- AUTO EXECUTE LOGIC ---
  const executedRef = useRef<Set<string>>(new Set());
  // 🔒 [单币多周期防并发锁] 杜绝同一币种在不同周期同时被触发开仓
  const symbolLastExecutedRef = useRef<Map<string, number>>(new Map());
  const activePositionsRef = useRef(activePositions);
  const executeTradeSafeRef = useRef(executeTradeSafe);

  useEffect(() => { activePositionsRef.current = activePositions; }, [activePositions]);
  useEffect(() => { executeTradeSafeRef.current = executeTradeSafe; }, [executeTradeSafe]);

  // 🔒 [CODE LOCK - UNIFIED PIPELINE DISCIPLINE]
  // Automatic trade execution is strictly governed by List 4 (Momentum Audit) double-lock breakout engine.
  // List 3 purely serves as the structural audit pipeline stage and does not prematurely fire market orders.
  useEffect(() => {
    // Pipeline passed; candidates flow cleanly into List 4 for Attack Breakout & N-Candle Breakout confirmation.
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
            idx={idx}
          />
        ))}
      </div>
    </div>
  );
};

export default List3_Structure;
