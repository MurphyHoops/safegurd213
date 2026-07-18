// --- 0. DEBUG PERFORMANCE.MEASURE ---
if (typeof window !== 'undefined' && window.performance && typeof window.performance.measure === 'function') {
    const originalMeasure = window.performance.measure;
    window.performance.measure = function(name: string, startMark?: string | PerformanceMeasureOptions, endMark?: string) {
        try {
            return originalMeasure.apply(this, arguments as any);
        } catch (e) {
            console.error('🛡️ [Performance Monitor] Failed to measure:', name, startMark, endMark, e);
            throw e;
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

    // Ignore environment noise
    if (
        displayMsg.includes('WebSocket') || 
        displayMsg.includes('StreamLogs') || 
        displayMsg.includes('aistudio-iframe') ||
        displayMsg.includes('HMR') ||
        displayMsg.includes('hot-reload')
    ) {
        return;
    }

    // Ignore browser extensions and third-party injected scripts
    if (source && (
        source.startsWith('chrome-extension://') || 
        source.startsWith('moz-extension://') || 
        source.startsWith('safari-extension://') ||
        source.includes('safari-web-extension://') ||
        source.includes('extensions::') ||
        source.includes('browser-extension')
    )) {
        console.warn('🛡️ [System Shield] Bypassed third-party browser extension exception:', displayMsg, 'at', source);
        return;
    }

    // Ignore known harmless errors (ResizeObserver loop limit, Grammarly, password managers, autofills)
    const lowercaseMsg = displayMsg.toLowerCase();
    if (
        lowercaseMsg.includes('resizeobserver') || 
        lowercaseMsg.includes('extension') || 
        lowercaseMsg.includes('grammarly') || 
        lowercaseMsg.includes('metamask') ||
        lowercaseMsg.includes('password') ||
        lowercaseMsg.includes('lastpass') ||
        lowercaseMsg.includes('bitwarden') ||
        lowercaseMsg.includes('autofill') ||
        lowercaseMsg.includes('1password') ||
        lowercaseMsg.includes('react-devtools')
    ) {
        console.warn('🛡️ [System Shield] Handled harmless warning:', displayMsg);
        return;
    }

    // Is React fully running and is the layout intact right now?
    const root = document.getElementById('root');
    const isReactMountedAndHealthy = 
        !!(window as any).__MAIN_APP_MOUNTED__ || 
        (!!(window as any).isReactReady && root && root.innerHTML.trim().length > 150);

    if (isReactMountedAndHealthy) {
        // React is alive and running normally. This is a non-fatal, isolated exception.
        // We log it as WARN to prevent false alarms or polluting system monitor health state.
        console.warn('🛡️ [System Guard] Handled non-fatal runtime exception:', displayMsg);
        persistRawSystemLog('WARN', 'SHIELD', `【时效抗扰】非致命警告: ${displayMsg}`, { source, lineno, time: new Date().toISOString() });
        
        try {
            // @ts-ignore
            if (window.__SYSTEM_MONITOR_STORE__) {
                 // @ts-ignore
                 window.__SYSTEM_MONITOR_STORE__.getState().addLog('WARN', 'SHIELD', `运行时警告捕捉 (抗扰中): ${displayMsg}`, { source, lineno });
            }
        } catch (e) {}
    } else {
        // True bootstrap fatal/unmount crash.
        console.error('🛡️ [System Shield] Fatal Error Detected:', displayMsg);
        
        // Write directly to raw localStorage logs so it's persisted upon reload
        persistRawSystemLog('ERROR', 'SHIELD', `【致命崩溃】${displayMsg}`, { source, lineno, time: new Date().toISOString() });

        try {
            // @ts-ignore
            if (window.__SYSTEM_MONITOR_STORE__) {
                 // @ts-ignore
                 window.__SYSTEM_MONITOR_STORE__.getState().addLog('ERROR', 'SHIELD', `启动异常: ${displayMsg}`, { source, lineno });
            }
        } catch (e) {}

        // Only schedule panic UI if the app is TRULY unmounted or crashed during initial bootstrap
        // Increase wait threshold to 6.5 seconds to accommodate slow Cloud Run cold starts or bundle downloads
        setTimeout(() => {
            // RE-CHECK: If the app mounted successfully in the meantime, abort panic page rendering!
            if ((window as any).__MAIN_APP_MOUNTED__) {
                console.log("🛡️ [System Shield] Panic aborted: React app successfully completed mounting within the boot safety window.");
                return;
            }

            const root = document.getElementById('root');
            const isPanicVisible = !!document.getElementById('panic-ui');
            
            // Critical Check: If root element is near-empty after 6.5s AND the app hasn't mounted, it's a true white screen scenario
            if (!isPanicVisible && (!root || root.innerHTML.trim().length < 150)) {
                console.log("🛡️ [System Shield] Triggering panic-ui screen due to empty mount node after 6.5s.");
                const panic = document.createElement('div');
                panic.id = 'panic-ui';
                panic.style.cssText = 'position:fixed;inset:0;background:radial-gradient(circle at center, #1e293b 0%, #0f172a 100%);color:#fff;display:flex;align-items:center;justify-content:center;padding:20px;z-index:9999999;font-family:system-ui,sans-serif;text-align:center;overflow-y:auto';
                panic.innerHTML = `
                    <div style="max-width:480px;width:100%;background:rgba(30,41,59,0.8);backdrop-filter:blur(20px);padding:30px;border-radius:28px;border:1px solid #334155;box-shadow:0 25px 50px -12px rgba(0,0,0,0.8);box-sizing:border-box">
                        <div style="width:56px;height:56px;background:#ef4444;border-radius:18px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px auto;font-size:28px;line-height:56px">🛡️</div>
                        <h1 style="margin:0 0 8px 0;font-size:18px;font-weight:900;letter-spacing:-0.025em;color:#f8fafc">系统内核受阻 (KERNEL_FAIL)</h1>
                        <p style="font-size:12px;color:#94a3b8;line-height:1.5;margin-bottom:16px">
                            检测到渲染引擎无法正常载入。这可能是由于缓存冲突或网络延迟。您可以在下方直接操作修复或恢复出厂配置，避免主程序白屏锁定。
                        </p>
                        <div style="background:rgba(15,23,42,0.8);padding:12px;border-radius:12px;font-family:monospace;font-size:10px;color:#fca5a5;margin-bottom:20px;text-align:left;border:1px solid rgba(239, 68, 68, 0.2);word-break:break-all;max-height:80px;overflow-y:auto">
                            <span style="color:#64748b">DIAGNOSTIC:</span><br/>
                            ${displayMsg}
                        </div>
                        
                        <div style="display:flex;flex-direction:column;gap:10px">
                            <button onclick="location.reload()" style="width:100%;background:#4f46e5;color:white;border:none;padding:12px;border-radius:10px;font-weight:800;font-size:11px;cursor:pointer;box-shadow:0 4px 10px rgba(79, 70, 229, 0.3)">
                                仅尝试刷新页面 / 重载内核
                            </button>
                            
                            <button onclick="localStorage.removeItem('SAVIOR_LOGS');localStorage.removeItem('SAVIOR_SYSTEM_MONITOR_LOGS');localStorage.removeItem('SCANNER_LIST2_CACHE_MAP');localStorage.removeItem('SCANNER_LIST3_CACHE_MAP');localStorage.removeItem('SCANNER_LIST4_CACHE_MAP');alert('已清理系统日志与扫描器缓存，正在重载...');location.reload()" style="width:100%;background:rgba(59, 130, 246, 0.15);color:#60a5fa;border:1px solid rgba(59, 130, 246, 0.3);padding:12px;border-radius:10px;font-weight:800;font-size:11px;cursor:pointer">
                                执行修复：清理臃肿缓存 (保留个人设置)
                            </button>
                            
                            <button onclick="if(confirm('确定要清除所有系统设置和账户缓存恢复出厂配置吗？此操作不可逆。')){localStorage.clear();alert('出厂设置已还原，正在重连...');location.reload()}" style="width:100%;background:rgba(148, 163, 184, 0.1);color:#94a3b8;border:1px solid rgba(148, 163, 184, 0.2);padding:10px;border-radius:10px;font-weight:700;font-size:10px;cursor:pointer">
                                最终对策：完全清除缓存恢复出厂设置 (慎用)
                            </button>
                        </div>
                    </div>
                `;
                document.body.appendChild(panic);
            }
        }, 6500);
    }
};

// --- 3. REGISTER LISTENERS IMMEDIATELY ---
window.addEventListener('error', (event) => {
    reportPanic(event.message || 'Syntax Error', event.filename, event.lineno);
});

window.addEventListener('unhandledrejection', (event) => {
    let reasonText = '';
    if (event.reason) {
        if (event.reason instanceof Error) {
            reasonText = event.reason.message;
        } else if (typeof event.reason === 'object') {
            try {
                reasonText = JSON.stringify(event.reason);
            } catch (e) {
                reasonText = String(event.reason);
            }
        } else {
            reasonText = String(event.reason);
        }
    } else {
        reasonText = 'Unknown Rejection';
    }

    // Ignore environment noise
    if (
        reasonText.includes('WebSocket') || 
        reasonText.includes('StreamLogs') || 
        reasonText.includes('aistudio-iframe') ||
        reasonText.includes('HMR') ||
        reasonText.includes('hot-reload')
    ) {
        return;
    }

    // Check if React is mounted and running normally
    const root = document.getElementById('root');
    const isReactMounted = 
        !!(window as any).__MAIN_APP_MOUNTED__ || 
        (!!(window as any).isReactReady && root && root.innerHTML.trim().length > 150);

    if (isReactMounted) {
        // If React is mounted, background task / network failures are safe.
        // Log them as warnings to prevent diagnostic FAIL loops or scaring the user.
        console.warn('⚠️ [System Guard] Background async failure isolated:', reasonText);
        persistRawSystemLog('WARN', 'SHIELD', `【背景异步限扰】时效任务或接口异常: ${reasonText}`);
        
        try {
            // @ts-ignore
            if (window.__SYSTEM_MONITOR_STORE__) {
                 // @ts-ignore
                 window.__SYSTEM_MONITOR_STORE__.getState().addLog('WARN', 'SHIELD', `时效接口异常 (已自动隔离防止白屏): ${reasonText}`);
            }
        } catch (e) {}
    } else {
        // Uncaught boot rejection
        reportPanic(`启动异步崩溃 (Boot Async Fail): ${reasonText}`);
    }
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
    ReactDOM.createRoot(rootElement).render(
        <ErrorBoundary moduleName="Root Shield">
            <App />
        </ErrorBoundary>
    );
    persistRawSystemLog('INFO', 'BOOT', '✅ React 成功执行并挂载完成');
}
