import React from 'react';
import { BarChart4, BarChart2 } from 'lucide-react';

interface Props {
    onOpenScanner: () => void;
}

export const EmptyPositions: React.FC<Props> = ({ onOpenScanner }) => {
    return (
        <div className="flex-1 flex flex-col items-center justify-center h-48 text-slate-500 animate-in fade-in">
            <BarChart4 size={48} className="mb-4 opacity-20" />
            <p className="text-sm font-bold text-slate-400">暂无持仓</p>
            <p className="text-xs text-slate-600 mt-1">系统待机中，等待信号触发...</p>
            <button onClick={onOpenScanner} className="mt-4 px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full text-xs font-bold transition-all shadow-lg shadow-indigo-900/20 flex items-center gap-2">
                <BarChart2 size={14}/> 前往全域扫描
            </button>
        </div>
    );
};
