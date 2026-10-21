import { create } from 'zustand';
import { priceRegistry } from '../priceRegistry';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'PERF';

export interface SystemLog {
    id: string;
    timestamp: number;
    level: LogLevel;
    module: string;
    message: string;
    details?: any;
}

export interface CrashBlackboxEntry {
    id: string;
    timestamp: number;
    timeStr: string;
    module: string;
    message: string;
    stack?: string;
    componentStack?: string;
    memory?: {
        usedMB: number;
        limitMB: number;
        percent: number;
    };
    domNodes?: number;
    lastAction?: string;
    recentLogs?: SystemLog[];
    breadcrumbs?: Array<{ time: string; action: string; meta?: any }>;
    type: 'RENDER_CRASH' | 'UNHANDLED_ERROR' | 'UNHANDLED_REJECTION' | 'OOM_ALERT' | 'HEARTBEAT_TIMEOUT' | 'BROWSER_TAB_KILL' | 'EVENT_LOOP_FREEZE';
}

const CRASH_BLACKBOX_KEY = 'SAVIOR_CRASH_BLACKBOX';
const FLIGHT_RECORDER_KEY = 'SAVIOR_FLIGHT_RECORDER';
const CLEAN_EXIT_KEY = 'SAVIOR_CLEAN_EXIT';

// Rolling in-memory breadcrumbs
const recentBreadcrumbs: Array<{ time: string; action: string; meta?: any }> = [];
const MAX_BREADCRUMBS = 20;

export const recordBreadcrumb = (action: string, meta?: any) => {
    try {
        const item = {
            time: new Date().toLocaleTimeString(),
            action,
            meta
        };
        recentBreadcrumbs.push(item);
        if (recentBreadcrumbs.length > MAX_BREADCRUMBS) {
            recentBreadcrumbs.shift();
        }
    } catch (_) {}
};

export const getCrashBlackbox = (): CrashBlackboxEntry[] => {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(CRASH_BLACKBOX_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                // Filter out invalid items or corrupt logs
                const sanitized = parsed.filter(item => {
                    if (!item) return false;
                    const msg = String(item.message || '');
                    if (msg.includes('isAnyFuseEnabled')) return false;
                    if (msg.includes('handleDragonHeadUpdate')) return false;
                    return true;
                });
                if (sanitized.length !== parsed.length) {
                    localStorage.setItem(CRASH_BLACKBOX_KEY, JSON.stringify(sanitized));
                }
                return sanitized;
            }
        }
    } catch (_) {}
    return [];
};

export const clearCrashBlackbox = (): void => {
    if (typeof window === 'undefined') return;
    try {
        localStorage.removeItem(CRASH_BLACKBOX_KEY);
        localStorage.removeItem(FLIGHT_RECORDER_KEY);
        localStorage.removeItem('SAVIOR_CRASH_COUNT');
        localStorage.removeItem('SAVIOR_LAST_CRASH_TIME');
    } catch (_) {}
};

/**
 * 🧹 [DEEP SYSTEM CLEANUP & ANTI-EXPLOSION RESET]
 * Thoroughly purges crash blackbox, redundant flight data, bloated logs, and temporary caches
 * WITHOUT touching user trading settings, API keys, active positions, or strategy configs!
 */
export const deepCleanAndResetSystem = (): { freedItems: number; details: string[] } => {
    if (typeof window === 'undefined') return { freedItems: 0, details: [] };
    const details: string[] = [];
    let freedItems = 0;

    // 1. Clear Crash Blackbox and flight telemetry
    try {
        localStorage.removeItem(CRASH_BLACKBOX_KEY);
        localStorage.removeItem(FLIGHT_RECORDER_KEY);
        localStorage.removeItem(CLEAN_EXIT_KEY);
        localStorage.removeItem('SAVIOR_CRASH_COUNT');
        localStorage.removeItem('SAVIOR_LAST_CRASH_TIME');
        details.push('清空崩溃黑匣子与飞行监控记录 (5 项)');
        freedItems += 5;
    } catch (_) {}

    // 2. Truncate heavy monitor logs to last 20
    try {
        const raw = localStorage.getItem('SAVIOR_SYSTEM_MONITOR_LOGS');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 20) {
                localStorage.setItem('SAVIOR_SYSTEM_MONITOR_LOGS', JSON.stringify(parsed.slice(0, 20)));
                details.push(`截断系统监控日志 (${parsed.length} -> 20 条)`);
                freedItems += (parsed.length - 20);
            }
        }
    } catch (_) {}

    // 3. Clear temporary scanner caches & pools (strictly safe, no user settings touched)
    const tempKeys = [
        'SCANNER_LIST2_CACHE_MAP',
        'SCANNER_LIST3_CACHE_MAP',
        'SCANNER_LIST4_CACHE_MAP',
        'SCANNER_RAW_DATA',
        'SCANNER_LIST2_RESULTS',
        'SCANNER_LIST3_RESULTS',
        'SCANNER_LIST4_RESULTS',
        'SCANNER_SIDEWAYS_FILTERED_POOL',
        'SCANNER_MAJOR_TREND_CANDIDATES'
    ];
    let tempCleanCount = 0;
    tempKeys.forEach(k => {
        try {
            if (localStorage.getItem(k) !== null) {
                localStorage.removeItem(k);
                tempCleanCount++;
                freedItems++;
            }
        } catch (_) {}
    });
    if (tempCleanCount > 0) {
        details.push(`清理扫描器临时计算缓存与底池 (${tempCleanCount} 项)`);
    }

    // 4. Clean window memory objects
    try {
        delete (window as any).__KLINE_CACHE__;
        delete (window as any).__PRICE_HISTORY_CACHE__;
        delete (window as any).__TEMP_CHART_TICKS__;
        details.push('重置内存中临时 K 线与图表对象池');
    } catch (_) {}

    // 5. Sweep DOM Registry zombie elements
    try {
        const swept = priceRegistry.sweepZombieElements();
        if (swept.cleanedPrice > 0 || swept.cleanedPnl > 0) {
            details.push(`清理 DOM Bypass 游离死节点 (价格: ${swept.cleanedPrice}, 盈亏: ${swept.cleanedPnl})`);
        }
    } catch (_) {}

    // 6. Broadcast event
    try {
        window.dispatchEvent(new CustomEvent('SAVIOR_CRASH_UPDATED', { detail: null }));
    } catch (_) {}

    return { freedItems, details };
};

export const recordCrashToBlackbox = (params: {
    module: string;
    message: string;
    stack?: string;
    componentStack?: string;
    type?: CrashBlackboxEntry['type'];
    memory?: CrashBlackboxEntry['memory'];
    domNodes?: number;
    lastAction?: string;
    details?: any;
}): void => {
    if (typeof window === 'undefined') return;
    if (String(params.message || '').includes('isAnyFuseEnabled')) return;
    try {
        const existing = getCrashBlackbox();
        const now = Date.now();
        
        let memInfo: any = params.memory;
        if (!memInfo) {
            const perf = (window.performance as any);
            if (perf && perf.memory) {
                const usedMB = Math.round(perf.memory.usedJSHeapSize / 1048576);
                const limitMB = Math.round(perf.memory.jsHeapSizeLimit / 1048576);
                memInfo = {
                    usedMB,
                    limitMB,
                    percent: Math.round((usedMB / limitMB) * 100)
                };
            }
        }

        const domNodes = params.domNodes || (typeof document !== 'undefined' ? document.getElementsByTagName('*').length : 0);
        const recentLogs = useMonitorStore.getState().logs.slice(0, 10);

        const newEntry: CrashBlackboxEntry = {
            id: 'crash_' + now.toString(36) + '_' + Math.random().toString(36).substring(2, 6),
            timestamp: now,
            timeStr: new Date(now).toLocaleString(),
            module: params.module,
            message: params.message,
            stack: params.stack,
            componentStack: params.componentStack,
            memory: memInfo,
            domNodes,
            lastAction: params.lastAction || (recentBreadcrumbs.length > 0 ? recentBreadcrumbs[recentBreadcrumbs.length - 1].action : 'UNKNOWN'),
            recentLogs,
            breadcrumbs: [...recentBreadcrumbs],
            type: params.type || 'RENDER_CRASH'
        };

        const updated = [newEntry, ...existing].slice(0, 30); // Keep last 30 crash records
        localStorage.setItem(CRASH_BLACKBOX_KEY, JSON.stringify(updated));

        try {
            window.dispatchEvent(new CustomEvent('SAVIOR_CRASH_UPDATED', { detail: newEntry }));
        } catch (_) {}

        // Asynchronously backup to server crash logs
        if (typeof fetch !== 'undefined') {
            fetch('/api/monitor/crash-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newEntry)
            }).catch(() => {});
        }

        // Also record a notification log to monitor store as WARN so it is visible without tripping fatal error handlers
        useMonitorStore.getState().addLog('WARN', 'CRASH_SHIELD', `💥 [异常已记录到黑匣子] ${params.module}: ${params.message}`, {
            memory: memInfo,
            timeStr: newEntry.timeStr,
            lastAction: newEntry.lastAction
        });
    } catch (e) {
        console.error('[CrashBlackbox] Failed to record crash:', e);
    }
};

interface MonitorState {
    logs: SystemLog[];
    maxLogs: number;
    autoClearInterval: number; // minutes
    lastCleanup: number;
    isMonitoring: boolean;
    
    // Actions
    addLog: (level: LogLevel, module: string, message: string, details?: any) => void;
    clearLogs: () => void;
    setMaxLogs: (n: number) => void;
    setAutoClearInterval: (n: number) => void;
    performCleanup: () => void;
}

let persistTimer: any = null;
const schedulePersistLogs = (logs: SystemLog[]) => {
    if (typeof window === 'undefined') return;
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
        persistTimer = null;
        try {
            localStorage.setItem('SAVIOR_SYSTEM_MONITOR_LOGS', JSON.stringify(logs.slice(0, 150)));
        } catch (_) {}
    }, 1000);
};

export const useMonitorStore = create<MonitorState>((set, get) => {
    // 1. Recover logs safely from localStorage
    let initialLogs: SystemLog[] = [];
    let initialMaxLogs = 200;
    let initialAutoClearInterval = 60;
    let initialLastCleanup = Date.now();

    if (typeof window !== 'undefined') {
        try {
            const raw = localStorage.getItem('SAVIOR_SYSTEM_MONITOR_LOGS');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    initialLogs = parsed.filter(l => l && typeof l === 'object' && l.id && l.message && typeof l.timestamp === 'number' && !isNaN(l.timestamp));
                }
            }
        } catch (e) {
            console.error('[SystemMonitor] Corrupted logs found, resetting...', e);
            try { localStorage.removeItem('SAVIOR_SYSTEM_MONITOR_LOGS'); } catch (_) {}
        }

        try {
            const savedMax = localStorage.getItem('SAVIOR_MONITOR_MAX_LOGS');
            if (savedMax) initialMaxLogs = parseInt(savedMax) || 200;
            
            const savedInterval = localStorage.getItem('SAVIOR_MONITOR_AUTO_CLEAR_INTERVAL');
            if (savedInterval) initialAutoClearInterval = parseInt(savedInterval) || 60;

            const savedLastCleanup = localStorage.getItem('SAVIOR_MONITOR_LAST_CLEANUP');
            if (savedLastCleanup) initialLastCleanup = parseInt(savedLastCleanup) || Date.now();
        } catch (e) {}
    }

    return {
        logs: initialLogs,
        maxLogs: initialMaxLogs,
        autoClearInterval: initialAutoClearInterval,
        lastCleanup: initialLastCleanup,
        isMonitoring: true,

        addLog: (level, module, message, details) => {
            const newLog: SystemLog = {
                id: Math.random().toString(36).substring(2, 9),
                timestamp: Date.now(),
                level,
                module,
                message,
                details
            };

            set(state => {
                const updatedLogs = [newLog, ...state.logs].slice(0, state.maxLogs);
                schedulePersistLogs(updatedLogs);
                return { logs: updatedLogs };
            });

            if (level === 'ERROR') {
                console.error(`[${module}] ${message}`, details);
            }
        },

        clearLogs: () => {
            set({ logs: [] });
            if (typeof window !== 'undefined') {
                try {
                    localStorage.removeItem('SAVIOR_SYSTEM_MONITOR_LOGS');
                } catch (e) {}
            }
        },
        
        setMaxLogs: (maxLogs) => {
            set({ maxLogs });
            if (typeof window !== 'undefined') {
                try {
                    localStorage.setItem('SAVIOR_MONITOR_MAX_LOGS', maxLogs.toString());
                } catch (e) {}
            }
        },
        
        setAutoClearInterval: (autoClearInterval) => {
            const validInterval = Math.max(1, autoClearInterval);
            set({ autoClearInterval: validInterval });
            if (typeof window !== 'undefined') {
                try {
                    localStorage.setItem('SAVIOR_MONITOR_AUTO_CLEAR_INTERVAL', validInterval.toString());
                } catch (e) {}
            }
        },

        performCleanup: () => {
            const now = Date.now();
            const curLogs = get().logs;
            const preservedLogs = curLogs.slice(0, 40);
            set({ logs: preservedLogs, lastCleanup: now });
            
            if (typeof window !== 'undefined') {
                try {
                    localStorage.setItem('SAVIOR_SYSTEM_MONITOR_LOGS', JSON.stringify(preservedLogs));
                    localStorage.setItem('SAVIOR_MONITOR_LAST_CLEANUP', now.toString());
                } catch (e) {
                    console.error('[SystemMonitor] Cleanup failed', e);
                }
            }
        }
    };
});

// Expose store globally for System Shield access
if (typeof window !== 'undefined') {
    (window as any).__SYSTEM_MONITOR_STORE__ = useMonitorStore;
}

// Utility for global access
export const logger = {
    info: (mod: string, msg: string, data?: any) => useMonitorStore.getState().addLog('INFO', mod, msg, data),
    warn: (mod: string, msg: string, data?: any) => useMonitorStore.getState().addLog('WARN', mod, msg, data),
    error: (mod: string, msg: string, data?: any) => useMonitorStore.getState().addLog('ERROR', mod, msg, data),
    perf: (mod: string, msg: string, data?: any) => useMonitorStore.getState().addLog('PERF', mod, msg, data),
};

// --- CRASH BACKEND SYNC & FLIGHT RECORDER WATCHDOG ---
const syncedCrashIds = new Set<string>();
export const syncCrashesToBackend = async () => {
    if (typeof window === 'undefined') return;
    try {
        const local = getCrashBlackbox();
        for (const entry of local.slice(0, 10)) {
            if (!entry || !entry.id || syncedCrashIds.has(entry.id)) continue;
            if (String(entry.message || '').includes('isAnyFuseEnabled')) continue;
            syncedCrashIds.add(entry.id);
            fetch('/api/monitor/crash-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(entry)
            }).catch(() => {});
        }
    } catch (_) {}
};

/**
 * ✈️ FLIGHT RECORDER & AUTOPSY ENGINE (飞行数据记录仪与死因法医分析引擎)
 * Every 1s, records a persistent heartbeat snapshot into LocalStorage.
 * On subsequent boot, inspects whether previous session terminated abnormally (Aw, Snap / OOM / Process Kill).
 */
export const initCrashWatchdog = () => {
    if (typeof window === 'undefined') return;
    try {
        const now = Date.now();
        const rawRecorder = localStorage.getItem(FLIGHT_RECORDER_KEY);
        const wasCleanExit = localStorage.getItem(CLEAN_EXIT_KEY) === 'true';

        // 1. AUTOPSY ON PREVIOUS SESSION
        if (rawRecorder && !wasCleanExit) {
            try {
                const prev = JSON.parse(rawRecorder);
                const timeDiff = now - (prev.timestamp || 0);

                // 只要前后会话时间差合理，且属于非正常退出，100% 完整录入死因黑匣子
                if (timeDiff > 2000 && timeDiff < 48 * 3600 * 1000) {
                    const usedMB = prev.memory?.usedMB || 0;
                    const limitMB = prev.memory?.limitMB || 4096;
                    const memPct = prev.memory?.percent || 0;
                    const lastAction = prev.lastAction || 'UNKNOWN';
                    const domNodes = prev.domNodes || 0;

                    let inferredReason = '系统强杀/显卡驱动重置/进程异常终止 (Abnormal Process Exit)';
                    let crashType: CrashBlackboxEntry['type'] = 'BROWSER_TAB_KILL';

                    if (memPct > 75 || usedMB > 1400) {
                        inferredReason = `V8 堆内存溢出 (OOM) 崩溃 - 崩溃前已使用: ${usedMB}MB / ${limitMB}MB (${memPct}%)`;
                        crashType = 'OOM_ALERT';
                    } else if (prev.isEventLoopBlocked) {
                        inferredReason = '主线程事件循环无限死循环阻塞 (Event Loop Freeze)';
                        crashType = 'EVENT_LOOP_FREEZE';
                    } else if (domNodes > 3000) {
                        inferredReason = `DOM 节点过度堆积导致渲染瓦解 (DOM Leaked: ${domNodes} 节点)`;
                        crashType = 'RENDER_CRASH';
                    }

                    recordCrashToBlackbox({
                        module: 'BROWSER_AUTOPSY',
                        message: `${inferredReason} [最后心跳时间: ${new Date(prev.timestamp).toLocaleTimeString()}, 最后执行动作: ${lastAction}, 内存: ${usedMB}MB(${memPct}%), DOM节点: ${domNodes}]`,
                        type: crashType,
                        memory: prev.memory,
                        domNodes,
                        lastAction,
                        details: {
                            autopsyTimestamp: now,
                            prevFlightData: prev
                        }
                    });
                }
            } catch (parseErr) {
                console.warn('[CrashWatchdog] Autopsy parse error:', parseErr);
            }
        }

        // 2. MARK CURRENT SESSION AS ACTIVE (NOT CLEAN EXIT UNTIL USER LEGITIMATELY CLOSES/NAVIGATES)
        localStorage.setItem(CLEAN_EXIT_KEY, 'false');

        // Clean exit hooks
        window.addEventListener('beforeunload', () => {
            localStorage.setItem(CLEAN_EXIT_KEY, 'true');
        });
        window.addEventListener('pagehide', () => {
            localStorage.setItem(CLEAN_EXIT_KEY, 'true');
        });

        // 3. START 4-SECOND TELEMETRY FLIGHT RECORDER (Lightweight, non-blocking disk sync)
        let cachedDomNodes = 0;
        let lastDomSample = 0;
        setInterval(() => {
            try {
                let memInfo = { usedMB: 0, limitMB: 4096, percent: 0 };
                const perf = (window.performance as any);
                if (perf && perf.memory) {
                    const usedMB = Math.round(perf.memory.usedJSHeapSize / 1048576);
                    const limitMB = Math.round(perf.memory.jsHeapSizeLimit / 1048576);
                    memInfo = {
                        usedMB,
                        limitMB,
                        percent: Math.round((usedMB / limitMB) * 100)
                    };
                }

                const nowTs = Date.now();
                if (nowTs - lastDomSample > 15000 && typeof document !== 'undefined') {
                    cachedDomNodes = document.getElementsByTagName('*').length;
                    lastDomSample = nowTs;
                }

                const flightData = {
                    timestamp: nowTs,
                    timeStr: new Date().toLocaleTimeString(),
                    memory: memInfo,
                    domNodes: cachedDomNodes,
                    lastAction: recentBreadcrumbs.length > 0 ? recentBreadcrumbs[recentBreadcrumbs.length - 1].action : 'IDLE',
                    recentBreadcrumbs: recentBreadcrumbs.slice(-5)
                };

                localStorage.setItem(FLIGHT_RECORDER_KEY, JSON.stringify(flightData));
            } catch (_) {}
        }, 4000);

        // Sync local crash reports to server backup
        syncCrashesToBackend();
    } catch (_) {}
};

// Initialize on module load in browser
if (typeof window !== 'undefined') {
    initCrashWatchdog();
}
