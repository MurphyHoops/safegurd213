
import React, { useState, useEffect, useRef } from 'react';
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
import { MarketProvider } from './store/MarketContext';

const DEFAULT_SETTINGS: AppSettings = {
    profit: {
        enabled: true,
        profitMode: 'CONVENTIONAL',
        conventional: { minPosition: 100, profitPercent: 5, callbackPercent: 1, closePercent: 100 },
        dynamic: { minPosition: 100, tiers: [{ profit: 5, callback: 1, close: 50 }, { profit: 10, callback: 2, close: 100 }] },
        smart: { activationProfit: 5 },
        global: { profitPercent: 0, lossPercent: 0, profitAmount: 0, lossAmount: 0 },
        stopLoss: { enabled: true, minPosition: 100, lossPercent: 5, closePercent: 100 }
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
        breakKLineEnabled: false,
        breakKLineRatio: 20
    },
    stopLoss: {
        originalProfitClear: false,
        hedgeStopLossPercent: 0,
        originalCoverPercent: 20,
        hedgeProfitClear: false,
        hedgeOpenRatio: 100,
        hedgeCoverPercent: 20,
        hedgeProfitClearStopLoss: 0,
        callbackProfitClear: true,
        callbackHedgeRatio: 100,
        callbackCoverPercent: 20,
        callbackTargetProfit: 10,
        callbackRate: 2,
        callbackStopLoss: 0,
        amputationEnabled: false,
        amputationTriggerProfit: 50,
        amputationRatio: 50,
        amputationVictoryBuffer: 10,
        amputationRefillRetrace: 5,
        fuseEnabled: true,
        maxHedgeRetries: 3,
        fuseFailStopPercent: 30,
        advisor: { enabled: true, autoSwitch: false, minConfidence: 70 }
    },
    martingale: { enabled: false },
    system: { binanceApiKey: '', binanceApiSecret: '', directMode: false },
    scanner: {
        minVolume: 1, 
        minChange: 1, 
        source: 'BOTH',
        timeBasis: '24H',
        limit: 600,   
        customSymbols: '',
        useCustomOnly: false,
        batchSize: 40
    },
    trendHunter: { enabled: false }
};

const AppContent: React.FC = () => {
    const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
    const [account, setAccount] = useState<AccountData>({ marginBalance: 10000, totalBalance: 10000, maintenanceMargin: 0, marginRatio: 999 });
    const [positions, setPositions] = useState<Position[]>([]);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [tradeLogs, setTradeLogs] = useState<TradeLog[]>([]);
    const [systemEvents, setSystemEvents] = useState<SystemEvent[]>([]);
    const [realPrices, setRealPrices] = useState<Record<string, number>>({});
    
    const [isSimulating, setIsSimulating] = useState(false);
    const [showLogs, setShowLogs] = useState(true);
    const [showTradeLogModal, setShowTradeLogModal] = useState(false);
    const [showScanner, setShowScanner] = useState(false);
    const [showTrendHunter, setShowTrendHunter] = useState(false);
    const [showUserManual, setShowUserManual] = useState(false);
    const [showSourceCode, setShowSourceCode] = useState(false);
    const [showSubscription, setShowSubscription] = useState(false);
    const [recommendation, setRecommendation] = useState<any>(null);

    const simulatorRef = useRef<MarketSimulator | null>(null);
    
    const isSimulatingRef = useRef(isSimulating);
    useEffect(() => { isSimulatingRef.current = isSimulating; }, [isSimulating]);

    const activePositionsRef = useRef(positions);
    useEffect(() => { activePositionsRef.current = positions; }, [positions]);

    const showScannerRef = useRef(showScanner);
    useEffect(() => { showScannerRef.current = showScanner; }, [showScanner]);

    const directModeRef = useRef(settings.system.directMode || false);
    useEffect(() => { directModeRef.current = settings.system.directMode || false; }, [settings.system.directMode]);

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
        
        const interval = setInterval(async () => {
            if (activePositionsRef.current.length > 0 || showScannerRef.current) {
                try {
                    // Added validator to handle AllOrigins proxy wrapper if fallback occurs
                    const res = await fetchWithFallback(
                        'https://fapi.binance.com/fapi/v1/ticker/price', 
                        undefined, 
                        (d) => Array.isArray(d), 
                        directModeRef.current
                    );
                    
                    if (res.ok) {
                        const data = await res.json();
                        if (Array.isArray(data)) {
                            const newPriceMap: Record<string, number> = {};
                            data.forEach((item: any) => {
                                newPriceMap[item.symbol] = parseFloat(item.price);
                            });
                            
                            setRealPrices(prev => ({...prev, ...newPriceMap}));
                            if (simulatorRef.current) {
                                simulatorRef.current.updateRealPrices(newPriceMap);
                            }
                        }
                    }
                } catch (e) {
                    // Silent fail for price ticker to avoid log spam
                }
            }

            if (simulatorRef.current) {
                simulatorRef.current.tick(isSimulatingRef.current);
            }

        }, 1000);

        return () => clearInterval(interval);
    }, []); 

    useEffect(() => {
        if(simulatorRef.current) {
            simulatorRef.current.updateSettings(settings);
        }
    }, [settings]);

    const handleSettingsChange = (section: keyof AppSettings, key: string, value: any) => {
        setSettings(prev => ({
            ...prev,
            [section]: {
                ...prev[section],
                [key]: value
            }
        }));
    };

    const handleOpenPosition = (symbol: string, side: PositionSide, amount: number, price: number, signalTf?: string) => {
        simulatorRef.current?.openPosition(symbol, side, amount, price, signalTf);
    };

    const handleClosePosition = (symbol: string, side: PositionSide) => {
        simulatorRef.current?.closePosition(symbol, side, 'MANUAL');
    };

    const handleBatchOpen = (simSettings: SimulationSettings) => {
        simulatorRef.current?.openBatchPositions('BTCUSDT', 'RANDOM', 5, 100, 0, false, 'BOTH', '24H', 10);
    };

    const handleApplyRecommendation = (rec: any) => {
        simulatorRef.current?.applyStrategyRecommendation(rec);
        setRecommendation(null);
    };

    useEffect(() => {
        const status = subscriptionService.getLicenseStatus();
        if (!status.isActive) {
            setShowSubscription(true);
        }
    }, []);

    return (
        <div className="flex h-screen bg-slate-950 text-slate-200 overflow-hidden font-sans">
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
                    onRestoreSettings={(s) => setSettings(s)}
                    onBatchOpen={handleBatchOpen}
                />
            </div>

            <div className="flex-1 flex flex-col min-w-0">
                <div className="flex-1 overflow-auto p-2">
                    <Dashboard 
                        account={account}
                        positions={positions}
                        tradeLogs={tradeLogs}
                        realPrices={realPrices}
                        onRowLongPress={() => {}}
                        onShowHistory={() => setShowTradeLogModal(true)}
                        hasHistory={() => tradeLogs.length > 0}
                        onClearPositions={() => simulatorRef.current?.batchCloseAllPositions()}
                        onClosePosition={handleClosePosition}
                        onDeletePosition={handleClosePosition}
                        onBatchClose={() => simulatorRef.current?.batchCloseAllPositions()}
                        onOpenChart={() => {}}
                        onOpenLogs={() => setShowLogs(!showLogs)}
                        onOpenTradeModal={() => setShowTradeLogModal(true)}
                        isSimulating={isSimulating}
                        onToggleSimulation={() => setIsSimulating(!isSimulating)}
                        onShowSymbolTradeLogs={() => setShowTradeLogModal(true)}
                        globalAutoReopen={false}
                        onToggleLoop={() => {}}
                        onOpenScanner={() => setShowScanner(true)}
                        settings={settings}
                    />
                </div>
                {showLogs && (
                    <div className="h-48 border-t border-slate-800">
                        <LogCenterModule logs={logs} />
                    </div>
                )}
            </div>

            {showScanner && (
                <ScannerDashboard 
                    settings={settings.scanner} 
                    onClose={() => setShowScanner(false)}
                    onOpenPosition={handleOpenPosition}
                    onClosePosition={handleClosePosition}
                    realPrices={realPrices}
                    activePositions={positions}
                    balance={account.marginBalance}
                    directMode={settings.system.directMode}
                />
            )}
            
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
                    onClose={() => setShowTradeLogModal(false)} 
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
