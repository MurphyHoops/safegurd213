import React, { Component, ErrorInfo, ReactNode } from 'react';
import { RefreshCw, ShieldAlert, Terminal, Trash2 } from 'lucide-react';

interface ErrorBoundaryProps {
  children?: ReactNode;
  moduleName?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[Critical Error] in ${this.props.moduleName || 'App'}:`, error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    // If submodule error, don't refresh, just reset state
    if (!this.props.moduleName) {
        // window.location.reload(); 
    }
  };

  handleHardReset = () => {
      if (window.confirm('确定要清除所有本地缓存并重启吗？这将解决因数据损坏导致的白屏。')) {
          localStorage.clear();
          window.location.reload();
      }
  }

  render() {
    if (this.state.hasError) {
      const isCritical = !this.props.moduleName;
      
      return (
        <div className={`flex flex-col items-center justify-center p-4 bg-[#0b0e11] border border-red-900/30 rounded-lg text-center ${isCritical ? 'fixed inset-0 z-[9999] w-screen h-screen' : 'h-full min-h-[150px]'}`}>
          <div className="bg-red-900/20 p-3 rounded-full mb-3 animate-pulse">
            <ShieldAlert size={isCritical ? 48 : 24} className="text-red-500" />
          </div>
          
          <h2 className={`font-bold text-white mb-1 ${isCritical ? 'text-xl' : 'text-sm'}`}>
            {isCritical ? '系统遭遇严重错误 (System Crash)' : `${this.props.moduleName || '模块'} 暂时停止运行`}
          </h2>
          
          <div className="bg-black/50 p-2 rounded border border-red-900/30 mb-3 max-w-lg w-full text-left overflow-hidden">
            <div className="flex items-center gap-2 text-red-400 text-[10px] font-mono mb-1 border-b border-red-900/30 pb-1">
                <Terminal size={10} /> DEBUG TRACE
            </div>
            <p className="text-[10px] text-red-300/70 font-mono break-all line-clamp-3">
              {this.state.error?.message || 'Unknown render error'}
            </p>
          </div>

          <div className="flex gap-3">
            <button
                onClick={this.handleRetry}
                className={`flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded transition-all shadow-lg ${isCritical ? 'px-6 py-2 text-sm' : 'px-3 py-1 text-[10px]'}`}
            >
                <RefreshCw size={14} className={isCritical ? '' : 'w-3 h-3'} />
                {isCritical ? '尝试恢复界面' : '重启模块'}
            </button>

            {isCritical && (
                <button
                    onClick={this.handleHardReset}
                    className="flex items-center gap-2 bg-red-700 hover:bg-red-600 text-white font-bold rounded transition-all shadow-lg shadow-red-900/50 px-6 py-2 text-sm"
                >
                    <Trash2 size={14} />
                    清除缓存并重启 (急救)
                </button>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}