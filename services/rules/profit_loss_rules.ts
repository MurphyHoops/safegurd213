import { Position, AppSettings, PositionSide } from '../../types';
import { checkConventionalProfit } from './profit/conventional';
import { checkSmartProfit } from './profit/smart';
import { checkAtrProfit } from './profit/atr';
import { checkAiProfit, getAiActivationThreshold } from './profit/ai';
export { checkGlobalRules } from './profit/global';

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

    const profitSettings = position.customProfitSettings || settings.profit;
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

    // --- 优先检查：如果启用了全局/单币AI智能平仓，且该币种最高利润达到了AI启动阈值，强制走AI智能逃顶逻辑 ---
    const isAiMasterEnabled = settings?.profit?.aiSmartMasterEnabled ?? true;
    const isAiActive = profitSettings.profitMode === 'AI' || (profitSettings.oEnabledMap && profitSettings.oEnabledMap['AI'] === true);
    const aiSettings = profitSettings.ai || { activationProfitPercent: 3.5, fallbackProfitPercent: 1.0, aiSmartModeEnabled: true };
    const actThreshold = getAiActivationThreshold(aiSettings);
    const maxPnl = position.maxPnLPercent || 0;

    if (isAiMasterEnabled && isAiActive && maxPnl >= actThreshold) {
        if (checkAiProfit(position, profitSettings, closePosition, true)) {
            return true;
        }
        // 被 AI 智能接管监控中，暂时拦截其他低级常规触发
        return false;
    }

    // --- 核心逻辑：支持多模式并联运行 ---
    // 1. 检查主模式 (Tab 选中的模式)
    let triggered = false;
    switch (profitSettings.profitMode) {
        case 'CONVENTIONAL':
            triggered = checkConventionalProfit(position, profitSettings.conventional, closePosition);
            break;
        case 'SMART':
            triggered = checkSmartProfit(position, profitSettings.smart, closePosition);
            break;
        case 'ATR':
             triggered = checkAtrProfit(position, profitSettings.atr || { multiplier: 3, volatilityPercent: 1, chandelierEnabled: true, emaEnabled: false, emaPeriod: 80, emaTimeframe: 'AUTO' }, closePosition);
             break;
        case 'AI':
             triggered = checkAiProfit(position, profitSettings, closePosition, settings?.profit?.aiSmartMasterEnabled ?? true);
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
        if (checkAtrProfit(position, profitSettings.atr || { multiplier: 3, volatilityPercent: 1, chandelierEnabled: true, emaEnabled: false, emaPeriod: 80, emaTimeframe: 'AUTO' }, closePosition)) return true;
    }

    // 检查智能并联
    if (profitSettings.profitMode !== 'SMART' && oEnabledMap['SMART']) {
        if (checkSmartProfit(position, profitSettings.smart, closePosition)) return true;
    }

    // 检查AI并联
    if (profitSettings.profitMode !== 'AI' && oEnabledMap['AI']) {
        if (checkAiProfit(position, profitSettings, closePosition, settings?.profit?.aiSmartMasterEnabled ?? true)) return true;
    }

    return false;
}
