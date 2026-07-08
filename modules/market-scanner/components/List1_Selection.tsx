
import React, { useState } from 'react';
import { Loader2, AlertTriangle, RotateCw, Maximize2 } from 'lucide-react';
import { ScanConfig, ScannerItem, COLUMN_WIDTH_CLASS } from '../../../components/Scanner/scannerTypes';
import { List1Control } from './Control';
import { List1Item } from './Item';
import { ScannerVisualizerModal } from '../../../components/ScannerVisualizerModal';

interface Props {
    scanConfig: ScanConfig;
    setScanConfig: React.Dispatch<React.SetStateAction<ScanConfig>>;
    isScanning: boolean;
    scanStatusText: string;
    isPaused: boolean;
    setIsPaused: (v: boolean) => void;
    list1: ScannerItem[];
    onScan: () => void;
    nextScanTime?: number; 
    fixedModeView: 'MONITOR' | 'SEARCH';
    setFixedModeView: (v: 'MONITOR' | 'SEARCH') => void;
    scanInterval: number;
    setScanInterval: (v: number) => void;
    customSymbolSet: Set<string>;
    onToggleSymbol: (symbol: string) => void;
    onSelectAll: () => void;
    onDeselectAll: () => void;
    onDeleteSymbol: (symbol: string) => void;
    onClearBlacklist: () => void;
    marketStats: any;
    setChartData: (data: any) => void;
    mode?: 'LIVE' | 'BACKTEST' | 'SMART';
    downloadProgressMap?: Record<string, number>;
    onDownload?: (symbol: string) => void;
    // New Props
    scannerMode?: 'LIVE' | 'BACKTEST' | 'SMART';
    setScannerMode?: (mode: 'LIVE' | 'BACKTEST' | 'SMART') => void;
    // Major Trend Props
    majorTrendCandidates?: Set<string>;
    isMajorScanning?: boolean;
    majorProgress?: { current: number, total: number };
    runMajorTrendDiscovery?: () => void;
    backtestProps?: {
        speed: number;
        setSpeed: (s: number) => void;
        intervals: string[];
        setIntervals: (tf: string[]) => void;
        isPlaying: boolean;
        onStart: () => void;
        onStop: () => void;
        downloadRange: { start: string, end: string };
        setDownloadRange: (range: { start: string, end: string }) => void;
        onDownload: () => void;
        isDownloading: boolean;
        syncProgress: { current: number, total: number, percent: number } | null;
        virtualTime: number;
        customSymbols: string;
        setCustomSymbols: (s: string) => void;
        useCustomOnly: boolean;
        setUseCustomOnly: (v: boolean) => void;
    };
}

const List1_Selection: React.FC<Props> = ({ 
    scanConfig, setScanConfig, isScanning, scanStatusText, isPaused, setIsPaused, list1, onScan, 
    fixedModeView, setFixedModeView, scanInterval, setScanInterval, customSymbolSet,
    onToggleSymbol, onSelectAll, onDeselectAll, onDeleteSymbol, onClearBlacklist, marketStats, nextScanTime, setChartData,
    mode = 'LIVE', downloadProgressMap = {}, onDownload,
    scannerMode, setScannerMode, majorTrendCandidates, isMajorScanning, majorProgress, runMajorTrendDiscovery, backtestProps
}) => {
    const [showVisualizer, setShowVisualizer] = useState(false);
    return (
        <div className={`flex flex-col h-full bg-slate-900 border-r border-slate-800 flex-1 min-w-[300px] overflow-y-auto custom-scrollbar`}>
            <List1Control
                scanConfig={scanConfig} setScanConfig={setScanConfig} isScanning={isScanning} 
                scanStatusText={scanStatusText} isPaused={isPaused} setIsPaused={setIsPaused} onScan={onScan} 
                fixedModeView={fixedModeView} setFixedModeView={setFixedModeView} 
                onClearWatchlist={() => setScanConfig(p => ({...p, customSymbols: ''}))} 
                onClearBlacklist={onClearBlacklist}
                scanInterval={scanInterval} setScanInterval={setScanInterval}
                marketStats={marketStats}
                nextScanTime={nextScanTime}
                scannerMode={scannerMode}
                setScannerMode={setScannerMode}
                majorTrendCandidates={majorTrendCandidates}
                isMajorScanning={isMajorScanning}
                majorProgress={majorProgress}
                runMajorTrendDiscovery={runMajorTrendDiscovery}
                backtestProps={backtestProps}
            />
            <div className="px-3 py-2 bg-slate-950 border-b border-slate-800 flex items-center justify-between sticky top-0">
                <div className="flex items-center gap-2">
                    <div className="text-[10px] font-bold text-slate-500 uppercase">1. 市场初筛</div>
                    {scanConfig.useCustomOnly && fixedModeView === 'SEARCH' && (
                        <div className="flex gap-1 animate-in fade-in">
                            <button onClick={onSelectAll} className="text-[9px] bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded text-cyan-400 hover:bg-slate-700 transition-colors">全选</button>
                            <button onClick={onDeselectAll} className="text-[9px] bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">取消</button>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <div className="text-xs font-mono font-bold text-white">{list1.length}</div>
                    <button 
                        onClick={() => setShowVisualizer(true)}
                        className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-indigo-400 transition-all border border-transparent hover:border-indigo-500/30"
                        title="放大查看 K 线大图"
                    >
                        <Maximize2 size={12} />
                    </button>
                </div>
            </div>
            
            {showVisualizer && (
                <ScannerVisualizerModal 
                    title="1. 市场初筛"
                    items={list1.map(i => ({ symbol: i.symbol, timeframe: scanConfig.list1DefaultTf || '1d' }))}
                    defaultTf={scanConfig.list1DefaultTf || '1d'}
                    defaultLimit={500}
                    watchlist={
                        scannerMode === 'BACKTEST' && backtestProps
                            ? (backtestProps.customSymbols || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
                            : Array.from(customSymbolSet)
                    }
                    onAddToWatchlist={(symbol) => {
                        const cleanSym = symbol.replace('USDT', '').toUpperCase();
                        if (scannerMode === 'BACKTEST' && backtestProps) {
                            const current = (backtestProps.customSymbols || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
                            const set = new Set(current);
                            set.add(cleanSym);
                            backtestProps.setCustomSymbols(Array.from(set).join(', '));
                        } else {
                            onToggleSymbol(symbol);
                        }
                    }}
                    onClose={() => setShowVisualizer(false)}
                />
            )}
            <div className="p-2 space-y-1.5 bg-slate-950/20">
                {list1.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-slate-500 gap-3 animate-in fade-in">
                        {isScanning ? (
                            <>
                                <Loader2 size={32} className="animate-spin text-indigo-500 opacity-80" />
                                <span className="text-xs font-bold animate-pulse">正在获取数据...</span>
                            </>
                        ) : (
                            <>
                                <div className="p-3 bg-slate-900 rounded-full border border-slate-800">
                                    <AlertTriangle size={24} className="opacity-50 text-amber-500" />
                                </div>
                                <div className="text-center">
                                    <span className="text-xs font-bold block text-slate-400">暂无数据 / 获取失败</span>
                                    <span className="text-[10px] opacity-60 block mt-1">请检查网络或点击重试</span>
                                </div>
                                <button 
                                    onClick={onScan}
                                    className="px-4 py-1.5 bg-slate-800 hover:bg-indigo-600 hover:text-white text-slate-400 rounded text-xs font-bold transition-all border border-slate-700 flex items-center gap-1.5 shadow-lg mt-2"
                                >
                                    <RotateCw size={12} /> 点击重试
                                </button>
                            </>
                        )}
                    </div>
                ) : (
                    list1.map((item, idx) => (
                        <List1Item 
                            key={`${item.symbol}-${idx}`}
                            item={item}
                            idx={idx}
                            scanConfig={scanConfig}
                            fixedModeView={fixedModeView}
                            customSymbolSet={customSymbolSet}
                            onToggleSymbol={onToggleSymbol}
                            onDeleteSymbol={onDeleteSymbol}
                            setChartData={setChartData}
                            mode={mode}
                            downloadProgress={downloadProgressMap[item.symbol]}
                            onDownload={onDownload}
                        />
                    ))
                )}
            </div>
        </div>
    );
};

export default List1_Selection;
