
import { useState, useRef, useEffect, useCallback } from 'react';
import { usePersistedState } from '../../../hooks/usePersistedState';
import { List3Config, ScannerItem } from '../../../components/Scanner/scannerTypes';
import { analyzeList3Structure } from '../../../services/rules/list3_structure';
import { useBacktest } from '../BacktestContext';
import { normalizeSymbol } from '../../../services/symbolUtils';

export const useBacktestStructureAudit = (
    candidates: ScannerItem[],
    onResultsUpdate: (results: ScannerItem[]) => void,
    onConfigUpdate: (config: List3Config) => void,
    onRemoveSignalReady: ((fn: (uniqueId: string) => void) => void) | undefined,
    realPrices: Record<string, number>,
    onLog?: (type: any, msg: string) => void
) => {
    const { fetchVirtualKlines, virtualTime } = useBacktest();
    const [config, setConfig] = usePersistedState<List3Config>('SCANNER_LIST3_CONFIG', { 
        lookback: 80, 
        enableAmplitudeAudit: true,
        enableMultiResonance: false,
        minResonanceCount: 2,
        timeframes: ['5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'], 
        strictTrend: true,
        checkCandleColor: false, 
        maxBBW: 1.0, 
        validityPeriod: 5, 
        sameColorCross: false, 
        minCrossCount: 0, 
        maxLocation: 100, 
        rsiLongMin: 40, 
        rsiLongMax: 90, 
        rsiShortMin: 10, 
        rsiShortMax: 60, 
        enableRsi: true,
        autoSimOpen: false
    });
    const [results, setResults] = useState<ScannerItem[]>([]);
    const [status, setStatus] = useState<'IDLE' | 'AUDITING'>('IDLE');
    
    const resultsRef = useRef<ScannerItem[]>([]);
    const lastResultsStrRef = useRef<string>('');
    const lastConfigStrRef = useRef<string>('');
    const [manualExclusions, setManualExclusions] = useState<Set<string>>(new Set());
    const expiredSignalCacheRef = useRef<Set<string>>(new Set());
    const loggedSignalsRef = useRef<Set<string>>(new Set());
    
    const isScanningRef = useRef<boolean>(false);
    const hasPendingScanRef = useRef<boolean>(false);

    useEffect(() => {
        if (candidates.length === 0) loggedSignalsRef.current.clear();
    }, [candidates.length]);
    
    // Stable refs for callbacks
    const callbacksRef = useRef({ onResultsUpdate, onConfigUpdate, onLog });
    useEffect(() => {
        callbacksRef.current = { onResultsUpdate, onConfigUpdate, onLog };
    }, [onResultsUpdate, onConfigUpdate, onLog]);

    useEffect(() => {
        const configStr = JSON.stringify(config);
        if (configStr !== lastConfigStrRef.current) {
            callbacksRef.current.onConfigUpdate(config);
            lastConfigStrRef.current = configStr;
        }
    }, [config]);

    const realPricesRef = useRef(realPrices);
    useEffect(() => {
        realPricesRef.current = realPrices;
    }, [realPrices]);

    const virtualTimeRef = useRef(virtualTime);
    useEffect(() => {
        virtualTimeRef.current = virtualTime;
    }, [virtualTime]);

    const performAudit = useCallback(async () => {
        if (isScanningRef.current) {
            hasPendingScanRef.current = true;
            return;
        }

        isScanningRef.current = true;
        setStatus('AUDITING');

        try {
            if (candidates.length === 0) {
                if (resultsRef.current.length !== 0) {
                    lastResultsStrRef.current = '[]';
                    setResults([]);
                    callbacksRef.current.onResultsUpdate([]);
                    resultsRef.current = [];
                }
                return;
            }

            const newResults: ScannerItem[] = [];
            const currentRealPrices = realPricesRef.current;
            const currentVirtualTime = virtualTimeRef.current;

            for (const item of candidates) {
            if (manualExclusions.has(item.symbol)) continue;
            if (!item.groupedResults) continue;
            
            const auditedSignals = [];
            
            // NEW: Enrich History Extremes for Anti-Chase in Backtest
            let historyExtremes = item.historyExtremes;
            if (!historyExtremes) {
                try {
                    const klines1h = await fetchVirtualKlines(item.symbol, '1h', 2300);
                    const klines1m = await fetchVirtualKlines(item.symbol, '1m', 1440);
                    
                    if (klines1h.length > 0 && klines1m.length > 0) {
                        historyExtremes = {
                            highs1h: klines1h.map(k => k.high),
                            lows1h: klines1h.map(k => k.low),
                            highs1m: klines1m.map(k => k.high),
                            lows1m: klines1m.map(k => k.low)
                        };
                    }
                } catch (e) {
                    console.warn(`[Backtest-List3] Failed to fetch extremes for ${item.symbol}`);
                }
            }

            for (const signal of item.groupedResults) {
                const uniqueId = `${item.symbol}-${signal.tf}-${signal.direction}`;
                if (expiredSignalCacheRef.current.has(uniqueId)) continue;

                try {
                    const klines = await fetchVirtualKlines(item.symbol, signal.tf || '15m', config.lookback + 20);
                    if (klines.length > 0) {
                        const closes = klines.map(k => k.close);
                        const highs = klines.map(k => k.high);
                        const lows = klines.map(k => k.low);
                        const opens = klines.map(k => k.open);
                        const volumes = klines.map(k => k.volume);
                        const timestamps = klines.map(k => k.time);

                        const auditResult = analyzeList3Structure(
                            { 
                                symbol: item.symbol, 
                                tf: signal.tf || '15m', 
                                direction: signal.direction || 'LONG', 
                                time: currentVirtualTime, 
                                price: currentRealPrices[normalizeSymbol(item.symbol)] 
                            },
                            closes, highs, lows, opens, volumes, config, klines
                        );

                        if (auditResult) {
                            auditedSignals.push({
                                tf: auditResult.tf!,
                                direction: auditResult.direction! as any,
                                structure: auditResult.structure!,
                                latched: true
                            });
                            if (!loggedSignalsRef.current.has(uniqueId)) {
                                callbacksRef.current.onLog?.('SUCCESS', `[回测-列表3] 结构审计通过: ${item.symbol} ${signal.tf} ${signal.direction}`);
                                loggedSignalsRef.current.add(uniqueId);
                            }
                        }
                    }
                } catch (e) {}
            }

            if (auditedSignals.length > 0) {
                // To support Resonance checking in backtest: Add adjacent Strict Trend logic if enabled
                let adjacentStrictTrends: Record<string, boolean> = {};
                if (config.enableMultiResonance) {
                     const ALL_TFS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
                     const neededTfs = new Set<string>();
                     for (const signal of item.groupedResults!) {
                         const tf = signal.tf || '15m';
                         neededTfs.add(tf);
                         const idx = ALL_TFS.indexOf(tf);
                         if (idx > 0) neededTfs.add(ALL_TFS[idx - 1]);
                         if (idx < ALL_TFS.length - 1) neededTfs.add(ALL_TFS[idx + 1]);
                     }
                     for (const tf of neededTfs) {
                         const klines = await fetchVirtualKlines(item.symbol, tf, config.lookback + 20);
                         if (klines.length > 0) {
                             const closes = klines.map(k => k.close);
                             const highs = klines.map(k => k.high);
                             const lows = klines.map(k => k.low);
                             const opens = klines.map(k => k.open);
                             const volumes = klines.map(k => k.volume);
                             
                             const rL = analyzeList3Structure({ symbol: item.symbol, tf, direction: 'LONG', time: currentVirtualTime, price: currentRealPrices[normalizeSymbol(item.symbol)] }, closes, highs, lows, opens, volumes, config, klines);
                             if (rL?.structure?.isStrictTrend) adjacentStrictTrends[`${tf}-LONG`] = true; else adjacentStrictTrends[`${tf}-LONG`] = false;

                             const rS = analyzeList3Structure({ symbol: item.symbol, tf, direction: 'SHORT', time: currentVirtualTime, price: currentRealPrices[normalizeSymbol(item.symbol)] }, closes, highs, lows, opens, volumes, config, klines);
                             if (rS?.structure?.isStrictTrend) adjacentStrictTrends[`${tf}-SHORT`] = true; else adjacentStrictTrends[`${tf}-SHORT`] = false;
                         }
                     }
                }

                newResults.push({ ...item, groupedResults: item.groupedResults, list3Results: auditedSignals, historyExtremes, adjacentStrictTrends });
            }
        }

        const resultsStr = JSON.stringify(newResults);
        if (resultsStr !== lastResultsStrRef.current) {
            lastResultsStrRef.current = resultsStr;
            resultsRef.current = newResults;
            setResults(newResults);
            callbacksRef.current.onResultsUpdate(newResults);
        }
    } finally {
        isScanningRef.current = false;
        setStatus('IDLE');
        if (hasPendingScanRef.current) {
            hasPendingScanRef.current = false;
            setTimeout(() => {
                performAudit();
            }, 0);
        }
    }
    }, [candidates, config, fetchVirtualKlines, manualExclusions]);

    const removeSignal = useCallback((uniqueId: string) => {
        expiredSignalCacheRef.current.add(uniqueId);
        performAudit();
        onLog?.('INFO', `[回测] 移除信号: ${uniqueId}`);
    }, [onLog, performAudit]);

    useEffect(() => {
        if (onRemoveSignalReady) {
            onRemoveSignalReady(removeSignal);
        }
    }, [onRemoveSignalReady, removeSignal]);

    useEffect(() => {
        performAudit();
    }, [performAudit]);

    const removeItem = useCallback((symbol: string) => {
        setManualExclusions(prev => new Set(prev).add(symbol));
        onLog?.('INFO', `[回测] 移除币种: ${symbol}`);
    }, [onLog]);

    const clearItems = useCallback(() => {
        setResults([]);
        setManualExclusions(new Set(candidates.map(c => c.symbol)));
        onLog?.('INFO', `[回测] 清空审计列表`);
    }, [onLog, candidates]);

    return {
        config,
        setConfig,
        results,
        status,
        removeItem,
        clearItems
    };
};
