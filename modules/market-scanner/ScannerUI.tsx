
import React, { useState, useEffect, useMemo } from 'react';
import { usePersistedState } from '../../hooks/usePersistedState';
import { useScannerLogic } from './useScannerLogic';
import { ScanConfig, ScannerItem } from '../../components/Scanner/scannerTypes';
import List1_Selection from '../../components/Scanner/List1_Selection';

import { BacktestMarketScannerModule } from '../backtester/mirrored/BacktestScannerUI';

interface Props {
    onCandidatesUpdate: (candidates: ScannerItem[]) => void;
    setChartData: (data: any) => void;
    directMode?: boolean;
    scanConfig: ScanConfig;
    setScanConfig: React.Dispatch<React.SetStateAction<ScanConfig>>;
    mode?: 'LIVE' | 'BACKTEST';
    onStartBacktest?: (symbols: string[]) => void;
    isSyncing?: boolean;
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
    isSyncing = false
}) => {
    // --- LOCAL UI STATE ---
    const [fixedModeView, setFixedModeView] = usePersistedState<'MONITOR' | 'SEARCH'>('SCANNER_FIXED_MODE_VIEW', 'MONITOR');
    const [scanInterval, setScanInterval] = usePersistedState('SCANNER_INTERVAL', 1);
    const [isPaused, setIsPaused] = useState(false);
    
    // --- LOGIC HOOK ---
    const customSymbolSet = useMemo(() => new Set((typeof scanConfig.customSymbols === 'string' ? scanConfig.customSymbols : '').split(',').map(s=>s.trim()).filter(Boolean)), [scanConfig.customSymbols]);
    
    // --- LIVE MODE LOGIC ---
    const { 
        list1, isScanning, scanStatusText, marketStats, nextScanTime, setNextScanTime, refreshList1Candidates, cancelScan,
        addToBlacklist, clearBlacklist
    } = useScannerLogic(scanConfig, customSymbolSet, fixedModeView, directMode);

    // --- EFFECT: Sync with Legacy System ---
    useEffect(() => {
        onCandidatesUpdate(list1);
    }, [list1, onCandidatesUpdate]);

    // --- EFFECT: Initial Scan ---
    useEffect(() => {
        refreshList1Candidates(scanConfig, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // --- EFFECT: Interval ---
    useEffect(() => {
        if (isPaused) {
            setNextScanTime(0);
            return;
        }
        const timer = setInterval(() => {
            if (!isScanning) refreshList1Candidates(scanConfig, false);
            setNextScanTime(Date.now() + scanInterval * 60 * 1000);
        }, scanInterval * 60 * 1000);
        setNextScanTime(Date.now() + scanInterval * 60 * 1000);
        return () => clearInterval(timer);
    }, [scanInterval, scanConfig, isScanning, refreshList1Candidates, setNextScanTime, isPaused]);

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
        />
    );
};
