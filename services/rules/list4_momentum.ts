// LOCKED
// Rule Lock: The core logic for Advanced Filter in List 4 (Momentum Audit) is now locked.
// Any modifications to this filtering logic or the intersection calculation MUST be authorized by a special directive.

import { List4Config, ScannerItem } from '../../components/Scanner/scannerTypes';

// Helper: Calculate EMA
function calculateEMA(data: number[], period: number): number[] {
    const k = 2 / (period + 1);
    let ema = [data[0]];
    for (let i = 1; i < data.length; i++) {
        ema.push(data[i] * k + ema[i - 1] * (1 - k));
    }
    return ema;
}

export function analyzeList4Momentum(
    items: ScannerItem[],
    config: List4Config
): ScannerItem[] {
    
    return items.map(item => {
        if (!item.structure) return null;

        const currentPrice = item.price;
        
        const extreme = item.direction === 'LONG'
            ? Math.min(item.structure.postSignalExtreme ?? currentPrice, currentPrice)
            : Math.max(item.structure.postSignalExtreme ?? currentPrice, currentPrice);
        
        const bestPrice = item.direction === 'LONG'
            ? Math.max(item.structure.postSignalMaxHigh ?? currentPrice, currentPrice)
            : Math.min(item.structure.postSignalMinLow ?? currentPrice, currentPrice);
        
        // 最高价与最低价基准 (high, low, price_range)
        const rawHigh = typeof item.structure?.signalHigh === 'number' && item.structure.signalHigh > 0
            ? item.structure.signalHigh
            : (item.structure?.signalPrice ?? item.price);
        const rawLow = typeof item.structure?.signalLow === 'number' && item.structure.signalLow > 0
            ? item.structure.signalLow
            : (item.structure?.signalPrice ?? item.price);
        
        const high = Math.max(rawHigh, rawLow);
        const low = Math.min(rawHigh, rawLow);
        const raw_price_range = high - low;
        const price_range = raw_price_range > (item.price * 0.0005) ? raw_price_range : (item.price * 0.0005); 
        
        const defense_pct = ((config && typeof config.midlineThreshold === 'number' && !isNaN(config.midlineThreshold)) ? config.midlineThreshold : 80) / 100;
        const breakout_pct = ((config && typeof config.breakoutThreshold === 'number' && !isNaN(config.breakoutThreshold)) ? config.breakoutThreshold : 10) / 100;

        // 【1. 进攻突破线算法（开仓线）】
        // 做多进攻突破价 = 最高价 + (最高价 - 最低价) * 进攻突破百分比
        // 做空进攻突破价 = 最低价 - (最高价 - 最低价) * 进攻突破百分比
        const long_breakout = high + price_range * breakout_pct;
        const short_breakout = low - price_range * breakout_pct;

        // 【2. 中轴防守线算法（清除线）】
        // 做多中轴防守价 = 最高价 - (最高价 - 最低价) * 中轴防守百分比
        // 做空中轴防守价 = 最低价 + (最高价 - 最低价) * 中轴防守百分比
        const long_defense = high - price_range * defense_pct;
        const short_defense = low + price_range * defense_pct;

        let midPoint = 0;
        let entryTrigger = 0;
        
        if (item.direction === 'LONG') {
            entryTrigger = long_breakout;
            midPoint = long_defense; 
        } else {
            entryTrigger = short_breakout;
            midPoint = short_defense;
        }

        let momentumStatus: 'INVALID' | 'PENDING' | 'TRIGGERED' | 'DORMANT' | 'REVIVED' = 'PENDING';
        let invalidReason = '';

        const triggerEpsilon = currentPrice * 0.00001; // Float precision tolerance (0.001%)

        const ema10 = item.structure?.ema10;
        const ema20 = item.structure?.ema20;
        const ema30 = item.structure?.ema30;
        const hasEmas = typeof ema10 === 'number' && typeof ema30 === 'number' && !isNaN(ema10) && !isNaN(ema30);
        const hasEma20 = typeof ema20 === 'number' && !isNaN(ema20);

        // 🎯 动态严密判定「前 NK 突破」：做多实时价格必须 > 前 NK 最高收盘价；做空实时价格必须 < 前 NK 最低收盘价
        const kCount = Math.max(1, Math.min(50, config.rev3KCandles ?? 3));
        let maxCloseN: number | undefined = undefined;
        let minCloseN: number | undefined = undefined;

        if (item.structure) {
            if (item.structure.recentCloses && item.structure.recentCloses.length > 0) {
                const slice = item.structure.recentCloses.slice(-kCount);
                if (slice.length > 0) {
                    maxCloseN = Math.max(...slice);
                    minCloseN = Math.min(...slice);
                }
            }
            if (typeof maxCloseN !== 'number') maxCloseN = item.structure.maxClose3;
            if (typeof minCloseN !== 'number') minCloseN = item.structure.minClose3;
        }

        const is3KPassed = (() => {
            if (config.enableRev3K !== true) return true;
            if (!item.structure) return true;
            if (item.direction === 'LONG') {
                if (typeof maxCloseN === 'number') {
                    return currentPrice > maxCloseN;
                }
                return item.structure.isBreakout3K !== false;
            } else {
                if (typeof minCloseN === 'number') {
                    return currentPrice < minCloseN;
                }
                return item.structure.isBreakout3K !== false;
            }
        })();

        // 获取列表2设置的寿命根数 (默认9根)
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

        const lag = item.structure?.lag ?? item.lag ?? 0;
        const isLongEmaDead = hasEmas && hasEma20 && ema10 < ema20 && ema10 < ema30;
        const isShortEmaDead = hasEmas && hasEma20 && ema10 > ema20 && ema10 > ema30;

        const formatN = (val?: number) => typeof val === 'number' && isFinite(val) ? val.toFixed(4) : '';

        if (config.enableThresholds === true) {
            if (item.direction === 'LONG') {
                const isDefenseBroken = currentPrice < midPoint || extreme < midPoint;
                const isEmaTrendDead = hasEmas && ema10 < ema30;

                if (isDefenseBroken) {
                    if (isEmaTrendDead) {
                        momentumStatus = 'INVALID';
                        invalidReason = `【规则 1 - 中轴防守瓦解】均线形态瓦解彻底清除 [EMA10(${ema10?.toFixed(4)}) 下穿 EMA30(${ema30?.toFixed(4)})]`;
                    } else if (currentPrice >= (entryTrigger - triggerEpsilon)) {
                        // 破中轴但均线未死，且当前实时价格再次强力打穿原始突破线 -> 满血复活！
                        if (!is3KPassed) {
                            if (isLongEmaDead && lag > list2Retention) {
                                momentumStatus = 'INVALID';
                                invalidReason = `【规则 1 - 中轴防守瓦解】等待突破期间均线形态瓦解且超列表2寿命根数(${lag}>${list2Retention}) [EMA10(${ema10?.toFixed(4)}) 下穿 EMA20/30]`;
                            } else {
                                momentumStatus = 'REVIVED';
                                invalidReason = `破中轴后满血复活：等待前${kCount}K突破 (已达突破线，未越过前${kCount}K最高收盘价: ${formatN(maxCloseN)})`;
                            }
                        } else {
                            momentumStatus = 'TRIGGERED';
                            invalidReason = '破中轴后蓄势反攻：已达突破线 (TRIGGERED)';
                        }
                    } else {
                        // 破中轴，但 EMA10 依然在 EMA30 之上：进入休眠蓄势等待复活
                        momentumStatus = 'DORMANT';
                        const curStr = typeof currentPrice === 'number' && isFinite(currentPrice) ? currentPrice.toFixed(4) : String(currentPrice);
                        const midStr = typeof midPoint === 'number' && isFinite(midPoint) ? midPoint.toFixed(4) : String(midPoint);
                        invalidReason = `【规则 2 - 破中轴休眠蓄势中】[${curStr} < ${midStr}]，均线多头保持完好 (EMA10 > EMA30)，等待突破前高复活`;
                    }
                } else if (currentPrice >= (entryTrigger - triggerEpsilon)) {
                    if (!is3KPassed) {
                        if (isLongEmaDead && lag > list2Retention) {
                            momentumStatus = 'INVALID';
                            invalidReason = `【规则 1 - 中轴防守瓦解】等待前${kCount}K突破期间均线形态瓦解且超列表2寿命根数(${lag}>${list2Retention}) [EMA10(${ema10?.toFixed(4)}) 下穿 EMA20/30]`;
                        } else {
                            momentumStatus = 'PENDING';
                            invalidReason = `【规则 3 - 前${kCount}K突破门禁】等待前${kCount}K突破 (已达突破线，未越过前${kCount}K收盘最高价: ${formatN(maxCloseN)})`;
                        }
                    } else {
                        momentumStatus = 'TRIGGERED';
                    }
                } else {
                    if (isLongEmaDead && lag > list2Retention) {
                        momentumStatus = 'INVALID';
                        invalidReason = `【规则 1 - 中轴防守瓦解】等待突破期间均线形态瓦解且超列表2寿命根数(${lag}>${list2Retention}) [EMA10(${ema10?.toFixed(4)}) 下穿 EMA20/30]`;
                    } else {
                        momentumStatus = 'PENDING';
                    }
                }
            } else {
                const isDefenseBroken = currentPrice > midPoint || extreme > midPoint;
                const isEmaTrendDead = hasEmas && ema10 > ema30;

                if (isDefenseBroken) {
                    if (isEmaTrendDead) {
                        momentumStatus = 'INVALID';
                        invalidReason = `【规则 1 - 中轴防守瓦解】均线形态瓦解彻底清除 [EMA10(${ema10?.toFixed(4)}) 上穿 EMA30(${ema30?.toFixed(4)})]`;
                    } else if (currentPrice <= (entryTrigger + triggerEpsilon)) {
                        // 破中轴但均线未死，且当前实时价格再次打穿原始突破线 -> 满血复活！
                        if (!is3KPassed) {
                            if (isShortEmaDead && lag > list2Retention) {
                                momentumStatus = 'INVALID';
                                invalidReason = `【规则 1 - 中轴防守瓦解】等待突破期间均线形态瓦解且超列表2寿命根数(${lag}>${list2Retention}) [EMA10(${ema10?.toFixed(4)}) 上穿 EMA20/30]`;
                            } else {
                                momentumStatus = 'REVIVED';
                                invalidReason = `破中轴后满血复活：等待前${kCount}K突破 (已达突破线，未越过前${kCount}K最低收盘价: ${formatN(minCloseN)})`;
                            }
                        } else {
                            momentumStatus = 'TRIGGERED';
                            invalidReason = '破中轴后蓄势反攻：已达突破线 (TRIGGERED)';
                        }
                    } else {
                        // 破中轴，但 EMA10 依然在 EMA30 之下：进入休眠蓄势等待复活
                        momentumStatus = 'DORMANT';
                        const curStr = typeof currentPrice === 'number' && isFinite(currentPrice) ? currentPrice.toFixed(4) : String(currentPrice);
                        const midStr = typeof midPoint === 'number' && isFinite(midPoint) ? midPoint.toFixed(4) : String(midPoint);
                        invalidReason = `【规则 2 - 破中轴休眠蓄势中】[${curStr} > ${midStr}]，均线空头保持完好 (EMA10 < EMA30)，等待跌破前低复活`;
                    }
                } else if (currentPrice <= (entryTrigger + triggerEpsilon)) {
                    if (!is3KPassed) {
                        if (isShortEmaDead && lag > list2Retention) {
                            momentumStatus = 'INVALID';
                            invalidReason = `【规则 1 - 中轴防守瓦解】等待前${kCount}K突破期间均线形态瓦解且超列表2寿命根数(${lag}>${list2Retention}) [EMA10(${ema10?.toFixed(4)}) 上穿 EMA20/30]`;
                        } else {
                            momentumStatus = 'PENDING';
                            invalidReason = `【规则 3 - 前${kCount}K突破门禁】等待前${kCount}K突破 (已达突破线，未越过前${kCount}K收盘最低价: ${formatN(minCloseN)})`;
                        }
                    } else {
                        momentumStatus = 'TRIGGERED';
                    }
                } else {
                    if (isShortEmaDead && lag > list2Retention) {
                        momentumStatus = 'INVALID';
                        invalidReason = `【规则 1 - 中轴防守瓦解】等待突破期间均线形态瓦解且超列表2寿命根数(${lag}>${list2Retention}) [EMA10(${ema10?.toFixed(4)}) 上穿 EMA20/30]`;
                    } else {
                        momentumStatus = 'PENDING';
                    }
                }
            }
        } else {
            // When enableThresholds is OFF (false), never invalidate on defense line
            const isBreakout = item.direction === 'LONG'
                ? (currentPrice >= (entryTrigger - triggerEpsilon))
                : (currentPrice <= (entryTrigger + triggerEpsilon));

            if (isBreakout) {
                if (!is3KPassed) {
                    if (item.direction === 'LONG' && isLongEmaDead && lag > list2Retention) {
                        momentumStatus = 'INVALID';
                        invalidReason = `等待前${kCount}K突破期间均线形态瓦解且超列表2寿命根数(${lag}>${list2Retention}) [EMA10(${ema10?.toFixed(4)}) 下穿 EMA20/30]`;
                    } else if (item.direction === 'SHORT' && isShortEmaDead && lag > list2Retention) {
                        momentumStatus = 'INVALID';
                        invalidReason = `等待前${kCount}K突破期间均线形态瓦解且超列表2寿命根数(${lag}>${list2Retention}) [EMA10(${ema10?.toFixed(4)}) 上穿 EMA20/30]`;
                    } else {
                        momentumStatus = 'PENDING';
                        invalidReason = item.direction === 'LONG'
                            ? `等待前${kCount}K突破 (未越过前${kCount}K收盘最高价: ${formatN(maxCloseN)})`
                            : `等待前${kCount}K突破 (未越过前${kCount}K收盘最低价: ${formatN(minCloseN)})`;
                    }
                } else {
                    momentumStatus = 'TRIGGERED';
                }
            } else {
                if (item.direction === 'LONG' && isLongEmaDead && lag > list2Retention) {
                    momentumStatus = 'INVALID';
                    invalidReason = `等待突破期间均线形态瓦解且超列表2寿命根数(${lag}>${list2Retention}) [EMA10(${ema10?.toFixed(4)}) 下穿 EMA20/30]`;
                } else if (item.direction === 'SHORT' && isShortEmaDead && lag > list2Retention) {
                    momentumStatus = 'INVALID';
                    invalidReason = `等待突破期间均线形态瓦解且超列表2寿命根数(${lag}>${list2Retention}) [EMA10(${ema10?.toFixed(4)}) 上穿 EMA20/30]`;
                } else {
                    momentumStatus = 'PENDING';
                }
            }
        }

        const isAnyFuseEnabled = !!(config.enableAntiChase === true || config.enableThrust === true || config.enableAutoDirGuard === true || config.enableAdvancedFilter === true);

        let fuseBlocked = isAnyFuseEnabled ? (item.fuseLatched || false) : false;
        let fuseReason = (isAnyFuseEnabled && item.fuseLatched) ? (item.fuseReason || '已锁定') : '';
        let fuseDetails = isAnyFuseEnabled ? item.fuseDetails : undefined;
        
        const antiChase = config.antiChaseConfig;

        if (!item.fuseLatched && config.enableAntiChase === true && item.historyExtremes && antiChase) {
            const { highs1h, lows1h } = item.historyExtremes;

            if (item.direction === 'LONG' && antiChase.longThresholds) {
                for (const [hoursStr, threshold] of Object.entries(antiChase.longThresholds)) {
                    if (threshold <= 0) continue;
                    const hours = parseInt(hoursStr);
                    const lows = lows1h ? lows1h.slice(-hours) : [];
                    const minPrice = lows.length > 0 ? Math.min(...lows) : currentPrice;
                    const pump = ((currentPrice - minPrice) / minPrice) * 100;
                    
                    if (pump > threshold) {
                        fuseBlocked = true;
                        fuseReason = `【规则 4 - 防追高熔断拦截】由列表4防追高过滤规则删除 [${hours}小时内涨幅 ${pump.toFixed(1)}% > 阈值 ${threshold}%]`;
                        fuseDetails = { period: `${hours}小时`, threshold: threshold, actual: parseFloat(pump.toFixed(1)) };
                        break;
                    }
                }
            } else if (item.direction === 'SHORT' && antiChase.shortThresholds) {
                for (const [hoursStr, threshold] of Object.entries(antiChase.shortThresholds)) {
                    if (threshold <= 0) continue;
                    const hours = parseInt(hoursStr);
                    const highs = highs1h ? highs1h.slice(-hours) : [];
                    const maxPrice = highs.length > 0 ? Math.max(...highs) : currentPrice;
                    const drop = ((maxPrice - currentPrice) / maxPrice) * 100;
                    
                    if (drop > threshold) {
                        fuseBlocked = true;
                        fuseReason = `【规则 4 - 防追高熔断拦截】由列表4防追高过滤规则删除 [${hours}小时内跌幅 ${drop.toFixed(1)}% > 阈值 ${threshold}%]`;
                        fuseDetails = { period: `${hours}小时`, threshold: threshold, actual: parseFloat(drop.toFixed(1)) };
                        break;
                    }
                }
            }
        }

        if (config.enableThrust === true && item.structure && !item.structure.thrustValid) {
            fuseBlocked = true;
            fuseReason = `【规则 4 - 7K推进力熔断】由列表4推进力过滤规则删除 [7根K线推进力不足 (<1%)]`;
        }

        if (!item.fuseLatched && config.enableAutoDirGuard === true && item.historyExtremes && config.autoDirConfig) {
            const { highs1h, lows1h } = item.historyExtremes;
            const autoDir = config.autoDirConfig;
            
            const periods = [
                { key: '1Q', hours: 2160, limit: autoDir.limit1Q },
                { key: '1M', hours: 720,  limit: autoDir.limit1M },
                { key: '1W', hours: 168,  limit: autoDir.limit1W },
                { key: '1D', hours: 24,   limit: autoDir.limit1D },
                { key: '1H', hours: 1,    limit: autoDir.limit1H }
            ];

            for (const p of periods) {
                if (!p.limit || p.limit <= 0) continue;
                
                const candles = p.hours;
                const arrH = highs1h ? highs1h.slice(-candles) : [];
                const arrL = lows1h ? lows1h.slice(-candles) : [];
                const maxPrice = arrH.length > 0 ? Math.max(...arrH) : currentPrice;
                const minPrice = arrL.length > 0 ? Math.min(...arrL) : currentPrice;

                if (item.direction === 'LONG') {
                    const pump = ((currentPrice - minPrice) / minPrice) * 100;
                    if (pump > p.limit) {
                        fuseBlocked = true;
                        fuseReason = `【规则 4 - 动态方向锁熔断】由列表4动态方向锁规则删除 [周期: ${p.key}, 涨幅 ${pump.toFixed(1)}% > 限制 ${p.limit}%]`;
                        fuseDetails = { period: `${p.key}`, threshold: p.limit, actual: parseFloat(pump.toFixed(1)) };
                        break;
                    }
                } else if (item.direction === 'SHORT') {
                    const drop = ((maxPrice - currentPrice) / maxPrice) * 100;
                    if (drop > p.limit) {
                        fuseBlocked = true;
                        fuseReason = `【规则 4 - 动态方向锁熔断】由列表4动态方向锁规则删除 [周期: ${p.key}, 跌幅 ${drop.toFixed(1)}% > 限制 ${p.limit}%]`;
                        fuseDetails = { period: `${p.key}`, threshold: p.limit, actual: parseFloat(drop.toFixed(1)) };
                        break;
                    }
                }
            }
        }

        if (!item.fuseLatched && config.enableAdvancedFilter === true && item.historyExtremes) {
            const { highs1h, lows1h } = item.historyExtremes;
            
            // Build groups array
            const groups: any[] = [];
            if (config.advancedFilterGroups && config.advancedFilterGroups.length > 0) {
                groups.push(...config.advancedFilterGroups.filter(g => g.enabled));
            } else if (config.advancedFilterConfig) {
                groups.push({
                    id: 1,
                    enabled: true,
                    filterTimeParam: config.advancedFilterConfig.filterTimeParam,
                    filterKLinePeriod: config.advancedFilterConfig.filterKLinePeriod,
                    filterEmaPeriod: config.advancedFilterConfig.filterEmaPeriod,
                    filterCrossingCount: config.advancedFilterConfig.filterCrossingCount,
                    filterLongMaxPump: config.advancedFilterConfig.filterLongMaxPump,
                    filterShortMinDrop: config.advancedFilterConfig.filterShortMinDrop
                });
            }

            for (const group of groups) {
                const emaPeriod = group.filterEmaPeriod || 80;
                const maxIntersections = group.filterCrossingCount || 3;
                
                let hoursPerPeriod = 1;
                switch (group.filterKLinePeriod) {
                    case '1h': hoursPerPeriod = 1; break;
                    case '4h': hoursPerPeriod = 4; break;
                    case '1d': hoursPerPeriod = 24; break;
                    case '1w': hoursPerPeriod = 168; break;
                    case '1M': hoursPerPeriod = 720; break;
                    case '1Q': hoursPerPeriod = 2160; break;
                }

                // Downsample highs1h and lows1h to target periods
                const highsTarget: number[] = [];
                const lowsTarget: number[] = [];
                
                if (highs1h && lows1h) {
                    for (let idx = 0; idx < highs1h.length; idx += hoursPerPeriod) {
                        const chunkHighs = highs1h.slice(idx, Math.min(highs1h.length, idx + hoursPerPeriod));
                        const chunkLows = lows1h.slice(idx, Math.min(lows1h.length, idx + hoursPerPeriod));
                        if (chunkHighs.length > 0) {
                            highsTarget.push(Math.max(...chunkHighs));
                            lowsTarget.push(Math.min(...chunkLows));
                        }
                    }
                }

                const pricesTarget = highsTarget.map((h, idx) => (h + lowsTarget[idx]) / 2);
                
                if (pricesTarget.length >= emaPeriod) {
                    const fullEma = calculateEMA(pricesTarget, emaPeriod);
                    
                    const klineCount = group.filterTimeParam || 100;
                    const slicedHighs = highsTarget.slice(-klineCount);
                    const slicedLows = lowsTarget.slice(-klineCount);
                    const slicedPrices = pricesTarget.slice(-klineCount);
                    const slicedEma = fullEma.slice(-klineCount);

                    let intersections = 0;
                    let lastIntersectionIdx = -1;

                    for (let i = 0; i < slicedPrices.length; i++) {
                        const low = slicedLows[i];
                        const high = slicedHighs[i];
                        const emaVal = slicedEma[i];
                        if (emaVal !== undefined) {
                            // If the High/Low span intersects with the EMA baseline, we count it as an intersection
                            // User requirement: EMA must be strictly within (low, high)
                            if (low < emaVal && high > emaVal) {
                                intersections++;
                                lastIntersectionIdx = i;
                            }
                        }
                    }

                    if (intersections > maxIntersections) {
                        fuseBlocked = true;
                        fuseReason = `【规则 5 - 高级过滤相交限制】[第${group.id}组]: 在最近 ${klineCount} 根 ${group.filterKLinePeriod} K线内，K线与EMA${emaPeriod}相交 ${intersections} 次，超过上限 ${maxIntersections} 次（震荡整理中）`;
                        break;
                    } else if (lastIntersectionIdx !== -1) {
                        const priceAtIntersection = slicedPrices[lastIntersectionIdx];
                        if (item.direction === 'LONG') {
                            const pumpFromIntersection = ((currentPrice - priceAtIntersection) / priceAtIntersection) * 100;
                            if (pumpFromIntersection > group.filterLongMaxPump) {
                                fuseBlocked = true;
                                fuseReason = `【规则 5 - 高级过滤涨幅限制】[第${group.id}组]: 多头从最近一次EMA${emaPeriod}交叉点涨幅过大 (${pumpFromIntersection.toFixed(1)}% > 限制 ${group.filterLongMaxPump}%)，防止追高`;
                                break;
                            }
                        } else {
                            const dropFromIntersection = ((priceAtIntersection - currentPrice) / priceAtIntersection) * 100;
                            if (dropFromIntersection > Math.abs(group.filterShortMinDrop)) {
                                fuseBlocked = true;
                                fuseReason = `【规则 5 - 高级过滤跌幅限制】[第${group.id}组]: 空头从最近一次EMA${emaPeriod}交叉点跌幅过大 (${dropFromIntersection.toFixed(1)}% > 限制 ${Math.abs(group.filterShortMinDrop)}%)，防止追空`;
                                break;
                            }
                        }
                    }
                }
            }
        }

        if (config.directionFilter !== 'BOTH') {
            if (config.directionFilter === 'LONG' && item.direction !== 'LONG') return null;
            if (config.directionFilter === 'SHORT' && item.direction !== 'SHORT') return null;
        }

        return {
            ...item,
            momentum: {
                midPoint,
                entryTrigger,
                purityValid: true,
                breakoutValid: true,
                status: momentumStatus,
                invalidReason
            },
            fuseBlocked,
            fuseReason,
            fuseDetails
        };
    }).filter(Boolean) as ScannerItem[];
}
