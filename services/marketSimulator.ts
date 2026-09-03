
import { AccountData, Position, AppSettings, TradeLog, LogEntry, SystemEvent, PositionSide, SimulationSettings } from '../types';
import { checkIndividualPositionRules, checkGlobalRules } from './rules/profit_loss_rules';
import { checkHedgingRules, checkSafeClearRules } from './rules/hedging_rules';
import { checkRescueRules } from './rules/rescue_rules';
import { checkStrategy5_OscillationGuard } from './rules/rescue/strategy5_oscillationGuard';
import { fetchWithFallback } from './apiService';
import { getLatestEMA, calculateRSI, calculateATR } from './indicators';
import { db, auth } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';
import { normalizeSymbol, isMajorCoin } from './symbolUtils';
import { audioService } from './audioService';

export class MarketSimulator {
    private account: AccountData;
    private positions: Position[];
    private settings: AppSettings;
    private updateCallback: (account: AccountData, positions: Position[], logs: LogEntry[], hedgeRecord: any, tradeLogs: TradeLog[], systemEvents: SystemEvent[], notification: any, rec: any) => void;
    public tradeLogs: TradeLog[];
    private systemEvents: SystemEvent[];
    private logs: LogEntry[];
    public realPrices: Record<string, number> = {};
    private symbolsWithFreshPrice: Set<string> = new Set();
    private bootTime: number = Date.now();
    private WARMUP_PERIOD = 15000; // 15s lock after boot to prevent stale data spikes
    public clearedTradeLogsTimestamp: number = 0;
    
    // Real trading automated execution callbacks
    public onRealHedge?: (position: Position, side: PositionSide, amountUsdt: number, reason: string, exactQty?: number) => Promise<void>;
    public onRealClose?: (position: Position, reason: string, customAmount?: number, ratio?: number) => Promise<void>;
    public onRealOpen?: (position: Position, quantity: number, reason: string) => Promise<void>;
    public onRealReopen?: (symbol: string, side: PositionSide, amountUsdt: number, reason: string, extraProps?: Partial<Position>) => Promise<void>;
    
    private lastHeartbeatTime: number = 0;
    private lastEmaCheckTime: number = 0;
    private lastIndicatorCheckTime: number = 0;
    private lastAdvisorTime: number = 0;
    private isNetworkHealthy: boolean = true;
    private isUpdatingEma: boolean = false;
    private isUpdatingIndicators: boolean = false;
    private lastEmitTime: number = 0;
    private pendingUpdate: boolean = false;
    private updateTimer: any = null;

    private cooldowns: Record<string, number> = {};
    private maxGlobalPnlPercent: number = 0;
    private pendingAutoOpens: Array<{ symbol: string; side: PositionSide; amount: number; extremePrice: number; pullbackPercent: number; mainEntryId: string }> = [];
    private lastReopenTimes: Record<string, number> = {};
    private initialSyncCompleted: boolean = false;
    private pendingRealOpenProps: Record<string, Partial<Position>> = {};
    private amputatedSymbolsInCycle: Set<string> = new Set();
    private recentlyClosedKeys: Map<string, number> = new Map(); // key -> closedTimestamp (防幽灵复活墓地池)
    public knownOrderIds: Set<string> = new Set();
    private processedExternalPnlOrders: Set<string> = new Set();

    public registerExecutedOrderId(orderId?: string | number) {
        if (orderId) {
            this.knownOrderIds.add(String(orderId));
        }
    }
    // 🔒 [平仓在途缓冲与自愈重试池]
    private inFlightClosingPool: Map<string, { symbol: string; side: PositionSide; amount: number; requestTime: number; retryCount: number }> = new Map();

    // 🔒 [防连续重复补仓三层硬锁 - 内核级在途锁与持久冷却时间戳]
    public inFlightRefillPool: Set<string> = new Set();
    public lastRefillTimestampMap: Map<string, number> = new Map();

    public registerInFlightClosing(symbol: string, side: PositionSide, amount: number) {
        const cleanSymbol = normalizeSymbol(symbol);
        const key = `${cleanSymbol}_${side}`;
        this.inFlightClosingPool.set(key, {
            symbol: cleanSymbol,
            side,
            amount,
            requestTime: Date.now(),
            retryCount: 0
        });
        this.removePositionLocally(cleanSymbol, side);
    }

    public registerInFlightBatchClose(positionsToClose: Position[]) {
        const now = Date.now();
        positionsToClose.forEach(pos => {
            const cleanSymbol = normalizeSymbol(pos.symbol);
            const key = `${cleanSymbol}_${pos.side}`;
            this.inFlightClosingPool.set(key, {
                symbol: cleanSymbol,
                side: pos.side,
                amount: pos.amount,
                requestTime: now,
                retryCount: 0
            });
            this.removePositionLocally(cleanSymbol, pos.side);
        });
    }

    public registerPendingRealOpenProps(symbol: string, side: PositionSide, props: Partial<Position>) {
        const key = `${normalizeSymbol(symbol)}_${side}`;
        this.pendingRealOpenProps[key] = {
            ...this.pendingRealOpenProps[key],
            ...props
        };
    }

    constructor(
        account: AccountData,
        positions: Position[],
        settings: AppSettings,
        updateCallback: any,
        tradeLogs: TradeLog[],
        systemEvents: SystemEvent[],
        logs: LogEntry[]
    ) {
        this.account = account;
        this.positions = positions;
        this.settings = settings;
        this.updateCallback = updateCallback;
        this.tradeLogs = tradeLogs;
        this.systemEvents = systemEvents;
        this.logs = logs;

        // Load persisted cleared trade logs timestamp
        try {
            const savedClearedTime = localStorage.getItem('SAVIOR_CLEARED_TRADELOGS_TIME');
            if (savedClearedTime) {
                this.clearedTradeLogsTimestamp = Number(savedClearedTime);
                if (this.clearedTradeLogsTimestamp > 0) {
                    this.tradeLogs = this.tradeLogs.filter(l => 
                        (l.exit_timestamp || l.entry_timestamp || 0) > this.clearedTradeLogsTimestamp
                    );
                }
            }
        } catch (e) {}

        // Load persisted max global pnl
        try {
            const savedMax = localStorage.getItem('SAVIOR_MAX_GLOBAL_PNL');
            if (savedMax) {
                this.maxGlobalPnlPercent = Number(savedMax);
            }
        } catch (e) {}

        // Load persisted cooldowns
        try {
            const saved = localStorage.getItem('SAVIOR_COOLDOWNS');
            if (saved) {
                const parsed = JSON.parse(saved);
                const now = Date.now();
                this.cooldowns = {};
                for (const key in parsed) {
                    if (parsed[key] > now) {
                        this.cooldowns[key] = parsed[key];
                    }
                }
            }
        } catch (e) {}

        // Load persisted pending auto opens (Rule A)
        this.loadPendingAutoOpens();
    }

    private savePendingAutoOpens() {
        try {
            localStorage.setItem('SAVIOR_PENDING_AUTO_OPENS', JSON.stringify(this.pendingAutoOpens));
        } catch (e) {}
    }

    private loadPendingAutoOpens() {
        try {
            const saved = localStorage.getItem('SAVIOR_PENDING_AUTO_OPENS');
            if (saved) {
                this.pendingAutoOpens = JSON.parse(saved);
            }
        } catch (e) {}
    }

    private checkPendingAutoOpens(): boolean {
        if (this.pendingAutoOpens.length === 0) return false;

        let stateChanged = false;
        const triggeredIndices: number[] = [];

        this.pendingAutoOpens.forEach((task, index) => {
            const normalizedSymbol = normalizeSymbol(task.symbol);
            const currentPrice = this.realPrices[normalizedSymbol];
            if (!currentPrice || isNaN(currentPrice) || currentPrice <= 0) return;

            if (task.side === PositionSide.LONG) {
                // Original was LONG, hedge was SHORT. Extreme price is lowest price.
                if (currentPrice < task.extremePrice) {
                    task.extremePrice = currentPrice;
                    stateChanged = true;
                }
                
                // Rebound/pullback up by pullbackPercent
                const triggerPrice = task.extremePrice * (1 + task.pullbackPercent / 100);
                if (currentPrice >= triggerPrice) {
                    this.triggerReopen(task);
                    triggeredIndices.push(index);
                    stateChanged = true;
                }
            } else {
                // Original was SHORT, hedge was LONG. Extreme price is highest price.
                if (currentPrice > task.extremePrice) {
                    task.extremePrice = currentPrice;
                    stateChanged = true;
                }

                // Rebound/pullback down by pullbackPercent
                const triggerPrice = task.extremePrice * (1 - task.pullbackPercent / 100);
                if (currentPrice <= triggerPrice) {
                    this.triggerReopen(task);
                    triggeredIndices.push(index);
                    stateChanged = true;
                }
            }
        });

        if (triggeredIndices.length > 0) {
            this.pendingAutoOpens = this.pendingAutoOpens.filter((_, idx) => !triggeredIndices.includes(idx));
            this.savePendingAutoOpens();
            stateChanged = true;
        }

        return stateChanged;
    }

    private triggerReopen(task: any) {
        const symbolKey = normalizeSymbol(task.symbol);
        const price = this.realPrices[symbolKey] || task.extremePrice || 1;
        const initialUsdtCost = task.amount || 100;
        this.addLog('SUCCESS', `🚀 [对冲盈利解套回调复开] 触发复开: ${task.symbol} ${task.side} | 原始本金: ${initialUsdtCost.toFixed(2)} USDT | 当前价: ${price.toFixed(4)} (自极值 ${task.extremePrice.toFixed(4)} 回调确认)`);
        
        const mockPos: Partial<Position> = {
            symbol: task.symbol,
            side: task.side,
            initialAmount: initialUsdtCost / price,
            amount: initialUsdtCost / price,
            entryPrice: price,
            markPrice: price,
            entryId: task.mainEntryId || `reopen_${Date.now()}`,
            reopenCount: 0,
            signalTf: '1m'
        };
        this.reopenPosition(mockPos as Position, '对冲盈利解套回调自动复开');
    }

    private saveCooldowns() {
        try {
            localStorage.setItem('SAVIOR_COOLDOWNS', JSON.stringify(this.cooldowns));
        } catch (e) {}
    }

    // Cooldown system to prevent immediate re-opening of positions after a manual/global clear
    public getPositions(): Position[] {
        return [...this.positions];
    }

    public setPositions(newPositions: Position[]) {
        const oldPositions = [...this.positions];
        const updatedPositions: Position[] = [];

        const isReal = this.settings.system?.realTrading;
        const isFirstSync = isReal && !this.initialSyncCompleted;

        // 0. Filter out positions that are still in-flight closing (within buffer window)
        const now = Date.now();
        const filteredNewPositions: Position[] = [];

        for (const np of newPositions) {
            const sym = normalizeSymbol(np.symbol);
            const key = `${sym}_${np.side}`;
            const inFlight = this.inFlightClosingPool.get(key);

            if (inFlight) {
                const elapsed = now - inFlight.requestTime;
                
                // Check if already closed in logs or recently closed keys
                const isAlreadyClosed = this.recentlyClosedKeys.has(key) || this.tradeLogs.some(l => 
                    normalizeSymbol(l.symbol) === sym && 
                    l.status === 'CLOSED' && 
                    l.direction === np.side && 
                    (now - (l.exit_timestamp || 0) < 60000)
                );

                if (isAlreadyClosed) {
                    this.inFlightClosingPool.delete(key);
                    continue; // Skip stale snapshot position
                }

                // Buffer period: 8 seconds (8000ms) to allow Binance snapshot to clear
                if (elapsed < 8000) {
                    console.log(`[MarketSimulator] In-flight closing buffer active for ${sym} (${np.side}) [elapsed ${elapsed}ms < 8000ms]. Masking from UI positions.`);
                    continue; // Suppress popping up during buffer period!
                } else {
                    // Buffer expired (> 8s).
                    this.inFlightClosingPool.delete(key);
                    this.recentlyClosedKeys.delete(key);

                    // Trigger self-healing auto-retry close if retry count < 1 (max 1 retry) and not already closed
                    if (inFlight.retryCount < 1 && isReal && typeof this.onRealClose === 'function' && !isAlreadyClosed) {
                        console.log(`[MarketSimulator] Auto-retrying failed close for ${sym} (${np.side}) (retry #${inFlight.retryCount + 1})...`);
                        this.addLog('WARNING', `⚠️ [平仓核验未完全平掉] ${sym} ${np.side} 未完全成交，系统正在自动发起极速补平 (第${inFlight.retryCount + 1}次重试)...`);
                        this.inFlightClosingPool.set(key, {
                            ...inFlight,
                            requestTime: Date.now(),
                            retryCount: inFlight.retryCount + 1
                        });
                        this.onRealClose(np, '未完全平仓自动重试补平');
                        continue;
                    }
                }
            }
            filteredNewPositions.push(np);
        }

        // 1. Process and match new/existing positions
        for (const newPos of filteredNewPositions) {
            const symbolKey = normalizeSymbol(newPos.symbol);
            const lookupKey = `${symbolKey}_${newPos.side}`;
            const pendingProps = this.pendingRealOpenProps ? this.pendingRealOpenProps[lookupKey] : undefined;

            // Find ALL local positions that match this symbol and side
            // CRITICAL DEFENSE: If there is a pending real open prop (indicating we just triggered a new open/reopen order),
            // we MUST NOT match this incoming position with any old/stale position.
            // This ensures the new position gets registered with a fresh entryTime and entryId, rather than inheriting stale ones.
            const hasPendingOpen = !!pendingProps;
            const isRecentlyClosed = this.recentlyClosedKeys.has(`${symbolKey}_${newPos.side}`);
            // 🔒 只有在无活动持仓或确实全额清仓时才使用 isRecentlyClosed 隔离；若实盘持仓仍然有效存在，必须正常匹配以保全救世策略元数据与砍仓锁
            const matchingOldPositions = hasPendingOpen
                ? []
                : oldPositions.filter(p => normalizeSymbol(p.symbol) === symbolKey && p.side === newPos.side && (p.amount > 0 || p.isAmputated || (p.amputatedAmount || 0) > 0 || p.isHedged || !!p.mainPositionId));
            
            if (matchingOldPositions.length > 0) {
                // 🔒 [单币同向绝对聚合] 币安每个交易对同方向为唯一净持仓，绝对保证一个 newPos 对应一条合并后的 position，严禁拆分成多条！
                const primaryOldPos = matchingOldPositions.find(p => p.entryId === newPos.entryId) ||
                    matchingOldPositions.find(p => p.mainPositionId) ||
                    matchingOldPositions[0];

                const cleanSym = normalizeSymbol(newPos.symbol);
                const symbolAllOld = oldPositions.filter(p => normalizeSymbol(p.symbol) === cleanSym);
                
                const isOldSymbolUnderActiveHedge = symbolAllOld.some(p => p.isHedged || !!p.mainPositionId || (p.isAmputated && (p.amputatedAmount || 0) > 0)) ||
                    !!newPos.isHedged || !!newPos.mainPositionId || this.amputatedSymbolsInCycle.has(cleanSym);
                
                const maxSymbolAmpLoss = isOldSymbolUnderActiveHedge
                    ? Math.max(0, ...symbolAllOld.map(p => p.cumulativeAmputationLoss || 0), ...matchingOldPositions.map(p => p.cumulativeAmputationLoss || 0))
                    : 0;
                const maxSymbolHedgeLoss = isOldSymbolUnderActiveHedge
                    ? Math.max(0, ...symbolAllOld.map(p => p.cumulativeHedgeLoss || 0), ...matchingOldPositions.map(p => p.cumulativeHedgeLoss || 0))
                    : 0;
                const maxSymbolAmpCount = isOldSymbolUnderActiveHedge
                    ? Math.max(0, ...symbolAllOld.map(p => p.amputationCount || 0), ...matchingOldPositions.map(p => p.amputationCount || 0))
                    : 0;
                
                // 🔒 精确识别被砍仓位本方：只有该方向自身处于砍仓标记或有砍仓扣减数量，且两边不处于等量对冲时才保持 isAmputatedState
                const opposingInOld = symbolAllOld.find(p => p.side !== newPos.side);
                const isOpposingEqual = opposingInOld && Math.abs(newPos.amount - opposingInOld.amount) <= Math.max(newPos.amount, opposingInOld.amount) * 0.05;
                let mySideAmpAmount = matchingOldPositions.find(p => (p.amputatedAmount || 0) > 0)?.amputatedAmount || (primaryOldPos.isAmputated ? (primaryOldPos.amputatedAmount || 0) : 0);
                let isAmputatedState = !isOpposingEqual && isOldSymbolUnderActiveHedge && (primaryOldPos.isAmputated || mySideAmpAmount > 0);

                // 🔒 [自愈兜底恢复]：如果原标记因网络重连或重启刷新丢失，但流水中有未补仓的砍仓记录，且仓位显著小于对手单，则自动恢复被砍状态
                if (!isAmputatedState && opposingInOld && (opposingInOld.amount - newPos.amount) > (opposingInOld.amount * 0.2)) {
                    const latestCutLog = this.tradeLogs.find(l => 
                        normalizeSymbol(l.symbol) === cleanSym && 
                        l.direction === newPos.side && 
                        (l.exit_reason?.includes('砍仓') || l.exit_reason?.includes('断臂'))
                    );
                    const latestRefillLog = this.tradeLogs.find(l => 
                        normalizeSymbol(l.symbol) === cleanSym && 
                        l.direction === newPos.side && 
                        l.exit_reason?.includes('补仓')
                    );
                    if (latestCutLog && (!latestRefillLog || (latestCutLog.exit_timestamp || 0) > (latestRefillLog.entry_timestamp || 0))) {
                        const recoveredCutQty = latestCutLog.current_amount || (opposingInOld.amount - newPos.amount);
                        if (recoveredCutQty > 0) {
                            isAmputatedState = true;
                            mySideAmpAmount = recoveredCutQty;
                        }
                    }
                }

                const finalAmpAmount = isAmputatedState ? (mySideAmpAmount || (primaryOldPos.amputatedAmount || 0)) : 0;
                
                if (isAmputatedState) {
                    this.amputatedSymbolsInCycle.add(cleanSym);
                } else if (isOpposingEqual) {
                    this.amputatedSymbolsInCycle.delete(cleanSym);
                }

                // Preserve original entry ID, time, and custom local attributes
                const mergedPos: Position = {
                    ...newPos,
                    entryId: primaryOldPos.entryId || newPos.entryId,
                    entryTime: primaryOldPos.entryTime || newPos.entryTime,
                    amount: newPos.amount, // 保持实盘或最新来源的真实完整仓位，严禁碎片化
                    signalTf: primaryOldPos.signalTf || newPos.signalTf,
                    signalCandle: primaryOldPos.signalCandle || newPos.signalCandle,
                    entryEmas: primaryOldPos.entryEmas || newPos.entryEmas,
                    isHedged: matchingOldPositions.some(p => p.isHedged) || !!primaryOldPos.isHedged,
                    mainPositionId: matchingOldPositions.find(p => p.mainPositionId)?.mainPositionId || primaryOldPos.mainPositionId,
                    hedgeSignalTriggered: primaryOldPos.hedgeSignalTriggered,
                    hedgeOrderInFlight: primaryOldPos.hedgeOrderInFlight,
                    hedgeOrderInFlightTime: primaryOldPos.hedgeOrderInFlightTime,
                    isReopened: primaryOldPos.isReopened,
                    reopenCount: primaryOldPos.reopenCount,
                    refillCount: Math.max(primaryOldPos.refillCount || 0, ...matchingOldPositions.map(p => p.refillCount || 0)),
                    lastRefillTime: Math.max(primaryOldPos.lastRefillTime || 0, this.lastRefillTimestampMap.get(`${cleanSym}_${newPos.side}`) || 0),
                    isOscillationLocked: primaryOldPos.isOscillationLocked || matchingOldPositions.some(p => p.isOscillationLocked),
                    triggerReason: primaryOldPos.triggerReason,
                    correlationId: primaryOldPos.correlationId,
                    hedgeRetries: primaryOldPos.hedgeRetries,
                    amputationCount: maxSymbolAmpCount,
                    cumulativeHedgeLoss: maxSymbolHedgeLoss,
                    cumulativeHedgeProfit: primaryOldPos.cumulativeHedgeProfit,
                    cumulativeAmputationLoss: maxSymbolAmpLoss,
                    cumulativeAmputationProfit: primaryOldPos.cumulativeAmputationProfit,
                    lastAmputationTime: primaryOldPos.lastAmputationTime,
                    amputationTriggered: primaryOldPos.amputationTriggered,
                    maxPnLAfterAmputationTrigger: primaryOldPos.maxPnLAfterAmputationTrigger,
                    maxPnLPercentAfterAmputationTrigger: primaryOldPos.maxPnLPercentAfterAmputationTrigger,
                    isUnshackled: primaryOldPos.isUnshackled,
                    isAmputated: isAmputatedState,
                    amputatedAmount: finalAmpAmount,
                    maxPnLPercent: primaryOldPos.maxPnLPercent,
                    customProfitSettings: 'customProfitSettings' in newPos ? newPos.customProfitSettings : primaryOldPos.customProfitSettings
                 };
                updatedPositions.push(mergedPos);
            } else {
                // Brand new position discovered
                const entryTime = Date.now();
                const entryId = newPos.entryId || `real_${newPos.symbol}_${newPos.side}_${entryTime}`;
                
                const symbolKey = normalizeSymbol(newPos.symbol);
                const lookupKey = `${symbolKey}_${newPos.side}`;
                const pendingProps = this.pendingRealOpenProps ? this.pendingRealOpenProps[lookupKey] : undefined;

                const processedPos: Position = {
                    ...newPos,
                    entryId,
                    entryTime,
                    signalTf: newPos.signalTf || '5m', // Default TF if not provided
                    ...pendingProps
                };

                if (pendingProps) {
                    delete this.pendingRealOpenProps[lookupKey];
                    this.addLog('SUCCESS', `🔄 [恢复开仓/复开标记] 成功为新同步的持仓 ${newPos.symbol} ${newPos.side} 恢复自定义属性 (复开: ${pendingProps.isReopened ? '是' : '否'}, 次数: ${pendingProps.reopenCount || 0})`);
                }

                updatedPositions.push(processedPos);
            }
        }

        // 1.8 In simulation mode (!isReal), preserve simulated active positions
        if (!isReal) {
            for (const oldPos of oldPositions) {
                const cleanSym = normalizeSymbol(oldPos.symbol);
                const lookupKey = `${cleanSym}_${oldPos.side}`;
                const isUnderActiveHedgeOrAmp = oldPos.isAmputated || (oldPos.amputatedAmount || 0) > 0 || oldPos.isHedged || !!oldPos.mainPositionId;
                const alreadyUpdated = updatedPositions.some(p => normalizeSymbol(p.symbol) === cleanSym && p.side === oldPos.side);
                const isRecentlyClosed = this.recentlyClosedKeys.has(lookupKey);

                if (isUnderActiveHedgeOrAmp && !alreadyUpdated && !isRecentlyClosed) {
                    console.log(`[MarketSimulator] Preserving simulated hedged/amputated position ${oldPos.symbol} (${oldPos.side})`);
                    updatedPositions.push(oldPos);
                }
            }
        }

        // 1.5 Auto-pairing of main and hedge positions (Real Trading Self-Healing Shield)
        // Ensure that if a symbol has two opposing positions (one LONG, one SHORT) in real trading,
        // they are robustly paired up so that Savior's rule engines track them as a parent-child hedge.
        // This is a CRITICAL self-healing layer that guarantees they are NEVER orphaned or split.
        const symbolGroups: Record<string, Position[]> = {};
        for (const p of updatedPositions) {
            const sym = normalizeSymbol(p.symbol);
            if (!symbolGroups[sym]) symbolGroups[sym] = [];
            symbolGroups[sym].push(p);
        }

        for (const [sym, posList] of Object.entries(symbolGroups)) {
            if (posList.length === 2) {
                const posA = posList[0];
                const posB = posList[1];
                if (posA.side !== posB.side) {
                    let main: Position | null = null;
                    let hedge: Position | null = null;

                    // A. Identify based on existing parent/child relationship
                    if (posA.mainPositionId === posB.entryId) {
                        main = posB;
                        hedge = posA;
                    } else if (posB.mainPositionId === posA.entryId) {
                        main = posA;
                        hedge = posB;
                    } 
                    // B. Identify based on startsWith('HEDGE_')
                    else if (posA.entryId?.startsWith('HEDGE_')) {
                        main = posB;
                        hedge = posA;
                    } else if (posB.entryId?.startsWith('HEDGE_')) {
                        main = posA;
                        hedge = posB;
                    }
                    // C. Identify based on tradeLogs open history
                    else {
                        const hedgeLog = this.tradeLogs.find(l => 
                            l.symbol && normalizeSymbol(l.symbol) === normalizeSymbol(sym) && 
                            l.status === 'OPEN' && l.is_hedge === true
                        );
                        if (hedgeLog) {
                            if (posA.side === hedgeLog.direction) {
                                hedge = posA;
                                main = posB;
                            } else if (posB.side === hedgeLog.direction) {
                                hedge = posB;
                                main = posA;
                            }
                        }
                    }

                    // 🔒 [严格区分] 严禁盲目使用时间或数量盲目将非防爆对冲引发的双向仓位强行配对为对冲仓！
                    // 只有当 A、B、C 明确识别出由防爆对冲触发的主对冲关系时，才进行配对与标记。
                    // 否则保持为独立的“标准风控”仓位，各自按止盈止损规则独立运行。
                    if (main && hedge) {
                        main.isHedged = true;
                        main.hedgeSignalTriggered = true;
                        delete main.hedgeOrderInFlight;
                        delete main.hedgeOrderInFlightTime;
                        if (main.mainPositionId) {
                            delete main.mainPositionId;
                        }
                        hedge.mainPositionId = main.entryId;
                        hedge.isHedged = true;
                        
                        // Heal and propagate triggerReason
                        if (!hedge.triggerReason && main.triggerReason) {
                            hedge.triggerReason = main.triggerReason;
                        } else if (!main.triggerReason && hedge.triggerReason) {
                            main.triggerReason = hedge.triggerReason;
                        }
                        
                        // Do not mutate existing OPEN log flags (is_hedge / main_entry_id) per user absolute rule:
                        // Existing open logs must remain immutable and keep their original open status/identity.
                        let hedgeLog = this.tradeLogs.find(l => 
                            (l.entry_id === hedge.entryId || (normalizeSymbol(l.symbol) === sym && l.direction === hedge.side)) && 
                            l.status === 'OPEN'
                        );
                        if (hedgeLog) {
                            const logReason = hedgeLog.events?.find(e => e.reason && e.reason !== '实盘发现/触发开仓' && e.reason !== '自动防爆对冲')?.reason || hedgeLog.events?.[0]?.reason;
                            if (logReason && !main.triggerReason) {
                                main.triggerReason = logReason;
                                hedge.triggerReason = logReason;
                            }
                        } else {
                            // Automatically record OPEN log for hedge position so it appears in transaction history as '防爆对冲开仓'
                            const hedgeOpenLog: TradeLog = {
                                symbol: hedge.symbol,
                                entry_id: hedge.entryId || `HEDGE_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                                status: 'OPEN',
                                is_hedge: true,
                                main_entry_id: main.entryId,
                                entry_timestamp: hedge.entryTime || Date.now(),
                                direction: hedge.side,
                                cost_usdt: (hedge.amount || 0) * (hedge.entryPrice || 0),
                                entry_price: hedge.entryPrice || 0,
                                current_amount: hedge.amount || 0,
                                timeframe: hedge.signalTf || '5m',
                                events: [{
                                    timestamp: hedge.entryTime || Date.now(),
                                    action: `防爆对冲开仓 (${hedge.side})`,
                                    price: hedge.entryPrice || 0,
                                    amount: hedge.amount || 0,
                                    reason: hedge.triggerReason || '防爆对冲开仓'
                                }]
                            };
                            this.tradeLogs.unshift(hedgeOpenLog);
                        }

                        // Also ensure main position has an OPEN log
                        let mainLog = this.tradeLogs.find(l => 
                            (l.entry_id === main.entryId || (normalizeSymbol(l.symbol) === sym && l.direction === main.side)) && 
                            l.status === 'OPEN'
                        );
                        if (!mainLog) {
                            const mainOpenLog: TradeLog = {
                                symbol: main.symbol,
                                entry_id: main.entryId || `MAIN_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                                status: 'OPEN',
                                is_hedge: false,
                                entry_timestamp: main.entryTime || Date.now(),
                                direction: main.side,
                                cost_usdt: (main.amount || 0) * (main.entryPrice || 0),
                                entry_price: main.entryPrice || 0,
                                current_amount: main.amount || 0,
                                timeframe: main.signalTf || '5m',
                                events: [{
                                    timestamp: main.entryTime || Date.now(),
                                    action: `实盘开仓 (${main.side})`,
                                    price: main.entryPrice || 0,
                                    amount: main.amount || 0,
                                    reason: main.triggerReason || '实盘发现/触发开仓'
                                }]
                            };
                            this.tradeLogs.unshift(mainOpenLog);
                        }
                        
                        console.log(`[Self-Healing Pairing] Successfully paired opposing positions for ${sym}: Main=${main.side} (${main.entryId}), Hedge=${hedge.side} (${hedge.entryId})`);
                    }
                }
            } else if (posList.length === 1) {
                // If there's only 1 position for the symbol, keep its existing mainPositionId/isHedged identity
                // per user instruction so that the remaining side is still marked as 'Hedged position' or 'Original position'.
                const singlePos = posList[0];
                const hasOpenLog = this.tradeLogs.some(l => 
                    (l.entry_id === singlePos.entryId || (normalizeSymbol(l.symbol) === sym && l.direction === singlePos.side)) && 
                    l.status === 'OPEN'
                );
                if (!hasOpenLog && (singlePos.amount || 0) > 0.0001) {
                    const isHedge = singlePos.isHedged || !!singlePos.mainPositionId || singlePos.entryId?.startsWith('HEDGE_');
                    const singleOpenLog: TradeLog = {
                        symbol: singlePos.symbol,
                        entry_id: singlePos.entryId || `POS_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                        status: 'OPEN',
                        is_hedge: isHedge,
                        main_entry_id: singlePos.mainPositionId,
                        entry_timestamp: singlePos.entryTime || Date.now(),
                        direction: singlePos.side,
                        cost_usdt: (singlePos.amount || 0) * (singlePos.entryPrice || 0),
                        entry_price: singlePos.entryPrice || 0,
                        current_amount: singlePos.amount || 0,
                        timeframe: singlePos.signalTf || '5m',
                        events: [{
                            timestamp: singlePos.entryTime || Date.now(),
                            action: isHedge ? `防爆对冲开仓 (${singlePos.side})` : `实盘开仓 (${singlePos.side})`,
                            price: singlePos.entryPrice || 0,
                            amount: singlePos.amount || 0,
                            reason: singlePos.triggerReason || (isHedge ? '防爆对冲开仓' : '实盘发现/触发开仓')
                        }]
                    };
                    this.tradeLogs.unshift(singleOpenLog);
                }
            }
        }

        // 2. Detect closed positions
        for (const oldPos of oldPositions) {
            const existsInNew = newPositions.some(p => normalizeSymbol(p.symbol) === normalizeSymbol(oldPos.symbol) && p.side === oldPos.side);
            if (!existsInNew) {
                // If in real trading, only sync-close positions that are actually real (starts with 'real_' or 'HEDGE_')
                const isRealPos = oldPos.entryId?.startsWith('real_') || oldPos.entryId?.startsWith('HEDGE_') || oldPos.isPendingSync;
                if (isReal && !isRealPos) {
                    // Ignore simulation positions during real-trading sync
                    console.log(`[MarketSimulator] Ignoring simulated position ${oldPos.symbol} during real-trading position sync.`);
                    continue;
                }

                // 🔒 [平仓墓地拦截池检测]：如果此仓位最近被执行过主动平仓，严禁复活！
                const now = Date.now();
                const posKey = `${normalizeSymbol(oldPos.symbol)}_${oldPos.side}`;
                const closedAt = this.recentlyClosedKeys.get(posKey) || 0;
                if (now - closedAt < 60000) {
                    console.log(`[MarketSimulator] Blocked ghost position resurrection for recently closed ${oldPos.symbol} (${oldPos.side})`);
                    continue;
                }

                // If this is a real position but was recently opened within 30000ms, preserve it in the list! (to prevent Binance REST API polling lag purging)
                const isRecentlyOpened = (now - (oldPos.entryTime || 0) < 30000);
                if (isReal && !oldPos.isBeingClosed && isRecentlyOpened) {
                    console.log(`[MarketSimulator] Preserving recently submitted open/hedge position ${oldPos.symbol} (${oldPos.side}) during API sync transition`);
                    updatedPositions.push(oldPos);
                    continue;
                }

                // If this position was fully amputated to 0, preserve it so it stays in UI with amount = 0
                // ONLY preserve it if there is still another active (non-zero amount) position left for this symbol in updatedPositions and not already added
                if (oldPos.isAmputatedToZero && !oldPos.isBeingClosed) {
                    const hasActiveForSymbol = updatedPositions.some(p => normalizeSymbol(p.symbol) === normalizeSymbol(oldPos.symbol) && p.amount > 0);
                    const alreadyInUpdated = updatedPositions.some(p => p.entryId === oldPos.entryId || (normalizeSymbol(p.symbol) === normalizeSymbol(oldPos.symbol) && p.side === oldPos.side && p.amount <= 0.0001));
                    if (hasActiveForSymbol && !alreadyInUpdated) {
                        console.log(`[MarketSimulator] Preserving amputated-to-zero position ${oldPos.symbol} (${oldPos.side}) as other active positions exist`);
                        oldPos.amount = 0; // Ensure amount is exactly 0
                        updatedPositions.push(oldPos);
                        continue;
                    } else {
                        console.log(`[MarketSimulator] Removing amputated-to-zero position ${oldPos.symbol} (${oldPos.side}) as no active positions remain or already present`);
                        continue;
                    }
                }

                // If this is the initial sync after program restart, do NOT log close to prevent ghost closing records from stale local cache on boot.
                if (isFirstSync) {
                    console.log(`[MarketSimulator] Initial sync: omitting close log for ${oldPos.symbol} as it was not found in active real positions`);
                    continue;
                }

                // Position has been closed! Check if we already logged it as CLOSED
                // 🔒 铁律：只有真正经历了存续期（>30秒）且确实不在新列表中且未记录过的仓位，才允许记录平仓
                const alreadyClosed = this.tradeLogs.some(l => 
                    l.status === 'CLOSED' && (
                        l.entry_id === oldPos.entryId || 
                        (normalizeSymbol(l.symbol) === normalizeSymbol(oldPos.symbol) && l.direction === oldPos.side && Math.abs((l.exit_timestamp || 0) - now) < 60000)
                    )
                );
                if (!alreadyClosed && !isRecentlyOpened && (now - (oldPos.entryTime || 0) > 30000)) {
                    this.recordRealTradeLog(oldPos, '实盘平仓 / 止盈止损已执行');
                }
            }
        }

        if (isReal && !this.initialSyncCompleted) {
            this.initialSyncCompleted = true;
            console.log("[MarketSimulator] Real-trading initial sync completed successfully. Ghost log defense activated.");
        }

        // 🔒 [开平仓独立铁律] OPEN 状态的开仓记录永久保持独立，严禁在持仓平仓时被改写为 CLOSED 记录
        // Deduplicate identical trade logs (protecting both OPEN and CLOSED logs)
        const seenLogKeys = new Set<string>();
        this.tradeLogs = this.tradeLogs.filter(l => {
            if (!l) return false;
            if (this.clearedTradeLogsTimestamp && (l.exit_timestamp || l.entry_timestamp || 0) <= this.clearedTradeLogsTimestamp) {
                return false;
            }
            const logKey = `${l.status}_${l.binance_order_id || l.entry_id || ''}_${l.entry_timestamp || 0}_${l.exit_timestamp || 0}`;
            if (seenLogKeys.has(logKey)) {
                return false;
            }
            seenLogKeys.add(logKey);
            return true;
        });

        // 🔒 严格去重与清理：确保每个交易对+方向在持仓列表中唯一，严禁重复堆积零持仓/对冲仓位
        const uniquePosMap = new Map<string, Position>();
        for (const p of updatedPositions) {
            const key = `${normalizeSymbol(p.symbol)}_${p.side}_${p.entryId || ''}`;
            if (!uniquePosMap.has(key)) {
                uniquePosMap.set(key, p);
            } else {
                const existing = uniquePosMap.get(key)!;
                if ((p.amount || 0) > (existing.amount || 0)) {
                    uniquePosMap.set(key, p);
                }
            }
        }

        const finalPositions: Position[] = [];
        const symbolSideActiveMap = new Set<string>();
        for (const p of uniquePosMap.values()) {
            if ((p.amount || 0) > 0.0001) {
                finalPositions.push(p);
                symbolSideActiveMap.add(`${normalizeSymbol(p.symbol)}_${p.side}`);
            }
        }

        const zeroAddedSet = new Set<string>();
        for (const p of uniquePosMap.values()) {
            if ((p.amount || 0) <= 0.0001) {
                const ssKey = `${normalizeSymbol(p.symbol)}_${p.side}`;
                const hasActive = symbolSideActiveMap.has(ssKey);
                if (hasActive && !zeroAddedSet.has(ssKey)) {
                    zeroAddedSet.add(ssKey);
                    finalPositions.push(p);
                }
            }
        }

        this.positions = finalPositions;
        
        // 🔒 [断网重连与仓位同步即时救世策略触发]
        // 当币安仓位同步/断网恢复完成后，立即对具有有效标记价/入场价的持仓执行一次盈亏核算与策略扫描，
        // 确保达到断臂求生/救世策略阈值的仓位无需等待下一次 WebSocket 推送即刻被触发！
        for (const p of this.positions) {
            const symKey = normalizeSymbol(p.symbol);
            if (!this.symbolsWithFreshPrice.has(symKey) && p.markPrice > 0 && p.entryPrice > 0) {
                this.symbolsWithFreshPrice.add(symKey);
            }
            if (p.markPrice > 0 && p.entryPrice > 0) {
                const isLong = p.side === PositionSide.LONG;
                p.unrealizedPnLPercentage = isLong 
                    ? ((p.markPrice - p.entryPrice) / p.entryPrice) * 100 
                    : ((p.entryPrice - p.markPrice) / p.entryPrice) * 100;
                p.unrealizedPnL = isLong
                    ? (p.markPrice - p.entryPrice) * p.amount
                    : (p.entryPrice - p.markPrice) * p.amount;
            }
        }
        this.checkStrategies();
        this.emitUpdate(true);
    }

    public cleanAmputatedPositionsForSymbol(symbol: string) {
        const cleanSymbol = normalizeSymbol(symbol);
        // Check if there are any ACTIVE (non-zero amount and not being closed) positions left for this symbol
        const hasActive = this.positions.some(p => normalizeSymbol(p.symbol) === cleanSymbol && p.amount > 0 && !p.isBeingClosed);
        if (!hasActive) {
            // Remove all 0-amount positions for this symbol
            const originalLength = this.positions.length;
            this.positions = this.positions.filter(p => !(normalizeSymbol(p.symbol) === cleanSymbol && (p.isAmputatedToZero || p.amount === 0 || p.isBeingClosed)));
            // 🔒 当该币种所有持仓均已彻底清空时，完全重置该币种的砍仓一票制锁，允许未来全新开仓周期正常使用
            this.amputatedSymbolsInCycle.delete(cleanSymbol);
            if (this.positions.length < originalLength) {
                console.log(`[MarketSimulator] Cleaned up amputated-to-zero positions for ${cleanSymbol} as no active positions remain.`);
            }
        }
    }

    public removePositionLocally(symbol: string, side?: PositionSide) {
        const cleanSymbol = normalizeSymbol(symbol);
        const now = Date.now();
        if (side) {
            this.recentlyClosedKeys.set(`${cleanSymbol}_${side}`, now);
        } else {
            this.recentlyClosedKeys.set(`${cleanSymbol}_${PositionSide.LONG}`, now);
            this.recentlyClosedKeys.set(`${cleanSymbol}_${PositionSide.SHORT}`, now);
        }
        this.positions.forEach(p => {
            if (normalizeSymbol(p.symbol) === cleanSymbol && (!side || p.side === side)) {
                p.isBeingClosed = true;
            }
        });
        this.positions = this.positions.filter(p => !(normalizeSymbol(p.symbol) === cleanSymbol && (!side || p.side === side)));
        this.cleanAmputatedPositionsForSymbol(symbol);
        this.emitUpdate(true);
    }

    public resetMarginBalance(amount: number) {
        this.account.marginBalance = amount;
        this.account.totalBalance = amount;
        this.addLog('INFO', `钱包余额已恢复为 ${amount} U`);
        this.emitUpdate(true);
    }

    public updateNetworkStatus(isHealthy: boolean) {
        if (this.isNetworkHealthy !== isHealthy) {
            this.isNetworkHealthy = isHealthy;
            if (!isHealthy) {
                this.addLog('WARNING', '⚠️ 检测到网络延迟或断开，已自动暂停所有开新仓策略（平仓不受影响）');
            } else {
                this.addLog('SUCCESS', '✅ 网络连接恢复正常，开仓策略已重新激活');
            }
        }
    }

    public updateRealPrices(prices: Record<string, number>) {
        // Just merge the prices. The caller (binanceWs) already normalized keys in its internal notify loop,
        // but we'll normalize here again for absolute safety.
        for (const symbol in prices) {
            const normalized = normalizeSymbol(symbol);
            this.realPrices[normalized] = prices[symbol];
            this.symbolsWithFreshPrice.add(normalized);
        }
    }

    private deepMerge(target: any, source: any): any {
        if (source === null || source === undefined) return target;
        if (target === null || target === undefined) return source;
        if (typeof target !== typeof source) return target;
        if (typeof target !== 'object') return source;
        if (Array.isArray(target) !== Array.isArray(source)) return target;
        if (Array.isArray(target)) return source;
        
        const result = { ...target };
        for (const key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
                result[key] = this.deepMerge(target[key], source[key]);
            }
        }
        return result;
    }

    public updateSettings(settings: AppSettings) {
        const oldRealTrading = this.settings.system?.realTrading;
        let oldRawRatio = this.settings.hedging?.extremeHedgeTriggerRatio;
        if (typeof oldRawRatio !== 'number' || isNaN(oldRawRatio)) oldRawRatio = 50;
        const oldRatio = oldRawRatio;
        
        this.settings = this.deepMerge(this.settings, settings);
        
        const newRealTrading = this.settings.system?.realTrading;
        let newRawRatio = this.settings.hedging?.extremeHedgeTriggerRatio;
        if (typeof newRawRatio !== 'number' || isNaN(newRawRatio)) newRawRatio = 50;
        const newRatio = newRawRatio;
        
        if (oldRealTrading !== newRealTrading) {
            if (newRealTrading) {
                const hasKeys = !!(this.settings.system.binanceApiKey && this.settings.system.binanceApiSecret);
                if (hasKeys) {
                    this.addLog('SUCCESS', '🟢 实盘 API 交易模式已成功对接 Binance 行情与交易接口！');
                } else {
                    this.addLog('WARNING', '🟡 实盘交易模式已激活，但未检测到 Binance API 密钥。已自动转为[实盘模拟]模式。');
                }
            } else {
                this.addLog('INFO', '⚪ 已切回标准模拟交易模式。');
            }
        }
        
        if (oldRatio !== newRatio) {
            // Recalculate trigger prices for all positions that already have periodExtremePrice
            for (const pos of this.positions) {
                if (pos.periodExtremePrice !== undefined && !pos.mainPositionId) {
                    const entry = pos.entryPrice;
                    const ratio = newRatio / 100;
                    if (pos.side === PositionSide.LONG) {
                        const distPercent = ((entry - pos.periodExtremePrice) / entry) * 100;
                        const triggerLossPercent = distPercent * ratio;
                        pos.extremeHedgeTriggerPrice = entry * (1 - triggerLossPercent / 100);
                    } else {
                        const distPercent = ((pos.periodExtremePrice - entry) / entry) * 100;
                        const triggerLossPercent = distPercent * ratio;
                        pos.extremeHedgeTriggerPrice = entry * (1 + triggerLossPercent / 100);
                    }
                }
            }
            this.emitUpdate(true);
        }
    }

    public swapModeState(isReal: boolean, newAccount: AccountData, newPositions: Position[], newTradeLogs: TradeLog[]) {
        this.account = { ...newAccount };
        this.positions = [ ...newPositions ];
        this.tradeLogs = [ ...newTradeLogs ];
    }

    public addTradeEvent(pos: Position, action: string, price: number, amount: number, reason: string, pnl?: number) {
        const event = {
            timestamp: Date.now(),
            action,
            price,
            amount,
            reason,
            pnl
        };

        // Find the main log entry for this position
        // If it's a hedge, we want the main position's log
        const mainId = pos.mainPositionId || pos.entryId;
        const mainLog = this.tradeLogs.find(l => l.entry_id === mainId);
        
        if (mainLog) {
            if (!mainLog.events) mainLog.events = [];
            mainLog.events.push(event);
        }
    }

    public openPosition(symbol: string, side: PositionSide, amount: number, price: number, signalTf?: string, signalCandle?: any, entryEmas?: any, extraProps?: Partial<Position>) {
        this.addLog('INFO', `[调试] 进入 openPosition: ${symbol} ${side} amount: ${amount} price: ${price}`);
        if (!this.isNetworkHealthy) {
            this.addLog('WARNING', `网络异常拦截: 拒绝开仓 ${symbol} ${side}`);
            return;
        }

        const upperSymbol = normalizeSymbol(symbol);
        
        if (this.settings.system.symbolBlacklist?.includes(upperSymbol)) {
            this.addLog('WARNING', `⚠️ 黑名单拦截: 拒绝开仓 ${upperSymbol}`);
            return;
        }

        // Robust real-time execution price check:
        // Use the actual current real-time market price if available to prevent opening at stale discovery prices.
        let executionPrice = price;
        let wsPrice = this.realPrices[upperSymbol];
        
        const isMajorCoinVal = isMajorCoin(upperSymbol);

        if (!wsPrice) {
            if (!isMajorCoinVal) {
                if (upperSymbol.startsWith('1000')) {
                    const base = upperSymbol.replace(/^1000/, '');
                    if (this.realPrices[base]) wsPrice = this.realPrices[base] * 1000;
                } else {
                    const scaled = '1000' + upperSymbol;
                    if (this.realPrices[scaled]) wsPrice = this.realPrices[scaled] / 1000;
                }
            }
        }

        if (wsPrice && !isNaN(wsPrice) && wsPrice > 0) {
            executionPrice = wsPrice;
        }

        if (!executionPrice || isNaN(executionPrice) || executionPrice <= 0) {
            this.addLog('DANGER', `拒绝开仓 ${upperSymbol}: 无效的价格 (${executionPrice})`);
            return;
        }

        // Check cooldown to prevent "popping back" after clear (Bypass completely for manual opens!)
        const cooldownKey = `${upperSymbol}_${side}`;
        if (!extraProps?.isManual && this.cooldowns[cooldownKey] && Date.now() < this.cooldowns[cooldownKey] && !extraProps?.isReopened) {
            if (Date.now() - this.lastEmitTime < 10000) { 
                return;
            }
        }

        const existingPosition = this.positions.find(p => p.symbol === upperSymbol && p.side === side && p.entryId !== extraProps?.parentEntryId);
        if (existingPosition) {
            this.addLog('WARNING', `Duplicate position blocked: ${side} on ${upperSymbol} already exists.`);
            return;
        }

        const entryId = Date.now().toString() + '_' + Math.random().toString(36).substring(2, 9);
        const simulatedAmplitude = 0.02;
        const finalSignalCandle = signalCandle || {
            open: executionPrice,
            close: executionPrice,
            high: executionPrice * (1 + simulatedAmplitude/2),
            low: executionPrice * (1 - simulatedAmplitude/2),
            amplitude: simulatedAmplitude
        };

        const trendFactor = side === PositionSide.LONG ? -1 : 1;
        const finalEntryEmas = entryEmas || {
            ema10: executionPrice * (1 + trendFactor * 0.05),
            ema20: executionPrice * (1 + trendFactor * 0.1),
            ema40: executionPrice * (1 + trendFactor * 0.2),
            ema80: executionPrice * (1 + trendFactor * 0.4)
        };

        const finalAmount = extraProps?.amount !== undefined ? extraProps.amount : (amount / executionPrice);
        const finalCostUsdt = extraProps?.amount !== undefined ? (extraProps.amount * executionPrice) : amount;

        const newPos: Position = {
            symbol: upperSymbol,
            side,
            amount: finalAmount,
            initialAmount: extraProps?.initialAmount !== undefined ? extraProps.initialAmount : finalAmount,
            entryPrice: executionPrice,
            markPrice: executionPrice,
            liquidationPrice: side === PositionSide.LONG ? executionPrice * 0.5 : executionPrice * 1.5,
            unrealizedPnL: 0,
            unrealizedPnLPercentage: 0,
            entryId,
            entryTime: Date.now(),
            signalTf: signalTf,
            signalCandle: finalSignalCandle,
            entryEmas: finalEntryEmas,
            leverage: extraProps?.leverage || 20,
            ...extraProps
        };
        this.positions.push(newPos);
        this.symbolsWithFreshPrice.add(upperSymbol);
        
        // Record Initial Log with events array initialized
        this.tradeLogs.unshift({
            symbol: upperSymbol,
            entry_id: entryId,
            status: 'OPEN',
            is_hedge: false,
            entry_timestamp: newPos.entryTime,
            direction: side,
            cost_usdt: finalCostUsdt,
            entry_price: executionPrice,
            correlationId: newPos.correlationId,
            is_reopened: newPos.isReopened,
            reopenCount: newPos.reopenCount,
            timeframe: signalTf,
            events: [{
                timestamp: newPos.entryTime,
                action: '主仓开仓',
                price: executionPrice,
                amount: newPos.amount,
                reason: '初始进场'
            }]
        });

        this.addLog('SUCCESS', `Opened ${side} on ${upperSymbol} at ${executionPrice} ${signalTf ? `(${signalTf})` : ''}`);
        this.emitUpdate(true);
    }

    public openHedgePosition(mainPosition: Position, side: PositionSide, amount: number, price: number, reason?: string) {
        if (!this.isNetworkHealthy) {
            this.addLog('WARNING', `网络异常拦截: 拒绝开对冲仓 ${mainPosition.symbol} ${side}`);
            return;
        }

        const upperSymbol = normalizeSymbol(mainPosition.symbol);

        // 🔒 [单主仓单次对冲开仓信号终极锁 (Single-Signal Guarantee)]
        // 只要该主仓已经发起过对冲信号或在途，严禁再次发起第二次开仓信号！
        if (mainPosition.hedgeSignalTriggered || mainPosition.hedgeOrderInFlight) {
            this.addLog('WARNING', `🛡️ [对冲信号单发保护] ${upperSymbol} 主仓已发起过对冲开仓信号 (在途/已触发)，绝对拦截重复开仓！`);
            return;
        }

        // 🛡️ [Strict Duplicate Hedge Guard: Any opposing position on same symbol]
        const existingOpposing = this.positions.find(p => 
            normalizeSymbol(p.symbol) === upperSymbol && 
            p.side === side && 
            p.amount > 0
        );
        if (mainPosition.isHedged || existingOpposing) {
            this.addLog('WARNING', `🛡️ [对冲重复拦截] ${upperSymbol} 已被标记为已对冲，或已存在活跃对冲单 ${existingOpposing?.entryId || ''}，拦截本次重复对冲开仓。`);
            mainPosition.isHedged = true; // Repair flag
            mainPosition.hedgeSignalTriggered = true;
            return;
        }

        // 立即给主仓打上在途锁和单次信号触发锁
        mainPosition.hedgeSignalTriggered = true;
        mainPosition.hedgeOrderInFlight = true;
        mainPosition.hedgeOrderInFlightTime = Date.now();
        mainPosition.isHedged = true;
        delete mainPosition.isUnshackled;

        // Robust real-time execution price check:
        let executionPrice = price;
        let wsPrice = this.realPrices[upperSymbol];
        
        const isMajorCoinVal = isMajorCoin(upperSymbol);

        if (!wsPrice) {
            if (!isMajorCoinVal) {
                if (upperSymbol.startsWith('1000')) {
                    const base = upperSymbol.replace(/^1000/, '');
                    if (this.realPrices[base]) wsPrice = this.realPrices[base] * 1000;
                } else {
                    const scaled = '1000' + upperSymbol;
                    if (this.realPrices[scaled]) wsPrice = this.realPrices[scaled] / 1000;
                }
            }
        }

        if (wsPrice && !isNaN(wsPrice) && wsPrice > 0) {
            executionPrice = wsPrice;
        }

        // CRITICAL FIX: Calculate exact hedge quantity based on parent's initial amount and active ratio
        const originalQty = mainPosition.initialAmount !== undefined ? mainPosition.initialAmount : mainPosition.amount;
        
        const hedgeSettings = this.settings.hedging;
        let activeHedgeRatio = hedgeSettings?.enabled ? hedgeSettings.hedgeRatio : 100;

        const slSettings = this.settings.stopLoss;
        if (slSettings.hedgeProfitClear) {
            activeHedgeRatio = slSettings.hedgeOpenRatio; // Strategy 2 Override
        } else if (slSettings.callbackProfitClear) {
            activeHedgeRatio = slSettings.callbackHedgeRatio; // Strategy 3 Override
        }

        const initialCostUsdt = originalQty * (mainPosition.entryPrice || executionPrice);
        const exactUsdtAmount = initialCostUsdt * (activeHedgeRatio / 100);
        const exactQty = executionPrice > 0 ? (exactUsdtAmount / executionPrice) : (originalQty * (activeHedgeRatio / 100));

        if (this.settings?.system?.realTrading && this.onRealHedge) {
            this.onRealHedge(mainPosition, side, exactUsdtAmount, reason || '自动防爆对冲', exactQty);
            mainPosition.isHedged = true;
            delete mainPosition.isUnshackled;
            mainPosition.hedgeRetries = (mainPosition.hedgeRetries || 0) + 1;
            this.emitUpdate(true);
            return;
        }

        const entryId = 'HEDGE_' + Date.now().toString() + '_' + Math.random().toString(36).substring(2, 9);
        const newPos: Position = {
            symbol: mainPosition.symbol,
            side,
            amount: exactQty,
            initialAmount: exactQty,
            entryPrice: executionPrice,
            markPrice: executionPrice,
            liquidationPrice: side === PositionSide.LONG ? executionPrice * 0.5 : executionPrice * 1.5,
            unrealizedPnL: 0,
            unrealizedPnLPercentage: 0,
            entryId,
            entryTime: Date.now(),
            isHedged: true,
            isPendingSync: this.settings.system?.realTrading ? true : undefined,
            mainPositionId: mainPosition.entryId,
            triggerReason: reason,
            correlationId: mainPosition.correlationId,
            reopenCount: mainPosition.reopenCount,
            leverage: mainPosition.leverage || 20
        };
        
        mainPosition.isHedged = true;
        mainPosition.triggerReason = reason;
        delete mainPosition.isUnshackled;
        mainPosition.hedgeRetries = (mainPosition.hedgeRetries || 0) + 1;
        this.positions.push(newPos);
        this.symbolsWithFreshPrice.add(upperSymbol);

        // Record OPEN trade log for successful simulated hedge open
        if (!this.tradeLogs.some(l => l.entry_id === entryId && l.status === 'OPEN')) {
            this.tradeLogs.unshift({
                symbol: newPos.symbol,
                entry_id: entryId,
                status: 'OPEN',
                is_hedge: true,
                entry_timestamp: newPos.entryTime,
                direction: side,
                cost_usdt: exactUsdtAmount,
                entry_price: executionPrice,
                current_amount: newPos.amount,
                main_entry_id: mainPosition.entryId,
                correlationId: newPos.correlationId,
                timeframe: mainPosition.signalTf || '5m',
                events: [{
                    timestamp: newPos.entryTime,
                    action: `防爆对冲开仓 (${side})`,
                    price: executionPrice,
                    amount: newPos.amount,
                    reason: reason || '对冲策略触发'
                }]
            });
        }

        // Automated hedge open log is isolated in background logs

        // Add sub-event to main log
        this.addTradeEvent(mainPosition, `原仓位`, executionPrice, newPos.amount, reason || '对冲策略触发');

        // Voice announcement for simulated hedge
        const cleanSym = mainPosition.symbol.replace('USDT', '');
        const sideName = mainPosition.side === 'LONG' ? '多' : '空';
        const isSecondary = reason && (reason.includes('二次') || reason.includes('Secondary') || reason.includes('2'));
        const speechText = `${cleanSym}${sideName}方向${isSecondary ? '二次' : ''}对冲已开启`;
        audioService.speak(speechText, true);

        // Do not display in system logs as per user request, but log to console for development
        console.log(`[Hedge] 🛡️ 对冲触发: 为 ${mainPosition.symbol} ${mainPosition.side} 开启反向对冲 ${side} (${reason || '未知原因'})`);
        this.emitUpdate(true);
    }

    public closePosition(symbol: string, side: PositionSide, reason: string, entryId?: string) {
        const pos = entryId 
            ? this.positions.find(p => p.entryId === entryId)
            : this.positions.find(p => p.symbol === symbol && p.side === side);
        if (pos) {
            pos.isBeingClosed = true;
            if (this.settings?.system?.realTrading && this.onRealClose) {
                this.onRealClose(pos, reason);
                this.recordTradeLog(pos, reason);
                // Filter out immediately locally to avoid double-triggering before sync
                this.positions = this.positions.filter(p => p.entryId !== pos.entryId);
                this.cleanAmputatedPositionsForSymbol(pos.symbol);
                this.emitUpdate(true);
                return;
            }

            // Do not reset the main position's isHedged flag when closing the hedge position
            // so that the main position remains marked as 'Original position' and can still trigger rescues.

            // Do not automatically close the hedge position when the main position is closed,
            // so that the remaining hedge position stays active and continues callback/profit take rules.

            // Record trade log and filter out the closed position
            this.recordTradeLog(pos, reason);
            this.positions = this.positions.filter(p => p.entryId !== pos.entryId);
            this.cleanAmputatedPositionsForSymbol(pos.symbol);

            // Voice announcement for simulated close
            const cleanSym = pos.symbol.replace('USDT', '');
            if (pos.isHedged && pos.mainPositionId) {
                audioService.speak(`${cleanSym}对冲单已平仓`, true);
            } else {
                const sideName = pos.side === 'LONG' ? '多' : '空';
                audioService.speak(`${cleanSym}${sideName}方向已平仓`, true);
            }

            this.cooldowns[`${pos.symbol}_${pos.side}`] = Date.now() + 60000;
            this.saveCooldowns();
            this.addLog('INFO', `Closed Position on ${pos.symbol}: ${reason}`);
            this.emitUpdate(true);
        }
    }

    public closePair(mainId: string, hedgeId: string, reason: string) {
        const main = this.positions.find(p => p.entryId === mainId);
        const hedge = hedgeId ? this.positions.find(p => p.entryId === hedgeId) : undefined;
        const isAmputationProfitExit = reason.includes('断臂') || reason.toLowerCase().includes('amputation');
        
        if (main) {
            main.isBeingClosed = true;
            if (hedge) {
                hedge.isBeingClosed = true;
            }

            // Record initial profitability states BEFORE closing positions
            const isHedgeProfitable = hedge ? (hedge.unrealizedPnL || 0) > 0 : false;
            const isMainProfitable = (main.unrealizedPnL || 0) > 0;

            // Real-trading close dispatch
            if (this.settings?.system?.realTrading && this.onRealClose) {
                if (isAmputationProfitExit) {
                    const positionsToClose = this.positions.filter(p => p.symbol === main.symbol);
                    for (const p of positionsToClose) {
                        this.onRealClose(p, reason + ' (断臂全清)');
                    }
                } else {
                    if (hedge) {
                        this.onRealClose(hedge, reason);
                    }
                    this.onRealClose(main, reason);
                }
            }

            // Close positions: Clean up positions
            if (isAmputationProfitExit) {
                // Clear ALL positions for this symbol if Amputation
                const positionsToClose = this.positions.filter(p => p.symbol === main.symbol);
                for (const p of positionsToClose) {
                    this.recordTradeLog(p, reason + ' (断臂全清)');
                }
                this.positions = this.positions.filter(p => p.symbol !== main.symbol);
                this.addLog('INFO', `[断臂全清] 已清除所有 ${main.symbol} 相关仓位: ${reason}`);
                this.cooldowns[`${main.symbol}_${main.side}`] = Date.now() + 60000;
                this.saveCooldowns();
            } else {
                // Close positions: Clean up both main and hedge positions cleanly from state
                if (hedge) {
                    this.recordTradeLog(hedge, reason);
                    this.positions = this.positions.filter(p => p.entryId !== hedge.entryId);
                    this.cooldowns[`${hedge.symbol}_${hedge.side}`] = Date.now() + 60000;
                    this.addLog('INFO', `Closed Hedge ${hedge.side} on ${hedge.symbol}: ${reason}`);
                }
                
                this.recordTradeLog(main, reason);
                this.positions = this.positions.filter(p => p.entryId !== main.entryId);
                this.cooldowns[`${main.symbol}_${main.side}`] = Date.now() + 60000;
                this.saveCooldowns();
                this.addLog('INFO', `Closed Main ${main.side} on ${main.symbol}: ${reason}`);
            }

            this.cleanAmputatedPositionsForSymbol(main.symbol);

            // Voice announcement for simulated closePair
            const cleanSym = main.symbol.replace('USDT', '');
            if (isAmputationProfitExit) {
                audioService.speak(`${cleanSym}断臂求生清仓成功`, true);
            } else {
                audioService.speak(`${cleanSym}对冲盈利解套清仓成功`, true);
            }

            this.addLog('INFO', `[调试] 当前剩余仓位数量: ${this.positions.length}`);

            // -------------------------------------------------------------
            // 🔒 [原仓位完全复开核心铁律 (防重复开仓绝对防线)]
            // 必须且仅在防爆对冲开启、【对冲仓位盈利解套】（对冲浮盈覆盖总亏损）平仓出局且仓位已清空的条件下，才允许将原仓位复开！
            // 原主仓自身盈利（isMainProfitable）或对冲未盈利时，绝对严禁触发任何形式的复开！
            // -------------------------------------------------------------
            if (isHedgeProfitable && !isMainProfitable) {
                if (isAmputationProfitExit && this.settings.stopLoss.amputationReopenEnabled) {
                    this.addLog('INFO', `🔄 [断臂完全复开触发] 对冲仓位盈利解套且账户仓位已全部清空。执行原仓位初始开仓数量和方向的完全复开。`);
                    this.reopenPosition(main, `断臂求生对冲仓盈利解套自动复开`);
                }
            } else {
                if (isMainProfitable) {
                    this.addLog('INFO', `ℹ️ [复开跳过] 原仓位自身盈利解套，已交给「只清对冲、主仓续航」或常规平仓管理，不执行原仓位完全复开`);
                } else {
                    this.addLog('INFO', `ℹ️ [复开跳过] 未满足【对冲仓位盈利解套】的前提条件，不执行原仓位完全复开`);
                }
            }

            this.emitUpdate(true);
        }
    }

    public reopenPosition(pos: Position, reason: string) {
        this.addLog('INFO', `[调试] 进入 reopenPosition: ${pos.symbol} ${pos.side} reason: ${reason}`);
        const symbolKey = normalizeSymbol(pos.symbol);
        const throttleKey = `${symbolKey}_${pos.side}`;
        const now = Date.now();

        // 1. Cooldown / Throttle check: Prevent multiple reopens in the same second (1000ms)
        if (this.lastReopenTimes[throttleKey] && now - this.lastReopenTimes[throttleKey] < 1000) {
            this.addLog('WARNING', `⚠️ [原仓位复开] 拦截: ${pos.symbol} ${pos.side} 复开频率过高 (1秒内禁止重复复开)`);
            return;
        }

        // 2. Max Reopen Count & Fuse Check (统一震荡磨损熔断检查)
        const maxReopen = this.settings.stopLoss?.maxReopenCount ?? 3;
        const nextReopenCount = (pos.reopenCount || 0) + 1;
        const currentRefillCount = pos.refillCount || 0;
        const fuseEnabled = this.settings?.stopLoss?.fuseEnabled;
        const maxRetries = this.settings?.stopLoss?.maxHedgeRetries || 3;

        if (pos.isOscillationLocked || (fuseEnabled && currentRefillCount >= maxRetries)) {
            this.addLog('WARNING', `⚠️ [原仓位复开] 拦截: ${pos.symbol} ${pos.side} 已触发震荡磨损保护熔断 (累计补仓/复开已达${currentRefillCount}次)，停止自动复开！`);
            return;
        }

        if (nextReopenCount > maxReopen) {
            this.addLog('WARNING', `⚠️ [原仓位复开] 拦截: ${pos.symbol} ${pos.side} 复开次数 (${nextReopenCount}) 超过最大限制 (${maxReopen})`);
            return;
        }

        const nextTotalRefill = currentRefillCount + 1;
        this.lastReopenTimes[throttleKey] = now;

        // 根据 Option A（选项 A）：
        // 初始的 USDT 本金金额（如 100 U）保持完全一致，币数根据当前最新价格重新计算。
        // 原仓位第一次开仓的币数 * 原仓位第一次开仓的价格 = 初始的 USDT 本金金额
        const originalInitialQty = pos.initialAmount !== undefined ? pos.initialAmount : (pos.amount + (pos.amputatedAmount || 0));
        const originalEntryPrice = pos.entryPrice || pos.markPrice;
        const initialUsdtCost = originalInitialQty * originalEntryPrice;

        const corrId = pos.correlationId || nextReopenCount;

        const extraProps: Partial<Position> = {
            isReopened: true,
            reopenCount: nextReopenCount,
            refillCount: nextTotalRefill,
            correlationId: corrId,
            parentEntryId: pos.entryId
        };

        // 检查复开后是否达到熔断上限
        if (fuseEnabled && nextTotalRefill >= maxRetries) {
            extraProps.isOscillationLocked = true;
            const mode = this.settings?.stopLoss?.fuseActionMode || 'MANUAL';
            const alertEnabled = this.settings?.stopLoss?.fuseAlertEnabled !== false;
            const displaySym = pos.symbol.replace('USDT', '');

            if (mode === 'AUTO_CLOSE') {
                if (alertEnabled) {
                    audioService.speakRepeatedly(`${displaySym}防爆对冲已经达到${nextTotalRefill}次补仓，已自动清仓止损`, 3, 1800);
                }
                this.addLog('WARNING', `🛡️ [震荡磨损熔断] ${pos.symbol} 对冲解套复开累计达到上限(${nextTotalRefill}次)，模式为【自动清仓止损】，正在市价全平该币仓位！`);
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('savior_fuse_alert', {
                        detail: { symbol: pos.symbol, count: nextTotalRefill, mode: 'AUTO_CLOSE' }
                    }));
                }
                setTimeout(() => {
                    this.closeAllPositionsForSymbol(pos.symbol, `震荡磨损熔断自动清仓止损 (累计补仓/复开达${nextTotalRefill}次)`);
                }, 400);
            } else {
                if (alertEnabled) {
                    audioService.speakRepeatedly(`${displaySym}防爆对冲已经达到${nextTotalRefill}次补仓，请人工尽快处理`, 3, 1800);
                }
                this.addLog('WARNING', `🛡️ [震荡磨损熔断] ${pos.symbol} 对冲解套复开累计达到上限(${nextTotalRefill}次)，模式为【人工介入处理】，已停止后续自动砍仓与复开！`);
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('savior_fuse_alert', {
                        detail: { symbol: pos.symbol, count: nextTotalRefill, mode: 'MANUAL' }
                    }));
                }
            }
        }

        if (this.settings?.system?.realTrading && this.onRealReopen) {
            this.registerPendingRealOpenProps(pos.symbol, pos.side, extraProps);
            this.addLog('INFO', `⚡ [实盘自动复开触发] 正在向币安发送原仓位复开指令: ${pos.symbol} ${pos.side} | 原始USDT本金: ${initialUsdtCost.toFixed(2)}U | 原因: ${reason}`);
            this.onRealReopen(pos.symbol, pos.side, initialUsdtCost, reason, extraProps);
            return;
        }

        // 调用 openPosition，不传入额外的 amount 和 initialAmount 覆盖属性，
        // 这样 openPosition 会基于 initialUsdtCost 自动根据当前最新执行价格（executionPrice）计算出全新的币数并将其作为 amount 与 initialAmount 存入新仓位。
        this.openPosition(
            pos.symbol, 
            pos.side, 
            initialUsdtCost, 
            pos.markPrice, 
            pos.signalTf || '1m', 
            undefined, 
            undefined, 
            extraProps
        );
        this.addLog('SUCCESS', `🔄 [原仓位复开] 已开启独立复开仓位: ${pos.symbol} ${pos.side} | 原始USDT本金: ${initialUsdtCost.toFixed(2)}U | 原因: ${reason} | 复开次数: ${nextReopenCount}`);
        
        // Voice announcement for simulated reopen
        const cleanSym = pos.symbol.replace('USDT', '');
        audioService.speak(`${cleanSym}对冲仓盈利解套，主仓位已自动复开`, true);

        this.emitUpdate(true);
    }

    public amputate(position: Position, ratio: number, reason: string) {
        const cleanSym = normalizeSymbol(position.symbol);

        // 🔒 [断臂求生双边等额绝对硬锁] 
        // 铁律：必须处于双边等额对冲状态才允许发起砍仓！只要两边数量不对等（说明前次砍仓未补回），严禁连续砍仓！
        const opposingPos = this.positions.find(p => normalizeSymbol(p.symbol) === cleanSym && p.side !== position.side);
        if (!opposingPos || Math.abs(position.amount - opposingPos.amount) > Math.max(position.amount, opposingPos.amount) * 0.05) {
            console.warn(`[Amputation Lock] 🛡️ 拦截二次砍仓: ${position.symbol} ${position.side} 与对手仓位数量不对等 (当前:${position.amount.toFixed(4)} vs 对手:${opposingPos?.amount.toFixed(4) || 0})，必须等回踩补仓恢复等额后方可再次砍仓！`);
            return;
        }

        // 🔒 [震荡磨损保护熔断机制] 检查当前币种熔断状态与循环次数
        const currentAmpCount = position.amputationCount || 0;
        const currentRefillCount = position.refillCount || 0;
        const maxRetries = this.settings?.stopLoss?.maxHedgeRetries || 3;
        if (position.isOscillationLocked || (this.settings?.stopLoss?.fuseEnabled && (currentAmpCount >= maxRetries || currentRefillCount >= maxRetries))) {
            console.warn(`[Amputation Fuse] 🛡️ 震荡磨损保护熔断拦截: ${position.symbol} 已触发熔断(补仓${currentRefillCount}次/砍仓${currentAmpCount}次)，停止继续砍仓！`);
            return;
        }

        // 🔒 [断臂求生防重复砍仓安全锁] 8秒内不允许对同一仓位进行二次砍仓，留足币安执行与API同步时间
        const now = Date.now();
        const lastAmp = position.lastAmputationTime || 0;
        if (now - lastAmp < 8000) {
            console.warn(`[Amputation Cooldown] 🛡️ 拦截重复砍仓触发: ${position.symbol} ${position.side} 处于8秒冷却中(上次砍仓: ${now - lastAmp}ms前)`);
            return;
        }

        const cutAmount = position.amount * (ratio / 100);

        if (this.settings?.system?.realTrading) {
            // 🔒【实盘绝对零虚假铁律】在实盘模式下，严禁提前修改 position.isAmputated、amputatedAmount、amputationCount 等状态！
            // 仅记录在途触发时间戳防止短时间重复提交，一切持仓扣减、标记与负债记录严格等待 handleRealAmputationSuccess 收到币安真实成功回执后执行！
            position.lastAmputationTime = now;
            if (this.onRealClose) {
                this.onRealClose(position, reason, cutAmount, ratio);
            }
            return;
        }
        
        position.lastAmputationTime = now;
        this.amputatedSymbolsInCycle.add(cleanSym);
        
        // 模拟模式下立即同步标记已砍仓与被砍数量
        position.isAmputated = true;
        position.isHedged = true;
        position.amputatedAmount = (position.amputatedAmount || 0) + cutAmount;
        position.amputationCount = currentAmpCount + 1;
        if (opposingPos) {
            opposingPos.amputationCount = position.amputationCount;
            opposingPos.isHedged = true;
        }
        
        // 记录砍仓的实际盈亏
        const realizedPnL = position.unrealizedPnL * (ratio / 100);
        
        position.amount -= cutAmount;
        if (position.amount <= 0.0001) {
            position.amount = 0;
            position.isAmputatedToZero = true;
        }
        
        if (realizedPnL < 0) {
            position.cumulativeAmputationLoss = (position.cumulativeAmputationLoss || 0) + Math.abs(realizedPnL);
            // 🔒 [单币负债继承] 如果存在对冲对手单（存活仓位），立即将本次砍仓亏损负债同步继承给对手单
            if (opposingPos) {
                opposingPos.cumulativeAmputationLoss = (opposingPos.cumulativeAmputationLoss || 0) + Math.abs(realizedPnL);
            }
        } else {
            position.cumulativeAmputationProfit = (position.cumulativeAmputationProfit || 0) + realizedPnL;
            if (opposingPos) {
                opposingPos.cumulativeAmputationProfit = (opposingPos.cumulativeAmputationProfit || 0) + realizedPnL;
            }
        }
        
        // now is already declared at the top of amputate method
        const isStopLoss = realizedPnL < 0;
        const wasEverHedged = position.isHedged || (position.hedgeRetries || 0) > 0 || !!position.mainPositionId || (position.cumulativeHedgeLoss || 0) > 0 || (position.cumulativeHedgeProfit || 0) > 0;

        // 🔒 [止损砍仓独立记录流水铁律]
        const cutCostUsdt = cutAmount * position.entryPrice;
        const cutLogEntry: TradeLog = {
            symbol: position.symbol,
            entry_id: `${position.entryId || position.symbol}_cut_${now}`,
            parent_entry_id: position.entryId,
            status: 'CLOSED',
            profit_usdt: realizedPnL,
            profit_percent: position.unrealizedPnLPercentage || 0,
            exit_reason: reason || `止损砍仓 (${ratio}%)`,
            is_hedge: true,
            entry_timestamp: position.entryTime || now,
            exit_timestamp: now,
            direction: position.side,
            cost_usdt: cutCostUsdt,
            entry_price: position.entryPrice,
            exit_price: position.markPrice || position.entryPrice,
            current_amount: cutAmount,
            timeframe: (position as any).timeframe
        };
        this.tradeLogs.unshift(cutLogEntry);

        // 🔒 原仓位的开仓价值即时扣减为留存金额
        const parentOpenLog = this.tradeLogs.find(l => (l.entry_id === position.entryId || (normalizeSymbol(l.symbol) === cleanSym && l.direction === position.side)) && l.status === 'OPEN');
        if (parentOpenLog) {
            parentOpenLog.cost_usdt = Math.max(0, parentOpenLog.cost_usdt - cutCostUsdt);
            parentOpenLog.current_amount = position.amount;
        }

        // Add sub-event to main log
        this.addTradeEvent(position, `止损砍仓 (${ratio}%)`, position.markPrice, cutAmount, reason, realizedPnL);

        // 真实扣除或增加账户余额
        this.account.marginBalance += realizedPnL;
        this.account.totalBalance = this.account.marginBalance;
        
        if (realizedPnL >= 0) {
            this.addLog('SUCCESS', `💰 部分止盈: ${position.symbol} ${position.side} 减仓 ${ratio}% | 实现盈利: +${realizedPnL.toFixed(2)} | ${reason}`);
        } else {
            this.addLog('WARNING', `✂️ 部分止损: ${position.symbol} ${position.side} 减仓 ${ratio}% | 实现亏损: ${realizedPnL.toFixed(2)} | ${reason}`);
        }
        this.emitUpdate(true);
    }

    public handleRealAmputationSuccess(
        symbol: string, 
        side: PositionSide, 
        cutAmount: number, 
        ratio: number, 
        reason: string, 
        realizedPnL: number,
        execData?: { orderId?: string | number, price?: number, qty?: number, realizedPnl?: number }
    ) {
        const cleanSym = normalizeSymbol(symbol);
        this.amputatedSymbolsInCycle.add(cleanSym);
        const position = this.positions.find(p => normalizeSymbol(p.symbol) === cleanSym && p.side === side);
        if (!position) return;

        const now = Date.now();
        if (execData?.orderId) {
            this.registerExecutedOrderId(execData.orderId);
        }
        position.lastAmputationTime = now;
        position.isAmputated = true;
        position.isHedged = true;
        const currentAmpCount = position.amputationCount || 0;
        position.amputationCount = currentAmpCount + 1;
        const opposingPos = this.positions.find(p => normalizeSymbol(p.symbol) === cleanSym && p.side !== side);
        if (opposingPos) {
            opposingPos.amputationCount = position.amputationCount;
            opposingPos.isHedged = true;
        }
        
        position.amount = Math.max(0, position.amount - cutAmount);
        if (position.amount <= 0.0001) {
            position.amount = 0;
            position.isAmputatedToZero = true;
        }
        position.amputatedAmount = (position.amputatedAmount || 0) + cutAmount;

        if (realizedPnL < 0) {
            position.cumulativeAmputationLoss = (position.cumulativeAmputationLoss || 0) + Math.abs(realizedPnL);
            // 🔒 [单币负债继承] 如果存在对冲对手单（存活仓位），立即将本次砍仓亏损负债同步继承给对手单，确保砍仓后负债不随仓位归零而丢失
            if (opposingPos) {
                opposingPos.cumulativeAmputationLoss = (opposingPos.cumulativeAmputationLoss || 0) + Math.abs(realizedPnL);
            }
        } else {
            position.cumulativeAmputationProfit = (position.cumulativeAmputationProfit || 0) + realizedPnL;
            if (opposingPos) {
                opposingPos.cumulativeAmputationProfit = (opposingPos.cumulativeAmputationProfit || 0) + realizedPnL;
            }
        }

        const isStopLoss = realizedPnL < 0;
        const wasEverHedged = position.isHedged || (position.hedgeRetries || 0) > 0 || !!position.mainPositionId || (position.cumulativeHedgeLoss || 0) > 0 || (position.cumulativeHedgeProfit || 0) > 0;

        // 🔒 [实盘独立记录止损砍仓流水铁律]
        const cutCostUsdt = cutAmount * position.entryPrice;
        const cutLogEntry: TradeLog = {
            symbol: position.symbol,
            entry_id: `${position.entryId || position.symbol}_cut_${now}`,
            binance_order_id: execData?.orderId ? String(execData.orderId) : undefined,
            parent_entry_id: position.entryId,
            status: 'CLOSED',
            profit_usdt: realizedPnL,
            profit_percent: position.unrealizedPnLPercentage || 0,
            exit_reason: reason || `防爆对冲砍仓 (${ratio}%)`,
            is_hedge: true,
            entry_timestamp: position.entryTime || now,
            exit_timestamp: now,
            direction: position.side,
            cost_usdt: cutCostUsdt,
            entry_price: position.entryPrice,
            exit_price: execData?.price || position.markPrice || position.entryPrice,
            current_amount: cutAmount,
            timeframe: (position as any).timeframe
        };
        this.tradeLogs.unshift(cutLogEntry);

        // 🔒 原仓位的开仓价值即时扣减为留存金额
        const parentOpenLog = this.tradeLogs.find(l => (l.entry_id === position.entryId || (normalizeSymbol(l.symbol) === cleanSym && l.direction === position.side)) && l.status === 'OPEN');
        if (parentOpenLog) {
            parentOpenLog.cost_usdt = Math.max(0, parentOpenLog.cost_usdt - cutCostUsdt);
            parentOpenLog.current_amount = position.amount;
        }

        // Add sub-event to main log
        this.addTradeEvent(position, `防爆对冲砍仓 (${ratio}%)`, position.markPrice || position.entryPrice, cutAmount, reason, realizedPnL);

        // 真实扣除或增加账户余额
        this.account.marginBalance += realizedPnL;
        this.account.totalBalance = this.account.marginBalance;
        
        if (realizedPnL >= 0) {
            this.addLog('SUCCESS', `💰 [实盘部分止盈成功] ${position.symbol} ${position.side} 减仓 ${ratio}% | 实现盈利: +${realizedPnL.toFixed(2)} | ${reason}`);
        } else {
            this.addLog('WARNING', `✂️ [实盘部分止损成功] ${position.symbol} ${position.side} 减仓 ${ratio}% | 实现亏损: ${realizedPnL.toFixed(2)} | ${reason}`);
        }
        this.emitUpdate(true);
    }

    public refill(position: Position, reason: string) {
        if (!this.isNetworkHealthy) {
            this.addLog('WARNING', `网络异常拦截: 拒绝补仓 ${position.symbol} ${position.side}`);
            return;
        }

        // 🛡️ [Hedge State Lock for Refill]
        const upperSymbol = position.symbol.toUpperCase();
        const oppositePos = this.positions.find(p => 
            p.symbol.toUpperCase() === upperSymbol && 
            p.side !== position.side && 
            p.amount > 0
        );

        const isRescueRefill = reason.includes('断臂') || reason.includes('求生');

        // 🔒 [有效对冲绝对禁补铁律]：当原仓位与对冲仓位数量一样多时（处于有效等额对冲），非断臂救世补仓绝对严禁补仓！
        if (oppositePos && !isRescueRefill && Math.abs(position.amount - oppositePos.amount) <= Math.max(position.amount, oppositePos.amount) * 0.05) {
            this.addLog('WARNING', `🛡️ [有效对冲禁补] ${position.symbol} 原仓位与对冲仓位数量一致(${position.amount.toFixed(4)})处于有效对冲状态，安全铁律拦截，绝对严禁补仓！`);
            return;
        }

        if (oppositePos && !isRescueRefill) {
            this.addLog('WARNING', `🛡️ [对冲补仓拦截] ${position.symbol} 处于双向持仓对冲状态，安全锁已激活，拒绝自动补仓！只有等断臂砍仓/平对冲之后才能补仓。`);
            return;
        }

        // 🔒 [精确补仓铁律] 严格读取该仓位被砍掉的实际数量，绝对严禁通过数量差推导虚假补仓
        const refillAmount = position.amputatedAmount || 0;
        if (refillAmount <= 0) {
            return;
        }

        const cleanSym = normalizeSymbol(position.symbol);
        const lockKey = `${cleanSym}_${position.side}`;

        // 🔒 [震荡磨损保护熔断机制 Strategy 5] 熔断锁检测
        const fuseEnabled = this.settings?.stopLoss?.fuseEnabled;
        const maxRetries = this.settings?.stopLoss?.maxHedgeRetries || 3;
        const currentRefillCount = position.refillCount || 0;
        if (position.isOscillationLocked || (fuseEnabled && currentRefillCount >= maxRetries)) {
            console.warn(`[Refill Locked] 🛡️ 拦截补仓: ${position.symbol} ${position.side} 已处于震荡磨损熔断锁定状态(补仓次数: ${currentRefillCount}/${maxRetries})`);
            return;
        }

        // 🔒 [第一层：在途并发硬锁] 防止网络请求耗时期间行情毫秒级跳动造成瞬间几十次重复提交
        if (this.inFlightRefillPool.has(lockKey)) {
            console.warn(`[Refill In-Flight] 🛡️ 拦截重复补仓: ${position.symbol} ${position.side} 补仓正在在途处理中，严禁重复提交！`);
            return;
        }

        // 🔒 [第一层：10秒硬冷却防抖锁] 读取独立时间戳字典，彻底杜绝对象刷新重置
        const now = Date.now();
        const lastRefill = Math.max(
            position.lastRefillTime || 0,
            this.lastRefillTimestampMap.get(lockKey) || 0
        );
        if (now - lastRefill < 10000) {
            console.warn(`[Refill Cooldown] 🛡️ 拦截重复补仓触发: ${position.symbol} ${position.side} 处于10秒硬冷却中(上次补仓: ${now - lastRefill}ms前)`);
            return;
        }

        if (this.settings?.system?.realTrading) {
            // 🔒【实盘绝对零虚假铁律】在实盘模式下，严禁提前清空 position.isAmputated、amputatedAmount！
            // 立即加上在途锁与持久时间戳，一切持仓增加、标记清空与流水记录严格等待 handleRealRefillSuccess 收到币安真实成功回执后执行！
            this.inFlightRefillPool.add(lockKey);
            this.lastRefillTimestampMap.set(lockKey, now);
            position.lastRefillTime = now;

            // 5秒安全超时防死锁（防止前端网络死锁或未正确返回回执）
            setTimeout(() => {
                this.inFlightRefillPool.delete(lockKey);
            }, 6000);

            if (this.onRealOpen) {
                this.onRealOpen(position, refillAmount, reason);
            }
            return;
        }

        // 模拟模式下同步记录时间戳
        this.lastRefillTimestampMap.set(lockKey, now);
        position.lastRefillTime = now;

        // 🔒 [只补一次防重锁] 仅在模拟模式下立即清空被砍记录与待补仓数量，杜绝重复补仓
        position.isAmputated = false;
        position.amputatedAmount = 0;
        this.amputatedSymbolsInCycle.delete(normalizeSymbol(position.symbol));
        delete (position as any)._slTriggered;
        
        // Calculate new average entry price
        const currentTotalValue = position.amount * position.entryPrice;
        const refillValue = refillAmount * position.markPrice;
        const newTotalAmount = position.amount + refillAmount;
        const newEntryPrice = (currentTotalValue + refillValue) / newTotalAmount;
        
        position.entryPrice = newEntryPrice;
        position.amount = newTotalAmount;
        
        const wasEverHedged = position.isHedged || (position.hedgeRetries || 0) > 0 || !!position.mainPositionId || (position.cumulativeHedgeLoss || 0) > 0 || (position.cumulativeHedgeProfit || 0) > 0;

        // 🔒 [回踩补仓恢复开仓价值]
        const parentOpenLog = this.tradeLogs.find(l => (l.entry_id === position.entryId || (normalizeSymbol(l.symbol) === cleanSym && l.direction === position.side)) && l.status === 'OPEN');
        if (parentOpenLog) {
            parentOpenLog.cost_usdt = (parentOpenLog.cost_usdt || 0) + (refillAmount * position.entryPrice);
            parentOpenLog.current_amount = position.amount;
        }

        // Add sub-event to main log
        this.addTradeEvent(position, '防爆对冲补仓', position.markPrice, refillAmount, reason);

        // 🔒 [实盘独立记录防爆对冲补仓流水铁律]
        const refillCostUsdt = refillAmount * (position.markPrice || position.entryPrice);
        const refillLogEntry: TradeLog = {
            symbol: position.symbol,
            entry_id: `${position.entryId || position.symbol}_refill_${now}`,
            parent_entry_id: position.entryId,
            status: 'OPEN',
            is_hedge: true,
            entry_timestamp: now,
            direction: position.side,
            cost_usdt: refillCostUsdt,
            entry_price: position.markPrice || position.entryPrice,
            current_amount: refillAmount,
            timeframe: (position as any).timeframe,
            exit_reason: `防爆对冲补仓 (${reason || '回踩补回'})`,
            events: [{
                timestamp: now,
                action: '防爆对冲补仓',
                price: position.markPrice || position.entryPrice,
                amount: refillAmount,
                reason: reason || '回踩补回'
            }]
        };
        this.tradeLogs.unshift(refillLogEntry);

        // 重置砍仓记录，但保留历史亏损记录用于算总账
        position.isAmputated = false;
        position.amputatedAmount = 0;
        this.amputatedSymbolsInCycle.delete(normalizeSymbol(position.symbol));
        // 重置止损标记，允许再次触发止损
        delete (position as any)._slTriggered;

        // 🔒 [震荡磨损熔断统计] 累计补仓次数与双向同步
        const opposingPos = this.positions.find(p => normalizeSymbol(p.symbol) === cleanSym && p.side !== position.side);
        const nextRefillCount = Math.max(position.refillCount || 0, opposingPos?.refillCount || 0) + 1;
        position.refillCount = nextRefillCount;
        if (opposingPos) {
            opposingPos.refillCount = nextRefillCount;
        }

        // 🔒 检查震荡磨损熔断机制
        if (fuseEnabled && nextRefillCount >= maxRetries) {
            position.isOscillationLocked = true;
            if (opposingPos) opposingPos.isOscillationLocked = true;

            const mode = this.settings?.stopLoss?.fuseActionMode || 'MANUAL';
            const alertEnabled = this.settings?.stopLoss?.fuseAlertEnabled !== false;
            const displaySym = position.symbol.replace('USDT', '');

            if (mode === 'AUTO_CLOSE') {
                if (alertEnabled) {
                    audioService.speakRepeatedly(`${displaySym}防爆对冲已经达到${nextRefillCount}次补仓，已自动清仓止损`, 3, 1800);
                }
                this.addLog('WARNING', `🛡️ [震荡磨损熔断] ${position.symbol} 补仓达到上限(${nextRefillCount}次)，模式为【自动清仓止损】，正在市价全平该币双向仓位！`);
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('savior_fuse_alert', {
                        detail: { symbol: position.symbol, count: nextRefillCount, mode: 'AUTO_CLOSE' }
                    }));
                }
                setTimeout(() => {
                    this.closeAllPositionsForSymbol(position.symbol, `震荡磨损熔断自动清仓止损 (补仓已达${nextRefillCount}次)`);
                }, 400);
            } else {
                if (alertEnabled) {
                    audioService.speakRepeatedly(`${displaySym}防爆对冲已经达到${nextRefillCount}次补仓，请人工尽快处理`, 3, 1800);
                }
                this.addLog('WARNING', `🛡️ [震荡磨损熔断] ${position.symbol} 补仓达到上限(${nextRefillCount}次)，模式为【人工介入处理】，已停止自动砍仓与补仓，等待人工处理！`);
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('savior_fuse_alert', {
                        detail: { symbol: position.symbol, count: nextRefillCount, mode: 'MANUAL' }
                    }));
                }
            }
        }
        
        this.addLog('INFO', `🔄 补回仓位: ${position.symbol} ${position.side} 补回 ${refillAmount.toFixed(4)} (累计第${nextRefillCount}次补仓) | 新均价: ${newEntryPrice.toFixed(4)} | ${reason}`);
        this.emitUpdate(true);
    }

    /**
     * 实盘补仓成功回调
     */
    public handleRealRefillSuccess(symbol: string, side: PositionSide, refillAmount: number, reason: string) {
        const cleanSym = normalizeSymbol(symbol);
        const lockKey = `${cleanSym}_${side}`;
        this.inFlightRefillPool.delete(lockKey);
        const successNow = Date.now();
        this.lastRefillTimestampMap.set(lockKey, successNow);

        const position = this.positions.find(p => normalizeSymbol(p.symbol) === cleanSym && p.side === side);
        const opposingPos = this.positions.find(p => normalizeSymbol(p.symbol) === cleanSym && p.side !== side);
        
        const nextRefillCount = Math.max(position?.refillCount || 0, opposingPos?.refillCount || 0) + 1;
        
        if (position) {
            position.lastRefillTime = successNow;
            position.isAmputated = false;
            position.amputatedAmount = 0;
            position.refillCount = nextRefillCount;
            position.amount += refillAmount;
            delete (position as any)._slTriggered;

            // 🔒 [实盘回踩补仓恢复开仓价值]
            const parentOpenLog = this.tradeLogs.find(l => (l.entry_id === position.entryId || (normalizeSymbol(l.symbol) === cleanSym && l.direction === side)) && l.status === 'OPEN');
            if (parentOpenLog) {
                parentOpenLog.cost_usdt = (parentOpenLog.cost_usdt || 0) + (refillAmount * position.entryPrice);
                parentOpenLog.current_amount = position.amount;
            }

            // 🔒 [实盘独立记录防爆对冲补仓流水铁律]
            const now = Date.now();
            const refillCostUsdt = refillAmount * (position.markPrice || position.entryPrice);
            const refillLogEntry: TradeLog = {
                symbol: symbol,
                entry_id: `${position.entryId || symbol}_refill_${now}`,
                parent_entry_id: position.entryId,
                status: 'OPEN',
                is_hedge: true,
                entry_timestamp: now,
                direction: side,
                cost_usdt: refillCostUsdt,
                entry_price: position.markPrice || position.entryPrice,
                current_amount: refillAmount,
                timeframe: (position as any).timeframe,
                exit_reason: `防爆对冲补仓 (${reason || '实盘回踩补回'})`,
                events: [{
                    timestamp: now,
                    action: '防爆对冲补仓',
                    price: position.markPrice || position.entryPrice,
                    amount: refillAmount,
                    reason: reason || '实盘回踩补回'
                }]
            };
            this.tradeLogs.unshift(refillLogEntry);
            this.addTradeEvent(position, '防爆对冲补仓', position.markPrice || position.entryPrice, refillAmount, reason);
        }
        if (opposingPos) {
            opposingPos.refillCount = nextRefillCount;
        }
        this.amputatedSymbolsInCycle.delete(cleanSym);

        const fuseEnabled = this.settings?.stopLoss?.fuseEnabled;
        const maxRetries = this.settings?.stopLoss?.maxHedgeRetries || 3;

        if (fuseEnabled && nextRefillCount >= maxRetries) {
            if (position) position.isOscillationLocked = true;
            if (opposingPos) opposingPos.isOscillationLocked = true;

            const mode = this.settings?.stopLoss?.fuseActionMode || 'MANUAL';
            const alertEnabled = this.settings?.stopLoss?.fuseAlertEnabled !== false;
            const displaySym = symbol.replace('USDT', '');

            if (mode === 'AUTO_CLOSE') {
                if (alertEnabled) {
                    audioService.speakRepeatedly(`${displaySym}防爆对冲已经达到${nextRefillCount}次补仓，已自动清仓止损`, 3, 1800);
                }
                this.addLog('WARNING', `🛡️ [震荡磨损熔断] ${symbol} 实盘补仓达到上限(${nextRefillCount}次)，模式为【自动清仓止损】，正在市价全平该币双向仓位！`);
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('savior_fuse_alert', {
                        detail: { symbol: symbol, count: nextRefillCount, mode: 'AUTO_CLOSE' }
                    }));
                }
                setTimeout(() => {
                    this.closeAllPositionsForSymbol(symbol, `震荡磨损熔断自动清仓止损 (补仓已达${nextRefillCount}次)`);
                }, 400);
            } else {
                if (alertEnabled) {
                    audioService.speakRepeatedly(`${displaySym}防爆对冲已经达到${nextRefillCount}次补仓，请人工尽快处理`, 3, 1800);
                }
                this.addLog('WARNING', `🛡️ [震荡磨损熔断] ${symbol} 实盘补仓达到上限(${nextRefillCount}次)，模式为【人工介入处理】，已停止自动砍仓与补仓，等待人工处理！`);
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('savior_fuse_alert', {
                        detail: { symbol: symbol, count: nextRefillCount, mode: 'MANUAL' }
                    }));
                }
            }
        }

        this.emitUpdate(true);
    }

    /**
     * 一键全平指定币种的双向全部仓位 (用于熔断自动清仓或人工一键清仓)
     */
    public closeAllPositionsForSymbol(symbol: string, reason: string) {
        const cleanSym = normalizeSymbol(symbol);
        const matchingPositions = this.positions.filter(p => normalizeSymbol(p.symbol) === cleanSym);
        if (matchingPositions.length === 0) return;

        for (const pos of matchingPositions) {
            pos.isBeingClosed = true;
            if (this.settings?.system?.realTrading && this.onRealClose) {
                this.onRealClose(pos, reason);
            }
            this.recordTradeLog(pos, reason);
        }

        this.positions = this.positions.filter(p => normalizeSymbol(p.symbol) !== cleanSym);
        this.cleanAmputatedPositionsForSymbol(symbol);
        this.amputatedSymbolsInCycle.delete(cleanSym);
        this.emitUpdate(true);
    }

    /**
     * 重置指定币种的震荡磨损熔断锁定状态与补仓/砍仓计数
     */
    public resetOscillationLock(symbol: string) {
        const cleanSym = normalizeSymbol(symbol);
        this.positions.forEach(p => {
            if (normalizeSymbol(p.symbol) === cleanSym) {
                p.isOscillationLocked = false;
                p.refillCount = 0;
                p.amputationCount = 0;
                p.hedgeRetries = 0;
            }
        });
        this.amputatedSymbolsInCycle.delete(cleanSym);
        this.addLog('INFO', `🔄 [震荡熔断已解除] ${symbol} 补仓与砍仓计数已重置为0，已恢复自动策略托管。`);
        this.emitUpdate(true);
    }

    public closeHedgeOnly(hedgeId: string, profit: number, reason: string) {
        const hedge = this.positions.find(p => p.entryId === hedgeId);
        if (hedge && hedge.mainPositionId) {
            hedge.isBeingClosed = true;
            const main = this.positions.find(p => p.entryId === hedge.mainPositionId);
            
            if (this.settings?.system?.realTrading && this.onRealClose) {
                this.onRealClose(hedge, reason);
            }

            if (main) {
                if (profit >= 0) {
                    main.cumulativeHedgeProfit = (main.cumulativeHedgeProfit || 0) + profit;
                    main.hedgeRetries = 0; // Reset consecutive failures on success
                } else {
                    main.cumulativeHedgeLoss = (main.cumulativeHedgeLoss || 0) + Math.abs(profit);
                }

                // 转移对冲单在期间通过断臂砍仓已经发生的累计损失（取极大值保全单币池唯一负债）
                if (hedge.cumulativeAmputationLoss) {
                    main.cumulativeAmputationLoss = Math.max(main.cumulativeAmputationLoss || 0, hedge.cumulativeAmputationLoss);
                }
                if (hedge.cumulativeAmputationProfit) {
                    main.cumulativeAmputationProfit = Math.max(main.cumulativeAmputationProfit || 0, hedge.cumulativeAmputationProfit);
                }

                // Do not reset isHedged to false, keep it marked as 'Original position'
                main.isHedged = true;
                
                // 标记对冲单平仓时间戳，启动 30 秒强制冷却
                main.lastHedgeClosedAt = Date.now();
                delete main.hedgeOrderInFlight;
                delete main.hedgeOrderInFlightTime;
                delete main.hedgeSignalTriggered;

                // 记录对冲单期间达到的极限价格，以及平仓时的标记价格，作为下一次必须突破的极值屏障
                const maxPnL = hedge.maxPnLPercent || 0;
                let newExtreme = 0;
                const currentMark = hedge.markPrice || hedge.entryPrice;
                if (hedge.side === PositionSide.SHORT) {
                    // 空对冲单盈利对应的是行情更低价格，极值为对冲期间最低价与当前价的更低者
                    newExtreme = hedge.entryPrice * (1 - maxPnL / 100);
                    const effectiveLowest = Math.min(newExtreme, currentMark);
                    if (main.extremePrice === undefined || effectiveLowest < main.extremePrice) {
                        main.extremePrice = effectiveLowest;
                    }
                } else {
                    // 多对冲单盈利对应的是行情更高价格，极值为对冲期间最高价与当前价的更高者
                    newExtreme = hedge.entryPrice * (1 + maxPnL / 100);
                    const effectiveHighest = Math.max(newExtreme, currentMark);
                    if (main.extremePrice === undefined || effectiveHighest > main.extremePrice) {
                        main.extremePrice = effectiveHighest;
                    }
                }
            }
            this.recordTradeLog(hedge, reason);

            // Add sub-event to main log
            const mainPos = this.positions.find(p => p.entryId === hedge.mainPositionId);
            if (mainPos) {
                this.addTradeEvent(mainPos, profit >= 0 ? '盈利平仓' : '止损平仓', hedge.markPrice, hedge.amount, reason, profit);
            }

            this.positions = this.positions.filter(p => p.entryId !== hedgeId);
            this.cleanAmputatedPositionsForSymbol(hedge.symbol);
            if (profit >= 0) {
                this.addLog('SUCCESS', `🐜 蚂蚁搬家: 对冲单止盈 | ${reason}`);
            } else {
                this.addLog('WARNING', `⚠️ 对冲单止损: ${reason}`);
            }
            this.emitUpdate(true);
        }
    }

    private recordTradeLog(p: Position, reason: string) {
        // 🔒 [拦截空仓/虚假平仓日志] 若该仓位持仓数量已为 0 或已通过防爆对冲砍仓完成结单，严禁再次生成冗余的“止损平仓”日志
        if (!p || p.isAmputatedToZero || p.amount <= 0.00001) {
            return;
        }

        // Keep original OPEN log intact as 'OPEN' with initial entry info permanently.

        // 真实扣除或增加账户余额 (Realize PnL)
        this.account.marginBalance += p.unrealizedPnL;
        this.account.totalBalance = this.account.marginBalance;

        // 🔒 [程序信号日志隔离铁律]：程序自动生成的平仓/清仓信号指令严禁录入交易日志(tradeLogs)
        if (reason !== 'MANUAL' && !reason.includes('手动') && !reason.includes('App平仓')) {
            return;
        }

        const now = Date.now();
        const isStopLoss = reason.includes('止损') || p.unrealizedPnL < 0;

        const wasEverHedged = p.isHedged || (p.hedgeRetries || 0) > 0 || !!p.mainPositionId || (p.cumulativeHedgeLoss || 0) > 0 || (p.cumulativeHedgeProfit || 0) > 0;

        // Record a separate CLOSE log
        this.tradeLogs.unshift({
            symbol: p.symbol,
            entry_id: p.entryId,
            status: 'CLOSED',
            profit_usdt: p.unrealizedPnL,
            exit_reason: reason,
            is_hedge: wasEverHedged,
            entry_timestamp: p.entryTime,
            exit_timestamp: now,
            direction: p.side,
            cost_usdt: p.amount * p.entryPrice,
            entry_price: p.entryPrice,
            exit_price: p.markPrice,
            profit_percent: p.unrealizedPnLPercentage,
            main_entry_id: p.mainPositionId,
            correlationId: p.correlationId,
            reopenCount: p.reopenCount,
            is_reopened: !!p.isReopened,
            timeframe: p.signalTf, // Store timeframe
            last_stop_loss_time: isStopLoss ? now : undefined,
            stop_loss_rule: isStopLoss ? reason : undefined
        });

        // Add final exit event to the same log entry (as a sub-event)
        const targetLog = this.tradeLogs.find(l => l.entry_id === p.entryId && l.status === 'CLOSED');
        if (targetLog) {
            if (!targetLog.events) targetLog.events = [];
            targetLog.events.push({
                timestamp: now,
                action: '最终平仓',
                price: p.markPrice,
                amount: p.amount,
                reason,
                pnl: p.unrealizedPnL
            });
        }

        // --- SAVIOR LAB: Record Trade DNA to Firebase ---
        if (auth.currentUser && !p.isHedged && !p.mainPositionId) {
            const dnaData = {
                uid: auth.currentUser.uid,
                symbol: p.symbol,
                side: p.side,
                entryPrice: p.entryPrice,
                exitPrice: p.markPrice,
                maxProfitPercent: p.maxPnLPercent || 0,
                finalProfitPercent: p.unrealizedPnLPercentage,
                entryTimestamp: p.entryTime,
                exitTimestamp: now,
                exitReason: reason,
                indicatorsAtEntry: {
                    rsi: p.currentIndicators?.rsi || 50,
                    volatility: p.currentIndicators?.volatility || 0,
                    deviation: p.currentIndicators?.deviation || 0,
                    emaDistance: p.currentIndicators?.emaDistance || 0,
                    volumeSwell: p.currentIndicators?.volumeSwell || 1
                },
                aiSettings: {
                    sensitivity: this.settings.profit.ai?.sensitivity || 5,
                    aggressiveness: this.settings.profit.ai?.aggressiveness || 5
                },
                recordedAt: now
            };
            
            addDoc(collection(db, 'trade_dna'), dnaData).catch(err => {
                console.error('Failed to record Trade DNA:', err);
            });
        }
    }

    public recordRealTradeLog(p: Position, reason: string, execData?: { orderId?: string, price?: number, qty?: number, realizedPnl?: number }) {
        // 🔒 [拦截空仓/虚假平仓日志] 若该仓位持仓数量已为 0 或已通过防爆对冲砍仓完成结单，严禁再次生成冗余的“止损平仓”日志
        if (!p || p.isAmputatedToZero) {
            return;
        }

        // 🔒 [程序信号日志隔离铁律]：程序自动生成的预执行信号、请求指令或发送中提示（如“正在向币安发送请求...”，“策略触发平仓”等）严禁录入交易日志(tradeLogs)
        if (reason.includes('请求') || reason.includes('发送') || reason.includes('中') || reason.includes('触发请求') || reason.includes('正在向')) {
            return;
        }

        const now = (execData as any)?.updateTime || Date.now();
        const execPrice = execData?.price || p.markPrice || p.entryPrice;
        const execQty = execData?.qty || p.amount;
        const pnl = execData?.realizedPnl !== undefined ? execData.realizedPnl : p.unrealizedPnL;
        const isStopLoss = reason.includes('止损') || reason.includes('砍仓') || pnl < 0;

        const wasEverHedged = p.isHedged || (p.hedgeRetries || 0) > 0 || !!p.mainPositionId || (p.cumulativeHedgeLoss || 0) > 0 || (p.cumulativeHedgeProfit || 0) > 0;

        const isHedgePos = wasEverHedged || !!p.mainPositionId || (p.entryId && p.entryId.startsWith('HEDGE_'));

        // Check if an instant WebSocket closed log was already created for this execution
        const orderIdStr = execData?.orderId ? String(execData.orderId) : "";
        const existingInstantClosed = this.tradeLogs.find(l => 
            (orderIdStr && l.binance_order_id && String(l.binance_order_id) === orderIdStr && l.status === 'CLOSED') ||
            (normalizeSymbol(l.symbol) === normalizeSymbol(p.symbol) && l.direction === p.side && l.status === 'CLOSED' && Math.abs((l.exit_timestamp || 0) - now) < 5000)
        );

        if (existingInstantClosed) {
            if (orderIdStr) existingInstantClosed.binance_order_id = orderIdStr;
            if (pnl !== undefined && pnl !== 0 && existingInstantClosed.profit_usdt === 0) existingInstantClosed.profit_usdt = pnl;
            if (execPrice > 0) existingInstantClosed.exit_price = execPrice;
            if (reason) existingInstantClosed.exit_reason = reason;
            this.emitUpdate(true);
            return;
        }

        // Ensure matching OPEN log exists so trade lifecycle is complete and traceable
        const hasOpenLog = this.tradeLogs.some(l => 
            (l.entry_id === p.entryId || (normalizeSymbol(l.symbol) === normalizeSymbol(p.symbol) && l.direction === p.side)) && 
            l.status === 'OPEN'
        );

        if (!hasOpenLog) {
            this.tradeLogs.push({
                symbol: p.symbol,
                entry_id: p.entryId || (`real_${p.symbol}_${p.side}_${p.entryTime || now}`),
                status: 'OPEN',
                is_hedge: isHedgePos,
                main_entry_id: p.mainPositionId,
                entry_timestamp: p.entryTime || now,
                direction: p.side,
                cost_usdt: execQty * p.entryPrice,
                entry_price: p.entryPrice,
                current_amount: execQty,
                timeframe: p.signalTf || '5m',
                events: [{
                    timestamp: p.entryTime || now,
                    action: isHedgePos ? `防爆对冲开仓 (${p.side})` : `实盘开仓 (${p.side})`,
                    price: p.entryPrice,
                    amount: execQty,
                    reason: isHedgePos ? (p.triggerReason || '防爆对冲开仓') : '实盘发现/触发开仓'
                }]
            });
        }

        // Record a separate CLOSE log with actual exchange feedback data
        this.tradeLogs.unshift({
            symbol: p.symbol,
            entry_id: p.entryId || (`real_${p.symbol}_${p.side}`),
            binance_order_id: execData?.orderId,
            status: 'CLOSED',
            profit_usdt: pnl,
            exit_reason: reason,
            is_hedge: wasEverHedged,
            entry_timestamp: p.entryTime || now,
            exit_timestamp: now,
            direction: p.side,
            cost_usdt: execQty * p.entryPrice,
            entry_price: p.entryPrice,
            exit_price: execPrice,
            profit_percent: p.entryPrice > 0 ? (pnl / (execQty * p.entryPrice)) * 100 : (p.unrealizedPnLPercentage || 0),
            main_entry_id: p.mainPositionId,
            correlationId: p.correlationId,
            reopenCount: p.reopenCount,
            is_reopened: !!p.isReopened,
            timeframe: p.signalTf, // Store timeframe
            last_stop_loss_time: isStopLoss ? now : undefined,
            stop_loss_rule: isStopLoss ? reason : undefined,
            events: [{
                timestamp: now,
                action: reason.includes('砍仓') ? '防爆对冲砍仓成交回报' : '交易所成交回报平仓',
                price: execPrice,
                amount: execQty,
                reason,
                pnl
            }]
        });

        this.emitUpdate(true);
    }

    /**
     * 🔒 币安官方实盘成交账单 (userTrades) 对账与状态保全引擎
     * 自动从币安官方拉取的真实成交流水进行对账，自动补全 App 手动平仓/条件单平仓记录，
     * 并将实际已实现盈亏 (realizedPnl) 与单币负债池绝对对齐，释放补仓锁与幽灵单。
     */
    public reconcileRealTradesFromBinance(binanceTrades: any[]) {
        if (!Array.isArray(binanceTrades) || binanceTrades.length === 0) return;

        let hasNewUpdates = false;

        // Group trades by orderId or symbol
        for (const trade of binanceTrades) {
            const rawSymbol = trade.symbol;
            if (!rawSymbol) continue;

            const price = parseFloat(trade.price || "0");
            const qty = parseFloat(trade.qty || "0");

            // 🔒 [零成本/虚假流水拦截铁律] 必须为真实成交价格 > 0 且成交数量 > 0 的真实订单回报，严禁资金费或价格为0的数据混入
            if (price <= 0 || qty <= 0 || trade.incomeType) {
                continue;
            }

            const normSym = normalizeSymbol(rawSymbol);
            const tradeTime = parseInt(trade.time || trade.timestamp || "0") || Date.now();
            if (this.clearedTradeLogsTimestamp && tradeTime <= this.clearedTradeLogsTimestamp) {
                continue;
            }

            const realizedPnl = parseFloat(trade.realizedPnl || "0");
            const commission = parseFloat(trade.commission || "0");
            const side = trade.side === "BUY" ? "BUY" : "SELL"; // BUY or SELL
            const positionSide = trade.positionSide || "BOTH"; // LONG, SHORT, BOTH
            const orderId = String(trade.orderId || trade.id || "");

            if (realizedPnl !== 0) {
                const inferredDirection = (positionSide === "LONG" || (positionSide === "BOTH" && side === "SELL")) ? PositionSide.LONG : PositionSide.SHORT;
                const logReason = realizedPnl >= 0 ? '实盘止盈 / App平仓 (币安对账)' : '实盘止损 / App平仓 (币安对账)';

                // 1. 优先根据 binance_order_id 精确匹配已有的 CLOSED 日志
                let existingLog = this.tradeLogs.find(l => l.binance_order_id && String(l.binance_order_id) === orderId);

                // 2. 检查是否为同币种已平仓记录但尚未关联 binance_order_id
                if (!existingLog) {
                    existingLog = this.tradeLogs.find(l => 
                        !l.binance_order_id &&
                        normalizeSymbol(l.symbol) === normSym &&
                        l.status === 'CLOSED' &&
                        (l.direction === inferredDirection || positionSide === "BOTH") &&
                        Math.abs((l.exit_timestamp || 0) - tradeTime) < 120000
                    );
                }

                // 3. 检查是否为最近 180 秒内程序执行的砍仓/断臂求生/对冲结单流水
                if (!existingLog) {
                    existingLog = this.tradeLogs.find(l =>
                        !l.binance_order_id &&
                        normalizeSymbol(l.symbol) === normSym &&
                        l.status === 'CLOSED' &&
                        (l.exit_reason?.includes('砍仓') || l.exit_reason?.includes('断臂求生') || l.exit_reason?.includes('对冲')) &&
                        Math.abs((l.exit_timestamp || 0) - tradeTime) < 180000
                    );
                }

                const isKnownInternalOrder = this.knownOrderIds.has(orderId);

                if (existingLog) {
                    // Update existing log with exact realized PnL from Binance if not already exact
                    existingLog.binance_order_id = orderId;
                    this.knownOrderIds.add(orderId);
                    if (price > 0 && (!existingLog.exit_price || existingLog.exit_price === existingLog.entry_price)) {
                        existingLog.exit_price = price;
                    }
                    if (commission > 0) {
                        existingLog.commission = (existingLog.commission || 0) + commission;
                    }

                    if (existingLog.profit_usdt === undefined || Math.abs(existingLog.profit_usdt - realizedPnl) > 0.001) {
                        const prevPnl = existingLog.profit_usdt || 0;
                        existingLog.profit_usdt = realizedPnl;
                        hasNewUpdates = true;

                        // 🔒 [官方账单负债校准] 严格差额校准，绝不全额重复累加
                        if (realizedPnl < 0) {
                            const activePositions = this.positions.filter(p => normalizeSymbol(p.symbol) === normSym);
                            const isSymbolUnderActiveHedge = activePositions.some(p => p.isHedged || !!p.mainPositionId || (p.isAmputated && (p.amputatedAmount || 0) > 0));
                            const hedgeStartTime = Math.min(...activePositions.map(p => p.lastAmputationTime || p.entryTime || 0));
                            
                            if (isSymbolUnderActiveHedge && tradeTime >= hedgeStartTime - 30000) {
                                const lossDiff = Math.abs(realizedPnl) - Math.abs(prevPnl < 0 ? prevPnl : 0);
                                if (lossDiff > 0.0001) {
                                    for (const pos of activePositions) {
                                        pos.cumulativeAmputationLoss = (pos.cumulativeAmputationLoss || 0) + lossDiff;
                                    }
                                }
                            }
                        }
                    }
                } else if (isKnownInternalOrder && this.tradeLogs.some(l => l.binance_order_id && String(l.binance_order_id) === orderId && l.status === 'CLOSED')) {
                    // 内部已知订单且已有 CLOSED 日志，直接忽略避免重复生成
                    this.knownOrderIds.add(orderId);
                } else {
                    // 4. 检查是否有一条 OPEN 状态的日志属于这次平仓
                    // 🔒 铁律防护：若该币种当前在实盘持仓中依然存活处于活动持仓状态 (amount > 0)，且未处于在途平仓状态，严禁将进行中的活动持仓日志关闭为已完结平仓！
                    const isCurrentlyActiveInPositions = this.positions.some(p => 
                        normalizeSymbol(p.symbol) === normSym && 
                        (p.side === inferredDirection || positionSide === "BOTH") && 
                        (p.amount || 0) > 0.0001
                    );
                    const inFlightClosing = this.inFlightClosingPool.has(`${normSym}_${inferredDirection}`) || this.inFlightClosingPool.has(normSym);

                    const matchingOpenLog = this.tradeLogs.find(l => 
                        normalizeSymbol(l.symbol) === normSym && 
                        l.status === 'OPEN' && 
                        (l.direction === inferredDirection || positionSide === "BOTH") &&
                        (l.entry_timestamp || 0) <= tradeTime &&
                        (tradeTime - (l.entry_timestamp || 0) >= 3000 || inFlightClosing || !isCurrentlyActiveInPositions) // 杜绝开仓瞬间的并发回放与同秒假平仓
                    );

                    // 🔒 [开平仓独立铁律] 任何平仓都生成独立的 CLOSED 交易记录，绝对严禁改写或破坏原有的 OPEN 开仓记录
                    const duplicateLog = this.tradeLogs.find(l => l.binance_order_id && String(l.binance_order_id) === orderId && l.status === 'CLOSED');
                    if (duplicateLog) {
                        this.knownOrderIds.add(orderId);
                        continue;
                    }

                    if (!isCurrentlyActiveInPositions || inFlightClosing || (tradeTime - (matchingOpenLog?.entry_timestamp || 0) >= 3000)) {
                        const costUsdt = matchingOpenLog ? (matchingOpenLog.cost_usdt || (qty * (matchingOpenLog.entry_price || price))) : (qty * price);
                        const profitPercent = costUsdt > 0 ? (realizedPnl / costUsdt) * 100 : 0;
                        const entryPrice = matchingOpenLog ? matchingOpenLog.entry_price : price;
                        const entryTime = matchingOpenLog ? matchingOpenLog.entry_timestamp : tradeTime;
                        const isHedgeLog = matchingOpenLog ? matchingOpenLog.is_hedge : false;
                        const mainEntryId = matchingOpenLog ? matchingOpenLog.main_entry_id : undefined;

                        // 🔒 [官方账单负债回填] 只有当该币种【正在防爆对冲】且成交时间属于当前对冲生命周期内且未曾处理过该 orderId 时
                        if (realizedPnl < 0 && !this.processedExternalPnlOrders.has(orderId)) {
                            this.processedExternalPnlOrders.add(orderId);
                            const activePositions = this.positions.filter(p => normalizeSymbol(p.symbol) === normSym);
                            const isSymbolUnderActiveHedge = activePositions.some(p => p.isHedged || !!p.mainPositionId || (p.isAmputated && (p.amputatedAmount || 0) > 0));
                            const hedgeStartTime = Math.min(...activePositions.map(p => p.lastAmputationTime || p.entryTime || 0));

                            if (isSymbolUnderActiveHedge && tradeTime >= hedgeStartTime - 30000) {
                                for (const pos of activePositions) {
                                    pos.cumulativeAmputationLoss = (pos.cumulativeAmputationLoss || 0) + Math.abs(realizedPnl);
                                }
                            }
                        }

                        // 生成完全独立的平仓交易流水，不破坏已有开仓记录
                        this.tradeLogs.unshift({
                            symbol: rawSymbol.toUpperCase(),
                            entry_id: matchingOpenLog?.entry_id || `binance_trade_${orderId}_${tradeTime}`,
                            binance_order_id: orderId,
                            status: 'CLOSED',
                            profit_usdt: realizedPnl,
                            exit_reason: logReason,
                            is_hedge: isHedgeLog,
                            main_entry_id: mainEntryId,
                            timeframe: matchingOpenLog?.timeframe,
                            entry_timestamp: entryTime,
                            exit_timestamp: tradeTime,
                            direction: inferredDirection,
                            cost_usdt: costUsdt,
                            entry_price: entryPrice,
                            exit_price: price,
                            profit_percent: profitPercent,
                            commission: commission,
                            events: [{
                                timestamp: tradeTime,
                                action: realizedPnl >= 0 ? '盈利平仓' : '止损平仓',
                                price: price,
                                amount: qty,
                                reason: logReason,
                                pnl: realizedPnl
                            }]
                        });

                        this.knownOrderIds.add(orderId);
                        hasNewUpdates = true;
                    }

                    // Also add a system log to inform the user
                    this.addLog(
                        realizedPnl >= 0 ? 'SUCCESS' : 'WARNING',
                        `🔄 [币安官方账本对账] 自动同步 App/交易所端成交明细: ${rawSymbol} | 成交价: ${price.toFixed(4)} | 数量: ${qty} | 实际盈亏: ${realizedPnl >= 0 ? '+' : ''}${realizedPnl.toFixed(4)} USDT`
                    );
                }
            } else {
                // Binance trade execution for opening position (realizedPnl === 0)
                const inferredDirection = (positionSide === "LONG" || (positionSide === "BOTH" && side === "BUY")) ? PositionSide.LONG : PositionSide.SHORT;
                
                // 🔒【开仓唯一性铁律】检查是否已有该开仓订单/该活跃持仓的 OPEN 日志，杜绝任何同向二次重复开仓日志
                const activePos = this.positions.find(p => 
                    normalizeSymbol(p.symbol) === normSym && 
                    p.side === inferredDirection && 
                    (p.amount || 0) > 0.0001
                );

                const existingOpenLog = this.tradeLogs.find(l => 
                    (orderId && l.binance_order_id && String(l.binance_order_id) === orderId) ||
                    (activePos && l.entry_id === activePos.entryId && l.status === 'OPEN') ||
                    (normalizeSymbol(l.symbol) === normSym && l.status === 'OPEN' && l.direction === inferredDirection)
                );

                if (!existingOpenLog) {
                    // 🔒【严禁为历史已完结开仓生成孤立 OPEN 日志】
                    // 必须先检查当前真实持仓中是否存在对应活跃仓位且时间吻合！
                    if (!activePos) {
                        continue;
                    }

                    const opposingPos = this.positions.find(p => normalizeSymbol(p.symbol) === normSym && p.side !== inferredDirection);
                    const isHedge = !!opposingPos || this.tradeLogs.some(l => normalizeSymbol(l.symbol) === normSym && l.status === 'OPEN' && l.direction !== inferredDirection);
                    const mainPos = opposingPos || this.positions.find(p => normalizeSymbol(p.symbol) === normSym);

                    this.tradeLogs.unshift({
                        symbol: rawSymbol.toUpperCase(),
                        entry_id: activePos.entryId || `binance_open_${orderId}_${tradeTime}`,
                        binance_order_id: orderId || undefined,
                        status: 'OPEN',
                        is_hedge: isHedge,
                        main_entry_id: isHedge ? mainPos?.entryId : undefined,
                        entry_timestamp: tradeTime,
                        direction: inferredDirection,
                        cost_usdt: qty * price,
                        entry_price: price,
                        current_amount: qty,
                        timeframe: '5m',
                        events: [{
                            timestamp: tradeTime,
                            action: isHedge ? `防爆对冲开仓 (${inferredDirection})` : '币安反馈成功开仓',
                            price: price,
                            amount: qty,
                            reason: isHedge ? '实盘防爆对冲开仓成交' : '实盘交易所成交反馈'
                        }]
                    });
                    if (orderId) this.knownOrderIds.add(orderId);
                    hasNewUpdates = true;
                } else {
                    if (!existingOpenLog.binance_order_id && orderId) {
                        existingOpenLog.binance_order_id = orderId;
                        this.knownOrderIds.add(orderId);
                        hasNewUpdates = true;
                    }
                    const opposingPos = this.positions.find(p => normalizeSymbol(p.symbol) === normSym && p.side !== inferredDirection);
                    if (opposingPos && !existingOpenLog.is_hedge) {
                        existingOpenLog.is_hedge = true;
                        existingOpenLog.main_entry_id = opposingPos.entryId;
                        hasNewUpdates = true;
                    }
                }
            }
        }

        if (hasNewUpdates) {
            // Deduplicate logs: ensure strictly at most 1 OPEN log per active position/entry_id
            const seenKeys = new Set<string>();
            const seenOpenEntries = new Set<string>();

            this.tradeLogs = this.tradeLogs.filter(l => {
                if (!l) return false;
                if (this.clearedTradeLogsTimestamp && (l.exit_timestamp || l.entry_timestamp || 0) <= this.clearedTradeLogsTimestamp) {
                    return false;
                }

                if (l.status === 'OPEN') {
                    const norm = normalizeSymbol(l.symbol);
                    const openKey = l.entry_id ? `OPEN_ID_${l.entry_id}` : `OPEN_SYM_${norm}_${l.direction}`;
                    if (seenOpenEntries.has(openKey)) {
                        return false;
                    }
                    seenOpenEntries.add(openKey);
                    return true;
                }

                const key = `${l.status}_${l.binance_order_id || l.entry_id || ''}_${l.exit_timestamp || l.entry_timestamp || 0}`;
                if (seenKeys.has(key)) return false;
                seenKeys.add(key);
                return true;
            });

            this.emitUpdate(true);
        }
    }

    /**
     * ⚡ 币安 User Data Stream WebSocket 即时成交流水与订单回报接入通道
     * 毫秒级接收币安服务器推送的 ORDER_TRADE_UPDATE，自动生成独立的开/平仓流水，绝不漏记或延时
     */
    public handleInstantBinanceTrade(trade: {
        symbol: string;
        clientOrderId?: string;
        side: string; // "BUY" | "SELL"
        orderType?: string;
        origQty?: number;
        price?: number;
        avgPrice?: number;
        executionType?: string;
        orderStatus?: string;
        orderId?: string | number;
        lastFilledQty?: number;
        cumFilledQty?: number;
        lastFilledPrice?: number;
        commission?: number;
        commissionAsset?: string;
        tradeTime?: number;
        tradeId?: number;
        positionSide?: string;
        realizedPnl?: number;
        action?: string; // "OPEN" | "CLOSE"
    }) {
        if (!trade || !trade.symbol) return;
        const rawSymbol = trade.symbol.toUpperCase();
        const normSym = normalizeSymbol(rawSymbol);
        const orderId = String(trade.orderId || "");
        const tradeTime = trade.tradeTime || Date.now();
        if (this.clearedTradeLogsTimestamp && tradeTime <= this.clearedTradeLogsTimestamp) return;

        const avgPrice = trade.avgPrice || trade.lastFilledPrice || trade.price || 0;
        const qty = trade.cumFilledQty || trade.lastFilledQty || trade.origQty || 0;
        if (avgPrice <= 0 || qty <= 0) return;

        const orderStatus = trade.orderStatus || "FILLED";
        if (orderStatus !== "FILLED" && orderStatus !== "PARTIALLY_FILLED" && orderStatus !== "CLOSED") return;

        const realizedPnl = trade.realizedPnl || 0;
        const side = trade.side === "BUY" ? "BUY" : "SELL";
        const positionSide = trade.positionSide || (side === "BUY" ? "LONG" : "SHORT");

        // 判断是平仓还是开仓
        const isInferredClose = trade.action === "CLOSE" || 
            (realizedPnl !== 0) || 
            (positionSide === "LONG" && side === "SELL") || 
            (positionSide === "SHORT" && side === "BUY");

        if (isInferredClose) {
            const inferredDirection = (positionSide === "LONG" || (positionSide === "BOTH" && side === "SELL")) ? PositionSide.LONG : PositionSide.SHORT;
            
            // 检查是否已有该 orderId 的 CLOSED 记录
            const existingClosed = this.tradeLogs.find(l => 
                (orderId && l.binance_order_id && String(l.binance_order_id) === orderId && l.status === 'CLOSED') ||
                (normalizeSymbol(l.symbol) === normSym && l.status === 'CLOSED' && l.direction === inferredDirection && Math.abs((l.exit_timestamp || 0) - tradeTime) < 2000)
            );

            if (existingClosed) {
                if (orderId) existingClosed.binance_order_id = orderId;
                if (realizedPnl !== 0 && existingClosed.profit_usdt === 0) existingClosed.profit_usdt = realizedPnl;
                if (trade.commission) existingClosed.commission = (existingClosed.commission || 0) + trade.commission;
                if (orderId) this.knownOrderIds.add(orderId);
                this.emitUpdate(true);
                return;
            }

            // 寻找对应的 OPEN 开仓记录 (保持开仓记录不被改写)
            const matchingOpenLog = this.tradeLogs.find(l => 
                normalizeSymbol(l.symbol) === normSym && 
                l.status === 'OPEN' && 
                (l.direction === inferredDirection || positionSide === "BOTH")
            );

            const costUsdt = matchingOpenLog ? (matchingOpenLog.cost_usdt || (qty * (matchingOpenLog.entry_price || avgPrice))) : (qty * avgPrice);
            const entryPrice = matchingOpenLog ? matchingOpenLog.entry_price : avgPrice;
            const entryTime = matchingOpenLog ? matchingOpenLog.entry_timestamp : tradeTime;
            const isHedgeLog = matchingOpenLog ? matchingOpenLog.is_hedge : false;
            const mainEntryId = matchingOpenLog ? matchingOpenLog.main_entry_id : undefined;
            const exitReason = trade.action === "CLOSE" ? "实盘手动平仓 / 币安即时成交" : (realizedPnl >= 0 ? "实盘止盈 / 币安即时成交" : "实盘止损 / 币安即时成交");
            const profitPercent = costUsdt > 0 ? (realizedPnl / costUsdt) * 100 : (entryPrice > 0 ? ((avgPrice - entryPrice) / entryPrice) * (inferredDirection === PositionSide.LONG ? 100 : -100) : 0);

            // 生成完全独立的 CLOSED 交易流水
            this.tradeLogs.unshift({
                symbol: rawSymbol,
                entry_id: matchingOpenLog?.entry_id || `instant_close_${orderId || Date.now()}`,
                binance_order_id: orderId || undefined,
                status: 'CLOSED',
                profit_usdt: realizedPnl,
                exit_reason: exitReason,
                is_hedge: isHedgeLog,
                main_entry_id: mainEntryId,
                timeframe: matchingOpenLog?.timeframe || '5m',
                entry_timestamp: entryTime,
                exit_timestamp: tradeTime,
                direction: inferredDirection,
                cost_usdt: costUsdt,
                entry_price: entryPrice,
                exit_price: avgPrice,
                profit_percent: profitPercent,
                commission: trade.commission || 0,
                events: [{
                    timestamp: tradeTime,
                    action: realizedPnl >= 0 ? '盈利平仓' : '止损平仓',
                    price: avgPrice,
                    amount: qty,
                    reason: exitReason,
                    pnl: realizedPnl
                }]
            });

            if (orderId) this.knownOrderIds.add(orderId);

            // ⚡ [即时持仓同步] 收到币安成交回报后，毫秒级直接从持仓列表扣减或彻底移除已平仓位！
            const lookupKey = `${normSym}_${inferredDirection}`;
            this.recentlyClosedKeys.set(lookupKey, tradeTime);
            this.inFlightClosingPool.delete(lookupKey);
            this.inFlightClosingPool.delete(normSym);

            const posIdx = this.positions.findIndex(p => 
                normalizeSymbol(p.symbol) === normSym && 
                (p.side === inferredDirection || positionSide === "BOTH")
            );

            if (posIdx >= 0) {
                const targetPos = this.positions[posIdx];
                const remainingAmount = targetPos.amount - qty;
                if (remainingAmount <= 0.0001) {
                    console.log(`⚡ [Instant Position Removal] Completely removed closed position ${rawSymbol} (${inferredDirection}) via WebSocket fill`);
                    this.positions.splice(posIdx, 1);
                } else {
                    console.log(`⚡ [Instant Position Deduct] Deducted ${qty} from ${rawSymbol} (${inferredDirection}), remaining: ${remainingAmount}`);
                    this.positions[posIdx] = {
                        ...targetPos,
                        amount: remainingAmount
                    };
                }
            }

            // 检查该币种是否已无任何持仓，清理对冲标记
            if (!this.positions.some(p => normalizeSymbol(p.symbol) === normSym && p.amount > 0.0001)) {
                this.amputatedSymbolsInCycle.delete(normSym);
            }

            this.addLog(
                realizedPnl >= 0 ? 'SUCCESS' : 'WARNING',
                `⚡ [币安即时成交回报] 收到平仓成交反馈: ${rawSymbol} ${inferredDirection} | 成交价: ${avgPrice.toFixed(4)} | 数量: ${qty} | 盈亏: ${realizedPnl >= 0 ? '+' : ''}${realizedPnl.toFixed(4)} USDT`
            );

            this.emitUpdate(true);
        } else {
            // 开仓成交回报
            const inferredDirection = (positionSide === "SHORT" || (positionSide === "BOTH" && side === "SELL")) ? PositionSide.SHORT : PositionSide.LONG;
            
            const alreadyHasOpen = this.tradeLogs.find(l => 
                ((orderId && l.binance_order_id && String(l.binance_order_id) === orderId) || 
                 (normalizeSymbol(l.symbol) === normSym && l.direction === inferredDirection)) &&
                l.status === 'OPEN'
            );

            if (alreadyHasOpen) {
                if (orderId && !alreadyHasOpen.binance_order_id) {
                    alreadyHasOpen.binance_order_id = orderId;
                    this.knownOrderIds.add(orderId);
                }
                return;
            }

            if (!alreadyHasOpen) {
                const opposingPos = this.positions.find(p => normalizeSymbol(p.symbol) === normSym && p.side !== inferredDirection);
                const isHedge = !!opposingPos || this.tradeLogs.some(l => normalizeSymbol(l.symbol) === normSym && l.status === 'OPEN' && l.direction !== inferredDirection);
                const mainPos = opposingPos || this.positions.find(p => normalizeSymbol(p.symbol) === normSym);

                this.tradeLogs.unshift({
                    symbol: rawSymbol,
                    entry_id: `instant_open_${normSym}_${inferredDirection}_${tradeTime}`,
                    binance_order_id: orderId || undefined,
                    status: 'OPEN',
                    is_hedge: isHedge,
                    main_entry_id: isHedge ? mainPos?.entryId : undefined,
                    entry_timestamp: tradeTime,
                    direction: inferredDirection,
                    cost_usdt: qty * avgPrice,
                    entry_price: avgPrice,
                    current_amount: qty,
                    timeframe: '5m',
                    events: [{
                        timestamp: tradeTime,
                        action: isHedge ? `防爆对冲开仓 (${inferredDirection})` : `实盘开仓 (${inferredDirection})`,
                        price: avgPrice,
                        amount: qty,
                        reason: isHedge ? '防爆对冲即时成交开仓回报' : '币安即时成交开仓回报'
                    }]
                });

                if (orderId) this.knownOrderIds.add(orderId);

                this.addLog('SUCCESS', `⚡ [币安即时成交回报] 收到新开仓成交反馈: ${rawSymbol} ${inferredDirection} | 开仓价: ${avgPrice.toFixed(4)} | 数量: ${qty}`);
                this.emitUpdate(true);
            }
        }
    }

    /**
     * ⚡ 币安 User Data Stream WebSocket 即时账户与持仓变动 (ACCOUNT_UPDATE)
     * 毫秒级同步手机 App 或交易所端一键全平、保证金、钱包余额与持仓量变化
     */
    public handleInstantAccountUpdate(accData: {
        m?: string; // event reason type
        B?: Array<{ a: string; wb: string; cw: string; bc?: string }>; // Balances
        P?: Array<{ s: string; pa: string; ep: string; cr: string; up: string; mt: string; iw: string; ps: string; ma?: string }>; // Positions
    }) {
        if (!accData) return;

        // 1. 同步钱包与可用保证金余额
        if (accData.B && Array.isArray(accData.B)) {
            const usdtBal = accData.B.find(b => b.a === 'USDT');
            if (usdtBal) {
                const wb = parseFloat(usdtBal.wb || "0");
                const cw = parseFloat(usdtBal.cw || "0");
                const activeBal = cw > 0 ? cw : wb;
                if (activeBal > 0) {
                    this.updateRealBalance(activeBal);
                }
            }
        }

        // 2. 即时更新或移除变动持仓 (特别是手机端一键平仓 pa === "0")
        if (accData.P && Array.isArray(accData.P)) {
            let positionsChanged = false;
            for (const pos of accData.P) {
                const normSym = normalizeSymbol(pos.s);
                const posAmount = parseFloat(pos.pa || "0");
                const posSideStr = pos.ps || "BOTH";
                let inferredSide = posSideStr === "LONG" ? PositionSide.LONG : (posSideStr === "SHORT" ? PositionSide.SHORT : undefined);
                if (!inferredSide) {
                    inferredSide = posAmount > 0 ? PositionSide.LONG : (posAmount < 0 ? PositionSide.SHORT : undefined);
                }

                if (Math.abs(posAmount) <= 0.00001) {
                    // 交易所端已彻底清仓该方向持仓 (如手机 App 一键全平)
                    const beforeLen = this.positions.length;
                    this.positions = this.positions.filter(p => {
                        if (normalizeSymbol(p.symbol) !== normSym) return true;
                        if (inferredSide && p.side !== inferredSide) return true;
                        return false;
                    });
                    if (this.positions.length !== beforeLen) {
                        positionsChanged = true;
                        if (inferredSide) {
                            this.recentlyClosedKeys.set(`${normSym}_${inferredSide}`, Date.now());
                        }
                        console.log(`⚡ [ACCOUNT_UPDATE] 立即移除已全平仓位: ${pos.s} ${inferredSide || ''}`);
                    }
                    // 检查该币种是否已无任何持仓
                    if (!this.positions.some(p => normalizeSymbol(p.symbol) === normSym)) {
                        this.amputatedSymbolsInCycle.delete(normSym);
                    }
                } else if (inferredSide) {
                    // 持仓量发生变化 (部分平仓或加仓)
                    const existingIdx = this.positions.findIndex(p => normalizeSymbol(p.symbol) === normSym && p.side === inferredSide);
                    const ep = parseFloat(pos.ep || "0");
                    const up = parseFloat(pos.up || "0");
                    const absQty = Math.abs(posAmount);

                    if (existingIdx >= 0) {
                        this.positions[existingIdx] = {
                            ...this.positions[existingIdx],
                            amount: absQty,
                            entryPrice: ep > 0 ? ep : this.positions[existingIdx].entryPrice,
                            unrealizedPnL: up
                        };
                        positionsChanged = true;
                    }
                }
            }

            if (positionsChanged) {
                this.emitUpdate(true);
            }
        }
    }

    public clearTradeLogs(customTimestamp?: number) {
        const timestamp = customTimestamp || Date.now();
        this.tradeLogs = [];
        this.systemEvents = [];
        this.clearedTradeLogsTimestamp = timestamp;
        this.processedExternalPnlOrders.clear();
        this.knownOrderIds.clear();
        try {
            localStorage.setItem('SAVIOR_CLEARED_TRADELOGS_TIME', String(timestamp));
            const isReal = this.settings?.system?.realTrading;
            localStorage.removeItem(isReal ? 'SAVIOR_TRADELOGS_LIVE' : 'SAVIOR_TRADELOGS_SIM');
            localStorage.removeItem('SAVIOR_TRADELOGS');
        } catch (e) {}
        this.emitUpdate(true);
    }

    public openBatchPositions(symbol: string, mode: string, count: number, amount: number, hedge: boolean, source: string, timeframe: string, limit: number) {
        this.addLog('INFO', 'Batch open simulation triggered');
    }

    public applyStrategyRecommendation(rec: any) {
        this.addLog('INFO', `Applied strategy recommendation for ${rec.symbol}`);
    }

    public addLog(type: 'INFO' | 'SUCCESS' | 'WARNING' | 'DANGER', message: string) {
        let finalMessage = message;
        if (this.settings?.system?.realTrading) {
            const hasKeys = !!(this.settings.system.binanceApiKey && this.settings.system.binanceApiSecret);
            const prefix = hasKeys ? '⚡ [实盘 API] ' : '🛡️ [实盘模拟] ';
            
            if (message.startsWith('Opened ')) {
                finalMessage = prefix + message.replace('Opened', 'Binance 挂单成交 (市价)')
                    .replace(' on ', ' ')
                    .replace(' at ', '，成交均价: ');
            } else if (message.startsWith('Closed ')) {
                finalMessage = prefix + message.replace('Closed', 'Binance 仓位已平仓')
                    .replace(' on ', ' ')
                    .replace(':', '，原因:');
            } else if (message.includes('对冲触发') || message.includes('补回仓位') || message.includes('部分止盈') || message.includes('部分止损') || message.includes('累计盈利清仓') || message.includes('全部平仓')) {
                finalMessage = prefix + message;
            } else if (message.includes('系统心跳')) {
                finalMessage = message.replace('系统心跳:', '🟢 Binance API 实时长连接正常 | 心跳:');
            } else {
                finalMessage = prefix + message;
            }
        }
        this.logs.unshift({
            id: Date.now().toString() + Math.random(),
            timestamp: new Date(),
            type,
            message: finalMessage
        });
        if (this.logs.length > 200) this.logs.pop();
    }

    private getAutoTimeframe(entryTf: string): string {
        const tfMap: Record<string, string> = {
            '1m': '3m',
            '3m': '5m',
            '5m': '15m',
            '15m': '30m',
            '30m': '1h',
            '1h': '2h',
            '2h': '4h',
            '4h': '8h',
            '8h': '1d',
            '1d': '1d'
        };
        return tfMap[entryTf] || '1h';
    }

    private async updateIndicators() {
        if (this.positions.length === 0 || this.isUpdatingIndicators) return;
        
        // 只有当开启了 AI 止盈模式时，才需要更新这些高级指标
        const isAiActive = this.settings.profit.enabled && (
            this.settings.profit.profitMode === 'AI' || 
            (this.settings.profit.oEnabledMap && this.settings.profit.oEnabledMap['AI'])
        );
        if (!isAiActive) return;

        this.isUpdatingIndicators = true;
        
        try {
            const symbols = Array.from(new Set(this.positions.map(p => p.symbol)));
            
            // 并行请求，提高效率
            await Promise.all(symbols.map(async (symbol) => {
                try {
                    const safeSymbol = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
                    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=1h&limit=100`;
                    const res = await fetchWithFallback(url, {}, undefined, this.settings.system.directMode);
                    const data = await res.json();
                    
                    if (Array.isArray(data) && data.length >= 80) {
                        const closes = data.map((d: any) => parseFloat(d[4]));
                        const rsi = calculateRSI(closes, 14).pop() || 50;
                        const ema80 = getLatestEMA(closes, 80);
                        const currentPrice = this.realPrices[symbol] || closes[closes.length - 1];
                        
                        const emaDist = ((currentPrice - ema80) / ema80) * 100;
                        const deviation = ((currentPrice - getLatestEMA(closes, 20)) / getLatestEMA(closes, 20)) * 100;
                        
                        const highs = data.map((d: any) => parseFloat(d[2]));
                        const lows = data.map((d: any) => parseFloat(d[3]));
                        const atrs = calculateATR(highs, lows, closes, 14);
                        const atr = atrs[atrs.length - 1] || 0;
                        const volatility = (atr / currentPrice) * 100;

                        const volumes = data.map((d: any) => parseFloat(d[5]));
                        const avgVol = volumes.slice(-20, -1).reduce((a: number, b: number) => a + b, 0) / 19;
                        const volumeSwell = volumes[volumes.length - 1] / avgVol;

                        this.positions.forEach(p => {
                            if (p.symbol === symbol) {
                                p.currentIndicators = {
                                    rsi,
                                    volatility,
                                    deviation,
                                    emaDistance: emaDist,
                                    volumeSwell
                                };
                            }
                        });
                    }
                } catch (e) {
                    // 单个币种失败不影响其他
                }
            }));
        } catch (err) {
            console.error('Failed to update indicators:', err);
        } finally {
            this.isUpdatingIndicators = false;
        }
    }

    private async updateEmaCache() {
        if (this.positions.length === 0 || this.isUpdatingEma) return;
        
        const profitSettings = this.settings.profit;
        if (!profitSettings.enabled) return;

        // Check if ATR mode is active (either as main mode or parallel mode)
        const isAtrActive = profitSettings.profitMode === 'ATR' || (profitSettings.oEnabledMap && profitSettings.oEnabledMap['ATR']);
        if (!isAtrActive) return;

        const atrSettings = profitSettings.atr;
        if (!atrSettings || !atrSettings.emaEnabled) return;

        this.isUpdatingEma = true;
        try {
            for (const pos of this.positions) {
                if (!pos.symbol || pos.symbol === 'USDT' || pos.symbol.trim() === '') continue;
                // Skip if it's a hedge position (optional, but usually trend exit is for main positions)
                if (pos.isHedged || pos.mainPositionId) continue;

                try {
                    let tf = atrSettings.emaTimeframe;
                    if (tf === 'AUTO') {
                        tf = this.getAutoTimeframe(pos.signalTf || '15m');
                    }

                    const safeSymbol = pos.symbol.endsWith('USDT') ? pos.symbol : `${pos.symbol}USDT`;
                    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=${tf}&limit=500`;
                    const res = await fetchWithFallback(url, {}, undefined, this.settings.system.directMode);
                    const data = await res.json();
                    
                    if (Array.isArray(data)) {
                        // Exclude the current live candle (last one) to avoid EMI drift
                        const closes = data.slice(0, -1).map((d: any) => parseFloat(d[4]));
                        const emaValue = getLatestEMA(closes, atrSettings.emaPeriod);
                        pos.currentEmaValue = emaValue;
                    }
                } catch (error) {
                    // Silent fail to avoid spamming logs
                }
            }
        } finally {
            this.isUpdatingEma = false;
        }
    }

    private async fetchExtreme300Price(pos: Position) {
        if (!pos.symbol || pos.symbol === 'USDT' || pos.symbol.trim() === '') return;
        if (pos.periodExtremePrice !== undefined || pos.mainPositionId) return;
        if ((pos as any)._fetchingExtremePrice) return;
        
        (pos as any)._fetchingExtremePrice = true;
        
        try {
            const safeSymbol = pos.symbol.endsWith('USDT') ? pos.symbol : `${pos.symbol}USDT`;
            const days = this.settings.hedging?.extremeHedgeDays ?? 300;
            const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=1d&limit=${days}`;
            const res = await fetchWithFallback(url, {}, undefined, this.settings.system?.directMode);
            const data = await res.json();
            
            if (Array.isArray(data) && data.length > 0) {
                let lowest = Infinity;
                let highest = -Infinity;
                for (const d of data) {
                    const low = parseFloat(d[3]);
                    const high = parseFloat(d[2]);
                    if (!isNaN(low) && low < lowest) lowest = low;
                    if (!isNaN(high) && high > highest) highest = high;
                }
                
                if (lowest !== Infinity && highest !== -Infinity) {
                    pos.periodExtremePrice = pos.side === PositionSide.LONG ? lowest : highest;
                    
                    const entry = pos.entryPrice;
                    let rawRatio = this.settings.hedging?.extremeHedgeTriggerRatio;
                    if (typeof rawRatio !== 'number' || isNaN(rawRatio)) rawRatio = 50;
                    const ratio = rawRatio / 100;
                    
                    if (pos.side === PositionSide.LONG) {
                        const distPercent = ((entry - lowest) / entry) * 100;
                        if (distPercent <= 0) {
                            pos.extremeHedgeTriggerPrice = undefined;
                            this.addLog('WARNING', `📈 [300天历史最低] ${pos.symbol} 开仓价 ${entry.toFixed(4)} 已处于或低于300天历史最低价 ${lowest.toFixed(4)}，极值对冲指标暂不启动（已置空），防爆对冲将严格由常规亏损比例触发。`);
                        } else {
                            const triggerLossPercent = distPercent * ratio;
                            pos.extremeHedgeTriggerPrice = entry * (1 - triggerLossPercent / 100);
                        }
                    } else {
                        const distPercent = ((highest - entry) / entry) * 100;
                        if (distPercent <= 0) {
                            pos.extremeHedgeTriggerPrice = undefined;
                            this.addLog('WARNING', `📈 [300天历史最高] ${pos.symbol} 开仓价 ${entry.toFixed(4)} 已处于或高于300天历史最高价 ${highest.toFixed(4)}，极值对冲指标暂不启动（已置空），防爆对冲将严格由常规亏损比例触发。`);
                        } else {
                            const triggerLossPercent = distPercent * ratio;
                            pos.extremeHedgeTriggerPrice = entry * (1 + triggerLossPercent / 100);
                        }
                    }
                    this.emitUpdate(true);
                } else {
                     this.addLog('WARNING', `⚠️ [300天极值] 获取 ${pos.symbol} 极值数据为空，无法启动极值对冲。`);
                }
            } else {
                 this.addLog('WARNING', `⚠️ [300天极值] 获取 ${pos.symbol} 极值失败，API返回异常或被限流。`);
            }
        } catch (error) {
            this.addLog('DANGER', `❌ [300天极值] 请求 ${pos.symbol} 极值接口发生异常: ${error}`);
            delete (pos as any)._fetchingExtremePrice;
        } finally {
            delete (pos as any)._fetchingExtremePrice;
        }
    }

    private async fetchShortTermExtremePrice(pos: Position) {
        if (!pos.symbol || pos.symbol === 'USDT' || pos.symbol.trim() === '') return;
        if (pos.shortTermExtremeTriggerPrice !== undefined || pos.mainPositionId) return;
        if ((pos as any)._fetchingShortTermExtreme) return;
        
        (pos as any)._fetchingShortTermExtreme = true;
        
        try {
            const safeSymbol = pos.symbol.endsWith('USDT') ? pos.symbol : `${pos.symbol}USDT`;
            const days = this.settings.hedging?.shortTermExtremeDays ?? 7;
            const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=1d&limit=${days}`;
            const res = await fetchWithFallback(url, {}, undefined, this.settings.system?.directMode);
            const data = await res.json();
            
            if (Array.isArray(data) && data.length > 0) {
                let lowest = Infinity;
                let highest = -Infinity;
                for (const d of data) {
                    const low = parseFloat(d[3]);
                    const high = parseFloat(d[2]);
                    if (!isNaN(low) && low < lowest) lowest = low;
                    if (!isNaN(high) && high > highest) highest = high;
                }
                
                if (lowest !== Infinity && highest !== -Infinity) {
                    const entry = pos.entryPrice;
                    let rawRatio = this.settings.hedging?.shortTermExtremeRatio;
                    if (typeof rawRatio !== 'number' || isNaN(rawRatio)) rawRatio = 50;
                    const ratio = rawRatio / 100;
                    
                    if (pos.side === PositionSide.LONG) {
                        const distPercent = ((entry - lowest) / entry) * 100;
                        if (distPercent <= 0) {
                            pos.shortTermExtremeTriggerPrice = undefined;
                        } else {
                            const triggerLossPercent = distPercent * ratio;
                            pos.shortTermExtremeTriggerPrice = entry * (1 - triggerLossPercent / 100);
                        }
                    } else {
                        const distPercent = ((highest - entry) / entry) * 100;
                        if (distPercent <= 0) {
                            pos.shortTermExtremeTriggerPrice = undefined;
                        } else {
                            const triggerLossPercent = distPercent * ratio;
                            pos.shortTermExtremeTriggerPrice = entry * (1 + triggerLossPercent / 100);
                        }
                    }
                    this.emitUpdate(true);
                }
            }
        } catch (error) {
            console.error("Error fetching short term extreme price:", error);
        } finally {
            delete (pos as any)._fetchingShortTermExtreme;
        }
    }

    private runStrategyAnalysis() {
        // Placeholder
    }

    private checkStrategies(): boolean {
        let actionTaken = false;

        if (this.positions.length === 0) {
            if (this.maxGlobalPnlPercent !== 0) {
                this.maxGlobalPnlPercent = 0;
                try {
                    localStorage.removeItem('SAVIOR_MAX_GLOBAL_PNL');
                } catch (e) {}
            }
        }

        // 0. BOOT WARMUP: Prevent accidental close on system reload/boot (15s lock)
        if (Date.now() - this.bootTime < this.WARMUP_PERIOD) {
            return false;
        }

        // 1. WARM-UP CHECK: Ensure all active positions have at least one live price update
        // This prevents "Stale Close" on app restart/refresh
        const positionsReady = this.positions.every(p => this.symbolsWithFreshPrice.has(normalizeSymbol(p.symbol)));
        
        // 1. Check Global Rules (Priority)
        // Only if Global Mode is enabled in settings (either as main mode or parallel mode)
        const profitSettings = this.settings.profit;
        const isGlobalEnabled = profitSettings.enabled && (profitSettings.profitMode === 'GLOBAL' || (profitSettings.oEnabledMap && profitSettings.oEnabledMap['GLOBAL']));
        
        if (isGlobalEnabled && positionsReady) {
            const triggered = checkGlobalRules(
                this.positions,
                this.account,
                this.settings,
                (reason) => {
                    // 修改：触发全局平仓时，平掉所有仓位（包括对冲中和未对冲的）
                    this.batchCloseAllPositions(reason);
                    this.addLog('SUCCESS', `全局止盈/止损触发: 已平仓所有持仓 | ${reason}`);
                },
                this.maxGlobalPnlPercent,
                (val) => {
                    this.maxGlobalPnlPercent = val;
                    try {
                        localStorage.setItem('SAVIOR_MAX_GLOBAL_PNL', val.toString());
                    } catch (e) {}
                }
            );
            if (triggered) return true; // Global close clears unhedged, return immediately
        }

        // 2. Check Individual Position Rules
        // We iterate backwards to safely remove items while iterating
        for (let i = this.positions.length - 1; i >= 0; i--) {
            const position = this.positions[i];
            if (!position || !position.symbol) {
                continue;
            }
            const symbolKey = normalizeSymbol(position.symbol);
            
            // CRITICAL: Skip strategy checking if we don't have fresh price for this specific symbol yet
            const hasPrice = this.symbolsWithFreshPrice.has(symbolKey) || (position.markPrice > 0 && position.entryPrice > 0);
            if (!hasPrice) {
                continue;
            }
            
            // 2.1 Standard Profit/Loss Rules
            let triggered = checkIndividualPositionRules(
                position,
                this.settings,
                (symbol, side, reason, ratio) => {
                    if (ratio && ratio < 100) {
                        this.amputate(position, ratio, reason);
                        // Prevent TP infinite loop by resetting maxPnL for trailing
                        position.maxPnLPercent = position.unrealizedPnLPercentage;
                        // Prevent SL infinite loop by marking it
                        if (reason.includes('止损')) {
                            (position as any)._slTriggered = true;
                        }
                    } else {
                        this.closePosition(symbol, side, reason, position.entryId);
                    }
                    actionTaken = true;
                }
            );
            
            // 2.2 Hedge Guardian Safe Clear Rules (New)
            if (!triggered) {
                triggered = checkSafeClearRules(
                    position,
                    this.settings,
                    (symbol, side, reason) => {
                        this.closePosition(symbol, side, reason, position.entryId);
                        actionTaken = true;
                    }
                );
            }

            // 2.3 Oscillation Guard (Strategy 5)
            if (!triggered) {
                triggered = checkStrategy5_OscillationGuard(
                    position,
                    this.settings,
                    (symbol, side, reason) => {
                        this.closePosition(symbol, side, reason, position.entryId);
                        actionTaken = true;
                    }
                );
            }
        }

        // 3. Check Hedging Rules (一级防爆对冲检测)
        for (let i = this.positions.length - 1; i >= 0; i--) {
            const position = this.positions[i];
            if (!position || !position.symbol) {
                continue;
            }
            const symbolKey = normalizeSymbol(position.symbol);

            // Check price readiness: fresh price or valid active mark & entry prices
            const hasPrice = this.symbolsWithFreshPrice.has(symbolKey) || (position.markPrice > 0 && position.entryPrice > 0);
            if (!hasPrice) {
                continue;
            }

            // Check if position is actually protected by an opposing hedge
            const hasOpposingHedge = this.positions.some(p => 
                normalizeSymbol(p.symbol) === symbolKey && 
                p.side !== position.side && 
                p.amount > 0
            );

            // Self-heal stale in-flight state if no active opposing hedge exists
            // 🔒 [防重保护] 只有在超过 60 秒且确实没有任何在途订单与对冲仓位时才允许安全重置
            if (!hasOpposingHedge && !position.mainPositionId) {
                const isStaleFlight = position.hedgeOrderInFlightTime && (Date.now() - position.hedgeOrderInFlightTime > 60000);
                if (isStaleFlight) {
                    delete position.hedgeOrderInFlight;
                    delete position.hedgeOrderInFlightTime;
                    delete position.hedgeSignalTriggered;
                    position.isHedged = false;
                }
            }

            // 🔒 [平仓冷却保护] 30秒内刚平仓过对冲单，不强行抹去状态或重开
            if (position.lastHedgeClosedAt && (Date.now() - position.lastHedgeClosedAt) < 30000) {
                continue;
            }

            // 🔒 [单主仓单次对冲开仓信号终极锁] 如果在途或已触发对冲信号，坚决不重开
            if (position.hedgeSignalTriggered || position.hedgeOrderInFlight) {
                continue;
            }

            const triggered = checkHedgingRules(
                position,
                this.settings,
                (symbol, side, amount, price, reason) => {
                    this.openHedgePosition(position, side, amount, price, reason);
                    actionTaken = true;
                }
            );

            // Debug Logging for Failed Triggers
            if (!triggered && this.settings.hedging.enabled && this.settings.hedging.triggerLossEnabled !== false) {
                const pnlPercent = position.unrealizedPnLPercentage;
                const threshold = -Math.abs(this.settings.hedging.triggerLossPercent);
                
                if (pnlPercent <= threshold && !position.isHedged) {
                    // Loss condition met, but not triggered. Why?
                    const entryValue = position.amount * position.entryPrice;
                    let reason = "Unknown";
                    
                    if (entryValue < this.settings.hedging.minPosition) reason = `Entry Value (${entryValue.toFixed(2)}) < Min (${this.settings.hedging.minPosition})`;
                    else if (this.settings.stopLoss.fuseEnabled && (position.hedgeRetries || 0) >= this.settings.stopLoss.maxHedgeRetries) reason = "Fuse Tripped";
                    
                    // Only log periodically to avoid spam
                    if (!(position as any)._hasLoggedHedgeSkip) { (position as any)._hasLoggedHedgeSkip = true;
                         this.addLog('WARNING', `⚠️ 对冲未触发: ${position.symbol} 亏损 ${pnlPercent.toFixed(2)}% | 原因: ${reason}`);
                    }
                }
            }
        }

        // 3.5 二次检测启动防爆对冲 (Backup Secondary Detection & Forced Hedging)
        // If a position should be hedged but somehow wasn't, or primary check was bypassed/blocked,
        // this fallback loop executes immediately to guarantee the position is hedged.
        for (let i = this.positions.length - 1; i >= 0; i--) {
            const position = this.positions[i];
            if (!position || !position.symbol) continue;
            const symbolKey = normalizeSymbol(position.symbol);

            const hasPrice = this.symbolsWithFreshPrice.has(symbolKey) || (position.markPrice > 0 && position.entryPrice > 0);
            if (!hasPrice) continue;

            // Check if active opposing hedge exists
            const hasOpposingHedge = this.positions.some(p => 
                normalizeSymbol(p.symbol) === symbolKey && 
                p.side !== position.side && 
                p.amount > 0
            );
            if (hasOpposingHedge || position.mainPositionId) {
                continue;
            }

            // Self-heal stale in-flight state if no active opposing hedge exists
            // 🔒 [防重保护] 只有在超过 60 秒且确实没有任何在途订单与对冲仓位时才允许安全重置
            if (!hasOpposingHedge && !position.mainPositionId) {
                const isStaleFlight = position.hedgeOrderInFlightTime && (Date.now() - position.hedgeOrderInFlightTime > 60000);
                if (isStaleFlight) {
                    delete position.hedgeOrderInFlight;
                    delete position.hedgeOrderInFlightTime;
                    delete position.hedgeSignalTriggered;
                    position.isHedged = false;
                }
            }

            // 🔒 [平仓冷却拦截] 30秒内刚平过对冲，坚决不重开
            if (position.lastHedgeClosedAt && (Date.now() - position.lastHedgeClosedAt) < 30000) {
                continue;
            }

            // 🔒 [单主仓单次对冲开仓信号终极锁] 如果在途或已触发对冲信号，坚决不重开
            if (position.hedgeSignalTriggered || position.hedgeOrderInFlight) {
                continue;
            }

            const hedgeSettings = this.settings.hedging;
            if (!hedgeSettings.enabled) {
                continue;
            }

            // 🛡️ [Minimum Position Size Safeguard]
            const mark = (position.markPrice && position.markPrice > 0) ? position.markPrice : (position.entryPrice || 1);
            const entry = (position.entryPrice && position.entryPrice > 0) ? position.entryPrice : mark;
            const positionValue = position.amount * mark;
            const entryValue = position.amount * entry;
            const initialValue = position.initialAmount ? position.initialAmount * entry : 0;
            const effectiveValue = Math.max(entryValue, positionValue, initialValue, (position.cost_usdt || 0));
            const minPositionThreshold = Number(hedgeSettings.minPosition ?? 10);
            if (effectiveValue < minPositionThreshold) {
                continue;
            }

            // Fuse Check (Secondary bypass if needed, but respect user maxHedgeRetries settings)
            const slSettings = this.settings.stopLoss;
            if (slSettings.fuseEnabled && (position.hedgeRetries || 0) >= slSettings.maxHedgeRetries) {
                continue;
            }

            const pnlPercent = position.unrealizedPnLPercentage;

            // 🔒 [SECURITY_LOCK]: ABSOLUTE LOSS SAFEGUARD
            // We must absolutely block secondary fallback hedging if the position is in profit or breaking even (unrealizedPnLPercentage >= 0).
            // This prevents counter-trend automatic hedging errors on winning trades under any circumstances.
            if (pnlPercent >= 0) {
                continue;
            }

            // 🛡️ [Extreme Price/PnL Anomaly Safeguard]
            if (pnlPercent < -95) {
                console.warn(`[Secondary Hedge Blocked] Anomaly detected for ${position.symbol}: Calculated loss is ${pnlPercent.toFixed(2)}%, which exceeds the -95% safety ceiling. Blocking auto-hedge.`);
                continue;
            }

            let secondaryTriggered = false;
            let secondaryReason = "";

            // A. Check Loss Condition (亏损值触发二次检测 - Bypasses historical extreme to guarantee anti-explosion)
            if (hedgeSettings.triggerLossEnabled !== false && pnlPercent <= -Math.abs(hedgeSettings.triggerLossPercent) + 0.001) {
                secondaryTriggered = true;
                secondaryReason = `[二次防爆检测] 亏损达到 ${hedgeSettings.triggerLossPercent}% 强制触发`;
            }

            // B. Check 300-Day Extreme (300天极值比例对冲二次检测)
            if (!secondaryTriggered && hedgeSettings.extremeHedgeEnabled && position.extremeHedgeTriggerPrice !== undefined) {
                if (position.side === PositionSide.LONG) {
                    if (position.markPrice <= position.extremeHedgeTriggerPrice) {
                        secondaryTriggered = true;
                        secondaryReason = `[二次防爆检测] 价格跌破300天极值对冲启动价 ${position.extremeHedgeTriggerPrice.toFixed(4)} 强制触发`;
                    }
                } else {
                    if (position.markPrice >= position.extremeHedgeTriggerPrice) {
                        secondaryTriggered = true;
                        secondaryReason = `[二次防爆检测] 价格突破300天极值对冲启动价 ${position.extremeHedgeTriggerPrice.toFixed(4)} 强制触发`;
                    }
                }
            }

            // C. Trend Firewall (趋势防火墙二次检测)
            if (!secondaryTriggered && hedgeSettings.trendHedgeEnabled && position.entryEmas) {
                let firewallPrice = 0;
                const period = hedgeSettings.trendHedgeEmaPeriod || 80;
                switch (period) {
                    case 10: firewallPrice = position.entryEmas.ema10; break;
                    case 20: firewallPrice = position.entryEmas.ema20; break;
                    case 40: firewallPrice = position.entryEmas.ema40; break;
                    case 80: firewallPrice = position.entryEmas.ema80; break;
                    default: firewallPrice = position.entryEmas.ema80;
                }
                if (position.side === PositionSide.LONG) {
                    if (position.markPrice <= firewallPrice) {
                        secondaryTriggered = true;
                        secondaryReason = `[二次防爆检测] 价格跌破 EMA${period} 防火墙 强制触发`;
                    }
                } else {
                    if (position.markPrice >= firewallPrice) {
                        secondaryTriggered = true;
                        secondaryReason = `[二次防爆检测] 价格突破 EMA${period} 防火墙 强制触发`;
                    }
                }
            }

            if (secondaryTriggered) {
                // Respect oscillationCheck and extremePrice to prevent unauthorized re-opening of closed hedges,
                // except for extreme 300-day value trigger where historical extreme is bypassed by design.
                let isWorseThanExtreme = true;
                const isExtremeHedge = secondaryReason.includes('300天极值');
                
                if (!isExtremeHedge && hedgeSettings.oscillationCheck === true && position.extremePrice !== undefined) {
                    if (position.side === PositionSide.LONG) {
                        isWorseThanExtreme = position.markPrice < position.extremePrice;
                    } else {
                        isWorseThanExtreme = position.markPrice > position.extremePrice;
                    }
                }

                if (!isWorseThanExtreme) {
                    console.log(`[Secondary Detection Blocked] 🛡️ ${position.symbol} 二次检测对冲被拦截: 开启了震荡防重开保护，且未突破历史极值价格 ${position.extremePrice}`);
                    secondaryTriggered = false;
                }
            }

            if (secondaryTriggered) {
                const hedgeSide = position.side === PositionSide.LONG ? PositionSide.SHORT : PositionSide.LONG;
                let activeHedgeRatio = hedgeSettings.hedgeRatio;
                if (slSettings.hedgeProfitClear) {
                    activeHedgeRatio = slSettings.hedgeOpenRatio;
                } else if (slSettings.callbackProfitClear) {
                    activeHedgeRatio = slSettings.callbackHedgeRatio;
                }

                const originalQty = position.initialAmount !== undefined ? position.initialAmount : position.amount;
                const initialCostUsdt = originalQty * (position.entryPrice || position.markPrice);
                const hedgeAmount = initialCostUsdt * (activeHedgeRatio / 100);

                console.log(`[Backup Hedge Trigger] ⚡ ${position.symbol} triggers backup secondary hedge: ${secondaryReason}`);
                this.openHedgePosition(position, hedgeSide, hedgeAmount, position.markPrice, secondaryReason);
                actionTaken = true;
            }
        }

        // 3.6 三次多重检测启动防爆对冲 (Tertiary Multi-Check Watchdog Loop)
        // Dedicated scan to guarantee no losing position misses hedge execution while strictly respecting extreme price & cooldown
        for (let i = this.positions.length - 1; i >= 0; i--) {
            const position = this.positions[i];
            if (!position || !position.symbol || position.mainPositionId) continue;
            const symbolKey = normalizeSymbol(position.symbol);

            const hasOpposingHedge = this.positions.some(p => 
                normalizeSymbol(p.symbol) === symbolKey && 
                p.side !== position.side && 
                p.amount > 0
            );
            if (hasOpposingHedge) continue;

            // 🔒 [平仓冷却拦截] 30秒内刚平过对冲，坚决不重开
            if (position.lastHedgeClosedAt && (Date.now() - position.lastHedgeClosedAt) < 30000) {
                continue;
            }

            // 🔒 [单主仓单次对冲开仓信号终极锁] 如果在途或已触发对冲信号，坚决不重开
            if (position.hedgeSignalTriggered || position.hedgeOrderInFlight) {
                continue;
            }

            const hedgeSettings = this.settings.hedging;
            if (!hedgeSettings || !hedgeSettings.enabled) continue;
            if (hedgeSettings.triggerLossEnabled === false) continue;

            const entryValue = position.amount * position.entryPrice;
            const minPositionThreshold = Number(hedgeSettings.minPosition ?? 10);
            if (entryValue < minPositionThreshold) continue;

            const slSettings = this.settings.stopLoss;
            if (slSettings?.fuseEnabled && (position.hedgeRetries || 0) >= (slSettings.maxHedgeRetries || 3)) {
                continue;
            }

            const pnlPercent = position.unrealizedPnLPercentage;
            const triggerLoss = Number(hedgeSettings.triggerLossPercent ?? 1.0);

            // If loss meets or exceeds the trigger threshold and is within valid bounds
            if (pnlPercent < 0 && pnlPercent >= -95 && pnlPercent <= -Math.abs(triggerLoss) + 0.001) {
                // 🔒 [震荡防重开检查] 必须突破历史极值价格才允许二次对冲
                let isWorseThanExtreme = true;
                if (hedgeSettings.oscillationCheck === true && position.extremePrice !== undefined) {
                    if (position.side === PositionSide.LONG) {
                        isWorseThanExtreme = (position.markPrice || position.entryPrice) < position.extremePrice;
                    } else {
                        isWorseThanExtreme = (position.markPrice || position.entryPrice) > position.extremePrice;
                    }
                }

                if (!isWorseThanExtreme) {
                    continue;
                }

                position.isHedged = false; // Reset flag only after all validation passes
                const hedgeSide = position.side === PositionSide.LONG ? PositionSide.SHORT : PositionSide.LONG;
                let activeHedgeRatio = hedgeSettings.hedgeRatio || 100;
                if (slSettings?.hedgeProfitClear) {
                    activeHedgeRatio = slSettings.hedgeOpenRatio || 100;
                } else if (slSettings?.callbackProfitClear) {
                    activeHedgeRatio = slSettings.callbackHedgeRatio || 100;
                }

                const originalQty = position.initialAmount !== undefined ? position.initialAmount : position.amount;
                const initialCostUsdt = originalQty * (position.entryPrice || position.markPrice);
                const hedgeAmount = initialCostUsdt * (activeHedgeRatio / 100);
                const reason = `[三次多重防爆检测] ${position.symbol} 实际亏损 ${pnlPercent.toFixed(2)}% 已达到防爆阈值 -${triggerLoss}%${position.extremePrice !== undefined ? ' 且突破历史极值' : ''} 立即开仓对冲`;

                console.log(`[Tertiary Hedge Watchdog] ⚡ ${reason}`);
                this.openHedgePosition(position, hedgeSide, hedgeAmount, position.markPrice || position.entryPrice, reason);
                actionTaken = true;
            }
        }

        // 4. Check Rescue Rules
        for (let i = this.positions.length - 1; i >= 0; i--) {
            const position = this.positions[i];
            if (!position || !position.symbol) {
                continue;
            }
            const symbolKey = normalizeSymbol(position.symbol);

            // CRITICAL: Skip rescue if no fresh price yet
            const hasPrice = this.symbolsWithFreshPrice.has(symbolKey) || (position.markPrice > 0 && position.entryPrice > 0);
            if (!hasPrice) {
                continue;
            }

            const triggered = checkRescueRules(
                position,
                this.positions,
                this.settings,
                (mainId, hedgeId, reason) => {
                    this.closePair(mainId, hedgeId, reason);
                    actionTaken = true;
                },
                (pos, ratio, reason) => {
                    this.amputate(pos, ratio, reason);
                    actionTaken = true;
                },
                (pos, reason) => {
                    this.refill(pos, reason);
                    actionTaken = true;
                },
                (hedgeId, profit, reason) => {
                    this.closeHedgeOnly(hedgeId, profit, reason);
                    actionTaken = true;
                },
                (pos, reason) => {
                    // Note: Reopen rule now triggers exclusively on "断臂求生盈利清仓" inside closePair.
                    // This old callback is ignored to prevent reopening on amputation cuts.
                },
                (type, message) => {
                    this.addLog(type as any, message);
                }
            );
        }

        return actionTaken;
    }

    public batchCloseAllPositions(reason: string | boolean = 'Manual Batch Close') {
        if (this.positions.length === 0) return;
        
        const isSilent = reason === true;
        const reasonStr = isSilent ? 'Hard Reset Clear' : (reason as string);
        
        const totalPnL = this.positions.reduce((sum, p) => sum + p.unrealizedPnL, 0);
        const now = Date.now();

        // Create trade logs for all positions (if not silent)
        this.positions.forEach(p => {
            if (!isSilent) {
                this.recordTradeLog(p, reasonStr);
            }
            // Add to cooldown to prevent immediate re-open if scanner finds same signal
            this.cooldowns[`${p.symbol}_${p.side}`] = now + 120000; // Increase to 2 minutes for batch close
        });
        
        this.saveCooldowns();
        this.positions = [];
        this.addLog('WARNING', `全部平仓: ${reasonStr}${!isSilent ? ` (总盈亏: ${totalPnL.toFixed(2)})` : ''}`);
        this.emitUpdate(true);
    }

    private updateAccountStats() {
        // Placeholder
        const totalUnrealizedPnL = this.positions.reduce((acc, p) => acc + p.unrealizedPnL, 0);
        this.account.totalBalance = this.account.marginBalance + totalUnrealizedPnL;
    }

    public emitUpdate(forceInstant: boolean = false) {
        if (forceInstant) {
            if (this.updateTimer) {
                clearTimeout(this.updateTimer);
                this.updateTimer = null;
            }
            this.pendingUpdate = false;
        }

        if (this.pendingUpdate) return;
        
        const now = Date.now();
        const throttleMs = 100; // UI 刷新节流：100ms (Reduced for better sync)
        
        const doUpdate = () => {
            this.pendingUpdate = false;
            this.lastEmitTime = Date.now();
            
            if (this.updateCallback) {
                // 限制发送到 UI 的日志数量，减少序列化压力
                const limitedTradeLogs = this.tradeLogs.slice(0, 2000);
                const limitedLogs = this.logs.slice(0, 500);

                this.updateCallback(
                    { ...this.account },
                    [ ...this.positions ],
                    limitedLogs,
                    null,
                    limitedTradeLogs,
                    [ ...this.systemEvents ],
                    null,
                    null
                );
            }
        };

        if (forceInstant) {
            doUpdate();
            return;
        }

        if (now - this.lastEmitTime > throttleMs) {
            this.pendingUpdate = true;
            // 使用 microtask 确保在当前逻辑执行完后立即更新
            Promise.resolve().then(doUpdate);
        } else {
            if (this.updateTimer) return;
            this.pendingUpdate = true;
            this.updateTimer = setTimeout(() => {
                this.updateTimer = null;
                doUpdate();
            }, throttleMs - (now - this.lastEmitTime));
        }
    }

    public tick(enableStrategies: boolean = true) {
      const now = Date.now();
      let stateChanged = false;

      // --- 0. SYSTEM HEARTBEAT LOG ---
      if (now - this.lastHeartbeatTime > 60000) {
          this.lastHeartbeatTime = now;
          if (this.positions.length > 0 || enableStrategies) {
              const activeCount = this.positions.length;
              this.addLog('INFO', `🟢 系统心跳: 引擎运行正常 | 监控: ${activeCount} | 延迟: <100ms`);
              stateChanged = true;
          }
      }

      // --- 0.1 EMA CACHE UPDATE ---
      if (now - this.lastEmaCheckTime > 5000) { 
          this.lastEmaCheckTime = now;
          this.updateEmaCache();
      }

      // --- 0.2 INDICATOR UPDATE (For AI & DNA) ---
      if (now - this.lastIndicatorCheckTime > 10000) {
          this.lastIndicatorCheckTime = now;
          this.updateIndicators();
      }

      // --- 0.3 FETCH EXTREME 300 DAYS PRICES ---
      if (this.settings.hedging?.extremeHedgeEnabled) {
          for (const pos of this.positions) {
              if (pos.periodExtremePrice === undefined && !pos.mainPositionId && pos.symbol && pos.symbol !== 'USDT') {
                  this.fetchExtreme300Price(pos);
              }
          }
      }

      if (this.settings.hedging?.shortTermExtremeEnabled) {
          for (const pos of this.positions) {
              if (pos.shortTermExtremeTriggerPrice === undefined && !pos.mainPositionId && pos.symbol && pos.symbol !== 'USDT') {
                  this.fetchShortTermExtremePrice(pos);
              }
          }
      }

      // --- STRATEGY ADVISOR LOOP ---
      if (this.settings.stopLoss.advisor?.enabled && (now - this.lastAdvisorTime > 15000)) {
          this.lastAdvisorTime = now;
          this.runStrategyAnalysis(); 
      }

      // 1. Update Prices & PnL
      let foundPricesCount = 0;
      this.positions.forEach(p => {
          // Robust Price Fallback: Real > Mark > Entry
          const normalizedSymbol = normalizeSymbol(p.symbol);
          let wsPrice = this.realPrices[normalizedSymbol];
          
          const isMajorCoinVal = isMajorCoin(normalizedSymbol);

          if (!wsPrice) {
              // Only try 1000x fallback for non-major coins to prevent accidental magnitude errors for things like XMR/BTC
              if (!isMajorCoinVal) {
                  if (normalizedSymbol.startsWith('1000')) {
                     const base = normalizedSymbol.replace(/^1000/, '');
                     if (this.realPrices[base]) wsPrice = this.realPrices[base] * 1000;
                  } else {
                     const scaled = '1000' + normalizedSymbol;
                     if (this.realPrices[scaled]) wsPrice = this.realPrices[scaled] / 1000;
                  }
              }
          }

          if (wsPrice && p.entryPrice > 0) {
              const ratio = wsPrice / p.entryPrice;
              // If it's a major coin, we usually don't scale. 
              // HOWEVER, if the ratio is EXACTLY ~1000 or ~0.001, it's almost certainly a decimal error from a bad data source.
              // We should fix it anyway if it leads to insane PNL (>500% or <-90%).
              const isInsane = ratio > 500 || ratio < 0.002;
              
              if (isInsane) {
                  if (!isMajorCoinVal) {
                      if (ratio > 500) wsPrice = wsPrice / 1000;
                      else if (ratio < 0.002) wsPrice = wsPrice * 1000;
                  } else {
                      // For major coins, only scale if it's a blatant mistake (ratio ~1000)
                      // This prevents "2000U loss" on XMR if a bad price of 0.16 comes in while entry was 160.
                      if (ratio > 500 || ratio < 0.002) {
                           const corrected = ratio > 500 ? wsPrice / 1000 : wsPrice * 1000;
                           const correctedRatio = corrected / p.entryPrice;
                           // If correction brings us back to reasonable territory (within 20% of entry), apply it.
                           if (correctedRatio > 0.5 && correctedRatio < 2.0) {
                                wsPrice = corrected;
                                if (now - ((p as any)._lastScaleLog || 0) > 60000) {
                                    console.warn(`[Simulator] Forced magnitude correction for major coin ${p.symbol}: ${p.markPrice} -> ${wsPrice} (Entry: ${p.entryPrice})`);
                                    (p as any)._lastScaleLog = now;
                                }
                           }
                      }
                  }
              }
          }
          
          if (wsPrice) {
            foundPricesCount++;
            p.markPrice = wsPrice;
          } else {
             // Diagnostic for missing prices
             if (now - ((p as any)._lastLookupLog || 0) > 30000) {
                 const availableCount = Object.keys(this.realPrices).length;
                 const sampleSymbols = Object.keys(this.realPrices).slice(0, 5).join(', ');
                 console.warn(`[Simulator] Missing price for ${normalizedSymbol}. Found ${availableCount} other symbols. (Samples: ${sampleSymbols})`);
                 (p as any)._lastLookupLog = now;
             }
          }

          const currentPrice = wsPrice || p.markPrice || p.entryPrice;

          // Check if price valid to prevent NaN/Crash
          if (currentPrice > 0) { 
              this.symbolsWithFreshPrice.add(normalizedSymbol);
              const priceChanged = Math.abs(p.markPrice - currentPrice) > 0.000000000001;
              const isInitial = p.unrealizedPnL === 0;

              p.markPrice = currentPrice;

              // 1. Calculate Price Difference based on Direction
              const priceDiff = p.side === PositionSide.LONG
                  ? currentPrice - p.entryPrice
                  : p.entryPrice - currentPrice;

              // 2. Calculate PnL Value (USDT)
              // Ensure amount is valid
              if (isNaN(p.amount)) {
                  const fallbackAmount = 100 / (p.entryPrice || 60000); // 100U fallback if quantity is lost
                  p.amount = fallbackAmount;
              }
              
              p.unrealizedPnL = priceDiff * p.amount;

              // 3. Calculate PnL Percentage (Raw Price Change % ONLY, NO LEVERAGE)
              if (p.entryPrice > 0) {
                  const rawPct = (priceDiff / p.entryPrice) * 100;
                  p.unrealizedPnLPercentage = isFinite(rawPct) ? rawPct : 0;
                  
                  // CRITICAL: Diagnostic for extreme PNL
                  if (Math.abs(p.unrealizedPnLPercentage) > 500 || (p.symbol === 'AERGO' && Math.abs(p.unrealizedPnLPercentage) > 20)) {
                    if (now - ((p as any)._lastExtremePnlLog || 0) > 10000) {
                       console.error(`[Simulator] Extreme PNL Alert: ${p.symbol} ${p.side} | PNL: ${p.unrealizedPnLPercentage.toFixed(2)}% | Mark: ${p.markPrice} | Entry: ${p.entryPrice}`);
                       (p as any)._lastExtremePnlLog = now;
                    }
                  }
              } else {
                  p.unrealizedPnLPercentage = 0;
              }

              // Diagnostic: If price is significantly different from entry but PnL is still 0
              if (Math.abs(priceDiff) > 0.000001 && Math.abs(p.unrealizedPnL) < 0.000001) {
                  if (now - (p as any)._lastDiagLog > 30000) {
                      this.addLog('WARNING', `⚠️ 盈亏计算异常: ${p.symbol} 价格波动 ${priceDiff.toFixed(4)}, 但盈亏为0 (数量: ${p.amount})`);
                      (p as any)._lastDiagLog = now;
                  }
              }

              // Update Max PnL for trailing
              if (p.unrealizedPnLPercentage > 0) {
                  if (p.maxPnLPercent === undefined || p.unrealizedPnLPercentage > p.maxPnLPercent) {
                      p.maxPnLPercent = p.unrealizedPnLPercentage;
                  }
              }

              // Always consider state changed if we have any active positions being calculated
              stateChanged = true;
          } else {
              // Price is 0 or invalid
              if (now - (p as any)._lastPriceErrLog > 30000) {
                  this.addLog('DANGER', `❌ 错误: 无法获取 ${p.symbol} 的有效价格`);
                  (p as any)._lastPriceErrLog = now;
              }
          }
      });

      // 1.5 Check Pending Auto Opens (Rule A)
      if (this.checkPendingAutoOpens()) {
          stateChanged = true;
      }

      // 2. Check Strategies
      // Always check strategies if there are active positions (to ensure Hedge Guardian works)
      // We run strategy checks in both simulated and real-trading modes. In real trading mode,
      // the triggered strategies will execute real orders on Binance via the registered callbacks.
      if (enableStrategies || this.positions.length > 0) {
          if (this.checkStrategies()) {
              stateChanged = true;
          }
      }

      // 3. Update Account & Emit
      if (stateChanged) {
          this.updateAccountStats();
          this.emitUpdate();
      }
  }

    public verifyPositions(tradeLogs: TradeLog[]) {
        this.positions.forEach(pos => {
            this.verifyPosition(pos, tradeLogs);
        });
    }

    public updateRealBalance(balance: number) {
        this.account.marginBalance = balance;
        this.account.binanceRealBalance = balance;
    }

    public verifyPosition(pos: Position, tradeLogs: TradeLog[]) {
        const log = tradeLogs.find(l => l.entry_id === pos.entryId);
        if (log) {
            console.log(`[Price Verification] Symbol: ${pos.symbol}, PosEntry: ${pos.entryPrice}, LogEntry: ${log.entry_price}, entryId: ${pos.entryId}, LogEntryId: ${log.entry_id}`);
            if (Math.abs(log.entry_price - pos.entryPrice) > 0.000001) { // Use a small epsilon for float comparison
                const oldPrice = pos.entryPrice;
                
                // Replace the position object with a new reference
                const newPos = { ...pos, entryPrice: log.entry_price };
                console.log(`[Price Verification] Updating ${pos.symbol} price to ${log.entry_price}`);
                this.positions = this.positions.map(p => p.entryId === pos.entryId ? newPos : p);
                console.log(`[Price Verification] New positions length: ${this.positions.length}, Found: ${this.positions.some(p => p.entryId === pos.entryId && p.entryPrice === log.entry_price)}`);
                
                this.addLog('SUCCESS', `价格手动/自动修正: ${pos.symbol} (${pos.side}) 开仓价格已从 ${oldPrice.toFixed(4)} 修正为 ${log.entry_price.toFixed(4)} (基于原始交易记录)`);
                this.emitUpdate(true);
            } else {
                console.log(`[Price Verification] Prices match for ${pos.symbol}`);
            }
        } else {
            console.warn(`[Price Verification] No trade log found for position entryId: ${pos.entryId}. Available log ids: ${tradeLogs.map(l => l.entry_id).slice(0, 5).join(', ')}...`);
        }
    }
}
