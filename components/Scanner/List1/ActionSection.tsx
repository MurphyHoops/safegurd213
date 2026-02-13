
import React from 'react';
import { Loader2, RefreshCw, Play } from 'lucide-react';

interface Props {
    scanInterval: number;
    setScanInterval: (v: number) => void;
    isScanning: boolean;
    countdown: string;
    scanStatusText: string;
    onScan: () => void;
}

export const ActionSection: React.FC<Props> = ({ scanInterval, setScanInterval, isScanning, countdown, scanStatusText, onScan }) => {
    return (
        <div className="space-y-3">
            {/* Unified Status Row */}
            <div className="flex items-center justify-between bg-slate-800/50 rounded p-1.5 mb-1 border border-slate-700/50 h-9">
                {/* Left: Loop Input */}
                <div className="flex items-center gap-1.5 border-r border-slate-700 pr-2 mr-2">
                    <span className="text-[9px] text-slate-500 font-bold whitespace-nowrap">循环(min)</span>
                    <input type="number" min="1" value={scanInterval} onChange={(e) => setScanInterval(Math.max(1, parseInt(e.target.value) || 1))} className="w-8 h-5 bg-slate-900 border border-slate-700 rounded text-center text-[10px] text-white outline-none font-bold focus:border-emerald-500" />
                </div>
                
                {/* Center: Countdown */}
                <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-emerald-400 border-r border-slate-700 pr-2 mr-2">
                    <RefreshCw size={10} className={isScanning ? 'animate-spin' : ''} />
                    {countdown}
                </div>

                {/* Right: System Status */}
                <div className="flex-1 flex justify-end overflow-hidden">
                    {isScanning ? (
                        <div className="flex items-center gap-1.5 text-[9px] text-orange-300 animate-pulse">
                            <Loader2 size={10} className="animate-spin" />
                            <span className="truncate">运行中...</span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5 text-[9px] text-emerald-400">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.8)]" />
                            <span className="truncate">待机中</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Big Action Button */}
            <button 
                onClick={onScan} 
                disabled={isScanning} 
                className={`w-full h-10 font-bold rounded text-xs flex items-center justify-center gap-2 shadow-lg transition-all disabled:opacity-80 disabled:cursor-not-allowed ${
                    isScanning 
                    ? 'bg-slate-800 text-orange-300 border border-orange-500/30' 
                    : 'bg-[#0f766e] hover:bg-[#0d9488] text-white shadow-emerald-900/30 border border-emerald-500/50'
                }`}
            >
                {isScanning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
                {isScanning ? scanStatusText : '启动扫描引擎'}
            </button>
        </div>
    );
};
