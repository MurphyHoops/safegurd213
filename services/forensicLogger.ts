/**
 * 🛡️ [Forensic Metrics Time-Series Logger - Sliding Window Edition] 法医级高频时序指标记录器与雷达
 * services/forensicLogger.ts
 * 
 * 服务端专用模块 (Node.js / Express Server)
 * 采用纯字符串拼接路径与秒级物理追加写入 (appendFileSync)，并内置滑动窗口硬截断机制（最大保留300条）
 */

import fs from 'fs';

// 采用安全字符串拼接，彻底消除对 Node.js path 模块的依赖
const ROOT_DIR = process.cwd();
const DATA_DIR = `${ROOT_DIR}/data`;
const FORENSIC_LOG_FILE = `${DATA_DIR}/forensic_metrics.jsonl`;

export interface ForensicDataPoint {
  timestamp: number;
  timeStr: string;
  serverRssMB: number;
  serverHeapMB: number;
  clientHeapMB?: number;
  domNodeCount?: number;
  activeWsCount?: number;
  customNote?: string;
}

/**
 * 核心写盘函数：采用秒级物理追加写入 (appendFileSync) 并集成滑动窗口硬截断（最大 300 条）
 * 确保即使程序被强杀，暴毙前一秒的数据也已经死死刻在硬盘里，且文件永不无限膨胀
 */
export const logForensicMetric = (data: Partial<ForensicDataPoint>) => {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const now = Date.now();
    const mem = process.memoryUsage();
    
    const point: ForensicDataPoint = {
      timestamp: now,
      timeStr: new Date(now).toISOString(),
      serverRssMB: Math.round(mem.rss / 1024 / 1024),
      serverHeapMB: Math.round(mem.heapUsed / 1024 / 1024),
      clientHeapMB: data.clientHeapMB || 0,
      domNodeCount: data.domNodeCount || 0,
      activeWsCount: data.activeWsCount || 0,
      customNote: data.customNote || 'NORMAL'
    };

    fs.appendFileSync(FORENSIC_LOG_FILE, JSON.stringify(point) + '\n', 'utf-8');

    // 🛡️ 滑动窗口与容量硬截断：确保 forensic_metrics.jsonl 文件最多只保留最近的 300 条记录
    try {
      const content = fs.readFileSync(FORENSIC_LOG_FILE, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim().length > 0);
      if (lines.length > 300) {
        const trimmed = lines.slice(-300).join('\n') + '\n';
        fs.writeFileSync(FORENSIC_LOG_FILE, trimmed, 'utf-8');
      }
    } catch (_) {}

  } catch (err) {
    console.error('[Forensic Logger Error]', err);
  }
};

// 服务端每秒独立巡检定时器
let serverForensicTimer: any = null;
export const startForensicServerCollector = () => {
  if (serverForensicTimer) return;
  serverForensicTimer = setInterval(() => {
    logForensicMetric({ customNote: 'SERVER_TICK' });
  }, 1000);
};

// 兼容导出前端探针函数（转发至纯客户端安全模块）
export { startClientForensicProbe } from './clientForensicProbe';
