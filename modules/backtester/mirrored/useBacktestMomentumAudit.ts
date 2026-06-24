
import { useState, useRef, useEffect, useCallback } from 'react';
import { usePersistedState } from '../../../hooks/usePersistedState';
import { List3Config, List4Config, ScannerItem, ActionConfig } from '../../../components/Scanner/scannerTypes';
import { analyzeList4Momentum } from '../../../services/rules/list4_momentum';
import { useBacktest } from '../BacktestContext';
import { normalizeSymbol } from '../../../services/symbolUtils';
import { Position } from '../../../types';

const getTfMinutes = (tf: string) => {
    const unit = tf.slice(-1);
    const val = parseInt(tf);
    if (unit === 'm') return val;
    if (unit === 'h') return val * 60;
    if (unit === 'd') return val * 1440;
    return 15;
};

export const useBacktestMomentumAudit = (
    candidates: ScannerItem[],
    list3Config: List3Config | null,
    realPrices: Record<string, number>,
    executeTradeSafe: any,
    actionConfig?: ActionConfig | null,
    activePositions?: Position[],
    onRemoveSignal?: (uniqueId: string) => void
) => {
    const { fetchVirtualKlines, virtualTime } = useBacktest();
    const [config, setConfig] = usePersistedState<List4Config>('SCANNER_LIST4_CONFIG', {
        midlineThreshold: 50,
        breakoutThreshold: 10,
        enableThresholds: true,
        enableAntiChase: true,
        enableRev3K: true,
        enableThrust: true,
        directionFilter: 'BOTH',
        autoExecute: true,
        invalidRetentionMinutes: 10,
        removeInvalidMinutes: 15,
        removeTriggeredMinutes: 15,
        removeFuseMinutes: 15,
        antiChaseConfig: { 
            longMaxDist1: 40, longMaxDist2: 35, longMaxDist3: 30, longMaxDist4: 25, longMaxDist5: 20, longMaxDist6: 15, longMaxDist7: 10,
            longPeriod1: 43200, longPeriod2: 10080, longPeriod3: 1440, longPeriod4: 240, longPeriod5: 60, longPeriod6: 5, longPeriod7: 1,
            shortMaxDist1: 40, shortMaxDist2: 35, shortMaxDist3: 30, shortMaxDist4: 25, shortMaxDist5: 20, shortMaxDist6: 15, shortMaxDist7: 10,
            shortPeriod1: 43200, shortPeriod2: 10080, shortPeriod3: 1440, shortPeriod4: 240, shortPeriod5: 60, shortPeriod6: 5, shortPeriod7: 1
        },
        enableAutoDirGuard: false,
        autoDirConfig: {
            longMaxDist1: 40, longMaxDist2: 35, longMaxDist3: 30, longMaxDist4: 25, longMaxDist5: 20, longMaxDist6: 15, longMaxDist7: 10,
            longPeriod1: 43200, longPeriod2: 10080, longPeriod3: 1440, longPeriod4: 240, longPeriod5: 60, longPeriod6: 5, longPeriod7: 1,
            shortMaxDist1: 40, shortMaxDist2: 35, shortMaxDist3: 30, shortMaxDist4: 25, shortMaxDist5: 20, shortMaxDist6: 15, shortMaxDist7: 10,
            shortPeriod1: 43200, shortPeriod2: 10080, shortPeriod3: 1440, shortPeriod4: 240, shortPeriod5: 60, shortPeriod6: 5, shortPeriod7: 1
        }
    });

    const [results, setResults] = useState<ScannerItem[]>([]);
    const [status, setStatus] = useState<'IDLE' | 'AUDITING'>('IDLE');
    const lastResultsStrRef = useRef<string>('');
    const executedRef = useRef<Set<string>>(new Set());

    // Stable refs for callbacks
    const callbacksRef = useRef({ executeTradeSafe, onRemoveSignal });
    useEffect(() => {
        callbacksRef.current = { executeTradeSafe, onRemoveSignal };
    }, [executeTradeSafe, onRemoveSignal]);

    // Cache for retention logic
    const invalidSignalCacheRef = useRef<Map<string, number>>(new Map());
    const tradedSignalCacheRef = useRef<Map<string, number>>(new Map());
    const expiredSignalCacheRef = useRef<Set<string>>(new Set());
    const [manualExclusions, setManualExclusions] = useState<Set<string>>(new Set());

    const performAudit = useCallback(() => {
        if (candidates.length === 0) {
            if (results.length !== 0) {
                lastResultsStrRef.current = '[]';
                setResults([]);
            }
            return;
        }

        setStatus('AUDITING');
        const auditedResults = analyzeList4Momentum(candidates, config);
        
        const isMasterAutoOn = actionConfig?.autoExecute;
        const finalResults: ScannerItem[] = [];

        for (const item of auditedResults as any[]) {
            if (manualExclusions.has(item.symbol)) continue;
            
            const uniqueId = `${item.symbol}-${item.tf}-${item.direction}`;
            let shouldKeep = true;
            const tfMinutes = getTfMinutes(item.tf || '15m');
            const now = virtualTime;

            // Check "Structure Broken" (INVALID)
            if (item.momentum?.status === 'INVALID') {
                if (!invalidSignalCacheRef.current.has(uniqueId)) {
                    invalidSignalCacheRef.current.set(uniqueId, now);
                }
                
                if (config.removeInvalidCandles && config.removeInvalidCandles > 0) {
                    const invalidTime = invalidSignalCacheRef.current.get(uniqueId) || now;
                    const elapsedMs = now - invalidTime;
                    const maxMs = config.removeInvalidCandles * tfMinutes * 60 * 1000;
                    
                    if (elapsedMs >= maxMs) {
                        expiredSignalCacheRef.current.add(uniqueId);
                        shouldKeep = false;
                        callbacksRef.current.onRemoveSignal?.(uniqueId);
                    }
                }
            } else {
                invalidSignalCacheRef.current.delete(uniqueId);
            }
            
            // Check "Position Opened" (TRADED)
            const hasPosition = activePositions?.some(p => p.symbol === item.symbol && p.side === item.direction);
            if (hasPosition) {
                if (!tradedSignalCacheRef.current.has(uniqueId)) {
                    tradedSignalCacheRef.current.set(uniqueId, now);
                }
                
                if (config.removeTradedCandles && config.removeTradedCandles > 0) {
                    const tradedTime = tradedSignalCacheRef.current.get(uniqueId) || now;
                    const elapsedMs = now - tradedTime;
                    const maxMs = config.removeTradedCandles * tfMinutes * 60 * 1000;
                    
                    if (elapsedMs >= maxMs) {
                        expiredSignalCacheRef.current.add(uniqueId);
                        shouldKeep = false;
                        callbacksRef.current.onRemoveSignal?.(uniqueId);
                    }
                }
            } else {
                tradedSignalCacheRef.current.delete(uniqueId);
            }

            if (expiredSignalCacheRef.current.has(uniqueId)) {
                shouldKeep = false;
            }

            if (shouldKeep) {
                finalResults.push(item);
                
                // Correct logic matching List 4 requirements for Auto Execute
                const isTriggered = item.momentum?.status === 'TRIGGERED' && !item.fuseBlocked;
                
                if (item && isTriggered && config.autoExecute && isMasterAutoOn) {
                    const signalTime = item.structure?.signalTime || 0;
                    const uniqueExecId = `${item.symbol}-${item.tf}-${item.direction}-${signalTime}`;
                    
                    if (!executedRef.current.has(uniqueExecId)) {
                        callbacksRef.current.executeTradeSafe(
                            item.symbol, 
                            item.direction || 'LONG', 
                            realPrices[normalizeSymbol(item.symbol)], 
                            `[回测] 动能触发: ${item.reason}`,
                            item.tf,
                            null,
                            null
                        );
                        executedRef.current.add(uniqueExecId);
                    }
                }
            }
        }

        const resultsStr = JSON.stringify(finalResults);
        if (resultsStr !== lastResultsStrRef.current) {
            lastResultsStrRef.current = resultsStr;
            setResults(finalResults);
        }
        setStatus('IDLE');
    }, [candidates, config, virtualTime, manualExclusions, activePositions, realPrices, actionConfig?.autoExecute]);

    useEffect(() => {
        performAudit();
    }, [performAudit]);

    const removeItem = useCallback((symbol: string) => {
        setManualExclusions(prev => new Set(prev).add(symbol));
    }, []);

    const clearItems = useCallback(() => {
        setResults([]);
        setManualExclusions(new Set(candidates.map(c => c.symbol)));
    }, [candidates]);

    return {
        config,
        setConfig,
        results,
        status,
        removeItem,
        clearItems
    };
};
