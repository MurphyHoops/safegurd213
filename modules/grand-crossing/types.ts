
import { ScannerItem, List2Config } from '../../components/Scanner/scannerTypes';

export interface RuleCheckDetail {
    name: string;
    enabled: boolean;
    status: 'PASSED' | 'FAILED' | 'SKIPPED' | 'DISABLED';
    actualValueText: string;
    targetLimitText: string;
    details?: string;
}

export interface PatternOccurrenceRecord {
    barIndex: number;
    barsAgo: number;
    timestamp: number;
    timeText: string;
    isCrossing: boolean;
    divergenceType: 'BULLISH' | 'BEARISH' | 'NONE';
    patternType: 'CROSSING' | 'BULL_DIV' | 'BEAR_DIV' | 'CROSS_AND_BULL_DIV' | 'CROSS_AND_BEAR_DIV';
    open: number;
    high: number;
    low: number;
    close: number;
    ema10: number;
    ema20: number;
    ema30: number;
    ema40: number;
    ema80?: number;
    isEma80Aligned?: boolean;
    note?: string;
}

export interface TimeframeDiagnosticRecord {
    symbol: string;
    tf: string;
    fetchStatus: 'SUCCESS' | 'EMPTY' | 'FAILED' | 'WAITING';
    fetchLatencyMs: number;
    klineCount: number;
    latestPrice: number;
    kOpen: number;
    kHigh: number;
    kLow: number;
    kClose: number;
    kVolume?: number;
    kAmp?: number;
    kBodyRatio?: number;
    ema10: number;
    ema20: number;
    ema30: number;
    ema40: number;
    ema80: number;
    divergenceState: 'BULLISH' | 'BEARISH' | 'NONE';
    isCrossing: boolean;
    isPassed: boolean;
    passedDirection?: 'LONG' | 'SHORT';
    passedLag?: number;
    rejectionReason: string;
    timestamp: number;
    ruleChecks?: RuleCheckDetail[];
    // 🔍 200 根 K 线形态历史轨迹与统计记录
    crossingCount?: number;
    divergenceCount?: number;
    bullDivergenceCount?: number;
    bearDivergenceCount?: number;
    latestCrossingBarsAgo?: number;
    latestCrossingTime?: number;
    latestDivergenceBarsAgo?: number;
    latestDivergenceTime?: number;
    historyOccurrences?: PatternOccurrenceRecord[];
}

export interface GrandCrossingState {
    list2: ScannerItem[];
    status: 'IDLE' | 'SCANNING' | 'PAUSED';
    scanText: string;
    countdowns: Record<string, string>;
    tfCounts: Record<string, number>;
}

export interface GrandCrossingActions {
    updateConfig: (cfg: Partial<List2Config>) => void;
    forceScan: () => void;
}
