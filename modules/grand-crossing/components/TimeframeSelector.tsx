
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
    scanningSymbols?: Record<string, string>;
    pollingStatus?: string;
}

export const TimeframeSelector: React.FC<Props> = ({ timeframes, countdowns, tfCounts, activeFilterTf, isLocked, onTfInteraction, activeScanTfs, scanningSymbols, pollingStatus }) => {
    const ALL_TFS = ['5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
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
                    const scanningCoin = scanningSymbols?.[tf];
                    
                    let extraStyle = "";
                    if (isActiveFilter) {
                        extraStyle = isLocked 
                            ? "ring-2 ring-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.8)] border-cyan-400" 
                            : "ring-1 ring-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.6)] border-amber-400";
                    } else if (isScanning) {
                        extraStyle = "border-amber-500/80 shadow-[0_0_8px_rgba(245,158,11,0.5)]";
                    }

                    // Scanning overrides default background slightly if not selected, but maintains shape
                    const baseClass = isSelected 
                        ? 'bg-indigo-600 border-indigo-500 text-white' 
                        : isScanning 
                            ? 'bg-slate-800 border-amber-500/50 text-amber-200'
                            : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300';

                    return (
                        <button 
                            key={tf} 
                            onMouseDown={() => handleMouseDown(tf)}
                            onMouseUp={() => handleMouseUp(tf)}
                            onDoubleClick={handleDoubleClick}
                            title={`周期 ${tf} ${isScanning && scanningCoin ? `正在扫描: ${scanningCoin}USDT` : (scanningCoin ? `最近扫描: ${scanningCoin}` : `倒计时: ${countdowns[tf] || '--:--'}`)}`}
                            className={`text-[9px] border rounded py-1 px-0.5 font-bold transition-all flex items-center justify-center gap-0.5 min-h-[36px] relative select-none overflow-hidden ${extraStyle} ${baseClass}`}
                        >
                            <div className="flex flex-col items-center justify-center leading-none w-full">
                                <div className="flex items-center gap-0.5 justify-center">
                                    <span className="uppercase text-[9px]">{tf}</span>
                                    {isScanning && <Loader2 size={7} className="animate-spin text-amber-400 shrink-0" />}
                                </div>
                                {isScanning && scanningCoin ? (
                                    <span className="font-mono text-[7.5px] font-black text-amber-300 bg-amber-950/80 border border-amber-500/50 rounded px-1 py-[1px] mt-0.5 truncate max-w-full leading-none animate-pulse">
                                        {scanningCoin}
                                    </span>
                                ) : isScanning ? (
                                    <span className="font-mono text-[7px] text-amber-400/80 mt-0.5">扫描中</span>
                                ) : (
                                    <span className="font-mono text-[7px] opacity-70 scale-90 mt-0.5">{countdowns[tf] || '--:--'}</span>
                                )}
                            </div>
                            {count > 0 && (
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
