import React from 'react';
import { Play, Pause, RotateCw, WifiOff, Activity, AlertTriangle, Zap, RefreshCw } from 'lucide-react';
import { binanceWs } from '../../../services/binanceWs';
import { audioService } from '../../../services/audioService';

interface Props {
    networkStatus: 'healthy' | 'delayed' | 'disconnected' | 'unknown';
    isOnline: boolean;
    realPricesCount: number;
    isSimulating: boolean;
    onToggleSimulation: () => void;
}

export const GlobalActionsPanel: React.FC<Props> = ({
    networkStatus, isOnline, realPricesCount, isSimulating, onToggleSimulation
}) => {
    const isNetworkError = !isOnline || networkStatus === 'disconnected';

    return (
        <div className={`bg-[#0b0e11] p-1.5 rounded border flex flex-col justify-between gap-1.5 h-full transition-colors ${
            isNetworkError ? 'border-red-500/50 bg-red-950/10 shadow-[0_0_15px_rgba(239,68,68,0.1)]' : 'border-slate-800'
        }`}>
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                    <span className="text-[9px] text-slate-500 font-black uppercase tracking-widest">
                        {isNetworkError ? '网络故障警告' : '核心控制台'}
                    </span>
                    {isNetworkError && (
                        <span className="bg-red-500 text-[8px] px-1 rounded text-white animate-pulse font-mono">CODE: NET_ERR</span>
                    )}
                </div>
                
                <div className="flex items-center gap-2">
                    <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${
                        !isOnline || networkStatus === 'disconnected' ? 'bg-red-900/30 border-red-500/50' :
                        networkStatus === 'delayed' ? 'bg-amber-900/30 border-amber-500/50' :
                        'bg-slate-900 border-slate-800'
                    }`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${
                            !isOnline || networkStatus === 'disconnected' ? 'bg-red-500 animate-pulse' :
                            networkStatus === 'delayed' ? 'bg-amber-500 animate-pulse' :
                            'bg-emerald-500'
                        }`} />
                        <span className="text-[8px] font-black font-mono text-slate-300">
                            {!isOnline ? 'OFFLINE' : networkStatus.toUpperCase()}
                        </span>
                    </div>
                </div>
            </div>

            {isNetworkError ? (
                <div className="flex-1 flex gap-2 items-center min-h-0 overflow-hidden">
                    <div className="flex-1 flex flex-col justify-center min-w-0">
                         <div className="flex items-center gap-1.5 text-red-400">
                            <AlertTriangle size={12} className="shrink-0" />
                            <span className="text-[9px] font-bold leading-tight uppercase truncate">
                                {!isOnline ? '本地网络断开' : '行情连线受阻'}
                            </span>
                        </div>
                        <p className="text-[8px] text-slate-500 leading-none mt-1 truncate">
                            系统锁定中，请重连或刷新。
                        </p>
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                         <button 
                            onClick={() => {
                                binanceWs.forceReconnect();
                                audioService.speak("启动紧急重连");
                            }}
                            className="bg-white text-slate-950 px-2 py-0.5 rounded text-[8px] font-black flex items-center justify-center gap-1 hover:bg-indigo-50 transition-all active:scale-95 border-b border-slate-300"
                        >
                            <Zap size={9} fill="currentColor" /> 强制重连
                        </button>
                        <button 
                            onClick={() => window.location.reload()}
                            className="bg-red-600 text-white px-2 py-0.5 rounded text-[8px] font-black flex items-center justify-center gap-1 hover:bg-red-500 transition-all active:scale-95"
                        >
                            <RefreshCw size={9} /> 硬重启
                        </button>
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex gap-2 min-h-0">
                    <div className="flex-1 grid grid-cols-2 gap-1.5">
                        <button 
                            onClick={() => binanceWs.fetchRestPrices()}
                            className="text-[9px] bg-slate-800 hover:bg-slate-700 text-slate-400 py-1 rounded border border-slate-700 transition-colors flex flex-col items-center justify-center gap-1 leading-none"
                        >
                            <RotateCw size={10} />
                            <span>抓取价格</span>
                        </button>
                        <button 
                            onClick={() => binanceWs.forceReconnect()}
                            className="text-[9px] bg-slate-800 hover:bg-slate-700 text-slate-400 py-1 rounded border border-slate-700 transition-colors flex flex-col items-center justify-center gap-1 leading-none"
                        >
                            <Activity size={10} />
                            <span>重连WS</span>
                        </button>
                    </div>
                    <button 
                        onClick={onToggleSimulation} 
                        className={`w-14 rounded text-[9px] font-black flex flex-col items-center justify-center gap-1 transition-all shadow-sm ${
                            isSimulating ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                        }`}
                    >
                        {isSimulating ? <Pause size={12}/> : <Play size={12}/>}
                        <span>{isSimulating ? '暂停' : '启动'}</span>
                    </button>
                </div>
            )}
        </div>
    );
};
