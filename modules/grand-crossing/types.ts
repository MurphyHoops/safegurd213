
import { ScannerItem, List2Config } from '../../components/Scanner/scannerTypes';

export interface RuleCheckDetail {
    name: string;
    enabled: boolean;
    status: 'PASSED' | 'FAILED' | 'SKIPPED' | 'DISABLED';
    actualValueText: string;
    targetLimitText: string;
    details?: string;
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
