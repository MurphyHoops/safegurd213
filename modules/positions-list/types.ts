
import { Position, PositionSide, AppSettings } from '../../types';

export interface PositionsListProps {
    positions: Position[];
    realPrices: Record<string, number>;
    walletBalance: number;
    settings: AppSettings;
    onRowLongPress: () => void;
    onShowHistory: (symbol: string) => void;
    onClosePosition: (symbol: string, side: PositionSide) => void;
    onOpenChart: (symbol: string, entryPrice?: number, entryTime?: number) => void;
    onOpenScanner: () => void;
    onOpenTradeModal: () => void;
    onBatchClose: () => void;
    onClearRecords: () => void;
    onUpdateCustomSettings?: (symbol: string, customSettings?: any) => void;
    networkStatus: 'healthy' | 'delayed' | 'disconnected';
    isOnline: boolean;
    manuallyClosedSymbols: Set<string>;
}
