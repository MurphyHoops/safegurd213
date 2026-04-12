
import React, { useState, useMemo } from 'react';
import { PositionsListProps } from './types';
import { PositionSide, Position } from '../../types';
import { Shield, Target, Zap, History, BarChart2, BarChart4, ArrowUp, ArrowDown, List, Trash2, AlertCircle } from 'lucide-react';

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
    onClearRecords
}) => {
    const [sortMode, setSortMode] = useState<'DESC' | 'ASC'>('DESC');
    const [confirmClear, setConfirmClear] = useState(false);
    const [confirmClearRecords, setConfirmClearRecords] = useState(false);
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
    
    // Sort logic internal to the presentation module
    const sortedPositions = useMemo(() => {
        const getLivePnLPercent = (p: Position) => {
            return p.unrealizedPnLPercentage || 0;
        };

        // Group positions by symbol to find hedged pairs and calculate group PnL
        const symbolStats: Record<string, { isHedged: boolean, maxPnlPercent: number }> = {};
        
        positions.forEach(p => {
            if (!symbolStats[p.symbol]) {
                symbolStats[p.symbol] = { isHedged: false, maxPnlPercent: -Infinity };
            }
            if (p.isHedged) {
                symbolStats[p.symbol].isHedged = true;
            }
            const pnlPct = getLivePnLPercent(p);
            if (pnlPct > symbolStats[p.symbol].maxPnlPercent) {
                symbolStats[p.symbol].maxPnlPercent = pnlPct;
            }
        });

        // Sort logic
        return [...positions].sort((a, b) => {
            const statsA = symbolStats[a.symbol];
            const statsB = symbolStats[b.symbol];

            // 1. Hedged pairs first
            if (statsA.isHedged && !statsB.isHedged) return -1;
            if (!statsA.isHedged && statsB.isHedged) return 1;

            // 2. If they are different symbols, sort by the symbol's max PnL percent
            if (a.symbol !== b.symbol) {
                if (sortMode === 'DESC') {
                    return statsB.maxPnlPercent - statsA.maxPnlPercent;
                } else {
                    return statsA.maxPnlPercent - statsB.maxPnlPercent;
                }
            }

            // 3. If same symbol (e.g. main and hedge), sort by PnL percent
            const pnlA = getLivePnLPercent(a);
            const pnlB = getLivePnLPercent(b);
            return pnlB - pnlA; // Within the same symbol, highest PnL first
        });
    }, [positions, realPrices, sortMode]);

    const longCount = positions.filter(p => p.side === PositionSide.LONG).length;
    const shortCount = positions.filter(p => p.side === PositionSide.SHORT).length;
    
    // A hedge pair consists of a main position and a hedge position.
    // We count the number of main positions that are hedged to get the number of pairs (groups).
    const hedgePairsCount = positions.filter(p => p.isHedged && !p.mainPositionId).length;

    // Determine active rescue strategies
    const activeStrategies = [];
    if (settings?.stopLoss) {
        if (settings.stopLoss.hedgeProfitClear) activeStrategies.push("对冲盈利解套");
        if (settings.stopLoss.callbackProfitClear) activeStrategies.push("回调盈利清仓");
        if (settings.stopLoss.amputationEnabled) activeStrategies.push("断臂求生");
    }
    const strategiesDisplay = activeStrategies.length > 0 ? `(${activeStrategies.join(', ')})` : '';

    return (
        <div className="flex-1 overflow-y-auto rounded border border-slate-800 bg-[#0b0e11] custom-scrollbar flex flex-col">
            <div className="sticky top-0 z-10 bg-[#0b0e11] border-b border-slate-800 px-4 py-2 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-4">
                    <div className="text-xs font-bold text-slate-400">持仓列表 ({positions.length})</div>
                    <div className="flex items-center gap-3 text-[10px] text-slate-500">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500/50"></span>多单: {longCount}</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500/50"></span>空单: {shortCount}</span>
                        <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-indigo-500/50"></span>
                            对冲对: {hedgePairsCount}组 <span className="text-indigo-400/80 ml-1">{strategiesDisplay}</span>
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button 
                        onClick={onOpenTradeModal} 
                        className="flex items-center gap-1 text-[10px] bg-slate-800 border border-slate-700 px-2 py-1 rounded text-slate-300 hover:text-white transition-colors"
                    >
                        <List size={12}/> 交易历史流水
                    </button>
                    <button 
                        onClick={() => setSortMode(sortMode === 'DESC' ? 'ASC' : 'DESC')} 
                        className="flex items-center gap-1 text-[10px] bg-slate-800 border border-slate-700 px-2 py-1 rounded text-slate-300 hover:text-white transition-colors"
                    >
                        {sortMode === 'DESC' ? '盈亏比例: 高→低' : '盈亏比例: 低→高'}
                        {sortMode === 'DESC' ? <ArrowDown size={12}/> : <ArrowUp size={12}/>}
                    </button>
                    <button 
                        onClick={handleBatchCloseWithConfirm} 
                        className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors border ${confirmClear ? 'bg-red-600 hover:bg-red-700 text-white border-red-400 animate-pulse' : 'bg-slate-800 hover:bg-red-900/50 text-slate-400 border-slate-700'}`}
                    >
                        {confirmClear ? <AlertCircle size={12}/> : <Trash2 size={12}/>} {confirmClear ? '确认清仓?' : '清仓'}
                    </button>
                    <button 
                        onClick={handleClearRecordsWithConfirm} 
                        className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors border ${confirmClearRecords ? 'bg-red-600 hover:bg-red-700 text-white border-red-400 animate-pulse' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-red-400'}`}
                    >
                        {confirmClearRecords ? <AlertCircle size={12}/> : <Trash2 size={12}/>} {confirmClearRecords ? '确认清除?' : '清除所有记录'}
                    </button>
                </div>
            </div>
            
            {sortedPositions.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center h-48 text-slate-500 animate-in fade-in">
                    <BarChart4 size={48} className="mb-4 opacity-20" />
                    <p className="text-sm font-bold text-slate-400">暂无持仓</p>
                    <p className="text-xs text-slate-600 mt-1">系统待机中，等待信号触发...</p>
                    <button onClick={onOpenScanner} className="mt-4 px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full text-xs font-bold transition-all shadow-lg shadow-indigo-900/20 flex items-center gap-2">
                        <BarChart2 size={14}/> 前往全域扫描
                    </button>
                </div>
            ) : (
                sortedPositions.map((p, idx) => {
                const livePrice = realPrices[p.symbol] || p.markPrice || p.entryPrice;
                const currentPnl = p.unrealizedPnL;
                const currentPnlPct = p.unrealizedPnLPercentage;
                
                const posMargin = (p.amount * p.entryPrice);
                const mPct = (walletBalance > 0 && posMargin > 0) ? (posMargin / walletBalance) * 100 : 0;
                const peak = p.maxPnLPercent || currentPnlPct;
                const cPct = peak > 0 ? peak - currentPnlPct : 0;
                const hasAmmo = (p.cumulativeHedgeProfit || 0) > 0;
                const hasHedgingHistory = 
                    (p.cumulativeHedgeLoss || 0) > 0 || 
                    (p.cumulativeHedgeProfit || 0) > 0 || 
                    (p.cumulativeAmputationLoss || 0) > 0;
                const isHedgedMode = p.isHedged || !!p.mainPositionId || hasHedgingHistory;
                const isModule1Active = settings.profit.enabled || settings.profit.stopLoss.enabled;

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
                        const mLivePrice = realPrices[mainPos.symbol] || mainPos.markPrice || mainPos.entryPrice;
                        const mDiff = mainPos.side === PositionSide.LONG ? mLivePrice - mainPos.entryPrice : mainPos.entryPrice - mLivePrice;
                        const mPnl = mDiff * mainPos.amount;

                        let hPnl = 0;
                        if (hedgePos) {
                            const hLivePrice = realPrices[hedgePos.symbol] || hedgePos.markPrice || hedgePos.entryPrice;
                            const hDiff = hedgePos.side === PositionSide.LONG ? hLivePrice - hedgePos.entryPrice : hedgePos.entryPrice - hLivePrice;
                            hPnl = hDiff * hedgePos.amount;
                        }

                        const cumulativeLoss = 
                            (mainPos.cumulativeHedgeLoss || 0) + 
                            (mainPos.cumulativeAmputationLoss || 0) + 
                            (hedgePos ? (hedgePos.cumulativeAmputationLoss || 0) : 0);

                        // Strategy 3: Callback Profit Clear (蚂蚁搬家)
                        if (settings.stopLoss.callbackProfitClear) {
                            let currentFloatingLoss = 0;

                            if (mPnl < 0) currentFloatingLoss += Math.abs(mPnl);
                            if (hedgePos && hPnl < 0) currentFloatingLoss += Math.abs(hPnl);

                            totalDebt = currentFloatingLoss + cumulativeLoss;
                        } 
                        // Strategy 2: Hedge Profit Clear (将错就错)
                        else if (settings.stopLoss.hedgeProfitClear) {
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
                    <div 
                        key={`${p.symbol}-${p.side}-${p.entryId}-${idx}`} 
                        onClick={() => onOpenChart(p.symbol, p.entryPrice, p.entryTime)}
                        className={`flex items-center px-4 py-2 border-b border-slate-800/40 hover:bg-[#1e2329]/50 transition-colors group relative overflow-hidden shrink-0 cursor-pointer ${p.isHedged ? 'bg-indigo-900/5' : ''}`}
                    >
                        <div className={`absolute left-0 top-1 bottom-1 w-0.5 rounded-r ${currentPnl >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                        
                        {/* 1. Symbol, Direction & Tags */}
                        <div className="w-[20%] flex items-center gap-2 pr-2">
                            <div className="flex items-center gap-1.5 shrink-0">
                                <span className="font-black text-sm text-white tracking-tight">{p.symbol.replace('USDT','')}</span>
                                <span className={`text-[9px] px-1.5 rounded-sm font-bold ${p.side === PositionSide.LONG ? 'text-emerald-500 bg-emerald-500/10' : 'text-red-500 bg-red-500/10'}`}>
                                    {p.side === PositionSide.LONG ? '多' : '空'}
                                </span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0 hidden sm:flex">
                                {p.isBacktestRecord && (
                                    <div className="flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded-sm border bg-amber-600/20 text-amber-500 border-amber-500/30">
                                        <History size={8} />
                                        <span>回测记录</span>
                                    </div>
                                )}
                                {isHedgedMode ? (
                                    <>
                                        <div className={`flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded-sm border ${p.mainPositionId ? 'bg-purple-900/30 text-purple-300 border-purple-500/30' : 'bg-indigo-900/30 text-indigo-300 border-indigo-500/30'}`} title="模块4已接管">
                                            <Shield size={8} fill="currentColor"/>
                                            <span>{p.mainPositionId ? '对冲仓位' : '原仓位'}</span>
                                        </div>
                                        {p.mainPositionId && p.triggerReason && (
                                            <div className="flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded-sm border bg-slate-800/50 text-slate-400 border-slate-700/50 max-w-[120px]" title={p.triggerReason}>
                                                <span className="truncate">{p.triggerReason}</span>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className={`flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded-sm border ${isModule1Active ? 'bg-emerald-900/20 text-emerald-400 border-emerald-500/20' : 'bg-slate-800 text-slate-500 border-slate-600'}`}>
                                        <Target size={8} />
                                        <span>{isModule1Active ? '标准风控' : '手动模式'}</span>
                                    </div>
                                )}
                                {hasAmmo && (
                                    <div className="flex items-center gap-1 bg-amber-900/30 text-amber-400 text-[8px] font-bold px-1.5 py-0.5 rounded-sm border border-amber-500/30">
                                        <Zap size={8} fill="currentColor"/>
                                        <span>+{(p.cumulativeHedgeProfit || 0).toFixed(1)}U</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 2. Prices & Times */}
                        <div className="w-[35%] flex items-center gap-4">
                            <div className="flex items-center gap-1.5 font-mono text-[10px] shrink-0">
                                <span className="text-slate-500">{new Date(p.isBacktestRecord ? (p.backtestEntryTime || p.entryTime) : (p.entryTime || Date.now())).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'})}</span>
                                <span className="text-slate-400">{p.entryPrice.toFixed(4)}</span>
                            </div>
                            <div className="flex items-center gap-1.5 font-mono text-[10px] shrink-0">
                                <span className="text-slate-500">{new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'})}</span>
                                <span className={`font-bold ${currentPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{livePrice.toFixed(4)}</span>
                            </div>
                        </div>

                        {/* 3. PnL & Stats */}
                        <div className="w-[25%] flex items-center justify-end gap-3 pr-4">
                            <div className="flex items-center gap-0.5 text-[10px] font-mono bg-slate-800/80 px-1.5 py-0.5 rounded-sm border border-slate-700 shrink-0">
                                <span className="font-bold text-slate-200">{(p.amount * livePrice).toFixed(0)}</span>
                                <span className="text-slate-500">U</span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                                <span className={`font-mono text-xs font-bold ${currentPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {currentPnl >= 0 ? '+' : ''}{currentPnl.toFixed(2)}
                                </span>
                                <span className="text-slate-700 text-[10px]">/</span>
                                <span className={`font-mono text-xs font-bold ${currentPnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {currentPnlPct >= 0 ? '+' : ''}{currentPnlPct.toFixed(2)}%
                                </span>
                            </div>
                            {showHedgeStats && (
                                <div className="flex items-center gap-1 text-[9px] text-slate-400 bg-slate-800/50 px-1.5 py-0.5 rounded shrink-0">
                                    <span>负债:</span>
                                    <span className="text-red-400 font-mono font-bold">{totalDebt.toFixed(2)}U</span>
                                </div>
                            )}
                        </div>

                        {/* 4. Actions */}
                        <div className="w-[20%] flex items-center justify-end gap-2 shrink-0">
                            <div className="hidden xl:flex bg-blue-900/20 border border-blue-500/20 rounded-sm px-1.5 py-0.5 items-center gap-1" title="预计强平价格 / 防守线">
                                <span className="text-[8px] text-blue-400 font-bold uppercase">Def:</span>
                                <span className="text-[9px] font-mono text-blue-100">{(p.entryPrice * (p.side === PositionSide.LONG ? 0.99 : 1.01)).toFixed(4)}</span>
                            </div>
                            <div className="flex items-center gap-1 opacity-80 hover:opacity-100 transition-opacity z-10 relative">
                                <button onClick={(e) => { e.stopPropagation(); onShowHistory(p.symbol); }} className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors" title="历史记录"><History size={12}/></button>
                                <button onClick={(e) => { e.stopPropagation(); onOpenChart(p.symbol, p.entryPrice, p.entryTime); }} className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors" title="K线图"><BarChart2 size={12}/></button>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); onClosePosition(p.symbol, p.side); }} 
                                    className="px-2 py-0.5 bg-slate-800 hover:bg-red-600 text-slate-300 hover:text-white rounded text-[10px] font-bold border border-slate-600 hover:border-red-500 transition-all z-10 relative"
                                >
                                    平仓
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })
            )}
        </div>
    );
};
