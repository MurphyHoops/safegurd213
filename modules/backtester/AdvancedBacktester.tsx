
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
    Download, Play, Database, BarChart2, TrendingUp, History, 
    Activity, AlertCircle, Loader2, Calendar, Settings, Trash2,
    CheckCircle2, Clock, Layers
} from 'lucide-react';
import { 
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, 
    ResponsiveContainer, BarChart, Bar, Cell 
} from 'recharts';
import { AppSettings, PositionSide, KLine } from '../../types';
import { ScanConfig, ActionConfig, List3Config } from '../../components/Scanner/scannerTypes';
import { backtestDownloader } from '../../services/backtest/downloader';
import { backtestEngine } from '../../services/backtest/engine';
import { backtestDb } from '../../services/backtest/db';
import { BacktestUniverse } from './BacktestUniverse';
import { BacktestProvider } from './BacktestContext';

import { BacktestMarketScannerModule } from './mirrored/BacktestScannerUI';

interface Props {
    settings: AppSettings;
}

export const AdvancedBacktester: React.FC<Props> = ({ settings }) => {
    const [activeTab, setActiveTab] = useState<'config' | 'discovery' | 'data' | 'results' | 'logs'>('config');
    const [symbols, setSymbols] = useState<string>('BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,DOGEUSDT,XRPUSDT,ADAUSDT,MATICUSDT,DOTUSDT,LINKUSDT');
    const [selectedIntervals, setSelectedIntervals] = useState<string[]>(['1m', '5m', '15m', '1h']);
    const [speed, setSpeed] = useState(1);
    const [dateRange, setDateRange] = useState({
        start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0]
    });
    const [initialBalance, setInitialBalance] = useState(10000);
    
    const [downloading, setDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [running, setRunning] = useState(false);
    const [runProgress, setRunProgress] = useState(0);
    const [result, setResult] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [showUniverse, setShowUniverse] = useState(false);
    const [klinesMap, setKlinesMap] = useState<Record<string, Record<string, KLine[]>>>({});
    const [discoveryConfig, setDiscoveryConfig] = useState<ScanConfig>({ timeBasis: '24H', source: 'BOTH', minVolume: 1, maxVolume: 0, minChange: 1, customSymbols: '', useCustomOnly: false, batchSize: 40, limit: 520 });

    const handleDiscoveryBacktest = async (selectedSymbols: string[]) => {
        setSymbols(selectedSymbols.join(','));
        setDownloading(true);
        setError(null);
        try {
            const startTs = new Date(dateRange.start).getTime();
            const endTs = new Date(dateRange.end).getTime();

            let totalTasks = selectedSymbols.length * selectedIntervals.length;
            let completedTasks = 0;

            for (const s of selectedSymbols) {
                for (const interval of selectedIntervals) {
                    await backtestDownloader.downloadHistoricalData(s, interval, startTs, endTs, (p) => {
                        const currentProgress = ((completedTasks / totalTasks) * 100) + (p / totalTasks);
                        setDownloadProgress(currentProgress);
                    });
                    completedTasks++;
                }
            }
            
            // After download, start backtest
            setActiveTab('config');
            handleRun();
        } catch (err: any) {
            setError(err.message || '同步并启动失败');
        } finally {
            setDownloading(false);
            setDownloadProgress(0);
        }
    };

    const handleLaunchUniverse = async () => {
        setRunning(true);
        setError(null);
        try {
            const symbolList = symbols.split(',').map(s => s.trim().toUpperCase());
            const startTs = new Date(dateRange.start).getTime();
            const endTs = new Date(dateRange.end).getTime();

            const map: Record<string, Record<string, KLine[]>> = {};
            await backtestDb.init();
            
            for (const s of symbolList) {
                map[s] = {};
                for (const interval of selectedIntervals) {
                    const data = await backtestDb.getKLines(s, interval, startTs, endTs);
                    if (data.length > 0) {
                        map[s][interval] = data;
                    }
                }
            }

            // Check if we have data
            if (Object.keys(map).length === 0) {
                throw new Error("未找到本地历史数据，请先同步数据");
            }

            setKlinesMap(map);
            setShowUniverse(true);
        } catch (err: any) {
            setError(err.message || '启动仿真失败');
        } finally {
            setRunning(false);
        }
    };

    const handleDownload = async () => {
        setDownloading(true);
        setError(null);
        try {
            const symbolList = symbols.split(',').map(s => s.trim().toUpperCase());
            const startTs = new Date(dateRange.start).getTime();
            const endTs = new Date(dateRange.end).getTime();

            let totalTasks = symbolList.length * selectedIntervals.length;
            let completedTasks = 0;

            for (const s of symbolList) {
                for (const interval of selectedIntervals) {
                    await backtestDownloader.downloadHistoricalData(s, interval, startTs, endTs, (p) => {
                        const currentProgress = ((completedTasks / totalTasks) * 100) + (p / totalTasks);
                        setDownloadProgress(currentProgress);
                    });
                    completedTasks++;
                }
            }
            alert('数据同步完成');
        } catch (err: any) {
            setError(err.message || '下载失败');
        } finally {
            setDownloading(false);
            setDownloadProgress(0);
        }
    };

    const handleRun = async () => {
        setRunning(true);
        setError(null);
        setResult(null);
        try {
            const symbolList = symbols.split(',').map(s => s.trim().toUpperCase());
            const startTs = new Date(dateRange.start).getTime();
            const endTs = new Date(dateRange.end).getTime();

            // Load scanner config from localStorage or use defaults
            const scannerConfig = {
                list1: JSON.parse(localStorage.getItem('SCANNER_CONFIG_24H') || '{"minVolume":1,"minChange":1,"limit":50}'),
                list2: JSON.parse(localStorage.getItem('SCANNER_LIST2_CONFIG') || '{"maxLag":3,"volMultiplier":1.5,"squeezeThreshold":0.5,"maxAmplitude":5,"minBodyRatio":30,"checkEma80Conflict":true,"triggerMode":"NEW","enableFlatFilter":true,"flatLookback":20,"flatThreshold":10}'),
                list3: JSON.parse(localStorage.getItem('SCANNER_LIST3_CONFIG') || '{"lookback":80,"enableResonance":true}'),
                list4: JSON.parse(localStorage.getItem('SCANNER_LIST4_CONFIG') || '{"midlineThreshold":50,"breakoutThreshold":10,"enableThresholds":true,"enableAntiChase":true,"directionFilter":"BOTH"}')
            };

            const res = await backtestEngine.run({
                symbols: symbolList,
                intervals: selectedIntervals,
                startTime: startTs,
                endTime: endTs,
                initialBalance,
                settings,
                scannerConfig,
                speed
            }, (p) => setRunProgress(p));

            setResult(res);
            setActiveTab('results');
        } catch (err: any) {
            setError(err.message || '回测运行失败');
        } finally {
            setRunning(false);
            setRunProgress(0);
        }
    };

    const clearLocalData = async () => {
        if (window.confirm('确定要清空所有本地历史行情数据吗？')) {
            await backtestDb.init();
            await backtestDb.clearData();
            alert('数据已清空');
        }
    };

    return (
        <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl flex flex-col h-[700px]">
            {/* Header */}
            <div className="bg-slate-900/80 border-b border-slate-800 p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-500/20 rounded-lg">
                        <History className="text-amber-500" size={20} />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-white tracking-tight">全域扫描回测终端 v5.0</h3>
                        <p className="text-[10px] text-slate-500 font-mono uppercase tracking-widest">Scanner Pipeline Simulation & Financial Audit</p>
                    </div>
                </div>
                <div className="flex bg-slate-800 p-1 rounded-lg">
                    <TabButton active={activeTab === 'config'} onClick={() => setActiveTab('config')} icon={Settings} label="配置" />
                    <TabButton active={activeTab === 'discovery'} onClick={() => setActiveTab('discovery')} icon={Layers} label="初筛发现" />
                    <TabButton active={activeTab === 'data'} onClick={() => setActiveTab('data')} icon={Database} label="数据" />
                    <TabButton active={activeTab === 'results'} onClick={() => setActiveTab('results')} icon={BarChart2} label="结果" disabled={!result} />
                    <TabButton active={activeTab === 'logs'} onClick={() => setActiveTab('logs')} icon={Activity} label="日志" disabled={!result} />
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                <AnimatePresence mode="wait">
                    {activeTab === 'discovery' && (
                        <motion.div 
                            key="discovery"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            className="h-full flex flex-col"
                        >
                            <div className="mb-4 flex items-center justify-between">
                                <div>
                                    <h4 className="text-sm font-bold text-white">市场初筛发现 (Discovery Mode)</h4>
                                    <p className="text-[10px] text-slate-500">在实时行情中挑选币种，一键同步历史并开启回测流水线</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="text-[10px] text-slate-400 bg-slate-800 px-2 py-1 rounded border border-slate-700">
                                        回测区间: {dateRange.start} ~ {dateRange.end}
                                    </div>
                                </div>
                            </div>
                            <div className="flex-1 bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
                                <BacktestMarketScannerModule 
                                    scanConfig={discoveryConfig}
                                    setScanConfig={setDiscoveryConfig as any}
                                    onCandidatesUpdate={() => {}}
                                    setChartData={() => {}}
                                    onStartBacktest={handleDiscoveryBacktest}
                                    isSyncing={downloading}
                                />
                            </div>
                        </motion.div>
                    )}
                    {activeTab === 'config' && (
                        <motion.div 
                            key="config"
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                            className="space-y-6"
                        >
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-4">
                                    <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                        <Layers size={14} /> 扫描参数 (Pipeline Config)
                                    </h4>
                                    <div className="space-y-3">
                                        <InputGroup 
                                            label="回测币种 (20-50个建议)" 
                                            value={symbols} 
                                            onChange={setSymbols} 
                                            placeholder="BTCUSDT, ETHUSDT..."
                                        />
                                        <div>
                                            <label className="text-[10px] text-slate-500 block mb-1 uppercase font-bold">同步K线周期 (多选)</label>
                                            <div className="grid grid-cols-3 gap-2">
                                                {['1m', '3m', '5m', '15m', '30m', '1h'].map(tf => (
                                                    <button 
                                                        key={tf}
                                                        onClick={() => setSelectedIntervals(prev => prev.includes(tf) ? prev.filter(i => i !== tf) : [...prev, tf])}
                                                        className={`py-1 rounded text-[10px] font-bold border transition-all ${selectedIntervals.includes(tf) ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-500'}`}
                                                    >
                                                        {tf}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <InputGroup 
                                                label="初始资金 (U)" 
                                                type="number"
                                                value={initialBalance} 
                                                onChange={(v) => setInitialBalance(parseFloat(v))} 
                                            />
                                            <div>
                                                <label className="text-[10px] text-slate-500 block mb-1 uppercase font-bold">回测速度 (步进)</label>
                                                <select 
                                                    className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-xs text-white focus:border-indigo-500 outline-none transition-colors"
                                                    value={speed}
                                                    onChange={(e) => setSpeed(parseInt(e.target.value))}
                                                >
                                                    <option value={1}>逐K线 (最精准)</option>
                                                    <option value={5}>5x 步进</option>
                                                    <option value={15}>15x 步进</option>
                                                    <option value={60}>60x 步进 (极速)</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                        <Calendar size={14} /> 时间范围 (Time Range)
                                    </h4>
                                    <div className="grid grid-cols-1 gap-3">
                                        <InputGroup 
                                            label="开始日期" 
                                            type="date"
                                            value={dateRange.start} 
                                            onChange={(v) => setDateRange({...dateRange, start: v})} 
                                        />
                                        <InputGroup 
                                            label="结束日期" 
                                            type="date"
                                            value={dateRange.end} 
                                            onChange={(v) => setDateRange({...dateRange, end: v})} 
                                        />
                                    </div>
                                    <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                                        <p className="text-[10px] text-amber-300 leading-relaxed">
                                            <AlertCircle size={12} className="inline mr-1" />
                                            回测将模拟全域扫描终端的 6 级流水线逻辑。请确保已同步所有选中周期的历史数据，否则回测将跳过缺失部分。
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="pt-4 border-t border-slate-800 flex justify-end gap-3">
                                <button 
                                    onClick={handleLaunchUniverse}
                                    disabled={running || downloading}
                                    className="px-6 py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 text-white rounded-lg font-bold text-sm flex items-center gap-2 transition-all shadow-lg shadow-amber-900/20"
                                >
                                    <Activity size={18} />
                                    启动全仿真可视化回测
                                </button>
                                <button 
                                    onClick={handleRun}
                                    disabled={running || downloading}
                                    className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white rounded-lg font-bold text-sm flex items-center gap-2 transition-all shadow-lg shadow-indigo-900/20"
                                >
                                    {running ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
                                    {running ? `正在模拟扫描 ${runProgress.toFixed(0)}%` : '开始极速回测 (生成报告)'}
                                </button>
                            </div>
                        </motion.div>
                    )}

                    {activeTab === 'data' && (
                        <motion.div 
                            key="data"
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                            className="space-y-6"
                        >
                            <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl space-y-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h4 className="text-sm font-bold text-white">历史行情同步中心</h4>
                                        <p className="text-[10px] text-slate-500">同步 {symbols.split(',').length} 个币种的 {selectedIntervals.length} 个周期数据</p>
                                    </div>
                                    <button 
                                        onClick={clearLocalData}
                                        className="p-2 text-slate-500 hover:text-red-400 transition-colors"
                                        title="清空本地数据库"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>

                                <div className="space-y-4">
                                    <div className="p-4 bg-slate-950 rounded-lg border border-slate-800">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-[10px] text-slate-400 font-bold uppercase">总体同步进度</span>
                                            <span className="text-[10px] text-indigo-400 font-mono">{downloadProgress.toFixed(1)}%</span>
                                        </div>
                                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                            <motion.div 
                                                className="h-full bg-indigo-500"
                                                initial={{ width: 0 }}
                                                animate={{ width: `${downloadProgress}%` }}
                                            />
                                        </div>
                                    </div>

                                    <button 
                                        onClick={handleDownload}
                                        disabled={downloading || running}
                                        className="w-full py-3 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 text-white rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all"
                                    >
                                        {downloading ? <Loader2 size={18} className="animate-spin text-indigo-400" /> : <Download size={18} />}
                                        {downloading ? '正在同步海量数据...' : '同步所有选定币种与周期的历史数据'}
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <DataStat label="待同步币种" value={symbols.split(',').length} icon={CheckCircle2} />
                                <DataStat label="待同步周期" value={selectedIntervals.length} icon={Clock} />
                                <DataStat label="存储引擎" value="IndexedDB v2" icon={Database} />
                            </div>
                        </motion.div>
                    )}

                    {activeTab === 'results' && result && (
                        <motion.div 
                            key="results"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="space-y-6"
                        >
                            {/* Stats Cards */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <ResultCard label="净收益" value={`${result.stats.totalPnl.toFixed(2)} U`} sub="Net Profit" color={result.stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'} />
                                <ResultCard label="胜率" value={`${result.stats.winRate.toFixed(1)}%`} sub="Win Rate" color="text-indigo-400" />
                                <ResultCard label="最大回撤" value={`${result.stats.maxDrawdown.toFixed(2)}%`} sub="Max Drawdown" color="text-red-400" />
                                <ResultCard label="成交次数" value={result.stats.totalTrades} sub="Total Trades" color="text-slate-300" />
                            </div>

                            {/* Equity Chart */}
                            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[250px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={result.equityCurve}>
                                        <defs>
                                            <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                                                <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                        <XAxis dataKey="time" hide />
                                        <YAxis domain={['auto', 'auto']} stroke="#475569" fontSize={10} />
                                        <Tooltip 
                                            contentStyle={{ backgroundColor: '#020617', border: '1px solid #1e293b', fontSize: '10px' }}
                                            labelFormatter={(label) => new Date(label).toLocaleString()}
                                        />
                                        <Area type="monotone" dataKey="balance" stroke="#6366f1" fillOpacity={1} fill="url(#colorBalance)" strokeWidth={2} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Trade History */}
                            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                                <div className="p-3 border-b border-slate-800 bg-slate-800/30 flex items-center justify-between">
                                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">回测成交审计明细</h4>
                                    <span className="text-[9px] text-slate-500 font-mono">{result.trades.length} EXECUTIONS</span>
                                </div>
                                <div className="max-h-[200px] overflow-y-auto custom-scrollbar">
                                    <table className="w-full text-[10px] text-left">
                                        <thead className="sticky top-0 bg-slate-900 text-slate-500 font-mono uppercase border-b border-slate-800">
                                            <tr>
                                                <th className="p-2">时间</th>
                                                <th className="p-2">币种</th>
                                                <th className="p-2">方向</th>
                                                <th className="p-2">盈亏 %</th>
                                                <th className="p-2">原因</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800/50">
                                            {result.trades.slice().reverse().map((trade: any, i: number) => (
                                                <tr key={i} className="hover:bg-slate-800/50 transition-colors">
                                                    <td className="p-2 text-slate-500 font-mono">{new Date(trade.exitTime).toLocaleString()}</td>
                                                    <td className="p-2 text-slate-300 font-bold">{trade.symbol}</td>
                                                    <td className={`p-2 font-bold ${trade.side === 'LONG' ? 'text-emerald-500' : 'text-red-500'}`}>{trade.side}</td>
                                                    <td className={`p-2 font-mono ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                        {trade.pnl >= 0 ? '+' : ''}{trade.pnlPercent.toFixed(2)}%
                                                    </td>
                                                    <td className="p-2 text-slate-500 italic truncate max-w-[120px]">{trade.reason}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {activeTab === 'logs' && result && (
                        <motion.div 
                            key="logs"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden h-full flex flex-col"
                        >
                            <div className="p-3 border-b border-slate-800 bg-slate-800/30">
                                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">扫描引擎运行日志</h4>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-[10px] custom-scrollbar">
                                {result.logs.map((log: any, i: number) => (
                                    <div key={i} className="flex gap-3 border-b border-slate-800/30 pb-1">
                                        <span className="text-slate-600">[{new Date(log.time).toLocaleString()}]</span>
                                        <span className={log.type === 'SUCCESS' ? 'text-emerald-400' : log.type === 'WARNING' ? 'text-amber-400' : 'text-indigo-400'}>
                                            {log.message}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {error && (
                    <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-4 p-3 bg-red-900/20 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400 text-xs"
                    >
                        <AlertCircle size={14} />
                        {error}
                    </motion.div>
                )}
            </div>

            <AnimatePresence>
                {showUniverse && (
                    <BacktestProvider 
                        klinesMap={klinesMap} 
                        initialBalance={initialBalance} 
                        settings={settings}
                    >
                        <BacktestUniverse 
                            settings={settings}
                            klinesMap={klinesMap}
                            initialBalance={initialBalance}
                            onClose={() => setShowUniverse(false)}
                        />
                    </BacktestProvider>
                )}
            </AnimatePresence>
        </div>
    );
};

const TabButton = ({ active, onClick, icon: Icon, label, disabled = false }: any) => (
    <button 
        onClick={onClick}
        disabled={disabled}
        className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-[11px] font-bold transition-all ${
            active ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300 disabled:opacity-30'
        }`}
    >
        <Icon size={14} />
        {label}
    </button>
);

const InputGroup = ({ label, value, onChange, type = 'text', placeholder }: any) => (
    <div>
        <label className="text-[10px] text-slate-500 block mb-1 uppercase font-bold">{label}</label>
        <input 
            type={type}
            className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-xs text-white focus:border-indigo-500 outline-none transition-colors font-mono"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
        />
    </div>
);

const DataStat = ({ label, value, icon: Icon }: any) => (
    <div className="bg-slate-900/50 border border-slate-800 p-3 rounded-lg flex items-center gap-3">
        <div className="p-2 bg-slate-800 rounded">
            <Icon size={14} className="text-slate-400" />
        </div>
        <div>
            <div className="text-[9px] text-slate-500 uppercase font-bold">{label}</div>
            <div className="text-xs text-white font-mono">{value}</div>
        </div>
    </div>
);

const ResultCard = ({ label, value, sub, color }: any) => (
    <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
        <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">{label}</div>
        <div className={`text-lg font-mono font-bold ${color}`}>{value}</div>
        <div className="text-[9px] text-slate-600 font-mono mt-1">{sub}</div>
    </div>
);

const InfoIcon = ({ size, className }: any) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
);
