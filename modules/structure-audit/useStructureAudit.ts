
import { useState, useRef, useEffect, useCallback } from 'react';
import { usePersistedState } from '../../hooks/usePersistedState';
import { ScannerItem, List3Config, List3SignalResult, StructureScanStatus } from '../../components/Scanner/scannerTypes';
import { analyzeList3Structure } from '../../services/rules/list3_structure';
import { fetchWithFallback } from '../../services/apiService';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const getTfMinutes = (tf: string) => {
    const unit = tf.slice(-1);
    const val = parseInt(tf);
    if (unit === 'm') return val;
    if (unit === 'h') return val * 60;
    if (unit === 'd') return val * 1440;
    return 0;
};

export const useStructureAudit = (
    candidates: ScannerItem[], // Input from List 2
    initialConfig: List3Config,
    realPrices: Record<string, number>,
    directMode: boolean = false
) => {
    // --- STATE ---
    const [config, setConfig] = usePersistedState<List3Config>('SCANNER_LIST3_CONFIG', initialConfig);
    const [list3, setList3] = useState<ScannerItem[]>(() => {
        try {
            const saved = localStorage.getItem('SCANNER_LIST3_CACHE_MAP');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                    const allItems = parsed.map((item: any) => item.value);
                    allItems.sort((a: any, b: any) => (b.list3Results?.length || 0) - (a.list3Results?.length || 0));
                    return allItems;
                }
            }
        } catch(e) {}
        return [];
    });
    const [isScanning, setIsScanning] = useState(false);
    const [scanStatus, setScanStatus] = useState<StructureScanStatus | null>(null);
    const [countdowns, setCountdowns] = useState<Record<string, string>>({});

    // --- REFS ---
    const cacheRef = useRef<Map<string, ScannerItem>>(new Map(
        (() => {
            try {
                const saved = localStorage.getItem('SCANNER_LIST3_CACHE_MAP');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    return Array.isArray(parsed) ? parsed.map((item: any) => [item.key, item.value]) : [];
                }
            } catch(e) {}
            return [];
        })()
    ));
    const configRef = useRef(config);
    const candidatesRef = useRef(candidates);
    const isScanningRef = useRef(false);
    const lastCandleScanRef = useRef<Map<string, number>>(new Map());
    const expiredSignalCacheRef = useRef<Set<string>>(new Set()); // Track permanently removed signals
    const structureHashRef = useRef<Map<string, string>>(new Map(
        (() => {
            try {
                const saved = localStorage.getItem('SCANNER_LIST3_CACHE_MAP');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    return Array.isArray(parsed) ? parsed.map((item: any) => {
                        const hash = item.value.groupedResults ? item.value.groupedResults.map((r: any) => `${r.tf}:${r.direction}:${r.crossingCount}`).join('|') : "";
                        return [item.key, hash];
                    }) : [];
                }
            } catch(e) {}
            return [];
        })()
    ));
    
    // PERFORMANCE FIX: Use Ref for prices to prevent re-creating runAnalysisInternal on every tick
    const realPricesRef = useRef(realPrices);

    useEffect(() => { configRef.current = config; }, [config]);
    useEffect(() => { candidatesRef.current = candidates; }, [candidates]);
    useEffect(() => { realPricesRef.current = realPrices; }, [realPrices]);

    const getStructureHash = (item: ScannerItem) => {
        if (!item.groupedResults) return "";
        return item.groupedResults.map(r => `${r.tf}:${r.direction}:${r.crossingCount}`).join('|');
    };

    // --- EFFECT: UI Countdowns ---
    useEffect(() => {
        const ALL_TFS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h'];
        const timer = setInterval(() => {
            const now = Date.now();
            const newCounts: Record<string, string> = {};
            ALL_TFS.forEach(tf => {
                const tfMinutes = getTfMinutes(tf);
                if (tfMinutes > 0) {
                    const intervalMs = tfMinutes * 60 * 1000;
                    const nextClose = Math.ceil(now / intervalMs) * intervalMs;
                    const diff = nextClose - now;
                    newCounts[tf] = diff > 0 
                        ? `${Math.floor(diff / 60000).toString().padStart(2, '0')}:${Math.floor((diff % 60000) / 1000).toString().padStart(2, '0')}`
                        : "00:00";
                }
            });
            setCountdowns(newCounts);
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    const updateList3FromCache = useCallback(() => {
        const allItems: ScannerItem[] = Array.from(cacheRef.current.values());
        allItems.sort((a, b) => (b.list3Results?.length || 0) - (a.list3Results?.length || 0));
        setList3(allItems);
        
        // Persist to localStorage
        try {
            const cacheArray = Array.from(cacheRef.current.entries()).map(([key, value]) => ({ key, value }));
            localStorage.setItem('SCANNER_LIST3_CACHE_MAP', JSON.stringify(cacheArray));
        } catch (e) {
            console.warn("Failed to persist List 3 cache", e);
        }
    }, []);

    // --- CORE LOGIC: Analysis ---
    // PERFORMANCE CRITICAL: realPrices removed from dependency array
    const runAnalysisInternal = useCallback(async (itemsToScan: ScannerItem[], triggerReason: string) => {
        if (isScanningRef.current || itemsToScan.length === 0) return;
        
        isScanningRef.current = true;
        setIsScanning(true);

        setScanStatus({ 
            symbols: itemsToScan.map(i => i.symbol), 
            tfs: configRef.current.timeframes, 
            current: 0, 
            total: itemsToScan.length,
            currentAction: triggerReason 
        });

        try {
            let hasChanges = false;
            const batchSize = 5; 

            for (let i = 0; i < itemsToScan.length; i += batchSize) {
                if (candidatesRef.current.length === 0) break;

                const batch = itemsToScan.slice(i, i + batchSize);
                
                const concurrencyLimit = 3;
                for (let c = 0; c < batch.length; c += concurrencyLimit) {
                    const chunk = batch.slice(c, c + concurrencyLimit);
                    await Promise.all(chunk.map(async (item) => {
                        if (!item.groupedResults) return;
                        
                        const neededTFs = new Set<string>();
                        item.groupedResults.forEach(r => { 
                            if (configRef.current.timeframes.includes(r.tf)) neededTFs.add(r.tf); 
                        });
                        
                        if (neededTFs.size === 0) return;

                        // USE REF HERE
                        const livePrice = realPricesRef.current[item.symbol] || item.price;

                        for (const tf of Array.from(neededTFs)) {
                            // Update scan time immediately to prevent infinite retries on failure
                            lastCandleScanRef.current.set(`${item.symbol}-${tf}`, Date.now());
                            try {
                                const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${item.symbol}&interval=${tf}&limit=500&_t=${Date.now()}`;
                                const res = await fetchWithFallback(url, {cache: 'no-store'}, (d) => Array.isArray(d), directMode);
                                
                                if (res.ok) {
                                    const klines = await res.json();
                                    const closes = klines.map((k: any) => parseFloat(k[4]) || 0);
                                    const highs = klines.map((k: any) => parseFloat(k[2]) || 0);
                                    const lows = klines.map((k: any) => parseFloat(k[3]) || 0);
                                    const opens = klines.map((k: any) => parseFloat(k[1]) || 0);
                                    const volumes = klines.map((k: any) => parseFloat(k[5]) || 0);
                                    
                                    let periodChange = 0;
                                    if (closes.length > 0) periodChange = ((closes[closes.length-1] - closes[0]) / closes[0]) * 100;

                                    const resultsForTf = item.groupedResults!.filter(r => r.tf === tf).sort((a, b) => (b.lag || 0) - (a.lag || 0));
                                    
                                    for (const gr of resultsForTf) {
                                        const uniqueId = `${item.symbol}-${tf}-${gr.direction}`;
                                        if (expiredSignalCacheRef.current.has(uniqueId)) {
                                            continue; // Skip permanently removed signals
                                        }

                                        const latestTime = gr.crossingTimes ? Math.max(...gr.crossingTimes) : Number(klines[klines.length-1][0]);
                                        
                                        const result3 = analyzeList3Structure(
                                            { symbol: item.symbol, tf, direction: gr.direction!, time: latestTime, price: livePrice, periodChange },
                                            closes, highs, lows, opens, volumes, configRef.current, klines
                                        );

                                        if (result3) {
                                            let cached: ScannerItem = cacheRef.current.get(item.symbol) || { ...item, list3Results: [] };
                                            if (!cached.list3Results) cached.list3Results = [];
                                            
                                            const entry: List3SignalResult = { 
                                                tf: result3.tf!, 
                                                direction: result3.direction! as any, 
                                                structure: result3.structure! 
                                            };
                                            
                                            // Evaluate if it passes current config
                                            const s = entry.structure;
                                            const cfg = configRef.current;
                                            let passes = true;
                                            if (cfg.strictTrend && !s.isStrictTrend) passes = false;
                                            if (cfg.checkCandleColor && !s.isColorValid) passes = false;
                                            if (cfg.enableThrust && !s.thrustValid) passes = false;
                                            if (cfg.enableResonance) {
                                                if (s.locationPct > cfg.maxLocation) passes = false;
                                                if (s.crossCount < cfg.minCrossCount) passes = false;
                                                if (s.bbw > cfg.maxBBW) passes = false;
                                            }
                                            if (cfg.enableRsi !== false) {
                                                if (entry.direction === 'LONG') {
                                                    if (s.rsi < cfg.rsiLongMin || s.rsi > cfg.rsiLongMax) passes = false;
                                                } else {
                                                    if (s.rsi < cfg.rsiShortMin || s.rsi > cfg.rsiShortMax) passes = false;
                                                }
                                            }
                                            if (cfg.timeframes && cfg.timeframes.length > 0 && !cfg.timeframes.includes(entry.tf)) passes = false;
                                            if (cfg.antiChase?.enabled && s.periodChange !== undefined) {
                                                if (entry.direction === 'LONG') {
                                                    if (s.periodChange > cfg.antiChase.maxRise) passes = false;
                                                } else {
                                                    if (s.periodChange < -cfg.antiChase.maxFall) passes = false;
                                                }
                                            }

                                            const idx = cached.list3Results.findIndex(r => r.tf === entry.tf && r.direction === entry.direction);
                                            if (idx >= 0) {
                                                // If it was already latched, KEEP it latched. Otherwise, latch if it passes now.
                                                entry.latched = cached.list3Results[idx].latched || passes;
                                                cached.list3Results[idx] = entry; 
                                            } else {
                                                entry.latched = passes;
                                                cached.list3Results.push(entry);
                                            }
                                            
                                            cached.price = livePrice;
                                            cacheRef.current.set(item.symbol, cached);
                                            hasChanges = true;
                                        }
                                    }
                                }
                            } catch (e) { /* ignore */ }
                        }
                        structureHashRef.current.set(item.symbol, getStructureHash(item));
                    }));
                }

                if (i % 20 === 0 || i + batchSize >= itemsToScan.length) {
                    setScanStatus(p => p ? ({ 
                        ...p, 
                        current: Math.min(p.total, i + batchSize),
                        currentAction: "深度结构审计中..."
                    }) : null);
                }
                
                if (hasChanges && i % 20 === 0) updateList3FromCache();
                
                // Binance limit is 2400 weight per minute (40/sec).
                // A batch of 5 items * 4 TFs = 20 requests. We need to wait at least 2000ms.
                await delay(2000);
            }
            
            if (hasChanges) updateList3FromCache();

        } finally {
            isScanningRef.current = false;
            setIsScanning(false);
            setScanStatus(null);
        }
    }, [updateList3FromCache]); // Removed realPrices from here

    // --- TRIGGERS ---
    useEffect(() => {
        // Sync Cache Removal
        const validSymbols = new Set(candidates.map(c => c.symbol));
        let cleaned = false;
        for (const key of cacheRef.current.keys()) {
            if (!validSymbols.has(key)) {
                cacheRef.current.delete(key);
                structureHashRef.current.delete(key);
                cleaned = true;
            }
        }

        // Identify New/Changed Candidates
        const itemsToScan: ScannerItem[] = [];
        candidates.forEach(c => {
            const currentHash = getStructureHash(c);
            const lastHash = structureHashRef.current.get(c.symbol);
            
            // If the item is in candidates but NOT in cache, we should add it to cache
            // BUT we should preserve its list3Results if it already has them from localStorage
            if (!cacheRef.current.has(c.symbol)) {
                // Check if it has list3Results from a previous session
                if (c.list3Results && c.list3Results.length > 0) {
                    cacheRef.current.set(c.symbol, c);
                    structureHashRef.current.set(c.symbol, currentHash);
                    cleaned = true; // Trigger update
                } else {
                    itemsToScan.push(c);
                }
            } else if (currentHash !== lastHash) {
                itemsToScan.push(c);
            }
        });

        if (itemsToScan.length > 0) {
            runAnalysisInternal(itemsToScan, `增量分析 (${itemsToScan.length})`);
        } else if (cleaned) {
            updateList3FromCache();
        }
    }, [candidates, runAnalysisInternal, updateList3FromCache]); 

    useEffect(() => {
        const checkTimer = setInterval(() => {
            if (isScanningRef.current || candidatesRef.current.length === 0) return;
            const now = Date.now();
            const reScanCandidates: ScannerItem[] = [];

            candidatesRef.current.forEach(c => {
                let needsUpdate = false;
                c.groupedResults?.forEach(r => {
                    const tf = r.tf;
                    const intervalMs = getTfMinutes(tf) * 60000;
                    if (intervalMs === 0) return;
                    const currentCandleStart = Math.floor(now / intervalMs) * intervalMs;
                    const key = `${c.symbol}-${tf}`;
                    const lastScan = lastCandleScanRef.current.get(key) || 0;
                    if (lastScan < currentCandleStart) needsUpdate = true;
                });
                if (needsUpdate) reScanCandidates.push(c);
            });

            if (reScanCandidates.length > 0) {
                runAnalysisInternal(reScanCandidates, "周期收盘复核");
            }
        }, 2000); 
        return () => clearInterval(checkTimer);
    }, [runAnalysisInternal]);

    // --- REMOVE SIGNAL ---
    // Called by List 4 when a signal is permanently invalidated or traded
    const removeSignal = useCallback((uniqueId: string) => {
        // uniqueId format: "SYMBOL-TF-DIRECTION"
        const parts = uniqueId.split('-');
        if (parts.length < 3) return;
        
        // Add to expired cache so it doesn't get re-added on next scan
        expiredSignalCacheRef.current.add(uniqueId);

        const symbol = parts[0];
        const tf = parts[1];
        const direction = parts[2];

        const cached = cacheRef.current.get(symbol);
        if (cached && cached.list3Results) {
            // Filter out the specific signal
            cached.list3Results = cached.list3Results.filter(
                r => !(r.tf === tf && r.direction === direction)
            );

            // If no signals left for this symbol, remove it entirely
            if (cached.list3Results.length === 0) {
                cacheRef.current.delete(symbol);
            } else {
                cacheRef.current.set(symbol, cached);
            }

            // Update UI
            updateList3FromCache();
        }
    }, [updateList3FromCache]);

    return { config, setConfig, list3, isScanning, scanStatus, countdowns, removeSignal };
};
