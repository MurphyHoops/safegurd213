
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
      const isCritical = !this.props.moduleName;
      
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
        <div className="fixed inset-0 z-[9999] w-screen h-screen flex flex-col items-center justify-center p-6 bg-[#0b0e11] text-center">
          
          <div className="bg-red-900/20 p-4 rounded-full mb-4 animate-pulse border border-red-500/30 shadow-[0_0_20px_rgba(220,38,38,0.3)]">
            <ShieldAlert size={56} className="text-red-500" />
          </div>
          
          <h2 className="font-black text-white mb-1 text-2xl tracking-tight flex items-center gap-2">
            <AlertTriangle size={24} className="text-orange-500"/>
            系统核心进程中断 (SYSTEM FAILURE)
          </h2>
          
          <p className="text-slate-400 text-xs mb-4 max-w-md">
              检测到致命错误，为保护资金安全，系统已紧急熔断。
          </p>

          <div className="bg-black/60 p-3 rounded-lg border border-red-900/30 mb-6 max-w-xl w-full text-left overflow-hidden font-mono shadow-inner">
            <div className="flex items-center gap-2 text-red-400 text-[10px] font-bold mb-2 border-b border-red-900/30 pb-1">
                <Terminal size={12} /> ERROR TRACE LOG
            </div>
            <p className="text-[10px] text-red-200/80 break-all leading-relaxed opacity-90">
              {this.state.error?.message || 'Unknown render error occurred.'}
            </p>
          </div>

          <button
              onClick={this.handleRetry}
              className="flex items-center gap-2 bg-gradient-to-r from-slate-700 to-slate-600 hover:from-slate-600 hover:to-slate-500 text-white font-bold rounded-lg transition-all shadow-lg border border-slate-500/30 px-8 py-3 text-sm"
          >
              <RefreshCw size={16} className="animate-spin-slow" />
              尝试恢复会话
          </button>
          
          <div className="mt-6 text-[9px] text-slate-600 flex items-center gap-1.5 opacity-60">
              <Cpu size={10} /> Protected by Savior Protocol v12.29
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
