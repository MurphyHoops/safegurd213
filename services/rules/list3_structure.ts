// 🔒 LOCKED_MODULE: LIST 3 [结构深度审计 & 过滤规则]
// @LOCKED: 严格原子化单独锁定。包含结构审计、同色交叉、波幅限制等全部规则。未经用户明确的专属书面指令，严禁擅自修改、重构或变动任何算法与流转逻辑。

import { calculateEMA, calculateRSI } from '../indicators';
import { List3Config, ScannerItem } from '../../components/Scanner/scannerTypes';

export interface StructureAuditTask {
    symbol: string;
    price: number;
    direction: 'LONG' | 'SHORT';
    tf: string;
    time: number;
    periodChange?: number; // Pass-through for 8am change / 24h change
}

export function performStructureAudit(
    task: StructureAuditTask,
    closes: number[],
    highs: number[],
    lows: number[],
    opens: number[],
    volumes: number[],
    config: List3Config,
    klines?: any[]
): ScannerItem | null {

    if (!closes || closes.length < 30) return null;

    const idx = closes.length - 1;
    const currentClose = closes[idx];
    
    // --- METRIC 1: RSI Level & Momentum ---
    const rsiArr = calculateRSI(closes, config.rsiPeriod || 14);
    const currentRsi = rsiArr.length > 0 ? rsiArr[rsiArr.length - 1] : 50;

    // --- METRIC 2: Bollinger Band Width (BBW) Volatility ---
    let bbw = 0;
    const bbPeriod = 20;
    if (closes.length >= bbPeriod) {
        const slice = closes.slice(-bbPeriod);
        const sum = slice.reduce((a, b) => a + b, 0);
        const mean = sum / bbPeriod;
        const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / bbPeriod;
        const stdDev = Math.sqrt(variance);
        const upper = mean + 2 * stdDev;
        const lower = mean - 2 * stdDev;
        if (mean > 0) {
            bbw = ((upper - lower) / mean) * 100;
        }
    }

    // --- METRIC 3: Pure EMAs Alignment & Strict Trend Check ---
    const ema10 = calculateEMA(closes, 10);
    const ema20 = calculateEMA(closes, 20);
    const ema30 = calculateEMA(closes, 30);
    const ema40 = calculateEMA(closes, 40);
    const ema80 = calculateEMA(closes, 80);

    const getVal = (arr: number[], index: number, period: number) => {
        const offset = index - (period - 1);
        return (offset >= 0 && offset < arr.length) ? arr[offset] : undefined;
    };

    const e10 = getVal(ema10, idx, 10);
    const e20 = getVal(ema20, idx, 20);
    const e30 = getVal(ema30, idx, 30);
    const e40 = getVal(ema40, idx, 40);
    const e80 = getVal(ema80, idx, 80);

    let isStrictTrend = true;
    if (e10 !== undefined && e20 !== undefined && e30 !== undefined) {
        if (task.direction === 'LONG') {
            isStrictTrend = e10 > e20 && e20 > e30;
            if (e40 !== undefined) isStrictTrend = isStrictTrend && e30 > e40;
        } else {
            isStrictTrend = e10 < e20 && e20 < e30;
            if (e40 !== undefined) isStrictTrend = isStrictTrend && e30 < e40;
        }
    }

    // --- METRIC 4: Signal Candle Validation & Color Alignment ---
    let signalIdx = idx;
    if (task.time && task.time > 0) {
        signalIdx = idx;
    }

    const signalClose = closes[signalIdx] || currentClose;
    const signalOpen = opens[signalIdx] || signalClose;
    const signalHigh = highs[signalIdx] || signalClose;
    const signalLow = lows[signalIdx] || signalClose;

    const isColorValid = task.direction === 'LONG'
        ? signalClose > signalOpen
        : signalClose < signalOpen;

    // Post-signal Extreme & Tracking
    let postSignalExtreme = task.direction === 'LONG' ? Infinity : -Infinity;
    let postSignalMaxHigh = -Infinity;
    let postSignalMinLow = Infinity;

    for (let i = signalIdx; i <= idx; i++) {
        const cHigh = highs[i] || closes[i];
        const cLow = lows[i] || closes[i];
        if (cHigh > postSignalMaxHigh) postSignalMaxHigh = cHigh;
        if (cLow < postSignalMinLow) postSignalMinLow = cLow;

        if (task.direction === 'LONG') {
            if (cLow < postSignalExtreme) postSignalExtreme = cLow;
        } else {
            if (cHigh > postSignalExtreme) postSignalExtreme = cHigh;
        }
    }

    // --- 前 NK 突破/反转门禁逻辑 (Dynamic N-Candle Breakout Gate) ---
    const revCount = Math.max(1, Math.min(50, config.rev3KCandles ?? 3));
    let isReverse3K = false;
    let isBreakout3K = false;
    let maxClose3 = 0;
    let minClose3 = 0;

    if (signalIdx > 0) {
        const startRevIdx = Math.max(0, signalIdx - revCount);
        const sliceCloses = closes.slice(startRevIdx, signalIdx);
        if (sliceCloses.length > 0) {
            maxClose3 = Math.max(...sliceCloses);
            minClose3 = Math.min(...sliceCloses);
            
            if (task.direction === 'LONG') {
                isBreakout3K = signalClose > maxClose3;
                isReverse3K = signalClose < minClose3;
            } else {
                isBreakout3K = signalClose < minClose3;
                isReverse3K = signalClose > maxClose3;
            }
        }
    }

    // 🔒【高级过滤相交限制】: 在最近 N 根 K 线内，K 线 High/Low 与 EMA80 相交次数计算
    let ema80Intersections = 0;
    const filterKlines = config.filterTimeParam || 100;
    const filterMaxIntersections = config.filterCrossingCount || 3;
    const startFilterIdx = Math.max(0, idx - filterKlines + 1);

    if (ema80 && ema80.length > 0) {
        for (let k = startFilterIdx; k <= idx; k++) {
            const h = highs[k];
            const l = lows[k];
            const eVal = getVal(ema80, k, 80);
            if (eVal !== undefined && l !== undefined && h !== undefined) {
                if (l < eVal && h > eVal) {
                    ema80Intersections++;
                }
            }
        }
    }

    // 🔒 [5K 爆发推进物理算法重构 - 严格基于 5K 组合内最低开盘价到最高收盘价的真实幅度]
    let thrustThreshold = 1.0;
    try {
        const activeId = typeof window !== 'undefined' ? localStorage.getItem("SCANNER_SELECTED_STRATEGY_ID") : null;
        const cleanId = activeId ? (activeId.startsWith('"') ? JSON.parse(activeId) : activeId) : '';
        const savedL4 = typeof window !== 'undefined' ? (
            (cleanId ? localStorage.getItem(`SCANNER_LIST4_CONFIG_${cleanId}`) : null) || 
            localStorage.getItem('SCANNER_LIST4_CONFIG')
        ) : null;
        if (savedL4) {
            const parsed = JSON.parse(savedL4);
            if (typeof parsed.thrustThreshold === 'number' && !isNaN(parsed.thrustThreshold) && parsed.thrustThreshold > 0) {
                thrustThreshold = parsed.thrustThreshold;
            }
        }
    } catch(e) {}

    let isThrustValid = false;
    let maxThrust = -Infinity;

    if (signalIdx >= 0 && opens.length > 0 && closes.length > 0) {
        const winStart = Math.max(0, signalIdx - 2);
        const winEnd = Math.min(closes.length - 1, signalIdx + 2);

        // 遍历所有开盘位置 i 与其后的收盘位置 j (保证时间顺向)
        for (let i = winStart; i <= winEnd; i++) {
            for (let j = i; j <= winEnd; j++) {
                if (i <= signalIdx && j >= signalIdx) {
                    const openPrice = opens[i];
                    const closePrice = closes[j];
                    if (openPrice > 0 && closePrice > 0) {
                        const pushPct = task.direction === 'LONG'
                            ? ((closePrice - openPrice) / openPrice) * 100
                            : ((openPrice - closePrice) / openPrice) * 100;
                        if (pushPct > maxThrust) {
                            maxThrust = pushPct;
                        }
                    }
                }
            }
        }
    }

    if (maxThrust === -Infinity || isNaN(maxThrust)) {
        maxThrust = 0;
    }

    if (maxThrust >= thrustThreshold) {
        isThrustValid = true;
    }

    // --- METRIC 5: Resonance & Location ---
    let locationPct = 50;
    let crossCount = 0;

    const lb = config.lookback || 80;
    const startCheck = Math.max(0, idx - lb);
    
    let periodHigh = -Infinity;
    let periodLow = Infinity;

    for (let i = startCheck; i <= idx; i++) {
        if (highs[i] > periodHigh) periodHigh = highs[i];
        if (lows[i] < periodLow) periodLow = lows[i];
        
        if (i > startCheck) {
            const prevC = closes[i - 1];
            const currC = closes[i];
            const e10Val = getVal(ema10, i, 10);
            if (e10Val) {
                if ((prevC <= e10Val && currC > e10Val) || (prevC >= e10Val && currC < e10Val)) {
                    crossCount++;
                }
            }
        }
    }

    if (periodHigh > periodLow) {
        locationPct = ((currentClose - periodLow) / (periodHigh - periodLow)) * 100;
    }

    // --- 🔒 [USER MANDATORY RULE - 前置洗盘/诱多/诱空反发散追溯透传] ---
    let isPriorReverseFound = false;
    const priorReverseLookbackBars = 80;
    const searchEnd = Math.max(0, signalIdx - priorReverseLookbackBars);

    if (ema10 && ema20 && ema30 && ema40) {
        for (let rIdx = signalIdx - 1; rIdx >= searchEnd; rIdx--) {
            const rE10 = getVal(ema10, rIdx, 10);
            const rE20 = getVal(ema20, rIdx, 20);
            const rE30 = getVal(ema30, rIdx, 30);
            const rE40 = getVal(ema40, rIdx, 40);

            if (rE10 !== undefined && rE20 !== undefined && rE30 !== undefined && rE40 !== undefined) {
                if (task.direction === 'LONG') {
                    if ((rE10 < rE20 && rE20 < rE30 && rE30 < rE40) || (rE10 < rE20 && rE20 < rE30)) {
                        isPriorReverseFound = true;
                        break;
                    }
                } else {
                    if ((rE10 > rE20 && rE20 > rE30 && rE30 > rE40) || (rE10 > rE20 && rE20 > rE30)) {
                        isPriorReverseFound = true;
                        break;
                    }
                }
            }
        }
    }

    return {
        symbol: task.symbol,
        price: task.price,
        direction: task.direction,
        tf: task.tf,
        structure: {
            rsi: currentRsi,
            bbw: bbw,
            thrustValid: isThrustValid,
            maxThrust: maxThrust > -Infinity ? parseFloat(maxThrust.toFixed(2)) : 0,
            isStrictTrend: isStrictTrend,
            isColorValid: isColorValid,
            crossCount: crossCount,
            locationPct: locationPct,
            lag: idx - signalIdx, 
            signalTime: task.time,
            signalPrice: signalClose,
            signalHigh: signalHigh, 
            signalLow: signalLow,   
            postSignalExtreme: postSignalExtreme,
            postSignalMaxHigh: postSignalMaxHigh,
            postSignalMinLow: postSignalMinLow,
            periodChange: task.periodChange,
            isReverse3K,
            isBreakout3K,
            maxClose3,
            minClose3,
            recentCloses: idx > 0 ? closes.slice(Math.max(0, idx - 50), idx + 1) : [],
            recentOpens: idx > 0 ? opens.slice(Math.max(0, idx - 50), idx + 1) : [],
            ema10: getVal(ema10, idx, 10),
            ema20: getVal(ema20, idx, 20),
            ema30: getVal(ema30, idx, 30),
            ema40: getVal(ema40, idx, 40),
            ema80: getVal(ema80, idx, 80),
            ema80Intersections,
            isAdvancedFilterPassed: !(config.enableAdvancedFilter === true && ema80Intersections > filterMaxIntersections),
            isPriorReverseFound
        }
    };
}

// Export primary alias and helper methods required by other modules
export const analyzeList3Structure = performStructureAudit;

export function checkList3SignalPasses(item: ScannerItem, config: List3Config): boolean {
    if (!item || !item.structure) return false;
    if (config.enableStrictTrend && !item.structure.isStrictTrend) return false;
    if (config.enableColorAlign && !item.structure.isColorValid) return false;
    if (config.enableRsiFilter) {
        const rsi = item.structure.rsi ?? 50;
        if (item.direction === 'LONG' && rsi < (config.minRsi ?? 50)) return false;
        if (item.direction === 'SHORT' && rsi > (config.maxRsi ?? 50)) return false;
    }
    return true;
}

export function getList3SignalRejectReason(item: ScannerItem, config: List3Config): string {
    if (!item || !item.structure) return '缺少结构审计数据';
    if (config.enableStrictTrend && !item.structure.isStrictTrend) return '均线严格趋势未达标';
    if (config.enableColorAlign && !item.structure.isColorValid) return 'K线同色对齐未达标';
    if (config.enableRsiFilter) {
        const rsi = item.structure.rsi ?? 50;
        if (item.direction === 'LONG' && rsi < (config.minRsi ?? 50)) return `RSI动能未达标 (${rsi.toFixed(1)} < ${config.minRsi})`;
        if (item.direction === 'SHORT' && rsi > (config.maxRsi ?? 50)) return `RSI动能未达标 (${rsi.toFixed(1)} > ${config.maxRsi})`;
    }
    return '';
}
