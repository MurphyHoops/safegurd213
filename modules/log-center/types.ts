
import { LogEntry } from '../../types';

export interface LogCenterProps {
    logs: LogEntry[];
    onOpenChart?: (symbol: string, entryPrice?: number, entryTime?: number) => void;
}
