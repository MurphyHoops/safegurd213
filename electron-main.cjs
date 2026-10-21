const { app, BrowserWindow, shell, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

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

// 🛡️ [4GB V8 HEAP & 24小时后台非节流指令集]:
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
app.commandLine.appendSwitch('disable-http-cache');
// 禁用后台定时器降频（杜绝最小化或无人操作几小时后定时器/心跳被 Windows 冻结）
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// 全局异常防护，阻止主进程异常退出并同步记录到黑匣子
process.on('uncaughtException', (err) => {
  console.error('🛡️ [Electron Main] Uncaught Exception Isolated:', err);
  logCrashToFile('ELECTRON_MAIN_UNCAUGHT', err ? err.message : 'Uncaught Exception', err ? err.stack : '');
});
process.on('unhandledRejection', (reason) => {
  console.error('🛡️ [Electron Main] Unhandled Rejection Isolated:', reason);
  logCrashToFile('ELECTRON_MAIN_REJECTION', typeof reason === 'string' ? reason : (reason && reason.message) || 'Unhandled Rejection');
});

let mainWindow;
let serverProcess;

let isExplicitQuitting = false;
app.on('before-quit', () => {
  isExplicitQuitting = true;
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function createWindow() {
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

  // 🛡️ [防闪退/防自动退出守护]: 捕获渲染进程崩溃并自动恢复，消除 108 分钟人工干预空白期
  let unresponsiveWatchdogTimer = null;

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error(`🛡️ [Electron Guard] 渲染窗口异常终止: reason=${details.reason}, exitCode=${details.exitCode}`);
    logCrashToFile('ELECTRON_RENDERER_GONE', `渲染窗口异常终止: reason=${details.reason}, exitCode=${details.exitCode}`);
    
    if (unresponsiveWatchdogTimer) {
      clearTimeout(unresponsiveWatchdogTimer);
      unresponsiveWatchdogTimer = null;
    }

    if (!isExplicitQuitting && details.reason !== 'clean-exit') {
      console.log('🔄 正在安全拉起并静默恢复渲染窗口，1秒内自动重新恢复看盘界面，杜绝脱机空白期...');
      setTimeout(() => {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.reload();
            return;
          }
        } catch (_) {}
        createWindow();
      }, 1000);
    }
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.warn('⚠️ [Electron Guard] 渲染窗口瞬时负载过高 (unresponsive)，系统防爆看门狗启动 (5秒恢复超时)...');
    logCrashToFile('ELECTRON_RENDERER_UNRESPONSIVE', '渲染窗口瞬时无响应 (unresponsive)');
    
    if (!unresponsiveWatchdogTimer) {
      unresponsiveWatchdogTimer = setTimeout(() => {
        if (!isExplicitQuitting && mainWindow && !mainWindow.isDestroyed()) {
          console.warn('🚨 [Electron Guard] 渲染窗口持续 5 秒无响应，强制静默 reload 恢复...');
          try {
            mainWindow.reload();
          } catch (_) {}
        }
        unresponsiveWatchdogTimer = null;
      }, 5000);
    }
  });

  mainWindow.webContents.on('responsive', () => {
    console.log('✅ [Electron Guard] 渲染窗口已恢复响应');
    if (unresponsiveWatchdogTimer) {
      clearTimeout(unresponsiveWatchdogTimer);
      unresponsiveWatchdogTimer = null;
    }
  });

  // 窗口准备好后再显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

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
    mainWindow.loadURL(targetUrl).catch(() => {
      console.log('等待本地后台服务启动中...');
      setTimeout(checkAndLoad, 1000);
    });
  };

  checkAndLoad();

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (!isExplicitQuitting) {
      console.log('🛡️ [防退出守护] 检测到窗口关闭，如果属于非主动退出，将在 1 秒后自动重建...');
      setTimeout(() => {
        if (!isExplicitQuitting && (!mainWindow || mainWindow.isDestroyed())) {
          createWindow();
        }
      }, 1000);
    }
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (isExplicitQuitting) {
    if (serverProcess) {
      try { serverProcess.kill(); } catch (e) {}
    }
    if (process.platform !== 'darwin') {
      app.quit();
    }
  } else {
    // 🛡️ [防崩溃意外退出守护]: 如果是崩溃导致的窗口全部消失，自动重建主窗口，严禁直接退出进程
    console.log('🛡️ [防退出守护] 检测到窗口异常关闭，正在原地重建主窗口...');
    setTimeout(() => {
      if (!isExplicitQuitting && (!mainWindow || mainWindow.isDestroyed())) {
        createWindow();
      }
    }, 1000);
  }
});

app.on('will-quit', () => {
  if (serverProcess) {
    try { serverProcess.kill(); } catch (e) {}
  }
});
