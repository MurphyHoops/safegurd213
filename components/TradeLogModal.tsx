import React, { useState, useMemo, useEffect } from 'react';
import { X, FileText, Activity, Code, Clock, ArrowRight, ArrowLeft, Search, TrendingUp, TrendingDown, AlertCircle, Calculator, Link, Shield, PieChart, BarChart2, History, Filter, RotateCcw, Layers, Banknote, List, LayoutGrid, Trash2 } from 'lucide-react';
import { TradeLog, SystemEvent, PositionSide, Position } from '../types';

interface Props {
  tradeLogs: TradeLog[];
  positions: Position[]; 
  systemEvents: SystemEvent[];
  onClose: () => void;
  initialSearch?: string; 
  onClearHistory?: () => void;
  onOpenChart?: (symbol: string, entryPrice?: number, entryTime?: number, timeframe?: string) => void;
}

type FilterType = 'ALL' | 'OPEN' | 'WIN' | 'LOSS' | 'RECOVERY' | 'HEDGE' | 'DEBT' | 'NORMAL_WIN' | 'NORMAL_LOSS' | 'UNHEDGED_WIN' | 'UNHEDGED_LOSS' | 'LONG' | 'SHORT' | 'NEW_OPEN';

// Extracted FilterChip to prevent re-creation on every render
const FilterChip = ({ type, label, icon: Icon, colorClass, activeFilter, handleFilterChange }: any) => (
    <button 
        onClick={() => handleFilterChange(type)}
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

const TradeLogModal: React.FC<Props> = ({ tradeLogs, positions, systemEvents, onClose, initialSearch = '', onClearHistory, onOpenChart }) => {
  const [selectedLog, setSelectedLog] = useState<TradeLog | null>(null); 
  const [selectedRecoveryId, setSelectedRecoveryId] = useState<string | null>(null);
  const [selectedDebtId, setSelectedDebtId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [activeFilter, setActiveFilter] = useState<FilterType>('ALL');
  const [isGroupedView, setIsGroupedView] = useState(false); // Default to List View
  const [groupSortConfig, setGroupSortConfig] = useState<{ key: 'TIME' | 'AMOUNT', direction: 'DESC' | 'ASC' }>({ key: 'TIME', direction: 'DESC' });
  const [listSortConfig, setListSortConfig] = useState<{ key: 'TIME' | 'AMOUNT', direction: 'DESC' | 'ASC' }>({ key: 'TIME', direction: 'DESC' });
  
  // Time Range States
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');

  // Removed auto-switch to Grouped View to restore individual log display as requested
  const handleFilterChange = (newFilter: FilterType) => {
      setActiveFilter(newFilter);
      setSelectedRecoveryId(null);
      setSelectedDebtId(null);
  };

  const handleSearchChange = (val: string) => {
      setSearchTerm(val);
      if (!val && (activeFilter === 'LONG' || activeFilter === 'SHORT')) {
          handleFilterChange('ALL');
      }
  };

  useEffect(() => {
      if (initialSearch) {
          setIsGroupedView(false);
      }
  }, [initialSearch]);

  // --- 0. SHARED STATS & IDENTIFIERS ---
  const { everHedgedIds, recoveryStats, activeHedgeStats } = useMemo(() => {
      const ids = new Set<string>();
      const startMs = startTime ? new Date(startTime).getTime() : 0;
      const endMs = endTime ? new Date(endTime).getTime() : Infinity;
      
      const filteredTradeLogs = tradeLogs.filter(l => {
          const logTime = l.exit_timestamp || l.entry_timestamp;
          return logTime >= startMs && logTime <= endMs;
      });

      const filteredPositions = positions.filter(p => {
          return p.entryTime >= startMs && p.entryTime <= endMs;
      });

      // Pass 1: Direct links from logs
      filteredTradeLogs.forEach(l => {
          if (l.main_entry_id) {
              ids.add(l.main_entry_id);
              ids.add(l.entry_id);
          }
          if (l.parent_entry_id) {
              ids.add(l.parent_entry_id);
              ids.add(l.entry_id);
          }
          if (l.is_hedge) {
              ids.add(l.entry_id);
          }
      });

      // Pass 2: Direct links from active positions
      filteredPositions.forEach(p => {
          if (p.mainPositionId) {
              ids.add(p.mainPositionId);
              ids.add(p.entryId);
          }
          if (p.isHedged) {
              ids.add(p.entryId);
          }
      });

      // Pass 3: Recursive expansion (catch chains like A -> B -> C)
      for (let i = 0; i < 10; i++) { // Increased passes for deeper chains
          let added = false;
          filteredTradeLogs.forEach(l => {
              if (l.main_entry_id && (ids.has(l.main_entry_id) || ids.has(l.entry_id))) {
                  if (!ids.has(l.main_entry_id) || !ids.has(l.entry_id)) {
                      ids.add(l.main_entry_id);
                      ids.add(l.entry_id);
                      added = true;
                  }
              }
              if (l.parent_entry_id && (ids.has(l.parent_entry_id) || ids.has(l.entry_id))) {
                  if (!ids.has(l.parent_entry_id) || !ids.has(l.entry_id)) {
                      ids.add(l.parent_entry_id);
                      ids.add(l.entry_id);
                      added = true;
                  }
              }
          });
          filteredPositions.forEach(p => {
              if (p.mainPositionId && (ids.has(p.mainPositionId) || ids.has(p.entryId))) {
                  if (!ids.has(p.mainPositionId) || !ids.has(p.entryId)) {
                      ids.add(p.mainPositionId);
                      ids.add(p.entryId);
                      added = true;
                  }
              }
          });
          if (!added) break;
      }

      // 1. Group all logs and positions by symbol
      const logsBySymbol = new Map<string, TradeLog[]>();
      filteredTradeLogs.forEach(l => {
          const list = logsBySymbol.get(l.symbol) || [];
          list.push(l);
          logsBySymbol.set(l.symbol, list);
      });

      const positionsBySymbol = new Map<string, Position[]>();
      filteredPositions.forEach(p => {
          const list = positionsBySymbol.get(p.symbol) || [];
          list.push(p);
          positionsBySymbol.set(p.symbol, list);
      });

      const rSummaries: any[] = [];
      const rStats = new Map<string, { netProfit: number, grossProfit: number, totalLoss: number, hedgeCount: number, lastStopLossTime: number }>();
      const rRelatedIdsMap = new Map<string, Set<string>>();
      let rTotal = 0;

      const aSummaries: any[] = [];
      const aStats = new Map<string, { totalLoss: number, hedgeCount: number, lastStopLossTime: number, lastStopLossRule: string }>();
      const aRelatedIdsMap = new Map<string, Set<string>>();
      let aTotalLoss = 0;

      logsBySymbol.forEach((symbolLogs, symbol) => {
          const symbolPositions = positionsBySymbol.get(symbol) || [];
          
          // Identify all IDs for this symbol that are involved in hedging
          const symbolHedgedIds = new Set<string>();
          symbolLogs.forEach(l => {
              if (ids.has(l.entry_id)) symbolHedgedIds.add(l.entry_id);
          });
          symbolPositions.forEach(p => {
              if (ids.has(p.entryId)) symbolHedgedIds.add(p.entryId);
          });

          if (symbolHedgedIds.size === 0) return;

          // Group into disjoint cycles
          const cycles: Set<string>[] = [];
          const processedIds = new Set<string>();

          symbolHedgedIds.forEach(id => {
              if (processedIds.has(id)) return;

              const currentCycle = new Set<string>([id]);
              let added = true;
              while (added) {
                  added = false;
                  symbolLogs.forEach(l => {
                      if (currentCycle.has(l.entry_id)) {
                          if (l.main_entry_id && !currentCycle.has(l.main_entry_id)) { currentCycle.add(l.main_entry_id); added = true; }
                          if (l.parent_entry_id && !currentCycle.has(l.parent_entry_id)) { currentCycle.add(l.parent_entry_id); added = true; }
                      } else {
                          if (l.main_entry_id && currentCycle.has(l.main_entry_id)) { currentCycle.add(l.entry_id); added = true; }
                          if (l.parent_entry_id && currentCycle.has(l.parent_entry_id)) { currentCycle.add(l.entry_id); added = true; }
                      }
                  });
                  symbolPositions.forEach(p => {
                      if (currentCycle.has(p.entryId)) {
                          if (p.mainPositionId && !currentCycle.has(p.mainPositionId)) { currentCycle.add(p.mainPositionId); added = true; }
                      } else {
                          if (p.mainPositionId && currentCycle.has(p.mainPositionId)) { currentCycle.add(p.entryId); added = true; }
                      }
                  });
              }
              
              currentCycle.forEach(cid => processedIds.add(cid));
              cycles.push(currentCycle);
          });

          let symbolHedgeCount = 0;
          let symbolGrossTotal = 0;
          let symbolLossTotal = 0;
          let symbolNetTotal = 0;
          let symbolHedgeTotalCount = 0;
          let symbolCycleLastStopLossTime = 0;
          const allSymbolRelatedIds = new Set<string>();

          cycles.forEach(cycleIds => {
              const cycleLogs = symbolLogs.filter(l => cycleIds.has(l.entry_id));
              const cyclePositions = symbolPositions.filter(p => cycleIds.has(p.entryId));
              
              // Check if cycle is completed (no active positions)
              const hasOpen = cyclePositions.length > 0;
              
              if (!hasOpen) {
                  let cycleGrossProfit = 0;
                  let cycleTotalLoss = 0;
                  let cycleStopLossCount = 0;
                  let cycleHasClosedHedge = false;
                  let cycleHasMainEntry = false;
                  let cycleLastStopLossTime = 0;
                  const cycleRelatedIds = new Set<string>();

                  cycleLogs.forEach(l => {
                      if (l.status !== 'CLOSED') return;
                      cycleRelatedIds.add(l.entry_id);
                      allSymbolRelatedIds.add(l.entry_id);

                      const p = Number(l.profit_usdt || 0);
                      if (p > 0) cycleGrossProfit += p;
                      else if (p < 0) {
                          cycleTotalLoss += Math.abs(p);
                          if (l.exit_timestamp && l.exit_timestamp > cycleLastStopLossTime) {
                              cycleLastStopLossTime = l.exit_timestamp;
                          }
                          if (l.is_hedge) {
                              cycleStopLossCount++;
                          }
                      }
                      
                      if (l.is_hedge) {
                          cycleHasClosedHedge = true;
                      }
                      if (!l.main_entry_id) {
                          cycleHasMainEntry = true;
                      }
                  });

                  // Only count if it was actually a hedge cycle (at least one hedge or one main position with hedges)
                  if (cycleHasClosedHedge || (cycleHasMainEntry && cycleLogs.some(l => !!l.main_entry_id))) {
                      const cycleNetProfit = cycleGrossProfit - cycleTotalLoss;
                      
                      // Find best representative log for this cycle
                      let repLog = cycleLogs.find(l => !l.main_entry_id && !l.parent_entry_id && l.status === 'CLOSED') || 
                                   cycleLogs.sort((a,b) => (b.exit_timestamp || 0) - (a.exit_timestamp || 0))[0];

                      rSummaries.push({
                          mainLog: repLog,
                          grossProfit: cycleGrossProfit,
                          totalLoss: cycleTotalLoss,
                          netProfit: cycleNetProfit,
                          hedgeCount: cycleStopLossCount,
                          lastStopLossTime: cycleLastStopLossTime,
                          relatedIds: cycleRelatedIds
                      });

                      symbolGrossTotal += cycleGrossProfit;
                      symbolLossTotal += cycleTotalLoss;
                      symbolNetTotal += cycleNetProfit;
                      symbolHedgeTotalCount += cycleStopLossCount;
                      if (cycleLastStopLossTime > symbolCycleLastStopLossTime) {
                          symbolCycleLastStopLossTime = cycleLastStopLossTime;
                      }
                  }
              } else {
                  // Active hedge cycle logic
                  let cycleTotalLoss = 0;
                  let cycleStopLossCount = 0;
                  let cycleHasHedge = false;
                  let cycleHasMainEntry = false;
                  let cycleLastStopLossTime = 0;
                  let cycleLastStopLossRule = '';
                  const cycleRelatedIds = new Set<string>();

                  cycleLogs.forEach(l => {
                      if (l.status === 'CLOSED' && (l.profit_usdt || 0) < 0) {
                          cycleTotalLoss += Math.abs(l.profit_usdt || 0);
                          if (l.is_hedge) {
                              cycleStopLossCount++;
                          }
                          if (l.exit_timestamp && l.exit_timestamp > cycleLastStopLossTime) {
                              cycleLastStopLossTime = l.exit_timestamp;
                              cycleLastStopLossRule = l.exit_reason || l.stop_loss_rule || '';
                          }
                      }
                      if (l.is_hedge) {
                          cycleHasHedge = true;
                      }
                      if (!l.main_entry_id) {
                          cycleHasMainEntry = true;
                      }
                      cycleRelatedIds.add(l.entry_id);
                  });

                  // Only count if it's actually an active hedge cycle
                  if (cycleHasHedge || (cycleHasMainEntry && cycleLogs.some(l => !!l.main_entry_id)) || cyclePositions.some(p => p.isHedged)) {
                      // Find a representative log
                      let repLog = cycleLogs.find(l => !l.main_entry_id && !l.parent_entry_id) || cycleLogs[0];
                      
                      if (repLog) {
                          aSummaries.push({
                              mainLog: repLog,
                              totalLoss: cycleTotalLoss,
                              hedgeCount: cycleStopLossCount,
                              lastStopLossTime: cycleLastStopLossTime,
                              lastStopLossRule: cycleLastStopLossRule,
                              relatedIds: cycleRelatedIds
                          });
                          
                          const existing = aStats.get(symbol) || { totalLoss: 0, hedgeCount: 0, lastStopLossTime: 0, lastStopLossRule: '' };
                          existing.totalLoss += cycleTotalLoss;
                          existing.hedgeCount += cycleStopLossCount;
                          if (cycleLastStopLossTime > existing.lastStopLossTime) {
                              existing.lastStopLossTime = cycleLastStopLossTime;
                              existing.lastStopLossRule = cycleLastStopLossRule;
                          }
                          aStats.set(symbol, existing);
                          
                          const existingIds = aRelatedIdsMap.get(symbol) || new Set<string>();
                          cycleRelatedIds.forEach(id => existingIds.add(id));
                          aRelatedIdsMap.set(symbol, existingIds);
                          
                          aTotalLoss += cycleTotalLoss;
                      }
                  }
              }
          });

          if (allSymbolRelatedIds.size > 0) {
              rStats.set(symbol, {
                  netProfit: symbolNetTotal,
                  grossProfit: symbolGrossTotal,
                  totalLoss: symbolLossTotal,
                  hedgeCount: symbolHedgeTotalCount,
                  lastStopLossTime: symbolCycleLastStopLossTime
              });
              rRelatedIdsMap.set(symbol, allSymbolRelatedIds);
              rTotal += symbolNetTotal;
          }
      });
      
      return { 
          everHedgedIds: ids, 
          recoveryStats: { map: rStats, total: rTotal, summaries: rSummaries, relatedIdsMap: rRelatedIdsMap },
          activeHedgeStats: { map: aStats, totalLoss: aTotalLoss, summaries: aSummaries, relatedIdsMap: aRelatedIdsMap }
      };
  }, [tradeLogs, positions, startTime, endTime]);

  // --- 1. OVERVIEW STATISTICS (Strictly based on User Requirements) ---
  const overviewStats = useMemo(() => {
      const startMs = startTime ? new Date(startTime).getTime() : 0;
      const endMs = endTime ? new Date(endTime).getTime() : Infinity;

      const filteredTradeLogs = tradeLogs.filter(l => {
          const logTime = l.exit_timestamp || l.entry_timestamp;
          return logTime >= startMs && logTime <= endMs;
      });

      const filteredPositions = positions.filter(p => {
          return p.entryTime >= startMs && p.entryTime <= endMs;
      });

      // A. 未对冲盈利 (Unhedged Profit) - Active, never hedged, PnL > 0
      const unhedgedWinPositions = filteredPositions.filter(p => !p.isHedged && p.unrealizedPnL > 0 && !everHedgedIds.has(p.entryId));
      const totalUnhedgedWin = unhedgedWinPositions.reduce((acc, p) => acc + p.unrealizedPnL, 0);

      // B. 未对冲亏损 (Unhedged Loss) - Active, never hedged, PnL < 0
      const unhedgedLossPositions = filteredPositions.filter(p => !p.isHedged && p.unrealizedPnL < 0 && !everHedgedIds.has(p.entryId));
      const totalUnhedgedLoss = unhedgedLossPositions.reduce((acc, p) => acc + p.unrealizedPnL, 0);

      // C. 常规止盈 (Regular Take Profit) - Closed, never hedged, Profit > 0
      const normalWinLogs = filteredTradeLogs.filter(l => {
          const isHedged = everHedgedIds.has(l.entry_id) || (l.parent_entry_id && everHedgedIds.has(l.parent_entry_id));
          return l.status === 'CLOSED' && !l.main_entry_id && (l.profit_usdt || 0) > 0 && !isHedged;
      });
      const totalNormalWin = normalWinLogs.reduce((acc, l) => acc + (l.profit_usdt || 0), 0);

      // C2. 常规止损 (Regular Stop Loss) - Closed, never hedged, Profit < 0
      const normalLossLogs = filteredTradeLogs.filter(l => {
          const isHedged = everHedgedIds.has(l.entry_id) || (l.parent_entry_id && everHedgedIds.has(l.parent_entry_id));
          return l.status === 'CLOSED' && !l.main_entry_id && (l.profit_usdt || 0) < 0 && !isHedged;
      });
      const totalNormalLoss = normalLossLogs.reduce((acc, l) => acc + (l.profit_usdt || 0), 0);

      // G. 当前盈亏 (Current PnL) - All active positions
      const totalCurrentPnL = filteredPositions.reduce((acc, p) => acc + p.unrealizedPnL, 0);

      // D. 负债对冲止损 (Debt Hedging Stop Loss) - Only losses from ACTIVE hedge cycles
      const totalDebt = activeHedgeStats.totalLoss;
      const debtCount = activeHedgeStats.summaries.reduce((acc, s) => acc + s.hedgeCount, 0);
      const totalRecovery = recoveryStats.total;

      // F. 对冲中 (Hedging In Progress)
      const activeHedgePairs = filteredPositions.filter(p => p.isHedged && !p.mainPositionId);
      const inProgressHedgeStats = activeHedgePairs.reduce((acc, mainPos) => {
          const hedgePos = filteredPositions.find(p => p.mainPositionId === mainPos.entryId);
          
          let pairProfit = 0;
          let pairLoss = 0;
          
          if (mainPos.unrealizedPnL > 0) pairProfit += mainPos.unrealizedPnL;
          else pairLoss += Math.abs(mainPos.unrealizedPnL);
          
          if (hedgePos) {
              if (hedgePos.unrealizedPnL > 0) pairProfit += hedgePos.unrealizedPnL;
              else pairLoss += Math.abs(hedgePos.unrealizedPnL);
          }

          const debt = (mainPos.cumulativeHedgeLoss || 0) + (mainPos.cumulativeAmputationLoss || 0) + (hedgePos ? (hedgePos.cumulativeAmputationLoss || 0) : 0);
          const count = (mainPos.hedgeRetries || 0);
          
          return {
              profit: acc.profit + pairProfit,
              loss: acc.loss + pairLoss,
              debt: acc.debt + debt,
              count: acc.count + count
          };
      }, { profit: 0, loss: 0, debt: 0, count: 0 });

      return {
          totalUnhedgedWin,
          totalUnhedgedLoss,
          totalNormalWin,
          totalNormalLoss,
          totalCurrentPnL,
          totalDebt: Math.abs(totalDebt), // Show as positive debt amount
          debtCount,
          totalRecovery,
          activeHedgeCount: activeHedgePairs.length,
          activeHedgeStats: inProgressHedgeStats
      };
  }, [positions, tradeLogs]);


  // --- 2. FILTER LOGIC ---
  const filteredLogs = useMemo(() => {
      const term = searchTerm.toLowerCase();
      const startMs = startTime ? new Date(startTime).getTime() : 0;
      const endMs = endTime ? new Date(endTime).getTime() : Infinity;
      
      // 1. Base Filter (Search Text & Time Range)
      let filtered = tradeLogs.filter(log => {
          const matchesTerm = log.symbol.toLowerCase().includes(term) ||
              log.entry_id.toLowerCase().includes(term);
          
          if (!matchesTerm) return false;
          
          // Use exit_timestamp if available (for closed trades), else use entry_timestamp
          const logTime = log.exit_timestamp || log.entry_timestamp;
          return logTime >= startMs && logTime <= endMs;
      });

      // 2. Category Filter
      if (activeFilter !== 'ALL') {
          filtered = filtered.filter(log => {
              if (activeFilter === 'OPEN') return log.status === 'OPEN';
              if (activeFilter === 'WIN') return log.status === 'CLOSED' && (log.profit_usdt || 0) > 0;
              if (activeFilter === 'LOSS') return log.status === 'CLOSED' && (log.profit_usdt || 0) < 0;
              
              // HEDGE: Currently hedging trading pairs
              if (activeFilter === 'HEDGE') {
                  if (log.status !== 'OPEN') return false;
                  const pos = positions.find(p => p.entryId === log.entry_id);
                  // Show all positions involved in an active hedge (both main and hedge)
                  return pos ? pos.isHedged === true : false;
              }
              
                      // DEBT: Active hedge cycles with losses
              if (activeFilter === 'DEBT') {
                  if (selectedDebtId) {
                      const summary = activeHedgeStats.summaries.find(s => s.mainLog.entry_id === selectedDebtId);
                      const selectedDebtLog = tradeLogs.find(l => l.entry_id === selectedDebtId);
                      const targetSymbol = selectedDebtLog?.symbol;
                      // 这里确保relatedIds包含的日志条目属于当前选中债务的币种
                      return summary ? (summary.relatedIds.has(log.entry_id) && (!targetSymbol || log.symbol === targetSymbol)) : false;
                  } else {
                      return activeHedgeStats.summaries.some(s => s.mainLog.entry_id === log.entry_id);
                  }
              }

              // RECOVERY: Finished unwinding with net profit
              if (activeFilter === 'RECOVERY') {
                  if (log.status !== 'CLOSED') return false;
                  
                  if (selectedRecoveryId) {
                      // Show all related logs for the selected recovery symbol
                      const mainLog = tradeLogs.find(l => l.entry_id === selectedRecoveryId);
                      if (mainLog) {
                          const relatedIds = recoveryStats.relatedIdsMap.get(mainLog.symbol);
                          return relatedIds ? relatedIds.has(log.entry_id) : false;
                      }
                      return false;
                  } else {
                      // Only show the representative main entry log for each symbol
                      const summary = recoveryStats.summaries.find(s => s.mainLog.entry_id === log.entry_id);
                      return !!summary;
                  }
              }

              // NORMAL_WIN: Never hedged, normal profit closed
              if (activeFilter === 'NORMAL_WIN') {
                  const isHedged = everHedgedIds.has(log.entry_id) || (log.parent_entry_id && everHedgedIds.has(log.parent_entry_id));
                  return !log.main_entry_id && log.status === 'CLOSED' && (log.profit_usdt || 0) > 0 && !isHedged;
              }

              // NORMAL_LOSS: Never hedged, normal loss closed
              if (activeFilter === 'NORMAL_LOSS') {
                  const isHedged = everHedgedIds.has(log.entry_id) || (log.parent_entry_id && everHedgedIds.has(log.parent_entry_id));
                  return !log.main_entry_id && log.status === 'CLOSED' && (log.profit_usdt || 0) < 0 && !isHedged;
              }

              // UNHEDGED_WIN: Active, never hedged, PnL > 0
              if (activeFilter === 'UNHEDGED_WIN') {
                  const isHedged = everHedgedIds.has(log.entry_id) || (log.parent_entry_id && everHedgedIds.has(log.parent_entry_id));
                  if (log.status !== 'OPEN' || !!log.main_entry_id || isHedged) return false;
                  const pos = positions.find(p => p.entryId === log.entry_id || p.entryId === log.parent_entry_id);
                  return pos ? (pos.unrealizedPnL > 0 && !pos.isHedged) : false;
              }

              // UNHEDGED_LOSS: Active, never hedged, PnL < 0
              if (activeFilter === 'UNHEDGED_LOSS') {
                  const isHedged = everHedgedIds.has(log.entry_id) || (log.parent_entry_id && everHedgedIds.has(log.parent_entry_id));
                  if (log.status !== 'OPEN' || !!log.main_entry_id || isHedged) return false;
                  const pos = positions.find(p => p.entryId === log.entry_id || p.entryId === log.parent_entry_id);
                  return pos ? (pos.unrealizedPnL < 0 && !pos.isHedged) : false;
              }

              // NEW_OPEN: Active, never hedged
              if (activeFilter === 'NEW_OPEN') {
                  const isHedged = everHedgedIds.has(log.entry_id) || (log.parent_entry_id && everHedgedIds.has(log.parent_entry_id));
                  if (log.status !== 'OPEN' || !!log.main_entry_id || isHedged) return false;
                  const pos = positions.find(p => p.entryId === log.entry_id || p.entryId === log.parent_entry_id);
                  return pos ? !pos.isHedged : false;
              }

              if (activeFilter === 'LONG') {
                  // Find all main LONG positions
                  const mainLongIds = new Set(
                      tradeLogs
                          .filter(l => !l.main_entry_id && l.direction === PositionSide.LONG)
                          .map(l => l.entry_id)
                  );
                  // Include the main LONG position OR any hedge that belongs to a main LONG position
                  return (!log.main_entry_id && log.direction === PositionSide.LONG) || 
                         (!!log.main_entry_id && mainLongIds.has(log.main_entry_id));
              }
              if (activeFilter === 'SHORT') {
                  // Find all main SHORT positions
                  const mainShortIds = new Set(
                      tradeLogs
                          .filter(l => !l.main_entry_id && l.direction === PositionSide.SHORT)
                          .map(l => l.entry_id)
                  );
                  // Include the main SHORT position OR any hedge that belongs to a main SHORT position
                  return (!log.main_entry_id && log.direction === PositionSide.SHORT) || 
                         (!!log.main_entry_id && mainShortIds.has(log.main_entry_id));
              }
              return true;
          });
      }
      return filtered;
  }, [tradeLogs, searchTerm, activeFilter, positions, everHedgedIds, recoveryStats, activeHedgeStats]);

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
          
          let pnl = log.profit_usdt || 0;
          if (log.status === 'OPEN') {
              const pos = positions.find(p => p.entryId === log.entry_id);
              if (pos) pnl = pos.unrealizedPnL;
          }
          g.totalPnL += pnl;

          if (log.status === 'CLOSED') {
             if (pnl > 0) g.winCount++;
             else g.lossCount++;
          }
          const time = log.exit_timestamp || log.entry_timestamp;
          if (time > g.lastTime) g.lastTime = time;
      });

      return Object.values(groups).sort((a, b) => {
          if (groupSortConfig.key === 'TIME') {
              return groupSortConfig.direction === 'DESC' ? b.lastTime - a.lastTime : a.lastTime - b.lastTime;
          } else {
              // AMOUNT
              const valA = (activeFilter === 'DEBT' || activeFilter === 'UNHEDGED_LOSS') ? Math.abs(a.totalPnL) : a.totalPnL;
              const valB = (activeFilter === 'DEBT' || activeFilter === 'UNHEDGED_LOSS') ? Math.abs(b.totalPnL) : b.totalPnL;
              return groupSortConfig.direction === 'DESC' ? valB - valA : valA - valB;
          }
      });
  }, [filteredLogs, isGroupedView, activeFilter, groupSortConfig]);

  // Sorted List Data
  const sortedFilteredLogs = useMemo(() => {
      if (isGroupedView) return filteredLogs;
      let sorted = [...filteredLogs];
      sorted.sort((a, b) => {
          if (activeFilter === 'DEBT' && selectedDebtId) { 
              const timeA = a.exit_timestamp || a.entry_timestamp || 0;
              const timeB = b.exit_timestamp || b.entry_timestamp || 0;
              if (timeA !== timeB) return timeA - timeB; // ASC (oldest first)
              return a.entry_id.localeCompare(b.entry_id); // Stable secondary key
          }
          if (listSortConfig.key === 'TIME') {
              const timeA = a.exit_timestamp || a.entry_timestamp;
              const timeB = b.exit_timestamp || b.entry_timestamp;
              return listSortConfig.direction === 'DESC' ? timeB - timeA : timeA - timeB;
          } else {
              let pnlA = a.profit_usdt || 0;
              if (a.status === 'OPEN') {
                  const posA = positions.find(p => p.entryId === a.entry_id);
                  if (posA) pnlA = posA.unrealizedPnL;
              }
              let pnlB = b.profit_usdt || 0;
              if (b.status === 'OPEN') {
                  const posB = positions.find(p => p.entryId === b.entry_id);
                  if (posB) pnlB = posB.unrealizedPnL;
              }
              
              const valA = (activeFilter === 'DEBT' || activeFilter === 'UNHEDGED_LOSS') ? Math.abs(pnlA) : pnlA;
              const valB = (activeFilter === 'DEBT' || activeFilter === 'UNHEDGED_LOSS') ? Math.abs(pnlB) : pnlB;
              return listSortConfig.direction === 'DESC' ? valB - valA : valA - valB;
          }
      });
      return sorted;
  }, [filteredLogs, isGroupedView, activeFilter, listSortConfig, positions, selectedDebtId]);

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
      if (sec < 60) return `${sec}秒`;
      const min = Math.floor(sec / 60);
      if (min < 60) return `${min}分 ${sec % 60}秒`;
      const hr = Math.floor(min / 60);
      return `${hr}时 ${min % 60}分`;
  };

  const formatTimeframe = (tf?: string) => {
      if (!tf) return '-';
      const map: Record<string, string> = {
          '1m': '1分钟',
          '3m': '3分钟',
          '5m': '5分钟',
          '15m': '15分钟',
          '30m': '30分钟',
          '1h': '1小时',
          '2h': '2小时',
          '4h': '4小时',
          '6h': '6小时',
          '8h': '8小时',
          '12h': '12小时',
          '1d': '1天',
          '3d': '3天',
          '1w': '1周',
          '1M': '1月'
      };
      const key = tf.toLowerCase();
      if (map[key]) return map[key];
      
      if (tf.endsWith('m')) return tf.replace('m', '分钟');
      if (tf.endsWith('h') || tf.endsWith('H')) return tf.replace(/[hH]/, '小时');
      if (tf.endsWith('d') || tf.endsWith('D')) return tf.replace(/[dD]/, '天');
      if (tf.endsWith('w') || tf.endsWith('W')) return tf.replace(/[wW]/, '周');
      
      return tf;
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
                        <h2 className="text-lg font-bold text-white">交易日志</h2>
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
                            onChange={(e) => handleSearchChange(e.target.value)}
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
                    <div className="flex items-center gap-2">
                        {onClearHistory && (
                            <button onClick={onClearHistory} className="p-1.5 bg-red-900/20 hover:bg-red-900/50 text-red-400 border border-red-500/20 rounded transition-colors" title="清空所有历史记录">
                                <Trash2 size={14} />
                            </button>
                        )}
                        <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white">
                            <X size={20} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Filter Bar */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <FilterChip type="ALL" label="全部" icon={Layers} colorClass="bg-slate-700 text-white border-slate-500" activeFilter={activeFilter} handleFilterChange={handleFilterChange} />
                    <FilterChip type="NEW_OPEN" label="新开仓" icon={Activity} colorClass="bg-blue-900/40 text-blue-400 border-blue-500/30" activeFilter={activeFilter} handleFilterChange={handleFilterChange} />
                    <FilterChip type="UNHEDGED_WIN" label="未对冲盈利" icon={TrendingUp} colorClass="bg-emerald-900/40 text-emerald-400 border-emerald-500/30" activeFilter={activeFilter} handleFilterChange={handleFilterChange} />
                    <FilterChip type="UNHEDGED_LOSS" label="未对冲亏损" icon={TrendingDown} colorClass="bg-red-900/40 text-red-400 border-red-500/30" activeFilter={activeFilter} handleFilterChange={handleFilterChange} />
                    <FilterChip type="NORMAL_WIN" label="常规止盈" icon={Banknote} colorClass="bg-emerald-900/40 text-emerald-400 border-emerald-500/30" activeFilter={activeFilter} handleFilterChange={handleFilterChange} />
                    <FilterChip type="NORMAL_LOSS" label="常规止损" icon={Banknote} colorClass="bg-red-900/40 text-red-400 border-red-500/30" activeFilter={activeFilter} handleFilterChange={handleFilterChange} />
                    <FilterChip type="DEBT" label="负债对冲止损" icon={Banknote} colorClass="bg-red-900/40 text-red-400 border-red-500/30" activeFilter={activeFilter} handleFilterChange={handleFilterChange} />
                    <FilterChip type="RECOVERY" label="解套对冲盈利" icon={RotateCcw} colorClass="bg-emerald-900/40 text-emerald-400 border-emerald-500/30" activeFilter={activeFilter} handleFilterChange={handleFilterChange} />
                    <FilterChip type="HEDGE" label="对冲中" icon={Shield} colorClass="bg-indigo-900/40 text-indigo-400 border-indigo-500/30" activeFilter={activeFilter} handleFilterChange={handleFilterChange} />
                </div>

                <div className="flex items-center gap-2 bg-slate-800/50 p-1.5 rounded-lg border border-slate-700/50">
                    <Clock size={14} className="text-slate-500 ml-1" />
                    <input 
                        type="datetime-local" 
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="bg-transparent border-none text-[10px] text-slate-300 focus:outline-none w-32"
                    />
                    <span className="text-slate-600">-</span>
                    <input 
                        type="datetime-local" 
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="bg-transparent border-none text-[10px] text-slate-300 focus:outline-none w-32"
                    />
                    {(startTime || endTime) && (
                        <button 
                            onClick={() => { setStartTime(''); setEndTime(''); }}
                            className="bg-slate-700 hover:bg-slate-600 text-slate-300 p-1 rounded-md transition-colors"
                        >
                            <RotateCcw size={10} />
                        </button>
                    )}
                </div>
                
                {/* 常态化返回及退出按钮组 */}
                <div className="flex items-center gap-2">
                    <button 
                        onClick={() => {
                            setSelectedLog(null);
                            handleFilterChange('ALL');
                        }}
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold transition-all border border-slate-500/50 bg-slate-800 text-slate-100 hover:bg-slate-700 active:scale-95 shadow-lg"
                    >
                        <ArrowLeft size={14} />
                        <span>返回主页</span>
                    </button>
                    <button 
                        onClick={onClose}
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold transition-all border border-red-500/50 bg-red-900/50 text-red-100 hover:bg-red-800/80 active:scale-95 shadow-lg"
                    >
                        <X size={14} />
                        <span>退出</span>
                    </button>
                </div>
                
                {/* Manual Return Button next to filters for sub-views */}
                {(activeFilter !== 'ALL' || selectedRecoveryId || selectedDebtId || selectedLog) && (
                    <button 
                        onClick={() => {
                            if (selectedLog) {
                                setSelectedLog(null);
                            } else {
                                handleFilterChange('ALL');
                            }
                        }}
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold transition-all border border-indigo-500/50 bg-indigo-500/20 text-indigo-100 hover:bg-indigo-500/40 shadow-[0_0_15px_rgba(99,102,241,0.2)] active:scale-95 animate-pulse"
                    >
                        <ArrowLeft size={14} className="text-white" />
                        <span>返回上一级</span>
                    </button>
                )}
            </div>

            {/* Stats Summary Bar */}
            <div className="flex items-center gap-6 px-4 py-3 bg-slate-900/50 rounded border border-slate-800 text-xs overflow-x-auto whitespace-nowrap scrollbar-hide">
                <div className={`flex flex-col transition-all ${activeFilter === 'ALL' ? 'scale-105 ring-1 ring-indigo-500/30 bg-indigo-500/5 p-1 rounded' : 'opacity-70'}`}>
                    <span className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-1">
                        <Layers size={10} /> 当前盈亏
                    </span>
                    <span className={`font-mono font-bold text-sm ${overviewStats.totalCurrentPnL >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {overviewStats.totalCurrentPnL > 0 ? '+' : ''}{overviewStats.totalCurrentPnL.toFixed(2)} U
                    </span>
                </div>
                <div className="h-6 w-px bg-slate-800"></div>
                <div className={`flex flex-col transition-all ${activeFilter === 'UNHEDGED_WIN' ? 'scale-105 ring-1 ring-emerald-500/30 bg-emerald-500/5 p-1 rounded' : 'opacity-70'}`}>
                    <span className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-1">
                        <TrendingUp size={10} /> 未对冲盈利
                    </span>
                    <span className="font-mono font-bold text-emerald-500 text-sm">+{overviewStats.totalUnhedgedWin.toFixed(2)} U</span>
                </div>
                <div className="h-6 w-px bg-slate-800"></div>
                <div className={`flex flex-col transition-all ${activeFilter === 'UNHEDGED_LOSS' ? 'scale-105 ring-1 ring-red-500/30 bg-red-500/5 p-1 rounded' : 'opacity-70'}`}>
                    <span className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-1">
                        <TrendingDown size={10} /> 未对冲亏损
                    </span>
                    <span className="font-mono font-bold text-red-500 text-sm">-{Math.abs(overviewStats.totalUnhedgedLoss).toFixed(2)} U</span>
                </div>
                <div className="h-6 w-px bg-slate-800"></div>
                <div className={`flex flex-col transition-all ${activeFilter === 'NORMAL_WIN' ? 'scale-105 ring-1 ring-emerald-500/30 bg-emerald-500/5 p-1 rounded' : 'opacity-70'}`}>
                    <span className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-1">
                        <Banknote size={10} /> 常规止盈
                    </span>
                    <span className="font-mono font-bold text-emerald-500 text-sm">+{overviewStats.totalNormalWin.toFixed(2)} U</span>
                </div>
                <div className="h-6 w-px bg-slate-800"></div>
                <div className={`flex flex-col transition-all ${activeFilter === 'NORMAL_LOSS' ? 'scale-105 ring-1 ring-red-500/30 bg-red-500/5 p-1 rounded' : 'opacity-70'}`}>
                    <span className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-1">
                        <Banknote size={10} /> 常规止损
                    </span>
                    <span className="font-mono font-bold text-red-500 text-sm">-{Math.abs(overviewStats.totalNormalLoss).toFixed(2)} U</span>
                </div>
                <div className="h-6 w-px bg-slate-800"></div>
                <div className={`flex flex-col transition-all ${activeFilter === 'DEBT' ? 'scale-105 ring-1 ring-red-500/30 bg-red-500/5 p-1 rounded' : 'opacity-70'}`}>
                    <span className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-1">
                        <Banknote size={10} /> 负债对冲止损
                    </span>
                    <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-red-500 text-sm">{overviewStats.totalDebt.toFixed(2)} U</span>
                        <span className="text-[9px] bg-red-900/40 text-red-400 px-1 rounded border border-red-500/20">{overviewStats.debtCount}次</span>
                    </div>
                </div>
                <div className="h-6 w-px bg-slate-800"></div>
                <div className={`flex flex-col transition-all ${activeFilter === 'RECOVERY' ? 'scale-105 ring-1 ring-emerald-500/30 bg-emerald-500/5 p-1 rounded' : 'opacity-70'}`}>
                    <span className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-1">
                        <RotateCcw size={10} /> 解套对冲盈利
                    </span>
                    <span className="font-mono font-bold text-emerald-500 text-sm">+{overviewStats.totalRecovery.toFixed(2)} U</span>
                </div>
                <div className="h-6 w-px bg-slate-800"></div>
                <div className={`flex flex-col transition-all ${activeFilter === 'HEDGE' ? 'scale-105 ring-1 ring-indigo-500/30 bg-indigo-500/5 p-1 rounded' : 'opacity-70'}`}>
                    <span className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-1">
                        <Shield size={10} /> 对冲中
                    </span>
                    <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-emerald-400 text-[11px]">
                                +{overviewStats.activeHedgeStats.profit.toFixed(2)}
                            </span>
                            <span className="text-slate-600">/</span>
                            <span className="font-mono font-bold text-red-400 text-[11px]">
                                -{overviewStats.activeHedgeStats.loss.toFixed(2)}
                            </span>
                            <span className="text-[9px] bg-indigo-900/40 text-indigo-300 px-1 rounded border border-indigo-500/30">{overviewStats.activeHedgeCount}组</span>
                        </div>
                        <div className="text-[9px] text-amber-500 font-bold">
                            负债: {overviewStats.activeHedgeStats.debt.toFixed(2)} U ({overviewStats.activeHedgeStats.count}次)
                        </div>
                    </div>
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
                                <th className="px-4 py-3">币种</th>
                                <th className="px-4 py-3 text-center">
                                    {activeFilter === 'DEBT' ? '止损次数' : '交易次数'}
                                </th>
                                <th 
                                    className="px-4 py-3 text-right cursor-pointer hover:text-white select-none group"
                                    onClick={() => setGroupSortConfig(p => ({ key: 'AMOUNT', direction: p.key === 'AMOUNT' && p.direction === 'DESC' ? 'ASC' : 'DESC' }))}
                                >
                                    <div className="flex items-center justify-end gap-1">
                                        {activeFilter === 'DEBT' ? '负债总额 (U)' : activeFilter === 'RECOVERY' ? '回血总额 (U)' : activeFilter === 'NORMAL_WIN' ? '止盈总额 (U)' : activeFilter === 'UNHEDGED_WIN' ? '盈利总额 (U)' : activeFilter === 'UNHEDGED_LOSS' ? '亏损总额 (U)' : '累计盈亏 (U)'}
                                        <span className={`text-[10px] ${groupSortConfig.key === 'AMOUNT' ? 'text-indigo-400' : 'text-slate-600 group-hover:text-slate-400'}`}>
                                            {groupSortConfig.key === 'AMOUNT' ? (groupSortConfig.direction === 'DESC' ? '↓' : '↑') : '↕'}
                                        </span>
                                    </div>
                                </th>
                                <th 
                                    className="px-4 py-3 text-right cursor-pointer hover:text-white select-none group"
                                    onClick={() => setGroupSortConfig(p => ({ key: 'TIME', direction: p.key === 'TIME' && p.direction === 'DESC' ? 'ASC' : 'DESC' }))}
                                >
                                    <div className="flex items-center justify-end gap-1">
                                        最近交易时间
                                        <span className={`text-[10px] ${groupSortConfig.key === 'TIME' ? 'text-indigo-400' : 'text-slate-600 group-hover:text-slate-400'}`}>
                                            {groupSortConfig.key === 'TIME' ? (groupSortConfig.direction === 'DESC' ? '↓' : '↑') : '↕'}
                                        </span>
                                    </div>
                                </th>
                                <th className="px-4 py-3 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {groupedData.length === 0 && (
                                <tr><td colSpan={6} className="text-center py-10 text-slate-600">无数据</td></tr>
                            )}
                            {groupedData.map((group, idx) => (
                                <tr key={`${group.symbol}-${idx}`} className="hover:bg-slate-800/30 transition-colors">
                                    <td className="px-4 py-3 text-xs font-mono text-slate-600">{idx + 1}</td>
                                    <td className="px-4 py-3 font-bold text-slate-200">
                                        <div className="flex items-center gap-2">
                                            <span 
                                                className="cursor-pointer hover:text-indigo-400 transition-colors"
                                                onClick={() => onOpenChart?.(group.symbol)}
                                            >
                                                {group.symbol}
                                            </span>
                                            {activeFilter === 'DEBT' && <Banknote size={12} className="text-red-400"/>}
                                            {activeFilter === 'RECOVERY' && <RotateCcw size={12} className="text-emerald-400"/>}
                                            <button 
                                                onClick={() => onOpenChart?.(group.symbol)}
                                                className="p-1 hover:bg-slate-700 rounded text-slate-500 hover:text-indigo-400 transition-all"
                                                title="查看K线"
                                            >
                                                <BarChart2 size={12} />
                                            </button>
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
                                                handleSearchChange(group.symbol);
                                                handleFilterChange('ALL');
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
                                    <thead>
                                        <tr>
                                        {(activeFilter === 'RECOVERY' && !selectedRecoveryId) || (activeFilter === 'DEBT' && !selectedDebtId) ? (
                                            <>
                                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">币名</th>
                                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">
                                                    止损次数
                                                </th>
                                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">最后一次止损时间</th>
                                                {activeFilter === 'RECOVERY' ? (
                                                    <>
                                                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">对冲盈利总和</th>
                                                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">对冲止损总和</th>
                                                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">最终盈利</th>
                                                    </>
                                                ) : (
                                                    <>
                                                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">状态原因</th>
                                                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">当前对冲止损总和</th>
                                                    </>
                                                )}
                                                <th className="px-4 py-3 text-center text-xs font-bold text-slate-400 uppercase tracking-wider">操作</th>
                                            </>
                                        ) : (
                                            <>
                                                <th 
                                                    className="px-4 py-3 cursor-pointer hover:text-white select-none group"
                                                    onClick={() => setListSortConfig(p => ({ key: 'TIME', direction: p.key === 'TIME' && p.direction === 'DESC' ? 'ASC' : 'DESC' }))}
                                                >
                                                    <div className="flex items-center gap-1">
                                                        交易时间 / 类型
                                                        <span className={`text-[10px] ${listSortConfig.key === 'TIME' ? 'text-indigo-400' : 'text-slate-600 group-hover:text-slate-400'}`}>
                                                            {listSortConfig.key === 'TIME' ? (listSortConfig.direction === 'DESC' ? '↓' : '↑') : '↕'}
                                                        </span>
                                                    </div>
                                                </th>
                                                <th className="px-4 py-3">交易对</th>
                                                <th className="px-4 py-3">时间周期</th>
                                                <th className="px-4 py-3">方向/杠杆</th>
                                                <th className="px-4 py-3">开仓价值 (U)</th>
                                                <th className="px-4 py-3">开仓价</th>
                                                <th className="px-4 py-3">实时价/平仓价</th>
                                                <th 
                                                    className="px-4 py-3 cursor-pointer hover:text-white select-none group"
                                                    onClick={() => setListSortConfig(p => ({ key: 'AMOUNT', direction: p.key === 'AMOUNT' && p.direction === 'DESC' ? 'ASC' : 'DESC' }))}
                                                >
                                                    <div className="flex items-center gap-1">
                                                        盈亏(U) / ROE%
                                                        <span className={`text-[10px] ${listSortConfig.key === 'AMOUNT' ? 'text-indigo-400' : 'text-slate-600 group-hover:text-slate-400'}`}>
                                                            {listSortConfig.key === 'AMOUNT' ? (listSortConfig.direction === 'DESC' ? '↓' : '↑') : '↕'}
                                                        </span>
                                                    </div>
                                                </th>
                                            </>
                                        )}
                                            <th className="px-4 py-3">状态/原因</th>
                                            <th className="px-4 py-3 text-right">操作</th>
                                        </tr>
                                    </thead>
                        <tbody className="divide-y divide-slate-800">
                            {sortedFilteredLogs.map((log, idx) => {
                                const isSafeClear = log.exit_reason?.includes('防爆安全') || log.exit_reason?.includes('解套');
                                const prevLog = sortedFilteredLogs[idx - 1];
                                const nextLog = sortedFilteredLogs[idx + 1];
                                const isGrouped = selectedRecoveryId && isSafeClear && (
                                    (prevLog && (prevLog.main_entry_id === log.entry_id || prevLog.parent_entry_id === log.entry_id || prevLog.entry_id === log.main_entry_id || prevLog.entry_id === log.parent_entry_id)) || 
                                    (nextLog && (nextLog.main_entry_id === log.entry_id || nextLog.parent_entry_id === log.entry_id || nextLog.entry_id === log.main_entry_id || nextLog.entry_id === log.parent_entry_id))
                                );
                                const uniqueKey = `${log.entry_id}-${log.status}-${log.exit_timestamp || log.entry_timestamp}-${idx}`;
                                
                                const activePos = positions.find(p => p.entryId === log.entry_id);
                                const currentPrice = activePos ? activePos.markPrice : (log.exit_price || 0);
                                const realizedPnL = log.profit_usdt || 0;
                                const realizedPnLPct = log.profit_percent || 0;

                                let recoveryInfo: { netProfit: number, grossProfit: number, totalLoss: number, hedgeCount: number, lastStopLossTime: number } | null = null;
                                if (activeFilter === 'RECOVERY' && !selectedRecoveryId && recoveryStats.map.has(log.symbol)) {
                                    recoveryInfo = recoveryStats.map.get(log.symbol)!;
                                }

                                    if (activeFilter === 'RECOVERY' && !selectedRecoveryId) {
                                        if (!recoveryInfo) return null;
                                        return (
                                            <tr key={uniqueKey} className="hover:bg-slate-800/30 transition-colors border-b border-slate-800/50">
                                                <td className="px-4 py-4 font-bold text-slate-200 text-sm">
                                                    {log.symbol}
                                                </td>
                                                <td className="px-4 py-4 text-slate-300 font-mono">
                                                    <span className="bg-indigo-900/40 text-indigo-300 px-2 py-0.5 rounded border border-indigo-500/20">
                                                        {recoveryInfo.hedgeCount} 次
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4 text-xs text-slate-500 font-mono">
                                                    {recoveryInfo.lastStopLossTime > 0 ? new Date(recoveryInfo.lastStopLossTime).toLocaleString() : '-'}
                                                </td>
                                                <td className="px-4 py-4 font-mono text-emerald-400 font-bold">
                                                    +{recoveryInfo.grossProfit.toFixed(2)} U
                                                </td>
                                                <td className="px-4 py-4 font-mono text-red-400 font-bold">
                                                    -{recoveryInfo.totalLoss.toFixed(2)} U
                                                </td>
                                                <td className={`px-4 py-4 font-mono font-bold text-lg ${recoveryInfo.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                    {recoveryInfo.netProfit > 0 ? '+' : ''}{recoveryInfo.netProfit.toFixed(2)} U
                                                </td>
                                                <td className="px-4 py-4 text-center">
                                                    <div className="flex items-center justify-center gap-3">
                                                        <button 
                                                            onClick={(e) => { 
                                                                e.stopPropagation(); 
                                                                setSelectedRecoveryId(log.entry_id);
                                                            }} 
                                                            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-full text-slate-400 hover:text-blue-400 transition-all border border-slate-700" 
                                                            title="查看解套流水"
                                                        >
                                                            <Clock size={16} />
                                                        </button>
                                                        <button 
                                                            onClick={() => onOpenChart?.(log.symbol, log.entry_price, log.entry_timestamp, log.timeframe)}
                                                            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-full text-slate-400 hover:text-indigo-400 transition-all border border-slate-700" 
                                                            title="查看图表"
                                                        >
                                                            <BarChart2 size={16} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    }

                                    if (activeFilter === 'DEBT' && !selectedDebtId) {
                                        const debtInfo = activeHedgeStats.map.get(log.symbol);
                                        if (!debtInfo) return null;
                                        return (
                                            <tr key={uniqueKey} className="hover:bg-slate-800/30 transition-colors border-b border-slate-800/50">
                                                <td className="px-4 py-4 font-bold text-slate-200 text-sm">
                                                    {log.symbol}
                                                </td>
                                                <td className="px-4 py-4 text-slate-300 font-mono">
                                                    <span className="bg-indigo-900/40 text-indigo-300 px-2 py-0.5 rounded border border-indigo-500/20">
                                                        {debtInfo.hedgeCount} 次
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4 text-xs text-slate-500 font-mono">
                                                    {debtInfo.lastStopLossTime > 0 ? new Date(debtInfo.lastStopLossTime).toLocaleString() : '-'}
                                                </td>
                                                <td className="px-4 py-4 text-xs text-slate-400">
                                                    <div className="max-w-[200px] truncate" title={debtInfo.lastStopLossRule}>
                                                        {debtInfo.lastStopLossRule || '-'}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4 font-mono text-red-400 font-bold">
                                                    -{debtInfo.totalLoss.toFixed(2)} U
                                                </td>
                                                <td className="px-4 py-4 text-center">
                                                    <div className="flex items-center justify-center gap-3">
                                                        <button 
                                                            onClick={(e) => { 
                                                                e.stopPropagation(); 
                                                                handleFilterChange('DEBT');
                                                                setSelectedDebtId(log.entry_id);
                                                            }} 
                                                            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-full text-slate-400 hover:text-blue-400 transition-all border border-slate-700" 
                                                            title="查看对冲流水"
                                                        >
                                                            <Clock size={16} />
                                                        </button>
                                                        <button 
                                                            onClick={() => onOpenChart?.(log.symbol, log.entry_price, log.entry_timestamp, log.timeframe)}
                                                            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-full text-slate-400 hover:text-indigo-400 transition-all border border-slate-700" 
                                                            title="查看图表"
                                                        >
                                                            <BarChart2 size={16} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    }

                                return (
                                    <tr key={uniqueKey} className={`transition-colors ${selectedLog === log ? 'bg-indigo-900/30' : 'hover:bg-slate-800/30'} ${isGrouped ? 'bg-indigo-900/10' : ''} ${!!log.main_entry_id ? 'bg-blue-900/10' : ''} ${!!log.parent_entry_id ? 'bg-purple-900/10' : ''}`}>
                                        <td className="px-4 py-3 text-xs whitespace-nowrap text-slate-300 relative">
                                            {isGrouped && <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500/50"></div>}
                                            {!!log.main_entry_id && <div className="absolute left-1 top-0 bottom-0 w-1 bg-blue-500/50"></div>}
                                            {!!log.parent_entry_id && <div className="absolute left-2 top-0 bottom-0 w-1 bg-purple-500/50"></div>}
                                            {log.status === 'CLOSED' ? (
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-red-300">{new Date(log.exit_timestamp || Date.now()).toLocaleString()}</span>
                                                    <div className="flex items-center gap-1.5 mt-0.5">
                                                        <span className="text-[9px] bg-red-900/40 text-red-400 px-1 rounded border border-red-500/20 font-bold">平仓</span>
                                                        <span className="text-[9px] text-slate-500">持仓: {getDuration(log.entry_timestamp, log.exit_timestamp)}</span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-emerald-300">{new Date(log.entry_timestamp).toLocaleString()}</span>
                                                    <div className="flex items-center gap-1.5 mt-0.5">
                                                        <span className="text-[9px] bg-emerald-900/40 text-emerald-400 px-1 rounded border border-emerald-500/20 font-bold">开仓</span>
                                                    </div>
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 font-bold text-slate-200">
                                            <div className="flex items-center gap-2">
                                                <span 
                                                    className="cursor-pointer hover:text-indigo-400 transition-colors"
                                                    onClick={() => onOpenChart?.(log.symbol, log.entry_price, log.entry_timestamp, log.timeframe)}
                                                >
                                                    {log.symbol}
                                                </span>
                                                <button onClick={(e) => { e.stopPropagation(); handleSearchChange(log.symbol); handleFilterChange('ALL'); setIsGroupedView(false); }} className="p-1 hover:bg-slate-700 rounded text-slate-500 hover:text-blue-400 transition-all" title="查看流水"><History size={12} /></button>
                                            </div>
                                            <div className="text-[10px] text-slate-500 font-mono font-normal">{log.entry_id.slice(-6)}</div>
                                        </td>
                                        <td className="px-4 py-3">
                                            {log.timeframe ? (
                                                <button 
                                                    onClick={() => onOpenChart?.(log.symbol, log.entry_price, log.entry_timestamp, log.timeframe)}
                                                    className="px-2 py-1 bg-indigo-900/30 text-indigo-400 rounded border border-indigo-500/30 text-xs font-bold hover:bg-indigo-600 hover:text-white transition-all flex items-center gap-1"
                                                >
                                                    <BarChart2 size={12} />
                                                    {formatTimeframe(log.timeframe)}
                                                </button>
                                            ) : (
                                                <span className="text-slate-600">-</span>
                                            )}
                                        </td>
                                        <td className={`px-4 py-3 text-xs ${log.direction === PositionSide.LONG ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {activeFilter !== 'RECOVERY' && (
                                                <div className="flex items-center gap-1">
                                                    {log.direction}
                                                </div>
                                            )}
                                            {!!log.main_entry_id && <span className="inline-flex items-center gap-0.5 mt-1 px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400 border border-blue-500/30 text-[9px] font-bold"><Shield size={8} /> 🛡️对冲</span>}
                                            {!!log.parent_entry_id && <span className="inline-flex items-center gap-0.5 mt-1 px-1.5 py-0.5 rounded bg-purple-900/30 text-purple-400 border border-purple-500/30 text-[9px] font-bold"><Shield size={8} /> ✂️减仓</span>}
                                        </td>
                                        <td className="px-4 py-3 text-xs font-mono">
                                            <div className="font-bold text-slate-200">{log.cost_usdt.toFixed(2)} U</div>
                                            {log.current_amount !== undefined && (
                                                <div className="text-[10px] text-slate-500 mt-0.5">
                                                    最新持仓: {log.current_amount.toFixed(4)}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 font-mono text-xs">{log.entry_price.toFixed(8)}</td>
                                        <td className="px-4 py-3 font-mono text-xs text-slate-300">{currentPrice > 0 ? currentPrice.toFixed(8) : '-'}</td>
                                        <td className={`px-4 py-3 font-mono font-bold ${log.status === 'CLOSED' ? ((activeFilter === 'RECOVERY' && recoveryInfo !== null) ? (recoveryInfo.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400') : (realizedPnL > 0 ? 'text-emerald-400' : 'text-red-400')) : (activePos ? (activePos.unrealizedPnL > 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-500')}`}>
                                            {log.status === 'CLOSED' ? (
                                                <>
                                                    {activeFilter === 'RECOVERY' && recoveryInfo !== null ? (
                                                        <div className="flex flex-col items-start gap-1">
                                                            <div className="flex items-center gap-1 text-[10px] font-mono whitespace-nowrap">
                                                                <span className="text-emerald-500">+{recoveryInfo.grossProfit.toFixed(2)}</span>
                                                                <span className="text-slate-500 mx-0.5">-</span>
                                                                <span className="text-red-500">{recoveryInfo.totalLoss.toFixed(2)}</span>
                                                                <span className="text-slate-500 mx-0.5">=</span>
                                                                <span className={`font-bold ${recoveryInfo.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                                    {recoveryInfo.netProfit > 0 ? '+' : ''}{recoveryInfo.netProfit.toFixed(2)}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-1">
                                                                <span className={`text-[9px] px-1 rounded border font-normal ${recoveryInfo.netProfit >= 0 ? 'bg-emerald-900/40 text-emerald-400 border-emerald-500/20' : 'bg-red-900/40 text-red-400 border-red-500/20'}`}>净盈利</span>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <div>{realizedPnL > 0 ? '+' : ''}{realizedPnL.toFixed(2)}</div>
                                                            <div className={`text-[10px] font-normal ${realizedPnLPct > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{realizedPnLPct > 0 ? '+' : ''}{realizedPnLPct.toFixed(2)}%</div>
                                                        </>
                                                    )}
                                                </>
                                            ) : activePos ? (
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-2">
                                                        <div>
                                                            <div>{activePos.unrealizedPnL > 0 ? '+' : ''}{activePos.unrealizedPnL.toFixed(2)}</div>
                                                            <div className={`text-[10px] font-normal ${activePos.unrealizedPnL > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                                                {activePos.unrealizedPnL > 0 ? '+' : ''}
                                                                {((activePos.side === PositionSide.LONG ? currentPrice - activePos.entryPrice : activePos.entryPrice - currentPrice) / activePos.entryPrice * 100).toFixed(2)}%
                                                            </div>
                                                        </div>
                                                        <span className="text-[9px] bg-indigo-900/40 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-500/30 whitespace-nowrap">运行中</span>
                                                    </div>
                                                    
                                                    {activeFilter === 'HEDGE' && (
                                                        <div className="mt-2 pt-2 border-t border-slate-800/50 flex flex-col gap-1 bg-indigo-950/20 p-1.5 rounded">
                                                            {(() => {
                                                                // Calculate Combined Stats for the pair
                                                                let mainPos = activePos.mainPositionId ? positions.find(p => p.entryId === activePos.mainPositionId) : activePos;
                                                                let hedgePos = activePos.mainPositionId ? activePos : positions.find(p => p.mainPositionId === activePos.entryId);
                                                                
                                                                if (!mainPos) return null;

                                                                const cumulativeLoss = (mainPos.cumulativeHedgeLoss || 0) + 
                                                                                     (mainPos.cumulativeAmputationLoss || 0) + 
                                                                                     (hedgePos ? (hedgePos.cumulativeAmputationLoss || 0) : 0);
                                                                
                                                                let currentFloatingLoss = 0;
                                                                if (mainPos.unrealizedPnL < 0) currentFloatingLoss += Math.abs(mainPos.unrealizedPnL);
                                                                if (hedgePos && hedgePos.unrealizedPnL < 0) currentFloatingLoss += Math.abs(hedgePos.unrealizedPnL);
                                                                
                                                                const totalDebt = currentFloatingLoss + cumulativeLoss;
                                                                const mainCost = (mainPos.amount * mainPos.entryPrice);
                                                                const hedgeCost = hedgePos ? (hedgePos.amount * hedgePos.entryPrice) : 0;
                                                                const totalCost = mainCost + hedgeCost;
                                                                
                                                                const pairPnL = mainPos.unrealizedPnL + (hedgePos ? hedgePos.unrealizedPnL : 0);
                                                                const pairPnLPct = totalCost > 0 ? (pairPnL / totalCost * 100) : 0;

                                                                return (
                                                                    <>
                                                                        <div className="flex items-center justify-between text-[10px] border-b border-slate-800/30 pb-1 mb-1">
                                                                            <span className="text-slate-400 font-bold">组合盈亏:</span>
                                                                            <div className="text-right">
                                                                                <div className={pairPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                                                                    {pairPnL >= 0 ? '+' : ''}{pairPnL.toFixed(2)} U
                                                                                </div>
                                                                                <div className={`text-[9px] ${pairPnLPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                                                                    {pairPnLPct >= 0 ? '+' : ''}{pairPnLPct.toFixed(2)}%
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                        <div className="flex items-center justify-between text-[10px] text-amber-500">
                                                                            <span className="font-bold">负债金额:</span>
                                                                            <div className="text-right">
                                                                                <div className="font-bold">{totalDebt.toFixed(2)} U</div>
                                                                                <div className="text-[9px] opacity-80">({(totalCost > 0 ? (totalDebt / totalCost * 100) : 0).toFixed(2)}%)</div>
                                                                            </div>
                                                                        </div>
                                                                    </>
                                                                );
                                                            })()}
                                                        </div>
                                                    )}
                                                </div>
                                            ) : <span className="text-slate-600">-</span>}
                                        </td>
                                        <td className="px-4 py-3 text-xs">
                                            {log.status === 'OPEN' ? <span className="bg-emerald-900/20 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20">开仓</span> : (
                                                <div className="flex items-center gap-1">
                                                    {isGrouped && <Link size={10} className="text-indigo-400" />}
                                                    {recoveryInfo !== null && (
                                                        <span className="text-[10px] bg-amber-900/40 text-amber-400 px-1.5 py-0.5 rounded border border-amber-500/30 whitespace-nowrap font-bold">
                                                            最终解套盈利: {recoveryInfo.netProfit.toFixed(2)} U
                                                        </span>
                                                    )}
                                                    <span className="text-slate-300 bg-slate-800/50 px-1.5 py-0.5 rounded border border-slate-700/50" title={log.exit_reason}>{log.exit_reason ? (log.exit_reason.length > 15 ? log.exit_reason.substring(0, 15) + '...' : log.exit_reason) : '-'}</span>
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                {activeFilter === 'RECOVERY' && !selectedRecoveryId && (
                                                    <button 
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSelectedRecoveryId(log.entry_id);
                                                        }}
                                                        className="text-emerald-400 hover:text-emerald-300 text-xs flex items-center gap-1"
                                                        title="查看解套流水"
                                                    >
                                                        <Clock size={12} /> 流水
                                                    </button>
                                                )}
                                                <button onClick={() => setSelectedLog(log)} className="text-indigo-400 hover:text-indigo-300 text-xs flex items-center gap-1">详情 <ArrowRight size={12}/></button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {filteredLogs.length === 0 && <tr><td colSpan={10} className="text-center py-10 text-slate-600">没有符合筛选条件的记录</td></tr>}
                        </tbody>
                    </table>
                </div>
            )}
            
            {/* Details Panel */}
            {selectedLog && !isGroupedView && (
                <div className="w-full md:w-2/5 bg-slate-900 p-4 border-l border-slate-800 overflow-y-auto absolute md:static inset-0 z-20 md:z-auto flex flex-col">
                    <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3 flex-shrink-0">
                        <div className="flex items-center gap-3">
                            <button 
                                onClick={() => setSelectedLog(null)} 
                                className="p-1.5 hover:bg-slate-800 rounded bg-slate-800 border border-slate-700 text-slate-400 hover:text-white transition-colors flex items-center gap-1"
                            >
                                <ArrowLeft size={16}/>
                                <span className="text-xs font-bold">返回列表</span>
                            </button>
                            <h3 className="font-bold text-white flex items-center gap-2"><Activity size={16} className="text-indigo-400"/>交易全过程审计</h3>
                        </div>
                        <button onClick={() => setSelectedLog(null)} className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"><X size={16}/></button>
                    </div>
                    
                    <div className="space-y-4 text-sm flex-1 overflow-y-auto pr-1 custom-scrollbar">
                        {/* 1. Timeline of Events (The requested Full Record) */}
                        <div className="bg-slate-950/50 rounded-lg border border-slate-800 p-3 mb-4">
                            <h4 className="text-[10px] uppercase text-indigo-400 font-black mb-3 tracking-widest flex items-center gap-2">
                                <History size={12}/> 交易生命周期纪录 (由主仓位归档)
                            </h4>
                            <div className="space-y-0.5 relative before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-px before:bg-slate-800">
                                {Array.isArray(selectedLog?.events) && selectedLog.events.length > 0 ? (
                                    selectedLog.events.map((ev, idx) => (
                                        <div key={idx} className="relative pl-6 py-2 group hover:bg-slate-800/20 rounded transition-colors">
                                            <div className={`absolute left-0 top-[11px] w-[15px] h-[15px] rounded-full border-2 border-slate-900 z-10 ${
                                                ev.action.includes('对冲') ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]' : 
                                                ev.action.includes('开仓') ? 'bg-emerald-500' : 
                                                ev.action.includes('减仓') ? 'bg-purple-500' :
                                                ev.action.includes('补回') ? 'bg-amber-500' :
                                                'bg-red-500'
                                            }`}></div>
                                            <div className="flex flex-col">
                                                <div className="flex items-center justify-between">
                                                    <span className="font-bold text-slate-200 text-xs">
                                                        {ev.action} 
                                                        {ev.pnl !== undefined && (
                                                            <span className={`ml-2 text-[10px] ${ev.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                                (实现: {ev.pnl > 0 ? '+' : ''}{ev.pnl.toFixed(2)} U)
                                                            </span>
                                                        )}
                                                    </span>
                                                    <span className="text-[10px] text-slate-500 font-mono">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                                                </div>
                                                <div className="flex items-center gap-3 mt-1">
                                                    <span className="text-[10px] text-slate-400 flex items-center gap-1">
                                                        <Banknote size={10} className="text-slate-600"/> {ev.price.toFixed(4)}
                                                    </span>
                                                    <span className="text-[10px] text-slate-400 flex items-center gap-1">
                                                        <PieChart size={10} className="text-slate-600"/> {ev.amount.toFixed(4)}
                                                    </span>
                                                </div>
                                                <p className="text-[10px] text-slate-500 mt-1 italic border-l border-slate-800 pl-2">依据: {ev.reason}</p>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-center py-6">
                                        <AlertCircle size={24} className="mx-auto text-slate-700 mb-2 opacity-50"/>
                                        <p className="text-xs text-slate-600">该记录无子事件详情 (可能是历史旧记录)</p>
                                        <button 
                                            onClick={() => {
                                                // Try to find related logs manually for old records
                                                const related = tradeLogs.filter(l => l.symbol === selectedLog.symbol && (l.main_entry_id === selectedLog.entry_id || l.entry_id === selectedLog.main_entry_id));
                                                if (related.length > 0) {
                                                    handleSearchChange(selectedLog.symbol);
                                                    setSelectedLog(null);
                                                    handleFilterChange('ALL');
                                                }
                                            }}
                                            className="mt-2 text-[10px] text-indigo-400 hover:underline"
                                        >
                                            尝试在流水中查找关联币种记录
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 bg-slate-800/30 p-2 rounded border border-slate-700">
                            <div><span className="text-xs text-slate-500 block mb-1">开仓时间</span><p className="font-mono text-slate-300 text-xs">{new Date(selectedLog.entry_timestamp).toLocaleString()}</p></div>
                            <div><span className="text-xs text-slate-500 block mb-1">平仓时间</span><p className="font-mono text-slate-300 text-xs">{selectedLog.exit_timestamp ? new Date(selectedLog.exit_timestamp).toLocaleString() : '持仓中'}</p></div>
                        </div>
                        <div><span className="text-xs text-slate-500 uppercase">交易 ID</span><p className="font-mono text-slate-400 text-xs break-all">{selectedLog.entry_id}</p></div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <span className="text-xs text-slate-500">币种</span>
                                <div className="flex items-center gap-2">
                                    <p className="font-bold text-white text-lg">{selectedLog.symbol}</p>
                                    {!!selectedLog.main_entry_id && <span className="text-[10px] text-blue-400 border border-blue-500/30 px-1 rounded">对冲</span>}
                                    {!!selectedLog.parent_entry_id && <span className="text-[10px] text-purple-400 border border-purple-500/30 px-1 rounded">减仓</span>}
                                    <button 
                                        onClick={() => onOpenChart?.(selectedLog.symbol, selectedLog.entry_price, selectedLog.entry_timestamp, selectedLog.timeframe)}
                                        className="p-1.5 bg-slate-800 hover:bg-indigo-600 text-slate-400 hover:text-white rounded transition-colors flex items-center gap-1"
                                    >
                                        <BarChart2 size={14} />
                                        <span className="text-[10px] font-bold">查看K线</span>
                                    </button>
                                </div>
                            </div>
                            <div><span className="text-xs text-slate-500">方向</span><div className={`flex items-center gap-1 font-bold ${selectedLog.direction === PositionSide.LONG ? 'text-emerald-400' : 'text-red-400'}`}>{selectedLog.direction === PositionSide.LONG ? <TrendingUp size={16}/> : <TrendingDown size={16}/>}{selectedLog.direction === PositionSide.LONG ? '多' : '空'}</div></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 bg-slate-800/50 p-2 rounded">
                             <div><span className="text-xs text-slate-500">开仓均价</span><p className="font-mono text-white">{selectedLog.entry_price.toFixed(8)}</p></div>
                             <div><span className="text-xs text-slate-500">平仓价</span><p className="font-mono text-white">{selectedLog.exit_price?.toFixed(8) || '-'}</p></div>
                        </div>
                        {selectedLog.status === 'CLOSED' && (
                            <div className="grid grid-cols-2 gap-4 bg-slate-800/50 p-2 rounded border border-slate-700">
                                <div>
                                    <span className="text-xs text-slate-500">单笔盈亏</span>
                                    <p className={`font-mono font-bold ${selectedLog.profit_usdt && selectedLog.profit_usdt >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {selectedLog.profit_usdt && selectedLog.profit_usdt >= 0 ? '+' : ''}{selectedLog.profit_usdt?.toFixed(2) || '0.00'} U
                                    </p>
                                </div>
                                {activeFilter === 'RECOVERY' && recoveryStats.map.has(selectedLog.symbol) && (
                                    <div>
                                        <span className="text-xs text-indigo-300">最终解套净赚</span>
                                        <p className={`font-mono font-bold ${recoveryStats.map.get(selectedLog.symbol)!.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {recoveryStats.map.get(selectedLog.symbol)!.netProfit >= 0 ? '+' : ''}{recoveryStats.map.get(selectedLog.symbol)!.netProfit.toFixed(2)} U
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}
                        <div className="bg-slate-800/30 p-2 rounded border border-slate-700">
                            <span className="text-xs text-slate-500 block mb-1">开仓原因</span>
                            <p className="text-sm text-slate-300">
                                {selectedLog.signal_details ? (
                                    typeof selectedLog.signal_details === 'string' 
                                        ? selectedLog.signal_details 
                                        : selectedLog.signal_details.reason || selectedLog.signal_details.type || '系统信号触发'
                                ) : '系统信号触发'}
                            </p>
                        </div>
                        {selectedLog.status === 'CLOSED' && (
                            <div className="bg-slate-800/30 p-2 rounded border border-slate-700">
                                <span className="text-xs text-slate-500 block mb-1">平仓原因</span>
                                <p className="text-sm text-slate-300">{selectedLog.exit_reason || '手动平仓'}</p>
                            </div>
                        )}
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