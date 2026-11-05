/**
 * 🔒 列表2 极速实时 Tick 扫描器与直通开仓管道 (List2FastScanner)
 * 
 * 核心设计原则：
 * 1. 实时 Tick 驱动 (废除等 K 线收盘)：由 WebSocket / priceRegistry 价格流直接推入，毫秒级判定。
 * 2. 状态安全区间判定 (废除单纯边沿穿线)：当前价在突破线与突破线*1.008安全区间内即触发。
 * 3. 追高防爆熔断 (0.8% 门禁)：超过 0.8% 判定为追高超偏，立即记录日志并锁定舍弃。
 * 4. 直通开仓管道 (Fast-Track)：命中后加锁并直接向列表 4 / 下单管道派发 DIRECT_TRIGGER_TO_LIST4 事件，跳过轮询。
 */

import { eventBus } from '../core/EventBus';
import { normalizeSymbol } from './symbolUtils';

export interface MonitoredCandidate {
  symbol: string;
  breakoutLine: number;
  emaFast: number;
  emaMid: number;
  emaSlow: number;
  direction?: 'LONG' | 'SHORT';
  lastPrice?: number;
}

export interface DirectTriggerPayload {
  symbol: string;
  triggerPrice: number;
  breakoutLine: number;
  slippagePct: string;
  direction: 'LONG' | 'SHORT';
  timestamp: number;
}

export class List2FastScanner {
  private static instance: List2FastScanner | null = null;
  private maxChasingPct: number = 0.008; // 最大追高阈值 0.8%

  // 内存快速索引 (O(1) 复杂度)
  private monitoredPool: Map<string, MonitoredCandidate> = new Map();
  // 正在处理或已触发锁
  private triggeredLocks: Set<string> = new Set();
  // 哑弹自动释放定时器防卡死 (120 秒未挂单/未成交自动解除锁定)
  private lockTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(maxChasingPct: number = 0.008) {
    this.maxChasingPct = maxChasingPct;

    // 监听哑弹解锁/拒绝事件Bus，实现锁生命周期的自动闭环
    eventBus.subscribe('RELEASE_FAST_SCANNER_LOCK', (payload: any) => {
      if (payload && payload.symbol) {
        this.releaseLock(payload.symbol);
      }
    });
  }

  public static getInstance(): List2FastScanner {
    if (!List2FastScanner.instance) {
      List2FastScanner.instance = new List2FastScanner();
    }
    return List2FastScanner.instance;
  }

  /**
   * 1. 同步列表 1（市场初筛池）的 candidates 数据
   */
  public syncList1Pool(list1Candidates: Array<any>): void {
    const activeSymbols = new Set<string>();

    for (const item of list1Candidates) {
      if (!item || !item.symbol) continue;
      const normSym = normalizeSymbol(item.symbol);
      activeSymbols.add(normSym);

      const breakoutLine = parseFloat(item.breakoutLine || item.high || item.price || '0');
      const emaFast = parseFloat(item.emaFast || item.ema10 || '0');
      const emaMid = parseFloat(item.emaMid || item.ema20 || '0');
      const emaSlow = parseFloat(item.emaSlow || item.ema30 || item.ema40 || '0');
      const direction = item.direction || (emaFast >= emaSlow ? 'LONG' : 'SHORT');

      const existing = this.monitoredPool.get(normSym);
      if (!existing) {
        this.monitoredPool.set(normSym, {
          symbol: item.symbol,
          breakoutLine,
          emaFast,
          emaMid,
          emaSlow,
          direction,
          lastPrice: parseFloat(item.price || '0')
        });
      } else {
        existing.breakoutLine = breakoutLine > 0 ? breakoutLine : existing.breakoutLine;
        existing.emaFast = emaFast > 0 ? emaFast : existing.emaFast;
        existing.emaMid = emaMid > 0 ? emaMid : existing.emaMid;
        existing.emaSlow = emaSlow > 0 ? emaSlow : existing.emaSlow;
        existing.direction = direction;
      }
    }

    // 清理已从列表 1 淘汰的币种
    for (const normSym of this.monitoredPool.keys()) {
      if (!activeSymbols.has(normSym)) {
        this.monitoredPool.delete(normSym);
      }
    }
  }

  /**
   * 2. 实时价格推入（由 WebSocket 价格流直接调用，毫秒级响应）
   */
  public onPriceUpdate(rawSymbol: string, rawPrice: number): void {
    const normSym = normalizeSymbol(rawSymbol);
    const target = this.monitoredPool.get(normSym);
    if (!target) return; // 不在初筛监控池中
    if (this.triggeredLocks.has(normSym)) return; // 已触发或加锁中，跳过

    const price = parseFloat(String(rawPrice));
    if (isNaN(price) || price <= 0) return;
    target.lastPrice = price;

    const breakoutLine = target.breakoutLine;
    if (!breakoutLine || breakoutLine <= 0) return;

    // 条件 A: 均线发散/多头形态验证
    const isLongAligned = target.emaFast > target.emaMid && target.emaMid > target.emaSlow;
    const isShortAligned = target.emaFast < target.emaMid && target.emaMid < target.emaSlow;

    const dir = target.direction || (price >= breakoutLine ? 'LONG' : 'SHORT');

    if (dir === 'LONG') {
      if (!isLongAligned && target.emaFast > 0 && target.emaSlow > 0) return;

      // 条件 B: 突破线与安全区间判定 [breakoutLine, breakoutLine * 1.008]
      const maxAllowedPrice = breakoutLine * (1 + this.maxChasingPct);

      if (price >= breakoutLine) {
        if (price <= maxAllowedPrice) {
          // 命中安全进场区间，立即加锁并直推执行
          this.acquireLock(normSym);

          const slippagePct = (((price - breakoutLine) / breakoutLine) * 100).toFixed(2);
          const payload: DirectTriggerPayload = {
            symbol: target.symbol,
            triggerPrice: price,
            breakoutLine,
            slippagePct,
            direction: 'LONG',
            timestamp: Date.now()
          };

          console.log(`⚡ [直通管道触发] ${target.symbol} 多头突破安全区间命中! 突破线: ${breakoutLine}, 现价: ${price}, 偏离: +${slippagePct}%`);
          // 直通事件：直接提交给列表 4 / 下单管道
          eventBus.emit('DIRECT_TRIGGER_TO_LIST4', payload);
        } else {
          // 已经超出突破线 0.8%，判定为追高，锁定并放弃本次行情
          const overPct = (((price - breakoutLine) / breakoutLine) * 100).toFixed(2);
          console.warn(`[追高拦截] ${target.symbol} 当前价 ${price} 超出突破线 ${breakoutLine} 达 +${overPct}%，超出 0.8% 阀值，已舍弃`);
          this.acquireLock(normSym);
        }
      }
    } else if (dir === 'SHORT') {
      if (!isShortAligned && target.emaFast > 0 && target.emaSlow > 0) return;

      // 条件 B: 突破线与安全区间判定 [breakoutLine * 0.992, breakoutLine]
      const minAllowedPrice = breakoutLine * (1 - this.maxChasingPct);

      if (price <= breakoutLine) {
        if (price >= minAllowedPrice) {
          // 命中安全进场区间，立即加锁并直推执行
          this.acquireLock(normSym);

          const slippagePct = (((breakoutLine - price) / breakoutLine) * 100).toFixed(2);
          const payload: DirectTriggerPayload = {
            symbol: target.symbol,
            triggerPrice: price,
            breakoutLine,
            slippagePct,
            direction: 'SHORT',
            timestamp: Date.now()
          };

          console.log(`⚡ [直通管道触发] ${target.symbol} 空头突破安全区间命中! 突破线: ${breakoutLine}, 现价: ${price}, 偏离: -${slippagePct}%`);
          // 直通事件：直接提交给列表 4 / 下单管道
          eventBus.emit('DIRECT_TRIGGER_TO_LIST4', payload);
        } else {
          // 已经低于突破线 0.8%，判定为追高，锁定并放弃本次行情
          const overPct = (((breakoutLine - price) / breakoutLine) * 100).toFixed(2);
          console.warn(`[追高拦截] ${target.symbol} 当前价 ${price} 低于突破线 ${breakoutLine} 达 -${overPct}%，超出 0.8% 阀值，已舍弃`);
          this.acquireLock(normSym);
        }
      }
    }
  }

  private acquireLock(normSym: string): void {
    this.triggeredLocks.add(normSym);
    // 清理旧定时器
    if (this.lockTimers.has(normSym)) {
      clearTimeout(this.lockTimers.get(normSym)!);
    }
    // 设置 120 秒兜底解锁，防止因网络异常或拒绝导致币种永久“哑弹”静音
    const timer = setTimeout(() => {
      this.lockTimers.delete(normSym);
      this.triggeredLocks.delete(normSym);
      console.log(`⏱️ [哑弹自动解锁] ${normSym} 120秒超时未挂单或信号已被淘汰，自动恢复该币监控权限`);
    }, 120000);
    this.lockTimers.set(normSym, timer);
  }

  /**
   * 3. 释放锁（平仓、撤单、审计拒绝或移出时释放该币的加锁权限）
   */
  public releaseLock(rawSymbol: string): void {
    const normSym = normalizeSymbol(rawSymbol);
    if (this.lockTimers.has(normSym)) {
      clearTimeout(this.lockTimers.get(normSym)!);
      this.lockTimers.delete(normSym);
    }
    this.triggeredLocks.delete(normSym);
  }

  /**
   * 清空所有锁与监控池
   */
  public clearAll(): void {
    for (const timer of this.lockTimers.values()) {
      clearTimeout(timer);
    }
    this.lockTimers.clear();
    this.monitoredPool.clear();
    this.triggeredLocks.clear();
  }
}

export const list2FastScanner = List2FastScanner.getInstance();
