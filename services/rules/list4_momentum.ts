
import { List4Config, ScannerItem } from '../../components/Scanner/scannerTypes';

export function analyzeList4Momentum(
    items: ScannerItem[],
    config: List4Config
): ScannerItem[] {
    
    return items.map(item => {
        if (!item.structure) return null;

        const rsi = item.structure.rsi || 50;
        const currentPrice = item.price;
        
        // Include current live price in the extreme calculation for real-time accuracy
        const extreme = item.direction === 'LONG'
            ? Math.min(item.structure.postSignalExtreme ?? currentPrice, currentPrice)
            : Math.max(item.structure.postSignalExtreme ?? currentPrice, currentPrice);
        
        // --- LOGIC: Dynamic Amplitude-Based Thresholds ---
        
        // 1. Calculate Signal Candle Amplitude
        // Use structure High/Low which comes from the specific signal candle found in List 3
        const signalHigh = item.structure.signalHigh ?? item.price; 
        const signalLow = item.structure.signalLow ?? item.price;
        const amplitude = signalHigh - signalLow;

        // 2. Safety: Minimum Amplitude Fallback (OPTIMIZED FOR PRECISION)
        // Previous 0.5% was too strict for small timeframe scalping. 
        // Reduced to 0.1% (0.001) to allow triggering on smaller legitimate candles while filtering pure noise.
        const safeAmplitude = amplitude > (item.price * 0.001) ? amplitude : (item.price * 0.001); 
        
        // 3. Calculate Buffers
        // midlineThreshold: Defense buffer (e.g. 50% of amp)
        const defenseBuffer = safeAmplitude * (config.midlineThreshold / 100);
        // breakoutThreshold: Attack buffer (e.g. 10% of amp)
        const breakoutBuffer = safeAmplitude * (config.breakoutThreshold / 100);

        // 4. Calculate Threshold Prices (FIXED LOGIC based on User Request)
        let midPoint = 0; // Defense Line
        let entryTrigger = 0; // Breakout Trigger
        
        if (item.direction === 'LONG') {
            // Defense Logic (Long):
            // Anchor is Signal HIGH. We allow price to retrace down by X% of amplitude.
            // Formula: High - (Amplitude * Threshold%)
            midPoint = signalHigh - defenseBuffer; 
            
            // Attack Trigger: Breakout above High
            entryTrigger = signalHigh + breakoutBuffer;
        } else {
            // Defense Logic (Short):
            // Anchor is Signal LOW. We allow price to rebound up by X% of amplitude.
            // Formula: Low + (Amplitude * Threshold%)
            midPoint = signalLow + defenseBuffer;
            
            // Attack Trigger: Breakout below Low
            entryTrigger = signalLow - breakoutBuffer;
        }

        // 5. State Machine Logic
        let momentumStatus: 'INVALID' | 'PENDING' | 'TRIGGERED' = 'PENDING';
        let invalidReason = '';

        // Only check thresholds if enabled
        if (config.enableThresholds !== false) {
            // Check if structure is broken (extreme price went beyond safety line)
            if (item.direction === 'LONG') {
                // For Long, if the Lowest Low detected AFTER signal is LOWER than Defense Line -> INVALID
                if (extreme < midPoint) {
                    momentumStatus = 'INVALID';
                    invalidReason = `结构破坏: 回撤(${extreme.toFixed(4)}) 跌破防守线(${midPoint.toFixed(4)})`;
                } else if (currentPrice >= entryTrigger) {
                    momentumStatus = 'TRIGGERED';
                }
            } else {
                // For Short, if the Highest High detected AFTER signal is HIGHER than Defense Line -> INVALID
                if (extreme > midPoint) {
                    momentumStatus = 'INVALID';
                    invalidReason = `结构破坏: 反弹(${extreme.toFixed(4)}) 突破防守线(${midPoint.toFixed(4)})`;
                } else if (currentPrice <= entryTrigger) {
                    momentumStatus = 'TRIGGERED';
                }
            }
        } else {
            // If thresholds disabled, just check breakout for triggering
            if (item.direction === 'LONG' && currentPrice >= entryTrigger) {
                momentumStatus = 'TRIGGERED';
            } else if (item.direction === 'SHORT' && currentPrice <= entryTrigger) {
                momentumStatus = 'TRIGGERED';
            }
        }

        // 6. Anti-Chase Fuse Check
        let fuseBlocked = false;
        let fuseReason = '';
        
        const antiChase = config.antiChaseConfig || { 
            maxRsi: 75, 
            minRsi: 25, 
            maxChange24h: 15, 
            maxDeviation: 10,
            enableRev3K: true,
            enableStrictMAs: false
        };

        if (config.enableAntiChase) {
            // A. RSI Check
            if (item.direction === 'LONG' && rsi > antiChase.maxRsi) {
                fuseBlocked = true;
                fuseReason = `RSI 超买 (${rsi.toFixed(1)})`;
            }
            if (item.direction === 'SHORT' && rsi < antiChase.minRsi) {
                fuseBlocked = true;
                fuseReason = `RSI 超卖 (${rsi.toFixed(1)})`;
            }

            // B. 24H Change Check
            const change = Math.abs(item.change || 0);
            if (change > antiChase.maxChange24h) {
                fuseBlocked = true;
                fuseReason = `24H 涨跌过大 (${change.toFixed(1)}% > ${antiChase.maxChange24h}%)`;
            }

            // C. EMA80 Deviation Check
            if (item.structure?.ema80) {
                const deviation = ((currentPrice - item.structure.ema80) / item.structure.ema80) * 100;
                const absDev = Math.abs(deviation);
                if (absDev > antiChase.maxDeviation) {
                    fuseBlocked = true;
                    fuseReason = `EMA80 乖离过大 (${absDev.toFixed(1)}% > ${antiChase.maxDeviation}%)`;
                }
            }

            // D. Reverse 3K Check
            if (antiChase.enableRev3K && item.structure?.isReverse3K) {
                fuseBlocked = true;
                fuseReason = `逆势三连K拦截 (Rev 3K)`;
            }
        }

        // 7. Direction Filter
        if (config.directionFilter !== 'BOTH') {
            if (config.directionFilter === 'LONG' && item.direction !== 'LONG') return null;
            if (config.directionFilter === 'SHORT' && item.direction !== 'SHORT') return null;
        }

        return {
            ...item,
            momentum: {
                midPoint,
                entryTrigger,
                purityValid: true,
                breakoutValid: true,
                status: momentumStatus,
                invalidReason
            },
            fuseBlocked,
            fuseReason
        };
    }).filter(Boolean) as ScannerItem[];
}
