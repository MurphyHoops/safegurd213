import { create } from 'zustand';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'PERF';

export interface SystemLog {
    id: string;
    timestamp: number;
    level: LogLevel;
    module: string;
    message: string;
    details?: any;
}

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
                    // Filter corrupted or truncated logs
                    initialLogs = parsed.filter(l => l && typeof l === 'object' && l.id && l.message);
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
                
                // Persist system monitor logs to localStorage sync-style
                if (typeof window !== 'undefined') {
                    try {
                        localStorage.setItem('SAVIOR_SYSTEM_MONITOR_LOGS', JSON.stringify(updatedLogs));
                    } catch (e) {
                        console.error('[SystemMonitor] Failed to persist system logs to localStorage', e);
                    }
                }
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
            console.log('[SystemMonitor] Performing scheduled cache/log cleanup...');
            const now = Date.now();
            set({ logs: [], lastCleanup: now });
            if (typeof window !== 'undefined') {
                try {
                    localStorage.removeItem('SAVIOR_SYSTEM_MONITOR_LOGS');
                    localStorage.setItem('SAVIOR_MONITOR_LAST_CLEANUP', now.toString());
                    
                    // Also perform active cleanup for other massive key maps to prevent Quota Exceeded!
                    localStorage.removeItem('SCANNER_LIST2_CACHE_MAP');
                    localStorage.removeItem('SCANNER_LIST3_CACHE_MAP');
                    localStorage.removeItem('SCANNER_LIST4_RESULTS');
                    
                    // Truncate SAVIOR_LOGS if they exist, keeping only top 50 logs
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
                } catch (e) {
                    console.error('[SystemMonitor] Cleanup failed', e);
                }
            }
        }
    };
});

// Expose store globally for System Shield (index.tsx) access without circular imports
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
