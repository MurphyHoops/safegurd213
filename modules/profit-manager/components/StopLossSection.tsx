
import React from 'react';
import { ProfitSettings } from '../../../types';
import { TrendingDown, ShieldAlert, Cpu } from 'lucide-react';

interface Props {
    settings: ProfitSettings;
    updateNested: (subsection: string, key: string, value: any) => void;
}

export const StopLossSection: React.FC<Props> = ({ settings, updateNested }) => {
    const config = settings.stopLoss;

    return (
        <div className="p-4 border-t border-slate-800 bg-slate-900/50">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-800/50">
                <div className="flex items-center gap-2">
                    <TrendingDown size={14} className="text-red-400"/>
                    <span className="text-xs font-bold text-red-400 uppercase tracking-tight italic">基础熔断设定</span>
                </div>
                <div 
                    onClick={() => updateNested('stopLoss', 'enabled', !config.enabled)} 
                    className={`w-8 h-4 rounded-full p-0.5 transition-all cursor-pointer ${config.enabled ? 'bg-red-600 shadow-[0_0_8px_rgba(220,38,38,0.4)]' : 'bg-slate-700'}`}
                >
                    <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${config.enabled ? 'translate-x-4' : 'translate-x-0'}`}/>
                </div>
            </div>

            {config.enabled ? (
                <div className="grid grid-cols-1 gap-3">
                    <div className="flex items-center justify-between group">
                        <div className="flex items-center gap-2">
                             <ShieldAlert size={12} className="text-red-500 opacity-60" />
                             <label className="text-[10px] text-slate-400 group-hover:text-slate-200 transition-colors">全额止损线 (%)</label>
                        </div>
                        <div className="flex items-center bg-slate-900 rounded px-2 py-1 border border-slate-800 focus-within:border-red-500/30 transition-all">
                            <span className="text-[9px] text-red-500/50 mr-1">-</span>
                            <input 
                                type="number" 
                                value={config.lossPercent} 
                                onChange={(e) => updateNested('stopLoss', 'lossPercent', Math.abs(Number(e.target.value)))}
                                className="w-16 bg-transparent text-right text-[11px] font-mono text-red-400 focus:outline-none"
                            />
                            <span className="text-[9px] text-slate-500 ml-1">%</span>
                        </div>
                    </div>

                    <div className="flex items-center justify-between group">
                        <div className="flex items-center gap-2">
                             <TrendingDown size={12} className="text-slate-500 opacity-60" />
                             <label className="text-[10px] text-slate-400 group-hover:text-slate-200 transition-colors">监控门槛 (USDT)</label>
                        </div>
                        <div className="flex items-center bg-slate-900 rounded px-2 py-1 border border-slate-800 focus-within:border-slate-600 transition-all">
                            <input 
                                type="number" 
                                value={config.minPosition} 
                                onChange={(e) => updateNested('stopLoss', 'minPosition', Number(e.target.value))}
                                className="w-16 bg-transparent text-right text-[11px] font-mono text-slate-300 focus:outline-none"
                            />
                            <span className="text-[9px] text-slate-500 ml-1">U</span>
                        </div>
                    </div>

                    <div className="mt-2 p-2 bg-slate-950/50 rounded border border-slate-800 flex items-center gap-2 opacity-60 hover:opacity-100 transition-opacity">
                        <Cpu size={12} className="text-slate-600" />
                        <span className="text-[8px] text-slate-500 leading-tight">基础止损是系统的最后一道防线。虽然模块 2 (防爆对冲) 也能处理亏损，但此处的硬性止损在对冲失败或达到次数上限时仍会生效。</span>
                    </div>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center py-4 bg-slate-950/30 rounded border border-dashed border-slate-800/50">
                    <span className="text-[9px] text-slate-600 font-mono italic">STOP LOSS IS OFFLINE</span>
                    <button 
                        onClick={() => updateNested('stopLoss', 'enabled', true)}
                        className="mt-2 text-[9px] text-slate-500 hover:text-red-400 transition-colors underline underline-offset-2"
                    >
                        点击激活安全冗余
                    </button>
                </div>
            )}
        </div>
    );
};
