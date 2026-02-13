
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
    config: List2Config
): List2GroupedResult[] {
    
    const idx = closes.length - 1;
    const { maxLag, volMultiplier, squeezeThreshold, maxAmplitude, minBodyRatio, checkEma80Conflict, triggerMode, enableFlatFilter, flatLookback, flatThreshold } = config;
    
    // Scan range is determined by maxLag to gather history
    const effectiveScanRange = maxLag; 

    // 1. Flat Filter (Zombie Coin Check)
    if (enableFlatFilter) {
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

        // Check B Result: If same High or Low repeats >= Threshold (default 5) times
        const maxRepeatedHigh = Math.max(...Object.values(highCounts));
        const maxRepeatedLow = Math.max(...Object.values(lowCounts));

        if (maxRepeatedHigh >= flatThreshold || maxRepeatedLow >= flatThreshold) {
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

    const longSignals: { lag: number, direction: 'LONG', amp: number, time: number }[] = [];
    const shortSignals: { lag: number, direction: 'SHORT', amp: number, time: number }[] = [];

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
            if (checkEma80Conflict) {
                if (e80 === null) {
                    conflict = true; // Safety: If no EMA80 data, assume conflict to be safe
                } else {
                    const isLongCandidate = kClose >= kOpen;
                    const isShortCandidate = kClose < kOpen;

                    // STRICT EMA80 RULE (Perfect Order):
                    
                    // Long: EMA80 must be strictly BELOW the lowest short-term EMA (minEma).
                    // If e80 >= minEma, it implies it's inside the ribbon or above -> Conflict.
                    if (isLongCandidate && e80 >= minEma) conflict = true; 
                    
                    // Short: EMA80 must be strictly ABOVE the highest short-term EMA (maxEma).
                    // If e80 <= maxEma, it implies it's inside the ribbon or below -> Conflict.
                    if (isShortCandidate && e80 <= maxEma) conflict = true;   
                }
            }

            // The Grand Crossing Rule: High touches Max EMA, Low touches Min EMA (Physical Intersection)
            if (!conflict && kHigh >= maxEma && kLow <= minEma) {
                const candleRange = kHigh - kLow;
                const amp = kOpen > 0 ? (candleRange / kOpen) * 100 : 0;
                
                if (amp >= squeezeThreshold && amp <= maxAmplitude) {
                    const volSlice = volumes.slice(Math.max(0, checkIdx - 20), checkIdx);
                    const avgVol = volSlice.length > 0 ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length : 0;
                    
                    if (volumes[checkIdx] >= Math.max(1, avgVol * volMultiplier)) {
                        const bodySize = Math.abs(kClose - kOpen);
                        const bodyRatio = candleRange > 0 ? (bodySize / candleRange) * 100 : 0;
                        
                        if (bodyRatio >= minBodyRatio) {
                            if (kClose >= kOpen) {
                                longSignals.push({ lag, direction: 'LONG', amp, time: kTime });
                            } else {
                                shortSignals.push({ lag, direction: 'SHORT', amp, time: kTime });
                            }
                        }
                    }
                }
            }
        }
    }

    const results: List2GroupedResult[] = [];

    // 4. Construct Result Array and Filter by Trigger Mode
    
    // Sort signals by lag ascending (0 is current)
    longSignals.sort((a, b) => a.lag - b.lag);
    shortSignals.sort((a, b) => a.lag - b.lag);

    // Determine eligibility based on Trigger Mode
    const hasNewLong = longSignals.some(s => s.lag === 0);
    const hasNewShort = shortSignals.some(s => s.lag === 0);
    const hasAnyLong = longSignals.length > 0;
    const hasAnyShort = shortSignals.length > 0;

    let includeLong = false;
    let includeShort = false;

    if (triggerMode === 'NEW') {
        includeLong = hasNewLong;
        includeShort = hasNewShort;
    } else {
        // ALL mode
        includeLong = hasAnyLong;
        includeShort = hasAnyShort;
    }

    if (includeLong || (triggerMode === 'NEW' && includeShort) || (triggerMode === 'ALL' && hasAnyLong)) {
         if (longSignals.length > 0) {
             results.push({
                tf,
                lag: longSignals[0].lag, // Nearest lag
                crossingCount: longSignals.length,
                isSqueeze: false,
                squeezeVal: longSignals[0].amp,
                direction: 'LONG',
                crossingLags: longSignals.map(s => s.lag),
                crossingTimes: longSignals.map(s => s.time)
            });
         }
    }
    
    if (includeShort || (triggerMode === 'NEW' && includeLong) || (triggerMode === 'ALL' && hasAnyShort)) {
        if (shortSignals.length > 0) {
            results.push({
                tf,
                lag: shortSignals[0].lag,
                crossingCount: shortSignals.length,
                isSqueeze: false,
                squeezeVal: shortSignals[0].amp,
                direction: 'SHORT',
                crossingLags: shortSignals.map(s => s.lag),
                crossingTimes: shortSignals.map(s => s.time)
            });
        }
    }

    // Final filter: If we found nothing relevant to the trigger mode, return empty
    if (triggerMode === 'NEW' && !hasNewLong && !hasNewShort) {
        return [];
    }
    
    if (results.length === 0) return [];

    return results;
}
