
import React from 'react';
import { StopLossSettings } from '../../../types';
import { Bot, Cpu } from 'lucide-react';

interface Props {
    settings: StopLossSettings;
    onChange: (key: string, value: any) => void;
}

const Strategy6_AIAdvisor: React.FC<Props> = ({ settings, onChange }) => {
    
    // Safe access to advisor settings
    const advisorSettings = settings.advisor || { enabled: false, autoSwitch: false, minConfidence: 70 };

    const updateAdvisor = (key: string, val: any) => {
        onChange('advisor', { ...advisorSettings, [key]: val });
    };

    return (
        <div className="space-y-2 border border-slate-700/50 rounded bg-slate-900/30 p-2">
            <div className="flex items-center justify-between pb-1 border-b border-slate-700/50 mb-2">
                <div className="flex items-center gap-2">
                    <Bot size={14} className="text-emerald-400" />
                    <span className="text-xs text-emerald-400 font-bold">6. AI 战术指挥官</span>
                </div>
                <div 
                    onClick={() => updateAdvisor('enabled', !advisorSettings.enabled)} 
                    className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${advisorSettings.enabled ? 'bg-emerald-600' : 'bg-slate-700'}`}
                >
                    <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${advisorSettings.enabled ? 'translate-x-4' : 'translate-x-0'}`}/>
                </div>
            </div>
            {advisorSettings.enabled && (
                <div className="space-y-2 animate-in fade-in">
                    <div className="flex items-center justify-between bg-slate-800/50 p-2 rounded border border-slate-700">
                        <span className="text-[10px] text-slate-400 flex items-center gap-1"><Cpu size={10}/> 全自动切换策略</span>
                        <div 
                            onClick={() => updateAdvisor('autoSwitch', !advisorSettings.autoSwitch)} 
                            className={`w-7 h-3.5 rounded-full p-0.5 transition-colors cursor-pointer ${advisorSettings.autoSwitch ? 'bg-indigo-500' : 'bg-slate-600'}`}
                        >
                            <div className={`w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${advisorSettings.autoSwitch ? 'translate-x-3.5' : 'translate-x-0'}`}/>
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] text-slate-500 block mb-1">切换置信度阈值 (Confidence &gt; %)</label>
                        <input 
                            type="number" 
                            min="1" max="100" 
                            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white font-bold" 
                            value={Number.isNaN(advisorSettings.minConfidence) ? '' : advisorSettings.minConfidence} 
                            onChange={(e) => updateAdvisor('minConfidence', parseFloat(e.target.value))} 
                        />
                    </div>
                    <div className="text-[9px] text-slate-500 bg-slate-800/50 p-1.5 rounded leading-relaxed border border-slate-700/30">
                        <strong>AI 托管：</strong> 实时分析 RSI/ADX/布林带，自动识别市场状态（趋势/震荡/反转），并为您在 4.1/4.2/4.3/4.4 策略之间进行智能切换。
                    </div>
                </div>
            )}
        </div>
    );
};

export default Strategy6_AIAdvisor;
