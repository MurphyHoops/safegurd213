
import React from 'react';
import { X, CheckCircle2 } from 'lucide-react';

interface Props {
    onClose: () => void;
    limit: number;
}

export const RulesModal: React.FC<Props> = ({ onClose, limit }) => (
    <div className="absolute top-0 left-0 right-0 z-50 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-4 animate-in fade-in zoom-in-95">
        <div className="flex justify-between items-start mb-3 border-b border-slate-800 pb-2">
            <h3 className="text-xs font-bold text-white flex items-center gap-2"><CheckCircle2 size={12} className="text-orange-400"/> 扫描运行规则</h3>
            <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={14}/></button>
        </div>
        <div className="space-y-3 overflow-y-auto max-h-[400px] custom-scrollbar">
            <div className="space-y-1">
                <span className="text-[10px] font-bold text-indigo-400 block">A. 自动选币模式 (Auto)</span>
                <ul className="text-[9px] text-slate-400 list-disc list-inside space-y-0.5 leading-relaxed">
                    <li><strong className="text-slate-300">数据源:</strong> Binance Fapi Ticker (实时).</li>
                    <li><strong className="text-slate-300">时间基准:</strong> 8AM (UTC+0 日线) 或 24H (滚动).</li>
                    <li><strong className="text-slate-300">过滤条件:</strong>
                        <ul className="pl-3 list-[square]">
                            <li>成交额 &ge; 设定值 (百万U)</li>
                            <li>涨跌幅(Abs) &ge; 设定值 (%)</li>
                        </ul>
                    </li>
                    <li><strong className="text-slate-300">排序:</strong> 按波动率绝对值降序，取前 {limit} 名.</li>
                </ul>
            </div>
            <div className="space-y-1">
                <span className="text-[10px] font-bold text-cyan-400 block">B. 固定选币模式 (Fixed)</span>
                <ul className="text-[9px] text-slate-400 list-disc list-inside space-y-0.5 leading-relaxed">
                    <li><strong className="text-slate-300">范围:</strong> 仅监控【重点监控池】中的自定义名单.</li>
                    <li><strong className="text-slate-300">交集逻辑:</strong> 指定币种<span className="text-red-400">仍需满足</span>成交额与涨跌幅过滤条件，才会被纳入扫描列表.</li>
                </ul>
            </div>
        </div>
    </div>
);
