// 🔒 LOCKED_MODULE: 模块 1 [常规止盈 / 多组阶梯式托底平仓规则]
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
        // Build active tiers to evaluate
        const activeTiers: { threshold: number; floor: number }[] = [];
        
        // 1.1 多组阶梯式托底 (优先使用多组阶梯配置)
        const customTiers = Array.isArray(settings.trailingTiers) ? settings.trailingTiers : [];
        const validCustomTiers = customTiers.filter(
            t => t && !isNaN(Number(t.threshold)) && !isNaN(Number(t.floor)) && Number(t.threshold) > 0
        );

        if (validCustomTiers.length > 0) {
            for (const t of validCustomTiers) {
                activeTiers.push({ 
                    threshold: Number(t.threshold), 
                    floor: Number(t.floor) 
                });
            }
        } else {
            // 1.2 单组默认托底 (备用：仅在未配置多组阶梯时生效)
            const defaultTrigger = !isNaN(Number(settings.trailingTriggerProfit))
                ? Number(settings.trailingTriggerProfit) 
                : 5;
            const defaultFloor = !isNaN(Number(settings.trailingRemainingProfit))
                ? Number(settings.trailingRemainingProfit) 
                : 2;
            
            if (defaultTrigger > 0) {
                activeTiers.push({
                    threshold: defaultTrigger,
                    floor: defaultFloor
                });
            }
        }

        // 寻找历史最高盈利所达到的最高阶梯 (maxPnl >= tier.threshold)
        let activeTier: { threshold: number; floor: number } | null = null;
        for (const tier of activeTiers) {
            if (maxPnl >= tier.threshold) {
                if (!activeTier || tier.threshold > activeTier.threshold) {
                    activeTier = tier;
                }
            }
        }

        if (activeTier) {
            // 当前盈利回撤跌破该阶梯的托底底线 (currentPnl <= activeTier.floor)
            if (currentPnl <= activeTier.floor) {
                close(
                    position.symbol, 
                    position.side, 
                    `常规托底平仓触发: 最高盈利曾达 ${maxPnl.toFixed(2)}% >= 阶梯阈值 ${activeTier.threshold.toFixed(2)}%，回撤后当前剩余盈利 ${currentPnl.toFixed(2)}% <= 托底底线 ${activeTier.floor.toFixed(2)}%`,
                    settings.closePercent || 100
                );
                return true;
            }
            
            // 一旦已进入托底阶梯保护范围，托底规则接管，防止普通回撤提前抢平
            return false;
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
