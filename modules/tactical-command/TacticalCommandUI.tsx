
// 🔒 LOCKED_MODULE: LIST 6 [终极战术终端 & 指令控制面板]
// @LOCKED: 严格原子化单独锁定。未经用户明确的专属书面指令，严禁擅自修改、重构或变动任何算法与流转逻辑。

import React, { useEffect } from 'react';
import { useTacticalCommand } from './useTacticalCommand';
import { ActionConfig } from '../../components/Scanner/scannerTypes';
import { PositionSide } from '../../types';
import List6_Action from './components/List6_Action';

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
    strategyId?: string;
}

export const TacticalCommandModule: React.FC<Props> = ({ 
    currentStats, onPanicSell, onSecureProfit, onCutLosses, onCloseLongs, onCloseShorts, onConfigUpdate, strategyId 
}) => {
    const { config, setConfig } = useTacticalCommand(strategyId);

    // Sync config upwards safely to avoid infinite loops
    const prevConfigStrRef = React.useRef('');
    useEffect(() => {
        const str = JSON.stringify(config);
        if (str !== prevConfigStrRef.current) {
            prevConfigStrRef.current = str;
            setTimeout(() => {
                onConfigUpdate(config);
            }, 0);
        }
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
