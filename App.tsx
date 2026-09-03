
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
import { normalizeSymbol, resolvePrice, isMajorCoin } from './services/symbolUtils';
import KlineChartModal from './components/KlineChartModal';
import { FuseAlertModal, FuseAlertData } from './components/FuseAlertModal';
import { ActivationModal } from './components/ActivationModal';
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
            p.cumulativeAmputationProfit !== n.cumulativeAmputationProfit ||
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
            const savedSettings = loadState<any>('SAVIOR_SETTINGS', null);
            const isReal = savedSettings?.system?.realTrading;
            const key = isReal ? 'SAVIOR_ACCOUNT_LIVE' : 'SAVIOR_ACCOUNT_SIM';
            const fallbackKey = 'SAVIOR_ACCOUNT';
            return loadState(key, loadState(fallbackKey, { marginBalance: 10000, totalBalance: 10000, maintenanceMargin: 0, marginRatio: 999 }));
        } catch (e) {
            console.error("[Boot] Account load crash", e);
            return { marginBalance: 10000, totalBalance: 10000, maintenanceMargin: 0, marginRatio: 999 };
        }
    });

    const [positions, setPositions] = useState<Position[]>(() => {
        try {
            console.log("[Boot] Loading positions...");
            const savedSettings = loadState<any>('SAVIOR_SETTINGS', null);
            const isReal = savedSettings?.system?.realTrading;
            const key = isReal ? 'SAVIOR_POSITIONS_LIVE' : 'SAVIOR_POSITIONS_SIM';
            const fallbackKey = 'SAVIOR_POSITIONS';
            const saved = loadState<Position[]>(key, loadState<Position[]>(fallbackKey, []));
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
            const savedSettings = loadState<any>('SAVIOR_SETTINGS', null);
            const isReal = savedSettings?.system?.realTrading;
            const key = isReal ? 'SAVIOR_TRADELOGS_LIVE' : 'SAVIOR_TRADELOGS_SIM';
            const fallbackKey = 'SAVIOR_TRADELOGS';
            const saved = loadState<TradeLog[]>(key, loadState<TradeLog[]>(fallbackKey, []));
            if (!Array.isArray(saved)) return [];
            return saved.filter(l => l !== null && typeof l === 'object');
        } catch (e) {
            console.error("[Boot] Trade logs load crash", e);
            return [];
        }
    });
    const [isSystemActivated, setIsSystemActivated] = useState<boolean>(false);
    const [systemEvents, setSystemEvents] = useState<SystemEvent[]>([]);
    const [realPrices, setRealPrices] = useState<Record<string, number>>({});
    const lastUiUpdateRef = useRef<number>(0);
    const priceBufferRef = useRef<Record<string, number>>({});
    const simulatorBootTimeRef = useRef<number>(Date.now());
    const [networkStatus, setNetworkStatus] = useState<'healthy' | 'delayed' | 'disconnected'>('disconnected');
    const [backtestPositions, setBacktestPositions] = useState<Position[]>([]);
    const [binanceRealPositions, setBinanceRealPositions] = useState<Position[]>([]);
    
    const handleBacktestPositionsUpdate = useCallback((newPos: Position[]) => {
        setTimeout(() => {
            setBacktestPositions(prev => {
                if (JSON.stringify(prev) === JSON.stringify(newPos)) {
                    return prev;
                }
                return newPos;
            });
        }, 0);
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

    const updateLogsFromBuffer = useCallback(() => {
        if (logsPendingRef.current.length === 0) return;
        
        const batch = [...logsPendingRef.current];
        logsPendingRef.current = [];
        lastLogUpdateRef.current = Date.now();

        setLogs(prev => [...batch, ...prev].slice(0, 300));
    }, []);

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
            setTimeout(() => {
                updateLogsFromBuffer();
            }, 0);
        }
    }, [updateLogsFromBuffer]);

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
    const [fuseAlertData, setFuseAlertData] = useState<FuseAlertData | null>(null);

    // --- FUSE ALERT EVENT LISTENER ---
    useEffect(() => {
        const handleFuseAlert = (e: any) => {
            if (e.detail) {
                setFuseAlertData(e.detail);
            }
        };
        window.addEventListener('savior_fuse_alert', handleFuseAlert);
        return () => {
            window.removeEventListener('savior_fuse_alert', handleFuseAlert);
        };
    }, []);
    
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
        (window as any).__MAIN_APP_MOUNTED__ = true;
        console.log("🛡️ [System Guard] Main app successfully mounted. Clearing any false-alarm panic UI.");
        const panic = document.getElementById('panic-ui');
        if (panic) {
            panic.remove();
        }
    }, []);

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
        window.openPositionManual = async (symbol: string, side: PositionSide, qty: number, customPrice?: number, amountUsdt?: number, leverage?: number) => {
            const cleanSymbol = normalizeSymbol(symbol);
            const blacklist = settingsRef.current.system.symbolBlacklist || [];
            if (blacklist.includes(cleanSymbol)) {
                alert(`⚠️ 币种拦截: ${cleanSymbol} 处于黑名单中，拒绝手动开仓！`);
                if (simulatorRef.current) {
                    simulatorRef.current.addLog("WARNING", `⚠️ 手动开仓被拦截: ${cleanSymbol} 处于黑名单中`);
                }
                return;
            }
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
                    simulatorRef.current.addLog("INFO", `[实盘开仓] 正在向币安发送手动市价开仓请求: ${cleanSymbol} ${side} | 杠杆: ${leverage || 20}x | 预估金额: ${amountUsdt || (qty * (customPrice || 1))} U`);
                }

                try {
                    const reqBody: any = {
                        apiKey,
                        apiSecret,
                        symbol: cleanSymbol,
                        side: side,
                        action: "OPEN",
                        leverage: leverage || 20
                    };
                    
                    if (amountUsdt) {
                        reqBody.amountUsdt = amountUsdt;
                    } else {
                        reqBody.quantity = qty;
                    }

                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 12000);

                    const response = await fetch("/api/binance/order", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(reqBody),
                        signal: controller.signal
                    });
                    clearTimeout(timeoutId);

                    const resData = await response.json();
                    if (response.ok && resData.success) {
                        if (simulatorRef.current) {
                            if (resData.orderId) {
                                simulatorRef.current.registerExecutedOrderId(resData.orderId);
                            }
                            simulatorRef.current.addLog("SUCCESS", `⚡ [币安实盘] 手动开仓成功: ${cleanSymbol} ${side} | ID: ${resData.orderId}`);
                        }
                        audioService.speak("实盘开仓执行成功");

                        // Add manual log and optimistic position to simulator and React state immediately
                        if (simulatorRef.current) {
                            const finalPrice = resData.price || customPrice || priceBufferRef.current[cleanSymbol] || 0;
                            const finalCost = resData.cumQuote || amountUsdt || (qty * finalPrice);
                            const finalQty = resData.qty || qty || (finalCost / (finalPrice || 1));
                            const finalLev = resData.leverage || leverage || 20;
                            const entryId = resData.orderId ? `real_${cleanSymbol}_${side}_${resData.orderId}` : `real_manual_${cleanSymbol}_${side}_${Date.now()}`;

                            const manualLogItem: TradeLog = {
                                symbol: cleanSymbol,
                                entry_id: resData.orderId ? String(resData.orderId) : `MANUAL_${Date.now()}`,
                                binance_order_id: resData.orderId ? String(resData.orderId) : undefined,
                                status: 'OPEN',
                                is_hedge: false,
                                entry_timestamp: Date.now(),
                                direction: side,
                                cost_usdt: finalCost,
                                entry_price: finalPrice,
                                current_amount: finalQty,
                                events: [{
                                    timestamp: Date.now(),
                                    action: '主仓开仓',
                                    price: finalPrice,
                                    amount: finalQty,
                                    reason: '手动实盘开仓'
                                }]
                            };

                            const newRealPos: Position = {
                                symbol: cleanSymbol,
                                side: side,
                                amount: finalQty,
                                entryPrice: finalPrice,
                                markPrice: finalPrice,
                                liquidationPrice: 0,
                                unrealizedPnL: 0,
                                unrealizedPnLPercentage: 0,
                                entryId: entryId,
                                entryTime: Date.now(),
                                leverage: finalLev,
                                isManual: true,
                                isHedged: false,
                                reopenCount: 0
                            };

                            const curPositions = simulatorRef.current.getPositions();
                            const existingIdx = curPositions.findIndex(p => normalizeSymbol(p.symbol) === cleanSymbol && p.side === side);
                            let nextPositions: Position[];
                            if (existingIdx >= 0) {
                                nextPositions = [...curPositions];
                                nextPositions[existingIdx] = {
                                    ...nextPositions[existingIdx],
                                    amount: nextPositions[existingIdx].amount + finalQty,
                                    entryPrice: finalPrice,
                                    markPrice: finalPrice
                                };
                            } else {
                                nextPositions = [newRealPos, ...curPositions];
                            }

                            simulatorRef.current.tradeLogs.unshift(manualLogItem);
                            simulatorRef.current.setPositions(nextPositions);
                            setPositions(nextPositions);
                            setBinanceRealPositions(nextPositions);
                            setTradeLogs(prev => [manualLogItem, ...prev]);
                            simulatorRef.current.emitUpdate(true);
                        }

                        // Sync real-time positions instantly after order placement with cache bypass
                        if (typeof (window as any).triggerApiSync === "function") {
                            (window as any).triggerApiSync(true);
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
                    let livePrice = simulatorRef.current.realPrices[cleanSymbol] || customPrice;
                    const isMajorCoinVal = isMajorCoin(cleanSymbol);
                    if (!livePrice) {
                        if (!isMajorCoinVal) {
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
                        strategyId: activeStrategyId,
                        isManual: true
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
                // When active positions exist, tick immediately upon new price arrival for sub-millisecond trigger reaction!
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
            // As long as we receive data (via WS or REST fallback) within 60s, engine handles it as healthy/delayed
            const isHealthy = timeSinceLastMessage < 60000;
            
            setNetworkStatus(prev => {
                let nextStatus: 'healthy' | 'delayed' | 'disconnected' = 'disconnected';
                if (status.isConnected && timeSinceLastMessage < 20000) nextStatus = 'healthy';
                else if (timeSinceLastMessage < 60000) nextStatus = 'delayed';
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

    // --- VIP DEDICATED WEBSOCKET STREAMS FOR ACTIVE POSITIONS ---
    useEffect(() => {
        const symbols = combinedPositions.map(p => p.symbol).filter(Boolean);
        binanceWs.syncActivePositions(symbols);
    }, [combinedPositions]);

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

            const newSystem = { ...prev.system };
            const blacklist = newSystem.symbolBlacklist || [];
            if (!blacklist.includes('XMR')) {
                blacklist.push('XMR');
                modified = true;
            }
            if (!blacklist.includes('LIT')) {
                blacklist.push('LIT');
                modified = true;
            }
            newSystem.symbolBlacklist = blacklist;

            if (modified) {
                return { ...prev, stopLoss: newStopLoss, system: newSystem };
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
    const lastInstantTickTimeRef = useRef(0);
    const MAX_RETRIES = 5; 

    // --- CONCURRENCY LOCK (Prevents Task Stacking Crash) ---
    const isProcessingRef = useRef(false);
    const lastHeartbeatRef = useRef(Date.now()); // For Watchdog
    const lastBackgroundTimeRef = useRef(0);

    const simulatorRef = useRef<MarketSimulator | null>(null);
    const timerRef = useRef<BackgroundTimer | null>(null);
    
    // Latest refs for real trading automated execution
    const onRealHedgeRef = useRef<any>(null);
    const onRealCloseRef = useRef<any>(null);
    const onRealOpenRef = useRef<any>(null);
    const onRealReopenRef = useRef<any>(null);
    const pendingHedgesRef = useRef<Set<string>>(new Set());
    const pendingClosesRef = useRef<Set<string>>(new Set());
    const recentlyOpenedHedgesRef = useRef<Map<string, number>>(new Map());
    const recentlyClosedPositionsRef = useRef<Map<string, number>>(new Map());
    const recentlyOpenedPositionsRef = useRef<Map<string, number>>(new Map());
    const lastHedgeAttemptRef = useRef<Map<string, number>>(new Map());
    const lastAutoTransferTimeRef = useRef<number>(0);
    // 🔒 [第二层：前端自动补仓10秒防抖硬锁]
    const inFlightRefillRef = useRef<Map<string, number>>(new Map());
    
    // Manual or Auto Retry Handler
    const handleRetryConnection = () => {
        failCountRef.current = 0;
        lastAutoRetryRef.current = Date.now();
        audioService.checkAndResume(); 
        audioService.speak("正在尝试重连");
    };

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

    // --- MULTIDIMENSIONAL ACTIVE WATCHDOG & SELF-HEALING SYSTEM (多维自愈与卡停恢复监控系统) ---
    useEffect(() => {
        const watchdogInterval = setInterval(() => {
            const now = Date.now();
            const lastTick = lastTickTimestampRef.current;
            
            // 1. If still initializing or simulator not loaded, skip
            if (isInitializing || !simulatorRef.current) return;
            
            const secondsSinceLastTick = Math.round((now - lastTick) / 1000);
            
            // 2. Threshold for freeze detection: 15 seconds
            if (secondsSinceLastTick >= 15 && lastTick > 0) {
                // Determine potential freeze cause
                let reasons: string[] = [];
                
                if (isProcessingRef.current) {
                    reasons.push("并发处理锁 (Concurrency Lock) 被长期占用");
                }
                
                const timeSinceLastWsMsg = Math.round((now - binanceWs.lastMessageTime) / 1000);
                if (timeSinceLastWsMsg > 15) {
                    reasons.push(`行情接收中断 (自上次行情接收已过去 ${timeSinceLastWsMsg} 秒)`);
                }
                
                if (document.hidden) {
                    reasons.push("浏览器标签页处于后台挂起/休眠状态");
                } else {
                    reasons.push("后台定时器线程 (Web Worker) 或主循环遭遇异常阻塞");
                }
                
                const freezeReasonStr = reasons.join("、");
                
                // Print detailed alert in logs to let the user know what happened
                const diagnosticMsg = `⚠️ 检测到主运行循环异常卡停已达 ${secondsSinceLastTick} 秒！ [自愈系统激活] 卡停原因分析: ${freezeReasonStr}。系统正在执行深度热重启，保障策略持续监控...`;
                handleLog('WARNING', diagnosticMsg);
                if (simulatorRef.current) {
                    simulatorRef.current.addLog('WARNING', diagnosticMsg);
                }
                
                // 3. Perform Healing Actions
                // a. Release the concurrency lock
                isProcessingRef.current = false;
                lastHeartbeatRef.current = now;
                lastTickTimestampRef.current = now;
                
                // b. Re-initialize / Restart the Background Timer
                try {
                    console.log("♻️ Watchdog: Stopping stale background timer and restarting a new one...");
                    timerRef.current?.stop();
                    timerRef.current = new BackgroundTimer(() => handleTick());
                    timerRef.current.start();
                } catch (timerErr) {
                    console.error("♻️ Watchdog: Failed to restart background timer:", timerErr);
                }
                
                // c. Force Reconnect the WebSocket
                try {
                    console.log("♻️ Watchdog: Forcing reconnect on WebSocket connection...");
                    binanceWs.forceReconnect();
                } catch (wsErr) {
                    console.error("♻️ Watchdog: Failed to force WebSocket reconnect:", wsErr);
                }
                
                // d. Trigger immediate manual tick & sync
                try {
                    console.log("♻️ Watchdog: Executing manual instant recovery tick...");
                    handleTick();
                    simulatorRef.current?.emitUpdate(true);
                } catch (tickErr) {
                    console.error("♻️ Watchdog: Failed to execute immediate recovery tick:", tickErr);
                }
                
                const recoverSuccessMsg = `🟢 【自愈系统】热重启执行完毕。已强制清除死锁、重建定时器线程、强制重连 WebSocket 并补齐数据，引擎已重新恢复监控运行！`;
                handleLog('SUCCESS', recoverSuccessMsg);
                if (simulatorRef.current) {
                    simulatorRef.current.addLog('SUCCESS', recoverSuccessMsg);
                }
                
                audioService.speak("系统卡停已自动修复", true);
            }
        }, 10000); // Check every 10 seconds
        
        return () => clearInterval(watchdogInterval);
    }, [isInitializing, handleTick, handleLog]);

    // --- VISIBILITY HANDLER (Prevent Wake-up Crash & Sync UI) ---
    useEffect(() => {
        const handleVisibilityChange = () => {
            const now = Date.now();
            if (document.hidden) {
                // Background: KEEP the timer running so that safety monitoring (Hedge, Stop Loss, Take Profit) remains active!
                lastBackgroundTimeRef.current = now;
                console.log("💤 App Hidden - Entering background mode. Keeping safety engine active to protect positions.");
            } else {
                // Foreground: Reset timestamp to prevent "catch-up" burst
                const bgDurationMs = lastBackgroundTimeRef.current > 0 ? now - lastBackgroundTimeRef.current : 0;
                lastTickTimestampRef.current = now;
                lastBackgroundTimeRef.current = 0;
                
                console.log("👀 App Visible - Resumed active rendering & forcing instant UI sync");
                if (bgDurationMs > 5000) {
                    const bgMinutes = (bgDurationMs / 60000).toFixed(1);
                    const resumeMsg = `💤 检测到浏览器标签页曾进入后台运行模式 [状态恢复]: 持续时长 ${bgMinutes} 分钟。安全对齐引擎时间戳，主循环继续全速续航。`;
                    console.log(resumeMsg);
                    handleLog('INFO', resumeMsg);
                    if (simulatorRef.current) {
                        simulatorRef.current.addLog('INFO', resumeMsg);
                    }
                }
                
                // Force timer start just in case it was stopped
                timerRef.current?.start();
                // Force an immediate UI synchronization from the simulator to get 100% correct positions list
                simulatorRef.current?.emitUpdate(true);
            }
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    }, [handleLog]);

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
                const sanitized = newPositions.map(p => {
                    const existing = prev.find(ep => ep.entryId === p.entryId);
                    return {
                        ...p,
                        symbol: normalizeSymbol(p.symbol),
                        customProfitSettings: p.customProfitSettings || existing?.customProfitSettings
                    };
                });
                
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
                if (prev.length === newLogs.length && (prev.length === 0 || prev[0].id === newLogs[0]?.id)) return prev;
                return newLogs;
            });
            
            setTradeLogs(prev => {
                const incoming = newTradeLogs || [];
                
                // GUARDIAN: Prevent the simulator from accidentally wiping trade logs during a race
                if (prev.length > 0 && incoming.length === 0 && (Date.now() - simulatorBootTimeRef.current < 2000)) {
                    console.warn("[Guardian] Intercepted stale empty trade logs update during boot");
                    return prev;
                }

                // Deep check: If length is same AND every log has same status, id, hedge flag, and pnl
                if (prev.length === incoming.length && prev.length > 0) {
                    const isIdentical = prev.every((p, idx) => {
                        const i = incoming[idx];
                        return i &&
                               p.entry_id === i.entry_id && 
                               p.status === i.status &&
                               p.is_hedge === i.is_hedge &&
                               p.main_entry_id === i.main_entry_id &&
                               p.binance_order_id === i.binance_order_id &&
                               p.profit_usdt === i.profit_usdt && 
                               (p.events?.length || 0) === (i.events?.length || 0);
                    });
                    if (isIdentical) return prev;
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
        const sim = new MarketSimulator(
            accountRef.current, 
            positionsRef.current, 
            settingsRef.current, 
            updateCallback, 
            tradeLogsRef.current, 
            systemEventsRef.current, 
            logsRef.current
        );

        // Link real trading automated execution callbacks via refs to prevent stale closure issues
        sim.onRealHedge = async (pos, side, amountUsdt, reason, exactQty) => {
            if (onRealHedgeRef.current) {
                await onRealHedgeRef.current(pos, side, amountUsdt, reason, exactQty);
            }
        };
        sim.onRealClose = async (pos, reason, customAmount, ratio) => {
            if (onRealCloseRef.current) {
                await onRealCloseRef.current(pos, reason, customAmount, ratio);
            }
        };
        sim.onRealOpen = async (pos, quantity, reason) => {
            if (onRealOpenRef.current) {
                await onRealOpenRef.current(pos, quantity, reason);
            }
        };
        sim.onRealReopen = async (symbol, side, amountUsdt, reason, extraProps) => {
            if (onRealReopenRef.current) {
                await onRealReopenRef.current(symbol, side, amountUsdt, reason, extraProps);
            }
        };

        simulatorRef.current = sim;
        
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

    // --- ⚡ REAL-TIME BINANCE USER DATA STREAM (Instant Trade Execution WebSocket) ---
    useEffect(() => {
        const apiKey = settings.system.binanceApiKey;
        const isReal = settings.system.realTrading;

        if (!isReal || !apiKey) {
            return;
        }

        // 1. Tell backend to initialize user data stream for this apiKey
        fetch("/api/binance/user-stream/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ apiKey })
        }).catch(err => console.warn("[User Stream Start Error]:", err));

        // 2. Connect to backend WebSocket to receive instant BINANCE_ORDER_TRADE_UPDATE events
        let ws: WebSocket | null = null;
        let reconnectTimer: any = null;
        let isClosed = false;

        const connectStreamWs = () => {
            if (isClosed) return;
            try {
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const wsUrl = `${protocol}//${window.location.host}`;
                ws = new WebSocket(wsUrl);

                ws.onopen = () => {
                    console.log("⚡ [Binance UserStream WS] Connected to backend real-time stream");
                    try {
                        ws?.send(JSON.stringify({ type: "REGISTER_BINANCE_API", apiKey }));
                    } catch (e) {}
                };

                ws.onmessage = (event) => {
                    try {
                        const msg = JSON.parse(event.data);
                        if (msg.type === "BINANCE_ORDER_TRADE_UPDATE" && msg.data) {
                            const tradeData = msg.data;
                            console.log("⚡ [Binance Instant Execution]:", tradeData);
                            if (simulatorRef.current) {
                                simulatorRef.current.handleInstantBinanceTrade(tradeData);
                                setTradeLogs([...simulatorRef.current.tradeLogs]);
                                tradeLogsRef.current = [...simulatorRef.current.tradeLogs];
                                setPositions([...simulatorRef.current.getPositions()]);
                                setBinanceRealPositions([...simulatorRef.current.getPositions()]);
                            }
                            
                            // 收到平仓事件后，触发真实持仓对账同步，确保持仓数量与交易所完全一致
                            if (typeof (window as any).triggerApiSync === "function") {
                                (window as any).triggerApiSync();
                            }
                        } else if (msg.type === "BINANCE_ACCOUNT_UPDATE" && msg.data) {
                            const accData = msg.data;
                            console.log("⚡ [Binance Instant Account Update]:", accData);
                            if (simulatorRef.current) {
                                simulatorRef.current.handleInstantAccountUpdate(accData);
                                setPositions([...simulatorRef.current.getPositions()]);
                                setBinanceRealPositions([...simulatorRef.current.getPositions()]);
                            }
                        }
                    } catch (e) {}
                };

                ws.onerror = () => {
                    try { ws?.close(); } catch (e) {}
                };

                ws.onclose = () => {
                    if (!isClosed) {
                        reconnectTimer = setTimeout(connectStreamWs, 3000);
                    }
                };
            } catch (err) {
                if (!isClosed) {
                    reconnectTimer = setTimeout(connectStreamWs, 3000);
                }
            }
        };

        connectStreamWs();

        return () => {
            isClosed = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            if (ws) {
                try { ws.close(); } catch (e) {}
            }
        };
    }, [settings.system.binanceApiKey, settings.system.realTrading]);

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

        let isSyncing = false;
        let rateLimitBackoffUntil = 0;

        const fetchRealState = async (silent = true, force = false) => {
            if (isSyncing && !force) return;
            if (Date.now() < rateLimitBackoffUntil && !force) {
                return;
            }

            isSyncing = true;
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 35000); // 35s timeout to allow multi-node server fallback (up to 30s)
                
                const response = await fetch("/api/binance/validate-and-balance", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ apiKey, apiSecret, force }),
                    signal: controller.signal
                });
                
                clearTimeout(timeout);
                
                if (response.ok) {
                    const text = await response.text();
                    if (text.trim().startsWith('<') || text.toLowerCase().includes('doctype html')) {
                        console.warn("[Binance Background Sync] Received HTML error page instead of JSON. Server might be restarting or unresponsive.");
                        return;
                    }
                    const data = JSON.parse(text);
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

                        // --- 🔒 REAL TRADES RECONCILIATION FROM BINANCE (userTrades) ---
                        // Fetch official executed trades from Binance to reconcile logs & debt pool
                        try {
                            const recentLogSymbols = simulatorRef.current 
                                ? simulatorRef.current.tradeLogs.slice(0, 15).map(l => l.symbol).filter(Boolean)
                                : [];
                            const activeSymbols = Array.from(new Set([
                                ...realPositions.map((p: any) => p.symbol),
                                ...recentLogSymbols
                            ].filter(Boolean)));

                            if (activeSymbols.length > 0) {
                                const tradeResp = await fetch("/api/binance/user-trades", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                        apiKey,
                                        apiSecret,
                                        symbols: activeSymbols,
                                        startTime: Math.max(
                                            simulatorRef.current?.clearedTradeLogsTimestamp || 0,
                                            Date.now() - 1800000 // 30 minutes max lookback
                                        ),
                                        limit: 20
                                    })
                                });
                                if (tradeResp.ok) {
                                    const tradeJson = await tradeResp.json();
                                    if (tradeJson && tradeJson.success && Array.isArray(tradeJson.trades)) {
                                        if (simulatorRef.current) {
                                            simulatorRef.current.reconcileRealTradesFromBinance(tradeJson.trades);
                                            setTradeLogs([...simulatorRef.current.tradeLogs]);
                                            tradeLogsRef.current = [...simulatorRef.current.tradeLogs];
                                        }
                                    }
                                }
                            }
                        } catch (tradeErr) {
                            console.warn("[Binance Background Sync] userTrades reconcile warning:", tradeErr);
                        }

                        // --- AUTO TRANSFER TRIGGER ---
                        const autoTransferEnabled = settings.system.enableAutoTransfer;
                        const threshold = settings.system.autoTransferThreshold || 1000;
                        const amount = settings.system.autoTransferAmount || 200;
                        
                        if (autoTransferEnabled && typeof balance === 'number' && balance > threshold) {
                            const now = Date.now();
                            // 5 minutes cooldown between auto-transfers to prevent double-triggering
                            if (now - lastAutoTransferTimeRef.current > 5 * 60 * 1000) {
                                lastAutoTransferTimeRef.current = now;
                                handleLog('INFO', `🚀 [自动资金划转] 检测到合约可用账户余额 (${balance.toFixed(2)} USDT) 已超过设定的阈值 (${threshold} USDT)，开始执行自动划转：划转 ${amount} USDT 到现货账户...`);
                                
                                fetch("/api/binance/transfer", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                        apiKey,
                                        apiSecret,
                                        asset: "USDT",
                                        amount: amount,
                                        type: "UMFUTURE_MAIN" // Futures to Spot
                                    })
                                })
                                .then(async r => {
                                    const result = await r.json();
                                    if (r.ok && result.success) {
                                        handleLog('SUCCESS', `🟢 [自动资金划转成功] 已成功从合约账户划转 ${amount} USDT 到现货账户！(流水号: ${result.tranId})`);
                                        audioService.speak(`自动划转成功，已将 ${amount} 美元划转至现货账户`);
                                    } else {
                                        handleLog('DANGER', `❌ [自动资金划转失败] 划转执行失败: ${result.error || '未知网络错误'}`);
                                        audioService.speak("自动资金划转失败，请检查账户可用额度或API权限", true);
                                    }
                                })
                                .catch(err => {
                                    handleLog('DANGER', `❌ [自动资金划转异常] 划转请求遇到网络异常: ${err.message || err}`);
                                });
                            }
                        }
                    } else {
                        if (data && data.rateLimited) {
                            rateLimitBackoffUntil = Date.now() + 20000;
                            console.warn("[Binance Background Sync] Rate limit reached. Backing off for 20s...");
                        } else {
                            console.error("[Binance Background Sync] API Error:", data);
                            if (data && data.code === -2015) {
                                 handleLog('DANGER', '⚠️ 币安 API 密钥无效或权限不足！请检查是否已正确开启“期货交易 (Enable Futures)”权限，并检查 IP 限制。');
                            }
                        }
                    }
                } else if (response.status === 429) {
                    rateLimitBackoffUntil = Date.now() + 20000;
                    console.warn("[Binance Background Sync] HTTP 429 Rate limit exceeded. Backing off for 20s...");
                } else {
                    const errorText = await response.text();
                    console.warn("[Binance Background Sync] Request Notice:", response.status, errorText);
                }
            } catch (err: any) {
                if (err && (err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('abort'))) {
                    console.log("[Binance Background Sync] Request was aborted gracefully.");
                } else {
                    console.warn("[Binance Background Sync] Sync transient failure:", err.message || err);
                }
            } finally {
                isSyncing = false;
            }
        };

        // ⚡ 极速主动抓取指定币种成交记录通道 (Fast-Track Trade Fetching)
        const fetchInstantTradeRecords = async (targetSymbol: string, orderId?: string | number, action?: string) => {
            if (!targetSymbol) return;
            const cleanSym = normalizeSymbol(targetSymbol);
            const apiKey = settingsRef.current.system.binanceApiKey;
            const apiSecret = settingsRef.current.system.binanceApiSecret;
            if (!apiKey || !apiSecret || !settingsRef.current.system.realTrading) return;

            try {
                const resp = await fetch("/api/binance/fast-user-trades", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        apiKey,
                        apiSecret,
                        symbol: cleanSym,
                        limit: 10
                    })
                });
                if (resp.ok) {
                    const data = await resp.json();
                    if (data && data.success && Array.isArray(data.trades) && data.trades.length > 0) {
                        if (simulatorRef.current) {
                            simulatorRef.current.reconcileRealTradesFromBinance(data.trades);
                            setTradeLogs([...simulatorRef.current.tradeLogs]);
                            tradeLogsRef.current = [...simulatorRef.current.tradeLogs];
                            setPositions([...simulatorRef.current.getPositions()]);
                            setBinanceRealPositions([...simulatorRef.current.getPositions()]);
                        }
                    }
                }
            } catch (e) {
                // Background safe probe catch
            }
        };

        const triggerInstantTradeFetch = (targetSymbol: string, orderId?: string | number, action?: string) => {
            if (!targetSymbol) return;
            // 0ms, 120ms, 350ms, 800ms, 1600ms 高频毫秒级主动抓取
            fetchInstantTradeRecords(targetSymbol, orderId, action);
            setTimeout(() => fetchInstantTradeRecords(targetSymbol, orderId, action), 120);
            setTimeout(() => fetchInstantTradeRecords(targetSymbol, orderId, action), 350);
            setTimeout(() => fetchInstantTradeRecords(targetSymbol, orderId, action), 800);
            setTimeout(() => fetchInstantTradeRecords(targetSymbol, orderId, action), 1600);
        };

        (window as any).fetchInstantTradeRecords = triggerInstantTradeFetch;

        // Expose a global function to trigger sync instantly with high-velocity active bursts
        (window as any).triggerApiSync = (force = true, targetSymbol?: string) => {
            console.log("[Binance Sync] Signal emitted! Starting high-velocity millisecond active grab (0ms, 80ms, 200ms, 450ms, 900ms, 1600ms)...");
            if (targetSymbol) {
                triggerInstantTradeFetch(targetSymbol);
            }
            // 1. Grab immediately at 0ms (bypass cache)
            fetchRealState(true, true);
            // 2. High-frequency active probe bursts directly querying Binance REST & state
            setTimeout(() => fetchRealState(true, true), 80);
            setTimeout(() => fetchRealState(true, true), 200);
            setTimeout(() => fetchRealState(true, true), 450);
            setTimeout(() => fetchRealState(true, true), 900);
            setTimeout(() => fetchRealState(true, true), 1600);
        };

        // Initial fast sync
        const timer = setTimeout(() => {
            fetchRealState(true);
        }, 300);

        // High-frequency adaptive sync every 1.5 seconds for instant exchange updates
        const interval = setInterval(() => {
            fetchRealState(true);
        }, 1500);

        return () => {
            clearTimeout(timer);
            clearInterval(interval);
            delete (window as any).triggerApiSync;
            delete (window as any).fetchInstantTradeRecords;
        };
    }, [settings.system.realTrading, settings.system.binanceApiKey, settings.system.binanceApiSecret]);

    const handleSettingsChange = (section: keyof AppSettings, key: string, value: any) => {
        if (section === 'system' && key === 'realTrading') {
            const nextRealTrading = !!value;
            const prevRealTrading = settings.system.realTrading;
            
            if (prevRealTrading !== nextRealTrading) {
                // 1. Save current states before transitioning
                const prevAccountKey = prevRealTrading ? 'SAVIOR_ACCOUNT_LIVE' : 'SAVIOR_ACCOUNT_SIM';
                const prevPositionsKey = prevRealTrading ? 'SAVIOR_POSITIONS_LIVE' : 'SAVIOR_POSITIONS_SIM';
                const prevTradeLogsKey = prevRealTrading ? 'SAVIOR_TRADELOGS_LIVE' : 'SAVIOR_TRADELOGS_SIM';
                
                saveState(prevAccountKey, accountRef.current);
                saveState(prevPositionsKey, positionsRef.current);
                saveState(prevTradeLogsKey, tradeLogsRef.current);
                
                // Backup to standard legacy keys as well
                saveState('SAVIOR_ACCOUNT', accountRef.current);
                saveState('SAVIOR_POSITIONS', positionsRef.current);
                saveState('SAVIOR_TRADELOGS', tradeLogsRef.current);
                
                // 2. Load the states for the target mode
                const nextAccountKey = nextRealTrading ? 'SAVIOR_ACCOUNT_LIVE' : 'SAVIOR_ACCOUNT_SIM';
                const nextPositionsKey = nextRealTrading ? 'SAVIOR_POSITIONS_LIVE' : 'SAVIOR_POSITIONS_SIM';
                const nextTradeLogsKey = nextRealTrading ? 'SAVIOR_TRADELOGS_LIVE' : 'SAVIOR_TRADELOGS_SIM';
                
                const defaultSimAccount = { marginBalance: 10000, totalBalance: 10000, maintenanceMargin: 0, marginRatio: 999 };
                const defaultLiveAccount = { marginBalance: 10000, totalBalance: 10000, maintenanceMargin: 0, marginRatio: 999 };
                
                const nextAccount = loadState(nextAccountKey, loadState('SAVIOR_ACCOUNT', nextRealTrading ? defaultLiveAccount : defaultSimAccount));
                const nextPositions = loadState<Position[]>(nextPositionsKey, loadState<Position[]>('SAVIOR_POSITIONS', []));
                const nextTradeLogs = loadState<TradeLog[]>(nextTradeLogsKey, loadState<TradeLog[]>('SAVIOR_TRADELOGS', []));
                
                // 3. Set React states
                setAccount(nextAccount);
                setPositions(nextPositions);
                setTradeLogs(nextTradeLogs);
                
                // Sync refs instantly
                accountRef.current = nextAccount;
                positionsRef.current = nextPositions;
                tradeLogsRef.current = nextTradeLogs;
                
                // 4. Swap Simulator engine memory instantly
                if (simulatorRef.current) {
                    simulatorRef.current.swapModeState(nextRealTrading, nextAccount, nextPositions, nextTradeLogs);
                }
                
                const modeStr = nextRealTrading ? "实盘/实盘模拟" : "标准模拟";
                handleLog('SUCCESS', `🔄 切换交易模式为【${modeStr}】，已成功加载并隔离当前模式的持仓与财务状态！`);
                if (simulatorRef.current) {
                    simulatorRef.current.addLog('SUCCESS', `🔄 切换交易模式为【${modeStr}】，已成功加载并隔离当前模式的持仓与财务状态！`);
                    simulatorRef.current.emitUpdate(true);
                }
            }
        }

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
        const blacklist = settingsRef.current.system.symbolBlacklist || [];
        if (blacklist.includes(cleanSymbol)) {
            if (simulatorRef.current) {
                simulatorRef.current.addLog("WARNING", `⚠️ 黑名单拦截: 拒绝开仓 ${cleanSymbol}`);
            }
            return;
        }

        // 🛡️ [Anti-Double Open & Hedging Protection]
        if (simulatorRef.current) {
            const activePositions = simulatorRef.current.getPositions();
            
            // 🛑 STRICT HEDGE LOCK: If hedged, block automatic open/reopen/refill, BUT ALLOW MANUAL OPEN!
            const isManual = (extraProps as any)?.isManual === true || ((extraProps as any)?.reason && typeof (extraProps as any).reason === 'string' && (extraProps as any).reason.includes("Manual"));
            if (!isManual) {
                const isSymbolHedged = activePositions.some(p => 
                    normalizeSymbol(p.symbol) === cleanSymbol && 
                    (p.isHedged || p.mainPositionId || activePositions.some(h => h.mainPositionId === p.entryId))
                );
                if (isSymbolHedged) {
                    simulatorRef.current.addLog("WARNING", `🛡️ [防爆对冲严格锁拦截] ${cleanSymbol} 当前正处于对冲保护状态（未解套/未盈利砍仓），程序严禁自动开仓或补仓！`);
                    return;
                }
            }

            const existing = activePositions.find(p => normalizeSymbol(p.symbol) === cleanSymbol);
            if (existing) {
                if (extraProps?.isReopened && (existing.isBeingClosed || existing.amount === 0)) {
                    simulatorRef.current.addLog("INFO", `🔄 [复开安全通道] 检测到 ${cleanSymbol} 存在持仓，但由于是自动复开且原仓位正在平仓/已平仓，允许执行复开。`);
                } else {
                    simulatorRef.current.addLog("WARNING", `🛡️ [防重复开仓拦截] 实盘/模拟开仓指令被拦截: ${cleanSymbol} 已经存在持仓 (${existing.side}，数量 ${existing.amount.toFixed(4)})，防止重复开仓及对冲异常。`);
                    return;
                }
            }

            // Also check for pending hedges in progress
            const hasPendingHedge = Array.from(pendingHedgesRef.current.keys()).some(k => k.startsWith(cleanSymbol));
            if (hasPendingHedge) {
                simulatorRef.current.addLog("WARNING", `🛡️ [防重复开仓拦截] 实盘开仓指令被拦截: ${cleanSymbol} 正在进行自动对冲，禁止此时开立新的标准仓位。`);
                return;
            }
        }

        // 🛡️ [Replication Lag Protection for Standard Positions]
        const lastOpenTime = recentlyOpenedPositionsRef.current.get(cleanSymbol);
        if (lastOpenTime && Date.now() - lastOpenTime < 10000 && !extraProps?.isReopened) {
            if (simulatorRef.current) {
                simulatorRef.current.addLog("WARNING", `🛡️ [开仓延迟拦截] ${cleanSymbol} 的开仓指令于 ${((Date.now() - lastOpenTime)/1000).toFixed(1)} 秒前执行成功，仍在等待币安持仓同步，拦截本次重复触发。`);
            }
            return;
        }

        const speakOpenPosition = () => {
            try {
                const stratId = extraProps?.strategyId || 'strat-1';
                const stratNum = stratId.replace('strat-', '');
                const cleanSym = cleanSymbol.replace('USDT', '');
                
                let isDivergence = false;
                const cacheKey = `SCANNER_LIST2_CACHE_MAP_${stratId}`;
                const saved = localStorage.getItem(cacheKey);
                if (saved) {
                    const cacheArray = JSON.parse(saved);
                    if (Array.isArray(cacheArray)) {
                        const item = cacheArray.find((entry: any) => entry.key === `${cleanSymbol}-FULL`);
                        if (item && item.value && item.value.groupedResults && item.value.groupedResults.length > 0) {
                            const matchingSignal = item.value.groupedResults.find((r: any) => r.direction === side);
                            if (matchingSignal) {
                                isDivergence = !!matchingSignal.isAligned;
                            } else {
                                isDivergence = !!item.value.groupedResults[0].isAligned;
                            }
                        }
                    }
                }
                const conditionName = isDivergence ? '发散' : '穿越';
                const directionName = side === 'LONG' ? '多' : '空';
                const speechText = `来自自动选币${stratNum}${cleanSym}符合${conditionName}条件，${directionName}方向已开仓${amount.toFixed(0)}U请密切关注行情走向`;
                audioService.speak(speechText, true);
            } catch (err) {
                console.warn("Error in speakOpenPosition:", err);
            }
        };

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
                simulatorRef.current.registerPendingRealOpenProps(cleanSymbol, side, {
                    signalTf,
                    signalCandle,
                    entryEmas,
                    leverage: extraProps?.leverage || 20,
                    ...extraProps
                });
                simulatorRef.current.addLog("INFO", `[实盘自动开仓] 策略/信号触发开仓: ${cleanSymbol} ${side} | 杠杆: ${extraProps?.leverage || 20}x | 金额: ${amount} U`);
            }

            try {
                const fetchPromise = fetch("/api/binance/order", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        apiKey,
                        apiSecret,
                        symbol: cleanSymbol,
                        side: side,
                        action: "OPEN",
                        amountUsdt: amount,
                        leverage: extraProps?.leverage || 20
                    })
                });

                const timeoutPromise = new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error("币安接口网络响应超时 (25秒)，请检查API或网络连接")), 25000)
                );

                const response = await Promise.race([fetchPromise, timeoutPromise]) as Response;
                const resData = await response.json();
                if (response.ok && resData.success) {
                    recentlyOpenedPositionsRef.current.set(cleanSymbol, Date.now());
                    const finalLev = resData.leverage || extraProps?.leverage || 20;
                    const tradeTime = Date.now();
                    const orderId = resData.orderId ? String(resData.orderId) : `real_open_${tradeTime}`;
                    
                    const positionEntryId = `real_${cleanSymbol}_${side}_${orderId}`;
                    const openLogItem: TradeLog = {
                        symbol: cleanSymbol,
                        entry_id: positionEntryId,
                        binance_order_id: orderId,
                        status: 'OPEN',
                        is_hedge: !!extraProps?.mainPositionId,
                        entry_timestamp: tradeTime,
                        direction: side,
                        cost_usdt: amount,
                        entry_price: price > 0 ? price : 0,
                        timeframe: signalTf || '5m',
                        events: [{
                            timestamp: tradeTime,
                            action: '实盘开仓下单成功',
                            price: price > 0 ? price : 0,
                            amount: resData.qty || (amount / (price > 0 ? price : 1)),
                            reason: (extraProps as any)?.reason || '列表1批量/立即开仓成交'
                        }]
                    };

                    setTradeLogs(prev => [openLogItem, ...prev]);
                    if (simulatorRef.current) {
                        const finalPrice = resData.price || price || priceBufferRef.current[cleanSymbol] || 0;
                        const finalCost = resData.cumQuote || amount || (resData.qty * finalPrice);
                        const finalQty = resData.qty || (amount / (finalPrice || 1));

                        const autoRealPos: Position = {
                            symbol: cleanSymbol,
                            side: side,
                            amount: finalQty,
                            entryPrice: finalPrice,
                            markPrice: finalPrice,
                            liquidationPrice: 0,
                            unrealizedPnL: 0,
                            unrealizedPnLPercentage: 0,
                            entryId: positionEntryId,
                            entryTime: tradeTime,
                            isPendingSync: true,
                            leverage: finalLev,
                            signalTf: signalTf,
                            signalCandle: signalCandle,
                            entryEmas: entryEmas,
                            isHedged: !!extraProps?.mainPositionId,
                            mainPositionId: extraProps?.mainPositionId,
                            strategyId: extraProps?.strategyId,
                            reopenCount: 0,
                            ...extraProps
                        };

                        simulatorRef.current.tradeLogs.unshift(openLogItem);
                        simulatorRef.current.registerPendingRealOpenProps(cleanSymbol, side, {
                            signalTf,
                            signalCandle,
                            entryEmas,
                            leverage: finalLev,
                            ...extraProps
                        });

                        const curPositions = simulatorRef.current.getPositions();
                        const existingIdx = curPositions.findIndex(p => normalizeSymbol(p.symbol) === cleanSymbol && p.side === side);
                        let nextPositions: Position[];
                        if (existingIdx >= 0) {
                            nextPositions = [...curPositions];
                            nextPositions[existingIdx] = {
                                ...nextPositions[existingIdx],
                                amount: nextPositions[existingIdx].amount + finalQty,
                                entryPrice: finalPrice,
                                markPrice: finalPrice
                            };
                        } else {
                            nextPositions = [autoRealPos, ...curPositions];
                        }

                        simulatorRef.current.setPositions(nextPositions);
                        setPositions(nextPositions);
                        setBinanceRealPositions(nextPositions);
                        if (resData.orderId) {
                            simulatorRef.current.registerExecutedOrderId(resData.orderId);
                        }
                        simulatorRef.current.addLog("SUCCESS", `⚡ [币安实盘] 自动开仓成功: ${cleanSymbol} ${side} | 杠杆: ${finalLev}x | 数量: ${finalQty} | ID: ${resData.orderId}`);
                        if (resData.trades && Array.isArray(resData.trades) && resData.trades.length > 0) {
                            simulatorRef.current.reconcileRealTradesFromBinance(resData.trades);
                        } else if (resData.latestTrade) {
                            simulatorRef.current.reconcileRealTradesFromBinance([resData.latestTrade]);
                        }
                        simulatorRef.current.emitUpdate(true);
                    }
                    speakOpenPosition();

                    // Sync real-time positions & fast-grab trade records instantly after order placement
                    if (typeof (window as any).triggerApiSync === "function") {
                        (window as any).triggerApiSync(true, cleanSymbol);
                    }
                } else {
                    const errMsg = resData.error || resData.message || "未知交易所错误";
                    if (simulatorRef.current) {
                        simulatorRef.current.addLog("DANGER", `⚡ [币安实盘] 自动开仓未获成功确认: ${errMsg}`);
                    }
                    audioService.speak("自动开仓失败");
                }
            } catch (e: any) {
                if (simulatorRef.current) {
                    simulatorRef.current.addLog("DANGER", `⚡ [币安实盘] 自动开仓网络/超时异常: ${e.message || e}`);
                }
                audioService.speak("自动开仓网络异常");
            }
        } else {
            simulatorRef.current?.openPosition(cleanSymbol, side, amount, price, signalTf, signalCandle, entryEmas, extraProps);
            speakOpenPosition();
        }
    }, []);

    const handleAutoHedge = useCallback(async (position: Position, side: PositionSide, amountUsdt: number, reason: string, exactQty?: number) => {
        const cleanSymbol = normalizeSymbol(position.symbol);
        const apiKey = settingsRef.current.system.binanceApiKey;
        const apiSecret = settingsRef.current.system.binanceApiSecret;
        if (!apiKey || !apiSecret) {
            console.error("[Auto Hedge] API keys not configured");
            return;
        }

        // 🛡️ [Minimum Position Size Safeguard]
        const hedgeSettings = settingsRef.current.hedging;
        const entryValue = position.amount * position.entryPrice;
        const minPositionThreshold = Number(hedgeSettings?.minPosition ?? 10);
        if (entryValue < minPositionThreshold) {
            if (simulatorRef.current) {
                simulatorRef.current.addLog("WARNING", `🛡️ [对冲金额拦截] ${cleanSymbol} 持仓金额 ${entryValue.toFixed(2)} USDT 小于设定的对冲起步金额 ${minPositionThreshold} USDT，拦截本次自动对冲开仓。`);
            }
            return;
        }

        // 🛡️ [Extreme Price/PnL Anomaly Safeguard]
        const pnlPercent = position.unrealizedPnLPercentage;
        if (pnlPercent < -95) {
            if (simulatorRef.current) {
                simulatorRef.current.addLog("DANGER", `🛡️ [对冲异常拦截] ${cleanSymbol} 亏损计算异常 (${pnlPercent.toFixed(2)}%)，超过跌幅95%安全红线，怀疑为价格源精度/异常抖动，拒绝向币安发送对冲订单！`);
            }
            return;
        }

        // 1. Double-open safety check against local state & global locks
        const lockKey = `${cleanSymbol}_${side}`;
        const symbolLockKey = cleanSymbol;

        if (simulatorRef.current) {
            const activePositions = simulatorRef.current.getPositions();
            const existingOpposite = activePositions.find(p => 
                normalizeSymbol(p.symbol) === cleanSymbol && p.side === side
            );
            if (existingOpposite) {
                simulatorRef.current.addLog("WARNING", `🛡️ [对冲重复拦截] 检测到 ${cleanSymbol} 已存在 ${side} 方向对冲仓位，拦截本次自动开对冲动作。`);
                return;
            }
        }

        // 2. Concurrency lock for pending requests (both direction & symbol-wide)
        if (pendingHedgesRef.current.has(lockKey) || pendingHedgesRef.current.has(symbolLockKey)) {
            if (simulatorRef.current) {
                simulatorRef.current.addLog("WARNING", `🛡️ [对冲并发拦截] 正在处理 ${cleanSymbol} 的开对冲请求（在途中），严禁重复发送！`);
            }
            return;
        }

        // 3. Rate Limit Protection (5 seconds between attempts)
        const lastAttemptTime = Math.max(
            lastHedgeAttemptRef.current.get(lockKey) || 0,
            lastHedgeAttemptRef.current.get(symbolLockKey) || 0
        );
        if (lastAttemptTime && Date.now() - lastAttemptTime < 5000) {
            if (simulatorRef.current) {
                simulatorRef.current.addLog("WARNING", `🛡️ [对冲高频拦截] ${cleanSymbol} ${side} 的自动对冲请求距离上次触发太近 (< 5秒)，强制等待冷却。`);
            }
            return;
        }

        // 4. Replication Lag Protection (60 seconds after hedge trigger to prevent duplicate firing during transit)
        const lastHedgeTime = Math.max(
            recentlyOpenedHedgesRef.current.get(lockKey) || 0,
            recentlyOpenedHedgesRef.current.get(symbolLockKey) || 0
        );
        if (lastHedgeTime && Date.now() - lastHedgeTime < 60000) {
            if (simulatorRef.current) {
                simulatorRef.current.addLog("WARNING", `🛡️ [对冲在途拦截] ${cleanSymbol} ${side} 的自动对冲指令于 ${((Date.now() - lastHedgeTime)/1000).toFixed(1)} 秒前已发送，处于单次对冲保护期中，拦截本次重复触发。`);
            }
            return;
        }

        // 🔒 [前置原子即时加锁] 在发起异步请求前的第一行立即打入 60 秒全局在途锁与并发锁，杜绝任何微秒/毫秒并发穿透
        recentlyOpenedHedgesRef.current.set(lockKey, Date.now());
        recentlyOpenedHedgesRef.current.set(symbolLockKey, Date.now());
        lastHedgeAttemptRef.current.set(lockKey, Date.now());
        lastHedgeAttemptRef.current.set(symbolLockKey, Date.now());
        pendingHedgesRef.current.add(lockKey);
        pendingHedgesRef.current.add(symbolLockKey);

        // 5. Post-Close Cooldown Protection (30 seconds after close/amputation of any position for this symbol)
        // 🔒 [平仓-开对冲交叉锁] 检查该币种的平仓记录，若 30 秒内刚平仓/砍仓过对冲单，严禁立即重新向币安发送对冲开仓指令
        const lastCloseTime = recentlyClosedPositionsRef.current.get(lockKey) || recentlyClosedPositionsRef.current.get(`${cleanSymbol}_${position.side}`);
        const isNewPositionAfterClose = position.entryTime && lastCloseTime && position.entryTime > lastCloseTime;
        const isFreshPosition = !position.lastHedgeClosedAt && !position.isReopened;
        if (!isNewPositionAfterClose && !isFreshPosition && lastCloseTime && Date.now() - lastCloseTime < 30000) {
            const remainingSec = ((30000 - (Date.now() - lastCloseTime)) / 1000).toFixed(1);
            if (simulatorRef.current) {
                simulatorRef.current.addLog("WARNING", `🛡️ [对冲平仓冷却拦截] ${cleanSymbol} ${side} 在 ${((Date.now() - lastCloseTime)/1000).toFixed(1)} 秒前刚执行过平仓/砍仓，处于 30 秒防重开冷却保护期中（剩余 ${remainingSec}s），拒绝向币安重开对冲单！`);
            }
            return;
        }

        lastHedgeAttemptRef.current.set(lockKey, Date.now());
        pendingHedgesRef.current.add(lockKey);

        const hedgePrice = position.markPrice || position.entryPrice || 1;
        const estimatedHedgeQty = exactQty !== undefined ? exactQty : (amountUsdt / hedgePrice);
        const optimisticEntryId = 'HEDGE_' + Date.now().toString() + '_' + Math.random().toString(36).substring(2, 9);

        // 🔒 [0毫秒乐观即时渲染] 发送币安指令的同一毫秒，立即在本地状态中展示防爆对冲开仓
        if (simulatorRef.current) {
            const qtyText = exactQty !== undefined ? `数量: ${exactQty.toFixed(4)}` : `金额: ${amountUsdt.toFixed(2)} U`;
            simulatorRef.current.addLog("INFO", `⚡ [自动对冲触发] 亏损达到条件，正在向币安发送市价对冲订单: ${cleanSymbol} ${side} | ${qtyText} | 原因: ${reason}`);

            const simPositions = simulatorRef.current.getPositions();
            const mainPos = simPositions.find(p => p.entryId === position.entryId || (normalizeSymbol(p.symbol) === cleanSymbol && p.side === position.side));
            if (mainPos) {
                mainPos.isHedged = true;
                mainPos.hedgeSignalTriggered = true;
            }

            const optimisticHedge: Position = {
                symbol: position.symbol,
                side: side,
                amount: estimatedHedgeQty,
                entryPrice: hedgePrice,
                markPrice: hedgePrice,
                liquidationPrice: side === PositionSide.LONG ? hedgePrice * 0.5 : hedgePrice * 1.5,
                unrealizedPnL: 0,
                unrealizedPnLPercentage: 0,
                entryId: optimisticEntryId,
                entryTime: Date.now(),
                isHedged: true,
                mainPositionId: position.entryId,
                triggerReason: reason || '自动防爆对冲',
                correlationId: position.correlationId,
                reopenCount: position.reopenCount,
                leverage: position.leverage || 20
            };

            const existingHedgeIdx = simPositions.findIndex(p => normalizeSymbol(p.symbol) === cleanSymbol && p.side === side);
            if (existingHedgeIdx >= 0) {
                simPositions[existingHedgeIdx] = optimisticHedge;
            } else {
                simPositions.push(optimisticHedge);
            }
            simulatorRef.current.setPositions(simPositions);
            simulatorRef.current.emitUpdate(true);
            setPositions([...simPositions]);
        }

        let isSuccess = false;
        try {
            // Set up fetch with 20000ms timeout to support backend multi-node fallbacks
            const fetchPromise = fetch("/api/binance/order", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    apiKey,
                    apiSecret,
                    symbol: cleanSymbol,
                    side: side,
                    action: "OPEN",
                    quantity: exactQty,
                    amountUsdt: exactQty !== undefined ? undefined : amountUsdt,
                    leverage: position.leverage || 20
                })
            });

            const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("Timeout")), 20000)
            );

            // Race fetch against 20-second timeout
            const response = await Promise.race([fetchPromise, timeoutPromise]) as Response;

            const resData = await response.json();
            if (response.ok && resData.success) {
                isSuccess = true;
                recentlyOpenedHedgesRef.current.set(lockKey, Date.now());
                if (simulatorRef.current) {
                    if (resData.orderId) {
                        simulatorRef.current.registerExecutedOrderId(resData.orderId);
                    }
                    simulatorRef.current.addLog("SUCCESS", `⚡ [币安实盘] 自动对冲开仓成功: ${cleanSymbol} ${side} | 杠杆: ${position.leverage || 20}x | 数量: ${resData.qty} | ID: ${resData.orderId}`);
                    
                    const simPositions = simulatorRef.current.getPositions();
                    const mainPos = simPositions.find(p => p.entryId === position.entryId || (normalizeSymbol(p.symbol) === cleanSymbol && p.side === position.side));
                    if (mainPos) {
                        mainPos.isHedged = true;
                    }

                    const entryId = optimisticEntryId;
                    const finalHedgePrice = resData.price || hedgePrice;
                    const finalHedgeQty = resData.qty || estimatedHedgeQty;
                    const newHedge: Position = {
                        symbol: position.symbol,
                        side: side,
                        amount: finalHedgeQty,
                        entryPrice: finalHedgePrice,
                        markPrice: finalHedgePrice,
                        liquidationPrice: side === PositionSide.LONG ? finalHedgePrice * 0.5 : finalHedgePrice * 1.5,
                        unrealizedPnL: 0,
                        unrealizedPnLPercentage: 0,
                        entryId,
                        entryTime: Date.now(),
                        isHedged: true,
                        mainPositionId: position.entryId,
                        triggerReason: reason || '自动防爆对冲',
                        correlationId: position.correlationId,
                        reopenCount: position.reopenCount,
                        leverage: position.leverage || 20
                    };

                    const finalHedgeCost = finalHedgeQty * finalHedgePrice;
                    const hedgeTradeTime = Date.now();
                    const hedgeOrderId = resData.orderId ? String(resData.orderId) : `real_hedge_${hedgeTradeTime}`;

                    const hedgeLogItem: TradeLog = {
                        symbol: position.symbol,
                        entry_id: entryId,
                        binance_order_id: hedgeOrderId,
                        status: 'OPEN',
                        is_hedge: true,
                        entry_timestamp: hedgeTradeTime,
                        direction: side,
                        cost_usdt: finalHedgeCost,
                        entry_price: finalHedgePrice,
                        current_amount: finalHedgeQty,
                        main_entry_id: position.entryId,
                        correlationId: position.correlationId,
                        reopenCount: position.reopenCount,
                        timeframe: position.signalTf || '5m',
                        events: [{
                            timestamp: hedgeTradeTime,
                            action: `防爆对冲开仓 (${side})`,
                            price: finalHedgePrice,
                            amount: finalHedgeQty,
                            reason: reason || '自动防爆对冲'
                        }]
                    };

                    simulatorRef.current.tradeLogs.unshift(hedgeLogItem);
                    setTradeLogs(prev => [hedgeLogItem, ...prev]);
                    simulatorRef.current.addTradeEvent(position, `开启对冲单 (${side})`, finalHedgePrice, finalHedgeQty, reason || '自动防爆对冲');

                    const existingHedgeIdx = simPositions.findIndex(p => normalizeSymbol(p.symbol) === cleanSymbol && p.side === side);
                    if (existingHedgeIdx >= 0) {
                        simPositions[existingHedgeIdx] = newHedge;
                    } else {
                        simPositions.push(newHedge);
                    }
                    if (resData.trades && Array.isArray(resData.trades) && resData.trades.length > 0) {
                        simulatorRef.current.reconcileRealTradesFromBinance(resData.trades);
                    } else if (resData.latestTrade) {
                        simulatorRef.current.reconcileRealTradesFromBinance([resData.latestTrade]);
                    }
                    simulatorRef.current.setPositions(simPositions);
                    simulatorRef.current.emitUpdate(true);
                    setPositions([...simPositions]);
                }
                
                const cleanSym = position.symbol.replace('USDT', '');
                const sideName = position.side === 'LONG' ? '多' : '空';
                const isSecondary = reason && (reason.includes('二次') || reason.includes('Secondary') || reason.includes('2'));
                const speechText = `${cleanSym}${sideName}方向${isSecondary ? '二次' : ''}对冲已开启`;
                audioService.speak(speechText, true);

                if (typeof (window as any).triggerApiSync === "function") {
                    (window as any).triggerApiSync(true, cleanSymbol);
                }
            } else {
                const errMsg = resData.error || "未知交易所错误";
                if (simulatorRef.current) {
                    simulatorRef.current.addLog("DANGER", `🚨 [对冲响应失败] 自动对冲开仓失败: ${errMsg}`);
                    // Reset main position isHedged flag so future ticks/scans can retry
                    const simPositions = simulatorRef.current.getPositions();
                    const mainPos = simPositions.find(p => p.entryId === position.entryId || (normalizeSymbol(p.symbol) === cleanSymbol && p.side === position.side));
                    if (mainPos && !simPositions.some(p => normalizeSymbol(p.symbol) === cleanSymbol && p.side !== position.side)) {
                        mainPos.isHedged = false;
                        delete mainPos.hedgeOrderInFlight;
                        delete mainPos.hedgeOrderInFlightTime;
                        delete mainPos.hedgeSignalTriggered;
                    }
                    simulatorRef.current.emitUpdate(true);
                }
                audioService.speak("警报，对冲开仓指令执行失败，请手动检查仓位", true);
                // Wait/Sleep 3 seconds on failure before allowing retry
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        } catch (e: any) {
            if (simulatorRef.current) {
                simulatorRef.current.addLog("DANGER", `🚨 [对冲响应异常] 自动对冲网络异常或未收到响应: ${e.message || e}`);
                // Reset main position isHedged flag on network error so future ticks/scans can retry
                const simPositions = simulatorRef.current.getPositions();
                const mainPos = simPositions.find(p => p.entryId === position.entryId || (normalizeSymbol(p.symbol) === cleanSymbol && p.side === position.side));
                if (mainPos && !simPositions.some(p => normalizeSymbol(p.symbol) === cleanSymbol && p.side !== position.side)) {
                    mainPos.isHedged = false;
                    delete mainPos.hedgeOrderInFlight;
                    delete mainPos.hedgeOrderInFlightTime;
                    delete mainPos.hedgeSignalTriggered;
                }
                simulatorRef.current.emitUpdate(true);
            }
            audioService.speak("警报，对冲网络异常，未收到回复指令，请立即手动核对仓位", true);
            // Wait/Sleep 3 seconds on timeout/exception before allowing retry
            await new Promise(resolve => setTimeout(resolve, 3000));
        } finally {
            // Always delay clearing the lock for a short duration to let Binance states settle
            if (isSuccess) {
                // For success, wait 2 seconds before removing lock to let API Sync run
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            pendingHedgesRef.current.delete(lockKey);
            pendingHedgesRef.current.delete(symbolLockKey);
        }
    }, []);

    const handleAutoClose = useCallback(async (position: Position, reason: string, customQty?: number, ratio?: number) => {
        const cleanSymbol = normalizeSymbol(position.symbol);
        const apiKey = settingsRef.current.system.binanceApiKey;
        const apiSecret = settingsRef.current.system.binanceApiSecret;
        if (!apiKey || !apiSecret) {
            console.error("[Auto Close] API keys not configured");
            return;
        }

        const lockKey = `${cleanSymbol}_${position.side}`;
        if (pendingClosesRef.current.has(lockKey)) {
            if (simulatorRef.current) {
                simulatorRef.current.addLog("INFO", `⚡ [自动平仓拦截] ${cleanSymbol} 平仓/砍仓正在处理中，拒绝重复提交。`);
            }
            return;
        }

        // 🔒 [断臂求生在途与防重复砍仓安全锁] 若为砍仓请求，检查该仓位是否触发震荡熔断
        if (customQty !== undefined && ratio !== undefined) {
            const currentPositions = simulatorRef.current ? simulatorRef.current.getPositions() : positions;
            
            // 🔒 [震荡磨损保护熔断检查]
            const maxAmpCount = Math.max(0, ...currentPositions.filter(p => normalizeSymbol(p.symbol) === cleanSymbol).map(p => p.amputationCount || 0));
            if (settingsRef.current.stopLoss?.fuseEnabled && maxAmpCount >= (settingsRef.current.stopLoss?.maxHedgeRetries || 3)) {
                if (simulatorRef.current) {
                    simulatorRef.current.addLog("WARNING", `🛡️ [震荡磨损保护熔断] ${cleanSymbol} 砍仓次数已达上限(${maxAmpCount}次)，停止继续砍仓！`);
                }
                return;
            }
        }

        // Debounce: prevent triggering within 5 seconds if a close was triggered recently
        const lastCloseTime = recentlyClosedPositionsRef.current.get(lockKey);
        if (lastCloseTime && Date.now() - lastCloseTime < 5000) {
            if (simulatorRef.current) {
                simulatorRef.current.addLog("INFO", `⚡ [自动平仓拦截] ${cleanSymbol} 5秒内已平仓/砍仓过，锁定冷却中。`);
            }
            return;
        }

        pendingClosesRef.current.add(lockKey);

        const closeQty = customQty !== undefined ? customQty : position.amount;

        // 🔒【绝对零虚假铁律】指令发送阶段仅记录正在向币安发送请求，严禁提前修改/扣减持仓！
        if (simulatorRef.current) {
            simulatorRef.current.addLog("INFO", `⚡ [自动平仓触发] 策略触发平仓，正在向币安发送平仓请求: ${cleanSymbol} ${position.side} | 数量: ${closeQty.toFixed(4)} | 原因: ${reason}`);
            simulatorRef.current.emitUpdate(true);
        }

        let isSuccess = false;
        try {
            // Set up fetch with 35000ms timeout to support backend multi-node fallbacks
            const fetchPromise = fetch("/api/binance/order", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    apiKey,
                    apiSecret,
                    symbol: cleanSymbol,
                    side: position.side,
                    action: "CLOSE",
                    quantity: closeQty
                })
            });

            const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("Timeout")), 35000)
            );

            // Race fetch against 35-second timeout
            const response = await Promise.race([fetchPromise, timeoutPromise]) as Response;

            const resData = await response.json();
            if (response.ok && resData.success) {
                isSuccess = true;
                if (ratio === undefined || ratio >= 100 || (position.amount - (customQty || 0)) <= 0.0001) {
                    recentlyClosedPositionsRef.current.set(lockKey, Date.now());
                }
                if (simulatorRef.current) {
                    if (resData.orderId) {
                        simulatorRef.current.registerExecutedOrderId(resData.orderId);
                    }
                    simulatorRef.current.addLog("SUCCESS", `⚡ [币安实盘] 自动平仓成功: ${cleanSymbol} ${position.side} | ID: ${resData.orderId}`);
                    if (customQty !== undefined && ratio !== undefined) {
                        // 🔒 [断臂求生实盘成功回调] 精确计算砍仓亏损金额并100%计入单币独立负债
                        const currentMark = resData.price || realPrices[cleanSymbol] || position.markPrice || position.entryPrice;
                        const priceDiff = position.side === 'LONG' ? currentMark - position.entryPrice : position.entryPrice - currentMark;
                        const calculatedPnl = priceDiff * position.amount;
                        const effectivePnl = (position.unrealizedPnL !== undefined && position.unrealizedPnL !== 0) ? position.unrealizedPnL : calculatedPnl;
                        const realizedPnL = (resData.realizedPnl !== undefined && resData.realizedPnl !== 0) ? resData.realizedPnl : effectivePnl * (ratio / 100);
                        const isLoss = realizedPnL < 0;
                        const lossAmount = isLoss ? Math.abs(realizedPnL) : 0;
                        simulatorRef.current.handleRealAmputationSuccess(
                            cleanSymbol,
                            position.side,
                            customQty,
                            ratio,
                            reason,
                            realizedPnL,
                            resData
                        );
                        if (ratio >= 100 || (position.amount - customQty) <= 0.0001) {
                            // 🔒 100%全额砍仓：记录全额砍仓负债，并同步给该币对手单，然后移除已砍光仓位
                            simulatorRef.current.removePositionLocally(cleanSymbol, position.side);
                            setBinanceRealPositions(prev => prev.filter(p => !(normalizeSymbol(p.symbol) === cleanSymbol && p.side === position.side)));
                            const updatedSimPositions = simulatorRef.current.getPositions();
                            setPositions(updatedSimPositions);
                        } else {
                            // 🔒 部分砍仓（无论比例多少）：直接同步模拟器中已唯一计算好的权威持仓对象，严禁在前端再次进行 +lossAmount 二次累加
                            const updatedSimPositions = simulatorRef.current.getPositions();
                            setPositions(updatedSimPositions);
                        }
                        // 🔒 [关键修复] 立即同步更新前端交易日志状态，确保砍仓流水即时在日志面板与负债统计中可见！
                        setTradeLogs([...simulatorRef.current.tradeLogs]);
                    } else {
                        // 🔒 全额平仓：记录整仓关闭流水
                        simulatorRef.current.recordRealTradeLog(position, reason, resData);
                        setTradeLogs([...simulatorRef.current.tradeLogs]);
                        if (closeQty >= (position.amount * 0.999)) {
                            simulatorRef.current.removePositionLocally(cleanSymbol, position.side);
                            setBinanceRealPositions(prev => prev.filter(p => !(normalizeSymbol(p.symbol) === cleanSymbol && p.side === position.side)));
                            setPositions(prev => prev.filter(p => !(normalizeSymbol(p.symbol) === cleanSymbol && p.side === position.side)));
                        }
                    }
                    if (resData.trades && Array.isArray(resData.trades) && resData.trades.length > 0) {
                        simulatorRef.current.reconcileRealTradesFromBinance(resData.trades);
                    } else if (resData.latestTrade) {
                        simulatorRef.current.reconcileRealTradesFromBinance([resData.latestTrade]);
                    }
                    simulatorRef.current.emitUpdate(true);
                }
                
                const cleanSym = position.symbol.replace('USDT', '');
                if (position.isHedged && position.mainPositionId) {
                    audioService.speak(`${cleanSym}对冲单已平仓`, true);
                } else {
                    const sideName = position.side === 'LONG' ? '多' : '空';
                    audioService.speak(`${cleanSym}${sideName}方向已平仓`, true);
                }

                if (typeof (window as any).triggerApiSync === "function") {
                    (window as any).triggerApiSync(true, cleanSymbol);
                }
            } else {
                const errMsg = resData.error || "未知交易所错误";
                if (simulatorRef.current) {
                    simulatorRef.current.addLog("DANGER", `🚨 [平仓响应失败] 自动平仓失败: ${errMsg}`);
                    simulatorRef.current.emitUpdate(true);
                }
                audioService.speak("警报，平仓/砍仓指令执行失败，请手动检查仓位", true);
                // Wait/Sleep 3 seconds on failure before allowing retry
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        } catch (e: any) {
            if (simulatorRef.current) {
                simulatorRef.current.addLog("DANGER", `🚨 [平仓响应异常] 自动平仓网络异常或未收到响应: ${e.message || e}`);
                simulatorRef.current.emitUpdate(true);
            }
            audioService.speak("警报，平仓网络异常，未收到回复指令，请立即手动核对仓位", true);
            // Wait/Sleep 3 seconds on timeout/exception before allowing retry
            await new Promise(resolve => setTimeout(resolve, 3000));
        } finally {
            // Always delay clearing the lock for a short duration to let Binance states settle
            if (isSuccess) {
                // For success, wait 2 seconds before removing lock to let API Sync run
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            pendingClosesRef.current.delete(lockKey);
        }
    }, []);

    const handleAutoOpenRefill = useCallback(async (position: Position, qty: number, reason: string) => {
        const cleanSymbol = normalizeSymbol(position.symbol);
        const refillLockKey = `${cleanSymbol}_${position.side}`;
        const now = Date.now();
        const lastRefillTime = inFlightRefillRef.current.get(refillLockKey) || 0;
        if (now - lastRefillTime < 10000) {
            console.warn(`[Auto Refill Intercepted] 🛡️ 拦截前端重复补仓触发: ${cleanSymbol} ${position.side} 处于10秒防抖保护中(${now - lastRefillTime}ms 前刚提交)`);
            return;
        }
        inFlightRefillRef.current.set(refillLockKey, now);

        const apiKey = settingsRef.current.system.binanceApiKey;
        const apiSecret = settingsRef.current.system.binanceApiSecret;
        if (!apiKey || !apiSecret) {
            console.error("[Auto Refill] API keys not configured");
            return;
        }

        // 🛡️ [Hedge State Lock for Real Refill]
        if (simulatorRef.current) {
            const activePositions = simulatorRef.current.getPositions();
            const oppositePos = activePositions.find(p => 
                normalizeSymbol(p.symbol) === cleanSymbol && 
                p.side !== position.side && 
                p.amount > 0
            );

            const isRescueRefill = reason.includes('断臂') || reason.includes('求生');

            // 🔒 [有效对冲绝对禁补铁律]：当原仓位与对冲仓位数量一样多时（有效对冲），非断臂救世补仓绝对严禁补仓！
            if (oppositePos && !isRescueRefill && Math.abs(position.amount - oppositePos.amount) <= Math.max(position.amount, oppositePos.amount) * 0.05) {
                simulatorRef.current.addLog("WARNING", `🛡️ [有效对冲禁补] ${cleanSymbol} 原仓位与对冲仓位数量一致(${position.amount.toFixed(4)})处于有效对冲状态，安全铁律拦截，绝对严禁补仓！`);
                return;
            }

            if (oppositePos && !isRescueRefill) {
                simulatorRef.current.addLog("WARNING", `🛡️ [对冲实盘补仓拦截] ${cleanSymbol} 处于双向持仓对冲状态，安全锁已激活，拒绝发送补仓指令。`);
                return;
            }
        }

        // 🔒【绝对零虚假铁律】补仓指令发送阶段仅记录正在向币安发送请求，严禁提前修改持仓！
        if (simulatorRef.current) {
            simulatorRef.current.addLog("INFO", `⚡ [自动补仓触发] 策略触发补位，正在向币安发送开仓请求: ${cleanSymbol} ${position.side} | 数量: ${qty.toFixed(4)} | 原因: ${reason}`);
        }

        try {
            const response = await fetch("/api/binance/order", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    apiKey,
                    apiSecret,
                    symbol: cleanSymbol,
                    side: position.side,
                    action: "OPEN",
                    quantity: qty,
                    isRefill: true,
                    allowExisting: true
                })
            });

            const resData = await response.json();
            if (response.ok && resData.success && resData.orderId && resData.orderId !== "EXISTING_POSITION_INTERCEPTED") {
                if (simulatorRef.current) {
                    simulatorRef.current.registerExecutedOrderId(resData.orderId);
                    simulatorRef.current.addLog("SUCCESS", `⚡ [币安实盘] 自动补位成功: ${cleanSymbol} ${position.side} | 补仓数量: ${qty.toFixed(4)} | ID: ${resData.orderId}`);
                    if (resData.trades && Array.isArray(resData.trades) && resData.trades.length > 0) {
                        simulatorRef.current.reconcileRealTradesFromBinance(resData.trades);
                    } else if (resData.latestTrade) {
                        simulatorRef.current.reconcileRealTradesFromBinance([resData.latestTrade]);
                    }
                    simulatorRef.current.handleRealRefillSuccess(position.symbol, position.side, qty, reason);
                    const updatedSimPositions = simulatorRef.current.getPositions();
                    setPositions(updatedSimPositions);
                }
                
                const cleanSym = position.symbol.replace('USDT', '');
                audioService.speak(`${cleanSym}已自动补仓`, true);

                if (typeof (window as any).triggerApiSync === "function") {
                    (window as any).triggerApiSync(true, cleanSymbol);
                }
            } else {
                const errMsg = resData.error || (resData.orderId === "EXISTING_POSITION_INTERCEPTED" ? "币安持仓拦截" : "未知交易所错误");
                if (simulatorRef.current) {
                    simulatorRef.current.addLog("DANGER", `⚡ [币安实盘] 自动补位失败: ${errMsg}`);
                }
                audioService.speak("自动补仓失败");
            }
        } catch (e: any) {
            if (simulatorRef.current) {
                simulatorRef.current.addLog("DANGER", `⚡ [币安实盘] 自动补位网络异常: ${e.message || e}`);
            }
        }
    }, []);

    const handleAutoReopen = useCallback(async (symbol: string, side: PositionSide, amountUsdt: number, reason: string, extraProps?: Partial<Position>) => {
        const cleanSymbol = normalizeSymbol(symbol);
        const apiKey = settingsRef.current.system.binanceApiKey;
        const apiSecret = settingsRef.current.system.binanceApiSecret;
        if (!apiKey || !apiSecret) {
            console.error("[Auto Reopen] API keys not configured");
            return;
        }

        if (simulatorRef.current) {
            simulatorRef.current.addLog("INFO", `⚡ [自动复开延迟起步] 延迟 1.5 秒以确保币安平仓完全成交且完成同步...`);
        }
        
        // 1.5 second delay to let Binance finish processing the previous close/amputation market orders
        await new Promise(resolve => setTimeout(resolve, 1500));

        if (simulatorRef.current) {
            simulatorRef.current.addLog("INFO", `⚡ [自动复开触发] 正在向币安发送开仓指令以完全复开原仓位: ${cleanSymbol} ${side} | 原始USDT本金: ${amountUsdt.toFixed(2)}U | 原因: ${reason}`);
        }

        try {
            await handleOpenPosition(cleanSymbol, side, amountUsdt, 0, '1m', undefined, undefined, {
                ...extraProps,
                isReopened: true
            });
        } catch (e: any) {
            if (simulatorRef.current) {
                simulatorRef.current.addLog("DANGER", `🚨 [自动复开异常] 发送开仓指令失败: ${e.message || e}`);
            }
        }
    }, [handleOpenPosition]);

    // Keep execution refs up to date on every render cycle to avoid stale closures
    onRealHedgeRef.current = handleAutoHedge;
    onRealCloseRef.current = handleAutoClose;
    onRealOpenRef.current = handleAutoOpenRefill;
    onRealReopenRef.current = handleAutoReopen;

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

            // Get position to close to find exact quantity from latest synced state or active UI positions
            const posToClose = combinedPositions.find(p => normalizeSymbol(p.symbol) === cleanSymbol && p.side === side) || binanceRealPositions.find(p => normalizeSymbol(p.symbol) === cleanSymbol && p.side === side);
            if (!posToClose) {
                alert("错误: 未在当前实盘持仓中找到该仓位！");
                return;
            }

            if (simulatorRef.current) {
                simulatorRef.current.addLog("INFO", `[实盘平仓] 正在向币安发送市价平仓请求: ${cleanSymbol} ${side} | 数量: ${posToClose.amount}`);
            }

            audioService.speak("平仓指令已发送");

            try {
                const fetchPromise = fetch("/api/binance/order", {
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

                const timeoutPromise = new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error("币安平仓网络响应超时 (25秒)，请检查网络连接或持仓状态")), 25000)
                );

                const response = await Promise.race([fetchPromise, timeoutPromise]) as Response;
                const resData = await response.json();
                if (response.ok && resData.success) {
                    // 🔒【绝对零虚假铁律】收到官方成功确认后，才从持仓列表中剔除
                    setBinanceRealPositions(prev => prev.filter(p => !(normalizeSymbol(p.symbol) === cleanSymbol && p.side === side)));
                    setPositions(prev => prev.filter(p => !(normalizeSymbol(p.symbol) === cleanSymbol && p.side === side)));
                    
                    if (simulatorRef.current) {
                        simulatorRef.current.registerInFlightClosing(cleanSymbol, side, posToClose.amount);
                        if (resData.orderId) {
                            simulatorRef.current.registerExecutedOrderId(resData.orderId);
                        }
                        simulatorRef.current.addLog("SUCCESS", `⚡ [币安实盘] 平仓成功: ${cleanSymbol} ${side} | ID: ${resData.orderId}`);
                        simulatorRef.current.recordRealTradeLog(posToClose, '手动平仓', resData);
                        if (resData.trades && Array.isArray(resData.trades) && resData.trades.length > 0) {
                            simulatorRef.current.reconcileRealTradesFromBinance(resData.trades);
                        } else if (resData.latestTrade) {
                            simulatorRef.current.reconcileRealTradesFromBinance([resData.latestTrade]);
                        }
                        setTradeLogs([...simulatorRef.current.tradeLogs]);
                    }
                    audioService.speak("实盘平仓执行成功");

                    // Sync real-time positions & fast-grab trade records instantly after order placement
                    if (typeof (window as any).triggerApiSync === "function") {
                        (window as any).triggerApiSync(true, cleanSymbol);
                    }
                } else {
                    const errMsg = resData.error || resData.message || "未知交易所错误";
                    if (simulatorRef.current) {
                        simulatorRef.current.addLog("DANGER", `⚡ [币安实盘] 平仓未获成功确认: ${errMsg}`);
                    }
                    alert(`币安实盘平仓未获成功确认:\n${errMsg}`);
                    audioService.speak("实盘平仓失败");
                }
            } catch (e: any) {
                if (simulatorRef.current) {
                    simulatorRef.current.addLog("DANGER", `⚡ [币安实盘] 平仓网络/超时异常: ${e.message || e}`);
                }
                alert(`币安实盘平仓网络/超时异常:\n${e.message || e}`);
            }
        } else {
            simulatorRef.current?.closePosition(cleanSymbol, side, 'MANUAL');
        }
    }, [combinedPositions, binanceRealPositions]);

    const handleCloseAllForSymbol = useCallback(async (symbol: string) => {
        const cleanSymbol = normalizeSymbol(symbol);
        const targets = positions.filter(p => normalizeSymbol(p.symbol) === cleanSymbol);
        if (targets.length === 0) return;
        
        handleLog('WARNING', `⚠️ [一键全平] 正在市价全平 ${symbol} 的所有仓位 (共 ${targets.length} 笔)...`);
        for (const pos of targets) {
            handleClosePosition(pos.symbol, pos.side);
        }
        if (simulatorRef.current) {
            simulatorRef.current.closeAllPositionsForSymbol(symbol, '人工全平 (震荡熔断响应)');
        }
    }, [positions, handleClosePosition, handleLog]);

    const handleBatchClose = useCallback(async () => {
        const isReal = settingsRef.current.system.realTrading;
        if (isReal) {
            const apiKey = settingsRef.current.system.binanceApiKey;
            const apiSecret = settingsRef.current.system.binanceApiSecret;
            if (!apiKey || !apiSecret) {
                alert("错误: 实盘交易已开启，但未配置币安 API Key 或 Secret Key！");
                return;
            }

            const positionsToClose = combinedPositions.length > 0 ? combinedPositions : binanceRealPositions;
            const activePositionsToClose = positionsToClose.filter(p => p && p.amount > 0 && !p.isAmputatedToZero);

            if (activePositionsToClose.length === 0) {
                alert("没有当前持仓可以清仓。");
                return;
            }

            if (simulatorRef.current) {
                simulatorRef.current.addLog("INFO", `[实盘一键清仓] 启动分时段批量平仓，共 ${activePositionsToClose.length} 个仓位，按每秒提交6个币分批执行...`);
            }

            // 🔒 [平仓在途缓冲与自愈保护]：立即注册进入批量平仓缓冲池，防止5秒内因轮询未撮合完而误弹回
            if (simulatorRef.current) {
                simulatorRef.current.registerInFlightBatchClose(activePositionsToClose);
            }
            setBinanceRealPositions([]);
            setPositions([]);
            audioService.speak("批量平仓指令已分批发送");

            // 🚀 分时段平仓引擎：每秒钟最多提交6个币，下一秒再提交下一批6个币，彻底避免交易所并发拥塞与频率超限
            const BATCH_SIZE = 6;
            const chunks: typeof activePositionsToClose[] = [];
            for (let i = 0; i < activePositionsToClose.length; i += BATCH_SIZE) {
                chunks.push(activePositionsToClose.slice(i, i + BATCH_SIZE));
            }

            for (let batchIndex = 0; batchIndex < chunks.length; batchIndex++) {
                const currentChunk = chunks[batchIndex];

                // 非首批次，严格等待1秒间隔再提交
                if (batchIndex > 0) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                if (simulatorRef.current) {
                    simulatorRef.current.addLog("INFO", `[实盘一键清仓] 正在提交第 ${batchIndex + 1}/${chunks.length} 批平仓请求 (本批 ${currentChunk.length} 个币)...`);
                }

                const batchPromises = currentChunk.map(async (pos) => {
                    const cleanSymbol = normalizeSymbol(pos.symbol);
                    try {
                        if (simulatorRef.current) {
                            simulatorRef.current.addLog("INFO", `[实盘一键清仓] 正在平仓: ${cleanSymbol} ${pos.side} | 数量: ${pos.amount}`);
                        }
                        const fetchPromise = fetch("/api/binance/order", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                apiKey,
                                apiSecret,
                                symbol: cleanSymbol,
                                side: pos.side,
                                action: "CLOSE",
                                quantity: pos.amount
                            })
                        });

                        const timeoutPromise = new Promise<never>((_, reject) =>
                            setTimeout(() => reject(new Error("批量平仓网络响应超时 (25秒)")), 25000)
                        );

                        const response = await Promise.race([fetchPromise, timeoutPromise]) as Response;
                        const resData = await response.json();
                        if (response.ok && resData.success) {
                            if (simulatorRef.current) {
                                if (resData.orderId) {
                                    simulatorRef.current.registerExecutedOrderId(resData.orderId);
                                }
                                simulatorRef.current.addLog("SUCCESS", `⚡ [币安实盘] 平仓成功: ${cleanSymbol} ${pos.side} | ID: ${resData.orderId}`);
                                simulatorRef.current.recordRealTradeLog(pos, '一键全平', resData);
                                if (resData.trades && Array.isArray(resData.trades) && resData.trades.length > 0) {
                                    simulatorRef.current.reconcileRealTradesFromBinance(resData.trades);
                                } else if (resData.latestTrade) {
                                    simulatorRef.current.reconcileRealTradesFromBinance([resData.latestTrade]);
                                }
                                simulatorRef.current.removePositionLocally(cleanSymbol, pos.side);
                            }
                        } else {
                            const errMsg = resData.error || resData.message || "未知交易所错误";
                            if (simulatorRef.current) {
                                simulatorRef.current.addLog("DANGER", `⚡ [币安实盘] 平仓未获成功确认: ${cleanSymbol} | 原因: ${errMsg}`);
                            }
                        }
                    } catch (e: any) {
                        if (simulatorRef.current) {
                            simulatorRef.current.addLog("DANGER", `⚡ [币安实盘] 平仓网络/超时异常: ${pos.symbol} | 原因: ${e.message || e}`);
                        }
                    }
                });

                await Promise.all(batchPromises);
            }

            audioService.speak("实盘批量平仓完成");
            
            // Sync real-time positions instantly after order placement to show it immediately
            if (typeof (window as any).triggerApiSync === "function") {
                (window as any).triggerApiSync(true);
            }
        } else {
            // Simulated Batch Close
            simulatorRef.current?.batchCloseAllPositions();
            if (simulatorRef.current) {
                const currentPositions = simulatorRef.current.getPositions();
                const isReal = settingsRef.current.system.realTrading;
                const key = isReal ? 'SAVIOR_POSITIONS_LIVE' : 'SAVIOR_POSITIONS_SIM';
                localStorage.setItem(key, JSON.stringify(currentPositions));
                localStorage.setItem('SAVIOR_POSITIONS', JSON.stringify(currentPositions));
            }
        }
    }, [combinedPositions, binanceRealPositions]);

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
            const next = prev.map(p => normalizeSymbol(p.symbol) === cleanSymbol ? { ...p, customProfitSettings: customSettings } : p);
            const isReal = settingsRef.current.system.realTrading;
            const key = isReal ? 'SAVIOR_POSITIONS_LIVE' : 'SAVIOR_POSITIONS_SIM';
            localStorage.setItem(key, JSON.stringify(next));
            localStorage.setItem('SAVIOR_POSITIONS', JSON.stringify(next));
            return next;
        });
        if (simulatorRef.current) {
            const simPositions = simulatorRef.current.getPositions();
            const updated = simPositions.map(p => normalizeSymbol(p.symbol) === cleanSymbol ? { ...p, customProfitSettings: customSettings } : p);
            simulatorRef.current.setPositions(updated);
            const isReal = settingsRef.current.system.realTrading;
            const key = isReal ? 'SAVIOR_POSITIONS_LIVE' : 'SAVIOR_POSITIONS_SIM';
            localStorage.setItem(key, JSON.stringify(updated));
            localStorage.setItem('SAVIOR_POSITIONS', JSON.stringify(updated));
        }
    }, []);

    const handleBatchOpen = (simSettings: SimulationSettings) => {
        simulatorRef.current?.openBatchPositions('BTCUSDT', 'RANDOM', 5, 100, false, 'BOTH', '24H', 10);
    };

    const handleVerifyPosition = (position: Position) => {
        simulatorRef.current?.verifyPosition(position, tradeLogs);
    };

    const handleManualHedge = async (position: Position) => {
        const cleanSymbol = normalizeSymbol(position.symbol);
        const hedgeSide = position.side === PositionSide.LONG ? PositionSide.SHORT : PositionSide.LONG;
        
        // Prevent manual hedge duplication
        if (simulatorRef.current) {
            const activePositions = simulatorRef.current.getPositions();
            const existingHedge = activePositions.find(p => 
                normalizeSymbol(p.symbol) === cleanSymbol && 
                p.side === hedgeSide
            );
            if (existingHedge) {
                alert(`🛡️ [手动对冲拦截] 该品种已存在 ${hedgeSide} 方向的对冲单，请勿重复开仓！`);
                return;
            }
        }

        let activeHedgeRatio = settings.hedging?.hedgeRatio || 100;
        if (settings.stopLoss?.hedgeProfitClear) {
            activeHedgeRatio = settings.stopLoss?.hedgeOpenRatio || 100;
        } else if (settings.stopLoss?.callbackProfitClear) {
            activeHedgeRatio = settings.stopLoss?.callbackHedgeRatio || 100;
        }
        
        const livePrice = resolvePrice(position.symbol, realPrices, position.markPrice || position.entryPrice);
        const originalQty = position.initialAmount !== undefined ? position.initialAmount : position.amount;
        const initialCostUsdt = originalQty * (position.entryPrice || livePrice);
        const hedgeAmountUsdt = initialCostUsdt * (activeHedgeRatio / 100);

        if (settings.system.realTrading) {
            const apiKey = settings.system.binanceApiKey;
            const apiSecret = settings.system.binanceApiSecret;
            if (!apiKey || !apiSecret) {
                alert("错误: 实盘交易已开启，但未配置币安 API Key 或 Secret Key！");
                if (simulatorRef.current) {
                    simulatorRef.current.addLog("DANGER", "手动对冲失败: 未配置实盘 API 密钥");
                }
                return;
            }

            if (simulatorRef.current) {
                simulatorRef.current.addLog("INFO", `[实盘手动对冲] 正在向币安发送市价对冲开仓请求: ${cleanSymbol} ${hedgeSide} | 预估金额: ${hedgeAmountUsdt.toFixed(2)} U`);
            }

            try {
                const response = await fetch("/api/binance/order", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        apiKey,
                        apiSecret,
                        symbol: cleanSymbol,
                        side: hedgeSide,
                        action: "OPEN",
                        amountUsdt: hedgeAmountUsdt
                    })
                });

                const resData = await response.json();
                if (response.ok && resData.success) {
                    if (simulatorRef.current) {
                        if (resData.orderId) {
                            simulatorRef.current.registerExecutedOrderId(resData.orderId);
                        }
                        simulatorRef.current.addLog("SUCCESS", `⚡ [币安实盘] 手动对冲开仓成功: ${cleanSymbol} ${hedgeSide} | 数量: ${resData.qty} | ID: ${resData.orderId}`);
                    }
                    audioService.speak("实盘手动对冲成功");

                    if (typeof (window as any).triggerApiSync === "function") {
                        (window as any).triggerApiSync();
                    }

                    if (simulatorRef.current) {
                        const simPositions = simulatorRef.current.getPositions();
                        const found = simPositions.find(p => p.entryId === position.entryId);
                        if (found) {
                            found.isHedged = true;
                            if ('isUnshackled' in found) {
                                delete (found as any).isUnshackled;
                            }
                        }
                        
                        const entryId = 'HEDGE_' + Date.now().toString() + '_' + Math.random().toString(36).substring(2, 9);
                        const hedgePrice = resData.price || livePrice;
                        const hedgeQty = resData.qty || (hedgeAmountUsdt / hedgePrice);
                        const newHedge: Position = {
                            symbol: position.symbol,
                            side: hedgeSide,
                            amount: hedgeQty,
                            entryPrice: hedgePrice,
                            markPrice: hedgePrice,
                            liquidationPrice: hedgeSide === PositionSide.LONG ? hedgePrice * 0.5 : hedgePrice * 1.5,
                            unrealizedPnL: 0,
                            unrealizedPnLPercentage: 0,
                            entryId,
                            entryTime: Date.now(),
                            isHedged: true,
                            mainPositionId: position.entryId,
                            triggerReason: '手动点击对冲',
                            correlationId: position.correlationId,
                            reopenCount: position.reopenCount
                        };
                        
                        // Add single unified TradeLog for the hedge position BEFORE setPositions to prevent duplicate creation
                        const manualHedgeLog: TradeLog = {
                            symbol: cleanSymbol,
                            entry_id: entryId,
                            status: 'OPEN',
                            is_hedge: true,
                            main_entry_id: position.entryId,
                            entry_timestamp: Date.now(),
                            direction: hedgeSide,
                            cost_usdt: hedgeAmountUsdt,
                            entry_price: hedgePrice,
                            current_amount: hedgeQty,
                            correlationId: position.correlationId,
                            reopenCount: position.reopenCount,
                            events: [{
                                timestamp: Date.now(),
                                action: `防爆对冲开仓 (${hedgeSide})`,
                                price: hedgePrice,
                                amount: hedgeQty,
                                reason: '手动对冲开仓'
                            }]
                        };
                        simulatorRef.current.tradeLogs.unshift(manualHedgeLog);
                        setTradeLogs(prev => [manualHedgeLog, ...prev]);

                        // Add sub-event to main position log if it exists
                        const mainLog = simulatorRef.current.tradeLogs.find(l => l.entry_id === position.entryId);
                        if (mainLog) {
                            if (!mainLog.events) mainLog.events = [];
                            mainLog.events.push({
                                timestamp: Date.now(),
                                action: `对冲开启 (${hedgeSide})`,
                                price: hedgePrice,
                                amount: hedgeQty,
                                reason: '手动对冲开仓'
                            });
                        }

                        simPositions.push(newHedge);
                        simulatorRef.current.setPositions(simPositions);
                        simulatorRef.current.emitUpdate(true);
                    }
                } else {
                    const errMsg = resData.error || "未知交易所错误";
                    if (simulatorRef.current) {
                        simulatorRef.current.addLog("DANGER", `⚡ [币安实盘] 手动对冲失败: ${errMsg}`);
                    }
                    alert(`币安实盘手动对冲失败:\n${errMsg}`);
                }
            } catch (e: any) {
                if (simulatorRef.current) {
                    simulatorRef.current.addLog("DANGER", `⚡ [币安实盘] 手动对冲网络异常: ${e.message || e}`);
                }
                alert(`币安实盘手动对冲网络异常:\n${e.message || e}`);
            }
        } else {
            if (simulatorRef.current) {
                simulatorRef.current.addLog("INFO", `[模拟对冲] 手动触发对冲: ${cleanSymbol} ${hedgeSide} | 金额: ${hedgeAmountUsdt.toFixed(2)} U`);
                simulatorRef.current.openHedgePosition(position, hedgeSide, hedgeAmountUsdt, livePrice, '手动对冲');
                setPositions([...simulatorRef.current.getPositions()]);
            }
        }
    };

    const handleApplyRecommendation = (rec: any) => {
        simulatorRef.current?.applyStrategyRecommendation(rec);
        setRecommendation(null);
    };

    // Periodic persistence
    useEffect(() => {
        const interval = setInterval(() => {
            if (isProcessingRef.current) return;
            const isReal = settingsRef.current.system.realTrading;
            
            // Determine active keys
            const accountKey = isReal ? 'SAVIOR_ACCOUNT_LIVE' : 'SAVIOR_ACCOUNT_SIM';
            const positionsKey = isReal ? 'SAVIOR_POSITIONS_LIVE' : 'SAVIOR_POSITIONS_SIM';
            const tradeLogsKey = isReal ? 'SAVIOR_TRADELOGS_LIVE' : 'SAVIOR_TRADELOGS_SIM';
            
            saveState(accountKey, accountRef.current);
            saveState(positionsKey, positionsRef.current);
            saveState(tradeLogsKey, tradeLogsRef.current, 800);
            
            // Standard/fallback keys
            saveState('SAVIOR_ACCOUNT', accountRef.current);
            saveState('SAVIOR_POSITIONS', positionsRef.current);
            saveState('SAVIOR_TRADELOGS', tradeLogsRef.current, 800);
            
            saveState('SAVIOR_LOGS', logsRef.current, 150);
            saveState('SAVIOR_SETTINGS', settingsRef.current);
        }, 5000);
        
        // Immediate persistence on unload
        const handleBeforeUnload = () => {
            const isReal = settingsRef.current.system.realTrading;
            
            const accountKey = isReal ? 'SAVIOR_ACCOUNT_LIVE' : 'SAVIOR_ACCOUNT_SIM';
            const positionsKey = isReal ? 'SAVIOR_POSITIONS_LIVE' : 'SAVIOR_POSITIONS_SIM';
            const tradeLogsKey = isReal ? 'SAVIOR_TRADELOGS_LIVE' : 'SAVIOR_TRADELOGS_SIM';
            
            saveState(accountKey, accountRef.current);
            saveState(positionsKey, positionsRef.current);
            saveState(tradeLogsKey, tradeLogsRef.current, 800);
            
            saveState('SAVIOR_ACCOUNT', accountRef.current);
            saveState('SAVIOR_POSITIONS', positionsRef.current);
            saveState('SAVIOR_TRADELOGS', tradeLogsRef.current, 800);
            
            saveState('SAVIOR_LOGS', logsRef.current, 150);
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
                handleLog('DANGER', '行情连接延迟，系统正在尝试自动重连...');
                audioService.speak("提示：行情网络延迟，正在尝试后台自动重连", true);
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
            <ActivationModal onActivated={() => setIsSystemActivated(true)} />
            
            <div className={`flex flex-1 min-w-0 transition-all duration-300 ${!isSystemActivated ? 'filter blur-2xl opacity-10' : ''}`}>
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
                            onManualHedge={handleManualHedge}
                            onShowHistory={(symbol) => {
                                setTradeLogSearchSymbol(symbol);
                                setShowTradeLogModal(true);
                            }}
                            hasHistory={() => tradeLogs.length > 0}
                            manuallyClosedSymbols={manuallyClosedSymbols}
                            onClearPositions={handleBatchClose}
                            onClosePosition={handleClosePosition}
                            onDeletePosition={handleClosePosition}
                            onBatchClose={handleBatchClose}
                            onResetBalance={(amount) => simulatorRef.current?.resetMarginBalance(amount)}
                            onClearRecords={() => {
                                setTradeLogs([]);
                                setSystemEvents([]);
                                const isReal = settingsRef.current.system.realTrading;
                                localStorage.removeItem(isReal ? 'SAVIOR_TRADELOGS_LIVE' : 'SAVIOR_TRADELOGS_SIM');
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
                            onClearLogs={() => setLogs([])}
                        />
                    </div>
                )}
            </div>
            </div>

            {/* KEEP-ALIVE SCANNER */}
            <ErrorBoundary moduleName="全域扫描终端 (Scanner Core)">
                <ScannerDashboard 
                    networkStatus={networkStatus}
                    isOnline={isOnline}
                    settings={settings.scanner} 
                    isVisible={isSystemActivated && showScanner}
                    onClose={() => setShowScanner(false)}
                    onOpenPosition={handleOpenPosition}
                    onClosePosition={handleClosePosition}
                    onBatchClose={handleBatchClose}
                    realPrices={realPrices}
                    activePositions={combinedPositions}
                    balance={account.marginBalance}
                    directMode={settings.system.directMode}
                    onLog={handleLog}
                    logs={logs}
                    onBacktestPositionsUpdate={handleBacktestPositionsUpdate}
                    isRealTrading={settings.system.realTrading}
                    onAddTradeLog={(logItem: TradeLog) => {
                        setTradeLogs(prev => [logItem, ...prev]);
                        if (simulatorRef.current) {
                            simulatorRef.current.tradeLogs.unshift(logItem);
                            simulatorRef.current.emitUpdate(true);
                        }
                    }}
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
                            const isReal = settingsRef.current.system.realTrading;
                            localStorage.removeItem(isReal ? 'SAVIOR_TRADELOGS_LIVE' : 'SAVIOR_TRADELOGS_SIM');
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

            {fuseAlertData && (
                <FuseAlertModal 
                    data={fuseAlertData}
                    onClose={() => setFuseAlertData(null)}
                    onCloseAll={handleCloseAllForSymbol}
                    onResetAndResume={(sym) => {
                        simulatorRef.current?.resetOscillationLock(sym);
                        handleLog('SUCCESS', `已重置 ${sym} 震荡磨损熔断计数并恢复自动策略监控`);
                    }}
                />
            )}
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
