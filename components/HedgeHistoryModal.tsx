import React, { useMemo } from 'react';
import { HedgeRecord, TradeLog } from '../types';
import { X, ShieldAlert, Clock, Info, Trash2, TrendingDown, TrendingUp, Calculator } from 'lucide-react';

interface Props {
  symbol: string; // Can be a specific symbol or 'ALL'
  records: HedgeRecord[];
  tradeLogs: TradeLog[]; // Added for PnL calculation
  onClose: () => void;
  onClearHistory: (symbol: string) => void;
  onDeleteRecord: (id: string) => void;
}

const HedgeHistoryModal: React.FC<Props> = ({ symbol, records, tradeLogs, onClose, onClearHistory, onDeleteRecord }) => {
  const isAll = symbol === 'ALL';
  
  const symbolRecords = records
    .filter(r => isAll || r.symbol === symbol)
    .sort((a, b) => b.timestamp - a.timestamp);

  const handleSymbolClear = (sym: string) => {
      if(window.confirm(`⚠️ 确定要清空 ${sym} 的所有历史记录吗？`)) {
          onClearHistory(sym);
      }
  };

  // Calculate Cumulative PnL for this symbol from Trade Logs
  const pnlStats = useMemo(() => {
      if (isAll) return null;
      
      const closedLogs = tradeLogs.filter(t => t.symbol === symbol && t.status === 'CLOSED');
      const totalPnL = closedLogs.reduce((acc, curr) => acc + (curr.profit_usdt || 0), 0);
      const totalTrades = closedLogs.length;
      
      // Specifically look for stop loss or hedge exits to estimate "Loss" component
      const stopLossLogs = closedLogs.filter(t => 
          (t.exit_reason && t.exit_reason.includes('STOP')) || 
          (t.profit_usdt && t.profit_usdt < 0)
      );
      const totalLoss = stopLossLogs.reduce((acc, curr) => acc + (curr.profit_usdt || 0), 0);

      return { totalPnL, totalTrades, totalLoss, winCount: closedLogs.length - stopLossLogs.length, lossCount: stopLossLogs.length };
  }, [symbol, tradeLogs, isAll]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl w-full max-w-[95vw] h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950 rounded-t-lg shrink-0">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-blue-900/30 rounded-full text-blue-400 border border-blue-500/30">
                <ShieldAlert size={24} />
             </div>
             <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    防爆对冲记录
                    <span className="text-sm bg-slate-800 px-2 py-0.5 rounded text-slate-300 border border-slate-700 font-mono">
                        {isAll ? '所有币种 (ALL)' : symbol}
                    </span>
                </h2>
                <p className="text-xs text-slate-500">详细触发日志与操作流水</p>
             </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-white"
          >
            <X size={24} />
          </button>
        </div>

        {/* Summary Card (If single symbol) */}
        {!isAll && pnlStats && (
            <div className="p-4 bg-slate-800/50 border-b border-slate-700 grid grid-cols-1 md:grid-cols-4 gap-4 shrink-0">
                 <div className="bg-slate-900 p-3 rounded border border-slate-700 flex flex-col">
                     <span className="text-xs text-slate-500 mb-1">该币种累计已结盈亏</span>
                     <span className={`text-xl font-mono font-bold ${pnlStats.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                         {pnlStats.totalPnL > 0 ? '+' : ''}{pnlStats.totalPnL.toFixed(2)} U
                     </span>
                 </div>
                 <div className="bg-slate-900 p-3 rounded border border-slate-700 flex flex-col">
                     <span className="text-xs text-slate-500 mb-1">累计亏损/止损金额</span>
                     <span className="text-xl font-mono font-bold text-red-400">
                         {pnlStats.totalLoss.toFixed(2)} U
                     </span>
                 </div>
                 <div className="bg-slate-900 p-3 rounded border border-slate-700 flex flex-col">
                     <span className="text-xs text-slate-500 mb-1">总交易次数 (已平仓)</span>
                     <span className="text-xl font-mono font-bold text-white">
                         {pnlStats.totalTrades}
                     </span>
                 </div>
                 <div className="bg-slate-900 p-3 rounded border border-slate-700 flex flex-col">
                     <span className="text-xs text-slate-500 mb-1">胜/负场次</span>
                     <div className="flex gap-2">
                         <span className="text-emerald-400 font-bold">{pnlStats.winCount} 胜</span>
                         <span className="text-slate-600">/</span>
                         <span className="text-red-400 font-bold">{pnlStats.lossCount} 负</span>
                     </div>
                 </div>
            </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
            {symbolRecords.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-slate-500">
                    <Info size={40} className="mb-2 opacity-50"/>
                    <p>暂无触发防爆对冲的记录</p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-slate-400">
                        <thead className="text-xs uppercase bg-slate-800/50 text-slate-500 sticky top-0 backdrop-blur-md">
                            <tr>
                                <th className="px-4 py-3">时间</th>
                                {isAll && <th className="px-4 py-3">交易对</th>}
                                <th className="px-4 py-3">动作类型</th>
                                <th className="px-4 py-3">触发价格</th>
                                <th className="px-4 py-3">操作数量</th>
                                <th className="px-4 py-3">原单盈亏</th>
                                <th className="px-4 py-3">详情说明</th>
                                <th className="px-4 py-3 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {symbolRecords.map((record) => (
                                <tr key={record.id} className="hover:bg-slate-800/30 transition-colors group">
                                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-slate-300">
                                        <div className="flex items-center gap-1">
                                            <Clock size={12}/>
                                            {new Date(record.timestamp).toLocaleString()}
                                        </div>
                                    </td>
                                    {isAll && (
                                        <td className="px-4 py-3 font-bold text-slate-200">
                                            <div className="flex items-center gap-2">
                                                {record.symbol}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleSymbolClear(record.symbol);
                                                    }}
                                                    className="opacity-20 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded transition-all"
                                                    title={`清空 ${record.symbol} 的所有记录`}
                                                >
                                                    <Trash2 size={12}/>
                                                </button>
                                            </div>
                                        </td>
                                    )}
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-1 rounded text-xs font-bold border ${
                                            record.action === 'OPEN_HEDGE' ? 'bg-blue-900/20 text-blue-400 border-blue-500/30' :
                                            record.action === 'PATH_A_STOP' ? 'bg-red-900/20 text-red-400 border-red-500/30' :
                                            'bg-emerald-900/20 text-emerald-400 border-emerald-500/30'
                                        }`}>
                                            {record.action === 'OPEN_HEDGE' && '开启对冲'}
                                            {record.action === 'PATH_A_STOP' && '路径A止损'}
                                            {record.action === 'PATH_B_CLEAR' && '路径B清仓'}
                                            {record.action === 'CLOSE_HEDGE' && '关闭对冲'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 font-mono text-white">{record.triggerPrice.toFixed(4)}</td>
                                    <td className="px-4 py-3 font-mono">{record.hedgeAmount.toFixed(0)} U</td>
                                    <td className={`px-4 py-3 font-mono font-bold ${record.originalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {record.originalPnL > 0 ? '+' : ''}{record.originalPnL.toFixed(2)}%
                                    </td>
                                    <td className="px-4 py-3 text-xs text-slate-300 max-w-md truncate" title={record.detail}>
                                        {record.detail}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <button 
                                            onClick={() => onDeleteRecord(record.id)}
                                            className="p-1.5 text-slate-600 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors opacity-0 group-hover:opacity-100"
                                            title="删除此条记录"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900 rounded-b-lg flex justify-between items-center text-xs text-slate-500 shrink-0">
             <div className="flex gap-4">
                 <span>* 记录已自动保存。盈亏统计基于“交易日志”计算。</span>
                 {symbolRecords.length > 0 && (
                     <button 
                        onClick={() => onClearHistory(symbol)}
                        className="text-red-400 hover:text-red-300 hover:underline flex items-center gap-1 font-bold"
                     >
                        <Trash2 size={12}/>
                        {isAll ? '清空所有历史记录' : `清空 ${symbol} 记录`}
                     </button>
                 )}
             </div>
             <button onClick={onClose} className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded transition-colors">
                关闭窗口
             </button>
        </div>
      </div>
    </div>
  );
};

export default HedgeHistoryModal;
