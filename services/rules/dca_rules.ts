/**
 * @file services/rules/dca_rules.ts
 * @description 智能补仓 / DCA (Martingale) 策略计算与风控门禁
 * @status STRICTLY LOCKED - ATOMIC MODULE
 */

import { Position, AppSettings } from '../../types';

export interface DcaCheckResult {
    triggered: boolean;
    addAmountUsdt: number;
    reason: string;
    triggerMode?: string;
    triggerModeLabel?: string;
    signalDetail?: string;
    newEntryPrice?: number;
    callbackMet?: boolean;
}

/**
 * 校验指定持仓是否满足智能补仓条件
 */
export function checkDcaRules(
    position: Position,
    settings: AppSettings,
    currentPrice: number,
    klineData?: { high: number; low: number; close: number; open: number; extremeLow?: number; extremeHigh?: number; emaDetails?: Record<string, number> }
): DcaCheckResult {
    const cfg = settings.martingale;
    
    // 1. 开关校验：策略未开启直接返回
    if (!cfg || !cfg.enabled) {
        return { triggered: false, addAmountUsdt: 0, reason: '智能补仓策略未开启' };
    }

    // 2. 主仓位防护：仅主持仓支持补仓，对冲仓或已对冲仓位坚决不执行补仓
    if (position.isHedge || position.isHedged) {
        return { triggered: false, addAmountUsdt: 0, reason: '已进入对冲状态或属于对冲仓，暂停补仓' };
    }

    // 3. 次数限制校验
    const maxCount = cfg.maxCount ?? 2;
    const currentCount = position.dcaCount || 0;
    if (currentCount >= maxCount) {
        return { triggered: false, addAmountUsdt: 0, reason: `已达最大补仓次数限制 (${currentCount}/${maxCount})` };
    }

    // 4. 冷却时间校验 (允许 0 秒极速无冷却)
    const now = Date.now();
    const cooldownSec = (cfg.cooldownSeconds !== undefined && !isNaN(Number(cfg.cooldownSeconds))) ? Number(cfg.cooldownSeconds) : 30;
    const cooldownMs = cooldownSec * 1000;
    if (cooldownMs > 0 && position.lastDcaAt && (now - position.lastDcaAt) < cooldownMs) {
        const remainingSec = Math.ceil((cooldownMs - (now - position.lastDcaAt)) / 1000);
        return { triggered: false, addAmountUsdt: 0, reason: `补仓处于冷却保护中 (剩余 ${remainingSec} 秒)` };
    }

    // 5. 计算本次补仓额度 (以原始开仓USDT金额为基准，不计杠杆倍数，按 1倍, 2倍, 4倍, 8倍 指数递增)
    const initialQty = position.initialAmount !== undefined ? position.initialAmount : position.amount;
    const initialPrice = position.initialEntryPrice || position.entryPrice;
    const baseUsdtAmount = initialQty * initialPrice;

    // 基础比例 (默认 100%)
    const ratio = (cfg.ratioPercent ?? 100) / 100;

    // 按 2^currentCount 递增：第1次(currentCount=0) -> 1倍，第2次(currentCount=1) -> 2倍，第3次(currentCount=2) -> 4倍...
    const stepMultiplier = Math.pow(2, currentCount);
    const addAmountUsdt = baseUsdtAmount * ratio * stepMultiplier;

    // 6. 持仓总额上限校验 (USDT)
    const maxTotalUsdt = cfg.maxTotalUsdt ?? 500;
    const currentPositionUsdt = position.amount * currentPrice;
    if ((currentPositionUsdt + addAmountUsdt) > maxTotalUsdt) {
        return { triggered: false, addAmountUsdt: 0, reason: `补仓后总仓位将超出额度上限 [当前价值: $${currentPositionUsdt.toFixed(1)} + 补: $${addAmountUsdt.toFixed(1)} > 上限: $${maxTotalUsdt}]` };
    }

    // 6.1 持仓总量占可用余额%上限校验
    const maxPosBalancePct = cfg.maxPositionToBalancePercent ?? 80;
    if (maxPosBalancePct > 0) {
        const availBalance = (position as any).availableBalance || (settings as any).availableBalance || 0;
        if (availBalance > 0) {
            const totalPosAfterAdd = currentPositionUsdt + addAmountUsdt;
            const ratioPct = (totalPosAfterAdd / availBalance) * 100;
            if (ratioPct > maxPosBalancePct) {
                return { triggered: false, addAmountUsdt: 0, reason: `补仓后持仓总量占可用余额比例 (${ratioPct.toFixed(1)}%) 超出上限 (${maxPosBalancePct}%), 暂停补仓` };
            }
        }
    }

    // 判定做多/做空与价格偏离亏损百分比 (按真实价格变动百分比计算，严禁乘算杠杆)
    const isLong = position.side === 'LONG';
    const entryPrice = position.entryPrice;
    const priceLossPct = isLong 
        ? ((entryPrice - currentPrice) / entryPrice) * 100 
        : ((currentPrice - entryPrice) / entryPrice) * 100;

    // 7. 防爆对冲线安全距离隔离带 (防止临门一脚补仓冲突)
    if (settings.hedging?.enabled && settings.hedging?.triggerLossEnabled !== false) {
        const hedgeTriggerLoss = settings.hedging.triggerLossPercent || 15;
        const hedgeSafeDist = cfg.hedgeSafeDistancePercent ?? 1.0;
        
        // 计算当前亏损率 (按真实价格偏离绝对值，严禁杠杆放大)
        const currentLossPct = Math.max(0, priceLossPct);
        
        // 仅在明确开启对冲且亏损真正进入临近对冲隔离带时暂停补仓 [hedgeTriggerLoss - hedgeSafeDist, hedgeTriggerLoss]
        if (hedgeTriggerLoss > 0 && currentLossPct >= (hedgeTriggerLoss - hedgeSafeDist) && currentLossPct < hedgeTriggerLoss) {
            return { triggered: false, addAmountUsdt: 0, reason: `接近防爆对冲线 [当前浮亏 -${currentLossPct.toFixed(1)}%, 对冲线 -${hedgeTriggerLoss}%], 暂停补仓移交对冲守护` };
        }
    }

    // 8. 极端大阴/大阳波幅熔断校验
    if (klineData && cfg.circuitBreakerVolPercent) {
        const amplitudePct = Math.abs(((klineData.high - klineData.low) / klineData.low) * 100);
        if (amplitudePct >= cfg.circuitBreakerVolPercent) {
            return { triggered: false, addAmountUsdt: 0, reason: `极端波幅熔断触发 (单根振幅 ${amplitudePct.toFixed(1)}% ≥ 门槛 ${cfg.circuitBreakerVolPercent}%), 暂停补仓` };
        }
    }

    // 9. 判定补仓触发条件 (亏损% / 均线相交)
    const lossThresholdPct = cfg.triggerLossPercent ?? 2.0;
    const isLossMet = priceLossPct >= lossThresholdPct;

    // 均线相交判定
    let isEmaCrossMet = false;
    let isDivergenceMet = false;

    if (klineData && klineData.emaDetails) {
        const targetEmaKey = `ema${cfg.emaPeriod || 30}`;
        const emaValue = klineData.emaDetails[targetEmaKey] || klineData.emaDetails['ema30'];
        if (emaValue && emaValue > 0) {
            // 做多：价格自上而下跌穿/触及 EMA 均线
            // 做空：价格自下而上反弹/触及 EMA 均线
            if (isLong && currentPrice <= emaValue) {
                isEmaCrossMet = true;
            } else if (!isLong && currentPrice >= emaValue) {
                isEmaCrossMet = true;
            }
        }

        // EMA 10/20/30/40 均线二次发散形态判定
        const e10 = klineData.emaDetails['ema10'];
        const e20 = klineData.emaDetails['ema20'];
        const e30 = klineData.emaDetails['ema30'];
        const e40 = klineData.emaDetails['ema40'];
        if (e10 && e20 && e30 && e40) {
            if (isLong && e10 > e20 && e20 > e30 && e30 > e40) {
                isDivergenceMet = true;
            } else if (!isLong && e10 < e20 && e20 < e30 && e30 < e40) {
                isDivergenceMet = true;
            }
        }
    }

    // 组合逻辑判定
    const mode = cfg.triggerMode || 'LOSS_PCT';
    let triggerConditionMet = false;

    if (mode === 'LOSS_PCT') {
        triggerConditionMet = isLossMet;
    } else if (mode === 'EMA_CROSS') {
        triggerConditionMet = isEmaCrossMet;
    } else if (mode === 'DIVERGENCE') {
        triggerConditionMet = isDivergenceMet;
    } else if (mode === 'MIXED_OR') {
        triggerConditionMet = isLossMet || isEmaCrossMet || isDivergenceMet;
    } else if (mode === 'MIXED_AND') {
        triggerConditionMet = isLossMet && (isEmaCrossMet || isDivergenceMet);
    }

    if (!triggerConditionMet && !position.dcaExtremePrice && (!cfg.enableStepDca || !position.lastDcaPrice)) {
        // 既未满足触发条件，且当前没有处于极值/阶梯追踪状态，返回未满足
        const tfTag = position.signalTf ? ` [周期: ${position.signalTf}]` : '';
        return { 
            triggered: false, 
            addAmountUsdt: 0, 
            reason: `未达到补仓触发条件${tfTag} [浮亏偏离: ${priceLossPct.toFixed(2)}% / 目标: ${lossThresholdPct}%, 均线相交: ${isEmaCrossMet ? '已满足' : '未触及'}, 二次发散: ${isDivergenceMet ? '已确立' : '未发散'}]` 
        };
    }

    // 10. 回调 / 反弹确认机制 (自极值点或上次补仓点反弹/回调达到用户设置的 callbackPercent %)
    const callbackThreshold = (cfg.callbackPercent !== undefined && !isNaN(Number(cfg.callbackPercent))) 
        ? Number(cfg.callbackPercent) 
        : 1.0;

    // 防接飞刀极值确认开关 (默认 true 开启极值点反弹确认；显式设置为 false 时进入极速纯门槛模式)
    const isKnifeGuardEnabled = cfg.enableFallingKnifeGuard !== false;

    if (callbackThreshold > 0) {
        // 若价格已完全解套/回升至持仓均价之上，重置极值
        if (isLong && currentPrice >= entryPrice) {
            position.dcaExtremePrice = undefined;
            return {
                triggered: false,
                addAmountUsdt: 0,
                reason: `行情已回升至持仓均价之上 ($${currentPrice.toFixed(4)} ≥ $${entryPrice.toFixed(4)})，取消补仓极值锁定`
            };
        } else if (!isLong && currentPrice <= entryPrice) {
            position.dcaExtremePrice = undefined;
            return {
                triggered: false,
                addAmountUsdt: 0,
                reason: `行情已回调至持仓均价之下 ($${currentPrice.toFixed(4)} ≤ $${entryPrice.toFixed(4)})，取消补仓极值锁定`
            };
        }

        // 🛡️ 强制卡死补仓双门禁：无论何种模式，必须【浮亏值 ≥ 设定门槛】且【自极点/补仓价反弹回调值 ≥ 设定门槛 (如 1%)】
        let bouncePct = 0;
        let refPointLabel = "";

        if (isLong) {
            const hasDcaBefore = (position.dcaCount || 0) > 0 && position.lastDcaPrice !== undefined && position.lastDcaPrice > 0;

            if (!hasDcaBefore) {
                // 阶段 1：未补仓前，以开仓后最低极点 (dcaExtremePrice) 为起点计算反弹
                if (klineData?.extremeLow && klineData.extremeLow > 0) {
                    position.dcaExtremePrice = Math.min(position.dcaExtremePrice || currentPrice, klineData.extremeLow);
                }
                if (!position.dcaExtremePrice || currentPrice < position.dcaExtremePrice) {
                    position.dcaExtremePrice = currentPrice;
                    position.dcaExtremeTime = Date.now();
                }

                bouncePct = ((currentPrice - position.dcaExtremePrice) / position.dcaExtremePrice) * 100;
                refPointLabel = `最低极点 $${position.dcaExtremePrice.toFixed(4)}`;
            } else {
                // 阶段 2：已补仓后 (二次及多次补仓铁律：新极点 D 必须突破上一次极点 B，即 D < B)
                const lastPrice = position.lastDcaPrice!;
                const prevExtremeB = position.lastDcaExtremePrice || lastPrice;

                // 获取本轮 Tick 新候选极低点 D (结合 K 线极低与实时现价)
                const candidateLow = (klineData?.extremeLow && klineData.extremeLow > 0) 
                    ? Math.min(currentPrice, klineData.extremeLow) 
                    : currentPrice;

                // 核心突破规则校验：新极低点 candidateLow 必须严格下破上一次极点 prevExtremeB (D < B)
                if (candidateLow < prevExtremeB) {
                    if (!position.dcaExtremePrice || candidateLow < position.dcaExtremePrice) {
                        position.dcaExtremePrice = candidateLow;
                        position.dcaExtremeTime = Date.now();
                    }
                    bouncePct = ((currentPrice - position.dcaExtremePrice) / position.dcaExtremePrice) * 100;
                    refPointLabel = `突破上极点($${prevExtremeB.toFixed(4)})的新极低点 $${position.dcaExtremePrice.toFixed(4)}`;
                } else if (position.dcaExtremePrice && position.dcaExtremePrice < prevExtremeB) {
                    // 沿用已记录且已下破 B 的极低点计算反弹
                    bouncePct = ((currentPrice - position.dcaExtremePrice) / position.dcaExtremePrice) * 100;
                    refPointLabel = `突破上极点($${prevExtremeB.toFixed(4)})的新极低点 $${position.dcaExtremePrice.toFixed(4)}`;
                } else if (currentPrice > lastPrice) {
                    // 实时价格高于上次补仓点，按上次补仓点为基准计算阶梯追补反弹
                    bouncePct = ((currentPrice - lastPrice) / lastPrice) * 100;
                    refPointLabel = `上次补仓点 $${lastPrice.toFixed(4)}`;
                } else {
                    // 未成功下破上一次极点 B (D >= B)，不确认为有效极低点，阻止浅度误触发
                    bouncePct = 0;
                    refPointLabel = `新极点 $${candidateLow.toFixed(4)} 未突破上极点 $${prevExtremeB.toFixed(4)} (需 D < B)`;
                }
            }

            // 补仓条件 1：持仓浮亏率必须处于设定的亏损门禁（如 ≥ 2%）之上
            if (priceLossPct < lossThresholdPct) {
                return {
                    triggered: false,
                    addAmountUsdt: 0,
                    reason: `持仓浮亏 -${priceLossPct.toFixed(2)}% 未达亏损门禁 -${lossThresholdPct}%，暂停追加补仓`
                };
            }

            // 补仓条件 2 (硬锁死)：实时反弹幅度必须大于等于设定回调值 (如 ≥ 1%)
            if (bouncePct < callbackThreshold) {
                return { 
                    triggered: false, 
                    addAmountUsdt: 0, 
                    reason: `亏损达标但反弹未达门槛 [基准: ${refPointLabel}, 当前反弹: ${bouncePct.toFixed(2)}% < 目标回调: ${callbackThreshold}%]，绝对阻断补仓` 
                };
            }
        } else {
            // 做空情况：
            const hasDcaBefore = (position.dcaCount || 0) > 0 && position.lastDcaPrice !== undefined && position.lastDcaPrice > 0;

            if (!hasDcaBefore) {
                if (klineData?.extremeHigh && klineData.extremeHigh > 0) {
                    position.dcaExtremePrice = Math.max(position.dcaExtremePrice || currentPrice, klineData.extremeHigh);
                }
                if (!position.dcaExtremePrice || currentPrice > position.dcaExtremePrice) {
                    position.dcaExtremePrice = currentPrice;
                    position.dcaExtremeTime = Date.now();
                }

                bouncePct = ((position.dcaExtremePrice - currentPrice) / position.dcaExtremePrice) * 100;
                refPointLabel = `最高极点 $${position.dcaExtremePrice.toFixed(4)}`;
            } else {
                // 阶段 2：已补仓后 (二次及多次补仓铁律：新极点 D 必须突破上一次极点 B，即 D > B)
                const lastPrice = position.lastDcaPrice!;
                const prevExtremeB = position.lastDcaExtremePrice || lastPrice;

                // 获取本轮 Tick 新候选极高点 D (结合 K 线极高与实时现价)
                const candidateHigh = (klineData?.extremeHigh && klineData.extremeHigh > 0) 
                    ? Math.max(currentPrice, klineData.extremeHigh) 
                    : currentPrice;

                // 核心突破规则校验：新极高点 candidateHigh 必须严格上破上一次极点 prevExtremeB (D > B)
                if (candidateHigh > prevExtremeB) {
                    if (!position.dcaExtremePrice || candidateHigh > position.dcaExtremePrice) {
                        position.dcaExtremePrice = candidateHigh;
                        position.dcaExtremeTime = Date.now();
                    }
                    bouncePct = ((position.dcaExtremePrice - currentPrice) / position.dcaExtremePrice) * 100;
                    refPointLabel = `突破上极点($${prevExtremeB.toFixed(4)})的新极高点 $${position.dcaExtremePrice.toFixed(4)}`;
                } else if (position.dcaExtremePrice && position.dcaExtremePrice > prevExtremeB) {
                    // 沿用已记录且已上破 B 的极高点计算回调
                    bouncePct = ((position.dcaExtremePrice - currentPrice) / position.dcaExtremePrice) * 100;
                    refPointLabel = `突破上极点($${prevExtremeB.toFixed(4)})的新极高点 $${position.dcaExtremePrice.toFixed(4)}`;
                } else if (currentPrice < lastPrice) {
                    // 实时价格低于上次补仓点，按上次补仓点为基准计算阶梯追补回调
                    bouncePct = ((lastPrice - currentPrice) / lastPrice) * 100;
                    refPointLabel = `上次补仓点 $${lastPrice.toFixed(4)}`;
                } else {
                    // 未成功上破上一次极点 B (D <= B)，不确认为有效极高点，阻止浅度误触发
                    bouncePct = 0;
                    refPointLabel = `新极点 $${candidateHigh.toFixed(4)} 未突破上极点 $${prevExtremeB.toFixed(4)} (需 D > B)`;
                }
            }

            if (priceLossPct < lossThresholdPct) {
                return {
                    triggered: false,
                    addAmountUsdt: 0,
                    reason: `持仓浮亏 -${priceLossPct.toFixed(2)}% 未达亏损门禁 -${lossThresholdPct}%，暂停追加补仓`
                };
            }

            if (bouncePct < callbackThreshold) {
                return { 
                    triggered: false, 
                    addAmountUsdt: 0, 
                    reason: `亏损达标但回调未达门槛 [基准: ${refPointLabel}, 当前回调: ${bouncePct.toFixed(2)}% < 目标回调: ${callbackThreshold}%]，绝对阻断补仓` 
                };
            }
        }
    }

    // 满足条件准备触发补仓，更新上次实际补仓成交价与极值点，重置极值锁定供后续使用
    position.lastDcaPrice = currentPrice;
    position.lastDcaExtremePrice = position.dcaExtremePrice || currentPrice;
    position.dcaExtremePrice = undefined;

    // 11. 计算补仓后的加权平均持仓新均价
    const oldQty = position.amount;
    const oldUsdt = oldQty * entryPrice;
    const addQty = addAmountUsdt / currentPrice;
    const newQty = oldQty + addQty;
    const newEntryPrice = (oldUsdt + addAmountUsdt) / newQty;

    // 12. 构建详细的补仓原因与触发物理信号文本
    let modeLabel = '偏离亏损';
    let signalDetailStr = `偏离亏损 -${priceLossPct.toFixed(2)}% ≥ -${lossThresholdPct.toFixed(2)}% [均价: $${entryPrice.toFixed(4)}, 市价: $${currentPrice.toFixed(4)}]`;

    if (mode === 'EMA_CROSS') {
        modeLabel = 'EMA均线相交';
        const targetEmaKey = `ema${cfg.emaPeriod || 30}`;
        const emaVal = (klineData && klineData.emaDetails) ? (klineData.emaDetails[targetEmaKey] || klineData.emaDetails['ema30'] || 0) : 0;
        signalDetailStr = `市价 $${currentPrice.toFixed(4)} 穿透/触及 EMA${cfg.emaPeriod || 30} ($${emaVal.toFixed(4)})`;
    } else if (mode === 'DIVERGENCE') {
        modeLabel = 'EMA二次发散';
        signalDetailStr = `EMA10/20/30/40 确立${isLong ? '多头' : '空头'}二次发散开花 [市价: $${currentPrice.toFixed(4)}]`;
    } else if (mode === 'MIXED_OR') {
        modeLabel = '混合满足(OR)';
        const matched = [];
        if (isLossMet) matched.push(`亏损 -${priceLossPct.toFixed(2)}%`);
        if (isEmaCrossMet) matched.push(`触及EMA${cfg.emaPeriod || 30}`);
        if (isDivergenceMet) matched.push(`二次发散`);
        signalDetailStr = `满足信号: ${matched.join(' | ')}`;
    } else if (mode === 'MIXED_AND') {
        modeLabel = '混合严选(AND)';
        const matched = [];
        if (isLossMet) matched.push(`亏损 -${priceLossPct.toFixed(2)}%`);
        if (isEmaCrossMet) matched.push(`触及EMA${cfg.emaPeriod || 30}`);
        if (isDivergenceMet) matched.push(`二次发散`);
        signalDetailStr = `同时满足: ${matched.join(' & ')}`;
    }

    return {
        triggered: true,
        addAmountUsdt: Math.round(addAmountUsdt * 100) / 100,
        triggerMode: mode,
        triggerModeLabel: modeLabel,
        signalDetail: signalDetailStr,
        reason: `触发智能补仓 [第 ${currentCount + 1}/${maxCount} 次 | ${modeLabel}]: ${signalDetailStr} | 加仓: $${addAmountUsdt.toFixed(1)} USDT`,
        newEntryPrice
    };
}
