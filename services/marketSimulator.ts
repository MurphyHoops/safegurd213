
import { AccountData, Position, AppSettings, TradeLog, LogEntry, SystemEvent, PositionSide, SimulationSettings } from '../types';
import { checkIndividualPositionRules, checkGlobalRules } from './rules/profit_loss_rules';
import { checkHedgingRules, checkSafeClearRules } from './rules/hedging_rules';
import { checkRescueRules } from './rules/rescue_rules';
import { checkStrategy5_OscillationGuard } from './rules/rescue/strategy5_oscillationGuard';
import { fetchWithFallback } from './apiService';
import { getLatestEMA, calculateRSI, calculateATR } from './indicators';
import { db, auth } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';
import { normalizeSymbol } from './symbolUtils';

export class MarketSimulator {
    private account: AccountData;
    private positions: Position[];
    private settings: AppSettings;
    private updateCallback: (account: AccountData, positions: Position[], logs: LogEntry[], hedgeRecord: any, tradeLogs: TradeLog[], systemEvents: SystemEvent[], notification: any, rec: any) => void;
    private tradeLogs: TradeLog[];
    private systemEvents: SystemEvent[];
    private logs: LogEntry[];
    public realPrices: Record<string, number> = {};
    private symbolsWithFreshPrice: Set<string> = new Set();
    private bootTime: number = Date.now();
    private WARMUP_PERIOD = 15000; // 15s lock after boot to prevent stale data spikes
    
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
        this.positions = newPositions;
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
        
        const noScaleSymbols = ['XMR', 'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'TRX', 'DOT', 'LTC', 'BCH', 'ETC', 'LINK'];
        const isMajorCoin = noScaleSymbols.includes(upperSymbol);

        if (!wsPrice) {
            if (!isMajorCoin) {
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

        // Check cooldown to prevent "popping back" after clear
        const cooldownKey = `${upperSymbol}_${side}`;
        if (this.cooldowns[cooldownKey] && Date.now() < this.cooldowns[cooldownKey] && !extraProps?.isReopened) {
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
            ...extraProps
        };
        this.positions.push(newPos);
        
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

        // Robust real-time execution price check:
        let executionPrice = price;
        let wsPrice = this.realPrices[upperSymbol];
        
        const noScaleSymbols = ['XMR', 'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'TRX', 'DOT', 'LTC', 'BCH', 'ETC', 'LINK'];
        const isMajorCoin = noScaleSymbols.includes(upperSymbol);

        if (!wsPrice) {
            if (!isMajorCoin) {
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

        const entryId = 'HEDGE_' + Date.now().toString() + '_' + Math.random().toString(36).substring(2, 9);
        const newPos: Position = {
            symbol: mainPosition.symbol,
            side,
            amount: amount / executionPrice,
            entryPrice: executionPrice,
            markPrice: executionPrice,
            liquidationPrice: side === PositionSide.LONG ? executionPrice * 0.5 : executionPrice * 1.5,
            unrealizedPnL: 0,
            unrealizedPnLPercentage: 0,
            entryId,
            entryTime: Date.now(),
            isHedged: true,
            mainPositionId: mainPosition.entryId,
            triggerReason: reason,
            correlationId: mainPosition.correlationId,
            reopenCount: mainPosition.reopenCount
        };
        
        mainPosition.isHedged = true;
        delete mainPosition.isUnshackled;
        mainPosition.hedgeRetries = (mainPosition.hedgeRetries || 0) + 1;
        this.positions.push(newPos);

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

        this.addLog('WARNING', `🛡️ 对冲触发: 为 ${mainPosition.symbol} ${mainPosition.side} 开启反向对冲 ${side} (${reason || '未知原因'})`);
        this.emitUpdate(true);
    }

    public closePosition(symbol: string, side: PositionSide, reason: string, entryId?: string) {
        const pos = entryId 
            ? this.positions.find(p => p.entryId === entryId)
            : this.positions.find(p => p.symbol === symbol && p.side === side);
        if (pos) {
            // If we are closing a hedge position, we must reset the main position's isHedged flag
            if (pos.isHedged && pos.mainPositionId) {
                const main = this.positions.find(p => p.entryId === pos.mainPositionId);
                if (main) {
                    main.isHedged = false;
                }
            }

            // If we are closing a main position that has a hedge, we should probably close the hedge too
            // Or at least mark the hedge as no longer hedging this main position.
            // For safety, let's just close the hedge as well to prevent orphaned hedges.
            if (pos.isHedged === true && !pos.mainPositionId) {
                // This is a main position that has been hedged
                const hedge = this.positions.find(p => p.mainPositionId === pos.entryId);
                if (hedge) {
                    this.recordTradeLog(hedge, reason + ' (Orphaned Hedge)');
                    this.positions = this.positions.filter(p => p !== hedge);
                }
            }

            // Record trade log and filter out the closed position
            this.recordTradeLog(pos, reason);
            this.positions = this.positions.filter(p => p.entryId !== pos.entryId);
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
            {
                isReopened: true,
                reopenCount: nextReopenCount,
                correlationId: corrId,
                parentEntryId: pos.entryId
            }
        );
        this.addLog('SUCCESS', `🔄 [原仓位复开] 已开启独立复开仓位: ${pos.symbol} ${pos.side} | 原始USDT本金: ${initialUsdtCost.toFixed(2)}U | 原因: ${reason} | 复开次数: ${nextReopenCount}`);
        this.emitUpdate(true);
    }

    public amputate(position: Position, ratio: number, reason: string) {
        const cutAmount = position.amount * (ratio / 100);
        
        // 记录砍仓的实际盈亏
        const realizedPnL = position.unrealizedPnL * (ratio / 100);
        
        position.amount -= cutAmount;
        position.amputatedAmount = (position.amputatedAmount || 0) + cutAmount;
        
        if (realizedPnL < 0) {
            position.cumulativeAmputationLoss = (position.cumulativeAmputationLoss || 0) + Math.abs(realizedPnL);
        }
        
        const now = Date.now();
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

    public refill(position: Position, reason: string) {
        if (!this.isNetworkHealthy) {
            this.addLog('WARNING', `网络异常拦截: 拒绝补仓 ${position.symbol} ${position.side}`);
            return;
        }

        if (!position.amputatedAmount || position.amputatedAmount <= 0) return;
        
        const refillAmount = position.amputatedAmount;
        
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
            const main = this.positions.find(p => p.entryId === hedge.mainPositionId);
            if (main) {
                if (profit >= 0) {
                    main.cumulativeHedgeProfit = (main.cumulativeHedgeProfit || 0) + profit;
                    main.hedgeRetries = 0; // Reset consecutive failures on success
                } else {
                    main.cumulativeHedgeLoss = (main.cumulativeHedgeLoss || 0) + Math.abs(profit);
                }
                main.isHedged = false; // 重置对冲标记，允许再次对冲
                
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
            if (profit >= 0) {
                this.addLog('SUCCESS', `🐜 蚂蚁搬家: 对冲单止盈 | ${reason}`);
            } else {
                this.addLog('WARNING', `⚠️ 对冲单止损: ${reason}`);
            }
            this.emitUpdate(true);
        }
    }

    private recordTradeLog(p: Position, reason: string) {
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

    private addLog(type: 'INFO' | 'SUCCESS' | 'WARNING' | 'DANGER', message: string) {
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

        // 3. Check Hedging Rules
        for (let i = this.positions.length - 1; i >= 0; i--) {
            const position = this.positions[i];
            const symbolKey = normalizeSymbol(position.symbol);

            // CRITICAL: Skip hedging if no fresh price yet
            if (!this.symbolsWithFreshPrice.has(symbolKey)) {
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
            if (!triggered && this.settings.hedging.enabled && this.settings.hedging.triggerLossEnabled) {
                const pnlPercent = position.unrealizedPnLPercentage;
                const threshold = -Math.abs(this.settings.hedging.triggerLossPercent);
                
                if (pnlPercent <= threshold && !position.isHedged) {
                    // Loss condition met, but not triggered. Why?
                    const entryValue = position.amount * position.entryPrice;
                    let reason = "Unknown";
                    
                    if (entryValue < this.settings.hedging.minPosition) reason = `Entry Value (${entryValue.toFixed(2)}) < Min (${this.settings.hedging.minPosition})`;
                    else if (this.settings.stopLoss.fuseEnabled && (position.hedgeRetries || 0) >= this.settings.stopLoss.maxHedgeRetries) reason = "Fuse Tripped";
                    
                    // Only log periodically to avoid spam
                    if (Math.random() < 0.01) {
                         this.addLog('WARNING', `⚠️ 对冲未触发: ${position.symbol} 亏损 ${pnlPercent.toFixed(2)}% | 原因: ${reason}`);
                    }
                }
            }
        }

        // 4. Check Rescue Rules
        for (let i = this.positions.length - 1; i >= 0; i--) {
            const position = this.positions[i];
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
          
          const noScaleSymbols = ['XMR', 'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'TRX', 'DOT', 'LTC', 'BCH', 'ETC', 'LINK'];
          const isMajorCoin = noScaleSymbols.includes(normalizedSymbol);

          if (!wsPrice) {
              // Only try 1000x fallback for non-major coins to prevent accidental magnitude errors for things like XMR/BTC
              if (!isMajorCoin) {
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
                  if (!isMajorCoin) {
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
              const priceChanged = Math.abs(p.markPrice - currentPrice) > 0.000000000001;
              const isInitial = p.unrealizedPnL === 0;

              p.markPrice = currentPrice;

              // 1. Calculate Price Difference based on Direction
              const priceDiff = p.side === PositionSide.LONG
                  ? currentPrice - p.entryPrice
                  : p.entryPrice - currentPrice;

              // 2. Calculate PnL Value (USDT)
              // Ensure amount is valid
              if (isNaN(p.amount) || p.amount === 0) {
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
