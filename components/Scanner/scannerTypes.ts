
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
    bodyRatio?: number; 
    volValid?: boolean;
    ampValid?: boolean;
    bodyValid?: boolean;
    isAligned?: boolean;
    failedVerifyCount?: number;
}

export interface List3SignalResult {
    tf: string;
    direction: 'LONG' | 'SHORT';
    latched?: boolean; // Added to keep signal alive until List 2 drops
    lastCandleTime?: number; // Track last candle time to reset intra-candle latching on new candle
    structure: {
        rsi: number;
        bbw: number;
        crossCount: number;
        locationPct: number;
        thrustValid: boolean;
        timestamp?: number;
        isStrictTrend: boolean;
        isColorValid: boolean; 
        lag: number;
        signalHigh?: number;
        signalLow?: number;
        signalHeight?: number;
        ema10?: number;
        ema20?: number;
        ema30?: number;
        ema40?: number;
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
    volume8am?: number;
    change8am?: number; 
    volume?: string;
    change?: number;
    isDailyRefined?: boolean;
    isNew?: boolean; 
    tf?: string;
    openPrice?: number;
    highPrice?: number;
    lowPrice?: number;
    lag?: number;
    crossingCount?: number;
    isSqueeze?: boolean;
    squeezeVal?: number;
    adjacentStrictTrends?: Record<string, boolean>; // For List 3 Spacetime Resonance
    emaDetails?: {
        ema10: number;
        ema20: number;
        ema30: number;
        ema40: number;
        ema80: number;
    };
    lastUpdated?: number;
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
        timestamp?: number;
        isStrictTrend: boolean;
        isColorValid: boolean; 
        lag: number;
        signalHigh?: number;
        signalLow?: number;
        signalHeight?: number;
        ema10?: number;
        ema20?: number;
        ema30?: number;
        ema40?: number;
        ema80?: number;
        signalTime?: number; 
        signalPrice?: number; 
        postSignalExtreme?: number; 
        periodChange?: number; 
        isReverse3K?: boolean;
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
    fuseDetails?: {
        period: string;
        threshold: number;
        actual: number;
    };
    fuseLatched?: boolean; // NEW: Audit Latch status

    // Smart Selection Fields
    smartScore?: number; // 0-100
    heat?: number; // 0-100
    potential?: number; // Multiplier like 2, 5, 10
    potentialReason?: string;
    whaleSignal?: 'ACCUMULATING' | 'DISTRIBUTING' | 'NEUTRAL';
    sentimentLabel?: string;

    // List 4 Tracking
    enterList4Time?: number; // Timestamp when entered List 4
    historyExtremes?: {
        highs1h?: number[];
        lows1h?: number[];
        highs1m?: number[];
        lows1m?: number[];
        scalars?: Record<string, number>; // NEW: Pre-calculated extremes for optimization
    };
    removalReason?: string;
}

export interface List2Config {
    timeframes: string[];
    newModeRetention?: number; 
    lookbackBars?: number;
    volMultiplier: number;
    squeezeThreshold: number; 
    maxAmplitude: number;     
    minBodyRatio: number;
    enableFlatFilter: boolean;
    flatLookback: number;
    flatThreshold: number;
    checkEma80Conflict: boolean;
    sortMode: 'LATEST' | 'MOST';
    requireCrossing: boolean;
    requireAlignment: boolean;
    enableDivergenceCrossCheck?: boolean; // 新增：发散前置穿越回溯开关
    divergenceLookbackBars?: number;     // 新增：发散前置穿越回溯K线根数（可自由配置）
    strictFiltering: boolean;
    viewMode?: 'ALL' | 'LONG' | 'SHORT';
    syncDirectionFilterToList3?: boolean;
}

export interface List3Config {
    timeframes: string[];
    enableAmplitudeAudit: boolean; // Renamed from enableResonance for clarity
    enableMultiResonance: boolean; // New independent toggle
    minResonanceCount: number;    // New count setting
    strictTrend: boolean;
    checkCandleColor: boolean;
    lookback: number;
    minCrossCount: number;
    maxLocation: number;
    rsiLongMin: number;
    rsiLongMax: number;
    rsiShortMin: number;
    rsiShortMax: number;
    enableRsi: boolean;
    autoSimOpen: boolean;
    maxBBW: number;
    validityPeriod: number;
    sameColorCross: boolean;
}

export interface List4Config {
    autoExecute: boolean; 
    midlineThreshold: number; 
    breakoutThreshold: number;
    directionFilter: 'BOTH' | 'LONG' | 'SHORT';
    enableThresholds: boolean;
    enableAntiChase: boolean;
    enableRev3K: boolean;
    enableThrust: boolean;
    invalidRetentionMinutes: number; 
    removeInvalidMinutes?: number; // 结构破坏后多少分钟消除 (0 = 不按分钟消除)
    removeTriggeredMinutes?: number;  // 已触发突破后多少分钟消除 (0 = 不按分钟消除)
    removeFuseMinutes?: number; // 触发防防高后多少分钟消除 (0 = 不按分钟消除)
    removeInvalidCandles?: number; // 结构破坏后多少根K线消除 (0 = 不消除)
    removeTradedCandles?: number;  // 已开仓后多少根K线消除 (0 = 不消除)
    antiChaseConfig: {
        longThresholds: { [key: string]: number };
        shortThresholds: { [key: string]: number };
    };
    enableAutoDirGuard?: boolean;
    autoDirConfig?: {
        limit1Q: number; // %
        limit1M: number; // %
        limit1W: number; // %
        limit1D: number; // %
        limit1H: number; // %
    };
    enableAdvancedFilter?: boolean;
    isAdvancedFilterCollapsed?: boolean;
    autoClearAdvancedFilterMinutes?: number;
    advancedFilterConfig?: {
        filterTimeParam: number; 
        filterKLinePeriod: '1h' | '1d' | '1w' | '1M' | '1Q';
        filterEmaPeriod: number;
        filterCrossingCount: number;
        filterLongMaxPump: number;
        filterShortMinDrop: number;
    };
    advancedFilterGroups?: AdvancedFilterGroup[];
}

export interface AdvancedFilterGroup {
    id: number;
    enabled: boolean;
    filterTimeParam: number;
    filterKLinePeriod: '1h' | '4h' | '1d' | '1w' | '1M' | '1Q';
    filterEmaPeriod: number;
    filterCrossingCount: number;
    filterLongMaxPump: number;
    filterShortMinDrop: number;
}

export interface ActionConfig {
    enabled: boolean;
    openAmount: number; 
    maxOpenSymbols: number;
    maxTotalValue: number;
    breakoutBuffer: number;
    autoExecute: boolean;
    maxExposurePercent: number; 
    minHealthPercent?: number; // 健康度限制 (低于该百分比不开仓)
    positionSizeMode: 'FIXED' | 'VARIABLE';
    variablePercentage: number;
    variableMaxLimit: number;
    
    // Global Short-Circuit Breaker for market-wide drops
    breakerConfig: {
        enabled: boolean;
        triggerMinutes: number; // 监测分钟数
        minDropPercent: number; // 触发跌幅 %
        minCoinsPercent: number; // 多少百分比币种下跌满足触发 (例如 50%)
        autoRecoverMinutes: number; // 自动锁死分钟数
    };
}

export interface SmartScanConfig {
    enabled: boolean;
    isActive: boolean; // Start switch for AI high-speed background task
    minHeat: number; 
    minPotential: number; 
    sentimentSource: ('COMMUNITY' | 'SOCIAL' | 'NEWS' | 'AI')[];
    enableWhaleTracking: boolean;
    enableOnChainAnalysis: boolean;
    alertSensitivity: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface StartTrendGroup {
    enabled: boolean;
    days?: number;
    hours?: number;
    minLong: number;
    maxLong: number;
    maxPullbackLong?: number; // 做多：当前价格距最高点最大跌幅% (正数表示，需小于该值)
    minShort: number;
    maxShort: number;
    maxPullbackShort?: number; // 做空：当前价格距最低点最大涨幅% (正数表示，需小于该值)
}

export interface MajorTrendConfig {
    enabled: boolean;
    updateIntervalHours: number; // 默认 4 小时
    intervalMinutes?: number; // 访问行情启动底池速度(分钟)，默认 4
    requestPerMinute: number; // 默认 20
    lookbackDays: number; // 默认 300
    minHistoryDrop: number; // 默认 50%
    minHistoryPump: number; // 默认 100%
    maxExtremeDistance: number; // 离极值点距离，默认 5%
    sidewaysDays: number; // Z 天前，默认 7
    sidewaysMaxPump: number; // 涨跌幅小于 A%
    sidewaysMaxDrop: number; // 跌幅小于 B%
    autoTransfer?: boolean; // 自动移入监控列表
    autoMode?: boolean; // 手动/自动读取运行开关 (true: 自动, false: 手动)
    
    // New switches
    enableLong?: boolean;   // "多"选项开关
    enableShort?: boolean;  // "空"选项开关
    enableSideways?: boolean; // "横盘蓄势"功能开关
    maxExtremeDistanceLong?: number;  // 多单最低点到当前价格涨幅低于 (设定值)%
    minExtremeDistanceLong?: number;  // 多单最低点到当前价格涨幅高于 (设定值)%
    maxExtremeDistanceShort?: number; // 空单最高点到当前价格跌幅低于 (设定值)%
    minExtremeDistanceShort?: number; // 空单最高点到当前价格跌幅高于 (设定值)%
    extremeDaysMinLong?: number;      // 多单最低点到当前天数大于等于 (设定值) 天
    extremeDaysMaxLong?: number;      // 多单最低点到当前天数小于等于 (设定值) 天
    extremeDaysMinShort?: number;     // 空单最高点到当前天数大于等于 (设定值) 天
    extremeDaysMaxShort?: number;     // 空单最高点到当前天数小于等于 (设定值) 天

    // Advanced Filters
    filterTimeParam?: number; // e.g., 300
    filterKLinePeriod?: '1h' | '1d' | '1w' | '1M';
    filterEmaPeriod?: number;
    filterCrossingCount?: number;
    filterLongMaxPump?: number;
    filterShortMinDrop?: number;

    // Market Start Trend Settings
    enableStartTrend?: boolean; // “行情启动趋势”功能开关 (总开关 / 多空通用开关)
    enableStartTrendLong?: boolean; // “行情启动趋势”做多独立开关
    enableStartTrendShort?: boolean; // “行情启动趋势”做空独立开关
    startTrendGroups?: StartTrendGroup[]; // 3组“行情启动趋势”设置
}

export interface ScanConfig {
    timeBasis: '8AM' | '24H'; 
    source: 'GAINERS' | 'LOSERS' | 'BOTH'; 
    minVolume: number;
    maxVolume: number; 
    enableVol24h?: boolean;
    enableVol8am?: boolean;
    minVolume8am?: number;
    maxVolume8am?: number;
    minChange: number;
    customSymbols: string;
    useCustomOnly: boolean;
    batchSize: number; 
    limit: number;
    scanInterval?: number;
    list1DefaultTf?: string; // Default for K-line charts in List 1
    list2Config?: List2Config;
    smartMode?: SmartScanConfig;
    majorTrend?: MajorTrendConfig;
    breakerConfig?: {
        enabled: boolean;
        triggerMinutes: number;
        minDropPercent: number;
        minCoinsPercent: number;
        autoRecoverMinutes: number;
    };
    instantOpenEnabled?: boolean; // 立即开仓开关
    instantReopenEnabled?: boolean; // 平仓后立即开仓开关
    instantOpenDirection?: 'LONG' | 'SHORT'; // 开仓方向：'LONG' (多) 或 'SHORT' (空)
}

// Added currentAction to status
export type StructureScanStatus = { 
    symbols: string[]; 
    tfs: string[]; 
    current: number; 
    total: number;
    currentAction?: string;
};

export const COLUMN_WIDTH_CLASS = "flex-1 min-w-[260px]";
