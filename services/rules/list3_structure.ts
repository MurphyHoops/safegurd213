
import { calculateEMA, calculateRSI, calculateBollingerBands } from '../indicators';
import { List3Config, ScannerItem } from '../../components/Scanner/scannerTypes';

/**
 * Centrally check whether a List 3 signal passes the currently active filter configurations.
 * If a filter switch is turned OFF (false), that filter rule is completely bypassed.
 */
export function checkList3SignalPasses(
    signal: { tf: string; direction: 'LONG' | 'SHORT'; structure?: any; latched?: boolean },
    config: List3Config,
    adjacentStrictTrends?: Record<string, boolean>
): boolean {
    return getList3SignalRejectReason(signal, config, adjacentStrictTrends) === null;
}

export function getList3SignalRejectReason(
    signal: { tf: string; direction: 'LONG' | 'SHORT'; structure?: any; latched?: boolean },
    config: List3Config,
    adjacentStrictTrends?: Record<string, boolean>
): string | null {
    // 1. Timeframe filter: If specific timeframes are configured, check inclusion
    if (config.timeframes && config.timeframes.length > 0 && !config.timeframes.includes(signal.tf)) {
        return `由列表3周期过滤规则删除 [未选中${signal.tf}周期]`;
    }

    const s = signal.structure;
    if (!s) return null;

    // 2. Strict Trend (严格趋势) - ONLY filter if switch is explicitly ON
    if (config.strictTrend === true && !s.isStrictTrend) {
        return '由列表3严格趋势过滤规则删除';
    }

    // 3. Candle Color (同色交叉) - ONLY filter if switch is explicitly ON
    if (config.checkCandleColor === true && !s.isColorValid) {
        return '由列表3同色交叉规则删除';
    }

    // 4. Amplitude Audit (波幅审计) - ONLY filter if switch is explicitly ON
    if (config.enableAmplitudeAudit === true) {
        if (typeof config.maxLocation === 'number' && !isNaN(config.maxLocation) && s.locationPct > config.maxLocation) {
            return `由列表3波幅审计规则删除 [通道位置 ${s.locationPct.toFixed(1)}% > ${config.maxLocation}%]`;
        }
        if (typeof config.minCrossCount === 'number' && !isNaN(config.minCrossCount) && s.crossCount < config.minCrossCount) {
            return `由列表3波幅审计规则删除 [穿越次数 ${s.crossCount} < ${config.minCrossCount}]`;
        }
        if (typeof config.maxBBW === 'number' && !isNaN(config.maxBBW) && s.bbw > config.maxBBW) {
            return `由列表3波幅审计规则删除 [布林带宽 ${(s.bbw * 100).toFixed(1)}% > ${(config.maxBBW * 100).toFixed(1)}%]`;
        }
    }

    // 5. RSI Filter (RSI 动能过滤) - ONLY filter if switch is explicitly ON (enableRsi === true)
    if (config.enableRsi === true) {
        if (signal.direction === 'LONG') {
            const min = (typeof config.rsiLongMin === 'number' && !isNaN(config.rsiLongMin)) ? config.rsiLongMin : 40;
            const max = (typeof config.rsiLongMax === 'number' && !isNaN(config.rsiLongMax)) ? config.rsiLongMax : 90;
            if (s.rsi < min || s.rsi > max) {
                return `由列表3RSI过滤规则删除 [多单RSI: ${typeof s.rsi === 'number' ? s.rsi.toFixed(1) : '--'}, 范围: ${min}-${max}]`;
            }
        } else {
            const min = (typeof config.rsiShortMin === 'number' && !isNaN(config.rsiShortMin)) ? config.rsiShortMin : 10;
            const max = (typeof config.rsiShortMax === 'number' && !isNaN(config.rsiShortMax)) ? config.rsiShortMax : 60;
            if (s.rsi < min || s.rsi > max) {
                return `由列表3RSI过滤规则删除 [空单RSI: ${typeof s.rsi === 'number' ? s.rsi.toFixed(1) : '--'}, 范围: ${min}-${max}]`;
            }
        }
    }

    // 6. Multi-Resonance (时空共振) - ONLY filter if switch is explicitly ON
    if (config.enableMultiResonance === true && adjacentStrictTrends) {
        const ALL_TFS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
        const idx = ALL_TFS.indexOf(signal.tf);
        if (idx !== -1) {
            const prevTf = idx > 0 ? ALL_TFS[idx - 1] : null;
            const nextTf = idx < ALL_TFS.length - 1 ? ALL_TFS[idx + 1] : null;
            const dir = signal.direction;
            const prevOk = prevTf ? !!adjacentStrictTrends[`${prevTf}-${dir}`] : false;
            const nextOk = nextTf ? !!adjacentStrictTrends[`${nextTf}-${dir}`] : false;
            if (!prevOk && !nextOk) {
                return '由列表3时空共振规则删除';
            }
        }
    }

    return null;
}

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
    if (idx < 0) return null; 

    // 0. FIND THE SIGNAL INDEX
    // Locate the exact candle index where the List 2 signal occurred using the timestamp
    let signalIdx = -1;
    if (task.time && rawKlines && rawKlines.length > 0) {
        // Calculate timeframe duration in milliseconds
        const tfUnit = task.tf ? task.tf.slice(-1) : 'm';
        const tfVal = task.tf ? parseInt(task.tf) || 15 : 15;
        let tfMs = 15 * 60 * 1000;
        if (tfUnit === 'm') tfMs = tfVal * 60 * 1000;
        else if (tfUnit === 'h') tfMs = tfVal * 60 * 60 * 1000;
        else if (tfUnit === 'd') tfMs = tfVal * 24 * 60 * 60 * 1000;

        // Primary Match: Check if signal timestamp falls within the candle interval [openTime, openTime + tfMs)
        signalIdx = rawKlines.findIndex((k: any) => task.time >= k[0] && task.time < k[0] + tfMs);
        
        // Secondary Match: If exact interval missed, find the candle with the smallest timestamp difference
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
             
             if (closestIdx !== -1) { 
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

    let isStrictTrend = true;
    if (config.strictTrend === true) {
        isSignalTrendValid = checkFan(signalIdx);
        isCurrentTrendValid = checkFan(idx);
        isStrictTrend = isSignalTrendValid && isCurrentTrendValid;
    } else {
        isSignalTrendValid = true;
        isCurrentTrendValid = true;
    }

    // --- METRIC 2: Candle Color Check ---
    let isColorValid = true; 
    if (config.checkCandleColor === true) {
        const sClose = closes[signalIdx];
        const sOpen = opens[signalIdx];
        const isGreen = sClose >= sOpen;
        
        if (task.direction === 'LONG' && !isGreen) isColorValid = false;
        if (task.direction === 'SHORT' && isGreen) isColorValid = false;
    }

    // --- METRIC 3: Post-Signal Extreme (DEFENSE & BREAKOUT PURITY BACKTRACE) ---
    const signalClose = closes[signalIdx];
    const signalHigh = highs[signalIdx];
    const signalLow = lows[signalIdx];

    let postSignalExtreme = task.price; 
    let postSignalMaxHigh = -Infinity;
    let postSignalMinLow = Infinity;
    
    if (signalIdx < idx) {
        const checkStart = signalIdx + 1; 
        if (task.direction === 'LONG') {
            let minL = Infinity;
            for(let i = checkStart; i <= idx; i++) if(lows[i] < minL) minL = lows[i];
            postSignalExtreme = Math.min(minL, task.price); 

            // 检查信号之后、当前K线之前的历史已完成K线最高价，判断是否曾发生过历史突破
            let maxH = -Infinity;
            for(let i = checkStart; i < idx; i++) {
                if(highs[i] > maxH) maxH = highs[i];
            }
            postSignalMaxHigh = maxH;
        } else {
            let maxH = -Infinity;
            for(let i = checkStart; i <= idx; i++) if(highs[i] > maxH) maxH = highs[i];
            postSignalExtreme = Math.max(maxH, task.price);

            // 检查信号之后、当前K线之前的历史已完成K线最低价，判断是否曾发生过历史突破
            let minL = Infinity;
            for(let i = checkStart; i < idx; i++) {
                if(lows[i] < minL) minL = lows[i];
            }
            postSignalMinLow = minL;
        }
    } else {
        postSignalExtreme = task.price;
        postSignalMaxHigh = -Infinity;
        postSignalMinLow = Infinity;
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

    // --- METRIC 7: 3K Breakout Check (前三K突破: 做多 > Max(Close[1..3]), 做空 < Min(Close[1..3])) ---
    let isBreakout3K = false;
    let maxClose3: number | undefined = undefined;
    let minClose3: number | undefined = undefined;
    if (idx >= 3) {
        const c1 = closes[idx - 1];
        const c2 = closes[idx - 2];
        const c3 = closes[idx - 3];
        maxClose3 = Math.max(c1, c2, c3);
        minClose3 = Math.min(c1, c2, c3);
        if (task.direction === 'LONG') {
            if (task.price > maxClose3) {
                isBreakout3K = true;
            }
        } else {
            if (task.price < minClose3) {
                isBreakout3K = true;
            }
        }
    } else {
        isBreakout3K = true;
    }
    const isReverse3K = !isBreakout3K;

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
            postSignalMaxHigh: postSignalMaxHigh,
            postSignalMinLow: postSignalMinLow,
            periodChange: task.periodChange, // Pass-through
            isReverse3K,
            isBreakout3K,
            maxClose3,
            minClose3,
            recentCloses: idx > 0 ? closes.slice(Math.max(0, idx - 50), idx) : [],
            ema10: getVal(ema10, idx, 10),
            ema20: getVal(ema20, idx, 20),
            ema30: getVal(ema30, idx, 30),
            ema40: getVal(ema40, idx, 40),
            ema80: getVal(ema80, idx, 80)
        }
    };
}
