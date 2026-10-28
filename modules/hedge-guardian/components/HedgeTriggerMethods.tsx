import React from 'react';

interface Props {
    settings: any;
    onChange: (key: string, value: any) => void;
}

export const HedgeTriggerMethods: React.FC<Props> = ({ settings, onChange }) => {
    return (
        <div className="mt-4 space-y-3">
            <span className="text-[10px] font-bold text-slate-400 block border-b border-slate-800 pb-1">对冲触发方式：</span>
            
            {/* Method 1: Loss Trigger */}
            <div className="flex items-center justify-between bg-slate-900/50 p-2 rounded border border-slate-700/50">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-300">1. 亏损值触发</span>
                    <div className="relative w-16">
                        <input 
                            type="number" 
                            step="0.1"
                            className="w-full bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-red-400 text-center font-bold" 
                            value={Number.isNaN(settings.triggerLossPercent) ? '' : settings.triggerLossPercent} 
                            onChange={(e) => onChange('triggerLossPercent', Math.abs(parseFloat(e.target.value)))} 
                        />
                        <span className="absolute right-1 top-0.5 text-[9px] text-slate-500">%</span>
                    </div>
                </div>
                <div 
                    onClick={() => onChange('triggerLossEnabled', !settings.triggerLossEnabled)} 
                    className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.triggerLossEnabled ? 'bg-indigo-600' : 'bg-slate-700'}`}
                >
                    <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.triggerLossEnabled ? 'translate-x-4' : 'translate-x-0'}`}/>
                </div>
            </div>

            {/* Combined Loss Limit Setting */}
            <div className="flex items-center justify-between bg-slate-900/50 p-2 rounded border border-slate-700/50">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400">亏损触发限制 (对趋势/破位有效)</span>
                    <div className="relative w-16">
                        <input 
                            type="number" 
                            step="0.1"
                            className="w-full bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-red-400 text-center font-bold" 
                            value={Number.isNaN(settings.combinedLossLimitPercent) ? '' : (settings.combinedLossLimitPercent || 2)} 
                            onChange={(e) => onChange('combinedLossLimitPercent', Math.abs(parseFloat(e.target.value)))} 
                        />
                        <span className="absolute right-1 top-0.5 text-[9px] text-slate-500">%</span>
                    </div>
                </div>
                <div 
                    onClick={() => onChange('combinedLossLimitEnabled', !settings.combinedLossLimitEnabled)} 
                    className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.combinedLossLimitEnabled ? 'bg-indigo-600' : 'bg-slate-700'}`}
                >
                    <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.combinedLossLimitEnabled ? 'translate-x-4' : 'translate-x-0'}`}/>
                </div>
            </div>

            {/* Method 2: Trend Firewall */}
            <div className="flex items-center justify-between bg-slate-900/50 p-2 rounded border border-slate-700/50">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-300">2. 趋势防火墙，价格突破 EMA</span>
                    <select 
                        className="bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-indigo-400 font-bold"
                        value={settings.trendHedgeEmaPeriod || 80}
                        onChange={(e) => onChange('trendHedgeEmaPeriod', parseInt(e.target.value))}
                    >
                        <option value={80}>80</option>
                        <option value={40}>40</option>
                        <option value={20}>20</option>
                        <option value={10}>10</option>
                    </select>
                </div>
                <div 
                    onClick={() => onChange('trendHedgeEnabled', !settings.trendHedgeEnabled)} 
                    className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.trendHedgeEnabled ? 'bg-indigo-600' : 'bg-slate-700'}`}
                >
                    <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.trendHedgeEnabled ? 'translate-x-4' : 'translate-x-0'}`}/>
                </div>
            </div>

            {/* Method 3: Break K-Line */}
            <div className="flex items-center justify-between bg-slate-900/50 p-2 rounded border border-slate-700/50">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-300">3. 破位大K线，振幅</span>
                    <div className="relative w-16">
                        <input 
                            type="number" 
                            className="w-full bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-orange-400 text-center font-bold" 
                            value={Number.isNaN(settings.breakKLineRatio) ? '' : (settings.breakKLineRatio || 40)} 
                            onChange={(e) => onChange('breakKLineRatio', parseFloat(e.target.value))} 
                        />
                        <span className="absolute right-1 top-0.5 text-[9px] text-slate-500">%</span>
                    </div>
                </div>
                <div 
                    onClick={() => onChange('breakKLineEnabled', !settings.breakKLineEnabled)} 
                    className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.breakKLineEnabled ? 'bg-indigo-600' : 'bg-slate-700'}`}
                >
                    <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.breakKLineEnabled ? 'translate-x-4' : 'translate-x-0'}`}/>
                </div>
            </div>

            {/* Method 4: EMA10 Cross EMA20 Baseline Breakout */}
            <div className="bg-slate-900/50 p-2 rounded border border-slate-700/50 space-y-1.5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-300 font-medium">4. EMA10破EMA20</span>
                        <span className="text-[9px] px-1.5 py-0.2 bg-indigo-950/60 text-indigo-300 border border-indigo-700/40 rounded">
                            起爆原点防线
                        </span>
                    </div>
                    <div 
                        onClick={() => onChange('ema10Cross20BreakEnabled', !settings.ema10Cross20BreakEnabled)} 
                        className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.ema10Cross20BreakEnabled ? 'bg-indigo-600' : 'bg-slate-700'}`}
                    >
                        <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.ema10Cross20BreakEnabled ? 'translate-x-4' : 'translate-x-0'}`}/>
                    </div>
                </div>
                <div className="text-[9px] text-slate-400 leading-tight pl-0.5">
                    以开仓信号形成时 EMA10 穿越 EMA20 的基准价格为防线；多单跌破 / 空单涨破该价格且满足亏损限制时触发对冲开仓。
                </div>
            </div>
        </div>
    );
};
