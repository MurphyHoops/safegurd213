
import { useState, useRef, useEffect, useCallback } from 'react';
import { ScanConfig, ScannerItem } from '../../../components/Scanner/scannerTypes';
import { processMarketData } from '../../../services/rules/list1_market';
import { useBacktest } from '../BacktestContext';
import { fetchWithFallback } from '../../../services/apiService';

export const useBacktestScannerLogic = (
    initialConfig: ScanConfig, 
    customSymbolSet: Set<string>,
    fixedModeView: 'MONITOR' | 'SEARCH',
    directMode: boolean = false,
    useRealData: boolean = false
) => {
    const backtest = useBacktest();
    const fetchVirtualMarketData = backtest?.fetchVirtualMarketData;
    const virtualTime = backtest?.virtualTime;
    const isPlaying = backtest?.isPlaying;
    
    const [list1, setList1] = useState<ScannerItem[]>([]);
    const [isScanning, setIsScanning] = useState(false);
    const [scanStatusText, setScanStatusText] = useState('系统就绪');
    const [marketStats, setMarketStats] = useState({ up: 0, down: 0, total: 0, btcChange: 0 });
    const [nextScanTime, setNextScanTime] = useState<number>(0);
    
    const list1Ref = useRef<ScannerItem[]>([]);
    const rawDataRef = useRef<any[]>([]);

    // Re-filter when virtual time changes (simulating real-time updates)
    useEffect(() => {
        if (isPlaying && virtualTime !== undefined) {
            refreshList1Candidates(initialConfig, false);
        }
    }, [virtualTime, isPlaying, initialConfig]);

    const refreshList1Candidates = useCallback(async (currentConfig: ScanConfig, forceFull = false) => {
        if (forceFull) {
            setIsScanning(true);
            setScanStatusText("正在获取行情数据...");
        }

        try {
            let data: any[];
            // If backtest is playing, ALWAYS use virtual data.
            // If not playing, use real data if requested (for symbol selection).
            if (isPlaying) {
                data = fetchVirtualMarketData ? await fetchVirtualMarketData() : [];
            } else if (useRealData) {
                const baseUrl = 'https://fapi.binance.com/fapi/v1/ticker/24hr';
                const res = await fetchWithFallback(baseUrl, { cache: 'no-store' }, (d) => Array.isArray(d) && d.length > 0, directMode);
                data = await res.json();
            } else if (fetchVirtualMarketData) {
                data = await fetchVirtualMarketData();
            } else {
                data = [];
            }

            rawDataRef.current = data;
            
            const { list1: filtered, stats } = processMarketData(data, currentConfig, customSymbolSet, fixedModeView);
            
            setMarketStats(stats);
            setList1(filtered);
            list1Ref.current = filtered;
            
            if (forceFull) {
                setScanStatusText(filtered.length > 0 ? `行情就绪 (${filtered.length}个)` : "无符合条件的币种");
                setIsScanning(false);
            }
        } catch (e) {
            console.error("[Backtest Scanner] Fetch Failed:", e);
            setIsScanning(false);
        }
    }, [fetchVirtualMarketData, customSymbolSet, fixedModeView, useRealData, directMode]);

    useEffect(() => {
        if (useRealData) {
            refreshList1Candidates(initialConfig, true);
        }
    }, [useRealData]);

    return {
        list1,
        isScanning,
        scanStatusText,
        marketStats,
        nextScanTime,
        setNextScanTime,
        refreshList1Candidates,
        cancelScan: () => setIsScanning(false),
        addToBlacklist: () => {},
        removeFromBlacklist: () => {},
        clearBlacklist: () => {},
        list1Ref
    };
};
