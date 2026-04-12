
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AppSettings, AccountData, Position, TradeLog, LogEntry, SystemEvent, PositionSide, KLine } from '../../types';
import Dashboard from '../../components/Dashboard';
import SettingsPanel from '../../components/SettingsPanel';
import { LogCenterModule } from '../log-center';
import { BacktestScannerDashboard } from './mirrored/BacktestScannerDashboard';
import { Play, Pause, SkipForward, RotateCcw, X, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useBacktest } from './BacktestContext';

interface BacktestUniverseProps {
    settings: AppSettings;
    klinesMap: Record<string, Record<string, KLine[]>>; // { symbol: { interval: KLine[] } }
    initialBalance: number;
    onClose: () => void;
}

export const BacktestUniverse: React.FC<BacktestUniverseProps> = ({ settings, klinesMap, initialBalance, onClose }) => {
    const {
        virtualTime, setVirtualTime,
        realPrices,
        account, setAccount,
        positions, setPositions,
        logs, setLogs,
        tradeLogs, setTradeLogs,
        isPlaying, setIsPlaying,
        speed, setSpeed,
        currentIndex, setCurrentIndex,
        totalSteps
    } = useBacktest();

    const symbols = Object.keys(klinesMap);
    const baseInterval = Object.keys(klinesMap[symbols[0]]).sort()[0];
    const baseKlines = klinesMap[symbols[0]][baseInterval];

    const [showScanner, setShowScanner] = useState(true);

    const timerRef = useRef<any>(null);

    // --- TICK LOGIC ---
    const handleTick = useCallback(() => {
        setCurrentIndex(prev => {
            if (prev >= totalSteps - 1) {
                setIsPlaying(false);
                return prev;
            }
            const next = Math.min(prev + speed, totalSteps - 1);
            const timestamp = baseKlines[next].time;
            setVirtualTime(timestamp);
            return next;
        });
    }, [speed, totalSteps, baseKlines, setIsPlaying, setVirtualTime, setCurrentIndex]);

    useEffect(() => {
        if (isPlaying) {
            timerRef.current = setInterval(handleTick, 100); // 10 ticks per second
        } else {
            clearInterval(timerRef.current);
        }
        return () => clearInterval(timerRef.current);
    }, [isPlaying, handleTick]);

    // --- HANDLERS ---
    const handleOpenPosition = (symbol: string, side: PositionSide, amount: number, price: number) => {
        const newPos: Position = {
            symbol,
            side,
            amount,
            entryPrice: price,
            markPrice: price,
            unrealizedPnL: 0,
            unrealizedPnLPercentage: 0,
            entryTime: virtualTime,
            isHedged: false,
            liquidationPrice: side === 'LONG' ? price * 0.95 : price * 1.05,
            entryId: Date.now().toString()
        };
        setPositions(prev => [...prev, newPos]);
        setLogs(prev => [{
            id: Date.now().toString(),
            timestamp: new Date(virtualTime),
            type: 'SUCCESS',
            message: `[回测] 开仓成功: ${symbol} ${side} @ ${price}`
        }, ...prev]);
    };

    const handleClosePosition = (symbol: string, side: PositionSide) => {
        setPositions(prev => {
            const pos = prev.find(p => p.symbol === symbol && p.side === side);
            if (pos) {
                const pnl = pos.unrealizedPnL;
                setAccount(acc => ({
                    ...acc,
                    totalBalance: acc.totalBalance + pnl,
                    marginBalance: acc.marginBalance + pnl
                }));
                setTradeLogs(logs => [...logs, {
                    symbol,
                    side,
                    entryPrice: pos.entryPrice,
                    exitPrice: pos.markPrice,
                    pnl,
                    pnlPercent: pos.unrealizedPnLPercentage,
                    exitTime: virtualTime,
                    reason: 'MANUAL'
                } as any]);
            }
            return prev.filter(p => !(p.symbol === symbol && p.side === side));
        });
    };

    return (
        <div className="fixed inset-0 z-[1000] bg-slate-950 text-slate-200 flex flex-col overflow-hidden font-sans">
            {/* Top Control Bar */}
            <div className="bg-slate-900 border-b border-slate-800 p-3 flex items-center justify-between shadow-xl">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-indigo-500/20 rounded-lg">
                            <Clock className="text-indigo-400" size={18} />
                        </div>
                        <div>
                            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">虚拟时间 (VIRTUAL TIME)</div>
                            <div className="text-xs font-mono text-white">{new Date(virtualTime).toLocaleString()}</div>
                        </div>
                    </div>
                    
                    <div className="h-8 w-px bg-slate-800" />

                    <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg p-1">
                        <button onClick={() => setCurrentIndex(0)} className="p-2 hover:bg-slate-800 rounded text-slate-400"><RotateCcw size={16}/></button>
                        <button onClick={() => setIsPlaying(!isPlaying)} className="p-2 bg-indigo-600 hover:bg-indigo-500 rounded text-white shadow-lg shadow-indigo-900/20">
                            {isPlaying ? <Pause size={16}/> : <Play size={16}/>}
                        </button>
                        <button onClick={handleTick} className="p-2 hover:bg-slate-800 rounded text-slate-400"><SkipForward size={16}/></button>
                        
                        <div className="h-6 w-px bg-slate-800 mx-1" />
                        
                        <select 
                            value={speed} 
                            onChange={(e) => setSpeed(parseInt(e.target.value))}
                            className="bg-transparent text-[10px] font-bold text-slate-400 outline-none px-2"
                        >
                            <option value={1}>1x 速度</option>
                            <option value={5}>5x 速度</option>
                            <option value={15}>15x 速度</option>
                            <option value={60}>60x 速度</option>
                        </select>
                    </div>

                    <div className="flex-1 max-w-xs">
                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-indigo-500 transition-all duration-300" 
                                style={{ width: `${(currentIndex / totalSteps) * 100}%` }}
                            />
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="text-right">
                        <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">回测净值 (EQUITY)</div>
                        <div className={`text-sm font-mono font-bold ${account.totalBalance >= initialBalance ? 'text-emerald-400' : 'text-red-400'}`}>
                            {account.totalBalance.toFixed(2)} USDT
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-red-900/50 rounded text-slate-400 hover:text-white transition-colors">
                        <X size={20}/>
                    </button>
                </div>
            </div>

            {/* Mirrored Main UI */}
            <div className="flex-1 flex overflow-hidden relative">
                <div className="w-80 border-r border-slate-800 flex-shrink-0 opacity-50 pointer-events-none">
                    <SettingsPanel 
                        settings={settings} 
                        handleChange={() => {}}
                        onFactoryReset={() => {}}
                        onOpenScanner={() => {}}
                        onToggleSim={() => {}}
                        isSimulating={true}
                        realPrices={realPrices}
                        previewData={[]}
                        systemStats={{ balance: account.totalBalance, positionCount: positions.length, tradeCount: tradeLogs.length, logCount: logs.length }}
                        onViewSource={() => {}}
                        onOpenManual={() => {}}
                        onRestoreSettings={() => {}}
                        onBatchOpen={() => {}}
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
                            onRowLongPress={() => {}}
                            onShowHistory={() => {}}
                            hasHistory={() => tradeLogs.length > 0}
                            onClearPositions={() => setPositions([])}
                            onClosePosition={handleClosePosition}
                            onDeletePosition={handleClosePosition}
                            onBatchClose={() => setPositions([])}
                            onResetBalance={() => {}}
                            onClearRecords={() => {}}
                            onOpenChart={() => {}}
                            onOpenLogs={() => {}}
                            onOpenTradeModal={() => {}}
                            isSimulating={true}
                            onToggleSimulation={() => {}}
                            onShowSymbolTradeLogs={() => {}}
                            globalAutoReopen={false}
                            onToggleLoop={() => {}}
                            onOpenScanner={() => setShowScanner(true)}
                            settings={settings}
                        />
                    </div>
                    <div className="h-48 border-t border-slate-800">
                        <LogCenterModule logs={logs} onOpenChart={() => {}} />
                    </div>
                </div>

                {/* Mirrored Scanner Dashboard */}
                <BacktestScannerDashboard 
                    settings={settings.scanner} 
                    isVisible={showScanner}
                    onClose={() => setShowScanner(false)}
                    onOpenPosition={handleOpenPosition}
                    onClosePosition={handleClosePosition}
                    realPrices={realPrices}
                    activePositions={positions}
                    balance={account.marginBalance}
                    directMode={settings.system.directMode}
                    onLog={(type, message) => {
                        setLogs(prev => [{
                            id: Date.now().toString() + Math.random(),
                            timestamp: new Date(virtualTime),
                            type,
                            message
                        }, ...prev]);
                    }}
                />
            </div>
        </div>
    );
};
