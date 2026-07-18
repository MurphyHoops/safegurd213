
import React from 'react';
import { FinanceMonitorProps } from './types';
import { FinanceStatsPanel } from './components/FinanceStatsPanel';
import { GlobalActionsPanel } from './components/GlobalActionsPanel';
import { useFinanceMonitorLogic } from './useFinanceMonitorLogic';

export const FinanceMonitorModule: React.FC<FinanceMonitorProps> = ({ 
    account, positions, realPrices, isSimulating, 
    onToggleSimulation, onBatchClose, onOpenTradeModal, onResetBalance, networkStatus, isOnline,
    settings
}) => {
    const {
        totalPnL,
        walletBalance,
        totalPnLPercentage,
        totalPositionValue,
        longValue,
        shortValue,
        availableMarginWithLeverage,
        calculatedMarginRatio,
        totalHedgeSLAmount
    } = useFinanceMonitorLogic(account, positions, realPrices);

    return (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 shrink-0 h-[74px]">
            <div className="md:col-span-3 h-full">
                <FinanceStatsPanel 
                    availableMarginWithLeverage={availableMarginWithLeverage}
                    walletBalance={walletBalance}
                    calculatedMarginRatio={calculatedMarginRatio}
                    totalPnL={totalPnL}
                    totalPnLPercentage={totalPnLPercentage}
                    totalPositionValue={totalPositionValue}
                    longValue={longValue}
                    shortValue={shortValue}
                    totalHedgeSLAmount={totalHedgeSLAmount}
                    onResetBalance={onResetBalance}
                    settings={settings}
                />
            </div>
            <div className="md:col-span-2 h-full">
                <GlobalActionsPanel 
                    networkStatus={networkStatus || 'unknown'}
                    isOnline={isOnline}
                    realPricesCount={Object.keys(realPrices).length}
                    isSimulating={isSimulating}
                    onToggleSimulation={onToggleSimulation}
                    settings={settings}
                />
            </div>
        </div>
    );
};
