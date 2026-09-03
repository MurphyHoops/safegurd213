import React, { useState, useEffect, useRef } from 'react';
import { Activity, RefreshCw, XCircle, CheckCircle, Zap, ShieldCheck } from 'lucide-react';
import { binanceWs } from '../services/binanceWs';
import { audioService } from '../services/audioService';

interface Props {
    networkStatus: 'healthy' | 'delayed' | 'disconnected' | 'unknown';
    isOnline?: boolean;
    compact?: boolean;
}

export const NetworkWidget: React.FC<Props> = ({ networkStatus, isOnline = true, compact = false }) => {
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [timeSinceDisconnect, setTimeSinceDisconnect] = useState(0);
    const [autoReconnect, setAutoReconnect] = useState<boolean>(() => {
        try {
            const saved = localStorage.getItem('BINANCE_AUTO_RECONNECT_ACTIVE');
            return saved !== null ? JSON.parse(saved) : true;
        } catch {
            return true;
        }
    });
    const [reconnectAttempts, setReconnectAttempts] = useState(0);
    const hasSpokenAlertRef = useRef(false);

    // Save auto-reconnect preference
    const handleToggleAutoReconnect = (e: React.MouseEvent) => {
        e.stopPropagation();
        const next = !autoReconnect;
        setAutoReconnect(next);
        try {
            localStorage.setItem('BINANCE_AUTO_RECONNECT_ACTIVE', JSON.stringify(next));
        } catch {}
        if (next) {
            audioService.speak("已开启币安网络异常自动重连");
        } else {
            audioService.speak("已关闭自动重连");
        }
    };

    const handleManualRefresh = (e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setIsRefreshing(true);
        setReconnectAttempts(prev => prev + 1);
        binanceWs.forceReconnect();
        binanceWs.fetchRestPrices();
        setTimeout(() => setIsRefreshing(false), 1500);
    };

    const isDisconnected = !isOnline || networkStatus === 'disconnected';
    const isAbnormal = isDisconnected || networkStatus === 'delayed';

    // Track disconnect duration and manage audio alert
    useEffect(() => {
        let interval: any;
        if (isAbnormal) {
            interval = setInterval(() => {
                setTimeSinceDisconnect(prev => prev + 1);
            }, 1000);

            if (!hasSpokenAlertRef.current && timeSinceDisconnect === 0) {
                hasSpokenAlertRef.current = true;
                if (autoReconnect && isDisconnected) {
                    audioService.speak("检测到行情连接异常，已启动自动连接币安交易所", true);
                }
            }
        } else {
            setTimeSinceDisconnect(0);
            setReconnectAttempts(0);
            hasSpokenAlertRef.current = false;
        }
        return () => clearInterval(interval);
    }, [isAbnormal, isDisconnected, autoReconnect]);

    // Active Auto-Reconnect Loop: only trigger forceReconnect when completely DISCONNECTED for > 6s,
    // avoid repeatedly killing healthy sockets during minor latency or initial handshake!
    useEffect(() => {
        if (isDisconnected && autoReconnect && timeSinceDisconnect >= 6) {
            const autoTimer = setInterval(() => {
                setReconnectAttempts(prev => prev + 1);
                console.log(`[NetworkWidget] Auto-reconnecting to Binance exchange (Attempt ${reconnectAttempts + 1})...`);
                binanceWs.forceReconnect();
                binanceWs.fetchRestPrices();
            }, 6000);

            return () => clearInterval(autoTimer);
        } else if (networkStatus === 'delayed' && autoReconnect) {
            // If only delayed, fetch REST fallback in background without killing WebSocket
            const delayedTimer = setInterval(() => {
                binanceWs.fetchRestPrices();
            }, 5000);
            return () => clearInterval(delayedTimer);
        }
    }, [isDisconnected, networkStatus, autoReconnect, timeSinceDisconnect, reconnectAttempts]);

    const getStatusConfig = () => {
        if (!isOnline || networkStatus === 'disconnected') {
            return {
                bg: 'bg-red-950/40',
                border: 'border-red-500/50',
                text: 'text-red-400',
                dot: 'bg-red-500',
                label: autoReconnect ? `自动重连币安中 (${timeSinceDisconnect}s/第${reconnectAttempts || 1}次)` : `币安连接断开 (${timeSinceDisconnect}s)`,
                icon: <XCircle size={11} className="text-red-400 shrink-0" />
            };
        }
        if (networkStatus === 'delayed') {
            return {
                bg: 'bg-amber-950/30',
                border: 'border-amber-500/40',
                text: 'text-amber-300',
                dot: 'bg-amber-400',
                label: autoReconnect ? `行情延迟·正在自愈重连` : `行情存在延迟`,
                icon: <Activity size={11} className="text-amber-400 shrink-0" />
            };
        }
        return {
            bg: 'bg-emerald-950/30',
            border: 'border-emerald-500/30',
            text: 'text-emerald-400',
            dot: 'bg-emerald-400',
            label: '币安行情已连接',
            icon: <CheckCircle size={11} className="text-emerald-400 shrink-0" />
        };
    };

    const config = getStatusConfig();

    return (
        <div 
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded border transition-all select-none ${config.bg} ${config.border} ${
                isAbnormal ? 'shadow-[0_0_10px_rgba(239,68,68,0.15)] animate-pulse' : ''
            }`}
            title="币安交易所行情连接状态与自动自愈机制：当发现网络出问题时，自动连接币安交易所。"
        >
            {/* Status indicator */}
            <div className={`flex items-center gap-1 text-[10px] font-bold ${config.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${config.dot} ${isAbnormal ? 'animate-ping' : ''}`} />
                <span className="truncate max-w-[170px]">{config.label}</span>
            </div>

            {/* Auto Reconnect Toggle Pill */}
            <button
                type="button"
                onClick={handleToggleAutoReconnect}
                className={`px-1 py-0.2 rounded text-[9px] font-bold border transition-colors flex items-center gap-0.5 ${
                    autoReconnect 
                        ? 'bg-indigo-950/60 text-indigo-300 border-indigo-500/40 hover:bg-indigo-900/80' 
                        : 'bg-slate-900 text-slate-500 border-slate-700 hover:text-slate-300'
                }`}
                title={autoReconnect ? "【自动连接币安】已激活：检测到断线或延迟将自动重连（点击关闭）" : "【自动连接币安】已关闭（点击开启）"}
            >
                <Zap size={8} className={autoReconnect ? "text-indigo-400 fill-indigo-400" : "text-slate-500"} />
                <span>{autoReconnect ? "自动连接:开" : "自动连接:关"}</span>
            </button>
            
            {/* Manual Reconnect Button */}
            <button
                type="button"
                onClick={handleManualRefresh}
                disabled={isRefreshing}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border transition-all ${
                    isRefreshing
                        ? 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed'
                        : isAbnormal
                            ? 'bg-red-600 hover:bg-red-500 text-white border-red-400 animate-bounce shadow-sm'
                            : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white hover:border-slate-500'
                }`}
                title="立即强制重连币安交易所并同步最新行情"
            >
                <RefreshCw size={9} className={isRefreshing ? 'animate-spin' : ''} />
                <span>{isRefreshing ? '连接中' : '重连'}</span>
            </button>
        </div>
    );
};
