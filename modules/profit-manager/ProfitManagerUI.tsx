
import React from 'react';
import { ProfitManagerProps } from './types';
import { useProfitManager } from './useProfitManager';
import { TrendingUp, TrendingDown, Anchor, Globe, Zap } from 'lucide-react';

export const ProfitManagerModule: React.FC<ProfitManagerProps> = (props) => {
    const { settings, onChange, updateNested } = props;
    const { updateDynamicTier, toggleOForMode } = useProfitManager(props);

    return (
        <div className="bg-slate-800/30 border-b border-slate-800 animate-in fade-in">
            {/* 1.1 盈利平仓 (Profit Closing) */}
            <div className="p-4 space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-slate-700/50">
                    <div className="flex items-center gap-2">
                        <TrendingUp size={14} className="text-emerald-400"/>
                        <span className="text-xs font-bold text-emerald-400">盈利平仓主目录</span>
                    </div>
                    <div onClick={() => onChange('enabled', !settings.enabled)} className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.enabled ? 'bg-emerald-600' : 'bg-slate-700'}`}>
                        <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.enabled ? 'translate-x-4' : 'translate-x-0'}`}/>
                    </div>
                </div>

                {settings.enabled && (
                    <>
                        {/* Mode Tabs */}
                        <div className="flex bg-slate-900 rounded p-1 border border-slate-700 gap-1">
                            {['CONVENTIONAL', 'ATR', 'DYNAMIC', 'SMART', 'GLOBAL'].map((mode) => {
                                const labels: any = { CONVENTIONAL: '常规', ATR: '趋势', DYNAMIC: '动态', SMART: '智能', GLOBAL: '全局' };
                                const isActive = settings.profitMode === mode;
                                const isOEnabled = settings.oEnabledMap?.[mode] || false;
                                return (
                                    <div key={mode} className={`flex-1 flex items-center rounded overflow-hidden transition-all border ${isActive ? 'border-emerald-500/50 bg-emerald-900/20' : 'border-transparent bg-slate-800/30'}`}>
                                        <button
                                            onClick={() => onChange('profitMode', mode)}
                                            className={`flex-1 py-1.5 text-[9px] font-bold text-center transition-colors ${isActive ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-300'}`}
                                        >
                                            {labels[mode]}
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); toggleOForMode(mode); }}
                                            className={`w-5 h-full flex items-center justify-center border-l transition-colors hover:bg-slate-800/50 ${
                                                isActive ? 'border-emerald-500/20' : 'border-slate-700'
                                            }`}
                                            title="Toggle Option (Switch)"
                                        >
                                            <div className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                                                isOEnabled 
                                                ? 'bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.8)] scale-110' 
                                                : 'border border-slate-500 bg-transparent opacity-50'
                                            }`} />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="bg-slate-900/40 p-3 rounded border border-slate-700/50">
                            {/* CONVENTIONAL */}
                            {settings.profitMode === 'CONVENTIONAL' && (
                                <div className="space-y-3">
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="text-[10px] text-slate-500 block mb-1">持仓大于 (U)</label>
                                            <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white" value={Number.isNaN(settings.conventional.minPosition) ? '' : settings.conventional.minPosition} onChange={(e) => updateNested('conventional', 'minPosition', parseFloat(e.target.value))} />
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-slate-500 block mb-1">平仓比例 (%)</label>
                                            <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white" value={Number.isNaN(settings.conventional.closePercent) ? '' : settings.conventional.closePercent} onChange={(e) => updateNested('conventional', 'closePercent', parseFloat(e.target.value))} />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="text-[10px] text-slate-500 block mb-1">盈利大于 (%)</label>
                                            <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-emerald-400" value={Number.isNaN(settings.conventional.profitPercent) ? '' : settings.conventional.profitPercent} onChange={(e) => updateNested('conventional', 'profitPercent', parseFloat(e.target.value))} />
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-slate-500 block mb-1">或回调大于 (%)</label>
                                            <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-amber-400" value={Number.isNaN(settings.conventional.callbackPercent) ? '' : settings.conventional.callbackPercent} onChange={(e) => updateNested('conventional', 'callbackPercent', parseFloat(e.target.value))} />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* ATR TREND MODE */}
                            {settings.profitMode === 'ATR' && (
                                <div className="space-y-3">
                                    <div className="p-2 bg-indigo-900/20 border border-indigo-500/20 rounded text-[10px] text-slate-400 flex items-start gap-2">
                                        <Anchor size={14} className="text-indigo-400 shrink-0 mt-0.5" />
                                        <span>
                                            <strong className="text-indigo-300">吊灯止盈 (Chandelier Exit):</strong> 不设固定止盈点。
                                            止盈线随价格上涨自动上移，只上不下。当价格回落触及 <code>最高价 - (ATR × 倍数)</code> 时平仓。
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="text-[10px] text-slate-500 block mb-1">ATR 倍数 (Multiplier)</label>
                                            <input 
                                                type="number" 
                                                step="0.1"
                                                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:border-indigo-500 font-bold" 
                                                value={Number.isNaN(settings.atr?.multiplier) ? '' : (settings.atr?.multiplier ?? 3.0)} 
                                                onChange={(e) => updateNested('atr', 'multiplier', parseFloat(e.target.value))} 
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-slate-500 block mb-1">波动率估算 (%)</label>
                                            <input 
                                                type="number" 
                                                step="0.1"
                                                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-orange-400 focus:border-orange-500" 
                                                value={Number.isNaN(settings.atr?.volatilityPercent) ? '' : (settings.atr?.volatilityPercent ?? 1.0)} 
                                                onChange={(e) => updateNested('atr', 'volatilityPercent', parseFloat(e.target.value))} 
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* DYNAMIC (Ladder) */}
                            {settings.profitMode === 'DYNAMIC' && (
                                <div className="space-y-3">
                                    <div>
                                        <label className="text-[10px] text-slate-500 block mb-1">触发持仓门槛 (U)</label>
                                        <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white" value={Number.isNaN(settings.dynamic.minPosition) ? '' : settings.dynamic.minPosition} onChange={(e) => updateNested('dynamic', 'minPosition', parseFloat(e.target.value))} />
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex text-[9px] text-slate-500 px-1">
                                            <span className="w-8">层级</span>
                                            <span className="flex-1 text-center">盈利 &ge; %</span>
                                            <span className="flex-1 text-center">回调 &ge; %</span>
                                            <span className="flex-1 text-right">平仓 %</span>
                                        </div>
                                        {(settings.dynamic.tiers || []).map((tier, idx) => {
                                            if (!tier || typeof tier !== 'object') return null;
                                            return (
                                            <div key={idx} className="flex items-center gap-2">
                                                <span className="text-[9px] text-slate-600 w-8">L{idx + 1}</span>
                                                <input type="number" className="flex-1 w-full bg-slate-800 border border-slate-700 rounded px-1 py-1 text-xs text-emerald-400 text-center" value={Number.isNaN(tier.profit) ? '' : (tier.profit || 0)} onChange={(e) => updateDynamicTier(idx, 'profit', parseFloat(e.target.value))} />
                                                <input type="number" className="flex-1 w-full bg-slate-800 border border-slate-700 rounded px-1 py-1 text-xs text-amber-400 text-center" value={Number.isNaN(tier.callback) ? '' : (tier.callback || 0)} onChange={(e) => updateDynamicTier(idx, 'callback', parseFloat(e.target.value))} />
                                                <input type="number" className="flex-1 w-full bg-slate-800 border border-slate-700 rounded px-1 py-1 text-xs text-white text-right" value={Number.isNaN(tier.close) ? '' : (tier.close || 0)} onChange={(e) => updateDynamicTier(idx, 'close', parseFloat(e.target.value))} />
                                            </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* SMART */}
                            {settings.profitMode === 'SMART' && (
                                <div className="space-y-3">
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="text-[10px] text-slate-500 block mb-1">触发持仓门槛 (U)</label>
                                            <input 
                                                type="number" 
                                                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white" 
                                                value={Number.isNaN(settings.smart?.minPosition) ? '' : (settings.smart?.minPosition ?? 100)} 
                                                onChange={(e) => updateNested('smart', 'minPosition', parseFloat(e.target.value))} 
                                            />
                                        </div>
                                        <div className="flex items-end">
                                            <div className="flex items-center justify-between p-2 bg-slate-800/50 rounded border border-slate-700 w-full h-[30px]">
                                                <div className="flex items-center gap-2">
                                                    <Zap size={14} className="text-amber-400" />
                                                    <span className="text-[10px] font-bold text-slate-300">常规阶梯平仓</span>
                                                </div>
                                                <div onClick={() => updateNested('smart', 'conventionalEnabled', !settings.smart?.conventionalEnabled)} className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.smart?.conventionalEnabled ? 'bg-amber-600' : 'bg-slate-700'}`}>
                                                    <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.smart?.conventionalEnabled ? 'translate-x-4' : 'translate-x-0'}`}/>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {settings.smart?.conventionalEnabled && (
                                        <div className="space-y-2 animate-in slide-in-from-top-1">
                                            <div className="grid grid-cols-3 gap-2 px-1">
                                                <span className="text-[9px] text-slate-500 text-center">盈利阈值(%)</span>
                                                <span className="text-[9px] text-slate-500 text-center">回调值(%)</span>
                                                <span className="text-[9px] text-slate-500 text-center">失效值(%)</span>
                                            </div>
                                            {(settings.smart?.tiers || []).map((tier, idx) => (
                                                <div key={idx} className="grid grid-cols-3 gap-2 bg-slate-900/30 p-1.5 rounded border border-slate-800">
                                                    <input 
                                                        type="number" 
                                                        step="0.1"
                                                        className="w-full bg-slate-800 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-emerald-400 text-center" 
                                                        value={Number.isNaN(tier.threshold) ? '' : tier.threshold} 
                                                        onChange={(e) => {
                                                            const newTiers = [...(settings.smart?.tiers || [])];
                                                            newTiers[idx] = { ...newTiers[idx], threshold: parseFloat(e.target.value) };
                                                            updateNested('smart', 'tiers', newTiers);
                                                        }} 
                                                    />
                                                    <input 
                                                        type="number" 
                                                        step="0.1"
                                                        className="w-full bg-slate-800 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-amber-400 text-center" 
                                                        value={Number.isNaN(tier.callback) ? '' : tier.callback} 
                                                        onChange={(e) => {
                                                            const newTiers = [...(settings.smart?.tiers || [])];
                                                            newTiers[idx] = { ...newTiers[idx], callback: parseFloat(e.target.value) };
                                                            updateNested('smart', 'tiers', newTiers);
                                                        }} 
                                                    />
                                                    <input 
                                                        type="number" 
                                                        step="0.1"
                                                        className="w-full bg-slate-800 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-red-400 text-center" 
                                                        value={Number.isNaN(tier.expiry) ? '' : tier.expiry} 
                                                        onChange={(e) => {
                                                            const newTiers = [...(settings.smart?.tiers || [])];
                                                            newTiers[idx] = { ...newTiers[idx], expiry: parseFloat(e.target.value) };
                                                            updateNested('smart', 'tiers', newTiers);
                                                        }} 
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    <div className="pt-2 border-t border-slate-800">
                                        <label className="text-[10px] text-slate-500 block mb-1">智能平仓启动值 (%) <span className="text-red-400 text-[8px] ml-1">(达到此值常规平仓失效)</span></label>
                                        <input 
                                            type="number" 
                                            step="0.1"
                                            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-emerald-400 font-bold" 
                                            value={Number.isNaN(settings.smart?.activationProfit) ? '' : (settings.smart?.activationProfit ?? 60)} 
                                            onChange={(e) => updateNested('smart', 'activationProfit', parseFloat(e.target.value))} 
                                        />
                                    </div>
                                    <div className="p-2 bg-indigo-900/20 rounded border border-indigo-500/20 text-[10px] text-slate-400 leading-relaxed">
                                        <span className="text-indigo-400 font-bold block mb-1">智能动态逻辑 (已锁定)：</span>
                                        以“启动盈利阈值”为基础，平仓条件是：<br/>
                                        <span className="text-emerald-400 font-mono">回调值 = 最高盈利 × (1 - 最高盈利)</span><br/>
                                        例如：盈利 60% 时，回调 24% (即 60% × 40%)，锁定 36% 盈利；<br/>
                                        盈利 90% 时，回调 9% (即 90% × 10%)，锁定 81% 盈利。
                                    </div>
                                </div>
                            )}

                            {/* GLOBAL MODE */}
                            {settings.profitMode === 'GLOBAL' && (
                                <div className="space-y-3">
                                    <div className="p-2 bg-blue-900/20 rounded border border-blue-500/20 text-[10px] text-slate-400 mb-2 flex items-center gap-2">
                                        <Globe size={14} className="text-blue-400" />
                                        <span>基于账户总权益进行整体止盈止损。</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="bg-slate-800/50 p-2 rounded border border-slate-700">
                                            <span className="text-[9px] text-slate-500 block mb-1">按比例 (%)</span>
                                            <div className="space-y-1">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[9px] text-emerald-500">盈:</span>
                                                    <input type="number" className="w-16 bg-slate-900 border border-slate-600 rounded px-1 py-0.5 text-xs text-emerald-400 text-right" placeholder="0" value={Number.isNaN(settings.global.profitPercent) ? '' : (settings.global.profitPercent || '')} onChange={(e) => updateNested('global', 'profitPercent', parseFloat(e.target.value))} />
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[9px] text-red-500">亏:</span>
                                                    <input type="number" className="w-16 bg-slate-900 border border-slate-600 rounded px-1 py-0.5 text-xs text-red-400 text-right" placeholder="0" value={Number.isNaN(settings.global.lossPercent) ? '' : (settings.global.lossPercent || '')} onChange={(e) => updateNested('global', 'lossPercent', parseFloat(e.target.value))} />
                                                </div>
                                            </div>
                                        </div>
                                        <div className="bg-slate-800/50 p-2 rounded border border-slate-700">
                                            <span className="text-[9px] text-slate-500 block mb-1">按金额 (U)</span>
                                            <div className="space-y-1">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[9px] text-emerald-500">盈:</span>
                                                    <input type="number" className="w-16 bg-slate-900 border border-slate-600 rounded px-1 py-0.5 text-xs text-emerald-400 text-right" placeholder="0" value={Number.isNaN(settings.global.profitAmount) ? '' : (settings.global.profitAmount || '')} onChange={(e) => updateNested('global', 'profitAmount', parseFloat(e.target.value))} />
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[9px] text-red-500">亏:</span>
                                                    <input type="number" className="w-16 bg-slate-900 border border-slate-600 rounded px-1 py-0.5 text-xs text-red-400 text-right" placeholder="0" value={Number.isNaN(settings.global.lossAmount) ? '' : (settings.global.lossAmount || '')} onChange={(e) => updateNested('global', 'lossAmount', parseFloat(e.target.value))} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* 1.2 止损平仓 */}
            <div className="border-t border-slate-800 bg-slate-900/30">
                <div className="p-4">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <TrendingDown size={14} className="text-red-400"/>
                            <span className="text-xs font-bold text-red-400">止损平仓主目录</span>
                        </div>
                        <div onClick={() => updateNested('stopLoss', 'enabled', !settings.stopLoss.enabled)} className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.stopLoss.enabled ? 'bg-red-600' : 'bg-slate-700'}`}>
                            <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.stopLoss.enabled ? 'translate-x-4' : 'translate-x-0'}`}/>
                        </div>
                    </div>
                    
                    <div className={`space-y-3 ${!settings.stopLoss.enabled && 'opacity-40 pointer-events-none'}`}>
                        <div>
                            <label className="text-[10px] text-slate-500 block mb-1">单币持仓大于 (U)</label>
                            <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white" value={Number.isNaN(settings.stopLoss.minPosition) ? '' : settings.stopLoss.minPosition} onChange={(e) => updateNested('stopLoss', 'minPosition', parseFloat(e.target.value))} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[10px] text-slate-500 block mb-1">亏损大于 (%)</label>
                                <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-red-400" value={Number.isNaN(settings.stopLoss.lossPercent) ? '' : settings.stopLoss.lossPercent} onChange={(e) => updateNested('stopLoss', 'lossPercent', parseFloat(e.target.value))} />
                            </div>
                            <div>
                                <label className="text-[10px] text-slate-500 block mb-1">平仓数量 (%)</label>
                                <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white" value={Number.isNaN(settings.stopLoss.closePercent) ? '' : settings.stopLoss.closePercent} onChange={(e) => updateNested('stopLoss', 'closePercent', parseFloat(e.target.value))} />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
