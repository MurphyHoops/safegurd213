
import { Position } from '../../types';

export interface List2GroupedResult {
    tf: string;
    lag: number;
    crossingCount: number;
    isSqueeze: boolean;
    squeezeVal?: number;
    direction?: 'LONG' | 'SHORT';
    crossingLags?: number[];
    crossingTimes?: number[]; 
}

export interface List3SignalResult {
    tf: string;
    direction: 'LONG' | 'SHORT';
    structure: {
        rsi: number;
        bbw: number;
        crossCount: number;
        locationPct: number;
        thrustValid: boolean;
        timestamp: number;
        isStrictTrend: boolean;
        isColorValid: boolean; 
        lag: number;
        signalHigh?: number;
        signalLow?: number;
        signalHeight?: number;
        ema80?: number;
        signalTime?: number;
        signalPrice?: number;
        postSignalExtreme?: number;
        periodChange?: number; 
    };
}

export interface ScannerItem {
    symbol: string;
    price: number;
    volume24h?: number; 
    change8am?: number; 
    volume?: string;
    change?: number;
    isDailyRefined?: boolean;
    isNew?: boolean; 
    tf?: string;
    lag?: number;
    crossingCount?: number;
    isSqueeze?: boolean;
    squeezeVal?: number;
    emaDetails?: {
        ema10: number;
        ema20: number;
        ema30: number;
        ema40: number;
        ema80: number;
    };
    direction?: 'LONG' | 'SHORT' | 'NEUTRAL';
    candleShape?: {
        amplitude: number;
        bodyRatio: number;
        valid: boolean;
        signalPrice: number; 
    };
    breakout?: {
        triggerPrice: number;
        isBroken: boolean;
        strength: number;
    };
    structure?: {
        rsi: number;
        bbw: number;
        crossCount: number;
        locationPct: number;
        thrustValid: boolean;
        timestamp: number;
        isStrictTrend: boolean;
        isColorValid: boolean; 
        lag: number;
        signalHigh?: number;
        signalLow?: number;
        signalHeight?: number;
        ema80?: number;
        signalTime?: number; 
        signalPrice?: number; 
        postSignalExtreme?: number; 
        periodChange?: number; 
    };
    list3Results?: List3SignalResult[]; 
    momentum?: {
        midPoint: number;
        entryTrigger: number;
        purityValid: boolean;
        breakoutValid: boolean;
        reverseTrend?: boolean;
        status: 'INVALID' | 'PENDING' | 'TRIGGERED'; 
        invalidReason?: string;
    };
    smartExit?: {
        touchCount: number;
        decayRatio: number; 
        isFlat: boolean; 
        riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
    };
    groupedResults?: List2GroupedResult[];
    
    // Fuse Fields
    fuseBlocked?: boolean;
    fuseReason?: string;

    // List 4 Tracking
    enterList4Time?: number; // Timestamp when entered List 4
}

export interface List2Config {
    timeframes: string[];
    maxLag: number; 
    newModeRetention?: number; 
    volMultiplier: number;
    squeezeThreshold: number; 
    maxAmplitude: number;     
    minBodyRatio: number;
    enableFlatFilter: boolean;
    flatLookback: number;
    flatThreshold: number;
    checkEma80Conflict: boolean;
    sortMode: 'LATEST' | 'MOST';
    triggerMode: 'NEW' | 'ALL';
}

export interface List3Config {
    timeframes: string[];
    enableThrust: boolean;
    enableResonance: boolean; 
    strictTrend: boolean;
    checkCandleColor: boolean;
    lookback: number;
    minCrossCount: number;
    maxLocation: number;
    rsiLongMin: number;
    rsiLongMax: number;
    rsiShortMin: number;
    rsiShortMax: number;
    autoSimOpen: boolean;
    maxBBW: number;
    validityPeriod: number;
    sameColorCross: boolean;
    
    antiChase: {
        enabled: boolean;
        maxRise: number; 
        maxFall: number; 
    };
}

export interface List4Config {
    autoExecute: boolean; 
    midlineThreshold: number; 
    breakoutThreshold: number;
    directionFilter: 'BOTH' | 'LONG' | 'SHORT';
    enableThresholds: boolean;
    enableAntiChase: boolean;
    invalidRetentionMinutes: number; 
    antiChaseConfig: {
        maxChange24h: number;
        maxRsi: number;
        minRsi: number;
        maxDeviation: number;
        enableRev3K: boolean;
        enableStrictMAs: boolean;
    };
}

export interface ActionConfig {
    enabled: boolean;
    openAmount: number; 
    maxOpenSymbols: number;
    maxTotalValue: number;
    breakoutBuffer: number;
    autoExecute: boolean;
    maxExposurePercent: number; 
    positionSizeMode: 'FIXED' | 'VARIABLE';
    variablePercentage: number;
    variableMaxLimit: number;
}

export interface ScanConfig {
    timeBasis: '8AM' | '24H'; 
    source: 'GAINERS' | 'LOSERS' | 'BOTH'; 
    minVolume: number; 
    minChange: number;
    customSymbols: string;
    useCustomOnly: boolean;
    batchSize: number; 
    limit: number;
}

// Added currentAction to status
export type StructureScanStatus = { 
    symbols: string[]; 
    tfs: string[]; 
    current: number; 
    total: number;
    currentAction?: string;
};

export const COLUMN_WIDTH_CLASS = "min-w-[285px] w-[285px]";
