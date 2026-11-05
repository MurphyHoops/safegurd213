// 🔒 币安 WebSocket 长连接分片连接池、24H守护与动态 UNSUBSCRIBE 瘦身引擎
import { klineMultiTfStore } from './klineMultiTfStore';
import { l234DataStore } from './l234DataStore';

export interface WsKlineUpdate {
  symbol: string;
  tf: string;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isFinal: boolean;
}

type KlineCallback = (update: WsKlineUpdate) => void;

const BATCH_SIZE = 80;          // 批量打包订阅大小 (50~100)
const STREAMS_PER_SOCKET = 400; // 单 Socket 最大承载 stream 数

interface ShardSocket {
  id: number;
  ws: WebSocket | null;
  streams: Set<string>;
  connected: boolean;
  connecting: boolean;          // 握手状态防重复创建锁
  pingTimer?: any;
  reconnectTimer?: any;
  createdTime: number;
}

class WebSocketShardManager {
  private sockets: Map<number, ShardSocket> = new Map();
  private nextSocketId = 1;
  private pendingSubscribes: string[] = [];
  private rateLimitTimer: any = null;
  private listeners: Set<KlineCallback> = new Set();
  private protectedPositionStreams: Set<string> = new Set();

  private unsubDebounceTimers: Map<string, any> = new Map();

  constructor() {
    this.startRateLimitDispatcher();
  }

  public addListener(cb: KlineCallback): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  public formatStreamName(symbol: string, tf: string): string | null {
    if (!symbol) return null;
    let cleanSym = symbol.toUpperCase().replace(/_PREP$/, '').trim();
    if (!cleanSym.endsWith('USDT')) {
      cleanSym += 'USDT';
    }
    const tfLower = tf.toLowerCase();
    if (tfLower === '10m') {
      return `${cleanSym.toLowerCase()}@kline_5m`;
    }
    const validTfs = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w'];
    if (!validTfs.includes(tfLower)) {
      return null;
    }
    return `${cleanSym.toLowerCase()}@kline_${tfLower}`;
  }

  public registerProtectedPosition(symbol: string, tf: string = '15m') {
    const s1 = this.formatStreamName(symbol, tf);
    const s2 = this.formatStreamName(symbol, '1m');
    if (s1) {
      this.protectedPositionStreams.add(s1);
      this.subscribe([s1]);
    }
    if (s2) {
      this.protectedPositionStreams.add(s2);
      this.subscribe([s2]);
    }
  }

  public unregisterProtectedPosition(symbol: string, tf: string = '15m') {
    const s1 = this.formatStreamName(symbol, tf);
    const s2 = this.formatStreamName(symbol, '1m');
    if (s1) this.protectedPositionStreams.delete(s1);
    if (s2) this.protectedPositionStreams.delete(s2);
  }

  /**
   * 动态订阅 API (支持单条或数组，强制规范全小写)
   */
  public subscribe(symbolOrStreams: string | string[], tf?: string): void {
    let streamsToSub: string[] = [];
    if (Array.isArray(symbolOrStreams)) {
      streamsToSub = symbolOrStreams.map(s => s.toLowerCase());
    } else if (typeof symbolOrStreams === 'string') {
      if (tf) {
        const stream = this.formatStreamName(symbolOrStreams, tf);
        if (stream) streamsToSub.push(stream);
      } else {
        streamsToSub.push(symbolOrStreams.toLowerCase());
      }
    }

    // 取消退池防抖定时器，恢复流常驻
    for (const s of streamsToSub) {
      const timer = this.unsubDebounceTimers.get(s);
      if (timer) {
        clearTimeout(timer);
        this.unsubDebounceTimers.delete(s);
      }
    }

    const newStreams = streamsToSub.filter(s => !this.isSubscribed(s));
    if (newStreams.length > 0) {
      this.pendingSubscribes.push(...newStreams);
    }
  }

  /**
   * 动态瘦身退池 API (带 3000ms 防抖缓冲守护，杜绝临界阈值跳动导致的网络震荡)
   */
  public unsubscribe(symbolOrStreams: string | string[], tf?: string, immediate: boolean = false): void {
    let streams: string[] = [];
    if (Array.isArray(symbolOrStreams)) {
      streams = symbolOrStreams.map(s => s.toLowerCase());
    } else if (typeof symbolOrStreams === 'string') {
      if (tf) {
        const stream = this.formatStreamName(symbolOrStreams, tf);
        if (stream) streams.push(stream);
      } else {
        streams.push(symbolOrStreams.toLowerCase());
      }
    }

    if (streams.length === 0) return;

    if (immediate) {
      this.executeUnsubscribe(streams);
    } else {
      for (const s of streams) {
        if (this.unsubDebounceTimers.has(s)) continue;
        const timer = setTimeout(() => {
          this.unsubDebounceTimers.delete(s);
          this.executeUnsubscribe([s]);
        }, 3000);
        this.unsubDebounceTimers.set(s, timer);
      }
    }
  }

  private executeUnsubscribe(streams: string[]): void {
    // 先从待订阅队列中剔除
    this.pendingSubscribes = this.pendingSubscribes.filter(s => !streams.includes(s));

    // 按 Shard 分组要取消的流 (持仓流强制保留不退订)
    const shardStreamMap = new Map<number, string[]>();
    for (const stream of streams) {
      if (this.protectedPositionStreams.has(stream)) continue;

      for (const shard of this.sockets.values()) {
        if (shard.streams.has(stream)) {
          shard.streams.delete(stream);
          const list = shardStreamMap.get(shard.id) || [];
          list.push(stream);
          shardStreamMap.set(shard.id, list);
          break;
        }
      }
    }

    // 批量发送 UNSUBSCRIBE 指令
    shardStreamMap.forEach((unsubList, shardId) => {
      const shard = this.sockets.get(shardId);
      if (shard && shard.ws && shard.ws.readyState === WebSocket.OPEN) {
        for (let i = 0; i < unsubList.length; i += BATCH_SIZE) {
          const chunk = unsubList.slice(i, i + BATCH_SIZE);
          shard.ws.send(JSON.stringify({
            method: 'UNSUBSCRIBE',
            params: chunk,
            id: Date.now() + i
          }));
        }
      }
    });
  }

  /**
   * 同步订阅列表 (兼容 List 2 / 扫描调度引擎)
   */
  public syncSubscriptions(requiredPairs: { symbol: string; tf: string }[], activePositionPairs?: { symbol: string; tf?: string }[]) {
    const targetStreams = new Set<string>();
    for (const item of requiredPairs) {
      const stream = this.formatStreamName(item.symbol, item.tf);
      if (stream) targetStreams.add(stream);
    }

    if (activePositionPairs && activePositionPairs.length > 0) {
      this.protectedPositionStreams.clear();
      for (const pos of activePositionPairs) {
        const pTf = pos.tf || '15m';
        const s1 = this.formatStreamName(pos.symbol, pTf);
        const s2 = this.formatStreamName(pos.symbol, '1m');
        if (s1) { targetStreams.add(s1); this.protectedPositionStreams.add(s1); }
        if (s2) { targetStreams.add(s2); this.protectedPositionStreams.add(s2); }
      }
    } else {
      for (const pSub of this.protectedPositionStreams) {
        targetStreams.add(pSub);
      }
    }

    const currentSubbed = this.getAllSubscribedStreams();
    const toUnsub: string[] = [];
    for (const sub of currentSubbed) {
      if (!targetStreams.has(sub) && !this.protectedPositionStreams.has(sub)) {
        toUnsub.push(sub);
      }
    }

    if (toUnsub.length > 0) {
      this.unsubscribe(toUnsub);
    }

    const toSub: string[] = [];
    for (const tgt of targetStreams) {
      if (!this.isSubscribed(tgt)) {
        toSub.push(tgt);
      }
    }

    if (toSub.length > 0) {
      this.subscribe(toSub);
    }
  }

  private getAllSubscribedStreams(): Set<string> {
    const set = new Set<string>();
    for (const shard of this.sockets.values()) {
      for (const s of shard.streams) {
        set.add(s);
      }
    }
    return set;
  }

  /**
   * 限频发包调度器：400ms 批量打包发送，5 秒内全量推演完成
   */
  private startRateLimitDispatcher(): void {
    if (this.rateLimitTimer) return;
    this.rateLimitTimer = setInterval(() => {
      if (this.pendingSubscribes.length === 0) return;

      const batch = this.pendingSubscribes.splice(0, BATCH_SIZE);
      this.dispatchBatchSubscribe(batch);
    }, 400);
  }

  private isSubscribed(stream: string): boolean {
    for (const shard of this.sockets.values()) {
      if (shard.streams.has(stream)) return true;
    }
    return false;
  }

  /**
   * 将批量流派发至可用 Socket 分片
   */
  private dispatchBatchSubscribe(streams: string[]): void {
    let targetShard = this.getAvailableShard();
    if (!targetShard) {
      targetShard = this.createNewShard();
    }

    streams.forEach(s => targetShard!.streams.add(s));

    if (targetShard.ws && targetShard.connected) {
      const payload = {
        method: 'SUBSCRIBE',
        params: streams,
        id: Date.now()
      };
      targetShard.ws.send(JSON.stringify(payload));
    }
  }

  private getAvailableShard(): ShardSocket | null {
    for (const shard of this.sockets.values()) {
      if ((shard.connected || shard.connecting) && shard.streams.size + BATCH_SIZE <= STREAMS_PER_SOCKET) {
        return shard;
      }
    }
    return null;
  }

  /**
   * 清理特定 Shard 的所有定时器，彻底防止内存泄漏
   */
  private clearShardTimers(shard: ShardSocket): void {
    if (shard.pingTimer) {
      clearInterval(shard.pingTimer);
      shard.pingTimer = undefined;
    }
    if (shard.reconnectTimer) {
      clearTimeout(shard.reconnectTimer);
      shard.reconnectTimer = undefined;
    }
  }

  /**
   * 创建新的 Socket 分片并挂载守护机制
   */
  private createNewShard(): ShardSocket {
    const id = this.nextSocketId++;
    const shard: ShardSocket = {
      id,
      ws: null,
      streams: new Set(),
      connected: false,
      connecting: false,
      createdTime: Date.now()
    };

    this.sockets.set(id, shard);
    this.connectShard(shard);
    return shard;
  }

  private connectShard(shard: ShardSocket): void {
    this.clearShardTimers(shard);

    // 关键防御：若存在旧 Socket，先解除所有事件监听，再执行关闭，防止触发 onclose 引起二次重连竞态
    if (shard.ws) {
      try {
        shard.ws.onopen = null;
        shard.ws.onmessage = null;
        shard.ws.onerror = null;
        shard.ws.onclose = null;
        shard.ws.close();
      } catch (e) {
        // 忽略关闭异常
      }
    }

    shard.connecting = true;
    shard.connected = false;

    try {
      const ws = new WebSocket('wss://fstream.binance.com/ws');
      shard.ws = ws;

      ws.onopen = () => {
        shard.connecting = false;
        shard.connected = true;

        if (shard.streams.size > 0) {
          const streamArray = Array.from(shard.streams);
          for (let i = 0; i < streamArray.length; i += BATCH_SIZE) {
            const batch = streamArray.slice(i, i + BATCH_SIZE);
            ws.send(JSON.stringify({
              method: 'SUBSCRIBE',
              params: batch,
              id: Date.now() + i
            }));
          }
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const data = msg.data || msg;
          if (data && data.e === 'kline' && data.k) {
            this.handleKlineEvent(data);
          }
        } catch (err) {
          // 忽略非 JSON 数据
        }
      };

      ws.onclose = () => {
        shard.connected = false;
        shard.connecting = false;
        this.clearShardTimers(shard);
        // 3 秒自动平滑重连守护
        shard.reconnectTimer = setTimeout(() => this.connectShard(shard), 3000);
      };

      ws.onerror = () => {
        shard.connected = false;
        shard.connecting = false;
      };

      // 20 秒心跳 Ping-Pong 存活检测
      shard.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ method: 'PING' }));
        }
      }, 20000);

      // 23.5 小时主动平滑重连 (防币安 24 小时强制断连)
      shard.reconnectTimer = setTimeout(() => {
        console.log(`[WS分片 ${shard.id}] 触发 23.5 小时主动平滑重连`);
        this.connectShard(shard);
      }, 23.5 * 3600 * 1000);

    } catch (e) {
      shard.connecting = false;
      shard.connected = false;
      console.error(`[WS分片 ${shard.id}] 连接建立异常`, e);
    }
  }

  /**
   * 处理 WebSocket 实时广播推送
   */
  private handleKlineEvent(msg: any): void {
    const k = msg.k;
    const symbol = (msg.s || k.s || '').toUpperCase();
    const tf = k.i;
    const isClosed = !!k.x;

    const update: WsKlineUpdate = {
      symbol,
      tf,
      time: Number(k.t),
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
      isFinal: isClosed,
    };

    const unifiedKline = {
      time: update.time,
      open: update.open,
      high: update.high,
      low: update.low,
      close: update.close,
      volume: update.volume
    };

    try {
      klineMultiTfStore.updateRealtimeKline(symbol, tf, unifiedKline, isClosed);
      l234DataStore.updateRealtimeKline(update);

      if (tf === '5m') {
        const tenMinTime = Math.floor(update.time / (10 * 60 * 1000)) * (10 * 60 * 1000);
        klineMultiTfStore.updateRealtimeKline(symbol, '10m', {
          ...unifiedKline,
          time: tenMinTime
        }, isClosed);
        l234DataStore.updateRealtimeKline({
          ...update,
          tf: '10m',
          time: tenMinTime,
        });
      }
    } catch (_) {}

    this.listeners.forEach((cb) => {
      try {
        cb(update);
        if (tf === '5m') {
          const tenMinTime = Math.floor(update.time / (10 * 60 * 1000)) * (10 * 60 * 1000);
          cb({
            ...update,
            tf: '10m',
            time: tenMinTime,
          });
        }
      } catch (e) {}
    });
  }
}

export const binanceKlineWs = new WebSocketShardManager();
