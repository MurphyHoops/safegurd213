
import { useState } from 'react';
import { usePersistedState } from '../../hooks/usePersistedState';
import { ActionConfig } from '../../components/Scanner/scannerTypes';

const DEFAULT_CONFIG: ActionConfig = { 
    enabled: true, 
    openAmount: 100, 
    maxOpenSymbols: 200, // Increased from 100
    maxTotalValue: 100000, // Increased from 10000
    breakoutBuffer: 0.2, 
    autoExecute: true, 
    maxExposurePercent: 95, // Increased from 90
    positionSizeMode: 'FIXED', 
    variablePercentage: 2, 
    variableMaxLimit: 200,
    breakerConfig: {
        enabled: false,
        triggerMinutes: 15,
        minDropPercent: 3,
        minCoinsPercent: 50,
        autoRecoverMinutes: 30
    }
};

export const useTacticalCommand = () => {
    const [config, setConfig] = usePersistedState<ActionConfig>('SCANNER_ACTION_CONFIG', DEFAULT_CONFIG);
    return { config, setConfig };
};
