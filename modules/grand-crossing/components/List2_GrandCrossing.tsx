
import React, { useState, useMemo } from 'react';
import { List2Config, ScannerItem, ScanConfig, COLUMN_WIDTH_CLASS } from '../../../components/Scanner/scannerTypes';
import { List2Control } from './Control';
import { List2Item } from './Item';
import { Shield, Loader2, Layers, TrendingUp, TrendingDown, Maximize2, Trash2, AlertCircle, History, ArrowUpDown } from 'lucide-react';
import { ScannerVisualizerModal } from '../../../components/ScannerVisualizerModal';
import { ScannerHistoryModal, useAutoHistoryLogger } from '../../momentum-audit/components/ScannerHistoryModal';
import { TimeframeDiagnosticRecord } from '../types';

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
    onRemoveItem: (symbol: string) => void;
    onClearItems: () => void;
}

const TF_ORDER = ['1m', '3m', '5m', '10m', '15m', '30m', '1h', '2h', '4h', '8h', '1d', '3d'];
const getTfWeight = (tf: string) => {
    const idx = TF_ORDER.indexOf(tf);
    return idx !== -1 ? idx : 99;
};

const List2_GrandCrossing: React.FC<Props> = ({ networkStatus = 'disconnected', config, setConfig, scanConfig, setScanConfig, countdowns, tfCounts, activeFilterTf, isLocked, onTfInteraction, filteredList2, allList2, setChartData, pollingStatus, activeScanTfs, scanningSymbols, diagnostics, onRemoveItem, onClearItems }) => {
    
    // Auto History Logger for List 2 (Grand Crossing) - track all active signals across all timeframes
    useAutoHistoryLogger('LIST2', allList2 || filteredList2 || []);

    // View Mode State: ALL | LONG | SHORT (synced with config, fallback to 'ALL')
    const viewMode = config?.viewMode || 'ALL';
    const setViewMode = (mode: 'ALL' | 'LONG' | 'SHORT') => {
        setConfig(prev => ({ ...prev, viewMode: mode }));
    };
    const [showVisualizer, setShowVisualizer] = useState(false);
    const [showHistory, setShowHistory] = useState(false);

    // Separate Lists and filter groupedResults by direction for strict separation
    const { longs, shorts } = useMemo(() => {
        const l: ScannerItem[] = [];
        const s: ScannerItem[] = [];
        (filteredList2 || []).forEach(item => {
            if (!item) return;
            const longResults = (item.groupedResults || []).filter(r => r.direction === 'LONG');
            const shortResults = (item.groupedResults || []).filter(r => r.direction === 'SHORT');

            if (longResults.length > 0) {
                l.push({
                    ...item,
                    direction: 'LONG',
                    groupedResults: longResults
                });
            }
            if (shortResults.length > 0) {
                s.push({
                    ...item,
                    direction: 'SHORT',
                    groupedResults: shortResults
                });
            }
        });
        return { longs: l, shorts: s };
    }, [filteredList2]);

    // Determine display list
    const rawDisplayList = viewMode === 'LONG' ? longs : viewMode === 'SHORT' ? shorts : (filteredList2 || []);

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

    // Defensive: Handle missing config
    if (!config) return <div className="p-4 text-xs text-red-500">List 2 Config Error</div>;

    return (
        <div className={`flex flex-col h-full bg-slate-900 border-r border-slate-800 ${COLUMN_WIDTH_CLASS}`}>
            
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
                setChartData={setChartData}
            />
            
            {/* Header & Filter Tabs */}
            <div className="bg-slate-950/50 border-b border-slate-800 sticky top-0 z-10 flex flex-col">
                {/* Title */}
                <div className="px-3 py-2 flex items-center justify-between">
                    <div className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1.5">
                        <Shield size={12} className="text-indigo-500"/> 
                        <span>2. 绝对防御 Physics Defense</span>
                    </div>
                    <div className="flex items-center gap-1">
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
                {displayList.map((item, idx) => (
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
                {displayList.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-24 text-slate-600 opacity-50">
                        <span className="text-[10px]">该方向暂无信号</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default List2_GrandCrossing;
