
import React from 'react';
import { Shield, ShieldAlert, ShieldCheck, Hourglass, Zap } from 'lucide-react';
import { ScannerItem, List2Config } from '../scannerTypes';

interface Props {
    item: ScannerItem;
    config: List2Config;
    activeFilterTf: string | null;
    setChartData: (data: any) => void;
}

export const List2Item: React.FC<Props> = ({ item, config, activeFilterTf, setChartData }) => {
    const defaultTf = activeFilterTf || item.groupedResults?.[0]?.tf || '15m';
    const isLong = item.direction === 'LONG';

    const handleItemClick = () => {
        const signals: { time: number, type: 'LONG' | 'SHORT' }[] = [];
        item.groupedResults?.forEach(res => {
            if (res.tf === defaultTf && res.crossingTimes) {
                res.crossingTimes.forEach(t => {
                    signals.push({ time: t, type: res.direction || 'LONG' });
                });
            }
        });
        setChartData({ symbol: item.symbol, tf: defaultTf, signals, currentPrice: item.price });
    };

    return (
        <div onClick={handleItemClick} className={`bg-slate-800/50 p-2 rounded border text-[10px] cursor-pointer hover:bg-slate-800 transition-colors group ${isLong ? 'border-emerald-500/20 hover:border-emerald-500/40' : 'border-red-500/20 hover:border-red-500/40'}`}>
            <div className="flex justify-between font-bold text-slate-300 mb-1 border-b border-slate-700/50 pb-1"><span>{item.symbol.replace('USDT', '')}</span><span className="text-slate-500">{item.price.toFixed(8)}</span></div>
            <div className="flex justify-between items-center mb-1"><div className="flex items-center gap-1">{isLong ? <span className="text-[9px] text-emerald-400 font-bold">T↑</span> : item.direction === 'SHORT' ? <span className="text-[9px] text-red-400 font-bold">T↓</span> : <span className="text-[9px] text-slate-500 font-bold">T-</span>}</div></div>
            <div className="flex flex-wrap gap-1">
                {item.groupedResults?.map((res, rIdx) => {
                    // Use the most recent lag from the cluster for display purposes
                    const rawLag = res.crossingLags && res.crossingLags.length > 0 ? Math.min(...res.crossingLags) : (res.lag ?? 9);
                    const lag = isNaN(rawLag) ? 9 : rawLag;
                    const max = config.maxLag > 0 ? config.maxLag : 9;
                    const integrity = Math.max(5, 100 - (lag / max) * 100);
                    
                    let barColor = res.direction === 'LONG' ? 'bg-emerald-500' : 'bg-red-500';
                    let statusText = `Lag-${lag}`; 
                    let textColor = 'text-slate-400';
                    let Icon = Shield;
                    let containerClass = "border-slate-700 bg-slate-900/60";

                    if (lag <= 1) {
                        statusText = 'NEW';
                        textColor = 'text-white font-bold';
                        barColor = 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]'; 
                        Icon = Zap;
                        containerClass = "border-white/40 bg-indigo-900/40";
                    } else if (integrity <= 20) { 
                        barColor = 'bg-red-600 animate-pulse'; 
                        statusText = '即将失效'; 
                        textColor = 'text-red-400 font-bold'; 
                        Icon = ShieldAlert;
                        containerClass = "border-red-900/50 bg-red-900/10";
                    } else if (integrity < 50) { 
                        barColor = 'bg-amber-500'; 
                        statusText = `-${lag}`;
                        Icon = Hourglass;
                    } else {
                        Icon = ShieldCheck;
                    }

                    const isFiltered = activeFilterTf === res.tf;
                    if (isFiltered) containerClass = "border-amber-500/60 bg-amber-900/30";
                    
                    return (
                        <div key={`${res.tf}-${res.direction}-${rIdx}`} onClick={(e) => { 
                            e.stopPropagation(); 
                            const signals: { time: number, type: 'LONG' | 'SHORT' }[] = [];
                            item.groupedResults?.forEach(r => {
                                if (r.tf === res.tf && r.crossingTimes) {
                                    r.crossingTimes.forEach(t => signals.push({ time: t, type: r.direction || 'LONG' }));
                                }
                            });
                            setChartData({ symbol: item.symbol, tf: res.tf, signals, currentPrice: item.price }); 
                        }} className={`relative overflow-hidden flex flex-col border rounded cursor-pointer transition-all min-w-[50px] ${containerClass} hover:border-indigo-400`}>
                            
                            {/* Top Label Row */}
                            <div className="flex items-center justify-between px-1.5 py-1 z-10 gap-2">
                                <span className={`text-[9px] font-bold ${isFiltered ? 'text-amber-300' : 'text-indigo-300'}`}>{res.tf}</span>
                                <span className={`text-[8px] font-mono flex items-center gap-0.5 ${textColor}`}>
                                    <Icon size={8} />
                                    {statusText}
                                </span>
                            </div>

                            {/* Shield Integrity Bar (Bottom) */}
                            <div className="h-[2px] w-full bg-slate-800 relative mt-auto">
                                <div 
                                    className={`h-full ${barColor} transition-all duration-500 absolute left-0 top-0`} 
                                    style={{ width: `${integrity}%` }}
                                ></div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
