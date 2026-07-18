
import { AccountData, Position, AppSettings } from '../../types';

export interface FinanceMonitorProps {
    account: AccountData;
    positions: Position[];
    realPrices: Record<string, number>;
    isSimulating: boolean;
    onToggleSimulation: () => void;
    onBatchClose: () => void;
    onOpenTradeModal: () => void;
    onResetBalance?: (amount: number) => void;
    networkStatus: 'healthy' | 'delayed' | 'disconnected';
    isOnline: boolean;
    settings: AppSettings;
}
