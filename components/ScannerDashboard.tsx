import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { binanceRealtimeService } from "../services/realtime/BinanceRealtimeService";
import { ScannerSettings, PositionSide, Position, KLine, StrategyItem } from "../types";
import {
  X,
  Crosshair,
  Minus,
  Activity,
  Maximize2,
  Play,
  Square,
  Download,
  Settings,
  History,
  Zap,
  Clock,
  Loader2,
} from "lucide-react";
import { audioService } from "../services/audioService";
import { normalizeSymbol, resolvePrice } from "../services/symbolUtils";
import KlineChartModal from "./KlineChartModal";
import { ErrorBoundary } from "./ErrorBoundary";
import { usePersistedState } from "../hooks/usePersistedState";

// --- ALL ATOMIC MODULES ---
import { MarketScannerModule } from "../modules/market-scanner";
import { GrandCrossingModule } from "../modules/grand-crossing";
import { StructureAuditModule } from "../modules/structure-audit";
import { MomentumAuditModule } from "../modules/momentum-audit";
import { LiveBattlefieldModule } from "../modules/live-battlefield";
import { TacticalCommandModule } from "../modules/tactical-command";

const MemoizedGrandCrossingModule = React.memo(GrandCrossingModule, (prev, next) => {
  return prev.networkStatus === next.networkStatus && 
         prev.candidates === next.candidates && 
         prev.directMode === next.directMode &&
         prev.strategyId === next.strategyId;
});
const MemoizedStructureAuditModule = React.memo(StructureAuditModule, (prev, next) => {
  return prev.candidates === next.candidates && 
         prev.activePositions === next.activePositions && 
         prev.directMode === next.directMode &&
         prev.strategyId === next.strategyId;
});
const MemoizedMomentumAuditModule = React.memo(MomentumAuditModule, (prev, next) => {
  return prev.candidates === next.candidates && 
         prev.activePositions === next.activePositions && 
         prev.list3Config === next.list3Config &&
         prev.strategyId === next.strategyId;
});

// --- MIRRORED MODULES ---
import { BacktestGrandCrossingModule } from "../modules/backtester/mirrored/BacktestGrandCrossingUI";
import { BacktestStructureAuditModule } from "../modules/backtester/mirrored/BacktestStructureAuditUI";
import { BacktestMomentumAuditModule } from "../modules/backtester/mirrored/BacktestMomentumAuditUI";

import { NetworkWidget } from "./NetworkWidget";
import { auth } from "../firebase";
import { preloadAllHistories, useAutoHistoryLogger, migrateDefaultHistoryToUser } from "../modules/momentum-audit/components/ScannerHistoryModal";

import {
  ScannerItem,
  ActionConfig,
  List3Config,
  ScanConfig,
} from "./Scanner/scannerTypes";
import { backtestDownloader } from "../services/backtest/downloader";
import { backtestDb } from "../services/backtest/db";
import {
  BacktestProvider,
  useBacktest,
} from "../modules/backtester/BacktestContext";

interface Props {
  networkStatus?: "healthy" | "delayed" | "disconnected";
  settings: ScannerSettings;
  isVisible: boolean;
  onClose: () => void;
  onOpenPosition: (
    symbol: string,
    side: PositionSide,
    amount: number,
    price: number,
    signalTf?: string,
    signalCandle?: any,
    entryEmas?: any,
    extraProps?: Partial<Position>,
  ) => void;
  onClosePosition: (symbol: string, side: PositionSide) => void;
  realPrices: Record<string, number>;
  activePositions: Position[];
  balance: number;
  directMode?: boolean;
  onLog?: (
    type: "INFO" | "SUCCESS" | "WARNING" | "DANGER",
    message: string,
  ) => void;
  logs?: any[];
  onBacktestPositionsUpdate?: (positions: Position[]) => void;
  onBatchClose?: () => void;
  isRealTrading?: boolean;
}

const UnconfiguredColumn: React.FC<{
  title: string;
  description: string;
}> = ({ title, description }) => {
  return (
    <div className="flex-1 min-w-[260px] border-r border-slate-800 bg-slate-900/30 flex flex-col h-full animate-in fade-in duration-300">
      <div className="p-3 border-b border-slate-800 bg-slate-950/25">
        <div className="font-bold text-slate-500 text-[10px] flex items-center gap-1.5 uppercase">
          <Settings size={12} className="opacity-40" /> {title}
        </div>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-10 h-10 rounded-full bg-slate-800/20 border border-slate-800/40 flex items-center justify-center text-slate-500 mb-4 animate-pulse">
          <Settings size={18} className="opacity-40" />
        </div>
        <div className="text-[10px] font-bold text-slate-400 mb-1.5 font-sans">【未载入运行参数】</div>
        <div className="text-[10px] text-slate-500 max-w-[200px] leading-relaxed font-sans">
          {description}
        </div>
      </div>
    </div>
  );
};

const ScannerDashboardInner: React.FC<
  Props & {
    setBacktestKlines: (map: Record<string, Record<string, KLine[]>>) => void;
  }
> = ({
  networkStatus = "disconnected",
  settings,
  isVisible,
  onClose,
  onOpenPosition,
  onClosePosition,
  onBatchClose,
  realPrices: livePrices = {},
  activePositions: livePositions = [],
  balance: liveBalance = 0,
  directMode = false,
  onLog,
  logs = [],
  setBacktestKlines,
  onBacktestPositionsUpdate,
  isRealTrading = false,
}) => {
  const {
    virtualTime,
    setVirtualTime,
    isPlaying,
    setIsPlaying,
    speed,
    setSpeed,
    currentIndex,
    setCurrentIndex,
    totalSteps,
    baseKlines,
    baseInterval,
    setAccount,
    setPositions,
    setLogs,
    setTradeLogs,
    account: backtestAccount,
    positions: backtestPositions,
    klinesMap,
    realPrices: backtestPrices,
    batchCloseAll,
  } = useBacktest();

  // --- UI STATE ---
  const [isMinimized, setIsMinimized] = useState(false);
  const [realPrices, setRealPrices] = useState<Record<string, number>>({});

  useEffect(() => {
    const handlePrices = (prices: Map<string, number>) => {
      setRealPrices(Object.fromEntries(prices));
    };
    binanceRealtimeService.on('pricesUpdated', handlePrices);
    return () => binanceRealtimeService.off('pricesUpdated', handlePrices);
  }, []);
  const [showLogPanel, setShowLogPanel] = useState(false);
  const [chartData, setChartData] = useState<any>(null);
  const [scannerMode, setScannerMode] = usePersistedState<
    "LIVE" | "BACKTEST" | "SMART"
  >("SCANNER_GLOBAL_MODE", "LIVE");
  const [actionConfig, setActionConfig] = useState<ActionConfig | null>(null);

  const lastPositionsRef = useRef<string>("");

  useEffect(() => {
    if (scannerMode !== "BACKTEST") {
      setIsPlaying(false);
    }
  }, [scannerMode, setIsPlaying]);

  // --- INSTRUMENTATION FOR DEBUGGING ---
  useEffect(() => {
    console.log('[Monitor] ScannerDashboard: actionConfig state changed:', actionConfig);
    if (actionConfig === undefined) {
      console.error('[Monitor] ScannerDashboard: CRITICAL - actionConfig is undefined!');
      // Perhaps log to system monitor here too
      // logger.error('DASHBOARD', 'CRITICAL - actionConfig is undefined');
    }
  }, [actionConfig]);

  useEffect(() => {
    if (onBacktestPositionsUpdate) {
      const posStr = JSON.stringify(backtestPositions);
      if (posStr !== lastPositionsRef.current) {
        lastPositionsRef.current = posStr; // Update ref BEFORE calling the callback to prevent sync loops
        onBacktestPositionsUpdate(backtestPositions);
      }
    }
  }, [backtestPositions, onBacktestPositionsUpdate]);

  // --- MULTI-STRATEGY CONCURRENT MONITORING STATE ---
  const [strategies, setStrategies] = usePersistedState<StrategyItem[]>(
    "SCANNER_STRATEGIES_LIST",
    [
      { id: "strat-1", name: "自动选币 1", active: true },
      { id: "strat-2", name: "自动选币 2", active: true },
      { id: "strat-3", name: "自动选币 3", active: false },
    ]
  );
  const [selectedStrategyId, setSelectedStrategyId] = usePersistedState<string>(
    "SCANNER_SELECTED_STRATEGY_ID",
    "strat-1"
  );

  const handleSelectStrategy = useCallback((id: string) => {
    setSelectedStrategyId(id);
  }, [setSelectedStrategyId]);

  const handleAddStrategy = useCallback(() => {
    setStrategies((prev) => {
      const nextNum = prev.length + 1;
      const newId = `strat-${Date.now()}`;
      return [...prev, { id: newId, name: `自动选币 ${nextNum}`, active: true, unconfigured: true }];
    });
  }, [setStrategies]);

  const handleActivateStrategy = useCallback(() => {
    setStrategies((prev) =>
      prev.map((s) => (s.id === selectedStrategyId ? { ...s, unconfigured: false } : s))
    );
    if (onLog) onLog("SUCCESS", `[策略激活] 策略已成功激活并载入标准默认参数。`);
  }, [selectedStrategyId, setStrategies, onLog]);

  const handleDeleteStrategy = useCallback((id: string) => {
    setStrategies((prev) => {
      if (prev.length <= 1) return prev;
      const filtered = prev.filter((s) => s.id !== id);
      if (selectedStrategyId === id && filtered.length > 0) {
        setSelectedStrategyId(filtered[0].id);
      }
      return filtered;
    });
  }, [selectedStrategyId, setSelectedStrategyId, setStrategies]);

  const handleRenameStrategy = useCallback((id: string, name: string) => {
    setStrategies((prev) =>
      prev.map((s) => (s.id === id ? { ...s, name } : s))
    );
  }, [setStrategies]);

  const handleExportStrategy = useCallback((id: string) => {
    const strat = strategies.find((s) => s.id === id);
    const name = strat ? strat.name : id;
    
    const getStoredJSON = (key: string) => {
      const raw = localStorage.getItem(key);
      try {
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    };

    const config24H = getStoredJSON(`SCANNER_CONFIG_24H_${id}`);
    const config8AM = getStoredJSON(`SCANNER_CONFIG_8AM_${id}`);
    const list2Config = getStoredJSON(`SCANNER_LIST2_CONFIG_${id}`);
    const list3Config = getStoredJSON(`SCANNER_LIST3_CONFIG_${id}`);
    const list4Config = getStoredJSON(`SCANNER_LIST4_CONFIG_${id}`);
    const list6Config = getStoredJSON(`SCANNER_ACTION_CONFIG_${id}`);

    const exportData = {
      version: "1.0",
      strategyId: id,
      strategyName: name,
      configs: {
        SCANNER_CONFIG_24H: config24H,
        SCANNER_CONFIG_8AM: config8AM,
        SCANNER_LIST2_CONFIG: list2Config,
        SCANNER_LIST3_CONFIG: list3Config,
        SCANNER_LIST4_CONFIG: list4Config,
        SCANNER_ACTION_CONFIG: list6Config
      }
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Strategy_${name.replace(/\s+/g, "_")}_Config.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (onLog) onLog("SUCCESS", `[策略导出] 导出策略 "${name}" 成功。`);
  }, [strategies, onLog]);

  const handleImportStrategy = useCallback((id: string, file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const data = JSON.parse(text);
        if (data && data.configs) {
          const saveToStorage = (key: string, val: any) => {
            if (val) localStorage.setItem(key, JSON.stringify(val));
          };

          saveToStorage(`SCANNER_CONFIG_24H_${id}`, data.configs.SCANNER_CONFIG_24H);
          saveToStorage(`SCANNER_CONFIG_8AM_${id}`, data.configs.SCANNER_CONFIG_8AM);
          saveToStorage(`SCANNER_LIST2_CONFIG_${id}`, data.configs.SCANNER_LIST2_CONFIG);
          saveToStorage(`SCANNER_LIST3_CONFIG_${id}`, data.configs.SCANNER_LIST3_CONFIG);
          saveToStorage(`SCANNER_LIST4_CONFIG_${id}`, data.configs.SCANNER_LIST4_CONFIG);
          saveToStorage(`SCANNER_ACTION_CONFIG_${id}`, data.configs.SCANNER_ACTION_CONFIG);

          // Mark strategy as configured when config is imported successfully
          setStrategies((prev) =>
            prev.map((s) => (s.id === id ? { ...s, unconfigured: false } : s))
          );

          setSelectedStrategyId("");
          setTimeout(() => {
            setSelectedStrategyId(id);
            if (onLog) {
              const strat = strategies.find((s) => s.id === id);
              onLog("SUCCESS", `[策略导入] 导入策略到 "${strat ? strat.name : id}" 成功，系统配置已热重载。`);
            }
          }, 50);
        } else {
          alert("无效的策略配置文件：缺少 configs 属性");
        }
      } catch (err) {
        console.error(err);
        alert("导入解析失败，请确保文件格式为 JSON 合规配置");
      }
    };
    reader.readAsText(file);
  }, [strategies, setSelectedStrategyId, onLog]);

  // --- GLOBAL SCANNER CONFIG ---
  const [activeMode, setActiveMode] = usePersistedState<"24H" | "8AM">(
    "SCANNER_ACTIVE_MODE",
    "24H",
  );

  // --- BREAKER LOGIC ---
  const [isBreakerActive, setIsBreakerActive] = useState(false);
  const isBreakerActiveRef = useRef(false);
  const breakerTriggeredTimeRef = useRef<number>(0);

  useEffect(() => {
    isBreakerActiveRef.current = isBreakerActive;
  }, [isBreakerActive]);
  const onLogRef = useRef(onLog);
  useEffect(() => {
    onLogRef.current = onLog;
  }, [onLog]);
  const livePricesRef = useRef(livePrices);
  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false };
  }, []);

  useEffect(() => {
      livePricesRef.current = livePrices;
  }, [livePrices]);
  
  // Track price history for drop detection
  const priceHistoryRef = useRef<Record<string, { price: number, time: number }[]>>({});

  useEffect(() => {
    const intervalId = setInterval(() => {
        // Use the existing actionConfigRef, which is updated every render cycle
        const config = actionConfigRef.current?.breakerConfig;
        if (!config?.enabled) return;
        
        if (!isMountedRef.current) return;
        
        const now = Date.now();
        const currentPrices = livePricesRef.current;
        
        // Track price history
        if (!priceHistoryRef.current) priceHistoryRef.current = {};
        
        Object.entries(currentPrices).forEach(([symbol, price]) => {
          if (!priceHistoryRef.current[symbol]) priceHistoryRef.current[symbol] = [];
          priceHistoryRef.current[symbol].push({ price, time: now });
          
          const limit = now - config.triggerMinutes * 60 * 1000;
          priceHistoryRef.current[symbol] = priceHistoryRef.current[symbol].filter(h => h.time > limit);
        });

        // Status Check
        let shouldBeActive = isBreakerActiveRef.current;
        if (isBreakerActiveRef.current) {
            if (now - breakerTriggeredTimeRef.current > config.autoRecoverMinutes * 60 * 1000) {
                shouldBeActive = false;
                if (onLogRef.current) onLogRef.current("SUCCESS", `[Monitor] 防恐慌机制已到期，自动解锁。`);
                console.log("[Monitor] Breaker recovered");
            }
        } else {
            let droppedCount = 0;
            let totalCoins = 0;
            Object.entries(priceHistoryRef.current).forEach(([symbol, history]) => {
              if (history.length < 2) return;
              totalCoins++;
              const startPrice = history[0].price;
              const currentPrice = history[history.length - 1].price;
              const dropPct = ((startPrice - currentPrice) / startPrice) * 100;
              if (dropPct >= config.minDropPercent) droppedCount++;
            });

            if (totalCoins > 0 && (droppedCount / totalCoins) * 100 >= config.minCoinsPercent) {
                shouldBeActive = true;
                breakerTriggeredTimeRef.current = now;
                if (onLogRef.current) onLogRef.current("DANGER", `[Monitor] 检测到大面积恐慌下跌 (${(droppedCount/totalCoins*100).toFixed(1)}% 币种下跌 >= ${config.minDropPercent}%)! 已禁止所有空单。`);
                console.log("[Monitor] Breaker triggered", { droppedCount, totalCoins, config });
            }
        }

        if (shouldBeActive !== isBreakerActiveRef.current) {
            isBreakerActiveRef.current = shouldBeActive;
            setIsBreakerActive(shouldBeActive);
        }
    }, 5000);

    return () => clearInterval(intervalId);
  }, []); // Run once

  const [config24H, setConfig24H] = usePersistedState<ScanConfig>(
    `SCANNER_CONFIG_24H_${selectedStrategyId || 'strat-1'}`,
    {
      timeBasis: "24H",
      source: "BOTH",
      minVolume: 1,
      maxVolume: 0,
      minChange: 1,
      customSymbols: "",
      useCustomOnly: false,
      batchSize: 40,
      limit: 520,
      breakerConfig: {
        enabled: false,
        triggerMinutes: 15,
        minDropPercent: 3,
        minCoinsPercent: 50,
        autoRecoverMinutes: 30,
      },
      instantOpenEnabled: false,
      instantReopenEnabled: false,
      instantOpenDirection: "LONG",
      majorTrend: {
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
        maxExtremeDistanceLong: 5,
        maxExtremeDistanceShort: 5
      }
    },
  );
  const [config8AM, setConfig8AM] = usePersistedState<ScanConfig>(
    `SCANNER_CONFIG_8AM_${selectedStrategyId || 'strat-1'}`,
    {
      timeBasis: "8AM",
      source: "GAINERS",
      minVolume: 1,
      maxVolume: 0,
      minChange: 1,
      customSymbols: "",
      useCustomOnly: false,
      batchSize: 40,
      limit: 520,
      breakerConfig: {
        enabled: false,
        triggerMinutes: 15,
        minDropPercent: 3,
        minCoinsPercent: 50,
        autoRecoverMinutes: 30,
      },
      instantOpenEnabled: false,
      instantReopenEnabled: false,
      instantOpenDirection: "LONG",
      majorTrend: {
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
        maxExtremeDistanceShort: 5
      }
    },
  );

  const scanConfig = useMemo(
    () => (activeMode === "24H" ? config24H : config8AM),
    [activeMode, config24H, config8AM],
  );

  // --- BACKTEST SPECIFIC STATE ---
  const [backtestIntervals, setBacktestIntervals] = usePersistedState<string[]>(
    "SCANNER_BACKTEST_INTERVALS",
    ["1m", "5m", "15m", "1h", "4h"],
  );
  const [syncProgress, setSyncProgress] = useState<{
    current: number;
    total: number;
    percent: number;
  } | null>(null);
  const [backtestCustomSymbols, setBacktestCustomSymbols] =
    usePersistedState<string>("SCANNER_BACKTEST_CUSTOM_SYMBOLS", "");
  const [useBacktestCustomOnly, setUseBacktestCustomOnly] =
    usePersistedState<boolean>("SCANNER_BACKTEST_USE_CUSTOM", false);

  // --- DOWNLOAD STATE ---
  const [downloadRange, setDownloadRange] = useState({
    start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0],
    end: new Date().toISOString().split("T")[0],
  });
  const [isDownloading, setIsDownloading] = useState(false);

  // --- TICK LOGIC ---
  const timerRef = useRef<any>(null);

  const handleTick = useCallback(() => {
    setCurrentIndex((prev) => {
      if (!baseKlines || baseKlines.length === 0) return prev;
      if (prev >= totalSteps - 1) {
        setIsPlaying(false);
        return prev;
      }
      const next = Math.min(prev + speed, totalSteps - 1);
      const timestamp = baseKlines[next]?.time;
      if (timestamp) setVirtualTime(timestamp);
      return next;
    });
  }, [
    speed,
    totalSteps,
    baseKlines,
    setIsPlaying,
    setVirtualTime,
    setCurrentIndex,
  ]);

  useEffect(() => {
    if (isPlaying && scannerMode === "BACKTEST") {
      timerRef.current = setInterval(handleTick, 50); // Increased from 100ms to 50ms (20fps)
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isPlaying, handleTick, scannerMode]);

  const handleStartBacktest = useCallback(
    async (symbolsToBacktest: string[]) => {
      if (symbolsToBacktest.length === 0) return;

      setSyncProgress({
        current: 0,
        total: symbolsToBacktest.length,
        percent: 0,
      });

      try {
        const startTs = new Date(downloadRange.start).getTime();
        const endTs = new Date(downloadRange.end).getTime();
        const downloadStartTs = startTs - 14 * 24 * 60 * 60 * 1000; // 14 days for indicator warmup

        await backtestDb.init();

        // 1. Parallel Sync Data (Ensuring we have the warmup period too)
        if (onLog)
          onLog("INFO", `准备回测数据: ${symbolsToBacktest.length} 个币种...`);

        const CONCURRENCY_LIMIT = 5;
        for (let i = 0; i < symbolsToBacktest.length; i += CONCURRENCY_LIMIT) {
          const chunk = symbolsToBacktest.slice(i, i + CONCURRENCY_LIMIT);
          await Promise.all(
            chunk.map(async (symbol) => {
              await Promise.all(
                backtestIntervals.map((interval) =>
                  backtestDownloader.downloadHistoricalData(
                    symbol,
                    interval,
                    downloadStartTs,
                    endTs,
                    undefined,
                    directMode,
                  ),
                ),
              );
            }),
          );

          setSyncProgress({
            current: Math.min(i + CONCURRENCY_LIMIT, symbolsToBacktest.length),
            total: symbolsToBacktest.length,
            percent: Math.round(
              (Math.min(i + CONCURRENCY_LIMIT, symbolsToBacktest.length) /
                symbolsToBacktest.length) *
                100,
            ),
          });
        }

        // 2. Load into Memory for Provider
        const newMap: Record<string, Record<string, KLine[]>> = {};
        for (const symbol of symbolsToBacktest) {
          newMap[symbol] = {};
          for (const interval of backtestIntervals) {
            const data = await backtestDb.getKLines(
              symbol,
              interval,
              downloadStartTs,
              endTs,
            );
            if (data.length > 0) newMap[symbol][interval] = data;
          }
        }

        setBacktestKlines(newMap);
        setSyncProgress({
          current: symbolsToBacktest.length,
          total: symbolsToBacktest.length,
          percent: 100,
        });
        setTimeout(() => setSyncProgress(null), 1000);

        // 3. Reset Backtest State
        const smallestInterval = backtestIntervals.includes("1m")
          ? "1m"
          : backtestIntervals[0] || "15m";
        let actualStartTs = startTs;
        let actualStartIdx = 0;

        // Find first symbol that actually has data to determine start index
        for (const symbol of symbolsToBacktest) {
          const klines = newMap[symbol]?.[smallestInterval];
          if (klines && klines.length > 0) {
            const idx = klines.findIndex((k) => k.time >= startTs);
            if (idx !== -1) {
              actualStartIdx = idx;
              actualStartTs = klines[idx].time;
              break;
            }
          }
        }

        setCurrentIndex(actualStartIdx);
        setVirtualTime(actualStartTs);
        setIsPlaying(true);

        if (onLog)
          onLog(
            "SUCCESS",
            `回测启动: ${symbolsToBacktest.length} 个币种，起点 ${new Date(actualStartTs).toLocaleString()}`,
          );
      } catch (err) {
        console.error("Backtest failed:", err);
        if (onLog)
          onLog(
            "DANGER",
            `回测启动失败: ${err instanceof Error ? err.message : String(err)}`,
          );
        setSyncProgress(null);
      }
    },
    [
      backtestIntervals,
      setBacktestKlines,
      setCurrentIndex,
      setVirtualTime,
      setIsPlaying,
      onLog,
      downloadRange,
      directMode,
    ],
  );

  const handleStopBacktest = useCallback(() => {
    setIsPlaying(false);
    setSyncProgress(null);
  }, [setIsPlaying]);

  const handleDownloadData = async () => {
    const symbolsToDownload = useBacktestCustomOnly
      ? backtestCustomSymbols
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter((s) => s)
      : list1Candidates.length > 0
        ? list1Candidates.map((c) => c.symbol)
        : ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];

    if (symbolsToDownload.length === 0) {
      if (onLog) onLog("WARNING", "没有可下载的币种");
      return;
    }

    setIsDownloading(true);
    const startMs = new Date(downloadRange.start).getTime();
    const endMs = new Date(downloadRange.end).getTime();
    const downloadStartTs = startMs - 14 * 24 * 60 * 60 * 1000; // Warmup

    try {
      let symbolsDone = 0;
      for (const symbol of symbolsToDownload) {
        for (const interval of backtestIntervals) {
          if (onLog) onLog("INFO", `正在同步 ${symbol} ${interval}...`);
          await backtestDownloader.downloadHistoricalData(
            symbol,
            interval,
            downloadStartTs,
            endMs,
            (p) =>
              setSyncProgress({
                current: symbolsDone,
                total: symbolsToDownload.length,
                percent: Math.round(
                  ((symbolsDone + p / 100) / symbolsToDownload.length) * 100,
                ),
              }),
            directMode,
          );
        }
        symbolsDone++;
      }
      if (onLog)
        onLog("SUCCESS", `数据同步完成 (${symbolsToDownload.length} 个币种)`);
    } catch (err) {
      console.error("Sync failed:", err);
      if (onLog)
        onLog(
          "DANGER",
          `同步失败: ${err instanceof Error ? err.message : String(err)}`,
        );
    } finally {
      setIsDownloading(false);
      setSyncProgress(null);
    }
  };

  // --- DATA PIPELINE STATE ---
  const [list1Candidates, setList1Candidates] = useState<ScannerItem[]>([]);
  const [list2Results, setList2Results] = useState<ScannerItem[]>([]);
  const [list3Results, setList3Results] = useState<ScannerItem[]>([]);

  const handleList1Results = useCallback((results: ScannerItem[]) => {
    setList1Candidates(prev => {
        // Only update if content is fundamentally different to avoid loop
        if (JSON.stringify(prev) === JSON.stringify(results)) {
            return prev;
        }
        return results;
    });
  }, []);

  const handleList2Results = useCallback((results: ScannerItem[]) => {
    setList2Results(prev => {
        // Only update if content is fundamentally different to avoid loop
        if (JSON.stringify(prev) === JSON.stringify(results)) {
            return prev;
        }
        return results;
    });
  }, []);

  const handleList3Results = useCallback((results: ScannerItem[]) => {
    setList3Results(prev => {
        // Only update if content is fundamentally different to avoid loop
        if (JSON.stringify(prev) === JSON.stringify(results)) {
            return prev;
        }
        return results;
    });
  }, []);
  const [list3Config, setList3Config] = useState<List3Config | null>(null);

  // --- AUTOMATIC HISTORY LOGGER & CACHE PRE-LOADER ---
  // Tracks active signals in List 2 and List 3 to auto-log them when they appear
  useAutoHistoryLogger('LIST2', list2Results);
  useAutoHistoryLogger('LIST3', list3Results);

  // Preloads the local cache of histories in the background when the user logs in
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        preloadAllHistories(user.uid);
        migrateDefaultHistoryToUser(user.uid);
      }
    });
    return () => unsubscribe();
  }, []);

  const [liveStats, setLiveStats] = useState({
    symbolCount: 0,
    totalValue: 0,
    totalPnl: 0,
  });
  const liveStatsPulseRef = useRef("");

  const handleLiveStatsUpdate = useCallback((newStats: any) => {
    const pulse = `${newStats.symbolCount}-${newStats.totalPnl.toFixed(4)}`;
    if (liveStatsPulseRef.current !== pulse) {
      setLiveStats(newStats);
      liveStatsPulseRef.current = pulse;
    }
  }, []);


  const removeSignalRef = useRef<((uniqueId: string) => void) | undefined>(
    undefined,
  );
  const list2RemoveSignalRef = useRef<((uniqueId: string) => void) | undefined>(
    undefined,
  );

  const handleRemoveSignal = (id: string) => {
    removeSignalRef.current?.(id);
    list2RemoveSignalRef.current?.(id);
  };

  // --- SWITCH DATA SOURCES BASED ON MODE ---
  const currentPrices =
    scannerMode === "BACKTEST" ? backtestPrices : livePrices; // Mirrored modules use BacktestContext for prices
  const currentPositions =
    scannerMode === "BACKTEST" ? backtestPositions : livePositions;

  const isUnconfigured = useMemo(() => {
    const activeStrat = strategies.find((s) => s.id === selectedStrategyId);
    return activeStrat?.unconfigured === true;
  }, [strategies, selectedStrategyId]);

  const filteredPositions = useMemo(() => {
    if (isUnconfigured) return [];
    if (isRealTrading && scannerMode !== "BACKTEST") {
      return currentPositions;
    }
    const activeStratId = selectedStrategyId || 'strat-1';
    return currentPositions.filter((p) => {
      const pId = p.strategyId || 'strat-1';
      return pId === activeStratId;
    });
  }, [currentPositions, selectedStrategyId, isUnconfigured, isRealTrading, scannerMode]);

  const currentBalance =
    scannerMode === "BACKTEST" ? backtestAccount.marginBalance : liveBalance;

  // Clear transient lists immediately on strategy selection changes to prevent layout leaks
  useEffect(() => {
    setList1Candidates([]);
    setList2Results([]);
    setList3Results([]);
  }, [selectedStrategyId]);

  // --- REFS FOR STABLE CALLBACKS ---
  const actionConfigRef = useRef<ActionConfig | null>(null);
  const backtestPositionsRef = useRef<Position[]>([]);
  const livePositionsRef = useRef<Position[]>([]);
  const backtestAccountRef = useRef<any>(null);
  const liveBalanceRef = useRef<number>(0);
  const virtualTimeRef = useRef<number>(0);
  const currentPricesRef = useRef<Record<string, number>>({});
  const scanConfigRef = useRef<ScanConfig | null>(null);
  const list1CandidatesRef = useRef<ScannerItem[]>([]);

  // Render-phase Ref Synchronization: Synchronously assigns incoming props/state to mutable refs
  // during the render cycle itself. This bypasses React's asynchronous commit phase (useEffect)
  // and completely eliminates race conditions where event hooks (e.g. executeTradeSafe)
  // read stale values within the same execution transaction.
  actionConfigRef.current = actionConfig;
  backtestPositionsRef.current = backtestPositions;
  livePositionsRef.current = livePositions;
  backtestAccountRef.current = backtestAccount;
  liveBalanceRef.current = liveBalance;
  virtualTimeRef.current = virtualTime;
  currentPricesRef.current = currentPrices;
  scanConfigRef.current = scanConfig;
  list1CandidatesRef.current = list1Candidates;

  const executeTradeSafe = useCallback(
    (
      symbol: string,
      side: PositionSide,
      price: number,
      reason: string,
      signalTf?: string,
      signalCandle?: any,
      entryEmas?: any,
      extraProps?: Partial<Position>,
    ) => {
      const cleanSymbol = normalizeSymbol(symbol);

      if (!price || isNaN(price) || price <= 0) {
        if (onLog)
          onLog(
            "DANGER",
            `交易拦截 ${cleanSymbol}: 开仓价格无效 (${price})，拒绝执行。`,
          );
        console.warn(
          `[Trade Reject] Invalid price for ${cleanSymbol}: ${price}`,
        );
        return false;
      }

      const DEFAULT_ACTION_CONFIG: ActionConfig = {
        enabled: true,
        openAmount: 100,
        maxOpenSymbols: 200,
        maxTotalValue: 100000,
        breakoutBuffer: 0.2,
        autoExecute: true,
        maxExposurePercent: 95,
        positionSizeMode: "FIXED",
        variablePercentage: 2,
        variableMaxLimit: 200,
        breakerConfig: {
            enabled: false,
            triggerMinutes: 15,
            minDropPercent: 3,
            minCoinsPercent: 50,
            autoRecoverMinutes: 30
        }
      };

      const userConfig = (actionConfigRef.current ||
        {}) as Partial<ActionConfig>;
      const config: ActionConfig = {
        enabled:
          typeof userConfig.enabled === "boolean"
            ? userConfig.enabled
            : DEFAULT_ACTION_CONFIG.enabled,
        openAmount:
          typeof userConfig.openAmount === "number" && userConfig.openAmount > 0
            ? userConfig.openAmount
            : DEFAULT_ACTION_CONFIG.openAmount,
        maxOpenSymbols:
          typeof userConfig.maxOpenSymbols === "number" &&
          userConfig.maxOpenSymbols > 0
            ? userConfig.maxOpenSymbols
            : DEFAULT_ACTION_CONFIG.maxOpenSymbols,
        maxTotalValue:
          typeof userConfig.maxTotalValue === "number"
            ? userConfig.maxTotalValue
            : DEFAULT_ACTION_CONFIG.maxTotalValue,
        breakoutBuffer:
          typeof userConfig.breakoutBuffer === "number"
            ? userConfig.breakoutBuffer
            : DEFAULT_ACTION_CONFIG.breakoutBuffer,
        autoExecute:
          typeof userConfig.autoExecute === "boolean"
            ? userConfig.autoExecute
            : DEFAULT_ACTION_CONFIG.autoExecute,
        maxExposurePercent:
          typeof userConfig.maxExposurePercent === "number" &&
          userConfig.maxExposurePercent > 0
            ? userConfig.maxExposurePercent
            : DEFAULT_ACTION_CONFIG.maxExposurePercent,
        positionSizeMode:
          userConfig.positionSizeMode || DEFAULT_ACTION_CONFIG.positionSizeMode,
        variablePercentage:
          typeof userConfig.variablePercentage === "number"
            ? userConfig.variablePercentage
            : DEFAULT_ACTION_CONFIG.variablePercentage,
        variableMaxLimit:
          typeof userConfig.variableMaxLimit === "number"
            ? userConfig.variableMaxLimit
            : DEFAULT_ACTION_CONFIG.variableMaxLimit,
        breakerConfig: userConfig.breakerConfig || DEFAULT_ACTION_CONFIG.breakerConfig,
      };

      if (!config.enabled) {
        if (onLog)
          onLog(
            "WARNING",
            `交易拦截 (${cleanSymbol}): 战术面板总开关 (List 6) 未开启。`,
          );
        console.warn(`[Trade Reject] Master switch is OFF for ${cleanSymbol}`);
        return false;
      }

      const isAuto = reason.includes("Auto") && !reason.includes("List1 Auto");
      if (isAuto && !config.autoExecute) {
        if (onLog)
          onLog(
            "WARNING",
            `自动开仓被拦截 (${cleanSymbol}): 列表 6 中的 "自动策略开仓" 开关未开启。`,
          );
        console.warn(`[Trade Reject] Auto-execute is OFF for ${cleanSymbol}`);
        return false;
      }
      
      console.log(`[Trade Attempt] ${cleanSymbol} @ ${price} (Reason: ${reason})`);

      const activePositions =
        scannerMode === "BACKTEST"
          ? backtestPositionsRef.current
          : livePositionsRef.current;
      const balance =
        scannerMode === "BACKTEST"
          ? backtestAccountRef.current?.marginBalance || 0
          : liveBalanceRef.current;

      const currentSymbols = new Set(
        activePositions.map((p) => normalizeSymbol(p.symbol)),
      );
      const currentSymbolCount = currentSymbols.size;
      // Allow opening opposite direction (or adding to position) if symbol is already in portfolio
      if (
        !currentSymbols.has(cleanSymbol) &&
        currentSymbolCount >= (config.maxOpenSymbols || 200)
      ) {
        if (onLog)
          onLog(
            "DANGER",
            `交易拦截 ${cleanSymbol}: 持仓币种已达上限 (${currentSymbolCount} >= ${config.maxOpenSymbols})`,
          );
        console.warn(
          `[Trade Reject] Max open symbols limit reached: ${currentSymbolCount} >= ${config.maxOpenSymbols}`,
        );
        return false;
      }

      const amount =
        config.positionSizeMode === "VARIABLE"
          ? Math.min(
              balance * (config.variablePercentage / 100),
              config.variableMaxLimit || Infinity,
            )
          : config.openAmount || 100;

      // List 6: Total Capital Limit Check
      const currentTotalValue = activePositions.reduce((sum, p) => {
        const pPrice =
          currentPricesRef.current[normalizeSymbol(p.symbol)] ||
          p.markPrice ||
          p.entryPrice;
        return sum + p.amount * (pPrice || 0);
      }, 0);

      // Breaker Guard
      if (side === PositionSide.SHORT && config.breakerConfig?.enabled && isBreakerActive) {
          if (onLog) onLog("DANGER", `交易拦截 (${cleanSymbol}): 触发防恐慌机制，禁止开空。`);
          return false;
      }

      if (
        config.maxTotalValue > 0 &&
        currentTotalValue + amount > config.maxTotalValue
      ) {
        const overAmount = currentTotalValue + amount - config.maxTotalValue;
        if (onLog)
          onLog(
            "WARNING",
            `交易拦截 ${cleanSymbol}: 总资金上限已达 (${currentTotalValue.toFixed(1)} + ${amount.toFixed(1)} > ${config.maxTotalValue}, 超出 ${overAmount.toFixed(1)})`,
          );
        console.warn(
          `[Trade Reject] Max total value limit reached: ${currentTotalValue + amount} > ${config.maxTotalValue}`,
        );
        return false;
      }

      // Check Exposure % (List 6 Risk Limit)
      const usagePct =
        config.maxTotalValue > 0
          ? ((currentTotalValue + amount) / config.maxTotalValue) * 100
          : 0;
      const exposureLimit = config.maxExposurePercent || 95;
      if (usagePct > exposureLimit) {
        if (onLog)
          onLog(
            "DANGER",
            `交易拦截 ${cleanSymbol}: 风险敞口已达上限 (${usagePct.toFixed(1)}% > ${exposureLimit}%)`,
          );
        console.warn(
          `[Trade Reject] Exposure limit reached: ${usagePct.toFixed(1)}% > ${exposureLimit}%`,
        );
        return false;
      }

      const mergedExtraProps = {
        strategyId: selectedStrategyId,
        ...extraProps,
      };

      if (scannerMode === "BACKTEST") {
        const qty = amount / price;
        const newPos: Position = {
          symbol: cleanSymbol,
          side,
          amount: qty,
          entryPrice: price,
          markPrice: price,
          unrealizedPnL: 0,
          unrealizedPnLPercentage: 0,
          entryTime: virtualTimeRef.current,
          isHedged: false,
          liquidationPrice: side === "LONG" ? price * 0.95 : price * 1.05,
          entryId: Date.now().toString(),
          isBacktestRecord: true,
          backtestEntryTime: virtualTimeRef.current,
          strategyId: selectedStrategyId,
        };
        setPositions((prev) => [...prev, newPos]);
        if (onLog)
          onLog(
            "SUCCESS",
            `[回测] 开仓成功: ${cleanSymbol} ${side} @ ${price} (数量: ${qty.toFixed(4)})`,
          );
        return true;
      } else {
        onOpenPosition(
          cleanSymbol,
          side,
          amount,
          price,
          signalTf,
          signalCandle,
          entryEmas,
          mergedExtraProps,
        );
        audioService.speak("自动开仓执行");
        if (onLog)
          onLog(
            "SUCCESS",
            `执行交易: ${cleanSymbol} ${side} | 原因: ${reason}`,
          );
        return true;
      }
    },
    [scannerMode, setPositions, onLog, onOpenPosition, selectedStrategyId],
  );

  // --- LIST 1 INSTANT OPEN AUTOMATION ---
  const list1OpenedSymbolsRef = useRef<Set<string>>(new Set());
  const list1LastTriggerTimeRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const instantOpen = scanConfig?.instantOpenEnabled;
    const instantOpenAfterClose = scanConfig?.instantReopenEnabled;
    const openDirection = scanConfig?.instantOpenDirection || "LONG";

    // 1. Clean up symbols that are no longer in list1Candidates to allow reopening if they drop out and come back
    const currentList1Symbols = new Set(list1Candidates.map(c => normalizeSymbol(c.symbol)));
    list1OpenedSymbolsRef.current.forEach(sym => {
      if (!currentList1Symbols.has(sym)) {
        list1OpenedSymbolsRef.current.delete(sym);
        delete list1LastTriggerTimeRef.current[sym];
      }
    });

    if (!instantOpen && !instantOpenAfterClose) {
      return;
    }

    const now = Date.now();

    list1Candidates.forEach(item => {
      const symbol = normalizeSymbol(item.symbol);
      const hasActivePosition = filteredPositions.some(p => normalizeSymbol(p.symbol) === symbol);

      if (hasActivePosition) {
        // If it currently has a position, mark it as opened so if instantOpen is true, we don't duplicate/re-open
        list1OpenedSymbolsRef.current.add(symbol);
        return;
      }

      // Prevent redundant triggers during state update latency with a 5-second cooldown
      const lastTrigger = list1LastTriggerTimeRef.current[symbol] || 0;
      if (now - lastTrigger < 5000) {
        return;
      }

      // If it does not have an active position:
      // Case A: instantOpenAfterClose is true -> always open if it is in list1
      // Case B: instantOpen is true AND we haven't opened it yet during its stay in list1 -> open
      const shouldOpen = instantOpenAfterClose || (instantOpen && !list1OpenedSymbolsRef.current.has(symbol));

      if (shouldOpen) {
        const price = resolvePrice(item.symbol, currentPrices, item.price);
        if (price > 0) {
          list1OpenedSymbolsRef.current.add(symbol);
          list1LastTriggerTimeRef.current[symbol] = now; // Set cooldown immediately to block immediate race conditions
          const side = openDirection === "SHORT" ? PositionSide.SHORT : PositionSide.LONG;
          console.log(`[List 1 Auto Open] Triggering trade for ${symbol} @ ${price} (${side})`);
          executeTradeSafe(
            symbol,
            side,
            price,
            `[List1 Auto] ${instantOpenAfterClose ? 'ReopenAfterClose' : 'InstantOpen'}`
          );
        }
      }
    });
  }, [list1Candidates, scanConfig, filteredPositions, currentPrices, executeTradeSafe]);

  const handleClosePositionInternal = useCallback(
    (symbol: string, side: PositionSide) => {
      if (scannerMode === "BACKTEST") {
        setPositions((prev) => {
          const pos = prev.find((p) => p.symbol === symbol && p.side === side);
          if (pos) {
            const pnl = pos.unrealizedPnL;
            setAccount((acc) => ({
              ...acc,
              totalBalance: acc.totalBalance + pnl,
              marginBalance: acc.marginBalance + pnl,
            }));
            setTradeLogs((logs) => [
              ...logs,
              {
                symbol,
                side,
                entryPrice: pos.entryPrice,
                exitPrice: pos.markPrice,
                pnl,
                pnlPercent: pos.unrealizedPnLPercentage,
                exitTime: virtualTimeRef.current,
                reason: "MANUAL",
              } as any,
            ]);
          }
          return prev.filter((p) => !(p.symbol === symbol && p.side === side));
        });
      } else {
        onClosePosition(symbol, side);
      }
    },
    [scannerMode, setPositions, setAccount, setTradeLogs, onClosePosition],
  );

  const handlePanicSell = useCallback(() => {
    if (scannerMode === "BACKTEST") {
      batchCloseAll();
      if (onLog) onLog("SUCCESS", "[回测] 全部清仓执行完毕");
    } else {
      filteredPositions.forEach((p) =>
        handleClosePositionInternal(p.symbol, p.side),
      );
      if (onLog) onLog("SUCCESS", "战术执行: 全部清仓 (PANIC SELL)");
    }
  }, [
    scannerMode,
    batchCloseAll,
    filteredPositions,
    handleClosePositionInternal,
    onLog,
  ]);

  const handleSecureProfit = useCallback(() => {
    const profitable = filteredPositions.filter((p) => p.unrealizedPnL > 0);
    profitable.forEach((p) => handleClosePositionInternal(p.symbol, p.side));
    if (profitable.length > 0 && onLog)
      onLog("INFO", `战术执行: 止盈落袋 (${profitable.length} 个仓位)`);
  }, [filteredPositions, handleClosePositionInternal, onLog]);

  const handleCutLosses = useCallback(() => {
    const losing = filteredPositions.filter((p) => p.unrealizedPnL < 0);
    losing.forEach((p) => handleClosePositionInternal(p.symbol, p.side));
    if (losing.length > 0 && onLog)
      onLog("INFO", `战术执行: 一键止损 (${losing.length} 个仓位)`);
  }, [filteredPositions, handleClosePositionInternal, onLog]);

  const handleCloseLongs = useCallback(() => {
    const longs = filteredPositions.filter((p) => p.side === PositionSide.LONG);
    longs.forEach((p) => handleClosePositionInternal(p.symbol, p.side));
    if (longs.length > 0 && onLog)
      onLog("INFO", `战术执行: 平多 (${longs.length} 个仓位)`);
  }, [filteredPositions, handleClosePositionInternal, onLog]);

  const handleCloseShorts = useCallback(() => {
    const shorts = filteredPositions.filter(
      (p) => p.side === PositionSide.SHORT,
    );
    shorts.forEach((p) => handleClosePositionInternal(p.symbol, p.side));
    if (shorts.length > 0 && onLog)
      onLog("INFO", `战术执行: 平空 (${shorts.length} 个仓位)`);
  }, [filteredPositions, handleClosePositionInternal, onLog]);

  const setScanConfig = useCallback(
    (update: React.SetStateAction<ScanConfig>) => {
      if (typeof update === "function") {
        if (activeMode === "24H") {
          setConfig24H((prev) => {
            const next = (update as any)(prev);
            if (next.timeBasis !== activeMode) {
              setTimeout(() => setActiveMode(next.timeBasis as any), 0);
            }
            return next;
          });
        } else {
          setConfig8AM((prev) => {
            const next = (update as any)(prev);
            if (next.timeBasis !== activeMode) {
              setTimeout(() => setActiveMode(next.timeBasis as any), 0);
            }
            return next;
          });
        }
      } else {
        if (update.timeBasis !== activeMode) {
          setTimeout(() => setActiveMode(update.timeBasis as any), 0);
        } else {
          activeMode === "24H" ? setConfig24H(update) : setConfig8AM(update);
        }
      }
    },
    [activeMode, setActiveMode, setConfig24H, setConfig8AM],
  );

  const safeSetChartData = useCallback((newData: any) => {
    // Merge with current list2Config to ensure chart analysis works in all modules
    setChartData({ ...newData, list2Config: scanConfigRef.current?.list2Config });
  }, []);

  const memoizedBacktestProps = useMemo(
    () => ({
      speed,
      setSpeed,
      intervals: backtestIntervals,
      setIntervals: setBacktestIntervals,
      isPlaying,
      onStart: () => {
        const symbols = useBacktestCustomOnly
          ? backtestCustomSymbols
              .split(",")
              .map((s) => s.trim().toUpperCase())
              .filter((s) => s)
          : list1Candidates.map((c) => c.symbol);
        handleStartBacktest(symbols);
      },
      onStop: handleStopBacktest,
      downloadRange,
      setDownloadRange: (r: any) => setDownloadRange(r),
      onDownload: handleDownloadData,
      isDownloading,
      syncProgress,
      virtualTime,
      customSymbols: backtestCustomSymbols,
      setCustomSymbols: setBacktestCustomSymbols,
      useCustomOnly: useBacktestCustomOnly,
      setUseCustomOnly: setUseBacktestCustomOnly,
    }),
    [
      speed,
      setSpeed,
      backtestIntervals,
      setBacktestIntervals,
      isPlaying,
      handleStartBacktest,
      list1Candidates,
      handleStopBacktest,
      downloadRange,
      setDownloadRange,
      handleDownloadData,
      isDownloading,
      syncProgress,
      virtualTime,
      backtestCustomSymbols,
      setBacktestCustomSymbols,
      useBacktestCustomOnly,
      setUseBacktestCustomOnly,
    ],
  );

  const prevIsVisibleRef = useRef(isVisible);
  useEffect(() => {
    if (isVisible && !prevIsVisibleRef.current) {
      setIsMinimized(false);
    }
    prevIsVisibleRef.current = isVisible;
  }, [isVisible]);

  const containerStyle: React.CSSProperties = {
    display: isVisible ? "block" : "none",
  };

  return (
    <div style={containerStyle}>
      {/* Minimized View */}
      <div
        className={`fixed bottom-6 right-6 transition-opacity duration-300 ${isMinimized ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        style={{ zIndex: 100 }}
        onClick={() => setIsMinimized(false)}
      >
        <div className="bg-[#0b0e11] border border-slate-700 rounded-lg shadow-2xl p-3 flex items-center gap-3 cursor-pointer hover:border-indigo-500 hover:shadow-indigo-500/20 transition-all">
          <Activity size={20} className="text-indigo-400 animate-pulse" />
          <div className="text-xs font-bold text-white">
            {scannerMode === "BACKTEST" ? "回测引擎运行中" : "扫描终端运行中"}
          </div>
          <Maximize2 size={16} className="text-slate-500" />
        </div>
      </div>

      {/* Full View */}
      <div
        className={`fixed inset-0 bg-black/90 backdrop-blur-sm items-center justify-center p-4 ${isMinimized ? "hidden" : "flex"}`}
        style={{ zIndex: 100 }}
      >
        <div className="bg-[#0b0e11] w-full h-full max-w-[1800px] rounded-xl border border-slate-800 shadow-2xl flex flex-col overflow-hidden">
          {/* Top Bar */}
          <div
            className={`flex items-center justify-between p-3 border-b border-slate-800 transition-colors ${scannerMode === "BACKTEST" ? "bg-amber-950/30" : "bg-[#161a25]"}`}
          >
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Crosshair
                  size={20}
                  className={
                    scannerMode === "BACKTEST"
                      ? "text-amber-500"
                      : scannerMode === "SMART"
                        ? "text-purple-500"
                        : "text-indigo-500"
                  }
                />
                {scannerMode === "BACKTEST"
                  ? "回测模式终端 (BACKTEST)"
                  : scannerMode === "SMART"
                    ? "智能选币终端 (SMART SELECTION)"
                    : "全域扫描终端 (SCANNER)"}
              </h2>
              {scannerMode !== "BACKTEST" && isRealTrading && (
                <div className="flex items-center gap-1.5 bg-emerald-950/50 border border-emerald-500/35 rounded px-2.5 py-1 animate-pulse shrink-0">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.9)]" />
                  <span className="text-xs text-emerald-400 font-bold tracking-wider font-sans">当前正在实盘交易</span>
                </div>
              )}
              {scannerMode !== "BACKTEST" && networkStatus && (
                <NetworkWidget networkStatus={networkStatus} />
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowLogPanel(!showLogPanel)}
                className={`p-2 rounded transition-colors ${showLogPanel ? "bg-indigo-600/20 text-indigo-400" : "hover:bg-slate-800 text-slate-400 hover:text-white"}`}
                title="切换日志面板"
              >
                <Activity size={20} />
              </button>
              <button
                onClick={() => setIsMinimized(true)}
                className="p-2 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
              >
                <Minus size={20} />
              </button>
              <button
                onClick={onClose}
                className="p-2 hover:bg-red-900/50 rounded text-slate-400 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {networkStatus === 'disconnected' && (
            <div className="bg-red-950/80 border-b border-red-500/50 px-4 py-2.5 flex items-center justify-between text-red-200 text-xs font-semibold animate-pulse">
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
                <span>警告：服务器行情链接断开！为防止白屏/高频重连死机，全域扫描已自动挂起。等待网络恢复后功能将自动重启恢复。</span>
              </div>
              <button 
                onClick={() => {
                  audioService.speak("警告：网络链接断开，全域扫描已自动挂起", true);
                  audioService.playAlert();
                }}
                className="bg-red-900 border border-red-500/30 text-white rounded px-2.5 py-0.5 text-[10px] font-bold hover:bg-red-800 hover:border-red-400 transition-all cursor-pointer flex items-center gap-1 shrink-0"
              >
                🔊 测试防爆鸣声音
              </button>
            </div>
          )}

          {isRealTrading && scannerMode !== 'BACKTEST' && (
            <div className="bg-emerald-950/80 border-b border-emerald-500/30 px-4 py-2.5 flex items-center justify-between text-emerald-200 text-[11px] font-sans">
              <div className="flex items-center gap-2">
                <span className="flex h-2.5 w-2.5 relative shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.9)]"></span>
                </span>
                <span>
                  🔥 <b>系统当前正处于【实盘交易模式】！</b> 所有全域扫描、自动选币以及审核流水线均已成功绑定并监听您的 Binance 真实 API。
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[9px] px-2 py-0.5 rounded font-mono font-bold uppercase animate-pulse">
                  API_ACTIVE_LIVE
                </span>
              </div>
            </div>
          )}

          {isUnconfigured && (
            <div className="bg-indigo-950/85 border-b border-indigo-500/30 px-4 py-2.5 flex flex-col sm:flex-row items-start sm:items-center justify-between text-indigo-200 text-[11px] font-sans gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 relative shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                </span>
                <span>
                  💡 <b>这是一个全新创建的自动选币（策略）</b>。当前状态：<b>【未配置 / 参数默认为空】</b>。
                  为保持干净环境，列表 1、2、3、4、5、6 已全部置空。请点击 <b>【导入策略】</b> 或右侧 <b>【激活并手动配置】</b> 载入基础运行参数。
                </span>
              </div>
              <button
                onClick={handleActivateStrategy}
                className="bg-indigo-600 hover:bg-indigo-500 border border-indigo-400 text-white rounded px-3 py-1 text-xs font-bold transition-all cursor-pointer shadow-lg shadow-indigo-950/50 flex items-center gap-1 shrink-0"
              >
                ✨ 激活并手动配置
              </button>
            </div>
          )}

          <div className="flex-1 flex overflow-x-auto overflow-y-hidden bg-[#0b0e11] scrollbar-thin scrollbar-thumb-slate-800">
            <ErrorBoundary moduleName="1. 市场初筛">
              <MarketScannerModule
                key={selectedStrategyId}
                onCandidatesUpdate={handleList1Results}
                setChartData={safeSetChartData}
                directMode={directMode}
                scanConfig={scanConfig}
                setScanConfig={setScanConfig}
                mode={scannerMode}
                setMode={setScannerMode}
                onStartBacktest={handleStartBacktest}
                isSyncing={!!syncProgress}
                backtestProps={memoizedBacktestProps}
                strategies={strategies}
                selectedStrategyId={selectedStrategyId}
                onSelectStrategy={handleSelectStrategy}
                onAddStrategy={handleAddStrategy}
                onDeleteStrategy={handleDeleteStrategy}
                onRenameStrategy={handleRenameStrategy}
                onExportStrategy={handleExportStrategy}
                onImportStrategy={handleImportStrategy}
              />
            </ErrorBoundary>

            <ErrorBoundary moduleName="2. 均线穿越">
              {isUnconfigured ? (
                <UnconfiguredColumn
                  title="2. 均线穿越 (CROSSOVER)"
                  description="当前自动选币属于全新创建。金叉/死叉与压缩区间监控参数尚未载入。请导入配置，或在上方点击激活并载入基础运行参数。"
                />
              ) : scannerMode === "BACKTEST" ? (
                <BacktestGrandCrossingModule
                  candidates={list1Candidates}
                  onResultsUpdate={handleList2Results}
                  scanConfig={scanConfig}
                  setScanConfig={setScanConfig}
                  setChartData={safeSetChartData}
                  directMode={directMode}
                  onLog={onLog}
                  onRemoveSignalReady={(fn) => {
                    list2RemoveSignalRef.current = fn;
                  }}
                />
              ) : (
                <MemoizedGrandCrossingModule
                  key={selectedStrategyId}
                  networkStatus={networkStatus}
                  candidates={list1Candidates}
                  onResultsUpdate={handleList2Results}
                  scanConfig={scanConfig}
                  setScanConfig={setScanConfig}
                  setChartData={safeSetChartData}
                  directMode={directMode}
                  onLog={onLog}
                  onRemoveSignalReady={(fn) => {
                    list2RemoveSignalRef.current = fn;
                  }}
                  strategyId={selectedStrategyId}
                />
              )}
            </ErrorBoundary>

            <ErrorBoundary moduleName="3. 结构审计">
              {isUnconfigured ? (
                <UnconfiguredColumn
                  title="3. 结构审计 (STRUCTURE)"
                  description="当前自动选币属于全新创建。二次支撑、阻力与趋势审计参数尚未载入。请导入配置，或在上方点击激活并载入基础运行参数。"
                />
              ) : scannerMode === "BACKTEST" ? (
                <BacktestStructureAuditModule
                  candidates={list2Results}
                  onResultsUpdate={handleList3Results}
                  onConfigUpdate={setList3Config}
                  onRemoveSignalReady={(fn) => {
                    removeSignalRef.current = fn;
                  }}
                  realPrices={currentPrices}
                  setChartData={safeSetChartData}
                  executeTradeSafe={executeTradeSafe}
                  activePositions={filteredPositions}
                  directMode={directMode}
                  actionConfig={actionConfig}
                />
              ) : (
                <MemoizedStructureAuditModule
                  key={selectedStrategyId}
                  candidates={list2Results}
                  onResultsUpdate={handleList3Results}
                  onConfigUpdate={setList3Config}
                  onRemoveSignalReady={(fn) => {
                    removeSignalRef.current = fn;
                  }}
                  realPrices={currentPrices}
                  setChartData={safeSetChartData}
                  executeTradeSafe={executeTradeSafe}
                  activePositions={filteredPositions}
                  directMode={directMode}
                  actionConfig={actionConfig}
                  strategyId={selectedStrategyId}
                />
              )}
            </ErrorBoundary>

            <ErrorBoundary moduleName="4. 动能审计">
              {isUnconfigured ? (
                <UnconfiguredColumn
                  title="4. 动能审计 (MOMENTUM)"
                  description="当前自动选币属于全新创建。突破突破监控、防追高熔断与动态方向锁等监控参数尚未载入。请导入配置，或在上方点击激活并载入基础运行参数。"
                />
              ) : scannerMode === "BACKTEST" ? (
                <BacktestMomentumAuditModule
                  candidates={list3Results}
                  setChartData={safeSetChartData}
                  executeTradeSafe={executeTradeSafe}
                  list3Config={list3Config}
                  realPrices={currentPrices}
                  activePositions={filteredPositions}
                  onRemoveSignal={handleRemoveSignal}
                  actionConfig={actionConfig}
                  onLog={onLog}
                />
              ) : (
                <MemoizedMomentumAuditModule
                  key={selectedStrategyId}
                  candidates={list3Results}
                  setChartData={safeSetChartData}
                  executeTradeSafe={executeTradeSafe}
                  list3Config={list3Config}
                  realPrices={currentPrices}
                  activePositions={filteredPositions}
                  onRemoveSignal={handleRemoveSignal}
                  actionConfig={actionConfig}
                  onLog={onLog}
                  strategyId={selectedStrategyId}
                />
              )}
            </ErrorBoundary>

            <ErrorBoundary moduleName="5. 战场实况">
              {isUnconfigured ? (
                <UnconfiguredColumn
                  title="5. 战场实况 (BATTLEFIELD)"
                  description="当前自动选币属于全新创建，没有任何持仓。策略激活并生成交易信号开仓后，持仓将在此显示。"
                />
              ) : (
                <LiveBattlefieldModule
                  key={selectedStrategyId}
                  positions={filteredPositions}
                  realPrices={currentPrices}
                  setChartData={safeSetChartData}
                  onClosePosition={handleClosePositionInternal}
                  onStatsUpdate={handleLiveStatsUpdate}
                />
              )}
            </ErrorBoundary>

            <ErrorBoundary moduleName="6. 战术终端">
              {isUnconfigured ? (
                <UnconfiguredColumn
                  title="6. 战术终端 (COMMAND)"
                  description="当前自动选币属于全新创建。单仓金额、杠杆、自动/变量开仓、防爆熔断器等终端参数尚未载入。请导入配置，或在上方点击激活并载入基础运行参数。"
                />
              ) : (
                <TacticalCommandModule
                  key={selectedStrategyId}
                  currentStats={liveStats}
                  onConfigUpdate={setActionConfig}
                  onPanicSell={handlePanicSell}
                  onSecureProfit={handleSecureProfit}
                  onCutLosses={handleCutLosses}
                  onCloseLongs={handleCloseLongs}
                  onCloseShorts={handleCloseShorts}
                  strategyId={selectedStrategyId}
                />
              )}
            </ErrorBoundary>
          </div>

          {/* Bottom Log Panel */}
          {showLogPanel && (
            <div className="h-32 border-t border-slate-800 bg-[#0b0e11] flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1 bg-slate-900/50 border-b border-slate-800">
                <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1.5">
                  <Activity size={10} /> 系统运行日志
                </span>
                <button
                  onClick={() => setShowLogPanel(false)}
                  className="text-slate-500 hover:text-white transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 font-mono text-[10px] space-y-1 scrollbar-thin scrollbar-thumb-slate-800">
                {logs.length === 0 ? (
                  <div className="text-slate-600 italic">暂无日志记录...</div>
                ) : (
                  logs.map((log, i) => (
                    <div
                      key={log.id || i}
                      className="flex gap-2 animate-in fade-in slide-in-from-left-1"
                    >
                      <span className="text-slate-500 shrink-0">
                        [{new Date(log.timestamp).toLocaleTimeString()}]
                      </span>
                      <span
                        className={`font-bold shrink-0 ${
                          log.type === "SUCCESS"
                            ? "text-emerald-500"
                            : log.type === "DANGER"
                              ? "text-red-500"
                              : log.type === "WARNING"
                                ? "text-amber-500"
                                : "text-blue-400"
                        }`}
                      >
                        [{log.type}]
                      </span>
                      <span className="text-slate-300 break-all">
                        {log.message}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {chartData && (
        <KlineChartModal
          key={`${chartData.symbol}-${chartData.tf}`}
          symbol={chartData.symbol}
          initialTimeframe={chartData.tf}
          signals={chartData.signals}
          entryPrice={chartData.entryPrice}
          entryTime={chartData.entryTime}
          currentPrice={chartData.currentPrice}
          list2Config={chartData.list2Config}
          highlightTime={chartData.highlightTime}
          extraLines={chartData.extraLines}
          directMode={directMode}
          showAuditLines={chartData.showAuditLines}
          appearedTime={chartData.appearedTime}
          disappearedTime={chartData.disappearedTime}
          onClose={() => setChartData(null)}
        />
      )}
    </div>
  );
};

export const ScannerDashboard: React.FC<Props> = (props) => {
  const [backtestKlines, setBacktestKlines] = useState<
    Record<string, Record<string, KLine[]>>
  >({});

  return (
    <BacktestProvider
      klinesMap={backtestKlines}
      initialBalance={props.balance}
      settings={props.settings as any}
    >
      <ScannerDashboardInner {...props} setBacktestKlines={setBacktestKlines} />
    </BacktestProvider>
  );
};
