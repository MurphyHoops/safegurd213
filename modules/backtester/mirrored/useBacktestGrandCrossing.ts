import { useState, useRef, useEffect, useCallback } from "react";
import { usePersistedState } from "../../../hooks/usePersistedState";
import {
  List2Config,
  ScannerItem,
} from "../../../components/Scanner/scannerTypes";
import { analyzeList2Crossing } from "../../../services/rules/list2_crossing";
import { useBacktest } from "../BacktestContext";

const getTfMinutes = (tf: string) => {
  const unit = tf.slice(-1);
  const val = parseInt(tf);
  if (unit === "m") return val;
  if (unit === "h") return val * 60;
  if (unit === "d") return val * 1440;
  return 0;
};

export const useBacktestGrandCrossing = (
  candidates: ScannerItem[],
  initialConfig: List2Config,
  onLog?: (
    type: "INFO" | "SUCCESS" | "WARNING" | "DANGER",
    message: string,
  ) => void,
) => {
  const { fetchVirtualKlines, virtualTime, speed, isPlaying } = useBacktest();
  const [config, setConfig] = usePersistedState<List2Config>(
    "SCANNER_LIST2_CONFIG",
    initialConfig,
  );
  const [list2, setList2] = useState<ScannerItem[]>([]);
  const [status, setStatus] = useState<"IDLE" | "SCANNING">("IDLE");

  const cacheRef = useRef<Map<string, ScannerItem>>(new Map());
  const tfLastScanRef = useRef<Record<string, number>>({});
  const expiredList2SignalCacheRef = useRef<Set<string>>(new Set());

  const performUpdate = useCallback(() => {
    let items = Array.from(cacheRef.current.values());

    // Update prices from candidates
    items = items.map((item) => {
      const candidate = candidates.find((c) => c.symbol === item.symbol);
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

    // Update lag relative to current virtualTime
    const retention = config.newModeRetention ?? 9;
    items = items
      .map((item): ScannerItem | null => {
        if (!item.groupedResults) return null;

        const updatedResults = item.groupedResults
          .map((r) => {
            const tfMinutes = getTfMinutes(r.tf || "15m");
            const intervalMs = tfMinutes * 60 * 1000;
            const signalTime =
              r.crossingTimes && r.crossingTimes.length > 0
                ? r.crossingTimes[0]
                : virtualTime;
            const elapsedMs = virtualTime - signalTime;
            const currentLag = Math.floor(elapsedMs / intervalMs);
            if (r.lag === currentLag) return r;
            return { ...r, lag: currentLag };
          })
          .filter((r) => r.lag! <= retention && r.lag! >= 0)
          .filter((r) => {
            if (config.strictFiltering) {
              const ratio = r.bodyRatio ?? 0; // Use strict default of 0
              if (ratio < (config.minBodyRatio || 0)) return false;

              // Check validation flags if defined
              if (r.bodyValid !== undefined && !r.bodyValid) return false;
              if (r.ampValid !== undefined && !r.ampValid) return false;
              if (r.volValid !== undefined && !r.volValid) return false;

              // Check amplitude bounds
              const squeezeVal = r.squeezeVal ?? 0;
              if (squeezeVal < (config.squeezeThreshold || 0) || squeezeVal > (config.maxAmplitude || 50)) return false;
            }
            return !expiredList2SignalCacheRef.current.has(
              `${item.symbol}-${r.tf}-${r.direction}`,
            );
          });

        if (updatedResults.length === 0) return null;
        return { ...item, groupedResults: updatedResults };
      })
      .filter((item): item is ScannerItem => item !== null);

    const resultsStr = JSON.stringify(items);
    setList2(prev => {
      if (resultsStr !== JSON.stringify(prev)) {
        return items;
      }
      return prev;
    });
  }, [candidates, config.newModeRetention, virtualTime]);

  useEffect(() => {
    performUpdate();
  }, [candidates, performUpdate]);

  const isScanningRef = useRef<boolean>(false);
  const pendingTfsRef = useRef<Set<string>>(new Set());

  const runScan = async (targetTfs: string[]) => {
    if (candidates.length === 0) return;
    
    targetTfs.forEach(tf => pendingTfsRef.current.add(tf));

    if (isScanningRef.current) {
      return;
    }

    isScanningRef.current = true;
    setStatus("SCANNING");

    try {
      while (pendingTfsRef.current.size > 0) {
        const tfsToScan = Array.from(pendingTfsRef.current);
        pendingTfsRef.current.clear();

        onLog?.(
          "INFO",
          `[回测-列表2] 触发扫描, 周期: ${tfsToScan.join(", ")}, 币种数: ${candidates.length}`,
        );

        for (const tf of tfsToScan) {
          onLog?.("INFO", `[回测-列表2] 正在扫描 ${tf} 周期...`);
          for (const item of candidates) {
            try {
              const klines = await fetchVirtualKlines(item.symbol, tf, 150);
              if (klines.length > 0) {
                const closes = klines.map((k) => k.close);
                const highs = klines.map((k) => k.high);
                const lows = klines.map((k) => k.low);
                const opens = klines.map((k) => k.open);
                const volumes = klines.map((k) => k.volume);
                const timestamps = klines.map((k) => k.time);

                const maxNewLag = isPlaying ? Math.max(1, Math.ceil(speed)) : 1;

                let results = analyzeList2Crossing(
                  item.symbol,
                  tf,
                  closes,
                  highs,
                  lows,
                  opens,
                  volumes,
                  timestamps,
                  { ...config, maxLag: 15 } as any,
                  maxNewLag,
                );

                // Filter by expired cache
                results = results.filter(
                  (r) =>
                    !expiredList2SignalCacheRef.current.has(
                      `${item.symbol}-${r.tf}-${r.direction}`,
                    ),
                );

                if (results.length > 0) {
                  const cacheKey = `${item.symbol}-FULL`;
                  const existing = cacheRef.current.get(cacheKey);
                  const merged = existing
                    ? [...(existing.groupedResults || [])]
                    : [];
                  const cleanMerged = merged.filter((r) => r.tf !== tf);
                  cleanMerged.push(...results);

                  let finalMerged = cleanMerged;
                  if (config.strictFiltering) {
                    finalMerged = cleanMerged.filter((r) => {
                      const ratio = r.bodyRatio ?? 0;
                      if (ratio < (config.minBodyRatio || 0)) return false;

                      // Check validation flags if defined
                      if (r.bodyValid !== undefined && !r.bodyValid) return false;
                      if (r.ampValid !== undefined && !r.ampValid) return false;
                      if (r.volValid !== undefined && !r.volValid) return false;

                      // Check amplitude bounds
                      const squeezeVal = r.squeezeVal ?? 0;
                      if (squeezeVal < (config.squeezeThreshold || 0) || squeezeVal > (config.maxAmplitude || 50)) return false;

                      return true;
                    });
                  }

                  if (finalMerged.length > 0) {
                    cacheRef.current.set(cacheKey, {
                      ...item,
                      groupedResults: finalMerged,
                      direction: finalMerged[0].direction,
                      tf: finalMerged[0].tf,
                      lastUpdated: virtualTime,
                    });
                  } else {
                    cacheRef.current.delete(cacheKey);
                  }

                  onLog?.(
                    "SUCCESS",
                    `[回测-列表2] 发现信号: ${item.symbol} ${tf} ${cleanMerged[0].direction}`,
                  );
                }
              }
            } catch (e) {}
          }
        }
      }
    } finally {
      performUpdate();
      isScanningRef.current = false;
      setStatus("IDLE");
    }
  };

  // Trigger scan based on virtual time
  useEffect(() => {
    const triggeredTfs = config.timeframes.filter((tf) => {
      const tfMinutes = getTfMinutes(tf);
      if (tfMinutes === 0) return false;
      const intervalMs = tfMinutes * 60 * 1000;
      const currentCandleStart =
        Math.floor(virtualTime / intervalMs) * intervalMs;
      const lastScan = tfLastScanRef.current[tf] || 0;

      if (lastScan < currentCandleStart) {
        tfLastScanRef.current[tf] = virtualTime;
        return true;
      }
      return false;
    });

    if (triggeredTfs.length > 0) {
      runScan(triggeredTfs);
    }
  }, [virtualTime, config.timeframes]);

  const clearItems = useCallback(() => {
    cacheRef.current.clear();
    performUpdate();
  }, [performUpdate]);

  const removeItem = useCallback(
    (symbol: string) => {
      cacheRef.current.delete(`${symbol}-FULL`);
      performUpdate();
    },
    [performUpdate],
  );

  const removeSignal = useCallback(
    (uniqueId: string) => {
      const parts = uniqueId.split("-");
      if (parts.length < 3) return;
      const symbol = parts[0];
      const tf = parts[1];
      const direction = parts[2];

      expiredList2SignalCacheRef.current.add(uniqueId);

      const cached = cacheRef.current.get(`${symbol}-FULL`);
      if (cached && cached.groupedResults) {
        // ALWAYS delete the entire symbol from List 2, regardless of TF/Direction
        // User requested: "不管是什么时间周期的都删除掉"
        cacheRef.current.delete(`${symbol}-FULL`);
        performUpdate();
      }
    },
    [performUpdate],
  );

  return {
    config,
    setConfig,
    list2,
    status,
    scanText: status === "SCANNING" ? "扫描中..." : "监控中...",
    countdowns: {},
    tfCounts: {},
    activeScanTfs: new Set(),
    lastScanTime: null,
    removeItem,
    clearItems,
    removeSignal,
  };
};
