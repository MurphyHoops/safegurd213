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
        
        const signalHigh = item.structure.signalHigh ?? item.price; 
        const signalLow = item.structure.signalLow ?? item.price;
        const amplitude = signalHigh - signalLow;

        const safeAmplitude = amplitude > (item.price * 0.0005) ? amplitude : (item.price * 0.0005); 
        
        const defenseBuffer = safeAmplitude * (config.midlineThreshold / 100);
        const breakoutBuffer = safeAmplitude * (config.breakoutThreshold / 100);

        let midPoint = 0;
        let entryTrigger = 0;
        
        if (item.direction === 'LONG') {
            midPoint = signalHigh - defenseBuffer; 
            entryTrigger = signalHigh + breakoutBuffer;
        } else {
            midPoint = signalLow + defenseBuffer;
            entryTrigger = signalLow - breakoutBuffer;
        }

        let momentumStatus: 'INVALID' | 'PENDING' | 'TRIGGERED' = 'PENDING';
        let invalidReason = '';

        const epsilon = currentPrice * 0.0005; 

        if (config.enableThresholds !== false) {
            if (item.direction === 'LONG') {
                if (extreme < (midPoint - epsilon)) {
                    momentumStatus = 'INVALID';
                    invalidReason = `结构破坏: 回撤(${extreme.toFixed(4)}) 跌破防守线(${midPoint.toFixed(4)})`;
                } else if (currentPrice >= (entryTrigger - epsilon)) {
                    momentumStatus = 'TRIGGERED';
                }
            } else {
                if (extreme > (midPoint + epsilon)) {
                    momentumStatus = 'INVALID';
                    invalidReason = `结构破坏: 反弹(${extreme.toFixed(4)}) 突破防守线(${midPoint.toFixed(4)})`;
                } else if (currentPrice <= (entryTrigger - epsilon)) {
                    momentumStatus = 'TRIGGERED';
                }
            }
        } else {
            momentumStatus = 'TRIGGERED';
        }

        let fuseBlocked = item.fuseLatched || false;
        let fuseReason = item.fuseLatched ? (item.fuseReason || '已锁定') : '';
        let fuseDetails = item.fuseDetails;
        
        const antiChase = config.antiChaseConfig;

        if (!item.fuseLatched && config.enableAntiChase && item.historyExtremes) {
            const { highs1h, lows1h } = item.historyExtremes;

            if (item.direction === 'LONG') {
                for (const [hoursStr, threshold] of Object.entries(antiChase.longThresholds)) {
                    if (threshold <= 0) continue;
                    const hours = parseInt(hoursStr);
                    const lows = lows1h ? lows1h.slice(-hours) : [];
                    const minPrice = lows.length > 0 ? Math.min(...lows) : currentPrice;
                    const pump = ((currentPrice - minPrice) / minPrice) * 100;
                    
                    if (pump > threshold) {
                        fuseBlocked = true;
                        fuseReason = `防追高: ${hours}小时内涨幅 ${pump.toFixed(1)}% > ${threshold}%`;
                        fuseDetails = { period: `${hours}小时`, threshold: threshold, actual: parseFloat(pump.toFixed(1)) };
                        break;
                    }
                }
            } else if (item.direction === 'SHORT') {
                for (const [hoursStr, threshold] of Object.entries(antiChase.shortThresholds)) {
                    if (threshold <= 0) continue;
                    const hours = parseInt(hoursStr);
                    const highs = highs1h ? highs1h.slice(-hours) : [];
                    const maxPrice = highs.length > 0 ? Math.max(...highs) : currentPrice;
                    const drop = ((maxPrice - currentPrice) / maxPrice) * 100;
                    
                    if (drop > threshold) {
                        fuseBlocked = true;
                        fuseReason = `防追跌: ${hours}小时内跌幅 ${drop.toFixed(1)}% > ${threshold}%`;
                        fuseDetails = { period: `${hours}小时`, threshold: threshold, actual: parseFloat(drop.toFixed(1)) };
                        break;
                    }
                }
            }
        }

        if (config.enableRev3K && item.structure?.isReverse3K) {
            fuseBlocked = true;
            fuseReason = `逆势三连K拦截 (Rev 3K)`;
        }

        if (config.enableThrust && item.structure && !item.structure.thrustValid) {
            fuseBlocked = true;
            fuseReason = `7K推进力不足 (<1%)`;
        }

        if (!item.fuseLatched && config.enableAutoDirGuard && item.historyExtremes && config.autoDirConfig) {
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
                        fuseReason = `动态方向锁: ${p.key} 涨幅过大 (${pump.toFixed(1)}% > ${p.limit}%)`;
                        fuseDetails = { period: `${p.key}`, threshold: p.limit, actual: parseFloat(pump.toFixed(1)) };
                        break;
                    }
                } else if (item.direction === 'SHORT') {
                    const drop = ((maxPrice - currentPrice) / maxPrice) * 100;
                    if (drop > p.limit) {
                        fuseBlocked = true;
                        fuseReason = `动态方向锁: ${p.key} 跌幅过大 (${drop.toFixed(1)}% > ${p.limit}%)`;
                        fuseDetails = { period: `${p.key}`, threshold: p.limit, actual: parseFloat(drop.toFixed(1)) };
                        break;
                    }
                }
            }
        }

        if (!item.fuseLatched && config.enableAdvancedFilter && item.historyExtremes) {
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
                            if (low <= emaVal && high >= emaVal) {
                                intersections++;
                                lastIntersectionIdx = i;
                            }
                        }
                    }

                    if (intersections > maxIntersections) {
                        fuseBlocked = true;
                        fuseReason = `高级过滤限制[第${group.id}组]: 在最近 ${klineCount} 根 ${group.filterKLinePeriod} K线内，K线与EMA${emaPeriod}相交 ${intersections} 次，超过上限 ${maxIntersections} 次（震荡整理中）。`;
                        break;
                    } else if (lastIntersectionIdx !== -1) {
                        const priceAtIntersection = slicedPrices[lastIntersectionIdx];
                        if (item.direction === 'LONG') {
                            const pumpFromIntersection = ((currentPrice - priceAtIntersection) / priceAtIntersection) * 100;
                            if (pumpFromIntersection > group.filterLongMaxPump) {
                                fuseBlocked = true;
                                fuseReason = `高级过滤限制[第${group.id}组]: 多头从最近一次EMA${emaPeriod}交叉点涨幅过大 (${pumpFromIntersection.toFixed(1)}% > ${group.filterLongMaxPump}%)，防止追高。`;
                                break;
                            }
                        } else {
                            const dropFromIntersection = ((priceAtIntersection - currentPrice) / priceAtIntersection) * 100;
                            if (dropFromIntersection > Math.abs(group.filterShortMinDrop)) {
                                fuseBlocked = true;
                                fuseReason = `高级过滤限制[第${group.id}组]: 空头从最近一次EMA${emaPeriod}交叉点跌幅过大 (${dropFromIntersection.toFixed(1)}% > ${Math.abs(group.filterShortMinDrop)}%)，防止追空。`;
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
