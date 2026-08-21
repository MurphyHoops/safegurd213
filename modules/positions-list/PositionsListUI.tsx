
import React, { useState, useEffect, useRef } from 'react';
import { PositionsListProps } from './types';
import { PositionSide, Position } from '../../types';
import { normalizeSymbol, resolvePrice } from '../../services/symbolUtils';
import { ArrowUp, ArrowDown, List, Trash2, AlertCircle, AlertTriangle, Zap, RefreshCw, WifiOff, Activity, Brain, Settings, History, TrendingUp, BarChart2, ShieldCheck, Lock, Unlock } from 'lucide-react';
import { EmptyPositions } from './components/EmptyPositions';
import { PositionItem } from './components/PositionItem';
import { PositionSettingsModal } from './components/PositionSettingsModal';
import { usePositionsListLogic } from './usePositionsListLogic';
import { binanceWs } from '../../services/binanceWs';
import { audioService } from '../../services/audioService';
import { backtestDb } from '../../services/backtest/db';

// @LOCKED: PositionsListUI logic
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
    onVerifyPosition,
    onManualHedge,
    networkStatus,
    isOnline,
    manuallyClosedSymbols
}) => {
    const [sortKey, setSortKey] = useState<'PNL_PCT' | 'AMOUNT' | 'PNL_AMOUNT'>('PNL_PCT');
    const [sortMode, setSortMode] = useState<'DESC' | 'ASC'>('DESC');
    const [positionFilter, setPositionFilter] = useState<'ALL' | 'STD_LONG_WIN' | 'STD_LONG_LOSS' | 'STD_SHORT_WIN' | 'STD_SHORT_LOSS' | 'HEDGE'>('ALL');
    const [confirmClear, setConfirmClear] = useState(false);
    const [confirmClearRecords, setConfirmClearRecords] = useState(false);
    const [settingsTargetPosition, setSettingsTargetPosition] = useState<Position | null>(null);
    const [isHoveredOnList, setIsHoveredOnList] = useState(false);
    const [isPinLocked, setIsPinLocked] = useState(false);
    const confirmTimeoutRef = React.useRef<any>(null);
    const confirmRecordsTimeoutRef = React.useRef<any>(null);

    const isListOrderLocked = isHoveredOnList || isPinLocked;

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

    // --- BACKTEST/LIVE TAB STATE ---
    const [activeTab, setActiveTab] = useState<'LIVE' | 'BACKTEST'>('LIVE');
    const [latestReport, setLatestReport] = useState<any>(null);

    const btPositions = positions.filter(p => p.isBacktestRecord);
    const livePositionsFiltered = positions.filter(p => !p.isBacktestRecord);
    const hasBacktestPositions = btPositions.length > 0;

    // Auto-switch to BACKTEST tab if there are active backtest positions
    useEffect(() => {
        if (hasBacktestPositions) {
            setActiveTab('BACKTEST');
        } else {
            setActiveTab('LIVE');
        }
    }, [hasBacktestPositions]);

    // Load latest report stats
    useEffect(() => {
        const loadLatestReport = async () => {
            try {
                await backtestDb.init();
                const reports = await backtestDb.getReports();
                if (reports && reports.length > 0) {
                    setLatestReport(reports[0]);
                }
            } catch (err) {
                console.warn('Error loading backtest report for monitor:', err);
            }
        };
        loadLatestReport();
    }, [activeTab]);

    const activePositionsList = activeTab === 'BACKTEST' ? btPositions : livePositionsFiltered;
    
    const {
        sortedPositions,
        longCount,
        shortCount,
        hedgePairsCount,
        activeStrategies
    } = usePositionsListLogic(activePositionsList, realPrices, sortKey, sortMode, settings, isListOrderLocked);

    const strategiesDisplay = activeStrategies.length > 0 ? `(${activeStrategies.join(', ')})` : '';

    let stdLongWinCount = 0;
    let stdLongLossCount = 0;
    let stdShortWinCount = 0;
    let stdShortLossCount = 0;
    let hedgeCount = 0;

    sortedPositions.forEach(p => {
        const isStandard = !p.isHedged && !p.mainPositionId;
        const isHedge = p.isHedged || !!p.mainPositionId;
        const isLong = p.side === PositionSide.LONG;
        const isShort = p.side === PositionSide.SHORT;

        const pLivePrice = p.isBacktestRecord ? (p.markPrice || p.entryPrice) : resolvePrice(p.symbol, realPrices, p.markPrice || p.entryPrice);
        let pCalcLive = pLivePrice;
        if (p.entryPrice > 0 && pLivePrice > 0) {
            const ratio = pLivePrice / p.entryPrice;
            if (ratio > 500) pCalcLive = pLivePrice / 1000;
            else if (ratio < 0.002) pCalcLive = pLivePrice * 1000;
        }
        const pDiff = p.side === PositionSide.LONG ? pCalcLive - p.entryPrice : p.entryPrice - pCalcLive;
        const pPnl = pDiff * p.amount;
        const win = pPnl >= 0;

        if (isHedge) {
            hedgeCount++;
        } else if (isStandard) {
            if (isLong) {
                if (win) stdLongWinCount++;
                else stdLongLossCount++;
            } else if (isShort) {
                if (win) stdShortWinCount++;
                else stdShortLossCount++;
            }
        }
    });

    const filteredPositions = sortedPositions.filter(p => {
        if (positionFilter === 'ALL') return true;

        const isStandard = !p.isHedged && !p.mainPositionId;
        const isHedge = p.isHedged || !!p.mainPositionId;
        const isLong = p.side === PositionSide.LONG;
        const isShort = p.side === PositionSide.SHORT;

        const pLivePrice = p.isBacktestRecord ? (p.markPrice || p.entryPrice) : resolvePrice(p.symbol, realPrices, p.markPrice || p.entryPrice);
        let pCalcLive = pLivePrice;
        if (p.entryPrice > 0 && pLivePrice > 0) {
            const ratio = pLivePrice / p.entryPrice;
            if (ratio > 500) pCalcLive = pLivePrice / 1000;
            else if (ratio < 0.002) pCalcLive = pLivePrice * 1000;
        }
        const pDiff = p.side === PositionSide.LONG ? pCalcLive - p.entryPrice : p.entryPrice - pCalcLive;
        const pPnl = pDiff * p.amount;
        const win = pPnl >= 0;

        if (positionFilter === 'STD_LONG_WIN') return isStandard && isLong && win;
        if (positionFilter === 'STD_LONG_LOSS') return isStandard && isLong && !win;
        if (positionFilter === 'STD_SHORT_WIN') return isStandard && isShort && win;
        if (positionFilter === 'STD_SHORT_LOSS') return isStandard && isShort && !win;
        if (positionFilter === 'HEDGE') return isHedge;
        return true;
    });

    const hedgeMethodSummary = [
        settings?.hedging?.triggerLossEnabled ? `亏损${settings.hedging.triggerLossPercent}%` : null,
        settings?.hedging?.trendHedgeEnabled ? `EMA${settings.hedging.trendHedgeEmaPeriod || 80}` : null,
        settings?.hedging?.breakKLineEnabled ? `破位K线` : null
    ].filter(Boolean).join('·') || (settings?.hedging?.enabled ? '防爆开启' : '未开启');

    const isNetworkError = !isOnline || networkStatus !== 'healthy';

    return (
        <div 
            className="flex-1 overflow-y-auto rounded border border-slate-800 bg-[#0b0e11] custom-scrollbar flex flex-col relative"
            onMouseEnter={() => setIsHoveredOnList(true)}
            onMouseLeave={() => setIsHoveredOnList(false)}
        >
            
            {/* Top Tabs Bar */}
            <div className="flex items-center justify-between border-b border-slate-800 bg-[#0d1015] p-1.5 shrink-0 select-none">
                <div className="flex gap-1.5">
                    <button 
                        onClick={() => setActiveTab('LIVE')}
                        className={`px-3 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1.5 ${
                            activeTab === 'LIVE' 
                                ? 'bg-slate-800 text-white shadow border border-slate-700/50' 
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
                        }`}
                    >
                        <span className={`w-1.5 h-1.5 rounded-full ${activeTab === 'LIVE' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-500'}`} />
                        实盘/模拟 监控
                    </button>
                    <button 
                        onClick={() => setActiveTab('BACKTEST')}
                        className={`px-3 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1.5 ${
                            activeTab === 'BACKTEST' 
                                ? 'bg-[#181d30] text-indigo-300 border border-indigo-500/20 shadow' 
                                : 'text-slate-400 hover:text-indigo-400 hover:bg-indigo-950/10'
                        }`}
                    >
                        <span className={`w-1.5 h-1.5 rounded-full ${activeTab === 'BACKTEST' ? 'bg-indigo-400 animate-pulse' : 'bg-slate-500'}`} />
                        回测仿真 监控
                    </button>
                </div>
                
                {activeTab === 'BACKTEST' && (
                    <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest font-mono pr-2">
                        仿真终端模式 (SIMULATION TERMINAL)
                    </div>
                )}
            </div>

            <div className="sticky top-0 z-10 bg-[#0b0e11]/95 backdrop-blur-md border-b border-slate-800 flex flex-col shrink-0">
                <div className="px-4 py-2 flex justify-between items-center">
                    <div className="flex flex-col gap-1.5">
                        {/* 实盘交易 (Live Trading) 绿灯高亮指示器 */}
                        {settings?.system?.realTrading && activeTab !== 'BACKTEST' && (
                            <div className="flex items-center gap-1.5 bg-emerald-950/40 border border-emerald-500/30 rounded px-2 py-0.5 w-fit">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                </span>
                                <span className="text-[10px] text-emerald-400 font-bold font-sans uppercase tracking-wider">实盘交易 (Live Trading)</span>
                            </div>
                        )}
                        <div className="flex items-center gap-4">
                            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                                {activeTab === 'BACKTEST' ? '仿真持仓' : '当前持仓'} ({filteredPositions.length}/{sortedPositions.length})
                            </div>
                            <div className="flex items-center gap-3 text-[10px] text-slate-500 font-bold">
                                <span className="flex items-center gap-1.5 bg-slate-900 px-2 py-0.5 rounded border border-slate-800"><span className={`w-1.5 h-1.5 rounded-full bg-emerald-500 ${activeTab === 'LIVE' ? 'animate-pulse' : ''}`}></span>多: {longCount}</span>
                                <span className="flex items-center gap-1.5 bg-slate-900 px-2 py-0.5 rounded border border-slate-800"><span className={`w-1.5 h-1.5 rounded-full bg-red-500 ${activeTab === 'LIVE' ? 'animate-pulse' : ''}`}></span>空: {shortCount}</span>
                                <span className="flex items-center gap-1.5 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                                     对冲: {hedgePairsCount} <span className="text-indigo-400 uppercase ml-1 opacity-60">{strategiesDisplay}</span>
                                </span>
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                        {/* 其它控制按钮 */}

                        <button 
                            onClick={onOpenTradeModal} 
                            className="flex items-center gap-1 text-[10px] bg-slate-800 border border-slate-700 px-2 py-1 rounded text-slate-300 hover:text-white transition-colors"
                        >
                            <List size={12}/> {activeTab === 'BACKTEST' ? '回测流水' : '历史流水'}
                        </button>
                        {/* Sort controls group */}
                        <div className="flex items-center bg-slate-900 border border-slate-800 rounded p-0.5 gap-0.5">
                            <button 
                                type="button"
                                onClick={() => {
                                    if (sortKey === 'PNL_PCT') {
                                        setSortMode(sortMode === 'DESC' ? 'ASC' : 'DESC');
                                    } else {
                                        setSortKey('PNL_PCT');
                                        setSortMode('DESC');
                                    }
                                }}
                                className={`flex items-center gap-0.5 text-[10px] px-1.5 py-1 rounded transition-all ${sortKey === 'PNL_PCT' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'}`}
                                title="按盈亏比例 (%) 排序"
                            >
                                <span>盈亏%</span>
                                {sortKey === 'PNL_PCT' && (sortMode === 'DESC' ? <ArrowDown size={10}/> : <ArrowUp size={10}/>)}
                            </button>

                            <button 
                                type="button"
                                onClick={() => {
                                    if (sortKey === 'AMOUNT') {
                                        setSortMode(sortMode === 'DESC' ? 'ASC' : 'DESC');
                                    } else {
                                        setSortKey('AMOUNT');
                                        setSortMode('DESC');
                                    }
                                }}
                                className={`flex items-center gap-0.5 text-[10px] px-1.5 py-1 rounded transition-all ${sortKey === 'AMOUNT' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'}`}
                                title="按持仓数量/大小 (USDT) 排序"
                            >
                                <span>持仓</span>
                                {sortKey === 'AMOUNT' && (sortMode === 'DESC' ? <ArrowDown size={10}/> : <ArrowUp size={10}/>)}
                            </button>

                            <button 
                                type="button"
                                onClick={() => {
                                    if (sortKey === 'PNL_AMOUNT') {
                                        setSortMode(sortMode === 'DESC' ? 'ASC' : 'DESC');
                                    } else {
                                        setSortKey('PNL_AMOUNT');
                                        setSortMode('DESC');
                                    }
                                }}
                                className={`flex items-center gap-0.5 text-[10px] px-1.5 py-1 rounded transition-all ${sortKey === 'PNL_AMOUNT' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'}`}
                                title="按盈亏金额 (USDT) 排序"
                            >
                                <span>盈亏额</span>
                                {sortKey === 'PNL_AMOUNT' && (sortMode === 'DESC' ? <ArrowDown size={10}/> : <ArrowUp size={10}/>)}
                            </button>
                        </div>

                        {/* Hover & Pin Lock Indicator / Toggle */}
                        <button
                            type="button"
                            onClick={() => setIsPinLocked(!isPinLocked)}
                            className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-all border font-bold ${
                                isPinLocked 
                                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-[0_0_8px_rgba(245,158,11,0.2)]'
                                    : isHoveredOnList 
                                        ? 'bg-indigo-950/60 text-indigo-300 border-indigo-500/40' 
                                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                            }`}
                            title={isPinLocked ? "已常驻固定持仓列表顺序（点击解锁）" : (isHoveredOnList ? "鼠标悬停中：已锁定列表顺序，防止价格跳动引起位置变化" : "点击可常驻锁定当前持仓顺序")}
                        >
                            {isListOrderLocked ? <Lock size={11} className={isPinLocked ? "text-amber-400" : "text-indigo-400"} /> : <Unlock size={11} className="text-slate-500" />}
                            <span>{isPinLocked ? "已常驻锁定" : isHoveredOnList ? "悬停锁定中" : "悬停防跳"}</span>
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

                {/* 分类筛选按钮栏 */}
                <div className="bg-[#0e121a] px-4 py-1.5 border-t border-slate-800/80 flex items-center gap-1.5 overflow-x-auto text-[10px] font-bold shrink-0 custom-scrollbar">
                    <span className="text-slate-500 mr-1 uppercase">分类筛选:</span>
                    <button
                        onClick={() => setPositionFilter('ALL')}
                        className={`px-2 py-0.5 rounded transition-colors ${positionFilter === 'ALL' ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-white'}`}
                    >
                        全部 ({sortedPositions.length})
                    </button>
                    <button
                        onClick={() => setPositionFilter('STD_LONG_WIN')}
                        className={`px-2 py-0.5 rounded transition-colors ${positionFilter === 'STD_LONG_WIN' ? 'bg-emerald-600 text-white' : 'bg-emerald-950/40 text-emerald-400 border border-emerald-500/30'}`}
                    >
                        标多·盈 ({stdLongWinCount})
                    </button>
                    <button
                        onClick={() => setPositionFilter('STD_LONG_LOSS')}
                        className={`px-2 py-0.5 rounded transition-colors ${positionFilter === 'STD_LONG_LOSS' ? 'bg-red-600 text-white' : 'bg-red-950/40 text-red-400 border border-red-500/30'}`}
                    >
                        标多·亏 ({stdLongLossCount})
                    </button>
                    <button
                        onClick={() => setPositionFilter('STD_SHORT_WIN')}
                        className={`px-2 py-0.5 rounded transition-colors ${positionFilter === 'STD_SHORT_WIN' ? 'bg-emerald-600 text-white' : 'bg-emerald-950/40 text-emerald-400 border border-emerald-500/30'}`}
                    >
                        标空·盈 ({stdShortWinCount})
                    </button>
                    <button
                        onClick={() => setPositionFilter('STD_SHORT_LOSS')}
                        className={`px-2 py-0.5 rounded transition-colors ${positionFilter === 'STD_SHORT_LOSS' ? 'bg-red-600 text-white' : 'bg-red-950/40 text-red-400 border border-red-500/30'}`}
                    >
                        标空·亏 ({stdShortLossCount})
                    </button>
                    <button
                        onClick={() => setPositionFilter('HEDGE')}
                        className={`px-2 py-0.5 rounded transition-colors flex items-center gap-1 ${positionFilter === 'HEDGE' ? 'bg-indigo-600 text-white' : 'bg-indigo-950/40 text-indigo-300 border border-indigo-500/30'}`}
                    >
                        <span>对冲 ({hedgeCount})</span>
                        <span className="text-[9px] opacity-75 font-normal">[{hedgeMethodSummary}]</span>
                    </button>
                </div>
            </div>
            
            {sortedPositions.length === 0 ? (
                activeTab === 'BACKTEST' ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-6 text-slate-400 space-y-4">
                        <div className="p-3 bg-indigo-500/10 rounded-full text-indigo-400">
                            <History size={36} />
                        </div>
                        <div className="text-center max-w-sm">
                            <h3 className="text-sm font-bold text-slate-200">无当前活跃的回测仿真持仓</h3>
                            <p className="text-xs text-slate-500 mt-1">进入 [回测模式] 并启动 [交互式仿真沙盒] 以查看回测状态下的实时仿真持仓。</p>
                        </div>
                        
                        {latestReport && (
                            <div className="w-full max-w-md bg-slate-900/40 border border-slate-800/80 rounded-xl p-4 mt-4 space-y-3">
                                <div className="flex items-center justify-between border-b border-slate-800/50 pb-2">
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">最近一次回测报告汇总 (LATEST REPORT)</span>
                                    <span className="text-[9px] font-mono text-indigo-400 bg-indigo-950 px-2 py-0.5 rounded border border-indigo-500/20">
                                        {new Date(latestReport.runTime).toLocaleDateString()}
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-[#0e121a]/80 p-2.5 rounded border border-slate-800/50">
                                        <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">总净值盈亏</div>
                                        <div className={`text-base font-mono font-bold mt-1 ${latestReport.stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {latestReport.stats.totalPnl >= 0 ? '+' : ''}{latestReport.stats.totalPnl.toFixed(2)} USDT
                                        </div>
                                    </div>
                                    <div className="bg-[#0e121a]/80 p-2.5 rounded border border-slate-800/50">
                                        <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">总交易次数</div>
                                        <div className="text-base font-mono font-bold mt-1 text-slate-200">{latestReport.stats.totalTrades} 次</div>
                                    </div>
                                    <div className="bg-[#0e121a]/80 p-2.5 rounded border border-slate-800/50">
                                        <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">胜率 (Win Rate)</div>
                                        <div className="text-base font-mono font-bold mt-1 text-emerald-400">{latestReport.stats.winRate.toFixed(1)}%</div>
                                    </div>
                                    <div className="bg-[#0e121a]/80 p-2.5 rounded border border-slate-800/50">
                                        <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">盈亏比 (PF)</div>
                                        <div className="text-base font-mono font-bold mt-1 text-amber-400">{latestReport.stats.profitFactor.toFixed(2)}</div>
                                    </div>
                                </div>
                                <div className="text-center pt-2 border-t border-slate-800/30">
                                    <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">
                                        币种: {latestReport.symbols.slice(0, 4).join(', ')}{latestReport.symbols.length > 4 ? ` 等 ${latestReport.symbols.length}个` : ''}
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <EmptyPositions onOpenScanner={onOpenScanner} />
                )
            ) : filteredPositions.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-slate-500 space-y-2">
                    <div className="text-xs font-bold text-slate-400">当前分类筛选下暂无匹配的持仓币种</div>
                    <button 
                        onClick={() => setPositionFilter('ALL')}
                        className="text-[10px] bg-slate-800 hover:bg-slate-700 text-indigo-400 px-3 py-1 rounded border border-slate-700 transition-colors"
                    >
                        查看全部持仓 ({sortedPositions.length})
                    </button>
                </div>
            ) : (
                filteredPositions.map((p, idx) => {
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
                    const isHedgedMode = (p.isHedged || !!p.mainPositionId || hasHedgingHistory) && !p.isUnshackled;
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
                            onVerifyPosition={onVerifyPosition}
                            onManualHedge={onManualHedge}
                            aiSmartMasterEnabled={settings?.profit?.aiSmartMasterEnabled}
                            globalProfitSettings={settings?.profit}
                            globalHedgingSettings={settings?.hedging}
                            isManuallyClosed={manuallyClosedSymbols.has(p.symbol)}
                            hasCustomSettings={!!p.customProfitSettings}
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
