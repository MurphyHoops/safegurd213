
import { StrategyRecommendation, StopLossSettings } from '../types';
import { calculateRSI, calculateBollingerBands, calculateADX, calculateEMA, calculateStdDev } from './indicators';

interface KlineInput {
    high: number;
    low: number;
    close: number;
}

export class StrategyAdvisor {
    
    public static analyze(
        symbol: string, 
        klines: KlineInput[], 
        currentSettings: StopLossSettings,
        minConfidence: number = 70
    ): StrategyRecommendation | null {
        
        if (klines.length < 50) return null; 

        // 1. Data Preparation
        const highs = klines.map(k => k.high);
        const lows = klines.map(k => k.low);
        const closes = klines.map(k => k.close);
        const currentPrice = closes[closes.length - 1];

        // 2. Indicator Calculation
        const rsiArr = calculateRSI(closes, 14);
        const rsi = rsiArr.length > 0 ? rsiArr[rsiArr.length - 1] : 50;
        
        // Custom BB calculation for latest value (using existing helper logic)
        const period = 20;
        const multiplier = 2;
        const smaArr = calculateEMA(closes, period); // Using SMA logic essentially inside BB usually, but EMA is provided. Standard BB uses SMA. 
        // Let's implement simple SMA for BB to be standard
        let sum = 0;
        for(let i=closes.length-period; i<closes.length; i++) sum+=closes[i];
        const sma = sum/period;
        
        const stdDevs = calculateStdDev(closes, period);
        const stdDev = stdDevs[stdDevs.length - 1];
        const bbUpper = sma + (stdDev * multiplier);
        const bbLower = sma - (stdDev * multiplier);
        const bbWidth = sma !== 0 ? (bbUpper - bbLower) / sma : 0;

        const adx = calculateADX(highs, lows, closes, 14);
        
        const ema20Arr = calculateEMA(closes, 20);
        const ema50Arr = calculateEMA(closes, 50);
        const ema20 = ema20Arr.length > 0 ? ema20Arr[ema20Arr.length - 1] : 0;
        const ema50 = ema50Arr.length > 0 ? ema50Arr[ema50Arr.length - 1] : 0;

        // 3. Trend Judgment
        let trend: 'UP' | 'DOWN' | 'SIDEWAYS' = 'SIDEWAYS';
        if (adx > 25) {
            if (ema20 > ema50) trend = 'UP'; else trend = 'DOWN';
        }

        // 4. Strategy Scoring
        let score41 = 0; // Reversal (Original Profit Clear)
        let score42 = 0; // Trend (Hedge Profit Clear)
        let score43 = 0; // Oscillation (Callback Profit Clear)
        let score44 = 0; // Wait (Fuse)

        // --- 4.2 Trend Follow (Hedge Profit Clear) ---
        if (adx > 30) score42 += 50;
        if (adx > 45) score42 += 30; 
        if (bbWidth > 0.15) score42 += 20; 
        if (currentPrice > bbUpper || currentPrice < bbLower) score42 += 10;

        // --- 4.3 Oscillation (Callback Profit Clear) ---
        if (adx < 20) score43 += 50;
        if (rsi > 40 && rsi < 60) score43 += 30;
        if (currentPrice < bbUpper && currentPrice > bbLower) score43 += 20;

        // --- 4.1 Reversal (Original Profit Clear) ---
        if (rsi > 75 || rsi < 25) score41 += 60;
        const deviation = ema20 > 0 ? Math.abs(currentPrice - ema20) / ema20 : 0;
        if (deviation > 0.05) score41 += 30; 

        // --- 4.4 Wait (Fuse) ---
        if (bbWidth < 0.05) score44 += 80;

        // 5. Select Best
        const scores = [
            { id: '4.2', val: score42 },
            { id: '4.3', val: score43 },
            { id: '4.1', val: score41 },
            { id: '4.4_WAIT', val: score44 }
        ];
        scores.sort((a, b) => b.val - a.val);
        const best = scores[0];

        // 6. Identify Current Strategy
        let currentStrategy: any = 'NONE';
        if (currentSettings.hedgeProfitClear) currentStrategy = '4.2';
        else if (currentSettings.callbackProfitClear) currentStrategy = '4.3';
        else if (currentSettings.originalProfitClear) currentStrategy = '4.1';
        // Note: Fuse is usually an additional safeguard, but here we treat it as a primary mode if recommended
        // If no primary active, check fuse
        if (currentStrategy === 'NONE' && currentSettings.fuseEnabled) currentStrategy = '4.4_WAIT'; 

        // 7. Generate Recommendation
        const confidence = Math.min(100, best.val);
        let reason = "";
        if (best.id === '4.2') reason = `检测到强趋势 (ADX:${adx.toFixed(0)})，波动率放大，建议顺势解套。`;
        else if (best.id === '4.3') reason = `检测到震荡行情 (ADX:${adx.toFixed(0)})，区间波动，建议回调收割。`;
        else if (best.id === '4.1') reason = `检测到超买/超卖 (RSI:${rsi.toFixed(0)})，乖离率过大，存在V反机会。`;
        else reason = `波动率极低 (BBW:${(bbWidth*100).toFixed(1)}%)，行情即将变盘，建议暂停对冲观望。`;

        // Action Type Determination
        // If best strategy is different from current, AND confidence is high enough -> SWITCH
        // (Treat 4.4_WAIT as a strategy state where normal strategies are off or Fuse is primary)
        const isDifferent = best.id !== currentStrategy;
        // Special case: 4.4_WAIT vs Fuse. If best is 4.4, we want Fuse ON and others OFF. 
        // If current is 4.1/4.2/4.3, that's different.
        
        return {
            symbol,
            timestamp: Date.now(),
            currentStrategy,
            recommendedStrategy: best.id as any,
            confidence,
            reason,
            indicators: { adx, rsi, bbWidth, trend },
            actionType: (isDifferent && confidence >= minConfidence) ? 'SWITCH' : 'KEEP'
        };
    }
}
