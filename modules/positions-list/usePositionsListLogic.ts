import { useMemo } from 'react';
import { Position, PositionSide } from '../../types';

export function usePositionsListLogic(positions: Position[], realPrices: Record<string, number>, sortMode: 'DESC' | 'ASC', settings: any) {
    const sortedPositions = useMemo(() => {
        const getLivePnLPercent = (p: Position) => {
            return p.unrealizedPnLPercentage || 0;
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
    }, [positions, realPrices, sortMode]);

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
