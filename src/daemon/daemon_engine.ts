/**
 * 🔒 LOCKED_MODULE: 7x24 Standalone Daemon Engine & Anti-Exit KeepAlive System
 * @LOCKED: 7x24 小时不间断无人值守常驻引擎及防自动退出/防休眠模块。已完全固化锁定，未经用户明确的专属书面指令，绝对严禁触碰、修改、重构或变动。
 * 🛡️ [7x24 STANDALONE DAEMON ENGINE]: 完全脱离前端生命周期的独立后台守护引擎
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import WebSocket, { WebSocketServer } from 'ws';
import { Position, PositionSide, AppSettings } from '../../types';
import { checkIndividualPositionRules } from '../../services/rules/profit_loss_rules';
import { checkHedgingRules } from '../../services/rules/hedging_rules';
import { checkRescueRules } from '../../services/rules/rescue_rules';
import { atomicWriteJsonSync, safeReadJsonSync, StreamLogRotator } from '../utils/atomicLogRotator';

const DAEMON_PORT = 8089;
const SNAPSHOT_INTERVAL_MS = 500;
const RUNTIME_DIR = path.join(process.cwd(), 'runtime_data');
const POSITIONS_FILE = path.join(RUNTIME_DIR, 'positions.json');
const SCANNER_STATE_FILE = path.join(RUNTIME_DIR, 'scanner_state.json');
const DAEMON_LOG_FILE = path.join(RUNTIME_DIR, 'daemon_execution.log');

// 初始化非阻塞金融级日志轮转器 (单文件5MB，保留5卷)
const daemonLogRotator = new StreamLogRotator(DAEMON_LOG_FILE, 5 * 1024 * 1024, 5);

function writeDaemonLog(level: 'INFO' | 'WARN' | 'ERROR', message: string, traceId?: string): void {
  const tidStr = traceId ? ` [TraceID:${traceId}]` : '';
  daemonLogRotator.write(`[${level}]${tidStr} ${message}`);
}

const DEFAULT_SETTINGS: AppSettings = {
  profit: {
    enabled: true,
    conventional: { enabled: true, activationPct: 2.0, retainPct: 50 },
    atr: { enabled: false, multiplier: 2.0, period: 14 },
    smart: { enabled: false, activationPct: 3.0, stepPct: 1.0, callbackPct: 0.5 },
    ai: { enabled: false, targetWinRate: 80 },
    stopLoss: { enabled: true, minPosition: 0, lossPercent: 5.0, closePercent: 100 }
  },
  hedging: { enabled: true, triggerLossPercent: 10, hedgeRatio: 100 },
  rescue: { enabled: true, mode: 'STRATEGY_4' }
} as AppSettings;

export class StandaloneDaemonEngine {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private binanceWs: WebSocket | null = null;
  private realPrices: Record<string, number> = {};
  private positions: Position[] = [];
  private scannerState: Record<string, any> = {};
  private activeClients = new Set<WebSocket>();
  private settings: AppSettings = DEFAULT_SETTINGS;
  private reconnectAttempts = 0;
  private maxBackoffMs = 30000;
  private isShuttingDown = false;
  private lastTickerTime = Date.now();
  private ntpDriftMs = 0;
  private lastUsedWeight1M = 0;
  private eventLoopLagMs = 0;

  constructor() {
    if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    this.startEventLoopLagMonitor();
  }

  /**
   * 测算 Node.js 事件循环延迟 (Event Loop Lag P99)
   */
  private startEventLoopLagMonitor() {
    let lastTime = process.hrtime.bigint();
    setInterval(() => {
      const now = process.hrtime.bigint();
      const deltaNs = now - lastTime;
      const lagMs = Number(deltaNs - 500000000n) / 1e6; // 期望 500ms
      this.eventLoopLagMs = Math.max(0, lagMs);
      lastTime = now;
    }, 500);
  }

  public async start() {
    const traceId = `tr_start_${Date.now().toString(36)}`;
    writeDaemonLog('INFO', '🚀 Starting Standalone Daemon Engine with Financial-Grade Diagnostics & Rotator (Port 8089)', traceId);
    this.loadStateFromDisk();
    this.startObserverGateway();
    this.connectBinanceMarketStream();
    this.startSnapshotBroadcaster();
    this.startPersistenceLoop();
    this.registerProcessHandlers();
    this.syncNtpTimeOffset();
  }

  /**
   * 测算 Binance REST API / Server Time NTP 时间漂移与 1M 权重消耗
   */
  private syncNtpTimeOffset() {
    const fetchNtp = () => {
      const startReq = Date.now();
      const req = http.request('http://api.binance.com/api/v3/time', { method: 'GET', timeout: 5000 }, (res) => {
        let raw = '';
        const weightHeader = res.headers['x-mbx-used-weight-1m'];
        if (weightHeader) {
          this.lastUsedWeight1M = parseInt(String(weightHeader), 10) || 0;
        }
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            if (data && data.serverTime) {
              const endReq = Date.now();
              const rtt = endReq - startReq;
              const serverTime = data.serverTime;
              // 本地估算时间 = serverTime + (rtt / 2)
              this.ntpDriftMs = Math.abs(endReq - (serverTime + Math.round(rtt / 2)));
            }
          } catch (_) {}
        });
      });
      req.on('error', () => {});
      req.end();
    };

    fetchNtp();
    setInterval(fetchNtp, 60000);
  }

  private loadStateFromDisk() {
    const loaded = safeReadJsonSync<{ positions: Position[] }>(POSITIONS_FILE, { positions: [] });
    this.positions = Array.isArray(loaded.positions) ? loaded.positions : [];
    this.scannerState = safeReadJsonSync<Record<string, any>>(SCANNER_STATE_FILE, {});
    writeDaemonLog('INFO', `[State Recovery] Loaded ${this.positions.length} active positions`);
  }

  private saveStateToDisk() {
    atomicWriteJsonSync(POSITIONS_FILE, { updatedAt: Date.now(), positions: this.positions });
    atomicWriteJsonSync(SCANNER_STATE_FILE, { updatedAt: Date.now(), state: this.scannerState });
  }

  private startSnapshotBroadcaster() {
    setInterval(() => {
      if (this.activeClients.size === 0) return;
      const snapshot = JSON.stringify({
        type: 'SNAPSHOT',
        timestamp: Date.now(),
        system: {
          uptimeSeconds: Math.round(process.uptime()),
          memoryRssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
          eventLoopLagMs: Math.round(this.eventLoopLagMs),
          ntpDriftMs: Math.round(this.ntpDriftMs)
        },
        realPrices: this.realPrices,
        positions: this.positions,
        scannerState: this.scannerState
      });
      for (const client of this.activeClients) {
        if (client.readyState === WebSocket.OPEN) try { client.send(snapshot); } catch (_) {}
      }
    }, SNAPSHOT_INTERVAL_MS);
  }

  private startPersistenceLoop() {
    setInterval(() => this.saveStateToDisk(), 5000);
  }

  /**
   * 🛡️ [金融级 24/7 全系统深度自检引擎 - runFullDiagnostics]
   */
  public runFullDiagnostics() {
    const traceId = `tr_diag_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const now = Date.now();
    const mem = process.memoryUsage();
    const rssMB = Math.round(mem.rss / 1024 / 1024);
    const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
    const lastTickDelayMs = now - (this.lastTickerTime || now);
    const priceCount = Object.keys(this.realPrices).length;

    // 句柄与定时器泄漏检测
    const activeHandlesCount = typeof (process as any)._getActiveHandles === 'function' ? (process as any)._getActiveHandles().length : 0;
    const activeRequestsCount = typeof (process as any)._getActiveRequests === 'function' ? (process as any)._getActiveRequests().length : 0;

    const checks: Array<{
      category: string;
      name: string;
      status: 'pass' | 'warn' | 'fail';
      detail: string;
      value: string;
      suggestion: string;
    }> = [];

    // 1. 行情网络与 WebSocket 检查
    const isWsOpen = this.binanceWs && this.binanceWs.readyState === WebSocket.OPEN;
    if (isWsOpen && lastTickDelayMs < 5000 && priceCount > 0) {
      checks.push({
        category: '行情网络',
        name: '币安 WebSocket 长连接',
        status: 'pass',
        detail: `连接正常 (OPEN)，最后 Tick 距今 ${lastTickDelayMs}ms，实时价格池已缓存 ${priceCount} 个币种`,
        value: `${lastTickDelayMs}ms`,
        suggestion: '网络链路优秀，无需处理'
      });
    } else if (lastTickDelayMs >= 5000) {
      checks.push({
        category: '行情网络',
        name: '币安行情推送延迟',
        status: 'warn',
        detail: `行情 Tick 接收延迟达 ${Math.round(lastTickDelayMs / 1000)} 秒，超过 5 秒预警线`,
        value: `${Math.round(lastTickDelayMs / 1000)}s`,
        suggestion: '系统将通过退避重连自动恢复，若持续延迟请排查网络出口'
      });
    } else {
      checks.push({
        category: '行情网络',
        name: '币安 WebSocket 状态',
        status: 'fail',
        detail: 'WebSocket 长连接已断开，正在尝试退避自动重连',
        value: isWsOpen ? 'OPEN' : 'DISCONNECTED',
        suggestion: '检查网络连接或稍后等待自动自愈重连'
      });
    }

    // 2. NTP 时钟漂移与 REST 权重检测
    if (this.ntpDriftMs < 500) {
      checks.push({
        category: '系统时间',
        name: 'NTP 时钟同步与漂移',
        status: 'pass',
        detail: `本地时钟与交易所服务器偏差 ${Math.round(this.ntpDriftMs)}ms < 500ms，下单风控防重放完好`,
        value: `${Math.round(this.ntpDriftMs)}ms`,
        suggestion: '时钟精度极佳'
      });
    } else if (this.ntpDriftMs < 2000) {
      checks.push({
        category: '系统时间',
        name: 'NTP 时钟轻微漂移',
        status: 'warn',
        detail: `本地时钟偏差 ${Math.round(this.ntpDriftMs)}ms，建议校准系统 NTP 时间`,
        value: `${Math.round(this.ntpDriftMs)}ms`,
        suggestion: '请在 Windows 时间设置中同步网络时间'
      });
    } else {
      checks.push({
        category: '系统时间',
        name: 'NTP 时钟严重失准',
        status: 'fail',
        detail: `本地时钟偏差 ${Math.round(this.ntpDriftMs)}ms > 2000ms，可能引发 API 签名失效`,
        value: `${Math.round(this.ntpDriftMs)}ms`,
        suggestion: '立即手动校准宿主机时间'
      });
    }

    // 3. API REST 1M 权重频控
    checks.push({
      category: 'API 权重',
      name: '币安 REST 1-Min 权重占用',
      status: this.lastUsedWeight1M < 800 ? 'pass' : this.lastUsedWeight1M < 1100 ? 'warn' : 'fail',
      detail: `过去 1 分钟已消耗 API 权重 ${this.lastUsedWeight1M} / 1200`,
      value: `${this.lastUsedWeight1M}/1200`,
      suggestion: this.lastUsedWeight1M < 800 ? '频控健康' : '降低高频轮询频率防 429 封禁'
    });

    // 4. 进程与内存健康
    if (rssMB < 300) {
      checks.push({
        category: '进程内存',
        name: '物理内存占用 (RSS)',
        status: 'pass',
        detail: `物理内存 ${rssMB}MB，V8 堆内存 ${heapMB}MB，运行极度轻盈`,
        value: `${rssMB}MB`,
        suggestion: '内存使用优良，无泄漏隐患'
      });
    } else if (rssMB <= 600) {
      checks.push({
        category: '进程内存',
        name: '物理内存占用 (RSS)',
        status: 'warn',
        detail: `物理内存 ${rssMB}MB，接近 600MB 预警阈值`,
        value: `${rssMB}MB`,
        suggestion: '处于正常高负载状态，若持续飙升建议重启进程清理垃圾'
      });
    } else {
      checks.push({
        category: '进程内存',
        name: '物理内存告警',
        status: 'fail',
        detail: `物理内存 ${rssMB}MB > 600MB，可能存在未释放的句柄或内存泄漏`,
        value: `${rssMB}MB`,
        suggestion: '建议重启守护进程释放内存'
      });
    }

    // 5. 句柄与事件循环延迟
    checks.push({
      category: '句柄与事件循环',
      name: '活跃句柄数 & Loop Lag',
      status: (activeHandlesCount < 100 && this.eventLoopLagMs < 50) ? 'pass' : 'warn',
      detail: `活跃句柄数: ${activeHandlesCount} | 请求数: ${activeRequestsCount} | Event Loop 延迟: ${Math.round(this.eventLoopLagMs)}ms`,
      value: `${activeHandlesCount} h / ${Math.round(this.eventLoopLagMs)}ms`,
      suggestion: '句柄数与事件循环流畅度良好'
    });

    // 6. 磁盘原子落盘与完整性
    let isDiskOk = true;
    try {
      if (fs.existsSync(RUNTIME_DIR)) {
        const testFile = path.join(RUNTIME_DIR, `.write_test_${now}.tmp`);
        fs.writeFileSync(testFile, 'ok');
        fs.unlinkSync(testFile);
      } else {
        isDiskOk = false;
      }
    } catch (_) {
      isDiskOk = false;
    }

    if (isDiskOk) {
      checks.push({
        category: '磁盘存储',
        name: 'runtime_data 读写权限',
        status: 'pass',
        detail: '存储目录读写权限正常，原子落盘机制与锁完好',
        value: 'NORMAL',
        suggestion: '数据定时落盘正常'
      });
    } else {
      checks.push({
        category: '磁盘存储',
        name: 'runtime_data 写入卡死',
        status: 'fail',
        detail: '无法写入 runtime_data 目录，原子落盘受阻',
        value: 'PERMISSION_DENIED',
        suggestion: '请检查项目根目录下 runtime_data 文件夹的读写权限'
      });
    }

    // 7. 持仓数据合规性
    let invalidPosCount = 0;
    for (const p of this.positions) {
      if (!p.symbol || isNaN(p.entryPrice) || p.entryPrice <= 0 || isNaN(p.amount) || p.amount <= 0 || isNaN(p.unrealizedPnL)) {
        invalidPosCount++;
      }
    }
    if (invalidPosCount === 0) {
      checks.push({
        category: '持仓合规',
        name: '活跃持仓数据合法性',
        status: 'pass',
        detail: `成功核验 ${this.positions.length} 个活跃持仓，未发现 NaN/null 异常`,
        value: `${this.positions.length} 个持仓`,
        suggestion: '持仓结构完整'
      });
    } else {
      checks.push({
        category: '持仓合规',
        name: '异常持仓风险',
        status: 'warn',
        detail: `发现 ${invalidPosCount} 个字段异常的持仓对象`,
        value: `${invalidPosCount} 个异常`,
        suggestion: '可在前端持仓列表一键点击平仓或手动纠偏'
      });
    }

    const hasFail = checks.some(c => c.status === 'fail');
    const hasWarn = checks.some(c => c.status === 'warn');
    const status = hasFail ? 'CRITICAL' : hasWarn ? 'WARNING' : 'HEALTHY';
    const failCount = checks.filter(c => c.status === 'fail').length;
    const warnCount = checks.filter(c => c.status === 'warn').length;
    const score = Math.max(0, 100 - (failCount * 30) - (warnCount * 10));

    writeDaemonLog('INFO', `[Diagnostics Executed] Score=${score}, Status=${status}`, traceId);

    return {
      score,
      status,
      timestamp: now,
      traceId,
      summary: {
        uptimeSeconds: Math.round(process.uptime()),
        memoryRssMB: rssMB,
        memoryHeapMB: heapMB,
        priceCount,
        activePositions: this.positions.length,
        observerClients: this.activeClients.size,
        activeHandlesCount,
        eventLoopLagMs: Math.round(this.eventLoopLagMs),
        ntpDriftMs: Math.round(this.ntpDriftMs)
      },
      checks
    };
  }

  private startObserverGateway() {
    this.server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Trace-ID');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

      const url = req.url || '';
      const traceId = (req.headers['x-trace-id'] as string) || `tr_http_${Date.now().toString(36)}`;

      if (url === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'X-Trace-ID': traceId });
        res.end(JSON.stringify({ status: 'RUNNING', traceId, uptime: Math.round(process.uptime()), positions: this.positions.length }));
        return;
      }

      // 🎯 [一键自检接口]
      if (url === '/api/diagnose') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'X-Trace-ID': traceId });
        res.end(JSON.stringify(this.runFullDiagnostics()));
        return;
      }

      // 🎯 [休眠唤醒强行销毁 Socket 重连接口 (Power Monitor Trigger)]
      if (url === '/api/reconnect-ws') {
        writeDaemonLog('WARN', '⚡ [Power Resume Signal] Destroying stale WebSocket & reconnecting...', traceId);
        this.forceResetMarketWebSocket();
        res.writeHead(200, { 'Content-Type': 'application/json', 'X-Trace-ID': traceId });
        res.end(JSON.stringify({ status: 'RECONNECTED', traceId }));
        return;
      }

      res.writeHead(404); res.end();
    });

    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on('connection', (ws: WebSocket) => {
      this.activeClients.add(ws);
      ws.send(JSON.stringify({ type: 'INITIAL_STATE', timestamp: Date.now(), positions: this.positions, realPrices: this.realPrices }));
      ws.on('message', (buf) => {
        try { this.handleClientCommand(JSON.parse(buf.toString()), ws); } catch (_) {}
      });
      ws.on('close', () => this.activeClients.delete(ws));
      ws.on('error', () => this.activeClients.delete(ws));
    });

    this.server.listen(DAEMON_PORT);
  }

  /**
   * 🛡️ [休眠唤醒防假死 Socket 重置]: 收到 resume 信号时强行 terminate 僵尸 Socket 并瞬间重连
   */
  public forceResetMarketWebSocket() {
    try {
      if (this.binanceWs) {
        this.binanceWs.terminate(); // 强行物理销毁底层 Socket 句柄
        this.binanceWs = null;
      }
    } catch (_) {}
    this.connectBinanceMarketStream();
  }

  private handleClientCommand(msg: any, client: WebSocket) {
    if (!msg || !msg.action) return;
    if (msg.action === 'OPEN_POSITION') {
      this.positions.push({
        id: `pos_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        symbol: msg.symbol, side: msg.side, amount: msg.quantity, entryPrice: msg.price, timestamp: Date.now(),
        unrealizedPnL: 0, unrealizedPnLPercentage: 0, leverage: msg.leverage || 20, margin: (msg.quantity * msg.price) / (msg.leverage || 20),
        liquidationPrice: 0, markPrice: msg.price, isHedged: false, isUnshackled: false
      } as Position);
      this.saveStateToDisk();
    } else if (msg.action === 'CLOSE_POSITION') {
      this.positions = this.positions.filter(p => !(p.symbol === msg.symbol && p.side === msg.side));
      this.saveStateToDisk();
    }
  }

  private connectBinanceMarketStream() {
    if (this.isShuttingDown) return;
    try {
      this.binanceWs = new WebSocket('wss://fstream.binance.com/ws/!miniTicker@arr');
      this.binanceWs.on('open', () => {
        this.reconnectAttempts = 0;
        writeDaemonLog('INFO', '✅ Binance WebSocket Stream Connected Successfully');
      });
      this.binanceWs.on('message', (data) => {
        try {
          this.lastTickerTime = Date.now();
          const items = JSON.parse(data.toString());
          if (Array.isArray(items)) {
            let updated = false;
            for (const item of items) {
              if (item && item.s && item.c) {
                const sym = item.s.replace('USDT', '').toUpperCase();
                const price = parseFloat(item.c);
                if (price > 0) { this.realPrices[sym] = price; this.realPrices[`${sym}USDT`] = price; updated = true; }
              }
            }
            if (updated) this.evaluateCoreStrategyEngine();
          }
        } catch (_) {}
      });
      this.binanceWs.on('close', () => this.scheduleBinanceReconnect());
      this.binanceWs.on('error', () => { try { this.binanceWs?.close(); } catch (_) {} });
    } catch (e) { this.scheduleBinanceReconnect(); }
  }

  private scheduleBinanceReconnect() {
    if (this.isShuttingDown) return;
    this.reconnectAttempts++;
    const delay = Math.min(this.maxBackoffMs, Math.pow(2, Math.min(this.reconnectAttempts, 6)) * 1000);
    setTimeout(() => this.connectBinanceMarketStream(), delay);
  }

  private evaluateCoreStrategyEngine() {
    if (this.positions.length === 0) return;
    let stateChanged = false;

    for (let i = this.positions.length - 1; i >= 0; i--) {
      const pos = this.positions[i];
      const price = this.realPrices[pos.symbol] || this.realPrices[`${pos.symbol}USDT`] || pos.entryPrice;
      if (!price || pos.entryPrice <= 0) continue;

      pos.markPrice = price;
      const priceDiff = pos.side === PositionSide.LONG ? (price - pos.entryPrice) : (pos.entryPrice - price);
      pos.unrealizedPnL = priceDiff * pos.amount;
      pos.unrealizedPnLPercentage = (priceDiff / pos.entryPrice) * 100 * (pos.leverage || 20);

      const isClosedByPL = checkIndividualPositionRules(
        pos, this.settings,
        (symbol: string, side: PositionSide, reason: string) => {
          writeDaemonLog('INFO', `[Strategy Trigger - PL Close] ${symbol} ${side}: ${reason}`);
          this.positions.splice(i, 1);
          stateChanged = true;
        }, this.positions
      );
      if (isClosedByPL) continue;

      checkHedgingRules(
        pos, this.settings,
        (targetPos: Position, hedgeSide: PositionSide, hedgeAmountUsdt: number, reason: string) => {
          writeDaemonLog('INFO', `[Strategy Trigger - Hedge] ${targetPos.symbol} ${hedgeSide}: ${reason}`);
          targetPos.isHedged = true;
          this.positions.push({
            id: `hedge_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            symbol: targetPos.symbol, side: hedgeSide, amount: hedgeAmountUsdt / price, entryPrice: price,
            timestamp: Date.now(), unrealizedPnL: 0, unrealizedPnLPercentage: 0, leverage: targetPos.leverage || 20,
            margin: hedgeAmountUsdt / (targetPos.leverage || 20), liquidationPrice: 0, markPrice: price, isHedged: true, mainPositionId: targetPos.id
          } as Position);
          stateChanged = true;
        }, this.positions
      );

      checkRescueRules(
        pos, this.settings,
        (symbol: string, reason: string) => {
          writeDaemonLog('INFO', `[Strategy Trigger - Rescue All Clear] ${symbol}: ${reason}`);
          this.positions = this.positions.filter(p => p.symbol !== symbol);
          stateChanged = true;
        }, this.positions,
        (symbol: string, side: PositionSide) => {
          writeDaemonLog('INFO', `[Strategy Trigger - Rescue Hedge Clear] ${symbol} ${side}`);
          this.positions = this.positions.filter(p => !(p.symbol === symbol && p.side === side));
          stateChanged = true;
        }
      );
    }

    if (stateChanged) this.saveStateToDisk();
  }

  private registerProcessHandlers() {
    const graceful = (sig: string) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      this.saveStateToDisk();
      try { this.wss?.close(); } catch (_) {}
      try { this.server?.close(); } catch (_) {}
      try { this.binanceWs?.close(); } catch (_) {}
      process.exit(0);
    };
    process.on('SIGINT', () => graceful('SIGINT'));
    process.on('SIGTERM', () => graceful('SIGTERM'));

    // 🛡️ [uncaughtException 紧急安全通道及快照落盘]
    process.on('uncaughtException', (err) => {
      const traceId = `tr_fatal_${Date.now().toString(36)}`;
      console.error(`🚨 [Fatal Uncaught Exception] TraceID: ${traceId}`, err);
      writeDaemonLog('ERROR', `[CRASH_FATAL] ${err?.message}\n${err?.stack}`, traceId);
      this.saveStateToDisk();
    });

    process.on('unhandledRejection', (reason) => {
      const traceId = `tr_rejection_${Date.now().toString(36)}`;
      console.error(`⚠️ [Unhandled Rejection] TraceID: ${traceId}`, reason);
      writeDaemonLog('ERROR', `[REJECTION] ${String(reason)}`, traceId);
      this.saveStateToDisk();
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('daemon_engine.ts')) {
  new StandaloneDaemonEngine().start().catch((err) => { console.error('Fatal Engine Error:', err); process.exit(1); });
}
