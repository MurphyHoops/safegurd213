import React, { ErrorInfo, ReactNode } from 'react';
import { RefreshCw, ShieldAlert, AlertTriangle, Zap, RotateCcw } from 'lucide-react';
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

  private autoRecoverTimer: any = null;

  constructor(props: ErrorBoundaryProps) {
    super(props);
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const modName = this.props.moduleName || 'ROOT';
    console.error(`[Savior Guard] Handled exception in ${modName}:`, error);
    
    // 1. Record complete diagnostics to persistent Crash Blackbox
    try {
      recordCrashToBlackbox({
        module: modName,
        message: error?.message || '未知渲染错误',
        stack: error?.stack,
        componentStack: errorInfo?.componentStack,
        type: 'RENDER_CRASH'
      });
    } catch (_) {}

    // 2. Safe log tracking into local storage without triggering page reload
    try {
      const raw = localStorage.getItem('SAVIOR_SYSTEM_MONITOR_LOGS');
      let logs: any[] = [];
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) logs = parsed;
        } catch (_) {}
      }
      
      const isRoot = !this.props.moduleName || this.props.moduleName.toLowerCase().includes('root') || this.props.moduleName.toLowerCase().includes('shield');
      const newLog = {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: Date.now(),
        level: isRoot ? 'ERROR' : 'WARN',
        module: modName,
        message: `【异常隔离】${modName}: ${error?.message || '未知临时错误'}`,
        details: { 
          stack: error?.stack, 
          componentStack: errorInfo?.componentStack,
          time: new Date().toISOString()
        }
      };
      
      localStorage.setItem('SAVIOR_SYSTEM_MONITOR_LOGS', JSON.stringify([newLog, ...logs].slice(0, 150)));
    } catch (_) {}

    // 3. 🛡️ AUTO-HEALING FOR SUBMODULES:
    // For non-root submodules, attempt a clean in-place auto-recovery once after 1.5s
    const isRoot = !this.props.moduleName || this.props.moduleName.toLowerCase().includes('root') || this.props.moduleName.toLowerCase().includes('shield');
    if (!isRoot && this.state.retryCount < 2) {
      if (this.autoRecoverTimer) clearTimeout(this.autoRecoverTimer);
      this.autoRecoverTimer = setTimeout(() => {
        this.setState(prev => ({
          hasError: false,
          error: null,
          retryCount: prev.retryCount + 1,
          lastRetryTime: Date.now()
        }));
      }, 1500);
    }
  }

  componentWillUnmount() {
    if (this.autoRecoverTimer) {
      clearTimeout(this.autoRecoverTimer);
    }
  }

  handleManualRetry = () => {
    if (this.autoRecoverTimer) clearTimeout(this.autoRecoverTimer);
    this.setState({
      hasError: false,
      error: null,
      retryCount: this.state.retryCount + 1,
      lastRetryTime: Date.now()
    });
  };

  handleSafeReset = () => {
    try {
      // Purge only transient scan caches, NEVER wipe user positions or settings!
      const keysToRemove = [
        'SCANNER_LIST2_CACHE_MAP',
        'SCANNER_LIST3_CACHE_MAP',
        'SCANNER_LIST4_CACHE_MAP',
        'SCANNER_RAW_DATA',
        'SAVIOR_CRASH_BLACKBOX',
        'SAVIOR_FLIGHT_RECORDER'
      ];
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch (_) {}
    this.handleManualRetry();
  };

  render() {
    if (this.state.hasError) {
      const isRoot = !this.props.moduleName || 
                     this.props.moduleName.toLowerCase().includes('root') || 
                     this.props.moduleName.toLowerCase().includes('shield');

      // 🛡️ SUBMODULE INLINE RECOVERY (Never takes over the whole screen!)
      if (!isRoot) {
        return (
          <div className="w-full h-full min-h-[160px] flex flex-col items-center justify-center p-4 bg-slate-900/60 rounded-xl border border-rose-500/30 text-center font-mono">
            <div className="w-10 h-10 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mb-2 text-rose-400">
              <ShieldAlert size={20} />
            </div>
            <div className="text-white text-xs font-bold mb-1">
              【{this.props.moduleName}】局部异常已隔离
            </div>
            <div className="text-slate-400 text-[10px] mb-3 max-w-[280px] truncate" title={this.state.error?.message}>
              {this.state.error?.message || '运行时临时错误'}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={this.handleManualRetry}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-md"
              >
                <RefreshCw size={12} />
                <span>原位恢复重试</span>
              </button>
            </div>
          </div>
        );
      }

      // 🛡️ ROOT-LEVEL CRASH SHIELD
      return (
        <div className="fixed inset-0 z-[9999] w-screen h-screen flex flex-col items-center justify-center p-6 bg-[#0b0e11] text-center font-mono">
          <div className="max-w-md w-full flex flex-col items-center p-6 bg-slate-900/90 rounded-2xl border border-rose-500/30 shadow-2xl backdrop-blur-md">
            <div className="w-12 h-12 rounded-full bg-rose-600/20 flex items-center justify-center mb-4 text-rose-400 border border-rose-500/40">
              <ShieldAlert size={24} />
            </div>
            
            <h2 className="font-bold text-white mb-2 text-base">
              系统核心隔离防护 (已就绪)
            </h2>
            
            <p className="text-slate-400 text-xs mb-4 leading-relaxed">
              {this.state.error?.message || '运行时临时错误'}
            </p>

            <div className="flex flex-col gap-2 w-full">
              <button
                onClick={this.handleManualRetry}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition-all shadow-lg flex items-center justify-center gap-2"
              >
                <RotateCcw size={14} />
                <span>原位恢复运行 (保持会话与数据)</span>
              </button>

              <button
                onClick={this.handleSafeReset}
                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 px-4 rounded-xl text-xs transition-all border border-slate-700 flex items-center justify-center gap-2"
              >
                <RefreshCw size={14} className="text-amber-400" />
                <span>安全清理临时缓存并恢复</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
