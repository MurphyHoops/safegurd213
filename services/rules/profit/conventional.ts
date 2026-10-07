// 🔒 LOCKED_MODULE: 模块 1 [多级阶梯式变量保底平仓 & 常规止盈规则]
// @LOCKED: 严格原子化锁定。未经用户明确下达的专属指令，严禁擅自触碰、修改、重构或变动任何算法与流转逻辑。

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
    if (!settings) return false;

    const currentPnl = position.unrealizedPnLPercentage || 0;
    // 实时更新并维持持仓的历史最高收益率
    const recordedMax = position.maxPnLPercent || 0;
    const maxPnl = Math.max(recordedMax, currentPnl);
    if (maxPnl > recordedMax) {
        position.maxPnLPercent = maxPnl;
    }
    const positionValue = (position.amount || 0) * (position.entryPrice || 0);

    // 1. 托底平仓检查 (Trailing floor profit protection - 最高优先级)
    const isTrailingActive = settings.trailingEnabled === true || String(settings.trailingEnabled) === 'true';
    if (isTrailingActive) {
        // 1.1 变量托底激活起征点检查
        const triggerThreshold = !isNaN(Number(settings.trailingTriggerProfit))
            ? Number(settings.trailingTriggerProfit)
            : 1;

        if (maxPnl >= triggerThreshold) {
            const DEFAULT_VARIABLE_TIERS = [
                { minProfit: triggerThreshold, maxProfit: 10, retentionPercent: 30 },
                { minProfit: 10, maxProfit: 30, retentionPercent: 33 },
                { minProfit: 30, maxProfit: 50, retentionPercent: 35 },
                { minProfit: 50, maxProfit: 70, retentionPercent: 40 },
                { minProfit: 70, maxProfit: 100, retentionPercent: 45 },
                { minProfit: 100, maxProfit: 150, retentionPercent: 50 },
                { minProfit: 150, maxProfit: 250, retentionPercent: 55 },
                { minProfit: 250, maxProfit: 400, retentionPercent: 60 },
                { minProfit: 400, maxProfit: 600, retentionPercent: 65 },
                { minProfit: 600, maxProfit: 900, retentionPercent: 70 },
                { minProfit: 900, maxProfit: 3000, retentionPercent: 75 }
            ];

            const rawTiers = Array.isArray(settings.variableTrailingTiers) && settings.variableTrailingTiers.length > 0
                ? settings.variableTrailingTiers
                : DEFAULT_VARIABLE_TIERS;

            const validTiers = rawTiers
                .filter(t => t && !isNaN(Number(t.minProfit)) && !isNaN(Number(t.retentionPercent)))
                .map(t => ({
                    minProfit: Number(t.minProfit),
                    maxProfit: !isNaN(Number(t.maxProfit)) && Number(t.maxProfit) > 0 ? Number(t.maxProfit) : Infinity,
                    retentionPercent: Number(t.retentionPercent)
                }))
                .sort((a, b) => a.minProfit - b.minProfit);

            // 匹配最高盈利所落入的阶梯区间
            let matchedTier = validTiers.find(t => maxPnl >= t.minProfit && maxPnl < t.maxProfit);
            if (!matchedTier && validTiers.length > 0) {
                const highestTier = validTiers[validTiers.length - 1];
                if (maxPnl >= highestTier.minProfit) {
                    matchedTier = highestTier;
                }
            }

            if (matchedTier) {
                // 动态托底线 = 最高盈利 * 保底留存百分比
                const dynamicFloor = (maxPnl * matchedTier.retentionPercent) / 100;

                if (currentPnl <= dynamicFloor) {
                    close(
                        position.symbol, 
                        position.side, 
                        `变量阶梯托底平仓触发: 最高盈利曾达 ${maxPnl.toFixed(2)}% (匹配区间 [${matchedTier.minProfit}%~${matchedTier.maxProfit === Infinity ? '∞' : matchedTier.maxProfit}%] 留存 ${matchedTier.retentionPercent}%)，回撤后当前剩余盈利 ${currentPnl.toFixed(2)}% <= 变量托底线 ${dynamicFloor.toFixed(2)}%`,
                        settings.closePercent || 100
                    );
                    return true;
                }

                // 变量托底已激活接管，防止普通回撤规则提前抢平
                return false;
            }
        }
    }

    // 0. 门槛检查：持仓金额 (仅对常规固定百分比止盈生效)
    const minPos = Math.max(0, settings.minPosition || 0);
    if (minPos > 0 && positionValue < minPos) return false;

    // 2. 门槛检查：是否达到激活常规止盈的最低收益率
    if (settings.profitPercent !== undefined && settings.profitPercent > 0) {
        if (maxPnl < settings.profitPercent) return false;

        // 3. 回撤检查
        const drawdown = maxPnl - currentPnl;
        const effectiveCallback = (settings.closePercent && settings.closePercent < 100 && settings.callbackPercent === 0) ? 0.01 : (settings.callbackPercent || 1);
        
        if (drawdown >= effectiveCallback) {
            close(
                position.symbol, 
                position.side, 
                `常规止盈触发: 收益 ${currentPnl.toFixed(2)}% (最高 ${maxPnl.toFixed(2)}%, 回撤 ${drawdown.toFixed(2)}% >= ${effectiveCallback}%)`,
                settings.closePercent || 100
            );
            return true;
        }
    }

    return false;
}
