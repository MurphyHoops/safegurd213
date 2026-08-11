
import { Position, AppSettings, PositionSide } from '../../types';
import { checkStrategy2_HedgeProfit } from './rescue/strategy2_hedgeProfit';
import { checkStrategy3_CallbackProfit } from './rescue/strategy3_callbackProfit';
import { checkStrategy4_Amputation } from './rescue/strategy4_amputation';

/**
 * 检查对冲解套规则 (模块 3)
 * 现已完全拆分为独立的策略文件，修改任意一个策略不会影响其他策略。
 */
export function checkRescueRules(
    position: Position,
    allPositions: Position[],
    settings: AppSettings,
    closePair: (mainId: string, hedgeId: string, reason: string) => void,
    amputate: (position: Position, ratio: number, reason: string) => void,
    refill: (position: Position, reason: string) => void,
    closeHedgeOnly: (hedgeId: string, profit: number, reason: string) => void,
    reopenPosition?: (position: Position, reason: string) => void,
    addLog?: (type: string, message: string) => void
): boolean {
    // LOCKED: Modification to this file is restricted.
    // 仅针对【已对冲】的【主仓位】进行检查
    // Note: A main position might have isHedged=false but still have accumulated profit/loss
    // from previous hedges. We need to check strategy 3 even if there's no active hedge.
    if (position.isUnshackled) {
        return false;
    }

    // 针对留守对冲仓位 (Orphaned Hedge Position) 的规则进行托管
    if (position.mainPositionId) {
        const parentMainExists = allPositions.some(p => p.entryId === position.mainPositionId);
        if (!parentMainExists) {
            const slSettings = settings.stopLoss;
            const hedgePnL = position.unrealizedPnL;
            
            // 1. 回调盈利收割 (Strategy 3.A)
            if (slSettings.callbackProfitClear) {
                const maxHedgePnl = position.maxPnLPercent || 0;
                if (hedgePnL > 0 && position.unrealizedPnLPercentage >= slSettings.callbackTargetProfit) {
                    const drawdown = maxHedgePnl - position.unrealizedPnLPercentage;
                    if (drawdown >= slSettings.callbackRate) {
                        closeHedgeOnly(position.entryId, hedgePnL, `4.3 留守对冲仓回调盈利收割: 利润 ${hedgePnL.toFixed(2)}`);
                        return true;
                    }
                }
            }

            // 2. 对冲单回调止损 (Strategy 3.A2)
            if (slSettings.callbackStopLoss > 0 && position.unrealizedPnLPercentage <= -slSettings.callbackStopLoss) {
                closeHedgeOnly(position.entryId, hedgePnL, `4.3 留守对冲仓位回调止损: 亏损 ${hedgePnL.toFixed(2)}`);
                return true;
            }

            // 3. 对冲止损 (Strategy 2.1)
            if (slSettings.hedgeProfitClear && slSettings.hedgeProfitClearStopLoss > 0 && position.unrealizedPnLPercentage <= -slSettings.hedgeProfitClearStopLoss) {
                closeHedgeOnly(position.entryId, hedgePnL, `4.2 留守对冲仓位对冲止损: 亏损 ${hedgePnL.toFixed(2)}`);
                return true;
            }

            return false;
        }
    }

    if (!position.mainPositionId) {
        const hedgePosition = allPositions.find(p => p.mainPositionId === position.entryId);
        
        // 1. 如果启用了"断臂求生"
        if (settings.stopLoss.amputationEnabled) {
            const totalAccumulatedLoss = 
                (position.cumulativeHedgeLoss || 0) + 
                (position.cumulativeAmputationLoss || 0) + 
                (hedgePosition ? (hedgePosition.cumulativeAmputationLoss || 0) : 0);
            
            const hasHedgingHistory = totalAccumulatedLoss > 0 || hedgePosition !== undefined;

            if (hasHedgingHistory) {
                const res = checkStrategy4_Amputation(position, hedgePosition, settings, amputate, refill, closePair, reopenPosition, addLog, closeHedgeOnly);
                if (res) {
                    return true;
                }
                // 极为关键：当启用了断臂求生，该仓位的最终去留全部交由策略4托管。
                // 我们必须绕过策略2和策略3的分支，防止其被普通的对冲平仓规则中途拦截而直接平账，彻底实现“先冲顶，待回调才清仓”的呼吸机制。
                return false;
            }
        }

        // 策略 3: 回调盈利清仓 (蚂蚁搬家) - Needs to run even without active hedge to check accumulated PnL
        if (checkStrategy3_CallbackProfit(position, hedgePosition, settings, closePair, closeHedgeOnly)) {
            return true;
        }

        // 策略 2: 对冲盈利解套 (将错就错) - Needs to run even without active hedge to check if main position profit covers historical losses
        if (checkStrategy2_HedgeProfit(position, hedgePosition, settings, closePair, closeHedgeOnly, addLog)) {
            return true;
        }

        if (!hedgePosition) return false;

        // 策略 4: 断臂求生 (弃卒保车) - 当未启用断臂求生作为主控，仍作为下限兜底运行时触发
        if (checkStrategy4_Amputation(position, hedgePosition, settings, amputate, refill, closePair, reopenPosition, addLog, closeHedgeOnly)) {
            return true;
        }
    }

    return false;
}

