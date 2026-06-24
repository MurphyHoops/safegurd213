import { Position, SmartSettings, PositionSide } from '../../../types';

/**
 * 智能止盈 (Smart)
 */
export function checkSmartProfit(
    position: Position, 
    settings: SmartSettings, 
    close: (symbol: string, side: PositionSide, reason: string, ratio: number) => void
): boolean {
    const maxPnl = position.maxPnLPercent || 0;
    const currentPnl = position.unrealizedPnLPercentage;
    const positionValue = position.amount * position.entryPrice;
    const tiers = Array.isArray(settings.tiers) ? settings.tiers : [];

    // 0. 门槛检查：持仓金额
    if (positionValue < (settings.minPosition || 0)) {
        return false;
    }

    // 1. 检查是否达到启动盈利阈值 (智能模式接管)
    if (maxPnl >= settings.activationProfit) {
        // 2. 计算动态回调比例 (1 - maxPnl%)
        const effectiveMaxPnl = Math.min(maxPnl, 100); 
        const callbackRatio = 1 - (effectiveMaxPnl / 100); 
        
        // 3. 计算允许的最大回撤值
        const allowedDrawdown = maxPnl * callbackRatio;
        
        // 4. 计算当前实际回撤值
        const currentDrawdown = maxPnl - currentPnl;

        // 5. 判断是否触发平仓
        if (currentDrawdown >= allowedDrawdown) {
            close(
                position.symbol, 
                position.side, 
                `智能止盈: 最高盈利 ${maxPnl.toFixed(2)}%, 允许回调 ${allowedDrawdown.toFixed(2)}% (比例 ${(callbackRatio * 100).toFixed(2)}%), 实际盈利锁定在 ${currentPnl.toFixed(2)}%`,
                100 // 智能止盈通常全平
            );
            return true;
        }
    } 
    // 6. 如果未达到智能启动阈值，且开启了阶梯常规平仓功能
    else if (settings.conventionalEnabled && tiers.length > 0) {
        // A. 计算“阶梯保底线” (Safety Floor)
        let safetyFloor = -999;
        let floorReason = "";

        tiers.forEach((tier, idx) => {
            if (maxPnl >= tier.expiry) {
                const potentialFloor = tier.expiry - tier.callback;
                if (potentialFloor > safetyFloor) {
                    safetyFloor = potentialFloor;
                    floorReason = `曾突破阶梯${idx + 1}失效值 ${tier.expiry}%, 该阶梯回调 ${tier.callback}%, 保底锁定 ${potentialFloor.toFixed(2)}%`;
                }
            }
        });

        // B. 检查是否触碰保底线
        if (safetyFloor !== -999 && currentPnl <= safetyFloor) {
            close(
                position.symbol,
                position.side,
                `智能止盈(阶梯保底): 当前盈利 ${currentPnl.toFixed(2)}% <= ${floorReason}`,
                100
            );
            return true;
        }

        // C. 检查当前所属阶梯的常规回调
        const activeTier = tiers.find(tier => 
            maxPnl >= tier.threshold && maxPnl < tier.expiry
        );

        if (activeTier) {
            const drawdown = maxPnl - currentPnl;
            if (drawdown >= activeTier.callback) {
                close(
                    position.symbol, 
                    position.side, 
                    `智能止盈(常规阶梯): 最高盈利 ${maxPnl.toFixed(2)}%, 达到阶梯阈值 ${activeTier.threshold}%, 失效值 ${activeTier.expiry}%, 回调 ${activeTier.callback}%, 实际盈利锁定在 ${currentPnl.toFixed(2)}%`,
                    100
                );
                return true;
            }
        }
    }
    return false;
}
