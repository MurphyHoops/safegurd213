
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
        // Previous 0.1% was still a bit strict for high-precision scalping on pairs with low volatility.
        // Reduced to 0.05% (0.0005) to allow even more sensitive triggering for legitimate micro-structures.
        const safeAmplitude = amplitude > (item.price * 0.0005) ? amplitude : (item.price * 0.0005); 
        
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

        // PRECISION ENHANCEMENT: Increased epsilon to avoid invalidation due to minor volatility within the signal candle.
        const epsilon = currentPrice * 0.0005; 

        // Only check thresholds if enabled
        if (config.enableThresholds !== false) {
            // Check if structure is broken (extreme price went beyond safety line)
            if (item.direction === 'LONG') {
                // For Long, if the Lowest Low detected AFTER signal is LOWER than Defense Line -> INVALID
                if (extreme < (midPoint - epsilon)) {
                    momentumStatus = 'INVALID';
                    invalidReason = `结构破坏: 回撤(${extreme.toFixed(4)}) 跌破防守线(${midPoint.toFixed(4)})`;
                } else if (currentPrice >= (entryTrigger - epsilon)) {
                    momentumStatus = 'TRIGGERED';
                }
            } else {
                // For Short, if the Highest High detected AFTER signal is HIGHER than Defense Line -> INVALID
                if (extreme > (midPoint + epsilon)) {
                    momentumStatus = 'INVALID';
                    invalidReason = `结构破坏: 反弹(${extreme.toFixed(4)}) 突破防守线(${midPoint.toFixed(4)})`;
                } else if (currentPrice <= (entryTrigger + epsilon)) {
                    momentumStatus = 'TRIGGERED';
                }
            }
        } else {
            // If thresholds disabled, just check breakout for triggering
            if (item.direction === 'LONG' && currentPrice >= (entryTrigger - epsilon)) {
                momentumStatus = 'TRIGGERED';
            } else if (item.direction === 'SHORT' && currentPrice <= (entryTrigger + epsilon)) {
                momentumStatus = 'TRIGGERED';
            }
        }

        // 6. Anti-Chase Fuse Check
        let fuseBlocked = item.fuseBlocked || false;
        let fuseReason = item.fuseReason || '';
        
        const antiChase = config.antiChaseConfig;

        // SKIP CALCULATION IF LATCHED
        if (!item.fuseLatched && config.enableAntiChase && item.historyExtremes) {
            const { highs1h, lows1h, highs1m, lows1m, scalars } = item.historyExtremes;

            // Helper to get extreme from raw arrays based on minute period
            const getExtreme = (periodMins: number, type: 'HIGH' | 'LOW'): number | undefined => {
                // TRY SCALARS FIRST (O(1) OPTIMIZATION)
                if (scalars) {
                    const key = `${type.toLowerCase()}_${periodMins}m`;
                    if ((scalars as any)[key]) return (scalars as any)[key];
                }

                // Fallback to expensive array calculation
                if (periodMins <= 1440) { // Up to 24h, use 1m data
                    const candles = periodMins;
                    const arr = type === 'HIGH' ? highs1m : lows1m;
                    if (!arr || arr.length === 0) return undefined;
                    const slice = arr.slice(-candles);
                    return type === 'HIGH' ? Math.max(...slice) : Math.min(...slice);
                } else { // Use 1h data
                    const candles = Math.ceil(periodMins / 60);
                    const arr = type === 'HIGH' ? highs1h : lows1h;
                    if (!arr || arr.length === 0) return undefined;
                    const slice = arr.slice(-candles);
                    return type === 'HIGH' ? Math.max(...slice) : Math.min(...slice);
                }
            };

            if (item.direction === 'LONG') {
                for (let i = 1; i <= 6; i++) {
                    const min = (antiChase as any)[`longPeriod${i}`];
                    const maxDist = (antiChase as any)[`longMaxDist${i}`];
                    
                    if (min && min > 0) {
                        const low = getExtreme(min, 'LOW');
                        if (low && ((currentPrice - low) / low) * 100 > maxDist) {
                            fuseBlocked = true;
                            fuseReason = `防追高: 距窗口${i}(${min}分)低点过远 (${(((currentPrice - low) / low) * 100).toFixed(1)}% > ${maxDist}%)`;
                            break;
                        }
                    }
                }
            } else if (item.direction === 'SHORT') {
                for (let i = 1; i <= 6; i++) {
                    const min = (antiChase as any)[`shortPeriod${i}`];
                    const maxDist = (antiChase as any)[`shortMaxDist${i}`];

                    if (min && min > 0) {
                        const high = getExtreme(min, 'HIGH');
                        if (high && ((high - currentPrice) / high) * 100 > maxDist) {
                            fuseBlocked = true;
                            fuseReason = `防追跌: 距窗口${i}(${min}分)高点过远 (${(((high - currentPrice) / high) * 100).toFixed(1)}% > ${maxDist}%)`;
                            break;
                        }
                    }
                }
            }
        }

        // D. Reverse 3K Check (Independent)
        if (config.enableRev3K && item.structure?.isReverse3K) {
            fuseBlocked = true;
            fuseReason = `逆势三连K拦截 (Rev 3K)`;
        }

        // E. 7K Thrust Check (Independent)
        if (config.enableThrust && item.structure && !item.structure.thrustValid) {
            fuseBlocked = true;
            fuseReason = `7K推进力不足 (<1%)`;
        }

        // F. Auto Direction Guard (达到设置参数，限制不能开多 / 不能开空，以防追涨杀跌)
        if (!item.fuseLatched && config.enableAutoDirGuard && item.historyExtremes && config.autoDirConfig) {
            const { highs1h, lows1h, highs1m, lows1m, scalars } = item.historyExtremes;
            const autoDir = config.autoDirConfig;

            const getExtremeLocal = (periodMins: number, type: 'HIGH' | 'LOW'): number | undefined => {
                // TRY SCALARS FIRST (O(1) OPTIMIZATION)
                if (scalars) {
                    const key = `${type.toLowerCase()}_${periodMins}m`;
                    if ((scalars as any)[key]) return (scalars as any)[key];
                }

                if (periodMins <= 1440) { // Up to 24h, use 1m data
                    const candles = periodMins;
                    const arr = type === 'HIGH' ? highs1m : lows1m;
                    if (!arr || arr.length === 0) return undefined;
                    const slice = arr.slice(-candles);
                    return type === 'HIGH' ? Math.max(...slice) : Math.min(...slice);
                } else { // Use 1h data
                    const candles = Math.ceil(periodMins / 60);
                    const arr = type === 'HIGH' ? highs1h : lows1h;
                    if (!arr || arr.length === 0) return undefined;
                    const slice = arr.slice(-candles);
                    return type === 'HIGH' ? Math.max(...slice) : Math.min(...slice);
                }
            };

            if (item.direction === 'LONG') {
                for (let i = 1; i <= 6; i++) {
                    const min = (autoDir as any)[`longPeriod${i}`];
                    const maxDist = (autoDir as any)[`longMaxDist${i}`];

                    if (min && min > 0) {
                        const low = getExtremeLocal(min, 'LOW');
                        if (low && ((currentPrice - low) / low) * 100 > maxDist) {
                            fuseBlocked = true;
                            fuseReason = `动态方向锁: 距窗口${i}(${min}分)低点过远 (${(((currentPrice - low) / low) * 100).toFixed(1)}% > ${maxDist}%) 达到做多锁定参数，不能开多`;
                            break;
                        }
                    }
                }
            } else if (item.direction === 'SHORT') {
                for (let i = 1; i <= 6; i++) {
                    const min = (autoDir as any)[`shortPeriod${i}`];
                    const maxDist = (autoDir as any)[`shortMaxDist${i}`];

                    if (min && min > 0) {
                        const high = getExtremeLocal(min, 'HIGH');
                        if (high && ((high - currentPrice) / high) * 100 > maxDist) {
                            fuseBlocked = true;
                            fuseReason = `动态方向锁: 距窗口${i}(${min}分)高点过远 (${(((high - currentPrice) / high) * 100).toFixed(1)}% > ${maxDist}%) 达到做空锁定参数，不能开空`;
                            break;
                        }
                    }
                }
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
