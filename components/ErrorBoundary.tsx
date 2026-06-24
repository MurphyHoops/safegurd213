
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
            message: isRootModule 
                ? `【React 顶级内核崩溃】${error?.message || '未知渲染错误'}` 
                : `【模块局部抗扰】已自动拦截局部渲染异常并尝试热重启: ${error?.message || '未知渲染错误'}`,
            details: { 
                stack: error?.stack, 
                componentStack: errorInfo?.componentStack,
                time: new Date().toISOString()
            }
        };
        
        localStorage.setItem('SAVIOR_SYSTEM_MONITOR_LOGS', JSON.stringify([newLog, ...logs].slice(0, 200)));
    } catch (e) {
        console.warn('[ErrorBoundary] Failed to save render error to system logs:', e);
    }

    // Auto-retry for non-critical modules after 3 seconds
    if (this.props.moduleName) {
        const now = Date.now();
        const timeSinceLastRetry = now - (this.state.lastRetryTime || 0);
        
        // Reset counter if it's been a while (e.g., > 15 seconds) since the last error
        let currentRetryCount = this.state.retryCount || 0;
        if (timeSinceLastRetry > 15000) {
            currentRetryCount = 0;
        }

        if (currentRetryCount < 3) {
            setTimeout(() => {
                if (this.state.hasError) {
                    this.setState(prevState => ({ 
                        hasError: false, 
                        error: null,
                        retryCount: (prevState.retryCount || 0) + 1,
                        lastRetryTime: Date.now()
                    }));
                }
            }, 3000);
        }
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, retryCount: 0, lastRetryTime: 0 });
  };

  render() {
    if (this.state.hasError) {
      const isCritical = !this.props.moduleName || this.props.moduleName === 'Root Shield';
      
      // If it's a module error, show a small placeholder instead of full screen
      if (!isCritical) {
          const isRetryLimitReached = (this.state.retryCount || 0) >= 3;
          
          return (
            <div className="flex flex-col items-center justify-center p-4 bg-[#0b0e11] border border-red-900/30 rounded-xl text-center h-full min-h-[100px] animate-pulse">
                <ShieldAlert size={24} className="text-red-500 mb-2" />
                <span className="text-xs text-red-400 font-bold">{this.props.moduleName} 异常</span>
                {isRetryLimitReached ? (
                    <button 
                        onClick={this.handleRetry}
                        className="mt-2 px-3 py-1 bg-red-900/50 hover:bg-red-800 text-white text-[10px] rounded border border-red-700 transition-colors flex items-center gap-1"
                    >
                        <RefreshCw size={10} /> 手动重启
                    </button>
                ) : (
                    <span className="text-[10px] text-slate-500 mt-1">正在自动恢复...</span>
                )}
            </div>
          );
      }
      
      return (
        <div className="fixed inset-0 z-[9999] w-screen h-screen flex flex-col items-center justify-center p-6 bg-[#0b0e11] text-center overflow-y-auto">
          <div className="max-w-xl w-full my-auto flex flex-col items-center">
            <div className="bg-red-900/20 p-4 rounded-full mb-4 animate-pulse border border-red-500/30 shadow-[0_0_20px_rgba(220,38,38,0.3)]">
              <ShieldAlert size={56} className="text-red-500" />
            </div>
            
            <h2 className="font-black text-white mb-1 text-2xl tracking-tight flex items-center gap-2 justify-center">
              <AlertTriangle size={24} className="text-orange-500 shrink-0"/>
              系统核心进程中断 (SYSTEM FAILURE)
            </h2>
            
            <p className="text-slate-400 text-xs mb-4 max-w-md">
                检测到致命渲染错误。为保护交易安全，安全围栏已激活。您可以在此下方直接操作修复或恢复出厂设置。
            </p>

            <div className="bg-black/60 p-3 rounded-lg border border-red-900/30 mb-6 w-full text-left overflow-hidden font-mono shadow-inner">
              <div className="flex items-center gap-2 text-red-400 text-[10px] font-bold mb-2 border-b border-red-900/30 pb-1">
                  <Terminal size={12} /> ERROR TRACE LOG
              </div>
              <p className="text-[10px] text-red-200/80 break-all leading-relaxed opacity-90 max-h-24 overflow-y-auto">
                {this.state.error?.message || 'Unknown render error occurred.'}
              </p>
            </div>

            <div className="flex flex-col gap-2.5 w-full">
              <button
                  onClick={this.handleRetry}
                  className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg transition-all shadow-lg border border-indigo-500/30 py-3 text-xs"
              >
                  <RefreshCw size={14} />
                  仅重载核心 / 尝试恢复当前会话
              </button>

              <button
                  onClick={() => {
                      localStorage.removeItem('SAVIOR_LOGS');
                      localStorage.removeItem('SAVIOR_SYSTEM_MONITOR_LOGS');
                      localStorage.removeItem('SCANNER_LIST2_CACHE_MAP');
                      localStorage.removeItem('SCANNER_LIST3_CACHE_MAP');
                      localStorage.removeItem('SCANNER_LIST4_CACHE_MAP');
                      alert('已清理系统日志与扫描器缓存。核心正在重试...');
                      window.location.reload();
                  }}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 font-bold rounded-lg transition-all border border-blue-500/30 py-3 text-xs"
              >
                  执行修复：清理系统日志与臃肿缓存 (保留个人设置)
              </button>

              <button
                  onClick={() => {
                      if (confirm('确定要清除所有系统设置、账户数据、运行参数恢复出厂配置吗？该操作不可撤销！')) {
                          localStorage.clear();
                          alert('出厂设置已成功还原。系统正在重联...');
                          window.location.reload();
                      }
                  }}
                  className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-400 font-bold rounded-lg transition-all border border-slate-700 py-3 text-xs"
              >
                  最终对策：完全清除缓存恢复出厂设置 (慎用)
              </button>
            </div>
            
            <div className="mt-8 text-[9px] text-slate-600 flex items-center gap-1.5 opacity-60">
                <Cpu size={10} /> Emergency Recovery Protocol v12.30
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
