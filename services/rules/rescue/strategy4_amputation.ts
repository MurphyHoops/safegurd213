import { Position, AppSettings } from '../../../types';

export function checkStrategy4_Amputation(
    mainPosition: Position,
    hedgePosition: Position | undefined,
    settings: AppSettings,
    amputate: (position: Position, ratio: number, reason: string) => void,
    refill: (position: Position, reason: string) => void,
    closePair: (mainId: string, hedgeId: string, reason: string) => void,
    addLog?: (type: string, message: string) => void
): boolean {
    const slSettings = settings.stopLoss;
    if (!slSettings || !slSettings.amputationEnabled) return false;

    // 建立极端防御机制：即便用户浏览器中存在旧版 localStorage 且缺失新属性，也完全兜底，杜绝 NaN 与白屏
    const triggerProfitPercent = typeof slSettings.amputationTriggerProfit === 'number' && !Number.isNaN(slSettings.amputationTriggerProfit)
        ? slSettings.amputationTriggerProfit
        : 5;
    const cutRatio = typeof slSettings.amputationRatio === 'number' && !Number.isNaN(slSettings.amputationRatio)
        ? slSettings.amputationRatio
        : 50;
    const victoryBuffer = typeof slSettings.amputationVictoryBuffer === 'number' && !Number.isNaN(slSettings.amputationVictoryBuffer)
        ? slSettings.amputationVictoryBuffer
        : 10;
    const breathingSpace = typeof slSettings.amputationBreathingSpace === 'number' && !Number.isNaN(slSettings.amputationBreathingSpace)
        ? slSettings.amputationBreathingSpace
        : 1;

    const mainPnL = mainPosition.unrealizedPnL || 0;
    const hedgePnL = hedgePosition ? (hedgePosition.unrealizedPnL || 0) : 0;
    
    // 找出盈利方和亏损方的盈亏金额
    const winningPnL = Math.max(mainPnL, hedgePnL);
    // 找出盈利方盈利率 (原始未杠杆价格变动百分比)
    const winningPnLPercent = Math.max(
        mainPosition.unrealizedPnLPercentage || 0,
        hedgePosition ? (hedgePosition.unrealizedPnLPercentage || 0) : 0
    );
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
    // 亏损覆盖基本线
    const breakevenWinningPnL = losingPnL + totalAccumulatedLoss;
    // 加上安全垫后的目标
    const targetProfit = breakevenWinningPnL * (1 + victoryBuffer / 100);
    
    // 如果已经触发过断臂逻辑（正在跟踪盈利中）
    if (mainPosition.amputationTriggered) {
        // 检查是否刷新最高收益记录
        const oldPeakPercent = mainPosition.maxPnLPercentAfterAmputationTrigger || 0;
        const hasNewPeak = winningPnLPercent > oldPeakPercent;

        // 更新最高盈利记录
        mainPosition.maxPnLAfterAmputationTrigger = Math.max(mainPosition.maxPnLAfterAmputationTrigger || 0, winningPnL);
        mainPosition.maxPnLPercentAfterAmputationTrigger = Math.max(mainPosition.maxPnLPercentAfterAmputationTrigger || 0, winningPnLPercent);
        
        const peakPnL = mainPosition.maxPnLAfterAmputationTrigger !== undefined ? mainPosition.maxPnLAfterAmputationTrigger : winningPnL;
        const peakPnLPercent = mainPosition.maxPnLPercentAfterAmputationTrigger !== undefined ? mainPosition.maxPnLPercentAfterAmputationTrigger : winningPnLPercent;
        
        // 判定退出条件：
        // 1. 盈利率自峰值绝对回调百分点达到“解套回撤清仓”设定值，且当前盈利【必须依然大于等于】“盈利覆盖安全垫”设定值才能清仓
        const pricePullback = peakPnLPercent - winningPnLPercent;
        const hasPulledBack = pricePullback >= breathingSpace && winningPnL >= targetProfit;

        if (hasNewPeak && addLog) {
            addLog('INFO', `📈 [断臂保收新高] ${mainPosition.symbol} 达到完全覆盖保本并刷新高。最新最高赢利率: ${winningPnLPercent.toFixed(2)}% | 对应清仓触发线 (回调 ${breathingSpace}%): ${(winningPnLPercent - breathingSpace).toFixed(2)}% (盈利至少需要维持在安全垫: ${targetProfit.toFixed(2)}U)`);
        }

        if (hasPulledBack) {
            const exitReason = `3. 断臂呼吸解套: 盈利率自最高点(${peakPnLPercent.toFixed(2)}%)回调达到设定的回撤空间${breathingSpace}% (当前: ${winningPnLPercent.toFixed(2)}% | 盈利 ${winningPnL.toFixed(2)}U >= 设定安全垫 ${targetProfit.toFixed(2)}U)`;
            
            if (hedgePosition) {
                closePair(mainPosition.entryId, hedgePosition.entryId, exitReason);
            } else {
                closePair(mainPosition.entryId, '', exitReason);
            }
            return true;
        }
        
        // 还没到达退出条件，继续持有，跟随行情
        return false;
    }

    // 尚未触发，检查是否达到触发目标
    const hasActiveAmputation = (mainPosition.amputatedAmount || 0) > 0 || (hedgePosition ? (hedgePosition.amputatedAmount || 0) : false);
    const canCheckTargetProfit = totalAccumulatedLoss > 0 || hasActiveAmputation;

    if (canCheckTargetProfit && winningPnL > 0 && winningPnL >= targetProfit) {
        // 触发呼吸空间逻辑：记录触发状态，不立即平仓
        mainPosition.amputationTriggered = true;
        mainPosition.maxPnLAfterAmputationTrigger = winningPnL;
        mainPosition.maxPnLPercentAfterAmputationTrigger = winningPnLPercent;
        
        // 记录日志或标记
        addLog?.('INFO', `🔥 断臂保收: ${mainPosition.symbol} 已实现完全覆盖总亏损。开始进入冲顶呼吸阶段！总盈利: ${winningPnL.toFixed(2)}U >= 结算点: ${targetProfit.toFixed(2)}U | 已开启最高点回撤清仓跟踪...`);
        return false; // 继续持有，等待下一跳检查呼吸空间
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
