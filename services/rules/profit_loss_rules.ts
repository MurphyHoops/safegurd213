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
    // 但如果只是有历史对冲记录且当前已解套（isHedged 为 false），或已标记为主仓续航（isUnshackled），则允许止盈止损继续工作
    if ((position.isHedged && !position.isUnshackled) || position.mainPositionId) {
        return false;
    }

    // 动态融合单币自定义托管与全局通用风控设置，确保未明确自定义的项目以及全局禁用能够优雅继承和 fallback
    const profitSettings = position.customProfitSettings 
        ? {
            ...settings.profit,
            ...position.customProfitSettings,
            conventional: position.customProfitSettings.conventional && (position.customProfitSettings.profitMode === 'CONVENTIONAL' || position.customProfitSettings.oEnabledMap?.['CONVENTIONAL'])
                ? { ...settings.profit.conventional, ...position.customProfitSettings.conventional }
                : settings.profit.conventional,
            atr: position.customProfitSettings.atr && (position.customProfitSettings.profitMode === 'ATR' || position.customProfitSettings.oEnabledMap?.['ATR'])
                ? { ...settings.profit.atr, ...position.customProfitSettings.atr }
                : settings.profit.atr,
            smart: position.customProfitSettings.smart && (position.customProfitSettings.profitMode === 'SMART' || position.customProfitSettings.oEnabledMap?.['SMART'])
                ? { ...settings.profit.smart, ...position.customProfitSettings.smart }
                : settings.profit.smart,
            ai: position.customProfitSettings.ai && (position.customProfitSettings.profitMode === 'AI' || position.customProfitSettings.oEnabledMap?.['AI'])
                ? { ...settings.profit.ai, ...position.customProfitSettings.ai }
                : settings.profit.ai,
            stopLoss: position.customProfitSettings.stopLoss
                ? { ...settings.profit.stopLoss, ...position.customProfitSettings.stopLoss }
                : settings.profit.stopLoss,
            oEnabledMap: position.customProfitSettings.oEnabledMap || settings.profit.oEnabledMap || {}
          }
        : settings.profit;

    const pnlPercent = position.unrealizedPnLPercentage; // 例如 5.5 表示 5.5%
    const positionValue = position.amount * position.entryPrice;
    
    // 0. 基础止损 (Stop Loss) - 优先级最高 (始终并联运行)
    const slSettings = profitSettings.stopLoss || settings.profit.stopLoss || { enabled: false, minPosition: 100, lossPercent: 5, closePercent: 100 };
    if (slSettings.enabled && !(position as any)._slTriggered) {
        // 门槛检查：持仓金额是否达到止损激活门槛
        if (positionValue >= slSettings.minPosition) {
            // 止损通常是负数比较，例如 pnlPercent (-10) <= -lossPercent (-5)
            if (pnlPercent <= -Math.abs(slSettings.lossPercent)) {
                closePosition(
                    position.symbol, 
                    position.side, 
                    `基础止损触发: 当前 ${pnlPercent.toFixed(2)}% <= 阈值 -${slSettings.lossPercent}%`,
                    slSettings.closePercent || 100
                );
                return true;
            }
        }
    }

    // 如果全局止盈平仓主目录已关闭，或单币止盈托管未开启，则跳过
    if (!settings.profit.enabled || !profitSettings.enabled) return false;

    // --- 核心优化：确保“常规，趋势，智能，全局，AI”这些功能只要选择了，完全并联运行，不进行任何排他性拦截 ---
    // 已经彻底删除以往 AI 启动后直接拦截其他所有模式的逻辑，使所有勾选或并联的平仓条件拥有平等的平仓触发权
    const isAiMasterEnabled = settings?.profit?.aiSmartMasterEnabled ?? true;
    const isAiActive = profitSettings.profitMode === 'AI' || (profitSettings.oEnabledMap && profitSettings.oEnabledMap['AI'] === true);
    const aiSettings = profitSettings.ai || settings.profit.ai || { activationProfitPercent: 3.5, fallbackProfitPercent: 1.0, aiSmartModeEnabled: true };
    const actThreshold = getAiActivationThreshold(aiSettings);
    const maxPnl = position.maxPnLPercent || 0;

    // --- 核心逻辑：支持多模式并联运行 ---
    // 1. 检查主模式 (Tab 选中的模式)
    let triggered = false;
    switch (profitSettings.profitMode) {
        case 'CONVENTIONAL':
            triggered = checkConventionalProfit(position, profitSettings.conventional || settings.profit.conventional, closePosition);
            break;
        case 'SMART':
            triggered = checkSmartProfit(position, profitSettings.smart || settings.profit.smart, closePosition);
            break;
        case 'ATR':
             triggered = checkAtrProfit(position, profitSettings.atr || settings.profit.atr || { multiplier: 3, volatilityPercent: 1, chandelierEnabled: false, emaEnabled: false, emaPeriod: 80, emaTimeframe: 'AUTO' }, closePosition);
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
        if (checkConventionalProfit(position, profitSettings.conventional || settings.profit.conventional, closePosition)) return true;
    }
    
    // 检查趋势(ATR)并联
    if (profitSettings.profitMode !== 'ATR' && oEnabledMap['ATR']) {
        if (checkAtrProfit(position, profitSettings.atr || settings.profit.atr || { multiplier: 3, volatilityPercent: 1, chandelierEnabled: false, emaEnabled: false, emaPeriod: 80, emaTimeframe: 'AUTO' }, closePosition)) return true;
    }

    // 检查智能并联
    if (profitSettings.profitMode !== 'SMART' && oEnabledMap['SMART']) {
        if (checkSmartProfit(position, profitSettings.smart || settings.profit.smart, closePosition)) return true;
    }

    // 检查AI并联
    if (profitSettings.profitMode !== 'AI' && oEnabledMap['AI']) {
        if (checkAiProfit(position, profitSettings, closePosition, settings?.profit?.aiSmartMasterEnabled ?? true)) return true;
    }

    return false;
}
