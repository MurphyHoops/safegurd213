import { Position, ConventionalSettings, PositionSide } from '../../../types';

/**
 * 常规止盈 (Conventional)
 * 逻辑：当收益率超过 profitPercent 后，开始监控回撤。
 * 如果从最高点回撤超过 callbackPercent，则触发平仓。
 */
export function checkConventionalProfit(
    position: Position, 
    settings: ConventionalSettings, 
    close: (symbol: string, side: PositionSide, reason: string, ratio: number) => void
): boolean {
    const maxPnl = position.maxPnLPercent || 0;
    const currentPnl = position.unrealizedPnLPercentage;
    const positionValue = position.amount * position.entryPrice;

    // 0. 门槛检查：持仓金额
    if (positionValue < settings.minPosition) return false;

    // 1. 门槛检查：是否达到激活止盈的最低收益率
    if (maxPnl < settings.profitPercent) return false;

    // 2. 回撤检查
    const drawdown = maxPnl - currentPnl;
    const effectiveCallback = (settings.closePercent && settings.closePercent < 100 && settings.callbackPercent === 0) ? 0.01 : settings.callbackPercent;
    
    if (drawdown >= effectiveCallback) {
        close(
            position.symbol, 
            position.side, 
            `常规止盈触发: 收益 ${currentPnl.toFixed(2)}% (最高 ${maxPnl.toFixed(2)}%, 回撤 ${drawdown.toFixed(2)}% >= ${effectiveCallback}%)`,
            settings.closePercent || 100
        );
        return true;
    }

    return false;
}
