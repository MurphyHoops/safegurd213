/**
 * @file services/rules/reopen_rules.ts
 * @description 单币平仓后循环复开 (Continuous Auto-Reopen) 校验与风控门禁
 * @status STRICTLY LOCKED - ATOMIC MODULE
 */

import { Position, AppSettings } from '../../types';
import { ActionConfig } from '../../components/Scanner/scannerTypes';

export interface ReopenCheckResult {
    eligible: boolean;
    reason: string;
    side?: 'LONG' | 'SHORT';
}

/**
 * 校验指定刚平仓的币种是否满足自动复开条件
 */
export function checkAutoReopenRules(
    closedPosition: Position,
    actionConfig: ActionConfig,
    settings: AppSettings,
    realPrice: number,
    klineDetails?: {
        peakHigh?: number;
        valleyLow?: number;
        ema80_1h?: number;
        ema200_1h?: number;
        ema80_4h?: number;
        ema80_15m?: number;
        longNDaysChangePct?: number;
        shortNDaysChangePct?: number;
    },
    consecutiveLossCount: number = 0
): ReopenCheckResult {
    // 1. 复开开关总控制
    if (!actionConfig || !actionConfig.autoReopenEnabled) {
        return { eligible: false, reason: '单币平仓后循环复开未开启' };
    }

    // 2. 仅限止盈平仓校验
    const takeProfitOnly = actionConfig.reopenTakeProfitOnly ?? true;
    const isPnLPositive = (closedPosition.unrealizedPnL || 0) >= 0 || (closedPosition.unrealizedPnLPercentage || 0) >= 0;
    const isTPReason = closedPosition.triggerReason?.includes('止盈') || closedPosition.triggerReason?.includes('TP') || isPnLPositive;
    
    if (takeProfitOnly && !isTPReason) {
        return { eligible: false, reason: '上一单非正常止盈平仓（止损/对冲/砍仓平仓），按风控铁律拦截复开' };
    }

    // 3. 连亏熔断校验
    const maxConsecutiveLosses = actionConfig.reopenMaxConsecutiveLosses ?? 2;
    if (consecutiveLossCount >= maxConsecutiveLosses) {
        return { eligible: false, reason: `该币种已连续亏损 ${consecutiveLossCount} 次 (≥ 熔断上限 ${maxConsecutiveLosses} 次)，锁定自动复开` };
    }

    // 4. 牛熊趋势门禁校验
    const bullBearFilter = actionConfig.reopenBullBearFilter ?? '1h_ema80';
    if (bullBearFilter !== 'OFF' && klineDetails) {
        let targetEma = 0;
        let filterName = '1h EMA80';

        if (bullBearFilter === '1h_ema80') {
            targetEma = klineDetails.ema80_1h || 0;
            filterName = '1h EMA80';
        } else if (bullBearFilter === '1h_ema200') {
            targetEma = klineDetails.ema200_1h || 0;
            filterName = '1h EMA200';
        } else if (bullBearFilter === '4h_ema80') {
            targetEma = klineDetails.ema80_4h || 0;
            filterName = '4h EMA80';
        } else if (bullBearFilter === '15m_ema80') {
            targetEma = klineDetails.ema80_15m || 0;
            filterName = '15m EMA80';
        }

        if (targetEma > 0) {
            const isLong = closedPosition.side === 'LONG';
            if (isLong && realPrice < targetEma) {
                return { eligible: false, reason: `牛熊门禁拦截: 价格 $${realPrice.toFixed(4)} 低于 ${filterName} ($${targetEma.toFixed(4)}), 识别为熊市/下跌回调, 暂停做多复开` };
            } else if (!isLong && realPrice > targetEma) {
                return { eligible: false, reason: `牛熊门禁拦截: 价格 $${realPrice.toFixed(4)} 高于 ${filterName} ($${targetEma.toFixed(4)}), 识别为牛市/反弹拉升, 暂停做空复开` };
            }
        }
    }

    // 5. 高点回调/低点反弹偏离熔断校验 (防追高)
    const pullbackLimitPct = actionConfig.reopenPullbackLimitPct ?? 3.0;
    if (pullbackLimitPct > 0 && klineDetails) {
        const isLong = closedPosition.side === 'LONG';
        if (isLong && klineDetails.peakHigh && klineDetails.peakHigh > 0) {
            const pullbackPct = ((klineDetails.peakHigh - realPrice) / klineDetails.peakHigh) * 100;
            if (pullbackPct >= pullbackLimitPct) {
                return { eligible: false, reason: `高点回调熔断拦截: 自高点 $${klineDetails.peakHigh.toFixed(4)} 回调 ${pullbackPct.toFixed(2)}% (≥ 门槛 ${pullbackLimitPct}%), 识别为顶部拐头, 暂停复开` };
            }
        } else if (!isLong && klineDetails.valleyLow && klineDetails.valleyLow > 0) {
            const bouncePct = ((realPrice - klineDetails.valleyLow) / klineDetails.valleyLow) * 100;
            if (bouncePct >= pullbackLimitPct) {
                return { eligible: false, reason: `低点反弹熔断拦截: 自低点 $${klineDetails.valleyLow.toFixed(4)} 反弹 ${bouncePct.toFixed(2)}% (≥ 门槛 ${pullbackLimitPct}%), 识别为底部反弹, 暂停做空复开` };
            }
        }
    }

    // 6. 做多 N天内上涨 % 不再复开
    const isLong = closedPosition.side === 'LONG';
    if (isLong && (actionConfig.reopenLongLimitEnabled ?? true)) {
        const longDays = actionConfig.reopenLongLimitDays ?? 3;
        const longPct = actionConfig.reopenLongLimitPct ?? 20;
        const actualLongPct = klineDetails?.longNDaysChangePct;
        if (actualLongPct !== undefined && actualLongPct >= longPct) {
            return {
                eligible: false,
                reason: `做多周期涨幅门禁拦截: 做多 ${longDays}天内上涨了 ${actualLongPct.toFixed(2)}% (≥ 限制 ${longPct}%), 暂停做多复开`
            };
        }
    }

    // 7. 做空 N天内下跌 % 不再复开
    if (!isLong && (actionConfig.reopenShortLimitEnabled ?? true)) {
        const shortDays = actionConfig.reopenShortLimitDays ?? 3;
        const shortPct = actionConfig.reopenShortLimitPct ?? 20;
        const actualShortPct = klineDetails?.shortNDaysChangePct;
        if (actualShortPct !== undefined && actualShortPct >= shortPct) {
            return {
                eligible: false,
                reason: `做空周期跌幅门禁拦截: 做空 ${shortDays}天内下跌了 ${actualShortPct.toFixed(2)}% (≥ 限制 ${shortPct}%), 暂停做空复开`
            };
        }
    }

    return {
        eligible: true,
        reason: `满足平仓复开所有护城河条件 [牛熊门禁: 放行, 偏离熔断: 放行, N天波幅门禁: 放行, 连亏未达限]`,
        side: closedPosition.side
    };
}
