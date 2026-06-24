
import React from 'react';
import { ProfitManagerProps } from './types';
import { useProfitManager } from './useProfitManager';
import { TrendingUp, TrendingDown, Anchor, Globe, Zap, Cpu, Database, Play, History } from 'lucide-react';
import { ConventionalMode } from './components/ConventionalMode';
import { AtrTrendMode } from './components/AtrTrendMode';
import { SmartMode } from './components/SmartMode';
import { GlobalMode } from './components/GlobalMode';
import { AiMode } from './components/AiMode';
import { StopLossSection } from './components/StopLossSection';

export const ProfitManagerModule: React.FC<ProfitManagerProps> = (props) => {
    const { settings, onChange, updateNested, onOpenSaviorLab } = props;
    const { toggleOForMode } = useProfitManager(props);

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
                            {['CONVENTIONAL', 'ATR', 'SMART', 'GLOBAL', 'AI'].map((mode) => {
                                const labels: any = { CONVENTIONAL: '常规', ATR: '趋势', SMART: '智能', GLOBAL: '全局', AI: 'AI' };
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
                                            className={`w-8 h-full flex items-center justify-center border-l transition-colors hover:bg-slate-800/50 ${
                                                isActive ? 'border-emerald-500/20' : 'border-slate-700'
                                            }`}
                                            title="并联开关 (选中后该模式将始终在后台运行)"
                                        >
                                            <div className={`w-3 h-3 rounded-full transition-all duration-300 ${
                                                isOEnabled 
                                                ? 'bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,1)] scale-110' 
                                                : 'border-2 border-slate-600 bg-transparent opacity-40'
                                            }`} />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="bg-slate-900/40 p-3 rounded border border-slate-700/50">
                            {/* CONVENTIONAL */}
                            {settings.profitMode === 'CONVENTIONAL' && <ConventionalMode settings={settings} updateNested={updateNested} />}
                            {/* ATR TREND MODE */}
                            {settings.profitMode === 'ATR' && <AtrTrendMode settings={settings} updateNested={updateNested} />}
                            {/* SMART */}
                            {settings.profitMode === 'SMART' && <SmartMode settings={settings} updateNested={updateNested} />}
                            {/* GLOBAL MODE */}
                            {settings.profitMode === 'GLOBAL' && <GlobalMode settings={settings} updateNested={updateNested} />}
                            {/* AI MODE */}
                            {settings.profitMode === 'AI' && <AiMode settings={settings} updateNested={updateNested} onOpenSaviorLab={onOpenSaviorLab} />}
                        </div>
                    </>
                )}
            </div>

            {/* 1.2 止损平仓 */}
            <StopLossSection settings={settings} updateNested={updateNested} />
        </div>
    );
};
