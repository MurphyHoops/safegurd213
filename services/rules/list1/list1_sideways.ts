// 🔒 LOCKED_MODULE: LIST 1 [横盘蓄势过滤 - 原子化规则计算引擎]
// @LOCKED: 严格原子化锁定。未经用户明确的专属书面指令，严禁擅自修改、重构或变动任何算法与流转逻辑。

import { MajorTrendConfig } from '../../../components/Scanner/scannerTypes';

export interface SidewaysEvalResult {
    passed: boolean;
    maxZ: number;
    minZ: number;
    dropFromMax: number;
    riseFromMin: number;
    currentPrice: number;
    matchedGroupDays?: number;
}

export interface SidewaysPassedItem {
    symbol: string;
    maxZ: number;
    minZ: number;
    dropFromMax: number;
    riseFromMin: number;
    currentPrice: number;
    klines: any[];
}

/**
 * 单币种横盘蓄势过滤原子化纯计算函数 (支持多组过滤 + OR/AND 组合模式)
 */
export function evaluateSidewaysFilter(
    symbol: string,
    klines: any[],
    cfg: MajorTrendConfig,
    enableSidewaysLong: boolean,
    enableSidewaysShort: boolean
): SidewaysEvalResult {
    const timeParam = cfg.filterTimeParam || cfg.lookbackDays || 300;
    const periodKlines = klines.slice(-timeParam);
    const highs = periodKlines.map((k: any) => parseFloat(k[2]));
    const lows = periodKlines.map((k: any) => parseFloat(k[3]));
    const closes = periodKlines.map((k: any) => parseFloat(k[4]));
    const currentPrice = closes[closes.length - 1];

    if (!cfg.enableSideways) {
        return {
            passed: true,
            maxZ: currentPrice,
            minZ: currentPrice,
            dropFromMax: 0,
            riseFromMin: 0,
            currentPrice
        };
    }

    if (!enableSidewaysLong && !enableSidewaysShort) {
        return {
            passed: false,
            maxZ: currentPrice,
            minZ: currentPrice,
            dropFromMax: 0,
            riseFromMin: 0,
            currentPrice
        };
    }

    if (symbol.endsWith('_LONG') && !enableSidewaysLong) {
        return {
            passed: false,
            maxZ: currentPrice,
            minZ: currentPrice,
            dropFromMax: 0,
            riseFromMin: 0,
            currentPrice
        };
    }

    if (symbol.endsWith('_SHORT') && !enableSidewaysShort) {
        return {
            passed: false,
            maxZ: currentPrice,
            minZ: currentPrice,
            dropFromMax: 0,
            riseFromMin: 0,
            currentPrice
        };
    }

    const rawGroups = cfg.sidewaysGroups && cfg.sidewaysGroups.length > 0
        ? cfg.sidewaysGroups
        : [{ days: cfg.sidewaysDays || 7, maxDrop: cfg.sidewaysMaxDrop || 10, maxPump: cfg.sidewaysMaxPump || 10, enabled: true }];

    const activeGroups = rawGroups.filter(g => g.enabled !== false && ((Number(g.days) || 0) > 0 || (Number(g.daysLong) || 0) > 0 || (Number(g.daysShort) || 0) > 0));

    if (activeGroups.length === 0) {
        return {
            passed: true,
            maxZ: currentPrice,
            minZ: currentPrice,
            dropFromMax: 0,
            riseFromMin: 0,
            currentPrice
        };
    }

    const isAndMode = cfg.sidewaysLogic === 'AND';
    const isShortCand = symbol.endsWith('_SHORT');
    const isLongCand = symbol.endsWith('_LONG');

    const evalGroupForDirection = (g: any, forShort: boolean) => {
        const gDays = Math.max(1, Math.floor(Number(forShort ? (g.daysShort ?? g.days) : (g.daysLong ?? g.days)) || 7));
        const rawDrop = Number(forShort ? (g.maxDropShort ?? g.maxDrop) : (g.maxDropLong ?? g.maxDrop));
        const rawPump = Number(forShort ? (g.maxPumpShort ?? g.maxPump) : (g.maxPumpLong ?? g.maxPump));
        const gMaxDrop = isNaN(rawDrop) ? 10 : rawDrop;
        const gMaxPump = isNaN(rawPump) ? 10 : rawPump;

        // 严格校验历史K线长度：如果历史K线少于观察周期，无法满足指定天数的充分横盘蓄势要求
        if (highs.length < Math.min(gDays, 3)) {
            return { passed: false, gMaxZ: currentPrice, gMinZ: currentPrice, gDrop: 999, gRise: 999, days: gDays };
        }

        const sHighs = highs.slice(-gDays);
        const sLows = lows.slice(-gDays);
        const gMaxZ = sHighs.length > 0 ? Math.max(...sHighs) : currentPrice;
        const gMinZ = sLows.length > 0 ? Math.min(...sLows) : currentPrice;
        const gDrop = gMaxZ > 0 ? ((gMaxZ - currentPrice) / gMaxZ) * 100 : 0;
        const gRise = gMinZ > 0 ? ((currentPrice - gMinZ) / gMinZ) * 100 : 0;
        const passed = gDrop <= gMaxDrop && gRise <= gMaxPump;
        return { passed, gMaxZ, gMinZ, gDrop, gRise, days: gDays };
    };

    const evalAllGroups = (forShort: boolean) => {
        const results = activeGroups.map(g => evalGroupForDirection(g, forShort));
        // 🔒 严格按逻辑执行：“且”模式下每一个启用的规则组都必须 100% 满足(共振)；“或”模式下任意一组满足即可
        const passed = isAndMode ? results.every(r => r.passed) : results.some(r => r.passed);
        const matched = isAndMode
            ? {
                passed,
                gMaxZ: Math.max(...results.map(r => r.gMaxZ)),
                gMinZ: Math.min(...results.map(r => r.gMinZ)),
                gDrop: Math.max(...results.map(r => r.gDrop)),
                gRise: Math.max(...results.map(r => r.gRise)),
                days: Math.max(...results.map(r => r.days))
            }
            : (results.find(r => r.passed) || results[0]);
        return { passed, matched };
    };

    let sidewaysMatch = false;
    let maxZ = currentPrice;
    let minZ = currentPrice;
    let dropFromMax = 0;
    let riseFromMin = 0;
    let matchedDays = 7;

    if (isShortCand) {
        const { passed, matched } = evalAllGroups(true);
        sidewaysMatch = passed;
        maxZ = matched.gMaxZ;
        minZ = matched.gMinZ;
        dropFromMax = matched.gDrop;
        riseFromMin = matched.gRise;
        matchedDays = matched.days;
    } else if (isLongCand) {
        const { passed, matched } = evalAllGroups(false);
        sidewaysMatch = passed;
        maxZ = matched.gMaxZ;
        minZ = matched.gMinZ;
        dropFromMax = matched.gDrop;
        riseFromMin = matched.gRise;
        matchedDays = matched.days;
    } else {
        // 无明确多空后缀时的候选币：根据当前开启的横盘方向判定
        const longRes = enableSidewaysLong ? evalAllGroups(false) : { passed: false, matched: null as any };
        const shortRes = enableSidewaysShort ? evalAllGroups(true) : { passed: false, matched: null as any };

        if (longRes.passed && shortRes.passed) {
            sidewaysMatch = true;
            const m = longRes.matched || shortRes.matched;
            maxZ = m.gMaxZ;
            minZ = m.gMinZ;
            dropFromMax = m.gDrop;
            riseFromMin = m.gRise;
            matchedDays = m.days;
        } else if (longRes.passed) {
            sidewaysMatch = true;
            maxZ = longRes.matched.gMaxZ;
            minZ = longRes.matched.gMinZ;
            dropFromMax = longRes.matched.gDrop;
            riseFromMin = longRes.matched.gRise;
            matchedDays = longRes.matched.days;
        } else if (shortRes.passed) {
            sidewaysMatch = true;
            maxZ = shortRes.matched.gMaxZ;
            minZ = shortRes.matched.gMinZ;
            dropFromMax = shortRes.matched.gDrop;
            riseFromMin = shortRes.matched.gRise;
            matchedDays = shortRes.matched.days;
        } else {
            sidewaysMatch = false;
            const m = (longRes.matched || shortRes.matched || evalGroupForDirection(activeGroups[0], false));
            maxZ = m.gMaxZ;
            minZ = m.gMinZ;
            dropFromMax = m.gDrop;
            riseFromMin = m.gRise;
            matchedDays = m.days;
        }
    }

    return {
        passed: sidewaysMatch,
        maxZ,
        minZ,
        dropFromMax,
        riseFromMin,
        currentPrice,
        matchedGroupDays: matchedDays
    };
}
