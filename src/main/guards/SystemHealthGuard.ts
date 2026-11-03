import { EventEmitter } from 'events';
import axios, { AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

export enum SystemStatus {
  HEALTHY = 'HEALTHY',
  IP_DRIFT_LOCK = 'IP_DRIFT_LOCK',
  EXCHANGE_OUTAGE = 'EXCHANGE_OUTAGE',
  LOCAL_NETWORK_DOWN = 'LOCAL_NETWORK_DOWN'
}

export interface HealthState {
  status: SystemStatus;
  currentIp: string | null;
  previousIp: string | null;
  lastError: string | null;
  timestamp: number;
}

export interface IncidentState {
  status: SystemStatus;
  currentIp: string;
  oldIp: string;
  timestamp: number;
  reason: string;
}

export class SystemHealthGuard extends EventEmitter {
  private static instance: SystemHealthGuard;
  private currentStatus: SystemStatus = SystemStatus.HEALTHY;
  private currentIp: string | null = null;
  private previousIp: string | null = null;
  private lastError: string | null = null;
  private checkIntervalTimer: NodeJS.Timeout | null = null;
  private authProbeFn: (() => Promise<boolean>) | null = null;
  private isProbing: boolean = false;

  private constructor() {
    super();
    this.startActiveProbing();
  }

  public static getInstance(): SystemHealthGuard {
    if (!SystemHealthGuard.instance) {
      SystemHealthGuard.instance = new SystemHealthGuard();
    }
    return SystemHealthGuard.instance;
  }

  public setAuthProbe(fn: () => Promise<boolean>): void {
    this.authProbeFn = fn;
  }

  public getHealthState(): HealthState {
    return {
      status: this.currentStatus,
      currentIp: this.currentIp,
      previousIp: this.previousIp,
      lastError: this.lastError,
      timestamp: Date.now()
    };
  }

  public getIncidentState(): IncidentState {
    return {
      status: this.currentStatus,
      currentIp: this.currentIp || '未检测到',
      oldIp: this.previousIp || this.currentIp || '未检测到',
      timestamp: Date.now(),
      reason: this.lastError || ''
    };
  }

  public isSystemLocked(): boolean {
    return this.currentStatus !== SystemStatus.HEALTHY;
  }

  public startMonitoring(intervalMs: number = 10000): void {
    this.startActiveProbing(intervalMs);
  }

  public stopMonitoring(): void {
    if (this.checkIntervalTimer) {
      clearInterval(this.checkIntervalTimer);
      this.checkIntervalTimer = null;
    }
  }

  public triggerIpDrift(newIp: string, errorMsg: string = '币安拦截 -2015：IP未在白名单或发生漂移'): void {
    if (this.currentIp && this.currentIp !== newIp) {
      this.previousIp = this.currentIp;
    }
    this.currentIp = newIp;
    this.lastError = errorMsg;
    const wasAlreadyLocked = this.currentStatus === SystemStatus.IP_DRIFT_LOCK;
    this.currentStatus = SystemStatus.IP_DRIFT_LOCK;

    const state = this.getHealthState();
    if (!wasAlreadyLocked) {
      this.emit('incident', state);
      this.emit('ip_drift', state);
    }
  }

  public triggerExchangeOutage(reason: string): void {
    this.lastError = reason;
    const wasAlreadyLocked = this.currentStatus === SystemStatus.EXCHANGE_OUTAGE;
    this.currentStatus = SystemStatus.EXCHANGE_OUTAGE;

    const state = this.getHealthState();
    if (!wasAlreadyLocked) {
      this.emit('incident', state);
      this.emit('exchange_outage', state);
    }
  }

  public async manualVerifyAndUnlock(): Promise<{ success: boolean; message: string; ip?: string }> {
    const publicIp = await this.detectPublicIpWithProxy();
    if (publicIp) {
      this.currentIp = publicIp;
    }

    if (this.authProbeFn) {
      try {
        const isAuthPassed = await this.authProbeFn();
        if (!isAuthPassed) {
          return {
            success: false,
            message: `白名单校验失败！公网 IP [${this.currentIp || '未知'}] 仍被币安拒绝 (-2015)，请确认已在币安 API 管理中添加该白名单`,
            ip: this.currentIp || '未知'
          };
        }
      } catch (err: any) {
        return {
          success: false,
          message: `连通性探针测试异常: ${err.message || '带鉴权请求被拦截'}`,
          ip: this.currentIp || '未知'
        };
      }
    }

    this.currentStatus = SystemStatus.HEALTHY;
    this.lastError = null;
    this.purgePendingOrderRetryQueues();

    const state = this.getHealthState();
    this.emit('recovered', state);

    return {
      success: true,
      message: `系统成功自愈恢复！当前白名单出口 IP: ${this.currentIp}`,
      ip: this.currentIp || '未知'
    };
  }

  public purgePendingOrderRetryQueues(): void {
    console.log('[SystemHealthGuard] 触发自愈复位：向策略引擎广播清空挂单重试队列事件');
    this.emit('purge_pending_orders');
  }

  // 核心修正：挂载代理配置，保证探测到的出口 IP 与币安请求出口一致
  public async detectPublicIpWithProxy(): Promise<string | null> {
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
    const axiosConfig: AxiosRequestConfig = { timeout: 4000 };

    if (proxyUrl) {
      try {
        axiosConfig.httpsAgent = new HttpsProxyAgent(proxyUrl);
        axiosConfig.proxy = false; // 禁用 axios 默认环境变量代理，由 Agent 全权接管
      } catch (_) {}
    }

    const witnessNodes = [
      'https://api.ipify.org?format=json',
      'https://1.1.1.1/cdn-cgi/trace',
      'https://api.myip.com'
    ];

    for (const url of witnessNodes) {
      try {
        const res = await axios.get(url, axiosConfig);
        if (res.data) {
          if (typeof res.data === 'object' && res.data.ip) {
            return String(res.data.ip).trim();
          }
          if (typeof res.data === 'string') {
            const match = res.data.match(/ip=([^\s]+)/);
            if (match && match[1]) return match[1].trim();
            if (/^[0-9a-fA-F:.]+$/.test(res.data.trim())) return res.data.trim();
          }
        }
      } catch (_) {}
    }
    return null;
  }

  // 核心修正：补全空仓期对币安的轮询检测以及断网后的自愈检测
  public startActiveProbing(intervalMs: number = 10000): void {
    if (this.checkIntervalTimer) clearInterval(this.checkIntervalTimer);
    this.checkIntervalTimer = setInterval(async () => {
      if (this.isProbing) return;
      this.isProbing = true;

      try {
        // 1. IP 漂移主动检测
        const detectedIp = await this.detectPublicIpWithProxy();
        if (detectedIp && this.currentIp && detectedIp !== this.currentIp) {
          console.warn(`[SystemHealthGuard] 探针检测到出口 IP 变动: ${this.currentIp} -> ${detectedIp}`);
          this.triggerIpDrift(detectedIp, `主动探针检测到出口 IP 漂移为: ${detectedIp}`);
          return;
        } else if (detectedIp && !this.currentIp) {
          this.currentIp = detectedIp;
        }

        // 2. 交易所连通性交叉轮询（支持自动发现拔网线，以及拔网线后的自动复苏）
        if (this.currentStatus === SystemStatus.HEALTHY || this.currentStatus === SystemStatus.EXCHANGE_OUTAGE) {
          try {
            const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
            const pingConfig: AxiosRequestConfig = { timeout: 3000 };
            if (proxyUrl) {
              try {
                pingConfig.httpsAgent = new HttpsProxyAgent(proxyUrl);
                pingConfig.proxy = false;
              } catch (_) {}
            }
            const pingRes = await axios.get('https://fapi.binance.com/fapi/v1/ping', pingConfig);
            if (pingRes.status === 200 && this.currentStatus === SystemStatus.EXCHANGE_OUTAGE) {
              console.log('[SystemHealthGuard] 探测到币安接口已恢复通畅，系统自动恢复运行');
              this.currentStatus = SystemStatus.HEALTHY;
              this.lastError = null;
              this.emit('recovered', this.getHealthState());
            }
          } catch (err: any) {
            // 418 是币安防爬或频控暂态限制，绝不误判为交易所拔网线熔断
            const isRateLimit418 = err.response && err.response.status === 418;
            if (this.currentStatus === SystemStatus.HEALTHY && !isRateLimit418) {
              this.triggerExchangeOutage(`主动巡检发现币安接口超时/中断: ${err.message}`);
            }
          }
        }
      } finally {
        this.isProbing = false;
      }
    }, intervalMs);
  }
}

export const systemHealthGuard = SystemHealthGuard.getInstance();
