
import { ScannerItem, List2Config } from '../../components/Scanner/scannerTypes';

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
