
import { BreakoutFilterConfig } from '../../components/Scanner/scannerTypes';
import { calculateBollingerBands, calculateATR, calculateADX, calculateEMA, checkEmaDivergence } from '../indicators';
import { fetchWithFallback } from '../apiService';

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
    // 3. 动能与多周期
    adxValue: number;
    isAdxRising: boolean;
    adxPassed: boolean;
    tfResonancePassed: boolean;
    primaryTfDir: 'LONG' | 'SHORT' | 'NONE';
    confirmTfDir: 'LONG' | 'SHORT' | 'NONE';
    // 综合判定
    isPassed: boolean;
    matchedRules?: string[];
    failReasons: string[];
    timestamp: number;
}

// In-memory short-lived K-line cache for sub-second responsive audits
const BREAKOUT_KLINE_CACHE: Record<string, { timestamp: number; klines: any[] }> = {};

export const DEFAULT_BREAKOUT_CONFIG: BreakoutFilterConfig = {
    enabled: false,
    combinationMode: 'OR', // 默认 'OR' 模式 (满足任一即可进入市场初筛)
    scanDelayMs: 1000, // 默认 1000ms (1秒1币，平稳扫描防超频)
    // 1. 空间极致蓄势
    enableSqueeze: true,
    maxBbwPercent: 3.0,
    requireSqueezeInKc: true,
    squeezeBars: 20,
    // 2. 突破点火放量
    enableVolumeSpike: true,
    volMultiplier: 2.0,
    breakoutMode: 'BB_BANDS',
    breakoutBars: 20,
    breakoutDirection: 'BOTH',
    // 3. 动能与多周期
    enableAdx: true,
    minAdx: 22,
    requireAdxRising: true,
    enableMultiTfResonance: true,
    primaryTf: '5m',
    confirmTf: '15m',
    resonanceMode: 'TWO_TF'
};

/**
 * 快速获取币安指定周期的 K 线数据
 */
export async function fetchTfKlines(symbol: string, tf: string, limit: number = 60, signal?: AbortSignal): Promise<any[] | null> {
    const safeSymbol = symbol.toUpperCase().replace(/_LONG$|_SHORT$/i, '').replace(/[\/_]/g, '').trim();
    const cacheKey = `${safeSymbol}_${tf}`;
    const now = Date.now();

    const cached = BREAKOUT_KLINE_CACHE[cacheKey];
    if (cached && (now - cached.timestamp < 10000) && cached.klines.length >= limit) {
        return cached.klines;
    }

    try {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=${tf}&limit=${limit}`;
        const res = await fetchWithFallback(url, { timeout: 10000, signal }, (d) => Array.isArray(d) && d.length > 0);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            BREAKOUT_KLINE_CACHE[cacheKey] = {
                timestamp: now,
                klines: data
            };
            return data;
        }
        return null;
    } catch (_) {
        return null;
    }
}

/**
 * 单币种趋势爆发综合审计函数
 */
export async function auditSymbolBreakout(
    symbol: string,
    rawConfig?: BreakoutFilterConfig,
    signal?: AbortSignal
): Promise<BreakoutAuditItem> {
    const config: BreakoutFilterConfig = { ...DEFAULT_BREAKOUT_CONFIG, ...rawConfig };
    const primaryTf = config.primaryTf || '5m';
    const confirmTf = config.confirmTf || '15m';

    const failReasons: string[] = [];
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
        isPassed: false,
        failReasons: ['数据加载中或请求超时'],
        timestamp: Date.now()
    };

    try {
        // 1. 获取主触发周期 K 线 (默认 5m, 60 根)
        const primaryKlines = await fetchTfKlines(symbol, primaryTf, 60, signal);
        if (!primaryKlines || primaryKlines.length < 30) {
            defaultFailResult.failReasons = ['主周期K线不足'];
            return defaultFailResult;
        }

        const closes = primaryKlines.map(k => parseFloat(k[4]));
        const highs = primaryKlines.map(k => parseFloat(k[2]));
        const lows = primaryKlines.map(k => parseFloat(k[3]));
        const opens = primaryKlines.map(k => parseFloat(k[1]));
        const volumes = primaryKlines.map(k => parseFloat(k[5]));
        const currentPrice = closes[closes.length - 1];

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
                    failReasons.push(`BBW带宽(${bbwPct}%)高于上限(${config.maxBbwPercent}%)`);
                }
                if (config.requireSqueezeInKc && !isSqueeze) {
                    squeezePassed = false;
                    failReasons.push('未进入KC通道挤压态');
                }
            }
        }

        // --- 维度 ②: 突破点火放量 (Volume & Breakout) ---
        let volRatio = 1.0;
        let isBrokenOut = false;
        let breakoutDirection: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
        let volumePassed = true;

        const volPeriod = 20;
        if (volumes.length >= volPeriod) {
            const recentVols = volumes.slice(-volPeriod - 1, -1);
            const avgVol = recentVols.reduce((a, b) => a + b, 0) / (recentVols.length || 1);
            const curVol = volumes[volumes.length - 1];
            volRatio = avgVol > 0 ? +(curVol / avgVol).toFixed(2) : 1.0;

            const curClose = closes[closes.length - 1];
            const curOpen = opens[opens.length - 1];
            const prevUpperBB = lastBbIdx >= 0 ? bb.upper[lastBbIdx] : 0;
            const prevLowerBB = lastBbIdx >= 0 ? bb.lower[lastBbIdx] : 0;

            if (config.breakoutMode === 'BB_BANDS' && prevUpperBB > 0 && prevLowerBB > 0) {
                if (curClose > prevUpperBB && curClose > curOpen) {
                    isBrokenOut = true;
                    breakoutDirection = 'LONG';
                } else if (curClose < prevLowerBB && curClose < curOpen) {
                    isBrokenOut = true;
                    breakoutDirection = 'SHORT';
                }
            } else {
                // 破近 N 根极值
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

            if (config.enableVolumeSpike) {
                if (volRatio < (config.volMultiplier ?? 2.0)) {
                    volumePassed = false;
                    failReasons.push(`成交量比(${volRatio}x)低于要求(${config.volMultiplier}x)`);
                }
                if (!isBrokenOut) {
                    volumePassed = false;
                    failReasons.push('未形成实体破位突破');
                }
                if (config.breakoutDirection && config.breakoutDirection !== 'BOTH') {
                    if (breakoutDirection !== config.breakoutDirection) {
                        volumePassed = false;
                        failReasons.push(`突破方向不符合(${config.breakoutDirection})`);
                    }
                }
            }
        }

        // --- 维度 ③: 动能爆发与多周期共振 (ADX & Multi-TF) ---
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
                    failReasons.push(`ADX动能(${adxValue})低于阈值(${config.minAdx})`);
                }
                if (config.requireAdxRising && !isAdxRising) {
                    adxPassed = false;
                    failReasons.push('ADX未向上拐头拉升');
                }
            }
        }

        // 多周期发散共振校验 (5M + 15M / 30M)
        let tfResonancePassed = true;
        let primaryTfDir: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
        let confirmTfDir: 'LONG' | 'SHORT' | 'NONE' = 'NONE';

        if (config.enableMultiTfResonance) {
            const primaryDiv = checkEmaDivergence(closes, [10, 20, 30, 40]);
            primaryTfDir = primaryDiv || 'NONE';

            // 拉取高级确认周期 K 线 (如 15m)
            const confirmKlines = await fetchTfKlines(symbol, confirmTf, 50, signal);
            if (confirmKlines && confirmKlines.length >= 30) {
                const confirmCloses = confirmKlines.map(k => parseFloat(k[4]));
                const confirmDiv = checkEmaDivergence(confirmCloses, [10, 20, 30, 40]);
                confirmTfDir = confirmDiv || 'NONE';
            }

            if (primaryTfDir === 'NONE') {
                tfResonancePassed = false;
                failReasons.push(`主周期(${primaryTf})未形成EMA发散`);
            } else if (confirmTfDir !== 'NONE' && primaryTfDir !== confirmTfDir) {
                tfResonancePassed = false;
                failReasons.push(`周期方向矛盾(主:${primaryTfDir} vs 确认:${confirmTfDir})`);
            }
        }

        // 综合判定 (支持 OR 或模式 / AND 与模式)
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
            // OR 模式：只要满足任意一个开启的过滤条件即可通过
            isPassed = activeDimensions.some(d => d.passed);
        } else {
            // AND 模式：必须满足所有开启的过滤条件
            isPassed = activeDimensions.every(d => d.passed);
        }

        const matchedRules = activeDimensions.filter(d => d.passed).map(d => d.name);

        return {
            symbol,
            price: currentPrice,
            bbwPct,
            isSqueeze,
            squeezePassed,
            volRatio,
            isBrokenOut,
            breakoutDirection,
            volumePassed,
            adxValue,
            isAdxRising,
            adxPassed,
            tfResonancePassed,
            primaryTfDir,
            confirmTfDir,
            isPassed,
            matchedRules,
            failReasons: isPassed ? [] : failReasons,
            timestamp: Date.now()
        };
    } catch (err: any) {
        defaultFailResult.failReasons = [err?.message || '计算异常'];
        return defaultFailResult;
    }
}

/**
 * 批量执行趋势爆发过滤 (支持 1秒1币 / 自定义步进延时，平稳防封与精细扫描)
 */
export async function batchAuditBreakout(
    symbols: string[],
    config: BreakoutFilterConfig,
    onProgress?: (current: number, total: number, curSym: string) => void,
    signal?: AbortSignal
): Promise<{ passed: string[]; details: Record<string, BreakoutAuditItem> }> {
    const passed: string[] = [];
    const details: Record<string, BreakoutAuditItem> = {};
    const total = symbols.length;

    if (total === 0) {
        return { passed, details };
    }

    const delayMs = config.scanDelayMs ?? 1000;

    if (delayMs > 0) {
        // 🛡️ 稳健步进扫描模式：逐币扫描并等待设定延时 (如 1秒1币)，保证平稳与零漏失
        for (let i = 0; i < symbols.length; i++) {
            if (signal?.aborted) break;
            const sym = symbols[i];
            if (onProgress) {
                onProgress(i + 1, total, sym);
            }
            const res = await auditSymbolBreakout(sym, config, signal);
            details[sym] = res;
            if (res.isPassed) {
                passed.push(sym);
            }
            if (i < symbols.length - 1 && !signal?.aborted) {
                await new Promise(r => setTimeout(r, delayMs));
            }
        }
    } else {
        // ⚡ 极速全开并发模式 (0ms)
        const batchSize = 3;
        for (let i = 0; i < symbols.length; i += batchSize) {
            if (signal?.aborted) break;
            const batch = symbols.slice(i, i + batchSize);
            await Promise.all(batch.map(async (sym, idx) => {
                if (signal?.aborted) return;
                const res = await auditSymbolBreakout(sym, config, signal);
                details[sym] = res;
                if (res.isPassed) {
                    passed.push(sym);
                }
                if (onProgress) {
                    onProgress(Math.min(i + idx + 1, total), total, sym);
                }
            }));
        }
    }

    return { passed, details };
}
