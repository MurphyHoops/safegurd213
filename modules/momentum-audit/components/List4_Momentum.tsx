
import React, { useMemo, useState } from 'react';
import { Flame, Compass, AlertTriangle, Maximize2, Trash2, History } from 'lucide-react';
import { List4Config, List3Config, ScannerItem, COLUMN_WIDTH_CLASS } from '../../../components/Scanner/scannerTypes';
import { PositionSide } from '../../../types';
import { List4Control } from './Control';
import { ErrorBoundary } from '../../../components/ErrorBoundary';
import { List4Item } from './Item';
import { ScannerVisualizerModal } from '../../../components/ScannerVisualizerModal';
import { ScannerHistoryModal } from './ScannerHistoryModal';

interface Props {
    config: List4Config;
    setConfig: React.Dispatch<React.SetStateAction<List4Config>>;
    list4: ScannerItem[];
    list3Config: List3Config | null; // Receive List 3 config, can be null initially
    executeTradeSafe: (symbol: string, side: PositionSide, price: number, reason: string, signalTf?: string, signalCandle?: any, entryEmas?: any) => boolean;
    setChartData: (data: any) => void;
    onRemoveItem: (symbol: string) => void;
    onClearItems: () => void;
}

const List4_Momentum: React.FC<Props> = ({ config, setConfig, list4, list3Config, executeTradeSafe, setChartData, onRemoveItem, onClearItems }) => {
    const [showVisualizer, setShowVisualizer] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    
    // --- DYNAMIC SUBSET FILTERING ---
    const filteredList = useMemo(() => {
        if (!list4) return [];
        return list4; // Items are already latched upstream in useMomentumAudit
    }, [list4]);

    if (!list3Config) {
        return (
            <div className={`flex flex-col h-full bg-slate-900 border-r border-slate-800 ${COLUMN_WIDTH_CLASS} items-center justify-center`}>
                <span className="text-xs text-slate-500 flex items-center gap-2"><AlertTriangle size={12}/> 等待上游模块初始化...</span>
            </div>
        );
    }

    return (
        <ErrorBoundary moduleName="动能审计">
            <div className={`flex flex-col h-full bg-slate-900 border-r border-slate-800 ${COLUMN_WIDTH_CLASS}`}>
                <List4Control config={config} setConfig={setConfig} />
                
                <div className="px-3 py-2 bg-amber-950/20 border-b border-slate-800 flex justify-between items-center sticky top-0">
                    <div className="flex items-center gap-2">
                        <div className="text-[10px] font-bold text-amber-500 uppercase flex items-center gap-1"><Flame size={12}/> 4. 动能审计</div>
                    <div className="flex items-center gap-1">
                        <button 
                            onClick={(e) => {
                                e.stopPropagation();
                                onClearItems();
                            }}
                            className="flex items-center gap-1.5 px-2 py-1 bg-red-900/20 hover:bg-red-900/40 rounded border border-red-500/30 text-red-400 transition-all text-[10px] font-bold mr-1"
                            title="清空动能列表"
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
                    <div className="text-xs font-mono font-bold text-white">{filteredList.length}</div>
                </div>

                {showVisualizer && (
                    <ScannerVisualizerModal 
                        title="4. 动能审计"
                        items={filteredList.map(i => ({ symbol: i.symbol, timeframe: i.tf }))}
                        defaultTf="15m"
                        onClose={() => setShowVisualizer(false)}
                    />
                )}
                {showHistory && <ScannerHistoryModal listType="LIST4" setChartData={setChartData} onClose={() => setShowHistory(false)} />}
                
                <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar bg-amber-900/5">
                    {filteredList.map((item, idx) => (
                        <List4Item 
                            key={`${item.symbol}-${idx}`}
                            item={item}
                            executeTradeSafe={executeTradeSafe}
                            setChartData={setChartData}
                            onRemove={() => onRemoveItem(item.symbol)}
                        />
                    ))}
                    {filteredList.length === 0 && <div className="h-full flex flex-col items-center justify-center opacity-20 text-slate-500 py-10"><Compass size={40} className="mb-2"/><span className="text-[10px] font-bold">等待结构确认信号</span></div>}
                </div>
            </div>
        </ErrorBoundary>
    );
};

export default List4_Momentum;
