import React from 'react';
import { Play, Pause, BarChart2, CheckCircle2, AlertCircle } from 'lucide-react';
import { AppSettings } from '../../../types';
import { audioService } from '../../../services/audioService';

interface Props {
    isSimulating: boolean;
    onToggleSim: () => void;
    onOpenScanner: () => void;
    settings: AppSettings;
    onChange: (key: string, value: any) => void;
}

export const LiveDashboard: React.FC<Props> = ({ isSimulating, onToggleSim, onOpenScanner, settings, onChange }) => {
    const isRealMode = settings.system.realTrading;
    const hasKeys = !!(settings.system.binanceApiKey && settings.system.binanceApiSecret);

    return (
        <div className="space-y-3">
            {/* Trading Mode Switcher */}
            <div className="bg-slate-900/60 p-2.5 rounded border border-slate-800 space-y-2">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">交易模式 (Trading Mode)</div>
                <div className="flex bg-slate-950 p-0.5 rounded border border-slate-800 gap-1">
                    <button
                        onClick={() => {
                            if (isRealMode) {
                                onChange('realTrading', false);
                                audioService.speak("已切回模拟交易模式");
                            }
                        }}
                        className={`flex-1 py-1 rounded text-[9px] font-bold uppercase transition-all ${
                            !isRealMode 
                                ? 'bg-indigo-900/40 text-indigo-400 border border-indigo-500/30' 
                                : 'text-slate-500 hover:text-slate-300 border border-transparent'
                        }`}
                    >
                        模拟测试 (Simulated)
                    </button>
                    <button
                        onClick={() => {
                            if (!isRealMode) {
                                onChange('realTrading', true);
                                audioService.speak("实盘交易模式已开启，请确保API密钥正确填写");
                            }
                        }}
                        className={`flex-1 py-1 rounded text-[9px] font-bold uppercase transition-all ${
                            isRealMode 
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30' 
                                : 'text-slate-500 hover:text-slate-300 border border-transparent'
                        }`}
                    >
                        实盘 API 模式 (Live Trade)
                    </button>
                </div>
                {isRealMode && (
                    <div className="flex items-center gap-1.5 px-1 py-0.5 text-[9px]">
                        {hasKeys ? (
                            <>
                                <CheckCircle2 size={11} className="text-emerald-400" />
                                <span className="text-emerald-400 font-medium">Binance API 已对接就绪</span>
                            </>
                        ) : (
                            <>
                                <AlertCircle size={11} className="text-amber-400" />
                                <span className="text-amber-400 font-medium">未配置 API 密钥，请至“系统设置”填写</span>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Run Switch */}
            <div className="flex items-center justify-between bg-slate-800 p-2.5 rounded border border-slate-700">
                <div>
                    <span className="text-xs font-bold text-slate-200">
                        {isRealMode ? '实盘核心策略引擎' : '模拟策略引擎'}
                    </span>
                    <p className="text-[9px] text-slate-500 leading-none mt-0.5">
                        {isSimulating ? '策略执行中...' : '已暂停'}
                    </p>
                </div>
                <button 
                    onClick={onToggleSim}
                    className={`px-3 py-1.5 rounded text-[10px] font-bold flex items-center gap-1 transition-all ${
                        isSimulating 
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/40' 
                            : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                    }`}
                >
                    {isSimulating ? <Pause size={10}/> : <Play size={10}/>}
                    {isSimulating ? '运行中' : '已暂停'}
                </button>
            </div>
            
            <button 
                onClick={onOpenScanner}
                className="w-full py-2 bg-cyan-900/30 hover:bg-cyan-900/50 border border-cyan-500/30 text-cyan-400 rounded text-xs font-bold flex items-center justify-center gap-2"
            >
                <BarChart2 size={14}/> 打开智能扫描器
            </button>
        </div>
    );
};
