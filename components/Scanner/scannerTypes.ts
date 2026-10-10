
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
    isClosed?: boolean; // 是否为已收盘K线
    isPendingGray?: boolean; // 正在走动的实时K线是否因价格不符变为灰色待定态
    isWaitDivergencePending?: boolean; // 先穿越后等待发散模式下：当前处于等待发散蓄势状态
    waitElapsedBars?: number; // 已等待K线根数
    waitTotalBars?: number; // 最大等待K线根数
    kOpen?: number; // 信号K线开盘价
    kClose?: number; // 信号K线收盘价/当前价
    kHigh?: number; // 信号K线最高价
    kLow?: number; // 信号K线最低价
    signalTime?: number; // 信号K线时间戳
}

export interface List3SignalResult {
    tf: string;
    direction: 'LONG' | 'SHORT';
    latched?: boolean; // Added to keep signal alive until List 2 drops
    removalReason?: string;
    lastCandleTime?: number; // Track last candle time to reset intra-candle latching on new candle
    structure: {
        rsi: number;
        bbw: number;
        crossCount: number;
        locationPct: number;
        thrustValid: boolean;
        maxThrust?: number;
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
        postSignalMaxHigh?: number;
        postSignalMinLow?: number;
        periodChange?: number; 
        isReverse3K?: boolean;
        isBreakout3K?: boolean;
        maxClose3?: number;
        minClose3?: number;
        recentCloses?: number[];
    };
}

export interface ScannerItem {
    symbol: string;
    price: number;
    volume24h?: number; 
    volume8am?: number;
    change8am?: number; 
    volume?: string;
    quoteVolume?: string | number;
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
        maxThrust?: number;
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
        postSignalMaxHigh?: number;
        postSignalMinLow?: number;
        periodChange?: number; 
        isReverse3K?: boolean;
        isBreakout3K?: boolean;
        maxClose3?: number;
        minClose3?: number;
        recentCloses?: number[];
    };
    list3Results?: List3SignalResult[]; 
    momentum?: {
        midPoint: number;
        entryTrigger: number;
        purityValid: boolean;
        breakoutValid: boolean;
        reverseTrend?: boolean;
        status: 'INVALID' | 'PENDING' | 'TRIGGERED' | 'DORMANT' | 'REVIVED'; 
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
        ruleName?: string;
        paramName?: string;
        period?: string;
        threshold: number | string;
        actual: number | string;
        diff?: number | string;
        unit?: string;
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
    isTraded?: boolean;
    tradedAt?: number;
    tradedTotalMs?: number;
    tradedCountdownMs?: number;
    fuseEnteredAt?: number;
    fuseTotalMs?: number;
    fuseCountdownMs?: number;
}

export interface List2Config {
    timeframes: string[];
    newModeRetention?: number; 
    lookbackBars?: number;
    lookbackLimit?: number;
    volMultiplier: number;
    squeezeThreshold: number; 
    maxAmplitude: number;     
    minBodyRatio: number;
    enableFlatFilter: boolean;
    flatLookback: number;
    flatThreshold: number;
    checkEma80Conflict: boolean;
    sortMode: 'LATEST' | 'MOST' | 'TIMEFRAME';
    tfSortOrder?: 'asc' | 'desc';
    requireCrossing: boolean;
    requireAlignment: boolean;
    crossingDivergenceLogic?: 'AND' | 'OR' | 'WAIT';
    waitDivergenceBars?: number;          // 新增：先穿越等待发散K线根数（可自由配置，默认5根）
    enableDivergenceCrossCheck?: boolean; // 新增：发散前置穿越回溯开关
    divergenceLookbackBars?: number;     // 新增：发散前置穿越回溯K线根数（可自由配置）
    enableSignalDeviationFilter?: boolean; // 新增：信号K线振幅偏离限制开关
    maxSignalDeviationPercent?: number;    // 新增：允许偏离信号K线振幅的百分比（%）
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
    maxBreakoutDeviation?: number; // 进攻突破偏离上限阈值 % (默认 0.5%)
    directionFilter: 'BOTH' | 'LONG' | 'SHORT';
    enableThresholds: boolean;
    enableAntiChase: boolean;
    enableRev3K: boolean;
    rev3KCandles?: number; // 前 N 根 K 线突破检测根数 (默认 3，可设 1~50)
    enableThrust: boolean;
    thrustThreshold?: number; // 5K 爆发推进振幅阈值 % (默认 1.0%)
    invalidRetentionMinutes: number; 
    removeInvalidMinutes?: number; // 结构破坏后多少分钟消除 (0 = 不按分钟消除)
    removeTriggeredMinutes?: number;  // 已触发突破后多少分钟消除 (0 = 不按分钟消除)
    removeFuseMinutes?: number; // 触发防防高后多少分钟消除 (0 = 不按分钟消除)
    removeInvalidCandles?: number; // 结构破坏后多少根K线消除 (0 = 不消除)
    removeTradedCandles?: number;  // 已开仓后多少根K线消除 (0 = 不消除)
    dormantRetentionCandles?: number; // 破中轴休眠期最大保留K线根数 (默认20根)
    antiChaseConfig: {
        longThresholds: { [key: string]: number };
        shortThresholds: { [key: string]: number };
    };
    enableAutoDirGuard?: boolean;
    autoDirConfig?: {
        limit1Q?: number; // %
        limit1M?: number; // %
        limit1W?: number; // %
        limit1D?: number; // %
        limit1H?: number; // %
        longLimits?: { [key: string]: number };
        shortLimits?: { [key: string]: number };
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
    leverage?: number; // 杠杆倍数 (如: 2, 5, 10, 20)
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

export interface SidewaysRuleGroup {
    id?: string;
    enabled?: boolean;
    days: number;      // 观察周期 (Z天)
    maxDrop: number;   // 跌幅上限 (X%)
    maxPump: number;   // 涨幅上限 (Y%)
    daysLong?: number;     // 做多观察周期
    maxDropLong?: number;  // 做多跌幅上限
    maxPumpLong?: number;  // 做多涨幅上限
    daysShort?: number;    // 做空观察周期
    maxDropShort?: number; // 做空跌幅上限
    maxPumpShort?: number; // 做空涨幅上限
}

export interface MajorTrendConfig {
    enabled: boolean;
    updateIntervalHours: number; // 默认 4 小时
    intervalMinutes?: number; // 兼容旧字段
    intervalSeconds?: number; // 单币扫描间隔时间(秒)，默认 3 秒
    requestPerMinute: number; // 默认 20
    lookbackDays: number; // 默认 300
    minHistoryDrop: number; // 默认 50%
    minHistoryPump: number; // 默认 100%
    maxExtremeDistance: number; // 离极值点距离，默认 5%
    sidewaysDays: number; // Z 天前，默认 7 (兼容单组旧字段)
    sidewaysMaxPump: number; // 涨跌幅小于 A% (兼容单组旧字段)
    sidewaysMaxDrop: number; // 跌幅小于 B% (兼容单组旧字段)
    sidewaysLogic?: 'OR' | 'AND'; // 多组横盘过滤组合逻辑：'OR'(满足任意一组) | 'AND'(同时满足全部)，默认 'OR'
    sidewaysGroups?: SidewaysRuleGroup[]; // 多组“横盘蓄势过滤”设置
    autoTransfer?: boolean; // 自动移入监控列表
    autoMode?: boolean; // 手动/自动读取运行开关 (true: 自动, false: 手动)
    
    // Direction and Sync switches
    enableLong?: boolean;   // "回溯周期过滤 - 多"选项开关
    enableShort?: boolean;  // "回溯周期过滤 - 空"选项开关
    enableSideways?: boolean; // "横盘蓄势"功能总开关
    enableSidewaysLong?: boolean; // "横盘蓄势 - 多"选项开关
    enableSidewaysShort?: boolean; // "横盘蓄势 - 空"选项开关
    enableLookbackFilter?: boolean; // "回溯周期过滤"功能总开关
    syncDirectionLock?: boolean; // 列表1三大过滤（启动趋势、横盘蓄势、回溯周期）智能多空联动同步开关 (默认 true)
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

    // 🚀 趋势爆发综合过滤 (Breakout Filter Config)
    breakoutFilter?: BreakoutFilterConfig;
}

export interface BreakoutFilterConfig {
    enabled: boolean; // 趋势爆发综合过滤总开关
    combinationMode?: 'OR' | 'AND'; // 组合判定模式: 'OR' (满足任一开启规则即放行) | 'AND' (必须全部满足)，默认 'OR'
    scanDelayMs?: number; // 扫描步进节奏延时(毫秒)，例如 1000 代表 1秒1币 (防止超频并平稳展示)
    
    // 1. 空间极致蓄势 (Squeeze 波动率压缩)
    enableSqueeze: boolean; // 空间蓄势子开关
    maxBbwPercent: number; // 布林带带宽 (BBW %) 上限阈值，默认 3.0%
    requireSqueezeInKc: boolean; // 是否要求 BB 收缩进 KC 通道内部 (Squeeze ON)，默认 true
    squeezeBars: number; // 压缩K线根数 (默认 20)

    // 2. 突破点火放量 (Volume & Breakout - 融入连续放量与实体真突破防伪)
    enableVolumeSpike: boolean; // 突破点火子开关
    volMultiplier: number; // 爆量倍数 (Vol / MA_Vol_20)，默认 2.0x
    breakoutMode: 'BB_BANDS' | 'EXTREME_K'; // 突破判定方式: 破布林带上下轨 / 破近N根极值
    breakoutBars?: number; // 突破极值回溯K线根数 (默认 20)
    breakoutDirection?: 'BOTH' | 'LONG' | 'SHORT'; // 突破方向过滤 (默认 'BOTH')
    
    // 🐉【龙抬头防伪进阶】连续放量与实体饱满度
    consecutiveVolBars?: number; // 连续放量K线根数 (默认 1 根为单K爆量，设为 2~3 则为连续放量梯级推进)
    requireConsecutiveVolRise?: boolean; // 是否要求连续几根成交额逐根递增 (默认 false)
    minSolidBodyRatio?: number; // K线实体饱满度下限 % (实体长 / 整根K线高，默认 50%，过滤假拉量诱多长上影/长下影)
    maxDistancePctFromLow?: number; // 距离阶段极值最大距离 % (默认 25%，防追高/抄底锁定)

    // 3. 动能爆发与多周期共振 (ADX & Multi-TF)
    enableAdx: boolean; // ADX 动能子开关
    minAdx: number; // ADX(14) 阈值，默认 22
    requireAdxRising: boolean; // 是否要求 ADX 向上拐头拉升，默认 true

    enableMultiTfResonance: boolean; // 多周期发散共振子开关
    primaryTf: '1m' | '3m' | '5m' | '15m'; // 主触发周期，默认 5m
    confirmTf: '15m' | '30m' | '1h'; // 高级确认周期，默认 15m
    resonanceMode: 'TWO_TF' | 'THREE_TF'; // 双周期同向 / 三周期同向，默认 'TWO_TF'
}

export interface DragonHeadFilterConfig {
    enabled: boolean;                      // 龙抬头资金异动过滤总开关
    direction: 'LONG' | 'SHORT' | 'BOTH';  // 监测方向 (默认 LONG 做多龙抬头)
    timeframe: '15m' | '1h' | '4h' | '1d'; // 监测K线周期 (默认 '1d' 日K级别，也可选 1h/4h/15m)
    scanDelayMs?: number;                  // 扫描节拍延迟毫秒 (默认 800ms)
    
    // 1. 静默蓄势底池 (Base Calm Period)
    baseLookbackBars: number;              // 静默期回溯K线根数 (默认 14 根，如前14天地量潜伏)
    maxBaseAmplitude: number;              // 静默期最大振幅或涨幅限制 % (默认 25%，确保平时安静稳定无异常暴涨)
    
    // 2. 资金异动连续放量 (Continuous Volume Inflow)
    consecutiveBars: number;               // 连续放量K线根数 (默认 3 根，即最近连续3根K线成交额递增)
    minVolumeMultiplier: number;           // 放量倍数 (当前/最近成交额相比静默期均量的倍数，默认 2.0x)
    requireConsecutiveRise: boolean;       // 是否要求交易额逐根连续递增 (默认 true)
    
    // 3. 价格启动窗口 (Price Action Initiation - 防追高/抄底起爆)
    isBottomFishingMode: boolean;          // 是否启用底部反转/抄底保护模式 (默认 true)
    minPriceChangePct: number;             // 启动最小涨幅 % (默认 2.0%)
    maxPriceChangePct: number;             // 启动最大涨幅 % (默认 25.0%，防追高)
    maxDistancePctFromLow?: number;        // 距离阶段低点最大距离 % (默认 15.0%，用于抄底锁定)
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
    breakoutFilter?: BreakoutFilterConfig;
    dragonHeadFilter?: DragonHeadFilterConfig;
    enableAlphabeticalFilter?: boolean; // 币安排序 A~Z 分片开关
    alphabeticalRangeStart?: number;    // 起始币种序号 (如 1)
    alphabeticalRangeEnd?: number;      // 结束币种序号 (如 70)
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
    list2PushConfig?: {
        enabled: boolean; // 是否启用定向推送至列表2 (若关闭则全部初筛币进入列表2)
        mode: 'OR' | 'AND'; // 复合条件模式: 'OR' (满足任意一项) | 'AND' (必须全部满足)
        // 条件1: 24H 涨跌幅绝对值 >= X%
        enableChg24h: boolean;
        minChg24h: number;
        // 条件2: 8AM 涨跌幅绝对值 >= X%
        enableChg8am: boolean;
        minChg8am: number;
        // 条件3: 24H 交易额 >= X M
        enableVol24h: boolean;
        minVol24h: number;
        // 条件4: 8AM 交易额 >= X M
        enableVol8am: boolean;
        minVol8am: number;
        // 头部 Top N 排序截取
        enableTopN: boolean;
        topNCount: number;
        topNSortKey: 'CHG_24H_ABS' | 'CHG_8AM_ABS' | 'VOL_24H' | 'VOL_8AM' | 'CHG_24H_DESC' | 'CHG_24H_ASC' | 'CHG_8AM_DESC' | 'CHG_8AM_ASC';
    };
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
