import React from 'react';
import { Loader2, AlertCircle, Cpu } from 'lucide-react';
import { TradeDNA } from '../../types';

interface Props {
    isLoading: boolean;
    dnaList: TradeDNA[];
}

export const TradeDnaList: React.FC<Props> = ({ isLoading, dnaList }) => {
    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
                <Loader2 className="animate-spin text-purple-500" size={32} />
                <p className="text-xs text-slate-500">正在从云端调取 Trade DNA 数据...</p>
            </div>
        );
    }

    if (dnaList.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-4 opacity-50">
                <AlertCircle size={48} className="text-slate-600" />
                <p className="text-sm text-slate-500">暂无 Trade DNA 数据，请先进行交易。</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 gap-3">
            {dnaList.map((dna) => (
                <div key={dna.id} className="bg-slate-900/50 border border-slate-800 rounded-lg p-3 hover:border-purple-500/30 transition-all group">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${dna.side === 'LONG' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                                {dna.side}
                            </span>
                            <span className="text-sm font-bold text-white">{dna.symbol}</span>
                            <span className="text-[10px] text-slate-500">{new Date(dna.exitTime).toLocaleString()}</span>
                        </div>
                        <div className={`text-sm font-bold ${dna.profitUsdt >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {dna.profitUsdt >= 0 ? '+' : ''}{dna.profitUsdt.toFixed(2)} USDT ({dna.profitPercent.toFixed(2)}%)
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        <div className="space-y-1">
                            <span className="text-[9px] text-slate-500 uppercase">RSI (Entry)</span>
                            <div className="text-xs text-slate-300 font-mono">{dna.indicators.rsi.toFixed(1)}</div>
                        </div>
                        <div className="space-y-1">
                            <span className="text-[9px] text-slate-500 uppercase">波动率</span>
                            <div className="text-xs text-slate-300 font-mono">{dna.indicators.volatility.toFixed(2)}%</div>
                        </div>
                        <div className="space-y-1">
                            <span className="text-[9px] text-slate-500 uppercase">乖离率</span>
                            <div className="text-xs text-slate-300 font-mono">{dna.indicators.deviation.toFixed(2)}%</div>
                        </div>
                        <div className="space-y-1">
                            <span className="text-[9px] text-slate-500 uppercase">EMA 距离</span>
                            <div className="text-xs text-slate-300 font-mono">{dna.indicators.emaDistance.toFixed(2)}%</div>
                        </div>
                        <div className="space-y-1">
                            <span className="text-[9px] text-slate-500 uppercase">AI 灵敏/贪婪</span>
                            <div className="text-xs text-purple-400 font-mono">{dna.aiSettings.sensitivity} / {dna.aiSettings.aggressiveness}</div>
                        </div>
                    </div>

                    <div className="mt-3 pt-3 border-t border-slate-800/50 flex items-center justify-between">
                        <div className="text-[10px] text-slate-500">
                            平仓原因: <span className="text-slate-300">{dna.exitReason}</span>
                        </div>
                        <button className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1">
                            <Cpu size={10} />
                            AI 优化建议
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
};
