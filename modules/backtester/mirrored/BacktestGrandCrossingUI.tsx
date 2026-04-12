
import React from 'react';
import { useBacktestGrandCrossing } from './useBacktestGrandCrossing';
import { ScannerItem, List2Config } from '../../../components/Scanner/scannerTypes';
import List2_GrandCrossing from '../../../components/Scanner/List2_GrandCrossing';

interface Props {
    candidates: ScannerItem[];
    onResultsUpdate: (results: ScannerItem[]) => void;
    scanConfig: any;
    setScanConfig: any;
    setChartData: (data: any) => void;
    directMode?: boolean;
    onLog?: (type: any, msg: string) => void;
}

const DEFAULT_CONFIG: List2Config = {
    timeframes: ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h'],
    maxLag: 9,
    newModeRetention: 9,
    volMultiplier: 1.0,
    squeezeThreshold: 0.5,
    maxAmplitude: 50,
    minBodyRatio: 60,
    enableFlatFilter: true,
    flatLookback: 50,
    flatThreshold: 5,
    checkEma80Conflict: false,
    sortMode: 'MOST',
    triggerMode: 'NEW',
    requireCrossing: true,
    strictFiltering: false
};

export const BacktestGrandCrossingModule: React.FC<Props> = ({ candidates, onResultsUpdate, onLog, scanConfig, setScanConfig, setChartData }) => {
    const { config, setConfig, list2, status, scanText, countdowns } = useBacktestGrandCrossing(candidates, DEFAULT_CONFIG, onLog);

    React.useEffect(() => {
        onResultsUpdate(list2);
    }, [list2, onResultsUpdate]);

    return (
        <List2_GrandCrossing 
            config={config} 
            setConfig={setConfig} 
            scanConfig={scanConfig}
            setScanConfig={setScanConfig}
            countdowns={countdowns} 
            tfCounts={{}} 
            activeFilterTf={null}
            isLocked={false}
            onTfInteraction={() => {}}
            filteredList2={list2}
            setChartData={setChartData}
            pollingStatus={status === 'SCANNING' ? '正在扫描...' : '监控中'}
        />
    );
};
