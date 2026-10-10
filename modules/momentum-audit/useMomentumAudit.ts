
/**
 * @file useMomentumAudit.ts
 * @description List 4 Real-time Filter & Breakout Audit Logic
 * @status STRICTLY LOCKED - DO NOT MODIFY WITHOUT EXPLICIT AUTHORIZATION
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { priceRegistry } from '../../services/priceRegistry';
import { usePersistedState } from '../../hooks/usePersistedState';
import { ScannerItem, List4Config, List3Config } from '../../components/Scanner/scannerTypes';
import { analyzeList4Momentum } from '../../services/rules/list4_momentum';
import { checkList3SignalPasses } from '../../services/rules/list3_structure';
import { Position } from '../../types';
import { normalizeSymbol, resolvePrice } from '../../services/symbolUtils';
import { fetchWithFallback } from '../../services/apiService';
import { saveState } from '../../utils/persistence';
import { db, auth } from '../../firebase';
import { collection, addDoc } from 'firebase/firestore';
import { useAutoHistoryLogger } from './components/ScannerHistoryModal';
import { klineMultiTfStore } from '../../services/klineMultiTfStore';
import { KLine } from '../../types';
import { getLatestEMA } from '../../services/indicators';

// Helper to get minutes from tf string
const getTfMinutes = (tf: string) => {
    const unit = tf.slice(-1);
    const val = parseInt(tf);
    if (unit === 'm') return val;
    if (unit === 'h') return val * 60;
    if (unit === 'd') return val * 1440;
    return 15;
};

export const useMomentumAudit = (
    candidates: ScannerItem[], // Input from List 3 (Raw)
    initialConfig: List4Config,
    list3Config: List3Config | null, // Allow null type here
    realPrices: Record<string, number>, // Live Price Feed
    activePositions: Position[] = [], // Active positions
    onRemoveSignal?: (uniqueId: string) => void, // Callback to remove from List 3
    strategyId?: string,
    currentTime?: number // Virtual time for backtesting
) => {
    const suffix = strategyId ? `_${strategyId}` : '';
    const configKey = `SCANNER_LIST4_CONFIG${suffix}`;
    const resultsKey = `SCANNER_LIST4_RESULTS${suffix}`;
    const advFilterBlockTsKey = `SCANNER_LIST4_ADV_FILTER_BLOCK_TS${suffix}`;
    const fuseLatchKey = `SCANNER_LIST4_FUSE_LATCH${suffix}`;
    const expiredSignalsKey = `SCANNER_LIST4_EXPIRED_SIGNALS${suffix}`;

    const [config, setConfig] = usePersistedState<List4Config>(configKey, initialConfig);
    const [list4, setList4] = useState<ScannerItem[]>(() => {
        try {
            const saved = localStorage.getItem(resultsKey);
            if (saved) {
                const parsed = JSON.parse(saved);
                return Array.isArray(parsed) ? parsed : [];
            }
        } catch (e) {}
        return [];
    });
    
    // --- REFS ---
    const realPricesRef = useRef(realPrices);
    const candidatesRef = useRef(candidates);
    const configRef = useRef(config);
    const list3ConfigRef = useRef(list3Config);
    const activePositionsRef = useRef(activePositions);
    const onRemoveSignalRef = useRef(onRemoveSignal);
    const currentTimeRef = useRef(currentTime);
    const lastRunRef = useRef(0);

    // Cache for retention logic
    const invalidSignalCacheRef = useRef<Map<string, number>>(new Map());
    const dormantSignalCacheRef = useRef<Map<string, number>>(new Map());
    const tradedSignalCacheRef = useRef<Map<string, number>>(new Map());
    const triggeredSignalCacheRef = useRef<Map<string, number>>(new Map());
    const fuseBlockedSignalCacheRef = useRef<Map<string, number>>(new Map());
    const advancedFilterBlockedSignalCacheRef = useRef<Map<string, number>>(new Map(
        (() => {
            try {
                const saved = localStorage.getItem(advFilterBlockTsKey);
                if (saved) {
                    const parsed = JSON.parse(saved);
                    return Array.isArray(parsed) ? parsed.map((i: any) => [i.key, i.value]) : [];
                }
            } catch (e) {}
            return [];
        })()
    ));
    const fuseAuditLatchRef = useRef<Map<string, { blocked: boolean, reason: string, details?: any }>>(new Map(
        (() => {
            try {
                const saved = localStorage.getItem(fuseLatchKey);
                if (saved) {
                    const parsed = JSON.parse(saved);
                    return Array.isArray(parsed) ? parsed.map((i: any) => [i.key, i.value]) : [];
                }
            } catch (e) {}
            return [];
        })()
    ));
    const expiredSignalCacheRef = useRef<Set<string>>(new Set(
        (() => {
            try {
                const saved = localStorage.getItem(expiredSignalsKey);
                if (saved) {
                    const parsed = JSON.parse(saved);
                    return Array.isArray(parsed) ? parsed : [];
                }
            } catch (e) {}
            return [];
        })()
    ));

    // 🔒 [列表4独立常驻候选记忆池] 杜绝上游一帧刷新或重算导致列表中处于等待的币突然“闪退”
    const list4CacheRef = useRef<Map<string, ScannerItem>>(new Map(
        (() => {
            try {
                const saved = localStorage.getItem(resultsKey);
                if (saved) {
                    const parsed = JSON.parse(saved);
                    if (Array.isArray(parsed)) {
                        return parsed.map((item: any) => [`${item.symbol}-${item.tf}-${item.direction}`, item]);
                    }
                }
            } catch (e) {}
            return [];
        })()
    ));

    // 🔒 [独立 K 线高保真收盘价缓存通道] 列表 4 独立直连币安抓取对应周期真实已收盘 K 线
    const list4KlinesCacheRef = useRef<Map<string, { closes: number[], timestamp: number }>>(new Map());
    const activeFetchingKeysRef = useRef<Set<string>>(new Set());

    const fetchList4Klines = useCallback(async (symbol: string, tf: string) => {
        const cleanSym = normalizeSymbol(symbol);
        const key = `${cleanSym}-${tf}`;
        const now = Date.now();

        // ⚡ [0-MS RING BUFFER QUERY]: Check global multi-TF ring buffer
        const persistentKlines = klineMultiTfStore.getKlinesSync(cleanSym, tf, 20);
        if (persistentKlines && persistentKlines.length >= 20) {
            const allCloses = persistentKlines.map(k => k.close).filter(v => !isNaN(v) && v > 0);
            const priorCloses = allCloses.length > 1 ? allCloses.slice(0, -1) : allCloses;
            list4KlinesCacheRef.current.set(key, { closes: priorCloses, timestamp: Date.now() });
            return priorCloses;
        }

        const cached = list4KlinesCacheRef.current.get(key);
        if (cached && now - cached.timestamp < 10000) {
            return cached.closes;
        }
        if (activeFetchingKeysRef.current.has(key)) {
            return cached?.closes || [];
        }
        activeFetchingKeysRef.current.add(key);
        try {
            const safeSym = cleanSym.endsWith('USDT') ? cleanSym : `${cleanSym}USDT`;
            const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${safeSym}&interval=${tf}&limit=60&_t=${now}`;
            const res = await fetchWithFallback(url, { cache: 'no-store' }, (d) => Array.isArray(d));
            if (res.ok) {
                const raw = await res.json();
                if (Array.isArray(raw) && raw.length > 0) {
                    const klines: KLine[] = raw.map((k: any) => ({
                        time: Number(k[0]),
                        open: parseFloat(k[1]),
                        high: parseFloat(k[2]),
                        low: parseFloat(k[3]),
                        close: parseFloat(k[4]),
                        volume: parseFloat(k[5]),
                    }));
                    klineMultiTfStore.saveKlines(safeSym, tf, klines);

                    const allCloses = raw.map((k: any) => parseFloat(k[4]) || 0).filter((v: number) => !isNaN(v) && v > 0);
                    // 仅提取已收盘的前序K线收盘价切片（剔除正在形成的最后一根）
                    const priorCloses = allCloses.length > 1 ? allCloses.slice(0, -1) : allCloses;
                    list4KlinesCacheRef.current.set(key, { closes: priorCloses, timestamp: Date.now() });
                    // 异步拿到最新K线后立即重新计算列表4动能，秒级解锁
                    runMomentumAnalysis.current();
                    return priorCloses;
                }
            }
        } catch (e) {
            // silent fallback
        } finally {
            activeFetchingKeysRef.current.delete(key);
        }
        return cached?.closes || [];
    }, []);

    // Keep refs synced
    useEffect(() => { realPricesRef.current = realPrices; }, [realPrices]);
    useEffect(() => { candidatesRef.current = candidates; }, [candidates]);
    useEffect(() => { 
        configRef.current = config; 
        fuseAuditLatchRef.current.clear();
        localStorage.removeItem(fuseLatchKey);
        try {
            localStorage.setItem('SCANNER_LIST4_CONFIG', JSON.stringify(config));
        } catch(e) {}
    }, [config]);
    useEffect(() => { list3ConfigRef.current = list3Config; }, [list3Config]);
    useEffect(() => { activePositionsRef.current = activePositions; }, [activePositions]);
    useEffect(() => { onRemoveSignalRef.current = onRemoveSignal; }, [onRemoveSignal]);
    useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
    const list4Ref = useRef(list4);
    useEffect(() => { list4Ref.current = list4; }, [list4]);

    // Track active List 4 signals and automatically log them to history
    useAutoHistoryLogger('LIST4', list4, activePositions);

    // --- CORE LOGIC: Analysis ---
    // Using refs for core logic to ensure stability and avoid re-renders
    const runMomentumAnalysis = useRef(() => {
        const isLive = currentTimeRef.current === undefined;
        const livePrices = isLive ? priceRegistry.getAllPrices() : {};
        const currentPrices = isLive && Object.keys(livePrices).length > 0 ? livePrices : realPricesRef.current;
        const currentCandidates = candidatesRef.current;
        const currentConfig = configRef.current;
        const l3Config = list3ConfigRef.current;
        const currentPositions = activePositionsRef.current;
        const now = currentTimeRef.current ?? Date.now();

        // SAFE GUARD: If L3 config is not yet loaded, skip analysis to prevent crash
        if (!l3Config) {
            return;
        }

        const isAnyFuseEnabled = !!(currentConfig.enableAntiChase || currentConfig.enableThrust || currentConfig.enableAutoDirGuard || currentConfig.enableAdvancedFilter);

        // 1. Maintain & Ingest Candidates into list4CacheRef
        currentCandidates.forEach(item => {
            const livePrice = resolvePrice(item.symbol, currentPrices, item.price);

            if (item.list3Results) {
                item.list3Results.forEach(res => {
                    // 🎯 列表3放行信号全量进入列表4候选池：兼容 res.latched 判定与列表3配置合法性校验
                    const isLatched = res.latched !== false && (res.latched === true || (list3Config ? checkList3SignalPasses(res, list3Config, item.adjacentStrictTrends) : true));
                    if (!isLatched) return;
                    
                    const uniqueId = `${item.symbol}-${res.tf}-${res.direction}`;
                    
                    // If already permanently expired, skip
                    if (expiredSignalCacheRef.current.has(uniqueId)) return;
                    
                    const cleanSym = normalizeSymbol(item.symbol);
                    const klineKey = `${cleanSym}-${res.tf}`;

                    // 🎯 列表4独立K线补全：确保 recentCloses 100% 存在且为该周期真实已收盘K线
                    let resolvedCloses = res.structure?.recentCloses;
                    if (!resolvedCloses || resolvedCloses.length === 0) {
                        const cachedObj = list4KlinesCacheRef.current.get(klineKey);
                        if (cachedObj && cachedObj.closes.length > 0) {
                            resolvedCloses = cachedObj.closes;
                        } else {
                            fetchList4Klines(item.symbol, res.tf);
                        }
                    } else {
                        list4KlinesCacheRef.current.set(klineKey, { closes: resolvedCloses, timestamp: Date.now() });
                    }

                    let structureEnriched = res.structure ? {
                        ...res.structure,
                        recentCloses: resolvedCloses || []
                    } : res.structure;

                    if (structureEnriched) {
                        let dynamicLag = structureEnriched.lag;
                        if (structureEnriched.signalTime && structureEnriched.signalTime > 0) {
                            const sigMs = structureEnriched.signalTime > 1e11 ? structureEnriched.signalTime : structureEnriched.signalTime * 1000;
                            const tfMs = getTfMinutes(res.tf || '15m') * 60 * 1000;
                            if (tfMs > 0) {
                                dynamicLag = Math.max(structureEnriched.lag || 0, (now - sigMs) / tfMs);
                            }
                        }

                        if (resolvedCloses && resolvedCloses.length >= 30) {
                            const dynamicEma10 = getLatestEMA(resolvedCloses, 10);
                            const dynamicEma20 = getLatestEMA(resolvedCloses, 20);
                            const dynamicEma30 = getLatestEMA(resolvedCloses, 30);
                            const dynamicEma40 = resolvedCloses.length >= 40 ? getLatestEMA(resolvedCloses, 40) : structureEnriched.ema40;
                            const dynamicEma80 = resolvedCloses.length >= 80 ? getLatestEMA(resolvedCloses, 80) : structureEnriched.ema80;

                            structureEnriched = {
                                ...structureEnriched,
                                ema10: dynamicEma10 || structureEnriched.ema10,
                                ema20: dynamicEma20 || structureEnriched.ema20,
                                ema30: dynamicEma30 || structureEnriched.ema30,
                                ema40: dynamicEma40,
                                ema80: dynamicEma80,
                                lag: dynamicLag
                            };
                        } else {
                            structureEnriched = {
                                ...structureEnriched,
                                lag: dynamicLag
                            };
                        }
                    }
                    
                    // LATCH LOGIC: If previously determined as permanently BLOCKED by fuse, retain latch
                    const latchedAudit = fuseAuditLatchRef.current.get(uniqueId);
                    const existing = list4CacheRef.current.get(uniqueId);

                    list4CacheRef.current.set(uniqueId, {
                        ...item,
                        price: livePrice, // Inject fresh live price for dynamic anti-chase evaluation
                        direction: res.direction,
                        tf: res.tf,
                        lag: structureEnriched?.lag ?? item.lag,
                        structure: structureEnriched,
                        historyExtremes: item.historyExtremes,
                        fuseBlocked: existing?.fuseBlocked ?? (isAnyFuseEnabled ? (latchedAudit?.blocked || false) : false),
                        fuseReason: existing?.fuseReason ?? ((isAnyFuseEnabled && latchedAudit) ? (latchedAudit?.reason || '') : ''),
                        fuseDetails: existing?.fuseDetails ?? latchedAudit?.details,
                        fuseLatched: isAnyFuseEnabled ? (latchedAudit?.blocked || false) : false
                    });
                });
            }
        });

        // 🔄 更新常驻池中所有标的实时最新价格与动态 EMA 均线以及实时 Lag
        list4CacheRef.current.forEach((cachedItem) => {
            cachedItem.price = resolvePrice(cachedItem.symbol, currentPrices, cachedItem.price);
            if (cachedItem.structure && cachedItem.tf) {
                const kKey = `${normalizeSymbol(cachedItem.symbol)}-${cachedItem.tf}`;
                const cachedKlines = list4KlinesCacheRef.current.get(kKey);
                const closes = cachedKlines?.closes || cachedItem.structure.recentCloses;
                
                // 1. 动态 Lag 计算：无论 K 线 closes 是否已抓取，结合真实流逝时间自增
                const signalTime = cachedItem.structure.signalTime || 0;
                const sigMs = signalTime > 1e11 ? signalTime : signalTime * 1000;
                const tfMinutes = getTfMinutes(cachedItem.tf || '15m');
                const realTimeLag = (sigMs > 0 && tfMinutes > 0)
                    ? (now - sigMs) / (tfMinutes * 60 * 1000)
                    : (cachedItem.structure.lag || 0);
                const dynLag = Math.max(cachedItem.structure.lag || 0, cachedItem.lag || 0, realTimeLag);

                if (closes && closes.length >= 30) {
                    const dyn10 = getLatestEMA(closes, 10);
                    const dyn20 = getLatestEMA(closes, 20);
                    const dyn30 = getLatestEMA(closes, 30);
                    const dyn40 = closes.length >= 40 ? getLatestEMA(closes, 40) : cachedItem.structure.ema40;
                    const dyn80 = closes.length >= 80 ? getLatestEMA(closes, 80) : cachedItem.structure.ema80;

                    cachedItem.structure = {
                        ...cachedItem.structure,
                        recentCloses: closes,
                        ema10: dyn10 || cachedItem.structure.ema10,
                        ema20: dyn20 || cachedItem.structure.ema20,
                        ema30: dyn30 || cachedItem.structure.ema30,
                        ema40: dyn40,
                        ema80: dyn80,
                        lag: dynLag
                    };
                    cachedItem.lag = dynLag;
                } else {
                    cachedItem.structure = {
                        ...cachedItem.structure,
                        lag: dynLag
                    };
                    cachedItem.lag = dynLag;
                    if (!cachedKlines || Date.now() - cachedKlines.timestamp > 15000) {
                        fetchList4Klines(cachedItem.symbol, cachedItem.tf);
                    }
                }
            }
        });

        const flatCandidates = Array.from(list4CacheRef.current.values());

        // 2. Run Momentum Math
        const analyzedItems = analyzeList4Momentum(flatCandidates, currentConfig);

        // 3. Apply Removal Logic
        const finalItems: ScannerItem[] = [];
        
        const safeRemoveSignal = (uniqueId: string) => {
            queueMicrotask(() => {
                onRemoveSignalRef.current?.(uniqueId);
            });
        };

        analyzedItems.forEach(item => {
            const uniqueId = `${item.symbol}-${item.tf}-${item.direction}`;
            
            // If already permanently expired, skip
            if (expiredSignalCacheRef.current.has(uniqueId)) {
                list4CacheRef.current.delete(uniqueId);
                return;
            }
            
            let shouldKeep = true;
            const tfMinutes = getTfMinutes(item.tf || '15m');
            
            // Check "Structure Broken" (INVALID) - 均线瓦解与偏离过大拦截
            // 🎯 核心铁律：破中轴且EMA10穿越EMA30、或达到寿命根数，必须立即彻底清除！
            if (item.momentum?.status === 'INVALID') {
                const reason = item.momentum.invalidReason || '';
                const isTerminalClear = reason.includes('中轴防守瓦解') || 
                                        reason.includes('信号寿命耗尽') || 
                                        reason.includes('彻底清除') || 
                                        !reason.includes('突破偏离过大拦截');

                if (isTerminalClear) {
                    shouldKeep = false;
                    item.removalReason = reason || '中轴防守瓦解或信号寿命耗尽彻底清除';
                    expiredSignalCacheRef.current.add(uniqueId);
                    try {
                        localStorage.setItem(expiredSignalsKey, JSON.stringify(Array.from(expiredSignalCacheRef.current)));
                    } catch(e) {}
                    list4CacheRef.current.delete(uniqueId);
                    safeRemoveSignal(uniqueId);
                    logToHistory(item, item.removalReason);
                    return; // 立即剔除，绝不存入 finalItems
                } else {
                    item.fuseBlocked = true;
                    item.fuseReason = reason;
                }
            }

            // Check "Dormant Retention" (DORMANT) - 破中轴进入保留期，限制最大寿命K线根数 (默认20根)
            if (item.momentum?.status === 'DORMANT' && !item.fuseBlocked) {
                if (!dormantSignalCacheRef.current.has(uniqueId)) {
                    dormantSignalCacheRef.current.set(uniqueId, now);
                }

                const maxCandles = currentConfig.dormantRetentionCandles ?? 20;
                if (maxCandles > 0) {
                    const enterDormantTime = dormantSignalCacheRef.current.get(uniqueId) || now;
                    const elapsedMs = now - enterDormantTime;
                    const maxMs = maxCandles * tfMinutes * 60 * 1000;

                    if (elapsedMs >= maxMs) {
                        expiredSignalCacheRef.current.add(uniqueId);
                        try {
                            localStorage.setItem(expiredSignalsKey, JSON.stringify(Array.from(expiredSignalCacheRef.current)));
                        } catch(e) {}
                        shouldKeep = false;
                        item.removalReason = `破中轴休眠超期彻底清除 [已休眠 ${Math.round(elapsedMs / (tfMinutes * 60 * 1000))} / ${maxCandles} 根K线]`;
                        list4CacheRef.current.delete(uniqueId);
                        safeRemoveSignal(uniqueId);
                        logToHistory(item, item.removalReason);
                        return;
                    }
                }
            } else {
                // When signal is REVIVED, PENDING, or TRIGGERED, clear dormant timer
                dormantSignalCacheRef.current.delete(uniqueId);
            }
            
            // Check "Triggered" (TRIGGERED)
            if (item.momentum?.status === 'TRIGGERED' && !item.fuseBlocked) {
                if (!triggeredSignalCacheRef.current.has(uniqueId)) {
                    triggeredSignalCacheRef.current.set(uniqueId, now);
                }
                
                if (currentConfig.removeTriggeredMinutes && currentConfig.removeTriggeredMinutes > 0) {
                    const triggeredTime = triggeredSignalCacheRef.current.get(uniqueId) || now;
                    const elapsedMs = now - triggeredTime;
                    const maxMs = currentConfig.removeTriggeredMinutes * 60 * 1000;
                    
                    if (elapsedMs >= maxMs) {
                        expiredSignalCacheRef.current.add(uniqueId);
                        try {
                            localStorage.setItem(expiredSignalsKey, JSON.stringify(Array.from(expiredSignalCacheRef.current)));
                        } catch(e) {}
                        shouldKeep = false;
                        item.removalReason = `由列表4触发后超时规则删除 [已持续: ${Math.round(elapsedMs / 60000)}分钟]`;
                        list4CacheRef.current.delete(uniqueId);
                        safeRemoveSignal(uniqueId);
                        return;
                    }
                }
            } else {
                triggeredSignalCacheRef.current.delete(uniqueId);
            }

            // Check "Fuse Blocked" (fuseBlocked) - 包含防追高熔断、动态方向锁、高级过滤、偏离熔断等所有规则拦截
            if (isAnyFuseEnabled && item.fuseBlocked) {
                if (!fuseBlockedSignalCacheRef.current.has(uniqueId)) {
                    fuseBlockedSignalCacheRef.current.set(uniqueId, now);
                }
                const enterFuseTime = fuseBlockedSignalCacheRef.current.get(uniqueId) || now;
                const elapsedMs = now - enterFuseTime;
                
                // 用户配置的熔断拦截清除分钟数，默认15分钟
                const fuseMinutes = (currentConfig.removeFuseMinutes && currentConfig.removeFuseMinutes > 0)
                    ? currentConfig.removeFuseMinutes
                    : 15;
                const maxMs = fuseMinutes * 60 * 1000;
                
                item.fuseEnteredAt = enterFuseTime;
                item.fuseTotalMs = maxMs;
                item.fuseCountdownMs = Math.max(0, maxMs - elapsedMs);

                // Latch into fuseAuditLatchRef & update memory cache so fuseDetails persists across cycles
                fuseAuditLatchRef.current.set(uniqueId, { 
                    blocked: true, 
                    reason: item.fuseReason || '',
                    details: item.fuseDetails
                });
                const cachedItem = list4CacheRef.current.get(uniqueId);
                if (cachedItem) {
                    cachedItem.fuseBlocked = true;
                    cachedItem.fuseReason = item.fuseReason;
                    cachedItem.fuseDetails = item.fuseDetails;
                }

                if (elapsedMs >= maxMs) {
                    expiredSignalCacheRef.current.add(uniqueId);
                    try {
                        localStorage.setItem(expiredSignalsKey, JSON.stringify(Array.from(expiredSignalCacheRef.current)));
                    } catch(e) {}
                    shouldKeep = false;
                    item.removalReason = item.fuseReason || `由列表4防追高/方向锁/高级过滤规则超时清除 [已持续: ${Math.round(elapsedMs / 60000)}分钟]`;
                    
                    // Clear from latch to be safe
                    fuseAuditLatchRef.current.delete(uniqueId);
                    fuseBlockedSignalCacheRef.current.delete(uniqueId);
                    list4CacheRef.current.delete(uniqueId);
                    
                    // Remove from upstream List 3 structure audit and cache (联动清除列表3与列表2)
                    safeRemoveSignal(uniqueId);
                    
                    // Background log to history
                    logToHistory(item, item.removalReason);
                    return;
                } else {
                    // 🎯 在倒计时未结束前，绝对保留在列表4中，由前端展示为浅黄色并提示倒计时！绝不瞬时闪退！
                    shouldKeep = true;
                }
            } else {
                fuseBlockedSignalCacheRef.current.delete(uniqueId);
                advancedFilterBlockedSignalCacheRef.current.delete(uniqueId);
            }

            // Check "Position Opened" (TRADED)
            const hasPosition = currentPositions.some(p => p.symbol === item.symbol && p.side === item.direction);
            if (hasPosition) {
                if (!tradedSignalCacheRef.current.has(uniqueId)) {
                    tradedSignalCacheRef.current.set(uniqueId, now);
                }
                
                const tradedTime = tradedSignalCacheRef.current.get(uniqueId) || now;
                const elapsedMs = now - tradedTime;
                
                item.isTraded = true;
                item.tradedAt = tradedTime;

                // 达到开仓条件开仓后，标记为已开仓，（？）分钟/秒后清除这个币
                const tradeRetentionMinutes = (currentConfig.removeTradedCandles && currentConfig.removeTradedCandles > 0)
                    ? currentConfig.removeTradedCandles * tfMinutes
                    : (currentConfig.removeTriggeredMinutes && currentConfig.removeTriggeredMinutes > 0)
                        ? currentConfig.removeTriggeredMinutes
                        : 15;
                const maxMs = tradeRetentionMinutes * 60 * 1000;
                item.tradedTotalMs = maxMs;
                item.tradedCountdownMs = Math.max(0, maxMs - elapsedMs);

                if (elapsedMs >= maxMs) {
                    expiredSignalCacheRef.current.add(uniqueId);
                    shouldKeep = false;
                    item.removalReason = `满足动能突破开仓成功，建立仓位后移出 [持仓持续: ${Math.round(elapsedMs / 60000)}分钟]`;
                    tradedSignalCacheRef.current.delete(uniqueId);
                    list4CacheRef.current.delete(uniqueId);
                    safeRemoveSignal(uniqueId);
                    logToHistory(item, item.removalReason);
                } else {
                    shouldKeep = true;
                }
            } else {
                // Reset if position is closed
                tradedSignalCacheRef.current.delete(uniqueId);
            }
            
            if (shouldKeep) {
                finalItems.push(item);
            } else {
                list4CacheRef.current.delete(uniqueId);
            }
        });

        // Clean up caches for items that are no longer in the pipeline
        const currentIds = new Set(analyzedItems.map(item => `${item.symbol}-${item.tf}-${item.direction}`));
        for (const key of invalidSignalCacheRef.current.keys()) {
            if (!currentIds.has(key)) invalidSignalCacheRef.current.delete(key);
        }
        for (const key of dormantSignalCacheRef.current.keys()) {
            if (!currentIds.has(key)) dormantSignalCacheRef.current.delete(key);
        }
        for (const key of tradedSignalCacheRef.current.keys()) {
            if (!currentIds.has(key)) tradedSignalCacheRef.current.delete(key);
        }
        for (const key of triggeredSignalCacheRef.current.keys()) {
            if (!currentIds.has(key)) triggeredSignalCacheRef.current.delete(key);
        }
        for (const key of fuseBlockedSignalCacheRef.current.keys()) {
            if (!currentIds.has(key)) fuseBlockedSignalCacheRef.current.delete(key);
        }
        for (const key of expiredSignalCacheRef.current.keys()) {
            if (!currentIds.has(key)) expiredSignalCacheRef.current.delete(key);
        }

        // 4. Update State
        const prevList = list4Ref.current;
        const sameLength = prevList.length === finalItems.length;
        
        let shouldUpdateState = !sameLength;
        if (!shouldUpdateState) {
            for (let i = 0; i < finalItems.length; i++) {
                const prev = prevList[i];
                const next = finalItems[i];
                if (
                    `${prev.symbol}-${prev.tf}-${prev.direction}` !== `${next.symbol}-${next.tf}-${next.direction}` ||
                    prev.price !== next.price ||
                    prev.momentum?.status !== next.momentum?.status ||
                    prev.momentum?.entryTrigger !== next.momentum?.entryTrigger ||
                    prev.momentum?.midPoint !== next.momentum?.midPoint ||
                    prev.fuseBlocked !== next.fuseBlocked ||
                    prev.fuseReason !== next.fuseReason ||
                    JSON.stringify(prev.fuseDetails) !== JSON.stringify(next.fuseDetails) ||
                    prev.isTraded !== next.isTraded ||
                    prev.fuseEnteredAt !== next.fuseEnteredAt ||
                    prev.tradedAt !== next.tradedAt
                ) {
                    shouldUpdateState = true;
                    break;
                }
            }
        }

        if (shouldUpdateState) {
            setList4(finalItems);
        }

    // Persistence (every 10s or on change)
        const persistenceKey = 'SCANNER_LIST4_PERSIST_TS';
        const lastPersist = Number(sessionStorage.getItem(persistenceKey) || 0);
        if (now - lastPersist > 10000) {
            saveState(resultsKey, finalItems, 100);
            saveState(fuseLatchKey, Array.from(fuseAuditLatchRef.current.entries()).map(([key, value]) => ({ key, value })), 500);
            saveState(advFilterBlockTsKey, Array.from(advancedFilterBlockedSignalCacheRef.current.entries()).map(([key, value]) => ({ key, value })), 1000);
            saveState(expiredSignalsKey, Array.from(expiredSignalCacheRef.current), 1000);
            sessionStorage.setItem(persistenceKey, now.toString());
        }
    });
    // Run analysis synchronously and immediately for millisecond-level execution speed
    const runAnalysisSync = useCallback(() => {
        const selectedId = typeof window !== 'undefined' ? localStorage.getItem('SCANNER_SELECTED_STRATEGY_ID') : '';
        const isBg = strategyId && selectedId ? strategyId !== selectedId : false;
        if (isBg) {
            const now = Date.now();
            if (now - lastRunRef.current < 5000) {
                return;
            }
            lastRunRef.current = now;
        }
        runMomentumAnalysis.current();
    }, [strategyId]);

    // CRITICAL LATENCY REFIX: Re-run analysis immediately when list 3 candidates or config updates
    useEffect(() => {
        runAnalysisSync();
    }, [candidates, config, runAnalysisSync]);

    const logToHistory = useCallback(async (item: ScannerItem, reason: string) => {
        if (!auth.currentUser) return;
        try {
            await addDoc(collection(db, 'momentum_history'), {
                symbol: item.symbol,
                direction: item.direction,
                price: item.price,
                timestamp: Date.now(),
                listType: 'LIST4',
                uid: auth.currentUser.uid,
                reason: reason,
                itemData: {
                    symbol: item.symbol,
                    price: item.price,
                    tf: item.tf || '',
                    direction: item.direction || ''
                }
            });
        } catch (e) {
            console.error('Failed to log to history:', e);
        }
    }, []);

    // --- MANUAL ACTIONS ---
    const removeSymbol = useCallback((symbol: string) => {
        // Since List 4 is derived from List 3, we tell List 3 to remove this symbol
        // We do this by calling onRemoveSignal for every item in list4 that matches this symbol
        const itemsToRemove = list4.filter(item => item.symbol === symbol);
        itemsToRemove.forEach(item => {
            const uniqueId = `${item.symbol}-${item.tf}-${item.direction}`;
            list4CacheRef.current.delete(uniqueId);
            fuseBlockedSignalCacheRef.current.delete(uniqueId);
            tradedSignalCacheRef.current.delete(uniqueId);
            dormantSignalCacheRef.current.delete(uniqueId);
            expiredSignalCacheRef.current.add(uniqueId);
            onRemoveSignalRef.current?.(uniqueId);
        });
        setList4(prev => prev.filter(i => i.symbol !== symbol));
    }, [list4]);

    const clearItems = useCallback(() => {
        // Clear all List 4 signals from List 3
        list4CacheRef.current.clear();
        fuseBlockedSignalCacheRef.current.clear();
        tradedSignalCacheRef.current.clear();
        dormantSignalCacheRef.current.clear();
        expiredSignalCacheRef.current.clear();
        list4.forEach(item => {
            const uniqueId = `${item.symbol}-${item.tf}-${item.direction}`;
            onRemoveSignalRef.current?.(uniqueId);
        });
        setList4([]);
    }, [list4]);

    // --- HEARTBEAT & DUAL-INSURANCE PULSE TIMER ---
    // 🔒 [双保险触发体系] WebSocket 极速事件直通 + 500ms 兜底心跳脉冲，彻底免疫网络重连或瞬时静默
    useEffect(() => {
        // 1. WebSocket 毫秒级极速事件监听
        const unsubscribe = priceRegistry.registerListener(() => {
            runAnalysisSync();
        });

        // 2. 500ms 兜底安全心跳脉冲（即使 WS 短暂断连或重连中，也保证秒级轮询判定开仓）
        const intervalTimer = setInterval(() => {
            runAnalysisSync();
        }, 500);

        // 3. 初始挂载立即执行一次
        runAnalysisSync();

        return () => {
            unsubscribe();
            clearInterval(intervalTimer);
        };
    }, [runAnalysisSync]);
    // ^ Removed candidates, config, list3Config because runMomentumAnalysis relies on refs, 
    // and runMomentumAnalysis itself is memoized.

    return {
        config,
        setConfig,
        list4,
        removeSymbol,
        clearItems
    };
};
