import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ScanConfig, StartTrendGroup } from '../../../components/Scanner/scannerTypes';
import { Play, ChevronDown, ChevronUp, Copy, Check, RefreshCw, Search, Flame, ArrowUpRight, ArrowDownRight, Clock } from 'lucide-react';
import { usePersistedState } from '../../../hooks/usePersistedState';
import { pipelineCoordinator } from '../../../services/pipelineQueue';

interface Props {
    scanConfig: ScanConfig;
}

export interface StartTrendPoolItem {
    symbol: string;
    direction: 'LONG' | 'SHORT' | 'BOTH';
    changePct: number;
    pullbackPct: number;
    matchedGroup: number;
    price: number;
}

export const StartTrendPoolBox: React.FC<Props> = ({ scanConfig }) => {
    const [isCollapsed, setIsCollapsed] = usePersistedState<boolean>('SCANNER_START_TREND_POOL_COLLAPSED', false);
    const [searchTerm, setSearchTerm] = useState('');
    const [copied, setCopied] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: 0, passed: 0 });
    const [isAutoScan, setIsAutoScan] = usePersistedState<boolean>('SCANNER_START_TREND_AUTO_SCAN', true);
    const [syncIntervalSec, setSyncIntervalSec] = usePersistedState<number>('SCANNER_START_TREND_SYNC_INTERVAL_SEC', 3);
    const [isEditingInterval, setIsEditingInterval] = useState(false);
    const [pool, setPool] = usePersistedState<StartTrendPoolItem[]>('SCANNER_START_TREND_POOL', []);
    const isMountedRef = useRef(true);
    const isScanningRef = useRef(false);
    isScanningRef.current = isScanning;
    const scanConfigRef = useRef(scanConfig);
    scanConfigRef.current = scanConfig;
    const isAutoScanRef = useRef(isAutoScan);
    isAutoScanRef.current = isAutoScan;
    const syncIntervalSecRef = useRef(syncIntervalSec);
    syncIntervalSecRef.current = syncIntervalSec;
    const klinesCacheRef = useRef<Map<string, { klines: any[], timestamp: number }>>(new Map());

    useEffect(() => {
        isMountedRef.current = true;
        return () => { isMountedRef.current = false; };
    }, []);

    // 监听交易额底池更新与挂载对齐：即时从行情启动底池中剔除已不在交易额白名单内的孤儿币种
    useEffect(() => {
        const handleVolumePoolSync = () => {
            const currentCandidates = getCandidateSymbols();
            if (currentCandidates.length === 0) {
                // 若交易额过滤底池暂无币种，行情启动底池彻底清零，不叠加或残留任何历史老数据
                localStorage.setItem('SCANNER_START_TREND_POOL', JSON.stringify([]));
                setPool([]);
                window.dispatchEvent(new CustomEvent('scanner_start_trend_pool_updated', { detail: [] }));
                return;
            }
            const validSet = new Set(currentCandidates);
            
            try {
                const raw = localStorage.getItem('SCANNER_START_TREND_POOL');
                const prevPool: StartTrendPoolItem[] = raw ? JSON.parse(raw) : [];
                if (Array.isArray(prevPool)) {
                    const filtered = prevPool.filter(item => validSet.has(item.symbol));
                    if (filtered.length !== prevPool.length) {
                        localStorage.setItem('SCANNER_START_TREND_POOL', JSON.stringify(filtered));
                        setPool(filtered);
                        setTimeout(() => {
                            window.dispatchEvent(new CustomEvent('scanner_start_trend_pool_updated', { detail: filtered }));
                        }, 0);
                    }
                }
            } catch (_) {}
        };

        window.addEventListener('scanner_volume_pool_updated', handleVolumePoolSync);
        handleVolumePoolSync();
        return () => {
            window.removeEventListener('scanner_volume_pool_updated', handleVolumePoolSync);
        };
    }, [setPool]);

    // 🔒【纯净数据源】：直接完全从“交易额过滤底池” (SCANNER_VOLUME_FILTERED_POOL) 获取基础数据量信息，不混入任何其他源
    const getCandidateSymbols = (): string[] => {
        try {
            const rawPool = localStorage.getItem('SCANNER_VOLUME_FILTERED_POOL');
            if (rawPool) {
                const parsed = JSON.parse(rawPool);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed;
                }
            }
        } catch (_) {}

        return [];
    };

    // High-speed daily (1d) kline fetch via local Express proxy (/api/proxy) with strict hard timeout & resource cleanup
    const fetch1dKlines = async (symbol: string): Promise<any[] | null> => {
        const nowTime = Date.now();
        const cached = klinesCacheRef.current.get(symbol);
        // Extend cache validity to 10 minutes (600,000 ms) for daily candles to eliminate redundant fetches
        if (cached && (nowTime - cached.timestamp < 600000) && Array.isArray(cached.klines) && cached.klines.length > 0) {
            return cached.klines;
        }
        const globalCache = (window as any).KLINE_LIMIT_CACHE || ((window as any).KLINE_LIMIT_CACHE = {});
        if (globalCache[`${symbol}_1d`] && Array.isArray(globalCache[`${symbol}_1d`]) && globalCache[`${symbol}_1d`].length >= 30) {
            return globalCache[`${symbol}_1d`];
        }
        if (globalCache[symbol]) {
            if (globalCache[symbol]['1d'] && Array.isArray(globalCache[symbol]['1d'].klines) && globalCache[symbol]['1d'].klines.length >= 30 && (nowTime - (globalCache[symbol]['1d'].timestamp || 0) < 600000)) {
                return globalCache[symbol]['1d'].klines;
            }
            const keys = Object.keys(globalCache[symbol]);
            for (const k of keys) {
                if (Array.isArray(globalCache[symbol][k]?.klines) && globalCache[symbol][k].klines.length >= 30) {
                    return globalCache[symbol][k].klines;
                }
            }
        }

        // Helper: Strict hard timeout fetcher with guaranteed AbortController cleanup to prevent connection exhaustion
        const safeFetchWithTimeout = async (targetUrl: string, timeoutMs: number): Promise<any[] | null> => {
            const controller = new AbortController();
            const timer = setTimeout(() => {
                try {
                    controller.abort();
                } catch (_) {}
            }, timeoutMs);

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

        // Fetch 60 daily candles (interval=1d&limit=60) - ultra lightweight (~3KB) via high-speed parallel proxy
        const futuresUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=60`;
        const klinesData = await safeFetchWithTimeout(futuresUrl, 2500);
        if (klinesData && Array.isArray(klinesData) && klinesData.length > 0) {
            klinesCacheRef.current.set(symbol, { klines: klinesData, timestamp: Date.now() });
            globalCache[`${symbol}_1d`] = klinesData;
            if (!globalCache[symbol]) globalCache[symbol] = {};
            globalCache[symbol]['1d'] = { klines: klinesData, timestamp: Date.now() };
            return klinesData;
        }

        return null;
    };

    // Run Start Trend Algorithm on candidate symbols from "交易额过滤底池"
    const runStartTrendScan = async (isManual = false) => {
        if (isScanningRef.current) return;

        // 🔒 [时间先后·互斥安全锁]: 若大行情正在扫描，暂停让行，绝不同时工作
        if ((window as any).IS_MAJOR_TREND_SCANNING) {
            if (isManual) {
                alert('“大行情发现”正在扫描中，两个引擎实行时间先后分开作业，请等待大行情扫描完成后再启动底池扫描！');
            } else {
                console.log("[StartTrendPool] Major trend is currently scanning. Waiting for major trend to complete before starting pool scan...");
            }
            return;
        }

        const candidates = getCandidateSymbols();
        if (candidates.length === 0) {
            if (isManual) {
                alert('交易额过滤底池暂无币种，请先刷新交易额底池或调整成交范围过滤参数！');
            }
            return;
        }

        const currentCfg = scanConfigRef.current;
        const cfg = currentCfg.majorTrend;
        const enableLong = cfg?.enableStartTrendLong ?? false;
        const enableShort = cfg?.enableStartTrendShort ?? false;

        if (!enableLong && !enableShort) {
            if (isManual) {
                alert('请先在“行情启动趋势”中开启【做多开关】或【做空开关】！');
            }
            return;
        }

        const allGroups = cfg?.startTrendGroups || [
            { enabled: true, days: 1, minLong: 1, maxLong: 9, maxPullbackLong: 5, minShort: 1, maxShort: 9, maxPullbackShort: 5 }
        ];
        const activeGroups = allGroups.map((g, idx) => ({ ...g, idx })).filter(g => g.enabled);

        if (activeGroups.length === 0) {
            if (isManual) {
                alert('请在“行情启动趋势”中至少启用一个组合（如组合0、组合1等）！');
            }
            return;
        }

        isScanningRef.current = true;
        (window as any).IS_START_TREND_SCANNING = true;
        setIsScanning(true);

        // 🔒【纯净数据源·无历史老数据叠加】：每次运行完全从空白开始，严格仅由本轮交易额底池候选币重新匹配产生，彻底杜绝老数据叠加
        const poolMap = new Map<string, StartTrendPoolItem>();
        setProgress({ current: 1, total: candidates.length, passed: 0 });

        try {
            // Process sequentially with user-configured interval (default 3s) so progress counter increments smoothly and visibly
            for (let i = 0; i < candidates.length; i++) {
                if (!isMountedRef.current || !isScanningRef.current) break;
                const symbol = candidates[i];
                const coinCycleStart = Date.now();

                if (isMountedRef.current) {
                    setProgress({ current: i + 1, total: candidates.length, passed: poolMap.size });
                }

                // 目标单币节拍（用户设定秒数，如 4 秒）：总处理+等待严格等于目标时间
                const stepIntervalSec = Math.max(0.1, syncIntervalSecRef.current ?? 3);
                const targetIntervalMs = Math.round(stepIntervalSec * 1000);
                // 单币最大允许网络执行时间：看门狗设为 targetIntervalMs - 100ms
                const maxWorkTime = Math.max(500, targetIntervalMs - 100);

                let coinTimeoutId: any = null;
                try {
                    // Single-coin watchdog: 超过 maxWorkTime 立即熔断并跳过该币
                    await Promise.race([
                        (async () => {
                            const klines = await fetch1dKlines(symbol);

                            if (Array.isArray(klines) && klines.length > 0) {
                                const currentPrice = parseFloat(klines[klines.length - 1][4]);
                                if (!isNaN(currentPrice) && currentPrice > 0) {
                                    let matched = false;
                                    let matchedItem: StartTrendPoolItem | null = null;

                                    for (const group of activeGroups) {
                                        let lastCandles: any[] = [];
                                        if (group.idx === 0) {
                                            // 组合0：今日日K线 (最新一根日K)
                                            lastCandles = [klines[klines.length - 1]];
                                        } else {
                                            const groupDays = group.days !== undefined ? group.days : (group.idx === 1 ? 2 : (group.idx === 2 ? 3 : 7));
                                            const requiredDays = Math.max(groupDays, 1);
                                            lastCandles = klines.slice(-Math.min(requiredDays, klines.length));
                                        }

                                        if (lastCandles.length === 0) continue;

                                        // Check Long Start Trend
                                        if (enableLong) {
                                            const periodHighs = lastCandles.map((k: any) => parseFloat(k[2])).filter(val => !isNaN(val) && val > 0);
                                            if (periodHighs.length > 0) {
                                                const periodMaxHigh = Math.max(...periodHighs);
                                                const baseOpen = parseFloat(lastCandles[0][1]);

                                                // 🔒 严格基于基准开盘价计算涨幅，且必须当前价格高于基准开盘价（日K或多日周期收涨/阳线），彻底杜绝最低点插针反弹误判
                                                if (baseOpen > 0 && currentPrice > baseOpen) {
                                                    const changePct = ((currentPrice - baseOpen) / baseOpen) * 100;
                                                    const pullbackPct = periodMaxHigh > 0 ? ((periodMaxHigh - currentPrice) / periodMaxHigh) * 100 : 0;
                                                    const maxPullbackLong = group.maxPullbackLong !== undefined ? group.maxPullbackLong : 5;

                                                    if (!isNaN(changePct) && changePct >= group.minLong && changePct <= group.maxLong &&
                                                        !isNaN(pullbackPct) && pullbackPct <= maxPullbackLong) {
                                                        matchedItem = {
                                                            symbol,
                                                            direction: 'LONG',
                                                            changePct: +changePct.toFixed(2),
                                                            pullbackPct: +pullbackPct.toFixed(2),
                                                            matchedGroup: group.idx,
                                                            price: currentPrice
                                                        };
                                                        matched = true;
                                                        break;
                                                    }
                                                }
                                            }
                                        }

                                        // Check Short Start Trend
                                        if (enableShort) {
                                            const periodLows = lastCandles.map((k: any) => parseFloat(k[3])).filter(val => !isNaN(val) && val > 0);
                                            if (periodLows.length > 0) {
                                                const periodMinLow = Math.min(...periodLows);
                                                const baseOpen = parseFloat(lastCandles[0][1]);

                                                // 🔒 严格基于基准开盘价计算跌幅，且必须当前价格低于基准开盘价（日K或多日周期收跌/阴线），彻底杜绝最高点插针回落误判
                                                if (baseOpen > 0 && currentPrice < baseOpen) {
                                                    const dropPct = ((baseOpen - currentPrice) / baseOpen) * 100;
                                                    const pullbackPct = periodMinLow > 0 ? ((currentPrice - periodMinLow) / periodMinLow) * 100 : 0;
                                                    const maxPullbackShort = group.maxPullbackShort !== undefined ? group.maxPullbackShort : 5;

                                                    if (!isNaN(dropPct) && dropPct >= group.minShort && dropPct <= group.maxShort &&
                                                        !isNaN(pullbackPct) && pullbackPct <= maxPullbackShort) {
                                                        matchedItem = {
                                                            symbol,
                                                            direction: 'SHORT',
                                                            changePct: -Math.abs(+dropPct.toFixed(2)),
                                                            pullbackPct: +pullbackPct.toFixed(2),
                                                            matchedGroup: group.idx,
                                                            price: currentPrice
                                                        };
                                                        matched = true;
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                    }

                                    let hasChanged = false;
                                    if (matched && matchedItem) {
                                        poolMap.set(symbol, matchedItem);
                                        hasChanged = true;
                                    } else if (poolMap.has(symbol)) {
                                        // 🔒 [实时加入与自动删除]: 当底池中的币种不再符合过滤条件时自动删除
                                        poolMap.delete(symbol);
                                        hasChanged = true;
                                    }

                                    // 仅在底池发生实际增删变动时才更新存储与广播，彻底消除每一币无意义的高频广播级联风暴
                                    if (hasChanged && isMountedRef.current) {
                                        const currentList = Array.from(poolMap.values());
                                        setPool(currentList);
                                        setProgress(prev => ({ ...prev, passed: currentList.length }));
                                        try {
                                            localStorage.setItem('SCANNER_START_TREND_POOL', JSON.stringify(currentList));
                                            window.dispatchEvent(new CustomEvent('scanner_start_trend_pool_updated', { detail: currentList }));
                                        } catch (_) {}
                                    }
                                }
                            }
                        })(),
                        new Promise((_, reject) => {
                            coinTimeoutId = setTimeout(() => reject(new Error('TIMEOUT_EXCEEDED')), maxWorkTime);
                        })
                    ]);
                } catch (err) {
                    console.warn(`[StartTrendPool] Skipping ${symbol} (exceeded ${maxWorkTime}ms or network error)`);
                } finally {
                    if (coinTimeoutId) clearTimeout(coinTimeoutId);
                }

                // 精准补齐单币总时间预算：每个币从开始到跳至下一个币严格对齐为目标秒数(默认3秒)
                const elapsed = Date.now() - coinCycleStart;
                const remainingWait = Math.max(0, targetIntervalMs - elapsed);
                if (remainingWait > 0 && isMountedRef.current && isScanningRef.current) {
                    await new Promise(resolve => setTimeout(resolve, remainingWait));
                }
            }

            if (isMountedRef.current) {
                const finalList = Array.from(poolMap.values());
                setPool(finalList);
                setProgress({ current: candidates.length, total: candidates.length, passed: finalList.length });
                try {
                    localStorage.setItem('SCANNER_START_TREND_POOL', JSON.stringify(finalList));
                    window.dispatchEvent(new CustomEvent('scanner_start_trend_pool_updated', { detail: finalList }));
                } catch (_) {}
            }
        } finally {
            isScanningRef.current = false;
            (window as any).IS_START_TREND_SCANNING = false;
            if (isMountedRef.current) {
                setIsScanning(false);
            }
            // 🔒 [时间先后·接力赛]: 无论是否异常中断，在 finally 中100%保证派发完成事件，确保接力交接给大行情发现
            try {
                const currentPool = Array.from(poolMap.values());
                window.dispatchEvent(new CustomEvent('scanner_start_trend_pool_completed', { detail: currentPool }));
            } catch (_) {}
        }
    };

    // Pipeline-aware scan execution
    const triggerScheduledScan = () => {
        if (isScanningRef.current) return;
        pipelineCoordinator.enqueue('start_trend', async () => {
            await runStartTrendScan(true);
        });
    };

    // Auto Scan Trigger when isAutoScan is enabled - Sequential relay closed-loop
    useEffect(() => {
        let isLoopActive = true;
        let scanTimer: any = null;
        let lastFinishedAt = Date.now();

        const scheduleNext = (delayMs: number) => {
            if (!isLoopActive) return;
            if (scanTimer) clearTimeout(scanTimer);
            scanTimer = setTimeout(async () => {
                if (!isLoopActive || !isMountedRef.current) return;
                if (isAutoScanRef.current && !isScanningRef.current) {
                    // 🔒 [时间先后·互斥安全锁]: 若大行情（横盘蓄势/回溯周期）正在扫描，让行等待
                    if ((window as any).IS_MAJOR_TREND_SCANNING) {
                        scheduleNext(1500);
                        return;
                    }
                    await runStartTrendScan(false);
                    lastFinishedAt = Date.now();
                }
            }, delayMs);
        };

        // 初始开机：800ms 后触发第 1 棒扫描（读取交易额过滤底池）
        scheduleNext(800);

        // 🔒 [时间先后·闭环接力赛]: 
        // 列表1里“回溯周期过滤”扫描完毕后，派发 scanner_major_trend_completed，
        // “行情启动趋势”无缝接棒，重新读取“交易额过滤底池”开始新一轮扫描，周而复始！
        const handleMajorTrendCompleted = () => {
            if (!isLoopActive || !isMountedRef.current) return;
            if (!isAutoScanRef.current || isScanningRef.current) return;

            console.log("[StartTrendPool] 回溯周期过滤扫描完毕！接力棒交回【行情启动趋势】：读取“交易额过滤底池”开始新一轮闭环扫描 (周而复始)...");
            scheduleNext(800);
        };
        window.addEventListener('scanner_major_trend_completed', handleMajorTrendCompleted);

        // 🔒 [循环看门狗守护器]:
        // 若由于极端网络异常或底池空值等原因两端均处于空闲超 25 秒，看门狗自动唤醒行情启动趋势扫描，杜绝管道卡死
        const watchdog = setInterval(() => {
            if (!isLoopActive || !isMountedRef.current) return;
            if (isAutoScanRef.current && !isScanningRef.current && !(window as any).IS_MAJOR_TREND_SCANNING) {
                if (Date.now() - lastFinishedAt > 25000) {
                    console.log("[StartTrendPool] 闭环看门狗检测到空闲，主动唤醒行情启动趋势开始新一轮扫描...");
                    scheduleNext(100);
                }
            }
        }, 10000);

        return () => {
            isLoopActive = false;
            if (scanTimer) clearTimeout(scanTimer);
            clearInterval(watchdog);
            window.removeEventListener('scanner_major_trend_completed', handleMajorTrendCompleted);
        };
    }, []);

    const [volumeCandidatesCount, setVolumeCandidatesCount] = useState<number>(() => getCandidateSymbols().length);

    useEffect(() => {
        const updateCandidates = () => {
            setVolumeCandidatesCount(getCandidateSymbols().length);
        };
        window.addEventListener('scanner_volume_pool_updated', updateCandidates);
        window.addEventListener('storage', updateCandidates);
        const timer = setInterval(updateCandidates, 2000);
        return () => {
            window.removeEventListener('scanner_volume_pool_updated', updateCandidates);
            window.removeEventListener('storage', updateCandidates);
            clearInterval(timer);
        };
    }, []);

    // Filtered by search keyword
    const displayList = useMemo(() => {
        if (!searchTerm.trim()) return pool;
        const term = searchTerm.trim().toUpperCase();
        return pool.filter(item => item.symbol.includes(term));
    }, [pool, searchTerm]);

    const totalCandidates = progress.total > 0 ? progress.total : volumeCandidatesCount;
    const currentScanPos = isScanning ? progress.current : totalCandidates;

    const handleCopyAll = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (pool.length === 0) return;
        const text = pool.map(i => i.symbol).join(', ');
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="border border-slate-700/80 rounded-lg bg-[#151922] overflow-hidden shadow-sm transition-all duration-200">
            {/* Header with Title, Count Badge, (Manual/Auto), Speed (3m), Scan Trigger, and Collapse Button */}
            <div 
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="p-2 bg-slate-800/60 hover:bg-slate-800/90 flex items-center justify-between cursor-pointer transition-colors select-none"
            >
                <div className="flex items-center gap-2">
                    <div className="p-1 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                        <Flame size={13} />
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-white tracking-wide">
                            行情启动底池
                        </span>
                        {/* 三段式显示: 【交易额过滤底池数量 / 正在扫描位置 / 符合行情启动趋势的数量】 */}
                        <span 
                            className="px-1.5 py-0.5 rounded bg-amber-900/60 border border-amber-700/60 text-amber-300 font-mono font-bold text-[9px] tracking-tight"
                            title="【交易额过滤底池数量 / 正在扫描位置 / 符合行情启动趋势的数量】"
                        >
                            {totalCandidates} / {currentScanPos} / {pool.length}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    {/* (手动/自动) 读取开关 */}
                    <div className="flex items-center bg-slate-950/80 rounded border border-slate-700/80 p-0.5" title="行情启动底池扫描模式：自动实时跟踪交易额底池 / 手动单次扫描">
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsAutoScan(false);
                            }}
                            className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold transition-all ${
                                !isAutoScan 
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
                                setIsAutoScan(true);
                            }}
                            className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold transition-all ${
                                isAutoScan 
                                    ? 'bg-indigo-600 text-white shadow-sm' 
                                    : 'text-slate-400 hover:text-slate-200'
                            }`}
                        >
                            自动
                        </button>
                    </div>

                    {/* 单币扫描间隔时间按钮 (默认3秒) */}
                    <div 
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 hover:border-amber-500/60 text-[9px] text-slate-300 cursor-pointer transition-colors"
                        title="点击调整每个币扫描间隔时间(秒)"
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsEditingInterval(!isEditingInterval);
                        }}
                    >
                        <Clock size={10} className="text-amber-400" />
                        {isEditingInterval ? (
                            <input
                                type="number"
                                min={1}
                                max={60}
                                value={syncIntervalSec}
                                onChange={(e) => setSyncIntervalSec(Math.max(1, parseInt(e.target.value) || 1))}
                                onBlur={() => setIsEditingInterval(false)}
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                                className="w-8 bg-slate-950 text-white font-mono text-center text-[9px] outline-none border-b border-amber-500"
                            />
                        ) : (
                            <span className="font-mono font-bold text-amber-300">
                                ({syncIntervalSec})秒
                            </span>
                        )}
                    </div>

                    {/* Scan / Refresh Trigger Button */}
                    <button
                        onClick={triggerScheduledScan}
                        disabled={isScanning}
                        title="从交易额过滤底池执行行情启动趋势扫描"
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-white text-[9px] font-bold transition-all disabled:opacity-50 shadow-sm ${
                            isAutoScan ? 'bg-slate-700 hover:bg-slate-600' : 'bg-indigo-600 hover:bg-indigo-500'
                        }`}
                    >
                        {isScanning ? (
                            <>
                                <RefreshCw size={10} className="animate-spin" />
                                <span>{totalCandidates}/{currentScanPos}/{pool.length}</span>
                            </>
                        ) : (
                            <>
                                <Play size={9} className="fill-current" />
                                <span>{isAutoScan ? '刷新' : '执行扫描'}</span>
                            </>
                        )}
                    </button>

                    {/* Copy All Symbols */}
                    <button
                        onClick={handleCopyAll}
                        title="复制启动底池全部币名"
                        className="p-1 rounded bg-slate-700/60 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                    >
                        {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                    </button>

                    {/* Collapse Button */}
                    <button
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        className="text-slate-400 hover:text-white p-0.5 transition-colors"
                    >
                        {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                    </button>
                </div>
            </div>

            {/* Expandable Content */}
            {!isCollapsed && (
                <div className="p-2 space-y-2 border-t border-slate-800 bg-[#0e1219]/90 animate-in slide-in-from-top-1 duration-200">
                    {/* Search & Info Row */}
                    <div className="flex items-center justify-between gap-2">
                        <div className="relative flex-1">
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="在行情启动底池中搜索..."
                                className="w-full bg-slate-900 border border-slate-700/70 rounded px-2 py-0.5 text-[9px] text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500 font-mono"
                            />
                            <Search size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500" />
                        </div>
                        <div className="text-[9px] text-slate-400 font-mono flex-shrink-0">
                            显示: <strong className="text-white">{displayList.length}</strong> / {pool.length}
                        </div>
                    </div>

                    {/* Coins Grid */}
                    <div className="max-h-36 overflow-y-auto pr-1 flex flex-wrap gap-1 custom-scrollbar">
                        {displayList.length === 0 ? (
                            <div className="w-full py-4 text-center text-slate-500 text-[10px] italic">
                                {pool.length === 0 
                                    ? (isScanning ? '正在扫描交易额底池币种的K线形态...' : '暂无启动底池数据，点击右上角【执行启动扫描】直接读取交易额底池并计算') 
                                    : '未找到匹配搜索条件的币种'}
                            </div>
                        ) : (
                            displayList.map(item => (
                                <div 
                                    key={item.symbol}
                                    className={`px-1.5 py-0.5 rounded border transition-all flex items-center gap-1 group cursor-default ${
                                        item.direction === 'LONG' 
                                            ? 'bg-emerald-950/40 border-emerald-800/60 hover:border-emerald-500 text-emerald-300' 
                                            : 'bg-rose-950/40 border-rose-800/60 hover:border-rose-500 text-rose-300'
                                    }`}
                                    title={`${item.symbol}: 启动方向 ${item.direction === 'LONG' ? '做多' : '做空'} | 涨跌幅 ${item.changePct}% | 回撤 ${item.pullbackPct}% (命中组合${item.matchedGroup})`}
                                >
                                    {item.direction === 'LONG' ? (
                                        <ArrowUpRight size={11} className="text-emerald-400 shrink-0" />
                                    ) : (
                                        <ArrowDownRight size={11} className="text-rose-400 shrink-0" />
                                    )}
                                    <span className="font-mono font-bold text-[9px]">
                                        {item.symbol}
                                    </span>
                                    <span className="font-mono text-[8px] opacity-80">
                                        {item.changePct > 0 ? `+${item.changePct}%` : `${item.changePct}%`}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
