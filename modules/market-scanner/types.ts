
import { ScannerItem, ScanConfig } from '../../components/Scanner/scannerTypes';

export interface ScannerState {
    list1: ScannerItem[];
    isScanning: boolean;
    scanStatusText: string;
    marketStats: { up: number; down: number; total: number; btcChange: number };
    nextScanTime: number;
    lastUpdated: number;
}

export interface ScannerActions {
    refreshList1: (force?: boolean) => Promise<void>;
    updateScanConfig: (cfg: Partial<ScanConfig>) => void;
}
