
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
    
    // Virtual API
    fetchVirtualMarketData: () => Promise<any[]>;
    fetchVirtualKlines: (symbol: string, interval: string, limit: number) => Promise<KLine[]>;
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
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [tradeLogs, setTradeLogs] = useState<TradeLog[]>([]);
    const [realPrices, setRealPrices] = useState<Record<string, number>>({});

    const symbols = useMemo(() => Object.keys(klinesMap), [klinesMap]);
    const baseInterval = useMemo(() => {
        if (symbols.length === 0) return '1m';
        const intervals = Object.keys(klinesMap[symbols[0]]);
        return intervals.length > 0 ? intervals.sort()[0] : '1m';
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
            if (klines && klines[currentIndex]) {
                newPrices[symbol] = klines[currentIndex].close;
            }
        });
        setRealPrices(newPrices);
    }, [currentIndex, symbols, klinesMap, baseInterval]);

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
        fetchVirtualMarketData,
        fetchVirtualKlines
    }), [
        virtualTime, realPrices, klinesMap, account, positions, logs, tradeLogs, 
        isPlaying, speed, currentIndex, totalSteps, fetchVirtualMarketData, fetchVirtualKlines
    ]);

    return <BacktestContext.Provider value={value}>{children}</BacktestContext.Provider>;
};
