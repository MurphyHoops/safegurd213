
import { HedgingSettings } from '../../types';

export interface HedgeGuardianProps {
    settings: HedgingSettings;
    onChange: (key: string, value: any) => void;
}
