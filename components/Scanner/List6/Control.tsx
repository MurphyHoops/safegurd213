
import React from 'react';
import { Zap, ShieldCheck, ZapOff, ChevronUp, ChevronDown } from 'lucide-react';
import { ActionConfig } from '../scannerTypes';

export const RiskStatsRow: React.FC<{ stats: { symbolCount: number, totalValue: number, totalPnl: number }, config: ActionConfig }> = ({ stats, config }) => {
    const usagePct = config.maxTotalValue > 0 ? (stats.totalValue / config.maxTotalValue) * 100 : 0;
    const exposureLimit = config.maxExposurePercent || 50;
    const isOverLimit = usagePct >= exposureLimit;
    
    return (
        <div className="flex items-center justify-between gap-1 text-[9px] mt-2 bg-[#12161f] p-2 rounded border border-slate-800">
            {/* 1. Exposure % */}
            <div className={`flex-1 flex flex-col items-center justify-center p-1 rounded border ${isOverLimit ? 'bg-red-900/20 border-red-500/30' : 'bg-slate-800 border-slate-700'}`}>
                <span className="text-slate-500 font-bold uppercase mb-0.5">风险敞口 %</span>
                <span className={`font-mono font-bold ${isOverLimit ? 'text-red-400' : 'text-orange-400'}`}>{usagePct.toFixed(1)}%</span>
            </div>
            
            {/* 2. Position Count */}
            <div className="flex-1 flex flex-col items-center justify-center p-1 rounded border bg-slate-800 border-slate-700">
                <span className="text-slate-500 font-bold uppercase mb-0.5">持仓数</span>
                <span className={`font-mono font-bold ${stats.symbolCount >= config.maxOpenSymbols ? 'text-red-400' : 'text-white'}`}>
                    {stats.symbolCount}/{config.maxOpenSymbols}
                </span>
            </div>

            {/* 3. Floating PnL */}
            <div className="flex-1 flex flex-col items-center justify-center p-1 rounded border bg-slate-800 border-slate-700">
                <span className="text-slate-500 font-bold uppercase mb-0.5">浮动盈亏</span>
                <span className={`font-mono font-bold ${stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {stats.totalPnl > 0 ? '+' : ''}{stats.totalPnl.toFixed(1)}
                </span>
            </div>
        </div>
    );
};

export const List6Control: React.FC<{
    config: ActionConfig;
    setConfig: React.Dispatch<React.SetStateAction<ActionConfig>>;
    currentStats: { symbolCount: number, totalValue: number, totalPnl: number };
}> = ({ config, setConfig, currentStats }) => (
    <div className="p-3 bg-slate-900 border-b border-slate-800 space-y-3 shrink-0">
        {/* Header Switch */}
        <div className="flex items-center justify-between">
            <div className="font-bold text-orange-400 text-sm flex items-center gap-2">
                <Zap size={14} className="fill-orange-400/20"/> 6. 战术终端 (COMMAND)
            </div>
            <div onClick={() => setConfig(p => ({...p, enabled: !p.enabled}))} className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${config.enabled ? 'bg-orange-600' : 'bg-slate-700'}`}>
                <div className={`w-3 h-3 bg-white rounded-full transition-transform shadow-sm ${config.enabled ? 'translate-x-4' : ''}`} />
            </div>
        </div>
        
        {/* Position Sizing Section */}
        <div className="space-y-2">
            {/* Mode Switch Tabs */}
            <div className="flex bg-slate-800 p-0.5 rounded border border-slate-700">
                <button 
                    onClick={() => setConfig(p => ({...p, positionSizeMode: 'FIXED'}))}
                    className={`flex-1 py-1.5 text-[9px] font-bold rounded transition-all ${config.positionSizeMode === 'FIXED' ? 'bg-slate-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    固定开仓
                </button>
                <button 
                    onClick={() => setConfig(p => ({...p, positionSizeMode: 'VARIABLE'}))}
                    className={`flex-1 py-1.5 text-[9px] font-bold rounded transition-all ${config.positionSizeMode === 'VARIABLE' ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    变量开仓
                </button>
            </div>

            {/* Dynamic Inputs based on Mode */}
            {config.positionSizeMode === 'FIXED' ? (
                <div className="bg-slate-800/50 rounded border border-slate-700 p-2 relative">
                    <div className="flex items-center justify-between text-[9px] text-slate-500 mb-1">
                        <span className="flex items-center gap-1 font-bold">单次固定金额 (USDT)</span>
                    </div>
                    <input 
                        type="number" 
                        value={config.openAmount} 
                        onChange={e => setConfig(p => ({...p, openAmount: parseFloat(e.target.value)}))} 
                        className="w-full bg-transparent text-lg font-bold text-white outline-none font-mono placeholder-slate-600 text-center"
                    />
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-2">
                    <div className="bg-slate-800/50 rounded border border-slate-700 p-2">
                        <label className="text-[9px] text-slate-500 block mb-1 font-bold">余额比例 (%)</label>
                        <input 
                            type="number" 
                            value={config.variablePercentage || 2} 
                            onChange={e => setConfig(p => ({...p, variablePercentage: parseFloat(e.target.value)}))} 
                            className="w-full bg-transparent text-lg font-bold text-indigo-400 outline-none font-mono text-center"
                        />
                    </div>
                    <div className="bg-slate-800/50 rounded border border-slate-700 p-2">
                        <label className="text-[9px] text-slate-500 block mb-1 font-bold">最大限制 (U)</label>
                        <input 
                            type="number" 
                            value={config.variableMaxLimit || 200} 
                            onChange={e => setConfig(p => ({...p, variableMaxLimit: parseFloat(e.target.value)}))} 
                            className="w-full bg-transparent text-lg font-bold text-white outline-none font-mono text-center"
                        />
                    </div>
                </div>
            )}
        </div>

        {/* Auto Switch */}
        <div 
            onClick={() => setConfig(p => ({...p, autoExecute: !p.autoExecute}))}
            className={`flex items-center justify-between px-3 py-2 rounded border cursor-pointer transition-all ${config.autoExecute ? 'bg-emerald-900/20 border-emerald-500/40' : 'bg-slate-800 border-slate-700 hover:border-slate-600'}`}
        >
            <div className="flex items-center gap-2">
                {config.autoExecute ? <ShieldCheck size={14} className="text-emerald-400"/> : <ZapOff size={14} className="text-slate-500"/>}
                <span className={`text-xs font-bold ${config.autoExecute ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {config.autoExecute ? '自动开仓已激活' : '仅手动确认模式'}
                </span>
            </div>
            <div className={`w-2 h-2 rounded-full ${config.autoExecute ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`} />
        </div>

        {/* Unified Risk Configuration Row */}
        <div className="grid grid-cols-3 gap-2 items-center bg-slate-800/30 p-2 rounded border border-slate-700/50">
            {/* Col 1: Max Symbols */}
            <div className="flex flex-col gap-1">
                <label className="text-[8px] text-slate-500 font-bold whitespace-nowrap text-center">最大持仓</label>
                <input type="number" value={config.maxOpenSymbols} onChange={e => setConfig(p => ({...p, maxOpenSymbols: parseInt(e.target.value)}))} className="w-full bg-slate-900 border border-slate-700 rounded px-1 py-1 text-xs text-white text-center" />
            </div>
            
            {/* Col 2: Max Capital */}
            <div className="flex flex-col gap-1">
                <label className="text-[8px] text-slate-500 font-bold whitespace-nowrap text-center">总资金上限</label>
                <input type="number" value={config.maxTotalValue} onChange={e => setConfig(p => ({...p, maxTotalValue: parseFloat(e.target.value)}))} className="w-full bg-slate-900 border border-slate-700 rounded px-1 py-1 text-xs text-white text-center" />
            </div>

            {/* Col 3: Exposure % (Arrow Adjust) */}
            <div className="flex flex-col gap-1">
                <label className="text-[8px] text-slate-500 font-bold whitespace-nowrap text-center">风险敞口%</label>
                <div className="relative flex items-center">
                    <input 
                        type="number" 
                        value={config.maxExposurePercent ?? 50} 
                        onChange={e => setConfig(p => ({...p, maxExposurePercent: parseFloat(e.target.value)}))} 
                        className="w-full bg-slate-900 border border-slate-700 rounded px-1 py-1 text-xs text-orange-400 font-bold text-center pr-4 appearance-none" 
                    />
                    {/* Custom Arrows Overlay */}
                    <div className="absolute right-0 top-0 bottom-0 w-4 flex flex-col border-l border-slate-700">
                        <button onClick={() => setConfig(p => ({...p, maxExposurePercent: Math.min(100, (p.maxExposurePercent || 50) + 5)}))} className="flex-1 hover:bg-slate-700 flex items-center justify-center text-slate-400"><ChevronUp size={8}/></button>
                        <button onClick={() => setConfig(p => ({...p, maxExposurePercent: Math.max(0, (p.maxExposurePercent || 50) - 5)}))} className="flex-1 hover:bg-slate-700 flex items-center justify-center text-slate-400 border-t border-slate-700"><ChevronDown size={8}/></button>
                    </div>
                </div>
            </div>
        </div>

        <RiskStatsRow stats={currentStats} config={config} />
    </div>
);
