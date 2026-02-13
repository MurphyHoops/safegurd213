
import { useState, useRef, useEffect, useCallback } from 'react';
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
    realPrices: Record<string, number>
) => {
    // --- STATE ---
    const [config, setConfig] = useState<List3Config>(initialConfig);
    const [list3, setList3] = useState<ScannerItem[]>([]);
    const [isScanning, setIsScanning] = useState(false);
    const [scanStatus, setScanStatus] = useState<StructureScanStatus | null>(null);
    const [countdowns, setCountdowns] = useState<Record<string, string>>({});

    // --- REFS ---
    const cacheRef = useRef<Map<string, ScannerItem>>(new Map());
    const configRef = useRef(config);
    const candidatesRef = useRef(candidates);
    
    // TRACKING: Concurrency Lock
    const isScanningRef = useRef(false);
    
    // TRACKING: Last scan time for each symbol+tf key
    const lastCandleScanRef = useRef<Map<string, number>>(new Map());

    useEffect(() => { configRef.current = config; }, [config]);
    useEffect(() => { candidatesRef.current = candidates; }, [candidates]);

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
                    if (diff > 0) {
                        const m = Math.floor(diff / 60000).toString().padStart(2, '0');
                        const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
                        newCounts[tf] = `${m}:${s}`;
                    } else {
                        newCounts[tf] = "00:00";
                    }
                }
            });
            setCountdowns(newCounts);
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    // --- CORE LOGIC: Analysis ---
    const runAnalysis = useCallback(async (triggerReason: string) => {
        // Strict Concurrency Check
        if (isScanningRef.current || candidatesRef.current.length === 0) return;
        
        isScanningRef.current = true;
        setIsScanning(true);

        const relevantItems = candidatesRef.current.filter(i => i.groupedResults && i.groupedResults.length > 0);
        
        setScanStatus({ 
            symbols: relevantItems.map(i => i.symbol), 
            tfs: configRef.current.timeframes, 
            current: 0, 
            total: relevantItems.length,
            currentAction: triggerReason 
        });

        try {
            let hasChanges = false;
            const batchSize = 10; 

            for (let i = 0; i < relevantItems.length; i += batchSize) {
                if (candidatesRef.current.length === 0) break;

                const batch = relevantItems.slice(i, i + batchSize);
                
                await Promise.all(batch.map(async (item) => {
                    if (!item.groupedResults) return;
                    
                    const neededTFs = new Set<string>();
                    item.groupedResults.forEach(r => { 
                        if (configRef.current.timeframes.includes(r.tf)) neededTFs.add(r.tf); 
                    });
                    
                    const livePrice = realPrices[item.symbol] || item.price;

                    for (const tf of Array.from(neededTFs)) {
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
                                
                                let periodChange = 0;
                                if (closes.length > 0) periodChange = ((closes[closes.length-1] - closes[0]) / closes[0]) * 100;

                                const resultsForTf = item.groupedResults!.filter(r => r.tf === tf);
                                
                                for (const gr of resultsForTf) {
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
                                        
                                        const idx = cached.list3Results.findIndex(r => r.tf === entry.tf && r.direction === entry.direction);
                                        if (idx >= 0) cached.list3Results[idx] = entry; else cached.list3Results.push(entry);
                                        
                                        cached.price = livePrice;
                                        cacheRef.current.set(item.symbol, cached);
                                        hasChanges = true;
                                        
                                        // Update Candle Scan Tracker
                                        const now = Date.now();
                                        lastCandleScanRef.current.set(`${item.symbol}-${tf}`, now);
                                    }
                                }
                            }
                        } catch (e) {
                            // ignore
                        }
                    }
                }));

                setScanStatus(p => p ? ({ 
                    ...p, 
                    current: Math.min(p.total, i + batchSize),
                    currentAction: i % 2 === 0 ? "审计 K 线形态..." : "计算结构指标..."
                }) : null);
                
                if (hasChanges) updateList3FromCache();
                await delay(50);
            }
        } finally {
            // ALWAYS release lock
            isScanningRef.current = false;
            setIsScanning(false);
            setScanStatus(null);
        }
    }, [realPrices]);

    // --- TRIGGER 1: INSTANT (When Candidates Change) ---
    useEffect(() => {
        if (candidates.length > 0) {
            // Cleanup cache
            const candidateSymbols = new Set(candidates.map(c => c.symbol));
            let cleaned = false;
            for (const key of cacheRef.current.keys()) {
                if (!candidateSymbols.has(key)) {
                    cacheRef.current.delete(key);
                    cleaned = true;
                }
            }
            if (cleaned) updateList3FromCache();

            // Run Analysis Immediately
            runAnalysis("检测到新信号 (Instant Trigger)");
        } else {
            setList3([]);
            cacheRef.current.clear();
        }
    }, [candidates]); 

    // --- TRIGGER 2: PERIODIC (Candle Close Check) ---
    useEffect(() => {
        const checkTimer = setInterval(() => {
            // Use ref check to avoid stacking
            if (isScanningRef.current || candidatesRef.current.length === 0) return;

            const now = Date.now();
            let needScan = false;

            candidatesRef.current.forEach(c => {
                c.groupedResults?.forEach(r => {
                    const tf = r.tf;
                    const intervalMs = getTfMinutes(tf) * 60000;
                    if (intervalMs === 0) return;

                    const currentCandleStart = Math.floor(now / intervalMs) * intervalMs;
                    const key = `${c.symbol}-${tf}`;
                    const lastScan = lastCandleScanRef.current.get(key) || 0;

                    if (lastScan < currentCandleStart) {
                        needScan = true;
                    }
                });
            });

            if (needScan) {
                runAnalysis("周期收盘复核 (Candle Close)");
            }

        }, 1000);

        return () => clearInterval(checkTimer);
    }, [runAnalysis]);

    const updateList3FromCache = () => {
        const allItems: ScannerItem[] = Array.from(cacheRef.current.values());
        allItems.sort((a, b) => (b.list3Results?.length || 0) - (a.list3Results?.length || 0));
        setList3(allItems);
    };

    return {
        config,
        setConfig,
        list3,
        isScanning,
        scanStatus,
        countdowns
    };
};
