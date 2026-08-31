import React from 'react';
import { StopLossSettings } from '../../../types';
import { Activity, ShieldAlert, Volume2, UserCheck, CheckCircle2 } from 'lucide-react';

interface Props {
    settings: StopLossSettings;
    onChange: (key: string, value: any) => void;
}

const Strategy5_OscillationGuard: React.FC<Props> = ({ settings, onChange }) => {
    const currentMode = settings.fuseActionMode || 'MANUAL';
    const isAlertEnabled = settings.fuseAlertEnabled !== false;

    return (
        <div className="space-y-2 border border-slate-700/50 rounded bg-slate-900/30 p-2">
            <div className="flex items-center justify-between pb-1 border-b border-slate-700/50 mb-2">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-orange-400 flex items-center gap-1">
                        <Activity size={12}/> 5. 震荡磨损保护 (熔断机制)
                    </span>
                </div>
                <div 
                    onClick={() => onChange('fuseEnabled', !settings.fuseEnabled)} 
                    className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.fuseEnabled ? 'bg-orange-600' : 'bg-slate-700'}`}
                >
                    <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.fuseEnabled ? 'translate-x-4' : 'translate-x-0'}`}/>
                </div>
            </div>

            {settings.fuseEnabled && (
                <div className="space-y-3 animate-in fade-in pt-1">
                    {/* 1. 补仓上限次数 */}
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] text-slate-400 font-semibold flex items-center gap-1">
                                <ShieldAlert size={11} className="text-orange-400" />
                                补仓达到上限次数 (次)
                            </label>
                            <span className="text-[10px] text-orange-400 font-mono font-bold">
                                {settings.maxHedgeRetries || 3} 次
                            </span>
                        </div>
                        <input 
                            type="number" 
                            min="1" 
                            max="10" 
                            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:border-orange-500 font-mono" 
                            value={Number.isNaN(settings.maxHedgeRetries) ? '' : (settings.maxHedgeRetries || 3)} 
                            onChange={(e) => onChange('maxHedgeRetries', parseFloat(e.target.value))} 
                        />
                        <p className="text-[9px] text-slate-500 mt-1">
                            启动防爆对冲后，单币累计补仓达到此次数后不再进行砍仓与补仓。
                        </p>
                    </div>

                    {/* 2. 熔断处置模式选择 */}
                    <div className="pt-1 border-t border-slate-800/80">
                        <label className="text-[10px] text-slate-400 font-semibold block mb-1.5">
                            达到补仓上限后的处置模式
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => onChange('fuseActionMode', 'MANUAL')}
                                className={`flex flex-col items-start p-2 rounded border text-left transition-all ${
                                    currentMode === 'MANUAL'
                                        ? 'bg-amber-950/40 border-amber-500/60 text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.15)]'
                                        : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:border-slate-600'
                                }`}
                            >
                                <div className="flex items-center gap-1 font-bold text-[11px] mb-0.5">
                                    <UserCheck size={12} className={currentMode === 'MANUAL' ? 'text-amber-400' : 'text-slate-500'} />
                                    <span>人工介入处理</span>
                                    {currentMode === 'MANUAL' && <CheckCircle2 size={10} className="text-amber-400 ml-auto" />}
                                </div>
                                <span className="text-[9px] text-slate-400 leading-tight">
                                    停止自动砍/补，保持持仓并触发人工处理弹窗与语音
                                </span>
                            </button>

                            <button
                                type="button"
                                onClick={() => onChange('fuseActionMode', 'AUTO_CLOSE')}
                                className={`flex flex-col items-start p-2 rounded border text-left transition-all ${
                                    currentMode === 'AUTO_CLOSE'
                                        ? 'bg-red-950/40 border-red-500/60 text-red-300 shadow-[0_0_8px_rgba(239,68,68,0.15)]'
                                        : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:border-slate-600'
                                }`}
                            >
                                <div className="flex items-center gap-1 font-bold text-[11px] mb-0.5">
                                    <ShieldAlert size={12} className={currentMode === 'AUTO_CLOSE' ? 'text-red-400' : 'text-slate-500'} />
                                    <span>自动清仓止损</span>
                                    {currentMode === 'AUTO_CLOSE' && <CheckCircle2 size={10} className="text-red-400 ml-auto" />}
                                </div>
                                <span className="text-[9px] text-slate-400 leading-tight">
                                    达到补仓次数后，毫秒级市价全平该币对冲双向仓位
                                </span>
                            </button>
                        </div>
                    </div>

                    {/* 3. 语音播报与弹窗提醒开关 */}
                    <div className="pt-1 border-t border-slate-800/80 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                            <Volume2 size={12} className="text-cyan-400" />
                            <div>
                                <span className="text-[10px] text-slate-300 font-semibold block">
                                    语音连报 3 次与弹窗提醒
                                </span>
                                <span className="text-[9px] text-slate-500 block">
                                    触发时播报：“[币名]防爆对冲已经达到[N]次补仓，{currentMode === 'AUTO_CLOSE' ? '已自动清仓止损' : '请人工尽快处理'}”
                                </span>
                            </div>
                        </div>
                        <div 
                            onClick={() => onChange('fuseAlertEnabled', !isAlertEnabled)} 
                            className={`w-7 h-3.5 rounded-full p-0.5 transition-colors cursor-pointer shrink-0 ml-2 ${isAlertEnabled ? 'bg-cyan-600' : 'bg-slate-700'}`}
                        >
                            <div className={`w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${isAlertEnabled ? 'translate-x-3.5' : 'translate-x-0'}`}/>
                        </div>
                    </div>

                    {/* 4. 熔断后强制止损百分比 */}
                    <div className="pt-1 border-t border-slate-800/80">
                        <label className="text-[10px] text-slate-400 font-semibold block mb-1">
                            熔断后兜底强平止损 (Fail Stop) %
                            <span className="text-red-400 ml-1 text-[9px]">(基于标的原价变动幅度)</span>
                        </label>
                        <input 
                            type="number" 
                            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-red-400 focus:border-red-500 font-mono" 
                            value={Number.isNaN(settings.fuseFailStopPercent) ? '' : (settings.fuseFailStopPercent || 30)} 
                            onChange={(e) => onChange('fuseFailStopPercent', parseFloat(e.target.value))} 
                        />
                        <p className="text-[9px] text-slate-600 mt-1">
                            若选择人工处理且行情继续单边恶化，当原仓位亏损达到此比例时强制平仓防止爆仓。
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Strategy5_OscillationGuard;
