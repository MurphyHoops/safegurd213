
import { ScannerItem, List2Config } from '../../components/Scanner/scannerTypes';

export interface TimeframeDiagnosticRecord {
    symbol: string;
    tf: string;
    fetchStatus: 'SUCCESS' | 'EMPTY' | 'FAILED';
    fetchLatencyMs: number;
    klineCount: number;
    latestPrice: number;
    kOpen: number;
    kHigh: number;
    kLow: number;
    kClose: number;
    ema10: number;
    ema20: number;
    ema30: number;
    ema40: number;
    ema80: number;
    divergenceState: 'BULLISH' | 'BEARISH' | 'NONE';
    isCrossing: boolean;
    isPassed: boolean;
    rejectionReason: string;
    timestamp: number;
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
