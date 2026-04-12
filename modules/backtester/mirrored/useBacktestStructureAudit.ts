
import { useState, useRef, useEffect, useCallback } from 'react';
import { usePersistedState } from '../../../hooks/usePersistedState';
import { List3Config, ScannerItem } from '../../../components/Scanner/scannerTypes';
import { analyzeList3Structure } from '../../../services/rules/list3_structure';
import { useBacktest } from '../BacktestContext';

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
        enableResonance: true,
        timeframes: ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h'], 
        enableThrust: false, 
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
        autoSimOpen: false, 
        antiChase: { enabled: true, maxRise: 100, maxFall: 50 }
    });
    const [results, setResults] = useState<ScannerItem[]>([]);
    const [status, setStatus] = useState<'IDLE' | 'AUDITING'>('IDLE');
    
    const cacheRef = useRef<Map<string, ScannerItem>>(new Map());

    useEffect(() => {
        onConfigUpdate(config);
    }, [config, onConfigUpdate]);

    const performAudit = useCallback(async () => {
        if (candidates.length === 0) {
            setResults([]);
            onResultsUpdate([]);
            return;
        }

        setStatus('AUDITING');
        const newResults: ScannerItem[] = [];

        for (const item of candidates) {
            if (!item.groupedResults) continue;
            
            const auditedSignals = [];
            for (const signal of item.groupedResults) {
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
                                time: virtualTime, 
                                price: realPrices[item.symbol] 
                            },
                            closes, highs, lows, opens, volumes, config, klines
                        );

                        if (auditResult) {
                            auditedSignals.push(auditResult);
                            onLog?.('SUCCESS', `[回测-列表3] 结构审计通过: ${item.symbol} ${signal.tf} ${signal.direction}`);
                        }
                    }
                } catch (e) {}
            }

            if (auditedSignals.length > 0) {
                newResults.push({ ...item, groupedResults: auditedSignals });
            }
        }

        setResults(newResults);
        onResultsUpdate(newResults);
        setStatus('IDLE');
    }, [candidates, config, fetchVirtualKlines, onLog, onResultsUpdate, realPrices, virtualTime]);

    const removeSignal = useCallback((uniqueId: string) => {
        onLog?.('INFO', `[回测] 移除信号: ${uniqueId}`);
    }, [onLog]);

    useEffect(() => {
        if (onRemoveSignalReady) {
            onRemoveSignalReady(removeSignal);
        }
    }, [onRemoveSignalReady, removeSignal]);

    useEffect(() => {
        performAudit();
    }, [performAudit]);

    return {
        config,
        setConfig,
        results,
        status
    };
};
