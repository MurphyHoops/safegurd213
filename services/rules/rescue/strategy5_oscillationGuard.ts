import { Position, AppSettings, PositionSide } from '../../../types';

export function checkStrategy5_OscillationGuard(
    position: Position,
    settings: AppSettings,
    closePosition: (symbol: string, side: PositionSide, reason: string) => void
): boolean {
    const slSettings = settings.stopLoss;
    if (!slSettings.fuseEnabled) return false;

    // 1. Check if fuse is tripped (max retries reached)
    const retryCount = position.hedgeRetries || 0; 
    if (retryCount >= slSettings.maxHedgeRetries) {
        // Fuse is tripped, hedging is disabled for this position.
        // Now check if we hit the fatal fail stop percent.
        const pnlPercent = position.unrealizedPnLPercentage;
        if (slSettings.fuseFailStopPercent > 0 && pnlPercent <= -Math.abs(slSettings.fuseFailStopPercent)) {
            closePosition(
                position.symbol, 
                position.side, 
                `5. 熔断强制止损: 连续失败 ${retryCount} 次, 亏损达 ${pnlPercent.toFixed(2)}% <= -${slSettings.fuseFailStopPercent}%`
            );
            return true;
        }
    }

    return false;
}
