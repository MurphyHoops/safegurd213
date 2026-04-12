
import React, { useState, useEffect } from 'react';
import { Filter, Info } from 'lucide-react';
import { ScanConfig } from '../scannerTypes';
import { RulesModal } from './RulesModal';
import { FilterSection } from './FilterSection';
import { WatchlistSection } from './WatchlistSection';
import { ActionSection } from './ActionSection';

export const List1Control = React.memo<{
    scanConfig: ScanConfig;
    setScanConfig: React.Dispatch<React.SetStateAction<ScanConfig>>;
    isScanning: boolean;
    scanStatusText: string;
    isPaused: boolean;
    setIsPaused: (v: boolean) => void;
    onScan: () => void;
    fixedModeView: 'MONITOR' | 'SEARCH';
    setFixedModeView: (v: 'MONITOR' | 'SEARCH') => void;
    onClearWatchlist?: () => void;
    onClearBlacklist?: () => void;
    scanInterval: number;
    setScanInterval: (v: number) => void;
    marketStats: any;
    nextScanTime?: number;
}>((props) => {
    const { scanConfig, setScanConfig, isScanning, scanStatusText, isPaused, setIsPaused, onScan, fixedModeView, setFixedModeView, onClearWatchlist, onClearBlacklist, scanInterval, setScanInterval, marketStats, nextScanTime } = props;
    const [countdown, setCountdown] = useState('--:--');
    const [showRules, setShowRules] = useState(false);

    // Countdown Logic
    useEffect(() => {
        if (!nextScanTime || nextScanTime <= 0) {
            setCountdown('--:--');
            return;
        }
        
        const tick = () => {
            const diff = Math.max(0, Math.ceil((nextScanTime - Date.now()) / 1000));
            if (diff <= 0) {
                setCountdown('00:00');
                return;
            }
            const m = Math.floor(diff / 60).toString().padStart(2, '0');
            const s = (diff % 60).toString().padStart(2, '0');
            setCountdown(`${m}:${s}`);
        };

        tick(); 
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [nextScanTime]);
    
    return (
        <div className="p-3 bg-slate-900 border-b border-slate-800 space-y-3 select-none relative">
            
            {/* Header with Info Button */}
            <div className="flex items-center justify-between text-emerald-500 mb-1">
                <div className="flex items-center gap-2 font-bold text-sm">
                    <Filter size={14} className="fill-emerald-500/20" /> 
                    <span>1. 市场初筛 (SELECTION)</span>
                </div>
                <button onClick={() => setShowRules(true)} className="text-slate-500 hover:text-white transition-colors" title="查看扫描规则">
                    <Info size={12} />
                </button>
            </div>

            {/* Rules Modal Overlay */}
            {showRules && <RulesModal onClose={() => setShowRules(false)} limit={scanConfig.limit} />}

            <div className="bg-[#12161f] p-3 rounded-lg border border-slate-800 space-y-3">
                <WatchlistSection 
                    scanConfig={scanConfig} 
                    setScanConfig={setScanConfig} 
                    fixedModeView={fixedModeView} 
                    setFixedModeView={setFixedModeView}
                    onClearWatchlist={onClearWatchlist}
                    onClearBlacklist={onClearBlacklist}
                />
                
                <FilterSection 
                    scanConfig={scanConfig} 
                    setScanConfig={setScanConfig} 
                    marketStats={marketStats}
                />

                <ActionSection 
                    scanConfig={scanConfig}
                    setScanConfig={setScanConfig}
                    scanInterval={scanInterval}
                    setScanInterval={setScanInterval}
                    isScanning={isScanning}
                    isPaused={isPaused}
                    setIsPaused={setIsPaused}
                    countdown={countdown}
                    scanStatusText={scanStatusText}
                    onScan={onScan}
                />
            </div>
        </div>
    );
});
