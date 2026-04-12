
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
            const isCrossing = kHigh >= maxEma && kLow <= minEma;
            
            if (!conflict) {
                const candleRange = kHigh - kLow;
                const amp = kOpen > 0 ? (candleRange / kOpen) * 100 : 0;
                const bodySize = Math.abs(kClose - kOpen);
                const bodyRatio = candleRange > 0 ? (bodySize / candleRange) * 100 : 0;
                
                let isValid = false;
                
                // Check if crossing is required and met
                const crossingValid = config.requireCrossing === false ? true : isCrossing;
                
                if (config.requireCrossing && isCrossing && !config.strictFiltering) {
                    // User explicitly requested NOT to miss any EMA crossing signals.
                    // Bypass strict volume/body filters if it physically crosses all 4 EMAs AND strict filtering is OFF.
                    isValid = true;
                } else if (crossingValid && amp >= squeezeThreshold && amp <= maxAmplitude) {
                    // Original strict rules for non-crossing (squeeze) mode or if strict filtering is ON
                    const volSlice = volumes.slice(Math.max(0, checkIdx - 20), checkIdx);
                    const avgVol = volSlice.length > 0 ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length : 0;
                    
                    if (volumes[checkIdx] >= Math.max(1, avgVol * volMultiplier)) {
                        if (bodyRatio >= minBodyRatio) {
                            isValid = true;
                        }
                    }
                }

                if (isValid) {
                    if (kClose >= kOpen) {
                        longSignals.push({ lag, direction: 'LONG', amp, time: kTime });
                    } else {
                        shortSignals.push({ lag, direction: 'SHORT', amp, time: kTime });
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

    // Helper to get ALL clusters of signals
    const getAllClusters = (signals: {lag: number, direction: string, amp: number, time: number}[]) => {
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

    // Determine eligibility based on Trigger Mode
    // For ALL mode, we include all clusters.
    // For NEW mode, we only include clusters that have a signal with lag <= 1.
    
    longClusters.forEach(cluster => {
        const hasNew = cluster.some(s => s.lag <= 1);
        if (triggerMode === 'NEW' && !hasNew) return;

        const oldestLag = cluster[cluster.length - 1].lag;
        results.push({
            tf,
            lag: oldestLag, 
            crossingCount: cluster.length,
            isSqueeze: false,
            squeezeVal: cluster[0].amp,
            direction: 'LONG',
            crossingLags: cluster.map(s => s.lag),
            crossingTimes: cluster.map(s => s.time)
        });
    });

    shortClusters.forEach(cluster => {
        const hasNew = cluster.some(s => s.lag <= 1);
        if (triggerMode === 'NEW' && !hasNew) return;

        const oldestLag = cluster[cluster.length - 1].lag;
        results.push({
            tf,
            lag: oldestLag,
            crossingCount: cluster.length,
            isSqueeze: false,
            squeezeVal: cluster[0].amp,
            direction: 'SHORT',
            crossingLags: cluster.map(s => s.lag),
            crossingTimes: cluster.map(s => s.time)
        });
    });

    // Final filter: If we found nothing relevant to the trigger mode, return empty
    if (results.length === 0) return [];

    return results;
}
