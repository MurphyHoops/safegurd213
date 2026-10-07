
import React, { ErrorInfo, ReactNode } from 'react';
import { RefreshCw, ShieldAlert, Terminal, Trash2, AlertTriangle, Cpu } from 'lucide-react';
import { recordCrashToBlackbox } from '../services/monitor/monitorService';

interface ErrorBoundaryProps {
  children?: ReactNode;
  moduleName?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
  lastRetryTime: number;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    retryCount: 0,
    lastRetryTime: 0
  };

  constructor(props: ErrorBoundaryProps) {
    super(props);
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[Savior Guard] Crash caught in ${this.props.moduleName || 'Root'}:`, error);
    
    // 1. Record complete diagnostics to persistent Crash Blackbox
    try {
        recordCrashToBlackbox({
            module: this.props.moduleName || 'ROOT',
            message: error?.message || '未知渲染错误',
            stack: error?.stack,
            componentStack: errorInfo?.componentStack,
            type: 'RENDER_CRASH'
        });
    } catch (_) {}

    try {
        const crashKey = 'SAVIOR_CRASH_COUNT';
        const lastCrashTime = Number(localStorage.getItem('SAVIOR_LAST_CRASH_TIME') || '0');
        const now = Date.now();
        let count = Number(localStorage.getItem(crashKey) || '0');

        if (now - lastCrashTime < 20000) {
            count += 1;
        } else {
            count = 1;
        }

        localStorage.setItem(crashKey, String(count));
        localStorage.setItem('SAVIOR_LAST_CRASH_TIME', String(now));

        // 🔒 [杜绝网页自动退出/刷新]: 异常捕获后保持会话与数据持久稳定，严禁未经用户授权擅自调用 window.location.reload()
        console.warn('[ErrorBoundary] Graceful catch: isolated error without forceful page reload.');
    } catch (e) {
        console.error('[ErrorBoundary] Crash tracking failed:', e);
    }

    // Log component rendering crash directly inside persistent local storage
    try {
        const raw = localStorage.getItem('SAVIOR_SYSTEM_MONITOR_LOGS');
        let logs: any[] = [];
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    logs = parsed;
                }
            } catch (err) {}
        }
        
        const isRootModule = !this.props.moduleName || this.props.moduleName.toLowerCase().includes('root');
        const newLog = {
            id: Math.random().toString(36).substring(2, 9),
            timestamp: Date.now(),
            level: isRootModule ? 'ERROR' : 'WARN',
            module: this.props.moduleName || 'ROOT',
            message: `【异常拦截】捕获组件渲染异常: ${error?.message || '未知渲染错误'}`,
            details: { 
                stack: error?.stack, 
                componentStack: errorInfo?.componentStack,
                time: new Date().toISOString()
            }
        };
        
        localStorage.setItem('SAVIOR_SYSTEM_MONITOR_LOGS', JSON.stringify([newLog, ...logs].slice(0, 200)));
    } catch (e) {}
  }

  handleRetry = () => {
    localStorage.clear();
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[9999] w-screen h-screen flex flex-col items-center justify-center p-6 bg-[#0b0e11] text-center font-mono">
          <div className="max-w-md w-full flex flex-col items-center p-6 bg-slate-900/90 rounded-2xl border border-rose-500/30 shadow-2xl backdrop-blur-md">
            <div className="w-12 h-12 rounded-full bg-rose-600/20 flex items-center justify-center mb-4 text-rose-400 border border-rose-500/40">
              <ShieldAlert size={24} />
            </div>
            
            <h2 className="font-bold text-white mb-2 text-base">
              系统捕获到渲染异常 (已拦截)
            </h2>
            
            <p className="text-slate-400 text-xs mb-4 leading-relaxed">
              {this.state.error?.message || '未知错误'}
            </p>

            <div className="flex flex-col gap-2 w-full">
              <button
                onClick={() => {
                    window.location.reload();
                }}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition-all shadow-lg flex items-center justify-center gap-2"
              >
                <RefreshCw size={14} />
                <span>重新加载页面 (保留设置)</span>
              </button>

              <button
                onClick={() => {
                    localStorage.clear();
                    window.location.reload();
                }}
                className="w-full bg-rose-600/80 hover:bg-rose-600 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition-all shadow-lg flex items-center justify-center gap-2"
              >
                <Trash2 size={14} />
                <span>强制清除全部缓存并全新重置</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
