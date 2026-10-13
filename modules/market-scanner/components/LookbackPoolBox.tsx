import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ScanConfig } from '../../../components/Scanner/scannerTypes';
import { ChevronDown, ChevronUp, Copy, Check, Search, History, RefreshCw, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { usePersistedState } from '../../../hooks/usePersistedState';

interface Props {
    scanConfig: ScanConfig;
    onRunDiscovery?: (isManual?: boolean) => void;
    isMajorScanning?: boolean;
}

export interface LookbackPoolItem {
    symbol: string;
    direction?: 'LONG' | 'SHORT' | 'BOTH';
    fullSymbol?: string;
    maxZ?: number;
    minZ?: number;
    currentPrice?: number;
    timestamp?: number;
}

export const LookbackPoolBox: React.FC<Props> = ({ scanConfig, onRunDiscovery, isMajorScanning }) => {
    const [isCollapsed, setIsCollapsed] = usePersistedState<boolean>('SCANNER_LOOKBACK_POOL_COLLAPSED', false);
    const [searchTerm, setSearchTerm] = useState('');
    const [directionFilter, setDirectionFilter] = useState<'ALL' | 'LONG' | 'SHORT'>('ALL');
    const [copied, setCopied] = useState(false);
    const [pool, setPool] = usePersistedState<LookbackPoolItem[]>('SCANNER_LOOKBACK_FILTERED_POOL', []);
    const isMountedRef = useRef(true);

    useEffect(() => {
        isMountedRef.current = true;
        const handlePoolUpdated = () => {
            try {
                const raw = localStorage.getItem('SCANNER_LOOKBACK_FILTERED_POOL');
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) {
                        setPool(parsed);
                        return;
                    }
                }
                // 兼容老数据 SCANNER_MAJOR_TREND_CANDIDATES
                const rawLegacy = localStorage.getItem('SCANNER_MAJOR_TREND_CANDIDATES');
                if (rawLegacy) {
                    const parsedLegacy = JSON.parse(rawLegacy);
                    if (Array.isArray(parsedLegacy)) {
                        const legacyItems: LookbackPoolItem[] = parsedLegacy.map((c: string) => {
                            const isLong = c.endsWith('_LONG');
                            const isShort = c.endsWith('_SHORT');
                            const sym = c.replace(/_LONG$|_SHORT$/i, '').trim();
                            return {
                                symbol: sym,
                                direction: isLong ? 'LONG' : (isShort ? 'SHORT' : 'BOTH'),
                                fullSymbol: c,
                                timestamp: Date.now()
                            };
                        });
                        setPool(legacyItems);
                    }
                }
            } catch (_) {}
        };

        window.addEventListener('scanner_lookback_pool_updated', handlePoolUpdated);
        window.addEventListener('scanner_major_trend_candidates_updated', handlePoolUpdated);

        return () => {
            isMountedRef.current = false;
            window.removeEventListener('scanner_lookback_pool_updated', handlePoolUpdated);
            window.removeEventListener('scanner_major_trend_candidates_updated', handlePoolUpdated);
        };
    }, [setPool]);

    const filteredList = useMemo(() => {
        return pool.filter(item => {
            if (directionFilter === 'LONG' && item.direction === 'SHORT') return false;
            if (directionFilter === 'SHORT' && item.direction === 'LONG') return false;
            if (searchTerm.trim()) {
                const term = searchTerm.trim().toUpperCase();
                return item.symbol.toUpperCase().includes(term);
            }
            return true;
        });
    }, [pool, searchTerm, directionFilter]);

    const handleCopy = () => {
        if (pool.length === 0) return;
        const text = pool.map(item => item.symbol).join(', ');
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => {
            if (isMountedRef.current) setCopied(false);
        }, 1500);
    };

    return (
        <div className="bg-[#1e2329] border border-indigo-500/40 rounded p-2 flex flex-col gap-1.5 shadow-[0_0_12px_rgba(99,102,241,0.12)] select-none">
            {/* Header: Title, Count, Action Buttons, Collapse */}
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
                <div className="flex items-center gap-1.5">
                    <div className="p-1 rounded bg-indigo-950/60 border border-indigo-500/30 text-indigo-400">
                        <History size={11} className="shrink-0" />
                    </div>
                    <span className="text-[10px] font-bold text-indigo-300">回溯周期过滤底池</span>
                    <span className="bg-indigo-950 text-indigo-400 border border-indigo-800/60 font-mono text-[9px] font-bold px-1.5 py-0.2 rounded-full shadow-inner">
                        {pool.length} 个币
                    </span>
                </div>

                <div className="flex items-center gap-1">
                    {/* Copy All */}
                    <button
                        onClick={handleCopy}
                        disabled={pool.length === 0}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 p-1 rounded transition-colors"
                        title="复制回溯周期底池所有币种"
                    >
                        {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
                    </button>

                    {/* Refresh / Scan */}
                    {onRunDiscovery && (
                        <button
                            onClick={() => onRunDiscovery(true)}
                            disabled={isMajorScanning}
                            className="bg-slate-800 hover:bg-slate-700 text-indigo-400 disabled:opacity-40 p-1 rounded transition-colors"
                            title="重新扫描大行情流水线"
                        >
                            <RefreshCw size={10} className={isMajorScanning ? 'animate-spin' : ''} />
                        </button>
                    )}

                    {/* Collapse / Expand */}
                    <button
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-400 p-1 rounded transition-colors"
                        title={isCollapsed ? "展开底池" : "折叠底池"}
                    >
                        {isCollapsed ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
                    </button>
                </div>
            </div>

            {/* Collapsible Content */}
            {!isCollapsed && (
                <div className="flex flex-col gap-1.5 pt-0.5">
                    {/* Search & Filter Bar */}
                    <div className="flex items-center gap-1">
                        <div className="relative flex-1">
                            <Search size={9} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input
                                type="text"
                                placeholder="搜索回溯底池币种..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full bg-[#12161c] border border-slate-700/60 rounded pl-5 pr-1.5 py-0.5 text-[9px] text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/80"
                            />
                        </div>
                        {/* Direction Filters */}
                        <div className="flex items-center bg-[#12161c] border border-slate-800 rounded p-0.5 text-[8.5px]">
                            <button
                                onClick={() => setDirectionFilter('ALL')}
                                className={`px-1.5 py-0.2 rounded transition-colors ${directionFilter === 'ALL' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-white'}`}
                            >
                                全
                            </button>
                            <button
                                onClick={() => setDirectionFilter('LONG')}
                                className={`px-1.5 py-0.2 rounded transition-colors ${directionFilter === 'LONG' ? 'bg-emerald-600 text-white font-bold' : 'text-emerald-400/80 hover:text-emerald-300'}`}
                            >
                                多
                            </button>
                            <button
                                onClick={() => setDirectionFilter('SHORT')}
                                className={`px-1.5 py-0.2 rounded transition-colors ${directionFilter === 'SHORT' ? 'bg-rose-600 text-white font-bold' : 'text-rose-400/80 hover:text-rose-300'}`}
                            >
                                空
                            </button>
                        </div>
                    </div>

                    {/* Coins Grid / Badges */}
                    {pool.length === 0 ? (
                        <div className="py-2.5 text-center text-[9px] text-slate-500 bg-[#12161c] rounded border border-slate-800/40">
                            暂无回溯周期过滤合格币种 (等待扫描或调整回溯天数)
                        </div>
                    ) : filteredList.length === 0 ? (
                        <div className="py-2 text-center text-[9px] text-slate-500 bg-[#12161c] rounded border border-slate-800/40">
                            无匹配的搜索结果
                        </div>
                    ) : (
                        <div className="flex flex-wrap gap-1 max-h-36 overflow-y-auto pr-0.5 custom-scrollbar bg-[#12161c]/50 p-1 rounded border border-slate-800/40">
                            {filteredList.map((item) => {
                                const cleanSym = item.symbol.replace(/USDT$/i, '');
                                const isLong = item.direction === 'LONG';
                                const isShort = item.direction === 'SHORT';

                                return (
                                    <div
                                        key={item.fullSymbol || item.symbol}
                                        className="flex items-center gap-1 bg-[#1e2329] border border-slate-700/60 hover:border-indigo-500/60 px-1.5 py-0.5 rounded text-[9px] font-mono text-slate-200 transition-colors shadow-xs"
                                        title={`${item.symbol} ${item.direction || 'BOTH'} | 极值 [MaxZ: ${item.maxZ?.toFixed(2) ?? '-'}, MinZ: ${item.minZ?.toFixed(2) ?? '-'}]`}
                                    >
                                        <span className="font-bold text-white">{cleanSym}</span>
                                        {isLong && (
                                            <span className="flex items-center text-[8px] text-emerald-400 font-bold bg-emerald-950/60 border border-emerald-500/30 px-1 py-0.1 rounded">
                                                <ArrowUpRight size={8} className="mr-0.2" />多
                                            </span>
                                        )}
                                        {isShort && (
                                            <span className="flex items-center text-[8px] text-rose-400 font-bold bg-rose-950/60 border border-rose-500/30 px-1 py-0.1 rounded">
                                                <ArrowDownRight size={8} className="mr-0.2" />空
                                            </span>
                                        )}
                                        {!isLong && !isShort && (
                                            <span className="text-[8px] text-indigo-400 font-bold bg-indigo-950/60 border border-indigo-500/30 px-1 py-0.1 rounded">
                                                双向
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
