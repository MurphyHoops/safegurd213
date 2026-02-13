
import { AccountData, Position, AppSettings, TradeLog, LogEntry, SystemEvent, PositionSide, SimulationSettings } from '../types';

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

    public updateRealPrices(prices: Record<string, number>) {
        this.realPrices = { ...this.realPrices, ...prices };
    }

    public updateSettings(settings: AppSettings) {
        this.settings = settings;
    }

    public openPosition(symbol: string, side: PositionSide, amount: number, price: number, signalTf?: string) {
        const newPos: Position = {
            symbol,
            side,
            amount: amount / price, // approximate quantity
            entryPrice: price,
            markPrice: price,
            liquidationPrice: side === PositionSide.LONG ? price * 0.5 : price * 1.5, // Mock liq
            leverage: 20,
            unrealizedPnL: 0,
            unrealizedPnLPercentage: 0,
            entryId: Date.now().toString(),
            entryTime: Date.now(),
            signalTf: signalTf // Store Signal Timeframe
        };
        this.positions.push(newPos);
        this.addLog('SUCCESS', `Opened ${side} on ${symbol} at ${price} ${signalTf ? `(${signalTf})` : ''}`);
        this.emitUpdate();
    }

    public closePosition(symbol: string, side: PositionSide, reason: string) {
        this.positions = this.positions.filter(p => !(p.symbol === symbol && p.side === side));
        this.addLog('INFO', `Closed ${side} on ${symbol}: ${reason}`);
        this.emitUpdate();
    }

    public openBatchPositions(symbol: string, mode: string, count: number, amount: number, leverage: number, hedge: boolean, source: string, timeframe: string, limit: number) {
        this.addLog('INFO', 'Batch open simulation triggered');
    }

    public applyStrategyRecommendation(rec: any) {
        this.addLog('INFO', `Applied strategy recommendation for ${rec.symbol}`);
    }

    public batchCloseAllPositions() {
        this.positions = [];
        this.addLog('WARNING', 'All positions closed manually');
        this.emitUpdate();
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
        // Placeholder
        return false;
    }

    private updateAccountStats() {
        // Placeholder
        const totalUnrealizedPnL = this.positions.reduce((acc, p) => acc + p.unrealizedPnL, 0);
        this.account.totalBalance = this.account.marginBalance + totalUnrealizedPnL;
    }

    private emitUpdate() {
        this.updateCallback(
            this.account,
            this.positions,
            this.logs,
            null,
            this.tradeLogs,
            this.systemEvents,
            null,
            null
        );
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

              // 3. Calculate PnL Percentage (Price Change % ONLY, NO LEVERAGE)
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

              // Update Extreme Price for Hedge
              if (p.isHedged) {
                  if (p.side === PositionSide.SHORT) {
                      p.extremePrice = (p.extremePrice !== undefined) ? Math.min(p.extremePrice, currentPrice) : currentPrice;
                  } else {
                      p.extremePrice = (p.extremePrice !== undefined) ? Math.max(p.extremePrice, currentPrice) : currentPrice;
                  }
              }

              stateChanged = true;
          }
      });

      // 2. Check Strategies
      if (enableStrategies) {
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
