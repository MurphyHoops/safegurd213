
import { useState, useRef, useEffect, useCallback } from 'react';
import { usePersistedState } from '../../../hooks/usePersistedState';
import { List3Config, List4Config, ScannerItem } from '../../../components/Scanner/scannerTypes';
import { analyzeList4Momentum } from '../../../services/rules/list4_momentum';
import { useBacktest } from '../BacktestContext';

export const useBacktestMomentumAudit = (
    candidates: ScannerItem[],
    list3Config: List3Config | null,
    realPrices: Record<string, number>,
    executeTradeSafe: any
) => {
    const { fetchVirtualKlines, virtualTime } = useBacktest();
    const [config, setConfig] = usePersistedState<List4Config>('SCANNER_LIST4_CONFIG', {
        midlineThreshold: 50,
        breakoutThreshold: 10,
        enableThresholds: true,
        enableAntiChase: true,
        directionFilter: 'BOTH',
        autoExecute: true,
        invalidRetentionMinutes: 10,
        antiChaseConfig: { 
            maxChange24h: 10,
            maxRsi: 80,
            minRsi: 20,
            maxDeviation: 5,
            enableRev3K: true,
            enableStrictMAs: true
        }
    });

    const [results, setResults] = useState<ScannerItem[]>([]);
    const [status, setStatus] = useState<'IDLE' | 'AUDITING'>('IDLE');
    const executedRef = useRef<Set<string>>(new Set());

    const performAudit = async () => {
        if (candidates.length === 0) {
            setResults([]);
            return;
        }

        setStatus('AUDITING');
        const auditedResults = analyzeList4Momentum(candidates, config);
        
        for (const item of auditedResults as any[]) {
            if (item && item.isTriggered) {
                const signalTime = item.structure?.signalTime || 0;
                const uniqueId = `${item.symbol}-${item.tf}-${item.direction}-${signalTime}`;
                
                if (!executedRef.current.has(uniqueId)) {
                    executeTradeSafe(
                        item.symbol, 
                        item.direction || 'LONG', 
                        realPrices[item.symbol], 
                        `[回测] 动能触发: ${item.reason}`,
                        item.tf,
                        null,
                        null
                    );
                    executedRef.current.add(uniqueId);
                }
            }
        }

        setResults(auditedResults);
        setStatus('IDLE');
    };

    useEffect(() => {
        performAudit();
    }, [candidates, virtualTime]);

    return {
        config,
        setConfig,
        results,
        status
    };
};
