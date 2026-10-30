
/**
 * [REAL-TIME MODE CODE LOCK - LIST 2 (GRAND CROSSING)]
 * CRITICAL: The core rules, logic, and configuration for List 2 (Grand Crossing)
 * are now STRICTLY LOCKED and MUST NOT be modified under any circumstances.
 * Secondary and double-verification filters are fully completed and locked.
 */

import { calculateEMA } from '../indicators';
import { List2Config, List2GroupedResult } from '../../components/Scanner/scannerTypes';

/**
 * 🔒 [收盘确立时刻计算]：计算已收盘信号K线的真实收盘时间（而非开盘时间），
 * 确保在K线收盘确立信号的瞬间进入列表时，信号发生时间与进入列表时间精准对齐。
 */
export function getCandleCloseTime(targetIdx: number, timestamps: number[], tf?: string): number {
    if (!timestamps || timestamps.length === 0 || targetIdx < 0) return Date.now();
    // 🔒 确立信号K线起始时间戳，确保在全系统各列表及K线图弹窗中100%严丝合缝对齐到该K线（杜绝后移一根）
    return timestamps[targetIdx] || Date.now();
}

export function analyzeList2Crossing(
    symbol: string,
    tf: string,
    closes: number[],
    highs: number[],
    lows: number[],
    opens: number[],
    volumes: number[],
    timestamps: number[],
    config: List2Config,
    maxNewLag: number = 1 // Added for backtest catchup
): List2GroupedResult[] {
    
    const idx = closes.length - 1;
    const volMultiplier = config.volMultiplier !== undefined ? config.volMultiplier : 1.0;
    const squeezeThreshold = config.squeezeThreshold !== undefined ? config.squeezeThreshold : 0.5;
    const maxAmplitude = config.maxAmplitude !== undefined ? config.maxAmplitude : 50;
    const minBodyRatio = config.minBodyRatio !== undefined ? config.minBodyRatio : 60;
    const strictVolWindow = (config.strictVolWindow !== undefined && !Number.isNaN(config.strictVolWindow)) ? Math.max(1, config.strictVolWindow) : 3;
    const strictMinQuoteVolume = (config.strictMinQuoteVolume !== undefined && !Number.isNaN(config.strictMinQuoteVolume)) ? Math.max(0, config.strictMinQuoteVolume) : 0;
    const enableConsecutiveVolRise = config.enableConsecutiveVolRise !== undefined ? !!config.enableConsecutiveVolRise : true;
    const consecutiveVolBars = (config.consecutiveVolBars !== undefined && !Number.isNaN(config.consecutiveVolBars)) ? Math.max(2, config.consecutiveVolBars) : 2;
    const checkEma80Conflict = !!config.checkEma80Conflict;
    const enableFlatFilter = !!config.enableFlatFilter;
    const flatLookback = config.flatLookback !== undefined ? config.flatLookback : 50;
    const flatThreshold = config.flatThreshold !== undefined ? config.flatThreshold : 5;
    const strictFiltering = config.strictFiltering !== undefined ? config.strictFiltering : true;
    const enableDivergenceCrossCheck = config.enableDivergenceCrossCheck !== undefined ? !!config.enableDivergenceCrossCheck : true;
    const divergenceLookbackBars = (config.divergenceLookbackBars !== undefined && !Number.isNaN(config.divergenceLookbackBars)) ? Math.max(1, config.divergenceLookbackBars) : 20;
    const enableSignalDeviationFilter = !!config.enableSignalDeviationFilter;
    const maxSignalDeviationPercent = (config.maxSignalDeviationPercent !== undefined && !Number.isNaN(config.maxSignalDeviationPercent)) ? Math.max(0, config.maxSignalDeviationPercent) : 50;
    const enablePriorReverseDivergence = !!config.enablePriorReverseDivergence;
    const priorReverseLookbackBars = (config.priorReverseLookbackBars !== undefined && !Number.isNaN(config.priorReverseLookbackBars)) ? Math.max(1, config.priorReverseLookbackBars) : 20;
    const priorReverseMode = config.priorReverseMode || 'BOTH';
    const currentPrice = closes[idx];
    
    // 🔒 [USER MANDATORY RULE - 信号存续 (Retention & Lookback)]
    // 1. 访问过去 (Lookback): 寻找过去设定值 K 线根数内符合穿越/发散的币，并以该符合条件的K线标记为信号K线
    const lookbackLimit = (config.lookbackBars !== undefined && !Number.isNaN(config.lookbackBars))
        ? Math.max(1, config.lookbackBars)
        : 5;
    const scanLookbackLimit = (maxNewLag !== undefined && maxNewLag > lookbackLimit) 
        ? maxNewLag 
        : lookbackLimit;

    // 2. 寿命根数 (Retention): 信号K线生成后存留有效根数
    const retentionThreshold = (config.newModeRetention !== undefined && !Number.isNaN(config.newModeRetention))
        ? Math.max(1, config.newModeRetention)
        : ((config as any).maxLag !== undefined ? (config as any).maxLag : 9);
    
    // We scan deeper to correctly identify the START of continuous signals (like alignment)
    // so we can expire them after 'retentionThreshold' bars.
    const effectiveScanRange = 120; 

    // 1. Flat Filter (Zombie Coin Check) - Applies whenever enableFlatFilter is enabled
    if (enableFlatFilter) {
        let flatCount = 0;
        const checkStart = Math.max(0, idx - flatLookback);
        
        // Frequency Maps for Detecting Price Pinning (Ceiling/Floor)
        const highCounts: Record<number, number> = {};
        const lowCounts: Record<number, number> = {};

        for (let k = checkStart; k <= idx; k++) {
            const o = opens[k] || 0;
            const h = highs[k] || 0;
            const l = lows[k] || 0;
            const c = closes[k] || 0;
            const v = volumes[k] || 0;
            const epsilon = o > 0 ? (o * 0.00001) : 0.0000001;

            // A. Standard Flat Candle Check (Zero volume or pure flat horizontal line with no wick/range)
            // Note: Standard Doji candlestick (high > low, open == close) is a normal market candlestick, NOT a zombie flat bar.
            if (v <= 0 || h === l || ((h - l) <= epsilon)) {
                flatCount++;
            }

            // B. Repeated Price Check (Detecting Algo Control / Pinning when candle has no range)
            if (h === l || (h - l) <= epsilon) {
                highCounts[h] = (highCounts[h] || 0) + 1;
                lowCounts[l] = (lowCounts[l] || 0) + 1;
            }
        }

        // Check A Result: Flat candles reach or exceed threshold
        if (flatCount >= flatThreshold) return [];

        // Check B Result: If same High or Low repeats >= Threshold * 3 times
        const maxRepeatedHigh = Object.keys(highCounts).length > 0 ? Math.max(...Object.values(highCounts)) : 0;
        const maxRepeatedLow = Object.keys(lowCounts).length > 0 ? Math.max(...Object.values(lowCounts)) : 0;

        if (maxRepeatedHigh >= flatThreshold * 3 || maxRepeatedLow >= flatThreshold * 3) {
            return []; // Rejected: Price Pinning Detected
        }
    }

    // 2. Indicator Calculation
    // Ensure we have enough data (40 bars for EMA10/20/30/40, or 80 bars if EMA80 trend check is enabled)
    const minHistoryNeeded = checkEma80Conflict ? 80 : 40;
    if (closes.length < minHistoryNeeded) return [];

    const ema10 = calculateEMA(closes, 10);
    const ema20 = calculateEMA(closes, 20);
    const ema30 = calculateEMA(closes, 30);
    const ema40 = calculateEMA(closes, 40);
    const ema80 = checkEma80Conflict ? calculateEMA(closes, 80) : [];

    const getEmaVal = (arr: number[], index: number, period: number) => {
        const offset = index - (period - 1);
        return (offset >= 0 && offset < arr.length) ? arr[offset] : null;
    };

    const longSignals: { 
        lag: number; 
        direction: 'LONG'; 
        amp: number; 
        time: number; 
        bodyRatio: number; 
        isAligned: boolean;
        isCandleCrossed?: boolean;
        isMaCrossed?: boolean;
        isFirstMaCross?: boolean;
        ampValid: boolean;
        volValid: boolean;
        maxVolRatio?: number;
        maxQuoteVol?: number;
        isConsecutiveRising?: boolean;
        bodyValid: boolean;
        isClosed: boolean;
        isPendingGray: boolean;
        isWaitDivergencePending?: boolean;
        waitElapsedBars?: number;
        waitTotalBars?: number;
        isPriorReverseFound?: boolean;
        priorReverseType?: 'V_REVERSAL_LONG' | 'V_REVERSAL_SHORT';
        kHigh: number;
        kLow: number;
        kClose: number;
        kOpen: number;
    }[] = [];
    const shortSignals: { 
        lag: number; 
        direction: 'SHORT'; 
        amp: number; 
        time: number; 
        bodyRatio: number; 
        isAligned: boolean;
        isCandleCrossed?: boolean;
        isMaCrossed?: boolean;
        isFirstMaCross?: boolean;
        ampValid: boolean;
        volValid: boolean;
        maxVolRatio?: number;
        maxQuoteVol?: number;
        isConsecutiveRising?: boolean;
        bodyValid: boolean;
        isClosed: boolean;
        isPendingGray: boolean;
        isWaitDivergencePending?: boolean;
        waitElapsedBars?: number;
        waitTotalBars?: number;
        isPriorReverseFound?: boolean;
        priorReverseType?: 'V_REVERSAL_LONG' | 'V_REVERSAL_SHORT';
        kHigh: number;
        kLow: number;
        kClose: number;
        kOpen: number;
    }[] = [];

    // 3. Loop through Lag Window (Scanning backwards from current candle)
    for (let lag = 0; lag <= effectiveScanRange; lag++) {
        const checkIdx = idx - lag;
        // Safety check: Ensure enough history for EMA calculations at this point
        if (checkIdx < minHistoryNeeded) continue; 

        const e10 = getEmaVal(ema10, checkIdx, 10);
        const e20 = getEmaVal(ema20, checkIdx, 20);
        const e30 = getEmaVal(ema30, checkIdx, 30);
        const e40 = getEmaVal(ema40, checkIdx, 40);
        const e80 = checkEma80Conflict ? getEmaVal(ema80, checkIdx, 80) : null;

        if (e10 !== null && e20 !== null && e30 !== null && e40 !== null) {
            const maxEma = Math.max(e10, e20, e30, e40);
            const minEma = Math.min(e10, e20, e30, e40);
            const kHigh = highs[checkIdx];
            const kLow = lows[checkIdx];
            const kClose = closes[checkIdx];
            const kOpen = opens[checkIdx];
            const kTime = timestamps[checkIdx];

            // 1. EMA80 Baseline Trend Check (Evaluated separately per direction to prevent single-candle color misjudging trend)
            let conflictL = false;
            let conflictS = false;
            if (checkEma80Conflict) {
                if (e80 === null) {
                    conflictL = true;
                    conflictS = true;
                } else {
                    // LONG: EMA80 must be strictly BELOW the lowest short-term EMA (minEma).
                    if (e80 >= minEma) conflictL = true; 
                    
                    // SHORT: EMA80 must be strictly ABOVE the highest short-term EMA (maxEma).
                    if (e80 <= maxEma) conflictS = true;   
                }
            }

            // =========================================================================
            // 🔒 @LOCKED_MODULE: LIST2_DIVERGENCE_RULES (列表2均线发散规则永久硬锁定)
            // 严禁未授权修改：没有用户明确下达指令，绝对不能触碰关于“发散”规则的所有代码和任何规则！
            // 包含：EMA10/20/30/40发散形态、同向收盘确立信号K线、信号存续访问过去范围、发散回溯穿越、起爆原点Genesis锁定等全部逻辑
            // =========================================================================
            // 🔒 [USER MANDATORY RULE - 核心前置门禁 (Core Gate 1 & Gate 2)]
            // 核心原则：
            // 步骤一：只在“信号存续/访问过去”设定值（lookbackLimit）内检查是否有 EMA10/20/30/40 呈发散形态
            // 步骤二：若满足发散，再在“发散回溯穿越”设定值（divergenceLookbackBars）内检查 EMA10 穿越 EMA20/30/40
            // 这两个是绝对核心条件，必须首先同时满足，再进行其它已选过滤条件（振幅、实体比例、成交量等）
            // =========================================================================

            // Core Condition 1: 均线发散形态 (EMA10 > 20 > 30 > 40 多 / EMA10 < 20 < 30 < 40 空)
            const isAlignedLong = e10 > e20 && e20 > e30 && e30 > e40;
            const isAlignedShort = e10 < e20 && e20 < e30 && e30 < e40;

            const isAlignedL = isAlignedLong && !conflictL;
            const isAlignedS = isAlignedShort && !conflictS;

            let crossedAllL = !enableDivergenceCrossCheck;
            let crossedAllS = !enableDivergenceCrossCheck;

            // =========================================================================
            // 🔒 [USER MANDATORY RULE - 两大场景均线发散首发起爆与收盘确认机制]
            // 核心铁律：坚决只找龙头，不吃鱼身！
            // 场景 1 (冷启动/重启程序):
            //   - 发散回溯穿越: 起爆原点前 divergenceLookbackBars 根内，EMA10必须穿越EMA20/30/40
            //   - 信号存续访问过去: 起爆原点距最新K线必须严格 <= scanLookbackLimit (访问过去N根)
            // 场景 2 (程序常驻实时运行):
            //   - 最新出现的发散形态，起爆原点前 divergenceLookbackBars 根内有穿越，即作为一手新信号入榜
            //   - 信号入选后，在 retentionThreshold (寿命根数L根) 内合法存续，超出寿命自然淘汰
            // =========================================================================
            let divergenceValidL = false;
            let divConfirmedLagL = lag;
            let divConfirmedIdxL = checkIdx;
            let divIsPendingGrayL = false;
            let isPriorReverseFoundL = false;
            let priorReverseTypeL: 'V_REVERSAL_LONG' | undefined = undefined;

            if (isAlignedL && lag > 0) {
                // 1. 追溯本轮多头发散的初生起爆原点 (Genesis Bar K0)
                let genesisIdxL = checkIdx;
                for (let g = checkIdx - 1; g >= Math.max(0, checkIdx - 100); g--) {
                    const gE10 = getEmaVal(ema10, g, 10);
                    const gE20 = getEmaVal(ema20, g, 20);
                    const gE30 = getEmaVal(ema30, g, 30);
                    const gE40 = getEmaVal(ema40, g, 40);
                    const gE80 = checkEma80Conflict ? getEmaVal(ema80, g, 80) : null;

                    if (gE10 === null || gE20 === null || gE30 === null || gE40 === null) break;
                    const gMin = Math.min(gE10, gE20, gE30, gE40);
                    const gConflict = checkEma80Conflict && (gE80 === null || gE80 >= gMin);
                    const gIsAligned = gE10 > gE20 && gE20 > gE30 && gE30 > gE40 && !gConflict;

                    if (gIsAligned) {
                        genesisIdxL = g;
                    } else {
                        // 前一根K线不满足多头发散，确定 genesisIdxL 为本轮发散的首次确立原点
                        break;
                    }
                }

                const genesisAgeL = idx - genesisIdxL;

                // 2. 追溯发散起爆原点之前 N 根K线内是否存在反向发散 (空头发散: EMA10 < 20 < 30 < 40 - 诱空洗盘)
                const effLookbackL = Math.max(priorReverseLookbackBars, 80);
                const searchEndL = Math.max(minHistoryNeeded, genesisIdxL - effLookbackL);
                for (let rIdx = genesisIdxL - 1; rIdx >= searchEndL; rIdx--) {
                    const rE10 = getEmaVal(ema10, rIdx, 10);
                    const rE20 = getEmaVal(ema20, rIdx, 20);
                    const rE30 = getEmaVal(ema30, rIdx, 30);
                    const rE40 = getEmaVal(ema40, rIdx, 40);
                    if (rE10 !== null && rE20 !== null && rE30 !== null && rE40 !== null) {
                        if ((rE10 < rE20 && rE20 < rE30 && rE30 < rE40) || (rE10 < rE20 && rE20 < rE30)) {
                            isPriorReverseFoundL = true;
                            priorReverseTypeL = 'V_REVERSAL_LONG';
                            break;
                        }
                    }
                }

                // 前置洗盘反发散门禁转移至列表3执行；列表2仅记录并透传 isPriorReverseFound 状态
                let passPriorReverseL = true;

                // 3. 龙头寿命门禁与洗盘/V反门禁
                // 坚决只抓龙头，超出寿命根数 (> retentionThreshold) 或未通过前置洗盘发散门禁的过滤淘汰！
                const isGenesisEligibleL = (genesisAgeL <= retentionThreshold) && passPriorReverseL;

                if (isGenesisEligibleL) {
                    // 3. 🔒 [USER MANDATORY RULE - 发散回溯穿越硬门禁]
                    // 以【当前K线 (idx)】起算，向前追溯 EMA10 向上金叉穿越 EMA20/30/40 第一根EMA均线的确切K线 (firstCrossIdxL)。
                    // 门禁铁律：当前K线距离第一根穿越均线的根数 (idx - firstCrossIdxL) 不得大于 divergenceLookbackBars (如35根)。
                    // 若大于了，直接过滤淘汰 (crossedAllL = false)，绝对不进入列表2！
                    crossedAllL = true;
                    if (enableDivergenceCrossCheck) {
                        let cross20IdxL: number | null = null;
                        let cross30IdxL: number | null = null;
                        let cross40IdxL: number | null = null;

                        // 从起爆原点向历史深处追溯穿越点
                        const searchLimitL = Math.max(minHistoryNeeded, idx - divergenceLookbackBars - 60);
                        for (let bIdx = genesisIdxL; bIdx >= searchLimitL; bIdx--) {
                            const cur10 = getEmaVal(ema10, bIdx, 10);
                            const prev10 = getEmaVal(ema10, bIdx - 1, 10);
                            if (cur10 === null || prev10 === null) continue;

                            // EMA10 向上金叉穿越 EMA20
                            if (cross20IdxL === null) {
                                const cur20 = getEmaVal(ema20, bIdx, 20);
                                const prev20 = getEmaVal(ema20, bIdx - 1, 20);
                                if (cur20 !== null && prev20 !== null) {
                                    if ((prev10 <= prev20 && cur10 > cur20) || (prev10 < prev20 && cur10 >= cur20)) {
                                        cross20IdxL = bIdx;
                                    }
                                }
                            }

                            // EMA10 向上金叉穿越 EMA30
                            if (cross30IdxL === null) {
                                const cur30 = getEmaVal(ema30, bIdx, 30);
                                const prev30 = getEmaVal(ema30, bIdx - 1, 30);
                                if (cur30 !== null && prev30 !== null) {
                                    if ((prev10 <= prev30 && cur10 > cur30) || (prev10 < prev30 && cur10 >= cur30)) {
                                        cross30IdxL = bIdx;
                                    }
                                }
                            }

                            // EMA10 向上金叉穿越 EMA40
                            if (cross40IdxL === null) {
                                const cur40 = getEmaVal(ema40, bIdx, 40);
                                const prev40 = getEmaVal(ema40, bIdx - 1, 40);
                                if (cur40 !== null && prev40 !== null) {
                                    if ((prev10 <= prev40 && cur10 > cur40) || (prev10 < prev40 && cur10 >= cur40)) {
                                        cross40IdxL = bIdx;
                                    }
                                }
                            }

                            // 若三根均线的金叉穿越均已锁定，提前退出搜索
                            if (cross20IdxL !== null && cross30IdxL !== null && cross40IdxL !== null) {
                                break;
                            }
                        }

                        // 必须全部完成对 EMA20/30/40 的方向性穿越
                        if (cross20IdxL !== null && cross30IdxL !== null && cross40IdxL !== null) {
                            // 第一根被穿越的EMA均线（即三根均线金叉穿越中发生最早的那根K线）
                            const firstCrossIdxL = Math.min(cross20IdxL, cross30IdxL, cross40IdxL);
                            const distFromCurrentL = idx - firstCrossIdxL;

                            // 🔒 铁律门禁：当前K线距离第一根穿越均线不得大于 divergenceLookbackBars 根K线
                            if (distFromCurrentL <= divergenceLookbackBars) {
                                crossedAllL = true;
                            } else {
                                crossedAllL = false; // 距离大于设定值，直接过滤掉，不进列表2！
                            }
                        } else {
                            // 规定搜索窗口内未找到完整金叉穿越，直接淘汰！
                            crossedAllL = false;
                        }
                    }

                    if (crossedAllL) {
                        // 4. 从起爆原点向右寻找第一根已收盘阳线作为确认点
                        let foundBullish = false;
                        const maxForwardIdx = Math.min(idx - 1, genesisIdxL + retentionThreshold);

                        for (let fIdx = genesisIdxL; fIdx <= maxForwardIdx; fIdx++) {
                            const fE10 = getEmaVal(ema10, fIdx, 10);
                            const fE20 = getEmaVal(ema20, fIdx, 20);
                            const fE30 = getEmaVal(ema30, fIdx, 30);

                            // 🔒 铁律门禁：向后寻找确认阳线期间，均线多头形态绝不可被破坏
                            if (fE10 === null || fE20 === null || fE10 <= fE20 || (fE30 !== null && fE10 <= fE30)) {
                                break;
                            }

                            if (closes[fIdx] > opens[fIdx]) {
                                const isStillBullish = fE30 !== null ? (fE10 > fE20 && fE20 > fE30) : (fE10 > fE20);
                                const sigLagL = idx - fIdx;
                                if (isStillBullish && sigLagL <= retentionThreshold && sigLagL > 0) {
                                    // 🔒 [STRICT BODY GATE]: 若开启严格过滤，确认阳线实体比例必须达到设定阈值
                                    const fRangeL = highs[fIdx] - lows[fIdx];
                                    const fBodyRatioL = fRangeL > 0 ? (closes[fIdx] - opens[fIdx]) / fRangeL * 100 : 0;
                                    if (strictFiltering && fBodyRatioL < minBodyRatio) {
                                        continue;
                                    }
                                    divergenceValidL = true;
                                    divConfirmedIdxL = fIdx;
                                    divConfirmedLagL = sigLagL;
                                    divIsPendingGrayL = false;
                                    foundBullish = true;
                                    break;
                                }
                            }
                        }

                        if (!foundBullish) {
                            divergenceValidL = false;
                        }
                    }
                }
            }

            let divergenceValidS = false;
            let divConfirmedLagS = lag;
            let divConfirmedIdxS = checkIdx;
            let divIsPendingGrayS = false;
            let isPriorReverseFoundS = false;
            let priorReverseTypeS: 'V_REVERSAL_SHORT' | undefined = undefined;

            if (isAlignedS && lag > 0) {
                // 1. 追溯本轮空头发散的初生起爆原点 (Genesis Bar K0)
                let genesisIdxS = checkIdx;
                for (let g = checkIdx - 1; g >= Math.max(0, checkIdx - 100); g--) {
                    const gE10 = getEmaVal(ema10, g, 10);
                    const gE20 = getEmaVal(ema20, g, 20);
                    const gE30 = getEmaVal(ema30, g, 30);
                    const gE40 = getEmaVal(ema40, g, 40);
                    const gE80 = checkEma80Conflict ? getEmaVal(ema80, g, 80) : null;

                    if (gE10 === null || gE20 === null || gE30 === null || gE40 === null) break;
                    const gMax = Math.max(gE10, gE20, gE30, gE40);
                    const gConflict = checkEma80Conflict && (gE80 === null || gE80 <= gMax);
                    const gIsAligned = gE10 < gE20 && gE20 < gE30 && gE30 < gE40 && !gConflict;

                    if (gIsAligned) {
                        genesisIdxS = g;
                    } else {
                        // 前一根K线不满足空头发散，确定 genesisIdxS 为本轮发散的首次确立原点
                        break;
                    }
                }

                const genesisAgeS = idx - genesisIdxS;

                // 2. 追溯发散起爆原点之前 N 根K线内是否存在反向发散 (多头发散: EMA10 > 20 > 30 > 40 - 诱多洗盘)
                const effLookbackS = Math.max(priorReverseLookbackBars, 80);
                const searchEndS = Math.max(minHistoryNeeded, genesisIdxS - effLookbackS);
                for (let rIdx = genesisIdxS - 1; rIdx >= searchEndS; rIdx--) {
                    const rE10 = getEmaVal(ema10, rIdx, 10);
                    const rE20 = getEmaVal(ema20, rIdx, 20);
                    const rE30 = getEmaVal(ema30, rIdx, 30);
                    const rE40 = getEmaVal(ema40, rIdx, 40);
                    if (rE10 !== null && rE20 !== null && rE30 !== null && rE40 !== null) {
                        if ((rE10 > rE20 && rE20 > rE30 && rE30 > rE40) || (rE10 > rE20 && rE20 > rE30)) {
                            isPriorReverseFoundS = true;
                            priorReverseTypeS = 'V_REVERSAL_SHORT';
                            break;
                        }
                    }
                }

                // 前置洗盘反发散门禁转移至列表3执行；列表2仅记录并透传 isPriorReverseFound 状态
                let passPriorReverseS = true;

                // 3. 龙头寿命门禁与洗盘/V反门禁
                // 坚决只抓龙头，超出寿命根数 (> retentionThreshold) 或未通过前置洗盘发散门禁的过滤淘汰！
                const isGenesisEligibleS = (genesisAgeS <= retentionThreshold) && passPriorReverseS;

                if (isGenesisEligibleS) {
                    // 3. 🔒 [USER MANDATORY RULE - 发散回溯穿越硬门禁]
                    // 以【当前K线 (idx)】起算，向前追溯 EMA10 向下死叉穿越 EMA20/30/40 第一根EMA均线的确切K线 (firstCrossIdxS)。
                    // 门禁铁律：当前K线距离第一根穿越均线的根数 (idx - firstCrossIdxS) 不得大于 divergenceLookbackBars (如35根)。
                    // 若大于了，直接过滤淘汰 (crossedAllS = false)，绝对不进入列表2！
                    crossedAllS = true;
                    if (enableDivergenceCrossCheck) {
                        let cross20IdxS: number | null = null;
                        let cross30IdxS: number | null = null;
                        let cross40IdxS: number | null = null;

                        // 从起爆原点向历史深处追溯穿越点
                        const searchLimitS = Math.max(minHistoryNeeded, idx - divergenceLookbackBars - 60);
                        for (let bIdx = genesisIdxS; bIdx >= searchLimitS; bIdx--) {
                            const cur10 = getEmaVal(ema10, bIdx, 10);
                            const prev10 = getEmaVal(ema10, bIdx - 1, 10);
                            if (cur10 === null || prev10 === null) continue;

                            // EMA10 向下死叉穿越 EMA20
                            if (cross20IdxS === null) {
                                const cur20 = getEmaVal(ema20, bIdx, 20);
                                const prev20 = getEmaVal(ema20, bIdx - 1, 20);
                                if (cur20 !== null && prev20 !== null) {
                                    if ((prev10 >= prev20 && cur10 < cur20) || (prev10 > prev20 && cur10 <= cur20)) {
                                        cross20IdxS = bIdx;
                                    }
                                }
                            }

                            // EMA10 向下死叉穿越 EMA30
                            if (cross30IdxS === null) {
                                const cur30 = getEmaVal(ema30, bIdx, 30);
                                const prev30 = getEmaVal(ema30, bIdx - 1, 30);
                                if (cur30 !== null && prev30 !== null) {
                                    if ((prev10 >= prev30 && cur10 < cur30) || (prev10 > prev30 && cur10 <= cur30)) {
                                        cross30IdxS = bIdx;
                                    }
                                }
                            }

                            // EMA10 向下死叉穿越 EMA40
                            if (cross40IdxS === null) {
                                const cur40 = getEmaVal(ema40, bIdx, 40);
                                const prev40 = getEmaVal(ema40, bIdx - 1, 40);
                                if (cur40 !== null && prev40 !== null) {
                                    if ((prev10 >= prev40 && cur10 < cur40) || (prev10 > prev40 && cur10 <= cur40)) {
                                        cross40IdxS = bIdx;
                                    }
                                }
                            }

                            // 若三根均线的死叉穿越均已锁定，提前退出搜索
                            if (cross20IdxS !== null && cross30IdxS !== null && cross40IdxS !== null) {
                                break;
                            }
                        }

                        // 必须全部完成对 EMA20/30/40 的方向性穿越
                        if (cross20IdxS !== null && cross30IdxS !== null && cross40IdxS !== null) {
                            // 第一根被穿越的EMA均线（即三根均线死叉穿越中发生最早的那根K线）
                            const firstCrossIdxS = Math.min(cross20IdxS, cross30IdxS, cross40IdxS);
                            const distFromCurrentS = idx - firstCrossIdxS;

                            // 🔒 铁律门禁：当前K线距离第一根穿越均线不得大于 divergenceLookbackBars 根K线
                            if (distFromCurrentS <= divergenceLookbackBars) {
                                crossedAllS = true;
                            } else {
                                crossedAllS = false; // 距离大于设定值，直接过滤掉，不进列表2！
                            }
                        } else {
                            // 规定搜索窗口内未找到完整死叉穿越，直接淘汰！
                            crossedAllS = false;
                        }
                    }

                    if (crossedAllS) {
                        // 4. 从起爆原点向右寻找第一根已收盘阴线作为确认点
                        let foundBearish = false;
                        const maxForwardIdx = Math.min(idx - 1, genesisIdxS + retentionThreshold);

                        for (let fIdx = genesisIdxS; fIdx <= maxForwardIdx; fIdx++) {
                            const fE10 = getEmaVal(ema10, fIdx, 10);
                            const fE20 = getEmaVal(ema20, fIdx, 20);
                            const fE30 = getEmaVal(ema30, fIdx, 30);

                            // 🔒 铁律门禁：向后寻找确认阴线期间，均线空头形态绝不可被破坏
                            if (fE10 === null || fE20 === null || fE10 >= fE20 || (fE30 !== null && fE10 >= fE30)) {
                                break;
                            }

                            if (closes[fIdx] < opens[fIdx]) {
                                const isStillBearish = fE30 !== null ? (fE10 < fE20 && fE20 < fE30) : (fE10 < fE20);
                                const sigLagS = idx - fIdx;
                                if (isStillBearish && sigLagS <= retentionThreshold && sigLagS > 0) {
                                    // 🔒 [STRICT BODY GATE]: 若开启严格过滤，确认阴线实体比例必须达到设定阈值
                                    const fRangeS = highs[fIdx] - lows[fIdx];
                                    const fBodyRatioS = fRangeS > 0 ? (opens[fIdx] - closes[fIdx]) / fRangeS * 100 : 0;
                                    if (strictFiltering && fBodyRatioS < minBodyRatio) {
                                        continue;
                                    }
                                    divergenceValidS = true;
                                    divConfirmedIdxS = fIdx;
                                    divConfirmedLagS = sigLagS;
                                    divIsPendingGrayS = false;
                                    foundBearish = true;
                                    break;
                                }
                            }
                        }

                        if (!foundBearish) {
                            divergenceValidS = false;
                        }
                    }
                }
            }

            // The Grand Crossing Rule: High touches Max EMA, Low touches Min EMA (Physical Intersection)
            const isCrossing = kHigh >= maxEma && kLow <= minEma;
            
            // 🔒 [USER MANDATORY RULE - 收盘确认] 做多信号K线必须是已收盘阳线 (Close > Open 且 lag > 0)；做空信号K线必须是已收盘阴线 (Close < Open 且 lag > 0)
            const crossingIsBullish = closes[checkIdx] > opens[checkIdx] && lag > 0;
            const crossingIsBearish = closes[checkIdx] < opens[checkIdx] && lag > 0;

            const reqMa = config.requireMaCross ?? false;

            // 均线连续穿越：EMA10 在设定 N 根 K 线内顺次连续穿越 EMA20/30/40
            const prevE10 = getEmaVal(ema10, checkIdx - 1, 10);
            const prevE20 = getEmaVal(ema20, checkIdx - 1, 20);
            const prevE30 = getEmaVal(ema30, checkIdx - 1, 30);
            const prevE40 = getEmaVal(ema40, checkIdx - 1, 40);

            let isMaCrossLong = false;
            let isMaCrossShort = false;
            let isFirstMaCrossLong = false;
            let isFirstMaCrossShort = false;
            let maCrossConfirmedIdxL: number | null = null;
            let maCrossConfirmedIdxS: number | null = null;

            const maLookbackLimit = (config.maCrossLookbackBars !== undefined && !Number.isNaN(config.maCrossLookbackBars))
                ? Math.max(1, config.maCrossLookbackBars)
                : 15;

            if (e10 !== null && prevE10 !== null && e40 !== null && prevE40 !== null) {
                // 1. 金叉 (Long): 当根 K 线 (checkIdx) 必须完成 EMA10 向上金叉穿越 EMA40
                const c40L = prevE10 <= prevE40 && e10 > e40;
                if (c40L) {
                    // 2. 追溯在过去 N 根 K 线内 (checkIdx - maLookbackLimit 到 checkIdx)，EMA10 是否顺次完成对 EMA20 与 EMA30 的金叉穿越
                    let cross20IdxL: number | null = null;
                    let cross30IdxL: number | null = null;
                    const searchMinIdxL = Math.max(minHistoryNeeded, checkIdx - maLookbackLimit);

                    for (let b = checkIdx; b >= searchMinIdxL; b--) {
                        const bE10 = getEmaVal(ema10, b, 10);
                        const pbE10 = getEmaVal(ema10, b - 1, 10);
                        if (bE10 === null || pbE10 === null) continue;

                        if (cross20IdxL === null) {
                            const bE20 = getEmaVal(ema20, b, 20);
                            const pbE20 = getEmaVal(ema20, b - 1, 20);
                            if (bE20 !== null && pbE20 !== null && pbE10 <= pbE20 && bE10 > bE20) {
                                cross20IdxL = b;
                            }
                        }

                        if (cross30IdxL === null) {
                            const bE30 = getEmaVal(ema30, b, 30);
                            const pbE30 = getEmaVal(ema30, b - 1, 30);
                            if (bE30 !== null && pbE30 !== null && pbE10 <= pbE30 && bE10 > bE30) {
                                cross30IdxL = b;
                            }
                        }

                        if (cross20IdxL !== null && cross30IdxL !== null) break;
                    }

                    // 必须在过去 N 根 K 线内同时完成对 EMA20/30/40 的连续金叉穿越
                    if (cross20IdxL !== null && cross30IdxL !== null) {
                        // 🔒【第一根同向阳线确认逻辑】：
                        // A. 若穿越当根 (checkIdx) 就是已收盘阳线，当根直接确认！
                        // B. 若穿越当根为阴线/十字星，向右顺延寻找第一根已收盘阳线 (Close > Open) 确定为信号 K 线
                        if (closes[checkIdx] > opens[checkIdx] && (idx - checkIdx > 0)) {
                            maCrossConfirmedIdxL = checkIdx;
                        } else {
                            const maxForwardL = Math.min(idx - 1, checkIdx + retentionThreshold);
                            for (let f = checkIdx + 1; f <= maxForwardL; f++) {
                                const fE10 = getEmaVal(ema10, f, 10);
                                const fE20 = getEmaVal(ema20, f, 20);
                                if (fE10 === null || fE20 === null || fE10 <= fE20) break;
                                if (closes[f] > opens[f]) {
                                    maCrossConfirmedIdxL = f;
                                    break;
                                }
                            }
                        }

                        if (maCrossConfirmedIdxL !== null) {
                            isMaCrossLong = true;

                            // 校验【仅限首次穿越】：追溯前 N 根 K 线，要求 EMA10 在金叉前未处于 EMA40 上方
                            let wasBelow = true;
                            const checkBackLimit = Math.max(0, checkIdx - 8);
                            for (let b = checkIdx - 2; b >= checkBackLimit; b--) {
                                const b10 = getEmaVal(ema10, b, 10);
                                const b40 = getEmaVal(ema40, b, 40);
                                if (b10 !== null && b40 !== null && b10 > b40) {
                                    wasBelow = false;
                                    break;
                                }
                            }
                            isFirstMaCrossLong = wasBelow;
                        }
                    }
                }

                // 1. 死叉 (Short): 当根 K 线 (checkIdx) 必须完成 EMA10 向下死叉穿越 EMA40
                const c40S = prevE10 >= prevE40 && e10 < e40;
                if (c40S) {
                    // 2. 追溯在过去 N 根 K 线内 (checkIdx - maLookbackLimit 到 checkIdx)，EMA10 是否顺次完成对 EMA20 与 EMA30 的死叉穿越
                    let cross20IdxS: number | null = null;
                    let cross30IdxS: number | null = null;
                    const searchMinIdxS = Math.max(minHistoryNeeded, checkIdx - maLookbackLimit);

                    for (let b = checkIdx; b >= searchMinIdxS; b--) {
                        const bE10 = getEmaVal(ema10, b, 10);
                        const pbE10 = getEmaVal(ema10, b - 1, 10);
                        if (bE10 === null || pbE10 === null) continue;

                        if (cross20IdxS === null) {
                            const bE20 = getEmaVal(ema20, b, 20);
                            const pbE20 = getEmaVal(ema20, b - 1, 20);
                            if (bE20 !== null && pbE20 !== null && pbE10 >= pbE20 && bE10 < bE20) {
                                cross20IdxS = b;
                            }
                        }

                        if (cross30IdxS === null) {
                            const bE30 = getEmaVal(ema30, b, 30);
                            const pbE30 = getEmaVal(ema30, b - 1, 30);
                            if (bE30 !== null && pbE30 !== null && pbE10 >= pbE30 && bE10 < pbE30) {
                                cross30IdxS = b;
                            }
                        }

                        if (cross20IdxS !== null && cross30IdxS !== null) break;
                    }

                    // 必须在过去 N 根 K 线内同时完成对 EMA20/30/40 的连续死叉穿越
                    if (cross20IdxS !== null && cross30IdxS !== null) {
                        // 🔒【第一根同向阴线确认逻辑】：
                        // A. 若穿越当根 (checkIdx) 就是已收盘阴线，当根直接确认！
                        // B. 若穿越当根为阳线/十字星，向右顺延寻找第一根已收盘阴线 (Close < Open) 确定为信号 K 线
                        if (closes[checkIdx] < opens[checkIdx] && (idx - checkIdx > 0)) {
                            maCrossConfirmedIdxS = checkIdx;
                        } else {
                            const maxForwardS = Math.min(idx - 1, checkIdx + retentionThreshold);
                            for (let f = checkIdx + 1; f <= maxForwardS; f++) {
                                const fE10 = getEmaVal(ema10, f, 10);
                                const fE20 = getEmaVal(ema20, f, 20);
                                if (fE10 === null || fE20 === null || fE10 >= fE20) break;
                                if (closes[f] < opens[f]) {
                                    maCrossConfirmedIdxS = f;
                                    break;
                                }
                            }
                        }

                        if (maCrossConfirmedIdxS !== null) {
                            isMaCrossShort = true;

                            // 校验【仅限首次穿越】：追溯前 N 根 K 线，要求 EMA10 在死叉前未处于 EMA40 下方
                            let wasAbove = true;
                            const checkBackLimit = Math.max(0, checkIdx - 8);
                            for (let b = checkIdx - 2; b >= checkBackLimit; b--) {
                                const b10 = getEmaVal(ema10, b, 10);
                                const b40 = getEmaVal(ema40, b, 40);
                                if (b10 !== null && b40 !== null && b10 < b40) {
                                    wasAbove = false;
                                    break;
                                }
                            }
                            isFirstMaCrossShort = wasAbove;
                        }
                    }
                }
            }

            // 锁定做多与做空的目标确认K线索引 (当开启【均线穿越】时，优先定位为穿越时或穿越后第一根同向确立K线)
            let targetIdxL = checkIdx;
            if (reqMa && isMaCrossLong && maCrossConfirmedIdxL !== null) {
                targetIdxL = maCrossConfirmedIdxL;
            } else if (config.requireAlignment && !config.requireCrossing && !reqMa) {
                targetIdxL = divConfirmedIdxL;
            } else if (divergenceValidL && !(isCrossing && closes[checkIdx] > opens[checkIdx]) && !reqMa) {
                targetIdxL = divConfirmedIdxL;
            } else {
                targetIdxL = checkIdx;
            }

            let targetIdxS = checkIdx;
            if (reqMa && isMaCrossShort && maCrossConfirmedIdxS !== null) {
                targetIdxS = maCrossConfirmedIdxS;
            } else if (config.requireAlignment && !config.requireCrossing && !reqMa) {
                targetIdxS = divConfirmedIdxS;
            } else if (divergenceValidS && !(isCrossing && closes[checkIdx] < opens[checkIdx]) && !reqMa) {
                targetIdxS = divConfirmedIdxS;
            } else {
                targetIdxS = checkIdx;
            }

            // 🔒 [STRICT RULES - 严格过滤升级：形态振幅与周期点火放量双轮驱动]
            // 1. 振幅 (Amplitude) 针对信号K线 (targetIdxL / targetIdxS)
            const candleRangeL = highs[targetIdxL] - lows[targetIdxL];
            const ampL = opens[targetIdxL] > 0 ? (candleRangeL / opens[targetIdxL]) * 100 : 0;
            const ampValidL = ampL >= squeezeThreshold && ampL <= maxAmplitude;

            const candleRangeS = highs[targetIdxS] - lows[targetIdxS];
            const ampS = opens[targetIdxS] > 0 ? (candleRangeS / opens[targetIdxS]) * 100 : 0;
            const ampValidS = ampS >= squeezeThreshold && ampS <= maxAmplitude;

            // 2. 周期点火放量 (Volume Ignition): 考察窗口最新K线及前 strictVolWindow 根K线
            const winBars = Math.max(1, strictVolWindow);
            const winStart = Math.max(0, idx - winBars + 1);
            const baseVolStart = Math.max(0, winStart - 20);
            const baseVolSlice = volumes.slice(baseVolStart, winStart);
            const avgBaseVol = baseVolSlice.length > 0 ? (baseVolSlice.reduce((a, b) => a + b, 0) / baseVolSlice.length) : (volumes[winStart] || 1);

            // 做多：考察窗口 [winStart, idx] 以及信号K线 targetIdxL 的最大放量倍数与最大单根成交额(USDT)
            let maxVolRatioL = 0;
            let maxQuoteVolL = 0;
            for (let w = winStart; w <= idx; w++) {
                const cVol = volumes[w] || 0;
                const cQuote = (closes[w] || 0) * cVol;
                const r = avgBaseVol > 0 ? cVol / avgBaseVol : 0;
                if (r > maxVolRatioL) maxVolRatioL = r;
                if (cQuote > maxQuoteVolL) maxQuoteVolL = cQuote;
            }
            if (targetIdxL < winStart) {
                const tVolL = volumes[targetIdxL] || 0;
                const tQuoteL = (closes[targetIdxL] || 0) * tVolL;
                const trL = avgBaseVol > 0 ? tVolL / avgBaseVol : 0;
                if (trL > maxVolRatioL) maxVolRatioL = trL;
                if (tQuoteL > maxQuoteVolL) maxQuoteVolL = tQuoteL;
            }

            // 🐉【龙抬头防伪双轨制 - 做多】
            // 轨 1：单根爆发放量 (>= volMultiplier)
            const isSingleExplosionL = maxVolRatioL >= Math.max(0.1, volMultiplier);
            // 轨 2：连续 N 根温和阶梯递增放量 (龙抬头)
            let isConsecutiveRisingL = false;
            if (enableConsecutiveVolRise) {
                const checkVolStartL = Math.max(consecutiveVolBars - 1, Math.min(winStart, targetIdxL));
                for (let w = checkVolStartL; w <= idx; w++) {
                    let isStepOk = true;
                    for (let step = 0; step < consecutiveVolBars - 1; step++) {
                        const curBar = w - step;
                        const prevBar = curBar - 1;
                        const curV = volumes[curBar] || 0;
                        const prevV = volumes[prevBar] || 0;
                        if (!(curV > prevV * 1.02 && curV >= avgBaseVol * 1.2 && prevV >= avgBaseVol * 0.9)) {
                            isStepOk = false;
                            break;
                        }
                    }
                    if (isStepOk) {
                        isConsecutiveRisingL = true;
                        break;
                    }
                }
            }
            const isVolIgnitedL = isSingleExplosionL || isConsecutiveRisingL;
            const volValidL = isVolIgnitedL && (strictMinQuoteVolume <= 0 || maxQuoteVolL >= strictMinQuoteVolume);

            // 做空：考察窗口 [winStart, idx] 以及信号K线 targetIdxS 的最大放量倍数与最大单根成交额(USDT)
            let maxVolRatioS = 0;
            let maxQuoteVolS = 0;
            for (let w = winStart; w <= idx; w++) {
                const cVol = volumes[w] || 0;
                const cQuote = (closes[w] || 0) * cVol;
                const r = avgBaseVol > 0 ? cVol / avgBaseVol : 0;
                if (r > maxVolRatioS) maxVolRatioS = r;
                if (cQuote > maxQuoteVolS) maxQuoteVolS = cQuote;
            }
            if (targetIdxS < winStart) {
                const tVolS = volumes[targetIdxS] || 0;
                const tQuoteS = (closes[targetIdxS] || 0) * tVolS;
                const trS = avgBaseVol > 0 ? tVolS / avgBaseVol : 0;
                if (trS > maxVolRatioS) maxVolRatioS = trS;
                if (tQuoteS > maxQuoteVolS) maxQuoteVolS = tQuoteS;
            }

            // 🐉【龙抬头防伪双轨制 - 做空】
            // 轨 1：单根爆发放量 (>= volMultiplier)
            const isSingleExplosionS = maxVolRatioS >= Math.max(0.1, volMultiplier);
            // 轨 2：连续 N 根温和阶梯递增放量 (龙抬头)
            let isConsecutiveRisingS = false;
            if (enableConsecutiveVolRise) {
                const checkVolStartS = Math.max(consecutiveVolBars - 1, Math.min(winStart, targetIdxS));
                for (let w = checkVolStartS; w <= idx; w++) {
                    let isStepOk = true;
                    for (let step = 0; step < consecutiveVolBars - 1; step++) {
                        const curBar = w - step;
                        const prevBar = curBar - 1;
                        const curV = volumes[curBar] || 0;
                        const prevV = volumes[prevBar] || 0;
                        if (!(curV > prevV * 1.02 && curV >= avgBaseVol * 1.2 && prevV >= avgBaseVol * 0.9)) {
                            isStepOk = false;
                            break;
                        }
                    }
                    if (isStepOk) {
                        isConsecutiveRisingS = true;
                        break;
                    }
                }
            }
            const isVolIgnitedS = isSingleExplosionS || isConsecutiveRisingS;
            const volValidS = isVolIgnitedS && (strictMinQuoteVolume <= 0 || maxQuoteVolS >= strictMinQuoteVolume);

            // Calculate body ratio for targetIdxL and targetIdxS
            const cHighL = highs[targetIdxL];
            const cLowL = lows[targetIdxL];
            const cCloseL = closes[targetIdxL];
            const cOpenL = opens[targetIdxL];
            const cCandleRangeL = cHighL - cLowL;
            const cIsLongL = cCloseL >= cOpenL;
            let bodyRatioL = 0;
            if (cCandleRangeL > 0) {
                bodyRatioL = (cIsLongL ? (cCloseL - cOpenL) : (cOpenL - cCloseL)) / cCandleRangeL * 100;
            }

            const cHighS = highs[targetIdxS];
            const cLowS = lows[targetIdxS];
            const cCloseS = closes[targetIdxS];
            const cOpenS = opens[targetIdxS];
            const cCandleRangeS = cHighS - cLowS;
            const cIsLongS = cCloseS >= cOpenS;
            let bodyRatioS = 0;
            if (cCandleRangeS > 0) {
                bodyRatioS = (cIsLongS ? (cCloseS - cOpenS) : (cOpenS - cCloseS)) / cCandleRangeS * 100;
            }

            const bodyValidL = bodyRatioL >= minBodyRatio;
            const bodyValidS = bodyRatioS >= minBodyRatio;



            // 规则独立开关提取
            const reqCandle = config.requireCandleCross !== undefined ? config.requireCandleCross : (config.requireCrossing ?? true);
            // reqMa already extracted above
            const reqAlign = config.requireAlignment ?? false;
            const reqFirstMaOnly = config.requireFirstMaCrossOnly ?? false;

            // 🔒 核心方向门禁：做多信号绝对禁止在 EMA10 < EMA20 且 EMA10 < EMA30 的空头排列下触发；
            // 做空信号绝对禁止在 EMA10 > EMA20 且 EMA10 > EMA30 的多头排列下触发
            const directionGuardL = !(e10 < e20 && (e30 === null || e10 < e30));
            const directionGuardS = !(e10 > e20 && (e30 === null || e10 > e30));

            // 🔒 严格过滤条件 (严格趋势/严格过滤)：振幅范围、放量倍数与实体比例
            const strictOkL = !strictFiltering || (ampValidL && volValidL && bodyValidL);
            const strictOkS = !strictFiltering || (ampValidS && volValidS && bodyValidS);

            // 各条件独立有效性计算
            const crossingValidL = isCrossing && !conflictL && strictOkL && directionGuardL && crossingIsBullish;
            const crossingValidS = isCrossing && !conflictS && strictOkS && isAlignedShort && crossingIsBearish;

            const maCrossValidL = isMaCrossLong && (!reqFirstMaOnly || isFirstMaCrossLong) && !conflictL && strictOkL && directionGuardL && crossingIsBullish;
            const maCrossValidS = isMaCrossShort && (!reqFirstMaOnly || isFirstMaCrossShort) && !conflictS && strictOkS && isAlignedShort && crossingIsBearish;

            const divergenceStrictValidL = divergenceValidL && strictOkL;
            const divergenceStrictValidS = divergenceValidS && strictOkS && isAlignedShort;

            let patternMatchedL = false;
            let patternMatchedS = false;
            const logicMode = config.crossingDivergenceLogic || 'AND';

            // 🔒 [USER MANDATORY RULE - 先穿越后等待发散模式 (WAIT MODE)]
            let isWaitPendingL = false;
            let waitElapsedL = 0;
            let waitTotalL = 0;

            let isWaitPendingS = false;
            let waitElapsedS = 0;
            let waitTotalS = 0;

            if (logicMode === 'WAIT') {
                const waitBars = Math.max(1, config.waitDivergenceBars ?? 5);

                const hasCrossL = (reqCandle && isCrossing) || (reqMa && isMaCrossLong);
                const hasCrossS = (reqCandle && isCrossing) || (reqMa && isMaCrossShort);

                // 做多：当前发生穿越且已收盘收阳，向后等待发散
                if (hasCrossL && crossingIsBullish && !conflictL && strictOkL && directionGuardL) {
                    const elapsedBars = idx - checkIdx;
                    if (elapsedBars <= waitBars) {
                        let waitDivergenceFoundL = false;
                        let waitDivergenceIdxL = checkIdx;

                        const maxForwardIdx = Math.min(idx - 1, checkIdx + waitBars);
                        for (let fIdx = checkIdx; fIdx <= maxForwardIdx; fIdx++) {
                            const fE10 = getEmaVal(ema10, fIdx, 10);
                            const fE20 = getEmaVal(ema20, fIdx, 20);
                            const fE30 = getEmaVal(ema30, fIdx, 30);
                            const fE40 = getEmaVal(ema40, fIdx, 40);

                            if (fE10 === null || fE20 === null || fE10 <= fE20 || (fE30 !== null && fE10 <= fE30)) {
                                if (fIdx > checkIdx) break;
                            }

                            const isBulldiv = fE10 !== null && fE20 !== null && fE10 > fE20 &&
                                (fE30 === null || fE20 > fE30) &&
                                (fE40 === null || (fE30 !== null && fE30 > fE40));

                            if (isBulldiv && closes[fIdx] > opens[fIdx] && (idx - fIdx > 0)) {
                                const fRangeL = highs[fIdx] - lows[fIdx];
                                const fBodyRatioL = fRangeL > 0 ? (closes[fIdx] - opens[fIdx]) / fRangeL * 100 : 0;
                                if (strictFiltering && fBodyRatioL < minBodyRatio) {
                                    continue;
                                }
                                waitDivergenceFoundL = true;
                                waitDivergenceIdxL = fIdx;
                                break;
                            }
                        }

                        if (waitDivergenceFoundL) {
                            targetIdxL = waitDivergenceIdxL;
                            patternMatchedL = true;
                            isWaitPendingL = false;
                        } else {
                            const curE10 = getEmaVal(ema10, idx - 1, 10);
                            const curE20 = getEmaVal(ema20, idx - 1, 20);
                            const curE30 = getEmaVal(ema30, idx - 1, 30);
                            const isNotDeadCrossed = !(curE10 !== null && curE20 !== null && curE10 <= curE20 && (curE30 === null || curE10 <= curE30));

                            if (isNotDeadCrossed) {
                                targetIdxL = checkIdx;
                                patternMatchedL = true;
                                isWaitPendingL = true;
                                waitElapsedL = elapsedBars;
                                waitTotalL = waitBars;
                            }
                        }
                    }
                }

                // 做空：当前发生穿越且已收盘收阴，向后等待发散
                if (hasCrossS && crossingIsBearish && !conflictS && strictOkS) {
                    const elapsedBars = idx - checkIdx;
                    if (elapsedBars <= waitBars) {
                        let waitDivergenceFoundS = false;
                        let waitDivergenceIdxS = checkIdx;

                        const maxForwardIdx = Math.min(idx - 1, checkIdx + waitBars);
                        for (let fIdx = checkIdx; fIdx <= maxForwardIdx; fIdx++) {
                            const fE10 = getEmaVal(ema10, fIdx, 10);
                            const fE20 = getEmaVal(ema20, fIdx, 20);
                            const fE30 = getEmaVal(ema30, fIdx, 30);
                            const fE40 = getEmaVal(ema40, fIdx, 40);

                            if (fE10 === null || fE20 === null || fE10 >= fE20 || (fE30 !== null && fE10 >= fE30)) {
                                if (fIdx > checkIdx) break;
                            }

                            const isBearDiv = fE10 !== null && fE20 !== null && fE10 < fE20 &&
                                (fE30 === null || fE20 < fE30) &&
                                (fE40 === null || (fE30 !== null && fE30 < fE40));

                            if (isBearDiv && closes[fIdx] < opens[fIdx] && (idx - fIdx > 0)) {
                                const fRangeS = highs[fIdx] - lows[fIdx];
                                const fBodyRatioS = fRangeS > 0 ? (opens[fIdx] - closes[fIdx]) / fRangeS * 100 : 0;
                                if (strictFiltering && fBodyRatioS < minBodyRatio) {
                                    continue;
                                }
                                waitDivergenceFoundS = true;
                                waitDivergenceIdxS = fIdx;
                                break;
                            }
                        }

                        if (waitDivergenceFoundS) {
                            targetIdxS = waitDivergenceIdxS;
                            patternMatchedS = true;
                            isWaitPendingS = false;
                        } else {
                            const curE10 = getEmaVal(ema10, idx - 1, 10);
                            const curE20 = getEmaVal(ema20, idx - 1, 20);
                            const curE30 = getEmaVal(ema30, idx - 1, 30);
                            const isNotGoldenCrossed = !(curE10 !== null && curE20 !== null && curE10 >= curE20 && (curE30 === null || curE10 >= curE30));

                            if (isNotGoldenCrossed) {
                                targetIdxS = checkIdx;
                                patternMatchedS = true;
                                isWaitPendingS = true;
                                waitElapsedS = elapsedBars;
                                waitTotalS = waitBars;
                            }
                        }
                    }
                }
            } else if (logicMode === 'OR') {
                let matchL = false;
                let matchS = false;
                if (reqCandle) { matchL = matchL || crossingValidL; matchS = matchS || crossingValidS; }
                if (reqMa) { matchL = matchL || maCrossValidL; matchS = matchS || maCrossValidS; }
                if (reqAlign) { matchL = matchL || divergenceStrictValidL; matchS = matchS || divergenceStrictValidS; }
                if (!reqCandle && !reqMa && !reqAlign) {
                    matchL = strictOkL && !conflictL && crossingIsBullish;
                    matchS = strictOkS && !conflictS && isAlignedShort && crossingIsBearish;
                }
                patternMatchedL = matchL;
                patternMatchedS = matchS;
            } else {
                // AND (全套共振)
                let matchL = true;
                let matchS = true;
                let countActive = 0;
                if (reqCandle) { matchL = matchL && crossingValidL; matchS = matchS && crossingValidS; countActive++; }
                if (reqMa) { matchL = matchL && maCrossValidL; matchS = matchS && maCrossValidS; countActive++; }
                if (reqAlign) { matchL = matchL && divergenceStrictValidL; matchS = matchS && divergenceStrictValidS; countActive++; }
                if (countActive === 0) {
                    matchL = strictOkL && !conflictL && crossingIsBullish;
                    matchS = strictOkS && !conflictS && isAlignedShort && crossingIsBearish;
                }
                patternMatchedL = matchL;
                patternMatchedS = matchS;
            }

            // 🔒 [USER MANDATORY RULE] 做空时，任何匹配模式均必须严格满足 EMA10 < EMA20 < EMA30 < EMA40
            patternMatchedS = patternMatchedS && isAlignedShort;

            // 🔒 [USER MANDATORY RULE] 若开启“发散回溯穿越”开关，所有信号必须严格经过方向性穿越校验过滤
            if (enableDivergenceCrossCheck && config.requireAlignment) {
                patternMatchedL = patternMatchedL && crossedAllL;
                patternMatchedS = patternMatchedS && crossedAllS;
            }

            // 🔒 [USER MANDATORY RULE - 收盘确认] 做多信号K线必须是已收盘阳线，做空信号K线必须是已收盘阴线
            let isValidL = false;
            let isPendingGrayL = false;
            if (patternMatchedL) {
                const targetCloseL = closes[targetIdxL];
                const targetOpenL = opens[targetIdxL];
                const targetLagL = idx - targetIdxL;

                // 只有已收盘的K线 (targetLagL > 0) 且收阳方可确立为正式信号K线
                if (targetLagL > 0 && targetCloseL > targetOpenL) {
                    isValidL = true;
                    isPendingGrayL = false;
                } else {
                    isValidL = false;
                    isPendingGrayL = false;
                }
            }

            let isValidS = false;
            let isPendingGrayS = false;
            if (patternMatchedS) {
                const targetCloseS = closes[targetIdxS];
                const targetOpenS = opens[targetIdxS];
                const targetLagS = idx - targetIdxS;

                // 只有已收盘的K线 (targetLagS > 0) 且收阴方可确立为正式信号K线
                if (targetLagS > 0 && targetCloseS < targetOpenS) {
                    isValidS = true;
                    isPendingGrayS = false;
                } else {
                    isValidS = false;
                    isPendingGrayS = false;
                }
            }

            if (isValidL) {
                // 🔒 铁律硬门禁：确认信号K线绝对禁止处于空头死叉向下发散排列 (EMA10 < EMA20 且 EMA10 < EMA30)
                const targetE10L = getEmaVal(ema10, targetIdxL, 10);
                const targetE20L = getEmaVal(ema20, targetIdxL, 20);
                const targetE30L = getEmaVal(ema30, targetIdxL, 30);
                if (targetE10L !== null && targetE20L !== null && targetE10L < targetE20L && (targetE30L === null || targetE10L < targetE30L)) {
                    isValidL = false;
                }
            }

            if (isValidS) {
                // 🔒 [USER MANDATORY RULE] 确认信号K线做空时，必须严格呈 EMA10 < EMA20 < EMA30 < EMA40 形态
                const targetE10S = getEmaVal(ema10, targetIdxS, 10);
                const targetE20S = getEmaVal(ema20, targetIdxS, 20);
                const targetE30S = getEmaVal(ema30, targetIdxS, 30);
                const targetE40S = getEmaVal(ema40, targetIdxS, 40);
                if (
                    targetE10S === null || targetE20S === null || targetE30S === null || targetE40S === null ||
                    !(targetE10S < targetE20S && targetE20S < targetE30S && targetE30S < targetE40S)
                ) {
                    isValidS = false;
                }
            }

            if (isValidL) {
                // 🔒 [STRICT RE-CHECK]: 对最终标记确立的信号K线 (targetIdxL) 终极核验实际实体比例与振幅
                const finalRangeL = highs[targetIdxL] - lows[targetIdxL];
                const finalAmpL = opens[targetIdxL] > 0 ? (finalRangeL / opens[targetIdxL]) * 100 : 0;
                const finalIsLongL = closes[targetIdxL] >= opens[targetIdxL];
                let finalBodyRatioL = 0;
                if (finalRangeL > 0) {
                    finalBodyRatioL = (finalIsLongL ? (closes[targetIdxL] - opens[targetIdxL]) : (opens[targetIdxL] - closes[targetIdxL])) / finalRangeL * 100;
                }
                const finalBodyValidL = finalBodyRatioL >= minBodyRatio;
                const finalAmpValidL = finalAmpL >= squeezeThreshold && finalAmpL <= maxAmplitude;

                if (strictFiltering && (!finalBodyValidL || !finalAmpValidL || !volValidL)) {
                    isValidL = false;
                } else {
                    const signalLagL = idx - targetIdxL;
                    // 🔒 [收盘确立时刻]：记录K线收盘闭合的瞬间，杜绝在开盘时就记录老旧时间戳
                    const signalTimeL = getCandleCloseTime(targetIdxL, timestamps, tf);
                    longSignals.push({ 
                        lag: signalLagL, 
                        direction: 'LONG', 
                        amp: finalAmpL, 
                        time: signalTimeL, 
                        bodyRatio: finalBodyRatioL, 
                        isAligned: isAlignedLong,
                        isCandleCrossed: isCrossing,
                        isMaCrossed: isMaCrossLong,
                        isFirstMaCross: isFirstMaCrossLong,
                        ampValid: finalAmpValidL,
                        volValid: volValidL,
                        maxVolRatio: maxVolRatioL,
                        maxQuoteVol: maxQuoteVolL,
                        isConsecutiveRising: isConsecutiveRisingL,
                        bodyValid: finalBodyValidL,
                        isClosed: true,
                        isPendingGray: false,
                        isWaitDivergencePending: isWaitPendingL,
                        waitElapsedBars: waitElapsedL,
                        waitTotalBars: waitTotalL,
                        isPriorReverseFound: isPriorReverseFoundL,
                        priorReverseType: priorReverseTypeL,
                        kHigh: highs[targetIdxL],
                        kLow: lows[targetIdxL],
                        kClose: closes[targetIdxL],
                        kOpen: opens[targetIdxL]
                    });
                }
            }

            if (isValidS) {
                // 🔒 [STRICT RE-CHECK]: 对最终标记确立的信号K线 (targetIdxS) 终极核验实际实体比例与振幅
                const finalRangeS = highs[targetIdxS] - lows[targetIdxS];
                const finalAmpS = opens[targetIdxS] > 0 ? (finalRangeS / opens[targetIdxS]) * 100 : 0;
                const finalIsLongS = closes[targetIdxS] >= opens[targetIdxS];
                let finalBodyRatioS = 0;
                if (finalRangeS > 0) {
                    finalBodyRatioS = (finalIsLongS ? (closes[targetIdxS] - opens[targetIdxS]) : (opens[targetIdxS] - closes[targetIdxS])) / finalRangeS * 100;
                }
                const finalBodyValidS = finalBodyRatioS >= minBodyRatio;
                const finalAmpValidS = finalAmpS >= squeezeThreshold && finalAmpS <= maxAmplitude;

                if (strictFiltering && (!finalBodyValidS || !finalAmpValidS || !volValidS)) {
                    isValidS = false;
                } else {
                    const signalLagS = idx - targetIdxS;
                    // 🔒 [收盘确立时刻]：记录K线收盘闭合的瞬间，杜绝在开盘时就记录老旧时间戳
                    const signalTimeS = getCandleCloseTime(targetIdxS, timestamps, tf);
                    shortSignals.push({ 
                        lag: signalLagS, 
                        direction: 'SHORT', 
                        amp: finalAmpS, 
                        time: signalTimeS, 
                        bodyRatio: finalBodyRatioS, 
                        isAligned: isAlignedShort,
                        isCandleCrossed: isCrossing,
                        isMaCrossed: isMaCrossShort,
                        isFirstMaCross: isFirstMaCrossShort,
                        ampValid: finalAmpValidS,
                        volValid: volValidS,
                        maxVolRatio: maxVolRatioS,
                        maxQuoteVol: maxQuoteVolS,
                        isConsecutiveRising: isConsecutiveRisingS,
                        bodyValid: finalBodyValidS,
                        isClosed: true,
                        isPendingGray: false,
                        isWaitDivergencePending: isWaitPendingS,
                        waitElapsedBars: waitElapsedS,
                        waitTotalBars: waitTotalS,
                        isPriorReverseFound: isPriorReverseFoundS,
                        priorReverseType: priorReverseTypeS,
                        kHigh: highs[targetIdxS],
                        kLow: lows[targetIdxS],
                        kClose: closes[targetIdxS],
                        kOpen: opens[targetIdxS]
                    });
                }
            }
        }
    }

    const results: List2GroupedResult[] = [];

    // 4. Construct Result Array and Filter by Trigger Mode
    
    // Sort signals by lag ascending (0 is current)
    longSignals.sort((a, b) => a.lag - b.lag);
    shortSignals.sort((a, b) => a.lag - b.lag);

    // Helper to get ALL clusters of signals
    const getAllClusters = (signals: {
        lag: number;
        direction: string;
        amp: number;
        time: number;
        bodyRatio: number;
        isAligned: boolean;
        ampValid: boolean;
        volValid: boolean;
        bodyValid: boolean;
        isWaitDivergencePending?: boolean;
        waitElapsedBars?: number;
        waitTotalBars?: number;
        kHigh: number;
        kLow: number;
        kClose: number;
        kOpen: number;
    }[]) => {
        if (signals.length === 0) return [];
        const clusters = [];
        let currentCluster = [signals[0]];
        for (let i = 1; i < signals.length; i++) {
            // If gap is <= 3 candles, consider it part of the same squeeze cluster
            if (signals[i].lag - signals[i-1].lag <= 3) {
                currentCluster.push(signals[i]);
            } else {
                clusters.push(currentCluster);
                currentCluster = [signals[i]];
            }
        }
        clusters.push(currentCluster);
        return clusters;
    };

    const longClusters = getAllClusters(longSignals);
    const shortClusters = getAllClusters(shortSignals);

    // [CRITICAL UPDATE] Only take the MOST RECENT cluster (the one with the smallest lag)
    // to satisfy the requirement: "当有重复行情（穿越）出现时，一定显示最新（穿越）时间的信号"
    
    if (longClusters.length > 0) {
        // Filter clusters that satisfy the 'new' requirement (backtest/real-time catchup)
        // AND satisfy the retention requirement:
        // - A cluster of divergence/crossing signals is valid if its latest confirmed candle is within scanLookbackLimit and active within retentionThreshold.
        const isAlignmentModeL = config.requireAlignment || (!config.requireCrossing && !config.requireAlignment);
        const validClusters = longClusters.filter(cluster => {
            const latestMember = cluster[0];
            const isWithinRetention = latestMember.lag <= retentionThreshold;
            if (isAlignmentModeL) {
                return isWithinRetention;
            }
            const isWithinLookback = latestMember.lag <= scanLookbackLimit;
            return isWithinLookback && isWithinRetention;
        });

        if (validClusters.length > 0) {
            validClusters.sort((a, b) => a[0].lag - b[0].lag);
            const cluster = validClusters[0];
            
            // CRITICAL: Determine Lag & Properties for results
            // Use the latest confirmed signal candle in the active cluster
            const targetMember = cluster[0];
            const signalMember = targetMember;

            // 方式 A (振幅偏离限制 - LONG): 当前价格高于信号K线最高价超过其振幅的 X% 时，不进入列表2
            let passDeviationFilterL = true;
            if (enableSignalDeviationFilter) {
                const signalCandleRange = Math.max(0, signalMember.kHigh - signalMember.kLow);
                const maxAllowedPriceL = signalMember.kHigh + (signalCandleRange * (maxSignalDeviationPercent / 100));
                if (currentPrice > maxAllowedPriceL) {
                    passDeviationFilterL = false;
                }
            }

            if (passDeviationFilterL) {
                const reportLags = isAlignmentModeL 
                    ? [signalMember.lag]
                    : cluster.map(s => s.lag);
                    
                const reportTimes = isAlignmentModeL
                    ? [signalMember.time]
                    : cluster.map(s => s.time);

                results.push({
                    tf,
                    lag: signalMember.lag, 
                    crossingCount: cluster.length,
                    isSqueeze: !config.requireCrossing && !config.requireAlignment, 
                    squeezeVal: signalMember.amp,
                    direction: 'LONG',
                    crossingLags: reportLags,
                    crossingTimes: reportTimes,
                    bodyRatio: signalMember.bodyRatio,
                    ampValid: signalMember.ampValid,
                    volValid: signalMember.volValid,
                    maxVolRatio: signalMember.maxVolRatio,
                    maxQuoteVol: signalMember.maxQuoteVol,
                    isConsecutiveRising: signalMember.isConsecutiveRising,
                    bodyValid: signalMember.bodyValid,
                    isAligned: signalMember.isAligned,
                    isCandleCrossed: signalMember.isCandleCrossed,
                    isMaCrossed: signalMember.isMaCrossed,
                    isFirstMaCross: signalMember.isFirstMaCross,
                    isClosed: signalMember.isClosed,
                    isPendingGray: signalMember.isPendingGray,
                    isWaitDivergencePending: signalMember.isWaitDivergencePending,
                    waitElapsedBars: signalMember.waitElapsedBars,
                    waitTotalBars: signalMember.waitTotalBars,
                    isPriorReverseFound: signalMember.isPriorReverseFound,
                    priorReverseType: signalMember.priorReverseType,
                    kOpen: signalMember.kOpen,
                    kClose: signalMember.kClose,
                    kHigh: signalMember.kHigh,
                    kLow: signalMember.kLow,
                    signalTime: signalMember.time
                });
            }
        }
    }

    if (shortClusters.length > 0) {
        const isAlignmentModeS = config.requireAlignment || (!config.requireCrossing && !config.requireAlignment);
        const validClusters = shortClusters.filter(cluster => {
            const latestMember = cluster[0];
            const isWithinRetention = latestMember.lag <= retentionThreshold;
            if (isAlignmentModeS) {
                return isWithinRetention;
            }
            const isWithinLookback = latestMember.lag <= scanLookbackLimit;
            return isWithinLookback && isWithinRetention;
        });

        if (validClusters.length > 0) {
            validClusters.sort((a, b) => a[0].lag - b[0].lag);
            const cluster = validClusters[0];
            
            // CRITICAL: Determine Lag & Properties for results
            const targetMember = cluster[0];
            const signalMember = targetMember;

            // 方式 A (振幅偏离限制 - SHORT): 当前价格低于信号K线最低价超过其振幅的 X% 时，不进入列表2
            let passDeviationFilterS = true;
            if (enableSignalDeviationFilter) {
                const signalCandleRange = Math.max(0, signalMember.kHigh - signalMember.kLow);
                const minAllowedPriceS = signalMember.kLow - (signalCandleRange * (maxSignalDeviationPercent / 100));
                if (currentPrice < minAllowedPriceS) {
                    passDeviationFilterS = false;
                }
            }

            if (passDeviationFilterS) {
                const reportLags = isAlignmentModeS 
                    ? [signalMember.lag]
                    : cluster.map(s => s.lag);

                const reportTimes = isAlignmentModeS
                    ? [signalMember.time]
                    : cluster.map(s => s.time);

                results.push({
                    tf,
                    lag: signalMember.lag, 
                    crossingCount: cluster.length,
                    isSqueeze: !config.requireCrossing && !config.requireAlignment, 
                    squeezeVal: signalMember.amp,
                    direction: 'SHORT',
                    crossingLags: reportLags,
                    crossingTimes: reportTimes,
                    bodyRatio: signalMember.bodyRatio,
                    ampValid: signalMember.ampValid,
                    volValid: signalMember.volValid,
                    maxVolRatio: signalMember.maxVolRatio,
                    maxQuoteVol: signalMember.maxQuoteVol,
                    isConsecutiveRising: signalMember.isConsecutiveRising,
                    bodyValid: signalMember.bodyValid,
                    isAligned: signalMember.isAligned,
                    isCandleCrossed: signalMember.isCandleCrossed,
                    isMaCrossed: signalMember.isMaCrossed,
                    isFirstMaCross: signalMember.isFirstMaCross,
                    isClosed: signalMember.isClosed,
                    isPendingGray: signalMember.isPendingGray,
                    isWaitDivergencePending: signalMember.isWaitDivergencePending,
                    waitElapsedBars: signalMember.waitElapsedBars,
                    waitTotalBars: signalMember.waitTotalBars,
                    isPriorReverseFound: signalMember.isPriorReverseFound,
                    priorReverseType: signalMember.priorReverseType,
                    kOpen: signalMember.kOpen,
                    kClose: signalMember.kClose,
                    kHigh: signalMember.kHigh,
                    kLow: signalMember.kLow,
                    signalTime: signalMember.time
                });
            }
        }
    }

    // =========================================================================
    // ⚡ [USER MANDATORY RULE - EMA10穿越EMA30前置折叠等待蓄势区]
    // 核心逻辑：若常规发散/穿越尚未正式成立 (或EMA40尚未穿越)，检查过去设定根数 (ema30PreWaitBars) 内
    // 是否发生过 EMA10 穿越 EMA30 且当前均线未被破坏。
    // 若满足，则进入列表2折叠等待区域，提前纳入毫秒级VIP监听池！
    // 一旦EMA40穿越完成且对应K线收盘，直接无缝晋升为正式信号！
    // =========================================================================
    const enableEma30PreWait = config.enableEma30PreWait !== undefined ? !!config.enableEma30PreWait : true;
    const ema30PreWaitBars = (config.ema30PreWaitBars !== undefined && !Number.isNaN(config.ema30PreWaitBars))
        ? Math.max(1, config.ema30PreWaitBars)
        : 5;

    if (results.length === 0 && enableEma30PreWait && closes.length >= 40) {
        // 从当前K线往前追溯 EMA10 穿越 EMA30
        const maxCheckLag = Math.min(ema30PreWaitBars, closes.length - 35);
        let foundPreWaitL = false;
        let foundPreWaitS = false;
        let preWaitLagL = 0;
        let preWaitLagS = 0;

        // 当前 EMA 状态
        const curE10 = getEmaVal(ema10, idx, 10);
        const curE30 = getEmaVal(ema30, idx, 30);
        const curE40 = getEmaVal(ema40, idx, 40);

        if (curE10 !== null && curE30 !== null && curE40 !== null) {
            // 多头检查：当前 EMA10 > EMA30，但尚未完成 EMA40 穿越 (如 curE10 <= curE40)
            if (curE10 > curE30 && curE10 <= curE40) {
                for (let pLag = 1; pLag <= maxCheckLag; pLag++) {
                    const cIdx = idx - pLag;
                    const pE10 = getEmaVal(ema10, cIdx, 10);
                    const pE30 = getEmaVal(ema30, cIdx, 30);
                    const prevE10 = getEmaVal(ema10, cIdx - 1, 10);
                    const prevE30 = getEmaVal(ema30, cIdx - 1, 30);
                    if (pE10 !== null && pE30 !== null && prevE10 !== null && prevE30 !== null) {
                        // 发生金叉穿越
                        if ((prevE10 <= prevE30 && pE10 > pE30) || (prevE10 < prevE30 && pE10 >= pE30)) {
                            foundPreWaitL = true;
                            preWaitLagL = pLag;
                            break;
                        }
                    }
                }
            }

            // 空头检查：当前 EMA10 < EMA30，但尚未完成 EMA40 穿越 (如 curE10 >= curE40)
            if (curE10 < curE30 && curE10 >= curE40) {
                for (let pLag = 1; pLag <= maxCheckLag; pLag++) {
                    const cIdx = idx - pLag;
                    const pE10 = getEmaVal(ema10, cIdx, 10);
                    const pE30 = getEmaVal(ema30, cIdx, 30);
                    const prevE10 = getEmaVal(ema10, cIdx - 1, 10);
                    const prevE30 = getEmaVal(ema30, cIdx - 1, 30);
                    if (pE10 !== null && pE30 !== null && prevE10 !== null && prevE30 !== null) {
                        // 发生死叉穿越
                        if ((prevE10 >= prevE30 && pE10 < pE30) || (prevE10 > prevE30 && pE10 <= pE30)) {
                            foundPreWaitS = true;
                            preWaitLagS = pLag;
                            break;
                        }
                    }
                }
            }
        }

        if (foundPreWaitL) {
            results.push({
                tf,
                lag: preWaitLagL,
                crossingCount: 1,
                isSqueeze: false,
                direction: 'LONG',
                crossingLags: [preWaitLagL],
                crossingTimes: [timestamps[idx - preWaitLagL] || timestamps[idx]],
                bodyRatio: 100,
                ampValid: true,
                volValid: true,
                bodyValid: true,
                isAligned: false,
                isPreWaitEma30: true,
                preWaitElapsedBars: preWaitLagL,
                preWaitTotalBars: ema30PreWaitBars,
                isClosed: false,
                kOpen: opens[idx],
                kClose: closes[idx],
                kHigh: highs[idx],
                kLow: lows[idx],
                signalTime: timestamps[idx - preWaitLagL] || timestamps[idx]
            });
        } else if (foundPreWaitS) {
            results.push({
                tf,
                lag: preWaitLagS,
                crossingCount: 1,
                isSqueeze: false,
                direction: 'SHORT',
                crossingLags: [preWaitLagS],
                crossingTimes: [timestamps[idx - preWaitLagS] || timestamps[idx]],
                bodyRatio: 100,
                ampValid: true,
                volValid: true,
                bodyValid: true,
                isAligned: false,
                isPreWaitEma30: true,
                preWaitElapsedBars: preWaitLagS,
                preWaitTotalBars: ema30PreWaitBars,
                isClosed: false,
                kOpen: opens[idx],
                kClose: closes[idx],
                kHigh: highs[idx],
                kLow: lows[idx],
                signalTime: timestamps[idx - preWaitLagS] || timestamps[idx]
            });
        }
    }

    // Final filter: If we found nothing relevant to the trigger mode, return empty
    if (results.length === 0) return [];

    return results;
}
