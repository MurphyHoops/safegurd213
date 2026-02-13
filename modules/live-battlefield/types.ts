
import { Position } from '../../types';

export interface LiveBattlefieldState {
    sortedPositions: Position[];
    stats: {
        symbolCount: number;
        totalValue: number;
        totalPnl: number;
    };
}
