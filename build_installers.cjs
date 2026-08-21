const fs = require('fs');
const path = require('path');
const { ZipArchive } = require('archiver');

const rootDir = process.cwd();
const publicDir = path.join(rootDir, 'public');

if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
}

// 1. Build PC Package
async function buildPcPackage() {
    const pcZipPath = path.join(publicDir, '0211自动找币防爆仓救世之星_PC电脑安装版.zip');
    const output = fs.createWriteStream(pcZipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    return new Promise((resolve, reject) => {
        output.on('close', () => {
            console.log(`✅ PC Package created: ${(fs.statSync(pcZipPath).size / 1024 / 1024).toFixed(2)} MB`);
            resolve();
        });
        archive.on('error', (err) => reject(err));
        archive.pipe(output);

        // Windows 一键安装与启动脚本 (小白专用)
        const launcherBat = `@echo off
chcp 65001 >nul
title 0211自动找币防爆仓救世之星 - 电脑端
echo ===================================================
echo   0211自动找币防爆仓救世之星 - 电脑客户端一键启动
echo ===================================================
echo 正在检测运行环境并启动系统...

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [提示] 正在打开系统 Web 极速运行模式...
    start "" "https://ais-dev-7ze4iwunux3foezfcrbwde-17578442727.asia-northeast1.run.app"
    exit /b
)

if not exist node_modules (
    echo 首次启动，正在自动安装必要依赖 (请稍候 1-2 分钟)...
    npm install --production
)

echo 正在启动本地服务...
start "" "http://localhost:3000"
npm run dev
`;

        const desktopShortcutVbs = `' 0211自动找币防爆仓救世之星 - 电脑桌面快捷方式生成脚本
Set WshShell = WScript.CreateObject("WScript.Shell")
strDesktop = WshShell.SpecialFolders("Desktop")
Set oShellLink = WshShell.CreateShortcut(strDesktop & "\\0211自动找币防爆仓救世之星.lnk")
oShellLink.TargetPath = "https://ais-dev-7ze4iwunux3foezfcrbwde-17578442727.asia-northeast1.run.app"
oShellLink.WindowStyle = 1
oShellLink.Description = "0211自动找币防爆仓救世之星 - 电脑桌面独立运行端"
oShellLink.IconLocation = "%SystemRoot%\\System32\\SHELL32.dll, 14"
oShellLink.Save
MsgBox "【0211自动找币防爆仓救世之星】已成功安装到您的电脑桌面！" & vbCrLf & "您现在可以直接在桌面上双击图标打开使用。", 64, "安装成功"
`;

        const readmeTxt = `=====================================================
  0211自动找币防爆仓救世之星 - PC电脑安装版使用说明
=====================================================

【小白极速安装方法 (推荐)】：
1. 双击运行【📌一键生成桌面快捷方式(安装到电脑).vbs】
2. 电脑桌面上会立即出现【0211自动找币防爆仓救世之星】图标！
3. 以后直接在电脑桌面上双击图标即可随时打开交易系统！

【本地源码独立运行方法】：
1. 确保电脑已安装 Node.js (推荐 18 或 20 以上版本)。
2. 双击【⚡双击启动电脑客户端.bat】。
3. 系统将自动启动并在浏览器中打开 http://localhost:3000。
`;

        archive.append(launcherBat, { name: '⚡双击启动电脑客户端.bat' });
        archive.append(desktopShortcutVbs, { name: '📌一键生成桌面快捷方式(安装到电脑).vbs' });
        archive.append(readmeTxt, { name: '📖电脑端新手使用说明.txt' });

        // Add codebase
        archive.glob('**/*', {
            cwd: rootDir,
            ignore: [
                'node_modules/**',
                'dist/**',
                '.git/**',
                '.cache/**',
                'public/0211*',
                'release/**',
                '*.log',
                '.DS_Store'
            ],
            dot: true
        });

        archive.finalize();
    });
}

// 2. Build Mobile Package
async function buildMobilePackage() {
    const mobileZipPath = path.join(publicDir, '0211自动找币防爆仓救世之星_手机APP安装包.zip');
    const output = fs.createWriteStream(mobileZipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    return new Promise((resolve, reject) => {
        output.on('close', () => {
            console.log(`✅ Mobile Package created: ${(fs.statSync(mobileZipPath).size / 1024 / 1024).toFixed(2)} MB`);
            resolve();
        });
        archive.on('error', (err) => reject(err));
        archive.pipe(output);

        const installHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>0211自动找币防爆仓救世之星 - 手机端一键安装</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0b0f19; color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; text-align: center; }
        .card { background: #1e293b; border: 1px solid #3b82f6; border-radius: 16px; padding: 24px; max-width: 400px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
        .icon { font-size: 48px; margin-bottom: 12px; }
        h1 { font-size: 20px; font-weight: bold; margin-bottom: 8px; color: #60a5fa; }
        p { font-size: 13px; color: #94a3b8; line-height: 1.5; margin-bottom: 20px; }
        .btn { display: block; width: 100%; padding: 14px; background: linear-gradient(135deg, #10b981, #059669); color: #fff; font-size: 15px; font-weight: bold; text-decoration: none; border-radius: 10px; margin-bottom: 12px; box-shadow: 0 4px 12px rgba(16,185,129,0.3); }
        .steps { text-align: left; background: #0f172a; padding: 12px; border-radius: 8px; font-size: 12px; color: #cbd5e1; line-height: 1.6; border: 1px solid #334155; }
        .steps b { color: #fbbf24; }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">📱</div>
        <h1>0211自动找币防爆仓救世之星</h1>
        <p>手机端免下载APP商店极速安装版 (PWA原生级独立应用)</p>
        
        <a href="https://ais-dev-7ze4iwunux3foezfcrbwde-17578442727.asia-northeast1.run.app" class="btn">🚀 立即打开并安装到手机桌面</a>

        <div class="steps">
            <b>📲 手机安装到桌面步骤 (超简单)：</b><br>
            • <b>苹果 iPhone / iPad：</b> 点击上方按钮打开网页 ➔ 点击浏览器底部【分享图标 (带向上箭头的方框)】 ➔ 往下拉点击【添加到主屏幕】即可！<br><br>
            • <b>安卓 Android (华为/小米/三星等)：</b> 点击上方按钮打开 ➔ 点击浏览器右上角【三点菜单】 ➔ 点击【添加到主屏幕】或【安装应用】即可！
        </div>
    </div>
</body>
</html>`;

        const mobileReadme = `=====================================================
  0211自动找币防爆仓救世之星 - 手机端一键安装指南
=====================================================

【小白极速安装到手机主屏幕 (无需越狱/无需Root)】：

一、苹果手机 (iPhone / iPad) 安装方法：
1. 用 Safari 浏览器打开系统网址：
   https://ais-dev-7ze4iwunux3foezfcrbwde-17578442727.asia-northeast1.run.app
2. 点击 Safari 底部中间的【分享按钮】（一个方框带向上的箭头 📤）。
3. 在弹出的菜单中往下滑动，找到并点击【添加到主屏幕】。
4. 点击右上角的【添加】。
5. 您的手机桌面上就会出现独立的【救世之星】App 图标，点击即可像原生 App 一样全屏无阻碍运行！

二、安卓手机 (华为、小米、OPPO、vivo、三星等) 安装方法：
1. 用手机自带浏览器或 Chrome 打开系统网址：
   https://ais-dev-7ze4iwunux3foezfcrbwde-17578442727.asia-northeast1.run.app
2. 点击浏览器右上角的【三个点】菜单。
3. 选择【添加到主屏幕】或【安装应用】。
4. 手机桌面上即刻生成 App 图标，支持锁屏常亮与后台行情播报！
`;

        archive.append(installHtml, { name: '📱手机一键安装入口.html' });
        archive.append(mobileReadme, { name: '📖手机端新手安装说明.txt' });

        archive.finalize();
    });
}

async function main() {
    try {
        await buildPcPackage();
        await buildMobilePackage();
        console.log("🎉 All installer packages generated successfully in /public !");
    } catch (err) {
        console.error("❌ Error generating installer packages:", err);
        process.exit(1);
    }
}

main();
