
import React, { useState } from 'react';
import { AutoPilotProps } from './types';
import { RefreshCw, Play, Pause, BarChart2, History, Activity } from 'lucide-react';
import { AdvancedBacktester } from '../backtester/AdvancedBacktester';

export const AutoPilotModule: React.FC<AutoPilotProps> = ({ isSimulating, onToggleSim, onOpenScanner, settings }) => {
    const [mode, setMode] = useState<'live' | 'backtest'>('live');

    return (
        <div className="bg-slate-800/30 border-b border-slate-800">
            {/* Tab Switcher */}
            <div className="flex border-b border-slate-800">
                <button 
                    onClick={() => setMode('live')}
                    className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${mode === 'live' ? 'bg-slate-800 text-cyan-400 border-b-2 border-cyan-500' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    <Activity size={12} /> 实盘/模拟监控
                </button>
                <button 
                    onClick={() => setMode('backtest')}
                    className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${mode === 'backtest' ? 'bg-slate-800 text-amber-400 border-b-2 border-amber-500' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    <History size={12} /> 历史回测系统
                </button>
            </div>

            <div className="p-4 space-y-4">
                {mode === 'live' ? (
                    <>
                        <div className="flex items-center justify-between bg-slate-800 p-2 rounded border border-slate-700">
                            <span className="text-xs font-bold text-slate-300">模拟交易系统</span>
                            <button 
                                onClick={onToggleSim}
                                className={`px-3 py-1 rounded text-[10px] font-bold flex items-center gap-1 ${isSimulating ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-400'}`}
                            >
                                {isSimulating ? <Pause size={10}/> : <Play size={10}/>}
                                {isSimulating ? '运行中' : '已暂停'}
                            </button>
                        </div>
                        
                        <button 
                            onClick={onOpenScanner}
                            className="w-full py-2 bg-cyan-900/30 hover:bg-cyan-900/50 border border-cyan-500/30 text-cyan-400 rounded text-xs font-bold flex items-center justify-center gap-2"
                        >
                            <BarChart2 size={14}/> 打开智能扫描器
                        </button>
                    </>
                ) : (
                    <AdvancedBacktester settings={settings} />
                )}
            </div>
        </div>
    );
};
