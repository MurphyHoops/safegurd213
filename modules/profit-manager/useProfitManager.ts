
import { ProfitManagerProps } from './types';

export const useProfitManager = ({ settings, onChange, updateNested }: ProfitManagerProps) => {
    
    const toggleOForMode = (mode: string) => {
        const currentMap = settings.oEnabledMap || {};
        const nextVal = !currentMap[mode];
        const newMap = { ...currentMap, [mode]: nextVal };
        onChange('oEnabledMap', newMap);
        if (mode === 'SMART') {
            updateNested('smart', 'enabled', nextVal);
        }
    };

    return {
        toggleOForMode
    };
};
