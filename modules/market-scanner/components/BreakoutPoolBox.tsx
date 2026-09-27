
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ScanConfig, BreakoutFilterConfig } from '../../../components/Scanner/scannerTypes';
import { ChevronDown, ChevronUp, Copy, Check, Search, Zap, RefreshCw, Sliders, Activity, Loader2, Timer, ArrowRight, Play, CheckCircle2, ShieldCheck, Flame } from 'lucide-react';
import { usePersistedState } from '../../../hooks/usePersistedState';
import { SmartNumberInput } from '../../../components/Scanner/ScannerUIHelpers';
import { DEFAULT_BREAKOUT_CONFIG, BreakoutAuditItem, auditSymbolBreakout } from '../../../services/rules/list1_breakout';

interface Props {
    scanConfig: ScanConfig;
    setScanConfig: React.Dispatch<React.SetStateAction<ScanConfig>>;
    candidateSymbols?: string[];
}

export const BreakoutPoolBox: React.FC<Props> = ({ scanConfig, setScanConfig, candidateSymbols }) => {
    const [isCollapsed, setIsCollapsed] = usePersistedState<boolean>('SCANNER_BREAKOUT_BOX_COLLAPSED', false);
    const [searchTerm, setSearchTerm] = useState('');
    const [copied, setCopied] = useState(false);
    
    // 🔄 单币三项并发流水线状态
    const [isLoopRunning, setIsLoopRunning] = useState(false);
    const [auditProgress, setAuditProgress] = useState<{ 
        current: number; 
        total: number; 
        curSym: string;
        curSqueezePassed?: boolean;
        curVolumePassed?: boolean;
        curMomentumPassed?: boolean;
        curPassed?: boolean;
    } | null>(null);
    
    // 三维度各自命中的底池与计数
    const [step1Passed, setStep1Passed] = usePersistedState<string[]>('SCANNER_BREAKOUT_STEP1_PASSED', []);
    const [step2Passed, setStep2Passed] = usePersistedState<string[]>('SCANNER_BREAKOUT_STEP2_PASSED', []);
    const [step3Passed, setStep3Passed] = usePersistedState<string[]>('SCANNER_BREAKOUT_STEP3_PASSED', []);

    // 最终去重合并池 & 诊断明细 (全部筛选完毕后原子差量更新)
    const [pool, setPool] = usePersistedState<string[]>('SCANNER_BREAKOUT_FILTERED_POOL', []);
    const [auditDetails, setAuditDetails] = usePersistedState<Record<string, BreakoutAuditItem>>('SCANNER_BREAKOUT_AUDIT_DETAILS', {});
    
    const isMountedRef = useRef(true);
    const loopAbortControllerRef = useRef<AbortController | null>(null);

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

    // 获取上游输入候选底池
    const getTargetSymbols = (): string[] => {
        let targetSymbols: string[] = [];
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
                    } else {
                        const rawVol = localStorage.getItem('SCANNER_VOLUME_FILTERED_POOL');
                        const parsedVol = rawVol ? JSON.parse(rawVol) : [];
                        if (Array.isArray(parsedVol) && parsedVol.length > 0) {
                            targetSymbols = parsedVol.map((p: any) => p.symbol || p);
                        }
                    }
                }
            }
        } catch (_) {}

        if (targetSymbols.length === 0 && candidateSymbols && candidateSymbols.length > 0) {
            targetSymbols = candidateSymbols;
        }

        // 去重并确保格式标准
        return Array.from(new Set(targetSymbols.filter(Boolean)));
    };

    // 🔄 核心：单币三项并发 · 1秒1币稳健巡检 · 满足任一即入池 · 批次完成后原子差量更新
    useEffect(() => {
        if (!config.enabled) {
            if (loopAbortControllerRef.current) {
                loopAbortControllerRef.current.abort();
                loopAbortControllerRef.current = null;
            }
            setIsLoopRunning(false);
            setAuditProgress(null);
            return;
        }

        const abortController = new AbortController();
        loopAbortControllerRef.current = abortController;
        const signal = abortController.signal;

        const sleep = (ms: number) => new Promise(resolve => {
            const t = setTimeout(resolve, ms);
            signal.addEventListener('abort', () => {
                clearTimeout(t);
                resolve(null);
            }, { once: true });
        });

        const runConcurrentAuditLoop = async () => {
            setIsLoopRunning(true);

            while (!signal.aborted && isMountedRef.current) {
                const targetSymbols = getTargetSymbols();
                if (targetSymbols.length === 0) {
                    // 若无待测币种，等待 2 秒后重试
                    await sleep(2000);
                    continue;
                }

                const total = targetSymbols.length;
                const delayMs = config.scanDelayMs ?? 1000;

                // 本轮独立累积的命中池
                const batchStep1Passed: string[] = [];
                const batchStep2Passed: string[] = [];
                const batchStep3Passed: string[] = [];
                const batchFinalPool: string[] = [];

                for (let i = 0; i < targetSymbols.length; i++) {
                    if (signal.aborted || !isMountedRef.current) break;
                    const sym = targetSymbols[i];
                    const coinStartTime = Date.now();

                    // 1. 实时进度展示（标记当前正在深度判研的币种代码）
                    setAuditProgress({ 
                        current: i + 1, 
                        total, 
                        curSym: sym,
                        curSqueezePassed: undefined,
                        curVolumePassed: undefined,
                        curMomentumPassed: undefined,
                        curPassed: undefined
                    });

                    // 2. 核心：单币同时运行三项过滤 (多周期K线并行极速直通，~50ms内完成判定)
                    const res = await auditSymbolBreakout(sym, {
                        ...config,
                        enableSqueeze: config.enableSqueeze,
                        enableVolumeSpike: config.enableVolumeSpike,
                        enableAdx: config.enableAdx,
                        enableMultiTfResonance: config.enableMultiTfResonance,
                        combinationMode: config.combinationMode || 'OR' // 宽松 OR 容差或 AND
                    }, signal);

                    const squeezeHit = Boolean(res.squeezePassed);
                    const volumeHit = Boolean(res.volumePassed);
                    const momentumHit = Boolean((!config.enableAdx || res.adxPassed) && (!config.enableMultiTfResonance || res.tfResonancePassed));
                    
                    if (squeezeHit) batchStep1Passed.push(sym);
                    if (volumeHit) batchStep2Passed.push(sym);
                    if (momentumHit) batchStep3Passed.push(sym);

                    // 只要符合开启条件中的任一个（默认 OR 模式），即判定为合格放入底池
                    if (res.isPassed) {
                        batchFinalPool.push(sym);
                    }

                    // 实时高亮当前币的实时判定结果
                    setAuditProgress({
                        current: i + 1,
                        total,
                        curSym: sym,
                        curSqueezePassed: squeezeHit,
                        curVolumePassed: volumeHit,
                        curMomentumPassed: momentumHit,
                        curPassed: res.isPassed
                    });

                    // 实时更新诊断看板明细
                    setAuditDetails(prev => ({
                        ...prev,
                        [sym]: {
                            ...res,
                            squeezePassed: squeezeHit,
                            volumePassed: volumeHit,
                            adxPassed: res.adxPassed,
                            tfResonancePassed: res.tfResonancePassed,
                            isPassed: res.isPassed
                        }
                    }));

                    // 3. 严格精准控制节奏（扣除运算时间补齐剩余间隔，绝对精准保持 1秒1币）
                    const elapsed = Date.now() - coinStartTime;
                    const remainingSleep = Math.max(0, delayMs - elapsed);
                    if (remainingSleep > 0 && i < targetSymbols.length - 1 && !signal.aborted) {
                        await sleep(remainingSleep);
                    }
                }

                // 🔒【原子批次提交机制】：整轮扫描完毕后，一次性差量同步至全局底池，市场初筛永不清零
                if (!signal.aborted && isMountedRef.current) {
                    setStep1Passed(batchStep1Passed);
                    setStep2Passed(batchStep2Passed);
                    setStep3Passed(batchStep3Passed);

                    const deduplicatedPool = Array.from(new Set(batchFinalPool));
                    setPool(deduplicatedPool);
                    localStorage.setItem('SCANNER_BREAKOUT_FILTERED_POOL', JSON.stringify(deduplicatedPool));
                    window.dispatchEvent(new CustomEvent('scanner_breakout_pool_updated', { detail: deduplicatedPool }));

                    // 一轮完成后平稳等待 1.5 秒，无缝开启下一轮稳健巡检
                    await sleep(1500);
                }
            }
        };

        runConcurrentAuditLoop();

        return () => {
            abortController.abort();
            setIsLoopRunning(false);
            setAuditProgress(null);
        };
    }, [
        config.enabled,
        config.scanDelayMs,
        config.enableSqueeze,
        config.maxBbwPercent,
        config.requireSqueezeInKc,
        config.enableVolumeSpike,
        config.volMultiplier,
        config.breakoutMode,
        config.enableAdx,
        config.minAdx,
        config.enableMultiTfResonance,
        config.primaryTf,
        config.confirmTf,
        config.combinationMode
    ]);

    const stats = useMemo(() => {
        return {
            step1Count: step1Passed.length,
            step2Count: step2Passed.length,
            step3Count: step3Passed.length,
            finalPoolCount: pool.length
        };
    }, [step1Passed, step2Passed, step3Passed, pool]);

    const displayItems = useMemo(() => {
        const allSyms = Object.keys(auditDetails);
        const term = searchTerm.trim().toUpperCase();
        return allSyms
            .filter(sym => !term || sym.includes(term))
            .map(sym => {
                const it = auditDetails[sym];
                if (!it) return null;
                const isPassed = pool.includes(sym);
                const matched: string[] = [];
                if (step1Passed.includes(sym)) matched.push('空间蓄势');
                if (step2Passed.includes(sym)) matched.push('突破放量');
                if (step3Passed.includes(sym)) matched.push('动能共振');
                return {
                    ...it,
                    isPassed,
                    matchedRules: matched
                };
            })
            .filter(Boolean) as BreakoutAuditItem[];
    }, [auditDetails, searchTerm, pool, step1Passed, step2Passed, step3Passed]);

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
                                (单币三项并发 · 1秒1币 · 符合任一即入池)
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
                        title={config.enabled ? "点击关闭趋势爆发综合过滤" : "点击启用趋势爆发综合过滤 (单币三项并发 1秒1币)"}
                    >
                        <span className={`w-1.5 h-1.5 rounded-full ${config.enabled ? 'bg-white animate-pulse' : 'bg-slate-500'}`} />
                        <span>{config.enabled ? '并发巡检中' : '未启用'}</span>
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
                    {/* 🔁 实时三项并发巡检状态栏 */}
                    <div className="bg-slate-950/80 border border-slate-800 rounded p-2 flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                                <Flame size={12} className="text-amber-400 animate-pulse" />
                                <span className="text-[10px] font-bold text-slate-200">三项实时并发审计模式:</span>
                            </div>
                            <span className="text-[8.5px] font-mono text-amber-400 font-bold">
                                {isLoopRunning ? `🚀 WebSocket API 全双工通信 · 1秒1币` : '等待开启'}
                            </span>
                        </div>

                        {/* 三项规则卡片状态预览 */}
                        <div className="grid grid-cols-3 gap-1.5 pt-0.5 text-[8.5px]">
                            {/* Dimension 1 */}
                            <div className={`p-1.5 rounded border transition-all flex items-center justify-between ${
                                config.enableSqueeze
                                    ? 'bg-cyan-950/60 border-cyan-500/50 text-cyan-300'
                                    : 'bg-slate-900/60 border-slate-800 text-slate-500'
                            }`}>
                                <div className="flex items-center gap-1 truncate">
                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${config.enableSqueeze ? 'bg-cyan-400' : 'bg-slate-600'}`} />
                                    <span className="font-bold truncate">① 空间极致蓄势</span>
                                </div>
                                <span className="font-mono font-bold text-cyan-400 shrink-0">
                                    {stats.step1Count} 币
                                </span>
                            </div>

                            {/* Dimension 2 */}
                            <div className={`p-1.5 rounded border transition-all flex items-center justify-between ${
                                config.enableVolumeSpike
                                    ? 'bg-amber-950/60 border-amber-500/50 text-amber-300'
                                    : 'bg-slate-900/60 border-slate-800 text-slate-500'
                            }`}>
                                <div className="flex items-center gap-1 truncate">
                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${config.enableVolumeSpike ? 'bg-amber-400' : 'bg-slate-600'}`} />
                                    <span className="font-bold truncate">② 突破点火放量</span>
                                </div>
                                <span className="font-mono font-bold text-amber-400 shrink-0">
                                    {stats.step2Count} 币
                                </span>
                            </div>

                            {/* Dimension 3 */}
                            <div className={`p-1.5 rounded border transition-all flex items-center justify-between ${
                                config.enableAdx || config.enableMultiTfResonance
                                    ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                                    : 'bg-slate-900/60 border-slate-800 text-slate-500'
                            }`}>
                                <div className="flex items-center gap-1 truncate">
                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${config.enableAdx || config.enableMultiTfResonance ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                                    <span className="font-bold truncate">③ 动能周期共振</span>
                                </div>
                                <span className="font-mono font-bold text-emerald-400 shrink-0">
                                    {stats.step3Count} 币
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* 🔀 综合判定逻辑模式选择栏 (OR 模式 / AND 模式) */}
                    <div className="bg-slate-900/90 border border-slate-800 rounded p-2 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                            <Sliders size={12} className="text-amber-400" />
                            <span className="text-[10px] font-bold text-slate-200">底池准入判定规则:</span>
                            <span className="text-[8.5px] text-slate-400">
                                {(config.combinationMode || 'OR') === 'OR' ? '（符合3个条件中的任何一个即放入底池）' : '（必须全部满足开启的条件）'}
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
                                title="OR 模式 (推荐)：只要符合空间蓄势、突破放量、动能共振任一条件，即放入趋势爆发底池，全部过滤完后与初筛列表差量同步"
                            >
                                符合任一 (OR)
                            </button>
                            <button
                                onClick={() => updateConfig(p => ({ ...p, combinationMode: 'AND' }))}
                                className={`px-2 py-0.5 rounded text-[8.5px] font-bold transition-all ${
                                    config.combinationMode === 'AND'
                                        ? 'bg-cyan-600 text-white shadow-[0_0_8px_rgba(6,182,212,0.3)]'
                                        : 'text-slate-400 hover:text-slate-200'
                                }`}
                                title="AND 模式：必须同时满足所有已开启的维度条件"
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
                                    { label: '1.0s/币', ms: 1000, title: '推荐：1秒1币稳健并发，WS长连接零超频' },
                                    { label: '0.5s/币', ms: 500, title: '极速：半秒1币' },
                                    { label: '0.2s/币', ms: 200, title: '高速：0.2秒1币' },
                                    { label: '无延时 0s', ms: 0, title: '极速并发扫描' }
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
                            <div className="w-16 flex items-center bg-slate-950 border border-slate-700 rounded px-1">
                                <SmartNumberInput
                                    value={Number(((config.scanDelayMs ?? 1000) / 1000).toFixed(1))}
                                    onChange={val => updateConfig(p => ({ ...p, scanDelayMs: Math.max(0, Math.round(val * 1000)) }))}
                                    className="w-10 bg-transparent text-emerald-400 font-mono text-[9px] h-5 text-center outline-none"
                                />
                                <span className="text-[8px] text-slate-500 font-mono">s</span>
                            </div>
                        </div>
                    </div>

                    {/* 🚀 实时流水线动态进度条 (单币三项并发实况) */}
                    {isLoopRunning && auditProgress && (
                        <div className="bg-slate-950/90 border border-amber-500/40 rounded p-2 flex flex-col gap-1.5 shadow-[0_0_12px_rgba(245,158,11,0.15)] animate-fadeIn">
                            <div className="flex items-center justify-between text-[9px]">
                                <div className="flex items-center gap-1.5">
                                    <Loader2 size={11} className="animate-spin text-amber-400" />
                                    <span className="font-bold text-amber-300">
                                        三项同时审计中 ({auditProgress.current}/{auditProgress.total})
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="font-mono text-cyan-300 font-bold bg-slate-900 px-1.5 py-0.5 rounded border border-cyan-800/60">
                                        {auditProgress.curSym}
                                    </span>
                                    <span className="text-amber-400 font-mono font-bold">
                                        {Math.round((auditProgress.current / Math.max(1, auditProgress.total)) * 100)}%
                                    </span>
                                </div>
                            </div>

                            {/* Live 3-Dimension Check Indicators for Current Symbol */}
                            <div className="grid grid-cols-4 gap-1 text-[8px] font-mono py-0.5">
                                <div className={`px-1 py-0.5 rounded border flex items-center justify-between ${
                                    auditProgress.curSqueezePassed === true ? 'bg-cyan-950 border-cyan-500 text-cyan-300' :
                                    auditProgress.curSqueezePassed === false ? 'bg-slate-900 border-slate-800 text-slate-500' :
                                    'bg-slate-900 border-slate-800 text-slate-400'
                                }`}>
                                    <span>① 蓄势</span>
                                    <span>{auditProgress.curSqueezePassed === true ? '✔️达标' : auditProgress.curSqueezePassed === false ? '❌未达' : '...'}</span>
                                </div>
                                <div className={`px-1 py-0.5 rounded border flex items-center justify-between ${
                                    auditProgress.curVolumePassed === true ? 'bg-amber-950 border-amber-500 text-amber-300' :
                                    auditProgress.curVolumePassed === false ? 'bg-slate-900 border-slate-800 text-slate-500' :
                                    'bg-slate-900 border-slate-800 text-slate-400'
                                }`}>
                                    <span>② 放量</span>
                                    <span>{auditProgress.curVolumePassed === true ? '✔️达标' : auditProgress.curVolumePassed === false ? '❌未达' : '...'}</span>
                                </div>
                                <div className={`px-1 py-0.5 rounded border flex items-center justify-between ${
                                    auditProgress.curMomentumPassed === true ? 'bg-emerald-950 border-emerald-500 text-emerald-300' :
                                    auditProgress.curMomentumPassed === false ? 'bg-slate-900 border-slate-800 text-slate-500' :
                                    'bg-slate-900 border-slate-800 text-slate-400'
                                }`}>
                                    <span>③ 共振</span>
                                    <span>{auditProgress.curMomentumPassed === true ? '✔️达标' : auditProgress.curMomentumPassed === false ? '❌未达' : '...'}</span>
                                </div>
                                <div className={`px-1 py-0.5 rounded border flex items-center justify-between font-bold ${
                                    auditProgress.curPassed === true ? 'bg-emerald-950/80 border-emerald-400 text-emerald-300' :
                                    auditProgress.curPassed === false ? 'bg-slate-900 border-slate-800 text-slate-500' :
                                    'bg-slate-900 border-slate-800 text-slate-400'
                                }`}>
                                    <span>判定</span>
                                    <span>{auditProgress.curPassed === true ? '🚀入池' : auditProgress.curPassed === false ? '未入' : '...'}</span>
                                </div>
                            </div>

                            {/* Progress bar line */}
                            <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden border border-slate-800">
                                <div 
                                    className="h-full transition-all duration-300 rounded-full bg-gradient-to-r from-cyan-500 via-amber-500 to-emerald-500"
                                    style={{ width: `${Math.round((auditProgress.current / Math.max(1, auditProgress.total)) * 100)}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* 📊 3维度命中情况与去重底池统计条 */}
                    <div className="grid grid-cols-4 gap-1.5 text-[8.5px] font-mono">
                        <div className="bg-slate-900/90 border border-slate-800 rounded px-2 py-1 flex items-center justify-between">
                            <span className="text-cyan-400">① 蓄势命中:</span>
                            <span className="font-bold text-cyan-300">{stats.step1Count} 币</span>
                        </div>
                        <div className="bg-slate-900/90 border border-slate-800 rounded px-2 py-1 flex items-center justify-between">
                            <span className="text-amber-400">② 放量命中:</span>
                            <span className="font-bold text-amber-300">{stats.step2Count} 币</span>
                        </div>
                        <div className="bg-slate-900/90 border border-slate-800 rounded px-2 py-1 flex items-center justify-between">
                            <span className="text-emerald-400">③ 共振命中:</span>
                            <span className="font-bold text-emerald-300">{stats.step3Count} 币</span>
                        </div>
                        <div className="bg-amber-950/60 border border-amber-600/60 rounded px-2 py-1 flex items-center justify-between shadow-[0_0_10px_rgba(245,158,11,0.15)]">
                            <span className="text-amber-300 font-bold">初筛底池:</span>
                            <span className="font-bold text-amber-400">{stats.finalPoolCount} 币</span>
                        </div>
                    </div>

                    {/* Dimension 1: 空间极致蓄势 (Squeeze 波动率压缩) */}
                    <div className={`border rounded p-2 flex flex-col gap-2 transition-all ${
                        isLoopRunning && config.enableSqueeze 
                            ? 'bg-cyan-950/30 border-cyan-500/60 shadow-[0_0_10px_rgba(6,182,212,0.15)]' 
                            : 'bg-slate-900/80 border-slate-800'
                    }`}>
                        <div className="flex items-center justify-between border-b border-slate-800/60 pb-1">
                            <div className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${isLoopRunning && config.enableSqueeze ? 'bg-cyan-400 animate-ping' : 'bg-cyan-400'}`} />
                                <span className="text-[10px] font-bold text-slate-200">① 空间极致蓄势 (Squeeze 压缩)</span>
                                {isLoopRunning && config.enableSqueeze && (
                                    <span className="text-[7.5px] bg-cyan-900/80 text-cyan-300 border border-cyan-500/40 px-1 rounded font-mono font-bold">
                                        并发检测中
                                    </span>
                                )}
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
                    <div className={`border rounded p-2 flex flex-col gap-2 transition-all ${
                        isLoopRunning && config.enableVolumeSpike 
                            ? 'bg-amber-950/30 border-amber-500/60 shadow-[0_0_10px_rgba(245,158,11,0.15)]' 
                            : 'bg-slate-900/80 border-slate-800'
                    }`}>
                        <div className="flex items-center justify-between border-b border-slate-800/60 pb-1">
                            <div className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${isLoopRunning && config.enableVolumeSpike ? 'bg-amber-400 animate-ping' : 'bg-amber-400'}`} />
                                <span className="text-[10px] font-bold text-slate-200">② 突破点火放量 (Volume & 破位)</span>
                                {isLoopRunning && config.enableVolumeSpike && (
                                    <span className="text-[7.5px] bg-amber-900/80 text-amber-300 border border-amber-500/40 px-1 rounded font-mono font-bold">
                                        并发检测中
                                    </span>
                                )}
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
                    <div className={`border rounded p-2 flex flex-col gap-2 transition-all ${
                        isLoopRunning && (config.enableAdx || config.enableMultiTfResonance) 
                            ? 'bg-emerald-950/30 border-emerald-500/60 shadow-[0_0_10px_rgba(16,185,129,0.15)]' 
                            : 'bg-slate-900/80 border-slate-800'
                    }`}>
                        <div className="flex items-center justify-between border-b border-slate-800/60 pb-1">
                            <div className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${isLoopRunning && (config.enableAdx || config.enableMultiTfResonance) ? 'bg-emerald-400 animate-ping' : 'bg-emerald-400'}`} />
                                <span className="text-[10px] font-bold text-slate-200">③ 动能爆发与多周期共振 (ADX & EMA)</span>
                                {isLoopRunning && (config.enableAdx || config.enableMultiTfResonance) && (
                                    <span className="text-[7.5px] bg-emerald-900/80 text-emerald-300 border border-emerald-500/40 px-1 rounded font-mono font-bold">
                                        并发检测中
                                    </span>
                                )}
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
                                {isLoopRunning ? '正在执行单币三项并发稳健审计 (1秒1币)...' : '暂无审计数据'}
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
                                            <span title="布林带宽 (BBW)" className={item.squeezePassed ? 'text-cyan-300 font-bold' : 'text-slate-500'}>
                                                BBW:{item.bbwPct}%
                                            </span>
                                            <span title="量比 (Volume Ratio)" className={item.volumePassed ? 'text-amber-300 font-bold' : 'text-slate-500'}>
                                                量:{item.volRatio}x
                                            </span>
                                            <span title="ADX 动能" className={item.adxPassed ? 'text-emerald-300 font-bold' : 'text-slate-500'}>
                                                ADX:{item.adxValue}
                                            </span>
                                        </div>

                                        {/* Right: Pass or Fail Reason */}
                                        <div className="w-36 text-right truncate text-[7.5px]">
                                            {item.isPassed ? (
                                                <span className="text-emerald-400 font-bold" title={`命中条件: ${item.matchedRules?.join('、') || '符合规则'}`}>
                                                    {item.matchedRules && item.matchedRules.length >= 3 ? (
                                                        <span className="text-amber-300 font-extrabold">👑 全维爆发</span>
                                                    ) : item.matchedRules && item.matchedRules.length === 2 ? (
                                                        <span className="text-emerald-300">🔥 双重共振 ({item.matchedRules.join('+')})</span>
                                                    ) : (
                                                        <span>🚀 {item.matchedRules && item.matchedRules.length > 0 ? item.matchedRules.join('+') : '完美命中'}</span>
                                                    )}
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
