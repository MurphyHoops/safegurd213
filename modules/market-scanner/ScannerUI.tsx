
import React, { useState, useEffect, useMemo } from 'react';
import { useScannerLogic } from './useScannerLogic';
import { ScanConfig, ScannerItem } from '../../components/Scanner/scannerTypes';
import List1_Selection from '../../components/Scanner/List1_Selection';

interface Props {
    // Callbacks to parent dashboard to maintain List 2-6 linkage
    onCandidatesUpdate: (candidates: ScannerItem[]) => void;
    directMode?: boolean;
}

export const MarketScannerModule: React.FC<Props> = ({ onCandidatesUpdate, directMode = false }) => {
    // --- LOCAL UI STATE ---
    const [fixedModeView, setFixedModeView] = useState<'MONITOR' | 'SEARCH'>('MONITOR');
    const [scanInterval, setScanInterval] = useState(1);
    const [activeMode, setActiveMode] = useState<'24H' | '8AM'>('24H');
    
    // --- CONFIG STATE (UI) ---
    const [config24H, setConfig24H] = useState<ScanConfig>({ timeBasis: '24H', source: 'BOTH', minVolume: 1, minChange: 1, customSymbols: '', useCustomOnly: false, batchSize: 40, limit: 600 });
    const [config8AM, setConfig8AM] = useState<ScanConfig>({ timeBasis: '8AM', source: 'GAINERS', minVolume: 1, minChange: 1, customSymbols: '', useCustomOnly: false, batchSize: 40, limit: 600 });
    
    const scanConfig = activeMode === '24H' ? config24H : config8AM;

    const setScanConfig = (update: React.SetStateAction<ScanConfig>) => {
        const next = typeof update === 'function' ? (update as any)(scanConfig) : update;
        if (next.timeBasis !== activeMode) setActiveMode(next.timeBasis as any);
        else activeMode === '24H' ? setConfig24H(next) : setConfig8AM(next);
    };

    // --- LOGIC HOOK ---
    const customSymbolSet = useMemo(() => new Set(scanConfig.customSymbols.split(',').map(s=>s.trim()).filter(Boolean)), [scanConfig.customSymbols]);
    
    const { 
        list1, isScanning, scanStatusText, marketStats, nextScanTime, setNextScanTime, refreshList1Candidates 
    } = useScannerLogic(scanConfig, customSymbolSet, directMode);

    // --- EFFECT: Sync with Legacy System ---
    useEffect(() => {
        onCandidatesUpdate(list1);
    }, [list1, onCandidatesUpdate]);

    // --- EFFECT: Interval ---
    useEffect(() => {
        const timer = setInterval(() => {
            if (!isScanning) refreshList1Candidates(scanConfig, false);
        }, scanInterval * 60 * 1000);
        setNextScanTime(Date.now() + scanInterval * 60 * 1000);
        return () => clearInterval(timer);
    }, [scanInterval, scanConfig, isScanning, refreshList1Candidates]);

    // --- HANDLERS ---
    const handleToggleSymbol = (symbol: string) => { 
        const raw = symbol.replace('USDT', ''); 
        const newSet = new Set(customSymbolSet); 
        if (newSet.has(raw)) newSet.delete(raw); else newSet.add(raw); 
        setScanConfig(p => ({ ...p, customSymbols: Array.from(newSet).join(', ') })); 
    };

    const handleScan = () => refreshList1Candidates(scanConfig, true);

    return (
        <List1_Selection 
            scanConfig={scanConfig} setScanConfig={setScanConfig} 
            isScanning={isScanning} scanStatusText={scanStatusText} 
            list1={list1} onScan={handleScan}
            fixedModeView={fixedModeView} setFixedModeView={setFixedModeView}
            scanInterval={scanInterval} setScanInterval={setScanInterval}
            customSymbolSet={customSymbolSet}
            onToggleSymbol={handleToggleSymbol} 
            onSelectAll={() => {}} // Simplified for atomic demo
            onDeselectAll={() => {}} 
            marketStats={marketStats}
            nextScanTime={nextScanTime}
        />
    );
};
