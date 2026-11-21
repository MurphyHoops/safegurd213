import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { ScannerSettings, PositionSide, Position, KLine, StrategyItem, TradeLog } from "../types";
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
import { getVolume8am } from "../services/volume8amService";
import { normalizeSymbol, resolvePrice, formatToBinanceSymbol } from "../services/symbolUtils";
import { fetchWithFallback } from "../services/apiService";
import { klineMultiTfStore } from "../services/klineMultiTfStore";
import { logSignalOccurrence } from "../services/binanceLogger";
import { l234DataStore } from "../services/l234DataStore";

// 1. 冷却锁与已开/已平仓持久化缓存结构：防止刷新或重启程序后 List 1 InstantOpen 重新自动开仓
const PANIC_COOLDOWN_STORAGE_KEY = 'SAFREGUARD_PANIC_COOLDOWN_MAP';
const LIST1_OPENED_STORAGE_KEY = 'SCANNER_LIST1_OPENED_SYMBOLS';
const LIST1_CLOSED_TIMES_STORAGE_KEY = 'SCANNER_LIST1_CLOSED_TIMES';
const COOLDOWN_DURATION_MS = 30 * 60 * 1000; // 清仓后冷却 30 分钟
const CLOSED_MEMORY_DURATION_MS = 12 * 60 * 60 * 1000; // 已平仓/已开仓记忆保持 12 小时

// 从本地存储恢复冷却状态，防止刷新页面后立即复开
const getInitialCooldownMap = (): Map<string, number> => {
  try {
    const raw = localStorage.getItem(PANIC_COOLDOWN_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw);
    const now = Date.now();
    const validEntries = Object.entries(parsed).filter(([_, expireAt]) => (expireAt as number) > now);
    return new Map(validEntries as [string, number][]);
  } catch {
    return new Map();
  }
};

const getInitialList1ClosedTimes = (): Record<string, number> => {
  const result: Record<string, number> = {};
  const now = Date.now();
  try {
    const raw = localStorage.getItem(LIST1_CLOSED_TIMES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        Object.entries(parsed).forEach(([sym, ts]) => {
          if (typeof ts === 'number' && now - ts < CLOSED_MEMORY_DURATION_MS) {
            result[normalizeSymbol(sym)] = ts;
          }
        });
      }
    }
  } catch {}
  try {
    const recentRaw = localStorage.getItem('SAVIOR_RECENTLY_CLOSED_KEYS');
    if (recentRaw) {
      const parsed = JSON.parse(recentRaw);
      if (Array.isArray(parsed)) {
        parsed.forEach(([k, ts]: [string, number]) => {
          if (typeof ts === 'number' && now - ts < CLOSED_MEMORY_DURATION_MS) {
            const sym = normalizeSymbol(String(k).replace(/_(LONG|SHORT|BOTH)$/i, ''));
            if (sym) {
              result[sym] = Math.max(result[sym] || 0, ts);
            }
          }
        });
      }
    }
  } catch {}
  return result;
};

const getInitialList1OpenedSet = (): Set<string> => {
  const set = new Set<string>();
  const now = Date.now();
  try {
    const raw = localStorage.getItem(LIST1_OPENED_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((item: any) => {
          if (typeof item === 'string') {
            set.add(normalizeSymbol(item));
          } else if (item && item.symbol && typeof item.ts === 'number' && now - item.ts < CLOSED_MEMORY_DURATION_MS) {
            set.add(normalizeSymbol(item.symbol));
          }
        });
      }
    }
  } catch {}
  Object.keys(getInitialList1ClosedTimes()).forEach(sym => set.add(sym));
  return set;
};

const persistList1OpenedSet = (set: Set<string>) => {
  try {
    const now = Date.now();
    const arr = Array.from(set).slice(-300).map(symbol => ({ symbol, ts: now }));
    localStorage.setItem(LIST1_OPENED_STORAGE_KEY, JSON.stringify(arr));
  } catch {}
};

const persistList1ClosedTimes = (map: Record<string, number>) => {
  try {
    const now = Date.now();
    const cleaned: Record<string, number> = {};
    Object.entries(map).forEach(([sym, ts]) => {
      if (typeof ts === 'number' && now - ts < CLOSED_MEMORY_DURATION_MS) {
        cleaned[sym] = ts;
      }
    });
    localStorage.setItem(LIST1_CLOSED_TIMES_STORAGE_KEY, JSON.stringify(cleaned));
  } catch {}
};
import KlineChartModal from "./KlineChartModal";
import { ErrorBoundary } from "./ErrorBoundary";
import { usePersistedState } from "../hooks/usePersistedState";
import { loadState, saveState, saveStateDebounced } from "../utils/persistence";
import { eventBus } from "../core/EventBus";
import { CoinContextMenu, CoinContextMenuState } from "./CoinContextMenu";
import { QuickTradeModal } from "./QuickTradeModal";
import { DomTrackerWidget } from "./DomTrackerWidget";

// --- ALL ATOMIC MODULES ---
import { MarketScannerModule } from "../modules/market-scanner";
import { GrandCrossingModule } from "../modules/grand-crossing";
import { StructureAuditModule } from "../modules/structure-audit";
import { MomentumAuditModule } from "../modules/momentum-audit";
import { LiveBattlefieldModule } from "../modules/live-battlefield";
import { TacticalCommandModule } from "../modules/tactical-command";
import { markList4SignalConsumedInStorage } from "../modules/momentum-audit/MomentumAuditUI";
import { persistExpiredSignalKey, getStructureLockKey } from "../modules/momentum-audit/useMomentumAudit";

const MemoizedMarketScannerModule = React.memo(MarketScannerModule, (prev, next) => {
  return prev.scanConfig === next.scanConfig &&
         prev.directMode === next.directMode &&
         prev.mode === next.mode &&
         prev.selectedStrategyId === next.selectedStrategyId &&
         prev.strategies === next.strategies &&
         prev.onAddStrategy === next.onAddStrategy &&
         prev.onDeleteStrategy === next.onDeleteStrategy &&
         prev.onRenameStrategy === next.onRenameStrategy &&
         prev.onSelectStrategy === next.onSelectStrategy &&
         prev.onInstantCandidatesUpdate === next.onInstantCandidatesUpdate &&
         prev.isScanAllowed === next.isScanAllowed &&
         prev.isRotationEnabled === next.isRotationEnabled &&
         prev.rotationIntervalMinutes === next.rotationIntervalMinutes &&
         prev.rotationTimeLeft === next.rotationTimeLeft &&
         prev.activeStrategyId === next.activeStrategyId &&
         prev.isSyncing === next.isSyncing &&
         prev.list2Results === next.list2Results &&
         prev.list3Results === next.list3Results &&
         prev.list3Config === next.list3Config &&
         prev.currentPrices === next.currentPrices;
});

const MemoizedGrandCrossingModule = React.memo(GrandCrossingModule, (prev, next) => {
  return prev.networkStatus === next.networkStatus && 
         prev.candidates === next.candidates && 
         prev.activePositions === next.activePositions &&
         prev.directMode === next.directMode &&
         prev.strategyId === next.strategyId &&
         prev.isBackground === next.isBackground &&
         prev.scanConfig === next.scanConfig;
});
const MemoizedStructureAuditModule = React.memo(StructureAuditModule, (prev, next) => {
  return prev.candidates === next.candidates && 
         prev.activePositions === next.activePositions && 
         prev.directMode === next.directMode &&
         prev.strategyId === next.strategyId &&
         prev.isBackground === next.isBackground &&
         prev.actionConfig === next.actionConfig;
});
const MemoizedMomentumAuditModule = React.memo(MomentumAuditModule, (prev, next) => {
  return prev.candidates === next.candidates && 
         prev.activePositions === next.activePositions && 
         prev.list3Config === next.list3Config &&
         prev.strategyId === next.strategyId &&
         prev.isBackground === next.isBackground &&
         prev.actionConfig === next.actionConfig;
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
import { SymbolFilterDiagnosticBar } from "./SymbolFilterDiagnosticBar";
import { backtestDownloader } from "../services/backtest/downloader";
import { backtestDb } from "../services/backtest/db";
import {
  BacktestProvider,
  useBacktest,
} from "../modules/backtester/BacktestContext";

// 🔒 列表1单向顺势轨迹记忆表：记录每个币种在扫描周期内的实时价格与峰值轨迹（按 多/空 独立隔离，跨日8AM/刷新极值/平仓后低谷自动重置）
interface List1SymbolTrajectory {
  lastPrice: number;
  sessionMaxPrice: number;
  sessionMinPrice: number;
  maxDirChg24: number;
  maxDirChg8am: number;
  maxBounce24: number;
  maxBounce8am: number;
  trackedLow24: number;
  trackedHigh24: number;
  trackedLow8: number;
  trackedHigh8: number;
  day8amTs: number;
  postCloseAnchorTs: number;
  postCloseMinPrice: number;
  postCloseMaxPrice: number;
  postCloseTroughTime: number;
  postCloseHighAfterTrough: number;
  postCloseLowAfterTrough: number;
  updatedAt: number;
}
const list1SymbolTrajectoryMap = new Map<string, List1SymbolTrajectory>();

// 🔒 列表1“立即开/平仓后续开” 5m K线时序核验缓存：严格按时间顺序检验“先触极值还是先超上限”
interface Instant5mBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}
interface Instant5mCacheEntry {
  bars: Instant5mBar[];
  fetchedAt: number;
  failedUntil?: number;
}
const INSTANT_5M_CACHE_TTL_MS = 25_000;
const INSTANT_5M_ERROR_COOLDOWN_MS = 10_000;
const instant5mKlineCache = new Map<string, Instant5mCacheEntry>();
const instant5mInFlightMap = new Map<string, Promise<void>>();
const instant5mPendingSet = new Set<string>();
const instant5mQueue: string[] = [];
let instant5mActiveWorkers = 0;

const parseRaw5mBars = (rawList: any[]): Instant5mBar[] => {
  const parsed: Instant5mBar[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const k = rawList[i];
    if (Array.isArray(k)) {
      const rawTime = Number(k[0]) || 0;
      const time = rawTime > 0 && rawTime < 1e12 ? rawTime * 1000 : rawTime;
      const open = parseFloat(k[1]) || 0;
      const high = parseFloat(k[2]) || 0;
      const low = parseFloat(k[3]) || 0;
      const close = parseFloat(k[4]) || 0;
      if (time > 0 && open > 0 && high > 0 && low > 0 && close > 0) {
        parsed.push({ time, open, high, low, close });
      }
    } else if (k && typeof k === 'object') {
      const rawTime = Number(k.time ?? k.t ?? 0) || 0;
      const time = rawTime > 0 && rawTime < 1e12 ? rawTime * 1000 : rawTime;
      const open = Number(k.open ?? k.o) || 0;
      const high = Number(k.high ?? k.h) || 0;
      const low = Number(k.low ?? k.l) || 0;
      const close = Number(k.close ?? k.c) || 0;
      if (time > 0 && open > 0 && high > 0 && low > 0 && close > 0) {
        parsed.push({ time, open, high, low, close });
      }
    }
  }
  parsed.sort((a, b) => a.time - b.time);
  return parsed;
};

const getInstant5mBars = (symbol: string, curPrice: number, nowTs: number): Instant5mBar[] | null => {
  const binanceSym = formatToBinanceSymbol(symbol);
  if (!binanceSym) return null;

  const patchAndTrim = (bars: Instant5mBar[]): Instant5mBar[] => {
    const cutoff = nowTs - 26 * 3600 * 1000;
    while (bars.length > 1 && bars[0].time < cutoff) {
      bars.shift();
    }
    if (curPrice > 0 && bars.length > 0) {
      const bucketStart = Math.floor(nowTs / 300_000) * 300_000;
      const last = bars[bars.length - 1];
      if (last.time >= bucketStart) {
        if (curPrice > last.high) last.high = curPrice;
        if (curPrice < last.low) last.low = curPrice;
        last.close = curPrice;
      } else {
        bars.push({
          time: bucketStart,
          open: last.close || curPrice,
          high: curPrice,
          low: curPrice,
          close: curPrice,
        });
      }
    }
    return bars;
  };

  const cached = instant5mKlineCache.get(binanceSym);
  if (cached) {
    if (cached.failedUntil && cached.failedUntil > nowTs) {
      return cached.bars.length > 0 ? patchAndTrim(cached.bars) : null;
    }
    if (nowTs - cached.fetchedAt < INSTANT_5M_CACHE_TTL_MS && cached.bars.length > 0) {
      return patchAndTrim(cached.bars);
    }
  }

  // 0ms 复用 klineMultiTfStore 中已预热的完整 5m K线（>= 288 根且最近10分钟内更新）
  const storeKlines = klineMultiTfStore.getKlinesSync(binanceSym, '5m', 288);
  if (storeKlines && storeKlines.length >= 288) {
    const parsed = parseRaw5mBars(storeKlines);
    if (parsed.length >= 288 && nowTs - parsed[parsed.length - 1].time < 10 * 60 * 1000) {
      const cloned = parsed.map(b => ({ ...b }));
      instant5mKlineCache.set(binanceSym, { bars: cloned, fetchedAt: nowTs });
      return patchAndTrim(cloned);
    }
  }

  return null;
};

const fetchSingleInstant5mKline = async (binanceSym: string): Promise<boolean> => {
  const existing = instant5mInFlightMap.get(binanceSym);
  if (existing) {
    await existing;
    const entry = instant5mKlineCache.get(binanceSym);
    return Boolean(entry && entry.bars.length > 0);
  }

  const task = (async () => {
    const nowTs = Date.now();
    try {
      const res = await fetchWithFallback(
        `/fapi/v1/klines?symbol=${binanceSym}&interval=5m&limit=300`,
        { priority: 'HIGH', timeout: 8000 }
      );
      const isFallback =
        res.headers.get('X-Rate-Limit-Fallback') === 'true' ||
        res.headers.get('x-rate-limit-fallback') === 'true';
      if (!res.ok || isFallback) {
        const prev = instant5mKlineCache.get(binanceSym);
        instant5mKlineCache.set(binanceSym, {
          bars: prev?.bars || [],
          fetchedAt: prev?.fetchedAt || 0,
          failedUntil: nowTs + INSTANT_5M_ERROR_COOLDOWN_MS,
        });
        return;
      }
      const raw = await res.json();
      if (Array.isArray(raw) && raw.length > 0) {
        const parsed = parseRaw5mBars(raw);
        if (parsed.length > 0) {
          instant5mKlineCache.set(binanceSym, { bars: parsed, fetchedAt: Date.now() });
          try {
            klineMultiTfStore.saveKlines(binanceSym, '5m', raw);
          } catch (_) {}
          return;
        }
      }
      const prev = instant5mKlineCache.get(binanceSym);
      instant5mKlineCache.set(binanceSym, {
        bars: prev?.bars || [],
        fetchedAt: prev?.fetchedAt || 0,
        failedUntil: nowTs + INSTANT_5M_ERROR_COOLDOWN_MS,
      });
    } catch (_) {
      const prev = instant5mKlineCache.get(binanceSym);
      instant5mKlineCache.set(binanceSym, {
        bars: prev?.bars || [],
        fetchedAt: prev?.fetchedAt || 0,
        failedUntil: nowTs + INSTANT_5M_ERROR_COOLDOWN_MS,
      });
    } finally {
      instant5mInFlightMap.delete(binanceSym);
    }
  })();

  instant5mInFlightMap.set(binanceSym, task);
  await task;
  const entry = instant5mKlineCache.get(binanceSym);
  return Boolean(entry && entry.bars.length > 0);
};

const prefetchInstant5mKlines = (symbols: string[], onBatchComplete: () => void): void => {
  if (!symbols || symbols.length === 0) return;
  const nowTs = Date.now();
  let added = false;

  for (let i = 0; i < symbols.length; i++) {
    const binanceSym = formatToBinanceSymbol(symbols[i]);
    if (!binanceSym) continue;
    const cached = instant5mKlineCache.get(binanceSym);
    if (cached && nowTs - cached.fetchedAt < INSTANT_5M_CACHE_TTL_MS && cached.bars.length > 0) continue;
    if (cached && cached.failedUntil && cached.failedUntil > nowTs) continue;
    if (instant5mInFlightMap.has(binanceSym) || instant5mPendingSet.has(binanceSym)) continue;
    instant5mPendingSet.add(binanceSym);
    instant5mQueue.push(binanceSym);
    added = true;
  }

  if (!added && instant5mQueue.length === 0) return;

  const MAX_CONCURRENT = 3;
  const runWorker = async () => {
    let fetchedAny = false;
    while (instant5mQueue.length > 0) {
      const sym = instant5mQueue.shift();
      if (!sym) continue;
      instant5mPendingSet.delete(sym);
      const ok = await fetchSingleInstant5mKline(sym);
      if (ok) fetchedAny = true;
    }
    if (fetchedAny) {
      onBatchComplete();
    }
  };

  while (instant5mActiveWorkers < MAX_CONCURRENT && instant5mQueue.length > 0) {
    instant5mActiveWorkers++;
    runWorker().finally(() => {
      instant5mActiveWorkers = Math.max(0, instant5mActiveWorkers - 1);
    });
  }
};

interface Raw24hMaps {
  rawLowMap: Record<string, number>;
  rawHighMap: Record<string, number>;
  rawOpenMap: Record<string, number>;
}

const buildRaw24hMaps = (): Raw24hMaps => {
  const rawLowMap: Record<string, number> = {};
  const rawHighMap: Record<string, number> = {};
  const rawOpenMap: Record<string, number> = {};
  try {
    let parsed: any = (typeof window !== 'undefined' && Array.isArray((window as any).__SCANNER_RAW_DATA_MEM__))
      ? (window as any).__SCANNER_RAW_DATA_MEM__
      : null;
    if (!parsed) {
      const rawCache = localStorage.getItem('SCANNER_RAW_DATA_CACHE');
      if (rawCache) {
        parsed = JSON.parse(rawCache);
        if (Array.isArray(parsed) && typeof window !== 'undefined') {
          (window as any).__SCANNER_RAW_DATA_MEM__ = parsed;
        }
      }
    }
    if (Array.isArray(parsed)) {
      for (let i = 0; i < parsed.length; i++) {
        const d = parsed[i];
        if (d && d.symbol) {
          const norm = normalizeSymbol(d.symbol).replace(/USDT$/i, '');
          const lp = parseFloat(d.lowPrice);
          if (lp > 0) {
            rawLowMap[norm] = lp;
            rawLowMap[`${norm}USDT`] = lp;
          }
          const hp = parseFloat(d.highPrice);
          if (hp > 0) {
            rawHighMap[norm] = hp;
            rawHighMap[`${norm}USDT`] = hp;
          }
          const op = parseFloat(d.openPrice);
          if (op > 0) {
            rawOpenMap[norm] = op;
            rawOpenMap[`${norm}USDT`] = op;
          }
        }
      }
    }
  } catch (_) {}
  return { rawLowMap, rawHighMap, rawOpenMap };
};

interface List1CandidateEvalResult {
  passed: boolean;
  needs5mFetch: boolean;
  matchedTrend: {
    chg24: boolean;
    chg8am: boolean;
    bounce24: boolean;
    bounce8am: boolean;
  };
  matchedVol: {
    vol24: boolean;
    vol8am: boolean;
  };
  curPrice: number;
  v24: number;
  v8am: number;
  dirChg24: number | null;
  dirChg8am: number | null;
  b24: number | null;
  b8: number | null;
}

/**
 * 纯上限+5m时序核验核心评估器（多空完全对称）：
 * 1. 移除区间内 0.5% 微幅回撤/逆向运动误杀（方案1：纯上限判定）；
 * 2. 在时间起点内（24H / 8AM / 24H极值之后 / 8AM极值之后）通过 5m K线时序校验：
 *    - 24H/8AM涨跌幅：起点到当前之间曾超过设定上限 -> 判定为从上面跌下来（做空反之）-> 严格拦截；
 *    - 24H/8AM极值涨跌幅：严格先定位最低点 lowIdx（做空定位最高点 highIdx），仅检测极值发生【之后】到当前的价格是否曾超过上限，彻底解决刷新失忆与先跌后涨误杀；
 * 3. 若带上限条件即时命中 [下限, 上限] 且尚无 5m K线缓存，则标记 needs5mFetch = true 并暂缓放行直至 5m K线核验完成。
 */
const evaluateList1PushCandidate = (
  item: ScannerItem,
  pushConfig: any,
  currentPricesMap: Record<string, number>,
  openDirection: 'LONG' | 'SHORT',
  requireTrendThreshold: boolean,
  rawMaps: Raw24hMaps,
  nowTs: number,
  options?: { updateTrajectory?: boolean; resolvedPriceOverride?: number; lastClosedTime?: number }
): List1CandidateEvalResult => {
  const isShortMode = openDirection === 'SHORT';
  const lastClosedTime = options?.lastClosedTime && options.lastClosedTime > 0 ? options.lastClosedTime : 0;
  const isReopenMode = lastClosedTime > 0;
  const norm = normalizeSymbol(item.symbol).replace(/USDT$/i, '');
  const v8 = getVolume8am(`${norm}USDT`) || getVolume8am(item.symbol) || null;
  const curPrice = options?.resolvedPriceOverride && options.resolvedPriceOverride > 0
    ? options.resolvedPriceOverride
    : resolvePrice(item.symbol, currentPricesMap, Number(item.price || v8?.lastPrice || 0));

  const { rawLowMap, rawHighMap, rawOpenMap } = rawMaps;

  const v24 = (item.volume24h !== undefined && item.volume24h !== null && !isNaN(Number(item.volume24h)) && Number(item.volume24h) > 0)
    ? Number(item.volume24h)
    : (item.quoteVolume !== undefined && item.quoteVolume !== null && !isNaN(Number(item.quoteVolume)))
    ? Number(item.quoteVolume) / 1_000_000
    : (item.price && item.volume)
    ? (Number(item.price) * Number(item.volume)) / 1_000_000
    : 0;

  const v8am = (v8 && v8.volume8am !== undefined && !isNaN(Number(v8.volume8am)))
    ? Number(v8.volume8am)
    : (item.volume8am !== undefined && item.volume8am !== null && !isNaN(Number(item.volume8am)))
    ? Number(item.volume8am)
    : 0;

  const open24 = rawOpenMap[norm] || rawOpenMap[`${norm}USDT`] || 0;
  const it = item as any;
  const c24: number | null = (curPrice > 0 && open24 > 0)
    ? ((curPrice - open24) / open24) * 100
    : (item.change !== undefined && item.change !== null && !isNaN(Number(item.change)))
    ? Number(item.change)
    : (it.chg24h !== undefined && !isNaN(Number(it.chg24h)))
    ? Number(it.chg24h)
    : (it.priceChangePercent !== undefined && !isNaN(Number(it.priceChangePercent)))
    ? Number(it.priceChangePercent)
    : null;

  const c8am: number | null = (v8 && v8.openPrice > 0 && curPrice > 0)
    ? ((curPrice - v8.openPrice) / v8.openPrice) * 100
    : (v8 && v8.change8am !== undefined && v8.change8am !== null && !isNaN(Number(v8.change8am)))
    ? Number(v8.change8am)
    : (item.change8am !== undefined && item.change8am !== null && !isNaN(Number(item.change8am)))
    ? Number(item.change8am)
    : (it.chg8am !== undefined && it.chg8am !== null && !isNaN(Number(it.chg8am)))
    ? Number(it.chg8am)
    : null;

  const low24Raw = Number(it.lowPrice || it.low || rawLowMap[norm] || rawLowMap[`${norm}USDT`] || 0);
  const high24Raw = Number(it.highPrice || it.high || rawHighMap[norm] || rawHighMap[`${norm}USDT`] || 0);
  const low24 = low24Raw > 0 && curPrice > 0 ? Math.min(low24Raw, curPrice) : low24Raw;
  const high24 = high24Raw > 0 && curPrice > 0 ? Math.max(high24Raw, curPrice) : high24Raw;
  const b24: number | null = isShortMode
    ? (high24 > 0 && curPrice > 0 ? ((high24 - curPrice) / high24) * 100 : null)
    : (low24 > 0 && curPrice > 0 ? ((curPrice - low24) / low24) * 100 : null);

  const low8Raw = Number(v8?.lowPrice || it.lowPrice8am || 0);
  const high8Raw = Number(v8?.highPrice || it.highPrice8am || 0);
  const low8 = low8Raw > 0 && curPrice > 0 ? Math.min(low8Raw, curPrice) : low8Raw;
  const high8 = high8Raw > 0 && curPrice > 0 ? Math.max(high8Raw, curPrice) : high8Raw;
  const b8: number | null = isShortMode
    ? (high8 > 0 && curPrice > 0 ? ((high8 - curPrice) / high8) * 100 : null)
    : (low8 > 0 && curPrice > 0 ? ((curPrice - low8) / low8) * 100 : null);

  const dirChg24 = c24 !== null ? (isShortMode ? -c24 : c24) : null;
  const dirChg8am = c8am !== null ? (isShortMode ? -c8am : c8am) : null;

  const utcDate = new Date(nowTs);
  const today00Utc = Date.UTC(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), utcDate.getUTCDate(), 0, 0, 0, 0);
  const cutoff24h = nowTs - 24 * 3600 * 1000;
  const start8am = v8?.openTime && v8.openTime > cutoff24h ? v8.openTime : today00Utc;

  // 更新/读取方向隔离轨迹记忆（新极值形成、跨08:00、或新一轮平仓后自动重置追踪起点）
  const trajKey = `${norm}_${openDirection}`;
  let traj = list1SymbolTrajectoryMap.get(trajKey);
  if (!traj || nowTs - traj.updatedAt > 6 * 3600 * 1000) {
    traj = {
      lastPrice: curPrice,
      sessionMaxPrice: curPrice,
      sessionMinPrice: curPrice,
      maxDirChg24: dirChg24 ?? 0,
      maxDirChg8am: dirChg8am ?? 0,
      maxBounce24: b24 ?? 0,
      maxBounce8am: b8 ?? 0,
      trackedLow24: low24,
      trackedHigh24: high24,
      trackedLow8: low8,
      trackedHigh8: high8,
      day8amTs: start8am,
      postCloseAnchorTs: lastClosedTime,
      postCloseMinPrice: curPrice > 0 ? curPrice : 0,
      postCloseMaxPrice: curPrice > 0 ? curPrice : 0,
      postCloseTroughTime: lastClosedTime > 0 ? nowTs : 0,
      postCloseHighAfterTrough: curPrice > 0 ? curPrice : 0,
      postCloseLowAfterTrough: curPrice > 0 ? curPrice : 0,
      updatedAt: nowTs,
    };
    if (options?.updateTrajectory !== false) {
      list1SymbolTrajectoryMap.set(trajKey, traj);
    }
  } else if (options?.updateTrajectory !== false) {
    if (traj.day8amTs !== start8am) {
      traj.day8amTs = start8am;
      traj.maxDirChg8am = dirChg8am ?? 0;
      traj.maxBounce8am = b8 ?? 0;
      traj.trackedLow8 = low8;
      traj.trackedHigh8 = high8;
    }
    if (!isShortMode) {
      if (low24 > 0 && (traj.trackedLow24 <= 0 || low24 < traj.trackedLow24)) {
        traj.trackedLow24 = low24;
        traj.maxBounce24 = b24 ?? 0;
      }
      if (low8 > 0 && (traj.trackedLow8 <= 0 || low8 < traj.trackedLow8)) {
        traj.trackedLow8 = low8;
        traj.maxBounce8am = b8 ?? 0;
      }
    } else {
      if (high24 > 0 && (traj.trackedHigh24 <= 0 || high24 > traj.trackedHigh24)) {
        traj.trackedHigh24 = high24;
        traj.maxBounce24 = b24 ?? 0;
      }
      if (high8 > 0 && (traj.trackedHigh8 <= 0 || high8 > traj.trackedHigh8)) {
        traj.trackedHigh8 = high8;
        traj.maxBounce8am = b8 ?? 0;
      }
    }
    if (curPrice > 0) {
      traj.sessionMaxPrice = Math.max(traj.sessionMaxPrice, curPrice);
      traj.sessionMinPrice = traj.sessionMinPrice > 0 ? Math.min(traj.sessionMinPrice, curPrice) : curPrice;
      traj.lastPrice = curPrice;
    }
    if (lastClosedTime > 0) {
      if (traj.postCloseAnchorTs !== lastClosedTime) {
        traj.postCloseAnchorTs = lastClosedTime;
        traj.postCloseMinPrice = curPrice > 0 ? curPrice : 0;
        traj.postCloseMaxPrice = curPrice > 0 ? curPrice : 0;
        traj.postCloseTroughTime = nowTs;
        traj.postCloseHighAfterTrough = curPrice > 0 ? curPrice : 0;
        traj.postCloseLowAfterTrough = curPrice > 0 ? curPrice : 0;
      } else if (curPrice > 0) {
        traj.postCloseMinPrice = traj.postCloseMinPrice > 0 ? Math.min(traj.postCloseMinPrice, curPrice) : curPrice;
        traj.postCloseMaxPrice = Math.max(traj.postCloseMaxPrice, curPrice);
        if (!isShortMode) {
          if (curPrice <= traj.postCloseMinPrice) {
            traj.postCloseTroughTime = nowTs;
            traj.postCloseHighAfterTrough = curPrice;
          } else {
            traj.postCloseHighAfterTrough = Math.max(traj.postCloseHighAfterTrough, curPrice);
          }
        } else {
          if (curPrice >= traj.postCloseMaxPrice) {
            traj.postCloseTroughTime = nowTs;
            traj.postCloseLowAfterTrough = curPrice;
          } else {
            traj.postCloseLowAfterTrough = traj.postCloseLowAfterTrough > 0
              ? Math.min(traj.postCloseLowAfterTrough, curPrice)
              : curPrice;
          }
        }
      }
    } else if (traj.postCloseAnchorTs > 0) {
      traj.postCloseAnchorTs = 0;
      traj.postCloseMinPrice = 0;
      traj.postCloseMaxPrice = 0;
      traj.postCloseTroughTime = 0;
      traj.postCloseHighAfterTrough = 0;
      traj.postCloseLowAfterTrough = 0;
    }
    if (dirChg24 !== null) traj.maxDirChg24 = Math.max(traj.maxDirChg24, dirChg24);
    if (dirChg8am !== null) traj.maxDirChg8am = Math.max(traj.maxDirChg8am, dirChg8am);
    if (b24 !== null) traj.maxBounce24 = Math.max(traj.maxBounce24, b24);
    if (b8 !== null) traj.maxBounce8am = Math.max(traj.maxBounce8am, b8);
    traj.updatedAt = nowTs;
  }

  const minChg24 = Math.abs(Number(pushConfig?.minChg24h) || 0);
  const maxChg24 = Math.abs(Number(pushConfig?.maxChg24h) || 0);
  const minChg8am = Math.abs(Number(pushConfig?.minChg8am) || 0);
  const maxChg8am = Math.abs(Number(pushConfig?.maxChg8am) || 0);
  const minVol24 = Number(pushConfig?.minVol24h) || 0;
  const minVol8am = Number(pushConfig?.minVol8am) || 0;
  const minBounce24 = Math.abs(Number(pushConfig?.minBounce24h) || 0);
  const maxBounce24 = Math.abs(Number(pushConfig?.maxBounce24h) || 0);
  const minBounce8am = Math.abs(Number(pushConfig?.minBounce8am) || 0);
  const maxBounce8am = Math.abs(Number(pushConfig?.maxBounce8am) || 0);

  const hasUpperChg24 = maxChg24 > 0 && maxChg24 >= minChg24;
  const hasUpperChg8am = maxChg8am > 0 && maxChg8am >= minChg8am;
  const hasUpperBounce24 = maxBounce24 > 0 && maxBounce24 >= minBounce24;
  const hasUpperBounce8am = maxBounce8am > 0 && maxBounce8am >= minBounce8am;

  // 第一阶段：即时快照区间检查（首次开仓可用 traj 快速拒绝；平仓后续开仅检验当前是否在 [min, max] 区间，交由 5m K线核验平仓前后的 3 档规则）
  const instantOkChg24 = Boolean(
    pushConfig?.enableChg24h && minChg24 > 0 && dirChg24 !== null && dirChg24 >= minChg24 &&
    (!hasUpperChg24 || (dirChg24 <= maxChg24 && (isReopenMode || traj.maxDirChg24 <= maxChg24)))
  );
  const instantOkChg8am = Boolean(
    pushConfig?.enableChg8am && minChg8am > 0 && dirChg8am !== null && dirChg8am >= minChg8am &&
    (!hasUpperChg8am || (dirChg8am <= maxChg8am && (isReopenMode || traj.maxDirChg8am <= maxChg8am)))
  );
  const instantOkBounce24 = Boolean(
    pushConfig?.enableBounce24h && minBounce24 > 0 && b24 !== null && b24 >= minBounce24 &&
    (!hasUpperBounce24 || (b24 <= maxBounce24 && (isReopenMode || traj.maxBounce24 <= maxBounce24)))
  );
  const instantOkBounce8am = Boolean(
    pushConfig?.enableBounce8am && minBounce8am > 0 && b8 !== null && b8 >= minBounce8am &&
    (!hasUpperBounce8am || (b8 <= maxBounce8am && (isReopenMode || traj.maxBounce8am <= maxBounce8am)))
  );

  const vol24Ok = Boolean(pushConfig?.enableVol24h && minVol24 > 0 && v24 >= minVol24);
  const vol8amOk = Boolean(pushConfig?.enableVol8am && minVol8am > 0 && v8am >= minVol8am);

  // 检查是否需要读取 5m K线核验历史时序上限
  const needsUpperCheckForCandidate = (() => {
    if (pushConfig?.mode === 'AND') {
      if (pushConfig?.enableVol24h && !vol24Ok) return false;
      if (pushConfig?.enableVol8am && !vol8amOk) return false;
      if (pushConfig?.enableChg24h && !instantOkChg24) return false;
      if (pushConfig?.enableChg8am && !instantOkChg8am) return false;
      if (pushConfig?.enableBounce24h && !instantOkBounce24) return false;
      if (pushConfig?.enableBounce8am && !instantOkBounce8am) return false;
      return Boolean(
        (pushConfig?.enableChg24h && hasUpperChg24) ||
        (pushConfig?.enableChg8am && hasUpperChg8am) ||
        (pushConfig?.enableBounce24h && hasUpperBounce24) ||
        (pushConfig?.enableBounce8am && hasUpperBounce8am)
      );
    } else {
      return Boolean(
        (instantOkChg24 && hasUpperChg24) ||
        (instantOkChg8am && hasUpperChg8am) ||
        (instantOkBounce24 && hasUpperBounce24) ||
        (instantOkBounce8am && hasUpperBounce8am)
      );
    }
  })();

  const bars5m = needsUpperCheckForCandidate ? getInstant5mBars(item.symbol, curPrice, nowTs) : null;
  let needs5mFetch = false;

  const computeChronologicalPeakBounce = (
    windowBars: Instant5mBar[],
    fallbackTrajPeak: number,
    ignoreTrajFallback: boolean = false
  ): number | null => {
    if (!windowBars || windowBars.length === 0) return null;
    const baseFallback = ignoreTrajFallback ? 0 : fallbackTrajPeak;
    if (!isShortMode) {
      let lowIdx = -1;
      let minBarLow = Infinity;
      for (let i = 0; i < windowBars.length; i++) {
        if (windowBars[i].low > 0 && windowBars[i].low < minBarLow) {
          minBarLow = windowBars[i].low;
          lowIdx = i;
        }
      }
      if (lowIdx < 0 || minBarLow <= 0 || !isFinite(minBarLow)) return baseFallback;
      if (curPrice > 0 && curPrice <= minBarLow) return baseFallback;
      let highAfterLow = Math.max(windowBars[lowIdx].close, curPrice > 0 ? curPrice : 0);
      for (let i = lowIdx + 1; i < windowBars.length; i++) {
        if (windowBars[i].high > highAfterLow) {
          highAfterLow = windowBars[i].high;
        }
      }
      const klinePeak = ((highAfterLow - minBarLow) / minBarLow) * 100;
      return Math.max(baseFallback, klinePeak);
    } else {
      let highIdx = -1;
      let maxBarHigh = 0;
      for (let i = 0; i < windowBars.length; i++) {
        if (windowBars[i].high > maxBarHigh) {
          maxBarHigh = windowBars[i].high;
          highIdx = i;
        }
      }
      if (highIdx < 0 || maxBarHigh <= 0) return baseFallback;
      if (curPrice > 0 && curPrice >= maxBarHigh) return baseFallback;
      let lowAfterHigh = Math.min(windowBars[highIdx].close, curPrice > 0 ? curPrice : Infinity);
      for (let i = highIdx + 1; i < windowBars.length; i++) {
        if (windowBars[i].low > 0 && windowBars[i].low < lowAfterHigh) {
          lowAfterHigh = windowBars[i].low;
        }
      }
      if (!isFinite(lowAfterHigh) || lowAfterHigh <= 0) return baseFallback;
      const klinePeak = ((maxBarHigh - lowAfterHigh) / maxBarHigh) * 100;
      return Math.max(baseFallback, klinePeak);
    }
  };

  /**
   * 平仓后续开三档核验器（多空完全对称）：
   * - 情景1：时间起点以来从未超 maxThreshold -> 直接放行；
   * - 情景2：平仓后跌破了时间起点极值（做空涨破最高点）-> 以平仓后新极值时刻为起点，之后未超 maxThreshold 即放行；
   * - 情景3：曾超 maxThreshold 且未破极值，则平仓后低谷须明确 < minThreshold、自低谷前高点价格回撤 >= minThreshold、且自低谷起未再超 maxThreshold。
   */
  const verifyReopenWindowRules = (
    windowBars: Instant5mBar[],
    metricKind: 'CHG' | 'BOUNCE',
    minThreshold: number,
    maxThreshold: number,
    refOpen: number,
    fullWindowPeak: number,
    windowStartTs: number
  ): boolean => {
    if (fullWindowPeak <= maxThreshold) return true;
    if (!windowBars || windowBars.length === 0) return false;
    if (lastClosedTime <= windowStartTs) return fullWindowPeak <= maxThreshold;

    const preCloseBars = windowBars.filter(b => b.time <= lastClosedTime);
    if (preCloseBars.length === 0) return fullWindowPeak <= maxThreshold;
    const postBars = windowBars.filter(b => b.time > lastClosedTime);

    const anchorActive = traj.postCloseAnchorTs === lastClosedTime;
    const liveMin = curPrice > 0
      ? (anchorActive && traj.postCloseMinPrice > 0 ? Math.min(traj.postCloseMinPrice, curPrice) : curPrice)
      : (anchorActive ? traj.postCloseMinPrice : 0);
    const liveMax = curPrice > 0
      ? (anchorActive && traj.postCloseMaxPrice > 0 ? Math.max(traj.postCloseMaxPrice, curPrice) : curPrice)
      : (anchorActive ? traj.postCloseMaxPrice : 0);

    if (!isShortMode) {
      let preCloseMinLow = Infinity;
      let preStartIdx = 0;
      for (let i = 0; i < preCloseBars.length; i++) {
        if (preCloseBars[i].low > 0 && preCloseBars[i].low < preCloseMinLow) {
          preCloseMinLow = preCloseBars[i].low;
          preStartIdx = i;
        }
      }
      if (!isFinite(preCloseMinLow) || preCloseMinLow <= 0) return false;

      let postLowIdx = -1;
      let postBarMinLow = Infinity;
      for (let i = 0; i < postBars.length; i++) {
        if (postBars[i].low > 0 && postBars[i].low < postBarMinLow) {
          postBarMinLow = postBars[i].low;
          postLowIdx = i;
        }
      }

      const troughIsLive = postBars.length === 0 || (liveMin > 0 && liveMin <= postBarMinLow);
      const postTroughPrice = troughIsLive ? liveMin : postBarMinLow;
      if (!postTroughPrice || !isFinite(postTroughPrice) || postTroughPrice <= 0) return false;

      let afterTroughHigh = curPrice > 0 ? curPrice : postTroughPrice;
      if (troughIsLive) {
        if (anchorActive && traj.postCloseHighAfterTrough > afterTroughHigh) {
          afterTroughHigh = traj.postCloseHighAfterTrough;
        }
      } else {
        afterTroughHigh = Math.max(afterTroughHigh, postBars[postLowIdx].close);
        for (let i = postLowIdx + 1; i < postBars.length; i++) {
          if (postBars[i].high > afterTroughHigh) afterTroughHigh = postBars[i].high;
        }
        if (anchorActive && traj.postCloseTroughTime >= postBars[postLowIdx].time && traj.postCloseHighAfterTrough > afterTroughHigh) {
          afterTroughHigh = traj.postCloseHighAfterTrough;
        }
      }

      const brokeTimeStartExtreme = postTroughPrice < preCloseMinLow;
      const effectiveBaseLow = Math.min(preCloseMinLow, postTroughPrice);
      const peakAfterTroughPct = metricKind === 'CHG'
        ? (refOpen > 0 ? ((afterTroughHigh - refOpen) / refOpen) * 100 : Infinity)
        : ((afterTroughHigh - effectiveBaseLow) / effectiveBaseLow) * 100;

      // 情景2：平仓后跌破之前时间起点最低点 -> 所有条件同步按新极值后走势判定
      if (brokeTimeStartExtreme) {
        return peakAfterTroughPct <= maxThreshold;
      }

      // 情景3a：平仓后低谷必须明确跌破区间下限 minThreshold
      const troughValPct = metricKind === 'CHG'
        ? (refOpen > 0 ? ((postTroughPrice - refOpen) / refOpen) * 100 : Infinity)
        : ((postTroughPrice - preCloseMinLow) / preCloseMinLow) * 100;
      if (troughValPct >= minThreshold) return false;

      // 情景3b：低谷前波段最高点到平仓后低谷的价格跌幅 >= minThreshold
      let preTroughPeakPrice = 0;
      if (metricKind === 'CHG') {
        for (let i = 0; i < preCloseBars.length; i++) {
          if (preCloseBars[i].high > preTroughPeakPrice) preTroughPeakPrice = preCloseBars[i].high;
        }
      } else {
        preTroughPeakPrice = preCloseBars[preStartIdx].close;
        for (let i = preStartIdx + 1; i < preCloseBars.length; i++) {
          if (preCloseBars[i].high > preTroughPeakPrice) preTroughPeakPrice = preCloseBars[i].high;
        }
      }
      const postEnd = troughIsLive ? postBars.length : postLowIdx;
      for (let i = 0; i < postEnd; i++) {
        if (postBars[i].high > preTroughPeakPrice) preTroughPeakPrice = postBars[i].high;
      }
      if (!troughIsLive && postLowIdx >= 0 && postBars[postLowIdx].open > preTroughPeakPrice) {
        preTroughPeakPrice = postBars[postLowIdx].open;
      }
      if (preTroughPeakPrice <= 0) return false;
      const pullbackPct = ((preTroughPeakPrice - postTroughPrice) / preTroughPeakPrice) * 100;
      if (pullbackPct < minThreshold) return false;

      // 情景3c：自平仓后低谷起至今未再超上限
      return peakAfterTroughPct <= maxThreshold;
    } else {
      let preCloseMaxHigh = 0;
      let preStartIdx = 0;
      for (let i = 0; i < preCloseBars.length; i++) {
        if (preCloseBars[i].high > preCloseMaxHigh) {
          preCloseMaxHigh = preCloseBars[i].high;
          preStartIdx = i;
        }
      }
      if (preCloseMaxHigh <= 0) return false;

      let postHighIdx = -1;
      let postBarMaxHigh = 0;
      for (let i = 0; i < postBars.length; i++) {
        if (postBars[i].high > postBarMaxHigh) {
          postBarMaxHigh = postBars[i].high;
          postHighIdx = i;
        }
      }

      const troughIsLive = postBars.length === 0 || (liveMax > 0 && liveMax >= postBarMaxHigh);
      const postTroughPrice = troughIsLive ? liveMax : postBarMaxHigh;
      if (!postTroughPrice || postTroughPrice <= 0) return false;

      let afterTroughLow = curPrice > 0 ? curPrice : postTroughPrice;
      if (troughIsLive) {
        if (anchorActive && traj.postCloseLowAfterTrough > 0 && traj.postCloseLowAfterTrough < afterTroughLow) {
          afterTroughLow = traj.postCloseLowAfterTrough;
        }
      } else {
        if (postBars[postHighIdx].close > 0 && postBars[postHighIdx].close < afterTroughLow) {
          afterTroughLow = postBars[postHighIdx].close;
        }
        for (let i = postHighIdx + 1; i < postBars.length; i++) {
          if (postBars[i].low > 0 && postBars[i].low < afterTroughLow) afterTroughLow = postBars[i].low;
        }
        if (anchorActive && traj.postCloseTroughTime >= postBars[postHighIdx].time && traj.postCloseLowAfterTrough > 0 && traj.postCloseLowAfterTrough < afterTroughLow) {
          afterTroughLow = traj.postCloseLowAfterTrough;
        }
      }
      if (afterTroughLow <= 0) return false;

      const brokeTimeStartExtreme = postTroughPrice > preCloseMaxHigh;
      const effectiveBaseHigh = Math.max(preCloseMaxHigh, postTroughPrice);
      const peakAfterTroughPct = metricKind === 'CHG'
        ? (refOpen > 0 ? ((refOpen - afterTroughLow) / refOpen) * 100 : Infinity)
        : ((effectiveBaseHigh - afterTroughLow) / effectiveBaseHigh) * 100;

      // 情景2：做空对称——平仓后涨破之前时间起点最高点 -> 所有条件同步按新极值后走势判定
      if (brokeTimeStartExtreme) {
        return peakAfterTroughPct <= maxThreshold;
      }

      // 情景3a：平仓后反弹高点必须明确回到区间下限 minThreshold 以内（跌幅 < minThreshold）
      const troughValPct = metricKind === 'CHG'
        ? (refOpen > 0 ? ((refOpen - postTroughPrice) / refOpen) * 100 : Infinity)
        : ((preCloseMaxHigh - postTroughPrice) / preCloseMaxHigh) * 100;
      if (troughValPct >= minThreshold) return false;

      // 情景3b：反弹前波段最低点到平仓后反弹高点的反弹涨幅 >= minThreshold
      let preTroughLowPrice = Infinity;
      if (metricKind === 'CHG') {
        for (let i = 0; i < preCloseBars.length; i++) {
          if (preCloseBars[i].low > 0 && preCloseBars[i].low < preTroughLowPrice) preTroughLowPrice = preCloseBars[i].low;
        }
      } else {
        preTroughLowPrice = preCloseBars[preStartIdx].close;
        for (let i = preStartIdx + 1; i < preCloseBars.length; i++) {
          if (preCloseBars[i].low > 0 && preCloseBars[i].low < preTroughLowPrice) preTroughLowPrice = preCloseBars[i].low;
        }
      }
      const postEnd = troughIsLive ? postBars.length : postHighIdx;
      for (let i = 0; i < postEnd; i++) {
        if (postBars[i].low > 0 && postBars[i].low < preTroughLowPrice) preTroughLowPrice = postBars[i].low;
      }
      if (!troughIsLive && postHighIdx >= 0 && postBars[postHighIdx].open > 0 && postBars[postHighIdx].open < preTroughLowPrice) {
        preTroughLowPrice = postBars[postHighIdx].open;
      }
      if (!isFinite(preTroughLowPrice) || preTroughLowPrice <= 0) return false;
      const bounceBackPct = ((postTroughPrice - preTroughLowPrice) / preTroughLowPrice) * 100;
      if (bounceBackPct < minThreshold) return false;

      // 情景3c：自平仓后反弹高点起至今未再超上限
      return peakAfterTroughPct <= maxThreshold;
    }
  };

  let bars24h: Instant5mBar[] = [];
  let bars8am: Instant5mBar[] = [];
  if (bars5m && bars5m.length > 0) {
    bars24h = bars5m.filter(b => b.time >= cutoff24h);
    if (bars24h.length === 0) bars24h = bars5m.slice(-1);
    bars8am = bars5m.filter(b => b.time >= start8am);
    if (bars8am.length === 0) bars8am = bars5m.slice(-1);
  }

  // 验证四项趋势条件（若某带上限条件命中区间但尚缺 5m K线，标记 needs5mFetch 并暂不放行该条件）
  let matchedChg24 = instantOkChg24;
  if (instantOkChg24 && hasUpperChg24) {
    if (!bars5m) {
      needs5mFetch = true;
      matchedChg24 = false;
    } else {
      const refOpen24 = open24 > 0 ? open24 : (bars24h[0]?.open || 0);
      if (refOpen24 > 0) {
        let peak24 = isReopenMode ? 0 : traj.maxDirChg24;
        if (!isShortMode) {
          let maxHigh24 = Math.max(curPrice, high24Raw);
          for (let i = 0; i < bars24h.length; i++) {
            if (bars24h[i].high > maxHigh24) maxHigh24 = bars24h[i].high;
          }
          peak24 = Math.max(peak24, ((maxHigh24 - refOpen24) / refOpen24) * 100);
        } else {
          let minLow24 = Infinity;
          if (curPrice > 0) minLow24 = Math.min(minLow24, curPrice);
          if (low24Raw > 0) minLow24 = Math.min(minLow24, low24Raw);
          for (let i = 0; i < bars24h.length; i++) {
            if (bars24h[i].low > 0 && bars24h[i].low < minLow24) minLow24 = bars24h[i].low;
          }
          if (isFinite(minLow24) && minLow24 > 0) {
            peak24 = Math.max(peak24, ((refOpen24 - minLow24) / refOpen24) * 100);
          }
        }
        if (isReopenMode) {
          matchedChg24 = verifyReopenWindowRules(bars24h, 'CHG', minChg24, maxChg24, refOpen24, peak24, cutoff24h);
        } else if (peak24 > maxChg24) {
          matchedChg24 = false;
        }
      }
    }
  }

  let matchedChg8am = instantOkChg8am;
  if (instantOkChg8am && hasUpperChg8am) {
    const open8 = Number(v8?.openPrice || bars8am[0]?.open || (c8am !== null && curPrice > 0 && (1 + c8am / 100) > 0 ? curPrice / (1 + c8am / 100) : 0));
    if (!bars5m) {
      needs5mFetch = true;
      matchedChg8am = false;
    } else if (open8 > 0) {
      let peak8 = isReopenMode ? 0 : traj.maxDirChg8am;
      if (!isShortMode) {
        let maxHigh8 = Math.max(curPrice, high8Raw);
        for (let i = 0; i < bars8am.length; i++) {
          if (bars8am[i].high > maxHigh8) maxHigh8 = bars8am[i].high;
        }
        peak8 = Math.max(peak8, ((maxHigh8 - open8) / open8) * 100);
      } else {
        let minLow8 = Infinity;
        if (curPrice > 0) minLow8 = Math.min(minLow8, curPrice);
        if (low8Raw > 0) minLow8 = Math.min(minLow8, low8Raw);
        for (let i = 0; i < bars8am.length; i++) {
          if (bars8am[i].low > 0 && bars8am[i].low < minLow8) minLow8 = bars8am[i].low;
        }
        if (isFinite(minLow8) && minLow8 > 0) {
          peak8 = Math.max(peak8, ((open8 - minLow8) / open8) * 100);
        }
      }
      if (isReopenMode) {
        matchedChg8am = verifyReopenWindowRules(bars8am, 'CHG', minChg8am, maxChg8am, open8, peak8, start8am);
      } else if (peak8 > maxChg8am) {
        matchedChg8am = false;
      }
    }
  }

  let matchedBounce24 = instantOkBounce24;
  if (instantOkBounce24 && hasUpperBounce24) {
    if (!bars5m) {
      needs5mFetch = true;
      matchedBounce24 = false;
    } else {
      const peakB24 = computeChronologicalPeakBounce(bars24h, traj.maxBounce24, isReopenMode);
      if (peakB24 !== null) {
        if (isReopenMode) {
          matchedBounce24 = verifyReopenWindowRules(bars24h, 'BOUNCE', minBounce24, maxBounce24, 0, peakB24, cutoff24h);
        } else if (peakB24 > maxBounce24) {
          matchedBounce24 = false;
        }
      }
    }
  }

  let matchedBounce8am = instantOkBounce8am;
  if (instantOkBounce8am && hasUpperBounce8am) {
    if (!bars5m) {
      needs5mFetch = true;
      matchedBounce8am = false;
    } else {
      const peakB8 = computeChronologicalPeakBounce(bars8am, traj.maxBounce8am, isReopenMode);
      if (peakB8 !== null) {
        if (isReopenMode) {
          matchedBounce8am = verifyReopenWindowRules(bars8am, 'BOUNCE', minBounce8am, maxBounce8am, 0, peakB8, start8am);
        } else if (peakB8 > maxBounce8am) {
          matchedBounce8am = false;
        }
      }
    }
  }

  const trendResults: boolean[] = [];
  if (pushConfig?.enableChg24h) trendResults.push(matchedChg24);
  if (pushConfig?.enableChg8am) trendResults.push(matchedChg8am);
  if (pushConfig?.enableBounce24h) trendResults.push(matchedBounce24);
  if (pushConfig?.enableBounce8am) trendResults.push(matchedBounce8am);

  const volResults: boolean[] = [];
  if (pushConfig?.enableVol24h) volResults.push(vol24Ok);
  if (pushConfig?.enableVol8am) volResults.push(vol8amOk);

  let passed = false;
  if (requireTrendThreshold) {
    if (trendResults.length === 0) {
      passed = false;
    } else if (pushConfig?.mode === 'AND') {
      passed = trendResults.every(Boolean) && volResults.every(Boolean);
    } else {
      passed = trendResults.some(Boolean);
    }
  } else {
    const allResults = [...trendResults, ...volResults];
    if (allResults.length === 0) {
      passed = Boolean(pushConfig?.enableTopN);
    } else if (pushConfig?.mode === 'AND') {
      passed = allResults.every(Boolean);
    } else {
      passed = allResults.some(Boolean);
    }
  }

  // 若 OR 模式下已经确定通过（例如某无上限条件已命中），则无需等待额外 5m K线
  if (passed && pushConfig?.mode !== 'AND') {
    needs5mFetch = false;
  }

  return {
    passed,
    needs5mFetch,
    matchedTrend: {
      chg24: matchedChg24,
      chg8am: matchedChg8am,
      bounce24: matchedBounce24,
      bounce8am: matchedBounce8am,
    },
    matchedVol: {
      vol24: vol24Ok,
      vol8am: vol8amOk,
    },
    curPrice,
    v24,
    v8am,
    dirChg24,
    dirChg8am,
    b24,
    b8,
  };
};

// 🚀 Shared Helper: Filter List 1 candidates by List 2 push funnel rules (24H/8AM Chg, Vol, Bounce/Drop, OR/AND, TopN)
const filterCandidatesByPushConfigShared = (
  candidates: ScannerItem[],
  pushConfig: any,
  currentPricesMap: Record<string, number> = {},
  openDirection: 'LONG' | 'SHORT' = 'LONG',
  requireTrendThreshold: boolean = true,
  outNeeds5mSymbols?: string[],
  closedTimesMap?: Record<string, number>
): ScannerItem[] => {
  if (!pushConfig) return requireTrendThreshold ? [] : candidates;
  const isPushEffectivelyEnabled = Boolean(
    pushConfig.enabled || pushConfig.enableTopN || pushConfig.enableChg24h ||
    pushConfig.enableChg8am || pushConfig.enableVol24h || pushConfig.enableVol8am ||
    pushConfig.enableBounce8am || pushConfig.enableBounce24h
  );
  if (!isPushEffectivelyEnabled && !requireTrendThreshold) return candidates;

  // 🔒 核心铁律：当“立即开/平仓后续开”开启时，必须至少绑定一项有效的【① 趋势门槛过滤】涨跌幅条件（且下限阈值 > 0）
  const minChg24 = Math.abs(Number(pushConfig.minChg24h) || 0);
  const minChg8am = Math.abs(Number(pushConfig.minChg8am) || 0);
  const minBounce24 = Math.abs(Number(pushConfig.minBounce24h) || 0);
  const minBounce8am = Math.abs(Number(pushConfig.minBounce8am) || 0);

  const hasValidTrendRule = Boolean(
    (pushConfig.enableChg24h && minChg24 > 0) ||
    (pushConfig.enableChg8am && minChg8am > 0) ||
    (pushConfig.enableBounce24h && minBounce24 > 0) ||
    (pushConfig.enableBounce8am && minBounce8am > 0)
  );

  if (requireTrendThreshold && !hasValidTrendRule) {
    return [];
  }

  const rawMaps = buildRaw24hMaps();
  const nowTs = Date.now();
  const evalCache = new Map<string, List1CandidateEvalResult>();

  let filtered = candidates.filter(item => {
    const normSym = normalizeSymbol(item.symbol);
    const lastClosedTime = closedTimesMap ? (closedTimesMap[normSym] || 0) : 0;
    const res = evaluateList1PushCandidate(
      item,
      pushConfig,
      currentPricesMap,
      openDirection,
      requireTrendThreshold,
      rawMaps,
      nowTs,
      { updateTrajectory: true, lastClosedTime }
    );
    evalCache.set(item.symbol, res);
    if (res.needs5mFetch && outNeeds5mSymbols) {
      outNeeds5mSymbols.push(item.symbol);
    }
    return res.passed;
  });

  if (pushConfig.enableTopN && pushConfig.topNCount > 0) {
    const key = pushConfig.topNSortKey || 'CHG_8AM_ABS';
    const isShortMode = openDirection === 'SHORT';
    filtered.sort((a, b) => {
      const eA = evalCache.get(a.symbol);
      const eB = evalCache.get(b.symbol);
      const c24A = eA?.dirChg24 !== null && eA?.dirChg24 !== undefined ? (isShortMode ? -eA.dirChg24 : eA.dirChg24) : 0;
      const c24B = eB?.dirChg24 !== null && eB?.dirChg24 !== undefined ? (isShortMode ? -eB.dirChg24 : eB.dirChg24) : 0;
      const c8A = eA?.dirChg8am !== null && eA?.dirChg8am !== undefined ? (isShortMode ? -eA.dirChg8am : eA.dirChg8am) : 0;
      const c8B = eB?.dirChg8am !== null && eB?.dirChg8am !== undefined ? (isShortMode ? -eB.dirChg8am : eB.dirChg8am) : 0;
      const b8A = eA?.b8 ?? 0;
      const b8B = eB?.b8 ?? 0;
      const b24A = eA?.b24 ?? 0;
      const b24B = eB?.b24 ?? 0;
      if (key === 'VOL_24H') return (eB?.v24 ?? 0) - (eA?.v24 ?? 0);
      if (key === 'VOL_8AM') return (eB?.v8am ?? 0) - (eA?.v8am ?? 0);
      if (key === 'CHG_8AM_ABS') return Math.abs(c8B) - Math.abs(c8A);
      if (key === 'CHG_8AM_DESC') return c8B - c8A;
      if (key === 'CHG_8AM_ASC') return c8A - c8B;
      if (key === 'CHG_24H_DESC') return c24B - c24A;
      if (key === 'CHG_24H_ASC') return c24A - c24B;
      if (key === 'BOUNCE_8AM') return b8B - b8A;
      if (key === 'BOUNCE_24H') return b24B - b24A;
      return Math.abs(c24B) - Math.abs(c24A);
    });
    filtered = filtered.slice(0, pushConfig.topNCount);
  }

  return filtered;
};

interface List1MatchedCondition {
  category: 'TREND' | 'VOLUME' | 'UPSTREAM';
  label: string;
  actualText: string;
  ruleText: string;
}

interface List1InstantOpenSignalDetails {
  type: 'LIST1_INSTANT_OPEN';
  sourceLabel: string;
  direction: 'LONG' | 'SHORT';
  mode: 'AND' | 'OR';
  triggerPrice: number;
  conditions: List1MatchedCondition[];
  upstreamConditions?: List1MatchedCondition[];
  reason: string;
}

/**
 * 纯只读构造器：与 evaluateList1PushCandidate 保持 100% 一致的数据口径，
 * 仅记录真正通过了时序上限核验与趋势门槛的触发条件，用于交易日志记录与展示。
 */
const buildList1InstantOpenReason = (
  item: ScannerItem,
  scanConfig: ScanConfig | undefined,
  currentPricesMap: Record<string, number>,
  openDirection: 'LONG' | 'SHORT',
  options?: { isReopen?: boolean; strategyId?: string; resolvedPrice?: number; lastClosedTime?: number }
): { reason: string; signalDetails: List1InstantOpenSignalDetails } => {
  const isShort = openDirection === 'SHORT';
  const isReopen = Boolean(options?.isReopen);
  const stratTag = options?.strategyId ? ` (${options.strategyId})` : '';
  const sourceLabel = isReopen
    ? `列表1 · 平仓后续开${stratTag}`
    : `列表1 · 立即开${stratTag}`;
  const reasonPrefix = isReopen
    ? `[列表1·平仓后续开${stratTag ? `·${options?.strategyId}` : ''}]`
    : `[列表1·立即开${stratTag ? `·${options?.strategyId}` : ''}]`;

  const pCfg = scanConfig?.list2PushConfig;
  const mode: 'AND' | 'OR' = pCfg?.mode === 'AND' ? 'AND' : 'OR';
  const rawMaps = buildRaw24hMaps();
  const evalRes = evaluateList1PushCandidate(
    item,
    pCfg,
    currentPricesMap,
    openDirection,
    true,
    rawMaps,
    Date.now(),
    { updateTrajectory: false, resolvedPriceOverride: options?.resolvedPrice, lastClosedTime: options?.lastClosedTime }
  );

  const curPrice = evalRes.curPrice;
  const dirChg24 = evalRes.dirChg24;
  const dirChg8am = evalRes.dirChg8am;
  const b24Val = evalRes.b24;
  const b8Val = evalRes.b8;
  const v24 = evalRes.v24;
  const v8am = evalRes.v8am;

  const min24 = Math.abs(Number(pCfg?.minChg24h) || 0);
  const max24 = Math.abs(Number(pCfg?.maxChg24h) || 0);
  const min8 = Math.abs(Number(pCfg?.minChg8am) || 0);
  const max8 = Math.abs(Number(pCfg?.maxChg8am) || 0);
  const minB24 = Math.abs(Number(pCfg?.minBounce24h) || 0);
  const maxB24 = Math.abs(Number(pCfg?.maxBounce24h) || 0);
  const minB8 = Math.abs(Number(pCfg?.minBounce8am) || 0);
  const maxB8 = Math.abs(Number(pCfg?.maxBounce8am) || 0);
  const minVol24 = Number(pCfg?.minVol24h) || 0;
  const minVol8am = Number(pCfg?.minVol8am) || 0;

  const formatRange = (minVal: number, maxVal: number) =>
    maxVal > 0 && maxVal >= minVal ? `${minVal}%~${maxVal}%` : `${minVal}%~不封顶`;

  const formatSignedPct = (val: number) => `${isShort ? '-' : '+'}${Math.abs(val).toFixed(1)}%`;

  const conditions: List1MatchedCondition[] = [];

  if (evalRes.matchedTrend.chg24 && dirChg24 !== null) {
    conditions.push({
      category: 'TREND',
      label: isShort ? '24H跌幅' : '24H涨幅',
      actualText: formatSignedPct(dirChg24),
      ruleText: formatRange(min24, max24),
    });
  }

  if (evalRes.matchedTrend.chg8am && dirChg8am !== null) {
    conditions.push({
      category: 'TREND',
      label: isShort ? '8AM跌幅' : '8AM涨幅',
      actualText: formatSignedPct(dirChg8am),
      ruleText: formatRange(min8, max8),
    });
  }

  if (evalRes.matchedTrend.bounce24 && b24Val !== null) {
    conditions.push({
      category: 'TREND',
      label: isShort ? '24H高点跌' : '24H低点涨',
      actualText: formatSignedPct(b24Val),
      ruleText: formatRange(minB24, maxB24),
    });
  }

  if (evalRes.matchedTrend.bounce8am && b8Val !== null) {
    conditions.push({
      category: 'TREND',
      label: isShort ? '8AM高点跌' : '8AM低点涨',
      actualText: formatSignedPct(b8Val),
      ruleText: formatRange(minB8, maxB8),
    });
  }

  if (evalRes.matchedVol.vol24) {
    conditions.push({
      category: 'VOLUME',
      label: '24H成交额',
      actualText: `${v24.toFixed(1)}M`,
      ruleText: `≥${minVol24}M`,
    });
  }

  if (evalRes.matchedVol.vol8am) {
    conditions.push({
      category: 'VOLUME',
      label: '8AM成交额',
      actualText: `${v8am.toFixed(1)}M`,
      ruleText: `≥${minVol8am}M`,
    });
  }

  // 上游列表1过滤条件摘要（大趋势模式横盘蓄势 / 回溯周期，仅只读记录配置上下文）
  const upstreamConditions: List1MatchedCondition[] = [];
  const mt = scanConfig?.majorTrend;
  if (mt?.enabled) {
    if (mt.enableSideways) {
      const activeGroups = (Array.isArray(mt.sidewaysGroups) ? mt.sidewaysGroups : []).filter(g => g && g.enabled !== false);
      const daysSummary = activeGroups.length > 0
        ? activeGroups.map(g => `${isShort ? (g.daysShort ?? g.days) : (g.daysLong ?? g.days)}天`).join('/')
        : `${mt.sidewaysDays || 7}天`;
      upstreamConditions.push({
        category: 'UPSTREAM',
        label: '横盘蓄势',
        actualText: daysSummary,
        ruleText: mt.sidewaysLogic === 'AND' ? '多组全满足' : '横盘过滤通过',
      });
    }
    const lbDays = mt.filterTimeParam || mt.lookbackDays;
    if (lbDays && lbDays > 0) {
      const distLimit = isShort
        ? (mt.maxExtremeDistanceShort ?? mt.maxExtremeDistance)
        : (mt.maxExtremeDistanceLong ?? mt.maxExtremeDistance);
      upstreamConditions.push({
        category: 'UPSTREAM',
        label: isShort ? '回溯周期高点回落' : '回溯周期低点反弹',
        actualText: `${lbDays}天周期`,
        ruleText: distLimit !== undefined ? `距极值≤${distLimit}%` : '回溯过滤通过',
      });
    }
  }

  const condText = conditions
    .map(c => `${c.label} ${c.actualText}（设定 ${c.ruleText}）`)
    .join(' ｜ ');

  const upstreamText =
    upstreamConditions.length > 0
      ? ` ｜ 上游: ${upstreamConditions.map(u => `${u.label}(${u.actualText})`).join(' / ')}`
      : '';

  const reason = condText
    ? `${reasonPrefix} ${condText}${upstreamText}`
    : `${reasonPrefix} 趋势门槛达成${upstreamText}`;

  const signalDetails: List1InstantOpenSignalDetails = {
    type: 'LIST1_INSTANT_OPEN',
    sourceLabel,
    direction: openDirection,
    mode,
    triggerPrice: curPrice,
    conditions,
    upstreamConditions: upstreamConditions.length > 0 ? upstreamConditions : undefined,
    reason,
  };

  return { reason, signalDetails };
};

interface Props {
  networkStatus?: "healthy" | "delayed" | "disconnected";
  isOnline?: boolean;
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
  onAddTradeLog?: (log: TradeLog) => void;
  tradeLogs?: TradeLog[];
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
  isOnline = true,
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
  onAddTradeLog,
  tradeLogs = [],
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
  const [showLogPanel, setShowLogPanel] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [chartData, setChartData] = useState<any>(null);
  const [scannerMode, setScannerMode] = usePersistedState<
    "LIVE" | "BACKTEST" | "SMART"
  >("SCANNER_GLOBAL_MODE", "LIVE");
  const [actionConfig, setActionConfig] = useState<ActionConfig | null>(() => {
    try {
      const activeId = localStorage.getItem("SCANNER_SELECTED_STRATEGY_ID")
        ? JSON.parse(localStorage.getItem("SCANNER_SELECTED_STRATEGY_ID") as string)
        : "strat-1";
      const raw = localStorage.getItem(`SCANNER_ACTION_CONFIG_${activeId}`) || localStorage.getItem("SCANNER_ACTION_CONFIG");
      if (raw) {
        return JSON.parse(raw);
      }
    } catch {}
    return null;
  });

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
        setTimeout(() => {
          onBacktestPositionsUpdate(backtestPositions);
        }, 0);
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

  // --- AUTOMATIC STRATEGY ROTATION STATES ---
  const [isRotationEnabled, setIsRotationEnabled] = usePersistedState<boolean>(
    "SCANNER_ROTATION_ENABLED",
    false
  );
  const [rotationIntervalMinutes, setRotationIntervalMinutes] = usePersistedState<number>(
    "SCANNER_ROTATION_INTERVAL",
    5
  );
  const [rotationActiveStrategyId, setRotationActiveStrategyId] = usePersistedState<string>(
    "SCANNER_ROTATION_ACTIVE_STRATEGY_ID",
    "strat-1"
  );
  const [rotationTimeLeft, setRotationTimeLeft] = useState<number>(5 * 60);

  // --- RIGHT-CLICK CONTEXT MENU & QUICK TRADE STATES ---
  const [contextMenuState, setContextMenuState] = useState<CoinContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    symbol: '',
  });

  const [quickTradeState, setQuickTradeState] = useState<{
    isOpen: boolean;
    symbol: string;
    initialDirection?: 'LONG' | 'SHORT';
    initialPrice?: number;
  }>({
    isOpen: false,
    symbol: '',
  });

  const strategiesRef = useRef(strategies);
  strategiesRef.current = strategies;
  const rotationActiveStrategyIdRef = useRef(rotationActiveStrategyId);
  rotationActiveStrategyIdRef.current = rotationActiveStrategyId;
  const rotationIntervalMinutesRef = useRef(rotationIntervalMinutes);
  rotationIntervalMinutesRef.current = rotationIntervalMinutes;
  const onLogRef = useRef(onLog);
  onLogRef.current = onLog;

  const handleSelectStrategyRef = useRef<((id: string) => void) | null>(null);

  // --- AUTOMATIC STRATEGY ROTATION TIMER ---
  useEffect(() => {
    if (!isRotationEnabled) {
      setRotationTimeLeft(prev => prev === 0 ? prev : 0);
      return;
    }

    const initialTime = rotationIntervalMinutesRef.current * 60;
    setRotationTimeLeft(prev => prev === initialTime ? prev : initialTime);

    const intervalId = setInterval(() => {
      setRotationTimeLeft((prev) => {
        if (prev <= 1) {
          // Time's up! Trigger rotation to next active strategy (include all configured strategies)
          const activeStrats = strategiesRef.current.filter(s => !s.unconfigured);
          if (activeStrats.length > 0) {
            const currentId = rotationActiveStrategyIdRef.current;
            const currentIndex = activeStrats.findIndex(s => s.id === currentId);
            const nextIndex = (currentIndex === -1 || currentIndex === activeStrats.length - 1) ? 0 : currentIndex + 1;
            const nextStrat = activeStrats[nextIndex];

            // Defer rotation update outside state reducer loop
            setTimeout(() => {
              setRotationActiveStrategyId(prevId => prevId === nextStrat.id ? prevId : nextStrat.id);
              handleSelectStrategyRef.current?.(nextStrat.id);
              if (onLogRef.current) {
                onLogRef.current("INFO", `[策略轮循] 当前前台界面与后台巡检策略同步聚焦为: "${nextStrat.name}"，所有已开启策略保持全速并发监控中。`);
              }
            }, 0);
          }
          return rotationIntervalMinutesRef.current * 60;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(intervalId);
  }, [isRotationEnabled, setRotationActiveStrategyId]);

  // Keep rotationActiveStrategyId valid
  useEffect(() => {
    if (!isRotationEnabled) return;
    const activeStrats = strategiesRef.current.filter(s => !s.unconfigured);
    if (activeStrats.length > 0) {
      const exists = activeStrats.some(s => s.id === rotationActiveStrategyId);
      if (!exists && activeStrats[0]) {
        setRotationActiveStrategyId(activeStrats[0].id);
        setRotationTimeLeft(rotationIntervalMinutes * 60);
      }
    }
  }, [isRotationEnabled, rotationActiveStrategyId, rotationIntervalMinutes, setRotationActiveStrategyId]);

  const handleSelectStrategy = useCallback((id: string) => {
    setSelectedStrategyId(id);
    const cachedList1 = loadState<ScannerItem[]>(`SCANNER_LIST1_${id}`, []);
    setList1Candidates(cachedList1);
    setList1InstantCandidates(cachedList1);
    setList2Results(loadState<ScannerItem[]>(`SCANNER_LIST2_${id}`, []));
    setList3Results(loadState<ScannerItem[]>(`SCANNER_LIST3_${id}`, []));
  }, [setSelectedStrategyId]);

  handleSelectStrategyRef.current = handleSelectStrategy;

  const handleAddStrategy = useCallback(() => {
    const nextNum = (strategiesRef.current?.length || 0) + 1;
    const newId = `strat-${Date.now()}`;
    const newStrategy: StrategyItem = {
      id: newId,
      name: `自动选币 ${nextNum}`,
      active: true,
      unconfigured: true,
    };
    setStrategies((prev) => [...prev, newStrategy]);
    handleSelectStrategy(newId);
    if (onLogRef.current) {
      onLogRef.current("INFO", `[新增策略] 成功创建「自动选币 ${nextNum}」并已自动切换至该策略。`);
    }
  }, [handleSelectStrategy, setStrategies]);

  const handleActivateStrategy = useCallback(() => {
    setStrategies((prev) =>
      prev.map((s) => (s.id === selectedStrategyId ? { ...s, unconfigured: false } : s))
    );
    if (onLog) onLog("SUCCESS", `[策略激活] 策略已成功激活并载入标准默认参数。`);
  }, [selectedStrategyId, setStrategies, onLog]);

  const handleDeleteStrategy = useCallback((id: string) => {
    const currentStrats = strategiesRef.current || [];
    if (currentStrats.length <= 1) {
      if (onLogRef.current) {
        onLogRef.current("WARNING", `[删除策略] 系统至少需保留一个选币策略，无法全部删除。`);
      }
      return;
    }

    // Synchronously clean up deleted strategy lists and configs from disk
    localStorage.removeItem(`SCANNER_LIST1_${id}`);
    localStorage.removeItem(`SCANNER_LIST2_${id}`);
    localStorage.removeItem(`SCANNER_LIST3_${id}`);
    localStorage.removeItem(`SCANNER_LIST3_CONFIG_${id}`);
    localStorage.removeItem(`SCANNER_LIST4_CONFIG_${id}`);
    localStorage.removeItem(`SCANNER_ACTION_CONFIG_${id}`);
    localStorage.removeItem(`SCANNER_CONFIG_24H_${id}`);
    localStorage.removeItem(`SCANNER_CONFIG_8AM_${id}`);

    const filtered = currentStrats.filter((s) => s.id !== id);
    setStrategies(filtered);

    if (selectedStrategyId === id && filtered.length > 0) {
      const nextId = filtered[0].id;
      handleSelectStrategy(nextId);
    }

    const deletedStrat = currentStrats.find((s) => s.id === id);
    if (onLogRef.current) {
      onLogRef.current("INFO", `[删除策略] 策略「${deletedStrat ? deletedStrat.name : id}」已成功删除并释放配置。`);
    }
  }, [selectedStrategyId, handleSelectStrategy, setStrategies]);

  const handleRenameStrategy = useCallback((id: string, name: string) => {
    setStrategies((prev) =>
      prev.map((s) => (s.id === id ? { ...s, name } : s))
    );
  }, [setStrategies]);

  const handleExportStrategy = useCallback((id: string, customName?: string) => {
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
      customFileName: customName || undefined,
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
    
    let downloadFileName = '';
    if (customName && customName.trim()) {
      const cleanName = customName.trim();
      downloadFileName = cleanName.toLowerCase().endsWith('.json') ? cleanName : `${cleanName}.json`;
    } else {
      downloadFileName = `Strategy_${name.replace(/\s+/g, "_")}_Config.json`;
    }
    
    a.download = downloadFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (onLog) onLog("SUCCESS", `[策略导出] 导出策略 "${downloadFileName}" 成功。`);
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
        
        // Track price history with zero-allocation ring buffer
        if (!priceHistoryRef.current) priceHistoryRef.current = {};
        
        const limit = now - (config.triggerMinutes || 15) * 60 * 1000;
        for (const symbol in currentPrices) {
          const price = currentPrices[symbol];
          if (!price || isNaN(price)) continue;
          
          if (!priceHistoryRef.current[symbol]) priceHistoryRef.current[symbol] = [];
          const hist = priceHistoryRef.current[symbol];
          hist.push({ price, time: now });
          
          // Hard ring-buffer cap (max 40 ticks)
          if (hist.length > 40) {
            hist.shift();
          }
          // In-place window pruning
          while (hist.length > 0 && hist[0].time <= limit) {
            hist.shift();
          }
        }

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
      limit: 2000,
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
        startTrendGroups: [
          { enabled: false, days: 1, minLong: 1, maxLong: 5, maxPullbackLong: 2, minShort: 1, maxShort: 5, maxPullbackShort: 2 },
          { enabled: false, days: 2, minLong: 1, maxLong: 5, maxPullbackLong: 2, minShort: 1, maxShort: 5, maxPullbackShort: 2 },
          { enabled: false, days: 3, minLong: 2, maxLong: 10, maxPullbackLong: 4, minShort: 2, maxShort: 10, maxPullbackShort: 4 },
          { enabled: false, days: 7, minLong: 4, maxLong: 20, maxPullbackLong: 6, minShort: 4, maxShort: 20, maxPullbackShort: 6 }
        ]
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
      limit: 2000,
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
        startTrendGroups: [
          { enabled: false, days: 1, minLong: 1, maxLong: 5, maxPullbackLong: 2, minShort: 1, maxShort: 5, maxPullbackShort: 2 },
          { enabled: false, days: 2, minLong: 1, maxLong: 5, maxPullbackLong: 2, minShort: 1, maxShort: 5, maxPullbackShort: 2 },
          { enabled: false, days: 3, minLong: 2, maxLong: 10, maxPullbackLong: 4, minShort: 2, maxShort: 10, maxPullbackShort: 4 },
          { enabled: false, days: 7, minLong: 4, maxLong: 20, maxPullbackLong: 6, minShort: 4, maxShort: 20, maxPullbackShort: 6 }
        ]
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
  // 🔒 [DATA INTEGRITY]: 严格由实时扫描流驱动，严禁启动时盲读历史残留列表
  const [list1Candidates, setList1Candidates] = useState<ScannerItem[]>([]);
  const [list1InstantCandidates, setList1InstantCandidates] = useState<ScannerItem[]>([]);
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

  const handleList1InstantResults = useCallback((results: ScannerItem[]) => {
    setList1InstantCandidates(prev => {
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

  const handleList3ConfigUpdate = useCallback((newConfig: List3Config | null) => {
    setList3Config(prev => {
      if (JSON.stringify(prev) === JSON.stringify(newConfig)) return prev;
      return newConfig;
    });
  }, []);

  const handleActionConfigUpdate = useCallback((newConfig: ActionConfig | null) => {
    setActionConfig(prev => {
      if (JSON.stringify(prev) === JSON.stringify(newConfig)) return prev;
      return newConfig;
    });
  }, []);

  // 🔒 同步持久化前台策略专属初筛与审计列表数据，确保策略切换时无缝还原（防抖异步写入避免大列表阻塞主线程）
  useEffect(() => {
    if (list1Candidates.length > 0 && selectedStrategyId) {
      saveStateDebounced(`SCANNER_LIST1_${selectedStrategyId}`, list1Candidates, 2000);
    }
  }, [list1Candidates, selectedStrategyId]);

  useEffect(() => {
    if (list2Results.length > 0 && selectedStrategyId) {
      saveStateDebounced(`SCANNER_LIST2_${selectedStrategyId}`, list2Results, 2000);
    }
  }, [list2Results, selectedStrategyId]);

  useEffect(() => {
    if (list3Results.length > 0 && selectedStrategyId) {
      saveStateDebounced(`SCANNER_LIST3_${selectedStrategyId}`, list3Results, 2000);
    }
  }, [list3Results, selectedStrategyId]);

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
    const pulse = `${newStats?.symbolCount || 0}-${(newStats?.totalPnl ?? 0).toFixed(4)}`;
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

  const handleRemoveSignalReady = useCallback((fn: (uniqueId: string) => void) => {
    removeSignalRef.current = fn;
  }, []);

  const handleRemoveSignal = (id: string) => {
    removeSignalRef.current?.(id);
    list2RemoveSignalRef.current?.(id);
  };

  // --- SWITCH DATA SOURCES BASED ON MODE ---
  const currentPrices =
    scannerMode === "BACKTEST" ? backtestPrices : livePrices; // Mirrored modules use BacktestContext for prices
  const currentPositions =
    scannerMode === "BACKTEST" ? backtestPositions : livePositions;

  useEffect(() => {
    const unsubscribe = eventBus.subscribe('OPEN_COIN_CONTEXT_MENU', (payload: any) => {
      if (!payload || !payload.symbol) return;
      setContextMenuState({
        visible: true,
        x: payload.x || 0,
        y: payload.y || 0,
        symbol: payload.symbol,
        chineseName: payload.chineseName,
        currentPrice: payload.currentPrice || currentPricesRef.current[payload.symbol] || 0,
        direction: payload.direction || 'LONG',
      });
    });
    return () => {
      unsubscribe();
    };
  }, []);

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

  // Clear transient lists synchronously in handleSelectStrategy and handleDeleteStrategy
  // to avoid parent-child render timing race conditions on selectedStrategyId changes.

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
  // 🔒 [调度执行器防并发重复开仓在途保护表]
  const inFlightTradeSymbolsRef = useRef<Map<string, number>>(new Map());
  // 🔒 [一键清仓/手动平仓防自动复开硬锁黑名单]
  const panicSoldSymbolsRef = useRef<Set<string>>(new Set());
  // 🔒 [一键清仓/手动平仓 30 分钟持久化冷却锁 (存入 localStorage 防刷新复开)]
  const panicCooldownMapRef = useRef<Map<string, number>>(getInitialCooldownMap());

  const setSymbolCooldown = useCallback((symbol: string) => {
    const normSym = normalizeSymbol(symbol);
    const expireAt = Date.now() + COOLDOWN_DURATION_MS;
    panicCooldownMapRef.current.set(normSym, expireAt);
    panicSoldSymbolsRef.current.add(normSym);
    try {
      const obj: Record<string, number> = {};
      panicCooldownMapRef.current.forEach((val, key) => {
        if (val > Date.now()) obj[key] = val;
      });
      localStorage.setItem(PANIC_COOLDOWN_STORAGE_KEY, JSON.stringify(obj));
    } catch {}
  }, []);

  const lockAndPurgeClosedSymbols = useCallback((symbols: string[]) => {
    if (!symbols || symbols.length === 0) return;

    const closedSet = new Set(symbols.map(s => normalizeSymbol(s)));

    symbols.forEach((sym) => {
      const cleanSym = normalizeSymbol(sym);
      // 1. 设置 30 分钟 Panic Cooldown 护城河
      setSymbolCooldown(cleanSym);
      // 2. 解绑行情订阅
      l234DataStore.unregisterSymbol(cleanSym);
      // 3. 彻底打标记并作废 List 4 本地存储中的 TRIGGERED 结果
      markList4SignalConsumedInStorage(cleanSym, normalizeSymbol);
      // 4. 将结构粒度锁持久化写入 EXPIRED_SIGNAL_CACHE
      ['1m', '5m', '15m', '1h', '4h'].forEach((tf) => {
        ['LONG', 'SHORT'].forEach((dir) => {
          const sKey = getStructureLockKey(cleanSym, tf, dir);
          persistExpiredSignalKey(sKey);
        });
      });
    });

    // 5. 【防 React 内存态覆盖 localStorage】同步更新当前组件内存中的 List 3 候选/状态数组
    setList3Results(prev => prev.map(item => {
      if (closedSet.has(normalizeSymbol(item.symbol))) {
        return {
          ...item,
          _consumed: true,
          momentum: {
            ...(item.momentum || { midPoint: 0, entryTrigger: 0, purityValid: false, breakoutValid: false }),
            status: 'CONSUMED'
          }
        };
      }
      return item;
    }));
  }, [setSymbolCooldown]);

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
        openAmount: 10,
        leverage: 20,
        maxOpenSymbols: 200,
        maxTotalValue: 100000,
        breakoutBuffer: 0.2,
        autoExecute: true,
        maxExposurePercent: 95,
        minHealthPercent: 0,
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

      const targetStratId = (extraProps as any)?.strategyId || selectedStrategyId || 'strat-1';
      const userConfig = ((extraProps as any)?.customActionConfig ||
        actionConfigRef.current ||
        (() => {
          try {
            const raw = localStorage.getItem(`SCANNER_ACTION_CONFIG_${targetStratId}`) || localStorage.getItem("SCANNER_ACTION_CONFIG");
            if (raw) return JSON.parse(raw);
          } catch {}
          return {};
        })()) as Partial<ActionConfig>;
      const config: ActionConfig = {
        enabled:
          typeof userConfig.enabled === "boolean"
            ? userConfig.enabled
            : DEFAULT_ACTION_CONFIG.enabled,
        openAmount:
          typeof userConfig.openAmount === "number" && userConfig.openAmount > 0
            ? userConfig.openAmount
            : DEFAULT_ACTION_CONFIG.openAmount,
        leverage:
          typeof userConfig.leverage === "number" && userConfig.leverage > 0
            ? userConfig.leverage
            : (DEFAULT_ACTION_CONFIG.leverage || 20),
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
        minHealthPercent:
          typeof userConfig.minHealthPercent === "number"
            ? userConfig.minHealthPercent
            : DEFAULT_ACTION_CONFIG.minHealthPercent,
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

      const isManual = reason?.includes("Manual") || reason?.includes("MANUAL") || reason?.includes("手动") || reason?.includes("快速开仓") || Boolean((extraProps as any)?.isManual);
      const isList4 = reason.includes("列表4");
      const isAuto = (reason.includes("Auto") || isList4) && !reason.includes("List1 Auto");
      if (!config.enabled && !isManual && !isList4) {
        if (onLog)
          onLog(
            "WARNING",
            `交易拦截 (${cleanSymbol}): 战术面板总开关 (List 6) 未开启。`,
          );
        console.warn(`[Trade Reject] Master switch is OFF for ${cleanSymbol}`);
        return false;
      }

      if (isAuto && !isList4 && !config.autoExecute) {
        if (onLog)
          onLog(
            "WARNING",
            `自动开仓被拦截 (${cleanSymbol}): 列表 6 中的 "自动策略开仓" 开关未开启。`,
          );
        console.warn(`[Trade Reject] Auto-execute is OFF for ${cleanSymbol}`);
        return false;
      }
      
      console.log(`[Trade Attempt] ${cleanSymbol} @ ${price} (Reason: ${reason})`);

      // 降级兜底：若内存 Map 中未查到，尝试从 localStorage 恢复
      if (!panicCooldownMapRef.current.has(cleanSymbol)) {
        try {
          const raw = localStorage.getItem(PANIC_COOLDOWN_STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            const nowMs = Date.now();
            Object.entries(parsed).forEach(([k, expireAt]) => {
              if (typeof expireAt === 'number' && expireAt > nowMs) {
                panicCooldownMapRef.current.set(k, expireAt);
              }
            });
          }
        } catch {}
      }

      // 🛡️ [一键清仓/手动平仓 30 分钟持久化护城河门禁]
      const cooldownExpireAt = panicCooldownMapRef.current.get(cleanSymbol);
      const now = Date.now();

      if (!isManual && !(extraProps as any)?.isReopened) {
        if (cooldownExpireAt && cooldownExpireAt > now) {
          const remainingMin = Math.ceil((cooldownExpireAt - now) / 60000);
          if (onLog) {
            onLog(
              "WARNING",
              `🛡️ [一键清仓护城河拦截] ${cleanSymbol} 处于平仓冷却期中 (剩余约 ${remainingMin} 分钟)，自动策略禁止再次开仓！`
            );
          }
          console.warn(`[Trade Reject] Cooldown symbol blocked: ${cleanSymbol}`);
          return false;
        }
      }

      // 若为手动主动开仓，或冷却已过期，安全解除锁定
      if (isManual || (cooldownExpireAt && cooldownExpireAt <= now)) {
        panicCooldownMapRef.current.delete(cleanSymbol);
        try {
          const obj: Record<string, number> = {};
          panicCooldownMapRef.current.forEach((val, key) => {
            if (val > Date.now()) obj[key] = val;
          });
          localStorage.setItem(PANIC_COOLDOWN_STORAGE_KEY, JSON.stringify(obj));
        } catch (_) {}
      }

      const activePositions =
        scannerMode === "BACKTEST"
          ? backtestPositionsRef.current
          : livePositionsRef.current;

      // 🛡️ [Anti-Double Open Safety Check] (自动策略生效，手动开仓与复开允许透传)
      const existingPos = activePositions.find(p => normalizeSymbol(p.symbol) === cleanSymbol);
      if (existingPos && !isManual && !(extraProps as any)?.isReopened) {
        if (onLog) {
          onLog(
            "WARNING",
            `🛡️ [防重复开仓拦截] ${cleanSymbol} 已经存在持仓 (${existingPos.side}，数量 ${existingPos.amount.toFixed(4)})，拦截本次自动开仓。`
          );
        }
        console.warn(`[Trade Reject] Duplicate open blocked: ${cleanSymbol} already has an active position.`);
        return false;
      }

      // 🛡️ [在途并发与长效防重锁：防止多周期同时突破或手动防连击]
      const lastInFlightTime = inFlightTradeSymbolsRef.current.get(cleanSymbol) || 0;
      const minInFlightMs = isManual ? 3000 : 120000;
      if (Date.now() - lastInFlightTime < minInFlightMs && !(extraProps as any)?.isReopened) {
        if (onLog) {
          onLog(
            "WARNING",
            `🛡️ [防并发重复开仓拦截] ${cleanSymbol} 在 ${((Date.now() - lastInFlightTime)/1000).toFixed(1)}s 前已触发过开仓，在途锁保护中 (${isManual ? '手动防连击3s' : '自动120s'})，拒绝重复执行。`
          );
        }
        console.warn(`[Trade Reject] Concurrency duplicate open blocked: ${cleanSymbol} triggered ${Date.now() - lastInFlightTime}ms ago.`);
        return false;
      }

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
        !isManual &&
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
        (extraProps as any)?.customAmount && (extraProps as any).customAmount > 0
          ? (extraProps as any).customAmount
          : (config.positionSizeMode === "VARIABLE"
            ? Math.min(
                balance * (config.variablePercentage / 100),
                config.variableMaxLimit || Infinity,
              )
            : (typeof config.openAmount === "number" && config.openAmount > 0 ? config.openAmount : 10));

      // List 6: Total Capital Limit Check (仅对自动策略校验，手动开仓放行)
      const currentTotalValue = activePositions.reduce((sum, p) => {
        const pPrice =
          currentPricesRef.current[normalizeSymbol(p.symbol)] ||
          p.markPrice ||
          p.entryPrice;
        return sum + p.amount * (pPrice || 0);
      }, 0);

      // Breaker Guard
      if (!isManual && side === PositionSide.SHORT && config.breakerConfig?.enabled && isBreakerActive) {
          if (onLog) onLog("DANGER", `交易拦截 (${cleanSymbol}): 触发防恐慌机制，禁止开空。`);
          return false;
      }

      if (
        !isManual &&
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
      if (!isManual && usagePct > exposureLimit) {
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

      // Check Health % (List 6 Health Limit: 当健康度低于 minHealthPercent 时不开仓)
      if (!isManual && typeof config.minHealthPercent === "number" && config.minHealthPercent > 0) {
        const CONTRACT_LEVERAGE = 20;
        const currentTotalPnL = activePositions.reduce((sum, p) => sum + (p.unrealizedPnL || 0), 0);
        const availableMarginWithLeverage = Math.max(0, (balance + currentTotalPnL) - (currentTotalValue / CONTRACT_LEVERAGE));
        const currentHealthPct = balance > 0 ? (availableMarginWithLeverage / balance * 100) : 0;

        if (currentHealthPct < config.minHealthPercent) {
          if (onLog) {
            onLog(
              "DANGER",
              `交易拦截 ${cleanSymbol}: 账户健康度低于设定阈值 (${currentHealthPct.toFixed(1)}% < ${config.minHealthPercent}%)`,
            );
          }
          console.warn(
            `[Trade Reject] Health limit reached: ${currentHealthPct.toFixed(1)}% < ${config.minHealthPercent}%`,
          );
          return false;
        }
      }

      const mergedExtraProps = {
        strategyId: selectedStrategyId,
        isManual: isManual,
        reason: reason,
        triggerReason: reason,
        leverage: (extraProps as any)?.leverage || config.leverage || 20,
        ...extraProps,
      };

      inFlightTradeSymbolsRef.current.set(cleanSymbol, Date.now());

      if (scannerMode === "BACKTEST") {
        const qty = amount / price;
        const entryId = Date.now().toString() + '_' + Math.random().toString(36).substring(2, 9);
        const tradeTime = virtualTimeRef.current || Date.now();
        const newPos: Position = {
          symbol: cleanSymbol,
          side,
          amount: qty,
          entryPrice: price,
          markPrice: price,
          unrealizedPnL: 0,
          unrealizedPnLPercentage: 0,
          entryTime: tradeTime,
          isHedged: false,
          liquidationPrice: side === "LONG" ? price * 0.95 : price * 1.05,
          entryId,
          isBacktestRecord: true,
          backtestEntryTime: tradeTime,
          strategyId: selectedStrategyId,
        };
        setPositions((prev) => [...prev, newPos]);

        if (onAddTradeLog) {
          const backtestSignalDetails = (extraProps as any)?.signalDetails || (reason ? { reason } : undefined);
          onAddTradeLog({
            symbol: cleanSymbol,
            entry_id: entryId,
            status: 'OPEN',
            is_hedge: false,
            entry_timestamp: tradeTime,
            direction: side,
            cost_usdt: amount,
            entry_price: price,
            timeframe: signalTf || '5m',
            exit_reason: reason || '回测策略开仓',
            signal_details: backtestSignalDetails,
            events: [{
              timestamp: tradeTime,
              action: '回测开仓成交',
              price: price,
              amount: qty,
              reason: reason || '回测策略开仓'
            }]
          });
        }

        if (onLog)
          onLog(
            "SUCCESS",
            `[回测] 开仓成功: ${cleanSymbol} ${side} @ ${price} (数量: ${qty.toFixed(4)})`,
          );
        return true;
      } else {
        logSignalOccurrence({
          source: isManual ? 'MANUAL' : 'AUTO_STRATEGY',
          strategyName: (mergedExtraProps as any)?.strategyName || selectedStrategyId || '选币扫描策略',
          actionType: 'OPEN',
          symbol: cleanSymbol,
          side: side,
          price: price,
          amountUsdt: amount,
          reason: reason || '策略满足开仓条件'
        });
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

  // --- LIST 1 INSTANT OPEN & REOPEN AUTOMATION ---
  const initialClosedTimes = useMemo(() => getInitialList1ClosedTimes(), []);
  const list1OpenedSymbolsRef = useRef<Set<string>>(getInitialList1OpenedSet());
  const list1ClosedSymbolsRef = useRef<Set<string>>(new Set(Object.keys(initialClosedTimes)));
  const list1LastTriggerTimeRef = useRef<Record<string, number>>({});
  const prevPositionsRef = useRef<Position[]>([]);
  const list1ClosedTimeRef = useRef<Record<string, number>>(initialClosedTimes);

  // 监听来自 App.tsx (如持仓面板/顶部栏一键清仓或单笔平仓) 的全局清仓同步事件
  useEffect(() => {
    const handleGlobalPositionsCleared = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const syms: string[] = Array.isArray(detail?.symbols) ? detail.symbols : [];
      const now = Date.now();
      if (syms.length > 0) {
        syms.forEach(s => {
          const cleanSym = normalizeSymbol(s);
          list1OpenedSymbolsRef.current.add(cleanSym);
          list1ClosedSymbolsRef.current.add(cleanSym);
          list1ClosedTimeRef.current[cleanSym] = now;
        });
        persistList1OpenedSet(list1OpenedSymbolsRef.current);
        persistList1ClosedTimes(list1ClosedTimeRef.current);
        lockAndPurgeClosedSymbols(syms);
      }
    };
    window.addEventListener('SAVIOR_POSITIONS_CLEARED', handleGlobalPositionsCleared);
    return () => window.removeEventListener('SAVIOR_POSITIONS_CLEARED', handleGlobalPositionsCleared);
  }, [lockAndPurgeClosedSymbols]);

  // Real-time detection of closed positions
  useEffect(() => {
    const prevPosMap = new Map(prevPositionsRef.current.map(p => [normalizeSymbol(p.symbol), p]));
    const currentPosMap = new Map(filteredPositions.map(p => [normalizeSymbol(p.symbol), p]));
    let changed = false;

    prevPosMap.forEach((pos, sym) => {
      if (!currentPosMap.has(sym)) {
        list1OpenedSymbolsRef.current.add(sym);
        list1ClosedSymbolsRef.current.add(sym);
        list1ClosedTimeRef.current[sym] = Date.now();
        changed = true;
      }
    });

    // If active in positions, ensure opened tracking is set and remove from closed set
    currentPosMap.forEach((pos, sym) => {
      if (!list1OpenedSymbolsRef.current.has(sym)) {
        changed = true;
      }
      list1OpenedSymbolsRef.current.add(sym);
      list1ClosedSymbolsRef.current.delete(sym);
    });

    if (changed) {
      persistList1OpenedSet(list1OpenedSymbolsRef.current);
      persistList1ClosedTimes(list1ClosedTimeRef.current);
    }

    prevPositionsRef.current = filteredPositions;
  }, [filteredPositions]);

  // 🚀 Helper: Filter List 1 candidates by List 2 push funnel rules when instantOpenUsePushFilter is enabled
  const filterCandidatesByPushConfig = useCallback((
    candidates: ScannerItem[],
    pushConfig: any,
    dir: 'LONG' | 'SHORT' = 'LONG',
    outNeeds5mSymbols?: string[],
    closedTimesMap?: Record<string, number>
  ): ScannerItem[] => {
    return filterCandidatesByPushConfigShared(candidates, pushConfig, currentPricesRef.current, dir, true, outNeeds5mSymbols, closedTimesMap);
  }, []);

  const effectiveInstantPool = useMemo(() => {
    return list1InstantCandidates.length > 0 ? list1InstantCandidates : list1Candidates;
  }, [list1InstantCandidates, list1Candidates]);

  const list1CandidatesKey = useMemo(() => {
    return (effectiveInstantPool || []).map(c => `${c.symbol}_${c.price || 0}_${c.change || 0}_${c.change8am || 0}_${c.volume24h || 0}_${c.volume8am || 0}_${c.lowPrice || 0}_${c.highPrice || 0}`).join('|');
  }, [effectiveInstantPool]);

  const filteredPositionsKey = useMemo(() => {
    return (filteredPositions || []).map(p => `${p.symbol}_${p.side}`).join('|');
  }, [filteredPositions]);

  const scanConfigKey = useMemo(() => JSON.stringify(scanConfig), [scanConfig]);

  // 🛡️ 仅在用户修改配置参数（或切换策略）时启用 600ms 防抖，防止输入中间态误触发；绝不因候选列表/实时价格正常更新而取消已排队发单
  const configSettleUntilRef = useRef<number>(0);
  const lastScanConfigKeyRef = useRef<string>(scanConfigKey);
  const lastStrategyIdForBatchRef = useRef<string>(selectedStrategyId || 'strat-1');
  const batchConfigVersionRef = useRef<number>(0);
  const activeBatchSymbolsRef = useRef<Set<string>>(new Set());
  const [configSettledTick, setConfigSettledTick] = useState<number>(0);
  const [wsRecheckTick, setWsRecheckTick] = useState<number>(0);
  const [kline5mReadyTick, setKline5mReadyTick] = useState<number>(0);

  useEffect(() => {
    const stratIdNow = selectedStrategyId || 'strat-1';
    if (lastScanConfigKeyRef.current !== scanConfigKey || lastStrategyIdForBatchRef.current !== stratIdNow) {
      lastScanConfigKeyRef.current = scanConfigKey;
      lastStrategyIdForBatchRef.current = stratIdNow;
      batchConfigVersionRef.current += 1;
      activeBatchSymbolsRef.current.clear();
      configSettleUntilRef.current = Date.now() + 600;
      const timer = setTimeout(() => {
        setConfigSettledTick(t => t + 1);
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [scanConfigKey, selectedStrategyId]);

  // 🚀 实时 WS 价格唤醒机制：每 1.5 秒基于最新实时行情重检一次立即开候选池，修复价格微幅回调后回升不重触发的问题
  const isInstantModeActive = Boolean(scanConfig?.instantOpenEnabled || scanConfig?.instantReopenEnabled);
  const hasInstantPoolItems = effectiveInstantPool.length > 0;
  useEffect(() => {
    if (!isInstantModeActive || !hasInstantPoolItems) return;
    const timer = setInterval(() => {
      setWsRecheckTick(t => (t + 1) % 1000000);
    }, 1500);
    return () => clearInterval(timer);
  }, [isInstantModeActive, hasInstantPoolItems]);

  useEffect(() => {
    const instantOpen = !!scanConfig?.instantOpenEnabled;
    const instantOpenAfterClose = !!scanConfig?.instantReopenEnabled;
    const openDirection = scanConfig?.instantOpenDirection || "LONG";

    if (!instantOpen && !instantOpenAfterClose) {
      return;
    }

    // 配置正在输入防抖期内，等待 600ms 稳定后由 configSettledTick 触发
    if (Date.now() < configSettleUntilRef.current) {
      return;
    }

    // 🔒 若处于固定选币模式，仅允许在监控池内的币种执行立即开仓
    const allowedFixedSet = scanConfig?.useCustomOnly
      ? new Set(
          (scanConfig.customSymbols || '')
            .split(/[,，\s]+/)
            .map(s => normalizeSymbol(s).replace('USDT', ''))
            .filter(Boolean)
        )
      : null;

    if (allowedFixedSet && allowedFixedSet.size === 0) {
      return;
    }

    const now = Date.now();

    // Collect candidates that meet opening conditions
    const pendingOpenTasks: Array<{
      symbol: string;
      side: PositionSide;
      price: number;
      reason: string;
      signalDetails: List1InstantOpenSignalDetails;
      isReopen: boolean;
    }> = [];

    // 🔒 强制绑定趋势门槛过滤：基于完整预截断池执行 [下限~上限] 纯上限与 5m 时序核验（对已平仓续开接入平仓后三档核验）
    const needed5mSymbols: string[] = [];
    const pushFilteredCandidates = filterCandidatesByPushConfig(
      effectiveInstantPool,
      scanConfig.list2PushConfig,
      openDirection,
      needed5mSymbols,
      instantOpenAfterClose ? list1ClosedTimeRef.current : undefined
    );

    // 对待开仓但尚未取得 5m K线时序校验的币种按需预加载 5m K线（跳过已持仓或本周期不可开的币种，零多余流量）
    if (needed5mSymbols.length > 0) {
      const eligibleNeed5m = needed5mSymbols.filter(rawSym => {
        const sym = normalizeSymbol(rawSym);
        if (allowedFixedSet && !allowedFixedSet.has(sym.replace('USDT', ''))) return false;
        if (activeBatchSymbolsRef.current.has(sym)) return false;
        if (filteredPositions.some(p => normalizeSymbol(p.symbol) === sym)) return false;
        const wasClosed = list1ClosedSymbolsRef.current.has(sym) || ((list1ClosedTimeRef.current[sym] || 0) > 0);
        if (wasClosed) {
          if (!instantOpenAfterClose) return false;
          const lastClosedTime = list1ClosedTimeRef.current[sym] || 0;
          if (now - lastClosedTime < 30000) return false;
          return true;
        }
        return instantOpen && !list1OpenedSymbolsRef.current.has(sym);
      });
      if (eligibleNeed5m.length > 0) {
        prefetchInstant5mKlines(eligibleNeed5m, () => {
          if (isMountedRef.current) {
            setKline5mReadyTick(t => (t + 1) % 1000000);
          }
        });
      }
    }

    pushFilteredCandidates.forEach(item => {
      const symbol = normalizeSymbol(item.symbol);
      if (allowedFixedSet && !allowedFixedSet.has(symbol.replace('USDT', ''))) {
        return;
      }
      if (activeBatchSymbolsRef.current.has(symbol)) {
        return;
      }
      const hasActivePosition = filteredPositions.some(p => normalizeSymbol(p.symbol) === symbol);

      if (hasActivePosition) {
        list1OpenedSymbolsRef.current.add(symbol);
        list1ClosedSymbolsRef.current.delete(symbol);
        return;
      }

      // Prevent redundant triggers during state update latency with a 5-second cooldown
      const lastTrigger = list1LastTriggerTimeRef.current[symbol] || 0;
      if (now - lastTrigger < 5000) {
        return;
      }

      const wasClosed = list1ClosedSymbolsRef.current.has(symbol) || ((list1ClosedTimeRef.current[symbol] || 0) > 0);

      // Branch 1: The position for this symbol was previously closed
      if (wasClosed) {
        // STRICT LOCK: In closed state, if instantReopenEnabled is false/disabled, NEVER reopen!
        if (!instantOpenAfterClose) {
          return;
        }

        // If instantReopenEnabled is strictly ON, require at least 30 seconds cooldown after position close
        const lastClosedTime = list1ClosedTimeRef.current[symbol] || 0;
        if (now - lastClosedTime < 30000) {
          return;
        }

        const price = resolvePrice(item.symbol, currentPricesRef.current, item.price);
        if (price > 0) {
          const side = openDirection === "SHORT" ? PositionSide.SHORT : PositionSide.LONG;
          const { reason: detailedReason, signalDetails } = buildList1InstantOpenReason(
            item,
            scanConfig,
            currentPricesRef.current,
            openDirection,
            { isReopen: true, resolvedPrice: price, lastClosedTime }
          );
          pendingOpenTasks.push({
            symbol,
            side,
            price,
            reason: detailedReason,
            signalDetails,
            isReopen: true
          });
        }
        return;
      }

      // Branch 2: Brand new candidate in List 1 that was NEVER opened and NEVER closed
      if (instantOpen) {
        if (list1OpenedSymbolsRef.current.has(symbol)) {
          return;
        }

        const price = resolvePrice(item.symbol, currentPricesRef.current, item.price);
        if (price > 0) {
          const side = openDirection === "SHORT" ? PositionSide.SHORT : PositionSide.LONG;
          const { reason: detailedReason, signalDetails } = buildList1InstantOpenReason(
            item,
            scanConfig,
            currentPricesRef.current,
            openDirection,
            { isReopen: false, resolvedPrice: price }
          );

          pendingOpenTasks.push({
            symbol,
            side,
            price,
            reason: detailedReason,
            signalDetails,
            isReopen: false
          });
        }
      }
    });

    if (pendingOpenTasks.length === 0) return;

    // 🚀 [列表1批量开仓限速引擎] 1秒钟不超过5个币，间隔1秒再提交下一批
    const BATCH_SIZE = 5;
    const taskChunks: typeof pendingOpenTasks[] = [];
    for (let i = 0; i < pendingOpenTasks.length; i += BATCH_SIZE) {
      taskChunks.push(pendingOpenTasks.slice(i, i + BATCH_SIZE));
    }

    const myConfigVersion = batchConfigVersionRef.current;
    const queuedSymbols = pendingOpenTasks.map(t => t.symbol);
    queuedSymbols.forEach(sym => activeBatchSymbolsRef.current.add(sym));

    (async () => {
      try {
        for (let chunkIndex = 0; chunkIndex < taskChunks.length; chunkIndex++) {
          if (!isMountedRef.current || batchConfigVersionRef.current !== myConfigVersion) break;

          const currentChunk = taskChunks[chunkIndex];

          // 非首批次，严格等待1秒间隔再提交
          if (chunkIndex > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (!isMountedRef.current || batchConfigVersionRef.current !== myConfigVersion) break;
          }

          for (const task of currentChunk) {
            if (!isMountedRef.current || batchConfigVersionRef.current !== myConfigVersion) break;

            list1LastTriggerTimeRef.current[task.symbol] = Date.now();

            console.log(`[List 1 Batch Open] Triggering trade for ${task.symbol} @ ${task.price} (${task.side}) | Batch ${chunkIndex + 1}/${taskChunks.length}`);
            const tradeExecuted = executeTradeSafe(
              task.symbol,
              task.side,
              task.price,
              task.reason,
              undefined,
              undefined,
              undefined,
              { isReopened: task.isReopen, signalDetails: task.signalDetails } as Partial<Position>
            );

            if (tradeExecuted) {
              list1OpenedSymbolsRef.current.add(task.symbol);
              if (task.isReopen) {
                delete list1ClosedTimeRef.current[task.symbol];
                list1ClosedSymbolsRef.current.delete(task.symbol);
                persistList1ClosedTimes(list1ClosedTimeRef.current);
              }
              persistList1OpenedSet(list1OpenedSymbolsRef.current);
            }
          }
        }
      } finally {
        queuedSymbols.forEach(sym => activeBatchSymbolsRef.current.delete(sym));
      }
    })();
  }, [list1CandidatesKey, scanConfigKey, filteredPositionsKey, executeTradeSafe, configSettledTick, wsRecheckTick, kline5mReadyTick]);

  const handleClosePositionInternal = useCallback(
    (symbol: string, side: PositionSide) => {
      const normSym = normalizeSymbol(symbol);
      list1OpenedSymbolsRef.current.add(normSym);
      list1ClosedSymbolsRef.current.add(normSym);
      list1ClosedTimeRef.current[normSym] = Date.now();
      persistList1OpenedSet(list1OpenedSymbolsRef.current);
      persistList1ClosedTimes(list1ClosedTimeRef.current);
      lockAndPurgeClosedSymbols([normSym]);
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
    [scannerMode, setPositions, setAccount, setTradeLogs, onClosePosition, lockAndPurgeClosedSymbols],
  );

  const handlePanicSell = useCallback(() => {
    const targets = currentPositions.length > 0 ? currentPositions : filteredPositions;
    const syms = targets.map((p) => normalizeSymbol(p.symbol));
    const now = Date.now();
    syms.forEach(s => {
      list1OpenedSymbolsRef.current.add(s);
      list1ClosedSymbolsRef.current.add(s);
      list1ClosedTimeRef.current[s] = now;
    });
    persistList1OpenedSet(list1OpenedSymbolsRef.current);
    persistList1ClosedTimes(list1ClosedTimeRef.current);
    lockAndPurgeClosedSymbols(syms);

    if (scannerMode === "BACKTEST") {
      batchCloseAll();
      if (onLog) onLog("SUCCESS", "[回测] 全部清仓执行完毕，已锁死二次自动复开");
    } else {
      if (onBatchClose) {
        onBatchClose();
      } else {
        targets.forEach((p) =>
          handleClosePositionInternal(p.symbol, p.side),
        );
      }
      if (onLog) onLog("SUCCESS", "战术执行: 全部清仓 (PANIC SELL) - 触发全局平仓锁与 30 分钟持久化冷却，已硬性封锁二次自动开仓");
    }
  }, [
    scannerMode,
    batchCloseAll,
    onBatchClose,
    currentPositions,
    filteredPositions,
    handleClosePositionInternal,
    onLog,
    lockAndPurgeClosedSymbols,
  ]);

  const handleSecureProfit = useCallback(() => {
    const targets = currentPositions.length > 0 ? currentPositions : filteredPositions;
    const profitable = targets.filter((p) => p.unrealizedPnL > 0);
    profitable.forEach((p) => {
      handleClosePositionInternal(p.symbol, p.side);
    });
    if (profitable.length > 0 && onLog)
      onLog("INFO", `战术执行: 止盈落袋 (${profitable.length} 个仓位) - 已压入防二次复开保护与 30 分钟冷却`);
  }, [currentPositions, filteredPositions, handleClosePositionInternal, onLog]);

  const handleCutLosses = useCallback(() => {
    const targets = currentPositions.length > 0 ? currentPositions : filteredPositions;
    const losing = targets.filter((p) => p.unrealizedPnL < 0);
    losing.forEach((p) => {
      handleClosePositionInternal(p.symbol, p.side);
    });
    if (losing.length > 0 && onLog)
      onLog("INFO", `战术执行: 一键止损 (${losing.length} 个仓位) - 已压入防二次复开保护与 30 分钟冷却`);
  }, [currentPositions, filteredPositions, handleClosePositionInternal, onLog]);

  const handleCloseLongs = useCallback(() => {
    const targets = currentPositions.length > 0 ? currentPositions : filteredPositions;
    const longs = targets.filter((p) => p.side === PositionSide.LONG);
    longs.forEach((p) => {
      handleClosePositionInternal(p.symbol, p.side);
    });
    if (longs.length > 0 && onLog)
      onLog("INFO", `战术执行: 平多 (${longs.length} 个仓位) - 已压入防二次复开保护与 30 分钟冷却`);
  }, [currentPositions, filteredPositions, handleClosePositionInternal, onLog]);

  const handleCloseShorts = useCallback(() => {
    const targets = currentPositions.length > 0 ? currentPositions : filteredPositions;
    const shorts = targets.filter(
      (p) => p.side === PositionSide.SHORT,
    );
    shorts.forEach((p) => {
      handleClosePositionInternal(p.symbol, p.side);
    });
    if (shorts.length > 0 && onLog)
      onLog("INFO", `战术执行: 平空 (${shorts.length} 个仓位) - 已压入防二次复开保护与 30 分钟冷却`);
  }, [currentPositions, filteredPositions, handleClosePositionInternal, onLog]);

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
    setChartData({ ...newData, sessionId: Date.now(), list2Config: scanConfigRef.current?.list2Config });
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
      {/* 🛡️ [DOM 节点防爆与后台常驻优化]: 当扫描终端未在前台打开时，彻底卸载重型视觉 DOM 树，释放 8000+ 节点 */}
      {/* Minimized View */}
      {isVisible && isMinimized && (
        <div
          className="fixed bottom-6 right-6 transition-opacity duration-300 opacity-100 pointer-events-auto"
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
      )}

      {/* Full View: 保持常驻挂载，最小化时仅使用 CSS 隐藏，确保列表 123456 保持 24 小时完全不停的一直运行 */}
      {isVisible && (
        <div
          className={`fixed inset-0 bg-black/90 backdrop-blur-sm items-center justify-center p-4 ${
            !isMinimized ? "flex" : "hidden pointer-events-none"
          }`}
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
              {/* 🧠 全局 DOM 节点实时归因追踪与诊断面板 */}
              <div className="shrink-0">
                <DomTrackerWidget />
              </div>
              {scannerMode !== "BACKTEST" && isRealTrading && (
                <div className="flex items-center gap-1.5 bg-emerald-950/50 border border-emerald-500/35 rounded px-2.5 py-1 animate-pulse shrink-0">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.9)]" />
                  <span className="text-xs text-emerald-400 font-bold tracking-wider font-sans">当前正在实盘交易</span>
                </div>
              )}
              {/* 币安行情连接与自动连接/重连全部按钮组件 */}
              {scannerMode !== "BACKTEST" && (
                <div className="shrink-0">
                  <NetworkWidget 
                    networkStatus={networkStatus || 'healthy'}
                    isOnline={isOnline}
                  />
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowDownloadModal(true)}
                className="flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 border border-blue-400/50 text-white rounded text-xs font-bold shadow-lg shadow-blue-950/50 transition-all cursor-pointer shrink-0 animate-pulse"
                title="获取 Windows PC 桌面专属挂机客户端 (.exe)"
              >
                <Download size={13} />
                <span>💻 客户端下载</span>
              </button>
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
                <span>提示：服务器行情网络延迟，正在进行自动后台重连与数据校验，请保持页面开启。</span>
              </div>
              <button 
                onClick={() => {
                  audioService.speak("提示：系统检测到行情延迟，正在尝试后台自动重连", true);
                  audioService.playAlert();
                }}
                className="bg-red-900 border border-red-500/30 text-white rounded px-2.5 py-0.5 text-[10px] font-bold hover:bg-red-800 hover:border-red-400 transition-all cursor-pointer flex items-center gap-1 shrink-0"
              >
                🔊 测试提示语音
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

          <div className="flex-1 flex gap-1 overflow-x-auto overflow-y-hidden bg-[#0b0e11] scrollbar-thin scrollbar-thumb-slate-800">
            <div id="module-list1" className="contents">
              <ErrorBoundary moduleName="1. 市场初筛">
                <MemoizedMarketScannerModule
                  key={selectedStrategyId}
                  onCandidatesUpdate={handleList1Results}
                  onInstantCandidatesUpdate={handleList1InstantResults}
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
                  activeStrategyId={isRotationEnabled ? rotationActiveStrategyId : selectedStrategyId}
                  isScanAllowed={true}
                  isRotationEnabled={isRotationEnabled}
                  rotationIntervalMinutes={rotationIntervalMinutes}
                  rotationTimeLeft={rotationTimeLeft}
                  onToggleRotation={setIsRotationEnabled}
                  onChangeRotationInterval={setRotationIntervalMinutes}
                  list2Results={list2Results}
                  list3Results={list3Results}
                  list3Config={list3Config}
                  currentPrices={currentPrices}
                />
              </ErrorBoundary>
            </div>

            <div id="module-list2" className="contents">
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
                    activePositions={filteredPositions || currentPositions}
                  />
                )}
              </ErrorBoundary>
            </div>

            <div id="module-list3" className="contents">
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
                    onConfigUpdate={handleList3ConfigUpdate}
                    onRemoveSignalReady={handleRemoveSignalReady}
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
                    onConfigUpdate={handleList3ConfigUpdate}
                    onRemoveSignalReady={handleRemoveSignalReady}
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
            </div>

            <div id="module-list4" className="contents">
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
            </div>

            <div id="module-battlefield" className="contents">
              <ErrorBoundary moduleName="5. 战场实况">
                {isUnconfigured ? (
                  <UnconfiguredColumn
                    title="5. 战场实况 (BATTLEFIELD)"
                    description="当前自动选币属于全新创建，没有任何持仓。策略激活并生成交易信号开仓后，持仓将在此显示。"
                  />
                ) : (
                  <LiveBattlefieldModule
                    key={selectedStrategyId}
                    positions={currentPositions}
                    realPrices={currentPrices}
                    setChartData={safeSetChartData}
                    onClosePosition={handleClosePositionInternal}
                    onStatsUpdate={handleLiveStatsUpdate}
                  />
                )}
              </ErrorBoundary>
            </div>

            <div id="module-command" className="contents">
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
                    onConfigUpdate={handleActionConfigUpdate}
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
          </div>

          {/* Bottom Log Panel */}
          {showLogPanel && (
            <div id="module-system-logs" className="h-32 border-t border-slate-800 bg-[#0b0e11] flex flex-col overflow-hidden">
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
      )}

      {isVisible && chartData && (
        <KlineChartModal
          key={chartData.sessionId || 'scanner-chart-modal'}
          symbol={chartData.symbol}
          symbolList={chartData.symbolList}
          symbolIndex={chartData.symbolIndex}
          initialTimeframe={chartData.tf || chartData.timeframe || '15m'}
          signals={chartData.signals}
          direction={chartData.direction || chartData.side}
          side={chartData.side || chartData.direction}
          entryPrice={chartData.entryPrice}
          entryTime={chartData.entryTime}
          signalCandle={chartData.signalCandle}
          currentPrice={chartData.currentPrice}
          list2Config={chartData.list2Config}
          list4Config={chartData.list4Config}
          highlightTime={chartData.highlightTime}
          extraLines={chartData.extraLines}
          directMode={directMode}
          showAuditLines={chartData.showAuditLines}
          tradeLogs={tradeLogs}
          appearedTime={chartData.appearedTime}
          disappearedTime={chartData.disappearedTime}
          source={chartData.source}
          isPreWait={chartData.isPreWait}
          viewMode={chartData.viewMode}
          executeTradeSafe={executeTradeSafe}
          onClose={() => setChartData(null)}
          onSymbolChange={(newSymbol, newTf) => {
            setChartData((prev: any) => prev ? {
              ...prev,
              symbol: newSymbol,
              tf: newTf || prev.tf,
              timeframe: newTf || prev.timeframe
            } : null);
          }}
          lookbackDays={chartData.lookbackDays}
          sidewaysDays={chartData.sidewaysDays}
          hasPrev={chartData.hasPrev}
          hasNext={chartData.hasNext}
          currentIndexLabel={chartData.currentIndexLabel}
          onPrev={chartData.onPrev}
          onNext={chartData.onNext}
        />
      )}

      {showDownloadModal && (
        <div className="fixed inset-0 z-[99999] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-blue-500/40 rounded-xl shadow-2xl max-w-lg w-full p-6 text-slate-200 relative animate-in fade-in zoom-in duration-200">
            <button
              onClick={() => setShowDownloadModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-blue-600/20 border border-blue-500/40 rounded-lg text-blue-400">
                <Download size={24} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Windows 桌面客户端 (.exe) 挂机下载中心</h3>
                <p className="text-xs text-slate-400">彻底远离浏览器网页休眠，实现 24 小时无人值守挂机交易</p>
              </div>
            </div>

            <div className="space-y-4 my-5">
              <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl space-y-2">
                <div className="text-xs font-bold text-blue-400 flex items-center gap-1.5">
                  <span>📦 方案一：Zip 绿色解压挂机版 (.zip)</span>
                </div>
                <p className="text-[11px] text-slate-400">包含完整的桌面二进制运行包，解压后直接双击运行。</p>
                <a
                  href="/api/download/zip"
                  download="0211自动找币防爆仓救世之星-portable.zip"
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-all w-full justify-center shadow-lg shadow-blue-900/40 cursor-pointer"
                >
                  <Download size={14} /> 点击下载免安装 Zip 包 (31MB)
                </a>
              </div>

              <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl space-y-2">
                <div className="text-xs font-bold text-indigo-400 flex items-center gap-1.5">
                  <span>📦 方案二：压缩包镜像二 (.zip)</span>
                </div>
                <p className="text-[11px] text-slate-400">镜像备用压缩包，同样包含完整的 24 小时无人值守挂机程序。</p>
                <a
                  href="/api/download/winzip"
                  download="0211自动找币防爆仓救世之星-0.0.0-win.zip"
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-all w-full justify-center shadow-lg shadow-indigo-900/40 cursor-pointer"
                >
                  <Download size={14} /> 点击下载备用 Zip 包 (24MB)
                </a>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
              <button
                onClick={() => {
                  const url = window.location.origin + "/api/download/zip";
                  navigator.clipboard.writeText(url);
                  alert("已成功将 Zip 解压挂机包下载链接复制到剪贴板！可粘贴到浏览器地址栏或迅雷下载。");
                }}
                className="text-xs text-slate-400 hover:text-blue-400 transition-colors flex items-center gap-1 cursor-pointer"
              >
                🔗 复制直连下载链接
              </button>
              <button
                onClick={() => setShowDownloadModal(false)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-bold transition-colors cursor-pointer"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Background Multi-Strategy Runners */}
      {strategies.map((strat) => {
        if (isVisible && strat.id === selectedStrategyId) return null; // 当前策略已在主视图中常驻运行 (展开与最小化状态均保持 24 小时不停)
        if (strat.unconfigured) return null; // Don't run if unconfigured
        return (
          <BackgroundStrategyRunner
            key={strat.id}
            strategyId={strat.id}
            active={strat.active && !scanConfig.useCustomOnly}
            networkStatus={networkStatus}
            currentPrices={currentPrices}
            currentPositions={currentPositions}
            executeTradeSafe={executeTradeSafe}
            onLog={onLog}
            mode={scannerMode}
            directMode={directMode}
            activeMode={activeMode}
            settings={settings}
            isRotationEnabled={isRotationEnabled}
            rotationActiveStrategyId={rotationActiveStrategyId}
            selectedStrategyId={selectedStrategyId}
          />
        );
      })}

      {/* Global Right-Click Context Menu for Coins */}
      <CoinContextMenu
        menuState={contextMenuState}
        onClose={() => setContextMenuState(prev => ({ ...prev, visible: false }))}
        onTriggerDiagnosis={(sym) => {
          eventBus.emit('TRIGGER_SYMBOL_DIAGNOSIS', sym);
        }}
        onTriggerOpenPosition={(sym, dir, prc) => {
          setQuickTradeState({
            isOpen: true,
            symbol: sym,
            initialDirection: dir,
            initialPrice: prc || currentPrices[sym] || 0
          });
        }}
      />

      {/* Global Quick Trade Modal */}
      <QuickTradeModal
        isOpen={quickTradeState.isOpen}
        onClose={() => setQuickTradeState(prev => ({ ...prev, isOpen: false }))}
        symbol={quickTradeState.symbol}
        initialDirection={quickTradeState.initialDirection}
        initialPrice={quickTradeState.initialPrice}
        livePrices={currentPrices}
        onConfirmTrade={(sym, side, price, amountUsdt, reason) => {
          executeTradeSafe(
            sym,
            side,
            price,
            reason,
            undefined,
            undefined,
            { customAmount: amountUsdt } as any
          );
        }}
      />
    </div>
  );
};

interface BackgroundStrategyRunnerProps {
  strategyId: string;
  active: boolean;
  networkStatus: any;
  currentPrices: Record<string, number>;
  currentPositions: Position[];
  executeTradeSafe: any;
  onLog: any;
  mode: 'LIVE' | 'BACKTEST' | 'SMART';
  directMode: boolean;
  activeMode: "24H" | "8AM";
  settings: any;
  isRotationEnabled: boolean;
  rotationActiveStrategyId: string;
  selectedStrategyId: string;
}

const BackgroundStrategyRunner: React.FC<BackgroundStrategyRunnerProps> = ({
  strategyId,
  active,
  networkStatus,
  currentPrices,
  currentPositions,
  executeTradeSafe,
  onLog,
  mode,
  directMode,
  activeMode,
  settings,
  isRotationEnabled,
  rotationActiveStrategyId,
  selectedStrategyId
}) => {
  const [config24H, setConfig24H] = usePersistedState<ScanConfig>(
    `SCANNER_CONFIG_24H_${strategyId}`,
    {
      timeBasis: "24H",
      source: "BOTH",
      minVolume: 1,
      maxVolume: 0,
      minChange: 1,
      customSymbols: "",
      useCustomOnly: false,
      batchSize: 40,
      limit: 2000,
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
        maxExtremeDistanceShort: 5,
        minExtremeDistanceLong: 0,
        minExtremeDistanceShort: 0,
        extremeDaysMinLong: 0,
        extremeDaysMaxLong: 300,
        extremeDaysMinShort: 0,
        extremeDaysMaxShort: 300
      }
    }
  );

  const [config8AM, setConfig8AM] = usePersistedState<ScanConfig>(
    `SCANNER_CONFIG_8AM_${strategyId}`,
    {
      timeBasis: "8AM",
      source: "GAINERS",
      minVolume: 1,
      maxVolume: 0,
      minChange: 1,
      customSymbols: "",
      useCustomOnly: false,
      batchSize: 40,
      limit: 2000,
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
        maxExtremeDistanceShort: 5,
        minExtremeDistanceLong: 0,
        minExtremeDistanceShort: 0,
        extremeDaysMinLong: 0,
        extremeDaysMaxLong: 300,
        extremeDaysMinShort: 0,
        extremeDaysMaxShort: 300
      }
    }
  );

  const scanConfig = useMemo(
    () => (activeMode === "24H" ? config24H : config8AM),
    [activeMode, config24H, config8AM],
  );

  // 🔒 [DATA INTEGRITY]: 严格由实时扫描流驱动，严禁启动时盲读历史残留列表
  const [list1Candidates, setList1Candidates] = useState<ScannerItem[]>([]);
  const [list2Results, setList2Results] = useState<ScannerItem[]>([]);
  const [list3Results, setList3Results] = useState<ScannerItem[]>([]);
  const [list3Config, setList3Config] = useState<List3Config | null>(null);
  const [actionConfig, setActionConfig] = useState<ActionConfig | null>(() => {
    try {
      const raw = localStorage.getItem(`SCANNER_ACTION_CONFIG_${strategyId}`) || localStorage.getItem("SCANNER_ACTION_CONFIG");
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  });

  // Load action config
  useEffect(() => {
    const raw = localStorage.getItem(`SCANNER_ACTION_CONFIG_${strategyId}`) || localStorage.getItem("SCANNER_ACTION_CONFIG");
    if (raw) {
      try {
        setActionConfig(JSON.parse(raw));
      } catch (e) {}
    }
  }, [strategyId]);

  const handleList1Results = useCallback((results: ScannerItem[]) => {
    setList1Candidates(prev => {
      if (JSON.stringify(prev) === JSON.stringify(results)) return prev;
      return results;
    });
  }, []);

  const handleList2Results = useCallback((results: ScannerItem[]) => {
    setList2Results(prev => {
      if (JSON.stringify(prev) === JSON.stringify(results)) return prev;
      return results;
    });
  }, []);

  const handleList3Results = useCallback((results: ScannerItem[]) => {
    setList3Results(prev => {
      if (JSON.stringify(prev) === JSON.stringify(results)) return prev;
      return results;
    });
  }, []);

  const handleList3ConfigUpdate = useCallback((newConfig: List3Config | null) => {
    setList3Config(prev => {
      if (JSON.stringify(prev) === JSON.stringify(newConfig)) return prev;
      return newConfig;
    });
  }, []);

  const handleActionConfigUpdate = useCallback((newConfig: ActionConfig | null) => {
    setActionConfig(prev => {
      if (JSON.stringify(prev) === JSON.stringify(newConfig)) return prev;
      return newConfig;
    });
  }, []);

  const bgRemoveSignalRef = useRef<((id: string) => void) | undefined>(undefined);
  const bgList2RemoveSignalRef = useRef<((id: string) => void) | undefined>(undefined);

  const handleBgRemoveSignalReady = useCallback((fn: (id: string) => void) => {
    bgRemoveSignalRef.current = fn;
  }, []);

  const handleBgRemoveSignal = (id: string) => {
    bgRemoveSignalRef.current?.(id);
    bgList2RemoveSignalRef.current?.(id);
  };

  // Wrapped executeTradeSafe to automatically bind this strategyId
  const wrappedExecuteTradeSafe = useCallback(
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
      return executeTradeSafe(
        symbol,
        side,
        price,
        reason,
        signalTf,
        signalCandle,
        entryEmas,
        { strategyId, customActionConfig: actionConfig, ...extraProps } as any
      );
    },
    [executeTradeSafe, strategyId, actionConfig]
  );

  // We filter positions only for this strategyId so that structure / momentum audits run correctly!
  const filteredPositions = useMemo(() => {
    return currentPositions.filter(p => (p.strategyId || 'strat-1') === strategyId);
  }, [currentPositions, strategyId]);

  // 🔒 持久化后台策略专属初筛与审计数据（防抖异步写入避免切策略或高频刷新卡死主线程）
  useEffect(() => {
    if (list1Candidates.length > 0) {
      saveStateDebounced(`SCANNER_LIST1_${strategyId}`, list1Candidates, 2500);
    }
  }, [list1Candidates, strategyId]);

  useEffect(() => {
    if (list2Results.length > 0) {
      saveStateDebounced(`SCANNER_LIST2_${strategyId}`, list2Results, 2500);
    }
  }, [list2Results, strategyId]);

  useEffect(() => {
    if (list3Results.length > 0) {
      saveStateDebounced(`SCANNER_LIST3_${strategyId}`, list3Results, 2500);
    }
  }, [list3Results, strategyId]);

  // 后台策略的即时开仓执行 (从 localStorage 初始化已开仓/已平仓集合，防止重启后重复开仓)
  const bgOpenedSymbolsRef = useRef<Set<string>>(getInitialList1OpenedSet());
  const bgLastTriggerTimeRef = useRef<Record<string, number>>({});
  const bgCurrentPricesRef = useRef<Record<string, number>>({});
  bgCurrentPricesRef.current = currentPrices;

  useEffect(() => {
    const handleBgCleared = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const syms: string[] = Array.isArray(detail?.symbols) ? detail.symbols : [];
      syms.forEach(s => bgOpenedSymbolsRef.current.add(normalizeSymbol(s)));
    };
    window.addEventListener('SAVIOR_POSITIONS_CLEARED', handleBgCleared);
    return () => window.removeEventListener('SAVIOR_POSITIONS_CLEARED', handleBgCleared);
  }, []);

  const bgCandidatesKey = useMemo(() => {
    return (list1Candidates || []).map(c => `${c.symbol}_${c.price || 0}_${c.change || 0}_${c.change8am || 0}_${c.volume24h || 0}_${c.volume8am || 0}_${c.lowPrice || 0}_${c.highPrice || 0}`).join('|');
  }, [list1Candidates]);

  const bgPositionsKey = useMemo(() => {
    return (filteredPositions || []).map(p => `${p.symbol}_${p.side}`).join('|');
  }, [filteredPositions]);

  const bgConfigKey = useMemo(() => JSON.stringify(scanConfig), [scanConfig]);

  const [bgKline5mReadyTick, setBgKline5mReadyTick] = useState<number>(0);
  const bgIsMountedRef = useRef<boolean>(true);
  useEffect(() => {
    bgIsMountedRef.current = true;
    return () => { bgIsMountedRef.current = false; };
  }, []);

  useEffect(() => {
    const instantOpen = !!scanConfig?.instantOpenEnabled;
    const instantOpenAfterClose = !!scanConfig?.instantReopenEnabled;
    const openDirection = scanConfig?.instantOpenDirection || "LONG";

    if (!instantOpen && !instantOpenAfterClose) return;

    const allowedFixedSet = scanConfig?.useCustomOnly
      ? new Set(
          (scanConfig.customSymbols || '')
            .split(/[,，\s]+/)
            .map(s => normalizeSymbol(s).replace('USDT', ''))
            .filter(Boolean)
        )
      : null;

    if (allowedFixedSet && allowedFixedSet.size === 0) return;

    const now = Date.now();
    const closedTimes = getInitialList1ClosedTimes();

    // 🔒 后台策略同样强制绑定趋势门槛过滤 + 5m K线时序核验
    const bgNeeded5mSymbols: string[] = [];
    const pushFilteredCandidates = filterCandidatesByPushConfigShared(
      list1Candidates,
      scanConfig.list2PushConfig,
      bgCurrentPricesRef.current,
      openDirection,
      true,
      bgNeeded5mSymbols
    );

    if (bgNeeded5mSymbols.length > 0) {
      const eligibleBgNeed5m = bgNeeded5mSymbols.filter(rawSym => {
        const sym = normalizeSymbol(rawSym);
        if (allowedFixedSet && !allowedFixedSet.has(sym.replace('USDT', ''))) return false;
        if (filteredPositions.some(p => normalizeSymbol(p.symbol) === sym)) return false;
        if (closedTimes[sym] && !instantOpenAfterClose) return false;
        return instantOpen && !bgOpenedSymbolsRef.current.has(sym);
      });
      if (eligibleBgNeed5m.length > 0) {
        prefetchInstant5mKlines(eligibleBgNeed5m, () => {
          if (bgIsMountedRef.current) {
            setBgKline5mReadyTick(t => (t + 1) % 1000000);
          }
        });
      }
    }

    pushFilteredCandidates.forEach(item => {
      const symbol = normalizeSymbol(item.symbol);
      if (allowedFixedSet && !allowedFixedSet.has(symbol.replace('USDT', ''))) return;

      const hasActivePosition = filteredPositions.some(p => normalizeSymbol(p.symbol) === symbol);
      if (hasActivePosition) {
        bgOpenedSymbolsRef.current.add(symbol);
        return;
      }

      if (closedTimes[symbol] && !instantOpenAfterClose) {
        bgOpenedSymbolsRef.current.add(symbol);
        return;
      }

      const lastTrigger = bgLastTriggerTimeRef.current[symbol] || 0;
      if (now - lastTrigger < 5000) return;

      if (instantOpen && !bgOpenedSymbolsRef.current.has(symbol)) {
        const price = resolvePrice(item.symbol, bgCurrentPricesRef.current, item.price);
        if (price > 0) {
          const side = openDirection === "SHORT" ? PositionSide.SHORT : PositionSide.LONG;
          bgLastTriggerTimeRef.current[symbol] = now;
          const { reason: detailedReason, signalDetails } = buildList1InstantOpenReason(
            item,
            scanConfig,
            bgCurrentPricesRef.current,
            openDirection,
            { isReopen: false, strategyId, resolvedPrice: price }
          );
          const executed = wrappedExecuteTradeSafe(
            symbol,
            side,
            price,
            detailedReason,
            undefined,
            undefined,
            undefined,
            { signalDetails } as Partial<Position>
          );
          if (executed) {
            bgOpenedSymbolsRef.current.add(symbol);
            persistList1OpenedSet(bgOpenedSymbolsRef.current);
          }
        }
      }
    });
  }, [bgCandidatesKey, bgConfigKey, bgPositionsKey, wrappedExecuteTradeSafe, strategyId, bgKline5mReadyTick]);

  const isBacktest = mode === "BACKTEST";

  return (
    <div style={{ display: 'none' }} className="hidden pointer-events-none w-0 h-0 opacity-0 select-none overflow-hidden">
      {/* 1. Market Scanner */}
      <MarketScannerModule
        key={`${strategyId}-scanner`}
        onCandidatesUpdate={handleList1Results}
        setChartData={() => {}}
        directMode={directMode}
        scanConfig={scanConfig}
        setScanConfig={setConfig24H}
        mode={mode}
        setMode={() => {}}
        onStartBacktest={() => {}}
        isSyncing={false}
        selectedStrategyId={strategyId}
        isBackground={true}
        isScanAllowed={active}
        activeStrategyId={selectedStrategyId}
      />

      {/* 2. Crossover */}
      {isBacktest ? (
        <BacktestGrandCrossingModule
          key={`${strategyId}-crossover-bt`}
          candidates={list1Candidates}
          onResultsUpdate={handleList2Results}
          scanConfig={scanConfig}
          setScanConfig={setConfig24H}
          setChartData={() => {}}
          directMode={directMode}
          onLog={onLog}
          onRemoveSignalReady={(fn) => {
            bgList2RemoveSignalRef.current = fn;
          }}
        />
      ) : (
        <MemoizedGrandCrossingModule
          key={`${strategyId}-crossover`}
          networkStatus={networkStatus}
          candidates={list1Candidates}
          onResultsUpdate={handleList2Results}
          scanConfig={scanConfig}
          setScanConfig={setConfig24H}
          setChartData={() => {}}
          directMode={directMode}
          onLog={onLog}
          onRemoveSignalReady={(fn) => {
            bgList2RemoveSignalRef.current = fn;
          }}
          strategyId={strategyId}
          isBackground={true}
          activePositions={filteredPositions || currentPositions}
        />
      )}

      {/* 3. Structure Audit */}
      {isBacktest ? (
        <BacktestStructureAuditModule
          key={`${strategyId}-structure-bt`}
          candidates={list2Results}
          onResultsUpdate={handleList3Results}
          onConfigUpdate={handleList3ConfigUpdate}
          onRemoveSignalReady={handleBgRemoveSignalReady}
          realPrices={currentPrices}
          setChartData={() => {}}
          executeTradeSafe={wrappedExecuteTradeSafe}
          activePositions={filteredPositions}
          directMode={directMode}
          actionConfig={actionConfig}
        />
      ) : (
        <MemoizedStructureAuditModule
          key={`${strategyId}-structure`}
          candidates={list2Results}
          onResultsUpdate={handleList3Results}
          onConfigUpdate={handleList3ConfigUpdate}
          onRemoveSignalReady={handleBgRemoveSignalReady}
          realPrices={currentPrices}
          setChartData={() => {}}
          executeTradeSafe={wrappedExecuteTradeSafe}
          activePositions={filteredPositions}
          directMode={directMode}
          actionConfig={actionConfig}
          strategyId={strategyId}
          isBackground={true}
        />
      )}

      {/* 4. Momentum Audit */}
      {isBacktest ? (
        <BacktestMomentumAuditModule
          key={`${strategyId}-momentum-bt`}
          candidates={list3Results}
          setChartData={() => {}}
          executeTradeSafe={wrappedExecuteTradeSafe}
          list3Config={list3Config}
          realPrices={currentPrices}
          activePositions={filteredPositions}
          onRemoveSignal={handleBgRemoveSignal}
          actionConfig={actionConfig}
          onLog={onLog}
        />
      ) : (
        <MemoizedMomentumAuditModule
          key={`${strategyId}-momentum`}
          candidates={list3Results}
          setChartData={() => {}}
          executeTradeSafe={wrappedExecuteTradeSafe}
          list3Config={list3Config}
          realPrices={currentPrices}
          activePositions={filteredPositions}
          onRemoveSignal={handleBgRemoveSignal}
          actionConfig={actionConfig}
          onLog={onLog}
          strategyId={strategyId}
          isBackground={true}
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
