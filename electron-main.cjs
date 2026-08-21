const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let serverProcess;

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
      webSecurity: false // 允许本地网络访问和交易所跨域请求
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
  });
}

// 启动本地后台服务 (server.ts / server.cjs)
function startBackendServer() {
  try {
    const isDev = !app.isPackaged;
    if (isDev) {
      console.log('开发模式：由 npm run dev 管理后台服务');
      return;
    }

    const serverScript = path.join(__dirname, 'dist', 'server.cjs');
    serverProcess = spawn(process.execPath, [serverScript], {
      env: { ...process.env, NODE_ENV: 'production', PORT: '3000' },
      stdio: 'inherit'
    });

    serverProcess.on('error', (err) => {
      console.error('后台服务启动异常:', err);
    });
  } catch (err) {
    console.error('未能自动拉起后台服务:', err);
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
  if (serverProcess) {
    try { serverProcess.kill(); } catch (e) {}
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (serverProcess) {
    try { serverProcess.kill(); } catch (e) {}
  }
});
