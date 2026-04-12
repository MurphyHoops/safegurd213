
import React, { useRef } from 'react';
import { useLiveBattlefield } from './useLiveBattlefield';
import { Position, PositionSide } from '../../types';
import List5_Live from '../../components/Scanner/List5_Live';

interface Props {
    positions: Position[];
    realPrices: Record<string, number>;
    setChartData: (data: any) => void;
    onClosePosition: (symbol: string, side: PositionSide) => void;
    // Callback to export stats to parent (for List 6 Action Module usage)
    onStatsUpdate: (stats: any) => void;
}

export const LiveBattlefieldModule: React.FC<Props> = ({ positions, realPrices, setChartData, onClosePosition, onStatsUpdate }) => {
    const { sortMode, setSortMode, sortedPositions, stats } = useLiveBattlefield(positions, realPrices);
    
    // THROTTLE REF: Prevents render storm
    const lastUpdateRef = useRef<number>(0);
    const lastStatsRef = useRef<string>("");

    // Sync stats up to Dashboard so List 6 can use them
    // OPTIMIZED: Checks for value changes
    React.useEffect(() => {
        // Only update if stats have materially changed (value or count)
        // This prevents re-rendering parent if PnL is stagnant
        const currentStatsStr = `${stats.symbolCount}-${stats.totalPnl.toFixed(2)}`;
        
        if (currentStatsStr !== lastStatsRef.current) {
            onStatsUpdate(stats);
            lastStatsRef.current = currentStatsStr;
        }
    }, [stats, onStatsUpdate]);

    return (
        <List5_Live 
            moduleStats={stats} 
            sortedActivePositions={sortedPositions} 
            realPrices={realPrices} 
            setChartData={setChartData} 
            onClosePosition={onClosePosition}
            list5Sort={sortMode} 
            setList5Sort={setSortMode}
        />
    );
};
