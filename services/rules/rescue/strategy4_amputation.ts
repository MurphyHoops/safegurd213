import { Position, AppSettings, PositionSide } from '../../../types';

export function checkStrategy4_Amputation(
    mainPosition: Position,
    hedgePosition: Position | undefined,
    settings: AppSettings,
    amputate: (position: Position, ratio: number, reason: string) => void,
    refill: (position: Position, reason: string) => void,
    closePair: (mainId: string, hedgeId: string, reason: string) => void,
    reopenPosition?: (position: Position, reason: string) => void,
    addLog?: (type: string, message: string) => void,
    closeHedgeOnly?: (hedgeId: string, profit: number, reason: string) => void
): boolean {
    // LOCKED: Modification to this file is restricted.
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

    // 🔒 [单币累计历史负债] 历史止损之和 + 历史砍仓亏损之和
    const symbolAmputationLoss = Math.max(
        mainPosition.cumulativeAmputationLoss || 0,
        hedgePosition ? (hedgePosition.cumulativeAmputationLoss || 0) : 0
    );
    const totalAccumulatedLoss = 
        (mainPosition.cumulativeHedgeLoss || 0) + 
        symbolAmputationLoss;

    // 🔒【严格前置条件】：只有在一个币正在防爆对冲的时候（当前存在对冲单，或者处于被砍仓等待补仓的对冲周期），才执行断臂求生逻辑
    const isUnderActiveHedge = hedgePosition !== undefined || !!(mainPosition.isAmputated && (mainPosition.amputatedAmount || 0) > 0);

    if (!isUnderActiveHedge) {
        return false;
    }

    // ==========================================
    // 🌟 第一执行顺位：补回仓位 (当【被砍仓位】自身盈亏值大于等于0% / 亏损归0%时立即补回砍仓前的数量)
    // 🔒【严格被砍物理标记铁律】：必须且仅当该仓位切实经历过砍仓 (isAmputated === true 且 amputatedAmount > 0)
    // 🔒【只补一次铁律】：补仓触发后立即清空被砍状态，杜绝任何重复补仓或由数量差推导的误补仓！
    // ==========================================
    const isMainAmputated = !!mainPosition.isAmputated && (mainPosition.amputatedAmount || 0) > 0;
    const isHedgeAmputated = hedgePosition && !!hedgePosition.isAmputated && (hedgePosition.amputatedAmount || 0) > 0;

    if (isMainAmputated) {
        // 主仓被砍：当【主仓自身】盈亏值≥-0.08%(实盘买卖价差与滑点容差) 或价格回到开仓均价附近(相对偏差<=0.08%)时立即补仓
        const mainPnlPct = mainPosition.unrealizedPnLPercentage ?? 0;
        const mainEntry = mainPosition.entryPrice || 0;
        const mainMark = mainPosition.markPrice || mainEntry;
        const mainPriceDiffRatio = mainEntry > 0 ? (mainPosition.side === PositionSide.LONG ? (mainMark - mainEntry) / mainEntry : (mainEntry - mainMark) / mainEntry) : 0;

        const isMainPriceBackToEntry = mainPnlPct >= -0.08 ||
            (mainPosition.unrealizedPnL !== undefined && mainPosition.unrealizedPnL >= -0.01) ||
            mainPriceDiffRatio >= -0.0008;

        if (isMainPriceBackToEntry) {
            const refillQty = mainPosition.amputatedAmount || 0;
            refill(mainPosition, `3. 断臂求生: 被砍主仓回踩开仓价(盈亏已达${mainPnlPct.toFixed(2)}%)，立即补回砍仓前数量(${refillQty.toFixed(4)})`);
            return false;
        }
    } else if (isHedgeAmputated && hedgePosition) {
        // 对冲仓被砍：当【对冲仓自身】盈亏值≥-0.08%(实盘买卖价差与滑点容差) 或价格回到开仓均价附近(相对偏差<=0.08%)时立即补仓
        const hedgePnlPct = hedgePosition.unrealizedPnLPercentage ?? 0;
        const hedgeEntry = hedgePosition.entryPrice || 0;
        const hedgeMark = hedgePosition.markPrice || hedgeEntry;
        const hedgePriceDiffRatio = hedgeEntry > 0 ? (hedgePosition.side === PositionSide.LONG ? (hedgeMark - hedgeEntry) / hedgeEntry : (hedgeEntry - hedgeMark) / hedgeEntry) : 0;

        const isHedgePriceBackToEntry = hedgePnlPct >= -0.08 ||
            (hedgePosition.unrealizedPnL !== undefined && hedgePosition.unrealizedPnL >= -0.01) ||
            hedgePriceDiffRatio >= -0.0008;

        if (isHedgePriceBackToEntry) {
            const refillQty = hedgePosition.amputatedAmount || 0;
            refill(hedgePosition, `3. 断臂求生: 被砍对冲仓回踩开仓价(盈亏已达${hedgePnlPct.toFixed(2)}%)，立即补回砍仓前数量(${refillQty.toFixed(4)})`);
            return false;
        }
    }

    // ==========================================
    // 🌟 第二执行顺位：终极算账 (算总账，双向清仓 / 主仓续航)
    // ==========================================
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
            
            if (slSettings.amputationHedgeOnlyExit && hedgePosition && closeHedgeOnly) {
                // 只清对冲，主仓保留续航
                const onlyHedgeReason = exitReason + " [只清对冲、主仓续航]";
                closeHedgeOnly(hedgePosition.entryId, hedgePosition.unrealizedPnL, onlyHedgeReason);
                
                // 重置主仓的断臂求生和对冲跟踪状态，让其作为普通仓位运行，并且可以重新对冲
                mainPosition.amputationTriggered = false;
                delete mainPosition.maxPnLAfterAmputationTrigger;
                delete mainPosition.maxPnLPercentAfterAmputationTrigger;
                mainPosition.amputatedAmount = 0;
                delete (mainPosition as any)._slTriggered;
                mainPosition.isUnshackled = true; // 标记为主仓已解套，让其恢复到标准止盈止损的平仓方式
                
                if (addLog) {
                    addLog('SUCCESS', `🛡️ [主仓续航启动] 已单独平掉对冲仓位并重置断臂状态。原主仓 ${mainPosition.symbol} ${mainPosition.side} 保持运行，解除对冲，并恢复正常止盈止损！`);
                }
            } else {
                // 原有逻辑：双向清仓
                if (hedgePosition) {
                    closePair(mainPosition.entryId, hedgePosition.entryId, exitReason);
                } else {
                    closePair(mainPosition.entryId, '', exitReason);
                }
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

    if (!hedgePosition) return false;

    // 2. 触发断臂 (谁赚砍谁 - 🔄 动态循环状态机：砍仓->亏损归零补仓->再次盈利再砍仓，循环次数受震荡磨损保护熔断控制)
    if (!cutRatio || cutRatio <= 0) return false;

    // 🔒 [断臂求生防重复砍仓安全锁] 8秒内不允许对同一币种进行二次砍仓
    const now = Date.now();
    const lastAmpMain = mainPosition.lastAmputationTime || 0;
    const lastAmpHedge = hedgePosition ? (hedgePosition.lastAmputationTime || 0) : 0;
    if (now - lastAmpMain < 8000 || now - lastAmpHedge < 8000) {
        return false;
    }

    // 🔒 [双边完整对冲硬锁与严格交替闭环] 
    // 铁律 1：如果上一轮砍仓尚未回踩补仓 (isAmputated 为 true 或待补仓数量 > 0)，100% 绝对禁止发起二次连续砍仓！
    const hasPendingRefill = !!mainPosition.isAmputated || 
        (mainPosition.amputatedAmount || 0) > 0 || 
        (hedgePosition ? (!!hedgePosition.isAmputated || (hedgePosition.amputatedAmount || 0) > 0) : false);

    if (hasPendingRefill) {
        // 上一轮砍仓尚未完成回踩补仓，严格等待回踩补仓恢复，禁止连续砍仓！
        return false;
    }

    // 铁律 2：双边仓位必须同时有效存在 (持仓数量 > 0)
    if (mainPosition.amount <= 0.0001 || !hedgePosition || hedgePosition.amount <= 0.0001) {
        return false;
    }

    // 铁律 3：数量比例防御 (双保险)
    // 砍仓通常砍掉 90% (两边比例会变成 10:1 甚至差值超 80%)。
    // 如果两边持仓差异超过 45%，说明有一边被严重削减且未补齐，严禁发起砍仓；
    // 反之，初次开仓因价格波动与精度产生的正常数量差异 (通常在 5%~25% 以内) 100% 正常放行！
    const maxAmt = Math.max(mainPosition.amount, hedgePosition.amount);
    const minAmt = Math.min(mainPosition.amount, hedgePosition.amount);
    if (maxAmt > 0 && ((maxAmt - minAmt) / maxAmt) > 0.45) {
        return false;
    }

    // 🔒 [震荡磨损保护熔断控制] 检查当前币种累计砍仓循环次数
    const currentAmpCount = Math.max(
        mainPosition.amputationCount || 0,
        hedgePosition ? (hedgePosition.amputationCount || 0) : 0
    );
    if (slSettings.fuseEnabled && currentAmpCount >= (slSettings.maxHedgeRetries || 3)) {
        return false;
    }

    // 剩余持仓价值保护：确保仓位有效存在且未处于砍仓等待补仓状态
    const mainNotional = mainPosition.amount * (mainPosition.markPrice || mainPosition.entryPrice);
    const hedgeNotional = hedgePosition ? hedgePosition.amount * (hedgePosition.markPrice || hedgePosition.entryPrice) : 0;

    // A. 对冲单赚钱，砍主仓
    // 条件：对冲单盈利率达标，主仓亏损，主仓有效存在
    const mainCanBeAmputated = (mainNotional >= 0.1 || mainPosition.amount > 0);
    if (mainCanBeAmputated && (hedgePosition.unrealizedPnLPercentage || 0) >= triggerProfitPercent && (mainPosition.unrealizedPnL || 0) < 0) {
        amputate(mainPosition, cutRatio, `3. 断臂求生: 对冲单盈利 ${(hedgePosition.unrealizedPnLPercentage || 0).toFixed(2)}%，砍主仓 ${cutRatio}% (第${currentAmpCount + 1}次)`);
        return false;
    }

    // B. 主仓赚钱，砍对冲单
    // 条件：主仓盈利率达标，对冲单亏损，对冲单有效存在
    const hedgeCanBeAmputated = (hedgeNotional >= 0.1 || hedgePosition.amount > 0);
    if (hedgeCanBeAmputated && (mainPosition.unrealizedPnLPercentage || 0) >= triggerProfitPercent && (hedgePosition.unrealizedPnL || 0) < 0) {
        amputate(hedgePosition, cutRatio, `3. 断臂求生: 主仓盈利 ${(mainPosition.unrealizedPnLPercentage || 0).toFixed(2)}%，砍对冲单 ${cutRatio}% (第${currentAmpCount + 1}次)`);
        return false;
    }

    return false;
}
