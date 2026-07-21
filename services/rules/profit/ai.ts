import { Position, ProfitSettings, PositionSide } from '../../../types';
import { checkConventionalProfit } from './conventional';

/**
 * AI 智能止盈 (AI Oracle / Single-Coin Smart TP)
 * 逻辑：
 * 1. 针对一个币，检测是否开启了单币智能 / AI 止盈。
 * 2. 如果开启，当收益率 (maxPnl) 达到 activationProfitPercent (启动阈值，例如由设置确定的 3.5% 或 5%) 时，自动启动 AI 独立波段追踪算法。
 * 3. 一旦启动 AI 追踪算法：
 *    - 实时解析币种的涨跌动能、波动率(ATR/Volatility)及多个量价指标，自适应调整触发回调的允许值 (Allowed Drawdown)，以追求最大化利润！
 *    - 如果收益率回落并低于 fallbackProfitPercent (退回常规阈值，例如 1%)，则“恢复常规平仓” (调用 checkConventionalProfit 结合 conventional 配置执行常规或基础监控)。
 * 4. 如果没有开启或未满足启动门槛，则可以直接执行常规止盈检测以获得基础防护。
 */
/**
 * 获取 AI 智能开启的真实百分比阈值
 */
export function getAiActivationThreshold(aiSettings: any): number {
    if (!aiSettings) return 3.5;
    if (aiSettings.activationProfitPercent !== undefined && aiSettings.activationProfitPercent !== null) {
        return aiSettings.activationProfitPercent;
    }
    if (aiSettings.activationProfit !== undefined && aiSettings.activationProfit !== null) {
        const val = aiSettings.activationProfit;
        // 如果是出厂默认值 60，我们映射为 6.0% (十倍关系)
        if (val === 60) {
            return 6.0;
        }
        return val;
    }
    return 3.5;
}

/**
 * 检查阶梯保底锁定
 */
function checkStepBasedProfit(
    position: Position,
    settings: any, // Using any due to AiProfitSettings not being imported in this file scope if not fully defined in types.ts context
    close: (symbol: string, side: PositionSide, reason: string, ratio: number) => void
): boolean {
    if (!settings.stepBasedLockEnabled || !settings.steps || settings.steps.length === 0) {
        return false;
    }

    const currentPnl = position.unrealizedPnLPercentage;
    // Sort steps by threshold descending
    const sortedSteps = [...settings.steps].sort((a: any, b: any) => b.threshold - a.threshold);

    // Find the step corresponding to the current pnl drop
    for (const step of sortedSteps) {
        if (currentPnl <= step.threshold) {
             // Trigger close based on this step
             close(
                position.symbol,
                position.side,
                `AI 阶梯保底平仓: 利润 ${currentPnl.toFixed(2)}% 低于阶梯阈值 ${step.threshold}%，触发保底锁定`,
                100
             );
             return true;
        }
    }
    return false;
}

export function checkAiProfit(
    position: Position,
    profitSettings: ProfitSettings,
    close: (symbol: string, side: PositionSide, reason: string, ratio: number) => void,
    isMasterEnabled: boolean = true
): boolean {
    // If the global AI Smart Profit master switch is turned off, fall back immediately to conventional rules
    if (!isMasterEnabled) {
        return checkConventionalProfit(position, profitSettings.conventional, close);
    }

    const settings = profitSettings.ai || { 
        sensitivity: 5, 
        aggressiveness: 5, 
        minPosition: 100, 
        activationProfit: 60,
        aiSmartModeEnabled: true,
        activationProfitPercent: 3.5,
        fallbackProfitPercent: 1.0,
        atrMultiplier: 2.5,
        momentumWeight: 5,
        volResonance: 6
    };

    const maxPnl = position.maxPnLPercent || 0;
    const currentPnl = position.unrealizedPnLPercentage;
    const positionValue = position.amount * position.entryPrice;
    const indicators = position.currentIndicators || { rsi: 50, deviation: 0, volumeSwell: 1, volatility: 2, atr: 1 };

    // 0. 门槛检查
    if (positionValue < settings.minPosition) return false;

    // 1. 单币智能或 AI 启动控制
    const useSmartAI = settings.aiSmartModeEnabled ?? true; 
    if (!useSmartAI) {
        return checkConventionalProfit(position, profitSettings.conventional, close);
    }
    const actThreshold = getAiActivationThreshold(settings);
    const fallbackThreshold = settings.fallbackProfitPercent ?? 1.0;

    // 如果未达到 AI 智能启动盈利阈值，或者当前盈利已经跌破退回常规平仓阈值
    if (maxPnl < actThreshold) {
        // 未达 AI 门槛 -> 恢复/执行常规平仓逻辑
        return checkConventionalProfit(position, profitSettings.conventional, close);
    }
    
    // --- 新增：阶梯保底锁定逻辑 ---
    if (currentPnl < actThreshold && settings.stepBasedLockEnabled) {
         if (checkStepBasedProfit(position, settings, close)) return true;
    }
    // -----------------------------

    if (currentPnl < fallbackThreshold) {
        // 盈利低于退回常规阀值 -> 恢复常规平仓逻辑
        return checkConventionalProfit(position, profitSettings.conventional, close);
    }

    // 2. 核心 AI 多指标自适应参数匹配引擎 — 实现利润最大化逃顶
    // - 根据这个币的涨跌幅、ATR、RSI等多个指标，自适应得出允许的回撤比例 allowedDrawdown
    // (a) ATR波幅因素：允许的回撤因波动幅度而定。ATR 越高允许波动空间越宽，避免在暴涨主升浪中由于震荡被洗下车。
    const baseAtrMult = settings.atrMultiplier ?? 2.5;
    const currentVol = indicators.volatility || 2.0; 
    // 自适应系数计算
    let allowedDrawdown = 1.0; 
    
    // 基于 ATR/波动率进行宽窄自适应
    const atrFactor = Math.max(0.5, Math.min(4.0, currentVol * baseAtrMult / 5)); // 浮动范围 0.5% ~ 4.0%
    allowedDrawdown = atrFactor;

    // (b) 涨跌幅动能因子：如果乖离率偏差 (deviation) 极高，表明已经严重超买/超卖，呈抛物线拉升，应锁定大部分利润，收紧回撤宽度。
    const deviation = Math.abs(indicators.deviation || 0);
    const momentumWeight = settings.momentumWeight ?? 5;
    if (deviation > 5) {
        // deviation 越高，收紧系数越强烈 (动能衰竭预判)
        const squeeze = Math.max(0.4, 1.0 - (deviation * momentumWeight / 80));
        allowedDrawdown *= squeeze;
    }

    // (c) 多指标微调（RSI & 量价共振因子）
    const rsi = indicators.rsi || 50;
    const volSwell = indicators.volumeSwell || 1.0;
    const volResonance = settings.volResonance ?? 6;

    // 多单 RSI 超买且放量滞涨，极速收紧回撤
    if (position.side === PositionSide.LONG && rsi > 70) {
        allowedDrawdown *= 0.8;
    }
    // 空单 RSI 超卖
    if (position.side === PositionSide.SHORT && rsi < 30) {
        allowedDrawdown *= 0.8;
    }

    // 量比异常激增 (可能为主力出货/天量见顶)，自适应收紧
    if (volSwell > 2.0) {
        const volSqueeze = Math.max(0.5, 1.0 - (volSwell * volResonance / 30));
        allowedDrawdown *= volSqueeze;
    }

    // 确保最小回撤宽度不低于 0.2%，避免由于细微杂波误触
    allowedDrawdown = Math.max(0.2, allowedDrawdown);

    // 3. 动态触发检测
    const currentDrawdown = maxPnl - currentPnl;
    if (currentDrawdown >= allowedDrawdown) {
        const indicatorsSummary = `RSI: ${rsi.toFixed(1)}, 偏离度: ${deviation.toFixed(2)}%, 量比: ${volSwell.toFixed(1)}, ATR波动: ${currentVol.toFixed(1)}`;
        close(
            position.symbol, 
            position.side, 
            `AI 智能逃顶: ${position.symbol} 自适应回撤阈值 ${allowedDrawdown.toFixed(2)}% 被触发 (指标: ${indicatorsSummary})，最大可能锁定利润`, 
            100
        );
        return true;
    }

    return false;
}
