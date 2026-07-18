import { Position, AppSettings } from '../../../types';

export function checkStrategy2_HedgeProfit(
    mainPosition: Position,
    hedgePosition: Position | undefined,
    settings: AppSettings,
    closePair: (mainId: string, hedgeId: string, reason: string) => void,
    closeHedgeOnly: (hedgeId: string, profit: number, reason: string) => void,
    addLog?: (type: string, message: string) => void
): boolean {
    const slSettings = settings.stopLoss;
    if (!slSettings.hedgeProfitClear) return false;

    const mainPnL = mainPosition.unrealizedPnL;
    const hedgePnL = hedgePosition ? hedgePosition.unrealizedPnL : 0;

    // 1. 对冲止损 (Hedge Stop Loss)
    if (hedgePosition && slSettings.hedgeProfitClearStopLoss > 0 && hedgePosition.unrealizedPnLPercentage <= -slSettings.hedgeProfitClearStopLoss) {
        closeHedgeOnly(hedgePosition.entryId, hedgePnL, `4.2 对冲止损: 亏损 ${hedgePnL.toFixed(2)} (${hedgePosition.unrealizedPnLPercentage.toFixed(2)}%)`);
        return false; // 对冲单平了，主仓继续，所以返回 false
    }

    // 2. 对冲盈利解套 (严格按照用户逻辑)
    // 情况 A: 当前有对冲单，且对冲单盈利
    // 条件: 对冲单盈利 > (主仓亏损绝对值 + 历史对冲止损之和) * (1 + 覆盖盈余阈值)
    
    // 情况 B: 当前无对冲单 (或对冲单未盈利)，主仓盈利
    // 条件: 主仓盈利 > (历史对冲止损之和) * (1 + 覆盖盈余阈值)

    const totalAccumulatedLoss = 
        (mainPosition.cumulativeHedgeLoss || 0) + 
        (mainPosition.cumulativeAmputationLoss || 0) +
        (hedgePosition ? (hedgePosition.cumulativeAmputationLoss || 0) : 0);
    const coverRatio = 1 + (slSettings.hedgeCoverPercent || 0) / 100;

    // 必须有对冲历史或当前有对冲单，才执行解套清仓逻辑
    const hasHedgingHistory = totalAccumulatedLoss > 0 || hedgePosition !== undefined;

    if (!hasHedgingHistory) {
        return false;
    }

    // 计算当前总负债 (历史亏损 + 当前浮亏)
    let currentFloatingLoss = 0;
    let currentFloatingProfit = 0;

    if (mainPnL < 0) currentFloatingLoss += Math.abs(mainPnL);
    else currentFloatingProfit += mainPnL;

    if (hedgePosition) {
        if (hedgePnL < 0) currentFloatingLoss += Math.abs(hedgePnL);
        else currentFloatingProfit += hedgePnL;
    }

    const totalDebt = totalAccumulatedLoss + currentFloatingLoss;
    const threshold = totalDebt * coverRatio;

    // 当总盈利大于0，且达到覆盖阈值时，执行解套清仓
    if (currentFloatingProfit > 0 && currentFloatingProfit >= threshold) {
        // 额外安全检查：确保平仓后真的是盈利的（或者至少覆盖了亏损）
        const netProfit = currentFloatingProfit - currentFloatingLoss - totalAccumulatedLoss;
        const expectedExtraProfit = totalDebt * (slSettings.hedgeCoverPercent || 0) / 100;
        
        if (netProfit >= expectedExtraProfit - 0.01) { // 容忍浮点数误差
            // 检查 Rule B: 原仓位(主仓)盈利解套，对冲单存在且亏损
            // 只有当“启用原仓位完全复开”功能关闭时，才使用“只清对冲”的 Rule B，否则直接进入 Rule A/常规平仓以触发完整复开
            if (mainPnL > 0 && hedgePosition && hedgePnL < 0 && !settings.stopLoss.autoOpenAfterHedgeProfit) {
                const reasonMsg = `4.2 [Rule B] 原仓位盈利解套: 原仓位盈利达到解套点且对冲仓位亏损。只清理对冲单，标记主仓位已解套。`;
                closeHedgeOnly(hedgePosition.entryId, hedgePnL, reasonMsg);
                
                mainPosition.isUnshackled = true;
                mainPosition.isHedged = false; // 重置对冲标记，允许之后做标准平仓和不再被锁定
                
                addLog?.('SUCCESS', `💰 [Rule B] 原仓位盈利解套: 对冲仓位已平仓清理 (亏损: ${hedgePnL.toFixed(2)}), 原主仓位标记为“已解套仓位”，后续将按普通规则平仓。`);
                return true;
            }

            // 否则 (Rule A 或常规平仓): 清理整对仓位 (closePair)
            const reasonMsg = `4.2 对冲盈利解套: 总盈利 ${currentFloatingProfit.toFixed(2)} >= 目标 ${threshold.toFixed(2)} (净赚: ${netProfit.toFixed(2)})`;
            if (hedgePosition) {
                closePair(mainPosition.entryId, hedgePosition.entryId, reasonMsg);
            } else {
                closePair(mainPosition.entryId, '', reasonMsg);
            }
            return true;
        }
    }

    return false;
}
