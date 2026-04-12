
import { AccountData, Position, AppSettings, TradeLog, LogEntry, SystemEvent, PositionSide, SimulationSettings } from '../types';
import { checkIndividualPositionRules, checkGlobalRules } from './rules/profit_loss_rules';
import { checkHedgingRules, checkSafeClearRules } from './rules/hedging_rules';
import { checkRescueRules } from './rules/rescue_rules';
import { checkStrategy5_OscillationGuard } from './rules/rescue/strategy5_oscillationGuard';

export class MarketSimulator {
    private account: AccountData;
    private positions: Position[];
    private settings: AppSettings;
    private updateCallback: (account: AccountData, positions: Position[], logs: LogEntry[], hedgeRecord: any, tradeLogs: TradeLog[], systemEvents: SystemEvent[], notification: any, rec: any) => void;
    private tradeLogs: TradeLog[];
    private systemEvents: SystemEvent[];
    private logs: LogEntry[];
    private realPrices: Record<string, number> = {};
    
    private lastHeartbeatTime: number = 0;
    private lastEmaCheckTime: number = 0;
    private lastAdvisorTime: number = 0;
    private isNetworkHealthy: boolean = true;

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
    }

    public resetMarginBalance(amount: number) {
        this.account.marginBalance = amount;
        this.account.totalBalance = amount;
        this.addLog('INFO', `钱包余额已恢复为 ${amount} U`);
        this.emitUpdate();
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
        this.realPrices = { ...this.realPrices, ...prices };
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
        this.settings = this.deepMerge(this.settings, settings);
    }

    public openPosition(symbol: string, side: PositionSide, amount: number, price: number, signalTf?: string, signalCandle?: any, entryEmas?: any) {
        if (!this.isNetworkHealthy) {
            this.addLog('WARNING', `网络异常拦截: 拒绝开仓 ${symbol} ${side}`);
            return;
        }

        // Prevent duplicate positions for the same symbol and side
        const existingPosition = this.positions.find(p => p.symbol === symbol && p.side === side);
        if (existingPosition) {
            this.addLog('WARNING', `Duplicate position blocked: ${side} on ${symbol} already exists.`);
            return;
        }

        const entryId = Date.now().toString() + '_' + Math.random().toString(36).substring(2, 9);
        
        // Simulate Signal Candle (Assume 2% Amplitude if not real)
        // In a real scenario, this would be passed from the signal source.
        const simulatedAmplitude = 0.02;
        const finalSignalCandle = signalCandle || {
            open: price,
            close: price,
            high: price * (1 + simulatedAmplitude/2),
            low: price * (1 - simulatedAmplitude/2),
            amplitude: simulatedAmplitude
        };

        // Simulate EMAs based on Trend (Assume Trend Follows Position)
        // Long: Price > EMAs (Uptrend)
        // Short: Price < EMAs (Downtrend)
        const trendFactor = side === PositionSide.LONG ? -1 : 1; // -1 means EMAs are below price
        const finalEntryEmas = entryEmas || {
            ema10: price * (1 + trendFactor * 0.005), // 0.5% away
            ema20: price * (1 + trendFactor * 0.01),  // 1.0% away
            ema40: price * (1 + trendFactor * 0.02),  // 2.0% away
            ema80: price * (1 + trendFactor * 0.04)   // 4.0% away
        };

        const newPos: Position = {
            symbol,
            side,
            amount: amount / price, // approximate quantity
            entryPrice: price,
            markPrice: price,
            liquidationPrice: side === PositionSide.LONG ? price * 0.5 : price * 1.5, // Mock liq
            unrealizedPnL: 0,
            unrealizedPnLPercentage: 0,
            entryId,
            entryTime: Date.now(),
            signalTf: signalTf, // Store Signal Timeframe
            signalCandle: finalSignalCandle, // Store the signal candle
            entryEmas: finalEntryEmas // Store the EMAs at entry
        };
        this.positions.push(newPos);
        
        // Record Open Log
        this.tradeLogs.unshift({
            symbol,
            entry_id: entryId,
            status: 'OPEN',
            is_hedge: false,
            entry_timestamp: newPos.entryTime,
            direction: side,
            cost_usdt: amount,
            entry_price: price,
            timeframe: signalTf // Store timeframe
        });

        this.addLog('SUCCESS', `Opened ${side} on ${symbol} at ${price} ${signalTf ? `(${signalTf})` : ''}`);
        this.emitUpdate();
    }

    public openHedgePosition(mainPosition: Position, side: PositionSide, amount: number, price: number, reason?: string) {
        if (!this.isNetworkHealthy) {
            this.addLog('WARNING', `网络异常拦截: 拒绝开对冲仓 ${mainPosition.symbol} ${side}`);
            return;
        }

        const entryId = 'HEDGE_' + Date.now().toString() + '_' + Math.random().toString(36).substring(2, 9);
        const newPos: Position = {
            symbol: mainPosition.symbol,
            side,
            amount: amount / price,
            entryPrice: price,
            markPrice: price,
            liquidationPrice: side === PositionSide.LONG ? price * 0.5 : price * 1.5,
            unrealizedPnL: 0,
            unrealizedPnLPercentage: 0,
            entryId,
            entryTime: Date.now(),
            isHedged: true,
            mainPositionId: mainPosition.entryId,
            triggerReason: reason
        };
        
        mainPosition.isHedged = true;
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
            entry_price: price,
            main_entry_id: mainPosition.entryId,
            timeframe: mainPosition.signalTf // Store timeframe from main position
        });

        this.addLog('WARNING', `🛡️ 对冲触发: 为 ${mainPosition.symbol} ${mainPosition.side} 开启反向对冲 ${side} (${reason || '未知原因'})`);
        this.emitUpdate();
    }

    public closePosition(symbol: string, side: PositionSide, reason: string) {
        const pos = this.positions.find(p => p.symbol === symbol && p.side === side);
        if (pos) {
            // If we are closing a hedge position, we must reset the main position's isHedged flag
            if (pos.isHedged && pos.mainPositionId) {
                const main = this.positions.find(p => p.entryId === pos.mainPositionId);
                if (main) {
                    main.isHedged = false;
                    const profit = pos.unrealizedPnL;
                    if (profit >= 0) {
                        main.cumulativeHedgeProfit = (main.cumulativeHedgeProfit || 0) + profit;
                    } else {
                        main.cumulativeHedgeLoss = (main.cumulativeHedgeLoss || 0) + Math.abs(profit);
                    }
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

            this.recordTradeLog(pos, reason);
            this.positions = this.positions.filter(p => p !== pos);
            this.addLog('INFO', `Closed ${side} on ${symbol}: ${reason}`);
            this.emitUpdate();
        }
    }

    public closePair(mainId: string, hedgeId: string, reason: string) {
        const main = this.positions.find(p => p.entryId === mainId);
        const hedge = hedgeId ? this.positions.find(p => p.entryId === hedgeId) : undefined;
        
        if (main) {
            this.recordTradeLog(main, reason);
            if (hedge) {
                this.recordTradeLog(hedge, reason);
            }
            this.positions = this.positions.filter(p => p.entryId !== mainId && p.entryId !== hedgeId);
            this.addLog('SUCCESS', `✅ 累计盈利清仓: ${reason}`);
            this.emitUpdate();
        }
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

        // 记录交易日志
        this.tradeLogs.unshift({
            symbol: position.symbol,
            entry_id: position.entryId + '_cut_' + now + '_' + Math.random().toString(36).substring(2, 9),
            status: 'CLOSED',
            profit_usdt: realizedPnL,
            exit_reason: reason,
            is_hedge: position.isHedged || false,
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

        // 真实扣除或增加账户余额
        this.account.marginBalance += realizedPnL;
        this.account.totalBalance = this.account.marginBalance;
        
        if (realizedPnL >= 0) {
            this.addLog('SUCCESS', `💰 部分止盈: ${position.symbol} ${position.side} 减仓 ${ratio}% | 实现盈利: +${realizedPnL.toFixed(2)} | ${reason}`);
        } else {
            this.addLog('WARNING', `✂️ 部分止损: ${position.symbol} ${position.side} 减仓 ${ratio}% | 实现亏损: ${realizedPnL.toFixed(2)} | ${reason}`);
        }
        this.emitUpdate();
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
        
        // 记录交易日志 (开仓)
        this.tradeLogs.unshift({
            symbol: position.symbol,
            entry_id: position.entryId + '_refill_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
            status: 'OPEN',
            is_hedge: position.isHedged || false,
            entry_timestamp: Date.now(),
            direction: position.side,
            cost_usdt: refillAmount * position.markPrice,
            entry_price: position.markPrice,
            current_amount: position.amount,
            main_entry_id: position.mainPositionId, // Link to main position if it's a hedge
            parent_entry_id: position.entryId, // Link to original position
            timeframe: position.signalTf // Store timeframe
        });

        // 重置砍仓记录，但保留历史亏损记录用于算总账
        position.amputatedAmount = 0;
        // 重置止损标记，允许再次触发止损
        delete (position as any)._slTriggered;
        
        this.addLog('INFO', `🔄 补回仓位: ${position.symbol} ${position.side} 补回 ${refillAmount.toFixed(4)} | 新均价: ${newEntryPrice.toFixed(4)} | ${reason}`);
        this.emitUpdate();
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
            this.positions = this.positions.filter(p => p.entryId !== hedgeId);
            if (profit >= 0) {
                this.addLog('SUCCESS', `🐜 蚂蚁搬家: 对冲单止盈 | ${reason}`);
            } else {
                this.addLog('WARNING', `⚠️ 对冲单止损: ${reason}`);
            }
            this.emitUpdate();
        }
    }

    private recordTradeLog(p: Position, reason: string) {
        // 真实扣除或增加账户余额 (Realize PnL)
        this.account.marginBalance += p.unrealizedPnL;
        this.account.totalBalance = this.account.marginBalance;

        const now = Date.now();
        const isStopLoss = reason.includes('止损') || p.unrealizedPnL < 0;

        // Record a separate CLOSE log
        this.tradeLogs.unshift({
            symbol: p.symbol,
            entry_id: p.entryId,
            status: 'CLOSED',
            profit_usdt: p.unrealizedPnL,
            exit_reason: reason,
            is_hedge: p.isHedged || false,
            entry_timestamp: p.entryTime,
            exit_timestamp: now,
            direction: p.side,
            cost_usdt: p.amount * p.entryPrice,
            entry_price: p.entryPrice,
            exit_price: p.markPrice,
            profit_percent: p.unrealizedPnLPercentage,
            main_entry_id: p.mainPositionId,
            timeframe: p.signalTf, // Store timeframe
            last_stop_loss_time: isStopLoss ? now : undefined,
            stop_loss_rule: isStopLoss ? reason : undefined
        });
    }

    public clearTradeLogs() {
        this.tradeLogs = [];
        this.emitUpdate();
    }

    public openBatchPositions(symbol: string, mode: string, count: number, amount: number, hedge: boolean, source: string, timeframe: string, limit: number) {
        this.addLog('INFO', 'Batch open simulation triggered');
    }

    public applyStrategyRecommendation(rec: any) {
        this.addLog('INFO', `Applied strategy recommendation for ${rec.symbol}`);
    }

    private addLog(type: 'INFO' | 'SUCCESS' | 'WARNING' | 'DANGER', message: string) {
        this.logs.unshift({
            id: Date.now().toString() + Math.random(),
            timestamp: new Date(),
            type,
            message
        });
        if (this.logs.length > 200) this.logs.pop();
    }

    private updateEmaCache() {
        // Placeholder
    }

    private runStrategyAnalysis() {
        // Placeholder
    }

    private checkStrategies(): boolean {
        let actionTaken = false;

        // 1. Check Global Rules (Priority)
        // Only if Global Mode is enabled in settings
        if (this.settings.profit.enabled && this.settings.profit.profitMode === 'GLOBAL') {
            const triggered = checkGlobalRules(
                this.positions,
                this.account,
                this.settings,
                (reason) => {
                    // 只平掉未对冲的仓位
                    const unhedgedPositions = this.positions.filter(p => !p.isHedged && !p.mainPositionId);
                    unhedgedPositions.forEach(p => {
                        this.closePosition(p.symbol, p.side, reason);
                    });
                    this.addLog('SUCCESS', `全局止盈/止损触发: 已平仓所有未对冲仓位 | ${reason}`);
                }
            );
            if (triggered) return true; // Global close clears unhedged, return immediately
        }

        // 2. Check Individual Position Rules
        // We iterate backwards to safely remove items while iterating
        for (let i = this.positions.length - 1; i >= 0; i--) {
            const position = this.positions[i];
            
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
                        this.closePosition(symbol, side, reason);
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
                        this.closePosition(symbol, side, reason);
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
                        this.closePosition(symbol, side, reason);
                        actionTaken = true;
                    }
                );
            }
        }

        // 3. Check Hedging Rules
        for (let i = this.positions.length - 1; i >= 0; i--) {
            const position = this.positions[i];
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
                }
            );
        }

        return actionTaken;
    }

    public batchCloseAllPositions(reason: string = 'Manual Batch Close') {
        if (this.positions.length === 0) return;
        
        const totalPnL = this.positions.reduce((sum, p) => sum + p.unrealizedPnL, 0);

        // Create trade logs for all positions (this will now also update marginBalance)
        this.positions.forEach(p => {
            this.recordTradeLog(p, reason);
        });
        
        this.positions = [];
        this.addLog('WARNING', `全部平仓: ${reason} (总盈亏: ${totalPnL.toFixed(2)})`);
        this.emitUpdate();
    }

    private updateAccountStats() {
        // Placeholder
        const totalUnrealizedPnL = this.positions.reduce((acc, p) => acc + p.unrealizedPnL, 0);
        this.account.totalBalance = this.account.marginBalance + totalUnrealizedPnL;
    }

    private pendingUpdate = false;

    private emitUpdate() {
        if (this.pendingUpdate) return;
        this.pendingUpdate = true;
        Promise.resolve().then(() => {
            this.pendingUpdate = false;
            if (this.updateCallback) {
                this.updateCallback(
                    { ...this.account },
                    [ ...this.positions ],
                    [ ...this.logs ],
                    null,
                    [ ...this.tradeLogs ],
                    [ ...this.systemEvents ],
                    null,
                    null
                );
            }
        });
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

      // --- STRATEGY ADVISOR LOOP ---
      if (this.settings.stopLoss.advisor?.enabled && (now - this.lastAdvisorTime > 15000)) {
          this.lastAdvisorTime = now;
          this.runStrategyAnalysis(); 
      }

      // 1. Update Prices & PnL
      this.positions.forEach(p => {
          // Robust Price Fallback: Real > Mark > Entry
          const currentPrice = this.realPrices[p.symbol] || p.markPrice || p.entryPrice;

          // Check if price valid to prevent NaN/Crash
          if (currentPrice > 0 && (p.markPrice !== currentPrice || p.unrealizedPnL === 0)) { 
              p.markPrice = currentPrice;

              // 1. Calculate Price Difference based on Direction
              const priceDiff = p.side === PositionSide.LONG
                  ? currentPrice - p.entryPrice
                  : p.entryPrice - currentPrice;

              // 2. Calculate PnL Value (USDT)
              p.unrealizedPnL = priceDiff * p.amount;

              // 3. Calculate PnL Percentage (Raw Price Change % ONLY, NO LEVERAGE)
              // Formula: (PriceDiff / EntryPrice) * 100
              if (p.entryPrice > 0) {
                  const rawPct = (priceDiff / p.entryPrice) * 100;
                  p.unrealizedPnLPercentage = isFinite(rawPct) ? rawPct : 0;
              } else {
                  p.unrealizedPnLPercentage = 0;
              }

              // Update Max PnL for trailing
              if (p.unrealizedPnLPercentage > 0) {
                  if (p.maxPnLPercent === undefined || p.unrealizedPnLPercentage > p.maxPnLPercent) {
                      p.maxPnLPercent = p.unrealizedPnLPercentage;
                  }
              }

              stateChanged = true;
          }
      });

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
}
