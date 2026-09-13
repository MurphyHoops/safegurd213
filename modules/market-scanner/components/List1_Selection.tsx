
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
    majorProgress?: any;
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

    // 🌊 横盘蓄势过滤底池数据监听 (用于当开启大行情发现且仅开启横盘蓄势时，市场初筛列表直接展示横盘底池里的币)
    const [sidewaysPool, setSidewaysPool] = useState<any[]>(() => {
        try {
            const raw = localStorage.getItem('SCANNER_SIDEWAYS_FILTERED_POOL');
            return raw ? JSON.parse(raw) : [];
        } catch (_) {
            return [];
        }
    });

    // 🌊 回溯周期大行情候选池数据本地监听 (确保实时极速毫秒级响应，与扫描线程绝对零延迟同步)
    const [localMajorTrendCandidates, setLocalMajorTrendCandidates] = useState<Set<string>>(() => {
        try {
            const key = selectedStrategyId ? `SCANNER_MAJOR_TREND_CANDIDATES_${selectedStrategyId}` : 'SCANNER_MAJOR_TREND_CANDIDATES';
            const raw = localStorage.getItem(key);
            if (raw) {
                const parsed = JSON.parse(raw);
                return new Set(Array.isArray(parsed) ? parsed : []);
            }
            return new Set();
        } catch (_) {
            return new Set();
        }
    });

    useEffect(() => {
        const handleStartTrendUpdate = () => {
            try {
                const raw = localStorage.getItem('SCANNER_START_TREND_POOL');
                setStartTrendPool(raw ? JSON.parse(raw) : []);
            } catch (_) {}
        };
        const handleSidewaysUpdate = () => {
            try {
                const raw = localStorage.getItem('SCANNER_SIDEWAYS_FILTERED_POOL');
                setSidewaysPool(raw ? JSON.parse(raw) : []);
            } catch (_) {}
        };
        const handleMajorTrendUpdate = (e?: any) => {
            try {
                if (e?.detail && Array.isArray(e.detail)) {
                    setLocalMajorTrendCandidates(new Set(e.detail));
                    return;
                }
                const key = selectedStrategyId ? `SCANNER_MAJOR_TREND_CANDIDATES_${selectedStrategyId}` : 'SCANNER_MAJOR_TREND_CANDIDATES';
                const raw = localStorage.getItem(key);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    setLocalMajorTrendCandidates(new Set(Array.isArray(parsed) ? parsed : []));
                }
            } catch (_) {}
        };

        window.addEventListener('storage', handleStartTrendUpdate);
        window.addEventListener('storage', handleSidewaysUpdate);
        window.addEventListener('storage', handleMajorTrendUpdate);
        window.addEventListener('scanner_start_trend_pool_updated', handleStartTrendUpdate);
        window.addEventListener('scanner_sideways_pool_updated', handleSidewaysUpdate);
        window.addEventListener('scanner_major_trend_candidates_updated', handleMajorTrendUpdate);
        window.addEventListener('scanner_major_trend_candidates_updated', handleSidewaysUpdate);
        const timer = setInterval(() => {
            handleStartTrendUpdate();
            handleSidewaysUpdate();
            handleMajorTrendUpdate();
        }, 1000);
        return () => {
            window.removeEventListener('storage', handleStartTrendUpdate);
            window.removeEventListener('storage', handleSidewaysUpdate);
            window.removeEventListener('storage', handleMajorTrendUpdate);
            window.removeEventListener('scanner_start_trend_pool_updated', handleStartTrendUpdate);
            window.removeEventListener('scanner_sideways_pool_updated', handleSidewaysUpdate);
            window.removeEventListener('scanner_major_trend_candidates_updated', handleMajorTrendUpdate);
            window.removeEventListener('scanner_major_trend_candidates_updated', handleSidewaysUpdate);
            clearInterval(timer);
        };
    }, [selectedStrategyId]);

    // 合并 Props 与 Local state 中的大行情候选集
    const effectiveMajorCandidates = useMemo(() => {
        const merged = new Set<string>();
        if (majorTrendCandidates && majorTrendCandidates.size > 0) {
            majorTrendCandidates.forEach(c => merged.add(c));
        }
        if (localMajorTrendCandidates && localMajorTrendCandidates.size > 0) {
            localMajorTrendCandidates.forEach(c => merged.add(c));
        }
        return merged;
    }, [majorTrendCandidates, localMajorTrendCandidates]);

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

    const baseList = useMemo(() => {
        // 🔒 无论是否开启大行情发现，列表1的基础底池均由行情启动底池（startTrendPool）支撑
        const poolMap = new Map<string, any>();
        const startTrendSymbolSet = startTrendPool && startTrendPool.length > 0 ? new Set(startTrendPool.map(p => p.symbol)) : null;

        // 辅助读取 24H 原始数据缓存以补齐价格与 24H 交易额
        const rawCacheMap = new Map<string, { volM: number, price: number, change: number }>();
        try {
            const rawCache = localStorage.getItem('SCANNER_RAW_DATA_CACHE');
            if (rawCache) {
                const parsed = JSON.parse(rawCache);
                if (Array.isArray(parsed)) {
                    parsed.forEach((d: any) => {
                        if (d && d.symbol) {
                            rawCacheMap.set(d.symbol, {
                                volM: +(parseFloat(d.quoteVolume || '0') / 1000000).toFixed(2),
                                price: parseFloat(d.lastPrice || '0') || 0,
                                change: parseFloat(d.priceChangePercent || '0') || 0
                            });
                        }
                    });
                }
            }
        } catch (_) {}

        const enrichItem = (sym: string, partial?: any) => {
            const existing = list1.find(item => item.symbol === sym);
            const startItem = startTrendPool?.find(p => p.symbol === sym);
            const sidewaysItem = sidewaysPool?.find(p => p.symbol === sym);
            const raw = rawCacheMap.get(sym);

            let price = partial?.price || startItem?.price || sidewaysItem?.currentPrice || existing?.price || raw?.price || 0;
            let change = partial?.changePct !== undefined ? partial.changePct : (partial?.change !== undefined ? partial.change : (startItem?.changePct !== undefined ? startItem.changePct : (existing?.change !== undefined ? existing.change : (raw?.change || 0))));
            let volume24h = partial?.volume24h !== undefined ? partial.volume24h : (existing?.volume24h !== undefined ? existing.volume24h : raw?.volM);

            return {
                ...existing,
                ...startItem,
                ...(sidewaysItem ? { sidewaysDrop: sidewaysItem.dropFromMax, sidewaysRise: sidewaysItem.riseFromMin } : {}),
                ...partial,
                symbol: sym,
                price: price || existing?.price || raw?.price || 0,
                change: change !== undefined ? change : (existing?.change !== undefined ? existing.change : (raw?.change || 0)),
                volume24h: (volume24h !== undefined && volume24h > 0) ? volume24h : (existing?.volume24h || raw?.volM || 0),
                volume: existing?.volume || raw?.volM,
            };
        };

        if (startTrendPool && startTrendPool.length > 0) {
            startTrendPool.forEach(p => {
                poolMap.set(p.symbol, enrichItem(p.symbol, p));
            });
        } else {
            list1.forEach(item => {
                poolMap.set(item.symbol, enrichItem(item.symbol, item));
            });
        }

        if (sidewaysPool && sidewaysPool.length > 0) {
            sidewaysPool.forEach(p => {
                // 🔒 必须在启动趋势底池内才允许加入
                if (!startTrendSymbolSet || startTrendSymbolSet.has(p.symbol)) {
                    if (!poolMap.has(p.symbol)) {
                        poolMap.set(p.symbol, enrichItem(p.symbol, p));
                    }
                }
            });
        }

        if (effectiveMajorCandidates && effectiveMajorCandidates.size > 0) {
            effectiveMajorCandidates.forEach(cand => {
                const sym = cand.replace('_LONG', '').replace('_SHORT', '');
                if (sym && !poolMap.has(sym)) {
                    poolMap.set(sym, enrichItem(sym));
                }
            });
        }

        return Array.from(poolMap.values());
    }, [startTrendPool, sidewaysPool, list1, effectiveMajorCandidates]);

    const list1SymbolsStr = baseList.map(item => item.symbol).join(',');

    useEffect(() => {
        let active = true;
        const limit = lookbackDays + 20;

        const fetchMetricsForList = async () => {
            const KLINE_LIMIT_CACHE = (window as any).KLINE_LIMIT_CACHE = (window as any).KLINE_LIMIT_CACHE || {};

            const currentList = baseList;
            const symbolsToFetch = currentList.filter(item => {
                const symbol = item.symbol;
                if (!symbol) return false;

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

            // Fetch in controlled concurrency batches to prevent proxy stampede and timeouts
            const batchSize = 3;
            for (let i = 0; i < symbolsToFetch.length; i += batchSize) {
                if (!active) break;
                const batch = symbolsToFetch.slice(i, i + batchSize);
                await Promise.all(batch.map(async (item) => {
                    if (!active) return;
                    const symbol = item.symbol;

                try {
                    const now = Date.now();
                    let data: any[] | null = null;

                    const cached = KLINE_LIMIT_CACHE[symbol]?.[lookbackDays] || KLINE_LIMIT_CACHE[symbol]?.['1d'];
                    if (cached && now - (cached.timestamp || 0) < 10 * 60 * 1000 && Array.isArray(cached.klines) && cached.klines.length >= lookbackDays) {
                        data = cached.klines;
                    } else if (KLINE_LIMIT_CACHE[`${symbol}_1d`] && Array.isArray(KLINE_LIMIT_CACHE[`${symbol}_1d`]) && KLINE_LIMIT_CACHE[`${symbol}_1d`].length >= lookbackDays) {
                        data = KLINE_LIMIT_CACHE[`${symbol}_1d`];
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
                            KLINE_LIMIT_CACHE[`${symbol}_1d`] = data;
                            KLINE_LIMIT_CACHE[symbol]['1d'] = {
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

                        // ⚡ [日K极速扫描方案]: 直接复用已拉取的日K数据(data)，零网络额外开销零阻塞
                        const startTrendGroups = scanConfig.majorTrend?.startTrendGroups || [];
                        const enableStartTrendLong = scanConfig.majorTrend?.enableStartTrendLong;
                        const enableStartTrendShort = scanConfig.majorTrend?.enableStartTrendShort;
                        const hasActiveGroups = startTrendGroups.some(g => g.enabled);

                        let startTrendValidLong = true;
                        let startTrendValidShort = true;

                        if ((enableStartTrendLong || enableStartTrendShort) && hasActiveGroups && Array.isArray(data) && data.length > 0) {
                            try {
                                const activeGroups = startTrendGroups.map((g, idx) => ({ ...g, idx })).filter(g => g.enabled);
                                const lastDayCandle = data[data.length - 1];
                                const lastPrice = currentPrice > 0 ? currentPrice : parseFloat(lastDayCandle[4]);

                                if (!isNaN(lastPrice) && lastPrice > 0) {
                                    let isLongTrendValid = false;
                                    let isShortTrendValid = false;

                                    for (const group of activeGroups) {
                                        let lastCandles: any[] = [];
                                        if (group.idx === 0) {
                                            // 组合0：今日日K线 (从今日08:00开盘起)
                                            lastCandles = [lastDayCandle];
                                        } else {
                                            const groupDays = group.days !== undefined ? group.days : (group.idx === 1 ? 2 : (group.idx === 2 ? 3 : 7));
                                            const requiredDays = Math.max(groupDays, 1);
                                            lastCandles = data.slice(-Math.min(requiredDays, data.length));
                                        }

                                        if (lastCandles.length === 0) continue;

                                        if (enableStartTrendLong) {
                                            const periodLows = lastCandles.map((k: any) => parseFloat(k[3])).filter(val => !isNaN(val) && val > 0);
                                            const periodHighs = lastCandles.map((k: any) => parseFloat(k[2])).filter(val => !isNaN(val) && val > 0);
                                            if (periodLows.length > 0 && periodHighs.length > 0) {
                                                const periodMinLow = Math.min(...periodLows);
                                                const periodMaxHigh = Math.max(...periodHighs);
                                                const baseOpen = parseFloat(lastCandles[0][1]);
                                                
                                                const changePct = ((lastPrice - baseOpen) / baseOpen) * 100;
                                                const changePctFromLow = ((lastPrice - periodMinLow) / periodMinLow) * 100;
                                                const effectiveChange = Math.max(changePct, changePctFromLow);
                                                
                                                const pullbackPct = ((periodMaxHigh - lastPrice) / periodMaxHigh) * 100;
                                                const maxPullbackLong = group.maxPullbackLong !== undefined ? group.maxPullbackLong : 5;
                                                
                                                if (!isNaN(effectiveChange) && effectiveChange >= group.minLong && effectiveChange <= group.maxLong && !isNaN(pullbackPct) && pullbackPct <= maxPullbackLong) {
                                                    isLongTrendValid = true;
                                                }
                                            }
                                        }

                                        if (enableStartTrendShort) {
                                            const periodHighs = lastCandles.map((k: any) => parseFloat(k[2])).filter(val => !isNaN(val) && val > 0);
                                            const periodLows = lastCandles.map((k: any) => parseFloat(k[3])).filter(val => !isNaN(val) && val > 0);
                                            if (periodHighs.length > 0 && periodLows.length > 0) {
                                                const periodMaxHigh = Math.max(...periodHighs);
                                                const periodMinLow = Math.min(...periodLows);
                                                const baseOpen = parseFloat(lastCandles[0][1]);
                                                
                                                const dropPct = ((baseOpen - lastPrice) / baseOpen) * 100;
                                                const dropPctFromHigh = ((periodMaxHigh - lastPrice) / periodMaxHigh) * 100;
                                                const effectiveDrop = Math.max(dropPct, dropPctFromHigh);
                                                
                                                const bouncePct = ((lastPrice - periodMinLow) / periodMinLow) * 100;
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
                            } catch (err1d) {
                                console.warn("[StartTrend list views] Calculate 1d error: ", err1d);
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
                } catch (err: any) {
                    console.warn(`[Metrics] Skipped metrics calculation for ${symbol}: ${err?.message || err}`);
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
        }
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

    const sortedList1 = [...baseList].sort((a, b) => {
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
        // 🔒 [第一步严格 24H 交易额刚性拦截与过滤]:
        // 无论何种模式（是否开启大行情发现、启动趋势池等），在列表1向外输出的最终集合中，
        // 凡开启了 24H 交易额过滤（如 5M - 0），必须严格通过 24H 交易额区间校验，低于 minVolume 或高于 maxVolume 者一票否决！
        const enable24h = scanConfig.enableVol24h !== false;
        const minVol24h = scanConfig.minVolume || 0;
        const maxVol24h = scanConfig.maxVolume || 0;

        const volumeFilteredList = sortedList1.filter(item => {
            if (enable24h) {
                const vol = item.volume24h !== undefined ? item.volume24h : 0;
                if (minVol24h > 0 && vol < minVol24h) return false;
                if (maxVol24h > 0 && vol > maxVol24h) return false;
            }
            return true;
        });

        // 判断“行情启动趋势”是否处于活动状态（多或空至少开启一个）
        const isStartTrendActive = Boolean(scanConfig.majorTrend?.enableStartTrendLong || scanConfig.majorTrend?.enableStartTrendShort);
        const startTrendSymbolSet = (isStartTrendActive && startTrendPool && startTrendPool.length > 0) ? new Set(startTrendPool.map(p => p.symbol)) : null;

        // 🔒【行情启动趋势底池前置过滤】：
        // 1. 若行情启动趋势多/空开启，凡不在启动趋势底池中的币种一律立即过滤剔除；
        // 2. 若“行情启动趋势”的“多”和“空”都关闭，则不进行启动趋势底池过滤拦截，直通后续“大行情发现”规则过滤！
        const startTrendFilteredList = startTrendSymbolSet
            ? volumeFilteredList.filter(item => startTrendSymbolSet.has(item.symbol))
            : volumeFilteredList;

        // =========================================================================
        // 🌊 状态 1：当【大行情发现】关闭时，市场初筛列表 100% 纯粹就是【行情启动底池】里的币
        // 凡不再符合启动趋势规则的币种立即被剔除，不留存任何失效币种
        // =========================================================================
        if (!scanConfig.majorTrend?.enabled) {
            return startTrendFilteredList;
        }

        // =========================================================================
        // 当【大行情发现】开启时：
        // =========================================================================
        const cfg = (scanConfig.majorTrend || {}) as any;
        const enableLong = cfg.enableLong !== false;
        const enableShort = cfg.enableShort !== false;
        const enableSideways = cfg.enableSideways === true; // 横盘蓄势开关开启时生效
        const enableLookbackFilter = cfg.enableLookbackFilter !== false && (cfg.enableLookbackFilter === true || (enableLong || enableShort));

        // 🌊 状态 2：开启【大行情发现】且仅开启【横盘蓄势过滤】（未开启回溯周期过滤或多空方向皆关闭）
        // 市场初筛列表 100% 纯粹就是【横盘蓄势过滤底池】（且属于启动趋势底池）里的币，不再符合者立即剔除
        if (enableSideways && !enableLookbackFilter) {
            if (sidewaysPool) {
                const sidewaysSymbolSet = new Set(sidewaysPool.map(p => p.symbol));
                return startTrendFilteredList.filter(item => sidewaysSymbolSet.has(item.symbol));
            }
            return startTrendFilteredList.filter(item => {
                const metrics = metricsCache[item.symbol];
                if (!metrics || metrics.loading) return false;
                return metrics.isSidewaysMatch !== false;
            });
        }

        // 🌊 状态 3：开启【大行情发现】且开启【横盘蓄势过滤】+【回溯周期过滤】
        // 🔒【回溯周期过滤即时呈现与交易额底池重筛自动删减铁律】:
        // 在“回溯周期过滤”进行时，只要有币符合条件，立即出现在市场初筛列表里，绝不清零；
        // 候选币种结合 24H 交易额底池进行校验，发现不再符合条件的自动删减！
        const hasCandidates = Boolean(effectiveMajorCandidates && effectiveMajorCandidates.size > 0);

        if (hasCandidates) {
            return sortedList1.filter(item => {
                const sym = item.symbol;
                if (!sym) return false;

                // 1. 回溯周期过滤匹配：必须在最新大行情候选池中且方向匹配
                const matchLong = effectiveMajorCandidates.has(`${sym}_LONG`) || effectiveMajorCandidates.has(sym);
                const matchShort = effectiveMajorCandidates.has(`${sym}_SHORT`) || effectiveMajorCandidates.has(sym);

                let dirMatched = false;
                if (enableLong && enableShort) {
                    dirMatched = matchLong || matchShort;
                } else if (enableLong) {
                    dirMatched = matchLong;
                } else if (enableShort) {
                    dirMatched = matchShort;
                }
                if (!dirMatched) return false;

                // 🔒【初筛候选币实时二次过滤与动态删减铁律】:
                // 对初筛候选池中的币种结合最新实时指标与参数进行二次过滤校验：
                // 若指标已加载完成，且不再满足极值区间、启动趋势或横盘要求，当场动态删除！
                const metrics = metricsCache[sym];
                if (metrics && !metrics.loading) {
                    const currentPrice = item.price;

                    // 1. 横盘蓄势校验
                    if (enableSideways && metrics.isSidewaysMatch === false) {
                        return false;
                    }

                    // 2. 回溯周期极值与启动趋势校验
                    if (enableLookbackFilter) {
                        const checkLong = () => {
                            if (!enableLong) return false;
                            if (!matchLong) return false;

                            // 最小历史跌幅
                            if (cfg.minHistoryDrop !== undefined && cfg.minHistoryDrop > 0) {
                                if (Math.abs(metrics.maxDeclinePct || 0) < cfg.minHistoryDrop) return false;
                            }

                            // 最低点到当前涨幅区间
                            const minLow = metrics.minPeriodLow || currentPrice;
                            const liveLowToCurrentIncrease = minLow > 0 ? ((currentPrice - minLow) / minLow) * 100 : 0;
                            const minExtremeDistanceLong = cfg.minExtremeDistanceLong ?? 0;
                            const maxExtremeDistanceLong = cfg.maxExtremeDistanceLong !== undefined 
                                ? cfg.maxExtremeDistanceLong 
                                : (cfg.maxExtremeDistance ?? 100);
                            if (liveLowToCurrentIncrease < minExtremeDistanceLong || 
                                liveLowToCurrentIncrease > maxExtremeDistanceLong) {
                                return false;
                            }

                            // 最低点距今天数区间
                            const extremeDaysMinLong = cfg.extremeDaysMinLong ?? 0;
                            const extremeDaysMaxLong = cfg.extremeDaysMaxLong ?? 300;
                            if ((metrics.lowDaysAgo ?? 0) < extremeDaysMinLong || 
                                (metrics.lowDaysAgo ?? 0) > extremeDaysMaxLong) {
                                return false;
                            }

                            // 行情启动趋势多头
                            if (scanConfig.majorTrend?.enableStartTrendLong) {
                                if (metrics.startTrendValidLong === false) return false;
                            }

                            return true;
                        };

                        const checkShort = () => {
                            if (!enableShort) return false;
                            if (!matchShort) return false;

                            // 最小历史涨幅
                            if (cfg.minHistoryPump !== undefined && cfg.minHistoryPump > 0) {
                                if ((metrics.maxIncreasePct || 0) < cfg.minHistoryPump) return false;
                            }

                            // 最高点到当前跌幅区间
                            const maxHigh = metrics.maxPeriodHigh || currentPrice;
                            const liveHighToCurrentDecline = maxHigh > 0 ? ((maxHigh - currentPrice) / maxHigh) * 100 : 0;
                            const minExtremeDistanceShort = cfg.minExtremeDistanceShort ?? 0;
                            const maxExtremeDistanceShort = cfg.maxExtremeDistanceShort !== undefined 
                                ? cfg.maxExtremeDistanceShort 
                                : (cfg.maxExtremeDistance ?? 100);
                            if (liveHighToCurrentDecline < minExtremeDistanceShort || 
                                liveHighToCurrentDecline > maxExtremeDistanceShort) {
                                return false;
                            }

                            // 最高点距今天数区间
                            const extremeDaysMinShort = cfg.extremeDaysMinShort ?? 0;
                            const extremeDaysMaxShort = cfg.extremeDaysMaxShort ?? 300;
                            if ((metrics.highDaysAgo ?? 0) < extremeDaysMinShort || 
                                (metrics.highDaysAgo ?? 0) > extremeDaysMaxShort) {
                                return false;
                            }

                            // 行情启动趋势空头
                            if (scanConfig.majorTrend?.enableStartTrendShort) {
                                if (metrics.startTrendValidShort === false) return false;
                            }

                            return true;
                        };

                        let ok = false;
                        if (enableLong && enableShort) {
                            ok = checkLong() || checkShort();
                        } else if (enableLong) {
                            ok = checkLong();
                        } else if (enableShort) {
                            ok = checkShort();
                        }
                        if (!ok) return false;
                    }
                }

                return true;
            });
        }

        const lookbackMatches = startTrendFilteredList.filter(item => {
            const sym = item.symbol;
            if (!sym) return false;

            // 1. 如果开启了横盘蓄势过滤，必须先在横盘底池中通过
            if (enableSideways) {
                if (sidewaysPool && sidewaysPool.length > 0) {
                    const sidewaysSymbolSet = new Set(sidewaysPool.map(p => p.symbol));
                    if (!sidewaysSymbolSet.has(sym)) return false;
                } else {
                    return false;
                }
            }

            const metrics = metricsCache[item.symbol];
            if (!metrics || metrics.loading) return false;

            const currentPrice = item.price;

            if (enableLookbackFilter) {
                const checkLongMatch = () => {
                    if (!enableLong) return false;

                    // 最小历史跌幅
                    if (cfg.minHistoryDrop !== undefined && cfg.minHistoryDrop > 0) {
                        if (Math.abs(metrics.maxDeclinePct || 0) < cfg.minHistoryDrop) return false;
                    }

                    // 最低点到当前涨幅区间
                    const minLow = metrics.minPeriodLow || currentPrice;
                    const liveLowToCurrentIncrease = minLow > 0 ? ((currentPrice - minLow) / minLow) * 100 : 0;
                    const minExtremeDistanceLong = cfg.minExtremeDistanceLong ?? 0;
                    const maxExtremeDistanceLong = cfg.maxExtremeDistanceLong !== undefined 
                        ? cfg.maxExtremeDistanceLong 
                        : (cfg.maxExtremeDistance ?? 100);
                    if (liveLowToCurrentIncrease < minExtremeDistanceLong || 
                        liveLowToCurrentIncrease > maxExtremeDistanceLong) {
                        return false;
                    }

                    // 最低点距今天数区间
                    const extremeDaysMinLong = cfg.extremeDaysMinLong ?? 0;
                    const extremeDaysMaxLong = cfg.extremeDaysMaxLong ?? 300;
                    if ((metrics.lowDaysAgo ?? 0) < extremeDaysMinLong || 
                        (metrics.lowDaysAgo ?? 0) > extremeDaysMaxLong) {
                        return false;
                    }

                    // 行情启动趋势多头
                    if (scanConfig.majorTrend?.enableStartTrendLong) {
                        if (metrics.startTrendValidLong === false) return false;
                    }

                    return true;
                };

                const checkShortMatch = () => {
                    if (!enableShort) return false;

                    // 最小历史涨幅
                    if (cfg.minHistoryPump !== undefined && cfg.minHistoryPump > 0) {
                        if ((metrics.maxIncreasePct || 0) < cfg.minHistoryPump) return false;
                    }

                    // 最高点到当前跌幅区间
                    const maxHigh = metrics.maxPeriodHigh || currentPrice;
                    const liveHighToCurrentDecline = maxHigh > 0 ? ((maxHigh - currentPrice) / maxHigh) * 100 : 0;
                    const minExtremeDistanceShort = cfg.minExtremeDistanceShort ?? 0;
                    const maxExtremeDistanceShort = cfg.maxExtremeDistanceShort !== undefined 
                        ? cfg.maxExtremeDistanceShort 
                        : (cfg.maxExtremeDistance ?? 100);
                    if (liveHighToCurrentDecline < minExtremeDistanceShort || 
                        liveHighToCurrentDecline > maxExtremeDistanceShort) {
                        return false;
                    }

                    // 最高点距今天数区间
                    const extremeDaysMinShort = cfg.extremeDaysMinShort ?? 0;
                    const extremeDaysMaxShort = cfg.extremeDaysMaxShort ?? 300;
                    if ((metrics.highDaysAgo ?? 0) < extremeDaysMinShort || 
                        (metrics.highDaysAgo ?? 0) > extremeDaysMaxShort) {
                        return false;
                    }

                    // 行情启动趋势空头
                    if (scanConfig.majorTrend?.enableStartTrendShort) {
                        if (metrics.startTrendValidShort === false) return false;
                    }

                    return true;
                };

                if (enableLong && enableShort) {
                    if (!checkLongMatch() && !checkShortMatch()) return false;
                } else if (enableLong) {
                    if (!checkLongMatch()) return false;
                } else if (enableShort) {
                    if (!checkShortMatch()) return false;
                } else {
                    return false;
                }
            } else {
                if (isLong && scanConfig.majorTrend?.enableStartTrendLong && metrics.startTrendValidLong === false) {
                    return false;
                }
                if (!isLong && scanConfig.majorTrend?.enableStartTrendShort && metrics.startTrendValidShort === false) {
                    return false;
                }
            }

            return true;
        });

        // 🔒【严格动态淘汰与即时清除铁律】:
        // 市场初筛严格只输出当前通过回溯周期过滤的候选币种，不符合或已失效的币种直接剔除删除，绝不兜底留存！
        return lookbackMatches;
    }, [sortedList1, scanConfig.enableVol24h, scanConfig.minVolume, scanConfig.maxVolume, scanConfig.majorTrend, isLong, metricsCache, majorTrendCandidates, localMajorTrendCandidates, effectiveMajorCandidates, startTrendPool, sidewaysPool, isMajorScanning]);

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
