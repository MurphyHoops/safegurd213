
import React from 'react';
import { Zap, ShieldCheck, ZapOff, ChevronUp, ChevronDown, RefreshCw } from 'lucide-react';
import { ActionConfig } from '../../../components/Scanner/scannerTypes';

export const RiskStatsRow: React.FC<{ stats: { symbolCount: number, totalValue: number, totalPnl: number }, config: ActionConfig }> = ({ stats, config }) => {
    const totalVal = stats?.totalValue ?? 0;
    const maxVal = config?.maxTotalValue ?? 0;
    const usagePct = maxVal > 0 ? (totalVal / maxVal) * 100 : 0;
    const exposureLimit = config?.maxExposurePercent || 50;
    const isOverLimit = usagePct >= exposureLimit;
    const symCount = stats?.symbolCount ?? 0;
    const maxSyms = config?.maxOpenSymbols ?? 5;
    const pnl = stats?.totalPnl ?? 0;
    
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
                <span className={`font-mono font-bold ${symCount >= maxSyms ? 'text-red-400' : 'text-white'}`}>
                    {symCount}/{maxSyms}
                </span>
            </div>

            {/* 3. Floating PnL */}
            <div className="flex-1 flex flex-col items-center justify-center p-1 rounded border bg-slate-800 border-slate-700">
                <span className="text-slate-500 font-bold uppercase mb-0.5">浮动盈亏</span>
                <span className={`font-mono font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {pnl > 0 ? '+' : ''}{pnl.toFixed(1)}
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
        {/* Header Title */}
        <div className="flex items-center justify-between">
            <div className="font-bold text-orange-400 text-sm flex items-center gap-2">
                <Zap size={14} className="fill-orange-400/20"/> 6. 战术终端 (COMMAND)
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
                        value={(config.openAmount === undefined || Number.isNaN(config.openAmount)) ? '' : config.openAmount} 
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
                            value={(config.variablePercentage === undefined || Number.isNaN(config.variablePercentage)) ? '' : (config.variablePercentage || 2)} 
                            onChange={e => setConfig(p => ({...p, variablePercentage: parseFloat(e.target.value)}))} 
                            className="w-full bg-transparent text-lg font-bold text-indigo-400 outline-none font-mono text-center"
                        />
                    </div>
                    <div className="bg-slate-800/50 rounded border border-slate-700 p-2">
                        <label className="text-[9px] text-slate-500 block mb-1 font-bold">最大限额 (U)</label>
                        <input 
                            type="number" 
                            value={(config.variableMaxLimit === undefined || Number.isNaN(config.variableMaxLimit)) ? '' : (config.variableMaxLimit || 200)} 
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

        {/* ⚡ 自动平仓后循环复开 (控制面板置于“自动开仓已激活”正下方) */}
        <div className="bg-amber-950/20 border border-amber-500/30 rounded p-2 space-y-2">
            {/* 1. 复开总开关 */}
            <div 
                onClick={() => setConfig(p => ({...p, autoReopenEnabled: !p.autoReopenEnabled}))}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded border cursor-pointer transition-all ${
                    config.autoReopenEnabled ? 'bg-amber-500/20 border-amber-500/50 text-amber-300' : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
            >
                <div className="flex items-center gap-1.5">
                    <RefreshCw size={13} className={config.autoReopenEnabled ? 'text-amber-400 animate-spin-slow' : 'text-slate-500'} />
                    <span className="text-xs font-bold">平仓后自动复开 (Reopen)</span>
                </div>
                <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded font-mono ${config.autoReopenEnabled ? 'bg-amber-500 text-black font-extrabold' : 'bg-slate-800 text-slate-500'}`}>
                    {config.autoReopenEnabled ? '已开启' : '关闭'}
                </span>
            </div>

            {/* 2. 复开风控门禁 (牛熊门禁 / 偏离熔断 / 止盈复开) */}
            {config.autoReopenEnabled && (
                <div className="space-y-1.5 pt-1 text-[9px] font-sans">
                    {/* 牛熊趋势门禁 (1h EMA80 可调选择) */}
                    <div className="flex items-center justify-between bg-slate-900/80 p-1.5 rounded border border-slate-800">
                        <span className="text-slate-400 font-bold">牛熊趋势门禁</span>
                        <select
                            value={config.reopenBullBearFilter ?? '1h_ema80'}
                            onChange={e => setConfig(p => ({...p, reopenBullBearFilter: e.target.value}))}
                            className="bg-slate-800 border border-slate-700 text-amber-300 text-[9px] font-mono font-bold rounded px-1 py-0.5 outline-none focus:border-amber-400"
                        >
                            <option value="1h_ema80">1h EMA80 上多/下空</option>
                            <option value="1h_ema200">1h EMA200 强牛熊轴</option>
                            <option value="4h_ema80">4h EMA80 大周期门禁</option>
                            <option value="15m_ema80">15m EMA80 敏捷门禁</option>
                            <option value="OFF">关闭趋势门禁</option>
                        </select>
                    </div>

                    {/* 高点回调偏离熔断 % */}
                    <div className="flex items-center justify-between bg-slate-900/80 p-1.5 rounded border border-slate-800 gap-1">
                        <span className="text-slate-400 font-bold whitespace-nowrap">高点回调熔断 %</span>
                        <div className="flex items-center gap-1 flex-1 justify-end">
                            <input
                                type="number"
                                step="0.5"
                                min="0.5"
                                max="10"
                                value={config.reopenPullbackLimitPct ?? 3.0}
                                onChange={e => setConfig(p => ({...p, reopenPullbackLimitPct: parseFloat(e.target.value) || 3.0}))}
                                className="w-12 bg-slate-800 border border-slate-700 text-amber-300 text-[10px] font-mono font-bold rounded px-1 py-0.5 text-center outline-none focus:border-amber-400"
                            />
                            <div className="flex gap-0.5">
                                {[1, 2, 3, 5].map(v => (
                                    <button
                                        key={v}
                                        type="button"
                                        onClick={() => setConfig(p => ({...p, reopenPullbackLimitPct: v}))}
                                        className={`px-1 py-0.5 rounded font-mono text-[8px] border ${
                                            (config.reopenPullbackLimitPct ?? 3.0) === v ? 'bg-amber-500/30 text-amber-300 border-amber-500/50 font-bold' : 'bg-slate-800 text-slate-500 border-slate-700'
                                        }`}
                                    >
                                        {v}%
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* 仅限止盈平仓后复开开关 */}
                    <div className="flex items-center justify-between bg-slate-900/80 p-1.5 rounded border border-slate-800">
                        <span className="text-slate-400 font-bold">仅限止盈平仓复开</span>
                        <button
                            type="button"
                            onClick={() => setConfig(p => ({...p, reopenTakeProfitOnly: !(p.reopenTakeProfitOnly ?? true)}))}
                            className={`px-2 py-0.5 rounded text-[8px] font-bold border transition-colors ${
                                (config.reopenTakeProfitOnly ?? true)
                                    ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                                    : 'bg-slate-800 border-slate-700 text-slate-500'
                            }`}
                        >
                            {(config.reopenTakeProfitOnly ?? true) ? '开启 (非对冲/止损)' : '任意平仓复开'}
                        </button>
                    </div>

                    {/* 单币连亏熔断次数 */}
                    <div className="flex items-center justify-between bg-slate-900/80 p-1.5 rounded border border-slate-800">
                        <span className="text-slate-400 font-bold">单币连亏熔断</span>
                        <div className="flex items-center gap-1 font-mono">
                            {[1, 2, 3].map(cnt => (
                                <button
                                    key={cnt}
                                    type="button"
                                    onClick={() => setConfig(p => ({...p, reopenMaxConsecutiveLosses: cnt}))}
                                    className={`px-1.5 py-0.5 rounded text-[8px] border ${
                                        (config.reopenMaxConsecutiveLosses ?? 2) === cnt ? 'bg-amber-500/30 text-amber-300 border-amber-500/50 font-bold' : 'bg-slate-800 text-slate-500 border-slate-700'
                                    }`}
                                >
                                    {cnt}次
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>

        {/* 开仓限制模块 */}
        <div className="bg-slate-800/30 p-2 rounded border border-slate-700/50 space-y-1.5">
            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between border-b border-slate-700/40 pb-1">
                <span>开仓限制模块</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
                {/* Col 1: Max Symbols */}
                <div className="flex flex-col gap-0.5 bg-slate-900/60 p-1.5 rounded border border-slate-800">
                    <label className="text-[8px] text-slate-400 font-bold whitespace-nowrap text-center">最大持仓</label>
                    <input 
                        type="number" 
                        value={(config.maxOpenSymbols === undefined || Number.isNaN(config.maxOpenSymbols)) ? '' : config.maxOpenSymbols} 
                        onChange={e => setConfig(p => ({...p, maxOpenSymbols: parseInt(e.target.value)}))} 
                        className="w-full bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-xs text-white text-center font-mono" 
                    />
                </div>
                
                {/* Col 2: Max Capital */}
                <div className="flex flex-col gap-0.5 bg-slate-900/60 p-1.5 rounded border border-slate-800">
                    <label className="text-[8px] text-slate-400 font-bold whitespace-nowrap text-center">总资金上限</label>
                    <input 
                        type="number" 
                        value={(config.maxTotalValue === undefined || Number.isNaN(config.maxTotalValue)) ? '' : config.maxTotalValue} 
                        onChange={e => setConfig(p => ({...p, maxTotalValue: parseFloat(e.target.value)}))} 
                        className="w-full bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-xs text-white text-center font-mono" 
                    />
                </div>

                {/* Col 3: Exposure % (Arrow Adjust) */}
                <div className="flex flex-col gap-0.5 bg-slate-900/60 p-1.5 rounded border border-slate-800">
                    <label className="text-[8px] text-slate-400 font-bold whitespace-nowrap text-center">风险敞口%</label>
                    <div className="relative flex items-center">
                        <input 
                            type="number" 
                            value={(config.maxExposurePercent === undefined || Number.isNaN(config.maxExposurePercent)) ? '' : (config.maxExposurePercent ?? 50)} 
                            onChange={e => setConfig(p => ({...p, maxExposurePercent: parseFloat(e.target.value)}))} 
                            className="w-full bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-xs text-orange-400 font-bold text-center pr-4 appearance-none font-mono" 
                        />
                        {/* Custom Arrows Overlay */}
                        <div className="absolute right-0 top-0 bottom-0 w-4 flex flex-col border-l border-slate-700">
                            <button onClick={() => setConfig(p => ({...p, maxExposurePercent: Math.min(100, (p.maxExposurePercent || 50) + 5)}))} className="flex-1 hover:bg-slate-700 flex items-center justify-center text-slate-400"><ChevronUp size={8}/></button>
                            <button onClick={() => setConfig(p => ({...p, maxExposurePercent: Math.max(0, (p.maxExposurePercent || 50) - 5)}))} className="flex-1 hover:bg-slate-700 flex items-center justify-center text-slate-400 border-t border-slate-700"><ChevronDown size={8}/></button>
                        </div>
                    </div>
                </div>

                {/* Col 4: Health % Limit */}
                <div className="flex flex-col gap-0.5 bg-slate-900/60 p-1.5 rounded border border-slate-800">
                    <label className="text-[8px] text-slate-400 font-bold whitespace-nowrap text-center">健康度限制%</label>
                    <div className="relative flex items-center">
                        <input 
                            type="number" 
                            placeholder="低于不开展"
                            value={(config.minHealthPercent === undefined || Number.isNaN(config.minHealthPercent)) ? '' : (config.minHealthPercent === 0 ? '' : config.minHealthPercent)} 
                            onChange={e => setConfig(p => ({...p, minHealthPercent: e.target.value === '' ? 0 : parseFloat(e.target.value)}))} 
                            className="w-full bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-xs text-emerald-400 font-bold text-center pr-4 appearance-none font-mono placeholder:text-slate-600 placeholder:text-[9px]" 
                        />
                        {/* Custom Arrows Overlay */}
                        <div className="absolute right-0 top-0 bottom-0 w-4 flex flex-col border-l border-slate-700">
                            <button onClick={() => setConfig(p => ({...p, minHealthPercent: Math.min(100, (p.minHealthPercent || 0) + 5)}))} className="flex-1 hover:bg-slate-700 flex items-center justify-center text-slate-400"><ChevronUp size={8}/></button>
                            <button onClick={() => setConfig(p => ({...p, minHealthPercent: Math.max(0, (p.minHealthPercent || 0) - 5)}))} className="flex-1 hover:bg-slate-700 flex items-center justify-center text-slate-400 border-t border-slate-700"><ChevronDown size={8}/></button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <RiskStatsRow stats={currentStats} config={config} />
    </div>
);
