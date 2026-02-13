
import React, { useState, useEffect } from 'react';
import { useGrandCrossing } from './useGrandCrossing';
import { ScannerItem, ScanConfig, List2Config } from '../../components/Scanner/scannerTypes';
import List2_GrandCrossing from '../../components/Scanner/List2_GrandCrossing';

interface Props {
    candidates: ScannerItem[]; // Input from List 1
    onResultsUpdate: (results: ScannerItem[]) => void; // Output to Dashboard -> List 3
    scanConfig: ScanConfig; // Just for display (batch size etc)
    setScanConfig: any;
    setChartData: (data: any) => void;
    
    // Initial Config
    initialConfig?: List2Config;
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
    checkEma80Conflict: true,
    sortMode: 'MOST',
    triggerMode: 'NEW'
};

export const GrandCrossingModule: React.FC<Props> = ({ 
    candidates, onResultsUpdate, scanConfig, setScanConfig, setChartData, initialConfig 
}) => {
    
    // --- LOGIC HOOK ---
    const { 
        config, setConfig, list2, status, scanText, countdowns, tfCounts, activeScanTfs
    } = useGrandCrossing(candidates, initialConfig || DEFAULT_CONFIG);

    // --- SYNC OUTPUT ---
    useEffect(() => {
        onResultsUpdate(list2);
    }, [list2, onResultsUpdate]);

    // --- LOCAL UI STATE ---
    const [activeFilterTf, setActiveFilterTf] = useState<string | null>(null);
    const [isLocked, setIsLocked] = useState(false);

    // --- HANDLERS ---
    const handleTfInteraction = (tf: string, type: 'SINGLE' | 'LONG_2' | 'LONG_3' | 'RESET') => {
        if (type === 'RESET') { 
            setActiveFilterTf(null); 
            setIsLocked(false); 
        } else if (type === 'SINGLE') {
            // Toggle timeframe activation in config
            setConfig(p => ({
                ...p, 
                timeframes: p.timeframes.includes(tf) 
                    ? p.timeframes.filter(t => t !== tf) 
                    : [...p.timeframes, tf]
            }));
        } else if (type === 'LONG_3') { 
            setActiveFilterTf(tf); 
            setIsLocked(true); 
        } else if (type === 'LONG_2') { 
            setActiveFilterTf(activeFilterTf === tf ? null : tf); 
            setIsLocked(false); 
        }
    };

    // Filter list for display
    const filteredList = activeFilterTf 
        ? list2.filter(item => item.groupedResults?.some(r => r.tf === activeFilterTf))
        : list2;

    return (
        <List2_GrandCrossing 
            config={config} setConfig={setConfig}
            scanConfig={scanConfig} setScanConfig={setScanConfig}
            countdowns={countdowns} tfCounts={tfCounts}
            activeFilterTf={activeFilterTf} isLocked={isLocked}
            onTfInteraction={handleTfInteraction}
            filteredList2={filteredList}
            setChartData={setChartData}
            pollingStatus={status === 'SCANNING' ? scanText : undefined}
            activeScanTfs={activeScanTfs}
        />
    );
};
