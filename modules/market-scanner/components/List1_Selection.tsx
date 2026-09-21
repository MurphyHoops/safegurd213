
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Loader2, AlertTriangle, RotateCw, Maximize2, Upload, Download, Plus, Trash2, Edit3, Check, X as XIcon, Zap, ArrowUpDown, Filter, ChevronDown, ChevronRight, Send, Sliders } from 'lucide-react';
import { fetchWithFallback } from '../../../services/apiService';
import { StrategyItem } from '../../../types';
import { ScanConfig, ScannerItem, COLUMN_WIDTH_CLASS } from '../../../components/Scanner/scannerTypes';
import { List1Control } from './Control';
import { List1Item } from './Item';
import { ScannerVisualizerModal } from '../../../components/ScannerVisualizerModal';
import { getVolume8am, fetchVolume8amBatch, checkVolumeRule } from '../../../services/volume8amService';


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
    const [activeSorts, setActiveSorts] = useState<number[]>([]); // active sort criteria IDs: 1 (24H涨跌幅), 2 (8H涨跌幅), 3 (24H交易额), 4 (8H交易额)
    const [sortOrders, setSortOrders] = useState<Record<number, 'asc' | 'desc'>>({
        1: 'desc',
        2: 'desc',
        3: 'desc',
        4: 'desc'
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

    // 🚀 定向推送至列表2控制面板折叠/展开状态
    const [isPushConfigOpen, setIsPushConfigOpen] = useState(true);
    // 🎯 是否仅在列表1中查看定向截取推送池
    const [viewOnlyPushed, setViewOnlyPushed] = useState(false);

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

    const [hasRunMajorTrend, setHasRunMajorTrend] = useState<boolean>(() => {
        try {
            const suffix = selectedStrategyId ? `_${selectedStrategyId}` : '';
            return localStorage.getItem(`SCANNER_HAS_RUN_MAJOR${suffix}`) === 'true';
        } catch (_) {
            return false;
        }
    });

    useEffect(() => {
        const suffix = selectedStrategyId ? `_${selectedStrategyId}` : '';
        const runState = localStorage.getItem(`SCANNER_HAS_RUN_MAJOR${suffix}`) === 'true';
        setHasRunMajorTrend(runState);
    }, [selectedStrategyId]);

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
                    setHasRunMajorTrend(true);
                    return;
                }
                const key = selectedStrategyId ? `SCANNER_MAJOR_TREND_CANDIDATES_${selectedStrategyId}` : 'SCANNER_MAJOR_TREND_CANDIDATES';
                const raw = localStorage.getItem(key);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    setLocalMajorTrendCandidates(new Set(Array.isArray(parsed) ? parsed : []));
                }
                const suffix = selectedStrategyId ? `_${selectedStrategyId}` : '';
                if (localStorage.getItem(`SCANNER_HAS_RUN_MAJOR${suffix}`) === 'true') {
                    setHasRunMajorTrend(true);
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
        window.addEventListener('scanner_major_trend_completed', handleMajorTrendUpdate);
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
            window.removeEventListener('scanner_major_trend_completed', handleMajorTrendUpdate);
            clearInterval(timer);
        };
    }, [selectedStrategyId]);

    // 🌊【数据流水线核心保障：行情启动底池 -> 横盘蓄势过滤底池 联动同步】
    // 1. 凡不在行情启动底池中的币种，不得滞留在横盘蓄势底池中（平稳同步，绝不在中途瞬时清零）
    // 2. 行情启动底池中的币种一旦计算出横盘蓄势指标符合(isSidewaysMatch === true)，实时增量写入横盘蓄势底池
    useEffect(() => {
        const cfg = scanConfig.majorTrend;
        if (!cfg?.enabled || cfg?.enableSideways === false) return;
        if (!startTrendPool || startTrendPool.length === 0) return;

        const startTrendSymbolSet = new Set(startTrendPool.map(p => p.symbol));
        let changed = false;
        const currentSidewaysMap = new Map<string, any>();

        // 清理已离开行情启动底池的币
        (sidewaysPool || []).forEach(item => {
            if (startTrendSymbolSet.has(item.symbol)) {
                currentSidewaysMap.set(item.symbol, item);
            } else {
                changed = true;
            }
        });

        // 将行情启动底池中已满足横盘蓄势条件的币种增量加入
        startTrendPool.forEach(p => {
            const m = metricsCache[p.symbol];
            if (m && !m.loading && m.isSidewaysMatch === true && !currentSidewaysMap.has(p.symbol)) {
                currentSidewaysMap.set(p.symbol, {
                    symbol: p.symbol,
                    dropFromMax: m.highToCurrentDeclinePct ?? 0,
                    riseFromMin: m.lowToCurrentIncreasePct ?? 0,
                    maxZ: m.maxPeriodHigh ?? p.price,
                    minZ: m.minPeriodLow ?? p.price,
                    currentPrice: p.price,
                    timestamp: Date.now()
                });
                changed = true;
            }
        });

        if (changed) {
            const newList = Array.from(currentSidewaysMap.values());
            setSidewaysPool(newList);
            try {
                localStorage.setItem('SCANNER_SIDEWAYS_FILTERED_POOL', JSON.stringify(newList));
                window.dispatchEvent(new CustomEvent('scanner_sideways_pool_updated', { detail: newList }));
            } catch (_) {}
        }
    }, [startTrendPool, metricsCache, scanConfig.majorTrend?.enabled, scanConfig.majorTrend?.enableSideways, sidewaysPool, setSidewaysPool]);

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
                        isSidewaysMatch: undefined,
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

    // 📡 监听早上8点起缓存数据实时更新事件
    const [_8amUpdateTick, set8amUpdateTick] = useState(0);
    useEffect(() => {
        const handle8amUpdate = () => {
            set8amUpdateTick(t => t + 1);
        };
        window.addEventListener('scanner_8am_cache_updated', handle8amUpdate);
        return () => {
            window.removeEventListener('scanner_8am_cache_updated', handle8amUpdate);
        };
    }, []);

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
            const cached8am = getVolume8am(sym);

            let price = partial?.price || startItem?.price || sidewaysItem?.currentPrice || existing?.price || raw?.price || 0;
            let change = partial?.changePct !== undefined ? partial.changePct : (partial?.change !== undefined ? partial.change : (startItem?.changePct !== undefined ? startItem.changePct : (existing?.change !== undefined ? existing.change : (raw?.change || 0))));
            let volume24h = partial?.volume24h !== undefined ? partial.volume24h : (existing?.volume24h !== undefined ? existing.volume24h : raw?.volM);
            let volume8am = partial?.volume8am !== undefined ? partial.volume8am : (existing?.volume8am !== undefined ? existing.volume8am : cached8am?.volume8am);
            let change8am = partial?.change8am !== undefined ? partial.change8am : (existing?.change8am !== undefined ? existing.change8am : cached8am?.change8am);

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
                volume8am: volume8am !== undefined ? Number(volume8am) : undefined,
                change8am: change8am !== undefined ? Number(change8am) : undefined,
            };
        };

        // 🔒【市场初筛核心底池】：必须首先载入 list1 的全部初筛币种，绝不允许因启动底池有币而丢弃初筛基础数据
        list1.forEach(item => {
            poolMap.set(item.symbol, enrichItem(item.symbol, item));
        });

        // 补齐行情启动底池中的币种及属性
        if (startTrendPool && startTrendPool.length > 0) {
            startTrendPool.forEach(p => {
                if (!poolMap.has(p.symbol)) {
                    poolMap.set(p.symbol, enrichItem(p.symbol, p));
                }
            });
        }

        // 补齐横盘底池中的币种及属性
        if (sidewaysPool && sidewaysPool.length > 0) {
            sidewaysPool.forEach(p => {
                if (!poolMap.has(p.symbol)) {
                    poolMap.set(p.symbol, enrichItem(p.symbol, p));
                }
            });
        }

        // 补齐大行情候选池中的币种
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

                // Skip if already computed and not loading, unless required fields are undefined
                const cachedMetrics = metricsCacheRef.current[symbol];
                if (cachedMetrics && !cachedMetrics.loading) {
                    const isMajorActive = scanConfig.majorTrend?.enabled;
                    if (isMajorActive) {
                        if (cachedMetrics.minPeriodLow !== undefined && cachedMetrics.isSidewaysMatch !== undefined) {
                            return false;
                        }
                    } else {
                        const hasTrendActive = scanConfig.majorTrend?.enableStartTrendLong || scanConfig.majorTrend?.enableStartTrendShort;
                        if (!hasTrendActive || (cachedMetrics.startTrendValidLong !== undefined && cachedMetrics.startTrendValidShort !== undefined)) {
                            return false;
                        }
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

                        let isSidewaysMatch = true;
                        let maxZ = currentPrice;
                        let minZ = currentPrice;
                        if (enableSideways && highs.length > sidewaysDays) {
                            const sidewaysHighs = highs.slice(-sidewaysDays);
                            const sidewaysLows = lows.slice(-sidewaysDays);
                            maxZ = sidewaysHighs.length > 0 ? Math.max(...sidewaysHighs) : currentPrice;
                            minZ = sidewaysLows.length > 0 ? Math.min(...sidewaysLows) : currentPrice;

                            const dropFromMax = ((maxZ - currentPrice) / maxZ) * 100;
                            const riseFromMin = ((currentPrice - minZ) / minZ) * 100;

                            if (dropFromMax >= (scanConfig.majorTrend?.sidewaysMaxDrop ?? 10) || 
                                riseFromMin >= (scanConfig.majorTrend?.sidewaysMaxPump ?? 10)) {
                                isSidewaysMatch = false;
                            }
                        }

                        const rawMaxPeriodHigh = histHighs.length > 0 ? Math.max(...histHighs) : currentPrice;
                        const rawMinPeriodLow = histLows.length > 0 ? Math.min(...histLows) : currentPrice;
                        const maxPeriodHigh = Math.max(rawMaxPeriodHigh, maxZ, currentPrice);
                        const minPeriodLow = Math.min(rawMinPeriodLow, minZ, currentPrice);

                        const safeNum = (v: number) => (isNaN(v) || !isFinite(v)) ? 0 : v;
                        const maxDeclinePct = safeNum(maxPeriodHigh > 0 ? ((minPeriodLow - maxPeriodHigh) / maxPeriodHigh) * 100 : 0);
                        const highToCurrentDeclinePct = safeNum(maxPeriodHigh > 0 ? Math.max(0, ((maxPeriodHigh - currentPrice) / maxPeriodHigh) * 100) : 0);
                        const maxIncreasePct = safeNum(minPeriodLow > 0 ? ((maxPeriodHigh - minPeriodLow) / minPeriodLow) * 100 : 0);
                        const lowToCurrentIncreasePct = safeNum(minPeriodLow > 0 ? Math.max(0, ((currentPrice - minPeriodLow) / minPeriodLow) * 100) : 0);

                        let lowDaysAgo = 0;
                        if (minPeriodLow === currentPrice || minPeriodLow === minZ) {
                            const sidewaysLows = lows.slice(-sidewaysDays);
                            const sIdx = sidewaysLows.lastIndexOf(minPeriodLow);
                            lowDaysAgo = sIdx !== -1 ? (sidewaysLows.length - 1 - sIdx) : 0;
                        } else {
                            const minLowIdx = histLows.indexOf(minPeriodLow);
                            lowDaysAgo = minLowIdx !== -1 ? (periodKlines.length - 1 - minLowIdx) : 0;
                        }

                        let highDaysAgo = 0;
                        if (maxPeriodHigh === currentPrice || maxPeriodHigh === maxZ) {
                            const sidewaysHighs = highs.slice(-sidewaysDays);
                            const sIdx = sidewaysHighs.lastIndexOf(maxPeriodHigh);
                            highDaysAgo = sIdx !== -1 ? (sidewaysHighs.length - 1 - sIdx) : 0;
                        } else {
                            const maxHighIdx = histHighs.indexOf(maxPeriodHigh);
                            highDaysAgo = maxHighIdx !== -1 ? (periodKlines.length - 1 - maxHighIdx) : 0;
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
        const cached8am = getVolume8am(item.symbol);
        if (criterionId === 1) {
            // 24H 涨跌幅
            return item.change !== undefined && item.change !== null ? Number(item.change) : 0;
        } else if (criterionId === 2) {
            // 8H 涨跌幅 (今早8点起涨跌幅)
            const chg8am = item.change8am !== undefined && item.change8am !== null ? Number(item.change8am) : cached8am?.change8am;
            return chg8am !== undefined && !isNaN(chg8am) ? Number(chg8am) : (item.change !== undefined ? Number(item.change) : 0);
        } else if (criterionId === 3) {
            // 24H 交易额 (USDT, 百万M为单位)
            return Number(item.volume24h) || (Number(item.quoteVolume) ? Number(item.quoteVolume) / 1000000 : 0);
        } else if (criterionId === 4) {
            // 8H 交易额 (今早8点起交易额 USDT, 百万M为单位)
            const vol8am = item.volume8am !== undefined && item.volume8am !== null ? Number(item.volume8am) : cached8am?.volume8am;
            return vol8am !== undefined && !isNaN(vol8am) ? Number(vol8am) : 0;
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

    const sortedSymbolsKey = useMemo(() => sortedList1.map(i => i.symbol).filter(Boolean).join(','), [sortedList1]);

    // 保证总是批量拉取日K线获取真实8点数据以呈现在列表中，并支持8H涨跌幅/8H交易额排序
    useEffect(() => {
        const symbols = sortedList1.map(i => i.symbol).filter(Boolean);
        if (symbols.length > 0) {
            fetchVolume8amBatch(symbols);
        }
    }, [sortedSymbolsKey, _8amUpdateTick, scanConfig.enableVol8am, scanConfig.timeBasis, scanConfig.list2PushConfig?.topNSortKey, scanConfig.list2PushConfig?.enableTopN]);

    const filteredList = useMemo(() => {
        // 🔒 [第一步严格 24H 交易额与早上8点起交易额刚性拦截与过滤]:
        // 无论何种模式（是否开启大行情发现、启动趋势池等），在列表1向外输出的最终集合中，
        // 凡开启了 24H 交易额过滤（如 5M - 0），必须严格通过 24H 交易额区间校验，低于 minVolume 或高于 maxVolume 者一票否决！
        // 凡开启了早上8点起交易额过滤，必须严格通过北京时间早上8点到当前的交易额区间校验，后面为0无上限！
        const volumeFilteredList = sortedList1.filter(item => {
            return checkVolumeRule(item, scanConfig);
        });

        // 判断“行情启动趋势”是否处于活动状态（必须开启 enableStartTrend 总开关，且多或空至少开启一个）
        const isStartTrendActive = Boolean(
            scanConfig.majorTrend?.enableStartTrend &&
            (scanConfig.majorTrend?.enableStartTrendLong || scanConfig.majorTrend?.enableStartTrendShort)
        );
        const startTrendSymbolSet = (isStartTrendActive && startTrendPool && startTrendPool.length > 0) ? new Set(startTrendPool.map(p => p.symbol)) : null;

        // 🔒【行情启动趋势底池前置过滤】：
        // 1. 若行情启动趋势多/空开启且启动底池有数据，凡不在启动趋势底池中的币种过滤剔除；
        // 2. 若“行情启动趋势”关闭或底池为空，则不进行强制过滤拦截，保证市场初筛底池完整可用！
        const startTrendFilteredList = startTrendSymbolSet
            ? volumeFilteredList.filter(item => startTrendSymbolSet.has(item.symbol))
            : volumeFilteredList;

        // =========================================================================
        // 🌊 状态 1：当【大行情发现】关闭时，市场初筛列表按照【行情启动底池】规则过滤
        // 凡不再符合启动趋势规则的币种立即被剔除，不留存任何失效币种
        // =========================================================================
        let finalResult: ScannerItem[] = [];

        if (!scanConfig.majorTrend?.enabled) {
            finalResult = startTrendFilteredList;
        } else {
            // =========================================================================
            // 🌊 状态 2：当【大行情发现】开启时！
            // 🔒 [严格遵循数据流水线 - 用户指定规则]:
            // 1. ”成交额范围过滤“ 筛选出的符合规则币进入 ”交易额过滤底池“ (volumeFilteredList)
            // 2. ”行情启动趋势“ 读取 ”交易额过滤底池“ 的数据，筛选后的币进入 ”行情启动底池“ (startTrendFilteredList)
            // 3. ”大行情发现“ 的第一步，”横盘蓄势过滤“ 读取 ”行情启动底池“ 的数据，符合规则的币进入 ”横盘蓄势过滤底池“ (sidewaysFilteredList)
            // 4. ”回溯周期过滤“ 读取 “横盘蓄势过滤底池” 数据，符合规则的数据进行 “市场初筛” 列表！
            // =========================================================================
            const cfg = (scanConfig.majorTrend || {}) as any;
            const enableLong = cfg.enableLong !== false;
            const enableShort = cfg.enableShort !== false;
            const enableSideways = cfg.enableSideways === true; // 横盘蓄势开关
            const enableLookbackFilter = cfg.enableLookbackFilter !== false; // 回溯周期开关

            // 🎯 第一步的输入源：若行情启动开启，读取【行情启动底池】；若行情启动关闭，自动向上一级读取【交易额过滤底池】
            const baseMajorSource = startTrendFilteredList;

            // 🎯 第一步：横盘蓄势过滤
            // - 若开启【横盘蓄势过滤】，筛选出符合横盘规则的币进入 sidewaysFilteredList；
            // - 若关闭【横盘蓄势过滤】，自动向上一级底池获取数据——直接继承 baseMajorSource！
            let sidewaysFilteredList = baseMajorSource;
            if (enableSideways) {
                if (sidewaysPool && sidewaysPool.length > 0) {
                    const sidewaysSymbolSet = new Set(sidewaysPool.map(p => p.symbol));
                    sidewaysFilteredList = baseMajorSource.filter(item => sidewaysSymbolSet.has(item.symbol));
                } else {
                    sidewaysFilteredList = baseMajorSource.filter(item => {
                        const metrics = metricsCache[item.symbol];
                        if (!metrics || metrics.loading) return !isMajorScanning;
                        return metrics.isSidewaysMatch !== false;
                    });
                }
            }

            // 🎯 第二步：回溯周期过滤
            // - 若关闭【回溯周期过滤】，自动向上一级底池获取数据——直接使用 sidewaysFilteredList 作为最终初筛列表！
            // - 若开启【回溯周期过滤】，则读取上级底池数据 (sidewaysFilteredList)，筛选符合回溯极值规则的数据进入“市场初筛”！
            if (!enableLookbackFilter) {
                finalResult = sidewaysFilteredList;
            } else if (hasRunMajorTrend || (effectiveMajorCandidates && effectiveMajorCandidates.size > 0)) {
                // 🔒【用户特别强调的核心铁律】：
                // 市场初筛的币，【平时不要增减】，必须是“回溯周期过滤”运行完成后，再和市场初筛列表的数量进行比对！
                // 如果“回溯周期过滤”已产生候选集（或已完成扫描判定），市场初筛列表严格展示通过回溯周期过滤的有效候选集币种，
                // 绝不因中途底池扫描、日K重算或临时变量波动而发生清零或闪烁！
                const matchedList = sidewaysFilteredList.filter(item => {
                    const sym = item.symbol;
                    if (!sym) return false;
                    const matchLong = effectiveMajorCandidates.has(`${sym}_LONG`) || effectiveMajorCandidates.has(sym);
                    const matchShort = effectiveMajorCandidates.has(`${sym}_SHORT`) || effectiveMajorCandidates.has(sym);
                    if (enableLong && enableShort) return matchLong || matchShort;
                    if (enableLong) return matchLong;
                    if (enableShort) return matchShort;
                    return false;
                });
                finalResult = matchedList;
            } else if (isMajorScanning) {
                // 正在执行扫描中，等待扫描完成差量更新
                finalResult = [];
            } else if (sidewaysFilteredList.length > 0) {
                // 🔒 若尚未完成首次全量回溯扫描，先呈现横盘蓄势底池币种待扫描
                finalResult = sidewaysFilteredList;
            } else {
                // 兜底返回上级底池币种
                finalResult = baseMajorSource;
            }
        }

        // 🔒 [严格数量限制 (Limit)]: 若设置了数量限制 (limit > 0)，截取前 limit 个初筛币种展示与输出
        const limit = Number(scanConfig.limit);
        if (limit > 0 && finalResult.length > limit) {
            return finalResult.slice(0, limit);
        }

        return finalResult;
    }, [sortedList1, scanConfig.enableVol24h, scanConfig.minVolume, scanConfig.maxVolume, scanConfig.enableVol8am, scanConfig.minVolume8am, scanConfig.maxVolume8am, scanConfig.timeBasis, scanConfig.limit, scanConfig.majorTrend, isLong, metricsCache, majorTrendCandidates, localMajorTrendCandidates, effectiveMajorCandidates, hasRunMajorTrend, startTrendPool, sidewaysPool, isMajorScanning, _8amUpdateTick]);

    // 🚀 [核心引擎: 定向推送至列表2智能漏斗与选币过滤]
    const pushConfig = scanConfig.list2PushConfig;
    const isPushEffectivelyEnabled = Boolean(pushConfig?.enabled || pushConfig?.enableTopN || pushConfig?.enableChg24h || pushConfig?.enableChg8am || pushConfig?.enableVol24h || pushConfig?.enableVol8am);

    const list2PushCandidates = useMemo(() => {
        if (!pushConfig || !isPushEffectivelyEnabled) {
            // 未启用定向推送时，默认初筛列表全量直接进入列表2
            return filteredList;
        }

        // 统一提取24H交易额 (单位: 百万M USDT)
        const getVol24 = (item: ScannerItem): number => {
            if (item.volume24h !== undefined && item.volume24h !== null && !isNaN(Number(item.volume24h)) && Number(item.volume24h) > 0) {
                return Number(item.volume24h);
            }
            if (item.quoteVolume !== undefined && item.quoteVolume !== null && !isNaN(Number(item.quoteVolume))) {
                const qv = Number(item.quoteVolume);
                return qv > 10000 ? qv / 1_000_000 : qv;
            }
            if (item.price && item.volume) {
                const pv = Number(item.price) * Number(item.volume);
                return pv > 10000 ? pv / 1_000_000 : pv;
            }
            return 0;
        };

        // 统一提取8AM交易额 (单位: 百万M USDT)
        const getVol8 = (item: ScannerItem): number => {
            const v8 = getVolume8am(item.symbol);
            if (v8?.volume8am !== undefined && !isNaN(Number(v8.volume8am))) {
                return Number(v8.volume8am);
            }
            if (item.volume8am !== undefined && item.volume8am !== null && !isNaN(Number(item.volume8am))) {
                return Number(item.volume8am);
            }
            return 0;
        };

        // 统一提取24H涨跌幅 (%)
        const getChg24 = (item: ScannerItem): number => {
            return item.change !== undefined && !isNaN(Number(item.change)) ? Number(item.change) : 0;
        };

        // 统一提取8AM涨跌幅 (%)，优先使用日K8AM计算值，兜底降级至当前24H涨跌幅
        const getChg8 = (item: ScannerItem): number => {
            const v8 = getVolume8am(item.symbol);
            if (v8?.change8am !== undefined && !isNaN(Number(v8.change8am))) {
                return Number(v8.change8am);
            }
            if (item.change8am !== undefined && item.change8am !== null && !isNaN(Number(item.change8am))) {
                return Number(item.change8am);
            }
            return item.change !== undefined && !isNaN(Number(item.change)) ? Number(item.change) : 0;
        };

        // 1. 获取已启用的过滤指标判断条件
        const activeFilterChecks: ((item: ScannerItem) => boolean)[] = [];

        if (pushConfig.enableChg24h) {
            const minVal = Number(pushConfig.minChg24h) || 0;
            activeFilterChecks.push((item) => {
                return Math.abs(getChg24(item)) >= minVal;
            });
        }

        if (pushConfig.enableChg8am) {
            const minVal = Number(pushConfig.minChg8am) || 0;
            activeFilterChecks.push((item) => {
                return Math.abs(getChg8(item)) >= minVal;
            });
        }

        if (pushConfig.enableVol24h) {
            const minVal = Number(pushConfig.minVol24h) || 0;
            activeFilterChecks.push((item) => {
                return getVol24(item) >= minVal;
            });
        }

        if (pushConfig.enableVol8am) {
            const minVal = Number(pushConfig.minVol8am) || 0;
            activeFilterChecks.push((item) => {
                return getVol8(item) >= minVal;
            });
        }

        // 第一步：根据 OR / AND 模式执行指标阈值过滤
        let candidates = filteredList.filter(item => {
            if (activeFilterChecks.length === 0) return true; // 未勾选任何门槛条件时默认全部通过第一步
            if (pushConfig.mode === 'AND') {
                return activeFilterChecks.every(check => check(item));
            } else {
                return activeFilterChecks.some(check => check(item));
            }
        });

        // 第二步：根据头部排序规则进行 Top N 排名截取
        if (pushConfig.enableTopN && candidates.length > 0) {
            const sortKey = pushConfig.topNSortKey || 'CHG_8AM_ABS';
            const count = Math.max(1, Number(pushConfig.topNCount) || 10);

            const sorted = [...candidates].sort((a, b) => {
                const chg24_a = getChg24(a);
                const chg24_b = getChg24(b);
                const chg8_a = getChg8(a);
                const chg8_b = getChg8(b);
                const vol24_a = getVol24(a);
                const vol24_b = getVol24(b);
                const vol8_a = getVol8(a);
                const vol8_b = getVol8(b);

                let diff = 0;
                switch (sortKey) {
                    case 'CHG_24H_ABS':
                        diff = Math.abs(chg24_b) - Math.abs(chg24_a);
                        break;
                    case 'CHG_8AM_ABS':
                        diff = Math.abs(chg8_b) - Math.abs(chg8_a);
                        break;
                    case 'VOL_24H':
                        diff = vol24_b - vol24_a;
                        break;
                    case 'VOL_8AM':
                        diff = vol8_b - vol8_a;
                        break;
                    case 'CHG_24H_DESC':
                        diff = chg24_b - chg24_a;
                        break;
                    case 'CHG_24H_ASC':
                        diff = chg24_a - chg24_b;
                        break;
                    case 'CHG_8AM_DESC':
                        diff = chg8_b - chg8_a;
                        break;
                    case 'CHG_8AM_ASC':
                        diff = chg8_a - chg8_b;
                        break;
                    default:
                        diff = Math.abs(chg8_b) - Math.abs(chg8_a);
                        break;
                }

                if (diff !== 0) return diff;
                // 次级排序：交易额兜底，保证排序稳定性
                const secDiff = vol24_b - vol24_a;
                if (secDiff !== 0) return secDiff;
                return a.symbol.localeCompare(b.symbol);
            });

            candidates = sorted.slice(0, count);
        }

        return candidates;
    }, [filteredList, pushConfig, isPushEffectivelyEnabled, _8amUpdateTick]);

    // 映射 Top N 排名 (用于在初筛卡片上醒目标注 #1, #2, ...)
    const pushRankMap = useMemo(() => {
        const map = new Map<string, number>();
        if (pushConfig?.enableTopN || isPushEffectivelyEnabled) {
            list2PushCandidates.forEach((item, index) => {
                map.set(item.symbol, index + 1);
            });
        }
        return map;
    }, [list2PushCandidates, pushConfig?.enableTopN, isPushEffectivelyEnabled]);

    const lastFilteredStrRef = useRef('');

    useEffect(() => {
        if (onFilteredUpdate) {
            const str = list2PushCandidates.map(i => i.symbol).join(',');
            if (str !== lastFilteredStrRef.current) {
                lastFilteredStrRef.current = str;
                onFilteredUpdate(list2PushCandidates);
            }
        }
    }, [list2PushCandidates, onFilteredUpdate]);

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
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onDeleteStrategy(strat.id);
                                                    }}
                                                    className="text-slate-500 hover:text-red-400 p-0.5 rounded cursor-pointer transition-colors"
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
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onAddStrategy();
                        }}
                        className="bg-slate-800/60 hover:bg-slate-800 hover:text-indigo-400 text-slate-400 rounded p-1 transition-all cursor-pointer border border-transparent hover:border-indigo-500/20 flex items-center justify-center"
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
                    <div className="text-xs font-mono font-bold text-white bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">{filteredList.length}</div>
                    <button 
                        onClick={() => setShowVisualizer(true)}
                        className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-indigo-400 transition-all border border-transparent hover:border-indigo-500/30"
                        title="放大查看 K 线大图"
                    >
                        <Maximize2 size={12} />
                    </button>
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

            {/* 🚀 定向推送至列表2 (扫描漏斗总控面板) */}
            <div className="px-3 py-2 bg-slate-950/80 border-b border-indigo-900/40 text-[10px] space-y-2">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 cursor-pointer select-none" onClick={() => setIsPushConfigOpen(!isPushConfigOpen)}>
                        <button 
                            type="button"
                            className="text-slate-400 hover:text-slate-200 transition-transform"
                        >
                            {isPushConfigOpen ? <ChevronDown size={13} className="text-indigo-400" /> : <ChevronRight size={13} className="text-indigo-400" />}
                        </button>
                        <span className="font-extrabold text-indigo-300 flex items-center gap-1 text-[10.5px]">
                            <Send size={11} className="text-indigo-400" /> 定向推送至列表2 (趋势漏斗)
                        </span>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* 实时命中统计反馈 (可点击切换：仅看推送截取 / 查看全量初筛) */}
                        <button
                            type="button"
                            onClick={() => setViewOnlyPushed(prev => !prev)}
                            className={`flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border transition-all cursor-pointer ${
                                viewOnlyPushed 
                                    ? 'bg-amber-950/60 border-amber-500/60 text-amber-300 ring-1 ring-amber-500/40' 
                                    : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                            }`}
                            title={viewOnlyPushed ? "当前为仅看推送截取币种，点击切回全量初筛" : "点击仅看定向截取推送池"}
                        >
                            <span className="text-slate-500">推送池:</span>
                            <span className={`font-bold ${isPushEffectivelyEnabled ? 'text-amber-400' : 'text-slate-300'}`}>
                                {list2PushCandidates.length}
                            </span>
                            <span className="text-slate-600">/</span>
                            <span className="text-slate-400">{filteredList.length} 币</span>
                            {viewOnlyPushed && <span className="text-[7.5px] bg-amber-500 text-black px-1 rounded font-black ml-0.5">仅看推送</span>}
                        </button>

                        {/* 定向推送总开关 */}
                        <label className="flex items-center gap-1 cursor-pointer select-none">
                            <input 
                                type="checkbox"
                                checked={!!(pushConfig?.enabled || pushConfig?.enableTopN)}
                                onChange={(e) => {
                                    const checked = e.target.checked;
                                    setScanConfig(prev => ({
                                        ...prev,
                                        list2PushConfig: {
                                            ...(prev.list2PushConfig || {
                                                mode: 'OR',
                                                enableChg24h: false,
                                                minChg24h: 5.0,
                                                enableChg8am: true,
                                                minChg8am: 3.0,
                                                enableVol24h: false,
                                                minVol24h: 30.0,
                                                enableVol8am: false,
                                                minVol8am: 15.0,
                                                topNCount: 10,
                                                topNSortKey: 'CHG_8AM_ABS',
                                            }),
                                            enabled: checked,
                                            enableTopN: checked ? (prev.list2PushConfig?.enableTopN ?? true) : false,
                                        }
                                    }));
                                }}
                                className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-700 bg-slate-800 accent-indigo-500 cursor-pointer"
                            />
                            <span className={`font-bold text-[9.5px] ${isPushEffectivelyEnabled ? 'text-indigo-300' : 'text-slate-400'}`}>
                                {isPushEffectivelyEnabled ? '已开启定向' : '全量直推'}
                            </span>
                        </label>
                    </div>
                </div>

                {isPushConfigOpen && (
                    <div className="pt-1.5 border-t border-slate-800/60 space-y-2 animate-in fade-in">
                        {/* 1. 过滤逻辑模式 (单选/多选 + OR/AND) */}
                        <div className="flex items-center justify-between text-[9px]">
                            <span className="text-slate-400 font-bold flex items-center gap-1">
                                <Filter size={10} className="text-indigo-400" /> ① 趋势门槛过滤 (多选/单选):
                            </span>
                            <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded border border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => setScanConfig(prev => ({
                                        ...prev,
                                        list2PushConfig: {
                                            ...(prev.list2PushConfig || {
                                                enabled: true,
                                                enableChg24h: false, minChg24h: 5.0,
                                                enableChg8am: true, minChg8am: 3.0,
                                                enableVol24h: false, minVol24h: 30.0,
                                                enableVol8am: false, minVol8am: 15.0,
                                                enableTopN: true, topNCount: 10, topNSortKey: 'CHG_8AM_ABS'
                                            }),
                                            mode: 'OR'
                                        }
                                    }))}
                                    className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold transition-all ${pushConfig?.mode !== 'AND' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
                                    title="满足任意勾选的一项即推入列表2"
                                >
                                    任意满足 (OR)
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setScanConfig(prev => ({
                                        ...prev,
                                        list2PushConfig: {
                                            ...(prev.list2PushConfig || {
                                                enabled: true,
                                                enableChg24h: false, minChg24h: 5.0,
                                                enableChg8am: true, minChg8am: 3.0,
                                                enableVol24h: false, minVol24h: 30.0,
                                                enableVol8am: false, minVol8am: 15.0,
                                                enableTopN: true, topNCount: 10, topNSortKey: 'CHG_8AM_ABS'
                                            }),
                                            mode: 'AND'
                                        }
                                    }))}
                                    className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold transition-all ${pushConfig?.mode === 'AND' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
                                    title="必须同时满足所有已勾选的条件才推入列表2"
                                >
                                    全部满足 (AND)
                                </button>
                            </div>
                        </div>

                        {/* 四项独立可配指标卡片 */}
                        <div className="grid grid-cols-2 gap-1.5">
                            {/* 条件 1: 24H 涨跌幅 */}
                            <div className={`p-1.5 rounded border transition-all flex items-center justify-between ${pushConfig?.enableChg24h ? 'bg-indigo-950/20 border-indigo-500/40' : 'bg-slate-900/50 border-slate-800/80'}`}>
                                <label className="flex items-center gap-1 cursor-pointer select-none">
                                    <input 
                                        type="checkbox"
                                        checked={!!pushConfig?.enableChg24h}
                                        onChange={(e) => {
                                            const val = e.target.checked;
                                            setScanConfig(prev => ({
                                                ...prev,
                                                list2PushConfig: {
                                                    ...(prev.list2PushConfig || {
                                                        enabled: true, mode: 'OR', minChg24h: 5.0, enableChg8am: true, minChg8am: 3.0, enableVol24h: false, minVol24h: 30.0, enableVol8am: false, minVol8am: 15.0, enableTopN: true, topNCount: 10, topNSortKey: 'CHG_8AM_ABS'
                                                    }),
                                                    enableChg24h: val
                                                }
                                            }));
                                        }}
                                        className="w-3 h-3 rounded accent-indigo-500 cursor-pointer"
                                    />
                                    <span className="text-[9px] font-bold text-slate-300">24H 涨跌幅 ≥</span>
                                </label>
                                <div className="flex items-center gap-0.5">
                                    <input 
                                        type="number"
                                        step="0.5"
                                        value={pushConfig?.minChg24h ?? 5.0}
                                        onChange={(e) => {
                                            const v = parseFloat(e.target.value) || 0;
                                            setScanConfig(prev => ({
                                                ...prev,
                                                list2PushConfig: {
                                                    ...(prev.list2PushConfig || {
                                                        enabled: true, mode: 'OR', enableChg24h: true, enableChg8am: true, minChg8am: 3.0, enableVol24h: false, minVol24h: 30.0, enableVol8am: false, minVol8am: 15.0, enableTopN: true, topNCount: 10, topNSortKey: 'CHG_8AM_ABS'
                                                    }),
                                                    minChg24h: v
                                                }
                                            }));
                                        }}
                                        className="w-10 bg-slate-950 border border-slate-700 text-indigo-300 font-mono text-[9px] text-right px-1 py-0.5 rounded"
                                    />
                                    <span className="text-[9px] text-slate-400 font-bold">%</span>
                                </div>
                            </div>

                            {/* 条件 2: 8AM 涨跌幅 */}
                            <div className={`p-1.5 rounded border transition-all flex items-center justify-between ${pushConfig?.enableChg8am ? 'bg-indigo-950/20 border-indigo-500/40' : 'bg-slate-900/50 border-slate-800/80'}`}>
                                <label className="flex items-center gap-1 cursor-pointer select-none">
                                    <input 
                                        type="checkbox"
                                        checked={!!pushConfig?.enableChg8am}
                                        onChange={(e) => {
                                            const val = e.target.checked;
                                            setScanConfig(prev => ({
                                                ...prev,
                                                list2PushConfig: {
                                                    ...(prev.list2PushConfig || {
                                                        enabled: true, mode: 'OR', enableChg24h: false, minChg24h: 5.0, minChg8am: 3.0, enableVol24h: false, minVol24h: 30.0, enableVol8am: false, minVol8am: 15.0, enableTopN: true, topNCount: 10, topNSortKey: 'CHG_8AM_ABS'
                                                    }),
                                                    enableChg8am: val
                                                }
                                            }));
                                        }}
                                        className="w-3 h-3 rounded accent-indigo-500 cursor-pointer"
                                    />
                                    <span className="text-[9px] font-bold text-blue-300">8AM 涨跌幅 ≥</span>
                                </label>
                                <div className="flex items-center gap-0.5">
                                    <input 
                                        type="number"
                                        step="0.5"
                                        value={pushConfig?.minChg8am ?? 3.0}
                                        onChange={(e) => {
                                            const v = parseFloat(e.target.value) || 0;
                                            setScanConfig(prev => ({
                                                ...prev,
                                                list2PushConfig: {
                                                    ...(prev.list2PushConfig || {
                                                        enabled: true, mode: 'OR', enableChg24h: false, minChg24h: 5.0, enableChg8am: true, enableVol24h: false, minVol24h: 30.0, enableVol8am: false, minVol8am: 15.0, enableTopN: true, topNCount: 10, topNSortKey: 'CHG_8AM_ABS'
                                                    }),
                                                    minChg8am: v
                                                }
                                            }));
                                        }}
                                        className="w-10 bg-slate-950 border border-slate-700 text-blue-300 font-mono text-[9px] text-right px-1 py-0.5 rounded"
                                    />
                                    <span className="text-[9px] text-slate-400 font-bold">%</span>
                                </div>
                            </div>

                            {/* 条件 3: 24H 交易额 */}
                            <div className={`p-1.5 rounded border transition-all flex items-center justify-between ${pushConfig?.enableVol24h ? 'bg-indigo-950/20 border-indigo-500/40' : 'bg-slate-900/50 border-slate-800/80'}`}>
                                <label className="flex items-center gap-1 cursor-pointer select-none">
                                    <input 
                                        type="checkbox"
                                        checked={!!pushConfig?.enableVol24h}
                                        onChange={(e) => {
                                            const val = e.target.checked;
                                            setScanConfig(prev => ({
                                                ...prev,
                                                list2PushConfig: {
                                                    ...(prev.list2PushConfig || {
                                                        enabled: true, mode: 'OR', enableChg24h: false, minChg24h: 5.0, enableChg8am: true, minChg8am: 3.0, minVol24h: 30.0, enableVol8am: false, minVol8am: 15.0, enableTopN: true, topNCount: 10, topNSortKey: 'CHG_8AM_ABS'
                                                    }),
                                                    enableVol24h: val
                                                }
                                            }));
                                        }}
                                        className="w-3 h-3 rounded accent-indigo-500 cursor-pointer"
                                    />
                                    <span className="text-[9px] font-bold text-slate-300">24H 交易额 ≥</span>
                                </label>
                                <div className="flex items-center gap-0.5">
                                    <input 
                                        type="number"
                                        step="5"
                                        value={pushConfig?.minVol24h ?? 30.0}
                                        onChange={(e) => {
                                            const v = parseFloat(e.target.value) || 0;
                                            setScanConfig(prev => ({
                                                ...prev,
                                                list2PushConfig: {
                                                    ...(prev.list2PushConfig || {
                                                        enabled: true, mode: 'OR', enableChg24h: false, minChg24h: 5.0, enableChg8am: true, minChg8am: 3.0, enableVol24h: true, enableVol8am: false, minVol8am: 15.0, enableTopN: true, topNCount: 10, topNSortKey: 'CHG_8AM_ABS'
                                                    }),
                                                    minVol24h: v
                                                }
                                            }));
                                        }}
                                        className="w-10 bg-slate-950 border border-slate-700 text-indigo-300 font-mono text-[9px] text-right px-1 py-0.5 rounded"
                                    />
                                    <span className="text-[9px] text-slate-400 font-bold">M</span>
                                </div>
                            </div>

                            {/* 条件 4: 8AM 交易额 */}
                            <div className={`p-1.5 rounded border transition-all flex items-center justify-between ${pushConfig?.enableVol8am ? 'bg-indigo-950/20 border-indigo-500/40' : 'bg-slate-900/50 border-slate-800/80'}`}>
                                <label className="flex items-center gap-1 cursor-pointer select-none">
                                    <input 
                                        type="checkbox"
                                        checked={!!pushConfig?.enableVol8am}
                                        onChange={(e) => {
                                            const val = e.target.checked;
                                            setScanConfig(prev => ({
                                                ...prev,
                                                list2PushConfig: {
                                                    ...(prev.list2PushConfig || {
                                                        enabled: true, mode: 'OR', enableChg24h: false, minChg24h: 5.0, enableChg8am: true, minChg8am: 3.0, enableVol24h: false, minVol24h: 30.0, minVol8am: 15.0, enableTopN: true, topNCount: 10, topNSortKey: 'CHG_8AM_ABS'
                                                    }),
                                                    enableVol8am: val
                                                }
                                            }));
                                        }}
                                        className="w-3 h-3 rounded accent-indigo-500 cursor-pointer"
                                    />
                                    <span className="text-[9px] font-bold text-blue-300">8AM 交易额 ≥</span>
                                </label>
                                <div className="flex items-center gap-0.5">
                                    <input 
                                        type="number"
                                        step="5"
                                        value={pushConfig?.minVol8am ?? 15.0}
                                        onChange={(e) => {
                                            const v = parseFloat(e.target.value) || 0;
                                            setScanConfig(prev => ({
                                                ...prev,
                                                list2PushConfig: {
                                                    ...(prev.list2PushConfig || {
                                                        enabled: true, mode: 'OR', enableChg24h: false, minChg24h: 5.0, enableChg8am: true, minChg8am: 3.0, enableVol24h: false, minVol24h: 30.0, enableVol8am: true, enableTopN: true, topNCount: 10, topNSortKey: 'CHG_8AM_ABS'
                                                    }),
                                                    minVol8am: v
                                                }
                                            }));
                                        }}
                                        className="w-10 bg-slate-950 border border-slate-700 text-blue-300 font-mono text-[9px] text-right px-1 py-0.5 rounded"
                                    />
                                    <span className="text-[9px] text-slate-400 font-bold">M</span>
                                </div>
                            </div>
                        </div>

                        {/* 2. Top N 头部排名截取 */}
                        <div className={`p-1.5 rounded border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 ${pushConfig?.enableTopN ? 'bg-indigo-950/30 border-indigo-500/50' : 'bg-slate-900/50 border-slate-800/80'}`}>
                            <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                <input 
                                    type="checkbox"
                                    checked={!!pushConfig?.enableTopN}
                                    onChange={(e) => {
                                        const val = e.target.checked;
                                        setScanConfig(prev => ({
                                            ...prev,
                                            list2PushConfig: {
                                                ...(prev.list2PushConfig || {
                                                    enabled: true, mode: 'OR', enableChg24h: false, minChg24h: 5.0, enableChg8am: true, minChg8am: 3.0, enableVol24h: false, minVol24h: 30.0, enableVol8am: false, minVol8am: 15.0, topNCount: 10, topNSortKey: 'CHG_8AM_ABS'
                                                }),
                                                enableTopN: val
                                            }
                                        }));
                                    }}
                                    className="w-3.5 h-3.5 rounded accent-indigo-500 cursor-pointer"
                                />
                                <span className="text-[9.5px] font-extrabold text-amber-300">② 排列前几位截取 (Top N):</span>
                            </label>

                            <div className="flex items-center gap-1.5">
                                <select
                                    value={pushConfig?.topNSortKey || 'CHG_8AM_ABS'}
                                    onChange={(e) => {
                                        const key = e.target.value as any;
                                        setScanConfig(prev => ({
                                            ...prev,
                                            list2PushConfig: {
                                                ...(prev.list2PushConfig || {
                                                    enabled: true, mode: 'OR', enableChg24h: false, minChg24h: 5.0, enableChg8am: true, minChg8am: 3.0, enableVol24h: false, minVol24h: 30.0, enableVol8am: false, minVol8am: 15.0, enableTopN: true, topNCount: 10
                                                }),
                                                topNSortKey: key
                                            }
                                        }));
                                    }}
                                    className="bg-slate-950 border border-slate-700 text-slate-200 text-[9px] font-bold rounded px-1.5 py-0.5 outline-none"
                                >
                                    <option value="CHG_8AM_ABS">8AM 涨跌幅绝对值 (动能)</option>
                                    <option value="CHG_24H_ABS">24H 涨跌幅绝对值 (全天)</option>
                                    <option value="VOL_8AM">8AM 成交额 (今日热钱)</option>
                                    <option value="VOL_24H">24H 成交额 (全天流动性)</option>
                                    <option value="CHG_8AM_DESC">8AM 纯涨幅 (多头最强)</option>
                                    <option value="CHG_8AM_ASC">8AM 纯跌幅 (空头最强)</option>
                                    <option value="CHG_24H_DESC">24H 纯涨幅 (涨幅榜)</option>
                                    <option value="CHG_24H_ASC">24H 纯跌幅 (跌幅榜)</option>
                                </select>

                                <div className="flex items-center gap-1">
                                    <span className="text-[9px] text-slate-400 font-bold">前</span>
                                    <input 
                                        type="number"
                                        min="1"
                                        max="100"
                                        value={pushConfig?.topNCount ?? 10}
                                        onChange={(e) => {
                                            const v = Math.max(1, parseInt(e.target.value) || 1);
                                            setScanConfig(prev => ({
                                                ...prev,
                                                list2PushConfig: {
                                                    ...(prev.list2PushConfig || {
                                                        enabled: true, mode: 'OR', enableChg24h: false, minChg24h: 5.0, enableChg8am: true, minChg8am: 3.0, enableVol24h: false, minVol24h: 30.0, enableVol8am: false, minVol8am: 15.0, enableTopN: true, topNSortKey: 'CHG_8AM_ABS'
                                                    }),
                                                    topNCount: v
                                                }
                                            }));
                                        }}
                                        className="w-10 bg-slate-950 border border-slate-700 text-amber-300 font-mono text-[9px] text-center px-1 py-0.5 rounded font-bold"
                                    />
                                    <span className="text-[9px] text-slate-400 font-bold">名</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

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
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
                        {[
                            { id: 1, label: '24H涨跌幅', fullLabel: '24小时涨跌幅 (支持 ↑ 从小到大 / ↓ 从大到小)' },
                            { id: 2, label: '8H涨跌幅', fullLabel: '北京时间今早8点起涨跌幅 (支持 ↑ 从小到大 / ↓ 从大到小)' },
                            { id: 3, label: '24H交易额', fullLabel: '过去24小时全量交易额 (支持 ↑ 从小到大 / ↓ 从大到小)' },
                            { id: 4, label: '8H交易额', fullLabel: '北京时间今早8点起交易额 (支持 ↑ 从小到大 / ↓ 从大到小)' }
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
                                        title={order === 'asc' ? '从小到大 (↑)' : '从大到小 (↓)'}
                                    >
                                        {order === 'asc' ? '↑' : '↓'}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Top N 截取生效提示条 */}
            {(pushConfig?.enableTopN || isPushEffectivelyEnabled) && (
                <div className="flex items-center justify-between px-3 py-1 bg-indigo-950/40 border-b border-indigo-500/30 text-[9px]">
                    <div className="flex items-center gap-1 text-slate-300 font-mono">
                        <span className="text-amber-300 font-bold">🎯 {pushConfig?.enableTopN ? `Top ${pushConfig?.topNCount || 10} 截取生效:` : '定向推送规则生效:'}</span>
                        <span className="text-indigo-200 font-bold">
                            {(() => {
                                switch (pushConfig?.topNSortKey) {
                                    case 'CHG_8AM_ABS': return '8AM 涨跌幅绝对值 (动能)';
                                    case 'CHG_24H_ABS': return '24H 涨跌幅绝对值 (全天)';
                                    case 'VOL_8AM': return '8AM 成交额 (今日热钱)';
                                    case 'VOL_24H': return '24H 成交额 (全天流动性)';
                                    case 'CHG_8AM_DESC': return '8AM 纯涨幅 (多头最强)';
                                    case 'CHG_8AM_ASC': return '8AM 纯跌幅 (空头最强)';
                                    case 'CHG_24H_DESC': return '24H 纯涨幅 (涨幅榜)';
                                    case 'CHG_24H_ASC': return '24H 纯跌幅 (跌幅榜)';
                                    default: return '8AM 涨跌幅绝对值';
                                }
                            })()}
                        </span>
                        <span className="text-slate-400 font-normal">({list2PushCandidates.length} 币命中推向列表2)</span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setViewOnlyPushed(p => !p)}
                        className={`text-[8.5px] font-bold px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                            viewOnlyPushed 
                                ? 'bg-amber-600 text-white border-amber-400 shadow-sm' 
                                : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
                        }`}
                        title={viewOnlyPushed ? "点击查看全量初筛列表" : "点击仅查看被截取推入列表2的币种"}
                    >
                        {viewOnlyPushed ? '切回全量初筛' : '仅看推送截取'}
                    </button>
                </div>
            )}

            {filteredList.length > 0 && (
                <div className="px-3 py-1 bg-slate-900/60 border-b border-slate-800/80 flex items-center text-[9px] font-bold text-slate-400 font-mono">
                    <div className="flex items-center gap-1.5 shrink-0">
                        <div className="w-[30px] text-left shrink-0 text-slate-500">#</div>
                        <div className="w-[52px] text-left shrink-0 text-slate-300">币种</div>
                        <div className="flex items-center gap-1 shrink-0">
                            <div className="w-[96px] text-center text-slate-400">24H (涨跌/额)</div>
                            <span className="text-slate-700 font-normal px-0.5">|</span>
                            <div className="w-[96px] text-center text-blue-300/80">8AM (涨跌/额)</div>
                        </div>
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
                    (viewOnlyPushed ? list2PushCandidates : filteredList).map((item, idx) => (
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
                            pushRank={pushRankMap.get(item.symbol)}
                        />
                    ))
                )}
            </div>
        </div>
    );
};

export default List1_Selection;
