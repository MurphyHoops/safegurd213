
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
    list3Config: List3Config; // Receive List 3 config for subset filtering
    executeTradeSafe: (symbol: string, side: PositionSide, price: number, reason: string, signalTf?: string) => void;
    setChartData: (data: any) => void;
}

const List4_Momentum: React.FC<Props> = ({ config, setConfig, list4, list3Config, executeTradeSafe, setChartData }) => {
    
    // --- DYNAMIC SUBSET FILTERING ---
    const filteredList = useMemo(() => {
        // Defensive check: If list3Config is missing, we default to strict filtering safety
        const safeStrictTrend = list3Config?.strictTrend ?? true; 
        const safeTfs = list3Config?.timeframes || [];

        return list4.filter(item => {
            const s = item.structure;
            if (!s) return false; 

            // 1. Timeframe Check
            if (safeTfs.length > 0 && !safeTfs.includes(item.tf || '')) return false;

            // 2. Strict Trend Check (Critical Fix: Enforce if config is true or undefined)
            if (safeStrictTrend && !s.isStrictTrend) return false;

            // 3. Color Check
            if (list3Config?.checkCandleColor && !s.isColorValid) return false;

            // 4. Thrust Check
            if (list3Config?.enableThrust && !s.thrustValid) return false;

            // 5. Resonance Checks
            if (list3Config?.enableResonance) {
                if (s.locationPct > list3Config.maxLocation) return false;
                if (s.crossCount < list3Config.minCrossCount) return false;
                if (s.bbw > list3Config.maxBBW) return false;
            }

            // 6. RSI Checks
            const rsi = s.rsi;
            if (list3Config) {
                if (item.direction === 'LONG') {
                    if (rsi < list3Config.rsiLongMin || rsi > list3Config.rsiLongMax) return false;
                } else {
                    if (rsi < list3Config.rsiShortMin || rsi > list3Config.rsiShortMax) return false;
                }
            }

            return true;
        });
    }, [list4, list3Config]);

    if (!list3Config) {
        return (
            <div className={`flex flex-col h-full bg-slate-900 border-r border-slate-800 ${COLUMN_WIDTH_CLASS} items-center justify-center`}>
                <span className="text-xs text-slate-500 flex items-center gap-2"><AlertTriangle size={12}/> 初始化配置中...</span>
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
                            key={idx}
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
