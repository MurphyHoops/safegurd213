import React from 'react';
import { Play, Loader2 } from 'lucide-react';

interface Props {
    symbol: string;
    interval: string;
    limit: number;
    loading: boolean;
    setSymbol: (s: string) => void;
    setInterval: (s: string) => void;
    setLimit: (l: number) => void;
    onRunBacktest: () => void;
}

export const BacktesterControls: React.FC<Props> = ({
    symbol, interval, limit, loading, setSymbol, setInterval, setLimit, onRunBacktest
}) => {
    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
                <label className="text-[10px] text-slate-500 block mb-1 font-mono uppercase tracking-wider">交易对 (Symbol)</label>
                <input 
                    type="text" 
                    className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-white font-mono" 
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                />
            </div>
            <div>
                <label className="text-[10px] text-slate-500 block mb-1 font-mono uppercase tracking-wider">周期 (Interval)</label>
                <select 
                    className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-white font-mono"
                    value={interval}
                    onChange={(e) => setInterval(e.target.value)}
                >
                    <option value="1m">1m</option>
                    <option value="5m">5m</option>
                    <option value="15m">15m</option>
                    <option value="1h">1h</option>
                    <option value="4h">4h</option>
                    <option value="1d">1d</option>
                </select>
            </div>
            <div>
                <label className="text-[10px] text-slate-500 block mb-1 font-mono uppercase tracking-wider">K线数量 (Limit)</label>
                <input 
                    type="number" 
                    className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-white font-mono" 
                    value={limit}
                    onChange={(e) => setLimit(parseInt(e.target.value))}
                />
            </div>
            <div className="flex items-end">
                <button 
                    onClick={onRunBacktest}
                    disabled={loading}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white py-1.5 rounded text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-900/20"
                >
                    {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                    开始回测
                </button>
            </div>
        </div>
    );
};
