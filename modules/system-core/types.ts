import { SystemSettings } from '../../types';
import React from 'react';

export interface SystemCoreProps {
    settings: SystemSettings;
    onChange: (key: string, value: any) => void;
    onOpenManual: () => void;
    onViewSource: () => void;
    onFactoryReset: () => void;
    onExportSettings: (name: string) => void;
    onImportSettings: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onUpdateBinanceRealBalance?: (balance: number, realPositions?: any[]) => void;
}