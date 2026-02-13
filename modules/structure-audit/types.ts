
import { ScannerItem, List3Config } from '../../components/Scanner/scannerTypes';

export interface StructureAuditState {
    list3: ScannerItem[];
    isScanning: boolean;
    scanStatus: { symbols: string[], tfs: string[], current: number, total: number } | null;
}

export interface StructureAuditActions {
    updateConfig: (cfg: Partial<List3Config>) => void;
}
