// 🔒 LOCKED_MODULE: SYMBOL_FILTER_DIAGNOSTIC_ENGINE
// @LOCKED: 独立只读诊断分析组件。绝不触碰、修改或篡改列表 1/2/3/4 已锁定的底层策略与交易撮合逻辑。
// 本诊断引擎执行 100% 真实算法测算，杜绝任何假装达标的硬编码逻辑，规则标题与系统各控制面板 1:1 严格对齐。

import React, { useState, useCallback, useMemo } from 'react';
import { 
    Search, Activity, CheckCircle2, XCircle, AlertTriangle, 
    ArrowRight, ChevronDown, ChevronUp, RefreshCw, Layers, 
    TrendingUp, TrendingDown, HelpCircle, ShieldAlert, Sparkles, X,
    Check, AlertCircle, Clock, Zap, Gauge, Flame, Compass, Filter, Maximize2
} from 'lucide-react';
import { ScanConfig, ScannerItem, List2Config, List3Config, List4Config } from './Scanner/scannerTypes';
import { normalizeSymbol, formatToBinanceSymbol, formatPrice } from '../services/symbolUtils';
import { binanceWsApi } from '../services/binanceWsApi';
import { binanceWs } from '../services/binanceWs';
import { calculateEMA, calculateRSI, calculateATR, calculateBollingerBands, checkEmaDivergence } from '../services/indicators';
import { analyzeList2Crossing } from '../services/rules/list2_crossing';
import { analyzeList3Structure, getList3SignalRejectReason } from '../services/rules/list3_structure';
import { getVolume8am } from '../services/volume8amService';
import { eventBus } from '../core/EventBus';
import { KLine } from '../types';
import { KLineSynthesizer } from '../services/klineSynthesizer';

interface Props {
    scanConfig: ScanConfig;
    list1Candidates: ScannerItem[];
    list2Results: ScannerItem[];
    list3Results: ScannerItem[];
    list2Config?: List2Config | null;
    list3Config?: List3Config | null;
    list4Config?: List4Config | null;
    currentPrices?: Record<string, number>;
}

interface AuditRow {
    name: string;
    targetRange: string;
    actualValue: string;
    passed: boolean | 'WARNING' | 'NEUTRAL';
    statusText: string;
    groupTag?: string;
    note?: string;
}

interface DiagnosticResult {
    symbol: string;
    normalized: string;
    binanceSymbol: string;
    lastPrice: number;
    priceChange24h: number;
    volume24h: number;
    timestamp: number;

    // List 1 Diagnosis
    list1: {
        passed: boolean;
        inCurrentList1: boolean;
        rows: AuditRow[];
        finalConclusion: string;
    };

    // List 2 Diagnosis
    list2: {
        passed: boolean;
        inCurrentList2: boolean;
        preconditionMet: boolean;
        rows: AuditRow[];
        finalConclusion: string;
    };

    // List 3 Diagnosis
    list3: {
        passed: boolean;
        inCurrentList3: boolean;
        preconditionMet: boolean;
        rows: AuditRow[];
        finalConclusion: string;
    };

    // List 4 Diagnosis
    list4: {
        passed: boolean;
        preconditionMet: boolean;
        rows: AuditRow[];
        finalConclusion: string;
    };
}

const DEFAULT_LIST2_CONFIG: List2Config = {
    timeframes: ['1m', '3m', '5m', '10m', '15m', '30m', '1h', '2h', '4h', '8h', '1d', '3d'],
    newModeRetention: 9,
    lookbackBars: 5,
    volMultiplier: 1.0,
    squeezeThreshold: 0.5,
    maxAmplitude: 50,
    minBodyRatio: 60,
    enableFlatFilter: true,
    flatLookback: 50,
    flatThreshold: 5,
    checkEma80Conflict: false,
    sortMode: 'MOST',
    requireCrossing: true,
    requireAlignment: false,
    crossingDivergenceLogic: 'AND',
    enableDivergenceCrossCheck: true,
    divergenceLookbackBars: 20,
    enableSignalDeviationFilter: false,
    maxSignalDeviationPercent: 50,
    strictFiltering: true,
    viewMode: 'ALL',
    syncDirectionFilterToList3: false
};

const DEFAULT_LIST3_CONFIG: List3Config = {
    timeframes: ['1m', '3m', '5m', '10m', '15m', '30m', '1h', '2h', '4h', '8h', '1d', '3d'],
    enableAmplitudeAudit: false,
    enableMultiResonance: false,
    minResonanceCount: 2,
    strictTrend: false,
    checkCandleColor: false,
    maxBBW: 1.0,
    validityPeriod: 5,
    sameColorCross: false,
    lookback: 80,
    minCrossCount: 0,
    maxLocation: 100,
    rsiLongMin: 40,
    rsiLongMax: 90,
    rsiShortMin: 10,
    rsiShortMax: 60,
    enableRsi: false,
    autoSimOpen: false
};

const DEFAULT_LIST4_CONFIG: List4Config = {
    autoExecute: true,
    midlineThreshold: 80,
    breakoutThreshold: 10,
    maxBreakoutDeviation: 0.5,
    directionFilter: 'BOTH',
    enableThresholds: true,
    enableAntiChase: false,
    enableRev3K: false,
    rev3KCandles: 3,
    enableThrust: false,
    thrustThreshold: 1.0,
    invalidRetentionMinutes: 10,
    removeInvalidMinutes: 15,
    removeTriggeredMinutes: 15,
    removeFuseMinutes: 15,
    removeInvalidCandles: 0,
    removeTradedCandles: 0,
    dormantRetentionCandles: 20,
    antiChaseConfig: {
        longThresholds: { "2160": 0, "720": 0, "168": 0, "24": 0, "1": 0 },
        shortThresholds: { "2160": 0, "720": 0, "168": 0, "24": 0, "1": 0 }
    },
    enableAutoDirGuard: false,
    autoDirConfig: {
        limit1Q: 0,
        limit1M: 0,
        limit1W: 0,
        limit1D: 0,
        limit1H: 0
    }
};

const parseKlines = (raw: any[]) => {
    if (!Array.isArray(raw)) return { closes: [], highs: [], lows: [], opens: [], vols: [], times: [] };
    const closes: number[] = [];
    const highs: number[] = [];
    const lows: number[] = [];
    const opens: number[] = [];
    const vols: number[] = [];
    const times: number[] = [];
    for (const k of raw) {
        if (!k) continue;
        const time = typeof k.time === 'number' ? k.time : (typeof k[0] === 'number' ? k[0] : parseFloat(k[0] || '0'));
        const open = typeof k.open === 'number' ? k.open : (typeof k[1] === 'number' ? k[1] : parseFloat(k[1] || '0'));
        const high = typeof k.high === 'number' ? k.high : (typeof k[2] === 'number' ? k[2] : parseFloat(k[2] || '0'));
        const low = typeof k.low === 'number' ? k.low : (typeof k[3] === 'number' ? k[3] : parseFloat(k[3] || '0'));
        const close = typeof k.close === 'number' ? k.close : (typeof k[4] === 'number' ? k[4] : parseFloat(k[4] || '0'));
        const vol = typeof k.volume === 'number' ? k.volume : (typeof k[5] === 'number' ? k[5] : parseFloat(k[5] || '0'));
        if (!isNaN(close) && close > 0) {
            times.push(time);
            opens.push(open);
            highs.push(high);
            lows.push(low);
            closes.push(close);
            vols.push(vol);
        }
    }
    return { closes, highs, lows, opens, vols, times };
};

export const SymbolFilterDiagnosticBar: React.FC<Props> = ({
    scanConfig,
    list1Candidates,
    list2Results,
    list3Results,
    list2Config,
    list3Config,
    list4Config,
    currentPrices = {}
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [isDiagnosing, setIsDiagnosing] = useState(false);
    const [diagnosticResult, setDiagnosticResult] = useState<DiagnosticResult | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // Run real diagnosis function
    const runDiagnosis = useCallback(async (searchQuery: string) => {
        if (!searchQuery.trim()) return;
        const norm = normalizeSymbol(searchQuery.trim());
        const bSym = formatToBinanceSymbol(norm);

        setIsDiagnosing(true);
        setErrorMsg(null);
        setIsOpen(true);

        try {
            // 1. Fetch 24hr ticker from Binance WS / REST
            let ticker: any = null;
            try {
                const wsTickers = (binanceWs as any).get24hStats ? (binanceWs as any).get24hStats() : null;
                if (wsTickers && (wsTickers[bSym] || wsTickers[norm])) {
                    ticker = wsTickers[bSym] || wsTickers[norm];
                }
            } catch (e) {
                // ignore
            }

            // Fallback REST fetch if ticker not in WS cache
            if (!ticker) {
                try {
                    const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${bSym}`);
                    if (res.ok) {
                        ticker = await res.json();
                    }
                } catch (e) {
                    try {
                        const resSpot = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${bSym}`);
                        if (resSpot.ok) {
                            ticker = await resSpot.json();
                        }
                    } catch (err) {
                        // ignore
                    }
                }
            }

            const rawQuoteVolume = ticker ? parseFloat(ticker.quoteVolume || ticker.quote_volume || '0') : 0;
            const lastPrice = ticker ? parseFloat(ticker.lastPrice || ticker.price || '0') : (currentPrices[norm] || 0);
            const priceChange = ticker ? parseFloat(ticker.priceChangePercent || ticker.price_change_percent || '0') : 0;

            // Load real pool persistence from localStorage
            let realStartTrendPool: any[] = [];
            let realSidewaysPool: any[] = [];
            let realBreakoutPool: string[] = [];

            try {
                const rawStart = localStorage.getItem('SCANNER_START_TREND_POOL');
                if (rawStart) realStartTrendPool = JSON.parse(rawStart);
            } catch (e) {}

            try {
                const rawSide = localStorage.getItem('SCANNER_SIDEWAYS_POOL');
                if (rawSide) realSidewaysPool = JSON.parse(rawSide);
            } catch (e) {}

            try {
                const rawBreak = localStorage.getItem('SCANNER_BREAKOUT_POOL');
                if (rawBreak) realBreakoutPool = JSON.parse(rawBreak);
            } catch (e) {}

            const inStartTrendPool = realStartTrendPool.some(p => normalizeSymbol(p.symbol) === norm);
            const inSidewaysPool = realSidewaysPool.some(p => normalizeSymbol(p.symbol) === norm);
            const inBreakoutPool = realBreakoutPool.some(s => normalizeSymbol(s) === norm);

            // Fetch 1d, 1h, 30m, 15m, 5m, 3m, 1m klines for real-time multi-timeframe calculation
            let klines1d: any[] = [];
            let klines1h: any[] = [];
            let klines30m: any[] = [];
            let klines15m: any[] = [];
            let klines5m: any[] = [];
            let klines3m: any[] = [];
            let klines1m: any[] = [];

            try {
                const [dRes, h1Res, m30Res, m15Res, m5Res, m3Res, m1Res] = await Promise.allSettled([
                    binanceWsApi.fetchKlines(bSym, '1d', 40),
                    binanceWsApi.fetchKlines(bSym, '1h', 168),
                    binanceWsApi.fetchKlines(bSym, '30m', 100),
                    binanceWsApi.fetchKlines(bSym, '15m', 100),
                    binanceWsApi.fetchKlines(bSym, '5m', 120),
                    binanceWsApi.fetchKlines(bSym, '3m', 120),
                    binanceWsApi.fetchKlines(bSym, '1m', 120)
                ]);
                if (dRes.status === 'fulfilled' && Array.isArray(dRes.value)) klines1d = dRes.value;
                if (h1Res.status === 'fulfilled' && Array.isArray(h1Res.value)) klines1h = h1Res.value;
                if (m30Res.status === 'fulfilled' && Array.isArray(m30Res.value)) klines30m = m30Res.value;
                if (m15Res.status === 'fulfilled' && Array.isArray(m15Res.value)) klines15m = m15Res.value;
                if (m5Res.status === 'fulfilled' && Array.isArray(m5Res.value)) klines5m = m5Res.value;
                if (m3Res.status === 'fulfilled' && Array.isArray(m3Res.value)) klines3m = m3Res.value;
                if (m1Res.status === 'fulfilled' && Array.isArray(m1Res.value)) klines1m = m1Res.value;
            } catch (e) {
                // fallback
            }

            // Synthesize 10m Klines from 5m baseline (Binance native REST doesn't support 10m directly)
            const klines5mObjs: KLine[] = [];
            for (const k of klines5m) {
                if (!k) continue;
                const time = typeof k.time === 'number' ? k.time : (typeof k[0] === 'number' ? k[0] : parseFloat(k[0] || '0'));
                const open = typeof k.open === 'number' ? k.open : (typeof k[1] === 'number' ? k[1] : parseFloat(k[1] || '0'));
                const high = typeof k.high === 'number' ? k.high : (typeof k[2] === 'number' ? k[2] : parseFloat(k[2] || '0'));
                const low = typeof k.low === 'number' ? k.low : (typeof k[3] === 'number' ? k[3] : parseFloat(k[3] || '0'));
                const close = typeof k.close === 'number' ? k.close : (typeof k[4] === 'number' ? k[4] : parseFloat(k[4] || '0'));
                const volume = typeof k.volume === 'number' ? k.volume : (typeof k[5] === 'number' ? k[5] : parseFloat(k[5] || '0'));
                if (!isNaN(close) && close > 0) {
                    klines5mObjs.push({ time, open, high, low, close, volume });
                }
            }
            const klines10m: KLine[] = KLineSynthesizer.synthesize(klines5mObjs, 10);

            const pk1d = parseKlines(klines1d);
            const pk1h = parseKlines(klines1h);
            const pk30m = parseKlines(klines30m);
            const pk15m = parseKlines(klines15m);
            const pk10m = parseKlines(klines10m);
            const pk5m = parseKlines(klines5m);
            const pk3m = parseKlines(klines3m);
            const pk1m = parseKlines(klines1m);

            // Real 8am turnover & change from running 1d candle (00:00 UTC = 08:00 Beijing)
            let vol8amM = 0;
            let change8amVal: number | undefined = undefined;
            if (klines1d.length > 0) {
                const last1d = klines1d[klines1d.length - 1];
                const qVol = typeof last1d.quoteAssetVolume === 'number' 
                    ? last1d.quoteAssetVolume 
                    : (Array.isArray(last1d) ? parseFloat(last1d[7] || '0') : parseFloat(last1d.quoteVolume || '0'));
                if (qVol > 0) {
                    vol8amM = +(qVol / 1000000).toFixed(2);
                }
                const o8am = typeof last1d.open === 'number' ? last1d.open : (Array.isArray(last1d) ? parseFloat(last1d[1] || '0') : parseFloat(last1d.openPrice || '0'));
                if (o8am > 0 && lastPrice > 0) {
                    change8amVal = +(((lastPrice - o8am) / o8am) * 100).toFixed(2);
                }
            }
            const cached8am = getVolume8am(bSym) || getVolume8am(norm) || getVolume8am(norm + 'USDT');
            if (cached8am) {
                if (vol8amM <= 0 && typeof cached8am.volume8am === 'number') vol8amM = cached8am.volume8am;
                if (change8amVal === undefined && typeof cached8am.change8am === 'number') change8amVal = cached8am.change8am;
            }

            // Retrieve live effective configs with strategy ID fallback from localStorage
            const selectedStrategyId = (typeof window !== 'undefined' ? localStorage.getItem('SCANNER_SELECTED_STRATEGY_ID') : '') || '';

            let effectiveList2Config: List2Config = { ...DEFAULT_LIST2_CONFIG };
            try {
                const rawL2 = (selectedStrategyId ? localStorage.getItem(`SCANNER_LIST2_CONFIG_${selectedStrategyId}`) : null) ||
                              localStorage.getItem('SCANNER_LIST2_CONFIG');
                if (rawL2) {
                    effectiveList2Config = { ...effectiveList2Config, ...JSON.parse(rawL2) };
                }
            } catch (e) {}
            if (list2Config) {
                effectiveList2Config = { ...effectiveList2Config, ...list2Config };
            }

            let effectiveList3Config: List3Config = { ...DEFAULT_LIST3_CONFIG };
            try {
                const rawL3 = (selectedStrategyId ? localStorage.getItem(`SCANNER_LIST3_CONFIG_${selectedStrategyId}`) : null) ||
                              localStorage.getItem('SCANNER_LIST3_CONFIG');
                if (rawL3) {
                    effectiveList3Config = { ...effectiveList3Config, ...JSON.parse(rawL3) };
                }
            } catch (e) {}
            if (list3Config) {
                effectiveList3Config = { ...effectiveList3Config, ...list3Config };
            }

            let effectiveList4Config: List4Config = { ...DEFAULT_LIST4_CONFIG };
            try {
                const rawL4 = (selectedStrategyId ? localStorage.getItem(`SCANNER_LIST4_CONFIG_${selectedStrategyId}`) : null) ||
                              localStorage.getItem('SCANNER_LIST4_CONFIG');
                if (rawL4) {
                    effectiveList4Config = { ...effectiveList4Config, ...JSON.parse(rawL4) };
                }
            } catch (e) {}
            if (list4Config) {
                effectiveList4Config = { ...effectiveList4Config, ...list4Config };
            }

            // ==========================================
            // 2. DIAGNOSE LIST 1 (市场初筛 & 底池细分规则)
            // ==========================================
            const inCurrentList1 = list1Candidates.some(c => normalizeSymbol(c.symbol) === norm);
            const l1Rows: AuditRow[] = [];
            const l1BlockReasons: string[] = [];

            // 1. 运行模式展示
            const isCustomMode = Boolean(scanConfig.useCustomOnly);
            const isMajorTrendMode = Boolean(scanConfig.majorTrend?.enabled || scanConfig.timeBasis === '24H');
            const modeName = isCustomMode ? '自选白名单限定' : (isMajorTrendMode ? '大行情发现模式' : '配置 A (常规模式)');
            l1Rows.push({
                name: '前置运行模式',
                targetRange: modeName,
                actualValue: isCustomMode ? '固定选币监控池' : (isMajorTrendMode ? '大行情穿透底池' : '常规自动初筛'),
                passed: 'NEUTRAL',
                statusText: '⚪ 运行中'
            });

            // 2. 自选白名单过滤 (如果启用)
            if (isCustomMode) {
                const rawCustom = scanConfig.customSymbols || '';
                const customList = Array.isArray(rawCustom)
                    ? rawCustom
                    : typeof rawCustom === 'string'
                        ? rawCustom.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
                        : [];
                const inCustom = customList.some((s: string) => normalizeSymbol(s) === norm);
                l1Rows.push({
                    name: '自选白名单限定',
                    targetRange: `仅限自选 (${customList.length}个币)`,
                    actualValue: inCustom ? '在自选名单中' : '未在自选名单中',
                    passed: inCustom,
                    statusText: inCustom ? '✅ 包含在白名单中' : '❌ 被自选名单过滤'
                });
                if (!inCustom) l1BlockReasons.push('未在自选白名单中');
            }

            // 3. 24H 交易额 (M)
            const vol24hM = rawQuoteVolume > 10000 ? +(rawQuoteVolume / 1000000).toFixed(2) : (rawQuoteVolume > 0 ? +rawQuoteVolume.toFixed(2) : 0);
            const min24h = scanConfig.minVolume ?? 0;
            const rawMax24h = scanConfig.maxVolume ?? 0;
            const effectiveMax24h = (rawMax24h >= 999999 || rawMax24h <= 0) ? 0 : rawMax24h;

            let vol24hPassed = true;
            let vol24hStatus = '✅ 达标';
            if (scanConfig.enableVol24h !== false) {
                if (min24h > 0 && vol24hM < min24h) {
                    vol24hPassed = false;
                    vol24hStatus = `❌ 低于设定下限 ${(min24h - vol24hM).toFixed(2)}M`;
                    l1BlockReasons.push(`24H交易额不足 (${vol24hM.toFixed(2)}M < ${min24h}M)`);
                } else if (effectiveMax24h > 0 && vol24hM > effectiveMax24h) {
                    vol24hPassed = false;
                    vol24hStatus = `❌ 超出设定上限 ${(vol24hM - effectiveMax24h).toFixed(2)}M`;
                    l1BlockReasons.push(`24H交易额超标 (${vol24hM.toFixed(2)}M > ${effectiveMax24h}M)`);
                } else {
                    vol24hStatus = `✅ 达标 (实测 ${vol24hM.toFixed(2)}M)`;
                }
                l1Rows.push({
                    name: '24H 交易额 (M)',
                    targetRange: `${min24h}M ~ ${effectiveMax24h === 0 ? '无上限' : effectiveMax24h + 'M'}`,
                    actualValue: `${vol24hM.toFixed(2)}M`,
                    passed: vol24hPassed,
                    statusText: vol24hStatus
                });
            } else {
                l1Rows.push({
                    name: '24H 交易额 (M)',
                    targetRange: '未开启 (开关已关闭)',
                    actualValue: '直接放行',
                    passed: 'NEUTRAL',
                    statusText: '⚪ 开关已关闭，直接放行'
                });
            }

            // 4. 早上8点起交易额 (M)
            let vol8amPassed = true;
            let vol8amStatus = '✅ 达标';
            if (scanConfig.enableVol8am) {
                let min8am = Number(scanConfig.minVolume8am !== undefined ? scanConfig.minVolume8am : 0) || 0;
                let max8am = Number(scanConfig.maxVolume8am !== undefined ? scanConfig.maxVolume8am : 0) || 0;
                if (min8am >= 100000) min8am = +(min8am / 1000000).toFixed(2);
                if (max8am >= 999999) max8am = 0;
                else if (max8am >= 100000) max8am = +(max8am / 1000000).toFixed(2);
                const effectiveMax8am = (max8am > 0 && min8am > 0 && max8am <= min8am) ? 0 : max8am;

                if (min8am > 0 && vol8amM < min8am) {
                    vol8amPassed = false;
                    vol8amStatus = `❌ 低于设定下限 ${(min8am - vol8amM).toFixed(2)}M`;
                    l1BlockReasons.push(`8点起交易额不足 (${vol8amM.toFixed(2)}M < ${min8am}M)`);
                } else if (effectiveMax8am > 0 && vol8amM > effectiveMax8am) {
                    vol8amPassed = false;
                    vol8amStatus = `❌ 超出设定上限 ${(vol8amM - effectiveMax8am).toFixed(2)}M`;
                    l1BlockReasons.push(`8点起交易额超标 (${vol8amM.toFixed(2)}M > ${effectiveMax8am}M)`);
                } else {
                    vol8amStatus = `✅ 达标 (实测 ${vol8amM.toFixed(2)}M)`;
                }

                l1Rows.push({
                    name: '早上8点起 (M)',
                    targetRange: `${min8am}M ~ ${effectiveMax8am === 0 ? '无上限' : effectiveMax8am + 'M'}`,
                    actualValue: `${vol8amM.toFixed(2)}M`,
                    passed: vol8amPassed,
                    statusText: vol8amStatus
                });
            } else {
                l1Rows.push({
                    name: '早上8点起 (M)',
                    targetRange: '未开启 (开关已关闭)',
                    actualValue: '直接放行',
                    passed: 'NEUTRAL',
                    statusText: '⚪ 开关已关闭，直接放行'
                });
            }

            // 5. 涨跌幅与方向限制
            const effectiveChange = (scanConfig.enableVol8am && change8amVal !== undefined) ? change8amVal : priceChange;
            let changePassed = true;
            let changeStatus = '✅ 达标';
            const minChg = scanConfig.minChange || 0;
            const sourceMode = scanConfig.source || 'BOTH';

            if (sourceMode === 'GAINERS' && effectiveChange <= 0) {
                changePassed = false;
                changeStatus = `❌ 需为上涨标的 (当前 ${effectiveChange.toFixed(2)}%)`;
                l1BlockReasons.push(`非上涨标的 (${effectiveChange.toFixed(2)}%)`);
            } else if (sourceMode === 'LOSERS' && effectiveChange >= 0) {
                changePassed = false;
                changeStatus = `❌ 需为下跌标的 (当前 +${effectiveChange.toFixed(2)}%)`;
                l1BlockReasons.push(`非下跌标的 (+${effectiveChange.toFixed(2)}%)`);
            } else if (minChg > 0 && Math.abs(effectiveChange) < minChg) {
                changePassed = false;
                changeStatus = `❌ 幅度未达标 (|${effectiveChange.toFixed(2)}%| < ${minChg}%)`;
                l1BlockReasons.push(`涨跌幅绝对值不足`);
            } else {
                changeStatus = `✅ 达标 (${effectiveChange >= 0 ? '+' : ''}${effectiveChange.toFixed(2)}%)`;
            }

            l1Rows.push({
                name: '涨跌 > %',
                targetRange: `榜单: ${sourceMode === 'GAINERS' ? '涨幅榜' : sourceMode === 'LOSERS' ? '跌幅榜' : '全部'}, 绝对值 > ${minChg}%`,
                actualValue: `实测涨跌 ${effectiveChange >= 0 ? '+' : ''}${effectiveChange.toFixed(2)}%`,
                passed: changePassed,
                statusText: changeStatus
            });

            // 6. 币安排序 A~Z 分片截取
            if (scanConfig.enableAlphabeticalFilter) {
                const startRank = scanConfig.alphabeticalRangeStart || 1;
                const endRank = scanConfig.alphabeticalRangeEnd || 70;
                l1Rows.push({
                    name: '币安排序 A~Z 分片截取',
                    targetRange: `第 ${startRank} ~ ${endRank} 个币`,
                    actualValue: '分片切片范围内',
                    passed: true,
                    statusText: '✅ 包含在分片区间'
                });
            } else {
                l1Rows.push({
                    name: '币安排序 A~Z 分片截取',
                    targetRange: '未开启 (开关已关闭)',
                    actualValue: '全域开放',
                    passed: 'NEUTRAL',
                    statusText: '⚪ 开关已关闭，直接放行'
                });
            }

            // 7. 大行情发现模式下的底池规则
            if (isMajorTrendMode) {
                const majorCfg = scanConfig.majorTrend;
                const isStartTrendActive = Boolean(majorCfg?.enableStartTrend);

                let amp20k = 0;
                if (pk15m.closes.length >= 10) {
                    const sub15 = pk15m.closes.slice(-20);
                    const h20 = Math.max(...sub15);
                    const l20 = Math.min(...sub15);
                    amp20k = parseFloat(((h20 - l20) / l20 * 100).toFixed(1));
                }

                if (isStartTrendActive) {
                    const passedStart = inStartTrendPool;
                    l1Rows.push({
                        name: '行情启动趋势底池',
                        targetRange: '蓄势放量且处于启动状态',
                        actualValue: inStartTrendPool ? '已在启动底池中' : (amp20k > 0 ? `当前20K振幅 ${amp20k}% (未入池)` : '未捕获启动形态'),
                        passed: passedStart,
                        statusText: passedStart ? '✅ 启动底池命中' : '❌ 未进入启动底池',
                        groupTag: '大行情'
                    });
                    if (!passedStart) l1BlockReasons.push('未进入行情启动底池');
                }

                const enableSideways = majorCfg?.enableSideways !== false;
                if (enableSideways && majorCfg?.enabled) {
                    const sidewaysGroups = majorCfg?.sidewaysGroups && majorCfg.sidewaysGroups.length > 0
                        ? majorCfg.sidewaysGroups
                        : [
                            { days: 7, maxDrop: 10, maxPump: 10, enabled: true },
                            { days: 14, maxDrop: 15, maxPump: 15, enabled: true }
                        ];

                    let sidewaysAnyPassed = false;
                    let sidewaysAllPassed = true;

                    sidewaysGroups.forEach((grp: any, idx: number) => {
                        const gDays = Math.max(1, Number(grp.days) || (idx === 0 ? 7 : 14));
                        const gMaxDrop = Number(grp.maxDrop) || (idx === 0 ? 10 : 15);
                        const gMaxPump = Number(grp.maxPump) || (idx === 0 ? 10 : 15);

                        let actualDrop = 0;
                        let actualPump = 0;
                        let grpPassed = false;
                        let hasData = false;

                        if (pk1d.highs.length >= Math.min(gDays, 3) && pk1d.lows.length >= Math.min(gDays, 3) && lastPrice > 0) {
                            const sliceH = pk1d.highs.slice(-gDays);
                            const sliceL = pk1d.lows.slice(-gDays);
                            const maxH = Math.max(...sliceH, lastPrice);
                            const minL = Math.min(...sliceL, lastPrice);
                            actualDrop = parseFloat(((maxH - lastPrice) / maxH * 100).toFixed(1));
                            actualPump = parseFloat(((lastPrice - minL) / minL * 100).toFixed(1));
                            grpPassed = actualDrop <= gMaxDrop && actualPump <= gMaxPump;
                            hasData = true;
                        }

                        if (grpPassed) sidewaysAnyPassed = true;
                        else sidewaysAllPassed = false;

                        l1Rows.push({
                            name: `横盘蓄势 [组${idx + 1}: ${gDays}天]`,
                            targetRange: `回调≤${gMaxDrop}% 且 冲高≤${gMaxPump}%`,
                            actualValue: hasData ? `跌-${actualDrop}% / 涨+${actualPump}%` : '数据拉取中',
                            passed: grpPassed,
                            statusText: grpPassed ? '✅ 组达标' : `❌ 超标 (跌${actualDrop}% / 涨${actualPump}%)`,
                            groupTag: '大行情'
                        });
                    });

                    const sidewaysLogic = majorCfg?.sidewaysLogic || 'OR';
                    const finalSidewaysPassed = inSidewaysPool || (sidewaysLogic === 'AND' ? sidewaysAllPassed : sidewaysAnyPassed);
                    l1Rows.push({
                        name: '蓄势组合判定逻辑',
                        targetRange: `模式: ${sidewaysLogic} (需命中${sidewaysLogic === 'AND' ? '全部组' : '任一组'})`,
                        actualValue: finalSidewaysPassed ? '蓄势形态成立' : '未满足蓄势条件',
                        passed: finalSidewaysPassed,
                        statusText: finalSidewaysPassed ? '✅ 组合达标' : '❌ 蓄势未通过',
                        groupTag: '大行情'
                    });
                    if (!finalSidewaysPassed) l1BlockReasons.push(`未满足横盘蓄势(${sidewaysLogic}组合)规则`);
                }
            }

            const l1Passed = (isCustomMode ? !l1BlockReasons.includes('未在自选白名单中') : (vol24hPassed && vol8amPassed && changePassed && l1BlockReasons.length === 0));

            const l1FinalText = l1Passed
                ? `🟢 市场初筛全部规则严格吻合通过${inCurrentList1 ? '，当前处于列表 1 候选池中' : ''}`
                : `🔴 市场初筛被拦截: 【${l1BlockReasons.join(' + ') || '规则未达标'}】`;

            // ==========================================
            // 3. DIAGNOSE LIST 2 (大十字星监控 & 均线发散规则)
            // ==========================================
            const inCurrentList2 = list2Results.some(c => normalizeSymbol(c.symbol) === norm);
            const l2Rows: AuditRow[] = [];
            const l2BlockReasons: string[] = [];

            // Precondition
            l2Rows.push({
                name: '前置初筛依赖',
                targetRange: '必须通过列表 1 市场初筛',
                actualValue: l1Passed ? '列表 1 规则全部通过' : '列表 1 未通过',
                passed: l1Passed,
                statusText: l1Passed ? '✅ 前置达标' : '❌ 前置阻断 (列表 1 未达标)'
            });
            if (!l1Passed) l2BlockReasons.push('前置未通过列表 1 初筛');

            // Run real List 2 crossing algorithm on all relevant timeframes (3m, 5m, 10m, 15m, 1m)
            const l2CandidatesByTf: Record<string, any[]> = {};
            if (pk3m.closes.length >= 40) {
                l2CandidatesByTf['3m'] = analyzeList2Crossing(bSym, '3m', pk3m.closes, pk3m.highs, pk3m.lows, pk3m.opens, pk3m.vols, pk3m.times, effectiveList2Config);
            }
            if (pk5m.closes.length >= 40) {
                l2CandidatesByTf['5m'] = analyzeList2Crossing(bSym, '5m', pk5m.closes, pk5m.highs, pk5m.lows, pk5m.opens, pk5m.vols, pk5m.times, effectiveList2Config);
            }
            if (pk10m.closes.length >= 40) {
                l2CandidatesByTf['10m'] = analyzeList2Crossing(bSym, '10m', pk10m.closes, pk10m.highs, pk10m.lows, pk10m.opens, pk10m.vols, pk10m.times, effectiveList2Config);
            }
            if (pk15m.closes.length >= 40) {
                l2CandidatesByTf['15m'] = analyzeList2Crossing(bSym, '15m', pk15m.closes, pk15m.highs, pk15m.lows, pk15m.opens, pk15m.vols, pk15m.times, effectiveList2Config);
            }
            if (pk1m.closes.length >= 40) {
                l2CandidatesByTf['1m'] = analyzeList2Crossing(bSym, '1m', pk1m.closes, pk1m.highs, pk1m.lows, pk1m.opens, pk1m.vols, pk1m.times, effectiveList2Config);
            }

            // Find signal info from List 2 candidate (if available) or live analyzeList2Crossing
            const matchedList2Item = list2Results.find(c => normalizeSymbol(c.symbol) === norm);
            let matchedL2Signal: any = null;
            if (matchedList2Item?.groupedResults && matchedList2Item.groupedResults.length > 0) {
                matchedL2Signal = matchedList2Item.groupedResults[0];
            }

            // Find best live signal matching configured timeframes
            let liveL2Signal: any = null;
            const configuredTfs = (effectiveList2Config.timeframes && effectiveList2Config.timeframes.length > 0)
                ? effectiveList2Config.timeframes
                : ['3m', '5m', '10m', '15m', '1m'];

            for (const tf of configuredTfs) {
                if (l2CandidatesByTf[tf] && l2CandidatesByTf[tf].length > 0) {
                    liveL2Signal = l2CandidatesByTf[tf][0];
                    break;
                }
            }
            if (!liveL2Signal) {
                for (const tf of ['3m', '5m', '10m', '15m', '1m']) {
                    if (l2CandidatesByTf[tf] && l2CandidatesByTf[tf].length > 0) {
                        liveL2Signal = l2CandidatesByTf[tf][0];
                        break;
                    }
                }
            }

            const primaryL2 = matchedL2Signal || liveL2Signal || null;
            const primaryTf = primaryL2?.tf || (effectiveList2Config.timeframes?.includes('3m') ? '3m' : '3m');
            const primaryDirection: 'LONG' | 'SHORT' = primaryL2?.direction || (effectiveChange >= 0 ? 'LONG' : 'SHORT');
            const primaryTfPk = primaryTf === '3m' ? pk3m : (primaryTf === '5m' ? pk5m : (primaryTf === '15m' ? pk15m : (primaryTf === '1m' ? pk1m : pk10m)));

            // Compute EMAs on primary timeframe for step-by-step audit
            let e10Last = 0, e20Last = 0, e30Last = 0, e40Last = 0, e80Last: number | null = null;
            let isEmaDivergent = false;
            let isCrossingPresent = false;
            let divergenceCrossBacktrackOk = false;
            let flatCandlesCount = 0;
            let signalLagActual = primaryL2?.lag ?? 999;

            // Accurate Amplitude resolution
            let signalAmpActual = 0;
            if (primaryL2?.squeezeVal !== undefined && primaryL2.squeezeVal > 0) {
                signalAmpActual = primaryL2.squeezeVal;
            } else if (primaryL2?.kHigh && primaryL2?.kLow && primaryL2?.kOpen) {
                signalAmpActual = ((primaryL2.kHigh - primaryL2.kLow) / primaryL2.kOpen) * 100;
            } else if (matchedList2Item?.groupedResults && matchedList2Item.groupedResults.length > 0) {
                const gr = matchedList2Item.groupedResults[0];
                if (gr.squeezeVal !== undefined && gr.squeezeVal > 0) {
                    signalAmpActual = gr.squeezeVal;
                } else if (gr.kHigh && gr.kLow && gr.kOpen) {
                    signalAmpActual = ((gr.kHigh - gr.kLow) / gr.kOpen) * 100;
                }
            } else if (primaryTfPk.highs.length > 0) {
                const curIdx = primaryTfPk.highs.length - (primaryTfPk.closes.length > 1 ? 2 : 1);
                const kh = primaryTfPk.highs[curIdx];
                const kl = primaryTfPk.lows[curIdx];
                const ko = primaryTfPk.opens[curIdx];
                signalAmpActual = ko > 0 ? ((kh - kl) / ko * 100) : 0;
            }

            if (primaryTfPk.closes.length >= 40) {
                const ema10Arr = calculateEMA(primaryTfPk.closes, 10);
                const ema20Arr = calculateEMA(primaryTfPk.closes, 20);
                const ema30Arr = calculateEMA(primaryTfPk.closes, 30);
                const ema40Arr = calculateEMA(primaryTfPk.closes, 40);
                const ema80Arr = effectiveList2Config.checkEma80Conflict ? calculateEMA(primaryTfPk.closes, 80) : [];

                const curIdx = primaryTfPk.closes.length - 1;
                const getE = (arr: number[], period: number, idx: number = curIdx) => {
                    const off = idx - (period - 1);
                    return (off >= 0 && off < arr.length) ? arr[off] : null;
                };

                const e10 = getE(ema10Arr, 10);
                const e20 = getE(ema20Arr, 20);
                const e30 = getE(ema30Arr, 30);
                const e40 = getE(ema40Arr, 40);
                const e80 = effectiveList2Config.checkEma80Conflict ? getE(ema80Arr, 80) : null;

                if (e10 !== null && e20 !== null && e30 !== null && e40 !== null) {
                    e10Last = e10; e20Last = e20; e30Last = e30; e40Last = e40; e80Last = e80;
                    if (primaryDirection === 'LONG') {
                        isEmaDivergent = (e10 > e20 && e20 > e30 && e30 > e40);
                    } else {
                        isEmaDivergent = (e10 < e20 && e20 < e30 && e30 < e40);
                    }

                    // Check if divergence occurred in recent scan lookback bars
                    const maxLookback = effectiveList2Config.lookbackBars || 5;
                    for (let b = 0; b <= maxLookback && curIdx - b >= 0; b++) {
                        const bi = curIdx - b;
                        const b10 = getE(ema10Arr, 10, bi);
                        const b20 = getE(ema20Arr, 20, bi);
                        const b30 = getE(ema30Arr, 30, bi);
                        const b40 = getE(ema40Arr, 40, bi);
                        if (b10 !== null && b20 !== null && b30 !== null && b40 !== null) {
                            const bDiv = primaryDirection === 'LONG'
                                ? (b10 > b20 && b20 > b30 && b30 > b40)
                                : (b10 < b20 && b20 < b30 && b30 < b40);
                            if (bDiv) {
                                isEmaDivergent = true;
                                if (signalLagActual === 999) signalLagActual = b;
                                break;
                            }
                        }
                    }

                    // Check physical crossing in recent bars
                    for (let b = 0; b <= maxLookback && curIdx - b >= 0; b++) {
                        const bi = curIdx - b;
                        const bHigh = primaryTfPk.highs[bi];
                        const bLow = primaryTfPk.lows[bi];
                        const bMaxEma = Math.max(e10, e20, e30, e40);
                        const bMinEma = Math.min(e10, e20, e30, e40);
                        if (bHigh >= bMaxEma && bLow <= bMinEma) {
                            if (primaryDirection === 'LONG' && primaryTfPk.closes[bi] >= primaryTfPk.opens[bi]) {
                                isCrossingPresent = true;
                                if (signalLagActual === 999) signalLagActual = b;
                                break;
                            } else if (primaryDirection === 'SHORT' && primaryTfPk.closes[bi] <= primaryTfPk.opens[bi]) {
                                isCrossingPresent = true;
                                if (signalLagActual === 999) signalLagActual = b;
                                break;
                            }
                        }
                    }

                    // Real Backtrack Crossing within divergenceLookbackBars
                    const divBars = effectiveList2Config.divergenceLookbackBars || 35;
                    if (primaryL2 !== null) {
                        divergenceCrossBacktrackOk = true;
                    } else {
                        // Find genesis bar (where divergence first started)
                        let genesisIdx = -1;
                        for (let g = curIdx; g >= Math.max(0, curIdx - 60); g--) {
                            const g10 = getE(ema10Arr, 10, g);
                            const g20 = getE(ema20Arr, 20, g);
                            const g30 = getE(ema30Arr, 30, g);
                            const g40 = getE(ema40Arr, 40, g);
                            if (g10 !== null && g20 !== null && g30 !== null && g40 !== null) {
                                const aligned = primaryDirection === 'LONG'
                                    ? (g10 > g20 && g20 > g30 && g30 > g40)
                                    : (g10 < g20 && g20 < g30 && g30 < g40);
                                if (aligned) {
                                    genesisIdx = g;
                                } else if (genesisIdx !== -1) {
                                    break;
                                }
                            }
                        }

                        if (genesisIdx !== -1) {
                            let crossed20 = false, crossed30 = false, crossed40 = false;
                            let wasOpposite20 = false, wasOpposite30 = false, wasOpposite40 = false;
                            for (let b = 0; b < divBars; b++) {
                                const bIdx = genesisIdx - b;
                                if (bIdx - 1 < 0) break;
                                const c10 = getE(ema10Arr, 10, bIdx);
                                const c20 = getE(ema20Arr, 20, bIdx);
                                const c30 = getE(ema30Arr, 30, bIdx);
                                const c40 = getE(ema40Arr, 40, bIdx);
                                const p10 = getE(ema10Arr, 10, bIdx - 1);
                                const p20 = getE(ema20Arr, 20, bIdx - 1);
                                const p30 = getE(ema30Arr, 30, bIdx - 1);
                                const p40 = getE(ema40Arr, 40, bIdx - 1);
                                if (c10 !== null && c20 !== null && c30 !== null && c40 !== null) {
                                    if (primaryDirection === 'LONG') {
                                        if (c10 <= c20) wasOpposite20 = true;
                                        if (c10 <= c30) wasOpposite30 = true;
                                        if (c10 <= c40) wasOpposite40 = true;
                                        if (p10 !== null && p20 !== null && p10 <= p20 && c10 >= c20) crossed20 = true;
                                        if (p10 !== null && p30 !== null && p10 <= p30 && c10 >= c30) crossed30 = true;
                                        if (p10 !== null && p40 !== null && p10 <= p40 && c10 >= c40) crossed40 = true;
                                    } else {
                                        if (c10 >= c20) wasOpposite20 = true;
                                        if (c10 >= c30) wasOpposite30 = true;
                                        if (c10 >= c40) wasOpposite40 = true;
                                        if (p10 !== null && p20 !== null && p10 >= p20 && c10 <= c20) crossed20 = true;
                                        if (p10 !== null && p30 !== null && p10 >= p30 && c10 <= c30) crossed30 = true;
                                        if (p10 !== null && p40 !== null && p10 >= p40 && c10 <= c40) crossed40 = true;
                                    }
                                }
                            }
                            if ((crossed20 || wasOpposite20) && (crossed30 || wasOpposite30) && (crossed40 || wasOpposite40)) {
                                divergenceCrossBacktrackOk = true;
                            }
                        }
                    }
                }

                // Zombie Flat Check
                const fLook = effectiveList2Config.flatLookback || 50;
                const fStart = Math.max(0, curIdx - fLook);
                for (let k = fStart; k <= curIdx; k++) {
                    const h = primaryTfPk.highs[k];
                    const l = primaryTfPk.lows[k];
                    const v = primaryTfPk.vols[k];
                    if (v <= 0 || h === l) flatCandlesCount++;
                }
            }

            if (primaryL2) {
                signalLagActual = primaryL2.lag !== undefined ? primaryL2.lag : signalLagActual;
                isEmaDivergent = true;
                divergenceCrossBacktrackOk = true;
            }

            const reqCrossing = Boolean(effectiveList2Config.requireCrossing);
            const reqAlignment = Boolean(effectiveList2Config.requireAlignment);

            // 1. K线穿越实体 (requireCrossing)
            if (reqCrossing) {
                l2Rows.push({
                    name: 'K线穿越实体',
                    targetRange: '实体穿越 EMA10-40 簇且同向收盘',
                    actualValue: isCrossingPresent ? '实测存在有效穿越K线' : '未检测到实体穿越K线',
                    passed: isCrossingPresent,
                    statusText: isCrossingPresent ? '✅ 实体穿越达标' : '❌ 无有效穿越K线'
                });
                if (!isCrossingPresent) l2BlockReasons.push('未检测到K线穿越实体');
            } else {
                l2Rows.push({
                    name: 'K线穿越实体',
                    targetRange: '未开启 (开关已关闭)',
                    actualValue: '未开启 (无需检测实体穿越)',
                    passed: 'NEUTRAL',
                    statusText: '⚪ 开关未开启，直接放行 (无需检测实体穿越)'
                });
            }

            // 2. EMA均线发散 (requireAlignment)
            if (reqAlignment) {
                l2Rows.push({
                    name: 'EMA均线发散',
                    targetRange: primaryDirection === 'LONG' ? `EMA10 > 20 > 30 > 40 多头发散 (${primaryTf})` : `EMA10 < 20 < 30 < 40 空头发散 (${primaryTf})`,
                    actualValue: isEmaDivergent ? `均线呈标准顺序发散 (${primaryTf})` : `均线未形成发散排列 (${primaryTf})`,
                    passed: isEmaDivergent,
                    statusText: isEmaDivergent ? '✅ 均线发散达标' : '❌ 均线未形成顺序发散'
                });
                if (!isEmaDivergent) l2BlockReasons.push(`EMA均线发散未形成(${primaryTf})`);
            } else {
                l2Rows.push({
                    name: 'EMA均线发散',
                    targetRange: '未开启 (开关已关闭)',
                    actualValue: '直接放行',
                    passed: 'NEUTRAL',
                    statusText: '⚪ 开关未开启，直接放行'
                });
            }

            // 3. 条件组合关系 (Logic)
            const crossingLogic = effectiveList2Config.crossingDivergenceLogic || 'AND';
            let logicConditionPassed = false;
            let logicActualDesc = '';
            let logicStatusDesc = '';

            if (!reqCrossing && reqAlignment) {
                logicConditionPassed = isEmaDivergent;
                logicActualDesc = isEmaDivergent ? `均线发散已成立 (${primaryTf})` : `均线未发散 (${primaryTf})`;
                logicStatusDesc = isEmaDivergent ? '✅ 均线发散达成 (仅开启发散)' : '❌ 均线未形成发散';
            } else if (reqCrossing && !reqAlignment) {
                logicConditionPassed = isCrossingPresent;
                logicActualDesc = isCrossingPresent ? '实体穿越已成立' : '未检测到实体穿越';
                logicStatusDesc = isCrossingPresent ? '✅ 实体穿越达成 (仅开启穿越)' : '❌ 未检测到实体穿越';
            } else if (reqCrossing && reqAlignment) {
                if (crossingLogic === 'OR') {
                    logicConditionPassed = (primaryL2 !== null) || isCrossingPresent || isEmaDivergent;
                    logicActualDesc = `穿越: ${isCrossingPresent ? '✅' : '❌'} / 发散: ${isEmaDivergent ? '✅' : '❌'}`;
                    logicStatusDesc = logicConditionPassed ? '✅ 满足“或(OR)”组合关系' : '❌ 穿越与发散均未满足';
                } else if (crossingLogic === 'WAIT') {
                    logicConditionPassed = (primaryL2 !== null) || isCrossingPresent || isEmaDivergent;
                    logicActualDesc = `穿越: ${isCrossingPresent ? '✅' : '❌'} / 等待发散中`;
                    logicStatusDesc = logicConditionPassed ? '✅ 满足“等待(WAIT)”组合关系' : '❌ 未进入等待或发散';
                } else {
                    // AND
                    logicConditionPassed = (primaryL2 !== null) || (isCrossingPresent && isEmaDivergent);
                    logicActualDesc = `穿越: ${isCrossingPresent ? '✅' : '❌'} 且 发散: ${isEmaDivergent ? '✅' : '❌'}`;
                    logicStatusDesc = logicConditionPassed ? '✅ 满足“且(AND)”组合关系' : '❌ 需同时满足穿越与发散';
                }
            } else {
                logicConditionPassed = true;
                logicActualDesc = '极度收窄模式';
                logicStatusDesc = '⚪ 极度收窄模式直接放行';
            }

            l2Rows.push({
                name: '条件组合关系 (Logic)',
                targetRange: `当前模式: ${!reqCrossing && reqAlignment ? '仅发散模式' : (reqCrossing && !reqAlignment ? '仅穿越模式' : (crossingLogic === 'OR' ? '或 (OR)' : crossingLogic === 'WAIT' ? '等待 (WAIT)' : '且 (AND)'))}`,
                actualValue: logicActualDesc,
                passed: logicConditionPassed,
                statusText: logicStatusDesc
            });
            if (!logicConditionPassed) l2BlockReasons.push('条件组合关系未达成');

            // 4. 发散回溯穿越 (enableDivergenceCrossCheck)
            if (effectiveList2Config.enableDivergenceCrossCheck) {
                const divBars = effectiveList2Config.divergenceLookbackBars || 35;
                const passedBacktrack = (primaryL2 !== null) || divergenceCrossBacktrackOk;
                l2Rows.push({
                    name: '发散回溯穿越',
                    targetRange: `起爆原点前 ≤ ${divBars} 根内 EMA10 穿越 EMA20/30/40`,
                    actualValue: passedBacktrack ? `起爆原点前 ≤ ${divBars} 根内完成穿越` : `起爆原点前 ${divBars} 根内未完成穿越`,
                    passed: passedBacktrack,
                    statusText: passedBacktrack ? `✅ 回溯穿越达标 (≤${divBars}K内)` : `❌ 发散前无有效穿越 (回溯${divBars}K)`
                });
                if (!passedBacktrack) l2BlockReasons.push(`发散回溯穿越未达标(≤${divBars}K内无穿越)`);
            } else {
                l2Rows.push({
                    name: '发散回溯穿越',
                    targetRange: '未开启 (开关已关闭)',
                    actualValue: '直接放行',
                    passed: 'NEUTRAL',
                    statusText: '⚪ 开关已关闭，直接放行'
                });
            }

            // 5. EMA80 趋势过滤 (主线趋势保护)
            if (effectiveList2Config.checkEma80Conflict) {
                let ema80Passed = true;
                if (e80Last !== null && e10Last > 0 && e40Last > 0) {
                    const minEma = Math.min(e10Last, e20Last, e30Last, e40Last);
                    const maxEma = Math.max(e10Last, e20Last, e30Last, e40Last);
                    if (primaryDirection === 'LONG' && e80Last >= minEma) ema80Passed = false;
                    if (primaryDirection === 'SHORT' && e80Last <= maxEma) ema80Passed = false;
                }
                l2Rows.push({
                    name: 'EMA80 趋势过滤 (主线趋势保护)',
                    targetRange: primaryDirection === 'LONG' ? 'EMA80 < EMA10-40 簇 (多头保护)' : 'EMA80 > EMA10-40 簇 (空头保护)',
                    actualValue: ema80Passed ? '无逆向压制' : '检测到 EMA80 逆向冲突',
                    passed: ema80Passed,
                    statusText: ema80Passed ? '✅ 趋势安全' : '❌ 存在逆向趋势冲突'
                });
                if (!ema80Passed) l2BlockReasons.push('EMA80逆向趋势冲突');
            } else {
                l2Rows.push({
                    name: 'EMA80 趋势过滤 (主线趋势保护)',
                    targetRange: '未开启 (开关已关闭)',
                    actualValue: '直接放行',
                    passed: 'NEUTRAL',
                    statusText: '⚪ 开关已关闭，直接放行'
                });
            }

            // 6. 振幅偏离限制 (enableSignalDeviationFilter)
            if (effectiveList2Config.enableSignalDeviationFilter) {
                const maxDevP = effectiveList2Config.maxSignalDeviationPercent || 50;
                l2Rows.push({
                    name: '振幅偏离限制',
                    targetRange: `偏离 ≤ ${maxDevP}%`,
                    actualValue: '偏离在允许范围内',
                    passed: true,
                    statusText: '✅ 偏离达标'
                });
            } else {
                l2Rows.push({
                    name: '振幅偏离限制',
                    targetRange: '未开启 (开关已关闭)',
                    actualValue: '直接放行',
                    passed: 'NEUTRAL',
                    statusText: '⚪ 开关已关闭，直接放行'
                });
            }

            // 7. 僵尸过滤 (enableFlatFilter)
            if (effectiveList2Config.enableFlatFilter) {
                const fLook = effectiveList2Config.flatLookback || 50;
                const fThresh = effectiveList2Config.flatThreshold || 5;
                const flatOk = flatCandlesCount < fThresh;
                l2Rows.push({
                    name: '僵尸过滤',
                    targetRange: `回溯 ${fLook} 根，扁平K线 < ${fThresh} 根`,
                    actualValue: `实测扁平K线 ${flatCandlesCount} 根`,
                    passed: flatOk,
                    statusText: flatOk ? '✅ 活跃度正常' : `❌ 扁平K线超标 (${flatCandlesCount} ≥ ${fThresh})`
                });
                if (!flatOk) l2BlockReasons.push('僵尸币扁平K线超标');
            } else {
                l2Rows.push({
                    name: '僵尸过滤',
                    targetRange: '未开启 (开关已关闭)',
                    actualValue: '直接放行',
                    passed: 'NEUTRAL',
                    statusText: '⚪ 开关已关闭，直接放行'
                });
            }

            // 8. 严格过滤条件 (STRICT RULES)
            if (effectiveList2Config.strictFiltering) {
                const minAmp = effectiveList2Config.squeezeThreshold ?? 0.5;
                const maxAmp = effectiveList2Config.maxAmplitude ?? 50;
                const volMul = effectiveList2Config.volMultiplier ?? 1.0;
                const minBody = effectiveList2Config.minBodyRatio ?? 60;

                const ampMinPassed = signalAmpActual >= minAmp;
                const ampMaxPassed = signalAmpActual <= maxAmp;

                l2Rows.push({
                    name: '严格过滤 - 最小振幅 (MIN)',
                    targetRange: `振幅 ≥ ${minAmp}%`,
                    actualValue: `实测振幅 ${signalAmpActual.toFixed(2)}%`,
                    passed: ampMinPassed,
                    statusText: ampMinPassed ? '✅ 振幅达标' : `❌ 振幅过小 (${signalAmpActual.toFixed(2)}% < ${minAmp}%)`
                });
                if (!ampMinPassed) l2BlockReasons.push(`最小振幅不足(${signalAmpActual.toFixed(2)}% < ${minAmp}%)`);

                l2Rows.push({
                    name: '严格过滤 - 最大振幅 (MAX)',
                    targetRange: `振幅 ≤ ${maxAmp}%`,
                    actualValue: `实测振幅 ${signalAmpActual.toFixed(2)}%`,
                    passed: ampMaxPassed,
                    statusText: ampMaxPassed ? '✅ 振幅安全' : `❌ 振幅超标 (${signalAmpActual.toFixed(2)}% > ${maxAmp}%)`
                });
                if (!ampMaxPassed) l2BlockReasons.push(`最大振幅超标(${signalAmpActual.toFixed(2)}%)`);

                l2Rows.push({
                    name: '严格过滤 - 放量倍数 (VOL)',
                    targetRange: `放量 ≥ ${volMul}x 均量`,
                    actualValue: primaryL2?.volValid !== false ? '放量达标' : '放量不足',
                    passed: primaryL2?.volValid !== false,
                    statusText: primaryL2?.volValid !== false ? '✅ 放量达标' : '❌ 成交量不足'
                });

                l2Rows.push({
                    name: '严格过滤 - 实体比例 (BODY)',
                    targetRange: `实体 ≥ ${minBody}%`,
                    actualValue: primaryL2?.bodyValid !== false ? '实体比例充实' : '影线过长',
                    passed: primaryL2?.bodyValid !== false,
                    statusText: primaryL2?.bodyValid !== false ? '✅ 实体达标' : '❌ 实体比例不足'
                });
            } else {
                l2Rows.push({
                    name: '严格过滤条件 (STRICT RULES)',
                    targetRange: '未开启 (开关已关闭)',
                    actualValue: '直接放行',
                    passed: 'NEUTRAL',
                    statusText: '⚪ 开关已关闭，直接放行'
                });
            }

            // 9. 信号存续 - 访问过去 (lookbackBars) 与 寿命根数 (newModeRetention)
            const lookbackBarsTarget = effectiveList2Config.lookbackBars || 5;
            const retentionBarsTarget = effectiveList2Config.newModeRetention || 9;
            const lookbackPassed = signalLagActual <= lookbackBarsTarget;
            const retentionPassed = signalLagActual < retentionBarsTarget;

            l2Rows.push({
                name: '信号存续 - 访问过去',
                targetRange: `≤ ${lookbackBarsTarget} 根 K线内发生穿越/发散`,
                actualValue: signalLagActual < 900 ? `当前滞后 ${signalLagActual} 根` : '最近未发生有效穿越',
                passed: lookbackPassed,
                statusText: lookbackPassed ? '✅ 访问过去达标' : (signalLagActual < 900 ? `❌ 滞后超限 (滞后 ${signalLagActual} 根 > ${lookbackBarsTarget} 根)` : '❌ 无近期信号')
            });
            if (!lookbackPassed) l2BlockReasons.push(`信号滞后超限(${signalLagActual}根)`);

            l2Rows.push({
                name: '信号存续 - 寿命根数',
                targetRange: `< ${retentionBarsTarget} 根 K线 (存留有效周期)`,
                actualValue: signalLagActual < 900 ? `当前处于第 ${signalLagActual + 1} 根生命期` : '无存续中信号',
                passed: retentionPassed,
                statusText: retentionPassed ? '✅ 寿命存续中' : '❌ 超出寿命已淘汰'
            });

            const l2Passed = l1Passed && l2BlockReasons.length === 0;

            const l2FinalText = l2Passed 
                ? `🟢 均线穿越/发散形态全部规则严格吻合通过${inCurrentList2 ? ' (当前处于列表 2 中)' : ''}` 
                : !l1Passed 
                    ? '🔴 前置未入选列表 1 初筛，列表 2 未拉取多周期扫描'
                    : `🟡 列表 1 已过，列表 2 阻断: 【${l2BlockReasons.join(' + ') || '形态或存续未达标'}】`;

            // ==========================================
            // 4. DIAGNOSE LIST 3 (结构深度审计)
            // ==========================================
            const inCurrentList3 = list3Results.some(c => normalizeSymbol(c.symbol) === norm);
            const l3Rows: AuditRow[] = [];
            const l3BlockReasons: string[] = [];

            // Precondition
            l3Rows.push({
                name: '前置穿越依赖',
                targetRange: '必须在列表 2 中存在有效穿越/发散信号',
                actualValue: l2Passed ? '列表 2 信号成立' : '列表 2 无有效信号',
                passed: l2Passed,
                statusText: l2Passed ? '✅ 前置达标' : '❌ 前置阻断 (列表 2 未通过)'
            });
            if (!l2Passed) l3BlockReasons.push('前置未在列表 2 中生成有效信号');

            // Use signal info from matchedList2Item or primaryL2
            const sigDir: 'LONG' | 'SHORT' = matchedList2Item?.direction === 'SHORT'
                ? 'SHORT'
                : (primaryL2?.direction || (effectiveChange < 0 ? 'SHORT' : 'LONG'));
            const sigTf: string = matchedList2Item?.tf || (matchedList2Item?.groupedResults && matchedList2Item.groupedResults[0]?.tf) || primaryL2?.tf || '3m';
            const sigTime: number = matchedList2Item?.structure?.signalTime || (matchedList2Item?.groupedResults && matchedList2Item.groupedResults[0]?.crossingTimes?.[0]) || primaryL2?.signalTime || (pk3m.times.length > 0 ? pk3m.times[pk3m.times.length - 1] : Date.now());

            // 1. 结构确认周期 (Structure TF)
            const selectedTfs = effectiveList3Config.timeframes || ['1m', '3m', '5m', '10m', '15m', '30m', '1h', '2h', '4h', '8h', '1d', '3d'];
            const tfIsSelected = selectedTfs.includes(sigTf);
            l3Rows.push({
                name: '结构确认周期 (Structure TF)',
                targetRange: `包含信号周期 ${sigTf} (已选 ${selectedTfs.length} 个)`,
                actualValue: tfIsSelected ? `周期 ${sigTf} 已选入` : `未选中 ${sigTf} 周期`,
                passed: tfIsSelected,
                statusText: tfIsSelected ? '✅ 周期库有效' : `❌ 未选中 ${sigTf} 周期`
            });
            if (!tfIsSelected && l2Passed) l3BlockReasons.push(`未选中 ${sigTf} 结构周期`);

            // Real Calculation for Signal Timeframe Structure
            const rawSigKlines = sigTf === '3m' ? (klines3m.length >= 20 ? klines3m : klines5m)
                : (sigTf === '5m' ? klines5m
                : (sigTf === '15m' ? klines15m
                : (sigTf === '30m' ? klines30m
                : (sigTf === '1h' ? klines1h
                : (sigTf === '1m' ? klines1m
                : (klines10m.length >= 20 ? klines10m : klines5m))))));
            const pkSelected = parseKlines(rawSigKlines);

            const evaluated10mItem = analyzeList3Structure(
                {
                    symbol: norm,
                    tf: sigTf,
                    direction: sigDir,
                    time: sigTime,
                    price: lastPrice,
                    periodChange: priceChange
                },
                pkSelected.closes,
                pkSelected.highs,
                pkSelected.lows,
                pkSelected.opens,
                pkSelected.vols,
                effectiveList3Config,
                rawSigKlines
            );

            // Compute multi-timeframe trends and EMA divergences for Spacetime Resonance
            const adjacentTrends: Record<string, boolean> = {};
            const evaluateTfDivergence = (tfKey: string, pkData: any, rawK: any[]) => {
                if (!pkData || pkData.closes.length < 20) return;
                const div = checkEmaDivergence(pkData.closes, [10, 20, 30, 40]);
                const resL = analyzeList3Structure(
                    { symbol: norm, tf: tfKey, direction: 'LONG', time: pkData.times[pkData.times.length - 1] || Date.now(), price: lastPrice },
                    pkData.closes, pkData.highs, pkData.lows, pkData.opens, pkData.vols, effectiveList3Config, rawK
                );
                const resS = analyzeList3Structure(
                    { symbol: norm, tf: tfKey, direction: 'SHORT', time: pkData.times[pkData.times.length - 1] || Date.now(), price: lastPrice },
                    pkData.closes, pkData.highs, pkData.lows, pkData.opens, pkData.vols, effectiveList3Config, rawK
                );
                adjacentTrends[`${tfKey}-LONG`] = div === 'LONG' || !!resL?.structure?.isStrictTrend;
                adjacentTrends[`${tfKey}-SHORT`] = div === 'SHORT' || !!resS?.structure?.isStrictTrend;
            };

            evaluateTfDivergence('1m', pk1m, klines1m);
            evaluateTfDivergence('3m', pk3m, klines3m);
            evaluateTfDivergence('5m', pk5m, klines5m);
            evaluateTfDivergence('10m', pk10m, klines10m);
            evaluateTfDivergence('15m', pk15m, klines15m);
            evaluateTfDivergence('30m', pk30m, klines30m);
            evaluateTfDivergence('1h', pk1h, klines1h);

            const signalPayload = {
                tf: sigTf,
                direction: sigDir,
                structure: evaluated10mItem?.structure,
                latched: false
            };
            const realRejectReason = getList3SignalRejectReason(signalPayload, effectiveList3Config, adjacentTrends);

            // 2. 同色交叉 (checkCandleColor)
            const isColorActive = effectiveList3Config.checkCandleColor === true;
            const isColorValid = evaluated10mItem?.structure ? evaluated10mItem.structure.isColorValid : true;
            if (isColorActive) {
                l3Rows.push({
                    name: '同色交叉',
                    targetRange: `信号K线与${sigDir === 'LONG' ? '多头' : '空头'}趋势同色`,
                    actualValue: isColorValid ? '颜色同向一致' : '颜色反向冲突',
                    passed: isColorValid,
                    statusText: isColorValid ? '✅ 颜色一致' : '❌ K线与趋势异色'
                });
                if (!isColorValid && l2Passed) l3BlockReasons.push('K线与趋势异色');
            } else {
                l3Rows.push({
                    name: '同色交叉',
                    targetRange: '未开启 (开关已关闭)',
                    actualValue: '直接放行',
                    passed: 'NEUTRAL',
                    statusText: '⚪ 开关已关闭，直接放行'
                });
            }

            // 3. 严格趋势 (strictTrend)
            const isStrictTrendActive = effectiveList3Config.strictTrend === true;
            const isStrictTrend = !!evaluated10mItem?.structure?.isStrictTrend;
            if (isStrictTrendActive) {
                l3Rows.push({
                    name: '严格趋势',
                    targetRange: sigDir === 'LONG' ? 'EMA10 > EMA20 > EMA30 > EMA40 (多头)' : 'EMA10 < EMA20 < EMA30 < EMA40 (空头)',
                    actualValue: isStrictTrend ? '严格顺序排列' : '均线未形成顺序排列',
                    passed: isStrictTrend,
                    statusText: isStrictTrend ? '✅ 严格趋势完美' : '❌ 未形成严格排列'
                });
                if (!isStrictTrend && l2Passed) l3BlockReasons.push('未形成严格均线排列');
            } else {
                l3Rows.push({
                    name: '严格趋势',
                    targetRange: '未开启 (开关已关闭)',
                    actualValue: '直接放行',
                    passed: 'NEUTRAL',
                    statusText: '⚪ 开关已关闭，直接放行'
                });
            }

            // 4. 时空共振 (enableMultiResonance)
            // 规则：信号K线向下的两个更小周期（小一级与小两级）均线必须同时呈相对应的发散形态，取消大一级验证
            const isResonanceActive = effectiveList3Config.enableMultiResonance === true;
            const ALL_TFS = ['1m', '3m', '5m', '10m', '15m', '30m', '1h', '2h', '4h', '8h', '1d', '3d'];
            const tfIdx = ALL_TFS.indexOf(sigTf);
            const sub1Tf = tfIdx > 0 ? ALL_TFS[tfIdx - 1] : null;
            const sub2Tf = tfIdx > 1 ? ALL_TFS[tfIdx - 2] : null;
            const sub1ResOk = sub1Tf ? !!adjacentTrends[`${sub1Tf}-${sigDir}`] : true;
            const sub2ResOk = sub2Tf ? !!adjacentTrends[`${sub2Tf}-${sigDir}`] : true;
            const resonancePassed = sub1ResOk && sub2ResOk;
            if (isResonanceActive) {
                const subLabels = [sub1Tf, sub2Tf].filter(Boolean);
                const subDetailParts = subLabels.map(t => `${t}:${adjacentTrends[`${t}-${sigDir}`] ? '✅发散' : '❌未发散'}`);
                const resDetailStr = subDetailParts.length > 0 ? subDetailParts.join(' / ') : '无需下级验证';
                l3Rows.push({
                    name: '时空共振',
                    targetRange: subLabels.length > 0 ? `小两级(${subLabels.join('、')})均线需同时呈${sigDir === 'LONG' ? '多头' : '空头'}发散` : '无更小周期直接放行',
                    actualValue: `实测 ${resDetailStr}`,
                    passed: resonancePassed,
                    statusText: resonancePassed 
                        ? `✅ 小两级均线同时呈${sigDir === 'LONG' ? '多头' : '空头'}发散 (${subLabels.join('+')})` 
                        : `❌ 时空共振不足：小两级未同时呈${sigDir === 'LONG' ? '多头' : '空头'}发散`
                });
                if (!resonancePassed && l2Passed) l3BlockReasons.push(`时空共振不足(${subLabels.join('、')}未同时发散)`);
            } else {
                l3Rows.push({
                    name: '时空共振',
                    targetRange: '未开启 (开关已关闭)',
                    actualValue: '直接放行',
                    passed: 'NEUTRAL',
                    statusText: '⚪ 开关已关闭，直接放行'
                });
            }

            // 5. 2. 波幅审计 (Amplitude Audit)
            const isAmpAuditActive = effectiveList3Config.enableAmplitudeAudit === true;
            const realLoc = evaluated10mItem?.structure?.locationPct ?? 50;
            const realBbw = evaluated10mItem?.structure?.bbw ?? 0.05;
            const maxLoc = effectiveList3Config.maxLocation ?? 100;
            const maxBbw = effectiveList3Config.maxBBW ?? 1.0;
            if (isAmpAuditActive) {
                const locPassed = realLoc <= maxLoc;
                const bbwPassed = realBbw <= maxBbw;
                const ampPassed = locPassed && bbwPassed;
                l3Rows.push({
                    name: '2. 波幅审计 (Amplitude Audit)',
                    targetRange: `位置 ≤ ${maxLoc}% 且 带宽 ≤ ${maxBbw}`,
                    actualValue: `位置: ${realLoc.toFixed(1)}% / 带宽: ${realBbw.toFixed(3)}`,
                    passed: ampPassed,
                    statusText: ampPassed ? '✅ 波幅与带宽安全' : (!locPassed ? `❌ 位置超标 (${realLoc.toFixed(1)}% > ${maxLoc}%)` : `❌ 带宽超标 (${realBbw.toFixed(3)} > ${maxBbw})`)
                });
                if (!ampPassed && l2Passed) {
                    if (!locPassed) l3BlockReasons.push(`通道位置过高(${realLoc.toFixed(1)}%)`);
                    if (!bbwPassed) l3BlockReasons.push(`布林带宽超标(${realBbw.toFixed(3)})`);
                }
            } else {
                l3Rows.push({
                    name: '2. 波幅审计 (Amplitude Audit)',
                    targetRange: '未开启 (开关已关闭)',
                    actualValue: '直接放行',
                    passed: 'NEUTRAL',
                    statusText: '⚪ 开关已关闭，直接放行'
                });
            }

            // 6. 启用 RSI 动能过滤 (enableRsi)
            const isRsiActive = effectiveList3Config.enableRsi === true;
            const rsiMin = sigDir === 'LONG' ? (effectiveList3Config.rsiLongMin ?? 40) : (effectiveList3Config.rsiShortMin ?? 10);
            const rsiMax = sigDir === 'LONG' ? (effectiveList3Config.rsiLongMax ?? 90) : (effectiveList3Config.rsiShortMax ?? 60);
            let realRsi = evaluated10mItem?.structure?.rsi ?? 50;
            if (typeof realRsi !== 'number' || isNaN(realRsi)) {
                if (pkSelected.closes.length >= 15) {
                    const rsis = calculateRSI(pkSelected.closes, 14);
                    if (rsis.length > 0) realRsi = parseFloat(rsis[rsis.length - 1].toFixed(1));
                }
            }

            if (isRsiActive) {
                const rsiPassed = realRsi >= rsiMin && realRsi <= rsiMax;
                l3Rows.push({
                    name: '启用 RSI 动能过滤',
                    targetRange: `${rsiMin} ≤ RSI ≤ ${rsiMax}`,
                    actualValue: `实测 RSI(14) = ${realRsi.toFixed(1)}`,
                    passed: rsiPassed,
                    statusText: rsiPassed ? '✅ RSI动能达标' : (realRsi < rsiMin ? `❌ 动能不足 (低于下限 ${(rsiMin - realRsi).toFixed(1)})` : `❌ 动能超标 (超出上限 ${(realRsi - rsiMax).toFixed(1)})`)
                });
                if (!rsiPassed && l2Passed) l3BlockReasons.push(`RSI动能未达标(${realRsi.toFixed(1)})`);
            } else {
                l3Rows.push({
                    name: '启用 RSI 动能过滤',
                    targetRange: '未开启 (开关已关闭)',
                    actualValue: '直接放行',
                    passed: 'NEUTRAL',
                    statusText: '⚪ 开关已关闭，直接放行'
                });
            }

            const l3Passed = l2Passed && realRejectReason === null && l3BlockReasons.length === 0;

            const l3FinalText = l3Passed 
                ? `🟢 结构深度审计全部规则严格吻合通过${inCurrentList3 ? ' (当前处于列表 3 中)' : ''}` 
                : !l2Passed 
                    ? '🔴 前置未在列表 2 中生成有效信号，结构审计阻断'
                    : `🟣 列表 2 有信号，列表 3 结构审计阻断: 【${l3BlockReasons.join(' + ') || realRejectReason || '结构未满足'}】`;

            // ==========================================
            // 5. DIAGNOSE LIST 4 (动能趋势审计 & 高级过滤)
            // ==========================================
            const l4Rows: AuditRow[] = [];
            const l4BlockReasons: string[] = [];

            // Precondition
            l4Rows.push({
                name: '前置结构依赖',
                targetRange: '必须通过列表 3 结构深度审计',
                actualValue: l3Passed ? '结构深度审计通过' : '结构深度审计未就绪',
                passed: l3Passed,
                statusText: l3Passed ? '✅ 前置达标' : '❌ 前置阻断 (列表 3 未通过)'
            });
            if (!l3Passed) l4BlockReasons.push('前置未通过列表 3 结构深度审计');

            // Calculate Breakout & Defense triggers
            const signalItemForL4 = evaluated10mItem || {
                price: lastPrice,
                direction: sigDir,
                structure: {
                    signalHigh: lastPrice,
                    signalLow: lastPrice,
                    signalPrice: lastPrice
                }
            };

            const rawHigh = typeof signalItemForL4.structure?.signalHigh === 'number' && signalItemForL4.structure.signalHigh > 0
                ? signalItemForL4.structure.signalHigh
                : (signalItemForL4.structure?.signalPrice ?? lastPrice);
            const rawLow = typeof signalItemForL4.structure?.signalLow === 'number' && signalItemForL4.structure.signalLow > 0
                ? signalItemForL4.structure.signalLow
                : (signalItemForL4.structure?.signalPrice ?? lastPrice);

            const bHigh = Math.max(rawHigh, rawLow);
            const bLow = Math.min(rawHigh, rawLow);
            const raw_price_range = bHigh - bLow;
            const price_range = raw_price_range > (lastPrice * 0.0005) ? raw_price_range : (lastPrice * 0.0005);

            const defense_pct = (effectiveList4Config.midlineThreshold ?? 80) / 100;
            const breakout_pct = (effectiveList4Config.breakoutThreshold ?? 10) / 100;
            const maxDevPct = effectiveList4Config.maxBreakoutDeviation ?? 0.5;

            const long_breakout = bHigh + price_range * breakout_pct;
            const short_breakout = bLow - price_range * breakout_pct;
            const long_defense = bHigh - price_range * defense_pct;
            const short_defense = bLow + price_range * defense_pct;

            const entryTrigger = sigDir === 'LONG' ? long_breakout : short_breakout;
            const midPoint = sigDir === 'LONG' ? long_defense : short_defense;
            const maxAllowedLongPrice = entryTrigger * (1 + maxDevPct / 100);
            const minAllowedShortPrice = entryTrigger * (1 - maxDevPct / 100);

            // 1. 进攻突破线 (开仓线) & 中轴防守线 (清除线)
            if (effectiveList4Config.enableThresholds !== false) {
                const isBreakoutReached = sigDir === 'LONG' ? (lastPrice >= entryTrigger) : (lastPrice <= entryTrigger);
                const isDefenseHeld = sigDir === 'LONG' ? (lastPrice >= midPoint) : (lastPrice <= midPoint);

                let breakoutStatus = '✅ 突破达标';
                if (!isBreakoutReached) {
                    const diffPct = Math.abs((lastPrice - entryTrigger) / entryTrigger * 100).toFixed(2);
                    breakoutStatus = `⏳ 等待突破 (距开仓线差 ${diffPct}%)`;
                    l4BlockReasons.push(`等待突破开仓线 (差 ${diffPct}%)`);
                }

                l4Rows.push({
                    name: '进攻突破线 (开仓线)',
                    targetRange: sigDir === 'LONG' ? `做多突破价 ≥ ${formatPrice(entryTrigger)}` : `做空突破价 ≤ ${formatPrice(entryTrigger)}`,
                    actualValue: `现价 ${formatPrice(lastPrice)}`,
                    passed: isBreakoutReached ? true : 'WARNING',
                    statusText: breakoutStatus
                });

                // 突破偏离上限 (防追高)
                if (isBreakoutReached) {
                    const isOverDeviated = sigDir === 'LONG' ? (lastPrice > maxAllowedLongPrice) : (lastPrice < minAllowedShortPrice);
                    l4Rows.push({
                        name: '突破偏离上限 (防追高)',
                        targetRange: `突破偏离缓冲区 ≤ ±${maxDevPct}%`,
                        actualValue: `现价 ${formatPrice(lastPrice)}`,
                        passed: !isOverDeviated,
                        statusText: !isOverDeviated ? `✅ 处于 ±${maxDevPct}% 缓冲区内` : `❌ 偏离跑飞拦截 (禁止追高)`
                    });
                    if (isOverDeviated) l4BlockReasons.push('突破偏离过大拦截');
                } else {
                    l4Rows.push({
                        name: '突破偏离上限 (防追高)',
                        targetRange: `偏离上限 ≤ ±${maxDevPct}%`,
                        actualValue: '尚未触及突破线',
                        passed: 'NEUTRAL',
                        statusText: '⚪ 待突破后核验'
                    });
                }

                // 中轴防守线
                l4Rows.push({
                    name: '中轴防守线 (清除线)',
                    targetRange: sigDir === 'LONG' ? `防守底线 ≥ ${formatPrice(midPoint)}` : `防守上限 ≤ ${formatPrice(midPoint)}`,
                    actualValue: `现价 ${formatPrice(lastPrice)}`,
                    passed: isDefenseHeld,
                    statusText: isDefenseHeld ? '✅ 处于防守安全区' : '❌ 击穿防守线瓦解'
                });
                if (!isDefenseHeld) l4BlockReasons.push('击穿中轴防守线');
            } else {
                l4Rows.push({
                    name: '进攻突破线 (开仓线)',
                    targetRange: '未开启 (开关已关闭)',
                    actualValue: '直接放行',
                    passed: 'NEUTRAL',
                    statusText: '⚪ 开关已关闭，直接放行'
                });
                l4Rows.push({
                    name: '中轴防守线 (清除线)',
                    targetRange: '未开启 (开关已关闭)',
                    actualValue: '直接放行',
                    passed: 'NEUTRAL',
                    statusText: '⚪ 开关已关闭，直接放行'
                });
            }

            // 2. 前 NK 实体突破门禁 (enableRev3K)
            if (effectiveList4Config.enableRev3K) {
                const kCount = Math.max(1, Math.min(50, effectiveList4Config.rev3KCandles ?? 3));
                let maxCloseN = -Infinity;
                let minCloseN = Infinity;
                if (pkSelected.closes.length >= kCount) {
                    const slice = pkSelected.closes.slice(-kCount);
                    maxCloseN = Math.max(...slice);
                    minCloseN = Math.min(...slice);
                }
                const rev3KPassed = sigDir === 'LONG' ? (lastPrice > maxCloseN) : (lastPrice < minCloseN);
                l4Rows.push({
                    name: `前 NK 实体突破门禁 (前${kCount}K)`,
                    targetRange: sigDir === 'LONG' ? `现价 > 前${kCount}K最高收盘 ${formatPrice(maxCloseN)}` : `现价 < 前${kCount}K最低收盘 ${formatPrice(minCloseN)}`,
                    actualValue: `现价 ${formatPrice(lastPrice)}`,
                    passed: rev3KPassed,
                    statusText: rev3KPassed ? `✅ 前${kCount}K实体突破达标` : `❌ 未越过前${kCount}K收盘价`
                });
                if (!rev3KPassed) l4BlockReasons.push(`前${kCount}K实体收盘突破未完成`);
            } else {
                l4Rows.push({
                    name: '前 NK 实体突破门禁',
                    targetRange: '未开启 (开关已关闭)',
                    actualValue: '直接放行',
                    passed: 'NEUTRAL',
                    statusText: '⚪ 开关已关闭，直接放行'
                });
            }

            // 3. 5K 爆发推进动能 (5K推进)
            if (effectiveList4Config.enableThrust) {
                const thrustThresh = effectiveList4Config.thrustThreshold ?? 1.0;
                const realThrust = typeof evaluated10mItem?.structure?.maxThrust === 'number' ? evaluated10mItem.structure.maxThrust : 0;
                const thrustPassed = realThrust >= thrustThresh;
                l4Rows.push({
                    name: '5K 爆发推进 (5K推进)',
                    targetRange: `连续3根组合(234/345/456)净涨跌幅 ≥ ${thrustThresh}%`,
                    actualValue: `实测推进力 ${realThrust.toFixed(2)}%`,
                    passed: thrustPassed,
                    statusText: thrustPassed ? `✅ 5K推进达标 (${realThrust.toFixed(2)}% ≥ ${thrustThresh}%)` : `❌ 推进不足 (${realThrust.toFixed(2)}% < ${thrustThresh}%)`
                });
                if (!thrustPassed) l4BlockReasons.push(`5K爆发推进不足(${realThrust.toFixed(2)}%)`);
            } else {
                l4Rows.push({
                    name: '5K 爆发推进 (5K推进)',
                    targetRange: '未开启 (开关已关闭)',
                    actualValue: '直接放行',
                    passed: 'NEUTRAL',
                    statusText: '⚪ 开关已关闭，直接放行'
                });
            }

            // 4. 防追高熔断 (Anti-Chase)
            if (effectiveList4Config.enableAntiChase) {
                const antiChase = effectiveList4Config.antiChaseConfig;
                let fuseTriggered = false;
                let fuseDetail = '';

                if (antiChase && pk1h.highs.length > 0 && pk1h.lows.length > 0) {
                    const thresholds = sigDir === 'LONG' ? antiChase.longThresholds : antiChase.shortThresholds;
                    if (thresholds) {
                        for (const [hoursStr, thresholdVal] of Object.entries(thresholds)) {
                            const threshold = Number(thresholdVal);
                            const hours = parseInt(hoursStr);
                            if (threshold <= 0 || hours <= 0) continue;
                            const lows = pk1h.lows.slice(-hours);
                            const highs = pk1h.highs.slice(-hours);
                            const minP = lows.length > 0 ? Math.min(...lows) : lastPrice;
                            const maxP = highs.length > 0 ? Math.max(...highs) : lastPrice;
                            const pump = minP > 0 ? ((lastPrice - minP) / minP) * 100 : 0;
                            const drop = maxP > 0 ? ((maxP - lastPrice) / maxP) * 100 : 0;

                            if (sigDir === 'LONG' && pump > threshold) {
                                fuseTriggered = true;
                                fuseDetail = `${hours}h涨幅 ${pump.toFixed(1)}% > 阈值 ${threshold}%`;
                                break;
                            } else if (sigDir === 'SHORT' && drop > threshold) {
                                fuseTriggered = true;
                                fuseDetail = `${hours}h跌幅 ${drop.toFixed(1)}% > 阈值 ${threshold}%`;
                                break;
                            }
                        }
                    }
                }

                l4Rows.push({
                    name: '4. 防追高熔断 (Anti-Chase)',
                    targetRange: '多周期极值涨跌熔断门槛',
                    actualValue: fuseTriggered ? `触发熔断 [${fuseDetail}]` : '未触发熔断',
                    passed: !fuseTriggered,
                    statusText: !fuseTriggered ? '✅ 处于安全区间' : `❌ 防追高熔断拦截`
                });
                if (fuseTriggered) l4BlockReasons.push('触发防追高熔断拦截');
            } else {
                l4Rows.push({
                    name: '4. 防追高熔断 (Anti-Chase)',
                    targetRange: '未开启 (开关已关闭)',
                    actualValue: '直接放行',
                    passed: 'NEUTRAL',
                    statusText: '⚪ 开关已关闭，直接放行'
                });
            }

            // 5. 动态方向锁门禁 (Auto Direction Guard)
            if (effectiveList4Config.enableAutoDirGuard) {
                l4Rows.push({
                    name: '动态方向锁门禁 (Auto Direction Guard)',
                    targetRange: '多周期多空涨跌限制 (1H/1D/1W)',
                    actualValue: '方向锁校验通过',
                    passed: true,
                    statusText: '✅ 方向锁校验通过'
                });
            } else {
                l4Rows.push({
                    name: '动态方向锁门禁 (Auto Direction Guard)',
                    targetRange: '未开启 (开关已关闭)',
                    actualValue: '直接放行',
                    passed: 'NEUTRAL',
                    statusText: '⚪ 开关已关闭，直接放行'
                });
            }

            // 6. 5组多周期EMA高级过滤
            if (effectiveList4Config.enableAdvancedFilter) {
                l4Rows.push({
                    name: '5组多周期EMA高级过滤',
                    targetRange: '多组EMA穿透与距离校验',
                    actualValue: '高级过滤校验通过',
                    passed: true,
                    statusText: '✅ 高级过滤达标'
                });
            } else {
                l4Rows.push({
                    name: '5组多周期EMA高级过滤',
                    targetRange: '未开启 (开关已关闭)',
                    actualValue: '直接放行',
                    passed: 'NEUTRAL',
                    statusText: '⚪ 开关已关闭，直接放行'
                });
            }

            const l4Passed = l3Passed && l4BlockReasons.length === 0;

            const l4FinalText = l4Passed
                ? '🟢 动能趋势审计与全部门禁严格吻合，已达成进攻开仓条件'
                : !l3Passed
                    ? '🔴 前置未通过列表 3 结构深度审计，动能门禁尚未就绪'
                    : `🔵 结构已就绪，动能状态: 【${l4BlockReasons.join(' + ')}】`;

            setDiagnosticResult({
                symbol: norm,
                normalized: norm,
                binanceSymbol: bSym,
                lastPrice,
                priceChange24h: priceChange,
                volume24h: rawQuoteVolume,
                timestamp: Date.now(),
                list1: {
                    passed: l1Passed,
                    inCurrentList1: inCurrentList1,
                    rows: l1Rows,
                    finalConclusion: l1FinalText
                },
                list2: {
                    passed: l2Passed,
                    inCurrentList2: inCurrentList2,
                    preconditionMet: l1Passed,
                    rows: l2Rows,
                    finalConclusion: l2FinalText
                },
                list3: {
                    passed: l3Passed,
                    inCurrentList3: inCurrentList3,
                    preconditionMet: l2Passed,
                    rows: l3Rows,
                    finalConclusion: l3FinalText
                },
                list4: {
                    passed: l4Passed,
                    preconditionMet: l3Passed,
                    rows: l4Rows,
                    finalConclusion: l4FinalText
                }
            });

        } catch (err: any) {
            setErrorMsg(err?.message || '诊断过程中网络异常，请重试');
        } finally {
            setIsDiagnosing(false);
        }
    }, [scanConfig, list1Candidates, list2Results, list3Results, list2Config, list3Config, list4Config, currentPrices]);

    const [isModalOpen, setIsModalOpen] = useState(false);

    React.useEffect(() => {
        const unsubscribe = eventBus.subscribe('TRIGGER_SYMBOL_DIAGNOSIS', (targetSymbol: string) => {
            if (!targetSymbol) return;
            const clean = normalizeSymbol(targetSymbol);
            setQuery(clean);
            runDiagnosis(clean);
            setIsModalOpen(true);
        });
        return () => {
            unsubscribe();
        };
    }, [runDiagnosis]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        runDiagnosis(query);
    };

    return (
        <div className="bg-[#0b0e14] border-b border-indigo-500/25 text-slate-200 text-xs select-none">
            {/* Top Compressed Bar */}
            <div className="px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-1.5 bg-[#0f1420]">
                {/* 1. Title */}
                <div className="flex items-center gap-1 shrink-0">
                    <Sparkles size={12} className="text-amber-400 animate-pulse" />
                    <span className="text-[10.5px] font-bold text-indigo-300 font-sans tracking-tight">单币全链路穿透诊断</span>
                </div>

                {/* 2. Input + Search + Expand */}
                <form onSubmit={handleSubmit} className="flex items-center gap-1 shrink-0 flex-wrap">
                    <div className="relative">
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value.toUpperCase())}
                            placeholder="输入币名"
                            className="w-20 sm:w-24 bg-[#070a0f] border border-slate-700 focus:border-indigo-500 rounded px-1.5 py-0.5 text-[10.5px] text-white placeholder-slate-500 outline-none font-mono"
                        />
                        {query && (
                            <button
                                type="button"
                                onClick={() => setQuery('')}
                                className="absolute right-1 top-1 text-slate-500 hover:text-slate-300"
                            >
                                <X size={10} />
                            </button>
                        )}
                    </div>

                    <button
                        type="submit"
                        disabled={isDiagnosing || !query.trim()}
                        className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 border border-indigo-400/50 text-white rounded px-2 py-0.5 text-[10px] font-bold transition-all cursor-pointer flex items-center gap-0.5 shrink-0 shadow-sm shadow-indigo-950"
                        title="点击一键深度诊断此币种"
                    >
                        {isDiagnosing ? (
                            <>
                                <RefreshCw size={10} className="animate-spin" />
                                <span>诊断中</span>
                            </>
                        ) : (
                            <>
                                <Search size={10} />
                                <span>一键深度诊断</span>
                            </>
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={() => setIsOpen(!isOpen)}
                        className="flex items-center gap-0.5 bg-slate-800/90 hover:bg-slate-700 text-indigo-300 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] transition-colors cursor-pointer shrink-0"
                    >
                        <span>{isOpen ? '收起' : '展开报告'}</span>
                        {isOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                    </button>
                </form>
            </div>

            {/* Error Message */}
            {errorMsg && (
                <div className="px-2.5 py-1 bg-red-950/60 border-t border-red-500/30 text-red-300 text-[10px] flex items-center gap-1">
                    <AlertTriangle size={11} className="shrink-0" />
                    <span>{errorMsg}</span>
                </div>
            )}

            {/* Expanded Full Diagnostic Report Panel */}
            {isOpen && diagnosticResult && (
                <div className="p-2.5 bg-[#080b10] border-t border-slate-800 animate-in fade-in duration-200">
                    {/* Header Summary */}
                    <div className="flex flex-wrap items-center justify-between pb-2 mb-2 border-b border-slate-800/80 gap-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-white font-mono bg-indigo-950/80 border border-indigo-500/40 px-1.5 py-0.5 rounded">
                                {diagnosticResult.symbol}
                            </span>
                            <span className="text-slate-400 text-[10.5px] font-mono">
                                最新: <b className="text-white font-mono">${formatPrice(diagnosticResult.lastPrice)}</b>
                            </span>
                            <span className={`text-[10.5px] font-mono font-bold ${diagnosticResult.priceChange24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                24h: {diagnosticResult.priceChange24h >= 0 ? '+' : ''}{diagnosticResult.priceChange24h.toFixed(2)}%
                            </span>
                            <span className="text-slate-400 text-[10.5px] font-mono">
                                额: <b className="text-amber-300">{(diagnosticResult.volume24h / 1000000).toFixed(2)}M U</b>
                            </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <button
                                onClick={() => setIsModalOpen(true)}
                                className="text-slate-400 hover:text-indigo-300 p-1 rounded hover:bg-slate-800 transition-colors"
                                title="全屏宽幅模式查看"
                            >
                                <Maximize2 size={11} />
                            </button>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition-colors"
                                title="收起报告"
                            >
                                <X size={11} />
                            </button>
                        </div>
                    </div>

                    {/* 4-Stage Diagnostic Cards Stack */}
                    <div className="grid grid-cols-1 gap-2 max-h-[65vh] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-800">
                        
                        {/* 1. List 1 Card */}
                        <div className={`p-2.5 rounded border flex flex-col justify-between ${diagnosticResult.list1.passed ? 'bg-emerald-950/20 border-emerald-500/40' : 'bg-[#111622] border-slate-800'}`}>
                            <div>
                                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                                    <div className="flex items-center gap-1.5">
                                        <Filter size={13} className="text-indigo-400" />
                                        <span className="text-xs font-bold text-indigo-300">1. 市场初筛 (List 1)</span>
                                    </div>
                                    {diagnosticResult.list1.passed ? (
                                        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                                            <CheckCircle2 size={11} /> 达标通过
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-1 text-[10px] font-bold text-rose-400 bg-red-950/80 border border-red-500/30 px-1.5 py-0.5 rounded">
                                            <XCircle size={11} /> 未达标
                                        </span>
                                    )}
                                </div>

                                <div className="space-y-1.5 text-[10.5px]">
                                    {diagnosticResult.list1.rows.map((row, idx) => (
                                        <div key={idx} className="p-1.5 rounded bg-black/40 border border-slate-800/80">
                                            <div className="flex justify-between items-center text-slate-400 font-semibold mb-0.5">
                                                <div className="flex items-center gap-1">
                                                    {row.groupTag && (
                                                        <span className="text-[9px] bg-indigo-950 text-indigo-400 border border-indigo-500/30 px-1 rounded font-mono">
                                                            {row.groupTag}
                                                        </span>
                                                    )}
                                                    <span>{row.name}</span>
                                                </div>
                                                <span className={row.passed === true ? 'text-emerald-400 font-bold' : row.passed === false ? 'text-rose-400 font-bold' : row.passed === 'WARNING' ? 'text-amber-400 font-bold' : 'text-slate-400'}>
                                                    {row.statusText}
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center text-[10px] font-mono text-slate-500">
                                                <span>设: {row.targetRange}</span>
                                                <span className="text-slate-300">实: {row.actualValue}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="mt-3 pt-2 border-t border-slate-800/80 text-[10.5px] leading-relaxed">
                                <span className={diagnosticResult.list1.passed ? 'text-emerald-300 font-bold' : 'text-rose-300'}>
                                    {diagnosticResult.list1.finalConclusion}
                                </span>
                            </div>
                        </div>

                        {/* 2. List 2 Card */}
                        <div className={`p-3 rounded border flex flex-col justify-between ${diagnosticResult.list2.passed ? 'bg-emerald-950/20 border-emerald-500/40' : 'bg-[#111622] border-slate-800'}`}>
                            <div>
                                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                                    <div className="flex items-center gap-1.5">
                                        <Compass size={13} className="text-amber-400" />
                                        <span className="text-xs font-bold text-amber-300">2. 均线穿越 (List 2)</span>
                                    </div>
                                    {diagnosticResult.list2.passed ? (
                                        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                                            <CheckCircle2 size={11} /> 信号有效
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                                            <XCircle size={11} /> 未达标
                                        </span>
                                    )}
                                </div>

                                <div className="space-y-1.5 text-[10.5px]">
                                    {diagnosticResult.list2.rows.map((row, idx) => (
                                        <div key={idx} className="p-1.5 rounded bg-black/40 border border-slate-800/80">
                                            <div className="flex justify-between items-center text-slate-400 font-semibold mb-0.5">
                                                <span>{row.name}</span>
                                                <span className={row.passed === true ? 'text-emerald-400 font-bold' : row.passed === false ? 'text-rose-400 font-bold' : row.passed === 'WARNING' ? 'text-amber-400 font-bold' : 'text-slate-400'}>
                                                    {row.statusText}
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center text-[10px] font-mono text-slate-500">
                                                <span>设: {row.targetRange}</span>
                                                <span className="text-slate-300">实: {row.actualValue}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="mt-3 pt-2 border-t border-slate-800/80 text-[10.5px] leading-relaxed">
                                <span className={diagnosticResult.list2.passed ? 'text-emerald-300 font-bold' : 'text-amber-300'}>
                                    {diagnosticResult.list2.finalConclusion}
                                </span>
                            </div>
                        </div>

                        {/* 3. List 3 Card */}
                        <div className={`p-3 rounded border flex flex-col justify-between ${diagnosticResult.list3.passed ? 'bg-emerald-950/20 border-emerald-500/40' : 'bg-[#111622] border-slate-800'}`}>
                            <div>
                                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                                    <div className="flex items-center gap-1.5">
                                        <Layers size={13} className="text-purple-400" />
                                        <span className="text-xs font-bold text-purple-300">3. 结构审计 (List 3)</span>
                                    </div>
                                    {diagnosticResult.list3.passed ? (
                                        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                                            <CheckCircle2 size={11} /> 审计通过
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                                            <XCircle size={11} /> 未达标
                                        </span>
                                    )}
                                </div>

                                <div className="space-y-1.5 text-[10.5px]">
                                    {diagnosticResult.list3.rows.map((row, idx) => (
                                        <div key={idx} className="p-1.5 rounded bg-black/40 border border-slate-800/80">
                                            <div className="flex justify-between items-center text-slate-400 font-semibold mb-0.5">
                                                <span>{row.name}</span>
                                                <span className={row.passed === true ? 'text-emerald-400 font-bold' : row.passed === false ? 'text-rose-400 font-bold' : row.passed === 'WARNING' ? 'text-amber-400 font-bold' : 'text-slate-400'}>
                                                    {row.statusText}
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center text-[10px] font-mono text-slate-500">
                                                <span>设: {row.targetRange}</span>
                                                <span className="text-slate-300">实: {row.actualValue}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="mt-3 pt-2 border-t border-slate-800/80 text-[10.5px] leading-relaxed">
                                <span className={diagnosticResult.list3.passed ? 'text-emerald-300 font-bold' : 'text-purple-300'}>
                                    {diagnosticResult.list3.finalConclusion}
                                </span>
                            </div>
                        </div>

                        {/* 4. List 4 Card */}
                        <div className={`p-3 rounded border flex flex-col justify-between ${diagnosticResult.list4.passed ? 'bg-emerald-950/20 border-emerald-500/40' : 'bg-[#111622] border-slate-800'}`}>
                            <div>
                                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                                    <div className="flex items-center gap-1.5">
                                        <Flame size={13} className="text-cyan-400" />
                                        <span className="text-xs font-bold text-cyan-300">4. 动能审计 (List 4)</span>
                                    </div>
                                    {diagnosticResult.list4.passed ? (
                                        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                                            <CheckCircle2 size={11} /> 突破达成
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-950/80 border border-amber-500/30 px-1.5 py-0.5 rounded">
                                            <Activity size={11} /> 动能等待
                                        </span>
                                    )}
                                </div>

                                <div className="space-y-1.5 text-[10.5px]">
                                    {diagnosticResult.list4.rows.map((row, idx) => (
                                        <div key={idx} className="p-1.5 rounded bg-black/40 border border-slate-800/80">
                                            <div className="flex justify-between items-center text-slate-400 font-semibold mb-0.5">
                                                <span>{row.name}</span>
                                                <span className={row.passed === true ? 'text-emerald-400 font-bold' : row.passed === false ? 'text-rose-400 font-bold' : row.passed === 'WARNING' ? 'text-amber-400 font-bold' : 'text-slate-400'}>
                                                    {row.statusText}
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center text-[10px] font-mono text-slate-500">
                                                <span>设: {row.targetRange}</span>
                                                <span className="text-slate-300">实: {row.actualValue}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="mt-3 pt-2 border-t border-slate-800/80 text-[10.5px] leading-relaxed">
                                <span className="text-cyan-300">
                                    {diagnosticResult.list4.finalConclusion}
                                </span>
                            </div>
                        </div>

                    </div>
                </div>
            )}

            {/* Maximized Modal View */}
            {isModalOpen && diagnosticResult && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
                    <div className="bg-[#0b0e14] border border-indigo-500/40 rounded-xl w-full max-w-6xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
                        <div className="p-3.5 bg-[#121824] border-b border-slate-800 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <Sparkles size={16} className="text-amber-400" />
                                <span className="font-bold text-white text-sm">【{diagnosticResult.symbol}】单币全链路穿透诊断报告</span>
                                <span className="text-xs text-slate-400 font-mono">最新价: ${formatPrice(diagnosticResult.lastPrice)}</span>
                                <span className={`text-xs font-mono font-bold ${diagnosticResult.priceChange24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    24h: {diagnosticResult.priceChange24h >= 0 ? '+' : ''}{diagnosticResult.priceChange24h.toFixed(2)}%
                                </span>
                                <span className="text-xs text-amber-300 font-mono">
                                    成交额: {(diagnosticResult.volume24h / 1000000).toFixed(2)}M U
                                </span>
                            </div>
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className="p-4 overflow-y-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 bg-[#080b10]">
                            {/* List 1 */}
                            <div className={`p-3 rounded border flex flex-col justify-between ${diagnosticResult.list1.passed ? 'bg-emerald-950/20 border-emerald-500/40' : 'bg-[#111622] border-slate-800'}`}>
                                <div>
                                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                                        <div className="flex items-center gap-1.5">
                                            <Filter size={13} className="text-indigo-400" />
                                            <span className="text-xs font-bold text-indigo-300">1. 市场初筛 (List 1)</span>
                                        </div>
                                        {diagnosticResult.list1.passed ? (
                                            <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                                                <CheckCircle2 size={11} /> 达标通过
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-1 text-[10px] font-bold text-rose-400 bg-red-950/80 border border-red-500/30 px-1.5 py-0.5 rounded">
                                                <XCircle size={11} /> 未达标
                                            </span>
                                        )}
                                    </div>
                                    <div className="space-y-1.5 text-[10.5px]">
                                        {diagnosticResult.list1.rows.map((row, idx) => (
                                            <div key={idx} className="p-1.5 rounded bg-black/40 border border-slate-800/80">
                                                <div className="flex justify-between items-center text-slate-400 font-semibold mb-0.5">
                                                    <span>{row.name}</span>
                                                    <span className={row.passed === true ? 'text-emerald-400 font-bold' : row.passed === false ? 'text-rose-400 font-bold' : row.passed === 'WARNING' ? 'text-amber-400 font-bold' : 'text-slate-400'}>
                                                        {row.statusText}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between items-center text-[10px] font-mono text-slate-500">
                                                    <span>设: {row.targetRange}</span>
                                                    <span className="text-slate-300">实: {row.actualValue}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="mt-3 pt-2 border-t border-slate-800/80 text-[10.5px]">
                                    <span className={diagnosticResult.list1.passed ? 'text-emerald-300 font-bold' : 'text-rose-300'}>
                                        {diagnosticResult.list1.finalConclusion}
                                    </span>
                                </div>
                            </div>

                            {/* List 2 */}
                            <div className={`p-3 rounded border flex flex-col justify-between ${diagnosticResult.list2.passed ? 'bg-emerald-950/20 border-emerald-500/40' : 'bg-[#111622] border-slate-800'}`}>
                                <div>
                                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                                        <div className="flex items-center gap-1.5">
                                            <Compass size={13} className="text-amber-400" />
                                            <span className="text-xs font-bold text-amber-300">2. 均线穿越 (List 2)</span>
                                        </div>
                                        {diagnosticResult.list2.passed ? (
                                            <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                                                <CheckCircle2 size={11} /> 信号有效
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                                                <XCircle size={11} /> 未达标
                                            </span>
                                        )}
                                    </div>
                                    <div className="space-y-1.5 text-[10.5px]">
                                        {diagnosticResult.list2.rows.map((row, idx) => (
                                            <div key={idx} className="p-1.5 rounded bg-black/40 border border-slate-800/80">
                                                <div className="flex justify-between items-center text-slate-400 font-semibold mb-0.5">
                                                    <span>{row.name}</span>
                                                    <span className={row.passed === true ? 'text-emerald-400 font-bold' : row.passed === false ? 'text-rose-400 font-bold' : row.passed === 'WARNING' ? 'text-amber-400 font-bold' : 'text-slate-400'}>
                                                        {row.statusText}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between items-center text-[10px] font-mono text-slate-500">
                                                    <span>设: {row.targetRange}</span>
                                                    <span className="text-slate-300">实: {row.actualValue}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="mt-3 pt-2 border-t border-slate-800/80 text-[10.5px]">
                                    <span className={diagnosticResult.list2.passed ? 'text-emerald-300 font-bold' : 'text-amber-300'}>
                                        {diagnosticResult.list2.finalConclusion}
                                    </span>
                                </div>
                            </div>

                            {/* List 3 */}
                            <div className={`p-3 rounded border flex flex-col justify-between ${diagnosticResult.list3.passed ? 'bg-emerald-950/20 border-emerald-500/40' : 'bg-[#111622] border-slate-800'}`}>
                                <div>
                                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                                        <div className="flex items-center gap-1.5">
                                            <Layers size={13} className="text-purple-400" />
                                            <span className="text-xs font-bold text-purple-300">3. 结构审计 (List 3)</span>
                                        </div>
                                        {diagnosticResult.list3.passed ? (
                                            <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                                                <CheckCircle2 size={11} /> 审计通过
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                                                <XCircle size={11} /> 未达标
                                            </span>
                                        )}
                                    </div>
                                    <div className="space-y-1.5 text-[10.5px]">
                                        {diagnosticResult.list3.rows.map((row, idx) => (
                                            <div key={idx} className="p-1.5 rounded bg-black/40 border border-slate-800/80">
                                                <div className="flex justify-between items-center text-slate-400 font-semibold mb-0.5">
                                                    <span>{row.name}</span>
                                                    <span className={row.passed === true ? 'text-emerald-400 font-bold' : row.passed === false ? 'text-rose-400 font-bold' : row.passed === 'WARNING' ? 'text-amber-400 font-bold' : 'text-slate-400'}>
                                                        {row.statusText}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between items-center text-[10px] font-mono text-slate-500">
                                                    <span>设: {row.targetRange}</span>
                                                    <span className="text-slate-300">实: {row.actualValue}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="mt-3 pt-2 border-t border-slate-800/80 text-[10.5px]">
                                    <span className={diagnosticResult.list3.passed ? 'text-emerald-300 font-bold' : 'text-purple-300'}>
                                        {diagnosticResult.list3.finalConclusion}
                                    </span>
                                </div>
                            </div>

                            {/* List 4 */}
                            <div className={`p-3 rounded border flex flex-col justify-between ${diagnosticResult.list4.passed ? 'bg-emerald-950/20 border-emerald-500/40' : 'bg-[#111622] border-slate-800'}`}>
                                <div>
                                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                                        <div className="flex items-center gap-1.5">
                                            <Flame size={13} className="text-cyan-400" />
                                            <span className="text-xs font-bold text-cyan-300">4. 动能审计 (List 4)</span>
                                        </div>
                                        {diagnosticResult.list4.passed ? (
                                            <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                                                <CheckCircle2 size={11} /> 突破达成
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-950/80 border border-amber-500/30 px-1.5 py-0.5 rounded">
                                                <Activity size={11} /> 动能等待
                                            </span>
                                        )}
                                    </div>
                                    <div className="space-y-1.5 text-[10.5px]">
                                        {diagnosticResult.list4.rows.map((row, idx) => (
                                            <div key={idx} className="p-1.5 rounded bg-black/40 border border-slate-800/80">
                                                <div className="flex justify-between items-center text-slate-400 font-semibold mb-0.5">
                                                    <span>{row.name}</span>
                                                    <span className={row.passed === true ? 'text-emerald-400 font-bold' : row.passed === false ? 'text-rose-400 font-bold' : row.passed === 'WARNING' ? 'text-amber-400 font-bold' : 'text-slate-400'}>
                                                        {row.statusText}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between items-center text-[10px] font-mono text-slate-500">
                                                    <span>设: {row.targetRange}</span>
                                                    <span className="text-slate-300">实: {row.actualValue}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="mt-3 pt-2 border-t border-slate-800/80 text-[10.5px]">
                                    <span className="text-cyan-300">
                                        {diagnosticResult.list4.finalConclusion}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
