import React from 'react';
import { LogEntry } from '../types';
import { Terminal } from 'lucide-react';

interface Props {
  logs: LogEntry[];
}

const Logs: React.FC<Props> = ({ logs }) => {
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
                    <span className="text-slate-500">[{log.timestamp.toLocaleTimeString()}]</span>
                    <span className={`
                        ${log.type === 'INFO' ? 'text-slate-300' : ''}
                        ${log.type === 'SUCCESS' ? 'text-emerald-400' : ''}
                        ${log.type === 'WARNING' ? 'text-amber-400' : ''}
                        ${log.type === 'DANGER' ? 'text-red-500 font-bold' : ''}
                    `}>
                        {log.message}
                    </span>
                </div>
            ))}
        </div>
    </div>
  );
};

export default Logs;
