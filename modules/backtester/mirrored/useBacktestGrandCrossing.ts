
import { useState, useRef, useEffect, useCallback } from 'react';
import { usePersistedState } from '../../../hooks/usePersistedState';
import { List2Config, ScannerItem } from '../../../components/Scanner/scannerTypes';
import { analyzeList2Crossing } from '../../../services/rules/list2_crossing';
import { useBacktest } from '../BacktestContext';

const getTfMinutes = (tf: string) => {
    const unit = tf.slice(-1);
    const val = parseInt(tf);
    if (unit === 'm') return val;
    if (unit === 'h') return val * 60;
    if (unit === 'd') return val * 1440;
    return 0;
};

export const useBacktestGrandCrossing = (
    candidates: ScannerItem[],
    initialConfig: List2Config,
    onLog?: (type: 'INFO' | 'SUCCESS' | 'WARNING' | 'DANGER', message: string) => void
) => {
    const { fetchVirtualKlines, virtualTime } = useBacktest();
    const [config, setConfig] = usePersistedState<List2Config>('SCANNER_LIST2_CONFIG', initialConfig);
    const [list2, setList2] = useState<ScannerItem[]>([]);
    const [status, setStatus] = useState<'IDLE' | 'SCANNING'>('IDLE');
    
    const cacheRef = useRef<Map<string, ScannerItem>>(new Map());
    const tfLastScanRef = useRef<Record<string, number>>({});

    const performUpdate = useCallback(() => {
        let items = Array.from(cacheRef.current.values());
        
        // Update prices from candidates
        items = items.map(item => {
            const candidate = candidates.find(c => c.symbol === item.symbol);
            if (candidate) {
                return { ...item, price: candidate.price, change: candidate.change, volume: candidate.volume };
            }
            return item;
        });

        // Update lag relative to current virtualTime
        const maxLag = config.maxLag;
        items = items.map((item): ScannerItem | null => {
            if (!item.groupedResults) return null;
            
            const updatedResults = item.groupedResults.map(r => {
                const tfMinutes = getTfMinutes(r.tf || '15m');
                const intervalMs = tfMinutes * 60 * 1000;
                const signalTime = (r.crossingTimes && r.crossingTimes.length > 0) ? r.crossingTimes[0] : virtualTime;
                const elapsedMs = virtualTime - signalTime;
                const currentLag = Math.floor(elapsedMs / intervalMs);
                return { ...r, lag: currentLag };
            }).filter(r => r.lag! <= maxLag && r.lag! >= 0);

            if (updatedResults.length === 0) return null;
            return { ...item, groupedResults: updatedResults };
        }).filter((item): item is ScannerItem => item !== null);

        setList2(items);
    }, [candidates, config.maxLag, virtualTime]);

    useEffect(() => {
        performUpdate();
    }, [candidates, performUpdate]);

    const runScan = async (targetTfs: string[]) => {
        if (candidates.length === 0) return;
        setStatus('SCANNING');
        onLog?.('INFO', `[回测-列表2] 触发扫描, 周期: ${targetTfs.join(', ')}, 币种数: ${candidates.length}`);

        for (const tf of targetTfs) {
            onLog?.('INFO', `[回测-列表2] 正在扫描 ${tf} 周期...`);
            for (const item of candidates) {
                try {
                    const klines = await fetchVirtualKlines(item.symbol, tf, 150);
                    if (klines.length > 0) {
                        const closes = klines.map(k => k.close);
                        const highs = klines.map(k => k.high);
                        const lows = klines.map(k => k.low);
                        const opens = klines.map(k => k.open);
                        const volumes = klines.map(k => k.volume);
                        const timestamps = klines.map(k => k.time);

                        const results = analyzeList2Crossing(
                            item.symbol, tf, closes, highs, lows, opens, volumes, timestamps, 
                            { ...config, triggerMode: 'ALL' }
                        );

                        if (results.length > 0) {
                            const cacheKey = `${item.symbol}-FULL`;
                            const existing = cacheRef.current.get(cacheKey);
                            const merged = existing ? [...(existing.groupedResults || [])] : [];
                            const cleanMerged = merged.filter(r => r.tf !== tf);
                            cleanMerged.push(...results);
                            
                            cacheRef.current.set(cacheKey, { 
                                ...item, 
                                groupedResults: cleanMerged, 
                                direction: cleanMerged[0].direction, 
                                tf: cleanMerged[0].tf,
                                lastUpdated: virtualTime
                            });

                            onLog?.('SUCCESS', `[回测-列表2] 发现信号: ${item.symbol} ${tf} ${cleanMerged[0].direction}`);
                        }
                    }
                } catch (e) {}
            }
        }
        performUpdate();
        setStatus('IDLE');
    };

    // Trigger scan based on virtual time
    useEffect(() => {
        const triggeredTfs = config.timeframes.filter(tf => {
            const tfMinutes = getTfMinutes(tf);
            if (tfMinutes === 0) return false;
            const intervalMs = tfMinutes * 60 * 1000;
            const currentCandleStart = Math.floor(virtualTime / intervalMs) * intervalMs;
            const lastScan = tfLastScanRef.current[tf] || 0;
            
            if (lastScan < currentCandleStart) {
                tfLastScanRef.current[tf] = virtualTime;
                return true;
            }
            return false;
        });

        if (triggeredTfs.length > 0) {
            runScan(triggeredTfs);
        }
    }, [virtualTime, config.timeframes]);

    return {
        config,
        setConfig,
        list2,
        status,
        scanText: status === 'SCANNING' ? '扫描中...' : '监控中...',
        countdowns: {},
        tfCounts: {},
        activeScanTfs: new Set(),
        lastScanTime: null
    };
};
