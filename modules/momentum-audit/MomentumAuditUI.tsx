
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

export const MomentumAuditModule: React.FC<Props> = ({ candidates, setChartData, executeTradeSafe, list3Config, realPrices, activePositions, onRemoveSignal, actionConfig, onLog, strategyId, isBackground = false }) => {
    
    // PASS list3Config TO HOOK
    const { config, setConfig, list4, removeSymbol, clearItems } = useMomentumAudit(candidates, DEFAULT_CONFIG, list3Config, realPrices, activePositions, onRemoveSignal, strategyId);
    
    // Track executed signals to prevent duplicate orders for the same signal event
    // Map stores signalId -> status ('SUCCESS' | lastFailureTime)
    const executionStatusRef = useRef<Map<string, 'SUCCESS' | number>>(new Map());
    // 🔒 [单币多周期防并发锁] 杜绝同一币种在 15m、30m、1h 等多个周期同时突破时连续开仓
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
                const signalTime = item.structure?.signalTime || 0;
                const uniqueId = `${cleanSym}-${item.tf}-${item.direction}-${signalTime}`;
                
                // 方向过滤校验
                if (curConfig.directionFilter && curConfig.directionFilter !== 'BOTH') {
                    if (curConfig.directionFilter === 'LONG' && item.direction !== 'LONG') return;
                    if (curConfig.directionFilter === 'SHORT' && item.direction !== 'SHORT') return;
                }

                // 熔断拦截排队中标的直接跳过
                if (item.fuseBlocked) {
                    if (executionStatusRef.current.get(uniqueId + '-fused') !== 'SUCCESS') {
                        console.warn(`[List4 Auto] ${cleanSym} (${item.tf}) 突破确认! 但被熔断拦截: ${item.fuseReason}`);
                        executionStatusRef.current.set(uniqueId + '-fused', 'SUCCESS');
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
                
                // 检查当前是否已有该币种同方向持仓
                const alreadyHasPosition = currentPositions.some(p => normalizeSymbol(p.symbol) === cleanSym && p.side === item.direction);

                // 若已无持仓，重置该信号之前的历史成功标记，避免平仓后永久锁死
                if (!alreadyHasPosition && executionStatusRef.current.get(uniqueId) === 'SUCCESS') {
                    executionStatusRef.current.delete(uniqueId);
                }

                // 检查执行状态与重试冷却 (失败后 10 秒冷却)
                const status = executionStatusRef.current.get(uniqueId);
                if (status === 'SUCCESS') return;
                if (typeof status === 'number' && now - status < 10000) {
                    return;
                }

                // 🔒 [单币多周期防并发锁] 该币种在 10 秒内是否已有周期触发过开仓
                const lastExecutedTime = symbolLastExecutedRef.current.get(cleanSym) || 0;
                if (now - lastExecutedTime < 10000) {
                    return;
                }

                if (!alreadyHasPosition) {
                    const tradeReason = `[列表4突破] [Auto] ${item.direction === 'LONG' ? '多' : '空'}进攻突破${curConfig.enableRev3K ? `+前${kCount}K确认` : ''} (${item.tf})`;
                    console.log(`[List4 Auto] 🚀 突破条件达成！立即执行开仓 ${cleanSym} @ ${livePrice} 原因: ${tradeReason}`);
                    
                    // 立即对该币种加锁，阻断同一轮遍历中后续周期并发穿透
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
                        executionStatusRef.current.set(uniqueId, 'SUCCESS');
                        console.log(`[List4 Auto] ✅ ${cleanSym} 开仓指令已送达并成功执行`);
                    } else {
                        // 记录失败时间，进入 10 秒冷却后自动重试
                        executionStatusRef.current.set(uniqueId, now);
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
