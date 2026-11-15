
import React, { useState, useEffect, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { getVolume8am, fetchVolume8amBatch, isCurrentTradingDay } from '../../services/volume8amService';
import { klineDailyStore } from '../../services/klineDailyStore';
import { getProxyUrl } from '../../services/apiService';

// 缓存币安永续合约 USDT 交易对集合（排除交割合约与非活跃合约）
let cachedPerpetualUsdtSet: Set<string> | null = null;
let isFetchingExchangeInfo = false;

async function ensurePerpetualUsdtSymbols(): Promise<Set<string> | null> {
    if (cachedPerpetualUsdtSet && cachedPerpetualUsdtSet.size > 50) {
        return cachedPerpetualUsdtSet;
    }
    try {
        const saved = localStorage.getItem('SCANNER_USDT_PERPETUAL_SYMBOLS_V1');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && Array.isArray(parsed.symbols) && parsed.symbols.length > 50 && Date.now() - (parsed.timestamp || 0) < 12 * 3600 * 1000) {
                cachedPerpetualUsdtSet = new Set(parsed.symbols);
                return cachedPerpetualUsdtSet;
            }
        }
    } catch (_) {}

    if (isFetchingExchangeInfo) return cachedPerpetualUsdtSet;
    isFetchingExchangeInfo = true;
    try {
        const targetUrl = 'https://fapi.binance.com/fapi/v1/exchangeInfo';
        let data: any = null;
        try {
            const res = await fetch(getProxyUrl(targetUrl, 'normal'));
            if (res.ok) data = await res.json();
        } catch (_) {}
        if (!data || !Array.isArray(data.symbols)) {
            try {
                const res2 = await fetch(targetUrl);
                if (res2.ok) data = await res2.json();
            } catch (_) {}
        }
        if (data && Array.isArray(data.symbols)) {
            const perpSymbols = data.symbols
                .filter((s: any) => s && s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.status === 'TRADING')
                .map((s: any) => String(s.symbol));
            if (perpSymbols.length > 50) {
                cachedPerpetualUsdtSet = new Set(perpSymbols);
                try {
                    localStorage.setItem('SCANNER_USDT_PERPETUAL_SYMBOLS_V1', JSON.stringify({
                        timestamp: Date.now(),
                        symbols: perpSymbols
                    }));
                } catch (_) {}
                try {
                    window.dispatchEvent(new CustomEvent('scanner_8am_cache_updated'));
                } catch (_) {}
            }
        }
    } catch (_) {
    } finally {
        isFetchingExchangeInfo = false;
    }
    return cachedPerpetualUsdtSet;
}

// --- 1. Smart Number Input ---
// Handles float parsing, focus states, and empty values gracefully
export const SmartNumberInput = ({ value, onChange, className, disabled }: { value: number | undefined | null, onChange: (val: number) => void, className: string, disabled?: boolean }) => {
    const safeValue = (value === undefined || value === null || isNaN(value)) ? 0 : value;
    const [localVal, setLocalVal] = useState(safeValue.toString());
    const [isFocused, setIsFocused] = useState(false);

    useEffect(() => {
        if (!isFocused) {
            const currentSafeValue = (value === undefined || value === null || isNaN(value)) ? 0 : value;
            setLocalVal(currentSafeValue.toString());
        }
    }, [value, isFocused]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setLocalVal(val);
        const parsed = parseFloat(val);
        onChange(isNaN(parsed) ? 0 : parsed);
    };

    return (
        <input 
            type="number"
            value={localVal === 'NaN' || Number.isNaN(localVal) ? '' : localVal}
            onChange={handleChange}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            disabled={disabled}
            className={className}
            step="any" 
        />
    );
};

// --- 2. Market Sentiment Widget ---
// Displays 24H & Since-8AM Up/Down counts for Binance USDT Perpetual Contracts and BTC change
export const MarketSentimentWidget = ({ stats }: { stats: { up: number, down: number, total: number, btcChange: number, up8am?: number, down8am?: number, btcChange8am?: number } }) => {
    const [refreshTick, setRefreshTick] = useState(0);

    useEffect(() => {
        ensurePerpetualUsdtSymbols();
        const bump = () => setRefreshTick(t => t + 1);
        window.addEventListener('scanner_8am_cache_updated', bump);
        window.addEventListener('scanner_raw_data_updated', bump);
        window.addEventListener('CENTRAL_DAILY_KLINES_UPDATED', bump);
        const timer = setInterval(bump, 4000);
        return () => {
            window.removeEventListener('scanner_8am_cache_updated', bump);
            window.removeEventListener('scanner_raw_data_updated', bump);
            window.removeEventListener('CENTRAL_DAILY_KLINES_UPDATED', bump);
            clearInterval(timer);
        };
    }, []);

    const stats8am = useMemo(() => {
        let tickers: any[] = klineDailyStore.get24hTickersSync();
        if (!Array.isArray(tickers) || tickers.length === 0) {
            try {
                const raw = localStorage.getItem('SCANNER_RAW_DATA_CACHE');
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) tickers = parsed;
                }
            } catch (_) {}
        }

        let up8am = 0;
        let down8am = 0;
        let btcChange8am = 0;
        let btcReady = false;
        const missingSymbols: string[] = [];

        // 优先计算 BTC 从早8点起的涨跌幅
        const btcTicker = Array.isArray(tickers) ? tickers.find((t: any) => t && t.symbol === 'BTCUSDT') : undefined;
        const btcLivePrice = btcTicker ? (parseFloat(btcTicker.lastPrice || btcTicker.price || btcTicker.close || '0') || 0) : 0;
        const btc8amItem = getVolume8am('BTCUSDT');
        if (btc8amItem && isCurrentTradingDay(btc8amItem.openTime) && btc8amItem.openPrice > 0) {
            const refPrice = btcLivePrice > 0 ? btcLivePrice : btc8amItem.lastPrice;
            if (refPrice > 0) {
                btcChange8am = ((refPrice - btc8amItem.openPrice) / btc8amItem.openPrice) * 100;
                btcReady = true;
            }
        } else {
            missingSymbols.push('BTCUSDT');
        }

        // 遍历币安 USDT 永续合约，统计从早8点起上涨/下跌币个数
        if (Array.isArray(tickers) && tickers.length > 0) {
            const seen = new Set<string>();
            for (const t of tickers) {
                const sym = t?.symbol;
                if (!sym || typeof sym !== 'string' || !sym.endsWith('USDT') || sym.includes('_')) continue;
                if (cachedPerpetualUsdtSet && cachedPerpetualUsdtSet.size > 50 && !cachedPerpetualUsdtSet.has(sym)) continue;
                if (seen.has(sym)) continue;
                seen.add(sym);

                const livePrice = parseFloat(t.lastPrice || t.price || t.close || '0') || 0;
                if (livePrice <= 0) continue;

                const item8am = getVolume8am(sym);
                if (item8am && isCurrentTradingDay(item8am.openTime) && item8am.openPrice > 0) {
                    const chg8am = ((livePrice - item8am.openPrice) / item8am.openPrice) * 100;
                    if (chg8am > 0) up8am++;
                    else if (chg8am < 0) down8am++;
                } else {
                    if (sym !== 'BTCUSDT') missingSymbols.push(sym);
                }
            }
        }

        if (missingSymbols.length > 0) {
            fetchVolume8amBatch(missingSymbols).catch(() => {});
        }

        return {
            up8am: stats.up8am !== undefined ? stats.up8am : up8am,
            down8am: stats.down8am !== undefined ? stats.down8am : down8am,
            btcChange8am: stats.btcChange8am !== undefined ? stats.btcChange8am : btcChange8am,
            btcReady: stats.btcChange8am !== undefined || btcReady
        };
    }, [stats.up, stats.down, stats.total, stats.btcChange, stats.up8am, stats.down8am, stats.btcChange8am, refreshTick]);

    const riseRatio = stats.total > 0 ? (stats.up / stats.total) : 0.5;
    const breadthColor = riseRatio > 0.6 ? 'bg-emerald-500 shadow-emerald-500/50' : riseRatio < 0.4 ? 'bg-red-500 shadow-red-500/50' : 'bg-yellow-500 shadow-yellow-500/50';
    
    const total8am = stats8am.up8am + stats8am.down8am;
    const riseRatio8am = total8am > 0 ? (stats8am.up8am / total8am) : 0.5;
    const breadthColor8am = riseRatio8am > 0.6 ? 'bg-emerald-500 shadow-emerald-500/50' : riseRatio8am < 0.4 ? 'bg-red-500 shadow-red-500/50' : 'bg-yellow-500 shadow-yellow-500/50';

    if (stats.total === 0) {
         return <div className="bg-slate-950/50 border border-slate-800 rounded p-2 flex items-center justify-center gap-2 text-[10px] text-slate-500 h-[34px]"><Loader2 size={12} className="animate-spin" /> 读取市场数据...</div>;
    }

    return (
        <div className="grid grid-cols-2 gap-2 animate-in fade-in">
            {/* 全市场表格：显示 24H 与 早8点起 币安永续合约USDT上涨/下跌币个数 */}
            <div className="bg-[#1e2329] border border-slate-700 rounded p-1.5 px-2 flex flex-col gap-1 justify-center">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[9px] text-slate-400 font-bold">
                        <div className={`w-1.5 h-1.5 rounded-full shadow-[0_0_5px] ${breadthColor}`}></div>
                        <span>全市场</span>
                        <span className="text-[8px] text-slate-500 font-normal">24H</span>
                    </div>
                    <div className="flex gap-1 font-mono text-[9px] font-bold">
                        <span className="text-emerald-400">↑{stats.up}</span>
                        <span className="text-slate-600">/</span>
                        <span className="text-red-400">↓{stats.down}</span>
                    </div>
                </div>
                <div className="flex items-center justify-between border-t border-slate-800/80 pt-1">
                    <div className="flex items-center gap-1.5 text-[8.5px] text-cyan-400/90 font-bold" title="从北京时间早上8点起，币安交易所永续合约USDT上涨/下跌币的个数">
                        <div className={`w-1.5 h-1.5 rounded-full shadow-[0_0_5px] ${breadthColor8am}`}></div>
                        <span>早8点起</span>
                    </div>
                    <div className="flex gap-1 font-mono text-[9px] font-bold" title="从早8点起币安USDT永续合约：上涨币个数 / 下跌币个数">
                        <span className="text-emerald-400">↑{stats8am.up8am}</span>
                        <span className="text-slate-600">/</span>
                        <span className="text-red-400">↓{stats8am.down8am}</span>
                    </div>
                </div>
            </div>

            {/* BTC表格：显示 24H 与 早8点起 BTC 的涨跌幅 */}
            <div className="bg-[#1e2329] border border-slate-700 rounded p-1.5 px-2 flex flex-col gap-1 justify-center">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 text-[9px] text-slate-400 font-bold">
                        <span>BTC</span>
                        <span className="text-[8px] text-slate-500 font-normal">24H</span>
                    </div>
                    <div className={`font-mono font-bold text-[9px] ${(stats.btcChange ?? 0) > 0 ? 'text-emerald-400' : (stats.btcChange ?? 0) < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                        {(stats.btcChange ?? 0) > 0 ? '+' : ''}{typeof stats.btcChange === 'number' && isFinite(stats.btcChange) ? stats.btcChange.toFixed(2) : '0.00'}%
                    </div>
                </div>
                <div className="flex items-center justify-between border-t border-slate-800/80 pt-1">
                    <div className="flex items-center gap-1 text-[8.5px] text-cyan-400/90 font-bold" title="从北京时间早上8点起，BTC永续合约的实时涨跌幅">
                        <span>早8点起</span>
                    </div>
                    <div className={`font-mono font-bold text-[9px] ${stats8am.btcChange8am > 0 ? 'text-emerald-400' : stats8am.btcChange8am < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                        {stats8am.btcReady
                            ? `${stats8am.btcChange8am > 0 ? '+' : ''}${isFinite(stats8am.btcChange8am) ? stats8am.btcChange8am.toFixed(2) : '0.00'}%`
                            : '--'}
                    </div>
                </div>
            </div>
        </div>
    );
};
