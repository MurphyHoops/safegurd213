
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { ScannerSettings, PositionSide, Position } from '../../../types';
import { X, Crosshair, Minus, Activity, Maximize2 } from 'lucide-react';
import { usePersistedState } from '../../../hooks/usePersistedState';
import { normalizeSymbol } from '../../../services/symbolUtils';

// --- MIRRORED MODULES ---
import { BacktestMarketScannerModule } from './BacktestScannerUI';
import { BacktestGrandCrossingModule } from './BacktestGrandCrossingUI';
import { BacktestStructureAuditModule } from './BacktestStructureAuditUI';
import { BacktestMomentumAuditModule } from './BacktestMomentumAuditUI';
import { LiveBattlefieldModule } from '../../live-battlefield';
import { TacticalCommandModule } from '../../tactical-command';

import { ScannerItem, ActionConfig, List3Config, ScanConfig } from '../../../components/Scanner/scannerTypes';

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
    isBacktest?: boolean;
}

export const BacktestScannerDashboard: React.FC<Props> = ({ 
    settings, isVisible, onClose, onOpenPosition, onClosePosition, 
    realPrices = {}, activePositions = [], balance = 0, directMode = false, onLog,
    isBacktest = true
}) => {
  
  const [isMinimized, setIsMinimized] = useState(false);
  const [chartData, setChartData] = useState<any>(null);

  const [activeMode, setActiveMode] = usePersistedState<'24H' | '8AM'>('SCANNER_ACTIVE_MODE', '24H');
  const [config24H, setConfig24H] = usePersistedState<ScanConfig>('SCANNER_CONFIG_24H', { timeBasis: '24H', source: 'BOTH', minVolume: 1, maxVolume: 0, minChange: 1, customSymbols: '', useCustomOnly: false, batchSize: 40, limit: 520 });
  const [config8AM, setConfig8AM] = usePersistedState<ScanConfig>('SCANNER_CONFIG_8AM', { timeBasis: '8AM', source: 'GAINERS', minVolume: 1, maxVolume: 0, minChange: 1, customSymbols: '', useCustomOnly: false, batchSize: 40, limit: 520 });
  
  const scanConfig = useMemo(() => activeMode === '24H' ? config24H : config8AM, [activeMode, config24H, config8AM]);

  const setScanConfig = useCallback((update: React.SetStateAction<ScanConfig>) => {
      const next = typeof update === 'function' ? (update as any)(scanConfig) : update;
      if (next.timeBasis !== activeMode) {
          setTimeout(() => setActiveMode(next.timeBasis as any), 0);
      } else {
          activeMode === '24H' ? setConfig24H(next) : setConfig8AM(next);
      }
  }, [scanConfig, activeMode, setActiveMode, setConfig24H, setConfig8AM]);

  const [list1Candidates, setList1Candidates] = useState<ScannerItem[]>([]);
  const [list2Results, setList2Results] = useState<ScannerItem[]>([]);
  const [list3Results, setList3Results] = useState<ScannerItem[]>([]);

  const handleList1Results = useCallback((results: ScannerItem[]) => {
    setList1Candidates(prev => {
        if (JSON.stringify(prev) === JSON.stringify(results)) return prev;
        return results;
    });
  }, []);

  const handleList2Results = useCallback((results: ScannerItem[]) => {
    setList2Results(prev => {
        if (JSON.stringify(prev) === JSON.stringify(results)) return prev;
        return results;
    });
  }, []);

  const handleList3Results = useCallback((results: ScannerItem[]) => {
    setList3Results(prev => {
        if (JSON.stringify(prev) === JSON.stringify(results)) return prev;
        return results;
    });
  }, []);
  const [list3Config, setList3Config] = useState<List3Config | null>(null);
  const [liveStats, setLiveStats] = useState({ symbolCount: 0, totalValue: 0, totalPnl: 0 });
  const liveStatsPulseRef = useRef('');

  const handleLiveStatsUpdate = useCallback((newStats: any) => {
    const pulse = `${newStats.symbolCount}-${newStats.totalPnl.toFixed(4)}`;
    if (liveStatsPulseRef.current !== pulse) {
      setLiveStats(newStats);
      liveStatsPulseRef.current = pulse;
    }
  }, []);

  const [actionConfig, setActionConfig] = useState<ActionConfig | null>(null);
  const removeSignalRef = useRef<((uniqueId: string) => void) | undefined>(undefined);

  const handleRemoveSignalReady = useCallback((fn: (uniqueId: string) => void) => {
    removeSignalRef.current = fn;
  }, []);

  const handleRemoveSignal = useCallback((id: string) => {
    removeSignalRef.current?.(id);
  }, []);

  // --- REFS FOR STABLE CALLBACKS ---
  const actionConfigRef = useRef<ActionConfig | null>(null);
  const activePositionsRef = useRef<Position[]>([]);
  const balanceRef = useRef<number>(0);
  const realPricesRef = useRef<Record<string, number>>({});

  useEffect(() => { actionConfigRef.current = actionConfig; }, [actionConfig]);
  useEffect(() => { activePositionsRef.current = activePositions; }, [activePositions]);
  useEffect(() => { balanceRef.current = balance; }, [balance]);
  useEffect(() => { realPricesRef.current = realPrices; }, [realPrices]);

  const executeTradeSafe = useCallback((symbol: string, side: PositionSide, price: number, reason: string, signalTf?: string, signalCandle?: any, entryEmas?: any) => {
      const DEFAULT_ACTION_CONFIG: ActionConfig = { 
          enabled: true, 
          openAmount: 100, 
          maxOpenSymbols: 200, 
          maxTotalValue: 100000, 
          breakoutBuffer: 0.2, 
          autoExecute: true, 
          maxExposurePercent: 95, 
          positionSizeMode: 'FIXED', 
          variablePercentage: 2, 
          variableMaxLimit: 200,
          breakerConfig: {
              enabled: false,
              triggerMinutes: 15,
              minDropPercent: 3,
              minCoinsPercent: 50,
              autoRecoverMinutes: 30
          }
      };

      const userConfig = (actionConfigRef.current || {}) as Partial<ActionConfig>;
      const config: ActionConfig = {
          enabled: typeof userConfig.enabled === 'boolean' ? userConfig.enabled : DEFAULT_ACTION_CONFIG.enabled,
          openAmount: typeof userConfig.openAmount === 'number' && userConfig.openAmount > 0 ? userConfig.openAmount : DEFAULT_ACTION_CONFIG.openAmount,
          maxOpenSymbols: typeof userConfig.maxOpenSymbols === 'number' && userConfig.maxOpenSymbols > 0 ? userConfig.maxOpenSymbols : DEFAULT_ACTION_CONFIG.maxOpenSymbols,
          maxTotalValue: typeof userConfig.maxTotalValue === 'number' ? userConfig.maxTotalValue : DEFAULT_ACTION_CONFIG.maxTotalValue,
          breakoutBuffer: typeof userConfig.breakoutBuffer === 'number' ? userConfig.breakoutBuffer : DEFAULT_ACTION_CONFIG.breakoutBuffer,
          autoExecute: typeof userConfig.autoExecute === 'boolean' ? userConfig.autoExecute : DEFAULT_ACTION_CONFIG.autoExecute,
          maxExposurePercent: typeof userConfig.maxExposurePercent === 'number' && userConfig.maxExposurePercent > 0 ? userConfig.maxExposurePercent : DEFAULT_ACTION_CONFIG.maxExposurePercent,
          positionSizeMode: userConfig.positionSizeMode || DEFAULT_ACTION_CONFIG.positionSizeMode,
          variablePercentage: typeof userConfig.variablePercentage === 'number' ? userConfig.variablePercentage : DEFAULT_ACTION_CONFIG.variablePercentage,
          variableMaxLimit: typeof userConfig.variableMaxLimit === 'number' ? userConfig.variableMaxLimit : DEFAULT_ACTION_CONFIG.variableMaxLimit,
          breakerConfig: userConfig.breakerConfig || DEFAULT_ACTION_CONFIG.breakerConfig,
      };
      if (!config.enabled) {
          if (onLog) onLog('WARNING', `[回测] 交易拦截 (${symbol}): 战术面板总开关 (List 6) 未开启。`);
          return false;
      }
      
      const cleanSymbol = normalizeSymbol(symbol);

      if (!price || isNaN(price) || price <= 0) {
          if (onLog) onLog('DANGER', `[回测] 交易拦截 ${cleanSymbol}: 开仓价格无效 (${price})，拒绝执行。`);
          console.warn(`[Trade Reject - Backtest] Invalid price for ${cleanSymbol}: ${price}`);
          return false;
      }
      
      const currentSymbols = new Set(activePositionsRef.current.map(p => p.symbol));
      const currentSymbolCount = currentSymbols.size;
      if (!currentSymbols.has(cleanSymbol) && currentSymbolCount >= (config.maxOpenSymbols || 200)) {
          if (onLog) onLog('DANGER', `[回测] 交易拦截 ${cleanSymbol}: 持仓币种已达上限 (${currentSymbolCount} >= ${config.maxOpenSymbols})`);
          console.warn(`[Trade Reject - Backtest] Max open symbols limit reached: ${currentSymbolCount} >= ${config.maxOpenSymbols}`);
          return false;
      }

      const amount = config.positionSizeMode === 'VARIABLE' 
          ? Math.min(balanceRef.current * (config.variablePercentage / 100), config.variableMaxLimit || Infinity)
          : (config.openAmount || 100);
      
      onOpenPosition(cleanSymbol, side, amount, price, signalTf, signalCandle, entryEmas);
      if (onLog) onLog('SUCCESS', `[回测] 执行交易: ${cleanSymbol} ${side} | 原因: ${reason}`);
      return true;
  }, [onOpenPosition, onLog]);

  const handlePanicSell = useCallback(() => activePositions.forEach(p => onClosePosition(p.symbol, p.side)), [activePositions, onClosePosition]);
  const handleSecureProfit = useCallback(() => activePositions.filter(p => p.unrealizedPnL > 0).forEach(p => onClosePosition(p.symbol, p.side)), [activePositions, onClosePosition]);
  const handleCutLosses = useCallback(() => activePositions.filter(p => p.unrealizedPnL < 0).forEach(p => onClosePosition(p.symbol, p.side)), [activePositions, onClosePosition]);
  const handleCloseLongs = useCallback(() => activePositions.filter(p => p.side === PositionSide.LONG).forEach(p => onClosePosition(p.symbol, p.side)), [activePositions, onClosePosition]);
  const handleCloseShorts = useCallback(() => activePositions.filter(p => p.side === PositionSide.SHORT).forEach(p => onClosePosition(p.symbol, p.side)), [activePositions, onClosePosition]);

  if (!isVisible) return null;

  return (
      <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 z-[1100]">
          <div className="bg-[#0b0e11] w-full h-full max-w-[1800px] rounded-xl border border-slate-800 shadow-2xl flex flex-col overflow-hidden">
              <div className="flex items-center justify-between p-3 border-b border-slate-800 bg-[#161a25]">
                  <div className="flex items-center gap-4">
                      <h2 className="text-lg font-bold text-white flex items-center gap-2">
                        <Crosshair size={20} className="text-amber-500"/> 
                        历史回测全域扫描终端 (BACKTEST SCANNER)
                      </h2>
                      <div className="flex gap-2 text-[10px] text-slate-500 font-mono"><span>v5.0.1 (Historical Mode)</span></div>
                  </div>
                  <div className="flex items-center gap-3">
                      <button onClick={onClose} className="p-2 hover:bg-red-900/50 rounded text-slate-400 hover:text-white"><X size={20}/></button>
                  </div>
              </div>

              <div className="flex-1 flex overflow-x-auto overflow-y-hidden bg-[#0b0e11] scrollbar-thin scrollbar-thumb-slate-800">
                  <BacktestMarketScannerModule 
                      onCandidatesUpdate={handleList1Results} 
                      setChartData={setChartData}
                      directMode={true}
                      scanConfig={scanConfig}
                      setScanConfig={setScanConfig}
                  />
                  <BacktestGrandCrossingModule 
                      candidates={list1Candidates} 
                      onResultsUpdate={handleList2Results}
                      scanConfig={scanConfig}
                      setScanConfig={setScanConfig}
                      setChartData={setChartData}
                      directMode={true}
                      onLog={onLog}
                  />
                  <BacktestStructureAuditModule 
                      candidates={list2Results}
                      onResultsUpdate={handleList3Results}
                      onConfigUpdate={setList3Config}
                      onRemoveSignalReady={handleRemoveSignalReady}
                      realPrices={realPrices}
                      setChartData={setChartData}
                      executeTradeSafe={executeTradeSafe}
                      activePositions={activePositions}
                      directMode={true}
                      actionConfig={actionConfig}
                      onLog={onLog}
                  />
                  <BacktestMomentumAuditModule 
                      candidates={list3Results}
                      setChartData={setChartData}
                      executeTradeSafe={executeTradeSafe}
                      list3Config={list3Config}
                      realPrices={realPrices}
                      activePositions={activePositions}
                      onRemoveSignal={handleRemoveSignal}
                      actionConfig={actionConfig}
                      onLog={onLog}
                  />
                  <LiveBattlefieldModule 
                      positions={activePositions}
                      realPrices={realPrices}
                      setChartData={setChartData}
                      onClosePosition={onClosePosition}
                      onStatsUpdate={handleLiveStatsUpdate}
                  />
                  <TacticalCommandModule 
                      currentStats={liveStats}
                      onConfigUpdate={setActionConfig}
                      onPanicSell={handlePanicSell} 
                      onSecureProfit={handleSecureProfit}
                      onCutLosses={handleCutLosses} 
                      onCloseLongs={handleCloseLongs} 
                      onCloseShorts={handleCloseShorts}
                  />
              </div>
          </div>
      </div>
  );
};
