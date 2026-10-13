
// 🔒 LOCKED_MODULE: LIST 1 [大行情爆发/突破过滤规则 - 规则计算引擎]
// @LOCKED: 严格原子化锁定。未经用户明确的专属书面指令，严禁擅自修改、重构或变动大行情突破/爆发规则的任何功能与代码。

import { BreakoutFilterConfig, BreakoutTimeframe } from '../../components/Scanner/scannerTypes';
import { calculateBollingerBands, calculateATR, calculateADX, calculateEMA, checkEmaDivergence } from '../indicators';
import { fetchWithFallback } from '../apiService';
import { binanceWsApi } from '../binanceWsApi';

export interface BreakoutTimeframeResult {
    tf: string;
    bbwPct: number;
    isSqueeze: boolean;
    squeezePassed: boolean;
    volRatio: number;
    isBrokenOut: boolean;
    breakoutDirection: 'LONG' | 'SHORT' | 'NONE';
    volumePassed: boolean;
    solidBodyRatio: number;
    consecutiveVolCount: number;
    isVolRising: boolean;
    distFromExtremePct: number;
    adxValue: number;
    isAdxRising: boolean;
    adxPassed: boolean;
    tfResonancePassed: boolean;
    isPassed: boolean;
    matchedRules: string[];
    failReasons: string[];
}

export interface BreakoutAuditItem {
    symbol: string;
    price: number;
    // 1. 空间蓄势
    bbwPct: number;
    isSqueeze: boolean;
    squeezePassed: boolean;
    // 2. 突破点火
    volRatio: number;
    isBrokenOut: boolean;
    breakoutDirection: 'LONG' | 'SHORT' | 'NONE';
    volumePassed: boolean;
    // 🐉 龙抬头防伪进阶指标
    solidBodyRatio?: number;        // K线实体饱满度 %
    consecutiveVolCount?: number;   // 连续放量根数
    isVolRising?: boolean;          // 连续放量是否逐根递增
    distFromExtremePct?: number;    // 距离阶段极值距离 %
    // 3. 动能与多周期
    adxValue: number;
    isAdxRising: boolean;
    adxPassed: boolean;
    tfResonancePassed: boolean;
    primaryTfDir: 'LONG' | 'SHORT' | 'NONE';
    confirmTfDir: 'LONG' | 'SHORT' | 'NONE';
    // 🎯 多周期并联独立入池 (5m / 10m / 15m / 30m / 60m)
    matchedTimeframes?: string[];   // 命中的周期列表，例如 ['5m', '15m']
    primaryMatchedTf?: string;     // 主展示周期
    timeframeResults?: Record<string, BreakoutTimeframeResult>;
    // 综合判定
    isPassed: boolean;
    matchedRules?: string[];
    failReasons: string[];
    timestamp: number;
    isCacheHit?: boolean;
}

// In-memory short-lived K-line cache for sub-second responsive audits
const BREAKOUT_KLINE_CACHE: Record<string, { timestamp: number; klines: any[] }> = {};

export const DEFAULT_BREAKOUT_CONFIG: BreakoutFilterConfig = {
    enabled: false,
    combinationMode: 'OR', // 默认 'OR' 模式 (满足任一即可进入市场初筛)
    scanDelayMs: 1000, // 默认 1000ms (1秒1币，平稳扫描防超频)
    selectedTimeframes: ['5m', '10m', '15m', '30m', '60m'], // 🎯 5大周期全开并联独立入池
    // 1. 空间极致蓄势 (宽松推荐)
    enableSqueeze: true,
    maxBbwPercent: 5.0,
    requireSqueezeInKc: false,
    squeezeBars: 20,
    // 2. 突破点火放量 (宽松推荐)
    enableVolumeSpike: true,
    volMultiplier: 1.3,
    breakoutMode: 'BB_BANDS',
    breakoutBars: 20,
    breakoutDirection: 'BOTH',
    consecutiveVolBars: 1, // 默认 1 (单K爆发)
    requireConsecutiveVolRise: false, // 默认 false
    minSolidBodyRatio: 35.0, // 宽松推荐 35% 实体饱满度门禁
    maxDistancePctFromLow: 40.0, // 宽松推荐 40% 防追高极值门禁
    // 3. 动能与多周期 (宽松推荐)
    enableAdx: true,
    minAdx: 18,
    requireAdxRising: false,
    enableMultiTfResonance: true,
    primaryTf: '5m',
    confirmTf: '15m',
    resonanceMode: 'TWO_TF'
};

/**
 * 币安合约原生无 10m 周期：由 5m K线严格按照 10分钟 整点对齐合成无损 10m K线
 */
export function synthesize10mFrom5m(klines5m: any[]): any[] {
    if (!Array.isArray(klines5m) || klines5m.length === 0) return [];
    const klines10m: any[] = [];
    let currentBucket: any[] | null = null;
    let currentBucketStart = 0;

    for (const k of klines5m) {
        const openTime = Number(k[0]);
        const open = parseFloat(k[1]);
        const high = parseFloat(k[2]);
        const low = parseFloat(k[3]);
        const close = parseFloat(k[4]);
        const vol = parseFloat(k[5]);
        const closeTime = Number(k[6]);
        const quoteVol = parseFloat(k[7]) || 0;

        const bucketStart = Math.floor(openTime / 600000) * 600000;
        if (!currentBucket || bucketStart !== currentBucketStart) {
            if (currentBucket) {
                klines10m.push(currentBucket);
            }
            currentBucketStart = bucketStart;
            currentBucket = [
                bucketStart,
                open.toString(),
                high.toString(),
                low.toString(),
                close.toString(),
                vol.toString(),
                closeTime,
                quoteVol.toString()
            ];
        } else {
            currentBucket[2] = Math.max(parseFloat(currentBucket[2]), high).toString();
            currentBucket[3] = Math.min(parseFloat(currentBucket[3]), low).toString();
            currentBucket[4] = close.toString();
            currentBucket[5] = (parseFloat(currentBucket[5]) + vol).toString();
            currentBucket[6] = closeTime;
            currentBucket[7] = (parseFloat(currentBucket[7]) + quoteVol).toString();
        }
    }
    if (currentBucket) {
        klines10m.push(currentBucket);
    }
    return klines10m;
}

/**
 * 快速获取币安指定周期的 K 线数据 (30s 内存保鲜缓存 + 10m/60m 智能周期适配 + HIGH 优先级极速直通)
 */
export async function fetchTfKlines(symbol: string, tf: string, limit: number = 60, signal?: AbortSignal): Promise<{ klines: any[] | null; isCacheHit: boolean }> {
    const safeSymbol = symbol.toUpperCase().replace(/_LONG$|_SHORT$/i, '').replace(/[\/_]/g, '').trim();
    const cacheKey = `${safeSymbol}_${tf}`;
    const now = Date.now();

    const cached = BREAKOUT_KLINE_CACHE[cacheKey];
    if (cached && (now - cached.timestamp < 30000) && cached.klines.length >= limit) {
        return { klines: cached.klines, isCacheHit: true };
    }

    // 10m 由 5m K线合成
    if (tf === '10m') {
        const needed5m = Math.max(limit * 2 + 10, 80);
        const res5m = await fetchTfKlines(symbol, '5m', needed5m, signal);
        if (res5m.klines && res5m.klines.length > 0) {
            const synthesized = synthesize10mFrom5m(res5m.klines);
            if (synthesized.length > 0) {
                BREAKOUT_KLINE_CACHE[cacheKey] = {
                    timestamp: now,
                    klines: synthesized
                };
                return { klines: synthesized, isCacheHit: res5m.isCacheHit };
            }
        }
        return { klines: null, isCacheHit: false };
    }

    // 60m 映射为币安原生 1h
    const apiTf = tf === '60m' ? '1h' : tf;

    try {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=${apiTf}&limit=${limit}`;
        const res = await fetchWithFallback(url, { timeout: 3500, priority: 'HIGH', signal }, (d) => Array.isArray(d) && d.length > 0);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            BREAKOUT_KLINE_CACHE[cacheKey] = {
                timestamp: now,
                klines: data
            };
            return { klines: data, isCacheHit: false };
        }
        return { klines: null, isCacheHit: false };
    } catch (_) {
        return { klines: null, isCacheHit: false };
    }
}

/**
 * 针对单个周期的 K 线数据执行三大规则审计
 */
export function auditSingleTfBreakout(
    tf: string,
    klines: any[],
    config: BreakoutFilterConfig
): BreakoutTimeframeResult {
    const failReasons: string[] = [];
    if (!klines || klines.length < 30) {
        return {
            tf,
            bbwPct: 0,
            isSqueeze: false,
            squeezePassed: false,
            volRatio: 0,
            isBrokenOut: false,
            breakoutDirection: 'NONE',
            volumePassed: false,
            solidBodyRatio: 0,
            consecutiveVolCount: 1,
            isVolRising: false,
            distFromExtremePct: 0,
            adxValue: 0,
            isAdxRising: false,
            adxPassed: false,
            tfResonancePassed: false,
            isPassed: false,
            matchedRules: [],
            failReasons: [`${tf}周期K线不足`]
        };
    }

    const closes = klines.map(k => parseFloat(k[4]));
    const highs = klines.map(k => parseFloat(k[2]));
    const lows = klines.map(k => parseFloat(k[3]));
    const opens = klines.map(k => parseFloat(k[1]));
    const volumes = klines.map(k => parseFloat(k[5]));

    // --- 维度 ①: 空间极致蓄势 (Squeeze / BBW) ---
    const period = config.squeezeBars || 20;
    const bb = calculateBollingerBands(closes, period, 2.0);
    const atr = calculateATR(highs, lows, closes, period);

    const lastBbIdx = bb.upper.length - 1;
    const lastAtrIdx = atr.length - 1;

    let bbwPct = 0;
    let isSqueeze = false;
    let squeezePassed = true;

    if (lastBbIdx >= 0 && lastAtrIdx >= 0) {
        const upperBB = bb.upper[lastBbIdx];
        const middleBB = bb.middle[lastBbIdx];
        const lowerBB = bb.lower[lastBbIdx];
        const curATR = atr[lastAtrIdx];

        // 肯特纳通道 KC = SMA20 ± (1.5 * ATR20)
        const upperKC = middleBB + 1.5 * curATR;
        const lowerKC = middleBB - 1.5 * curATR;

        // BBW % = (Upper - Lower) / Middle * 100
        bbwPct = middleBB > 0 ? +(((upperBB - lowerBB) / middleBB) * 100).toFixed(2) : 0;
        // Squeeze ON: BB 上轨 <= KC 上轨 且 BB 下轨 >= KC 下轨
        isSqueeze = upperBB <= upperKC && lowerBB >= lowerKC;

        if (config.enableSqueeze) {
            if (bbwPct > (config.maxBbwPercent ?? 3.0)) {
                squeezePassed = false;
                failReasons.push(`${tf} BBW带宽(${bbwPct}%)高于上限(${config.maxBbwPercent}%)`);
            }
            if (config.requireSqueezeInKc && !isSqueeze) {
                squeezePassed = false;
                failReasons.push(`${tf} 未进入KC通道挤压态`);
            }
        }
    }

    // --- 维度 ②: 突破点火放量 (Volume & Breakout - 融入龙抬头防伪进阶) ---
    let volRatio = 1.0;
    let isBrokenOut = false;
    let breakoutDirection: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
    let volumePassed = true;
    let solidBodyRatio = 100.0;
    let consecutiveVolCount = 1;
    let isVolRising = true;
    let distFromExtremePct = 0.0;

    const volPeriod = 20;
    if (volumes.length >= volPeriod) {
        const recentVols = volumes.slice(-volPeriod - 1, -1);
        const avgVol = recentVols.reduce((a, b) => a + b, 0) / (recentVols.length || 1);
        const curVol = volumes[volumes.length - 1];
        volRatio = avgVol > 0 ? +(curVol / avgVol).toFixed(2) : 1.0;

        const curClose = closes[closes.length - 1];
        const curOpen = opens[opens.length - 1];
        const curHigh = highs[highs.length - 1];
        const curLow = lows[lows.length - 1];

        const prevUpperBB = lastBbIdx >= 0 ? bb.upper[lastBbIdx] : 0;
        const prevLowerBB = lastBbIdx >= 0 ? bb.lower[lastBbIdx] : 0;

        // 1. 突破判定 (破布林带 / 破近N根极值)
        if (config.breakoutMode === 'BB_BANDS' && prevUpperBB > 0 && prevLowerBB > 0) {
            if (curClose > prevUpperBB && curClose > curOpen) {
                isBrokenOut = true;
                breakoutDirection = 'LONG';
            } else if (curClose < prevLowerBB && curClose < curOpen) {
                isBrokenOut = true;
                breakoutDirection = 'SHORT';
            }
        } else {
            const bBars = config.breakoutBars || 20;
            const prevHighs = highs.slice(-bBars - 1, -1);
            const prevLows = lows.slice(-bBars - 1, -1);
            const maxH = Math.max(...prevHighs);
            const minL = Math.min(...prevLows);

            if (curClose > maxH && curClose > curOpen) {
                isBrokenOut = true;
                breakoutDirection = 'LONG';
            } else if (curClose < minL && curClose < curOpen) {
                isBrokenOut = true;
                breakoutDirection = 'SHORT';
            }
        }

        // 2. 🐉【龙抬头防伪 ①】K线实体饱满度
        const candleRange = curHigh - curLow;
        const bodyHeight = Math.abs(curClose - curOpen);
        solidBodyRatio = candleRange > 0 ? +((bodyHeight / candleRange) * 100).toFixed(1) : 100.0;

        // 3. 🐉【龙抬头防伪 ②】连续放量与递增
        const cBars = Math.max(1, config.consecutiveVolBars || 1);
        consecutiveVolCount = cBars;
        if (cBars > 1 && volumes.length >= cBars + 1) {
            const recentVolSteps = volumes.slice(-cBars);
            for (let vi = 1; vi < recentVolSteps.length; vi++) {
                if (recentVolSteps[vi] < recentVolSteps[vi - 1] * 0.97) {
                    isVolRising = false;
                    break;
                }
            }
        }

        // 4. 🐉【龙抬头防伪 ③】阶段极值距离
        const lookbackBarsForExtreme = Math.max(20, config.breakoutBars || 20);
        const recentLowestLows = lows.slice(-lookbackBarsForExtreme);
        const recentHighestHighs = highs.slice(-lookbackBarsForExtreme);
        const periodMinL = Math.min(...recentLowestLows);
        const periodMaxH = Math.max(...recentHighestHighs);

        if (breakoutDirection === 'SHORT') {
            distFromExtremePct = periodMaxH > 0 ? +(((periodMaxH - curClose) / periodMaxH) * 100).toFixed(2) : 0;
        } else {
            distFromExtremePct = periodMinL > 0 ? +(((curClose - periodMinL) / periodMinL) * 100).toFixed(2) : 0;
        }

        // 门禁判定
        if (config.enableVolumeSpike) {
            if (volRatio < (config.volMultiplier ?? 2.0)) {
                volumePassed = false;
                failReasons.push(`${tf} 成交量比(${volRatio}x)低于要求(${config.volMultiplier}x)`);
            }
            if (!isBrokenOut) {
                volumePassed = false;
                failReasons.push(`${tf} 未形成实体破位突破`);
            }
            if (config.breakoutDirection && config.breakoutDirection !== 'BOTH') {
                if (breakoutDirection !== config.breakoutDirection) {
                    volumePassed = false;
                    failReasons.push(`${tf} 突破方向不符合(${config.breakoutDirection})`);
                }
            }
            const minBodyReq = config.minSolidBodyRatio !== undefined ? config.minSolidBodyRatio : 50.0;
            if (minBodyReq > 0 && solidBodyRatio < minBodyReq) {
                volumePassed = false;
                failReasons.push(`${tf} K线实体饱满度(${solidBodyRatio}%)低于门禁(${minBodyReq}%)`);
            }
            if (cBars > 1 && config.requireConsecutiveVolRise && !isVolRising) {
                volumePassed = false;
                failReasons.push(`${tf} 未满足连续${cBars}根K线放量递增`);
            }
            const maxDistReq = config.maxDistancePctFromLow !== undefined ? config.maxDistancePctFromLow : 25.0;
            if (maxDistReq > 0 && distFromExtremePct > maxDistReq) {
                volumePassed = false;
                failReasons.push(`${tf} 离阶段极值距离(${distFromExtremePct}%)超出防追高门禁(${maxDistReq}%)`);
            }
        }
    }

    // --- 维度 ③: 动能爆发 (ADX & 多周期共振) ---
    let adxValue = 0;
    let isAdxRising = false;
    let adxPassed = true;

    if (highs.length >= 30) {
        const adx14 = calculateADX(highs, lows, closes, 14);
        const prevAdx14 = calculateADX(highs.slice(0, -1), lows.slice(0, -1), closes.slice(0, -1), 14);
        adxValue = +adx14.toFixed(1);
        isAdxRising = adx14 > prevAdx14;

        if (config.enableAdx) {
            if (adxValue < (config.minAdx ?? 22)) {
                adxPassed = false;
                failReasons.push(`${tf} ADX动能(${adxValue})低于阈值(${config.minAdx})`);
            }
            if (config.requireAdxRising && !isAdxRising) {
                adxPassed = false;
                failReasons.push(`${tf} ADX未向上拐头拉升`);
            }
        }
    }

    let tfResonancePassed = true;
    if (config.enableMultiTfResonance) {
        const primaryDiv = checkEmaDivergence(closes, [10, 20, 30, 40]);
        if (!primaryDiv) {
            tfResonancePassed = false;
            failReasons.push(`${tf} 未形成EMA发散`);
        }
    }

    // 综合判定此周期是否符合
    const activeDimensions: { name: string; passed: boolean }[] = [];
    if (config.enableSqueeze) {
        activeDimensions.push({ name: '空间蓄势', passed: squeezePassed });
    }
    if (config.enableVolumeSpike) {
        activeDimensions.push({ name: '突破放量', passed: volumePassed });
    }
    if (config.enableAdx || config.enableMultiTfResonance) {
        const momentumPassed = (!config.enableAdx || adxPassed) && (!config.enableMultiTfResonance || tfResonancePassed);
        activeDimensions.push({ name: '动能共振', passed: momentumPassed });
    }

    const mode = config.combinationMode || 'OR';
    let isPassed = false;
    if (activeDimensions.length === 0) {
        isPassed = true;
    } else if (mode === 'OR') {
        isPassed = activeDimensions.some(d => d.passed);
    } else {
        isPassed = activeDimensions.every(d => d.passed);
    }

    const matchedRules = activeDimensions.filter(d => d.passed).map(d => d.name);

    return {
        tf,
        bbwPct,
        isSqueeze,
        squeezePassed,
        volRatio,
        isBrokenOut,
        breakoutDirection,
        volumePassed,
        solidBodyRatio,
        consecutiveVolCount,
        isVolRising,
        distFromExtremePct,
        adxValue,
        isAdxRising,
        adxPassed,
        tfResonancePassed,
        isPassed,
        matchedRules,
        failReasons
    };
}

/**
 * 单币种趋势爆发综合审计函数 (支持 5m / 10m / 15m / 30m / 60m 多选并联独立入池)
 */
export async function auditSymbolBreakout(
    symbol: string,
    rawConfig?: BreakoutFilterConfig,
    signal?: AbortSignal
): Promise<BreakoutAuditItem> {
    const config: BreakoutFilterConfig = { ...DEFAULT_BREAKOUT_CONFIG, ...rawConfig };
    const targetTfs: BreakoutTimeframe[] = (config.selectedTimeframes && config.selectedTimeframes.length > 0)
        ? config.selectedTimeframes
        : (['5m', '10m', '15m', '30m', '60m'] as BreakoutTimeframe[]);

    const defaultFailResult: BreakoutAuditItem = {
        symbol,
        price: 0,
        bbwPct: 0,
        isSqueeze: false,
        squeezePassed: false,
        volRatio: 0,
        isBrokenOut: false,
        breakoutDirection: 'NONE',
        volumePassed: false,
        adxValue: 0,
        isAdxRising: false,
        adxPassed: false,
        tfResonancePassed: false,
        primaryTfDir: 'NONE',
        confirmTfDir: 'NONE',
        matchedTimeframes: [],
        isPassed: false,
        failReasons: ['数据加载中或请求超时'],
        timestamp: Date.now(),
        isCacheHit: false
    };

    try {
        // 1. 并发获取所选周期 K 线 (Promise.all 毫秒级并行拉取)
        const fetchedList = await Promise.all(
            targetTfs.map(async (tf) => {
                const res = await fetchTfKlines(symbol, tf, 60, signal);
                return { tf, ...res };
            })
        );

        const isCacheHit = fetchedList.every(f => f.isCacheHit);
        const validList = fetchedList.filter(f => f.klines && f.klines.length >= 30);

        if (validList.length === 0) {
            defaultFailResult.failReasons = ['所选周期K线数据不足'];
            return defaultFailResult;
        }

        // 获取最新市价 (取第一个有效周期的最新收盘)
        const primaryValid = validList[0];
        const lastKline = primaryValid.klines![primaryValid.klines!.length - 1];
        const currentPrice = parseFloat(lastKline[4]);

        const tfResultsMap: Record<string, BreakoutTimeframeResult> = {};
        const matchedTfs: string[] = [];
        const allMatchedRules = new Set<string>();
        const allFailReasons: string[] = [];

        for (const item of validList) {
            const res = auditSingleTfBreakout(item.tf, item.klines!, config);
            tfResultsMap[item.tf] = res;
            if (res.isPassed) {
                matchedTfs.push(item.tf);
                res.matchedRules.forEach(r => allMatchedRules.add(r));
            } else {
                allFailReasons.push(...res.failReasons);
            }
        }

        // 🎯 方案 B【多选并联 + 独立入池模式】：只要任意一个勾选的周期通过，即放行入池并打标
        const isPassed = matchedTfs.length > 0;

        // 挑选主展示指标（优先选命中的第一个周期，未命中则选第一个有效周期）
        const displayTf = matchedTfs[0] || validList[0].tf;
        const displayRes = tfResultsMap[displayTf] || (validList[0] ? tfResultsMap[validList[0].tf] : undefined);

        const squeezePassed = Object.values(tfResultsMap).some(r => r.squeezePassed);
        const volumePassed = Object.values(tfResultsMap).some(r => r.volumePassed);
        const adxPassed = Object.values(tfResultsMap).some(r => r.adxPassed);
        const tfResonancePassed = Object.values(tfResultsMap).some(r => r.tfResonancePassed);

        return {
            symbol,
            price: currentPrice,
            bbwPct: displayRes ? displayRes.bbwPct : 0,
            isSqueeze: displayRes ? displayRes.isSqueeze : false,
            squeezePassed,
            volRatio: displayRes ? displayRes.volRatio : 0,
            isBrokenOut: displayRes ? displayRes.isBrokenOut : false,
            breakoutDirection: displayRes ? displayRes.breakoutDirection : 'NONE',
            volumePassed,
            solidBodyRatio: displayRes ? displayRes.solidBodyRatio : 0,
            consecutiveVolCount: displayRes ? displayRes.consecutiveVolCount : 1,
            isVolRising: displayRes ? displayRes.isVolRising : false,
            distFromExtremePct: displayRes ? displayRes.distFromExtremePct : 0,
            adxValue: displayRes ? displayRes.adxValue : 0,
            isAdxRising: displayRes ? displayRes.isAdxRising : false,
            adxPassed,
            tfResonancePassed,
            primaryTfDir: displayRes ? displayRes.breakoutDirection : 'NONE',
            confirmTfDir: 'NONE',
            matchedTimeframes: matchedTfs,
            primaryMatchedTf: displayTf,
            timeframeResults: tfResultsMap,
            isPassed,
            matchedRules: Array.from(allMatchedRules),
            failReasons: isPassed ? [] : allFailReasons.slice(0, 3),
            timestamp: Date.now(),
            isCacheHit
        };
    } catch (err: any) {
        defaultFailResult.failReasons = [err?.message || '计算异常'];
        return defaultFailResult;
    }
}

/**
 * 批量执行趋势爆发过滤 (支持 智能双态扫描 / 毫秒级极速流转)
 */
export async function batchAuditBreakout(
    symbols: string[],
    config: BreakoutFilterConfig,
    onProgress?: (current: number, total: number, curSym: string, currentItem?: BreakoutAuditItem, currentPassed?: string[]) => void,
    signal?: AbortSignal
): Promise<{ passed: string[]; details: Record<string, BreakoutAuditItem> }> {
    const passed: string[] = [];
    const details: Record<string, BreakoutAuditItem> = {};
    const total = symbols.length;

    if (total === 0) {
        return { passed, details };
    }

    // 🚀【智能双态极速扫描】:
    // 1. 命中 5m/15m 内存保鲜缓存：5ms 微步进让出 UI 渲染，瞬间全量完成；
    // 2. 未命中缓存 (冷启动拉取)：保留 100ms 安全流控，杜绝币安 IP 限频风险
    for (let i = 0; i < symbols.length; i++) {
        if (signal?.aborted) break;
        const sym = symbols[i];
        const stepStart = Date.now();
        const res = await auditSymbolBreakout(sym, config, signal);
        details[sym] = res;
        if (res.isPassed) {
            passed.push(sym);
        }
        if (onProgress) {
            onProgress(i + 1, total, sym, res, [...passed]);
        }
        const dynamicDelayMs = res.isCacheHit ? 5 : 100;
        const elapsed = Date.now() - stepStart;
        const remaining = Math.max(0, dynamicDelayMs - elapsed);
        if (remaining > 0 && i < symbols.length - 1 && !signal?.aborted) {
            await new Promise(r => setTimeout(r, remaining));
        }
    }

    return { passed, details };
}
