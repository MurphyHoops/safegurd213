const { app, BrowserWindow, shell, powerSaveBlocker, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// 🛡️ [绝对顶部：彻底禁用 GPU 硬件加速 & 4GB V8 HEAP & 24小时后台非节流指令集]
// 必须在任何窗口、单实例或图形上下文初始化前第一时间执行，彻底切断 Chromium 与 Direct3D 显卡驱动的底层绑定
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-gpu-rasterization');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,IntensiveWakeUpThrottling,HighEfficiencyModeAvailable,AudioServiceOutOfProcess');

// 🛡️ [单实例互斥锁]: 防止重复双击打开多个进程导致端口 3000 冲突崩溃
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('⚠️ [Electron Guard] 检测到已有实例正在运行，自动退出重复进程并聚焦主实例');
  app.quit();
  process.exit(0);
}

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

    const targetPaths = [
      path.join(process.cwd(), 'crash_reports.json'),
      path.join(app.getPath('userData'), 'crash_reports.json')
    ];

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

// 🛡️ [双重阻止电脑休眠/断电挂起]: 24小时量化机器人交易核心，禁止系统待机/挂起/锁屏节能导致程序终止
try {
  powerSaveBlocker.start('prevent-app-suspension');
  powerSaveBlocker.start('prevent-display-sleep');
  console.log('🛡️ [Electron Guard] 已成功启用 prevent-app-suspension 与 prevent-display-sleep 双重防系统休眠挂起保护');
} catch (e) {
  console.warn('⚠️ powerSaveBlocker 启动失败:', e);
}


// 捕获 GPU 进程崩溃并优雅恢复，防止显卡重置引发程序自退
app.on('gpu-process-gone', (event, details) => {
  console.warn('⚠️ [Electron Guard] GPU 渲染引擎瞬时异常或驱动重置 (自动平滑隔离，保障交易运行):', details);
  logCrashToFile('ELECTRON_GPU_GONE', `GPU驱动重置或进程异常: reason=${details.reason}, exitCode=${details.exitCode}`);
});

// 全局异常防护，阻止主进程异常退出并同步记录到黑匣子
process.on('uncaughtException', (err) => {
  console.error('🛡️ [Electron Main] Uncaught Exception Isolated:', err);
  logCrashToFile('ELECTRON_MAIN_UNCAUGHT', err ? err.message : 'Uncaught Exception', err ? err.stack : '');
});
process.on('unhandledRejection', (reason) => {
  console.error('🛡️ [Electron Main] Unhandled Rejection Isolated:', reason);
  logCrashToFile('ELECTRON_MAIN_REJECTION', typeof reason === 'string' ? reason : (reason && reason.message) || 'Unhandled Rejection');
});

let mainWindow = null;
let serverProcess = null;
let tray = null;
let isExplicitQuitting = false;
let isRecreatingWindow = false; // 🔒 关键生命周期守卫：防止销毁死窗口瞬间触发 window-all-closed 导致连环自杀退出

app.on('before-quit', () => {
  isExplicitQuitting = true;
});

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
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
        label: '🟢 显示看盘主界面',
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
      {
        label: '🔄 强制重建看盘窗口',
        click: () => {
          console.log('🔄 [系统托盘] 正在强制重建看盘界面窗口...');
          try {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.destroy();
            }
          } catch (_) {}
          mainWindow = null;
          createWindow();
        }
      },
      { type: 'separator' },
      {
        label: '🛡️ 后台量化交易服务: 持续运行中',
        enabled: false
      },
      { type: 'separator' },
      {
        label: '⛔ 彻底退出程序 (终止量化交易)',
        click: () => {
          isExplicitQuitting = true;
          if (serverProcess) {
            try { serverProcess.kill(); } catch (_) {}
          }
          app.quit();
        }
      }
    ]);

    tray.setContextMenu(contextMenu);
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

  // 🛡️ [防闪退/防自动退出守护]: 捕获渲染进程崩溃并彻底重建，杜绝死掉 reload 僵死
  let unresponsiveWatchdogTimer = null;

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error(`🛡️ [Electron Guard] 渲染窗口异常终止: reason=${details.reason}, exitCode=${details.exitCode}`);
    logCrashToFile('ELECTRON_RENDERER_GONE', `渲染窗口异常终止: reason=${details.reason}, exitCode=${details.exitCode}`);
    
    if (unresponsiveWatchdogTimer) {
      clearTimeout(unresponsiveWatchdogTimer);
      unresponsiveWatchdogTimer = null;
    }

    // 🔒 铁律：当 Chromium 渲染进程崩溃时，旧窗口对象已被标记为 Dead，调用 reload() 极易黑屏卡死！
    // 必须彻底 destroy 销毁死句柄，再创建全新的 BrowserWindow！
    // 🛡️ [防自杀锁]: 只要不是用户显式点击退出程序，不管任何 reason，立刻锁定 isRecreatingWindow = true，杜绝 window-all-closed 杀进程
    if (!isExplicitQuitting) {
      if (isRecreatingWindow) return;
      isRecreatingWindow = true;
      console.log('🔄 [Electron Guard] 收到 render-process-gone，正在安全销毁僵死窗口并触发免疫重建...');
      
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.destroy();
        }
      } catch (_) {}
      mainWindow = null;

      setTimeout(() => {
        try {
          console.log('🔄 [Electron Guard] 正在重建全新 BrowserWindow 看盘主窗口...');
          createWindow();
        } catch (e) {
          console.error('❌ 重建看盘主窗口异常:', e);
        } finally {
          isRecreatingWindow = false;
        }
      }, 500);
    }
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.warn('⚠️ [Electron Guard] 渲染窗口瞬时计算负载高 (unresponsive: 正在并发处理K线/指标/行情)，保持界面驻留，等待引擎自然恢复...');
    logCrashToFile('ELECTRON_RENDERER_UNRESPONSIVE', '渲染窗口瞬时计算负载高 (unresponsive)');
    
    // 🔒 铁律：严禁在 unresponsive 状态下强杀/destroy窗口！
    // 密集计算或GC只是单线程微任务暂时排队，强杀会导致用户前台窗口瞬间消失/闪退！
    if (!unresponsiveWatchdogTimer) {
      unresponsiveWatchdogTimer = setTimeout(() => {
        console.warn('⚠️ [Electron Guard] 渲染窗口密集计算已持续 60 秒，仍保持窗口存活以保障交易稳定...');
        unresponsiveWatchdogTimer = null;
      }, 60000);
    }
  });

  mainWindow.webContents.on('responsive', () => {
    console.log('✅ [Electron Guard] 渲染窗口已恢复响应');
    if (unresponsiveWatchdogTimer) {
      clearTimeout(unresponsiveWatchdogTimer);
      unresponsiveWatchdogTimer = null;
    }
  });

  // 🛡️ [防窗口隐形兜底]: 优先等待 ready-to-show，若 1.5 秒内未触发则强制显示窗口，防止前台界面隐身
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
  const checkAndLoad = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.loadURL(targetUrl).catch(() => {
      console.log('等待本地后台服务启动中...');
      setTimeout(checkAndLoad, 1000);
    });
  };

  checkAndLoad();

  // 🛡️ [防误关与后台永续执行]: 拦截窗口关闭，隐藏到托盘，后台量化交易 100% 持续运行
  mainWindow.on('close', (e) => {
    if (!isExplicitQuitting) {
      e.preventDefault();
      mainWindow.hide();
      console.log('🛡️ [Electron Guard] 窗口已收起至系统后台/托盘，后台量化交易服务与持仓监控持续不间断运行');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 捕获子进程崩溃
app.on('child-process-gone', (event, details) => {
  console.warn('⚠️ [Electron Guard] 子进程退出:', details);
  logCrashToFile('ELECTRON_CHILD_PROCESS_GONE', `子进程退出: type=${details.type}, reason=${details.reason}, name=${details.name}, exitCode=${details.exitCode}`);
});

// 启动本地后台服务 (server.ts / server.cjs)
let serverRestartAttempts = 0;
let stableRunTimer = null;

function startBackendServer() {
  try {
    const isDev = !app.isPackaged;
    if (isDev) {
      console.log('开发模式：由 npm run dev 管理后台服务');
      return;
    }

    const serverScript = path.join(__dirname, 'dist', 'server.cjs');
    // 🛡️ [EPIPE 防御]: 使用 pipe 取代 inherit，彻底根绝 Windows GUI 进程无控制台时 stdout 报错 EPIPE 导致闪退
    serverProcess = spawn(process.execPath, ['--max-old-space-size=4096', serverScript], {
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

    // 🛡️ [自愈重置计数器]: 只要服务稳定运行 30 秒，自动清零重启计数，确保几小时/几天内的偶发中断无限自愈
    if (stableRunTimer) clearTimeout(stableRunTimer);
    stableRunTimer = setTimeout(() => {
      if (serverProcess && !serverProcess.killed) {
        serverRestartAttempts = 0;
      }
    }, 30000);

    serverProcess.on('exit', (code, signal) => {
      console.log(`后台服务进程退出: code=${code}, signal=${signal}`);
      logCrashToFile('BACKEND_SERVER_EXIT', `后台交易服务进程退出: code=${code}, signal=${signal}`);
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
    setTimeout(startBackendServer, 3000);
  }
}

app.whenReady().then(() => {
  startBackendServer();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
    } else {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  // 🛡️ [交易永续铁律]: 即使前台所有窗口因任何原因关闭或崩溃，绝对不能杀死后台服务，绝对不能退出程序！
  console.log(`ℹ️ [Electron Guard] window-all-closed 触发: isExplicitQuitting=${isExplicitQuitting}, isRecreating=${isRecreatingWindow}`);
  if (isExplicitQuitting) {
    if (serverProcess) {
      try { serverProcess.kill(); } catch (e) {}
    }
    app.quit();
    return;
  }

  // 🛡️ [防连锁自杀双重闭环]: 若窗口全关且非主动退出、非重建中，立刻自动拉起新窗口，杜绝进程变孤儿
  if (!isRecreatingWindow && (!mainWindow || mainWindow.isDestroyed())) {
    console.warn('⚠️ [Electron Guard] 检测到前台窗口已被销毁且未处于重建态，立即自动拉起全新看盘窗口...');
    createWindow();
  }
});

app.on('will-quit', () => {
  if (serverProcess) {
    try { serverProcess.kill(); } catch (e) {}
  }
});
