
import React, { useRef, useState, useMemo } from 'react';
import { Clock, Loader2, Zap } from 'lucide-react';
import { PatternMonitorModal } from './PatternMonitorModal';
import { TimeframeDiagnosticRecord } from '../types';
import { ScannerItem } from '../../../components/Scanner/scannerTypes';

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
    totalScanCount?: number;
    diagnostics?: Record<string, TimeframeDiagnosticRecord>;
    list2Items?: ScannerItem[];
    setChartData?: (data: any) => void;
    config?: any;
}

export const TimeframeSelector: React.FC<Props> = ({ 
    timeframes, countdowns, tfCounts, activeFilterTf, isLocked, onTfInteraction, 
    activeScanTfs, scanningSymbols, pollingStatus, totalScanCount = 0, diagnostics = {}, list2Items = [], setChartData,
    config
}) => {
    const ALL_TFS = ['1m', '3m', '5m', '10m', '15m', '30m', '1h', '2h', '4h', '8h', '1d', '3d'];
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pressStartTimeRef = useRef<number>(0);

    const [showPatternModal, setShowPatternModal] = useState(false);
    const [patternModalTab, setPatternModalTab] = useState<'ALL' | 'CROSSING' | 'DIVERGENCE'>('ALL');

    // Aggregate counts of crossed and diverged symbols across all scanned records
    const { crossingCount, divergenceCount } = useMemo(() => {
        let cross = 0;
        let div = 0;
        const seenCross = new Set<string>();
        const seenDiv = new Set<string>();
        const maxLookback = Number(config?.lookbackBars) || 5;

        Object.values(diagnostics || {}).forEach(rec => {
            if (!rec || !rec.symbol || !rec.tf) return;
            const norm = (rec.symbol || '').replace(/USDT$/i, '');
            const key = `${norm}-${rec.tf}`;

            // 🎯 真实穿越判定：最新实时K线发生物理穿透 (isCrossing)，或在近期回溯窗口 (<= lookbackBars) 内发生过穿越
            const hasCrossing = rec.isCrossing === true || (rec.latestCrossingBarsAgo !== undefined && rec.latestCrossingBarsAgo <= maxLookback);
            
            // 🎯 真实发散判定：当前均线呈多头或空头发散形态 (divergenceState !== 'NONE')，或在近期回溯窗口 (<= lookbackBars) 内处于发散形态
            const hasDiv = (rec.divergenceState === 'BULLISH' || rec.divergenceState === 'BEARISH') || (rec.latestDivergenceBarsAgo !== undefined && rec.latestDivergenceBarsAgo <= maxLookback);

            if (hasCrossing && !seenCross.has(key)) {
                seenCross.add(key);
                cross++;
            }
            if (hasDiv && !seenDiv.has(key)) {
                seenDiv.add(key);
                div++;
            }
        });

        // 结合 List2 中已有真实入榜信号
        (list2Items || []).forEach(item => {
            if (!item || !item.symbol) return;
            const norm = (item.symbol || '').replace(/USDT$/i, '');
            (item.groupedResults || []).forEach(r => {
                const key = `${norm}-${r.tf}`;
                const hasCross = (r.crossingCount !== undefined && r.crossingCount > 0) || (r.crossingLags && r.crossingLags.length > 0);
                const hasAligned = r.isAligned === true;

                if (hasCross && !seenCross.has(key)) {
                    seenCross.add(key);
                    cross++;
                }
                if (hasAligned && !seenDiv.has(key)) {
                    seenDiv.add(key);
                    div++;
                }
            });
        });

        return { crossingCount: cross, divergenceCount: div };
    }, [diagnostics, list2Items, config?.lookbackBars]);

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
            <div className="flex justify-between items-center mb-1.5 flex-wrap gap-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                    <div className="text-[9px] text-slate-400 flex gap-1 items-center font-bold">
                        <Clock size={10} className="text-slate-400" />
                        <span>扫描周期</span>
                    </div>

                    {/* 累计跳动扫描计数器 */}
                    <button
                        type="button"
                        onClick={() => {
                            setPatternModalTab('ALL');
                            setShowPatternModal(true);
                        }}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800/90 hover:bg-slate-700 border border-slate-700/80 hover:border-slate-600 text-slate-300 text-[8.5px] font-mono transition-all cursor-pointer group shadow-xs select-none"
                        title="点击查看所有被扫描及发现形态的币种明细清单"
                    >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping shrink-0" />
                        <span className="text-slate-400 font-sans text-[8px]">已扫:</span>
                        <span className="text-emerald-400 font-black text-[9px] group-hover:scale-110 transition-transform">
                            {totalScanCount > 0 ? totalScanCount : 0}
                        </span>
                        <span className="text-[7.5px] text-slate-500 font-sans">个</span>
                    </button>

                    {/* 符合穿越数量按钮 */}
                    <button
                        type="button"
                        onClick={() => {
                            setPatternModalTab('CROSSING');
                            setShowPatternModal(true);
                        }}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[8.5px] font-bold transition-all cursor-pointer select-none ${
                            crossingCount > 0
                                ? 'bg-cyan-950/70 border-cyan-500/50 text-cyan-300 hover:bg-cyan-900/80 hover:border-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.25)]'
                                : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200'
                        }`}
                        title="点击查看所有符合“均线穿越”的币名、周期与发生时间明细"
                    >
                        <span className="w-1 h-1 rounded-full bg-cyan-400 shrink-0" />
                        <span className="text-[8px]">穿越:</span>
                        <span className="font-mono font-black text-[9px]">{crossingCount}</span>
                    </button>

                    {/* 符合发散数量按钮 */}
                    <button
                        type="button"
                        onClick={() => {
                            setPatternModalTab('DIVERGENCE');
                            setShowPatternModal(true);
                        }}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[8.5px] font-bold transition-all cursor-pointer select-none ${
                            divergenceCount > 0
                                ? 'bg-purple-950/70 border-purple-500/50 text-purple-300 hover:bg-purple-900/80 hover:border-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.25)]'
                                : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200'
                        }`}
                        title="点击查看所有符合“均线发散”的币名、周期与发生时间明细"
                    >
                        <span className="w-1 h-1 rounded-full bg-purple-400 shrink-0" />
                        <span className="text-[8px]">发散:</span>
                        <span className="font-mono font-black text-[9px]">{divergenceCount}</span>
                    </button>
                </div>

                <div className="flex items-center gap-1.5">
                    {pollingStatus && (
                        <div className="text-[8px] text-slate-400 font-mono truncate max-w-[80px]" title={pollingStatus}>
                            {pollingStatus.replace('最后扫描: ', '')}
                        </div>
                    )}
                    <div className="flex gap-1">
                        {isLocked && <span className="text-[8px] text-cyan-400 animate-pulse font-bold border border-cyan-500/30 px-1 rounded">锁定</span>}
                        {activeFilterTf && !isLocked && <span className="text-[8px] text-amber-400 animate-pulse font-bold border border-amber-500/30 px-1 rounded">单选</span>}
                    </div>
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

            {/* 穿越 & 发散 形态明细实时弹窗 */}
            <PatternMonitorModal
                isOpen={showPatternModal}
                onClose={() => setShowPatternModal(false)}
                initialTab={patternModalTab}
                diagnostics={diagnostics || {}}
                list2Items={list2Items || []}
                totalScanCount={totalScanCount || 0}
                setChartData={setChartData}
            />
        </div>
    );
};
