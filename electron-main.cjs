// 🛡️ [绝对顶部：锁定生产环境与服务端口，杜绝依赖未打包构建工具]
process.env.NODE_ENV = 'production';
process.env.PORT = '3000';

const { app, BrowserWindow, shell, powerSaveBlocker, Tray, Menu, nativeImage, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

// 🛡️ [安全硬件加速与纯净渲染配置]
// 彻底禁用 GPU 硬件加速与 GPU 合成，规避 Windows 锁屏/夜间息屏导致显卡驱动重置引起的闪退 (-1073741819)
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-gpu-rasterization');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,IntensiveWakeUpThrottling,HighEfficiencyModeAvailable,AudioServiceOutOfProcess');

// 🛡️ [Node.js 永续生命线 Keep-Alive]: 维持主进程事件循环永不排空
const _daemonKeepAliveTimer = setInterval(() => {
  // 保持主进程事件循环持续活跃
}, 15000);

/**
 * 🛡️ [无阻塞原子写 JSON 算法]
 * 写入 .tmp -> fsyncSync 刷盘 -> renameSync 替换，带坏文件回滚
 */
function atomicWriteJsonSync(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).substring(2, 7)}.tmp`;
    const fd = fs.openSync(tmpPath, 'w');
    fs.writeFileSync(fd, JSON.stringify(data, null, 2), 'utf-8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    console.error(`❌ Atomic write error for ${filePath}:`, e);
  }
}

// 🛡️ [持久化崩溃黑匣子写入工具]：使用原子写入落盘到工作目录与 userData 目录
function logCrashToFile(moduleName, message, stack, traceId) {
  try {
    const timestamp = Date.now();
    const timeStr = new Date(timestamp).toLocaleString();
    const tid = traceId || `tr_main_${timestamp.toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const entry = {
      id: 'electron_' + timestamp.toString(36) + '_' + Math.random().toString(36).substring(2, 6),
      traceId: tid,
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
        atomicWriteJsonSync(targetPath, reports);
      } catch (_) {}
    }

    // 追加写入纯文本日志
    const txtLog = `[${timeStr}] [TraceID:${tid}] [${moduleName}] ${message}\n${stack ? stack + '\n' : ''}`;
    try {
      fs.appendFileSync(path.join(process.cwd(), 'electron_crash.log'), txtLog, 'utf-8');
    } catch (_) {}
  } catch (_) {}
}

// 🛡️ [物理级进程退出日志 (Exit Logger)]
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

// 🛡️ [操作系统物理防挂起休眠锁]
let powerBlockerId = null;

function acquirePowerSaveBlocker() {
  try {
    if (powerBlockerId === null || !powerSaveBlocker.isStarted(powerBlockerId)) {
      powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
      console.log(`🛡️ [PowerGuard] 已成功启用操作系统物理防挂起休眠锁 (powerBlockerId: ${powerBlockerId})`);
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

// 🛡️ [Windows 系统级防休眠]
if (process.platform === 'win32') {
  try {
    const { exec } = require('child_process');
    exec('powercfg /change standby-timeout-ac 0', () => {});
    exec('powercfg /change hibernate-timeout-ac 0', () => {});
  } catch (_) {}
}

// 🛡️ [Windows 自启动恢复]
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

// 通知后台守护引擎强制重置底层僵尸 WebSocket
function notifyBackendPowerResume() {
  try {
    const req = http.request('http://127.0.0.1:8089/api/reconnect-ws', { method: 'GET', timeout: 3000 }, () => {});
    req.on('error', () => {});
    req.end();
  } catch (_) {}
}

// 🛡️ [Windows 会话与电源事件完整免疫守护 & 休眠恢复 Socket 重置]
if (powerMonitor) {
  powerMonitor.on('suspend', () => {
    console.log('🛡️ [PowerMonitor] 系统挂起事件，保持后台交易引擎运行');
    recordPhysicalExit('powerMonitor:suspend', {});
  });
  powerMonitor.on('resume', () => {
    console.log('🛡️ [PowerMonitor] 系统恢复，强制清理僵尸 Socket 并刷盘重连');
    recordPhysicalExit('powerMonitor:resume', {});
    notifyBackendPowerResume();
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

// 拦截 Windows 会话注销/关闭信号
app.on('session-end', (e) => {
  console.warn('🛡️ [Electron Guard] 收到 Windows session-end 会话信号，拦截退出保护交易');
  if (e && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }
  recordPhysicalExit('app:session-end', {});
});

// 捕获 GPU 进程崩溃并优雅恢复
app.on('gpu-process-gone', (event, details) => {
  console.warn('⚠️ [Electron Guard] GPU 渲染引擎瞬时异常或驱动重置:', details);
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

// 🛡️ [uncaughtException 紧急安全通道及看门狗自愈重启]
process.on('uncaughtException', (err) => {
  const traceId = `tr_uncaught_${Date.now().toString(36)}`;
  console.error(`🚨 [Electron Main] Fatal Uncaught Exception (${traceId}):`, err);
  logCrashToFile('ELECTRON_MAIN_UNCAUGHT', err ? err.message : 'Uncaught Exception', err ? err.stack : '', traceId);
  recordPhysicalExit('uncaughtException', { traceId, message: err?.message, stack: err?.stack });

  // 紧急安全通道：释放防休眠锁，平滑自愈重启
  try {
    releasePowerSaveBlocker();
    app.relaunch({ args: process.argv.slice(1).concat(['--relaunched']) });
    app.exit(0);
  } catch (_) {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason) => {
  const traceId = `tr_rejection_${Date.now().toString(36)}`;
  console.error(`⚠️ [Electron Main] Unhandled Rejection (${traceId}):`, reason);
  logCrashToFile('ELECTRON_MAIN_REJECTION', typeof reason === 'string' ? reason : (reason && reason.message) || 'Unhandled Rejection', '', traceId);
  recordPhysicalExit('unhandledRejection', { traceId, reason: typeof reason === 'string' ? reason : reason?.message });
});

let mainWindow = null;
let serverProcess = null;
let tray = null;
let isExplicitQuitting = false;

app.on('before-quit', (e) => {
  recordPhysicalExit('app:before-quit', { defaultPrevented: e ? e.defaultPrevented : false, isExplicitQuitting });
  if (!isExplicitQuitting) {
    e.preventDefault();
    console.warn('🛡️ [Electron Guard] 拦截到非用户显式退出信号 (before-quit)，系统保持 24/7 量化后台永续运行！');
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
          releasePowerSaveBlocker();
          if (serverProcess) {
            try { serverProcess.kill(); } catch (_) {}
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            try { mainWindow.destroy(); } catch (_) {}
          }
          app.quit();
        }
      }
    ]);

    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow();
      } else if (mainWindow.isVisible()) {
        mainWindow.hide();
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
      webSecurity: false,
      backgroundThrottling: false
    }
  });

  // 🛡️ [全链路 Electron 渲染崩溃钩子 (区分 OOM, crashed, killed)]
  let rendererCrashTimes = [];
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    const traceId = `tr_render_${Date.now().toString(36)}`;
    const reasonCat = details.reason === 'oom' ? 'OOM内存溢出' : details.reason === 'crashed' ? '显卡/内核崩溃' : details.reason === 'killed' ? '系统强杀' : details.reason;
    console.error(`🛡️ [Electron Guard] 渲染进程异常终止 (${reasonCat}): reason=${details.reason}, exitCode=${details.exitCode}`);
    logCrashToFile('ELECTRON_RENDERER_GONE', `渲染进程异常 (${reasonCat}): reason=${details.reason}, exitCode=${details.exitCode}`, '', traceId);
    
    if (!isExplicitQuitting) {
      const now = Date.now();
      rendererCrashTimes.push(now);
      rendererCrashTimes = rendererCrashTimes.filter(t => now - t < 60000);

      // 看门狗阈值：1 分钟 3 次崩溃触发 app.relaunch() 自愈重启
      if (rendererCrashTimes.length >= 3) {
        console.warn('🚨 [Watchdog Guard] 检测到渲染窗口高频崩溃，触发 app.relaunch() 全局重新拉起！');
        logCrashToFile('WATCHDOG_RELAUNCH_TRIGGERED', '渲染窗口高频崩溃，触发 app.relaunch() 自愈重启', '', traceId);
        try {
          app.relaunch({ args: process.argv.slice(1).concat(['--relaunched']) });
          app.exit(0);
          return;
        } catch (err) {
          console.error('❌ app.relaunch 异常:', err);
        }
      }

      console.log(`🔄 [Electron Guard] 正在尝试原地 reload 恢复渲染窗口...`);
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.reload();
          return;
        }
      } catch (_) {}

      try {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
      } catch (_) {}
      mainWindow = null;

      setImmediate(() => {
        try {
          if (!isExplicitQuitting && (!mainWindow || mainWindow.isDestroyed())) createWindow();
        } catch (e) {
          console.error('❌ 重建看盘主窗口异常:', e);
        }
      });
    }
  });

  // 🛡️ [webContents 无响应与插件崩溃钩子]
  mainWindow.webContents.on('unresponsive', () => {
    const traceId = `tr_unresponsive_${Date.now().toString(36)}`;
    console.warn('⚠️ [Electron Guard] 渲染窗口无响应挂起 (unresponsive)，系统维持运行...');
    logCrashToFile('ELECTRON_RENDERER_UNRESPONSIVE', '渲染窗口无响应挂起 (unresponsive)', '', traceId);
  });

  mainWindow.webContents.on('plugin-crashed', (event, name, version) => {
    const traceId = `tr_plugin_${Date.now().toString(36)}`;
    console.warn(`⚠️ [Electron Guard] 插件崩溃: ${name} (${version})`);
    logCrashToFile('ELECTRON_PLUGIN_CRASHED', `插件崩溃: ${name} v${version}`, '', traceId);
  });

  mainWindow.webContents.on('responsive', () => {
    console.log('✅ [Electron Guard] 渲染窗口恢复响应');
  });

  // 防假死显示兜底
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }, 1500);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  const targetUrl = process.env.ELECTRON_START_URL || 'http://localhost:3000';
  let checkAndLoadTimer = null;
  const checkAndLoad = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      mainWindow.loadURL(targetUrl).catch(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (checkAndLoadTimer) clearTimeout(checkAndLoadTimer);
        checkAndLoadTimer = setTimeout(checkAndLoad, 1000);
      });
    } catch (_) {}
  };

  checkAndLoad();

  mainWindow.on('close', (e) => {
    if (!isExplicitQuitting) {
      e.preventDefault();
      mainWindow.hide();
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

// 🛡️ [捕获子进程/GPU 异常并记录物理退出码]
app.on('child-process-gone', (event, details) => {
  const traceId = `tr_child_${Date.now().toString(36)}`;
  console.warn('⚠️ [Electron Guard] 子进程或 GPU 引擎终止:', details);
  logCrashToFile('ELECTRON_CHILD_PROCESS_GONE', `子进程/GPU退出: type=${details.type}, reason=${details.reason}, name=${details.name}, exitCode=${details.exitCode}`, '', traceId);
  if (details.type === 'GPU' || details.reason === 'crashed') {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
    } catch (_) {}
  }
});

// 启动本地后台服务 (server.ts / server.cjs)
let serverStarted = false;
let serverRestartAttempts = 0;
let stableRunTimer = null;

function startBackendServer() {
  if (serverStarted) return;

  try {
    const isDev = !app.isPackaged && process.env.NODE_ENV === 'development';
    if (isDev) {
      serverStarted = true;
      return;
    }

    const serverScript = path.join(__dirname, 'dist', 'server.cjs');
    try {
      require(serverScript);
      serverStarted = true;
      console.log('✅ [Electron Guard] 后台量化服务已成功内嵌至主进程');
      return;
    } catch (inProcessErr) {
      logCrashToFile('BACKEND_SERVER_INPROCESS_FALLBACK', inProcessErr ? inProcessErr.message : '');
    }

    serverProcess = spawn(process.execPath, [serverScript], {
      cwd: __dirname,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', PORT: '3000' },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    if (serverProcess.stdout) {
      serverProcess.stdout.on('data', (d) => { try { process.stdout.write(d); } catch (_) {} });
    }
    if (serverProcess.stderr) {
      serverProcess.stderr.on('data', (d) => { try { process.stderr.write(d); } catch (_) {} });
    }

    serverProcess.on('error', (err) => {
      logCrashToFile('BACKEND_SERVER_SPAWN_ERROR', err ? err.message : 'Spawn Error', err ? err.stack : '');
    });

    if (stableRunTimer) clearTimeout(stableRunTimer);
    stableRunTimer = setTimeout(() => {
      if (serverProcess && !serverProcess.killed) serverRestartAttempts = 0;
    }, 30000);

    serverProcess.on('exit', (code, signal) => {
      logCrashToFile('BACKEND_SERVER_EXIT', `后台交易服务进程退出: code=${code}, signal=${signal}`);
      recordPhysicalExit('CHILD_SERVER_EXIT', { code, signal });
      if (stableRunTimer) clearTimeout(stableRunTimer);
      if (!isExplicitQuitting) {
        serverRestartAttempts++;
        const retryDelay = Math.min(1000 * Math.pow(1.3, Math.min(serverRestartAttempts, 10)), 15000);
        setTimeout(startBackendServer, retryDelay);
      }
    });
  } catch (err) {
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
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
  recordPhysicalExit('app:window-all-closed', { isExplicitQuitting });
  
  if (isExplicitQuitting) {
    if (serverProcess) { try { serverProcess.kill(); } catch (e) {} }
    app.quit();
    return;
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    setImmediate(() => {
      if (!isExplicitQuitting && (!mainWindow || mainWindow.isDestroyed())) createWindow();
    });
  }
});

app.on('will-quit', (e) => {
  recordPhysicalExit('app:will-quit', { defaultPrevented: e ? e.defaultPrevented : false });
  if (!isExplicitQuitting) {
    e.preventDefault();
  } else {
    releasePowerSaveBlocker();
    if (serverProcess) { try { serverProcess.kill(); } catch (e) {} }
  }
});

app.on('quit', (event, exitCode) => {
  recordPhysicalExit('app:quit', { exitCode });
});
