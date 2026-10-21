
import { useState } from 'react';
import { usePersistedState } from '../../hooks/usePersistedState';
import { ActionConfig } from '../../components/Scanner/scannerTypes';

const DEFAULT_CONFIG: ActionConfig = { 
    enabled: true, 
    openAmount: 10, 
    maxOpenSymbols: 200, // Increased from 100
    maxTotalValue: 100000, // Increased from 10000
    breakoutBuffer: 0.2, 
    autoExecute: true, 
    maxExposurePercent: 95, // Increased from 90
    minHealthPercent: 0,
    positionSizeMode: 'FIXED', 
    variablePercentage: 2, 
    variableMaxLimit: 200,
    breakerConfig: {
        enabled: false,
        triggerMinutes: 15,
        minDropPercent: 3,
        minCoinsPercent: 50,
        autoRecoverMinutes: 30
    },
    autoReopenEnabled: false,
    reopenBullBearFilter: '1h_ema80',
    reopenPullbackLimitPct: 3.0,
    reopenTakeProfitOnly: true,
    reopenMaxConsecutiveLosses: 2,
    reopenLongLimitEnabled: true,
    reopenLongLimitDays: 3,
    reopenLongLimitPct: 20,
    reopenShortLimitEnabled: true,
    reopenShortLimitDays: 3,
    reopenShortLimitPct: 20
};

export const useTacticalCommand = (strategyId?: string) => {
    const suffix = strategyId ? `_${strategyId}` : '';
    const [config, setConfig] = usePersistedState<ActionConfig>(`SCANNER_ACTION_CONFIG${suffix}`, DEFAULT_CONFIG);
    return { config, setConfig };
};
