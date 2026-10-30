// 🛡️ [绝对顶部：锁定生产环境与服务端口，杜绝依赖未打包构建工具]
process.env.NODE_ENV = 'production';
process.env.PORT = '3000';

const { app, BrowserWindow, shell, powerSaveBlocker, Tray, Menu, nativeImage, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// 🛡️ [安全硬件加速与纯净渲染配置]
// 彻底禁用 GPU 硬件加速与 GPU 合成，规避 Windows 锁屏/夜间息屏导致显卡驱动重置引起的闪退
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-gpu-rasterization');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,IntensiveWakeUpThrottling,HighEfficiencyModeAvailable,AudioServiceOutOfProcess');

// 🛡️ [Node.js 永续生命线 Keep-Alive]: 维持主进程事件循环永不排空，杜绝 Windows 无窗口或窗口隐藏时事件循环耗尽自退
const _daemonKeepAliveTimer = setInterval(() => {
  // 保持主进程事件循环持续活跃
}, 15000);

// 🛡️ [持久化崩溃黑匣子写入工具]：同步落盘到工作目录与 userData 目录，确保闪退原因永不丢失
function logCrashToFile(moduleName, message, stack) {
  try {
    const timestamp = Date.now();
    const timeStr = new Date(timestamp).toLocaleString();
    const entry = {
      id: 'electron_' + timestamp.toString(36) + '_' + Math.random().toString(36).substring(2, 6),
      timestamp,
      timeStr,
      module: moduleName || 'ELECTRON_CORE',
      message: String(message || '未知异常'),
      stack: String(stack || ''),
      type: 'ELECTRON_CRASH'
    };

    let targetPaths = [path.join(process.cwd(), 'crash_reports.json')];
    try {
      if (app && typeof app.getPath === 'function') {
        targetPaths.push(path.join(app.getPath('userData'), 'crash_reports.json'));
      }
    } catch (_) {}

    for (const targetPath of targetPaths) {
      try {
        let reports = [];
        if (fs.existsSync(targetPath)) {
          try {
            const content = fs.readFileSync(targetPath, 'utf-8');
            reports = JSON.parse(content);
            if (!Array.isArray(reports)) reports = [];
          } catch (_) {
            reports = [];
          }
        }
        reports.unshift(entry);
        if (reports.length > 50) reports.length = 50;
        fs.writeFileSync(targetPath, JSON.stringify(reports, null, 2), 'utf-8');
      } catch (_) {}
    }

    // 同时追加写入纯文本日志
    const txtLog = `[${timeStr}] [${moduleName}] ${message}\n${stack ? stack + '\n' : ''}`;
    try {
      fs.appendFileSync(path.join(process.cwd(), 'electron_crash.log'), txtLog, 'utf-8');
    } catch (_) {}
  } catch (_) {}
}

// 🛡️ [物理级进程退出日志 (Exit Logger)]: 同步落盘 process_exit.log，记录进程关闭元数据与信号来源
function recordPhysicalExit(eventName, details) {
  try {
    const now = new Date();
    const timeStr = now.toISOString().replace('T', ' ').replace('Z', '');
    const mem = process.memoryUsage ? process.memoryUsage() : {};
    const memSummary = `RSS: ${Math.round((mem.rss || 0) / 1024 / 1024)}MB, Heap: ${Math.round((mem.heapUsed || 0) / 1024 / 1024)}MB/${Math.round((mem.heapTotal || 0) / 1024 / 1024)}MB`;
    const detailsStr = typeof details === 'object' ? JSON.stringify(details) : String(details);
    const line = `[${timeStr}] [ELECTRON_MAIN] [PID:${process.pid}|PPID:${process.ppid}] [EVENT:${eventName}] ${detailsStr} | Uptime: ${Math.round(process.uptime())}s | Memory: ${memSummary}\n`;
    
    let targetPaths = [path.join(process.cwd(), 'process_exit.log')];
    try {
      if (app && typeof app.getPath === 'function') {
        targetPaths.push(path.join(app.getPath('userData'), 'process_exit.log'));
      }
    } catch (_) {}

    for (const targetPath of targetPaths) {
      try {
        fs.appendFileSync(targetPath, line, 'utf-8');
      } catch (_) {}
    }
  } catch (_) {}
}

// 🛡️ [单实例互斥锁与子进程放行]
if (process.env.ELECTRON_RUN_AS_NODE === '1') {
  console.log('🚀 [Electron Guard] 纯 Node.js 服务模式运行，跳过 UI 单实例互斥');
} else {
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    console.log('⚠️ [Electron Guard] 检测到已有实例正在运行，自动退出重复进程并聚焦主实例');
    recordPhysicalExit('DUPLICATE_INSTANCE_EXIT', { pid: process.pid });
    app.quit();
    process.exit(0);
  }
}

// 🛡️ [操作系统物理防挂起休眠锁]: 24小时量化机器人交易核心，阻止 Windows/系统将进程挂起或睡眠网卡
let powerBlockerId = null;

function acquirePowerSaveBlocker() {
  try {
    if (powerBlockerId === null || !powerSaveBlocker.isStarted(powerBlockerId)) {
      powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
      console.log(`🛡️ [PowerGuard] 已成功启用操作系统物理防挂起休眠锁 (powerBlockerId: ${powerBlockerId})，阻止系统挂起与睡眠网卡`);
    }
  } catch (e) {
    console.warn('⚠️ [PowerGuard] powerSaveBlocker 启动失败:', e);
  }
}

function releasePowerSaveBlocker() {
  try {
    if (powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId)) {
      powerSaveBlocker.stop(powerBlockerId);
      console.log(`🛡️ [PowerGuard] 已安全释放防休眠挂起锁 (powerBlockerId: ${powerBlockerId})`);
      powerBlockerId = null;
    }
  } catch (e) {
    console.warn('⚠️ [PowerGuard] releasePowerSaveBlocker 异常:', e);
  }
}

// 🛡️ [Windows 系统级防休眠与夜间自动恢复配置]
if (process.platform === 'win32') {
  try {
    const { exec } = require('child_process');
    // 设置 Windows 电源策略：接通电源时不自动睡眠/休眠
    exec('powercfg /change standby-timeout-ac 0', () => {});
    exec('powercfg /change hibernate-timeout-ac 0', () => {});
  } catch (_) {}
}

// 🛡️ [Windows 夜间系统更新/重启后自启动恢复交易守护]:
if (app && typeof app.setLoginItemSettings === 'function') {
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: false
    });
    console.log('🛡️ [Electron Guard] 已开启 Windows 开机/重启后自动恢复交易守护 (openAtLogin)');
  } catch (e) {
    console.warn('⚠️ 设置开机自启失败:', e);
  }
}

// 🛡️ [Windows 会话与电源事件完整免疫守护]
if (powerMonitor) {
  powerMonitor.on('suspend', () => {
    console.log('🛡️ [PowerMonitor] 系统挂起事件，保持后台交易引擎运行');
    recordPhysicalExit('powerMonitor:suspend', {});
  });
  powerMonitor.on('resume', () => {
    console.log('🛡️ [PowerMonitor] 系统恢复，恢复看盘窗口刷新');
    recordPhysicalExit('powerMonitor:resume', {});
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.reload();
      if (!mainWindow.isVisible()) mainWindow.show();
    }
  });
  powerMonitor.on('lock-screen', () => {
    console.log('🛡️ [PowerMonitor] 屏幕锁定/RDP断开，后台量化交易永续运行');
  });
  powerMonitor.on('unlock-screen', () => {
    console.log('🛡️ [PowerMonitor] 屏幕解锁/RDP重连，恢复主窗口');
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) mainWindow.show();
    }
  });
}

// 拦截 Windows 会话注销/关闭信号，防止远程桌面断开杀死程序
app.on('session-end', (e) => {
  console.warn('🛡️ [Electron Guard] 收到 Windows session-end 会话信号，拦截退出保护交易');
  if (e && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }
  recordPhysicalExit('app:session-end', {});
});

// 捕获 GPU 进程崩溃并优雅恢复，防止显卡重置引发程序自退
app.on('gpu-process-gone', (event, details) => {
  console.warn('⚠️ [Electron Guard] GPU 渲染引擎瞬时异常或驱动重置 (自动平滑隔离，保障交易运行):', details);
  logCrashToFile('ELECTRON_GPU_GONE', `GPU驱动重置或进程异常: reason=${details.reason}, exitCode=${details.exitCode}`);
});

// 全局底层退出与信号监听
process.on('exit', (code) => {
  recordPhysicalExit('exit', { code, reason: 'Node.js event loop terminated' });
});

process.on('beforeExit', (code) => {
  recordPhysicalExit('beforeExit', { code, reason: 'Event loop empty, preventing termination' });
  setTimeout(() => {}, 5000);
});

process.on('SIGINT', () => {
  recordPhysicalExit('SIGINT', { signal: 'SIGINT', source: 'Keyboard interrupt or terminal Ctrl+C, intercepted' });
});

process.on('SIGTERM', () => {
  recordPhysicalExit('SIGTERM', { signal: 'SIGTERM', source: 'Termination signal from OS or parent process, intercepted' });
});

process.on('SIGHUP', () => {
  recordPhysicalExit('SIGHUP', { signal: 'SIGHUP', source: 'Controlling terminal closed or session hung up' });
});

process.on('SIGBREAK', () => {
  recordPhysicalExit('SIGBREAK', { signal: 'SIGBREAK', source: 'Windows Ctrl+Break event' });
});

process.on('message', (msg) => {
  recordPhysicalExit('IPC_MESSAGE', { message: msg, source: 'Parent process IPC' });
});

// 全局异常防护，阻止主进程异常退出并同步记录到黑匣子与退出日志
process.on('uncaughtException', (err) => {
  console.error('🛡️ [Electron Main] Uncaught Exception Isolated:', err);
  logCrashToFile('ELECTRON_MAIN_UNCAUGHT', err ? err.message : 'Uncaught Exception', err ? err.stack : '');
  recordPhysicalExit('uncaughtException', { message: err?.message, stack: err?.stack });
});
process.on('unhandledRejection', (reason) => {
  console.error('🛡️ [Electron Main] Unhandled Rejection Isolated:', reason);
  logCrashToFile('ELECTRON_MAIN_REJECTION', typeof reason === 'string' ? reason : (reason && reason.message) || 'Unhandled Rejection');
  recordPhysicalExit('unhandledRejection', { reason: typeof reason === 'string' ? reason : reason?.message });
});

let mainWindow = null;
let serverProcess = null;
let tray = null;
let isExplicitQuitting = false;

app.on('before-quit', (e) => {
  recordPhysicalExit('app:before-quit', { defaultPrevented: e ? e.defaultPrevented : false, isExplicitQuitting });
  if (!isExplicitQuitting) {
    // 🛡️ [终极防退出护盾]: 拦截系统会话注销、RDP断开、误触快捷键等非托盘显式退出的所有 quit 信号
    e.preventDefault();
    console.warn('🛡️ [Electron Guard] 拦截到非用户显式退出信号 (before-quit)，系统保持 24/7 量化后台永续运行！如需彻底退出请右键系统托盘选择退出。');
  }
});

app.on('second-instance', () => {
  console.log('🛡️ [Electron Guard] 收到唤醒信号，自动唤醒并置顶现有主看盘窗口');
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.setAlwaysOnTop(true);
    mainWindow.focus();
    setTimeout(() => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setAlwaysOnTop(false);
        }
      } catch (_) {}
    }, 1000);
  } else {
    createWindow();
  }
});

// 🛡️ [系统托盘常驻守护]: 避免关闭窗口导致整个程序/后台交易服务被杀
function createTray() {
  if (tray) return;
  try {
    const iconPath = path.join(__dirname, 'build', 'icon.png');
    let trayIcon;
    if (fs.existsSync(iconPath)) {
      trayIcon = nativeImage.createFromPath(iconPath);
    } else {
      const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAA0SURBVDhPY/wPBAwUACYoTSRgVAcMY8D4f4phfPj//39GRkamgXE3QeXkgoEaGEZ1wDAKAFx0Iq0k3D59AAAAAElFTkSuQmCC';
      trayIcon = nativeImage.createFromBuffer(Buffer.from(base64Png, 'base64'));
    }

    tray = new Tray(trayIcon);
    tray.setToolTip('0211自动找币防爆仓救世之星 (后台交易永续守护中)');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '🟢 显示看盘主控制台',
        click: () => {
          if (!mainWindow || mainWindow.isDestroyed()) {
            createWindow();
          } else {
            mainWindow.show();
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
          }
        }
      },
      { type: 'separator' },
      {
        label: '🛡️ 量化引擎：运行中',
        enabled: false
      },
      { type: 'separator' },
      {
        label: '⛔ 彻底退出程序',
        click: () => {
          isExplicitQuitting = true;
          console.log('⛔ [Tray] 用户显式触发彻底退出程序...');
          // 1. 安全释放防休眠挂起锁
          releasePowerSaveBlocker();
          // 2. 安全终止后台交易服务子进程
          if (serverProcess) {
            try { serverProcess.kill(); } catch (_) {}
          }
          // 3. 销毁主看盘窗口并退出程序
          if (mainWindow && !mainWindow.isDestroyed()) {
            try { mainWindow.destroy(); } catch (_) {}
          }
          app.quit();
        }
      }
    ]);

    tray.setContextMenu(contextMenu);

    // 绑定单击托盘图标切换窗口显示/隐藏 (show / hide)
    tray.on('click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow();
      } else if (mainWindow.isVisible()) {
        mainWindow.hide();
        console.log('🛡️ [Tray Click] 主窗口已切换为隐藏状态 (后台交易持续运行)');
      } else {
        mainWindow.show();
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        console.log('🛡️ [Tray Click] 主窗口已唤醒并前台显示');
      }
    });

    tray.on('double-click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow();
      } else {
        mainWindow.show();
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  } catch (err) {
    console.warn('⚠️ 系统托盘初始化跳过 (无头环境或受限环境):', err);
  }
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1200,
    minHeight: 720,
    title: '0211自动找币防爆仓救世之星 - 桌面客户端',
    backgroundColor: '#020617',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // 允许本地网络访问和交易所跨域请求
      backgroundThrottling: false // 🔒 关键加固：严禁后台/最小化时限频挂起定时器与WebSocket
    }
  });

  // 🛡️ [防闪退/防自动退出守护]: 捕获渲染进程崩溃并平滑原地重启自愈，杜绝主进程与后台交易陪葬
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error(`🛡️ [Electron Guard] 渲染窗口异常终止: reason=${details.reason}, exitCode=${details.exitCode}`);
    logCrashToFile('ELECTRON_RENDERER_GONE', `渲染窗口异常终止: reason=${details.reason}, exitCode=${details.exitCode}`);
    
    if (!isExplicitQuitting) {
      console.log(`🔄 [Electron Guard] 渲染窗口异常终止 (${details.reason})，正在原地恢复/静默拉起...`);
      // 1. 优先尝试直接重载渲染页面，保持窗口句柄不丢失
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.reload();
          return;
        }
      } catch (_) {}

      // 2. 若窗口已不可用，清理旧引用并立即同步创建新看盘窗口，防止无窗口间隙引发进程终止
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.destroy();
        }
      } catch (_) {}
      mainWindow = null;

      // 立即拉起新窗口保障前台，后台交易引擎在此期间完全不中断持续运行
      setImmediate(() => {
        try {
          if (!isExplicitQuitting && (!mainWindow || mainWindow.isDestroyed())) {
            createWindow();
          }
        } catch (e) {
          console.error('❌ 重建看盘主窗口异常:', e);
        }
      });
    }
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.warn('⚠️ [Electron Guard] 渲染窗口瞬时计算负载高 (unresponsive: 并发计算K线/行情中)，保持界面存活...');
    logCrashToFile('ELECTRON_RENDERER_UNRESPONSIVE', '渲染窗口瞬时计算负载高 (unresponsive)');
  });

  mainWindow.webContents.on('responsive', () => {
    console.log('✅ [Electron Guard] 渲染窗口已恢复响应');
  });

  // 🛡️ [防窗口隐形兜底]: 优先等待 ready-to-show，若 1.5 秒内未触发则强制显示窗口
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.log('🛡️ [Electron Guard] 触发防假死显示兜底，确保主窗口处于可见状态');
      mainWindow.show();
      mainWindow.focus();
    }
  }, 1500);

  // 打开外部链接用默认浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // 连接本地服务
  const targetUrl = process.env.ELECTRON_START_URL || 'http://localhost:3000';
  
  // 延迟轮询直到本地服务就绪
  let checkAndLoadTimer = null;
  const checkAndLoad = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      mainWindow.loadURL(targetUrl).catch(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        console.log('等待本地后台服务启动中...');
        if (checkAndLoadTimer) clearTimeout(checkAndLoadTimer);
        checkAndLoadTimer = setTimeout(checkAndLoad, 1000);
      });
    } catch (_) {}
  };

  checkAndLoad();

  // 🛡️ [改造看盘窗口关闭行为]: 改“销毁重建”为“静默隐藏”，避免销毁窗口触发连锁反应，仅在显式退出时放行
  mainWindow.on('close', (e) => {
    if (!isExplicitQuitting) {
      e.preventDefault();
      mainWindow.hide();
      console.log('🛡️ [Electron Guard] 主看盘窗口已静默隐藏至后台/托盘，量化交易与网络心跳持续全速运行');
    }
  });

  mainWindow.on('closed', () => {
    if (checkAndLoadTimer) {
      clearTimeout(checkAndLoadTimer);
      checkAndLoadTimer = null;
    }
    mainWindow = null;
  });
}

// 捕获子进程崩溃
app.on('child-process-gone', (event, details) => {
  console.warn('⚠️ [Electron Guard] 子进程退出:', details);
  logCrashToFile('ELECTRON_CHILD_PROCESS_GONE', `子进程退出: type=${details.type}, reason=${details.reason}, name=${details.name}, exitCode=${details.exitCode}`);
});

// 启动本地后台服务 (server.ts / server.cjs)
let serverStarted = false;
let serverRestartAttempts = 0;
let stableRunTimer = null;

function startBackendServer() {
  if (serverStarted) {
    console.log('ℹ️ [Electron Guard] 后台服务已就绪，跳过重复启动');
    return;
  }

  try {
    const isDev = !app.isPackaged && process.env.NODE_ENV === 'development';
    if (isDev) {
      console.log('开发模式：由 npm run dev 管理后台服务');
      serverStarted = true;
      return;
    }

    const serverScript = path.join(__dirname, 'dist', 'server.cjs');
    console.log(`🚀 [Electron Guard] 启动生产环境后台交易引擎: ${serverScript}`);

    // 🛡️ [零损耗内嵌优先模式]:
    // 在 Electron 主进程中直接 require 运行 server.cjs，同处一个 Node.js 运行时，彻底规避 Windows 子进程被杀、管道断裂或 PATH 问题！
    try {
      require(serverScript);
      serverStarted = true;
      console.log('✅ [Electron Guard] 后台量化服务已成功内嵌至主进程，24小时永续运行');
      return;
    } catch (inProcessErr) {
      console.warn('⚠️ [Electron Guard] 主进程直接加载失败，降级为独立子进程启动:', inProcessErr);
      logCrashToFile('BACKEND_SERVER_INPROCESS_FALLBACK', inProcessErr ? inProcessErr.message : '');
    }

    // 降级：若直接 require 失败，使用 spawn 拉起独立子进程守护 (带 ELECTRON_RUN_AS_NODE 模式放行)
    serverProcess = spawn(process.execPath, [serverScript], {
      cwd: __dirname,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', PORT: '3000' },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    if (serverProcess.stdout) {
      serverProcess.stdout.on('data', (d) => {
        try { process.stdout.write(d); } catch (_) {}
      });
    }

    if (serverProcess.stderr) {
      serverProcess.stderr.on('data', (d) => {
        try { process.stderr.write(d); } catch (_) {}
      });
    }

    serverProcess.on('error', (err) => {
      console.error('后台服务启动异常:', err);
      logCrashToFile('BACKEND_SERVER_SPAWN_ERROR', err ? err.message : 'Spawn Error', err ? err.stack : '');
    });

    if (stableRunTimer) clearTimeout(stableRunTimer);
    stableRunTimer = setTimeout(() => {
      if (serverProcess && !serverProcess.killed) {
        serverRestartAttempts = 0;
      }
    }, 30000);

    serverProcess.on('exit', (code, signal) => {
      console.log(`后台服务进程退出: code=${code}, signal=${signal}`);
      logCrashToFile('BACKEND_SERVER_EXIT', `后台交易服务进程退出: code=${code}, signal=${signal}`);
      recordPhysicalExit('CHILD_SERVER_EXIT', { code, signal });
      if (stableRunTimer) clearTimeout(stableRunTimer);
      if (!isExplicitQuitting) {
        serverRestartAttempts++;
        const retryDelay = Math.min(1000 * Math.pow(1.3, Math.min(serverRestartAttempts, 10)), 15000);
        console.log(`🔄 [守护系统] 正在重新拉起后台服务 (第 ${serverRestartAttempts} 次重试，${Math.round(retryDelay / 1000)}秒后执行)...`);
        setTimeout(startBackendServer, retryDelay);
      }
    });
  } catch (err) {
    console.error('未能自动拉起后台服务:', err);
    logCrashToFile('BACKEND_SERVER_INIT_CRASH', err ? err.message : 'Init Exception', err ? err.stack : '');
    recordPhysicalExit('CHILD_SERVER_INIT_CRASH', { message: err?.message });
    setTimeout(startBackendServer, 3000);
  }
}

app.whenReady().then(() => {
  acquirePowerSaveBlocker();
  startBackendServer();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
    } else {
      mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
});

app.on('window-all-closed', (e) => {
  // 🛡️ [交易永续铁律]: 严禁前台窗口全部关闭时杀死后台服务或退出程序！
  if (e && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }
  console.log(`ℹ️ [Electron Guard] window-all-closed 触发: isExplicitQuitting=${isExplicitQuitting}`);
  recordPhysicalExit('app:window-all-closed', { isExplicitQuitting });
  
  if (isExplicitQuitting) {
    if (serverProcess) {
      try { serverProcess.kill(); } catch (e) {}
    }
    app.quit();
    return;
  }

  // 绝不退出：保持后台交易服务 100% 运行，静默自动重建看盘前台窗口
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.warn('⚠️ [Electron Guard] 前台看盘窗口关闭/销毁，后台量化引擎持续运行中，正在静默重建窗口...');
    setImmediate(() => {
      if (!isExplicitQuitting && (!mainWindow || mainWindow.isDestroyed())) {
        createWindow();
      }
    });
  }
});

app.on('will-quit', (e) => {
  recordPhysicalExit('app:will-quit', { defaultPrevented: e ? e.defaultPrevented : false });
  if (!isExplicitQuitting) {
    e.preventDefault();
  } else {
    releasePowerSaveBlocker();
    if (serverProcess) {
      try { serverProcess.kill(); } catch (e) {}
    }
  }
});

app.on('quit', (event, exitCode) => {
  recordPhysicalExit('app:quit', { exitCode });
});
