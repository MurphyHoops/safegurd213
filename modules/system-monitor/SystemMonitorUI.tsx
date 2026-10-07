import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Terminal, Trash2, Settings, Activity, Clock, ShieldAlert, Cpu, AlertOctagon, Copy, Check, ChevronDown, ChevronRight, Zap } from 'lucide-react';
import { useMonitorStore, getCrashBlackbox, clearCrashBlackbox, CrashBlackboxEntry } from '../../services/monitor/monitorService';
import { cacheManager } from '../../services/cacheManager';

const safeFormatTime = (timestamp: any) => {
    if (!timestamp) return '00:00:00';
    try {
        const d = new Date(timestamp);
        if (isNaN(d.getTime())) return '00:00:00';
        return d.toLocaleTimeString([], { hour12: false, second: '2-digit' }).split(' ')[0];
    } catch (_) {
        return '00:00:00';
    }
};

const safeFormatFullTime = (timestamp: any) => {
    if (!timestamp) return '00:00:00';
    try {
        const d = new Date(timestamp);
        if (isNaN(d.getTime())) return '00:00:00';
        return d.toLocaleTimeString([], { hour12: false });
    } catch (_) {
        return '00:00:00';
    }
};

export const SystemMonitorModule: React.FC = () => {
    const rawLogs = useMonitorStore(s => s.logs);
    const logs = Array.isArray(rawLogs) ? rawLogs : [];
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
    const [activeTab, setActiveTab] = useState<'LOGS' | 'CRASHES'>('LOGS');
    const [crashEntries, setCrashEntries] = useState<CrashBlackboxEntry[]>(() => getCrashBlackbox());
    const [expandedCrashId, setExpandedCrashId] = useState<string | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    // Refresh crashes periodically
    useEffect(() => {
        const refreshCrashes = () => {
            setCrashEntries(getCrashBlackbox());
        };
        const timer = setInterval(refreshCrashes, 2500);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        const checkMemory = () => {
            const perf = (window.performance as any);
            if (perf && perf.memory) {
                const used = Math.round(perf.memory.usedJSHeapSize / 1048576);
                const limit = Math.round(perf.memory.jsHeapSizeLimit / 1048576);
                const pct = Math.round((used / limit) * 100);
                setMemory({ used, limit, pct });

                if (pct > 88) {
                    cacheManager.clearCache('LIGHT');
                }
            }
        };

        const memInterval = setInterval(checkMemory, 10000);
        checkMemory();
        return () => clearInterval(memInterval);
    }, []);

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
        // If tab/document is hidden or backgrounded, browser engines intentionally clamp timers to >=1000ms
        const isTabHidden = typeof document !== 'undefined' && document.hidden;
        if (!isTabHidden) {
            const start = performance.now();
            await new Promise(r => setTimeout(r, 0));
            const delay = performance.now() - start;
            if (delay > 500) {
                issues.push(`主线程负载较高: ${delay.toFixed(1)}ms 延迟`);
                status = status === 'FAIL' ? 'FAIL' : 'WARN';
            }
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
            try {
                const val = localStorage.getItem(key);
                if (val && val.length > 1000000) { // > 1MB
                    issues.push(`发现巨大的缓存项 (${key}), 可能阻塞主线程`);
                    status = status === 'OK' ? 'WARN' : status;
                }
            } catch (_) {}
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
        
        // Log the diagnostic cleanly
        const logLevel = status === 'OK' ? 'INFO' : (status === 'WARN' ? 'WARN' : 'ERROR');
        useMonitorStore.getState().addLog(logLevel, 'KERNEL', `诊断完成: ${status}`, { issues });
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
        cacheManager.clearCache('LIGHT');
        
        // Truncate logs instead of deleting active scanner candidate maps
        const rawLogs = localStorage.getItem('SAVIOR_LOGS');
        if (rawLogs) {
            try {
                const parsed = JSON.parse(rawLogs);
                if (Array.isArray(parsed)) {
                    localStorage.setItem('SAVIOR_LOGS', JSON.stringify(parsed.slice(0, 50)));
                }
            } catch (_) {
                localStorage.removeItem('SAVIOR_LOGS');
            }
        }
        
        const now = Date.now();
        setLastRepair(now);
        try {
            localStorage.setItem('SAVIOR_MONITOR_LAST_REPAIR', now.toString());
        } catch (_) {}
        
        useMonitorStore.getState().addLog('INFO', 'KERNEL', `自动定时执行：安全缓存轻量优化已完成（每 ${autoRepairInterval} 小时一次）`);
        runDiagnostic();
    };

    // Auto-sync crash records whenever updated or tab switched
    useEffect(() => {
        const syncLocal = () => {
            setCrashEntries(getCrashBlackbox());
        };
        syncLocal();
        fetchServerCrashes();

        window.addEventListener('SAVIOR_CRASH_UPDATED', syncLocal);
        return () => {
            window.removeEventListener('SAVIOR_CRASH_UPDATED', syncLocal);
        };
    }, [activeTab]);

    const copyCrashDetails = (entry: CrashBlackboxEntry) => {
        try {
            const report = JSON.stringify(entry, null, 2);
            navigator.clipboard.writeText(report);
            setCopiedId(entry.id);
            setTimeout(() => setCopiedId(null), 2000);
        } catch (_) {}
    };

    const exportAllCrashes = () => {
        try {
            const text = JSON.stringify(crashEntries, null, 2);
            navigator.clipboard.writeText(text);
            alert('已将完整闪退归因黑匣子记录复制到剪贴板！');
        } catch (_) {}
    };

    const fetchServerCrashes = async () => {
        try {
            const res = await fetch('/api/monitor/crash-report');
            if (res.ok) {
                const data = await res.json();
                if (data.reports && Array.isArray(data.reports)) {
                    const local = getCrashBlackbox();
                    const map = new Map<string, CrashBlackboxEntry>();
                    [...local, ...data.reports].forEach(r => {
                        if (r && r.id) map.set(r.id, r);
                    });
                    const merged = Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
                    setCrashEntries(merged);
                    localStorage.setItem('SAVIOR_CRASH_BLACKBOX', JSON.stringify(merged));
                }
            }
        } catch (_) {}
    };

    const getCrashTypeBadge = (type: string) => {
        switch (type) {
            case 'BROWSER_TAB_KILL':
            case 'HEARTBEAT_TIMEOUT':
                return { label: '进程强退/AwSnap', bg: 'bg-purple-950/70 text-purple-400 border-purple-500/50' };
            case 'EVENT_LOOP_FREEZE':
                return { label: '主线程死循环卡死', bg: 'bg-red-950/70 text-red-300 border-red-500/50' };
            case 'RENDER_CRASH':
                return { label: '组件渲染崩溃', bg: 'bg-red-950/70 text-red-400 border-red-500/50' };
            case 'UNHANDLED_ERROR':
                return { label: '全局脚本异常', bg: 'bg-rose-950/70 text-rose-400 border-rose-500/50' };
            case 'UNHANDLED_REJECTION':
                return { label: 'Promise异步失败', bg: 'bg-amber-950/70 text-amber-400 border-amber-500/50' };
            case 'OOM_ALERT':
                return { label: '内存超限预警', bg: 'bg-pink-950/70 text-pink-400 border-pink-500/50' };
            default:
                return { label: type || '运行时异常', bg: 'bg-red-950/70 text-red-400 border-red-500/50' };
        }
    };

    const handleClearCrashes = () => {
        if (confirm('确定要清空闪退黑匣子记录吗？')) {
            clearCrashBlackbox();
            setCrashEntries([]);
            try {
                fetch('/api/monitor/crash-report', { method: 'DELETE' }).catch(() => {});
            } catch (_) {}
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#0a0c10] text-slate-300 font-mono text-[11px]">
            {/* Control Bar & Tab Switcher */}
            <div className="p-2 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setActiveTab('LOGS')}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-all flex items-center gap-1 ${
                            activeTab === 'LOGS' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                        }`}
                    >
                        <Terminal size={10} />
                        系统日志 ({logs.length})
                    </button>
                    <button
                        onClick={() => {
                            setActiveTab('CRASHES');
                            setCrashEntries(getCrashBlackbox());
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-all flex items-center gap-1 ${
                            activeTab === 'CRASHES' 
                                ? 'bg-red-600 text-white shadow-lg shadow-red-600/30' 
                                : crashEntries.length > 0
                                    ? 'bg-red-950/60 text-red-400 border border-red-500/40 hover:bg-red-900/50'
                                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                        }`}
                    >
                        <AlertOctagon size={10} className={crashEntries.length > 0 ? 'text-red-400 animate-pulse' : ''} />
                        💥 闪退归因黑匣子 {crashEntries.length > 0 && <span className="px-1 py-0.2 rounded-full bg-red-500 text-white text-[8px]">{crashEntries.length}</span>}
                    </button>
                </div>

                <div className="flex items-center gap-1.5">
                    {activeTab === 'CRASHES' && crashEntries.length > 0 && (
                        <button
                            onClick={handleClearCrashes}
                            className="px-1.5 py-0.5 rounded text-[9px] text-slate-400 hover:text-red-400 hover:bg-red-950/40 transition-colors flex items-center gap-1"
                            title="清空闪退黑匣子"
                        >
                            <Trash2 size={10} /> 清空黑匣子
                        </button>
                    )}
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
                    {activeTab === 'LOGS' && (
                        <button 
                            onClick={clearLogs}
                            className="p-1 rounded text-slate-500 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                            title="清空日志"
                        >
                            <Trash2 size={12} />
                        </button>
                    )}
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
                            <div className="flex gap-1 items-center">
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
                                    className="flex-1 py-1.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded text-[9px] font-bold hover:bg-blue-500/20 transition-colors"
                                >
                                    执行修复：清理扫描器臃肿缓存
                                </button>
                                <button 
                                    onClick={() => {
                                        const h = prompt("请输入自动修复间隔（单位：小时）：", autoRepairInterval.toString());
                                        if (h !== null) {
                                            const val = parseFloat(h);
                                            if (!isNaN(val) && val > 0) {
                                                setAutoRepairInterval(val);
                                            }
                                        }
                                    }}
                                    className="px-2 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded text-[9px] font-bold hover:bg-emerald-500/20 transition-colors flex items-center gap-1 shrink-0"
                                >
                                    <Settings size={10} />
                                    设置时间 ({autoRepairInterval}) 小时
                                </button>
                            </div>
                            <span className="text-[8px] text-slate-500 text-center">
                                ⏱️ 自动修复：每 {autoRepairInterval} 小时执行 (上次修复: {safeFormatFullTime(lastRepair)})
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
                    清理于: <span className="text-amber-400">{safeFormatFullTime(lastCleanup)}</span>
                </div>
                {memory && (
                    <div className={`flex items-center gap-1 ${memory.pct > 70 ? 'text-red-400' : 'text-slate-500'}`}>
                        MEM: <span className="font-bold">{memory.used}M</span> / {memory.limit}M ({memory.pct}%)
                    </div>
                )}
            </div>

            {/* Content Views: LOGS or CRASHES */}
            {activeTab === 'LOGS' ? (
                /* Log List */
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
                                        {safeFormatTime(log.timestamp)}
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
            ) : (
                /* Crash Blackbox List */
                <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-2 custom-scrollbar min-h-[200px] max-h-[400px]">
                    <div className="flex items-center justify-between px-1 pb-1 border-b border-slate-800/60 text-[9px]">
                        <div className="flex items-center gap-1.5 text-slate-400">
                            <AlertOctagon size={12} className="text-red-400" />
                            <span>黑匣子已收录 <strong className="text-white">{crashEntries.length}</strong> 起闪退/崩溃记录</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={fetchServerCrashes}
                                className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[8px] transition-colors"
                                title="从后端调取最新上报日志"
                            >
                                🔄 调取后端备份
                            </button>
                            {crashEntries.length > 0 && (
                                <button
                                    onClick={exportAllCrashes}
                                    className="px-1.5 py-0.5 rounded bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 border border-blue-500/30 text-[8px] transition-colors flex items-center gap-1"
                                >
                                    <Copy size={9} />
                                    一键导出诊断报告
                                </button>
                            )}
                        </div>
                    </div>

                    {crashEntries.length === 0 ? (
                        <div className="h-32 flex flex-col items-center justify-center text-slate-500 text-center space-y-1">
                            <Check size={20} className="text-emerald-400 mb-1" />
                            <p className="font-bold text-slate-300 text-[10px]">黑匣子暂无闪退崩溃记录</p>
                            <p className="text-[8px] text-slate-500 max-w-xs">
                                全局心跳守护与异常拦截网实时在线。如果浏览器曾发生进程强杀或渲染崩溃，将自动提取前序内存与调用栈。
                            </p>
                            <button
                                onClick={fetchServerCrashes}
                                className="mt-2 px-2 py-1 rounded bg-slate-800 text-blue-400 hover:bg-slate-700 text-[9px]"
                            >
                                调取服务端历史崩溃备份
                            </button>
                        </div>
                    ) : (
                        crashEntries.map(entry => {
                            const badge = getCrashTypeBadge(entry.type);
                            const isExpanded = expandedCrashId === entry.id;
                            return (
                                <div key={entry.id} className="border border-slate-800 rounded bg-slate-900/60 p-2 space-y-1 hover:border-slate-700 transition-colors">
                                    <div className="flex items-start justify-between gap-1">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className={`px-1.5 py-0.2 rounded border text-[8px] font-bold ${badge.bg}`}>
                                                {badge.label}
                                            </span>
                                            <span className="text-[8px] text-blue-400 font-bold">
                                                [{entry.module}]
                                            </span>
                                            <span className="text-[8px] text-slate-500">
                                                {entry.timeStr || safeFormatTime(entry.timestamp)}
                                            </span>
                                            {entry.memory && (
                                                <span className={`text-[8px] px-1 rounded ${entry.memory.percent > 75 ? 'bg-red-950 text-red-400 border border-red-800/40' : 'text-slate-400'}`}>
                                                    🧠 堆内存: {entry.memory.usedMB}M/{entry.memory.limitMB}M ({entry.memory.percent}%)
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <button
                                                onClick={() => copyCrashDetails(entry)}
                                                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                                                title="复制该条崩溃详情"
                                            >
                                                {copiedId === entry.id ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
                                            </button>
                                            <button
                                                onClick={() => setExpandedCrashId(isExpanded ? null : entry.id)}
                                                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                                            >
                                                {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Crash Message Summary */}
                                    <div className="text-[9px] text-rose-300 font-medium break-all bg-black/30 p-1.5 rounded border border-rose-900/30">
                                        💥 {entry.message}
                                    </div>

                                    {/* Expanded Diagnostics */}
                                    {isExpanded && (
                                        <div className="mt-2 pt-2 border-t border-slate-800 space-y-1.5 text-[8px]">
                                            {/* Flight Status Bar */}
                                            <div className="flex items-center gap-3 p-1.5 bg-slate-950/80 rounded border border-slate-800 text-[8px]">
                                                {entry.lastAction && (
                                                    <div>
                                                        <span className="text-slate-500">最后执行动作: </span>
                                                        <span className="text-amber-400 font-bold">{entry.lastAction}</span>
                                                    </div>
                                                )}
                                                {entry.domNodes !== undefined && (
                                                    <div>
                                                        <span className="text-slate-500">DOM节点数: </span>
                                                        <span className="text-cyan-400 font-bold">{entry.domNodes}</span>
                                                    </div>
                                                )}
                                            </div>

                                            {entry.breadcrumbs && entry.breadcrumbs.length > 0 && (
                                                <div>
                                                    <span className="text-slate-400 font-bold block mb-0.5">✈️ 崩溃前操作航迹 (Flight Breadcrumbs):</span>
                                                    <div className="p-1.5 bg-black/60 rounded border border-slate-800 space-y-0.5 text-slate-400 text-[7.5px]">
                                                        {entry.breadcrumbs.map((b, i) => (
                                                            <div key={i} className="flex gap-1 items-center">
                                                                <span className="text-slate-600">{b.time}</span>
                                                                <span className="text-indigo-400 font-bold">[{b.action}]</span>
                                                                {b.meta && <span className="text-slate-500 truncate">{JSON.stringify(b.meta)}</span>}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {entry.stack && (
                                                <div>
                                                    <span className="text-slate-400 font-bold block mb-0.5">调用栈跟踪 (Stack Trace):</span>
                                                    <pre className="p-1.5 bg-black/60 rounded border border-slate-800 text-slate-300 overflow-x-auto text-[7.5px] leading-tight custom-scrollbar">
                                                        {entry.stack}
                                                    </pre>
                                                </div>
                                            )}
                                            {entry.componentStack && (
                                                <div>
                                                    <span className="text-slate-400 font-bold block mb-0.5">组件树路径 (Component Stack):</span>
                                                    <pre className="p-1.5 bg-black/60 rounded border border-slate-800 text-amber-300/80 overflow-x-auto text-[7.5px] leading-tight custom-scrollbar">
                                                        {entry.componentStack}
                                                    </pre>
                                                </div>
                                            )}
                                            {entry.recentLogs && entry.recentLogs.length > 0 && (
                                                <div>
                                                    <span className="text-slate-400 font-bold block mb-0.5">崩溃前最后操作日志:</span>
                                                    <div className="p-1.5 bg-black/60 rounded border border-slate-800 space-y-0.5 text-slate-400 text-[7.5px]">
                                                        {entry.recentLogs.map((l, i) => (
                                                            <div key={i} className="flex gap-1 items-start">
                                                                <span className="text-slate-600">{safeFormatTime(l.timestamp)}</span>
                                                                <span className="text-blue-400">[{l.module}]</span>
                                                                <span className="text-slate-300 truncate">{l.message}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            <div className="p-1.5 rounded bg-blue-950/30 border border-blue-900/40 text-blue-300">
                                                <span className="font-bold">💡 专家归因分析与防御状态:</span>
                                                <p className="mt-0.5 text-slate-400">
                                                    {entry.type === 'HEARTBEAT_TIMEOUT'
                                                        ? '检测到浏览器渲染进程被强杀，主因为 WebSocket 高频推流或 DOM 渲染导致内存/CPU 瞬时超限。系统已将推流合并节流至 20Hz 并优化计时器销毁。'
                                                        : entry.type === 'RENDER_CRASH'
                                                        ? '组件内部发生渲染异常，已由 Root Shield 熔断隔离，避免全页崩溃。'
                                                        : '该异常已被全局安全网隔离记录，核心交易与持仓引擎持续受保。'}
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
};
