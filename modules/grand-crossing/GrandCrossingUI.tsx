
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
    isBackground?: boolean;
}

const DEFAULT_CONFIG: List2Config = {
    timeframes: ['15s', '30s', '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'],
    newModeRetention: 9,
    lookbackBars: 5,
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
    crossingDivergenceLogic: 'AND',
    enableDivergenceCrossCheck: true,
    divergenceLookbackBars: 20,
    enableSignalDeviationFilter: false,
    maxSignalDeviationPercent: 50,
    strictFiltering: true,
    viewMode: 'ALL',
    syncDirectionFilterToList3: false
};

export const GrandCrossingModule: React.FC<Props> = ({ 
    networkStatus, candidates, onResultsUpdate, scanConfig, setScanConfig, setChartData, initialConfig, directMode = false, onLog, onRemoveSignalReady, strategyId, isBackground = false
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
        config, setConfig, list2, status, scanText, countdowns, tfCounts, activeScanTfs, scanningSymbols, lastScanTime, removeItem, clearItems, removeSignal
    } = useGrandCrossing(effectiveCandidates, initialConfig || DEFAULT_CONFIG, directMode, onLog, strategyId);

    // Expose removeSignal to parent
    useEffect(() => {
        if (onRemoveSignalReady && removeSignal) {
            onRemoveSignalReady(removeSignal);
        }
    }, [onRemoveSignalReady, removeSignal]);

    // --- SYNC OUTPUT (Only closed K-line signals pass to List 3) ---
    const lastListStrRef = React.useRef<string>('');
    useEffect(() => {
        let outputList = list2 || [];

        // 🔒 [USER MANDATORY RULE] 列表3在读取列表2的数据必须是K线已收盘的币种 (lag >= 1 且 非灰色待定态)
        outputList = outputList.filter(item => {
            if (!item || !item.groupedResults || item.groupedResults.length === 0) return false;
            return item.groupedResults.some(r => {
                const isClosed = r.isClosed === true || (r.lag !== undefined && r.lag >= 1.0);
                const notGray = !r.isPendingGray;
                return isClosed && notGray;
            });
        });

        if (config?.syncDirectionFilterToList3) {
            const dir = config.viewMode || 'ALL';
            if (dir === 'LONG') {
                outputList = outputList.filter(item => item && item.direction === 'LONG');
            } else if (dir === 'SHORT') {
                outputList = outputList.filter(item => item && item.direction === 'SHORT');
            }
        }
        const str = JSON.stringify(outputList);
        if (str !== lastListStrRef.current) {
            lastListStrRef.current = str;
            setTimeout(() => {
                onResultsUpdate(outputList);
            }, 0);
        }
    }, [list2, config?.syncDirectionFilterToList3, config?.viewMode, onResultsUpdate]);

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
    let filteredList = activeFilterTf 
        ? list2.filter(item => item.groupedResults?.some(r => r.tf === activeFilterTf))
        : list2;

    const viewMode = config?.viewMode || 'ALL';
    if (viewMode === 'LONG') {
        filteredList = filteredList.map(item => {
            const longResults = (item.groupedResults || []).filter(r => r.direction === 'LONG');
            return {
                ...item,
                direction: 'LONG' as const,
                groupedResults: longResults
            };
        }).filter(item => item.groupedResults && item.groupedResults.length > 0);
    } else if (viewMode === 'SHORT') {
        filteredList = filteredList.map(item => {
            const shortResults = (item.groupedResults || []).filter(r => r.direction === 'SHORT');
            return {
                ...item,
                direction: 'SHORT' as const,
                groupedResults: shortResults
            };
        }).filter(item => item.groupedResults && item.groupedResults.length > 0);
    }

    if (isBackground) {
        return null;
    }

    return (
        <List2_GrandCrossing 
            networkStatus={networkStatus}
            config={config} setConfig={setConfig}
            scanConfig={scanConfig} setScanConfig={setScanConfig}
            countdowns={countdowns} tfCounts={tfCounts}
            activeFilterTf={activeFilterTf} isLocked={isLocked}
            onTfInteraction={handleTfInteraction}
            filteredList2={filteredList}
            allList2={list2}
            setChartData={setChartData}
            pollingStatus={status === 'SCANNING' ? scanText : (lastScanTime ? `最后扫描: ${new Date(lastScanTime).toLocaleTimeString()}` : undefined)}
            activeScanTfs={activeScanTfs}
            scanningSymbols={scanningSymbols}
            onRemoveItem={removeItem}
            onClearItems={clearItems}
        />
    );
};
