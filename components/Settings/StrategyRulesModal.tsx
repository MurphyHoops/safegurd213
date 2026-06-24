import React from 'react';
import { X, Info } from 'lucide-react';

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

export const StrategyRulesModal: React.FC<Props> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-slate-900 border border-amber-500/50 rounded-lg shadow-2xl w-full max-w-md p-5 animate-in fade-in zoom-in-95">
                <div className="flex justify-between items-start mb-4">
                    <h3 className="text-sm font-bold text-amber-400 flex items-center gap-2">
                        <Info size={16} /> 3.3 回调盈利清仓 (运行规则)
                    </h3>
                    <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={16}/></button>
                </div>
                <div className="space-y-3 text-[10px] text-slate-300 leading-relaxed">
                    <div className="bg-slate-800/50 p-2 rounded border border-slate-700">
                        <span className="text-blue-400 font-bold block mb-1">1. 触发逻辑 (Entry)</span>
                        初始开仓由【2. 防爆对冲】模块触发。一旦进入回调清仓模式，后续加仓由【价格突破极值】触发。
                    </div>
                    <div className="bg-slate-800/50 p-2 rounded border border-slate-700">
                        <span className="text-emerald-400 font-bold block mb-1">2. 循环收割 (Harvest)</span>
                        当对冲仓位盈利达到【对冲盈利目标】且回调【回调比例】时，仅平掉对冲仓位，保留原仓位。盈利计入“总子弹”。
                    </div>
                    <div className="bg-slate-800/50 p-2 rounded border border-slate-700">
                        <span className="text-amber-400 font-bold block mb-1">3. 最终胜利 (Victory)</span>
                        当【历史累计对冲盈利 + 当前对冲浮盈 + 原仓当前浮盈】 &gt; 【最大债务 * (1+覆盖阈值)】时，执行全平。
                    </div>
                </div>
                <button onClick={onClose} className="w-full mt-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded text-xs">关闭</button>
            </div>
        </div>
    );
};
