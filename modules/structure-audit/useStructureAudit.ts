import { useState, useRef, useEffect, useCallback } from "react";
import { usePersistedState } from "../../hooks/usePersistedState";
import {
  ScannerItem,
  List3Config,
  List3SignalResult,
  StructureScanStatus,
} from "../../components/Scanner/scannerTypes";
import { analyzeList3Structure } from "../../services/rules/list3_structure";
import { fetchWithFallback } from "../../services/apiService";
import { KLineSynthesizer } from "../../services/klineSynthesizer";
import { KLine } from "../../types";
import { saveState } from "../../utils/persistence";
import { normalizeSymbol } from "../../services/symbolUtils";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getTfMinutes = (tf: string) => {
  const unit = tf.slice(-1);
  const val = parseInt(tf);
  if (unit === "m") return val;
  if (unit === "h") return val * 60;
  if (unit === "d") return val * 1440;
  return 0;
};

export const useStructureAudit = (
  candidates: ScannerItem[], // Input from List 2
  initialConfig: List3Config,
  realPrices: Record<string, number>,
  directMode: boolean = false,
  strategyId?: string,
) => {
  const suffix = strategyId ? `_${strategyId}` : "";
  const configKey = `SCANNER_LIST3_CONFIG${suffix}`;
  const cacheMapKey = `SCANNER_LIST3_CACHE_MAP${suffix}`;
  const expiredSignalsKey = `SCANNER_LIST3_EXPIRED_SIGNALS${suffix}`;

  // --- STATE ---
  const [config, setConfig] = usePersistedState<List3Config>(
    configKey,
    initialConfig,
  );

  // Ensure timeframes is sanitized & never empty
  useEffect(() => {
    let modified = false;
    let newTfs = [...(config.timeframes || [])];
    if (newTfs.includes("1m") || newTfs.includes("3m")) {
      newTfs = newTfs.filter((t) => t !== "1m" && t !== "3m");
      modified = true;
    }
    if (!newTfs.includes("8h")) {
      newTfs.push("8h");
      modified = true;
    }
    if (!newTfs.includes("1d")) {
      newTfs.push("1d");
      modified = true;
    }
    if (modified || !config.timeframes || config.timeframes.length === 0) {
      setConfig((prev) => ({
        ...prev,
        timeframes:
          newTfs.length > 0
            ? newTfs
            : ["5m", "15m", "30m", "1h", "2h", "4h", "8h", "1d"],
      }));
    }
  }, [config.timeframes, setConfig]);

  const [list3, setList3] = useState<ScannerItem[]>(() => {
    try {
      const saved = localStorage.getItem(cacheMapKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const allItems = parsed.map((item: any) => item.value);
          allItems.sort(
            (a: any, b: any) =>
              (b.list3Results?.length || 0) - (a.list3Results?.length || 0),
          );
          return allItems;
        }
      }
    } catch (e) {}
    return [];
  });
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<StructureScanStatus | null>(
    null,
  );
  const [countdowns, setCountdowns] = useState<Record<string, string>>({});

  // --- REFS ---
  const cacheRef = useRef<Map<string, ScannerItem>>(
    new Map(
      (() => {
        try {
          const saved = localStorage.getItem(cacheMapKey);
          if (saved) {
            const parsed = JSON.parse(saved);
            return Array.isArray(parsed)
              ? parsed.map((item: any) => [item.key, item.value])
              : [];
          }
        } catch (e) {}
        return [];
      })(),
    ),
  );
  const lastUpdateRef = useRef<string>("");
  const configRef = useRef(config);
  const candidatesRef = useRef(candidates);
  const isScanningRef = useRef(false);
  const pendingItemsRef = useRef<ScannerItem[]>([]);
  const lastCandleScanRef = useRef<Map<string, number>>(new Map());
  const expiredSignalCacheRef = useRef<Set<string>>(
    new Set(
      (() => {
        try {
          const saved = localStorage.getItem(expiredSignalsKey);
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
              return parsed.filter((i) => typeof i === "string");
            }
          }
          return [];
        } catch (e) {
          return [];
        }
      })(),
    ),
  ); // Track permanently removed signals
  const structureHashRef = useRef<Map<string, string>>(
    new Map(
      (() => {
        try {
          const saved = localStorage.getItem(cacheMapKey);
          if (saved) {
            const parsed = JSON.parse(saved);
            return Array.isArray(parsed)
              ? parsed.map((item: any) => {
                  const hash = item.value.groupedResults
                    ? item.value.groupedResults
                        .map(
                          (r: any) =>
                            `${r.tf}:${r.direction}:${r.crossingCount}`,
                        )
                        .join("|")
                    : "";
                  return [item.key, hash];
                })
              : [];
          }
        } catch (e) {}
        return [];
      })(),
    ),
  );

  // PERFORMANCE FIX: Use Ref for prices to prevent re-creating runAnalysisInternal on every tick
  const realPricesRef = useRef(realPrices);

  // EXTREMES CACHE: Cache 1h/1m historical extremes in memory to prevent hammering Binance REST endpoints
  const extremesCacheRef = useRef<Map<string, any>>(new Map());

  useEffect(() => {
    configRef.current = config;
  }, [config]);
  useEffect(() => {
    candidatesRef.current = candidates;
  }, [candidates]);
  useEffect(() => {
    realPricesRef.current = realPrices;
  }, [realPrices]);

  const getStructureHash = (item: ScannerItem) => {
    if (!item.groupedResults) return "";
    // Include crossingLags to detect signal "aging" (e.g. from lag 0 to lag 1 on candle close)
    return item.groupedResults
      .map((r) => `${r.tf}:${r.direction}:${r.crossingLags?.join(",")}`)
      .join("|");
  };

  const processStructureForTf = (
    item: ScannerItem,
    tf: string,
    klines: KLine[],
    livePrice: number,
    historyExtremes?: any,
  ) => {
    const closes = klines.map((k: any) => k.close);
    const highs = klines.map((k: any) => k.high);
    const lows = klines.map((k: any) => k.low);
    const opens = klines.map((k: any) => k.open);
    const volumes = klines.map((k: any) => k.volume);

    let periodChange = 0;
    if (closes.length > 0)
      periodChange =
        ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;

    const resultsForTf = item
      .groupedResults!.filter((r) => r.tf === tf)
      .sort((a, b) => (b.lag || 0) - (a.lag || 0));

    for (const gr of resultsForTf) {
      const uniqueId = `${item.symbol}-${tf}-${gr.direction}`;
      if (expiredSignalCacheRef.current.has(uniqueId)) {
        continue;
      }

      const latestTime = gr.crossingTimes
        ? Math.max(...gr.crossingTimes)
        : klines[klines.length - 1].time;

      // Re-map KLine back to Binance raw format for internal rule consumption if needed
      // (The rules often expectation raw array format [time, open, high, low, close, vol])
      const rawKlines = klines.map((k) => [
        k.time,
        k.open,
        k.high,
        k.low,
        k.close,
        k.volume,
      ]);

      const result3 = analyzeList3Structure(
        {
          symbol: item.symbol,
          tf,
          direction: gr.direction!,
          time: latestTime,
          price: livePrice,
          periodChange,
        },
        closes,
        highs,
        lows,
        opens,
        volumes,
        configRef.current,
        rawKlines as any,
      );

      if (result3) {
        let cached: ScannerItem = cacheRef.current.get(item.symbol) || {
          ...item,
          list3Results: [],
        };
        if (!cached.list3Results) cached.list3Results = [];

        const entry: List3SignalResult = {
          tf: result3.tf!,
          direction: result3.direction! as any,
          structure: result3.structure!,
        };

        const s = entry.structure;
        const cfg = configRef.current;
        const areAllRulesOff = !cfg.strictTrend && !cfg.checkCandleColor && !cfg.enableAmplitudeAudit && (cfg.enableRsi === false);
        
        let passes = true;
        if (!areAllRulesOff) {
            if (cfg.strictTrend && !s.isStrictTrend) passes = false;
            if (cfg.checkCandleColor && !s.isColorValid) passes = false;
            if (cfg.enableAmplitudeAudit) {
              if (s.locationPct > cfg.maxLocation) passes = false;
              if (s.crossCount < cfg.minCrossCount) passes = false;
              if (s.bbw > cfg.maxBBW) passes = false;
            }
            if (cfg.enableRsi !== false) {
              if (entry.direction === "LONG") {
                if (s.rsi < cfg.rsiLongMin || s.rsi > cfg.rsiLongMax)
                  passes = false;
              } else {
                if (s.rsi < cfg.rsiShortMin || s.rsi > cfg.rsiShortMax)
                  passes = false;
              }
            }
        }
        
        if (
          cfg.timeframes &&
          cfg.timeframes.length > 0 &&
          !cfg.timeframes.includes(entry.tf)
        )
          passes = false;

        const idx = cached.list3Results.findIndex(
          (r) => r.tf === entry.tf && r.direction === entry.direction,
        );
        if (idx >= 0) {
          entry.latched = cached.list3Results[idx].latched || passes;
          cached.list3Results[idx] = entry;
        } else {
          entry.latched = passes;
          cached.list3Results.push(entry);
        }

        cached.price = livePrice;
        if (historyExtremes) cached.historyExtremes = historyExtremes;
        cacheRef.current.set(item.symbol, cached);
      }
    }

    if (configRef.current.enableMultiResonance) {
      const rawKlines = klines.map((k) => [
        k.time,
        k.open,
        k.high,
        k.low,
        k.close,
        k.volume,
      ]);
      let cached: ScannerItem = cacheRef.current.get(item.symbol) || {
        ...item,
        list3Results: [],
      };
      if (!cached.adjacentStrictTrends) cached.adjacentStrictTrends = {};

      // Evaluate LONG trend for this tf
      const resultLong = analyzeList3Structure(
        {
          symbol: item.symbol,
          tf,
          direction: "LONG",
          time: klines[klines.length - 1].time,
          price: livePrice,
          periodChange,
        },
        closes,
        highs,
        lows,
        opens,
        volumes,
        configRef.current,
        rawKlines as any,
      );
      if (resultLong?.structure?.isStrictTrend) {
        cached.adjacentStrictTrends[`${tf}-LONG`] = true;
      } else {
        cached.adjacentStrictTrends[`${tf}-LONG`] = false;
      }

      // Evaluate SHORT trend for this tf
      const resultShort = analyzeList3Structure(
        {
          symbol: item.symbol,
          tf,
          direction: "SHORT",
          time: klines[klines.length - 1].time,
          price: livePrice,
          periodChange,
        },
        closes,
        highs,
        lows,
        opens,
        volumes,
        configRef.current,
        rawKlines as any,
      );
      if (resultShort?.structure?.isStrictTrend) {
        cached.adjacentStrictTrends[`${tf}-SHORT`] = true;
      } else {
        cached.adjacentStrictTrends[`${tf}-SHORT`] = false;
      }

      cacheRef.current.set(item.symbol, cached);
    }
  };

  // --- EFFECT: UI Countdowns ---
  useEffect(() => {
    const ALL_TFS = ["5m", "15m", "30m", "1h", "2h", "4h", "8h", "1d"];
    const timer = setInterval(() => {
      const now = Date.now();
      const newCounts: Record<string, string> = {};
      ALL_TFS.forEach((tf) => {
        const tfMinutes = getTfMinutes(tf);
        if (tfMinutes > 0) {
          const intervalMs = tfMinutes * 60 * 1000;
          const nextClose = Math.ceil(now / intervalMs) * intervalMs;
          const diff = nextClose - now;
          newCounts[tf] =
            diff > 0
              ? `${Math.floor(diff / 60000)
                  .toString()
                  .padStart(2, "0")}:${Math.floor((diff % 60000) / 1000)
                  .toString()
                  .padStart(2, "0")}`
              : "00:00";
        }
      });
      setCountdowns(newCounts);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const updateList3FromCache = useCallback(() => {
    const allItems: ScannerItem[] = Array.from(cacheRef.current.values());
    allItems.sort(
      (a, b) => (b.list3Results?.length || 0) - (a.list3Results?.length || 0),
    );

    // Only update state if list actually changed
    const currentListStr = JSON.stringify(allItems);
    if (currentListStr !== lastUpdateRef.current) {
      setList3(allItems);
      lastUpdateRef.current = currentListStr;
    }

    // Persist to localStorage
    const cacheArray = Array.from(cacheRef.current.entries()).map(
      ([key, value]) => ({ key, value }),
    );
    saveState(cacheMapKey, cacheArray, 200); // Cap list 3 cache
    saveState(
      expiredSignalsKey,
      Array.from(expiredSignalCacheRef.current),
      1000,
    ); // Cap expired
  }, []);

  // --- PRIORITY DIRECT ANALYZER (No block, no batching, full parallel timeframe/item requests for zero latency) ---
  const runPriorityAnalysisInternal = useCallback(
    async (itemsToScan: ScannerItem[], triggerReason: string) => {
      if (itemsToScan.length === 0) return;

      console.log(`[List3 Priority] Starting ultra-fast priority analysis for ${itemsToScan.length} items. Reason: ${triggerReason}`);

      try {
        let hasChanges = false;

        // Process all priority items concurrently for maximum speed
        await Promise.all(
          itemsToScan.map(async (item) => {
            if (!item.symbol || item.symbol === "USDT" || item.symbol.trim() === "") return;
            if (!item.groupedResults) return;

            const neededTFs = new Set<string>();
            item.groupedResults.forEach((r) => {
              if (configRef.current.timeframes.includes(r.tf)) {
                neededTFs.add(r.tf);
                if (configRef.current.enableMultiResonance) {
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
                  const idx = ALL_TFS.indexOf(r.tf);
                  if (idx > 0) neededTFs.add(ALL_TFS[idx - 1]);
                  if (idx < ALL_TFS.length - 1)
                    neededTFs.add(ALL_TFS[idx + 1]);
                }
              }
            });

            if (neededTFs.size === 0) return;

            const livePrice =
              realPricesRef.current[normalizeSymbol(item.symbol)] ||
              realPricesRef.current[item.symbol] ||
              item.price;

            // Fetch history extremes (for Anti-Chase)
            const cachedItem = cacheRef.current.get(item.symbol);
            let historyExtremes =
              item.historyExtremes || cachedItem?.historyExtremes;

            if (!historyExtremes) {
              try {
                const safeSymbol = item.symbol.endsWith("USDT")
                  ? item.symbol
                  : `${item.symbol}USDT`;
                const url1h = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=1h&limit=1000&_t=${Date.now()}`;
                const url4h = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=4h&limit=540&_t=${Date.now()}`;
                const url1m = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=1m&limit=1440&_t=${Date.now()}`;

                const [res1h, res4h, res1m] = await Promise.all([
                  fetchWithFallback(
                    url1h,
                    { cache: "no-store" },
                    (d) => Array.isArray(d),
                    directMode,
                  ),
                  fetchWithFallback(
                    url4h,
                    { cache: "no-store" },
                    (d) => Array.isArray(d),
                    directMode,
                  ),
                  fetchWithFallback(
                    url1m,
                    { cache: "no-store" },
                    (d) => Array.isArray(d),
                    directMode,
                  ),
                ]);

                const raw1h = await res1h.json();
                const raw4h = await res4h.json();
                const raw1m = await res1m.json();

                const h1h = raw1h.map((k: any) => parseFloat(k[2]));
                const l1h = raw1h.map((k: any) => parseFloat(k[3]));
                const h1m = raw1m.map((k: any) => parseFloat(k[2]));
                const l1m = raw1m.map((k: any) => parseFloat(k[3]));

                const oldest1hTime = raw1h.length > 0 ? raw1h[0][0] : Date.now();
                const olderHighs: number[] = [];
                const olderLows: number[] = [];

                raw4h.forEach((k: any) => {
                  if (k[0] < oldest1hTime) {
                    const h = parseFloat(k[2]);
                    const l = parseFloat(k[3]);
                    for (let j = 0; j < 4; j++) {
                      olderHighs.push(h);
                      olderLows.push(l);
                    }
                  }
                });

                const combinedHighs = [...olderHighs, ...h1h].slice(-2200);
                const combinedLows = [...olderLows, ...l1h].slice(-2200);

                const calcExtreme = (
                  arr: number[],
                  candles: number,
                  type: "MAX" | "MIN",
                ) => {
                  if (!arr || arr.length === 0) return 0;
                  const slice = arr.slice(-candles);
                  return type === "MAX"
                    ? Math.max(...slice)
                    : Math.min(...slice);
                };

                historyExtremes = {
                  highs1h: combinedHighs,
                  lows1h: combinedLows,
                  highs1m: h1m,
                  lows1m: l1m,
                  scalars: {
                    low_5m: calcExtreme(l1m, 5, "MIN"),
                    high_5m: calcExtreme(h1m, 5, "MAX"),
                    low_60m: calcExtreme(l1m, 60, "MIN"),
                    high_60m: calcExtreme(h1m, 60, "MAX"),
                    low_240m: calcExtreme(l1m, 240, "MIN"),
                    high_240m: calcExtreme(h1m, 240, "MAX"),
                    low_1440m: calcExtreme(l1m, 1440, "MIN"),
                    high_1440m: calcExtreme(h1m, 1440, "MAX"),
                    low_10080m: calcExtreme(combinedLows, 168, "MIN"),
                    high_10080m: calcExtreme(combinedHighs, 168, "MAX"),
                    low_43200m: calcExtreme(combinedLows, 720, "MIN"),
                    high_43200m: calcExtreme(combinedHighs, 720, "MAX"),
                  },
                };
              } catch (e) {
                console.warn(
                  `[List3 Priority] Failed to fetch extremes for ${item.symbol}`
                );
              }
            }

            const tfList = Array.from(neededTFs);
            const synthesizable = tfList.filter(
              (tf) => getTfMinutes(tf) <= 5
            );
            const remotes = tfList.filter((tf) => getTfMinutes(tf) > 5);

            let cache1m: KLine[] | null = null;

            // A. Synthesizable (1m, 3m, 5m) - Process concurrently
            if (synthesizable.length > 0) {
              try {
                const safeSymbol = item.symbol.endsWith("USDT")
                  ? item.symbol
                  : `${item.symbol}USDT`;
                const url1m = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=1m&limit=1000&_t=${Date.now()}`;
                const res1m = await fetchWithFallback(
                  url1m,
                  { cache: "no-store" },
                  (d) => Array.isArray(d),
                  directMode,
                );
                if (res1m.ok) {
                  const raw1m = await res1m.json();
                  cache1m = raw1m.map((k: any) => ({
                    time: Number(k[0]),
                    open: parseFloat(k[1]),
                    high: parseFloat(k[2]),
                    low: parseFloat(k[3]),
                    close: parseFloat(k[4]),
                    volume: parseFloat(k[5]),
                  }));

                  synthesizable.forEach((tf) => {
                    lastCandleScanRef.current.set(
                      `${item.symbol}-${tf}`,
                      Date.now(),
                    );
                    const synthKlines = KLineSynthesizer.synthesize(
                      cache1m!,
                      getTfMinutes(tf),
                    );
                    processStructureForTf(
                      item,
                      tf,
                      synthKlines,
                      livePrice,
                      historyExtremes,
                    );
                    hasChanges = true;
                  });
                }
              } catch (e) {}
            }

            // B. Remotes (> 5m) - Fetch and analyze ALL remote timeframes in parallel!
            if (remotes.length > 0) {
              await Promise.all(
                remotes.map(async (tf) => {
                  lastCandleScanRef.current.set(
                    `${item.symbol}-${tf}`,
                    Date.now(),
                  );
                  try {
                    const safeSymbol = item.symbol.endsWith("USDT")
                      ? item.symbol
                      : `${item.symbol}USDT`;
                    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=${tf}&limit=500&_t=${Date.now()}`;
                    const res = await fetchWithFallback(
                      url,
                      { cache: "no-store" },
                      (d) => Array.isArray(d),
                      directMode,
                    );
                    if (res.ok) {
                      const raw = await res.json();
                      const klines: KLine[] = raw.map((k: any) => ({
                        time: Number(k[0]),
                        open: parseFloat(k[1]),
                        high: parseFloat(k[2]),
                        low: parseFloat(k[3]),
                        close: parseFloat(k[4]),
                        volume: parseFloat(k[5]),
                      }));
                      processStructureForTf(
                        item,
                        tf,
                        klines,
                        livePrice,
                        historyExtremes,
                      );
                      hasChanges = true;
                    }
                  } catch (e) {}
                })
              );
            }

            structureHashRef.current.set(item.symbol, getStructureHash(item));

            // [MILLISECOND-LEVEL FAILURE CLEARANCE]
            // If some rules are selected, and this coin has 0 latched results, immediately clear/remove it!
            const cfg = configRef.current;
            const areAllRulesOff = !cfg.strictTrend && !cfg.checkCandleColor && !cfg.enableAmplitudeAudit && (cfg.enableRsi === false);
            if (!areAllRulesOff) {
              const cachedItem = cacheRef.current.get(item.symbol);
              if (cachedItem && cachedItem.list3Results) {
                const hasPassedAny = cachedItem.list3Results.some(r => r.latched);
                if (!hasPassedAny) {
                  console.log(`[List3 Priority] ❌ ${item.symbol} 未能通过过滤规则，立即清除!`);
                  cacheRef.current.delete(item.symbol);
                  hasChanges = true;
                }
              }
            }
          })
        );

        if (hasChanges) {
          updateList3FromCache();
        }
      } catch (e) {
        console.error("[List3 Priority] Priority scan error:", e);
      }
    },
    [updateList3FromCache]
  );

  // --- CORE LOGIC: Analysis ---
  const runAnalysisInternal = useCallback(
    async (itemsToScan: ScannerItem[], triggerReason: string) => {
      if (itemsToScan.length === 0) return;

      // If already scanning, add to pending and return
      if (isScanningRef.current) {
        const currentPending = pendingItemsRef.current;
        const newPending = [...currentPending];
        itemsToScan.forEach((item) => {
          if (!newPending.some((p) => p.symbol === item.symbol)) {
            newPending.push(item);
          }
        });
        pendingItemsRef.current = newPending;
        console.log(
          `[List3] Busy. Queued ${itemsToScan.length} items for later audit.`,
        );
        return;
      }

      isScanningRef.current = true;
      setIsScanning(true);

      setScanStatus({
        symbols: itemsToScan.map((i) => i.symbol),
        tfs: configRef.current.timeframes,
        current: 0,
        total: itemsToScan.length,
        currentAction: triggerReason,
      });

      try {
        let hasChanges = false;
        const batchSize = 3; // Reduced batch size to smooth out burst loads

        for (let i = 0; i < itemsToScan.length; i += batchSize) {
          if (!candidatesRef.current || candidatesRef.current.length === 0)
            break;

          const batch = itemsToScan.slice(i, i + batchSize);

          await Promise.all(
            batch.map(async (item) => {
              if (!item.symbol || item.symbol === "USDT" || item.symbol.trim() === "") return;
              if (!item.groupedResults) return;

              const neededTFs = new Set<string>();
              item.groupedResults.forEach((r) => {
                if (configRef.current.timeframes.includes(r.tf)) {
                  neededTFs.add(r.tf);
                  if (configRef.current.enableMultiResonance) {
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
                    const idx = ALL_TFS.indexOf(r.tf);
                    if (idx > 0) neededTFs.add(ALL_TFS[idx - 1]);
                    if (idx < ALL_TFS.length - 1)
                      neededTFs.add(ALL_TFS[idx + 1]);
                  }
                }
              });

              if (neededTFs.size === 0) return;

              const livePrice =
                realPricesRef.current[normalizeSymbol(item.symbol)] ||
                realPricesRef.current[item.symbol] ||
                item.price;

              // NEW: Fetch/Enrich History Extremes for Anti-Chase
              // Optimization: Check cache first to avoid re-fetching heavy extremes
              const cachedItem = cacheRef.current.get(item.symbol);
              let historyExtremes =
                item.historyExtremes || cachedItem?.historyExtremes;

              if (!historyExtremes) {
                try {
                  const safeSymbol = item.symbol.endsWith("USDT")
                    ? item.symbol
                    : `${item.symbol}USDT`;
                  // Fetch up to 1000h of 1h data, 540 of 4h data (equivalent to 2160 hours), and 24 hours of 1m data (1440m)
                  const url1h = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=1h&limit=1000&_t=${Date.now()}`;
                  const url4h = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=4h&limit=540&_t=${Date.now()}`;
                  const url1m = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=1m&limit=1440&_t=${Date.now()}`;
                  
                  const [res1h, res4h, res1m] = await Promise.all([
                    fetchWithFallback(
                      url1h,
                      { cache: "no-store" },
                      (d) => Array.isArray(d),
                      directMode,
                    ),
                    fetchWithFallback(
                      url4h,
                      { cache: "no-store" },
                      (d) => Array.isArray(d),
                      directMode,
                    ),
                    fetchWithFallback(
                      url1m,
                      { cache: "no-store" },
                      (d) => Array.isArray(d),
                      directMode,
                    ),
                  ]);

                  const raw1h = await res1h.json();
                  const raw4h = await res4h.json();
                  const raw1m = await res1m.json();

                  const h1h = raw1h.map((k: any) => parseFloat(k[2]));
                  const l1h = raw1h.map((k: any) => parseFloat(k[3]));
                  const h1m = raw1m.map((k: any) => parseFloat(k[2]));
                  const l1m = raw1m.map((k: any) => parseFloat(k[3]));

                  // Construct up-sampled historical 1h arrays using 4h data to cover the full 1Q window (2160 hours)
                  const oldest1hTime = raw1h.length > 0 ? raw1h[0][0] : Date.now();
                  const olderHighs: number[] = [];
                  const olderLows: number[] = [];
                  
                  raw4h.forEach((k: any) => {
                    if (k[0] < oldest1hTime) {
                      const h = parseFloat(k[2]);
                      const l = parseFloat(k[3]);
                      for (let j = 0; j < 4; j++) {
                        olderHighs.push(h);
                        olderLows.push(l);
                      }
                    }
                  });

                  const combinedHighs = [...olderHighs, ...h1h].slice(-2200);
                  const combinedLows = [...olderLows, ...l1h].slice(-2200);

                  // PRE-CALCULATE EXTREMES (SCALAR)
                  // This avoids expensive slice/Math.max in list4_momentum every tick
                  const calcExtreme = (
                    arr: number[],
                    candles: number,
                    type: "MAX" | "MIN",
                  ) => {
                    if (!arr || arr.length === 0) return 0;
                    const slice = arr.slice(-candles);
                    return type === "MAX"
                      ? Math.max(...slice)
                      : Math.min(...slice);
                  };

                  historyExtremes = {
                    highs1h: combinedHighs,
                    lows1h: combinedLows,
                    highs1m: h1m,
                    lows1m: l1m,
                    // Pre-calculated results for quick lookup
                    scalars: {
                      low_5m: calcExtreme(l1m, 5, "MIN"),
                      high_5m: calcExtreme(h1m, 5, "MAX"),
                      low_60m: calcExtreme(l1m, 60, "MIN"),
                      high_60m: calcExtreme(h1m, 60, "MAX"),
                      low_240m: calcExtreme(l1m, 240, "MIN"),
                      high_240m: calcExtreme(h1m, 240, "MAX"),
                      low_1440m: calcExtreme(l1m, 1440, "MIN"),
                      high_1440m: calcExtreme(h1m, 1440, "MAX"),
                      low_10080m: calcExtreme(combinedLows, 168, "MIN"), // 7 days
                      high_10080m: calcExtreme(combinedHighs, 168, "MAX"),
                      low_43200m: calcExtreme(combinedLows, 720, "MIN"), // 30 days (720 hours)
                      high_43200m: calcExtreme(combinedHighs, 720, "MAX"),
                    },
                  };
                } catch (e) {
                  console.warn(
                    `[List3] Failed to fetch extremes for ${item.symbol}`,
                  );
                }
              }

              const tfList = Array.from(neededTFs);
              // Only synthesize 1m, 3m, 5m. 15m and 30m need more data for EMA80.
              const synthesizable = tfList.filter(
                (tf) => getTfMinutes(tf) <= 5,
              );
              const remotes = tfList.filter((tf) => getTfMinutes(tf) > 5);

              let cache1m: KLine[] | null = null;

              // A. 处理可合成周期 (1m, 3m, 5m)
              if (synthesizable.length > 0) {
                try {
                  const safeSymbol = item.symbol.endsWith("USDT")
                    ? item.symbol
                    : `${item.symbol}USDT`;
                  const url1m = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=1m&limit=1000&_t=${Date.now()}`;
                  const res1m = await fetchWithFallback(
                    url1m,
                    { cache: "no-store" },
                    (d) => Array.isArray(d),
                    directMode,
                  );
                  if (res1m.ok) {
                    const raw1m = await res1m.json();
                    cache1m = raw1m.map((k: any) => ({
                      time: Number(k[0]),
                      open: parseFloat(k[1]),
                      high: parseFloat(k[2]),
                      low: parseFloat(k[3]),
                      close: parseFloat(k[4]),
                      volume: parseFloat(k[5]),
                    }));

                    for (const tf of synthesizable) {
                      lastCandleScanRef.current.set(
                        `${item.symbol}-${tf}`,
                        Date.now(),
                      );
                      const synthKlines = KLineSynthesizer.synthesize(
                        cache1m!,
                        getTfMinutes(tf),
                      );
                      processStructureForTf(
                        item,
                        tf,
                        synthKlines,
                        livePrice,
                        historyExtremes,
                      );
                      hasChanges = true;
                    }
                  }
                } catch (e) {}
              }

              // B. 处理必须远端抓取的周期
              for (const tf of remotes) {
                lastCandleScanRef.current.set(
                  `${item.symbol}-${tf}`,
                  Date.now(),
                );
                try {
                  const safeSymbol = item.symbol.endsWith("USDT")
                    ? item.symbol
                    : `${item.symbol}USDT`;
                  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=${tf}&limit=500&_t=${Date.now()}`;
                  const res = await fetchWithFallback(
                    url,
                    { cache: "no-store" },
                    (d) => Array.isArray(d),
                    directMode,
                  );
                  if (res.ok) {
                    const raw = await res.json();
                    const klines: KLine[] = raw.map((k: any) => ({
                      time: Number(k[0]),
                      open: parseFloat(k[1]),
                      high: parseFloat(k[2]),
                      low: parseFloat(k[3]),
                      close: parseFloat(k[4]),
                      volume: parseFloat(k[5]),
                    }));
                    processStructureForTf(
                      item,
                      tf,
                      klines,
                      livePrice,
                      historyExtremes,
                    );
                    hasChanges = true;
                  }
                } catch (e) {}
              }
              structureHashRef.current.set(item.symbol, getStructureHash(item));

              // [MILLISECOND-LEVEL FAILURE CLEARANCE]
              const cfg = configRef.current;
              const areAllRulesOff = !cfg.strictTrend && !cfg.checkCandleColor && !cfg.enableAmplitudeAudit && (cfg.enableRsi === false);
              if (!areAllRulesOff) {
                const cachedItem = cacheRef.current.get(item.symbol);
                if (cachedItem && cachedItem.list3Results) {
                  const hasPassedAny = cachedItem.list3Results.some(r => r.latched);
                  if (!hasPassedAny) {
                    console.log(`[List3 Sweep] ❌ ${item.symbol} 周期性审计未通过，立即清除!`);
                    cacheRef.current.delete(item.symbol);
                    hasChanges = true;
                  }
                }
              }
            }),
          );

          if (i % 20 === 0 || i + batchSize >= itemsToScan.length) {
            setScanStatus((p) =>
              p
                ? {
                    ...p,
                    current: Math.min(p.total, i + batchSize),
                    currentAction: "深度结构审计中...",
                  }
                : null,
            );
          }

          if (hasChanges && i % 20 === 0) updateList3FromCache();

          // Only delay for scheduled bulk scans, not for new item incremental scans
          if (triggerReason.includes("审计")) {
            await delay(150); // Reverted delay
          }
        }

        if (hasChanges) updateList3FromCache();
      } finally {
        isScanningRef.current = false;
        setIsScanning(false);
        setScanStatus(null);

        // Handle pending items that arrived during scan
        if (pendingItemsRef.current.length > 0) {
          const itemsToProcess = [...pendingItemsRef.current];
          pendingItemsRef.current = [];
          console.log(
            `[List3] Processing ${itemsToProcess.length} pending items after scan.`,
          );
          runAnalysisInternal(itemsToProcess, "后续补录扫描");
        }
      }
    },
    [updateList3FromCache],
  ); // Removed realPrices from here

  // --- TRIGGERS ---
  useEffect(() => {
    // Sync Cache Removal & Expired Signals Cleanup
    const validSymbols = new Set(candidates.map((c) => c.symbol));
    const validUniqueIds = new Set<string>();
    candidates.forEach((c) => {
      c.groupedResults?.forEach((r) => {
        validUniqueIds.add(`${c.symbol}-${r.tf}-${r.direction || 'LONG'}`);
      });
    });

    let cleaned = false;
    for (const key of cacheRef.current.keys()) {
      if (!validSymbols.has(key)) {
        cacheRef.current.delete(key);
        structureHashRef.current.delete(key);
        cleaned = true;
      }
    }

    // Clean up expiredSignalCacheRef for signals that are no longer in candidates
    for (const uniqueId of expiredSignalCacheRef.current) {
      if (!validUniqueIds.has(uniqueId)) {
        expiredSignalCacheRef.current.delete(uniqueId);
      }
    }

    const cfg = configRef.current;
    const areAllRulesOff = !cfg.strictTrend && !cfg.checkCandleColor && !cfg.enableAmplitudeAudit && (cfg.enableRsi === false);

    // Identify New/Changed Candidates
    const itemsToScan: ScannerItem[] = [];
    let instantAdded = false;

    candidates.forEach((c) => {
      if (!c.symbol) return;
      const currentHash = getStructureHash(c);
      const lastHash = structureHashRef.current.get(c.symbol);
      const cached = cacheRef.current.get(c.symbol);

      if (!cached) {
        // [MILLISECOND-LEVEL INSTANT TRANSITION]
        // Synchronously add to cache with passing results so it enters List 3 immediately (0ms)
        const results = c.groupedResults?.map((r) => ({
          tf: r.tf,
          direction: r.direction || 'LONG',
          latched: true, // Default to true so it passes to List 3 & List 4 in 0ms!
          structure: {
            rsi: 50,
            bbw: 0.1,
            crossCount: 2,
            locationPct: 10,
            thrustValid: true,
            isStrictTrend: true,
            isColorValid: true,
            lag: r.lag || 0,
            signalTime: r.crossingTimes ? Math.max(...r.crossingTimes) : Date.now(),
            signalPrice: c.price,
            ema10: c.emaDetails?.ema10 || c.price,
            ema20: c.emaDetails?.ema20 || c.price,
            ema30: c.emaDetails?.ema30 || c.price,
            ema40: c.emaDetails?.ema40 || c.price,
            ema80: c.emaDetails?.ema80 || c.price,
          }
        })) || [];

        // Only add results that are not expired/removed
        const filteredResults = results.filter((r) => {
          const uniqueId = `${c.symbol}-${r.tf}-${r.direction}`;
          return !expiredSignalCacheRef.current.has(uniqueId);
        });

        if (filteredResults.length > 0) {
          const immediateItem: ScannerItem = {
            ...c,
            list3Results: filteredResults,
          };

          cacheRef.current.set(c.symbol, immediateItem);
          instantAdded = true;

          if (!areAllRulesOff) {
            itemsToScan.push(c);
          }
        }
      } else if (currentHash !== lastHash) {
        if (!areAllRulesOff) {
          itemsToScan.push(c);
        }
      }
    });

    if (instantAdded || cleaned) {
      updateList3FromCache();
    }

    if (itemsToScan.length > 0 && !areAllRulesOff) {
      runPriorityAnalysisInternal(itemsToScan, `增量分析 (${itemsToScan.length})`);
    }
  }, [candidates, runPriorityAnalysisInternal, updateList3FromCache]);

  useEffect(() => {
    const checkTimer = setInterval(() => {
      if (
        isScanningRef.current ||
        !candidatesRef.current ||
        candidatesRef.current.length === 0
      )
        return;
      const now = Date.now();
      const reScanCandidates: ScannerItem[] = [];

      candidatesRef.current.forEach((c) => {
        let needsUpdate = false;

        // [CRITICAL OPTIMIZATION]
        // If a symbol is in candidates but NOT yet latched in List 3,
        // re-audit it to catch intra-candle status changes.
        const cached = cacheRef.current.get(c.symbol);
        const hasUnlatchedSignal =
          cached?.list3Results?.some((r) => !r.latched) ||
          !cached?.list3Results;

        c.groupedResults?.forEach((r) => {
          const tf = r.tf;
          const intervalMs = getTfMinutes(tf) * 60000;
          if (intervalMs === 0) return;

          const currentCandleStart = Math.floor(now / intervalMs) * intervalMs;
          const key = `${c.symbol}-${tf}`;
          const lastScan = lastCandleScanRef.current.get(key) || 0;

          // Re-audit if:
          // 1. A new candle started
          // 2. OR it hasn't passed audit yet and last scan was > 15s ago (Reduced frequency)
          if (lastScan < currentCandleStart) {
            needsUpdate = true;
          } else if (hasUnlatchedSignal && now - lastScan > 15000) {
            needsUpdate = true;
          }
        });
        if (needsUpdate) reScanCandidates.push(c);
      });

      if (reScanCandidates.length > 0) {
        runAnalysisInternal(reScanCandidates, "高频动态合规审计");
      }
    }, 5000); // Reduced frequency to 5s
    return () => clearInterval(checkTimer);
  }, [runAnalysisInternal]);

  // --- MANUAL ACTIONS ---
  const removeItem = useCallback(
    (symbol: string) => {
      // Find the item and add all its signals to expired signals so they don't get re-added!
      const cached = cacheRef.current.get(symbol);
      if (cached && cached.list3Results) {
        cached.list3Results.forEach((r) => {
          const uniqueId = `${symbol}-${r.tf}-${r.direction}`;
          expiredSignalCacheRef.current.add(uniqueId);
        });
      } else {
        // Fallback: if not in cache, find in candidates and expire all its potential signals
        const cand = candidatesRef.current.find((c) => c.symbol === symbol);
        if (cand && cand.groupedResults) {
          cand.groupedResults.forEach((r) => {
            const uniqueId = `${symbol}-${r.tf}-${r.direction || 'LONG'}`;
            expiredSignalCacheRef.current.add(uniqueId);
          });
        }
      }
      cacheRef.current.delete(symbol);
      structureHashRef.current.delete(symbol);
      updateList3FromCache();
    },
    [updateList3FromCache],
  );

  const clearItems = useCallback(() => {
    // Expire all signals currently in cache and candidates
    cacheRef.current.forEach((item, symbol) => {
      if (item.list3Results) {
        item.list3Results.forEach((r) => {
          const uniqueId = `${symbol}-${r.tf}-${r.direction}`;
          expiredSignalCacheRef.current.add(uniqueId);
        });
      }
    });
    candidatesRef.current.forEach((c) => {
      if (c.groupedResults) {
        c.groupedResults.forEach((r) => {
          const uniqueId = `${c.symbol}-${r.tf}-${r.direction || 'LONG'}`;
          expiredSignalCacheRef.current.add(uniqueId);
        });
      }
    });
    cacheRef.current.clear();
    structureHashRef.current.clear();
    updateList3FromCache();
  }, [updateList3FromCache]);

  // --- REMOVE SIGNAL ---
  // Called by List 4 when a signal is permanently invalidated or traded
  const removeSignal = useCallback(
    (uniqueId: string) => {
      // uniqueId format: "SYMBOL-TF-DIRECTION"
      const parts = uniqueId.split("-");
      if (parts.length < 3) return;

      // Add to expired cache so it doesn't get re-added on next scan
      expiredSignalCacheRef.current.add(uniqueId);

      const symbol = parts[0];
      const tf = parts[1];
      const direction = parts[2];

      const cached = cacheRef.current.get(symbol);
      if (cached && cached.list3Results) {
        // Filter out the specific signal
        cached.list3Results = cached.list3Results.filter(
          (r) => !(r.tf === tf && r.direction === direction),
        );

        // If no signals left for this symbol, remove it entirely
        if (cached.list3Results.length === 0) {
          cacheRef.current.delete(symbol);
        } else {
          cacheRef.current.set(symbol, cached);
        }

        // Update UI
        updateList3FromCache();
      }
    },
    [updateList3FromCache],
  );

  return {
    config,
    setConfig,
    list3,
    isScanning,
    scanStatus,
    countdowns,
    removeSignal,
    removeItem,
    clearItems,
  };
};
