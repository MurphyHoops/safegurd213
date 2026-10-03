// 🔒 LOCKED_MODULE: 模块 1 [多维止盈止损 / 常规·趋势·智能·全局·AI·阶梯托底]
// @LOCKED: 严格原子化锁定。未经用户明确下达的专属书面指令，严禁擅自触碰、修改、重构或变动任何算法与流转逻辑。

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
    closePosition: (symbol: string, side: PositionSide, reason: string, ratio: number) => void,
    allPositions?: Position[]
): boolean {
    // 核心铁律：凡是启动了防爆对冲的交易对，’止盈止损‘平仓规则绝对物理失效！
    // 无论是否存在反向持仓、处于对冲状态、作为对冲从仓、或处于被砍仓待补仓状态，
    // 模块1的常规止盈止损功能 100% 物理失效，全部由防爆对冲救世策略接管，绝对严禁单平任何一方导致出现孤儿单！
    const hasOpposingInAll = Array.isArray(allPositions) && allPositions.some(p => 
        p.symbol && position.symbol &&
        p.symbol.replace(/USDT$/i, '').toUpperCase() === position.symbol.replace(/USDT$/i, '').toUpperCase() &&
        p.side !== position.side &&
        p.amount > 0.0001
    );

    if ((position.isHedged && !position.isUnshackled) || hasOpposingInAll || position.mainPositionId || position.isAmputated || (position.amputatedAmount || 0) > 0) {
        return false;
    }

    // 动态融合单币自定义托管与全局通用风控设置，确保未明确自定义的项目以及全局禁用能够优雅继承和 fallback
    const profitSettings = position.customProfitSettings 
        ? {
            ...settings.profit,
            ...position.customProfitSettings,
            enabled: position.customProfitSettings.enabled ?? settings.profit.enabled ?? true,
            conventional: {
                ...settings.profit.conventional,
                ...(position.customProfitSettings.conventional || {})
            },
            atr: {
                ...settings.profit.atr,
                ...(position.customProfitSettings.atr || {})
            },
            smart: {
                ...settings.profit.smart,
                ...(position.customProfitSettings.smart || {})
            },
            ai: {
                ...settings.profit.ai,
                ...(position.customProfitSettings.ai || {})
            },
            stopLoss: {
                ...settings.profit.stopLoss,
                ...(position.customProfitSettings.stopLoss || {})
            },
            oEnabledMap: position.customProfitSettings.oEnabledMap || settings.profit.oEnabledMap || {}
          }
        : settings.profit;

    const pnlPercent = position.unrealizedPnLPercentage || 0; // 例如 5.5 表示 5.5%
    const positionValue = (position.amount || 0) * (position.entryPrice || 0);
    
    // 0. 基础止损 (Stop Loss) - 优先级最高 (始终并联运行)
    const slSettings = profitSettings.stopLoss || settings.profit.stopLoss || { enabled: false, minPosition: 0, lossPercent: 5, closePercent: 100 };
    if (slSettings.enabled && !(position as any)._slTriggered) {
        // 门槛检查：持仓金额是否达到止损激活门槛 (若为 0 或未设门槛则直接放行)
        const minSlPos = Math.max(0, slSettings.minPosition || 0);
        if (minSlPos === 0 || positionValue >= minSlPos) {
            // 止损通常是负数比较，例如 pnlPercent (-10) <= -lossPercent (-5)
            const lossLimit = -Math.abs(slSettings.lossPercent || 5);
            if (pnlPercent <= lossLimit) {
                closePosition(
                    position.symbol, 
                    position.side, 
                    `基础止损触发: 当前 ${pnlPercent.toFixed(2)}% <= 阈值 ${lossLimit}%`,
                    slSettings.closePercent || 100
                );
                return true;
            }
        }
    }

    // 如果全局止盈平仓主目录已显式关闭，或单币止盈托管显式未开启，则跳过
    const isGlobalProfitEnabled = settings.profit?.enabled !== false;
    const isProfitEnabled = profitSettings?.enabled !== false;
    if (!isGlobalProfitEnabled || !isProfitEnabled) return false;

    // --- 核心优化：确保“常规、趋势、智能、AI”完全并联运行，只要处于开启状态，达到任意一个条件立即平仓 ---
    const oEnabledMap = profitSettings.oEnabledMap || {};

    // 1. 常规止盈检测 (常规止盈/托底平仓：开启托底、设置收益率、主选常规或并联开启)
    const conventionalCfg = profitSettings.conventional || settings.profit.conventional;
    const isConventionalActive = profitSettings.profitMode === 'CONVENTIONAL' || 
        !!oEnabledMap['CONVENTIONAL'] || 
        conventionalCfg?.trailingEnabled === true ||
        (conventionalCfg?.profitPercent !== undefined && conventionalCfg.profitPercent > 0);

    if (isConventionalActive && conventionalCfg) {
        if (checkConventionalProfit(position, conventionalCfg, closePosition)) return true;
    }

    // 2. 趋势 (ATR/均线) 止盈检测 (开启吊灯止盈、开启EMA平仓、主选趋势或并联开启)
    const atrCfg = profitSettings.atr || settings.profit.atr;
    const isAtrActive = profitSettings.profitMode === 'ATR' || 
        !!oEnabledMap['ATR'] || 
        atrCfg?.chandelierEnabled === true || 
        atrCfg?.emaEnabled === true;

    if (isAtrActive && atrCfg) {
        if (checkAtrProfit(position, atrCfg, closePosition)) return true;
    }

    // 3. 智能止盈检测 (智能止盈总开关开启、主选智能或并联开启)
    const smartCfg = profitSettings.smart || settings.profit.smart;
    const isSmartActive = profitSettings.profitMode === 'SMART' || 
        !!oEnabledMap['SMART'] || 
        smartCfg?.enabled === true;

    if (isSmartActive && smartCfg) {
        if (checkSmartProfit(position, smartCfg, closePosition)) return true;
    }

    // 4. AI 智能逃顶检测 (AI总开关开启、主选AI或并联开启)
    const aiCfg = profitSettings.ai || settings.profit.ai;
    const isAiActive = profitSettings.profitMode === 'AI' || 
        !!oEnabledMap['AI'] || 
        (aiCfg?.aiSmartModeEnabled === true);

    if (isAiActive && aiCfg) {
        if (checkAiProfit(position, profitSettings, closePosition, settings?.profit?.aiSmartMasterEnabled ?? true)) return true;
    }

    return false;
}
