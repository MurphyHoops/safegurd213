
import React, { createContext, useContext, useReducer, ReactNode, useMemo } from 'react';
import { AccountData, Position, TradeLog, LogEntry, SystemEvent } from '../types';

// --- State Atoms ---
interface MarketState {
    account: AccountData;
    positions: Position[];
    realPrices: Record<string, number>;
    tradeLogs: TradeLog[];
    systemEvents: SystemEvent[];
    logs: LogEntry[];
    isSimulating: boolean;
}

// --- Action Atoms ---
type MarketAction = 
    | { type: 'UPDATE_DATA'; payload: Partial<MarketState> }
    | { type: 'UPDATE_PRICES'; payload: Record<string, number> }
    | { type: 'TOGGLE_SIMULATION' };

const initialState: MarketState = {
    account: { marginBalance: 0, totalBalance: 0, maintenanceMargin: 0, marginRatio: 999 },
    positions: [],
    realPrices: {},
    tradeLogs: [],
    systemEvents: [],
    logs: [],
    isSimulating: false
};

const MarketContext = createContext<{
    state: MarketState;
    dispatch: React.Dispatch<MarketAction>;
} | null>(null);

const marketReducer = (state: MarketState, action: MarketAction): MarketState => {
    switch (action.type) {
        case 'UPDATE_DATA':
            return { ...state, ...action.payload };
        case 'UPDATE_PRICES':
            return { ...state, realPrices: { ...state.realPrices, ...action.payload } };
        case 'TOGGLE_SIMULATION':
            return { ...state, isSimulating: !state.isSimulating };
        default:
            return state;
    }
};

export const MarketProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [state, dispatch] = useReducer(marketReducer, initialState);
    
    const value = useMemo(() => ({ state, dispatch }), [state]);

    return (
        <MarketContext.Provider value={value}>
            {children}
        </MarketContext.Provider>
    );
};

export const useMarket = () => {
    const context = useContext(MarketContext);
    if (!context) {
        throw new Error('useMarket must be used within a MarketProvider');
    }
    return context;
};
