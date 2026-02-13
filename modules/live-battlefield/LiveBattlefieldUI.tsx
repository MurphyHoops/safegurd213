
import React from 'react';
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

    // Sync stats up to Dashboard so List 6 can use them
    React.useEffect(() => {
        onStatsUpdate(stats);
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
