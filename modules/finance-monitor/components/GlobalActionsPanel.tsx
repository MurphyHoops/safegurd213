import React, { useState, useEffect } from 'react';
import { Play, Pause, RotateCw, Globe, Copy, Check, RefreshCw, Activity, AlertTriangle, ShieldCheck } from 'lucide-react';
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
    const [serverIp, setServerIp] = useState<string>('');
    const [isFetchingIp, setIsFetchingIp] = useState<boolean>(false);
    const [copiedIp, setCopiedIp] = useState<boolean>(false);

    const isNetworkError = !isOnline || networkStatus === 'disconnected';
    const isRealTrading = settings?.system?.realTrading;

    const fetchServerIp = async () => {
        setIsFetchingIp(true);
        try {
            const res = await fetch('/api/server-ip');
            const data = await res.json();
            if (data && data.success && data.ip) {
                setServerIp(data.ip);
            } else {
                setServerIp('获取失败');
            }
        } catch {
            setServerIp('异常');
        } finally {
            setIsFetchingIp(false);
        }
    };

    useEffect(() => {
        fetchServerIp();
    }, []);

    const handleCopyIp = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!serverIp || serverIp === '获取失败' || serverIp === '异常' || serverIp === '...') return;
        try {
            navigator.clipboard.writeText(serverIp);
            setCopiedIp(true);
            setTimeout(() => setCopiedIp(false), 1600);
        } catch (err) {
            console.error("Failed to copy IP", err);
        }
    };

    return (
        <div className={`bg-[#0b0e11] p-1.5 rounded border flex flex-col justify-between gap-1 h-full transition-colors ${
            isNetworkError 
                ? 'border-red-500/50 bg-red-950/10 shadow-[0_0_15px_rgba(239,68,68,0.1)]' 
                : isRealTrading 
                    ? 'border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.05)]' 
                    : 'border-slate-800'
        }`}>
            {/* Top Bar: Title + IP Badge & Refresh + Network Widget */}
            <div className="flex items-center justify-between gap-1 px-0.5">
                <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[9px] text-slate-400 font-black uppercase tracking-wider">
                        {isRealTrading ? '实盘控制台' : isNetworkError ? '网络故障警报' : '核心控制台'}
                    </span>
                    {isRealTrading ? (
                        <span className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[8px] px-1 py-0.2 rounded font-mono font-bold flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                            LIVE
                        </span>
                    ) : isNetworkError ? (
                        <span className="bg-red-500 text-[8px] px-1 py-0.2 rounded text-white animate-pulse font-mono font-bold">
                            NET_ERR
                        </span>
                    ) : (
                        <span className="bg-slate-800/80 border border-slate-700 text-slate-400 text-[8px] px-1 py-0.2 rounded font-mono">
                            SIM
                        </span>
                    )}
                </div>

                {/* Right Side: IP Pill + Network Status */}
                <div className="flex items-center gap-1 min-w-0">
                    {/* IP Display Pill with Copy & Refresh */}
                    <div 
                        onClick={handleCopyIp}
                        title={copiedIp ? "已复制到剪贴板！" : "点击复制服务器出口 IP（用于币安 API 白名单）"}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded border transition-all cursor-pointer select-none ${
                            copiedIp 
                                ? 'bg-emerald-950/70 border-emerald-500/60 text-emerald-300' 
                                : 'bg-slate-900/90 border-slate-800 hover:border-cyan-500/40 text-slate-300 hover:text-white'
                        }`}
                    >
                        <Globe size={10} className={isFetchingIp ? "text-cyan-400 animate-spin" : copiedIp ? "text-emerald-400" : "text-cyan-400 shrink-0"} />
                        <span className="text-[8.5px] font-mono font-bold tracking-tight">
                            {isFetchingIp ? 'IP检测中' : copiedIp ? '已复制' : (serverIp ? `IP: ${serverIp}` : 'IP: 加载中')}
                        </span>
                        {copiedIp ? (
                            <Check size={9} className="text-emerald-400 shrink-0" />
                        ) : (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    fetchServerIp();
                                }}
                                title="重新检测并刷新服务器出口 IP"
                                className="p-0.5 rounded hover:bg-slate-700/60 text-slate-400 hover:text-cyan-300 transition-colors ml-0.5"
                            >
                                <RefreshCw size={8} className={isFetchingIp ? "animate-spin text-cyan-400" : ""} />
                            </button>
                        )}
                    </div>

                    {/* Network Status Widget */}
                    <div className="shrink-0">
                        <NetworkWidget 
                            networkStatus={networkStatus}
                            isOnline={isOnline}
                            compact={true}
                        />
                    </div>
                </div>
            </div>

            {/* Bottom Bar: Action Buttons & Master Control */}
            {isRealTrading ? (
                <div className="flex-1 flex gap-1.5 items-center min-h-0 bg-emerald-950/15 border border-emerald-500/25 rounded px-2 py-0.5">
                    <div className="flex-1 flex items-center gap-1.5 min-w-0">
                        <ShieldCheck size={12} className="text-emerald-400 shrink-0" />
                        <div className="flex flex-col min-w-0">
                            <span className="text-[8.5px] font-bold text-emerald-300 leading-tight truncate">
                                币安实盘实时交易中
                            </span>
                            <span className="text-[7.5px] text-slate-400 leading-none truncate">
                                模拟测试已自动禁用保护
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        <button 
                            onClick={() => binanceWs.fetchRestPrices()}
                            className="text-[8.5px] bg-slate-800/90 hover:bg-slate-700 text-slate-200 px-1.5 py-1 rounded border border-slate-700 transition-colors flex items-center gap-1 font-bold"
                            title="从币安 REST API 立即抓取全部最新价格"
                        >
                            <RotateCw size={9} className="text-cyan-400" />
                            <span>抓取价格</span>
                        </button>
                        <button 
                            onClick={() => {
                                binanceWs.forceReconnect();
                                audioService.speak("正在重连行情");
                            }}
                            className="text-[8.5px] bg-slate-800/90 hover:bg-slate-700 text-slate-200 px-1.5 py-1 rounded border border-slate-700 transition-colors flex items-center gap-1 font-bold"
                            title="重新建立行情 WebSocket 管道"
                        >
                            <Activity size={9} className="text-indigo-400" />
                            <span>重连WS</span>
                        </button>
                    </div>
                </div>
            ) : isNetworkError ? (
                <div className="flex-1 flex gap-1.5 items-center min-h-0 bg-red-950/20 border border-red-500/30 rounded px-2 py-0.5">
                    <div className="flex-1 flex items-center gap-1.5 min-w-0">
                        <AlertTriangle size={12} className="text-red-400 shrink-0 animate-bounce" />
                        <span className="text-[8.5px] font-bold text-red-300 truncate">
                            {!isOnline ? '本地网络断开' : '币安行情连线受阻，自愈重连中...'}
                        </span>
                    </div>
                    <button 
                        onClick={() => {
                            binanceWs.forceReconnect();
                            binanceWs.fetchRestPrices();
                            fetchServerIp();
                        }}
                        className="text-[8.5px] bg-red-600 hover:bg-red-500 text-white px-2 py-1 rounded font-black flex items-center gap-1 transition-all shrink-0"
                    >
                        <RefreshCw size={8} className="animate-spin" />
                        <span>立即重连</span>
                    </button>
                </div>
            ) : (
                <div className="flex-1 flex gap-1.5 min-h-0 items-center">
                    <div className="flex-1 grid grid-cols-2 gap-1 h-full">
                        <button 
                            onClick={() => binanceWs.fetchRestPrices()}
                            className="text-[8.5px] bg-slate-800/80 hover:bg-slate-700 text-slate-200 py-1 px-1 rounded border border-slate-700/80 hover:border-slate-600 transition-all flex items-center justify-center gap-1 leading-none font-bold active:scale-98"
                            title="从币安 REST API 立即抓取全部最新价格"
                        >
                            <RotateCw size={9} className="text-cyan-400 shrink-0" />
                            <span className="truncate">抓取价格</span>
                        </button>
                        <button 
                            onClick={() => {
                                binanceWs.forceReconnect();
                                audioService.speak("正在重连行情");
                            }}
                            className="text-[8.5px] bg-slate-800/80 hover:bg-slate-700 text-slate-200 py-1 px-1 rounded border border-slate-700/80 hover:border-slate-600 transition-all flex items-center justify-center gap-1 leading-none font-bold active:scale-98"
                            title="重新建立行情 WebSocket 管道"
                        >
                            <Activity size={9} className="text-indigo-400 shrink-0" />
                            <span className="truncate">重连WS</span>
                        </button>
                    </div>
                    <button 
                        onClick={onToggleSimulation} 
                        className={`w-14 h-full rounded text-[8.5px] font-black flex items-center justify-center gap-1 transition-all shadow-sm active:scale-98 border shrink-0 ${
                            isSimulating 
                                ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400/40' 
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700 hover:text-white'
                        }`}
                        title={isSimulating ? "点击暂停模拟撮合调度" : "点击启动模拟撮合调度"}
                    >
                        {isSimulating ? <Pause size={10} className="fill-white"/> : <Play size={10} className="fill-slate-300"/>}
                        <span>{isSimulating ? '暂停' : '启动'}</span>
                    </button>
                </div>
            )}
        </div>
    );
};
