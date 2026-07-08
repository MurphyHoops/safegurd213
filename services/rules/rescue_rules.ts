
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
    addLog?: (type: string, message: string) => void
): boolean {
    // 仅针对【已对冲】的【主仓位】进行检查
    // Note: A main position might have isHedged=false but still have accumulated profit/loss
    // from previous hedges. We need to check strategy 3 even if there's no active hedge.
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
                const res = checkStrategy4_Amputation(position, hedgePosition, settings, amputate, refill, closePair, addLog);
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
        if (checkStrategy4_Amputation(position, hedgePosition, settings, amputate, refill, closePair, addLog)) {
            return true;
        }
    }

    return false;
}

