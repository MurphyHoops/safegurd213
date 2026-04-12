
import React from 'react';
import { useBacktestMomentumAudit } from './useBacktestMomentumAudit';
import { ScannerItem, List3Config } from '../../../components/Scanner/scannerTypes';
import List4_Momentum from '../../../components/Scanner/List4_Momentum';

interface Props {
    candidates: ScannerItem[];
    setChartData: (data: any) => void;
    executeTradeSafe: any;
    list3Config: List3Config | null;
    realPrices: Record<string, number>;
    activePositions: any[];
    onRemoveSignal: (id: string) => void;
}

export const BacktestMomentumAuditModule: React.FC<Props> = ({ candidates, setChartData, executeTradeSafe, list3Config, realPrices, activePositions, onRemoveSignal }) => {
    const { config, setConfig, results } = useBacktestMomentumAudit(candidates, list3Config, realPrices, executeTradeSafe);

    return (
        <List4_Momentum 
            config={config} 
            setConfig={setConfig} 
            list4={results} 
            list3Config={list3Config}
            setChartData={setChartData} 
            executeTradeSafe={executeTradeSafe}
        />
    );
};
