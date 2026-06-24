
import React, { useState, useEffect, useMemo } from 'react';
import { usePersistedState } from '../../hooks/usePersistedState';
import { useScannerLogic } from './useScannerLogic';
import { ScanConfig, ScannerItem } from '../../components/Scanner/scannerTypes';
import List1_Selection from './components/List1_Selection';

import { BacktestMarketScannerModule } from '../backtester/mirrored/BacktestScannerUI';

interface Props {
    onCandidatesUpdate: (candidates: ScannerItem[]) => void;
    setChartData: (data: any) => void;
    directMode?: boolean;
    scanConfig: ScanConfig;
    setScanConfig: React.Dispatch<React.SetStateAction<ScanConfig>>;
    mode?: 'LIVE' | 'BACKTEST' | 'SMART';
    setMode?: (mode: 'LIVE' | 'BACKTEST' | 'SMART') => void;
    onStartBacktest?: (symbols: string[]) => void;
    isSyncing?: boolean;
    // Backtest Controls
    backtestProps?: any;
}

export const MarketScannerModule: React.FC<Props> = (props) => {
    // If mode is BACKTEST, render the mirrored module directly
    if (props.mode === 'BACKTEST') {
        return (
            <BacktestMarketScannerModule 
                onCandidatesUpdate={props.onCandidatesUpdate}
                setChartData={props.setChartData}
                directMode={props.directMode}
                scanConfig={props.scanConfig}
                setScanConfig={props.setScanConfig}
                onStartBacktest={props.onStartBacktest}
                isSyncing={props.isSyncing}
                mode={props.mode}
                setMode={props.setMode}
                backtestProps={props.backtestProps}
            />
        );
    }

    return <LiveMarketScannerModule {...props} />;
};

const LiveMarketScannerModule: React.FC<Props> = ({ 
    onCandidatesUpdate, 
    setChartData, 
    directMode = false,
    scanConfig,
    setScanConfig,
    isSyncing = false,
    mode,
    setMode,
    backtestProps
}) => {
    // --- LOCAL UI STATE ---
    const [fixedModeView, setFixedModeView] = usePersistedState<'MONITOR' | 'SEARCH'>('SCANNER_FIXED_MODE_VIEW', 'MONITOR');
    const [scanInterval, setScanInterval] = usePersistedState('SCANNER_INTERVAL', 1);
    const [isPaused, setIsPaused] = useState(false);
    
    // Ref to track transferred symbols to prevent infinite loops
    const transferredSymbolsRef = React.useRef(new Set<string>());
    
    // --- LOGIC HOOK ---
    const customSymbolSet = useMemo(() => {
        const rawSyms = typeof scanConfig.customSymbols === 'string' ? scanConfig.customSymbols : '';
        return new Set(rawSyms.toUpperCase().split(',').map(s => s.trim()).filter(Boolean));
    }, [scanConfig.customSymbols]);
    
    // --- LIVE MODE LOGIC ---
    const { 
        list1, isScanning, scanStatusText, marketStats, nextScanTime, setNextScanTime, refreshList1Candidates, cancelScan,
        addToBlacklist, clearBlacklist,
        majorTrendCandidates, isMajorScanning, majorProgress, runMajorTrendDiscovery
    } = useScannerLogic(scanConfig, customSymbolSet, fixedModeView, directMode, mode);

    // --- EFFECT: Auto Transfer to Watchlist ---
    useEffect(() => {
        if (scanConfig.majorTrend?.enabled && scanConfig.majorTrend?.autoTransfer && majorTrendCandidates && majorTrendCandidates.size > 0) {
            const candidatesList = Array.from(majorTrendCandidates).map(s => s.replace('USDT', ''));
            const currentSymbols = (scanConfig.customSymbols || '').split(',').map(s => s.trim()).filter(Boolean);
            const currentSet = new Set(currentSymbols);
            
            let addedCount = 0;
            candidatesList.forEach(sym => {
                if (!currentSet.has(sym) && !transferredSymbolsRef.current.has(sym)) {
                    currentSet.add(sym);
                    transferredSymbolsRef.current.add(sym);
                    addedCount++;
                }
            });
            
            if (addedCount > 0) {
                const updatedSymbols = Array.from(currentSet).join(', ');
                setScanConfig(p => ({
                    ...p,
                    customSymbols: updatedSymbols
                }));
                console.log(`[Auto Transfer] Added ${addedCount} discovered symbols to Watchlist:`, candidatesList);
            }
        }
    }, [majorTrendCandidates, scanConfig.majorTrend?.enabled, scanConfig.majorTrend?.autoTransfer, scanConfig.customSymbols, setScanConfig]);

    // --- EFFECT: Sync with Legacy System ---
    const lastListStrRef = React.useRef<string>('');
    useEffect(() => {
        const str = JSON.stringify(list1);
        if (str !== lastListStrRef.current) {
            lastListStrRef.current = str;
            onCandidatesUpdate(list1);
        }
    }, [list1, onCandidatesUpdate]);

    // --- EFFECT: Initial Scan ---
    useEffect(() => {
        refreshList1Candidates(scanConfig, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // --- EFFECT: Interval ---
    const isScanningRef = React.useRef(isScanning);
    useEffect(() => { isScanningRef.current = isScanning; }, [isScanning]);

    useEffect(() => {
        if (isPaused) {
            setNextScanTime(0);
            return;
        }

        const intervalMs = scanInterval * 60 * 1000;
        
        const tick = () => {
            if (!isScanningRef.current) {
                console.log("[ScannerUI] Auto-refresh tick.");
                refreshList1Candidates(scanConfig, false);
            }
            // Update next scan time after refresh
            setNextScanTime(Date.now() + intervalMs);
        };

        const timer = setInterval(tick, intervalMs);
        
        // Only set initial next scan time if it's currently 0 or past
        setNextScanTime(prev => {
            if (prev <= Date.now()) return Date.now() + intervalMs;
            return prev;
        });
        
        return () => clearInterval(timer);
    }, [scanInterval, scanConfig, refreshList1Candidates, isPaused]);

    // --- HANDLERS ---
    const handleToggleSymbol = (symbol: string) => { 
        const raw = symbol.replace('USDT', ''); 
        const newSet = new Set(customSymbolSet); 
        if (newSet.has(raw)) newSet.delete(raw); else newSet.add(raw); 
        setScanConfig(p => ({ ...p, customSymbols: Array.from(newSet).join(', ') })); 
    };

    const handleSelectAll = () => {
        const newSet = new Set(customSymbolSet);
        list1.forEach(item => newSet.add(item.symbol.replace('USDT', '')));
        setScanConfig(p => ({ ...p, customSymbols: Array.from(newSet).join(', ') }));
    };

    const handleDeselectAll = () => {
        const newSet = new Set(customSymbolSet);
        list1.forEach(item => newSet.delete(item.symbol.replace('USDT', '')));
        setScanConfig(p => ({ ...p, customSymbols: Array.from(newSet).join(', ') }));
    };

    const handleScan = () => {
        if (isScanning) {
            cancelScan();
            setIsPaused(true);
        } else {
            setIsPaused(false);
            refreshList1Candidates(scanConfig, true);
        }
    };

    const handleDeleteSymbol = (symbol: string) => {
        if (!symbol) return;
        
        // 1. Add to blacklist in hook
        addToBlacklist(symbol);
        
        // 2. Remove from custom symbols if it's there
        const raw = symbol.replace('USDT', '');
        if (scanConfig.customSymbols && typeof scanConfig.customSymbols === 'string') {
            const symbols = scanConfig.customSymbols.split(',').map(s => s.trim()).filter(Boolean);
            if (symbols.includes(raw)) {
                const updated = symbols.filter(s => s !== raw).join(', ');
                setScanConfig(p => ({ ...p, customSymbols: updated }));
            }
        } else if (customSymbolSet.has(raw)) {
            const newSet = new Set(customSymbolSet);
            newSet.delete(raw);
            setScanConfig(p => ({ ...p, customSymbols: Array.from(newSet).join(', ') }));
        }
    };

    return (
        <List1_Selection 
            scanConfig={scanConfig} setScanConfig={setScanConfig} 
            isScanning={isScanning} scanStatusText={isPaused ? "已暂停 (点击恢复)" : scanStatusText} 
            list1={list1} onScan={handleScan}
            isPaused={isPaused} setIsPaused={setIsPaused}
            fixedModeView={fixedModeView} setFixedModeView={setFixedModeView}
            scanInterval={scanInterval} setScanInterval={setScanInterval}
            customSymbolSet={customSymbolSet}
            onToggleSymbol={handleToggleSymbol} 
            onSelectAll={handleSelectAll}
            onDeselectAll={handleDeselectAll} 
            onDeleteSymbol={handleDeleteSymbol}
            onClearBlacklist={clearBlacklist}
            marketStats={marketStats}
            nextScanTime={nextScanTime}
            setChartData={setChartData}
            scannerMode={mode}
            setScannerMode={setMode}
            majorTrendCandidates={majorTrendCandidates}
            isMajorScanning={isMajorScanning}
            majorProgress={majorProgress}
            runMajorTrendDiscovery={runMajorTrendDiscovery}
            backtestProps={backtestProps}
        />
    );
};
