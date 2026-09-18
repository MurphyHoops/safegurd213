// 🔒 @LOCKED: 断臂求生执行策略核心模块 (Strategy 4 - Amputation & Dynamic Refill)
// 严禁在未获用户直接指令前对本文件进行任何重构、修改、删除或参数篡改
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

    // 🔒【严格前置条件】：必须且仅当处于双向对冲状态（存在对手单），或单方已被砍仓等待回踩补仓时，才激活断臂求生
    if (!hedgePosition && !(mainPosition.isAmputated && (mainPosition.amputatedAmount || 0) > 0)) {
        return false;
    }

    // ==========================================
    // 🌟 第一执行顺位：补回仓位 (当【被砍仓位】自身盈亏值大于等于0% / 亏损归0%时立即补回砍仓前的数量)
    // 🔒【严格被砍物理标记铁律】：必须且仅当该仓位切实经历过砍仓 (isAmputated === true 且 amputatedAmount > 0)
    // 🔒【只补一次铁律】：补仓触发后立即清空被砍状态，杜绝任何重复补仓或由数量差推导的误补仓！
    // ==========================================
    // 🔒【严格被砍物理标记与失衡自愈识别】：
    // 优先读取显式被砍标记 (isAmputated === true 且 amputatedAmount > 0)
    // 自愈兜底：若持仓严重失衡(单边明显小于对手单 >20%)且具备断臂历史负债，即便标记因同步异常丢失，亦能精准识别被砍方并自愈补回
    const symbolAmpLoss = Math.max(
        mainPosition.cumulativeAmputationLoss || 0,
        hedgePosition ? (hedgePosition.cumulativeAmputationLoss || 0) : 0
    );
    const isMainImbalanced = hedgePosition && (hedgePosition.amount - mainPosition.amount) > (hedgePosition.amount * 0.2);
    const isHedgeImbalanced = hedgePosition && (mainPosition.amount - hedgePosition.amount) > (mainPosition.amount * 0.2);

    const isMainAmputated = (!!mainPosition.isAmputated && (mainPosition.amputatedAmount || 0) > 0) ||
        (isMainImbalanced && (symbolAmpLoss > 0 || (mainPosition.cumulativeAmputationLoss || 0) > 0));
    const isHedgeAmputated = (!!hedgePosition && !!hedgePosition.isAmputated && (hedgePosition.amputatedAmount || 0) > 0) ||
        (isHedgeImbalanced && (symbolAmpLoss > 0 || (hedgePosition?.cumulativeAmputationLoss || 0) > 0));

    const now = Date.now();

    if (isMainAmputated) {
        // 主仓被砍：严格按照用户铁律，当盈亏比例 > 0%（即多单价格 > 开仓均价，或空单价格 < 开仓均价）时立即执行自动回踩补仓
        // 🔒 [砍后冷却保护] 砍仓后至少等待 1.5 秒缓冲期，防止刚砍仓的瞬间因撮合与状态同步并发产生误补仓
        const lastCutTime = mainPosition.lastAmputationTime || 0;
        const lastRefillTime = mainPosition.lastRefillTime || 0;

        if ((now - lastCutTime >= 1500) && (now - lastRefillTime >= 1500)) {
            const mainEntry = mainPosition.amputationEntryPrice || mainPosition.originalEntryPrice || mainPosition.entryPrice || 0;
            const mainMark = mainPosition.markPrice || 0;

            // 🔒【严格盈亏转正铁律 (盈亏 > 0% / 价格切实突破开仓均价)】：
            // 1. 多头(LONG)：盈亏比例 > 0% 或 实时价格高于开仓价 (mainMark > mainEntry)
            // 2. 空头(SHORT)：盈亏比例 > 0% 或 实时价格低于开仓价 (mainMark < mainEntry)
            const isPnlPositive = mainPosition.unrealizedPnLPercentage !== undefined && mainPosition.unrealizedPnLPercentage > 0;
            const isPriceBeyondEntry = mainEntry > 0 && mainMark > 0 && (
                mainPosition.side === PositionSide.LONG ? mainMark > mainEntry : mainMark < mainEntry
            );

            const shouldRefill = isPnlPositive || isPriceBeyondEntry;

            if (shouldRefill) {
                const refillQty = (mainPosition.amputatedAmount && mainPosition.amputatedAmount > 0)
                    ? mainPosition.amputatedAmount
                    : (hedgePosition ? Math.max(0, hedgePosition.amount - mainPosition.amount) : 0);

                if (refillQty > 0) {
                    const compSymbol = mainPosition.side === PositionSide.LONG ? '>' : '<';
                    const sideLabel = mainPosition.side === PositionSide.LONG ? '多仓' : '空仓';
                    const pnlText = (mainPosition.unrealizedPnLPercentage || 0).toFixed(2);
                    
                    mainPosition.amputationTriggered = false;
                    delete mainPosition.maxPnLAfterAmputationTrigger;
                    delete mainPosition.maxPnLPercentAfterAmputationTrigger;
                    delete mainPosition.lastLoggedPeakPercent;

                    // 显式将 refillQty 透传给下游执行器，确保实盘或模拟能够百分百准确读取到补仓数量
                    refill(
                        mainPosition, 
                        `3. 断臂求生: 被砍${sideLabel}盈亏转正(盈亏率:${pnlText}% > 0%, 实时价:${mainMark.toFixed(4)} ${compSymbol} 开仓价:${mainEntry.toFixed(4)})，立即补回数量(${refillQty.toFixed(4)})`, 
                        refillQty
                    );

                    return true;
                }
            }
        }
    } else if (isHedgeAmputated && hedgePosition) {
        // 对冲仓被砍：严格按照用户铁律，当盈亏比例 > 0%（即多单价格 > 开仓均价，或空单价格 < 开仓均价）时立即执行自动回踩补仓
        // 🔒 [砍后冷却保护] 砍仓后至少等待 1.5 秒缓冲期，防止刚砍仓的瞬间因撮合与状态同步并发产生误补仓
        const lastCutTime = hedgePosition.lastAmputationTime || 0;
        const lastRefillTime = hedgePosition.lastRefillTime || 0;

        if ((now - lastCutTime >= 1500) && (now - lastRefillTime >= 1500)) {
            const hedgeEntry = hedgePosition.amputationEntryPrice || hedgePosition.originalEntryPrice || hedgePosition.entryPrice || 0;
            const hedgeMark = hedgePosition.markPrice || 0;

            // 🔒【严格盈亏转正铁律 (盈亏 > 0% / 价格切实突破开仓均价)】：
            // 1. 多头(LONG)：盈亏比例 > 0% 或 实时价格高于开仓价 (hedgeMark > hedgeEntry)
            // 2. 空头(SHORT)：盈亏比例 > 0% 或 实时价格低于开仓价 (hedgeMark < hedgeEntry)
            const isHedgePnlPositive = hedgePosition.unrealizedPnLPercentage !== undefined && hedgePosition.unrealizedPnLPercentage > 0;
            const isHedgePriceBeyondEntry = hedgeEntry > 0 && hedgeMark > 0 && (
                hedgePosition.side === PositionSide.LONG ? hedgeMark > hedgeEntry : hedgeMark < hedgeEntry
            );

            const shouldHedgeRefill = isHedgePnlPositive || isHedgePriceBeyondEntry;

            if (shouldHedgeRefill) {
                const refillQty = (hedgePosition.amputatedAmount && hedgePosition.amputatedAmount > 0)
                    ? hedgePosition.amputatedAmount
                    : Math.max(0, mainPosition.amount - hedgePosition.amount);

                if (refillQty > 0) {
                    const compSymbol = hedgePosition.side === PositionSide.LONG ? '>' : '<';
                    const sideLabel = hedgePosition.side === PositionSide.LONG ? '对冲多仓' : '对冲空仓';
                    const pnlText = (hedgePosition.unrealizedPnLPercentage || 0).toFixed(2);

                    mainPosition.amputationTriggered = false;
                    delete mainPosition.maxPnLAfterAmputationTrigger;
                    delete mainPosition.maxPnLPercentAfterAmputationTrigger;
                    delete mainPosition.lastLoggedPeakPercent;

                    // 显式将 refillQty 透传给下游执行器，确保实盘或模拟能够百分百准确读取到补仓数量
                    refill(
                        hedgePosition, 
                        `3. 断臂求生: 被砍${sideLabel}盈亏转正(盈亏率:${pnlText}% > 0%, 实时价:${hedgeMark.toFixed(4)} ${compSymbol} 开仓价:${hedgeEntry.toFixed(4)})，立即补回数量(${refillQty.toFixed(4)})`, 
                        refillQty
                    );

                    return true;
                }
            }
        }
    }

    // ==========================================
    // 🌟 第二执行顺位：触发断臂 (谁赚砍谁 - 🔄 动态循环状态机：砍仓->亏损归零补仓->再次盈利再砍仓)
    // 🔒【核心铁律】：当一方盈利率达标且另一方处于亏损时，必须优先执行按比例砍仓(如60%)并保留底仓(40%)，绝对严禁在此阶段被误判为全额清仓！
    // ==========================================
    if (hedgePosition && cutRatio && cutRatio > 0) {
        // 🔒 [断臂求生防重复砍仓安全锁] 8秒内不允许对同一币种进行二次砍仓
        const lastAmpMain = mainPosition.lastAmputationTime || 0;
        const lastAmpHedge = hedgePosition.lastAmputationTime || 0;
        const isWithinCooldown = (now - lastAmpMain < 8000) || (now - lastAmpHedge < 8000);

        // 🔒 [对冲刚开仓冷静保护期] 对冲单刚开仓 15 秒内为建仓与持仓对账缓冲期，严禁在此期间发起砍仓
        const hedgeOpenTime = hedgePosition.entryTime || 0;
        const isHedgeFresh = (now - hedgeOpenTime < 15000);

        // 🔒 [双边完整对冲硬锁与严格交替闭环] 
        // 铁律 1：如果上一轮砍仓尚未回踩补仓 (isAmputated 为 true、待补仓数量 > 0 或 砍仓次数 > 补仓次数)，100% 绝对禁止发起二次连续砍仓！
        const totalAmpCount = Math.max(
            mainPosition.amputationCount || 0,
            hedgePosition.amputationCount || 0
        );
        const totalRefillCount = Math.max(
            mainPosition.refillCount || 0,
            hedgePosition.refillCount || 0
        );

        const hasPendingRefill = 
            totalAmpCount > totalRefillCount ||
            !!mainPosition.isAmputated || 
            (mainPosition.amputatedAmount || 0) > 0 || 
            !!hedgePosition.isAmputated || 
            (hedgePosition.amputatedAmount || 0) > 0;

        // 铁律 2：双边仓位必须同时有效存在 (持仓数量 > 0)
        const hasBothPositions = mainPosition.amount > 0.0001 && hedgePosition.amount > 0.0001;

        // 铁律 3：数量比例防御 (双保险)
        // 砍仓通常砍掉 60%~90%。如果两边持仓差异超过 45%，说明有一边已被大幅削减且未补齐，严禁重复砍仓；
        // 反之，初次开仓或已回踩补齐状态下 (差异通常在 5%~25% 以内) 100% 正常放行！
        const maxAmt = Math.max(mainPosition.amount, hedgePosition.amount);
        const minAmt = Math.min(mainPosition.amount, hedgePosition.amount);
        const isRatioBalanced = maxAmt <= 0 || ((maxAmt - minAmt) / maxAmt) <= 0.45;

        // 🔒 [震荡磨损保护熔断控制] 检查当前币种累计砍仓循环次数
        const currentAmpCount = Math.max(
            mainPosition.amputationCount || 0,
            hedgePosition.amputationCount || 0
        );
        const isFuseTriggered = !!slSettings.fuseEnabled && currentAmpCount >= (slSettings.maxHedgeRetries || 3);

        if (!isWithinCooldown && !isHedgeFresh && !hasPendingRefill && hasBothPositions && isRatioBalanced && !isFuseTriggered) {
            const mainNotional = mainPosition.amount * (mainPosition.markPrice || mainPosition.entryPrice);
            const hedgeNotional = hedgePosition.amount * (hedgePosition.markPrice || hedgePosition.entryPrice);

            // 🔒【标的资产原始价格变动幅度现场物理核算绝对铁律】
            // 严禁直接信任可能残留历史波峰快照的 unrealizedPnLPercentage！
            // 必须严格基于【基准开仓价】与【当前最新实时标记价】进行现场实时核算：
            const mainEntry = mainPosition.entryPrice;
            const mainMark = mainPosition.markPrice;
            const hedgeEntry = hedgePosition.entryPrice;
            const hedgeMark = hedgePosition.markPrice;

            if (mainEntry <= 0 || mainMark <= 0 || hedgeEntry <= 0 || hedgeMark <= 0) {
                return false;
            }

            const realMainPnlPct = mainPosition.side === PositionSide.LONG
                ? ((mainMark - mainEntry) / mainEntry) * 100
                : ((mainEntry - mainMark) / mainEntry) * 100;

            const realHedgePnlPct = hedgePosition.side === PositionSide.LONG
                ? ((hedgeMark - hedgeEntry) / hedgeEntry) * 100
                : ((hedgeEntry - hedgeMark) / hedgeEntry) * 100;

            // 即时刷新持仓对象的最新真实盈利率，坚决消除任何历史残留
            mainPosition.unrealizedPnLPercentage = realMainPnlPct;
            hedgePosition.unrealizedPnLPercentage = realHedgePnlPct;

            // A. 对冲单赚钱，砍主仓
            // 条件：对冲单真实盈利率达标，主仓真实亏损，主仓有效存在
            const mainCanBeAmputated = (mainNotional >= 0.1 || mainPosition.amount > 0);
            if (mainCanBeAmputated && realHedgePnlPct >= triggerProfitPercent && realMainPnlPct < 0) {
                mainPosition.amputationTriggered = false;
                delete mainPosition.maxPnLAfterAmputationTrigger;
                delete mainPosition.maxPnLPercentAfterAmputationTrigger;
                delete mainPosition.lastLoggedPeakPercent;
                amputate(mainPosition, cutRatio, `3. 断臂求生: 对冲单盈利 ${realHedgePnlPct.toFixed(2)}%，砍主仓 ${cutRatio}% (第${currentAmpCount + 1}次)`);
                return true;
            }

            // B. 主仓赚钱，砍对冲单
            // 条件：主仓真实盈利率达标，对冲单真实亏损，对冲单有效存在
            const hedgeCanBeAmputated = (hedgeNotional >= 0.1 || hedgePosition.amount > 0);
            if (hedgeCanBeAmputated && realMainPnlPct >= triggerProfitPercent && realHedgePnlPct < 0) {
                mainPosition.amputationTriggered = false;
                delete mainPosition.maxPnLAfterAmputationTrigger;
                delete mainPosition.maxPnLPercentAfterAmputationTrigger;
                delete mainPosition.lastLoggedPeakPercent;
                amputate(hedgePosition, cutRatio, `3. 断臂求生: 主仓盈利 ${realMainPnlPct.toFixed(2)}%，砍对冲单 ${cutRatio}% (第${currentAmpCount + 1}次)`);
                return true;
            }
        }
    }

    // ==========================================
    // 🌟 第三执行顺位：终极算账 (算总账，覆盖历史负债与砍仓亏损后的冲顶呼吸清仓 / 主仓续航)
    // 🔒【严格前置铁律】：必须确实经历过砍仓(已砍未补)或存在历史累计负债时，才进入算总账冲顶呼吸阶段！
    // 绝对禁止在尚未发生任何砍仓且无历史负债的初始对冲阶段，因微小价差波动直接误判清仓！
    // ==========================================
    const hasActiveAmputation = (mainPosition.amputatedAmount || 0) > 0 || (hedgePosition ? (hedgePosition.amputatedAmount || 0) : false);
    const hasDebtOrAmputation = totalAccumulatedLoss > 0 || hasActiveAmputation;

    if (!hasDebtOrAmputation) {
        return false;
    }

    // 亏损覆盖基本线：当前未平亏损 + 历史累计已实现负债
    const breakevenWinningPnL = losingPnL + totalAccumulatedLoss;
    // 加上安全垫后的目标
    const targetProfit = breakevenWinningPnL * (1 + victoryBuffer / 100);
    
    // 如果已经触发过断臂保收逻辑（正在跟踪最高点呼吸回撤）
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
        // 盈利率自峰值绝对回调百分点达到“解套回撤清仓”设定值，且当前盈利【必须依然大于等于】“盈利覆盖安全垫”设定值才能清仓
        const pricePullback = peakPnLPercent - winningPnLPercent;
        const hasPulledBack = pricePullback >= breathingSpace && winningPnL >= targetProfit;

        const lastLoggedPercent = mainPosition.lastLoggedPeakPercent !== undefined 
            ? mainPosition.lastLoggedPeakPercent 
            : (hedgePosition?.lastLoggedPeakPercent !== undefined ? hedgePosition.lastLoggedPeakPercent : (oldPeakPercent || 0));
        // 🔒【用户指令】：最新最高盈利率不用变化0.01%就生成日志，变化达到 0.1% 才生成一条信息，避免频繁刷屏
        const shouldLogNewPeak = hasNewPeak && (winningPnLPercent - lastLoggedPercent >= 0.1);

        if (shouldLogNewPeak && addLog) {
            mainPosition.lastLoggedPeakPercent = winningPnLPercent;
            if (hedgePosition) {
                hedgePosition.lastLoggedPeakPercent = winningPnLPercent;
            }
            addLog('INFO', `📈 [断臂保收新高] ${mainPosition.symbol} 达到完全覆盖保本并刷新高。最新最高盈利率: ${winningPnLPercent.toFixed(2)}% | 对应清仓触发线 (回调 ${breathingSpace}%): ${(winningPnLPercent - breathingSpace).toFixed(2)}% (盈利至少需要维持在安全垫: ${targetProfit.toFixed(2)}U)`);
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
                delete mainPosition.lastLoggedPeakPercent;
                mainPosition.amputatedAmount = 0;
                delete (mainPosition as any)._slTriggered;
                mainPosition.isUnshackled = true; // 标记为主仓已解套，让其恢复到标准止盈止损的平仓方式
                
                if (addLog) {
                    addLog('SUCCESS', `🛡️ [主仓续航启动] 已单独平掉对冲仓位并重置断臂状态。原主仓 ${mainPosition.symbol} ${mainPosition.side} 保持运行，解除对冲，并恢复正常止盈止损！`);
                }
            } else {
                // 双向清仓
                if (hedgePosition) {
                    closePair(mainPosition.entryId, hedgePosition.entryId, exitReason);
                } else {
                    closePair(mainPosition.entryId, '', exitReason);
                }
            }
            return true;
        }
        
        // 还没到达退出条件，继续持有，跟随行情冲顶
        return false;
    }

    // 尚未触发，检查是否达到触发目标以开启冲顶呼吸跟踪
    if (winningPnL > 0 && winningPnL >= targetProfit) {
        mainPosition.amputationTriggered = true;
        mainPosition.maxPnLAfterAmputationTrigger = winningPnL;
        mainPosition.maxPnLPercentAfterAmputationTrigger = winningPnLPercent;
        mainPosition.lastLoggedPeakPercent = winningPnLPercent;
        if (hedgePosition) {
            hedgePosition.amputationTriggered = true;
            hedgePosition.maxPnLAfterAmputationTrigger = winningPnL;
            hedgePosition.maxPnLPercentAfterAmputationTrigger = winningPnLPercent;
            hedgePosition.lastLoggedPeakPercent = winningPnLPercent;
        }
        
        addLog?.('INFO', `🔥 断臂保收: ${mainPosition.symbol} 已实现完全覆盖总亏损。开始进入冲顶呼吸阶段！总盈利: ${winningPnL.toFixed(2)}U >= 结算点: ${targetProfit.toFixed(2)}U | 已开启最高点回撤清仓跟踪...`);
        return false;
    }

    return false;
}
