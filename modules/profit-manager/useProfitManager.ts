
import { ProfitManagerProps } from './types';
import { ProfitTier } from '../../types';

export const useProfitManager = ({ settings, onChange, updateNested }: ProfitManagerProps) => {
    
    const updateDynamicTier = (index: number, key: keyof ProfitTier, value: number) => {
        const tiers = [...settings.dynamic.tiers];
        tiers[index] = { ...tiers[index], [key]: value };
        updateNested('dynamic', 'tiers', tiers);
    };

    const toggleOForMode = (mode: string) => {
        const currentMap = settings.oEnabledMap || {};
        onChange('oEnabledMap', { ...currentMap, [mode]: !currentMap[mode] });
    };

    return {
        updateDynamicTier,
        toggleOForMode
    };
};
