
import React from 'react';
import { useBacktestMomentumAudit } from './useBacktestMomentumAudit';
import { ScannerItem, List3Config, ActionConfig } from '../../../components/Scanner/scannerTypes';
import List4_Momentum from '../../momentum-audit/components/List4_Momentum';

interface Props {
    candidates: ScannerItem[];
    setChartData: (data: any) => void;
    executeTradeSafe: any;
    list3Config: List3Config | null;
    realPrices: Record<string, number>;
    activePositions: any[];
    onRemoveSignal: (id: string) => void;
    actionConfig?: ActionConfig | null;
    onLog?: (type: any, message: string) => void;
}

export const BacktestMomentumAuditModule: React.FC<Props> = ({ candidates, setChartData, executeTradeSafe, list3Config, realPrices, activePositions, onRemoveSignal, actionConfig, onLog }) => {
    const { config, setConfig, results, removeItem, clearItems } = useBacktestMomentumAudit(candidates, list3Config, realPrices, executeTradeSafe, actionConfig, activePositions, onRemoveSignal);

    return (
        <List4_Momentum 
            config={config} 
            setConfig={setConfig} 
            list4={results} 
            list3Config={list3Config}
            setChartData={setChartData} 
            executeTradeSafe={executeTradeSafe}
            onRemoveItem={removeItem}
            onClearItems={clearItems}
        />
    );
};
