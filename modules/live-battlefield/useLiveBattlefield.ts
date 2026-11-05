import { useState, useEffect, useRef } from 'react';
import { Position, PositionSide } from '../../types';
import { normalizeSymbol, resolvePrice } from '../../services/symbolUtils';

export const useLiveBattlefield = (
    positions: Position[],
    realPrices: Record<string, number>
) => {
    const [sortType, setSortType] = useState<'PNL_PERCENT' | 'AMOUNT' | 'PNL_AMOUNT'>('PNL_PERCENT');
    const [sortOrder, setSortOrder] = useState<'DESC' | 'ASC'>('DESC');

    const positionsRef = useRef(positions);
    const realPricesRef = useRef(realPrices);
    const sortTypeRef = useRef(sortType);
    const sortOrderRef = useRef(sortOrder);

    positionsRef.current = positions;
    realPricesRef.current = realPrices;
    sortTypeRef.current = sortType;
    sortOrderRef.current = sortOrder;

    const [sortedPositions, setSortedPositions] = useState<Position[]>([]);
    const [stats, setStats] = useState({
        symbolCount: 0,
        totalValue: 0,
        totalPnl: 0,
        symbolsWithNoPrice: 0,
        missingSymbols: [] as string[]
    });

    const lastComputeTimeRef = useRef<number>(0);
    const computeTimerRef = useRef<any>(null);

    const computeBattlefieldSnapshot = () => {
        const curPositions = positionsRef.current;
        const curPrices = realPricesRef.current;
        const curSortType = sortTypeRef.current;
        const curSortOrder = sortOrderRef.current;

        if (!curPositions || curPositions.length === 0) {
            setSortedPositions([]);
            setStats({
                symbolCount: 0,
                totalValue: 0,
                totalPnl: 0,
                symbolsWithNoPrice: 0,
                missingSymbols: []
            });
            lastComputeTimeRef.current = Date.now();
            return;
        }

        const getLivePnLPercent = (p: Position) => {
            const currentPrice = resolvePrice(p.symbol, curPrices, p.markPrice || p.entryPrice);
            if (!currentPrice || !p.entryPrice) return 0;
            const diff = p.side === PositionSide.LONG 
                ? currentPrice - p.entryPrice 
                : p.entryPrice - currentPrice;
            return (diff / p.entryPrice) * 100;
        };

        const getLivePnLAmount = (p: Position) => {
            const currentPrice = resolvePrice(p.symbol, curPrices, p.markPrice || p.entryPrice);
            if (!currentPrice || !p.entryPrice) return 0;
            const diff = p.side === PositionSide.LONG 
                ? currentPrice - p.entryPrice 
                : p.entryPrice - currentPrice;
            return diff * p.amount;
        };

        const symbolStats: Record<string, { 
            isHedged: boolean, 
            maxPnlPercent: number,
            maxAmount: number,
            maxPnlAmount: number
        }> = {};
        
        curPositions.forEach(p => {
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

            const currentPrice = resolvePrice(p.symbol, curPrices, p.markPrice || p.entryPrice);
            const posVal = p.amount * (currentPrice || p.entryPrice || 1);
            if (posVal > symbolStats[cleanSym].maxAmount) {
                symbolStats[cleanSym].maxAmount = posVal;
            }
        });

        const sorted = [...curPositions].sort((a, b) => {
            const cleanSymA = normalizeSymbol(a.symbol);
            const cleanSymB = normalizeSymbol(b.symbol);
            const statsA = symbolStats[cleanSymA];
            const statsB = symbolStats[cleanSymB];

            if (statsA.isHedged && !statsB.isHedged) return -1;
            if (!statsA.isHedged && statsB.isHedged) return 1;

            if (cleanSymA !== cleanSymB) {
                let valA = 0;
                let valB = 0;
                
                if (curSortType === 'PNL_PERCENT') {
                    valA = statsA.maxPnlPercent;
                    valB = statsB.maxPnlPercent;
                } else if (curSortType === 'AMOUNT') {
                    valA = statsA.maxAmount;
                    valB = statsB.maxAmount;
                } else if (curSortType === 'PNL_AMOUNT') {
                    valA = statsA.maxPnlAmount;
                    valB = statsB.maxPnlAmount;
                }

                if (curSortOrder === 'DESC') {
                    return valB - valA;
                } else {
                    return valA - valB;
                }
            }

            let subValA = 0;
            let subValB = 0;
            if (curSortType === 'PNL_PERCENT') {
                subValA = getLivePnLPercent(a);
                subValB = getLivePnLPercent(b);
            } else if (curSortType === 'AMOUNT') {
                const priceA = resolvePrice(a.symbol, curPrices, a.markPrice || a.entryPrice);
                const priceB = resolvePrice(b.symbol, curPrices, b.markPrice || b.entryPrice);
                subValA = a.amount * (priceA || a.entryPrice || 1);
                subValB = b.amount * (priceB || b.entryPrice || 1);
            } else if (curSortType === 'PNL_AMOUNT') {
                subValA = getLivePnLAmount(a);
                subValB = getLivePnLAmount(b);
            }

            if (curSortOrder === 'DESC') {
                return subValB - subValA;
            } else {
                return subValA - subValB;
            }
        });

        let totalVal = 0;
        let totalP = 0;
        const missingSymbols: string[] = [];

        curPositions.forEach(p => {
            const price = resolvePrice(p.symbol, curPrices, p.markPrice || p.entryPrice);
            if (!price) {
                missingSymbols.push(p.symbol);
            }
            totalVal += p.amount * (price || 0);
            const diff = p.side === PositionSide.LONG 
                ? (price || 0) - p.entryPrice 
                : p.entryPrice - (price || 0);
            totalP += diff * p.amount;
        });

        const uniqueSymbols = new Set(curPositions.map(p => p.symbol));

        setSortedPositions(sorted);
        setStats({
            symbolCount: uniqueSymbols.size,
            totalValue: totalVal,
            totalPnl: totalP,
            symbolsWithNoPrice: missingSymbols.length,
            missingSymbols
        });

        lastComputeTimeRef.current = Date.now();
    };

    // 🔒 [500ms 战场推演节流门禁]: 避免 high-frequency realPrices 引发频繁整表 Re-render
    useEffect(() => {
        const now = Date.now();
        const elapsed = now - lastComputeTimeRef.current;

        if (elapsed >= 500) {
            if (computeTimerRef.current) {
                clearTimeout(computeTimerRef.current);
                computeTimerRef.current = null;
            }
            computeBattlefieldSnapshot();
        } else if (!computeTimerRef.current) {
            computeTimerRef.current = setTimeout(() => {
                computeTimerRef.current = null;
                computeBattlefieldSnapshot();
            }, 500 - elapsed);
        }

        return () => {
            if (computeTimerRef.current) {
                clearTimeout(computeTimerRef.current);
                computeTimerRef.current = null;
            }
        };
    }, [positions, realPrices, sortType, sortOrder]);

    return {
        sortType,
        setSortType,
        sortOrder,
        setSortOrder,
        sortedPositions,
        stats
    };
};
