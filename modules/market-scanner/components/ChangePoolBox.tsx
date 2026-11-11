import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ScanConfig } from '../../../components/Scanner/scannerTypes';
import { ChevronDown, ChevronUp, Copy, Check, Search, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { usePersistedState } from '../../../hooks/usePersistedState';
import { SmartNumberInput } from '../../../components/Scanner/ScannerUIHelpers';

interface Props {
    scanConfig: ScanConfig;
    setScanConfig: React.Dispatch<React.SetStateAction<ScanConfig>>;
}

export interface ChangePoolItem {
    symbol: string;
    change: number;
    price: number;
    type: 'GAINERS' | 'LOSERS';
    timestamp?: number;
}

export const ChangePoolBox: React.FC<Props> = ({ scanConfig, setScanConfig }) => {
    const [isCollapsed, setIsCollapsed] = usePersistedState<boolean>('SCANNER_CHANGE_POOL_COLLAPSED', false);
    const [searchTerm, setSearchTerm] = useState('');
    const [copied, setCopied] = useState(false);
    const [pool, setPool] = usePersistedState<ChangePoolItem[]>('SCANNER_CHANGE_FILTERED_POOL', []);
    const isMountedRef = useRef(true);

    const enableChangeFilter = scanConfig.enableChangeFilter !== false;
    const enableGainers = scanConfig.enableGainers !== false;
    const enableLosers = scanConfig.enableLosers !== false;

    useEffect(() => {
        isMountedRef.current = true;
        const handlePoolUpdated = (e?: any) => {
            try {
                let targetPool: ChangePoolItem[] = [];
                if (e?.detail) {
                    if (Array.isArray(e.detail.pool)) {
                        targetPool = e.detail.pool;
                    } else if (Array.isArray(e.detail)) {
                        targetPool = e.detail;
                    }
                }
                if (targetPool.length === 0) {
                    const raw = localStorage.getItem('SCANNER_CHANGE_FILTERED_POOL');
                    targetPool = raw ? JSON.parse(raw) : [];
                }
                setPool(targetPool);
            } catch (_) {}
        };

        window.addEventListener('scanner_change_pool_updated', handlePoolUpdated);
        handlePoolUpdated();

        return () => {
            isMountedRef.current = false;
            window.removeEventListener('scanner_change_pool_updated', handlePoolUpdated);
        };
    }, [setPool]);

    const filteredList = useMemo(() => {
        if (!searchTerm.trim()) return pool;
        const term = searchTerm.trim().toUpperCase();
        return pool.filter(item => item.symbol.includes(term));
    }, [pool, searchTerm]);

    const gainersCount = useMemo(() => pool.filter(i => i.type === 'GAINERS').length, [pool]);
    const losersCount = useMemo(() => pool.filter(i => i.type === 'LOSERS').length, [pool]);

    const handleCopy = () => {
        if (pool.length === 0) return;
        const text = pool.map(item => item.symbol).join(', ');
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => {
            if (isMountedRef.current) setCopied(false);
        }, 1500);
    };

    const toggleChangeFilterMaster = () => {
        setScanConfig(p => ({
            ...p,
            enableChangeFilter: !(p.enableChangeFilter !== false)
        }));
    };

    const toggleGainers = () => {
        setScanConfig(p => ({
            ...p,
            enableGainers: !(p.enableGainers !== false)
        }));
    };

    const toggleLosers = () => {
        setScanConfig(p => ({
            ...p,
            enableLosers: !(p.enableLosers !== false)
        }));
    };

    return (
        <div className="bg-[#1e2329] border border-emerald-500/40 rounded p-2 flex flex-col gap-1.5 shadow-[0_0_12px_rgba(16,185,129,0.12)] select-none">
            {/* 第一行：顶部设置行 (左右双栏：涨幅设置带胶囊开关 & 跌幅设置带胶囊开关) */}
            <div className="grid grid-cols-2 gap-1.5 bg-slate-950/80 p-1.5 rounded border border-slate-800/80 text-[9px]">
                {/* 左侧：涨幅设置 */}
                <div className="flex items-center justify-between gap-1 px-1.5 bg-emerald-950/30 rounded border border-emerald-900/40 py-1">
                    <div className="flex items-center gap-1 font-bold text-emerald-300">
                        <TrendingUp size={11} className="text-emerald-400 shrink-0" />
                        <span>涨幅 &gt;</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="flex items-center gap-0.5 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800 w-16 justify-center">
                            <SmartNumberInput
                                value={scanConfig.minGainChange ?? scanConfig.minChange ?? 1}
                                onChange={val => setScanConfig(p => ({ ...p, minGainChange: val }))}
                                className={`w-10 bg-transparent text-right font-mono font-bold outline-none ${enableGainers ? 'text-emerald-300' : 'text-slate-500 opacity-50'}`}
                            />
                            <span className="text-slate-500 text-[8px]">%</span>
                        </div>
                        {/* 涨幅右侧胶囊开关 */}
                        <button
                            type="button"
                            onClick={toggleGainers}
                            className={`relative inline-flex h-3 w-6 items-center rounded-full transition-colors duration-200 focus:outline-none cursor-pointer ${
                                enableGainers ? 'bg-emerald-600' : 'bg-slate-700'
                            }`}
                            title="开启/关闭涨幅过滤"
                        >
                            <span className={`inline-block h-2 w-2 transform rounded-full bg-white transition-transform duration-200 ${
                                enableGainers ? 'translate-x-[14px]' : 'translate-x-[2px]'
                            }`} />
                        </button>
                    </div>
                </div>

                {/* 右侧：跌幅设置 */}
                <div className="flex items-center justify-between gap-1 px-1.5 bg-rose-950/30 rounded border border-rose-900/40 py-1">
                    <div className="flex items-center gap-1 font-bold text-rose-300">
                        <TrendingDown size={11} className="text-rose-400 shrink-0" />
                        <span>跌幅 &gt;</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="flex items-center gap-0.5 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800 w-16 justify-center">
                            <SmartNumberInput
                                value={scanConfig.minLossChange ?? scanConfig.minChange ?? 1}
                                onChange={val => setScanConfig(p => ({ ...p, minLossChange: val }))}
                                className={`w-10 bg-transparent text-right font-mono font-bold outline-none ${enableLosers ? 'text-rose-300' : 'text-slate-500 opacity-50'}`}
                            />
                            <span className="text-slate-500 text-[8px]">%</span>
                        </div>
                        {/* 跌幅右侧胶囊开关 */}
                        <button
                            type="button"
                            onClick={toggleLosers}
                            className={`relative inline-flex h-3 w-6 items-center rounded-full transition-colors duration-200 focus:outline-none cursor-pointer ${
                                enableLosers ? 'bg-rose-600' : 'bg-slate-700'
                            }`}
                            title="开启/关闭跌幅过滤"
                        >
                            <span className={`inline-block h-2 w-2 transform rounded-full bg-white transition-transform duration-200 ${
                                enableLosers ? 'translate-x-[14px]' : 'translate-x-[2px]'
                            }`} />
                        </button>
                    </div>
                </div>
            </div>

            {/* 第二行：信息与状态栏（紧挨在设置行下方） */}
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5 pt-0.5 px-0.5">
                {/* 左侧：纯标题 (无左侧开关) */}
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-emerald-300">涨跌幅过滤底池</span>
                </div>

                {/* 中间统计：涨 (X) 个币，跌 (Y) 个币，共 (Z) 个币 */}
                <div className="text-[9px] font-mono text-slate-300 font-semibold px-2 py-0.5 bg-slate-900/90 rounded border border-slate-800">
                    涨 <span className="text-emerald-400 font-bold">{gainersCount}</span> 个币，跌 <span className="text-rose-400 font-bold">{losersCount}</span> 个币，共 <span className="text-cyan-400 font-bold">{pool.length}</span> 个币
                </div>

                {/* 右侧：复制、底池总开关(移至原“展开”位置)、折叠箭头(无“展开”文字) */}
                <div className="flex items-center gap-1">
                    <button
                        onClick={handleCopy}
                        disabled={pool.length === 0}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 p-1 rounded transition-colors"
                        title="复制涨跌幅底池所有币种"
                    >
                        {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
                    </button>

                    {/* 底池总开关胶囊按钮 (移至原“展开”位置) */}
                    <button
                        type="button"
                        onClick={toggleChangeFilterMaster}
                        className={`relative inline-flex h-3.5 w-7 items-center rounded-full transition-colors duration-200 focus:outline-none cursor-pointer ${
                            enableChangeFilter ? 'bg-emerald-600' : 'bg-slate-700'
                        }`}
                        title={enableChangeFilter ? "涨跌幅过滤总开关已开启" : "涨跌幅过滤总开关已关闭"}
                    >
                        <span className={`inline-block h-2 w-2 transform rounded-full bg-white transition-transform duration-200 ${
                            enableChangeFilter ? 'translate-x-[14px]' : 'translate-x-[2px]'
                        }`} />
                    </button>

                    {/* 折叠开关 (无“展开”文字) */}
                    <button
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        className="text-slate-400 hover:text-white p-1 rounded transition-colors ml-0.5 flex items-center justify-center cursor-pointer"
                        title={isCollapsed ? "点击展开" : "点击收起"}
                    >
                        {isCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                    </button>
                </div>
            </div>

            {/* 第三行：底部内容区（受折叠开关控制） */}
            {!isCollapsed && (
                <div className="space-y-1.5 pt-0.5 animate-in fade-in duration-200">
                    {/* Search Bar */}
                    {pool.length > 0 && (
                        <div className="relative">
                            <Search size={10} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input
                                type="text"
                                placeholder="搜索涨跌幅底池币种..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded pl-5 pr-2 py-0.5 text-[9px] text-slate-300 placeholder-slate-600 focus:outline-none focus:border-emerald-500/50"
                            />
                        </div>
                    )}

                    {/* Pool Chips Grid */}
                    {pool.length === 0 ? (
                        <div className="py-2.5 text-center text-slate-500 text-[9px] font-mono bg-slate-950/40 rounded border border-slate-900">
                            {enableChangeFilter ? `暂无符合条件的币种 (涨幅 > ${scanConfig.minGainChange ?? scanConfig.minChange ?? 1}%, 跌幅 > ${scanConfig.minLossChange ?? scanConfig.minChange ?? 1}%)` : '涨跌幅过滤总开关已关闭'}
                        </div>
                    ) : filteredList.length === 0 ? (
                        <div className="py-2 text-center text-slate-500 text-[9px]">
                            未找到匹配币种 &quot;{searchTerm}&quot;
                        </div>
                    ) : (
                        <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto custom-scrollbar p-1 bg-slate-950/60 rounded border border-slate-900">
                            {filteredList.map((item) => {
                                const cleanSym = item.symbol.replace('USDT', '');
                                const isGain = item.type === 'GAINERS';
                                return (
                                    <div
                                        key={item.symbol}
                                        className={`flex items-center gap-1 border rounded px-1.5 py-0.5 text-[9px] font-mono transition-all cursor-default ${
                                            isGain
                                                ? 'bg-emerald-950/30 hover:bg-emerald-900/40 border-emerald-900/50 text-emerald-300'
                                                : 'bg-rose-950/30 hover:bg-rose-900/40 border-rose-900/50 text-rose-300'
                                        }`}
                                        title={`${item.symbol}: 价格 $${item.price.toFixed(4)} | 涨跌幅: ${item.change >= 0 ? '+' : ''}${item.change.toFixed(2)}%`}
                                    >
                                        <span className="font-bold">{cleanSym}</span>
                                        <span className={`text-[8px] ${isGain ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {item.change >= 0 ? '+' : ''}{item.change.toFixed(1)}%
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
