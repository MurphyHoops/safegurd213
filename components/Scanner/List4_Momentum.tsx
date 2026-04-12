
import React, { useMemo } from 'react';
import { Flame, Compass, AlertTriangle } from 'lucide-react';
import { List4Config, List3Config, ScannerItem, COLUMN_WIDTH_CLASS } from './scannerTypes';
import { PositionSide } from '../../types';
import { List4Control } from './List4/Control';
import { ErrorBoundary } from '../ErrorBoundary';
import { List4Item } from './List4/Item';

interface Props {
    config: List4Config;
    setConfig: React.Dispatch<React.SetStateAction<List4Config>>;
    list4: ScannerItem[];
    list3Config: List3Config | null; // Receive List 3 config, can be null initially
    executeTradeSafe: (symbol: string, side: PositionSide, price: number, reason: string, signalTf?: string, signalCandle?: any, entryEmas?: any) => void;
    setChartData: (data: any) => void;
}

const List4_Momentum: React.FC<Props> = ({ config, setConfig, list4, list3Config, executeTradeSafe, setChartData }) => {
    
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
                    <div className="text-[10px] font-bold text-amber-500 uppercase flex items-center gap-1"><Flame size={12}/> 4. 动能审计</div>
                    <div className="text-xs font-mono font-bold text-white">{filteredList.length}</div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar bg-amber-900/5">
                    {filteredList.map((item, idx) => (
                        <List4Item 
                            key={`${item.symbol}-${idx}`}
                            item={item}
                            executeTradeSafe={executeTradeSafe}
                            setChartData={setChartData}
                        />
                    ))}
                    {filteredList.length === 0 && <div className="h-full flex flex-col items-center justify-center opacity-20 text-slate-500 py-10"><Compass size={40} className="mb-2"/><span className="text-[10px] font-bold">等待结构确认信号</span></div>}
                </div>
            </div>
        </ErrorBoundary>
    );
};

export default List4_Momentum;
