
import React from 'react';
import { X, Flame, Shield, Zap, Ban } from 'lucide-react';

interface Props {
    onClose: () => void;
}

export const RulesModal: React.FC<Props> = ({ onClose }) => (
    <div className="absolute top-0 left-0 right-0 z-50 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-4 animate-in fade-in zoom-in-95">
        <div className="flex justify-between items-start mb-3 border-b border-slate-800 pb-2">
            <h3 className="text-xs font-bold text-amber-500 flex items-center gap-2">
                <Flame size={12} fill="currentColor"/> 动能审计规则 (Momentum Rules)
            </h3>
            <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={14}/></button>
        </div>
        
        <div className="space-y-4 overflow-y-auto max-h-[400px] custom-scrollbar">
            
            {/* Section 1: Midline Defense */}
            <div className="bg-slate-800/50 p-2 rounded border border-slate-700">
                <div className="text-[10px] font-bold text-emerald-400 mb-1 flex items-center gap-1">
                    <Shield size={10} /> 1. 中轴防守线 (Dynamic Defense)
                </div>
                <p className="text-[9px] text-slate-400 leading-relaxed mb-2">
                    <strong>逻辑：</strong> 以信号K线的极值（做多看顶，做空看底）为基准，只允许价格回撤振幅的一定比例。
                </p>
                <div className="bg-slate-900 p-1.5 rounded text-[9px] font-mono text-slate-300 space-y-1">
                    <div className="flex justify-between border-b border-slate-800 pb-1 mb-1">
                        <span className="text-slate-500">计算公式:</span>
                        <span>缓冲值 = K线振幅 × (设定值/100)</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-emerald-500">做多防守价:</span>
                        <span>信号最高价(High) - 缓冲值</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-red-500">做空防守价:</span>
                        <span>信号最低价(Low) + 缓冲值</span>
                    </div>
                    <div className="text-[8px] text-slate-500 mt-1 pt-1 border-t border-slate-800">
                        * 举例 (做多): High=1100, Amp=100, 设50%。防守价 = 1100 - 50 = 1050。<br/>
                        * 只要后续有任何K线的最低价跌破 1050，即判定结构破坏。
                    </div>
                </div>
            </div>

            {/* Section 2: Breakout Trigger */}
            <div className="bg-slate-800/50 p-2 rounded border border-slate-700">
                <div className="text-[10px] font-bold text-amber-400 mb-1 flex items-center gap-1">
                    <Zap size={10} fill="currentColor"/> 2. 进攻突破线 (Adaptive Trigger)
                </div>
                <p className="text-[9px] text-slate-400 leading-relaxed mb-2">
                    <strong>定义：</strong> 价格必须突破信号K线的极值（High/Low）一定比例才算确认爆发。
                </p>
                <div className="bg-slate-900 p-1.5 rounded text-[9px] font-mono text-slate-300 space-y-1">
                    <div className="flex justify-between border-b border-slate-800 pb-1 mb-1">
                        <span className="text-slate-500">计算公式:</span>
                        <span>缓冲值 = K线振幅 × (设定值/100)</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-emerald-500">做多触发:</span>
                        <span>信号High + 缓冲值</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-red-500">做空触发:</span>
                        <span>信号Low - 缓冲值</span>
                    </div>
                </div>
            </div>

            {/* Section 3: State Machine */}
            <div className="p-2 border border-slate-800 rounded">
                <div className="text-[10px] font-bold text-slate-500 mb-2 text-center">状态流转逻辑</div>
                <div className="flex justify-between items-center text-[9px] font-bold">
                    <div className="bg-slate-800 text-slate-400 px-2 py-1 rounded border border-slate-700">PENDING<br/><span className="text-[8px] font-normal">等待中</span></div>
                    <div className="h-px w-4 bg-slate-600"></div>
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1">
                            <span className="text-amber-500">→</span>
                            <span className="bg-amber-900/30 text-amber-400 px-2 py-1 rounded border border-amber-500/30 flex gap-1"><Zap size={8}/> TRIGGERED</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="text-red-500">→</span>
                            <span className="bg-red-900/30 text-red-400 px-2 py-1 rounded border border-red-500/30 flex gap-1"><Ban size={8}/> INVALID</span>
                        </div>
                    </div>
                </div>
            </div>

        </div>
    </div>
);
