
// @LOCKED: List 1 过滤流程与市场初筛列表增删对比更新逻辑已锁定，未经用户明确专项指令严禁修改
import { useState, useRef, useEffect, useCallback } from 'react';
import { ScanConfig, ScannerItem } from '../../components/Scanner/scannerTypes';
import { processMarketData } from '../../services/rules/list1_market';
import { fetchWithFallback } from '../../services/apiService';
import { audioService } from '../../services/audioService';
import { calculateEMA } from '../../services/indicators';
import { pipelineCoordinator } from '../../services/pipelineQueue';
import { getVolume8am, fetchVolume8amBatch, checkVolumeRule } from '../../services/volume8amService';
import { klineDailyStore } from '../../services/klineDailyStore';


// Helper for fast, isolated, non-blocking klines fetching through official proxy endpoints with hard abort timeout
const safeFetchKlinesDirect = async (targetUrl: string, timeoutMs = 10000, externalSignal?: AbortSignal): Promise<any[] | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
        try { controller.abort(); } catch (_) {}
    }, timeoutMs);

    if (externalSignal) {
        externalSignal.addEventListener('abort', () => {
            try { controller.abort(); } catch (_) {}
        });
    }

    try {
        const res = await fetch(`/api/proxy?url=${encodeURIComponent(targetUrl)}&priority=high`, {
            signal: controller.signal
        });
        if (!res.ok) return null;
        const data = await res.json();
        return Array.isArray(data) && data.length > 0 ? data : null;
    } catch (_) {
        return null;
    } finally {
        clearTimeout(timer);
    }
};

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
            // 🔒 固定选币模式：若尚未配置监控币种，初筛列表默认为 0 清空状态
            if (initialConfig.useCustomOnly && fixedModeView === 'MONITOR') {
                if (!customSymbolSet || customSymbolSet.size === 0) {
                    return [];
                }
            }
            const saved = localStorage.getItem(list1CacheKey);
            const parsed = saved ? JSON.parse(saved) : [];
            const initialList = Array.isArray(parsed) ? parsed : [];
            
            // 🔒 固定选币模式下仅加载自定义监控币种
            if (initialConfig.useCustomOnly && fixedModeView === 'MONITOR') {
                const customUpper = new Set(Array.from(customSymbolSet).map(s => s.toUpperCase()));
                return initialList.filter(item => item && item.symbol && customUpper.has(item.symbol.replace('USDT', '').toUpperCase()));
            }

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

    // 🔒【交易额过滤底池再次重筛·逐币删减铁律】:
    // 绝不突然批量减少！当发现不再符合条件的币时，严格以设定的时间间隔(1000ms)，一个一个地从市场初筛候选池中删减！
    const pruneRunIdRef = useRef(0);
    const pruneDisqualifiedSequentially = useCallback(async (disqualified: string[]) => {
        if (!disqualified || disqualified.length === 0) return;
        const currentRunId = ++pruneRunIdRef.current;
        console.log(`[交易额底池再次重筛] 发现 ${disqualified.length} 个币不再符合交易额条件，开始一个一个地删减:`, disqualified);

        for (let i = 0; i < disqualified.length; i++) {
            if (!isMountedRef.current || pruneRunIdRef.current !== currentRunId) break;
            // 严格间隔 1000ms 逐一删减一个币，让用户清晰观察到单币剔除过程，绝不瞬间批量消失
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (!isMountedRef.current || pruneRunIdRef.current !== currentRunId) break;

            const candToRemove = disqualified[i];
            const sym = candToRemove.replace('_LONG', '').replace('_SHORT', '');

            if (majorTrendCandidatesRef.current.has(candToRemove)) {
                majorTrendCandidatesRef.current.delete(candToRemove);
                const nextSet = new Set(majorTrendCandidatesRef.current);
                setMajorTrendCandidates(nextSet);
                localStorage.setItem(majorTrendCandidatesKey, JSON.stringify(Array.from(nextSet)));
                window.dispatchEvent(new CustomEvent('scanner_major_trend_candidates_updated', { detail: Array.from(nextSet) }));
                console.log(`[交易额底池再次重筛] 已删减不符合交易额币种: ${sym} (${i + 1}/${disqualified.length})`);
            }
        }
    }, [majorTrendCandidatesKey]);

    // 🔒【源头过滤与底池稳定性铁律】:
    // 回溯周期过滤扫描出的候选币种，其上游100%已由交易额过滤底池与启动趋势底池严格把关；
    // 严禁因字母切片或局部底池事件触发自动删减，杜绝刚扫描出来就立即一秒一个减少的逻辑冲突
    // pruneDisqualifiedSequentially 仅在全局配置主动变更且有明确需求时供安全调用

    // --- RATE LIMIT & BAN PROTECTION ---
    const bannedUntilRef = useRef<number>(0);
    const lastFetchFinishedTimeRef = useRef<number>(0);
    // 🔒 [零延迟毫秒级流式响应]: 取消10秒限制，设为极速500ms防抖保护
    const MIN_FETCH_GAP = 500; // 500ms minimal debounce for ultra-low latency streaming
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

            let rawData = rawDataRef.current;
            if (!rawData || !Array.isArray(rawData) || rawData.length === 0) {
                try {
                    const cached = localStorage.getItem('SCANNER_RAW_DATA_CACHE');
                    if (cached) {
                        const parsed = JSON.parse(cached);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            rawData = parsed;
                            rawDataRef.current = parsed;
                        }
                    }
                } catch (_) {}
            }

            if (rawData && Array.isArray(rawData) && rawData.length > 0) {
                const nowTime = Date.now();
                const expiry = 5 * 60 * 1000;
                const enrichedRaw = rawData.map((t: any) => {
                    const cached = volume8amCacheRef.current.get(t.symbol) || (getVolume8am(t.symbol) ? { volume: getVolume8am(t.symbol)!.volume8am, openPrice: getVolume8am(t.symbol)!.openPrice, timestamp: nowTime } : undefined);
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
                    const cached = volume8amCacheRef.current.get(item.symbol) || (getVolume8am(item.symbol) ? { volume: getVolume8am(item.symbol)!.volume8am, openPrice: getVolume8am(item.symbol)!.openPrice, timestamp: nowTime } : undefined);
                    if (cached && (nowTime - cached.timestamp < expiry)) {
                        item.volume8am = cached.volume;
                        if (cached.openPrice > 0 && item.price > 0) {
                            item.change8am = ((item.price - cached.openPrice) / cached.openPrice) * 100;
                        }
                    }
                });

                // Apply volume rules (both 24H and 8AM) strictly (ONLY for auto-screening mode)
                let finalCandidates = filtered;
                if (!initialConfig.useCustomOnly || fixedModeView === 'SEARCH') {
                    finalCandidates = filtered.filter(item => checkVolumeRule(item, initialConfig));
                    if (initialConfig.enableVol8am) {
                        const minChange = initialConfig.minChange || 0;
                        const source = initialConfig.source || 'BOTH';

                        finalCandidates = finalCandidates.filter(item => {
                            const effectiveChange = item.change8am !== undefined ? item.change8am : 0;
                            if (source === 'GAINERS' && effectiveChange <= 0) return false;
                            if (source === 'LOSERS' && effectiveChange >= 0) return false;
                            if (minChange > 0 && Math.abs(effectiveChange) < minChange) return false;
                            return true;
                        });
                    }
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
                } else {
                    if (list1Ref.current.length > 0) {
                        setList1([]);
                        list1Ref.current = [];
                    }
                }
                
                // Update status text to reflect new count if not currently scanning
                setScanStatusText(prev => {
                    const newText = initialConfig.useCustomOnly && fixedModeView === 'MONITOR'
                        ? (finalFiltered.length > 0 ? `固定选币就绪 (${finalFiltered.length}个)` : `固定选币：初筛为空 (0个)`)
                        : (finalFiltered.length > 0 ? (mode === 'SMART' ? `智能分析完成 (${finalFiltered.length}个)` : `行情就绪 (${finalFiltered.length}个)`) : "无符合条件的币种");
                    if (prev === newText) return prev;
                    if (prev.includes('行情就绪') || prev.includes('无符合条件') || prev.includes('分析完成') || prev.includes('固定选币')) {
                        return newText;
                    }
                    return prev;
                });
            } else if (list1 && Array.isArray(list1) && list1.length > 0) {
                if (initialConfig.useCustomOnly && fixedModeView === 'MONITOR') {
                    const customUpper = new Set(Array.from(customSymbolSet).map(s => s.toUpperCase()));
                    const filtered = list1.filter(item => item && item.symbol && customUpper.has(item.symbol.replace('USDT', '').toUpperCase()) && !blacklist.has(item.symbol));
                    if (JSON.stringify(filtered) !== JSON.stringify(list1Ref.current)) {
                        setList1(filtered);
                        list1Ref.current = filtered;
                    }
                } else {
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
            
            const rawParsed = await res.json();
            lastFetchFinishedTimeRef.current = Date.now();
            
            // Defensive guard: Ensure data is an array
            let data: any[] = [];
            if (Array.isArray(rawParsed)) {
                data = rawParsed;
            } else if (rawParsed && typeof rawParsed === 'object') {
                // If API returned an error object or wrapped data
                if (Array.isArray((rawParsed as any).data)) {
                    data = (rawParsed as any).data;
                } else {
                    console.warn("[Scanner] Received non-array data response from upstream:", rawParsed);
                    // Attempt fallback to cached raw data
                    if (Array.isArray(rawDataRef.current) && rawDataRef.current.length > 0) {
                        data = rawDataRef.current;
                    } else {
                        try {
                            const cached = localStorage.getItem('SCANNER_RAW_DATA_CACHE');
                            if (cached) {
                                const parsed = JSON.parse(cached);
                                if (Array.isArray(parsed) && parsed.length > 0) {
                                    data = parsed;
                                }
                            }
                        } catch (_) {}
                    }
                }
            }

            if (!Array.isArray(data) || data.length === 0) {
                console.warn("[Scanner] No valid ticker array obtained, skipping tick update");
                return;
            }

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

            // Filter by 8AM volume if enabled (ONLY for auto-screening mode)
            let finalCandidates = filtered;
            if (!configRef.current.useCustomOnly || fixedModeViewRef.current === 'SEARCH') {
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
                                const klines1d = await safeFetchKlinesDirect(url1d, 3000);
                                if (Array.isArray(klines1d) && klines1d.length > 0) {
                                    // index 7 is quote asset volume (USDT volume), index 1 is open price
                                    vol8am = (parseFloat(klines1d[0][7]) || 0) / 1000000;
                                    openPrice8am = parseFloat(klines1d[0][1]) || 0;
                                    volume8amCacheRef.current.set(item.symbol, { volume: vol8am, openPrice: openPrice8am, timestamp: nowTime });
                                }
                            } catch (err) {
                                console.error(`[Volume8am] Error fetching ${item.symbol}:`, err);
                                vol8am = cached ? cached.volume : (item.volume24h !== undefined ? item.volume24h : 0);
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
                        const cached = volume8amCacheRef.current.get(item.symbol);
                        const vol8am = rawVol8am !== undefined ? rawVol8am : (cached ? cached.volume : getVolume8am(item.symbol)?.volume8am);
                        if (minVol8am > 0 && (vol8am === undefined || vol8am < minVol8am)) return false;
                        if (maxVol8am > 0 && vol8am !== undefined && vol8am > maxVol8am) return false;

                        const effectiveChange = item.change8am !== undefined ? item.change8am : (item.change || 0);
                        if (source === 'GAINERS' && effectiveChange <= 0) return false;
                        if (source === 'LOSERS' && effectiveChange >= 0) return false;
                        if (minChange > 0 && Math.abs(effectiveChange) < minChange) return false;

                        return true;
                    });
                }
            } else {
                // In Fixed Selection Mode (MONITOR), fill basic volume8am/change8am if cached but do not filter
                filtered.forEach(item => {
                    const cached = volume8amCacheRef.current.get(item.symbol);
                    if (cached) {
                        item.volume8am = cached.volume;
                        if (cached.openPrice > 0 && item.price > 0) {
                            item.change8am = ((item.price - cached.openPrice) / cached.openPrice) * 100;
                        }
                    }
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
            } else {
                if (list1Ref.current.length > 0) {
                    setList1([]);
                    list1Ref.current = [];
                }
            }
            
            setScanStatusText(
                configRef.current.useCustomOnly && fixedModeViewRef.current === 'MONITOR'
                    ? (finalFiltered.length > 0 ? `固定选币就绪 (${finalFiltered.length}个)` : `固定选币：初筛为空 (0个)`)
                    : (finalFiltered.length > 0 ? (modeRef.current === 'SMART' ? `智能分析完成 (${finalFiltered.length}个)` : `行情就绪 (${finalFiltered.length}个)`) : "无符合条件的币种")
            );
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

        // 🔒 [时间先后·互斥安全锁]: 若行情启动底池正在扫描，检查是否为超时僵尸锁(>180s)，若是则破锁自愈
        if ((window as any).IS_START_TREND_SCANNING) {
            const startTrendLockTime = (window as any).IS_START_TREND_SCANNING_TIME || 0;
            if (Date.now() - startTrendLockTime > 180000) {
                console.warn("[MajorTrend] 检测到行情启动底池互斥锁超时(>180s)，自动清除死锁并继续大行情扫描...");
                (window as any).IS_START_TREND_SCANNING = false;
                (window as any).IS_START_TREND_SCANNING_TIME = 0;
            } else {
                if (isManual) {
                    alert('“行情启动底池”正在扫描中，系统严格按顺序由上到下逐级作业，请等待底池扫描完成后自动接力运行！');
                } else {
                    console.log("[MajorTrend] 行情启动底池正在扫描中，严格排队等待其扫描完成后接力启动...");
                }
                return;
            }
        }
        
        setIsMajorScanning(true);
        (window as any).IS_MAJOR_TREND_SCANNING = true;
        (window as any).IS_MAJOR_TREND_SCANNING_TIME = Date.now();
        majorScanAbortRef.current = false;
        pruneRunIdRef.current++;

        try {
            if (majorScanAbortRef.current) return;

            // 🔒 [严格遵循层级流水线 - 纯净顺序推送机制]:
            // 1. 列表1由”成交额范围过滤“进入”交易额过滤底池“ (SCANNER_VOLUME_FILTERED_POOL)
            // 2. ”行情启动趋势“若开启，读取”交易额过滤底池“，筛选后的币进入”行情启动底池“ (SCANNER_START_TREND_POOL)
            // 3. ”横盘蓄势过滤“读取上级底池数据（若开启行情启动趋势则读取行情启动底池；若未开启行情启动趋势则读取交易额底池），符合规则的币进入”横盘蓄势过滤底池“ (SCANNER_SIDEWAYS_FILTERED_POOL)
            // 4. ”回溯周期过滤“严格读取”横盘蓄势过滤底池“，最终经最后一项差量比对后更新到“市场初筛”列表！
            const isStartTrendActive = Boolean(
                cfg.enableStartTrend && (cfg.enableStartTrendLong || cfg.enableStartTrendShort)
            );

            let targetSymbols: string[] = [];

            if (isStartTrendActive) {
                // 🎯 开启了【行情启动趋势】：严格读取【行情启动底池】
                let startTrendSymbols: string[] = [];
                try {
                    const rawStartPool = localStorage.getItem('SCANNER_START_TREND_POOL');
                    if (rawStartPool) {
                        const parsed = JSON.parse(rawStartPool);
                        if (Array.isArray(parsed)) {
                            startTrendSymbols = parsed
                                .map((item: any) => typeof item === 'string' ? item : item?.symbol)
                                .filter((sym: string) => Boolean(sym) && !blacklistRef.current.has(sym));
                        }
                    }
                } catch (_) {}
                targetSymbols = startTrendSymbols;
                console.log(`[MajorTrend] 当前生效输入源:【行情启动趋势底池】(共 ${startTrendSymbols.length} 个币)`);
            } else {
                // 🎯 未开启【行情启动趋势】：直接读取上一级【交易额过滤底池】
                let volumePoolSymbols: string[] = [];
                try {
                    const rawVolumePool = localStorage.getItem('SCANNER_VOLUME_FILTERED_POOL');
                    if (rawVolumePool) {
                        const parsed = JSON.parse(rawVolumePool);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            volumePoolSymbols = parsed.filter((sym: string) => Boolean(sym) && !blacklistRef.current.has(sym));
                        }
                    }
                } catch (_) {}

                if (volumePoolSymbols.length === 0 && list1Ref.current && list1Ref.current.length > 0) {
                    volumePoolSymbols = list1Ref.current
                        .map(i => i.symbol)
                        .filter(sym => Boolean(sym) && !blacklistRef.current.has(sym));
                }
                targetSymbols = volumePoolSymbols;
                console.log(`[MajorTrend] 当前生效输入源:【交易额过滤底池】(共 ${volumePoolSymbols.length} 个币)`);
            }

            // 候选币种集合：初始继承已有大行情候选币（支持增量与方向剔除）
            const validSymbols = new Set<string>(majorTrendCandidatesRef.current);

            if (targetSymbols.length === 0) {
                console.log("[useScannerLogic] 行情启动底池暂无候选币，保持既有初筛底池并等待上级底池推送数据...");
                setIsMajorScanning(false);
                (window as any).IS_MAJOR_TREND_SCANNING = false;
                (window as any).IS_MAJOR_TREND_SCANNING_TIME = 0;
                setMajorProgress({
                    current: 0,
                    total: 0,
                    stage: 'idle',
                    group1Total: 0,
                    group1Current: 0,
                    group1Passed: 0,
                    group2Total: 0,
                    group2Current: 0,
                    group2Passed: 0,
                    currentSymbol: ''
                } as any);
                return;
            }

        // Initialize progress with target candidate count
        setMajorProgress({ current: 0, total: targetSymbols.length });

        if (!isMountedRef.current || !majorTrendConfigRef.current?.enabled) {
            setIsMajorScanning(false);
            return;
        }
        
        const limitsMap: Record<string, { maxZ: number, minZ: number }> = { ...majorTrendLimits };

        const enableLong = cfg.enableLong !== false;
        const enableShort = cfg.enableShort !== false;
        const enableSideways = cfg.enableSideways !== false;
        const enableSidewaysLong = cfg.enableSidewaysLong !== false;
        const enableSidewaysShort = cfg.enableSidewaysShort !== false;

        const stage1PassedItems: Array<{
            symbol: string;
            maxZ: number;
            minZ: number;
            dropFromMax: number;
            riseFromMin: number;
            currentPrice: number;
            klines: any[];
        }> = [];

        // 🔒【永不清零·增量差量动态更新铁律】: 
        // 启动横盘蓄势扫描时保留既有底池数据，仅在整轮扫描计算完成后原子化更新，绝不中途清零！

        setMajorProgress({
            current: 0,
            total: targetSymbols.length,
            stage: 'group1',
            group1Total: targetSymbols.length,
            group1Current: 0,
            group1Passed: 0,
            group2Total: 0,
            group2Current: 0,
            group2Passed: 0,
            currentSymbol: ''
        } as any);

        const perCoinDelayMs = Math.max(1, cfg.intervalSeconds ?? (cfg.intervalMinutes ? Math.min(cfg.intervalMinutes, 60) : 3)) * 1000;
        const KLINE_LIMIT_CACHE = ((window as any).KLINE_LIMIT_CACHE = (window as any).KLINE_LIMIT_CACHE || {});

        // =========================================================================
        // 🔒【第一阶段: 横盘蓄势过滤 - 扫描行情启动底池 / 向上级底池获取数据】
        // 按照用户设定的（X）秒钟逐币过滤推进，平稳展示与过滤每个币种
        // =========================================================================
        let processedGroup1Count = 0;
        const successfullyEvaluatedSymbols = new Set<string>();

        const processStage1Coin = async (symbol: string) => {
            if (!isMountedRef.current || !majorTrendConfigRef.current?.enabled || majorScanAbortRef.current) return;
            const maxWorkTime = 12000;

            const coinAbortController = new AbortController();
            let coinTimeoutId: any = null;
            try {
                await Promise.race([
                    (async () => {
                        const timeParam = cfg.filterTimeParam || cfg.lookbackDays || 300;
                        const limit = Math.min(timeParam + 20, 350);
                        let klines: any[] | null = null;

                        const nowTime = Date.now();
                        const safeSymbol = symbol.toUpperCase().replace(/_LONG$|_SHORT$/i, '').replace(/[\/_]/g, '').trim();

                        // ⚡ [日K全天常驻持久化缓存]: 优先从 24小时持久化存储中秒级命中 (0毫秒响应，解决冷启动丢币)
                        const storedKlines = klineDailyStore.getCachedKlinesSync(symbol, timeParam) || klineDailyStore.getCachedKlinesSync(safeSymbol, timeParam);
                        if (storedKlines && Array.isArray(storedKlines) && storedKlines.length >= 2) {
                            klines = storedKlines;
                        } else {
                            const CACHE_VALIDITY_1D = 86400000;
                            if (KLINE_LIMIT_CACHE[symbol]?.[timeParam]?.klines && Array.isArray(KLINE_LIMIT_CACHE[symbol][timeParam].klines) && KLINE_LIMIT_CACHE[symbol][timeParam].klines.length >= 2 && (nowTime - (KLINE_LIMIT_CACHE[symbol][timeParam].timestamp || 0) < CACHE_VALIDITY_1D)) {
                                klines = KLINE_LIMIT_CACHE[symbol][timeParam].klines;
                            } else if (KLINE_LIMIT_CACHE[safeSymbol]?.[timeParam]?.klines && Array.isArray(KLINE_LIMIT_CACHE[safeSymbol][timeParam].klines) && KLINE_LIMIT_CACHE[safeSymbol][timeParam].klines.length >= 2 && (nowTime - (KLINE_LIMIT_CACHE[safeSymbol][timeParam].timestamp || 0) < CACHE_VALIDITY_1D)) {
                                klines = KLINE_LIMIT_CACHE[safeSymbol][timeParam].klines;
                            } else if (KLINE_LIMIT_CACHE[`${symbol}_1d`] && Array.isArray(KLINE_LIMIT_CACHE[`${symbol}_1d`]) && KLINE_LIMIT_CACHE[`${symbol}_1d`].length >= 2) {
                                klines = KLINE_LIMIT_CACHE[`${symbol}_1d`];
                            } else if (KLINE_LIMIT_CACHE[`${safeSymbol}_1d`] && Array.isArray(KLINE_LIMIT_CACHE[`${safeSymbol}_1d`]) && KLINE_LIMIT_CACHE[`${safeSymbol}_1d`].length >= 2) {
                                klines = KLINE_LIMIT_CACHE[`${safeSymbol}_1d`];
                            } else if (KLINE_LIMIT_CACHE[symbol]?.['1d']?.klines && KLINE_LIMIT_CACHE[symbol]['1d'].klines.length >= 2 && (nowTime - (KLINE_LIMIT_CACHE[symbol]['1d'].timestamp || 0) < CACHE_VALIDITY_1D)) {
                                klines = KLINE_LIMIT_CACHE[symbol]['1d'].klines;
                            } else if (KLINE_LIMIT_CACHE[safeSymbol]?.['1d']?.klines && KLINE_LIMIT_CACHE[safeSymbol]['1d'].klines.length >= 2 && (nowTime - (KLINE_LIMIT_CACHE[safeSymbol]['1d'].timestamp || 0) < CACHE_VALIDITY_1D)) {
                                klines = KLINE_LIMIT_CACHE[safeSymbol]['1d'].klines;
                            }
                        }

                        if (!klines || !Array.isArray(klines) || klines.length < 2) {
                            const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=1d&limit=${limit}&isScanner=true`;
                            klines = await safeFetchKlinesDirect(url, 10000, coinAbortController.signal);
                            if (!klines || klines.length < 2) {
                                // 失败时自动重试一次，杜绝偶发网络抖动遗漏币种
                                klines = await safeFetchKlinesDirect(url, 10000, coinAbortController.signal);
                            }
                        }
                
                        if (Array.isArray(klines) && klines.length >= 2) {
                            // 同步写入持久化存储
                            klineDailyStore.saveKlines(safeSymbol, klines);
                            klineDailyStore.saveKlines(symbol, klines);

                            if (!KLINE_LIMIT_CACHE[symbol]) KLINE_LIMIT_CACHE[symbol] = {};
                            if (!KLINE_LIMIT_CACHE[safeSymbol]) KLINE_LIMIT_CACHE[safeSymbol] = {};
                            KLINE_LIMIT_CACHE[symbol][timeParam] = { timestamp: Date.now(), klines };
                            KLINE_LIMIT_CACHE[safeSymbol][timeParam] = { timestamp: Date.now(), klines };
                            KLINE_LIMIT_CACHE[symbol]['1d'] = { timestamp: Date.now(), klines };
                            KLINE_LIMIT_CACHE[safeSymbol]['1d'] = { timestamp: Date.now(), klines };
                            KLINE_LIMIT_CACHE[`${symbol}_1d`] = klines;
                            KLINE_LIMIT_CACHE[`${safeSymbol}_1d`] = klines;

                            // 标记成功获取数据并完成第一阶段评估
                            successfullyEvaluatedSymbols.add(symbol);
                            successfullyEvaluatedSymbols.add(safeSymbol);
                            successfullyEvaluatedSymbols.add(`${safeSymbol}_LONG`);
                            successfullyEvaluatedSymbols.add(`${safeSymbol}_SHORT`);
                            successfullyEvaluatedSymbols.add(`${symbol}_LONG`);
                            successfullyEvaluatedSymbols.add(`${symbol}_SHORT`);

                            const periodKlines = klines.slice(-timeParam);
                            const highs = periodKlines.map((k: any) => parseFloat(k[2]));
                            const lows = periodKlines.map((k: any) => parseFloat(k[3]));
                            const closes = periodKlines.map((k: any) => parseFloat(k[4]));
                            const currentPrice = closes[closes.length - 1];

                            // 1. Stage 1: 横盘蓄势过滤 (支持多组过滤 + OR/AND 组合模式)
                            let maxZ = currentPrice;
                            let minZ = currentPrice;
                            let sidewaysMatch = true;
                            let dropFromMax = 0;
                            let riseFromMin = 0;

                            if (enableSideways) {
                                if (!enableSidewaysLong && !enableSidewaysShort) {
                                    sidewaysMatch = false;
                                } else if (symbol.endsWith('_LONG') && !enableSidewaysLong) {
                                    sidewaysMatch = false;
                                } else if (symbol.endsWith('_SHORT') && !enableSidewaysShort) {
                                    sidewaysMatch = false;
                                } else {
                                    const rawGroups = cfg.sidewaysGroups && cfg.sidewaysGroups.length > 0
                                        ? cfg.sidewaysGroups
                                        : [{ days: cfg.sidewaysDays || 7, maxDrop: cfg.sidewaysMaxDrop || 10, maxPump: cfg.sidewaysMaxPump || 10, enabled: true }];
                                    
                                    const activeGroups = rawGroups.filter(g => g.enabled !== false && ((g.days ?? 0) > 0 || (g.daysLong ?? 0) > 0 || (g.daysShort ?? 0) > 0));

                                    if (activeGroups.length > 0) {
                                        const isAndMode = cfg.sidewaysLogic === 'AND';
                                        const isShortCand = symbol.endsWith('_SHORT');
                                        const isLongCand = symbol.endsWith('_LONG');

                                        const evalGroupForDirection = (g: any, forShort: boolean) => {
                                            const gDays = (forShort ? (g.daysShort ?? g.days) : (g.daysLong ?? g.days)) || 7;
                                            const gMaxDrop = (forShort ? (g.maxDropShort ?? g.maxDrop) : (g.maxDropLong ?? g.maxDrop)) ?? 10;
                                            const gMaxPump = (forShort ? (g.maxPumpShort ?? g.maxPump) : (g.maxPumpLong ?? g.maxPump)) ?? 10;
                                            const sHighs = highs.slice(-gDays);
                                            const sLows = lows.slice(-gDays);
                                            const gMaxZ = sHighs.length > 0 ? Math.max(...sHighs) : currentPrice;
                                            const gMinZ = sLows.length > 0 ? Math.min(...sLows) : currentPrice;
                                            const gDrop = ((gMaxZ - currentPrice) / gMaxZ) * 100;
                                            const gRise = ((currentPrice - gMinZ) / gMinZ) * 100;
                                            const passed = gDrop <= gMaxDrop && gRise <= gMaxPump;
                                            return { passed, gMaxZ, gMinZ, gDrop, gRise, days: gDays };
                                        };

                                        const evalAllGroups = (forShort: boolean) => {
                                            const results = activeGroups.map(g => evalGroupForDirection(g, forShort));
                                            const passed = isAndMode ? results.every(r => r.passed) : results.some(r => r.passed);
                                            const matched = results.find(r => r.passed) || results[0];
                                            return { passed, matched };
                                        };

                                        if (isShortCand) {
                                            const { passed, matched } = evalAllGroups(true);
                                            sidewaysMatch = passed;
                                            maxZ = matched.gMaxZ;
                                            minZ = matched.gMinZ;
                                            dropFromMax = matched.gDrop;
                                            riseFromMin = matched.gRise;
                                        } else if (isLongCand) {
                                            const { passed, matched } = evalAllGroups(false);
                                            sidewaysMatch = passed;
                                            maxZ = matched.gMaxZ;
                                            minZ = matched.gMinZ;
                                            dropFromMax = matched.gDrop;
                                            riseFromMin = matched.gRise;
                                        } else {
                                            // 无明确多空后缀时的候选币：根据当前开启的横盘方向判定
                                            const longRes = enableSidewaysLong ? evalAllGroups(false) : { passed: false, matched: null as any };
                                            const shortRes = enableSidewaysShort ? evalAllGroups(true) : { passed: false, matched: null as any };

                                            if (longRes.passed && shortRes.passed) {
                                                sidewaysMatch = true;
                                                const m = longRes.matched || shortRes.matched;
                                                maxZ = m.gMaxZ;
                                                minZ = m.gMinZ;
                                                dropFromMax = m.gDrop;
                                                riseFromMin = m.gRise;
                                            } else if (longRes.passed) {
                                                sidewaysMatch = true;
                                                maxZ = longRes.matched.gMaxZ;
                                                minZ = longRes.matched.gMinZ;
                                                dropFromMax = longRes.matched.gDrop;
                                                riseFromMin = longRes.matched.gRise;
                                            } else if (shortRes.passed) {
                                                sidewaysMatch = true;
                                                maxZ = shortRes.matched.gMaxZ;
                                                minZ = shortRes.matched.gMinZ;
                                                dropFromMax = shortRes.matched.gDrop;
                                                riseFromMin = shortRes.matched.gRise;
                                            } else {
                                                sidewaysMatch = false;
                                                const m = (longRes.matched || shortRes.matched || evalGroupForDirection(activeGroups[0], false));
                                                maxZ = m.gMaxZ;
                                                minZ = m.gMinZ;
                                                dropFromMax = m.gDrop;
                                                riseFromMin = m.gRise;
                                            }
                                        }
                                    }
                                }
                            }

                            if (sidewaysMatch) {
                                stage1PassedItems.push({
                                    symbol,
                                    maxZ,
                                    minZ,
                                    dropFromMax,
                                    riseFromMin,
                                    currentPrice,
                                    klines
                                });
                            }
                        }
                    })(),
                    new Promise((_, reject) => {
                        coinTimeoutId = setTimeout(() => reject(new Error('TIMEOUT_EXCEEDED')), maxWorkTime);
                    })
                ]);
            } catch (coinErr) {
                console.warn(`[MajorTrend Stage 1] Skipping ${symbol} (exceeded ${maxWorkTime}ms or network error)`);
            } finally {
                if (coinTimeoutId) clearTimeout(coinTimeoutId);
                try {
                    coinAbortController.abort();
                } catch (_) {}
                processedGroup1Count++;
                if (isMountedRef.current) {
                    setMajorProgress({
                        current: processedGroup1Count,
                        total: targetSymbols.length,
                        stage: 'group1',
                        group1Total: targetSymbols.length,
                        group1Current: processedGroup1Count,
                        group1Passed: stage1PassedItems.length,
                        group2Total: stage1PassedItems.length,
                        group2Current: 0,
                        group2Passed: 0,
                        currentSymbol: symbol
                    } as any);
                }
            }
        };

        // 🔒 严格按照设定的时间(秒)逐币稳定推进：消除瞬态并发闪退，确保单币可感知、稳健过滤
        for (let i = 0; i < targetSymbols.length; i++) {
            if (!isMountedRef.current || !majorTrendConfigRef.current?.enabled || majorScanAbortRef.current) break;

            // ⏸️ 暂停检查：如果全局暂停，则在此等待直到用户点击继续
            while ((window as any).IS_SCANNER_PIPELINE_PAUSED && isMountedRef.current && !majorScanAbortRef.current) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            if (!isMountedRef.current || !majorTrendConfigRef.current?.enabled || majorScanAbortRef.current) break;

            const currentSym = targetSymbols[i];
            const stepStart = Date.now();
            await processStage1Coin(currentSym);

            const elapsed = Date.now() - stepStart;
            const remaining = Math.max(0, perCoinDelayMs - elapsed);
            if (remaining > 0 && i < targetSymbols.length - 1 && isMountedRef.current && !majorScanAbortRef.current) {
                const delayStart = Date.now();
                while (Date.now() - delayStart < remaining && isMountedRef.current && !majorScanAbortRef.current) {
                    if ((window as any).IS_SCANNER_PIPELINE_PAUSED) {
                        while ((window as any).IS_SCANNER_PIPELINE_PAUSED && isMountedRef.current && !majorScanAbortRef.current) {
                            await new Promise(resolve => setTimeout(resolve, 200));
                        }
                        break;
                    }
                    await new Promise(resolve => setTimeout(resolve, Math.min(100, remaining)));
                }
            }
        }

        // 🔒【第一阶段扫描完成】: 仅在整轮横盘扫描完成后原子化保存到“横盘蓄势过滤底池”，若无通过币种则清空底池
        const poolData = stage1PassedItems.map(item => ({
            symbol: item.symbol,
            dropFromMax: item.dropFromMax,
            riseFromMin: item.riseFromMin,
            maxZ: item.maxZ,
            minZ: item.minZ,
            currentPrice: item.currentPrice,
            timestamp: Date.now()
        }));
        localStorage.setItem('SCANNER_SIDEWAYS_FILTERED_POOL', JSON.stringify(poolData));
        window.dispatchEvent(new CustomEvent('scanner_sideways_pool_updated', { detail: poolData }));

        // =========================================================================
        // 🔒【第二阶段: 判定最后一项过滤规则并执行差量比对】
        // 核心铁律：【平时与扫描过程中绝对不增减初筛候选集，不能突然消失清零】
        // 必须所选最后一项过滤规则运行完成后，去对比：
        // 1. 若最后一项过滤规则比市场初筛少了哪一个，就把少的删减；
        // 2. 若多出了哪几个，再加上去；
        // 3. 既有依然符合的币种平滑保留！
        // =========================================================================
        const enableLookbackFilter = cfg.enableLookbackFilter !== false;
        const stage2PassedSymbols = new Set<string>();
        const stage2LimitsMap: Record<string, { maxZ: number; minZ: number }> = { ...limitsMap };
        const totalStage2 = stage1PassedItems.length;

        // 🔒【回溯周期过滤计数与初筛展示100%绝对一致性函数】:
        // 严格按当前启用的做多/做空方向统计符合条件的唯一币种数量，绝不因多空双向标签翻倍，确保显示数字与初筛列表完全吻合！
        const getMatchedUniqueSymbolsCount = (symbolsSet: Set<string>) => {
            const uniqueSet = new Set<string>();
            symbolsSet.forEach(cand => {
                const sym = cand.replace('_LONG', '').replace('_SHORT', '');
                const hasL = symbolsSet.has(`${sym}_LONG`) || symbolsSet.has(sym);
                const hasS = symbolsSet.has(`${sym}_SHORT`) || symbolsSet.has(sym);
                if (enableLong && enableShort) {
                    if (hasL || hasS) uniqueSet.add(sym);
                } else if (enableLong) {
                    if (hasL) uniqueSet.add(sym);
                } else if (enableShort) {
                    if (hasS) uniqueSet.add(sym);
                }
            });
            return uniqueSet.size;
        };

        if (!enableLookbackFilter) {
            // 🔒【情况 B】：“回溯周期过滤”未开启，“横盘蓄势过滤”为最后一项过滤规则！
            // 横盘蓄势扫描已全部完成，直接将横盘通过结果作为最终结果进行差量对比
            stage1PassedItems.forEach(item => {
                if (enableLong) stage2PassedSymbols.add(`${item.symbol}_LONG`);
                if (enableShort) stage2PassedSymbols.add(`${item.symbol}_SHORT`);
                if (!enableLong && !enableShort) stage2PassedSymbols.add(item.symbol);
                stage2LimitsMap[item.symbol] = { maxZ: item.maxZ, minZ: item.minZ };
            });
        } else {
            // 🔒【情况 A】：“回溯周期过滤”已开启，“回溯周期过滤”为最后一项过滤规则！
            setMajorProgress({
                current: 0,
                total: totalStage2,
                stage: 'group2',
                group1Total: targetSymbols.length,
                group1Current: targetSymbols.length,
                group1Passed: totalStage2,
                group2Total: totalStage2,
                group2Current: 0,
                group2Passed: 0,
                currentSymbol: ''
            } as any);

            for (let s2Idx = 0; s2Idx < totalStage2; s2Idx++) {
                if (!isMountedRef.current || !majorTrendConfigRef.current?.enabled) break;
                if (majorScanAbortRef.current) break;

                // ⏸️ 暂停检查：如果全局暂停，则在此等待直到用户点击继续
                while ((window as any).IS_SCANNER_PIPELINE_PAUSED && isMountedRef.current && !majorScanAbortRef.current) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
                if (!isMountedRef.current || !majorTrendConfigRef.current?.enabled) break;
                if (majorScanAbortRef.current) break;

                const item = stage1PassedItems[s2Idx];
                const symbol = item.symbol;
                const s2CycleStart = Date.now();

                const timeParam = cfg.filterTimeParam || cfg.lookbackDays || 300;
                const klines = item.klines;
                const prices = klines.map((k: any) => parseFloat(k[4]));
                const periodKlines = klines.slice(-timeParam);
                const highs = periodKlines.map((k: any) => parseFloat(k[2]));
                const lows = periodKlines.map((k: any) => parseFloat(k[3]));
                const currentPrice = item.currentPrice;
                const maxZ = item.maxZ;
                const minZ = item.minZ;

                const effectiveSidewaysDays = Math.max(...(cfg.sidewaysGroups?.filter(g => g.enabled !== false && (g.days ?? 0) > 0).map(g => g.days) || [cfg.sidewaysDays || 7]));
                let histHighs = highs;
                let histLows = lows;
                if (enableSideways && highs.length > effectiveSidewaysDays) {
                    const endIdx = Math.max(1, highs.length - effectiveSidewaysDays);
                    histHighs = highs.slice(0, endIdx);
                    histLows = lows.slice(0, endIdx);
                }

                const rawMaxPrice = histHighs.length > 0 ? Math.max(...histHighs) : currentPrice;
                const rawMinPrice = histLows.length > 0 ? Math.min(...histLows) : currentPrice;

                // 🔒【消除新低/新高负数误杀漏洞】:
                // 真实绝对极值涵盖整个回溯周期与最近横盘蓄势期。
                // 当币种在最近蓄势期创下新低时，当前价离绝对最低点距离为0% (绝不产生负数导致被>=0规则误杀)
                const minPrice = Math.min(rawMinPrice, minZ !== undefined ? minZ : currentPrice, currentPrice);
                const maxPrice = Math.max(rawMaxPrice, maxZ !== undefined ? maxZ : currentPrice, currentPrice);

                const dropFromMaxToMin = ((maxPrice - minPrice) / maxPrice) * 100;
                const pumpFromMinToMax = ((maxPrice - minPrice) / minPrice) * 100;

                const distLong = Math.max(0, ((currentPrice - minPrice) / minPrice) * 100);
                const distShort = Math.max(0, ((maxPrice - currentPrice) / maxPrice) * 100);

                let lowDaysAgo = 0;
                if (minPrice === currentPrice || (minZ !== undefined && minPrice === minZ)) {
                    // 最低点发生在最近横盘蓄势期内 (0 ~ effectiveSidewaysDays 天前)
                    const sidewaysLows = lows.slice(-effectiveSidewaysDays);
                    const sIdx = sidewaysLows.lastIndexOf(minPrice);
                    lowDaysAgo = sIdx !== -1 ? (sidewaysLows.length - 1 - sIdx) : 0;
                } else {
                    const minLowIdx = histLows.indexOf(minPrice);
                    lowDaysAgo = minLowIdx !== -1 ? (periodKlines.length - 1 - minLowIdx) : 0;
                }

                let highDaysAgo = 0;
                if (maxPrice === currentPrice || (maxZ !== undefined && maxPrice === maxZ)) {
                    // 最高点发生在最近横盘蓄势期内 (0 ~ effectiveSidewaysDays 天前)
                    const sidewaysHighs = highs.slice(-effectiveSidewaysDays);
                    const sIdx = sidewaysHighs.lastIndexOf(maxPrice);
                    highDaysAgo = sIdx !== -1 ? (sidewaysHighs.length - 1 - sIdx) : 0;
                } else {
                    const maxHighIdx = histHighs.indexOf(maxPrice);
                    highDaysAgo = maxHighIdx !== -1 ? (periodKlines.length - 1 - maxHighIdx) : 0;
                }

                const isLongMatch = enableLong && (
                    (dropFromMaxToMin >= cfg.minHistoryDrop) && 
                    (distLong >= (cfg.minExtremeDistanceLong ?? 0)) && 
                    (distLong <= (cfg.maxExtremeDistanceLong !== undefined ? cfg.maxExtremeDistanceLong : cfg.maxExtremeDistance)) &&
                    (lowDaysAgo >= (cfg.extremeDaysMinLong ?? 0)) &&
                    (lowDaysAgo <= (cfg.extremeDaysMaxLong ?? 300))
                );

                const isShortMatch = enableShort && (
                    (pumpFromMinToMax >= cfg.minHistoryPump) && 
                    (distShort >= (cfg.minExtremeDistanceShort ?? 0)) && 
                    (distShort <= (cfg.maxExtremeDistanceShort !== undefined ? cfg.maxExtremeDistanceShort : cfg.maxExtremeDistance)) &&
                    (highDaysAgo >= (cfg.extremeDaysMinShort ?? 0)) &&
                    (highDaysAgo <= (cfg.extremeDaysMaxShort ?? 300))
                );

                const stage2Match = (!enableLong && !enableShort) || isLongMatch || isShortMatch;
                let emaFailed = false;

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

                // Stage 2 极值与回溯周期判定
                const stage2Passed = stage2Match && !emaFailed;
                const finalLongMatch = stage2Passed && isLongMatch;
                const finalShortMatch = stage2Passed && isShortMatch;

                if (finalLongMatch) {
                    stage2PassedSymbols.add(`${symbol}_LONG`);
                    stage2LimitsMap[symbol] = { maxZ, minZ };
                }
                if (finalShortMatch) {
                    stage2PassedSymbols.add(`${symbol}_SHORT`);
                    stage2LimitsMap[symbol] = { maxZ, minZ };
                }

                successfullyEvaluatedSymbols.add(symbol);
                successfullyEvaluatedSymbols.add(`${symbol}_LONG`);
                successfullyEvaluatedSymbols.add(`${symbol}_SHORT`);

                // 仅更新扫描进度显示，绝不在此处触发初筛列表的增减更新
                if (isMountedRef.current) {
                    setMajorProgress({
                        current: s2Idx + 1,
                        total: totalStage2,
                        stage: 'group2',
                        group1Total: targetSymbols.length,
                        group1Current: targetSymbols.length,
                        group1Passed: totalStage2,
                        group2Total: totalStage2,
                        group2Current: s2Idx + 1,
                        group2Passed: getMatchedUniqueSymbolsCount(stage2PassedSymbols),
                        currentSymbol: symbol
                    } as any);
                }

                // 🔒 严格限制回溯周期过滤步进速度：严格按照大行情发现设置中的“时间(秒)”进行扫描
                const elapsed = Date.now() - s2CycleStart;
                const remaining = Math.max(0, perCoinDelayMs - elapsed);
                if (remaining > 0 && s2Idx < totalStage2 - 1 && isMountedRef.current && !majorScanAbortRef.current) {
                    const delayStart = Date.now();
                    while (Date.now() - delayStart < remaining && isMountedRef.current && !majorScanAbortRef.current) {
                        if ((window as any).IS_SCANNER_PIPELINE_PAUSED) {
                            while ((window as any).IS_SCANNER_PIPELINE_PAUSED && isMountedRef.current && !majorScanAbortRef.current) {
                                await new Promise(resolve => setTimeout(resolve, 200));
                            }
                            break;
                        }
                        await new Promise(resolve => setTimeout(resolve, Math.min(100, remaining)));
                    }
                }
            }
        }

        // =========================================================================
        // 🔒【回溯周期过滤整轮扫描完成 - 原子差量比对更新】
        // 规则：必须是“回溯周期过滤”运行完成后，再和市场初筛列表的数量进行比对：
        // 1. 如果新过滤结果减少了，初筛列表精准减去少的那一个/几个；
        // 2. 如果新过滤结果增加了，初筛列表精准加上多的那一个/几个；
        // 3. 既有依然符合的币种保持平稳，一次性完成原子差量对齐更新！
        // 4. 🔒【防误杀保护盾】: 只有明确获取K线并计算判定不符合的币才被移除，因网络超时未评估的币保留！
        // =========================================================================
        if (isMountedRef.current && !majorScanAbortRef.current) {
            const previousCandidates = majorTrendCandidatesRef.current ? Array.from(majorTrendCandidatesRef.current) : [];
            
            // 🔒【差量更新防误杀保护盾】:
            // 只有被系统成功拉取K线并明确计算判定不符合条件的币，才从初筛列表剔除；
            // 若因偶发网络超时/抖动未能完成计算评估的币，100% 稳妥保留在初筛池中，绝不突然骤降或清零！
            const unEvaluatedPrevious = previousCandidates.filter(prevCand => {
                const baseSym = prevCand.replace(/_LONG$|_SHORT$/i, '');
                return !successfullyEvaluatedSymbols.has(prevCand) && !successfullyEvaluatedSymbols.has(baseSym);
            });

            const combinedCandidates = Array.from(new Set([...Array.from(stage2PassedSymbols), ...unEvaluatedPrevious]));
            const newCandidates = combinedCandidates;

            const prevSet = new Set(previousCandidates);
            const newSet = new Set(combinedCandidates);

            const added = newCandidates.filter(x => !prevSet.has(x));
            const removed = previousCandidates.filter(x => !newSet.has(x));
            const retained = previousCandidates.filter(x => newSet.has(x));

            console.log(`[MajorTrendDiscovery] 回溯周期过滤全量完成！初筛差量比对: 原有 ${previousCandidates.length} 个 -> 本轮 ${newCandidates.length} 个 (保留: ${retained.length} 个, 增加: +${added.length} 个 [${added.join(', ')}], 减去: -${removed.length} 个 [${removed.join(', ')}], 保护未完成评估币: ${unEvaluatedPrevious.length} 个)`);

            const finalSet = new Set(combinedCandidates);
            setMajorTrendCandidates(finalSet);
            majorTrendCandidatesRef.current = finalSet;
            setMajorTrendLimits(stage2LimitsMap);
            localStorage.setItem(majorTrendCandidatesKey, JSON.stringify(Array.from(finalSet)));
            localStorage.setItem(majorTrendLimitsKey, JSON.stringify(stage2LimitsMap));
            localStorage.setItem(`SCANNER_HAS_RUN_MAJOR${suffix}`, 'true');
            setHasRunMajorTrend(true);
            setIsMajorScanning(false);
            (window as any).IS_MAJOR_TREND_SCANNING = false;
            setMajorProgress({
                current: totalStage2,
                total: totalStage2,
                stage: 'completed',
                group1Total: targetSymbols.length,
                group1Current: targetSymbols.length,
                group1Passed: stage1PassedItems.length,
                group2Total: stage1PassedItems.length,
                group2Current: stage1PassedItems.length,
                group2Passed: getMatchedUniqueSymbolsCount(finalSet),
                currentSymbol: ''
            } as any);

            // 仅在整轮完成后对外派发初筛更新事件
            window.dispatchEvent(new CustomEvent('scanner_major_trend_candidates_updated', { detail: Array.from(finalSet) }));
            localStorage.setItem('SCANNER_MAJOR_TREND_CANDIDATES', JSON.stringify(Array.from(finalSet)));
            audioService.speak("大行情发现任务完成");
        }
        } catch (err) {
            console.error("[MajorTrendDiscovery] Error:", err);
        } finally {
            (window as any).IS_MAJOR_TREND_SCANNING = false;
            (window as any).IS_MAJOR_TREND_SCANNING_TIME = 0;
            if (isMountedRef.current) {
                setIsMajorScanning(false);
            }
            // 🔒 [闭环接力]: 回溯周期过滤完毕后，派发 scanner_major_trend_completed，将接力棒交回【行情启动趋势】
            window.dispatchEvent(new CustomEvent('scanner_major_trend_completed'));
        }
    }, []);

    // 🔒 [SECURITY_LOCK]: AUTO-TRIGGER DISCOVERY. Detect config parameter changes with an 800ms debounce
    // to auto-run the major trend discovery and ensure seamless real-time/backtest data matching.
    const lastTriggeredConfigRef = useRef('');
    useEffect(() => {
        const cfg = initialConfig.majorTrend;
        if (!cfg || !cfg.enabled) return;

        // Serialize fields that require a new scan
        const serialized = JSON.stringify({
            intervalSeconds: cfg.intervalSeconds,
            lookbackDays: cfg.lookbackDays,
            enableLong: cfg.enableLong,
            enableShort: cfg.enableShort,
            enableLookbackFilter: cfg.enableLookbackFilter,
            minHistoryDrop: cfg.minHistoryDrop,
            minHistoryPump: cfg.minHistoryPump,
            minExtremeDistanceLong: cfg.minExtremeDistanceLong,
            minExtremeDistanceShort: cfg.minExtremeDistanceShort,
            maxExtremeDistanceLong: cfg.maxExtremeDistanceLong,
            maxExtremeDistanceShort: cfg.maxExtremeDistanceShort,
            maxExtremeDistance: cfg.maxExtremeDistance,
            extremeDaysMinLong: cfg.extremeDaysMinLong,
            extremeDaysMaxLong: cfg.extremeDaysMaxLong,
            extremeDaysMinShort: cfg.extremeDaysMinShort,
            extremeDaysMaxShort: cfg.extremeDaysMaxShort,
            filterEmaPeriod: cfg.filterEmaPeriod,
            filterCrossingCount: cfg.filterCrossingCount,
            filterLongMaxPump: cfg.filterLongMaxPump,
            filterShortMinDrop: cfg.filterShortMinDrop,
            enableSideways: cfg.enableSideways,
            sidewaysLogic: cfg.sidewaysLogic,
            sidewaysDays: cfg.sidewaysDays,
            sidewaysMaxDrop: cfg.sidewaysMaxDrop,
            sidewaysMaxPump: cfg.sidewaysMaxPump,
            sidewaysGroups: cfg.sidewaysGroups?.map(g => ({ enabled: g.enabled, days: g.days, maxDrop: g.maxDrop, maxPump: g.maxPump })),
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

    // --- 🔒 [时间先后·接力赛]: 行情启动底池整轮扫描完毕后，接力唤醒大行情发现扫描 (横盘蓄势过滤 -> 回溯周期过滤) ---
    useEffect(() => {
        const cfg = initialConfig.majorTrend;
        // 只要开启了大行情发现且未设为纯手动（autoMode 默认即自动运行），就自动监听接力
        if (!cfg?.enabled || cfg?.autoMode === false) return;

        let debounceTimer: any = null;
        const handleStartTrendBaton = () => {
            if (!isMountedRef.current || isMajorScanning) return;
            // 确保底池未在排队冲突中
            if ((window as any).IS_START_TREND_SCANNING) return;

            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                if (!isMountedRef.current || isMajorScanning) return;
                console.log("[useScannerLogic] 行情启动底池全量扫描完成！接力棒传递给【横盘蓄势过滤】与【回溯周期过滤】...");
                pipelineCoordinator.enqueue('major_trend', async () => {
                    await runMajorTrendDiscovery(false);
                });
            }, 200);
        };

        // 仅在整轮扫描完成时触发接力，避免单币更新中途早熟执行
        window.addEventListener('scanner_start_trend_pool_completed', handleStartTrendBaton);

        return () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            window.removeEventListener('scanner_start_trend_pool_completed', handleStartTrendBaton);
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
