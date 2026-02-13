
import React, { useEffect } from 'react';
import { useStructureAudit } from './useStructureAudit';
import { ScannerItem, List3Config } from '../../components/Scanner/scannerTypes';
import { PositionSide } from '../../types';
import List3_Structure from '../../components/Scanner/List3_Structure';

interface Props {
    candidates: ScannerItem[]; // From List 2
    onResultsUpdate: (results: ScannerItem[]) => void; // To List 4
    onConfigUpdate: (config: List3Config) => void; // Sync config to Parent
    realPrices: Record<string, number>;
    setChartData: (data: any) => void;
    executeTradeSafe: (symbol: string, side: PositionSide, price: number, reason: string, signalTf?: string) => void;
}

const DEFAULT_CONFIG: List3Config = { 
    timeframes: ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h'], 
    enableThrust: false, 
    enableResonance: false, 
    strictTrend: true, // Default to TRUE
    checkCandleColor: false, 
    maxBBW: 1.0, 
    validityPeriod: 5, 
    sameColorCross: false, 
    lookback: 80, 
    minCrossCount: 0, 
    maxLocation: 100, 
    rsiLongMin: 40, 
    rsiLongMax: 90, 
    rsiShortMin: 10, 
    rsiShortMax: 60, 
    autoSimOpen: false, 
    antiChase: { enabled: true, maxRise: 100, maxFall: 50 }
};

export const StructureAuditModule: React.FC<Props> = ({ candidates, onResultsUpdate, onConfigUpdate, realPrices, setChartData, executeTradeSafe }) => {
    
    const { config, setConfig, list3, isScanning, scanStatus, countdowns } = useStructureAudit(candidates, DEFAULT_CONFIG, realPrices);

    // Sync Output
    useEffect(() => {
        onResultsUpdate(list3);
    }, [list3, onResultsUpdate]);

    // Sync Config (Crucial Fix)
    useEffect(() => {
        onConfigUpdate(config);
    }, [config, onConfigUpdate]);

    return (
        <List3_Structure 
            config={config} 
            setConfig={setConfig} 
            countdowns={countdowns} 
            list3={list3} 
            setChartData={setChartData} 
            executeTradeSafe={executeTradeSafe} 
            actionConfig={{ enabled: false } as any} // Dummy pass
            scanningStatus={scanStatus}
        />
    );
};
