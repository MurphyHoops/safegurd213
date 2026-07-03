
import React, { useEffect } from 'react';
import { Shield, ShieldAlert, ShieldCheck, Hourglass, Zap, Trash2 } from 'lucide-react';
import { ScannerItem, List2Config } from '../../../components/Scanner/scannerTypes';
import { verifyAndFixSymbolPrice } from '../../../services/priceVerifier';

const getTfMinutes = (tf: string) => {
    const unit = tf.slice(-1);
    const val = parseInt(tf);
    if (unit === 'm') return val;
    if (unit === 'h') return val * 60;
    if (unit === 'd') return val * 1440;
    if (unit === 'w') return val * 10080;
    if (unit === 'M') return val * 43200;
    return 15; // default fallback
};

interface Props {
    item: ScannerItem;
    config: List2Config;
    activeFilterTf: string | null;
    setChartData: (data: any) => void;
    onRemove: () => void;
}

export const List2Item: React.FC<Props> = ({ item, config, activeFilterTf, setChartData, onRemove }) => {
    const defaultTf = activeFilterTf || item.groupedResults?.[0]?.tf || '15m';
    const isLong = item.direction === 'LONG';

    useEffect(() => {
        verifyAndFixSymbolPrice(item.symbol);
    }, [item.symbol]);

    const handleItemClick = () => {
        const signals: { time: number, type: 'LONG' | 'SHORT' }[] = [];
        item.groupedResults?.forEach(res => {
            if (res.tf === defaultTf && res.crossingTimes) {
                res.crossingTimes.forEach(t => {
                    signals.push({ time: t, type: res.direction || 'LONG' });
                });
            }
        });
        setChartData({ symbol: item.symbol, tf: defaultTf, signals, currentPrice: item.price, list2Config: config, showAuditLines: false });
    };

    return (
        <div onClick={handleItemClick} className={`bg-slate-800/50 p-2 rounded border text-[10px] cursor-pointer hover:bg-slate-800 transition-colors group ${isLong ? 'border-emerald-500/20 hover:border-emerald-500/40' : 'border-red-500/20 hover:border-red-500/40'}`}>
            <div className="flex justify-between font-bold text-slate-300 mb-1 border-b border-slate-700/50 pb-1">
                <span>{item.symbol.replace('USDT', '')}</span>
                <div className="flex items-center gap-2">
                    <span className="text-slate-500">{item.price.toFixed(8)}</span>
                </div>
            </div>
            <div className="flex justify-between items-center mb-1">
                <div className="flex items-center gap-1">
                    {isLong ? <span className="text-[9px] text-emerald-400 font-bold">T↑</span> : item.direction === 'SHORT' ? <span className="text-[9px] text-red-400 font-bold">T↓</span> : <span className="text-[9px] text-slate-500 font-bold">T-</span>}
                </div>
                <button 
                    onClick={(e) => {
                        e.stopPropagation();
                        onRemove();
                    }}
                    className="text-slate-500 hover:text-red-400 transition-all p-1 bg-red-900/10 rounded border border-red-500/10 hover:border-red-500/40"
                    title="从列表中移除"
                >
                    <Trash2 size={12} />
                </button>
            </div>
            <div className="flex flex-wrap gap-1">
                {item.groupedResults?.map((res, rIdx) => {
                    // Use crossingTimes to calculate real-time lag
                    const tfMinutes = getTfMinutes(res.tf || '15m');
                    const now = Date.now();
                    
                    let lag = 999;
                    if (res.crossingTimes && res.crossingTimes.length > 0) {
                        const mostRecentTime = Math.max(...res.crossingTimes);
                        lag = Math.floor((now - mostRecentTime) / (tfMinutes * 60 * 1000));
                    } else {
                        lag = res.lag ?? 999;
                    }

                    const max = config.newModeRetention || 9;
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
                            setChartData({ symbol: item.symbol, tf: res.tf, signals, currentPrice: item.price, list2Config: config, showAuditLines: false }); 
                        }} className={`relative overflow-hidden flex flex-col border rounded cursor-pointer transition-all min-w-[50px] ${containerClass} hover:border-indigo-400`}>
                            
                            {/* Top Label Row */}
                            <div className="flex items-center justify-between px-1.5 py-1 z-10 gap-2">
                                <div className="flex flex-col">
                                    <div className="flex items-center gap-1">
                                        <span className={`text-[9px] font-bold ${isFiltered ? 'text-amber-300' : 'text-indigo-300'}`}>{res.tf}</span>
                                        {res.isAligned && (
                                            <span className="text-[7px] bg-indigo-500/20 text-indigo-300 px-0.5 rounded border border-indigo-500/30 font-bold" title="EMA 发散已对齐">顺</span>
                                        )}
                                    </div>
                                    {res.bodyRatio !== undefined && (
                                        <span className={`text-[7px] font-mono ${res.bodyRatio < (config.minBodyRatio || 0) ? 'text-red-400' : 'text-emerald-400/80'}`}>
                                            B:{res.bodyRatio.toFixed(0)}%
                                        </span>
                                    )}
                                </div>
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
