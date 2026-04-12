import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { ScannerSettings, PositionSide, Position, KLine } from '../types';
import { 
    X, Crosshair, Minus, Activity, Maximize2, 
    Play, Square, Download, Settings, History, Zap, Clock, Loader2 
} from 'lucide-react';
import { audioService } from '../services/audioService';
import KlineChartModal from './KlineChartModal';
import { ErrorBoundary } from './ErrorBoundary';
import { usePersistedState } from '../hooks/usePersistedState';

// --- ALL ATOMIC MODULES ---
import { MarketScannerModule } from '../modules/market-scanner';
import { GrandCrossingModule } from '../modules/grand-crossing';
import { StructureAuditModule } from '../modules/structure-audit';
import { MomentumAuditModule } from '../modules/momentum-audit';
import { LiveBattlefieldModule } from '../modules/live-battlefield';
import { TacticalCommandModule } from '../modules/tactical-command';

// --- MIRRORED MODULES ---
import { BacktestGrandCrossingModule } from '../modules/backtester/mirrored/BacktestGrandCrossingUI';
import { BacktestStructureAuditModule } from '../modules/backtester/mirrored/BacktestStructureAuditUI';
import { BacktestMomentumAuditModule } from '../modules/backtester/mirrored/BacktestMomentumAuditUI';

import { ScannerItem, ActionConfig, List3Config, ScanConfig } from './Scanner/scannerTypes';
import { backtestDownloader } from '../services/backtest/downloader';
import { backtestDb } from '../services/backtest/db';
import { BacktestProvider, useBacktest } from '../modules/backtester/BacktestContext';

interface Props {
    settings: ScannerSettings;
    isVisible: boolean;
    onClose: () => void;
    onOpenPosition: (symbol: string, side: PositionSide, amount: number, price: number, signalTf?: string, signalCandle?: any, entryEmas?: any) => void;
    onClosePosition: (symbol: string, side: PositionSide) => void;
    realPrices: Record<string, number>;
    activePositions: Position[];
    balance: number; 
    directMode?: boolean;
    onLog?: (type: 'INFO' | 'SUCCESS' | 'WARNING' | 'DANGER', message: string) => void;
    logs?: any[];
    onBacktestPositionsUpdate?: (positions: Position[]) => void;
}

const ScannerDashboardInner: React.FC<Props & { setBacktestKlines: (map: Record<string, Record<string, KLine[]>>) => void }> = ({ 
  settings, isVisible, onClose, onOpenPosition, onClosePosition, 
  realPrices: livePrices = {}, activePositions: livePositions = [], 
  balance: liveBalance = 0, directMode = false, onLog, logs = [], setBacktestKlines,
  onBacktestPositionsUpdate
}) => {
  
  const {
    virtualTime, setVirtualTime,
    isPlaying, setIsPlaying,
    speed, setSpeed,
    currentIndex, setCurrentIndex,
    totalSteps,
    setAccount,
    setPositions,
    setLogs,
    setTradeLogs,
    account: backtestAccount,
    positions: backtestPositions,
    klinesMap,
    realPrices: backtestPrices
  } = useBacktest();

  // --- UI STATE ---
  const [isMinimized, setIsMinimized] = useState(false);
  const [showLogPanel, setShowLogPanel] = useState(true);
  const [chartData, setChartData] = useState<any>(null);
  const [scannerMode, setScannerMode] = usePersistedState<'LIVE' | 'BACKTEST'>('SCANNER_GLOBAL_MODE', 'LIVE');

  const lastPositionsRef = useRef<string>('');

  useEffect(() => {
    if (onBacktestPositionsUpdate) {
      const currentPositions = scannerMode === 'BACKTEST' ? backtestPositions : [];
      const posStr = JSON.stringify(currentPositions);
      if (posStr !== lastPositionsRef.current) {
        onBacktestPositionsUpdate(currentPositions);
        lastPositionsRef.current = posStr;
      }
    }
  }, [backtestPositions, scannerMode, onBacktestPositionsUpdate]);

  // --- GLOBAL SCANNER CONFIG ---
  const [activeMode, setActiveMode] = usePersistedState<'24H' | '8AM'>('SCANNER_ACTIVE_MODE', '24H');
  const [config24H, setConfig24H] = usePersistedState<ScanConfig>('SCANNER_CONFIG_24H', { timeBasis: '24H', source: 'BOTH', minVolume: 1, maxVolume: 0, minChange: 1, customSymbols: '', useCustomOnly: false, batchSize: 40, limit: 520 });
  const [config8AM, setConfig8AM] = usePersistedState<ScanConfig>('SCANNER_CONFIG_8AM', { timeBasis: '8AM', source: 'GAINERS', minVolume: 1, maxVolume: 0, minChange: 1, customSymbols: '', useCustomOnly: false, batchSize: 40, limit: 520 });
  
  const scanConfig = useMemo(() => activeMode === '24H' ? config24H : config8AM, [activeMode, config24H, config8AM]);

  // --- BACKTEST SPECIFIC STATE ---
  const [backtestIntervals, setBacktestIntervals] = usePersistedState<string[]>('SCANNER_BACKTEST_INTERVALS', ['1m', '5m', '15m', '1h']);
  const [syncProgress, setSyncProgress] = useState<{current: number, total: number, percent: number} | null>(null);
  
  // --- DOWNLOAD STATE ---
  const [downloadRange, setDownloadRange] = useState({
      start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      end: new Date().toISOString().split('T')[0]
  });
  const [isDownloading, setIsDownloading] = useState(false);

  // --- TICK LOGIC ---
  const timerRef = useRef<any>(null);
  const symbols = Object.keys(klinesMap);
  const baseInterval = symbols.length > 0 ? Object.keys(klinesMap[symbols[0]]).sort()[0] : '1m';
  const baseKlines = symbols.length > 0 ? klinesMap[symbols[0]][baseInterval] : [];

  const handleTick = useCallback(() => {
      setCurrentIndex(prev => {
          if (prev >= totalSteps - 1) {
              setIsPlaying(false);
              return prev;
          }
          const next = Math.min(prev + speed, totalSteps - 1);
          const timestamp = baseKlines[next].time;
          setVirtualTime(timestamp);
          return next;
      });
  }, [speed, totalSteps, baseKlines, setIsPlaying, setVirtualTime, setCurrentIndex]);

  useEffect(() => {
      if (isPlaying && scannerMode === 'BACKTEST') {
          timerRef.current = setInterval(handleTick, 100);
      } else {
          clearInterval(timerRef.current);
      }
      return () => clearInterval(timerRef.current);
  }, [isPlaying, handleTick, scannerMode]);

  const handleStartBacktest = useCallback(async (symbolsToBacktest: string[]) => {
      if (symbolsToBacktest.length === 0) return;
      
      setSyncProgress({ current: 0, total: symbolsToBacktest.length, percent: 0 });
      
      try {
          const endTs = Date.now();
          const startTs = endTs - 7 * 24 * 60 * 60 * 1000; // 7 days
          const downloadStartTs = startTs - 24 * 60 * 60 * 1000; // Extra 24h for indicator warmup
          
          await backtestDb.init();

          // 1. Parallel Sync Data with Concurrency Limit
          const CONCURRENCY_LIMIT = 5;
          const chunks: string[][] = [];
          for (let i = 0; i < symbolsToBacktest.length; i += CONCURRENCY_LIMIT) {
              chunks.push(symbolsToBacktest.slice(i, i + CONCURRENCY_LIMIT));
          }

          let completedCount = 0;
          for (const chunk of chunks) {
              await Promise.all(chunk.map(async (symbol) => {
                  // Parallelize intervals for each symbol too
                  await Promise.all(backtestIntervals.map(interval => 
                      backtestDownloader.downloadHistoricalData(symbol, interval, downloadStartTs, endTs, undefined, directMode)
                  ));
                  completedCount++;
                  setSyncProgress({ 
                      current: completedCount, 
                      total: symbolsToBacktest.length, 
                      percent: Math.round((completedCount / symbolsToBacktest.length) * 100) 
                  });
              }));
          }

          // 2. Load into Memory for Provider
          const newMap: Record<string, Record<string, KLine[]>> = {};
          for (const symbol of symbolsToBacktest) {
              newMap[symbol] = {};
              for (const interval of backtestIntervals) {
                  const data = await backtestDb.getKLines(symbol, interval, downloadStartTs, endTs);
                  if (data.length > 0) newMap[symbol][interval] = data;
              }
          }

          setBacktestKlines(newMap);
          setSyncProgress({ current: symbolsToBacktest.length, total: symbolsToBacktest.length, percent: 100 });
          setTimeout(() => setSyncProgress(null), 1000);

          // 3. Reset Backtest State
          // Find the first kline that is >= startTs to be the actual start
          const baseKlinesForSteps = newMap[symbolsToBacktest[0]]?.[backtestIntervals.sort()[0]] || [];
          const startIdx = baseKlinesForSteps.findIndex(k => k.time >= startTs);
          const actualStartIdx = startIdx === -1 ? 0 : startIdx;
          const actualStartTs = baseKlinesForSteps[actualStartIdx]?.time || startTs;

          setCurrentIndex(actualStartIdx);
          setVirtualTime(actualStartTs);
          setIsPlaying(true);
          
          if (onLog) onLog('INFO', `开始回测: ${symbolsToBacktest.join(', ')}`);
      } catch (err) {
          console.error("Backtest failed:", err);
          if (onLog) onLog('DANGER', `回测失败: ${err instanceof Error ? err.message : String(err)}`);
          setSyncProgress(null);
      }
  }, [backtestIntervals, setBacktestKlines, setCurrentIndex, setVirtualTime, setIsPlaying, onLog]);

  const handleStopBacktest = useCallback(() => {
      setIsPlaying(false);
      setSyncProgress(null);
  }, [setIsPlaying]);

  const handleDownloadData = async () => {
      const symbolsToDownload = list1Candidates.length > 0 
          ? list1Candidates.map(c => c.symbol) 
          : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
      
      setIsDownloading(true);
      const startMs = new Date(downloadRange.start).getTime();
      const endMs = new Date(downloadRange.end).getTime();
      
      try {
          for (const symbol of symbolsToDownload) {
              for (const interval of backtestIntervals) {
                  if (onLog) onLog('INFO', `正在下载 ${symbol} ${interval} 数据...`);
                  await backtestDownloader.downloadHistoricalData(
                      symbol, 
                      interval, 
                      startMs, 
                      endMs, 
                      (p) => setSyncProgress({ current: p, total: 100, percent: Math.round(p) }),
                      directMode
                  );
              }
          }
          if (onLog) onLog('SUCCESS', '历史数据下载完成！');
      } catch (err) {
          if (onLog) onLog('DANGER', `下载失败: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
          setIsDownloading(false);
          setSyncProgress(null);
      }
  };

  // --- DATA PIPELINE STATE ---
  const [list1Candidates, setList1Candidates] = useState<ScannerItem[]>([]);
  const [list2Results, setList2Results] = useState<ScannerItem[]>([]);
  const [list3Results, setList3Results] = useState<ScannerItem[]>([]);
  const [list3Config, setList3Config] = useState<List3Config | null>(null);
  const [liveStats, setLiveStats] = useState({ symbolCount: 0, totalValue: 0, totalPnl: 0 });
  const [actionConfig, setActionConfig] = useState<ActionConfig | null>(null);

  const removeSignalRef = useRef<((uniqueId: string) => void) | undefined>(undefined);

  // --- SWITCH DATA SOURCES BASED ON MODE ---
  const currentPrices = scannerMode === 'BACKTEST' ? backtestPrices : livePrices; // Mirrored modules use BacktestContext for prices
  const currentPositions = scannerMode === 'BACKTEST' ? backtestPositions : livePositions;
  const currentBalance = scannerMode === 'BACKTEST' ? backtestAccount.marginBalance : liveBalance;

  const executeTradeSafe = useCallback((symbol: string, side: PositionSide, price: number, reason: string, signalTf?: string, signalCandle?: any, entryEmas?: any) => {
      if (!actionConfig) return;
      
      const activePositions = scannerMode === 'BACKTEST' ? backtestPositions : livePositions;
      const balance = scannerMode === 'BACKTEST' ? backtestAccount.marginBalance : liveBalance;

      const currentSymbolCount = new Set(activePositions.map(p => p.symbol)).size;
      if (currentSymbolCount >= actionConfig.maxOpenSymbols) return;

      const amount = actionConfig.positionSizeMode === 'VARIABLE' 
          ? Math.min(balance * (actionConfig.variablePercentage / 100), actionConfig.variableMaxLimit || Infinity)
          : (actionConfig.openAmount || 100);
      
      // List 6: Total Capital Limit Check
      const currentTotalValue = activePositions.reduce((sum, p) => {
          const price = currentPrices[p.symbol] || p.markPrice || p.entryPrice;
          return sum + (p.amount * price);
      }, 0);
      
      if (actionConfig.maxTotalValue > 0 && (currentTotalValue + amount) > actionConfig.maxTotalValue) {
          if (onLog) onLog('WARNING', `交易拦截: 总资金上限已达 (${currentTotalValue.toFixed(1)} + ${amount.toFixed(1)} > ${actionConfig.maxTotalValue})`);
          return;
      }
      
      if (scannerMode === 'BACKTEST') {
          const newPos: Position = {
              symbol, side, amount, entryPrice: price, markPrice: price,
              unrealizedPnL: 0, unrealizedPnLPercentage: 0, entryTime: virtualTime,
              isHedged: false, liquidationPrice: side === 'LONG' ? price * 0.95 : price * 1.05,
              entryId: Date.now().toString(),
              isBacktestRecord: true,
              backtestEntryTime: virtualTime
          };
          setPositions(prev => [...prev, newPos]);
          if (onLog) onLog('SUCCESS', `[回测] 开仓成功: ${symbol} ${side} @ ${price}`);
      } else {
          onOpenPosition(symbol, side, amount, price, signalTf, signalCandle, entryEmas);
          audioService.speak("自动开仓执行");
          if (onLog) onLog('SUCCESS', `执行交易: ${symbol} ${side} | 原因: ${reason}`);
      }
  }, [actionConfig, scannerMode, backtestPositions, livePositions, backtestAccount.marginBalance, liveBalance, virtualTime, setPositions, onLog, onOpenPosition]);

  const handleClosePositionInternal = useCallback((symbol: string, side: PositionSide) => {
      if (scannerMode === 'BACKTEST') {
          setPositions(prev => {
              const pos = prev.find(p => p.symbol === symbol && p.side === side);
              if (pos) {
                  const pnl = pos.unrealizedPnL;
                  setAccount(acc => ({
                      ...acc,
                      totalBalance: acc.totalBalance + pnl,
                      marginBalance: acc.marginBalance + pnl
                  }));
                  setTradeLogs(logs => [...logs, {
                      symbol, side, entryPrice: pos.entryPrice, exitPrice: pos.markPrice,
                      pnl, pnlPercent: pos.unrealizedPnLPercentage, exitTime: virtualTime,
                      reason: 'MANUAL'
                  } as any]);
              }
              return prev.filter(p => !(p.symbol === symbol && p.side === side));
          });
      } else {
          onClosePosition(symbol, side);
      }
  }, [scannerMode, setPositions, setAccount, setTradeLogs, virtualTime, onClosePosition]);

  const setScanConfig = useCallback((update: React.SetStateAction<ScanConfig>) => {
      const next = typeof update === 'function' ? (update as any)(scanConfig) : update;
      if (next.timeBasis !== activeMode) setActiveMode(next.timeBasis as any);
      else activeMode === '24H' ? setConfig24H(next) : setConfig8AM(next);
  }, [scanConfig, activeMode, setActiveMode, setConfig24H, setConfig8AM]);

  const safeSetChartData = useCallback((newData: any) => {
      setChartData(newData);
  }, []);

  useEffect(() => {
      if (isVisible) setIsMinimized(false);
  }, [isVisible]);

  const containerStyle: React.CSSProperties = {
      display: isVisible ? 'block' : 'none'
  };

  return (
      <div style={containerStyle}>
          {/* Minimized View */}
          <div 
              className={`fixed bottom-6 right-6 transition-opacity duration-300 ${isMinimized ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
              style={{ zIndex: 100 }}
              onClick={() => setIsMinimized(false)}
          >
              <div className="bg-[#0b0e11] border border-slate-700 rounded-lg shadow-2xl p-3 flex items-center gap-3 cursor-pointer hover:border-indigo-500 hover:shadow-indigo-500/20 transition-all">
                  <Activity size={20} className="text-indigo-400 animate-pulse" />
                  <div className="text-xs font-bold text-white">{scannerMode === 'BACKTEST' ? '回测引擎运行中' : '扫描终端运行中'}</div>
                  <Maximize2 size={16} className="text-slate-500"/>
              </div>
          </div>

          {/* Full View */}
          <div className={`fixed inset-0 bg-black/90 backdrop-blur-sm items-center justify-center p-4 ${isMinimized ? 'hidden' : 'flex'}`} style={{ zIndex: 100 }}>
              <div className="bg-[#0b0e11] w-full h-full max-w-[1800px] rounded-xl border border-slate-800 shadow-2xl flex flex-col overflow-hidden">
                  {/* Top Bar */}
                  <div className={`flex items-center justify-between p-3 border-b border-slate-800 transition-colors ${scannerMode === 'BACKTEST' ? 'bg-amber-950/30' : 'bg-[#161a25]'}`}>
                      <div className="flex items-center gap-4">
                          <h2 className="text-lg font-bold text-white flex items-center gap-2">
                            <Crosshair size={20} className={scannerMode === 'BACKTEST' ? 'text-amber-500' : 'text-indigo-500'}/> 
                            {scannerMode === 'BACKTEST' ? '回测模式终端 (BACKTEST)' : '全域扫描终端 (SCANNER)'}
                          </h2>
                          
                          <div className="flex bg-slate-800/50 p-0.5 rounded-lg border border-slate-700 ml-4">
                              <button 
                                onClick={() => setScannerMode('LIVE')}
                                className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all flex items-center gap-1.5 ${scannerMode === 'LIVE' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
                              >
                                <Zap size={10} /> 实盘模式
                              </button>
                              <button 
                                onClick={() => setScannerMode('BACKTEST')}
                                className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all flex items-center gap-1.5 ${scannerMode === 'BACKTEST' ? 'bg-amber-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
                              >
                                <History size={10} /> 回测模式
                              </button>
                          </div>

                          {scannerMode === 'BACKTEST' && (
                            <div className="flex items-center gap-4 ml-4 px-4 border-l border-slate-700 animate-in fade-in slide-in-from-left-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-slate-500 font-bold">速度:</span>
                                    <select 
                                        value={speed} 
                                        onChange={(e) => setSpeed(Number(e.target.value))}
                                        className="bg-slate-800 border border-slate-700 text-[10px] text-white rounded px-1 py-0.5 outline-none"
                                    >
                                        <option value={1}>1x</option>
                                        <option value={5}>5x</option>
                                        <option value={20}>20x</option>
                                        <option value={100}>100x</option>
                                    </select>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-slate-500 font-bold">周期:</span>
                                    <div className="flex gap-1">
                                        {['1m', '5m', '15m', '1h'].map(tf => (
                                            <button 
                                                key={tf}
                                                onClick={() => {
                                                    setBacktestIntervals(prev => prev.includes(tf) ? prev.filter(t => t !== tf) : [...prev, tf]);
                                                }}
                                                className={`text-[9px] px-1.5 py-0.5 rounded border transition-all ${backtestIntervals.includes(tf) ? 'bg-amber-600/20 border-amber-500 text-amber-400' : 'bg-slate-800 border-slate-700 text-slate-500'}`}
                                            >
                                                {tf}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button 
                                        onClick={() => isPlaying ? handleStopBacktest() : handleStartBacktest(list1Candidates.map(c => c.symbol))}
                                        className={`px-4 py-1 rounded text-[10px] font-bold flex items-center gap-1.5 transition-all ${isPlaying ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}
                                    >
                                        {isPlaying ? <Square size={10} fill="currentColor" /> : <Play size={10} fill="currentColor" />}
                                        {isPlaying ? '停止回测' : '开始回测'}
                                    </button>
                                </div>

                                <div className="flex items-center gap-2 ml-4 pl-4 border-l border-slate-700">
                                    <span className="text-[10px] text-slate-500 font-bold">下载范围:</span>
                                    <input 
                                        type="date" 
                                        value={downloadRange.start || ''}
                                        onChange={(e) => setDownloadRange(prev => ({ ...prev, start: e.target.value }))}
                                        className="bg-slate-800 border border-slate-700 text-[10px] text-white rounded px-1 py-0.5 outline-none"
                                    />
                                    <span className="text-slate-500 text-[10px]">-</span>
                                    <input 
                                        type="date" 
                                        value={downloadRange.end || ''}
                                        onChange={(e) => setDownloadRange(prev => ({ ...prev, end: e.target.value }))}
                                        className="bg-slate-800 border border-slate-700 text-[10px] text-white rounded px-1 py-0.5 outline-none"
                                    />
                                    <button 
                                        onClick={handleDownloadData}
                                        disabled={isDownloading}
                                        className={`p-1.5 rounded transition-all ${isDownloading ? 'bg-slate-700 text-slate-500' : 'bg-amber-600/20 text-amber-500 hover:bg-amber-600/30 border border-amber-500/30'}`}
                                        title="下载历史数据"
                                    >
                                        {isDownloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                                    </button>
                                </div>
                                {syncProgress && (
                                    <div className="flex items-center gap-2 text-[10px]">
                                        <Loader2 size={12} className="animate-spin text-amber-500" />
                                        <span className="text-amber-500 font-bold">同步中: {syncProgress.percent}%</span>
                                    </div>
                                )}
                                {isPlaying && (
                                    <div className="flex items-center gap-2 text-[10px] border-l border-slate-700 pl-4">
                                        <Clock size={12} className="text-amber-500" />
                                        <span className="text-slate-300 font-mono">{new Date(virtualTime).toLocaleString()}</span>
                                    </div>
                                )}
                            </div>
                          )}
                      </div>
                      <div className="flex items-center gap-3">
                          <button 
                            onClick={() => setShowLogPanel(!showLogPanel)} 
                            className={`p-2 rounded transition-colors ${showLogPanel ? 'bg-indigo-600/20 text-indigo-400' : 'hover:bg-slate-800 text-slate-400 hover:text-white'}`}
                            title="切换日志面板"
                          >
                            <Activity size={20}/>
                          </button>
                          <button onClick={() => setIsMinimized(true)} className="p-2 hover:bg-slate-800 rounded text-slate-400 hover:text-white"><Minus size={20}/></button>
                          <button onClick={onClose} className="p-2 hover:bg-red-900/50 rounded text-slate-400 hover:text-white"><X size={20}/></button>
                      </div>
                  </div>

                  <div className="flex-1 flex overflow-x-auto overflow-y-hidden bg-[#0b0e11] scrollbar-thin scrollbar-thumb-slate-800">
                      
                      <ErrorBoundary moduleName="1. 市场初筛">
                          <MarketScannerModule 
                              onCandidatesUpdate={setList1Candidates} 
                              setChartData={safeSetChartData}
                              directMode={directMode}
                              scanConfig={scanConfig}
                              setScanConfig={setScanConfig}
                              mode={scannerMode}
                              onStartBacktest={handleStartBacktest}
                              isSyncing={!!syncProgress}
                          />
                      </ErrorBoundary>

                      <ErrorBoundary moduleName="2. 均线穿越">
                          {scannerMode === 'BACKTEST' ? (
                              <BacktestGrandCrossingModule 
                                  candidates={list1Candidates} 
                                  onResultsUpdate={setList2Results}
                                  scanConfig={scanConfig}
                                  setScanConfig={setScanConfig}
                                  setChartData={safeSetChartData}
                                  directMode={directMode}
                                  onLog={onLog}
                              />
                          ) : (
                              <GrandCrossingModule 
                                  candidates={list1Candidates} 
                                  onResultsUpdate={setList2Results}
                                  scanConfig={scanConfig}
                                  setScanConfig={setScanConfig}
                                  setChartData={safeSetChartData}
                                  directMode={directMode}
                                  onLog={onLog}
                              />
                          )}
                      </ErrorBoundary>

                      <ErrorBoundary moduleName="3. 结构审计">
                          {scannerMode === 'BACKTEST' ? (
                              <BacktestStructureAuditModule 
                                  candidates={list2Results}
                                  onResultsUpdate={setList3Results}
                                  onConfigUpdate={setList3Config}
                                  onRemoveSignalReady={(fn) => { removeSignalRef.current = fn; }}
                                  realPrices={currentPrices}
                                  setChartData={safeSetChartData}
                                  executeTradeSafe={executeTradeSafe}
                                  activePositions={currentPositions}
                                  directMode={directMode}
                              />
                          ) : (
                              <StructureAuditModule 
                                  candidates={list2Results}
                                  onResultsUpdate={setList3Results}
                                  onConfigUpdate={setList3Config}
                                  onRemoveSignalReady={(fn) => { removeSignalRef.current = fn; }}
                                  realPrices={currentPrices}
                                  setChartData={safeSetChartData}
                                  executeTradeSafe={executeTradeSafe}
                                  activePositions={currentPositions}
                                  directMode={directMode}
                              />
                          )}
                      </ErrorBoundary>

                      <ErrorBoundary moduleName="4. 动能审计">
                          {scannerMode === 'BACKTEST' ? (
                              <BacktestMomentumAuditModule 
                                  candidates={list3Results}
                                  setChartData={safeSetChartData}
                                  executeTradeSafe={executeTradeSafe}
                                  list3Config={list3Config}
                                  realPrices={currentPrices}
                                  activePositions={currentPositions}
                                  onRemoveSignal={(id) => removeSignalRef.current?.(id)}
                              />
                          ) : (
                              <MomentumAuditModule 
                                  candidates={list3Results}
                                  setChartData={safeSetChartData}
                                  executeTradeSafe={executeTradeSafe}
                                  list3Config={list3Config}
                                  realPrices={currentPrices}
                                  activePositions={currentPositions}
                                  onRemoveSignal={(id) => removeSignalRef.current?.(id)}
                              />
                          )}
                      </ErrorBoundary>

                      <ErrorBoundary moduleName="5. 战场实况">
                          <LiveBattlefieldModule 
                              positions={currentPositions}
                              realPrices={currentPrices}
                              setChartData={safeSetChartData}
                              onClosePosition={handleClosePositionInternal}
                              onStatsUpdate={setLiveStats}
                          />
                      </ErrorBoundary>

                      <ErrorBoundary moduleName="6. 战术终端">
                          <TacticalCommandModule 
                              currentStats={liveStats}
                              onConfigUpdate={setActionConfig}
                              onPanicSell={() => currentPositions.forEach(p => handleClosePositionInternal(p.symbol, p.side))} 
                              onSecureProfit={() => currentPositions.filter(p => p.unrealizedPnL > 0).forEach(p => handleClosePositionInternal(p.symbol, p.side))}
                              onCutLosses={() => currentPositions.filter(p => p.unrealizedPnL < 0).forEach(p => handleClosePositionInternal(p.symbol, p.side))} 
                              onCloseLongs={() => currentPositions.filter(p => p.side === PositionSide.LONG).forEach(p => handleClosePositionInternal(p.symbol, p.side))} 
                              onCloseShorts={() => currentPositions.filter(p => p.side === PositionSide.SHORT).forEach(p => handleClosePositionInternal(p.symbol, p.side))}
                          />
                      </ErrorBoundary>
                  </div>

                  {/* Bottom Log Panel */}
                  {showLogPanel && (
                    <div className="h-32 border-t border-slate-800 bg-[#0b0e11] flex flex-col overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-1 bg-slate-900/50 border-b border-slate-800">
                            <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1.5">
                                <Activity size={10} /> 系统运行日志
                            </span>
                            <button onClick={() => setShowLogPanel(false)} className="text-slate-500 hover:text-white transition-colors">
                                <X size={12} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 font-mono text-[10px] space-y-1 scrollbar-thin scrollbar-thumb-slate-800">
                            {logs.length === 0 ? (
                                <div className="text-slate-600 italic">暂无日志记录...</div>
                            ) : (
                                logs.map((log, i) => (
                                    <div key={log.id || i} className="flex gap-2 animate-in fade-in slide-in-from-left-1">
                                        <span className="text-slate-500 shrink-0">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                                        <span className={`font-bold shrink-0 ${
                                            log.type === 'SUCCESS' ? 'text-emerald-500' :
                                            log.type === 'DANGER' ? 'text-red-500' :
                                            log.type === 'WARNING' ? 'text-amber-500' :
                                            'text-blue-400'
                                        }`}>
                                            [{log.type}]
                                        </span>
                                        <span className="text-slate-300 break-all">{log.message}</span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                  )}
              </div>
          </div>

          {chartData && (
              <KlineChartModal 
                  key={`${chartData.symbol}-${chartData.tf}`}
                  symbol={chartData.symbol} 
                  initialTimeframe={chartData.tf} 
                  signals={chartData.signals}
                  entryPrice={chartData.entryPrice}
                  entryTime={chartData.entryTime}
                  currentPrice={chartData.currentPrice}
                  list2Config={undefined} 
                  highlightTime={chartData.highlightTime}
                  extraLines={chartData.extraLines}
                  directMode={directMode}
                  onClose={() => setChartData(null)} 
              />
          )}
      </div>
  );
};

export const ScannerDashboard: React.FC<Props> = (props) => {
  const [backtestKlines, setBacktestKlines] = useState<Record<string, Record<string, KLine[]>>>({});
  
  return (
    <BacktestProvider 
      klinesMap={backtestKlines} 
      initialBalance={props.balance} 
      settings={props.settings as any}
    >
      <ScannerDashboardInner {...props} setBacktestKlines={setBacktestKlines} />
    </BacktestProvider>
  );
};
