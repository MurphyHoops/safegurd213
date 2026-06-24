
import { ProfitManagerProps } from './types';

export const useProfitManager = ({ settings, onChange, updateNested }: ProfitManagerProps) => {
    
    const toggleOForMode = (mode: string) => {
        const currentMap = settings.oEnabledMap || {};
        onChange('oEnabledMap', { ...currentMap, [mode]: !currentMap[mode] });
    };

    return {
        toggleOForMode
    };
};
