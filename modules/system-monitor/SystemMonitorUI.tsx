import React, { useEffect, useRef, useState } from 'react';
import { Terminal, Trash2, Settings, Activity, Clock, ShieldAlert, Cpu } from 'lucide-react';
import { useMonitorStore } from '../../services/monitor/monitorService';

export const SystemMonitorModule: React.FC = () => {
    const logs = useMonitorStore(s => s.logs);
    const clearLogs = useMonitorStore(s => s.clearLogs);
    const maxLogs = useMonitorStore(s => s.maxLogs);
    const setMaxLogs = useMonitorStore(s => s.setMaxLogs);
    const autoClearInterval = useMonitorStore(s => s.autoClearInterval);
    const setAutoClearInterval = useMonitorStore(s => s.setAutoClearInterval);
    const performCleanup = useMonitorStore(s => s.performCleanup);
    const lastCleanup = useMonitorStore(s => s.lastCleanup);
    const [showSettings, setShowSettings] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-cleanup timer
    useEffect(() => {
        const interval = setInterval(() => {
            const now = Date.now();
            const elapsed = (now - lastCleanup) / (1000 * 60);
            if (elapsed >= autoClearInterval) {
                performCleanup();
            }
        }, 30000); // Check every 30s
        return () => clearInterval(interval);
    }, [autoClearInterval, lastCleanup, performCleanup]);

    // memory monitor
    const [memory, setMemory] = useState<{ used: number, limit: number, pct: number } | null>(null);

    useEffect(() => {
        const checkMemory = () => {
            const perf = (window.performance as any);
            if (perf && perf.memory) {
                const used = Math.round(perf.memory.usedJSHeapSize / 1048576);
                const limit = Math.round(perf.memory.jsHeapSizeLimit / 1048576);
                const pct = Math.round((used / limit) * 100);
                setMemory({ used, limit, pct });

                if (pct > 80) {
                    performCleanup(); // Force cleanup if memory is tight
                }
            }
        };

        const memInterval = setInterval(checkMemory, 10000);
        checkMemory();
        return () => clearInterval(memInterval);
    }, [performCleanup]);

    const getLevelColor = (level: string) => {
        switch (level) {
            case 'ERROR': return 'text-red-400';
            case 'WARN': return 'text-amber-400';
            case 'PERF': return 'text-blue-400';
            default: return 'text-emerald-400';
        }
    };

    const [isDiagnosing, setIsDiagnosing] = useState(false);
    const [diagResult, setDiagResult] = useState<{ status: 'OK' | 'WARN' | 'FAIL', issues: string[] } | null>(null);

    const runDiagnostic = async () => {
        setIsDiagnosing(true);
        const issues: string[] = [];
        let status: 'OK' | 'WARN' | 'FAIL' = 'OK';

        // 1. Check Root DOM
        const root = document.getElementById('root');
        if (!root) {
            issues.push("Root 节点不存在");
            status = 'FAIL';
        } else if (root.innerHTML.length < 50) {
            issues.push("Root 节点几乎为空 (疑似渲染挂起)");
            status = 'FAIL';
        }

        // 2. Check Event Loop (Heartbeat)
        const start = performance.now();
        await new Promise(r => setTimeout(r, 0));
        const delay = performance.now() - start;
        if (delay > 100) {
            issues.push(`主线程拥堵: ${delay.toFixed(1)}ms 延迟`);
            status = status === 'FAIL' ? 'FAIL' : 'WARN';
        }

        // 3. Check Memory
        const perf = (window.performance as any);
        if (perf?.memory) {
            const pct = (perf.memory.usedJSHeapSize / perf.memory.jsHeapSizeLimit) * 100;
            if (pct > 85) {
                issues.push(`内存占用过高: ${pct.toFixed(1)}%`);
                status = 'FAIL';
            }
        }

        // 4. Check Recent Errors
        const errorLogs = logs.filter(l => l.level === 'ERROR' && Date.now() - l.timestamp < 300000);
        if (errorLogs.length > 5) {
            issues.push(`最近5分钟内发生 ${errorLogs.length} 次严重错误`);
            status = 'FAIL';
        }

        // 5. Check LocalStorage & Serialization
        try {
            const testKey = 'diag_test_' + Date.now();
            localStorage.setItem(testKey, '1');
            const val = localStorage.getItem(testKey);
            localStorage.removeItem(testKey);
            if (val !== '1') throw new Error("Verification failed");
        } catch (e) {
            issues.push("LocalStorage 读写异常 (可能已满或被禁用)");
            status = 'FAIL';
        }

        // 6. Check for specifically heavy keys (potential white screen cause)
        const keys = Object.keys(localStorage);
        for (const key of keys) {
            if (localStorage.getItem(key)!.length > 1000000) { // > 1MB
                issues.push(`发现巨大的缓存项 (${key}), 可能阻塞主线程`);
                status = status === 'OK' ? 'WARN' : status;
            }
        }

        // 7. Check for critical modules status
        if (!(window as any).isReactReady) {
             // We'll set this in index.tsx
             if (root && root.innerHTML.length < 150) {
                 issues.push("React 挂载点未激活 (渲染流程中断)");
                 status = 'FAIL';
             }
        }

        if (issues.length === 0) issues.push("核心系统自检通过");
        
        setDiagResult({ status, issues });
        setIsDiagnosing(false);
        
        // Log the diagnostic
        useMonitorStore.getState().addLog(status === 'OK' ? 'INFO' : 'ERROR', 'KERNEL', `诊断完成: ${status}`, { issues });
    };

    // Auto-repair interval & timestamp state
    const [autoRepairInterval, setAutoRepairIntervalState] = useState<number>(() => {
        try {
            const saved = localStorage.getItem('SAVIOR_MONITOR_AUTO_REPAIR_INTERVAL');
            return saved ? parseFloat(saved) || 3 : 3;
        } catch (_) {
            return 3;
        }
    });

    const [lastRepair, setLastRepair] = useState<number>(() => {
        try {
            const saved = localStorage.getItem('SAVIOR_MONITOR_LAST_REPAIR');
            if (saved) return parseInt(saved) || Date.now();
            const now = Date.now();
            localStorage.setItem('SAVIOR_MONITOR_LAST_REPAIR', now.toString());
            return now;
        } catch (_) {
            return Date.now();
        }
    });

    const setAutoRepairInterval = (hours: number) => {
        const valid = Math.max(0.1, hours);
        setAutoRepairIntervalState(valid);
        try {
            localStorage.setItem('SAVIOR_MONITOR_AUTO_REPAIR_INTERVAL', valid.toString());
        } catch (_) {}
    };

    const performAutoRepair = () => {
        localStorage.removeItem('SAVIOR_LOGS');
        localStorage.removeItem('SCANNER_LIST2_CACHE_MAP');
        localStorage.removeItem('SCANNER_LIST3_CACHE_MAP');
        localStorage.removeItem('SCANNER_LIST4_CACHE_MAP');
        
        const now = Date.now();
        setLastRepair(now);
        try {
            localStorage.setItem('SAVIOR_MONITOR_LAST_REPAIR', now.toString());
        } catch (_) {}
        
        useMonitorStore.getState().addLog('INFO', 'KERNEL', `自动定时执行：白屏诊断一键修复已触发并完成清理（每 ${autoRepairInterval} 小时一次）`);
        
        runDiagnostic();
    };

    // Auto-repair timer
    useEffect(() => {
        const interval = setInterval(() => {
            const now = Date.now();
            const elapsedHours = (now - lastRepair) / (1000 * 60 * 60);
            if (elapsedHours >= autoRepairInterval) {
                performAutoRepair();
            }
        }, 30000); // Check every 30s
        return () => clearInterval(interval);
    }, [autoRepairInterval, lastRepair]);

    return (
        <div className="flex flex-col h-full bg-[#0a0c10] text-slate-300 font-mono text-[11px]">
            {/* Control Bar */}
            <div className="p-2 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-slate-500">
                    <Activity size={10} /> 状态: <span className={diagResult?.status === 'FAIL' ? 'text-red-500' : 'text-emerald-500'}>
                        {diagResult?.status === 'FAIL' ? '内核受损' : '正常'}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <button 
                        onClick={runDiagnostic}
                        disabled={isDiagnosing}
                        className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase transition-all flex items-center gap-1 ${
                            isDiagnosing ? 'bg-slate-800 text-slate-500' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20'
                        }`}
                    >
                        <ShieldAlert size={10} className={isDiagnosing ? 'animate-pulse' : ''} />
                        {isDiagnosing ? '诊断中...' : '白屏诊断'}
                    </button>
                    <button 
                        onClick={() => setShowSettings(!showSettings)}
                        className={`p-1 rounded hover:bg-slate-800 transition-colors ${showSettings ? 'text-blue-400' : 'text-slate-500'}`}
                    >
                        <Settings size={12} />
                    </button>
                    <button 
                        onClick={clearLogs}
                        className="p-1 rounded text-slate-500 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                        title="清空日志"
                    >
                        <Trash2 size={12} />
                    </button>
                </div>
            </div>

            {/* Settings Panel */}
            {showSettings && (
                <div className="p-2 bg-slate-900 border-b border-slate-800 grid grid-cols-3 gap-2 animate-in slide-in-from-top duration-200">
                    <div className="space-y-1">
                        <label className="text-[8px] text-slate-500 uppercase font-bold">最高存储</label>
                        <input 
                            type="number"
                            value={maxLogs}
                            onChange={(e) => setMaxLogs(parseInt(e.target.value) || 100)}
                            className="w-full bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-orange-400 outline-none"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[8px] text-slate-500 uppercase font-bold">自动清理(分)</label>
                        <input 
                            type="number"
                            value={autoClearInterval}
                            onChange={(e) => setAutoClearInterval(Math.max(1, parseInt(e.target.value) || 60))}
                            className="w-full bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-blue-400 outline-none"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[8px] text-slate-500 uppercase font-bold">自动修复(小时)</label>
                        <input 
                            type="number"
                            step="0.5"
                            value={autoRepairInterval}
                            onChange={(e) => setAutoRepairInterval(Math.max(0.1, parseFloat(e.target.value) || 3))}
                            className="w-full bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-emerald-400 outline-none"
                        />
                    </div>
                </div>
            )}

            {/* Diagnostic Results */}
            {diagResult && (
                <div className={`p-2 border-b animate-in fade-in duration-300 ${
                    diagResult.status === 'FAIL' ? 'bg-red-500/10 border-red-500/20' : 
                    diagResult.status === 'WARN' ? 'bg-amber-500/10 border-amber-500/20' : 
                    'bg-emerald-500/5 border-emerald-500/10'
                }`}>
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-[9px] font-black uppercase flex items-center gap-1">
                            <ShieldAlert size={10} className={diagResult.status === 'FAIL' ? 'text-red-500' : 'text-emerald-500'} />
                            诊断报告
                        </span>
                        <button 
                            onClick={() => setDiagResult(null)}
                            className="text-[8px] text-slate-500 hover:text-slate-300"
                        >
                            关闭
                        </button>
                    </div>
                    <div className="space-y-0.5">
                        {diagResult.issues.map((issue, idx) => (
                            <div key={idx} className={`flex items-center gap-1.5 text-[9px] ${
                                diagResult.status === 'FAIL' ? 'text-red-400' : 'text-slate-400'
                            }`}>
                                <span className="w-1 h-1 rounded-full bg-current" />
                                {issue}
                            </div>
                        ))}
                    </div>
                    <div className="mt-3 flex flex-col gap-2">
                        {diagResult.status === 'FAIL' && (
                            <button 
                                onClick={() => window.location.reload()}
                                className="w-full py-1.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded text-[9px] font-bold hover:bg-red-500/30 transition-colors"
                            >
                                检测到严重异常：立即重载核心
                            </button>
                        )}
                        <div className="flex flex-col gap-1">
                            <button 
                                onClick={() => {
                                    localStorage.removeItem('SAVIOR_LOGS');
                                    localStorage.removeItem('SCANNER_LIST2_CACHE_MAP');
                                    localStorage.removeItem('SCANNER_LIST3_CACHE_MAP');
                                    localStorage.removeItem('SCANNER_LIST4_CACHE_MAP');
                                    
                                    const now = Date.now();
                                    setLastRepair(now);
                                    try {
                                        localStorage.setItem('SAVIOR_MONITOR_LAST_REPAIR', now.toString());
                                    } catch (_) {}
                                    
                                    useMonitorStore.getState().addLog('INFO', 'KERNEL', '扫描器缓存已清理');
                                    runDiagnostic();
                                }}
                                className="w-full py-1.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded text-[9px] font-bold hover:bg-blue-500/20 transition-colors"
                            >
                                执行修复：清理扫描器臃肿缓存
                            </button>
                            <span className="text-[8px] text-slate-500 text-center">
                                ⏱️ 自动修复：每 {autoRepairInterval} 小时执行 (上次修复: {new Date(lastRepair).toLocaleTimeString([], { hour12: false })})
                            </span>
                        </div>
                        <button 
                            onClick={() => {
                                if (confirm('确定要清除所有设置恢复出厂吗？此操作不可逆。')) {
                                    localStorage.clear();
                                    window.location.reload();
                                }
                            }}
                            className="w-full py-1.5 bg-slate-800 text-slate-400 border border-slate-700 rounded text-[9px] font-bold hover:bg-slate-700 transition-colors"
                        >
                            最终对策：完全恢复出厂设置
                        </button>
                    </div>
                </div>
            )}

            {/* Stats Row */}
            <div className="px-2 py-1 bg-slate-900/30 border-b border-slate-800/50 flex items-center justify-between text-[8px] text-slate-500">
                <div className="flex items-center gap-1">
                    <Cpu size={8} className="text-blue-500"/>
                    <span className="text-blue-400">{logs.length}</span> Logs
                </div>
                <div className="flex items-center gap-1">
                    <Clock size={8} className="text-amber-500"/>
                    清理于: <span className="text-amber-400">{new Date(lastCleanup).toLocaleTimeString([], { hour12: false })}</span>
                </div>
                {memory && (
                    <div className={`flex items-center gap-1 ${memory.pct > 70 ? 'text-red-400' : 'text-slate-500'}`}>
                        MEM: <span className="font-bold">{memory.used}M</span> / {memory.limit}M ({memory.pct}%)
                    </div>
                )}
            </div>

            {/* Log List */}
            <div 
                ref={scrollRef}
                className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1 custom-scrollbar min-h-[200px] max-h-[400px]"
            >
                {logs.length === 0 ? (
                    <div className="h-20 flex flex-col items-center justify-center text-slate-600 opacity-50">
                        <ShieldAlert size={16} className="mb-1" />
                        <p>监听中...</p>
                    </div>
                ) : (
                    logs.map(log => (
                        <div key={log.id} className="group border-b border-slate-800/30 pb-0.5 last:border-0 hover:bg-slate-800/30 px-1 rounded transition-colors">
                            <div className="flex items-start gap-1.5">
                                <span className="text-[8px] text-slate-600 mt-0.5 shrink-0">
                                    {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, second: '2-digit' }).split(' ')[0]}
                                </span>
                                <span className={`font-bold shrink-0 ${getLevelColor(log.level)} text-[8px]`}>
                                    [{log.level}]
                                </span>
                                <span className="break-all leading-tight">
                                    <span className="text-blue-500/80 mr-1">{log.module}</span>
                                    {log.message}
                                </span>
                            </div>
                            {log.details && (
                                <div className="ml-10 mt-0.5 p-1 bg-black/40 rounded border border-slate-800/50 text-[8px] text-slate-500 italic max-h-12 overflow-hidden">
                                    {typeof log.details === 'object' ? JSON.stringify(log.details) : log.details}
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
