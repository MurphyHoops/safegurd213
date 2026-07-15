
import React, { useState, useEffect } from 'react';
import { useGrandCrossing } from './useGrandCrossing';
import { ScannerItem, ScanConfig, List2Config } from '../../components/Scanner/scannerTypes';
import List2_GrandCrossing from './components/List2_GrandCrossing';

interface Props {
    networkStatus?: 'healthy' | 'delayed' | 'disconnected';
    candidates: ScannerItem[]; // Input from List 1
    onResultsUpdate: (results: ScannerItem[]) => void; // Output to Dashboard -> List 3
    scanConfig: ScanConfig; // Just for display (batch size etc)
    setScanConfig: any;
    setChartData: (data: any) => void;
    
    // Initial Config
    initialConfig?: List2Config;
    directMode?: boolean;
    onLog?: (type: 'INFO' | 'SUCCESS' | 'WARNING' | 'DANGER', message: string) => void;
    onRemoveSignalReady?: (fn: (uniqueId: string) => void) => void;
    strategyId?: string;
}

const DEFAULT_CONFIG: List2Config = {
    timeframes: ['5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'],
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
    requireCrossing: true,
    requireAlignment: false,
    strictFiltering: true
};

export const GrandCrossingModule: React.FC<Props> = ({ 
    networkStatus, candidates, onResultsUpdate, scanConfig, setScanConfig, setChartData, initialConfig, directMode = false, onLog, onRemoveSignalReady, strategyId
}) => {
    
    // --- FILTER CANDIDATES TO COMPLY WITH USER WATCHLIST INTENT ---
    // If useCustomOnly (固定选币) is active, List 2 MUST strictly scan ONLY the user's custom symbols (监控池)
    // even if the user switches List 1 to "市场搜索" (SEARCH) tab.
    const effectiveCandidates = React.useMemo(() => {
        if (scanConfig.useCustomOnly) {
            const customSet = new Set(
                (scanConfig.customSymbols || '')
                    .split(',')
                    .map(s => s.trim().toUpperCase())
                    .filter(Boolean)
                    .map(s => s.endsWith('USDT') ? s : `${s}USDT`)
            );
            return candidates.filter(c => customSet.has(c.symbol.toUpperCase()));
        }
        return candidates;
    }, [candidates, scanConfig.useCustomOnly, scanConfig.customSymbols]);

    // --- LOGIC HOOK ---
    const { 
        config, setConfig, list2, status, scanText, countdowns, tfCounts, activeScanTfs, lastScanTime, removeItem, clearItems, removeSignal
    } = useGrandCrossing(effectiveCandidates, initialConfig || DEFAULT_CONFIG, directMode, onLog, strategyId);

    // Expose removeSignal to parent
    useEffect(() => {
        if (onRemoveSignalReady && removeSignal) {
            onRemoveSignalReady(removeSignal);
        }
    }, [onRemoveSignalReady, removeSignal]);

    // --- SYNC OUTPUT ---
    const lastListStrRef = React.useRef<string>('');
    useEffect(() => {
        const str = JSON.stringify(list2);
        if (str !== lastListStrRef.current) {
            lastListStrRef.current = str;
            onResultsUpdate(list2);
        }
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
            networkStatus={networkStatus}
            config={config} setConfig={setConfig}
            scanConfig={scanConfig} setScanConfig={setScanConfig}
            countdowns={countdowns} tfCounts={tfCounts}
            activeFilterTf={activeFilterTf} isLocked={isLocked}
            onTfInteraction={handleTfInteraction}
            filteredList2={filteredList}
            setChartData={setChartData}
            pollingStatus={status === 'SCANNING' ? scanText : (lastScanTime ? `最后扫描: ${new Date(lastScanTime).toLocaleTimeString()}` : undefined)}
            activeScanTfs={activeScanTfs}
            onRemoveItem={removeItem}
            onClearItems={clearItems}
        />
    );
};
