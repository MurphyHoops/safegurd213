// 🔒 LOCKED_MODULE: LIST 1 [龙抬头·资金异动发现过滤规则 - 规则计算引擎]
// @LOCKED: 严格原子化锁定。未经用户明确的专属书面指令，严禁擅自修改、重构或变动龙抬头规则的任何功能与代码。

import { DragonHeadFilterConfig } from '../../components/Scanner/scannerTypes';
import { fetchWithFallback } from '../apiService';

export interface DragonHeadAuditItem {
    symbol: string;
    price: number;
    direction: 'LONG' | 'SHORT';
    timeframe: string;
    
    // 1. 静默蓄势指标
    baseBarsCount: number;
    baseAvgTurnoverM: number;       // 静默期均成交额 (百万 USDT)
    baseAmplitudePct: number;       // 静默期振幅 %
    basePassed: boolean;
    
    // 2. 连续资金放量指标
    consecutiveBars: number;
    recentTurnoverM: number;        // 最新成交额 (百万 USDT)
    volMultiplier: number;          // 放量倍数 (recent / baseAvg)
    isVolRising: boolean;           // 是否连续逐根递增
    volStepValues: number[];        // 最近连续几根K线各自的成交额 (百万 USDT)
    volumePassed: boolean;
    
    // 3. 价格启动与抄底指标
    priceChangePct: number;         // 启动涨幅/跌幅 %
    distanceFromLowPct: number;     // 离阶段最低点涨幅 %
    distanceFromHighPct: number;    // 离阶段最高点跌幅 %
    pricePassed: boolean;
    
    // 综合判定
    isPassed: boolean;
    matchedRules?: string[];
    failReasons: string[];
    timestamp: number;
    isCacheHit?: boolean;
}

// In-memory short-lived K-line cache for sub-second responsive audits
const DRAGON_HEAD_KLINE_CACHE: Record<string, { timestamp: number; klines: any[] }> = {};

export const DEFAULT_DRAGON_HEAD_CONFIG: DragonHeadFilterConfig = {
    enabled: false,
    direction: 'LONG',
    timeframe: '1d',
    scanDelayMs: 800,
    baseLookbackBars: 14,
    maxBaseAmplitude: 25.0,
    consecutiveBars: 3,
    minVolumeMultiplier: 2.0,
    requireConsecutiveRise: true,
    isBottomFishingMode: true,
    minPriceChangePct: 2.0,
    maxPriceChangePct: 25.0,
    maxDistancePctFromLow: 15.0,
};

/**
 * 快速获取币安指定周期的 K 线数据 (30s 内存保鲜缓存 + HIGH 优先级极速直通)
 */
export async function fetchDragonHeadKlines(
    symbol: string, 
    tf: string, 
    limit: number = 60, 
    signal?: AbortSignal
): Promise<{ klines: any[] | null; isCacheHit: boolean }> {
    const safeSymbol = symbol.toUpperCase().replace(/_LONG$|_SHORT$/i, '').replace(/[\/_]/g, '').trim();
    const cacheKey = `${safeSymbol}_${tf}`;
    const now = Date.now();

    const cached = DRAGON_HEAD_KLINE_CACHE[cacheKey];
    if (cached && (now - cached.timestamp < 30000) && cached.klines.length >= limit) {
        return { klines: cached.klines, isCacheHit: true };
    }

    // 检查全局日K缓存加速
    try {
        const globalCache = (window as any).KLINE_LIMIT_CACHE;
        if (globalCache && tf === '1d') {
            const gItem = globalCache[symbol] || globalCache[safeSymbol] || globalCache[`${safeSymbol}_1d`];
            const gKlines = Array.isArray(gItem) ? gItem : gItem?.klines;
            if (Array.isArray(gKlines) && gKlines.length >= limit) {
                DRAGON_HEAD_KLINE_CACHE[cacheKey] = {
                    timestamp: now,
                    klines: gKlines
                };
                return { klines: gKlines, isCacheHit: true };
            }
        }
    } catch (_) {}

    try {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSymbol}&interval=${tf}&limit=${limit}`;
        const res = await fetchWithFallback(url, { timeout: 4000, priority: 'HIGH', signal }, (d) => Array.isArray(d) && d.length > 0);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            DRAGON_HEAD_KLINE_CACHE[cacheKey] = {
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
 * 单币种龙抬头·资金异动综合审计函数
 */
export async function auditSymbolDragonHead(
    symbol: string,
    rawConfig?: DragonHeadFilterConfig,
    signal?: AbortSignal
): Promise<DragonHeadAuditItem> {
    const config: DragonHeadFilterConfig = { ...DEFAULT_DRAGON_HEAD_CONFIG, ...rawConfig };
    const tf = config.timeframe || '1d';
    const direction = config.direction || 'LONG';
    const baseLookback = Math.max(config.baseLookbackBars || 14, 3);
    const consecutiveBars = Math.max(config.consecutiveBars || 3, 2);
    const totalRequiredBars = baseLookback + consecutiveBars + 5;

    const failReasons: string[] = [];
    const defaultFailResult: DragonHeadAuditItem = {
        symbol,
        price: 0,
        direction: direction === 'SHORT' ? 'SHORT' : 'LONG',
        timeframe: tf,
        baseBarsCount: 0,
        baseAvgTurnoverM: 0,
        baseAmplitudePct: 0,
        basePassed: false,
        consecutiveBars,
        recentTurnoverM: 0,
        volMultiplier: 0,
        isVolRising: false,
        volStepValues: [],
        volumePassed: false,
        priceChangePct: 0,
        distanceFromLowPct: 0,
        distanceFromHighPct: 0,
        pricePassed: false,
        isPassed: false,
        failReasons: ['数据加载中或请求超时'],
        timestamp: Date.now()
    };

    const { klines, isCacheHit } = await fetchDragonHeadKlines(symbol, tf, Math.max(totalRequiredBars, 30), signal);
    if (!klines || !Array.isArray(klines) || klines.length < baseLookback + consecutiveBars) {
        return {
            ...defaultFailResult,
            failReasons: [`${tf} K线历史不足(${klines ? klines.length : 0}/${baseLookback + consecutiveBars}根)`]
        };
    }

    const latestBar = klines[klines.length - 1];
    const currentPrice = parseFloat(latestBar[4]) || 0;
    if (currentPrice <= 0) {
        return { ...defaultFailResult, failReasons: ['最新报价异常无效'] };
    }

    // 1. 拆分静默期与连续放量期
    const recentKlines = klines.slice(-consecutiveBars);
    const baseKlines = klines.slice(-(baseLookback + consecutiveBars), -consecutiveBars);

    if (baseKlines.length === 0 || recentKlines.length === 0) {
        return { ...defaultFailResult, failReasons: ['K线拆分计算区间不足'] };
    }

    // -------------------------------------------------------------
    // 维度 1: 静默期蓄势 (Base Calm Period)
    // -------------------------------------------------------------
    // 计算静默期均成交额 (百万 USDT): k[7] 为 quoteVolume (成交额)
    const baseTurnoversM = baseKlines.map(k => {
        const quoteVol = parseFloat(k[7]);
        if (!isNaN(quoteVol) && quoteVol > 0) return quoteVol / 1000000;
        const vol = parseFloat(k[5]) || 0;
        const close = parseFloat(k[4]) || 0;
        return (vol * close) / 1000000;
    });

    const sumBaseTurnover = baseTurnoversM.reduce((acc, v) => acc + v, 0);
    const baseAvgTurnoverM = +(sumBaseTurnover / baseTurnoversM.length).toFixed(3);

    // 静默期价格振幅: (MaxHigh - MinLow) / MinLow * 100
    const baseHighs = baseKlines.map(k => parseFloat(k[2])).filter(v => !isNaN(v) && v > 0);
    const baseLows = baseKlines.map(k => parseFloat(k[3])).filter(v => !isNaN(v) && v > 0);
    const baseMaxHigh = baseHighs.length > 0 ? Math.max(...baseHighs) : currentPrice;
    const baseMinLow = baseLows.length > 0 ? Math.min(...baseLows) : currentPrice;
    const baseAmplitudePct = baseMinLow > 0 ? +(((baseMaxHigh - baseMinLow) / baseMinLow) * 100).toFixed(2) : 0;

    let basePassed = true;
    const maxBaseAmp = config.maxBaseAmplitude !== undefined ? config.maxBaseAmplitude : 25.0;
    if (maxBaseAmp > 0 && baseAmplitudePct > maxBaseAmp) {
        basePassed = false;
        failReasons.push(`静默期振幅${baseAmplitudePct}%超出上限(${maxBaseAmp}%)`);
    }

    // -------------------------------------------------------------
    // 维度 2: 资金异动连续放量 (Continuous Volume Inflow)
    // -------------------------------------------------------------
    const recentTurnoversM = recentKlines.map(k => {
        const quoteVol = parseFloat(k[7]);
        if (!isNaN(quoteVol) && quoteVol > 0) return +(quoteVol / 1000000).toFixed(3);
        const vol = parseFloat(k[5]) || 0;
        const close = parseFloat(k[4]) || 0;
        return +((vol * close) / 1000000).toFixed(3);
    });

    const latestTurnoverM = recentTurnoversM[recentTurnoversM.length - 1];
    const volMultiplier = baseAvgTurnoverM > 0 ? +(latestTurnoverM / baseAvgTurnoverM).toFixed(2) : 1;

    // 逐根连续递增判断 (允许 3% 微小波动容差)
    let isVolRising = true;
    for (let i = 1; i < recentTurnoversM.length; i++) {
        if (recentTurnoversM[i] < recentTurnoversM[i - 1] * 0.97) {
            isVolRising = false;
            break;
        }
    }

    let volumePassed = true;
    if (config.requireConsecutiveRise !== false && !isVolRising) {
        volumePassed = false;
        failReasons.push(`未满足连续${consecutiveBars}根K线成交额递增`);
    }

    const minMultiplier = config.minVolumeMultiplier !== undefined ? config.minVolumeMultiplier : 2.0;
    if (minMultiplier > 0 && volMultiplier < minMultiplier) {
        volumePassed = false;
        failReasons.push(`放量倍数${volMultiplier}x低于设定阈值(${minMultiplier}x)`);
    }

    // -------------------------------------------------------------
    // 维度 3: 价格启动与抄底起爆 (Price Action Initiation)
    // -------------------------------------------------------------
    // 起步基准价: 放量第一根K线的开盘价，或静默期最后一根K线的收盘价
    const startOpenPrice = parseFloat(recentKlines[0][1]) || parseFloat(baseKlines[baseKlines.length - 1][4]) || currentPrice;
    
    // 全区间最低与最高点 (包含静默期与连续放量期)
    const allLookbackKlines = [...baseKlines, ...recentKlines];
    const allLows = allLookbackKlines.map(k => parseFloat(k[3])).filter(v => !isNaN(v) && v > 0);
    const allHighs = allLookbackKlines.map(k => parseFloat(k[2])).filter(v => !isNaN(v) && v > 0);
    const periodLowest = allLows.length > 0 ? Math.min(...allLows) : currentPrice;
    const periodHighest = allHighs.length > 0 ? Math.max(...allHighs) : currentPrice;

    const distanceFromLowPct = periodLowest > 0 ? +(((currentPrice - periodLowest) / periodLowest) * 100).toFixed(2) : 0;
    const distanceFromHighPct = periodHighest > 0 ? +(((periodHighest - currentPrice) / periodHighest) * 100).toFixed(2) : 0;

    let pricePassed = true;
    let priceChangePct = 0;

    if (direction === 'SHORT') {
        // 做空 (倒拔杨柳/高位断头放量)
        priceChangePct = startOpenPrice > 0 ? +(((startOpenPrice - currentPrice) / startOpenPrice) * 100).toFixed(2) : 0;
        
        if (config.minPriceChangePct > 0 && priceChangePct < config.minPriceChangePct) {
            pricePassed = false;
            failReasons.push(`跌幅${priceChangePct}%未达到启动阈值(${config.minPriceChangePct}%)`);
        }
        if (config.maxPriceChangePct > 0 && priceChangePct > config.maxPriceChangePct) {
            pricePassed = false;
            failReasons.push(`跌幅${priceChangePct}%超出上限(${config.maxPriceChangePct}%)`);
        }
        if (config.isBottomFishingMode && config.maxDistancePctFromLow && config.maxDistancePctFromLow > 0) {
            if (distanceFromHighPct > config.maxDistancePctFromLow) {
                pricePassed = false;
                failReasons.push(`距高点已下跌${distanceFromHighPct}%超过防追空阈值(${config.maxDistancePctFromLow}%)`);
            }
        }
    } else {
        // 做多 (龙抬头经典起爆)
        priceChangePct = startOpenPrice > 0 ? +(((currentPrice - startOpenPrice) / startOpenPrice) * 100).toFixed(2) : 0;

        if (config.minPriceChangePct > 0 && priceChangePct < config.minPriceChangePct) {
            pricePassed = false;
            failReasons.push(`启动涨幅${priceChangePct}%未达到起爆阈值(${config.minPriceChangePct}%)`);
        }
        if (config.maxPriceChangePct > 0 && priceChangePct > config.maxPriceChangePct) {
            pricePassed = false;
            failReasons.push(`启动涨幅${priceChangePct}%超出防追高上限(${config.maxPriceChangePct}%)`);
        }
        if (config.isBottomFishingMode && config.maxDistancePctFromLow && config.maxDistancePctFromLow > 0) {
            if (distanceFromLowPct > config.maxDistancePctFromLow) {
                pricePassed = false;
                failReasons.push(`距阶段低点已涨${distanceFromLowPct}%超过抄底上限(${config.maxDistancePctFromLow}%)`);
            }
        }
    }

    const isPassed = basePassed && volumePassed && pricePassed;

    const matchedRules: string[] = [];
    if (basePassed) matchedRules.push('静默蓄势');
    if (volumePassed) matchedRules.push(`放量${volMultiplier}x`);
    if (pricePassed) matchedRules.push(`涨幅+${priceChangePct}%`);

    return {
        symbol,
        price: currentPrice,
        direction: direction === 'SHORT' ? 'SHORT' : 'LONG',
        timeframe: tf,
        baseBarsCount: baseKlines.length,
        baseAvgTurnoverM,
        baseAmplitudePct,
        basePassed,
        consecutiveBars,
        recentTurnoverM: latestTurnoverM,
        volMultiplier,
        isVolRising,
        volStepValues: recentTurnoversM,
        volumePassed,
        priceChangePct,
        distanceFromLowPct,
        distanceFromHighPct,
        pricePassed,
        isPassed,
        matchedRules,
        failReasons: isPassed ? [] : failReasons,
        timestamp: Date.now(),
        isCacheHit
    };
}
