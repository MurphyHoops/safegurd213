
export enum PositionSide {
    LONG = 'LONG',
    SHORT = 'SHORT'
}

export interface AccountData {
    marginBalance: number;
    totalBalance: number;
    maintenanceMargin: number;
    marginRatio: number;
}

export interface Position {
    symbol: string;
    side: PositionSide;
    amount: number;
    entryPrice: number;
    markPrice: number;
    liquidationPrice: number;
    leverage: number;
    unrealizedPnL: number;
    unrealizedPnLPercentage: number;
    entryId: string;
    entryTime: number;
    maxPnLPercent?: number;
    isHedged?: boolean;
    extremePrice?: number;
    cumulativeHedgeProfit?: number;
    cumulativeHedgeLoss?: number;
    mainPositionId?: string;
    strategyId?: string;
    signalTf?: string; // New: Store the timeframe of the signal that triggered this position
}

export interface LogEntry {
    id: string;
    timestamp: Date;
    type: 'INFO' | 'SUCCESS' | 'WARNING' | 'DANGER';
    message: string;
}

export interface TradeLog {
    symbol: string;
    entry_id: string;
    status: 'OPEN' | 'CLOSED';
    profit_usdt?: number;
    exit_reason?: string;
    signal_details?: any;
    is_hedge: boolean;
    entry_timestamp: number;
    exit_timestamp?: number;
    direction: PositionSide;
    leverage?: number;
    cost_usdt: number;
    entry_price: number;
    exit_price?: number;
    profit_percent?: number;
}

export interface SystemEvent {
    id: string;
    timestamp: number;
    type: string;
    description: string;
}

export interface HedgeRecord {
    id: string;
    timestamp: number;
    symbol: string;
    action: string;
    triggerPrice: number;
    hedgeAmount: number;
    originalPnL: number;
    detail: string;
}

export interface SimulationSettings {
    symbol?: string;
    mode?: string;
    count?: number;
    amount?: number;
    leverage?: number;
    hedge?: boolean;
    source?: string;
    timeframe?: string;
    limit?: number;
}

export interface ProfitTier {
    profit: number;
    callback: number;
    close: number;
}

export interface ConventionalSettings {
    minPosition: number;
    profitPercent: number;
    callbackPercent: number;
    closePercent: number;
}

export interface AtrSettings {
    multiplier: number;
    volatilityPercent: number;
}

export interface DynamicSettings {
    minPosition: number;
    tiers: ProfitTier[];
}

export interface SmartSettings {
    activationProfit: number;
}

export interface GlobalSettings {
    profitPercent: number;
    lossPercent: number;
    profitAmount: number;
    lossAmount: number;
}

export interface SimpleStopLossSettings {
    enabled: boolean;
    minPosition: number;
    lossPercent: number;
    closePercent: number;
}

export interface ProfitSettings {
    enabled: boolean;
    profitMode: 'CONVENTIONAL' | 'ATR' | 'DYNAMIC' | 'SMART' | 'GLOBAL';
    conventional: ConventionalSettings;
    dynamic: DynamicSettings;
    smart: SmartSettings;
    global: GlobalSettings;
    atr?: AtrSettings;
    stopLoss: SimpleStopLossSettings;
    oEnabledMap?: Record<string, boolean>;
}

export interface HedgingSettings {
    enabled: boolean;
    triggerLossPercent: number;
    triggerLossEnabled: boolean;
    hedgeRatio: number;
    minPosition: number;
    safeClearEnabled: boolean;
    safeClearProfit: number;
    safeClearLoss: number;
    oscillationCheck: boolean;
    oscillationTimeWindow: number;
    boxThreshold: number;
    touchCount: number;
    trendHedgeEnabled: boolean;
    breakKLineEnabled: boolean;
    breakKLineRatio: number;
}

export interface AdvisorSettings {
    enabled: boolean;
    autoSwitch: boolean;
    minConfidence: number;
}

export interface StopLossSettings {
    originalProfitClear: boolean;
    hedgeStopLossPercent: number;
    originalCoverPercent: number;
    hedgeProfitClear: boolean;
    hedgeOpenRatio: number;
    hedgeCoverPercent: number;
    hedgeProfitClearStopLoss: number;
    callbackProfitClear: boolean;
    callbackHedgeRatio: number;
    callbackCoverPercent: number;
    callbackTargetProfit: number;
    callbackRate: number;
    callbackStopLoss: number;
    amputationEnabled: boolean;
    amputationTriggerProfit: number;
    amputationRatio: number;
    amputationVictoryBuffer: number;
    amputationRefillRetrace: number;
    fuseEnabled: boolean;
    maxHedgeRetries: number;
    fuseFailStopPercent: number;
    advisor: AdvisorSettings;
}

export interface MartingaleSettings {
    enabled: boolean;
}

export interface SystemSettings {
    binanceApiKey?: string;
    binanceApiSecret?: string;
    directMode?: boolean;
}

export interface ScannerSettings {
    minVolume: number;
    minChange: number;
    source: 'GAINERS' | 'LOSERS' | 'BOTH';
    timeBasis: '8AM' | '24H';
    limit: number;
    customSymbols: string;
    useCustomOnly: boolean;
    batchSize: number;
}

export interface TrendHunterSettings {
    enabled: boolean;
}

export interface AppSettings {
    profit: ProfitSettings;
    hedging: HedgingSettings;
    stopLoss: StopLossSettings;
    martingale: MartingaleSettings;
    system: SystemSettings;
    scanner: ScannerSettings;
    trendHunter: TrendHunterSettings;
}

export interface LicenseInfo {
    isActive: boolean;
    expirationDate: number;
    planName: string;
}

export interface SubscriptionPlan {
    id: string;
    name: string;
    durationMonths: number;
    price: number;
    tag?: string;
    popular?: boolean;
}

export interface StrategyRecommendation {
    symbol: string;
    timestamp: number;
    currentStrategy: string;
    recommendedStrategy: string;
    confidence: number;
    reason: string;
    indicators: {
        adx: number;
        rsi: number;
        bbWidth: number;
        trend: 'UP' | 'DOWN' | 'SIDEWAYS';
    };
    actionType: 'SWITCH' | 'KEEP';
}

export const ALL_BINANCE_SYMBOLS: string[] = [
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT", 
    "TRXUSDT", "DOTUSDT", "LINKUSDT", "MATICUSDT", "LTCUSDT", "BCHUSDT", "ATOMUSDT", "UNIUSDT"
];
