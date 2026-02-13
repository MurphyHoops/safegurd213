import React, { useState, useMemo, useEffect } from 'react';
import { X, FileText, Activity, Code, Clock, ArrowRight, Search, TrendingUp, TrendingDown, AlertCircle, Calculator, Link, Shield, PieChart, BarChart2, History, Filter, RotateCcw, Zap, Layers, Banknote, List, LayoutGrid } from 'lucide-react';
import { TradeLog, SystemEvent, PositionSide, Position } from '../types';

interface Props {
  tradeLogs: TradeLog[];
  positions: Position[]; 
  systemEvents: SystemEvent[];
  onClose: () => void;
  initialSearch?: string; 
}

type FilterType = 'ALL' | 'OPEN' | 'WIN' | 'LOSS' | 'RECOVERY' | 'HEDGE' | 'MARTIN' | 'DEBT';

// Extracted FilterChip to prevent re-creation on every render
const FilterChip = ({ type, label, icon: Icon, colorClass, activeFilter, setActiveFilter, setSearchTerm }: any) => (
    <button 
        onClick={() => { setActiveFilter(type); setSearchTerm(''); }}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${
            activeFilter === type 
            ? `${colorClass} ring-1 ring-offset-1 ring-offset-slate-900 ring-current` 
            : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
        }`}
    >
        {Icon && <Icon size={12} />}
        {label}
    </button>
);

const TradeLogModal: React.FC<Props> = ({ tradeLogs, positions, systemEvents, onClose, initialSearch = '' }) => {
  const [selectedLog, setSelectedLog] = useState<TradeLog | null>(null); 
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [activeFilter, setActiveFilter] = useState<FilterType>('ALL');
  const [isGroupedView, setIsGroupedView] = useState(false); // Default to List View

  // Auto-switch to Grouped View for specific filters unless searching
  useEffect(() => {
      if (initialSearch) {
          setIsGroupedView(false);
          return;
      }
      if (['DEBT', 'RECOVERY'].includes(activeFilter)) {
          setIsGroupedView(true);
      } else {
          setIsGroupedView(false);
      }
  }, [activeFilter, initialSearch]);

  // --- 1. OVERVIEW STATISTICS (Strictly based on User Requirements) ---
  const overviewStats = useMemo(() => {
      // A. 盈利 (当前浮盈) - From Active Positions
      const currentFloatWin = positions.reduce((acc, p) => p.unrealizedPnL > 0 ? acc + p.unrealizedPnL : acc, 0);

      // B. 亏损 (当前浮亏) - From Active Positions
      const currentFloatLoss = positions.reduce((acc, p) => p.unrealizedPnL < 0 ? acc + p.unrealizedPnL : acc, 0);

      // C. 负债 (累计对冲止损) - Only Closed Hedge Losses
      // Definition: Realized losses from hedge positions
      const debtLogs = tradeLogs.filter(l => l.is_hedge && l.status === 'CLOSED' && (l.profit_usdt || 0) < 0);
      const totalDebt = debtLogs.reduce((acc, l) => acc + (l.profit_usdt || 0), 0);

      // D. 解套/回血 (累计对冲盈利) - Only Closed Hedge Profits
      // Definition: Realized profits from hedge positions
      const recoveryLogs = tradeLogs.filter(l => l.is_hedge && l.status === 'CLOSED' && (l.profit_usdt || 0) > 0);
      const totalRecovery = recoveryLogs.reduce((acc, l) => acc + (l.profit_usdt || 0), 0);

      // E. 防爆对冲 (正在进行中) - Count Positions
      const activeHedgeCount = positions.filter(p => p.isHedged).length;

      return {
          currentFloatWin,
          currentFloatLoss,
          totalDebt,
          totalRecovery,
          activeHedgeCount
      };
  }, [positions, tradeLogs]);


  // --- 2. FILTER LOGIC ---
  const filteredLogs = useMemo(() => {
      const term = searchTerm.toLowerCase();
      
      // 1. Base Filter (Search Text)
      let filtered = tradeLogs.filter(log => 
          log.symbol.toLowerCase().includes(term) ||
          log.entry_id.toLowerCase().includes(term)
      );

      // 2. Category Filter
      if (activeFilter !== 'ALL') {
          filtered = filtered.filter(log => {
              if (activeFilter === 'OPEN') return log.status === 'OPEN';
              if (activeFilter === 'WIN') return log.status === 'CLOSED' && (log.profit_usdt || 0) > 0;
              if (activeFilter === 'LOSS') return log.status === 'CLOSED' && (log.profit_usdt || 0) < 0;
              if (activeFilter === 'HEDGE') return log.is_hedge;
              
              // STRICT DEBT FILTER: Only Hedge Losses
              if (activeFilter === 'DEBT') {
                  return log.is_hedge && log.status === 'CLOSED' && (log.profit_usdt || 0) < 0;
              }

              // STRICT RECOVERY FILTER: Only Hedge Wins
              if (activeFilter === 'RECOVERY') {
                  return log.is_hedge && log.status === 'CLOSED' && (log.profit_usdt || 0) > 0;
              }

              if (activeFilter === 'MARTIN') {
                  const r = log.exit_reason || '';
                  const s = log.signal_details?.type || '';
                  return r.includes('MARTIN') || s.includes('MARTINGALE');
              }
              return true;
          });
      }
      return filtered;
  }, [tradeLogs, searchTerm, activeFilter]);

  // Grouped Data Calculation (Standard Logic)
  const groupedData = useMemo(() => {
      if (!isGroupedView) return [];

      const groups: Record<string, {
          symbol: string;
          count: number;
          totalPnL: number;
          winCount: number;
          lossCount: number;
          lastTime: number;
      }> = {};

      filteredLogs.forEach(log => {
          if (!groups[log.symbol]) {
              groups[log.symbol] = {
                  symbol: log.symbol,
                  count: 0,
                  totalPnL: 0,
                  winCount: 0,
                  lossCount: 0,
                  lastTime: 0
              };
          }
          const g = groups[log.symbol];
          g.count++;
          g.totalPnL += (log.profit_usdt || 0);
          if (log.status === 'CLOSED') {
             if ((log.profit_usdt || 0) > 0) g.winCount++;
             else g.lossCount++;
          }
          const time = log.exit_timestamp || log.entry_timestamp;
          if (time > g.lastTime) g.lastTime = time;
      });

      return Object.values(groups).sort((a, b) => {
          if (activeFilter === 'DEBT' || activeFilter === 'LOSS') return a.totalPnL - b.totalPnL; 
          return b.totalPnL - a.totalPnL; 
      });
  }, [filteredLogs, isGroupedView, activeFilter]);

  const renderJson = (data: any) => {
      return (
          <pre className="bg-slate-950 p-3 rounded border border-slate-700 text-[10px] font-mono text-emerald-300 overflow-x-auto">
              {JSON.stringify(data, null, 2)}
          </pre>
      );
  };

  const getDuration = (start: number, end?: number) => {
      if (!end) return '-';
      const ms = end - start;
      const sec = Math.floor(ms / 1000);
      if (sec < 60) return `${sec}s`;
      const min = Math.floor(sec / 60);
      if (min < 60) return `${min}m ${sec % 60}s`;
      const hr = Math.floor(min / 60);
      return `${hr}h ${min % 60}m`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex flex-col gap-4 p-4 border-b border-slate-800 bg-slate-950 rounded-t-lg">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-900/30 rounded-full text-indigo-400 border border-indigo-500/30">
                        <FileText size={20} />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-white">交易日志 (Trade Log)</h2>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span>共 {tradeLogs.length} 条记录</span>
                            <span className="text-slate-700">|</span>
                            <span>{activeFilter === 'DEBT' ? '只显示负债来源' : activeFilter === 'RECOVERY' ? '只显示回血来源' : '综合流水'}</span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <input 
                            type="text" 
                            placeholder="搜索币种/ID..." 
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="bg-slate-800 border border-slate-700 rounded-full pl-8 pr-4 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 w-48"
                        />
                        <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    </div>
                    {/* View Toggle */}
                    <div className="flex bg-slate-800 rounded-full p-0.5 border border-slate-700">
                        <button 
                            onClick={() => setIsGroupedView(false)}
                            className={`p-1.5 rounded-full transition-all ${!isGroupedView ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}
                            title="列表视图"
                        >
                            <List size={14} />
                        </button>
                        <button 
                            onClick={() => setIsGroupedView(true)}
                            className={`p-1.5 rounded-full transition-all ${isGroupedView ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                            title="币种分组视图"
                        >
                            <LayoutGrid size={14} />
                        </button>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white">
                        <X size={20} />
                    </button>
                </div>
            </div>

            {/* Filter Bar */}
            <div className="flex flex-wrap items-center gap-2">
                <FilterChip type="ALL" label="全部" icon={Layers} colorClass="bg-slate-700 text-white border-slate-500" activeFilter={activeFilter} setActiveFilter={setActiveFilter} setSearchTerm={setSearchTerm} />
                <FilterChip type="OPEN" label="持仓中" icon={Activity} colorClass="bg-cyan-900/40 text-cyan-400 border-cyan-500/30" activeFilter={activeFilter} setActiveFilter={setActiveFilter} setSearchTerm={setSearchTerm} />
                <FilterChip type="DEBT" label="负债 (对冲止损)" icon={Banknote} colorClass="bg-red-900/40 text-red-400 border-red-500/30" activeFilter={activeFilter} setActiveFilter={setActiveFilter} setSearchTerm={setSearchTerm} />
                <FilterChip type="RECOVERY" label="解套 (对冲盈利)" icon={RotateCcw} colorClass="bg-emerald-900/40 text-emerald-400 border-emerald-500/30" activeFilter={activeFilter} setActiveFilter={setActiveFilter} setSearchTerm={setSearchTerm} />
                <FilterChip type="HEDGE" label="对冲记录" icon={Shield} colorClass="bg-indigo-900/40 text-indigo-400 border-indigo-500/30" activeFilter={activeFilter} setActiveFilter={setActiveFilter} setSearchTerm={setSearchTerm} />
                <FilterChip type="MARTIN" label="马丁" icon={Zap} colorClass="bg-pink-900/40 text-pink-400 border-pink-500/30" activeFilter={activeFilter} setActiveFilter={setActiveFilter} setSearchTerm={setSearchTerm} />
            </div>

            {/* Stats Summary Bar */}
            <div className="flex items-center gap-6 px-4 py-3 bg-slate-900/50 rounded border border-slate-800 text-xs overflow-x-auto whitespace-nowrap scrollbar-hide">
                <div className="flex flex-col">
                    <span className="text-[10px] text-slate-500 font-bold uppercase">盈利 (当前浮盈)</span>
                    <span className="font-mono font-bold text-emerald-400 text-sm">+{overviewStats.currentFloatWin.toFixed(2)} U</span>
                </div>
                <div className="h-6 w-px bg-slate-800"></div>
                <div className="flex flex-col">
                    <span className="text-[10px] text-slate-500 font-bold uppercase">亏损 (当前浮亏)</span>
                    <span className="font-mono font-bold text-red-400 text-sm">{overviewStats.currentFloatLoss.toFixed(2)} U</span>
                </div>
                <div className="h-6 w-px bg-slate-800"></div>
                <div className="flex flex-col">
                    <span className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-1">
                        <Banknote size={10} /> 负债 (已结对冲亏损)
                    </span>
                    <span className="font-mono font-bold text-red-500 text-sm">{overviewStats.totalDebt.toFixed(2)} U</span>
                </div>
                <div className="h-6 w-px bg-slate-800"></div>
                <div className="flex flex-col">
                    <span className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-1">
                        <RotateCcw size={10} /> 解套/回血 (已结对冲盈利)
                    </span>
                    <span className="font-mono font-bold text-emerald-500 text-sm">+{overviewStats.totalRecovery.toFixed(2)} U</span>
                </div>
                <div className="h-6 w-px bg-slate-800"></div>
                <div className="flex flex-col">
                    <span className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-1">
                        <Shield size={10} /> 防爆对冲 (进行中)
                    </span>
                    <span className={`font-mono font-bold text-sm ${overviewStats.activeHedgeCount > 0 ? 'text-indigo-400 animate-pulse' : 'text-slate-400'}`}>
                        {overviewStats.activeHedgeCount} 对
                    </span>
                </div>
            </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
            {isGroupedView ? (
                 <div className="flex-1 overflow-y-auto">
                    <table className="w-full text-left text-sm text-slate-400">
                        <thead className="text-xs uppercase bg-slate-800/50 text-slate-500 sticky top-0 backdrop-blur-md z-10">
                            <tr>
                                <th className="px-4 py-3">#</th>
                                <th className="px-4 py-3">币种 (Symbol)</th>
                                <th className="px-4 py-3 text-center">
                                    {activeFilter === 'DEBT' ? '止损次数' : '交易次数'}
                                </th>
                                <th className="px-4 py-3 text-right">
                                    {activeFilter === 'DEBT' ? '负债总额 (U)' : activeFilter === 'RECOVERY' ? '回血总额 (U)' : '累计盈亏 (U)'}
                                </th>
                                <th className="px-4 py-3 text-right">最近交易时间</th>
                                <th className="px-4 py-3 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {groupedData.length === 0 && (
                                <tr><td colSpan={6} className="text-center py-10 text-slate-600">无数据</td></tr>
                            )}
                            {groupedData.map((group, idx) => (
                                <tr key={group.symbol} className="hover:bg-slate-800/30 transition-colors">
                                    <td className="px-4 py-3 text-xs font-mono text-slate-600">{idx + 1}</td>
                                    <td className="px-4 py-3 font-bold text-slate-200">
                                        <div className="flex items-center gap-2">
                                            {group.symbol}
                                            {activeFilter === 'DEBT' && <Banknote size={12} className="text-red-400"/>}
                                            {activeFilter === 'RECOVERY' && <RotateCcw size={12} className="text-emerald-400"/>}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <span className="bg-slate-800 px-2 py-0.5 rounded text-xs font-mono text-white border border-slate-700">
                                            {group.count} 次
                                        </span>
                                    </td>
                                    <td className={`px-4 py-3 text-right font-mono font-bold text-base ${group.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {group.totalPnL > 0 ? '+' : ''}{group.totalPnL.toFixed(2)} U
                                    </td>
                                    <td className="px-4 py-3 text-right text-xs text-slate-500 font-mono">
                                        {new Date(group.lastTime).toLocaleString()}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <button 
                                            onClick={() => {
                                                setSearchTerm(group.symbol);
                                                setIsGroupedView(false);
                                            }}
                                            className="p-1.5 bg-slate-800 hover:bg-indigo-600 text-slate-400 hover:text-white rounded transition-colors inline-flex items-center gap-1"
                                            title="查看流水"
                                        >
                                            <Clock size={14} />
                                            <span className="text-[10px] font-bold">查看流水</span>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                 </div>
            ) : (
                <div className={`flex-1 overflow-y-auto ${selectedLog ? 'w-2/3 border-r border-slate-800 hidden md:block' : 'w-full'}`}>
                    <table className="w-full text-left text-sm text-slate-400">
                        <thead className="text-xs uppercase bg-slate-800/50 text-slate-500 sticky top-0 backdrop-blur-md z-10">
                            <tr>
                                <th className="px-4 py-3">交易时间 / 类型</th>
                                <th className="px-4 py-3">交易对</th>
                                <th className="px-4 py-3">方向/杠杆</th>
                                <th className="px-4 py-3">开仓价值 (U)</th>
                                <th className="px-4 py-3">开仓价</th>
                                <th className="px-4 py-3">实时价/平仓价</th>
                                <th className="px-4 py-3">盈亏(U) / ROE%</th>
                                <th className="px-4 py-3">状态/原因</th>
                                <th className="px-4 py-3 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {filteredLogs.map((log, idx) => {
                                const isSafeClear = log.exit_reason?.includes('SAFE_CLR');
                                const prevLog = filteredLogs[idx - 1];
                                const nextLog = filteredLogs[idx + 1];
                                const isGrouped = isSafeClear && (
                                    (prevLog?.entry_id === log.entry_id) || 
                                    (nextLog?.entry_id === log.entry_id)
                                );
                                const uniqueKey = `${log.entry_id}-${log.status}-${log.exit_timestamp || log.entry_timestamp}`;
                                
                                const activePos = positions.find(p => p.entryId === log.entry_id);
                                const currentPrice = activePos ? activePos.markPrice : (log.exit_price || 0);
                                const realizedPnL = log.profit_usdt || 0;
                                const realizedPnLPct = log.profit_percent || 0;

                                return (
                                    <tr key={uniqueKey} className={`transition-colors ${selectedLog === log ? 'bg-indigo-900/30' : 'hover:bg-slate-800/30'} ${isGrouped ? 'bg-indigo-900/10' : ''} ${log.is_hedge ? 'bg-blue-900/10' : ''}`}>
                                        <td className="px-4 py-3 text-xs whitespace-nowrap text-slate-300 relative">
                                            {isGrouped && <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500/50"></div>}
                                            {log.is_hedge && <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500/50"></div>}
                                            {log.status === 'CLOSED' ? (
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-red-300">{new Date(log.exit_timestamp || Date.now()).toLocaleString()}</span>
                                                    <div className="flex items-center gap-1.5 mt-0.5">
                                                        <span className="text-[9px] bg-red-900/40 text-red-400 px-1 rounded border border-red-500/20 font-bold">CLOSE</span>
                                                        <span className="text-[9px] text-slate-500">持仓: {getDuration(log.entry_timestamp, log.exit_timestamp)}</span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-emerald-300">{new Date(log.entry_timestamp).toLocaleString()}</span>
                                                    <div className="flex items-center gap-1.5 mt-0.5">
                                                        <span className="text-[9px] bg-emerald-900/40 text-emerald-400 px-1 rounded border border-emerald-500/20 font-bold">OPEN</span>
                                                    </div>
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 font-bold text-slate-200">
                                            <div className="flex items-center gap-2">
                                                <span>{log.symbol}</span>
                                                <button onClick={(e) => { e.stopPropagation(); setSearchTerm(log.symbol); setActiveFilter('ALL'); setIsGroupedView(false); }} className="p-1 hover:bg-slate-700 rounded text-slate-500 hover:text-blue-400 transition-all"><History size={12} /></button>
                                            </div>
                                            <div className="text-[10px] text-slate-500 font-mono font-normal">{log.entry_id.slice(-6)}</div>
                                        </td>
                                        <td className={`px-4 py-3 text-xs ${log.direction === PositionSide.LONG ? 'text-emerald-400' : 'text-red-400'}`}>
                                            <div className="flex items-center gap-1">
                                                {log.direction}
                                                <span className="text-[9px] text-slate-500 border border-slate-700 px-0.5 rounded">{log.leverage || 20}x</span>
                                            </div>
                                            {log.is_hedge && <span className="inline-flex items-center gap-0.5 mt-1 px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400 border border-blue-500/30 text-[9px] font-bold"><Shield size={8} /> 🛡️对冲</span>}
                                        </td>
                                        <td className="px-4 py-3 text-xs font-mono">
                                            <div className="font-bold text-slate-200">{log.cost_usdt.toFixed(2)} U</div>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-xs">{log.entry_price.toFixed(8)}</td>
                                        <td className="px-4 py-3 font-mono text-xs text-slate-300">{currentPrice > 0 ? currentPrice.toFixed(8) : '-'}</td>
                                        <td className={`px-4 py-3 font-mono font-bold ${log.status === 'CLOSED' ? (realizedPnL > 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-500'}`}>
                                            {log.status === 'CLOSED' ? (
                                                <>
                                                    <div>{realizedPnL > 0 ? '+' : ''}{realizedPnL.toFixed(2)}</div>
                                                    <div className={`text-[10px] font-normal ${realizedPnLPct > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{realizedPnLPct > 0 ? '+' : ''}{realizedPnLPct.toFixed(2)}%</div>
                                                </>
                                            ) : <span className="text-slate-600">-</span>}
                                        </td>
                                        <td className="px-4 py-3 text-xs">
                                            {log.status === 'OPEN' ? <span className="bg-emerald-900/20 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20">开仓 (OPEN)</span> : (
                                                <div className="flex items-center gap-1">
                                                    {isGrouped && <Link size={10} className="text-indigo-400" />}
                                                    <span className="text-slate-300 bg-slate-800/50 px-1.5 py-0.5 rounded border border-slate-700/50" title={log.exit_reason}>{log.exit_reason ? (log.exit_reason.length > 15 ? log.exit_reason.substring(0, 15) + '...' : log.exit_reason) : '-'}</span>
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <button onClick={() => setSelectedLog(log)} className="text-indigo-400 hover:text-indigo-300 text-xs flex items-center gap-1 justify-end w-full">详情 <ArrowRight size={12}/></button>
                                        </td>
                                    </tr>
                                );
                            })}
                            {filteredLogs.length === 0 && <tr><td colSpan={9} className="text-center py-10 text-slate-600">没有符合筛选条件的记录</td></tr>}
                        </tbody>
                    </table>
                </div>
            )}
            
            {/* Details Panel */}
            {selectedLog && !isGroupedView && (
                <div className="w-full md:w-1/3 bg-slate-900 p-4 border-l border-slate-800 overflow-y-auto absolute md:static inset-0 z-20 md:z-auto flex flex-col">
                    <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-2 flex-shrink-0">
                        <h3 className="font-bold text-white flex items-center gap-2"><Activity size={16} className="text-indigo-400"/>交易详情分析</h3>
                        <button onClick={() => setSelectedLog(null)} className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"><X size={16}/></button>
                    </div>
                    <div className="space-y-4 text-sm flex-1 overflow-y-auto pr-1">
                        <div className="grid grid-cols-2 gap-4 bg-slate-800/30 p-2 rounded border border-slate-700">
                            <div><span className="text-xs text-slate-500 block mb-1">开仓时间</span><p className="font-mono text-slate-300 text-xs">{new Date(selectedLog.entry_timestamp).toLocaleString()}</p></div>
                            <div><span className="text-xs text-slate-500 block mb-1">平仓时间</span><p className="font-mono text-slate-300 text-xs">{selectedLog.exit_timestamp ? new Date(selectedLog.exit_timestamp).toLocaleString() : '持仓中 (Active)'}</p></div>
                        </div>
                        <div><span className="text-xs text-slate-500 uppercase">交易 ID</span><p className="font-mono text-slate-400 text-xs break-all">{selectedLog.entry_id}</p></div>
                        <div className="grid grid-cols-2 gap-4">
                            <div><span className="text-xs text-slate-500">币种</span><p className="font-bold text-white text-lg flex items-center gap-2">{selectedLog.symbol}{selectedLog.is_hedge && <span className="text-[10px] text-blue-400 border border-blue-500/30 px-1 rounded">HEDGE</span>}</p></div>
                            <div><span className="text-xs text-slate-500">方向</span><div className={`flex items-center gap-1 font-bold ${selectedLog.direction === PositionSide.LONG ? 'text-emerald-400' : 'text-red-400'}`}>{selectedLog.direction === PositionSide.LONG ? <TrendingUp size={16}/> : <TrendingDown size={16}/>}{selectedLog.direction === PositionSide.LONG ? '多' : '空'}</div></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 bg-slate-800/50 p-2 rounded">
                             <div><span className="text-xs text-slate-500">开仓均价</span><p className="font-mono text-white">{selectedLog.entry_price.toFixed(8)}</p></div>
                             <div><span className="text-xs text-slate-500">平仓价</span><p className="font-mono text-white">{selectedLog.exit_price?.toFixed(8) || '-'}</p></div>
                        </div>
                        <div><span className="text-xs text-slate-500 uppercase block mb-1">原始数据</span>{renderJson(selectedLog)}</div>
                    </div>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default TradeLogModal;