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

            {/* Method 4: 300-day Extreme Price Target Hedge */}
            <div className="flex flex-col bg-slate-900/50 p-2 rounded border border-slate-700/50 space-y-1.5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-300 font-bold">4. 300天极值比例对冲</span>
                        <div className="relative w-16">
                            <input 
                                type="number" 
                                className="w-full bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-indigo-400 text-center font-bold font-mono" 
                                value={Number.isNaN(settings.extremeHedgeTriggerRatio) ? '' : (settings.extremeHedgeTriggerRatio ?? 50)} 
                                onChange={(e) => onChange('extremeHedgeTriggerRatio', parseFloat(e.target.value))} 
                            />
                            <span className="absolute right-1 top-0.5 text-[9px] text-slate-500">%</span>
                        </div>
                    </div>
                    <div 
                        onClick={() => onChange('extremeHedgeEnabled', !settings.extremeHedgeEnabled)} 
                        className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.extremeHedgeEnabled ? 'bg-indigo-600' : 'bg-slate-700'}`}
                    >
                        <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.extremeHedgeEnabled ? 'translate-x-4' : 'translate-x-0'}`}/>
                    </div>
                </div>
                <div className="text-[9px] text-slate-500 leading-tight">
                    规则：开仓拉取过去 <strong>300天</strong> 最低/最高价，开仓点距极值亏损 D%，当行情回调 ( ? )% 比例（即 D * ( ? )%）时对冲。<br/>
                    <span className="text-indigo-400 opacity-90 font-bold">例：多单，最低距开仓价差20%，设50%，即实际亏损10%（价位90）时触发对冲。</span>
                </div>
            </div>

            {/* Method 5: Short-term Extreme Ratio Hedge */}
            <div className="flex flex-col bg-slate-900/50 p-2 rounded border border-slate-700/50 space-y-2">
                <div className="flex items-center justify-between">
                    <span className="text-[10px] text-teal-400 font-bold flex items-center gap-1">
                        5. 短期极值比例对冲
                    </span>
                    <div 
                        onClick={() => onChange('shortTermExtremeEnabled', !settings.shortTermExtremeEnabled)} 
                        className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.shortTermExtremeEnabled ? 'bg-teal-600' : 'bg-slate-700'}`}
                    >
                        <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.shortTermExtremeEnabled ? 'translate-x-4' : 'translate-x-0'}`}/>
                    </div>
                </div>
                
                {settings.shortTermExtremeEnabled && (
                    <div className="flex flex-col gap-2 pt-1 border-t border-slate-800 animate-in fade-in">
                        <div className="flex items-center gap-2">
                            <div className="flex-1">
                                <label className="text-[9px] text-slate-500 block mb-1">对冲亏损比例 (%)</label>
                                <div className="relative">
                                    <input 
                                        type="number" 
                                        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-teal-400 font-bold text-center font-mono" 
                                        value={settings.shortTermExtremeRatio ?? 50} 
                                        onChange={(e) => onChange('shortTermExtremeRatio', parseFloat(e.target.value))} 
                                    />
                                    <span className="absolute right-4 top-1 text-[9px] text-slate-500">%</span>
                                </div>
                            </div>
                            <div className="flex-1">
                                <label className="text-[9px] text-slate-500 block mb-1">短期极值天数 (N天)</label>
                                <div className="relative">
                                    <input 
                                        type="number" 
                                        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-white text-center font-mono" 
                                        value={settings.shortTermExtremeDays ?? 7} 
                                        onChange={(e) => onChange('shortTermExtremeDays', parseInt(e.target.value))} 
                                    />
                                    <span className="absolute right-3 top-1 text-[9px] text-slate-500">天</span>
                                </div>
                            </div>
                        </div>
                        <div className="text-[9px] text-slate-500 leading-tight">
                            规则：开仓后自动提取过去 <strong>{settings.shortTermExtremeDays ?? 7}天</strong> 极值点，当亏损额达到极值间距的 <strong>{settings.shortTermExtremeRatio ?? 50}%</strong> 时启动对冲（并联运行）。
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
