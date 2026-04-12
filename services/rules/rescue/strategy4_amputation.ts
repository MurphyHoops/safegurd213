import { Position, AppSettings } from '../../../types';

export function checkStrategy4_Amputation(
    mainPosition: Position,
    hedgePosition: Position | undefined,
    settings: AppSettings,
    amputate: (position: Position, ratio: number, reason: string) => void,
    refill: (position: Position, reason: string) => void,
    closePair: (mainId: string, hedgeId: string, reason: string) => void
): boolean {
    const slSettings = settings.stopLoss;
    if (!slSettings.amputationEnabled) return false;

    const mainPnL = mainPosition.unrealizedPnL;
    const hedgePnL = hedgePosition ? hedgePosition.unrealizedPnL : 0;
    
    // 找出盈利方和亏损方的盈亏金额
    const winningPnL = Math.max(mainPnL, hedgePnL);
    // 亏损方亏损额 (取绝对值，如果没有亏损则为 0)
    const losingPnL = Math.min(mainPnL, hedgePnL) < 0 ? Math.abs(Math.min(mainPnL, hedgePnL)) : 0;

    // 历史止损之和 + 历史砍仓亏损之和
    const totalAccumulatedLoss = 
        (mainPosition.cumulativeHedgeLoss || 0) + 
        (mainPosition.cumulativeAmputationLoss || 0) + 
        (hedgePosition ? (hedgePosition.cumulativeAmputationLoss || 0) : 0);

    const hasHedgingHistory = totalAccumulatedLoss > 0 || hedgePosition !== undefined;

    if (!hasHedgingHistory) {
        return false;
    }

    // 1. 终极算账 (算总账，双向清仓)
    // 公式: 盈利方盈利 > (亏损方亏损额 + 止损之和) * (1 + 盈利覆盖安全垫)
    const targetProfit = (losingPnL + totalAccumulatedLoss) * (1 + slSettings.amputationVictoryBuffer / 100);
    
    if (winningPnL > 0 && winningPnL >= targetProfit) {
        const reason = `3. 断臂求生终极解套: 盈利方盈利(${winningPnL.toFixed(2)}) >= 目标(${targetProfit.toFixed(2)})`;
        if (hedgePosition) {
            closePair(mainPosition.entryId, hedgePosition.entryId, reason);
        } else {
            closePair(mainPosition.entryId, '', reason);
        }
        return true;
    }

    // 3. 补回仓位 (亏损方回本即补回)
    // A. 主仓曾经被砍过，现在回本了 (亏损 >= 0)
    if (mainPosition.amputatedAmount && mainPosition.amputatedAmount > 0 && mainPosition.unrealizedPnL >= 0) {
        refill(mainPosition, `3. 断臂求生: 主仓回本，补回之前砍掉的仓位`);
        return false;
    }

    // B. 对冲单曾经被砍过，现在回本了 (亏损 >= 0)
    if (hedgePosition && hedgePosition.amputatedAmount && hedgePosition.amputatedAmount > 0 && hedgePosition.unrealizedPnL >= 0) {
        refill(hedgePosition, `3. 断臂求生: 对冲单回本，补回之前砍掉的仓位`);
        return false;
    }

    if (!hedgePosition) return false;

    // 2. 触发断臂 (谁赚砍谁)
    const triggerProfitPercent = slSettings.amputationTriggerProfit;
    const cutRatio = slSettings.amputationRatio;
    
    if (!cutRatio || cutRatio <= 0) return false;

    // A. 对冲单赚钱，砍主仓
    // 条件：对冲单盈利率达标，主仓亏损，且主仓当前【没有】被砍过（等待补回中）
    const mainCanBeAmputated = !mainPosition.amputatedAmount || mainPosition.amputatedAmount <= 0;
    if (mainCanBeAmputated && hedgePosition.unrealizedPnLPercentage >= triggerProfitPercent && mainPosition.unrealizedPnL < 0) {
        amputate(mainPosition, cutRatio, `3. 断臂求生: 对冲单盈利 ${hedgePosition.unrealizedPnLPercentage.toFixed(2)}%，砍主仓 ${cutRatio}%`);
        return false;
    }

    // B. 主仓赚钱，砍对冲单
    // 条件：主仓盈利率达标，对冲单亏损，且对冲单当前【没有】被砍过（等待补回中）
    const hedgeCanBeAmputated = !hedgePosition.amputatedAmount || hedgePosition.amputatedAmount <= 0;
    if (hedgeCanBeAmputated && mainPosition.unrealizedPnLPercentage >= triggerProfitPercent && hedgePosition.unrealizedPnL < 0) {
        amputate(hedgePosition, cutRatio, `3. 断臂求生: 主仓盈利 ${mainPosition.unrealizedPnLPercentage.toFixed(2)}%，砍对冲单 ${cutRatio}%`);
        return false;
    }

    return false;
}
