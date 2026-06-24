import React from 'react';
import { ShieldCheck, Sun, Moon, Music, VolumeX } from 'lucide-react';

interface Props {
    wakeLock: any;
    bgModeActive: boolean;
    toggleWakeLock: () => void;
    toggleBgMode: () => void;
}

export const GlobalProcessGuard: React.FC<Props> = ({ wakeLock, bgModeActive, toggleWakeLock, toggleBgMode }) => {
    return (
        <div className="p-3 bg-slate-950 border-b border-slate-800 shrink-0">
            <div className="flex items-center gap-2 mb-2">
                <ShieldCheck size={14} className="text-emerald-400"/>
                <span className="text-xs font-bold text-white">系统运行保障 (Process Guard)</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <button 
                    onClick={toggleWakeLock}
                    className={`flex items-center justify-center gap-2 py-2 rounded border transition-all ${wakeLock ? 'bg-yellow-900/30 border-yellow-500/50 text-yellow-400 shadow-[0_0_10px_rgba(234,179,8,0.2)]' : 'bg-slate-800 border-slate-700 text-slate-500 hover:bg-slate-700'}`}
                >
                    {wakeLock ? <Sun size={14} className="animate-pulse"/> : <Moon size={14}/>}
                    <span className="text-[10px] font-bold">{wakeLock ? '屏幕常亮: ON' : '屏幕常亮: OFF'}</span>
                </button>
                
                <button 
                    onClick={toggleBgMode}
                    className={`flex items-center justify-center gap-2 py-2 rounded border transition-all ${bgModeActive ? 'bg-blue-900/30 border-blue-500/50 text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.2)]' : 'bg-slate-800 border-slate-700 text-slate-500 hover:bg-slate-700'}`}
                >
                    {bgModeActive ? <Music size={14} className="animate-pulse"/> : <VolumeX size={14}/>}
                    <span className="text-[10px] font-bold">{bgModeActive ? '后台保活: ON' : '后台保活: OFF'}</span>
                </button>
            </div>
        </div>
    );
};
