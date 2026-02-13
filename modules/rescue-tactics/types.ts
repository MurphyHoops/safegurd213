
import { StopLossSettings } from '../../types';

export interface RescueTacticsProps {
    settings: StopLossSettings;
    onChange: (key: string, value: any) => void;
    toggleFeature: (feature: keyof StopLossSettings) => void;
    onShowStrategyInfo: () => void;
}
