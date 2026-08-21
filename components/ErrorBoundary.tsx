
import React, { ErrorInfo, ReactNode } from 'react';
import { RefreshCw, ShieldAlert, Terminal, Trash2, AlertTriangle, Cpu } from 'lucide-react';

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
    
    try {
        // Automatically purge cache keys and reload on any critical crash
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && (k.includes('SCANNER_') || k.includes('CACHE') || k.includes('LOGS') || k.includes('MAP'))) {
                if (!k.includes('SETTINGS') && !k.includes('POSITIONS') && !k.includes('ACCOUNT')) {
                    keysToRemove.push(k);
                }
            }
        }
        keysToRemove.forEach(k => {
            try { localStorage.removeItem(k); } catch (e) {}
        });

        setTimeout(() => {
            window.location.reload();
        }, 800);
    } catch (e) {
        console.error('[ErrorBoundary] Auto-heal reload failed:', e);
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
            message: `【自动自愈拦截】捕获异常并已清理缓存准备热重启: ${error?.message || '未知渲染错误'}`,
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
        <div className="fixed inset-0 z-[9999] w-screen h-screen flex flex-col items-center justify-center p-6 bg-[#0b0e11] text-center">
          <div className="max-w-md w-full flex flex-col items-center p-6 bg-slate-900/80 rounded-2xl border border-indigo-500/30 shadow-2xl backdrop-blur-md">
            <div className="w-12 h-12 rounded-full bg-indigo-600/20 flex items-center justify-center mb-4 text-indigo-400 animate-spin border-2 border-indigo-500/50 border-t-transparent">
              <RefreshCw size={24} />
            </div>
            
            <h2 className="font-bold text-white mb-2 text-lg">
              系统正在自动自愈并重载...
            </h2>
            
            <p className="text-slate-400 text-xs mb-6 leading-relaxed">
              检测到版本升级或环境瞬时异常。系统已自动启动安全自愈协议，清除残留缓存并准备就绪。
            </p>

            <button
              onClick={() => {
                  localStorage.clear();
                  window.location.reload();
              }}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition-all shadow-lg"
            >
              立即手动刷新
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
