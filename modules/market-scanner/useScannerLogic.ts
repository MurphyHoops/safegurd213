
import { useState, useRef, useEffect, useCallback } from 'react';
import { ScanConfig, ScannerItem } from '../../components/Scanner/scannerTypes';
import { processMarketData } from '../../services/rules/list1_market';
import { fetchWithFallback } from '../../services/apiService';
import { audioService } from '../../services/audioService';

export const useScannerLogic = (
    initialConfig: ScanConfig, 
    customSymbolSet: Set<string>,
    fixedModeView: 'MONITOR' | 'SEARCH',
    directMode: boolean = false
) => {
    // --- ATOMIC STATE ---
    const [list1, setList1] = useState<ScannerItem[]>(() => {
        try {
            const saved = localStorage.getItem('SCANNER_LIST1_CACHE');
            const parsed = saved ? JSON.parse(saved) : [];
            const initialList = Array.isArray(parsed) ? parsed : [];
            
            // Apply initial blacklist filtering
            const savedBlacklist = localStorage.getItem('SCANNER_BLACKLIST');
            if (savedBlacklist) {
                const bl = new Set(JSON.parse(savedBlacklist));
                return initialList.filter(item => item && item.symbol && !bl.has(item.symbol));
            }
            return initialList;
        } catch (e) {
            return [];
        }
    });

    const [blacklist, setBlacklist] = useState<Set<string>>(() => {
        try {
            const saved = localStorage.getItem('SCANNER_BLACKLIST');
            if (saved) {
                const parsed = JSON.parse(saved);
                return new Set(Array.isArray(parsed) ? parsed : []);
            }
            return new Set();
        } catch (e) {
            return new Set();
        }
    });
    
    // Persist List 1
    useEffect(() => {
        try {
            localStorage.setItem('SCANNER_LIST1_CACHE', JSON.stringify(list1));
        } catch (e) {
            console.warn("Failed to persist List 1 cache");
        }
    }, [list1]);

    // Persist Blacklist
    useEffect(() => {
        try {
            localStorage.setItem('SCANNER_BLACKLIST', JSON.stringify(Array.from(blacklist)));
        } catch (e) {
            console.warn("Failed to persist Blacklist");
        }
    }, [blacklist]);

    const [isScanning, setIsScanning] = useState(false);
    const [scanStatusText, setScanStatusText] = useState('系统就绪');
    const [marketStats, setMarketStats] = useState({ up: 0, down: 0, total: 0, btcChange: 0 });
    const [nextScanTime, setNextScanTime] = useState<number>(0);
    
    // --- REFS (For logic continuity) ---
    const scanSessionIdRef = useRef<number>(0);
    const list1Ref = useRef<ScannerItem[]>([]);
    
    // Initialize list1Ref from the same initial state as list1
    useEffect(() => {
        list1Ref.current = list1;
    }, []);

    const rawDataRef = useRef<any[]>([]); // Store raw data for instant re-filtering
    const configRef = useRef(initialConfig);
    const customSymbolSetRef = useRef(customSymbolSet);
    const fixedModeViewRef = useRef(fixedModeView);
    const refreshRef = useRef<any>(null); // For self-referencing retry
    const retryTimeoutRef = useRef<any>(null); // To prevent multiple retries
    const retryCountRef = useRef<number>(0); // Track retry attempts
    const wasForceFullRef = useRef(false);
    
    // STRICT CONCURRENCY LOCK (The OOM Killer Fix)
    const isFetchingRef = useRef(false);
    const lastFetchStartTimeRef = useRef<number>(0);
    const isMountedRef = useRef(true);

    // Watchdog effect to prevent scanner from sleeping
    useEffect(() => {
        const interval = setInterval(() => {
            if (isFetchingRef.current && Date.now() - lastFetchStartTimeRef.current > 60000) {
                console.warn("[Scanner] Watchdog: Scan stuck for >60s, resetting lock.");
                isFetchingRef.current = false;
                setIsScanning(false);
            }
        }, 10000);
        return () => clearInterval(interval);
    }, []);

    // Initialize rawDataRef from cache on mount
    useEffect(() => {
        try {
            const savedRaw = localStorage.getItem('SCANNER_RAW_DATA_CACHE');
            if (savedRaw) {
                const parsed = JSON.parse(savedRaw);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    rawDataRef.current = parsed;
                }
            }
        } catch (e) {
            console.warn("Failed to load raw data cache");
        }
    }, []);

    useEffect(() => {
        configRef.current = initialConfig;
        customSymbolSetRef.current = customSymbolSet;
        fixedModeViewRef.current = fixedModeView;
    }, [initialConfig, customSymbolSet, fixedModeView]);

    useEffect(() => {
        isMountedRef.current = true;
        return () => { 
            isMountedRef.current = false; 
            if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
        };
    }, []);

    // --- EFFECT: Re-filter instantly when config changes or blacklist changes ---
    useEffect(() => {
        try {
            if (rawDataRef.current && Array.isArray(rawDataRef.current) && rawDataRef.current.length > 0) {
                const { list1: filtered, stats } = processMarketData(rawDataRef.current, initialConfig, customSymbolSet, fixedModeView);
                
                // Filter out blacklisted symbols
                const nonBlacklisted = filtered.filter(item => item && item.symbol && !blacklist.has(item.symbol));

                // Compare with previous list to find new items
                const currentList = Array.isArray(list1Ref.current) ? list1Ref.current : [];
                const prevSymbols = new Set(currentList.map(i => i?.symbol).filter(Boolean));
                
                const finalFiltered = nonBlacklisted.map(item => ({
                    ...item,
                    isNew: !prevSymbols.has(item.symbol) && currentList.length > 0
                }));
                
                setMarketStats(stats);
                setList1(finalFiltered);
                list1Ref.current = finalFiltered;
                
                // Update status text to reflect new count if not currently scanning
                setScanStatusText(prev => {
                    if (prev.includes('行情就绪') || prev.includes('无符合条件')) {
                        return finalFiltered.length > 0 ? `行情就绪 (${finalFiltered.length}个)` : "无符合条件的币种";
                    }
                    return prev;
                });
            } else if (list1 && Array.isArray(list1) && list1.length > 0) {
                // Fallback: If raw data is missing, we still want to apply the volume/change filters to the current list
                // We can't use processMarketData directly because it expects raw Binance data, 
                // but we can manually apply the filters from initialConfig to the existing list1 items.
                
                const filtered = list1.filter(item => {
                    if (!item || !item.symbol) return false;
                    if (blacklist.has(item.symbol)) return false;
                    
                    // Apply volume filter
                    const vol = item.volume24h || 0;
                    if (vol < initialConfig.minVolume) return false;
                    if (initialConfig.maxVolume > 0 && vol > initialConfig.maxVolume) return false;
                    
                    // Apply change filter
                    const chg = item.change || 0;
                    if (Math.abs(chg) < initialConfig.minChange) return false;
                    
                    // Apply source filter
                    if (initialConfig.source === 'GAINERS' && chg <= 0) return false;
                    if (initialConfig.source === 'LOSERS' && chg >= 0) return false;
                    
                    return true;
                });

                if (filtered.length !== list1.length) {
                    setList1(filtered);
                    list1Ref.current = filtered;
                    
                    setScanStatusText(prev => {
                        if (prev.includes('行情就绪') || prev.includes('无符合条件')) {
                            return filtered.length > 0 ? `行情就绪 (${filtered.length}个)` : "无符合条件的币种";
                        }
                        return prev;
                    });
                }
            }
        } catch (err) {
            console.error("[Scanner] Instant re-filter failed:", err);
        }
    }, [initialConfig, customSymbolSet, fixedModeView, blacklist]);

    // --- CORE ACTION: Fetch & Process ---
    const refreshList1Candidates = useCallback(async (currentConfig: ScanConfig, forceFull = false) => {
        // Clear any pending retries
        if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current);
            retryTimeoutRef.current = null;
        }

        // STRICT LOCK: If already fetching, abort immediately.
        if (isFetchingRef.current) {
            console.log("[Scanner] Skipped scan tick: Previous scan still pending.");
            return;
        }

        if (forceFull) {
            wasForceFullRef.current = true;
            setIsScanning(true);
            setScanStatusText("正在更新候选池...");
        }

        let sessionId = Date.now();
        scanSessionIdRef.current = sessionId;
        
        isFetchingRef.current = true; // ACQUIRE LOCK
        lastFetchStartTimeRef.current = Date.now(); // SET WATCHDOG START TIME

        try {
            const baseUrl = 'https://fapi.binance.com/fapi/v1/ticker';
            
            const t = Date.now();
            // Construct Endpoint
            // Note: Binance Futures (fapi) does not have a /tradingDay endpoint.
            // Both modes will use /24hr, but they act as independent filter profiles.
            const endpoint = `${baseUrl}/24hr?_t=${t}`;
            
            // Validator checks for array
            const res = await fetchWithFallback(
                endpoint, 
                { cache: 'no-store', timeout: 45000 }, // Changed from 18000000 to 45s to prevent infinite hangs
                (d) => Array.isArray(d) && d.length > 0, 
                directMode
            );
            
            if (!isMountedRef.current) return; // Component unmounted, abort

            if (res.ok) {
                const data = await res.json();
                
                // Concurrency check (logic level)
                if (scanSessionIdRef.current !== sessionId) return;
                
                // Save raw data for instant re-filtering
                rawDataRef.current = data;
                try {
                    localStorage.setItem('SCANNER_RAW_DATA_CACHE', JSON.stringify(data));
                } catch (e) {
                    console.warn("Failed to persist raw data cache");
                }
                
                // Reset retry counter on success
                retryCountRef.current = 0;
                
                // Logic Processing
                const { list1: filtered, stats } = processMarketData(data, configRef.current, customSymbolSetRef.current, fixedModeViewRef.current);
                
                // Filter out blacklisted symbols
                const nonBlacklisted = filtered.filter(item => !blacklist.has(item.symbol));

                // Compare with previous list to find new items
                const prevSymbols = new Set(list1Ref.current.map(i => i.symbol));
                const finalFiltered = nonBlacklisted.map(item => ({
                    ...item,
                    isNew: !prevSymbols.has(item.symbol) && list1Ref.current.length > 0
                }));
                
                setMarketStats(stats);
                setList1(finalFiltered);
                list1Ref.current = finalFiltered;
                
                if (wasForceFullRef.current) {
                    setScanStatusText(filtered.length > 0 ? `行情就绪 (${filtered.length}个)` : "无符合条件的币种");
                    setIsScanning(false);
                    wasForceFullRef.current = false;
                } else {
                    // Even if it's a background scan, we should update the status text if it was previously stuck
                    setScanStatusText(filtered.length > 0 ? `行情就绪 (${filtered.length}个)` : "无符合条件的币种");
                    setIsScanning(false);
                }
            } else {
                throw new Error(`HTTP ${res.status}`);
            }
        } catch (e: any) { 
            if (!isMountedRef.current) return; // Component unmounted, abort

            // Safe Error Handling
            const errMsg = e?.message || String(e);
            
            // Only log if it's NOT a common network error (to reduce noise)
            if (!errMsg.includes('Failed to fetch') && !errMsg.includes('NetworkError')) {
                console.error("Scanner Fetch Failed:", errMsg); 
            } else {
                console.warn("Scanner Network Glitch (Retrying...):", errMsg);
            }
            
            if (wasForceFullRef.current && retryCountRef.current < 3) {
                retryCountRef.current += 1;
                // AUTO-RETRY LOGIC (Instead of stopping)
                if (!directMode && (errMsg.includes('Failed to fetch') || errMsg.includes('NetworkError'))) {
                     setScanStatusText(`连接受阻，建议开启[直连模式]... (重试 ${retryCountRef.current}/3)`);
                } else {
                     setScanStatusText(`连接失败，5秒后自动重试... (${retryCountRef.current}/3)`);
                }
                // Do NOT set isScanning(false)
                
                retryTimeoutRef.current = setTimeout(() => {
                    if (refreshRef.current && isMountedRef.current) {
                        console.log(`[Scanner] Retrying scan (${retryCountRef.current}/3)...`);
                        refreshRef.current(configRef.current, true);
                    }
                }, 5000);
            } else {
                // Background scan failed or max retries reached
                setIsScanning(false);
                setScanStatusText("扫描失败，请检查网络或开启直连");
                retryCountRef.current = 0; // Reset for next manual scan
                wasForceFullRef.current = false;
            }
        } finally {
            // ALWAYS RELEASE LOCK
            isFetchingRef.current = false;
        }
    }, [directMode, blacklist]);

    const cancelScan = useCallback(() => {
        if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current);
            retryTimeoutRef.current = null;
        }
        scanSessionIdRef.current = Date.now(); // Invalidate current fetch
        isFetchingRef.current = false;
        setIsScanning(false);
        setScanStatusText("已手动暂停");
        retryCountRef.current = 0;
        wasForceFullRef.current = false;
    }, []);

    const addToBlacklist = useCallback((symbol: string) => {
        setBlacklist(prev => {
            const next = new Set(prev);
            next.add(symbol);
            return next;
        });
    }, []);

    const removeFromBlacklist = useCallback((symbol: string) => {
        setBlacklist(prev => {
            const next = new Set(prev);
            next.delete(symbol);
            return next;
        });
    }, []);

    const clearBlacklist = useCallback(() => {
        setBlacklist(new Set());
    }, []);

    // Update ref on every render so retry always uses latest function
    refreshRef.current = refreshList1Candidates;

    return {
        list1,
        isScanning,
        scanStatusText,
        marketStats,
        nextScanTime,
        setNextScanTime,
        refreshList1Candidates,
        cancelScan,
        addToBlacklist,
        removeFromBlacklist,
        clearBlacklist,
        list1Ref // Exposed for dependent modules (List 2)
    };
};
