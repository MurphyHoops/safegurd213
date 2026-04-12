
import { useState, useRef, useEffect, useCallback } from 'react';
import { usePersistedState } from '../../hooks/usePersistedState';
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
    initialConfig: List2Config,
    directMode: boolean = false,
    onLog?: (type: 'INFO' | 'SUCCESS' | 'WARNING' | 'DANGER', message: string) => void
) => {
    // --- ATOMIC STATE ---
    const [config, setConfig] = usePersistedState<List2Config>('SCANNER_LIST2_CONFIG', initialConfig);
    const [list2, setList2] = useState<ScannerItem[]>(() => {
        try {
            const saved = localStorage.getItem('SCANNER_LIST2_CACHE_MAP');
            if (saved) {
                const parsed = JSON.parse(saved);
                return Array.isArray(parsed) ? parsed.map((item: any) => item.value) : [];
            }
        } catch(e) {}
        return [];
    });
    const [status, setStatus] = useState<'IDLE' | 'SCANNING'>('IDLE');
    const [scanText, setScanText] = useState('监控中...');
    const [countdowns, setCountdowns] = useState<Record<string, string>>({});
    const [tfCounts, setTfCounts] = useState<Record<string, number>>({});
    
    // Track individual scanning timeframes for UI feedback
    const [activeScanTfs, setActiveScanTfs] = useState<Set<string>>(new Set());
    const [lastScanTime, setLastScanTime] = useState<number | null>(null);

    // --- REFS ---
    const configRef = useRef(config); // For async access
    const cacheRef = useRef<Map<string, ScannerItem>>(new Map(
        (() => {
            try {
                const saved = localStorage.getItem('SCANNER_LIST2_CACHE_MAP');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    return Array.isArray(parsed) ? parsed.map((item: any) => [item.key, item.value]) : [];
                }
            } catch(e) {}
            return [];
        })()
    ));
    const tfLastScanRef = useRef<Record<string, number>>({});
    const candidatesRef = useRef(candidates);
    
    // --- THROTTLE REFS ---
    const lastUpdateTimestampRef = useRef<number>(0);
    const pendingUpdateRef = useRef<boolean>(false);
    
    // --- CONCURRENCY LOCK ---
    const isScanningRef = useRef(false);
    
    // --- CAPTURED SIGNALS REF ---
    const capturedSignalsRef = useRef<Set<string>>(new Set(
        (() => {
            try {
                const saved = localStorage.getItem('SCANNER_LIST2_CAPTURED_SIGNALS');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    return Array.isArray(parsed) ? parsed : [];
                }
            } catch(e) {}
            return [];
        })()
    ));
    
    // --- CORE: Update Output List (Logic Hub) ---
    const performUpdate = useCallback(() => {
        const now = Date.now();
        const lastUpdate = lastUpdateTimestampRef.current || now;
        const timeDiffMs = now - lastUpdate;

        // Start with all cached items
        let items: ScannerItem[] = Array.from(cacheRef.current.values());
        
        // Update lag for each signal dynamically
        items.forEach(item => {
            item.groupedResults?.forEach(r => {
                const tfMinutes = getTfMinutes(r.tf || '');
                if (tfMinutes > 0) {
                    const lagIncrease = timeDiffMs / (tfMinutes * 60 * 1000);
                    r.lag += lagIncrease;
                }
            });
        });

        const cfg = configRef.current;
        const sortMode = cfg.sortMode;
        const currentCandidates = candidatesRef.current;
        
        // --- 0. UPDATE PRICES FROM CANDIDATES ---
        items = items.map(item => {
            const candidate = currentCandidates.find(c => c.symbol === item.symbol);
            if (candidate) {
                return { ...item, price: candidate.price, change: candidate.change, volume: candidate.volume };
            }
            return item;
        });
        
        // --- 1. FILTERING LOGIC ---
        if (cfg.triggerMode === 'NEW') {
            const retention = cfg.newModeRetention ?? 9;
            items = items.map((item): ScannerItem | null => {
                if (!item.groupedResults) return null;
                const validSignals = item.groupedResults.filter(r => {
                    // 1. Strict Lag Check: If the oldest signal in the cluster is older than retention, it must disappear.
                    console.log(`[List2 DEBUG] Symbol: ${item.symbol}, TF: ${r.tf}, Direction: ${r.direction}, Lag: ${r.lag}, Retention: ${retention}`);
                    if (r.lag >= retention) {
                        console.log(`[List2] Filtering out ${item.symbol} ${r.tf} ${r.direction} due to lag ${r.lag} >= retention ${retention}`);
                        return false;
                    }

                    // 2. If it's within retention, we keep it if it's a recent crossing OR if it's a captured signal.
                    const hasRecentCrossing = r.crossingLags && r.crossingLags.some(l => l <= 1);
                    if (hasRecentCrossing) return true;

                    const signalTime = r.crossingTimes && r.crossingTimes.length > 0 ? Math.max(...r.crossingTimes) : 0;
                    const id = `${item.symbol}-${r.tf}-${r.direction}-${signalTime}`;
                    if (capturedSignalsRef.current.has(id)) return true;
                    
                    return false;
                });
                if (validSignals.length === 0) return null;
                return {
                    ...item,
                    groupedResults: validSignals,
                    direction: validSignals[0].direction,
                    tf: validSignals[0].tf,
                    lag: validSignals[0].lag
                };
            }).filter((item): item is ScannerItem => item !== null);
        } else {
            const maxLag = cfg.maxLag;
            items = items.map((item): ScannerItem | null => {
                if (!item.groupedResults) return null;
                const validSignals = item.groupedResults.filter(r => r.lag! <= maxLag);
                if (validSignals.length === 0) return null;
                return { ...item, groupedResults: validSignals };
            }).filter((item): item is ScannerItem => item !== null);
        }
        
        // Update cacheRef with filtered items
        cacheRef.current = new Map(items.map(item => [item.symbol, item]));

        // --- 2. SORTING LOGIC ---
        items.sort((a, b) => {
            if (sortMode === 'MOST') {
                const countA = a.groupedResults?.length || 0;
                const countB = b.groupedResults?.length || 0;
                if (countA !== countB) return countB - countA;
            }
            const getMinLag = (item: ScannerItem) => {
                if (!item.groupedResults || item.groupedResults.length === 0) return 999;
                return Math.min(...item.groupedResults.map(r => {
                    if (r.crossingLags && r.crossingLags.length > 0) {
                        return Math.min(...r.crossingLags);
                    }
                    return r.lag || 999;
                }));
            };
            return getMinLag(a) - getMinLag(b);
        });

        setList2(items);

        const counts: Record<string, number> = {};
        items.forEach(item => {
            item.groupedResults?.forEach(r => {
                if (r.tf) counts[r.tf] = (counts[r.tf] || 0) + 1;
            });
        });
        setTfCounts(counts);
        
        // Persist to localStorage
        try {
            const cacheArray = Array.from(cacheRef.current.entries()).map(([key, value]) => ({ key, value }));
            localStorage.setItem('SCANNER_LIST2_CACHE_MAP', JSON.stringify(cacheArray));
            
            // Clean up captured signals that are no longer relevant to prevent memory leak
            const activeSymbols = new Set(Array.from(cacheRef.current.values()).map(item => item.symbol));
            const activeSignals = Array.from(capturedSignalsRef.current).filter(id => {
                const symbol = id.split('-')[0];
                return activeSymbols.has(symbol);
            });
            capturedSignalsRef.current = new Set(activeSignals);
            
            localStorage.setItem('SCANNER_LIST2_CAPTURED_SIGNALS', JSON.stringify(activeSignals));
        } catch (e) {
            console.warn("Failed to persist List 2 cache", e);
        }
        
        pendingUpdateRef.current = false;
        lastUpdateTimestampRef.current = now;
    }, []);

    // Sync Ref
    useEffect(() => { configRef.current = config; }, [config]);
    useEffect(() => { candidatesRef.current = candidates; }, [candidates]);
    useEffect(() => { performUpdate(); }, [config, candidates, performUpdate]);

    // --- THROTTLE SCHEDULER ---
    const scheduleUpdate = useCallback(() => {
        const now = Date.now();
        const timeSinceLast = now - lastUpdateTimestampRef.current;
        const throttleMs = 2000; // Update UI at most every 2 seconds

        if (timeSinceLast > throttleMs) {
            performUpdate();
        } else {
            if (!pendingUpdateRef.current) {
                pendingUpdateRef.current = true;
                setTimeout(() => {
                    performUpdate();
                }, throttleMs - timeSinceLast);
            }
        }
    }, [performUpdate]);

    // --- EFFECT: Trigger update immediately when config changes ---
    useEffect(() => {
        performUpdate();
    }, [config, performUpdate]);

    // --- CLEANUP CACHE & UPDATE PRICES ---
    useEffect(() => {
        const currentCandidates = candidatesRef.current;
        const validSymbols = new Set(currentCandidates.map(c => c.symbol));
        let changed = false;
        for (const [key, item] of cacheRef.current.entries()) {
            const symbol = key.split('-')[0];
            // Remove if not in candidates
            if (!validSymbols.has(symbol)) {
                cacheRef.current.delete(key);
                changed = true;
            }
        }
        // Always schedule update to reflect latest prices from candidates
        scheduleUpdate();
    }, [candidates, scheduleUpdate]);

    // --- CORE: Scan Logic ---
    const runScan = async (targetTfs: string[]) => {
        const currentCandidates = candidatesRef.current;
        if (currentCandidates.length === 0) return;
        if (isScanningRef.current) return;

        isScanningRef.current = true;
        setStatus('SCANNING');
        
        // Sort TFs from largest to smallest (e.g., 4h, 1h, 15m)
        const sortedTfs = [...targetTfs].sort((a, b) => getTfMinutes(b) - getTfMinutes(a));
        
        setActiveScanTfs(new Set(sortedTfs));
        setScanText(`扫描周期 [${sortedTfs.join(', ')}]...`);
        
        onLog?.('INFO', `[列表2] 触发扫描，目标周期: ${sortedTfs.join(', ')}，待扫描币种数: ${currentCandidates.length}`);

        try {
            for (let i = 0; i < sortedTfs.length; i++) {
                const tf = sortedTfs[i];
                setScanText(`扫描周期 [${tf}]...`);
                onLog?.('INFO', `[列表2] 开始扫描 ${tf} 周期...`);
                
                const queue = [...currentCandidates];
                const batchSize = 40; // User requested 40 items per batch
                let processedCount = 0;

                while (queue.length > 0) {
                    const batch = queue.splice(0, batchSize);
                    onLog?.('INFO', `[列表2] ${tf} 周期: 正在扫描第 ${processedCount + 1} 到 ${processedCount + batch.length} 个币种...`);
                    
                    const concurrencyLimit = 3;
                    for (let c = 0; c < batch.length; c += concurrencyLimit) {
                        const chunk = batch.slice(c, c + concurrencyLimit);
                        await Promise.all(chunk.map(async (item) => {
                            try {
                                const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${item.symbol}&interval=${tf}&limit=150&_t=${Date.now()}`;
                                const res = await fetchWithFallback(url, {cache: 'no-store'}, (d) => Array.isArray(d), directMode);
                                
                                if (res.ok) {
                                    const klines = await res.json();
                                    const closes = klines.map((k: any) => parseFloat(k[4]) || 0);
                                    const highs = klines.map((k: any) => parseFloat(k[2]) || 0);
                                    const lows = klines.map((k: any) => parseFloat(k[3]) || 0);
                                    const opens = klines.map((k: any) => parseFloat(k[1]) || 0);
                                    const volumes = klines.map((k: any) => parseFloat(k[5]) || 0);
                                    const timestamps: number[] = klines.map((k: any) => Number(k[0]));

                                    const cfg = configRef.current;
                                    const scanDepth = Math.max(cfg.maxLag, cfg.newModeRetention || 9);

                                    const results = analyzeList2Crossing(
                                        item.symbol, tf, closes, highs, lows, opens, volumes, timestamps, 
                                        { ...cfg, triggerMode: 'ALL', maxLag: scanDepth }
                                    );
                                    
                                    if (results.length > 0) {
                                        console.log(`[List2] Found ${results.length} signals for ${item.symbol} ${tf}`);
                                    }
                                    
                                    results.forEach(res => {
                                        const hasRecentCrossing = res.crossingLags && res.crossingLags.some(l => l <= 1);
                                        if (hasRecentCrossing) {
                                            const signalTime = res.crossingTimes ? Math.max(...res.crossingTimes) : timestamps[timestamps.length-1];
                                            const id = `${item.symbol}-${tf}-${res.direction}-${signalTime}`;
                                            if (!capturedSignalsRef.current.has(id)) {
                                                capturedSignalsRef.current.add(id);
                                                console.log(`[List2] New signal detected: ${item.symbol} ${tf} ${res.direction}`);
                                                onLog?.('SUCCESS', `[列表2] 发现新信号: ${item.symbol} ${tf} ${res.direction === 'LONG' ? '做多' : '做空'}`);
                                            }
                                        }
                                    });

                                    const cacheKey = `${item.symbol}-FULL`;
                                    const existing = cacheRef.current.get(cacheKey);
                                    const merged = existing ? [...(existing.groupedResults || [])] : [];
                                    const cleanMerged = merged.filter(r => r.tf !== tf);
                                    cleanMerged.push(...results);
                                    
                                    if (cleanMerged.length > 0) {
                                        cleanMerged.sort((a, b) => (a.lag || 0) - (b.lag || 0));
                                        cacheRef.current.set(cacheKey, { 
                                            ...item, 
                                            groupedResults: cleanMerged, 
                                            direction: cleanMerged[0].direction, 
                                            tf: cleanMerged[0].tf, 
                                            price: item.price,
                                            lastUpdated: Date.now()
                                        });
                                    } else {
                                        cacheRef.current.delete(cacheKey);
                                    }
                                }
                            } catch (e: any) {
                                console.warn(`[GrandCrossing] Failed to fetch ${item.symbol} ${tf}:`, e.message);
                                onLog?.('WARNING', `[列表2] 获取 ${item.symbol} ${tf} 数据失败: ${e.message}`);
                            }
                        }));
                    }
                    
                    processedCount += batch.length;
                    scheduleUpdate();
                    
                    if (queue.length > 0) {
                        await delay(2000); // 每一批次扫描结束间隔2秒
                    }
                }
                
                onLog?.('SUCCESS', `[列表2] ${tf} 周期扫描完成，共处理 ${processedCount} 个币种`);
                
                setActiveScanTfs(prev => {
                    const next = new Set(prev);
                    next.delete(tf);
                    return next;
                });
                
                if (i < sortedTfs.length - 1) {
                    onLog?.('INFO', `[列表2] 等待 5 秒后开始扫描下一个周期...`);
                    await delay(5000); // 每个周期完成后，间隔5秒，再扫描次大的周期
                }
            }
            onLog?.('SUCCESS', `[列表2] 本次所有目标周期扫描完毕`);
        } catch (e: any) {
            onLog?.('DANGER', `[列表2] 扫描过程发生异常: ${e.message}`);
        } finally {
            performUpdate();
            isScanningRef.current = false;
            setActiveScanTfs(new Set());
            setStatus('IDLE');
            setScanText('监控中...');
            setLastScanTime(Date.now());
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
                if (tfMinutes === 0) return;
                const intervalMs = tfMinutes * 60 * 1000;
                
                // Calculate next close for UI countdown
                const nextClose = Math.ceil(now / intervalMs) * intervalMs;
                const diff = nextClose - now;

                if (diff > 0) {
                    const m = Math.floor(diff / 60000).toString().padStart(2, '0');
                    const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
                    newCountdowns[tf] = `${m}:${s}`;
                } else {
                    newCountdowns[tf] = "SCAN";
                }

                // Calculate current candle start time
                const currentCandleStart = Math.floor(now / intervalMs) * intervalMs;
                const lastScan = tfLastScanRef.current[tf] || 0;
                
                // Only trigger if we haven't scanned since this candle started
                if (lastScan < currentCandleStart) {
                    triggeredTimeframes.push(tf);
                }
            });

            setCountdowns(newCountdowns);

            if (triggeredTimeframes.length > 0 && candidatesRef.current.length > 0 && !isScanningRef.current) {
                // Update last scan time immediately so we don't re-trigger
                triggeredTimeframes.forEach(tf => {
                    tfLastScanRef.current[tf] = now;
                });
                
                onLog?.('INFO', `[列表2] 检测到K线收盘，触发扫描周期: ${triggeredTimeframes.join(', ')}`);
                
                // SAFETY FIX: Added catch block to prevent unhandled rejections
                runScan(triggeredTimeframes).catch(err => {
                    console.warn("[GrandCrossing] Background scan error (safely caught):", err);
                    onLog?.('DANGER', `[列表2] 后台扫描任务发生异常: ${err.message || err}`);
                    isScanningRef.current = false;
                });
            }

        }, 1000);

        return () => clearInterval(timer);
    }, []);

    return {
        config,
        setConfig,
        list2,
        status,
        scanText,
        countdowns,
        tfCounts,
        activeScanTfs,
        lastScanTime
    };
};
