
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
                    <Shield size={10} /> 1. 中轴防守线 (Dynamic Defense - 触及立即清除)
                </div>
                <p className="text-[9px] text-slate-400 leading-relaxed mb-2">
                    <strong>逻辑：</strong> 只要价格触及或击穿中轴防守线，系统判定结构破坏并立即将该币从列表4清除。
                </p>
                <div className="bg-slate-900 p-1.5 rounded text-[9px] font-mono text-slate-300 space-y-1">
                    <div className="flex justify-between border-b border-slate-800 pb-1 mb-1">
                        <span className="text-slate-500">中轴防守公式:</span>
                        <span>防守缓冲 = (最高价 - 最低价) × 中轴防守百分比</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-emerald-500">多单中轴防守价:</span>
                        <span>最高价 - (最高价 - 最低价) × 中轴防守% (低于此价立即清除)</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-red-500">空单中轴防守价:</span>
                        <span>最低价 + (最高价 - 最低价) × 中轴防守% (高于此价立即清除)</span>
                    </div>
                    <div className="text-[8px] text-slate-500 mt-1 pt-1 border-t border-slate-800">
                        * 举例 (做多): 最高价=100, 最低价=90, 中轴防守=80% → 防守价 = 100 - (100 - 90) × 80% = 92。<br/>
                        * 举例 (做空): 最低价=90, 最高价=100, 中轴防守=80% → 防守价 = 90 + (100 - 90) × 80% = 98。
                    </div>
                </div>
            </div>

            {/* Section 2: Breakout Trigger */}
            <div className="bg-slate-800/50 p-2 rounded border border-slate-700">
                <div className="text-[10px] font-bold text-amber-400 mb-1 flex items-center gap-1">
                    <Zap size={10} fill="currentColor"/> 2. 进攻突破线 (Adaptive Trigger - 离弦开仓)
                </div>
                <p className="text-[9px] text-slate-400 leading-relaxed mb-2">
                    <strong>定义：</strong> 价格突破进攻突破线且符合所选条件时立即触发 TRIGGERED 开仓。
                </p>
                <div className="bg-slate-900 p-1.5 rounded text-[9px] font-mono text-slate-300 space-y-1">
                    <div className="flex justify-between border-b border-slate-800 pb-1 mb-1">
                        <span className="text-slate-500">进攻突破公式:</span>
                        <span>突破缓冲 = (最高价 - 最低价) × 进攻突破百分比</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-emerald-500">多单进攻突破价:</span>
                        <span>最高价 + (最高价 - 最低价) × 进攻突破% (超过此价开仓)</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-red-500">空单进攻突破价:</span>
                        <span>最低价 - (最高价 - 最低价) × 进攻突破% (低于此价开仓)</span>
                    </div>
                    <div className="text-[8px] text-slate-500 mt-1 pt-1 border-t border-slate-800">
                        * 举例 (做多): 最高=100, 最低=90, 进攻突破=10% → 突破价 = 100 + (100 - 90) × 10% = 101。<br/>
                        * 举例 (做空): 最低=90, 最高=100, 进攻突破=10% → 突破价 = 90 - (100 - 90) × 10% = 89。
                    </div>
                </div>
            </div>

            {/* Section 3: 3K Breakout Confirmation */}
            <div className="bg-slate-800/50 p-2 rounded border border-slate-700">
                <div className="text-[10px] font-bold text-cyan-400 mb-1 flex items-center gap-1">
                    <Zap size={10} fill="currentColor"/> 3. 前三K突破双重确认 (3K Close Breakout)
                </div>
                <p className="text-[9px] text-slate-400 leading-relaxed mb-2">
                    <strong>定义：</strong> 开启后，价格达到“进攻突破线”后仍需满足突破前 3 根 K 线的实体收盘极值，否则保持 PENDING 等待状态。
                </p>
                <div className="bg-slate-900 p-1.5 rounded text-[9px] font-mono text-slate-300 space-y-1">
                    <div className="flex justify-between border-b border-slate-800 pb-1 mb-1">
                        <span className="text-emerald-500">做多条件:</span>
                        <span>Price &gt; Max(Close[1], Close[2], Close[3])</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-red-500">做空条件:</span>
                        <span>Price &lt; Min(Close[1], Close[2], Close[3])</span>
                    </div>
                    <div className="text-[8px] text-slate-500 mt-1 pt-1 border-t border-slate-800">
                        * 若价格已达进攻突破线但未越过前3K极值，系统保持 PENDING 等待，直到后续K线突破后自动触发 TRIGGERED 开仓。
                    </div>
                </div>
            </div>

            {/* Section 4: State Machine */}
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
