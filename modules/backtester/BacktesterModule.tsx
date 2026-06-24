
import React, { useState } from 'react';
import { Play, BarChart2, History, Settings, AlertCircle, Loader2, TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { BacktestService, BacktestResult } from '../../services/backtestService';
import { AppSettings } from '../../types';
import { motion, AnimatePresence } from 'motion/react';
import { BacktesterControls } from './components/BacktesterControls';
import { EquityCurveChart } from './components/EquityCurveChart';
import { TradeHistoryTable } from './components/TradeHistoryTable';
import { StatCard } from './components/StatCard';

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
            <BacktesterControls 
                symbol={symbol}
                interval={interval}
                limit={limit}
                loading={loading}
                setSymbol={setSymbol}
                setInterval={setInterval}
                setLimit={setLimit}
                onRunBacktest={runBacktest}
            />

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
                        <EquityCurveChart data={result.equityCurve} />

                        {/* Trade History Table */}
                        <TradeHistoryTable trades={result.trades} />
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
