
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { usePersistedState } from '../../../hooks/usePersistedState';
import { useBacktestScannerLogic } from './useBacktestScannerLogic';
import { ScanConfig, ScannerItem } from '../../../components/Scanner/scannerTypes';
import List1_Selection from '../../market-scanner/components/List1_Selection';
import { Play, Download, Loader2 } from 'lucide-react';
import { backtestDownloader } from '../../../services/backtest/downloader';

interface Props {
    onCandidatesUpdate: (candidates: ScannerItem[]) => void;
    setChartData: (data: any) => void;
    directMode?: boolean;
    scanConfig: ScanConfig;
    setScanConfig: React.Dispatch<React.SetStateAction<ScanConfig>>;
    onStartBacktest?: (symbols: string[]) => void;
    isSyncing?: boolean;
    mode?: 'LIVE' | 'BACKTEST';
    setMode?: (mode: 'LIVE' | 'BACKTEST') => void;
    backtestProps?: any;
}

export const BacktestMarketScannerModule: React.FC<Props> = ({ 
    onCandidatesUpdate, 
    setChartData, 
    directMode = false,
    scanConfig,
    setScanConfig,
    onStartBacktest,
    isSyncing = false,
    mode,
    setMode,
    backtestProps
}) => {
    const [fixedModeView, setFixedModeView] = usePersistedState<'MONITOR' | 'SEARCH'>('SCANNER_FIXED_MODE_VIEW', 'MONITOR');
    const [scanInterval, setScanInterval] = usePersistedState('SCANNER_INTERVAL', 1);
    const [isPaused, setIsPaused] = useState(false);
    const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set());
    const [downloadProgressMap, setDownloadProgressMap] = useState<Record<string, number>>({});
    
    const customSymbolSet = useMemo(() => new Set((typeof scanConfig.customSymbols === 'string' ? scanConfig.customSymbols : '').split(',').map(s=>s.trim()).filter(Boolean)), [scanConfig.customSymbols]);
    
    const { 
        list1, isScanning, scanStatusText, marketStats, nextScanTime, setNextScanTime, refreshList1Candidates, cancelScan
    } = useBacktestScannerLogic(scanConfig, customSymbolSet, fixedModeView, directMode, onStartBacktest !== undefined);

    const lastListStrRef = React.useRef<string>('');
    useEffect(() => {
        const str = JSON.stringify(list1);
        if (str !== lastListStrRef.current) {
            lastListStrRef.current = str;
            onCandidatesUpdate(list1);
        }
    }, [list1, onCandidatesUpdate]);

    const handleToggleSymbol = useCallback((symbol: string) => {
        setSelectedSymbols(prev => {
            const next = new Set(prev);
            if (next.has(symbol)) next.delete(symbol);
            else next.add(symbol);
            return next;
        });
    }, []);

    const handleSelectAll = useCallback(() => {
        setSelectedSymbols(new Set(list1.map(i => i.symbol)));
    }, [list1]);

    const handleDeselectAll = useCallback(() => {
        setSelectedSymbols(new Set());
    }, []);

    const handleDownload = useCallback(async (symbol: string) => {
        const intervals = ['1m', '5m', '15m', '1h'];
        const endTs = Date.now();
        const startTs = endTs - 7 * 24 * 60 * 60 * 1000; // 7 days

        setDownloadProgressMap(prev => ({ ...prev, [symbol]: 0 }));
        
        try {
            // Parallelize intervals for faster single-symbol sync
            const intervalProgress: Record<string, number> = {};
            
            await Promise.all(intervals.map(async (interval) => {
                await backtestDownloader.downloadHistoricalData(symbol, interval, startTs, endTs, (p) => {
                    intervalProgress[interval] = p;
                    const totalP = Object.values(intervalProgress).reduce((a, b) => a + b, 0) / intervals.length;
                    setDownloadProgressMap(prev => ({ ...prev, [symbol]: totalP }));
                }, directMode);
            }));

            // Finished
            setTimeout(() => {
                setDownloadProgressMap(prev => {
                    const next = { ...prev };
                    delete next[symbol];
                    return next;
                });
            }, 2000);
        } catch (err) {
            console.error(`Download failed for ${symbol}:`, err);
            setDownloadProgressMap(prev => {
                const next = { ...prev };
                delete next[symbol];
                return next;
            });
        }
    }, []);

    return (
        <div className="flex flex-col h-full relative">
            <List1_Selection 
                scanConfig={scanConfig} setScanConfig={setScanConfig} 
                isScanning={isScanning} scanStatusText={scanStatusText} 
                list1={list1} onScan={() => refreshList1Candidates(scanConfig, true)}
                isPaused={isPaused} setIsPaused={setIsPaused}
                fixedModeView={fixedModeView} setFixedModeView={setFixedModeView}
                scanInterval={scanInterval} setScanInterval={setScanInterval}
                customSymbolSet={selectedSymbols} // Use selectedSymbols for UI highlighting
                onToggleSymbol={handleToggleSymbol} 
                onSelectAll={handleSelectAll}
                onDeselectAll={handleDeselectAll} 
                onDeleteSymbol={() => {}}
                onClearBlacklist={() => {}}
                marketStats={marketStats}
                nextScanTime={nextScanTime}
                setChartData={setChartData}
                mode="BACKTEST"
                downloadProgressMap={downloadProgressMap}
                onDownload={handleDownload}
                // New Props
                scannerMode={mode}
                setScannerMode={setMode}
                backtestProps={backtestProps}
            />
            
            {onStartBacktest && selectedSymbols.size > 0 && (
                <div className="absolute bottom-4 left-4 right-4 animate-in slide-in-from-bottom-4">
                    <button 
                        onClick={() => onStartBacktest(Array.from(selectedSymbols))}
                        disabled={isSyncing}
                        className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold text-sm flex items-center justify-center gap-2 shadow-xl shadow-indigo-900/40 transition-all border border-indigo-400/30"
                    >
                        {isSyncing ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
                        {isSyncing ? '正在同步并启动...' : `同步并开始回测 (${selectedSymbols.size}个币)`}
                    </button>
                </div>
            )}
        </div>
    );
};
