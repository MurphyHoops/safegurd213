import { Position, ConventionalSettings, PositionSide } from '../../../types';

/**
 * 常规止盈 (Conventional)
 * 逻辑：当收益率超过 profitPercent 后，开始监控回撤。
 * 如果从最高点回撤超过 callbackPercent，则触发平仓。
 */
export function checkConventionalProfit(
    position: Position, 
    settings: ConventionalSettings, 
    close: (symbol: string, side: PositionSide, reason: string, ratio: number) => void
): boolean {
    const maxPnl = position.maxPnLPercent || 0;
    const currentPnl = position.unrealizedPnLPercentage;
    const positionValue = position.amount * position.entryPrice;

    // 0. 门槛检查：持仓金额
    if (positionValue < settings.minPosition) return false;

    // 1. 托底平仓检查 (Trailing floor profit protection)
    if (settings.trailingEnabled) {
        // Build active tiers to evaluate
        const activeTiers: { threshold: number; floor: number }[] = [];
        
        if (settings.trailingTiers && settings.trailingTiers.length > 0) {
            activeTiers.push(...settings.trailingTiers);
        } else if (settings.trailingTriggerProfit !== undefined && settings.trailingRemainingProfit !== undefined) {
            activeTiers.push({
                threshold: settings.trailingTriggerProfit,
                floor: settings.trailingRemainingProfit
            });
        }

        // Find the highest tier that has been reached (maxPnl >= tier.threshold)
        let activeTier: { threshold: number; floor: number } | null = null;
        for (const tier of activeTiers) {
            if (maxPnl >= tier.threshold) {
                if (!activeTier || tier.threshold > activeTier.threshold) {
                    activeTier = tier;
                }
            }
        }

        if (activeTier) {
            if (currentPnl <= activeTier.floor) {
                close(
                    position.symbol, 
                    position.side, 
                    `常规阶梯托底平仓触发: 最高盈利达到 ${maxPnl.toFixed(2)}% >= 阶梯阈值 ${activeTier.threshold.toFixed(2)}%，回调后当前盈利仅剩 ${currentPnl.toFixed(2)}% <= 托底底线 ${activeTier.floor.toFixed(2)}%`,
                    settings.closePercent || 100
                );
                return true;
            }
            
            // 关键修复：一旦进入常规托底保护，常规的回撤止盈（Drawdown Callback）应当被屏蔽/接管，
            // 否则常规的 callbackPercent (通常很小) 会抢在托底底线之前触发平仓，使得托底平仓逻辑失效！
            return false;
        }
    }

    // 2. 门槛检查：是否达到激活止盈的最低收益率
    if (maxPnl < settings.profitPercent) return false;

    // 3. 回撤检查
    const drawdown = maxPnl - currentPnl;
    const effectiveCallback = (settings.closePercent && settings.closePercent < 100 && settings.callbackPercent === 0) ? 0.01 : settings.callbackPercent;
    
    if (drawdown >= effectiveCallback) {
        close(
            position.symbol, 
            position.side, 
            `常规止盈触发: 收益 ${currentPnl.toFixed(2)}% (最高 ${maxPnl.toFixed(2)}%, 回撤 ${drawdown.toFixed(2)}% >= ${effectiveCallback}%)`,
            settings.closePercent || 100
        );
        return true;
    }

    return false;
}
