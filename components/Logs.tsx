import React from 'react';
import { LogEntry } from '../types';
import { Terminal } from 'lucide-react';
import { getCoinChineseName } from '../services/coinNames';

interface Props {
  logs: LogEntry[];
}

const Logs: React.FC<Props> = ({ logs }) => {
  const renderLogMessage = (message: string) => {
    const symbolRegex = /[A-Z0-9]+USDT/g;
    const parts = message.split(symbolRegex);
    const matches = message.match(symbolRegex);
    if (!matches) return message;
    return (
      <>
        {parts.map((part, i) => (
          <React.Fragment key={i}>
            {part}
            {matches[i] && (
              <span className="font-bold inline-flex items-baseline gap-0.5">
                <span>{matches[i]}</span>
                {getCoinChineseName(matches[i]) && (
                  <span className="text-amber-300 font-normal">({getCoinChineseName(matches[i])})</span>
                )}
              </span>
            )}
          </React.Fragment>
        ))}
      </>
    );
  };

  const [displayCount, setDisplayCount] = React.useState(80);
  const visibleLogs = React.useMemo(() => logs.slice(0, displayCount), [logs, displayCount]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 60 && displayCount < logs.length) {
      setDisplayCount(prev => Math.min(prev + 50, logs.length));
    }
  };

  return (
    <div className="bg-black/50 rounded-lg border border-slate-700 p-4 h-full overflow-hidden flex flex-col">
        <h3 className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Terminal size={14} />
              系统日志 / System Logs
            </span>
            {logs.length > 0 && (
              <span className="text-[10px] text-slate-500 font-normal">
                显示: {visibleLogs.length} / 共 {logs.length} 条
              </span>
            )}
        </h3>
        <div onScroll={handleScroll} className="flex-1 overflow-y-auto space-y-1 font-mono text-xs">
            {visibleLogs.length === 0 && <p className="text-slate-600 italic">系统待机中...</p>}
            {visibleLogs.map((log) => {
                const timeStr = log.timestamp instanceof Date ? log.timestamp.toLocaleTimeString() : new Date(log.timestamp || Date.now()).toLocaleTimeString();
                return (
                    <div key={log.id} className="flex gap-2">
                        <span className="text-slate-500 whitespace-nowrap">[{timeStr}]</span>
                        <span className={`
                            ${log.type === 'INFO' ? 'text-slate-300' : ''}
                            ${log.type === 'SUCCESS' ? 'text-emerald-400' : ''}
                            ${log.type === 'WARNING' ? 'text-amber-400' : ''}
                            ${log.type === 'DANGER' ? 'text-red-500 font-bold' : ''}
                        `}>
                            {renderLogMessage(log.message)}
                        </span>
                    </div>
                );
            })}
            {displayCount < logs.length && (
              <div className="pt-2 text-center">
                <button
                  onClick={() => setDisplayCount(prev => Math.min(prev + 100, logs.length))}
                  className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded text-[10px] transition-colors border border-slate-700"
                >
                  向下滚动或点击加载更多 (+100条)
                </button>
              </div>
            )}
        </div>
    </div>
  );
};

export default Logs;
