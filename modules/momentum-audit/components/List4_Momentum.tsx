
import React, { useMemo, useState } from 'react';
import { Flame, Compass, AlertTriangle, Maximize2, Trash2, History, Moon, ChevronRight } from 'lucide-react';
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
    const [isDormantCollapsed, setIsDormantCollapsed] = useState(true);
    
    // --- DYNAMIC SUBSET FILTERING (Active vs Dormant) ---
    const { activeList, dormantList } = useMemo(() => {
        if (!list4) return { activeList: [], dormantList: [] };
        
        const active: ScannerItem[] = [];
        const dormant: ScannerItem[] = [];
        
        list4.forEach(item => {
            if (item.momentum?.status === 'DORMANT') {
                dormant.push(item);
            } else {
                active.push(item);
            }
        });
        
        return { activeList: active, dormantList: dormant };
    }, [list4]);

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
                        items={filteredList.map(i => {
                            const m = i.momentum || { status: 'INVALID', midPoint: 0, entryTrigger: 0, invalidReason: 'Data Loading...' };
                            return {
                                symbol: i.symbol,
                                timeframe: i.tf || '15m',
                                signals: i.structure?.signalTime ? [{ time: i.structure.signalTime, type: i.direction as any }] : [],
                                entryPrice: i.structure?.signalPrice,
                                entryTime: i.structure?.signalTime,
                                currentPrice: i.price,
                                highlightTime: i.enterList4Time,
                                showAuditLines: true,
                                list4Config: config,
                                extraLines: [
                                    { price: m.entryTrigger, label: "TRIGGER (攻)", color: "#fbbf24", style: "dashed" },
                                    { price: m.midPoint, label: "DEFENSE (守)", color: "#f87171", style: "dashed" }
                                ]
                            };
                        })}
                        defaultTf="15m"
                        onClose={() => setShowVisualizer(false)}
                    />
                )}
                {showHistory && <ScannerHistoryModal listType="LIST4" setChartData={setChartData} onClose={() => setShowHistory(false)} />}
                
                <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar bg-amber-900/5">
                    {/* 正常进攻与等待突破列表 */}
                    {activeList.map((item, idx) => (
                        <List4Item 
                            key={`${item.symbol}-${item.tf}-${idx}`}
                            item={item}
                            config={config}
                            executeTradeSafe={executeTradeSafe}
                            setChartData={setChartData}
                            onRemove={() => onRemoveItem(item.symbol)}
                            idx={idx}
                        />
                    ))}
                    {activeList.length === 0 && dormantList.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center opacity-20 text-slate-500 py-10">
                            <Compass size={40} className="mb-2"/>
                            <span className="text-[10px] font-bold">等待结构确认信号</span>
                        </div>
                    )}

                    {/* 底部折叠：破中轴休眠待复活列表 */}
                    {dormantList.length > 0 && (
                        <div className="pt-2 mt-3 border-t border-dashed border-amber-500/20">
                            <button 
                                onClick={() => setIsDormantCollapsed(!isDormantCollapsed)}
                                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded bg-amber-950/30 hover:bg-amber-950/50 border border-amber-500/20 text-amber-400/90 transition-all text-[11px] font-bold"
                            >
                                <div className="flex items-center gap-1.5">
                                    <Moon size={13} className="text-amber-400" />
                                    <span>破中轴休眠保留区 (待复活)</span>
                                    <span className="px-1.5 py-0.2 bg-amber-500/20 rounded-full text-[9px] font-mono text-amber-300">
                                        {dormantList.length}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1 text-[9px] text-amber-400/60 font-normal">
                                    <span>{isDormantCollapsed ? '展开' : '折叠'}</span>
                                    <ChevronRight 
                                        size={12} 
                                        className={`transition-transform duration-200 ${!isDormantCollapsed ? 'rotate-90' : ''}`}
                                    />
                                </div>
                            </button>

                            {!isDormantCollapsed && (
                                <div className="mt-2 space-y-2 pl-1 border-l-2 border-amber-500/20">
                                    {dormantList.map((item, idx) => (
                                        <List4Item 
                                            key={`dormant-${item.symbol}-${item.tf}-${idx}`}
                                            item={item}
                                            config={config}
                                            executeTradeSafe={executeTradeSafe}
                                            setChartData={setChartData}
                                            onRemove={() => onRemoveItem(item.symbol)}
                                            idx={idx}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </ErrorBoundary>
    );
};

export default List4_Momentum;
