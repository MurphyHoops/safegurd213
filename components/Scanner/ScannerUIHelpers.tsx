
import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

// --- 1. Smart Number Input ---
// Handles float parsing, focus states, and empty values gracefully
export const SmartNumberInput = ({ value, onChange, className }: { value: number, onChange: (val: number) => void, className: string }) => {
    const [localVal, setLocalVal] = useState(value.toString());
    const [isFocused, setIsFocused] = useState(false);

    useEffect(() => {
        if (!isFocused) {
            setLocalVal(value.toString());
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
            value={localVal}
            onChange={handleChange}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            className={className}
            step="any" 
        />
    );
};

// --- 2. Market Sentiment Widget ---
// Displays Up/Down counts and BTC change
export const MarketSentimentWidget = ({ stats }: { stats: { up: number, down: number, total: number, btcChange: number } }) => {
    const riseRatio = stats.total > 0 ? (stats.up / stats.total) : 0.5;
    let breadthColor = riseRatio > 0.6 ? 'bg-emerald-500 shadow-emerald-500/50' : riseRatio < 0.4 ? 'bg-red-500 shadow-red-500/50' : 'bg-yellow-500 shadow-yellow-500/50';
    
    if (stats.total === 0) {
         return <div className="bg-slate-950/50 border border-slate-800 rounded p-2 flex items-center justify-center gap-2 text-[10px] text-slate-500 h-[34px]"><Loader2 size={12} className="animate-spin" /> 读取市场数据...</div>;
    }

    return (
        <div className="grid grid-cols-2 gap-2 animate-in fade-in">
            <div className="bg-[#1e2329] border border-slate-700 rounded p-1.5 flex items-center justify-between px-2">
                <div className="flex items-center gap-1.5 text-[9px] text-slate-500 font-bold"><div className={`w-1.5 h-1.5 rounded-full shadow-[0_0_5px] ${breadthColor}`}></div>全市场</div>
                <div className="flex gap-1.5 font-mono text-[9px] font-bold"><span className="text-emerald-400">↑{stats.up}</span><span className="text-slate-600">/</span><span className="text-red-400">↓{stats.down}</span></div>
            </div>
            <div className="bg-[#1e2329] border border-slate-700 rounded p-1.5 flex items-center justify-between px-2">
                <div className="flex items-center gap-1.5 text-[9px] text-slate-500 font-bold">BTC</div>
                <div className={`font-mono font-bold text-[9px] ${stats.btcChange > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{stats.btcChange > 0 ? '+' : ''}{stats.btcChange.toFixed(2)}%</div>
            </div>
        </div>
    );
};
