import React, { useState, useMemo, useEffect } from 'react';
import { LogCenterProps } from './types';
import { Terminal, ExternalLink, Search, Clock, RotateCcw, X, Trash2, HardDrive, Sparkles, CheckCircle2, ShieldCheck, HelpCircle, RefreshCw, AlertTriangle } from 'lucide-react';
import { cacheManager, StorageEstimateInfo } from '../../services/cacheManager';

export const LogCenterModule: React.FC<LogCenterProps> = ({ logs, onOpenChart, onClearLogs }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showCacheModal, setShowCacheModal] = useState(false);
  const [storageInfo, setStorageInfo] = useState<StorageEstimateInfo | null>(null);
  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanFeedback, setCleanFeedback] = useState<{ message: string; type: 'SUCCESS' | 'INFO' } | null>(null);
  const [autoCleanInterval, setAutoCleanInterval] = useState<number>(() => cacheManager.getAutoCleanInterval());
  const [showHelpAdvice, setShowHelpAdvice] = useState(false);

  // 监听存储状态
  useEffect(() => {
    const unsubscribe = cacheManager.subscribe((info) => {
      setStorageInfo(info);
    });

    const handleAutoCleanEvent = (e: any) => {
      const freed = e.detail?.freedMB || 0;
      setCleanFeedback({
        message: `【自动清理】系统已在后台自动释放缓存 ${freed > 0 ? `(${freed} MB)` : ''}`,
        type: 'SUCCESS'
      });
      setTimeout(() => setCleanFeedback(null), 5000);
      cacheManager.getStorageEstimate().then(setStorageInfo);
    };

    window.addEventListener('savior_auto_cache_cleaned', handleAutoCleanEvent);

    return () => {
      unsubscribe();
      window.removeEventListener('savior_auto_cache_cleaned', handleAutoCleanEvent);
    };
  }, []);

  const handleSetInterval = (minutes: number) => {
    setAutoCleanInterval(minutes);
    cacheManager.setAutoCleanInterval(minutes);
    setCleanFeedback({
      message: minutes === 0 ? '已关闭自动清理' : `自动清理周期已更新为每 ${minutes >= 60 ? `${minutes / 60}小时` : `${minutes}分钟`} 一次`,
      type: 'INFO'
    });
    setTimeout(() => setCleanFeedback(null), 3000);
  };

  const handleManualClean = async (mode: 'LIGHT' | 'DEEP') => {
    setIsCleaning(true);
    setCleanFeedback(null);
    try {
      const res = await cacheManager.clearCache(mode);
      const updated = await cacheManager.getStorageEstimate();
      setStorageInfo(updated);
      setCleanFeedback({
        message: mode === 'DEEP'
          ? `深度清理完成！共释放约 ${res.freedMB > 0 ? res.freedMB : '0.1+'} MB 磁盘与数据库缓存`
          : `轻量清理完成！已释放临时数据与内存缓存`,
        type: 'SUCCESS'
      });
    } catch (err: any) {
      setCleanFeedback({
        message: `清理失败: ${err?.message || String(err)}`,
        type: 'INFO'
      });
    } finally {
      setIsCleaning(false);
      setTimeout(() => setCleanFeedback(null), 6000);
    }
  };

  const filteredLogs = useMemo(() => {
    const term = searchTerm.toLowerCase();
    const startMs = startTime ? new Date(startTime).getTime() : 0;
    const endMs = endTime ? new Date(endTime).getTime() : Infinity;

    return logs.filter(log => {
      const matchesTerm = log.message.toLowerCase().includes(term);
      if (!matchesTerm) return false;

      const logTime = log.timestamp instanceof Date ? log.timestamp.getTime() : new Date(log.timestamp).getTime();
      return logTime >= startMs && logTime <= endMs;
    });
  }, [logs, searchTerm, startTime, endTime]);

  const renderMessage = (log: any) => {
    const { message, timestamp } = log;
    if (!onOpenChart) return message;

    // Regex to find symbols like BTCUSDT, ETHUSDT, etc.
    const symbolRegex = /[A-Z0-9]+USDT/g;
    const parts = message.split(symbolRegex);
    const matches = message.match(symbolRegex);

    if (!matches) return message;

    // Try to extract price if it's an "Opened" or "Closed" log
    const priceMatch = message.match(/at (\d+\.?\d*)/);
    const price = priceMatch ? parseFloat(priceMatch[1]) : undefined;
    const time = timestamp ? new Date(timestamp).getTime() : undefined;

    return (
      <>
        {parts.map((part, i) => (
          <React.Fragment key={i}>
            {part}
            {matches[i] && (
              <button
                onClick={() => onOpenChart(matches[i], price, time)}
                className="text-indigo-400 hover:text-indigo-300 hover:underline inline-flex items-center gap-0.5 mx-1 font-bold"
              >
                {matches[i]}
                <ExternalLink size={10} />
              </button>
            )}
          </React.Fragment>
        ))}
      </>
    );
  };

  const formatLastCleanText = (timestamp: number) => {
    if (!timestamp) return '尚未执行';
    const diffSec = Math.floor((Date.now() - timestamp) / 1000);
    if (diffSec < 60) return '刚刚';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}分钟前`;
    const diffHours = Math.floor(diffMin / 60);
    return `${diffHours}小时前`;
  };

  return (
    <div className="bg-black/50 rounded-lg border border-slate-700 p-4 h-full overflow-hidden flex flex-col relative">
      {/* Top Header & Toolbar */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <h3 className="text-slate-400 text-xs font-bold uppercase tracking-wider flex items-center gap-2">
            <Terminal size={14} />
            系统日志 / System Logs
          </h3>

          {/* Cache Status Badge & Cleaner Trigger Button */}
          <button
            onClick={() => setShowCacheModal(true)}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/80 text-[10px] transition-all hover:border-indigo-500/50"
            title="点击打开缓存与C盘垃圾自动清理面板"
          >
            <HardDrive size={11} className="text-indigo-400" />
            <span>缓存: <strong className="text-amber-400">{storageInfo ? `${storageInfo.usageMB} MB` : '计算中...'}</strong></span>
            <span className="text-slate-500">|</span>
            <span className="text-emerald-400 font-mono">
              {autoCleanInterval === 0 ? '自动清理:关' : `自动:${autoCleanInterval >= 60 ? `${autoCleanInterval / 60}h` : `${autoCleanInterval}m`}`}
            </span>
            <Trash2 size={10} className="text-slate-400 hover:text-red-400 ml-0.5" />
          </button>

          {/* Quick Feedback Toast */}
          {cleanFeedback && (
            <div className={`text-[10px] px-2 py-0.5 rounded flex items-center gap-1 animate-in fade-in duration-200 ${
              cleanFeedback.type === 'SUCCESS' ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800' : 'bg-slate-800 text-slate-200 border border-slate-700'
            }`}>
              <CheckCircle2 size={10} />
              <span>{cleanFeedback.message}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {showFilters ? (
            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-200">
              <div className="relative">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="搜索..."
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-[10px] text-white w-24 focus:outline-none focus:border-indigo-500"
                />
                <Search size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500" />
              </div>
              <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5">
                <input
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="bg-transparent border-none text-[10px] text-slate-400 focus:outline-none w-20"
                />
                <span className="text-slate-600">-</span>
                <input
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="bg-transparent border-none text-[10px] text-slate-400 focus:outline-none w-20"
                />
                {(startTime || endTime || searchTerm) && (
                  <button onClick={() => { setStartTime(''); setEndTime(''); setSearchTerm(''); }} className="text-slate-500 hover:text-white">
                    <RotateCcw size={10} />
                  </button>
                )}
              </div>
              <button onClick={() => setShowFilters(false)} className="text-slate-500 hover:text-white">
                <X size={12} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              {onClearLogs && (
                <button
                  onClick={onClearLogs}
                  title="清空当前显示的运行日志"
                  className="px-1.5 py-0.5 hover:bg-slate-800 rounded text-slate-500 hover:text-slate-300 text-[10px] flex items-center gap-1 transition-colors"
                >
                  <Trash2 size={11} />
                  <span>清空日志</span>
                </button>
              )}
              <button
                onClick={() => setShowFilters(true)}
                className="p-1 hover:bg-slate-800 rounded text-slate-500 hover:text-slate-300 transition-colors"
                title="搜索与过滤日志"
              >
                <Search size={12} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Log Stream Output */}
      <div className="flex-1 overflow-y-auto space-y-1 font-mono text-xs">
        {filteredLogs.length === 0 && (
          <p className="text-slate-600 italic">
            {logs.length === 0 ? '系统待机中... (日志将在此实时显示)' : '无匹配日志'}
          </p>
        )}
        {filteredLogs.map((log) => (
          <div key={log.id} className="flex gap-2 leading-relaxed">
            <span className="text-slate-500 flex-shrink-0 select-none">
              [{log.timestamp instanceof Date ? log.timestamp.toLocaleTimeString() : new Date(log.timestamp).toLocaleTimeString()}]
            </span>
            <span className={`
              ${log.type === 'INFO' ? 'text-slate-300' : ''}
              ${log.type === 'SUCCESS' ? 'text-emerald-400 font-medium' : ''}
              ${log.type === 'WARNING' ? 'text-amber-400' : ''}
              ${log.type === 'DANGER' ? 'text-red-400 font-bold' : ''}
            `}>
              {renderMessage(log)}
            </span>
          </div>
        ))}
      </div>

      {/* ========================================================================= */}
      {/* 缓存与存储垃圾自动清理面板 (Modal) */}
      {/* ========================================================================= */}
      {showCacheModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col text-slate-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-3.5 bg-slate-800/80 border-b border-slate-700">
              <div className="flex items-center gap-2">
                <HardDrive className="text-indigo-400" size={18} />
                <h3 className="text-sm font-bold text-white tracking-wide">
                  缓存与存储垃圾清理中心
                </h3>
              </div>
              <button
                onClick={() => setShowCacheModal(false)}
                className="p-1 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 text-xs overflow-y-auto max-h-[80vh]">
              {/* Storage Usage Summary Cards */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/60">
                  <div className="text-slate-400 text-[10px] mb-1">浏览器总缓存/数据</div>
                  <div className="text-base font-bold text-amber-400 font-mono">
                    {storageInfo ? `${storageInfo.usageMB} MB` : '...'}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {storageInfo && storageInfo.quotaMB > 0 ? `配额: ${storageInfo.quotaMB} MB` : 'IndexedDB+缓存'}
                  </div>
                </div>

                <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/60">
                  <div className="text-slate-400 text-[10px] mb-1">LocalStorage 存储</div>
                  <div className="text-base font-bold text-indigo-300 font-mono">
                    {storageInfo ? `${storageInfo.localStorageKB} KB` : '...'}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {storageInfo ? `${storageInfo.localStorageCount} 个键值项` : ''}
                  </div>
                </div>

                <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/60">
                  <div className="text-slate-400 text-[10px] mb-1">上次自动清理</div>
                  <div className="text-base font-bold text-emerald-400 font-mono">
                    {formatLastCleanText(storageInfo?.lastCleanTime || 0)}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    后台自动定时巡检
                  </div>
                </div>
              </div>

              {/* Auto Cleanup Interval Setting */}
              <div className="bg-slate-800/40 p-3.5 rounded-lg border border-slate-700 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white flex items-center gap-1.5">
                    <Clock size={14} className="text-emerald-400" />
                    自动定时清理周期
                  </span>
                  <span className="text-[11px] text-slate-400">
                    当前: <strong className="text-emerald-300">{autoCleanInterval === 0 ? '已关闭' : `每 ${autoCleanInterval >= 60 ? `${autoCleanInterval / 60} 小时` : `${autoCleanInterval} 分钟`}`}</strong>
                  </span>
                </div>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  系统将在后台定时自动清理无用的临时行情快照、过期 K 线缓存和多余日志，防止长期挂机导致 C 盘持续爆满。
                </p>
                <div className="grid grid-cols-4 gap-1.5 pt-1">
                  {[
                    { label: '15分钟', val: 15 },
                    { label: '30分钟(推荐)', val: 30 },
                    { label: '1小时', val: 60 },
                    { label: '3小时', val: 180 },
                    { label: '6小时', val: 360 },
                    { label: '12小时', val: 720 },
                    { label: '24小时', val: 1440 },
                    { label: '关闭自动', val: 0 }
                  ].map(opt => (
                    <button
                      key={opt.val}
                      onClick={() => handleSetInterval(opt.val)}
                      className={`px-2 py-1.5 rounded text-[11px] font-medium border transition-all text-center ${
                        autoCleanInterval === opt.val
                          ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300 font-bold shadow-sm'
                          : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2">
                <div className="text-xs font-bold text-white mb-1 flex items-center gap-1.5">
                  <Sparkles size={14} className="text-amber-400" />
                  手动即时清理
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleManualClean('LIGHT')}
                    disabled={isCleaning}
                    className="flex flex-col items-center justify-center p-3 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/50 text-indigo-200 transition-all hover:border-indigo-400 disabled:opacity-50"
                  >
                    <div className="flex items-center gap-1.5 font-bold text-xs mb-0.5">
                      <RefreshCw size={13} className={isCleaning ? 'animate-spin' : ''} />
                      轻量即时清理
                    </div>
                    <span className="text-[10px] text-slate-400">清理临时行情/释放内存</span>
                  </button>

                  <button
                    onClick={() => handleManualClean('DEEP')}
                    disabled={isCleaning}
                    className="flex flex-col items-center justify-center p-3 rounded-lg bg-red-600/20 hover:bg-red-600/30 border border-red-500/50 text-red-200 transition-all hover:border-red-400 disabled:opacity-50"
                  >
                    <div className="flex items-center gap-1.5 font-bold text-xs mb-0.5">
                      <Trash2 size={13} className={isCleaning ? 'animate-spin' : ''} />
                      深度彻底清理
                    </div>
                    <span className="text-[10px] text-slate-400">清空回测K线库/深度清磁盘</span>
                  </button>
                </div>
              </div>

              {/* Data Safety Guarantee Note */}
              <div className="bg-emerald-950/40 border border-emerald-800/60 p-2.5 rounded-lg flex items-start gap-2 text-emerald-300">
                <ShieldCheck size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  <strong>核心数据绝对安全保护：</strong>
                  清理过程受白名单保护，绝不会删除您的 API 密钥、策略配置参数、持仓与实盘设置。
                </div>
              </div>

              {/* C Drive Full - Expert Advice Dropdown */}
              <div className="border border-slate-700/80 rounded-lg overflow-hidden bg-slate-800/30">
                <button
                  onClick={() => setShowHelpAdvice(!showHelpAdvice)}
                  className="w-full flex items-center justify-between p-2.5 text-left text-slate-300 hover:text-white hover:bg-slate-800/60 transition-colors"
                >
                  <span className="flex items-center gap-1.5 font-semibold text-[11px]">
                    <HelpCircle size={13} className="text-amber-400" />
                    为什么程序运行久了 C 盘会满？专家优化建议
                  </span>
                  <span className="text-[10px] text-indigo-400">{showHelpAdvice ? '收起 ▲' : '展开查看 ▼'}</span>
                </button>

                {showHelpAdvice && (
                  <div className="p-3 bg-slate-900/80 border-t border-slate-700/80 text-[11px] space-y-2 text-slate-300 leading-relaxed">
                    <div className="flex items-start gap-1.5">
                      <div className="w-4 h-4 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center font-bold text-[10px] flex-shrink-0 mt-0.5">1</div>
                      <p>
                        <strong>Chrome 浏览器默认存储机制：</strong> 网页下载的几万根离线回测 K 线（IndexedDB）与 HTTP 缓存默认存放在 <code className="bg-black/60 px-1 py-0.5 rounded text-amber-300">C:\Users\用户名\AppData\Local\Google\Chrome</code> 中。
                      </p>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <div className="w-4 h-4 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center font-bold text-[10px] flex-shrink-0 mt-0.5">2</div>
                      <p>
                        <strong>推荐解决方案：</strong> 将本面板顶部的【自动清理周期】设为 <strong>30分钟</strong> 或 <strong>1小时</strong>，系统会在后台自动释放临时缓存，避免无限膨胀。
                      </p>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <div className="w-4 h-4 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center font-bold text-[10px] flex-shrink-0 mt-0.5">3</div>
                      <p>
                        <strong>浏览器全局清理快捷键：</strong> 在浏览器中按快捷键 <kbd className="bg-slate-800 border border-slate-600 px-1 py-0.5 rounded font-mono text-white">Ctrl + Shift + Delete</kbd>，勾选“缓存的图片和文件”并点击清理，可瞬间释放几 GB 甚至几十 GB 的浏览器历史垃圾。
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 bg-slate-800/60 border-t border-slate-700 flex justify-end">
              <button
                onClick={() => setShowCacheModal(false)}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition-colors"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
