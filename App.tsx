
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AppSettings, AccountData, Position, TradeLog, LogEntry, SystemEvent, PositionSide, SimulationSettings } from './types';
import { MarketSimulator } from './services/marketSimulator';
import Dashboard from './components/Dashboard';
import SettingsPanel from './components/SettingsPanel';
import { LogCenterModule } from './modules/log-center'; 
import TradeLogModal from './components/TradeLogModal';
import { ScannerDashboard } from './components/ScannerDashboard';
import { SaviorLab } from './components/SaviorLab';
import TrendHunterPanel from './components/TrendHunterPanel';
import UserManualModal from './components/UserManualModal';
import SourceCodeModal from './components/SourceCodeModal';
import SubscriptionModal from './components/SubscriptionModal';
import StrategyAdvisorWidget from './components/StrategyAdvisorWidget';
import { subscriptionService } from './services/subscriptionService';
import { fetchWithFallback } from './services/apiService'; 
import { audioService } from './services/audioService';
import { logger } from './services/monitor/monitorService';
import { MarketProvider } from './store/MarketContext';
import { BackgroundTimer } from './services/backgroundTask'; 
import { ErrorBoundary } from './components/ErrorBoundary';
import { usePersistedState } from './hooks/usePersistedState';
import { binanceWs } from './services/binanceWs';
import { normalizeSymbol, resolvePrice } from './services/symbolUtils';
import KlineChartModal from './components/KlineChartModal';
import { WifiOff, RefreshCw, ShieldAlert, Activity, Loader2, Zap, Clock, AlertTriangle, Trash2 } from 'lucide-react'; 

import { DEFAULT_SETTINGS } from './config/defaultSettings';

import { deepMerge, loadState, saveState } from './utils/persistence';

const arePositionsEqual = (prev: Position[], next: Position[]): boolean => {
    if (prev.length !== next.length) return false;
    for (let i = 0; i < prev.length; i++) {
        const p = prev[i];
        const n = next[i];
        if (
            p.entryId !== n.entryId ||
            p.symbol !== n.symbol ||
            p.side !== n.side ||
            p.amount !== n.amount ||
            p.entryPrice !== n.entryPrice ||
            p.markPrice !== n.markPrice ||
            p.unrealizedPnL !== n.unrealizedPnL ||
            p.isHedged !== n.isHedged ||
            p.mainPositionId !== n.mainPositionId ||
            p.isReopened !== n.isReopened ||
            p.reopenCount !== n.reopenCount ||
            p.cumulativeHedgeProfit !== n.cumulativeHedgeProfit ||
            p.cumulativeHedgeLoss !== n.cumulativeHedgeLoss ||
            p.cumulativeAmputationLoss !== n.cumulativeAmputationLoss ||
            p.maxPnLPercent !== n.maxPnLPercent ||
            JSON.stringify(p.customProfitSettings) !== JSON.stringify(n.customProfitSettings)
        ) {
            return false;
        }
    }
    return true;
};

const AppContent: React.FC = () => {

    const [settings, setSettings] = useState<AppSettings>(() => {
        try {
            console.log("[Boot] Loading settings...");
            logger.info('BOOT', '正在加载系统设置...');
            return loadState('SAVIOR_SETTINGS', DEFAULT_SETTINGS);
        } catch (e) {
            console.error("[Boot] Settings load crash", e);
            return DEFAULT_SETTINGS;
        }
    });

    const [account, setAccount] = useState<AccountData>(() => {
        try {
            console.log("[Boot] Loading account data...");
            return loadState('SAVIOR_ACCOUNT', { marginBalance: 10000, totalBalance: 10000, maintenanceMargin: 0, marginRatio: 999 });
        } catch (e) {
            console.error("[Boot] Account load crash", e);
            return { marginBalance: 10000, totalBalance: 10000, maintenanceMargin: 0, marginRatio: 999 };
        }
    });

    const [positions, setPositions] = useState<Position[]>(() => {
        try {
            console.log("[Boot] Loading positions...");
            const saved = loadState<Position[]>('SAVIOR_POSITIONS', []);
            if (!Array.isArray(saved)) return [];
            return saved
                .filter(p => p && typeof p === 'object' && p.symbol)
                .map(p => ({
                    ...p,
                    symbol: normalizeSymbol(p.symbol || '')
                }));
        } catch (e) {
            console.error("[Boot] Positions load crash", e);
            return [];
        }
    });

    const [logs, setLogs] = useState<LogEntry[]>(() => {
        try {
            console.log("[Boot] Loading logs...");
            const saved = loadState<LogEntry[]>('SAVIOR_LOGS', []);
            // Revive dates safely
            return saved.map(l => {
                if (!l || typeof l !== 'object') return null;
                return { ...l, timestamp: new Date(l.timestamp || Date.now()) };
            }).filter(Boolean) as LogEntry[];
        } catch (e) {
            console.error("[Boot] Logs load crash", e);
            return [];
        }
    });
    const [tradeLogs, setTradeLogs] = useState<TradeLog[]>(() => {
        try {
            console.log("[Boot] Loading trade logs...");
            const saved = loadState<TradeLog[]>('SAVIOR_TRADELOGS', []);
            if (!Array.isArray(saved)) return [];
            return saved.filter(l => l !== null && typeof l === 'object');
        } catch (e) {
            console.error("[Boot] Trade logs load crash", e);
            return [];
        }
    });
    const [systemEvents, setSystemEvents] = useState<SystemEvent[]>([]);
    const [realPrices, setRealPrices] = useState<Record<string, number>>({});
    const lastUiUpdateRef = useRef<number>(0);
    const priceBufferRef = useRef<Record<string, number>>({});
    const simulatorBootTimeRef = useRef<number>(Date.now());
    const [networkStatus, setNetworkStatus] = useState<'healthy' | 'delayed' | 'disconnected'>('disconnected');
    const [backtestPositions, setBacktestPositions] = useState<Position[]>([]);
    const [binanceRealPositions, setBinanceRealPositions] = useState<Position[]>([]);
    
    const handleBacktestPositionsUpdate = useCallback((newPos: Position[]) => {
        setBacktestPositions(prev => {
            if (JSON.stringify(prev) === JSON.stringify(newPos)) {
                return prev;
            }
            return newPos;
        });
    }, []);
    
    // Stabilize positions array to prevent infinite loops in effects
    const combinedPositions = React.useMemo(() => {
        if (settings.system.realTrading) {
            return positions;
        }
        return [...positions, ...backtestPositions];
    }, [settings.system.realTrading, positions, backtestPositions]);

    const logsPendingRef = useRef<LogEntry[]>([]);
    const lastLogUpdateRef = useRef<number>(0);

    const handleLog = useCallback((type: 'INFO' | 'SUCCESS' | 'WARNING' | 'DANGER', message: string) => {
        const newEntry: LogEntry = {
            id: Date.now().toString() + Math.random(),
            timestamp: new Date(),
            type,
            message
        };

        logsPendingRef.current.unshift(newEntry);
        
        const now = Date.now();
        // 如果距离上次更新不足 500ms，则缓冲（List 2 高频扫描时非常有用）
        if (now - lastLogUpdateRef.current > 500) {
            updateLogsFromBuffer();
        }
    }, []);

    const updateLogsFromBuffer = useCallback(() => {
        if (logsPendingRef.current.length === 0) return;
        
        const batch = [...logsPendingRef.current];
        logsPendingRef.current = [];
        lastLogUpdateRef.current = Date.now();

        setLogs(prev => [...batch, ...prev].slice(0, 300));
    }, []);

    // 补偿定时器：确保即便没有新日志进入，最后的缓冲日志也能被刷新
    useEffect(() => {
        const interval = setInterval(() => {
            simulatorRef.current?.verifyPositions(tradeLogs);
        }, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, [tradeLogs]);
    useEffect(() => {
        const timer = setInterval(() => {
            if (logsPendingRef.current.length > 0) {
                updateLogsFromBuffer();
            }
        }, 1000);
        return () => clearInterval(timer);
    }, [updateLogsFromBuffer]);

    const [isSimulating, setIsSimulating] = usePersistedState('SAVIOR_IS_SIMULATING', false);
    
    // --- SAFEGUARD: FORCE DISABLE SIMULATION IN REAL TRADING MODE ---
    useEffect(() => {
        if (settings.system.realTrading && isSimulating) {
            setIsSimulating(false);
            handleLog('WARNING', '⚠️ 当前已启用实盘交易模式！为了确保您的真实资金与交易绝对安全，系统已自动停用并锁定本地模拟仿真引擎。');
        }
    }, [settings.system.realTrading, isSimulating, setIsSimulating, handleLog]);
    const [showLogs, setShowLogs] = useState(true);
    const [showTradeLogModal, setShowTradeLogModal] = useState(false);
    const [tradeLogSearchSymbol, setTradeLogSearchSymbol] = useState<string>('');
    
    // --- STATE: UI Visibility (Persisted) ---
    const [showScanner, setShowScanner] = useState(() => {
        return localStorage.getItem('SCANNER_VISIBLE') === 'true';
    });
    const [saviorLabOpen, setSaviorLabOpen] = useState(false);
    const [saviorLabTab, setSaviorLabTab] = useState<'DNA' | 'BACKTEST'>('DNA');

    const openSaviorLab = (tab: 'DNA' | 'BACKTEST') => {
        setSaviorLabTab(tab);
        setSaviorLabOpen(true);
    };

    const [isInitializing, setIsInitializing] = useState(true);
    const [bootError, setBootError] = useState<string | null>(null);

    // --- MAIN MOUNTED FLAG & PANIC SELF-HEALING ---
    useEffect(() => {
        if (!isInitializing) {
            (window as any).__MAIN_APP_MOUNTED__ = true;
            console.log("🛡️ [System Guard] Main app successfully initialized and mounted. Clearing any false-alarm panic UI.");
            const panic = document.getElementById('panic-ui');
            if (panic) {
                panic.remove();
            }
        }
    }, [isInitializing]);

    // --- EMERGENCY TIMEOUT (8秒硬跳过) ---
    useEffect(() => {
        const timer = setTimeout(() => {
            if (isInitializing) {
                console.warn("⚠️ System initialization is taking too long. Forcing UI load...");
                setIsInitializing(false);
                handleLog('WARNING', '系统初始化超时，已切换至紧急强制启动模式');
            }
        }, 8000);
        return () => clearTimeout(timer);
    }, [isInitializing, handleLog]);

    // --- WEBSOCKET CONNECTION & AUTO-RECOVERY ---
    useEffect(() => {
        // @ts-ignore
        window.openPositionManual = async (symbol: string, side: PositionSide, qty: number) => {
            const cleanSymbol = normalizeSymbol(symbol);
            const isReal = settingsRef.current.system.realTrading;

            if (isReal) {
                const apiKey = settingsRef.current.system.binanceApiKey;
                const apiSecret = settingsRef.current.system.binanceApiSecret;
                if (!apiKey || !apiSecret) {
                    alert("错误: 实盘交易已开启，但未配置币安 API Key 或 Secret Key！");
                    if (simulatorRef.current) {
                        simulatorRef.current.addLog("DANGER", "手动开仓失败: 未配置实盘 API 密钥");
                    }
                    return;
                }

                if (simulatorRef.current) {
                    simulatorRef.current.addLog("INFO", `[实盘开仓] 正在向币安发送手动市价开仓请求: ${cleanSymbol} ${side} | 预估数量: ${qty.toFixed(4)}`);
                }

                try {
                    const response = await fetch("/api/binance/order", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            apiKey,
                            apiSecret,
                            symbol: cleanSymbol,
                            side: side,
                            action: "OPEN",
                            quantity: qty
                        })
                    });

                    const resData = await response.json();
                    if (response.ok && resData.success) {
                        if (simulatorRef.current) {
                            simulatorRef.current.addLog("SUCCESS", `⚡ [币安实盘] 手动开仓成功: ${cleanSymbol} ${side} | ID: ${resData.orderId}`);
                        }
                        audioService.speak("实盘开仓执行成功");

                        // Sync real-time positions instantly after order placement to show it immediately
                        if (typeof (window as any).triggerApiSync === "function") {
                            (window as any).triggerApiSync();
                        }
                    } else {
                        const errMsg = resData.error || "未知交易所错误";
                        if (simulatorRef.current) {
                            simulatorRef.current.addLog("DANGER", `⚡ [币安实盘] 手动开仓失败: ${errMsg}`);
                        }
                        alert(`币安实盘开仓失败:\n${errMsg}`);
                        audioService.speak("实盘开仓失败");
                    }
                } catch (e: any) {
                    if (simulatorRef.current) {
                        simulatorRef.current.addLog("DANGER", `⚡ [币安实盘] 手动开仓网络异常: ${e.message || e}`);
                    }
                    alert(`币安实盘开仓网络异常:\n${e.message || e}`);
                }
            } else {
                if (simulatorRef.current) {
                    let livePrice = simulatorRef.current.realPrices[cleanSymbol];
                    const noScaleSymbols = ['XMR', 'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'TRX', 'DOT', 'LTC', 'BCH', 'ETC', 'LINK'];
                    const isMajorCoin = noScaleSymbols.includes(cleanSymbol);
                    if (!livePrice) {
                        if (!isMajorCoin) {
                            if (cleanSymbol.startsWith('1000')) {
                                const base = cleanSymbol.replace(/^1000/, '');
                                if (simulatorRef.current.realPrices[base]) {
                                    livePrice = simulatorRef.current.realPrices[base] * 1000;
                                }
                            } else {
                                const scaled = '1000' + cleanSymbol;
                                if (simulatorRef.current.realPrices[scaled]) {
                                    livePrice = simulatorRef.current.realPrices[scaled] / 1000;
                                }
                            }
                        }
                    }
                    const finalPrice = livePrice && livePrice > 0 ? livePrice : 1;
                    const costUsdt = qty * finalPrice;
                    
                    const rawStrategyId = localStorage.getItem("SCANNER_SELECTED_STRATEGY_ID");
                    let activeStrategyId = "strat-1";
                    if (rawStrategyId) {
                        try {
                            activeStrategyId = JSON.parse(rawStrategyId);
                        } catch (e) {
                            activeStrategyId = rawStrategyId;
                        }
                    }

                    simulatorRef.current.openPosition(cleanSymbol, side, costUsdt, finalPrice, '1m', undefined, undefined, { 
                        isReopened: false,
                        strategyId: activeStrategyId 
                    });
                    setPositions([...simulatorRef.current.getPositions()]);
                }
            }
        };

        const initSystem = async () => {
            console.log("[Boot] Initializing system services...");
            try {
                // Ensure audio is ready
                await audioService.checkAndResume().catch((e) => {
                    console.warn("[Boot] Audio resume warning", e);
                    logger.warn('BOOT', '音频服务唤醒提醒', e.message);
                });
                console.log("[Boot] System initialized successfully.");
                logger.info('BOOT', '系统初始化成功，主引擎负载就绪');
                setIsInitializing(false);
            } catch (err) {
                console.error("[Boot] System boot failed:", err);
                logger.error('BOOT', '系统启动崩溃', err);
                setBootError(String(err));
            }
        };

        initSystem();

        let ws: WebSocket;
        let reconnectTimer: any;
        let isIntentionalClose = false;
        let hasConnectedOnce = false;

        const connectWebSocket = () => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(`${protocol}//${window.location.host}`);
            
            ws.onopen = () => {
                console.log('✅ Connected to Trading Engine Server');
                logger.info('WS', 'WebSocket 交易引擎已连接');
                
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
                logger.warn('WS', 'WebSocket 掉线，正在尝试自动重连...');
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
                console.warn('WebSocket connection status update:', error);
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
            // 1. Normalize for Internal Simulator
            const normalized: Record<string, number> = {};
            for (const s in newPrices) {
                normalized[normalizeSymbol(s)] = newPrices[s];
            }
            
            // 2. Update buffer for UI
            Object.assign(priceBufferRef.current, normalized);
            
            // 3. ALWAYS update simulator (logic thread)
            if (simulatorRef.current) {
                simulatorRef.current.updateRealPrices(normalized);
                
                // CRITICAL INSTANT-TICK:
                // Eliminate the 200ms loop delay. The very millisecond a price tick arrives from the WebSocket,
                // we instantly tick the simulator so it can recalculate PnL and match critical triggers (Stop Loss,
                // Take Profit, Hedge Boundaries, Trailing, Amputation) with ZERO delay!
                if (activePositionsRef.current.length > 0) {
                    try {
                        simulatorRef.current.tick(isSimulatingRef.current);
                    } catch (tickErr) {
                        console.error("[InstantTick] Error in instant simulator execution:", tickErr);
                    }
                }
            }

            // 4. THROTTLE UI UPDATE: Max ~3 times per second (300ms)
            // Provides extremely fluid, hyper-responsive visual momentum feedback without choking the UI thread
            const now = Date.now();
            if (now - lastUiUpdateRef.current > 300) {
                const snapshot = { ...priceBufferRef.current };
                setRealPrices(snapshot);
                lastUiUpdateRef.current = now;
            }
        });

        const unsubscribeStatus = binanceWs.subscribeStatus((status) => {
            const timeSinceLastMessage = Date.now() - status.lastMessageTime;
            // As long as we receive data (via WS or REST fallback) within 15s, engine handles it as healthy/delayed
            const isHealthy = timeSinceLastMessage < 15000;
            
            setNetworkStatus(prev => {
                let nextStatus: 'healthy' | 'delayed' | 'disconnected' = 'disconnected';
                if (status.isConnected && timeSinceLastMessage < 6000) nextStatus = 'healthy';
                else if (timeSinceLastMessage < 15000) nextStatus = 'delayed';
                else nextStatus = 'disconnected';
                return prev === nextStatus ? prev : nextStatus;
            });

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
    // Removed immediate localStorage.setItem('SAVIOR_SETTINGS', JSON.stringify(settings));

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

    const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

    // --- REFERENCES FOR STABLE BACKGROUND TASKS & CALLBACKS ---
    const settingsRef = useRef(settings);
    const accountRef = useRef(account);
    const positionsRef = useRef(positions);
    const logsRef = useRef(logs);
    const tradeLogsRef = useRef(tradeLogs);
    const systemEventsRef = useRef(systemEvents);
    const realPricesRef = useRef(realPrices);
    const isSimulatingRef = useRef(isSimulating);
    const showScannerRef = useRef(showScanner);
    const activePositionsRef = useRef(combinedPositions);

    // Keep refs in sync with latest state
    useEffect(() => {
        settingsRef.current = settings;
        accountRef.current = account;
        positionsRef.current = positions;
        logsRef.current = logs;
        tradeLogsRef.current = tradeLogs;
        systemEventsRef.current = systemEvents;
        realPricesRef.current = realPrices;
        isSimulatingRef.current = isSimulating;
        showScannerRef.current = showScanner;
        activePositionsRef.current = combinedPositions;
    }, [settings, account, positions, logs, tradeLogs, systemEvents, realPrices, isSimulating, showScanner, combinedPositions]);

    useEffect(() => {
        const handleOnline = () => { setIsOnline(true); handleLog('SUCCESS', '本地互联网已连接'); };
        const handleOffline = () => { setIsOnline(false); handleLog('DANGER', '本地互联网已断开，请检查网线或路由器'); };
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [handleLog]);


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

    // --- VISIBILITY HANDLER (Prevent Wake-up Crash & Sync UI) ---
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.hidden) {
                // Background
            } else {
                // Foreground: Reset timestamp to prevent "catch-up" burst
                lastTickTimestampRef.current = Date.now();
                console.log("👀 App Visible - Resumed active rendering & forcing instant UI sync");
                // Force an immediate UI synchronization from the simulator to get 100% correct positions list
                simulatorRef.current?.emitUpdate(true);
            }
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    }, []);

    // --- THE IMMORTAL LOOP LOGIC ---
    // Critical: No dependencies, uses Refs to ensure the timer always uses latest data
    const handleTick = useCallback(async () => {
        const now = Date.now();

        // 0. THROTTLE: 200ms loop
        const diff = now - lastTickTimestampRef.current;
        if (diff < 200 && diff >= 0) {
            return;
        }
        lastTickTimestampRef.current = now;

        // 1. CONCURRENCY CHECK
        if (isProcessingRef.current) {
            if (now - lastHeartbeatRef.current > 30000) {
                isProcessingRef.current = false;
            } else {
                return;
            }
        }
        
        isProcessingRef.current = true;
        lastHeartbeatRef.current = now;

        try {
            // 2. ENGINE TICK (Safeguarded)
            if (simulatorRef.current) {
                try {
                    // Update engine with latest prices before tick (Directly from priceBufferRef.current for sub-millisecond sync!)
                    simulatorRef.current.updateRealPrices(priceBufferRef.current);
                    simulatorRef.current.tick(isSimulatingRef.current);
                } catch (err) {
                    console.error("Simulator engine error:", err);
                }
            }

        } catch (fatalError) {
            console.error("FATAL LOOP ERROR:", fatalError);
        } finally {
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
            // PERFORMANCE: Guard state updates by checking for material changes
            // This prevents "depth exceeded" issues if updates are rapid
            setAccount(prev => {
                if (settingsRef.current.system.realTrading) {
                    const realPositions = activePositionsRef.current;
                    const totalUnrealizedPnL = realPositions.reduce((sum, p) => sum + (p.unrealizedPnL || 0), 0);
                    const realBalance = prev.binanceRealBalance || prev.marginBalance || 0;
                    const totalBalance = realBalance + totalUnrealizedPnL;
                    const maintMargin = realPositions.reduce((sum: number, p: any) => sum + (p.maintMargin || 0), 0);
                    const marginRatio = realBalance > 0 ? (maintMargin / realBalance * 100) : 0;
                    
                    return {
                        ...prev,
                        totalBalance,
                        unrealizedPnL: totalUnrealizedPnL,
                        marginBalance: realBalance,
                        binanceRealBalance: realBalance,
                        maintenanceMargin: maintMargin,
                        marginRatio: marginRatio
                    };
                }
                if (Math.abs(prev.marginBalance - newAccount.marginBalance) < 0.01 && 
                    prev.marginRatio === newAccount.marginRatio &&
                    prev.totalBalance === newAccount.totalBalance) {
                    return prev;
                }
                return { ...newAccount };
            });

            setPositions(prev => {
                const sanitized = newPositions.map(p => ({
                    ...p,
                    symbol: normalizeSymbol(p.symbol)
                }));
                
                // GUARDIAN: Prevent the simulator from accidentally wiping positions during a race OR stale data state
                // Only allow wiping if the user specifically cleared it (e.g. via batchClose)
                // We check if prev had data but new set is empty WITHOUT an explicit clear reason
                if (prev.length > 0 && sanitized.length === 0) {
                    const hasActiveTrade = newTradeLogs && newTradeLogs.length > 0 && newTradeLogs[0].status === 'CLOSED';
                    // If trade logs show no recent clear action, this might be a stale empty update
                    if (!hasActiveTrade && (Date.now() - simulatorBootTimeRef.current < 2000)) {
                        console.warn("[Guardian] Intercepted stale empty positions update during boot");
                        return prev;
                    }
                }

                // Compare to previous sanitized state to avoid useless renders
                if (arePositionsEqual(prev, sanitized)) {
                    return prev;
                }
                
                return sanitized;
            });

            setLogs(prev => {
                if (prev.length === newLogs.length && (prev.length === 0 || prev[0].timestamp === newLogs[0]?.timestamp)) return prev;
                return newLogs;
            });
            
            setTradeLogs(prev => {
                const incoming = newTradeLogs || [];
                
                // GUARDIAN: Prevent the simulator from accidentally wiping trade logs during a race
                if (prev.length > 0 && incoming.length === 0 && (Date.now() - simulatorBootTimeRef.current < 2000)) {
                    console.warn("[Guardian] Intercepted stale empty trade logs update during boot");
                    return prev;
                }

                // Deep check: If length is same AND last log (newest) has same timestamp and same sub-events count
                if (prev.length === incoming.length && prev.length > 0) {
                    const pLast = prev[0];
                    const iLast = incoming[0];
                    if (pLast.entry_id === iLast.entry_id && 
                        pLast.profit_usdt === iLast.profit_usdt && 
                        (pLast.events?.length || 0) === (iLast.events?.length || 0)) {
                        return prev;
                    }
                } else if (prev.length === 0 && incoming.length === 0) {
                    return prev;
                }

                return incoming;
            });

            setSystemEvents(prev => {
                const incoming = newEvents || [];
                if (prev.length === incoming.length && (prev.length === 0 || prev[0].id === incoming[0]?.id)) return prev;
                return incoming;
            });

            if(newRec) {
                setRecommendation(prev => {
                    if (JSON.stringify(prev) === JSON.stringify(newRec)) return prev;
                    return newRec;
                });
            }
        };

        // Create simulator with current boot state
        simulatorBootTimeRef.current = Date.now();
        simulatorRef.current = new MarketSimulator(
            accountRef.current, 
            positionsRef.current, 
            settingsRef.current, 
            updateCallback, 
            tradeLogsRef.current, 
            systemEventsRef.current, 
            logsRef.current
        );
        
        // Timer always calls the same handleTick wrapper
        timerRef.current = new BackgroundTimer(() => handleTick());
        timerRef.current.start();

        return () => {
            if (timerRef.current) timerRef.current.stop();
        };
    }, []); 

    // Important: Propagate settings changes to the engine
    useEffect(() => {
        if (simulatorRef.current) {
            simulatorRef.current.updateSettings(settings);
        }
    }, [settings]);

    // --- GLOBAL BINANCE BACKGROUND SYNC ---
    // Polls Binance Futures balance and positions every 8 seconds when realTrading is active.
    // This runs globally in the background so sync never stops when panels are closed!
    useEffect(() => {
        const apiKey = settings.system.binanceApiKey;
        const apiSecret = settings.system.binanceApiSecret;
        const isReal = settings.system.realTrading;

        if (!isReal || !apiKey || !apiSecret) {
            return;
        }

        const fetchRealState = async (silent = true) => {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout
                
                const response = await fetch("/api/binance/validate-and-balance", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ apiKey, apiSecret }),
                    signal: controller.signal
                });
                
                clearTimeout(timeout);
                
                if (response.ok) {
                    const data = await response.json();
                    if (data && data.success) {
                        const balance = data.marginBalance;
                        const realPositions = data.activePositions || [];
                        
                        if (simulatorRef.current) {
                            simulatorRef.current.updateRealBalance(balance);
                        }
                        
                        setAccount(prev => ({
                            ...prev,
                            binanceRealBalance: balance,
                            marginBalance: balance,
                            totalBalance: balance,
                            maintenanceMargin: realPositions.reduce((sum: number, p: any) => sum + (p.maintMargin || 0), 0),
                            marginRatio: realPositions.length > 0 ? (realPositions.reduce((sum: number, p: any) => sum + (p.maintMargin || 0), 0) / balance * 100) : 0
                        }));
                        
                        setBinanceRealPositions(realPositions);
                        
                        if (simulatorRef.current) {
                            simulatorRef.current.setPositions(realPositions);
                        }
                    } else {
                        console.error("[Binance Background Sync] API Error:", data);
                        if (data && data.code === -2015) {
                             handleLog('DANGER', '⚠️ 币安 API 密钥无效或权限不足！请检查是否已正确开启“期货交易 (Enable Futures)”权限，并检查 IP 限制。');
                        }
                    }
                } else {
                    const errorText = await response.text();
                    console.error("[Binance Background Sync] Request Failed:", response.status, errorText);
                }
            } catch (err) {
                console.error("[Binance Background Sync] Error:", err);
            }
        };

        // Expose a global function to trigger sync instantly
        (window as any).triggerApiSync = () => {
            console.log("[Binance Sync] Manual trigger received, syncing state instantly...");
            fetchRealState(true);
        };

        // Initial sync
        const timer = setTimeout(() => {
            fetchRealState(true);
        }, 1000);

        // Periodic sync every 8 seconds
        const interval = setInterval(() => {
            fetchRealState(true);
        }, 8000);

        return () => {
            clearTimeout(timer);
            clearInterval(interval);
            delete (window as any).triggerApiSync;
        };
    }, [settings.system.realTrading, settings.system.binanceApiKey, settings.system.binanceApiSecret]);

    const handleSettingsChange = (section: keyof AppSettings, key: string, value: any) => {
        setSettings(prev => ({
            ...prev,
            [section]: {
                ...prev[section],
                [key]: value
            }
        }));
    };

    const handleOpenPosition = useCallback(async (symbol: string, side: PositionSide, amount: number, price: number, signalTf?: string, signalCandle?: any, entryEmas?: any, extraProps?: Partial<Position>) => {
        const cleanSymbol = normalizeSymbol(symbol);
        const isReal = settingsRef.current.system.realTrading;

        if (isReal) {
            const apiKey = settingsRef.current.system.binanceApiKey;
            const apiSecret = settingsRef.current.system.binanceApiSecret;
            if (!apiKey || !apiSecret) {
                if (simulatorRef.current) {
                    simulatorRef.current.addLog("DANGER", `自动开仓拦截: 账户处于实盘交易模式，但未配置 API 密钥`);
                }
                return;
            }

            if (simulatorRef.current) {
                simulatorRef.current.addLog("INFO", `[实盘自动开仓] 策略/信号触发开仓: ${cleanSymbol} ${side} | 金额: ${amount} U`);
            }

            try {
                const response = await fetch("/api/binance/order", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        apiKey,
                        apiSecret,
                        symbol: cleanSymbol,
                        side: side,
                        action: "OPEN",
                        amountUsdt: amount
                    })
                });

                const resData = await response.json();
                if (response.ok && resData.success) {
                    if (simulatorRef.current) {
                        simulatorRef.current.addLog("SUCCESS", `⚡ [币安实盘] 自动开仓成功: ${cleanSymbol} ${side} | 数量: ${resData.qty} | ID: ${resData.orderId}`);
                    }
                    audioService.speak("实盘自动开仓成功");

                    // Sync real-time positions instantly after order placement to show it immediately
                    if (typeof (window as any).triggerApiSync === "function") {
                        (window as any).triggerApiSync();
                    }
                } else {
                    const errMsg = resData.error || "未知交易所错误";
                    if (simulatorRef.current) {
                        simulatorRef.current.addLog("DANGER", `⚡ [币安实盘] 自动开仓失败: ${errMsg}`);
                    }
                    audioService.speak("自动开仓失败");
                }
            } catch (e: any) {
                if (simulatorRef.current) {
                    simulatorRef.current.addLog("DANGER", `⚡ [币安实盘] 自动开仓发生网络异常: ${e.message || e}`);
                }
            }
        } else {
            simulatorRef.current?.openPosition(cleanSymbol, side, amount, price, signalTf, signalCandle, entryEmas, extraProps);
        }
    }, []);

    // @LOCKED: Manually closed state logic
const [manuallyClosedSymbols, setManuallyClosedSymbols] = useState<Set<string>>(new Set());

    const handleClosePosition = useCallback(async (symbol: string, side: PositionSide) => {
        const cleanSymbol = normalizeSymbol(symbol);
        setManuallyClosedSymbols(prev => new Set(prev).add(cleanSymbol));
        setTimeout(() => setManuallyClosedSymbols(prev => {
            const next = new Set(prev);
            next.delete(cleanSymbol);
            return next;
        }), 3000);

        const isReal = settingsRef.current.system.realTrading;
        if (isReal) {
            const apiKey = settingsRef.current.system.binanceApiKey;
            const apiSecret = settingsRef.current.system.binanceApiSecret;
            if (!apiKey || !apiSecret) {
                alert("错误: 实盘交易已开启，但未配置币安 API Key 或 Secret Key！");
                if (simulatorRef.current) {
                    simulatorRef.current.addLog("DANGER", "手动平仓失败: 未配置实盘 API 密钥");
                }
                return;
            }

            // Get position to close to find exact quantity from latest synced state
            const posToClose = binanceRealPositions.find(p => normalizeSymbol(p.symbol) === cleanSymbol && p.side === side);
            if (!posToClose) {
                alert("错误: 未在当前实盘持仓中找到该仓位！");
                return;
            }

            if (simulatorRef.current) {
                simulatorRef.current.addLog("INFO", `[实盘平仓] 正在向币安发送市价平仓请求: ${cleanSymbol} ${side} | 数量: ${posToClose.amount}`);
            }

            try {
                const response = await fetch("/api/binance/order", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        apiKey,
                        apiSecret,
                        symbol: cleanSymbol,
                        side: side,
                        action: "CLOSE",
                        quantity: posToClose.amount
                    })
                });

                const resData = await response.json();
                if (response.ok && resData.success) {
                    if (simulatorRef.current) {
                        simulatorRef.current.addLog("SUCCESS", `⚡ [币安实盘] 平仓成功: ${cleanSymbol} ${side} | ID: ${resData.orderId}`);
                    }
                    audioService.speak("实盘平仓执行成功");

                    // Sync real-time positions instantly after order placement to show it immediately
                    if (typeof (window as any).triggerApiSync === "function") {
                        (window as any).triggerApiSync();
                    }
                } else {
                    const errMsg = resData.error || "未知交易所错误";
                    if (simulatorRef.current) {
                        simulatorRef.current.addLog("DANGER", `⚡ [币安实盘] 平仓失败: ${errMsg}`);
                    }
                    alert(`币安实盘平仓失败:\n${errMsg}`);
                    audioService.speak("实盘平仓失败");
                }
            } catch (e: any) {
                if (simulatorRef.current) {
                    simulatorRef.current.addLog("DANGER", `⚡ [币安实盘] 平仓网络异常: ${e.message || e}`);
                }
                alert(`币安实盘平仓网络异常:\n${e.message || e}`);
            }
        } else {
            simulatorRef.current?.closePosition(cleanSymbol, side, 'MANUAL');
        }
    }, [binanceRealPositions]);

    const handleUpdateCustomSettings = useCallback((symbol: string, customSettings?: any) => {
        if (symbol === 'GLOBAL_MASTER_TOGGLE' || symbol === 'GLOBAL_CUSTODY_MODE') {
            setSettings(prev => {
                const next = {
                    ...prev,
                    profit: {
                        ...prev.profit,
                        ...customSettings
                    }
                };
                saveState('SAVIOR_SETTINGS', next);
                return next;
            });
            return;
        }

        if (symbol === 'GLOBAL_DEFAULT') {
            setSettings(prev => {
                const next = {
                    ...prev,
                    profit: {
                        ...prev.profit,
                        ...customSettings
                    }
                };
                saveState('SAVIOR_SETTINGS', next);
                return next;
            });
            return;
        }

        const cleanSymbol = normalizeSymbol(symbol);
        setPositions(prev => {
            const next = prev.map(p => p.symbol === cleanSymbol ? { ...p, customProfitSettings: customSettings } : p);
            localStorage.setItem('SAVIOR_POSITIONS', JSON.stringify(next));
            return next;
        });
        if (simulatorRef.current) {
            const simPositions = simulatorRef.current.getPositions();
            const updated = simPositions.map(p => p.symbol === cleanSymbol ? { ...p, customProfitSettings: customSettings } : p);
            simulatorRef.current.setPositions(updated);
            localStorage.setItem('SAVIOR_POSITIONS', JSON.stringify(updated));
        }
    }, []);

    const handleBatchOpen = (simSettings: SimulationSettings) => {
        simulatorRef.current?.openBatchPositions('BTCUSDT', 'RANDOM', 5, 100, false, 'BOTH', '24H', 10);
    };

    const handleVerifyPosition = (position: Position) => {
        simulatorRef.current?.verifyPosition(position, tradeLogs);
    };

    const handleApplyRecommendation = (rec: any) => {
        simulatorRef.current?.applyStrategyRecommendation(rec);
        setRecommendation(null);
    };

    // Periodic persistence
    useEffect(() => {
        const interval = setInterval(() => {
            if (isProcessingRef.current) return;
            saveState('SAVIOR_ACCOUNT', accountRef.current);
            saveState('SAVIOR_POSITIONS', positionsRef.current);
            saveState('SAVIOR_LOGS', logsRef.current, 150);
            saveState('SAVIOR_TRADELOGS', tradeLogsRef.current, 800);
            saveState('SAVIOR_SETTINGS', settingsRef.current);
        }, 5000);
        
        // Immediate persistence on unload
        const handleBeforeUnload = () => {
            saveState('SAVIOR_ACCOUNT', accountRef.current);
            saveState('SAVIOR_POSITIONS', positionsRef.current);
            saveState('SAVIOR_LOGS', logsRef.current, 150);
            saveState('SAVIOR_TRADELOGS', tradeLogsRef.current, 800);
            saveState('SAVIOR_SETTINGS', settingsRef.current);
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        
        return () => {
            clearInterval(interval);
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, []); // Run once at mount

    // --- NETWORK STATUS LOGGING & AUTO-RECOVERY ---
    const prevNetworkStatusRef = useRef(networkStatus);
    useEffect(() => {
        if (networkStatus !== prevNetworkStatusRef.current) {
            if (networkStatus === 'disconnected') {
                handleLog('DANGER', '行情连接已断开，系统正在尝试自动重连...');
                audioService.speak("警告，行情网络已断开，全域扫描已自动挂起", true);
                audioService.playAlert();
            } else if (networkStatus === 'healthy' && prevNetworkStatusRef.current === 'disconnected') {
                handleLog('SUCCESS', '行情连接已恢复正常');
                audioService.speak("网络已恢复", true);
            }
            prevNetworkStatusRef.current = networkStatus;
        }
    }, [networkStatus, handleLog]);

    // --- AUTO-REFRESH ON PROLONGED DISCONNECTION (REMOVED) ---
    // Prevented auto-reloading to avoid white screens when network is down. 
    // The system will just pause and wait for reconnection.

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

    if (bootError) {
        return (
            <div className="h-screen w-full bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
                <div className="p-4 bg-red-900/10 border border-red-500/20 rounded-2xl max-w-lg shadow-2xl backdrop-blur-xl">
                    <div className="bg-red-500/20 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 border border-red-500/30">
                        <ShieldAlert className="text-red-500" size={40} />
                    </div>
                    <h1 className="text-white font-black text-2xl mb-2 tracking-tighter">系统引导受阻 (BOOT SUSPENDED)</h1>
                    <p className="text-slate-400 text-sm mb-8 leading-relaxed">
                        检测到初始化异常。这通常是由极端网络环境或浏览器缓存溢出引起的。<br/>
                        <b>白屏修正对策已激活</b>：您可以选择重置扫描缓存或恢复出厂设置。
                    </p>
                    
                    <div className="flex flex-col gap-3">
                        <button 
                            onClick={() => { setBootError(null); setIsInitializing(false); }}
                            className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2 border border-slate-700"
                        >
                            <Zap size={18} className="text-amber-400" /> 继续运行 (忽略异常并尝试加载数据)
                        </button>
                        <button 
                            onClick={() => { 
                                // SAFE RESET: Only clears temporary scanner caches and main logs, but PRESERVES POSITIONS
                                const scannerKeys = Object.keys(localStorage).filter(k => k.startsWith('SCANNER_CACHE') || k.includes('CACHE_MAP'));
                                scannerKeys.forEach(k => localStorage.removeItem(k));
                                localStorage.removeItem('SAVIOR_LOGS');
                                window.location.reload(); 
                            }}
                            className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2 border border-slate-600"
                        >
                            <RefreshCw size={18} className="text-indigo-400" /> 安全清理缓存 (保留持仓与日志)
                        </button>
                        <button 
                            onClick={() => { 
                                if (window.confirm('⚠️ 警告：这将从浏览器中彻底擦除所有持仓记录和交易历史。确定吗？')) {
                                    localStorage.clear(); 
                                    window.location.reload(); 
                                }
                            }}
                            className="w-full py-3 bg-red-900/40 hover:bg-red-800 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2 border border-red-500/30 shadow-lg"
                        >
                            <Trash2 size={18} /> 深度重置 (清理所有持仓与流水)
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (isInitializing) {
        return (
            <div className="h-screen w-full bg-slate-950 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                        <Loader2 className="text-indigo-500 animate-spin" size={48} />
                        <Zap className="text-indigo-400 absolute inset-0 m-auto animate-pulse" size={20} />
                    </div>
                    <div className="text-indigo-500 font-mono text-xs tracking-widest animate-pulse">SYSTEM BOOTING...</div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-screen bg-slate-950 text-slate-200 overflow-hidden font-sans relative">
            
            <div className="w-80 border-r border-slate-800 flex-shrink-0">
                <SettingsPanel 
                    settings={settings} 
                    handleChange={handleSettingsChange}
                    onFactoryReset={() => {
                        if (window.confirm('🚨 确定要恢复出厂设置吗？\n警告：这将清空所有配置、持仓和交易记录，系统将彻底重启。')) {
                            localStorage.clear();
                            window.location.reload();
                        }
                    }}
                    onOpenScanner={() => setShowScanner(true)}
                    onToggleSim={() => setIsSimulating(!isSimulating)}
                    isSimulating={isSimulating}
                    previewData={[]}
                    systemStats={{ balance: account.totalBalance, positionCount: positions.length, tradeCount: tradeLogs.length, logCount: logs.length }}
                    onViewSource={() => setShowSourceCode(true)}
                    onOpenManual={() => setShowUserManual(true)}
                    onRestoreSettings={(s) => setSettings(prev => deepMerge(prev, s))}
                    onBatchOpen={handleBatchOpen}
                    onOpenSaviorLab={openSaviorLab}
                    onUpdateBinanceRealBalance={(balance, realPositions) => {
                        if (simulatorRef.current) {
                            simulatorRef.current.updateRealBalance(balance);
                        }
                        setAccount(prev => ({
                            ...prev,
                            binanceRealBalance: balance,
                            marginBalance: balance,
                            totalBalance: balance,
                            maintenanceMargin: realPositions ? realPositions.reduce((sum: number, p: any) => sum + (p.maintMargin || 0), 0) : 0,
                            marginRatio: realPositions && realPositions.length > 0 ? (realPositions.reduce((sum: number, p: any) => sum + (p.maintMargin || 0), 0) / balance * 100) : 0
                        }));
                        if (realPositions) {
                            setBinanceRealPositions(realPositions);
                        }
                    }}
                />
            </div>

            <div className="flex-1 flex flex-col min-w-0 relative">
                
                <div className="flex-1 overflow-auto p-2 pt-2"> 
                    <ErrorBoundary moduleName="交易主监控 (Main Tracker)">
                        <Dashboard 
                            account={account}
                            positions={combinedPositions}
                            tradeLogs={tradeLogs}
                            realPrices={realPrices}
                            networkStatus={networkStatus}
                            isOnline={isOnline}
                            onRowLongPress={() => {}}
                            onVerifyPosition={handleVerifyPosition}
                            onShowHistory={(symbol) => {
                                setTradeLogSearchSymbol(symbol);
                                setShowTradeLogModal(true);
                            }}
                            hasHistory={() => tradeLogs.length > 0}
                            manuallyClosedSymbols={manuallyClosedSymbols}
                            onClearPositions={() => {
                                simulatorRef.current?.batchCloseAllPositions();
                                if (simulatorRef.current) localStorage.setItem('SAVIOR_POSITIONS', JSON.stringify(simulatorRef.current.getPositions()));
                            }}
                            onClosePosition={handleClosePosition}
                            onDeletePosition={handleClosePosition}
                            onBatchClose={() => {
                                simulatorRef.current?.batchCloseAllPositions();
                                if (simulatorRef.current) localStorage.setItem('SAVIOR_POSITIONS', JSON.stringify(simulatorRef.current.getPositions()));
                            }}
                            onResetBalance={(amount) => simulatorRef.current?.resetMarginBalance(amount)}
                            onClearRecords={() => {
                                setTradeLogs([]);
                                setSystemEvents([]);
                                localStorage.removeItem('SAVIOR_TRADELOGS');
                                simulatorRef.current?.clearTradeLogs();
                                handleLog('SUCCESS', '交易流水记录已清空');
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
                            onUpdateCustomSettings={handleUpdateCustomSettings}
                        />
                    </ErrorBoundary>
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
                    networkStatus={networkStatus}
                    settings={settings.scanner} 
                    isVisible={showScanner}
                    onClose={() => setShowScanner(false)}
                    onOpenPosition={handleOpenPosition}
                    onClosePosition={handleClosePosition}
                    onBatchClose={() => {
                        simulatorRef.current?.batchCloseAllPositions();
                        if (simulatorRef.current) localStorage.setItem('SAVIOR_POSITIONS', JSON.stringify(simulatorRef.current.getPositions()));
                    }}
                    realPrices={realPrices}
                    activePositions={combinedPositions}
                    balance={account.marginBalance}
                    directMode={settings.system.directMode}
                    onLog={handleLog}
                    logs={logs}
                    onBacktestPositionsUpdate={handleBacktestPositionsUpdate}
                    isRealTrading={settings.system.realTrading}
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
                            setSystemEvents([]);
                            localStorage.removeItem('SAVIOR_TRADELOGS');
                            simulatorRef.current?.clearTradeLogs();
                            handleLog('SUCCESS', '交易历史记录已清空');
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
                    tradeLogs={tradeLogs} // Added this
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
            <SaviorLab 
                isOpen={saviorLabOpen} 
                onClose={() => setSaviorLabOpen(false)} 
                settings={settings}
                initialTab={saviorLabTab}
            />
        </div>
    );
};

const App: React.FC = () => {
    return (
        <ErrorBoundary moduleName="系统核心救世之星 (System Root)">
            <MarketProvider>
                <AppContent />
            </MarketProvider>
        </ErrorBoundary>
    );
};

export default App;
