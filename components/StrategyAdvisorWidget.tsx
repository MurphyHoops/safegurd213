
import React from 'react';
import { StrategyRecommendation } from '../types';
import { Bot, Activity, CheckCircle, Zap } from 'lucide-react';

interface Props {
    recommendation: StrategyRecommendation;
    onApply: (rec: StrategyRecommendation) => void;
    onIgnore: () => void;
}

const StrategyAdvisorWidget: React.FC<Props> = ({ recommendation, onApply, onIgnore }) => {
    if (!recommendation) return null;
    const { recommendedStrategy, confidence, reason, indicators, actionType } = recommendation;

    // Hide if low confidence and no switch needed
    if (actionType === 'KEEP' && confidence < 90) return null;

    const isUrgent = actionType === 'SWITCH';

    return (
        <div className={`fixed bottom-4 right-4 z-[90] w-80 bg-slate-900 border rounded-xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-300 ${isUrgent ? 'border-amber-500 shadow-amber-900/20' : 'border-slate-700'}`}>
            {/* Header */}
            <div className={`p-3 flex items-center justify-between ${isUrgent ? 'bg-amber-900/30' : 'bg-slate-950'}`}>
                <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-lg ${isUrgent ? 'bg-amber-500 text-black' : 'bg-slate-800 text-slate-400'}`}>
                        <Bot size={16} />
                    </div>
                    <div>
                        <h3 className={`text-xs font-bold ${isUrgent ? 'text-amber-400' : 'text-slate-200'}`}>
                            战术指挥官 (AI Advisor)
                        </h3>
                        <div className="text-[9px] text-slate-500 flex items-center gap-1">
                            <Activity size={8} /> {recommendation.symbol} 分析完成
                        </div>
                    </div>
                </div>
                <span className={`text-xs font-bold ${confidence > 80 ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {Math.round(confidence)}% 置信度
                </span>
            </div>

            {/* Content */}
            <div className="p-4 space-y-3 text-white">
                <div className="text-xs text-slate-300 leading-relaxed font-medium">
                    {reason}
                </div>
                {/* Indicators */}
                <div className="grid grid-cols-3 gap-2 text-[9px] text-slate-500">
                    <div className="bg-slate-950 p-1.5 rounded border border-slate-800">
                        <span className="block mb-0.5">ADX</span>
                        <span className={indicators.adx > 25 ? 'text-emerald-400 font-bold' : 'text-slate-400'}>{indicators.adx.toFixed(1)}</span>
                    </div>
                    <div className="bg-slate-950 p-1.5 rounded border border-slate-800">
                        <span className="block mb-0.5">RSI</span>
                        <span className={indicators.rsi > 70 || indicators.rsi < 30 ? 'text-orange-400 font-bold' : 'text-slate-400'}>{indicators.rsi.toFixed(1)}</span>
                    </div>
                    <div className="bg-slate-950 p-1.5 rounded border border-slate-800">
                        <span className="block mb-0.5">BBW</span>
                        <span className="text-blue-400 font-bold">{(indicators.bbWidth*100).toFixed(1)}%</span>
                    </div>
                </div>

                {/* Actions */}
                {actionType === 'SWITCH' ? (
                    <div className="flex gap-2 pt-1">
                        <button onClick={() => onApply(recommendation)} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded text-xs font-bold flex items-center justify-center gap-1">
                            <Zap size={12} fill="currentColor"/> 立即执行 ({recommendedStrategy})
                        </button>
                        <button onClick={onIgnore} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded text-xs">忽略</button>
                    </div>
                ) : (
                    <div className="bg-emerald-900/10 border border-emerald-500/20 p-2 rounded text-center text-[10px] text-emerald-400">
                        <CheckCircle size={10} className="inline mr-1" /> 当前策略与市场匹配
                    </div>
                )}
            </div>
        </div>
    );
};

export default StrategyAdvisorWidget;
