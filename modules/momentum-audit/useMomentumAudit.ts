
import { useState, useRef, useEffect, useCallback } from 'react';
import { usePersistedState } from '../../hooks/usePersistedState';
import { ScannerItem, List4Config, List3Config } from '../../components/Scanner/scannerTypes';
import { analyzeList4Momentum } from '../../services/rules/list4_momentum';
import { Position } from '../../types';

// Helper to get minutes from tf string
const getTfMinutes = (tf: string) => {
    const unit = tf.slice(-1);
    const val = parseInt(tf.slice(0, -1));
    if (unit === 'm') return val;
    if (unit === 'h') return val * 60;
    if (unit === 'd') return val * 1440;
    return 15;
};

export const useMomentumAudit = (
    candidates: ScannerItem[], // Input from List 3 (Raw)
    initialConfig: List4Config,
    list3Config: List3Config | null, // Allow null type here
    realPrices: Record<string, number>, // Live Price Feed
    activePositions: Position[] = [], // Active positions
    onRemoveSignal?: (uniqueId: string) => void // Callback to remove from List 3
) => {
    const [config, setConfig] = usePersistedState<List4Config>('SCANNER_LIST4_CONFIG', initialConfig);
    const [list4, setList4] = useState<ScannerItem[]>([]);
    
    // --- REFS ---
    const realPricesRef = useRef(realPrices);
    const candidatesRef = useRef(candidates);
    const configRef = useRef(config);
    const list3ConfigRef = useRef(list3Config);
    const activePositionsRef = useRef(activePositions);
    const onRemoveSignalRef = useRef(onRemoveSignal);
    
    // Cache for retention logic
    const invalidSignalCacheRef = useRef<Map<string, number>>(new Map());
    const tradedSignalCacheRef = useRef<Map<string, number>>(new Map());
    const expiredSignalCacheRef = useRef<Set<string>>(new Set());

    // Keep refs synced
    useEffect(() => { realPricesRef.current = realPrices; }, [realPrices]);
    useEffect(() => { candidatesRef.current = candidates; }, [candidates]);
    useEffect(() => { configRef.current = config; }, [config]);
    useEffect(() => { list3ConfigRef.current = list3Config; }, [list3Config]);
    useEffect(() => { activePositionsRef.current = activePositions; }, [activePositions]);
    useEffect(() => { onRemoveSignalRef.current = onRemoveSignal; }, [onRemoveSignal]);

    // --- CORE LOGIC: Analysis ---
    // This function is pure logic, reading from Refs
    const runMomentumAnalysis = useCallback(() => {
        const currentPrices = realPricesRef.current;
        const currentCandidates = candidatesRef.current;
        const currentConfig = configRef.current;
        const l3Config = list3ConfigRef.current;
        const currentPositions = activePositionsRef.current;
        const now = Date.now();

        // SAFE GUARD: If L3 config is not yet loaded, skip analysis to prevent crash
        if (!l3Config) {
            return;
        }

        // 1. Flatten & Filter Candidates (List 3 -> List 4)
        const flatCandidates: ScannerItem[] = [];
        
        currentCandidates.forEach(item => {
            // Use live price if available, else cached
            const livePrice = currentPrices[item.symbol] || item.price;

            if (item.list3Results) {
                item.list3Results.forEach(res => {
                    if (!res.latched) return;

                    flatCandidates.push({
                        ...item,
                        price: livePrice, // Inject fresh price
                        direction: res.direction,
                        tf: res.tf,
                        structure: res.structure
                    });
                });
            }
        });

        // 2. Run Momentum Math
        const analyzedItems = analyzeList4Momentum(flatCandidates, currentConfig);

        // 3. Apply Removal Logic
        const finalItems: ScannerItem[] = [];
        
        analyzedItems.forEach(item => {
            const uniqueId = `${item.symbol}-${item.tf}-${item.direction}`;
            
            // If already permanently expired, skip
            if (expiredSignalCacheRef.current.has(uniqueId)) return;
            
            let shouldKeep = true;
            const tfMinutes = getTfMinutes(item.tf || '15m');
            
            // Check "Structure Broken" (INVALID)
            if (item.momentum?.status === 'INVALID') {
                if (!invalidSignalCacheRef.current.has(uniqueId)) {
                    invalidSignalCacheRef.current.set(uniqueId, now);
                }
                
                if (currentConfig.removeInvalidCandles && currentConfig.removeInvalidCandles > 0) {
                    const invalidTime = invalidSignalCacheRef.current.get(uniqueId) || now;
                    const elapsedMs = now - invalidTime;
                    const maxMs = currentConfig.removeInvalidCandles * tfMinutes * 60 * 1000;
                    
                    if (elapsedMs >= maxMs) {
                        expiredSignalCacheRef.current.add(uniqueId);
                        shouldKeep = false;
                        onRemoveSignalRef.current?.(uniqueId);
                    }
                }
            } else {
                // Reset if it becomes valid again
                invalidSignalCacheRef.current.delete(uniqueId);
            }
            
            // Check "Position Opened" (TRADED)
            const hasPosition = currentPositions.some(p => p.symbol === item.symbol && p.side === item.direction);
            if (hasPosition) {
                if (!tradedSignalCacheRef.current.has(uniqueId)) {
                    tradedSignalCacheRef.current.set(uniqueId, now);
                }
                
                if (currentConfig.removeTradedCandles && currentConfig.removeTradedCandles > 0) {
                    const tradedTime = tradedSignalCacheRef.current.get(uniqueId) || now;
                    const elapsedMs = now - tradedTime;
                    const maxMs = currentConfig.removeTradedCandles * tfMinutes * 60 * 1000;
                    
                    if (elapsedMs >= maxMs) {
                        expiredSignalCacheRef.current.add(uniqueId);
                        shouldKeep = false;
                        onRemoveSignalRef.current?.(uniqueId);
                    }
                }
            } else {
                // Reset if position is closed
                tradedSignalCacheRef.current.delete(uniqueId);
            }
            
            if (shouldKeep) {
                finalItems.push(item);
            }
        });

        // Clean up caches for items that are no longer in the pipeline
        const currentIds = new Set(analyzedItems.map(item => `${item.symbol}-${item.tf}-${item.direction}`));
        for (const key of invalidSignalCacheRef.current.keys()) {
            if (!currentIds.has(key)) invalidSignalCacheRef.current.delete(key);
        }
        for (const key of tradedSignalCacheRef.current.keys()) {
            if (!currentIds.has(key)) tradedSignalCacheRef.current.delete(key);
        }
        for (const key of expiredSignalCacheRef.current.keys()) {
            if (!currentIds.has(key)) expiredSignalCacheRef.current.delete(key);
        }

        // 4. Update State
        setList4(finalItems);
    }, []);

    // --- HEARTBEAT TIMER ---
    // Instead of reacting to every price tick, we run logic once per second.
    // This prevents the "White Screen" caused by 100+ re-renders per second.
    useEffect(() => {
        // Run immediately on mount/config change
        runMomentumAnalysis();

        const timer = setInterval(() => {
            runMomentumAnalysis();
        }, 1000); // 1 Second Heartbeat

        return () => clearInterval(timer);
    }, [runMomentumAnalysis, candidates, config, list3Config]); 
    // ^ Note: realPrices is intentionally OMITTED from dependencies. 
    // The interval handles the price updates via ref.

    return {
        config,
        setConfig,
        list4
    };
};
