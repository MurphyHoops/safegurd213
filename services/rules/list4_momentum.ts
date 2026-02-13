
import { List4Config, ScannerItem } from '../../components/Scanner/scannerTypes';

export function analyzeList4Momentum(
    items: ScannerItem[],
    config: List4Config
): ScannerItem[] {
    
    return items.map(item => {
        if (!item.structure) return null;

        const rsi = item.structure.rsi || 50;
        // const signalPrice = item.structure.signalPrice || item.price; // Deprecated for calculation
        const extreme = item.structure.postSignalExtreme ?? item.price;
        const currentPrice = item.price;
        
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
            // Anchor is Signal HIGH. We allow price to retrace down by X%.
            // Formula: High - (Amplitude * Threshold)
            // Example: High 1100, Low 1000, Thres 50%. Limit = 1100 - 50 = 1050.
            midPoint = signalHigh - defenseBuffer; 
            
            // Attack Trigger: Breakout above High
            entryTrigger = signalHigh + breakoutBuffer;
        } else {
            // Defense Logic (Short):
            // Anchor is Signal LOW. We allow price to rebound up by X%.
            // Formula: Low + (Amplitude * Threshold)
            // Example: High 1000, Low 900, Thres 50%. Limit = 900 + 50 = 950.
            midPoint = signalLow + defenseBuffer;
            
            // Attack Trigger: Breakout below Low
            entryTrigger = signalLow - breakoutBuffer;
        }

        // 5. State Machine Logic
        let momentumStatus: 'INVALID' | 'PENDING' | 'TRIGGERED' = 'PENDING';
        let invalidReason = '';

        // Check if structure is broken (extreme price went beyond safety line)
        if (item.direction === 'LONG') {
            // For Long, if the Lowest Low detected AFTER signal is LOWER than Defense Line -> INVALID
            // Note: postSignalExtreme tracks the lowest low for LONG signals
            if (extreme < midPoint) {
                momentumStatus = 'INVALID';
                invalidReason = `结构破坏: 回撤(${extreme.toFixed(4)}) 跌破防守线(${midPoint.toFixed(4)})`;
            }
        } else {
            // For Short, if the Highest High detected AFTER signal is HIGHER than Defense Line -> INVALID
            // Note: postSignalExtreme tracks the highest high for SHORT signals
            if (extreme > midPoint) {
                momentumStatus = 'INVALID';
                invalidReason = `结构破坏: 反弹(${extreme.toFixed(4)}) 突破防守线(${midPoint.toFixed(4)})`;
            }
        }

        // If structure valid, check for Trigger (PRECISION UPDATE: Use >= and <=)
        if (momentumStatus !== 'INVALID') {
            if (item.direction === 'LONG') {
                if (currentPrice >= entryTrigger) {
                    momentumStatus = 'TRIGGERED';
                } else {
                    momentumStatus = 'PENDING'; 
                }
            } else {
                if (currentPrice <= entryTrigger) {
                    momentumStatus = 'TRIGGERED';
                } else {
                    momentumStatus = 'PENDING'; 
                }
            }
        }

        // 6. Anti-Chase Fuse Check
        let fuseBlocked = false;
        let fuseReason = '';
        
        const antiChase = config.antiChaseConfig || { maxRsi: 75, minRsi: 25 };

        if (config.enableAntiChase) {
            if (item.direction === 'LONG' && rsi > antiChase.maxRsi) {
                fuseBlocked = true;
                fuseReason = `RSI Overbought (${rsi.toFixed(1)})`;
            }
            if (item.direction === 'SHORT' && rsi < antiChase.minRsi) {
                fuseBlocked = true;
                fuseReason = `RSI Oversold (${rsi.toFixed(1)})`;
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
