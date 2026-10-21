import { Position, SmartSettings, PositionSide } from '../../../types';
import { klineMultiTfStore } from '../../klineMultiTfStore';

/**
 * 智能止盈 (Smart)
 */
export function checkSmartProfit(
    position: Position, 
    settings: SmartSettings, 
    close: (symbol: string, side: PositionSide, reason: string, ratio: number) => void
): boolean {
    // 0. 智能子开关检查：必须至少开启了“阶梯保底锁定方案”或“指数衰减锁定模式”之一才允许运行
    const hasAnySubSwitchOn = settings.conventionalEnabled === true || settings.decayEnabled === true;
    if (!hasAnySubSwitchOn) {
        return false;
    }

    const currentPnl = position.unrealizedPnLPercentage || 0;
    let recordedMax = position.maxPnLPercent || 0;

    // 🔒【K线盘面真实极值权威校准】：无盲区扫描 1m, 5m, 15m 多周期 K线，精准萃取开仓以来的真实历史最高点！
    if (position.entryPrice > 0) {
        const relevantTime = Math.max(position.entryTime || 0, position.lastRefillTime || 0, position.lastDcaAt || 0);
        const tfs = ['1m', '5m', '15m'];
        for (const tf of tfs) {
            const klines = klineMultiTfStore.getKlinesSync(position.symbol, tf);
            if (klines && klines.length > 0) {
                // 🔒【开仓后真实极值过滤】：仅包含在持仓发生 (relevantTime) 之后开盘的 K 线，杜绝开仓前历史影线/高点污染最高收益
                const candlesSinceEntry = klines.filter(k => k.time >= relevantTime);
                if (candlesSinceEntry.length > 0) {
                    if (position.side === PositionSide.LONG) {
                        const peakHigh = Math.max(...candlesSinceEntry.map(k => k.high));
                        if (peakHigh > 0) {
                            const klineMaxPnl = ((peakHigh - position.entryPrice) / position.entryPrice) * 100;
                            if (klineMaxPnl > recordedMax) {
                                recordedMax = klineMaxPnl;
                            }
                        }
                    } else if (position.side === PositionSide.SHORT) {
                        const lowestLow = Math.min(...candlesSinceEntry.map(k => k.low));
                        if (lowestLow > 0) {
                            const klineMaxPnl = ((position.entryPrice - lowestLow) / position.entryPrice) * 100;
                            if (klineMaxPnl > recordedMax) {
                                recordedMax = klineMaxPnl;
                            }
                        }
                    }
                }
            }
        }
    }

    const maxPnl = Math.max(recordedMax, currentPnl);
    if (maxPnl > (position.maxPnLPercent || 0)) {
        position.maxPnLPercent = maxPnl;
    }

    const positionValue = (position.amount || 0) * (position.entryPrice || 0);
    
    // 默认智能阶梯配置 (做防呆兜底)
    const DEFAULT_SMART_TIERS = [
        { threshold: 2.0, callback: 0.5, expiry: 5.0 },
        { threshold: 5.0, callback: 1.0, expiry: 10.0 },
        { threshold: 10.0, callback: 1.5, expiry: 20.0 }
    ];
    const tiers = (Array.isArray(settings.tiers) && settings.tiers.length > 0) ? settings.tiers : DEFAULT_SMART_TIERS;

    // 0.1 门槛检查：仅当持仓金额极端微弱(< 0.5U)时作防呆拦截，对真实持仓(如6U小仓位)全面放行
    const minPos = Math.max(0, settings.minPosition || 0);
    if (minPos > 0 && positionValue < minPos && positionValue < 0.5) {
        return false;
    }

    // 辅助防呆函数：计算实际有效回撤点数
    // 若用户填写的 callback > 5 (例如填写了 20，表示期望利润回撤 20% 时止盈)，自动换算为相对回撤点数: maxPnl * (callback / 100)
    // 若用户填写的 callback <= 5 (例如 0.5, 1.0)，表示绝对点数回撤
    const calcEffectiveCallback = (rawCbInput: number, refPnl: number): number => {
        const rawCb = Number(rawCbInput) || 0.5;
        if (rawCb > 5 && refPnl > 0) {
            return Math.max(0.1, refPnl * (rawCb / 100));
        }
        return Math.max(0.05, rawCb);
    };

    // 1. 阶梯保底锁定方案：必须开启了阶梯保底子开关 (conventionalEnabled === true)
    const isTierEnabled = settings.conventionalEnabled === true;
    if (isTierEnabled && tiers.length > 0) {
        // A. 计算“阶梯保底线” (Safety Floor)
        let safetyFloor = -999;
        let floorReason = "";

        tiers.forEach((tier, idx) => {
            const exp = Number(tier.expiry);
            const effectiveCb = calcEffectiveCallback(tier.callback, exp);
            if (maxPnl >= exp) {
                const potentialFloor = exp - effectiveCb;
                if (potentialFloor > safetyFloor) {
                    safetyFloor = potentialFloor;
                    floorReason = `曾突破阶梯${idx + 1}失效值 ${exp}%, 该阶梯回撤容忍 ${effectiveCb.toFixed(2)}%, 保底锁定 ${potentialFloor.toFixed(2)}%`;
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
        // 关键增强：对阶梯按 threshold 升序排列，自最高阶梯向下检索匹配 activeTier
        const sortedTiers = [...tiers].sort((a, b) => Number(a.threshold || 0) - Number(b.threshold || 0));

        // 匹配当前已达到的最高阶梯
        const activeTier = [...sortedTiers].reverse().find(t => maxPnl >= Number(t.threshold || 0));

        if (activeTier) {
            const drawdown = maxPnl - currentPnl;
            const effectiveCb = calcEffectiveCallback(activeTier.callback, maxPnl);
            const activeThreshold = Number(activeTier.threshold || 0);

            // 🔒【方案 A 双重门槛】：
            // 条件 1: 必须发生真实完整的设定回调 (drawdown >= effectiveCb)
            // 条件 2: 发生回调后的剩余盈利，必须保持 >= 当前阶梯门槛 activeThreshold
            const isDrawdownMet = drawdown >= effectiveCb;
            const isProfitFloorMet = currentPnl >= activeThreshold || (maxPnl - effectiveCb >= activeThreshold && drawdown >= effectiveCb);

            if (isDrawdownMet && isProfitFloorMet) {
                close(
                    position.symbol, 
                    position.side, 
                    `智能止盈(常规阶梯硬保底): 最高盈利 ${maxPnl.toFixed(2)}%, 阶梯门槛 ${activeThreshold}%, 回调 ${drawdown.toFixed(2)}% >= ${effectiveCb.toFixed(2)}%, 当前收益 ${currentPnl.toFixed(2)}% 满足硬保底`,
                    100
                );
                return true;
            }
        }

        const minTierThreshold = sortedTiers.reduce((min, t) => Math.min(min, Number(t.threshold || 0)), 999);
        if (maxPnl >= minTierThreshold) {
            return false;
        }
    }

    // 2. 指数衰减锁定模式：必须开启了指数衰减子开关 (decayEnabled === true)
    const isDecayEnabled = settings.decayEnabled === true;
    const activationThreshold = settings.activationProfit !== undefined ? settings.activationProfit : 5;
    if (isDecayEnabled && maxPnl >= activationThreshold) {
        // 计算动态回调比例 (1 - maxPnl%)
        const effectiveMaxPnl = Math.min(maxPnl, 100); 
        const callbackRatio = 1 - (effectiveMaxPnl / 100); 
        
        // 计算允许的最大回撤值
        const allowedDrawdown = maxPnl * callbackRatio;
        
        // 计算当前实际回撤值
        const currentDrawdown = maxPnl - currentPnl;

        // 判断是否触发平仓
        if (currentDrawdown >= allowedDrawdown) {
            close(
                position.symbol, 
                position.side, 
                `智能止盈(指数衰减): 最高盈利 ${maxPnl.toFixed(2)}%, 允许回调 ${allowedDrawdown.toFixed(2)}% (比例 ${(callbackRatio * 100).toFixed(2)}%), 实际盈利锁定在 ${currentPnl.toFixed(2)}%`,
                100 // 智能止盈通常全平
            );
            return true;
        }
    } 

    return false;
}
