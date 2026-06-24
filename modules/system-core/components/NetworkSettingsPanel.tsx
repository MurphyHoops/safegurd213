import React from 'react';
import { Zap } from 'lucide-react';

interface Props {
    settings: any;
    onChange: (key: string, value: any) => void;
}

export const NetworkSettingsPanel: React.FC<Props> = ({ settings, onChange }) => {
    return (
        <div className="bg-slate-900/50 p-2 rounded border border-slate-700">
            <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold text-white flex items-center gap-1"><Zap size={10} className={settings.directMode ? 'text-yellow-400' : 'text-slate-500'} /> 直连模式 (Direct Mode)</span>
                <div onClick={() => onChange('directMode', !settings.directMode)} className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.directMode ? 'bg-yellow-600' : 'bg-slate-700'}`}>
                    <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.directMode ? 'translate-x-4' : 'translate-x-0'}`}/>
                </div>
            </div>
            <p className="text-[9px] text-slate-500 leading-tight">
                开启后将不经过代理直接连接交易所。需自备海外网络环境 (VPN)。<br/>
                <span className="text-emerald-500 font-bold">优势：极速加载，解决 8AM 列表卡顿。</span>
            </p>
        </div>
    );
};
