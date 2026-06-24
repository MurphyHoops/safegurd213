
import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Maximize2, Search, BarChart2, ChevronUp, ChevronDown } from 'lucide-react';
import KlineChartModal from './KlineChartModal';

interface VisualizerItem {
  symbol: string;
  timeframe?: string;
  triggeredTime?: number;
}

interface Props {
  title: string;
  items: VisualizerItem[];
  defaultTf?: string;
  defaultLimit?: number;
  list2Config?: any;
  onClose: () => void;
}

export const ScannerVisualizerModal: React.FC<Props> = ({ title, items, defaultTf = '15m', defaultLimit = 299, list2Config, onClose }) => {
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(items[0]?.symbol || null);
  const [searchTerm, setSearchTerm] = useState('');

  const filteredItems = useMemo(() => {
    return items.filter(i => i.symbol.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [items, searchTerm]);

  // Find the selected item's data
  const currentItem = useMemo(() => {
    return items.find(i => i.symbol === selectedSymbol);
  }, [items, selectedSymbol]);

  const currentIndex = useMemo(() => {
    return items.findIndex(i => i.symbol === selectedSymbol);
  }, [items, selectedSymbol]);

  const handlePrev = () => {
    if (items.length === 0) return;
    const nextIdx = (currentIndex - 1 + items.length) % items.length;
    setSelectedSymbol(items[nextIdx].symbol);
  };

  const handleNext = () => {
    if (items.length === 0) return;
    const nextIdx = (currentIndex + 1) % items.length;
    setSelectedSymbol(items[nextIdx].symbol);
  };

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/98 backdrop-blur-xl p-4">
      <div className="w-full h-full bg-[#0b0e11] border border-slate-700/50 rounded-xl overflow-hidden flex flex-col shadow-2xl shadow-[0_0_100px_rgba(0,0,0,1)]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-[#161a1e]">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-400">
              <Maximize2 size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white leading-tight">{title} <span className="text-slate-500 font-normal ml-2">全域分析仪表盘</span></h2>
              <div className="flex items-center gap-3 mt-1">
                <p className="text-xs text-slate-500">当前入选: <span className="text-indigo-400 font-bold">{items.length}</span> 个币种</p>
                <div className="h-2 w-px bg-slate-800"></div>
                <p className="text-xs text-slate-500">默认周期: <span className="text-slate-300">{defaultTf}</span></p>
              </div>
            </div>
          </div>

          {/* Navigation Controls in Header (Up/Down) */}
          <div className="flex items-center gap-4">
             {selectedSymbol && (
                <div className="flex items-center bg-[#0b0e11] border border-slate-700/50 rounded-lg overflow-hidden h-10 divide-x divide-slate-800 shadow-sm animate-in zoom-in-95 duration-200">
                    <div className="px-4 flex flex-col justify-center min-w-[120px]">
                        <span className="text-[10px] text-slate-500 font-mono leading-none mb-1">正在查看</span>
                        <span className="text-sm font-bold text-white font-mono tracking-wider leading-none">{selectedSymbol.replace('USDT', '')}</span>
                    </div>
                    <div className="flex flex-col">
                        <button 
                            onClick={handlePrev}
                            className="flex-1 px-3 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                            title="上一个币种 (Prev)"
                        >
                            <ChevronUp size={16} />
                        </button>
                        <button 
                            onClick={handleNext}
                            className="flex-1 px-3 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                            title="下一个币种 (Next)"
                        >
                            <ChevronDown size={16} />
                        </button>
                    </div>
                </div>
             )}

             <button 
                onClick={onClose} 
                className="p-2 hover:bg-slate-800/80 rounded-full text-slate-400 transition-colors group ml-2"
              >
                <X size={24} className="group-hover:rotate-90 transition-transform duration-300" />
              </button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-56 border-r border-slate-800 flex flex-col bg-[#0b0e11]">
            <div className="p-3 border-b border-slate-800/50">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input 
                  type="text" 
                  placeholder="搜索币种..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-black/40 border border-slate-700/50 rounded-md py-1.5 pl-9 pr-3 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 transition-colors"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-1.5 space-y-0.5">
              {filteredItems.map((item, idx) => (
                <button
                  key={`${item.symbol}-${item.timeframe || 'no-tf'}-${idx}`}
                  onClick={() => setSelectedSymbol(item.symbol)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded transition-all group ${
                    selectedSymbol === item.symbol 
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' 
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                   }`}
                >
                  <div className="flex flex-col items-start translate-y-px">
                     <span className="text-[11px] font-bold font-mono tracking-wider">{item.symbol.replace('USDT', '')}</span>
                     {item.timeframe && (
                        <span className={`text-[8px] font-bold opacity-60 ${selectedSymbol === item.symbol ? 'text-white' : 'text-indigo-400'}`}>
                           SIGNAL: {item.timeframe}
                        </span>
                     )}
                  </div>
                  <BarChart2 size={12} className={`transition-opacity ${selectedSymbol === item.symbol ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'}`} />
                </button>
              ))}
              {filteredItems.length === 0 && (
                <div className="text-center py-10 px-4">
                  <div className="text-[10px] text-slate-600 italic">未找到匹配币种</div>
                </div>
              )}
            </div>
          </div>

          {/* Chart Area */}
          <div className="flex-1 bg-[#161a1e] relative">
            {selectedSymbol ? (
              <div key={`${selectedSymbol}-${currentItem?.timeframe}`} className="w-full h-full">
                <KlineChartModal 
                  symbol={selectedSymbol}
                  initialTimeframe={currentItem?.timeframe || defaultTf}
                  highlightTf={currentItem?.timeframe}
                  limit={defaultLimit}
                  list2Config={list2Config}
                  disablePortal={true}
                  onClose={() => setSelectedSymbol(null)}
                />
              </div>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-slate-600 bg-[#0b0e11]">
                <div className="relative mb-6">
                   <BarChart2 size={80} className="opacity-5 animate-pulse" />
                   <Maximize2 size={24} className="absolute inset-0 m-auto opacity-20" />
                </div>
                <p className="text-sm font-medium text-slate-500">请从左侧列表选择一个币种进行深度扫描验证</p>
                <p className="text-[10px] text-slate-600 mt-2">提示：列表 1 默认查看 1D 周期大趋势</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
