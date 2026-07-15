import { Position, AppSettings } from '../../../types';

/**
 * 检查全局止盈止损规则
 */
export function checkGlobalRules(
    positions: Position[],
    account: { totalBalance: number, marginBalance: number },
    settings: AppSettings,
    closeAll: (reason: string) => void,
    maxGlobalPnlPercent: number,
    updateMaxGlobalPnlPercent: (val: number) => void
): boolean {
    const profitSettings = settings.profit;
    if (!profitSettings.enabled) return false;

    // 全局模式激活条件：主模式是 GLOBAL，或者并联开关 O 开启了 GLOBAL
    const isGlobalActive = profitSettings.profitMode === 'GLOBAL' || (profitSettings.oEnabledMap && profitSettings.oEnabledMap['GLOBAL']);
    if (!isGlobalActive) return false;

    const globalSettings = profitSettings.global;
    
    // 计算所有持仓的总未实现盈亏 (包括已启动对冲的仓位)
    const totalUnrealizedPnL = positions.reduce((sum, p) => sum + p.unrealizedPnL, 0);
    
    // 如果没有持仓，则不触发全局止盈止损
    if (positions.length === 0) return false;
    
    // 1. 全局止盈 (按金额)
    if (globalSettings.profitAmount > 0 && totalUnrealizedPnL >= globalSettings.profitAmount) {
        closeAll(`全局止盈触发: 总盈利 ${totalUnrealizedPnL.toFixed(2)} >= ${globalSettings.profitAmount}`);
        return true;
    }

    // 2. 全局止损 (按金额) - 注意 totalUnrealizedPnL 是负数
    if (globalSettings.lossAmount > 0 && totalUnrealizedPnL <= -globalSettings.lossAmount) {
        closeAll(`全局止损触发: 总亏损 ${totalUnrealizedPnL.toFixed(2)} <= -${globalSettings.lossAmount}`);
        return true;
    }

    // 3. 全局止盈/止损及阶梯保底 (按百分比 - 相对于余额)
    // 假设基准是 marginBalance (本金)
    if (account.marginBalance > 0) {
        const pnlPercent = (totalUnrealizedPnL / account.marginBalance) * 100;

        // 更新历史最高全局收益率
        if (pnlPercent > 0 && pnlPercent > maxGlobalPnlPercent) {
            updateMaxGlobalPnlPercent(pnlPercent);
            maxGlobalPnlPercent = pnlPercent;
        }

        // A. 常规全局止盈
        if (globalSettings.profitPercent > 0 && pnlPercent >= globalSettings.profitPercent) {
            closeAll(`全局止盈触发: 总盈率 ${pnlPercent.toFixed(2)}% >= ${globalSettings.profitPercent}%`);
            return true;
        }

        // B. 常规全局止损
        if (globalSettings.lossPercent > 0 && pnlPercent <= -globalSettings.lossPercent) {
            closeAll(`全局止损触发: 总亏率 ${pnlPercent.toFixed(2)}% <= -${globalSettings.lossPercent}%`);
            return true;
        }

        // C. 全局阶梯保底锁定方案
        if (globalSettings.conventionalEnabled && Array.isArray(globalSettings.tiers) && globalSettings.tiers.length > 0) {
            const tiers = globalSettings.tiers;
            const currentPnl = pnlPercent;
            const maxPnl = maxGlobalPnlPercent;

            // C1. 计算“阶梯保底线” (Safety Floor)
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

            // C2. 检查是否触碰保底线
            if (safetyFloor !== -999 && currentPnl <= safetyFloor) {
                closeAll(
                    `全局阶梯保底平仓: 当前总盈率 ${currentPnl.toFixed(2)}% <= ${floorReason}`
                );
                return true;
            }

            // C3. 检查当前所属阶梯的常规回调
            const activeTier = tiers.find(tier => 
                maxPnl >= tier.threshold && maxPnl < tier.expiry
            );

            if (activeTier) {
                const drawdown = maxPnl - currentPnl;
                if (drawdown >= activeTier.callback) {
                    closeAll(
                        `[调试] 全局阶梯常规回调平仓: 最高总盈率 ${maxPnl.toFixed(2)}%, 当前总盈率 ${currentPnl.toFixed(2)}%, 回调 ${drawdown.toFixed(2)}% >= 阶梯回调阈值 ${activeTier.callback}%. (阶梯: 阈值 ${activeTier.threshold}%, 失效值 ${activeTier.expiry}%)`
                    );
                    return true;
                }
            }
        }
    }

    return false;
}
