// 🔒 断臂求生执行策略核心模块 (Strategy 4 - Amputation & Dynamic Refill)
import { Position, AppSettings, PositionSide } from '../../../types';

export function checkStrategy4_Amputation(
    mainPosition: Position,
    hedgePosition: Position | undefined,
    settings: AppSettings,
    amputate: (position: Position, ratio: number, reason: string) => void,
    refill: (position: Position, reason: string, customRefillQty?: number) => void,
    closePair: (mainId: string, hedgeId: string, reason: string) => void,
    reopenPosition?: (position: Position, reason: string) => void,
    addLog?: (type: string, message: string) => void,
    closeHedgeOnly?: (hedgeId: string, profit: number, reason: string) => void
): boolean {
    const slSettings = settings.stopLoss;
    if (!slSettings || !slSettings.amputationEnabled) return false;

    // 1. 防御性配置读取与兜底
    const triggerProfitPercent = typeof slSettings.amputationTriggerProfit === 'number' && !Number.isNaN(slSettings.amputationTriggerProfit) ? slSettings.amputationTriggerProfit : 5;
    const cutRatio = typeof slSettings.amputationRatio === 'number' && !Number.isNaN(slSettings.amputationRatio) ? slSettings.amputationRatio : 50;
    const victoryBuffer = typeof slSettings.amputationVictoryBuffer === 'number' && !Number.isNaN(slSettings.amputationVictoryBuffer) ? slSettings.amputationVictoryBuffer : 10;
    const breathingSpace = typeof slSettings.amputationBreathingSpace === 'number' && !Number.isNaN(slSettings.amputationBreathingSpace) ? slSettings.amputationBreathingSpace : 1;

    // 2. ⚡【铁律 1 强制置顶】：无论处于任何状态，首先计算无杠杆纯价格涨跌幅，杜绝杠杆倍数污染
    const mainEntry = mainPosition.originalEntryPrice || mainPosition.entryPrice || 0;
    const mainMark = mainPosition.markPrice || mainPosition.entryPrice || 0;
    const hedgeEntry = hedgePosition ? (hedgePosition.originalEntryPrice || hedgePosition.entryPrice || 0) : 0;
    const hedgeMark = hedgePosition ? (hedgePosition.markPrice || hedgePosition.entryPrice || 0) : 0;

    if (mainEntry <= 0 || mainMark <= 0) return false;

    const realMainPnlPct = mainPosition.side === PositionSide.LONG
        ? ((mainMark - mainEntry) / mainEntry) * 100
        : ((mainEntry - mainMark) / mainEntry) * 100;
    mainPosition.unrealizedPnLPercentage = realMainPnlPct;

    let realHedgePnlPct = 0;
    if (hedgePosition && hedgeEntry > 0 && hedgeMark > 0) {
        realHedgePnlPct = hedgePosition.side === PositionSide.LONG
            ? ((hedgeMark - hedgeEntry) / hedgeEntry) * 100
            : ((hedgeEntry - hedgeMark) / hedgeEntry) * 100;
        hedgePosition.unrealizedPnLPercentage = realHedgePnlPct;
    }

    const mainPnL = mainPosition.unrealizedPnL || 0;
    const hedgePnL = hedgePosition ? (hedgePosition.unrealizedPnL || 0) : 0;
    const winningPnL = Math.max(mainPnL, hedgePnL);
    const winningPnLPercent = Math.max(realMainPnlPct, hedgePosition ? realHedgePnlPct : 0);
    const losingPnL = Math.min(mainPnL, hedgePnL) < 0 ? Math.abs(Math.min(mainPnL, hedgePnL)) : 0;

    // 3. 累计历史负债核算
    const symbolAmputationLoss = Math.max(
        mainPosition.cumulativeAmputationLoss || 0,
        hedgePosition ? (hedgePosition.cumulativeAmputationLoss || 0) : 0
    );
    const totalAccumulatedLoss = (mainPosition.cumulativeHedgeLoss || 0) + symbolAmputationLoss;

    // 严格前置条件：必须处于对冲中，或单方被砍等待回踩补仓
    if (!hedgePosition && !(mainPosition.isAmputated && (mainPosition.amputatedAmount || 0) > 0)) {
        return false;
    }

    const now = Date.now();

    // ==========================================
    // 🌟 第一执行顺位：回踩开仓价自动补仓
    // 锁定物理标记：严格基于 isAmputated 与原始建仓价
    // ==========================================
    const isMainAmputated = !!mainPosition.isAmputated && (mainPosition.amputatedAmount || 0) > 0;
    const isHedgeAmputated = !!hedgePosition && !!hedgePosition.isAmputated && (hedgePosition.amputatedAmount || 0) > 0;

    const refillTarget = slSettings.amputationRefillTarget || 'SELF_OR_OPPOSITE';

    if (isMainAmputated) {
        const lastCutTime = mainPosition.lastAmputationTime || 0;
        const lastRefillTime = mainPosition.lastRefillTime || 0;

        // 1.5秒冷却时间校验
        if ((now - lastCutTime >= 1500) && (now - lastRefillTime >= 1500)) {
            // 主仓补仓判定
            const isBeyondMainEntry = mainPosition.side === PositionSide.LONG ? mainMark >= mainEntry : mainMark <= mainEntry;
            const isBeyondHedgeEntry = hedgePosition ? (mainPosition.side === PositionSide.LONG ? mainMark >= hedgeEntry : mainMark <= hedgeEntry) : false;
            
            const isPriceBeyondEntry = refillTarget === 'SELF_ONLY' ? isBeyondMainEntry : (isBeyondMainEntry || isBeyondHedgeEntry);
            const shouldRefill = realMainPnlPct >= 0 || isPriceBeyondEntry;

            if (shouldRefill) {
                const refillQty = mainPosition.amputatedAmount || 0;
                if (refillQty > 0) {
                    // 重置断臂追踪状态
                    mainPosition.amputationTriggered = false;
                    delete mainPosition.maxPnLAfterAmputationTrigger;
                    delete mainPosition.maxPnLPercentAfterAmputationTrigger;
                    delete mainPosition.lastLoggedPeakPercent;

                    // 执行补仓回调
                    refill(
                        mainPosition,
                        `3. 断臂求生: 被砍多仓盈亏转正或触及开仓价(模式:${refillTarget}, 变幅:${realMainPnlPct.toFixed(2)}%, 现价:${mainMark}, 均价:${mainEntry})，补回数量(${refillQty})`,
                        refillQty
                    );
                    return true;
                }
            }
        }
    } else if (isHedgeAmputated && hedgePosition) {
        const lastCutTime = hedgePosition.lastAmputationTime || 0;
        const lastRefillTime = hedgePosition.lastRefillTime || 0;

        if ((now - lastCutTime >= 1500) && (now - lastRefillTime >= 1500)) {
            // 对冲仓补仓判定
            const isBeyondHedgeEntry = hedgePosition.side === PositionSide.LONG ? hedgeMark >= hedgeEntry : hedgeMark <= hedgeEntry;
            const isBeyondMainEntry = hedgePosition.side === PositionSide.LONG ? hedgeMark >= mainEntry : hedgeMark <= mainEntry;

            const isPriceBeyondEntry = refillTarget === 'SELF_ONLY' ? isBeyondHedgeEntry : (isBeyondHedgeEntry || isBeyondMainEntry);
            const shouldHedgeRefill = realHedgePnlPct >= 0 || isPriceBeyondEntry;

            if (shouldHedgeRefill) {
                const refillQty = hedgePosition.amputatedAmount || 0;
                if (refillQty > 0) {
                    mainPosition.amputationTriggered = false;
                    delete mainPosition.maxPnLAfterAmputationTrigger;
                    delete mainPosition.maxPnLPercentAfterAmputationTrigger;
                    delete mainPosition.lastLoggedPeakPercent;

                    refill(
                        hedgePosition,
                        `3. 断臂求生: 被砍对冲仓盈亏转正或触及开仓价(模式:${refillTarget}, 变幅:${realHedgePnlPct.toFixed(2)}%, 现价:${hedgeMark}, 均价:${hedgeEntry})，补回数量(${refillQty})`,
                        refillQty
                    );
                    return true;
                }
            }
        }
    }

    // ==========================================
    // 🌟 第二执行顺位：动态断臂 (谁赚砍谁)
    // ==========================================
    if (hedgePosition && cutRatio && cutRatio > 0) {
        const lastAmpMain = mainPosition.lastAmputationTime || 0;
        const lastAmpHedge = hedgePosition.lastAmputationTime || 0;
        const isWithinCooldown = (now - lastAmpMain < 8000) || (now - lastAmpHedge < 8000);
        const isHedgeFresh = (now - (hedgePosition.entryTime || 0) < 15000);

        const hasPendingRefill = isMainAmputated || isHedgeAmputated;
        const hasBothPositions = mainPosition.amount > 0.0001 && hedgePosition.amount > 0.0001;

        const maxAmt = Math.max(mainPosition.amount, hedgePosition.amount);
        const minAmt = Math.min(mainPosition.amount, hedgePosition.amount);
        const isRatioBalanced = maxAmt <= 0 || ((maxAmt - minAmt) / maxAmt) <= 0.45;

        const currentAmpCount = Math.max(mainPosition.amputationCount || 0, hedgePosition.amputationCount || 0);
        const isFuseTriggered = !!slSettings.fuseEnabled && currentAmpCount >= (slSettings.maxHedgeRetries || 3);

        if (!isWithinCooldown && !isHedgeFresh && !hasPendingRefill && hasBothPositions && isRatioBalanced && !isFuseTriggered) {
            // A. 对冲单盈利达标，砍主仓
            if (realHedgePnlPct >= triggerProfitPercent && realMainPnlPct < 0) {
                mainPosition.amputationTriggered = false;
                delete mainPosition.maxPnLAfterAmputationTrigger;
                delete mainPosition.maxPnLPercentAfterAmputationTrigger;
                amputate(mainPosition, cutRatio, `3. 断臂求生: 对冲单真实盈利 ${realHedgePnlPct.toFixed(2)}%，砍主仓 ${cutRatio}% (第${currentAmpCount + 1}次)`);
                return true;
            }

            // B. 主仓盈利达标，砍对冲单
            if (realMainPnlPct >= triggerProfitPercent && realHedgePnlPct < 0) {
                mainPosition.amputationTriggered = false;
                delete mainPosition.maxPnLAfterAmputationTrigger;
                delete mainPosition.maxPnLPercentAfterAmputationTrigger;
                amputate(hedgePosition, cutRatio, `3. 断臂求生: 主仓真实盈利 ${realMainPnlPct.toFixed(2)}%，砍对冲单 ${cutRatio}% (第${currentAmpCount + 1}次)`);
                return true;
            }
        }
    }

    // ==========================================
    // 🌟 第三执行顺位：终极算账与冲顶呼吸清仓 / 主仓续航
    // ==========================================
    const hasActiveAmputation = isMainAmputated || isHedgeAmputated;
    const hasDebtOrAmputation = totalAccumulatedLoss > 0 || hasActiveAmputation;

    if (!hasDebtOrAmputation) return false;

    // 保本底线与冲顶激活门槛
    const breakevenWinningPnL = losingPnL + totalAccumulatedLoss;
    const targetProfit = breakevenWinningPnL * (1 + victoryBuffer / 100);

    // 状态 A: 冲顶跟踪激活中
    if (mainPosition.amputationTriggered) {
        // 异常回落保护：若利润直接跌破保本底线，重置冲顶状态重新蓄势，避免死锁
        if (winningPnL < breakevenWinningPnL) {
            mainPosition.amputationTriggered = false;
            delete mainPosition.maxPnLAfterAmputationTrigger;
            delete mainPosition.maxPnLPercentAfterAmputationTrigger;
            delete mainPosition.lastLoggedPeakPercent;
            if (hedgePosition) {
                hedgePosition.amputationTriggered = false;
                delete hedgePosition.maxPnLAfterAmputationTrigger;
                delete hedgePosition.maxPnLPercentAfterAmputationTrigger;
                delete hedgePosition.lastLoggedPeakPercent;
            }
            return false;
        }

        const oldPeakPercent = mainPosition.maxPnLPercentAfterAmputationTrigger || 0;
        const hasNewPeak = winningPnLPercent > oldPeakPercent;

        mainPosition.maxPnLAfterAmputationTrigger = Math.max(mainPosition.maxPnLAfterAmputationTrigger || 0, winningPnL);
        mainPosition.maxPnLPercentAfterAmputationTrigger = Math.max(oldPeakPercent, winningPnLPercent);

        const peakPnLPercent = mainPosition.maxPnLPercentAfterAmputationTrigger;
        const pricePullback = peakPnLPercent - winningPnLPercent;

        // 修复关键：只要回撤达标，且当前利润仍能覆盖保本底线 (breakevenWinningPnL)，即刻获利离场
        const hasPulledBack = pricePullback >= breathingSpace && winningPnL >= breakevenWinningPnL;

        if (hasNewPeak && addLog && (winningPnLPercent - (mainPosition.lastLoggedPeakPercent || 0) >= 0.1)) {
            mainPosition.lastLoggedPeakPercent = winningPnLPercent;
            addLog('INFO', `📈 [断臂保收新高] ${mainPosition.symbol} 创新高: ${winningPnLPercent.toFixed(2)}% | 清仓线: ${(winningPnLPercent - breathingSpace).toFixed(2)}% | 保底线: ${breakevenWinningPnL.toFixed(2)}U`);
        }

        if (hasPulledBack) {
            const exitReason = `3. 断臂呼吸解套: 盈利率自峰值(${peakPnLPercent.toFixed(2)}%)回调${pricePullback.toFixed(2)}% >= ${breathingSpace}% (利润 ${winningPnL.toFixed(2)}U 覆盖保本底线 ${breakevenWinningPnL.toFixed(2)}U)`;
            const isMainPositionWinning = mainPnL > 0 && (!hedgePosition || mainPnL >= hedgePnL);

            // 规则分支 1: 主仓盈利且开启续航 -> 只清对冲，主仓继续跑
            if (slSettings.amputationHedgeOnlyExit && isMainPositionWinning && hedgePosition && closeHedgeOnly) {
                closeHedgeOnly(hedgePosition.entryId, hedgePosition.unrealizedPnL, exitReason + " [主仓续航·只清对冲]");
                mainPosition.amputationTriggered = false;
                delete mainPosition.maxPnLAfterAmputationTrigger;
                delete mainPosition.maxPnLPercentAfterAmputationTrigger;
                mainPosition.amputatedAmount = 0;
                mainPosition.isUnshackled = true; // 彻底解除束缚
                addLog?.('SUCCESS', `🛡️ [主仓续航启动] 原主仓盈利已完全解套，已单独平掉对冲仓位并恢复常规追踪！`);
            } else {
                // 规则分支 2: 双向全平清仓
                if (hedgePosition) {
                    closePair(mainPosition.entryId, hedgePosition.entryId, exitReason);
                } else {
                    closePair(mainPosition.entryId, '', exitReason);
                }

                // ⚡【补全复开逻辑】：若开启了原仓完全复开，且属于对冲单盈利解套或配置了复开，立即触发毫秒级重开
                if (slSettings.amputationReopenEnabled && reopenPosition) {
                    const maxReopen = slSettings.maxReopenCount || 3;
                    const currentReopen = mainPosition.reopenCount || 0;
                    if (currentReopen < maxReopen) {
                        reopenPosition(mainPosition, `断臂全平解套自动复开 (第 ${currentReopen + 1}/${maxReopen} 次)`);
                    }
                }
            }
            return true;
        }
        return false;
    }

    // 状态 B: 首次达标，激活冲顶跟踪
    if (winningPnL > 0 && winningPnL >= targetProfit) {
        mainPosition.amputationTriggered = true;
        mainPosition.maxPnLAfterAmputationTrigger = winningPnL;
        mainPosition.maxPnLPercentAfterAmputationTrigger = winningPnLPercent;
        mainPosition.lastLoggedPeakPercent = winningPnLPercent;
        addLog?.('INFO', `🔥 断臂保收: ${mainPosition.symbol} 覆盖总负债并达到安全垫(+${victoryBuffer}%)。激活冲顶回撤清仓追踪！当前利润: ${winningPnL.toFixed(2)}U >= 目标: ${targetProfit.toFixed(2)}U`);
        return false;
    }

    return false;
}
