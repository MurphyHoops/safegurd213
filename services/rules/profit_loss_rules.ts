import { Position, AppSettings, PositionSide, ConventionalSettings, DynamicSettings, SmartSettings, AtrSettings } from '../../types';

/**
 * 检查单个持仓的止盈止损规则
 * 返回 true 表示触发了平仓
 */
export function checkIndividualPositionRules(
    position: Position, 
    settings: AppSettings, 
    closePosition: (symbol: string, side: PositionSide, reason: string, ratio: number) => void
): boolean {
    // 核心修改：如果该仓位当前正处于对冲状态（作为主仓被对冲，或作为对冲仓），模块1的止盈止损功能失效
    // 但如果只是有历史对冲记录且当前已解套（isHedged 为 false），则允许止盈止损继续工作
    if (position.isHedged || position.mainPositionId) {
        return false;
    }

    const profitSettings = settings.profit;
    const pnlPercent = position.unrealizedPnLPercentage; // 例如 5.5 表示 5.5%
    const positionValue = position.amount * position.entryPrice;
    
    // 0. 基础止损 (Stop Loss) - 优先级最高 (始终并联运行)
    if (profitSettings.stopLoss.enabled && !(position as any)._slTriggered) {
        // 门槛检查：持仓金额是否达到止损激活门槛
        if (positionValue >= profitSettings.stopLoss.minPosition) {
            // 止损通常是负数比较，例如 pnlPercent (-10) <= -lossPercent (-5)
            if (pnlPercent <= -Math.abs(profitSettings.stopLoss.lossPercent)) {
                closePosition(
                    position.symbol, 
                    position.side, 
                    `基础止损触发: 当前 ${pnlPercent.toFixed(2)}% <= 阈值 -${profitSettings.stopLoss.lossPercent}%`,
                    profitSettings.stopLoss.closePercent || 100
                );
                return true;
            }
        }
    }

    // 如果止盈未开启，则跳过
    if (!profitSettings.enabled) return false;

    // --- 核心逻辑修改：支持多模式并联运行 ---
    // 1. 检查主模式 (Tab 选中的模式)
    let triggered = false;
    switch (profitSettings.profitMode) {
        case 'CONVENTIONAL':
            triggered = checkConventionalProfit(position, profitSettings.conventional, closePosition);
            break;
        case 'DYNAMIC':
            triggered = checkDynamicProfit(position, profitSettings.dynamic, closePosition);
            break;
        case 'SMART':
            triggered = checkSmartProfit(position, profitSettings.smart, closePosition);
            break;
        case 'ATR':
             triggered = checkAtrProfit(position, profitSettings.atr || { multiplier: 3, volatilityPercent: 1 }, closePosition);
             break;
    }
    if (triggered) return true;

    // 2. 检查所有开启了“橙色圆点”(O开关)的并联模式
    const oEnabledMap = profitSettings.oEnabledMap || {};
    
    // 检查常规并联
    if (profitSettings.profitMode !== 'CONVENTIONAL' && oEnabledMap['CONVENTIONAL']) {
        if (checkConventionalProfit(position, profitSettings.conventional, closePosition)) return true;
    }
    
    // 检查趋势(ATR)并联
    if (profitSettings.profitMode !== 'ATR' && oEnabledMap['ATR']) {
        if (checkAtrProfit(position, profitSettings.atr || { multiplier: 3, volatilityPercent: 1 }, closePosition)) return true;
    }

    // 检查动态并联
    if (profitSettings.profitMode !== 'DYNAMIC' && oEnabledMap['DYNAMIC']) {
        if (checkDynamicProfit(position, profitSettings.dynamic, closePosition)) return true;
    }

    // 检查智能并联
    if (profitSettings.profitMode !== 'SMART' && oEnabledMap['SMART']) {
        if (checkSmartProfit(position, profitSettings.smart, closePosition)) return true;
    }

    return false;
}

/**
 * 常规止盈 (Conventional)
 * 逻辑：当收益率超过 profitPercent 后，开始监控回撤。
 * 如果从最高点回撤超过 callbackPercent，则触发平仓。
 */
function checkConventionalProfit(
    position: Position, 
    settings: ConventionalSettings, 
    close: (symbol: string, side: PositionSide, reason: string, ratio: number) => void
): boolean {
    const maxPnl = position.maxPnLPercent || 0;
    const currentPnl = position.unrealizedPnLPercentage;
    const positionValue = position.amount * position.entryPrice;

    // 0. 门槛检查：持仓金额
    if (positionValue < settings.minPosition) return false;

    // 1. 门槛检查：是否达到激活止盈的最低收益率
    if (maxPnl < settings.profitPercent) return false;

    // 2. 回撤检查
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

/**
 * 动态止盈 (Dynamic)
 * 逻辑：支持多个阶梯 (Tiers)。
 */
function checkDynamicProfit(
    position: Position, 
    settings: DynamicSettings, 
    close: (symbol: string, side: PositionSide, reason: string, ratio: number) => void
): boolean {
    const maxPnl = position.maxPnLPercent || 0;
    const currentPnl = position.unrealizedPnLPercentage;
    const positionValue = position.amount * position.entryPrice;

    // 0. 门槛检查：持仓金额
    if (positionValue < settings.minPosition) return false;
    
    // 找到所有满足激活条件的阶梯，并按利润目标从大到小排序
    const tiers = Array.isArray(settings.tiers) ? settings.tiers : [];
    const sortedTiers = [...tiers].filter(t => t && typeof t === 'object').sort((a, b) => (b.profit || 0) - (a.profit || 0));

    for (const tier of sortedTiers) {
        // 检查是否达到该阶梯的激活利润
        if (maxPnl >= tier.profit) {
            // 检查回撤
            const drawdown = maxPnl - currentPnl;
            // 如果是部分平仓且回调设置为0，强制要求至少有微小的回撤(0.01%)，防止在同一秒内无限触发部分平仓
            const effectiveCallback = (tier.close && tier.close < 100 && tier.callback === 0) ? 0.01 : tier.callback;
            
            if (drawdown >= effectiveCallback) {
                close(
                    position.symbol, 
                    position.side, 
                    `动态止盈(阶梯${tier.profit}%): 最高 ${maxPnl.toFixed(2)}%, 回撤 ${drawdown.toFixed(2)}%`,
                    tier.close || 100
                );
                return true; 
            }
            return false; 
        }
    }

    return false;
}

/**
 * 智能止盈 (Smart)
 */
function checkSmartProfit(
    position: Position, 
    settings: SmartSettings, 
    close: (symbol: string, side: PositionSide, reason: string, ratio: number) => void
): boolean {
    const maxPnl = position.maxPnLPercent || 0;
    const currentPnl = position.unrealizedPnLPercentage;
    const positionValue = position.amount * position.entryPrice;
    const tiers = Array.isArray(settings.tiers) ? settings.tiers : [];

    // 0. 门槛检查：持仓金额
    if (positionValue < (settings.minPosition || 0)) {
        return false;
    }

    // 1. 检查是否达到启动盈利阈值 (智能模式接管)
    if (maxPnl >= settings.activationProfit) {
        // 2. 计算动态回调比例 (1 - maxPnl%)
        const effectiveMaxPnl = Math.min(maxPnl, 100); 
        const callbackRatio = 1 - (effectiveMaxPnl / 100); 
        
        // 3. 计算允许的最大回撤值
        const allowedDrawdown = maxPnl * callbackRatio;
        
        // 4. 计算当前实际回撤值
        const currentDrawdown = maxPnl - currentPnl;

        // 5. 判断是否触发平仓
        if (currentDrawdown >= allowedDrawdown) {
            close(
                position.symbol, 
                position.side, 
                `智能止盈: 最高盈利 ${maxPnl.toFixed(2)}%, 允许回调 ${allowedDrawdown.toFixed(2)}% (比例 ${(callbackRatio * 100).toFixed(2)}%), 实际盈利锁定在 ${currentPnl.toFixed(2)}%`,
                100 // 智能止盈通常全平
            );
            return true;
        }
    } 
    // 6. 如果未达到智能启动阈值，且开启了阶梯常规平仓功能
    else if (settings.conventionalEnabled && tiers.length > 0) {
        // A. 计算“阶梯保底线” (Safety Floor)
        let safetyFloor = -999;
        let floorReason = "";

        tiers.forEach((tier, idx) => {
            if (maxPnl >= tier.expiry) {
                const potentialFloor = tier.expiry - tier.callback;
                if (potentialFloor > safetyFloor) {
                    safetyFloor = potentialFloor;
                    floorReason = `曾突破阶梯${idx + 1}失效值 ${tier.expiry}%, 该阶梯回调 ${tier.callback}%, 保底锁定 ${potentialFloor.toFixed(2)}%`;
                }
            }
        });

        // B. 检查是否触碰保底线
        if (safetyFloor !== -999 && currentPnl <= safetyFloor) {
            close(
                position.symbol,
                position.side,
                `智能止盈(阶梯保底): 当前盈利 ${currentPnl.toFixed(2)}% <= ${floorReason}`,
                100
            );
            return true;
        }

        // C. 检查当前所属阶梯的常规回调
        const activeTier = tiers.find(tier => 
            maxPnl >= tier.threshold && maxPnl < tier.expiry
        );

        if (activeTier) {
            const drawdown = maxPnl - currentPnl;
            if (drawdown >= activeTier.callback) {
                close(
                    position.symbol, 
                    position.side, 
                    `智能止盈(常规阶梯): 最高盈利 ${maxPnl.toFixed(2)}%, 达到阶梯阈值 ${activeTier.threshold}%, 失效值 ${activeTier.expiry}%, 回调 ${activeTier.callback}%, 实际盈利锁定在 ${currentPnl.toFixed(2)}%`,
                    100
                );
                return true;
            }
        }
    }
    return false;
}

/**
 * ATR 止盈 (Mock ATR)
 * 逻辑：1 ATR ≈ 价格 × 波动率估算%。
 * 当价格从最高点回撤超过 (ATR × 倍数) 时平仓。
 */
function checkAtrProfit(
    position: Position, 
    settings: AtrSettings, 
    close: (symbol: string, side: PositionSide, reason: string, ratio: number) => void
): boolean {
    const maxPnl = position.maxPnLPercent || 0;
    const currentPnl = position.unrealizedPnLPercentage;

    // 1. 激活门槛：至少要有 0.5% 的利润才开始监控 ATR 回撤 (避免频繁触发)
    if (maxPnl < 0.5) return false;

    // 2. 计算回撤阈值 (百分比)
    // 根据 UI: 1 ATR ≈ 价格 × 波动率估算%
    // 所以回撤阈值 = 波动率估算% * 倍数
    const threshold = settings.volatilityPercent * settings.multiplier;

    // 3. 检查回撤
    const drawdown = maxPnl - currentPnl;
    if (drawdown >= threshold) {
        close(
            position.symbol, 
            position.side, 
            `ATR止盈触发: 最高 ${maxPnl.toFixed(2)}%, 回撤 ${drawdown.toFixed(2)}% (ATR阈值 ${threshold.toFixed(2)}%)`,
            100 // ATR 止盈通常全平
        );
        return true;
    }

    return false;
}

/**
 * 检查全局止盈止损规则
 */
export function checkGlobalRules(
    positions: Position[],
    account: { totalBalance: number, marginBalance: number }, // 注意：这里需要总余额信息
    settings: AppSettings,
    closeAll: (reason: string) => void
): boolean {
    const profitSettings = settings.profit;
    if (!profitSettings.enabled) return false;

    // 全局模式激活条件：主模式是 GLOBAL，或者并联开关 O 开启了 GLOBAL
    const isGlobalActive = profitSettings.profitMode === 'GLOBAL' || (profitSettings.oEnabledMap && profitSettings.oEnabledMap['GLOBAL']);
    if (!isGlobalActive) return false;

    const globalSettings = profitSettings.global;
    
    // 核心修改：全局止盈止损计算时，排除已启动防爆对冲的仓位（主仓和对冲仓）
    const unhedgedPositions = positions.filter(p => !p.isHedged && !p.mainPositionId);
    
    // 如果没有未对冲的仓位，则不触发全局止盈止损
    if (unhedgedPositions.length === 0) return false;

    // 计算未对冲持仓的总未实现盈亏
    const totalUnrealizedPnL = unhedgedPositions.reduce((sum, p) => sum + p.unrealizedPnL, 0);
    
    // 1. 全局止盈 (按金额)
    if (globalSettings.profitAmount > 0 && totalUnrealizedPnL >= globalSettings.profitAmount) {
        closeAll(`全局止盈触发: 总盈利 ${totalUnrealizedPnL.toFixed(2)} >= ${globalSettings.profitAmount}`);
        return true;
    }

    // 2. 全局止损 (按金额) - 注意 totalUnrealizedPnL 是负数
    if (globalSettings.lossAmount > 0 && totalUnrealizedPnL <= -globalSettings.lossAmount) {
        closeAll(`全局止损触发: 总亏损 ${totalUnrealizedPnL.toFixed(2)} <= -${globalSettings.lossAmount}`);
        return true;
    }

    // 3. 全局止盈 (按百分比 - 相对于余额)
    // 假设基准是 marginBalance (本金)
    if (account.marginBalance > 0) {
        const pnlPercent = (totalUnrealizedPnL / account.marginBalance) * 100;

        if (globalSettings.profitPercent > 0 && pnlPercent >= globalSettings.profitPercent) {
            closeAll(`全局止盈触发: 总盈率 ${pnlPercent.toFixed(2)}% >= ${globalSettings.profitPercent}%`);
            return true;
        }

        if (globalSettings.lossPercent > 0 && pnlPercent <= -globalSettings.lossPercent) {
            closeAll(`全局止损触发: 总亏率 ${pnlPercent.toFixed(2)}% <= -${globalSettings.lossPercent}%`);
            return true;
        }
    }

    return false;
}
