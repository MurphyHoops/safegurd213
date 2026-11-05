
// 🔒 LOCKED_MODULE: LIST 4 [动能趋势审计 UI 模块]
// @LOCKED: 严格原子化单独锁定。未经用户明确下达的专属指令，严禁擅自修改、增加、删减或变动任何功能与代码。

import React, { useEffect, useRef } from 'react';
import { useMomentumAudit } from './useMomentumAudit';
import { ScannerItem, List4Config, List3Config, ActionConfig } from '../../components/Scanner/scannerTypes';
import { PositionSide, Position } from '../../types';
import { normalizeSymbol } from '../../services/symbolUtils';
import { priceRegistry } from '../../services/priceRegistry';
import List4_Momentum from './components/List4_Momentum';

interface Props {
    candidates: ScannerItem[]; // From List 3
    setChartData: (data: any) => void;
    executeTradeSafe: (symbol: string, side: PositionSide, price: number, reason: string, signalTf?: string, signalCandle?: any, entryEmas?: any) => boolean;
    list3Config: List3Config; 
    realPrices: Record<string, number>;
    activePositions: Position[];
    onRemoveSignal?: (uniqueId: string) => void;
    actionConfig?: ActionConfig | null;
    onLog?: (type: any, message: string) => void;
    strategyId?: string;
    isBackground?: boolean;
}

const DEFAULT_CONFIG: List4Config = { 
    autoExecute: true, 
    midlineThreshold: 80, 
    breakoutThreshold: 10, // 进攻突破线默认10%
    maxBreakoutDeviation: 100, // 突破偏离上限默认 100% (以信号K线振幅为基准)
    directionFilter: 'BOTH', 
    enableThresholds: true, 
    enableAntiChase: false, 
    enableRev3K: false,
    rev3KCandles: 3,
    enableThrust: false,
    thrustThreshold: 1.0,
    invalidRetentionMinutes: 10, 
    removeInvalidMinutes: 15,
    removeTriggeredMinutes: 15,
    removeFuseMinutes: 15,
    removeInvalidCandles: 0,
    removeTradedCandles: 0,
    dormantRetentionCandles: 20,
    antiChaseConfig: { 
        longThresholds: { "2160": 0, "720": 0, "168": 0, "24": 0, "1": 0 },
        shortThresholds: { "2160": 0, "720": 0, "168": 0, "24": 0, "1": 0 },
    },
    enableAutoDirGuard: false,
    autoDirConfig: {
        limit1Q: 0,
        limit1M: 0,
        limit1W: 0,
        limit1D: 0,
        limit1H: 0
    }
};

// 辅助函数：根据周期推算当前 K 线的起始对齐秒级时间戳（防止数据源缺失时间戳退化为无时间维度锁）
const getFallbackCandleTimeSec = (tf: string = '15m'): number => {
  const match = tf.match(/(\d+)([mhd])/i);
  let intervalMs = 15 * 60 * 1000;
  if (match) {
    const num = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (unit === 'm') {
      intervalMs = num * 60 * 1000;
    } else if (unit === 'h') {
      intervalMs = num * 60 * 60 * 1000;
    } else if (unit === 'd') {
      intervalMs = num * 24 * 60 * 60 * 1000;
    }
  }
  return Math.floor(Math.floor(Date.now() / intervalMs) * intervalMs / 1000);
};

const EXECUTION_LOCKS_STORAGE_KEY = 'SCANNER_LIST4_EXECUTION_LOCKS';

const getInitialExecutionLocks = (): Map<string, { status: 'SUCCESS' | number; timestamp: number; confirmedInPositions?: boolean }> => {
  try {
    const raw = localStorage.getItem(EXECUTION_LOCKS_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw);
    const now = Date.now();
    const validEntries = Object.entries(parsed).filter(
      ([_, val]: [string, any]) => val && typeof val === 'object' && val.timestamp && (now - val.timestamp < 24 * 60 * 60 * 1000)
    );
    return new Map(validEntries as [string, any][]);
  } catch {
    return new Map();
  }
};

const saveExecutionLocks = (map: Map<string, any>) => {
  try {
    const obj: Record<string, any> = {};
    const now = Date.now();
    map.forEach((val, key) => {
      if (val && typeof val === 'object' && val.timestamp && (now - val.timestamp < 24 * 60 * 60 * 1000)) {
        obj[key] = val;
      }
    });
    localStorage.setItem(EXECUTION_LOCKS_STORAGE_KEY, JSON.stringify(obj));
  } catch (_) {}
};

export const MomentumAuditModule: React.FC<Props> = ({ candidates, setChartData, executeTradeSafe, list3Config, realPrices, activePositions, onRemoveSignal, actionConfig, onLog, strategyId, isBackground = false }) => {
    
    // PASS list3Config TO HOOK
    const { config, setConfig, list4, removeSymbol, clearItems } = useMomentumAudit(candidates, DEFAULT_CONFIG, list3Config, realPrices, activePositions, onRemoveSignal, strategyId);
    
    // Track executed signals to prevent duplicate orders for the same signal event
    // Map stores signalId -> { status: 'SUCCESS' | number, timestamp: number, confirmedInPositions?: boolean }
    const executionStatusRef = useRef<Map<string, { status: 'SUCCESS' | number; timestamp: number; confirmedInPositions?: boolean }>>(getInitialExecutionLocks());
    // 🔒 [单币多周期防并发锁] 杜绝同一币种在 15m、30m、1h 等多个周期同时突破时连续开仓 (120秒在途硬锁)
    const symbolLastExecutedRef = useRef<Map<string, number>>(new Map());
    const list4Ref = useRef(list4);
    const activePositionsRef = useRef(activePositions);
    const executeTradeSafeRef = useRef(executeTradeSafe);
    const onLogRef = useRef(onLog);
    const configRef = useRef(config);
    const realPricesRef = useRef(realPrices);
    const actionConfigRef = useRef(actionConfig);
    
    useEffect(() => { list4Ref.current = list4; }, [list4]);
    useEffect(() => { activePositionsRef.current = activePositions; }, [activePositions]);
    useEffect(() => { executeTradeSafeRef.current = executeTradeSafe; }, [executeTradeSafe]);
    useEffect(() => { onLogRef.current = onLog; }, [onLog]);
    useEffect(() => { configRef.current = config; }, [config]);
    useEffect(() => { realPricesRef.current = realPrices; }, [realPrices]);
    useEffect(() => { actionConfigRef.current = actionConfig; }, [actionConfig]);

    // 🔒 [列表4核心驱动] 极速判定并执行开仓逻辑
    const checkAndExecuteList4Trades = useRef(() => {
        const curConfig = configRef.current;
        const curActionConfig = actionConfigRef.current;
        const isMasterAutoOn = curActionConfig?.autoExecute ?? true;
        
        // 必须开启列表4自身的自动开仓开关 (默认为 true)
        if (curConfig.autoExecute === false || !isMasterAutoOn) {
            return;
        }

        const now = Date.now();
        const currentList4 = list4Ref.current;
        const currentPositions = activePositionsRef.current;

        currentList4.forEach(item => {
            // 必须达到突破触发状态 TRIGGERED
            if (item.momentum?.status === 'TRIGGERED') {
                const cleanSym = normalizeSymbol(item.symbol);
                const rawTimeSec = (item.structure as any)?.signalTimeSec || 
                                   item.structure?.signalTime || 
                                   (item as any).candleTimeSec || 
                                   (item as any).timeSec || 
                                   ((item as any).candle ? Math.floor((item as any).candle.time / 1000) : 0);
                const candleTimeSec = rawTimeSec > 0 ? rawTimeSec : getFallbackCandleTimeSec(item.tf);
                const uniqueId = `${cleanSym}-${item.tf}-${item.direction}-${candleTimeSec}`;
                
                // 方向过滤校验
                if (curConfig.directionFilter && curConfig.directionFilter !== 'BOTH') {
                    if (curConfig.directionFilter === 'LONG' && item.direction !== 'LONG') return;
                    if (curConfig.directionFilter === 'SHORT' && item.direction !== 'SHORT') return;
                }

                // 熔断拦截排队中标的直接跳过
                if (item.fuseBlocked) {
                    if (!executionStatusRef.current.has(uniqueId + '-fused')) {
                        console.warn(`[List4 Auto] ${cleanSym} (${item.tf}) 突破确认! 但被熔断拦截: ${item.fuseReason}`);
                        executionStatusRef.current.set(uniqueId + '-fused', { status: 'SUCCESS', timestamp: now, confirmedInPositions: true });
                    }
                    return;
                }

                const rawLive = priceRegistry.getPrice(cleanSym) || realPricesRef.current[cleanSym] || item.price;
                const livePrice = (typeof rawLive === 'number' && rawLive > 0) ? rawLive : item.price;

                // 🔒 【核心锁 1：进攻突破线核验】
                const entryTrigger = item.momentum?.entryTrigger || 0;
                const triggerEpsilon = (livePrice || 1) * 0.00001;
                const maxDevPct = (typeof curConfig.maxBreakoutDeviation === 'number' && !isNaN(curConfig.maxBreakoutDeviation))
                    ? curConfig.maxBreakoutDeviation
                    : 100;

                const rawRange = typeof item.structure?.signalHeight === 'number' && item.structure.signalHeight > 0
                    ? item.structure.signalHeight
                    : ((typeof item.structure?.signalHigh === 'number' && typeof item.structure?.signalLow === 'number' && item.structure.signalHigh > item.structure.signalLow)
                        ? (item.structure.signalHigh - item.structure.signalLow)
                        : (entryTrigger * 0.01));
                const price_range = rawRange > (livePrice * 0.0005) ? rawRange : (livePrice * 0.0005);

                if (entryTrigger > 0) {
                    if (item.direction === 'LONG') {
                        const isBreakoutReached = livePrice >= (entryTrigger - triggerEpsilon);
                        const maxAllowedPrice = entryTrigger + (price_range * (maxDevPct / 100));
                        // 🎯 仅在开启防追高熔断时进行偏离上限拦截，严禁未开启防追高时误拦截正常突破
                        if (!isBreakoutReached || (curConfig.enableAntiChase === true && livePrice > maxAllowedPrice)) {
                            if (curConfig.enableAntiChase === true && livePrice > maxAllowedPrice) {
                                console.warn(`[List4 Auto] ❌ ${cleanSym} 突破偏离过大拦截: 现价 ${livePrice} 超出上限 ${maxAllowedPrice.toFixed(6)} (+${maxDevPct}% 振幅)`);
                            }
                            return;
                        }
                    } else {
                        const isBreakoutReached = livePrice <= (entryTrigger + triggerEpsilon);
                        const minAllowedPrice = entryTrigger - (price_range * (maxDevPct / 100));
                        // 🎯 仅在开启防追高熔断时进行偏离上限拦截，严禁未开启防追高时误拦截正常突破
                        if (!isBreakoutReached || (curConfig.enableAntiChase === true && livePrice < minAllowedPrice)) {
                            if (curConfig.enableAntiChase === true && livePrice < minAllowedPrice) {
                                console.warn(`[List4 Auto] ❌ ${cleanSym} 突破偏离过大拦截: 现价 ${livePrice} 低于下限 ${minAllowedPrice.toFixed(6)} (-${maxDevPct}% 振幅)`);
                            }
                            return;
                        }
                    }
                }

                // 🔒 【核心锁 2：前 NK 突破 - 仅在开启前NK突破开关时生效】
                const kCount = Math.max(1, Math.min(50, curConfig.rev3KCandles ?? 3));
                if (curConfig.enableRev3K === true) {
                    if (!item.structure) return;
                    let maxClose: number | undefined = undefined;
                    let minClose: number | undefined = undefined;
                    if (item.structure.recentCloses && item.structure.recentCloses.length > 0) {
                        const slice = item.structure.recentCloses.slice(-kCount);
                        if (slice.length > 0) {
                            maxClose = Math.max(...slice);
                            minClose = Math.min(...slice);
                        }
                    }
                    if (typeof maxClose !== 'number') maxClose = item.structure.maxClose3;
                    if (typeof minClose !== 'number') minClose = item.structure.minClose3;

                    if (item.direction === 'LONG') {
                        if (typeof maxClose !== 'number' || livePrice <= maxClose) {
                            return; // 缺少该周期真实K线极值或实时价格未越过前 NK 最高收盘价，绝对禁止开仓
                        }
                    }
                    if (item.direction === 'SHORT') {
                        if (typeof minClose !== 'number' || livePrice >= minClose) {
                            return; // 缺少该周期真实K线极值或实时价格未跌破前 NK 最低收盘价，绝对禁止开仓
                        }
                    }
                }
                
                // 检查当前是否已有该币种持仓 (严格比对规范化 Symbol)
                const alreadyHasPosition = currentPositions.some(p => normalizeSymbol(p.symbol) === cleanSym && p.side === item.direction);
                const hasAnyPositionForSymbol = currentPositions.some(p => normalizeSymbol(p.symbol) === cleanSym);

                // 获取并更新该信号的执行锁状态
                const execRecord = executionStatusRef.current.get(uniqueId);

                // 若已成功开仓且持仓列表已确认，标记 confirmedInPositions
                if (alreadyHasPosition && execRecord && execRecord.status === 'SUCCESS') {
                    execRecord.confirmedInPositions = true;
                }

                // 🛡️ 防误开锁机制：一旦该突破信号事件 (uniqueId) 成功执行开仓 (status === 'SUCCESS')，即使后续仓位被一键清仓或平仓，该信号事件的锁绝对保留，不重新开仓！
                if (!alreadyHasPosition && execRecord && execRecord.status === 'SUCCESS') {
                    execRecord.confirmedInPositions = true;
                    return; // 已经执行过开仓的信号事件，拦截任何重复开仓
                }

                // 检查执行状态与重试冷却
                const currentStatus = executionStatusRef.current.get(uniqueId);
                if (currentStatus && currentStatus.status === 'SUCCESS') return;
                if (currentStatus && typeof currentStatus.status === 'number' && now - currentStatus.status < 10000) {
                    return; // 失败后 10 秒冷却
                }

                // 🔒 [单币跨周期/在途硬防重锁] 120秒内该标的是否已在途或已有持仓/开仓触发
                const lastExecutedTime = symbolLastExecutedRef.current.get(cleanSym) || 0;
                if (now - lastExecutedTime < 120000) {
                    return; // 120秒内绝对拦截同标的重复开仓
                }

                if (!alreadyHasPosition && !hasAnyPositionForSymbol) {
                    const tradeReason = `[列表4突破] [Auto] ${item.direction === 'LONG' ? '多' : '空'}进攻突破${curConfig.enableRev3K ? `+前${kCount}K确认` : ''} (${item.tf})`;
                    console.log(`[List4 Auto] 🚀 突破条件达成！立即执行开仓 ${cleanSym} @ ${livePrice} 原因: ${tradeReason}`);
                    
                    // 立即对该标的打上 120 秒在途硬锁，阻断多周期 (5m/30m/1h) 并发穿透
                    symbolLastExecutedRef.current.set(cleanSym, now);
                    
                    const signalCandle = item.structure ? {
                        high: item.structure.signalHigh,
                        low: item.structure.signalLow,
                        close: item.structure.signalPrice,
                        open: item.structure.signalPrice,
                        amplitude: (item.structure.signalHigh - item.structure.signalLow) / item.structure.signalLow
                    } : undefined;

                    const success = executeTradeSafeRef.current(
                        cleanSym, 
                        item.direction as PositionSide, 
                        livePrice, 
                        tradeReason, 
                        item.tf,
                        signalCandle
                    );
                    
                    if (success) {
                        executionStatusRef.current.set(uniqueId, { status: 'SUCCESS', timestamp: now, confirmedInPositions: false });
                        saveExecutionLocks(executionStatusRef.current);
                        console.log(`[List4 Auto] ✅ ${cleanSym} 开仓指令已送达并成功执行 (已建立防重护卫锁)`);
                    } else {
                        // 记录失败时间，进入 10 秒冷却后自动重试
                        executionStatusRef.current.set(uniqueId, { status: now, timestamp: now });
                        saveExecutionLocks(executionStatusRef.current);
                        console.warn(`[List4 Auto] ❌ ${cleanSym} 开仓执行受阻 (执行器拒绝)`);
                    }
                }
            }
        });
    });

    // --- 极速双保险驱动体系 ---
    // 1. WebSocket 价格直通监听
    useEffect(() => {
        const unsubscribe = priceRegistry.registerListener(() => {
            checkAndExecuteList4Trades.current();
        });
        // 2. 500ms 兜底安全脉冲
        const pulseTimer = setInterval(() => {
            checkAndExecuteList4Trades.current();
        }, 500);

        return () => {
            unsubscribe();
            clearInterval(pulseTimer);
        };
    }, []);

    // 3. 当 list4 列表刷新、持仓更新或开关变动时同步核验
    useEffect(() => {
        checkAndExecuteList4Trades.current();
    }, [list4, activePositions, config.autoExecute, config.directionFilter, actionConfig?.autoExecute]);

    if (isBackground) {
        return null;
    }

    return (
        <List4_Momentum 
            config={config} 
            setConfig={setConfig} 
            list4={list4} 
            list3Config={list3Config} // Pass through for UI filtering
            executeTradeSafe={executeTradeSafe}
            setChartData={setChartData}
            onRemoveItem={removeSymbol}
            onClearItems={clearItems}
        />
    );
};
