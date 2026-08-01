
import { Position, AppSettings, PositionSide } from '../../types';

/**
 * 检查单个持仓的对冲触发规则
 * 返回 true 表示触发了对冲开仓
 */
export function checkHedgingRules(
    position: Position,
    settings: AppSettings,
    openHedge: (symbol: string, side: PositionSide, amount: number, price: number, reason: string) => void
): boolean {
    const hedgeSettings = settings.hedging;
    
    // 1. 基础开关检查
    if (!hedgeSettings.enabled) return false;
    
    // 2. 已对冲检查
    if (position.isHedged) return false;
    
    // Define positionValue and entryValue for later use in hedging calculations
    const positionValue = position.amount * position.markPrice;
    const entryValue = position.amount * position.entryPrice;
    const minPositionThreshold = Number(hedgeSettings.minPosition ?? 10);

    // 4. 熔断检查 (Fuse Check)
    const slSettings = settings.stopLoss;
    if (slSettings.fuseEnabled) {
        const retryCount = position.hedgeRetries || 0; // 借用字段或新增
        if (retryCount >= Number(slSettings.maxHedgeRetries ?? 3)) {
            return false; // 熔断触发，停止对冲
        }
    }
    
    // 5. 并联触发条件检查 (All trigger conditions run in parallel, whichever is reached first triggers first)
    let conditionMet = false;
    let triggerReason = "";

    // A. 亏损比例检查
    const pnlPercent = position.unrealizedPnLPercentage;
    let lossHedgeTriggered = false;
    if (hedgeSettings.triggerLossEnabled !== false) {
        const triggerLossPercentValue = Number(hedgeSettings.triggerLossPercent ?? 1.0);
        if (pnlPercent <= -Math.abs(triggerLossPercentValue) + 0.001) {
            lossHedgeTriggered = true;
        }
    }

    // Combined Loss Limit Check (Shared for Trend Firewall and Break K-Line)
    let combinedLossLimitMet = true;
    if (hedgeSettings.combinedLossLimitEnabled && hedgeSettings.combinedLossLimitPercent !== undefined) {
        const combinedLossLimitValue = Number(hedgeSettings.combinedLossLimitPercent);
        if (pnlPercent > -Math.abs(combinedLossLimitValue)) {
            combinedLossLimitMet = false;
        }
    }

    // B. 趋势防火墙 (Trend Firewall)
    let trendHedgeTriggered = false;
    let firewallPrice = 0;
    let trendHedgePeriod = 80;
    if (combinedLossLimitMet && hedgeSettings.trendHedgeEnabled && position.entryEmas) {
        trendHedgePeriod = Number(hedgeSettings.trendHedgeEmaPeriod || 80);
        switch (trendHedgePeriod) {
            case 10: firewallPrice = position.entryEmas.ema10; break;
            case 20: firewallPrice = position.entryEmas.ema20; break;
            case 40: firewallPrice = position.entryEmas.ema40; break;
            case 80: firewallPrice = position.entryEmas.ema80; break;
            default: firewallPrice = position.entryEmas.ema80;
        }

        if (position.side === PositionSide.LONG) {
            if (position.markPrice <= firewallPrice) {
                 trendHedgeTriggered = true;
            }
        } else {
            if (position.markPrice >= firewallPrice) {
                 trendHedgeTriggered = true;
            }
        }
    }

    // C. 破位大K线 (Break K-Line)
    let breakKLineTriggered = false;
    let breakKLinePrice = 0;
    if (combinedLossLimitMet && hedgeSettings.breakKLineEnabled && position.signalCandle) {
        const signalHigh = position.signalCandle.high;
        const signalLow = position.signalCandle.low;
        const ratio = Number(hedgeSettings.breakKLineRatio ?? 20) / 100;
        const triggerDistanceAbsolute = (signalHigh - signalLow) * (1 + ratio);

        if (position.side === PositionSide.LONG) {
            breakKLinePrice = signalHigh - triggerDistanceAbsolute;
            if (position.markPrice <= breakKLinePrice) {
                 breakKLineTriggered = true;
            }
        } else {
            breakKLinePrice = signalLow + triggerDistanceAbsolute;
            if (position.markPrice >= breakKLinePrice) {
                 breakKLineTriggered = true;
            }
        }
    }

    // D. 300天极值比例对冲
    let extremeHedgeTriggered = false;
    if (hedgeSettings.extremeHedgeEnabled && position.extremeHedgeTriggerPrice !== undefined) {
        const extremeHedgeTriggerPriceValue = Number(position.extremeHedgeTriggerPrice);
        if (position.side === PositionSide.LONG) {
            if (position.markPrice <= extremeHedgeTriggerPriceValue) {
                 extremeHedgeTriggered = true;
            }
        } else {
            if (position.markPrice >= extremeHedgeTriggerPriceValue) {
                 extremeHedgeTriggered = true;
            }
        }
    }

    // Compile triggers and construct transparent reason representation
    const triggeredReasonsList: string[] = [];
    if (lossHedgeTriggered) {
        triggeredReasonsList.push(`亏损达到 ${hedgeSettings.triggerLossPercent}%`);
    }
    if (extremeHedgeTriggered && position.extremeHedgeTriggerPrice !== undefined) {
        triggeredReasonsList.push(`价格${position.side === PositionSide.LONG ? '跌破' : '突破'}300天极值对冲启动价 ${position.extremeHedgeTriggerPrice.toFixed(4)}`);
    }
    if (trendHedgeTriggered) {
        triggeredReasonsList.push(`价格${position.side === PositionSide.LONG ? '跌破' : '突破'} EMA${trendHedgePeriod} 防火墙`);
    }
    if (breakKLineTriggered) {
        triggeredReasonsList.push(`${position.side === PositionSide.LONG ? '跌破' : '突破'}信号K线振幅 ${hedgeSettings.breakKLineRatio}%`);
    }

    if (triggeredReasonsList.length > 0) {
        conditionMet = true;
        triggerReason = triggeredReasonsList.join(" | ");
    }

    // 如果没有任何触发条件满足，说明价格已经恢复到安全区域
    // 此时重置 extremePrice，以便下次跌入危险区域时能立即触发
    if (!conditionMet) {
        position.extremePrice = undefined;
        return false;
    }

    // 如果满足触发条件，检查是否突破了历史极值 (extremePrice)
    // 只有突破历史极值，或者没有历史极值时，才真正触发对冲
    let isWorseThanExtreme = true;
    
    // Skip historical extreme check if it's an extreme hedge trigger or if oscillationCheck is disabled
    if (hedgeSettings.extremeHedgeEnabled && (triggerReason.includes('极值') || extremeHedgeTriggered)) {
        isWorseThanExtreme = true;
    } else if (hedgeSettings.oscillationCheck !== true) {
        // If oscillation check is disabled, do not block hedging based on historical extreme price
        isWorseThanExtreme = true;
    } else if (position.extremePrice !== undefined) {
        if (position.side === PositionSide.LONG) {
            isWorseThanExtreme = position.markPrice < position.extremePrice;
        } else {
            isWorseThanExtreme = position.markPrice > position.extremePrice;
        }
    }

    if (isWorseThanExtreme) {
        if (position.extremePrice !== undefined && !triggerReason.includes('极值') && !extremeHedgeTriggered) {
            triggerReason += ` 且突破历史极值`;
        }
        
        // 触发对冲
        const hedgeSide = position.side === PositionSide.LONG ? PositionSide.SHORT : PositionSide.LONG;
        
        // Determine Hedge Ratio based on Rescue Strategy Priority
        let activeHedgeRatio = hedgeSettings.hedgeRatio; // Default from Module 2

        // Check if Module 3 strategies are active and override ratio
        const slSettings = settings.stopLoss;
        if (slSettings.hedgeProfitClear) {
            activeHedgeRatio = slSettings.hedgeOpenRatio; // Strategy 2 Override
        } else if (slSettings.callbackProfitClear) {
            activeHedgeRatio = slSettings.callbackHedgeRatio; // Strategy 3 Override
        }

        const hedgeAmount = positionValue * (activeHedgeRatio / 100);
        
        openHedge(
            position.symbol,
            hedgeSide,
            hedgeAmount,
            position.markPrice,
            triggerReason
        );
        
        return true;
    }
    
    return false;
}

/**
 * 检查防爆对冲模块的安全止损清仓规则
 * 这是一个兜底风控，当持仓触及设定的盈亏阈值时强制平仓
 */
export function checkSafeClearRules(
    position: Position,
    settings: AppSettings,
    closePosition: (symbol: string, side: PositionSide, reason: string) => void
): boolean {
    const hedgeSettings = settings.hedging;
    
    // 必须开启对冲模块总开关，且开启安全清仓开关
    if (!hedgeSettings.enabled || !hedgeSettings.safeClearEnabled) return false;

    const pnlPercent = position.unrealizedPnLPercentage;

    // 1. 安全止盈
    if (hedgeSettings.safeClearProfit > 0 && pnlPercent >= hedgeSettings.safeClearProfit) {
        closePosition(
            position.symbol, 
            position.side, 
            `🛡️防爆安全止盈: ${pnlPercent.toFixed(2)}% >= ${hedgeSettings.safeClearProfit}%`
        );
        return true;
    }

    // 2. 安全止损
    // 注意：pnlPercent 是负数，safeClearLoss 是正数
    if (hedgeSettings.safeClearLoss > 0 && pnlPercent <= -Math.abs(hedgeSettings.safeClearLoss)) {
        closePosition(
            position.symbol, 
            position.side, 
            `🛡️防爆安全止损: ${pnlPercent.toFixed(2)}% <= -${hedgeSettings.safeClearLoss}%`
        );
        return true;
    }

    return false;
}
