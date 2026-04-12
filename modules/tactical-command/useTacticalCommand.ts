
import { useState } from 'react';
import { usePersistedState } from '../../hooks/usePersistedState';
import { ActionConfig } from '../../components/Scanner/scannerTypes';

const DEFAULT_CONFIG: ActionConfig = { 
    enabled: true, 
    openAmount: 100, 
    maxOpenSymbols: 50, 
    maxTotalValue: 10000, 
    breakoutBuffer: 0.2, 
    autoExecute: false, 
    maxExposurePercent: 50, 
    positionSizeMode: 'FIXED', 
    variablePercentage: 2, 
    variableMaxLimit: 200
};

export const useTacticalCommand = () => {
    const [config, setConfig] = usePersistedState<ActionConfig>('SCANNER_ACTION_CONFIG', DEFAULT_CONFIG);
    return { config, setConfig };
};
