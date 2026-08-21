
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Loader2, AlertTriangle, RotateCw, Maximize2, Upload, Download, Plus, Trash2, Edit3, Check, X as XIcon, Zap, ArrowUpDown } from 'lucide-react';
import { fetchWithFallback } from '../../../services/apiService';
import { StrategyItem } from '../../../types';
import { ScanConfig, ScannerItem, COLUMN_WIDTH_CLASS } from '../../../components/Scanner/scannerTypes';
import { List1Control } from './Control';
import { List1Item } from './Item';
import { ScannerVisualizerModal } from '../../../components/ScannerVisualizerModal';

interface Props {
    scanConfig: ScanConfig;
    setScanConfig: React.Dispatch<React.SetStateAction<ScanConfig>>;
    isScanning: boolean;
    scanStatusText: string;
    isPaused: boolean;
    setIsPaused: (v: boolean) => void;
    list1: ScannerItem[];
    onScan: () => void;
    nextScanTime?: number; 
    fixedModeView: 'MONITOR' | 'SEARCH';
    setFixedModeView: (v: 'MONITOR' | 'SEARCH') => void;
    scanInterval: number;
    setScanInterval: (v: number) => void;
    customSymbolSet: Set<string>;
    onToggleSymbol: (symbol: string) => void;
    onSelectAll: () => void;
    onDeselectAll: () => void;
    onDeleteSymbol: (symbol: string) => void;
    onClearBlacklist: () => void;
    marketStats: any;
    setChartData: (data: any) => void;
    mode?: 'LIVE' | 'BACKTEST' | 'SMART';
    downloadProgressMap?: Record<string, number>;
    onDownload?: (symbol: string) => void;
    // New Props
    scannerMode?: 'LIVE' | 'BACKTEST' | 'SMART';
    setScannerMode?: (mode: 'LIVE' | 'BACKTEST' | 'SMART') => void;
    // Major Trend Props
    isMajorScanning?: boolean;
    majorProgress?: { current: number, total: number };
    runMajorTrendDiscovery?: () => void;
    cancelMajorScan?: () => void;
    backtestProps?: {
        speed: number;
        setSpeed: (s: number) => void;
        intervals: string[];
        setIntervals: (tf: string[]) => void;
        isPlaying: boolean;
        onStart: () => void;
        onStop: () => void;
        downloadRange: { start: string, end: string };
        setDownloadRange: (range: { start: string, end: string }) => void;
        onDownload: () => void;
        isDownloading: boolean;
        syncProgress: { current: number, total: number, percent: number } | null;
        virtualTime: number;
        customSymbols: string;
        setCustomSymbols: (s: string) => void;
        useCustomOnly: boolean;
        setUseCustomOnly: (v: boolean) => void;
    };
    // Strategy Props
    strategies?: StrategyItem[];
    selectedStrategyId?: string;
    activeStrategyId?: string;
    onSelectStrategy?: (id: string) => void;
    onAddStrategy?: () => void;
    onDeleteStrategy?: (id: string) => void;
    onRenameStrategy?: (id: string, name: string) => void;
    onExportStrategy?: (id: string) => void;
    onImportStrategy?: (id: string, file: File) => void;
    isRotationEnabled?: boolean;
    rotationIntervalMinutes?: number;
    rotationTimeLeft?: number;
    onToggleRotation?: (enabled: boolean) => void;
    onChangeRotationInterval?: (minutes: number) => void;
    majorTrendCandidates?: Set<string>;
    onFilteredUpdate?: (list: ScannerItem[]) => void;
    directMode?: boolean;
}

const List1_Selection: React.FC<Props> = ({ 
    scanConfig, setScanConfig, isScanning, scanStatusText, isPaused, setIsPaused, list1, onScan, 
    fixedModeView, setFixedModeView, scanInterval, setScanInterval, customSymbolSet,
    onToggleSymbol, onSelectAll, onDeselectAll, onDeleteSymbol, onClearBlacklist, marketStats, nextScanTime, setChartData,
    mode = 'LIVE', downloadProgressMap = {}, onDownload,
    scannerMode, setScannerMode, isMajorScanning, majorProgress, runMajorTrendDiscovery, cancelMajorScan, backtestProps,
    strategies = [], selectedStrategyId = '', activeStrategyId = '', onSelectStrategy = () => {}, onAddStrategy = () => {}, onDeleteStrategy = () => {}, onRenameStrategy = () => {}, onExportStrategy, onImportStrategy,
    isRotationEnabled = false,
    rotationIntervalMinutes = 5,
    rotationTimeLeft = 0,
    onToggleRotation = () => {},
    onChangeRotationInterval = () => {},
    majorTrendCandidates = new Set(),
    onFilteredUpdate,
    directMode
}) => {
    const [showVisualizer, setShowVisualizer] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');

    const handleSaveRename = (id: string) => {
        if (editName.trim()) {
            onRenameStrategy(id, editName.trim());
        }
        setEditingId(null);
    };

    // --- 📊 List 1 Smart Multi-Sorting States & Logic ---
    const [activeSorts, setActiveSorts] = useState<number[]>([]); // active sort criteria IDs: 1, 2, or 3
    const [sortOrders, setSortOrders] = useState<Record<number, 'asc' | 'desc'>>({
        1: 'desc',
        2: 'desc',
        3: 'desc'
    });

    const [metricsCache, setMetricsCache] = useState<Record<string, {
        maxDeclinePct: number;
        maxIncreasePct: number;
        lowToCurrentIncreasePct: number;
        highToCurrentDeclinePct: number;
        lowDaysAgo: number;
        highDaysAgo: number;
        isSidewaysMatch?: boolean;
        startTrendValid?: boolean;
        startTrendValidLong?: boolean;
        startTrendValidShort?: boolean;
        loading: boolean;
        minPeriodLow?: number;
        maxPeriodHigh?: number;
    }>>({});

    // 🌊 行情启动底池数据监听 (用于当未开启大行情发现时，市场初筛列表直接展示行情启动底池里的币)
    const [startTrendPool, setStartTrendPool] = useState<any[]>(() => {
        try {
            const raw = localStorage.getItem('SCANNER_START_TREND_POOL');
            return raw ? JSON.parse(raw) : [];
        } catch (_) {
            return [];
        }
    });

    useEffect(() => {
        const handleUpdate = () => {
            try {
                const raw = localStorage.getItem('SCANNER_START_TREND_POOL');
                setStartTrendPool(raw ? JSON.parse(raw) : []);
            } catch (_) {}
        };
        window.addEventListener('storage', handleUpdate);
        window.addEventListener('scanner_start_trend_pool_updated', handleUpdate);
        const timer = setInterval(handleUpdate, 2000);
        return () => {
            window.removeEventListener('storage', handleUpdate);
            window.removeEventListener('scanner_start_trend_pool_updated', handleUpdate);
            clearInterval(timer);
        };
    }, []);

    const lookbackDays = scanConfig.majorTrend?.lookbackDays || 300;
    const enableLong = scanConfig.majorTrend?.enableLong !== false;
    const enableShort = scanConfig.majorTrend?.enableShort !== false;

    let isLong = (scanConfig.instantOpenDirection || 'LONG') === 'LONG';
    if (scanConfig.majorTrend?.enabled) {
        if (enableLong && !enableShort) {
            isLong = true;
        } else if (!enableLong && enableShort) {
            isLong = false;
        }
    }

    const list1Ref = useRef(list1);
    useEffect(() => {
        list1Ref.current = list1;
    }, [list1]);

    const metricsCacheRef = useRef(metricsCache);
    useEffect(() => {
        metricsCacheRef.current = metricsCache;
    }, [metricsCache]);

    // 🔒 [SECURITY_LOCK]: DO NOT RESET FULL CACHE EXCEPT WHEN LOOKBACK DAYS CHANGE to ensure warm cache hit-rates.
    const lastLookbackDaysRef = useRef(lookbackDays);
    const majorTrendConfigStr = JSON.stringify({
        ...scanConfig.majorTrend,
        lookbackDays: undefined
    });
    const lastMajorTrendConfigStrRef = useRef(majorTrendConfigStr);

    useEffect(() => {
        if (lastLookbackDaysRef.current !== lookbackDays) {
            lastLookbackDaysRef.current = lookbackDays;
            metricsCacheRef.current = {};
            setMetricsCache({});
        } else if (lastMajorTrendConfigStrRef.current !== majorTrendConfigStr) {
            lastMajorTrendConfigStrRef.current = majorTrendConfigStr;
            setMetricsCache(prev => {
                const updated = { ...prev };
                Object.keys(updated).forEach(symbol => {
                    updated[symbol] = {
                        ...updated[symbol],
                        startTrendValidLong: undefined,
                        startTrendValidShort: undefined,
                    };
                });
                metricsCacheRef.current = updated;
                return updated;
            });
        }
    }, [majorTrendConfigStr, lookbackDays]);
    // 🔒 [END_SECURITY_LOCK]

    const fetchingSymbolsRef = useRef<Set<string>>(new Set());

    const list1SymbolsStr = list1.map(item => item.symbol).join(',');

    useEffect(() => {
        let active = true;
        const limit = lookbackDays + 20;

        const fetchMetricsForList = async () => {
            const KLINE_LIMIT_CACHE = (window as any).KLINE_LIMIT_CACHE = (window as any).KLINE_LIMIT_CACHE || {};

            const currentList = list1Ref.current;
            const symbolsToFetch = currentList.filter(item => {
                const symbol = item.symbol;
                if (!symbol) return false;

                // Optimize: If majorTrend is enabled and candidates exist, only fetch metrics for coins that are in majorTrendCandidates
                if (scanConfig.majorTrend?.enabled && majorTrendCandidates && majorTrendCandidates.size > 0 && !isMajorScanning) {
                    const keySuffix = isLong ? '_LONG' : '_SHORT';
                    const key = `${symbol}${keySuffix}`;
                    if (!majorTrendCandidates.has(key)) {
                        return false; // Skip this coin entirely from kline fetching!
                    }
                }

                // Skip if already computed and not loading, unless trend validation fields are undefined
                const cachedMetrics = metricsCacheRef.current[symbol];
                if (cachedMetrics && !cachedMetrics.loading) {
                    const hasTrendActive = scanConfig.majorTrend?.enableStartTrendLong || scanConfig.majorTrend?.enableStartTrendShort;
                    if (!hasTrendActive || (cachedMetrics.startTrendValidLong !== undefined && cachedMetrics.startTrendValidShort !== undefined)) {
                        return false;
                    }
                }

                // Skip if already being fetched
                if (fetchingSymbolsRef.current.has(symbol)) {
                    return false;
                }

                return true;
            });

            if (symbolsToFetch.length === 0) return;

            // Mark all as fetching
            symbolsToFetch.forEach(item => fetchingSymbolsRef.current.add(item.symbol));

            // Fetch concurrently with Promise.all
            await Promise.all(symbolsToFetch.map(async (item) => {
                if (!active) return;
                const symbol = item.symbol;

                try {
                    const now = Date.now();
                    let data: any[] | null = null;

                    const cached = KLINE_LIMIT_CACHE[symbol]?.[lookbackDays];
                    if (cached && now - cached.timestamp < 10 * 60 * 1000) {
                        data = cached.klines;
                    } else {
                        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=${limit}`;
                        const res = await fetchWithFallback(url, { timeout: 15000 }, (d) => Array.isArray(d), directMode);
                        data = await res.json();
                        if (Array.isArray(data)) {
                            if (!KLINE_LIMIT_CACHE[symbol]) {
                                KLINE_LIMIT_CACHE[symbol] = {};
                            }
                            KLINE_LIMIT_CACHE[symbol][lookbackDays] = {
                                timestamp: now,
                                klines: data
                            };
                        }
                    }

                    if (Array.isArray(data) && active) {
                        const periodKlines = data.slice(-lookbackDays);
                        const highs = periodKlines.map((k: any) => parseFloat(k[2]));
                        const lows = periodKlines.map((k: any) => parseFloat(k[3]));

                        const currentPrice = item.price;
                        const enableSideways = scanConfig.majorTrend?.enabled && scanConfig.majorTrend?.enableSideways !== false;
                        const sidewaysDays = scanConfig.majorTrend?.sidewaysDays ?? 7;

                        let histHighs = highs;
                        let histLows = lows;
                        if (enableSideways && highs.length > sidewaysDays) {
                            const endIdx = Math.max(1, highs.length - sidewaysDays);
                            histHighs = highs.slice(0, endIdx);
                            histLows = lows.slice(0, endIdx);
                        }

                        const maxPeriodHigh = histHighs.length > 0 ? Math.max(...histHighs) : currentPrice;
                        const minPeriodLow = histLows.length > 0 ? Math.min(...histLows) : currentPrice;

                        const safeNum = (v: number) => (isNaN(v) || !isFinite(v)) ? 0 : v;
                        const maxDeclinePct = safeNum(maxPeriodHigh > 0 ? ((minPeriodLow - maxPeriodHigh) / maxPeriodHigh) * 100 : 0);
                        const highToCurrentDeclinePct = safeNum(maxPeriodHigh > 0 ? ((currentPrice - maxPeriodHigh) / maxPeriodHigh) * 100 : 0);
                        const maxIncreasePct = safeNum(minPeriodLow > 0 ? ((maxPeriodHigh - minPeriodLow) / minPeriodLow) * 100 : 0);
                        const lowToCurrentIncreasePct = safeNum(minPeriodLow > 0 ? ((currentPrice - minPeriodLow) / minPeriodLow) * 100 : 0);

                        const minLowIdx = histLows.indexOf(minPeriodLow);
                        const maxHighIdx = histHighs.indexOf(maxPeriodHigh);

                        const lowDaysAgo = minLowIdx !== -1 ? (periodKlines.length - 1 - minLowIdx) : 0;
                        const highDaysAgo = maxHighIdx !== -1 ? (periodKlines.length - 1 - maxHighIdx) : 0;

                        let isSidewaysMatch = true;
                        if (enableSideways && highs.length > sidewaysDays) {
                            const sidewaysHighs = highs.slice(-sidewaysDays);
                            const sidewaysLows = lows.slice(-sidewaysDays);
                            const maxZ = sidewaysHighs.length > 0 ? Math.max(...sidewaysHighs) : currentPrice;
                            const minZ = sidewaysLows.length > 0 ? Math.min(...sidewaysLows) : currentPrice;

                            const dropFromMax = ((maxZ - currentPrice) / maxZ) * 100;
                            const riseFromMin = ((currentPrice - minZ) / minZ) * 100;

                            if (dropFromMax >= (scanConfig.majorTrend?.sidewaysMaxDrop ?? 10) || 
                                riseFromMin >= (scanConfig.majorTrend?.sidewaysMaxPump ?? 10)) {
                                isSidewaysMatch = false;
                            }
                        }

                        // 1h K-line starting trend calculations on the fly
                        const startTrendGroups = scanConfig.majorTrend?.startTrendGroups || [];
                        const enableStartTrendLong = scanConfig.majorTrend?.enableStartTrendLong;
                        const enableStartTrendShort = scanConfig.majorTrend?.enableStartTrendShort;
                        const hasActiveGroups = startTrendGroups.some(g => g.enabled);

                        let startTrendValidLong = true;
                        let startTrendValidShort = true;

                        if ((enableStartTrendLong || enableStartTrendShort) && hasActiveGroups) {
                            try {
                                const activeGroups = startTrendGroups.map((g, idx) => ({ ...g, idx })).filter(g => g.enabled);
                                // 🔒 [SECURITY_LOCK]: KEEP LIMIT1H FIXED AT 100 TO MAXIMIZE CACHE HIT-RATES ACROSS DIFFERENT TIME COMBINATIONS
                                const limit1h = 100; // Fixed large limit to maximize cache hits
                                // 🔒 [END_SECURITY_LOCK]
                                
                                let klines1h: any[] | null = null;
                                const cached1h = KLINE_LIMIT_CACHE[symbol]?.[`1h_${limit1h}`];
                                if (cached1h && now - cached1h.timestamp < 3 * 60 * 1000) {
                                    klines1h = cached1h.klines;
                                } else {
                                    const url1h = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=${limit1h}`;
                                    const res1h = await fetchWithFallback(url1h, { timeout: 10000 }, (d) => Array.isArray(d), directMode);
                                    klines1h = await res1h.json();
                                    if (Array.isArray(klines1h)) {
                                        if (!KLINE_LIMIT_CACHE[symbol]) {
                                            KLINE_LIMIT_CACHE[symbol] = {};
                                        }
                                        KLINE_LIMIT_CACHE[symbol][`1h_${limit1h}`] = {
                                            timestamp: now,
                                            klines: klines1h
                                        };
                                    }
                                }

                                if (Array.isArray(klines1h) && klines1h.length > 0) {
                                    const last1hPrice = parseFloat(klines1h[klines1h.length - 1][4]);
                                    if (!isNaN(last1hPrice) && last1hPrice > 0) {
                                        let isLongTrendValid = false;
                                        let isShortTrendValid = false;

                                        for (const group of activeGroups) {
                                            const groupDays = group.days !== undefined ? group.days : (group.idx === 0 ? 1 : (group.idx === 1 ? 2 : (group.idx === 2 ? 3 : 7)));
                                            const requiredHours = groupDays * 24;

                                            if (klines1h.length < requiredHours) {
                                                continue;
                                            }

                                            const lastHCandles = klines1h.slice(-requiredHours);

                                            if (enableStartTrendLong) {
                                                const periodLows = lastHCandles.map((k: any) => parseFloat(k[3])).filter(val => !isNaN(val) && val > 0);
                                                const periodHighs = lastHCandles.map((k: any) => parseFloat(k[2])).filter(val => !isNaN(val) && val > 0);
                                                if (periodLows.length > 0 && periodHighs.length > 0) {
                                                    const periodMinLow = Math.min(...periodLows);
                                                    const periodMaxHigh = Math.max(...periodHighs);
                                                    const baseOpen = parseFloat(lastHCandles[0][1]);
                                                    
                                                    const changePct = ((last1hPrice - baseOpen) / baseOpen) * 100;
                                                    const changePctFromLow = ((last1hPrice - periodMinLow) / periodMinLow) * 100;
                                                    const effectiveChange = Math.max(changePct, changePctFromLow);
                                                    
                                                    const pullbackPct = ((periodMaxHigh - last1hPrice) / periodMaxHigh) * 100;
                                                    const maxPullbackLong = group.maxPullbackLong !== undefined ? group.maxPullbackLong : 5;
                                                    
                                                    if (!isNaN(effectiveChange) && effectiveChange >= group.minLong && effectiveChange <= group.maxLong && !isNaN(pullbackPct) && pullbackPct <= maxPullbackLong) {
                                                        isLongTrendValid = true;
                                                    }
                                                }
                                            }

                                            if (enableStartTrendShort) {
                                                const periodHighs = lastHCandles.map((k: any) => parseFloat(k[2])).filter(val => !isNaN(val) && val > 0);
                                                const periodLows = lastHCandles.map((k: any) => parseFloat(k[3])).filter(val => !isNaN(val) && val > 0);
                                                if (periodHighs.length > 0 && periodLows.length > 0) {
                                                    const periodMaxHigh = Math.max(...periodHighs);
                                                    const periodMinLow = Math.min(...periodLows);
                                                    const baseOpen = parseFloat(lastHCandles[0][1]);
                                                    
                                                    const dropPct = ((baseOpen - last1hPrice) / baseOpen) * 100;
                                                    const dropPctFromHigh = ((periodMaxHigh - last1hPrice) / periodMaxHigh) * 100;
                                                    const effectiveDrop = Math.max(dropPct, dropPctFromHigh);
                                                    
                                                    const bouncePct = ((last1hPrice - periodMinLow) / periodMinLow) * 100;
                                                    const maxPullbackShort = group.maxPullbackShort !== undefined ? group.maxPullbackShort : 5;
                                                    
                                                    if (!isNaN(effectiveDrop) && effectiveDrop >= group.minShort && effectiveDrop <= group.maxShort && !isNaN(bouncePct) && bouncePct <= maxPullbackShort) {
                                                        isShortTrendValid = true;
                                                    }
                                                }
                                            }
                                        }

                                        startTrendValidLong = enableStartTrendLong ? isLongTrendValid : true;
                                        startTrendValidShort = enableStartTrendShort ? isShortTrendValid : true;
                                    } else {
                                        startTrendValidLong = !enableStartTrendLong;
                                        startTrendValidShort = !enableStartTrendShort;
                                    }
                                } else {
                                    startTrendValidLong = !enableStartTrendLong;
                                    startTrendValidShort = !enableStartTrendShort;
                                }
                            } catch (err1h) {
                                console.error("[StartTrend list views] Fetch 1h error: ", err1h);
                                startTrendValidLong = true;
                                startTrendValidShort = true;
                            }
                        }

                        setMetricsCache(prev => ({
                            ...prev,
                            [symbol]: {
                                maxDeclinePct,
                                maxIncreasePct,
                                lowToCurrentIncreasePct,
                                highToCurrentDeclinePct,
                                lowDaysAgo,
                                highDaysAgo,
                                isSidewaysMatch,
                                startTrendValidLong,
                                startTrendValidShort,
                                loading: false,
                                minPeriodLow,
                                maxPeriodHigh
                            }
                        }));
                    }
                    fetchingSymbolsRef.current.delete(symbol);
                } catch (err) {
                    console.error("Failed to fetch metrics in list view for " + symbol, err);
                    fetchingSymbolsRef.current.delete(symbol);
                    setMetricsCache(prev => ({
                        ...prev,
                        [symbol]: {
                            ...(prev[symbol] || {
                                maxDeclinePct: 0,
                                maxIncreasePct: 0,
                                lowToCurrentIncreasePct: 0,
                                highToCurrentDeclinePct: 0,
                                lowDaysAgo: 0,
                                highDaysAgo: 0,
                            }),
                            loading: false
                        }
                    }));
                }
            }));
        };

        fetchMetricsForList();

        return () => {
            active = false;
        };
    }, [list1SymbolsStr, lookbackDays, majorTrendConfigStr]);

    const getSortValue = (item: ScannerItem, criterionId: number) => {
        const metrics = metricsCache[item.symbol];
        if (!metrics) return 0;

        if (criterionId === 1) {
            return isLong ? Math.abs(metrics.maxDeclinePct) : Math.abs(metrics.maxIncreasePct);
        } else if (criterionId === 2) {
            const currentPrice = item.price;
            const minLow = metrics.minPeriodLow || currentPrice;
            const maxHigh = metrics.maxPeriodHigh || currentPrice;
            const liveLowToCurrentIncrease = minLow > 0 ? ((currentPrice - minLow) / minLow) * 100 : 0;
            const liveHighToCurrentDecline = maxHigh > 0 ? ((currentPrice - maxHigh) / maxHigh) * 100 : 0;
            return isLong ? liveLowToCurrentIncrease : Math.abs(liveHighToCurrentDecline);
        } else if (criterionId === 3) {
            return isLong ? metrics.lowDaysAgo : metrics.highDaysAgo;
        }
        return 0;
    };

    const sortedList1 = [...list1].sort((a, b) => {
        if (activeSorts.length === 0) return 0;

        for (const sortId of activeSorts) {
            const valA = getSortValue(a, sortId);
            const valB = getSortValue(b, sortId);

            if (valA !== valB) {
                const order = sortOrders[sortId] || 'desc';
                if (order === 'asc') {
                    return valA < valB ? -1 : 1;
                } else {
                    return valA > valB ? -1 : 1;
                }
            }
        }
        return 0;
    });

    const filteredList = useMemo(() => {
        // CASE 1: 没开“大行情发现”时（即配置A常规模式），市场初筛列表直接由 sortedList1（已应用 涨幅榜/跌幅榜/全部、成交额范围、涨跌幅阈值）决定
        if (!scanConfig.majorTrend?.enabled) {
            return sortedList1;
        }

        // CASE 2: 开启了“大行情发现”过滤规则时，市场初筛列表显示“大行情发现”过滤筛选过的币
        const cfg = (scanConfig.majorTrend || {}) as any;
        const enableLong = cfg.enableLong !== false;
        const enableShort = cfg.enableShort !== false;
        const enableSideways = cfg.enableSideways !== false;

        const hasCandidates = majorTrendCandidates && majorTrendCandidates.size > 0;

        return sortedList1.filter(item => {
            // 🔒 [SECURITY_LOCK]: PRIORITY CANDIDATE PRECHECK. Skip any symbol not discovered by background major scan immediately
            // to prevent the list from inflating when metric caches are undefined or loading.
            if (hasCandidates) {
                const keySuffix = isLong ? '_LONG' : '_SHORT';
                const key = `${item.symbol}${keySuffix}`;
                if (!majorTrendCandidates.has(key)) {
                    return false;
                }
            }
            // 🔒 [END_SECURITY_LOCK]

            const metrics = metricsCache[item.symbol];
            if (!metrics) return true; // Keep loading items visible
            if (metrics.loading) return true; // Keep loading items visible

            const currentPrice = item.price;

            if (isLong) {
                // 做多方向
                if (!enableLong) return false;

                // 1. 最小历史跌幅 (maxDeclinePct is negative, e.g. -50%)
                const minHistoryDrop = cfg.minHistoryDrop ?? 50;
                if (Math.abs(metrics.maxDeclinePct) < minHistoryDrop) return false;

                // 2. 距离极点比例 (lowToCurrentIncreasePct)
                const minLow = metrics.minPeriodLow || currentPrice;
                const liveLowToCurrentIncrease = minLow > 0 ? ((currentPrice - minLow) / minLow) * 100 : 0;

                const minExtremeDistanceLong = cfg.minExtremeDistanceLong ?? 0;
                const maxExtremeDistanceLong = cfg.maxExtremeDistanceLong !== undefined 
                    ? cfg.maxExtremeDistanceLong 
                    : (cfg.maxExtremeDistance ?? 5);
                if (liveLowToCurrentIncrease < minExtremeDistanceLong || 
                    liveLowToCurrentIncrease > maxExtremeDistanceLong) {
                    return false;
                }

                // 3. 极点天数 (lowDaysAgo)
                const extremeDaysMinLong = cfg.extremeDaysMinLong ?? 0;
                const extremeDaysMaxLong = cfg.extremeDaysMaxLong ?? 300;
                if (metrics.lowDaysAgo < extremeDaysMinLong || 
                    metrics.lowDaysAgo > extremeDaysMaxLong) {
                    return false;
                }
            } else {
                // 做空方向
                if (!enableShort) return false;

                // 1. 最小历史涨幅 (maxIncreasePct)
                const minHistoryPump = cfg.minHistoryPump ?? 100;
                if (metrics.maxIncreasePct < minHistoryPump) return false;

                // 2. 距离极点比例 (highToCurrentDeclinePct is negative, e.g. -5%)
                const maxHigh = metrics.maxPeriodHigh || currentPrice;
                const liveHighToCurrentDecline = maxHigh > 0 ? ((currentPrice - maxHigh) / maxHigh) * 100 : 0;

                const minExtremeDistanceShort = cfg.minExtremeDistanceShort ?? 0;
                const maxExtremeDistanceShort = cfg.maxExtremeDistanceShort !== undefined 
                    ? cfg.maxExtremeDistanceShort 
                    : (cfg.maxExtremeDistance ?? 5);
                const distShort = Math.abs(liveHighToCurrentDecline);
                if (distShort < minExtremeDistanceShort || distShort > maxExtremeDistanceShort) {
                    return false;
                }

                // 3. 极点天数 (highDaysAgo)
                const extremeDaysMinShort = cfg.extremeDaysMinShort ?? 0;
                const extremeDaysMaxShort = cfg.extremeDaysMaxShort ?? 300;
                if (metrics.highDaysAgo < extremeDaysMinShort || 
                    metrics.highDaysAgo > extremeDaysMaxShort) {
                    return false;
                }
            }

            // 4. 横盘整理过滤
            if (enableSideways) {
                if (metrics.isSidewaysMatch === false) return false;
            }

            // 5. 行情启动趋势过滤 (Start Trend Filter)
            if (isLong) {
                if (scanConfig.majorTrend?.enableStartTrendLong) {
                    if (metrics.startTrendValidLong === false) return false;
                }
            } else {
                if (scanConfig.majorTrend?.enableStartTrendShort) {
                    if (metrics.startTrendValidShort === false) return false;
                }
            }

            return true;
        });
    }, [sortedList1, scanConfig.majorTrend, isLong, metricsCache, majorTrendCandidates, startTrendPool]);

    const lastFilteredStrRef = useRef('');

    useEffect(() => {
        if (onFilteredUpdate) {
            const str = filteredList.map(i => i.symbol).join(',');
            if (str !== lastFilteredStrRef.current) {
                lastFilteredStrRef.current = str;
                onFilteredUpdate(filteredList);
            }
        }
    }, [filteredList, onFilteredUpdate]);

    return (
        <div className={`flex flex-col h-full bg-slate-900 border-r border-slate-800 flex-1 min-w-[380px] overflow-y-auto custom-scrollbar`}>
            {/* 🎯 多策略并发监控控制面板 */}
            <div className="p-3 bg-slate-950/60 border-b border-slate-800 space-y-2 shrink-0">
                <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-indigo-400 flex items-center gap-1.5 uppercase tracking-wider">
                        <Zap size={11} className="text-indigo-400 animate-pulse fill-indigo-400/20" /> 多策略并发监控
                    </span>
                    {/* Export / Import Strategy config */}
                    <div className="flex gap-1.5">
                        <button
                            onClick={() => onExportStrategy?.(selectedStrategyId)}
                            className="bg-slate-800 hover:bg-slate-700 hover:text-white text-slate-300 rounded px-1.5 py-0.5 text-[9px] font-bold transition-all cursor-pointer flex items-center gap-1 border border-slate-700/50"
                            title="导出当前选中的自动选币策略配置 (Lists 1-6)"
                        >
                            <Download size={8} /> 导出
                        </button>
                        <label className="bg-slate-800 hover:bg-slate-700 hover:text-white text-slate-300 rounded px-1.5 py-0.5 text-[9px] font-bold transition-all cursor-pointer flex items-center gap-1 border border-slate-700/50">
                            <Upload size={8} /> 导入
                            <input
                                type="file"
                                accept=".json"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file && onImportStrategy) {
                                        onImportStrategy(selectedStrategyId, file);
                                    }
                                    e.target.value = ''; // Reset input
                                }}
                                className="hidden"
                            />
                        </label>
                    </div>
                </div>

                {/* ⏳ Auto-Rotation Switch & Interval Control */}
                <div className="flex items-center justify-between bg-slate-900/60 p-1.5 rounded border border-slate-800 text-[10px] gap-2">
                    <div className="flex items-center gap-1.5">
                        <label className="relative inline-flex items-center cursor-pointer select-none">
                            <input 
                                type="checkbox" 
                                checked={isRotationEnabled} 
                                onChange={(e) => onToggleRotation(e.target.checked)}
                                className="sr-only peer"
                            />
                            <div className="w-7 h-4 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-600 peer-checked:after:bg-white"></div>
                            <span className="ml-1.5 font-bold text-slate-300">自动轮循</span>
                        </label>
                    </div>

                    {isRotationEnabled && (
                        <div className="text-slate-500 font-bold shrink-0">
                            倒计时: <span className="text-amber-400 font-mono">{Math.floor(rotationTimeLeft / 60)}分{String(rotationTimeLeft % 60).padStart(2, '0')}秒</span>
                        </div>
                    )}

                    <div className="flex items-center gap-1 text-slate-400">
                        <span className="shrink-0">间隔:</span>
                        <input
                            type="number"
                            min={1}
                            max={120}
                            value={rotationIntervalMinutes}
                            onChange={(e) => {
                                const val = Math.max(1, parseInt(e.target.value) || 1);
                                onChangeRotationInterval(val);
                            }}
                            className="bg-slate-950 border border-slate-800 rounded px-1 py-0.5 text-slate-200 font-mono text-[9px] font-bold w-10 text-center focus:outline-none focus:border-indigo-500"
                            title="每个策略轮流扫描的时间（分钟）"
                        />
                        <span className="shrink-0 text-slate-500">分</span>
                    </div>
                </div>

                {/* Strategy Tabs */}
                <div className="flex flex-wrap gap-1 items-center">
                    {strategies.map((strat) => {
                        const isSelected = strat.id === selectedStrategyId;
                        const isEditing = editingId === strat.id;

                        return (
                            <div
                                key={strat.id}
                                className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold transition-all border ${
                                    isSelected
                                        ? "bg-indigo-600/10 text-indigo-300 border-indigo-500/50"
                                        : "bg-slate-800/40 text-slate-400 border-transparent hover:bg-slate-800 hover:text-slate-200"
                                }`}
                            >
                                {isEditing ? (
                                    <input
                                        type="text"
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleSaveRename(strat.id);
                                            if (e.key === 'Escape') setEditingId(null);
                                        }}
                                        className="bg-slate-900 border border-slate-700 rounded px-1 text-[10px] text-white font-bold w-16 focus:outline-none focus:border-indigo-500"
                                        autoFocus
                                    />
                                ) : (
                                    <span
                                        className="cursor-pointer select-none py-0.5 flex items-center gap-1"
                                        onClick={() => onSelectStrategy(strat.id)}
                                    >
                                        {activeStrategyId === strat.id && (
                                            <div className="flex items-center gap-1 shrink-0">
                                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                                {isRotationEnabled && (
                                                    <RotateCw size={9} className="text-emerald-400 animate-spin" />
                                                )}
                                            </div>
                                        )}
                                        {strat.name}
                                    </span>
                                )}

                                {/* Inline Actions */}
                                <div className="flex items-center gap-0.5 ml-1">
                                    {isEditing ? (
                                        <>
                                            <button
                                                onClick={() => handleSaveRename(strat.id)}
                                                className="text-emerald-400 hover:text-white p-0.5 rounded cursor-pointer"
                                            >
                                                <Check size={9} />
                                            </button>
                                            <button
                                                onClick={() => setEditingId(null)}
                                                className="text-red-400 hover:text-white p-0.5 rounded cursor-pointer"
                                            >
                                                <XIcon size={9} />
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                onClick={() => {
                                                    setEditingId(strat.id);
                                                    setEditName(strat.name);
                                                }}
                                                className="text-slate-500 hover:text-slate-200 p-0.5 rounded cursor-pointer"
                                                title="重命名"
                                            >
                                                <Edit3 size={9} />
                                            </button>
                                            {strategies.length > 1 && (
                                                <button
                                                    onClick={() => onDeleteStrategy(strat.id)}
                                                    className="text-slate-500 hover:text-red-400 p-0.5 rounded cursor-pointer"
                                                    title="删除此策略"
                                                >
                                                    <Trash2 size={9} />
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {/* Add Strategy Button */}
                    <button
                        onClick={onAddStrategy}
                        className="bg-slate-800/60 hover:bg-slate-800 hover:text-indigo-400 text-slate-400 rounded p-1 transition-all cursor-pointer border border-transparent hover:border-indigo-500/20"
                        title="添加新选币策略"
                    >
                        <Plus size={10} />
                    </button>
                </div>
            </div>

            <List1Control
                scanConfig={scanConfig} setScanConfig={setScanConfig} isScanning={isScanning} 
                scanStatusText={scanStatusText} isPaused={isPaused} setIsPaused={setIsPaused} onScan={onScan} 
                fixedModeView={fixedModeView} setFixedModeView={setFixedModeView} 
                onClearWatchlist={() => setScanConfig(p => ({...p, customSymbols: ''}))} 
                onClearBlacklist={onClearBlacklist}
                scanInterval={scanInterval} setScanInterval={setScanInterval}
                marketStats={marketStats}
                nextScanTime={nextScanTime}
                scannerMode={scannerMode}
                setScannerMode={setScannerMode}
                isMajorScanning={isMajorScanning}
                majorProgress={majorProgress}
                runMajorTrendDiscovery={runMajorTrendDiscovery}
                cancelMajorScan={cancelMajorScan}
                backtestProps={backtestProps}
            />
            <div className="px-3 py-2 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-y-2 sticky top-0 z-10">
                <div className="flex items-center gap-2">
                    <div className="text-[10px] font-bold text-slate-500 uppercase">1. 市场初筛</div>
                    {scanConfig.useCustomOnly && fixedModeView === 'SEARCH' && (
                        <div className="flex gap-1 animate-in fade-in">
                            <button onClick={onSelectAll} className="text-[9px] bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded text-cyan-400 hover:bg-slate-700 transition-colors">全选</button>
                            <button onClick={onDeselectAll} className="text-[9px] bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">取消</button>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2 flex-wrap text-[9px]">
                    {/* 开仓方向 */}
                    <div className="flex bg-slate-900 p-0.5 rounded border border-slate-800 items-center">
                        <span className="text-[8px] text-slate-500 px-1 font-bold">方向</span>
                        <button
                            onClick={() => setScanConfig(p => ({ ...p, instantOpenDirection: 'LONG' }))}
                            className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-all ${scanConfig.instantOpenDirection === 'LONG' || !scanConfig.instantOpenDirection ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                            title="开仓方向: 多"
                        >
                            多
                        </button>
                        <button
                            onClick={() => setScanConfig(p => ({ ...p, instantOpenDirection: 'SHORT' }))}
                            className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-all ${scanConfig.instantOpenDirection === 'SHORT' ? 'bg-rose-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                            title="开仓方向: 空"
                        >
                            空
                        </button>
                    </div>

                    {/* 立即开仓 */}
                    <div className="flex items-center gap-1.5 bg-slate-900 px-2 py-0.5 rounded border border-slate-800" title="有新币进入初筛列表时立即开仓">
                        <span className="text-[8px] text-slate-400 font-bold">立即开</span>
                        <button
                            onClick={() => setScanConfig(p => ({ ...p, instantOpenEnabled: !p.instantOpenEnabled }))}
                            className={`relative inline-flex h-3.5 w-7 shrink-0 cursor-pointer rounded-full border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${scanConfig.instantOpenEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
                        >
                            <span
                                className={`pointer-events-none inline-block h-2.5 w-2.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out mt-[1px] ${scanConfig.instantOpenEnabled ? 'translate-x-3.5' : 'translate-x-0.5'}`}
                            />
                        </button>
                    </div>

                    {/* 平仓后立即开仓 */}
                    <div className="flex items-center gap-1.5 bg-slate-900 px-2 py-0.5 rounded border border-slate-800" title="持仓平仓后，如果仍满足初筛条件则立即重新开仓">
                        <span className="text-[8px] text-slate-400 font-bold">平仓后续开</span>
                        <button
                            onClick={() => setScanConfig(p => ({ ...p, instantReopenEnabled: !p.instantReopenEnabled }))}
                            className={`relative inline-flex h-3.5 w-7 shrink-0 cursor-pointer rounded-full border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${scanConfig.instantReopenEnabled ? 'bg-blue-500' : 'bg-slate-700'}`}
                        >
                            <span
                                className={`pointer-events-none inline-block h-2.5 w-2.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out mt-[2px] ${scanConfig.instantReopenEnabled ? 'translate-x-3.5' : 'translate-x-0.5'}`}
                            />
                        </button>
                    </div>

                    {/* 数量提示 */}
                    <div 
                        className="bg-slate-800/50 border border-slate-700/40 text-[8px] text-slate-400 px-1.5 py-0.5 rounded"
                        title="开仓数量、杠杆以及单仓金额等由列表 6 (战术终端) 的设置决定"
                    >
                        数量由列表6设置
                    </div>

                    <div className="h-4 w-[1px] bg-slate-800 mx-0.5" />

                    <div className="text-xs font-mono font-bold text-white">{filteredList.length}</div>
                    <button 
                        onClick={() => setShowVisualizer(true)}
                        className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-indigo-400 transition-all border border-transparent hover:border-indigo-500/30"
                        title="放大查看 K 线大图"
                    >
                        <Maximize2 size={12} />
                    </button>
                </div>
            </div>
            
            {showVisualizer && (
                <ScannerVisualizerModal 
                    title="1. 市场初筛"
                    items={filteredList.map(i => ({ symbol: i.symbol, timeframe: scanConfig.list1DefaultTf || '1d' }))}
                    defaultTf={scanConfig.list1DefaultTf || '1d'}
                    defaultLimit={500}
                    watchlist={
                        scannerMode === 'BACKTEST' && backtestProps
                            ? (backtestProps.customSymbols || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
                            : Array.from(customSymbolSet)
                    }
                    onAddToWatchlist={(symbol) => {
                        const cleanSym = symbol.replace('USDT', '').toUpperCase();
                        if (scannerMode === 'BACKTEST' && backtestProps) {
                            const current = (backtestProps.customSymbols || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
                            const set = new Set(current);
                            set.add(cleanSym);
                            backtestProps.setCustomSymbols(Array.from(set).join(', '));
                        } else {
                            onToggleSymbol(symbol);
                        }
                    }}
                    onClose={() => setShowVisualizer(false)}
                />
            )}
            {/* 📊 智能多重排序控制面板 */}
            {list1.length > 0 && (
                <div className="px-3 py-1.5 bg-slate-950/70 border-b border-slate-800/60 flex flex-col gap-1 animate-in fade-in">
                    <div className="flex items-center justify-between text-[8px] font-bold text-slate-400 uppercase tracking-wider">
                        <span>智能排序 (可多选排序优先级)</span>
                        {activeSorts.length > 0 && (
                            <button 
                                onClick={() => setActiveSorts([])}
                                className="text-indigo-400 hover:text-indigo-300 font-bold transition-all"
                            >
                                重置排序
                            </button>
                        )}
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                        {[
                            { id: 1, label: isLong ? '最大跌幅' : '最大涨幅', fullLabel: isLong ? '期间最大跌幅' : '期间最大涨幅' },
                            { id: 2, label: isLong ? '极值➔当前涨' : '极值➔当前跌', fullLabel: isLong ? '最低点➔当前涨幅' : '最高点➔当前跌幅' },
                            { id: 3, label: isLong ? '极值到前天数' : '极值到当前天', fullLabel: isLong ? '最低点到当前天数(1d)' : '最高点到当前天数(1d)' }
                        ].map((btn) => {
                            const activeIdx = activeSorts.indexOf(btn.id);
                            const isActive = activeIdx !== -1;
                            const order = sortOrders[btn.id] || 'desc';

                            return (
                                <div 
                                    key={btn.id}
                                    className={`flex items-center justify-between p-1 rounded text-[8px] font-bold transition-all border ${
                                        isActive 
                                            ? 'bg-indigo-650/10 border-indigo-500 text-indigo-300' 
                                            : 'bg-slate-900 border-slate-800 text-slate-500 hover:bg-slate-800 hover:text-slate-300'
                                    }`}
                                >
                                    <button
                                        onClick={() => {
                                            setActiveSorts(prev => {
                                                if (prev.includes(btn.id)) {
                                                    return prev.filter(id => id !== btn.id);
                                                } else {
                                                    return [...prev, btn.id];
                                                }
                                            });
                                        }}
                                        className="flex-1 text-left whitespace-nowrap overflow-hidden text-ellipsis mr-0.5"
                                        title={btn.fullLabel}
                                    >
                                        <span className="flex items-center gap-0.5">
                                            {isActive && (
                                                <span className="bg-indigo-500 text-slate-950 rounded-full w-3.5 h-3.5 flex items-center justify-center font-black text-[7px] shrink-0">
                                                    {activeIdx + 1}
                                                </span>
                                            )}
                                            {btn.label}
                                        </span>
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setSortOrders(prev => ({
                                                ...prev,
                                                [btn.id]: prev[btn.id] === 'asc' ? 'desc' : 'asc'
                                            }));
                                            if (!isActive) {
                                                setActiveSorts(prev => [...prev, btn.id]);
                                            }
                                        }}
                                        className={`p-0.5 rounded transition-all hover:bg-slate-800 ${isActive ? 'text-indigo-400' : 'text-slate-600 hover:text-slate-300'}`}
                                        title={order === 'asc' ? '从小到大' : '从大到小'}
                                    >
                                        {order === 'asc' ? '↑' : '↓'}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className="p-2 space-y-1.5 bg-slate-950/20">
                {filteredList.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-slate-500 gap-3 animate-in fade-in">
                        {isScanning ? (
                            <>
                                <Loader2 size={32} className="animate-spin text-indigo-500 opacity-80" />
                                <span className="text-xs font-bold animate-pulse">正在获取数据...</span>
                            </>
                        ) : list1.length > 0 ? (
                            <div className="text-center p-4">
                                <span className="text-xs font-bold block text-slate-400">
                                    {!scanConfig.majorTrend?.enabled ? '行情启动底池：暂无匹配币种' : '大行情筛选：无匹配项'}
                                </span>
                                <span className="text-[10px] opacity-60 block mt-1">
                                    {!scanConfig.majorTrend?.enabled ? '请在左侧“行情启动底池”中点击启动扫描或开启大行情发现' : '当前没有满足大行情发现条件的币'}
                                </span>
                            </div>
                        ) : (
                            <>
                                <div className="p-3 bg-slate-900 rounded-full border border-slate-800">
                                    <AlertTriangle size={24} className="opacity-50 text-amber-500" />
                                </div>
                                <div className="text-center">
                                    <span className="text-xs font-bold block text-slate-400">暂无数据 / 获取失败</span>
                                    <span className="text-[10px] opacity-60 block mt-1">请检查网络或点击重试</span>
                                </div>
                                <button 
                                    onClick={onScan}
                                    className="px-4 py-1.5 bg-slate-800 hover:bg-indigo-600 hover:text-white text-slate-400 rounded text-xs font-bold transition-all border border-slate-700 flex items-center gap-1.5 shadow-lg mt-2"
                                >
                                    <RotateCw size={12} /> 点击重试
                                </button>
                            </>
                        )}
                    </div>
                ) : (
                    filteredList.map((item, idx) => (
                        <List1Item 
                            key={item.symbol}
                            item={item}
                            idx={idx}
                            scanConfig={scanConfig}
                            fixedModeView={fixedModeView}
                            customSymbolSet={customSymbolSet}
                            onToggleSymbol={onToggleSymbol}
                            onDeleteSymbol={onDeleteSymbol}
                            setChartData={setChartData}
                            mode={scannerMode || mode}
                            extremeMetrics={metricsCache[item.symbol]}
                            downloadProgress={downloadProgressMap[item.symbol]}
                            onDownload={onDownload}
                        />
                    ))
                )}
            </div>
        </div>
    );
};

export default List1_Selection;
