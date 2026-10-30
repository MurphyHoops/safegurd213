
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { List2Config, ScannerItem, ScanConfig, COLUMN_WIDTH_CLASS } from '../../../components/Scanner/scannerTypes';
import { List2Control } from './Control';
import { List2Item } from './Item';
import { Shield, Loader2, Layers, TrendingUp, TrendingDown, Maximize2, Trash2, AlertCircle, History, ArrowUpDown, Lock, Tv, Clock, Zap, X } from 'lucide-react';
import { ScannerVisualizerModal } from '../../../components/ScannerVisualizerModal';
import { ScannerHistoryModal, useAutoHistoryLogger } from '../../momentum-audit/components/ScannerHistoryModal';
import { TimeframeDiagnosticRecord } from '../types';
import { normalizeSymbol } from '../../../services/symbolUtils';
import KlineChartModal from '../../../components/KlineChartModal';
import { audioService } from '../../../services/audioService';

interface Props {
    networkStatus?: 'healthy' | 'delayed' | 'disconnected';
    config: List2Config;
    setConfig: React.Dispatch<React.SetStateAction<List2Config>>;
    scanConfig: ScanConfig;
    setScanConfig: React.Dispatch<React.SetStateAction<ScanConfig>>;
    countdowns: Record<string, string>; 
    tfCounts: Record<string, number>; 
    activeFilterTf: string | null;
    isLocked: boolean;
    onTfInteraction: (tf: string, type: 'SINGLE' | 'LONG_2' | 'LONG_3' | 'RESET') => void;
    filteredList2: ScannerItem[];
    allList2?: ScannerItem[];
    setChartData: (data: any) => void;
    pollingStatus?: string; 
    activeScanTfs?: Set<string>; // New prop
    scanningSymbols?: Record<string, string>;
    diagnostics?: Record<string, TimeframeDiagnosticRecord>;
    totalScanCount?: number;
    onRemoveItem: (symbol: string) => void;
    onClearItems: () => void;
    activePositions?: any[];
}

const TF_ORDER = ['1m', '3m', '5m', '10m', '15m', '30m', '1h', '2h', '4h', '8h', '1d', '3d'];
const getTfWeight = (tf: string) => {
    const idx = TF_ORDER.indexOf(tf);
    return idx !== -1 ? idx : 99;
};

const List2_GrandCrossing: React.FC<Props> = ({ networkStatus = 'disconnected', config, setConfig, scanConfig, setScanConfig, countdowns, tfCounts, activeFilterTf, isLocked, onTfInteraction, filteredList2, allList2, setChartData, pollingStatus, activeScanTfs, scanningSymbols, diagnostics, totalScanCount = 0, onRemoveItem, onClearItems, activePositions }) => {
    
    // Auto History Logger for List 2 (Grand Crossing) - track all active signals across all timeframes
    useAutoHistoryLogger('LIST2', allList2 || filteredList2 || []);

    // View Mode State: ALL | LONG | SHORT (synced with config, fallback to 'ALL')
    const viewMode = config?.viewMode || 'ALL';
    const setViewMode = (mode: 'ALL' | 'LONG' | 'SHORT') => {
        setConfig(prev => ({ ...prev, viewMode: mode }));
    };
    const [showVisualizer, setShowVisualizer] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [isHoldingStandbyExpanded, setIsHoldingStandbyExpanded] = useState(true);
    const [isPreWaitExpanded, setIsPreWaitExpanded] = useState(true);

    // --- 🖥️ LIST 2 AUTO K-LINE POPUP STATE & TIMER (5-Minute Inactivity Countdown) ---
    const [enableAutoPopup, setEnableAutoPopup] = useState<boolean>(() => {
        if (config?.enableAutoPopup !== undefined) return config.enableAutoPopup;
        try {
            return localStorage.getItem('SAVIOR_LIST2_AUTO_POPUP') === 'true';
        } catch (e) {
            return false;
        }
    });

    const [autoPopupItem, setAutoPopupItem] = useState<ScannerItem | null>(null);
    const [popupTimeLeft, setPopupTimeLeft] = useState<number>(300); // 300 seconds = 5 minutes
    const seenSignalKeysRef = useRef<Set<string>>(new Set());
    const isFirstLoadRef = useRef<boolean>(true);

    // Toggle switch handler
    const handleToggleAutoPopup = () => {
        const nextVal = !enableAutoPopup;
        setEnableAutoPopup(nextVal);
        try {
            localStorage.setItem('SAVIOR_LIST2_AUTO_POPUP', String(nextVal));
        } catch (e) {}
        setConfig(prev => ({ ...prev, enableAutoPopup: nextVal }));
    };

    // Track new coins/signals entering List 2 and pop up K-line according to viewMode (ALL | LONG | SHORT)
    useEffect(() => {
        const currentList = allList2 || filteredList2 || [];
        if (!currentList || currentList.length === 0) return;

        // On initial mount, seed seenSignalKeysRef with existing signal keys so page refresh doesn't trigger mass popups
        if (isFirstLoadRef.current) {
            currentList.forEach(item => {
                if (item && item.symbol) {
                    const norm = normalizeSymbol(item.symbol);
                    if (item.groupedResults && item.groupedResults.length > 0) {
                        item.groupedResults.forEach(r => {
                            if (r.direction) {
                                seenSignalKeysRef.current.add(`${norm}-${r.direction}`);
                            }
                        });
                    } else if (item.direction) {
                        seenSignalKeysRef.current.add(`${norm}-${item.direction}`);
                    } else {
                        seenSignalKeysRef.current.add(norm);
                    }
                }
            });
            isFirstLoadRef.current = false;
            return;
        }

        // Detect new signals appearing in List 2
        for (const item of currentList) {
            if (!item || !item.symbol) continue;
            const norm = normalizeSymbol(item.symbol);
            const results = item.groupedResults || [];

            if (results.length > 0) {
                for (const r of results) {
                    const dir = r.direction || 'LONG';
                    const signalKey = `${norm}-${dir}`;

                    if (!seenSignalKeysRef.current.has(signalKey)) {
                        seenSignalKeysRef.current.add(signalKey);

                        // 🔒 [USER MANDATORY RULE]: 配合方向选项 (ALL | LONG | SHORT)
                        // 当只选多 (LONG) 时只弹出向上发散(多)的K线图，当只选空 (SHORT) 时只弹出向下发散(空)的K线图
                        const isDirectionMatch = viewMode === 'ALL' || viewMode === dir;

                        if (enableAutoPopup && isDirectionMatch) {
                            const matchingResults = results.filter(res => viewMode === 'ALL' || res.direction === dir);
                            const popupItemToSet: ScannerItem = {
                                ...item,
                                direction: dir,
                                groupedResults: matchingResults.length > 0 ? matchingResults : results
                            };
                            setAutoPopupItem(popupItemToSet);
                            setPopupTimeLeft(300); // 300 seconds (5 minutes)
                            try {
                                const dirText = dir === 'LONG' ? '向上发散(多)' : '向下发散(空)';
                                audioService.speak(`列表2新币${dirText}自动弹窗: ${norm}`, true);
                            } catch (e) {}
                            return;
                        }
                    }
                }
            } else {
                const dir = item.direction || 'LONG';
                const signalKey = `${norm}-${dir}`;
                if (!seenSignalKeysRef.current.has(signalKey)) {
                    seenSignalKeysRef.current.add(signalKey);
                    const isDirectionMatch = viewMode === 'ALL' || viewMode === dir;
                    if (enableAutoPopup && isDirectionMatch) {
                        setAutoPopupItem(item);
                        setPopupTimeLeft(300);
                        try {
                            const dirText = dir === 'LONG' ? '向上发散(多)' : '向下发散(空)';
                            audioService.speak(`列表2新币${dirText}自动弹窗: ${norm}`, true);
                        } catch (e) {}
                        return;
                    }
                }
            }
        }
    }, [filteredList2, allList2, enableAutoPopup, viewMode]);

    // 5-minute countdown timer (Auto close after 300s of inactivity)
    useEffect(() => {
        if (!autoPopupItem) return;

        const timer = setInterval(() => {
            setPopupTimeLeft(prev => {
                if (prev <= 1) {
                    setAutoPopupItem(null);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [autoPopupItem]);

    // Reset timer back to 300s on user operation inside modal
    const handleModalInteraction = () => {
        setPopupTimeLeft(300);
    };

    // 🛡️ [方案 1: DOM 节点防爆与按需物理渲染上限 - 默认初始显示前 30 个信号卡片]
    const [visibleCount, setVisibleCount] = useState(30);

    // Separate Lists and filter groupedResults by direction for strict separation with 100% deduplication
    const { longs, shorts } = useMemo(() => {
        const l: ScannerItem[] = [];
        const s: ScannerItem[] = [];
        const seenLongs = new Set<string>();
        const seenShorts = new Set<string>();

        (filteredList2 || []).forEach(item => {
            if (!item || !item.symbol) return;
            const norm = normalizeSymbol(item.symbol);
            const longResults = (item.groupedResults || []).filter(r => r.direction === 'LONG');
            const shortResults = (item.groupedResults || []).filter(r => r.direction === 'SHORT');

            if (longResults.length > 0 && !seenLongs.has(norm)) {
                seenLongs.add(norm);
                l.push({
                    ...item,
                    direction: 'LONG',
                    groupedResults: longResults
                });
            }
            if (shortResults.length > 0 && !seenShorts.has(norm)) {
                seenShorts.add(norm);
                s.push({
                    ...item,
                    direction: 'SHORT',
                    groupedResults: shortResults
                });
            }
        });
        return { longs: l, shorts: s };
    }, [filteredList2]);

    const allDeduped = useMemo(() => {
        const seen = new Set<string>();
        const res: ScannerItem[] = [];
        (filteredList2 || []).forEach(item => {
            if (!item || !item.symbol) return;
            const norm = normalizeSymbol(item.symbol);
            if (!seen.has(norm)) {
                seen.add(norm);
                res.push(item);
            }
        });
        return res;
    }, [filteredList2]);

    // Determine display list
    const rawDisplayList = viewMode === 'LONG' ? longs : viewMode === 'SHORT' ? shorts : allDeduped;

    // 📊 列表2 智能排序计算（支持 最新、最多、K线周期从小到大/从大到小）
    const displayList = useMemo(() => {
        const list = [...rawDisplayList];
        const mode = config?.sortMode || 'LATEST';
        const isDesc = config?.tfSortOrder === 'desc';

        list.sort((a, b) => {
            if (mode === 'MOST') {
                const countA = a.groupedResults?.length || 0;
                const countB = b.groupedResults?.length || 0;
                if (countA !== countB) return countB - countA;
            } else if (mode === 'TIMEFRAME') {
                const getWeights = (item: ScannerItem) => {
                    if (!item.groupedResults || item.groupedResults.length === 0) return [99];
                    return item.groupedResults.map(r => getTfWeight(r.tf || '15m'));
                };
                const weightA = isDesc ? Math.max(...getWeights(a)) : Math.min(...getWeights(a));
                const weightB = isDesc ? Math.max(...getWeights(b)) : Math.min(...getWeights(b));
                if (weightA !== weightB) {
                    return isDesc ? weightB - weightA : weightA - weightB;
                }
            }

            // 默认 / 最新模式：按最新信号K线或最小滞后根数 (lag) 排序
            const getMinLag = (item: ScannerItem) => {
                if (!item.groupedResults || item.groupedResults.length === 0) return 999;
                return Math.min(...item.groupedResults.map(r => r.lag ?? 999));
            };
            return getMinLag(a) - getMinLag(b);
        });

        return list;
    }, [rawDisplayList, config?.sortMode, config?.tfSortOrder]);

    // Active open position symbols for position standby buffer
    const openPositionSymbols = useMemo(() => {
        const set = new Set<string>();
        (activePositions || []).forEach(p => {
            if (p && p.symbol) {
                const isHolding = (typeof p.amount === 'number' && p.amount > 0) ||
                                  (typeof p.contracts === 'number' && Math.abs(p.contracts) > 0) ||
                                  (typeof p.positionAmt === 'number' && Math.abs(p.positionAmt) > 0);
                if (isHolding) {
                    set.add(normalizeSymbol(p.symbol));
                }
            }
        });
        return set;
    }, [activePositions]);

    // Separate displayList into normalList, holdingStandbyList and preWaitList (EMA10穿EMA30折叠等待蓄势区)
    const { normalList, holdingStandbyList, preWaitList } = useMemo(() => {
        const norm: ScannerItem[] = [];
        const hold: ScannerItem[] = [];
        const preWait: ScannerItem[] = [];

        (displayList || []).forEach(item => {
            if (!item || !item.symbol) return;
            const normSym = normalizeSymbol(item.symbol);
            if (openPositionSymbols.has(normSym)) {
                hold.push(item);
                return;
            }
            // 若全部周期结果均为 EMA10穿EMA30折叠等待蓄势状态，则归入 preWaitList
            const isAllPreWait = item.groupedResults && item.groupedResults.length > 0 && item.groupedResults.every(r => !!r.isPreWaitEma30);
            if (isAllPreWait) {
                preWait.push(item);
            } else {
                norm.push(item);
            }
        });
        return { normalList: norm, holdingStandbyList: hold, preWaitList: preWait };
    }, [displayList, openPositionSymbols]);

    // Defensive: Handle missing config
    if (!config) return <div className="p-4 text-xs text-red-500">List 2 Config Error</div>;

    return (
        <div className="flex flex-col h-full bg-slate-900 border-r border-slate-800 flex-[1.3] min-w-[320px] 2xl:min-w-[350px]">
            
            {/* Polling Status Bar */}
            {pollingStatus && (
                <div className="bg-indigo-900/20 border-b border-indigo-500/20 px-2 py-1 text-[9px] text-indigo-300 flex items-center justify-center gap-1.5 animate-in fade-in">
                    {pollingStatus.includes('最后扫描') ? null : <Loader2 size={8} className="animate-spin"/>}
                    <span className="font-bold">{pollingStatus.includes('最后扫描') ? '轮询待机中:' : '基于时间切片轮询中:'}</span>
                    <span className="opacity-80 truncate max-w-[120px]">{pollingStatus}</span>
                </div>
            )}

            <List2Control
                config={config} setConfig={setConfig} 
                scanConfig={scanConfig} setScanConfig={setScanConfig}
                countdowns={countdowns} tfCounts={tfCounts} 
                activeFilterTf={activeFilterTf} isLocked={isLocked} onTfInteraction={onTfInteraction}
                activeScanTfs={activeScanTfs}
                scanningSymbols={scanningSymbols}
                pollingStatus={pollingStatus}
                diagnostics={diagnostics}
                totalScanCount={totalScanCount}
                list2Items={allList2 || filteredList2}
                setChartData={setChartData}
            />
            
            {/* Header & Filter Tabs */}
            <div className="bg-slate-950/50 border-b border-slate-800 sticky top-0 z-10 flex flex-col">
                {/* Title */}
                <div className="px-3 py-2 flex items-center justify-between">
                    <div className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1.5">
                        <Shield size={12} className="text-indigo-500"/> 
                        <span>2. 绝对防御</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={handleToggleAutoPopup}
                            className={`flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-bold transition-all mr-1 cursor-pointer ${
                                enableAutoPopup 
                                    ? 'bg-indigo-900/50 text-indigo-300 border-indigo-500/60 shadow-[0_0_8px_rgba(99,102,241,0.3)]' 
                                    : 'bg-slate-800 text-slate-500 border-slate-700 hover:text-slate-300'
                            }`}
                            title={enableAutoPopup ? "自动弹窗已开启：列表2有新币出现时自动在桌面上弹出K线图5分钟 (无操作自动关闭)" : "点击开启：列表2有新币出现时自动在桌面上弹出K线图"}
                        >
                            <Tv size={12} className={enableAutoPopup ? "text-indigo-400 animate-pulse" : "text-slate-500"} />
                            <span>自动弹窗: {enableAutoPopup ? '开' : '关'}</span>
                        </button>
                        <button 
                            onClick={(e) => {
                                e.stopPropagation();
                                onClearItems();
                            }}
                            className="flex items-center gap-1.5 px-2 py-1 bg-red-900/20 hover:bg-red-900/40 rounded border border-red-500/30 text-red-400 transition-all text-[10px] font-bold mr-1"
                            title="清空当前所有信号"
                        >
                            <Trash2 size={12} />
                            <span>清空</span>
                        </button>
                        <button 
                            onClick={() => setShowHistory(true)}
                            className="flex items-center gap-1.5 px-2 py-1 bg-slate-800 hover:bg-emerald-900/50 rounded border border-emerald-500/30 text-emerald-500 transition-all text-[10px] font-bold mr-1"
                            title="查看历史记录"
                        >
                            <History size={12} />
                            <span>历史</span>
                        </button>
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
                        title="2. 绝对防御"
                        items={displayList.map(i => {
                            const tf = i.tf || activeFilterTf || '15m';
                            const signals: { time: number, type: 'LONG' | 'SHORT' }[] = [];
                            i.groupedResults?.forEach(res => {
                                if (res.tf === tf && res.crossingTimes) {
                                    res.crossingTimes.forEach(t => {
                                        signals.push({ time: t, type: res.direction || 'LONG' });
                                    });
                                }
                            });
                            return {
                                symbol: i.symbol,
                                timeframe: tf,
                                signals: signals,
                                currentPrice: i.price,
                                showAuditLines: false,
                                entryPrice: i.price, // Same as currentPrice as list2 entry representation
                            };
                        })}
                        defaultTf={activeFilterTf || '15m'}
                        list2Config={config}
                        onClose={() => setShowVisualizer(false)}
                    />
                )}
                {showHistory && <ScannerHistoryModal listType="LIST2" setChartData={setChartData} onClose={() => setShowHistory(false)} />}

                {/* Filter Tabs */}
                <div className="flex px-2 pb-2 gap-1">
                    <button 
                        onClick={() => setViewMode('ALL')}
                        className={`flex-1 py-1 rounded text-[9px] font-bold flex items-center justify-center gap-1 transition-all border ${
                            viewMode === 'ALL' 
                            ? 'bg-slate-700 text-white border-slate-600' 
                            : 'bg-slate-800 text-slate-500 border-slate-700 hover:text-slate-300'
                        }`}
                    >
                        <Layers size={10} /> 全部 ({(filteredList2 || []).length})
                    </button>
                    <button 
                        onClick={() => setViewMode('LONG')}
                        className={`flex-1 py-1 rounded text-[9px] font-bold flex items-center justify-center gap-1 transition-all border ${
                            viewMode === 'LONG' 
                            ? 'bg-emerald-900/40 text-emerald-400 border-emerald-500/50 shadow-[0_0_8px_rgba(16,185,129,0.2)]' 
                            : 'bg-slate-800 text-slate-500 border-slate-700 hover:text-emerald-400 hover:border-emerald-500/30'
                        }`}
                    >
                        <TrendingUp size={10} /> 多 ({longs.length})
                    </button>
                    <button 
                        onClick={() => setViewMode('SHORT')}
                        className={`flex-1 py-1 rounded text-[9px] font-bold flex items-center justify-center gap-1 transition-all border ${
                            viewMode === 'SHORT' 
                            ? 'bg-red-900/40 text-red-400 border-red-500/50 shadow-[0_0_8px_rgba(239,68,68,0.2)]' 
                            : 'bg-slate-800 text-slate-500 border-slate-700 hover:text-red-400 hover:border-red-500/30'
                        }`}
                    >
                        <TrendingDown size={10} /> 空 ({shorts.length})
                    </button>
                </div>

                {/* Sync Filter Switch */}
                <div className="flex items-center justify-between px-3 pb-2 pt-1 text-[10px] text-slate-400 border-t border-slate-800/40">
                    <span className="flex items-center gap-1">
                        <AlertCircle size={10} className="text-slate-500" />
                        <span>多空过滤同步至列表3</span>
                    </span>
                    <button
                        onClick={() => {
                            setConfig(prev => ({
                                ...prev,
                                syncDirectionFilterToList3: !prev.syncDirectionFilterToList3
                            }));
                        }}
                        className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            config?.syncDirectionFilterToList3 ? 'bg-indigo-500' : 'bg-slate-700'
                        }`}
                        title="开启后，若当前选择只看“多”或“空”，下级列表3及后续流程将只接收该方向的信号；若选择“全部”或关闭此开关，则同时读取多空"
                    >
                        <span
                            className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                config?.syncDirectionFilterToList3 ? 'translate-x-4' : 'translate-x-0'
                            }`}
                        />
                    </button>
                </div>
            </div>

            {/* 📊 列表2 智能排序控制面板 (仿照列表1样式与位置，置于列表上方) */}
            <div className="px-3 py-1.5 bg-slate-950/70 border-b border-slate-800/60 flex flex-col gap-1 animate-in fade-in shrink-0">
                <div className="flex items-center justify-between text-[8px] font-bold text-slate-400 uppercase tracking-wider">
                    <span>列表排序</span>
                    <span className="text-[7.5px] text-slate-500 font-mono">
                        {config.sortMode === 'MOST' 
                            ? '触发周期数量 (最多)' 
                            : config.sortMode === 'TIMEFRAME' 
                                ? `K线周期 (${config.tfSortOrder === 'desc' ? '大→小' : '小→大'})` 
                                : '最新信号 (时间优先)'}
                    </span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                    {/* 最新 */}
                    <button
                        type="button"
                        onClick={() => setConfig(p => ({ ...p, sortMode: 'LATEST' }))}
                        className={`flex items-center justify-center py-1 px-1.5 rounded text-[8.5px] font-bold transition-all border cursor-pointer ${
                            (!config.sortMode || config.sortMode === 'LATEST')
                                ? 'bg-indigo-650/20 bg-indigo-600/20 border-indigo-500 text-indigo-300 shadow-[0_0_8px_rgba(99,102,241,0.2)]'
                                : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                        }`}
                        title="按最新信号K线时间或最小滞后根数 (lag) 排序"
                    >
                        最新
                    </button>

                    {/* 最多 */}
                    <button
                        type="button"
                        onClick={() => setConfig(p => ({ ...p, sortMode: 'MOST' }))}
                        className={`flex items-center justify-center py-1 px-1.5 rounded text-[8.5px] font-bold transition-all border cursor-pointer ${
                            config.sortMode === 'MOST'
                                ? 'bg-indigo-650/20 bg-indigo-600/20 border-indigo-500 text-indigo-300 shadow-[0_0_8px_rgba(99,102,241,0.2)]'
                                : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                        }`}
                        title="按命中触发的周期总数量从多到少排序"
                    >
                        最多
                    </button>

                    {/* K线周期 */}
                    <div
                        className={`flex items-center justify-between py-1 px-1.5 rounded text-[8.5px] font-bold transition-all border ${
                            config.sortMode === 'TIMEFRAME'
                                ? 'bg-indigo-650/20 bg-indigo-600/20 border-indigo-500 text-indigo-300 shadow-[0_0_8px_rgba(99,102,241,0.2)]'
                                : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                        }`}
                    >
                        <button
                            type="button"
                            onClick={() => setConfig(p => ({ ...p, sortMode: 'TIMEFRAME' }))}
                            className="flex-1 text-left truncate mr-0.5 cursor-pointer"
                            title="按K线周期大小排序"
                        >
                            K线周期
                        </button>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                const newOrder = config.tfSortOrder === 'desc' ? 'asc' : 'desc';
                                setConfig(p => ({ ...p, sortMode: 'TIMEFRAME', tfSortOrder: newOrder }));
                            }}
                            className={`p-0.5 rounded cursor-pointer transition-colors flex items-center justify-center ${
                                config.sortMode === 'TIMEFRAME'
                                    ? 'text-indigo-200 hover:text-white bg-indigo-500/40'
                                    : 'text-slate-500 hover:text-slate-300 bg-slate-800'
                            }`}
                            title={`当前为: ${config.tfSortOrder === 'desc' ? '由大到小 (3d → 1m)' : '由小到大 (1m → 3d)'}，点击切换`}
                        >
                            <ArrowUpDown size={10} />
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar bg-slate-950/20">
                {/* ⚡ [EMA10穿EMA30前置折叠等待蓄势区 - 毫秒级定向盯盘] */}
                {preWaitList.length > 0 && (
                    <div className="mb-2.5 animate-in fade-in">
                        <button
                            type="button"
                            onClick={() => setIsPreWaitExpanded(p => !p)}
                            className="w-full bg-cyan-950/40 hover:bg-cyan-900/50 border border-cyan-500/40 p-2 rounded-lg flex items-center justify-between transition-all cursor-pointer shadow-[0_0_12px_rgba(6,182,212,0.15)] mb-1.5"
                        >
                            <div className="flex items-center gap-1.5 text-[10px] font-bold text-cyan-300">
                                <Zap size={13} className="text-cyan-400 animate-pulse" />
                                <span>⚡ EMA10穿EMA30蓄势折叠区 (预警待命)</span>
                                <span className="px-1.5 py-0.2 bg-cyan-500/30 text-cyan-200 rounded text-[9px] font-mono font-bold border border-cyan-400/40 shadow-sm">
                                    {preWaitList.length}
                                </span>
                            </div>
                            <span className="text-[9px] text-cyan-400/90 font-mono">
                                {isPreWaitExpanded ? '点击折叠 ▲' : '点击展开 ▼'}
                            </span>
                        </button>

                        {isPreWaitExpanded && (
                            <div className="space-y-1.5 pl-1.5 border-l-2 border-cyan-500/40 mb-2">
                                <div className="text-[8.5px] text-cyan-400/80 px-1 mb-1 font-mono flex items-center gap-1">
                                    <span>※</span>
                                    <span>EMA10已穿越EMA30，正处于毫秒级高频定向盯盘中；一旦穿越EMA40且当根收盘立即正式晋升</span>
                                </div>
                                {preWaitList.map((item, idx) => (
                                    item ? (
                                        <div key={`prewait-${item.symbol}-${idx}`} className="relative rounded-lg border border-cyan-500/40 bg-cyan-950/20 p-1 shadow-sm">
                                            <div className="flex items-center justify-between text-[8.5px] font-bold text-cyan-300 bg-cyan-900/40 px-2 py-0.5 rounded mb-1 border border-cyan-500/30">
                                                <span className="flex items-center gap-1">
                                                    <Zap size={9} className="text-cyan-400" />
                                                    <span>EMA10&gt;30 蓄势待命</span>
                                                </span>
                                                <span className="text-cyan-200/90 font-mono">
                                                    已等待 {item.groupedResults?.[0]?.preWaitElapsedBars ?? 1} / 限 {config?.ema30PreWaitBars ?? 5} 根
                                                </span>
                                            </div>
                                            <List2Item 
                                                item={item}
                                                config={config}
                                                activeFilterTf={activeFilterTf}
                                                setChartData={setChartData}
                                                onRemove={() => onRemoveItem(item.symbol)}
                                                idx={idx}
                                            />
                                        </div>
                                    ) : null
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {normalList.slice(0, visibleCount).map((item, idx) => (
                    item ? (
                        <List2Item 
                            key={`${item.symbol}-${item.direction || 'ALL'}-${idx}`} 
                            item={item}
                            config={config}
                            activeFilterTf={activeFilterTf}
                            setChartData={setChartData}
                            onRemove={() => onRemoveItem(item.symbol)}
                            idx={idx}
                        />
                    ) : null
                ))}

                {normalList.length > visibleCount && (
                    <div className="py-2 px-3 bg-slate-900/80 border border-slate-800 rounded-lg flex items-center justify-between text-xs text-slate-400 mt-1 shadow-inner">
                        <span className="text-[10px]">已显示前 {visibleCount} 项 / 共 {normalList.length} 项信号</span>
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => setVisibleCount(prev => Math.min(prev + 30, normalList.length))}
                                className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-indigo-300 rounded border border-slate-700 text-[10px] font-bold transition-all cursor-pointer"
                            >
                                更多 (+30)
                            </button>
                            <button
                                type="button"
                                onClick={() => setVisibleCount(normalList.length)}
                                className="px-2 py-0.5 bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white rounded border border-indigo-500/40 text-[10px] font-bold transition-all cursor-pointer"
                            >
                                展开全部
                            </button>
                        </div>
                    </div>
                )}

                {normalList.length === 0 && holdingStandbyList.length === 0 && preWaitList.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-24 text-slate-600 opacity-50">
                        <span className="text-[10px]">该方向暂无信号</span>
                    </div>
                )}

                {/* 🔒 [持仓中形态避让 - 临时存放表格]: 已开仓币种避让暂停下发列表3/4，遵从列表2同款存续与死叉规则 */}
                {holdingStandbyList.length > 0 && (
                    <div className="mt-3 border-t border-amber-500/30 pt-2 animate-in fade-in">
                        <button
                            type="button"
                            onClick={() => setIsHoldingStandbyExpanded(p => !p)}
                            className="w-full bg-amber-950/40 hover:bg-amber-900/50 border border-amber-500/40 p-2 rounded-lg flex items-center justify-between transition-all cursor-pointer shadow-inner mb-2"
                        >
                            <div className="flex items-center gap-1.5 text-[10px] font-bold text-amber-300">
                                <Lock size={12} className="text-amber-400 animate-pulse" />
                                <span>🔒 持仓中形态避让 (临时存放)</span>
                                <span className="px-1.5 py-0.2 bg-amber-500/30 text-amber-200 rounded text-[9px] font-mono font-bold border border-amber-400/30">
                                    {holdingStandbyList.length}
                                </span>
                            </div>
                            <span className="text-[9px] text-amber-400/80 font-mono">
                                {isHoldingStandbyExpanded ? '点击折叠 ▲' : '点击展开 ▼'}
                            </span>
                        </button>

                        {isHoldingStandbyExpanded && (
                            <div className="space-y-1.5 pl-1 border-l-2 border-amber-500/30">
                                <div className="text-[8.5px] text-amber-400/70 px-1 mb-1 font-mono">
                                    ※ 已开仓币种避让暂停下发列表3/4，遵从列表2同款寿命根数与反向死叉清理规则
                                </div>
                                {holdingStandbyList.map((item, idx) => (
                                    item ? (
                                        <div key={`standby-${item.symbol}-${idx}`} className="relative rounded-lg border border-amber-500/40 bg-amber-950/20 p-1 shadow-sm">
                                            <div className="flex items-center justify-between text-[8.5px] font-bold text-amber-300 bg-amber-900/40 px-2 py-0.5 rounded mb-1 border border-amber-500/30">
                                                <span className="flex items-center gap-1">
                                                    <Lock size={9} />
                                                    <span>持仓避让中 (已建仓)</span>
                                                </span>
                                                <span className="opacity-80">多周期发散观察中</span>
                                            </div>
                                            <List2Item 
                                                item={item}
                                                config={config}
                                                activeFilterTf={activeFilterTf}
                                                setChartData={setChartData}
                                                onRemove={() => onRemoveItem(item.symbol)}
                                                idx={idx}
                                            />
                                        </div>
                                    ) : null
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* 🖥️ 列表2 新币桌面自动弹出 K线图 (支持5分钟无操作自动关闭与手工操作续期) */}
            {autoPopupItem && (
                <div 
                    onMouseMove={handleModalInteraction} 
                    onClick={handleModalInteraction} 
                    onKeyDown={handleModalInteraction}
                    onScroll={handleModalInteraction}
                    className="relative"
                >
                    {/* Floating Top Inactivity Countdown Bar Overlay */}
                    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[100000] bg-slate-950/90 border border-indigo-500/80 px-4 py-1.5 rounded-full shadow-[0_0_25px_rgba(99,102,241,0.6)] flex items-center gap-3 text-xs font-bold text-white backdrop-blur-md animate-in fade-in slide-in-from-top-2">
                        <span className="flex items-center gap-1.5 text-indigo-300">
                            <Zap size={14} className="text-amber-400 animate-pulse" />
                            <span>列表2新币自动弹出: <strong className="text-amber-300 font-mono text-sm">{normalizeSymbol(autoPopupItem.symbol)}</strong> {autoPopupItem.direction === 'LONG' ? <span className="text-emerald-400 bg-emerald-950/80 border border-emerald-500/40 px-1.5 py-0.5 rounded text-[10px] ml-1">向上发散(多)</span> : autoPopupItem.direction === 'SHORT' ? <span className="text-red-400 bg-red-950/80 border border-red-500/40 px-1.5 py-0.5 rounded text-[10px] ml-1">向下发散(空)</span> : null}</span>
                        </span>
                        <span className="font-mono bg-indigo-900/80 border border-indigo-500/50 px-2.5 py-0.5 rounded-full text-amber-300 flex items-center gap-1.5 shadow-inner">
                            <Clock size={12} className="text-amber-400 animate-spin" style={{ animationDuration: '4s' }} />
                            <span>⏱️ {Math.floor(popupTimeLeft / 60)}:{(popupTimeLeft % 60).toString().padStart(2, '0')}</span>
                            <span className="text-[10px] text-slate-400 font-sans font-normal ml-0.5">(无操作 5 分钟自动关闭)</span>
                        </span>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                setAutoPopupItem(null);
                            }}
                            className="bg-slate-800 hover:bg-red-900/60 p-1 rounded-full text-slate-300 hover:text-white transition-all border border-slate-700 hover:border-red-500/50 ml-1 cursor-pointer"
                            title="手动关闭弹窗"
                        >
                            <X size={14} />
                        </button>
                    </div>

                    <KlineChartModal
                        symbol={autoPopupItem.symbol}
                        initialTimeframe={autoPopupItem.groupedResults?.[0]?.tf || activeFilterTf || '15m'}
                        signals={(() => {
                            const defaultTf = autoPopupItem.groupedResults?.[0]?.tf || activeFilterTf || '15m';
                            const sigs: { time: number, type: 'LONG' | 'SHORT' }[] = [];
                            autoPopupItem.groupedResults?.forEach(res => {
                                if (res.tf === defaultTf && res.crossingTimes) {
                                    res.crossingTimes.forEach(t => {
                                        sigs.push({ time: t, type: res.direction || 'LONG' });
                                    });
                                }
                            });
                            return sigs;
                        })()}
                        currentPrice={autoPopupItem.price}
                        list2Config={config}
                        showAuditLines={false}
                        source="list2"
                        onClose={() => setAutoPopupItem(null)}
                    />
                </div>
            )}
        </div>
    );
};

export default List2_GrandCrossing;
