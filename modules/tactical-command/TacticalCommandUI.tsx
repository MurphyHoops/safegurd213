
import React, { useEffect } from 'react';
import { useTacticalCommand } from './useTacticalCommand';
import { ActionConfig } from '../../components/Scanner/scannerTypes';
import { PositionSide } from '../../types';
import List6_Action from '../../components/Scanner/List6_Action';

interface Props {
    // Input stats from List 5
    currentStats: { symbolCount: number; totalValue: number; totalPnl: number };
    // Actions
    onPanicSell: () => void;
    onSecureProfit: () => void;
    onCutLosses: () => void;
    onCloseLongs: () => void;
    onCloseShorts: () => void;
    // Export config so other modules can read "openAmount" etc.
    onConfigUpdate: (config: ActionConfig) => void;
}

export const TacticalCommandModule: React.FC<Props> = ({ 
    currentStats, onPanicSell, onSecureProfit, onCutLosses, onCloseLongs, onCloseShorts, onConfigUpdate 
}) => {
    const { config, setConfig } = useTacticalCommand();

    // Sync config upwards
    useEffect(() => {
        onConfigUpdate(config);
    }, [config, onConfigUpdate]);

    return (
        <List6_Action 
            config={config} 
            setConfig={setConfig} 
            currentStats={currentStats}
            onPanicSell={onPanicSell}
            onSecureProfit={onSecureProfit}
            onCutLosses={onCutLosses}
            onCloseLongs={onCloseLongs}
            onCloseShorts={onCloseShorts}
        />
    );
};
