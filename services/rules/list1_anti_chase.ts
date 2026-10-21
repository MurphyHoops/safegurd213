/**
 * 🔒【列表1 - 防追高熔断过滤规则与底池服务】
 * 
 * 职责定位：
 * 位于列表1顺序过滤管道的第三组，严格在“回溯周期过滤”底池之后执行。
 * 针对各天数周期（1季度=90天、1月=30天、1周=7天、1天=昨日、以及从今天8:00起）涨跌幅进行纯涨跌幅硬性门禁拦截，
 * 将单边急速拉升（追高）或暴跌（追低抄底）的币种提前阻断在初筛阶段，
 * 过滤合格后的币种放入“防追高熔断底池”，为下游“趋势爆发综合过滤”提供高质量候选。
 */

export interface AntiChaseFilterConfig {
    enabled: boolean;
    enableLong?: boolean; // 做多锁定限制总开关
    enableShort?: boolean; // 做空锁定限制总开关
    longThresholds: { [key: string]: number }; // 各周期做多涨幅限制 %: '90'=1季度, '30'=1月, '7'=1周, '1'=1天(昨日), 'today8am'=从今天8:00起
    shortThresholds: { [key: string]: number }; // 各周期做空跌幅限制 %: '90'=1季度, '30'=1月, '7'=1周, '1'=1天(昨日), 'today8am'=从今天8:00起
}

export const DEFAULT_LIST1_ANTI_CHASE_CONFIG: AntiChaseFilterConfig = {
    enabled: true,
    enableLong: true,
    enableShort: true,
    longThresholds: {
        '90': 100,      // 1季度 (90天)
        '30': 50,       // 1月 (30天)
        '7': 30,        // 1周 (7天)
        '1': 15,        // 1天 (昨日)
        'today8am': 5,  // 从今天8:00起
    },
    shortThresholds: {
        '90': 100,      // 1季度 (90天)
        '30': 50,       // 1月 (30天)
        '7': 30,        // 1周 (7天)
        '1': 15,        // 1天 (昨日)
        'today8am': 5,  // 从今天8:00起
    }
};

export interface AntiChaseAuditResult {
    passed: boolean;
    blocked: boolean;
    blockedReason?: string;
    blockedPeriod?: string;
    blockedThreshold?: number;
    actualValue?: number;
    diffValue?: number;
    qualifiedDirection?: 'LONG' | 'SHORT' | 'BOTH';
    details?: {
        pumpToday8am?: number;
        pump1d?: number;
        pump7d?: number;
        dropToday8am?: number;
        drop1d?: number;
        drop7d?: number;
    };
}

export interface AntiChasePoolItem {
    symbol: string;
    direction?: 'LONG' | 'SHORT' | 'BOTH';
    fullSymbol?: string;
    maxZ?: number;
    minZ?: number;
    currentPrice?: number;
    timestamp?: number;
    auditResult?: AntiChaseAuditResult;
}

/**
 * 校验单币种在防追高熔断规则下的合格状态 (以天为基准计算，最后包含今天8:00起)
 * @param symbol 币种代码
 * @param direction 方向 'LONG' | 'SHORT' | 'BOTH'
 * @param currentPrice 当前最新价格
 * @param dailyKlines 300根日K线列表 [{ open, high, low, close, time }]
 * @param config 防追高配置
 */
export function auditSymbolAntiChase(
    symbol: string,
    direction: 'LONG' | 'SHORT' | 'BOTH' = 'BOTH',
    currentPrice: number,
    dailyKlines: { open?: number; high: number; low: number; close: number; time?: number }[] = [],
    config: AntiChaseFilterConfig = DEFAULT_LIST1_ANTI_CHASE_CONFIG
): AntiChaseAuditResult {
    if (!config.enabled) {
        return { passed: true, blocked: false, qualifiedDirection: direction };
    }

    const parseVal = (k: any, idx: number, key: string): number => {
        if (!k) return 0;
        if (Array.isArray(k)) {
            const v = parseFloat(k[idx]);
            return isNaN(v) ? 0 : v;
        }
        const v = parseFloat(k[key] ?? k[idx] ?? 0);
        return isNaN(v) ? 0 : v;
    };

    const lastKline = dailyKlines && dailyKlines.length > 0 ? dailyKlines[dailyKlines.length - 1] : undefined;
    const lastClose = lastKline ? parseVal(lastKline, 4, 'close') : 0;
    const lastOpen = lastKline ? parseVal(lastKline, 1, 'open') : 0;
    const lastHigh = lastKline ? parseVal(lastKline, 2, 'high') : 0;
    const lastLow = lastKline ? parseVal(lastKline, 3, 'low') : 0;

    const effectivePrice = (currentPrice && currentPrice > 0)
        ? currentPrice
        : (lastClose > 0 ? lastClose : (lastOpen > 0 ? lastOpen : 0));

    const highs = dailyKlines.map(k => parseVal(k, 2, 'high')).filter(v => v > 0);
    const lows = dailyKlines.map(k => parseVal(k, 3, 'low')).filter(v => v > 0);

    if (!effectivePrice || effectivePrice <= 0 || !dailyKlines || dailyKlines.length === 0 || lows.length === 0) {
        // 如果暂无历史K线，采取防误杀放行
        return { passed: true, blocked: false, qualifiedDirection: direction };
    }

    const checkLong = (direction === 'LONG' || direction === 'BOTH') && config.enableLong !== false;
    const checkShort = (direction === 'SHORT' || direction === 'BOTH') && config.enableShort !== false;

    // 获取今天 8:00 对应当根日K的基准价格 (优先用开盘价 open，没有则取当根 low/high 或 close)
    const today8amBasePrice = lastOpen > 0 ? lastOpen : (lastClose > 0 ? lastClose : effectivePrice);
    const today8amLow = lastLow > 0 ? lastLow : today8amBasePrice;
    const today8amHigh = lastHigh > 0 ? lastHigh : today8amBasePrice;

    // 标准化配置参数映射（兼容旧版本 2160/720/168/24/1 的 key 自动转化为天数）
    const normalizePeriodConfig = (thresholds: { [key: string]: number }) => {
        const result: { key: string; label: string; days?: number; isToday8am?: boolean; threshold: number }[] = [];
        
        // 1. 1季度 (90天)
        const qVal = thresholds['90'] ?? thresholds['2160'] ?? 100;
        if (qVal > 0) result.push({ key: '90', label: '1季度(90天)', days: 90, threshold: qVal });

        // 2. 1月 (30天)
        const mVal = thresholds['30'] ?? thresholds['720'] ?? 50;
        if (mVal > 0) result.push({ key: '30', label: '1月(30天)', days: 30, threshold: mVal });

        // 3. 1周 (7天)
        const wVal = thresholds['7'] ?? thresholds['168'] ?? 30;
        if (wVal > 0) result.push({ key: '7', label: '1周(7天)', days: 7, threshold: wVal });

        // 4. 1天 (昨日)
        const dVal = thresholds['1'] ?? thresholds['24'] ?? 15;
        if (dVal > 0) result.push({ key: '1', label: '1天(昨日)', days: 1, threshold: dVal });

        // 5. 从今天8:00起
        const todayVal = thresholds['today8am'] ?? thresholds['today'] ?? 5;
        if (todayVal > 0) result.push({ key: 'today8am', label: '今天8:00起', isToday8am: true, threshold: todayVal });

        return result;
    };

    // 1. 做多锁定限制 (禁止追高)
    let isLongBlocked = false;
    let longBlockedReason = '';
    let longBlockedPeriod = '';
    let longBlockedThreshold = 0;
    let longActualValue = 0;
    let longDiffValue = 0;

    if (checkLong && config.longThresholds) {
        const longRules = normalizePeriodConfig(config.longThresholds);
        for (const rule of longRules) {
            let minPrice = effectivePrice;
            let pump = 0;

            if (rule.isToday8am) {
                // 今天 8:00 起做多涨幅：对比今天开盘价与当根最低点
                minPrice = today8amLow > 0 ? Math.min(today8amBasePrice, today8amLow) : today8amBasePrice;
                pump = minPrice > 0 ? ((effectivePrice - minPrice) / minPrice) * 100 : 0;
            } else if (rule.days && rule.days > 0) {
                // 回溯前置K线至包含昨日（至少2根K线）
                const sliceLows = lows.slice(-Math.max(rule.days + 1, 2));
                minPrice = sliceLows.length > 0 ? Math.min(...sliceLows) : effectivePrice;
                pump = minPrice > 0 ? ((effectivePrice - minPrice) / minPrice) * 100 : 0;
            }

            if (pump > rule.threshold) {
                isLongBlocked = true;
                longActualValue = parseFloat(pump.toFixed(1));
                longDiffValue = parseFloat((longActualValue - rule.threshold).toFixed(1));
                longBlockedReason = `【初筛极值拦截】做多涨幅超标 [${rule.label}涨幅 ${longActualValue}% > 阈值 ${rule.threshold}%]`;
                longBlockedPeriod = rule.label;
                longBlockedThreshold = rule.threshold;
                break;
            }
        }
    }

    // 2. 做空锁定限制 (禁止追跌)
    let isShortBlocked = false;
    let shortBlockedReason = '';
    let shortBlockedPeriod = '';
    let shortBlockedThreshold = 0;
    let shortActualValue = 0;
    let shortDiffValue = 0;

    if (checkShort && config.shortThresholds) {
        const shortRules = normalizePeriodConfig(config.shortThresholds);
        for (const rule of shortRules) {
            let maxPrice = effectivePrice;
            let drop = 0;

            if (rule.isToday8am) {
                // 今天 8:00 起做空跌幅：对比今天开盘价与当根最高点
                maxPrice = today8amHigh > 0 ? Math.max(today8amBasePrice, today8amHigh) : today8amBasePrice;
                drop = maxPrice > 0 ? ((maxPrice - effectivePrice) / maxPrice) * 100 : 0;
            } else if (rule.days && rule.days > 0) {
                // 回溯前置K线至包含昨日（至少2根K线）
                const sliceHighs = highs.slice(-Math.max(rule.days + 1, 2));
                maxPrice = sliceHighs.length > 0 ? Math.max(...sliceHighs) : effectivePrice;
                drop = maxPrice > 0 ? ((maxPrice - effectivePrice) / maxPrice) * 100 : 0;
            }

            if (drop > rule.threshold) {
                isShortBlocked = true;
                shortActualValue = parseFloat(drop.toFixed(1));
                shortDiffValue = parseFloat((shortActualValue - rule.threshold).toFixed(1));
                shortBlockedReason = `【初筛极值拦截】做空跌幅超标 [${rule.label}跌幅 ${shortActualValue}% > 阈值 ${rule.threshold}%]`;
                shortBlockedPeriod = rule.label;
                shortBlockedThreshold = rule.threshold;
                break;
            }
        }
    }

    // 采集主要指标供详情展示
    const minToday = today8amLow > 0 ? Math.min(today8amBasePrice, today8amLow) : today8amBasePrice;
    const maxToday = today8amHigh > 0 ? Math.max(today8amBasePrice, today8amHigh) : today8amBasePrice;
    const l1 = lows.slice(-2);
    const min1d = l1.length > 0 ? Math.min(...l1) : effectivePrice;
    const l7 = lows.slice(-8);
    const min7d = l7.length > 0 ? Math.min(...l7) : effectivePrice;
    const h1 = highs.slice(-2);
    const max1d = h1.length > 0 ? Math.max(...h1) : effectivePrice;
    const h7 = highs.slice(-8);
    const max7d = h7.length > 0 ? Math.max(...h7) : effectivePrice;

    const details = {
        pumpToday8am: minToday > 0 ? parseFloat((((effectivePrice - minToday) / minToday) * 100).toFixed(1)) : 0,
        pump1d: min1d > 0 ? parseFloat((((effectivePrice - min1d) / min1d) * 100).toFixed(1)) : 0,
        pump7d: min7d > 0 ? parseFloat((((effectivePrice - min7d) / min7d) * 100).toFixed(1)) : 0,
        dropToday8am: maxToday > 0 ? parseFloat((((maxToday - effectivePrice) / maxToday) * 100).toFixed(1)) : 0,
        drop1d: max1d > 0 ? parseFloat((((max1d - effectivePrice) / max1d) * 100).toFixed(1)) : 0,
        drop7d: max7d > 0 ? parseFloat((((max7d - effectivePrice) / max7d) * 100).toFixed(1)) : 0
    };

    // 🎯 方向判研流转铁律：
    // 1. 若单币指定为 LONG：仅按做多追高门禁判定
    if (direction === 'LONG') {
        if (isLongBlocked) {
            return {
                passed: false,
                blocked: true,
                blockedReason: longBlockedReason,
                blockedPeriod: longBlockedPeriod,
                blockedThreshold: longBlockedThreshold,
                actualValue: longActualValue,
                diffValue: longDiffValue,
                details
            };
        }
        return { passed: true, blocked: false, qualifiedDirection: 'LONG', details };
    }

    // 2. 若单币指定为 SHORT：仅按做空追跌门禁判定
    if (direction === 'SHORT') {
        if (isShortBlocked) {
            return {
                passed: false,
                blocked: true,
                blockedReason: shortBlockedReason,
                blockedPeriod: shortBlockedPeriod,
                blockedThreshold: shortBlockedThreshold,
                actualValue: shortActualValue,
                diffValue: shortDiffValue,
                details
            };
        }
        return { passed: true, blocked: false, qualifiedDirection: 'SHORT', details };
    }

    // 3. 若方向为 BOTH (双向候选)：
    // 只要做多未被追高拦截，或做空未被追跌拦截，即判定该币种具备至少一个方向的入池资格；
    // 绝不可因为一端涨幅大就否定该币的做空机会，或因为一端跌幅大就否定该币的反弹机会！
    const canLong = checkLong && !isLongBlocked;
    const canShort = checkShort && !isShortBlocked;

    if (!canLong && !canShort) {
        // 双向均触犯熔断阈值
        const reason = isLongBlocked ? longBlockedReason : shortBlockedReason;
        return {
            passed: false,
            blocked: true,
            blockedReason: reason,
            blockedPeriod: isLongBlocked ? longBlockedPeriod : shortBlockedPeriod,
            blockedThreshold: isLongBlocked ? longBlockedThreshold : shortBlockedThreshold,
            actualValue: isLongBlocked ? longActualValue : shortActualValue,
            diffValue: isLongBlocked ? longDiffValue : shortDiffValue,
            details
        };
    }

    const qualifiedDir: 'LONG' | 'SHORT' | 'BOTH' = (canLong && canShort) 
        ? 'BOTH' 
        : canLong 
            ? 'LONG' 
            : 'SHORT';

    return {
        passed: true,
        blocked: false,
        qualifiedDirection: qualifiedDir,
        details
    };
}
