import { Position, AppSettings, PositionSide } from '../../../types';

export function checkStrategy5_OscillationGuard(
    position: Position,
    settings: AppSettings,
    closePosition: (symbol: string, side: PositionSide, reason: string) => void
): boolean {
    const slSettings = settings.stopLoss;
    if (!slSettings.fuseEnabled) return false;

    // 1. Check if fuse is tripped (max refill / retries reached or oscillation locked)
    const maxRetries = slSettings.maxHedgeRetries || 3;
    const retryCount = Math.max(position.refillCount || 0, position.amputationCount || 0, position.hedgeRetries || 0); 
    const isTripped = position.isOscillationLocked || retryCount >= maxRetries;

    if (isTripped) {
        // Fuse is tripped, hedging and amputation are disabled for this position.
        // Check if we hit the fatal fail stop percent (based on underlying price change).
        const pnlPercent = position.unrealizedPnLPercentage;
        if (slSettings.fuseFailStopPercent > 0 && pnlPercent <= -Math.abs(slSettings.fuseFailStopPercent)) {
            closePosition(
                position.symbol, 
                position.side, 
                `5. 熔断强制止损: 补仓/重试达 ${retryCount} 次, 亏损达 ${pnlPercent.toFixed(2)}% <= -${slSettings.fuseFailStopPercent}%`
            );
            return true;
        }
    }

    return false;
}
