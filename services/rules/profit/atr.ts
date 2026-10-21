import { Position, AtrSettings, PositionSide } from '../../../types';

/**
 * ATR 止盈 (Trend Exit)
 * 逻辑：
 * 1. 吊灯止盈 (Chandelier Exit): 当价格从最高点回撤超过 (ATR × 倍数) 时平仓。
 * 2. EMA 相交平仓 (EMA Intersection): 当价格与 EMA 相交时平仓。
 * 3. 动能超时滞涨平仓 (Momentum Stall / Time-based Exit): 当持仓超时且未爆发、处于安全区间时平仓。
 */
export function checkAtrProfit(
    position: Position, 
    settings: AtrSettings, 
    close: (symbol: string, side: PositionSide, reason: string, ratio: number) => void
): boolean {
    const maxPnl = position.maxPnLPercent || 0;
    const currentPnl = position.unrealizedPnLPercentage;
    const currentPrice = position.markPrice;

    // 1. 吊灯止盈逻辑 (Chandelier Exit)
    if (settings.chandelierEnabled) {
        // 激活门槛：至少要有 0.5% 的利润才开始监控 ATR 回撤 (避免频繁触发)
        if (maxPnl >= 0.5) {
            // 计算回撤阈值 (百分比)
            const threshold = settings.volatilityPercent * settings.multiplier;

            // 检查回撤
            const drawdown = maxPnl - currentPnl;
            if (drawdown >= threshold) {
                close(
                    position.symbol, 
                    position.side, 
                    `趋势止盈(吊灯): 最高 ${maxPnl.toFixed(2)}%, 回撤 ${drawdown.toFixed(2)}% (ATR阈值 ${threshold.toFixed(2)}%)`,
                    100
                );
                return true;
            }
        }
    }

    // 2. EMA 相交平仓逻辑 (EMA Intersection)
    if (settings.emaEnabled && position.currentEmaValue) {
        const ema = position.currentEmaValue;
        
        // 仅在盈利时触发
        if (currentPnl > 0) {
            if (position.side === PositionSide.LONG) {
                const maxPrice = position.entryPrice * (1 + maxPnl / 100);
                if (maxPrice >= ema && currentPrice < ema) {
                    close(
                        position.symbol,
                        position.side,
                        `趋势盈利平仓(EMA): 多单价格 ${currentPrice.toFixed(4)} 跌破 EMA ${ema.toFixed(4)}，且最高价达到过之上 (${maxPrice.toFixed(4)})`,
                        100
                    );
                    return true;
                }
            } else if (position.side === PositionSide.SHORT) {
                const minPrice = position.entryPrice * (1 - maxPnl / 100);
                if (minPrice <= ema && currentPrice > ema) {
                    close(
                        position.symbol,
                        position.side,
                        `趋势盈利平仓(EMA): 空单价格 ${currentPrice.toFixed(4)} 突破 EMA ${ema.toFixed(4)}，且最低价达到过之下 (${minPrice.toFixed(4)})`,
                        100
                    );
                    return true;
                }
            }
        }
    }

    // 3. 动能超时滞涨平仓逻辑 (Momentum Stall / Time-Based Exit)
    if (settings.stallExitEnabled) {
        // 兼容回测与实盘：优先读取持仓最近 K 线时间或 lastCandleTime，避免回测下 Date.now() 导致的时间跨度异常
        const nowTime = (position as any).lastCandleTime || (position.recentCandles && position.recentCandles.length > 0 ? position.recentCandles[position.recentCandles.length - 1].time : Date.now());
        const entryTime = position.entryTime || position.backtestEntryTime || nowTime;
        const durationMs = Math.max(0, nowTime - entryTime);
        const durationMinutes = durationMs / 60000;

        const isTimeMode = settings.stallMode === 'TIME';
        const candleCount = settings.stallCandleCount ?? 3;
        const timeframeMinutes = settings.stallTimeframeMinutes ?? 15;

        // 根据信号 K 线周期动态解析单 K 分钟数 (如 1m, 5m, 15m, 1h, 4h)
        let candleMinutes = 5;
        if (position.signalTf) {
            const tf = position.signalTf.toLowerCase().trim();
            if (tf.endsWith('m')) {
                candleMinutes = parseInt(tf) || 5;
            } else if (tf.endsWith('h')) {
                candleMinutes = (parseInt(tf) || 1) * 60;
            } else if (tf.endsWith('d')) {
                candleMinutes = (parseInt(tf) || 1) * 1440;
            }
        }

        // 根据模式换算超时分钟阈值 (K线模式按信号周期精确计算)
        const timeoutThresholdMinutes = isTimeMode ? timeframeMinutes : (candleCount * candleMinutes);

        const baseTargetProfit = settings.stallTargetProfitPercent ?? 1.0;
        let targetProfit = baseTargetProfit;

        // 波动率自适应目标计算: Max( 1%基础目标, 最近 5 根 K 线平均振幅 × 自适应倍数 )
        const isAdaptive = settings.stallAdaptiveVolatilityEnabled ?? true;
        let adaptiveDetailText = '';

        if (isAdaptive) {
            let avgAmplitude = 0;
            if (position.recentAvgAmplitude !== undefined && position.recentAvgAmplitude > 0) {
                avgAmplitude = position.recentAvgAmplitude;
            } else if (position.recentCandles && position.recentCandles.length > 0) {
                const slice = position.recentCandles.slice(-5);
                const sumAmp = slice.reduce((acc, c) => {
                    const low = (c.low && c.low > 0) ? c.low : (c.close || 1);
                    const amp = Math.abs(((c.high - c.low) / low) * 100);
                    return acc + (isNaN(amp) ? 0 : amp);
                }, 0);
                avgAmplitude = slice.length > 0 ? sumAmp / slice.length : 0;
            } else if (position.signalCandle?.amplitude !== undefined && position.signalCandle.amplitude > 0) {
                avgAmplitude = position.signalCandle.amplitude < 1 ? position.signalCandle.amplitude * 100 : position.signalCandle.amplitude;
            } else if (position.currentIndicators?.volatility !== undefined && position.currentIndicators.volatility > 0) {
                avgAmplitude = position.currentIndicators.volatility;
            } else {
                avgAmplitude = settings.volatilityPercent || 1.0;
            }

            if (isNaN(avgAmplitude) || avgAmplitude <= 0) {
                avgAmplitude = 1.0;
            }

            const multiplier = settings.stallAdaptiveMultiplier ?? 1.2;
            const volatilityTarget = avgAmplitude * multiplier;
            targetProfit = Math.max(baseTargetProfit, volatilityTarget);
            adaptiveDetailText = ` [自适应目标 Max(${baseTargetProfit}%, 5K均振${avgAmplitude.toFixed(2)}%×${multiplier}=${volatilityTarget.toFixed(2)}%)]`;
        }

        // 归一化安全退场区间 (规避上下限填反引起的逻辑瘫痪)
        const rawLower = settings.stallSafeLowerPercent ?? -0.5;
        const rawUpper = settings.stallSafeUpperPercent ?? 0.5;
        const safeLower = Math.min(rawLower, rawUpper);
        const safeUpper = Math.max(rawLower, rawUpper);

        // 条件1: 开仓时长达到或超过设定超时阈值
        if (durationMinutes >= timeoutThresholdMinutes) {
            // 条件2: 持仓期间最高收益率未达到爆发目标 (maxPnl < targetProfit)
            if (maxPnl < targetProfit) {
                // 条件3: 当前盈亏处于安全退场平仓区间 [safeLower, safeUpper]
                if (currentPnl >= safeLower && currentPnl <= safeUpper) {
                    const modeText = isTimeMode ? `${timeframeMinutes}分钟` : `${candleCount}根K线(${candleMinutes}m周期,计${timeoutThresholdMinutes}分)`;
                    close(
                        position.symbol,
                        position.side,
                        `动能超时平仓: 开仓已满 ${modeText} (${durationMinutes.toFixed(1)}分)，最高盈亏仅 ${maxPnl.toFixed(2)}% (<目标${targetProfit.toFixed(2)}%${adaptiveDetailText})，当前盈亏 ${currentPnl.toFixed(2)}% 处于安全区间 [${safeLower}%, ${safeUpper}%]`,
                        100
                    );
                    return true;
                }
            }
        }
    }

    return false;
}
