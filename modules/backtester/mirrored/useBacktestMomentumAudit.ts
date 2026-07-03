
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
            longThresholds: { "2160": 0, "720": 0, "168": 0, "24": 0, "1": 0 },
            shortThresholds: { "2160": 0, "720": 0, "168": 0, "24": 0, "1": 0 },
        },
        enableAutoDirGuard: false,
        autoDirConfig: {
            limit1Q: 0,
            limit1M: 0,
            limit1W: 0,
            limit1D: 0,
            limit1H: 0
        }
    });

    const [results, setResults] = useState<ScannerItem[]>([]);
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
        removeItem,
        clearItems
    };
};
