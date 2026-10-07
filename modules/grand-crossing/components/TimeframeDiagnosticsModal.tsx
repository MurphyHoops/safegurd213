import React, { useState, useMemo } from 'react';
import { 
    X, Search, Activity, CheckCircle2, XCircle, AlertTriangle, RefreshCw, 
    TrendingUp, TrendingDown, Layers, Zap, Clock, Maximize2, Minimize2, ExternalLink,
    Shield, Sparkles, ArrowUpRight, ArrowDownRight, Compass, Filter
} from 'lucide-react';
import { TimeframeDiagnosticRecord } from '../types';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    diagnostics: Record<string, TimeframeDiagnosticRecord>;
    activeTimeframes: string[];
    countdowns: Record<string, string>;
    scanningSymbols?: Record<string, string>;
    onSelectSymbol?: (symbol: string, tf?: string) => void;
}

const ALL_TFS = ['1m', '3m', '5m', '10m', '15m', '30m', '1h', '2h', '4h', '8h', '1d', '3d'];

// High-precision 8-decimal formatter for prices and EMA calculations
const formatPrecise8 = (val: number | undefined | null): string => {
    if (val === undefined || val === null || isNaN(val)) return '--';
    if (val === 0) return '0.00000000';
    const num = Number(val);
    const abs = Math.abs(num);
    if (abs < 1) {
        return num.toFixed(8);
    } else if (abs < 100) {
        return num.toFixed(6);
    } else {
        return num.toFixed(4);
    }
};

// Format timestamp to MM-DD HH:mm for pattern timeline
const formatDateTime = (ts?: number): string => {
    if (!ts) return '--:--';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '--:--';
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${m}-${day} ${h}:${min}`;
};

export const TimeframeDiagnosticsModal: React.FC<Props> = ({
    isOpen,
    onClose,
    diagnostics,
    activeTimeframes,
    countdowns,
    scanningSymbols,
    onSelectSymbol,
}) => {
    const [selectedTf, setSelectedTf] = useState<string>('5m');
    const [searchQuery, setSearchQuery] = useState('');
    const [filterCategory, setFilterCategory] = useState<'ALL' | 'PASSED' | 'CROSSING' | 'BULLISH' | 'BEARISH' | 'HIST_CROSSING' | 'HIST_DIVERGENCE' | 'RECENT_3K' | 'WAITING' | 'REJECTED' | 'ERROR'>('ALL');
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [expandedHistorySymbol, setExpandedHistorySymbol] = useState<string | null>(null);

    const records = useMemo(() => {
        return Object.values(diagnostics || {});
    }, [diagnostics]);

    // Enhanced calculation helpers for each record
    const enrichedRecords = useMemo(() => {
        return records.map(r => {
            const e10 = r.ema10 || 0;
            const e20 = r.ema20 || 0;
            const e30 = r.ema30 || 0;
            const e40 = r.ema40 || 0;
            const e80 = r.ema80 || 0;
            const high = r.kHigh || 0;
            const low = r.kLow || 0;
            const open = r.kOpen || 0;
            const close = r.kClose || 0;

            const validEmas = [e10, e20, e30, e40].filter(v => v > 0);
            const maxEma = validEmas.length > 0 ? Math.max(...validEmas) : 0;
            const minEma = validEmas.length > 0 ? Math.min(...validEmas) : 0;

            const isHighAboveMax = maxEma > 0 && high >= maxEma;
            const isLowBelowMin = minEma > 0 && low <= minEma;
            const isFullyCrossed = isHighAboveMax && isLowBelowMin;

            const highOverMaxPct = maxEma > 0 ? ((high - maxEma) / maxEma) * 100 : 0;
            const lowBelowMinPct = minEma > 0 ? ((minEma - low) / minEma) * 100 : 0;

            const isBullishDiv = e10 > 0 && e20 > 0 && e30 > 0 && e40 > 0 && (e10 > e20 && e20 > e30 && e30 > e40);
            const isBearishDiv = e10 > 0 && e20 > 0 && e30 > 0 && e40 > 0 && (e10 < e20 && e20 < e30 && e30 < e40);
            const isWaiting = r.rejectionReason?.includes('等待') || r.rejectionReason?.includes('确认') || r.rejectionReason?.includes('休眠');

            const candleType = close > open ? 'BULLISH' : close < open ? 'BEARISH' : 'DOJI';
            const divergenceSpread = (e40 > 0 && e10 > 0) ? ((e10 - e40) / e40) * 100 : 0;

            // EMA80 Macro Alignment
            let isEma80Aligned = false;
            if (isBullishDiv && e80 > 0) {
                isEma80Aligned = e40 > e80;
            } else if (isBearishDiv && e80 > 0) {
                isEma80Aligned = e40 < e80;
            }

            return {
                ...r,
                maxEma,
                minEma,
                isHighAboveMax,
                isLowBelowMin,
                isFullyCrossed,
                highOverMaxPct,
                lowBelowMinPct,
                isBullishDiv,
                isBearishDiv,
                isWaiting,
                candleType,
                divergenceSpread,
                isEma80Aligned
            };
        });
    }, [records]);

    // Current timeframe scope records for dynamic counters
    const currentScopeRecords = useMemo(() => {
        return selectedTf === 'ALL' 
            ? enrichedRecords 
            : enrichedRecords.filter(r => r.tf === selectedTf);
    }, [enrichedRecords, selectedTf]);

    // Summary counters scoped to current timeframe selection
    const totalCount = currentScopeRecords.length;
    const passedCount = currentScopeRecords.filter(r => r.isPassed).length;
    const crossingCount = currentScopeRecords.filter(r => r.isFullyCrossed || r.isCrossing).length;
    const bullishCount = currentScopeRecords.filter(r => r.isBullishDiv || r.divergenceState === 'BULLISH').length;
    const bearishCount = currentScopeRecords.filter(r => r.isBearishDiv || r.divergenceState === 'BEARISH').length;
    const histCrossingCount = currentScopeRecords.filter(r => (r.crossingCount || 0) > 0).length;
    const histDivCount = currentScopeRecords.filter(r => (r.divergenceCount || 0) > 0).length;
    const recent3kCount = currentScopeRecords.filter(r => 
        (r.latestCrossingBarsAgo !== undefined && r.latestCrossingBarsAgo <= 3) || 
        (r.latestDivergenceBarsAgo !== undefined && r.latestDivergenceBarsAgo <= 3)
    ).length;
    const waitingCount = currentScopeRecords.filter(r => r.isWaiting).length;
    const errorCount = currentScopeRecords.filter(r => r.fetchStatus !== 'SUCCESS').length;

    // Filter by timeframe and category
    const tfRecords = useMemo(() => {
        let list = currentScopeRecords;

        // Search query
        if (searchQuery.trim()) {
            const query = searchQuery.trim().toUpperCase();
            list = list.filter(r => r.symbol.toUpperCase().includes(query));
        }

        // Filter category
        if (filterCategory === 'PASSED') {
            list = list.filter(r => r.isPassed);
        } else if (filterCategory === 'CROSSING') {
            list = list.filter(r => r.isFullyCrossed || r.isCrossing);
        } else if (filterCategory === 'BULLISH') {
            list = list.filter(r => r.isBullishDiv || r.divergenceState === 'BULLISH');
        } else if (filterCategory === 'BEARISH') {
            list = list.filter(r => r.isBearishDiv || r.divergenceState === 'BEARISH');
        } else if (filterCategory === 'HIST_CROSSING') {
            list = list.filter(r => (r.crossingCount || 0) > 0);
        } else if (filterCategory === 'HIST_DIVERGENCE') {
            list = list.filter(r => (r.divergenceCount || 0) > 0);
        } else if (filterCategory === 'RECENT_3K') {
            list = list.filter(r => 
                (r.latestCrossingBarsAgo !== undefined && r.latestCrossingBarsAgo <= 3) || 
                (r.latestDivergenceBarsAgo !== undefined && r.latestDivergenceBarsAgo <= 3)
            );
        } else if (filterCategory === 'WAITING') {
            list = list.filter(r => r.isWaiting);
        } else if (filterCategory === 'REJECTED') {
            list = list.filter(r => !r.isPassed && r.fetchStatus === 'SUCCESS');
        } else if (filterCategory === 'ERROR') {
            list = list.filter(r => r.fetchStatus !== 'SUCCESS');
        }

        // Sort: Passed first, then newest scanned
        return list.sort((a, b) => {
            if (a.isPassed && !b.isPassed) return -1;
            if (!a.isPassed && b.isPassed) return 1;
            if (a.isFullyCrossed && !b.isFullyCrossed) return -1;
            if (!a.isFullyCrossed && b.isFullyCrossed) return 1;
            return b.timestamp - a.timestamp;
        });
    }, [currentScopeRecords, searchQuery, filterCategory]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4">
            <div className={`flex flex-col bg-slate-900 border border-indigo-500/40 rounded-xl shadow-2xl overflow-hidden transition-all duration-200 ${
                isFullScreen ? 'w-full h-full' : 'w-full max-w-6xl max-h-[94vh] h-[880px]'
            }`}>
                
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 bg-slate-950 border-b border-slate-800 shrink-0">
                    <div className="flex items-center gap-2.5">
                        <div className="p-1.5 bg-indigo-950/80 border border-indigo-500/40 rounded-lg text-indigo-400">
                            <Activity size={18} className="animate-pulse" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-sm sm:text-base font-bold text-slate-100 tracking-wide flex items-center gap-1.5">
                                    列表2 · 多周期K线数据与形态透视看板
                                    <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.2 rounded font-mono font-bold">
                                        穿越/发散双轨透视版
                                    </span>
                                </h2>
                                <span className="text-[10px] bg-indigo-900/60 border border-indigo-500/30 text-indigo-300 px-2 py-0.5 rounded-full font-mono">
                                    实时毫秒监控
                                </span>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                                实时透视各周期 K 线同时穿越 EMA10/20/30/40 空间穿透率、均线顺序发散过程及拦截全量诊断
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setIsFullScreen(!isFullScreen)}
                            className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition-colors"
                            title={isFullScreen ? "退出全屏" : "全屏放大"}
                        >
                            {isFullScreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1.5 hover:bg-red-900/40 text-slate-400 hover:text-red-400 rounded transition-colors"
                            title="关闭看板"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Status Summary Bar - Clickable Category Filters */}
                <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-1.5 p-2 bg-slate-950/80 border-b border-slate-800/80 text-xs shrink-0 select-none">
                    {/* 1. 全部已扫条数 */}
                    <button
                        type="button"
                        onClick={() => setFilterCategory('ALL')}
                        className={`flex items-center justify-between px-2 py-1.5 rounded border transition-all cursor-pointer text-left ${
                            filterCategory === 'ALL'
                                ? 'bg-slate-800 border-indigo-400 ring-2 ring-indigo-500/50 shadow-md scale-[1.02]'
                                : 'bg-slate-900/90 border-slate-800 hover:bg-slate-850 hover:border-slate-700'
                        }`}
                        title="点击展示全部已扫描币种"
                    >
                        <span className={`text-[10px] font-bold ${filterCategory === 'ALL' ? 'text-white' : 'text-slate-400'}`}>已扫总条数</span>
                        <span className="font-bold text-slate-200 font-mono text-[11px]">{totalCount}</span>
                    </button>

                    {/* 2. 已入榜 */}
                    <button
                        type="button"
                        onClick={() => setFilterCategory('PASSED')}
                        className={`flex items-center justify-between px-2 py-1.5 rounded border transition-all cursor-pointer text-left ${
                            filterCategory === 'PASSED'
                                ? 'bg-emerald-950/90 border-emerald-400 ring-2 ring-emerald-500/60 shadow-[0_0_12px_rgba(16,185,129,0.3)] scale-[1.02]'
                                : 'bg-emerald-950/40 border-emerald-500/40 hover:bg-emerald-900/40 hover:border-emerald-500/70'
                        }`}
                        title="点击直接筛选显示：✅ 已入榜列表2的币种"
                    >
                        <span className="text-emerald-400 text-[10px] font-bold flex items-center gap-1">
                            <CheckCircle2 size={11} className="text-emerald-400" />
                            已入榜
                        </span>
                        <span className="font-bold text-emerald-300 font-mono text-[11px]">{passedCount}</span>
                    </button>

                    {/* 3. 四线穿越 */}
                    <button
                        type="button"
                        onClick={() => setFilterCategory('CROSSING')}
                        className={`flex items-center justify-between px-2 py-1.5 rounded border transition-all cursor-pointer text-left ${
                            filterCategory === 'CROSSING'
                                ? 'bg-amber-950/90 border-amber-400 ring-2 ring-amber-500/60 shadow-[0_0_12px_rgba(245,158,11,0.3)] scale-[1.02]'
                                : 'bg-amber-950/40 border-amber-500/40 hover:bg-amber-900/40 hover:border-amber-500/70'
                        }`}
                        title="点击直接筛选显示：⚡ 当前最新K线同时穿越并物理打穿EMA10/20/30/40的币种"
                    >
                        <span className="text-amber-300 text-[10px] font-bold flex items-center gap-1">
                            <Zap size={11} className="text-amber-400" />
                            当前K穿越
                        </span>
                        <span className="font-bold text-amber-200 font-mono text-[11px]">{crossingCount}</span>
                    </button>

                    {/* 4. 多头发散 */}
                    <button
                        type="button"
                        onClick={() => setFilterCategory('BULLISH')}
                        className={`flex items-center justify-between px-2 py-1.5 rounded border transition-all cursor-pointer text-left ${
                            filterCategory === 'BULLISH'
                                ? 'bg-indigo-950/90 border-indigo-400 ring-2 ring-indigo-500/60 shadow-[0_0_12px_rgba(99,102,241,0.3)] scale-[1.02]'
                                : 'bg-indigo-950/40 border-indigo-500/40 hover:bg-indigo-900/40 hover:border-indigo-500/70'
                        }`}
                        title="点击直接筛选显示：🟢 当前处于多头顺序发散 (EMA10>20>30>40) 的币种"
                    >
                        <span className="text-indigo-300 text-[10px] font-bold flex items-center gap-1">
                            <TrendingUp size={11} className="text-indigo-400" />
                            当前K多头
                        </span>
                        <span className="font-bold text-indigo-200 font-mono text-[11px]">{bullishCount}</span>
                    </button>

                    {/* 5. 空头发散 */}
                    <button
                        type="button"
                        onClick={() => setFilterCategory('BEARISH')}
                        className={`flex items-center justify-between px-2 py-1.5 rounded border transition-all cursor-pointer text-left ${
                            filterCategory === 'BEARISH'
                                ? 'bg-rose-950/90 border-rose-400 ring-2 ring-rose-500/60 shadow-[0_0_12px_rgba(244,63,94,0.3)] scale-[1.02]'
                                : 'bg-rose-950/40 border-rose-500/40 hover:bg-rose-900/40 hover:border-rose-500/70'
                        }`}
                        title="点击直接筛选显示：🔴 当前处于空头顺序发散 (EMA10<20<30<40) 的币种"
                    >
                        <span className="text-rose-300 text-[10px] font-bold flex items-center gap-1">
                            <TrendingDown size={11} className="text-rose-400" />
                            当前K空头
                        </span>
                        <span className="font-bold text-rose-200 font-mono text-[11px]">{bearishCount}</span>
                    </button>

                    {/* 6. ⚡ 200K有穿越 */}
                    <button
                        type="button"
                        onClick={() => setFilterCategory('HIST_CROSSING')}
                        className={`flex items-center justify-between px-2 py-1.5 rounded border transition-all cursor-pointer text-left ${
                            filterCategory === 'HIST_CROSSING'
                                ? 'bg-amber-950/90 border-amber-400 ring-2 ring-amber-500/60 shadow-[0_0_12px_rgba(245,158,11,0.3)] scale-[1.02]'
                                : 'bg-slate-900/90 border-slate-800 hover:bg-amber-950/30 hover:border-amber-500/50'
                        }`}
                        title="点击直接筛选显示：⚡ 过去200根K线内曾出现过穿越形态的币种"
                    >
                        <span className="text-amber-300 text-[10px] font-bold flex items-center gap-1">
                            <Zap size={11} className="text-amber-400" />
                            200K有穿越
                        </span>
                        <span className="font-bold text-amber-200 font-mono text-[11px]">{histCrossingCount}</span>
                    </button>

                    {/* 7. 🌊 200K有发散 */}
                    <button
                        type="button"
                        onClick={() => setFilterCategory('HIST_DIVERGENCE')}
                        className={`flex items-center justify-between px-2 py-1.5 rounded border transition-all cursor-pointer text-left ${
                            filterCategory === 'HIST_DIVERGENCE'
                                ? 'bg-indigo-950/90 border-indigo-400 ring-2 ring-indigo-500/60 shadow-[0_0_12px_rgba(99,102,241,0.3)] scale-[1.02]'
                                : 'bg-slate-900/90 border-slate-800 hover:bg-indigo-950/30 hover:border-indigo-500/50'
                        }`}
                        title="点击直接筛选显示：🌊 过去200根K线内曾出现过多头或空头发散的币种"
                    >
                        <span className="text-indigo-300 text-[10px] font-bold flex items-center gap-1">
                            <TrendingUp size={11} className="text-indigo-400" />
                            200K有发散
                        </span>
                        <span className="font-bold text-indigo-200 font-mono text-[11px]">{histDivCount}</span>
                    </button>

                    {/* 8. ⏱️ 近期(≤3K)形态 */}
                    <button
                        type="button"
                        onClick={() => setFilterCategory('RECENT_3K')}
                        className={`flex items-center justify-between px-2 py-1.5 rounded border transition-all cursor-pointer text-left ${
                            filterCategory === 'RECENT_3K'
                                ? 'bg-emerald-950/90 border-emerald-400 ring-2 ring-emerald-500/60 shadow-[0_0_12px_rgba(16,185,129,0.3)] scale-[1.02]'
                                : 'bg-slate-900/90 border-slate-800 hover:bg-emerald-950/30 hover:border-emerald-500/50'
                        }`}
                        title="点击直接筛选显示：⏱️ 最近3根K线内刚发生过穿越或发散的启动期币种"
                    >
                        <span className="text-emerald-300 text-[10px] font-bold flex items-center gap-1">
                            <Clock size={11} className="text-emerald-400" />
                            近期(≤3K)
                        </span>
                        <span className="font-bold text-emerald-200 font-mono text-[11px]">{recent3kCount}</span>
                    </button>

                    {/* 9. 等待确认 */}
                    <button
                        type="button"
                        onClick={() => setFilterCategory('WAITING')}
                        className={`flex items-center justify-between px-2 py-1.5 rounded border transition-all cursor-pointer text-left ${
                            filterCategory === 'WAITING'
                                ? 'bg-purple-950/90 border-purple-400 ring-2 ring-purple-500/60 shadow-[0_0_12px_rgba(168,85,247,0.3)] scale-[1.02]'
                                : 'bg-purple-950/40 border-purple-500/40 hover:bg-purple-900/40 hover:border-purple-500/70'
                        }`}
                        title="点击直接筛选显示：⏳ 正在等待阳/阴线收盘确认或休眠蓄势中的币种"
                    >
                        <span className="text-purple-300 text-[10px] font-bold flex items-center gap-1">
                            <Clock size={11} className="text-purple-400" />
                            等待确认
                        </span>
                        <span className="font-bold text-purple-200 font-mono text-[11px]">{waitingCount}</span>
                    </button>

                    {/* 10. 异常丢包 */}
                    <button
                        type="button"
                        onClick={() => setFilterCategory('ERROR')}
                        className={`flex items-center justify-between px-2 py-1.5 rounded border transition-all cursor-pointer text-left ${
                            filterCategory === 'ERROR'
                                ? 'bg-red-950/90 border-red-400 ring-2 ring-red-500/60 shadow-[0_0_12px_rgba(239,68,68,0.3)] scale-[1.02]'
                                : 'bg-red-950/30 border-red-500/30 hover:bg-red-900/40 hover:border-red-500/60'
                        }`}
                        title="点击直接筛选显示：⚠️ K线接口异常或空数据的币种"
                    >
                        <span className="text-red-400 text-[10px] font-bold flex items-center gap-1">
                            <AlertTriangle size={11} className="text-red-400" />
                            异常丢包
                        </span>
                        <span className="font-bold text-red-300 font-mono text-[11px]">{errorCount}</span>
                    </button>
                </div>

                {/* Timeframe Tabs */}
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-950 border-b border-slate-800 overflow-x-auto shrink-0 scrollbar-none">
                    <button
                        onClick={() => setSelectedTf('ALL')}
                        className={`px-3 py-1 rounded text-xs font-bold transition-all whitespace-nowrap ${
                            selectedTf === 'ALL'
                                ? 'bg-indigo-600 text-white shadow-md'
                                : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
                        }`}
                    >
                        全部周期 ({enrichedRecords.length})
                    </button>
                    {ALL_TFS.map(tf => {
                        const count = enrichedRecords.filter(r => r.tf === tf).length;
                        const isCurrentScanning = scanningSymbols?.[tf];
                        const isActive = selectedTf === tf;
                        const isEnabled = activeTimeframes.includes(tf);

                        return (
                            <button
                                key={tf}
                                onClick={() => setSelectedTf(tf)}
                                className={`px-2.5 py-1 rounded text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap relative ${
                                    isActive
                                        ? 'bg-blue-600 text-white shadow-md'
                                        : isEnabled
                                            ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                                            : 'bg-slate-900/60 text-slate-500 border border-slate-800/80'
                                }`}
                            >
                                <span className="uppercase">{tf}</span>
                                <span className={`text-[10px] px-1 py-0.2 rounded font-mono ${isActive ? 'bg-blue-800 text-white' : 'bg-slate-900 text-slate-400'}`}>
                                    {count}
                                </span>
                                {isCurrentScanning && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Filter and Search Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-slate-900/90 border-b border-slate-800 shrink-0">
                    {/* Search */}
                    <div className="relative flex-1 min-w-[180px] max-w-xs">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="搜索币种 (如 BTC, ETH, SKL)..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-700 rounded pl-8 pr-3 py-1 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-500 font-mono"
                        />
                        {searchQuery && (
                            <button 
                                onClick={() => setSearchQuery('')}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
                            >
                                ✕
                            </button>
                        )}
                    </div>

                    {/* Filter Category Tabs */}
                    <div className="flex items-center gap-1 text-[10.5px] overflow-x-auto">
                        <button
                            onClick={() => setFilterCategory('ALL')}
                            className={`px-2 py-0.5 rounded font-bold transition-all ${
                                filterCategory === 'ALL'
                                    ? 'bg-slate-700 text-white'
                                    : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                            }`}
                        >
                            全部 ({enrichedRecords.filter(r => selectedTf === 'ALL' || r.tf === selectedTf).length})
                        </button>
                        <button
                            onClick={() => setFilterCategory('PASSED')}
                            className={`px-2 py-0.5 rounded font-bold transition-all flex items-center gap-1 ${
                                filterCategory === 'PASSED'
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-slate-950 text-emerald-400 hover:bg-emerald-950/40'
                            }`}
                        >
                            <CheckCircle2 size={11} />
                            已入榜
                        </button>
                        <button
                            onClick={() => setFilterCategory('CROSSING')}
                            className={`px-2 py-0.5 rounded font-bold transition-all flex items-center gap-1 ${
                                filterCategory === 'CROSSING'
                                    ? 'bg-amber-600 text-white'
                                    : 'bg-slate-950 text-amber-400 hover:bg-amber-950/40'
                            }`}
                        >
                            <Zap size={11} />
                            四线穿越
                        </button>
                        <button
                            onClick={() => setFilterCategory('BULLISH')}
                            className={`px-2 py-0.5 rounded font-bold transition-all flex items-center gap-1 ${
                                filterCategory === 'BULLISH'
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-slate-950 text-indigo-400 hover:bg-indigo-950/40'
                            }`}
                        >
                            <TrendingUp size={11} />
                            多头发散
                        </button>
                        <button
                            onClick={() => setFilterCategory('BEARISH')}
                            className={`px-2 py-0.5 rounded font-bold transition-all flex items-center gap-1 ${
                                filterCategory === 'BEARISH'
                                    ? 'bg-rose-600 text-white'
                                    : 'bg-slate-950 text-rose-400 hover:bg-rose-950/40'
                            }`}
                        >
                            <TrendingDown size={11} />
                            空头发散
                        </button>
                        <button
                            onClick={() => setFilterCategory('HIST_CROSSING')}
                            className={`px-2 py-0.5 rounded font-bold transition-all flex items-center gap-1 ${
                                filterCategory === 'HIST_CROSSING'
                                    ? 'bg-amber-600 text-white'
                                    : 'bg-slate-950 text-amber-400 hover:bg-amber-950/40'
                            }`}
                        >
                            <Zap size={11} />
                            200K有穿越 ({histCrossingCount})
                        </button>
                        <button
                            onClick={() => setFilterCategory('HIST_DIVERGENCE')}
                            className={`px-2 py-0.5 rounded font-bold transition-all flex items-center gap-1 ${
                                filterCategory === 'HIST_DIVERGENCE'
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-slate-950 text-indigo-400 hover:bg-indigo-950/40'
                            }`}
                        >
                            <TrendingUp size={11} />
                            200K有发散 ({histDivCount})
                        </button>
                        <button
                            onClick={() => setFilterCategory('RECENT_3K')}
                            className={`px-2 py-0.5 rounded font-bold transition-all flex items-center gap-1 ${
                                filterCategory === 'RECENT_3K'
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-slate-950 text-emerald-400 hover:bg-emerald-950/40'
                            }`}
                        >
                            <Clock size={11} />
                            近期(≤3K) ({recent3kCount})
                        </button>
                        <button
                            onClick={() => setFilterCategory('WAITING')}
                            className={`px-2 py-0.5 rounded font-bold transition-all flex items-center gap-1 ${
                                filterCategory === 'WAITING'
                                    ? 'bg-purple-600 text-white'
                                    : 'bg-slate-950 text-purple-400 hover:bg-purple-950/40'
                            }`}
                        >
                            <Clock size={11} />
                            等待确认
                        </button>
                        <button
                            onClick={() => setFilterCategory('REJECTED')}
                            className={`px-2 py-0.5 rounded font-bold transition-all flex items-center gap-1 ${
                                filterCategory === 'REJECTED'
                                    ? 'bg-slate-600 text-white'
                                    : 'bg-slate-950 text-slate-400 hover:bg-slate-800'
                            }`}
                        >
                            <XCircle size={11} />
                            拦截原因
                        </button>
                    </div>
                </div>

                {/* Main Table / Dual-Track Diagnostic Cards View */}
                <div className="flex-1 overflow-auto bg-slate-950/70 p-3 custom-scrollbar">
                    {tfRecords.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-500 py-12">
                            <Activity size={36} className="text-slate-600 mb-2 opacity-60" />
                            <p className="text-sm font-bold text-slate-400">当前周期或筛选条件下暂无扫描数据</p>
                            <p className="text-xs text-slate-500 mt-1 max-w-sm text-center">
                                扫描器正在从本地 200 根 K 线缓存中高速轮询形态，数据将随扫描进度自动实时填入此处。
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-2.5">
                            {tfRecords.map((record) => {
                                const cleanSym = record.symbol.replace('USDT', '');
                                const isPassed = record.isPassed;
                                const isFullyCrossed = record.isFullyCrossed;
                                const isBullishDiv = record.isBullishDiv;
                                const isBearishDiv = record.isBearishDiv;
                                const isError = record.fetchStatus !== 'SUCCESS';

                                return (
                                    <div
                                        key={`${record.symbol}-${record.tf}`}
                                        onClick={() => onSelectSymbol && onSelectSymbol(record.symbol, record.tf)}
                                        className={`p-3 rounded-lg border transition-all cursor-pointer select-none hover:shadow-lg group ${
                                            isPassed
                                                ? 'bg-emerald-950/20 border-emerald-500/50 shadow-[0_0_12px_rgba(16,185,129,0.12)] hover:border-emerald-400'
                                                : isError
                                                    ? 'bg-red-950/20 border-red-500/40 hover:border-red-400'
                                                    : isFullyCrossed && isBullishDiv
                                                        ? 'bg-amber-950/20 border-amber-500/40 hover:border-amber-300'
                                                        : isFullyCrossed
                                                            ? 'bg-amber-950/15 border-amber-600/30 hover:border-amber-400'
                                                            : isBullishDiv
                                                                ? 'bg-indigo-950/20 border-indigo-500/30 hover:border-indigo-400'
                                                                : isBearishDiv
                                                                    ? 'bg-rose-950/20 border-rose-500/30 hover:border-rose-400'
                                                                    : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                                        }`}
                                        title={`点击查看 ${cleanSym} (${record.tf}) 200根K线全景图`}
                                    >
                                        {/* Top Bar: Symbol, TF, Prices & Formats */}
                                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
                                            {/* Symbol, TF, Price */}
                                            <div className="flex items-center gap-2">
                                                <span className="px-2 py-0.5 bg-slate-800 text-slate-100 group-hover:text-amber-300 font-mono font-bold text-xs rounded border border-slate-700 transition-colors">
                                                    {cleanSym}
                                                </span>
                                                <span className="px-1.5 py-0.5 bg-blue-900/40 border border-blue-500/40 text-blue-300 font-mono font-bold text-[10px] rounded uppercase">
                                                    {record.tf}
                                                </span>
                                                <span className="text-xs font-mono font-bold text-slate-100">
                                                    现价: ${record.latestPrice > 0 ? formatPrecise8(record.latestPrice) : '--'}
                                                </span>
                                                <span className="text-[10px] text-slate-400 font-mono">
                                                    (开: {formatPrecise8(record.kOpen)} | 高: {formatPrecise8(record.kHigh)} | 低: {formatPrecise8(record.kLow)} | 收: {formatPrecise8(record.kClose)})
                                                </span>
                                                <span className={`text-[9.5px] px-1 py-0.2 rounded font-bold font-mono ${
                                                    record.candleType === 'BULLISH' ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/50' : 
                                                    record.candleType === 'BEARISH' ? 'bg-rose-950/80 text-rose-300 border border-rose-700/50' : 
                                                    'bg-slate-800 text-slate-300 border border-slate-700'
                                                }`}>
                                                    {record.candleType === 'BULLISH' ? '阳线' : record.candleType === 'BEARISH' ? '阴线' : '十字星'}
                                                </span>
                                            </div>

                                            {/* Status Badge & Actions */}
                                            <div className="flex items-center gap-2">
                                                {/* Pattern Badges */}
                                                {isFullyCrossed && isBullishDiv ? (
                                                    <span className="flex items-center gap-1 text-[10.5px] font-bold text-amber-300 bg-amber-950/80 border border-amber-500/50 px-2 py-0.5 rounded-full animate-pulse">
                                                        <Zap size={11} className="text-amber-400" />
                                                        ⚡穿越 + 🟢多头发散 双重共振
                                                    </span>
                                                ) : isFullyCrossed ? (
                                                    <span className="flex items-center gap-1 text-[10.5px] font-bold text-amber-300 bg-amber-950/60 border border-amber-500/40 px-2 py-0.5 rounded-full">
                                                        <Zap size={11} className="text-amber-400" />
                                                        ⚡ 100%完全穿透EMA10-40
                                                    </span>
                                                ) : isBullishDiv ? (
                                                    <span className="flex items-center gap-1 text-[10.5px] font-bold text-indigo-300 bg-indigo-950/60 border border-indigo-500/40 px-2 py-0.5 rounded-full">
                                                        <TrendingUp size={11} className="text-indigo-400" />
                                                        🟢 顺序多头发散 (10&gt;20&gt;30&gt;40)
                                                    </span>
                                                ) : isBearishDiv ? (
                                                    <span className="flex items-center gap-1 text-[10.5px] font-bold text-rose-300 bg-rose-950/60 border border-rose-500/40 px-2 py-0.5 rounded-full">
                                                        <TrendingDown size={11} className="text-rose-400" />
                                                        🔴 顺序空头发散 (10&lt;20&lt;30&lt;40)
                                                    </span>
                                                ) : (
                                                    <span className="flex items-center gap-1 text-[10px] text-slate-400 bg-slate-800/80 border border-slate-700 px-2 py-0.5 rounded-full">
                                                        🔄 均线缠绕震荡
                                                    </span>
                                                )}

                                                {/* In-List Status */}
                                                {isPassed ? (
                                                    <span className="flex items-center gap-1 text-[10.5px] font-bold text-emerald-300 bg-emerald-950/80 border border-emerald-500/60 px-2 py-0.5 rounded-full">
                                                        <CheckCircle2 size={12} />
                                                        已入榜
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] text-slate-500 bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded-full">
                                                        未入榜
                                                    </span>
                                                )}

                                                {onSelectSymbol && (
                                                    <button
                                                        onClick={(e) => {
                                                             e.stopPropagation();
                                                             onSelectSymbol(record.symbol, record.tf);
                                                        }}
                                                        className="text-xs text-indigo-400 hover:text-indigo-200 flex items-center gap-1 px-2 py-0.5 bg-indigo-950/70 border border-indigo-500/40 hover:bg-indigo-900/80 rounded transition-all font-bold"
                                                        title="在 200 根图表中查看"
                                                    >
                                                        <span>K线图</span>
                                                        <ExternalLink size={12} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {/* Core Dual-Track Diagnostics Grid */}
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2 pt-1 text-xs">
                                            
                                            {/* 板块 1: K线同时穿越 EMA10203040 空间穿透透视 */}
                                            <div className="p-2 bg-slate-950/70 rounded border border-slate-800/90 flex flex-col justify-between">
                                                <div>
                                                    <div className="text-[10px] font-bold text-slate-300 mb-1.5 flex items-center justify-between">
                                                        <span className="flex items-center gap-1 text-amber-300">
                                                            <Zap size={12} className="text-amber-400" />
                                                            1. 四均线空间穿透透视
                                                        </span>
                                                        <span className="font-mono text-[9px] text-slate-400">
                                                            EMA10~40极值区间
                                                        </span>
                                                    </div>

                                                    {/* Extreme Values Gauge */}
                                                    <div className="grid grid-cols-2 gap-1.5 mb-1.5">
                                                        <div className="p-1 rounded bg-slate-900/90 border border-slate-800">
                                                            <div className="flex items-center justify-between text-[9px] text-slate-400 mb-0.5">
                                                                <span>四线之顶 (MaxEMA)</span>
                                                                <span className={record.isHighAboveMax ? 'text-emerald-400 font-bold' : 'text-rose-400'}>
                                                                    {record.isHighAboveMax ? '✅ 已上穿' : '❌ 未穿顶'}
                                                                </span>
                                                            </div>
                                                            <div className="font-mono text-[9.5px] text-slate-200 truncate">
                                                                {formatPrecise8(record.maxEma)}
                                                            </div>
                                                            <div className="text-[8.5px] font-mono mt-0.5 text-slate-400">
                                                                高点穿顶幅度: <span className={record.highOverMaxPct >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                                                    {record.highOverMaxPct >= 0 ? `+${record.highOverMaxPct.toFixed(3)}%` : `${record.highOverMaxPct.toFixed(3)}%`}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        <div className="p-1 rounded bg-slate-900/90 border border-slate-800">
                                                            <div className="flex items-center justify-between text-[9px] text-slate-400 mb-0.5">
                                                                <span>四线之底 (MinEMA)</span>
                                                                <span className={record.isLowBelowMin ? 'text-emerald-400 font-bold' : 'text-rose-400'}>
                                                                    {record.isLowBelowMin ? '✅ 已下穿' : '❌ 未穿底'}
                                                                </span>
                                                            </div>
                                                            <div className="font-mono text-[9.5px] text-slate-200 truncate">
                                                                {formatPrecise8(record.minEma)}
                                                            </div>
                                                            <div className="text-[8.5px] font-mono mt-0.5 text-slate-400">
                                                                低点穿底深度: <span className={record.lowBelowMinPct >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                                                    {record.lowBelowMinPct >= 0 ? `+${record.lowBelowMinPct.toFixed(3)}%` : `${record.lowBelowMinPct.toFixed(3)}%`}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Crossing Verdict Tag */}
                                                <div className={`p-1 rounded text-center font-bold text-[9.5px] border ${
                                                    isFullyCrossed 
                                                        ? 'bg-amber-950/60 border-amber-500/50 text-amber-300' 
                                                        : 'bg-slate-900 border-slate-800 text-slate-400'
                                                }`}>
                                                    {isFullyCrossed 
                                                        ? '⚡ K线同时穿越并物理打穿 EMA10/20/30/40 全部四条均线' 
                                                        : `⚠️ 仅部分穿透 (穿顶: ${record.isHighAboveMax ? '是' : '否'}, 穿底: ${record.isLowBelowMin ? '是' : '否'})`}
                                                </div>
                                            </div>

                                            {/* 板块 2: EMA10/20/30/40/80 均线数值与发散寻找过程 */}
                                            <div className="p-2 bg-slate-950/70 rounded border border-slate-800/90 flex flex-col justify-between">
                                                <div>
                                                    <div className="text-[10px] font-bold text-slate-300 mb-1.5 flex items-center justify-between">
                                                        <span className="flex items-center gap-1 text-indigo-300">
                                                            <TrendingUp size={12} className="text-indigo-400" />
                                                            2. 均线高精数值与发散过程
                                                        </span>
                                                        <span className="text-[9px] text-slate-400 font-mono">
                                                            扩散率: {record.divergenceSpread > 0 ? `+${record.divergenceSpread.toFixed(2)}%` : `${record.divergenceSpread.toFixed(2)}%`}
                                                        </span>
                                                    </div>

                                                    {/* 5 EMAs Matrix */}
                                                    <div className="grid grid-cols-5 gap-1 font-mono text-[9px] text-center mb-1.5">
                                                        <div className="bg-slate-900 p-0.5 rounded border border-slate-800">
                                                            <div className="text-amber-400 text-[8.5px] font-bold">E10</div>
                                                            <div className="text-slate-200 font-mono truncate">{formatPrecise8(record.ema10)}</div>
                                                        </div>
                                                        <div className="bg-slate-900 p-0.5 rounded border border-slate-800">
                                                            <div className="text-purple-400 text-[8.5px] font-bold">E20</div>
                                                            <div className="text-slate-200 font-mono truncate">{formatPrecise8(record.ema20)}</div>
                                                        </div>
                                                        <div className="bg-slate-900 p-0.5 rounded border border-slate-800">
                                                            <div className="text-blue-400 text-[8.5px] font-bold">E30</div>
                                                            <div className="text-slate-200 font-mono truncate">{formatPrecise8(record.ema30)}</div>
                                                        </div>
                                                        <div className="bg-slate-900 p-0.5 rounded border border-slate-800">
                                                            <div className="text-orange-400 text-[8.5px] font-bold">E40</div>
                                                            <div className="text-slate-200 font-mono truncate">{formatPrecise8(record.ema40)}</div>
                                                        </div>
                                                        <div className="bg-slate-900 p-0.5 rounded border border-slate-800">
                                                            <div className="text-cyan-400 text-[8.5px] font-bold">E80</div>
                                                            <div className="text-slate-200 font-mono truncate">{formatPrecise8(record.ema80)}</div>
                                                        </div>
                                                    </div>

                                                    {/* Relationship Stepping Chain */}
                                                    <div className="p-1 rounded bg-slate-900/90 border border-slate-800 flex items-center justify-between text-[8.5px] font-mono">
                                                        <span className="text-slate-500">排序:</span>
                                                        <span className={record.ema10 > record.ema20 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                                            10{record.ema10 > record.ema20 ? '>' : '≤'}20
                                                        </span>
                                                        <span className={record.ema20 > record.ema30 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                                            20{record.ema20 > record.ema30 ? '>' : '≤'}30
                                                        </span>
                                                        <span className={record.ema30 > record.ema40 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                                            30{record.ema30 > record.ema40 ? '>' : '≤'}40
                                                        </span>
                                                        <span className={record.isEma80Aligned ? 'text-cyan-400 font-bold' : 'text-slate-500'}>
                                                            80大势:{record.isEma80Aligned ? '顺' : '逆/平'}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Divergence Stage Verdict */}
                                                <div className={`p-1 mt-1.5 rounded text-center font-bold text-[9.5px] border ${
                                                    isBullishDiv 
                                                        ? 'bg-indigo-950/60 border-indigo-500/50 text-indigo-300' 
                                                        : isBearishDiv 
                                                            ? 'bg-rose-950/60 border-rose-500/50 text-rose-300' 
                                                            : 'bg-slate-900 border-slate-800 text-slate-400'
                                                }`}>
                                                    {isBullishDiv ? '🟢 均线多头正向发散确立' : isBearishDiv ? '🔴 均线空头反向发散确立' : '🔄 均线未形成顺序发散 (存在局部交叉/缠绕)'}
                                                </div>
                                            </div>

                                            {/* 板块 3: 形态综合裁决与拦截诊断 */}
                                            <div className="p-2 bg-slate-950/70 rounded border border-slate-800/90 flex flex-col justify-between">
                                                <div>
                                                    <div className="text-[10px] font-bold text-slate-300 mb-1.5 flex items-center justify-between">
                                                        <span className="flex items-center gap-1 text-emerald-300">
                                                            <Shield size={12} className="text-emerald-400" />
                                                            3. 终审裁决与拦截诊断
                                                        </span>
                                                        <span className="text-[9px] text-slate-500 font-mono">
                                                            {new Date(record.timestamp).toLocaleTimeString()}
                                                        </span>
                                                    </div>

                                                    <div className="p-2 rounded bg-slate-900/90 border border-slate-800 space-y-1">
                                                        <div className="text-[10.5px] font-bold flex items-center gap-1">
                                                            <span className="text-slate-400">判定结果:</span>
                                                            <span className={
                                                                isPassed 
                                                                    ? 'text-emerald-400 font-bold' 
                                                                    : isError 
                                                                        ? 'text-red-400 font-bold' 
                                                                        : 'text-amber-400 font-bold'
                                                            }>
                                                                {record.rejectionReason}
                                                            </span>
                                                        </div>

                                                        <div className="text-[9px] text-slate-400 font-mono pt-1 border-t border-slate-800 flex justify-between">
                                                            <span>缓存命中/耗时: {record.fetchLatencyMs}ms</span>
                                                            <span>K线样本数: {record.klineCount}根</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="text-[9px] text-slate-500 italic text-right mt-1 font-mono">
                                                    已同步推向列表3/列表4动能链路
                                                </div>
                                            </div>
                                        </div>

                                        {/* 板块 4: 🔍 过去 200 根 K 线形态轨迹与时间统计记录 */}
                                        <div className="mt-2.5 pt-2 border-t border-slate-800/80">
                                            <div className="p-2.5 bg-slate-950/80 rounded-lg border border-slate-800 flex flex-col gap-2">
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="text-[10px] font-bold text-amber-300 flex items-center gap-1">
                                                            <Zap size={11} className="text-amber-400" />
                                                            过去 200K 形态统计:
                                                        </span>

                                                        {/* 穿越频次 */}
                                                        <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700/80 text-[10px] font-mono flex items-center gap-1">
                                                            <span className="text-slate-400">⚡ 四线穿越:</span>
                                                            <span className={`font-bold ${(record.crossingCount || 0) > 0 ? 'text-amber-300' : 'text-slate-500'}`}>
                                                                {record.crossingCount || 0} 次
                                                            </span>
                                                            {record.latestCrossingBarsAgo !== undefined && (
                                                                <span className="text-amber-400/90 text-[9px]">
                                                                    (最近: {record.latestCrossingBarsAgo === 0 ? '当前K' : `${record.latestCrossingBarsAgo}根K前`} / {formatDateTime(record.latestCrossingTime)})
                                                                </span>
                                                            )}
                                                        </span>

                                                        {/* 发散频次 */}
                                                        <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700/80 text-[10px] font-mono flex items-center gap-1">
                                                            <span className="text-slate-400">🌊 均线发散:</span>
                                                            <span className={`font-bold ${(record.divergenceCount || 0) > 0 ? 'text-indigo-300' : 'text-slate-500'}`}>
                                                                {record.divergenceCount || 0} 次
                                                            </span>
                                                            <span className="text-[9px] text-slate-500">
                                                                (多头: {record.bullDivergenceCount || 0} | 空头: {record.bearDivergenceCount || 0})
                                                            </span>
                                                            {record.latestDivergenceBarsAgo !== undefined && (
                                                                <span className="text-indigo-400/90 text-[9px]">
                                                                    (最近: {record.latestDivergenceBarsAgo === 0 ? '当前K' : `${record.latestDivergenceBarsAgo}根K前`} / {formatDateTime(record.latestDivergenceTime)})
                                                                </span>
                                                            )}
                                                        </span>
                                                    </div>

                                                    {/* 展开/收起流水明细 */}
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            const key = `${record.symbol}-${record.tf}`;
                                                            setExpandedHistorySymbol(expandedHistorySymbol === key ? null : key);
                                                        }}
                                                        className={`px-2.5 py-1 rounded text-[10px] font-bold transition-all flex items-center gap-1 cursor-pointer border ${
                                                            expandedHistorySymbol === `${record.symbol}-${record.tf}`
                                                                ? 'bg-amber-600 text-white border-amber-400 shadow-sm'
                                                                : (record.historyOccurrences?.length || 0) > 0
                                                                    ? 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-amber-500/40 hover:border-amber-400'
                                                                    : 'bg-slate-900 text-slate-500 border-slate-800'
                                                        }`}
                                                    >
                                                        <span>📋 查看 200K 形态发生时间流水 ({record.historyOccurrences?.length || 0}条)</span>
                                                        <span className="text-[8.5px]">{expandedHistorySymbol === `${record.symbol}-${record.tf}` ? '▲ 收起' : '▼ 展开'}</span>
                                                    </button>
                                                </div>

                                                {/* 展开的流水表 */}
                                                {expandedHistorySymbol === `${record.symbol}-${record.tf}` && (
                                                    <div className="mt-2 pt-2 border-t border-slate-800 animate-in fade-in duration-200">
                                                        <div className="text-[10px] font-bold text-slate-300 mb-1.5 flex items-center justify-between">
                                                            <span className="flex items-center gap-1 text-amber-300">
                                                                <span>📜 {cleanSym} ({record.tf}) 过去 200 根 K 线形态出现时刻流水</span>
                                                                <span className="text-[9px] text-slate-400 font-normal">(按时间由近到远排列，共 {record.historyOccurrences?.length || 0} 根形态K线)</span>
                                                            </span>
                                                            <span className="text-[9px] text-slate-400 font-mono">
                                                                样本窗口: 200 根历史 K 线
                                                            </span>
                                                        </div>

                                                        {(!record.historyOccurrences || record.historyOccurrences.length === 0) ? (
                                                            <div className="p-3 text-center text-slate-500 text-[10px] bg-slate-900 rounded border border-slate-800">
                                                                在过去 200 根 K 线内，未检测到满足四线完全穿越或顺序发散的形态 K 线。
                                                            </div>
                                                        ) : (
                                                            <div className="max-h-60 overflow-y-auto rounded border border-slate-800 bg-slate-900/90 custom-scrollbar">
                                                                <table className="w-full text-[9px] font-mono text-left border-collapse">
                                                                    <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 sticky top-0 z-10 select-none">
                                                                        <tr>
                                                                            <th className="p-1.5 pl-2 text-center w-8">#</th>
                                                                            <th className="p-1.5">发生时间</th>
                                                                            <th className="p-1.5">距今K线</th>
                                                                            <th className="p-1.5">触发形态</th>
                                                                            <th className="p-1.5 text-right">K线开/高/低/收</th>
                                                                            <th className="p-1.5 text-center">当时EMA10~40状态</th>
                                                                            <th className="p-1.5 text-center">EMA80大势</th>
                                                                            <th className="p-1.5 pr-2 text-right">时效特征</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-slate-800/60">
                                                                        {record.historyOccurrences.map((occ, idx) => (
                                                                            <tr 
                                                                                key={idx} 
                                                                                className={`hover:bg-slate-800/70 transition-colors ${
                                                                                    occ.barsAgo === 0 
                                                                                        ? 'bg-amber-950/30 text-amber-200' 
                                                                                        : occ.barsAgo <= 3 
                                                                                            ? 'bg-emerald-950/20' 
                                                                                            : 'text-slate-300'
                                                                                }`}
                                                                            >
                                                                                <td className="p-1.5 pl-2 text-center text-slate-500">{idx + 1}</td>
                                                                                <td className="p-1.5 font-bold text-slate-200 whitespace-nowrap">
                                                                                    {occ.timeText}
                                                                                </td>
                                                                                <td className="p-1.5 whitespace-nowrap">
                                                                                    <span className={`px-1 py-0.2 rounded font-bold ${
                                                                                        occ.barsAgo === 0 ? 'bg-amber-900/70 text-amber-300 border border-amber-700/60' :
                                                                                        occ.barsAgo <= 3 ? 'bg-emerald-900/70 text-emerald-300 border border-emerald-700/60' :
                                                                                        'bg-slate-950 text-slate-400'
                                                                                    }`}>
                                                                                        {occ.barsAgo === 0 ? '当前K (0根前)' : `${occ.barsAgo} 根K前`}
                                                                                    </span>
                                                                                </td>
                                                                                <td className="p-1.5 whitespace-nowrap">
                                                                                    {occ.patternType === 'CROSS_AND_BULL_DIV' ? (
                                                                                        <span className="text-amber-300 font-bold bg-amber-950/80 px-1 py-0.5 rounded border border-amber-500/40">
                                                                                            ⚡穿越 + 🟢多头发散
                                                                                        </span>
                                                                                    ) : occ.patternType === 'CROSS_AND_BEAR_DIV' ? (
                                                                                        <span className="text-rose-300 font-bold bg-rose-950/80 px-1 py-0.5 rounded border border-rose-500/40">
                                                                                            ⚡穿越 + 🔴空头发散
                                                                                        </span>
                                                                                    ) : occ.patternType === 'CROSSING' ? (
                                                                                        <span className="text-amber-400 font-bold">
                                                                                            ⚡ 四线穿透
                                                                                        </span>
                                                                                    ) : occ.patternType === 'BULL_DIV' ? (
                                                                                        <span className="text-emerald-400 font-bold">
                                                                                            🟢 多头顺序发散
                                                                                        </span>
                                                                                    ) : (
                                                                                        <span className="text-rose-400 font-bold">
                                                                                            🔴 空头顺序发散
                                                                                        </span>
                                                                                    )}
                                                                                </td>
                                                                                <td className="p-1.5 text-right font-mono text-[8.5px] text-slate-300 whitespace-nowrap">
                                                                                    高: {formatPrecise8(occ.high)} | 低: {formatPrecise8(occ.low)}
                                                                                </td>
                                                                                <td className="p-1.5 text-center font-mono text-[8.5px] text-slate-400 whitespace-nowrap">
                                                                                    {occ.divergenceType === 'BULLISH' ? '10>20>30>40' : occ.divergenceType === 'BEARISH' ? '10<20<30<40' : '均线缠绕'}
                                                                                </td>
                                                                                <td className="p-1.5 text-center whitespace-nowrap">
                                                                                    <span className={occ.isEma80Aligned ? 'text-cyan-400 font-bold' : 'text-slate-500'}>
                                                                                        {occ.isEma80Aligned === undefined ? '--' : occ.isEma80Aligned ? '顺大势' : '逆大势'}
                                                                                    </span>
                                                                                </td>
                                                                                <td className="p-1.5 pr-2 text-right whitespace-nowrap">
                                                                                    <span className={`px-1 py-0.2 rounded text-[8.5px] ${
                                                                                        occ.barsAgo === 0 ? 'bg-amber-950 text-amber-300' :
                                                                                        occ.barsAgo <= 3 ? 'bg-emerald-950 text-emerald-400' : 'text-slate-500'
                                                                                    }`}>
                                                                                        {occ.note}
                                                                                    </span>
                                                                                </td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-4 py-2.5 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 shrink-0">
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span>多周期K线形态透视看板运行中 · 本地内存 200 根全量 K 线 0ms 极速形态透视</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-bold transition-all text-xs"
                    >
                        关闭看板
                    </button>
                </div>
            </div>
        </div>
    );
};

