
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
import { debtManager } from './debtManager';

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
    public onLog?: (type: 'INFO' | 'SUCCESS' | 'WARNING' | 'DANGER', message: string, immediate?: boolean) => void;
    
    private lastHeartbeatTime: number = 0;
    private lastEmaCheckTime: number = 0;
    private lastIndicatorCheckTime: number = 0;
    private lastAdvisorTime: number = 0;
    private isNetworkHealthy: boolean = true;
    private lastNetworkStatusLogTime: number = 0;
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
    private processedDebtOrderKeys: Set<string> = new Set(); // 🔒【负债账单只记入一次铁律】已记入负债的砍仓订单与事件Key注册表

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

    // 🔒 [日线极值缓存与限流防打爆冷却池]
    private extremeCache: Map<string, { lowest: number; highest: number; timestamp: number }> = new Map();
    private extremeFetchCooldown: Map<string, number> = new Map();

    public isInFlightClosing(symbol: string, side?: PositionSide): boolean {
        const cleanSymbol = normalizeSymbol(symbol);
        if (side) {
            const key = `${cleanSymbol}_${side}`;
            return this.inFlightClosingPool.has(key) || this.inFlightClosingPool.has(cleanSymbol);
        }
        return this.inFlightClosingPool.has(cleanSymbol) || 
               this.inFlightClosingPool.has(`${cleanSymbol}_${PositionSide.LONG}`) || 
               this.inFlightClosingPool.has(`${cleanSymbol}_${PositionSide.SHORT}`);
    }

    public isRecentlyClosed(symbol: string, side?: PositionSide): boolean {
        const cleanSymbol = normalizeSymbol(symbol);
        const now = Date.now();
        if (side) {
            const key = `${cleanSymbol}_${side}`;
            const t = this.recentlyClosedKeys.get(key);
            return !!(t && (now - t < 25000));
        }
        const t1 = this.recentlyClosedKeys.get(`${cleanSymbol}_${PositionSide.LONG}`);
        const t2 = this.recentlyClosedKeys.get(`${cleanSymbol}_${PositionSide.SHORT}`);
        return !!((t1 && (now - t1 < 25000)) || (t2 && (now - t2 < 25000)));
    }

    public registerInFlightClosing(symbol: string, side: PositionSide, amount: number, retainLocally: boolean = false) {
        const cleanSymbol = normalizeSymbol(symbol);
        const key = `${cleanSymbol}_${side}`;
        const record = {
            symbol: cleanSymbol,
            side,
            amount,
            requestTime: Date.now(),
            retryCount: 0
        };
        this.inFlightClosingPool.set(key, record);
        this.inFlightClosingPool.set(cleanSymbol, record);
        
        // 🔒 立即给内存持仓打上在途平仓状态标记，全系统策略立即感知拦截
        const targetPos = this.positions.find(p => normalizeSymbol(p.symbol) === cleanSymbol && (p.side === side || (p.side as any) === 'BOTH'));
        if (targetPos) {
            targetPos.isClosing = true;
            targetPos.isBeingClosed = true;
        }

        if (!retainLocally) {
            this.removePositionLocally(cleanSymbol, side);
        }
    }

    public registerInFlightBatchClose(positionsToClose: Position[]) {
        const now = Date.now();
        positionsToClose.forEach(pos => {
            const cleanSymbol = normalizeSymbol(pos.symbol);
            const key = `${cleanSymbol}_${pos.side}`;
            const record = {
                symbol: cleanSymbol,
                side: pos.side,
                amount: pos.amount,
                requestTime: now,
                retryCount: 0
            };
            this.inFlightClosingPool.set(key, record);
            this.inFlightClosingPool.set(cleanSymbol, record);
            pos.isClosing = true;
            pos.isBeingClosed = true;
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
        return this.positions.filter(p => p && (p.amount || 0) > 0.0001 && !p.isAmputatedToZero && !p.isBeingClosed);
    }

    public setPositions(newPositions: Position[]) {
        const oldPositions = [...this.positions];
        const updatedPositions: Position[] = [];

        const isReal = this.settings.system?.realTrading;
        const isFirstSync = isReal && !this.initialSyncCompleted;

        // 0. Filter out positions that are still in-flight closing (within buffer window)
        const now = Date.now();
        const filteredNewPositions: Position[] = [];
        const validNewPositions = (newPositions || []).filter(np => np && (np.amount || 0) > 0.0001 && !np.isAmputatedToZero && !np.isBeingClosed);

        for (const np of validNewPositions) {
            const sym = normalizeSymbol(np.symbol);
            const key = `${sym}_${np.side}`;
            const inFlight = this.inFlightClosingPool.get(key);

            if (inFlight) {
                const elapsed = now - inFlight.requestTime;
                
                // Check if already closed in logs or recently closed keys (exclude partial amputation/cut logs)
                const isAlreadyClosed = this.recentlyClosedKeys.has(key) || this.tradeLogs.some(l => 
                    normalizeSymbol(l.symbol) === sym && 
                    l.status === 'CLOSED' && 
                    l.direction === np.side && 
                    !l.exit_reason?.includes('砍仓') &&
                    !l.exit_reason?.includes('断臂') &&
                    !l.exit_reason?.includes('减仓') &&
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
                
                const isOldSymbolUnderActiveHedge = symbolAllOld.some(p => p.isHedged || !!p.mainPositionId || (p.isAmputated && (p.amputatedAmount || 0) > 0) || (p.cumulativeAmputationLoss || 0) > 0 || (p.cumulativeHedgeLoss || 0) > 0) ||
                    !!newPos.isHedged || !!newPos.mainPositionId || (newPos.cumulativeAmputationLoss || 0) > 0 || (newPos.cumulativeHedgeLoss || 0) > 0 || this.amputatedSymbolsInCycle.has(cleanSym);
                
                const maxSymbolAmpLoss = Math.max(
                    0, 
                    ...symbolAllOld.map(p => p.cumulativeAmputationLoss || 0), 
                    ...matchingOldPositions.map(p => p.cumulativeAmputationLoss || 0),
                    newPos.cumulativeAmputationLoss || 0
                );
                const maxSymbolHedgeLoss = Math.max(
                    0, 
                    ...symbolAllOld.map(p => p.cumulativeHedgeLoss || 0), 
                    ...matchingOldPositions.map(p => p.cumulativeHedgeLoss || 0),
                    newPos.cumulativeHedgeLoss || 0
                );
                const maxSymbolAmpCount = Math.max(
                    0, 
                    ...symbolAllOld.map(p => p.amputationCount || 0), 
                    ...matchingOldPositions.map(p => p.amputationCount || 0),
                    newPos.amputationCount || 0
                );
                
                // 🔒 精确识别被砍仓位本方：只要该方向自身处于砍仓标记或有砍仓扣减数量，且两边不处于等量对冲时即保持 isAmputatedState
                const opposingInOld = symbolAllOld.find(p => p.side !== newPos.side);
                const opposingInNew = filteredNewPositions.find(p => normalizeSymbol(p.symbol) === cleanSym && p.side !== newPos.side);
                const effectiveOpposingAmt = opposingInNew ? opposingInNew.amount : (opposingInOld ? opposingInOld.amount : 0);
                const isOpposingEqual = effectiveOpposingAmt > 0 && Math.abs(newPos.amount - effectiveOpposingAmt) <= Math.max(newPos.amount, effectiveOpposingAmt) * 0.05;

                let mySideAmpAmount = matchingOldPositions.find(p => (p.amputatedAmount || 0) > 0)?.amputatedAmount || (primaryOldPos.isAmputated ? (primaryOldPos.amputatedAmount || 0) : 0);
                let isAmputatedState = !isOpposingEqual && (primaryOldPos.isAmputated && mySideAmpAmount > 0);

                // 🔒 [方案3：实盘持仓恢复平衡权威自愈引擎]
                // 当币安实盘双向持仓数量已对称平衡，但本地仍残留被砍标记时，权威证实补仓已成交，立即自愈解除待补状态！
                if (isOpposingEqual && (primaryOldPos.isAmputated || mySideAmpAmount > 0)) {
                    console.log(`[MarketSimulator GroundTruth Self-Heal] 🛡️ 权威检测到币安实盘 ${cleanSym} 双向持仓已恢复平衡 (${newPos.amount})，证实补仓已成功！自动解除待补状态。`);
                    primaryOldPos.isAmputated = false;
                    primaryOldPos.amputatedAmount = 0;
                    delete primaryOldPos.amputationEntryPrice;
                    mySideAmpAmount = 0;
                    isAmputatedState = false;
                    this.inFlightRefillPool.delete(`${cleanSym}_${newPos.side}`);
                    this.lastRefillTimestampMap.set(`${cleanSym}_${newPos.side}`, Date.now());
                    this.amputatedSymbolsInCycle.delete(cleanSym);

                    const hasRecentRefillLog = this.tradeLogs.some(l => 
                        normalizeSymbol(l.symbol) === cleanSym && 
                        l.direction === newPos.side && 
                        (l.exit_reason?.includes('补仓') || l.events?.some(e => e.action?.includes('补仓'))) &&
                        (Date.now() - (l.entry_timestamp || 0) < 120000)
                    );
                    if (!hasRecentRefillLog) {
                        const now = Date.now();
                        const isHedgePos = this.isHedgePosition(primaryOldPos);
                        const refillActionName = isHedgePos ? '防爆对冲补仓' : '原仓位补仓';
                        const refillLogEntry: TradeLog = {
                            symbol: newPos.symbol,
                            entry_id: `${primaryOldPos.entryId || newPos.symbol}_heal_refill_${now}`,
                            parent_entry_id: primaryOldPos.entryId,
                            status: 'OPEN',
                            is_hedge: isHedgePos,
                            entry_timestamp: now,
                            direction: newPos.side,
                            cost_usdt: newPos.amount * (newPos.markPrice || newPos.entryPrice),
                            entry_price: newPos.markPrice || newPos.entryPrice,
                            current_amount: newPos.amount,
                            exit_reason: `${refillActionName} (实盘持仓平衡自愈对账)`,
                            events: [{
                                timestamp: now,
                                action: refillActionName,
                                price: newPos.markPrice || newPos.entryPrice,
                                amount: newPos.amount,
                                reason: '实盘持仓平衡自愈对账'
                            }]
                        };
                        this.tradeLogs.unshift(refillLogEntry);
                    }
                }

                // 🔒 [自愈兜底恢复]：如果原标记因网络重连或重启刷新丢失，严格比对最新砍仓与最新补仓流水时间
                if (!isAmputatedState && !primaryOldPos.isAmputated && opposingInOld && (opposingInOld.amount - newPos.amount) > (opposingInOld.amount * 0.2)) {
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
                    const cutTime = latestCutLog?.exit_timestamp || latestCutLog?.entry_timestamp || 0;
                    const refillTime = latestRefillLog?.entry_timestamp || latestRefillLog?.exit_timestamp || 0;
                    // 仅当砍仓发生在补仓之后（即存在尚未补仓的真实砍仓），且真实流水中有记录砍掉数量时才恢复
                    if (latestCutLog && (!latestRefillLog || cutTime > refillTime)) {
                        const recoveredCutQty = (latestCutLog.current_amount && latestCutLog.current_amount > 0) ? latestCutLog.current_amount : 0;
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

                const realWsPrice = this.realPrices[cleanSym];

                // Preserve original entry ID, time, and custom local attributes
                const preservedChainId = primaryOldPos.chainId || matchingOldPositions.find(p => p.chainId)?.chainId || newPos.chainId || `CHAIN_${cleanSym}_${primaryOldPos.entryTime || Date.now()}`;
                const mergedPos: Position = {
                    ...newPos,
                    chainId: preservedChainId,
                    entryId: primaryOldPos.entryId || newPos.entryId,
                    entryTime: primaryOldPos.entryTime || newPos.entryTime,
                    amount: newPos.amount, // 保持实盘或最新来源的真实完整仓位，严禁碎片化
                    markPrice: (realWsPrice && realWsPrice > 0)
                        ? realWsPrice
                        : (primaryOldPos.markPrice > 0 ? primaryOldPos.markPrice : newPos.markPrice),
                    amputationEntryPrice: primaryOldPos.amputationEntryPrice,
                    originalEntryPrice: primaryOldPos.originalEntryPrice || primaryOldPos.entryPrice || newPos.entryPrice,
                    signalTf: primaryOldPos.signalTf || newPos.signalTf,
                    signalCandle: primaryOldPos.signalCandle || newPos.signalCandle,
                    entryEmas: primaryOldPos.entryEmas || newPos.entryEmas,
                    isHedged: isOldSymbolUnderActiveHedge || matchingOldPositions.some(p => p.isHedged) || !!primaryOldPos.isHedged || (!!opposingInOld && (opposingInOld.amount || 0) > 0.0001),
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
                    amputationTriggered: primaryOldPos.amputationTriggered || matchingOldPositions.some(p => p.amputationTriggered),
                    maxPnLAfterAmputationTrigger: primaryOldPos.maxPnLAfterAmputationTrigger ?? matchingOldPositions.find(p => p.maxPnLAfterAmputationTrigger !== undefined)?.maxPnLAfterAmputationTrigger,
                    maxPnLPercentAfterAmputationTrigger: primaryOldPos.maxPnLPercentAfterAmputationTrigger ?? matchingOldPositions.find(p => p.maxPnLPercentAfterAmputationTrigger !== undefined)?.maxPnLPercentAfterAmputationTrigger,
                    lastLoggedPeakPercent: primaryOldPos.lastLoggedPeakPercent ?? matchingOldPositions.find(p => p.lastLoggedPeakPercent !== undefined)?.lastLoggedPeakPercent,
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
                this.recentlyClosedKeys.delete(lookupKey);
                this.recentlyClosedKeys.delete(symbolKey);
                this.inFlightClosingPool.delete(lookupKey);
                this.inFlightClosingPool.delete(symbolKey);
                const pendingProps = this.pendingRealOpenProps ? this.pendingRealOpenProps[lookupKey] : undefined;

                const newChainId = newPos.chainId || pendingProps?.chainId || `CHAIN_${symbolKey}_${entryTime}`;
                const processedPos: Position = {
                    ...newPos,
                    chainId: newChainId,
                    entryId,
                    entryTime,
                    originalEntryPrice: newPos.entryPrice,
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

        // 1.8 无论模拟模式还是实盘交易，保全处于被砍待补仓状态 (isAmputated 且 amputatedAmount > 0) 的活跃被砍仓位，确保回踩补仓引擎能够持续监听并即时补回
        for (const oldPos of oldPositions) {
            const cleanSym = normalizeSymbol(oldPos.symbol);
            const lookupKey = `${cleanSym}_${oldPos.side}`;
            const isUnderActiveAmp = (oldPos.isAmputated && (oldPos.amputatedAmount || 0) > 0 && (oldPos.amount || 0) > 0.0001) &&
                updatedPositions.some(p => normalizeSymbol(p.symbol) === cleanSym && p.side !== oldPos.side && p.amount > 0);
            const isUnderSimActiveHedge = !isReal && (oldPos.isHedged || !!oldPos.mainPositionId) && (oldPos.amount || 0) > 0.0001;
            // 🛡️ 实盘对冲仓位在途与初建保全：若该对冲仓位是在最近 25 秒内创建/更新的，在币安 REST 尚未返回该对冲仓位前，严格予以保全，严禁被暂时的 REST 延迟或缓存覆盖冲掉
            const isRecentRealHedge = isReal && (oldPos.isHedged || !!oldPos.mainPositionId || oldPos.entryId?.includes('hedge') || oldPos.entryId?.includes('instant_open')) && (Date.now() - (oldPos.entryTime || 0) < 25000) && (oldPos.amount || 0) > 0.0001;
            const alreadyUpdated = updatedPositions.some(p => normalizeSymbol(p.symbol) === cleanSym && p.side === oldPos.side);
            const isRecentlyClosed = this.recentlyClosedKeys.has(lookupKey);

            if ((isUnderActiveAmp || isUnderSimActiveHedge || isRecentRealHedge) && !alreadyUpdated && !isRecentlyClosed) {
                console.log(`[MarketSimulator] 🛡️ 保全被砍待补或新建立对冲仓位: ${oldPos.symbol} (${oldPos.side}) | 待补/对冲数量: ${oldPos.amputatedAmount || oldPos.amount}`);
                updatedPositions.push(oldPos);
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
                    // C. Identify based on memory state before sync
                    else {
                        const memPosA = this.positions.find(p => p.entryId === posA.entryId || (normalizeSymbol(p.symbol) === sym && p.side === posA.side));
                        const memPosB = this.positions.find(p => p.entryId === posB.entryId || (normalizeSymbol(p.symbol) === sym && p.side === posB.side));
                        if (memPosA?.mainPositionId) {
                            main = posB;
                            hedge = posA;
                        } else if (memPosB?.mainPositionId) {
                            main = posA;
                            hedge = posB;
                        } else if (memPosA?.triggerReason?.includes('防爆对冲') && !memPosB?.triggerReason?.includes('防爆对冲')) {
                            hedge = posA;
                            main = posB;
                        } else if (memPosB?.triggerReason?.includes('防爆对冲') && !memPosA?.triggerReason?.includes('防爆对冲')) {
                            hedge = posB;
                            main = posA;
                        } else {
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
                            } else if ((posA.entryTime || 0) < (posB.entryTime || 0)) {
                                main = posA;
                                hedge = posB;
                            } else if ((posB.entryTime || 0) < (posA.entryTime || 0)) {
                                main = posB;
                                hedge = posA;
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
                        
                        // 同步冲顶解套与步进日志记录状态，确保主仓统筹时不丢失冲顶和步进进度
                        if (!main.amputationTriggered && hedge.amputationTriggered) {
                            main.amputationTriggered = true;
                            main.maxPnLAfterAmputationTrigger = hedge.maxPnLAfterAmputationTrigger;
                            main.maxPnLPercentAfterAmputationTrigger = hedge.maxPnLPercentAfterAmputationTrigger;
                            main.lastLoggedPeakPercent = hedge.lastLoggedPeakPercent;
                        } else if (main.amputationTriggered && !hedge.amputationTriggered) {
                            hedge.amputationTriggered = true;
                            hedge.maxPnLAfterAmputationTrigger = main.maxPnLAfterAmputationTrigger;
                            hedge.maxPnLPercentAfterAmputationTrigger = main.maxPnLPercentAfterAmputationTrigger;
                            hedge.lastLoggedPeakPercent = main.lastLoggedPeakPercent;
                        } else if (main.amputationTriggered && hedge.amputationTriggered) {
                            const higherPeakPercent = Math.max(main.maxPnLPercentAfterAmputationTrigger || 0, hedge.maxPnLPercentAfterAmputationTrigger || 0);
                            main.maxPnLPercentAfterAmputationTrigger = higherPeakPercent;
                            hedge.maxPnLPercentAfterAmputationTrigger = higherPeakPercent;
                            const higherLogged = Math.max(main.lastLoggedPeakPercent || 0, hedge.lastLoggedPeakPercent || 0);
                            if (higherLogged > 0) {
                                main.lastLoggedPeakPercent = higherLogged;
                                hedge.lastLoggedPeakPercent = higherLogged;
                            }
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
                    const isHedge = !!singlePos.mainPositionId || singlePos.entryId?.startsWith('HEDGE_');
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

                // 🔒 [严禁持仓为0残留铁律] 若持仓已砍仓至0或数量为0，直接移出持仓，绝对不在持仓列表中保留0数量条目
                if (oldPos.isAmputatedToZero || (oldPos.amount || 0) <= 0.0001) {
                    continue;
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
                    const isHedgePos = oldPos.isHedged || !!oldPos.mainPositionId;
                    const defaultExitReason = isHedgePos ? '实盘防爆对冲仓位平仓' : '实盘平仓 / 止盈止损已执行';
                    this.recordRealTradeLog(oldPos, defaultExitReason);
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
        for (const p of uniquePosMap.values()) {
            if (p && (p.amount || 0) > 0.0001 && !p.isAmputatedToZero && !p.isBeingClosed) {
                finalPositions.push(p);
            }
        }

        this.positions = finalPositions;
        
        // 🔒【负债账单只记入一次与防重复污染校准】
        // 针对当前处于对冲中的币种，自动按唯一真实的砍仓流水核算负债，坚决剔除任何因历史轮询重复叠加造成的虚高污染
        const hedgedSyms = new Set<string>();
        for (const p of this.positions) {
            if (p.isHedged || !!p.mainPositionId || (p.isAmputated && (p.amputatedAmount || 0) > 0)) {
                hedgedSyms.add(normalizeSymbol(p.symbol));
            }
        }
        for (const sym of hedgedSyms) {
            this.recalculateSymbolAmputationDebt(sym);
        }
        
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

    /**
     * 🔒【负债账单权威核算与防重复校准铁律 - 原子化委托】
     * 砍仓过后的亏损金额记入“负债”账单，【只记入一次】，不得重复记入！
     * 委托至独立原子模块 DebtManager 执行精确去重与防污染校准。
     */
    public recalculateSymbolAmputationDebt(symbol: string): number {
        return debtManager.recalculateSymbolAmputationDebt(
            symbol,
            this.positions,
            this.tradeLogs,
            (msg) => this.addLog('INFO', msg)
        );
    }

    /**
     * 🔒【周期数据彻底封存】：盈利平仓或解套盈利清仓后，将该币种之前的所有数据全部封存，严禁与新一轮开仓负债关联
     */
    public sealSymbolCycle(symbol: string): void {
        debtManager.sealSymbolCycle(symbol, this.tradeLogs);
        this.addLog('INFO', `🔒 [周期封存] ${symbol} 盈利清仓结算完成，前序对冲止损数据已全额物理封存，新周期开仓零负债起步！`);
    }

    public cleanAmputatedPositionsForSymbol(symbol: string) {
        const cleanSymbol = normalizeSymbol(symbol);
        // 🔒 [彻底清除0持仓铁律] 任何数量归零或标记为0的持仓，立即移出持仓列表
        this.positions = this.positions.filter(p => p && !(normalizeSymbol(p.symbol) === cleanSymbol && ((p.amount || 0) <= 0.0001 || p.isAmputatedToZero || p.isBeingClosed)));
        // Check if there are any ACTIVE (non-zero amount and not being closed) positions left for this symbol
        const hasActive = this.positions.some(p => normalizeSymbol(p.symbol) === cleanSymbol && (p.amount || 0) > 0.0001 && !p.isBeingClosed && !p.isAmputatedToZero);
        if (!hasActive) {
            this.positions = this.positions.filter(p => normalizeSymbol(p.symbol) !== cleanSymbol);
            // 🔒 当该币种所有持仓均已彻底清空时，完全重置该币种的砍仓一票制锁，允许未来全新开仓周期正常使用
            this.amputatedSymbolsInCycle.delete(cleanSymbol);
        }
        this.positions = this.positions.filter(p => p && (p.amount || 0) > 0.0001 && !p.isAmputatedToZero && !p.isBeingClosed);
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
            const now = Date.now();
            if (now - this.lastNetworkStatusLogTime > 4000) {
                this.lastNetworkStatusLogTime = now;
                if (!isHealthy) {
                    this.addLog('WARNING', '⚠️ 检测到网络延迟或断开，已自动暂停所有开新仓策略（平仓不受影响）');
                } else {
                    this.addLog('SUCCESS', '✅ 网络连接恢复正常，开仓策略已重新激活');
                }
            }
        }
    }

    public updateRealPrices(prices: Record<string, number>) {
        let hasActivePosPriceUpdate = false;
        if (this.positions && this.positions.length > 0) {
            for (let i = 0; i < this.positions.length; i++) {
                const normSym = normalizeSymbol(this.positions[i].symbol);
                if (prices[normSym] !== undefined || 
                    (normSym.startsWith('1000') && prices[normSym.replace(/^1000/, '')] !== undefined) || 
                    prices['1000' + normSym] !== undefined) {
                    hasActivePosPriceUpdate = true;
                    break;
                }
            }
        }

        // Just merge the prices. The caller (binanceWs) already normalized keys in its internal notify loop,
        // but we'll normalize here again for absolute safety.
        for (const symbol in prices) {
            const normalized = normalizeSymbol(symbol);
            this.realPrices[normalized] = prices[symbol];
            this.symbolsWithFreshPrice.add(normalized);
        }

        // ⚡【微秒级极速响应】持仓币种最新价格一到达，立即在微任务内无延迟执行策略核算，向币安极速触发对冲/平仓信号
        if (hasActivePosPriceUpdate && this.positions && this.positions.length > 0) {
            try {
                this.tick(true);
            } catch (err) {
                console.error("[InstantPriceTick] Error in instant tick:", err);
            }
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
        this.settings = this.deepMerge(this.settings, settings);
        const newRealTrading = this.settings.system?.realTrading;
        
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
        this.recentlyClosedKeys.delete(`${upperSymbol}_${side}`);
        this.recentlyClosedKeys.delete(upperSymbol);
        this.inFlightClosingPool.delete(`${upperSymbol}_${side}`);
        this.inFlightClosingPool.delete(upperSymbol);
        this.positions.push(newPos);
        this.symbolsWithFreshPrice.add(upperSymbol);
        
        // Record Initial Log with events array initialized
        const initialReason = extraProps?.triggerReason || (extraProps?.isManual ? '手动开仓' : (extraProps?.isReopened ? '解套复开' : (signalTf ? `信号初筛开仓 (${signalTf})` : '初始进场')));
        this.tradeLogs.unshift({
            symbol: upperSymbol,
            entry_id: entryId,
            status: 'OPEN',
            is_hedge: false,
            entry_timestamp: newPos.entryTime,
            direction: side,
            cost_usdt: finalCostUsdt,
            entry_price: executionPrice,
            current_amount: newPos.amount,
            correlationId: newPos.correlationId,
            is_reopened: newPos.isReopened,
            reopenCount: newPos.reopenCount,
            timeframe: signalTf,
            exit_reason: initialReason,
            events: [{
                timestamp: newPos.entryTime,
                action: extraProps?.isReopened ? '解套复开' : '主仓开仓',
                price: executionPrice,
                amount: newPos.amount,
                reason: initialReason
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

        // 🔒 [在途平仓物理绝对拦截 (In-Flight Closing Guard)]
        // 若该主仓正在平仓中（已向币安发送平仓请求但尚未收到最终成交确认），100% 绝对物理拦截防爆对冲开仓！
        // 核心铁律：若主仓为新开有效持仓（entryTime 晚于历史平仓记录），严禁被历史残留锁阻拦！
        const closingKey = `${upperSymbol}_${mainPosition.side}`;
        const closedTimestamp = this.recentlyClosedKeys.get(closingKey) || this.recentlyClosedKeys.get(upperSymbol) || 0;
        const inFlightRecord = this.inFlightClosingPool.get(closingKey) || this.inFlightClosingPool.get(upperSymbol);

        const isStaleInFlight = inFlightRecord && mainPosition.entryTime && (mainPosition.entryTime > inFlightRecord.requestTime);
        const isStaleRecentlyClosed = closedTimestamp > 0 && mainPosition.entryTime && (mainPosition.entryTime > closedTimestamp);

        if (isStaleInFlight) {
            this.inFlightClosingPool.delete(closingKey);
            this.inFlightClosingPool.delete(upperSymbol);
        }
        if (isStaleRecentlyClosed) {
            this.recentlyClosedKeys.delete(closingKey);
            this.recentlyClosedKeys.delete(upperSymbol);
        }

        const isCurrentlyClosing = (
            mainPosition.isClosing || 
            mainPosition.isBeingClosed ||
            (!isStaleInFlight && (this.inFlightClosingPool.has(closingKey) || this.inFlightClosingPool.has(upperSymbol))) ||
            (!isStaleRecentlyClosed && closedTimestamp > 0 && (Date.now() - closedTimestamp < 25000))
        );

        if (isCurrentlyClosing) {
            this.addLog('WARNING', `🛡️ [在途平仓互斥拦截] ${upperSymbol} (${mainPosition.side}) 正在向币安平仓中或刚平仓，绝对禁止发起防爆对冲开仓！`);
            return;
        }

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
            // 🔒 清空对冲发生前的主仓历史波峰与旧断臂触发标记
            mainPosition.amputationTriggered = false;
            delete mainPosition.maxPnLAfterAmputationTrigger;
            delete mainPosition.maxPnLPercentAfterAmputationTrigger;
            delete mainPosition.lastLoggedPeakPercent;
            delete (mainPosition as any).maxPnLPercent;
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
        // 🔒 清空对冲发生前的主仓历史波峰与旧断臂触发标记
        mainPosition.amputationTriggered = false;
        delete mainPosition.maxPnLAfterAmputationTrigger;
        delete mainPosition.maxPnLPercentAfterAmputationTrigger;
        delete mainPosition.lastLoggedPeakPercent;
        delete (mainPosition as any).maxPnLPercent;
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
        const cleanTarget = normalizeSymbol(symbol);
        const pos = entryId 
            ? this.positions.find(p => p.entryId === entryId)
            : this.positions.find(p => (p.symbol === symbol || normalizeSymbol(p.symbol) === cleanTarget) && p.side === side);
        if (pos) {
            // 🔒【防爆对冲周期禁止常规单边平仓铁律】：
            // 凡是启动了防爆对冲的交易对，’止盈止损‘常规平仓规则彻底失效！
            // 若检测到该币种存在活跃反向持仓，且平仓原因非救世策略/一键清仓/手动指令，坚决拦截，杜绝单边平仓导致孤儿单！
            const hasActiveOpposing = this.positions.some(p => 
                normalizeSymbol(p.symbol) === cleanTarget && 
                p.side !== pos.side && 
                p.amount > 0.0001
            );
            const isHedgingOrRescueReason = 
                reason.includes('4.2') || 
                reason.includes('4.3') || 
                reason.includes('解套') || 
                reason.includes('断臂') || 
                reason.includes('熔断') || 
                reason.includes('救世') || 
                reason.includes('对冲') || 
                reason.includes('回调') || 
                reason.includes('手动') || 
                reason.includes('一键') || 
                reason.includes('全平') || 
                reason.includes('批量') ||
                reason.includes('全部清仓');

            if (hasActiveOpposing && !isHedgingOrRescueReason) {
                console.warn(`[Close Intercept] 🛡️ 拦截常规单边平仓: ${symbol} ${side} 当前处于防爆对冲双向持仓中，常规止盈止损已失效，拒绝单边平仓！(原因: ${reason})`);
                this.addLog('WARNING', `🛡️ [平仓拦截] ${symbol} ${side} 当前处于防爆对冲双向持仓中，已由防爆对冲盈利出局规则全面接管，拦截常规单边平仓（原因: ${reason}）。`);
                return;
            }

            pos.isBeingClosed = true;
            if (this.settings?.system?.realTrading && this.onRealClose) {
                this.onRealClose(pos, reason);
                this.recordTradeLog(pos, reason);
                // Filter out immediately locally to avoid double-triggering before sync
                this.positions = this.positions.filter(p => p.entryId !== pos.entryId);
                this.cleanAmputatedPositionsForSymbol(pos.symbol);

                // 🔒 [盈利清仓即时封存] 若为盈利平仓且该币种持仓已完全清空，立即执行单币周期物理封存
                const remainingSameSymbolReal = this.positions.filter(p => normalizeSymbol(p.symbol) === cleanTarget && (p.amount || 0) > 0.0001);
                if (remainingSameSymbolReal.length === 0 && (pos.unrealizedPnL || 0) >= 0) {
                    this.sealSymbolCycle(pos.symbol);
                }

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

            // 🔒 [盈利清仓即时封存] 若为盈利平仓且该币种持仓已完全清空，立即执行单币周期物理封存
            const remainingSameSymbolSim = this.positions.filter(p => normalizeSymbol(p.symbol) === cleanTarget && (p.amount || 0) > 0.0001);
            if (remainingSameSymbolSim.length === 0 && (pos.unrealizedPnL || 0) >= 0) {
                this.sealSymbolCycle(pos.symbol);
            }

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
            const cleanMainSym = normalizeSymbol(main.symbol);
            const now = Date.now();
            this.recentlyClosedKeys.set(`${cleanMainSym}_${main.side}`, now);
            this.cooldowns[`${main.symbol}_${main.side}`] = now + 60000;

            if (hedge) {
                hedge.isBeingClosed = true;
                const cleanHedgeSym = normalizeSymbol(hedge.symbol);
                this.recentlyClosedKeys.set(`${cleanHedgeSym}_${hedge.side}`, now);
                this.cooldowns[`${hedge.symbol}_${hedge.side}`] = now + 60000;
            }

            // Record initial profitability states BEFORE closing positions
            const isHedgeProfitable = hedge ? (hedge.unrealizedPnL || 0) > 0 : false;
            const isMainProfitable = (main.unrealizedPnL || 0) > 0;

            // Real-trading close dispatch
            if (this.settings?.system?.realTrading && this.onRealClose) {
                if (isAmputationProfitExit) {
                    const positionsToClose = this.positions.filter(p => normalizeSymbol(p.symbol) === cleanMainSym);
                    for (const p of positionsToClose) {
                        if (p.amount > 0.0001) {
                            this.onRealClose(p, reason + ' (断臂全清)');
                        }
                    }
                } else {
                    if (hedge && hedge.amount > 0.0001) {
                        this.onRealClose(hedge, reason);
                    }
                    if (main && main.amount > 0.0001) {
                        this.onRealClose(main, reason);
                    }
                }
            }

            // Close positions: Clean up positions
            if (isAmputationProfitExit) {
                // Clear ALL positions for this symbol if Amputation
                const positionsToClose = this.positions.filter(p => normalizeSymbol(p.symbol) === cleanMainSym);
                for (const p of positionsToClose) {
                    this.recordTradeLog(p, reason + ' (断臂全清)');
                }
                this.positions = this.positions.filter(p => normalizeSymbol(p.symbol) !== cleanMainSym);
                this.addLog('INFO', `[断臂全清] 已清除所有 ${main.symbol} 相关仓位: ${reason}`);
                this.saveCooldowns();
            } else {
                // Close positions: Clean up both main and hedge positions cleanly from state
                if (hedge) {
                    this.recordTradeLog(hedge, reason);
                    this.positions = this.positions.filter(p => p.entryId !== hedge.entryId && !(normalizeSymbol(p.symbol) === cleanMainSym && p.side === hedge.side));
                    this.addLog('INFO', `Closed Hedge ${hedge.side} on ${hedge.symbol}: ${reason}`);
                }
                
                this.recordTradeLog(main, reason);
                this.positions = this.positions.filter(p => p.entryId !== main.entryId && !(normalizeSymbol(p.symbol) === cleanMainSym && p.side === main.side));
                this.saveCooldowns();
                this.addLog('INFO', `Closed Main ${main.side} on ${main.symbol}: ${reason}`);
            }

            this.cleanAmputatedPositionsForSymbol(main.symbol);
            this.positions = this.positions.filter(p => p && (p.amount || 0) > 0.0001 && !p.isAmputatedToZero && !p.isBeingClosed);

            // 🔒 [核心封存] 对冲盈利解套清仓或断臂清仓成功，将该币种前序所有止损/砍仓数据彻底封存隔离！
            this.sealSymbolCycle(main.symbol);

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
            parentEntryId: pos.entryId,
            // 🔒 [新周期绝对零负债] 复开属于全新一轮开仓生命周期，坚决物理隔离历史负债
            cumulativeAmputationLoss: 0,
            cumulativeHedgeLoss: 0,
            cumulativeAmputationProfit: 0,
            cumulativeHedgeProfit: 0,
            isAmputated: false,
            amputatedAmount: 0,
            isHedged: false
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
            this.addLog('INFO', `⚡ [实盘自动复开触发] 正在向币安发送原仓位复开指令: ${pos.symbol} ${pos.side} | 原始金额: ${initialUsdtCost.toFixed(2)} USDT | 原因: ${reason}`);
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
        this.addLog('SUCCESS', `🔄 [原仓位复开] 已开启独立复开仓位: ${pos.symbol} ${pos.side} | 原始金额: ${initialUsdtCost.toFixed(2)} USDT | 原因: ${reason} | 复开次数: ${nextReopenCount}`);
        
        // Voice announcement for simulated reopen
        const cleanSym = pos.symbol.replace('USDT', '');
        audioService.speak(`${cleanSym}对冲仓盈利解套，主仓位已自动复开`, true);

        this.emitUpdate(true);
    }

    /**
     * 精确判定仓位是否为防爆对冲仓位（对冲从仓）还是原仓位（主仓）
     */
    private isHedgePosition(pos: Position): boolean {
        if (!pos) return false;
        // 1. 显式对冲主仓引用或 HEDGE 前缀
        if (pos.mainPositionId || pos.entryId?.startsWith('HEDGE_') || (pos as any).is_hedge === true) {
            return true;
        }
        // 2. 显式对冲触发标记
        if (pos.triggerReason?.includes('防爆对冲') || pos.triggerReason?.includes('对冲开仓')) {
            return true;
        }
        // 3. 关联同币种对手单判定
        const cleanSym = normalizeSymbol(pos.symbol);
        const opposing = this.positions.find(p => normalizeSymbol(p.symbol) === cleanSym && p.side !== pos.side && (p.amount > 0 || p.isAmputated));
        if (opposing) {
            if (opposing.mainPositionId === pos.entryId) {
                return false; // opposing 对冲了 pos，所以 pos 是主仓
            }
            if (pos.mainPositionId === opposing.entryId) {
                return true; // pos 对冲了 opposing，所以 pos 是对冲仓
            }
            if (opposing.triggerReason?.includes('防爆对冲') && !pos.triggerReason?.includes('防爆对冲')) {
                return false;
            }
            if (pos.triggerReason?.includes('防爆对冲') && !opposing.triggerReason?.includes('防爆对冲')) {
                return true;
            }
            // 开仓时间晚的为对冲仓
            if ((pos.entryTime || 0) > (opposing.entryTime || 0) + 1000) {
                return true;
            }
            if ((opposing.entryTime || 0) > (pos.entryTime || 0) + 1000) {
                return false;
            }
        }
        // 4. 检查关联交易日志
        const myOpenLog = this.tradeLogs.find(l => (l.entry_id === pos.entryId || (normalizeSymbol(l.symbol) === cleanSym && l.direction === pos.side)) && l.status === 'OPEN');
        if (myOpenLog) {
            if (myOpenLog.is_hedge) return true;
            if (myOpenLog.exit_reason?.includes('防爆对冲') || (myOpenLog as any).action?.includes('防爆对冲')) return true;
        }
        return false;
    }

    // 🔒 @LOCKED: [断臂求生 - 砍仓执行内核] 严禁在未获用户直接指令前修改本方法
    public amputate(position: Position, ratio: number, reason: string) {
        const cleanSym = normalizeSymbol(position.symbol);

        // 🔒 [断臂求生双边完整对冲硬锁] 
        // 铁律 1：如果任一方处于被砍待补仓状态 (isAmputated 为 true 或待补仓数量 > 0)，绝对严禁发起连续二次砍仓！
        const opposingPos = this.positions.find(p => normalizeSymbol(p.symbol) === cleanSym && p.side !== position.side);
        if (!opposingPos || position.amount <= 0.0001 || opposingPos.amount <= 0.0001) {
            console.warn(`[Amputation Lock] 🛡️ 拦截砍仓: ${position.symbol} 对手仓位不存在或数量为0`);
            return;
        }

        const totalAmpCount = Math.max(position.amputationCount || 0, opposingPos.amputationCount || 0);
        const totalRefillCount = Math.max(position.refillCount || 0, opposingPos.refillCount || 0);
        const isAnyAmputated = totalAmpCount > totalRefillCount ||
            this.amputatedSymbolsInCycle.has(cleanSym) ||
            !!position.isAmputated || (position.amputatedAmount || 0) > 0 ||
            !!opposingPos.isAmputated || (opposingPos.amputatedAmount || 0) > 0;
        if (isAnyAmputated) {
            console.warn(`[Amputation Lock] 🛡️ 拦截二次砍仓: ${position.symbol} 前次砍仓尚未完成回踩补仓 (砍仓:${totalAmpCount}次 vs 补仓:${totalRefillCount}次)，必须等回踩补仓恢复后方可再次砍仓！`);
            return;
        }

        // 铁律 2：数量比例防御 (双保险，防止大幅失衡仍未补仓时误砍)
        const maxAmt = Math.max(position.amount, opposingPos.amount);
        const minAmt = Math.min(position.amount, opposingPos.amount);
        if (maxAmt > 0 && ((maxAmt - minAmt) / maxAmt) > 0.45) {
            console.warn(`[Amputation Lock] 🛡️ 拦截二次砍仓: ${position.symbol} 两边数量相差悬殊(当前:${position.amount.toFixed(4)} vs 对手:${opposingPos.amount.toFixed(4)})，说明有减仓未补齐，严禁连续砍仓！`);
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
        position.amputationEntryPrice = position.entryPrice;
        if (!position.originalEntryPrice) {
            position.originalEntryPrice = position.entryPrice;
        }
        position.amputatedAmount = (position.amputatedAmount || 0) + cutAmount;
        position.amputationCount = currentAmpCount + 1;
        if (opposingPos) {
            opposingPos.amputationCount = position.amputationCount;
            opposingPos.isHedged = true;
        }
        
        // 记录砍仓的实际盈亏 (严格基于实际被砍数量 cutAmount 及基准开仓价与最新标记价之差精确核算)
        const isLong = position.side === PositionSide.LONG;
        const currentMark = position.markPrice || position.entryPrice;
        const priceDiff = isLong ? (currentMark - position.entryPrice) : (position.entryPrice - currentMark);
        const cutProfitPercent = position.entryPrice > 0 ? (priceDiff / position.entryPrice) * 100 : (position.unrealizedPnLPercentage || 0);
        const realizedPnL = priceDiff * cutAmount;
        
        position.amount -= cutAmount;
        if (position.amount <= 0.0001) {
            position.amount = 0;
            position.isAmputatedToZero = true;
            this.positions = this.positions.filter(p => p.entryId !== position.entryId);
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

        const isHedgePos = this.isHedgePosition(position);
        const cutActionName = isHedgePos ? `防爆对冲砍仓 (${ratio}%)` : `原仓位砍仓 (${ratio}%)`;

        // 🔒 [止损砍仓独立记录流水铁律]
        const cutCostUsdt = cutAmount * position.entryPrice;
        const cutLogEntry: TradeLog = {
            symbol: position.symbol,
            entry_id: `${position.entryId || position.symbol}_cut_${now}`,
            parent_entry_id: position.entryId,
            status: 'CLOSED',
            profit_usdt: realizedPnL,
            profit_percent: cutProfitPercent,
            exit_reason: reason || cutActionName,
            is_hedge: isHedgePos,
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
        this.addTradeEvent(position, cutActionName, position.markPrice, cutAmount, reason, realizedPnL);

        // 真实扣除或增加账户余额
        this.account.marginBalance += realizedPnL;
        this.account.totalBalance = this.account.marginBalance;
        
        if (realizedPnL >= 0) {
            this.addLog('SUCCESS', `💰 部分止盈: ${position.symbol} ${position.side} 减仓 ${ratio}% | 数量: ${cutAmount.toFixed(4)} (约 ${cutCostUsdt.toFixed(2)} USDT) | 实现盈利: +${realizedPnL.toFixed(2)} USDT | ${reason}`);
        } else {
            this.addLog('WARNING', `✂️ 部分止损: ${position.symbol} ${position.side} 减仓 ${ratio}% | 数量: ${cutAmount.toFixed(4)} (约 ${cutCostUsdt.toFixed(2)} USDT) | 实现亏损: ${realizedPnL.toFixed(2)} USDT | ${reason}`);
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
        position.amputationEntryPrice = position.entryPrice;
        if (!position.originalEntryPrice) {
            position.originalEntryPrice = position.entryPrice;
        }
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
            this.positions = this.positions.filter(p => p.entryId !== position.entryId);
        }
        position.amputatedAmount = (position.amputatedAmount || 0) + cutAmount;

        if (realizedPnL < 0) {
            const cutOrderId = execData?.orderId ? String(execData.orderId) : `${position.entryId || position.symbol}_cut_${now}`;
            if (!this.processedDebtOrderKeys.has(cutOrderId)) {
                this.processedDebtOrderKeys.add(cutOrderId);
                position.cumulativeAmputationLoss = (position.cumulativeAmputationLoss || 0) + Math.abs(realizedPnL);
                // 🔒 [单币负债继承] 如果存在对冲对手单（存活仓位），立即将本次砍仓亏损负债同步继承给对手单，确保砍仓后负债不随仓位归零而丢失
                if (opposingPos) {
                    opposingPos.cumulativeAmputationLoss = (opposingPos.cumulativeAmputationLoss || 0) + Math.abs(realizedPnL);
                }
            }
        } else {
            position.cumulativeAmputationProfit = (position.cumulativeAmputationProfit || 0) + realizedPnL;
            if (opposingPos) {
                opposingPos.cumulativeAmputationProfit = (opposingPos.cumulativeAmputationProfit || 0) + realizedPnL;
            }
        }

        const isStopLoss = realizedPnL < 0;
        const wasEverHedged = position.isHedged || (position.hedgeRetries || 0) > 0 || !!position.mainPositionId || (position.cumulativeHedgeLoss || 0) > 0 || (position.cumulativeHedgeProfit || 0) > 0;

        const isHedgePos = this.isHedgePosition(position);
        const cutActionName = isHedgePos ? `防爆对冲砍仓 (${ratio}%)` : `原仓位砍仓 (${ratio}%)`;

        // 🔒 [实盘独立记录止损砍仓流水铁律]
        const isLong = position.side === PositionSide.LONG;
        const execMark = execData?.price || position.markPrice || position.entryPrice;
        const priceDiff = isLong ? (execMark - position.entryPrice) : (position.entryPrice - execMark);
        const cutProfitPercent = position.entryPrice > 0 ? (priceDiff / position.entryPrice) * 100 : (position.unrealizedPnLPercentage || 0);

        const cutCostUsdt = cutAmount * position.entryPrice;
        const cutLogEntry: TradeLog = {
            symbol: position.symbol,
            entry_id: `${position.entryId || position.symbol}_cut_${now}`,
            binance_order_id: execData?.orderId ? String(execData.orderId) : undefined,
            parent_entry_id: position.entryId,
            status: 'CLOSED',
            profit_usdt: realizedPnL,
            profit_percent: cutProfitPercent,
            exit_reason: reason || cutActionName,
            is_hedge: isHedgePos,
            entry_timestamp: position.entryTime || now,
            exit_timestamp: now,
            direction: position.side,
            cost_usdt: cutCostUsdt,
            entry_price: position.entryPrice,
            exit_price: execMark,
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
        this.addTradeEvent(position, cutActionName, position.markPrice || position.entryPrice, cutAmount, reason, realizedPnL);

        // 真实扣除或增加账户余额
        this.account.marginBalance += realizedPnL;
        this.account.totalBalance = this.account.marginBalance;
        
        if (realizedPnL >= 0) {
            this.addLog('SUCCESS', `💰 [实盘部分止盈成功] ${position.symbol} ${position.side} 减仓 ${ratio}% | 数量: ${cutAmount.toFixed(4)} (约 ${cutCostUsdt.toFixed(2)} USDT) | 实现盈利: +${realizedPnL.toFixed(2)} USDT | ${reason}`);
        } else {
            this.addLog('WARNING', `✂️ [实盘部分止损成功] ${position.symbol} ${position.side} 减仓 ${ratio}% | 数量: ${cutAmount.toFixed(4)} (约 ${cutCostUsdt.toFixed(2)} USDT) | 实现亏损: ${realizedPnL.toFixed(2)} USDT | ${reason}`);
            // 🔒【负债账单只记入一次】立即核准并同步双方负债
            this.recalculateSymbolAmputationDebt(cleanSym);
        }
        this.emitUpdate(true);
    }

    // 🔒 @LOCKED: [断臂求生/回踩补仓 - 执行内核] 严禁在未获用户直接指令前修改本方法
    public refill(position: Position, reason: string, customRefillQty?: number) {
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

        // 🔒 [精确补仓铁律] 严格优先读取透传的 customRefillQty，其次读取该仓位被砍掉的实际数量，最后以对冲差额兜底
        let refillAmount = (typeof customRefillQty === 'number' && customRefillQty > 0)
            ? customRefillQty
            : (position.amputatedAmount || 0);

        if (refillAmount <= 0 && oppositePos && oppositePos.amount > position.amount) {
            refillAmount = Math.max(0, oppositePos.amount - position.amount);
        }

        if (refillAmount <= 0) {
            console.warn(`[Refill Skipped] 🛡️ 补仓数量计算为0: ${position.symbol} ${position.side} (customRefillQty=${customRefillQty}, amputatedAmount=${position.amputatedAmount})`);
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

        // 🔒 [第一层：在途并发锁] 防止网络请求耗时期间行情毫秒级跳动造成瞬间重复提交
        if (this.inFlightRefillPool.has(lockKey)) {
            console.warn(`[Refill In-Flight] 🛡️ 拦截重复补仓: ${position.symbol} ${position.side} 补仓正在在途处理中，严禁重复提交！`);
            return;
        }

        // 🔒 针对断臂求生回踩补仓，移除死板的10秒等待限制，仅保留1秒超短防抖
        const now = Date.now();
        const lastRefill = Math.max(
            position.lastRefillTime || 0,
            this.lastRefillTimestampMap.get(lockKey) || 0
        );
        const cooldownThreshold = isRescueRefill ? 1500 : 8000;
        if (now - lastRefill < cooldownThreshold) {
            console.warn(`[Refill Cooldown] 🛡️ 补仓防抖中: ${position.symbol} ${position.side} (${now - lastRefill}ms)`);
            return;
        }

        if (this.settings?.system?.realTrading) {
            // 🔒【实盘绝对零虚假铁律】在实盘模式下，严禁提前清空 position.isAmputated、amputatedAmount！
            // 立即加上在途锁与持久时间戳，一切持仓增加、标记清空与流水记录严格等待 handleRealRefillSuccess 收到币安真实成功回执后执行！
            this.inFlightRefillPool.add(lockKey);
            this.lastRefillTimestampMap.set(lockKey, now);
            position.lastRefillTime = now;

            // 2秒安全超时防死锁（防止前端网络阻塞或未正确返回回执）
            setTimeout(() => {
                this.inFlightRefillPool.delete(lockKey);
            }, 2000);

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
        delete position.amputationEntryPrice;
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

        const isHedgePos = this.isHedgePosition(position);
        const refillActionName = isHedgePos ? '防爆对冲补仓' : '原仓位补仓';

        // Add sub-event to main log
        this.addTradeEvent(position, refillActionName, position.markPrice, refillAmount, reason);

        // 🔒 [实盘独立记录防爆对冲补仓流水铁律]
        const refillCostUsdt = refillAmount * (position.markPrice || position.entryPrice);
        const refillLogEntry: TradeLog = {
            symbol: position.symbol,
            entry_id: `${position.entryId || position.symbol}_refill_${now}`,
            parent_entry_id: position.entryId,
            status: 'OPEN',
            is_hedge: isHedgePos,
            entry_timestamp: now,
            direction: position.side,
            cost_usdt: refillCostUsdt,
            entry_price: position.markPrice || position.entryPrice,
            current_amount: refillAmount,
            timeframe: (position as any).timeframe,
            exit_reason: `${refillActionName} (${reason || '回踩补回'})`,
            events: [{
                timestamp: now,
                action: refillActionName,
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
        const nextRefillCount = Math.max(position.refillCount || 0, oppositePos?.refillCount || 0) + 1;
        position.refillCount = nextRefillCount;
        if (oppositePos) {
            oppositePos.refillCount = nextRefillCount;
        }

        // 🔒 检查震荡磨损熔断机制
        if (fuseEnabled && nextRefillCount >= maxRetries) {
            position.isOscillationLocked = true;
            if (oppositePos) oppositePos.isOscillationLocked = true;

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
     * 手动/异常释放补仓在途锁
     */
    public releaseInFlightRefill(symbol: string, side: PositionSide) {
        const cleanSym = normalizeSymbol(symbol);
        const lockKey = `${cleanSym}_${side}`;
        this.inFlightRefillPool.delete(lockKey);
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
            delete position.amputationEntryPrice;
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
            const isHedgePos = position ? this.isHedgePosition(position) : false;
            const refillActionName = isHedgePos ? '防爆对冲补仓' : '原仓位补仓';
            const refillCostUsdt = refillAmount * (position.markPrice || position.entryPrice);
            const refillLogEntry: TradeLog = {
                symbol: symbol,
                entry_id: `${position.entryId || symbol}_refill_${now}`,
                parent_entry_id: position.entryId,
                status: 'OPEN',
                is_hedge: isHedgePos,
                entry_timestamp: now,
                direction: side,
                cost_usdt: refillCostUsdt,
                entry_price: position.markPrice || position.entryPrice,
                current_amount: refillAmount,
                timeframe: (position as any).timeframe,
                exit_reason: `${refillActionName} (${reason || '实盘回踩补回'})`,
                events: [{
                    timestamp: now,
                    action: refillActionName,
                    price: position.markPrice || position.entryPrice,
                    amount: refillAmount,
                    reason: reason || '实盘回踩补回'
                }]
            };
            this.tradeLogs.unshift(refillLogEntry);
            this.addTradeEvent(position, refillActionName, position.markPrice || position.entryPrice, refillAmount, reason);
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

        // 🔒 [一键全平/熔断清仓封存] 仓位已全部出局，彻底封存前序周期所有负债数据
        this.sealSymbolCycle(symbol);

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
            const cleanHedgeSym = normalizeSymbol(hedge.symbol);
            const now = Date.now();
            this.recentlyClosedKeys.set(`${cleanHedgeSym}_${hedge.side}`, now);
            this.cooldowns[`${hedge.symbol}_${hedge.side}`] = now + 60000;
            this.saveCooldowns();
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

            this.positions = this.positions.filter(p => p.entryId !== hedgeId && !(normalizeSymbol(p.symbol) === cleanHedgeSym && p.side === hedge.side));
            this.cleanAmputatedPositionsForSymbol(hedge.symbol);
            this.positions = this.positions.filter(p => p && (p.amount || 0) > 0.0001 && !p.isAmputatedToZero && !p.isBeingClosed);
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

        // 真实扣除或增加账户余额 (Realize PnL)
        this.account.marginBalance += p.unrealizedPnL;
        this.account.totalBalance = this.account.marginBalance;

        // 🔒 [信号过渡提示拦截] 仅拦截正在向交易所发送请求等在途过渡提示，所有实际成交/平仓/策略清仓操作一律忠实全量入库
        if (reason.includes('正在向') || reason.includes('发送中') || reason.includes('触发请求中')) {
            return;
        }

        const now = Date.now();
        const finalReason = reason || (p.unrealizedPnL >= 0 ? '止盈平仓' : '止损平仓');
        const isStopLoss = finalReason.includes('止损') || p.unrealizedPnL < 0;

        const isHedgePos = !!p.mainPositionId || (p.entryId && p.entryId.startsWith('HEDGE_'));

        // 🔒【独立记录与禁止篡改铁律】生成全新独立平仓日志，绝不篡改历史开仓记录
        this.tradeLogs.unshift({
            symbol: p.symbol,
            entry_id: `${p.entryId || p.symbol}_close_${now}`,
            parent_entry_id: p.entryId,
            status: 'CLOSED',
            profit_usdt: p.unrealizedPnL,
            exit_reason: finalReason,
            is_hedge: isHedgePos,
            entry_timestamp: p.entryTime || now,
            exit_timestamp: now,
            direction: p.side,
            cost_usdt: p.amount * p.entryPrice,
            entry_price: p.entryPrice,
            exit_price: p.markPrice || p.entryPrice,
            profit_percent: p.unrealizedPnLPercentage || 0,
            main_entry_id: p.mainPositionId,
            correlationId: p.correlationId,
            reopenCount: p.reopenCount,
            is_reopened: !!p.isReopened,
            timeframe: p.signalTf,
            last_stop_loss_time: isStopLoss ? now : undefined,
            stop_loss_rule: isStopLoss ? finalReason : undefined,
            events: [{
                timestamp: now,
                action: finalReason.includes('砍仓') ? '防爆对冲砍仓' : (finalReason.includes('清仓') ? '防爆清仓' : (finalReason.includes('止盈') ? '止盈平仓' : (finalReason.includes('止损') ? '止损平仓' : '平仓'))),
                price: p.markPrice || p.entryPrice,
                amount: p.amount,
                reason: finalReason,
                pnl: p.unrealizedPnL
            }]
        });

        // Add final exit event to parent open log's event array if exists
        const parentLog = this.tradeLogs.find(l => l.entry_id === p.entryId && l.status === 'OPEN');
        if (parentLog) {
            if (!parentLog.events) parentLog.events = [];
            parentLog.events.push({
                timestamp: now,
                action: '最终平仓',
                price: p.markPrice,
                amount: p.amount,
                reason: finalReason,
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
                exitReason: finalReason,
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

    public recordRealTradeLog(p: Position, reason: string, execData?: { orderId?: string, price?: number, qty?: number, realizedPnl?: number, updateTime?: number }) {
        // 🔒 [拦截空仓/虚假平仓日志] 若该仓位持仓数量已为 0 或已通过防爆对冲砍仓完成结单，严禁再次生成冗余的“止损平仓”日志
        if (!p || p.isAmputatedToZero) {
            return;
        }

        // 🔒 [信号过渡提示拦截] 仅拦截正在向交易所发送请求等在途过渡提示，所有实际成交/平仓/策略清仓操作一律忠实全量入库
        if (reason.includes('正在向') || reason.includes('发送中') || reason.includes('触发请求中')) {
            return;
        }

        const now = (execData as any)?.updateTime || Date.now();
        const execPrice = (execData?.price && execData.price > 0) ? execData.price : (p.markPrice || p.entryPrice || 0);
        const execQty = (execData?.qty && execData.qty > 0) ? execData.qty : (p.amount || 0);

        // 🔒【真实盈亏核算铁律】若交易所即时回报无 realizedPnl 或为 0，严格以开仓均价与平仓价及持仓量现场精准核算真实 USDT 盈亏
        let pnl = (execData?.realizedPnl !== undefined && execData.realizedPnl !== 0)
            ? execData.realizedPnl
            : (p.unrealizedPnL !== undefined && p.unrealizedPnL !== 0 ? p.unrealizedPnL : 0);

        if (pnl === 0 && p.entryPrice > 0 && execPrice > 0) {
            if (p.side === PositionSide.LONG) {
                pnl = (execPrice - p.entryPrice) * execQty;
            } else {
                pnl = (p.entryPrice - execPrice) * execQty;
            }
        }

        const finalReason = reason || (pnl >= 0 ? '实盘止盈平仓' : '实盘止损平仓');
        const isStopLoss = finalReason.includes('止损') || finalReason.includes('砍仓') || pnl < 0;

        const isHedgePos = !!p.mainPositionId || (p.entryId && p.entryId.startsWith('HEDGE_'));

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
            if (finalReason) existingInstantClosed.exit_reason = finalReason;
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
                exit_reason: isHedgePos ? (p.triggerReason || '防爆对冲开仓') : '实盘开仓进场',
                events: [{
                    timestamp: p.entryTime || now,
                    action: isHedgePos ? `防爆对冲开仓 (${p.side})` : `实盘开仓 (${p.side})`,
                    price: p.entryPrice,
                    amount: execQty,
                    reason: isHedgePos ? (p.triggerReason || '防爆对冲开仓') : '实盘开仓进场'
                }]
            });
        }

        // Record a separate CLOSE log with actual exchange feedback data
        this.tradeLogs.unshift({
            symbol: p.symbol,
            entry_id: `${p.entryId || p.symbol}_close_${now}`,
            parent_entry_id: p.entryId,
            binance_order_id: execData?.orderId ? String(execData.orderId) : undefined,
            status: 'CLOSED',
            profit_usdt: pnl,
            exit_reason: finalReason,
            is_hedge: isHedgePos,
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
            timeframe: p.signalTf,
            last_stop_loss_time: isStopLoss ? now : undefined,
            stop_loss_rule: isStopLoss ? finalReason : undefined,
            events: [{
                timestamp: now,
                action: finalReason.includes('砍仓') ? '防爆对冲砍仓成交回报' : (finalReason.includes('清仓') ? '防爆清仓成交回报' : '交易所平仓成交回报'),
                price: execPrice,
                amount: execQty,
                reason: finalReason,
                pnl
            }]
        });

        const pnlFormatted = pnl >= 0 ? `+${pnl.toFixed(4)}` : `${pnl.toFixed(4)}`;
        this.addLog(
            pnl >= 0 ? 'SUCCESS' : 'WARNING',
            `⚡ [币安平仓成交反馈] ${p.symbol} ${p.side} 仓位已平仓 | 成交均价: ${execPrice.toFixed(4)} | 数量: ${execQty.toFixed(4)} | 盈亏: ${pnlFormatted} USDT | 原因: ${finalReason}`
        );

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
                        existingLog.profit_usdt = realizedPnl;
                        hasNewUpdates = true;

                        // 🔒【官方账单负债校准 - 只记入一次铁律】
                        // 不管轮询或分笔回报多少次，负债金额只记入一次，由权威去重函数统一核准，严禁重复累加
                        if (realizedPnl < 0) {
                            this.processedDebtOrderKeys.add(orderId);
                            this.recalculateSymbolAmputationDebt(normSym);
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

                    const isPartialClose = isCurrentlyActiveInPositions;
                    const finalLogReason = isPartialClose ? "实盘减仓(部分平仓) / 币安对账" : logReason;

                    if (!isCurrentlyActiveInPositions || inFlightClosing || (tradeTime - (matchingOpenLog?.entry_timestamp || 0) >= 3000)) {
                        const costUsdt = matchingOpenLog ? (matchingOpenLog.cost_usdt || (qty * (matchingOpenLog.entry_price || price))) : (qty * price);
                        const profitPercent = costUsdt > 0 ? (realizedPnl / costUsdt) * 100 : 0;
                        const entryPrice = matchingOpenLog ? matchingOpenLog.entry_price : price;
                        const entryTime = matchingOpenLog ? matchingOpenLog.entry_timestamp : tradeTime;
                        const isHedgeLog = matchingOpenLog ? matchingOpenLog.is_hedge : false;
                        const mainEntryId = matchingOpenLog ? matchingOpenLog.main_entry_id : undefined;

                        // 🔒【官方账单负债回填 - 只记入一次铁律】
                        // 无论轮询多少次，负债金额严格只记入一次，由权威去重函数统一核算与同步
                        if (realizedPnl < 0 && !this.processedDebtOrderKeys.has(orderId)) {
                            this.processedDebtOrderKeys.add(orderId);
                            this.processedExternalPnlOrders.add(orderId);
                            this.recalculateSymbolAmputationDebt(normSym);
                        }

                        // 生成完全独立的平仓/减仓交易流水，不破坏已有开仓记录
                        this.tradeLogs.unshift({
                            symbol: rawSymbol.toUpperCase(),
                            entry_id: matchingOpenLog?.entry_id || `binance_trade_${orderId}_${tradeTime}`,
                            binance_order_id: orderId,
                            status: 'CLOSED',
                            profit_usdt: realizedPnl,
                            exit_reason: finalLogReason,
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
                                action: isPartialClose ? `部分减仓 (${realizedPnl >= 0 ? '盈利' : '亏损'})` : (realizedPnl >= 0 ? '盈利平仓' : '止损平仓'),
                                price: price,
                                amount: qty,
                                reason: finalLogReason,
                                pnl: realizedPnl
                            }]
                        });

                        this.knownOrderIds.add(orderId);
                        hasNewUpdates = true;
                    }

                    // 同步系统日志提示，标明是完全平仓还是减仓
                    if (isPartialClose) {
                        this.addLog(
                            realizedPnl >= 0 ? 'SUCCESS' : 'WARNING',
                            `🟡 [减仓对账同步] 自动同步减仓(部分平仓)明细: ${rawSymbol} ${inferredDirection} | 减仓价: ${price.toFixed(4)} | 数量: ${qty} | 减仓价值: ${(qty * price).toFixed(2)} USDT | 实际盈亏: ${realizedPnl >= 0 ? '+' : ''}${realizedPnl.toFixed(4)} USDT`
                        );
                    } else {
                        this.addLog(
                            realizedPnl >= 0 ? 'SUCCESS' : 'WARNING',
                            `${realizedPnl >= 0 ? '🟢' : '🔴'} [平仓对账同步] 自动同步完全平仓明细: ${rawSymbol} ${inferredDirection} | 平仓价: ${price.toFixed(4)} | 数量: ${qty} | 平仓价值: ${(qty * price).toFixed(2)} USDT | 实际盈亏: ${realizedPnl >= 0 ? '+' : ''}${realizedPnl.toFixed(4)} USDT`
                        );
                    }
                }
            } else {
                // Binance trade execution for opening position (realizedPnl === 0)
                const inferredDirection = (positionSide === "LONG" || (positionSide === "BOTH" && side === "BUY")) ? PositionSide.LONG : PositionSide.SHORT;
                
                // 🔒【开仓唯一性与外部开仓全保全铁律】
                // 精准根据 orderId 或 10秒内同币同向匹配检查是否已有该开仓记录
                const existingOpenLog = this.tradeLogs.find(l => 
                    (orderId && l.binance_order_id && String(l.binance_order_id) === orderId && l.status === 'OPEN') ||
                    (orderId && this.knownOrderIds.has(orderId) && l.binance_order_id && String(l.binance_order_id) === orderId) ||
                    (normalizeSymbol(l.symbol) === normSym && l.direction === inferredDirection && l.status === 'OPEN' && Math.abs((l.entry_timestamp || 0) - tradeTime) < 10000)
                );

                const activePos = this.positions.find(p => 
                    normalizeSymbol(p.symbol) === normSym && 
                    p.side === inferredDirection && 
                    (p.amount || 0) > 0.0001
                );

                const isRefill = !!activePos && ((tradeTime - (activePos.entryTime || 0)) > 3000);

                if (!existingOpenLog) {
                    // 无论本系统开仓、手机APP开仓还是其它程序开仓，只要发生真实开仓成交，100%忠实记录到交易日志与历史流水
                    const opposingPos = this.positions.find(p => normalizeSymbol(p.symbol) === normSym && p.side !== inferredDirection);
                    const isHedge = !!opposingPos || this.tradeLogs.some(l => normalizeSymbol(l.symbol) === normSym && l.status === 'OPEN' && l.direction !== inferredDirection);
                    const mainPos = opposingPos || this.positions.find(p => normalizeSymbol(p.symbol) === normSym);

                    // 优先挂接当前活跃仓位 entryId，若手机APP开仓尚未同步持仓则生成专有外部开仓标识
                    const entryId = activePos?.entryId || `external_open_${normSym}_${inferredDirection}_${orderId || tradeTime}`;

                    const actionLabel = isRefill 
                        ? `实盘补仓/加仓 (${inferredDirection})` 
                        : (isHedge ? `防爆对冲开仓 (${inferredDirection})` : `实盘开仓 (${inferredDirection})`);
                    const reasonLabel = isRefill
                        ? '币安实盘成交回报 (手机APP/外部/系统补仓)'
                        : (isHedge ? '防爆对冲即时成交开仓回报' : '币安实盘成交回报 (手机APP/外部/系统开仓)');

                    this.tradeLogs.unshift({
                        symbol: rawSymbol.toUpperCase(),
                        entry_id: entryId,
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
                            action: actionLabel,
                            price: price,
                            amount: qty,
                            reason: reasonLabel
                        }]
                    });
                    if (orderId) this.knownOrderIds.add(orderId);
                    hasNewUpdates = true;

                    // 若持仓列表当前尚未有此持仓（如手机APP刚开仓），立即自动同步加入持仓列表
                    if (!activePos) {
                        this.positions.unshift({
                            symbol: rawSymbol.toUpperCase(),
                            side: inferredDirection,
                            amount: qty,
                            entryPrice: price,
                            markPrice: price,
                            liquidationPrice: 0,
                            unrealizedPnL: 0,
                            unrealizedPnLPercentage: 0,
                            entryId,
                            entryTime: tradeTime,
                            isPendingSync: false,
                            isHedged: isHedge,
                            mainPositionId: isHedge ? mainPos?.entryId : undefined,
                            leverage: 20
                        });
                    }

                    if (isRefill) {
                        this.addLog(
                            'SUCCESS',
                            `🔵 [补仓对账同步] 成功记录补仓流水: ${rawSymbol} ${inferredDirection} | 补仓价: ${price.toFixed(4)} | 数量: ${qty} | 补仓价值: ${(qty * price).toFixed(2)} USDT`
                        );
                    } else {
                        this.addLog(
                            'SUCCESS',
                            `🟢 [开仓对账同步] 成功记录开仓流水: ${rawSymbol} ${inferredDirection} | 开仓价: ${price.toFixed(4)} | 数量: ${qty} | 开仓价值: ${(qty * price).toFixed(2)} USDT`
                        );
                    }
                } else {
                    // 已有该开仓记录，若为分批成交则补充累计成交量与金额
                    if (qty > (existingOpenLog.current_amount || 0)) {
                        existingOpenLog.current_amount = qty;
                        existingOpenLog.cost_usdt = qty * (existingOpenLog.entry_price || price);
                        hasNewUpdates = true;
                    }
                    if (!existingOpenLog.binance_order_id && orderId) {
                        existingOpenLog.binance_order_id = orderId;
                        this.knownOrderIds.add(orderId);
                        hasNewUpdates = true;
                    }
                }
            }
        }

        if (hasNewUpdates) {
            // Deduplicate logs: ensure strictly at most 1 OPEN log per unique orderId or active position
            const seenKeys = new Set<string>();
            const seenOpenEntries = new Set<string>();

            this.tradeLogs = this.tradeLogs.filter(l => {
                if (!l) return false;
                if (this.clearedTradeLogsTimestamp && (l.exit_timestamp || l.entry_timestamp || 0) <= this.clearedTradeLogsTimestamp) {
                    return false;
                }

                if (l.status === 'OPEN') {
                    const norm = normalizeSymbol(l.symbol);
                    const openKey = l.binance_order_id 
                        ? `OPEN_ORDER_${l.binance_order_id}` 
                        : (l.entry_id ? `OPEN_ID_${l.entry_id}` : `OPEN_SYM_${norm}_${l.direction}_${l.entry_timestamp || 0}`);
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
        const isInferredClose = trade.action !== "OPEN" && (
            trade.action === "CLOSE" || 
            (realizedPnl !== 0) || 
            (positionSide === "LONG" && side === "SELL") || 
            (positionSide === "SHORT" && side === "BUY")
        );

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
            // 判断是减仓(部分平仓)还是完全平仓
            const targetPos = this.positions.find(p => 
                normalizeSymbol(p.symbol) === normSym && 
                (p.side === inferredDirection || positionSide === "BOTH")
            );

            // 🔒【真实盈亏核算铁律】若 WebSocket 即时回报 realizedPnl 为 0，根据开平仓价差精确核算 USDT 真实盈亏
            let finalPnl = (realizedPnl !== undefined && realizedPnl !== 0) ? realizedPnl : 0;
            if (finalPnl === 0 && entryPrice > 0 && avgPrice > 0) {
                if (inferredDirection === PositionSide.LONG) {
                    finalPnl = (avgPrice - entryPrice) * qty;
                } else {
                    finalPnl = (entryPrice - avgPrice) * qty;
                }
            } else if (finalPnl === 0 && targetPos && targetPos.unrealizedPnL !== 0) {
                finalPnl = targetPos.unrealizedPnL;
            }

            const isPartialClose = !!targetPos && (targetPos.amount - qty > 0.0001);
            const exitReason = isPartialClose
                ? "实盘减仓(部分平仓) / 手机APP/外部/系统平仓"
                : (trade.action === "CLOSE" ? "实盘完全平仓 / 手机APP/外部/系统平仓" : (finalPnl >= 0 ? "实盘止盈平仓 / 手机APP/外部/系统平仓" : "实盘止损平仓 / 手机APP/外部/系统平仓"));
            const profitPercent = costUsdt > 0 ? (finalPnl / costUsdt) * 100 : (entryPrice > 0 ? ((avgPrice - entryPrice) / entryPrice) * (inferredDirection === PositionSide.LONG ? 100 : -100) : 0);

            // 生成完全独立的 CLOSED 交易流水
            this.tradeLogs.unshift({
                symbol: rawSymbol,
                entry_id: matchingOpenLog?.entry_id || `instant_close_${orderId || Date.now()}`,
                binance_order_id: orderId || undefined,
                status: 'CLOSED',
                profit_usdt: finalPnl,
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
                    action: isPartialClose ? `部分减仓 (${finalPnl >= 0 ? '盈利' : '亏损'})` : (finalPnl >= 0 ? '盈利平仓' : '止损平仓'),
                    price: avgPrice,
                    amount: qty,
                    reason: exitReason,
                    pnl: finalPnl
                }]
            });

            if (orderId) this.knownOrderIds.add(orderId);

            // ⚡ [即时持仓同步] 收到币安成交回报后，毫秒级直接从持仓列表扣减或彻底移除已平仓位！
            const lookupKey = `${normSym}_${inferredDirection}`;
            this.recentlyClosedKeys.set(lookupKey, tradeTime);
            this.inFlightClosingPool.delete(lookupKey);
            this.inFlightClosingPool.delete(normSym);

            let remainingAmount = 0;
            const posIdx = this.positions.findIndex(p => 
                normalizeSymbol(p.symbol) === normSym && 
                (p.side === inferredDirection || positionSide === "BOTH")
            );

            if (posIdx >= 0) {
                const currentPos = this.positions[posIdx];
                remainingAmount = Math.max(0, currentPos.amount - qty);
                if (remainingAmount <= 0.0001) {
                    console.log(`⚡ [Instant Position Removal] Completely removed closed position ${rawSymbol} (${inferredDirection}) via WebSocket fill`);
                    this.positions.splice(posIdx, 1);
                } else {
                    console.log(`⚡ [Instant Position Deduct] Deducted ${qty} from ${rawSymbol} (${inferredDirection}), remaining: ${remainingAmount}`);
                    this.positions[posIdx] = {
                        ...currentPos,
                        amount: remainingAmount
                    };
                }
            }

            // 检查该币种是否已无任何持仓，清理对冲标记
            if (!this.positions.some(p => normalizeSymbol(p.symbol) === normSym && p.amount > 0.0001)) {
                this.amputatedSymbolsInCycle.delete(normSym);
            }

            const pnlFormatted = finalPnl >= 0 ? `+${finalPnl.toFixed(4)}` : `${finalPnl.toFixed(4)}`;
            if (isPartialClose) {
                this.addLog(
                    finalPnl >= 0 ? 'SUCCESS' : 'WARNING',
                    `🟡 [减仓成交] 收到减仓(部分平仓)成交回报: ${rawSymbol} ${inferredDirection} | 减仓价: ${avgPrice.toFixed(4)} | 数量: ${qty} | 减仓价值: ${(qty * avgPrice).toFixed(2)} USDT | 实现盈亏: ${pnlFormatted} USDT | 剩余持仓: ${remainingAmount} (来源: 手机APP/外部/系统)`
                );
            } else {
                this.addLog(
                    finalPnl >= 0 ? 'SUCCESS' : 'WARNING',
                    `${finalPnl >= 0 ? '🟢' : '🔴'} [完全平仓] 收到完全平仓成交回报: ${rawSymbol} ${inferredDirection} | 平仓价: ${avgPrice.toFixed(4)} | 数量: ${qty} | 平仓价值: ${(qty * avgPrice).toFixed(2)} USDT | 实现盈亏: ${pnlFormatted} USDT | 仓位已完全平仓出局 (来源: 手机APP/外部/系统)`
                );
            }

            this.emitUpdate(true);
        } else {
            // 开仓/加仓成交回报
            const inferredDirection = (positionSide === "SHORT" || (positionSide === "BOTH" && side === "SELL")) ? PositionSide.SHORT : PositionSide.LONG;
            
            // 判断当前持仓列表中是否已有该币种该方向的持仓（属于加仓/补仓还是全新开仓）
            const existingPosIdx = this.positions.findIndex(p => 
                normalizeSymbol(p.symbol) === normSym && 
                p.side === inferredDirection &&
                p.amount > 0.0001
            );
            const isRefill = existingPosIdx >= 0;

            // 检查该 orderId 或 10秒内同币同向是否已存在开仓流水记录
            const alreadyHasOpen = this.tradeLogs.find(l => 
                ((orderId && l.binance_order_id && String(l.binance_order_id) === orderId) ||
                 (normalizeSymbol(l.symbol) === normSym && l.direction === inferredDirection && Math.abs((l.entry_timestamp || 0) - tradeTime) < 10000)) &&
                l.status === 'OPEN'
            );

            if (alreadyHasOpen) {
                // 部分成交 (PARTIALLY_FILLED -> FILLED 累计) 或补充记录更新
                alreadyHasOpen.current_amount = qty;
                alreadyHasOpen.cost_usdt = qty * (avgPrice || alreadyHasOpen.entry_price || 0);
                if (avgPrice > 0) alreadyHasOpen.entry_price = avgPrice;
                if (orderId) this.knownOrderIds.add(orderId);
            } else {
                // 崭新独立开仓/补仓流水记录
                const opposingPos = this.positions.find(p => normalizeSymbol(p.symbol) === normSym && p.side !== inferredDirection);
                const isHedge = !!opposingPos || this.tradeLogs.some(l => normalizeSymbol(l.symbol) === normSym && l.status === 'OPEN' && l.direction !== inferredDirection);
                const mainPos = opposingPos || this.positions.find(p => normalizeSymbol(p.symbol) === normSym);

                const actionLabel = isRefill
                    ? `实盘补仓/加仓 (${inferredDirection})`
                    : (isHedge ? `防爆对冲开仓 (${inferredDirection})` : `实盘开仓 (${inferredDirection})`);
                const reasonLabel = isRefill
                    ? '币安即时成交补仓/加仓回报 (手机APP/外部/系统)'
                    : (isHedge ? '防爆对冲即时成交开仓回报' : '币安即时成交开仓回报 (手机APP/外部/系统)');

                this.tradeLogs.unshift({
                    symbol: rawSymbol,
                    entry_id: isRefill ? `refill_${normSym}_${inferredDirection}_${orderId || tradeTime}` : `instant_open_${normSym}_${inferredDirection}_${orderId || tradeTime}`,
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
                        action: actionLabel,
                        price: avgPrice,
                        amount: qty,
                        reason: reasonLabel
                    }]
                });

                if (orderId) this.knownOrderIds.add(orderId);
            }

            // ⚡ 核心提速：收到 WebSocket 开仓/加仓成交回报后，毫秒级直接将持仓更新或插入到持仓列表 (0ms即刻上屏，杜绝等待REST轮询)
            const openLookupKey = `${normSym}_${inferredDirection}`;
            this.inFlightRefillPool.delete(openLookupKey);
            this.inFlightRefillPool.delete(normSym);
            this.inFlightClosingPool.delete(openLookupKey);
            this.inFlightClosingPool.delete(normSym);

            if (isRefill) {
                // 已有持仓 (加仓、补仓或累计成交更新)
                const existingPos = this.positions[existingPosIdx];
                const newTotalQty = existingPos.amount + qty;
                const newEntryPrice = ((existingPos.amount * existingPos.entryPrice) + (qty * avgPrice)) / newTotalQty;
                this.positions[existingPosIdx] = {
                    ...existingPos,
                    amount: newTotalQty,
                    entryPrice: newEntryPrice,
                    markPrice: avgPrice > 0 ? avgPrice : existingPos.markPrice,
                    isPendingSync: false
                };

                this.addLog('SUCCESS', `🔵 [补仓成交] 收到补仓/加仓成交回报: ${rawSymbol} ${inferredDirection} | 补仓价: ${avgPrice.toFixed(4)} | 补仓数量: ${qty} | 补仓价值: ${(qty * avgPrice).toFixed(2)} USDT | 补仓后总持仓: ${newTotalQty} (新均价: ${newEntryPrice.toFixed(4)}) (来源: 手机APP/外部/系统)`);
            } else {
                // 全新开仓，立即插入到持仓列表中
                const opposingPos = this.positions.find(p => normalizeSymbol(p.symbol) === normSym && p.side !== inferredDirection);
                const isHedge = !!opposingPos || this.tradeLogs.some(l => normalizeSymbol(l.symbol) === normSym && l.status === 'OPEN' && l.direction !== inferredDirection);
                const mainPos = opposingPos || this.positions.find(p => normalizeSymbol(p.symbol) === normSym);

                const newPosition: Position = {
                    symbol: rawSymbol,
                    side: inferredDirection,
                    amount: qty,
                    entryPrice: avgPrice,
                    markPrice: avgPrice,
                    liquidationPrice: 0,
                    unrealizedPnL: 0,
                    unrealizedPnLPercentage: 0,
                    entryId: `instant_open_${normSym}_${inferredDirection}_${orderId || tradeTime}`,
                    entryTime: tradeTime,
                    isPendingSync: false,
                    isHedged: isHedge,
                    mainPositionId: isHedge ? mainPos?.entryId : undefined,
                    leverage: 20
                };
                this.positions.unshift(newPosition);

                this.addLog('SUCCESS', `🟢 [开仓成交] 收到新开仓成交回报: ${rawSymbol} ${inferredDirection} | 开仓价: ${avgPrice.toFixed(4)} | 开仓数量: ${qty} | 开仓价值: ${(qty * avgPrice).toFixed(2)} USDT (来源: 手机APP/外部/系统开仓)`);
            }
            this.emitUpdate(true);
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
                        this.addLog('INFO', `⚪ [账户变动同步] 手机APP/外部全平: ${pos.s} ${inferredSide || ''} 持仓已完全平仓归零，已同步从持仓列表移除`);
                    }
                    // 检查该币种是否已无任何持仓
                    if (!this.positions.some(p => normalizeSymbol(p.symbol) === normSym)) {
                        this.amputatedSymbolsInCycle.delete(normSym);
                    }
                } else if (inferredSide) {
                    // 持仓量发生变化 (部分平仓或加仓或新开)
                    const existingIdx = this.positions.findIndex(p => normalizeSymbol(p.symbol) === normSym && p.side === inferredSide);
                    const ep = parseFloat(pos.ep || "0");
                    const up = parseFloat(pos.up || "0");
                    const absQty = Math.abs(posAmount);

                    if (existingIdx >= 0) {
                        const oldQty = this.positions[existingIdx].amount;
                        this.positions[existingIdx] = {
                            ...this.positions[existingIdx],
                            amount: absQty,
                            entryPrice: ep > 0 ? ep : this.positions[existingIdx].entryPrice,
                            unrealizedPnL: up
                        };
                        positionsChanged = true;

                        if (absQty < oldQty - 0.0001) {
                            this.addLog('WARNING', `🟡 [账户变动同步] 手机APP/外部减仓: ${pos.s} ${inferredSide} 持仓量由 ${oldQty} 减少至 ${absQty} (减少: ${(oldQty - absQty).toFixed(4)})`);
                        } else if (absQty > oldQty + 0.0001) {
                            this.addLog('SUCCESS', `🔵 [账户变动同步] 手机APP/外部补仓/加仓: ${pos.s} ${inferredSide} 持仓量由 ${oldQty} 增加至 ${absQty} (增加: ${(absQty - oldQty).toFixed(4)})`);
                        }
                    } else if (absQty > 0.00001) {
                        const opposingPos = this.positions.find(p => normalizeSymbol(p.symbol) === normSym && p.side !== inferredSide);
                        const isHedge = !!opposingPos;
                        const entryId = `acc_open_${normSym}_${inferredSide}_${Date.now()}`;
                        const entryPrice = ep > 0 ? ep : 0;
                        this.positions.unshift({
                            symbol: pos.s,
                            side: inferredSide,
                            amount: absQty,
                            entryPrice: entryPrice,
                            markPrice: entryPrice,
                            liquidationPrice: 0,
                            unrealizedPnL: up,
                            unrealizedPnLPercentage: 0,
                            entryId,
                            entryTime: Date.now(),
                            isPendingSync: false,
                            isHedged: isHedge,
                            mainPositionId: isHedge ? opposingPos?.entryId : undefined,
                            leverage: 20
                        });
                        positionsChanged = true;

                        this.addLog('SUCCESS', `🟢 [账户变动同步] 手机APP/外部新开持仓: ${pos.s} ${inferredSide} | 数量: ${absQty} | 均价: ${entryPrice > 0 ? entryPrice.toFixed(4) : '0'} | 价值: ${(absQty * entryPrice).toFixed(2)} USDT，已即时同步至持仓列表`);

                        const hasOpen = this.tradeLogs.some(l => normalizeSymbol(l.symbol) === normSym && l.status === 'OPEN' && l.direction === inferredSide);
                        if (!hasOpen) {
                            this.tradeLogs.unshift({
                                symbol: pos.s,
                                entry_id: entryId,
                                status: 'OPEN',
                                is_hedge: isHedge,
                                main_entry_id: isHedge ? opposingPos?.entryId : undefined,
                                entry_timestamp: Date.now(),
                                direction: inferredSide,
                                cost_usdt: absQty * entryPrice,
                                entry_price: entryPrice,
                                current_amount: absQty,
                                timeframe: '5m',
                                events: [{
                                    timestamp: Date.now(),
                                    action: isHedge ? `防爆对冲开仓 (${inferredSide})` : `实盘开仓 (${inferredSide})`,
                                    price: entryPrice,
                                    amount: absQty,
                                    reason: '手机APP/外部新开仓 (账户变动同步)'
                                }]
                            });
                        }
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
        this.processedDebtOrderKeys.clear();
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

        if (this.onLog) {
            try {
                this.onLog(type, finalMessage, true);
            } catch (e) {}
        }
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
            
            // 分小批 (每批最多3个币) 发起请求，彻底避免瞬间并发打满浏览器/服务端网络连接池
            const BATCH_SIZE = 3;
            for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
                const batch = symbols.slice(i, i + BATCH_SIZE);
                await Promise.all(batch.map(async (symbol) => {
                    try {
                        const rawSafe = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
                        const spotSafe = rawSafe.startsWith('1000') ? rawSafe.slice(4) : rawSafe;
                        const url = `https://data-api.binance.vision/api/v3/klines?symbol=${spotSafe}&interval=1h&limit=100`;
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
            }
        } catch (err) {
            console.error('Failed to update indicators:', err);
        } finally {
            this.isUpdatingIndicators = false;
        }
    }

    private emaCacheMap = new Map<string, { value: number, time: number }>();

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
            const now = Date.now();
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
                    const spotSafe = safeSymbol.startsWith('1000') ? safeSymbol.slice(4) : safeSymbol;
                    const cacheKey = `${safeSymbol}_${tf}_${atrSettings.emaPeriod}`;
                    
                    const cached = this.emaCacheMap.get(cacheKey);
                    if (cached && (now - cached.time < 60000)) {
                        pos.currentEmaValue = cached.value;
                        continue;
                    }

                    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${spotSafe}&interval=${tf}&limit=120`;
                    const res = await fetchWithFallback(url, {}, undefined, this.settings.system.directMode);
                    const data = await res.json();
                    
                    if (Array.isArray(data)) {
                        // Exclude the current live candle (last one) to avoid EMI drift
                        const closes = data.slice(0, -1).map((d: any) => parseFloat(d[4]));
                        const emaValue = getLatestEMA(closes, atrSettings.emaPeriod);
                        pos.currentEmaValue = emaValue;
                        this.emaCacheMap.set(cacheKey, { value: emaValue, time: now });
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
        // [已按指令移除 300天极值比例对冲 功能] 零网络开销
        return;
    }

    private async fetchShortTermExtremePrice(pos: Position) {
        // [已按指令彻底移除 短期极值比例对冲 功能] 零日K网络开销与零背景查询
        return;
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

            // 🔒【对冲与救世周期绝对单边平仓铁律】：
            // 凡是该币种存在反向活跃仓位 (双向持仓)、处于对冲状态 (isHedged)、处于被砍仓待回踩状态 (isAmputated / amputatedAmount > 0)、处于对冲周期集合中、或作为对冲从仓 (mainPositionId)，
            // 模块1常规止盈止损 / 单边安全清仓 一律 100% 物理失效！绝对严禁擅自单平一方（包括砍仓剩余的10%底仓）导致另一方沦为孤儿单！
            const hasActiveOpposing = this.positions.some(p => 
                normalizeSymbol(p.symbol) === symbolKey && 
                p.side !== position.side && 
                p.amount > 0.0001
            );
            const isUnderHedgeOrAmp = hasActiveOpposing || 
                position.isHedged || 
                !!position.mainPositionId || 
                position.isAmputated || 
                (position.amputatedAmount || 0) > 0 ||
                this.amputatedSymbolsInCycle.has(symbolKey);

            if (isUnderHedgeOrAmp && !position.isUnshackled) {
                // 处于对冲或断臂求生周期中，严禁单边止盈止损与单边清仓！
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
                },
                this.positions
            );
            
            // 2.2 Hedge Guardian Safe Clear Rules (New)
            if (!triggered) {
                triggered = checkSafeClearRules(
                    position,
                    this.settings,
                    (symbol, side, reason) => {
                        this.closePosition(symbol, side, reason, position.entryId);
                        actionTaken = true;
                    },
                    this.positions
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

            // B. Trend Firewall (趋势防火墙二次检测)
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
                (pos, reason, customQty) => {
                    this.refill(pos, reason, customQty);
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
                    this.getPositions(),
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

      // --- 0.1 EMA CACHE UPDATE (15s interval to save network) ---
      if (now - this.lastEmaCheckTime > 15000) { 
          this.lastEmaCheckTime = now;
          this.updateEmaCache();
      }

      // --- 0.2 INDICATOR UPDATE (For AI & DNA - 60s optimized interval to save network) ---
      if (now - this.lastIndicatorCheckTime > 60000) {
          this.lastIndicatorCheckTime = now;
          this.updateIndicators();
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

      // 1.6 Orphan Hedge Guard Check (每5秒巡检孤儿对冲单)
      if (now - this.lastOrphanCheckTime > 5000) {
          this.lastOrphanCheckTime = now;
          this.checkOrphanHedges();
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

    private lastOrphanCheckTime: number = 0;
    public checkOrphanHedges() {
        const symbolMap = new Map<string, Position[]>();
        for (const p of this.positions) {
            if (p.amount <= 0.00001) continue;
            const sym = normalizeSymbol(p.symbol);
            if (!symbolMap.has(sym)) symbolMap.set(sym, []);
            symbolMap.get(sym)!.push(p);
        }

        for (const [sym, list] of symbolMap.entries()) {
            if (list.length === 1) {
                const p = list[0];
                const isHedge = p.entryId?.startsWith('HEDGE_') || (p as any).is_hedge === true || !!p.mainPositionId;
                if (isHedge) {
                    p.isOrphanHedge = true;
                    if (!(p as any)._orphanReported) {
                        (p as any)._orphanReported = true;
                        this.addLog('WARNING', `⚠️ [孤儿对冲单安全警报] 检测到 ${sym} (${p.side}) 存在单边孤儿对冲仓位 (原主仓已平仓)。请注意风控管理！`);
                    }
                } else {
                    p.isOrphanHedge = false;
                }
            } else {
                list.forEach(p => { p.isOrphanHedge = false; });
            }
        }
    }
}
