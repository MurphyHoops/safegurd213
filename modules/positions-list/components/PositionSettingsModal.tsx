import React, { useState, useEffect } from 'react';
import { Position, ProfitSettings, AppSettings, PositionSide } from '../../../types';
import { X, Settings, Target, Shield, HelpCircle, Save, RotateCcw, AlertCircle, Sparkles, Brain, Cpu, CheckCircle } from 'lucide-react';
import { audioService } from '../../../services/audioService';

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

    const [activeTab, setActiveTab] = useState<'SMART_PROFIT' | 'STOP_LOSS'>('SMART_PROFIT');

    useEffect(() => {
        if (isOpen) {
            setUseCustom(!!position.customProfitSettings);
            setLocalSettings(
                position.customProfitSettings 
                    ? JSON.parse(JSON.stringify(position.customProfitSettings))
                    : JSON.parse(JSON.stringify(globalSettings.profit))
            );
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

            if (presetName === 'HIGH_FREQ') {
                next.ai.aiSmartModeEnabled = true;
                next.ai.activationProfitPercent = 2.0;    // 2.0%
                next.ai.fallbackProfitPercent = 0.5;      // 0.5%
                next.ai.atrMultiplier = 1.5;              // 1.5
                next.ai.momentumWeight = 4;
                next.ai.volResonance = 5;
                audioService.speak("已为您匹配：高频波动收割预设方案", true);
            } else if (presetName === 'BALANCED') {
                next.ai.aiSmartModeEnabled = true;
                next.ai.activationProfitPercent = 4.5;    // 4.5%
                next.ai.fallbackProfitPercent = 1.5;      // 1.5%
                next.ai.atrMultiplier = 2.8;              // 2.8
                next.ai.momentumWeight = 6;
                next.ai.volResonance = 6;
                audioService.speak("已为您匹配：中线平衡稳健预设方案", true);
            } else if (presetName === 'EXPLOSIVE') {
                next.ai.aiSmartModeEnabled = true;
                next.ai.activationProfitPercent = 8.5;    // 8.5%
                next.ai.fallbackProfitPercent = 2.5;      // 2.5%
                next.ai.atrMultiplier = 3.5;              // 3.5 (宽幅追踪，防震荡)
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
            // Apply current active tab mode in the custom config
            const finalSettings: ProfitSettings = {
                ...localSettings,
                profitMode: 'AI', // This automatically uses our updated AI smart takeprofit core
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

    // Get current visual parameters for prompt representation
    const aiParams = localSettings.ai || {
        aiSmartModeEnabled: true,
        activationProfitPercent: 3.5,
        fallbackProfitPercent: 1.0,
        atrMultiplier: 2.5,
        momentumWeight: 5,
        volResonance: 6
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
                                <span className="text-xs text-emerald-400 font-bold">智能平仓体系</span>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-0.5">多维量价感知 · 动态ATR容忍回调 · 精准逃顶最大化收益</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-500 hover:text-slate-300 transition-all cursor-pointer">
                        <X size={16} />
                    </button>
                </div>

                {/* Sub Tab Navigation */}
                <div className="flex px-4 py-2 bg-[#0d1116] border-b border-slate-800/60 justify-between items-center shrink-0">
                    <div className="flex gap-1.5">
                        <button
                            onClick={() => setActiveTab('SMART_PROFIT')}
                            className={`px-3 py-1 text-[11px] font-bold rounded-md flex items-center gap-1.5 transition-all ${activeTab === 'SMART_PROFIT' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                            <Sparkles size={12} />
                            <span>AI智能盈利平仓</span>
                        </button>
                        <button
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
                                <p className="text-[10px] text-slate-400">正在编辑系统默认使用的智能移动波段追踪参数。持仓列表中未设置独立风控规则的币种将自动继承此组参数。</p>
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

                    {(useCustom || position.symbol === 'GLOBAL_DEFAULT') && activeTab === 'SMART_PROFIT' && (
                        <div className="space-y-4 animate-in fade-in duration-200">
                            
                            {/* Preset Selection Panel */}
                            <div className="bg-slate-900/30 p-3.5 rounded-lg border border-slate-800/80 space-y-2.5">
                                <span className="font-black text-slate-300 text-[10px] tracking-wider uppercase block">⚡️ 极速AI策略参数一键匹配</span>
                                <div className="grid grid-cols-3 gap-2">
                                    <button
                                        onClick={() => applyPreset('HIGH_FREQ')}
                                        className="py-2.5 px-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 rounded text-center transition-all cursor-pointer group"
                                    >
                                        <div className="font-black text-emerald-400 text-[10px]">高频波动收割</div>
                                        <div className="text-[8px] text-slate-500 mt-0.5 group-hover:text-slate-400">浮盈 2% 启动 / 紧凑止盈</div>
                                    </button>
                                    <button
                                        onClick={() => applyPreset('BALANCED')}
                                        className="py-2.5 px-2 bg-slate-800 hover:bg-slate-700 border border-emerald-500/20 hover:border-slate-500 rounded text-center transition-all cursor-pointer group"
                                    >
                                        <div className="font-black text-blue-400 text-[10px]">中线自适应稳健</div>
                                        <div className="text-[8px] text-slate-500 mt-0.5 group-hover:text-slate-400">浮盈 4.5% 启动 / ATR平衡</div>
                                    </button>
                                    <button
                                        onClick={() => applyPreset('EXPLOSIVE')}
                                        className="py-2.5 px-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 rounded text-center transition-all cursor-pointer group"
                                    >
                                        <div className="font-black text-amber-400 text-[10px]">暴涨主升浪逃顶</div>
                                        <div className="text-[8px] text-slate-500 mt-0.5 group-hover:text-slate-400">浮盈 8.5% 启动 / 宽幅追踪</div>
                                    </button>
                                </div>
                            </div>

                            {/* Configuration Items */}
                            <div className="bg-slate-900/40 p-4 rounded-lg border border-slate-800 space-y-3.5">
                                
                                {/* Item 1: Smart AI Toggle */}
                                <div className="flex items-center justify-between pb-2 border-b border-slate-800/60">
                                    <div className="space-y-0.5">
                                        <span className="font-bold text-white flex items-center gap-1.5">
                                            <Cpu size={12} className="text-emerald-400" />
                                            启用AI动态风控算力托管
                                        </span>
                                        <p className="text-[9px] text-slate-500 leading-normal">关闭后将忽略AI对波动指标的自适应调节算力</p>
                                    </div>
                                    <div 
                                        onClick={() => updateAiField('aiSmartModeEnabled', !(aiParams.aiSmartModeEnabled ?? true))} 
                                        className={`w-8 h-4.5 rounded-full p-0.5 transition-colors cursor-pointer ${aiParams.aiSmartModeEnabled ?? true ? 'bg-emerald-600' : 'bg-slate-800'}`}
                                    >
                                        <div className={`w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${aiParams.aiSmartModeEnabled ?? true ? 'translate-x-3.5' : 'translate-x-0'}`}/>
                                    </div>
                                </div>

                                {/* Item 2: Activation Threshold */}
                                <div className="space-y-1.5">
                                    <div className="flex justify-between items-center">
                                        <div className="space-y-0.5">
                                            <span className="font-bold text-slate-200">AI 智能启动盈利阈值</span>
                                            <span className="text-[8px] text-amber-500/90 font-bold ml-1.5 bg-amber-500/10 px-1 rounded">建议范围: 1.5% - 15.0%</span>
                                        </div>
                                        <div className="flex items-center bg-[#0b0e11] rounded px-2.5 py-1 border border-slate-800">
                                            <input 
                                                type="number" 
                                                step="0.1"
                                                value={aiParams.activationProfitPercent ?? 3.5} 
                                                onChange={(e) => updateAiField('activationProfitPercent', Number(e.target.value))}
                                                className="w-16 bg-transparent text-right font-mono text-[11px] font-bold focus:outline-none text-emerald-400"
                                            />
                                            <span className="text-[9px] text-slate-500 ml-1">%</span>
                                        </div>
                                    </div>
                                    <p className="text-[9px] text-slate-500 leading-normal">当该币收益率达到此门槛时，AI追踪器正式启动。未达到前，维持用下方或常规规则监控价格。</p>
                                </div>

                                {/* Item 3: Fallback Threshold */}
                                <div className="space-y-1.5 pt-1.5 border-t border-slate-800/40">
                                    <div className="flex justify-between items-center">
                                        <div className="space-y-0.5">
                                            <span className="font-bold text-slate-200">退回常规/保护性止盈线</span>
                                            <span className="text-[8px] text-amber-500/90 font-bold ml-1.5 bg-amber-500/10 px-1 rounded">建议范围: 0.2% - 5.0%</span>
                                        </div>
                                        <div className="flex items-center bg-[#0b0e11] rounded px-2.5 py-1 border border-slate-800">
                                            <input 
                                                type="number" 
                                                step="0.1"
                                                value={aiParams.fallbackProfitPercent ?? 1.0} 
                                                onChange={(e) => updateAiField('fallbackProfitPercent', Number(e.target.value))}
                                                className="w-16 bg-transparent text-right font-mono text-[11px] font-bold focus:outline-none text-orange-400"
                                            />
                                            <span className="text-[9px] text-slate-500 ml-1">%</span>
                                        </div>
                                    </div>
                                    <p className="text-[9px] text-slate-500 leading-normal">开启AI追踪后若发生冲高回落，收益率跌破此水位时，系统退回并按“常规止盈平仓”，保障利润落袋。</p>
                                </div>

                                {/* Item 4: Adaptive ATR Multiplier */}
                                <div className="space-y-1.5 pt-1.5 border-t border-slate-800/40">
                                    <div className="flex justify-between items-center">
                                        <div className="space-y-0.5">
                                            <span className="font-bold text-slate-200">自适应 ATR 波动性受容系数</span>
                                            <span className="text-[8px] text-emerald-400 font-bold ml-1.5 bg-emerald-500/10 px-1 rounded">建议范围: 1.0 - 5.0</span>
                                        </div>
                                        <div className="flex items-center bg-[#0b0e11] rounded px-2.5 py-1 border border-slate-800">
                                            <input 
                                                type="number" 
                                                step="0.1"
                                                value={aiParams.atrMultiplier ?? 2.5} 
                                                onChange={(e) => updateAiField('atrMultiplier', Number(e.target.value))}
                                                className="w-16 bg-transparent text-right font-mono text-[11px] font-bold focus:outline-none text-white"
                                            />
                                            <span className="text-[9px] text-slate-500 ml-1">倍</span>
                                        </div>
                                    </div>
                                    <p className="text-[9px] text-slate-500 leading-normal">设定为价格波动容限。乘数越大，允许价格剧烈横盘回落的空间越宽，避免在拉升期由于正常洗盘被提早震荡出局。</p>
                                </div>

                                {/* Item 5: Momentum Weight */}
                                <div className="space-y-1.5 pt-1.5 border-t border-slate-800/40">
                                    <div className="flex justify-between items-center">
                                        <div className="space-y-0.5">
                                            <span className="font-bold text-slate-200">涨跌幅强力动能因子敏感权重</span>
                                            <span className="text-[8px] text-emerald-400 font-bold ml-1.5 bg-emerald-500/10 px-1 rounded">建议范围: 1 - 10</span>
                                        </div>
                                        <div className="flex items-center bg-[#0b0e11] rounded px-2.5 py-1 border border-slate-800">
                                            <input 
                                                type="number" 
                                                min="1"
                                                max="10"
                                                value={aiParams.momentumWeight ?? 5} 
                                                onChange={(e) => updateAiField('momentumWeight', Number(e.target.value))}
                                                className="w-16 bg-transparent text-right font-mono text-[11px] font-bold focus:outline-none text-white"
                                            />
                                        </div>
                                    </div>
                                    <p className="text-[9px] text-slate-500 leading-normal">当偏离度（Deviation）达到极端值时（如急速暴涨5%以上），权重越高越有利于AI极速收紧回撤幅度、确保保本安全逃大顶。</p>
                                </div>

                                {/* Item 6: Volume Resonance */}
                                <div className="space-y-1.5 pt-1.5 border-t border-slate-800/40">
                                    <div className="flex justify-between items-center">
                                        <div className="space-y-0.5">
                                            <span className="font-bold text-slate-200">量价共振出货警告共振权重</span>
                                            <span className="text-[8px] text-emerald-400 font-bold ml-1.5 bg-emerald-500/10 px-1 rounded">建议范围: 1 - 10</span>
                                        </div>
                                        <div className="flex items-center bg-[#0b0e11] rounded px-2.5 py-1 border border-slate-800">
                                            <input 
                                                type="number" 
                                                min="1"
                                                max="10"
                                                value={aiParams.volResonance ?? 6} 
                                                onChange={(e) => updateAiField('volResonance', Number(e.target.value))}
                                                className="w-16 bg-transparent text-right font-mono text-[11px] font-bold focus:outline-none text-white"
                                            />
                                        </div>
                                    </div>
                                    <p className="text-[9px] text-slate-500 leading-normal">检测量比激增（天量滞涨）。若主力在顶峰疯狂出货导致成交量暴涨，该权重越高促使AI感知越锋利，回落出场容限越缩窄。</p>
                                </div>

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
                                            激活本币种防爆仓独立止损
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
