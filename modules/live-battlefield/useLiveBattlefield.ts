
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
        const getLivePnLPercent = (p: Position) => {
            const currentPrice = realPrices[p.symbol] || p.markPrice || p.entryPrice;
            if (!currentPrice || !p.entryPrice) return 0;
            
            const diff = p.side === PositionSide.LONG 
                ? currentPrice - p.entryPrice 
                : p.entryPrice - currentPrice;
            
            return (diff / p.entryPrice) * 100;
        };

        // Group positions by symbol to find hedged pairs and calculate group PnL
        const symbolStats: Record<string, { isHedged: boolean, maxPnlPercent: number }> = {};
        
        positions.forEach(p => {
            if (!symbolStats[p.symbol]) {
                symbolStats[p.symbol] = { isHedged: false, maxPnlPercent: -Infinity };
            }
            if (p.isHedged) {
                symbolStats[p.symbol].isHedged = true;
            }
            const pnlPct = getLivePnLPercent(p);
            if (pnlPct > symbolStats[p.symbol].maxPnlPercent) {
                symbolStats[p.symbol].maxPnlPercent = pnlPct;
            }
        });

        // Sort logic
        return [...positions].sort((a, b) => {
            const statsA = symbolStats[a.symbol];
            const statsB = symbolStats[b.symbol];

            // 1. Hedged pairs first
            if (statsA.isHedged && !statsB.isHedged) return -1;
            if (!statsA.isHedged && statsB.isHedged) return 1;

            // 2. If they are different symbols, sort by the symbol's max PnL percent
            if (a.symbol !== b.symbol) {
                if (sortMode === 'DESC') {
                    return statsB.maxPnlPercent - statsA.maxPnlPercent;
                } else {
                    return statsA.maxPnlPercent - statsB.maxPnlPercent;
                }
            }

            // 3. If same symbol (e.g. main and hedge), sort by PnL percent
            const pnlA = getLivePnLPercent(a);
            const pnlB = getLivePnLPercent(b);
            return pnlB - pnlA; // Within the same symbol, highest PnL first
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
