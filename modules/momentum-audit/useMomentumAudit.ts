
import { useState, useRef, useEffect, useCallback } from 'react';
import { priceRegistry } from '../../services/priceRegistry';
import { usePersistedState } from '../../hooks/usePersistedState';
import { ScannerItem, List4Config, List3Config } from '../../components/Scanner/scannerTypes';
import { analyzeList4Momentum } from '../../services/rules/list4_momentum';
import { Position } from '../../types';
import { normalizeSymbol, resolvePrice } from '../../services/symbolUtils';
import { saveState } from '../../utils/persistence';
import { db, auth } from '../../firebase';
import { collection, addDoc } from 'firebase/firestore';
import { useAutoHistoryLogger } from './components/ScannerHistoryModal';

// Helper to get minutes from tf string
const getTfMinutes = (tf: string) => {
    const unit = tf.slice(-1);
    const val = parseInt(tf);
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
    onRemoveSignal?: (uniqueId: string) => void, // Callback to remove from List 3
    currentTime?: number // Virtual time for backtesting
) => {
    const [config, setConfig] = usePersistedState<List4Config>('SCANNER_LIST4_CONFIG', initialConfig);
    const [list4, setList4] = useState<ScannerItem[]>(() => {
        try {
            const saved = localStorage.getItem('SCANNER_LIST4_RESULTS');
            if (saved) {
                const parsed = JSON.parse(saved);
                return Array.isArray(parsed) ? parsed : [];
            }
        } catch (e) {}
        return [];
    });
    
    // --- REFS ---
    const realPricesRef = useRef(realPrices);
    const candidatesRef = useRef(candidates);
    const configRef = useRef(config);
    const list3ConfigRef = useRef(list3Config);
    const activePositionsRef = useRef(activePositions);
    const onRemoveSignalRef = useRef(onRemoveSignal);
    const currentTimeRef = useRef(currentTime);

    // Cache for retention logic
    const invalidSignalCacheRef = useRef<Map<string, number>>(new Map());
    const tradedSignalCacheRef = useRef<Map<string, number>>(new Map());
    const triggeredSignalCacheRef = useRef<Map<string, number>>(new Map());
    const fuseBlockedSignalCacheRef = useRef<Map<string, number>>(new Map());
    const advancedFilterBlockedSignalCacheRef = useRef<Map<string, number>>(new Map(
        (() => {
            try {
                const saved = localStorage.getItem('SCANNER_LIST4_ADV_FILTER_BLOCK_TS');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    return Array.isArray(parsed) ? parsed.map((i: any) => [i.key, i.value]) : [];
                }
            } catch (e) {}
            return [];
        })()
    ));
    const fuseAuditLatchRef = useRef<Map<string, { blocked: boolean, reason: string }>>(new Map(
        (() => {
            try {
                const saved = localStorage.getItem('SCANNER_LIST4_FUSE_LATCH');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    return Array.isArray(parsed) ? parsed.map((i: any) => [i.key, i.value]) : [];
                }
            } catch (e) {}
            return [];
        })()
    ));
    const expiredSignalCacheRef = useRef<Set<string>>(new Set(
        (() => {
            try {
                const saved = localStorage.getItem('SCANNER_LIST4_EXPIRED_SIGNALS');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    return Array.isArray(parsed) ? parsed : [];
                }
            } catch (e) {}
            return [];
        })()
    ));

    // Keep refs synced
    useEffect(() => { realPricesRef.current = realPrices; }, [realPrices]);
    useEffect(() => { candidatesRef.current = candidates; }, [candidates]);
    useEffect(() => { 
        configRef.current = config; 
        fuseAuditLatchRef.current.clear();
        localStorage.removeItem('SCANNER_LIST4_FUSE_LATCH');
    }, [config]);
    useEffect(() => { list3ConfigRef.current = list3Config; }, [list3Config]);
    useEffect(() => { activePositionsRef.current = activePositions; }, [activePositions]);
    useEffect(() => { onRemoveSignalRef.current = onRemoveSignal; }, [onRemoveSignal]);
    useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
    const list4Ref = useRef(list4);
    useEffect(() => { list4Ref.current = list4; }, [list4]);

    // Track active List 4 signals and automatically log them to history
    useAutoHistoryLogger('LIST4', list4, activePositions);

    // --- CORE LOGIC: Analysis ---
    // Using refs for core logic to ensure stability and avoid re-renders
    const runMomentumAnalysis = useRef(() => {
        const currentPrices = realPricesRef.current;
        const currentCandidates = candidatesRef.current;
        const currentConfig = configRef.current;
        const l3Config = list3ConfigRef.current;
        const currentPositions = activePositionsRef.current;
        const now = currentTimeRef.current ?? Date.now();

        // SAFE GUARD: If L3 config is not yet loaded, skip analysis to prevent crash
        if (!l3Config) {
            return;
        }

        // 1. Flatten & Filter Candidates (List 3 -> List 4)
        const flatCandidates: ScannerItem[] = [];
        
        currentCandidates.forEach(item => {
            // Use live price if available, else cached
            const livePrice = resolvePrice(item.symbol, currentPrices, item.price);

            if (item.list3Results) {
                item.list3Results.forEach(res => {
                    if (!res.latched) return;
                    
                    const uniqueId = `${item.symbol}-${res.tf}-${res.direction}`;
                    
                    // LATCH LOGIC: Evaluation for Anti-Chase & Direction Lock only happens once
                    let latchedAudit = fuseAuditLatchRef.current.get(uniqueId);
                    
                    if (!latchedAudit) {
                        // First time seeing this signal in List 4? Run expensive historical audit.
                        const singleItemCandidate = [{
                            ...item,
                            price: livePrice,
                            direction: res.direction,
                            tf: res.tf,
                            structure: res.structure
                        }];
                        
                        // Temporarily run analysis to extract fuse status
                        const auditResult = analyzeList4Momentum(singleItemCandidate, currentConfig);
                        if (auditResult.length > 0) {
                            latchedAudit = { 
                                blocked: auditResult[0].fuseBlocked || false, 
                                reason: auditResult[0].fuseReason || '' 
                            };
                            fuseAuditLatchRef.current.set(uniqueId, latchedAudit);
                            console.log(`[List4 Latch] Initial Audit for ${uniqueId}: ${latchedAudit.blocked ? 'BLOCKED - ' + latchedAudit.reason : 'PASSED'}`);
                        }
                    }

                    flatCandidates.push({
                        ...item,
                        price: livePrice, // Inject fresh price
                        direction: res.direction,
                        tf: res.tf,
                        structure: res.structure,
                        // Inject latched results to avoid re-calculating inside analyzeList4Momentum
                        fuseBlocked: latchedAudit?.blocked || false,
                        fuseReason: latchedAudit?.reason || '',
                        fuseLatched: latchedAudit?.blocked || false // Only latch if it was actually blocked
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
                
                const invalidTime = invalidSignalCacheRef.current.get(uniqueId) || now;
                const elapsedMs = now - invalidTime;
                
                // Keep default behavior: candle based removal
                if (currentConfig.removeInvalidCandles && currentConfig.removeInvalidCandles > 0) {
                    const maxMs = currentConfig.removeInvalidCandles * tfMinutes * 60 * 1000;
                    if (elapsedMs >= maxMs) {
                        expiredSignalCacheRef.current.add(uniqueId);
                        shouldKeep = false;
                        item.removalReason = `结构破坏 (设定分钟: ${currentConfig.removeInvalidMinutes || 'N/A'}, 已持续: ${Math.round(elapsedMs / 60000)}分钟)`;
                        onRemoveSignalRef.current?.(uniqueId);
                    }
                }
                // Also check Minute based removal
                if (currentConfig.removeInvalidMinutes && currentConfig.removeInvalidMinutes > 0) {
                    const maxMs = currentConfig.removeInvalidMinutes * 60 * 1000;
                    if (elapsedMs >= maxMs) {
                        expiredSignalCacheRef.current.add(uniqueId);
                        shouldKeep = false;
                        item.removalReason = `结构破坏 (设定分钟: ${currentConfig.removeInvalidMinutes}, 已持续: ${Math.round(elapsedMs / 60000)}分钟)`;
                        onRemoveSignalRef.current?.(uniqueId);
                    }
                }
            } else {
                // Reset if it becomes valid again
                invalidSignalCacheRef.current.delete(uniqueId);
            }
            
            // Check "Triggered" (TRIGGERED)
            if (item.momentum?.status === 'TRIGGERED') {
                if (!triggeredSignalCacheRef.current.has(uniqueId)) {
                    triggeredSignalCacheRef.current.set(uniqueId, now);
                }
                
                if (currentConfig.removeTriggeredMinutes && currentConfig.removeTriggeredMinutes > 0) {
                    const triggeredTime = triggeredSignalCacheRef.current.get(uniqueId) || now;
                    const elapsedMs = now - triggeredTime;
                    const maxMs = currentConfig.removeTriggeredMinutes * 60 * 1000;
                    
                    if (elapsedMs >= maxMs) {
                        expiredSignalCacheRef.current.add(uniqueId);
                        shouldKeep = false;
                        item.removalReason = `触发后超时 (设定: ${currentConfig.removeTriggeredMinutes}分钟, 持续: ${Math.round(elapsedMs / 60000)}分钟)`;
                        onRemoveSignalRef.current?.(uniqueId);
                    }
                }
            } else {
                triggeredSignalCacheRef.current.delete(uniqueId);
            }

            // Check "Fuse Blocked" (fuseBlocked)
            if (item.fuseBlocked) {
                const isAdvancedFilter = item.fuseReason?.startsWith('高级过滤');
                
                if (isAdvancedFilter) {
                    if (!advancedFilterBlockedSignalCacheRef.current.has(uniqueId)) {
                        advancedFilterBlockedSignalCacheRef.current.set(uniqueId, now);
                    }
                    if (currentConfig.autoClearAdvancedFilterMinutes && currentConfig.autoClearAdvancedFilterMinutes > 0) {
                        const fuseTime = advancedFilterBlockedSignalCacheRef.current.get(uniqueId) || now;
                        const elapsedMs = now - fuseTime;
                        const maxMs = currentConfig.autoClearAdvancedFilterMinutes * 60 * 1000;
                        if (elapsedMs >= maxMs) {
                            expiredSignalCacheRef.current.add(uniqueId);
                            shouldKeep = false;
                            item.removalReason = `高级过滤触发: ${item.fuseReason} (设定: ${currentConfig.autoClearAdvancedFilterMinutes}分钟, 已持续: ${Math.round(elapsedMs / 60000)}分钟)`;
                            onRemoveSignalRef.current?.(uniqueId);
                        }
                    }
                } else {
                    if (!fuseBlockedSignalCacheRef.current.has(uniqueId)) {
                        fuseBlockedSignalCacheRef.current.set(uniqueId, now);
                    }
                    
                    if (currentConfig.removeFuseMinutes && currentConfig.removeFuseMinutes > 0) {
                        const fuseTime = fuseBlockedSignalCacheRef.current.get(uniqueId) || now;
                        const elapsedMs = now - fuseTime;
                        const maxMs = currentConfig.removeFuseMinutes * 60 * 1000;
                        
                        if (elapsedMs >= maxMs) {
                            expiredSignalCacheRef.current.add(uniqueId);
                            shouldKeep = false;
                            item.removalReason = `防追高熔断超时: ${item.fuseReason} (设定: ${currentConfig.removeFuseMinutes}分钟, 已持续: ${Math.round(elapsedMs / 60000)}分钟)`;
                            onRemoveSignalRef.current?.(uniqueId);
                        }
                    }
                }
            } else {
                fuseBlockedSignalCacheRef.current.delete(uniqueId);
                advancedFilterBlockedSignalCacheRef.current.delete(uniqueId);
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
                        item.removalReason = `已开仓后超时 (设定K线: ${currentConfig.removeTradedCandles}, 持续时间: ${Math.round(elapsedMs / 60000)}分钟)`;
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
        for (const key of triggeredSignalCacheRef.current.keys()) {
            if (!currentIds.has(key)) triggeredSignalCacheRef.current.delete(key);
        }
        for (const key of fuseBlockedSignalCacheRef.current.keys()) {
            if (!currentIds.has(key)) fuseBlockedSignalCacheRef.current.delete(key);
        }
        for (const key of expiredSignalCacheRef.current.keys()) {
            if (!currentIds.has(key)) expiredSignalCacheRef.current.delete(key);
        }

        // 4. Update State
        const sameLength = list4Ref.current.length === finalItems.length;
        const sameIds = sameLength && list4Ref.current.every((item, i) => 
            `${item.symbol}-${item.tf}-${item.direction}` === `${finalItems[i].symbol}-${finalItems[i].tf}-${finalItems[i].direction}`
        );

        if (!sameLength || !sameIds) {
            setList4(finalItems);
        }

    // Persistence (every 10s or on change)
        const persistenceKey = 'SCANNER_LIST4_PERSIST_TS';
        const lastPersist = Number(sessionStorage.getItem(persistenceKey) || 0);
        if (now - lastPersist > 10000) {
            saveState('SCANNER_LIST4_RESULTS', finalItems, 100);
            saveState('SCANNER_LIST4_FUSE_LATCH', Array.from(fuseAuditLatchRef.current.entries()).map(([key, value]) => ({ key, value })), 500);
            saveState('SCANNER_LIST4_ADV_FILTER_BLOCK_TS', Array.from(advancedFilterBlockedSignalCacheRef.current.entries()).map(([key, value]) => ({ key, value })), 1000);
            saveState('SCANNER_LIST4_EXPIRED_SIGNALS', Array.from(expiredSignalCacheRef.current), 1000);
            sessionStorage.setItem(persistenceKey, now.toString());
        }
    });
    // Debounce analysis to prevent rapid re-renders
    const timerRef = useRef<any>(null);
    const debouncedRunAnalysis = useRef(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            runMomentumAnalysis.current();
        }, 100); // 100ms debounce
    });

    const logToHistory = useCallback(async (item: ScannerItem, reason: string) => {
        if (!auth.currentUser) return;
        try {
            await addDoc(collection(db, 'momentum_history'), {
                symbol: item.symbol,
                direction: item.direction,
                price: item.price,
                timestamp: Date.now(),
                listType: 'LIST4',
                uid: auth.currentUser.uid,
                reason: reason,
                itemData: {
                    symbol: item.symbol,
                    price: item.price,
                    tf: item.tf || '',
                    direction: item.direction || ''
                }
            });
        } catch (e) {
            console.error('Failed to log to history:', e);
        }
    }, []);

    // --- MANUAL ACTIONS ---
    const removeSymbol = useCallback((symbol: string) => {
        // Since List 4 is derived from List 3, we tell List 3 to remove this symbol
        // We do this by calling onRemoveSignal for every item in list4 that matches this symbol
        const itemsToRemove = list4.filter(item => item.symbol === symbol);
        itemsToRemove.forEach(item => {
            const uniqueId = `${item.symbol}-${item.tf}-${item.direction}`;
            onRemoveSignalRef.current?.(uniqueId);
        });
    }, [list4]);

    const clearItems = useCallback(() => {
        // Clear all List 4 signals from List 3
        list4.forEach(item => {
            const uniqueId = `${item.symbol}-${item.tf}-${item.direction}`;
            onRemoveSignalRef.current?.(uniqueId);
        });
    }, [list4]);

    // --- HEARTBEAT TIMER ---
    // REFACTORED: From setInterval (300ms) to Event-Driven Subscription
    useEffect(() => {
        // Subscribe to price updates
        const unsubscribe = priceRegistry.registerListener(() => {
            debouncedRunAnalysis.current();
        });

        // Run analysis once after mount to initialize state
        debouncedRunAnalysis.current();

        return () => unsubscribe();
    }, []);
    // ^ Removed candidates, config, list3Config because runMomentumAnalysis relies on refs, 
    // and runMomentumAnalysis itself is memoized.

    return {
        config,
        setConfig,
        list4,
        removeSymbol,
        clearItems
    };
};
