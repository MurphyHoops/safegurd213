import { useMemo, useRef } from 'react';
import { Position, PositionSide } from '../../types';

export function usePositionsListLogic(
    positions: Position[], 
    realPrices: Record<string, number>, 
    sortKey: 'PNL_PCT' | 'AMOUNT' | 'PNL_AMOUNT',
    sortMode: 'DESC' | 'ASC', 
    settings: any,
    isHoverLocked: boolean = false
) {
    const lockedPositionsOrderRef = useRef<Position[]>([]);

    const sortedPositions = useMemo(() => {
        // If hover is locked and we already have a locked order of positions, maintain the previous order
        // while allowing their data (PnL, markPrice, status) to update seamlessly without changing rows
        if (isHoverLocked && lockedPositionsOrderRef.current.length > 0) {
            const posMap = new Map<string, Position>();
            positions.forEach(p => {
                const key = `${p.entryId || ''}_${p.symbol}_${p.side}`;
                posMap.set(key, p);
            });

            const preservedList: Position[] = [];
            const seenKeys = new Set<string>();

            // 1. First keep all positions in their exact frozen row order
            lockedPositionsOrderRef.current.forEach(oldP => {
                const key = `${oldP.entryId || ''}_${oldP.symbol}_${oldP.side}`;
                const updatedP = posMap.get(key);
                if (updatedP) {
                    preservedList.push(updatedP);
                    seenKeys.add(key);
                }
            });

            // 2. Append any newly opened positions at the bottom so they don't shift existing rows
            positions.forEach(p => {
                const key = `${p.entryId || ''}_${p.symbol}_${p.side}`;
                if (!seenKeys.has(key)) {
                    preservedList.push(p);
                }
            });

            return preservedList;
        }

        const getLivePnLPercent = (p: Position) => {
            return p.unrealizedPnLPercentage || 0;
        };

        const getLivePnLAmount = (p: Position) => {
            return p.unrealizedPnL || 0;
        };

        const getPositionValue = (p: Position) => {
            // Position value/size: amount * entryPrice.
            return Math.abs(p.amount * p.entryPrice);
        };

        // Group positions by symbol to find hedged pairs and calculate group stats
        const symbolStats: Record<string, { 
            isHedged: boolean, 
            maxPnlPercent: number,
            maxPositionValue: number,
            maxPnlAmount: number
        }> = {};
        
        positions.forEach(p => {
            if (!symbolStats[p.symbol]) {
                symbolStats[p.symbol] = { 
                    isHedged: false, 
                    maxPnlPercent: -Infinity,
                    maxPositionValue: -Infinity,
                    maxPnlAmount: -Infinity
                };
            }
            if (p.isHedged) {
                symbolStats[p.symbol].isHedged = true;
            }
            
            const pnlPct = getLivePnLPercent(p);
            if (pnlPct > symbolStats[p.symbol].maxPnlPercent) {
                symbolStats[p.symbol].maxPnlPercent = pnlPct;
            }

            const posVal = getPositionValue(p);
            if (posVal > symbolStats[p.symbol].maxPositionValue) {
                symbolStats[p.symbol].maxPositionValue = posVal;
            }

            const pnlAmt = getLivePnLAmount(p);
            if (pnlAmt > symbolStats[p.symbol].maxPnlAmount) {
                symbolStats[p.symbol].maxPnlAmount = pnlAmt;
            }
        });

        // Sort logic
        const sorted = [...positions].sort((a, b) => {
            const statsA = symbolStats[a.symbol];
            const statsB = symbolStats[b.symbol];

            // 1. Hedged pairs first
            if (statsA.isHedged && !statsB.isHedged) return -1;
            if (!statsA.isHedged && statsB.isHedged) return 1;

            // 2. If they are different symbols, sort by the selected key
            if (a.symbol !== b.symbol) {
                if (sortKey === 'PNL_PCT') {
                    if (sortMode === 'DESC') {
                        return statsB.maxPnlPercent - statsA.maxPnlPercent;
                    } else {
                        return statsA.maxPnlPercent - statsB.maxPnlPercent;
                    }
                } else if (sortKey === 'AMOUNT') {
                    if (sortMode === 'DESC') {
                        return statsB.maxPositionValue - statsA.maxPositionValue;
                    } else {
                        return statsA.maxPositionValue - statsB.maxPositionValue;
                    }
                } else if (sortKey === 'PNL_AMOUNT') {
                    if (sortMode === 'DESC') {
                        return statsB.maxPnlAmount - statsA.maxPnlAmount;
                    } else {
                        return statsA.maxPnlAmount - statsB.maxPnlAmount;
                    }
                }
            }

            // 3. If same symbol (e.g. main and hedge), sort within the symbol
            if (sortKey === 'PNL_PCT') {
                const pnlA = getLivePnLPercent(a);
                const pnlB = getLivePnLPercent(b);
                return pnlB - pnlA; // Within same symbol, highest PnL % first
            } else if (sortKey === 'AMOUNT') {
                const valA = getPositionValue(a);
                const valB = getPositionValue(b);
                return valB - valA; // Within same symbol, highest position size first
            } else if (sortKey === 'PNL_AMOUNT') {
                const amtA = getLivePnLAmount(a);
                const amtB = getLivePnLAmount(b);
                return amtB - amtA; // Within same symbol, highest PnL amount first
            }

            return 0;
        });

        // Update locked positions reference with the latest calculated sorted order
        lockedPositionsOrderRef.current = sorted;
        return sorted;
    }, [positions, sortKey, sortMode, realPrices, isHoverLocked]);

    const longCount = positions.filter(p => p.side === PositionSide.LONG).length;
    const shortCount = positions.filter(p => p.side === PositionSide.SHORT).length;
    const hedgePairsCount = positions.filter(p => p.isHedged && !p.mainPositionId).length;

    const activeStrategies = [];
    if (settings?.stopLoss) {
        if (settings.stopLoss.hedgeProfitClear) activeStrategies.push("对冲盈利解套");
        if (settings.stopLoss.callbackProfitClear) activeStrategies.push("回调盈利清仓");
        if (settings.stopLoss.amputationEnabled) activeStrategies.push("断臂求生");
    }

    return {
        sortedPositions,
        longCount,
        shortCount,
        hedgePairsCount,
        activeStrategies
    };
}
