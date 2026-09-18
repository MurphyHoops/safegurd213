import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ScanConfig } from '../../../components/Scanner/scannerTypes';
import { Layers, ChevronDown, ChevronUp, Copy, Check, RefreshCw, Search, Database, Clock } from 'lucide-react';
import { usePersistedState } from '../../../hooks/usePersistedState';
import { pipelineCoordinator } from '../../../services/pipelineQueue';
import { fetchWithFallback } from '../../../services/apiService';
import { getVolume8am, fetchVolume8amBatch, checkVolumeRule } from '../../../services/volume8amService';

interface Props {
    scanConfig: ScanConfig;
}

interface VolumePoolItem {
    symbol: string;
    volume24h: number; // in Millions
    change24h: number; // in %
    price: number;
    volume8am?: number;
    change8am?: number;
}


export const VolumePoolBox: React.FC<Props> = ({ scanConfig }) => {
    const [isCollapsed, setIsCollapsed] = usePersistedState<boolean>('SCANNER_VOLUME_POOL_COLLAPSED', false);
    const [searchTerm, setSearchTerm] = useState('');
    const [copied, setCopied] = useState(false);
    const [isFetching, setIsFetching] = useState(false);
    const [rawPool, setRawPool] = useState<VolumePoolItem[]>([]);
    const [isAutoSync, setIsAutoSync] = usePersistedState<boolean>('SCANNER_VOLUME_POOL_AUTO_SYNC', true);
    const [syncIntervalMin, setSyncIntervalMin] = usePersistedState<number>('SCANNER_VOLUME_POOL_SYNC_INTERVAL_MIN', 5);
    const [isEditingInterval, setIsEditingInterval] = useState(false);
    const [feedbackSymbols, setFeedbackSymbols] = useState<string[]>(() => {
        try {
            const raw = localStorage.getItem('SCANNER_MAJOR_TREND_CANDIDATES');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    return Array.from(new Set(parsed.map((s: string) => String(s).replace('_LONG', '').replace('_SHORT', '')).filter(Boolean)));
                }
            }
        } catch (_) {}
        return [];
    });
    const isMountedRef = useRef(true);

    useEffect(() => {
        isMountedRef.current = true;

        const handleCandidatesUpdate = (e: any) => {
            const list = e.detail;
            if (Array.isArray(list)) {
                const clean = Array.from(new Set(list.map((s: string) => String(s).replace('_LONG', '').replace('_SHORT', '')).filter(Boolean))) as string[];
                setFeedbackSymbols(clean);
            } else {
                try {
                    const raw = localStorage.getItem('SCANNER_MAJOR_TREND_CANDIDATES');
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        if (Array.isArray(parsed)) {
                            const clean = Array.from(new Set(parsed.map((s: string) => String(s).replace('_LONG', '').replace('_SHORT', '')).filter(Boolean))) as string[];
                            setFeedbackSymbols(clean);
                        }
                    }
                } catch (_) {}
            }
        };

        window.addEventListener('scanner_major_trend_candidates_updated', handleCandidatesUpdate);
        window.addEventListener('scanner_major_trend_completed', handleCandidatesUpdate);

        return () => { 
            isMountedRef.current = false; 
            window.removeEventListener('scanner_major_trend_candidates_updated', handleCandidatesUpdate);
            window.removeEventListener('scanner_major_trend_completed', handleCandidatesUpdate);
        };
    }, []);

    // Load & filter symbols from raw Binance data cache or API
    const loadFromCache = () => {
        try {
            const raw = localStorage.getItem('SCANNER_RAW_DATA_CACHE');
            if (raw) {
                const parsed = JSON.parse(raw);
                // 检查是否混入了现货数据（如包含 ETHBTC 或非合约币），如果是则作废旧缓存并强制重新拉取永续合约数据
                const isSpotCache = Array.isArray(parsed) && parsed.some((d: any) => d && (d.symbol === 'ETHBTC' || d.symbol === 'BNBBTC'));
                if (isSpotCache) {
                    try { localStorage.removeItem('SCANNER_RAW_DATA_CACHE'); } catch (_) {}
                    fetchLatestTickers();
                    return;
                }
                if (Array.isArray(parsed)) {
                    const items: VolumePoolItem[] = parsed
                        .filter((d: any) => d && d.symbol && d.symbol.endsWith('USDT'))
                        .map((d: any) => {
                            const rawQuoteVol = parseFloat(d.quoteVolume || '0');
                            const volM = +(rawQuoteVol / 1000000).toFixed(2);
                            return {
                                symbol: d.symbol,
                                volume24h: volM,
                                change24h: parseFloat(d.priceChangePercent || d.change || '0') || 0,
                                price: parseFloat(d.lastPrice || d.close || '0') || 0
                            };
                        });
                    setRawPool(items);
                    return;
                }
            }
        } catch (e) {
            console.warn('[VolumePoolBox] Failed to parse raw data cache', e);
        }
        fetchLatestTickers();
    };

    useEffect(() => {
        loadFromCache();

        // Listen for storage or scan refresh events
        const handleStorageUpdate = (e: StorageEvent) => {
            if (e.key === 'SCANNER_RAW_DATA_CACHE') {
                loadFromCache();
            }
        };
        window.addEventListener('storage', handleStorageUpdate);
        return () => window.removeEventListener('storage', handleStorageUpdate);
    }, []);

    // Fetch latest tickers from Binance
    const fetchLatestTickers = async () => {
        if (!isMountedRef.current) return;
        setIsFetching(true);
        // 🔒 [永不清零·平滑差量更新铁律]: 严禁在拉取时清空既有数据，保留现有池直至新数据到达无缝替换
        // setRawPool([]) 彻底移除，杜绝中途清空与闪烁
        try {
            const res = await fetchWithFallback(`https://fapi.binance.com/fapi/v1/ticker/24hr?_t=${Date.now()}`);
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && isMountedRef.current) {
                    localStorage.setItem('SCANNER_RAW_DATA_CACHE', JSON.stringify(data));
                    const items: VolumePoolItem[] = data
                        .filter((d: any) => d && d.symbol && d.symbol.endsWith('USDT'))
                        .map((d: any) => {
                            const quoteVol = parseFloat(d.quoteVolume || '0');
                            const volM = +(quoteVol / 1000000).toFixed(2);
                            return {
                                symbol: d.symbol,
                                volume24h: volM,
                                change24h: parseFloat(d.priceChangePercent || '0') || 0,
                                price: parseFloat(d.lastPrice || '0') || 0
                            };
                        });
                    setRawPool(items);
                }
            }
        } catch (err) {
            console.warn('[VolumePoolBox] Fetch tickers warning:', err);
        } finally {
            if (isMountedRef.current) {
                setIsFetching(false);
            }
        }
    };

    // Schedule through Pipeline Coordinator
    const triggerScheduledFetch = () => {
        pipelineCoordinator.enqueue('volume_pool', async () => {
            await fetchLatestTickers();
        });
    };

    // Auto-sync Interval (Default: 5 minutes)
    useEffect(() => {
        if (!isAutoSync) return;

        const intervalMs = Math.max(1, syncIntervalMin || 5) * 60 * 1000;

        // Auto trigger initial check if cache is empty
        if (rawPool.length === 0) {
            triggerScheduledFetch();
        }

        const interval = setInterval(() => {
            if (isMountedRef.current && isAutoSync) {
                triggerScheduledFetch();
            }
        }, intervalMs);

        return () => clearInterval(interval);
    }, [isAutoSync, syncIntervalMin, rawPool.length]);

    // 📡 监听早上8点起缓存数据实时更新事件
    const [_8amTick, set8amTick] = useState(0);
    useEffect(() => {
        const handle8amUpdate = () => {
            set8amTick(t => t + 1);
        };
        window.addEventListener('scanner_8am_cache_updated', handle8amUpdate);
        return () => {
            window.removeEventListener('scanner_8am_cache_updated', handle8amUpdate);
        };
    }, []);

    // 当开启“早上8点起”或8AM模式且底池有币时，自动批量拉取 8AM 日K线数据
    useEffect(() => {
        if ((scanConfig.enableVol8am || scanConfig.timeBasis === '8AM') && rawPool.length > 0) {
            const symbols = rawPool.map(r => r.symbol);
            fetchVolume8amBatch(symbols);
        }
    }, [scanConfig.enableVol8am, scanConfig.timeBasis, rawPool.length]);

    // Filter by current volume thresholds in scanConfig (both 24H volume and 8AM volume)
    const filteredPool = useMemo(() => {
        if (!rawPool || rawPool.length === 0) return [];

        // 1. 币安排序 A~Z 分片截取 (Alphabetical Range Slicing)
        let sourceList = rawPool;
        if (scanConfig.enableAlphabeticalFilter) {
            const sortedByAlphabet = [...rawPool].sort((a, b) => a.symbol.localeCompare(b.symbol));
            const startIdx = Math.max(0, (scanConfig.alphabeticalRangeStart ?? 1) - 1);
            const endIdx = Math.max(startIdx + 1, scanConfig.alphabeticalRangeEnd ?? 70);
            sourceList = sortedByAlphabet.slice(startIdx, endIdx);
        }

        // 使用统一的 checkVolumeRule 过滤 24H 与 早上8点起 交易额
        const baseList = sourceList.filter(item => {
            const cached8am = getVolume8am(item.symbol);
            const enriched = {
                ...item,
                volume8am: item.volume8am !== undefined ? item.volume8am : cached8am?.volume8am,
                change8am: item.change8am !== undefined ? item.change8am : cached8am?.change8am,
            };
            return checkVolumeRule(enriched, scanConfig);
        });

        // 🔒【初筛币种回流交易额底池二次过滤闭环铁律】:
        // 当每一轮回溯周期过滤结束时，将市场初筛/大行情候选集里的币种直接并入交易额过滤底池（如200个+15个=215个），
        // 必须通过交易额规则校验（低于最小值或高于最大值者绝不混入），确保初筛既有币在后续极值中进行全套闭环二次过滤！
        if (feedbackSymbols.length > 0) {
            const baseSymbolSet = new Set(baseList.map(i => i.symbol));
            const injectedItems: VolumePoolItem[] = [];
            feedbackSymbols.forEach(sym => {
                if (!baseSymbolSet.has(sym)) {
                    const found = rawPool.find(r => r.symbol === sym);
                    if (found) {
                        const cached8am = getVolume8am(sym);
                        const enriched = {
                            ...found,
                            volume8am: found.volume8am !== undefined ? found.volume8am : cached8am?.volume8am,
                            change8am: found.change8am !== undefined ? found.change8am : cached8am?.change8am,
                        };
                        if (checkVolumeRule(enriched, scanConfig)) {
                            injectedItems.push(found);
                        }
                    }
                }
            });
            if (injectedItems.length > 0) {
                return [...baseList, ...injectedItems];
            }
        }

        return baseList;
    }, [
        rawPool, 
        scanConfig.enableVol24h, 
        scanConfig.minVolume, 
        scanConfig.maxVolume,
        scanConfig.enableVol8am,
        scanConfig.minVolume8am,
        scanConfig.maxVolume8am,
        scanConfig.timeBasis,
        scanConfig.enableAlphabeticalFilter,
        scanConfig.alphabeticalRangeStart,
        scanConfig.alphabeticalRangeEnd,
        feedbackSymbols,
        _8amTick
    ]);

    // Save current filtered symbols to localStorage and notify other pools
    useEffect(() => {
        if (filteredPool.length > 0) {
            try {
                const symbolsOnly = filteredPool.map(i => i.symbol);
                localStorage.setItem('SCANNER_VOLUME_FILTERED_POOL', JSON.stringify(symbolsOnly));
                window.dispatchEvent(new CustomEvent('scanner_volume_pool_updated', { detail: { symbols: symbolsOnly } }));
            } catch (_) {}
        }
    }, [filteredPool]);

    // Filtered by search keyword
    const displayList = useMemo(() => {
        if (!searchTerm.trim()) return filteredPool;
        const term = searchTerm.trim().toUpperCase();
        return filteredPool.filter(item => item.symbol.includes(term));
    }, [filteredPool, searchTerm]);

    const handleCopyAll = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (filteredPool.length === 0) return;
        const text = filteredPool.map(i => i.symbol).join(', ');
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="border border-slate-700/80 rounded-lg bg-[#151922] overflow-hidden shadow-sm transition-all duration-200">
            {/* Header with Title, Count, (Manual/Auto), Speed (5m), Quick Actions, and Collapse Trigger */}
            <div 
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="p-2 bg-slate-800/60 hover:bg-slate-800/90 flex items-center justify-between cursor-pointer transition-colors select-none"
            >
                <div className="flex items-center gap-2">
                    <div className="p-1 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                        <Database size={13} />
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-white tracking-wide">
                            交易额过滤底池
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-indigo-900/60 border border-indigo-700/60 text-indigo-300 font-mono font-bold text-[9px]">
                            {filteredPool.length} 个币
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    {/* (手动/自动) 读取开关 */}
                    <div className="flex items-center bg-slate-950/80 rounded border border-slate-700/80 p-0.5" title="交易额过滤底池运行模式：自动定期拉取币安 / 手动刷新">
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsAutoSync(false);
                            }}
                            className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold transition-all ${
                                !isAutoSync 
                                    ? 'bg-amber-600 text-white shadow-sm' 
                                    : 'text-slate-400 hover:text-slate-200'
                            }`}
                        >
                            手动
                        </button>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsAutoSync(true);
                            }}
                            className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold transition-all ${
                                isAutoSync 
                                    ? 'bg-indigo-600 text-white shadow-sm' 
                                    : 'text-slate-400 hover:text-slate-200'
                            }`}
                        >
                            自动
                        </button>
                    </div>

                    {/* 访问币安速度按钮 (默认5分钟) */}
                    <div 
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 hover:border-indigo-500/60 text-[9px] text-slate-300 cursor-pointer transition-colors"
                        title="点击调整访问币安的速度(分钟)"
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsEditingInterval(!isEditingInterval);
                        }}
                    >
                        <Clock size={10} className="text-indigo-400" />
                        {isEditingInterval ? (
                            <input
                                type="number"
                                min={1}
                                max={60}
                                value={syncIntervalMin}
                                onChange={(e) => setSyncIntervalMin(Math.max(1, parseInt(e.target.value) || 1))}
                                onBlur={() => setIsEditingInterval(false)}
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                                className="w-8 bg-slate-950 text-white font-mono text-center text-[9px] outline-none border-b border-indigo-500"
                            />
                        ) : (
                            <span className="font-mono font-bold text-indigo-300">
                                ({syncIntervalMin})分钟
                            </span>
                        )}
                    </div>

                    {/* Copy All Symbols Button */}
                    <button
                        onClick={handleCopyAll}
                        title="复制底池全部币名"
                        className="p-1 rounded bg-slate-700/60 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                    >
                        {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                    </button>

                    {/* Refresh Button */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            triggerScheduledFetch();
                        }}
                        disabled={isFetching}
                        title="从币安刷新底池数据"
                        className="p-1 rounded bg-slate-700/60 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors disabled:opacity-50"
                    >
                        <RefreshCw size={11} className={isFetching ? 'animate-spin text-indigo-400' : ''} />
                    </button>

                    {/* Collapse Toggle Arrow */}
                    <div 
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsCollapsed(!isCollapsed);
                        }}
                        className="text-slate-400 hover:text-white p-0.5 cursor-pointer"
                    >
                        {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                    </div>
                </div>
            </div>

            {/* Expandable Body */}
            {!isCollapsed && (
                <div className="p-2 space-y-2 border-t border-slate-800 bg-[#0e1219]/90 animate-in slide-in-from-top-1 duration-200">
                    {/* Quick Search & Summary Row */}
                    <div className="flex items-center justify-between gap-2">
                        <div className="relative flex-1">
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="在底池中搜索币名..."
                                className="w-full bg-slate-900 border border-slate-700/70 rounded px-2 py-0.5 text-[9px] text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                            />
                            <Search size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500" />
                        </div>
                        <div className="text-[9px] text-slate-400 font-mono flex-shrink-0">
                            显示: <strong className="text-white">{displayList.length}</strong> / {filteredPool.length}
                        </div>
                    </div>

                    {/* Coin Symbol Chips Grid */}
                    <div className="max-h-36 overflow-y-auto pr-1 flex flex-wrap gap-1 custom-scrollbar">
                        {displayList.length === 0 ? (
                            <div className="w-full py-4 text-center text-slate-500 text-[10px] italic">
                                {rawPool.length === 0 
                                    ? (isFetching ? '正在从币安获取全量行情数据...' : '暂无底池缓存，点击右上角刷新按钮重新读取') 
                                    : '未找到符合当前成交范围过滤条件的币种'}
                            </div>
                        ) : (
                            displayList.map(item => {
                                const v8am = item.volume8am ?? getVolume8am(item.symbol)?.volume8am;
                                return (
                                    <div 
                                        key={item.symbol}
                                        className="px-1.5 py-0.5 rounded bg-slate-800/80 border border-slate-700 hover:border-indigo-500/50 hover:bg-slate-700/70 transition-all flex items-center gap-1 group cursor-default"
                                        title={`${item.symbol}: 24H成交额 ${item.volume24h}M USDT${v8am !== undefined ? ` | 8AM起成交额 ${v8am.toFixed(1)}M USDT` : ''} | 涨跌幅 ${item.change24h > 0 ? `+${item.change24h}%` : `${item.change24h}%`}`}
                                    >
                                        <span className="font-mono font-bold text-[9px] text-slate-200 group-hover:text-indigo-300">
                                            {item.symbol}
                                        </span>
                                        <span className="font-mono text-[8px] text-amber-400/90">
                                            {(item.volume24h ?? 0) >= 1000 ? `${((item.volume24h ?? 0) / 1000).toFixed(1)}B` : `${(item.volume24h ?? 0).toFixed(0)}M`}
                                        </span>
                                        {v8am !== undefined && (scanConfig.enableVol8am || scanConfig.timeBasis === '8AM') && (
                                            <span className="font-mono text-[8px] text-blue-400/90" title="北京时间今早8点起交易额">
                                                8A:{v8am.toFixed(0)}M
                                            </span>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

