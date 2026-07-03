
import React, { useState, useMemo } from 'react';
import { List2Config, ScannerItem, ScanConfig, COLUMN_WIDTH_CLASS } from '../../../components/Scanner/scannerTypes';
import { List2Control } from './Control';
import { List2Item } from './Item';
import { Shield, Loader2, Layers, TrendingUp, TrendingDown, Maximize2, Trash2, AlertCircle, History } from 'lucide-react';
import { ScannerVisualizerModal } from '../../../components/ScannerVisualizerModal';
import { ScannerHistoryModal } from '../../momentum-audit/components/ScannerHistoryModal';

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
    setChartData: (data: any) => void;
    pollingStatus?: string; 
    activeScanTfs?: Set<string>; // New prop
    onRemoveItem: (symbol: string) => void;
    onClearItems: () => void;
}

const List2_GrandCrossing: React.FC<Props> = ({ networkStatus = 'disconnected', config, setConfig, scanConfig, setScanConfig, countdowns, tfCounts, activeFilterTf, isLocked, onTfInteraction, filteredList2, setChartData, pollingStatus, activeScanTfs, onRemoveItem, onClearItems }) => {
    
    // View Mode State: ALL | LONG | SHORT
    const [viewMode, setViewMode] = useState<'ALL' | 'LONG' | 'SHORT'>('ALL');
    const [showVisualizer, setShowVisualizer] = useState(false);
    const [showHistory, setShowHistory] = useState(false);

    // Separate Lists (Defensive: ensure filteredList2 is an array)
    const { longs, shorts } = useMemo(() => {
        const l: ScannerItem[] = [];
        const s: ScannerItem[] = [];
        (filteredList2 || []).forEach(item => {
            if (item && item.direction === 'LONG') l.push(item);
            else if (item && item.direction === 'SHORT') s.push(item);
        });
        return { longs: l, shorts: s };
    }, [filteredList2]);

    // Determine display list
    const displayList = viewMode === 'LONG' ? longs : viewMode === 'SHORT' ? shorts : (filteredList2 || []);

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
                pollingStatus={pollingStatus}
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
                        items={filteredList2.map(i => ({ symbol: i.symbol, timeframe: i.tf }))}
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
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar bg-slate-950/20">
                {displayList.map((item, idx) => (
                    <List2Item 
                        key={`${item.symbol}-${item.direction}-${item.tf}-${idx}`} 
                        item={item}
                        config={config}
                        activeFilterTf={activeFilterTf}
                        setChartData={setChartData}
                        onRemove={() => onRemoveItem(item.symbol)}
                    />
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
