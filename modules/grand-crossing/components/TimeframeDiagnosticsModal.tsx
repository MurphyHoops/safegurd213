import React, { useState, useMemo } from 'react';
import { 
    X, Search, Activity, CheckCircle2, XCircle, AlertTriangle, RefreshCw, 
    TrendingUp, TrendingDown, Layers, Zap, Clock, Maximize2, Minimize2, ExternalLink
} from 'lucide-react';
import { TimeframeDiagnosticRecord } from '../types';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    diagnostics: Record<string, TimeframeDiagnosticRecord>;
    activeTimeframes: string[];
    countdowns: Record<string, string>;
    scanningSymbols?: Record<string, string>;
    onSelectSymbol?: (symbol: string) => void;
}

const ALL_TFS = ['15s', '30s', '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];

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

const formatStrict8 = (val: number | undefined | null): string => {
    if (val === undefined || val === null || isNaN(val)) return '--';
    return Number(val).toFixed(8);
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
    const [filterCategory, setFilterCategory] = useState<'ALL' | 'PASSED' | 'BULLISH' | 'BEARISH' | 'REJECTED' | 'ERROR'>('ALL');
    const [isFullScreen, setIsFullScreen] = useState(false);

    const records = useMemo(() => {
        return Object.values(diagnostics || {});
    }, [diagnostics]);

    // Filter by timeframe
    const tfRecords = useMemo(() => {
        let list = selectedTf === 'ALL' 
            ? records 
            : records.filter(r => r.tf === selectedTf);

        // Search query
        if (searchQuery.trim()) {
            const query = searchQuery.trim().toUpperCase();
            list = list.filter(r => r.symbol.toUpperCase().includes(query));
        }

        // Filter category
        if (filterCategory === 'PASSED') {
            list = list.filter(r => r.isPassed);
        } else if (filterCategory === 'BULLISH') {
            list = list.filter(r => r.divergenceState === 'BULLISH');
        } else if (filterCategory === 'BEARISH') {
            list = list.filter(r => r.divergenceState === 'BEARISH');
        } else if (filterCategory === 'REJECTED') {
            list = list.filter(r => !r.isPassed && r.fetchStatus === 'SUCCESS');
        } else if (filterCategory === 'ERROR') {
            list = list.filter(r => r.fetchStatus !== 'SUCCESS');
        }

        // Sort: Passed first, then newest scanned
        return list.sort((a, b) => {
            if (a.isPassed && !b.isPassed) return -1;
            if (!a.isPassed && b.isPassed) return 1;
            return b.timestamp - a.timestamp;
        });
    }, [records, selectedTf, searchQuery, filterCategory]);

    // Summary counters
    const totalCount = records.length;
    const passedCount = records.filter(r => r.isPassed).length;
    const bullishCount = records.filter(r => r.divergenceState === 'BULLISH').length;
    const bearishCount = records.filter(r => r.divergenceState === 'BEARISH').length;
    const errorCount = records.filter(r => r.fetchStatus !== 'SUCCESS').length;

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4">
            <div className={`flex flex-col bg-slate-900 border border-indigo-500/40 rounded-xl shadow-2xl overflow-hidden transition-all duration-200 ${
                isFullScreen ? 'w-full h-full' : 'w-full max-w-6xl max-h-[92vh] h-[850px]'
            }`}>
                
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 bg-slate-950 border-b border-slate-800 shrink-0">
                    <div className="flex items-center gap-2.5">
                        <div className="p-1.5 bg-indigo-950/80 border border-indigo-500/40 rounded-lg text-indigo-400">
                            <Activity size={18} className="animate-pulse" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-sm sm:text-base font-bold text-slate-100 tracking-wide">
                                    列表2 · 多周期K线数据与形态透视看板
                                </h2>
                                <span className="text-[10px] bg-indigo-900/60 border border-indigo-500/30 text-indigo-300 px-2 py-0.5 rounded-full font-mono">
                                    实时监控中
                                </span>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                                实时透视各周期K线获取情况、EMA10/20/30/40实际数值、发散形态及未入榜拦截原因
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

                {/* Status Bar */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-3 bg-slate-950/70 border-b border-slate-800/80 text-xs shrink-0">
                    <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/90 rounded border border-slate-800">
                        <span className="text-slate-400 text-[11px]">已扫描总数据条数</span>
                        <span className="font-bold text-slate-200 font-mono">{totalCount}</span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-1.5 bg-emerald-950/30 rounded border border-emerald-500/30">
                        <span className="text-emerald-400 text-[11px]">✅ 成功入榜信号</span>
                        <span className="font-bold text-emerald-400 font-mono">{passedCount}</span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-1.5 bg-indigo-950/30 rounded border border-indigo-500/30">
                        <span className="text-indigo-300 text-[11px]">🟢 多头发散 (10&gt;20&gt;30&gt;40)</span>
                        <span className="font-bold text-indigo-300 font-mono">{bullishCount}</span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-1.5 bg-rose-950/30 rounded border border-rose-500/30">
                        <span className="text-rose-400 text-[11px]">🔴 空头发散 (10&lt;20&lt;30&lt;40)</span>
                        <span className="font-bold text-rose-400 font-mono">{bearishCount}</span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-1.5 bg-amber-950/30 rounded border border-amber-500/30 col-span-2 sm:col-span-1">
                        <span className="text-amber-400 text-[11px]">⚠️ 接口异常/丢包</span>
                        <span className="font-bold text-amber-400 font-mono">{errorCount}</span>
                    </div>
                </div>

                {/* Timeframe Tabs */}
                <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-950 border-b border-slate-800 overflow-x-auto shrink-0 scrollbar-none">
                    <button
                        onClick={() => setSelectedTf('ALL')}
                        className={`px-3 py-1 rounded text-xs font-bold transition-all whitespace-nowrap ${
                            selectedTf === 'ALL'
                                ? 'bg-indigo-600 text-white shadow-md'
                                : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
                        }`}
                    >
                        全部周期 ({records.length})
                    </button>
                    {ALL_TFS.map(tf => {
                        const count = records.filter(r => r.tf === tf).length;
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
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-slate-900/90 border-b border-slate-800 shrink-0">
                    {/* Search */}
                    <div className="relative flex-1 min-w-[200px] max-w-xs">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="搜索币种代码 (如 HOME, BTC)..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-500"
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
                    <div className="flex items-center gap-1 text-[11px] overflow-x-auto">
                        <button
                            onClick={() => setFilterCategory('ALL')}
                            className={`px-2.5 py-1 rounded-md font-bold transition-all ${
                                filterCategory === 'ALL'
                                    ? 'bg-slate-700 text-white'
                                    : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                            }`}
                        >
                            全部 ({records.filter(r => selectedTf === 'ALL' || r.tf === selectedTf).length})
                        </button>
                        <button
                            onClick={() => setFilterCategory('PASSED')}
                            className={`px-2.5 py-1 rounded-md font-bold transition-all flex items-center gap-1 ${
                                filterCategory === 'PASSED'
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-slate-950 text-emerald-400 hover:bg-emerald-950/40'
                            }`}
                        >
                            <CheckCircle2 size={12} />
                            已入榜
                        </button>
                        <button
                            onClick={() => setFilterCategory('BULLISH')}
                            className={`px-2.5 py-1 rounded-md font-bold transition-all flex items-center gap-1 ${
                                filterCategory === 'BULLISH'
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-slate-950 text-indigo-400 hover:bg-indigo-950/40'
                            }`}
                        >
                            <TrendingUp size={12} />
                            多头发散
                        </button>
                        <button
                            onClick={() => setFilterCategory('BEARISH')}
                            className={`px-2.5 py-1 rounded-md font-bold transition-all flex items-center gap-1 ${
                                filterCategory === 'BEARISH'
                                    ? 'bg-rose-600 text-white'
                                    : 'bg-slate-950 text-rose-400 hover:bg-rose-950/40'
                            }`}
                        >
                            <TrendingDown size={12} />
                            空头发散
                        </button>
                        <button
                            onClick={() => setFilterCategory('REJECTED')}
                            className={`px-2.5 py-1 rounded-md font-bold transition-all flex items-center gap-1 ${
                                filterCategory === 'REJECTED'
                                    ? 'bg-amber-600 text-white'
                                    : 'bg-slate-950 text-amber-400 hover:bg-amber-950/40'
                            }`}
                        >
                            <XCircle size={12} />
                            拦截原因
                        </button>
                        <button
                            onClick={() => setFilterCategory('ERROR')}
                            className={`px-2.5 py-1 rounded-md font-bold transition-all flex items-center gap-1 ${
                                filterCategory === 'ERROR'
                                    ? 'bg-red-600 text-white'
                                    : 'bg-slate-950 text-red-400 hover:bg-red-950/40'
                            }`}
                        >
                            <AlertTriangle size={12} />
                            异常丢包
                        </button>
                    </div>
                </div>

                {/* Main Table / Grid View */}
                <div className="flex-1 overflow-auto bg-slate-950/60 p-3">
                    {tfRecords.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-500 py-12">
                            <Activity size={36} className="text-slate-600 mb-2 opacity-60" />
                            <p className="text-sm font-bold text-slate-400">当前周期或筛选条件下暂无扫描数据</p>
                            <p className="text-xs text-slate-500 mt-1 max-w-sm text-center">
                                扫描器正在按 1 秒 1 个币的节奏稳定轮询中，数据将随扫描进度自动实时填入此处。
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {tfRecords.map((record) => {
                                const cleanSym = record.symbol.replace('USDT', '');
                                const isPassed = record.isPassed;
                                const isLong = record.divergenceState === 'BULLISH';
                                const isShort = record.divergenceState === 'BEARISH';
                                const isError = record.fetchStatus !== 'SUCCESS';

                                return (
                                    <div
                                        key={`${record.symbol}-${record.tf}`}
                                        className={`p-3 rounded-lg border transition-all ${
                                            isPassed
                                                ? 'bg-emerald-950/20 border-emerald-500/50 shadow-[0_0_12px_rgba(16,185,129,0.15)]'
                                                : isError
                                                    ? 'bg-red-950/20 border-red-500/40'
                                                    : isLong
                                                        ? 'bg-indigo-950/20 border-indigo-500/30'
                                                        : isShort
                                                            ? 'bg-rose-950/20 border-rose-500/30'
                                                            : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                                        }`}
                                    >
                                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
                                            {/* Symbol, TF, Price */}
                                            <div className="flex items-center gap-2">
                                                <span className="px-2 py-0.5 bg-slate-800 text-slate-200 font-mono font-bold text-xs rounded border border-slate-700">
                                                    {cleanSym}
                                                </span>
                                                <span className="px-1.5 py-0.5 bg-blue-900/40 border border-blue-500/40 text-blue-300 font-mono font-bold text-[10px] rounded uppercase">
                                                    {record.tf}
                                                </span>
                                                <span className="text-xs font-mono font-bold text-slate-200">
                                                    现价: ${record.latestPrice > 0 ? formatPrecise8(record.latestPrice) : '--'}
                                                </span>
                                                <span className="text-[10px] text-slate-400 font-mono">
                                                    (O: {formatPrecise8(record.kOpen)} | H: {formatPrecise8(record.kHigh)} | L: {formatPrecise8(record.kLow)} | C: {formatPrecise8(record.kClose)})
                                                </span>
                                            </div>

                                            {/* Status Badge */}
                                            <div className="flex items-center gap-2">
                                                {isPassed ? (
                                                    <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-500/50 px-2 py-0.5 rounded-full">
                                                        <CheckCircle2 size={12} />
                                                        已入榜列表2
                                                    </span>
                                                ) : isError ? (
                                                    <span className="flex items-center gap-1 text-[11px] font-bold text-red-400 bg-red-950/60 border border-red-500/50 px-2 py-0.5 rounded-full">
                                                        <AlertTriangle size={12} />
                                                        K线获取异常
                                                    </span>
                                                ) : (
                                                    <span className="flex items-center gap-1 text-[11px] font-bold text-slate-400 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded-full">
                                                        未入榜
                                                    </span>
                                                )}

                                                <span className="text-[10px] text-slate-500 font-mono">
                                                    {new Date(record.timestamp).toLocaleTimeString()}
                                                </span>

                                                {onSelectSymbol && (
                                                    <button
                                                        onClick={() => onSelectSymbol(record.symbol)}
                                                        className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5 p-1 hover:bg-slate-800 rounded transition-colors"
                                                        title="在图表中查看"
                                                    >
                                                        <ExternalLink size={12} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {/* Core Data Metrics */}
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2 pt-1 text-xs">
                                            {/* 1. K-line Fetch Layer */}
                                            <div className="p-2 bg-slate-950/60 rounded border border-slate-800/80">
                                                <div className="text-[10px] font-bold text-slate-400 mb-1 flex items-center justify-between">
                                                    <span>1. K线数据获取状态</span>
                                                    <span className="font-mono text-slate-500">{record.fetchLatencyMs}ms</span>
                                                </div>
                                                <div className="flex items-center gap-1.5 text-[11px]">
                                                    {record.fetchStatus === 'SUCCESS' ? (
                                                        <span className="text-emerald-400 font-bold flex items-center gap-1">
                                                            ✅ 获取成功 ({record.klineCount}根K线)
                                                        </span>
                                                    ) : (
                                                        <span className="text-rose-400 font-bold flex items-center gap-1">
                                                            ❌ 接口无数据 / 返回空 (丢包)
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* 2. EMA Indicator Array */}
                                            <div className="p-2 bg-slate-950/60 rounded border border-slate-800/80 flex flex-col justify-between">
                                                <div>
                                                    <div className="text-[10px] font-bold text-slate-400 mb-1 flex items-center justify-between">
                                                        <span>2. 均线计算数值 (保留8位高精度)</span>
                                                        <span className="text-[9px] text-slate-500 font-mono">IEEE-754高精</span>
                                                    </div>
                                                    <div className="grid grid-cols-5 gap-1 font-mono text-[10px] text-center">
                                                        <div className="bg-slate-900 p-0.5 rounded border border-slate-800" title={`EMA10: ${record.ema10 || '--'}`}>
                                                            <div className="text-amber-400 text-[9px] font-bold">E10</div>
                                                            <div className="text-slate-200 text-[9.5px] truncate font-mono">{formatPrecise8(record.ema10)}</div>
                                                        </div>
                                                        <div className="bg-slate-900 p-0.5 rounded border border-slate-800" title={`EMA20: ${record.ema20 || '--'}`}>
                                                            <div className="text-blue-400 text-[9px] font-bold">E20</div>
                                                            <div className="text-slate-200 text-[9.5px] truncate font-mono">{formatPrecise8(record.ema20)}</div>
                                                        </div>
                                                        <div className="bg-slate-900 p-0.5 rounded border border-slate-800" title={`EMA30: ${record.ema30 || '--'}`}>
                                                            <div className="text-purple-400 text-[9px] font-bold">E30</div>
                                                            <div className="text-slate-200 text-[9.5px] truncate font-mono">{formatPrecise8(record.ema30)}</div>
                                                        </div>
                                                        <div className="bg-slate-900 p-0.5 rounded border border-slate-800" title={`EMA40: ${record.ema40 || '--'}`}>
                                                            <div className="text-emerald-400 text-[9px] font-bold">E40</div>
                                                            <div className="text-slate-200 text-[9.5px] truncate font-mono">{formatPrecise8(record.ema40)}</div>
                                                        </div>
                                                        <div className="bg-slate-900 p-0.5 rounded border border-slate-800" title={`EMA80: ${record.ema80 || '--'}`}>
                                                            <div className="text-slate-400 text-[9px] font-bold">E80</div>
                                                            <div className="text-slate-300 text-[9.5px] truncate font-mono">{formatPrecise8(record.ema80)}</div>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* EMA Relations Visualizer */}
                                                {record.ema10 && record.ema20 && record.ema30 && record.ema40 ? (
                                                    <div className="mt-1.5 pt-1 border-t border-slate-800/60 flex items-center justify-between text-[9px] font-mono">
                                                        <span className="text-slate-500">排列关系:</span>
                                                        <span className={record.ema10 > record.ema20 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                                            E10 {record.ema10 > record.ema20 ? '>' : '<='} E20
                                                        </span>
                                                        <span className={record.ema20 > record.ema30 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                                            E20 {record.ema20 > record.ema30 ? '>' : '<='} E30
                                                        </span>
                                                        <span className={record.ema30 > record.ema40 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                                            E30 {record.ema30 > record.ema40 ? '>' : '<='} E40
                                                        </span>
                                                    </div>
                                                ) : null}
                                            </div>

                                            {/* 3. Divergence & Filter Diagnosis */}
                                            <div className="p-2 bg-slate-950/60 rounded border border-slate-800/80">
                                                <div className="text-[10px] font-bold text-slate-400 mb-1 flex items-center justify-between">
                                                    <span>3. 形态与拦截诊断结果</span>
                                                    {isLong && <span className="text-emerald-400 font-bold text-[10px]">🟢 多头发散</span>}
                                                    {isShort && <span className="text-rose-400 font-bold text-[10px]">🔴 空头发散</span>}
                                                </div>
                                                <div className="text-[11px] font-bold">
                                                    <span className={
                                                        isPassed 
                                                            ? 'text-emerald-400' 
                                                            : isError 
                                                                ? 'text-red-400' 
                                                                : 'text-amber-400'
                                                    }>
                                                        {record.rejectionReason}
                                                    </span>
                                                </div>
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
                        <span>全局单秒时钟调度器运行中 · 1秒1币满载吞吐 · 小周期优先与防饿死公平轮转</span>
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
