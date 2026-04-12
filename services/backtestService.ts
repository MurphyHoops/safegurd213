
import { fetchWithFallback } from './apiService';
import { Position, PositionSide, AppSettings, KLine } from '../types';
import { checkIndividualPositionRules } from './rules/profit_loss_rules';

export interface BacktestTrade {
    symbol: string;
    side: PositionSide;
    entryPrice: number;
    exitPrice: number;
    entryTime: number;
    exitTime: number;
    pnl: number;
    pnlPercent: number;
    reason: string;
}

export interface BacktestStats {
    totalTrades: number;
    winRate: number;
    totalPnl: number;
    maxDrawdown: number;
    profitFactor: number;
}

export interface BacktestResult {
    trades: BacktestTrade[];
    equityCurve: { time: number; balance: number }[];
    stats: BacktestStats;
}

export class BacktestService {
    static async fetchKLines(symbol: string, interval: string, limit: number = 1000): Promise<KLine[]> {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        const res = await fetchWithFallback(url, { timeout: 30000 });
        const data = await res.json();
        
        return data.map((d: any) => ({
            time: d[0],
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4]),
            volume: parseFloat(d[5])
        }));
    }

    static runSimulation(
        symbol: string,
        klines: KLine[],
        settings: AppSettings,
        initialBalance: number = 10000
    ): BacktestResult {
        let balance = initialBalance;
        const trades: BacktestTrade[] = [];
        const equityCurve: { time: number; balance: number }[] = [];
        let currentPosition: Position | null = null;
        
        // Simple strategy for backtest: 
        // If no position, open one based on some simple logic (e.g., every 10 candles)
        // In a real backtest, we'd use the user's actual entry strategy.
        // For now, let's focus on testing the PROFIT rules as requested.
        
        for (let i = 0; i < klines.length; i++) {
            const candle = klines[i];
            
            if (!currentPosition) {
                // Mock entry: Open LONG if candle is green and we have no position
                // This is just to have something to test the profit rules with.
                if (candle.close > candle.open && i % 20 === 0) {
                    currentPosition = {
                        entryId: `bt-${i}`,
                        symbol,
                        side: PositionSide.LONG,
                        amount: balance * 0.1 / candle.close, // 10% of balance
                        entryPrice: candle.close,
                        markPrice: candle.close,
                        liquidationPrice: 0,
                        unrealizedPnL: 0,
                        unrealizedPnLPercentage: 0,
                        maxPnLPercent: 0,
                        entryTime: candle.time,
                        isHedged: false
                    };
                }
            } else {
                // Update position
                const price = candle.close;
                const pnl = (price - currentPosition.entryPrice) * currentPosition.amount * (currentPosition.side === PositionSide.LONG ? 1 : -1);
                const pnlPercent = (pnl / (currentPosition.amount * currentPosition.entryPrice)) * 100;
                
                currentPosition.markPrice = price;
                currentPosition.unrealizedPnL = pnl;
                currentPosition.unrealizedPnLPercentage = pnlPercent;
                currentPosition.maxPnLPercent = Math.max(currentPosition.maxPnLPercent || 0, pnlPercent);
                
                // Check rules
                let closed = false;
                checkIndividualPositionRules(currentPosition, settings, (sym, side, reason) => {
                    const trade: BacktestTrade = {
                        symbol: currentPosition!.symbol,
                        side: currentPosition!.side,
                        entryPrice: currentPosition!.entryPrice,
                        exitPrice: price,
                        entryTime: currentPosition!.entryTime,
                        exitTime: candle.time,
                        pnl: currentPosition!.unrealizedPnL,
                        pnlPercent: currentPosition!.unrealizedPnLPercentage,
                        reason
                    };
                    trades.push(trade);
                    balance += trade.pnl;
                    currentPosition = null;
                    closed = true;
                });
                
                if (closed) continue;
            }
            
            equityCurve.push({ time: candle.time, balance });
        }

        // Calculate stats
        const winningTrades = trades.filter(t => t.pnl > 0);
        const losingTrades = trades.filter(t => t.pnl <= 0);
        const totalProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
        const totalLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
        
        const stats: BacktestStats = {
            totalTrades: trades.length,
            winRate: trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0,
            totalPnl: balance - initialBalance,
            maxDrawdown: 0, // TODO: Calculate MDD
            profitFactor: totalLoss > 0 ? totalProfit / totalLoss : totalProfit
        };

        return { trades, equityCurve, stats };
    }
}
