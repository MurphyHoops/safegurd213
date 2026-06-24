
import React, { useEffect, useRef } from 'react';
import { useStructureAudit } from './useStructureAudit';
import { ScannerItem, List3Config, ActionConfig } from '../../components/Scanner/scannerTypes';
import { PositionSide, Position } from '../../types';
import List3_Structure from './components/List3_Structure';

interface Props {
    candidates: ScannerItem[]; // From List 2
    onResultsUpdate: (results: ScannerItem[]) => void; // To List 4
    onConfigUpdate: (config: List3Config) => void; // Sync config to Parent
    onRemoveSignalReady?: (fn: (uniqueId: string) => void) => void;
    realPrices: Record<string, number>;
    setChartData: (data: any) => void;
    executeTradeSafe: (symbol: string, side: PositionSide, price: number, reason: string, signalTf?: string, signalCandle?: any, entryEmas?: any) => boolean;
    activePositions: Position[];
    directMode?: boolean;
    actionConfig?: ActionConfig | null;
}

const DEFAULT_CONFIG: List3Config = { 
    timeframes: ['5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'], 
    enableAmplitudeAudit: true,
    enableMultiResonance: false,
    minResonanceCount: 2,
    strictTrend: true,
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
    enableRsi: true,
    autoSimOpen: false
};

export const StructureAuditModule: React.FC<Props> = ({ candidates, onResultsUpdate, onConfigUpdate, onRemoveSignalReady, realPrices, setChartData, executeTradeSafe, activePositions, directMode = false, actionConfig }) => {
    
    const { config, setConfig, list3, isScanning, scanStatus, countdowns, removeSignal, removeItem, clearItems } = useStructureAudit(candidates, DEFAULT_CONFIG, realPrices, directMode);
    
    // Expose removeSignal to parent
    useEffect(() => {
        if (onRemoveSignalReady) {
            onRemoveSignalReady(removeSignal);
        }
    }, [onRemoveSignalReady, removeSignal]);
    
    // Fix: Store previous config string to prevent infinite loops
    const prevConfigStrRef = useRef('');

    // Sync Output
    const lastListStrRef = useRef<string>('');
    useEffect(() => {
        const str = JSON.stringify(list3);
        if (str !== lastListStrRef.current) {
            onResultsUpdate(list3);
            lastListStrRef.current = str;
        }
    }, [list3, onResultsUpdate]);

    // Sync Config (SAFE VERSION)
    useEffect(() => {
        const str = JSON.stringify(config);
        if (str !== prevConfigStrRef.current) {
            prevConfigStrRef.current = str;
            onConfigUpdate(config);
        }
    }, [config, onConfigUpdate]);

    return (
        <List3_Structure 
            config={config} 
            setConfig={setConfig} 
            countdowns={countdowns} 
            list3={list3} 
            setChartData={setChartData} 
            executeTradeSafe={executeTradeSafe} 
            actionConfig={actionConfig || ({ enabled: false } as any)} 
            scanningStatus={scanStatus}
            activePositions={activePositions}
            onRemoveItem={removeItem}
            onClearItems={clearItems}
        />
    );
};
