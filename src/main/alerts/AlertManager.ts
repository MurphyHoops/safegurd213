import { exec } from 'child_process';
import nodemailer from 'nodemailer';
import { HealthState, SystemStatus } from '../guards/SystemHealthGuard';

export class AlertManager {
  private static instance: AlertManager;
  private isSirenMuted: boolean = false;
  private sirenIntervalTimer: NodeJS.Timeout | null = null;
  private smtpTransporter: nodemailer.Transporter | null = null;

  private constructor() {
    this.initSmtpTransporter();
  }

  public static getInstance(): AlertManager {
    if (!AlertManager.instance) {
      AlertManager.instance = new AlertManager();
    }
    return AlertManager.instance;
  }

  private initSmtpTransporter(): void {
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      this.smtpTransporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 465,
        secure: true,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
    }
  }

  public triggerAlert(state: HealthState): void {
    this.showDesktopNotification(state);
    this.sendEmailAlert(state);
    if (!this.isSirenMuted) {
      this.startPhysicalSiren();
    }
  }

  public stopAlert(): void {
    this.stopPhysicalSiren();
  }

  public setSirenMuted(muted: boolean): void {
    this.isSirenMuted = muted;
    if (muted) {
      this.stopPhysicalSiren();
    }
  }

  public muteSiren(): void {
    this.setSirenMuted(true);
  }

  public unmuteSiren(): void {
    this.setSirenMuted(false);
  }

  public getSirenMuted(): boolean {
    return this.isSirenMuted;
  }

  public getSmtpConfig(): { host: string; port: number; user: string; to: string } {
    return {
      host: process.env.SMTP_HOST || '',
      port: Number(process.env.SMTP_PORT) || 465,
      user: process.env.SMTP_USER || '',
      to: process.env.ALERT_EMAIL_TO || 'deven.murphyq@gmail.com',
    };
  }

  public updateSmtpConfig(config: { host?: string; port?: number; user?: string; pass?: string; to?: string }): void {
    if (config.host !== undefined) process.env.SMTP_HOST = config.host;
    if (config.port !== undefined) process.env.SMTP_PORT = String(config.port);
    if (config.user !== undefined) process.env.SMTP_USER = config.user;
    if (config.pass !== undefined) process.env.SMTP_PASS = config.pass;
    if (config.to !== undefined) process.env.ALERT_EMAIL_TO = config.to;
    this.initSmtpTransporter();
  }

  private showDesktopNotification(state: HealthState): void {
    const title = state.status === SystemStatus.IP_DRIFT_LOCK
      ? '🚨 警报：IP漂移/API白名单拦截 (-2015)'
      : '⚠️ 警报：交易所连接中断 (Outage)';
    const body = `新出口 IP: ${state.currentIp || '未获取'}。系统已自动停止访问币安，防止崩溃！`;

    try {
      const electron = require('electron');
      const Notification = electron?.Notification;
      if (Notification && Notification.isSupported && Notification.isSupported()) {
        new Notification({ title, body, urgency: 'critical' }).show();
        return;
      }
    } catch (_) {}

    console.log(`[DesktopNotification Fallback] ${title} | ${body}`);
  }

  private startPhysicalSiren(): void {
    if (this.sirenIntervalTimer) return;

    const playBeep = () => {
      if (this.isSirenMuted) return;
      if (process.platform === 'darwin') {
        exec('afplay /System/Library/Sounds/Glass.aiff');
      } else if (process.platform === 'win32') {
        exec('powershell -c "[console]::beep(1000, 500)"');
      } else {
        process.stdout.write('\x07');
      }
    };

    playBeep();
    this.sirenIntervalTimer = setInterval(playBeep, 2000);
  }

  private stopPhysicalSiren(): void {
    if (this.sirenIntervalTimer) {
      clearInterval(this.sirenIntervalTimer);
      this.sirenIntervalTimer = null;
    }
  }

  private async sendEmailAlert(state: HealthState): Promise<void> {
    const targetEmail = process.env.ALERT_EMAIL_TO || 'deven.murphyq@gmail.com';
    if (!this.smtpTransporter) {
      console.warn(`[AlertManager] ⚠️ 触发 IP 漂移/熔断，但尚未配置 SMTP 邮箱密码 (process.env.SMTP_USER / SMTP_PASS)。告警邮件预定发送至: ${targetEmail}`);
      return;
    }

    const subject = `[紧急风控] 币安系统 IP 漂移熔断警报 - 已全线停止访问币安 (${state.currentIp || '未知IP'})`;
    const html = `
      <div style="padding: 24px; background: #0f172a; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; border-radius: 8px; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #ef4444; margin-top: 0; display: flex; align-items: center; gap: 8px;">
          🚨 币安交易系统安全熔断警报
        </h2>
        <p style="font-size: 15px; line-height: 1.6; color: #cbd5e1;">
          系统主动探针检测到服务器出口 IP 发生了漂移变动！为防止因 IP 未在币安 API 白名单而导致频繁报 <code style="color:#f87171;">-2015 Invalid API-key</code> 并引发币安 IP 封禁 (418 / -1003) 和程序崩溃：
        </p>
        <div style="background: #1e293b; padding: 16px; border-radius: 6px; margin: 16px 0; border-left: 4px solid #ef4444;">
          <p style="margin: 6px 0;"><strong>当前系统状态：</strong> <span style="color: #f59e0b; font-weight: bold;">${state.status} (全线静默阻断中)</span></p>
          <p style="margin: 6px 0;"><strong>最新公网出口 IP：</strong> <span style="font-size: 18px; color: #38bdf8; font-weight: bold;">${state.currentIp || '未检测到'}</span></p>
          <p style="margin: 6px 0;"><strong>原公网出口 IP：</strong> ${state.previousIp || '未记录'}</p>
          <p style="margin: 6px 0;"><strong>拦截原因：</strong> ${state.lastError || '出口 IP 发生变动'}</p>
        </div>
        <div style="background: #0284c715; border: 1px solid #0284c740; padding: 12px; border-radius: 6px; margin-bottom: 20px;">
          <p style="margin: 0; font-size: 14px; color: #38bdf8;">
            🛡️ <strong>安全防护防护生效中：</strong> 所有发往币安 REST API 的网络请求已被本地中间件 100% 拒绝并静默拦截，不会产生任何无效网络轮询。
          </p>
        </div>
        <p style="font-weight: bold; margin-top: 20px; font-size: 16px;">恢复系统自愈步骤：</p>
        <ol style="line-height: 1.8; color: #e2e8f0;">
          <li>登录币安 (Binance) 官网 API 管理页面。</li>
          <li>将最新出口 IP <code style="background: #334155; padding: 2px 8px; border-radius: 4px; color: #38bdf8; font-weight: bold;">${state.currentIp || '未知'}</code> 填入白名单列表中并保存。</li>
          <li>在交易控制台界面点击<b>【重试连通 / 白名单已加】</b>按钮即可一键解锁并恢复交易。</li>
        </ol>
        <hr style="border: none; border-top: 1px solid #334155; margin: 24px 0 12px 0;" />
        <p style="font-size: 12px; color: #64748b; margin: 0;">此邮件由 0211 自动找币防爆仓救世之星系统自动发出，请勿直接回复。</p>
      </div>
    `;

    try {
      await this.smtpTransporter.sendMail({
        from: process.env.SMTP_USER,
        to: targetEmail,
        subject,
        html
      });
      console.log(`[AlertManager] 🚨 IP漂移/熔断告警邮件已成功发送至: ${targetEmail}`);
    } catch (err) {
      console.error('[AlertManager] 邮件发送失败:', err);
    }
  }
}

export const alertManager = AlertManager.getInstance();
