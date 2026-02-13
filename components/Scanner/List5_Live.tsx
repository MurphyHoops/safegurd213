
import React, { useState, useMemo } from 'react';
import { Position, PositionSide } from '../../types';
import { Activity, ArrowUp, ArrowDown, Filter, Layers, TrendingUp, TrendingDown, CheckCircle2, AlertCircle } from 'lucide-react';
import { COLUMN_WIDTH_CLASS } from './scannerTypes';
import { LivePositionRow } from './List5/PositionRow';

interface List5Props {
    moduleStats: {
        symbolCount: number;
        totalValue: number;
        totalPnl: number;
    };
    sortedActivePositions: Position[];
    realPrices: Record<string, number>;
    setChartData: (data: any) => void;
    onClosePosition: (symbol: string, side: PositionSide) => void;
    list5Sort: 'DESC' | 'ASC';
    setList5Sort: (v: 'DESC' | 'ASC') => void;
}

const List5_Live: React.FC<List5Props> = ({ 
    moduleStats, sortedActivePositions, realPrices, setChartData, onClosePosition,
    list5Sort, setList5Sort
}) => {
    const [filterSide, setFilterSide] = useState<'ALL' | 'LONG' | 'SHORT'>('ALL');
    const [filterPnL, setFilterPnL] = useState<'ALL' | 'WIN' | 'LOSS'>('ALL');

    const filteredList = useMemo(() => {
        return sortedActivePositions.filter(p => {
            // Side Filter
            if (filterSide === 'LONG' && p.side !== PositionSide.LONG) return false;
            if (filterSide === 'SHORT' && p.side !== PositionSide.SHORT) return false;
            
            // PnL Filter
            if (filterPnL === 'WIN' && p.unrealizedPnL <= 0) return false;
            if (filterPnL === 'LOSS' && p.unrealizedPnL >= 0) return false;
            
            return true;
        });
    }, [sortedActivePositions, filterSide, filterPnL]);

    return (
        <div className={`flex flex-col h-full bg-slate-900 border-r border-slate-800 ${COLUMN_WIDTH_CLASS}`}>
            <div className="p-3 bg-slate-900 border-b border-slate-800 space-y-2 shrink-0">
                <div className="font-bold text-emerald-400 text-sm flex items-center gap-2"><Activity size={14}/> 5. 战场实况 (LIVE)</div>
                <div className="bg-slate-800/50 p-2 rounded border border-slate-700 flex justify-between items-center text-[10px]">
                    <span className="text-slate-500">总持仓: <span className="text-white font-bold">{moduleStats.symbolCount}</span></span>
                    <span className="text-slate-500">浮盈: <span className={`font-bold ${moduleStats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{moduleStats.totalPnl.toFixed(1)}</span></span>
                </div>
            </div>
            
            {/* Control Bar */}
            <div className="px-2 py-2 bg-emerald-950/20 border-b border-slate-800 flex flex-col gap-2 sticky top-0 z-10">
                <div className="flex justify-between items-center">
                    <div className="text-[10px] font-bold text-emerald-500 uppercase flex items-center gap-1">
                        <Filter size={10} /> 筛选与排序
                    </div>
                    {/* Sort Toggle */}
                    <button 
                        onClick={() => setList5Sort(list5Sort === 'DESC' ? 'ASC' : 'DESC')} 
                        className="flex items-center gap-1 text-[9px] bg-slate-800 border border-slate-700 px-2 py-0.5 rounded text-slate-300 hover:text-white transition-colors"
                    >
                        {list5Sort === 'DESC' ? '盈亏: 高→低' : '盈亏: 低→高'}
                        {list5Sort === 'DESC' ? <ArrowDown size={10}/> : <ArrowUp size={10}/>}
                    </button>
                </div>

                {/* Filters Row */}
                <div className="flex gap-1">
                    {/* Side Filter */}
                    <div className="flex bg-slate-800 rounded p-0.5 border border-slate-700 flex-1">
                        <button onClick={() => setFilterSide('ALL')} className={`flex-1 py-1 rounded text-[9px] font-bold transition-colors ${filterSide === 'ALL' ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>全</button>
                        <button onClick={() => setFilterSide('LONG')} className={`flex-1 py-1 rounded text-[9px] font-bold transition-colors ${filterSide === 'LONG' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-emerald-500'}`}>多</button>
                        <button onClick={() => setFilterSide('SHORT')} className={`flex-1 py-1 rounded text-[9px] font-bold transition-colors ${filterSide === 'SHORT' ? 'bg-red-600 text-white' : 'text-slate-500 hover:text-red-500'}`}>空</button>
                    </div>
                    
                    {/* PnL Filter */}
                    <div className="flex bg-slate-800 rounded p-0.5 border border-slate-700 flex-1">
                        <button onClick={() => setFilterPnL('ALL')} className={`flex-1 py-1 rounded text-[9px] font-bold transition-colors ${filterPnL === 'ALL' ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>全</button>
                        <button onClick={() => setFilterPnL('WIN')} className={`flex-1 py-1 rounded text-[9px] font-bold transition-colors ${filterPnL === 'WIN' ? 'bg-emerald-900/50 text-emerald-400 border border-emerald-500/30' : 'text-slate-500 hover:text-emerald-400'}`}>盈</button>
                        <button onClick={() => setFilterPnL('LOSS')} className={`flex-1 py-1 rounded text-[9px] font-bold transition-colors ${filterPnL === 'LOSS' ? 'bg-red-900/50 text-red-400 border border-red-500/30' : 'text-slate-500 hover:text-red-400'}`}>亏</button>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar bg-emerald-900/5">
                {filteredList.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center opacity-20 text-slate-500">
                        <Activity size={40} className="mb-2"/>
                        <span className="text-[10px] font-bold">无符合条件的持仓</span>
                    </div>
                )}
                {filteredList.map((pos) => (
                    <LivePositionRow 
                        key={`${pos.symbol}-${pos.side}`} 
                        position={pos} 
                        realPrice={realPrices[pos.symbol]}
                        setChartData={setChartData}
                        onClosePosition={onClosePosition}
                    />
                ))}
            </div>
        </div>
    );
};

export default List5_Live;
