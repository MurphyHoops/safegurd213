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
let flightBuffer: FlightAction[] = [];

// 初始化读取
try {
  if (typeof window !== 'undefined') {
    const raw = localStorage.getItem('SAVIOR_FLIGHT_RECORDER');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        flightBuffer = parsed.slice(-MAX_RING_BUFFER);
      }
    }
  }
} catch (_) {}

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

    // 本地即时离线落盘
    if (typeof window !== 'undefined') {
      localStorage.setItem('SAVIOR_FLIGHT_RECORDER', JSON.stringify(flightBuffer));
    }

    // 异步非阻塞推送到服务端遥测接口
    fetch('/api/telemetry/flight-recorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    }).catch(() => {});
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
  try {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('SAVIOR_FLIGHT_RECORDER');
    }
  } catch (_) {}
};

/**
 * 高频心跳定时器（每 1000ms 触发一次）
 */
let heartbeatIntervalTimer: any = null;

export const startHeartbeatWatchdog = () => {
  if (heartbeatIntervalTimer) return;

  const sendHeartbeat = () => {
    try {
      let heapMB = 0;
      if (typeof performance !== 'undefined' && (performance as any).memory) {
        heapMB = Math.round(((performance as any).memory.usedJSHeapSize || 0) / 1024 / 1024);
      }

      const lastAction = flightBuffer.length > 0 ? flightBuffer[flightBuffer.length - 1] : null;

      fetch('/api/telemetry/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamp: Date.now(),
          heapMB,
          url: typeof window !== 'undefined' ? window.location.hash || window.location.pathname : '',
          lastAction
        })
      }).catch(() => {});
    } catch (_) {}
  };

  sendHeartbeat();
  heartbeatIntervalTimer = setInterval(sendHeartbeat, 1000);
};

export const stopHeartbeatWatchdog = () => {
  if (heartbeatIntervalTimer) {
    clearInterval(heartbeatIntervalTimer);
    heartbeatIntervalTimer = null;
  }
};
