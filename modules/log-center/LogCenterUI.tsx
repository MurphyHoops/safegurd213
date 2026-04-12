
import React from 'react';
import { LogCenterProps } from './types';
import { Terminal, ExternalLink } from 'lucide-react';

export const LogCenterModule: React.FC<LogCenterProps> = ({ logs, onOpenChart }) => {
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
        <h3 className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
            <Terminal size={14} />
            系统日志 / System Logs
        </h3>
        <div className="flex-1 overflow-y-auto space-y-1 font-mono text-xs">
            {logs.length === 0 && <p className="text-slate-600 italic">系统待机中...</p>}
            {logs.map((log) => (
                <div key={log.id} className="flex gap-2">
                    <span className="text-slate-500 flex-shrink-0">[{log.timestamp.toLocaleTimeString()}]</span>
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
