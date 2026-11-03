#!/bin/bash

# 🛡️ macOS Dynamic Launchd Service Management Script (包含 load 与 unload 指令)

PLIST_NAME="com.trading.daemon.plist"
TARGET_PLIST="$HOME/Library/LaunchAgents/$PLIST_NAME"

if [ ! -d "node_modules" ]; then
    echo "❌ 错误: 未检测到 node_modules 目录！"
    echo "💡 请先在当前项目根目录下运行 'npm install' 安装必要的依赖项后再启动守护进程。"
    exit 1
fi

NODE_BIN=$(which node 2>/dev/null)
if [ -z "$NODE_BIN" ]; then
    NODE_BIN="/usr/local/bin/node"
    if [ -f "/opt/homebrew/bin/node" ]; then
        NODE_BIN="/opt/homebrew/bin/node"
    fi
fi

CURRENT_DIR=$(pwd)
CURRENT_PATH="$PATH"

case "$1" in
  install)
    echo "=========================================================="
    echo "📦 动态生成 macOS Launchd 防休眠守护进程配置文件..."
    echo "   • 探测到的 Node 路径 : $NODE_BIN"
    echo "   • 当前项目根目录     : $CURRENT_DIR"
    echo "   • 防休眠包装器       : /usr/bin/caffeinate -dimsu"
    echo "=========================================================="

    mkdir -p "$HOME/Library/LaunchAgents"

    cat << EOF > "$TARGET_PLIST"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.trading.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/caffeinate</string>
        <string>-dimsu</string>
        <string>${NODE_BIN}</string>
        <string>--import</string>
        <string>tsx</string>
        <string>src/daemon/daemon_engine.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${CURRENT_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
        <key>Crashed</key>
        <true/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>3</integer>
    <key>StandardOutPath</key>
    <string>/tmp/com.trading.daemon.out.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/com.trading.daemon.err.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>PATH</key>
        <string>${CURRENT_PATH}</string>
    </dict>
</dict>
</plist>
EOF

    echo "✅ 动态 plist 配置文件已成功写入: $TARGET_PLIST"
    launchctl unload "$TARGET_PLIST" 2>/dev/null || true
    launchctl load -w "$TARGET_PLIST"
    echo "🎉 macOS 7x24 无人值守防休眠守护进程已成功安装并常驻运行！"
    ;;

  load)
    echo "🚀 正在载入并启动 macOS 守护进程..."
    if [ ! -f "$TARGET_PLIST" ]; then
        echo "⚠️ 配置文件 $TARGET_PLIST 不存在，请先执行 '$0 install' 进行安装配置！"
        exit 1
    fi
    launchctl load -w "$TARGET_PLIST"
    echo "✅ 已执行 launchctl load，守护进程已成功载入启动。"
    ;;

  unload)
    echo "🛑 正在停止并卸载 macOS 守护进程..."
    if [ -f "$TARGET_PLIST" ]; then
        launchctl unload -w "$TARGET_PLIST"
        echo "✅ 已执行 launchctl unload，守护进程已停止并卸载。"
    else
        echo "⚠️ 配置文件 $TARGET_PLIST 不存在。"
    fi
    ;;

  status)
    echo "🔍 检查 macOS Launchd 进程注册状态..."
    launchctl list | grep "com.trading.daemon" || echo "⚠️ Launchd 服务列表中未发现 com.trading.daemon"
    echo "----------------------------------------"
    echo "💡 检查 8089 观察者 HTTP/WS 网关状态:"
    HEALTH_RES=$(curl -s --max-time 3 http://localhost:8089/api/health)
    if [ -n "$HEALTH_RES" ]; then
        echo "✅ 网关在线响应: $HEALTH_RES"
    else
        echo "❌ 8089 网关未响应 (守护进程未开启或正在拉起中)"
    fi
    ;;

  logs)
    echo "📜 正在实时跟踪日志管道 (/tmp/com.trading.daemon.out.log & err.log)..."
    touch /tmp/com.trading.daemon.out.log /tmp/com.trading.daemon.err.log
    tail -f /tmp/com.trading.daemon.out.log /tmp/com.trading.daemon.err.log
    ;;

  *)
    echo "用法: $0 {install|load|unload|status|logs}"
    echo "  install : 动态检测系统路径、配置 caffeinate 防休眠并启动 Launchd 守护进程"
    echo "  load    : 载入并启动守护进程"
    echo "  unload  : 停止并卸载守护进程"
    echo "  status  : 查看 Launchd 进程与 8089 网关健康度"
    echo "  logs    : 实时跟踪 stdout 与 stderr 日志"
    exit 1
    ;;
esac
