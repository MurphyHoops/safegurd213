
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
        const price = this.realPrices[normalizeSymbol(task.symbol)] || task.extremePrice;
        const usdtCost = task.amount * price;
        this.addLog('SUCCESS', `🚀 [Rule A] 触发解套自动开仓: ${task.symbol} ${task.side} | 数量: ${task.amount.toFixed(4)} (${usdtCost.toFixed(2)} USDT) | 当前价: ${price.toFixed(4)} (自极值 ${task.extremePrice.toFixed(4)} 回调确认)`);
        
        this.openPosition(
            task.symbol,
            task.side,
            usdtCost,
            price,
            '1m',
            undefined,
            undefined
        );
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

        // 1. Process and match new/existing positions
        for (const newPos of newPositions) {
            const symbolKey = normalizeSymbol(newPos.symbol);
            const lookupKey = `${symbolKey}_${newPos.side}`;
            const pendingProps = this.pendingRealOpenProps ? this.pendingRealOpenProps[lookupKey] : undefined;

            // Find ALL local positions that match this symbol and side
            // CRITICAL DEFENSE: If there is a pending real open prop (indicating we just triggered a new open/reopen order),
            // we MUST NOT match this incoming position with any old/stale position.
            // This ensures the new position gets registered with a fresh entryTime and entryId, rather than inheriting stale ones.
            const hasPendingOpen = !!pendingProps;
            const matchingOldPositions = hasPendingOpen
                ? []
                : oldPositions.filter(p => normalizeSymbol(p.symbol) === normalizeSymbol(newPos.symbol) && p.side === newPos.side && p.amount > 0);
            
            if (matchingOldPositions.length > 0) {
                // Determine scale factor if there are multiple positions
                const totalOldAmount = matchingOldPositions.reduce((sum, p) => sum + p.amount, 0);
                const scaleFactor = totalOldAmount > 0 ? (newPos.amount / totalOldAmount) : 1;

                for (const oldPos of matchingOldPositions) {
                    // Preserve original entry ID, time, and custom local attributes
                    const mergedPos: Position = {
                        ...newPos,
                        entryId: oldPos.entryId || newPos.entryId,
                        entryTime: oldPos.entryTime || newPos.entryTime,
                        amount: matchingOldPositions.length > 1 ? oldPos.amount * scaleFactor : newPos.amount,
                        signalTf: oldPos.signalTf || newPos.signalTf,
                        signalCandle: oldPos.signalCandle || newPos.signalCandle,
                        entryEmas: oldPos.entryEmas || newPos.entryEmas,
                        isHedged: oldPos.isHedged,
                        mainPositionId: oldPos.mainPositionId,
                        isReopened: oldPos.isReopened,
                        reopenCount: oldPos.reopenCount,
                        correlationId: oldPos.correlationId,
                        hedgeRetries: oldPos.hedgeRetries,
                        cumulativeHedgeLoss: oldPos.cumulativeHedgeLoss,
                        cumulativeHedgeProfit: oldPos.cumulativeHedgeProfit,
                        cumulativeAmputationLoss: oldPos.cumulativeAmputationLoss,
                        cumulativeAmputationProfit: oldPos.cumulativeAmputationProfit,
                        lastAmputationTime: oldPos.lastAmputationTime,
                        amputationTriggered: oldPos.amputationTriggered,
                        maxPnLAfterAmputationTrigger: oldPos.maxPnLAfterAmputationTrigger,
                        maxPnLPercentAfterAmputationTrigger: oldPos.maxPnLPercentAfterAmputationTrigger,
                        isUnshackled: oldPos.isUnshackled,
                        amputatedAmount: oldPos.amputatedAmount,
                        maxPnLPercent: oldPos.maxPnLPercent,
                        customProfitSettings: 'customProfitSettings' in newPos ? newPos.customProfitSettings : oldPos.customProfitSettings
                    };
                    updatedPositions.push(mergedPos);

                    // Ensure an OPEN log exists for this still active position, matching by entryId or (symbol + side)
                    let existingOpenLog = this.tradeLogs.find(l => 
                        l.status === 'OPEN' && 
                        (l.entry_id === mergedPos.entryId || 
                         (normalizeSymbol(l.symbol) === normalizeSymbol(mergedPos.symbol) && l.direction === mergedPos.side))
                    );

                    if (existingOpenLog) {
                        // Self-healing / Binding
                        if (existingOpenLog.entry_id !== mergedPos.entryId) {
                            console.log(`[Simulator Healing] Binding log entryId from ${existingOpenLog.entry_id} to ${mergedPos.entryId}`);
                            existingOpenLog.entry_id = mergedPos.entryId;
                        }
                        if ((!existingOpenLog.entry_price || existingOpenLog.entry_price <= 0) && mergedPos.entryPrice > 0) {
                            console.log(`[Simulator Healing] Healing entry_price for ${mergedPos.symbol} from ${existingOpenLog.entry_price} to ${mergedPos.entryPrice}`);
                            existingOpenLog.entry_price = mergedPos.entryPrice;
                            existingOpenLog.cost_usdt = mergedPos.amount * mergedPos.entryPrice;
                            if (existingOpenLog.events && existingOpenLog.events[0]) {
                                existingOpenLog.events[0].price = mergedPos.entryPrice;
                                existingOpenLog.events[0].amount = mergedPos.amount;
                            }
                        }
                    } else {
                        const fallbackPrice = mergedPos.markPrice || this.realPrices[normalizeSymbol(mergedPos.symbol)] || 0;
                        const finalEntryPrice = (mergedPos.entryPrice && mergedPos.entryPrice > 0) ? mergedPos.entryPrice : fallbackPrice;
                        if (mergedPos.entryPrice <= 0 && finalEntryPrice > 0) {
                            mergedPos.entryPrice = finalEntryPrice;
                        }

                        this.tradeLogs.unshift({
                            symbol: mergedPos.symbol,
                            entry_id: mergedPos.entryId,
                            status: 'OPEN',
                            is_hedge: !!mergedPos.mainPositionId,
                            entry_timestamp: mergedPos.entryTime,
                            direction: mergedPos.side,
                            cost_usdt: mergedPos.amount * mergedPos.entryPrice,
                            entry_price: mergedPos.entryPrice,
                            correlationId: mergedPos.correlationId,
                            is_reopened: mergedPos.isReopened,
                            reopenCount: mergedPos.reopenCount,
                            timeframe: mergedPos.signalTf || '5m',
                            events: [{
                                timestamp: mergedPos.entryTime,
                                action: '开仓',
                                price: mergedPos.entryPrice,
                                amount: mergedPos.amount,
                                reason: '实盘发现/触发开仓'
                            }]
                        });
                    }
                }
            } else {
                // Brand new position discovered
                const entryId = newPos.entryId || `real_${newPos.symbol}_${newPos.side}`;
                const entryTime = Date.now();
                
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

                // Ensure an OPEN log exists for this brand new position, matching by entryId or (symbol + side)
                let existingOpenLog = this.tradeLogs.find(l => 
                    l.status === 'OPEN' && 
                    (l.entry_id === entryId || 
                     (normalizeSymbol(l.symbol) === normalizeSymbol(processedPos.symbol) && l.direction === processedPos.side))
                );

                if (existingOpenLog) {
                    // Self-healing / Binding
                    if (existingOpenLog.entry_id !== entryId) {
                        console.log(`[Simulator Healing] Binding log entryId from ${existingOpenLog.entry_id} to ${entryId}`);
                        existingOpenLog.entry_id = entryId;
                    }
                    if ((!existingOpenLog.entry_price || existingOpenLog.entry_price <= 0) && processedPos.entryPrice > 0) {
                        console.log(`[Simulator Healing] Healing entry_price for ${processedPos.symbol} from ${existingOpenLog.entry_price} to ${processedPos.entryPrice}`);
                        existingOpenLog.entry_price = processedPos.entryPrice;
                        existingOpenLog.cost_usdt = processedPos.amount * processedPos.entryPrice;
                        if (existingOpenLog.events && existingOpenLog.events[0]) {
                            existingOpenLog.events[0].price = processedPos.entryPrice;
                            existingOpenLog.events[0].amount = processedPos.amount;
                        }
                    }
                } else {
                    const fallbackPrice = processedPos.markPrice || this.realPrices[normalizeSymbol(processedPos.symbol)] || 0;
                    const finalEntryPrice = (processedPos.entryPrice && processedPos.entryPrice > 0) ? processedPos.entryPrice : fallbackPrice;
                    if (processedPos.entryPrice <= 0 && finalEntryPrice > 0) {
                        processedPos.entryPrice = finalEntryPrice;
                    }

                    this.tradeLogs.unshift({
                        symbol: processedPos.symbol,
                        entry_id: entryId,
                        status: 'OPEN',
                        is_hedge: !!processedPos.mainPositionId,
                        entry_timestamp: entryTime,
                        direction: processedPos.side,
                        cost_usdt: processedPos.amount * processedPos.entryPrice,
                        entry_price: processedPos.entryPrice,
                        correlationId: processedPos.correlationId,
                        is_reopened: processedPos.isReopened,
                        reopenCount: processedPos.reopenCount,
                        timeframe: processedPos.signalTf,
                        events: [{
                            timestamp: entryTime,
                            action: '开仓',
                            price: processedPos.entryPrice,
                            amount: processedPos.amount,
                            reason: '实盘发现/触发开仓'
                        }]
                    });
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

                    // D. Fallback: If we STILL cannot determine but we have two opposing positions,
                    // we MUST pair them up anyway to prevent double-hedging, which causes severe bugs.
                    if (!main || !hedge) {
                        // Compare entry times (older is main, newer is hedge)
                        const timeA = posA.entryTime || 0;
                        const timeB = posB.entryTime || 0;
                        if (Math.abs(timeA - timeB) > 500) {
                            if (timeA < timeB) {
                                main = posA;
                                hedge = posB;
                            } else {
                                main = posB;
                                hedge = posA;
                            }
                        } else {
                            // If entry times are too close (e.g. both created at same sync tick),
                            // make the larger amount the main position.
                            const amtA = posA.amount || 0;
                            const amtB = posB.amount || 0;
                            if (amtA !== amtB) {
                                if (amtA > amtB) {
                                    main = posA;
                                    hedge = posB;
                                } else {
                                    main = posB;
                                    hedge = posA;
                                }
                            } else {
                                // Default fallback if amounts are also equal: LONG is main, SHORT is hedge
                                if (posA.side === PositionSide.LONG) {
                                    main = posA;
                                    hedge = posB;
                                } else {
                                    main = posB;
                                    hedge = posA;
                                }
                            }
                        }
                    }

                    if (main && hedge) {
                        main.isHedged = true;
                        if (main.mainPositionId) {
                            delete main.mainPositionId;
                        }
                        hedge.mainPositionId = main.entryId;
                        hedge.isHedged = true;
                        
                        // Heal trade log flags to match
                        const hedgeLog = this.tradeLogs.find(l => l.entry_id === hedge.entryId && l.status === 'OPEN');
                        if (hedgeLog) {
                            hedgeLog.is_hedge = true;
                        }
                        
                        console.log(`[Self-Healing Pairing] Successfully paired opposing positions for ${sym}: Main=${main.side} (${main.entryId}), Hedge=${hedge.side} (${hedge.entryId})`);
                    }
                }
            } else if (posList.length === 1) {
                // If there's only 1 position for the symbol, keep its existing mainPositionId/isHedged identity
                // per user instruction so that the remaining side is still marked as 'Hedged position' or 'Original position'.
                const singlePos = posList[0];
                // Do not reset flags to preserve hedged status
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

                // If this is a real position but is pending sync or was recently opened, ONLY preserve if opened within 3000ms
                if (isReal && !oldPos.isBeingClosed && oldPos.isPendingSync && (Date.now() - (oldPos.entryTime || 0) < 3000)) {
                    console.log(`[MarketSimulator] Preserving recently submitted open position ${oldPos.symbol} (${oldPos.side})`);
                    updatedPositions.push(oldPos);
                    continue;
                }

                // If this position was fully amputated to 0, preserve it so it stays in UI with amount = 0
                // ONLY preserve it if there is still another active (non-zero amount) position left for this symbol in updatedPositions
                if (oldPos.isAmputatedToZero && !oldPos.isBeingClosed) {
                    const hasActiveForSymbol = updatedPositions.some(p => normalizeSymbol(p.symbol) === normalizeSymbol(oldPos.symbol) && p.amount > 0);
                    if (hasActiveForSymbol) {
                        console.log(`[MarketSimulator] Preserving amputated-to-zero position ${oldPos.symbol} (${oldPos.side}) as other active positions exist`);
                        oldPos.amount = 0; // Ensure amount is exactly 0
                        updatedPositions.push(oldPos);
                        continue;
                    } else {
                        console.log(`[MarketSimulator] Removing amputated-to-zero position ${oldPos.symbol} (${oldPos.side}) as no active positions remain for this symbol`);
                        continue;
                    }
                }

                // If this is the initial sync after program restart, do NOT log close to prevent ghost closing records from stale local cache on boot.
                if (isFirstSync) {
                    console.log(`[MarketSimulator] Initial sync: omitting close log for ${oldPos.symbol} as it was not found in active real positions`);
                    continue;
                }

                // Position has been closed! Check if we already logged it as CLOSED
                const alreadyClosed = this.tradeLogs.some(l => l.entry_id === oldPos.entryId && l.status === 'CLOSED');
                if (!alreadyClosed) {
                    this.recordRealTradeLog(oldPos, '实盘平仓 / 止盈止损已执行');
                }
            }
        }

        if (isReal && !this.initialSyncCompleted) {
            this.initialSyncCompleted = true;
            console.log("[MarketSimulator] Real-trading initial sync completed successfully. Ghost log defense activated.");
        }

        this.positions = updatedPositions;
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
            if (this.positions.length < originalLength) {
                console.log(`[MarketSimulator] Cleaned up amputated-to-zero positions for ${cleanSymbol} as no active positions remain.`);
            }
        }
    }

    public removePositionLocally(symbol: string, side?: PositionSide) {
        const cleanSymbol = normalizeSymbol(symbol);
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

    private addTradeEvent(pos: Position, action: string, price: number, amount: number, reason: string, pnl?: number) {
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

        // 🛡️ [Strict Duplicate Hedge Guard]
        const existingHedge = this.positions.find(p => 
            normalizeSymbol(p.symbol) === upperSymbol && 
            p.side === side && 
            p.amount > 0 &&
            (p.mainPositionId === mainPosition.entryId || p.entryId?.startsWith('HEDGE_'))
        );
        if (mainPosition.isHedged || existingHedge) {
            this.addLog('WARNING', `🛡️ [对冲重复拦截] ${upperSymbol} 已被标记为已对冲，或已存在活跃对冲单 ${existingHedge?.entryId || ''}，拦截本次重复对冲开仓。`);
            mainPosition.isHedged = true; // Repair flag
            return;
        }

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

        const exactQty = originalQty * (activeHedgeRatio / 100);
        const exactUsdtAmount = exactQty * executionPrice;

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
        delete mainPosition.isUnshackled;
        mainPosition.hedgeRetries = (mainPosition.hedgeRetries || 0) + 1;
        this.positions.push(newPos);
        this.symbolsWithFreshPrice.add(upperSymbol);

        // Record Open Log for Hedge
        this.tradeLogs.unshift({
            symbol: mainPosition.symbol,
            entry_id: entryId,
            status: 'OPEN',
            is_hedge: true,
            entry_timestamp: newPos.entryTime,
            direction: side,
            cost_usdt: amount,
            entry_price: executionPrice,
            main_entry_id: mainPosition.entryId,
            correlationId: newPos.correlationId,
            timeframe: mainPosition.signalTf
        });

        // Add sub-event to main log
        this.addTradeEvent(mainPosition, `对冲开启 (${side})`, executionPrice, newPos.amount, reason || '对冲策略触发');

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

            // Rule A: Check if autoOpenAfterHedgeProfit is enabled, and there was an active hedge
            if (hedge && this.settings.stopLoss.autoOpenAfterHedgeProfit) {
                const maxPnL = hedge.maxPnLPercent || 0;
                let extremePrice = hedge.entryPrice;
                if (hedge.side === PositionSide.SHORT) {
                    // 空单的最低价 (SHORT hedge)
                    extremePrice = hedge.entryPrice * (1 - maxPnL / 100);
                } else {
                    // 多单的最高价 (LONG hedge)
                    extremePrice = hedge.entryPrice * (1 + maxPnL / 100);
                }
                
                const pullbackPercent = this.settings.stopLoss.autoOpenPullbackPercent || 5;
                
                this.pendingAutoOpens.push({
                    symbol: main.symbol,
                    side: main.side,
                    amount: main.amount, // original coin amount
                    extremePrice: extremePrice,
                    pullbackPercent: pullbackPercent,
                    mainEntryId: main.entryId
                });
                this.savePendingAutoOpens();
                this.addLog('INFO', `[对冲解套自动开仓已挂载] ${main.symbol} 将在极值价格 ${extremePrice.toFixed(4)} 回撤 ${pullbackPercent}% 后自动复开`);
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
                audioService.speak(`${cleanSym}断臂求生对冲平仓成功`, true);
            } else {
                audioService.speak(`${cleanSym}对冲盈利解套平仓成功`, true);
            }

            this.addLog('INFO', `[调试] 当前剩余仓位数量: ${this.positions.length}`);

            // Evaluate Reopen Rule for Strategy 4 ("断臂求生")
            this.addLog('INFO', `[调试] reason: ${reason}, isAmputationProfitExit: ${isAmputationProfitExit}`);
            if (isAmputationProfitExit && this.settings.stopLoss.amputationReopenEnabled) {
                if (isHedgeProfitable) {
                    // 满足条件：对冲仓盈利解套，清除对冲仓位和原仓位干净后，再开一个原仓位初始开仓数量和方向的仓位
                    this.addLog('INFO', `🔄 [断臂完全复开触发] 对冲仓位盈利解套且账户仓位已全部清空。执行原仓位初始开仓数量和方向的完全复开。`);
                    this.reopenPosition(main, `断臂求生对冲仓盈利解套自动复开`);
                } else if (isMainProfitable) {
                    this.addLog('INFO', `ℹ️ [断臂复开跳过] 原仓位盈利解套，已交给「只清对冲、主仓续航」管理，不执行原仓位完全复开`);
                } else {
                    this.addLog('INFO', `ℹ️ [断臂复开跳过] 未满足对冲仓位盈利解套的前提条件，不执行原仓位完全复开`);
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

        // 2. Max Reopen Count check
        const maxReopen = this.settings.stopLoss?.maxReopenCount ?? 3;
        const nextReopenCount = (pos.reopenCount || 0) + 1;
        if (nextReopenCount > maxReopen) {
            this.addLog('WARNING', `⚠️ [原仓位复开] 拦截: ${pos.symbol} ${pos.side} 复开次数 (${nextReopenCount}) 超过最大限制 (${maxReopen})`);
            return;
        }

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
            correlationId: corrId,
            parentEntryId: pos.entryId
        };

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
        // 🔒 [断臂求生防重复砍仓安全锁] 8秒内不允许对同一仓位进行二次砍仓，留足币安执行与API同步时间
        const now = Date.now();
        const lastAmp = position.lastAmputationTime || 0;
        if (now - lastAmp < 8000) {
            console.warn(`[Amputation Cooldown] 🛡️ 拦截重复砍仓触发: ${position.symbol} ${position.side} 处于8秒冷却中(上次砍仓: ${now - lastAmp}ms前)`);
            return;
        }
        position.lastAmputationTime = now;

        const cutAmount = position.amount * (ratio / 100);
        
        if (this.settings?.system?.realTrading) {
            if (this.onRealClose) {
                this.onRealClose(position, reason, cutAmount, ratio);
            }
            return;
        }
        
        // 记录砍仓的实际盈亏
        const realizedPnL = position.unrealizedPnL * (ratio / 100);
        
        position.amount -= cutAmount;
        if (position.amount <= 0.0001) {
            position.amount = 0;
            position.isAmputatedToZero = true;
        }
        position.amputatedAmount = (position.amputatedAmount || 0) + cutAmount;
        
        if (realizedPnL < 0) {
            position.cumulativeAmputationLoss = (position.cumulativeAmputationLoss || 0) + Math.abs(realizedPnL);
        } else {
            position.cumulativeAmputationProfit = (position.cumulativeAmputationProfit || 0) + realizedPnL;
        }
        
        // now is already declared at the top of amputate method
        const isStopLoss = realizedPnL < 0;

        const wasEverHedged = position.isHedged || (position.hedgeRetries || 0) > 0 || !!position.mainPositionId || (position.cumulativeHedgeLoss || 0) > 0 || (position.cumulativeHedgeProfit || 0) > 0;

        // 记录交易日志
        this.tradeLogs.unshift({
            symbol: position.symbol,
            entry_id: position.entryId + '_cut_' + now + '_' + Math.random().toString(36).substring(2, 9),
            status: 'CLOSED',
            profit_usdt: realizedPnL,
            exit_reason: reason,
            is_hedge: wasEverHedged,
            entry_timestamp: position.entryTime,
            exit_timestamp: now,
            direction: position.side,
            cost_usdt: cutAmount * position.entryPrice,
            entry_price: position.entryPrice,
            exit_price: position.markPrice,
            profit_percent: position.unrealizedPnLPercentage,
            current_amount: position.amount,
            main_entry_id: position.mainPositionId, // Link to main position if it's a hedge
            parent_entry_id: position.entryId, // Link to original position
            timeframe: position.signalTf, // Store timeframe
            last_stop_loss_time: isStopLoss ? now : undefined,
            stop_loss_rule: isStopLoss ? reason : undefined
        });

        // Add sub-event to main log
        this.addTradeEvent(position, `减仓 (${ratio}%)`, position.markPrice, cutAmount, reason, realizedPnL);

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
        realizedPnL: number
    ) {
        const cleanSym = normalizeSymbol(symbol);
        const position = this.positions.find(p => normalizeSymbol(p.symbol) === cleanSym && p.side === side);
        if (!position) return;

        const now = Date.now();
        position.lastAmputationTime = now;
        
        position.amount = Math.max(0, position.amount - cutAmount);
        if (position.amount <= 0.0001) {
            position.amount = 0;
            position.isAmputatedToZero = true;
        }
        position.amputatedAmount = (position.amputatedAmount || 0) + cutAmount;

        if (realizedPnL < 0) {
            position.cumulativeAmputationLoss = (position.cumulativeAmputationLoss || 0) + Math.abs(realizedPnL);
        } else {
            position.cumulativeAmputationProfit = (position.cumulativeAmputationProfit || 0) + realizedPnL;
        }

        const isStopLoss = realizedPnL < 0;
        const wasEverHedged = position.isHedged || (position.hedgeRetries || 0) > 0 || !!position.mainPositionId || (position.cumulativeHedgeLoss || 0) > 0 || (position.cumulativeHedgeProfit || 0) > 0;

        // 记录交易日志
        this.tradeLogs.unshift({
            symbol: position.symbol,
            entry_id: position.entryId + '_cut_' + now + '_' + Math.random().toString(36).substring(2, 9),
            status: 'CLOSED',
            profit_usdt: realizedPnL,
            exit_reason: reason,
            is_hedge: wasEverHedged,
            entry_timestamp: position.entryTime,
            exit_timestamp: now,
            direction: position.side,
            cost_usdt: cutAmount * position.entryPrice,
            entry_price: position.entryPrice,
            exit_price: position.markPrice || position.entryPrice,
            profit_percent: position.unrealizedPnLPercentage || 0,
            current_amount: position.amount,
            main_entry_id: position.mainPositionId,
            parent_entry_id: position.entryId,
            timeframe: position.signalTf,
            last_stop_loss_time: isStopLoss ? now : undefined,
            stop_loss_rule: isStopLoss ? reason : undefined
        });

        // Add sub-event to main log
        this.addTradeEvent(position, `减仓 (${ratio}%)`, position.markPrice || position.entryPrice, cutAmount, reason, realizedPnL);

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
        const hasOppositeActive = this.positions.some(p => 
            p.symbol.toUpperCase() === upperSymbol && 
            p.side !== position.side && 
            p.amount > 0
        );
        const isRescueRefill = reason.includes('断臂') || reason.includes('求生');
        if (hasOppositeActive && !isRescueRefill) {
            this.addLog('WARNING', `🛡️ [对冲补仓拦截] ${position.symbol} 处于双向持仓对冲状态，安全锁已激活，拒绝自动补仓！只有等断臂砍仓/平对冲之后才能补仓。`);
            return;
        }

        if (!position.amputatedAmount || position.amputatedAmount <= 0) return;
        
        const refillAmount = position.amputatedAmount;
        
        if (this.settings?.system?.realTrading && this.onRealOpen) {
            this.onRealOpen(position, refillAmount, reason);
        }
        
        // Calculate new average entry price
        const currentTotalValue = position.amount * position.entryPrice;
        const refillValue = refillAmount * position.markPrice;
        const newTotalAmount = position.amount + refillAmount;
        const newEntryPrice = (currentTotalValue + refillValue) / newTotalAmount;
        
        position.entryPrice = newEntryPrice;
        position.amount = newTotalAmount;
        
        const wasEverHedged = position.isHedged || (position.hedgeRetries || 0) > 0 || !!position.mainPositionId || (position.cumulativeHedgeLoss || 0) > 0 || (position.cumulativeHedgeProfit || 0) > 0;

        // 记录交易日志 (开仓)
        this.tradeLogs.unshift({
            symbol: position.symbol,
            entry_id: position.entryId + '_refill_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
            status: 'OPEN',
            is_hedge: wasEverHedged,
            entry_timestamp: Date.now(),
            direction: position.side,
            cost_usdt: refillAmount * position.markPrice,
            entry_price: position.markPrice,
            current_amount: position.amount,
            main_entry_id: position.mainPositionId, // Link to main position if it's a hedge
            parent_entry_id: position.entryId, // Link to original position
            timeframe: position.signalTf // Store timeframe
        });

        // Add sub-event to main log
        this.addTradeEvent(position, '补回仓位', position.markPrice, refillAmount, reason);

        // 重置砍仓记录，但保留历史亏损记录用于算总账
        position.amputatedAmount = 0;
        // 重置止损标记，允许再次触发止损
        delete (position as any)._slTriggered;
        
        this.addLog('INFO', `🔄 补回仓位: ${position.symbol} ${position.side} 补回 ${refillAmount.toFixed(4)} | 新均价: ${newEntryPrice.toFixed(4)} | ${reason}`);
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

                // 转移对冲单在期间通过断臂砍仓已经发生的累计损失
                if (hedge.cumulativeAmputationLoss) {
                    main.cumulativeAmputationLoss = (main.cumulativeAmputationLoss || 0) + hedge.cumulativeAmputationLoss;
                }
                if (hedge.cumulativeAmputationProfit) {
                    main.cumulativeAmputationProfit = (main.cumulativeAmputationProfit || 0) + hedge.cumulativeAmputationProfit;
                }

                // Do not reset isHedged to false, keep it marked as 'Original position'
                main.isHedged = true;
                
                // 记录对冲单期间达到的极限价格，用于判断下一次是否突破
                const maxPnL = hedge.maxPnLPercent || 0;
                let newExtreme = 0;
                if (hedge.side === PositionSide.SHORT) {
                    // 空单的极限盈利对应的是最低价
                    newExtreme = hedge.entryPrice * (1 - maxPnL / 100);
                    // 只有当新极值比历史极值更低（更极端）时才更新
                    if (main.extremePrice === undefined || newExtreme < main.extremePrice) {
                        main.extremePrice = newExtreme;
                    }
                } else {
                    // 多单的极限盈利对应的是最高价
                    newExtreme = hedge.entryPrice * (1 + maxPnL / 100);
                    // 只有当新极值比历史极值更高（更极端）时才更新
                    if (main.extremePrice === undefined || newExtreme > main.extremePrice) {
                        main.extremePrice = newExtreme;
                    }
                }
            }
            this.recordTradeLog(hedge, reason);

            // Add sub-event to main log
            const mainPos = this.positions.find(p => p.entryId === hedge.mainPositionId);
            if (mainPos) {
                this.addTradeEvent(mainPos, '对冲平仓', hedge.markPrice, hedge.amount, reason, profit);
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
        // Change the original 'OPEN' log status to 'CLOSED_OPEN' to prevent matching/re-using it on new opens
        this.tradeLogs.forEach(l => {
            if (l.status === 'OPEN' && 
                (l.entry_id === p.entryId || 
                 (normalizeSymbol(l.symbol) === normalizeSymbol(p.symbol) && l.direction === p.side))
            ) {
                l.status = 'CLOSED_OPEN';
            }
        });

        // 真实扣除或增加账户余额 (Realize PnL)
        this.account.marginBalance += p.unrealizedPnL;
        this.account.totalBalance = this.account.marginBalance;

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

    public recordRealTradeLog(p: Position, reason: string) {
        // Change the original 'OPEN' log status to 'CLOSED_OPEN' to prevent matching/re-using it on new opens
        this.tradeLogs.forEach(l => {
            if (l.status === 'OPEN' && 
                (l.entry_id === p.entryId || 
                 (normalizeSymbol(l.symbol) === normalizeSymbol(p.symbol) && l.direction === p.side))
            ) {
                l.status = 'CLOSED_OPEN';
            }
        });

        const now = Date.now();
        const isStopLoss = reason.includes('止损') || p.unrealizedPnL < 0;

        const wasEverHedged = p.isHedged || (p.hedgeRetries || 0) > 0 || !!p.mainPositionId || (p.cumulativeHedgeLoss || 0) > 0 || (p.cumulativeHedgeProfit || 0) > 0;

        // Record a separate CLOSE log
        this.tradeLogs.unshift({
            symbol: p.symbol,
            entry_id: p.entryId || (`real_${p.symbol}_${p.side}`),
            status: 'CLOSED',
            profit_usdt: p.unrealizedPnL,
            exit_reason: reason,
            is_hedge: wasEverHedged,
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
            timeframe: p.signalTf, // Store timeframe
            last_stop_loss_time: isStopLoss ? now : undefined,
            stop_loss_rule: isStopLoss ? reason : undefined
        });

        // Add final exit event to the same log entry (as a sub-event)
        const targetLog = this.tradeLogs.find(l => l.entry_id === (p.entryId || `real_${p.symbol}_${p.side}`) && l.status === 'CLOSED');
        if (targetLog) {
            if (!targetLog.events) targetLog.events = [];
            targetLog.events.push({
                timestamp: now,
                action: '最终平仓',
                price: p.markPrice || p.entryPrice,
                amount: p.amount,
                reason,
                pnl: p.unrealizedPnL
            });
        }

        this.emitUpdate(true);
    }

    public clearTradeLogs() {
        this.tradeLogs = [];
        this.systemEvents = [];
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
                            this.addLog('SUCCESS', `📈 [300天历史最低] 成功载入 ${pos.symbol}: 最低价 ${lowest.toFixed(4)} | 距开仓亏损: ${distPercent.toFixed(2)}% | 设定比例: ${(ratio * 100).toFixed(0)}% | 对冲启动价: ${pos.extremeHedgeTriggerPrice.toFixed(4)}`);
                        }
                    } else {
                        const distPercent = ((highest - entry) / entry) * 100;
                        if (distPercent <= 0) {
                            pos.extremeHedgeTriggerPrice = undefined;
                            this.addLog('WARNING', `📈 [300天历史最高] ${pos.symbol} 开仓价 ${entry.toFixed(4)} 已处于或高于300天历史最高价 ${highest.toFixed(4)}，极值对冲指标暂不启动（已置空），防爆对冲将严格由常规亏损比例触发。`);
                        } else {
                            const triggerLossPercent = distPercent * ratio;
                            pos.extremeHedgeTriggerPrice = entry * (1 + triggerLossPercent / 100);
                            this.addLog('SUCCESS', `📈 [300天历史最高] 成功载入 ${pos.symbol}: 最高价 ${highest.toFixed(4)} | 距开仓亏损: ${distPercent.toFixed(2)}% | 设定比例: ${(ratio * 100).toFixed(0)}% | 对冲启动价: ${pos.extremeHedgeTriggerPrice.toFixed(4)}`);
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
                            this.addLog('SUCCESS', `📈 [5:短期极值比例对冲] 成功载入 ${pos.symbol}: 过去${days}天最低价 ${lowest.toFixed(4)} | 距开仓亏损: ${distPercent.toFixed(2)}% | 设定比例: ${(ratio * 100).toFixed(0)}% | 对冲启动价: ${pos.shortTermExtremeTriggerPrice.toFixed(4)}`);
                        }
                    } else {
                        const distPercent = ((highest - entry) / entry) * 100;
                        if (distPercent <= 0) {
                            pos.shortTermExtremeTriggerPrice = undefined;
                        } else {
                            const triggerLossPercent = distPercent * ratio;
                            pos.shortTermExtremeTriggerPrice = entry * (1 + triggerLossPercent / 100);
                            this.addLog('SUCCESS', `📈 [5:短期极值比例对冲] 成功载入 ${pos.symbol}: 过去${days}天最高价 ${highest.toFixed(4)} | 距开仓亏损: ${distPercent.toFixed(2)}% | 设定比例: ${(ratio * 100).toFixed(0)}% | 对冲启动价: ${pos.shortTermExtremeTriggerPrice.toFixed(4)}`);
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
            if (!this.symbolsWithFreshPrice.has(symbolKey)) {
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
            if (position.isHedged && !hasOpposingHedge && !position.mainPositionId) {
                // Self-heal: Position was marked as hedged but has no opposing hedge position
                position.isHedged = false;
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
            if (position.isHedged && !hasOpposingHedge) {
                position.isHedged = false;
            }

            const hedgeSettings = this.settings.hedging;
            if (!hedgeSettings.enabled) {
                continue;
            }

            // 🛡️ [Minimum Position Size Safeguard]
            const entryValue = position.amount * position.entryPrice;
            const minPositionThreshold = Number(hedgeSettings.minPosition ?? 10);
            if (entryValue < minPositionThreshold) {
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

                const positionValue = position.amount * position.markPrice;
                const hedgeAmount = positionValue * (activeHedgeRatio / 100);

                console.log(`[Backup Hedge Trigger] ⚡ ${position.symbol} triggers backup secondary hedge: ${secondaryReason}`);
                this.openHedgePosition(position, hedgeSide, hedgeAmount, position.markPrice, secondaryReason);
                actionTaken = true;
            }
        }

        // 3.6 三次多重检测启动防爆对冲 (Tertiary Multi-Check Watchdog Loop)
        // Dedicated scan to guarantee no single losing position (e.g. TRIA) misses hedge execution
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
                position.isHedged = false; // Self-heal
                const hedgeSide = position.side === PositionSide.LONG ? PositionSide.SHORT : PositionSide.LONG;
                let activeHedgeRatio = hedgeSettings.hedgeRatio || 100;
                if (slSettings?.hedgeProfitClear) {
                    activeHedgeRatio = slSettings.hedgeOpenRatio || 100;
                } else if (slSettings?.callbackProfitClear) {
                    activeHedgeRatio = slSettings.callbackHedgeRatio || 100;
                }

                const positionValue = position.amount * (position.markPrice || position.entryPrice);
                const hedgeAmount = positionValue * (activeHedgeRatio / 100);
                const reason = `[三次多重防爆检测] ${position.symbol} 实际亏损 ${pnlPercent.toFixed(2)}% 已达到防爆阈值 -${triggerLoss}% 立即开仓对冲`;

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
            if (!this.symbolsWithFreshPrice.has(symbolKey)) {
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
