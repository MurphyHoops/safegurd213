import React, { useState } from 'react';
import { AlertTriangle, ShieldCheck, Download, Trash2, Clock, Activity, Cpu, HardDrive } from 'lucide-react';
import { FlightAction } from '../services/flightRecorder';

export interface CrashDumpRecord {
  id: string;
  timestamp: number;
  timeStr: string;
  type: string;
  reason: string;
  message: string;
  exitCode?: number;
  memoryRssMB?: number;
  memoryHeapMB?: number;
  unacknowledged?: boolean;
}

interface Props {
  crashData: CrashDumpRecord;
  flightActions?: FlightAction[];
  onClose: () => void;
}

export const CrashRecoveryModal: React.FC<Props> = ({
  crashData,
  flightActions = [],
  onClose
}) => {
  const [isExporting, setIsExporting] = useState(false);

  const handleAcknowledge = async () => {
    try {
      await fetch('/api/telemetry/acknowledge-crash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: crashData.id })
      });
    } catch (_) {}
    onClose();
  };

  const handleExportDiagnostics = () => {
    setIsExporting(true);
    try {
      const payload = {
        title: "Savior 救世之星 - 黑匣子崩溃遥测报告",
        exportedAt: new Date().toLocaleString(),
        crashDetails: crashData,
        flightActionsTrail: flightActions
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `savior_crash_telemetry_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('导出黑匣子报告失败: ' + String(err));
    } finally {
      setIsExporting(false);
    }
  };

  const isOom = String(crashData.reason || '').toLowerCase().includes('oom') || String(crashData.message || '').includes('OOM');
  const isTimeout = crashData.type === 'RENDERER_HEARTBEAT_TIMEOUT' || String(crashData.reason || '').includes('Unresponsive');

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/85 backdrop-blur-lg p-4 animate-in fade-in duration-200 select-none">
      <div className="relative w-full max-w-3xl bg-slate-950 border-2 border-red-500/80 rounded-2xl shadow-[0_0_50px_rgba(239,68,68,0.3)] overflow-hidden text-slate-100 flex flex-col max-h-[90vh]">
        
        {/* Top Warning Banner Header */}
        <div className="bg-gradient-to-r from-red-950 via-slate-950 to-red-950 border-b border-red-500/40 p-5 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-red-600/20 border border-red-500/60 rounded-xl text-red-500 animate-pulse">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 text-[10px] font-black uppercase rounded bg-red-600 text-white tracking-widest font-mono">
                  {crashData.type || 'DIRTY_SHUTDOWN'}
                </span>
                <span className="text-xs text-red-400/90 font-mono flex items-center gap-1">
                  <Clock size={12} /> {crashData.timeStr || new Date(crashData.timestamp).toLocaleString()}
                </span>
              </div>
              <h2 className="text-lg font-bold text-red-100 mt-1 tracking-tight">
                🚨 黑匣子自检告警：检测到上次程序非正常退出/异常崩溃
              </h2>
            </div>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-5 custom-scrollbar flex-1">
          
          {/* Main Reason Card */}
          <div className="bg-slate-900/90 border border-red-900/60 rounded-xl p-4 space-y-3 shadow-inner">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Activity size={14} className="text-red-400" />
                崩溃归因与物理指标 (Crash Diagnostic Summary)
              </span>
              {crashData.exitCode !== undefined && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-amber-400 border border-slate-700">
                  Exit Code: {crashData.exitCode}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-950 p-2.5 rounded border border-slate-800 space-y-1">
                <span className="text-slate-500 text-[10px] font-bold block">触发原因 (Reason Category)</span>
                <span className="text-red-300 font-bold font-mono">
                  {isOom && '💥 V8 Heap OOM 内存溢出暴毙'}
                  {isTimeout && '⚡ 渲染进程死锁/无响应 (心跳中断受控拦截)'}
                  {!isOom && !isTimeout && (crashData.reason || '非正常关机/强杀 (Dirty Shutdown)')}
                </span>
              </div>

              <div className="bg-slate-950 p-2.5 rounded border border-slate-800 space-y-1">
                <span className="text-slate-500 text-[10px] font-bold block flex items-center gap-1">
                  <HardDrive size={11} className="text-sky-400" /> 物理内存水位 (Memory Level at Exit)
                </span>
                <span className="text-sky-300 font-mono font-bold">
                  RSS: {crashData.memoryRssMB || 'N/A'} MB | Heap: {crashData.memoryHeapMB || 'N/A'} MB
                </span>
              </div>
            </div>

            <div className="bg-red-950/30 border border-red-800/50 rounded p-2.5 text-xs text-red-200 font-mono leading-relaxed">
              <span className="font-bold text-red-400 block mb-0.5">详细现场抓取说明：</span>
              {crashData.message || '未捕获的渲染引擎物理强杀信号'}
            </div>
          </div>

          {/* Flight Recorder Ring Buffer Trails */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Cpu size={14} className="text-emerald-400" />
                崩溃前最后飞行轨迹 (Flight Recorder Ring Buffer - Last Trails)
              </span>
              <span className="text-[10px] font-mono text-slate-500">
                {flightActions.length} 条轨迹记录
              </span>
            </div>

            {flightActions.length === 0 ? (
              <div className="text-center py-4 text-xs text-slate-500 font-mono bg-slate-950/50 rounded border border-slate-800">
                暂无崩溃前的飞行轨迹数据
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 font-mono text-[11px] custom-scrollbar">
                {flightActions.slice(-15).map((act, idx) => (
                  <div key={act.id || idx} className="bg-slate-950/80 border border-slate-800/80 rounded px-2.5 py-1.5 flex items-start gap-2 text-slate-300 hover:border-slate-700 transition-colors">
                    <span className="text-slate-500 shrink-0 text-[10px] pt-0.5">{act.timeStr || new Date(act.timestamp).toLocaleTimeString()}</span>
                    <span className="px-1.5 py-0.2 text-[9px] font-bold rounded bg-slate-800 text-emerald-400 border border-slate-700 shrink-0">
                      {act.actionType}
                    </span>
                    <span className="text-slate-300 break-all truncate flex-1">
                      {act.details}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* Modal Bottom Buttons */}
        <div className="bg-slate-900 border-t border-slate-800 p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleExportDiagnostics}
            disabled={isExporting}
            className="w-full sm:w-auto px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-bold text-xs transition-all border border-slate-700 flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Download size={14} className="text-sky-400" />
            <span>导出黑匣子遥测报告 (.json)</span>
          </button>

          <button
            type="button"
            onClick={handleAcknowledge}
            className="w-full sm:w-auto px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-950/50 border border-emerald-400 transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
          >
            <ShieldCheck size={15} />
            <span>确认并清除标记 (恢复进入主界面)</span>
          </button>
        </div>

      </div>
    </div>
  );
};

export default CrashRecoveryModal;
