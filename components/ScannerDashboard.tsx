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
import { normalizeSymbol, resolvePrice } from "../services/symbolUtils";
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

// 🔒 列表1单向顺势轨迹记忆表：记录每个币种在扫描周期内的实时价格与峰值轨迹，杜绝冲高回落(多)/超跌反弹(空)逆向开仓
interface List1SymbolTrajectory {
  lastPrice: number;
  sessionMaxPrice: number;
  sessionMinPrice: number;
  maxDirChg24: number;
  maxDirChg8am: number;
  maxBounce24: number;
  maxBounce8am: number;
  updatedAt: number;
}
const list1SymbolTrajectoryMap = new Map<string, List1SymbolTrajectory>();

// 🚀 Shared Helper: Filter List 1 candidates by List 2 push funnel rules (24H/8AM Chg, Vol, Bounce/Drop, OR/AND, TopN)
const filterCandidatesByPushConfigShared = (
  candidates: ScannerItem[],
  pushConfig: any,
  currentPricesMap: Record<string, number> = {},
  openDirection: 'LONG' | 'SHORT' = 'LONG',
  requireTrendThreshold: boolean = true
): ScannerItem[] => {
  if (!pushConfig) return requireTrendThreshold ? [] : candidates;
  const isPushEffectivelyEnabled = Boolean(
    pushConfig.enabled || pushConfig.enableTopN || pushConfig.enableChg24h ||
    pushConfig.enableChg8am || pushConfig.enableVol24h || pushConfig.enableVol8am ||
    pushConfig.enableBounce8am || pushConfig.enableBounce24h
  );
  if (!isPushEffectivelyEnabled && !requireTrendThreshold) return candidates;

  const isShortMode = openDirection === 'SHORT';

  // 🔒 核心铁律：当“立即开/平仓后续开”开启时，必须至少绑定一项有效的【① 趋势门槛过滤】涨跌幅条件（且下限阈值 > 0）
  const minChg24 = Math.abs(Number(pushConfig.minChg24h) || 0);
  const maxChg24 = Math.abs(Number(pushConfig.maxChg24h) || 0);
  const minChg8am = Math.abs(Number(pushConfig.minChg8am) || 0);
  const maxChg8am = Math.abs(Number(pushConfig.maxChg8am) || 0);
  const minVol24 = Number(pushConfig.minVol24h) || 0;
  const minVol8am = Number(pushConfig.minVol8am) || 0;
  const minBounce24 = Math.abs(Number(pushConfig.minBounce24h) || 0);
  const maxBounce24 = Math.abs(Number(pushConfig.maxBounce24h) || 0);
  const minBounce8am = Math.abs(Number(pushConfig.minBounce8am) || 0);
  const maxBounce8am = Math.abs(Number(pushConfig.maxBounce8am) || 0);

  const hasValidTrendRule = Boolean(
    (pushConfig.enableChg24h && minChg24 > 0) ||
    (pushConfig.enableChg8am && minChg8am > 0) ||
    (pushConfig.enableBounce24h && minBounce24 > 0) ||
    (pushConfig.enableBounce8am && minBounce8am > 0)
  );

  if (requireTrendThreshold && !hasValidTrendRule) {
    // 未勾选任何涨跌幅/极值涨跌幅趋势门槛（或正在清空输入框使阈值为0）时，严格拦截，禁止无门槛全量放行开仓
    return [];
  }

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

  const getV8 = (item: ScannerItem) => {
    const norm = normalizeSymbol(item.symbol).replace(/USDT$/i, '');
    return getVolume8am(`${norm}USDT`) || getVolume8am(item.symbol) || null;
  };

  const getVol24 = (item: ScannerItem): number => {
    if (item.volume24h !== undefined && item.volume24h !== null && !isNaN(Number(item.volume24h)) && Number(item.volume24h) > 0) return Number(item.volume24h);
    if (item.quoteVolume !== undefined && item.quoteVolume !== null && !isNaN(Number(item.quoteVolume))) return Number(item.quoteVolume) / 1_000_000;
    if (item.price && item.volume) return (Number(item.price) * Number(item.volume)) / 1_000_000;
    return 0;
  };

  const getVol8am = (item: ScannerItem): number => {
    const v8 = getV8(item);
    if (v8 && v8.volume8am !== undefined && !isNaN(Number(v8.volume8am))) return Number(v8.volume8am);
    if (item.volume8am !== undefined && item.volume8am !== null && !isNaN(Number(item.volume8am))) return Number(item.volume8am);
    return 0;
  };

  const getChg24 = (item: ScannerItem): number | null => {
    const it = item as any;
    if (item.change !== undefined && item.change !== null && !isNaN(Number(item.change))) return Number(item.change);
    if (it.chg24h !== undefined && !isNaN(Number(it.chg24h))) return Number(it.chg24h);
    if (it.priceChangePercent !== undefined && !isNaN(Number(it.priceChangePercent))) return Number(it.priceChangePercent);
    return null;
  };

  // 🔒 严禁在 8AM 数据未就绪时用 24H 涨跌幅冒充兜底，缺失时必须返回 null
  const getChg8am = (item: ScannerItem): number | null => {
    const v8 = getV8(item);
    if (v8 && v8.change8am !== undefined && v8.change8am !== null && !isNaN(Number(v8.change8am))) return Number(v8.change8am);
    const it = item as any;
    if (item.change8am !== undefined && item.change8am !== null && !isNaN(Number(item.change8am))) return Number(item.change8am);
    if (it.chg8am !== undefined && it.chg8am !== null && !isNaN(Number(it.chg8am))) return Number(it.chg8am);
    return null;
  };

  // 做多：8AM最低点到当前的涨幅；做空：8AM最高点到当前的跌幅
  const getBounce8amVal = (item: ScannerItem): number | null => {
    const v8 = getV8(item);
    const curPrice = resolvePrice(item.symbol, currentPricesMap, Number(item.price || v8?.lastPrice || 0));
    if (isShortMode) {
      const high8 = Number(v8?.highPrice || (item as any).highPrice8am || 0);
      if (high8 > 0 && curPrice > 0) {
        return ((high8 - curPrice) / high8) * 100;
      }
      return null;
    } else {
      const low8 = Number(v8?.lowPrice || (item as any).lowPrice8am || 0);
      if (low8 > 0 && curPrice > 0) {
        return ((curPrice - low8) / low8) * 100;
      }
      return null;
    }
  };

  // 做多：24H最低点到当前的涨幅；做空：24H最高点到当前的跌幅
  const getBounce24hVal = (item: ScannerItem): number | null => {
    const norm = normalizeSymbol(item.symbol).replace(/USDT$/i, '');
    const curPrice = resolvePrice(item.symbol, currentPricesMap, Number(item.price || 0));
    if (isShortMode) {
      const high24 = Number((item as any).highPrice || (item as any).high || rawHighMap[norm] || rawHighMap[`${norm}USDT`] || 0);
      if (high24 > 0 && curPrice > 0) {
        return ((high24 - curPrice) / high24) * 100;
      }
      return null;
    } else {
      const low24 = Number((item as any).lowPrice || (item as any).low || rawLowMap[norm] || rawLowMap[`${norm}USDT`] || 0);
      if (low24 > 0 && curPrice > 0) {
        return ((curPrice - low24) / low24) * 100;
      }
      return null;
    }
  };

  const nowTs = Date.now();

  let filtered = candidates.filter(item => {
    const norm = normalizeSymbol(item.symbol).replace(/USDT$/i, '');
    const v8 = getV8(item);
    const curPrice = resolvePrice(item.symbol, currentPricesMap, Number(item.price || v8?.lastPrice || 0));
    const v24 = getVol24(item);
    const v8am = getVol8am(item);
    const c24 = getChg24(item);
    const c8am = getChg8am(item);
    const b8 = getBounce8amVal(item);
    const b24 = getBounce24hVal(item);

    const dirChg24 = c24 !== null ? (isShortMode ? -c24 : c24) : null;
    const dirChg8am = c8am !== null ? (isShortMode ? -c8am : c8am) : null;

    // 1. 提取/更新该币种的实时扫描轨迹与历史极值
    let traj = list1SymbolTrajectoryMap.get(norm);
    if (!traj || nowTs - traj.updatedAt > 6 * 3600 * 1000) {
      traj = {
        lastPrice: curPrice,
        sessionMaxPrice: curPrice,
        sessionMinPrice: curPrice,
        maxDirChg24: dirChg24 ?? 0,
        maxDirChg8am: dirChg8am ?? 0,
        maxBounce24: b24 ?? 0,
        maxBounce8am: b8 ?? 0,
        updatedAt: nowTs,
      };
      list1SymbolTrajectoryMap.set(norm, traj);
    }

    const prevPrice = traj.lastPrice > 0 ? traj.lastPrice : curPrice;
    if (curPrice > 0) {
      traj.sessionMaxPrice = Math.max(traj.sessionMaxPrice, curPrice);
      traj.sessionMinPrice = traj.sessionMinPrice > 0 ? Math.min(traj.sessionMinPrice, curPrice) : curPrice;
      traj.lastPrice = curPrice;
    }
    if (dirChg24 !== null) traj.maxDirChg24 = Math.max(traj.maxDirChg24, dirChg24);
    if (dirChg8am !== null) traj.maxDirChg8am = Math.max(traj.maxDirChg8am, dirChg8am);
    if (b24 !== null) traj.maxBounce24 = Math.max(traj.maxBounce24, b24);
    if (b8 !== null) traj.maxBounce8am = Math.max(traj.maxBounce8am, b8);
    traj.updatedAt = nowTs;

    // 2. 计算 24H 与 8AM 周期内真实达到过的历史最高涨幅(多) / 最大跌幅(空)
    const high24 = Math.max(curPrice, Number((item as any).highPrice || (item as any).high || rawHighMap[norm] || rawHighMap[`${norm}USDT`] || 0));
    const low24Raw = Number((item as any).lowPrice || (item as any).low || rawLowMap[norm] || rawLowMap[`${norm}USDT`] || 0);
    const low24 = low24Raw > 0 ? Math.min(curPrice, low24Raw) : curPrice;
    const open24 = rawOpenMap[norm] || rawOpenMap[`${norm}USDT`] || (c24 !== null && curPrice > 0 && (1 + c24 / 100) > 0 ? curPrice / (1 + c24 / 100) : 0);

    const high8 = Math.max(curPrice, Number(v8?.highPrice || (item as any).highPrice8am || 0));
    const low8Raw = Number(v8?.lowPrice || (item as any).lowPrice8am || 0);
    const low8 = low8Raw > 0 ? Math.min(curPrice, low8Raw) : curPrice;
    const open8 = Number(v8?.openPrice || (c8am !== null && curPrice > 0 && (1 + c8am / 100) > 0 ? curPrice / (1 + c8am / 100) : 0));

    // 24H 曾经达到过的最大同向涨跌幅
    const histPeakChg24 = (() => {
      if (open24 <= 0) return traj.maxDirChg24;
      if (isShortMode) {
        return low24 > 0 ? Math.max(traj.maxDirChg24, ((open24 - low24) / open24) * 100) : traj.maxDirChg24;
      } else {
        return high24 > 0 ? Math.max(traj.maxDirChg24, ((high24 - open24) / open24) * 100) : traj.maxDirChg24;
      }
    })();

    // 8AM 曾经达到过的最大同向涨跌幅
    const histPeakChg8am = (() => {
      if (open8 <= 0) return traj.maxDirChg8am;
      if (isShortMode) {
        return low8 > 0 ? Math.max(traj.maxDirChg8am, ((open8 - low8) / open8) * 100) : traj.maxDirChg8am;
      } else {
        return high8 > 0 ? Math.max(traj.maxDirChg8am, ((high8 - open8) / open8) * 100) : traj.maxDirChg8am;
      }
    })();

    // 24H 极值涨跌幅曾经达到过的峰值
    const histPeakBounce24 = (() => {
      if (isShortMode) {
        if (c24 !== null && c24 < 0 && high24 > 0 && low24 > 0) {
          return Math.max(traj.maxBounce24, ((high24 - low24) / high24) * 100);
        }
        return traj.maxBounce24;
      } else {
        if (c24 !== null && c24 > 0 && low24 > 0 && high24 > 0) {
          return Math.max(traj.maxBounce24, ((high24 - low24) / low24) * 100);
        }
        return traj.maxBounce24;
      }
    })();

    // 8AM 极值涨跌幅曾经达到过的峰值
    const histPeakBounce8am = (() => {
      if (isShortMode) {
        if (c8am !== null && c8am < 0 && high8 > 0 && low8 > 0) {
          return Math.max(traj.maxBounce8am, ((high8 - low8) / high8) * 100);
        }
        return traj.maxBounce8am;
      } else {
        if (c8am !== null && c8am > 0 && low8 > 0 && high8 > 0) {
          return Math.max(traj.maxBounce8am, ((high8 - low8) / low8) * 100);
        }
        return traj.maxBounce8am;
      }
    })();

    // 3. 实时逆向运动检测：做多时若正在从高点向下跌（或当前价低于前一次扫描价 / 较本轮高点回落>0.35%），做空时若正在从低点向上反弹，判定为逆向回落/反弹
    const isMovingReverseInSession = (() => {
      if (curPrice <= 0) return false;
      if (isShortMode) {
        const bouncedFromSessionLow = traj.sessionMinPrice > 0 && ((curPrice - traj.sessionMinPrice) / traj.sessionMinPrice) * 100 > 0.35;
        return curPrice > prevPrice || bouncedFromSessionLow;
      } else {
        const droppedFromSessionHigh = traj.sessionMaxPrice > 0 && ((traj.sessionMaxPrice - curPrice) / traj.sessionMaxPrice) * 100 > 0.35;
        return curPrice < prevPrice || droppedFromSessionHigh;
      }
    })();

    // 区间判定（三段式 + 单向顺势突破铁律）：
    // 1. < 下限(min%)：不开仓
    // 2. [下限 min% ~ 上限 max%]：
    //    - 做多：必须是从下向上涨入区间（历史最高点未越过上限 max%，且未处于从高点向下回落过程）才立即开仓；若曾冲过上限再从上面跌下来，严禁直开并转交列表2
    //    - 做空：必须是从上向下跌入区间（历史最低点未越过上限 max%，且未处于从低点向上反弹过程）才立即开仓；若曾跌破上限再从下面弹上来，严禁直开并转交列表2
    // 3. > 上限(max%)：列表1拦截不直接开，转交列表2观察
    const trendChecks: boolean[] = [];
    let exceedsOrFallingFromUpperBound = false;

    if (pushConfig.enableChg24h) {
      const dirVal = dirChg24;
      const hasUpper = maxChg24 > 0 && maxChg24 >= minChg24;
      // 若当前已超上限，或历史/日内最高涨幅(多)/最大跌幅(空)曾超过上限后回落到区间内，或正从24H极值明显回落(>0.5%)
      const pulledBackFrom24hExtreme = dirVal !== null && dirVal > 0 && (histPeakChg24 - dirVal > 0.5);
      if (hasUpper && dirVal !== null && (dirVal > maxChg24 || histPeakChg24 > maxChg24 || pulledBackFrom24hExtreme || isMovingReverseInSession)) {
        exceedsOrFallingFromUpperBound = true;
      }
      trendChecks.push(
        minChg24 > 0 &&
        dirVal !== null &&
        dirVal >= minChg24 &&
        (!hasUpper || (dirVal <= maxChg24 && histPeakChg24 <= maxChg24 && !pulledBackFrom24hExtreme && !isMovingReverseInSession))
      );
    }
    if (pushConfig.enableChg8am) {
      const dirVal = dirChg8am;
      const hasUpper = maxChg8am > 0 && maxChg8am >= minChg8am;
      const pulledBackFrom8amExtreme = dirVal !== null && dirVal > 0 && (histPeakChg8am - dirVal > 0.5);
      if (hasUpper && dirVal !== null && (dirVal > maxChg8am || histPeakChg8am > maxChg8am || pulledBackFrom8amExtreme || isMovingReverseInSession)) {
        exceedsOrFallingFromUpperBound = true;
      }
      trendChecks.push(
        minChg8am > 0 &&
        dirVal !== null &&
        dirVal >= minChg8am &&
        (!hasUpper || (dirVal <= maxChg8am && histPeakChg8am <= maxChg8am && !pulledBackFrom8amExtreme && !isMovingReverseInSession))
      );
    }
    if (pushConfig.enableBounce24h) {
      const hasUpper = maxBounce24 > 0 && maxBounce24 >= minBounce24;
      const pulledBackFromBounce24Extreme = b24 !== null && (histPeakBounce24 - b24 > 0.5);
      if (hasUpper && b24 !== null && (b24 > maxBounce24 || histPeakBounce24 > maxBounce24 || pulledBackFromBounce24Extreme || isMovingReverseInSession)) {
        exceedsOrFallingFromUpperBound = true;
      }
      trendChecks.push(
        minBounce24 > 0 &&
        b24 !== null &&
        b24 >= minBounce24 &&
        (!hasUpper || (b24 <= maxBounce24 && histPeakBounce24 <= maxBounce24 && !pulledBackFromBounce24Extreme && !isMovingReverseInSession))
      );
    }
    if (pushConfig.enableBounce8am) {
      const hasUpper = maxBounce8am > 0 && maxBounce8am >= minBounce8am;
      const pulledBackFromBounce8amExtreme = b8 !== null && (histPeakBounce8am - b8 > 0.5);
      if (hasUpper && b8 !== null && (b8 > maxBounce8am || histPeakBounce8am > maxBounce8am || pulledBackFromBounce8amExtreme || isMovingReverseInSession)) {
        exceedsOrFallingFromUpperBound = true;
      }
      trendChecks.push(
        minBounce8am > 0 &&
        b8 !== null &&
        b8 >= minBounce8am &&
        (!hasUpper || (b8 <= maxBounce8am && histPeakBounce8am <= maxBounce8am && !pulledBackFromBounce8amExtreme && !isMovingReverseInSession))
      );
    }

    const volChecks: boolean[] = [];
    if (pushConfig.enableVol24h) {
      volChecks.push(minVol24 > 0 && v24 >= minVol24);
    }
    if (pushConfig.enableVol8am) {
      volChecks.push(minVol8am > 0 && v8am >= minVol8am);
    }

    if (requireTrendThreshold) {
      if (trendChecks.length === 0) return false;
      // 🔒 若任意已开启且设置了上限(max%)的趋势指标已超过上限、或曾冲过上限再从上面跌下来(做多)/从下面弹上来(做空)，列表1严禁直开，自动转交列表2观察
      if (exceedsOrFallingFromUpperBound) return false;
      if (pushConfig.mode === 'AND') {
        return trendChecks.every(Boolean) && volChecks.every(Boolean);
      } else {
        // OR 模式下：必须至少满足一项已勾选的【趋势涨跌幅/极值涨跌幅】区间条件（绝不允许仅凭交易额绕过涨跌幅门槛开仓）
        const trendPassed = trendChecks.some(Boolean);
        if (!trendPassed) return false;
        return true;
      }
    }

    const allChecks = [...trendChecks, ...volChecks];
    if (allChecks.length === 0) {
      return Boolean(pushConfig.enableTopN);
    }
    if (pushConfig.mode === 'AND') {
      return allChecks.every(Boolean);
    } else {
      return allChecks.some(Boolean);
    }
  });

  if (pushConfig.enableTopN && pushConfig.topNCount > 0) {
    const key = pushConfig.topNSortKey || 'CHG_8AM_ABS';
    filtered.sort((a, b) => {
      const c24A = getChg24(a) ?? 0;
      const c24B = getChg24(b) ?? 0;
      const c8A = getChg8am(a) ?? 0;
      const c8B = getChg8am(b) ?? 0;
      const b8A = getBounce8amVal(a) ?? 0;
      const b8B = getBounce8amVal(b) ?? 0;
      const b24A = getBounce24hVal(a) ?? 0;
      const b24B = getBounce24hVal(b) ?? 0;
      if (key === 'VOL_24H') return getVol24(b) - getVol24(a);
      if (key === 'VOL_8AM') return getVol8am(b) - getVol8am(a);
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
    setList1Candidates(loadState<ScannerItem[]>(`SCANNER_LIST1_${id}`, []));
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
  const filterCandidatesByPushConfig = useCallback((candidates: ScannerItem[], pushConfig: any, dir: 'LONG' | 'SHORT' = 'LONG'): ScannerItem[] => {
    return filterCandidatesByPushConfigShared(candidates, pushConfig, currentPricesRef.current, dir);
  }, []);

  const list1CandidatesKey = useMemo(() => {
    return (list1Candidates || []).map(c => `${c.symbol}_${c.price || 0}_${c.change || 0}_${c.change8am || 0}_${c.volume24h || 0}_${c.volume8am || 0}_${c.lowPrice || 0}_${c.highPrice || 0}`).join('|');
  }, [list1Candidates]);

  const filteredPositionsKey = useMemo(() => {
    return (filteredPositions || []).map(p => `${p.symbol}_${p.side}`).join('|');
  }, [filteredPositions]);

  const scanConfigKey = useMemo(() => JSON.stringify(scanConfig), [scanConfig]);

  useEffect(() => {
    const instantOpen = !!scanConfig?.instantOpenEnabled;
    const instantOpenAfterClose = !!scanConfig?.instantReopenEnabled;
    const openDirection = scanConfig?.instantOpenDirection || "LONG";

    if (!instantOpen && !instantOpenAfterClose) {
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
    let isCancelled = false;

    // Collect candidates that meet opening conditions
    const pendingOpenTasks: Array<{
      symbol: string;
      side: PositionSide;
      price: number;
      reason: string;
      isReopen: boolean;
    }> = [];

    // 🔒 强制绑定趋势门槛过滤：无论立即开还是平仓后续开，必须经过定向推送趋势门槛二次核验
    const pushFilteredCandidates = filterCandidatesByPushConfig(
      list1Candidates,
      scanConfig.list2PushConfig,
      openDirection
    );

    pushFilteredCandidates.forEach(item => {
      const symbol = normalizeSymbol(item.symbol);
      if (allowedFixedSet && !allowedFixedSet.has(symbol.replace('USDT', ''))) {
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
          pendingOpenTasks.push({
            symbol,
            side,
            price,
            reason: `[List1 Auto] ReopenAfterClose`,
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
          
          // 详细记录并显示由于“趋势门槛过滤”里的哪一个条件什么参数达成而开仓
          const pCfg = scanConfig?.list2PushConfig;
          const isShort = openDirection === 'SHORT';
          const min24 = Math.abs(Number(pCfg?.minChg24h) || 0);
          const max24 = Math.abs(Number(pCfg?.maxChg24h) || 0);
          const min8 = Math.abs(Number(pCfg?.minChg8am) || 0);
          const max8 = Math.abs(Number(pCfg?.maxChg8am) || 0);
          const minB24 = Math.abs(Number(pCfg?.minBounce24h) || 0);
          const maxB24 = Math.abs(Number(pCfg?.maxBounce24h) || 0);
          const minB8 = Math.abs(Number(pCfg?.minBounce8am) || 0);
          const maxB8 = Math.abs(Number(pCfg?.maxBounce8am) || 0);

          const curP = price;
          const c24Val = item.change !== undefined ? Number(item.change) : ((item as any).chg24h !== undefined ? Number((item as any).chg24h) : null);
          const c8Val = item.change8am !== undefined ? Number(item.change8am) : null;
          const d24 = c24Val !== null ? (isShort ? -c24Val : c24Val) : null;
          const d8 = c8Val !== null ? (isShort ? -c8Val : c8Val) : null;
          const low8 = Number((item as any).lowPrice8am || 0);
          const high8 = Number((item as any).highPrice8am || 0);
          const b8Val = isShort ? (high8 > 0 ? ((high8 - curP) / high8) * 100 : null) : (low8 > 0 ? ((curP - low8) / low8) * 100 : null);
          const low24 = Number((item as any).lowPrice || 0);
          const high24 = Number((item as any).highPrice || 0);
          const b24Val = isShort ? (high24 > 0 ? ((high24 - curP) / high24) * 100 : null) : (low24 > 0 ? ((curP - low24) / low24) * 100 : null);

          const matchedParts: string[] = [];
          if (pCfg?.enableChg24h && min24 > 0 && d24 !== null && d24 >= min24) {
            matchedParts.push(`${isShort ? '24H跌幅' : '24H涨幅'}: ${d24.toFixed(1)}% (要求≥${min24}%${max24 > 0 ? `~${max24}%` : ''})`);
          }
          if (pCfg?.enableChg8am && min8 > 0 && d8 !== null && d8 >= min8) {
            matchedParts.push(`${isShort ? '8AM跌幅' : '8AM涨幅'}: ${d8.toFixed(1)}% (要求≥${min8}%${max8 > 0 ? `~${max8}%` : ''})`);
          }
          if (pCfg?.enableBounce24h && minB24 > 0 && b24Val !== null && b24Val >= minB24) {
            matchedParts.push(`${isShort ? '24H高点跌幅' : '24H低点涨幅'}: ${b24Val.toFixed(1)}% (要求≥${minB24}%${maxB24 > 0 ? `~${maxB24}%` : ''})`);
          }
          if (pCfg?.enableBounce8am && minB8 > 0 && b8Val !== null && b8Val >= minB8) {
            matchedParts.push(`${isShort ? '8AM高点跌幅' : '8AM低点涨幅'}: ${b8Val.toFixed(1)}% (要求≥${minB8}%${maxB8 > 0 ? `~${maxB8}%` : ''})`);
          }

          const detailedReason = matchedParts.length > 0 
            ? `[List1 立即开] 趋势门槛达成: ${matchedParts.join(' | ')}`
            : `[List1 Auto] InstantOpen`;

          pendingOpenTasks.push({
            symbol,
            side,
            price,
            reason: detailedReason,
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

    (async () => {
      // 🛡️ 600ms 阈值输入防抖保护：防止用户在输入框连续敲击数字（如输入 15 时先按出 1）的毫秒级中间态误触发首批发单
      await new Promise(resolve => setTimeout(resolve, 600));
      if (isCancelled) return;

      for (let chunkIndex = 0; chunkIndex < taskChunks.length; chunkIndex++) {
        if (isCancelled) break;

        const currentChunk = taskChunks[chunkIndex];

        // 非首批次，严格等待1秒间隔再提交
        if (chunkIndex > 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (isCancelled) break;
        }

        for (const task of currentChunk) {
          if (isCancelled) break;

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
            { isReopened: task.isReopen }
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
    })();

    return () => {
      isCancelled = true;
    };
  }, [list1CandidatesKey, scanConfigKey, filteredPositionsKey, executeTradeSafe]);

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

    // 🔒 后台策略同样强制绑定趋势门槛过滤
    const pushFilteredCandidates = filterCandidatesByPushConfigShared(
      list1Candidates,
      scanConfig.list2PushConfig,
      bgCurrentPricesRef.current,
      openDirection,
      true
    );

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
          const executed = wrappedExecuteTradeSafe(
            symbol,
            side,
            price,
            `[List1 Auto - ${strategyId}] InstantOpen`
          );
          if (executed) {
            bgOpenedSymbolsRef.current.add(symbol);
            persistList1OpenedSet(bgOpenedSymbolsRef.current);
          }
        }
      }
    });
  }, [bgCandidatesKey, bgConfigKey, bgPositionsKey, wrappedExecuteTradeSafe, strategyId]);

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
