import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ScanConfig, AntiChaseFilterConfig } from '../../../components/Scanner/scannerTypes';
import { ChevronDown, ChevronUp, Copy, Check, Search, ShieldCheck, RefreshCw, ArrowUpRight, ArrowDownRight, Sliders, Zap } from 'lucide-react';
import { usePersistedState } from '../../../hooks/usePersistedState';
import { DEFAULT_LIST1_ANTI_CHASE_CONFIG, AntiChasePoolItem, auditSymbolAntiChase } from '../../../services/rules/list1_anti_chase';
import { klineDailyStore } from '../../../services/klineDailyStore';

interface Props {
    scanConfig: ScanConfig;
    setScanConfig: React.Dispatch<React.SetStateAction<ScanConfig>>;
    candidateSymbols?: string[];
}

import { applyDirectionSync } from '../../../utils/directionSync';

export const AntiChasePoolBox: React.FC<Props> = ({ scanConfig, setScanConfig, candidateSymbols }) => {
    const [isCollapsed, setIsCollapsed] = usePersistedState<boolean>('SCANNER_ANTI_CHASE_BOX_COLLAPSED', false);
    const [searchTerm, setSearchTerm] = useState('');
    const [directionFilter, setDirectionFilter] = useState<'ALL' | 'LONG' | 'SHORT'>('ALL');
    const [copied, setCopied] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [pool, setPool] = usePersistedState<AntiChasePoolItem[]>('SCANNER_ANTI_CHASE_FILTERED_POOL', []);
    const isMountedRef = useRef(true);

    const isSyncLocked = scanConfig.majorTrend?.syncDirectionLock !== false;

    const [config, setConfig] = useState<AntiChaseFilterConfig>(() => {
        let storedCfg: any = null;
        try {
            const raw = localStorage.getItem('SCANNER_ANTI_CHASE_CONFIG');
            if (raw) storedCfg = JSON.parse(raw);
        } catch (_) {}
        return {
            ...DEFAULT_LIST1_ANTI_CHASE_CONFIG,
            ...(scanConfig.antiChaseFilter || scanConfig.majorTrend?.antiChaseFilter || storedCfg || {})
        };
    });

    // 🔒 响应外部 scanConfig 的全域多空同步变动
    useEffect(() => {
        const activeFilter = scanConfig.antiChaseFilter || scanConfig.majorTrend?.antiChaseFilter;
        if (activeFilter) {
            setConfig(prev => ({
                ...prev,
                ...activeFilter
            }));
        }
    }, [
        scanConfig.antiChaseFilter,
        scanConfig.majorTrend?.antiChaseFilter,
        scanConfig.majorTrend?.enableLong,
        scanConfig.majorTrend?.enableShort,
        scanConfig.majorTrend?.syncDirectionLock
    ]);

    const configRef = useRef(config);
    useEffect(() => {
        configRef.current = config;
    }, [config]);

    const updateConfig = (updater: (prev: AntiChaseFilterConfig) => AntiChaseFilterConfig) => {
        const next = updater(config);
        setConfig(next);
        configRef.current = next;
        try {
            localStorage.setItem('SCANNER_ANTI_CHASE_CONFIG', JSON.stringify(next));
        } catch (_) {}
        setScanConfig(p => ({
            ...p,
            antiChaseFilter: next,
            majorTrend: p.majorTrend ? { ...p.majorTrend, antiChaseFilter: next } : p.majorTrend
        }));
    };

    // 参数变更时防抖触发快速复核
    useEffect(() => {
        const timer = setTimeout(() => {
            if (isMountedRef.current && config.enabled) {
                executeAntiChaseFilter();
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [
        config.enabled,
        config.enableLong,
        config.enableShort,
        JSON.stringify(config.longThresholds),
        JSON.stringify(config.shortThresholds)
    ]);

    // 监听本地存储与事件同步
    useEffect(() => {
        isMountedRef.current = true;
        const handlePoolUpdated = () => {
            try {
                const raw = localStorage.getItem('SCANNER_ANTI_CHASE_FILTERED_POOL');
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) {
                        setPool(parsed);
                        return;
                    }
                }
            } catch (_) {}
        };

        const handleUpstreamPoolUpdated = () => {
            if (isMountedRef.current && config.enabled) {
                // 上游回溯周期底池更新时，自动同步核对
                executeAntiChaseFilter();
            }
        };

        window.addEventListener('scanner_anti_chase_pool_updated', handlePoolUpdated);
        window.addEventListener('scanner_lookback_pool_updated', handleUpstreamPoolUpdated);
        window.addEventListener('scanner_major_trend_candidates_updated', handleUpstreamPoolUpdated);
        window.addEventListener('scanner_sideways_pool_updated', handleUpstreamPoolUpdated);

        // 初始化加载与自适应核算：主动进行一次全量重新核算，即时清除旧版本残留离线数据
        handlePoolUpdated();
        setTimeout(() => {
            if (isMountedRef.current) {
                executeAntiChaseFilter();
            }
        }, 300);

        return () => {
            isMountedRef.current = false;
            window.removeEventListener('scanner_anti_chase_pool_updated', handlePoolUpdated);
            window.removeEventListener('scanner_lookback_pool_updated', handleUpstreamPoolUpdated);
            window.removeEventListener('scanner_major_trend_candidates_updated', handleUpstreamPoolUpdated);
            window.removeEventListener('scanner_sideways_pool_updated', handleUpstreamPoolUpdated);
        };
    }, [config.enabled]);

    // 获取上游候选币种列表 (严格按流水线顺序: 回溯周期底池 -> 横盘底池 -> 启动底池 -> 交易额底池)
    const getUpstreamCandidates = (): { symbol: string; direction?: 'LONG' | 'SHORT' | 'BOTH'; fullSymbol?: string; currentPrice?: number }[] => {
        try {
            const cfg = (scanConfig.majorTrend || {}) as any;
            const enableLookback = cfg.enableLookbackFilter !== false;
            const enableSideways = cfg.enableSideways !== false;
            const enableStart = Boolean(cfg.enableStartTrendLong || cfg.enableStartTrendShort);

            // 1. 若回溯周期开启：从“回溯周期底池”获取 (第二组)
            if (enableLookback) {
                const rawLookback = localStorage.getItem('SCANNER_LOOKBACK_FILTERED_POOL');
                if (rawLookback) {
                    const parsed = JSON.parse(rawLookback);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        return parsed.map((item: any) => ({
                            symbol: typeof item === 'string' ? item.replace(/_LONG$|_SHORT$/i, '').trim() : item.symbol,
                            direction: typeof item === 'string' ? (item.endsWith('_LONG') ? 'LONG' : item.endsWith('_SHORT') ? 'SHORT' : 'BOTH') : item.direction,
                            fullSymbol: typeof item === 'string' ? item : item.fullSymbol,
                            currentPrice: typeof item === 'object' ? item.currentPrice : undefined
                        }));
                    }
                }
                const rawLegacy = localStorage.getItem('SCANNER_MAJOR_TREND_CANDIDATES');
                if (rawLegacy) {
                    const parsed = JSON.parse(rawLegacy);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        return parsed.map((c: string) => ({
                            symbol: c.replace(/_LONG$|_SHORT$/i, '').trim(),
                            direction: c.endsWith('_LONG') ? 'LONG' : (c.endsWith('_SHORT') ? 'SHORT' : 'BOTH'),
                            fullSymbol: c
                        }));
                    }
                }
                return [];
            }

            // 2. 仅当回溯周期【未开启】时，向上穿透至“横盘蓄势过滤底池”
            if (enableSideways) {
                const rawSideways = localStorage.getItem('SCANNER_SIDEWAYS_FILTERED_POOL');
                if (rawSideways) {
                    const parsed = JSON.parse(rawSideways);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        return parsed.map((item: any) => ({
                            symbol: typeof item === 'string' ? item.replace(/_LONG$|_SHORT$/i, '').trim() : item.symbol,
                            direction: typeof item === 'string' ? (item.endsWith('_LONG') ? 'LONG' : item.endsWith('_SHORT') ? 'SHORT' : 'BOTH') : item.direction,
                            fullSymbol: typeof item === 'string' ? item : item.fullSymbol,
                            currentPrice: typeof item === 'object' ? item.currentPrice : undefined
                        }));
                    }
                }
                return [];
            }

            // 3. 仅当横盘蓄势也【未开启】时，向上穿透至“行情启动底池”
            if (enableStart) {
                const rawStart = localStorage.getItem('SCANNER_START_TREND_POOL');
                if (rawStart) {
                    const parsed = JSON.parse(rawStart);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        return parsed.map((item: any) => ({
                            symbol: typeof item === 'string' ? item.replace(/_LONG$|_SHORT$/i, '').trim() : item.symbol,
                            direction: typeof item === 'string' ? (item.endsWith('_LONG') ? 'LONG' : item.endsWith('_SHORT') ? 'SHORT' : 'BOTH') : item.direction,
                            fullSymbol: typeof item === 'string' ? item : item.fullSymbol,
                            currentPrice: typeof item === 'object' ? item.currentPrice : undefined
                        }));
                    }
                }
                return [];
            }

            // 4. 向上穿透至交易额底池
            const rawVol = localStorage.getItem('SCANNER_VOLUME_FILTERED_POOL') || localStorage.getItem('SCANNER_LIST1');
            if (rawVol) {
                const parsed = JSON.parse(rawVol);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed.map((item: any) => ({
                        symbol: typeof item === 'string' ? item.replace(/_LONG$|_SHORT$/i, '').trim() : item.symbol,
                        direction: 'BOTH',
                        fullSymbol: typeof item === 'string' ? item : item.symbol,
                        currentPrice: typeof item === 'object' ? item.currentPrice : undefined
                    }));
                }
            }
        } catch (_) {}

        if (candidateSymbols && candidateSymbols.length > 0) {
            return candidateSymbols.map(s => ({ symbol: s, direction: 'BOTH' }));
        }
        return [];
    };

    // 执行防追高熔断过滤
    const executeAntiChaseFilter = async () => {
        const activeCfg = configRef.current || config;
        if (!activeCfg.enabled) {
            // 若功能关闭，直接将上游全量放行至防追高底池
            const upstreams = getUpstreamCandidates();
            const directPool: AntiChasePoolItem[] = upstreams.map(u => ({
                symbol: u.symbol,
                direction: u.direction,
                fullSymbol: u.fullSymbol,
                currentPrice: u.currentPrice,
                timestamp: Date.now()
            }));
            setPool(directPool);
            localStorage.setItem('SCANNER_ANTI_CHASE_FILTERED_POOL', JSON.stringify(directPool));
            window.dispatchEvent(new CustomEvent('scanner_anti_chase_pool_updated', {
                detail: { pool: directPool }
            }));
            return;
        }

        const upstreams = getUpstreamCandidates();
        if (upstreams.length === 0) return;

        setIsScanning(true);
        const passedItems: AntiChasePoolItem[] = [];

        try {
            for (const item of upstreams) {
                const sym = item.symbol;
                let klines: any[] = [];
                let curPrice = item.currentPrice || 0;

                // 1. 尝试从全局日K长效缓存中心读取日K数据 (优先>=90根有效K线)
                const store = klineDailyStore || (window as any).klineDailyStore;
                let rawK: any[] | null = null;
                if (store) {
                    rawK = store.getCachedKlinesSync(sym, 90) || store.getCachedKlinesSync(sym.toUpperCase(), 90);
                    if (!curPrice) {
                        const ticker = store.get24hTickerSync(sym) || store.get24hTickerSync(sym.toUpperCase());
                        if (ticker && ticker.lastPrice) {
                            curPrice = parseFloat(ticker.lastPrice);
                        }
                    }
                }

                // 2. 若本地缓存缺失，平滑轻量抓取 320 根日K
                if (!rawK || rawK.length < 90) {
                    try {
                        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${sym.toUpperCase()}&interval=1d&limit=320&isScanner=true`;
                        const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}&priority=normal`);
                        if (res.ok) {
                            const data = await res.json();
                            if (Array.isArray(data) && data.length >= 2) {
                                if (store) await store.saveKlines(sym, data, 300);
                                rawK = data;
                            }
                        }
                    } catch (_) {}
                }

                if (Array.isArray(rawK) && rawK.length > 0) {
                    const parseV = (k: any, idx: number, key: string) => {
                        if (Array.isArray(k)) return parseFloat(k[idx]) || 0;
                        return parseFloat(k[key] ?? k[idx] ?? 0) || 0;
                    };
                    klines = rawK.map((k: any) => ({
                        open: parseV(k, 1, 'open'),
                        high: parseV(k, 2, 'high'),
                        low: parseV(k, 3, 'low'),
                        close: parseV(k, 4, 'close'),
                        time: Array.isArray(k) ? k[0] : (k.time ?? k[0])
                    }));
                    if (!curPrice && klines.length > 0) {
                        curPrice = klines[klines.length - 1].close;
                    }
                }

                // 3. 检查防追高/防追跌熔断
                const auditRes = auditSymbolAntiChase(
                    sym,
                    item.direction || 'BOTH',
                    curPrice,
                    klines,
                    activeCfg
                );

                if (auditRes.passed && !auditRes.blocked) {
                    const qualDir = auditRes.qualifiedDirection || item.direction || 'BOTH';
                    const fullSym = item.fullSymbol ? (
                        item.fullSymbol.includes('_') 
                            ? `${sym}_${qualDir}` 
                            : item.fullSymbol
                    ) : `${sym}_${qualDir}`;

                    passedItems.push({
                        symbol: sym,
                        direction: qualDir,
                        fullSymbol: fullSym,
                        currentPrice: curPrice,
                        timestamp: Date.now(),
                        auditResult: auditRes
                    });
                } else {
                    console.log(`[AntiChasePoolBox] 熔断拦截: ${sym} (${item.direction || 'BOTH'}) - ${auditRes.blockedReason}`);
                }
            }

            // 更新并广播
            setPool(passedItems);
            localStorage.setItem('SCANNER_ANTI_CHASE_FILTERED_POOL', JSON.stringify(passedItems));
            window.dispatchEvent(new CustomEvent('scanner_anti_chase_pool_updated', {
                detail: { pool: passedItems }
            }));
        } catch (err) {
            console.error('[AntiChasePoolBox] Filter error:', err);
        } finally {
            if (isMountedRef.current) {
                setIsScanning(false);
            }
        }
    };

    const filteredList = useMemo(() => {
        return pool.filter(item => {
            if (directionFilter === 'LONG' && item.direction === 'SHORT') return false;
            if (directionFilter === 'SHORT' && item.direction === 'LONG') return false;
            if (searchTerm.trim()) {
                const term = searchTerm.trim().toUpperCase();
                return item.symbol.toUpperCase().includes(term);
            }
            return true;
        });
    }, [pool, searchTerm, directionFilter]);

    const handleCopy = () => {
        if (pool.length === 0) return;
        const text = pool.map(item => item.symbol).join(', ');
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => {
            if (isMountedRef.current) setCopied(false);
        }, 1500);
    };

    return (
        <div className="bg-[#1e2329] border border-red-500/30 rounded p-2 flex flex-col gap-1.5 shadow-[0_0_12px_rgba(239,68,68,0.08)] select-none">
            {/* Header: Title, Count, Action Buttons, Collapse */}
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
                <div className="flex items-center gap-1.5">
                    <ShieldCheck size={13} className={config.enabled ? "text-red-400" : "text-slate-500"} />
                    <span className="text-[11px] font-bold text-slate-200">3. 初筛极值拦截底池</span>
                    <span className="text-[9px] px-1.5 py-0.2 rounded font-mono font-bold bg-red-950/60 text-red-300 border border-red-800/40">
                        {pool.length} 币
                    </span>
                    <span className="text-[8.5px] text-slate-500 hidden sm:inline">(回溯周期后级门禁)</span>
                </div>

                <div className="flex items-center gap-1.5">
                    {/* Switch */}
                    <div 
                        onClick={() => updateConfig(p => ({ ...p, enabled: !p.enabled }))}
                        className={`w-7 h-3.5 rounded-full p-0.5 transition-colors cursor-pointer ${config.enabled ? 'bg-red-600' : 'bg-slate-700'}`}
                        title={config.enabled ? "点击关闭防追高熔断过滤" : "点击启用防追高熔断过滤"}
                    >
                        <div className={`w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${config.enabled ? 'translate-x-3.5' : 'translate-x-0'}`} />
                    </div>

                    <button
                        onClick={executeAntiChaseFilter}
                        disabled={isScanning}
                        title="重新执行防追高过滤扫描"
                        className="p-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-all disabled:opacity-40"
                    >
                        <RefreshCw size={11} className={isScanning ? "animate-spin text-red-400" : ""} />
                    </button>

                    <button
                        onClick={handleCopy}
                        disabled={pool.length === 0}
                        title="一键复制通过防追高币种"
                        className="p-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-all disabled:opacity-40"
                    >
                        {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                    </button>

                    <button
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        className="p-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-all"
                    >
                        {isCollapsed ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
                    </button>
                </div>
            </div>

            {/* Content: Visible when expanded */}
            {!isCollapsed && (
                <div className="flex flex-col gap-2 pt-1 animate-in fade-in duration-150">
                    {/* Settings Panel */}
                    <div className="bg-slate-950/60 border border-slate-800/60 rounded p-2 space-y-2">
                        <div className="flex items-center justify-between text-[9px] text-slate-400">
                            <span className="flex items-center gap-1 font-bold text-slate-300">
                                <Sliders size={10} className="text-red-400" /> 熔断阈值参数配置
                            </span>
                            <div className="flex items-center gap-2">
                                <label className="flex items-center gap-1 cursor-pointer">
                                    <input 
                                        type="checkbox" 
                                        checked={config.enableLong !== false} 
                                        onChange={e => {
                                            const newLong = e.target.checked;
                                            if (isSyncLocked) {
                                                const newShort = config.enableShort !== false;
                                                const targetMode = (newLong && newShort) ? 'BOTH' : (newLong ? 'LONG_ONLY' : (newShort ? 'SHORT_ONLY' : 'LONG_ONLY'));
                                                setScanConfig(p => applyDirectionSync(p, targetMode));
                                            } else {
                                                updateConfig(p => ({ ...p, enableLong: newLong }));
                                            }
                                        }}
                                        className="w-2.5 h-2.5 rounded bg-slate-800 text-emerald-500"
                                    />
                                    <span className="text-[9px] text-emerald-400">做多锁定</span>
                                </label>
                                <label className="flex items-center gap-1 cursor-pointer">
                                    <input 
                                        type="checkbox" 
                                        checked={config.enableShort !== false} 
                                        onChange={e => {
                                            const newShort = e.target.checked;
                                            if (isSyncLocked) {
                                                const newLong = config.enableLong !== false;
                                                const targetMode = (newLong && newShort) ? 'BOTH' : (newShort ? 'SHORT_ONLY' : (newLong ? 'LONG_ONLY' : 'SHORT_ONLY'));
                                                setScanConfig(p => applyDirectionSync(p, targetMode));
                                            } else {
                                                updateConfig(p => ({ ...p, enableShort: newShort }));
                                            }
                                        }}
                                        className="w-2.5 h-2.5 rounded bg-slate-800 text-red-500"
                                    />
                                    <span className="text-[9px] text-red-400">做空锁定</span>
                                </label>
                            </div>
                        </div>

                        {/* Grid: Long & Short Thresholds */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[9px]">
                            {/* 做多锁定限制 */}
                            <div className="bg-slate-900/80 p-1.5 rounded border border-emerald-900/30 space-y-1">
                                <div className="text-[8.5px] font-bold text-emerald-400/90 flex items-center justify-between">
                                    <span>做多锁定限制 (禁止追高)</span>
                                    <span className="text-slate-500">涨幅上限 %</span>
                                </div>
                                <div className="space-y-1">
                                    {[
                                        { label: "1季度 (90天)", key: "90" },
                                        { label: "1月 (30天)", key: "30" },
                                        { label: "1周 (7天)", key: "7" },
                                        { label: "1天 (昨日)", key: "1" },
                                        { label: "今天8:00起", key: "today8am" },
                                    ].map(p => (
                                        <div key={p.key} className="flex items-center justify-between bg-slate-950/70 px-1.5 py-0.5 rounded border border-slate-800/60">
                                            <span className="text-slate-400 text-[8.5px]">{p.label}</span>
                                            <div className="flex items-center gap-1">
                                                <input
                                                    type="number"
                                                    value={config.longThresholds[p.key] ?? (p.key === 'today8am' ? 5 : p.key === '1' ? 15 : p.key === '7' ? 30 : p.key === '30' ? 50 : 100)}
                                                    onChange={e => {
                                                        const val = parseFloat(e.target.value) || 0;
                                                        updateConfig(c => ({
                                                            ...c,
                                                            longThresholds: { ...c.longThresholds, [p.key]: val }
                                                        }));
                                                    }}
                                                    className="w-12 bg-slate-900 border border-slate-700/60 rounded text-[9px] text-emerald-400 font-bold outline-none px-1 text-right font-mono"
                                                />
                                                <span className="text-[8px] text-slate-500">%</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* 做空锁定限制 */}
                            <div className="bg-slate-900/80 p-1.5 rounded border border-red-900/30 space-y-1">
                                <div className="text-[8.5px] font-bold text-red-400/90 flex items-center justify-between">
                                    <span>做空锁定限制 (禁止追跌)</span>
                                    <span className="text-slate-500">跌幅上限 %</span>
                                </div>
                                <div className="space-y-1">
                                    {[
                                        { label: "1季度 (90天)", key: "90" },
                                        { label: "1月 (30天)", key: "30" },
                                        { label: "1周 (7天)", key: "7" },
                                        { label: "1天 (昨日)", key: "1" },
                                        { label: "今天8:00起", key: "today8am" },
                                    ].map(p => (
                                        <div key={p.key} className="flex items-center justify-between bg-slate-950/70 px-1.5 py-0.5 rounded border border-slate-800/60">
                                            <span className="text-slate-400 text-[8.5px]">{p.label}</span>
                                            <div className="flex items-center gap-1">
                                                <input
                                                    type="number"
                                                    value={config.shortThresholds[p.key] ?? (p.key === 'today8am' ? 5 : p.key === '1' ? 15 : p.key === '7' ? 30 : p.key === '30' ? 50 : 100)}
                                                    onChange={e => {
                                                        const val = parseFloat(e.target.value) || 0;
                                                        updateConfig(c => ({
                                                            ...c,
                                                            shortThresholds: { ...c.shortThresholds, [p.key]: val }
                                                        }));
                                                    }}
                                                    className="w-12 bg-slate-900 border border-slate-700/60 rounded text-[9px] text-red-400 font-bold outline-none px-1 text-right font-mono"
                                                />
                                                <span className="text-[8px] text-slate-500">%</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Filter Controls: Search & Direction */}
                    <div className="flex items-center gap-1.5">
                        <div className="relative flex-1">
                            <Search size={10} className="absolute left-2 top-1.5 text-slate-500" />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                placeholder="搜索防追高合格币种..."
                                className="w-full bg-slate-950 border border-slate-800/80 rounded pl-6 pr-2 py-0.5 text-[9px] text-white placeholder-slate-600 outline-none focus:border-red-500/50"
                            />
                        </div>

                        <div className="flex items-center bg-slate-950 border border-slate-800/80 rounded p-0.5">
                            {(['ALL', 'LONG', 'SHORT'] as const).map(d => (
                                <button
                                    key={d}
                                    onClick={() => setDirectionFilter(d)}
                                    className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold transition-all ${
                                        directionFilter === d
                                            ? d === 'LONG'
                                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-700/50'
                                                : d === 'SHORT'
                                                ? 'bg-red-950 text-red-400 border border-red-700/50'
                                                : 'bg-indigo-950 text-indigo-300 border border-indigo-700/50'
                                            : 'text-slate-500 hover:text-slate-300'
                                    }`}
                                >
                                    {d === 'ALL' ? '全部' : d === 'LONG' ? '多' : '空'}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Coins Grid List */}
                    <div className="max-h-48 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800 pr-0.5">
                        {filteredList.length === 0 ? (
                            <div className="py-4 text-center text-[9px] text-slate-600 bg-slate-950/40 rounded border border-slate-800/40">
                                {pool.length === 0 ? '暂无符合防追高熔断规则的币种 (上游等待中)' : '无匹配筛选币种'}
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1">
                                {filteredList.map((item, idx) => (
                                    <div
                                        key={`${item.symbol}_${idx}`}
                                        className="bg-slate-950/80 hover:bg-slate-900 border border-slate-800/80 hover:border-red-500/40 rounded p-1 flex items-center justify-between text-[9px] transition-all group"
                                    >
                                        <div className="flex items-center gap-1 overflow-hidden">
                                            {item.direction === 'LONG' ? (
                                                <ArrowUpRight size={10} className="text-emerald-400 shrink-0" />
                                            ) : item.direction === 'SHORT' ? (
                                                <ArrowDownRight size={10} className="text-rose-400 shrink-0" />
                                            ) : (
                                                <span className="w-1.5 h-1.5 rounded-full bg-slate-600 shrink-0" />
                                            )}
                                            <span className="font-bold text-slate-200 truncate group-hover:text-red-300 font-mono">
                                                {item.symbol}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-1 shrink-0 font-mono text-[8px]">
                                            {item.currentPrice ? (
                                                <span className="text-slate-400">
                                                    ${item.currentPrice > 1 ? item.currentPrice.toFixed(2) : item.currentPrice.toFixed(4)}
                                                </span>
                                            ) : (
                                                <span className="text-emerald-400/80">放行</span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
