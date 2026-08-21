# 0211自动找币防爆仓救世之星 - 本地电脑桌面客户端打包指南

本文档指导您如何将本项目在本地电脑（Windows / Mac / Linux）上一键打包为独立安装程序（如 `.exe` 或 `.dmg`）。

---

## 准备工作

1. **安装 Node.js**
   - 前往 [Node.js 官方网站 (nodejs.org)](https://nodejs.org) 下载并安装 **LTS 版本**（推荐 Node.js 18.x 或 20.x）。
   - 安装完成后，在电脑的终端（Windows 的 CMD / PowerShell，或 Mac 的 Terminal）输入 `node -v` 和 `npm -v` 验证安装成功。

2. **解压源码**
   - 将下载得到的 `CryptoScanner_FullSource.zip` 解压到您电脑的任意工作目录（例如 `D:\CryptoTradingApp`）。

---

## 方式一：直接在本地启动运行（免打包）

1. 在解压后的文件夹内打开终端；
2. 安装项目依赖：
   ```bash
   npm install
   ```
3. 启动本地服务：
   ```bash
   npm run dev
   ```
4. 在电脑浏览器中打开：`http://localhost:3000` 即可完全脱机使用！

---

## 方式二：打包为独立桌面应用程序（.exe / .dmg）

### 第一步：安装打包工具
在解压后的项目根目录下打开终端，运行：
```bash
npm install -D electron electron-builder concurrently wait-on
```

### 第二步：一键打包

- **Windows 电脑打包（生成 .exe）**：
  ```bash
  npm run dist:win
  ```
  打包完成后，在根目录的 `release/` 文件夹下即可找到：
  - `0211自动找币防爆仓救世之星 Setup.exe`（标准安装包）
  - `0211自动找币防爆仓救世之星.exe`（绿色便携免安装版，双击直接运行）

- **Mac 电脑打包（生成 .dmg）**：
  ```bash
  npm run dist:mac
  ```
  打包完成后，在 `release/` 文件夹下即可找到 `.dmg` 安装镜像。

---

## 常见问题与提示

1. **API 密钥与安全性**：
   - 桌面客户端直接与币安交易所服务器建立本地 WebSocket 与 HTTPS 连接，不受浏览器沙箱与第三方网络中转限制，延迟更低、连接更稳。
   - 所有配置与 API 密钥都保存在您本地电脑的加密存储区中。

2. **网络环境**：
   - 请确保运行本程序的电脑能够正常访问币安 API 节点（`fapi.binance.com` / `fstream.binance.com`）。
