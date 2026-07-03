
/**
 * Technical Indicator Utilities
 */

// Calculate EMA (Exponential Moving Average)
export function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length < period) return [];
  const k = 2 / (period + 1);
  const emaArray: number[] = [];

  // Simple Moving Average (SMA) as the first EMA point
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  let ema = sum / period;
  emaArray.push(ema); 

  // Calculate subsequent EMAs
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] * k) + (ema * (1 - k));
    emaArray.push(ema);
  }

  return emaArray;
}

// Get the latest EMA value from a price series
export function getLatestEMA(prices: number[], period: number): number {
    if (prices.length < period) return 0;
    const emas = calculateEMA(prices, period);
    return emas[emas.length - 1];
}

// Check for Divergence Pattern (Long: 10>20>30>40, Short: 10<20<30<40)
export function checkEmaDivergence(prices: number[], periods: number[]): 'LONG' | 'SHORT' | null {
    if (prices.length < Math.max(...periods)) return null;

    const emaValues = periods.map(p => getLatestEMA(prices, p));
    const [ema10, ema20, ema30, ema40] = emaValues;

    // Check Long: 10 > 20 > 30 > 40
    if (ema10 > ema20 && ema20 > ema30 && ema30 > ema40) {
        return 'LONG';
    }

    // Check Short: 10 < 20 < 30 < 40
    if (ema10 < ema20 && ema20 < ema30 && ema30 < ema40) {
        return 'SHORT';
    }

    return null;
}

/**
 * Checks for a "Fresh" Divergence Signal (The Crossover Event).
 */
export function checkFreshDivergence(prices: number[], periods: number[]): 'LONG' | 'SHORT' | null {
    const maxPeriod = Math.max(...periods);
    if (prices.length < maxPeriod + 2) return null; // Need history for current + prev

    // 1. Calculate Full EMA Arrays
    const emaArrays = periods.map(p => calculateEMA(prices, p));
    
    const getVal = (emaIdx: number, priceIdx: number): number => {
        const period = periods[emaIdx];
        const offset = priceIdx - (period - 1);
        if (offset < 0 || offset >= emaArrays[emaIdx].length) return -1;
        return emaArrays[emaIdx][offset];
    };

    const currentIdx = prices.length - 1;
    const prevIdx = prices.length - 2;

    // --- Check Current Candle (T0) ---
    const curr10 = getVal(0, currentIdx);
    const curr20 = getVal(1, currentIdx);
    const curr30 = getVal(2, currentIdx);
    const curr40 = getVal(3, currentIdx);

    const isLongNow = curr10 > curr20 && curr20 > curr30 && curr30 > curr40;
    const isShortNow = curr10 < curr20 && curr20 < curr30 && curr30 < curr40;

    if (!isLongNow && !isShortNow) return null; // No divergence now

    // --- Check Previous Candle (T-1) ---
    const prev10 = getVal(0, prevIdx);
    const prev20 = getVal(1, prevIdx);
    const prev30 = getVal(2, prevIdx);
    const prev40 = getVal(3, prevIdx);

    if (isLongNow) {
        const wasLongBefore = prev10 > prev20 && prev20 > prev30 && prev30 > prev40;
        if (!wasLongBefore) return 'LONG';
    }

    if (isShortNow) {
        const wasShortBefore = prev10 < prev20 && prev20 < prev30 && prev30 < prev40;
        if (!wasShortBefore) return 'SHORT';
    }

    return null;
}

/**
 * Calculates Average True Range (ATR)
 */
export function calculateATR(highs: number[], lows: number[], closes: number[], period: number): number[] {
    const trs: number[] = [];
    for (let i = 0; i < highs.length; i++) {
        const high = highs[i];
        const low = lows[i];
        const prevClose = i > 0 ? closes[i - 1] : high;

        const hl = high - low;
        const hc = Math.abs(high - prevClose);
        const lc = Math.abs(low - prevClose);
        trs.push(Math.max(hl, hc, lc));
    }

    const atrs: number[] = [];
    if (trs.length < period) return atrs;

    // Initial SMA for the first ATR
    let sum = 0;
    for(let i=0; i<period; i++) sum += trs[i];
    atrs.push(sum/period);

    // Wilder's Smoothing
    for(let i=period; i<trs.length; i++) {
        const prev = atrs[atrs.length-1];
        atrs.push((prev * (period-1) + trs[i]) / period);
    }
    return atrs;
}

/**
 * Calculates Relative Strength Index (RSI)
 */
export function calculateRSI(prices: number[], period: number): number[] {
    if(prices.length <= period) return [];
    const rsis: number[] = [];
    const gains: number[] = [];
    const losses: number[] = [];

    for(let i=1; i<prices.length; i++) {
        const diff = prices[i] - prices[i-1];
        gains.push(Math.max(0, diff));
        losses.push(Math.max(0, -diff));
    }

    // Initial Average Gain/Loss
    let avgGain = gains.slice(0, period).reduce((a,b)=>a+b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a,b)=>a+b, 0) / period;
    
    const firstRS = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsis.push(100 - 100/(1+firstRS));

    // Smoothed averages
    for(let i=period; i<gains.length; i++) {
        avgGain = (avgGain * (period-1) + gains[i]) / period;
        avgLoss = (avgLoss * (period-1) + losses[i]) / period;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        rsis.push(100 - 100/(1+rs));
    }
    return rsis;
}

/**
 * Calculates Bollinger Bands (Array version)
 */
export function calculateBollingerBands(prices: number[], period: number, stdDevMultiplier: number) {
    const uppers: number[] = [];
    const middles: number[] = [];
    const lowers: number[] = [];
    
    if(prices.length < period) return { upper: [], middle: [], lower: [] };

    for(let i=period-1; i<prices.length; i++) {
        const slice = prices.slice(i-period+1, i+1);
        const mean = slice.reduce((a,b)=>a+b,0) / period;
        const variance = slice.reduce((a,b)=>a+Math.pow(b-mean, 2), 0) / period;
        const stdDev = Math.sqrt(variance);
        
        middles.push(mean);
        uppers.push(mean + stdDev * stdDevMultiplier);
        lowers.push(mean - stdDev * stdDevMultiplier);
    }
    return { upper: uppers, middle: middles, lower: lowers };
}

/**
 * Calculates Standard Deviation Array
 */
export function calculateStdDev(prices: number[], period: number): number[] {
    const stdDevs: number[] = [];
    for (let i = period - 1; i < prices.length; i++) {
        const slice = prices.slice(i - period + 1, i + 1);
        const mean = slice.reduce((a, b) => a + b, 0) / period;
        const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
        stdDevs.push(Math.sqrt(variance));
    }
    return stdDevs;
}

/**
 * Calculates Average Directional Index (ADX)
 * Uses Wilder's Smoothing
 */
export function calculateADX(highs: number[], lows: number[], closes: number[], period: number = 14): number {
    if (highs.length < period * 2) return 0; // Need enough data for initial + smoothing

    // 1. Calculate TR, +DM, -DM
    const trs: number[] = [];
    const plusDMs: number[] = [];
    const minusDMs: number[] = [];

    for (let i = 1; i < highs.length; i++) {
        const high = highs[i];
        const low = lows[i];
        const prevClose = closes[i - 1];

        const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        trs.push(tr);

        const upMove = high - highs[i - 1];
        const downMove = lows[i - 1] - low;

        let plusDM = 0;
        let minusDM = 0;

        if (upMove > downMove && upMove > 0) plusDM = upMove;
        if (downMove > upMove && downMove > 0) minusDM = downMove;

        plusDMs.push(plusDM);
        minusDMs.push(minusDM);
    }

    // 2. Smoothed TR, +DM, -DM
    const smoothTR: number[] = [];
    const smoothPlusDM: number[] = [];
    const smoothMinusDM: number[] = [];

    // Initial SMA
    let sumTR = 0, sumPlusDM = 0, sumMinusDM = 0;
    for (let i = 0; i < period; i++) {
        sumTR += trs[i];
        sumPlusDM += plusDMs[i];
        sumMinusDM += minusDMs[i];
    }
    smoothTR.push(sumTR); // First value is sum (Wilder's convention uses sum for first period? Or avg? Convention varies. Using sum for 1st then smooth)
    smoothPlusDM.push(sumPlusDM);
    smoothMinusDM.push(sumMinusDM);

    // Subsequent Smoothing: Previous - (Previous/n) + Current
    // Actually Wilder's smoothing for first point is often Sum.
    // For indicators like RSI/ADX, often first is Sum/n or just Sum.
    // Let's stick to standard Wilder: Prev - Prev/N + Curr.
    
    for (let i = period; i < trs.length; i++) {
        const prevTR = smoothTR[smoothTR.length - 1];
        const prevPlus = smoothPlusDM[smoothPlusDM.length - 1];
        const prevMinus = smoothMinusDM[smoothMinusDM.length - 1];

        smoothTR.push(prevTR - (prevTR / period) + trs[i]);
        smoothPlusDM.push(prevPlus - (prevPlus / period) + plusDMs[i]);
        smoothMinusDM.push(prevMinus - (prevMinus / period) + minusDMs[i]);
    }

    // 3. Calculate DX
    const dxs: number[] = [];
    for (let i = 0; i < smoothTR.length; i++) {
        const trVal = smoothTR[i];
        if (trVal === 0) {
            dxs.push(0);
            continue;
        }
        const plusDI = 100 * (smoothPlusDM[i] / trVal);
        const minusDI = 100 * (smoothMinusDM[i] / trVal);
        const sumDI = plusDI + minusDI;
        
        if (sumDI === 0) dxs.push(0);
        else dxs.push(100 * Math.abs(plusDI - minusDI) / sumDI);
    }

    // 4. Calculate ADX (Smoothed DX)
    if (dxs.length < period) return 0;
    
    // Initial ADX is SMA of DX
    let sumDX = 0;
    for(let i=0; i < period; i++) sumDX += dxs[i];
    let adx = sumDX / period;

    // Subsequent ADX
    for(let i = period; i < dxs.length; i++) {
        adx = ((adx * (period - 1)) + dxs[i]) / period;
    }

    return adx;
}
