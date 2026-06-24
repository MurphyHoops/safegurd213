
import React, { useState } from 'react';
import { PositionsListProps } from './types';
import { PositionSide, Position } from '../../types';
import { normalizeSymbol, resolvePrice } from '../../services/symbolUtils';
import { ArrowUp, ArrowDown, List, Trash2, AlertCircle, AlertTriangle, Zap, RefreshCw, WifiOff, Activity, Brain, Settings } from 'lucide-react';
import { EmptyPositions } from './components/EmptyPositions';
import { PositionItem } from './components/PositionItem';
import { PositionSettingsModal } from './components/PositionSettingsModal';
import { usePositionsListLogic } from './usePositionsListLogic';
import { binanceWs } from '../../services/binanceWs';
import { audioService } from '../../services/audioService';

export const PositionsListModule: React.FC<PositionsListProps> = ({
    positions,
    realPrices,
    walletBalance,
    settings,
    onShowHistory,
    onClosePosition,
    onOpenChart,
    onOpenScanner,
    onOpenTradeModal,
    onBatchClose,
    onClearRecords,
    onUpdateCustomSettings,
    networkStatus,
    isOnline
}) => {
    const [sortMode, setSortMode] = useState<'DESC' | 'ASC'>('DESC');
    const [confirmClear, setConfirmClear] = useState(false);
    const [confirmClearRecords, setConfirmClearRecords] = useState(false);
    const [settingsTargetPosition, setSettingsTargetPosition] = useState<Position | null>(null);
    const confirmTimeoutRef = React.useRef<any>(null);
    const confirmRecordsTimeoutRef = React.useRef<any>(null);

    const handleBatchCloseWithConfirm = () => {
        if (!confirmClear) {
            setConfirmClear(true);
            if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
            confirmTimeoutRef.current = setTimeout(() => setConfirmClear(false), 3000);
        } else {
            onBatchClose();
            setConfirmClear(false);
            if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
        }
    };

    const handleClearRecordsWithConfirm = () => {
        if (!confirmClearRecords) {
            setConfirmClearRecords(true);
            if (confirmRecordsTimeoutRef.current) clearTimeout(confirmRecordsTimeoutRef.current);
            confirmRecordsTimeoutRef.current = setTimeout(() => setConfirmClearRecords(false), 3000);
        } else {
            onClearRecords();
            setConfirmClearRecords(false);
            if (confirmRecordsTimeoutRef.current) clearTimeout(confirmRecordsTimeoutRef.current);
        }
    };

    
    const {
        sortedPositions,
        longCount,
        shortCount,
        hedgePairsCount,
        activeStrategies
    } = usePositionsListLogic(positions, realPrices, sortMode, settings);

    const strategiesDisplay = activeStrategies.length > 0 ? `(${activeStrategies.join(', ')})` : '';

    const isNetworkError = !isOnline || networkStatus !== 'healthy';

    return (
        <div className="flex-1 overflow-y-auto rounded border border-slate-800 bg-[#0b0e11] custom-scrollbar flex flex-col relative">
            
            <div className="sticky top-0 z-10 bg-[#0b0e11]/95 backdrop-blur-md border-b border-slate-800 px-4 py-2 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-4">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">持仓监控 ({positions.length})</div>
                    <div className="flex items-center gap-3 text-[10px] text-slate-500 font-bold">
                        <span className="flex items-center gap-1.5 bg-slate-900 px-2 py-0.5 rounded border border-slate-800"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>多: {longCount}</span>
                        <span className="flex items-center gap-1.5 bg-slate-900 px-2 py-0.5 rounded border border-slate-800"><span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>空: {shortCount}</span>
                        <span className="flex items-center gap-1.5 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                             对冲: {hedgePairsCount} <span className="text-indigo-400 uppercase ml-1 opacity-60">{strategiesDisplay}</span>
                        </span>
                    </div>
                </div>
                
                <div className="flex items-center gap-2">
                    {/* 智能平仓：总开关 (Master Toggle) */}
                    <div 
                        onClick={() => {
                            const newVal = !(settings?.profit?.aiSmartMasterEnabled ?? true);
                            onUpdateCustomSettings?.('GLOBAL_MASTER_TOGGLE', { aiSmartMasterEnabled: newVal });
                            audioService.speak(newVal ? "全局智能平仓总开关已开启" : "已关闭全局智能平仓总开关", true);
                        }}
                        className={`flex items-center gap-2 px-2.5 py-1 rounded-full border cursor-pointer transition-all hover:scale-105 active:scale-95 mr-1 ${
                            (settings?.profit?.aiSmartMasterEnabled ?? true) 
                               ? 'bg-emerald-950/20 border-emerald-500/50 hover:border-emerald-400' 
                               : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                        }`}
                        title="点击 开启/关闭 全局智能平仓监控。关闭时自动退回当前系统常规平仓监控"
                    >
                        <div className={`w-1.5 h-1.5 rounded-full ${
                            (settings?.profit?.aiSmartMasterEnabled ?? true) ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                        }`} />
                        <span className={`text-[9px] font-black tracking-wider font-mono ${
                            (settings?.profit?.aiSmartMasterEnabled ?? true) ? 'text-emerald-400 font-bold' : 'text-slate-400'
                        }`}>
                            智能平仓: {(settings?.profit?.aiSmartMasterEnabled ?? true) ? 'ON' : 'OFF'}
                        </span>
                    </div>

                    {/* 智能平仓：设置参数 (Global Preset Config) */}
                    <button 
                        onClick={() => {
                            setSettingsTargetPosition({
                                symbol: 'GLOBAL_DEFAULT',
                                side: PositionSide.LONG,
                                amount: 1,
                                entryPrice: 100,
                                entryTime: Date.now(),
                                unrealizedPnL: 0,
                                unrealizedPnLPercentage: 0,
                                customProfitSettings: settings?.profit
                            } as any);
                        }}
                        className="flex items-center gap-1.5 text-[10px] bg-slate-800 border border-slate-700 px-2.5 py-1 rounded text-slate-300 hover:text-emerald-400 font-bold transition-all mr-1 hover:border-emerald-500/40 hover:scale-105"
                        title="配置全局智能平仓与多维量价追踪的默认预设规则"
                    >
                        <Brain size={12} className="text-emerald-400" />
                        <span>智能参数</span>
                    </button>

                    <button 
                        onClick={onOpenTradeModal} 
                        className="flex items-center gap-1 text-[10px] bg-slate-800 border border-slate-700 px-2 py-1 rounded text-slate-300 hover:text-white transition-colors"
                    >
                        <List size={12}/> 历史流水
                    </button>
                    <button 
                        onClick={() => setSortMode(sortMode === 'DESC' ? 'ASC' : 'DESC')} 
                        className="flex items-center gap-1 text-[10px] bg-slate-800 border border-slate-700 px-2 py-1 rounded text-slate-300 hover:text-white transition-colors"
                    >
                        {sortMode === 'DESC' ? '盈亏↓' : '盈亏↑'}
                        {sortMode === 'DESC' ? <ArrowDown size={11}/> : <ArrowUp size={11}/>}
                    </button>
                    <button 
                        onClick={handleBatchCloseWithConfirm} 
                        className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors border ${confirmClear ? 'bg-red-600 hover:bg-red-700 text-white border-red-400 animate-pulse' : 'bg-slate-800 hover:bg-red-900/50 text-slate-400 border-slate-700'}`}
                        title="清空当前所有持仓"
                    >
                        {confirmClear ? <AlertCircle size={12}/> : <Trash2 size={12}/>} {confirmClear ? '确认?' : '一键清仓'}
                    </button>
                    <button 
                        onClick={handleClearRecordsWithConfirm} 
                        className={`p-1 rounded transition-colors border ${confirmClearRecords ? 'bg-red-600 text-white border-red-400' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-red-400'}`}
                        title="清除所有交易流水记录"
                    >
                         {confirmClearRecords ? <AlertCircle size={14}/> : <Trash2 size={14}/>}
                    </button>
                </div>
            </div>
            
            {sortedPositions.length === 0 ? (
                <EmptyPositions onOpenScanner={onOpenScanner} />
            ) : (
                sortedPositions.map((p, idx) => {
                    const livePrice = p.isBacktestRecord 
                        ? (p.markPrice || p.entryPrice) 
                        : resolvePrice(p.symbol, realPrices, p.markPrice || p.entryPrice);
                    
                    // RE-CALCULATE Live PnL in UI for instant feedback (Simulator tick handles logic, but UI shows real-time)
                    let calcLivePrice = livePrice;
                    if (p.entryPrice > 0 && livePrice > 0) {
                        const ratio = livePrice / p.entryPrice;
                        if (ratio > 500) calcLivePrice = livePrice / 1000;
                        else if (ratio < 0.002) calcLivePrice = livePrice * 1000;
                    }

                    const priceDiff = p.side === PositionSide.LONG ? calcLivePrice - p.entryPrice : p.entryPrice - calcLivePrice;
                    const currentPnl = priceDiff * p.amount;
                    const currentPnlPct = p.entryPrice > 0 ? (priceDiff / p.entryPrice) * 100 : 0;
                    
                    const hasAmmo = (p.cumulativeHedgeProfit || 0) > 0;
                    const hasHedgingHistory = 
                        (p.cumulativeHedgeLoss || 0) > 0 || 
                        (p.cumulativeHedgeProfit || 0) > 0 || 
                        (p.cumulativeAmputationLoss || 0) > 0;
                    const isHedgedMode = p.isHedged || !!p.mainPositionId || hasHedgingHistory;
                    const isModule1Active = settings.profit?.enabled || settings.profit?.stopLoss?.enabled;
                    
                    let totalDebt = 0;
                    let showHedgeStats = false;
                    
                    if (isHedgedMode) {
                        showHedgeStats = true;
                        let mainPos: Position | undefined;
                        let hedgePos: Position | undefined;
                        
                        if (p.mainPositionId) {
                            hedgePos = p;
                            mainPos = positions.find(x => x.entryId === p.mainPositionId);
                        } else {
                            mainPos = p;
                            hedgePos = positions.find(x => x.mainPositionId === p.entryId);
                        }
                        
                        if (mainPos) {
                            const mLivePrice = mainPos.isBacktestRecord 
                                ? (mainPos.markPrice || mainPos.entryPrice) 
                                : resolvePrice(mainPos.symbol, realPrices, mainPos.markPrice || mainPos.entryPrice);
                            const mDiff = mainPos.side === PositionSide.LONG ? mLivePrice - mainPos.entryPrice : mainPos.entryPrice - mLivePrice;
                            const mPnl = mDiff * mainPos.amount;
                            
                            let hPnl = 0;
                            if (hedgePos) {
                                const hLivePrice = hedgePos.isBacktestRecord 
                                    ? (hedgePos.markPrice || hedgePos.entryPrice) 
                                    : resolvePrice(hedgePos.symbol, realPrices, hedgePos.markPrice || hedgePos.entryPrice);
                                const hDiff = hedgePos.side === PositionSide.LONG ? hLivePrice - hedgePos.entryPrice : hedgePos.entryPrice - hLivePrice;
                                hPnl = hDiff * hedgePos.amount;
                            }

                            const cumulativeLoss = 
                                (mainPos.cumulativeHedgeLoss || 0) + 
                                (mainPos.cumulativeAmputationLoss || 0) + 
                                (hedgePos ? (hedgePos.cumulativeAmputationLoss || 0) : 0);

                            // Strategy 3: Callback Profit Clear (蚂蚁搬家)
                            if (settings.stopLoss?.callbackProfitClear) {
                                let currentFloatingLoss = 0;

                                if (mPnl < 0) currentFloatingLoss += Math.abs(mPnl);
                                if (hedgePos && hPnl < 0) currentFloatingLoss += Math.abs(hPnl);

                                totalDebt = currentFloatingLoss + cumulativeLoss;
                            } 
                            // Strategy 2: Hedge Profit Clear (将错就错)
                            else if (settings.stopLoss?.hedgeProfitClear) {
                                let currentFloatingLoss = 0;

                                if (mPnl < 0) currentFloatingLoss += Math.abs(mPnl);
                                if (hedgePos && hPnl < 0) currentFloatingLoss += Math.abs(hPnl);

                                totalDebt = cumulativeLoss + currentFloatingLoss;
                            } else {
                                // Default display if no specific strategy is selected
                                totalDebt = (mPnl < 0 ? Math.abs(mPnl) : 0) + (hPnl < 0 ? Math.abs(hPnl) : 0) + cumulativeLoss;
                            }
                        }
                    }

                    return (
                        <PositionItem 
                            key={`${p.symbol}-${p.side}-${p.entryId}-${idx}`}
                            p={p}
                            idx={idx}
                            livePrice={livePrice}
                            currentPnl={currentPnl}
                            currentPnlPct={currentPnlPct}
                            showHedgeStats={showHedgeStats}
                            totalDebt={totalDebt}
                            isHedgedMode={isHedgedMode}
                            isModule1Active={isModule1Active}
                            hasAmmo={hasAmmo}
                            onOpenChart={onOpenChart}
                            onShowHistory={onShowHistory}
                            onClosePosition={onClosePosition}
                            onOpenSettings={(pos) => setSettingsTargetPosition(pos)}
                        />
                    );
                })
            )}

            {settingsTargetPosition && (
                <PositionSettingsModal 
                    position={settingsTargetPosition}
                    globalSettings={settings}
                    isOpen={!!settingsTargetPosition}
                    onClose={() => setSettingsTargetPosition(null)}
                    onSave={(symbol, customSettings) => {
                        if (onUpdateCustomSettings) {
                            onUpdateCustomSettings(symbol, customSettings);
                        }
                    }}
                />
            )}
        </div>
    );
};
