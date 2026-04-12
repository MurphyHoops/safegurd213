
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { ScannerSettings, PositionSide, Position } from '../../../types';
import { X, Crosshair, Minus, Activity, Maximize2 } from 'lucide-react';
import { usePersistedState } from '../../../hooks/usePersistedState';

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
      if (next.timeBasis !== activeMode) setActiveMode(next.timeBasis as any);
      else activeMode === '24H' ? setConfig24H(next) : setConfig8AM(next);
  }, [scanConfig, activeMode, setActiveMode, setConfig24H, setConfig8AM]);

  const [list1Candidates, setList1Candidates] = useState<ScannerItem[]>([]);
  const [list2Results, setList2Results] = useState<ScannerItem[]>([]);
  const [list3Results, setList3Results] = useState<ScannerItem[]>([]);
  const [list3Config, setList3Config] = useState<List3Config | null>(null);
  const [liveStats, setLiveStats] = useState({ symbolCount: 0, totalValue: 0, totalPnl: 0 });
  const [actionConfig, setActionConfig] = useState<ActionConfig | null>(null);

  const removeSignalRef = useRef<((uniqueId: string) => void) | undefined>(undefined);

  const executeTradeSafe = useCallback((symbol: string, side: PositionSide, price: number, reason: string, signalTf?: string, signalCandle?: any, entryEmas?: any) => {
      if (!actionConfig) return;
      const currentSymbolCount = new Set(activePositions.map(p => p.symbol)).size;
      if (currentSymbolCount >= actionConfig.maxOpenSymbols) return;

      const amount = actionConfig.positionSizeMode === 'VARIABLE' 
          ? Math.min(balance * (actionConfig.variablePercentage / 100), actionConfig.variableMaxLimit || Infinity)
          : (actionConfig.openAmount || 100);
      
      onOpenPosition(symbol, side, amount, price, signalTf, signalCandle, entryEmas);
      if (onLog) onLog('SUCCESS', `[回测] 执行交易: ${symbol} ${side} | 原因: ${reason}`);
  }, [actionConfig, onOpenPosition, activePositions, balance, onLog]);

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
                      onCandidatesUpdate={setList1Candidates} 
                      setChartData={setChartData}
                      directMode={true}
                      scanConfig={scanConfig}
                      setScanConfig={setScanConfig}
                  />
                  <BacktestGrandCrossingModule 
                      candidates={list1Candidates} 
                      onResultsUpdate={setList2Results}
                      scanConfig={scanConfig}
                      setScanConfig={setScanConfig}
                      setChartData={setChartData}
                      directMode={true}
                      onLog={onLog}
                  />
                  <BacktestStructureAuditModule 
                      candidates={list2Results}
                      onResultsUpdate={setList3Results}
                      onConfigUpdate={setList3Config}
                      onRemoveSignalReady={(fn) => { removeSignalRef.current = fn; }}
                      realPrices={realPrices}
                      setChartData={setChartData}
                      executeTradeSafe={executeTradeSafe}
                      activePositions={activePositions}
                      directMode={true}
                  />
                  <BacktestMomentumAuditModule 
                      candidates={list3Results}
                      setChartData={setChartData}
                      executeTradeSafe={executeTradeSafe}
                      list3Config={list3Config}
                      realPrices={realPrices}
                      activePositions={activePositions}
                      onRemoveSignal={(id) => removeSignalRef.current?.(id)}
                  />
                  <LiveBattlefieldModule 
                      positions={activePositions}
                      realPrices={realPrices}
                      setChartData={setChartData}
                      onClosePosition={onClosePosition}
                      onStatsUpdate={setLiveStats}
                  />
                  <TacticalCommandModule 
                      currentStats={liveStats}
                      onConfigUpdate={setActionConfig}
                      onPanicSell={() => activePositions.forEach(p => onClosePosition(p.symbol, p.side))} 
                      onSecureProfit={() => activePositions.filter(p => p.unrealizedPnL > 0).forEach(p => onClosePosition(p.symbol, p.side))}
                      onCutLosses={() => activePositions.filter(p => p.unrealizedPnL < 0).forEach(p => onClosePosition(p.symbol, p.side))} 
                      onCloseLongs={() => activePositions.filter(p => p.side === PositionSide.LONG).forEach(p => onClosePosition(p.symbol, p.side))} 
                      onCloseShorts={() => activePositions.filter(p => p.side === PositionSide.SHORT).forEach(p => onClosePosition(p.symbol, p.side))}
                  />
              </div>
          </div>
      </div>
  );
};
