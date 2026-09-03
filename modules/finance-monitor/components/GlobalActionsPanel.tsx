import React from 'react';
import { Play, Pause, RotateCw, WifiOff, Activity, AlertTriangle, Zap, RefreshCw } from 'lucide-react';
import { binanceWs } from '../../../services/binanceWs';
import { audioService } from '../../../services/audioService';
import { NetworkWidget } from '../../../components/NetworkWidget';
import { AppSettings } from '../../../types';

interface Props {
    networkStatus: 'healthy' | 'delayed' | 'disconnected' | 'unknown';
    isOnline: boolean;
    realPricesCount: number;
    isSimulating: boolean;
    onToggleSimulation: () => void;
    settings?: AppSettings;
}

export const GlobalActionsPanel: React.FC<Props> = ({
    networkStatus, isOnline, realPricesCount, isSimulating, onToggleSimulation, settings
}) => {
    const isNetworkError = !isOnline || networkStatus === 'disconnected';
    const isRealTrading = settings?.system?.realTrading;

    return (
        <div className={`bg-[#0b0e11] p-1.5 rounded border flex flex-col justify-between gap-1 h-full transition-colors ${
            isNetworkError ? 'border-red-500/50 bg-red-950/10 shadow-[0_0_15px_rgba(239,68,68,0.1)]' : 'border-slate-800'
        }`}>
            {/* Header: Title + Status + Network Control Widget */}
            <div className="flex items-center justify-between px-1 gap-1">
                <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[9px] text-slate-500 font-black uppercase tracking-widest">
                        {isRealTrading ? '实盘核心状态' : isNetworkError ? '网络故障警告' : '核心控制台'}
                    </span>
                    {isNetworkError && (
                        <span className="bg-red-500 text-[8px] px-1 rounded text-white animate-pulse font-mono">NET_ERR</span>
                    )}
                    {isRealTrading && (
                        <span className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[8px] px-1 rounded font-mono animate-pulse">LIVE TRADING</span>
                    )}
                </div>
                
                {/* 币安行情连接与自动连接/重连全部按钮组件 */}
                <div className="shrink-0">
                    <NetworkWidget 
                        networkStatus={networkStatus}
                        isOnline={isOnline}
                    />
                </div>
            </div>

            {/* Content & Simulation controls */}
            {isRealTrading ? (
                <div className="flex-1 flex gap-2 items-center min-h-0 overflow-hidden bg-emerald-950/10 border border-emerald-500/25 rounded px-2 py-0.5">
                    <div className="flex-1 flex flex-col justify-center min-w-0">
                         <div className="flex items-center gap-1 text-amber-400">
                            <AlertTriangle size={11} className="shrink-0 animate-bounce" />
                            <span className="text-[9px] font-black leading-tight uppercase truncate">
                                实盘已连接：禁用模拟测试
                            </span>
                        </div>
                        <p className="text-[8px] text-slate-400 leading-tight mt-0.5 font-sans truncate">
                            ⚠️ 实盘模式已运行！实盘交易时不能进行任何模拟测试。
                        </p>
                    </div>
                    <button 
                        disabled
                        className="w-14 shrink-0 rounded text-[9px] font-black flex flex-col items-center justify-center gap-0.5 bg-emerald-950/50 text-emerald-500/50 border border-emerald-500/20 cursor-not-allowed py-1"
                        title="实盘交易进行中，不能进行模拟测试"
                    >
                        <Pause size={11} className="opacity-60" />
                        <span>锁定</span>
                    </button>
                </div>
            ) : isNetworkError ? (
                <div className="flex-1 flex gap-2 items-center min-h-0 overflow-hidden px-1">
                    <div className="flex-1 flex flex-col justify-center min-w-0">
                         <div className="flex items-center gap-1.5 text-red-400">
                            <AlertTriangle size={12} className="shrink-0" />
                            <span className="text-[9px] font-bold leading-tight uppercase truncate">
                                {!isOnline ? '本地网络断开' : '行情连线受阻'}
                            </span>
                        </div>
                        <p className="text-[8px] text-slate-500 leading-none mt-0.5 truncate">
                            系统自动重连中，请等待恢复。
                        </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        <button 
                            onClick={() => window.location.reload()}
                            className="bg-red-600 text-white px-2 py-1 rounded text-[8px] font-black flex items-center justify-center gap-1 hover:bg-red-500 transition-all active:scale-95"
                        >
                            <RefreshCw size={9} /> 刷新
                        </button>
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex gap-2 min-h-0 items-center">
                    <div className="flex-1 grid grid-cols-2 gap-1.5">
                        <button 
                            onClick={() => binanceWs.fetchRestPrices()}
                            className="text-[9px] bg-slate-800 hover:bg-slate-700 text-slate-300 py-1 rounded border border-slate-700 transition-colors flex items-center justify-center gap-1 leading-none font-bold"
                            title="从币安 REST API 立即抓取全部最新价格"
                        >
                            <RotateCw size={10} />
                            <span>抓取价格</span>
                        </button>
                        <button 
                            onClick={() => {
                                binanceWs.forceReconnect();
                                audioService.speak("正在重连行情");
                            }}
                            className="text-[9px] bg-slate-800 hover:bg-slate-700 text-slate-300 py-1 rounded border border-slate-700 transition-colors flex items-center justify-center gap-1 leading-none font-bold"
                            title="重新建立行情 WebSocket 管道"
                        >
                            <Activity size={10} />
                            <span>重连WS</span>
                        </button>
                    </div>
                    <button 
                        onClick={onToggleSimulation} 
                        className={`w-14 h-full rounded text-[9px] font-black flex flex-col items-center justify-center gap-0.5 transition-all shadow-sm ${
                            isSimulating ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                        }`}
                    >
                        {isSimulating ? <Pause size={11}/> : <Play size={11}/>}
                        <span>{isSimulating ? '暂停' : '启动'}</span>
                    </button>
                </div>
            )}
        </div>
    );
};
