import React from 'react';
import { Volume2 } from 'lucide-react';

interface Props {
    settings: any;
    onChange: (key: string, value: any) => void;
}

export const VoiceBroadcastPanel: React.FC<Props> = ({ settings, onChange }) => {
    // Ensure default is true if undefined
    const isEnabled = settings.voiceBroadcast !== false;

    return (
        <div className="bg-slate-900/50 p-2 rounded border border-slate-700">
            <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold text-white flex items-center gap-1">
                    <Volume2 size={10} className={isEnabled ? 'text-indigo-400' : 'text-slate-500'} /> 智能语音播报 (Smart Voice)
                </span>
                <div onClick={() => onChange('voiceBroadcast', !isEnabled)} className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${isEnabled ? 'bg-indigo-600' : 'bg-slate-700'}`}>
                    <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${isEnabled ? 'translate-x-4' : 'translate-x-0'}`}/>
                </div>
            </div>
            <p className="text-[9px] text-slate-500 leading-tight">
                针对列表2行情发现（穿越/发散形态）及列表5自动开仓、持仓变动（对冲/平仓等）进行即时语音播报。<br/>
                <span className="text-indigo-400 font-bold">已适配自然女性语音合成引擎，音色甜美自然。</span>
            </p>
        </div>
    );
};
