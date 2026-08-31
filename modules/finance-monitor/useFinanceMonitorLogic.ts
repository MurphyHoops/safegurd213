import { useMemo } from 'react';
import { Position, PositionSide } from '../../types';
import { resolvePrice, normalizeSymbol } from '../../services/symbolUtils';

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
    
    const totalHedgeSLAmount = (() => {
        const symbolMap = new Map<string, { hedgeLoss: number; ampLoss: number }>();
        positions.forEach(p => {
            const sym = normalizeSymbol(p.symbol);
            // 🔒 只有在正在防爆对冲期间（多空双向持仓、具有对冲标识或砍仓补仓周期中），才计入系统负债
            const isSymUnderActiveHedge = positions.some(other => normalizeSymbol(other.symbol) === sym && (
                other.isHedged || 
                !!other.mainPositionId || 
                (!!other.isAmputated && (other.amputatedAmount || 0) > 0) ||
                other.side !== p.side ||
                (other.cumulativeAmputationLoss || 0) > 0 ||
                (other.cumulativeHedgeLoss || 0) > 0
            ));

            if (isSymUnderActiveHedge) {
                const current = symbolMap.get(sym) || { hedgeLoss: 0, ampLoss: 0 };
                current.hedgeLoss = Math.max(current.hedgeLoss, p.cumulativeHedgeLoss || 0);
                current.ampLoss = Math.max(current.ampLoss, p.cumulativeAmputationLoss || 0);
                symbolMap.set(sym, current);
            }
        });
        let sum = 0;
        symbolMap.forEach(d => { sum += d.hedgeLoss + d.ampLoss; });
        return sum;
    })();

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
