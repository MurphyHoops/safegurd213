import { Position, AtrSettings, PositionSide } from '../../../types';

/**
 * ATR 止盈 (Trend Exit)
 * 逻辑：
 * 1. 吊灯止盈 (Chandelier Exit): 当价格从最高点回撤超过 (ATR × 倍数) 时平仓。
 * 2. EMA 相交平仓 (EMA Intersection): 当价格与 EMA 相交时平仓。
 * 两个条件并联运行，选中哪个达成哪个就平仓。
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
            // 根据 UI: 1 ATR ≈ 价格 × 波动率估算%
            // 所以回撤阈值 = 波动率估算% * 倍数
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
        
        // 【核心修改】仅在盈利时触发 (Rule: Only trigger when in profit, do not close when in loss)
        // 确保未实现盈亏大于 0
        if (currentPnl > 0) {
            if (position.side === PositionSide.LONG) {
                // 计算该交易至今达到的最高价格
                const maxPrice = position.entryPrice * (1 + maxPnl / 100);
                // 多单平仓：最高价格曾在大一级 EMA80 上方，且当前价格跌破大一级 EMA80
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
                // 计算该交易至今达到的最低价格
                const minPrice = position.entryPrice * (1 - maxPnl / 100);
                // 空单平仓：最低价格曾在大一级 EMA80 下方，且当前价格突破大一级 EMA80
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

    return false;
}
