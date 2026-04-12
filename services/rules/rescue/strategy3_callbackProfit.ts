import { Position, AppSettings } from '../../../types';

export function checkStrategy3_CallbackProfit(
    mainPosition: Position,
    hedgePosition: Position,
    settings: AppSettings,
    closePair: (mainId: string, hedgeId: string, reason: string) => void,
    closeHedgeOnly: (hedgeId: string, profit: number, reason: string) => void
): boolean {
    const slSettings = settings.stopLoss;
    if (!slSettings.callbackProfitClear) return false;

    const mainPnL = mainPosition.unrealizedPnL;
    const hedgePnL = hedgePosition ? hedgePosition.unrealizedPnL : 0;

    // A. 阶段性止盈对冲单
    if (hedgePosition) {
        const maxHedgePnl = hedgePosition.maxPnLPercent || 0;
        if (hedgePnL > 0 && hedgePosition.unrealizedPnLPercentage >= slSettings.callbackTargetProfit) {
            const drawdown = maxHedgePnl - hedgePosition.unrealizedPnLPercentage;
            if (drawdown >= slSettings.callbackRate) {
                closeHedgeOnly(hedgePosition.entryId, hedgePnL, `4.3 回调盈利收割: 利润 ${hedgePnL.toFixed(2)}`);
                return false; // 对冲单平了，主仓继续，所以返回 false (不代表解套完成，只是执行了动作)
            }
        }

        // A2. 对冲单止损控制
        if (slSettings.callbackStopLoss > 0 && hedgePosition.unrealizedPnLPercentage <= -slSettings.callbackStopLoss) {
            closeHedgeOnly(hedgePosition.entryId, hedgePnL, `4.3 对冲单止损: 亏损 ${hedgePnL.toFixed(2)}`);
            return false;
        }
    }

    // B. 累计利润清仓
    const totalAccumulatedProfit = mainPosition.cumulativeHedgeProfit || 0;
    const totalAccumulatedLoss = 
        (mainPosition.cumulativeHedgeLoss || 0) + 
        (mainPosition.cumulativeAmputationLoss || 0) +
        (hedgePosition ? (hedgePosition.cumulativeAmputationLoss || 0) : 0);
    
    // 必须有对冲历史或当前有对冲单，才执行解套清仓逻辑
    const hasHedgingHistory = totalAccumulatedProfit > 0 || totalAccumulatedLoss > 0 || hedgePosition !== undefined;
    
    if (!hasHedgingHistory) {
        return false;
    }

    // 将所有盈利项相加
        const totalPositive = 
            (mainPnL > 0 ? mainPnL : 0) + 
            (hedgePnL > 0 ? hedgePnL : 0) + 
            totalAccumulatedProfit;

        // 将所有亏损项相加（取绝对值）
        const totalNegative = 
            (mainPnL < 0 ? Math.abs(mainPnL) : 0) + 
            (hedgePnL < 0 ? Math.abs(hedgePnL) : 0) + 
            totalAccumulatedLoss;

        // 目标阈值：总亏损 * (1 + 覆盖比例)
        const threshold = totalNegative * (1 + slSettings.callbackCoverPercent / 100);

        if (totalPositive > 0 && totalPositive >= threshold) {
            // 额外安全检查：确保平仓后真的是盈利的（或者至少覆盖了亏损）
            const netProfit = totalPositive - totalNegative;
            const expectedExtraProfit = totalNegative * (slSettings.callbackCoverPercent || 0) / 100;

            if (netProfit >= expectedExtraProfit - 0.01) { // 容忍浮点数误差
                const reasonMsg = `4.3 完美解套清仓: 总盈利 ${totalPositive.toFixed(2)} >= 目标 ${threshold.toFixed(2)} (净赚: ${netProfit.toFixed(2)})`;
                if (hedgePosition) {
                    closePair(mainPosition.entryId, hedgePosition.entryId, reasonMsg);
                } else {
                    // 如果当前没有对冲单，直接平主仓
                    closePair(mainPosition.entryId, '', reasonMsg);
                }
                return true;
            }
        }

    return false;
}
