
import React, { useState, useMemo } from 'react';
import { LogCenterProps } from './types';
import { Terminal, ExternalLink, Search, Clock, RotateCcw, X } from 'lucide-react';

export const LogCenterModule: React.FC<LogCenterProps> = ({ logs, onOpenChart }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const filteredLogs = useMemo(() => {
    const term = searchTerm.toLowerCase();
    const startMs = startTime ? new Date(startTime).getTime() : 0;
    const endMs = endTime ? new Date(endTime).getTime() : Infinity;

    return logs.filter(log => {
      const matchesTerm = log.message.toLowerCase().includes(term);
      if (!matchesTerm) return false;

      const logTime = log.timestamp instanceof Date ? log.timestamp.getTime() : new Date(log.timestamp).getTime();
      return logTime >= startMs && logTime <= endMs;
    });
  }, [logs, searchTerm, startTime, endTime]);

  const renderMessage = (log: any) => {
    const { message, timestamp } = log;
    if (!onOpenChart) return message;

    // Regex to find symbols like BTCUSDT, ETHUSDT, etc.
    const symbolRegex = /[A-Z0-9]+USDT/g;
    const parts = message.split(symbolRegex);
    const matches = message.match(symbolRegex);

    if (!matches) return message;

    // Try to extract price if it's an "Opened" or "Closed" log
    // Example: "Opened LONG on BTCUSDT at 65000.5"
    const priceMatch = message.match(/at (\d+\.?\d*)/);
    const price = priceMatch ? parseFloat(priceMatch[1]) : undefined;
    const time = timestamp ? new Date(timestamp).getTime() : undefined;

    return (
      <>
        {parts.map((part, i) => (
          <React.Fragment key={i}>
            {part}
            {matches[i] && (
              <button
                onClick={() => onOpenChart(matches[i], price, time)}
                className="text-indigo-400 hover:text-indigo-300 hover:underline inline-flex items-center gap-0.5 mx-1 font-bold"
              >
                {matches[i]}
                <ExternalLink size={10} />
              </button>
            )}
          </React.Fragment>
        ))}
      </>
    );
  };

  return (
    <div className="bg-black/50 rounded-lg border border-slate-700 p-4 h-full overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-2">
            <h3 className="text-slate-400 text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                <Terminal size={14} />
                系统日志 / System Logs
            </h3>
            <div className="flex items-center gap-2">
                {showFilters ? (
                    <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-200">
                        <div className="relative">
                            <input 
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="搜索..."
                                className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-[10px] text-white w-24 focus:outline-none focus:border-indigo-500"
                            />
                            <Search size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500" />
                        </div>
                        <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5">
                            <input 
                                type="datetime-local"
                                value={startTime}
                                onChange={(e) => setStartTime(e.target.value)}
                                className="bg-transparent border-none text-[10px] text-slate-400 focus:outline-none w-20"
                            />
                            <span className="text-slate-600">-</span>
                            <input 
                                type="datetime-local"
                                value={endTime}
                                onChange={(e) => setEndTime(e.target.value)}
                                className="bg-transparent border-none text-[10px] text-slate-400 focus:outline-none w-20"
                            />
                            {(startTime || endTime || searchTerm) && (
                                <button onClick={() => { setStartTime(''); setEndTime(''); setSearchTerm(''); }} className="text-slate-500 hover:text-white">
                                    <RotateCcw size={10} />
                                </button>
                            )}
                        </div>
                        <button onClick={() => setShowFilters(false)} className="text-slate-500 hover:text-white">
                            <X size={12} />
                        </button>
                    </div>
                ) : (
                    <button 
                        onClick={() => setShowFilters(true)}
                        className="p-1 hover:bg-slate-800 rounded text-slate-500 hover:text-slate-300 transition-colors"
                    >
                        <Search size={12} />
                    </button>
                )}
            </div>
        </div>
        <div className="flex-1 overflow-y-auto space-y-1 font-mono text-xs">
            {filteredLogs.length === 0 && (
                <p className="text-slate-600 italic">
                    {logs.length === 0 ? '系统待机中...' : '无匹配日志'}
                </p>
            )}
            {filteredLogs.map((log) => (
                <div key={log.id} className="flex gap-2">
                    <span className="text-slate-500 flex-shrink-0">
                        [{log.timestamp instanceof Date ? log.timestamp.toLocaleTimeString() : new Date(log.timestamp).toLocaleTimeString()}]
                    </span>
                    <span className={`
                        ${log.type === 'INFO' ? 'text-slate-300' : ''}
                        ${log.type === 'SUCCESS' ? 'text-emerald-400' : ''}
                        ${log.type === 'WARNING' ? 'text-amber-400' : ''}
                        ${log.type === 'DANGER' ? 'text-red-500 font-bold' : ''}
                    `}>
                        {renderMessage(log)}
                    </span>
                </div>
            ))}
        </div>
    </div>
  );
};
