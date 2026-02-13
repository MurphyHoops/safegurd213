
import React from 'react';
import { Zap, Lock, Ban, Activity, AlertTriangle } from 'lucide-react';
import { ScannerItem } from '../scannerTypes';
import { PositionSide } from '../../../types';

interface Props {
    item: ScannerItem;
    executeTradeSafe: (symbol: string, side: PositionSide, price: number, reason: string, signalTf?: string) => void;
    setChartData: (data: any) => void;
}

export const List4Item: React.FC<Props> = ({ item, executeTradeSafe, setChartData }) => {
    // Robust defensive check: Ensure item and its nested objects exist
    if (!item) return null;

    const m = item.momentum || { 
        status: 'INVALID', 
        midPoint: 0, 
        entryTrigger: 0, 
        invalidReason: 'Data Loading...' 
    };
    
    const status = m.status || 'PENDING';
    const isInvalid = status === 'INVALID';
    const isPending = status === 'PENDING';
    const isTriggered = status === 'TRIGGERED';
    const isLong = item.direction === 'LONG';
    const tf = item.tf || '15m';

    // Calculate distance to trigger for display
    let diffToTrigger = 0;
    if (isPending && m.entryTrigger > 0 && item.price > 0) {
        if (isLong) {
            diffToTrigger = ((m.entryTrigger - item.price) / item.price) * 100;
        } else {
            diffToTrigger = ((item.price - m.entryTrigger) / item.price) * 100;
        }
    }

    const handleOpenChart = (e?: React.MouseEvent) => {
        if(e) {
            e.preventDefault();
            e.stopPropagation();
        }
        setChartData({ 
            symbol: item.symbol, 
            tf: tf, 
            signals: item.structure?.signalTime ? [{ time: item.structure.signalTime, type: item.direction as any }] : [],
            entryPrice: item.structure?.signalPrice,
            entryTime: item.structure?.signalTime,
            currentPrice: item.price,
            highlightTime: item.enterList4Time, // Pass Entry Time
            extraLines: [
                { price: m.entryTrigger, label: "TRIGGER (攻)", color: "#fbbf24", style: "dashed" },
                { price: m.midPoint, label: "DEFENSE (守)", color: "#f87171", style: "dashed" }
            ]
        });
    };

    return (
        <div className={`bg-slate-800/60 border rounded overflow-hidden animate-in fade-in transition-all ${item.fuseBlocked ? 'border-slate-700 opacity-60 grayscale-[0.8]' : isInvalid ? 'border-red-500/30' : isTriggered ? 'border-amber-500/60 shadow-[0_0_10px_rgba(245,158,11,0.2)]' : 'border-slate-600'}`}>
            {/* Header */}
            <div className={`p-2 flex justify-between items-center ${item.fuseBlocked ? 'bg-slate-800' : isInvalid ? 'bg-red-900/10' : isTriggered ? 'bg-amber-500/20' : 'bg-slate-900/50'}`}>
                <div 
                    className="flex flex-col cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={handleOpenChart}
                    title="点击查看 K 线图 (含触发线)"
                >
                    <span className="text-xs font-bold text-white">{item.symbol ? item.symbol.replace('USDT','') : 'UNKNOWN'}</span>
                    <span className="text-[8px] text-slate-500 font-bold uppercase flex items-center gap-1">现价: <span className="text-white">{item.price?.toFixed(4) || '0.0000'}</span></span>
                </div>
                {item.fuseBlocked 
                    ? <span className="text-[9px] bg-red-900/50 text-red-400 px-2 py-0.5 rounded font-bold border border-red-500/30">已熔断</span>
                    : (
                        <button 
                            onClick={handleOpenChart}
                            className={`relative overflow-hidden flex flex-col items-center justify-center border rounded cursor-pointer transition-all px-2 py-0.5 min-w-[36px] hover:scale-105 active:scale-95 ${isLong ? 'bg-emerald-900/30 border-emerald-500/30 hover:bg-emerald-800/50' : 'bg-red-900/30 border-red-500/30 hover:bg-red-800/50'}`}
                            title={`点击查看 ${tf} 周期 K 线`}
                        >
                            <div className="text-[9px] font-bold text-white leading-none">{tf}</div>
                            <div className={`text-[8px] font-bold leading-none mt-0.5 ${isLong ? 'text-emerald-400' : 'text-red-400'}`}>{isLong ? '↑' : '↓'}</div>
                        </button>
                    )
                }
            </div>

            <div className="p-2 space-y-2">
                {item.fuseBlocked ? (
                    <div className="bg-red-900/10 border border-red-500/20 p-2 rounded text-center">
                        <div className="text-red-400 font-bold text-[10px] flex items-center justify-center gap-1 mb-1">
                            <AlertTriangle size={12}/> 触发防追高熔断
                        </div>
                        <div className="text-[9px] text-slate-400">{item.fuseReason}</div>
                    </div>
                ) : (
                    <>
                        {/* Status Indicator */}
                        <div className={`flex items-center justify-center py-1 rounded border text-[10px] font-bold gap-1.5 ${
                            isInvalid ? 'bg-red-900/20 border-red-500/30 text-red-400' :
                            isPending ? 'bg-slate-800 border-slate-600 text-slate-400' :
                            'bg-amber-600 border-amber-500 text-white animate-pulse'
                        }`}>
                            {isInvalid && <Ban size={12} />}
                            {isPending && <Lock size={12} />}
                            {isTriggered && <Activity size={12} />}
                            <span>
                                {isInvalid ? '结构已破坏 (INVALID)' : 
                                isPending ? (
                                    <span className="flex items-center gap-1">
                                        等待突破 
                                        <span className="text-[9px] font-mono opacity-80">(距触发: {diffToTrigger.toFixed(2)}%)</span>
                                    </span>
                                ) : 
                                '已触发突破 (TRIGGERED)'}
                            </span>
                        </div>

                        {isInvalid && (
                            <div className="text-[9px] text-red-400 text-center leading-tight">
                                {m.invalidReason}
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-2 text-[9px]">
                            <div className={`p-1.5 rounded border ${isInvalid ? 'bg-red-900/10 border-red-500/20' : 'bg-slate-800 border-slate-700'}`}>
                                <span className="text-slate-500 block mb-0.5">中轴防守 (Backtrace)</span>
                                <span className={`font-mono font-bold ${isInvalid ? 'text-red-400' : 'text-emerald-400'}`}>{m.midPoint ? m.midPoint.toFixed(4) : '-'}</span>
                            </div>
                            <div className={`p-1.5 rounded border ${!isInvalid && !isTriggered ? 'bg-blue-900/10 border-blue-500/20' : 'bg-slate-800 border-slate-700'}`}>
                                <span className="text-slate-500 block mb-0.5">突破触发 (Trigger)</span>
                                <span className={`font-mono font-bold ${isTriggered ? 'text-amber-400' : 'text-slate-300'}`}>{m.entryTrigger ? m.entryTrigger.toFixed(4) : '-'}</span>
                            </div>
                        </div>

                        <button 
                            onClick={() => executeTradeSafe(item.symbol, item.direction as any, item.price, 'Manual L4', tf)} 
                            className={`w-full py-1.5 rounded text-xs font-bold shadow-lg transition-all flex items-center justify-center gap-1.5 ${
                                isTriggered 
                                ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/40 cursor-pointer' 
                                : isInvalid 
                                    ? 'bg-slate-800 text-slate-600 cursor-not-allowed opacity-50'
                                    : 'bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600'
                            }`}
                            disabled={isInvalid}
                        >
                            {isTriggered ? <Zap size={12} fill="currentColor"/> : <Lock size={12}/>}
                            {isTriggered ? '确认离弦信号：立即部署' : isInvalid ? '信号已失效' : '强制执行 (Manual Force)'}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};
