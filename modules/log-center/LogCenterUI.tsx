import React, { useState, useMemo, useEffect } from 'react';
import { LogCenterProps } from './types';
import { Terminal, ExternalLink, Search, Clock, RotateCcw, X, Trash2, HardDrive, Sparkles, CheckCircle2, ShieldCheck, HelpCircle, RefreshCw, AlertTriangle, Download, Filter, Zap, Activity, DollarSign, ShieldAlert, Cpu } from 'lucide-react';
import { cacheManager, StorageEstimateInfo } from '../../services/cacheManager';
import { getCoinChineseName, resolveSymbolFromInput } from '../../services/coinNames';
import { LogCategory } from '../../types';

export const LogCenterModule: React.FC<LogCenterProps> = ({ logs, onOpenChart, onClearLogs }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<LogCategory>('ALL');
  const [selectedChainId, setSelectedChainId] = useState<string | null>(null);
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
    const term = searchTerm.trim().toLowerCase();
    const resolved = resolveSymbolFromInput(searchTerm);
    const resolvedSymbol = resolved.symbol ? resolved.symbol.toLowerCase() : '';
    const startMs = startTime ? new Date(startTime).getTime() : 0;
    const endMs = endTime ? new Date(endTime).getTime() : Infinity;

    return logs.filter(log => {
      // 1. Tab 分类过滤
      if (selectedCategory !== 'ALL') {
        const cat = log.category || 'AUTO';
        if (selectedCategory === 'ERROR') {
          if (cat !== 'ERROR' && log.type !== 'DANGER' && !log.message.includes('🚨') && !log.message.includes('失败') && !log.message.includes('拒绝')) {
            return false;
          }
        } else if (selectedCategory === 'PNL') {
          if (cat !== 'PNL' && !log.pnlBreakdown && !log.message.includes('盈亏') && !log.message.includes('纯净利润') && !log.message.includes('平仓') && !log.message.includes('减仓')) {
            return false;
          }
        } else if (selectedCategory === 'HEDGE') {
          if (cat !== 'HEDGE' && !log.message.includes('对冲') && !log.message.includes('防爆') && !log.exposureInfo) {
            return false;
          }
        } else if (selectedCategory === 'MANUAL') {
          if (cat !== 'MANUAL' && !log.message.includes('【手动操作】') && !log.message.includes('手动')) {
            return false;
          }
        } else if (selectedCategory === 'AUTO') {
          if (cat !== 'AUTO' && !log.message.includes('【自动策略信号】') && !log.message.includes('策略')) {
            return false;
          }
        }
      }

      // 2. Chain ID 聚焦过滤
      if (selectedChainId) {
        if (log.chainId !== selectedChainId && !log.message.includes(selectedChainId)) {
          return false;
        }
      }

      // 3. 搜索关键词过滤
      const msg = log.message.toLowerCase();
      const matchesTerm = !term || msg.includes(term) || (resolvedSymbol && msg.includes(resolvedSymbol)) || (log.chainId && log.chainId.toLowerCase().includes(term));
      if (!matchesTerm) return false;

      // 4. 时间范围过滤
      const logTime = log.timestamp instanceof Date ? log.timestamp.getTime() : new Date(log.timestamp).getTime();
      return logTime >= startMs && logTime <= endMs;
    });
  }, [logs, searchTerm, selectedCategory, selectedChainId, startTime, endTime]);

  const formatLastCleanText = (timestamp: number) => {
    if (!timestamp) return '尚未执行';
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 60) return `${diff}秒前`;
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
    return new Date(timestamp).toLocaleTimeString();
  };

  // 导出日志为 CSV
  const handleExportCsv = () => {
    if (filteredLogs.length === 0) return;
    const headers = ['时间', '类型', '分类', '链路ID', '消息内容', '信号耗时(ms)', '网络往返(ms)', '总延迟(ms)', '滑点(%)', '毛盈亏(USDT)', '手续费(USDT)', '资金费(USDT)', '纯净利润(USDT)'];
    const rows = filteredLogs.map(l => {
      const timeStr = l.timestamp instanceof Date ? l.timestamp.toISOString() : new Date(l.timestamp).toISOString();
      const type = l.type || 'INFO';
      const cat = l.category || 'AUTO';
      const chain = l.chainId || '';
      const msg = `"${(l.message || '').replace(/"/g, '""')}"`;
      const sigMs = l.latencyInfo?.signalLatencyMs ?? '';
      const netMs = l.latencyInfo?.networkLatencyMs ?? '';
      const totMs = l.latencyInfo?.totalLatencyMs ?? '';
      const slip = l.latencyInfo?.slippagePercent !== undefined ? l.latencyInfo.slippagePercent.toFixed(4) : '';
      const gross = l.pnlBreakdown?.grossPnl ?? '';
      const comm = l.pnlBreakdown?.commission ?? '';
      const fund = l.pnlBreakdown?.fundingFee ?? '';
      const net = l.pnlBreakdown?.netPnl ?? '';
      return [timeStr, type, cat, chain, msg, sigMs, netMs, totMs, slip, gross, comm, fund, net].join(',');
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Savior_Trade_Logs_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const renderMessage = (log: any) => {
    const { message, timestamp } = log;
    
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
        {parts.map((part: string, i: number) => (
          <React.Fragment key={i}>
            {part}
            {matches[i] && (
              <button
                onClick={() => onOpenChart && onOpenChart(matches[i], price, time)}
                className="text-indigo-400 hover:text-indigo-300 hover:underline inline-flex items-center gap-0.5 mx-1 font-bold"
              >
                <span>{matches[i]}</span>
                {getCoinChineseName(matches[i]) && (
                  <span className="text-amber-300/80 font-normal">({getCoinChineseName(matches[i])})</span>
                )}
                <ExternalLink size={10} />
              </button>
            )}
          </React.Fragment>
        ))}
      </>
    );
  };

  const getLogBorderClass = (log: any) => {
    if (log.type === 'DANGER' || log.category === 'ERROR') return 'border-red-900/60 bg-red-950/20';
    if (log.category === 'HEDGE') return 'border-purple-900/60 bg-purple-950/20';
    if (log.category === 'PNL' || log.pnlBreakdown) return 'border-emerald-900/60 bg-emerald-950/20';
    if (log.category === 'MANUAL') return 'border-cyan-900/60 bg-cyan-950/20';
    if (log.type === 'SUCCESS') return 'border-emerald-900/40 bg-emerald-950/10';
    if (log.type === 'WARNING') return 'border-amber-900/40 bg-amber-950/10';
    return 'border-transparent hover:bg-slate-900/40';
  };

  const categoryTabs: { key: LogCategory; label: string; icon: any; count?: number }[] = [
    { key: 'ALL', label: '全部日志', icon: Activity },
    { key: 'AUTO', label: '策略信号', icon: Zap },
    { key: 'MANUAL', label: '手动操作', icon: Terminal },
    { key: 'HEDGE', label: '防爆对冲', icon: ShieldAlert },
    { key: 'PNL', label: '盈亏穿透', icon: DollarSign },
    { key: 'ERROR', label: '异常拦截', icon: AlertTriangle }
  ];

  return (
    <div className="bg-black/50 rounded-lg border border-slate-700 p-2.5 h-full overflow-hidden flex flex-col relative">
      {/* All-in-one Single Row Header & Toolbar */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-800/80 mb-1.5 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1 overflow-x-auto no-scrollbar">
          <h3 className="text-slate-300 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap">
            <Terminal size={13} className="text-indigo-400" />
            <span>系统日志</span>
          </h3>

          {/* Cache Status Badge & Cleaner Trigger Button */}
          <button
            onClick={() => setShowCacheModal(true)}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/80 text-[10px] transition-all hover:border-indigo-500/50 flex-shrink-0"
            title="点击打开缓存与C盘垃圾自动清理面板"
          >
            <HardDrive size={10} className="text-indigo-400" />
            <span>缓存: <strong className="text-amber-400">{storageInfo ? `${storageInfo.usageMB}MB` : '...'}</strong></span>
            <span className="text-slate-600">|</span>
            <span className="text-emerald-400 font-mono text-[9px]">
              {autoCleanInterval === 0 ? '清理:关' : `自动:${autoCleanInterval >= 60 ? `${autoCleanInterval / 60}h` : `${autoCleanInterval}m`}`}
            </span>
            <Trash2 size={9} className="text-slate-400 hover:text-red-400 ml-0.5" />
          </button>

          {/* Divider */}
          <div className="h-3 w-px bg-slate-800 flex-shrink-0" />

          {/* All Category Tabs in the same row */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {categoryTabs.map(tab => {
              const Icon = tab.icon;
              const isActive = selectedCategory === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setSelectedCategory(tab.key)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-all whitespace-nowrap ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30'
                      : 'bg-slate-800/70 text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  <Icon size={11} className={isActive ? 'text-white' : 'text-slate-400'} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Active Chain ID Focus Filter Pill */}
          {selectedChainId && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-950/80 border border-indigo-700 text-indigo-300 text-[9px] animate-in fade-in flex-shrink-0">
              <Zap size={9} className="text-indigo-400" />
              <span>链路: <strong className="font-mono">{selectedChainId.slice(-8)}</strong></span>
              <button onClick={() => setSelectedChainId(null)} className="hover:text-white ml-0.5">
                <X size={9} />
              </button>
            </div>
          )}

          {/* Quick Feedback Toast */}
          {cleanFeedback && (
            <div className={`text-[9px] px-1.5 py-0.5 rounded flex items-center gap-1 animate-in fade-in duration-200 flex-shrink-0 ${
              cleanFeedback.type === 'SUCCESS' ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800' : 'bg-slate-800 text-slate-200 border border-slate-700'
            }`}>
              <CheckCircle2 size={9} />
              <span>{cleanFeedback.message}</span>
            </div>
          )}
        </div>

        {/* Right side controls (Export, Search, Clear) */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Export CSV Button */}
          <button
            onClick={handleExportCsv}
            disabled={filteredLogs.length === 0}
            title="导出当前筛选日志为 CSV 文件 (含耗时、手续费、净利、风险敞口与链路ID)"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/80 text-[10px] transition-all hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={10} className="text-emerald-400" />
            <span>导出</span>
          </button>

          {showFilters ? (
            <div className="flex items-center gap-1.5 animate-in fade-in slide-in-from-right-2 duration-200">
              <div className="relative">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="搜索币种/链路/内容..."
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-[10px] text-white w-28 focus:outline-none focus:border-indigo-500"
                />
                <Search size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500" />
              </div>
              <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded px-1 py-0.5">
                <input
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="bg-transparent border-none text-[9px] text-slate-400 focus:outline-none w-16"
                />
                <span className="text-slate-600">-</span>
                <input
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="bg-transparent border-none text-[9px] text-slate-400 focus:outline-none w-16"
                />
                {(startTime || endTime || searchTerm) && (
                  <button onClick={() => { setStartTime(''); setEndTime(''); setSearchTerm(''); }} className="text-slate-500 hover:text-white">
                    <RotateCcw size={9} />
                  </button>
                )}
              </div>
              <button onClick={() => setShowFilters(false)} className="text-slate-500 hover:text-white">
                <X size={11} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              {onClearLogs && (
                <button
                  onClick={onClearLogs}
                  title="清空当前显示的运行日志"
                  className="px-1.5 py-0.5 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 text-[10px] flex items-center gap-1 transition-colors"
                >
                  <Trash2 size={10} />
                  <span>清空</span>
                </button>
              )}
              <button
                onClick={() => setShowFilters(true)}
                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition-colors"
                title="搜索与过滤日志"
              >
                <Search size={11} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Log Stream Output */}
      <div className="flex-1 overflow-y-auto space-y-1.5 font-mono text-xs pr-1">
        {filteredLogs.length === 0 && (
          <p className="text-slate-600 italic py-4 text-center">
            {logs.length === 0 ? '系统待机中... (日志将在此实时显示)' : '无匹配当前条件的日志'}
          </p>
        )}
        {filteredLogs.map((log) => {
          const isSelectedChain = selectedChainId && log.chainId === selectedChainId;
          return (
            <div
              key={log.id}
              className={`flex flex-col gap-1 p-1.5 rounded border transition-colors ${getLogBorderClass(log)} ${isSelectedChain ? 'ring-1 ring-indigo-500' : ''}`}
            >
              <div className="flex items-start gap-2 leading-relaxed">
                <span className="text-slate-500 flex-shrink-0 select-none text-[10px] mt-0.5 font-sans">
                  [{log.timestamp instanceof Date ? log.timestamp.toLocaleTimeString() : new Date(log.timestamp).toLocaleTimeString()}]
                </span>

                {/* Category Pill */}
                {log.category && log.category !== 'ALL' && (
                  <span className={`text-[9px] px-1 py-0.2 rounded font-sans uppercase font-bold flex-shrink-0 ${
                    log.category === 'HEDGE' ? 'bg-purple-900/80 text-purple-200 border border-purple-700' :
                    log.category === 'PNL' ? 'bg-emerald-900/80 text-emerald-200 border border-emerald-700' :
                    log.category === 'MANUAL' ? 'bg-cyan-900/80 text-cyan-200 border border-cyan-700' :
                    log.category === 'ERROR' ? 'bg-red-900/80 text-red-200 border border-red-700' :
                    'bg-slate-800 text-slate-300'
                  }`}>
                    {log.category === 'HEDGE' ? '防爆对冲' :
                     log.category === 'PNL' ? '盈亏穿透' :
                     log.category === 'MANUAL' ? '手动' :
                     log.category === 'ERROR' ? '异常' : '策略'}
                  </span>
                )}

                {/* Chain ID Clickable Badge */}
                {log.chainId && (
                  <button
                    onClick={() => setSelectedChainId(selectedChainId === log.chainId ? null : log.chainId!)}
                    title="点击聚焦追踪该笔交易全生命周期日志"
                    className={`text-[9px] px-1.5 py-0.2 rounded font-mono flex-shrink-0 transition-all border ${
                      selectedChainId === log.chainId
                        ? 'bg-indigo-600 text-white border-indigo-400'
                        : 'bg-slate-800/80 text-indigo-300 border-slate-700 hover:border-indigo-500'
                    }`}
                  >
                    🔗 {log.chainId.slice(-8)}
                  </button>
                )}

                <div className={`flex-1 break-words ${
                  log.type === 'INFO' ? 'text-slate-300' : ''
                } ${
                  log.type === 'SUCCESS' ? 'text-emerald-400 font-medium' : ''
                } ${
                  log.type === 'WARNING' ? 'text-amber-400' : ''
                } ${
                  log.type === 'DANGER' ? 'text-red-400 font-bold' : ''
                }`}>
                  {renderMessage(log)}
                </div>
              </div>

              {/* Extra Transparency Meta Strip (Execution Latency, Fee Breakdown, Exposure) */}
              {(log.latencyInfo || log.pnlBreakdown || log.exposureInfo) && (
                <div className="flex flex-wrap items-center gap-2 text-[10px] pl-6 pt-0.5 text-slate-400 border-t border-slate-800/60 mt-0.5">
                  {/* Execution Latency & Slippage */}
                  {log.latencyInfo && (
                    <div className="flex items-center gap-1 text-slate-300 bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-800">
                      <Cpu size={10} className="text-cyan-400" />
                      <span>耗时:</span>
                      {log.latencyInfo.signalLatencyMs !== undefined && <span>信号 <strong className="text-cyan-300">{log.latencyInfo.signalLatencyMs}ms</strong></span>}
                      {log.latencyInfo.networkLatencyMs !== undefined && <span>往返 <strong className="text-cyan-300">{log.latencyInfo.networkLatencyMs}ms</strong></span>}
                      {log.latencyInfo.totalLatencyMs !== undefined && <span>总 <strong className="text-emerald-300">{log.latencyInfo.totalLatencyMs}ms</strong></span>}
                      {log.latencyInfo.slippagePercent !== undefined && (
                        <span>滑点 <strong className={log.latencyInfo.slippagePercent > 0.05 ? 'text-amber-400' : 'text-slate-300'}>{log.latencyInfo.slippagePercent > 0 ? '+' : ''}{log.latencyInfo.slippagePercent.toFixed(2)}%</strong></span>
                      )}
                    </div>
                  )}

                  {/* Fee & Pure Net PnL Breakdown */}
                  {log.pnlBreakdown && (
                    <div className="flex items-center gap-1.5 text-slate-300 bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-800">
                      <DollarSign size={10} className="text-emerald-400" />
                      <span>毛盈亏: <strong className={log.pnlBreakdown.grossPnl !== undefined && log.pnlBreakdown.grossPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{log.pnlBreakdown.grossPnl !== undefined && log.pnlBreakdown.grossPnl >= 0 ? '+' : ''}{(log.pnlBreakdown.grossPnl ?? 0).toFixed(2)}U</strong></span>
                      <span>| 手续费: <strong className="text-amber-400">-{(log.pnlBreakdown.commission ?? 0).toFixed(2)}U</strong></span>
                      {(log.pnlBreakdown.fundingFee ?? 0) !== 0 && (
                        <span>| 资金费: <strong className={(log.pnlBreakdown.fundingFee ?? 0) > 0 ? 'text-amber-400' : 'text-emerald-400'}>{(log.pnlBreakdown.fundingFee ?? 0) >= 0 ? '+' : ''}{(log.pnlBreakdown.fundingFee ?? 0).toFixed(2)}U</strong></span>
                      )}
                      <span>| 纯净利润: <strong className={`font-bold ${(log.pnlBreakdown.netPnl ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-400'}`}>{(log.pnlBreakdown.netPnl ?? 0) >= 0 ? '+' : ''}{(log.pnlBreakdown.netPnl ?? 0).toFixed(2)} USDT</strong></span>
                    </div>
                  )}

                  {/* Net Risk Exposure */}
                  {log.exposureInfo && (
                    <div className="flex items-center gap-1 text-slate-300 bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-800">
                      <ShieldCheck size={10} className="text-purple-400" />
                      <span>净敞口:</span>
                      {log.exposureInfo.netAmount !== undefined && (
                        <strong className="text-purple-300">{log.exposureInfo.netAmount >= 0 ? '+' : ''}{log.exposureInfo.netAmount.toFixed(2)} USDT</strong>
                      )}
                      {log.exposureInfo.exposurePercent !== undefined && (
                        <span className="text-slate-400">(占比: {log.exposureInfo.exposurePercent.toFixed(1)}%)</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ========================================================================= */}
      {/* 缓存与存储垃圾自动清理面板 (Modal) */}
      {showCacheModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-xl w-full p-6 shadow-2xl space-y-5 text-slate-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-indigo-950/80 border border-indigo-700 text-indigo-400">
                  <HardDrive size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    本地存储与C盘缓存自动管理中心
                    <span className="text-[10px] font-normal px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                      防C盘爆满
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">实时监控浏览器与系统本地占用，提供轻量/深度清理与全自动垃圾回收</p>
                </div>
              </div>
              <button
                onClick={() => setShowCacheModal(false)}
                className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Storage Metric Cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3 space-y-1">
                <div className="text-[11px] text-slate-400">当前已占用缓存</div>
                <div className="text-lg font-bold text-amber-400 font-mono">
                  {storageInfo ? `${storageInfo.usageMB} MB` : '计算中...'}
                </div>
                <div className="text-[10px] text-slate-500">IndexedDB / 历史行情 / 状态</div>
              </div>

              <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3 space-y-1">
                <div className="text-[11px] text-slate-400">存储安全配额</div>
                <div className="text-lg font-bold text-slate-200 font-mono">
                  {storageInfo ? `${storageInfo.quotaMB} MB` : '计算中...'}
                </div>
                <div className="text-[10px] text-emerald-400">
                  使用率: {storageInfo ? `${storageInfo.percent}%` : '0%'}
                </div>
              </div>

              <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3 space-y-1">
                <div className="text-[11px] text-slate-400">上次自动清理</div>
                <div className="text-sm font-bold text-slate-300 pt-1 font-mono">
                  {storageInfo ? formatLastCleanText(storageInfo.lastCleanTime) : '尚未执行'}
                </div>
                <div className="text-[10px] text-slate-500">
                  {autoCleanInterval > 0 ? `每 ${autoCleanInterval} 分钟自动巡检` : '自动巡检已关闭'}
                </div>
              </div>
            </div>

            {/* Auto Cleanup Schedule Setting */}
            <div className="space-y-2 bg-slate-800/40 p-3.5 rounded-lg border border-slate-700/50">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <Sparkles size={13} className="text-indigo-400" />
                  定时自动清理周期 (无需人工干预):
                </label>
                <span className="text-[11px] text-indigo-300 font-mono">
                  {autoCleanInterval === 0 ? '手动模式' : `每 ${autoCleanInterval} 分钟`}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {[
                  { label: '每15分钟 (极速高频)', val: 15 },
                  { label: '每30分钟 (推荐)', val: 30 },
                  { label: '每1小时', val: 60 },
                  { label: '每2小时', val: 120 },
                  { label: '关闭自动', val: 0 }
                ].map(item => (
                  <button
                    key={item.val}
                    onClick={() => handleSetInterval(item.val)}
                    className={`px-2.5 py-1 text-xs rounded border transition-all ${
                      autoCleanInterval === item.val
                        ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm shadow-indigo-600/50'
                        : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-white'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
                💡 自动清理会在后台平滑静默清理过期K线、废弃日志与无用IndexedDB数据，<strong>绝不影响当前活跃持仓与实盘策略</strong>。
              </p>
            </div>

            {/* Manual Clear Action Buttons */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-300">手动立即清理:</div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => handleManualClean('LIGHT')}
                  disabled={isCleaning}
                  className="flex items-center justify-center gap-2 p-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition-all hover:border-slate-500 disabled:opacity-50 text-xs font-medium"
                >
                  <RefreshCw size={14} className={isCleaning ? 'animate-spin text-indigo-400' : 'text-indigo-400'} />
                  <div className="text-left">
                    <div>轻量日常清理</div>
                    <div className="text-[10px] text-slate-400 font-normal">释放旧日志与临时内存缓存</div>
                  </div>
                </button>

                <button
                  onClick={() => handleManualClean('DEEP')}
                  disabled={isCleaning}
                  className="flex items-center justify-center gap-2 p-3 rounded-lg bg-red-950/40 hover:bg-red-900/60 border border-red-800/80 text-red-200 transition-all hover:border-red-600 disabled:opacity-50 text-xs font-medium"
                >
                  <Trash2 size={14} className={isCleaning ? 'animate-spin text-red-400' : 'text-red-400'} />
                  <div className="text-left">
                    <div>深度清空释放</div>
                    <div className="text-[10px] text-red-300/80 font-normal">重置数据库缓存，极大腾出C盘空间</div>
                  </div>
                </button>
              </div>
            </div>

            {/* External OS C-Drive Advice Toggle */}
            <div className="border-t border-slate-800 pt-3">
              <button
                onClick={() => setShowHelpAdvice(!showHelpAdvice)}
                className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
              >
                <HelpCircle size={13} />
                <span>遇到整个系统或电脑C盘完全爆满？查看彻底清理攻略</span>
              </button>

              {showHelpAdvice && (
                <div className="mt-2.5 p-3 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-300 space-y-1.5 leading-relaxed animate-in fade-in duration-150">
                  <div className="font-semibold text-amber-400 flex items-center gap-1">
                    <ShieldCheck size={12} />
                    彻底释放 Windows C盘空间的 3 个实用方案:
                  </div>
                  <ol className="list-decimal list-inside space-y-1 pl-1 text-slate-300">
                    <li><strong>清理 Chrome 缓存目录:</strong> 退出浏览器后按 <code className="bg-slate-800 px-1 py-0.5 rounded text-indigo-300">Win+R</code> 输入 <code className="bg-slate-800 px-1 py-0.5 rounded text-indigo-300">%localappdata%\Google\Chrome\User Data\Default\Cache</code> 删除无用大文件。</li>
                    <li><strong>运行系统自带存储感知:</strong> 在 Windows 设置 ➡️ 系统 ➡️ 存储 ➡️ 打开「存储感知」，点击「立即运行存储感知」释放系统临时文件与更新备份。</li>
                    <li><strong>保持本系统自动清理开启:</strong> 本系统已内置防膨胀机制，每30分钟自动截断日志，长期挂机无须担心数据膨胀。</li>
                  </ol>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end pt-1">
              <button
                onClick={() => setShowCacheModal(false)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-white border border-slate-700 transition-colors font-medium"
              >
                关闭面板
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
