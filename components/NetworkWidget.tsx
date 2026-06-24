import React, { useState, useEffect } from 'react';
import { Activity, RefreshCw, XCircle, CheckCircle } from 'lucide-react';
import { binanceWs } from '../services/binanceWs';

interface Props {
    networkStatus: 'healthy' | 'delayed' | 'disconnected';
}

export const NetworkWidget: React.FC<Props> = ({ networkStatus }) => {
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [timeSinceDisconnect, setTimeSinceDisconnect] = useState(0);

    const handleRefresh = () => {
        setIsRefreshing(true);
        binanceWs.forceReconnect();
        setTimeout(() => setIsRefreshing(false), 2000); // UI visual cooldown
    };

    // Keep track of disconnect time for intelligent UI
    useEffect(() => {
        let interval: any;
        if (networkStatus === 'disconnected') {
            interval = setInterval(() => {
                setTimeSinceDisconnect(prev => prev + 1);
            }, 1000);
        } else {
            setTimeSinceDisconnect(0);
        }
        return () => clearInterval(interval);
    }, [networkStatus]);

    // Intelligent Auto-Refresh mechanism triggered strictly if disconnected for specific milestones
    // Avoids high-frequency crashing loops
    useEffect(() => {
        if (networkStatus === 'disconnected') {
            // Milestone-based auto reconnect: 5s, 15s, 30s, 60s
            if (timeSinceDisconnect === 5 || timeSinceDisconnect === 15 || timeSinceDisconnect === 30 || timeSinceDisconnect === 60) {
                console.log(`[NetworkWidget] Intelligent auto-refresh triggered at ${timeSinceDisconnect}s disconnected.`);
                binanceWs.forceReconnect();
            }
        }
    }, [timeSinceDisconnect, networkStatus]);

    const getStatusConfig = () => {
        switch (networkStatus) {
            case 'healthy':
                return {
                    bg: 'bg-emerald-900/20',
                    border: 'border-emerald-500/30',
                    text: 'text-emerald-400',
                    label: '行情网络畅通',
                    icon: <CheckCircle size={12} className="text-emerald-400" />
                };
            case 'delayed':
                return {
                    bg: 'bg-amber-900/20',
                    border: 'border-amber-500/30',
                    text: 'text-amber-400',
                    label: '网络存在延迟',
                    icon: <Activity size={12} className="text-amber-400" />
                };
            case 'disconnected':
                return {
                    bg: 'bg-red-900/20',
                    border: 'border-red-500/30',
                    text: 'text-red-400',
                    label: `网络联接断开 ${timeSinceDisconnect > 0 ? `(${timeSinceDisconnect}s)` : ''}`,
                    icon: <XCircle size={12} className="text-red-400" />
                };
            default:
                return {
                    bg: 'bg-slate-900/20',
                    border: 'border-slate-500/30',
                    text: 'text-slate-400',
                    label: '状态未知',
                    icon: <Activity size={12} className="text-slate-400" />
                };
        }
    };

    const config = getStatusConfig();

    return (
        <div className={`flex items-center gap-3 px-3 py-1 rounded-md ${config.bg} border ${config.border} transition-colors duration-300`}>
            <div className={`flex items-center gap-1.5 flex-1 text-xs font-medium ${config.text}`}>
                {config.icon}
                <span className="animate-pulse">{config.label}</span>
            </div>
            
            <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold border transition-all ${
                    isRefreshing
                        ? 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed'
                        : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white hover:border-slate-500'
                }`}
                title="手动重置并刷新行情连接"
            >
                <RefreshCw size={10} className={isRefreshing ? 'animate-spin' : ''} />
                {isRefreshing ? '重新联接...' : '刷新'}
            </button>
        </div>
    );
};
