import { Position, SmartSettings, PositionSide } from '../../../types';

/**
 * 智能止盈 (Smart)
 */
export function checkSmartProfit(
    position: Position, 
    settings: SmartSettings, 
    close: (symbol: string, side: PositionSide, reason: string, ratio: number) => void
): boolean {
    // 0. 智能总开关检查：若显式配置为 false 则关闭，默认开启
    if (settings.enabled === false) {
        return false;
    }

    const currentPnl = position.unrealizedPnLPercentage || 0;
    const maxPnl = Math.max(position.maxPnLPercent || 0, currentPnl);
    const positionValue = (position.amount || 0) * (position.entryPrice || 0);
    const tiers = Array.isArray(settings.tiers) ? settings.tiers : [];

    // 0.1 门槛检查：持仓金额 (若未设置或<=0则不设门槛，默认放行)
    const minPos = Math.max(0, settings.minPosition || 0);
    if (minPos > 0 && positionValue < minPos) {
        return false;
    }

    // 1. 阶梯保底锁定方案：若开启了阶梯保底 (或者未显式设为 false 且配置了有效阶梯)
    const isTierEnabled = settings.conventionalEnabled !== false && tiers.length > 0;
    if (isTierEnabled) {
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
        const maxTierExpiry = tiers.reduce((max, t) => Math.max(max, t.expiry), 0);
        const activeTier = tiers.find(tier => {
            if (tier.expiry === maxTierExpiry && maxPnl >= tier.threshold) {
                return true;
            }
            return maxPnl >= tier.threshold && maxPnl < tier.expiry;
        });

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

        const minTierThreshold = tiers.reduce((min, t) => Math.min(min, t.threshold), 999);
        if (maxPnl >= minTierThreshold) {
            return false;
        }
    }

    // 2. 指数衰减锁定模式
    const isDecayEnabled = settings.decayEnabled ?? true;
    const activationThreshold = settings.activationProfit !== undefined ? settings.activationProfit : 5;
    if (isDecayEnabled && maxPnl >= activationThreshold) {
        // 计算动态回调比例 (1 - maxPnl%)
        const effectiveMaxPnl = Math.min(maxPnl, 100); 
        const callbackRatio = 1 - (effectiveMaxPnl / 100); 
        
        // 计算允许的最大回撤值
        const allowedDrawdown = maxPnl * callbackRatio;
        
        // 计算当前实际回撤值
        const currentDrawdown = maxPnl - currentPnl;

        // 判断是否触发平仓
        if (currentDrawdown >= allowedDrawdown) {
            close(
                position.symbol, 
                position.side, 
                `智能止盈(指数衰减): 最高盈利 ${maxPnl.toFixed(2)}%, 允许回调 ${allowedDrawdown.toFixed(2)}% (比例 ${(callbackRatio * 100).toFixed(2)}%), 实际盈利锁定在 ${currentPnl.toFixed(2)}%`,
                100 // 智能止盈通常全平
            );
            return true;
        }
    } 

    return false;
}
