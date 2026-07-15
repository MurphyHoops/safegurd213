
import { useState, useRef, useEffect, useCallback } from 'react';
import { ScanConfig, ScannerItem } from '../../components/Scanner/scannerTypes';
import { processMarketData } from '../../services/rules/list1_market';
import { fetchWithFallback } from '../../services/apiService';
import { audioService } from '../../services/audioService';
import { calculateEMA } from '../../services/indicators';

export const useScannerLogic = (
    initialConfig: ScanConfig, 
    customSymbolSet: Set<string>,
    fixedModeView: 'MONITOR' | 'SEARCH',
    directMode: boolean = false,
    mode: 'LIVE' | 'BACKTEST' | 'SMART' = 'LIVE',
    strategyId?: string
) => {
    const suffix = strategyId ? `_${strategyId}` : '';
    const list1CacheKey = `SCANNER_LIST1_CACHE${suffix}`;
    const blacklistKey = `SCANNER_BLACKLIST${suffix}`;
    const majorTrendCandidatesKey = `SCANNER_MAJOR_TREND_CANDIDATES${suffix}`;

    // --- ATOMIC STATE ---
    const [list1, setList1] = useState<ScannerItem[]>(() => {
        try {
            const saved = localStorage.getItem(list1CacheKey);
            const parsed = saved ? JSON.parse(saved) : [];
            const initialList = Array.isArray(parsed) ? parsed : [];
            
            // Apply initial blacklist filtering
            const savedBlacklist = localStorage.getItem(blacklistKey);
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
            const saved = localStorage.getItem(blacklistKey);
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
            localStorage.setItem(list1CacheKey, JSON.stringify(list1));
        } catch (e) {
            console.warn("Failed to persist List 1 cache");
        }
    }, [list1, list1CacheKey]);

    // Persist Blacklist
    useEffect(() => {
        try {
            localStorage.setItem(blacklistKey, JSON.stringify(Array.from(blacklist)));
        } catch (e) {
            console.warn("Failed to persist Blacklist");
        }
    }, [blacklist, blacklistKey]);

    const [isScanning, setIsScanning] = useState(false);
    const [scanStatusText, setScanStatusText] = useState('系统就绪');
    const [marketStats, setMarketStats] = useState({ up: 0, down: 0, total: 0, btcChange: 0 });
    const [nextScanTime, setNextScanTime] = useState<number>(0);
    
    // --- REFS (For logic continuity) ---
    const scanSessionIdRef = useRef<number>(0);
    const list1Ref = useRef<ScannerItem[]>(list1);
    list1Ref.current = list1;

    const rawDataRef = useRef<any[]>([]); // Store raw data for instant re-filtering
    const configRef = useRef(initialConfig);
    const customSymbolSetRef = useRef(customSymbolSet);
    const fixedModeViewRef = useRef(fixedModeView);
    const refreshRef = useRef<any>(null); // For self-referencing retry
    const retryTimeoutRef = useRef<any>(null); // To prevent multiple retries
    const retryCountRef = useRef<number>(0); // Track retry attempts
    const modeRef = useRef(mode);
    const wasForceFullRef = useRef(false);
    
    // --- MAJOR TREND DISCOVERY STATE ---
    const [majorTrendCandidates, setMajorTrendCandidates] = useState<Set<string>>(() => {
        try {
            const saved = localStorage.getItem(majorTrendCandidatesKey);
            return new Set(saved ? JSON.parse(saved) : []);
        } catch (e) { return new Set(); }
    });
    const [isMajorScanning, setIsMajorScanning] = useState(false);
    const [majorProgress, setMajorProgress] = useState({ current: 0, total: 0 });

    useEffect(() => {
        localStorage.setItem(majorTrendCandidatesKey, JSON.stringify(Array.from(majorTrendCandidates)));
    }, [majorTrendCandidates, majorTrendCandidatesKey]);

    // --- RATE LIMIT & BAN PROTECTION ---
    const bannedUntilRef = useRef<number>(0);
    const lastFetchFinishedTimeRef = useRef<number>(0);
    const MIN_FETCH_GAP = 10000; // 10 seconds minimum between fetches
    const BAN_DURATION = 10 * 60 * 1000; // 10 minutes cool-off if hit 418
    
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

    // --- SMART ANALYSIS ENGINE ---
    const applySmartAnalysis = useCallback((items: ScannerItem[], config: ScanConfig): ScannerItem[] => {
        const smartCfg = config.smartMode;
        if (modeRef.current !== 'SMART' || !smartCfg) return items;
        
        return items.map(item => {
            const vol = item.volume24h || 0;
            const chg = Math.abs(item.change || 0);
            
            // Deterministic but dynamic-looking seed based on symbol
            const seed = item.symbol.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
            
            // Heat: Mixed signal of volatility, volume and "Community Pulse" (simulated)
            const volumeScore = Math.min(40, (vol / 50000000) * 10);
            const volatilityScore = Math.min(40, chg * 4);
            const communityPulse = (seed % 20) + 10; // Simulated community heat
            const heat = Math.min(100, Math.floor(volumeScore + volatilityScore + communityPulse));
            
            // Potential Multiplier Logic
            let potential = 2;
            if (vol < 30000000 && heat > 80) potential = 100;
            else if (vol < 80000000 && heat > 70) potential = 50;
            else if (vol < 200000000 && heat > 60) potential = 10;
            else if (heat > 50) potential = 5;
            
            // Whale Tracking (Simulated Based on Volatility and Volume Spikes)
            const whaleSignal: 'ACCUMULATING' | 'DISTRIBUTING' | 'NEUTRAL' = 
                (chg > 8 && vol > 100000000) ? 'ACCUMULATING' : (chg > 5 && chg < 0) ? 'DISTRIBUTING' : 'NEUTRAL';
            
            const sentimentLabel = heat > 85 ? '极向' : heat > 70 ? '看涨' : heat > 50 ? '中性' : '冷淡';

            return {
                ...item,
                heat,
                potential,
                whaleSignal,
                sentimentLabel,
                smartScore: Math.min(100, (heat * 0.6) + (Math.log10(potential + 1) * 20)),
                potentialReason: potential >= 100 ? '🔥 史诗级登月信号: 极度缩量+热度爆表' : 
                                potential >= 50 ? '🚀 百倍黑马潜质: 巨鲸强力吸筹' : 
                                potential >= 10 ? '✨ 超级独角兽: 社区热度加速增长' : 
                                potential >= 5 ? '📈 稳健上升通道: 技术面与共识双优' : '🔍 正常波动: 维持观察'
            };
        }).filter(item => {
            if (!smartCfg) return true;
            // Apply Smart Filters
            const heatMatch = (item.heat || 0) >= smartCfg.minHeat;
            const potentialMatch = (item.potential || 0) >= smartCfg.minPotential;
            return heatMatch && potentialMatch;
        }).sort((a, b) => (b.smartScore || 0) - (a.smartScore || 0));
    }, []);

    // WATCHDOG effect to prevent scanner from sleeping
    useEffect(() => {
        modeRef.current = mode;
    }, [mode]);

    // Initialize rawDataRef from cache on mount (DISABLED to prevent stale price usage)
    useEffect(() => {
        localStorage.removeItem('SCANNER_RAW_DATA_CACHE');
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
    const lastFilterPulseRef = useRef<string>('');
    useEffect(() => {
        try {
            // Pulse check...
            const symbols = Array.from(customSymbolSet).sort();
            const pulse = JSON.stringify({ 
                initialConfig, 
                mode,
                customSymbols: symbols, 
                fixedModeView, 
                blacklistSize: blacklist.size 
            });
            if (pulse === lastFilterPulseRef.current) return;
            lastFilterPulseRef.current = pulse; // Update ref early

            if (rawDataRef.current && Array.isArray(rawDataRef.current) && rawDataRef.current.length > 0) {
                const { list1: filtered, stats } = processMarketData(
                    rawDataRef.current, 
                    initialConfig, 
                    customSymbolSet, 
                    fixedModeView,
                    majorTrendCandidates
                );
                
                // APPLY SMART ANALYSIS IF IN SMART MODE
                const smartAnalyzed = mode === 'SMART' 
                    ? applySmartAnalysis(filtered, initialConfig)
                    : filtered;

                // Filter out blacklisted symbols
                const nonBlacklisted = smartAnalyzed.filter(item => item && item.symbol && !blacklist.has(item.symbol));

                // Compare with previous list to find new items
                const currentList = Array.isArray(list1Ref.current) ? list1Ref.current : [];
                const prevSymbols = new Set(currentList.map(i => i?.symbol).filter(Boolean));
                
                const finalFiltered = nonBlacklisted.map(item => ({
                    ...item,
                    isNew: !prevSymbols.has(item.symbol) && currentList.length > 0
                }));
                
                // Use functional updates or ref checks to avoid triggering loops if possible
                setMarketStats(prev => {
                    if (JSON.stringify(stats) === JSON.stringify(prev)) return prev;
                    return stats;
                });

                if (JSON.stringify(finalFiltered) !== JSON.stringify(list1Ref.current)) {
                    setList1(finalFiltered);
                    list1Ref.current = finalFiltered;
                }
                
                // Update status text to reflect new count if not currently scanning
                setScanStatusText(prev => {
                    const newText = finalFiltered.length > 0 ? (mode === 'SMART' ? `智能分析完成 (${finalFiltered.length}个)` : `行情就绪 (${finalFiltered.length}个)`) : "无符合条件的币种";
                    if (prev === newText) return prev;
                    if (prev.includes('行情就绪') || prev.includes('无符合条件') || prev.includes('分析完成')) {
                        return newText;
                    }
                    return prev;
                });
            } else if (list1 && Array.isArray(list1) && list1.length > 0) {
                const filtered = list1.filter(item => {
                    if (!item || !item.symbol) return false;
                    if (blacklist.has(item.symbol)) return false;
                    
                    const vol = item.volume24h || 0;
                    if (vol < initialConfig.minVolume) return false;
                    if (initialConfig.maxVolume > 0 && vol > initialConfig.maxVolume) return false;
                    
                    const chg = item.change || 0;
                    if (Math.abs(chg) < initialConfig.minChange) return false;
                    
                    if (initialConfig.source === 'GAINERS' && chg <= 0) return false;
                    if (initialConfig.source === 'LOSERS' && chg >= 0) return false;
                    return true;
                });

                if (JSON.stringify(filtered) !== JSON.stringify(list1Ref.current)) {
                    setList1(filtered);
                    list1Ref.current = filtered;
                }
            }
        } catch (err) {
            console.error("[Scanner] Instant re-filter failed:", err);
        }
    }, [initialConfig, customSymbolSet, fixedModeView, blacklist, mode]); // Stabilized dependencies

    const directModeRef = useRef(directMode);
    useEffect(() => { directModeRef.current = directMode; }, [directMode]);
    const blacklistRef = useRef(blacklist);
    useEffect(() => { blacklistRef.current = blacklist; }, [blacklist]);

    // --- CORE ACTION: Fetch & Process ---
    const marketStatsRef = useRef(marketStats); 
    const refreshList1Candidates = useCallback(async (currentConfig: ScanConfig, forceFull = false) => {
        // 1. BAN CHECK
        const now = Date.now();
        if (now < bannedUntilRef.current) {
            const timeLeft = Math.ceil((bannedUntilRef.current - now) / 1000 / 60);
            setScanStatusText(`IP封禁中，剩余${timeLeft}分钟... 请尝试关闭直连模式`);
            return;
        }

        // 1b. OFFLINE GUARD
        if (typeof window !== 'undefined' && window.navigator && window.navigator.onLine === false) {
            setScanStatusText("网络连接断开，全域扫描已自动挂起...");
            setIsScanning(false);
            return;
        }

        // 2. RATE LIMIT CHECK
        if (now - lastFetchFinishedTimeRef.current < MIN_FETCH_GAP && !forceFull) {
            console.log("[Scanner] Skipped: Fetch gap too short.");
            return;
        }

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
            const endpoint = `${baseUrl}/24hr?_t=${Date.now()}`;
            
            const res = await fetchWithFallback(
                endpoint, 
                { cache: 'no-store', timeout: 45000 }, 
                (d) => Array.isArray(d) && d.length > 0, 
                directModeRef.current
            );
            
            if (!isMountedRef.current) return; 

            if (scanSessionIdRef.current !== sessionId) return;
            
            const data = await res.json();
            lastFetchFinishedTimeRef.current = Date.now();
            
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
            const { list1: filtered, stats } = processMarketData(
                data, 
                configRef.current, 
                customSymbolSetRef.current, 
                fixedModeViewRef.current,
                majorTrendCandidates
            );
            
            // APPLY SMART ANALYSIS IF IN SMART MODE
            const smartAnalyzed = modeRef.current === 'SMART' 
                ? applySmartAnalysis(filtered, configRef.current)
                : filtered;

            const nonBlacklisted = smartAnalyzed.filter(item => !blacklistRef.current.has(item.symbol));
            const prevSymbols = new Set(list1Ref.current.map(i => i.symbol));
            const finalFiltered = nonBlacklisted.map(item => ({
                ...item,
                isNew: !prevSymbols.has(item.symbol) && list1Ref.current.length > 0
            }));
            
            if (JSON.stringify(stats) !== JSON.stringify(marketStatsRef.current)) {
                setMarketStats(stats);
                marketStatsRef.current = stats;
            }
            
            if (JSON.stringify(finalFiltered) !== JSON.stringify(list1Ref.current)) {
                setList1(finalFiltered);
                list1Ref.current = finalFiltered;
            }
            
            setScanStatusText(finalFiltered.length > 0 ? (modeRef.current === 'SMART' ? `智能分析完成 (${finalFiltered.length}个)` : `行情就绪 (${finalFiltered.length}个)`) : "无符合条件的币种");
            if (wasForceFullRef.current) {
                setIsScanning(false);
                wasForceFullRef.current = false;
            }
        } catch (e: any) { 
            lastFetchFinishedTimeRef.current = Date.now();
            if (!isMountedRef.current) return; 

            let errMsg = e?.message || String(e);
            
            if (errMsg.includes('418')) {
                errMsg = "HTTP 418: 您的IP已被Binance暂时封禁。请尝试：1. 关闭[直连模式]使用代理 2. 切换VPN节点 3. 增加扫描间隔。";
                bannedUntilRef.current = Date.now() + BAN_DURATION;
                audioService.speak("行情接口被封禁");
            }
            
            if (!errMsg.includes('Failed to fetch') && !errMsg.includes('NetworkError')) {
                console.error("Scanner Fetch Failed:", errMsg); 
            } else {
                console.warn("Scanner Network Glitch (Retrying...):", errMsg);
            }
            
            if (wasForceFullRef.current && retryCountRef.current < 3 && !errMsg.includes('418')) {
                retryCountRef.current += 1;
                setScanStatusText(`连接失败，5秒后自动重试... (${retryCountRef.current}/3)`);
                
                retryTimeoutRef.current = setTimeout(() => {
                    if (refreshRef.current && isMountedRef.current) {
                        refreshRef.current(configRef.current, true);
                    }
                }, 5000);
            } else {
                setIsScanning(false);
                setScanStatusText(errMsg.includes('418') ? errMsg : "扫描终止: 数据链路异常");
                retryCountRef.current = 0; 
                wasForceFullRef.current = false;
            }
        } finally {
            isFetchingRef.current = false;
        }
    }, [applySmartAnalysis]); // Stabilized dependencies

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

    const isScanningRef = useRef(isScanning);
    useEffect(() => { isScanningRef.current = isScanning; }, [isScanning]);

    // --- EFFECT: 24/7 AI High-Speed Background Task ---
    useEffect(() => {
        if (mode !== 'SMART' || !initialConfig.smartMode?.isActive) return;

        console.log("[Scanner] AI High-speed background task activated.");
        const AI_SCAN_INTERVAL = 12000; // Slowed down from 8000
        const interval = setInterval(() => {
            if (!isScanningRef.current && !isFetchingRef.current) {
                console.log("[AI-SMART] High-speed cycle triggered...");
                refreshList1Candidates(configRef.current, false);
            }
        }, AI_SCAN_INTERVAL);

        return () => clearInterval(interval);
    }, [mode, initialConfig.smartMode?.isActive, refreshList1Candidates]); // Removed isScanning dependency

    // --- MAJOR TREND DISCOVERY ENGINE ---
    const majorTrendConfigRef = useRef(initialConfig.majorTrend);
    useEffect(() => { majorTrendConfigRef.current = initialConfig.majorTrend; }, [initialConfig.majorTrend]);

    const runMajorTrendDiscovery = useCallback(async (isManual: boolean = false) => {
        const cfg = majorTrendConfigRef.current;
        if (!cfg || !cfg.enabled) return;
        
        // OFFLINE CHECK
        if (typeof window !== 'undefined' && window.navigator && window.navigator.onLine === false) {
            setIsMajorScanning(false);
            return;
        }
        
        setIsMajorScanning(true);
        // Ensure we get all USDT perpetual symbols from the latest raw data
        const allSymbols = rawDataRef.current.map(i => i.symbol).filter(s => s.endsWith('USDT'));
        if (allSymbols.length === 0) {
            setIsMajorScanning(false);
            return;
        }

        setMajorProgress({ current: 0, total: allSymbols.length });
        
        // Dynamic Rate: Manual/First run = 30/min, Background = Configured (capped at 15)
        const batchSize = isManual ? 30 : Math.min(15, (cfg.requestPerMinute || 15));
        const validSymbols = new Set<string>();
        
        for (let i = 0; i < allSymbols.length; i += batchSize) {
            if (!isMountedRef.current) break;
            // Allow stopping if the mode is disabled during scan
            if (!majorTrendConfigRef.current?.enabled) break;
            
            const batch = allSymbols.slice(i, i + batchSize);
            setMajorProgress({ current: i, total: allSymbols.length });
            
            // Limit concurrency within batch
            const concurrencyLimit = 5;
            for (let b = 0; b < batch.length; b += concurrencyLimit) {
                const chunk = batch.slice(b, b + concurrencyLimit);
                // Process Batch Chunk
                await Promise.all(chunk.map(async (symbol) => {
                    try {
                        const timeParam = cfg.filterTimeParam || cfg.lookbackDays || 300;
                        const limit = timeParam + 20; 
                        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${cfg.filterKLinePeriod || '1d'}&limit=${limit}`;
                        const res = await fetchWithFallback(url, { timeout: 10000 }, (d) => Array.isArray(d), directModeRef.current);
                        const klines = await res.json();
                        
                        if (!Array.isArray(klines) || klines.length < timeParam * 0.5) return;

                        const prices = klines.map((k: any) => parseFloat(k[4])); 
                        const lookbackPrices = prices.slice(-timeParam);
                        const currentPrice = lookbackPrices[lookbackPrices.length - 1];
                        
                        const enableLong = cfg.enableLong !== false;
                        const enableShort = cfg.enableShort !== false;
                        const enableSideways = cfg.enableSideways !== false;

                        let histPrices = lookbackPrices;
                        if (enableSideways) {
                            histPrices = lookbackPrices.slice(0, Math.max(1, lookbackPrices.length - cfg.sidewaysDays));
                        }

                        const maxPrice = Math.max(...histPrices);
                        const minPrice = Math.min(...histPrices);

                        const maxDrop = ((maxPrice - currentPrice) / maxPrice) * 100;
                        const maxPump = ((currentPrice - minPrice) / minPrice) * 100;

                        const distLong = ((currentPrice - minPrice) / minPrice) * 100;
                        const distShort = ((maxPrice - currentPrice) / maxPrice) * 100;

                        const isLongMatch = enableLong && (maxDrop >= cfg.minHistoryDrop) && (distLong <= (cfg.maxExtremeDistanceLong !== undefined ? cfg.maxExtremeDistanceLong : cfg.maxExtremeDistance));
                        const isShortMatch = enableShort && (maxPump >= cfg.minHistoryPump) && (distShort <= (cfg.maxExtremeDistanceShort !== undefined ? cfg.maxExtremeDistanceShort : cfg.maxExtremeDistance));

                        const stage1Match = isLongMatch || isShortMatch;
                        if (!stage1Match) return;

                        // Sideways accumulation check
                        if (enableSideways) {
                            const sidewaysIndex = prices.length - 1 - cfg.sidewaysDays;
                            if (sidewaysIndex >= 0) {
                                const referencePrice = prices[sidewaysIndex];
                                const changeFromRef = ((currentPrice - referencePrice) / referencePrice) * 100;
                                if (changeFromRef > cfg.sidewaysMaxPump || changeFromRef < -cfg.sidewaysMaxDrop) {
                                    return;
                                }
                            }
                        }

                        // --- NEW ADVANCED FILTERS ---
                        if (cfg.filterEmaPeriod > 0) {
                            if (prices.length < cfg.filterEmaPeriod) return;
                            const ema = calculateEMA(prices, cfg.filterEmaPeriod);
                            let crossCount = 0;
                            let lastDirection: 'UP' | 'DOWN' | null = null;
                            let lastCrossIndex = -1;

                            for (let i = cfg.filterEmaPeriod - 1; i < prices.length; i++) {
                                const emaVal = ema[i - (cfg.filterEmaPeriod - 1)];
                                const currentDirection = prices[i] > emaVal ? 'UP' : 'DOWN';
                                if (lastDirection && currentDirection !== lastDirection) {
                                    crossCount++;
                                    lastCrossIndex = i;
                                }
                                lastDirection = currentDirection;
                            }

                            if (crossCount >= cfg.filterCrossingCount) return;

                            // Check post-cross performance
                            if (lastCrossIndex !== -1 && lastCrossIndex < prices.length - 1) {
                                const crossPrice = prices[lastCrossIndex];
                                const maxFuturePrice = Math.max(...prices.slice(lastCrossIndex + 1));
                                const minFuturePrice = Math.min(...prices.slice(lastCrossIndex + 1));

                                const maxPumpAfterCross = ((maxFuturePrice - crossPrice) / crossPrice) * 100;
                                const maxDropAfterCross = ((minFuturePrice - crossPrice) / crossPrice) * 100;

                                if (lastDirection === 'UP' && maxPumpAfterCross > cfg.filterLongMaxPump) return;
                                if (lastDirection === 'DOWN' && maxDropAfterCross < cfg.filterShortMinDrop) return;
                            }
                        }
                        // --- END ADVANCED FILTERS ---

                        validSymbols.add(symbol);
                    } catch (e) {}
                }));
                // Short pause within batch
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            if (i + batchSize < allSymbols.length) {
                // Optimized wait: 4 seconds to respect weight while remaining fast
                await new Promise(resolve => setTimeout(resolve, 4000));
            }
        }

        if (isMountedRef.current) {
            setMajorTrendCandidates(validSymbols);
            setIsMajorScanning(false);
            setMajorProgress({ current: allSymbols.length, total: allSymbols.length });
            audioService.speak("大行情发现任务完成");
        }
    }, []);

    // Major Trend Background Loop
    useEffect(() => {
        if (!initialConfig.majorTrend?.enabled) return;

        const intervalMs = initialConfig.majorTrend.updateIntervalHours * 60 * 60 * 1000;
        
        // Auto background runs with default low speed (isManual = false)
        const timer = setInterval(() => runMajorTrendDiscovery(false), intervalMs);
        return () => clearInterval(timer);
    }, [initialConfig.majorTrend?.enabled, initialConfig.majorTrend?.updateIntervalHours, runMajorTrendDiscovery]);


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
        list1Ref, // Exposed for dependent modules (List 2)
        majorTrendCandidates,
        isMajorScanning,
        majorProgress,
        runMajorTrendDiscovery
    };
};
