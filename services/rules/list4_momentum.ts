// 🔒 LOCKED_MODULE: LIST 4 [动能趋势审计 & 突破开仓规则 - 纯净闭环版]
import { List4Config, ScannerItem } from '../../components/Scanner/scannerTypes';

// Helper: 提取 1440 分钟 (24 小时) 极值 (最高价 Max High 与 最低价 Min Low)
function get1440Extremes(item: ScannerItem): { maxHigh1440: number; minLow1440: number; isValid: boolean } {
    const currentPrice = item.price || 0;
    let maxH = 0;
    let minL = Infinity;

    if (item.historyExtremes?.scalars) {
        const s = item.historyExtremes.scalars;
        if (typeof s.high_1440m === 'number' && s.high_1440m > 0) maxH = Math.max(maxH, s.high_1440m);
        if (typeof s.high_24h === 'number' && s.high_24h > 0) maxH = Math.max(maxH, s.high_24h);
        if (typeof s.low_1440m === 'number' && s.low_1440m > 0) minL = Math.min(minL, s.low_1440m);
        if (typeof s.low_24h === 'number' && s.low_24h > 0) minL = Math.min(minL, s.low_24h);
    }

    if (item.historyExtremes?.highs1h && item.historyExtremes.highs1h.length > 0) {
        const sliceH = item.historyExtremes.highs1h.slice(-24);
        maxH = Math.max(maxH, ...sliceH);
    }
    if (item.historyExtremes?.lows1h && item.historyExtremes.lows1h.length > 0) {
        const sliceL = item.historyExtremes.lows1h.slice(-24).filter(v => typeof v === 'number' && v > 0);
        if (sliceL.length > 0) minL = Math.min(minL, ...sliceL);
    }

    if (item.historyExtremes?.highs1m && item.historyExtremes.highs1m.length > 0) {
        const sliceH = item.historyExtremes.highs1m.slice(-1440);
        maxH = Math.max(maxH, ...sliceH);
    }
    if (item.historyExtremes?.lows1m && item.historyExtremes.lows1m.length > 0) {
        const sliceL = item.historyExtremes.lows1m.slice(-1440).filter(v => typeof v === 'number' && v > 0);
        if (sliceL.length > 0) minL = Math.min(minL, ...sliceL);
    }

    if (typeof item.highPrice === 'number' && item.highPrice > 0) maxH = Math.max(maxH, item.highPrice);
    if (typeof item.lowPrice === 'number' && item.lowPrice > 0) minL = Math.min(minL, item.lowPrice);
    if (typeof item.structure?.postSignalMaxHigh === 'number' && item.structure.postSignalMaxHigh > 0) maxH = Math.max(maxH, item.structure.postSignalMaxHigh);
    if (typeof item.structure?.postSignalMinLow === 'number' && item.structure.postSignalMinLow > 0) minL = Math.min(minL, item.structure.postSignalMinLow);

    // 实时价格修正防呆
    if (currentPrice > 0) {
        maxH = Math.max(maxH, currentPrice);
        if (minL === Infinity || minL <= 0) {
            minL = currentPrice;
        } else {
            minL = Math.min(minL, currentPrice);
        }
    }

    const isValid = maxH > 0 && minL > 0 && isFinite(maxH) && isFinite(minL) && maxH >= minL;
    return { maxHigh1440: maxH, minLow1440: minL, isValid };
}

// Helper: 纯净版 EMA 公式计算
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
        if (!item) return null;

        const currentPrice = item.price || 0;
        const structure = item.structure || {
            signalHigh: currentPrice * 1.01,
            signalLow: currentPrice * 0.99,
            signalPrice: currentPrice,
            lag: item.lag ?? 0,
            rsi: 50,
            isStrictTrend: true,
            isColorValid: true,
        };

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

        // 【1. 进攻突破线与中轴防守线】
        const long_breakout = high + price_range * breakout_pct;
        const short_breakout = low - price_range * breakout_pct;
        const long_defense = high - price_range * defense_pct;
        const short_defense = low + price_range * defense_pct;

        let midPoint = item.direction === 'LONG' ? long_defense : short_defense;
        let entryTrigger = item.direction === 'LONG' ? long_breakout : short_breakout;

        let momentumStatus: 'INVALID' | 'PENDING' | 'TRIGGERED' | 'DORMANT' | 'REVIVED' = 'PENDING';
        let invalidReason = '';

        const triggerEpsilon = currentPrice * 0.00001;
        const ema10 = item.structure?.ema10;
        const ema20 = item.structure?.ema20;
        const ema30 = item.structure?.ema30;
        const hasEmas = typeof ema10 === 'number' && typeof ema30 === 'number' && !isNaN(ema10) && !isNaN(ema30);
        const hasEma20 = typeof ema20 === 'number' && !isNaN(ema20);

        // 前 NK 突破判定 (精确排除当根信号/当前正在形成的 K 线，抓取前 NK 根历史已收盘 K 线极值)
        const kCount = Math.max(1, Math.min(50, config.rev3KCandles ?? 3));
        let maxCloseN: number | undefined = undefined;
        let minCloseN: number | undefined = undefined;

        if (item.structure) {
            if (item.structure.recentCloses && item.structure.recentCloses.length > 0) {
                const priorCloses = item.structure.recentCloses.length > 1
                    ? item.structure.recentCloses.slice(0, -1)
                    : item.structure.recentCloses;
                const slice = priorCloses.slice(-kCount);
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
            if (!item.structure) return false;
            if (item.direction === 'LONG') {
                return typeof maxCloseN === 'number' ? currentPrice > maxCloseN : false;
            } else {
                return typeof minCloseN === 'number' ? currentPrice < minCloseN : false;
            }
        })();

        // 寿命根数核算 (单行无损数学计算)
        let list2Retention = 9;
        try {
            if (typeof window !== 'undefined') {
                const activeId = localStorage.getItem("SCANNER_SELECTED_STRATEGY_ID");
                const cleanId = activeId ? (activeId.startsWith('"') ? JSON.parse(activeId) : activeId) : '';
                const candidates = [
                    cleanId ? localStorage.getItem(`SCANNER_LIST2_CONFIG_${cleanId}`) : null,
                    localStorage.getItem('SCANNER_LIST2_CONFIG'),
                    localStorage.getItem('SCANNER_LIST2_CONFIG_default')
                ];
                for (const raw of candidates) {
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        if (parsed.newModeRetention && parsed.newModeRetention > 0) {
                            list2Retention = parsed.newModeRetention;
                            break;
                        } else if (parsed.maxLag && parsed.maxLag > 0) {
                            list2Retention = parsed.maxLag;
                            break;
                        }
                    }
                }
            }
        } catch(e) {}

        const rawLag = item.structure?.lag ?? item.lag ?? 0;
        let lag = rawLag;
        if (item.structure?.signalTime && item.structure.signalTime > 0) {
            const sigMs = item.structure.signalTime > 1e11 ? item.structure.signalTime : item.structure.signalTime * 1000;
            const tfMinutes = item.tf ? (parseInt(item.tf) * (item.tf.endsWith('h') ? 60 : item.tf.endsWith('d') ? 1440 : 1)) : 15;
            if (tfMinutes > 0) {
                const realTimeLag = (Date.now() - sigMs) / (tfMinutes * 60 * 1000);
                lag = Math.max(rawLag, realTimeLag);
            }
        }

        const isLongEmaDead = hasEmas && hasEma20 && ema10 < ema20 && ema10 < ema30;
        const isShortEmaDead = hasEmas && hasEma20 && ema10 > ema20 && ema10 > ema30;
        const formatN = (val?: number) => typeof val === 'number' && isFinite(val) ? val.toFixed(4) : '';
        const maxDevPct = (config && typeof config.maxBreakoutDeviation === 'number' && !isNaN(config.maxBreakoutDeviation)) ? config.maxBreakoutDeviation : 100;

        // ⚡ 复活与休眠状态闭锁感知：杜绝等待前NK期间的跨Tick离散跳闪
        const wasDormantOrRevived = item.momentum?.status === 'DORMANT' || item.momentum?.status === 'REVIVED' || (item as any).isDormant === true;

        if (config.enableThresholds === true) {
            if (item.direction === 'LONG') {
                const isDefenseBroken = currentPrice < midPoint;
                const isEmaTrendDead = hasEmas && ema10 < ema30;
                const maxAllowedLongPrice = entryTrigger + (price_range * (maxDevPct / 100));
                const isLongOverDeviated = currentPrice > maxAllowedLongPrice;
                const isBreakout = currentPrice >= (entryTrigger - triggerEpsilon);

                if (isDefenseBroken) {
                    if (isEmaTrendDead) {
                        momentumStatus = 'INVALID';
                        invalidReason = `【中轴防守瓦解】均线死叉彻底清除 [EMA10(${ema10?.toFixed(4)}) < EMA30(${ema30?.toFixed(4)})]`;
                    } else if (lag >= list2Retention) {
                        momentumStatus = 'INVALID';
                        invalidReason = `【信号寿命耗尽】破中轴等待期间达到寿命根数(${Math.floor(lag)} >= ${list2Retention})`;
                    } else {
                        momentumStatus = 'DORMANT';
                        invalidReason = `【破中轴休眠蓄势】[${currentPrice.toFixed(4)} < ${midPoint.toFixed(4)}]，均线完好，等待冲高复活`;
                    }
                } else if (lag >= list2Retention) {
                    momentumStatus = 'INVALID';
                    invalidReason = `【信号寿命耗尽】已达寿命根数(${Math.floor(lag)} >= ${list2Retention})`;
                } else if (isBreakout) {
                    if (isLongOverDeviated && config.enableAntiChase === true) {
                        momentumStatus = 'INVALID';
                        invalidReason = `【突破偏离过大】价格超出 ${maxDevPct}% 振幅缓冲区 [${currentPrice.toFixed(4)} > ${maxAllowedLongPrice.toFixed(4)}]`;
                    } else if (!is3KPassed) {
                        if (isLongEmaDead) {
                            momentumStatus = 'INVALID';
                            invalidReason = `【均线瓦解】等待前${kCount}K突破期间形态破位`;
                        } else {
                            momentumStatus = wasDormantOrRevived ? 'REVIVED' : 'PENDING';
                            invalidReason = `【等待前${kCount}K突破】已达突破线，未越过前${kCount}K高点: ${formatN(maxCloseN)}`;
                        }
                    } else {
                        momentumStatus = 'TRIGGERED';
                        invalidReason = wasDormantOrRevived ? '破中轴后满血复活：已达成完全突破 (REVIVED->TRIGGERED)' : '进攻突破线达成';
                    }
                } else {
                    if (isLongEmaDead) {
                        momentumStatus = 'INVALID';
                        invalidReason = `【形态瓦解】均线多头破位`;
                    } else {
                        momentumStatus = 'PENDING';
                    }
                }
            } else {
                // 空头对称逻辑
                const isDefenseBroken = currentPrice > midPoint;
                const isEmaTrendDead = hasEmas && ema10 > ema30;
                const minAllowedShortPrice = entryTrigger - (price_range * (maxDevPct / 100));
                const isShortOverDeviated = currentPrice < minAllowedShortPrice;
                const isBreakout = currentPrice <= (entryTrigger + triggerEpsilon);

                if (isDefenseBroken) {
                    if (isEmaTrendDead) {
                        momentumStatus = 'INVALID';
                        invalidReason = `【中轴防守瓦解】均线金叉彻底清除 [EMA10(${ema10?.toFixed(4)}) > EMA30(${ema30?.toFixed(4)})]`;
                    } else if (lag >= list2Retention) {
                        momentumStatus = 'INVALID';
                        invalidReason = `【信号寿命耗尽】破中轴期间达到寿命根数(${Math.floor(lag)} >= ${list2Retention})`;
                    } else {
                        momentumStatus = 'DORMANT';
                        invalidReason = `【破中轴休眠蓄势】[${currentPrice.toFixed(4)} > ${midPoint.toFixed(4)}]，均线完好，等待反弹复活`;
                    }
                } else if (lag >= list2Retention) {
                    momentumStatus = 'INVALID';
                    invalidReason = `【信号寿命耗尽】已达寿命根数(${Math.floor(lag)} >= ${list2Retention})`;
                } else if (isBreakout) {
                    if (isShortOverDeviated && config.enableAntiChase === true) {
                        momentumStatus = 'INVALID';
                        invalidReason = `【突破偏离过大】价格跌破 ${maxDevPct}% 振幅缓冲区 [${currentPrice.toFixed(4)} < ${minAllowedShortPrice.toFixed(4)}]`;
                    } else if (!is3KPassed) {
                        if (isShortEmaDead) {
                            momentumStatus = 'INVALID';
                            invalidReason = `【均线瓦解】等待前${kCount}K突破期间形态破位`;
                        } else {
                            momentumStatus = wasDormantOrRevived ? 'REVIVED' : 'PENDING';
                            invalidReason = `【等待前${kCount}K突破】已达突破线，未越过前${kCount}K低点: ${formatN(minCloseN)}`;
                        }
                    } else {
                        momentumStatus = 'TRIGGERED';
                        invalidReason = wasDormantOrRevived ? '破中轴后满血复活：已达成完全突破 (REVIVED->TRIGGERED)' : '进攻突破线达成';
                    }
                } else {
                    if (isShortEmaDead) {
                        momentumStatus = 'INVALID';
                        invalidReason = `【形态瓦解】均线空头破位`;
                    } else {
                        momentumStatus = 'PENDING';
                    }
                }
            }
        }

        // 5K 爆发推进门禁判定
        if (config.enableThrust === true && item.structure && momentumStatus === 'TRIGGERED') {
            const threshold = (typeof config.thrustThreshold === 'number' && !isNaN(config.thrustThreshold) && config.thrustThreshold > 0) ? config.thrustThreshold : 1.0;
            let calculatedThrust = typeof item.structure.maxThrust === 'number' ? item.structure.maxThrust : 0;

            const opens = item.structure.recentOpens;
            const closes = item.structure.recentCloses;
            if (opens && opens.length > 0) {
                const opensSlice = opens.length > 1 ? opens.slice(0, -1).slice(-5) : opens.slice(-5);
                if (opensSlice.length > 0) {
                    const minOpen = Math.min(...opensSlice);
                    const maxOpen = Math.max(...opensSlice);
                    if (item.direction === 'LONG' && minOpen > 0) {
                        const livePush = ((currentPrice - minOpen) / minOpen) * 100;
                        if (livePush > calculatedThrust) calculatedThrust = livePush;
                    } else if (item.direction === 'SHORT' && maxOpen > 0) {
                        const livePush = ((maxOpen - currentPrice) / maxOpen) * 100;
                        if (livePush > calculatedThrust) calculatedThrust = livePush;
                    }
                }
            } else if (closes && closes.length > 0) {
                const closesSlice = closes.length > 1 ? closes.slice(0, -1).slice(-5) : closes.slice(-5);
                if (closesSlice.length > 0) {
                    const minClose = Math.min(...closesSlice);
                    const maxClose = Math.max(...closesSlice);
                    if (item.direction === 'LONG' && minClose > 0) {
                        const livePush = ((currentPrice - minClose) / minClose) * 100;
                        if (livePush > calculatedThrust) calculatedThrust = livePush;
                    } else if (item.direction === 'SHORT' && maxClose > 0) {
                        const livePush = ((maxClose - currentPrice) / maxClose) * 100;
                        if (livePush > calculatedThrust) calculatedThrust = livePush;
                    }
                }
            }

            if (calculatedThrust < threshold) {
                momentumStatus = 'PENDING';
                invalidReason = `【5K爆发推进等待】净变幅未达标 (${calculatedThrust.toFixed(2)}% < ${threshold}%)`;
            }
        }

        // 🚀 1440分钟 (24小时) 动能双层熔断门禁 (防过热/过冷 + 防追高/追跌)
        if (config.enable1440Fuse !== false && momentumStatus !== 'INVALID') {
            const { maxHigh1440, minLow1440, isValid } = get1440Extremes(item);
            if (isValid && currentPrice > 0) {
                const longMaxAmp = config.fuse1440Config?.longMaxAmplitude ?? 15;
                const longMaxDist = config.fuse1440Config?.longMaxDistance ?? 10;
                const shortMaxAmp = config.fuse1440Config?.shortMaxAmplitude ?? 15;
                const shortMaxDist = config.fuse1440Config?.shortMaxDistance ?? 10;

                if (item.direction === 'LONG') {
                    // 做多 条件 A (总体振幅限制): 从 1440 分钟最低点到最高点的整体涨幅比例 <= longMaxAmplitude
                    const overallAmp = minLow1440 > 0 ? ((maxHigh1440 - minLow1440) / minLow1440) * 100 : 0;
                    // 做多 条件 B (当前追高限制): 从 1440 分钟最低点到当前价格的实时涨幅 <= longMaxDistance
                    const currentDist = minLow1440 > 0 ? ((currentPrice - minLow1440) / minLow1440) * 100 : 0;

                    if (overallAmp > longMaxAmp) {
                        momentumStatus = 'INVALID';
                        invalidReason = `【1440M双向熔断】做多总体振幅过激 (${overallAmp.toFixed(2)}% > ${longMaxAmp}%)`;
                    } else if (currentDist > longMaxDist) {
                        momentumStatus = 'INVALID';
                        invalidReason = `【1440M双向熔断】做多高位追涨拦截 (${currentDist.toFixed(2)}% > ${longMaxDist}%)`;
                    }
                } else {
                    // 做空 条件 A (总体振幅限制): 从 1440 分钟最高点到最低点的整体振幅比例 <= shortMaxAmplitude
                    const overallAmp = maxHigh1440 > 0 ? ((maxHigh1440 - minLow1440) / maxHigh1440) * 100 : 0;
                    // 做空 条件 B (当前追跌限制): 从 1440 分钟最高点到当前价格的实时跌幅 <= shortMaxDistance
                    const currentDist = maxHigh1440 > 0 ? ((maxHigh1440 - currentPrice) / maxHigh1440) * 100 : 0;

                    if (overallAmp > shortMaxAmp) {
                        momentumStatus = 'INVALID';
                        invalidReason = `【1440M双向熔断】做空总体振幅过激 (${overallAmp.toFixed(2)}% > ${shortMaxAmp}%)`;
                    } else if (currentDist > shortMaxDist) {
                        momentumStatus = 'INVALID';
                        invalidReason = `【1440M双向熔断】做空低位追跌拦截 (${currentDist.toFixed(2)}% > ${shortMaxDist}%)`;
                    }
                }
            }
        }

        const isAnyFuseEnabled = !!(config.enableAntiChase || config.enableThrust || config.enableAutoDirGuard || config.enableAdvancedFilter || config.enable1440Fuse);
        let fuseBlocked = isAnyFuseEnabled ? (item.fuseLatched || item.fuseBlocked || false) : false;
        let fuseReason = (isAnyFuseEnabled && (item.fuseLatched || item.fuseBlocked)) ? (item.fuseReason || '已锁定') : '';

        if (momentumStatus === 'INVALID') {
            fuseBlocked = true;
            fuseReason = invalidReason;
        }

        return {
            ...item,
            isDormant: momentumStatus === 'DORMANT' || momentumStatus === 'REVIVED', // 保持复活/休眠记忆，供后续 Tick 连续感知
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
            fuseDetails: isAnyFuseEnabled ? item.fuseDetails : undefined
        };
    }).filter(Boolean) as ScannerItem[];
}

