
import { ProfitSettings } from '../../types';

export interface ProfitManagerProps {
    settings: ProfitSettings;
    onChange: (key: string, value: any) => void;
    updateNested: (subsection: string, key: string, value: any) => void;
}
