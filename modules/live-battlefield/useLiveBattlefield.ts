
import { useState, useMemo } from 'react';
import { Position, PositionSide } from '../../types';
import { normalizeSymbol, resolvePrice } from '../../services/symbolUtils';

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
            const currentPrice = resolvePrice(p.symbol, realPrices, p.markPrice || p.entryPrice);
            if (!currentPrice || !p.entryPrice) return 0;
            
            const diff = p.side === PositionSide.LONG 
                ? currentPrice - p.entryPrice 
                : p.entryPrice - currentPrice;
            
            return (diff / p.entryPrice) * 100;
        };

        // Group positions by symbol to find hedged pairs and calculate group PnL
        const symbolStats: Record<string, { isHedged: boolean, maxPnlPercent: number }> = {};
        
        positions.forEach(p => {
            const cleanSym = normalizeSymbol(p.symbol);
            if (!symbolStats[cleanSym]) {
                symbolStats[cleanSym] = { isHedged: false, maxPnlPercent: -Infinity };
            }
            if (p.isHedged) {
                symbolStats[cleanSym].isHedged = true;
            }
            const pnlPct = getLivePnLPercent(p);
            if (pnlPct > symbolStats[cleanSym].maxPnlPercent) {
                symbolStats[cleanSym].maxPnlPercent = pnlPct;
            }
        });

        // Sort logic
        return [...positions].sort((a, b) => {
            const cleanSymA = normalizeSymbol(a.symbol);
            const cleanSymB = normalizeSymbol(b.symbol);
            const statsA = symbolStats[cleanSymA];
            const statsB = symbolStats[cleanSymB];

            // 1. Hedged pairs first
            if (statsA.isHedged && !statsB.isHedged) return -1;
            if (!statsA.isHedged && statsB.isHedged) return 1;

            // 2. If they are different symbols, sort by the symbol's max PnL percent
            if (cleanSymA !== cleanSymB) {
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
        const missingSymbols: string[] = [];
        
        // Only warn if the price feed is actually established (> 50 symbols) 
        // to avoid mass-warning during the first few seconds of startup
        const isPriceFeedEstablished = Object.keys(realPrices).length > 20;

        positions.forEach(p => {
            const cleanSym = normalizeSymbol(p.symbol);
            const price = resolvePrice(p.symbol, realPrices, p.markPrice || p.entryPrice);
            
            totalVal += p.amount * (price || 0);
            
            const diff = p.side === PositionSide.LONG 
                ? (price || 0) - p.entryPrice 
                : p.entryPrice - (price || 0);
            
            totalP += diff * p.amount;
        });

        const uniqueSymbols = new Set(positions.map(p => p.symbol));

        return {
            symbolCount: uniqueSymbols.size,
            totalValue: totalVal,
            totalPnl: totalP,
            symbolsWithNoPrice: missingSymbols.length,
            missingSymbols
        };
    }, [positions, realPrices]);

    return {
        sortMode,
        setSortMode,
        sortedPositions,
        stats
    };
};
