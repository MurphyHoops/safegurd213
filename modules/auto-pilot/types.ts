
import { AppSettings } from '../../types';

export interface AutoPilotProps {
    isSimulating: boolean;
    onToggleSim: () => void;
    onOpenScanner: () => void;
    settings: AppSettings;
    onChange: (key: string, value: any) => void;
}
