
import { useState, useRef, useEffect, useCallback } from 'react';
import { ScanConfig, ScannerItem } from '../../components/Scanner/scannerTypes';
import { processMarketData } from '../../services/rules/list1_market';
import { fetchWithFallback } from '../../services/apiService';
import { audioService } from '../../services/audioService';

export const useScannerLogic = (
    initialConfig: ScanConfig, 
    customSymbolSet: Set<string>,
    directMode: boolean = false
) => {
    // --- ATOMIC STATE ---
    const [list1, setList1] = useState<ScannerItem[]>([]);
    const [isScanning, setIsScanning] = useState(false);
    const [scanStatusText, setScanStatusText] = useState('系统就绪');
    const [marketStats, setMarketStats] = useState({ up: 0, down: 0, total: 0, btcChange: 0 });
    const [nextScanTime, setNextScanTime] = useState<number>(0);
    
    // --- REFS (For logic continuity) ---
    const scanSessionIdRef = useRef<number>(0);
    const list1Ref = useRef<ScannerItem[]>([]);

    // --- CORE ACTION: Fetch & Process ---
    const refreshList1Candidates = useCallback(async (currentConfig: ScanConfig, forceFull = false) => {
        let sessionId = scanSessionIdRef.current;
        if (forceFull) { 
            sessionId = Date.now(); 
            scanSessionIdRef.current = sessionId; 
            setIsScanning(true); 
            setScanStatusText(forceFull ? "正在重置..." : "更新候选池..."); 
        }
        
        try {
            const baseUrl = 'https://fapi.binance.com/fapi/v1/ticker';
            
            // Construct Endpoint
            let endpoint = '';
            if (currentConfig.timeBasis === '8AM') {
                // tradingDay: Daily stats (UTC 0).
                endpoint = `${baseUrl}/tradingDay`;
            } else {
                // 24hr: Rolling stats. Removed _t timestamp to allow proxy caching.
                endpoint = `${baseUrl}/24hr`;
            }
            
            // Validator checks for array
            // PASS directMode HERE
            const res = await fetchWithFallback(endpoint, { cache: 'default' }, (d) => Array.isArray(d) && d.length > 0, directMode);
            
            if (res.ok) {
                const data = await res.json();
                
                // Concurrency check
                if (scanSessionIdRef.current !== sessionId && !forceFull) return;
                
                // Logic Processing
                const { list1: filtered, stats } = processMarketData(data, currentConfig, customSymbolSet);
                
                setMarketStats(stats);
                setList1(filtered);
                list1Ref.current = filtered;
                
                if (forceFull) {
                    setScanStatusText(filtered.length > 0 ? `行情就绪 (${filtered.length}个)` : "无符合条件的币种");
                    setIsScanning(false);
                }
            } else {
                throw new Error(`HTTP ${res.status}`);
            }
        } catch (e: any) { 
            // Safe Error Handling
            const errMsg = e?.message || String(e);
            console.error("Scanner Fetch Failed:", errMsg); 
            
            if (forceFull) {
                if (
                    errMsg.includes('Failed to fetch') || 
                    errMsg.includes('NetworkError') || 
                    errMsg.includes('HTTP 400') || 
                    errMsg.includes('HTTP 403') ||
                    errMsg.includes('HTTP 429')
                ) {
                    setScanStatusText("连接失败: 请检查网络或尝试[直连模式]");
                } else {
                    setScanStatusText("数据获取失败");
                }
                setIsScanning(false);
                audioService.speak("数据获取失败，请检查网络");
            }
        }
    }, [customSymbolSet, directMode]);

    return {
        list1,
        isScanning,
        scanStatusText,
        marketStats,
        nextScanTime,
        setNextScanTime,
        refreshList1Candidates,
        list1Ref // Exposed for dependent modules (List 2)
    };
};
