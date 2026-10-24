/**
 * 🛡️ [BROWSER KEEPALIVE GUARD]: 浏览器网页端专属防挂起与云端保活系统
 * 
 * 解决问题：
 * 1. 现代浏览器 (Chrome/Edge) 切后台时会挂起主线程 setInterval，导致无法向云端发送心跳；
 * 2. 云端 Cloud Run 容器检测到 5 分钟无 HTTP/WS 活动后，自动 Scale-to-Zero 关机，造成“自动退出”；
 * 3. 本服务使用 Web Worker + Web WakeLock + Web Audio 三重防护，保障浏览器切后台依然无间断保活！
 */

class BrowserKeepAlive {
  private worker: Worker | null = null;
  private wakeLock: any = null;
  private audioCtx: AudioContext | null = null;
  private isInitialized = false;

  public init() {
    if (this.isInitialized || typeof window === 'undefined') return;
    this.isInitialized = true;

    // 1. 尝试请求 Web Screen Wake Lock 防休眠
    this.requestWakeLock();

    // 2. 监听页面可见性变动，切回时恢复 WakeLock
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.requestWakeLock();
          this.pingBackend();
        }
      });
    }

    // 3. 创建内联 Web Worker (Worker 线程不受 Chrome 标签页冻结限制)
    try {
      const workerCode = `
        let timer = null;
        self.onmessage = function(e) {
          if (e.data === 'START') {
            if (timer) clearInterval(timer);
            timer = setInterval(() => {
              self.postMessage('TICK');
            }, 5000); // 每 5 秒发送一次后台脉冲
          } else if (e.data === 'STOP') {
            if (timer) clearInterval(timer);
            timer = null;
          }
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      this.worker = new Worker(workerUrl);

      this.worker.onmessage = (e) => {
        if (e.data === 'TICK') {
          this.pingBackend();
        }
      };

      this.worker.postMessage('START');
      console.log('🛡️ [BrowserKeepAlive] Web Worker 后台保活守护已成功启动');
    } catch (err) {
      console.warn('⚠️ [BrowserKeepAlive] Web Worker 启动降级，使用主线程保活:', err);
      setInterval(() => this.pingBackend(), 8000);
    }

    // 4. 初始化静音音频流（保持 Web Audio 激活，阻止 V8 彻底挂起引擎）
    this.initAudioKeepAlive();
  }

  private async requestWakeLock() {
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
      try {
        this.wakeLock = await (navigator as any).wakeLock.request('screen');
        console.log('🛡️ [BrowserKeepAlive] Web Wake Lock 已获得屏幕挂起锁定');
      } catch (_) {
        // Wake Lock 拒绝或不受支持，忽略
      }
    }
  }

  private initAudioKeepAlive() {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
        // 创建极微弱静音振荡器，确保音频图维持在 Running 状态
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        gain.gain.value = 0.00001; // 静音
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start();
      }
    } catch (_) {}
  }

  private pingBackend() {
    if (typeof fetch === 'undefined') return;
    try {
      // 向后端 API 发送轻量心跳，强制证明活跃流量的存在
      fetch('/api/health?t=' + Date.now(), { cache: 'no-store', priority: 'low' })
        .then(() => {
          // Keep container warm
        })
        .catch(() => {});
    } catch (_) {}
  }
}

export const browserKeepAlive = new BrowserKeepAlive();
