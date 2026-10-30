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

    // 2. 尝试请求 Chromium Web Locks 锁，防止标签页被系统作为非活动页丢弃 (Tab Discard Protection)
    this.requestWebLock();

    // 3. 监听页面可见性与生命周期变动，切回时恢复 WakeLock 与音频
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.requestWakeLock();
          this.resumeAudioContext();
          this.pingBackend();
        }
      });
      // 监听 Page Lifecycle API
      document.addEventListener('freeze', () => {
        console.warn('⚠️ [BrowserKeepAlive] 浏览器试图挂起标签页，保持 Worker 与网络心跳...');
      });
      document.addEventListener('resume', () => {
        console.log('✅ [BrowserKeepAlive] 标签页自挂起状态恢复');
        this.requestWakeLock();
        this.resumeAudioContext();
        this.pingBackend();
      });
    }

    // 4. 用户交互时恢复音频上下文 (解决浏览器自动播放与静音音频策略)
    if (typeof window !== 'undefined') {
      const unlockAudio = () => {
        this.resumeAudioContext();
      };
      window.addEventListener('click', unlockAudio, { passive: true });
      window.addEventListener('keydown', unlockAudio, { passive: true });
      window.addEventListener('touchstart', unlockAudio, { passive: true });
    }

    // 5. 创建内联 Web Worker (Worker 线程不受 Chrome 标签页冻结限制)
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

    // 6. 初始化静音音频流（保持 Web Audio 激活，阻止 V8 彻底挂起引擎）
    this.initAudioKeepAlive();
  }

  private async requestWebLock() {
    if (typeof navigator !== 'undefined' && 'locks' in navigator && (navigator as any).locks?.request) {
      try {
        (navigator as any).locks.request('savior_trading_daemon_lock', { mode: 'shared' }, async () => {
          console.log('🛡️ [BrowserKeepAlive] Chromium Web Lock 已持有，免疫系统自动休眠回收');
          // 维持持久挂起 Promise，阻止浏览器 Tab Discard
          await new Promise(() => {});
        }).catch(() => {});
      } catch (_) {}
    }
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

  private resumeAudioContext() {
    try {
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
    } catch (_) {}
  }

  private initAudioKeepAlive() {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        gain.gain.value = 0.00001; // 微量静音，维持音频管线激活
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start();
      }
    } catch (_) {}
  }

  private pingBackend() {
    if (typeof fetch === 'undefined') return;
    try {
      fetch('/api/health?t=' + Date.now(), { cache: 'no-store', priority: 'low' })
        .then(() => {})
        .catch(() => {});
    } catch (_) {}
  }
}

export const browserKeepAlive = new BrowserKeepAlive();
