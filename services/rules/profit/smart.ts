import { Position, SmartSettings, PositionSide } from '../../../types';

/**
 * 智能止盈 (Smart)
 */
export function checkSmartProfit(
    position: Position, 
    settings: SmartSettings, 
    close: (symbol: string, side: PositionSide, reason: string, ratio: number) => void
): boolean {
    // 0. 智能总开关检查：必须在“智能”开关开启的情况下才生效
    // 如果显式传入 enabled === false，或者未开启总开关，则绝不执行任何智能止盈逻辑
    if (settings.enabled === false) {
        return false;
    }

    const maxPnl = position.maxPnLPercent || 0;
    const currentPnl = position.unrealizedPnLPercentage;
    const positionValue = position.amount * position.entryPrice;
    const tiers = Array.isArray(settings.tiers) ? settings.tiers : [];

    // 0.1 门槛检查：持仓金额
    if (positionValue < (settings.minPosition || 0)) {
        return false;
    }

    // 1. 阶梯保底锁定方案：必须在“智能”总开关开启且开启了阶梯保底开关且配置了阶梯时才生效
    if (settings.conventionalEnabled && tiers.length > 0) {
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
        // 当 maxPnl 已经超出最高阶梯的失效值时，最高阶梯仍应作为 activeTier 保持运行，以便根据最高阶梯的回调比例持续从最高点进行追踪止盈！
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

        // 当开启了阶梯保底锁定方案时，只要已经激活了任一阶梯且未平仓，
        // 应当由阶梯规则完全接管。不应再往下执行指数衰减锁定模式（Step 2），防止两个模式冲突导致意外的提前平仓！
        const minTierThreshold = tiers.reduce((min, t) => Math.min(min, t.threshold), 999);
        if (maxPnl >= minTierThreshold) {
            return false;
        }
    }

    // 2. 指数衰减锁定模式：必须在“智能”总开关开启 且 单独的“指数衰减锁定模式开关 (decayEnabled)”开启的情况下才生效
    const isDecayEnabled = settings.decayEnabled ?? true; // 若未配置默认兼容
    if (isDecayEnabled && maxPnl >= settings.activationProfit) {
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
