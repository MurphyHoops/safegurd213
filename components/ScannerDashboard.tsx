
import React, { useState, useRef, useCallback } from 'react';
import { ScannerSettings, PositionSide, Position } from '../types';
import { X, Crosshair, Minus, Activity, Maximize2 } from 'lucide-react';
import { audioService } from '../services/audioService';
import KlineChartModal from './KlineChartModal';
import { ErrorBoundary } from './ErrorBoundary';

// --- ALL ATOMIC MODULES ---
import { MarketScannerModule } from '../modules/market-scanner';
import { GrandCrossingModule } from '../modules/grand-crossing';
import { StructureAuditModule } from '../modules/structure-audit';
import { MomentumAuditModule } from '../modules/momentum-audit';
import { LiveBattlefieldModule } from '../modules/live-battlefield';
import { TacticalCommandModule } from '../modules/tactical-command';

import { ScannerItem, ActionConfig, List3Config } from './Scanner/scannerTypes';

interface Props {
    settings: ScannerSettings;
    onClose: () => void;
    onOpenPosition: (symbol: string, side: PositionSide, amount: number, price: number, signalTf?: string) => void;
    onClosePosition: (symbol: string, side: PositionSide) => void;
    realPrices: Record<string, number>;
    activePositions: Position[];
    balance: number; 
    directMode?: boolean;
}

export const ScannerDashboard: React.FC<Props> = ({ settings, onClose, onOpenPosition, onClosePosition, realPrices = {}, activePositions = [], balance = 0, directMode = false }) => {
  
  // --- UI STATE ---
  const [isMinimized, setIsMinimized] = useState(false);
  const [chartData, setChartData] = useState<any>(null);

  // --- DATA PIPELINE STATE ---
  // List 1 -> List 2
  const [list1Candidates, setList1Candidates] = useState<ScannerItem[]>([]);
  
  // List 2 -> List 3
  const [list2Results, setList2Results] = useState<ScannerItem[]>([]);
  
  // List 3 -> List 4
  const [list3Results, setList3Results] = useState<ScannerItem[]>([]);
  // NEW: Sync List 3 Config to List 4 to ensure filtering consistency
  const [list3Config, setList3Config] = useState<List3Config | null>(null);

  // List 5 -> List 6 (Stats)
  const [liveStats, setLiveStats] = useState({ symbolCount: 0, totalValue: 0, totalPnl: 0 });

  // List 6 -> Global (Config)
  const [actionConfig, setActionConfig] = useState<ActionConfig | null>(null);

  // --- HANDLERS ---
  
  const executeTradeSafe = useCallback((symbol: string, side: PositionSide, price: number, reason: string, signalTf?: string) => {
      const amount = actionConfig?.openAmount || 100; // Use config from List 6
      onOpenPosition(symbol, side, amount, price, signalTf);
      audioService.speak("自动开仓执行");
  }, [actionConfig, onOpenPosition]);

  if (isMinimized) return (
      <div className="fixed bottom-6 right-6 z-[100]" onClick={() => setIsMinimized(false)}>
          <div className="bg-[#0b0e11] border border-slate-700 rounded-lg shadow-2xl p-3 flex items-center gap-3 cursor-pointer hover:border-indigo-500">
              <Activity size={20} className="text-indigo-400 animate-pulse" />
              <div className="text-xs font-bold text-white">扫描终端运行中</div>
              <Maximize2 size={16} className="text-slate-500"/>
          </div>
      </div>
  );

  return (
      <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0b0e11] w-full h-full max-w-[1800px] rounded-xl border border-slate-800 shadow-2xl flex flex-col overflow-hidden">
              {/* Top Bar */}
              <div className="flex items-center justify-between p-3 border-b border-slate-800 bg-[#161a25]">
                  <div className="flex items-center gap-4">
                      <h2 className="text-lg font-bold text-white flex items-center gap-2"><Crosshair size={20} className="text-indigo-500"/> 全域扫描终端 (SCANNER)</h2>
                      <div className="flex gap-2 text-[10px] text-slate-500 font-mono"><span>v5.0.1 (Strict Pipeline)</span><span>|</span><span>LATENCY: 42ms</span></div>
                  </div>
                  <div className="flex items-center gap-3">
                      <button onClick={() => setIsMinimized(true)} className="p-2 hover:bg-slate-800 rounded text-slate-400 hover:text-white"><Minus size={20}/></button>
                      <button onClick={onClose} className="p-2 hover:bg-red-900/50 rounded text-slate-400 hover:text-white"><X size={20}/></button>
                  </div>
              </div>

              <div className="flex-1 flex overflow-x-auto overflow-y-hidden bg-[#0b0e11] scrollbar-thin scrollbar-thumb-slate-800">
                  
                  {/* MODULE 1: MARKET SCANNER */}
                  <ErrorBoundary moduleName="1. 市场初筛">
                      <MarketScannerModule 
                          onCandidatesUpdate={setList1Candidates} 
                          directMode={directMode}
                      />
                  </ErrorBoundary>

                  {/* MODULE 2: GRAND CROSSING */}
                  <ErrorBoundary moduleName="2. 均线穿越">
                      <GrandCrossingModule 
                          candidates={list1Candidates} 
                          onResultsUpdate={setList2Results}
                          scanConfig={{ timeBasis: '24H', source: 'BOTH', minVolume: 10, minChange: 3, limit: 600, customSymbols: '', useCustomOnly: false, batchSize: 40 }}
                          setScanConfig={() => {}}
                          setChartData={setChartData}
                      />
                  </ErrorBoundary>

                  {/* MODULE 3: STRUCTURE AUDIT */}
                  <ErrorBoundary moduleName="3. 结构审计">
                      <StructureAuditModule 
                          candidates={list2Results}
                          onResultsUpdate={setList3Results}
                          onConfigUpdate={setList3Config} // Export real config
                          realPrices={realPrices}
                          setChartData={setChartData}
                          executeTradeSafe={executeTradeSafe}
                      />
                  </ErrorBoundary>

                  {/* MODULE 4: MOMENTUM AUDIT */}
                  <ErrorBoundary moduleName="4. 动能审计">
                      <MomentumAuditModule 
                          candidates={list3Results}
                          setChartData={setChartData}
                          executeTradeSafe={executeTradeSafe}
                          list3Config={list3Config!} // Pass real config for strict filtering
                          realPrices={realPrices}
                          activePositions={activePositions}
                      />
                  </ErrorBoundary>

                  {/* MODULE 5: LIVE BATTLEFIELD */}
                  <ErrorBoundary moduleName="5. 战场实况">
                      <LiveBattlefieldModule 
                          positions={activePositions}
                          realPrices={realPrices}
                          setChartData={setChartData}
                          onClosePosition={onClosePosition}
                          onStatsUpdate={setLiveStats}
                      />
                  </ErrorBoundary>

                  {/* MODULE 6: TACTICAL COMMAND */}
                  <ErrorBoundary moduleName="6. 战术终端">
                      <TacticalCommandModule 
                          currentStats={liveStats}
                          onConfigUpdate={setActionConfig}
                          onPanicSell={() => activePositions.forEach(p => onClosePosition(p.symbol, p.side))} 
                          onSecureProfit={() => activePositions.filter(p => p.unrealizedPnL > 0).forEach(p => onClosePosition(p.symbol, p.side))}
                          onCutLosses={() => activePositions.filter(p => p.unrealizedPnL < 0).forEach(p => onClosePosition(p.symbol, p.side))} 
                          onCloseLongs={() => activePositions.filter(p => p.side === PositionSide.LONG).forEach(p => onClosePosition(p.symbol, p.side))} 
                          onCloseShorts={() => activePositions.filter(p => p.side === PositionSide.SHORT).forEach(p => onClosePosition(p.symbol, p.side))}
                      />
                  </ErrorBoundary>
              </div>
          </div>

          {chartData && (
              <KlineChartModal 
                  symbol={chartData.symbol} 
                  initialTimeframe={chartData.tf} 
                  signals={chartData.signals}
                  entryPrice={chartData.entryPrice}
                  entryTime={chartData.entryTime}
                  currentPrice={chartData.currentPrice}
                  list2Config={undefined} 
                  highlightTime={chartData.highlightTime}
                  extraLines={chartData.extraLines}
                  onClose={() => setChartData(null)} 
              />
          )}
      </div>
  );
};
