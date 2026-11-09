/**
 * 🛡️ [Client Forensic Probe - Ultimate Version] 前端终极法医探针
 * services/clientForensicProbe.ts
 * 
 * 浏览器兼容：纯客户端代码，不依赖 Node.js 的 fs/path 模块。
 * 包含：
 * 1. 基础物理指标采集（DOM数、堆内存）
 * 2. 探针 1：主线程卡顿与延迟探测（Event Loop Lag - 检测假死）
 * 3. 探针 2：全局异常捕获钩子（Fatal JS Error & Unhandled Rejection - 捕获代码崩溃）
 * 4. 探针 3：页面卸载诱因标记（Unload / Close Tracker - 追踪退出原因）
 */

let isProbeStarted = false;

export const startClientForensicProbe = () => {
  if (typeof window === 'undefined' || isProbeStarted) return;
  isProbeStarted = true;

  // -------------------------------------------------------------
  // 1. 基础指标采集与 探针 1：主线程卡顿延迟探测 (Event Loop Lag)
  // -------------------------------------------------------------
  let lastTickTime = Date.now();

  setInterval(() => {
    try {
      const now = Date.now();
      const delta = now - lastTickTime;
      lastTickTime = now;
      
      // 预期是 1000ms。如果实际 delta 远大于 1500ms，说明主线程发生了卡顿或死锁
      const lagMs = delta - 1000;
      const isMainThreadBlocked = lagMs > 500; // 超过 500ms 额外延迟即标记主线程受阻

      // 采集 DOM 节点数
      const domCount = document.getElementsByTagName('*').length;

      // 采集 JS 堆内存
      let heapMB = 0;
      if ((performance as any).memory) {
        heapMB = Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024);
      }

      // 上报指标（若主线程被卡死，该请求可能延迟发出，但会在恢复或临终前留痕）
      fetch('/api/telemetry/forensic-metric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientHeapMB: heapMB,
          domNodeCount: domCount,
          customNote: isMainThreadBlocked ? `⚠️_MAIN_THREAD_LAG_${lagMs}ms` : (window.location.hash || window.location.pathname || 'MAIN_VIEW')
        })
      }).catch(() => {});
    } catch (_) {}
  }, 1000);

  // -------------------------------------------------------------
  // 2. 探针 2：全局异常捕获钩子 (Fatal JS Error & Unhandled Rejection)
  // -------------------------------------------------------------
  window.addEventListener('error', (event) => {
    try {
      const errorPayload = {
        clientHeapMB: (performance as any).memory ? Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024) : 0,
        domNodeCount: document.getElementsByTagName('*').length,
        customNote: `❌_FATAL_ERROR: ${event.message || 'Unknown'} at ${event.filename || 'unknown'}:${event.lineno || 0}`
      };
      
      // 使用 sendBeacon 确保在页面崩溃或跳转的瞬间也能把错误堆栈强行发给后端落盘
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/telemetry/forensic-metric', JSON.stringify(errorPayload));
      }
    } catch (_) {}
  });

  window.addEventListener('unhandledrejection', (event) => {
    try {
      const reason = event.reason?.message || String(event.reason || 'Unknown Promise Rejection');
      const errorPayload = {
        clientHeapMB: (performance as any).memory ? Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024) : 0,
        domNodeCount: document.getElementsByTagName('*').length,
        customNote: `❌_UNHANDLED_REJECTION: ${reason.substring(0, 100)}`
      };
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/telemetry/forensic-metric', JSON.stringify(errorPayload));
      }
    } catch (_) {}
  });

  // -------------------------------------------------------------
  // 3. 探针 3：页面卸载诱因标记 (Unload / Close Tracker)
  // -------------------------------------------------------------
  window.addEventListener('beforeunload', () => {
    try {
      const unloadPayload = {
        clientHeapMB: (performance as any).memory ? Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024) : 0,
        domNodeCount: document.getElementsByTagName('*').length,
        customNote: '🛑_PAGE_BEFORE_UNLOAD'
      };
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/telemetry/forensic-metric', JSON.stringify(unloadPayload));
      }
    } catch (_) {}
  });
};
