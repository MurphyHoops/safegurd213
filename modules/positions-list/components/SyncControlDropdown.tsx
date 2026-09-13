import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, Search, ChevronDown, Check, Clock, Settings, X, ShieldCheck, Activity, Sparkles, ExternalLink } from 'lucide-react';
import { AppSettings, Position } from '../../../types';
import { normalizeSymbol, isMemeScaledCoin } from '../../../services/symbolUtils';

interface SyncControlDropdownProps {
    isManualSyncing: boolean;
    syncTip: string | null;
    onManualSync: () => Promise<void>;
    onVerifyPosition: (positionOrSymbol: Position | string) => void | Promise<void>;
    settings: AppSettings;
    onUpdateSettings?: (section: keyof AppSettings, key: string, value: any) => void;
    activePositions: Position[];
    realPrices?: Record<string, number>;
}

export const SyncControlDropdown: React.FC<SyncControlDropdownProps> = ({
    isManualSyncing,
    syncTip,
    onManualSync,
    onVerifyPosition,
    settings,
    onUpdateSettings,
    activePositions,
    realPrices = {}
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [isVerifying, setIsVerifying] = useState(false);
    const [verifyResult, setVerifyResult] = useState<{ status: 'SUCCESS' | 'INFO' | 'ERROR'; message: string } | null>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [popupCoords, setPopupCoords] = useState<{ top: number; left: number; maxHeight: number }>({ top: 0, left: 0, maxHeight: 480 });

    const autoSyncEnabled = settings?.system?.autoSyncEnabled ?? true;
    const autoSyncIntervalMinutes = settings?.system?.autoSyncIntervalMinutes ?? 60;
    const lookbackHours = settings?.system?.syncHistoryLookbackHours ?? 1;

    // 动态计算浮窗定位（基于按钮屏幕物理坐标，彻底杜绝父容器 overflow-hidden / 遮挡问题）
    const updatePosition = () => {
        if (!buttonRef.current) return;
        const rect = buttonRef.current.getBoundingClientRect();
        const top = rect.bottom + 6;
        const width = 390;
        const left = Math.max(10, Math.min(rect.left, window.innerWidth - width - 15));
        const maxHeight = Math.max(280, Math.min(520, window.innerHeight - top - 15));
        setPopupCoords({ top, left, maxHeight });
    };

    // 点击组件外部自动关闭下拉菜单
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            if (buttonRef.current && buttonRef.current.contains(target)) return;
            if (popupRef.current && popupRef.current.contains(target)) return;
            setIsOpen(false);
        };

        if (isOpen) {
            updatePosition();
            document.addEventListener('mousedown', handleClickOutside);
            window.addEventListener('resize', updatePosition);
            window.addEventListener('scroll', updatePosition, true);
            // 展开时自动聚焦到单币输入框
            setTimeout(() => {
                inputRef.current?.focus();
            }, 100);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [isOpen]);

    // 计算快速候选币种推荐（当前持仓 + 实时价格池）
    const candidateSymbols = React.useMemo(() => {
        const set = new Set<string>();
        // 优先加入当前持仓币种
        activePositions.forEach(p => {
            const sym = normalizeSymbol(p.symbol);
            if (sym) set.add(sym);
        });
        // 加入热门币种
        ['BTC', 'ETH', 'SOL', 'PEPE', 'DOGE', 'BNB'].forEach(s => set.add(s));
        // 从实时价格中提取前 30 个币
        Object.keys(realPrices).slice(0, 30).forEach(s => {
            const sym = normalizeSymbol(s);
            if (sym) set.add(sym);
        });
        return Array.from(set);
    }, [activePositions, realPrices]);

    // 模糊匹配候选
    const filteredCandidates = React.useMemo(() => {
        const q = searchQuery.trim().toUpperCase();
        if (!q) {
            // 默认推荐前 5 个当前持仓或主流币
            return candidateSymbols.slice(0, 5);
        }
        return candidateSymbols.filter(s => s.includes(q) || q.includes(s)).slice(0, 6);
    }, [candidateSymbols, searchQuery]);

    // 执行单币深度穿透核验
    const handleExecuteSingleVerify = async (symbolToVerify?: string) => {
        const rawTarget = symbolToVerify || searchQuery;
        let clean = normalizeSymbol(rawTarget);
        if (!clean) {
            setVerifyResult({ status: 'ERROR', message: '请输入需要查询的币种代码' });
            return;
        }

        // 智能 Meme 币衍生折算（如输入 PEPE 自动适配 1000PEPE）
        if (isMemeScaledCoin(clean) && !clean.startsWith('1000')) {
            clean = '1000' + clean;
        }

        setIsVerifying(true);
        setVerifyResult({ status: 'INFO', message: `正在向币安穿透核验 ${clean} 实盘持仓与流水...` });

        try {
            await onVerifyPosition(clean);
            setVerifyResult({ 
                status: 'SUCCESS', 
                message: `✅ 已完成 ${clean} 穿透核验，数据已全量同步到【系统日志】、【当前持仓】与【交易日志】！` 
            });
        } catch (err: any) {
            setVerifyResult({ 
                status: 'ERROR', 
                message: `⚠️ 核验响应异常: ${err?.message || err}` 
            });
        } finally {
            setIsVerifying(false);
            // 5秒后清除临时提示
            setTimeout(() => {
                setVerifyResult(prev => (prev?.status === 'SUCCESS' ? null : prev));
            }, 6000);
        }
    };

    // 快捷更改设置
    const handleToggleAutoSync = () => {
        const next = !autoSyncEnabled;
        onUpdateSettings?.('system', 'autoSyncEnabled', next);
    };

    const handleSelectInterval = (minutes: number) => {
        onUpdateSettings?.('system', 'autoSyncIntervalMinutes', minutes);
    };

    const handleSelectLookback = (hours: number) => {
        onUpdateSettings?.('system', 'syncHistoryLookbackHours', hours);
    };

    return (
        <div className="relative inline-block">
            {/* 顶栏“正在同步/刷新币安数据”主控制按键（支持展开下拉） */}
            <div className="flex items-center">
                <button
                    ref={buttonRef}
                    id="manual-binance-sync-btn"
                    onClick={() => {
                        updatePosition();
                        setIsOpen(prev => !prev);
                    }}
                    title="点击展开币安数据同步与单币模糊穿透查询中心"
                    className={`ml-2 px-2.5 py-1 text-[11px] font-bold rounded-md transition-all flex items-center gap-1.5 border shadow-sm select-none ${
                        isManualSyncing 
                            ? 'bg-amber-950/50 text-amber-300 border-amber-500/50 cursor-wait' 
                            : isOpen
                            ? 'bg-slate-800 text-cyan-300 border-cyan-500/50 shadow-cyan-950/50'
                            : 'bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-700 hover:border-slate-600 active:scale-95'
                    }`}
                >
                    <RefreshCw size={12} className={isManualSyncing ? 'animate-spin text-amber-400' : isOpen ? 'text-cyan-400' : 'text-slate-400'} />
                    <span>{syncTip || '刷新币安数据'}</span>
                    <span className="text-[9px] px-1 py-0.2 rounded bg-slate-800/80 text-cyan-400/90 font-mono border border-slate-700/60 ml-0.5">
                        {lookbackHours}h
                    </span>
                    {autoSyncEnabled && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" title={`已启用 ${autoSyncIntervalMinutes} 分钟自动同步`} />
                    )}
                    <ChevronDown size={11} className={`transition-transform duration-200 text-slate-400 ${isOpen ? 'rotate-180 text-cyan-400' : ''}`} />
                </button>
            </div>

            {/* 🔒【无遮挡全顶层浮窗】采用 fixed 物理定位 + z-[999999]，绝对不会被父容器 overflow-hidden 或表格遮挡 */}
            {isOpen && (
                <div 
                    ref={popupRef}
                    className="fixed bg-[#0d1117] border border-slate-700/90 rounded-xl shadow-2xl z-[999999] overflow-hidden backdrop-blur-md animate-in fade-in zoom-in-95 duration-150 flex flex-col"
                    style={{ 
                        top: `${popupCoords.top}px`, 
                        left: `${popupCoords.left}px`, 
                        width: '390px',
                        maxHeight: `${popupCoords.maxHeight}px`,
                        filter: 'drop-shadow(0 20px 30px rgba(0, 0, 0, 0.85))' 
                    }}
                >
                    {/* 面板头部 */}
                    <div className="bg-[#161b22] px-3.5 py-2.5 border-b border-slate-800 flex justify-between items-center select-none shrink-0">
                        <div className="flex items-center gap-2">
                            <Activity size={15} className="text-cyan-400" />
                            <span className="text-xs font-bold text-slate-200 tracking-wide">
                                币安数据同步与单币穿透中心
                            </span>
                        </div>
                        <button 
                            onClick={() => setIsOpen(false)}
                            className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-slate-800 transition-colors"
                        >
                            <X size={15} />
                        </button>
                    </div>

                    <div className="p-3.5 space-y-3.5 text-xs text-slate-300 overflow-y-auto flex-1 custom-scrollbar">
                        {/* 模块 1：单币模糊输入与深度穿透查询 (核心解决手机APP/外部开平仓不显示问题) */}
                        <div className="bg-[#10141d] p-3 rounded-lg border border-slate-800/90 space-y-2.5 shadow-sm">
                            <div className="flex items-center justify-between">
                                <span className="font-bold text-slate-200 flex items-center gap-1.5 text-xs">
                                    <Search size={14} className="text-amber-400" />
                                    单币模糊查询与深度穿透
                                </span>
                                <span className="text-[10px] text-amber-400/90 font-mono px-1.5 py-0.5 rounded bg-amber-950/40 border border-amber-500/30">
                                    查漏对账·全量同步
                                </span>
                            </div>

                            {/* 手动输入框与核验按钮（宽裕内边距，防遮挡） */}
                            <div className="flex gap-2 items-center">
                                <div className="relative flex-1">
                                    <input
                                        ref={inputRef}
                                        type="text"
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value.toUpperCase())}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') handleExecuteSingleVerify();
                                        }}
                                        placeholder="输入币名 (如 BTC, PEPE, SOL)..."
                                        className="w-full bg-slate-900 border border-slate-700 hover:border-slate-600 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 font-mono pr-8 shadow-inner transition-colors"
                                    />
                                    {searchQuery && (
                                        <button 
                                            onClick={() => setSearchQuery('')}
                                            className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white transition-colors p-0.5 rounded"
                                            title="清空输入"
                                        >
                                            <X size={13} />
                                        </button>
                                    )}
                                </div>
                                <button
                                    onClick={() => handleExecuteSingleVerify()}
                                    disabled={isVerifying || !searchQuery.trim()}
                                    className="px-3.5 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold rounded-lg flex items-center gap-1.5 shrink-0 transition-all shadow-sm active:scale-95 text-xs"
                                >
                                    {isVerifying ? (
                                        <>
                                            <RefreshCw size={13} className="animate-spin text-white" />
                                            <span>核验中</span>
                                        </>
                                    ) : (
                                        <>
                                            <Search size={13} />
                                            <span>穿透核验</span>
                                        </>
                                    )}
                                </button>
                            </div>

                            {/* 模糊匹配候选 Chips */}
                            {filteredCandidates.length > 0 && (
                                <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                                    <span className="text-[10px] text-slate-400 shrink-0">快速候选:</span>
                                    {filteredCandidates.map(sym => (
                                        <button
                                            key={sym}
                                            onClick={() => {
                                                setSearchQuery(sym);
                                                handleExecuteSingleVerify(sym);
                                            }}
                                            className="px-2 py-0.5 text-[10px] font-mono bg-slate-850 hover:bg-cyan-950/80 hover:text-cyan-300 text-slate-300 border border-slate-700/60 hover:border-cyan-500/60 rounded-md transition-all active:scale-95"
                                        >
                                            {sym}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* 核验反馈提示 */}
                            {verifyResult && (
                                <div className={`p-2.5 rounded-lg text-[11px] leading-relaxed border flex items-start gap-2 animate-in fade-in duration-150 ${
                                    verifyResult.status === 'SUCCESS' 
                                        ? 'bg-emerald-950/40 text-emerald-300 border-emerald-500/40'
                                        : verifyResult.status === 'ERROR'
                                        ? 'bg-red-950/40 text-red-300 border-red-500/40'
                                        : 'bg-cyan-950/40 text-cyan-300 border-cyan-500/40'
                                }`}>
                                    <ShieldCheck size={14} className="shrink-0 mt-0.5" />
                                    <span>{verifyResult.message}</span>
                                </div>
                            )}

                            <p className="text-[10px] text-slate-400 leading-normal">
                                💡 若在手机APP或其他程序上有开仓/减仓/平仓未及时显示，直接输入币名穿透核查，查到后立即在【系统日志】、【当前持仓】与【交易日志】中全量呈现。
                            </p>
                        </div>

                        {/* 模块 2：全账户立即手动同步 */}
                        <div className="bg-[#10141d] p-3 rounded-lg border border-slate-800/90 space-y-2 shadow-sm">
                            <div className="flex items-center justify-between">
                                <span className="font-bold text-slate-200 flex items-center gap-1.5 text-xs">
                                    <RefreshCw size={14} className="text-cyan-400" />
                                    全账户即时对账
                                </span>
                                <span className="text-[10px] text-cyan-400/90 font-mono px-1.5 py-0.5 rounded bg-cyan-950/40 border border-cyan-500/30">
                                    回溯最近 {lookbackHours} 小时
                                </span>
                            </div>

                            <button
                                onClick={async () => {
                                    await onManualSync();
                                }}
                                disabled={isManualSyncing}
                                className={`w-full py-2 px-3 rounded-lg font-bold text-xs flex items-center justify-center gap-2 border transition-all ${
                                    isManualSyncing
                                        ? 'bg-amber-950/60 text-amber-300 border-amber-500/60 cursor-wait'
                                        : 'bg-slate-800 hover:bg-slate-700 text-white border-slate-600 hover:border-cyan-500/60 active:scale-98 shadow-sm'
                                }`}
                            >
                                <RefreshCw size={13} className={isManualSyncing ? 'animate-spin text-amber-400' : 'text-cyan-400'} />
                                <span>{isManualSyncing ? '正在向币安核验 (5秒硬超时防护)...' : `立即全面同步 (最近 ${lookbackHours} 小时)`}</span>
                            </button>
                        </div>

                        {/* 模块 3：同步与对账参数设置 (开关全部收纳于此) */}
                        <div className="bg-[#10141d] p-3 rounded-lg border border-slate-800/90 space-y-2.5 shadow-sm">
                            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                                <span className="font-bold text-slate-200 flex items-center gap-1.5 text-xs">
                                    <Settings size={14} className="text-slate-400" />
                                    同步参数与自动调度
                                </span>
                            </div>

                            {/* 自动同步开关 */}
                            <div className="flex items-center justify-between">
                                <div className="flex flex-col">
                                    <span className="font-bold text-slate-300 text-xs">自动定时同步</span>
                                    <span className="text-[10px] text-slate-400">后台定时静默核对币安持仓与流水</span>
                                </div>
                                <button
                                    onClick={handleToggleAutoSync}
                                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                        autoSyncEnabled ? 'bg-emerald-600' : 'bg-slate-700'
                                    }`}
                                >
                                    <span
                                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                            autoSyncEnabled ? 'translate-x-4' : 'translate-x-0'
                                        }`}
                                    />
                                </button>
                            </div>

                            {/* 自动同步周期选择 */}
                            {autoSyncEnabled && (
                                <div className="space-y-1.5 pt-1 border-t border-slate-800/60">
                                    <div className="flex justify-between text-[11px]">
                                        <span className="text-slate-400">自动同步周期:</span>
                                        <span className="text-cyan-400 font-mono font-bold">{autoSyncIntervalMinutes} 分钟</span>
                                    </div>
                                    <div className="grid grid-cols-4 gap-1.5">
                                        {[
                                            { label: '30分钟', val: 30 },
                                            { label: '1小时', val: 60 },
                                            { label: '2小时', val: 120 },
                                            { label: '4小时', val: 240 }
                                        ].map(item => (
                                            <button
                                                key={item.val}
                                                onClick={() => handleSelectInterval(item.val)}
                                                className={`py-1 text-[10px] font-bold rounded-md border transition-colors ${
                                                    autoSyncIntervalMinutes === item.val
                                                        ? 'bg-cyan-950/80 text-cyan-300 border-cyan-500/70 shadow-sm'
                                                        : 'bg-slate-900 text-slate-400 hover:text-slate-200 border-slate-800 hover:border-slate-700'
                                                }`}
                                            >
                                                {item.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* 流水回溯范围调节 */}
                            <div className="space-y-1.5 pt-1.5 border-t border-slate-800/60">
                                <div className="flex justify-between text-[11px]">
                                    <span className="text-slate-400">流水回溯范围 (单次对账):</span>
                                    <span className="text-amber-400 font-mono font-bold">{lookbackHours} 小时</span>
                                </div>
                                <div className="grid grid-cols-4 gap-1.5">
                                    {[
                                        { label: '1小时(快)', val: 1 },
                                        { label: '3小时', val: 3 },
                                        { label: '6小时', val: 6 },
                                        { label: '24小时', val: 24 }
                                    ].map(item => (
                                        <button
                                            key={item.val}
                                            onClick={() => handleSelectLookback(item.val)}
                                            className={`py-1 text-[10px] font-bold rounded-md border transition-colors ${
                                                lookbackHours === item.val
                                                    ? 'bg-amber-950/70 text-amber-300 border-amber-500/70 shadow-sm'
                                                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border-slate-800 hover:border-slate-700'
                                            }`}
                                        >
                                            {item.label}
                                        </button>
                                    ))}
                                </div>
                                <p className="text-[9px] text-slate-500 leading-tight pt-0.5">
                                    💡 默认 1 小时回溯数据量小、币安响应仅 50~150ms，彻底根治转圈卡死。
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
