
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AppSettings, AccountData, Position, TradeLog, LogEntry, SystemEvent, PositionSide, SimulationSettings } from './types';
import { MarketSimulator } from './services/marketSimulator';
import Dashboard from './components/Dashboard';
import SettingsPanel from './components/SettingsPanel';
import { LogCenterModule } from './modules/log-center'; 
import TradeLogModal from './components/TradeLogModal';
import { ScannerDashboard } from './components/ScannerDashboard';
import TrendHunterPanel from './components/TrendHunterPanel';
import UserManualModal from './components/UserManualModal';
import SourceCodeModal from './components/SourceCodeModal';
import SubscriptionModal from './components/SubscriptionModal';
import StrategyAdvisorWidget from './components/StrategyAdvisorWidget';
import { subscriptionService } from './services/subscriptionService';
import { fetchWithFallback } from './services/apiService'; 
import { audioService } from './services/audioService';
import { MarketProvider } from './store/MarketContext';
import { BackgroundTimer } from './services/backgroundTask'; 
import { ErrorBoundary } from './components/ErrorBoundary';
import { usePersistedState } from './hooks/usePersistedState';
import { binanceWs } from './services/binanceWs';
import KlineChartModal from './components/KlineChartModal';
import { WifiOff, RefreshCw, ShieldAlert, Activity, Loader2, Zap, Clock } from 'lucide-react'; 

const DEFAULT_SETTINGS: AppSettings = {
    profit: {
        enabled: true,
        profitMode: 'SMART',
        conventional: { minPosition: 100, profitPercent: 5, callbackPercent: 1, closePercent: 100 },
        dynamic: { minPosition: 100, tiers: [{ profit: 5, callback: 1, close: 50 }, { profit: 10, callback: 2, close: 100 }] },
        smart: { 
            minPosition: 100,
            activationProfit: 60, 
            conventionalEnabled: false, 
            tiers: [
                { threshold: 2, callback: 0.5, expiry: 5 },
                { threshold: 5, callback: 1, expiry: 10 },
                { threshold: 10, callback: 2, expiry: 20 },
                { threshold: 20, callback: 4, expiry: 40 },
                { threshold: 40, callback: 8, expiry: 60 }
            ]
        },
        global: { profitPercent: 0, lossPercent: 0, profitAmount: 0, lossAmount: 0 },
        stopLoss: { enabled: false, minPosition: 100, lossPercent: 5, closePercent: 100 }
    },
    hedging: {
        enabled: true,
        triggerLossPercent: 1,
        triggerLossEnabled: true,
        hedgeRatio: 100,
        minPosition: 10,
        safeClearEnabled: false,
        safeClearProfit: 10,
        safeClearLoss: 10,
        oscillationCheck: false,
        oscillationTimeWindow: 60,
        boxThreshold: 1,
        touchCount: 3,
        trendHedgeEnabled: false,
        trendHedgeEmaPeriod: 80,
        breakKLineEnabled: false,
        breakKLineRatio: 20
    },
    stopLoss: {
        hedgeProfitClear: false,
        hedgeOpenRatio: 150,
        hedgeCoverPercent: 10,
        hedgeProfitClearStopLoss: 2,
        callbackProfitClear: true,
        callbackHedgeRatio: 150,
        callbackCoverPercent: 10,
        callbackTargetProfit: 10,
        callbackRate: 2,
        callbackStopLoss: 2,
        amputationEnabled: false,
        amputationTriggerProfit: 2,
        amputationRatio: 50,
        amputationVictoryBuffer: 10,
        fuseEnabled: false,
        maxHedgeRetries: 3,
        fuseFailStopPercent: 30,
        advisor: { enabled: true, autoSwitch: false, minConfidence: 70 }
    },
    martingale: { enabled: false },
    system: { binanceApiKey: '', binanceApiSecret: '', directMode: true },
    scanner: {
        minVolume: 1, 
        maxVolume: 0,
        minChange: 1, 
        source: 'BOTH',
        timeBasis: '24H',
        limit: 520,   
        customSymbols: '',
        useCustomOnly: false,
        batchSize: 40
    },
    trendHunter: { enabled: false }
};

const AppContent: React.FC = () => {
    // --- PERSISTENCE HELPERS ---
    const deepMerge = (target: any, source: any): any => {
        if (source === null || source === undefined) return target;
        if (target === null || target === undefined) return source;
        
        if (typeof target !== typeof source) return target; // Type mismatch, keep target
        if (typeof target !== 'object') return source; // Both are primitives, overwrite
        if (Array.isArray(target) !== Array.isArray(source)) return target; // Mismatch, keep target
        if (Array.isArray(target)) return source; // Both are arrays, overwrite
        
        const output = { ...target };
        for (const key of Object.keys(source)) {
            if (source[key] === null || source[key] === undefined) {
                continue;
            } else if (key in target) {
                output[key] = deepMerge(target[key], source[key]);
            } else {
                output[key] = source[key];
            }
        }
        return output;
    };

    const loadState = <T,>(key: string, defaultVal: T): T => {
        try {
            const saved = localStorage.getItem(key);
            if (!saved) return defaultVal;
            const parsed = JSON.parse(saved);
            
            if (Array.isArray(defaultVal)) {
                return (Array.isArray(parsed) ? parsed : defaultVal) as T;
            }
            
            if (typeof defaultVal === 'object' && defaultVal !== null) {
                if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                    return defaultVal;
                }
                return deepMerge(defaultVal, parsed) as T;
            }
            
            return parsed;
        } catch (e) {
            console.warn(`Failed to load ${key}`, e);
            return defaultVal;
        }
    };

    const [settings, setSettings] = useState<AppSettings>(() => loadState('SAVIOR_SETTINGS', DEFAULT_SETTINGS));
    const [account, setAccount] = useState<AccountData>(() => loadState('SAVIOR_ACCOUNT', { marginBalance: 10000, totalBalance: 10000, maintenanceMargin: 0, marginRatio: 999 }));
    const [positions, setPositions] = useState<Position[]>(() => {
        const saved = loadState<Position[]>('SAVIOR_POSITIONS', []);
        return saved.filter(p => p !== null && typeof p === 'object');
    });
    const [logs, setLogs] = useState<LogEntry[]>(() => {
        const saved = loadState<LogEntry[]>('SAVIOR_LOGS', []);
        // Revive dates safely
        return saved.map(l => {
            if (!l || typeof l !== 'object') return null;
            return { ...l, timestamp: new Date(l.timestamp || Date.now()) };
        }).filter(Boolean) as LogEntry[];
    });
    const [tradeLogs, setTradeLogs] = useState<TradeLog[]>(() => {
        const saved = loadState<TradeLog[]>('SAVIOR_TRADELOGS', []);
        return saved.filter(l => l !== null && typeof l === 'object');
    });
    const [systemEvents, setSystemEvents] = useState<SystemEvent[]>([]);
    const [realPrices, setRealPrices] = useState<Record<string, number>>({});
    const [networkStatus, setNetworkStatus] = useState<'healthy' | 'delayed' | 'disconnected'>('disconnected');
    const [backtestPositions, setBacktestPositions] = useState<Position[]>([]);
    
    const [isSimulating, setIsSimulating] = usePersistedState('SAVIOR_IS_SIMULATING', false);
    const [showLogs, setShowLogs] = useState(true);
    const [showTradeLogModal, setShowTradeLogModal] = useState(false);
    const [tradeLogSearchSymbol, setTradeLogSearchSymbol] = useState<string>('');
    
    // --- STATE: UI Visibility (Persisted) ---
    const [showScanner, setShowScanner] = useState(() => {
        return localStorage.getItem('SCANNER_VISIBLE') === 'true';
    });

    // --- WEBSOCKET CONNECTION & AUTO-RECOVERY ---
    useEffect(() => {
        let ws: WebSocket;
        let reconnectTimer: any;
        let isIntentionalClose = false;
        let hasConnectedOnce = false;

        const connectWebSocket = () => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(`${protocol}//${window.location.host}`);
            
            ws.onopen = () => {
                console.log('✅ Connected to Trading Engine Server');
                
                // If we are reconnecting after a drop, just log it instead of reloading
                if (hasConnectedOnce) {
                    console.log('🔄 Server is back online. WebSocket reconnected.');
                }
                
                hasConnectedOnce = true;
                setLogs(prev => [{
                    id: `ws-open-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                    timestamp: new Date(),
                    type: 'SUCCESS',
                    message: '已连接到云端交易引擎 (WebSocket)'
                }, ...prev]);
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'SYSTEM') {
                        console.log('Server message:', data.message);
                    }
                } catch (e) {
                    console.error('Failed to parse WS message', e);
                }
            };

            ws.onclose = () => {
                if (isIntentionalClose) return;
                
                console.log('❌ Disconnected from Trading Engine Server. Attempting to reconnect...');
                setLogs(prev => [{
                    id: `ws-close-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                    timestamp: new Date(),
                    type: 'DANGER',
                    message: '与云端交易引擎断开连接，正在尝试重新连接...'
                }, ...prev]);
                
                // Try to reconnect every 3 seconds
                clearTimeout(reconnectTimer);
                reconnectTimer = setTimeout(connectWebSocket, 3000);
            };
            
            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                ws.close(); // Force close to trigger reconnect
            };
        };

        connectWebSocket();

        return () => {
            isIntentionalClose = true;
            clearTimeout(reconnectTimer);
            if (ws) ws.close();
        };
    }, []);

    // --- BINANCE WEBSOCKET SUBSCRIPTION ---
    useEffect(() => {
        const unsubscribePrices = binanceWs.subscribe((newPrices) => {
            if (activePositionsRef.current.length > 0 || showScannerRef.current) {
                setRealPrices(prev => ({ ...prev, ...newPrices }));
                if (simulatorRef.current) {
                    simulatorRef.current.updateRealPrices(newPrices);
                }
            }
        });

        const unsubscribeStatus = binanceWs.subscribeStatus((status) => {
            const timeSinceLastMessage = Date.now() - status.lastMessageTime;
            // Consider healthy if connected and last message was < 10s ago
            const isHealthy = status.isConnected && timeSinceLastMessage < 10000;
            
            if (!status.isConnected) {
                setNetworkStatus('disconnected');
            } else if (timeSinceLastMessage > 3000) {
                setNetworkStatus('delayed');
            } else {
                setNetworkStatus('healthy');
            }

            if (simulatorRef.current) {
                simulatorRef.current.updateNetworkStatus(isHealthy);
            }
        });

        return () => {
            unsubscribePrices();
            unsubscribeStatus();
        };
    }, []);

    // --- AUTO-MIGRATION FOR NEW DEFAULTS (One-time check) ---
    useEffect(() => {
        setSettings(prev => {
            const newStopLoss = { ...prev.stopLoss };
            let modified = false;

            // Check for old defaults and update to new requirements
            if (newStopLoss.hedgeOpenRatio === 100) {
                newStopLoss.hedgeOpenRatio = 150;
                modified = true;
            }
            if (newStopLoss.callbackHedgeRatio === 100) {
                newStopLoss.callbackHedgeRatio = 150;
                modified = true;
            }
            if (newStopLoss.amputationTriggerProfit === 50) {
                newStopLoss.amputationTriggerProfit = 2;
                modified = true;
            }
            
            // Only disable fuse if it looks like we are running on old defaults (modified is true)
            // AND it is currently enabled.
            if (modified && newStopLoss.fuseEnabled === true) {
                newStopLoss.fuseEnabled = false;
            }

            if (modified) {
                return { ...prev, stopLoss: newStopLoss };
            }
            return prev;
        });
    }, []);

    useEffect(() => {
        localStorage.setItem('SCANNER_VISIBLE', String(showScanner));
    }, [showScanner]);

    // Persist Settings on Change
    useEffect(() => {
        localStorage.setItem('SAVIOR_SETTINGS', JSON.stringify(settings));
    }, [settings]);

    const [showTrendHunter, setShowTrendHunter] = useState(false);
    const [showUserManual, setShowUserManual] = useState(false);
    const [showSourceCode, setShowSourceCode] = useState(false);
    const [showSubscription, setShowSubscription] = useState(false);
    const [chartSymbol, setChartSymbol] = useState<string | null>(null);
    const [chartEntryPrice, setChartEntryPrice] = useState<number | undefined>(undefined);
    const [chartEntryTime, setChartEntryTime] = useState<number | undefined>(undefined);
    const [chartTimeframe, setChartTimeframe] = useState<string>('15m');
    const [recommendation, setRecommendation] = useState<any>(null);

    const handleOpenChart = useCallback((symbol: string, entryPrice?: number, entryTime?: number, timeframe?: string) => {
        setChartSymbol(symbol);
        setChartEntryPrice(entryPrice);
        setChartEntryTime(entryTime);
        if (timeframe) setChartTimeframe(timeframe);
    }, []);

    // --- IMMORTAL NETWORK GUARD (防崩溃网络守护) ---
    // REMOVED: isNetworkPaused state to prevent any "paused" UI.
    const failCountRef = useRef(0);
    const lastAutoRetryRef = useRef(0);
    const lastTickTimestampRef = useRef(0); 
    const MAX_RETRIES = 5; 

    // --- CONCURRENCY LOCK (Prevents Task Stacking Crash) ---
    const isProcessingRef = useRef(false);
    const lastHeartbeatRef = useRef(Date.now()); // For Watchdog

    const simulatorRef = useRef<MarketSimulator | null>(null);
    const timerRef = useRef<BackgroundTimer | null>(null);
    
    // Refs for accessing latest state inside callbacks
    const isSimulatingRef = useRef(isSimulating);
    useEffect(() => { isSimulatingRef.current = isSimulating; }, [isSimulating]);

    const activePositionsRef = useRef(positions);
    useEffect(() => { activePositionsRef.current = positions; }, [positions]);

    const showScannerRef = useRef(showScanner);
    useEffect(() => { showScannerRef.current = showScanner; }, [showScanner]);

    const directModeRef = useRef(settings.system.directMode || false);
    useEffect(() => { directModeRef.current = settings.system.directMode || false; }, [settings.system.directMode]);

    // Manual or Auto Retry Handler
    const handleRetryConnection = () => {
        failCountRef.current = 0;
        lastAutoRetryRef.current = Date.now();
        audioService.checkAndResume(); 
        audioService.speak("正在尝试重连");
    };

    // --- WATCHDOG TIMER DISABLED (User Request: No Auto-Reset) ---
    // The system will now wait indefinitely if the main loop gets stuck.
    /*
    useEffect(() => {
        // ...
    }, []);
    */

    // --- VISIBILITY HANDLER (Prevent Wake-up Crash) ---
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.hidden) {
                // Background
            } else {
                // Foreground: Reset timestamp to prevent "catch-up" burst
                lastTickTimestampRef.current = Date.now();
                console.log("👀 App Visible - Resumed active rendering");
            }
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    }, []);

    // --- THE IMMORTAL LOOP LOGIC ---
    const handleTick = useCallback(async () => {
        const now = Date.now();

        // 0. THROTTLE & CLOCK SKEW PROTECTION
        const diff = now - lastTickTimestampRef.current;
        // Fix: If diff is negative (clock rollback), treat as valid interval to prevent freeze
        if (diff < 1000 && diff >= 0) {
            return;
        }
        lastTickTimestampRef.current = now;

        // 1. CONCURRENCY CHECK
        if (isProcessingRef.current) {
            if (now - lastHeartbeatRef.current > 30000) {
                console.warn("⚠️ [System] Watchdog: Loop stuck for 30s, forcing reset!");
                isProcessingRef.current = false;
            } else {
                return;
            }
        }
        
        isProcessingRef.current = true;
        lastHeartbeatRef.current = now; // Feeding the watchdog

        try {
            // 2. CIRCUIT BREAKER CHECK REMOVED
            // We no longer pause the network. We just retry endlessly.
            
            // 3. NORMAL OPERATION (Data Fetching) - Now handled by Binance WebSocket
            // The WebSocket updates `realPrices` and `simulatorRef.current` directly.
            // We just need to ensure the engine ticks.

            // 4. ENGINE TICK (Safeguarded)
            if (simulatorRef.current) {
                try {
                    simulatorRef.current.tick(isSimulatingRef.current);
                } catch (err) {
                    console.error("CRITICAL: Strategy Engine Error", err);
                    // Do not throw here, swallow engine error to keep app alive
                }
            }

        } catch (fatalError) {
            // This catches unexpected runtime errors in the loop itself
            console.error("FATAL LOOP ERROR:", fatalError);
        } finally {
            // ALWAYS release the lock, no matter what happens
            isProcessingRef.current = false;
        }
    }, []);

    // Initialize Simulator & Worker
    useEffect(() => {
        const updateCallback = (
            newAccount: AccountData, 
            newPositions: Position[], 
            newLogs: LogEntry[], 
            _hedgeRecord: any, 
            newTradeLogs: TradeLog[], 
            newEvents: SystemEvent[], 
            _notification: any, 
            newRec: any
        ) => {
            setAccount(newAccount);
            setPositions(newPositions);
            setLogs(newLogs);
            setTradeLogs(newTradeLogs || []);
            setSystemEvents(newEvents || []);
            if(newRec) setRecommendation(newRec);

            // --- PERSIST STATE ---
            localStorage.setItem('SAVIOR_ACCOUNT', JSON.stringify(newAccount));
            localStorage.setItem('SAVIOR_POSITIONS', JSON.stringify(newPositions));
            localStorage.setItem('SAVIOR_LOGS', JSON.stringify(newLogs));
            localStorage.setItem('SAVIOR_TRADELOGS', JSON.stringify(newTradeLogs || []));
        };

        simulatorRef.current = new MarketSimulator(
            account, 
            positions, 
            settings, 
            updateCallback, 
            tradeLogs, 
            systemEvents, 
            logs
        );
        
        timerRef.current = new BackgroundTimer(handleTick);
        timerRef.current.start();

        return () => {
            if (timerRef.current) timerRef.current.stop();
        };
    }, []); 

    const handleLog = useCallback((type: 'INFO' | 'SUCCESS' | 'WARNING' | 'DANGER', message: string) => {
        setLogs(prev => [{
            id: Date.now().toString() + Math.random(),
            timestamp: new Date(),
            type,
            message
        }, ...prev].slice(0, 200));
    }, []);

    const handleSettingsChange = (section: keyof AppSettings, key: string, value: any) => {
        setSettings(prev => ({
            ...prev,
            [section]: {
                ...prev[section],
                [key]: value
            }
        }));
    };

    const handleOpenPosition = useCallback((symbol: string, side: PositionSide, amount: number, price: number, signalTf?: string, signalCandle?: any, entryEmas?: any) => {
        simulatorRef.current?.openPosition(symbol, side, amount, price, signalTf, signalCandle, entryEmas);
    }, []);

    const handleClosePosition = useCallback((symbol: string, side: PositionSide) => {
        simulatorRef.current?.closePosition(symbol, side, 'MANUAL');
    }, []);

    const handleBatchOpen = (simSettings: SimulationSettings) => {
        simulatorRef.current?.openBatchPositions('BTCUSDT', 'RANDOM', 5, 100, false, 'BOTH', '24H', 10);
    };

    const handleApplyRecommendation = (rec: any) => {
        simulatorRef.current?.applyStrategyRecommendation(rec);
        setRecommendation(null);
    };

    // --- NETWORK STATUS LOGGING & AUTO-RECOVERY ---
    const prevNetworkStatusRef = useRef(networkStatus);
    useEffect(() => {
        if (networkStatus !== prevNetworkStatusRef.current) {
            if (networkStatus === 'disconnected') {
                handleLog('DANGER', '网络连接已断开，系统正在尝试自动重连...');
                audioService.speak("网络已断开");
            } else if (networkStatus === 'delayed') {
                handleLog('WARNING', '网络延迟较高，可能会影响交易执行速度');
            } else if (networkStatus === 'healthy' && prevNetworkStatusRef.current === 'disconnected') {
                handleLog('SUCCESS', '网络连接已恢复正常');
                audioService.speak("网络已恢复");
            }
            prevNetworkStatusRef.current = networkStatus;
        }
    }, [networkStatus, handleLog]);

    // --- AUTO-REFRESH ON PROLONGED DISCONNECTION ---
    useEffect(() => {
        let refreshTimer: any;
        if (networkStatus === 'disconnected') {
            // If disconnected for 2 minutes, reload the page as a last resort
            refreshTimer = setTimeout(() => {
                handleLog('DANGER', '网络长时间断开，系统将自动刷新页面以尝试恢复...');
                setTimeout(() => window.location.reload(), 2000);
            }, 120000);
        }
        return () => clearTimeout(refreshTimer);
    }, [networkStatus, handleLog]);

    // Update settings in simulator when they change in UI
    useEffect(() => {
        if(simulatorRef.current) {
            simulatorRef.current.updateSettings(settings);
        }
    }, [settings]);

    useEffect(() => {
        const status = subscriptionService.getLicenseStatus();
        if (!status.isActive) {
            setShowSubscription(true);
        }
    }, []);

    return (
        <div className="flex h-screen bg-slate-950 text-slate-200 overflow-hidden font-sans relative">
            
            <div className="w-80 border-r border-slate-800 flex-shrink-0">
                <SettingsPanel 
                    settings={settings} 
                    handleChange={handleSettingsChange}
                    onFactoryReset={() => setSettings(DEFAULT_SETTINGS)}
                    onOpenScanner={() => setShowScanner(true)}
                    onToggleSim={() => setIsSimulating(!isSimulating)}
                    isSimulating={isSimulating}
                    realPrices={realPrices}
                    previewData={[]}
                    systemStats={{ balance: account.totalBalance, positionCount: positions.length, tradeCount: tradeLogs.length, logCount: logs.length }}
                    onViewSource={() => setShowSourceCode(true)}
                    onOpenManual={() => setShowUserManual(true)}
                    onRestoreSettings={(s) => setSettings(prev => deepMerge(prev, s))}
                    onBatchOpen={handleBatchOpen}
                />
            </div>

            <div className="flex-1 flex flex-col min-w-0 relative">
                
                {/* Network Status Indicator */}
                <div 
                    onClick={() => {
                        binanceWs.forceReconnect();
                        handleLog('INFO', '手动触发网络重连...');
                    }}
                    className="absolute top-2 right-4 z-50 flex items-center gap-2 bg-slate-900/80 backdrop-blur-sm border border-slate-800 px-3 py-1.5 rounded-full shadow-lg cursor-pointer hover:bg-slate-800 transition-colors group"
                    title="点击强制重连网络"
                >
                    <div className={`w-2 h-2 rounded-full ${
                        networkStatus === 'healthy' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' :
                        networkStatus === 'delayed' ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)] animate-pulse' :
                        'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)] animate-pulse'
                    }`} />
                    <span className="text-[10px] font-mono font-medium text-slate-300 uppercase tracking-wider">
                        {networkStatus === 'healthy' ? 'Binance WS: OK' :
                         networkStatus === 'delayed' ? 'Binance WS: Delayed' :
                         'Binance WS: Disconnected'}
                    </span>
                    <RefreshCw size={10} className="text-slate-500 group-hover:text-indigo-400 transition-colors" />
                </div>

                <div className="flex-1 overflow-auto p-2 pt-2"> 
                    <Dashboard 
                        account={account}
                        positions={[...positions, ...backtestPositions]}
                        tradeLogs={tradeLogs}
                        realPrices={realPrices}
                        networkStatus={networkStatus}
                        onRowLongPress={() => {}}
                        onShowHistory={(symbol) => {
                            setTradeLogSearchSymbol(symbol);
                            setShowTradeLogModal(true);
                        }}
                        hasHistory={() => tradeLogs.length > 0}
                        onClearPositions={() => simulatorRef.current?.batchCloseAllPositions()}
                        onClosePosition={handleClosePosition}
                        onDeletePosition={handleClosePosition}
                        onBatchClose={() => simulatorRef.current?.batchCloseAllPositions()}
                        onResetBalance={(amount) => simulatorRef.current?.resetMarginBalance(amount)}
                        onClearRecords={() => {
                            setTradeLogs([]);
                            setLogs([]);
                            localStorage.removeItem('SAVIOR_TRADELOGS');
                            localStorage.removeItem('SAVIOR_LOGS');
                            simulatorRef.current?.clearTradeLogs();
                        }}
                        onOpenChart={handleOpenChart}
                        onOpenLogs={() => setShowLogs(!showLogs)}
                        onOpenTradeModal={() => {
                            setTradeLogSearchSymbol('');
                            setShowTradeLogModal(true);
                        }}
                        isSimulating={isSimulating}
                        onToggleSimulation={() => setIsSimulating(!isSimulating)}
                        onShowSymbolTradeLogs={(symbol) => {
                            setTradeLogSearchSymbol(symbol);
                            setShowTradeLogModal(true);
                        }}
                        globalAutoReopen={false}
                        onToggleLoop={() => {}}
                        onOpenScanner={() => setShowScanner(true)}
                        settings={settings}
                    />
                </div>
                {showLogs && (
                    <div className="h-48 border-t border-slate-800">
                        <LogCenterModule 
                            logs={logs} 
                            onOpenChart={handleOpenChart}
                        />
                    </div>
                )}
            </div>

            {/* KEEP-ALIVE SCANNER */}
            <ErrorBoundary moduleName="全域扫描终端 (Scanner Core)">
                <ScannerDashboard 
                    settings={settings.scanner} 
                    isVisible={showScanner}
                    onClose={() => setShowScanner(false)}
                    onOpenPosition={handleOpenPosition}
                    onClosePosition={handleClosePosition}
                    realPrices={realPrices}
                    activePositions={positions}
                    balance={account.marginBalance}
                    directMode={settings.system.directMode}
                    onLog={handleLog}
                    logs={logs}
                    onBacktestPositionsUpdate={setBacktestPositions}
                />
            </ErrorBoundary>
            
            {showTrendHunter && (
                <TrendHunterPanel
                    settings={settings.trendHunter}
                    positions={positions}
                    onUpdateSettings={(k, v) => handleSettingsChange('trendHunter', k as string, v)}
                    onClose={() => setShowTrendHunter(false)}
                    onExecute={(s, side, p, atr, auto) => handleOpenPosition(s, side, 100, p)}
                    onClosePosition={handleClosePosition}
                />
            )}

            {showTradeLogModal && (
                <TradeLogModal 
                    tradeLogs={tradeLogs} 
                    positions={positions}
                    systemEvents={systemEvents}
                    initialSearch={tradeLogSearchSymbol}
                    onClose={() => setShowTradeLogModal(false)} 
                    onOpenChart={handleOpenChart}
                    onClearHistory={() => {
                        if (window.confirm('确定要清空所有交易历史记录吗？此操作不可恢复。')) {
                            setTradeLogs([]);
                            localStorage.removeItem('SAVIOR_TRADELOGS');
                            simulatorRef.current?.clearTradeLogs();
                        }
                    }}
                />
            )}

            {showUserManual && <UserManualModal onClose={() => setShowUserManual(false)} />}
            {showSourceCode && <SourceCodeModal onClose={() => setShowSourceCode(false)} />}
            
            <SubscriptionModal 
                isOpen={showSubscription} 
                onSuccess={() => setShowSubscription(false)} 
                isLocked={!subscriptionService.getLicenseStatus().isActive}
                onClose={() => setShowSubscription(false)}
            />

            {chartSymbol && (
                <KlineChartModal
                    key={chartSymbol}
                    symbol={chartSymbol}
                    initialTimeframe={chartTimeframe}
                    onTimeframeChange={setChartTimeframe}
                    directMode={settings.system.directMode}
                    entryPrice={chartEntryPrice}
                    entryTime={chartEntryTime}
                    onClose={() => {
                        setChartSymbol(null);
                        setChartEntryPrice(undefined);
                        setChartEntryTime(undefined);
                    }}
                />
            )}

            <StrategyAdvisorWidget 
                recommendation={recommendation}
                onApply={handleApplyRecommendation}
                onIgnore={() => setRecommendation(null)}
            />
        </div>
    );
};

const App: React.FC = () => {
    return (
        <MarketProvider>
            <AppContent />
        </MarketProvider>
    );
};

export default App;
