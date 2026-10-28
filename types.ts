
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
    binanceRealBalance?: number;
    unrealizedPnL?: number;
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
    initialAmount?: number;
    amputationTriggered?: boolean;
    maxPnLAfterAmputationTrigger?: number;
    maxPnLPercentAfterAmputationTrigger?: number;
    lastLoggedPeakPercent?: number;
    maxPnLPercent?: number;
    isHedged?: boolean;
    isHedge?: boolean;
    lastHedgeClosedAt?: number;
    hedgeSignalTriggered?: boolean;
    hedgeOrderInFlight?: boolean;
    hedgeOrderInFlightTime?: number;
    extremePrice?: number;
    cumulativeHedgeProfit?: number;
    cumulativeHedgeLoss?: number;
    isAmputated?: boolean;
    amputatedAmount?: number;
    cumulativeAmputationLoss?: number;
    cumulativeAmputationProfit?: number;
    amputationCount?: number;
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
    ema10Cross20Price?: number; // 4. EMA10破EMA20 基准防线价格
    currentEmaValue?: number;
    triggerReason?: string;
    isBacktestRecord?: boolean;
    periodExtremePrice?: number;
    extremeHedgeTriggerPrice?: number;
    backtestEntryTime?: number;
    currentIndicators?: {
        rsi: number;
        volatility: number;
        deviation: number;
        emaDistance: number;
        volumeSwell: number;
    };
    recentCandles?: KLine[];
    recentAvgAmplitude?: number;
    customProfitSettings?: ProfitSettings;
    isUnshackled?: boolean;
    isReopened?: boolean;
    reopenCount?: number;
    correlationId?: number; // Added: Correlation ID for hedge pairing
    parentEntryId?: string;
    isManual?: boolean;
    isPendingSync?: boolean;
    isAmputatedToZero?: boolean;
    isBeingClosed?: boolean;
    isClosing?: boolean; // 🔒 在途平仓状态锁 (向币安发出平仓请求中，尚未收到最终成交确认)
    isOrphanHedge?: boolean; // 🛡️ 孤儿对冲单标记 (主仓已平仓但对冲仓位意外残留)
    lastAmputationTime?: number;
    lastRefillTime?: number;
    leverage?: number; // Added: Locked leverage for position and matching hedge
    cost_usdt?: number;
    refillCount?: number; // 震荡磨损补仓累计次数
    isOscillationLocked?: boolean; // 震荡熔断锁定状态
    amputationEntryPrice?: number; // 砍仓时的基准入场均价（用于回踩补仓精确判定）
    originalEntryPrice?: number; // 原始开仓基准价格
    chainId?: string; // 🔗 主从对冲关联合约链编号 (Lifecycle Chain ID)
    dcaCount?: number; // 智能补仓已执行次数
    lastDcaAt?: number; // 上次智能补仓时间戳
    lastDcaPrice?: number; // 上次智能补仓成交价格点 (用于连续阶梯追补)
    initialAmountUsdt?: number; // 初始开仓金额(USDT)
    initialEntryPrice?: number; // 初始开仓基准价
    dcaExtremePrice?: number; // 📉 智能补仓专用的极值追踪（用于计算回调/反弹确认）
    dcaExtremeTime?: number; // ⏰ 智能补仓极值价格发生的时间戳 (精确到毫秒)
    lastDcaExtremePrice?: number; // 🔒 上次补仓生效时的历史极点 (用于二次/多次补仓核验 D < B 突破规则)
    dcaRecords?: DcaRecord[]; // 📜 智能补仓历史记录与信号详情
}

export interface DcaRecord {
    id: string;
    timestamp: number;
    count: number; // 第几次补仓 (1, 2, 3...)
    triggerMode: string;
    triggerModeLabel: string; // 补仓触发模式简称
    reason: string; // 补仓触发总结
    signalDetail: string; // 补仓触发物理信号明细
    addAmountUsdt: number; // 本次补仓金额 USDT
    price: number; // 补仓成交价格
    executionTimeStr?: string; // 补仓成交时间 (精确到秒, HH:mm:ss)
    oldEntryPrice: number; // 补仓前持仓均价
    newEntryPrice: number; // 补仓后新持仓均价
    oldAmountTokens?: number;
    newAmountTokens?: number;
    preRefillPnLPct?: number; // 补仓前亏损值 % (如 -3.50%)
    preRefillPnLUsdt?: number; // 补仓前亏损金额 USDT (如 -15.20 U)
    extremePrice?: number; // 触底/触顶极值价格 (最低价/最高价)
    extremeTimeStr?: string; // 极值发生时间 (精确到秒, HH:mm:ss)
    pullbackPct?: number; // 从极值的回调/反弹值 % (如 +0.55%)
    postRefillPnLPct?: number; // 补仓后新持仓亏损值 % (如 -1.82%)
    postRefillPnLUsdt?: number; // 补仓后新持仓亏损金额 USDT (如 -15.20 U)
}

export type LogCategory = 'ALL' | 'AUTO' | 'MANUAL' | 'HEDGE' | 'PNL' | 'ERROR';

export interface LogEntry {
    id: string;
    timestamp: Date;
    type: 'INFO' | 'SUCCESS' | 'WARNING' | 'DANGER';
    message: string;
    category?: LogCategory;
    chainId?: string;
    latencyInfo?: {
        signalLatencyMs?: number;
        networkLatencyMs?: number;
        totalLatencyMs?: number;
        slippagePercent?: number;
    };
    pnlBreakdown?: {
        grossPnl?: number;
        commission?: number;
        fundingFee?: number;
        netPnl?: number;
    };
    exposureInfo?: {
        symbol?: string;
        longAmount?: number;
        shortAmount?: number;
        netAmount?: number;
        netDirection?: 'NET_LONG' | 'NET_SHORT' | 'NEUTRAL';
        exposurePercent?: number;
    };
}

export interface TradeEvent {
    timestamp: number;
    action: string;
    price: number;
    amount: number;
    reason: string;
    pnl?: number;
    preRefillPnLPct?: number;
    preRefillPnLUsdt?: number;
    extremePrice?: number;
    extremeTimeStr?: string;
    executionTimeStr?: string;
    pullbackPct?: number;
    targetCallbackPercent?: number;
    callbackPercent?: number;
    postRefillPnLPct?: number;
    postRefillPnLUsdt?: number;
    newEntryPrice?: number;
}

export interface TradeLog {
    symbol: string;
    entry_id: string;
    status: 'OPEN' | 'CLOSED' | 'CLOSED_OPEN';
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
    correlationId?: number; // Added: Correlation ID for hedge pairing
    reopenCount?: number; // Added: Reopen count
    is_reopened?: boolean; // Added: is reopened position
    timeframe?: string; // Added timeframe field
    last_stop_loss_time?: number; // Added last stop loss time
    stop_loss_rule?: string; // Added stop loss rule
    binance_order_id?: string; // Binance Official Trade/Order ID for reconciliation
    commission?: number; // Binance Trading Fee
    events?: TradeEvent[]; // Collection of all actions during the trade lifecycle
    dcaRecords?: DcaRecord[]; // 📜 智能补仓历史明细与信号依据
    cycle_sealed?: boolean; // 🔒 周期已封存标记：解套盈利清仓或盈利平仓后设为 true，严禁与新一轮开仓负债关联
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

export interface TrailingTier {
    threshold: number;
    floor: number;
}

export interface VariableTrailingTier {
    minProfit: number; // 阶梯起始盈利%
    maxProfit: number; // 阶梯截止盈利%
    retentionPercent: number; // 达到该区间时按最高盈利保留的百分比%
}

export interface ConventionalSettings {
    minPosition: number;
    profitPercent: number;
    callbackPercent: number;
    closePercent: number;
    trailingEnabled?: boolean;
    trailingTriggerProfit?: number; // 变量托底激活起征点盈利 (%)
    trailingRemainingProfit?: number;
    trailingTiers?: TrailingTier[];
    variableTrailingTiers?: VariableTrailingTier[]; // 多级变量托底阶梯
}

export interface AtrSettings {
    multiplier: number;
    volatilityPercent: number;
    chandelierEnabled: boolean;
    emaEnabled: boolean;
    emaPeriod: number;
    emaTimeframe: string;
    stallExitEnabled?: boolean;
    stallMode?: 'CANDLE' | 'TIME';
    stallCandleCount?: number;
    stallTimeframeMinutes?: number;
    stallTargetProfitPercent?: number;
    stallSafeLowerPercent?: number;
    stallSafeUpperPercent?: number;
    stallAdaptiveVolatilityEnabled?: boolean;
    stallAdaptiveMultiplier?: number;
}

export interface SmartProfitTier {
    threshold: number;
    callback: number;
    expiry: number;
}

export interface SmartSettings {
    enabled?: boolean;
    decayEnabled?: boolean;
    minPosition: number;
    activationProfit: number;
    conventionalEnabled: boolean;
    tiers: SmartProfitTier[];
    stepBasedLockEnabled?: boolean;
    steps?: ProfitStep[];
}

export interface GlobalSettings {
    profitPercent: number;
    lossPercent: number;
    profitAmount: number;
    lossAmount: number;
    conventionalEnabled?: boolean;
    tiers?: SmartProfitTier[];
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
    ema10Cross20BreakEnabled?: boolean; // 4. EMA10破EMA20
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
    autoOpenAfterHedgeProfit?: boolean;
    autoOpenPullbackPercent?: number;
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
    amputationReopenEnabled: boolean;
    maxReopenCount?: number; // Added: Max re-open count
    amputationHedgeOnlyExit?: boolean; // 新增：只清对冲、主仓续航
    fuseEnabled: boolean;
    maxHedgeRetries: number;
    fuseActionMode?: 'MANUAL' | 'AUTO_CLOSE'; // 熔断处置模式：人工处理 或 自动清仓
    fuseAlertEnabled?: boolean; // 语音提醒与弹窗
    fuseFailStopPercent: number;
    advisor: AdvisorSettings;
}

export interface MartingaleSettings {
    enabled: boolean;
    // 1. 补仓触发模式
    triggerMode?: 'LOSS_PCT' | 'EMA_CROSS' | 'DIVERGENCE' | 'MIXED_OR' | 'MIXED_AND';
    triggerLossPercent?: number; // 亏损值达到 % (如 2.0%)
    emaPeriod?: number; // 趋势补仓与均线相交周期 (20, 30, 40, 80)
    callbackPercent?: number; // 回调/反弹确认 % (如 0.3%)
    enableStepDca?: boolean; // 连续阶梯反弹追补开关 (深跌/深涨沿途无新低时，从上次补仓价再反弹达标追加补仓)
    enableFallingKnifeGuard?: boolean; // 防接飞刀极值确认开关 (开启时需低点反弹确认，关闭时只要满足亏损与回调门槛立即补仓)

    // 2. 数量与额度限制
    baseRef?: 'INITIAL_QTY' | 'TOTAL_QTY'; // 补仓参考: 原开仓数量 / 合计持仓数量
    ratioPercent?: number; // 补仓比例 % (如 100%)
    maxCount?: number; // 补仓次数限制 (如 1次, 2次)
    maxTotalUsdt?: number; // 持仓总数量限制 USDT (如 500 USDT)
    maxPositionToBalancePercent?: number; // 当前持仓总量占可用余额%上限 (如 80%)，超出停止补仓

    // 3. 风控护城河
    cooldownSeconds?: number; // 补仓最小时间间隔(秒, 如 30秒)
    hedgeSafeDistancePercent?: number; // 离防爆对冲线最小安全距离 % (如 1.0%)
    circuitBreakerVolPercent?: number; // 极端大阴/大阳波幅熔断 % (如 3.0%)

    // 4. 出局与联动
    breakevenTakeProfitPercent?: number; // 补仓后新均价微利解套止盈 % (如 0.5%)
    dynamicHedgeShiftEnabled?: boolean; // 补仓后按新均价重算防爆对冲点

    // 5. 最亏优先与全盘配额风控限制
    maxAddingCoinsCount?: number; // 允许同时补仓的最大币种数 (0 表示不限制, 如 5 表示全盘最多同时 5 个币补仓)
    addPriorityMetric?: 'pnl_usdt' | 'pnl_percent'; // 补仓优先竞逐标准: 'pnl_usdt' (浮亏金额最大优先) | 'pnl_percent' (真实跌幅比例最大优先)
}

export interface SystemSettings {
    binanceApiKey?: string;
    binanceApiSecret?: string;
    directMode?: boolean;
    realTrading?: boolean;
    symbolBlacklist?: string[];
    voiceBroadcast?: boolean;
    enableAutoTransfer?: boolean;
    autoTransferThreshold?: number;
    autoTransferAmount?: number;
    autoSyncEnabled?: boolean;
    autoSyncIntervalMinutes?: number;
    syncHistoryLookbackHours?: number;
    defaultLeverage?: number;
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
    scanInterval: number;
}

export interface TrendHunterSettings {
    enabled: boolean;
}

export interface StrategyItem {
    id: string;
    name: string;
    active: boolean;
    unconfigured?: boolean;
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
