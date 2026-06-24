
import React, { useMemo, useState, useRef, useEffect } from 'react';
import { AccountData, Position, PositionSide } from '../../types';
import { Play, Pause, Trash2, AlertCircle, List, RefreshCw, Activity } from 'lucide-react';
import { binanceWs } from '../../services/binanceWs';

interface Props {
    account: AccountData;
    positions: Position[];
    realPrices: Record<string, number>;
    isSimulating: boolean;
    onToggleSimulation: () => void;
    onBatchClose: () => void;
    onOpenTradeModal: () => void;
}

const DashboardHeader: React.FC<Props> = ({ 
    account, positions, realPrices, isSimulating, 
    onToggleSimulation, onBatchClose, onOpenTradeModal 
}) => {
    const [confirmClear, setConfirmClear] = useState(false);
    const confirmTimeoutRef = useRef<any>(null);
    const [wsStatus, setWsStatus] = useState({ isConnected: false, lastMessageTime: 0 });

    useEffect(() => {
        const unsubscribe = binanceWs.subscribeStatus((status) => {
            setWsStatus(status);
        });
        return () => unsubscribe();
    }, []);

    // Calculate Real-time PnL & Margin
    const totalPnL = useMemo(() => {
        return positions.reduce((sum, p) => {
            const livePrice = realPrices[p.symbol] || p.markPrice;
            const diff = p.side === PositionSide.LONG ? livePrice - p.entryPrice : p.entryPrice - livePrice;
            return sum + (diff * p.amount);
        }, 0);
    }, [positions, realPrices]);
    
    const walletBalance = account.marginBalance; 
    const equity = walletBalance + totalPnL;   
    const totalPnLPercentage = walletBalance > 0 ? (totalPnL / walletBalance) * 100 : 0;
    const totalDebt = positions.reduce((s,p)=>s+(p.cumulativeHedgeLoss||0), 0);

    // 标准币安合约可用保证金算法：(钱包余额 + 浮动盈亏) - (总持仓 / 杠杆倍数)
    const CONTRACT_LEVERAGE = 20;
    const totalPositionValue = positions.reduce((sum, p) => (p.amount * p.entryPrice), 0);
    const availableMarginWithLeverage = Math.max(0, (walletBalance + totalPnL) - (totalPositionValue / CONTRACT_LEVERAGE));

    // 账户健康度算法：可用保证金 / 钱包余额
    const calculatedMarginRatio = walletBalance > 0 ? (availableMarginWithLeverage / walletBalance * 100) : 0;

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

    const handleForceReconnect = () => {
        binanceWs.forceReconnect();
    };

    const timeSinceLastMessage = Date.now() - wsStatus.lastMessageTime;
    const isHealthy = wsStatus.isConnected && timeSinceLastMessage < 3000;
    const isWarning = wsStatus.isConnected && timeSinceLastMessage >= 3000 && timeSinceLastMessage < 10000;
    const isError = !wsStatus.isConnected || timeSinceLastMessage >= 10000;

    return (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 shrink-0">
            {/* Finance Stats Panel */}
            <div className="md:col-span-4 bg-[#0b0e11] rounded border border-slate-800 p-2 shadow-inner">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div className="flex flex-col justify-center pl-3">
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">可用保证金 / 钱包余额</span>
                        <div className="flex items-baseline gap-1">
                            <span className="text-xl font-mono text-slate-100 font-bold">{availableMarginWithLeverage.toFixed(0)}</span>
                            <span className="text-slate-700 mx-1">/</span>
                            <span className="text-lg font-mono text-slate-400">{walletBalance.toFixed(0)}</span>
                            <span className="text-[10px] text-slate-600 ml-1">U</span>
                        </div>
                    </div>
                    <div className="flex flex-col justify-center pl-3 border-l border-slate-800/50">
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">账户健康度 / 浮动盈亏</span>
                        <div className="flex items-baseline gap-1">
                            <span className={`text-lg font-mono font-bold ${calculatedMarginRatio >= 50 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                {calculatedMarginRatio.toFixed(1)}%
                            </span>
                            <span className="text-slate-700 mx-1">/</span>
                            <div className={`flex items-baseline gap-1 text-sm font-mono ${totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                <span>{totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(0)}</span>
                                <span className="text-[9px] opacity-70">({totalPnLPercentage.toFixed(1)}%)</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-col justify-center pl-3 border-l border-slate-800/50">
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">活动仓位 / 币种数</span>
                        <div className="flex items-baseline gap-2">
                            <span className="text-lg font-mono text-white font-bold">{positions.length}</span>
                            <span className="text-[10px] text-slate-600 font-bold tracking-widest uppercase">POSITIONS</span>
                        </div>
                    </div>
                    <div className="flex flex-col justify-center pl-3 border-l border-slate-800/50">
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">债务总额 (Hedge Debt)</span>
                        <div className="flex items-baseline gap-1">
                            <span className="text-lg font-mono text-red-500 font-bold">-{totalDebt.toFixed(0)}</span>
                            <span className="text-[10px] text-slate-600 ml-1 uppercase">USDT</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Global Actions Panel */}
            <div className="bg-[#0b0e11] p-2 rounded border border-slate-800 flex flex-col justify-center gap-2">
                <div className="flex gap-2">
                    <button onClick={onToggleSimulation} className={`flex-1 py-1.5 rounded text-[10px] font-bold flex items-center justify-center gap-1 transition-all ${isSimulating ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}>
                        {isSimulating ? <Pause size={12}/> : <Play size={12}/>} {isSimulating ? '暂停' : '启动'}
                    </button>
                    
                    {/* Connection Status / Watchdog Button */}
                    <button 
                        onClick={handleForceReconnect}
                        title="点击强制刷新币安连接"
                        className={`flex-1 py-1.5 rounded text-[10px] font-bold flex items-center justify-center gap-1 transition-all border
                            ${isHealthy ? 'bg-emerald-900/20 text-emerald-400 border-emerald-800/50 hover:bg-emerald-900/40' : 
                              isWarning ? 'bg-amber-900/20 text-amber-400 border-amber-800/50 hover:bg-amber-900/40' : 
                              'bg-red-900/20 text-red-400 border-red-800/50 hover:bg-red-900/40'}`}
                    >
                        <RefreshCw size={12} className={isHealthy ? 'animate-spin-slow' : isWarning ? '' : 'animate-spin'} />
                        {isHealthy ? '正常' : isWarning ? '延迟' : '断开'}
                    </button>

                    <button onClick={handleBatchCloseWithConfirm} className={`flex-1 py-1.5 rounded text-[10px] font-bold transition-all flex items-center justify-center gap-1 border ${confirmClear ? 'bg-red-600 hover:bg-red-700 text-white border-red-400 animate-pulse' : 'bg-slate-800 hover:bg-red-900/50 text-slate-400 border-slate-700'}`}>
                        {confirmClear ? <AlertCircle size={12}/> : <Trash2 size={12}/>} {confirmClear ? '确认?' : '清仓'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DashboardHeader;
