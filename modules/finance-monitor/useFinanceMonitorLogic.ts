import { useMemo } from 'react';
import { Position, PositionSide } from '../../types';
import { resolvePrice } from '../../services/symbolUtils';

export function useFinanceMonitorLogic(account: any, positions: Position[], realPrices: Record<string, number>) {
    const totalPnL = useMemo(() => {
        return positions.reduce((sum, p) => {
            const livePrice = resolvePrice(p.symbol, realPrices, p.markPrice || p.entryPrice);
            const diff = p.side === PositionSide.LONG ? livePrice - p.entryPrice : p.entryPrice - livePrice;
            return sum + (diff * p.amount);
        }, 0);
    }, [positions, realPrices]);
    
    const walletBalance = account.marginBalance; 
    const equity = walletBalance + totalPnL;   
    const totalPnLPercentage = walletBalance > 0 ? (totalPnL / walletBalance) * 100 : 0;
    
    const totalPositionValue = positions.reduce((sum, p) => sum + (p.amount * p.entryPrice), 0);
    const longValue = positions.filter(p => p.side === PositionSide.LONG).reduce((sum, p) => sum + (p.amount * p.entryPrice), 0);
    const shortValue = positions.filter(p => p.side === PositionSide.SHORT).reduce((sum, p) => sum + (p.amount * p.entryPrice), 0);

    const CONTRACT_LEVERAGE = 20;
    const availableMarginWithLeverage = Math.max(0, (walletBalance + totalPnL) - (totalPositionValue / CONTRACT_LEVERAGE));

    const calculatedMarginRatio = walletBalance > 0 ? (availableMarginWithLeverage / walletBalance * 100) : 0;
    
    const totalHedgeSLAmount = positions.reduce((s, p) => s + (p.cumulativeHedgeLoss || 0), 0);

    return {
        totalPnL,
        walletBalance,
        equity,
        totalPnLPercentage,
        totalPositionValue,
        longValue,
        shortValue,
        availableMarginWithLeverage,
        calculatedMarginRatio,
        totalHedgeSLAmount
    };
}
