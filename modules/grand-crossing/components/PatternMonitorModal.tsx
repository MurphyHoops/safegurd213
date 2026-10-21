import React, { useState, useMemo } from 'react';
import { X, Zap, Activity, Clock, Search, ExternalLink, ShieldCheck, CheckCircle2, AlertTriangle, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { TimeframeDiagnosticRecord } from '../types';
import { ScannerItem } from '../../../components/Scanner/scannerTypes';
import { normalizeSymbol } from '../../../services/symbolUtils';

export interface PatternItemData {
    symbol: string;
    tf: string;
    direction: 'LONG' | 'SHORT';
    patternType: 'CROSSING' | 'DIVERGENCE' | 'RESONANCE';
    patternLabel: string;
    timestamp: number;
    timeText: string;
    barsAgo: number;
    price: number;
    inList2: boolean;
    statusNote: string;
    ema10?: number;
    ema20?: number;
    ema30?: number;
    ema40?: number;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    initialTab?: 'ALL' | 'CROSSING' | 'DIVERGENCE' | 'RESONANCE';
    diagnostics: Record<string, TimeframeDiagnosticRecord>;
    list2Items: ScannerItem[];
    totalScanCount: number;
    setChartData?: (data: any) => void;
}

export const PatternMonitorModal: React.FC<Props> = ({
    isOpen,
    onClose,
    initialTab = 'ALL',
    diagnostics,
    list2Items,
    totalScanCount,
    setChartData
}) => {
    const [activeTab, setActiveTab] = useState<'ALL' | 'CROSSING' | 'DIVERGENCE' | 'RESONANCE'>(initialTab);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedTf, setSelectedTf] = useState<string>('ALL');

    // Sync tab when initialTab changes on open
    React.useEffect(() => {
        if (isOpen) {
            setActiveTab(initialTab);
        }
    }, [isOpen, initialTab]);

    // Fast lookup for symbols currently present in List 2
    const list2Map = useMemo(() => {
        const map = new Map<string, { direction: 'LONG' | 'SHORT'; tf: string; lag?: number }>();
        (list2Items || []).forEach(item => {
            if (!item || !item.symbol) return;
            const norm = normalizeSymbol(item.symbol);
            if (item.groupedResults && item.groupedResults.length > 0) {
                item.groupedResults.forEach(r => {
                    map.set(`${norm}-${r.tf}`, { direction: r.direction, tf: r.tf, lag: r.lag });
                });
            } else if (item.tf && (item.direction === 'LONG' || item.direction === 'SHORT')) {
                map.set(`${norm}-${item.tf}`, { direction: item.direction, tf: item.tf, lag: item.structure?.lag });
            }
        });
        return map;
    }, [list2Items]);

    // Aggregate all Crossing and Divergence items across diagnostics
    const allPatterns = useMemo(() => {
        const list: PatternItemData[] = [];
        const seen = new Set<string>();

        Object.values(diagnostics || {}).forEach(rec => {
            if (!rec || !rec.symbol || !rec.tf) return;
            const norm = normalizeSymbol(rec.symbol);

            // 🎯 区分真实的穿越与发散（基于最新K线穿透或近期回溯窗口，绝不使用全量200根历史累计导致每个币都被误标为双重共振）
            const hasCrossing = rec.isCrossing === true || (rec.latestCrossingBarsAgo !== undefined && rec.latestCrossingBarsAgo <= 5);
            const hasDiv = (rec.divergenceState === 'BULLISH' || rec.divergenceState === 'BEARISH') || (rec.latestDivergenceBarsAgo !== undefined && rec.latestDivergenceBarsAgo <= 5);

            if (!hasCrossing && !hasDiv) return;

            // Determine pattern type
            let pType: 'CROSSING' | 'DIVERGENCE' | 'RESONANCE' = 'CROSSING';
            let pLabel = '均线穿越';

            if (hasCrossing && hasDiv) {
                pType = 'RESONANCE';
                pLabel = '双重共振 (穿+发)';
            } else if (hasDiv) {
                pType = 'DIVERGENCE';
                pLabel = '均线发散';
            } else {
                pType = 'CROSSING';
                pLabel = '均线穿越';
            }

            // Direction inference
            let dir: 'LONG' | 'SHORT' = 'LONG';
            if (rec.divergenceState === 'BEARISH') {
                dir = 'SHORT';
            } else if (rec.divergenceState === 'BULLISH') {
                dir = 'LONG';
            } else if (rec.passedDirection) {
                dir = rec.passedDirection;
            } else if (rec.kClose < rec.kOpen) {
                dir = 'SHORT';
            }

            // Check if present in List 2
            const l2Key = `${norm}-${rec.tf}`;
            const inL2 = list2Map.has(l2Key);

            // Time and lag
            const eventTime = Math.max(rec.latestCrossingTime || 0, rec.latestDivergenceTime || 0, rec.timestamp || Date.now());
            const barsAgo = Math.min(
                rec.latestCrossingBarsAgo !== undefined ? rec.latestCrossingBarsAgo : 999,
                rec.latestDivergenceBarsAgo !== undefined ? rec.latestDivergenceBarsAgo : 999,
                rec.passedLag !== undefined ? rec.passedLag : 0
            );

            const timeText = eventTime > 0 ? new Date(eventTime).toLocaleTimeString('zh-CN', { hour12: false }) : '--:--:--';

            const uniqueKey = `${norm}-${rec.tf}-${pType}`;
            if (!seen.has(uniqueKey)) {
                seen.add(uniqueKey);
                list.push({
                    symbol: rec.symbol,
                    tf: rec.tf,
                    direction: dir,
                    patternType: pType,
                    patternLabel: pLabel,
                    timestamp: eventTime,
                    timeText,
                    barsAgo: barsAgo === 999 ? 0 : barsAgo,
                    price: rec.latestPrice || rec.kClose || 0,
                    inList2: inL2,
                    statusNote: inL2 ? '✅ 已入驻列表2' : (rec.rejectionReason || '存续期评估中'),
                    ema10: rec.ema10,
                    ema20: rec.ema20,
                    ema30: rec.ema30,
                    ema40: rec.ema40
                });
            }
        });

        // Also ensure any existing List 2 items are accurately categorized
        (list2Items || []).forEach(item => {
            if (!item || !item.symbol) return;
            const norm = normalizeSymbol(item.symbol);
            (item.groupedResults || [{ tf: item.tf || '15m', direction: item.direction || 'LONG', lag: item.structure?.lag || 0 }]).forEach(r => {
                const hasCross = (r.crossingCount !== undefined && r.crossingCount > 0) || (r.crossingLags && r.crossingLags.length > 0);
                const hasAligned = r.isAligned === true;

                let l2pType: 'CROSSING' | 'DIVERGENCE' | 'RESONANCE' = 'RESONANCE';
                let l2pLabel = '列表2在榜(双重共振)';
                if (hasCross && !hasAligned) {
                    l2pType = 'CROSSING';
                    l2pLabel = '列表2在榜(穿越)';
                } else if (hasAligned && !hasCross) {
                    l2pType = 'DIVERGENCE';
                    l2pLabel = '列表2在榜(发散)';
                }

                const uniqueKey = `${norm}-${r.tf}-${l2pType}`;
                if (!seen.has(uniqueKey)) {
                    seen.add(uniqueKey);
                    list.push({
                        symbol: item.symbol,
                        tf: r.tf,
                        direction: r.direction,
                        patternType: l2pType,
                        patternLabel: l2pLabel,
                        timestamp: item.lastUpdated || Date.now(),
                        timeText: item.lastUpdated ? new Date(item.lastUpdated).toLocaleTimeString('zh-CN', { hour12: false }) : '--:--:--',
                        barsAgo: Math.floor(r.lag || 0),
                        price: Number(item.price) || 0,
                        inList2: true,
                        statusNote: '✅ 已入选列表2',
                    });
                }
            });
        });

        // Sort: newest timestamp first, then inList2 first
        return list.sort((a, b) => {
            if (a.inList2 !== b.inList2) return a.inList2 ? -1 : 1;
            return b.timestamp - a.timestamp;
        });
    }, [diagnostics, list2Map, list2Items]);

    // Counts
    const crossingCount = useMemo(() => allPatterns.filter(p => p.patternType === 'CROSSING' || p.patternType === 'RESONANCE').length, [allPatterns]);
    const divergenceCount = useMemo(() => allPatterns.filter(p => p.patternType === 'DIVERGENCE' || p.patternType === 'RESONANCE').length, [allPatterns]);
    const resonanceCount = useMemo(() => allPatterns.filter(p => p.patternType === 'RESONANCE').length, [allPatterns]);

    // Filtered by Tab, Search and Timeframe
    const filteredPatterns = useMemo(() => {
        return allPatterns.filter(item => {
            if (activeTab === 'CROSSING' && item.patternType !== 'CROSSING' && item.patternType !== 'RESONANCE') return false;
            if (activeTab === 'DIVERGENCE' && item.patternType !== 'DIVERGENCE' && item.patternType !== 'RESONANCE') return false;
            if (activeTab === 'RESONANCE' && item.patternType !== 'RESONANCE') return false;

            if (selectedTf !== 'ALL' && item.tf !== selectedTf) return false;

            if (searchTerm.trim()) {
                const q = searchTerm.trim().toUpperCase();
                return item.symbol.toUpperCase().includes(q);
            }
            return true;
        });
    }, [allPatterns, activeTab, selectedTf, searchTerm]);

    if (!isOpen) return null;

    const ALL_TFS = ['ALL', '1m', '3m', '5m', '10m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];

    return (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 animate-in fade-in duration-150">
            <div className="bg-slate-900 border border-slate-700/80 rounded-xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="px-4 py-3 bg-slate-950/90 border-b border-slate-800 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2.5">
                        <div className="p-1.5 bg-indigo-500/10 border border-indigo-500/30 rounded-lg text-indigo-400">
                            <Activity size={16} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-sm font-bold text-white tracking-wide">穿越 & 发散 形态实时监控清单</h2>
                                <span className="text-[9px] font-mono font-bold bg-amber-950/70 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-full flex items-center gap-1">
                                    <Zap size={9} className="animate-pulse text-amber-400" />
                                    <span>累计已巡检 {totalScanCount.toLocaleString()} 次</span>
                                </span>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                                中央多周期内存总线 0ms 高速运算 | 实时捕捉全部达标穿越与发散原点
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
                        title="关闭 (Esc)"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Filter Controls Bar */}
                <div className="p-3 bg-slate-900/90 border-b border-slate-800/80 space-y-2 shrink-0">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        {/* Tabs */}
                        <div className="flex items-center gap-1.5 bg-slate-950/80 p-1 rounded-lg border border-slate-800">
                            <button
                                onClick={() => setActiveTab('ALL')}
                                className={`text-[10px] font-bold px-2.5 py-1 rounded transition-all flex items-center gap-1 ${activeTab === 'ALL' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                            >
                                <span>全部</span>
                                <span className="opacity-80 text-[9px] font-mono">({allPatterns.length})</span>
                            </button>
                            <button
                                onClick={() => setActiveTab('CROSSING')}
                                className={`text-[10px] font-bold px-2.5 py-1 rounded transition-all flex items-center gap-1 ${activeTab === 'CROSSING' ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-400 hover:text-cyan-300'}`}
                            >
                                <span>⚡ 均线穿越</span>
                                <span className="text-[9px] font-mono font-black text-cyan-200">({crossingCount})</span>
                            </button>
                            <button
                                onClick={() => setActiveTab('DIVERGENCE')}
                                className={`text-[10px] font-bold px-2.5 py-1 rounded transition-all flex items-center gap-1 ${activeTab === 'DIVERGENCE' ? 'bg-purple-600 text-white shadow-sm' : 'text-slate-400 hover:text-purple-300'}`}
                            >
                                <span>🌟 均线发散</span>
                                <span className="text-[9px] font-mono font-black text-purple-200">({divergenceCount})</span>
                            </button>
                            <button
                                onClick={() => setActiveTab('RESONANCE')}
                                className={`text-[10px] font-bold px-2.5 py-1 rounded transition-all flex items-center gap-1 ${activeTab === 'RESONANCE' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-emerald-300'}`}
                            >
                                <span>🎯 双重共振</span>
                                <span className="text-[9px] font-mono font-black text-emerald-200">({resonanceCount})</span>
                            </button>
                        </div>

                        {/* Search Input */}
                        <div className="relative min-w-[160px] max-w-[220px]">
                            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="快速搜索币名 (如 BTC)..."
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-7 pr-2.5 py-1 text-[10px] text-white placeholder-slate-500 outline-none focus:border-indigo-500 transition-colors font-mono"
                            />
                        </div>
                    </div>

                    {/* Timeframe Chips */}
                    <div className="flex items-center gap-1 overflow-x-auto pb-0.5 custom-scrollbar">
                        <span className="text-[9px] text-slate-500 font-bold shrink-0 flex items-center gap-1 mr-1">
                            <Clock size={10} /> 周期筛选:
                        </span>
                        {ALL_TFS.map(tf => (
                            <button
                                key={tf}
                                onClick={() => setSelectedTf(tf)}
                                className={`text-[9px] px-2 py-0.5 rounded font-bold font-mono transition-colors shrink-0 ${selectedTf === tf ? 'bg-indigo-600 text-white border border-indigo-400' : 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-slate-200'}`}
                            >
                                {tf === 'ALL' ? '全部周期' : tf.toUpperCase()}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Table Content */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
                    {filteredPatterns.length === 0 ? (
                        <div className="py-16 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
                            <ShieldCheck size={32} className="text-slate-600 animate-pulse" />
                            <p className="text-xs font-bold text-slate-400">当前没有符合该筛选条件的形态记录</p>
                            <p className="text-[10px] text-slate-600">后台多周期内存总线正以毫秒级持续巡检，达标币种将即时自动呈现</p>
                        </div>
                    ) : (
                        <div className="border border-slate-800 rounded-lg overflow-hidden shadow-sm">
                            <table className="w-full text-left border-collapse text-[11px]">
                                <thead>
                                    <tr className="bg-slate-950/80 text-[10px] text-slate-400 font-bold border-b border-slate-800">
                                        <th className="py-2 px-3">币种代码</th>
                                        <th className="py-2 px-2 text-center">周期</th>
                                        <th className="py-2 px-2 text-center">方向</th>
                                        <th className="py-2 px-3">形态类型</th>
                                        <th className="py-2 px-3">发生时间 / 滞后</th>
                                        <th className="py-2 px-3 text-right">最新价格</th>
                                        <th className="py-2 px-3">列表2状态</th>
                                        <th className="py-2 px-2 text-center">操作</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/60 font-mono">
                                    {filteredPatterns.map((item, idx) => {
                                        const cleanSym = item.symbol.replace(/USDT$/i, '');
                                        const isLong = item.direction === 'LONG';

                                        return (
                                            <tr key={`${item.symbol}-${item.tf}-${idx}`} className="hover:bg-slate-800/40 transition-colors group">
                                                <td className="py-2 px-3">
                                                    <div className="flex items-center gap-1.5 font-bold text-slate-200">
                                                        <span className="text-white group-hover:text-indigo-300 transition-colors">{cleanSym}</span>
                                                        <span className="text-[9px] text-slate-500 font-normal">USDT</span>
                                                    </div>
                                                </td>

                                                <td className="py-2 px-2 text-center">
                                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-800 border border-slate-700 text-slate-300">
                                                        {item.tf.toUpperCase()}
                                                    </span>
                                                </td>

                                                <td className="py-2 px-2 text-center">
                                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold inline-flex items-center gap-0.5 ${isLong ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/40' : 'bg-rose-950/80 text-rose-300 border border-rose-500/40'}`}>
                                                        {isLong ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                                                        <span>{isLong ? '做多' : '做空'}</span>
                                                    </span>
                                                </td>

                                                <td className="py-2 px-3">
                                                    <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                                                        item.patternType === 'RESONANCE'
                                                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/50'
                                                            : item.patternType === 'CROSSING'
                                                                ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/40'
                                                                : 'bg-purple-950 text-purple-300 border border-purple-500/40'
                                                    }`}>
                                                        {item.patternLabel}
                                                    </span>
                                                </td>

                                                <td className="py-2 px-3">
                                                    <div className="flex flex-col text-[10px]">
                                                        <span className="text-slate-300 font-bold">{item.timeText}</span>
                                                        <span className="text-[8.5px] text-slate-500">
                                                            {item.barsAgo === 0 ? '当根 K 线' : `滞后 ${item.barsAgo} 根`}
                                                        </span>
                                                    </div>
                                                </td>

                                                <td className="py-2 px-3 text-right font-bold text-slate-200">
                                                    {item.price > 0 ? (item.price > 1 ? item.price.toFixed(4) : item.price.toFixed(6)) : '--'}
                                                </td>

                                                <td className="py-2 px-3">
                                                    <div className="flex items-center gap-1 text-[10px]">
                                                        {item.inList2 ? (
                                                            <span className="text-emerald-400 font-bold flex items-center gap-1">
                                                                <CheckCircle2 size={11} /> 在榜展示中
                                                            </span>
                                                        ) : (
                                                            <span className="text-amber-400/90 text-[9px] truncate max-w-[150px]" title={item.statusNote}>
                                                                {item.statusNote}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>

                                                <td className="py-2 px-2 text-center">
                                                    <button
                                                        onClick={() => {
                                                            if (setChartData) {
                                                                setChartData({
                                                                    symbol: item.symbol,
                                                                    tf: item.tf
                                                                });
                                                            }
                                                            onClose();
                                                        }}
                                                        className="px-2 py-0.5 rounded bg-indigo-600/30 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/40 text-[9px] font-bold transition-all flex items-center gap-1 mx-auto"
                                                        title="切换至此币种K线图"
                                                    >
                                                        <ExternalLink size={9} />
                                                        <span>看盘</span>
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-4 py-2.5 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-500 shrink-0">
                    <div className="flex items-center gap-3">
                        <span>显示数量: <strong className="text-slate-300 font-mono">{filteredPatterns.length}</strong> / {allPatterns.length}</span>
                        <span>•</span>
                        <span>列表2在榜: <strong className="text-emerald-400 font-mono">{allPatterns.filter(p => p.inList2).length}</strong> 个</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-bold transition-colors"
                    >
                        关闭
                    </button>
                </div>
            </div>
        </div>
    );
};
