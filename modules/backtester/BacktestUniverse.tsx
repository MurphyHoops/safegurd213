import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Clock, FastForward, Rewind, Activity, BarChart3 } from 'lucide-react';
import { AppSettings, AccountData, Position, TradeLog, LogEntry } from '../../types';
import SettingsPanel from '../../components/SettingsPanel';
import Dashboard from '../../components/Dashboard';
import { ScannerDashboard } from '../../components/ScannerDashboard';
import { MarketProvider } from '../../store/MarketContext';
import { BacktestContext } from './BacktestContext';

interface Props {
    settings: AppSettings;
    onClose: () => void;
}

export const BacktestUniverse: React.FC<Props> = ({ settings, onClose }) => {
    const [backtestViewMode, setBacktestViewMode] = useState<'DASHBOARD' | 'SCANNER'>('DASHBOARD');
    const [isRunning, setIsRunning] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [currentTime, setCurrentTime] = useState(Date.now());
    const [progress, setProgress] = useState(0);

    const [account] = useState<AccountData>({ marginBalance: 10000, totalBalance: 10000, maintenanceMargin: 0, marginRatio: 999 });
    const [positions, setPositions] = useState<Position[]>([]);
    const [tradeLogs, setTradeLogs] = useState<TradeLog[]>([]);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [realPrices] = useState<Record<string, number>>({});

    const addLog = useCallback((type: LogEntry['type'], message: string) => {
        setLogs(prev => [{
            id: Date.now().toString() + Math.random(),
            timestamp: new Date(),
            type,
            message
        }, ...prev].slice(0, 300));
    }, []);

    useEffect(() => {
        if (!isRunning) return;
        const timer = setInterval(() => {
            setCurrentTime(t => t + 60_000 * speed);
            setProgress(p => Math.min(100, p + 0.05 * speed));
        }, 1000);
        return () => clearInterval(timer);
    }, [isRunning, speed]);

    const resetBacktest = () => {
        setIsRunning(false);
        setProgress(0);
        setCurrentTime(Date.now());
        setPositions([]);
        setTradeLogs([]);
        setLogs([]);
        addLog('INFO', '回测环境已重置');
    };

    return (
        <BacktestContext.Provider value={{
            isBacktest: true,
            currentTime,
            speed,
            setSpeed,
            isRunning,
            setIsRunning,
            progress
        } as any}>
            <MarketProvider>
                <div className="fixed inset-0 z-[100] bg-[#0b0e11] text-slate-200 flex flex-col">
                    <div className="h-14 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-950 shrink-0">
                        <div className="flex items-center gap-3">
                            <BarChart3 className="text-amber-400" size={20}/>
                            <div>
                                <div className="font-bold text-sm text-white">历史回测宇宙</div>
                                <div className="text-[10px] text-slate-500">Backtest Universe · 隔离运行环境</div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setBacktestViewMode('DASHBOARD')}
                                className={`px-3 py-1.5 rounded text-xs ${backtestViewMode === 'DASHBOARD' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'}`}
                            >
                                仪表盘
                            </button>
                            <button
                                onClick={() => setBacktestViewMode('SCANNER')}
                                className={`px-3 py-1.5 rounded text-xs ${backtestViewMode === 'SCANNER' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'}`}
                            >
                                扫描器
                            </button>
                            <button onClick={onClose} className="p-2 hover:bg-red-900/50 rounded text-slate-400 hover:text-white transition-colors">
                                <X size={20}/>
                            </button>
                        </div>
                    </div>

                    <div className="h-14 border-b border-slate-800 bg-slate-900/70 px-4 flex items-center gap-3 shrink-0">
                        <button
                            onClick={() => setIsRunning(v => !v)}
                            className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold"
                        >
                            {isRunning ? '暂停' : '开始'}
                        </button>
                        <button onClick={resetBacktest} className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs">重置</button>
                        <button onClick={() => setSpeed(Math.max(1, speed / 2))} className="p-1.5 bg-slate-800 rounded"><Rewind size={14}/></button>
                        <span className="text-xs font-mono w-10 text-center">{speed}x</span>
                        <button onClick={() => setSpeed(Math.min(64, speed * 2))} className="p-1.5 bg-slate-800 rounded"><FastForward size={14}/></button>
                        <div className="h-2 flex-1 bg-slate-800 rounded overflow-hidden ml-3">
                            <div className="h-full bg-amber-500" style={{ width: `${progress}%` }}/>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-slate-400 font-mono">
                            <Clock size={12}/>{new Date(currentTime).toLocaleString()}
                        </div>
                    </div>

                    <div className="flex-1 flex overflow-hidden relative bg-[#0b0e11]">
                        {backtestViewMode === 'DASHBOARD' ? (
                            <>
                                <div className="w-80 border-r border-slate-800 flex-shrink-0 opacity-50 pointer-events-none">
                                    <SettingsPanel 
                                        settings={settings} 
                                        handleChange={() => {}}
                                        onFactoryReset={() => {}}
                                        onOpenScanner={() => {}}
                                        onToggleSim={() => {}}
                                        isSimulating={true}
                                        previewData={[]}
                                        systemStats={{ balance: account.totalBalance, positionCount: positions.length, tradeCount: tradeLogs.length, logCount: logs.length }}
                                        onOpenManual={() => {}}
                                        onRestoreSettings={() => {}}
                                        onBatchOpen={() => {}}
                                        onOpenSaviorLab={() => {}}
                                    />
                                </div>

                                <div className="flex-1 flex flex-col min-w-0">
                                    <div className="flex-1 overflow-auto p-2">
                                        <Dashboard 
                                            account={account}
                                            positions={positions}
                                            tradeLogs={tradeLogs}
                                            realPrices={realPrices}
                                            networkStatus="healthy"
                                            isOnline={true}
                                            onRowLongPress={() => {}}
                                            onShowHistory={() => {}}
                                            hasHistory={() => false}
                                            onClearPositions={() => setPositions([])}
                                            onClosePosition={() => {}}
                                            onDeletePosition={() => {}}
                                            onBatchClose={() => setPositions([])}
                                            onClearRecords={() => setTradeLogs([])}
                                            onResetBalance={() => {}}
                                            onOpenChart={() => {}}
                                            onVerifyPosition={() => {}}
                                            onOpenLogs={() => {}}
                                            onOpenTradeModal={() => {}}
                                            isSimulating={true}
                                            onToggleSimulation={() => {}}
                                            onShowSymbolTradeLogs={() => {}}
                                            globalAutoReopen={false}
                                            onToggleLoop={() => {}}
                                            onOpenScanner={() => setBacktestViewMode('SCANNER')}
                                            settings={settings}
                                        />
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="flex-1 overflow-hidden">
                                <ScannerDashboard
                                    networkStatus="healthy"
                                    isOnline={true}
                                    settings={settings.scanner}
                                    isVisible={true}
                                    onClose={() => setBacktestViewMode('DASHBOARD')}
                                    onOpenPosition={() => {}}
                                    onClosePosition={() => {}}
                                    onBatchClose={() => {}}
                                    realPrices={realPrices}
                                    positions={positions}
                                    onLog={addLog}
                                    onOpenChart={() => {}}
                                    onShowTradeLogs={() => {}}
                                    onPositionsChange={setPositions}
                                    onTradeLogsChange={setTradeLogs}
                                />
                            </div>
                        )}
                    </div>

                    {isRunning && (
                        <div className="absolute bottom-4 right-4 flex items-center gap-2 px-3 py-2 bg-amber-950/80 border border-amber-500/30 rounded-lg text-amber-300 text-xs shadow-xl">
                            <Loader2 size={14} className="animate-spin"/>
                            回测时间正在推进
                        </div>
                    )}
                </div>
            </MarketProvider>
        </BacktestContext.Provider>
    );
};
