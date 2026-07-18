
import React from 'react';
import { AccountData, Position, TradeLog, AppSettings, PositionSide } from '../types';
import { FinanceMonitorModule } from '../modules/finance-monitor';
import { PositionsListModule } from '../modules/positions-list';

interface Props {
    account: AccountData;
    positions: Position[];
    tradeLogs: TradeLog[];
    realPrices: Record<string, number>;
    onRowLongPress: () => void;
    onShowHistory: (symbol: string) => void;
    hasHistory: () => boolean;
    onClearPositions: () => void;
    onClosePosition: (symbol: string, side: PositionSide) => void;
    onDeletePosition: (symbol: string, side: PositionSide) => void;
    onBatchClose: () => void;
    onClearRecords: () => void;
    onUpdateCustomSettings?: (symbol: string, customSettings?: any) => void;
    onResetBalance: (amount: number) => void;
    onOpenChart: (symbol: string, entryPrice?: number, entryTime?: number) => void;
    onVerifyPosition: (position: Position) => void;
    onOpenLogs: () => void;
    onOpenTradeModal: () => void;
    isSimulating: boolean;
    onToggleSimulation: () => void;
    onShowSymbolTradeLogs: (symbol: string) => void;
    globalAutoReopen: boolean;
    onToggleLoop: () => void;
    onOpenScanner: () => void;
    settings: AppSettings;
    networkStatus: 'healthy' | 'delayed' | 'disconnected';
    isOnline: boolean;
    manuallyClosedSymbols?: Set<string>;
}

const Dashboard: React.FC<Props> = ({
    account,
    positions,
    realPrices,
    isSimulating,
    onToggleSimulation,
    onBatchClose,
    onClearRecords,
    onResetBalance,
    onOpenTradeModal,
    onClosePosition,
    onShowHistory,
    onOpenChart,
    onVerifyPosition,
    settings,
    onOpenScanner,
    onRowLongPress,
    networkStatus,
    isOnline,
    onUpdateCustomSettings,
    manuallyClosedSymbols = new Set<string>()
}) => {
    
    return (
        <div className="flex flex-col h-full gap-2">
            {/* MODULE A: FINANCE MONITOR (Stats & Global Actions) */}
            <FinanceMonitorModule 
                account={account}
                positions={positions}
                realPrices={realPrices}
                isSimulating={isSimulating}
                onToggleSimulation={onToggleSimulation}
                onBatchClose={onBatchClose}
                onOpenTradeModal={onOpenTradeModal}
                onResetBalance={onResetBalance}
                networkStatus={networkStatus}
                isOnline={isOnline}
                settings={settings}
            />

            {/* MODULE B: POSITIONS LIST (Active Trades) */}
            <PositionsListModule 
                positions={positions}
                realPrices={realPrices}
                walletBalance={account.marginBalance}
                settings={settings}
                onRowLongPress={onRowLongPress}
                onShowHistory={onShowHistory}
                onClosePosition={onClosePosition}
                onOpenChart={onOpenChart}
                onVerifyPosition={onVerifyPosition}
                onOpenScanner={onOpenScanner}
                onOpenTradeModal={onOpenTradeModal}
                onBatchClose={onBatchClose}
                onClearRecords={onClearRecords}
                onUpdateCustomSettings={onUpdateCustomSettings}
                networkStatus={networkStatus}
                isOnline={isOnline}
                manuallyClosedSymbols={manuallyClosedSymbols}
            />
        </div>
    );
};

export default Dashboard;
