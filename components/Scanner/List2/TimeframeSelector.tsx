
import React, { useRef } from 'react';
import { Clock, Loader2 } from 'lucide-react';

interface Props {
    timeframes: string[];
    countdowns: Record<string, string>;
    tfCounts: Record<string, number>;
    activeFilterTf: string | null;
    isLocked: boolean;
    onTfInteraction: (tf: string, type: 'SINGLE' | 'LONG_2' | 'LONG_3' | 'RESET') => void;
    activeScanTfs?: Set<string>;
    pollingStatus?: string;
}

export const TimeframeSelector: React.FC<Props> = ({ timeframes, countdowns, tfCounts, activeFilterTf, isLocked, onTfInteraction, activeScanTfs, pollingStatus }) => {
    const ALL_TFS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h'];
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pressStartTimeRef = useRef<number>(0);

    const handleMouseDown = (tf: string) => {
        const now = Date.now();
        pressStartTimeRef.current = now;
        timerRef.current = setTimeout(() => {
            const elapsed = Date.now() - pressStartTimeRef.current;
            if (elapsed >= 3000) {
                onTfInteraction(tf, 'LONG_3');
            } else if (elapsed >= 2000) {
                onTfInteraction(tf, 'LONG_2');
            }
        }, 3100); 
    };

    const handleMouseUp = (tf: string) => {
        if (timerRef.current) {
            const elapsed = Date.now() - pressStartTimeRef.current;
            clearTimeout(timerRef.current);
            if (elapsed < 500) {
                onTfInteraction(tf, 'SINGLE');
            } else if (elapsed >= 2000 && elapsed < 3000) {
                onTfInteraction(tf, 'LONG_2');
            } else if (elapsed >= 3000) {
                onTfInteraction(tf, 'LONG_3');
            }
        }
    };

    const handleDoubleClick = () => {
        onTfInteraction('', 'RESET');
    };

    return (
        <div>
            <div className="flex justify-between items-center mb-1.5">
                <div className="text-[9px] text-slate-500 flex gap-1 items-center"><Clock size={10}/> 扫描周期 (Timeframe)</div>
                {pollingStatus && (
                    <div className="text-[8px] text-slate-400 font-mono truncate max-w-[100px]" title={pollingStatus}>
                        {pollingStatus.replace('最后扫描: ', '')}
                    </div>
                )}
                <div className="flex gap-2">
                    {isLocked && <span className="text-[8px] text-cyan-400 animate-pulse font-bold border border-cyan-500/30 px-1 rounded">锁定</span>}
                    {activeFilterTf && !isLocked && <span className="text-[8px] text-amber-400 animate-pulse font-bold border border-amber-500/30 px-1 rounded">单选</span>}
                </div>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
                {ALL_TFS.map(tf => {
                    const isSelected = timeframes.includes(tf);
                    const count = tfCounts[tf] || 0;
                    const isActiveFilter = activeFilterTf === tf;
                    const isScanning = activeScanTfs?.has(tf);
                    
                    let extraStyle = "";
                    if (isActiveFilter) {
                        extraStyle = isLocked 
                            ? "ring-2 ring-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.8)] border-cyan-400" 
                            : "ring-1 ring-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.6)] border-amber-400";
                    } else if (isScanning) {
                        extraStyle = "border-orange-500 shadow-[0_0_5px_rgba(249,115,22,0.5)]";
                    }

                    // Scanning overrides default background slightly if not selected, but maintains shape
                    const baseClass = isSelected 
                        ? 'bg-indigo-600 border-indigo-500 text-white' 
                        : isScanning 
                            ? 'bg-slate-800 border-orange-500/50 text-orange-200'
                            : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300';

                    return (
                        <button 
                            key={tf} 
                            onMouseDown={() => handleMouseDown(tf)}
                            onMouseUp={() => handleMouseUp(tf)}
                            onDoubleClick={handleDoubleClick}
                            className={`text-[9px] border rounded py-1.5 font-bold transition-all flex items-center justify-center gap-1 min-h-[34px] relative select-none ${extraStyle} ${baseClass}`}
                        >
                            <div className="flex flex-col items-center leading-none">
                                <span className="uppercase">{tf}</span>
                                {isScanning ? (
                                    <Loader2 size={8} className="animate-spin text-orange-400 mt-0.5" />
                                ) : (
                                    <span className="font-mono text-[7px] opacity-70 scale-90 mt-0.5">{countdowns[tf] || '--:--'}</span>
                                )}
                            </div>
                            {isSelected && count > 0 && !isScanning && (
                                <div className="absolute top-0 right-0 -mt-1 -mr-1 bg-cyan-600 text-white text-[8px] rounded-full w-4 h-4 flex items-center justify-center font-bold shadow-sm z-10 border border-slate-900">
                                    {count}
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
