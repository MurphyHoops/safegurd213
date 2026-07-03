
export interface KLine {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

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
    unrealizedPnL: number;
    unrealizedPnLPercentage: number;
    entryId: string;
    entryTime: number;
    amputationTriggered?: boolean;
    maxPnLAfterAmputationTrigger?: number;
    maxPnLPercentAfterAmputationTrigger?: number;
    maxPnLPercent?: number;
    isHedged?: boolean;
    extremePrice?: number;
    cumulativeHedgeProfit?: number;
    cumulativeHedgeLoss?: number;
    amputatedAmount?: number;
    cumulativeAmputationLoss?: number;
    hedgeRetries?: number;
    mainPositionId?: string;
    strategyId?: string;
    signalTf?: string;
    signalCandle?: {
        high: number;
        low: number;
        close: number;
        open: number;
        amplitude: number; // (High - Low) / Low
    };
    entryEmas?: {
        ema10: number;
        ema20: number;
        ema40: number;
        ema80: number;
    };
    currentEmaValue?: number;
    triggerReason?: string;
    isBacktestRecord?: boolean;
    backtestEntryTime?: number;
    currentIndicators?: {
        rsi: number;
        volatility: number;
        deviation: number;
        emaDistance: number;
        volumeSwell: number;
    };
    customProfitSettings?: ProfitSettings;
}

export interface LogEntry {
    id: string;
    timestamp: Date;
    type: 'INFO' | 'SUCCESS' | 'WARNING' | 'DANGER';
    message: string;
}

export interface TradeEvent {
    timestamp: number;
    action: string;
    price: number;
    amount: number;
    reason: string;
    pnl?: number;
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
    cost_usdt: number;
    entry_price: number;
    exit_price?: number;
    profit_percent?: number;
    current_amount?: number; // Added to track position amount after partial close/refill
    main_entry_id?: string; // Links a hedge to its main position
    parent_entry_id?: string; // Links a partial close/refill to its original position
    timeframe?: string; // Added timeframe field
    last_stop_loss_time?: number; // Added last stop loss time
    stop_loss_rule?: string; // Added stop loss rule
    events?: TradeEvent[]; // Collection of all actions during the trade lifecycle
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

export interface ConventionalSettings {
    minPosition: number;
    profitPercent: number;
    callbackPercent: number;
    closePercent: number;
}

export interface AtrSettings {
    multiplier: number;
    volatilityPercent: number;
    chandelierEnabled: boolean;
    emaEnabled: boolean;
    emaPeriod: number;
    emaTimeframe: string;
}

export interface SmartProfitTier {
    threshold: number;
    callback: number;
    expiry: number;
}

export interface SmartSettings {
    minPosition: number;
    activationProfit: number;
    conventionalEnabled: boolean;
    tiers: SmartProfitTier[];
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

export interface ProfitStep {
    threshold: number; // The "失效值" (e.g., 5%, 4%, 2%)
    profitPercent: number; // Profit to lock at this step
    callbackPercent: number; // Callback to trigger at this step
}

export interface AiProfitSettings {
    sensitivity: number; // 1-10
    aggressiveness: number; // 1-10
    minPosition: number;
    activationProfit: number;
    aiSmartModeEnabled?: boolean;
    activationProfitPercent?: number;
    fallbackProfitPercent?: number;
    atrMultiplier?: number;
    momentumWeight?: number;
    volResonance?: number;
    steps?: ProfitStep[];
    stepBasedLockEnabled?: boolean;
}

export interface ProfitSettings {
    enabled: boolean;
    profitMode: 'CONVENTIONAL' | 'ATR' | 'SMART' | 'GLOBAL' | 'AI';
    conventional: ConventionalSettings;
    smart: SmartSettings;
    global: GlobalSettings;
    atr?: AtrSettings;
    ai?: AiProfitSettings;
    stopLoss: SimpleStopLossSettings;
    oEnabledMap?: Record<string, boolean>;
    aiSmartMasterEnabled?: boolean;
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
    trendHedgeEmaPeriod: number; // New: EMA Period (80, 40, 20, 10)
    breakKLineEnabled: boolean;
    breakKLineRatio: number;
    combinedLossLimitEnabled?: boolean;
    combinedLossLimitPercent?: number;
}

export interface AdvisorSettings {
    enabled: boolean;
    autoSwitch: boolean;
    minConfidence: number;
}

export interface StopLossSettings {
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
    amputationBreathingSpace: number;
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
    maxVolume?: number;
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

export interface TradeDNA {
    id: string;
    symbol: string;
    side: PositionSide;
    entryTime: number;
    exitTime: number;
    entryPrice: number;
    exitPrice: number;
    profitUsdt: number;
    profitPercent: number;
    exitReason: string;
    indicators: {
        rsi: number;
        volatility: number;
        deviation: number; // 乖离率
        emaDistance: number;
        volumeSwell: number; // 成交量激增倍数
    };
    aiSettings: AiProfitSettings;
}

export const ALL_BINANCE_SYMBOLS: string[] = [
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT", 
    "TRXUSDT", "DOTUSDT", "LINKUSDT", "MATICUSDT", "LTCUSDT", "BCHUSDT", "ATOMUSDT", "UNIUSDT"
];
