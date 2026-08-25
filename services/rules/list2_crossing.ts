
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

    // 1. Flat Filter (Zombie Coin Check) - Only when Crossing is enabled
    if (enableFlatFilter && config.requireCrossing) {
        let flatCount = 0;
        const checkStart = Math.max(0, idx - flatLookback);
        
        // Frequency Maps for Detecting Price Pinning (Ceiling/Floor)
        const highCounts: Record<number, number> = {};
        const lowCounts: Record<number, number> = {};

        for (let k = checkStart; k <= idx; k++) {
            // A. Standard Flat Candle Check
            if (volumes[k] === 0 || highs[k] === lows[k] || Math.abs(closes[k] - opens[k]) < Number.EPSILON) {
                flatCount++;
            }

            // B. Repeated Price Check (Detecting Algo Control)
            const h = highs[k];
            const l = lows[k];
            highCounts[h] = (highCounts[h] || 0) + 1;
            lowCounts[l] = (lowCounts[l] || 0) + 1;
        }

        // Check A Result
        if (flatCount >= flatThreshold) return [];

        // Check B Result: If same High or Low repeats >= Threshold * 3 times
        const maxRepeatedHigh = Math.max(...Object.values(highCounts));
        const maxRepeatedLow = Math.max(...Object.values(lowCounts));

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

            let conflict = false;

            const isLongCandidate = kClose >= kOpen;
            const isShortCandidate = kClose < kOpen;
            
            // 1. EMA80 Baseline Trend Check
            if (checkEma80Conflict) {
                if (e80 === null) {
                    conflict = true; // Safety: If no EMA80 data, assume conflict to be safe
                } else {
                    // LONG: EMA80 must be strictly BELOW the lowest short-term EMA (minEma).
                    if (isLongCandidate && e80 >= minEma) conflict = true; 
                    
                    // SHORT: EMA80 must be strictly ABOVE the highest short-term EMA (maxEma).
                    if (isShortCandidate && e80 <= maxEma) conflict = true;   
                }
            }

            // The Grand Crossing Rule: High touches Max EMA, Low touches Min EMA (Physical Intersection)
            const isCrossing = kHigh >= maxEma && kLow <= minEma;
            const isAlignedLong = e10 > e20 && e20 > e30 && e30 > e40;
            const isAlignedShort = e10 < e20 && e20 < e30 && e30 < e40;
            
            if (!conflict) {
                // Determine Alignment & Freshness for Long and Short separately
                const isAlignedL = isAlignedLong;
                const isAlignedS = isAlignedShort;

                let isFirstDivergenceL = true;
                let isFirstDivergenceS = true;

                const prevIdx = checkIdx - 1;
                if (prevIdx >= 80) {
                    const pe10 = getEmaVal(ema10, prevIdx, 10);
                    const pe20 = getEmaVal(ema20, prevIdx, 20);
                    const pe30 = getEmaVal(ema30, prevIdx, 30);
                    const pe40 = getEmaVal(ema40, prevIdx, 40);
                    if (pe10 !== null && pe20 !== null && pe30 !== null && pe40 !== null) {
                        const isPrevAlignedLong = pe10 > pe20 && pe20 > pe30 && pe30 > pe40;
                        const isPrevAlignedShort = pe10 < pe20 && pe20 < pe30 && pe30 < pe40;
                        
                        if (isPrevAlignedLong) isFirstDivergenceL = false;
                        if (isPrevAlignedShort) isFirstDivergenceS = false;
                    }
                }

                // [CRITICAL] Backtrack Crossing Validation for Alignment Mode
                let alignmentValidByCrossingL = true;
                let alignmentValidByCrossingS = true;
                let crossingIdxL = checkIdx;
                let crossingIdxS = checkIdx;

                if (config.requireAlignment && isAlignedL && isFirstDivergenceL && !isCrossing) {
                    alignmentValidByCrossingL = false;
                    for (let backtrack = 1; backtrack <= 20; backtrack++) { 
                        const bIdx = checkIdx - backtrack;
                        if (bIdx < 80) break;
                        
                        const be10 = getEmaVal(ema10, bIdx, 10);
                        const be20 = getEmaVal(ema20, bIdx, 20);
                        const be30 = getEmaVal(ema30, bIdx, 30);
                        const be40 = getEmaVal(ema40, bIdx, 40);
                        
                        if (be10 !== null && be20 !== null && be30 !== null && be40 !== null) {
                            const bMaxEma = Math.max(be10, be20, be30, be40);
                            const bMinEma = Math.min(be10, be20, be30, be40);
                            const isBCrossing = highs[bIdx] >= bMaxEma && lows[bIdx] <= bMinEma;
                            if (isBCrossing) {
                                alignmentValidByCrossingL = true;
                                crossingIdxL = bIdx;
                                break;
                            }
                        }
                    }
                }

                if (config.requireAlignment && isAlignedS && isFirstDivergenceS && !isCrossing) {
                    alignmentValidByCrossingS = false;
                    for (let backtrack = 1; backtrack <= 20; backtrack++) { 
                        const bIdx = checkIdx - backtrack;
                        if (bIdx < 80) break;
                        
                        const be10 = getEmaVal(ema10, bIdx, 10);
                        const be20 = getEmaVal(ema20, bIdx, 20);
                        const be30 = getEmaVal(ema30, bIdx, 30);
                        const be40 = getEmaVal(ema40, bIdx, 40);
                        
                        if (be10 !== null && be20 !== null && be30 !== null && be40 !== null) {
                            const bMaxEma = Math.max(be10, be20, be30, be40);
                            const bMinEma = Math.min(be10, be20, be30, be40);
                            const isBCrossing = highs[bIdx] >= bMaxEma && lows[bIdx] <= bMinEma;
                            if (isBCrossing) {
                                alignmentValidByCrossingS = true;
                                crossingIdxS = bIdx;
                                break;
                            }
                        }
                    }
                }

                // Check if EMA10 has crossed EMA20, EMA30, and EMA40 within the preceding lookback bars of the divergence formation (Configurable)
                let crossedAllL = true;
                let crossedAllS = true;

                if (enableDivergenceCrossCheck) {
                    if (isAlignedL) {
                        let crossed20 = false;
                        let crossed30 = false;
                        let crossed40 = false;
                        for (let b = 1; b <= divergenceLookbackBars; b++) {
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

                            if (cur10 !== null && cur20 !== null && prev10 !== null && prev20 !== null) {
                                if ((cur10 - cur20) * (prev10 - prev20) <= 0) crossed20 = true;
                            }
                            if (cur10 !== null && cur30 !== null && prev10 !== null && prev30 !== null) {
                                if ((cur10 - cur30) * (prev10 - prev30) <= 0) crossed30 = true;
                            }
                            if (cur10 !== null && cur40 !== null && prev10 !== null && prev40 !== null) {
                                if ((cur10 - cur40) * (prev10 - prev40) <= 0) crossed40 = true;
                            }
                        }
                        crossedAllL = crossed20 && crossed30 && crossed40;
                    }

                    if (isAlignedS) {
                        let crossed20 = false;
                        let crossed30 = false;
                        let crossed40 = false;
                        for (let b = 1; b <= divergenceLookbackBars; b++) {
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

                            if (cur10 !== null && cur20 !== null && prev10 !== null && prev20 !== null) {
                                if ((cur10 - cur20) * (prev10 - prev20) <= 0) crossed20 = true;
                            }
                            if (cur10 !== null && cur30 !== null && prev10 !== null && prev30 !== null) {
                                if ((cur10 - cur30) * (prev10 - prev30) <= 0) crossed30 = true;
                            }
                            if (cur10 !== null && cur40 !== null && prev10 !== null && prev40 !== null) {
                                if ((cur10 - cur40) * (prev10 - prev40) <= 0) crossed40 = true;
                            }
                        }
                        crossedAllS = crossed20 && crossed30 && crossed40;
                    }
                }

                const candleRange = kHigh - kLow;
                const amp = kOpen > 0 ? (candleRange / kOpen) * 100 : 0;
                const volSlice = volumes.slice(Math.max(0, checkIdx - 20), checkIdx);
                const avgVol = volSlice.length > 0 ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length : 0;
                
                const volValid = volumes[checkIdx] >= (avgVol * Math.max(0.1, volMultiplier));
                const ampValid = amp >= squeezeThreshold && amp <= maxAmplitude;

                // Calculate body ratio for crossingIdxL and crossingIdxS
                const cHighL = highs[crossingIdxL];
                const cLowL = lows[crossingIdxL];
                const cCloseL = closes[crossingIdxL];
                const cOpenL = opens[crossingIdxL];
                const cCandleRangeL = cHighL - cLowL;
                const cIsLongL = cCloseL >= cOpenL;
                let bodyRatioL = 0;
                if (cCandleRangeL > 0) {
                    bodyRatioL = (cIsLongL ? (cCloseL - cOpenL) : (cOpenL - cCloseL)) / cCandleRangeL * 100;
                }

                const cHighS = highs[crossingIdxS];
                const cLowS = lows[crossingIdxS];
                const cCloseS = closes[crossingIdxS];
                const cOpenS = opens[crossingIdxS];
                const cCandleRangeS = cHighS - cLowS;
                const cIsLongS = cCloseS >= cOpenS;
                let bodyRatioS = 0;
                if (cCandleRangeS > 0) {
                    bodyRatioS = (cIsLongS ? (cCloseS - cOpenS) : (cOpenS - cCloseS)) / cCandleRangeS * 100;
                }

                const kCandleRange = kHigh - kLow;
                const kIsLong = kClose >= kOpen;
                let currentBodyRatio = 0;
                if (kCandleRange > 0) {
                    currentBodyRatio = (kIsLong ? (kClose - kOpen) : (kOpen - kClose)) / kCandleRange * 100;
                }

                const finalBodyRatioL = Math.min(bodyRatioL, currentBodyRatio);
                const bodyValidL = finalBodyRatioL >= minBodyRatio;

                const finalBodyRatioS = Math.min(bodyRatioS, currentBodyRatio);
                const bodyValidS = finalBodyRatioS >= minBodyRatio;

                // Crossing Rules & Divergence Rules Evaluation with AND/OR Logic
                const crossingStrictOkL = !strictFiltering || (ampValid && volValid && bodyValidL);
                const crossingStrictOkS = !strictFiltering || (ampValid && volValid && bodyValidS);
                const crossingValidL = isCrossing && crossingStrictOkL;
                const crossingValidS = isCrossing && crossingStrictOkS;

                const divergenceValidL = isAlignedL && crossedAllL;
                const divergenceValidS = isAlignedS && crossedAllS;

                let patternMatchedL = false;
                let patternMatchedS = false;
                const logicMode = config.crossingDivergenceLogic || 'AND';

                if (config.requireCrossing && config.requireAlignment) {
                    if (logicMode === 'OR') {
                        patternMatchedL = crossingValidL || divergenceValidL;
                        patternMatchedS = crossingValidS || divergenceValidS;
                    } else {
                        // AND
                        patternMatchedL = crossingValidL && divergenceValidL;
                        patternMatchedS = crossingValidS && divergenceValidS;
                    }
                } else if (config.requireCrossing) {
                    patternMatchedL = crossingValidL;
                    patternMatchedS = crossingValidS;
                } else if (config.requireAlignment) {
                    patternMatchedL = divergenceValidL;
                    patternMatchedS = divergenceValidS;
                } else {
                    // Squeeze fallback
                    patternMatchedL = crossingStrictOkL;
                    patternMatchedS = crossingStrictOkS;
                }

                // [CRITICAL MANDATORY RULE - USER DEFINITION]:
                // 1. 历史已收盘K线 (lag > 0):
                //    - 多头: 收盘价必须严格大于开盘价 (kClose > kOpen，阳线)
                //    - 空头: 收盘价必须严格小于开盘价 (kClose < kOpen，阴线)
                // 2. 当前正在走动K线 (lag === 0):
                //    - 多头形态: 当前价 > 开盘价 为正常多；当前价 <= 开盘价 显示为灰色待定态 (isPendingGray = true)
                //    - 空头形态: 当前价 < 开盘价 为正常空；当前价 >= 开盘价 显示为灰色待定态 (isPendingGray = true)
                let isValidL = false;
                let isPendingGrayL = false;
                if (patternMatchedL) {
                    if (lag > 0) {
                        if (kClose > kOpen) {
                            isValidL = true;
                            isPendingGrayL = false;
                        }
                    } else {
                        isValidL = true;
                        isPendingGrayL = !(kClose > kOpen);
                    }
                }

                let isValidS = false;
                let isPendingGrayS = false;
                if (patternMatchedS) {
                    if (lag > 0) {
                        if (kClose < kOpen) {
                            isValidS = true;
                            isPendingGrayS = false;
                        }
                    } else {
                        isValidS = true;
                        isPendingGrayS = !(kClose < kOpen);
                    }
                }

                if (isValidL) {
                    longSignals.push({ 
                        lag, 
                        direction: 'LONG', 
                        amp, 
                        time: kTime, 
                        bodyRatio: finalBodyRatioL, 
                        isAligned: isAlignedLong,
                        ampValid,
                        volValid,
                        bodyValid: bodyValidL,
                        isClosed: lag > 0,
                        isPendingGray: isPendingGrayL,
                        kHigh,
                        kLow,
                        kClose,
                        kOpen
                    });
                }

                if (isValidS) {
                    shortSignals.push({ 
                        lag, 
                        direction: 'SHORT', 
                        amp, 
                        time: kTime, 
                        bodyRatio: finalBodyRatioS, 
                        isAligned: isAlignedShort,
                        ampValid,
                        volValid,
                        bodyValid: bodyValidS,
                        isClosed: lag > 0,
                        isPendingGray: isPendingGrayS,
                        kHigh,
                        kLow,
                        kClose,
                        kOpen
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
        // - Crossing Mode: Recognized by the LAST occurrence (Timer resets)
        // - Alignment/Squeeze Mode: Recognized by the FIRST occurrence (Timer starts at beginning)
        const validClusters = longClusters.filter(cluster => {
            const hasRecentMember = cluster.some(s => s.lag <= scanLookbackLimit);
            
            const checkLag = config.requireCrossing 
                ? cluster[0].lag  // Use most recent lag for Crossing (Resets)
                : cluster[cluster.length - 1].lag; // Use oldest lag for Alignment/Squeeze (Starts at first)

            const isWithinRetention = checkLag <= retentionThreshold;
            return hasRecentMember && isWithinRetention;
        });

        if (validClusters.length > 0) {
            validClusters.sort((a, b) => a[0].lag - b[0].lag);
            const cluster = validClusters[0];
            
            // CRITICAL: Determine Lag & Properties for results
            // Alignment (发散): Use the OLDEST candle in the cluster as the base (timer starts at start of divergence)
            // Crossing (穿越): Use the NEWEST candle in the cluster as the base (timer resets on every crossing)
            // [UPDATE] If alignment is required, we ALWAYS use the first candle of the divergence sequence as the primary signal.
            const useFirstMember = config.requireAlignment || (!config.requireCrossing && !config.requireAlignment);
            const targetMember = useFirstMember 
                ? cluster[cluster.length - 1] // Oldest (First divergence/squeeze)
                : cluster[0]; // Newest (Last crossing)

            // 方式 A (振幅偏离限制 - LONG): 当前价格高于信号K线最高价超过其振幅的 X% 时，不进入列表2
            let passDeviationFilterL = true;
            if (enableSignalDeviationFilter) {
                const signalCandleRange = Math.max(0, targetMember.kHigh - targetMember.kLow);
                const maxAllowedPriceL = targetMember.kHigh + (signalCandleRange * (maxSignalDeviationPercent / 100));
                if (currentPrice > maxAllowedPriceL) {
                    passDeviationFilterL = false;
                }
            }

            if (passDeviationFilterL) {
                // For Alignment/Squeeze modes, we only want to mark the STARTING candle on the chart.
                // For Crossing mode, we usually want to show all crossing points in the cluster.
                const reportLags = (config.requireAlignment || (!config.requireCrossing && !config.requireAlignment)) 
                    ? [targetMember.lag]
                    : cluster.map(s => s.lag);
                    
                const reportTimes = (config.requireAlignment || (!config.requireCrossing && !config.requireAlignment))
                    ? [targetMember.time]
                    : cluster.map(s => s.time);

                results.push({
                    tf,
                    lag: targetMember.lag, 
                    crossingCount: cluster.length,
                    isSqueeze: !config.requireCrossing && !config.requireAlignment, 
                    squeezeVal: targetMember.amp,
                    direction: 'LONG',
                    crossingLags: reportLags,
                    crossingTimes: reportTimes,
                    bodyRatio: targetMember.bodyRatio,
                    ampValid: targetMember.ampValid,
                    volValid: targetMember.volValid,
                    bodyValid: targetMember.bodyValid,
                    isAligned: targetMember.isAligned,
                    isClosed: targetMember.isClosed,
                    isPendingGray: targetMember.isPendingGray,
                    kOpen: targetMember.kOpen,
                    kClose: targetMember.kClose,
                    signalTime: targetMember.time
                });
            }
        }
    }

    if (shortClusters.length > 0) {
        const validClusters = shortClusters.filter(cluster => {
            const hasRecentMember = cluster.some(s => s.lag <= scanLookbackLimit);

            const checkLag = config.requireCrossing 
                ? cluster[0].lag  // Use most recent lag for Crossing (Resets)
                : cluster[cluster.length - 1].lag; // Use oldest lag for Alignment/Squeeze (Starts at first)

            const isWithinRetention = checkLag <= retentionThreshold;
            return hasRecentMember && isWithinRetention;
        });

        if (validClusters.length > 0) {
            validClusters.sort((a, b) => a[0].lag - b[0].lag);
            const cluster = validClusters[0];
            
            // CRITICAL: Determine Lag & Properties for results
            const useFirstMember = config.requireAlignment || (!config.requireCrossing && !config.requireAlignment);
            const targetMember = useFirstMember 
                ? cluster[cluster.length - 1] // Oldest (First divergence/squeeze)
                : cluster[0]; // Newest (Last crossing)

            // 方式 A (振幅偏离限制 - SHORT): 当前价格低于信号K线最低价超过其振幅的 X% 时，不进入列表2
            let passDeviationFilterS = true;
            if (enableSignalDeviationFilter) {
                const signalCandleRange = Math.max(0, targetMember.kHigh - targetMember.kLow);
                const minAllowedPriceS = targetMember.kLow - (signalCandleRange * (maxSignalDeviationPercent / 100));
                if (currentPrice < minAllowedPriceS) {
                    passDeviationFilterS = false;
                }
            }

            if (passDeviationFilterS) {
                const reportLags = (config.requireAlignment || (!config.requireCrossing && !config.requireAlignment)) 
                    ? [targetMember.lag]
                    : cluster.map(s => s.lag);

                const reportTimes = (config.requireAlignment || (!config.requireCrossing && !config.requireAlignment))
                    ? [targetMember.time]
                    : cluster.map(s => s.time);

                results.push({
                    tf,
                    lag: targetMember.lag,
                    crossingCount: cluster.length,
                    isSqueeze: !config.requireCrossing && !config.requireAlignment, 
                    squeezeVal: targetMember.amp,
                    direction: 'SHORT',
                    crossingLags: reportLags,
                    crossingTimes: reportTimes,
                    bodyRatio: targetMember.bodyRatio,
                    ampValid: targetMember.ampValid,
                    volValid: targetMember.volValid,
                    bodyValid: targetMember.bodyValid,
                    isAligned: targetMember.isAligned,
                    isClosed: targetMember.isClosed,
                    isPendingGray: targetMember.isPendingGray,
                    kOpen: targetMember.kOpen,
                    kClose: targetMember.kClose,
                    signalTime: targetMember.time
                });
            }
        }
    }

    // Final filter: If we found nothing relevant to the trigger mode, return empty
    if (results.length === 0) return [];

    return results;
}
