
import { useState, useMemo } from 'react';
import { Position, PositionSide } from '../../types';
import { normalizeSymbol, resolvePrice } from '../../services/symbolUtils';

export const useLiveBattlefield = (
    positions: Position[],
    realPrices: Record<string, number>
) => {
    // Default to PNL_PERCENT and DESC (Highest Profit First)
    const [sortType, setSortType] = useState<'PNL_PERCENT' | 'AMOUNT' | 'PNL_AMOUNT'>('PNL_PERCENT');
    const [sortOrder, setSortOrder] = useState<'DESC' | 'ASC'>('DESC');

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

        const getLivePnLAmount = (p: Position) => {
            const currentPrice = resolvePrice(p.symbol, realPrices, p.markPrice || p.entryPrice);
            if (!currentPrice || !p.entryPrice) return 0;
            
            const diff = p.side === PositionSide.LONG 
                ? currentPrice - p.entryPrice 
                : p.entryPrice - currentPrice;
            
            return diff * p.amount;
        };

        // Group positions by symbol to find hedged pairs and calculate group PnL
        const symbolStats: Record<string, { 
            isHedged: boolean, 
            maxPnlPercent: number,
            maxAmount: number,
            maxPnlAmount: number
        }> = {};
        
        positions.forEach(p => {
            const cleanSym = normalizeSymbol(p.symbol);
            if (!symbolStats[cleanSym]) {
                symbolStats[cleanSym] = { 
                    isHedged: false, 
                    maxPnlPercent: -Infinity,
                    maxAmount: -Infinity,
                    maxPnlAmount: -Infinity
                };
            }
            if (p.isHedged) {
                symbolStats[cleanSym].isHedged = true;
            }
            
            const pnlPct = getLivePnLPercent(p);
            if (pnlPct > symbolStats[cleanSym].maxPnlPercent) {
                symbolStats[cleanSym].maxPnlPercent = pnlPct;
            }

            const pnlAmt = getLivePnLAmount(p);
            if (pnlAmt > symbolStats[cleanSym].maxPnlAmount) {
                symbolStats[cleanSym].maxPnlAmount = pnlAmt;
            }

            const currentPrice = resolvePrice(p.symbol, realPrices, p.markPrice || p.entryPrice);
            const posVal = p.amount * (currentPrice || p.entryPrice || 1);
            if (posVal > symbolStats[cleanSym].maxAmount) {
                symbolStats[cleanSym].maxAmount = posVal;
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

            // 2. Sort by selected sort type
            if (cleanSymA !== cleanSymB) {
                let valA = 0;
                let valB = 0;
                
                if (sortType === 'PNL_PERCENT') {
                    valA = statsA.maxPnlPercent;
                    valB = statsB.maxPnlPercent;
                } else if (sortType === 'AMOUNT') {
                    valA = statsA.maxAmount;
                    valB = statsB.maxAmount;
                } else if (sortType === 'PNL_AMOUNT') {
                    valA = statsA.maxPnlAmount;
                    valB = statsB.maxPnlAmount;
                }

                if (sortOrder === 'DESC') {
                    return valB - valA;
                } else {
                    return valA - valB;
                }
            }

            // 3. Same symbol (e.g. main and hedge), sort by dynamic value
            let subValA = 0;
            let subValB = 0;
            if (sortType === 'PNL_PERCENT') {
                subValA = getLivePnLPercent(a);
                subValB = getLivePnLPercent(b);
            } else if (sortType === 'AMOUNT') {
                const priceA = resolvePrice(a.symbol, realPrices, a.markPrice || a.entryPrice);
                const priceB = resolvePrice(b.symbol, realPrices, b.markPrice || b.entryPrice);
                subValA = a.amount * (priceA || a.entryPrice || 1);
                subValB = b.amount * (priceB || b.entryPrice || 1);
            } else if (sortType === 'PNL_AMOUNT') {
                subValA = getLivePnLAmount(a);
                subValB = getLivePnLAmount(b);
            }

            if (sortOrder === 'DESC') {
                return subValB - subValA;
            } else {
                return subValA - subValB;
            }
        });
    }, [positions, realPrices, sortType, sortOrder]); // Added realPrices to dependencies

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
        sortType,
        setSortType,
        sortOrder,
        setSortOrder,
        sortedPositions,
        stats
    };
};
