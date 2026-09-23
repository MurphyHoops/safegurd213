
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
import StrategyAdvisorWidget from './components/StrategyAdvisorWidget';
import { fetchWithFallback } from './services/apiService'; 
import { audioService } from './services/audioService';
import { logger } from './services/monitor/monitorService';
import { MarketProvider } from './store/MarketContext';
import { BackgroundTimer } from './services/backgroundTask'; 
import { ErrorBoundary } from './components/ErrorBoundary';
import { usePersistedState } from './hooks/usePersistedState';
import { binanceWs } from './services/binanceWs';
import { normalizeSymbol, resolvePrice, isMajorCoin, isMemeScaledCoin } from './services/symbolUtils';
import KlineChartModal from './components/KlineChartModal';
import { FuseAlertModal, FuseAlertData } from './components/FuseAlertModal';
import { WifiOff, RefreshCw, ShieldAlert, Activity, Loader2, Zap, Clock, AlertTriangle, Trash2 } from 'lucide-react'; 
import { 
    setBinanceLogSink, 
    installBinanceFetchInterceptor, 
    logBinancePushEvent, 
    logBinanceOutboundRequest, 
    logBinanceInboundResponse, 
    translateBinanceError, 
    formatCoin,
    binanceFetch
} from './services/binanceLogger';

// 🔒 @LOCKED: 模块内部直接绑定币安审计 Fetch，防范特定浏览器/iframe环境对 window.fetch 的只读限制
const fetch = binanceFetch;

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
            const raw = loadState<any>(key, loadState<any>(fallbackKey, { marginBalance: 10000, totalBalance: 10000, maintenanceMargin: 0, marginRatio: 999 }));
            return {
                ...raw,
                marginBalance: typeof raw?.marginBalance === 'number' && !isNaN(raw.marginBalance) ? raw.marginBalance : 10000,
                totalBalance: typeof raw?.totalBalance === 'number' && !isNaN(raw.totalBalance) ? raw.totalBalance : 10000,
                maintenanceMargin: typeof raw?.maintenanceMargin === 'number' && !isNaN(raw.maintenanceMargin) ? raw.maintenanceMargin : 0,
                marginRatio: typeof raw?.marginRatio === 'number' && !isNaN(raw.marginRatio) ? raw.marginRatio : 999
            };
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
                .filter(p => p && typeof p === 'object' && p.symbol && (p.amount || 0) > 0.0001)
                .map(p => ({
                    ...p,
                    symbol: normalizeSymbol(p.symbol || ''),
                    amount: Number(p.amount) || 0,
                    entryPrice: Number(p.entryPrice) || 0,
                    markPrice: Number(p.markPrice) || Number(p.entryPrice) || 0,
                    unrealizedPnL: Number(p.unrealizedPnL) || 0,
                    unrealizedPnLPercentage: Number(p.unrealizedPnLPercentage) || 0,
                    cumulativeAmputationLoss: Number(p.cumulativeAmputationLoss) || 0,
                    cumulativeHedgeLoss: Number(p.cumulativeHedgeLoss) || 0,
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
    const [systemEvents, setSystemEvents] = useState<SystemEvent[]>([]);
    const [realPrices, setRealPrices] = useState<Record<string, number>>({});
    const lastUiUpdateRef = useRef<number>(0);
    const lastInstantTickRef = useRef<number>(0);
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
            return positions.filter(p => p && (p.amount || 0) > 0.0001 && !p.isAmputatedToZero && !p.isBeingClosed);
        }
        return [...positions, ...backtestPositions].filter(p => p && (p.amount || 0) > 0.0001 && !p.isAmputatedToZero && !p.isBeingClosed);
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

    const handleLog = useCallback((type: 'INFO' | 'SUCCESS' | 'WARNING' | 'DANGER', message: string, immediate = false, extraMeta?: Partial<LogEntry>) => {
        // 自动解析链路 Chain ID
        let detectedChainId = extraMeta?.chainId;
        if (!detectedChainId) {
            const chainMatch = message.match(/CHAIN-[A-Z0-9]+-[0-9]+/i) || message.match(/CHAIN_[A-Z0-9]+_[0-9]+/i);
            if (chainMatch) detectedChainId = chainMatch[0];
        }

        // 自动解析分类 Category
        let detectedCategory = extraMeta?.category;
        if (!detectedCategory) {
            if (type === 'DANGER' || message.includes('异常') || message.includes('拒绝') || message.includes('报错') || message.includes('拦截')) {
                detectedCategory = 'ERROR';
            } else if (message.includes('实现盈亏') || message.includes('毛盈亏') || message.includes('纯利') || message.includes('平仓')) {
                detectedCategory = 'PNL';
            } else if (message.includes('对冲') || message.includes('断臂') || message.includes('砍仓') || message.includes('补仓') || message.includes('救赎') || message.includes('净敞口')) {
                detectedCategory = 'HEDGE';
            } else if (message.includes('【手动') || message.includes('手动操作') || message.includes('手动市价')) {
                detectedCategory = 'MANUAL';
            } else if (message.includes('【自动') || message.includes('策略信号') || message.includes('自动策略')) {
                detectedCategory = 'AUTO';
            } else {
                detectedCategory = 'ALL';
            }
        }

        const newEntry: LogEntry = {
            id: Date.now().toString() + Math.random(),
            timestamp: new Date(),
            type,
            message,
            category: detectedCategory,
            chainId: detectedChainId,
            ...extraMeta
        };

        if (immediate) {
            // 🔒 [毫秒级即时日志穿透] 对开平仓、向币安发送交易等高优先级关键事件立即直推 UI，零缓冲延迟
            setLogs(prev => [newEntry, ...prev].slice(0, 500));
            lastLogUpdateRef.current = Date.now();
            return;
        }

        logsPendingRef.current.unshift(newEntry);
        
        const now = Date.now();
        // 如果距离上次更新不足 500ms，则缓冲（List 2 高频扫描时非常有用）
        if (now - lastLogUpdateRef.current > 500) {
            setTimeout(() => {
                updateLogsFromBuffer();
            }, 0);
        }
    }, [updateLogsFromBuffer]);

    // 🔒 @LOCKED: 币安全域请求与响应中文日志审计注册（零遗漏即时推送到系统日志）
    useEffect(() => {
        setBinanceLogSink(handleLog);
        installBinanceFetchInterceptor();
    }, [handleLog]);

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
    const [logPanelHeight, setLogPanelHeight] = usePersistedState<number>('SAVIOR_LOG_PANEL_HEIGHT', 220);
    const isDraggingLogPanelRef = useRef<boolean>(false);
    const logDragStartYRef = useRef<number>(0);
    const logDragStartHeightRef = useRef<number>(220);

    const handleLogPanelMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isDraggingLogPanelRef.current = true;
        logDragStartYRef.current = e.clientY;
        logDragStartHeightRef.current = logPanelHeight;

        const handleMouseMove = (moveEvent: MouseEvent) => {
            if (!isDraggingLogPanelRef.current) return;
            const deltaY = moveEvent.clientY - logDragStartYRef.current;
            // 向上拖拽 (deltaY < 0) => 高度变大；向下拖拽 (deltaY > 0) => 高度变小
            const newHeight = Math.min(Math.max(logDragStartHeightRef.current - deltaY, 120), 750);
            setLogPanelHeight(newHeight);
        };

        const handleMouseUp = () => {
            isDraggingLogPanelRef.current = false;
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    }, [logPanelHeight, setLogPanelHeight]);
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

    const [isInitializing, setIsInitializing] = useState(false);
    const [bootError, setBootError] = useState<string | null>(null);

    // --- MAIN MOUNTED FLAG & PANIC SELF-HEALING ---
    useEffect(() => {
        (window as any).__MAIN_APP_MOUNTED__ = true;
        console.log("🛡️ [System Guard] Main app successfully mounted. Clearing any false-alarm panic UI.");
        const panic = document.getElementById('panic-ui');
        if (panic) {
            panic.remove();
        }
        const shield = document.getElementById('boot-shield');
        if (shield) {
            shield.remove();
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
            if (!cleanSymbol || cleanSymbol.trim() === '') {
                alert(`⚠️ 币种识别错误: 无法识别币种 "${symbol}"，请输入有效英文代码（如 LOBSTER 或 BTC）！`);
                handleLog("DANGER", `⚠️ 手动开仓失败: 无法识别币种 "${symbol}"`, true);
                if (simulatorRef.current) {
                    simulatorRef.current.addLog("DANGER", `⚠️ 手动开仓失败: 无法识别币种 "${symbol}"`);
                }
                return;
            }
            const blacklist = settingsRef.current.system.symbolBlacklist || [];
            if (blacklist.includes(cleanSymbol)) {
                alert(`⚠️ 币种拦截: ${cleanSymbol} 处于黑名单中，拒绝手动开仓！`);
                handleLog("WARNING", `⚠️ 手动开仓被拦截: ${cleanSymbol} 处于黑名单中`, true);
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
                    handleLog("DANGER", "手动开仓失败: 未配置实盘 API 密钥", true);
                    if (simulatorRef.current) {
                        simulatorRef.current.addLog("DANGER", "手动开仓失败: 未配置实盘 API 密钥");
                    }
                    return;
                }

                const estCostUsdt = Number(amountUsdt || (qty * (customPrice || priceBufferRef.current[cleanSymbol] || 1)) || 0).toFixed(2);
                const estQtyStr = qty ? `${qty}` : (amountUsdt && customPrice ? (amountUsdt / customPrice).toFixed(4) : '--');
                const sendMsg = `[实盘开仓] 正在向币安发送手动市价开仓请求: ${cleanSymbol} ${side} | 杠杆: ${leverage || 20}x | 数量: ${estQtyStr} (约 ${estCostUsdt} USDT) | 预估金额: ${estCostUsdt} USDT`;
                handleLog("INFO", sendMsg, true);
                if (simulatorRef.current) {
                    simulatorRef.current.addLog("INFO", sendMsg);
                }

                try {
                    const reqBody: any = {
                        apiKey,
                        apiSecret,
                        symbol: cleanSymbol,
                        side: side,
                        action: "OPEN",
                        leverage: leverage || 20,
                        isManual: true,
                        reason: `用户手动市价开仓 (${side === 'LONG' ? '做多' : '做空'})`
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
                        const finalPrice = resData.price || customPrice || priceBufferRef.current[cleanSymbol] || 0;
                        const finalCost = Number(resData.cumQuote || amountUsdt || (qty * finalPrice) || 0);
                        const finalQty = Number(resData.qty || qty || (finalCost / (finalPrice || 1)) || 0);
                        const successMsg = `⚡ [币安实盘] 手动开仓成功: ${cleanSymbol} ${side} | 数量: ${finalQty.toFixed(4)} (约 ${finalCost.toFixed(2)} USDT) | 开仓均价: ${finalPrice.toFixed(4)} | ID: ${resData.orderId}`;
                        handleLog("SUCCESS", successMsg, true);
                        if (simulatorRef.current) {
                            if (resData.orderId) {
                                simulatorRef.current.registerExecutedOrderId(resData.orderId);
                            }
                            simulatorRef.current.addLog("SUCCESS", successMsg);
                        }
                        audioService.speak("实盘开仓执行成功");

                        // Add manual log and optimistic position to simulator and React state immediately
                        if (simulatorRef.current) {
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
                        const failMsg = `⚡ [币安实盘] 手动开仓失败: ${errMsg}`;
                        handleLog("DANGER", failMsg, true);
                        if (simulatorRef.current) {
                            simulatorRef.current.addLog("DANGER", failMsg);
                        }
                        alert(`币安实盘开仓失败:\n${errMsg}`);
                        audioService.speak("实盘开仓失败");
                    }
                } catch (e: any) {
                    const netErrMsg = `⚡ [币安实盘] 手动开仓网络异常: ${e.message || e}`;
                    handleLog("DANGER", netErrMsg, true);
                    if (simulatorRef.current) {
                        simulatorRef.current.addLog("DANGER", netErrMsg);
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

                    handleLog("INFO", `[模拟开仓] 正在执行手动市价开仓: ${cleanSymbol} ${side} | 预估金额: ${costUsdt.toFixed(2)} U`, true);

                    simulatorRef.current.openPosition(cleanSymbol, side, costUsdt, finalPrice, '1m', undefined, undefined, { 
                        isReopened: false,
                        strategyId: activeStrategyId,
                        isManual: true
                    });
                    setPositions([...simulatorRef.current.getPositions()]);
                    const simUsdt = (costUsdt).toFixed(2);
                    handleLog("SUCCESS", `🛡️ [模拟开仓] 手动开仓成功: ${cleanSymbol} ${side} | 数量: ${(costUsdt / (finalPrice || 1)).toFixed(4)} (约 ${simUsdt} USDT) | 成交价: ${finalPrice}`, true);
                }
            }
        }; // 🔒 [LOCKED - MANUAL ORDER OPENING & MILLISECOND LOG ENGINE]

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
        let heartbeatInterval: any;
        let isIntentionalClose = false;
        let hasConnectedOnce = false;
        let disconnectLogTimer: any = null;

        const connectWebSocket = () => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(`${protocol}//${window.location.host}`);
            
            ws.onopen = () => {
                console.log('✅ Connected to Trading Engine Server');
                logger.info('WS', 'WebSocket 交易引擎已连接');
                
                // If a disconnect warning was queued, cancel it since we reconnected quickly
                if (disconnectLogTimer) {
                    clearTimeout(disconnectLogTimer);
                    disconnectLogTimer = null;
                }

                // Active keepalive heartbeat every 12 seconds to prevent Cloud Run / proxy idle timeouts
                clearInterval(heartbeatInterval);
                heartbeatInterval = setInterval(() => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        try {
                            ws.send(JSON.stringify({ type: 'PING' }));
                            if (settingsRef.current?.system?.binanceApiKey) {
                                ws.send(JSON.stringify({ type: 'REGISTER_BINANCE_API', apiKey: settingsRef.current.system.binanceApiKey }));
                            }
                        } catch (e) {}
                    }
                }, 12000);
                
                // If we are reconnecting after a drop, just log it once
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
                    } else if (data.type === 'BINANCE_ORDER_TRADE_UPDATE' && data.data) {
                        logBinancePushEvent('TRADE_UPDATE', data.data);
                        try {
                            window.dispatchEvent(new CustomEvent("BINANCE_TRADE_CONFIRMED", { detail: data.data }));
                        } catch (e) {}
                    } else if (data.type === 'BINANCE_ACCOUNT_UPDATE' && data.data) {
                        logBinancePushEvent('ACCOUNT_UPDATE', data.data);
                    }
                } catch (e) {
                    console.error('Failed to parse WS message', e);
                }
            };

            ws.onclose = () => {
                clearInterval(heartbeatInterval);
                if (isIntentionalClose) return;
                
                console.log('❌ Disconnected from Trading Engine Server. Attempting to reconnect...');
                logger.warn('WS', 'WebSocket 掉线，正在尝试自动重连...');
                
                // Anti-flapping: only push warning to log if disconnect persists for > 4 seconds
                if (!disconnectLogTimer) {
                    disconnectLogTimer = setTimeout(() => {
                        setLogs(prev => [{
                            id: `ws-close-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                            timestamp: new Date(),
                            type: 'DANGER',
                            message: '与云端交易引擎断开连接，正在尝试重新连接...'
                        }, ...prev]);
                        disconnectLogTimer = null;
                    }, 4000);
                }
                
                // Try to reconnect every 2.5 seconds
                clearTimeout(reconnectTimer);
                reconnectTimer = setTimeout(connectWebSocket, 2500);
            };
            
            ws.onerror = (error) => {
                console.warn('WebSocket connection status update:', error);
                ws.close(); // Force close to trigger reconnect
            };
        };

        connectWebSocket();

        return () => {
            isIntentionalClose = true;
            clearInterval(heartbeatInterval);
            clearTimeout(reconnectTimer);
            if (disconnectLogTimer) clearTimeout(disconnectLogTimer);
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
                
                // CRITICAL INSTANT-TICK (Throttled to 100ms max to prevent CPU thread starvation when holding 20+ positions):
                const simPositionsCount = simulatorRef.current.getPositions().length;
                const nowTick = Date.now();
                if ((simPositionsCount > 0 || activePositionsRef.current.length > 0) && (nowTick - lastInstantTickRef.current >= 100)) {
                    lastInstantTickRef.current = nowTick;
                    try {
                        simulatorRef.current.tick(true);
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

        let networkHealthDebounceTimer: any = null;
        let lastReportedHealthState: boolean | null = null;

        const unsubscribeStatus = binanceWs.subscribeStatus((status) => {
            const timeSinceLastMessage = status.lastMessageTime > 0 ? (Date.now() - status.lastMessageTime) : 0;
            // As long as we receive data (via WS or REST fallback) within 60s, engine handles it as healthy/delayed
            const isHealthy = status.isConnected || (status.lastMessageTime > 0 && timeSinceLastMessage < 60000);
            
            setNetworkStatus(prev => {
                let nextStatus: 'healthy' | 'delayed' | 'disconnected' = 'disconnected';
                if (status.isConnected && timeSinceLastMessage < 20000) nextStatus = 'healthy';
                else if (timeSinceLastMessage < 60000) nextStatus = 'delayed';
                else nextStatus = 'disconnected';
                return prev === nextStatus ? prev : nextStatus;
            });

            // Anti-jitter hysteresis filter:
            // If connection is healthy, restore immediately (0ms) and cancel any pending disconnect alert
            if (isHealthy) {
                if (networkHealthDebounceTimer) {
                    clearTimeout(networkHealthDebounceTimer);
                    networkHealthDebounceTimer = null;
                }
                if (lastReportedHealthState !== true) {
                    lastReportedHealthState = true;
                    if (simulatorRef.current) {
                        simulatorRef.current.updateNetworkStatus(true);
                    }
                }
            } else {
                // If temporarily unhealthy, require at least 5 seconds of sustained disconnect to avoid 50ms socket flapping
                if (!networkHealthDebounceTimer && lastReportedHealthState !== false) {
                    networkHealthDebounceTimer = setTimeout(() => {
                        lastReportedHealthState = false;
                        if (simulatorRef.current) {
                            simulatorRef.current.updateNetworkStatus(false);
                        }
                        networkHealthDebounceTimer = null;
                    }, 5000);
                }
            }
        });

        return () => {
            if (networkHealthDebounceTimer) clearTimeout(networkHealthDebounceTimer);
            unsubscribePrices();
            unsubscribeStatus();
        };
    }, []);

    // --- VIP DEDICATED WEBSOCKET STREAMS FOR ACTIVE POSITIONS ---
    const activeSymbolsKey = React.useMemo(() => {
        return combinedPositions.map(p => p.symbol).filter(Boolean).sort().join(',');
    }, [combinedPositions]);

    useEffect(() => {
        const symbols = activeSymbolsKey ? activeSymbolsKey.split(',') : [];
        binanceWs.syncActivePositions(symbols);
    }, [activeSymbolsKey]);

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
    const pendingOpenPositionsRef = useRef<Set<string>>(new Set());
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
                    
                    if (
                        Math.abs((prev.totalBalance || 0) - totalBalance) < 0.001 &&
                        Math.abs((prev.unrealizedPnL || 0) - totalUnrealizedPnL) < 0.001 &&
                        Math.abs((prev.marginBalance || 0) - realBalance) < 0.001 &&
                        Math.abs((prev.maintenanceMargin || 0) - maintMargin) < 0.001 &&
                        Math.abs((prev.marginRatio || 0) - marginRatio) < 0.01
                    ) {
                        return prev;
                    }

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
                    Math.abs(prev.marginRatio - newAccount.marginRatio) < 0.01 &&
                    Math.abs(prev.totalBalance - newAccount.totalBalance) < 0.01 &&
                    Math.abs(prev.unrealizedPnL - (newAccount.unrealizedPnL || 0)) < 0.01) {
                    return prev;
                }
                return { ...newAccount };
            });

            setPositions(prev => {
                const nonZero = newPositions.filter(p => (p.amount || 0) > 0.0001);
                const sanitized = nonZero.map(p => {
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
        sim.onLog = (type, message, immediate) => {
            handleLog(type, message, immediate);
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
        let pingTimer: any = null;
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
                    if (pingTimer) clearInterval(pingTimer);
                    pingTimer = setInterval(() => {
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            try { ws.send(JSON.stringify({ type: "PING" })); } catch (e) {}
                        }
                    }, 8000);
                };

                ws.onmessage = (event) => {
                    try {
                        const msg = JSON.parse(event.data);
                        if (msg.type === "PONG") {
                            // Backend heartbeat alive
                            return;
                        }
                        if (msg.type === "BINANCE_ORDER_TRADE_UPDATE" && msg.data) {
                            const tradeData = msg.data;
                            console.log("⚡ [Binance Instant Execution]:", tradeData);
                            logBinancePushEvent('TRADE_UPDATE', tradeData);
                            try {
                                window.dispatchEvent(new CustomEvent("BINANCE_TRADE_CONFIRMED", { detail: tradeData }));
                            } catch (e) {}
                            if (simulatorRef.current) {
                                simulatorRef.current.handleInstantBinanceTrade(tradeData);
                                setTradeLogs([...simulatorRef.current.tradeLogs]);
                                tradeLogsRef.current = [...simulatorRef.current.tradeLogs];
                                setPositions([...simulatorRef.current.getPositions()]);
                                setBinanceRealPositions([...simulatorRef.current.getPositions()]);

                                // ⚡ 0毫秒立即释放该币种在途锁并唤醒策略引擎
                                const cleanSym = normalizeSymbol(tradeData.symbol);
                                pendingHedgesRef.current.delete(cleanSym);
                                pendingHedgesRef.current.delete(`${cleanSym}_LONG`);
                                pendingHedgesRef.current.delete(`${cleanSym}_SHORT`);
                                inFlightRefillRef.current.delete(`${cleanSym}_LONG`);
                                inFlightRefillRef.current.delete(`${cleanSym}_SHORT`);
                                pendingClosesRef.current.delete(`${cleanSym}_LONG`);
                                pendingClosesRef.current.delete(`${cleanSym}_SHORT`);
                                simulatorRef.current.emitUpdate(true);
                            }
                            
                            // 收到平仓事件后，触发真实持仓与资金对账同步（无需重复启动已被WS确认的流水抓取轮询）
                            if (typeof (window as any).triggerApiSync === "function") {
                                (window as any).triggerApiSync(false);
                            }
                        } else if (msg.type === "BINANCE_ACCOUNT_UPDATE" && msg.data) {
                            const accData = msg.data;
                            console.log("⚡ [Binance Instant Account Update]:", accData);
                            logBinancePushEvent('ACCOUNT_UPDATE', accData);
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
                    if (pingTimer) clearInterval(pingTimer);
                    if (!isClosed) {
                        clearTimeout(reconnectTimer);
                        reconnectTimer = setTimeout(connectStreamWs, 1000);
                    }
                };
            } catch (err) {
                if (pingTimer) clearInterval(pingTimer);
                if (!isClosed) {
                    clearTimeout(reconnectTimer);
                    reconnectTimer = setTimeout(connectStreamWs, 1000);
                }
            }
        };

        connectStreamWs();

        return () => {
            isClosed = true;
            if (pingTimer) clearInterval(pingTimer);
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
        let lastUserTradesFetchTime = 0;

        const fetchRealState = async (silent = true, force = false) => {
            if (isSyncing && !force) return;
            if (Date.now() < rateLimitBackoffUntil && !force) {
                return;
            }

            isSyncing = true;
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 12000); // 12s timeout
                
                const response = await fetch("/api/binance/validate-and-balance", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ apiKey, apiSecret, force, bypassCache: force }),
                    signal: controller.signal
                });
                
                clearTimeout(timeout);
                
                if (response.ok) {
                    const text = await response.text();
                    if (!text || !text.trim()) {
                        return { success: false };
                    }
                    if (text.trim().startsWith('<') || text.toLowerCase().includes('doctype html')) {
                        console.warn("[Binance Background Sync] Received HTML error page instead of JSON. Server might be restarting or unresponsive.");
                        return;
                    }
                    let data: any = null;
                    try {
                        data = JSON.parse(text);
                    } catch (parseErr) {
                        console.warn("[Binance Background Sync] JSON parse error:", parseErr);
                        return { success: false, error: "JSON parse error" };
                    }
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
                        
                        if (simulatorRef.current) {
                            simulatorRef.current.setPositions(realPositions);
                            const enrichedPositions = simulatorRef.current.getPositions();
                            setBinanceRealPositions(enrichedPositions);
                            setPositions(enrichedPositions);
                        } else {
                            setBinanceRealPositions(realPositions);
                            setPositions(realPositions);
                        }

                        // --- 🔒 REAL TRADES RECONCILIATION FROM BINANCE (userTrades) ---
                        // Fetch official executed trades from Binance (throttled to once per 180s in background to preserve rate limits, instant on force)
                        const shouldFetchTrades = force || (Date.now() - lastUserTradesFetchTime > 180000);
                        if (shouldFetchTrades) {
                            lastUserTradesFetchTime = Date.now();
                            // 异步非阻塞执行流水核对，让基础持仓与资金状态先行秒级响应完成，彻底杜绝转圈卡死
                            (async () => {
                                try {
                                    const lookbackHours = settingsRef.current?.system?.syncHistoryLookbackHours || 1;
                                    const lookbackMs = lookbackHours * 3600 * 1000;
                                    const recentLogSymbols = simulatorRef.current 
                                        ? simulatorRef.current.tradeLogs.slice(0, 10).map(l => l.symbol).filter(Boolean)
                                        : [];
                                    const activeSymbols = Array.from(new Set([
                                        ...realPositions.map((p: any) => p.symbol),
                                        ...recentLogSymbols,
                                        ...(tradeLogSearchSymbol ? [tradeLogSearchSymbol] : [])
                                    ].filter(Boolean))).slice(0, 15);

                                    if (activeSymbols.length > 0) {
                                        const controller = new AbortController();
                                        const fetchTimeout = setTimeout(() => controller.abort(), 6000);
                                        const tradeResp = await fetch("/api/binance/user-trades", {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({
                                                apiKey,
                                                apiSecret,
                                                symbols: activeSymbols,
                                                startTime: Math.max(
                                                    simulatorRef.current?.clearedTradeLogsTimestamp || 0,
                                                    Date.now() - lookbackMs // 可配置流水回溯（默认1小时），数据精炼响应极速
                                                ),
                                                limit: 50
                                            }),
                                            signal: controller.signal
                                        });
                                        clearTimeout(fetchTimeout);
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
                            })();
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
                        return data;
                    } else {
                        if (data && data.rateLimited) {
                            rateLimitBackoffUntil = Date.now() + 20000;
                            console.warn("[Binance Background Sync] Rate limit reached. Backing off for 20s...");
                        } else {
                            if (data?.error) {
                                console.warn("[Binance Background Sync] API Sync Notice:", data.error);
                            }
                            if (data && (data.code === -2015 || (typeof data.error === 'string' && (data.error.includes('-2015') || data.error.includes('权限不足'))))) {
                                handleLog('DANGER', '⚠️ 币安 API 密钥无效或权限不足！请检查是否已正确开启“期货交易 (Enable Futures)”权限，并检查 IP 白名单设置。');
                            }
                        }
                        return data || { success: false };
                    }
                } else if (response.status === 429) {
                    rateLimitBackoffUntil = Date.now() + 20000;
                    console.warn("[Binance Background Sync] HTTP 429 Rate limit exceeded. Backing off for 20s...");
                    return { success: false, rateLimited: true };
                } else {
                    const errorText = await response.text();
                    console.warn("[Binance Background Sync] Request Notice:", response.status, errorText);
                    return { success: false, error: errorText };
                }
            } catch (err: any) {
                if (err && (err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('abort'))) {
                    console.log("[Binance Background Sync] Request was aborted gracefully.");
                } else {
                    console.warn("[Binance Background Sync] Sync transient failure:", err.message || err);
                }
                return { success: false, error: err?.message || String(err) };
            } finally {
                isSyncing = false;
            }
        };

        // ⚡ 极速主动抓取指定币种成交记录通道 (Fast-Track Trade Fetching)
        const fetchInstantTradeRecords = async (targetSymbol: string, orderId?: string | number, action?: string): Promise<boolean> => {
            if (!targetSymbol) return false;
            const cleanSym = normalizeSymbol(targetSymbol);
            const apiKey = settingsRef.current.system.binanceApiKey;
            const apiSecret = settingsRef.current.system.binanceApiSecret;
            if (!apiKey || !apiSecret || !settingsRef.current.system.realTrading) return false;

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

                            // ⚡ 0毫秒立即释放该币种在途锁并唤醒策略引擎
                            pendingHedgesRef.current.delete(cleanSym);
                            pendingHedgesRef.current.delete(`${cleanSym}_LONG`);
                            pendingHedgesRef.current.delete(`${cleanSym}_SHORT`);
                            inFlightRefillRef.current.delete(`${cleanSym}_LONG`);
                            inFlightRefillRef.current.delete(`${cleanSym}_SHORT`);
                            pendingClosesRef.current.delete(`${cleanSym}_LONG`);
                            pendingClosesRef.current.delete(`${cleanSym}_SHORT`);
                            simulatorRef.current.emitUpdate(true);
                        }
                        // 如果指定了 orderId，且已成功匹配对账，返回 true 提示已确认；若未匹配则返回 false 继续探针
                        if (orderId && Array.isArray(data.trades)) {
                            const matched = data.trades.some((t: any) => String(t.orderId) === String(orderId));
                            if (matched) return true;
                            return false;
                        }
                        return true;
                    }
                }
            } catch (e) {
                // Background safe probe catch
            }
            return false;
        };

        // 存储当前正在轮询中的币种定时器，严格防止单币或并发重复创建定时器风暴
        const activePollingSymbols = new Map<string, any>();

        const triggerInstantTradeFetch = (targetSymbol: string, orderId?: string | number, action?: string) => {
            if (!targetSymbol) return;
            const cleanSym = normalizeSymbol(targetSymbol);

            // 🛡️ 防重机制：如果该币种已存在轮询定时器，先清除旧定时器，防止多个并发定时器轰炸交易所
            if (activePollingSymbols.has(cleanSym)) {
                clearInterval(activePollingSymbols.get(cleanSym));
                activePollingSymbols.delete(cleanSym);
            }

            // 阶段 1：0ms 立即执行首轮快速主动抓取
            fetchInstantTradeRecords(targetSymbol, orderId, action);
            
            // 阶段 2：150ms 极速二次探针（匹配交易所撮合落库周期）
            setTimeout(() => {
                fetchInstantTradeRecords(targetSymbol, orderId, action);
            }, 150);

            // 阶段 3：500ms 快速兜底探针（若 WebSocket 与前两轮探针未确认，进行保全对账）
            setTimeout(() => {
                if (orderId && simulatorRef.current?.tradeLogs) {
                    const hasConfirmed = simulatorRef.current.tradeLogs.some(l => 
                        (l.binance_order_id && String(l.binance_order_id) === String(orderId))
                    );
                    if (!hasConfirmed) {
                        fetchInstantTradeRecords(targetSymbol, orderId, action);
                    }
                } else {
                    fetchInstantTradeRecords(targetSymbol, orderId, action);
                }
            }, 500);

            // 阶段 4：【双通道抓到为止铁律】每隔 1 秒主动向币安抓取一次成交记录，抓到即停（严格遵守 5 秒安全上限，杜绝网络拥塞）
            let secCount = 0;
            const maxSeconds = 5;
            const secTimer = setInterval(async () => {
                secCount++;
                try {
                    // 检查是否已被 WebSocket 或之前的探针确认
                    if (orderId && simulatorRef.current?.tradeLogs) {
                        const isConfirmed = simulatorRef.current.tradeLogs.some(l => 
                            (l.binance_order_id && String(l.binance_order_id) === String(orderId))
                        );
                        if (isConfirmed) {
                            clearInterval(secTimer);
                            activePollingSymbols.delete(cleanSym);
                            return;
                        }
                    }
                    // 每隔 1 秒向币安主动抓取一次
                    const success = await fetchInstantTradeRecords(targetSymbol, orderId, action);
                    if (success || secCount >= maxSeconds) {
                        clearInterval(secTimer);
                        activePollingSymbols.delete(cleanSym);
                    }
                } catch (err) {
                    if (secCount >= maxSeconds) {
                        clearInterval(secTimer);
                        activePollingSymbols.delete(cleanSym);
                    }
                }
            }, 1000);

            activePollingSymbols.set(cleanSym, secTimer);
        };

        (window as any).fetchInstantTradeRecords = triggerInstantTradeFetch;

        let syncDebounceTimer: any = null;
        // Expose a global function to trigger sync with primary WS & debounced REST fallback
        (window as any).triggerApiSync = async (force = false, targetSymbol?: string) => {
            if (targetSymbol) {
                triggerInstantTradeFetch(targetSymbol);
            }
            if (force) {
                if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
                return await fetchRealState(false, true);
            }
            if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
            syncDebounceTimer = setTimeout(() => {
                fetchRealState(true, force);
            }, targetSymbol ? 600 : 800);
        };

        // Initial instant sync (100ms)
        const timer = setTimeout(() => {
            fetchRealState(false, true);
        }, 100);

        // Low-frequency heartbeat sync every 60 seconds (extended from 15s) to preserve rate limits while WS handles instant trade events
        const interval = setInterval(() => {
            fetchRealState(true);
        }, 60000);

        return () => {
            clearTimeout(timer);
            clearInterval(interval);
            for (const [, t] of activePollingSymbols.entries()) {
                clearInterval(t);
            }
            activePollingSymbols.clear();
            delete (window as any).triggerApiSync;
            delete (window as any).fetchInstantTradeRecords;
        };
    }, [settings.system.realTrading, settings.system.binanceApiKey, settings.system.binanceApiSecret]);

    // 🔒【全账户定时自动对账引擎（默认1小时可调）】
    useEffect(() => {
        const isReal = settings.system.realTrading;
        const autoSyncEnabled = settings.system.autoSyncEnabled ?? true;
        const intervalMinutes = settings.system.autoSyncIntervalMinutes ?? 60;
        const lookbackHours = settings.system.syncHistoryLookbackHours ?? 1;

        if (!isReal || !autoSyncEnabled || intervalMinutes <= 0) return;

        const intervalMs = intervalMinutes * 60 * 1000;
        const autoSyncTimer = setInterval(() => {
            try {
                simulatorRef.current?.addLog('INFO', `⏰ [自动定时同步] 触发 ${intervalMinutes} 分钟周期实盘对账 (覆盖手机APP/外部开平仓，回溯 ${lookbackHours} 小时流水)...`);
                if (typeof (window as any).triggerApiSync === 'function') {
                    (window as any).triggerApiSync(true);
                }
            } catch (err) {
                console.warn('[AutoSync] Periodic sync warning:', err);
            }
        }, intervalMs);

        return () => clearInterval(autoSyncTimer);
    }, [settings.system.realTrading, settings.system.autoSyncEnabled, settings.system.autoSyncIntervalMinutes, settings.system.syncHistoryLookbackHours]);

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

        // 🛡️ [Anti-Double Open: In-Flight Request & Replication Lag Guard]
        if (pendingOpenPositionsRef.current.has(cleanSymbol) && !extraProps?.isReopened) {
            if (simulatorRef.current) {
                simulatorRef.current.addLog("WARNING", `🛡️ [开仓在途拦截] ${cleanSymbol} 当前正有开仓指令在向币安发送处理中，严禁并发重复开仓！`);
            }
            return;
        }

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

            const isManualOpen = !!(extraProps as any)?.isManual;
            const signalTag = isManualOpen ? '【手动操作】' : '【自动策略信号】';
            const stratName = (extraProps as any)?.strategyName || (extraProps as any)?.reason || (isManualOpen ? '用户手动开仓' : '选币扫描策略自动开仓');

            const selectedLeverage = extraProps?.leverage || settingsRef.current.system.defaultLeverage || 20;

            if (simulatorRef.current) {
                simulatorRef.current.registerPendingRealOpenProps(cleanSymbol, side, {
                    signalTf,
                    signalCandle,
                    entryEmas,
                    leverage: selectedLeverage,
                    ...extraProps
                });
                simulatorRef.current.addLog("INFO", `⚡ [实盘开仓触发] ${signalTag}|【市价开仓】|【原主仓位】| 币种: ${formatCoin(cleanSymbol)} | 方向: ${side === 'LONG' ? '买入做多 (LONG)' : '卖出做空 (SHORT)'} | 杠杆: ${selectedLeverage}x | 委托金额: ${amount} USDT | 策略来源: ${stratName}`);
            }

            // 🛡️ [前置打入在途锁与防重冷却锁，杜绝异步等待期并发穿透]
            pendingOpenPositionsRef.current.add(cleanSymbol);
            recentlyOpenedPositionsRef.current.set(cleanSymbol, Date.now());

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
                        price: price || priceBufferRef.current[cleanSymbol] || 0,
                        leverage: selectedLeverage,
                        isManual: isManualOpen,
                        isHedge: false,
                        reason: stratName
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

                        // 🔒【双通道竞速幂等防重】检查是否已被 WebSocket 极速流抢先记录
                        const existingOpenLog = simulatorRef.current.tradeLogs.find(l =>
                            (resData.orderId && l.binance_order_id && String(l.binance_order_id) === String(resData.orderId)) ||
                            (l.entry_id === positionEntryId) ||
                            (normalizeSymbol(l.symbol) === cleanSymbol && l.direction === side && l.status === 'OPEN' && Math.abs((l.entry_timestamp || 0) - tradeTime) < 10000)
                        );

                        if (existingOpenLog) {
                            existingOpenLog.binance_order_id = String(resData.orderId || "");
                            if (finalPrice > 0) existingOpenLog.entry_price = finalPrice;
                            if (finalQty > 0) existingOpenLog.current_amount = finalQty;
                            existingOpenLog.cost_usdt = finalCost;
                        } else {
                            simulatorRef.current.tradeLogs.unshift(openLogItem);
                        }
                        setTradeLogs([...simulatorRef.current.tradeLogs]);
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
                        saveState('SAVIOR_POSITIONS_LIVE', nextPositions);
                        saveState('SAVIOR_POSITIONS', nextPositions);
                        if (resData.orderId) {
                            simulatorRef.current.registerExecutedOrderId(resData.orderId);
                        }
                        const finalCostUsdt = (finalQty * finalPrice).toFixed(2);
                        simulatorRef.current.addLog("SUCCESS", `⚡ [币安实盘确认] ${signalTag}|【市价开仓】|【原主仓位】| 币种: ${formatCoin(cleanSymbol)} | 方向: ${side === 'LONG' ? '买入做多 (LONG)' : '卖出做空 (SHORT)'} | 杠杆: ${finalLev}x | 成交均价: ${finalPrice} USDT | 成交数量: ${finalQty.toFixed(4)} | 成交金额: ${finalCostUsdt} USDT | 币安订单号: ${resData.orderId}`);
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
                } else if (resData.intercepted) {
                    if (simulatorRef.current) {
                        simulatorRef.current.addLog("WARNING", resData.error || `🛡️ [防重复开仓] 服务端拦截了 ${cleanSymbol} 的重复开仓请求`);
                    }
                    return;
                } else {
                    const errMsg = resData.error || resData.message || "未知交易所错误";
                    if (simulatorRef.current) {
                        simulatorRef.current.addLog("DANGER", `⚡ [币安实盘] 自动开仓未获成功确认: ${errMsg}，正在启动对账同步...`);
                    }
                    if (typeof (window as any).triggerApiSync === "function") {
                        (window as any).triggerApiSync(true, cleanSymbol);
                    }
                    audioService.speak("自动开仓失败");
                }
            } catch (e: any) {
                if (simulatorRef.current) {
                    simulatorRef.current.addLog("DANGER", `⚡ [币安实盘] 自动开仓网络/超时异常: ${e.message || e}，正在启动对账同步...`);
                }
                if (typeof (window as any).triggerApiSync === "function") {
                    (window as any).triggerApiSync(true, cleanSymbol);
                }
                audioService.speak("自动开仓网络异常");
            } finally {
                pendingOpenPositionsRef.current.delete(cleanSymbol);
            }
        } else {
            if (simulatorRef.current) {
                simulatorRef.current.openPosition(cleanSymbol, side, amount, price, signalTf, signalCandle, entryEmas, extraProps);
                const updatedPositions = [...simulatorRef.current.getPositions()];
                setPositions(updatedPositions);
                const isRealMode = settingsRef.current.system.realTrading;
                const posKey = isRealMode ? 'SAVIOR_POSITIONS_LIVE' : 'SAVIOR_POSITIONS_SIM';
                saveState(posKey, updatedPositions);
                saveState('SAVIOR_POSITIONS', updatedPositions);
            }
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

        // 4. Replication Lag Protection (5 seconds after hedge trigger to prevent duplicate firing during transit)
        const lastHedgeTime = Math.max(
            recentlyOpenedHedgesRef.current.get(lockKey) || 0,
            recentlyOpenedHedgesRef.current.get(symbolLockKey) || 0
        );
        if (lastHedgeTime && Date.now() - lastHedgeTime < 5000) {
            if (simulatorRef.current) {
                simulatorRef.current.addLog("WARNING", `🛡️ [对冲在途拦截] ${cleanSymbol} ${side} 的自动对冲指令于 ${((Date.now() - lastHedgeTime)/1000).toFixed(1)} 秒前已发送，处于单次对冲保护期中，拦截本次重复触发。`);
            }
            return;
        }

        // 🔒 [前置原子即时加锁] 在发起异步请求前的第一行立即打入全局在途锁与并发锁，杜绝任何微秒/毫秒并发穿透
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
            pendingHedgesRef.current.delete(lockKey);
            pendingHedgesRef.current.delete(symbolLockKey);
            return;
        }

        const hedgePrice = position.markPrice || position.entryPrice || 1;
        const estimatedHedgeQty = exactQty !== undefined ? exactQty : (amountUsdt / hedgePrice);
        const optimisticEntryId = 'HEDGE_' + Date.now().toString() + '_' + Math.random().toString(36).substring(2, 9);

        // 🔒 [0毫秒乐观即时渲染] 发送币安指令的同一毫秒，立即在本地状态中展示防爆对冲开仓
        if (simulatorRef.current) {
            const hedgeUsdtVal = exactQty !== undefined ? (exactQty * hedgePrice).toFixed(2) : amountUsdt.toFixed(2);
            const hedgeQtyVal = exactQty !== undefined ? exactQty.toFixed(4) : estimatedHedgeQty.toFixed(4);
            simulatorRef.current.addLog("INFO", `⚡ [自动对冲触发] 【自动策略信号】|【防爆对冲开仓】|【防爆对冲仓位】| 币种: ${formatCoin(cleanSymbol)} | 方向: ${side === 'LONG' ? '买入做多 (LONG)' : '卖出做空 (SHORT)'} | 数量: ${hedgeQtyVal} (约 ${hedgeUsdtVal} USDT) | 原因: ${reason || '主仓浮亏达到对冲阈值'}`);

            const simPositions = simulatorRef.current.getPositions();
            const mainPos = simPositions.find(p => p.entryId === position.entryId || (normalizeSymbol(p.symbol) === cleanSymbol && p.side === position.side));
            if (mainPos) {
                mainPos.isHedged = true;
                mainPos.hedgeSignalTriggered = true;
                // 🔒 清空对冲发生前的主仓历史波峰与旧断臂触发标记
                mainPos.amputationTriggered = false;
                delete mainPos.maxPnLAfterAmputationTrigger;
                delete mainPos.maxPnLPercentAfterAmputationTrigger;
                delete mainPos.lastLoggedPeakPercent;
                delete (mainPos as any).maxPnLPercent;
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
            const enrichedOptimistic = simulatorRef.current.getPositions();
            simulatorRef.current.emitUpdate(true);
            setPositions([...enrichedOptimistic]);
            setBinanceRealPositions([...enrichedOptimistic]);
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
                    leverage: position.leverage || 20,
                    isHedge: true,
                    isManual: false,
                    reason: '自动防爆对冲策略开仓',
                    price: hedgePrice
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
                    const finalHedgePrice = resData.price || hedgePrice;
                    const finalHedgeQty = Number(resData.qty || estimatedHedgeQty || 0);
                    const finalHedgeUsdt = (finalHedgeQty * finalHedgePrice).toFixed(2);
                    simulatorRef.current.addLog("SUCCESS", `⚡ [币安实盘确认] 【自动策略信号】|【防爆对冲开仓】|【防爆对冲仓位】| 币种: ${formatCoin(cleanSymbol)} | 方向: ${side === 'LONG' ? '买入做多 (LONG)' : '卖出做空 (SHORT)'} | 杠杆: ${position.leverage || 20}x | 成交均价: ${finalHedgePrice} USDT | 成交数量: ${finalHedgeQty.toFixed(4)} | 成交金额: ${finalHedgeUsdt} USDT | 币安订单号: ${resData.orderId}`);
                    
                    const simPositions = simulatorRef.current.getPositions();
                    const mainPos = simPositions.find(p => p.entryId === position.entryId || (normalizeSymbol(p.symbol) === cleanSymbol && p.side === position.side));
                    if (mainPos) {
                        mainPos.isHedged = true;
                    }

                    const entryId = optimisticEntryId;
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

                    // 🔒【双通道竞速幂等防重】检查是否已被 WebSocket 极速流抢先记录
                    const existingOpenLog = simulatorRef.current.tradeLogs.find(l =>
                        (resData.orderId && l.binance_order_id && String(l.binance_order_id) === String(resData.orderId)) ||
                        (l.entry_id === entryId) ||
                        (normalizeSymbol(l.symbol) === cleanSymbol && l.direction === side && l.status === 'OPEN' && Math.abs((l.entry_timestamp || 0) - hedgeTradeTime) < 10000)
                    );

                    if (existingOpenLog) {
                        existingOpenLog.binance_order_id = hedgeOrderId;
                        if (finalHedgePrice > 0) existingOpenLog.entry_price = finalHedgePrice;
                        if (finalHedgeQty > 0) existingOpenLog.current_amount = finalHedgeQty;
                        existingOpenLog.cost_usdt = finalHedgeCost;
                        if (reason && existingOpenLog.events?.[0]) {
                            existingOpenLog.events[0].reason = reason;
                            existingOpenLog.events[0].action = `防爆对冲开仓 (${side})`;
                        }
                    } else {
                        simulatorRef.current.tradeLogs.unshift(hedgeLogItem);
                    }
                    setTradeLogs([...simulatorRef.current.tradeLogs]);
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
                    const enrichedSuccess = simulatorRef.current.getPositions();
                    simulatorRef.current.emitUpdate(true);
                    setPositions([...enrichedSuccess]);
                    setBinanceRealPositions([...enrichedSuccess]);
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
                    simulatorRef.current.addLog("DANGER", `🚨 [对冲响应失败] 自动对冲开仓失败: ${errMsg}，正在启动对账同步...`);
                    if (typeof (window as any).triggerApiSync === "function") {
                        (window as any).triggerApiSync(true, cleanSymbol);
                    }
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
            }
        } catch (e: any) {
            if (simulatorRef.current) {
                simulatorRef.current.addLog("DANGER", `🚨 [对冲响应异常] 自动对冲网络异常或未收到响应: ${e.message || e}，正在启动对账同步...`);
                if (typeof (window as any).triggerApiSync === "function") {
                    (window as any).triggerApiSync(true, cleanSymbol);
                }
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
        } finally {
            // ⚡【一键清仓级极速释放】立即清理在途锁，杜绝无意义的睡眠等待
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

        const isHedge = !!position.isHedge || !!position.mainPositionId;
        const posTag = isHedge ? '【防爆对冲仓位】' : '【原主仓位】';
        const isAmputation = ratio !== undefined;
        const actLabel = isAmputation ? '【断臂求生减仓】' : (isHedge ? '【防爆对冲减仓/平仓】' : '【市价平仓】');

        // 🔒【绝对零虚假铁律】指令发送阶段仅记录正在向币安发送请求，严禁提前修改/扣减持仓！
        if (simulatorRef.current) {
            const closePrice = position.markPrice || position.entryPrice || 0;
            const closeUsdtVal = (closeQty * closePrice).toFixed(2);
            simulatorRef.current.addLog("INFO", `⚡ [自动平仓触发] 【自动策略信号】|${actLabel}|${posTag}| 币种: ${formatCoin(cleanSymbol)} | 方向: ${position.side === 'LONG' ? '卖出平多 (平多)' : '买入平空 (平空)'} | 委托数量: ${closeQty.toFixed(4)} | 委托金额: ${closeUsdtVal} USDT | 触发原因: ${reason}`);
            simulatorRef.current.emitUpdate(true);
        }

        let isSuccess = false;
        const clientOrderId = (ratio !== undefined
            ? `AMP_${cleanSymbol}_${position.side}_${Date.now()}`
            : `CLS_${cleanSymbol}_${position.side}_${Date.now()}`).slice(0, 36);

        try {
            // Set up fetch with 25000ms timeout to support backend multi-node fallbacks
            const fetchPromise = fetch("/api/binance/order", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    apiKey,
                    apiSecret,
                    symbol: cleanSymbol,
                    side: position.side,
                    action: "CLOSE",
                    quantity: closeQty,
                    price: position.markPrice || position.entryPrice,
                    isHedge,
                    isAmputation: ratio !== undefined,
                    amputationRatio: ratio,
                    isManual: false,
                    reason: ratio !== undefined ? `自动断臂求生减仓 ${ratio}%` : (isHedge ? '自动对冲平仓/止盈止损' : '自动止盈止损策略平仓'),
                    clientOrderId
                })
            }).then(async res => {
                const ok = res.ok;
                const json = await res.json().catch(() => null);
                return { isFromWs: false, ok, data: json };
            }).catch(err => ({ isFromWs: false, ok: false, data: null, error: err }));

            // ⚡ 双通道毫秒级竞速确认：只要 WebSocket 监听到成交 (通常仅需 20~50ms)，立即抢先完成平仓/砍仓确认！
            let cleanupTradeListener: (() => void) | null = null;
            const wsFastTrackPromise = new Promise<any>((resolve) => {
                const onTrade = (e: Event) => {
                    const trade = (e as CustomEvent).detail;
                    if (!trade || normalizeSymbol(trade.symbol) !== cleanSymbol) return;
                    const isMatchClientOrder = trade.clientOrderId && trade.clientOrderId === clientOrderId;
                    const isClose = isMatchClientOrder || trade.action === "CLOSE" || trade.reduceOnly || trade.closePosition || (trade.realizedPnl !== 0) || (trade.orderStatus === "FILLED");
                    if (isClose) {
                        resolve({
                            isFromWs: true,
                            ok: true,
                            data: {
                                success: true,
                                orderId: trade.orderId,
                                price: trade.lastFilledPrice || trade.avgPrice,
                                realizedPnl: trade.realizedPnl,
                                isFromWs: true,
                                tradeData: trade
                            }
                        });
                    }
                };
                window.addEventListener("BINANCE_TRADE_CONFIRMED", onTrade);
                cleanupTradeListener = () => window.removeEventListener("BINANCE_TRADE_CONFIRMED", onTrade);
            });

            const timeoutPromise = new Promise<{ isFromWs: false, ok: false, data: null, error: any }>((_, reject) =>
                setTimeout(() => reject(new Error("Timeout")), 25000)
            );

            // Race fetch, WS fast-track, and timeout
            const raceResult: any = await Promise.race([fetchPromise, wsFastTrackPromise, timeoutPromise]);
            if (cleanupTradeListener) cleanupTradeListener();

            const resData = raceResult?.data || {};
            const isResponseOk = raceResult?.ok && resData?.success;

            if (isResponseOk) {
                isSuccess = true;
                if (ratio === undefined || ratio >= 100 || (position.amount - (customQty || 0)) <= 0.0001) {
                    recentlyClosedPositionsRef.current.set(lockKey, Date.now());
                }
                if (simulatorRef.current) {
                    if (resData.orderId) {
                        simulatorRef.current.registerExecutedOrderId(resData.orderId);
                    }
                    const execClosePrice = resData.price || position.markPrice || position.entryPrice || 0;
                    const execCloseQty = Number(resData.qty || closeQty || 0);
                    const execCloseUsdt = (execCloseQty * execClosePrice).toFixed(2);
                    simulatorRef.current.addLog("SUCCESS", `⚡ [币安实盘确认] 【自动策略信号】|${actLabel}|${posTag}| 币种: ${formatCoin(cleanSymbol)} | 方向: ${position.side === 'LONG' ? '卖出平多 (平多)' : '买入平空 (平空)'} | 成交均价: ${execClosePrice} USDT | 成交数量: ${execCloseQty.toFixed(4)} | 成交金额: ${execCloseUsdt} USDT | 币安订单号: ${resData.orderId}${raceResult?.isFromWs ? ' (WebSocket极速直通)' : ''}`);
                    if (customQty !== undefined && ratio !== undefined) {
                        // 🔒 [断臂求生实盘成功回调] 精确计算砍仓亏损金额并100%计入单币独立负债
                        const currentMark = resData.price || realPrices[cleanSymbol] || position.markPrice || position.entryPrice;
                        const priceDiff = position.side === 'LONG' ? currentMark - position.entryPrice : position.entryPrice - currentMark;
                        const cutAmount = customQty;
                        const calculatedPnl = priceDiff * cutAmount;
                        const realizedPnL = (resData.realizedPnl !== undefined && resData.realizedPnl !== 0) ? resData.realizedPnl : calculatedPnl;
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
                        // 🔒 判定是否全额砍光归零：handleRealAmputationSuccess 已对 position.amount 执行过扣减，此处直接检查扣减后的剩余持仓数量
                        const isFullyAmputated = (ratio !== undefined && ratio >= 99.99) || position.amount <= 0.0001;
                        if (isFullyAmputated) {
                            // 🔒 100%全额砍仓：记录全额砍仓负债，并同步给该币对手单，然后移除已砍光仓位
                            simulatorRef.current.removePositionLocally(cleanSymbol, position.side);
                            const updatedSimPositions = simulatorRef.current.getPositions();
                            setBinanceRealPositions(updatedSimPositions);
                            setPositions(updatedSimPositions);
                        } else {
                            // 🔒 部分砍仓（如砍90%留10%底仓）：必须保全剩余持仓，严禁删除仓位！同步权威持仓对象与剩余数量及负债
                            const updatedSimPositions = simulatorRef.current.getPositions();
                            setBinanceRealPositions(updatedSimPositions);
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
                // 🛡️ [实盘超时/未获确认主动对账保全引擎]
                let reconciled = false;
                if (apiKey && apiSecret) {
                    try {
                        if (simulatorRef.current) {
                            simulatorRef.current.addLog("WARNING", `⚠️ [平仓未获确认] 正在启动对账通道核查币安实盘执行状态: ${cleanSymbol}...`);
                        }
                        // 🛡️ 探针 1: 按 clientOrderId 精确反查币安订单成交状态
                        let queriedOrder: any = null;
                        try {
                            const qResp = await fetch("/api/binance/query-order", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ apiKey, apiSecret, symbol: cleanSymbol, origClientOrderId: clientOrderId })
                            }).then(r => r.json()).catch(() => null);
                            if (qResp && qResp.success && qResp.order && qResp.order.status === "FILLED") {
                                queriedOrder = qResp.order;
                            }
                        } catch (qErr) {}

                        const fastResp = await fetch("/api/binance/fast-user-trades", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ apiKey, apiSecret, symbol: cleanSymbol, limit: 10 })
                        }).then(r => r.json()).catch(() => null);

                        const now = Date.now();
                        const recentTrades = (fastResp && fastResp.success && Array.isArray(fastResp.trades)) ? fastResp.trades : [];
                        const closeSide = position.side === PositionSide.LONG ? 'SELL' : 'BUY';
                        const matchingTrade = recentTrades.find((t: any) => {
                            const tTime = parseInt(t.time || t.timestamp || '0');
                            const isRecent = now - tTime < 75000;
                            const isCloseSide = (t.side === closeSide) || (t.positionSide && t.positionSide === position.side && t.side === closeSide);
                            const hasPnl = parseFloat(t.realizedPnl || '0') !== 0;
                            return isRecent && (isCloseSide || hasPnl);
                        });

                        const balanceResp = await fetch("/api/binance/validate-and-balance", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ apiKey, apiSecret, force: true })
                        }).then(r => r.json()).catch(() => null);

                        const activePositions = (balanceResp && balanceResp.success && Array.isArray(balanceResp.activePositions)) ? balanceResp.activePositions : [];
                        const livePos = activePositions.find((p: any) => normalizeSymbol(p.symbol) === cleanSymbol && p.side === position.side);
                        const currentLiveAmount = livePos ? livePos.amount : 0;
                        const amountDecreased = (position.amount - currentLiveAmount) >= (closeQty * 0.7);

                        if (queriedOrder || matchingTrade || amountDecreased) {
                            reconciled = true;
                            isSuccess = true;
                            const execPrice = queriedOrder ? parseFloat(queriedOrder.avgPrice || queriedOrder.price || '0') : (matchingTrade ? parseFloat(matchingTrade.price || '0') : (position.markPrice || position.entryPrice));
                            const execQty = queriedOrder ? parseFloat(queriedOrder.executedQty || closeQty) : (matchingTrade ? parseFloat(matchingTrade.qty || '0') : (position.amount - currentLiveAmount));
                            const tradePnl = matchingTrade ? parseFloat(matchingTrade.realizedPnl || '0') : 0;
                            const execOrderId = queriedOrder ? String(queriedOrder.orderId) : (matchingTrade ? String(matchingTrade.orderId || matchingTrade.id || '') : undefined);

                            const reconData = {
                                success: true,
                                orderId: execOrderId || `recon_${Date.now()}`,
                                price: execPrice,
                                qty: execQty,
                                realizedPnl: tradePnl,
                                trades: matchingTrade ? [matchingTrade] : []
                            };

                            if (simulatorRef.current) {
                                if (execOrderId) {
                                    simulatorRef.current.registerExecutedOrderId(execOrderId);
                                }
                                const execUsdtVal = (execQty * execPrice).toFixed(2);
                                simulatorRef.current.addLog("SUCCESS", `⚡ [实盘对账成功] 证实币安已真实成交: ${cleanSymbol} ${position.side} | 数量: ${execQty.toFixed(4)} (约 ${execUsdtVal} USDT) | 真实盈亏: ${tradePnl >= 0 ? '+' : ''}${tradePnl.toFixed(4)} USDT | 立即补全系统负债与流水！`);

                                if (customQty !== undefined && ratio !== undefined) {
                                    const currentMark = execPrice || realPrices[cleanSymbol] || position.markPrice || position.entryPrice;
                                    const priceDiff = position.side === 'LONG' ? currentMark - position.entryPrice : position.entryPrice - currentMark;
                                    const cutAmount = customQty;
                                    const calculatedPnl = priceDiff * cutAmount;
                                    const realizedPnL = tradePnl !== 0 ? tradePnl : calculatedPnl;

                                    simulatorRef.current.handleRealAmputationSuccess(
                                        cleanSymbol,
                                        position.side,
                                        customQty,
                                        ratio,
                                        reason,
                                        realizedPnL,
                                        reconData
                                    );

                                    const isFullyAmputated = (ratio !== undefined && ratio >= 99.99) || position.amount <= 0.0001;
                                    if (isFullyAmputated) {
                                        simulatorRef.current.removePositionLocally(cleanSymbol, position.side);
                                    }
                                    const updatedSimPositions = simulatorRef.current.getPositions();
                                    setBinanceRealPositions(updatedSimPositions);
                                    setPositions(updatedSimPositions);
                                    setTradeLogs([...simulatorRef.current.tradeLogs]);
                                } else {
                                    simulatorRef.current.recordRealTradeLog(position, reason, reconData);
                                    setTradeLogs([...simulatorRef.current.tradeLogs]);
                                    if (closeQty >= (position.amount * 0.999)) {
                                        simulatorRef.current.removePositionLocally(cleanSymbol, position.side);
                                        setBinanceRealPositions(prev => prev.filter(p => !(normalizeSymbol(p.symbol) === cleanSymbol && p.side === position.side)));
                                        setPositions(prev => prev.filter(p => !(normalizeSymbol(p.symbol) === cleanSymbol && p.side === position.side)));
                                    }
                                }
                                if (matchingTrade) {
                                    simulatorRef.current.reconcileRealTradesFromBinance([matchingTrade]);
                                }
                                simulatorRef.current.emitUpdate(true);
                            }
                            if (typeof (window as any).triggerApiSync === "function") {
                                (window as any).triggerApiSync(true, cleanSymbol);
                            }
                        }
                    } catch (reconErr: any) {
                        console.warn("[Failure Reconciliation Error]:", reconErr);
                    }
                }

                if (!reconciled) {
                    if (simulatorRef.current) {
                        simulatorRef.current.addLog("DANGER", `🚨 [平仓响应失败] 自动平仓失败: ${errMsg}`);
                        simulatorRef.current.emitUpdate(true);
                    }
                    audioService.speak("警报，平仓/砍仓指令执行失败，请手动检查仓位", true);
                }
            }
        } catch (e: any) {
            // 🛡️ [实盘超时/异常主动对账保全引擎]
            let reconciled = false;
            if (apiKey && apiSecret) {
                try {
                    if (simulatorRef.current) {
                        simulatorRef.current.addLog("WARNING", `⚠️ [平仓网络超时/异常] 正在启动对账通道核查币安实盘执行状态: ${cleanSymbol} (${e.message || e})...`);
                    }
                    // 🛡️ 探针 1: 按 clientOrderId 精确反查币安订单成交状态
                    let queriedOrder: any = null;
                    try {
                        const qResp = await fetch("/api/binance/query-order", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ apiKey, apiSecret, symbol: cleanSymbol, origClientOrderId: clientOrderId })
                        }).then(r => r.json()).catch(() => null);
                        if (qResp && qResp.success && qResp.order && qResp.order.status === "FILLED") {
                            queriedOrder = qResp.order;
                        }
                    } catch (qErr) {}

                    const fastResp = await fetch("/api/binance/fast-user-trades", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ apiKey, apiSecret, symbol: cleanSymbol, limit: 10 })
                    }).then(r => r.json()).catch(() => null);

                    const now = Date.now();
                    const recentTrades = (fastResp && fastResp.success && Array.isArray(fastResp.trades)) ? fastResp.trades : [];
                    const closeSide = position.side === PositionSide.LONG ? 'SELL' : 'BUY';
                    const matchingTrade = recentTrades.find((t: any) => {
                        const tTime = parseInt(t.time || t.timestamp || '0');
                        const isRecent = now - tTime < 75000;
                        const isCloseSide = (t.side === closeSide) || (t.positionSide && t.positionSide === position.side && t.side === closeSide);
                        const hasPnl = parseFloat(t.realizedPnl || '0') !== 0;
                        return isRecent && (isCloseSide || hasPnl);
                    });

                    const balanceResp = await fetch("/api/binance/validate-and-balance", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ apiKey, apiSecret, force: true })
                    }).then(r => r.json()).catch(() => null);

                    const activePositions = (balanceResp && balanceResp.success && Array.isArray(balanceResp.activePositions)) ? balanceResp.activePositions : [];
                    const livePos = activePositions.find((p: any) => normalizeSymbol(p.symbol) === cleanSymbol && p.side === position.side);
                    const currentLiveAmount = livePos ? livePos.amount : 0;
                    const amountDecreased = (position.amount - currentLiveAmount) >= (closeQty * 0.7);

                    if (queriedOrder || matchingTrade || amountDecreased) {
                        reconciled = true;
                        isSuccess = true;
                        const execPrice = queriedOrder ? parseFloat(queriedOrder.avgPrice || queriedOrder.price || '0') : (matchingTrade ? parseFloat(matchingTrade.price || '0') : (position.markPrice || position.entryPrice));
                        const execQty = queriedOrder ? parseFloat(queriedOrder.executedQty || closeQty) : (matchingTrade ? parseFloat(matchingTrade.qty || '0') : (position.amount - currentLiveAmount));
                        const tradePnl = matchingTrade ? parseFloat(matchingTrade.realizedPnl || '0') : 0;
                        const execOrderId = queriedOrder ? String(queriedOrder.orderId) : (matchingTrade ? String(matchingTrade.orderId || matchingTrade.id || '') : undefined);

                        const reconData = {
                            success: true,
                            orderId: execOrderId || `recon_${Date.now()}`,
                            price: execPrice,
                            qty: execQty,
                            realizedPnl: tradePnl,
                            trades: matchingTrade ? [matchingTrade] : []
                        };

                        if (simulatorRef.current) {
                            if (execOrderId) {
                                simulatorRef.current.registerExecutedOrderId(execOrderId);
                            }
                            const execUsdtVal = (execQty * execPrice).toFixed(2);
                            simulatorRef.current.addLog("SUCCESS", `⚡ [实盘超时对账成功] 证实币安已真实成交: ${cleanSymbol} ${position.side} | 数量: ${execQty.toFixed(4)} (约 ${execUsdtVal} USDT) | 真实盈亏: ${tradePnl >= 0 ? '+' : ''}${tradePnl.toFixed(4)} USDT | 立即补全系统负债与流水！`);

                            if (customQty !== undefined && ratio !== undefined) {
                                const currentMark = execPrice || realPrices[cleanSymbol] || position.markPrice || position.entryPrice;
                                const priceDiff = position.side === 'LONG' ? currentMark - position.entryPrice : position.entryPrice - currentMark;
                                const cutAmount = customQty;
                                const calculatedPnl = priceDiff * cutAmount;
                                const realizedPnL = tradePnl !== 0 ? tradePnl : calculatedPnl;

                                simulatorRef.current.handleRealAmputationSuccess(
                                    cleanSymbol,
                                    position.side,
                                    customQty,
                                    ratio,
                                    reason,
                                    realizedPnL,
                                    reconData
                                );

                                const isFullyAmputated = (ratio !== undefined && ratio >= 99.99) || position.amount <= 0.0001;
                                if (isFullyAmputated) {
                                    simulatorRef.current.removePositionLocally(cleanSymbol, position.side);
                                }
                                const updatedSimPositions = simulatorRef.current.getPositions();
                                setBinanceRealPositions(updatedSimPositions);
                                setPositions(updatedSimPositions);
                                setTradeLogs([...simulatorRef.current.tradeLogs]);
                            } else {
                                simulatorRef.current.recordRealTradeLog(position, reason, reconData);
                                setTradeLogs([...simulatorRef.current.tradeLogs]);
                                if (closeQty >= (position.amount * 0.999)) {
                                    simulatorRef.current.removePositionLocally(cleanSymbol, position.side);
                                    setBinanceRealPositions(prev => prev.filter(p => !(normalizeSymbol(p.symbol) === cleanSymbol && p.side === position.side)));
                                    setPositions(prev => prev.filter(p => !(normalizeSymbol(p.symbol) === cleanSymbol && p.side === position.side)));
                                }
                            }
                            if (matchingTrade) {
                                simulatorRef.current.reconcileRealTradesFromBinance([matchingTrade]);
                            }
                            simulatorRef.current.emitUpdate(true);
                        }
                        if (typeof (window as any).triggerApiSync === "function") {
                            (window as any).triggerApiSync(true, cleanSymbol);
                        }
                    }
                } catch (reconErr: any) {
                    console.warn("[Timeout Reconciliation Error]:", reconErr);
                }
            }

            if (!reconciled) {
                if (simulatorRef.current) {
                    simulatorRef.current.addLog("DANGER", `🚨 [平仓响应异常] 自动平仓网络异常或未收到响应: ${e.message || e}`);
                    simulatorRef.current.emitUpdate(true);
                }
                audioService.speak("警报，平仓网络异常，未收到回复指令，请立即手动核对仓位", true);
            }
        } finally {
            // ⚡【一键清仓级极速释放】立即清理在途锁，杜绝无意义的2秒睡眠等待
            pendingClosesRef.current.delete(lockKey);
        }
    }, []);

    const handleAutoOpenRefill = useCallback(async (position: Position, qty: number, reason: string) => {
        const cleanSymbol = normalizeSymbol(position.symbol);
        const refillLockKey = `${cleanSymbol}_${position.side}`;
        const isRescueRefill = reason.includes('断臂') || reason.includes('求生');
        const now = Date.now();
        const lastRefillTime = inFlightRefillRef.current.get(refillLockKey) || 0;
        const cooldownThreshold = isRescueRefill ? 1500 : 8000;
        if (now - lastRefillTime < cooldownThreshold) {
            console.warn(`[Auto Refill Intercepted] 🛡️ 补仓防抖拦截: ${cleanSymbol} ${position.side} (${now - lastRefillTime}ms)`);
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
        if (simulatorRef.current && !isRescueRefill) {
            const activePositions = simulatorRef.current.getPositions();
            const oppositePos = activePositions.find(p => 
                normalizeSymbol(p.symbol) === cleanSymbol && 
                p.side !== position.side && 
                p.amount > 0
            );

            if (oppositePos && Math.abs(position.amount - oppositePos.amount) <= Math.max(position.amount, oppositePos.amount) * 0.05) {
                simulatorRef.current.addLog("WARNING", `🛡️ [有效对冲禁补] ${cleanSymbol} 原仓位与对冲仓位数量一致(${position.amount.toFixed(4)})处于有效对冲状态，安全铁律拦截，绝对严禁补仓！`);
                return;
            }

            if (oppositePos) {
                simulatorRef.current.addLog("WARNING", `🛡️ [对冲实盘补仓拦截] ${cleanSymbol} 处于双向持仓对冲状态，安全锁已激活，拒绝发送补仓指令。`);
                return;
            }
        }

        // 🔒【绝对零虚假铁律】补仓指令发送阶段仅记录正在向币安发送请求，严禁提前修改持仓！
        if (simulatorRef.current) {
            const refillPrice = position.markPrice || position.entryPrice || 0;
            const refillUsdt = (qty * refillPrice).toFixed(2);
            simulatorRef.current.addLog("INFO", `⚡ [自动补仓触发] 【自动策略信号】|【策略加仓补位】|【原主仓位】| 币种: ${formatCoin(cleanSymbol)} | 方向: ${position.side === 'LONG' ? '买入做多 (LONG)' : '卖出做空 (SHORT)'} | 委托数量: ${qty.toFixed(4)} | 委托金额: ${refillUsdt} USDT | 触发原因: ${reason}`);
        }

        const clientOrderId = `REF_${cleanSymbol}_${position.side}_${Date.now()}`.slice(0, 36);
        let cleanupTradeListener: (() => void) | null = null;

        try {
            const fetchPromise = fetch("/api/binance/order", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    apiKey,
                    apiSecret,
                    symbol: cleanSymbol,
                    side: position.side,
                    action: "OPEN",
                    quantity: qty,
                    amountUsdt: qty * (position.markPrice || position.entryPrice || 0),
                    isRefill: true,
                    allowExisting: true,
                    isManual: false,
                    reason: '策略自动加仓补位',
                    clientOrderId
                })
            }).then(async res => {
                const ok = res.ok;
                const json = await res.json().catch(() => null);
                return { isFromWs: false, ok, data: json };
            }).catch(err => ({ isFromWs: false, ok: false, data: null, error: err }));

            // ⚡ 双通道毫秒级竞速确认：只要 WebSocket 监听到成交 (通常仅需 20~50ms)，立即抢先完成补仓确认！
            const wsFastTrackPromise = new Promise<any>((resolve) => {
                const onTrade = (e: Event) => {
                    const trade = (e as CustomEvent).detail;
                    if (!trade || normalizeSymbol(trade.symbol) !== cleanSymbol) return;
                    const isMatchClientOrder = trade.clientOrderId && trade.clientOrderId === clientOrderId;
                    const targetSide = position.side === 'LONG' ? 'BUY' : 'SELL';
                    const isMatchSide = (trade.side === targetSide) || (trade.positionSide === position.side && trade.side === targetSide);
                    const isFill = trade.orderStatus === "FILLED" || trade.executionType === "TRADE" || (trade.lastFilledQty && trade.lastFilledQty > 0);
                    if ((isMatchClientOrder || isMatchSide) && isFill) {
                        resolve({
                            isFromWs: true,
                            ok: true,
                            data: {
                                success: true,
                                orderId: trade.orderId,
                                price: trade.lastFilledPrice || trade.avgPrice,
                                qty: trade.cumFilledQty || trade.lastFilledQty || qty,
                                isFromWs: true,
                                tradeData: trade
                            }
                        });
                    }
                };
                window.addEventListener("BINANCE_TRADE_CONFIRMED", onTrade);
                cleanupTradeListener = () => window.removeEventListener("BINANCE_TRADE_CONFIRMED", onTrade);
            });

            const timeoutPromise = new Promise<{ isFromWs: false, ok: false, data: null, error: any }>((_, reject) =>
                setTimeout(() => reject(new Error("Timeout")), 4000)
            );

            // Race fetch, WS fast-track, and fast 4000ms timeout
            let raceResult: any = null;
            try {
                raceResult = await Promise.race([fetchPromise, wsFastTrackPromise, timeoutPromise]);
            } catch (err) {
                raceResult = { isFromWs: false, ok: false, data: null, error: err };
            }
            if (cleanupTradeListener) cleanupTradeListener();

            const resData = raceResult?.data || {};
            let isRefillConfirmed = raceResult?.ok && resData?.success && resData?.orderId && resData?.orderId !== "EXISTING_POSITION_INTERCEPTED";

            // 🛡️【方案1+方案2：超时/未获确认启动主动精准探针反查】
            let reconData: any = resData;
            let execRefillQty = Number(resData?.qty || qty || 0);
            let execRefillPrice = Number(resData?.price || position.markPrice || position.entryPrice || 0);
            let execOrderId = resData?.orderId;

            if (!isRefillConfirmed) {
                if (simulatorRef.current) {
                    simulatorRef.current.addLog("WARNING", `⚠️ [补仓探针启动] 正在向币安反查订单(${clientOrderId})与实盘持仓以确认补仓状态: ${cleanSymbol}...`);
                }

                // 探针途径 1: 按 clientOrderId 精准反查币安订单状态
                try {
                    const queryResp = await fetch("/api/binance/query-order", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ apiKey, apiSecret, symbol: cleanSymbol, origClientOrderId: clientOrderId })
                    }).then(r => r.json()).catch(() => null);

                    if (queryResp && queryResp.success && queryResp.order && queryResp.order.status === "FILLED") {
                        isRefillConfirmed = true;
                        execOrderId = queryResp.order.orderId;
                        execRefillQty = parseFloat(queryResp.order.executedQty || qty);
                        execRefillPrice = parseFloat(queryResp.order.avgPrice || position.markPrice || position.entryPrice);
                        reconData = queryResp.order;
                        if (simulatorRef.current) {
                            simulatorRef.current.addLog("SUCCESS", `⚡ [订单精准反查证实] 币安官方证实补仓订单已完全成交 (ID: ${execOrderId}, 数量: ${execRefillQty})！`);
                        }
                    }
                } catch (qErr) {}

                // 探针途径 2: 若订单查询未果，查询单币实盘持仓是否已增加或恢复平衡
                if (!isRefillConfirmed) {
                    try {
                        const balResp = await fetch("/api/binance/symbol-position", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ apiKey, apiSecret, symbol: cleanSymbol })
                        }).then(r => r.json()).catch(() => null);

                        if (balResp && balResp.success && Array.isArray(balResp.positions)) {
                            const liveSidePos = balResp.positions.find((p: any) => p.side === position.side);
                            const currentLiveAmt = liveSidePos ? parseFloat(liveSidePos.amount || '0') : 0;
                            const opposingSidePos = balResp.positions.find((p: any) => p.side !== position.side);
                            const opposingLiveAmt = opposingSidePos ? parseFloat(opposingSidePos.amount || '0') : 0;
                            const isBalanced = opposingLiveAmt > 0 && Math.abs(currentLiveAmt - opposingLiveAmt) <= Math.max(currentLiveAmt, opposingLiveAmt) * 0.05;
                            const amountIncreased = (currentLiveAmt - position.amount) >= (qty * 0.7);

                            if (isBalanced || amountIncreased) {
                                isRefillConfirmed = true;
                                execRefillQty = qty;
                                execRefillPrice = position.markPrice || position.entryPrice || 0;
                                if (simulatorRef.current) {
                                    simulatorRef.current.addLog("SUCCESS", `⚡ [实盘持仓对账证实] 币安实盘持仓已增加至 ${currentLiveAmt}，权威证实补仓已成功！`);
                                }
                            }
                        }
                    } catch (bErr) {}
                }
            }

            if (isRefillConfirmed) {
                if (simulatorRef.current) {
                    if (execOrderId) {
                        simulatorRef.current.registerExecutedOrderId(execOrderId);
                    }
                    const finalRefillUsdt = (execRefillQty * execRefillPrice).toFixed(2);
                    simulatorRef.current.addLog("SUCCESS", `⚡ [币安实盘确认] 【自动策略信号】|【策略加仓补位】|【原主仓位】| 币种: ${formatCoin(cleanSymbol)} | 方向: ${position.side === 'LONG' ? '买入做多 (LONG)' : '卖出做空 (SHORT)'} | 成交均价: ${execRefillPrice} USDT | 补仓数量: ${execRefillQty.toFixed(4)} | 补仓金额: ${finalRefillUsdt} USDT | 币安订单号: ${execOrderId || clientOrderId}${raceResult?.isFromWs ? ' (WebSocket极速直通)' : ''}`);
                    if (reconData?.trades && Array.isArray(reconData.trades) && reconData.trades.length > 0) {
                        simulatorRef.current.reconcileRealTradesFromBinance(reconData.trades);
                    } else if (reconData?.latestTrade) {
                        simulatorRef.current.reconcileRealTradesFromBinance([reconData.latestTrade]);
                    }
                    simulatorRef.current.handleRealRefillSuccess(position.symbol, position.side, execRefillQty, reason);
                    const updatedSimPositions = simulatorRef.current.getPositions();
                    setPositions(updatedSimPositions);
                }
                
                const cleanSym = position.symbol.replace('USDT', '');
                audioService.speak(`${cleanSym}已自动补仓`, true);

                if (typeof (window as any).triggerApiSync === "function") {
                    (window as any).triggerApiSync(true, cleanSymbol);
                }
            } else {
                const errMsg = resData.error || (resData.orderId === "EXISTING_POSITION_INTERCEPTED" ? "币安持仓拦截" : "未获交易所成交确认");
                if (simulatorRef.current) {
                    simulatorRef.current.addLog("DANGER", `⚡ [币安实盘] 自动补位未获确认: ${errMsg}，正在启动对账同步...`);
                }
                if (typeof (window as any).triggerApiSync === "function") {
                    (window as any).triggerApiSync(true, cleanSymbol);
                }
                audioService.speak("自动补仓未获确认");
            }
        } catch (e: any) {
            if (simulatorRef.current) {
                simulatorRef.current.addLog("DANGER", `⚡ [币安实盘] 自动补位网络异常: ${e.message || e}，正在启动对账同步...`);
            }
            if (typeof (window as any).triggerApiSync === "function") {
                (window as any).triggerApiSync(true, cleanSymbol);
            }
        } finally {
            if (cleanupTradeListener) cleanupTradeListener();
            // ⚡【一键清仓级极速释放】立即清理补仓在途锁
            inFlightRefillRef.current.delete(refillLockKey);
            if (simulatorRef.current) {
                simulatorRef.current.releaseInFlightRefill(position.symbol, position.side);
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
            simulatorRef.current.addLog("INFO", `⚡ [自动复开触发] 正在向币安发送开仓指令以完全复开原仓位: ${cleanSymbol} ${side} | 原始金额: ${amountUsdt.toFixed(2)} USDT | 原因: ${reason}`);
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

            const isHedge = !!posToClose.isHedge || !!posToClose.mainPositionId;
            const posTag = isHedge ? '【防爆对冲仓位】' : '【原主仓位】';
            const actLabel = isHedge ? '【防爆对冲减仓/平仓】' : '【市价平仓】';

            // ⚡【一键清仓级极速响应】立即进行前端与本地内存毫秒级物理预清空，UI零卡顿零延迟！
            setBinanceRealPositions(prev => prev.filter(p => !(normalizeSymbol(p.symbol) === cleanSymbol && p.side === side)));
            setPositions(prev => prev.filter(p => !(normalizeSymbol(p.symbol) === cleanSymbol && p.side === side)));
            if (simulatorRef.current) {
                simulatorRef.current.registerInFlightClosing(cleanSymbol, side, posToClose.amount);
                simulatorRef.current.removePositionLocally(cleanSymbol, side);
                const closePrice = posToClose.markPrice || posToClose.entryPrice || 0;
                const closeUsdt = (posToClose.amount * closePrice).toFixed(2);
                simulatorRef.current.addLog("INFO", `⚡ [实盘平仓直通] 【手动操作】|${actLabel}|${posTag}| 币种: ${formatCoin(cleanSymbol)} | 方向: ${side === 'LONG' ? '卖出平多 (平多)' : '买入平空 (平空)'} | 数量: ${posToClose.amount.toFixed(4)} (约 ${closeUsdt} USDT)`);
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
                        quantity: posToClose.amount,
                        isManual: true,
                        isHedge,
                        reason: `用户手动市价平仓 (${isHedge ? '平对冲仓' : '平原主仓'})`
                    })
                });

                // ⚡ 双通道毫秒级竞速确认：只要 WebSocket 监听到成交 (通常仅需 20~50ms)，立即抢先完成平仓确认！
                let cleanupTradeListener: (() => void) | null = null;
                const wsFastTrackPromise = new Promise<any>((resolve) => {
                    const onTrade = (e: Event) => {
                        const trade = (e as CustomEvent).detail;
                        if (!trade || normalizeSymbol(trade.symbol) !== cleanSymbol) return;
                        const isClose = trade.action === "CLOSE" || trade.reduceOnly || trade.closePosition || (trade.realizedPnl !== 0) || (trade.orderStatus === "FILLED");
                        if (isClose) {
                            resolve({
                                success: true,
                                orderId: trade.orderId,
                                isFromWs: true,
                                tradeData: trade
                            });
                        }
                    };
                    window.addEventListener("BINANCE_TRADE_CONFIRMED", onTrade);
                    cleanupTradeListener = () => window.removeEventListener("BINANCE_TRADE_CONFIRMED", onTrade);
                });

                const fetchWrapPromise = fetchPromise.then(async res => {
                    const ok = res.ok;
                    const json = await res.json().catch(() => null);
                    return { ok, success: ok && json?.success, resData: json, isFromHttp: true };
                }).catch(err => ({ ok: false, success: false, error: err.message || err }));

                const timeoutPromise = new Promise<any>(resolve =>
                    setTimeout(() => resolve({ isTimeout: true, error: "币安平仓网络响应超时 (25秒)，请检查网络连接或持仓状态" }), 25000)
                );

                const winner = await Promise.race([
                    wsFastTrackPromise,
                    fetchWrapPromise,
                    timeoutPromise
                ]);

                if (cleanupTradeListener) cleanupTradeListener();

                if (winner && winner.success) {
                    const finalOrderId = winner.orderId || winner.resData?.orderId || "";
                    if (simulatorRef.current) {
                        if (finalOrderId) {
                            simulatorRef.current.registerExecutedOrderId(finalOrderId);
                        }
                        const channelTag = winner.isFromWs ? "⚡ [极速流通道]" : "⚡ [API直通]";
                        const closePrice = (winner.tradeData?.price || winner.resData?.price) || posToClose.markPrice || posToClose.entryPrice || 0;
                        const closeUsdt = (posToClose.amount * closePrice).toFixed(2);

                        let calcPnl = (winner.tradeData?.realizedPnl !== undefined && winner.tradeData.realizedPnl !== 0)
                            ? winner.tradeData.realizedPnl
                            : ((winner.resData?.realizedPnl !== undefined && winner.resData.realizedPnl !== 0)
                                ? winner.resData.realizedPnl
                                : (posToClose.unrealizedPnL || 0));

                        if (calcPnl === 0 && posToClose.entryPrice > 0 && closePrice > 0) {
                            if (side === PositionSide.LONG) {
                                calcPnl = (closePrice - posToClose.entryPrice) * posToClose.amount;
                            } else {
                                calcPnl = (posToClose.entryPrice - closePrice) * posToClose.amount;
                            }
                        }

                        const pnlFormatted = calcPnl >= 0 ? `+${calcPnl.toFixed(4)}` : `${calcPnl.toFixed(4)}`;
                        simulatorRef.current.addLog("SUCCESS", `${channelTag} 【手动操作】|${actLabel}|${posTag}| 币种: ${formatCoin(cleanSymbol)} | 方向: ${side === 'LONG' ? '卖出平多 (平多)' : '买入平空 (平空)'} | 成交均价: ${closePrice} USDT | 成交数量: ${posToClose.amount.toFixed(4)} | 成交金额: ${closeUsdt} USDT | 实际盈亏: ${pnlFormatted} USDT | 币安订单号: ${finalOrderId}`);
                        
                        const execPayload = {
                            ...(winner.resData || winner.tradeData || {}),
                            price: closePrice,
                            qty: posToClose.amount,
                            realizedPnl: calcPnl
                        };
                        simulatorRef.current.recordRealTradeLog(posToClose, '手动平仓', execPayload);
                        if (winner.resData?.trades && Array.isArray(winner.resData.trades) && winner.resData.trades.length > 0) {
                            simulatorRef.current.reconcileRealTradesFromBinance(winner.resData.trades);
                        } else if (winner.resData?.latestTrade) {
                            simulatorRef.current.reconcileRealTradesFromBinance([winner.resData.latestTrade]);
                        }
                        setTradeLogs([...simulatorRef.current.tradeLogs]);
                    }
                    audioService.speak("实盘平仓执行成功");

                    // Sync real-time positions & fast-grab trade records instantly after order placement
                    if (typeof (window as any).triggerApiSync === "function") {
                        (window as any).triggerApiSync(true, cleanSymbol);
                    }
                } else if (winner && winner.isTimeout) {
                    if (simulatorRef.current) {
                        simulatorRef.current.addLog("DANGER", `⚡ [币安实盘] 平仓网络/超时异常: ${winner.error}，正在启动对账同步...`);
                    }
                    if (typeof (window as any).triggerApiSync === "function") {
                        (window as any).triggerApiSync(true, cleanSymbol);
                    }
                    alert(`币安实盘平仓网络/超时异常:\n${winner.error}`);
                } else {
                    const errMsg = winner?.resData?.error || winner?.resData?.message || winner?.error || "未知交易所错误";
                    if (simulatorRef.current) {
                        simulatorRef.current.addLog("DANGER", `⚡ [币安实盘] 平仓未获成功确认: ${errMsg}`);
                    }
                    if (typeof (window as any).triggerApiSync === "function") {
                        (window as any).triggerApiSync(true, cleanSymbol);
                    }
                    alert(`币安实盘平仓未获成功确认:\n${errMsg}`);
                    audioService.speak("实盘平仓失败");
                }
            } catch (e: any) {
                if (simulatorRef.current) {
                    simulatorRef.current.addLog("DANGER", `⚡ [币安实盘] 平仓网络/超时异常: ${e.message || e}`);
                }
                if (typeof (window as any).triggerApiSync === "function") {
                    (window as any).triggerApiSync(true, cleanSymbol);
                }
                alert(`币安实盘平仓网络/超时异常:\n${e.message || e}`);
            }
        } else {
            simulatorRef.current?.closePosition(cleanSymbol, side, 'MANUAL');
            setPositions(prev => prev.filter(p => !(normalizeSymbol(p.symbol) === cleanSymbol && p.side === side)));
        }
    }, [combinedPositions, binanceRealPositions]);

    const handleCloseAllForSymbol = useCallback(async (symbol: string) => {
        const cleanSymbol = normalizeSymbol(symbol);
        const targets = positions.filter(p => normalizeSymbol(p.symbol) === cleanSymbol && p.amount > 0);
        if (targets.length === 0) return;
        
        handleLog('WARNING', `⚠️ [一键全平] 正在市价全平 ${symbol} 的所有仓位 (共 ${targets.length} 笔，全并发执行)...`);
        // ⚡【一键清仓级全并发双向秒平】杜绝串行循环，全部并发提交
        await Promise.all(targets.map(pos => handleClosePosition(pos.symbol, pos.side)));
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
                simulatorRef.current.addLog("INFO", `[实盘一键清仓] 启动全量极速平仓，共 ${activePositionsToClose.length} 个仓位，全并发实时平仓提交...`);
            }

            // 🔒 [平仓在途缓冲与自愈保护]：立即注册进入批量平仓缓冲池，防止5秒内因轮询未撮合完而误弹回
            if (simulatorRef.current) {
                simulatorRef.current.registerInFlightBatchClose(activePositionsToClose);
            }
            setBinanceRealPositions([]);
            setPositions([]);
            audioService.speak("全部持仓平仓指令已发送");

            // 🔒【分时段批量清仓与防拥塞引擎】：每批最多6个币，严格等待1秒间隔后再提交下一批6个币
            const BATCH_SIZE = 6;
            for (let i = 0; i < activePositionsToClose.length; i += BATCH_SIZE) {
                const batch = activePositionsToClose.slice(i, i + BATCH_SIZE);
                await Promise.all(batch.map(async (pos) => {
                    const cleanSymbol = normalizeSymbol(pos.symbol);
                    const isHedge = !!pos.isHedge || !!pos.mainPositionId;
                    const posTag = isHedge ? '【防爆对冲仓位】' : '【原主仓位】';
                    const posMarkEst = pos.markPrice || pos.entryPrice || 0;
                    const posUsdtEst = (pos.amount * posMarkEst).toFixed(2);
                    try {
                        if (simulatorRef.current) {
                            simulatorRef.current.addLog("INFO", `⚡ [实盘一键清仓] 【手动操作】|【一键全量批量平仓】|${posTag}| 币种: ${formatCoin(cleanSymbol)} | 方向: ${pos.side === 'LONG' ? '卖出平多 (平多)' : '买入平空 (平空)'} | 数量: ${pos.amount.toFixed(4)} (约 ${posUsdtEst} USDT)`);
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
                                quantity: pos.amount,
                                isManual: true,
                                isHedge,
                                isBatch: true,
                                reason: `一键全量批量平仓 (${isHedge ? '平对冲仓' : '平原主仓'})`
                            })
                        });

                        // ⚡ 双通道毫秒级竞速确认：只要 WebSocket 监听到成交，立即抢先完成平仓确认！
                        let cleanupTradeListener: (() => void) | null = null;
                        const wsFastTrackPromise = new Promise<any>((resolve) => {
                            const onTrade = (e: Event) => {
                                const trade = (e as CustomEvent).detail;
                                if (!trade || normalizeSymbol(trade.symbol) !== cleanSymbol) return;
                                const isClose = trade.action === "CLOSE" || trade.reduceOnly || trade.closePosition || (trade.realizedPnl !== 0) || (trade.orderStatus === "FILLED");
                                if (isClose) {
                                    resolve({
                                        success: true,
                                        orderId: trade.orderId,
                                        isFromWs: true,
                                        tradeData: trade
                                    });
                                }
                            };
                            window.addEventListener("BINANCE_TRADE_CONFIRMED", onTrade);
                            cleanupTradeListener = () => window.removeEventListener("BINANCE_TRADE_CONFIRMED", onTrade);
                        });

                        const fetchWrapPromise = fetchPromise.then(async res => {
                            const ok = res.ok;
                            const json = await res.json().catch(() => null);
                            return { ok, success: ok && json?.success, resData: json, isFromHttp: true };
                        }).catch(err => ({ ok: false, success: false, error: err.message || err }));

                        const timeoutPromise = new Promise<any>(resolve =>
                            setTimeout(() => resolve({ isTimeout: true, error: "平仓网络响应超时 (25秒)" }), 25000)
                        );

                        const winner = await Promise.race([
                            wsFastTrackPromise,
                            fetchWrapPromise,
                            timeoutPromise
                        ]);

                        if (cleanupTradeListener) cleanupTradeListener();

                        if (winner && winner.success) {
                            const finalOrderId = winner.orderId || winner.resData?.orderId || "";
                            if (simulatorRef.current) {
                                if (finalOrderId) {
                                    simulatorRef.current.registerExecutedOrderId(finalOrderId);
                                }
                                const channelTag = winner.isFromWs ? "⚡ [极速流通道]" : "⚡ [API直通]";
                                const posMark = (winner.tradeData?.price || winner.resData?.price) || pos.markPrice || pos.entryPrice || 0;
                                const posUsdt = (pos.amount * posMark).toFixed(2);
                                
                                let calcPnl = (winner.tradeData?.realizedPnl !== undefined && winner.tradeData.realizedPnl !== 0)
                                    ? winner.tradeData.realizedPnl
                                    : ((winner.resData?.realizedPnl !== undefined && winner.resData.realizedPnl !== 0)
                                        ? winner.resData.realizedPnl
                                        : (pos.unrealizedPnL || 0));

                                if (calcPnl === 0 && pos.entryPrice > 0 && posMark > 0) {
                                    if (pos.side === PositionSide.LONG) {
                                        calcPnl = (posMark - pos.entryPrice) * pos.amount;
                                    } else {
                                        calcPnl = (pos.entryPrice - posMark) * pos.amount;
                                    }
                                }

                                const pnlFormatted = calcPnl >= 0 ? `+${calcPnl.toFixed(4)}` : `${calcPnl.toFixed(4)}`;
                                simulatorRef.current.addLog("SUCCESS", `${channelTag} 【手动操作】|【一键全量批量平仓】|${posTag}| 币种: ${formatCoin(cleanSymbol)} | 方向: ${pos.side === 'LONG' ? '卖出平多 (平多)' : '买入平空 (平空)'} | 成交均价: ${posMark.toFixed(4)} USDT | 成交数量: ${pos.amount.toFixed(4)} | 成交金额: ${posUsdt} USDT | 实际盈亏: ${pnlFormatted} USDT | 币安订单号: ${finalOrderId}`);
                                
                                const execPayload = {
                                    ...(winner.resData || winner.tradeData || {}),
                                    price: posMark,
                                    qty: pos.amount,
                                    realizedPnl: calcPnl
                                };
                                simulatorRef.current.recordRealTradeLog(pos, '一键全平', execPayload);
                                if (winner.resData?.trades && Array.isArray(winner.resData.trades) && winner.resData.trades.length > 0) {
                                    simulatorRef.current.reconcileRealTradesFromBinance(winner.resData.trades);
                                } else if (winner.resData?.latestTrade) {
                                    simulatorRef.current.reconcileRealTradesFromBinance([winner.resData.latestTrade]);
                                }
                                simulatorRef.current.removePositionLocally(cleanSymbol, pos.side);
                            }
                        } else {
                            const errMsg = winner?.resData?.error || winner?.resData?.message || winner?.error || "未知交易所错误";
                            if (simulatorRef.current) {
                                simulatorRef.current.addLog("DANGER", `⚡ [币安实盘] 平仓未获成功确认: ${cleanSymbol} | 原因: ${errMsg}`);
                            }
                        }
                    } catch (e: any) {
                        if (simulatorRef.current) {
                            simulatorRef.current.addLog("DANGER", `⚡ [币安实盘] 平仓网络/超时异常: ${pos.symbol} | 原因: ${e.message || e}`);
                        }
                    }
                }));
                if (i + BATCH_SIZE < activePositionsToClose.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
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
            setPositions([]);
            audioService.speak("全部持仓已平仓", true);
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

    // 🔒【单币主动刷新与币安实际持仓/流水对账引擎】
    const handleVerifyPosition = async (position: Position | string) => {
        let cleanSymbol = typeof position === 'string' ? normalizeSymbol(position) : normalizeSymbol(position.symbol);
        if (isMemeScaledCoin(cleanSymbol) && !cleanSymbol.startsWith('1000')) {
            cleanSymbol = '1000' + cleanSymbol;
        }
        const isReal = settingsRef.current.system.realTrading;

        if (!isReal) {
            // 模拟模式：核对本地交易记录与持仓开仓价
            if (typeof position !== 'string') {
                simulatorRef.current?.verifyPosition(position, tradeLogs);
                simulatorRef.current?.addLog('INFO', `ℹ️ [模拟模式] 已核验 ${cleanSymbol} 模拟仓位开仓均价与本地交易记录`);
            } else {
                const simPos = simulatorRef.current?.getPositions().find(p => normalizeSymbol(p.symbol) === cleanSymbol || normalizeSymbol(p.symbol) === normalizeSymbol(position));
                if (simPos) {
                    simulatorRef.current?.verifyPosition(simPos, tradeLogs);
                    simulatorRef.current?.addLog('INFO', `ℹ️ [模拟模式] 已核验 ${cleanSymbol} 模拟仓位开仓均价与本地交易记录`);
                } else {
                    simulatorRef.current?.addLog('INFO', `ℹ️ [模拟模式] 已查询 ${cleanSymbol}：当前本地无此币模拟持仓记录`);
                }
            }
            return;
        }

        const apiKey = settingsRef.current.system.binanceApiKey;
        const apiSecret = settingsRef.current.system.binanceApiSecret;
        if (!apiKey || !apiSecret) {
            simulatorRef.current?.addLog('WARNING', `⚠️ [单币对账] 实盘模式已开启，但未配置有效的 API 密钥，无法向币安拉取实盘数据`);
            return;
        }

        simulatorRef.current?.addLog('INFO', `🔄 [单币主动对账] 正在向币安交易所核对 ${cleanSymbol} 的实际持仓数据与成交流水...`);

        try {
            // 并发双通道穿透：单币持仓 (/api/binance/symbol-position) + 单币成交流水 (/api/binance/fast-user-trades)
            const [posRes, tradeRes] = await Promise.all([
                fetch("/api/binance/symbol-position", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ apiKey, apiSecret, symbol: cleanSymbol })
                }).then(r => r.json()).catch(err => ({ success: false, error: err.message || err })),
                
                fetch("/api/binance/fast-user-trades", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ apiKey, apiSecret, symbol: cleanSymbol, limit: 50 })
                }).then(r => r.json()).catch(err => ({ success: false, error: err.message || err }))
            ]);

            // 1. 处理最新成交记录并自动补齐交易日志
            if (tradeRes && tradeRes.success && Array.isArray(tradeRes.trades) && tradeRes.trades.length > 0) {
                if (simulatorRef.current) {
                    simulatorRef.current.reconcileRealTradesFromBinance(tradeRes.trades);
                    setTradeLogs([...simulatorRef.current.tradeLogs]);
                    tradeLogsRef.current = [...simulatorRef.current.tradeLogs];
                }
            }

            // 2. 处理单币实际持仓
            if (posRes && posRes.success && Array.isArray(posRes.positions)) {
                // 筛选非零真实持仓
                const activeBinancePositions = posRes.positions.filter((p: any) => {
                    const amt = parseFloat(p.positionAmt || "0");
                    return Math.abs(amt) > 0.000001;
                });

                if (activeBinancePositions.length > 0) {
                    // 币安实际持有该币仓位，精准构建持仓对象
                    const incomingPositions: Position[] = [];
                    for (const bp of activeBinancePositions) {
                        const amt = Math.abs(parseFloat(bp.positionAmt || "0"));
                        const side = (bp.positionSide === 'LONG' || (bp.positionSide === 'BOTH' && parseFloat(bp.positionAmt) > 0)) 
                            ? PositionSide.LONG 
                            : PositionSide.SHORT;
                        const entryPrice = parseFloat(bp.entryPrice || "0");
                        const unPnl = parseFloat(bp.unRealizedProfit || "0");
                        const markPrice = parseFloat(bp.markPrice || "0") || entryPrice;
                        const liqPrice = parseFloat(bp.liquidationPrice || "0");
                        const leverage = parseFloat(bp.leverage || "20");
                        const maintMargin = parseFloat(bp.maintMargin || "0");
                        const totalVal = (amt * (entryPrice || markPrice)).toFixed(2);

                        incomingPositions.push({
                            entryId: `${cleanSymbol}_${side}_REAL_${Date.now()}`,
                            symbol: cleanSymbol,
                            side,
                            amount: amt,
                            entryPrice,
                            markPrice,
                            liquidationPrice: liqPrice,
                            unrealizedPnL: unPnl,
                            unrealizedPnLPercentage: (entryPrice > 0) ? (unPnl / (amt * entryPrice)) * 100 : 0,
                            leverage,
                            maintMargin,
                            entryTime: Date.now()
                        } as Position);

                        simulatorRef.current?.addLog('SUCCESS', `🟢 [单币对账成功] 币安实际持有 ${cleanSymbol} ${side} | 数量: ${amt} (约 ${totalVal} USDT) | 开仓均价: ${entryPrice} | 浮动盈亏: ${unPnl >= 0 ? '+' : ''}${unPnl.toFixed(4)} USDT | 已精准同步持仓与流水！`);
                    }

                    // 保留其他币种持仓不变，仅更新/替换该指定币种的真实持仓
                    if (simulatorRef.current) {
                        const currentPositions = simulatorRef.current.getPositions();
                        const otherPositions = currentPositions.filter(p => normalizeSymbol(p.symbol) !== cleanSymbol);
                        const combined = [...otherPositions, ...incomingPositions];
                        simulatorRef.current.setPositions(combined);
                        const enriched = simulatorRef.current.getPositions();
                        setBinanceRealPositions(enriched);
                        setPositions(enriched);
                    }
                    audioService.speak(`${cleanSymbol}已同步币安持仓`);
                } else {
                    // 币安实际持仓为 0
                    simulatorRef.current?.addLog('INFO', `⚪ [单币对账反馈] 币安实际持仓为 0：${cleanSymbol} 当前无实盘持仓 (此前开仓请求未在交易所成交或已平仓)`);
                    
                    // 检查本地若存在超过 30 秒的悬空持仓，则同步校准清理
                    if (simulatorRef.current) {
                        const existing = simulatorRef.current.getPositions().find(p => normalizeSymbol(p.symbol) === cleanSymbol);
                        const isRecentlyOpened = existing && existing.entryTime && (Date.now() - existing.entryTime < 30000);
                        if (existing && !isRecentlyOpened) {
                            simulatorRef.current.removePositionLocally(cleanSymbol, existing.side);
                            const enriched = simulatorRef.current.getPositions();
                            setBinanceRealPositions(enriched);
                            setPositions(enriched);
                            simulatorRef.current.addLog('WARNING', `⚠️ [单币对账校准] 检测到 ${cleanSymbol} 在币安实际持仓为 0，已同步清理本地悬空持仓`);
                        }
                    }
                }
            } else {
                const err = posRes?.error || "未知网络异常";
                simulatorRef.current?.addLog('WARNING', `⚠️ [单币对账提示] 查询币安持仓响应异常: ${err}，已触发后台对账通道`);
                if (typeof (window as any).triggerApiSync === "function") {
                    (window as any).triggerApiSync(true, cleanSymbol);
                }
            }
        } catch (e: any) {
            simulatorRef.current?.addLog('DANGER', `🚨 [单币对账失败] 主动刷新异常: ${e.message || e}`);
        }
    };

    // 🔒【全账户成交流水主动对账与补齐（全面覆盖手机APP/外部程序/本系统开平仓）】
    const handleSyncAllTrades = async () => {
        const apiKey = settingsRef.current.system.binanceApiKey;
        const apiSecret = settingsRef.current.system.binanceApiSecret;
        if (!apiKey || !apiSecret || !settingsRef.current.system.realTrading) return;

        try {
            const currentPositions = simulatorRef.current ? simulatorRef.current.getPositions() : [];
            const recentSymbols = simulatorRef.current 
                ? simulatorRef.current.tradeLogs.slice(0, 15).map(l => l.symbol).filter(Boolean)
                : [];
            const targetSymbols = Array.from(new Set([
                ...currentPositions.map(p => p.symbol),
                ...recentSymbols,
                ...(tradeLogSearchSymbol ? [tradeLogSearchSymbol] : []),
                'SCRUSDT' // 确保手机APP开仓币种必定被全覆盖对账
            ].filter(Boolean))).slice(0, 25);

            if (targetSymbols.length === 0) return;

            simulatorRef.current?.addLog('INFO', `🔄 [流水对账] 正在向币安抓取最新成交流水 (覆盖手机APP/外部程序开仓)...`);

            const tradeResp = await fetch("/api/binance/user-trades", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    apiKey,
                    apiSecret,
                    symbols: targetSymbols,
                    startTime: Math.max(
                        simulatorRef.current?.clearedTradeLogsTimestamp || 0,
                        Date.now() - ((settingsRef.current.system.syncHistoryLookbackHours || 1) * 3600000) // 可配置流水回溯（默认1小时），提升对账速度
                    ),
                    limit: 50
                })
            });

            if (tradeResp.ok) {
                const tradeJson = await tradeResp.json();
                if (tradeJson && tradeJson.success && Array.isArray(tradeJson.trades) && tradeJson.trades.length > 0) {
                    if (simulatorRef.current) {
                        simulatorRef.current.reconcileRealTradesFromBinance(tradeJson.trades);
                        setTradeLogs([...simulatorRef.current.tradeLogs]);
                        tradeLogsRef.current = [...simulatorRef.current.tradeLogs];
                        setPositions([...simulatorRef.current.getPositions()]);
                        setBinanceRealPositions([...simulatorRef.current.getPositions()]);
                    }
                }
            }
        } catch (e: any) {
            console.warn("[AllTrades Sync] Failed to sync user trades:", e);
        }
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
                const estQty = (hedgeAmountUsdt / (livePrice || 1)).toFixed(4);
                simulatorRef.current.addLog("INFO", `⚡ [实盘手动对冲] 【手动操作】|【防爆对冲开仓】|【防爆对冲仓位】| 币种: ${formatCoin(cleanSymbol)} | 方向: ${hedgeSide === 'LONG' ? '买入做多 (LONG)' : '卖出做空 (SHORT)'} | 委托数量: ${estQty} | 委托金额: ${hedgeAmountUsdt.toFixed(2)} USDT`);
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
                        amountUsdt: hedgeAmountUsdt,
                        isManual: true,
                        isHedge: true,
                        reason: `用户手动防爆对冲开仓 (${hedgeSide === 'LONG' ? '做多' : '做空'})`
                    })
                });

                const resData = await response.json();
                if (response.ok && resData.success) {
                    if (simulatorRef.current) {
                        if (resData.orderId) {
                            simulatorRef.current.registerExecutedOrderId(resData.orderId);
                        }
                        const hedgePrice = resData.price || livePrice;
                        const hedgeQty = Number(resData.qty || (hedgeAmountUsdt / hedgePrice) || 0);
                        const hedgeUsdt = (hedgeQty * hedgePrice).toFixed(2);
                        simulatorRef.current.addLog("SUCCESS", `⚡ [币安实盘确认] 【手动操作】|【防爆对冲开仓】|【防爆对冲仓位】| 币种: ${formatCoin(cleanSymbol)} | 方向: ${hedgeSide === 'LONG' ? '买入做多 (LONG)' : '卖出做空 (SHORT)'} | 成交均价: ${hedgePrice} USDT | 成交数量: ${hedgeQty.toFixed(4)} | 成交金额: ${hedgeUsdt} USDT | 币安订单号: ${resData.orderId}`);
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
                        const updatedPositions = simulatorRef.current.getPositions();
                        simulatorRef.current.emitUpdate(true);
                        setPositions([...updatedPositions]);
                        setBinanceRealPositions([...updatedPositions]);

                        if (typeof (window as any).triggerApiSync === "function") {
                            (window as any).triggerApiSync(true, cleanSymbol);
                        }
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

    // 🔒 [手动断臂求生：砍仓]
    const handleManualAmputate = async (position: Position) => {
        const cleanSymbol = normalizeSymbol(position.symbol);
        const cutRatio = settingsRef.current.stopLoss?.amputationRatio || 50;
        const currentAmount = position.amount;
        if (currentAmount <= 0.0001) {
            alert(`⚠️ [手动砍仓拦截] ${cleanSymbol} 当前持仓数量为0或过小，无法砍仓！`);
            return;
        }
        const cutAmount = currentAmount * (cutRatio / 100);
        
        if (settingsRef.current.system.realTrading) {
            simulatorRef.current?.addLog("INFO", `⚡ [手动断臂求生] 正在向币安发送市价砍仓请求: ${cleanSymbol} ${position.side} | 削减比例: ${cutRatio}% | 数量: ${cutAmount.toFixed(4)}...`);
            audioService.speak(`${cleanSymbol}手动断臂砍仓`);
            await handleAutoClose(position, `3. 手动断臂求生: 交易员手动砍仓 ${cutRatio}%`, cutAmount, cutRatio);
        } else {
            if (simulatorRef.current) {
                simulatorRef.current.amputate(position, cutRatio, `3. 手动断臂求生: 交易员手动砍仓 ${cutRatio}%`);
                const updated = simulatorRef.current.getPositions();
                setPositions(updated);
                setTradeLogs([...simulatorRef.current.tradeLogs]);
                simulatorRef.current.addLog("SUCCESS", `⚡ [模拟断臂求生] 手动砍仓完成: ${cleanSymbol} ${position.side} | 削减: ${cutRatio}% | 数量: ${cutAmount.toFixed(4)} | 亏损已记入负债池并开启回踩补仓`);
            }
            audioService.speak(`${cleanSymbol}已手动砍仓`);
        }
    };

    // 🔒 [手动断臂求生：补仓]
    const handleManualRefill = async (position: Position) => {
        const cleanSymbol = normalizeSymbol(position.symbol);
        const allPositions = simulatorRef.current ? simulatorRef.current.getPositions() : positions;
        const opposingPos = allPositions.find(p => normalizeSymbol(p.symbol) === cleanSymbol && p.side !== position.side);
        
        let refillAmount = position.amputatedAmount || 0;
        if (refillAmount <= 0.0001 && opposingPos && opposingPos.amount > position.amount) {
            refillAmount = opposingPos.amount - position.amount;
        }
        if (refillAmount <= 0.0001) {
            refillAmount = position.amount > 0 ? position.amount : 0;
        }

        if (refillAmount <= 0.0001) {
            alert(`⚠️ [手动补仓提示] ${cleanSymbol} 未检测到待补仓数量，且持仓数量平衡！`);
            return;
        }

        if (settingsRef.current.system.realTrading) {
            simulatorRef.current?.addLog("INFO", `⚡ [手动断臂求生] 正在向币安发送市价补仓请求: ${cleanSymbol} ${position.side} | 补回数量: ${refillAmount.toFixed(4)}...`);
            audioService.speak(`${cleanSymbol}手动回踩补仓`);
            await handleAutoOpenRefill(position, refillAmount, `3. 手动断臂求生: 交易员手动回踩补仓`);
        } else {
            if (simulatorRef.current) {
                if (!position.amputatedAmount) {
                    position.amputatedAmount = refillAmount;
                }
                simulatorRef.current.refill(position, `3. 手动断臂求生: 交易员手动回踩补仓`);
                const updated = simulatorRef.current.getPositions();
                setPositions(updated);
                setTradeLogs([...simulatorRef.current.tradeLogs]);
                simulatorRef.current.addLog("SUCCESS", `⚡ [模拟断臂求生] 手动回踩补仓完成: ${cleanSymbol} ${position.side} | 补回数量: ${refillAmount.toFixed(4)} | 双向持仓已平衡恢复`);
            }
            audioService.speak(`${cleanSymbol}已手动补仓`);
        }
    };

    // 🔒 [手动断臂求生：成对清仓]
    const handleManualClosePair = async (position: Position) => {
        const cleanSymbol = normalizeSymbol(position.symbol);
        const allPositions = simulatorRef.current ? simulatorRef.current.getPositions() : positions;
        const opposingPos = allPositions.find(p => normalizeSymbol(p.symbol) === cleanSymbol && p.side !== position.side);
        
        audioService.speak(`${cleanSymbol}手动成对清仓`);
        simulatorRef.current?.addLog("INFO", `⚡ [手动断臂求生] 正在对 ${cleanSymbol} 执行成对双向清仓...`);

        if (settingsRef.current.system.realTrading) {
            const promises: Promise<any>[] = [];
            if (opposingPos && opposingPos.amount > 0.0001) {
                promises.push(handleClosePosition(opposingPos.symbol, opposingPos.side));
            }
            if (position.amount > 0.0001) {
                promises.push(handleClosePosition(position.symbol, position.side));
            }
            await Promise.all(promises);
            if (simulatorRef.current) {
                simulatorRef.current.closePair(position.entryId, opposingPos ? opposingPos.entryId : '', '3. 手动断臂求生: 交易员手动成对清仓');
                const updated = simulatorRef.current.getPositions();
                setBinanceRealPositions(updated);
                setPositions(updated);
                setTradeLogs([...simulatorRef.current.tradeLogs]);
            }
            if (typeof (window as any).triggerApiSync === "function") {
                (window as any).triggerApiSync(true, cleanSymbol);
            }
        } else {
            if (simulatorRef.current) {
                simulatorRef.current.closePair(position.entryId, opposingPos ? opposingPos.entryId : '', '3. 手动断臂求生: 交易员手动成对清仓');
                const updated = simulatorRef.current.getPositions();
                setPositions(updated);
                setTradeLogs([...simulatorRef.current.tradeLogs]);
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
            
            <div className="flex flex-1 min-w-0 transition-all duration-300">
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
                    onOpenManual={() => setShowUserManual(true)}
                    onRestoreSettings={(s) => setSettings(prev => deepMerge(prev, s))}
                    onBatchOpen={handleBatchOpen}
                    onOpenSaviorLab={openSaviorLab}
                    onUpdateBinanceRealBalance={(balance, realPositions) => {
                        const safeBalance = typeof balance === 'number' && !isNaN(balance) ? balance : (Number(balance) || 0);
                        if (simulatorRef.current) {
                            simulatorRef.current.updateRealBalance(safeBalance);
                        }
                        setAccount(prev => ({
                            ...prev,
                            binanceRealBalance: safeBalance,
                            marginBalance: safeBalance,
                            totalBalance: safeBalance,
                            maintenanceMargin: realPositions ? realPositions.reduce((sum: number, p: any) => sum + (p.maintMargin || 0), 0) : 0,
                            marginRatio: realPositions && realPositions.length > 0 && safeBalance > 0 ? (realPositions.reduce((sum: number, p: any) => sum + (p.maintMargin || 0), 0) / safeBalance * 100) : 0
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
                            onManualAmputate={handleManualAmputate}
                            onManualRefill={handleManualRefill}
                            onManualClosePair={handleManualClosePair}
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
                                handleSyncAllTrades();
                            }}
                            isSimulating={isSimulating}
                            onToggleSimulation={() => setIsSimulating(!isSimulating)}
                            onShowSymbolTradeLogs={(symbol) => {
                                setTradeLogSearchSymbol(symbol);
                                setShowTradeLogModal(true);
                                if (symbol) {
                                    if (typeof (window as any).fetchInstantTradeRecords === 'function') {
                                        (window as any).fetchInstantTradeRecords(symbol);
                                    }
                                }
                            }}
                            globalAutoReopen={false}
                            onToggleLoop={() => {}}
                            onOpenScanner={() => setShowScanner(true)}
                            settings={settings}
                            onUpdateCustomSettings={handleUpdateCustomSettings}
                            onUpdateSettings={handleSettingsChange}
                        />
                    </ErrorBoundary>
                </div>
                {showLogs && (
                    <>
                        {/* ↕️ 可拖拽高度调节分割线 (Vertical Resizable Splitter) */}
                        <div
                            onMouseDown={handleLogPanelMouseDown}
                            className="group relative h-2 -my-1 z-30 cursor-row-resize flex items-center justify-center select-none transition-all hover:h-2.5"
                            title="按住鼠标左键上下拖动，调整系统日志与当前持仓面板的高度大小"
                        >
                            {/* Visual indicator bar */}
                            <div className="w-full h-[1px] bg-slate-800 group-hover:bg-indigo-500 group-hover:h-[2px] transition-all" />
                            {/* Center drag pill handle */}
                            <div className="absolute px-3 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-slate-500 group-hover:text-indigo-300 group-hover:border-indigo-500 group-hover:bg-slate-800 text-[9px] font-mono flex items-center gap-1 shadow-md transition-all">
                                <span className="text-[10px] leading-none">⋮⋮</span>
                                <span className="text-[9px] scale-90">上下拖动调整日志高度</span>
                                <span className="text-[10px] leading-none">⋮⋮</span>
                            </div>
                        </div>

                        <div 
                            style={{ height: `${logPanelHeight}px` }} 
                            className="border-t border-slate-800/80 flex-shrink-0 min-h-[120px] max-h-[750px] transition-[height] duration-75 overflow-hidden"
                        >
                            <LogCenterModule 
                                logs={logs} 
                                onOpenChart={handleOpenChart}
                                onClearLogs={() => setLogs([])}
                            />
                        </div>
                    </>
                )}
            </div>
            </div>

            {/* KEEP-ALIVE SCANNER */}
            <ErrorBoundary moduleName="全域扫描终端 (Scanner Core)">
                <ScannerDashboard 
                    networkStatus={networkStatus}
                    isOnline={isOnline}
                    settings={settings.scanner} 
                    isVisible={showScanner}
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
                    tradeLogs={tradeLogs}
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
                    onExecute={(s, side, p, atr, auto) => {
                        let dynamicAmount = 10;
                        try {
                            const stratId = localStorage.getItem("SCANNER_SELECTED_STRATEGY_ID")
                                ? JSON.parse(localStorage.getItem("SCANNER_SELECTED_STRATEGY_ID") as string)
                                : "strat-1";
                            const raw = localStorage.getItem(`SCANNER_ACTION_CONFIG_${stratId}`) || localStorage.getItem("SCANNER_ACTION_CONFIG");
                            if (raw) {
                                const parsed = JSON.parse(raw);
                                if (typeof parsed.openAmount === 'number' && parsed.openAmount > 0) {
                                    dynamicAmount = parsed.openAmount;
                                }
                            }
                        } catch {}
                        handleOpenPosition(s, side, dynamicAmount, p);
                    }}
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
                    onRefresh={handleSyncAllTrades}
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
