
import { useState, useMemo } from 'react';
import { Position, PositionSide } from '../../types';

export const useLiveBattlefield = (
    positions: Position[],
    realPrices: Record<string, number>
) => {
    // Default to DESC (Highest Profit First)
    const [sortMode, setSortMode] = useState<'DESC' | 'ASC'>('DESC');

    const sortedPositions = useMemo(() => {
        // Helper: Calculate live PnL dynamically for sorting
        // This ensures the sort order responds immediately to price ticks
        const getLivePnL = (p: Position) => {
            const currentPrice = realPrices[p.symbol] || p.markPrice || p.entryPrice;
            if (!currentPrice || !p.entryPrice) return 0;
            
            const diff = p.side === PositionSide.LONG 
                ? currentPrice - p.entryPrice 
                : p.entryPrice - currentPrice;
            
            return diff * p.amount;
        };

        // Sort logic
        return [...positions].sort((a, b) => {
            const pnlA = getLivePnL(a);
            const pnlB = getLivePnL(b);
            
            if (sortMode === 'DESC') {
                return pnlB - pnlA; // High to Low
            } else {
                return pnlA - pnlB; // Low to High
            }
        });
    }, [positions, realPrices, sortMode]); // Added realPrices to dependencies

    const stats = useMemo(() => {
        // Recalculate stats based on live prices for accuracy
        let totalVal = 0;
        let totalP = 0;

        positions.forEach(p => {
            const price = realPrices[p.symbol] || p.markPrice || p.entryPrice;
            totalVal += p.amount * price;
            
            const diff = p.side === PositionSide.LONG 
                ? price - p.entryPrice 
                : p.entryPrice - price;
            
            totalP += diff * p.amount;
        });

        return {
            symbolCount: positions.length,
            totalValue: totalVal,
            totalPnl: totalP
        };
    }, [positions, realPrices]);

    return {
        sortMode,
        setSortMode,
        sortedPositions,
        stats
    };
};
