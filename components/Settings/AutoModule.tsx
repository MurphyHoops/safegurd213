
import React from 'react';
import { RefreshCw, Play, Pause, BarChart2 } from 'lucide-react';

interface Props {
    isSimulating: boolean;
    onToggleSim: () => void;
    onOpenScanner: () => void;
}

const AutoModule: React.FC<Props> = ({ isSimulating, onToggleSim, onOpenScanner }) => {
    return (
        <div className="p-4 bg-slate-800/30 space-y-4 border-b border-slate-800">
            <div className="flex items-center justify-between bg-slate-800 p-2 rounded border border-slate-700">
                <span className="text-xs font-bold text-slate-300">模拟交易系统</span>
                <button 
                    onClick={onToggleSim}
                    className={`px-3 py-1 rounded text-[10px] font-bold flex items-center gap-1 ${isSimulating ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-400'}`}
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

export default AutoModule;
