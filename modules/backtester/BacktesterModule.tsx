
import React, { useState } from 'react';
import { Play, BarChart2, History, Settings, AlertCircle, Loader2, TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { BacktestService, BacktestResult } from '../../services/backtestService';
import { AppSettings, PositionSide } from '../../types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';

import { motion, AnimatePresence } from 'motion/react';

interface Props {
    settings: AppSettings;
}

export const BacktesterModule: React.FC<Props> = ({ settings }) => {
    const [symbol, setSymbol] = useState('BTCUSDT');
    const [interval, setInterval] = useState('1h');
    const [limit, setLimit] = useState(500);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<BacktestResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const runBacktest = async () => {
        setLoading(true);
        setError(null);
        try {
            const klines = await BacktestService.fetchKLines(symbol, interval, limit);
            const res = BacktestService.runSimulation(symbol, klines, settings);
            setResult(res);
        } catch (err: any) {
            setError(err.message || '回测失败');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-4 space-y-4 bg-slate-900/50 min-h-[400px]">
            {/* Header / Controls */}
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
                        onClick={runBacktest}
                        disabled={loading}
                        className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white py-1.5 rounded text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-900/20"
                    >
                        {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                        开始回测
                    </button>
                </div>
            </div>

            <AnimatePresence mode="wait">
                {error && (
                    <motion.div 
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="p-3 bg-red-900/20 border border-red-500/50 rounded flex items-center gap-2 text-red-400 text-[10px]"
                    >
                        <AlertCircle size={14} />
                        {error}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Results Section */}
            <AnimatePresence>
                {result && (
                    <motion.div 
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-4"
                    >
                        {/* Stats Grid */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <StatCard label="总交易次数" value={result.stats.totalTrades} icon={History} color="text-blue-400" index={0} />
                            <StatCard label="胜率" value={`${result.stats.winRate.toFixed(1)}%`} icon={Activity} color="text-emerald-400" index={1} />
                            <StatCard label="总盈亏" value={`${result.stats.totalPnl.toFixed(2)} U`} icon={TrendingUp} color={result.stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'} index={2} />
                            <StatCard label="盈亏比" value={result.stats.profitFactor.toFixed(2)} icon={BarChart2} color="text-amber-400" index={3} />
                        </div>

                        {/* Equity Curve Chart */}
                        <motion.div 
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: 0.2 }}
                            className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 h-[250px]"
                        >
                            <div className="flex items-center justify-between mb-4">
                                <h4 className="text-[10px] font-bold text-slate-400 flex items-center gap-2 uppercase tracking-widest">
                                    <TrendingUp size={12} /> 权益曲线 (Equity Curve)
                                </h4>
                            </div>
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={result.equityCurve}>
                                    <defs>
                                        <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                                    <XAxis 
                                        dataKey="time" 
                                        hide 
                                    />
                                    <YAxis 
                                        domain={['auto', 'auto']} 
                                        stroke="#64748b" 
                                        fontSize={10} 
                                        tickFormatter={(val) => `${val.toFixed(0)}`}
                                    />
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', fontSize: '10px' }}
                                        labelFormatter={(label) => new Date(label).toLocaleString()}
                                    />
                                    <Area type="monotone" dataKey="balance" stroke="#6366f1" fillOpacity={1} fill="url(#colorBalance)" strokeWidth={2} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </motion.div>

                        {/* Trade History Table */}
                        <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.4 }}
                            className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden"
                        >
                            <div className="p-3 border-b border-slate-700 bg-slate-800/30 flex items-center justify-between">
                                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">交易历史 (Trade History)</h4>
                                <span className="text-[9px] text-slate-500 font-mono">LATEST {result.trades.length} TRADES</span>
                            </div>
                            <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                                <table className="w-full text-[10px] text-left border-collapse">
                                    <thead className="sticky top-0 bg-slate-900 text-slate-500 font-mono uppercase tracking-tighter border-b border-slate-800">
                                        <tr>
                                            <th className="p-2">时间</th>
                                            <th className="p-2">方向</th>
                                            <th className="p-2">盈亏 %</th>
                                            <th className="p-2">平仓原因</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/50">
                                        {result.trades.slice().reverse().map((trade, i) => (
                                            <tr key={i} className="hover:bg-slate-700/30 transition-colors">
                                                <td className="p-2 text-slate-400 font-mono">{new Date(trade.exitTime).toLocaleString()}</td>
                                                <td className={`p-2 font-bold ${trade.side === PositionSide.LONG ? 'text-emerald-500' : 'text-red-500'}`}>
                                                    {trade.side === PositionSide.LONG ? 'LONG' : 'SHORT'}
                                                </td>
                                                <td className={`p-2 font-mono ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                    {trade.pnl >= 0 ? '+' : ''}{trade.pnlPercent.toFixed(2)}%
                                                </td>
                                                <td className="p-2 text-slate-500 italic truncate max-w-[150px]" title={trade.reason}>
                                                    {trade.reason}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {!result && !loading && (
                <div className="flex flex-col items-center justify-center py-12 text-slate-600 space-y-3">
                    <BarChart2 size={48} strokeWidth={1} />
                    <p className="text-xs">配置参数并点击“开始回测”以查看历史表现</p>
                </div>
            )}
        </div>
    );
};

const StatCard = ({ label, value, icon: Icon, color, index }: { label: string, value: any, icon: any, color: string, index: number }) => (
    <motion.div 
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: index * 0.1 }}
        className="bg-slate-800/50 border border-slate-700 p-3 rounded-lg"
    >
        <div className="flex items-center gap-2 mb-1">
            <Icon size={12} className="text-slate-500" />
            <span className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">{label}</span>
        </div>
        <div className={`text-sm font-mono font-bold ${color}`}>{value}</div>
    </motion.div>
);
