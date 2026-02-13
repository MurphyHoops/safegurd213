
import { useState, useRef, useEffect } from 'react';
import { ScannerItem, List4Config, List3Config } from '../../components/Scanner/scannerTypes';
import { analyzeList4Momentum } from '../../services/rules/list4_momentum';

export const useMomentumAudit = (
    candidates: ScannerItem[], // Input from List 3 (Raw)
    initialConfig: List4Config,
    list3Config: List3Config, // STRICT FILTER RULES
    realPrices: Record<string, number> // Live Price Feed
) => {
    const [config, setConfig] = useState<List4Config>(initialConfig);
    const [list4, setList4] = useState<ScannerItem[]>([]);
    
    // --- STATE CACHES for Signal Retention ---
    const invalidSignalCacheRef = useRef<Map<string, number>>(new Map()); // symbol -> timestamp of first INVALID
    const expiredSignalCacheRef = useRef<Set<string>>(new Set()); // symbols that are fully expired

    useEffect(() => {
        // 1. Convert List 3 grouped items into flat List 4 items (one per signal direction)
        // AND inject latest realPrices to ensure triggers work immediately
        // CRITICAL FIX: STRICTLY FILTER BASED ON LIST 3 CONFIG
        const flatCandidates: ScannerItem[] = [];
        
        candidates.forEach(item => {
            // Priority: Real Live Price > Cached List 3 Price
            const currentPrice = realPrices[item.symbol] || item.price;

            if (item.list3Results) {
                item.list3Results.forEach(res => {
                    
                    // --- STRICT FILTERING GATEKEEPER ---
                    if (list3Config) {
                        const s = res.structure;
                        // 1. Timeframe Check
                        if (list3Config.timeframes.length > 0 && !list3Config.timeframes.includes(res.tf)) return;
                        
                        // 2. Strict Trend Check
                        if (list3Config.strictTrend && !s.isStrictTrend) return;

                        // 3. Candle Color Check
                        if (list3Config.checkCandleColor && !s.isColorValid) return;

                        // 4. Thrust Check
                        if (list3Config.enableThrust && !s.thrustValid) return;

                        // 5. Resonance Checks
                        if (list3Config.enableResonance) {
                            if (s.locationPct > list3Config.maxLocation) return;
                            if (s.crossCount < list3Config.minCrossCount) return;
                            if (s.bbw > list3Config.maxBBW) return;
                        }

                        // 6. RSI Checks
                        if (res.direction === 'LONG') {
                            if (s.rsi < list3Config.rsiLongMin || s.rsi > list3Config.rsiLongMax) return;
                        } else {
                            if (s.rsi < list3Config.rsiShortMin || s.rsi > list3Config.rsiShortMax) return;
                        }

                        // 7. Anti-Chase (ROC) Check
                        if (list3Config.antiChase?.enabled && s.periodChange !== undefined) {
                            if (res.direction === 'LONG') {
                                if (s.periodChange > list3Config.antiChase.maxRise) return;
                            } else {
                                // For drop, change is negative (e.g. -60 < -50 is True, means dropped more)
                                if (s.periodChange < -list3Config.antiChase.maxFall) return;
                            }
                        }
                    }
                    // --- END FILTERING ---

                    flatCandidates.push({
                        ...item,
                        price: currentPrice, // Inject fresh price
                        direction: res.direction,
                        tf: res.tf,
                        structure: res.structure
                    });
                });
            }
        });

        // 2. Run Momentum Analysis Logic (Pure Function)
        const analyzedItems = analyzeList4Momentum(flatCandidates, config);

        // 3. Process Retention Logic (INVALID vs EXPIRED)
        const now = Date.now();
        const retentionMs = (config.invalidRetentionMinutes || 10) * 60000;

        const processedList: ScannerItem[] = [];
        const seenKeys = new Set<string>();

        analyzedItems.forEach(item => {
            const key = `${item.symbol}-${item.tf}-${item.direction}`;
            if (seenKeys.has(key)) return; // Dedup
            seenKeys.add(key);

            // Logic:
            // If status is INVALID, check if it's within retention period.
            // If yes, keep it (so user sees why it failed).
            // If no, drop it (expired).
            // If status is PENDING/TRIGGERED, always keep and clear invalid cache.

            if (item.momentum?.status === 'INVALID') {
                if (!invalidSignalCacheRef.current.has(key)) {
                    invalidSignalCacheRef.current.set(key, now);
                }
                
                const firstInvalidTime = invalidSignalCacheRef.current.get(key) || 0;
                
                if (now - firstInvalidTime < retentionMs) {
                    processedList.push(item);
                } else {
                    expiredSignalCacheRef.current.add(key);
                }
            } else {
                // It's valid (Pending/Triggered), so reset invalid timer
                invalidSignalCacheRef.current.delete(key);
                expiredSignalCacheRef.current.delete(key);
                processedList.push(item);
            }
        });

        // 4. Update State
        setList4(processedList);

    }, [candidates, config, realPrices, list3Config]); // Dependency Added: list3Config

    return {
        config,
        setConfig,
        list4
    };
};
