import React from 'react';
import { motion } from 'motion/react';
import { PositionSide } from '../../../types';

interface Props {
    trades: any[];
}

export const TradeHistoryTable: React.FC<Props> = ({ trades }) => {
    return (
        <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden"
        >
            <div className="p-3 border-b border-slate-700 bg-slate-800/30 flex items-center justify-between">
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">交易历史 (Trade History)</h4>
                <span className="text-[9px] text-slate-500 font-mono">LATEST {trades.length} TRADES</span>
            </div>
            <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                <table className="w-full text-[10px] text-left border-collapse">
                    <thead className="sticky top-0 bg-slate-900 text-slate-500 font-mono uppercase tracking-tighter border-b border-slate-800">
                        <tr>
                            <th className="p-2">时间</th>
                            <th className="p-2">方向</th>
                            <th className="p-2">盈亏 %</th>
                            <th className="p-2">平仓原因</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                        {trades.slice().reverse().map((trade, i) => (
                            <tr key={i} className="hover:bg-slate-700/30 transition-colors">
                                <td className="p-2 text-slate-400 font-mono">{new Date(trade.exitTime).toLocaleString()}</td>
                                <td className={`p-2 font-bold ${trade.side === PositionSide.LONG ? 'text-emerald-500' : 'text-red-500'}`}>
                                    {trade.side === PositionSide.LONG ? 'LONG' : 'SHORT'}
                                </td>
                                <td className={`p-2 font-mono ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {trade.pnl >= 0 ? '+' : ''}{trade.pnlPercent.toFixed(2)}%
                                </td>
                                <td className="p-2 text-slate-500 italic truncate max-w-[150px]" title={trade.reason}>
                                    {trade.reason}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </motion.div>
    );
};
