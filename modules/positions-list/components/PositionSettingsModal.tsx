// @LOCKED: PositionSettingsModal logic
import React, { useState, useEffect } from 'react';
import { Position, ProfitSettings, AppSettings, PositionSide } from '../../../types';
import { X, Settings, Target, Shield, HelpCircle, Save, RotateCcw, AlertCircle, Sparkles, Brain, Cpu, CheckCircle } from 'lucide-react';
import { audioService } from '../../../services/audioService';
import { ConventionalMode } from '../../profit-manager/components/ConventionalMode';
import { AtrTrendMode } from '../../profit-manager/components/AtrTrendMode';
import { SmartMode } from '../../profit-manager/components/SmartMode';
import { GlobalMode } from '../../profit-manager/components/GlobalMode';
import { AiMode } from '../../profit-manager/components/AiMode';

interface Props {
    position: Position;
    globalSettings: AppSettings;
    isOpen: boolean;
    onClose: () => void;
    onSave: (symbol: string, customSettings?: ProfitSettings) => void;
}

export const PositionSettingsModal: React.FC<Props> = ({
    position,
    globalSettings,
    isOpen,
    onClose,
    onSave
}) => {
    // Determine initial state
    const [useCustom, setUseCustom] = useState<boolean>(!!position.customProfitSettings);
    const [localSettings, setLocalSettings] = useState<ProfitSettings>(() => {
        if (position.customProfitSettings) {
            return JSON.parse(JSON.stringify(position.customProfitSettings));
        }
        return JSON.parse(JSON.stringify(globalSettings.profit));
    });

    const [activeTab, setActiveTab] = useState<'STOP_LOSS' | 'CUSTOM_PROFIT'>('CUSTOM_PROFIT');

    useEffect(() => {
        if (isOpen) {
            setUseCustom(!!position.customProfitSettings);
            setLocalSettings(
                position.customProfitSettings 
                    ? JSON.parse(JSON.stringify(position.customProfitSettings))
                    : JSON.parse(JSON.stringify(globalSettings.profit))
            );
            setActiveTab('CUSTOM_PROFIT');
        }
    }, [isOpen, position.customProfitSettings, globalSettings.profit]);

    if (!isOpen) return null;

    // Apply Presets to local settings
    const applyPreset = (presetName: 'HIGH_FREQ' | 'BALANCED' | 'EXPLOSIVE') => {
        setUseCustom(true);
        setLocalSettings(prev => {
            const next = { ...prev };
            if (!next.ai) {
                next.ai = {
                    sensitivity: 5,
                    aggressiveness: 5,
                    minPosition: 100,
                    activationProfit: 60
                };
            }
            next.profitMode = 'AI';
            next.enabled = true;
            next.ai.aiSmartModeEnabled = true;

            if (presetName === 'HIGH_FREQ') {
                next.ai.activationProfitPercent = 2.0;
                next.ai.fallbackProfitPercent = 0.5;
                next.ai.atrMultiplier = 1.5;
                next.ai.momentumWeight = 4;
                next.ai.volResonance = 5;
                audioService.speak("已为您匹配：高频波动收割预设方案", true);
            } else if (presetName === 'BALANCED') {
                next.ai.activationProfitPercent = 4.5;
                next.ai.fallbackProfitPercent = 1.5;
                next.ai.atrMultiplier = 2.8;
                next.ai.momentumWeight = 6;
                next.ai.volResonance = 6;
                audioService.speak("已为您匹配：中线平衡稳健预设方案", true);
            } else if (presetName === 'EXPLOSIVE') {
                next.ai.activationProfitPercent = 8.5;
                next.ai.fallbackProfitPercent = 2.5;
                next.ai.atrMultiplier = 3.5;
                next.ai.momentumWeight = 8;
                next.ai.volResonance = 8;
                audioService.speak("已为您匹配：主力暴涨主升浪逃顶预设方案", true);
            }
            return next;
        });
    };

    const handleSave = () => {
        if (position.symbol === 'GLOBAL_DEFAULT') {
            onSave(position.symbol, localSettings);
            audioService.speak("全局AI智能平仓默认规则已升级并生效", true);
            onClose();
            return;
        }

        if (useCustom) {
            const finalSettings: ProfitSettings = {
                ...localSettings,
                enabled: true
            };
            onSave(position.symbol, finalSettings);
        } else {
            // Revert back/unset custom settings -> default to global behavior
            onSave(position.symbol, undefined);
        }
        audioService.speak("单币AI智能平仓规则已即时生效", true);
        onClose();
    };

    const handleResetToGlobal = () => {
        setLocalSettings(JSON.parse(JSON.stringify(globalSettings.profit)));
        setUseCustom(false);
        audioService.speak("已还原并继承全局通用风控规则", true);
    };

    const updateAiField = (key: string, value: any) => {
        setLocalSettings(prev => {
            const next = { ...prev };
            if (!next.ai) {
                next.ai = {
                    sensitivity: 5,
                    aggressiveness: 5,
                    minPosition: 100,
                    activationProfit: 60
                };
            }
            next.ai = {
                ...next.ai,
                [key]: value
            };
            return next;
        });
    };

    const updateStopLoss = (key: string, value: any) => {
        setLocalSettings(prev => ({
            ...prev,
            stopLoss: {
                ...prev.stopLoss,
                [key]: value
            }
        }));
    };

// @LOCKED: PositionSettingsModal logic
    const updateConventional = (key: string, value: any) => {
        setLocalSettings(prev => {
            const next = { ...prev };
            if (!next.conventional) {
                next.conventional = {
                    minPosition: 100,
                    profitPercent: 5.0,
                    callbackPercent: 1.0,
                    closePercent: 100
                };
            }
            next.conventional = {
                ...next.conventional,
                [key]: value
            };
            return next;
        });
    };

    const updateNested = (subsection: string, key: string, value: any) => {
        setLocalSettings(prev => {
            const next = { ...prev };
            const currentSub = (next as any)[subsection] || {};
            (next as any)[subsection] = { ...currentSub, [key]: value };
            return next;
        });
    };

    // Get current visual parameters for prompt representation
    const aiParams = localSettings.ai || {
        aiSmartModeEnabled: true,
        activationProfitPercent: 3.5,
        fallbackProfitPercent: 1.0,
        atrMultiplier: 2.5,
        momentumWeight: 5,
        volResonance: 6
    };

    const convParams = localSettings.conventional || {
        minPosition: 100,
        profitPercent: 5.0,
        callbackPercent: 1.0,
        closePercent: 100
    };

    const slParams = localSettings.stopLoss || {
        enabled: false,
        minPosition: 100,
        lossPercent: 5.0,
        closePercent: 100
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-in fade-in duration-200 text-xs">
            <div className="bg-[#151a21] border border-slate-700/60 rounded-xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[92vh]">
                
                {/* Modal Header */}
                <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/80 shrink-0">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20 text-emerald-400 animate-pulse">
                            <Brain size={16} />
                        </div>
                        <div>
                            <div className="flex items-center gap-1.5">
                                {position.symbol === 'GLOBAL_DEFAULT' ? (
                                    <span className="text-white font-mono font-black text-sm tracking-widest bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">全局 AI 智能平仓</span>
                                ) : (
                                    <span className="text-white font-mono font-black text-sm tracking-widest bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">{position.symbol}</span>
                                )}
                                <span className="text-xs text-emerald-400 font-bold">AI 智能平仓</span>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-0.5">多维量价感知 · 动态ATR容忍回调 · 精准逃顶最大化收益</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-500 hover:text-slate-300 transition-all cursor-pointer">
                        <X size={16} />
                    </button>
                </div>
                <div className="flex px-4 py-2 bg-[#0d1116] border-b border-slate-800/60 justify-between items-center shrink-0">
                    <div className="flex gap-1.5">
                        <button
                            type="button"
                            onClick={() => setActiveTab('CUSTOM_PROFIT')}
                            className={`px-3 py-1 text-[11px] font-bold rounded-md flex items-center gap-1.5 transition-all ${activeTab === 'CUSTOM_PROFIT' ? 'bg-orange-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                            <Target size={12} />
                            <span>单币自定义平仓</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('STOP_LOSS')}
                            className={`px-3 py-1 text-[11px] font-bold rounded-md flex items-center gap-1.5 transition-all ${activeTab === 'STOP_LOSS' ? 'bg-red-600/90 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                            <Shield size={12} />
                            <span>单币独立止损</span>
                        </button>
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono">
                        当前浮盈: <span className={`font-bold ${position.unrealizedPnLPercentage >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{position.unrealizedPnLPercentage.toFixed(2)}%</span>
                    </div>
                </div>

                {/* Scrollable Content Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
                    
                    {/* Switch Box (Global Toggle for Custom Rules Overrides) */}
                    {position.symbol === 'GLOBAL_DEFAULT' ? (
                        <div className="bg-emerald-500/10 p-3.5 rounded-lg border border-emerald-500/20 flex items-center gap-3">
                            <Brain size={20} className="text-emerald-400 shrink-0" />
                            <div>
                                <h4 className="font-bold text-emerald-400">全局AI智能平仓主预设</h4>
                                <p className="text-[10px] text-slate-400">正在编辑系统默认使用的智能移动波段追踪参数。持仓列表中未设置独立风控规则 of 币种将自动继承此组参数。</p>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-slate-900/60 p-3.5 rounded-lg border border-slate-800/80 flex items-center justify-between">
                            <div className="space-y-0.5">
                                <h4 className="font-bold text-white flex items-center gap-1.5">
                                    {useCustom ? (
                                        <>
                                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                                            <span className="text-emerald-400">已部署单币托管规则</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="w-2 h-2 rounded-full bg-slate-500"></span>
                                            <span className="text-slate-400">集成全局标准配置中</span>
                                        </>
                                    )}
                                </h4>
                                <p className="text-[10px] text-slate-500">开启后该币种将启用专属阈值风控规则，摆脱全局平仓限制。</p>
                            </div>
                            <div 
                                onClick={() => setUseCustom(!useCustom)} 
                                className={`w-10 h-5.5 rounded-full p-0.5 transition-all duration-200 cursor-pointer ${useCustom ? 'bg-emerald-600' : 'bg-slate-800 border border-slate-700'}`}
                            >
                                <div className={`w-4.5 h-4.5 bg-white rounded-full shadow-lg transition-transform duration-200 ${useCustom ? 'translate-x-4.5' : 'translate-x-0'}`}/>
                            </div>
                        </div>
                    )}

                    {(useCustom || position.symbol === 'GLOBAL_DEFAULT') && activeTab === 'CUSTOM_PROFIT' && (
                        <div className="space-y-4 animate-in fade-in duration-200">
                            {/* Grouped Mode Selector */}
                            <div className="space-y-2 bg-[#0c0f14] p-3 rounded-lg border border-slate-800/80">
                                <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                                    <Cpu size={12} className="text-emerald-400 animate-pulse" />
                                    <span>选择托管止盈方案类别</span>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-3">
                                    {/* AI Family */}
                                    <div className="bg-[#12161d] p-2 rounded-lg border border-slate-800/80 space-y-2">
                                        <div className="flex items-center gap-1 text-emerald-400 font-bold text-[10px] pb-1 border-b border-slate-800/40">
                                            <Brain size={11} className="text-emerald-400" />
                                            <span>AI 智能自适应平仓</span>
                                        </div>
                                        <div className="flex flex-col gap-1.5">
                                            {[
                                                { id: 'AI', label: '🧠 AI智能逃顶', desc: '多指标与ATR自适应追踪逃顶' },
                                                { id: 'ATR', label: '📈 ATR趋势平仓', desc: '吊灯轨道与移动平均线跟踪' }
                                            ].map((m) => {
                                                const isActive = (localSettings.profitMode || 'CONVENTIONAL') === m.id;
                                                const isOEnabled = localSettings.oEnabledMap?.[m.id] || false;
                                                const activeClass = m.id === 'AI' 
                                                    ? 'bg-emerald-950/25 border-emerald-500/50 shadow-[0_0_8px_rgba(16,185,129,0.15)]' 
                                                    : 'bg-red-950/20 border-red-500/45 shadow-[0_0_8px_rgba(239,68,68,0.15)]';
                                                const textClass = m.id === 'AI' ? 'text-emerald-400' : 'text-red-400';
                                                return (
                                                    <div key={m.id} className={`flex items-center rounded overflow-hidden border transition-all ${isActive ? activeClass : 'bg-[#161a22] border-slate-800/80 hover:border-slate-700/60'}`}>
                                                        <button
                                                            type="button"
                                                            onClick={() => setLocalSettings(prev => ({ ...prev, profitMode: m.id as any }))}
                                                            className="flex-1 text-left px-2 py-1.5 cursor-pointer min-h-[44px]"
                                                        >
                                                            <div className={`font-bold text-[10px] ${isActive ? `${textClass} font-black` : 'text-slate-300'}`}>{m.label}</div>
                                                            <div className="text-[8px] text-slate-500 scale-[0.95] origin-left leading-normal mt-0.5">{m.desc}</div>
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setLocalSettings(prev => {
                                                                    const oEnabledMap = prev.oEnabledMap ? { ...prev.oEnabledMap } : {};
                                                                    oEnabledMap[m.id] = !oEnabledMap[m.id];
                                                                    return { ...prev, oEnabledMap };
                                                                });
                                                            }}
                                                            className="w-11 h-full min-h-[44px] flex items-center justify-center border-l border-slate-800/60 hover:bg-slate-800/30 cursor-pointer shrink-0"
                                                            title="并联开关 (选中后该模式将作为后台规则同步运行)"
                                                        >
                                                            <div className={`w-8 h-4.5 rounded-full p-[2px] transition-all duration-200 border flex items-center ${
                                                                isOEnabled 
                                                                ? 'bg-orange-500/20 border-orange-500/60 shadow-[0_0_8px_rgba(249,115,22,0.15)]' 
                                                                : 'bg-slate-900 border-slate-700'
                                                            }`}>
                                                                <div className={`w-3 h-3 rounded-full transition-all duration-200 ${
                                                                    isOEnabled 
                                                                    ? 'translate-x-4 bg-orange-400 shadow-[0_0_6px_rgba(249,115,22,0.8)]' 
                                                                    : 'translate-x-0 bg-slate-500'
                                                                }`} />
                                                            </div>
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Conventional Family */}
                                    <div className="bg-[#12161d] p-2 rounded-lg border border-slate-800/80 space-y-2">
                                        <div className="flex items-center gap-1 text-amber-450 font-bold text-[10px] pb-1 border-b border-slate-800/40">
                                            <Settings size={11} className="text-amber-450" />
                                            <span>常规固定 阶梯平仓</span>
                                        </div>
                                        <div className="flex flex-col gap-1.5">
                                            {[
                                                { id: 'CONVENTIONAL', label: '⚙️ 常规止盈回调', desc: '固定比率止盈与波动追踪' },
                                                { id: 'SMART', label: '🔒 智能阶梯保底', desc: '目标百分比阶梯止盈锁利' }
                                            ].map((m) => {
                                                const isActive = (localSettings.profitMode || 'CONVENTIONAL') === m.id;
                                                const isOEnabled = localSettings.oEnabledMap?.[m.id] || false;
                                                return (
                                                    <div key={m.id} className={`flex items-center rounded overflow-hidden border transition-all ${isActive ? 'bg-red-950/20 border-red-500/45 shadow-[0_0_8px_rgba(239,68,68,0.15)]' : 'bg-[#161a22] border-slate-800/80 hover:border-slate-700/60'}`}>
                                                        <button
                                                            type="button"
                                                            onClick={() => setLocalSettings(prev => ({ ...prev, profitMode: m.id as any }))}
                                                            className="flex-1 text-left px-2 py-1.5 cursor-pointer min-h-[44px]"
                                                        >
                                                            <div className={`font-bold text-[10px] ${isActive ? 'text-red-400 font-black' : 'text-slate-300'}`}>{m.label}</div>
                                                            <div className="text-[8px] text-slate-500 scale-[0.95] origin-left leading-normal mt-0.5">{m.desc}</div>
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setLocalSettings(prev => {
                                                                    const oEnabledMap = prev.oEnabledMap ? { ...prev.oEnabledMap } : {};
                                                                    oEnabledMap[m.id] = !oEnabledMap[m.id];
                                                                    return { ...prev, oEnabledMap };
                                                                });
                                                            }}
                                                            className="w-11 h-full min-h-[44px] flex items-center justify-center border-l border-slate-800/60 hover:bg-slate-800/30 cursor-pointer shrink-0"
                                                            title="并联开关 (选中后该模式将作为后台规则同步运行)"
                                                        >
                                                            <div className={`w-8 h-4.5 rounded-full p-[2px] transition-all duration-200 border flex items-center ${
                                                                isOEnabled 
                                                                ? 'bg-orange-550/20 border-orange-550/60 shadow-[0_0_8px_rgba(249,115,22,0.15)]' 
                                                                : 'bg-slate-900 border-slate-700'
                                                            }`}>
                                                                <div className={`w-3 h-3 rounded-full transition-all duration-200 ${
                                                                    isOEnabled 
                                                                    ? 'translate-x-4 bg-orange-400 shadow-[0_0_6px_rgba(249,115,22,0.8)]' 
                                                                    : 'translate-x-0 bg-slate-500'
                                                                }`} />
                                                            </div>
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-slate-900/40 p-3 rounded border border-slate-700/50">
                                {/* CONVENTIONAL */}
                                {(localSettings.profitMode || 'CONVENTIONAL') === 'CONVENTIONAL' && <ConventionalMode settings={localSettings} updateNested={updateNested} />}
                                {/* ATR TREND MODE */}
                                {localSettings.profitMode === 'ATR' && <AtrTrendMode settings={localSettings} updateNested={updateNested} />}
                                {/* SMART */}
                                {localSettings.profitMode === 'SMART' && <SmartMode settings={localSettings} updateNested={updateNested} />}
                                {/* GLOBAL MODE */}
                                {localSettings.profitMode === 'GLOBAL' && <GlobalMode settings={localSettings} updateNested={updateNested} />}
                                {/* AI MODE */}
                                {localSettings.profitMode === 'AI' && (
                                    <div className="space-y-4 animate-in fade-in duration-200">
                                        {/* Preset Selection Panel */}
                                        <div className="bg-slate-900/30 p-3.5 rounded-lg border border-slate-800/80 space-y-2.5">
                                            <span className="font-black text-slate-300 text-[10px] tracking-wider uppercase block">⚡️ 极速AI策略参数一键匹配</span>
                                            <div className="grid grid-cols-3 gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => applyPreset('HIGH_FREQ')}
                                                    className="py-2.5 px-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 rounded text-center transition-all cursor-pointer group"
                                                >
                                                    <div className="font-black text-emerald-400 text-[10px]">高频波动收割</div>
                                                    <div className="text-[8px] text-slate-500 mt-0.5 group-hover:text-slate-400">浮盈 2% 启动 / 紧凑止盈</div>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => applyPreset('BALANCED')}
                                                    className="py-2.5 px-2 bg-slate-800 hover:bg-slate-700 border border-emerald-500/20 hover:border-slate-500 rounded text-center transition-all cursor-pointer group"
                                                >
                                                    <div className="font-black text-blue-400 text-[10px]">中线自适应稳健</div>
                                                    <div className="text-[8px] text-slate-500 mt-0.5 group-hover:text-slate-400">浮盈 4.5% 启动 / ATR平衡</div>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => applyPreset('EXPLOSIVE')}
                                                    className="py-2.5 px-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 rounded text-center transition-all cursor-pointer group"
                                                >
                                                    <div className="font-black text-amber-400 text-[10px]">暴涨主升浪逃顶</div>
                                                    <div className="text-[8px] text-slate-500 mt-0.5 group-hover:text-slate-400">浮盈 8.5% 启动 / 宽幅追踪</div>
                                                </button>
                                            </div>
                                        </div>
                                        <AiMode settings={localSettings} updateNested={updateNested} />
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {(useCustom || position.symbol === 'GLOBAL_DEFAULT') && activeTab === 'STOP_LOSS' && (
                        <div className="space-y-4 animate-in fade-in duration-200">
                            
                            {/* Custom Stop Loss configuration */}
                            <div className="bg-slate-900/40 p-4 rounded-lg border border-slate-800 space-y-4">
                                <div className="flex items-center justify-between pb-2 border-b border-slate-800/60">
                                    <div className="space-y-0.5">
                                        <span className="font-bold text-white flex items-center gap-1.5 text-red-400">
                                            <Shield size={12} />
                                            激活本币种 AI 智能平仓止损
                                        </span>
                                        <p className="text-[9px] text-slate-500 leading-normal">开启后本项持仓将拥有专属底线防护，不受全局止损覆盖。</p>
                                    </div>
                                    <div 
                                        onClick={() => updateStopLoss('enabled', !slParams.enabled)} 
                                        className={`w-8 h-4.5 rounded-full p-0.5 transition-colors cursor-pointer ${slParams.enabled ? 'bg-red-600' : 'bg-slate-800'}`}
                                    >
                                        <div className={`w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${slParams.enabled ? 'translate-x-3.5' : 'translate-x-0'}`}/>
                                    </div>
                                </div>

                                {slParams.enabled && (
                                    <div className="space-y-3.5">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <span className="text-[10px] text-slate-300 font-bold">防守底线阈值 (收益率 %)</span>
                                                <p className="text-[9px] text-slate-500 leading-normal">本位浮亏触发最大限制（输入为正数例如5.0，浮亏会对应成 -5.0%）</p>
                                            </div>
                                            <div className="flex items-center bg-[#0b0e11] rounded px-2.5 py-1 border border-slate-800 shrink-0">
                                                <input 
                                                    type="number" 
                                                    value={slParams.lossPercent} 
                                                    onChange={(e) => updateStopLoss('lossPercent', Math.abs(Number(e.target.value)))}
                                                    className="w-16 bg-transparent text-right font-mono text-[11px] focus:outline-none text-red-400"
                                                />
                                                <span className="text-[9px] text-slate-500 ml-1">%</span>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between pt-1.5 border-t border-slate-800/40">
                                            <div>
                                                <span className="text-[10px] text-slate-300 font-bold">起步激活本金门槛 (USDT)</span>
                                                <p className="text-[9px] text-slate-500 leading-normal">仅在仓位总本金大于或等于该数值时执行独立止损</p>
                                            </div>
                                            <div className="flex items-center bg-[#0b0e11] rounded px-2.5 py-1 border border-slate-800 shrink-0">
                                                <input 
                                                    type="number" 
                                                    value={slParams.minPosition} 
                                                    onChange={(e) => updateStopLoss('minPosition', Number(e.target.value))}
                                                    className="w-16 bg-transparent text-right font-mono text-[11px] focus:outline-none text-white"
                                                />
                                                <span className="text-[9px] text-slate-500 ml-1">U</span>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between pt-1.5 border-t border-slate-800/40">
                                            <div>
                                                <span className="text-[10px] text-slate-300 font-bold">止损平仓数量比率 (%)</span>
                                                <p className="text-[9px] text-slate-500 leading-normal">到达止损点后执行的扣减比例 (选 100% 代表全仓闪断止损)</p>
                                            </div>
                                            <div className="flex items-center bg-[#0b0e11] rounded px-2.5 py-1 border border-slate-800 shrink-0">
                                                <input 
                                                    type="number" 
                                                    value={slParams.closePercent || 100} 
                                                    onChange={(e) => updateStopLoss('closePercent', Number(e.target.value))}
                                                    className="w-16 bg-transparent text-right font-mono text-[11px] focus:outline-none text-white"
                                                />
                                                <span className="text-[9px] text-slate-500 ml-1">%</span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                        </div>
                    )}

                    {!useCustom && position.symbol !== 'GLOBAL_DEFAULT' && (
                        <div className="p-4 bg-slate-900/30 rounded border border-slate-800/60 leading-relaxed text-[11px] animate-in fade-in duration-200">
                            <div className="flex items-start gap-2.5 text-slate-400">
                                <AlertCircle size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                                <div>
                                    <span className="font-bold text-slate-300">自动继承全局风控参数说明：</span>
                                    <p className="mt-1 text-slate-400 text-[10px]">
                                        当前正在沿用全局设置中的 
                                        <span className="text-emerald-400 font-bold mx-1">
                                            {globalSettings.profit.profitMode === 'CONVENTIONAL' ? '【常规模式】' :
                                             globalSettings.profit.profitMode === 'ATR' ? '【趋势模式】' :
                                             globalSettings.profit.profitMode === 'SMART' ? '【智能模式】' :
                                             globalSettings.profit.profitMode === 'AI' ? '【AI推演】' : '【全局通算】'}
                                        </span> 止盈规则。
                                    </p>
                                </div>
                            </div>
                            <div className="mt-3.5 bg-slate-950/45 p-3 rounded border border-slate-800 text-[10px] text-slate-500 leading-relaxed space-y-1">
                                <span className="font-black text-slate-400 uppercase tracking-widest block">💡 操作建议：</span>
                                <p>如果 <span className="font-mono text-emerald-400">{position.symbol}</span> 当前面临极端大牛市、主力高度控盘暴涨行情，建议您立即开启上方 <span className="text-emerald-400 font-bold">“部署单币托管规则”</span> 按钮，为其分配更弹性的智能算力支持。</p>
                            </div>
                        </div>
                    )}

                </div>

                {/* Footer Buttons */}
                <div className="px-5 py-3.5 border-t border-slate-800/80 bg-[#0f1319] flex items-center justify-between shrink-0">
                    {position.symbol !== 'GLOBAL_DEFAULT' ? (
                        <button 
                            onClick={handleResetToGlobal}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-850 hover:bg-slate-800 hover:text-white text-slate-400 text-[10px] font-bold rounded-lg border border-slate-700/80 transition-all cursor-pointer"
                            title="还原，恢复与全局主控逻辑一致"
                        >
                            <RotateCcw size={11} />
                            <span>恢复全局集成</span>
                        </button>
                    ) : (
                        <div />
                    )}

                    <div className="flex items-center gap-2">
                        <button 
                            onClick={onClose}
                            className="px-4 py-1.5 bg-[#1a1f26] hover:bg-slate-800 text-slate-400 hover:text-slate-300 rounded-lg text-[10px] font-bold border border-slate-800/80 transition-all cursor-pointer"
                        >
                            取消
                        </button>
                        <button 
                            onClick={handleSave}
                            className="flex items-center gap-1 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-505 text-white rounded-lg text-[10px] font-bold border border-emerald-500 hover:border-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.2)] transition-all cursor-pointer"
                        >
                            <Save size={11} />
                            <span>部署生效</span>
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
};
