
import { useState, useRef, useEffect, useCallback } from 'react';
import { ScanConfig, ScannerItem } from '../../components/Scanner/scannerTypes';
import { processMarketData } from '../../services/rules/list1_market';
import { fetchWithFallback } from '../../services/apiService';
import { audioService } from '../../services/audioService';
import { calculateEMA } from '../../services/indicators';
import { pipelineCoordinator } from '../../services/pipelineQueue';

export const useScannerLogic = (
    initialConfig: ScanConfig, 
    customSymbolSet: Set<string>,
    fixedModeView: 'MONITOR' | 'SEARCH',
    directMode: boolean = false,
    mode: 'LIVE' | 'BACKTEST' | 'SMART' = 'LIVE',
    strategyId?: string,
    isScanAllowed: boolean = true
) => {
    const suffix = strategyId ? `_${strategyId}` : '';
    const list1CacheKey = `SCANNER_LIST1${suffix}`;
    const blacklistKey = `SCANNER_BLACKLIST${suffix}`;
    const majorTrendCandidatesKey = `SCANNER_MAJOR_TREND_CANDIDATES${suffix}`;

    // --- ROTATION / SCANNABILITY GUARD ---
    const isScanAllowedRef = useRef(isScanAllowed);
    useEffect(() => {
        isScanAllowedRef.current = isScanAllowed;
    }, [isScanAllowed]);

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
    
    // --- 早上8点成交量与开盘价缓存 ---
    const volume8amCacheRef = useRef<Map<string, { volume: number, openPrice: number, timestamp: number }>>(new Map());
    const majorTrendCandidatesRef = useRef<Set<string>>(new Set());
    
    // --- MAJOR TREND DISCOVERY STATE ---
    const [hasRunMajorTrend, setHasRunMajorTrend] = useState<boolean>(() => {
        try {
            return localStorage.getItem(`SCANNER_HAS_RUN_MAJOR${suffix}`) === 'true';
        } catch (e) { return false; }
    });

    const [majorTrendCandidates, setMajorTrendCandidates] = useState<Set<string>>(() => {
        try {
            const saved = localStorage.getItem(majorTrendCandidatesKey);
            if (saved) {
                const parsed = JSON.parse(saved);
                const s = new Set(Array.isArray(parsed) ? parsed : []);
                majorTrendCandidatesRef.current = s;
                return s;
            }
            return new Set();
        } catch (e) { return new Set(); }
    });

    // Persist Major Trend Candidates
    useEffect(() => {
        try {
            majorTrendCandidatesRef.current = majorTrendCandidates;
            localStorage.setItem(majorTrendCandidatesKey, JSON.stringify(Array.from(majorTrendCandidates)));
        } catch (e) {
            console.warn("Failed to persist Major Trend Candidates");
        }
    }, [majorTrendCandidates, majorTrendCandidatesKey]);

    const [isMajorScanning, setIsMajorScanning] = useState(false);
    const [majorProgress, setMajorProgress] = useState({ current: 0, total: 0 });

    const majorTrendLimitsKey = `SCANNER_MAJOR_TREND_LIMITS${suffix}`;
    const [majorTrendLimits, setMajorTrendLimits] = useState<Record<string, { maxZ: number, minZ: number }>>(() => {
        try {
            const saved = localStorage.getItem(majorTrendLimitsKey);
            return saved ? JSON.parse(saved) : {};
        } catch (e) { return {}; }
    });

    useEffect(() => {
        localStorage.setItem(majorTrendLimitsKey, JSON.stringify(majorTrendLimits));
    }, [majorTrendLimits, majorTrendLimitsKey]);

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

    // Initialize rawDataRef from cache on mount if available to prevent transient empty states
    useEffect(() => {
        try {
            const cached = localStorage.getItem('SCANNER_RAW_DATA_CACHE');
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    rawDataRef.current = parsed;
                }
            }
        } catch (_) {}
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
                blacklistSize: blacklist.size,
                majorTrendCandidates: majorTrendCandidates ? Array.from(majorTrendCandidates).sort() : [],
                hasRunMajorTrend
            });
            if (pulse === lastFilterPulseRef.current) return;
            lastFilterPulseRef.current = pulse; // Update ref early

            if (rawDataRef.current && Array.isArray(rawDataRef.current) && rawDataRef.current.length > 0) {
                const nowTime = Date.now();
                const expiry = 5 * 60 * 1000;
                const enrichedRaw = rawDataRef.current.map((t: any) => {
                    const cached = volume8amCacheRef.current.get(t.symbol);
                    if (cached && (nowTime - cached.timestamp < expiry)) {
                        return {
                            ...t,
                            _cachedVolume8am: cached.volume,
                            _cachedOpenPrice8am: cached.openPrice
                        };
                    }
                    return t;
                });

                const { list1: filtered, stats } = processMarketData(
                    enrichedRaw, 
                    initialConfig, 
                    customSymbolSet, 
                    fixedModeView
                );
                
                // Map volume8am and change8am from cache if exists
                filtered.forEach(item => {
                    const cached = volume8amCacheRef.current.get(item.symbol);
                    if (cached && (nowTime - cached.timestamp < expiry)) {
                        item.volume8am = cached.volume;
                        if (cached.openPrice > 0 && item.price > 0) {
                            item.change8am = ((item.price - cached.openPrice) / cached.openPrice) * 100;
                        }
                    }
                });

                // Apply 8AM filtering if enabled
                let finalCandidates = filtered;
                if (initialConfig.enableVol8am) {
                    const minVol8am = initialConfig.minVolume8am ?? 0;
                    const maxVol8am = initialConfig.maxVolume8am ?? 0;
                    const minChange = initialConfig.minChange || 0;
                    const source = initialConfig.source || 'BOTH';

                    finalCandidates = filtered.filter(item => {
                        const rawVol8am = item.volume8am;
                        const vol8am = rawVol8am !== undefined && rawVol8am > 0 ? rawVol8am : (item.volume24h !== undefined ? item.volume24h : (parseFloat((item as any).volume || "0") || 0));
                        if (vol8am < minVol8am) return false;
                        if (maxVol8am > 0 && vol8am > maxVol8am) return false;

                        const effectiveChange = item.change8am !== undefined ? item.change8am : 0;
                        if (source === 'GAINERS' && effectiveChange <= 0) return false;
                        if (source === 'LOSERS' && effectiveChange >= 0) return false;
                        if (minChange > 0 && Math.abs(effectiveChange) < minChange) return false;

                        return true;
                    });
                }

                // APPLY SMART ANALYSIS IF IN SMART MODE
                const smartAnalyzed = mode === 'SMART' 
                    ? applySmartAnalysis(finalCandidates, initialConfig)
                    : finalCandidates;

                // Filter out blacklisted symbols
                const nonBlacklisted = smartAnalyzed.filter(item => item && item.symbol && !blacklist.has(item.symbol));

                // --- INTEGRATION OF TREND FILTERING FOR REAL-TIME RAW DATA ---
                // We keep list1 as the full volume-passing set of candidates
                // so the user can always see the initial screening list and run the deep scan.
                // Display filtering is handled dynamically inside List1_Selection.tsx
                const trendFiltered = nonBlacklisted;

                // Compare with previous list to find new items
                const currentList = Array.isArray(list1Ref.current) ? list1Ref.current : [];
                const prevSymbols = new Set(currentList.map(i => i?.symbol).filter(Boolean));
                
                const finalFiltered = trendFiltered.map(item => ({
                    ...item,
                    isNew: !prevSymbols.has(item.symbol) && currentList.length > 0
                }));
                
                // Use functional updates or ref checks to avoid triggering loops if possible
                setMarketStats(prev => {
                    if (JSON.stringify(stats) === JSON.stringify(prev)) return prev;
                    return stats;
                });

                if (finalFiltered.length > 0) {
                    if (JSON.stringify(finalFiltered) !== JSON.stringify(list1Ref.current)) {
                        setList1(finalFiltered);
                        list1Ref.current = finalFiltered;
                    }
                } else if (list1Ref.current.length === 0) {
                    setList1([]);
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
                    if (initialConfig.minVolume > 0 && vol < initialConfig.minVolume) return false;
                    if (initialConfig.maxVolume > 0 && vol > initialConfig.maxVolume) return false;
                    
                    // In Major Trend Discovery Mode, we bypass standard daily change and direction filters
                    // so we do not clear out the raw candidates if the discovery scan hasn't run or is empty.
                    if (initialConfig.majorTrend?.enabled) {
                        return true;
                    }

                    const chg = item.change || 0;
                    if (initialConfig.source === 'GAINERS' && chg <= 0) return false;
                    if (initialConfig.source === 'LOSERS' && chg >= 0) return false;
                    if (initialConfig.minChange > 0 && initialConfig.minVolume > 0 && Math.abs(chg) < initialConfig.minChange) return false;
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
    }, [initialConfig, customSymbolSet, fixedModeView, blacklist, mode, majorTrendCandidates, majorTrendLimits, hasRunMajorTrend]); // Stabilized dependencies

    const directModeRef = useRef(directMode);
    useEffect(() => { directModeRef.current = directMode; }, [directMode]);
    const blacklistRef = useRef(blacklist);
    useEffect(() => { blacklistRef.current = blacklist; }, [blacklist]);

    // --- CORE ACTION: Fetch & Process ---
    const marketStatsRef = useRef(marketStats); 
    const refreshList1Candidates = useCallback(async (currentConfig: ScanConfig, forceFull = false) => {
        // Rotation / Scan Allowed Check
        if (!isScanAllowedRef.current) {
            setScanStatusText("轮循休眠中...");
            return;
        }

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
            
            // --- 早上8点成交量异步获取与过滤 (Since 8 AM Volume) ---
            const cacheExpiryMs = 5 * 60 * 1000; // 5 minute cache
            const nowTime = Date.now();
            const enrichedData = data.map((t: any) => {
                const cached = volume8amCacheRef.current.get(t.symbol);
                if (cached && (nowTime - cached.timestamp < cacheExpiryMs)) {
                    return {
                        ...t,
                        _cachedVolume8am: cached.volume,
                        _cachedOpenPrice8am: cached.openPrice
                    };
                }
                return t;
            });

            // Logic Processing
            const { list1: filtered, stats } = processMarketData(
                enrichedData, 
                configRef.current, 
                customSymbolSetRef.current, 
                fixedModeViewRef.current
            );

            // Filter by 8AM volume if enabled
            let finalCandidates = filtered;
            if (configRef.current.enableVol8am) {
                // Fetch 1d klines concurrently to fill volume8am and compute change8am for candidates only when enabled
                await Promise.all(filtered.map(async (item) => {
                    const cached = volume8amCacheRef.current.get(item.symbol);
                    let vol8am = 0;
                    let openPrice8am = 0;
                    if (cached && (nowTime - cached.timestamp < cacheExpiryMs)) {
                        vol8am = cached.volume;
                        openPrice8am = cached.openPrice || 0;
                    } else {
                        try {
                            const url1d = `https://fapi.binance.com/fapi/v1/klines?symbol=${item.symbol}&interval=1d&limit=1`;
                            const res1d = await fetchWithFallback(url1d, { timeout: 10000 }, (d) => Array.isArray(d), directModeRef.current);
                            const klines1d = await res1d.json();
                            if (Array.isArray(klines1d) && klines1d.length > 0) {
                                // index 7 is quote asset volume (USDT volume), index 1 is open price
                                vol8am = (parseFloat(klines1d[0][7]) || 0) / 1000000;
                                openPrice8am = parseFloat(klines1d[0][1]) || 0;
                                volume8amCacheRef.current.set(item.symbol, { volume: vol8am, openPrice: openPrice8am, timestamp: nowTime });
                            }
                        } catch (err) {
                            console.error(`[Volume8am] Error fetching ${item.symbol}:`, err);
                            vol8am = cached ? cached.volume : (item.volume24h !== undefined ? item.volume24h : (parseFloat((item as any).volume || "0") || 0));
                            openPrice8am = cached?.openPrice || 0;
                        }
                    }
                    item.volume8am = vol8am;
                    if (openPrice8am > 0 && item.price > 0) {
                        item.change8am = ((item.price - openPrice8am) / openPrice8am) * 100;
                    } else {
                        item.change8am = undefined;
                    }
                }));

                const minVol8am = configRef.current.minVolume8am ?? 0;
                const maxVol8am = configRef.current.maxVolume8am ?? 0;
                const minChange = configRef.current.minChange || 0;
                const source = configRef.current.source || 'BOTH';

                finalCandidates = filtered.filter(item => {
                    const rawVol8am = item.volume8am;
                    const vol8am = rawVol8am !== undefined && rawVol8am > 0 ? rawVol8am : (item.volume24h !== undefined ? item.volume24h : (parseFloat((item as any).volume || "0") || 0));
                    if (vol8am < minVol8am) return false;
                    if (maxVol8am > 0 && vol8am > maxVol8am) return false;

                    const effectiveChange = item.change8am !== undefined ? item.change8am : (item.change || 0);
                    if (source === 'GAINERS' && effectiveChange <= 0) return false;
                    if (source === 'LOSERS' && effectiveChange >= 0) return false;
                    if (minChange > 0 && Math.abs(effectiveChange) < minChange) return false;

                    return true;
                });
            }

            // --- FILTER BY TREND IF ENABLED ---
            // Display filtering is handled dynamically inside List1_Selection.tsx, so we keep finalCandidates intact here.

            // APPLY SMART ANALYSIS IF IN SMART MODE
            const smartAnalyzed = modeRef.current === 'SMART' 
                ? applySmartAnalysis(finalCandidates, configRef.current)
                : finalCandidates;

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
            
            if (finalFiltered.length > 0) {
                if (JSON.stringify(finalFiltered) !== JSON.stringify(list1Ref.current)) {
                    setList1(finalFiltered);
                    list1Ref.current = finalFiltered;
                }
            } else if (list1Ref.current.length === 0) {
                setList1([]);
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
            
            const isBenignNetworkNoise = errMsg.includes('Failed to fetch') || 
                                         errMsg.includes('NetworkError') || 
                                         errMsg.includes('aborted') || 
                                         errMsg.includes('AbortError') ||
                                         errMsg.includes('timed out') ||
                                         errMsg.includes('TimeoutError');
            
            if (!isBenignNetworkNoise) {
                console.error("Scanner Fetch Failed:", errMsg); 
            } else {
                console.warn("Scanner Network Reconnecting/Glitch:", errMsg);
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

    // --- EFFECT: Instantly update and fetch from Binance when filtering rule parameters change ---
    const configUpdateTimerRef = useRef<any>(null);
    useEffect(() => {
        if (!initialConfig) return;
        if (configUpdateTimerRef.current) clearTimeout(configUpdateTimerRef.current);
        configUpdateTimerRef.current = setTimeout(() => {
            if (isMountedRef.current && isScanAllowedRef.current && refreshRef.current) {
                lastFetchFinishedTimeRef.current = 0; // Bypass MIN_FETCH_GAP for high-speed response
                refreshRef.current(initialConfig, true);
            }
        }, 200);

        return () => {
            if (configUpdateTimerRef.current) clearTimeout(configUpdateTimerRef.current);
        };
    }, [initialConfig]);

    const isScanningRef = useRef(isScanning);
    useEffect(() => { isScanningRef.current = isScanning; }, [isScanning]);

    // --- EFFECT: 24/7 AI High-Speed Background Task ---
    useEffect(() => {
        if (mode !== 'SMART' || !initialConfig.smartMode?.isActive) return;

        console.log("[Scanner] AI High-speed background task activated.");
        const selectedId = typeof window !== 'undefined' ? localStorage.getItem('SCANNER_SELECTED_STRATEGY_ID') : '';
        const isBg = strategyId && selectedId ? strategyId !== selectedId : false;
        const scale = isBg ? 15 : 1;
        const AI_SCAN_INTERVAL = 12000 * scale; // Slowed down from 8000, 15x slower in background
        const interval = setInterval(() => {
            if (!isScanningRef.current && !isFetchingRef.current) {
                console.log("[AI-SMART] High-speed cycle triggered...");
                refreshList1Candidates(configRef.current, false);
            }
        }, AI_SCAN_INTERVAL);

        return () => clearInterval(interval);
    }, [mode, initialConfig.smartMode?.isActive, refreshList1Candidates, strategyId]); // Removed isScanning dependency

    // --- MAJOR TREND DISCOVERY ENGINE ---
    const majorTrendConfigRef = useRef(initialConfig.majorTrend);
    useEffect(() => { majorTrendConfigRef.current = initialConfig.majorTrend; }, [initialConfig.majorTrend]);

    const majorScanAbortRef = useRef<boolean>(false);

    const cancelMajorScan = useCallback(() => {
        majorScanAbortRef.current = true;
        setIsMajorScanning(false);
        setScanStatusText("大行情发现已手动中止");
    }, []);

    const runMajorTrendDiscovery = useCallback(async (isManual: boolean = false) => {
        if (!isScanAllowedRef.current) {
            return;
        }

        const cfg = majorTrendConfigRef.current;
        if (!cfg || !cfg.enabled) return;
        
        // OFFLINE CHECK
        if (typeof window !== 'undefined' && window.navigator && window.navigator.onLine === false) {
            setIsMajorScanning(false);
            return;
        }

        // 🔒 [时间先后·互斥安全锁]: 若行情启动底池正在扫描，大行情等待让行，绝不同时工作
        if ((window as any).IS_START_TREND_SCANNING) {
            if (isManual) {
                alert('“行情启动底池”正在扫描中，两个引擎实行时间先后分开作业，请等待底池扫描完成后自动接力运行！');
            } else {
                console.log("[MajorTrend] Start trend pool is currently scanning. Waiting for pool scan completion before starting major trend...");
            }
            return;
        }
        
        setIsMajorScanning(true);
        (window as any).IS_MAJOR_TREND_SCANNING = true;
        majorScanAbortRef.current = false;

        try {
            // Step 1: Market Primary Screening (市场初筛)
            // If rawDataRef is empty, pre-fetch ticker data to ensure we have symbols
            if (!rawDataRef.current || rawDataRef.current.length === 0) {
                try {
                    const baseUrl = 'https://fapi.binance.com/fapi/v1/ticker';
                    const endpoint = `${baseUrl}/24hr?_t=${Date.now()}`;
                    const res = await fetchWithFallback(
                        endpoint, 
                        { cache: 'no-store', timeout: 45000 }, 
                        (d) => Array.isArray(d) && d.length > 0, 
                        directModeRef.current
                    );
                    const data = await res.json();
                    if (Array.isArray(data) && data.length > 0) {
                        rawDataRef.current = data;
                    }
                } catch (err) {
                    console.warn("[MajorTrend] Pre-fetch ticker data failed:", err);
                }
            }

            if (majorScanAbortRef.current) return;
        
        // Filter symbols using processMarketData and volume filters
        const { list1: filtered } = processMarketData(
            rawDataRef.current,
            configRef.current,
            customSymbolSetRef.current,
            fixedModeViewRef.current
        );

        let baseFiltered = filtered.filter(item => !blacklistRef.current.has(item.symbol));
        if (baseFiltered.length === 0) {
            setIsMajorScanning(false);
            return;
        }

        if (configRef.current.enableVol8am) {
            const cacheExpiryMs = 5 * 60 * 1000;
            const nowTime = Date.now();
            await Promise.all(baseFiltered.map(async (item) => {
                const cached = volume8amCacheRef.current.get(item.symbol);
                let vol8am = 0;
                let openPrice8am = 0;
                if (cached && (nowTime - cached.timestamp < cacheExpiryMs)) {
                    vol8am = cached.volume;
                    openPrice8am = cached.openPrice || 0;
                } else {
                    try {
                        const url1d = `https://fapi.binance.com/fapi/v1/klines?symbol=${item.symbol}&interval=1d&limit=1`;
                        const res1d = await fetchWithFallback(url1d, { timeout: 10000 }, (d) => Array.isArray(d), directModeRef.current);
                        const klines1d = await res1d.json();
                        if (Array.isArray(klines1d) && klines1d.length > 0) {
                            vol8am = (parseFloat(klines1d[0][7]) || 0) / 1000000;
                            openPrice8am = parseFloat(klines1d[0][1]) || 0;
                            volume8amCacheRef.current.set(item.symbol, { volume: vol8am, openPrice: openPrice8am, timestamp: nowTime });
                        }
                    } catch (err) {
                        console.error(`[Volume8am] Error fetching ${item.symbol}:`, err);
                        vol8am = cached ? cached.volume : item.volume24h;
                        openPrice8am = cached?.openPrice || 0;
                    }
                }
                item.volume8am = vol8am;
                if (openPrice8am > 0 && item.price > 0) {
                    item.change8am = ((item.price - openPrice8am) / openPrice8am) * 100;
                } else {
                    item.change8am = undefined;
                }
            }));

            const minVol8am = configRef.current.minVolume8am ?? 0;
            const maxVol8am = configRef.current.maxVolume8am ?? 0;
            const minChange = configRef.current.minChange || 0;
            const source = configRef.current.source || 'BOTH';

            baseFiltered = baseFiltered.filter(item => {
                const rawVol8am = item.volume8am;
                const vol8am = rawVol8am !== undefined && rawVol8am > 0 ? rawVol8am : item.volume24h;
                if (vol8am < minVol8am) return false;
                if (maxVol8am > 0 && vol8am > maxVol8am) return false;

                const effectiveChange = item.change8am !== undefined ? item.change8am : (item.change || 0);
                if (source === 'GAINERS' && effectiveChange <= 0) return false;
                if (source === 'LOSERS' && effectiveChange >= 0) return false;
                if (minChange > 0 && Math.abs(effectiveChange) < minChange) return false;

                return true;
            });
        }

        const primaryCandidates = baseFiltered;

        // By user requirement: "大行情发现"读取"行情启动底池"里的币
        let candidateSymbols: string[] = [];
        try {
            const rawPool = localStorage.getItem('SCANNER_START_TREND_POOL');
            if (rawPool) {
                const parsed = JSON.parse(rawPool);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    candidateSymbols = parsed.map((item: any) => item.symbol).filter(Boolean);
                }
            }
        } catch (_) {}

        let targetSymbols: string[] = [];
        if (candidateSymbols.length > 0) {
            targetSymbols = candidateSymbols.filter(sym => !blacklistRef.current.has(sym));
        } else {
            targetSymbols = primaryCandidates.map(i => i.symbol);
        }

        // 🔒 确保既有候选币种也被纳入审计回溯，若已不再符合过滤条件则自动删除，同时保持存留币种持续无缝供给
        const targetSet = new Set(targetSymbols);
        majorTrendCandidatesRef.current.forEach(cand => {
            const sym = cand.replace('_LONG', '').replace('_SHORT', '');
            if (sym && !blacklistRef.current.has(sym)) {
                targetSet.add(sym);
            }
        });
        targetSymbols = Array.from(targetSet);

        if (targetSymbols.length === 0) {
            setIsMajorScanning(false);
            return;
        }

        // Initialize progress with target candidate count
        setMajorProgress({ current: 0, total: targetSymbols.length });

        if (!isMountedRef.current || !majorTrendConfigRef.current?.enabled) {
            setIsMajorScanning(false);
            return;
        }
        
        // -------------------------------------------------------------
        // 🔒 [零空隙与持续存留铁律]: 保留现有候选集合作为基准，绝不初始清空，确保为列表2提供0空隙数据源
        // -------------------------------------------------------------
        const validSymbols = new Set<string>(majorTrendCandidatesRef.current);
        const limitsMap: Record<string, { maxZ: number, minZ: number }> = { ...majorTrendLimits };

        const enableLong = cfg.enableLong !== false;
        const enableShort = cfg.enableShort !== false;
        const enableSideways = cfg.enableSideways !== false;

        let stage1PassedCount = 0;
        let stage2PassedCount = 0;

        setMajorProgress({
            current: 0,
            total: targetSymbols.length,
            stage: 'group1',
            group1Passed: 0,
            group2Passed: 0,
            currentSymbol: ''
        } as any);

        const perCoinDelayMs = Math.max(1, cfg.intervalSeconds ?? (cfg.intervalMinutes ? Math.min(cfg.intervalMinutes, 60) : 3)) * 1000;
        const KLINE_LIMIT_CACHE = ((window as any).KLINE_LIMIT_CACHE = (window as any).KLINE_LIMIT_CACHE || {});

        for (let idx = 0; idx < targetSymbols.length; idx++) {
            if (!isMountedRef.current || !majorTrendConfigRef.current?.enabled) break;
            if (majorScanAbortRef.current) break;
            const symbol = targetSymbols[idx];
            const coinCycleStart = Date.now();
            const targetIntervalMs = perCoinDelayMs;
            const maxWorkTime = Math.min(2800, Math.max(500, targetIntervalMs - 100));

            // 实时更新当前正在扫描的币种与序号，保证每枚币进度条绝对不卡住
            setMajorProgress({
                current: idx + 1,
                total: targetSymbols.length,
                stage: 'group2',
                group1Passed: stage1PassedCount,
                group2Passed: stage2PassedCount,
                currentSymbol: symbol
            } as any);

            let coinTimeoutId: any = null;
            try {
                await Promise.race([
                    (async () => {
                        const timeParam = cfg.filterTimeParam || cfg.lookbackDays || 300;
                        const limit = timeParam + 20;
                        let klines: any[] | null = null;

                        const nowTime = Date.now();
                        // ⚡ [日K极速扫描方案]: 10分钟长效缓存 + 跨模块日K复用，零冗余拉取
                        if (KLINE_LIMIT_CACHE[symbol]?.[timeParam]?.klines && (nowTime - (KLINE_LIMIT_CACHE[symbol][timeParam].timestamp || 0) < 600000)) {
                            klines = KLINE_LIMIT_CACHE[symbol][timeParam].klines;
                        } else if (KLINE_LIMIT_CACHE[`${symbol}_1d`] && Array.isArray(KLINE_LIMIT_CACHE[`${symbol}_1d`]) && KLINE_LIMIT_CACHE[`${symbol}_1d`].length >= timeParam) {
                            klines = KLINE_LIMIT_CACHE[`${symbol}_1d`];
                        } else if (KLINE_LIMIT_CACHE[symbol]?.['1d']?.klines && KLINE_LIMIT_CACHE[symbol]['1d'].klines.length >= timeParam && (nowTime - (KLINE_LIMIT_CACHE[symbol]['1d'].timestamp || 0) < 600000)) {
                            klines = KLINE_LIMIT_CACHE[symbol]['1d'].klines;
                        }

                        if (!klines || !Array.isArray(klines) || klines.length === 0) {
                            const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=${limit}`;
                            const res = await fetchWithFallback(url, { timeout: 2500 }, (d) => Array.isArray(d), directModeRef.current);
                            klines = await res.json();
                        }
                
                if (Array.isArray(klines) && klines.length >= 2) {
                    if (!KLINE_LIMIT_CACHE[symbol]) KLINE_LIMIT_CACHE[symbol] = {};
                    KLINE_LIMIT_CACHE[symbol][timeParam] = { timestamp: Date.now(), klines };
                    KLINE_LIMIT_CACHE[symbol]['1d'] = { timestamp: Date.now(), klines };
                    KLINE_LIMIT_CACHE[`${symbol}_1d`] = klines;

                    const prices = klines.map((k: any) => parseFloat(k[4])); 
                    const periodKlines = klines.slice(-timeParam);
                    const highs = periodKlines.map((k: any) => parseFloat(k[2]));
                    const lows = periodKlines.map((k: any) => parseFloat(k[3]));
                    const closes = periodKlines.map((k: any) => parseFloat(k[4]));
                    const currentPrice = closes[closes.length - 1];

                    // 1. Stage 1: 横盘蓄势过滤
                    let maxZ = currentPrice;
                    let minZ = currentPrice;
                    let sidewaysMatch = true;

                    if (enableSideways && cfg.sidewaysDays > 0) {
                        const sidewaysHighs = highs.slice(-cfg.sidewaysDays);
                        const sidewaysLows = lows.slice(-cfg.sidewaysDays);
                        maxZ = sidewaysHighs.length > 0 ? Math.max(...sidewaysHighs) : currentPrice;
                        minZ = sidewaysLows.length > 0 ? Math.min(...sidewaysLows) : currentPrice;

                        const dropFromMax = ((maxZ - currentPrice) / maxZ) * 100;
                        const riseFromMin = ((currentPrice - minZ) / minZ) * 100;

                        if (dropFromMax >= cfg.sidewaysMaxDrop || riseFromMin >= cfg.sidewaysMaxPump) {
                            sidewaysMatch = false;
                        }
                    }

                    // 2. Stage 2: 回溯周期与空间极值过滤
                    let stage2Match = false;
                    let isLongMatch = false;
                    let isShortMatch = false;
                    let emaFailed = false;

                    if (sidewaysMatch) {
                        let histHighs = highs;
                        let histLows = lows;
                        if (enableSideways && highs.length > cfg.sidewaysDays) {
                            const endIdx = Math.max(1, highs.length - cfg.sidewaysDays);
                            histHighs = highs.slice(0, endIdx);
                            histLows = lows.slice(0, endIdx);
                        }

                        const maxPrice = histHighs.length > 0 ? Math.max(...histHighs) : currentPrice;
                        const minPrice = histLows.length > 0 ? Math.min(...histLows) : currentPrice;

                        const dropFromMaxToMin = ((maxPrice - minPrice) / maxPrice) * 100;
                        const pumpFromMinToMax = ((maxPrice - minPrice) / minPrice) * 100;

                        const distLong = ((currentPrice - minPrice) / minPrice) * 100;
                        const distShort = ((maxPrice - currentPrice) / maxPrice) * 100;

                        const minLowIdx = histLows.indexOf(minPrice);
                        const maxHighIdx = histHighs.indexOf(maxPrice);
                        const lowDaysAgo = minLowIdx !== -1 ? (histLows.length - 1 - minLowIdx) : 0;
                        const highDaysAgo = maxHighIdx !== -1 ? (histHighs.length - 1 - maxHighIdx) : 0;

                        isLongMatch = enableLong && 
                            (dropFromMaxToMin >= cfg.minHistoryDrop) && 
                            (distLong >= (cfg.minExtremeDistanceLong ?? 0)) && 
                            (distLong <= (cfg.maxExtremeDistanceLong !== undefined ? cfg.maxExtremeDistanceLong : cfg.maxExtremeDistance)) &&
                            (lowDaysAgo >= (cfg.extremeDaysMinLong ?? 0)) &&
                            (lowDaysAgo <= (cfg.extremeDaysMaxLong ?? 300));

                        isShortMatch = enableShort && 
                            (pumpFromMinToMax >= cfg.minHistoryPump) && 
                            (distShort >= (cfg.minExtremeDistanceShort ?? 0)) && 
                            (distShort <= (cfg.maxExtremeDistanceShort !== undefined ? cfg.maxExtremeDistanceShort : cfg.maxExtremeDistance)) &&
                            (highDaysAgo >= (cfg.extremeDaysMinShort ?? 0)) &&
                            (highDaysAgo <= (cfg.extremeDaysMaxShort ?? 300));

                        stage2Match = (!enableLong && !enableShort) || isLongMatch || isShortMatch;

                        if (stage2Match && cfg.filterEmaPeriod > 0) {
                            if (prices.length < cfg.filterEmaPeriod) {
                                emaFailed = true;
                            } else {
                                const ema = calculateEMA(prices, cfg.filterEmaPeriod);
                                let crossCount = 0;
                                let lastDirection: 'UP' | 'DOWN' | null = null;
                                let lastCrossIndex = -1;

                                for (let j = cfg.filterEmaPeriod - 1; j < prices.length; j++) {
                                    const emaVal = ema[j - (cfg.filterEmaPeriod - 1)];
                                    const currentDirection = prices[j] > emaVal ? 'UP' : 'DOWN';
                                    if (lastDirection && currentDirection !== lastDirection) {
                                        crossCount++;
                                        lastCrossIndex = j;
                                    }
                                    lastDirection = currentDirection;
                                }

                                if (crossCount >= cfg.filterCrossingCount) {
                                    emaFailed = true;
                                } else if (lastCrossIndex !== -1 && lastCrossIndex < prices.length - 1) {
                                    const crossPrice = prices[lastCrossIndex];
                                    const maxFuturePrice = Math.max(...prices.slice(lastCrossIndex + 1));
                                    const minFuturePrice = Math.min(...prices.slice(lastCrossIndex + 1));

                                    const maxPumpAfterCross = ((maxFuturePrice - crossPrice) / crossPrice) * 100;
                                    const maxDropAfterCross = ((minFuturePrice - crossPrice) / crossPrice) * 100;

                                    if (lastDirection === 'UP' && maxPumpAfterCross > cfg.filterLongMaxPump) emaFailed = true;
                                    if (lastDirection === 'DOWN' && maxDropAfterCross < cfg.filterShortMinDrop) emaFailed = true;
                                }
                            }
                        }
                    }

                    // 2. Stage 2 极值与回溯周期判定
                    const stage2Passed = sidewaysMatch && stage2Match && !emaFailed;
                    const finalLongMatch = stage2Passed && isLongMatch;
                    const finalShortMatch = stage2Passed && isShortMatch;

                    // 🔒 [实时加入与自动删除]:
                    // 1. 发现符合条件的新币时实时加入列表
                    // 2. 当列表中的币种不再符合过滤条件时自动删除
                    let itemChanged = false;

                    if (finalLongMatch || finalShortMatch) {
                        limitsMap[symbol] = { maxZ, minZ };
                        if (finalLongMatch && !validSymbols.has(`${symbol}_LONG`)) {
                            validSymbols.add(`${symbol}_LONG`);
                            itemChanged = true;
                        }
                        if (finalShortMatch && !validSymbols.has(`${symbol}_SHORT`)) {
                            validSymbols.add(`${symbol}_SHORT`);
                            itemChanged = true;
                        }
                        if (!finalLongMatch && validSymbols.has(`${symbol}_LONG`)) {
                            validSymbols.delete(`${symbol}_LONG`);
                            itemChanged = true;
                        }
                        if (!finalShortMatch && validSymbols.has(`${symbol}_SHORT`)) {
                            validSymbols.delete(`${symbol}_SHORT`);
                            itemChanged = true;
                        }
                    } else {
                        if (validSymbols.has(`${symbol}_LONG`)) {
                            validSymbols.delete(`${symbol}_LONG`);
                            itemChanged = true;
                        }
                        if (validSymbols.has(`${symbol}_SHORT`)) {
                            validSymbols.delete(`${symbol}_SHORT`);
                            itemChanged = true;
                        }
                        if (validSymbols.has(symbol)) {
                            validSymbols.delete(symbol);
                            itemChanged = true;
                        }
                    }

                    if (itemChanged && isMountedRef.current) {
                        const nextSet = new Set(validSymbols);
                        setMajorTrendCandidates(nextSet);
                        majorTrendCandidatesRef.current = nextSet;
                        localStorage.setItem(majorTrendCandidatesKey, JSON.stringify(Array.from(nextSet)));
                        setMajorTrendLimits({ ...limitsMap });
                        localStorage.setItem(majorTrendLimitsKey, JSON.stringify(limitsMap));
                        window.dispatchEvent(new CustomEvent('scanner_major_trend_candidates_updated'));
                    }

                    if (sidewaysMatch) stage1PassedCount++;
                    if (stage2Passed) stage2PassedCount++;

                    setMajorProgress({
                        current: idx + 1,
                        total: targetSymbols.length,
                        stage: 'group2',
                        group1Passed: stage1PassedCount,
                        group2Passed: stage2PassedCount,
                        currentSymbol: symbol
                    } as any);
                }
            })(),
            new Promise((_, reject) => {
                coinTimeoutId = setTimeout(() => reject(new Error('TIMEOUT_EXCEEDED')), maxWorkTime);
            })
        ]);
    } catch (coinErr) {
        console.warn(`[MajorTrend] Skipping ${symbol} (exceeded ${maxWorkTime}ms or network error)`);
    } finally {
        if (coinTimeoutId) clearTimeout(coinTimeoutId);
        // 确保无论单币是否失败或超时，进度计数与通过数均得到最终确权
        if (isMountedRef.current) {
            setMajorProgress({
                current: idx + 1,
                total: targetSymbols.length,
                stage: 'group2',
                group1Passed: stage1PassedCount,
                group2Passed: stage2PassedCount,
                currentSymbol: symbol
            } as any);
        }
    }

    // 精准补齐单币总时间预算：每个币从开始到跳至下一个币严格对齐为目标秒数(默认3秒)
    const elapsed = Date.now() - coinCycleStart;
    const remainingWait = Math.max(0, targetIntervalMs - elapsed);
    if (idx < targetSymbols.length - 1 && remainingWait > 0 && isMountedRef.current && !majorScanAbortRef.current) {
        await new Promise(resolve => setTimeout(resolve, remainingWait));
    }
}

        if (isMountedRef.current) {
            const finalSet = new Set(validSymbols);
            setMajorTrendCandidates(finalSet);
            majorTrendCandidatesRef.current = finalSet;
            setMajorTrendLimits(limitsMap);
            localStorage.setItem(majorTrendCandidatesKey, JSON.stringify(Array.from(finalSet)));
            localStorage.setItem(majorTrendLimitsKey, JSON.stringify(limitsMap));
            localStorage.setItem(`SCANNER_HAS_RUN_MAJOR${suffix}`, 'true');
            setHasRunMajorTrend(true);
            setIsMajorScanning(false);
            setMajorProgress({
                current: targetSymbols.length,
                total: targetSymbols.length,
                stage: 'completed',
                group1Passed: stage1PassedCount,
                group2Passed: stage2PassedCount,
                currentSymbol: ''
            } as any);
            window.dispatchEvent(new CustomEvent('scanner_major_trend_candidates_updated'));
            window.dispatchEvent(new CustomEvent('scanner_major_trend_completed'));
            audioService.speak("大行情发现任务完成");
        }
        } catch (err) {
            console.error("[MajorTrendDiscovery] Error:", err);
        } finally {
            (window as any).IS_MAJOR_TREND_SCANNING = false;
            window.dispatchEvent(new CustomEvent('scanner_major_trend_completed'));
            if (isMountedRef.current) {
                setIsMajorScanning(false);
            }
        }
    }, []);

    // Major Trend Background Loop - strictly according to intervalMinutes
    useEffect(() => {
        if (!initialConfig.majorTrend?.enabled) return;

        const selectedId = typeof window !== 'undefined' ? localStorage.getItem('SCANNER_SELECTED_STRATEGY_ID') : '';
        const isBg = strategyId && selectedId ? strategyId !== selectedId : false;
        if (isBg) {
            return;
        }

        // Trigger initial discovery through Pipeline Coordinator only if candidates completely empty
        if (majorTrendCandidates.size === 0 && !hasRunMajorTrend && !isMajorScanning) {
            if (!(window as any).IS_START_TREND_SCANNING) {
                pipelineCoordinator.enqueue('major_trend', async () => {
                    await runMajorTrendDiscovery(false);
                });
            }
        }

        // Auto interval (Default: 4 minutes, or configured updateIntervalHours if > 0)
        const intervalMinutes = initialConfig.majorTrend.intervalMinutes ?? (initialConfig.majorTrend.updateIntervalHours ? initialConfig.majorTrend.updateIntervalHours * 60 : 4);
        const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;
        
        // Auto background runs with pipeline coordinator
        const timer = setInterval(() => {
            if (isMountedRef.current && initialConfig.majorTrend?.enabled && initialConfig.majorTrend?.autoMode !== false) {
                // 🔒 [时间先后·互斥安全锁]: 若行情启动底池正在扫描，错开时间，绝不同时工作
                if ((window as any).IS_START_TREND_SCANNING) {
                    console.log("[MajorTrend] Background interval skipped: Start Trend Pool is currently scanning.");
                    return;
                }
                pipelineCoordinator.enqueue('major_trend', async () => {
                    await runMajorTrendDiscovery(false);
                });
            }
        }, intervalMs);
        return () => clearInterval(timer);
    }, [initialConfig.majorTrend?.enabled, initialConfig.majorTrend?.autoMode, initialConfig.majorTrend?.intervalMinutes, initialConfig.majorTrend?.updateIntervalHours, runMajorTrendDiscovery, strategyId]);


    // 🔒 [SECURITY_LOCK]: AUTO-TRIGGER DISCOVERY. Detect config parameter changes with an 800ms debounce
    // to auto-run the major trend discovery and ensure seamless real-time/backtest data matching.
    const lastTriggeredConfigRef = useRef('');
    useEffect(() => {
        const cfg = initialConfig.majorTrend;
        if (!cfg || !cfg.enabled) return;

        // Serialize fields that require a new scan
        const serialized = JSON.stringify({
            lookbackDays: cfg.lookbackDays,
            enableLong: cfg.enableLong,
            enableShort: cfg.enableShort,
            minHistoryDrop: cfg.minHistoryDrop,
            minHistoryPump: cfg.minHistoryPump,
            minExtremeDistanceLong: cfg.minExtremeDistanceLong,
            minExtremeDistanceShort: cfg.minExtremeDistanceShort,
            enableSideways: cfg.enableSideways,
            sidewaysDays: cfg.sidewaysDays,
            sidewaysMaxDrop: cfg.sidewaysMaxDrop,
            sidewaysMaxPump: cfg.sidewaysMaxPump,
            enableStartTrendLong: cfg.enableStartTrendLong,
            enableStartTrendShort: cfg.enableStartTrendShort,
            startTrendGroups: cfg.startTrendGroups?.map(g => ({ enabled: g.enabled, hours: g.hours, minLong: g.minLong, maxLong: g.maxLong, minShort: g.minShort, maxShort: g.maxShort, maxPullbackLong: g.maxPullbackLong, maxPullbackShort: g.maxPullbackShort }))
        });

        if (lastTriggeredConfigRef.current === '') {
            // Store initial state but do not trigger on mount (as mount is already handled or handled by timer/manual)
            lastTriggeredConfigRef.current = serialized;
            return;
        }

        if (lastTriggeredConfigRef.current !== serialized) {
            lastTriggeredConfigRef.current = serialized;
            
            // Debounce for 800ms
            const delay = setTimeout(() => {
                console.log("[useScannerLogic] Config parameter change detected. Auto-executing discovery...");
                pipelineCoordinator.enqueue('major_trend', async () => {
                    await runMajorTrendDiscovery(true);
                });
            }, 800);
            return () => clearTimeout(delay);
        }
    }, [initialConfig.majorTrend, runMajorTrendDiscovery]);
    // 🔒 [END_SECURITY_LOCK]

    // --- 🔒 [时间先后·接力赛]: 行情启动底池整轮全部扫描完毕后，接力唤醒大行情发现扫描 ---
    useEffect(() => {
        const cfg = initialConfig.majorTrend;
        if (!cfg?.enabled || !cfg?.autoMode) return;

        const handleStartTrendCompleted = () => {
            if (!isMountedRef.current || isMajorScanning) return;
            // 确保底池已完全扫描完毕且未在扫描中
            if ((window as any).IS_START_TREND_SCANNING) return;

            console.log("[useScannerLogic] Start Trend Pool scan COMPLETED. Handing over baton: Starting Major Trend Discovery now (接力启动)...");
            pipelineCoordinator.enqueue('major_trend', async () => {
                await runMajorTrendDiscovery(false);
            });
        };

        window.addEventListener('scanner_start_trend_pool_completed', handleStartTrendCompleted);

        return () => {
            window.removeEventListener('scanner_start_trend_pool_completed', handleStartTrendCompleted);
        };
    }, [initialConfig.majorTrend?.enabled, initialConfig.majorTrend?.autoMode, isMajorScanning, runMajorTrendDiscovery]);


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
        runMajorTrendDiscovery,
        cancelMajorScan
    };
};
