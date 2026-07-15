/**
 * [REAL-TIME MODE CODE LOCK - LIST 2 (GRAND CROSSING)]
 * CRITICAL: The core rules, logic, and configuration for List 2 (Grand Crossing)
 * are now STRICTLY LOCKED and MUST NOT be modified under any circumstances.
 * Secondary and double-verification filters are fully completed and locked.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { usePersistedState } from "../../hooks/usePersistedState";
import {
  List2Config,
  ScannerItem,
} from "../../components/Scanner/scannerTypes";
import { analyzeList2Crossing } from "../../services/rules/list2_crossing";
import { fetchWithFallback } from "../../services/apiService";
import { KLineSynthesizer } from "../../services/klineSynthesizer";
import { KLine } from "../../types";
import { saveState } from "../../utils/persistence";

const getTfMinutes = (tf: string) => {
  const unit = tf.slice(-1);
  const val = parseInt(tf);
  if (unit === "m") return val;
  if (unit === "h") return val * 60;
  if (unit === "d") return val * 1440;
  if (unit === "w") return val * 10080;
  if (unit === "M") return val * 43200;
  return 0;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const useGrandCrossing = (
  candidates: ScannerItem[],
  initialConfig: List2Config,
  directMode: boolean = false,
  onLog?: (
    type: "INFO" | "SUCCESS" | "WARNING" | "DANGER",
    message: string,
  ) => void,
  strategyId?: string,
) => {
  const suffix = strategyId ? `_${strategyId}` : "";
  const configKey = `SCANNER_LIST2_CONFIG${suffix}`;
  const cacheMapKey = `SCANNER_LIST2_CACHE_MAP${suffix}`;
  const capturedSignalsKey = `SCANNER_LIST2_CAPTURED_SIGNALS${suffix}`;
  const expiredSignalsKey = `SCANNER_LIST2_EXPIRED_SIGNALS${suffix}`;

  // --- ATOMIC STATE ---
  const [config, setConfig] = usePersistedState<List2Config>(
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

  const [list2, setList2] = useState<ScannerItem[]>(() => {
    try {
      const saved = localStorage.getItem(cacheMapKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed
            .map((item: any) => item?.value)
            .filter((v) => v && v.symbol);
        }
      }
    } catch (e) {
      console.error("Failed to load List 2 state", e);
    }
    return [];
  });

  // Initial update of sorted candidates from list2 on mount
  useEffect(() => {
    const cacheItems = Array.from(cacheRef.current.values());
    const combined = [...candidatesRef.current];
    const symbols = new Set(combined.map((c) => c.symbol));
    cacheItems.forEach((item) => {
      if (!symbols.has(item.symbol)) combined.push(item);
    });
    if (combined.length > 0) {
      sortedCandidatesRef.current = combined.sort(
        (a, b) => parseFloat(b.volume || "0") - parseFloat(a.volume || "0"),
      );
    }
  }, []);
  const [status, setStatus] = useState<"IDLE" | "SCANNING">("IDLE");
  const [scanText, setScanText] = useState("监控中...");
  const [countdowns, setCountdowns] = useState<Record<string, string>>({});
  const [tfCounts, setTfCounts] = useState<Record<string, number>>({});

  // Track individual scanning timeframes for UI feedback
  const [activeScanTfs, setActiveScanTfs] = useState<Set<string>>(new Set());
  const [lastScanTime, setLastScanTime] = useState<number | null>(null);

  // --- ROLLING SCAN REFS ---
  const indicesRef = useRef<Record<string, number>>({
    "1m": 0,
    "15m": 0,
    "30m": 0,
    "1h": 0,
    "2h": 0,
    "4h": 0,
    "8h": 0,
    "1d": 0,
  });
  const workersRef = useRef<Record<string, boolean>>({});
  const sortedCandidatesRef = useRef<ScannerItem[]>([]);

  // --- REFS ---
  const configRef = useRef(config); // For async access
  const cacheRef = useRef<Map<string, ScannerItem>>(
    new Map(
      (() => {
        try {
          const saved = localStorage.getItem(cacheMapKey);
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
              return parsed
                .filter((item: any) => item && item.key && item.value)
                .map((item: any) => [item.key, item.value]);
            }
          }
        } catch (e) {
          console.error("Failed to load List 2 cache map", e);
        }
        return [];
      })(),
    ),
  );
  const tfLastScanRef = useRef<Record<string, number>>({});
  const symbolTfLastFetchRef = useRef<Map<string, number>>(new Map()); // symbol-tf -> timestamp
  const candidatesRef = useRef(candidates);

  // --- PERFORMANCE REFS ---
  const lastUpdateTimestampRef = useRef<number>(0);
  const pendingUpdateRef = useRef<boolean>(false);
  const lastListLengthRef = useRef<number>(0);
  const lastListSignalsHashRef = useRef<string>(""); // For lightweight change detection

  // --- CONCURRENCY LOCK ---
  const isScanningRef = useRef(false);

  // --- CAPTURED SIGNALS REF ---
  const capturedSignalsRef = useRef<Set<string>>(
    new Set(
      (() => {
        try {
          const saved = localStorage.getItem(capturedSignalsKey);
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
              return parsed.filter((i) => typeof i === "string");
            }
          }
        } catch (e) {
          console.error("Failed to load captured signals", e);
        }
        return [];
      })(),
    ),
  );
  const expiredList2SignalCacheRef = useRef<Set<string>>(
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
      })()
    )
  );

  // --- CORE: Update Output List (Logic Hub) ---
  const tfCountsRef = useRef<Record<string, number>>({});
  const performUpdate = useCallback(() => {
    const now = Date.now();
    // [AUDIT] Improved lag compensation: Cap the compensation to 3 minutes of "lost time"
    // to prevent immediate signal purge on app restart after long downtime.
    const lastUpdate = lastUpdateTimestampRef.current || now - 3000;
    let timeDiffMs = Math.max(0, now - lastUpdate);
    if (timeDiffMs > 180000) timeDiffMs = 180000; // Max 3 minutes of catch-up aging

    let items: ScannerItem[] = [];
    try {
      items = Array.from(cacheRef.current.values());
    } catch (e) {
      console.error("Cache iteration error", e);
      return;
    }

    const cfg = configRef.current;
    const retention = cfg.newModeRetention ?? 9;

    // 1. Lag Compensation & Expired Cleanup from Cache
    const itemIdsToDelete: string[] = [];

    items.forEach((item) => {
      if (!item || !item.symbol || !item.groupedResults) return;

      const validSignals = item.groupedResults.filter((r) => {
        if (!r) return false;

        // 确保周期仍在当前配置项中 (例如：排出没有选中的 1m, 3m 周期效果)
        const tfs = cfg.timeframes || [];
        if (!tfs.includes(r.tf || "")) return false;

        // Real-time aging (Corrected: Per-signal TF)
        const tfMinutes = getTfMinutes(r.tf || "1m");
        const lagIncrease =
          tfMinutes > 0 ? timeDiffMs / (tfMinutes * 60 * 1000) : 0;
        r.lag = (r.lag || 0) + lagIncrease;

        // 严格根数检查
        if (r.lag >= retention) {
          const signalTime =
            r.crossingTimes && r.crossingTimes.length > 0
              ? Math.max(...r.crossingTimes)
              : 0;
          const id = `${item.symbol}-${r.tf}-${r.direction}-${signalTime}`;
          capturedSignalsRef.current.delete(id);
          return false;
        }

        if (
          expiredList2SignalCacheRef.current.has(
            `${item.symbol}-${r.tf}-${r.direction}`,
          )
        ) {
          return false;
        }

        // --- RE-FILTERING LOGIC (Reactive to Config Changes) ---
        // If strict filtering is ON, and signal doesn't meet the ratio, remove it
        if (cfg.strictFiltering) {
          const ratio = r.bodyRatio ?? 0; // Set default to 0 to be strictly compliant and filter out malformed/legacy signals
          if (ratio < (cfg.minBodyRatio || 0)) return false;
        }

        // 压缩信号过滤
        if (cfg.requireCrossing && r.isSqueeze) return false;
        if (cfg.requireAlignment && !r.isAligned) return false;

        // 2. 实时交叉判定
        const hasRecentCrossing =
          r.crossingLags && r.crossingLags.some((l) => l <= 1.05); // Small buffer for network latency
        if (hasRecentCrossing) return true;

        // 3. 捕获信号校验 (基于 K 线时间的持久化 ID)
        const signalTime =
          r.crossingTimes && r.crossingTimes.length > 0
            ? Math.max(...r.crossingTimes)
            : 0;
        const id = `${item.symbol}-${r.tf}-${r.direction}-${signalTime}`;
        if (capturedSignalsRef.current.has(id)) return true;

        return false;
      });

      if (validSignals.length === 0) {
        itemIdsToDelete.push(`${item.symbol}-FULL`);
      } else {
        // [DE-DUPLICATION] Only keep the latest signal per symbol-tf-direction
        const dedupedMap = new Map<string, any>();
        validSignals.forEach((s) => {
          const key = `${s.tf}-${s.direction}`;
          const current = dedupedMap.get(key);
          if (!current || (s.lag || 0) < (current.lag || 0)) {
            dedupedMap.set(key, s);
          }
        });
        const finalValidSignals = Array.from(dedupedMap.values());

        // Sort by newest lag first
        finalValidSignals.sort((a, b) => (a.lag || 0) - (b.lag || 0));

        // Update item with valid signals and keep it in cache
        item.groupedResults = finalValidSignals;
        item.direction = finalValidSignals[0].direction;
        item.tf = finalValidSignals[0].tf;
        item.lag = finalValidSignals[0].lag;
      }
    });

    // Delete fully expired items
    itemIdsToDelete.forEach((id) => cacheRef.current.delete(id));

    // Re-read items from cache after filter
    items = Array.from(cacheRef.current.values());

    const sortMode = cfg.sortMode;
    const currentCandidates = candidatesRef.current;

    // --- 0. UPDATE PRICES (Lightweight pointer lookup) ---
    const priceMap = new Map(currentCandidates.map((c) => [c.symbol, c]));

    items = items.map((item) => {
      const candidate = priceMap.get(item.symbol);
      if (candidate) {
        return {
          ...item,
          price: candidate.price,
          change: candidate.change,
          volume: candidate.volume,
        };
      }
      return item;
    });

    // No second mapping needed, items are already correct

    // --- 2. FAST HASH CHECK (Avoid JSON.stringify on huge data) ---
    // Include price/change in hash to ensure UI updates when List 1 prices move
    const currentSignalsHash = items
      .map(
        (i) =>
          `${i.symbol}-${i.groupedResults?.length}-${i.lastUpdated}-${i.price}-${i.change}`,
      )
      .join("|");
    const hasStructuralChange =
      items.length !== lastListLengthRef.current ||
      currentSignalsHash !== lastListSignalsHashRef.current;

    if (hasStructuralChange) {
      // Sort
      items.sort((a, b) => {
        if (sortMode === "MOST") {
          const countA = a.groupedResults?.length || 0;
          const countB = b.groupedResults?.length || 0;
          if (countA !== countB) return countB - countA;
        }
        const getMinLag = (item: ScannerItem) => {
          if (!item.groupedResults || item.groupedResults.length === 0)
            return 999;
          return Math.min(
            ...item.groupedResults.map((r) => {
              if (r.crossingLags && r.crossingLags.length > 0)
                return Math.min(...r.crossingLags);
              return r.lag || 999;
            }),
          );
        };
        return getMinLag(a) - getMinLag(b);
      });

      setList2(items);
      lastListLengthRef.current = items.length;
      lastListSignalsHashRef.current = currentSignalsHash;

      // Stats update
      const counts: Record<string, number> = {};
      items.forEach((item) => {
        item.groupedResults?.forEach((r) => {
          if (r.tf) counts[r.tf] = (counts[r.tf] || 0) + 1;
        });
      });

      // Shallow comparison for tfCounts to avoid unnecessary renders
      const countsStr = JSON.stringify(counts);
      const prevCountsStr = JSON.stringify(tfCountsRef.current);
      if (countsStr !== prevCountsStr) {
        setTfCounts(counts);
        tfCountsRef.current = counts;
      }
    }

    // Every 10s save to disk
    const persistenceKey = "LAST_LS_PERSIST";
    const lastPersist = Number(sessionStorage.getItem(persistenceKey) || 0);
    if (now - lastPersist > 10000 || hasStructuralChange) {
      const cacheArray = Array.from(cacheRef.current.entries()).map(
        ([key, value]) => ({ key, value }),
      );
      saveState(cacheMapKey, cacheArray, 300); // Cap list 2 cache
      saveState(
        capturedSignalsKey,
        Array.from(capturedSignalsRef.current),
        500,
      ); // Cap signals
      saveState(
        expiredSignalsKey,
        Array.from(expiredList2SignalCacheRef.current),
        1000,
      ); // Cap expired
      sessionStorage.setItem(persistenceKey, now.toString());
    }

    pendingUpdateRef.current = false;
    lastUpdateTimestampRef.current = now;
  }, []);

  // --- THROTTLE SCHEDULER ---
  const scheduleUpdate = useCallback(() => {
    const now = Date.now();
    const lastUpdate = lastUpdateTimestampRef.current || 0;
    const timeSinceLast = now - lastUpdate;
    const throttleMs = 1000; // Increased responsiveness

    if (timeSinceLast > throttleMs) {
      performUpdate();
    } else if (!pendingUpdateRef.current) {
      pendingUpdateRef.current = true;
      setTimeout(performUpdate, throttleMs - timeSinceLast);
    }
  }, [performUpdate]);

  // --- MANUAL ACTIONS ---
  const removeItem = useCallback(
    (symbol: string) => {
      cacheRef.current.delete(`${symbol}-FULL`);
      // Remove related captured signals
      const captured = Array.from(capturedSignalsRef.current);
      let removedCount = 0;
      captured.forEach((id) => {
        if (id.startsWith(`${symbol}-`)) {
          capturedSignalsRef.current.delete(id);
          removedCount++;
        }
      });
      performUpdate();
      onLog?.(
        "INFO",
        `[列表2] 手动移除币种: ${symbol} (清除及 ${removedCount} 个捕获信号)`,
      );
    },
    [performUpdate, onLog],
  );

  const removeSignal = useCallback(
    (uniqueId: string) => {
      // uniqueId format: "SYMBOL-TF-DIRECTION"
      const parts = uniqueId.split("-");
      if (parts.length < 3) return;
      const symbol = parts[0];
      const tf = parts[1];
      const direction = parts[2];

      expiredList2SignalCacheRef.current.add(uniqueId);

      // We only have symbol level items here.
      // Let's remove the signal from groupedResults
      const cached = cacheRef.current.get(`${symbol}-FULL`);
      if (cached && cached.groupedResults) {
        // ALWAYS delete the entire symbol from List 2, regardless of TF/Direction
        // User requested: "不管是什么时间周期的都删除掉"
        cacheRef.current.delete(`${symbol}-FULL`);

        // Remove captured signals too
        const captured = Array.from(capturedSignalsRef.current);
        captured.forEach((id) => {
          // captured signal id: "SYMBOL-TF-DIRECTION-TIME"
          if (id.startsWith(`${symbol}-`)) {
            capturedSignalsRef.current.delete(id);
          }
        });
        performUpdate();
      }
    },
    [performUpdate],
  );

  const clearItems = useCallback(() => {
    const count = cacheRef.current.size;
    cacheRef.current.clear();
    capturedSignalsRef.current.clear();
    performUpdate();
    onLog?.("INFO", `[列表2] 手动清空所有信号 (共移除 ${count} 个币种)`);
  }, [performUpdate, onLog]);

  // --- DOUBLE VERIFICATION (二次验证机制) ---
  useEffect(() => {
    let active = true;
    const doubleVerifyTimer = setInterval(async () => {
      const activeItems = Array.from(cacheRef.current.values());
      if (activeItems.length === 0) return;

      console.log(`[List 2 Double Verify] Starting verification for ${activeItems.length} active items...`);
      onLog?.("INFO", `[列表2] 启动定时二次规则校验模式 (对当前 ${activeItems.length} 个币种执行穿透核验)...`);

      let changed = false;

      for (const item of activeItems) {
        if (!active) break;
        if (!item.groupedResults || item.groupedResults.length === 0) continue;

        const updatedResults = [];
        for (const r of item.groupedResults) {
          const tf = r.tf || "1m";
          
          // 如果该周期已从配置中移除，直接丢弃该信号进行清理，无需再发包计算
          if (!configRef.current.timeframes.includes(tf)) {
            changed = true;
            continue;
          }

          const isSynth = tf === "1m" || tf === "3m" || tf === "5m";
          const safeSymbol = item.symbol.endsWith("USDT") ? item.symbol : `${item.symbol}USDT`;
          const now = Date.now();

          try {
            let klines: KLine[] = [];
            if (isSynth) {
              const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=1m&limit=499&_t=${now}`;
              const res = await fetchWithFallback(url, { cache: "no-store" }, (d) => Array.isArray(d), directMode);
              if (res.ok) {
                const raw = await res.json();
                const baseKlines = raw.map((k: any) => ({
                  time: Number(k[0]),
                  open: parseFloat(k[1]),
                  high: parseFloat(k[2]),
                  low: parseFloat(k[3]),
                  close: parseFloat(k[4]),
                  volume: parseFloat(k[5]),
                }));
                const tfMins = getTfMinutes(tf);
                klines = tf === "1m" ? baseKlines : KLineSynthesizer.synthesize(baseKlines, tfMins);
              }
            } else {
              const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=${tf}&limit=200&_t=${now}`;
              const res = await fetchWithFallback(url, { cache: "no-store" }, (d) => Array.isArray(d), directMode);
              if (res.ok) {
                const raw = await res.json();
                klines = raw.map((k: any) => ({
                  time: Number(k[0]),
                  open: parseFloat(k[1]),
                  high: parseFloat(k[2]),
                  low: parseFloat(k[3]),
                  close: parseFloat(k[4]),
                  volume: parseFloat(k[5]),
                }));
              }
            }

            if (klines.length > 0) {
              const retention = configRef.current.newModeRetention ?? 9;
              const freshSignals = analyzeList2Crossing(
                item.symbol,
                tf,
                klines.map((k) => k.close),
                klines.map((k) => k.high),
                klines.map((k) => k.low),
                klines.map((k) => k.open),
                klines.map((k) => k.volume),
                klines.map((k) => k.time),
                { ...configRef.current, maxLag: retention } as any,
                isSynth ? 5 : 3,
              );

              // Check if any of the fresh signals match duration & direction
              // Verify the latest signal inside the retention window
              const match = freshSignals.find((fs) => fs.direction === r.direction);
              let isValid = false;
              let actualBodyRatio = r.bodyRatio ?? 0;
              let matchDetails: any = {};

              if (match) {
                const currentMinBody = configRef.current.minBodyRatio || 0;
                actualBodyRatio = match.bodyRatio ?? 0;
                if (actualBodyRatio >= currentMinBody) {
                  isValid = true;
                  matchDetails = {
                    bodyRatio: actualBodyRatio,
                    lag: match.lag,
                    isAligned: match.isAligned,
                    isSqueeze: match.isSqueeze,
                  };
                } else {
                  console.log(`[Double Verify] ${item.symbol} ${tf} ${r.direction} failed body ratio check (Got ${actualBodyRatio.toFixed(1)}%, Min: ${currentMinBody}%). Entering buffer...`);
                }
              } else {
                console.log(`[Double Verify] ${item.symbol} ${tf} ${r.direction} signal no longer active in active window. Entering buffer...`);
              }

              if (isValid) {
                // Keep it and reset consecutive fail counter
                updatedResults.push({
                  ...r,
                  ...matchDetails,
                  failedVerifyCount: 0,
                });
              } else {
                // Apply "信号消失缓冲防抖": Allow up to 2 times consecutive failed checks before purging
                const failedCount = (r.failedVerifyCount || 0) + 1;
                const maxAllowedFailures = 2; // ~90s grace period since verification runs every 45s

                if (failedCount <= maxAllowedFailures) {
                  console.log(`[Double Verify Buffer] ${item.symbol} ${tf} ${r.direction} entered stabilization buffer (${failedCount}/${maxAllowedFailures})`);
                  onLog?.("INFO", `[列表2 - 二次穿透核验] ${item.symbol} (${tf}) 穿越/实体发生瞬时波动，已启动信号消失缓冲防抖机制 (${failedCount}/${maxAllowedFailures})`);
                  updatedResults.push({
                    ...r,
                    failedVerifyCount: failedCount,
                  });
                } else {
                  console.log(`[Double Verify Purged] ${item.symbol} ${tf} ${r.direction} exceeded de-bounce buffer (${failedCount}/${maxAllowedFailures}). Purging.`);
                  onLog?.("WARNING", `[列表2 - 二次穿透核验] ${item.symbol} (${tf}) 连续 ${failedCount} 次穿透核验不符合标准，正式剔除该币`);
                  changed = true;
                }
              }
            } else {
              // API fetch fail, retain original to avoid UI flicker
              updatedResults.push(r);
            }
          } catch (err) {
            console.warn(`[Double Verify] Error verifying ${item.symbol} ${tf}:`, err);
            updatedResults.push(r);
          }
        }

        const cacheKey = `${item.symbol}-FULL`;
        if (updatedResults.length === 0) {
          cacheRef.current.delete(cacheKey);
          changed = true;
        } else if (updatedResults.length !== item.groupedResults.length || changed) {
          cacheRef.current.set(cacheKey, {
            ...item,
            groupedResults: updatedResults,
            direction: updatedResults[0].direction,
            tf: updatedResults[0].tf,
            lastUpdated: Date.now(),
          });
          changed = true;
        }
      }

      if (changed && active) {
        performUpdate();
      }
    }, 45000); // 45s interval combines strong real-time responsiveness with extremely safe API rate-limit headroom

    return () => {
      active = false;
      clearInterval(doubleVerifyTimer);
    };
  }, [performUpdate, onLog, directMode]);

  // --- EFFECT: Sync Ref & Pulse ---
  useEffect(() => {
    configRef.current = config;
  }, [config]);
  useEffect(() => {
    candidatesRef.current = candidates;

    const cacheItems = Array.from(cacheRef.current.values());
    const combined = [...candidates];
    const candidateSymbols = new Set(candidates.map((c) => c.symbol));

    cacheItems.forEach((item) => {
      if (!candidateSymbols.has(item.symbol)) {
        combined.push({
          ...item,
          // Ensure stale cached items don't have zeroed out prices if we can help it
          price: item.price || 0,
        });
      }
    });

    if (combined.length > 0) {
      sortedCandidatesRef.current = combined.sort((a, b) => {
        const volA = parseFloat(a.volume || "0");
        const volB = parseFloat(b.volume || "0");
        return volB - volA;
      });
    }

    // Rapid response for new candidates
    performUpdate();
  }, [candidates, performUpdate]);

  const lastCandidatesPulseRef = useRef("");
  useEffect(() => {
    const pulse = JSON.stringify(candidates.map((c) => c.symbol));
    if (pulse !== lastCandidatesPulseRef.current) {
      lastCandidatesPulseRef.current = pulse;
      performUpdate();
    }
  }, [candidates, performUpdate]);

  useEffect(() => {
    performUpdate();
  }, [config, performUpdate]);

  // --- DATA REFRESH ---
  useEffect(() => {
    // Always schedule update to reflect latest prices from candidates
    scheduleUpdate();
  }, [candidates, scheduleUpdate]);

  // --- CORE: Scan Logic (Refactored to Rolling Scan) ---
  const processSymbol = async (
    symbol: string,
    tf: string,
    isSynthesized: boolean = false,
  ) => {
    const cacheKey = `${symbol}-FULL`;
    const existingItem = cacheRef.current.get(cacheKey);
    const candidateItem = candidatesRef.current.find(
      (c) => c.symbol === symbol,
    );

    const item = candidateItem || existingItem;
    if (!item) return;

    const retention = configRef.current.newModeRetention ?? 9;

    try {
      const now = Date.now();
      let klines: KLine[] = [];
      let mergedResults = [...(existingItem?.groupedResults || [])];

      if (isSynthesized && tf === "1m") {
        // 1m 作为基础抓取
        const safeSymbol = symbol.endsWith("USDT") ? symbol : `${symbol}USDT`;
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=1m&limit=499&_t=${now}`;
        const res = await fetchWithFallback(
          url,
          { cache: "no-store" },
          (d) => Array.isArray(d),
          directMode,
        );
        if (!res.ok) return;
        const raw = await res.json();
        klines = raw.map((k: any) => ({
          time: Number(k[0]),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
        }));

        // 合成本地周期 (3m, 5m)
        const synthTfs = configRef.current.timeframes.filter(
          (t) => t === "1m" || t === "3m" || t === "5m",
        );

        for (const stf of synthTfs) {
          const tfMins = getTfMinutes(stf);
          const targetKlines =
            stf === "1m" ? klines : KLineSynthesizer.synthesize(klines, tfMins);

          const results = analyzeList2Crossing(
            symbol,
            stf,
            targetKlines.map((k) => k.close),
            targetKlines.map((k) => k.high),
            targetKlines.map((k) => k.low),
            targetKlines.map((k) => k.open),
            targetKlines.map((k) => k.volume),
            targetKlines.map((k) => k.time),
            { ...configRef.current, maxLag: retention } as any,
            5, // Increased from 4 to 5 for ultra-safety against scan cycle latency
          );

          if (results.length > 0) {
            mergedResults = mergedResults.filter((r) => r.tf !== stf);
            mergedResults.push(...results);

            // 信号捕获 (修正 ID 生成逻辑)
            results.forEach((res) => {
              const signalTime =
                res.crossingTimes && res.crossingTimes.length > 0
                  ? Math.max(...res.crossingTimes)
                  : 0;
              const id = `${symbol}-${stf}-${res.direction}-${signalTime}`;

              // [CLEANUP] Remove older captured signals for the same symbol-tf-direction
              const prefix = `${symbol}-${stf}-${res.direction}-`;
              Array.from(capturedSignalsRef.current).forEach((existingId) => {
                if (existingId.startsWith(prefix) && existingId !== id) {
                  capturedSignalsRef.current.delete(existingId);
                }
              });

              if (!capturedSignalsRef.current.has(id)) {
                capturedSignalsRef.current.add(id);
                console.log(
                  `[List2 Captured] ${symbol} ${stf} at ${new Date(signalTime).toLocaleTimeString()}`,
                );
              }
            });
          } else {
            // 如果没有发现新信号，检查旧信号是否到期。如果没到期，保留旧的，不要 filter 掉
            const oldSignal = existingItem?.groupedResults?.find(
              (r) => r.tf === stf,
            );
            if (oldSignal && oldSignal.lag < retention) {
              // 保留旧信号，不执行 filter(r => r.tf !== stf)
            } else {
              mergedResults = mergedResults.filter((r) => r.tf !== stf);
            }
          }
        }
      } else if (!isSynthesized) {
        // 大周期抓取
        const safeSymbol = symbol.endsWith("USDT") ? symbol : `${symbol}USDT`;
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=${tf}&limit=200&_t=${now}`;
        const res = await fetchWithFallback(
          url,
          { cache: "no-store" },
          (d) => Array.isArray(d),
          directMode,
        );
        if (!res.ok) return;
        const raw = await res.json();
        klines = raw.map((k: any) => ({
          time: Number(k[0]),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
        }));

        const results = analyzeList2Crossing(
          symbol,
          tf,
          klines.map((k) => k.close),
          klines.map((k) => k.high),
          klines.map((k) => k.low),
          klines.map((k) => k.open),
          klines.map((k) => k.volume),
          klines.map((k) => k.time),
          { ...configRef.current, maxLag: retention } as any,
          3, // RELAXED: Increased from 2 to 3 to accommodate scan cycle latency for high TFs
        );

        if (results.length > 0) {
          mergedResults = mergedResults.filter((r) => r.tf !== tf);
          mergedResults.push(...results);

          // 大周期信号也加入捕获
          results.forEach((res) => {
            const signalTime =
              res.crossingTimes && res.crossingTimes.length > 0
                ? Math.max(...res.crossingTimes)
                : 0;
            const id = `${symbol}-${tf}-${res.direction}-${signalTime}`;

            // [CLEANUP] Remove older captured signals
            const prefix = `${symbol}-${tf}-${res.direction}-`;
            Array.from(capturedSignalsRef.current).forEach((existingId) => {
              if (existingId.startsWith(prefix) && existingId !== id) {
                capturedSignalsRef.current.delete(existingId);
              }
            });

            capturedSignalsRef.current.add(id);
          });
        } else {
          // 如果没有发现新信号，检查旧信号是否到期
          const oldSignal = existingItem?.groupedResults?.find(
            (r) => r.tf === tf,
          );
          if (oldSignal && oldSignal.lag < retention) {
            // 保留
          } else {
            mergedResults = mergedResults.filter((r) => r.tf !== tf);
          }
        }
      }

      // 更新缓存 (原子化读写防止竞态覆盖)
      const finalCacheKey = `${symbol}-FULL`;
      const latestItem = cacheRef.current.get(finalCacheKey) || item;
      let finalResults = mergedResults;

      if (latestItem && latestItem.groupedResults) {
        // 将最新扫描结果与当前缓存中已有的其他周期结果合并
        const otherTfResults = latestItem.groupedResults.filter((r) => {
          if (isSynthesized && tf === "1m") {
            return !["1m", "3m", "5m"].includes(r.tf || "");
          }
          return r.tf !== tf;
        });

        // 去重合并
        const seenTfs = new Set(mergedResults.map((r) => r.tf));
        finalResults = [
          ...mergedResults,
          ...otherTfResults.filter((r) => !seenTfs.has(r.tf)),
        ];
      }

      if (finalResults.length > 0) {
        finalResults.sort((a, b) => (a.lag || 0) - (b.lag || 0));
        cacheRef.current.set(finalCacheKey, {
          ...item,
          groupedResults: finalResults,
          direction: finalResults[0].direction,
          tf: finalResults[0].tf,
          price: item.price,
          lastUpdated: Date.now(),
        });
      } else if (existingItem && existingItem.groupedResults) {
        // 如果当前扫描周期的结果为空，但缓存中有其他周期的有效结果，则保留
        const stillValidSignals = existingItem.groupedResults.filter((r) => {
          const rTf = r.tf || "";
          // 如果是当前扫描的周期，既然 results 为空，说明失效了
          if (isSynthesized && tf === "1m") {
            if (["1m", "3m", "5m"].includes(rTf)) return false;
          } else if (rTf === tf) {
            return false;
          }

          const isNotExpired = r.lag < retention;
          if (!isNotExpired) return false;

          if (configRef.current.strictFiltering) {
            const ratio = r.bodyRatio ?? 0; // Set default to 0 to be strictly compliant and filter out malformed/legacy signals
            if (ratio < (configRef.current.minBodyRatio || 0)) return false;
          }
          return true;
        });

        if (stillValidSignals.length > 0) {
          cacheRef.current.set(finalCacheKey, {
            ...existingItem,
            groupedResults: stillValidSignals,
            lastUpdated: Date.now(),
          });
        } else {
          cacheRef.current.delete(finalCacheKey);
        }
      }
    } catch (e: any) {
      console.warn(`[Rolling] Skip ${symbol} ${tf}:`, e.message);
    }
  };

  // --- WORKER FACTORY ---
  useEffect(() => {
    const startWorker = (
      tf: string,
      interval: number,
      isBase: boolean = false,
    ) => {
      if (workersRef.current[tf]) return;
      workersRef.current[tf] = true;

      const run = async () => {
        // 检查该周期是否在配置中
        const tfs = configRef.current.timeframes;
        const isSelected = isBase
          ? tfs.some((t) => ["1m", "3m", "5m"].includes(t))
          : tfs.includes(tf);

        if (isSelected && sortedCandidatesRef.current.length > 0) {
          const idxKey = isBase ? "1m" : tf;
          let idx = indicesRef.current[idxKey] || 0;
          if (idx >= sortedCandidatesRef.current.length) idx = 0;

          const symbol = sortedCandidatesRef.current[idx].symbol;
          await processSymbol(symbol, tf, isBase);

          indicesRef.current[idxKey] = idx + 1;
        }

        // 只有当 worker 标记还在时才继续
        if (workersRef.current[tf]) {
          setTimeout(run, interval);
        }
      };

      run();
    };

    // 启动各组 Worker (加速高周期扫描频率，降低延迟)
    // 组 1: 1m (涵盖 3m, 5m), 频率 6.6枚/秒
    startWorker("1m", 150, true);
    // 组 2: 15m, 频率 4枚/秒
    startWorker("15m", 250);
    // 组 3: 30m, 频率 2枚/秒
    startWorker("30m", 500);
    // 组 4: 1h, 频率 1.3枚/秒
    startWorker("1h", 750);
    // 组 5: 2h, 频率 1枚/秒
    startWorker("2h", 1000);
    // 组 6: 4h, 频率 1枚/1.5秒
    startWorker("4h", 1500);
    // 组 7: 8h, 频率 1枚/2秒
    startWorker("8h", 2000);
    // 组 8: 1d, 频率 1枚/3秒
    startWorker("1d", 3000);

    return () => {
      workersRef.current = {}; // Stop all on unmount
    };
  }, []);

  // 状态轮询更新 UI
  useEffect(() => {
    const timer = setInterval(() => {
      scheduleUpdate();
    }, 3000);
    return () => clearInterval(timer);
  }, [scheduleUpdate]);

  // --- HEARTBEAT & COUNTDOWNS ---
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const newCountdowns: Record<string, string> = {};

      configRef.current.timeframes.forEach((tf) => {
        const tfMinutes = getTfMinutes(tf);
        if (tfMinutes === 0) return;
        const intervalMs = tfMinutes * 60 * 1000;

        const nextClose = Math.ceil(now / intervalMs) * intervalMs;
        const diff = nextClose - now;

        if (diff > 0) {
          const m = Math.floor(diff / 60000)
            .toString()
            .padStart(2, "0");
          const s = Math.floor((diff % 60000) / 1000)
            .toString()
            .padStart(2, "0");
          newCountdowns[tf] = `${m}:${s}`;
        } else {
          newCountdowns[tf] = "SCAN";
        }
      });

      setCountdowns(newCountdowns);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return {
    config,
    setConfig,
    list2,
    status,
    scanText,
    countdowns,
    tfCounts,
    activeScanTfs,
    lastScanTime,
    removeItem,
    clearItems,
    removeSignal,
  };
};
