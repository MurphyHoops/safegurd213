import { ScanConfig, AntiChaseFilterConfig, BreakoutFilterConfig } from '../components/Scanner/scannerTypes';
import { DEFAULT_LIST1_ANTI_CHASE_CONFIG } from '../services/rules/list1_anti_chase';
import { DEFAULT_BREAKOUT_CONFIG } from '../services/rules/list1_breakout';

export function applyDirectionSync(
    prevConfig: ScanConfig, 
    mode: 'LONG_ONLY' | 'SHORT_ONLY' | 'BOTH'
): ScanConfig {
    const isLong = mode === 'LONG_ONLY' || mode === 'BOTH';
    const isShort = mode === 'SHORT_ONLY' || mode === 'BOTH';

    const source = mode === 'LONG_ONLY' ? 'GAINERS' : mode === 'SHORT_ONLY' ? 'LOSERS' : 'BOTH';
    const instantOpenDirection = mode === 'SHORT_ONLY' ? 'SHORT' : 'LONG';

    const prevMajor = prevConfig.majorTrend || {
        enabled: false,
        updateIntervalHours: 4,
        requestPerMinute: 20,
        lookbackDays: 300,
        minHistoryDrop: 50,
        minHistoryPump: 100,
        maxExtremeDistance: 5,
        sidewaysDays: 7,
        sidewaysMaxPump: 10,
        sidewaysMaxDrop: 10
    };

    const nextAntiChase: AntiChaseFilterConfig = {
        ...DEFAULT_LIST1_ANTI_CHASE_CONFIG,
        ...(prevConfig.antiChaseFilter || prevMajor.antiChaseFilter || {}),
        enabled: prevConfig.antiChaseFilter?.enabled !== false,
        enableLong: isLong,
        enableShort: isShort
    };

    const nextBreakout: BreakoutFilterConfig = {
        ...DEFAULT_BREAKOUT_CONFIG,
        ...(prevConfig.breakoutFilter || prevMajor.breakoutFilter || {}),
        enabled: prevConfig.breakoutFilter?.enabled !== false,
        breakoutDirection: (mode === 'LONG_ONLY' ? 'LONG' : (mode === 'SHORT_ONLY' ? 'SHORT' : 'BOTH'))
    };

    const nextMajorTrend = {
        ...prevMajor,
        enableStartTrendLong: isLong,
        enableStartTrendShort: isShort,
        enableStartTrend: isLong || isShort,
        enableSidewaysLong: isLong,
        enableSidewaysShort: isShort,
        enableSideways: isLong || isShort,
        enableLong: isLong,
        enableShort: isShort,
        enableLookbackFilter: isLong || isShort,
        syncDirectionLock: prevMajor.syncDirectionLock !== false,
        antiChaseFilter: nextAntiChase,
        breakoutFilter: nextBreakout
    };

    try {
        localStorage.setItem('SCANNER_ANTI_CHASE_CONFIG', JSON.stringify(nextAntiChase));
    } catch (_) {}

    return {
        ...prevConfig,
        source,
        instantOpenDirection,
        antiChaseFilter: nextAntiChase,
        breakoutFilter: nextBreakout,
        majorTrend: nextMajorTrend
    };
}
