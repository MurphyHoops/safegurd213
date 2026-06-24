import React, { useRef, useEffect } from "react";
import { useBacktestGrandCrossing } from "./useBacktestGrandCrossing";
import {
  ScannerItem,
  List2Config,
} from "../../../components/Scanner/scannerTypes";
import List2_GrandCrossing from "../../grand-crossing/components/List2_GrandCrossing";

interface Props {
  candidates: ScannerItem[];
  onResultsUpdate: (results: ScannerItem[]) => void;
  scanConfig: any;
  setScanConfig: any;
  setChartData: (data: any) => void;
  directMode?: boolean;
  onLog?: (type: any, msg: string) => void;
  onRemoveSignalReady?: (fn: (uniqueId: string) => void) => void;
}

const DEFAULT_CONFIG: List2Config = {
  timeframes: ["5m", "15m", "30m", "1h", "2h", "4h", "8h", "1d"],
  newModeRetention: 9,
  volMultiplier: 1.0,
  squeezeThreshold: 0.5,
  maxAmplitude: 50,
  minBodyRatio: 60,
  enableFlatFilter: true,
  flatLookback: 50,
  flatThreshold: 5,
  checkEma80Conflict: false,
  sortMode: "MOST",
  requireCrossing: true,
  requireAlignment: false,
  strictFiltering: false,
};

export const BacktestGrandCrossingModule: React.FC<Props> = ({
  candidates,
  onResultsUpdate,
  onLog,
  scanConfig,
  setScanConfig,
  setChartData,
  onRemoveSignalReady,
}) => {
  // --- FILTER CANDIDATES TO COMPLY WITH USER WATCHLIST INTENT ---
  // If useCustomOnly is active, List 2 MUST strictly scan ONLY the user's custom symbols (监控池)
  const effectiveCandidates = React.useMemo(() => {
    if (scanConfig?.useCustomOnly) {
      const customSet = new Set(
        (scanConfig.customSymbols || '')
          .split(',')
          .map((s: string) => s.trim().toUpperCase())
          .filter(Boolean)
          .map((s: string) => s.endsWith('USDT') ? s : `${s}USDT`)
      );
      return candidates.filter(c => customSet.has(c.symbol.toUpperCase()));
    }
    return candidates;
  }, [candidates, scanConfig?.useCustomOnly, scanConfig?.customSymbols]);

  const {
    config,
    setConfig,
    list2,
    status,
    scanText,
    countdowns,
    removeItem,
    clearItems,
    removeSignal,
  } = useBacktestGrandCrossing(effectiveCandidates, DEFAULT_CONFIG, onLog);

  const lastResultsStrRef = useRef<string>("");
  useEffect(() => {
    const resultsStr = JSON.stringify(list2);
    if (resultsStr !== lastResultsStrRef.current) {
      lastResultsStrRef.current = resultsStr;
      onResultsUpdate(list2);
    }
  }, [list2, onResultsUpdate]);

  useEffect(() => {
    if (onRemoveSignalReady && removeSignal) {
      onRemoveSignalReady(removeSignal);
    }
  }, [onRemoveSignalReady, removeSignal]);

  return (
    <List2_GrandCrossing
      config={config}
      setConfig={setConfig}
      scanConfig={scanConfig}
      setScanConfig={setScanConfig}
      countdowns={countdowns}
      tfCounts={{}}
      activeFilterTf={null}
      isLocked={false}
      onTfInteraction={() => {}}
      filteredList2={list2}
      setChartData={setChartData}
      pollingStatus={status === "SCANNING" ? "正在扫描..." : "监控中"}
      onRemoveItem={removeItem}
      onClearItems={clearItems}
    />
  );
};
