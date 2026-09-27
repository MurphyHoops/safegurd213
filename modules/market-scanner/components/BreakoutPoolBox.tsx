
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ScanConfig, BreakoutFilterConfig } from '../../../components/Scanner/scannerTypes';
import { ChevronDown, ChevronUp, Copy, Check, Search, Zap, RefreshCw, Layers, Sliders, Activity, Loader2, Info, Timer, ShieldCheck, Gauge } from 'lucide-react';
import { usePersistedState } from '../../../hooks/usePersistedState';
import { SmartNumberInput } from '../../../components/Scanner/ScannerUIHelpers';
import { DEFAULT_BREAKOUT_CONFIG, BreakoutAuditItem, batchAuditBreakout } from '../../../services/rules/list1_breakout';

interface Props {
    scanConfig: ScanConfig;
    setScanConfig: React.Dispatch<React.SetStateAction<ScanConfig>>;
    candidateSymbols?: string[];
}

export const BreakoutPoolBox: React.FC<Props> = ({ scanConfig, setScanConfig, candidateSymbols }) => {
    const [isCollapsed, setIsCollapsed] = usePersistedState<boolean>('SCANNER_BREAKOUT_BOX_COLLAPSED', false);
    const [searchTerm, setSearchTerm] = useState('');
    const [copied, setCopied] = useState(false);
    const [isAuditing, setIsAuditing] = useState(false);
    const [auditProgress, setAuditProgress] = useState<{ current: number; total: number; curSym: string } | null>(null);
    const [pool, setPool] = usePersistedState<string[]>('SCANNER_BREAKOUT_FILTERED_POOL', []);
    const [auditDetails, setAuditDetails] = usePersistedState<Record<string, BreakoutAuditItem>>('SCANNER_BREAKOUT_AUDIT_DETAILS', {});
    const isMountedRef = useRef(true);

    const config: BreakoutFilterConfig = useMemo(() => {
        return {
            ...DEFAULT_BREAKOUT_CONFIG,
            ...(scanConfig.breakoutFilter || scanConfig.majorTrend?.breakoutFilter || {})
        };
    }, [scanConfig.breakoutFilter, scanConfig.majorTrend?.breakoutFilter]);

    const updateConfig = (updater: (prev: BreakoutFilterConfig) => BreakoutFilterConfig) => {
        const next = updater(config);
        setScanConfig(p => ({
            ...p,
            breakoutFilter: next,
            majorTrend: p.majorTrend ? { ...p.majorTrend, breakoutFilter: next } : p.majorTrend
        }));
    };

    // 监听本地存储与事件同步
    useEffect(() => {
        isMountedRef.current = true;
        const handlePoolUpdated = () => {
            try {
                const raw = localStorage.getItem('SCANNER_BREAKOUT_FILTERED_POOL');
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) {
                        setPool(parsed);
                    }
                }
            } catch (_) {}
        };

        window.addEventListener('scanner_breakout_pool_updated', handlePoolUpdated);
        return () => {
            isMountedRef.current = false;
            window.removeEventListener('scanner_breakout_pool_updated', handlePoolUpdated);
        };
    }, [setPool]);

    // 核心自动/手动审计执行逻辑
    const runAudit = async (symbolsToAudit?: string[]) => {
        if (isAuditing) return;

        // 获取待审计输入源：回溯周期过滤底池 -> 横盘蓄势底池 -> 启动底池
        let targetSymbols = symbolsToAudit;
        if (!targetSymbols || targetSymbols.length === 0) {
            try {
                const rawLookback = localStorage.getItem('SCANNER_MAJOR_TREND_CANDIDATES');
                const parsedLookback = rawLookback ? JSON.parse(rawLookback) : [];
                if (Array.isArray(parsedLookback) && parsedLookback.length > 0) {
                    targetSymbols = parsedLookback.map(s => s.replace(/_LONG$|_SHORT$/i, '').trim());
                } else {
                    const rawSideways = localStorage.getItem('SCANNER_SIDEWAYS_FILTERED_POOL');
                    const parsedSideways = rawSideways ? JSON.parse(rawSideways) : [];
                    if (Array.isArray(parsedSideways) && parsedSideways.length > 0) {
                        targetSymbols = parsedSideways.map((p: any) => p.symbol);
                    } else {
                        const rawStart = localStorage.getItem('SCANNER_START_TREND_POOL');
                        const parsedStart = rawStart ? JSON.parse(rawStart) : [];
                        if (Array.isArray(parsedStart) && parsedStart.length > 0) {
                            targetSymbols = parsedStart.map((p: any) => p.symbol);
                        }
                    }
                }
            } catch (_) {}
        }

        if (!targetSymbols || targetSymbols.length === 0) {
            targetSymbols = candidateSymbols || [];
        }

        if (targetSymbols.length === 0) {
            return;
        }

        setIsAuditing(true);
        setAuditProgress({ current: 0, total: targetSymbols.length, curSym: targetSymbols[0] });

        try {
            const { passed, details } = await batchAuditBreakout(
                targetSymbols,
                config,
                (cur, tot, sym) => {
                    if (isMountedRef.current) {
                        setAuditProgress({ current: cur, total: tot, curSym: sym });
                    }
                }
            );

            if (isMountedRef.current) {
                setPool(passed);
                setAuditDetails(details);
                localStorage.setItem('SCANNER_BREAKOUT_FILTERED_POOL', JSON.stringify(passed));
                localStorage.setItem('SCANNER_BREAKOUT_AUDIT_DETAILS', JSON.stringify(details));
                window.dispatchEvent(new CustomEvent('scanner_breakout_pool_updated', { detail: passed }));
            }
        } catch (e) {
            console.error("[BreakoutPoolBox] Audit failed:", e);
        } finally {
            if (isMountedRef.current) {
                setIsAuditing(false);
                setAuditProgress(null);
            }
        }
    };

    // 当输入底池更新且本功能开启时，自动触发审计
    useEffect(() => {
        if (!config.enabled) return;

        const handleUpstreamUpdate = () => {
            runAudit();
        };

        window.addEventListener('scanner_major_trend_candidates_updated', handleUpstreamUpdate);
        window.addEventListener('scanner_sideways_pool_updated', handleUpstreamUpdate);
        window.addEventListener('scanner_start_trend_pool_updated', handleUpstreamUpdate);

        return () => {
            window.removeEventListener('scanner_major_trend_candidates_updated', handleUpstreamUpdate);
            window.removeEventListener('scanner_sideways_pool_updated', handleUpstreamUpdate);
            window.removeEventListener('scanner_start_trend_pool_updated', handleUpstreamUpdate);
        };
    }, [config.enabled, config]);

    const stats = useMemo(() => {
        const items = Object.values(auditDetails);
        let squeezePassedCount = 0;
        let volumePassedCount = 0;
        let momentumPassedCount = 0;
        items.forEach(it => {
            if (it.squeezePassed) squeezePassedCount++;
            if (it.volumePassed) volumePassedCount++;
            if (it.adxPassed && it.tfResonancePassed) momentumPassedCount++;
        });
        return {
            totalScanned: items.length,
            squeezePassedCount,
            volumePassedCount,
            momentumPassedCount,
            finalPoolCount: pool.length
        };
    }, [auditDetails, pool]);

    const displayItems = useMemo(() => {
        const allSyms = Object.keys(auditDetails);
        const term = searchTerm.trim().toUpperCase();
        return allSyms
            .filter(sym => !term || sym.includes(term))
            .map(sym => auditDetails[sym])
            .filter(Boolean);
    }, [auditDetails, searchTerm]);

    const handleCopy = () => {
        if (pool.length === 0) return;
        const text = pool.join(', ');
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => {
            if (isMountedRef.current) setCopied(false);
        }, 1500);
    };

    return (
        <div className={`border rounded-lg p-2.5 flex flex-col gap-2 transition-all duration-300 select-none ${
            config.enabled 
                ? 'bg-[#151c28] border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.15)]' 
                : 'bg-[#1a1f26] border-slate-700/80 opacity-90'
        }`}>
            {/* Header: Title, Master Switch, Count, Collapse */}
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                <div 
                    className="flex items-center gap-2 cursor-pointer"
                    onClick={() => setIsCollapsed(!isCollapsed)}
                >
                    <div className={`p-1 rounded border transition-colors ${
                        config.enabled 
                            ? 'bg-amber-950/60 border-amber-500/40 text-amber-400' 
                            : 'bg-slate-800 border-slate-700 text-slate-400'
                    }`}>
                        <Zap size={13} className={config.enabled ? 'fill-amber-400/20' : ''} />
                    </div>
                    <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-amber-300">4. 趋势爆发综合过滤</span>
                            <span className="text-[9px] text-slate-400 font-mono">
                                (蓄势+爆量+动能)
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* Passed Pool Count */}
                    <span className="bg-amber-950 text-amber-300 border border-amber-800/60 font-mono text-[9px] font-bold px-1.5 py-0.5 rounded shadow-inner">
                        {pool.length} 个爆发币
                    </span>

                    {/* Master Switch Button */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            updateConfig(p => ({ ...p, enabled: !p.enabled }));
                        }}
                        className={`px-2 py-0.5 rounded text-[9px] font-bold transition-all flex items-center gap-1 ${
                            config.enabled 
                                ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-[0_0_8px_rgba(245,158,11,0.4)]' 
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700'
                        }`}
                        title={config.enabled ? "点击关闭趋势爆发综合过滤" : "点击启用趋势爆发综合过滤"}
                    >
                        <span className={`w-1.5 h-1.5 rounded-full ${config.enabled ? 'bg-white animate-pulse' : 'bg-slate-500'}`} />
                        <span>{config.enabled ? '运行中' : '未启用'}</span>
                    </button>

                    {/* Manual Audit Refresh Button */}
                    <button
                        onClick={() => runAudit()}
                        disabled={isAuditing}
                        className="bg-slate-800 hover:bg-slate-700 text-amber-400 disabled:opacity-40 p-1 rounded transition-colors"
                        title="立即触发爆发审计扫描"
                    >
                        <RefreshCw size={11} className={isAuditing ? 'animate-spin text-amber-400' : ''} />
                    </button>

                    {/* Copy All */}
                    <button
                        onClick={handleCopy}
                        disabled={pool.length === 0}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 p-1 rounded transition-colors"
                        title="复制爆发合格底池所有币种"
                    >
                        {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                    </button>

                    {/* Collapse Toggle */}
                    <button
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        className="text-slate-400 hover:text-white p-0.5"
                    >
                        {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                    </button>
                </div>
            </div>

            {/* Collapsible Content */}
            {!isCollapsed && (
                <div className="space-y-2.5 pt-1">
                    {/* 🔀 综合判定逻辑模式选择栏 (OR 模式 / AND 模式) */}
                    <div className="bg-slate-900/90 border border-slate-800 rounded p-2 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                            <Sliders size={12} className="text-amber-400" />
                            <span className="text-[10px] font-bold text-slate-200">多规则判定逻辑:</span>
                            <span className="text-[8.5px] text-slate-400">
                                {(config.combinationMode || 'OR') === 'OR' ? '（3轮独立扫描去重合并放行）' : '（必须全部满足开启规则）'}
                            </span>
                        </div>
                        <div className="flex items-center bg-slate-950 p-0.5 rounded border border-slate-800">
                            <button
                                onClick={() => updateConfig(p => ({ ...p, combinationMode: 'OR' }))}
                                className={`px-2 py-0.5 rounded text-[8.5px] font-bold transition-all ${
                                    (config.combinationMode || 'OR') === 'OR'
                                        ? 'bg-amber-600 text-white shadow-[0_0_8px_rgba(245,158,11,0.3)]'
                                        : 'text-slate-400 hover:text-slate-200'
                                }`}
                                title="3轮独立扫描去重模式 (OR 并集)：分别扫描空间蓄势、突破放量、动能共振，去重合并后进入市场初筛"
                            >
                                满足任一 (OR)
                            </button>
                            <button
                                onClick={() => updateConfig(p => ({ ...p, combinationMode: 'AND' }))}
                                className={`px-2 py-0.5 rounded text-[8.5px] font-bold transition-all ${
                                    config.combinationMode === 'AND'
                                        ? 'bg-cyan-600 text-white shadow-[0_0_8px_rgba(6,182,212,0.3)]'
                                        : 'text-slate-400 hover:text-slate-200'
                                }`}
                                title="与模式 (AND)：必须同时满足所有已开启的维度条件"
                            >
                                全部满足 (AND)
                            </button>
                        </div>
                    </div>

                    {/* ⏱️ 扫描步进节奏控制栏 (1秒1币 / 防封防漏) */}
                    <div className="bg-slate-900/90 border border-slate-800 rounded p-2 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                            <Timer size={12} className="text-emerald-400" />
                            <span className="text-[10px] font-bold text-slate-200">扫描步进节奏:</span>
                            <span className="text-[8.5px] text-slate-400 font-mono">
                                {((config.scanDelayMs ?? 1000) / 1000).toFixed(1)}s/币
                            </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="flex items-center bg-slate-950 p-0.5 rounded border border-slate-800">
                                {[
                                    { label: '1.0s/币', ms: 1000, title: '推荐：1秒1币稳健扫描，100%防超频防漏币' },
                                    { label: '0.5s/币', ms: 500, title: '平衡：半秒1币' },
                                    { label: '0.2s/币', ms: 200, title: '快速：0.2秒1币' },
                                    { label: '极速 0s', ms: 0, title: '极速：无延时瞬间并发扫描' }
                                ].map(opt => (
                                    <button
                                        key={opt.ms}
                                        onClick={() => updateConfig(p => ({ ...p, scanDelayMs: opt.ms }))}
                                        className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-all ${
                                            (config.scanDelayMs ?? 1000) === opt.ms
                                                ? 'bg-emerald-600 text-white shadow-[0_0_6px_rgba(16,185,129,0.4)]'
                                                : 'text-slate-400 hover:text-slate-200'
                                        }`}
                                        title={opt.title}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                            <div className="w-16">
                                <SmartNumberInput
                                    value={Number(((config.scanDelayMs ?? 1000) / 1000).toFixed(1))}
                                    onChange={val => updateConfig(p => ({ ...p, scanDelayMs: Math.max(0, Math.round(val * 1000)) }))}
                                    step={0.1}
                                    min={0}
                                    max={10}
                                    suffix="s"
                                    className="bg-slate-950 border-slate-700 text-emerald-400 font-mono text-[9px] h-5 px-1 text-center"
                                />
                            </div>
                        </div>
                    </div>

                    {/* 🚀 实时扫描状态与平稳进度条 (扫描中时显式展示) */}
                    {isAuditing && auditProgress && (
                        <div className="bg-emerald-950/40 border border-emerald-500/40 rounded p-2 flex flex-col gap-1.5 shadow-[0_0_12px_rgba(16,185,129,0.15)] animate-fadeIn">
                            <div className="flex items-center justify-between text-[9px]">
                                <div className="flex items-center gap-1.5">
                                    <Loader2 size={11} className="animate-spin text-emerald-400" />
                                    <span className="font-bold text-emerald-300">
                                        正在逐币深度审计 ({auditProgress.current}/{auditProgress.total})
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="font-mono text-amber-300 font-bold bg-slate-950/80 px-1.5 py-0.5 rounded border border-amber-900/60">
                                        {auditProgress.curSym}
                                    </span>
                                    <span className="text-emerald-400 font-mono font-bold">
                                        {Math.round((auditProgress.current / Math.max(1, auditProgress.total)) * 100)}%
                                    </span>
                                </div>
                            </div>
                            {/* Progress bar line */}
                            <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-emerald-900/60">
                                <div 
                                    className="bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 h-full transition-all duration-300 rounded-full"
                                    style={{ width: `${Math.round((auditProgress.current / Math.max(1, auditProgress.total)) * 100)}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* 📊 3轮独立扫描命中情况与去重底池统计条 */}
                    <div className="grid grid-cols-4 gap-1.5 text-[8.5px] font-mono">
                        <div className="bg-slate-900/90 border border-slate-800 rounded px-2 py-1 flex items-center justify-between">
                            <span className="text-cyan-400">① 蓄势命中:</span>
                            <span className="font-bold text-cyan-300">{stats.squeezePassedCount}</span>
                        </div>
                        <div className="bg-slate-900/90 border border-slate-800 rounded px-2 py-1 flex items-center justify-between">
                            <span className="text-amber-400">② 放量命中:</span>
                            <span className="font-bold text-amber-300">{stats.volumePassedCount}</span>
                        </div>
                        <div className="bg-slate-900/90 border border-slate-800 rounded px-2 py-1 flex items-center justify-between">
                            <span className="text-emerald-400">③ 共振命中:</span>
                            <span className="font-bold text-emerald-300">{stats.momentumPassedCount}</span>
                        </div>
                        <div className="bg-amber-950/50 border border-amber-800/60 rounded px-2 py-1 flex items-center justify-between">
                            <span className="text-amber-300 font-bold">去重汇总:</span>
                            <span className="font-bold text-amber-400">{stats.finalPoolCount} 币</span>
                        </div>
                    </div>

                    {/* Dimension 1: 空间极致蓄势 (Squeeze 波动率压缩) */}
                    <div className="bg-slate-900/80 border border-slate-800 rounded p-2 flex flex-col gap-2">
                        <div className="flex items-center justify-between border-b border-slate-800/60 pb-1">
                            <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                                <span className="text-[10px] font-bold text-slate-200">① 空间极致蓄势 (Squeeze 压缩)</span>
                            </div>
                            <button
                                onClick={() => updateConfig(p => ({ ...p, enableSqueeze: !p.enableSqueeze }))}
                                className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-all ${
                                    config.enableSqueeze ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60' : 'bg-slate-800 text-slate-500'
                                }`}
                            >
                                {config.enableSqueeze ? '开启' : '关闭'}
                            </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[9px]">
                            <div className="flex items-center justify-between bg-black/20 px-2 py-1 rounded border border-slate-800/40">
                                <span className="text-slate-400">布林带宽 (BBW) &le;</span>
                                <div className="flex items-center gap-1">
                                    <SmartNumberInput
                                        value={config.maxBbwPercent}
                                        onChange={v => updateConfig(p => ({ ...p, maxBbwPercent: v }))}
                                        className="w-9 bg-slate-950 border border-slate-700 rounded text-center text-cyan-300 font-bold"
                                    />
                                    <span className="text-slate-500">%</span>
                                </div>
                            </div>

                            <div className="flex items-center justify-between bg-black/20 px-2 py-1 rounded border border-slate-800/40">
                                <span className="text-slate-400">KC 通道挤压 (Squeeze)</span>
                                <button
                                    onClick={() => updateConfig(p => ({ ...p, requireSqueezeInKc: !p.requireSqueezeInKc }))}
                                    className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${
                                        config.requireSqueezeInKc ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-500'
                                    }`}
                                >
                                    {config.requireSqueezeInKc ? '强制要求' : '仅看带宽'}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Dimension 2: 突破点火放量 (Volume & Breakout) */}
                    <div className="bg-slate-900/80 border border-slate-800 rounded p-2 flex flex-col gap-2">
                        <div className="flex items-center justify-between border-b border-slate-800/60 pb-1">
                            <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                <span className="text-[10px] font-bold text-slate-200">② 突破点火放量 (Volume & 破位)</span>
                            </div>
                            <button
                                onClick={() => updateConfig(p => ({ ...p, enableVolumeSpike: !p.enableVolumeSpike }))}
                                className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-all ${
                                    config.enableVolumeSpike ? 'bg-amber-950 text-amber-300 border border-amber-800/60' : 'bg-slate-800 text-slate-500'
                                }`}
                            >
                                {config.enableVolumeSpike ? '开启' : '关闭'}
                            </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[9px]">
                            <div className="flex items-center justify-between bg-black/20 px-2 py-1 rounded border border-slate-800/40">
                                <span className="text-slate-400">成交量放量 &ge;</span>
                                <div className="flex items-center gap-1">
                                    <SmartNumberInput
                                        value={config.volMultiplier}
                                        onChange={v => updateConfig(p => ({ ...p, volMultiplier: v }))}
                                        className="w-9 bg-slate-950 border border-slate-700 rounded text-center text-amber-300 font-bold"
                                    />
                                    <span className="text-slate-500">x 均量</span>
                                </div>
                            </div>

                            <div className="flex items-center justify-between bg-black/20 px-2 py-1 rounded border border-slate-800/40">
                                <span className="text-slate-400">突破模式</span>
                                <select
                                    value={config.breakoutMode}
                                    onChange={e => updateConfig(p => ({ ...p, breakoutMode: e.target.value as any }))}
                                    className="bg-slate-950 text-amber-300 border border-slate-700 rounded px-1 py-0.5 text-[8px] font-bold outline-none"
                                >
                                    <option value="BB_BANDS">破布林上下轨</option>
                                    <option value="EXTREME_K">破近20根极值</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Dimension 3: 动能爆发与多周期共振 (ADX & Multi-TF) */}
                    <div className="bg-slate-900/80 border border-slate-800 rounded p-2 flex flex-col gap-2">
                        <div className="flex items-center justify-between border-b border-slate-800/60 pb-1">
                            <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                <span className="text-[10px] font-bold text-slate-200">③ 动能爆发与多周期共振 (ADX & EMA)</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => updateConfig(p => ({ ...p, enableAdx: !p.enableAdx }))}
                                    className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-all ${
                                        config.enableAdx ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60' : 'bg-slate-800 text-slate-500'
                                    }`}
                                >
                                    ADX: {config.enableAdx ? '开' : '关'}
                                </button>
                                <button
                                    onClick={() => updateConfig(p => ({ ...p, enableMultiTfResonance: !p.enableMultiTfResonance }))}
                                    className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-all ${
                                        config.enableMultiTfResonance ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60' : 'bg-slate-800 text-slate-500'
                                    }`}
                                >
                                    共振: {config.enableMultiTfResonance ? '开' : '关'}
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[9px]">
                            <div className="flex items-center justify-between bg-black/20 px-2 py-1 rounded border border-slate-800/40">
                                <span className="text-slate-400">ADX(14) 阈值 &ge;</span>
                                <div className="flex items-center gap-1">
                                    <SmartNumberInput
                                        value={config.minAdx}
                                        onChange={v => updateConfig(p => ({ ...p, minAdx: v }))}
                                        className="w-9 bg-slate-950 border border-slate-700 rounded text-center text-emerald-300 font-bold"
                                    />
                                    <span className="text-slate-500">点</span>
                                </div>
                            </div>

                            <div className="flex items-center justify-between bg-black/20 px-2 py-1 rounded border border-slate-800/40">
                                <span className="text-slate-400">共振周期组合</span>
                                <div className="flex items-center gap-1">
                                    <select
                                        value={config.primaryTf}
                                        onChange={e => updateConfig(p => ({ ...p, primaryTf: e.target.value as any }))}
                                        className="bg-slate-950 text-emerald-300 border border-slate-700 rounded px-1 text-[8px] font-bold outline-none"
                                    >
                                        <option value="1m">1M</option>
                                        <option value="3m">3M</option>
                                        <option value="5m">5M</option>
                                        <option value="15m">15M</option>
                                    </select>
                                    <span className="text-slate-500">+</span>
                                    <select
                                        value={config.confirmTf}
                                        onChange={e => updateConfig(p => ({ ...p, confirmTf: e.target.value as any }))}
                                        className="bg-slate-950 text-emerald-300 border border-slate-700 rounded px-1 text-[8px] font-bold outline-none"
                                    >
                                        <option value="15m">15M</option>
                                        <option value="30m">30M</option>
                                        <option value="1h">1H</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Progress Indicator */}
                    {isAuditing && auditProgress && (
                        <div className="bg-amber-950/40 border border-amber-500/30 rounded p-1.5 flex items-center justify-between text-[9px] text-amber-300 animate-pulse">
                            <div className="flex items-center gap-1.5">
                                <Loader2 size={11} className="animate-spin text-amber-400" />
                                <span>爆发审计中: {auditProgress.curSym} ({auditProgress.current}/{auditProgress.total})</span>
                            </div>
                            <span className="font-mono">{Math.round((auditProgress.current / auditProgress.total) * 100)}%</span>
                        </div>
                    )}

                    {/* Live Diagnostic Table / Audited Pool List */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1 text-[9px] text-slate-400 font-bold">
                                <Activity size={10} className="text-amber-400" />
                                <span>实时审计诊断看板 ({displayItems.length})</span>
                            </div>
                            <div className="relative w-28">
                                <input
                                    type="text"
                                    placeholder="搜索币种..."
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 text-[8px] text-slate-200 placeholder-slate-600 outline-none"
                                />
                            </div>
                        </div>

                        {displayItems.length === 0 ? (
                            <div className="p-3 text-center text-[9px] text-slate-500 bg-slate-900/50 rounded border border-slate-800/40">
                                {isAuditing ? '正在执行爆发审计计算...' : '暂无审计数据 (点击右上角刷新按钮触发扫描)'}
                            </div>
                        ) : (
                            <div className="max-h-44 overflow-y-auto space-y-1 pr-0.5 custom-scrollbar">
                                {displayItems.map(item => (
                                    <div
                                        key={item.symbol}
                                        className={`p-1.5 rounded border text-[8.5px] flex items-center justify-between transition-colors ${
                                            item.isPassed
                                                ? 'bg-amber-950/30 border-amber-500/40 text-amber-200'
                                                : 'bg-slate-900/40 border-slate-800/60 text-slate-400'
                                        }`}
                                    >
                                        {/* Left: Symbol & Status Tag */}
                                        <div className="flex items-center gap-1.5 w-28 truncate">
                                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.isPassed ? 'bg-amber-400 animate-ping' : 'bg-slate-600'}`} />
                                            <span className="font-bold font-mono text-slate-200">{item.symbol.replace('/USDT', '')}</span>
                                            {item.isPassed && (
                                                <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[7px] px-1 rounded font-bold">
                                                    爆发
                                                </span>
                                            )}
                                        </div>

                                        {/* Center: Metrics Grid */}
                                        <div className="flex items-center gap-2 font-mono text-[8px]">
                                            <span title="布林带宽 (BBW)" className={item.squeezePassed ? 'text-cyan-300' : 'text-slate-500'}>
                                                BBW:{item.bbwPct}%
                                            </span>
                                            <span title="量比 (Volume Ratio)" className={item.volumePassed ? 'text-amber-300' : 'text-slate-500'}>
                                                量:{item.volRatio}x
                                            </span>
                                            <span title="ADX 动能" className={item.adxPassed ? 'text-emerald-300' : 'text-slate-500'}>
                                                ADX:{item.adxValue}
                                            </span>
                                        </div>

                                        {/* Right: Pass or Fail Reason */}
                                        <div className="w-32 text-right truncate text-[7.5px]">
                                            {item.isPassed ? (
                                                <span className="text-emerald-400 font-bold" title={`命中条件: ${item.matchedRules?.join('、') || '符合规则'}`}>
                                                    🚀 {item.matchedRules && item.matchedRules.length > 0 ? item.matchedRules.join('+') : '完美命中'}
                                                </span>
                                            ) : (
                                                <span className="text-slate-500" title={item.failReasons.join(' | ')}>
                                                    {item.failReasons[0] || '未达标'}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
