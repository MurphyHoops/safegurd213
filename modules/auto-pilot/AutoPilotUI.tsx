
import React, { useState } from 'react';
import { AutoPilotProps } from './types';
import { History, Activity } from 'lucide-react';
import { AdvancedBacktester } from '../backtester/AdvancedBacktester';
import { LiveDashboard } from './components/LiveDashboard';

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
                    <LiveDashboard 
                        isSimulating={isSimulating}
                        onToggleSim={onToggleSim}
                        onOpenScanner={onOpenScanner}
                    />
                ) : (
                    <AdvancedBacktester settings={settings} />
                )}
            </div>
        </div>
    );
};
