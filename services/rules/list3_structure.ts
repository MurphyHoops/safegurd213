
import { calculateEMA, calculateRSI, calculateBollingerBands } from '../indicators';
import { List3Config, ScannerItem } from '../../components/Scanner/scannerTypes';

export function analyzeList3Structure(
    task: { symbol: string, tf: string, direction: 'LONG' | 'SHORT', time: number, price: number, periodChange?: number },
    closes: number[],
    highs: number[],
    lows: number[],
    opens: number[],
    volumes: number[],
    config: List3Config,
    rawKlines: any[] // Needed for timestamp checks
): ScannerItem | null {
    
    const idx = closes.length - 1;
    // Safety check: Needs at least 40 candles for basic EMA alignment. 
    // EMA80 will be treated as optional if history is between 40-80.
    if (idx < 40) return null; 

    // 0. FIND THE SIGNAL INDEX
    // Locate the exact candle index where the List 2 signal occurred using the timestamp
    let signalIdx = -1;
    if (task.time) {
        // rawKlines[x][0] is the timestamp
        signalIdx = rawKlines.findIndex((k: any) => k[0] === task.time);
        
        // Robust Fallback: If exact time not found, try to find closest match within tolerance
        if (signalIdx === -1) {
             let minDiff = Infinity;
             let closestIdx = -1;
             rawKlines.forEach((k: any, i: number) => {
                 const diff = Math.abs(k[0] - task.time);
                 if (diff < minDiff) {
                     minDiff = diff;
                     closestIdx = i;
                 }
             });
             
             // If closest is within ~5 mins (300000ms) or reasonable relative to TF, accept it.
             if (closestIdx !== -1 && minDiff < 300000) { 
                 signalIdx = closestIdx;
             }
        }
    }
    
    // If still not found, default to current index as last resort (assuming fresh signal)
    if (signalIdx === -1) {
        signalIdx = idx;
    }

    // --- METRIC 1: TREND CHECK (AUDIT EMA ALIGNMENT) ---
    // Check both signal time and current time. If either satisfies, we consider it a trend pass.
    let isSignalTrendValid = false;
    let isCurrentTrendValid = false;
    
    // Always calculate EMAs 
    let ema10 = calculateEMA(closes, 10);
    let ema20 = calculateEMA(closes, 20);
    let ema30 = calculateEMA(closes, 30);
    let ema40 = calculateEMA(closes, 40);
    let ema80 = calculateEMA(closes, 80);

    const getVal = (arr: number[], index: number, period: number) => {
        const offset = index - (period - 1);
        if (offset < 0 || offset >= arr.length) return -1;
        const val = arr[offset];
        return (isNaN(val)) ? -1 : val;
    };

    const checkFan = (index: number) => {
        // Relaxed requirement: Need at least 40 candles for a valid trend (EMA10-40)
        // If index < 39, we definitely don't have enough for EMA40
        if (index < 39) return false; 
        
        const c10 = getVal(ema10, index, 10);
        const c20 = getVal(ema20, index, 20);
        const c30 = getVal(ema30, index, 30);
        const c40 = getVal(ema40, index, 40);
        const c80 = getVal(ema80, index, 80);

        // Required: at least EMAs 10, 20, 30, 40 must be available
        if (c10 === -1 || c20 === -1 || c30 === -1 || c40 === -1) return false;

        if (task.direction === 'LONG') {
            const basic = (c10 > c20 && c20 > c30 && c30 > c40);
            if (!basic) return false;
            // 80 is optional if history is too short. If exists, it must be below 40.
            return (c80 === -1 || c40 > c80);
        } else {
            const basic = (c10 < c20 && c20 < c30 && c30 < c40);
            if (!basic) return false;
            // 80 is optional if history is too short. If exists, it must be above 40.
            return (c80 === -1 || c40 < c80);
        }
    };

    isSignalTrendValid = checkFan(signalIdx);
    isCurrentTrendValid = checkFan(idx);

    let isStrictTrend = isSignalTrendValid && isCurrentTrendValid;

    // --- METRIC 2: Candle Color Check ---
    let isColorValid = true; 
    const sClose = closes[signalIdx];
    const sOpen = opens[signalIdx];
    const isGreen = sClose >= sOpen;
    
    if (task.direction === 'LONG' && !isGreen) isColorValid = false;
    if (task.direction === 'SHORT' && isGreen) isColorValid = false;

    // --- METRIC 3: Post-Signal Extreme (DEFENSE BACKTRACE) ---
    const signalClose = closes[signalIdx];
    const signalHigh = highs[signalIdx];
    const signalLow = lows[signalIdx];

    let postSignalExtreme = task.price; 
    
    if (signalIdx < idx) {
        const checkStart = signalIdx + 1; 
        if (task.direction === 'LONG') {
            let minL = Infinity;
            for(let i = checkStart; i <= idx; i++) if(lows[i] < minL) minL = lows[i];
            postSignalExtreme = Math.min(minL, task.price); 
        } else {
            let maxH = -Infinity;
            for(let i = checkStart; i <= idx; i++) if(highs[i] > maxH) maxH = highs[i];
            postSignalExtreme = Math.max(maxH, task.price);
        }
    } else {
        postSignalExtreme = task.price;
    }

    // --- METRIC 4: Thrust Logic (New 4K Window Logic) ---
    // Rule: Signal candle (1K) OR [Signal + 3 Left] OR [Signal + 3 Right] amplitude > 1%
    let isThrustValid = false;
    const signalCandleAmp = (highs[signalIdx] - lows[signalIdx]) / opens[signalIdx];
    
    if (signalCandleAmp >= 0.01) {
        isThrustValid = true;
    } else {
        // Check Left Window: [signalIdx-3, signalIdx]
        const leftStart = Math.max(0, signalIdx - 3);
        let leftMax = -Infinity;
        let leftMin = Infinity;
        for (let i = leftStart; i <= signalIdx; i++) {
            if (highs[i] > leftMax) leftMax = highs[i];
            if (lows[i] < leftMin) leftMin = lows[i];
        }
        const leftAmp = (leftMax - leftMin) / opens[leftStart];
        
        // Check Right Window: [signalIdx, signalIdx+3]
        const rightEnd = Math.min(closes.length - 1, signalIdx + 3);
        let rightMax = -Infinity;
        let rightMin = Infinity;
        for (let i = signalIdx; i <= rightEnd; i++) {
            if (highs[i] > rightMax) rightMax = highs[i];
            if (lows[i] < rightMin) rightMin = lows[i];
        }
        const rightAmp = (rightMax - rightMin) / opens[signalIdx];
        
        if (leftAmp >= 0.01 || rightAmp >= 0.01) {
            isThrustValid = true;
        }
    }

    // --- METRIC 5: Resonance & Location ---
    let locationPct = 50;
    let crossCount = 0;

    // Always calculate these metrics, don't gate behind 'config.enableResonance'
    const lb = config.lookback || 80;
    const startCheck = Math.max(0, idx - lb);
    
    let periodHigh = -Infinity;
    let periodLow = Infinity;
    
    for (let i = startCheck; i <= idx; i++) {
        if (highs[i] > periodHigh) periodHigh = highs[i];
        if (lows[i] < periodLow) periodLow = lows[i];
    }

    const range = periodHigh - periodLow;
    const currentPrice = closes[idx];
    
    locationPct = range > 0 ? ((currentPrice - periodLow) / range) * 100 : 50;

    const ema20Arr = ema20.length > 0 ? ema20 : calculateEMA(closes, 20);
    for (let i = startCheck; i <= idx; i++) {
        const e20Idx = i - 19;
        if (e20Idx >= 0 && e20Idx < ema20Arr.length) {
            const e20Val = ema20Arr[e20Idx];
            if (lows[i] < e20Val && highs[i] > e20Val) {
                crossCount++;
            }
        }
    }

    // --- METRIC 6: RSI & BBW ---
    const rsiArr = calculateRSI(closes, 14);
    const currentRsi = rsiArr[rsiArr.length - 1] || 50;

    const { upper, lower } = calculateBollingerBands(closes, 20, 2);
    const curUp = upper[upper.length - 1];
    const curLow = lower[lower.length - 1];
    const curMid = (curUp + curLow) / 2;
    const bbw = curMid !== 0 ? (curUp - curLow) / curMid : 0;

    // --- METRIC 7: Reverse 3K Check (Audit current momentum direction) ---
    const last3Closes = closes.slice(-3);
    const last3Opens = opens.slice(-3);
    const last3Green = last3Closes.map((c, i) => c > last3Opens[i]);
    let isReverse3K = false;
    if (task.direction === 'LONG') {
        if (last3Green.length === 3 && last3Green.every(g => !g)) isReverse3K = true;
    } else {
        if (last3Green.length === 3 && last3Green.every(g => g)) isReverse3K = true;
    }

    // 8. Return Constructed Item with ALL Audit Data
    // We do NOT return null here. We return the full profile.
    return {
        symbol: task.symbol,
        price: task.price,
        direction: task.direction,
        tf: task.tf,
        structure: {
            rsi: currentRsi,
            bbw: bbw,
            thrustValid: isThrustValid,
            isStrictTrend: isStrictTrend,
            isColorValid: isColorValid,
            crossCount: crossCount,
            locationPct: locationPct,
            lag: idx - signalIdx, 
            signalTime: task.time,
            signalPrice: signalClose,
            signalHigh: signalHigh, 
            signalLow: signalLow,   
            postSignalExtreme: postSignalExtreme,
            periodChange: task.periodChange, // Pass-through
            isReverse3K,
            ema10: getVal(ema10, idx, 10),
            ema20: getVal(ema20, idx, 20),
            ema30: getVal(ema30, idx, 30),
            ema40: getVal(ema40, idx, 40),
            ema80: getVal(ema80, idx, 80)
        }
    };
}
