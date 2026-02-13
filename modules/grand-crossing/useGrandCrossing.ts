
import { useState, useRef, useEffect, useCallback } from 'react';
import { List2Config, ScannerItem } from '../../components/Scanner/scannerTypes';
import { analyzeList2Crossing } from '../../services/rules/list2_crossing';
import { fetchWithFallback } from '../../services/apiService';

const getTfMinutes = (tf: string) => {
    const unit = tf.slice(-1);
    const val = parseInt(tf);
    if (unit === 'm') return val;
    if (unit === 'h') return val * 60;
    if (unit === 'd') return val * 1440;
    if (unit === 'w') return val * 10080;
    if (unit === 'M') return val * 43200;
    return 0;
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const useGrandCrossing = (
    candidates: ScannerItem[],
    initialConfig: List2Config
) => {
    // --- ATOMIC STATE ---
    const [config, setConfig] = useState<List2Config>(initialConfig);
    const [list2, setList2] = useState<ScannerItem[]>([]);
    const [status, setStatus] = useState<'IDLE' | 'SCANNING'>('IDLE');
    const [scanText, setScanText] = useState('监控中...');
    const [countdowns, setCountdowns] = useState<Record<string, string>>({});
    const [tfCounts, setTfCounts] = useState<Record<string, number>>({});
    
    // Track individual scanning timeframes for UI feedback
    const [activeScanTfs, setActiveScanTfs] = useState<Set<string>>(new Set());

    // --- REFS ---
    const configRef = useRef(config); // For async access
    const cacheRef = useRef<Map<string, ScannerItem>>(new Map());
    const tfLastScanRef = useRef<Record<string, number>>({});
    
    // --- CONCURRENCY LOCK ---
    // Critical: Prevents task stacking which causes crashes
    const isScanningRef = useRef(false);
    
    // --- CAPTURED SIGNALS REF (The "Born" Registry) ---
    // Stores IDs of signals that were detected at Lag 0 during this session.
    // ID Format: `${symbol}-${tf}-${direction}-${timestamp}`
    const capturedSignalsRef = useRef<Set<string>>(new Set());
    
    // Sync Ref
    useEffect(() => { configRef.current = config; }, [config]);

    // --- CLEANUP CACHE ---
    useEffect(() => {
        if (candidates.length > 0) {
            const validSymbols = new Set(candidates.map(c => c.symbol));
            let changed = false;
            for (const key of cacheRef.current.keys()) {
                const symbol = key.split('-')[0];
                if (!validSymbols.has(symbol)) {
                    cacheRef.current.delete(key);
                    changed = true;
                }
            }
            if (changed) updateOutputList();
        }
    }, [candidates]);

    // --- CORE: Update Output List (Logic Hub) ---
    const updateOutputList = useCallback(() => {
        // Start with all cached items
        let items: ScannerItem[] = Array.from(cacheRef.current.values());
        const cfg = configRef.current;
        const sortMode = cfg.sortMode;
        
        // --- 1. FILTERING LOGIC (Deep Filter) ---
        if (cfg.triggerMode === 'NEW') {
            const retention = cfg.newModeRetention ?? 9;
            
            // Map items to a new array where groupedResults are filtered appropriately
            items = items.map((item): ScannerItem | null => {
                if (!item.groupedResults) return null;

                // Deep Filter: strict check against capture registry
                const validSignals = item.groupedResults.filter(r => {
                    // Rule 1: If it's Lag 0 (Brand New), allow it (and it should be in capture list by now via runScan)
                    if (r.lag === 0) return true;

                    // Rule 2: If it's within retention window, CHECK if we captured it when it was young.
                    if (r.lag <= retention) {
                        // Reconstruct ID to check if this specific signal event was seen at birth
                        // We use the latest crossing time associated with this group
                        const signalTime = r.crossingTimes ? Math.max(...r.crossingTimes) : 0;
                        const id = `${item.symbol}-${r.tf}-${r.direction}-${signalTime}`;
                        
                        if (capturedSignalsRef.current.has(id)) {
                            return true; // It's a "known" signal growing old, keep it.
                        }
                    }
                    
                    // Rule 3: It's an old signal that existed before we started scanning (or wasn't caught at Lag 0).
                    // HIDE IT.
                    return false;
                });

                // If no signals remain after filtering, drop the whole item
                if (validSignals.length === 0) return null;

                // Return a new object with filtered signals so we don't mutate the cache
                // Also update the top-level 'direction' and 'tf' to match the primary new signal
                return {
                    ...item,
                    groupedResults: validSignals,
                    direction: validSignals[0].direction,
                    tf: validSignals[0].tf,
                    lag: validSignals[0].lag
                };
            }).filter((item): item is ScannerItem => item !== null);
        } else {
            // ALL MODE: Just standard Lag Filter based on MaxLag
            const maxLag = cfg.maxLag;
            items = items.map((item): ScannerItem | null => {
                if (!item.groupedResults) return null;
                const validSignals = item.groupedResults.filter(r => r.lag! <= maxLag);
                if (validSignals.length === 0) return null;
                return { ...item, groupedResults: validSignals };
            }).filter((item): item is ScannerItem => item !== null);
        }

        // --- 2. SORTING LOGIC ---
        items.sort((a, b) => {
            if (sortMode === 'MOST') {
                const countA = a.groupedResults?.length || 0;
                const countB = b.groupedResults?.length || 0;
                if (countA !== countB) return countB - countA;
            }
            // LATEST Logic (Primary for LATEST, Secondary for MOST)
            const getMinLag = (item: ScannerItem) => 
                item.groupedResults && item.groupedResults.length > 0 
                ? Math.min(...item.groupedResults.map(r => r.lag || 999)) 
                : 999;
            return getMinLag(a) - getMinLag(b);
        });

        setList2(items);

        // Update TF Counts based on the FILTERED list
        const counts: Record<string, number> = {};
        items.forEach(item => {
            item.groupedResults?.forEach(r => {
                if (r.tf) counts[r.tf] = (counts[r.tf] || 0) + 1;
            });
        });
        setTfCounts(counts);
    }, []);

    // --- EFFECT: Trigger update immediately when config changes ---
    useEffect(() => {
        updateOutputList();
    }, [config, updateOutputList]);

    // --- CORE: Scan Logic ---
    const runScan = async (targetTfs: string[]) => {
        if (candidates.length === 0) return;
        if (isScanningRef.current) return; // REJECTION: PREVENT OVERLAP

        isScanningRef.current = true;
        setStatus('SCANNING');
        setScanText(`扫描周期 [${targetTfs.join(', ')}]...`);
        
        // Mark these TFs as scanning
        setActiveScanTfs(prev => {
            const next = new Set(prev);
            targetTfs.forEach(t => next.add(t));
            return next;
        });

        const queue = [...candidates];
        const batchSize = queue.length > 300 ? 10 : 20;

        try {
            while (queue.length > 0) {
                const batch = queue.splice(0, batchSize);
                await Promise.all(batch.map(async (item) => {
                    const analysisResults: any[] = [];
                    
                    for (const tf of targetTfs) {
                        try {
                            const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${item.symbol}&interval=${tf}&limit=150`;
                            const res = await fetchWithFallback(url, {cache: 'no-store'}, (d) => Array.isArray(d));
                            
                            if (res.ok) {
                                const klines = await res.json();
                                const closes = klines.map((k: any) => parseFloat(k[4]));
                                const highs = klines.map((k: any) => parseFloat(k[2]));
                                const lows = klines.map((k: any) => parseFloat(k[3]));
                                const opens = klines.map((k: any) => parseFloat(k[1]));
                                const volumes = klines.map((k: any) => parseFloat(k[5]));
                                const timestamps: number[] = klines.map((k: any) => Number(k[0]));

                                const cfg = configRef.current;
                                
                                // IMPORTANT: We scan DEEP (maxLag or Retention) to get data.
                                // But we use the Capture Registry to decide what's "valid" in NEW mode later.
                                const scanDepth = Math.max(cfg.maxLag, cfg.newModeRetention || 9);

                                const results = analyzeList2Crossing(
                                    item.symbol, tf, closes, highs, lows, opens, volumes, timestamps, 
                                    { ...cfg, triggerMode: 'ALL', maxLag: scanDepth }
                                );
                                
                                // --- REGISTRATION LOGIC ---
                                // Check if any result is "Fresh" (Lag 0) and register it.
                                results.forEach(res => {
                                    if (res.lag === 0) {
                                        // Use the specific signal time for the ID
                                        const signalTime = res.crossingTimes ? Math.max(...res.crossingTimes) : timestamps[timestamps.length-1];
                                        const id = `${item.symbol}-${tf}-${res.direction}-${signalTime}`;
                                        
                                        if (!capturedSignalsRef.current.has(id)) {
                                            capturedSignalsRef.current.add(id);
                                        }
                                    }
                                });

                                analysisResults.push(...results);
                            }
                        } catch (e) {
                            // Silent fail
                        }
                    }

                    // Merge & Cache Logic
                    const cacheKey = `${item.symbol}-FULL`;
                    const existing = cacheRef.current.get(cacheKey);
                    
                    if (analysisResults.length > 0) {
                        // Update cache with new results
                        const merged = existing ? [...(existing.groupedResults || [])] : [];
                        
                        // Remove old results for the current targetTfs to prevent stale data
                        const cleanMerged = merged.filter(r => !targetTfs.includes(r.tf));
                        
                        cleanMerged.push(...analysisResults);
                        
                        if (cleanMerged.length > 0) {
                            // Sort by lag
                            cleanMerged.sort((a, b) => (a.lag || 0) - (b.lag || 0));

                            cacheRef.current.set(cacheKey, { 
                                ...item, 
                                groupedResults: cleanMerged, 
                                direction: cleanMerged[0].direction, 
                                tf: cleanMerged[0].tf, 
                                price: item.price
                            });
                        } else {
                            cacheRef.current.delete(cacheKey);
                        }
                    } else if (existing) {
                        // If no new results found for scanned TFs, clean up cache
                        const cleanMerged = existing.groupedResults?.filter(r => !targetTfs.includes(r.tf)) || [];
                        if (cleanMerged.length > 0) {
                             cacheRef.current.set(cacheKey, { ...existing, groupedResults: cleanMerged });
                        } else {
                             cacheRef.current.delete(cacheKey);
                        }
                    }
                }));
                
                updateOutputList();
                await delay(100); 
            }
        } finally {
            // ALWAYS release lock and cleanup, even if error
            isScanningRef.current = false;
            
            // Unmark these TFs
            setActiveScanTfs(prev => {
                const next = new Set(prev);
                targetTfs.forEach(t => next.delete(t));
                return next;
            });

            setStatus('IDLE');
            setScanText('监控中...');
        }
    };

    // --- EFFECT: Heartbeat & Scheduler ---
    useEffect(() => {
        const timer = setInterval(() => {
            const now = Date.now();
            const newCountdowns: Record<string, string> = {};
            const triggeredTimeframes: string[] = [];

            configRef.current.timeframes.forEach(tf => {
                const tfMinutes = getTfMinutes(tf);
                const intervalMs = tfMinutes * 60 * 1000;
                const nextClose = Math.ceil(now / intervalMs) * intervalMs;
                const diff = nextClose - now;

                if (diff > 0) {
                    const m = Math.floor(diff / 60000).toString().padStart(2, '0');
                    const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
                    newCountdowns[tf] = `${m}:${s}`;
                } else {
                    newCountdowns[tf] = "SCAN";
                }

                const lastScan = tfLastScanRef.current[tf] || 0;
                const scanWindowStart = nextClose - intervalMs;
                
                // Trigger logic: If current time is past 'start of new candle' AND we haven't scanned since then
                // PLUS small buffer (2000ms) to allow exchange to settle data
                if (now > scanWindowStart + 2000 && lastScan < scanWindowStart) {
                    triggeredTimeframes.push(tf);
                    tfLastScanRef.current[tf] = now;
                }
            });

            setCountdowns(newCountdowns);

            // Only trigger if we have candidates AND no scan is currently running (Double check)
            if (triggeredTimeframes.length > 0 && candidates.length > 0 && !isScanningRef.current) {
                runScan(triggeredTimeframes);
            }

        }, 1000);

        return () => clearInterval(timer);
    }, [candidates.length]);

    return {
        config,
        setConfig,
        list2,
        status,
        scanText,
        countdowns,
        tfCounts,
        activeScanTfs 
    };
};
