
import React, { useEffect } from 'react';
import { useBacktestStructureAudit } from './useBacktestStructureAudit';
import { ScannerItem, List3Config } from '../../../components/Scanner/scannerTypes';
import List3_Structure from '../../structure-audit/components/List3_Structure';

interface Props {
    candidates: ScannerItem[];
    onResultsUpdate: (results: ScannerItem[]) => void;
    onConfigUpdate: (config: List3Config) => void;
    onRemoveSignalReady?: (fn: any) => void;
    realPrices: Record<string, number>;
    setChartData: (data: any) => void;
    executeTradeSafe: any;
    activePositions: any[];
    directMode?: boolean;
    onLog?: (type: any, msg: string) => void;
    actionConfig?: any;
}

export const BacktestStructureAuditModule: React.FC<Props> = ({ candidates, onResultsUpdate, onConfigUpdate, onRemoveSignalReady, realPrices, setChartData, executeTradeSafe, activePositions, onLog, actionConfig }) => {
    const { config, setConfig, results, status, removeItem, clearItems } = useBacktestStructureAudit(candidates, onResultsUpdate, onConfigUpdate, onRemoveSignalReady, realPrices, onLog);

    return (
        <List3_Structure 
            config={config} 
            setConfig={setConfig} 
            countdowns={{}} 
            list3={results} 
            setChartData={setChartData} 
            executeTradeSafe={executeTradeSafe} 
            actionConfig={actionConfig || ({ enabled: false } as any)}
            scanningStatus={{
                symbols: [],
                tfs: [],
                current: status === 'AUDITING' ? 1 : 0,
                total: status === 'AUDITING' ? 1 : 0,
                currentAction: status === 'AUDITING' ? 'SCANNING' : 'IDLE'
            }}
            activePositions={activePositions}
            onRemoveItem={removeItem}
            onClearItems={clearItems}
        />
    );
};
