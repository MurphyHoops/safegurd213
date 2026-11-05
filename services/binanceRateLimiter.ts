/**
 * 🔒 币安 API 全局熔断器与权重自适应限频引擎 (修正版)
 * 
 * 核心功能：
 * 1. 物理级全局熔断锁 (Circuit Breaker)：捕获 429/418 响应，立即激活全局静默，绝对阻断发往币安的网络请求，杜绝封禁计时重置。
 * 2. 权重监控与自适应降频 (Rate Limit Tracker)：实时解析 x-mbx-used-weight-1m 响应头，使用率 ≥ 80% 时自动推迟非核心定时对账。
 * 3. 权重 65 秒防死锁衰减机制 (Weight Decay)：超过 65 秒无新响应更新时自动复位 currentWeight1m，防止无核心订单时永久死锁拦截。
 * 4. 账户深度对账防抖与互斥锁 (Mutex & Throttle)：60 秒防抖限制 + 互斥锁，彻底规避手动触发与后台巡检并发冲撞。
 */

export interface RateLimiterStatus {
  isFrozen: boolean;
  frozenReason: string;
  frozenUntil: number;
  remainingFrozenSeconds: number;
  currentWeight1m: number;
  maxWeightLimit: number;
  weightUsageRatio: number;
  isHighWeight: boolean; // weight >= 80%
  lastManualReconciliationTime: number;
  isReconciling: boolean;
}

class BinanceRateLimiter {
  private isFrozen: boolean = false;
  private frozenReason: string = '';
  private frozenUntil: number = 0;
  private currentWeight1m: number = 0;
  private lastWeightUpdateTime: number = Date.now();
  private maxWeightLimit: number = 1200; // 合约 1 分钟权重上限通常为 1200 或 2400
  private lastManualReconciliationTime: number = 0;
  private isReconcilingMutex: boolean = false;
  private listeners: Set<(status: RateLimiterStatus) => void> = new Set();

  constructor() {
    // 自动解冻与权重衰减巡检器
    if (typeof window !== 'undefined' || typeof global !== 'undefined') {
      setInterval(() => {
        this.tickMaintenance();
      }, 1000);
    }
  }

  /**
   * 1. 全局请求出站门禁拦截器：在发送任何 REST 请求前调用
   * 核心订单 (isCoreOrder = true) 在权重高时依然允许放行，但熔断期一律阻断
   */
  public checkCanRequest(isCoreOrder: boolean = false): void {
    if (this.isFrozen && Date.now() < this.frozenUntil) {
      const remainingSec = Math.ceil((this.frozenUntil - Date.now()) / 1000);
      const errMsg = `[CIRCUIT_BREAKER_FROZEN] 币安 API 处于全局熔断保护状态 (${this.frozenReason || '429/418限频'})。剩余冷却: ${remainingSec} 秒。请求已被本地直接物理拦截，绝对未向币安发包！`;
      console.warn(`🚨 [RateLimiter Interceptor] ${errMsg}`);
      throw new Error(errMsg);
    }

    // 若权重消耗过高 (>=80%) 且为非核心定时任务，推迟执行
    if (this.isHighWeight() && !isCoreOrder) {
      const errMsg = `[RATE_LIMIT_WEIGHT_HIGH] 币安 1 分钟权重消耗已达 ${(this.getWeightUsageRatio() * 100).toFixed(1)}% (${this.currentWeight1m}/${this.maxWeightLimit})，已自动推迟非核心对账与巡检任务。`;
      console.warn(`⚠️ [RateLimiter Weight Tracker] ${errMsg}`);
      throw new Error(errMsg);
    }
  }

  /**
   * 2. 响应头与状态码统一解析器 (Axios / Fetch 通用)
   * 提取 429 / 418 错误与 Retry-After，解析 x-mbx-used-weight-1m
   */
  public handleResponse(status: number, headers: Headers | Record<string, string | undefined> | any, bodyText?: string): void {
    const headerMap = this.normalizeHeaders(headers);

    // 解析权重响应头 (x-mbx-used-weight-1m / x-fapi-used-weight-1m)
    const weightStr = headerMap['x-mbx-used-weight-1m'] || headerMap['x-mbx-used-weight'] || headerMap['x-fapi-used-weight-1m'] || headerMap['x-fapi-used-weight'];
    if (weightStr) {
      const parsedWeight = parseInt(weightStr, 10);
      if (!isNaN(parsedWeight)) {
        this.currentWeight1m = parsedWeight;
        this.lastWeightUpdateTime = Date.now();
      }
    }

    // 捕获 429 与 418 熔断触发
    if (status === 429 || status === 418) {
      let cooldownMs = status === 429 ? 60000 : 120000; // 默认 429: 60s, 418: 120s

      // 优先解析 Retry-After 响应头 (秒数)
      const retryAfterStr = headerMap['retry-after'];
      if (retryAfterStr) {
        const retryAfterVal = parseInt(retryAfterStr, 10);
        if (!isNaN(retryAfterVal) && retryAfterVal > 0) {
          cooldownMs = retryAfterVal * 1000;
        }
      } else if (bodyText) {
        // 从响应体文本解析 "banned until 1672531199000" 或 "wait 60s"
        const banMatch = bodyText.match(/banned until (\d+)/i);
        if (banMatch && banMatch[1]) {
          const rawUntil = parseInt(banMatch[1], 10);
          const untilMs = rawUntil > 10000000000 ? rawUntil : rawUntil * 1000;
          if (untilMs > Date.now()) {
            cooldownMs = untilMs - Date.now();
          }
        }
      }

      this.triggerCircuitBreaker(
        status === 418 ? `IP 触发 418 WAF 封禁` : `触发 429 权重超限`,
        cooldownMs
      );
    }

    this.notifyStatus();
  }

  /**
   * 触发全局熔断
   */
  public triggerCircuitBreaker(reason: string, durationMs: number = 120000): void {
    const now = Date.now();
    const newUntil = now + durationMs;
    
    if (newUntil > this.frozenUntil) {
      this.frozenUntil = newUntil;
    }
    this.isFrozen = true;
    this.frozenReason = reason;

    const remainingSec = Math.ceil((this.frozenUntil - Date.now()) / 1000);
    console.error(`🚨 [CIRCUIT BREAKER ACTIVATED] 捕获币安限频封禁 (${reason})！全局熔断已激活，静默冷却 ${remainingSec} 秒。在此期间所有 REST 请求将被本地物理拦截，绝对禁止向币安发包！`);
    this.notifyStatus();
  }

  /**
   * 定时巡检：处理解冻 & 权重分钟级衰减（防止死锁）
   */
  private tickMaintenance(): void {
    const now = Date.now();
    let hasChanged = false;

    // 1. 自动解冻判定
    if (this.isFrozen && now >= this.frozenUntil) {
      this.isFrozen = false;
      this.frozenUntil = 0;
      this.frozenReason = '';
      console.log(`🟢 [CIRCUIT BREAKER DEACTIVATED] 熔断静默冷却期已结束，全局 API 限制安全解除！`);
      hasChanged = true;
    }

    // 2. 权重时间衰减机制：超过 65 秒未有新请求响应，自动复位权重，破除死锁
    if (this.currentWeight1m > 0 && now - this.lastWeightUpdateTime > 65000) {
      this.currentWeight1m = 0;
      hasChanged = true;
    }

    if (hasChanged) {
      this.notifyStatus();
    }
  }

  /**
   * 3. 账户深度对账防抖 (60 秒硬限制)
   */
  public canTriggerManualReconciliation(): { allowed: boolean; remainingSeconds: number } {
    const now = Date.now();
    const elapsed = now - this.lastManualReconciliationTime;
    const cooldownMs = 60000; // 至少间隔 60 秒

    if (elapsed < cooldownMs) {
      const remainingSeconds = Math.ceil((cooldownMs - elapsed) / 1000);
      return { allowed: false, remainingSeconds };
    }
    return { allowed: true, remainingSeconds: 0 };
  }

  /**
   * 4. 账户对账互斥锁 (Mutex)
   * 保证手动触发对账与后台定时巡检互斥，绝不并发执行
   */
  public async executeReconciliationWithMutex<T>(
    taskFn: () => Promise<T>,
    isManual: boolean = false
  ): Promise<T | null> {
    if (this.isReconcilingMutex) {
      console.warn(`[Reconciliation Mutex] 对账任务已被锁定在执行中 (${isManual ? '手动操作' : '后台巡检'})，跳过重复并发触发。`);
      return null;
    }

    if (isManual) {
      const { allowed, remainingSeconds } = this.canTriggerManualReconciliation();
      if (!allowed) {
        throw new Error(`[RECONCILIATION_THROTTLED] 手动深度对账点击过于频繁，请等待 ${remainingSeconds} 秒后再试。`);
      }
      this.lastManualReconciliationTime = Date.now();
    }

    this.isReconcilingMutex = true;
    this.notifyStatus();

    try {
      return await taskFn();
    } finally {
      this.isReconcilingMutex = false;
      this.notifyStatus();
    }
  }

  public isHighWeight(): boolean {
    return this.getWeightUsageRatio() >= 0.8;
  }

  public getWeightUsageRatio(): number {
    return Math.min(1.0, this.currentWeight1m / this.maxWeightLimit);
  }

  public getStatus(): RateLimiterStatus {
    const now = Date.now();
    return {
      isFrozen: this.isFrozen && now < this.frozenUntil,
      frozenReason: this.frozenReason,
      frozenUntil: this.frozenUntil,
      remainingFrozenSeconds: this.isFrozen && now < this.frozenUntil ? Math.ceil((this.frozenUntil - now) / 1000) : 0,
      currentWeight1m: this.currentWeight1m,
      maxWeightLimit: this.maxWeightLimit,
      weightUsageRatio: this.getWeightUsageRatio(),
      isHighWeight: this.isHighWeight(),
      lastManualReconciliationTime: this.lastManualReconciliationTime,
      isReconciling: this.isReconcilingMutex
    };
  }

  public subscribe(listener: (status: RateLimiterStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyStatus(): void {
    const status = this.getStatus();
    this.listeners.forEach((listener) => {
      try {
        listener(status);
      } catch (e) {
        console.error('Error in rate limiter listener:', e);
      }
    });
  }

  private normalizeHeaders(headers: any): Record<string, string> {
    const result: Record<string, string> = {};
    if (!headers) return result;

    if (typeof headers.forEach === 'function') {
      headers.forEach((val: string, key: string) => {
        result[key.toLowerCase()] = val;
      });
    } else if (typeof headers === 'object') {
      for (const [k, v] of Object.entries(headers)) {
        if (typeof v === 'string') {
          result[k.toLowerCase()] = v;
        } else if (Array.isArray(v)) {
          result[k.toLowerCase()] = v.join(', ');
        } else if (v !== undefined && v !== null) {
          result[k.toLowerCase()] = String(v);
        }
      }
    }
    return result;
  }
}

export const binanceRateLimiter = new BinanceRateLimiter();

