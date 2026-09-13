import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ScanConfig } from '../../../components/Scanner/scannerTypes';
import { ChevronDown, ChevronUp, Copy, Check, Search, Layers, RefreshCw } from 'lucide-react';
import { usePersistedState } from '../../../hooks/usePersistedState';

interface Props {
    scanConfig: ScanConfig;
    onRunDiscovery?: (isManual?: boolean) => void;
    isMajorScanning?: boolean;
}

export interface SidewaysPoolItem {
    symbol: string;
    dropFromMax: number;
    riseFromMin: number;
    maxZ: number;
    minZ: number;
    currentPrice: number;
    timestamp?: number;
}

export const SidewaysPoolBox: React.FC<Props> = ({ scanConfig, onRunDiscovery, isMajorScanning }) => {
    const [isCollapsed, setIsCollapsed] = usePersistedState<boolean>('SCANNER_SIDEWAYS_POOL_COLLAPSED', false);
    const [searchTerm, setSearchTerm] = useState('');
    const [copied, setCopied] = useState(false);
    const [pool, setPool] = usePersistedState<SidewaysPoolItem[]>('SCANNER_SIDEWAYS_FILTERED_POOL', []);
    const isMountedRef = useRef(true);

    useEffect(() => {
        isMountedRef.current = true;
        const handlePoolUpdated = () => {
            try {
                const raw = localStorage.getItem('SCANNER_SIDEWAYS_FILTERED_POOL');
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) {
                        setPool(parsed);
                    }
                }
            } catch (_) {}
        };

        window.addEventListener('scanner_sideways_pool_updated', handlePoolUpdated);
        window.addEventListener('scanner_major_trend_candidates_updated', handlePoolUpdated);

        return () => {
            isMountedRef.current = false;
            window.removeEventListener('scanner_sideways_pool_updated', handlePoolUpdated);
            window.removeEventListener('scanner_major_trend_candidates_updated', handlePoolUpdated);
        };
    }, [setPool]);

    const filteredList = useMemo(() => {
        if (!searchTerm.trim()) return pool;
        const term = searchTerm.trim().toUpperCase();
        return pool.filter(item => item.symbol.includes(term));
    }, [pool, searchTerm]);

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
        <div className="bg-[#1e2329] border border-cyan-500/40 rounded p-2 flex flex-col gap-1.5 shadow-[0_0_12px_rgba(6,182,212,0.12)] select-none">
            {/* Header: Title, Count, Action Buttons, Collapse */}
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
                <div className="flex items-center gap-1.5">
                    <div className="p-1 rounded bg-cyan-950/60 border border-cyan-500/30 text-cyan-400">
                        <Layers size={11} className="shrink-0" />
                    </div>
                    <span className="text-[10px] font-bold text-cyan-300">横盘蓄势过滤底池</span>
                    <span className="bg-cyan-950 text-cyan-400 border border-cyan-800/60 font-mono text-[9px] font-bold px-1.5 py-0.2 rounded-full shadow-inner">
                        {pool.length} 个币
                    </span>
                </div>

                <div className="flex items-center gap-1">
                    {/* Copy All */}
                    <button
                        onClick={handleCopy}
                        disabled={pool.length === 0}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 p-1 rounded transition-colors"
                        title="复制横盘蓄势底池所有币种"
                    >
                        {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
                    </button>

                    {/* Refresh / Scan */}
                    {onRunDiscovery && (
                        <button
                            onClick={() => onRunDiscovery(true)}
                            disabled={isMajorScanning}
                            className="bg-slate-800 hover:bg-slate-700 text-cyan-400 disabled:opacity-40 p-1 rounded transition-colors"
                            title="重新扫描大行情流水线"
                        >
                            <RefreshCw size={10} className={isMajorScanning ? 'animate-spin text-indigo-400' : ''} />
                        </button>
                    )}

                    {/* Collapse Button */}
                    <button
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        className="text-slate-400 hover:text-white p-0.5 rounded transition-colors ml-0.5"
                    >
                        {isCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                    </button>
                </div>
            </div>

            {/* Collapsible Content */}
            {!isCollapsed && (
                <div className="space-y-1.5 pt-0.5 animate-in fade-in duration-200">
                    {/* Search Bar */}
                    {pool.length > 0 && (
                        <div className="relative">
                            <Search size={10} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input
                                type="text"
                                placeholder="搜索横盘底池币种..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded pl-5 pr-2 py-0.5 text-[9px] text-slate-300 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50"
                            />
                        </div>
                    )}

                    {/* Pool Chips Grid */}
                    {pool.length === 0 ? (
                        <div className="py-2.5 text-center text-slate-500 text-[9px] font-mono bg-slate-950/40 rounded border border-slate-900">
                            {isMajorScanning ? '正在扫描横盘蓄势币种...' : '暂无数据，请运行大行情发现或等待自动扫描'}
                        </div>
                    ) : filteredList.length === 0 ? (
                        <div className="py-2 text-center text-slate-500 text-[9px]">
                            未找到匹配币种 &quot;{searchTerm}&quot;
                        </div>
                    ) : (
                        <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto custom-scrollbar p-1 bg-slate-950/60 rounded border border-slate-900">
                            {filteredList.map((item) => {
                                const cleanSym = item.symbol.replace('USDT', '');
                                return (
                                    <div
                                        key={item.symbol}
                                        className="flex items-center gap-1 bg-slate-900 hover:bg-slate-800 border border-cyan-900/40 hover:border-cyan-500/40 rounded px-1.5 py-0.5 text-[9px] font-mono text-slate-200 transition-all cursor-default"
                                        title={`${item.symbol}: 距最高点跌 ${(item.dropFromMax ?? 0).toFixed(1)}% / 距最低点涨 ${(item.riseFromMin ?? 0).toFixed(1)}%`}
                                    >
                                        <span className="font-bold text-cyan-300">{cleanSym}</span>
                                        <span className="text-[7.5px] text-slate-400">
                                            ↓{(item.dropFromMax ?? 0).toFixed(0)}% ↑{(item.riseFromMin ?? 0).toFixed(0)}%
                                        </span>
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
