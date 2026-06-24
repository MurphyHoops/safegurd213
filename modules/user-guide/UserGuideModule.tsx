import React from 'react';
import { BookOpen } from 'lucide-react';

interface Props {
    onOpenManual: () => void;
}

export const UserGuideModule: React.FC<Props> = ({ onOpenManual }) => {
    return (
        <div className="p-4 bg-slate-800/30 border-b border-slate-800 animate-in fade-in">
            <button 
                onClick={onOpenManual}
                className="w-full py-4 flex items-center justify-center gap-2 text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-lg transition-all shadow-lg shadow-indigo-900/30 font-bold"
            >
                <BookOpen size={18} /> 📘 打开操作说明书
            </button>
            <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="bg-slate-900/50 p-2 rounded border border-slate-700/50 text-center">
                    <span className="text-[10px] text-slate-400 block mb-1">快速入门</span>
                    <span className="text-[9px] text-slate-500">3分钟上手全攻略</span>
                </div>
                <div className="bg-slate-900/50 p-2 rounded border border-slate-700/50 text-center">
                    <span className="text-[10px] text-slate-400 block mb-1">策略详解</span>
                    <span className="text-[9px] text-slate-500">防爆与解套逻辑</span>
                </div>
            </div>
        </div>
    );
};
