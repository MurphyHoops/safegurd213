
/**
 * [REAL-TIME MODE CODE LOCK - LIST 2 (GRAND CROSSING)]
 * CRITICAL: The core rules, logic, and configuration for List 2 (Grand Crossing)
 * are now STRICTLY LOCKED and MUST NOT be modified under any circumstances.
 * Secondary and double-verification filters are fully completed and locked.
 */

import { calculateEMA } from '../indicators';
import { List2Config, List2GroupedResult } from '../../components/Scanner/scannerTypes';

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
    const checkEma80Conflict = !!config.checkEma80Conflict;
    const enableFlatFilter = !!config.enableFlatFilter;
    const flatLookback = config.flatLookback !== undefined ? config.flatLookback : 50;
    const flatThreshold = config.flatThreshold !== undefined ? config.flatThreshold : 5;
    const strictFiltering = config.strictFiltering !== undefined ? config.strictFiltering : true;
    const enableDivergenceCrossCheck = config.enableDivergenceCrossCheck !== undefined ? !!config.enableDivergenceCrossCheck : true;
    const divergenceLookbackBars = (config.divergenceLookbackBars !== undefined && !Number.isNaN(config.divergenceLookbackBars)) ? Math.max(1, config.divergenceLookbackBars) : 20;
    const enableSignalDeviationFilter = !!config.enableSignalDeviationFilter;
    const maxSignalDeviationPercent = (config.maxSignalDeviationPercent !== undefined && !Number.isNaN(config.maxSignalDeviationPercent)) ? Math.max(0, config.maxSignalDeviationPercent) : 50;
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
    // Ensure we have enough data
    if (closes.length < 80) return [];

    const ema10 = calculateEMA(closes, 10);
    const ema20 = calculateEMA(closes, 20);
    const ema30 = calculateEMA(closes, 30);
    const ema40 = calculateEMA(closes, 40);
    const ema80 = calculateEMA(closes, 80);

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
        ampValid: boolean;
        volValid: boolean;
        bodyValid: boolean;
        isClosed: boolean;
        isPendingGray: boolean;
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
        ampValid: boolean;
        volValid: boolean;
        bodyValid: boolean;
        isClosed: boolean;
        isPendingGray: boolean;
        kHigh: number;
        kLow: number;
        kClose: number;
        kOpen: number;
    }[] = [];

    // 3. Loop through Lag Window (Scanning backwards from current candle)
    for (let lag = 0; lag <= effectiveScanRange; lag++) {
        const checkIdx = idx - lag;
        // Safety check: Ensure enough history for EMA80 calculation at this point
        if (checkIdx < 80) continue; 

        const e10 = getEmaVal(ema10, checkIdx, 10);
        const e20 = getEmaVal(ema20, checkIdx, 20);
        const e30 = getEmaVal(ema30, checkIdx, 30);
        const e40 = getEmaVal(ema40, checkIdx, 40);
        const e80 = getEmaVal(ema80, checkIdx, 80);

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

            // Core Condition 2: 发散回溯穿越 (Directional Lookback Crossing)
            let crossedAllL = true;
            let crossedAllS = true;

            if (enableDivergenceCrossCheck) {
                let crossed20L = false;
                let crossed30L = false;
                let crossed40L = false;

                let crossed20S = false;
                let crossed30S = false;
                let crossed40S = false;

                // Track if EMA10 was on the opposing side at any point in the lookback window
                let was10Below20 = false;
                let was10Below30 = false;
                let was10Below40 = false;

                let was10Above20 = false;
                let was10Above30 = false;
                let was10Above40 = false;

                for (let b = 0; b < divergenceLookbackBars; b++) {
                    const bIdx = checkIdx - b;
                    if (bIdx - 1 < 80) break;

                    const cur10 = getEmaVal(ema10, bIdx, 10);
                    const cur20 = getEmaVal(ema20, bIdx, 20);
                    const cur30 = getEmaVal(ema30, bIdx, 30);
                    const cur40 = getEmaVal(ema40, bIdx, 40);

                    const prev10 = getEmaVal(ema10, bIdx - 1, 10);
                    const prev20 = getEmaVal(ema20, bIdx - 1, 20);
                    const prev30 = getEmaVal(ema30, bIdx - 1, 30);
                    const prev40 = getEmaVal(ema40, bIdx - 1, 40);

                    if (cur10 !== null) {
                        if (cur20 !== null && cur10 <= cur20) was10Below20 = true;
                        if (cur30 !== null && cur10 <= cur30) was10Below30 = true;
                        if (cur40 !== null && cur10 <= cur40) was10Below40 = true;

                        if (cur20 !== null && cur10 >= cur20) was10Above20 = true;
                        if (cur30 !== null && cur10 >= cur30) was10Above30 = true;
                        if (cur40 !== null && cur10 >= cur40) was10Above40 = true;
                    }

                    if (cur10 !== null && prev10 !== null) {
                        // 做多：EMA10 向上穿越 EMA20 / EMA30 / EMA40
                        if (cur20 !== null && prev20 !== null) {
                            if ((prev10 <= prev20 && cur10 >= cur20) || (prev10 < prev20 && cur10 > cur20)) {
                                crossed20L = true;
                            }
                        }
                        if (cur30 !== null && prev30 !== null) {
                            if ((prev10 <= prev30 && cur10 >= cur30) || (prev10 < prev30 && cur10 > cur30)) {
                                crossed30L = true;
                            }
                        }
                        if (cur40 !== null && prev40 !== null) {
                            if ((prev10 <= prev40 && cur10 >= cur40) || (prev10 < prev40 && cur10 > cur40)) {
                                crossed40L = true;
                            }
                        }

                        // 做空：EMA10 向下穿越 EMA20 / EMA30 / EMA40
                        if (cur20 !== null && prev20 !== null) {
                            if ((prev10 >= prev20 && cur10 <= cur20) || (prev10 > prev20 && cur10 < cur20)) {
                                crossed20S = true;
                            }
                        }
                        if (cur30 !== null && prev30 !== null) {
                            if ((prev10 >= prev30 && cur10 <= cur30) || (prev10 > prev30 && cur10 < cur30)) {
                                crossed30S = true;
                            }
                        }
                        if (cur40 !== null && prev40 !== null) {
                            if ((prev10 >= prev40 && cur10 <= cur40) || (prev10 > prev40 && cur10 < cur40)) {
                                crossed40S = true;
                            }
                        }
                    }
                }

                // If currently bullish aligned (e10 > e20/30/40) and EMA10 was <= target within lookback window, it crossed!
                if (e10 > e20 && was10Below20) crossed20L = true;
                if (e10 > e30 && was10Below30) crossed30L = true;
                if (e10 > e40 && was10Below40) crossed40L = true;

                // If currently bearish aligned (e10 < e20/30/40) and EMA10 was >= target within lookback window, it crossed!
                if (e10 < e20 && was10Above20) crossed20S = true;
                if (e10 < e30 && was10Above30) crossed30S = true;
                if (e10 < e40 && was10Above40) crossed40S = true;

                // 🔒 [USER MANDATORY RULE] 当开启发散回溯穿越时：在 divergenceLookbackBars 根K线内，EMA10必须完成对EMA20/30/40的完整方向性穿越
                crossedAllL = crossed20L && crossed30L && crossed40L;
                crossedAllS = crossed20S && crossed30S && crossed40S;
            }

            // 核心前置门禁判断：发散与穿越双重校验必须同时通过
            const rawDivergenceValidL = isAlignedL && crossedAllL;
            const rawDivergenceValidS = isAlignedS && crossedAllS;

            // =========================================================================
            // 🔒 [USER MANDATORY RULE - 收盘确认机制 (Close-of-Candle Confirmation)]
            // 核心铁律：所有信号K线必须在【K线正式收盘】后方可判定确立（即 targetLag > 0，不随未收盘实时价格漂移）。
            // 多头发散：必须为已收盘阳线(Close > Open)。若发散时为阴线，在“信号存续/访问过去”(scanLookbackLimit)内
            //           向后寻找第一根已收盘阳线作为确认点；若超出设定根数仍未收阳，则本次发散形态彻底作废。
            // 空头发散：必须为已收盘阴线(Close < Open)。若发散时为阳线，在“信号存续/访问过去”(scanLookbackLimit)内
            //           向后寻找第一根已收盘阴线作为确认点；若超出设定根数仍未收阴，则本次发散形态彻底作废。
            // =========================================================================
            let divergenceValidL = false;
            let divConfirmedLagL = lag;
            let divConfirmedIdxL = checkIdx;
            let divIsPendingGrayL = false;

            if (rawDivergenceValidL && lag > 0) {
                if (kClose > kOpen) {
                    divergenceValidL = true;
                    divConfirmedLagL = lag;
                    divConfirmedIdxL = checkIdx;
                    divIsPendingGrayL = false;
                } else {
                    // 当前收盘不符，向右在 scanLookbackLimit 根K线内寻找第一根已收盘阳线 (fIdx < idx)
                    let foundBullish = false;
                    const maxForwardIdx = Math.min(idx - 1, checkIdx + scanLookbackLimit);
                    for (let fIdx = checkIdx + 1; fIdx <= maxForwardIdx; fIdx++) {
                        const fE10 = getEmaVal(ema10, fIdx, 10);
                        const fE20 = getEmaVal(ema20, fIdx, 20);
                        const fE30 = getEmaVal(ema30, fIdx, 30);
                        const fE40 = getEmaVal(ema40, fIdx, 40);

                        // 🔒 铁律门禁：向后寻找确认阳线期间，均线多头形态绝不可被破坏
                        // 若 EMA10 下穿 EMA20 或 EMA30，说明多头形态已彻底崩塌死叉，直接作废并立即终止
                        if (fE10 === null || fE20 === null || fE10 <= fE20 || (fE30 !== null && fE10 <= fE30)) {
                            break;
                        }

                        if (closes[fIdx] > opens[fIdx]) {
                            // 确认K线本身也必须保持多头排列 (EMA10 > EMA20 > EMA30)
                            const isStillBullish = fE30 !== null ? (fE10 > fE20 && fE20 > fE30) : (fE10 > fE20);
                            if (isStillBullish) {
                                divergenceValidL = true;
                                divConfirmedIdxL = fIdx;
                                divConfirmedLagL = idx - fIdx;
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

            let divergenceValidS = false;
            let divConfirmedLagS = lag;
            let divConfirmedIdxS = checkIdx;
            let divIsPendingGrayS = false;

            if (rawDivergenceValidS && lag > 0) {
                if (kClose < kOpen) {
                    divergenceValidS = true;
                    divConfirmedLagS = lag;
                    divConfirmedIdxS = checkIdx;
                    divIsPendingGrayS = false;
                } else {
                    // 当前收盘不符，向右在 scanLookbackLimit 根K线内寻找第一根已收盘阴线 (fIdx < idx)
                    let foundBearish = false;
                    const maxForwardIdx = Math.min(idx - 1, checkIdx + scanLookbackLimit);
                    for (let fIdx = checkIdx + 1; fIdx <= maxForwardIdx; fIdx++) {
                        const fE10 = getEmaVal(ema10, fIdx, 10);
                        const fE20 = getEmaVal(ema20, fIdx, 20);
                        const fE30 = getEmaVal(ema30, fIdx, 30);
                        const fE40 = getEmaVal(ema40, fIdx, 40);

                        // 🔒 铁律门禁：向后寻找确认阴线期间，均线空头形态绝不可被破坏
                        // 若 EMA10 上穿 EMA20 或 EMA30，说明空头形态已彻底反弹金叉，直接作废并立即终止
                        if (fE10 === null || fE20 === null || fE10 >= fE20 || (fE30 !== null && fE10 >= fE30)) {
                            break;
                        }

                        if (closes[fIdx] < opens[fIdx]) {
                            // 确认K线本身也必须保持空头排列 (EMA10 < EMA20 < EMA30)
                            const isStillBearish = fE30 !== null ? (fE10 < fE20 && fE20 < fE30) : (fE10 < fE20);
                            if (isStillBearish) {
                                divergenceValidS = true;
                                divConfirmedIdxS = fIdx;
                                divConfirmedLagS = idx - fIdx;
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

            // The Grand Crossing Rule: High touches Max EMA, Low touches Min EMA (Physical Intersection)
            const isCrossing = kHigh >= maxEma && kLow <= minEma;
            
            // 🔒 [USER MANDATORY RULE - 收盘确认] 做多信号K线必须是已收盘阳线 (Close > Open 且 lag > 0)；做空信号K线必须是已收盘阴线 (Close < Open 且 lag > 0)
            const crossingIsBullish = closes[checkIdx] > opens[checkIdx] && lag > 0;
            const crossingIsBearish = closes[checkIdx] < opens[checkIdx] && lag > 0;

            // 锁定做多与做空的目标确认K线索引 (优先采用符合阳/阴线条件的精确K线)
            let targetIdxL = checkIdx;
            if (config.requireAlignment && !config.requireCrossing) {
                targetIdxL = divConfirmedIdxL;
            } else if (divergenceValidL && !(isCrossing && closes[checkIdx] > opens[checkIdx])) {
                targetIdxL = divConfirmedIdxL;
            } else {
                targetIdxL = checkIdx;
            }

            let targetIdxS = checkIdx;
            if (config.requireAlignment && !config.requireCrossing) {
                targetIdxS = divConfirmedIdxS;
            } else if (divergenceValidS && !(isCrossing && closes[checkIdx] < opens[checkIdx])) {
                targetIdxS = divConfirmedIdxS;
            } else {
                targetIdxS = checkIdx;
            }

            // Amplitude and Volume for LONG signal candle
            const candleRangeL = highs[targetIdxL] - lows[targetIdxL];
            const ampL = opens[targetIdxL] > 0 ? (candleRangeL / opens[targetIdxL]) * 100 : 0;
            const volSliceL = volumes.slice(Math.max(0, targetIdxL - 20), targetIdxL);
            const avgVolL = volSliceL.length > 0 ? volSliceL.reduce((a, b) => a + b, 0) / volSliceL.length : 0;
            const volValidL = volumes[targetIdxL] >= (avgVolL * Math.max(0.1, volMultiplier));
            const ampValidL = ampL >= squeezeThreshold && ampL <= maxAmplitude;

            // Amplitude and Volume for SHORT signal candle
            const candleRangeS = highs[targetIdxS] - lows[targetIdxS];
            const ampS = opens[targetIdxS] > 0 ? (candleRangeS / opens[targetIdxS]) * 100 : 0;
            const volSliceS = volumes.slice(Math.max(0, targetIdxS - 20), targetIdxS);
            const avgVolS = volSliceS.length > 0 ? volSliceS.reduce((a, b) => a + b, 0) / volSliceS.length : 0;
            const volValidS = volumes[targetIdxS] >= (avgVolS * Math.max(0.1, volMultiplier));
            const ampValidS = ampS >= squeezeThreshold && ampS <= maxAmplitude;

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

            // Crossing Rules & Divergence Rules Evaluation with AND/OR Logic
            // 🔒 核心方向门禁：做多信号绝对禁止在 EMA10 < EMA20 且 EMA10 < EMA30 的空头排列下触发；
            // 做空信号绝对禁止在 EMA10 > EMA20 且 EMA10 > EMA30 的多头排列下触发
            const directionGuardL = !(e10 < e20 && (e30 === null || e10 < e30));
            const directionGuardS = !(e10 > e20 && (e30 === null || e10 > e30));

            // 🔒 严格过滤条件 (严格趋势/严格过滤)：振幅范围、放量倍数与实体比例
            const strictOkL = !strictFiltering || (ampValidL && volValidL && bodyValidL);
            const strictOkS = !strictFiltering || (ampValidS && volValidS && bodyValidS);

            // 🔒 [USER MANDATORY RULE] 做空时，必须严格呈 EMA10 < EMA20 < EMA30 < EMA40 形态才能入选列表2
            const crossingValidL = isCrossing && !conflictL && strictOkL && directionGuardL && crossingIsBullish;
            const crossingValidS = isCrossing && !conflictS && strictOkS && isAlignedShort && crossingIsBearish;

            const divergenceStrictValidL = divergenceValidL && strictOkL;
            const divergenceStrictValidS = divergenceValidS && strictOkS && isAlignedShort;

            let patternMatchedL = false;
            let patternMatchedS = false;
            const logicMode = config.crossingDivergenceLogic || 'AND';

            if (config.requireCrossing && config.requireAlignment) {
                if (logicMode === 'OR') {
                    patternMatchedL = crossingValidL || divergenceStrictValidL;
                    patternMatchedS = crossingValidS || divergenceStrictValidS;
                } else {
                    // AND
                    patternMatchedL = crossingValidL && divergenceStrictValidL;
                    patternMatchedS = crossingValidS && divergenceStrictValidS;
                }
            } else if (config.requireCrossing) {
                patternMatchedL = crossingValidL;
                patternMatchedS = crossingValidS;
            } else if (config.requireAlignment) {
                patternMatchedL = divergenceStrictValidL;
                patternMatchedS = divergenceStrictValidS;
            } else {
                // Squeeze fallback
                patternMatchedL = strictOkL && !conflictL && crossingIsBullish;
                patternMatchedS = strictOkS && !conflictS && isAlignedShort && crossingIsBearish;
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
                const signalLagL = idx - targetIdxL;
                const signalTimeL = timestamps[targetIdxL];
                longSignals.push({ 
                    lag: signalLagL, 
                    direction: 'LONG', 
                    amp: ampL, 
                    time: signalTimeL, 
                    bodyRatio: bodyRatioL, 
                    isAligned: isAlignedLong,
                    ampValid: ampValidL,
                    volValid: volValidL,
                    bodyValid: bodyValidL,
                    isClosed: true,
                    isPendingGray: false,
                    kHigh: highs[targetIdxL],
                    kLow: lows[targetIdxL],
                    kClose: closes[targetIdxL],
                    kOpen: opens[targetIdxL]
                });
            }

            if (isValidS) {
                const signalLagS = idx - targetIdxS;
                const signalTimeS = timestamps[targetIdxS];
                shortSignals.push({ 
                    lag: signalLagS, 
                    direction: 'SHORT', 
                    amp: ampS, 
                    time: signalTimeS, 
                    bodyRatio: bodyRatioS, 
                    isAligned: isAlignedShort,
                    ampValid: ampValidS,
                    volValid: volValidS,
                    bodyValid: bodyValidS,
                    isClosed: true,
                    isPendingGray: false,
                    kHigh: highs[targetIdxS],
                    kLow: lows[targetIdxS],
                    kClose: closes[targetIdxS],
                    kOpen: opens[targetIdxS]
                });
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
        // - In alignment mode, signal is born at oldestMember (first candle of divergence/crossing sequence).
        // - A cluster is valid ONLY if that signal candle was within scanLookbackLimit and has NOT exceeded retentionThreshold.
        const isAlignmentModeL = config.requireAlignment || (!config.requireCrossing && !config.requireAlignment);
        const validClusters = longClusters.filter(cluster => {
            const signalMember = isAlignmentModeL ? cluster[cluster.length - 1] : cluster[0];
            const isWithinLookback = signalMember.lag <= scanLookbackLimit;
            const isWithinRetention = signalMember.lag <= retentionThreshold;
            return isWithinLookback && isWithinRetention;
        });

        if (validClusters.length > 0) {
            validClusters.sort((a, b) => a[0].lag - b[0].lag);
            const cluster = validClusters[0];
            
            // CRITICAL: Determine Lag & Properties for results
            // In alignment mode, the signal anchor is oldestMember; in pure crossing, it is targetMember.
            const targetMember = cluster[0];
            const oldestMember = cluster[cluster.length - 1];
            const signalMember = isAlignmentModeL ? oldestMember : targetMember;

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
                    bodyValid: signalMember.bodyValid,
                    isAligned: signalMember.isAligned,
                    isClosed: signalMember.isClosed,
                    isPendingGray: signalMember.isPendingGray,
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
            const signalMember = isAlignmentModeS ? cluster[cluster.length - 1] : cluster[0];
            const isWithinLookback = signalMember.lag <= scanLookbackLimit;
            const isWithinRetention = signalMember.lag <= retentionThreshold;
            return isWithinLookback && isWithinRetention;
        });

        if (validClusters.length > 0) {
            validClusters.sort((a, b) => a[0].lag - b[0].lag);
            const cluster = validClusters[0];
            
            // CRITICAL: Determine Lag & Properties for results
            const targetMember = cluster[0];
            const oldestMember = cluster[cluster.length - 1];
            const signalMember = isAlignmentModeS ? oldestMember : targetMember;

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
                    bodyValid: signalMember.bodyValid,
                    isAligned: signalMember.isAligned,
                    isClosed: signalMember.isClosed,
                    isPendingGray: signalMember.isPendingGray,
                    kOpen: signalMember.kOpen,
                    kClose: signalMember.kClose,
                    kHigh: signalMember.kHigh,
                    kLow: signalMember.kLow,
                    signalTime: signalMember.time
                });
            }
        }
    }

    // Final filter: If we found nothing relevant to the trigger mode, return empty
    if (results.length === 0) return [];

    return results;
}
