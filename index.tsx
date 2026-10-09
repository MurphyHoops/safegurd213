// --- 0. DEBUG PERFORMANCE.MEASURE ---
if (typeof window !== 'undefined' && window.performance && typeof window.performance.measure === 'function') {
    const originalMeasure = window.performance.measure;
    window.performance.measure = function(name: string, startMark?: string | PerformanceMeasureOptions, endMark?: string) {
        try {
            return originalMeasure.apply(this, arguments as any);
        } catch (e) {
            console.warn('🛡️ [Performance Monitor] Bypassed measure error (non-fatal):', name, e);
            // DO NOT rethrow the exception. Performance measure errors should never crash the application.
        }
    };
}
// --- 1. SETUP PERSISTENT RAW SYSTEM LOG INTERCEPTOR ---
const persistRawSystemLog = (level: 'INFO' | 'WARN' | 'ERROR' | 'PERF', module: string, message: string, details?: any) => {
    try {
        if (typeof window === 'undefined') return;
        const raw = localStorage.getItem('SAVIOR_SYSTEM_MONITOR_LOGS');
        let logs: any[] = [];
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    logs = parsed;
                }
            } catch (err) {
                // If corrupted, initialize empty
            }
        }
        
        const newLog = {
            id: Math.random().toString(36).substring(2, 9),
            timestamp: Date.now(),
            level,
            module,
            message,
            details
        };
        
        // Cap at 200 items to prevent storage bloat
        const updated = [newLog, ...logs].slice(0, 200);
        localStorage.setItem('SAVIOR_SYSTEM_MONITOR_LOGS', JSON.stringify(updated));
    } catch (e) {
        console.warn('[Panic Shield] LocalStorage sync log failed:', e);
    }
};

// --- 2. SETUP PANIC HANDLER (CORE EMERGENCY UI) ---
const reportPanic = (message: string, source?: string, lineno?: number) => {
    // Standardize the error message
    let displayMsg = String(message || 'Unknown Execution Error');
    
    // "Script error." is a common browser security mask for real errors
    if (displayMsg === 'Script error.') {
        displayMsg = '浏览器的安全策略隐藏了具体错误原因 (CORS Masked Error). 这通常由动态脚本加载中断引起。';
    }

    console.warn('🛡️ [System Guard] Runtime exception safely isolated:', displayMsg, source, lineno);
    persistRawSystemLog('WARN', 'SHIELD', `【运行时隔离保护】${displayMsg}`, { source, lineno, time: new Date().toISOString() });
};

// --- 3. REGISTER LISTENERS IMMEDIATELY (ZERO INTERRUPTION TO APP) ---
try {
    const rawBox = localStorage.getItem('SAVIOR_CRASH_BLACKBOX');
    if (rawBox && rawBox.includes('isAnyFuseEnabled')) {
        const parsed = JSON.parse(rawBox);
        const filtered = parsed.filter((x: any) => !String(x?.message || '').includes('isAnyFuseEnabled'));
        localStorage.setItem('SAVIOR_CRASH_BLACKBOX', JSON.stringify(filtered));
    }
} catch (_) {}

window.addEventListener('error', (event) => {
    try {
        const errorEvent = event as any;
        const msg = errorEvent?.message || errorEvent?.error?.message || 'Global Window Error';
        if (String(msg).includes('isAnyFuseEnabled')) return;
        const stack = errorEvent?.error?.stack;
        console.warn('🛡️ [System Shield] Isolated window error (non-fatal):', msg);
        persistRawSystemLog('ERROR', 'SHIELD', `【全局错误拦截】${msg}`, { stack, filename: errorEvent?.filename, lineno: errorEvent?.lineno });
        
        // Write to permanent crash blackbox
        try {
            const rawBox = localStorage.getItem('SAVIOR_CRASH_BLACKBOX');
            const box = rawBox ? JSON.parse(rawBox) : [];
            box.unshift({
                id: 'err_' + Date.now().toString(36),
                timestamp: Date.now(),
                timeStr: new Date().toLocaleString(),
                module: 'WINDOW_GLOBAL',
                message: msg,
                stack: stack || `${errorEvent?.filename}:${errorEvent?.lineno}:${errorEvent?.colno}`,
                type: 'UNHANDLED_ERROR'
            });
            localStorage.setItem('SAVIOR_CRASH_BLACKBOX', JSON.stringify(box.slice(0, 20)));
        } catch (_) {}
    } catch (_) {}
});

window.addEventListener('unhandledrejection', (event) => {
    try {
        let reasonText = event?.reason instanceof Error ? event.reason.message : String(event?.reason || '');
        const stack = event?.reason instanceof Error ? event.reason.stack : undefined;
        
        // 🔒 [HMR & Dev Socket Ignore]: Vite HMR WebSocket issues are non-fatal development artifacts and must not trigger crashes
        if (
            reasonText.includes('WebSocket closed without opened') || 
            reasonText.includes('@vite/client') ||
            (stack && stack.includes('@vite/client'))
        ) {
            console.warn('🛡️ [System Guard] Bypassed dev HMR WebSocket failure (non-fatal):', reasonText);
            return;
        }

        console.warn('⚠️ [System Guard] Background async failure isolated:', reasonText);
        persistRawSystemLog('WARN', 'SHIELD', `【背景异步限扰】时效任务或接口异常: ${reasonText}`);
        
        // Write to permanent crash blackbox if critical
        if (reasonText && !reasonText.includes('Network is offline') && !reasonText.includes('Failed to fetch')) {
            try {
                const rawBox = localStorage.getItem('SAVIOR_CRASH_BLACKBOX');
                const box = rawBox ? JSON.parse(rawBox) : [];
                box.unshift({
                    id: 'rej_' + Date.now().toString(36),
                    timestamp: Date.now(),
                    timeStr: new Date().toLocaleString(),
                    module: 'PROMISE_REJECTION',
                    message: reasonText,
                    stack,
                    type: 'UNHANDLED_REJECTION'
                });
                localStorage.setItem('SAVIOR_CRASH_BLACKBOX', JSON.stringify(box.slice(0, 20)));
            } catch (_) {}
        }
    } catch (_) {}
});

console.log('🚀 [Boot] Panic Shield Active.');
persistRawSystemLog('INFO', 'BOOT', '🛡️ 应急恢复系统启动 (Panic Shield Active)');

// --- Log initial browser diagnostic info ---
try {
    const lStorageSize = Object.keys(localStorage).reduce((sum, key) => sum + (localStorage.getItem(key) || '').length, 0);
    const diagnostics = {
        userAgent: navigator.userAgent,
        screen: `${window.screen.width}x${window.screen.height}`,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        devicePixelRatio: window.devicePixelRatio,
        localStorageUsedBytes: lStorageSize,
        cookieEnabled: navigator.cookieEnabled,
        online: navigator.onLine,
        webSocketSupport: 'WebSocket' in window
    };
    persistRawSystemLog('INFO', 'BOOT', `【设备自检】环境自检录入。已用缓存: ${(lStorageSize/1024).toFixed(1)} KB`, diagnostics);
} catch (e) {
    console.warn('Failed to log browser diagnostics:', e);
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

console.log('🚀 [Boot] Entry point modules importing...');
persistRawSystemLog('INFO', 'BOOT', '🚀 载入主入口文件 (Entry point modules importing)');


// --- 4. MOUNT REACT ---
const rootElement = document.getElementById('root');
if (!rootElement) {
    persistRawSystemLog('ERROR', 'BOOT', '❌ 缺失 #root 主渲染节点');
    reportPanic("Missing #root element");
} else {
    console.log('🚀 [Boot] Mounting React...');
    persistRawSystemLog('INFO', 'BOOT', '🚀 启动 React 渲染引擎挂载 (Mounting React)');
    (window as any).isReactReady = true;
    (window as any).__MAIN_APP_MOUNTED__ = true;

    // 清理启动遮罩
    try {
        const shield = document.getElementById('boot-shield');
        if (shield) shield.remove();
    } catch (e) {}

    ReactDOM.createRoot(rootElement).render(
        <ErrorBoundary moduleName="Root Shield">
            <App />
        </ErrorBoundary>
    );
    persistRawSystemLog('INFO', 'BOOT', '✅ React 成功执行并挂载完成');
}
