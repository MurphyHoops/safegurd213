
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { KLine, AppSettings, Position, AccountData, TradeLog, LogEntry } from '../../types';

interface BacktestContextType {
    virtualTime: number;
    realPrices: Record<string, number>;
    klinesMap: Record<string, Record<string, KLine[]>>;
    account: AccountData;
    positions: Position[];
    logs: LogEntry[];
    tradeLogs: TradeLog[];
    isPlaying: boolean;
    speed: number;
    currentIndex: number;
    totalSteps: number;
    
    // Actions
    setVirtualTime: (t: number) => void;
    setAccount: React.Dispatch<React.SetStateAction<AccountData>>;
    setPositions: React.Dispatch<React.SetStateAction<Position[]>>;
    setLogs: React.Dispatch<React.SetStateAction<LogEntry[]>>;
    setTradeLogs: React.Dispatch<React.SetStateAction<TradeLog[]>>;
    setIsPlaying: (p: boolean) => void;
    setSpeed: (s: number) => void;
    setCurrentIndex: React.Dispatch<React.SetStateAction<number>>;
    
    // Internal State for step logic
    baseKlines: KLine[];
    baseInterval: string;

    // Virtual API
    fetchVirtualMarketData: () => Promise<any[]>;
    fetchVirtualKlines: (symbol: string, interval: string, limit: number) => Promise<KLine[]>;
    batchCloseAll: () => void;
}

const BacktestContext = createContext<BacktestContextType | null>(null);

export const useBacktest = () => {
    const ctx = useContext(BacktestContext);
    if (!ctx) throw new Error('useBacktest must be used within BacktestProvider');
    return ctx;
};

export const useOptionalBacktest = () => {
    return useContext(BacktestContext);
};

export const BacktestProvider: React.FC<{
    children: React.ReactNode;
    klinesMap?: Record<string, Record<string, KLine[]>>;
    initialBalance?: number;
    settings?: AppSettings;
}> = ({ children, klinesMap = {}, initialBalance = 10000, settings = {} as AppSettings }) => {
    const [virtualTime, setVirtualTime] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [account, setAccount] = useState<AccountData>({
        marginBalance: initialBalance,
        totalBalance: initialBalance,
        maintenanceMargin: 0,
        marginRatio: 999
    });
    const [positions, setPositions] = useState<Position[]>([]);
    const positionsRef = React.useRef(positions);
    React.useEffect(() => {
        positionsRef.current = positions;
    }, [positions]);

    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [tradeLogs, setTradeLogs] = useState<TradeLog[]>([]);
    const [realPrices, setRealPrices] = useState<Record<string, number>>({});

    const symbols = useMemo(() => Object.keys(klinesMap), [klinesMap]);
    const getMinutes = (tf: string) => {
        const val = parseInt(tf);
        const unit = tf.slice(-1);
        if (unit === 'm') return val;
        if (unit === 'h') return val * 60;
        if (unit === 'd') return val * 1440;
        return val;
    };

    const baseInterval = useMemo(() => {
        if (symbols.length === 0) return '1m';
        const intervals = Object.keys(klinesMap[symbols[0]]);
        if (intervals.length === 0) return '1m';
        return intervals.sort((a, b) => getMinutes(a) - getMinutes(b))[0];
    }, [klinesMap, symbols]);
    
    const baseKlines = useMemo(() => {
        if (symbols.length === 0) return [];
        return klinesMap[symbols[0]][baseInterval] || [];
    }, [klinesMap, symbols, baseInterval]);
    
    const totalSteps = baseKlines.length;

    // Update realPrices based on current virtual time
    React.useEffect(() => {
        if (symbols.length === 0) return;
        const newPrices: Record<string, number> = {};
        
        symbols.forEach(symbol => {
            const klines = klinesMap[symbol][baseInterval];
            if (!klines) return;
            
            // Try direct index first for speed
            if (klines[currentIndex] && klines[currentIndex].time === virtualTime) {
                newPrices[symbol] = klines[currentIndex].close;
            } else {
                // Fallback: Find by timestamp (binary search or findLast)
                let low = 0;
                let high = klines.length - 1;
                let foundPrice = -1;
                
                while (low <= high) {
                    const mid = Math.floor((low + high) / 2);
                    if (klines[mid].time === virtualTime) {
                        foundPrice = klines[mid].close;
                        break;
                    } else if (klines[mid].time < virtualTime) {
                        foundPrice = klines[mid].close; 
                        low = mid + 1;
                    } else {
                        high = mid - 1;
                    }
                }
                
                if (foundPrice !== -1) {
                    newPrices[symbol] = foundPrice;
                }
            }
        });
        if (JSON.stringify(newPrices) !== JSON.stringify(realPrices)) {
            setRealPrices(newPrices);
        }
        
        // Reconcile Positions and Calculate totalPnL
        let totalPnL = 0;
        const currentPositions = positionsRef.current;
        const updatedPositions = currentPositions.map(p => {
            let currentPrice = newPrices[p.symbol] || p.markPrice || p.entryPrice;
            if (!currentPrice) return p;

            // --- Smart Magnitude Protection (Fixes XMR decimals if they jump 1000x) ---
            if (p.entryPrice > 0 && currentPrice > 0) {
                const ratio = currentPrice / p.entryPrice;
                // Symbols that usually don't scale but we still fix if the error is exactly ~1000x
                if (ratio > 500 || ratio < 0.002) {
                    const corrected = ratio > 500 ? currentPrice / 1000 : currentPrice * 1000;
                    const correctedRatio = corrected / p.entryPrice;
                    // If correction brings us within 20% of entry price, it's likely a decimal glitch
                    if (correctedRatio > 0.8 && correctedRatio < 1.2) {
                        currentPrice = corrected;
                    }
                }
            }

            const diff = p.side === 'LONG' 
                ? currentPrice - p.entryPrice 
                : p.entryPrice - currentPrice;
            
            const upnl = diff * p.amount;
            const upnlPct = p.entryPrice > 0 ? (diff / p.entryPrice) * 100 : 0;
            
            totalPnL += upnl;
            
            const maxPct = p.maxPnLPercent !== undefined ? Math.max(p.maxPnLPercent, upnlPct) : (upnlPct > 0 ? upnlPct : 0);
            
            // Only return new object if something actually changed to avoid unnecessary re-renders (using safe float threshold)
            const priceDiff = Math.abs((p.markPrice || 0) - currentPrice);
            const pnlDiff = Math.abs((p.unrealizedPnL || 0) - upnl);
            const pctDiff = Math.abs((p.unrealizedPnLPercentage || 0) - upnlPct);
            const maxPctDiff = Math.abs((p.maxPnLPercent || 0) - maxPct);

            if (priceDiff < 1e-6 && pnlDiff < 1e-6 && pctDiff < 1e-6 && maxPctDiff < 1e-6) {
                return p;
            }

            return {
                ...p,
                markPrice: currentPrice,
                unrealizedPnL: upnl,
                unrealizedPnLPercentage: upnlPct,
                maxPnLPercent: maxPct
            };
        });

        const hasChanged = updatedPositions.some((p, i) => p !== currentPositions[i]);
        if (hasChanged) {
            setPositions(updatedPositions);
        }

        // Sync account balance independently
        setAccount(prev => {
            const newMarginBalance = prev.totalBalance + (totalPnL || 0);
            if (Math.abs(prev.marginBalance - newMarginBalance) < 0.000001) return prev;
            return {
                ...prev,
                marginBalance: newMarginBalance
            };
        });
    }, [currentIndex, virtualTime, symbols, klinesMap, baseInterval, positions.length]); // Removed full positions dependency to prevent loop, use length to detect adds/removes

    const fetchVirtualMarketData = useCallback(async () => {
        if (symbols.length === 0) return [];
        // Mock Binance 24h ticker data based on current virtual time
        return symbols.map(symbol => {
            const klines = klinesMap[symbol][baseInterval];
            if (!klines) return null;
            const currentK = klines[currentIndex];
            if (!currentK) return null;

            // Find 24h ago
            const dayAgoIdx = Math.max(0, currentIndex - (24 * 60)); // Assuming 1m base
            const open24h = klines[dayAgoIdx]?.open || currentK.open;
            const change = ((currentK.close - open24h) / open24h) * 100;

            return {
                symbol,
                lastPrice: currentK.close.toString(),
                priceChangePercent: change.toString(),
                quoteVolume: (currentK.volume * currentK.close * 100).toString(), // Mock 24h vol
                highPrice: currentK.high.toString(),
                lowPrice: currentK.low.toString()
            };
        }).filter(Boolean);
    }, [currentIndex, klinesMap, symbols, baseInterval]);

    const fetchVirtualKlines = useCallback(async (symbol: string, interval: string, limit: number) => {
        const klines = klinesMap[symbol]?.[interval];
        if (!klines) return [];
        
        // Find the index in this interval's klines that corresponds to the current virtual time
        let lastIdx = -1;
        for (let i = klines.length - 1; i >= 0; i--) {
            if (klines[i].time <= virtualTime) {
                lastIdx = i;
                break;
            }
        }
        
        if (lastIdx === -1) return [];
        return klines.slice(Math.max(0, lastIdx - limit + 1), lastIdx + 1);
    }, [virtualTime, klinesMap]);

    const batchCloseAll = useCallback(() => {
        setPositions(prev => {
            if (prev.length === 0) return prev;
            
            const totalRealizedPnl = prev.reduce((sum, p) => sum + p.unrealizedPnL, 0);
            const now = virtualTime;
            
            const updatedTradeLogs: TradeLog[] = prev.map(p => ({
                symbol: p.symbol,
                side: p.side,
                entryPrice: p.entryPrice,
                exitPrice: p.markPrice || p.entryPrice,
                pnl: p.unrealizedPnL,
                pnlPercent: p.unrealizedPnLPercentage,
                exitTime: now,
                reason: 'BATCH_CLOSE'
            } as any));

            setAccount(acc => ({
                ...acc,
                totalBalance: acc.totalBalance + totalRealizedPnl,
                marginBalance: acc.marginBalance + totalRealizedPnl
            }));
            
            setTradeLogs(l => [...l, ...updatedTradeLogs]);
            return [];
        });
    }, [virtualTime]);

    const value = React.useMemo(() => ({
        virtualTime, setVirtualTime,
        realPrices,
        klinesMap,
        account, setAccount,
        positions, setPositions,
        logs, setLogs,
        tradeLogs, setTradeLogs,
        isPlaying, setIsPlaying,
        speed, setSpeed,
        currentIndex, setCurrentIndex,
        totalSteps,
        baseKlines,
        baseInterval,
        fetchVirtualMarketData,
        fetchVirtualKlines,
        batchCloseAll
    }), [
        virtualTime, realPrices, klinesMap, account, positions, logs, tradeLogs, 
        isPlaying, speed, currentIndex, totalSteps, baseKlines, baseInterval, fetchVirtualMarketData, fetchVirtualKlines,
        batchCloseAll
    ]);

    return <BacktestContext.Provider value={value}>{children}</BacktestContext.Provider>;
};
