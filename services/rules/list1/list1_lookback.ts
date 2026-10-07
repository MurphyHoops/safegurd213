// 🔒 LOCKED_MODULE: LIST 1 [回溯周期过滤 - 原子化规则计算引擎]
// @LOCKED: 严格原子化锁定。未经用户明确的专属书面指令，严禁擅自修改、重构或变动任何算法与流转逻辑。

import { MajorTrendConfig } from '../../../components/Scanner/scannerTypes';
import { calculateEMA } from '../../indicators';

export interface LookbackEvalResult {
    passed: boolean;
    isLongMatch: boolean;
    isShortMatch: boolean;
    emaFailed: boolean;
    dropFromMaxToMin: number;
    pumpFromMinToMax: number;
    distLong: number;
    distShort: number;
    lowDaysAgo: number;
    highDaysAgo: number;
    minPrice: number;
    maxPrice: number;
}

/**
 * 单币种回溯周期过滤原子化纯计算函数
 */
export function evaluateLookbackFilter(
    symbol: string,
    klines: any[],
    currentPrice: number,
    maxZ: number | undefined,
    minZ: number | undefined,
    cfg: MajorTrendConfig,
    enableLong: boolean,
    enableShort: boolean,
    enableSideways: boolean
): LookbackEvalResult {
    const timeParam = cfg.filterTimeParam || cfg.lookbackDays || 300;
    const prices = (klines || []).map((k: any) => parseFloat(k[4]));
    const periodKlines = (klines || []).slice(-timeParam);
    const highs = periodKlines.map((k: any) => parseFloat(k[2]));
    const lows = periodKlines.map((k: any) => parseFloat(k[3]));

    const effectiveSidewaysDays = Math.max(
        ...(cfg.sidewaysGroups?.filter(g => g.enabled !== false).map(g => Number(g.daysLong || g.daysShort || g.days || 7)) || [cfg.sidewaysDays || 7])
    );
    let histHighs = highs;
    let histLows = lows;
    if (enableSideways && highs.length > effectiveSidewaysDays) {
        const endIdx = Math.max(1, highs.length - effectiveSidewaysDays);
        histHighs = highs.slice(0, endIdx);
        histLows = lows.slice(0, endIdx);
    }

    const rawMaxPrice = histHighs.length > 0 ? Math.max(...histHighs) : currentPrice;
    const rawMinPrice = histLows.length > 0 ? Math.min(...histLows) : currentPrice;

    // 🔒【消除新低/新高负数误杀漏洞】:
    // 真实绝对极值涵盖整个回溯周期与最近横盘蓄势期。
    // 当币种在最近蓄势期创下新低时，当前价离绝对最低点距离为0% (绝不产生负数导致被>=0规则误杀)
    const minPrice = Math.min(rawMinPrice, minZ !== undefined ? minZ : currentPrice, currentPrice);
    const maxPrice = Math.max(rawMaxPrice, maxZ !== undefined ? maxZ : currentPrice, currentPrice);

    const dropFromMaxToMin = ((maxPrice - minPrice) / maxPrice) * 100;
    const pumpFromMinToMax = ((maxPrice - minPrice) / minPrice) * 100;

    const distLong = Math.max(0, ((currentPrice - minPrice) / minPrice) * 100);
    const distShort = Math.max(0, ((maxPrice - currentPrice) / maxPrice) * 100);

    let lowDaysAgo = 0;
    if (minPrice === currentPrice || (minZ !== undefined && minPrice === minZ)) {
        // 最低点发生在最近横盘蓄势期内 (0 ~ effectiveSidewaysDays 天前)
        const sidewaysLows = lows.slice(-effectiveSidewaysDays);
        const sIdx = sidewaysLows.lastIndexOf(minPrice);
        lowDaysAgo = sIdx !== -1 ? (sidewaysLows.length - 1 - sIdx) : 0;
    } else {
        const minLowIdx = histLows.indexOf(minPrice);
        lowDaysAgo = minLowIdx !== -1 ? (periodKlines.length - 1 - minLowIdx) : 0;
    }

    let highDaysAgo = 0;
    if (maxPrice === currentPrice || (maxZ !== undefined && maxPrice === maxZ)) {
        // 最高点发生在最近横盘蓄势期内 (0 ~ effectiveSidewaysDays 天前)
        const sidewaysHighs = highs.slice(-effectiveSidewaysDays);
        const sIdx = sidewaysHighs.lastIndexOf(maxPrice);
        highDaysAgo = sIdx !== -1 ? (sidewaysHighs.length - 1 - sIdx) : 0;
    } else {
        const maxHighIdx = histHighs.indexOf(maxPrice);
        highDaysAgo = maxHighIdx !== -1 ? (periodKlines.length - 1 - maxHighIdx) : 0;
    }

    const isLongMatch = enableLong && (
        (dropFromMaxToMin >= cfg.minHistoryDrop) && 
        (distLong >= (cfg.minExtremeDistanceLong ?? 0)) && 
        (distLong <= (cfg.maxExtremeDistanceLong !== undefined ? cfg.maxExtremeDistanceLong : cfg.maxExtremeDistance)) &&
        (lowDaysAgo >= (cfg.extremeDaysMinLong ?? 0)) &&
        (lowDaysAgo <= (cfg.extremeDaysMaxLong ?? 300))
    );

    const isShortMatch = enableShort && (
        (pumpFromMinToMax >= cfg.minHistoryPump) && 
        (distShort >= (cfg.minExtremeDistanceShort ?? 0)) && 
        (distShort <= (cfg.maxExtremeDistanceShort !== undefined ? cfg.maxExtremeDistanceShort : cfg.maxExtremeDistance)) &&
        (highDaysAgo >= (cfg.extremeDaysMinShort ?? 0)) &&
        (highDaysAgo <= (cfg.extremeDaysMaxShort ?? 300))
    );

    const stage2Match = (!enableLong && !enableShort) || isLongMatch || isShortMatch;
    let emaFailed = false;

    if (stage2Match && cfg.filterEmaPeriod > 0) {
        if (prices.length < cfg.filterEmaPeriod) {
            emaFailed = true;
        } else {
            const ema = calculateEMA(prices, cfg.filterEmaPeriod);
            let crossCount = 0;
            let lastDirection: 'UP' | 'DOWN' | null = null;
            let lastCrossIndex = -1;

            for (let j = cfg.filterEmaPeriod - 1; j < prices.length; j++) {
                const emaVal = ema[j - (cfg.filterEmaPeriod - 1)];
                const currentDirection = prices[j] > emaVal ? 'UP' : 'DOWN';
                if (lastDirection && currentDirection !== lastDirection) {
                    crossCount++;
                    lastCrossIndex = j;
                }
                lastDirection = currentDirection;
            }

            if (crossCount >= cfg.filterCrossingCount) {
                emaFailed = true;
            } else if (lastCrossIndex !== -1 && lastCrossIndex < prices.length - 1) {
                const crossPrice = prices[lastCrossIndex];
                const maxFuturePrice = Math.max(...prices.slice(lastCrossIndex + 1));
                const minFuturePrice = Math.min(...prices.slice(lastCrossIndex + 1));

                const maxPumpAfterCross = ((maxFuturePrice - crossPrice) / crossPrice) * 100;
                const maxDropAfterCross = ((minFuturePrice - crossPrice) / crossPrice) * 100;

                if (lastDirection === 'UP' && maxPumpAfterCross > cfg.filterLongMaxPump) emaFailed = true;
                if (lastDirection === 'DOWN' && maxDropAfterCross < cfg.filterShortMinDrop) emaFailed = true;
            }
        }
    }

    const passed = stage2Match && !emaFailed;

    return {
        passed,
        isLongMatch: passed && isLongMatch,
        isShortMatch: passed && isShortMatch,
        emaFailed,
        dropFromMaxToMin,
        pumpFromMinToMax,
        distLong,
        distShort,
        lowDaysAgo,
        highDaysAgo,
        minPrice,
        maxPrice
    };
}
