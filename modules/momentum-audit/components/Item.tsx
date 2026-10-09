
// 🔒 LOCKED_MODULE: LIST 4 [动能趋势审计 标的卡片组件]
// @LOCKED: 严格原子化单独锁定。未经用户明确下达的专属指令，严禁擅自修改、增加、删减或变动任何功能与代码。

import React, { useState, useEffect } from 'react';
import { Zap, Lock, Ban, Activity, AlertTriangle, Trash2, Moon, Sparkles, CheckCircle2, Clock, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { ScannerItem, List4Config } from '../../../components/Scanner/scannerTypes';
import { PositionSide } from '../../../types';
import { formatPrice } from '../../../services/symbolUtils';
import { getCoinChineseName } from '../../../services/coinNames';
import { RealtimePriceSpan } from '../../../components/RealtimePriceSpan';
import { eventBus } from '../../../core/EventBus';
import { klineMultiTfStore } from '../../../services/klineMultiTfStore';

interface Props {
    item: ScannerItem;
    executeTradeSafe: (symbol: string, side: PositionSide, price: number, reason: string, signalTf?: string, signalCandle?: any, entryEmas?: any) => boolean;
    setChartData: (data: any) => void;
    onRemove: () => void;
    idx?: number;
    config?: List4Config;
    tier?: 'WAITING' | 'FUSE_BLOCKED' | 'DORMANT';
}

const formatRemainingTime = (ms: number): string => {
    if (!ms || ms <= 0) return '即将清除';
    const totalSec = Math.ceil(ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    if (mins > 0) {
        return `${mins}分${secs < 10 ? '0' : ''}${secs}秒`;
    }
    return `${secs}秒`;
};

const List4ItemComponent: React.FC<Props> = ({ item, executeTradeSafe, setChartData, onRemove, idx, config, tier }) => {
    // Robust defensive check: Ensure item and its nested objects exist
    if (!item) return null;

    // Real-time ticking timer for countdowns
    const [nowTime, setNowTime] = useState(() => Date.now());
    useEffect(() => {
        if (item.fuseEnteredAt || item.tradedAt) {
            const timer = setInterval(() => {
                setNowTime(Date.now());
            }, 1000);
            return () => clearInterval(timer);
        }
    }, [item.fuseEnteredAt, item.tradedAt]);

    const m = item.momentum || { 
        status: 'INVALID', 
        midPoint: 0, 
        entryTrigger: 0, 
        invalidReason: 'Data Loading...' 
    };
    
    const status = m.status || 'PENDING';
    const isInvalid = status === 'INVALID';
    const isDormant = status === 'DORMANT' && !item.fuseBlocked;
    const isRevived = status === 'REVIVED';
    const isPending = status === 'PENDING' || isRevived;
    const isTriggered = status === 'TRIGGERED';
    const isLong = item.direction === 'LONG';
    const tf = item.tf || '15m';

    // Calculate distance to trigger for display
    let diffToTrigger = 0;
    if ((isPending || isDormant) && m.entryTrigger > 0 && item.price > 0) {
        if (isLong) {
            diffToTrigger = ((m.entryTrigger - item.price) / item.price) * 100;
        } else {
            diffToTrigger = ((item.price - m.entryTrigger) / item.price) * 100;
        }
    }

    // Determine effective tier if not explicitly passed
    const currentTier = tier || (item.fuseBlocked ? 'FUSE_BLOCKED' : isDormant ? 'DORMANT' : 'WAITING');

    // 方案 A: 手动开仓控制栏折叠状态 (默认收起，节约纵向空间)
    const [isActionExpanded, setIsActionExpanded] = useState(false);

    // 🎯 核心量化指标计算：前 NK 突破
    const kCount = Math.max(1, Math.min(50, config?.rev3KCandles ?? 3));
    let maxCloseN: number | undefined = undefined;
    let minCloseN: number | undefined = undefined;
    if (item.structure?.recentCloses && item.structure.recentCloses.length > 0) {
        const slice = item.structure.recentCloses.slice(-kCount);
        if (slice.length > 0) {
            maxCloseN = Math.max(...slice);
            minCloseN = Math.min(...slice);
        }
    }
    // 容错 1: 从内存全周期 K 线缓存极速补齐
    if (typeof maxCloseN !== 'number') {
        const klines = klineMultiTfStore.getKlinesSync(item.symbol, tf, kCount);
        if (klines && klines.length >= kCount) {
            const slice = klines.slice(-kCount);
            const closes = slice.map(k => k.close);
            maxCloseN = Math.max(...closes);
            minCloseN = Math.min(...closes);
        }
    }
    // 容错 2: 从 maxClose3 / minClose3 兜底
    if (typeof maxCloseN !== 'number') maxCloseN = item.structure?.maxClose3;
    if (typeof minCloseN !== 'number') minCloseN = item.structure?.minClose3;

    const targetNPrice = isLong ? maxCloseN : minCloseN;
    const hasTargetPrice = typeof targetNPrice === 'number' && targetNPrice > 0;

    let is3KPassed = false;
    let diffToN = 0;
    if (config?.enableRev3K) {
        if (hasTargetPrice && item.price > 0) {
            if (isLong) {
                is3KPassed = item.price > targetNPrice;
                diffToN = is3KPassed ? 0 : Math.max(0, ((targetNPrice - item.price) / item.price) * 100);
            } else {
                is3KPassed = item.price < targetNPrice;
                diffToN = is3KPassed ? 0 : Math.max(0, ((item.price - targetNPrice) / item.price) * 100);
            }
        }
    } else {
        is3KPassed = true;
    }

    // 🎯 核心量化指标计算：5K 爆发推进
    const thrustThreshold = (typeof config?.thrustThreshold === 'number' && !isNaN(config.thrustThreshold) && config.thrustThreshold > 0)
        ? config.thrustThreshold
        : 1.0;
    
    let resolvedMaxThrust: number | undefined = undefined;
    if (typeof item.structure?.maxThrust === 'number' && !isNaN(item.structure.maxThrust)) {
        resolvedMaxThrust = item.structure.maxThrust;
    } else {
        const klines = klineMultiTfStore.getKlinesSync(item.symbol, tf, 5);
        if (klines && klines.length >= 5) {
            const slice = klines.slice(-5);
            let maxT = -Infinity;
            for (let s = 0; s <= 2; s++) {
                const e = s + 2;
                const o = slice[s].open;
                const cl = slice[e].close;
                if (o > 0) {
                    const p = isLong ? ((cl - o) / o) * 100 : ((o - cl) / o) * 100;
                    if (p > maxT) maxT = p;
                }
            }
            if (maxT > -Infinity) {
                resolvedMaxThrust = parseFloat(maxT.toFixed(2));
            }
        }
    }
    const hasThrustData = typeof resolvedMaxThrust === 'number';
    const actualThrust = resolvedMaxThrust ?? 0;
    const thrustPass = hasThrustData && actualThrust >= thrustThreshold;
    const thrustDiff = Math.max(0, thrustThreshold - actualThrust);

    // 🎯 核心量化指标计算：寿命根数 (规整为纯整数，杜绝浮点数与折行溢出)
    let list2Retention = 9;
    try {
        const activeId = typeof window !== 'undefined' ? localStorage.getItem("SCANNER_SELECTED_STRATEGY_ID") : null;
        const cleanId = activeId ? (activeId.startsWith('"') ? JSON.parse(activeId) : activeId) : '';
        const savedL2 = typeof window !== 'undefined' ? (
            (cleanId ? localStorage.getItem(`SCANNER_LIST2_CONFIG_${cleanId}`) : null) || 
            localStorage.getItem('SCANNER_LIST2_CONFIG')
        ) : null;
        if (savedL2) {
            const parsed = JSON.parse(savedL2);
            if (parsed.newModeRetention && parsed.newModeRetention > 0) {
                list2Retention = parsed.newModeRetention;
            } else if (parsed.maxLag && parsed.maxLag > 0) {
                list2Retention = parsed.maxLag;
            }
        }
    } catch(e) {}
    const rawLag = item.structure?.lag ?? item.lag ?? 0;
    const lagBars = Math.max(0, Math.floor(rawLag));
    const remainingBars = Math.max(0, list2Retention - lagBars);

    // Calculate countdowns
    let fuseCountdownStr = '15分00秒';
    if (item.fuseEnteredAt && item.fuseTotalMs) {
        const elapsed = nowTime - item.fuseEnteredAt;
        const remaining = Math.max(0, item.fuseTotalMs - elapsed);
        fuseCountdownStr = formatRemainingTime(remaining);
    } else if (item.fuseCountdownMs) {
        fuseCountdownStr = formatRemainingTime(item.fuseCountdownMs);
    }

    let tradedCountdownStr = '15分00秒';
    if (item.tradedAt && item.tradedTotalMs) {
        const elapsed = nowTime - item.tradedAt;
        const remaining = Math.max(0, item.tradedTotalMs - elapsed);
        tradedCountdownStr = formatRemainingTime(remaining);
    } else if (item.tradedCountdownMs) {
        tradedCountdownStr = formatRemainingTime(item.tradedCountdownMs);
    }

    const handleOpenChart = (e?: React.MouseEvent) => {
        if(e) {
            e.preventDefault();
            e.stopPropagation();
        }
        setChartData({ 
            symbol: item.symbol, 
            tf: tf, 
            signals: item.structure?.signalTime ? [{ time: item.structure.signalTime, type: item.direction as any }] : [],
            entryPrice: item.structure?.signalPrice,
            entryTime: item.structure?.signalTime,
            currentPrice: item.price,
            highlightTime: item.enterList4Time,
            showAuditLines: true,
            list4Config: config,
            extraLines: [
                { price: m.entryTrigger, label: `${isLong ? '多单' : '空单'}进攻突破 (${config?.breakoutThreshold ?? 10}%)`, color: isLong ? "#0ECB81" : "#F6465D", style: "dashed" },
                { price: m.midPoint, label: `${isLong ? '多单' : '空单'}中轴防守 (${config?.midlineThreshold ?? 80}%)`, color: "#fbbf24", style: "dashed" }
            ]
        });
    };

    // Styling based on the 3 tiers
    // 1. 等待开仓队列：浅绿色风格
    // 2. 规则拦截待清除：浅黄色风格
    // 3. 破中轴休眠待复活：深黄色风格
    const tierCardStyle = 
        currentTier === 'FUSE_BLOCKED' 
            ? 'bg-amber-950/25 border-amber-400/50 hover:border-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.15)]' 
            : currentTier === 'DORMANT'
                ? 'bg-yellow-950/30 border-yellow-600/40 hover:border-yellow-500/60'
                : 'bg-emerald-950/15 border-emerald-500/40 hover:border-emerald-400/70 shadow-sm';

    const tierHeaderStyle =
        currentTier === 'FUSE_BLOCKED'
            ? 'bg-amber-950/40 border-b border-amber-400/30'
            : currentTier === 'DORMANT'
                ? 'bg-yellow-950/50 border-b border-yellow-600/30'
                : 'bg-emerald-950/35 border-b border-emerald-500/30';

    return (
        <div 
            onClick={handleOpenChart} 
            onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                eventBus.emit('OPEN_COIN_CONTEXT_MENU', {
                    x: e.clientX,
                    y: e.clientY,
                    symbol: item.symbol,
                    direction: item.direction || (isLong ? 'LONG' : 'SHORT'),
                    currentPrice: item.price,
                    chineseName: getCoinChineseName(item.symbol)
                });
            }}
            className={`rounded overflow-hidden animate-in fade-in transition-all cursor-pointer relative border ${tierCardStyle}`}
        >
            {/* Individual Remove Button (Far Right) */}
            <button 
                onClick={(e) => {
                    e.stopPropagation();
                    onRemove();
                }}
                className="absolute top-2 right-2 text-slate-500 hover:text-red-400 transition-all p-1 bg-red-900/10 rounded border border-red-500/10 hover:border-red-500/40 z-20 group-hover:scale-110"
                title="移除审计结果"
            >
                <Trash2 size={12} />
            </button>

            {/* Header */}
            <div className={`p-2 flex justify-between items-center pr-10 ${tierHeaderStyle}`}>
                <div 
                    className="flex flex-col cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={handleOpenChart}
                    title="点击查看 K 线图 (含触发线)"
                >
                    <div className="flex items-center gap-2">
                        {idx !== undefined && (
                            <span className="text-[10px] text-slate-500 font-mono font-bold">{idx + 1}.</span>
                        )}
                        <span className="text-xs font-bold text-white flex items-baseline gap-1">
                            <span>{item.symbol ? item.symbol.replace('USDT','') : 'UNKNOWN'}</span>
                            {item.symbol && getCoinChineseName(item.symbol) && getCoinChineseName(item.symbol) !== item.symbol.replace('USDT','') && (
                                <span className="text-[10px] text-amber-300/80 font-normal">({getCoinChineseName(item.symbol)})</span>
                            )}
                        </span>
                        {/* Tier indicator pill */}
                        {currentTier === 'WAITING' && (
                            <span className="text-[8px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1 rounded font-bold">
                                {item.isTraded ? '已开仓' : isTriggered ? '已达成突破' : '等待开仓'}
                            </span>
                        )}
                        {currentTier === 'FUSE_BLOCKED' && (
                            <span className="text-[8px] bg-amber-500/20 text-amber-300 border border-amber-400/40 px-1 rounded font-bold animate-pulse">
                                待清除
                            </span>
                        )}
                        {currentTier === 'DORMANT' && (
                            <span className="text-[8px] bg-yellow-500/20 text-yellow-400 border border-yellow-600/30 px-1 rounded font-bold">
                                休眠待复活
                            </span>
                        )}
                    </div>
                    <span className="text-[8px] text-slate-400 font-bold uppercase flex items-center gap-1">现价: <RealtimePriceSpan symbol={item.symbol} fallbackPrice={item.price} className="text-white" /></span>
                </div>

                <button 
                    onClick={handleOpenChart}
                    className={`relative overflow-hidden flex flex-col items-center justify-center border rounded cursor-pointer transition-all px-2 py-0.5 min-w-[36px] hover:scale-105 active:scale-95 ${isLong ? 'bg-emerald-900/40 border-emerald-500/40 hover:bg-emerald-800/60' : 'bg-red-900/40 border-red-500/40 hover:bg-red-800/60'}`}
                    title={`点击查看 ${tf} 周期 K 线`}
                >
                    <div className="text-[9px] font-bold text-white leading-none">{tf}</div>
                    <div className={`text-[8px] font-bold leading-none mt-0.5 ${isLong ? 'text-emerald-400' : 'text-red-400'}`}>{isLong ? '↑多' : '↓空'}</div>
                </button>
            </div>

            <div className="p-2 space-y-2">
                {/* 🟡 TIER 2: 触发熔断 / 规则拦截待清除队列 (浅黄色标记) */}
                {currentTier === 'FUSE_BLOCKED' ? (
                    <div className="bg-amber-950/30 border border-amber-400/40 p-2 rounded text-center space-y-1.5">
                        <div className="text-amber-300 font-bold text-[10px] flex items-center justify-center gap-1">
                            <AlertTriangle size={13} className="text-amber-400 shrink-0"/>
                            <span>符合【{item.fuseReason?.includes('动态方向锁') ? '动态方向锁' : item.fuseReason?.includes('高级过滤') ? '高级过滤' : '防追高熔断'}】过滤规则</span>
                        </div>
                        
                        <div className="flex items-center justify-center gap-1.5 py-1 px-2 bg-amber-900/40 rounded border border-amber-500/30 text-amber-300 text-[10px] font-bold">
                            <Clock size={12} className="text-amber-400 animate-spin" />
                            <span>将在 <span className="font-mono text-amber-200 text-xs">{fuseCountdownStr}</span> 后彻底清除</span>
                        </div>

                        <div className="text-[8px] text-amber-300/70">
                            倒计时结束后，将自动从列表4移除，并联动清除列表3与列表2
                        </div>

                        {item.fuseDetails && (
                            <div className="text-[9px] text-slate-300 space-y-0.5 border-t border-amber-500/20 pt-1 text-left grid grid-cols-3 gap-1">
                                <div>周期: <span className="font-bold text-white">{item.fuseDetails.period || '-'}</span></div>
                                <div>阈值: <span className="font-bold text-amber-400">{item.fuseDetails.threshold ?? 0}%</span></div>
                                <div>实测: <span className="font-bold text-white">{item.fuseDetails.actual ?? 0}%</span></div>
                            </div>
                        )}

                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onRemove();
                            }}
                            className="w-full py-1 mt-1 bg-amber-900/30 hover:bg-amber-900/60 border border-amber-500/40 rounded text-[9px] text-amber-300 font-bold transition-all flex items-center justify-center gap-1"
                        >
                            <Trash2 size={11} /> 立即联动清除
                        </button>
                    </div>
                ) : (
                    <>
                        {/* 🟢 TIER 1: 等待开仓队列 (浅绿色标记) - 4宫格核心量化 + 方案A折叠操作栏 */}
                        {currentTier === 'WAITING' && (
                            <div className="space-y-1.5">
                                {item.isTraded ? (
                                    <div className="bg-emerald-950/40 border border-emerald-500/50 p-1.5 rounded flex items-center justify-between text-[10px] text-emerald-300 font-bold">
                                        <div className="flex items-center gap-1.5">
                                            <CheckCircle2 size={13} className="text-emerald-400" />
                                            <span>已开仓 (持仓中)</span>
                                        </div>
                                        <div className="flex items-center gap-1 text-[9px] font-mono text-emerald-200 bg-emerald-900/50 px-1.5 py-0.5 rounded border border-emerald-500/30">
                                            <Clock size={10} />
                                            <span>{tradedCountdownStr} 后清除</span>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        {/* 4 宫格量化指标条 (2 x 2 紧凑网格) */}
                                        <div className="grid grid-cols-2 gap-1.5 text-[9px]">
                                            {/* 1. 进攻突破线 */}
                                            <div className="bg-slate-900/85 border border-emerald-500/25 rounded px-1.5 py-1 flex flex-col justify-between">
                                                <div className="flex items-center justify-between text-slate-400">
                                                    <span>进攻突破线</span>
                                                    <span className="font-mono text-slate-300 font-semibold">{m.entryTrigger ? formatPrice(m.entryTrigger) : '-'}</span>
                                                </div>
                                                <div className="flex items-center justify-between mt-0.5 pt-0.5 border-t border-slate-800/80">
                                                    <span className="text-[8px] text-slate-500">
                                                        设定: {config?.breakoutThreshold ?? 10}%
                                                    </span>
                                                    {isTriggered || diffToTrigger <= 0 ? (
                                                        <span className="text-emerald-400 font-bold font-mono">已达成 ✓</span>
                                                    ) : (
                                                        <span className="text-amber-400 font-bold font-mono">
                                                            差 {typeof diffToTrigger === 'number' && isFinite(diffToTrigger) ? diffToTrigger.toFixed(2) : '0.00'}%
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* 2. 前 NK 突破 */}
                                            <div className="bg-slate-900/85 border border-emerald-500/25 rounded px-1.5 py-1 flex flex-col justify-between">
                                                <div className="flex items-center justify-between text-slate-400">
                                                    <span>前 {kCount}K 突破</span>
                                                    <span className="font-mono text-slate-300 font-semibold">{hasTargetPrice ? formatPrice(targetNPrice) : '-'}</span>
                                                </div>
                                                <div className="flex items-center justify-between mt-0.5 pt-0.5 border-t border-slate-800/80">
                                                    <span className="text-[8px] text-slate-500">
                                                        设定: {kCount}根
                                                    </span>
                                                    {!config?.enableRev3K ? (
                                                        <span className="text-slate-400 font-mono">未启用 (免检)</span>
                                                    ) : !hasTargetPrice ? (
                                                        <span className="text-slate-400 font-mono text-[8px]">计算中...</span>
                                                    ) : is3KPassed ? (
                                                        <span className="text-emerald-400 font-bold font-mono">已突破 ✓</span>
                                                    ) : (
                                                        <span className="text-amber-400 font-bold font-mono">差 {diffToN.toFixed(2)}%</span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* 3. 5K 推进 */}
                                            <div className="bg-slate-900/85 border border-emerald-500/25 rounded px-1.5 py-1 flex flex-col justify-between">
                                                <div className="flex items-center justify-between text-slate-400">
                                                    <span>5K 推进</span>
                                                    <span className="font-mono text-slate-300 font-semibold">标 ≥{thrustThreshold}%</span>
                                                </div>
                                                <div className="flex items-center justify-between mt-0.5 pt-0.5 border-t border-slate-800/80">
                                                    <span className="text-[8px] text-slate-500">实测:</span>
                                                    {!config?.enableThrust ? (
                                                        <span className="text-slate-400 font-mono">未启用</span>
                                                    ) : !hasThrustData ? (
                                                        <span className="text-slate-400 font-mono text-[8px]">计算中...</span>
                                                    ) : thrustPass ? (
                                                        <span className="text-emerald-400 font-bold font-mono">+{actualThrust.toFixed(2)}% ✓</span>
                                                    ) : (
                                                        <span className="text-amber-400 font-bold font-mono">
                                                            {actualThrust.toFixed(2)}% (差 {thrustDiff.toFixed(2)}%)
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* 4. K 线寿命 */}
                                            <div className="bg-slate-900/85 border border-emerald-500/25 rounded px-1.5 py-1 flex flex-col justify-between">
                                                <div className="flex items-center justify-between text-slate-400">
                                                    <span>K线寿命</span>
                                                    <span className="font-mono text-slate-300">限 {list2Retention} 根</span>
                                                </div>
                                                <div className="flex items-center justify-between mt-0.5 pt-0.5 border-t border-slate-800/80">
                                                    <span className="text-[8px] text-slate-500">已走 {lagBars} 根</span>
                                                    <span className={`font-mono font-bold ${
                                                        remainingBars <= 1 ? 'text-amber-400 animate-pulse' : 
                                                        remainingBars <= 3 ? 'text-yellow-400' : 
                                                        'text-emerald-400'
                                                    }`}>
                                                        剩 {remainingBars} 根
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* 方案 A: 可折叠式手动开仓控制栏 */}
                                        <div className="pt-0.5">
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setIsActionExpanded(!isActionExpanded);
                                                }}
                                                className="w-full py-0.5 px-2 flex items-center justify-between text-[9px] text-slate-400 hover:text-emerald-300 transition-colors bg-slate-900/50 hover:bg-slate-800/70 rounded border border-slate-800/80"
                                                title="点击展开/收起手动开仓"
                                            >
                                                <span className="flex items-center gap-1 font-medium">
                                                    <Zap size={10} className={isTriggered ? "text-emerald-400 animate-pulse" : "text-amber-400"} />
                                                    <span>{isTriggered ? "突破已达成 (就绪)" : "手动开仓控制"}</span>
                                                </span>
                                                <span className="flex items-center gap-0.5 text-[8px] text-slate-400">
                                                    <span>{isActionExpanded ? '收起' : '展开'}</span>
                                                    {isActionExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                                                </span>
                                            </button>

                                            {isActionExpanded && (
                                                <div className="mt-1 animate-in fade-in duration-150">
                                                    <button 
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            const signalCandle = item.structure ? {
                                                                high: item.structure.signalHigh,
                                                                low: item.structure.signalLow,
                                                                close: item.structure.signalPrice,
                                                                open: item.structure.signalPrice,
                                                                amplitude: (item.structure.signalHigh - item.structure.signalLow) / item.structure.signalLow
                                                            } : undefined;
                                                            executeTradeSafe(item.symbol, item.direction as any, item.price, isRevived ? "L4 Revived Force" : "Manual L4 Force", tf, signalCandle);
                                                        }} 
                                                        className={`w-full py-1.5 rounded text-xs font-bold shadow-lg transition-all flex items-center justify-center gap-1.5 ${
                                                            isTriggered 
                                                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/40 cursor-pointer animate-pulse' 
                                                            : isRevived
                                                                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/40 cursor-pointer animate-pulse'
                                                                : 'bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 border border-emerald-500/40'
                                                        }`}
                                                        disabled={isInvalid}
                                                    >
                                                        {isTriggered ? <Zap size={12} fill="currentColor"/> : isRevived ? <Sparkles size={12} fill="currentColor"/> : <Lock size={12}/>}
                                                        {isTriggered ? '确认离弦信号：立即部署' : isRevived ? '已复活：立即开仓' : '手动开仓执行 (Manual Force)'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* 🟠 TIER 3: 破中轴休眠待复活 (深黄色标记) */}
                        {currentTier === 'DORMANT' && (
                            <div className="space-y-1.5">
                                <div className="bg-yellow-950/40 border border-yellow-600/40 p-2 rounded text-center space-y-1">
                                    <div className="flex items-center justify-center gap-1.5 text-yellow-400 text-[10px] font-bold">
                                        <Moon size={13} className="text-yellow-400" />
                                        <span>破中轴休眠观察中 (待复活)</span>
                                    </div>
                                    <div className="text-[9px] text-yellow-300/80">
                                        距重新突破高点复活还差: <span className="font-mono font-bold text-yellow-200">{typeof diffToTrigger === 'number' && isFinite(diffToTrigger) ? diffToTrigger.toFixed(2) : '0.00'}%</span>
                                    </div>
                                    <div className="text-[8px] text-yellow-400/60">
                                        复活后将自动恢复为正常状态 (浅绿色标记) 并移入上方等待开仓队列
                                    </div>
                                </div>

                                {m.invalidReason && (
                                    <div className="text-[9px] text-center leading-tight text-yellow-400/80 font-medium">
                                        {m.invalidReason}
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-2 text-[9px]">
                                    <div className="p-1.5 rounded border bg-yellow-950/30 border-yellow-600/30">
                                        <span className="text-slate-400 block mb-0.5">中轴已破 (休眠)</span>
                                        <span className="font-mono font-bold text-yellow-400/80">{m.midPoint ? formatPrice(m.midPoint) : '-'}</span>
                                    </div>
                                    <div className="p-1.5 rounded border bg-slate-900/80 border-slate-700">
                                        <span className="text-slate-400 block mb-0.5">复活目标A (原基准)</span>
                                        <span className="font-mono font-bold text-slate-300">{m.entryTrigger ? formatPrice(m.entryTrigger) : '-'}</span>
                                    </div>
                                </div>

                                <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const signalCandle = item.structure ? {
                                            high: item.structure.signalHigh,
                                            low: item.structure.signalLow,
                                            close: item.structure.signalPrice,
                                            open: item.structure.signalPrice,
                                            amplitude: (item.structure.signalHigh - item.structure.signalLow) / item.structure.signalLow
                                        } : undefined;
                                        executeTradeSafe(item.symbol, item.direction as any, item.price, "Manual L4 Dormant Force", tf, signalCandle);
                                    }} 
                                    className="w-full py-1.5 rounded text-xs font-bold shadow-lg transition-all flex items-center justify-center gap-1.5 bg-slate-800/80 hover:bg-slate-800 text-yellow-500/70 border border-yellow-600/30"
                                >
                                    <Moon size={12}/>
                                    休眠期：等待重新破高复活
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

// PERFORMANCE OPTIMIZATION: Only re-render if critical status changes, callback reference changes, or price moves significantly
export const List4Item = React.memo(List4ItemComponent, (prev, next) => {
    if (prev.item.symbol !== next.item.symbol) return false;
    if (prev.tier !== next.tier) return false;
    if (prev.item.momentum?.status !== next.item.momentum?.status) return false;
    if (prev.item.fuseBlocked !== next.item.fuseBlocked) return false;
    if (prev.item.isTraded !== next.item.isTraded) return false;
    if (prev.item.fuseEnteredAt !== next.item.fuseEnteredAt) return false;
    if (prev.item.tradedAt !== next.item.tradedAt) return false;
    if (prev.executeTradeSafe !== next.executeTradeSafe) return false;
    
    const priceDiff = Math.abs(prev.item.price - next.item.price);
    const pctDiff = (priceDiff / prev.item.price) * 100;
    if (pctDiff > 0.1) return false;

    return true;
});
