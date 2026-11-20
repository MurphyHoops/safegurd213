/**
 * 🛡️ [SAVIOR FLIGHT RECORDER]: 轻量级前端主线程飞行记录仪 (Ring Buffer 50 条)
 * 
 * 核心能力：
 * 1. 采用容量 50 的固定环形缓冲区 (Ring Buffer)，记录核心操作轨迹 (路由、开仓、对冲、配置变更、网络请求)
 * 2. 准实时非阻塞写 LocalStorage ('SAVIOR_FLIGHT_RECORDER') 与服务端 /api/telemetry/flight-recorder
 * 3. 维持 1 秒高频心跳包 (/api/telemetry/heartbeat)，供服务端看门狗检测 Renderer 无响应或暴毙
 */

export interface FlightAction {
  id: string;
  timestamp: number;
  timeStr: string;
  actionType: string;
  details: string;
}

const MAX_RING_BUFFER = 50;
const FLIGHT_RECORDER_STORAGE_KEY = 'SAVIOR_FLIGHT_RECORDER';
let flightBuffer: FlightAction[] = [];
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const throttledActionTimestamps = new Map<string, number>();

// 初始化读取
try {
  if (typeof window !== 'undefined') {
    const raw = localStorage.getItem(FLIGHT_RECORDER_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        flightBuffer = parsed.slice(-MAX_RING_BUFFER);
      }
    }
  }
} catch (_) {}

const flushFlightBufferToStorage = () => {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(FLIGHT_RECORDER_STORAGE_KEY, JSON.stringify(flightBuffer));
    }
  } catch (_) {}
};

const scheduleFlightBufferPersist = () => {
  if (typeof window === 'undefined' || persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      localStorage.setItem(FLIGHT_RECORDER_STORAGE_KEY, JSON.stringify(flightBuffer));
    } catch (_) {}
  }, 400);
};

/**
 * 记录一条飞行行为事件
 */
export const recordFlightAction = (actionType: string, details: string | object) => {
  try {
    const now = Date.now();
    const detailsStr = typeof details === 'object' ? JSON.stringify(details) : String(details);
    const entry: FlightAction = {
      id: 'fa_' + now.toString(36) + '_' + Math.random().toString(36).substring(2, 6),
      timestamp: now,
      timeStr: new Date(now).toLocaleTimeString(),
      actionType,
      details: detailsStr
    };

    flightBuffer.push(entry);
    if (flightBuffer.length > MAX_RING_BUFFER) {
      flightBuffer = flightBuffer.slice(-MAX_RING_BUFFER);
    }

    // 异步防抖写 LocalStorage，绝不阻塞当前计算主线程
    scheduleFlightBufferPersist();

    // 异步非阻塞推送到服务端遥测接口
    fetch('/api/telemetry/flight-recorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    }).catch(() => {});
  } catch (_) {}
};

/**
 * 带高频防重节流的自动化流水线轨迹埋点（默认同类型 30 秒内只记录一次）
 */
export const recordFlightActionThrottled = (
  actionType: string,
  details: string | object,
  cooldownMs: number = 30000
) => {
  try {
    const now = Date.now();
    const lastTs = throttledActionTimestamps.get(actionType) || 0;
    if (now - lastTs < cooldownMs) {
      return;
    }
    throttledActionTimestamps.set(actionType, now);
    recordFlightAction(actionType, details);
  } catch (_) {}
};

/**
 * 获取当前飞行轨迹
 */
export const getFlightBuffer = (): FlightAction[] => {
  return [...flightBuffer];
};

/**
 * 清空飞行轨迹
 */
export const clearFlightBuffer = () => {
  flightBuffer = [];
  throttledActionTimestamps.clear();
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(FLIGHT_RECORDER_STORAGE_KEY);
    }
  } catch (_) {}
};

/**
 * 高频心跳定时器（每 1000ms 触发一次）
 */
let heartbeatIntervalTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatLifecycleBound = false;
let isHeartbeatInFlight = false;
let lastHeartbeatInFlightSince = 0;
let lastHeartbeatLoopAt = 0;

const sendHeartbeatPauseSignal = () => {
  flushFlightBufferToStorage();
  try {
    const payload = JSON.stringify({ timestamp: Date.now(), paused: true });
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon('/api/telemetry/heartbeat', blob);
    } else {
      fetch('/api/telemetry/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true
      }).catch(() => {});
    }
  } catch (_) {}
};

export const startHeartbeatWatchdog = () => {
  if (heartbeatIntervalTimer) return;
  lastHeartbeatLoopAt = Date.now();

  const sendHeartbeat = () => {
    try {
      const now = Date.now();
      const loopDelta = lastHeartbeatLoopAt > 0 ? now - lastHeartbeatLoopAt : 1000;
      lastHeartbeatLoopAt = now;
      const clockJumpDetected = loopDelta > 8000;

      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      // 🛡️ 防止同源 HTTP 连接池排队导致 isHeartbeatInFlight 长期锁死：超过 4.5s 自动破锁重发
      if (isHeartbeatInFlight && (now - lastHeartbeatInFlightSince < 4500)) {
        return;
      }

      let heapMB = 0;
      if (typeof performance !== 'undefined' && (performance as any).memory) {
        heapMB = Math.round(((performance as any).memory.usedJSHeapSize || 0) / 1024 / 1024);
      }

      const lastAction = flightBuffer.length > 0 ? flightBuffer[flightBuffer.length - 1] : null;
      isHeartbeatInFlight = true;
      lastHeartbeatInFlightSince = now;

      const abortSignal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(4000)
        : undefined;

      fetch('/api/telemetry/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortSignal,
        body: JSON.stringify({
          timestamp: now,
          heapMB,
          paused: false,
          clockJumpDetected,
          url: typeof window !== 'undefined' ? window.location.hash || window.location.pathname : '',
          lastAction
        })
      })
        .catch(() => {})
        .finally(() => {
          isHeartbeatInFlight = false;
        });
    } catch (_) {
      isHeartbeatInFlight = false;
    }
  };

  if (!heartbeatLifecycleBound && typeof window !== 'undefined') {
    heartbeatLifecycleBound = true;
    window.addEventListener('beforeunload', sendHeartbeatPauseSignal);
    window.addEventListener('pagehide', sendHeartbeatPauseSignal);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          sendHeartbeatPauseSignal();
        } else {
          lastHeartbeatLoopAt = Date.now();
          sendHeartbeat();
        }
      });
    }
  }

  sendHeartbeat();
  heartbeatIntervalTimer = setInterval(sendHeartbeat, 1000);
};

export const stopHeartbeatWatchdog = () => {
  if (heartbeatIntervalTimer) {
    clearInterval(heartbeatIntervalTimer);
    heartbeatIntervalTimer = null;
  }
  sendHeartbeatPauseSignal();
};


