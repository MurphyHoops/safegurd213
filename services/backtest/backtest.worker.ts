
// Backtest Worker
// This script runs in a separate thread to avoid UI lag

import { Position, AppSettings, PositionSide, KLine } from '../../types';
import { ScannerItem } from '../../components/Scanner/scannerTypes';
import { checkIndividualPositionRules } from '../rules/profit_loss_rules';
import { analyzeList2Crossing } from '../rules/list2_crossing';
import { analyzeList3Structure } from '../rules/list3_structure';
import { analyzeList4Momentum } from '../rules/list4_momentum';
import { getLatestEMA } from '../indicators';

// Helper to determine the next timeframe for Rule 3
const getAutoTimeframe = (entryTf: string): string => {
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
};

// Mock closePosition for backtesting
const createCloseHandler = (trades: any[], currentTime: number) => {
    return (symbol: string, side: PositionSide, reason: string, ratio: number) => {
        trades.push({
            symbol,
            side,
            reason,
            ratio,
            exitTime: currentTime
        });
    };
};

self.onmessage = async (e) => {
    const { klinesMap, settings, initialBalance, symbols, scannerConfig, speed = 1 } = e.data;
    
    // klinesMap: { [symbol]: { [interval]: KLine[] } }
    
    const results = {
        trades: [] as any[],
        equityCurve: [] as any[],
        stats: {
            totalTrades: 0,
            winRate: 0,
            totalPnl: 0,
            maxDrawdown: 0,
            profitFactor: 0
        },
        logs: [] as any[]
    };

    let balance = initialBalance;
    let peakBalance = initialBalance;
    let activePositions: Map<string, any> = new Map();
    
    // Find the smallest interval to use as the base time step
    const intervals = Object.keys(klinesMap[symbols[0]]);
    const intervalMs: Record<string, number> = {
        '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000
    };
    const sortedIntervals = intervals.sort((a, b) => intervalMs[a] - intervalMs[b]);
    const baseInterval = sortedIntervals[0];
    const stepMs = intervalMs[baseInterval];

    // Get all unique timestamps for the base interval
    const allTimestamps = new Set<number>();
    for (const symbol of symbols) {
        if (klinesMap[symbol][baseInterval]) {
            klinesMap[symbol][baseInterval].forEach((k: KLine) => allTimestamps.add(k.time));
        }
    }
    const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

    const log = (type: string, message: string, time: number) => {
        results.logs.push({ type, message, time });
        if (results.logs.length > 1000) results.logs.shift(); // Keep last 1000 logs
    };

    // Simulation Loop
    for (let i = 0; i < sortedTimestamps.length; i += speed) {
        const timestamp = sortedTimestamps[i];
        
        // 1. Update existing positions
        activePositions.forEach((pos, symbol) => {
            const symbolKlines = klinesMap[symbol][baseInterval];
            const candle = symbolKlines.find((k: KLine) => k.time === timestamp);
            if (candle) {
                pos.markPrice = candle.close;
                const pnl = (pos.side === 'LONG' ? (candle.close - pos.entryPrice) : (pos.entryPrice - candle.close)) * pos.amount;
                pos.unrealizedPnL = pnl;
                pos.unrealizedPnLPercentage = (pnl / (pos.amount * pos.entryPrice)) * 100;
                pos.maxPnLPercent = Math.max(pos.maxPnLPercent || 0, pos.unrealizedPnLPercentage);
                pos.minPnLPercent = Math.min(pos.minPnLPercent || 0, pos.unrealizedPnLPercentage);

                // Update EMA Baseline for Rule 3 (Auto-sensing next timeframe)
                if (settings.profit?.enabled && (settings.profit.profitMode === 'ATR' || settings.profit.oEnabledMap?.['ATR'])) {
                    const atrSettings = settings.profit.atr;
                    if (atrSettings?.emaEnabled) {
                        let tf = atrSettings.emaTimeframe;
                        if (tf === 'AUTO') {
                            tf = getAutoTimeframe(pos.signalTf || '15m');
                        }
                        
                        // Find the appropriate klines for this timeframe up to current virtual time
                        const emaKlines = klinesMap[symbol][tf];
                        if (emaKlines) {
                            const emaIdx = emaKlines.findIndex(k => k.time <= timestamp && k.time > timestamp - (60000 * 200)); // Rough bounds
                            if (emaIdx !== -1) {
                                // For performance in backtest, we find the closest candle
                                let lastTfIdx = -1;
                                for (let j = emaKlines.length - 1; j >= 0; j--) {
                                    if (emaKlines[j].time <= timestamp) {
                                        lastTfIdx = j;
                                        break;
                                    }
                                }
                                if (lastTfIdx >= (atrSettings.emaPeriod || 80)) {
                                    // Exclude the current active candle (lastTfIdx)
                                    const closes = emaKlines.slice(0, lastTfIdx).map(k => k.close);
                                    pos.currentEmaValue = getLatestEMA(closes, atrSettings.emaPeriod || 80);
                                }
                            }
                        }
                    }
                }
            }
        });

        // 2. Check rules for each position (List 5 & 6 simulation)
        const tradesThisStep: any[] = [];
        const closeHandler = createCloseHandler(tradesThisStep, timestamp);

        activePositions.forEach((pos, symbol) => {
            const triggered = checkIndividualPositionRules(pos as any, settings, closeHandler);
            if (triggered) {
                const trade = tradesThisStep.find(t => t.symbol === symbol);
                if (trade) {
                    const finalPnl = pos.unrealizedPnL;
                    balance += finalPnl;
                    results.trades.push({
                        ...trade,
                        entryPrice: pos.entryPrice,
                        exitPrice: pos.markPrice,
                        pnl: finalPnl,
                        pnlPercent: pos.unrealizedPnLPercentage,
                        duration: timestamp - pos.entryTime
                    });
                    log('SUCCESS', `平仓: ${symbol} ${pos.side} | 盈亏: ${finalPnl.toFixed(2)}U (${pos.unrealizedPnLPercentage.toFixed(2)}%) | 原因: ${trade.reason}`, timestamp);
                    activePositions.delete(symbol);
                }
            }
        });

        // 3. Scanner Pipeline Simulation (List 1 -> 2 -> 3 -> 4)
        // Only scan if we have room for more positions
        if (activePositions.size < (settings.system?.maxOpenSymbols || 5)) {
            // A. List 1: Market Filtering (Simplified for backtest)
            const candidates: ScannerItem[] = [];
            for (const symbol of symbols) {
                const klines1h = klinesMap[symbol]['1h'] || [];
                // Find index of current 1h candle
                const currentIdx = klines1h.findIndex(k => k.time <= timestamp && k.time > timestamp - 3600000);
                if (currentIdx < 24) continue;

                const currentPrice = klines1h[currentIdx].close;
                const open24h = klines1h[currentIdx - 24].open;
                const change24h = ((currentPrice - open24h) / open24h) * 100;
                
                let vol24h = 0;
                for (let j = currentIdx - 24; j <= currentIdx; j++) vol24h += klines1h[j].volume;

                // Apply List 1 Filters
                if (Math.abs(change24h) < (scannerConfig.list1?.minChange || 1)) continue;
                if (vol24h / 1000000 < (scannerConfig.list1?.minVolume || 1)) continue;

                candidates.push({
                    symbol,
                    price: currentPrice,
                    change: change24h,
                    volume24h: vol24h / 1000000
                });
            }

            // B. List 2, 3, 4: Signal Generation
            for (const item of candidates) {
                if (activePositions.has(item.symbol)) continue;

                for (const tf of sortedIntervals) {
                    const klines = klinesMap[item.symbol][tf];
                    const idx = klines.findIndex(k => k.time <= timestamp && k.time > timestamp - intervalMs[tf]);
                    if (idx < 80) continue;

                    const slice = klines.slice(0, idx + 1);
                    const closes = slice.map(k => k.close);
                    const highs = slice.map(k => k.high);
                    const lows = slice.map(k => k.low);
                    const opens = slice.map(k => k.open);
                    const volumes = slice.map(k => k.volume);
                    const times = slice.map(k => k.time);

                    // List 2: EMA Crossing
                    const l2Results = analyzeList2Crossing(item.symbol, tf, closes, highs, lows, opens, volumes, times, scannerConfig.list2);
                    if (l2Results.length === 0) continue;

                    for (const l2 of l2Results) {
                        // List 3: Structure Audit
                        const l3Result = analyzeList3Structure(
                            { symbol: item.symbol, tf, direction: l2.direction, time: l2.crossingTimes[0], price: item.price },
                            closes, highs, lows, opens, volumes, scannerConfig.list3,
                            slice.map(k => [k.time, k.open, k.high, k.low, k.close, k.volume])
                        );
                        if (!l3Result) continue;

                        // List 4: Momentum Audit
                        const l4Results = analyzeList4Momentum([l3Result], scannerConfig.list4);
                        const finalSignal = l4Results.find(s => s.momentum?.status === 'TRIGGERED' && !s.fuseBlocked);

                        if (finalSignal) {
                            // OPEN POSITION
                            const entryAmount = (balance * (settings.system?.positionSizePercent || 10) / 100) / item.price;
                            activePositions.set(item.symbol, {
                                symbol: item.symbol,
                                side: finalSignal.direction,
                                amount: entryAmount,
                                entryPrice: item.price,
                                markPrice: item.price,
                                unrealizedPnL: 0,
                                unrealizedPnLPercentage: 0,
                                maxPnLPercent: 0,
                                minPnLPercent: 0,
                                entryTime: timestamp,
                                signalTf: tf, // Store signal timeframe for Rule 3
                                isHedged: false
                            });
                            log('INFO', `开仓: ${item.symbol} ${finalSignal.direction} | 价格: ${item.price} | 原因: ${tf} 信号触发`, timestamp);
                            break; // One position per symbol
                        }
                    }
                    if (activePositions.has(item.symbol)) break;
                }
            }
        }

        // 4. Record Equity
        peakBalance = Math.max(peakBalance, balance);
        const dd = peakBalance > 0 ? ((peakBalance - balance) / peakBalance) * 100 : 0;
        results.stats.maxDrawdown = Math.max(results.stats.maxDrawdown, dd);

        results.equityCurve.push({
            time: timestamp,
            balance: balance,
            drawdown: dd
        });

        // Periodically report progress
        if (i % 500 === 0) {
            self.postMessage({ type: 'PROGRESS', progress: (i / sortedTimestamps.length) * 100 });
        }
    }

    // Final stats
    const wins = results.trades.filter(t => t.pnl > 0).length;
    results.stats.totalTrades = results.trades.length;
    results.stats.winRate = (wins / results.trades.length) * 100 || 0;
    results.stats.totalPnl = balance - initialBalance;

    self.postMessage({ type: 'COMPLETE', results });
};
