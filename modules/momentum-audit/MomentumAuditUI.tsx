
import React, { useEffect, useRef } from 'react';
import { useMomentumAudit } from './useMomentumAudit';
import { ScannerItem, List4Config, List3Config, ActionConfig } from '../../components/Scanner/scannerTypes';
import { PositionSide, Position } from '../../types';
import { normalizeSymbol } from '../../services/symbolUtils';
import List4_Momentum from './components/List4_Momentum';

interface Props {
    candidates: ScannerItem[]; // From List 3
    setChartData: (data: any) => void;
    executeTradeSafe: (symbol: string, side: PositionSide, price: number, reason: string, signalTf?: string, signalCandle?: any, entryEmas?: any) => boolean;
    list3Config: List3Config; 
    realPrices: Record<string, number>;
    activePositions: Position[];
    onRemoveSignal?: (uniqueId: string) => void;
    actionConfig?: ActionConfig | null;
    onLog?: (type: any, message: string) => void;
}

const DEFAULT_CONFIG: List4Config = { 
    autoExecute: true, 
    midlineThreshold: 90, 
    breakoutThreshold: 10, // Reduced from 30 for better responsiveness
    directionFilter: 'BOTH', 
    enableThresholds: true, 
    enableAntiChase: false, 
    enableRev3K: false,
    enableThrust: true,
    invalidRetentionMinutes: 10, 
    removeInvalidMinutes: 15,
    removeTriggeredMinutes: 15,
    removeFuseMinutes: 15,
    removeInvalidCandles: 0,
    removeTradedCandles: 0,
    antiChaseConfig: { 
        longMaxDist1: 40, longMaxDist2: 35, longMaxDist3: 30, longMaxDist4: 25, longMaxDist5: 20, longMaxDist6: 15, longMaxDist7: 10,
        longPeriod1: 43200, longPeriod2: 10080, longPeriod3: 1440, longPeriod4: 240, longPeriod5: 60, longPeriod6: 5, longPeriod7: 129600,
        shortMaxDist1: 40, shortMaxDist2: 35, shortMaxDist3: 30, shortMaxDist4: 25, shortMaxDist5: 20, shortMaxDist6: 15, shortMaxDist7: 10,
        shortPeriod1: 43200, shortPeriod2: 10080, shortPeriod3: 1440, shortPeriod4: 240, shortPeriod5: 60, shortPeriod6: 5, shortPeriod7: 129600
    },
    enableAutoDirGuard: false,
    autoDirConfig: {
        longMaxDist1: 40, longMaxDist2: 35, longMaxDist3: 30, longMaxDist4: 25, longMaxDist5: 20, longMaxDist6: 15, longMaxDist7: 10,
        longPeriod1: 43200, longPeriod2: 10080, longPeriod3: 1440, longPeriod4: 240, longPeriod5: 60, longPeriod6: 5, longPeriod7: 129600,
        shortMaxDist1: 40, shortMaxDist2: 35, shortMaxDist3: 30, shortMaxDist4: 25, shortMaxDist5: 20, shortMaxDist6: 15, shortMaxDist7: 10,
        shortPeriod1: 43200, shortPeriod2: 10080, shortPeriod3: 1440, shortPeriod4: 240, shortPeriod5: 60, shortPeriod6: 5, shortPeriod7: 129600
    }
};

export const MomentumAuditModule: React.FC<Props> = ({ candidates, setChartData, executeTradeSafe, list3Config, realPrices, activePositions, onRemoveSignal, actionConfig, onLog }) => {
    
    // PASS list3Config TO HOOK
    const { config, setConfig, list4, removeSymbol, clearItems } = useMomentumAudit(candidates, DEFAULT_CONFIG, list3Config, realPrices, activePositions, onRemoveSignal);
    
    // Track executed signals to prevent duplicate orders for the same signal event
    // Map stores signalId -> status ('SUCCESS' | lastFailureTime)
    const executionStatusRef = useRef<Map<string, 'SUCCESS' | number>>(new Map());

    // --- AUTO EXECUTION EFFECT ---
    useEffect(() => {
        // MUST have local auto-ON AND Master Switch ON
        const isMasterAutoOn = actionConfig?.autoExecute;
        
        if (!config.autoExecute) {
            return;
        }

        if (!isMasterAutoOn) {
            return;
        }

        const now = Date.now();

        list4.forEach(item => {
            // Logic: Must be TRIGGERED
            if (item.momentum?.status === 'TRIGGERED') {
                const cleanSym = normalizeSymbol(item.symbol);
                // Construct Unique Signal ID
                const signalTime = item.structure?.signalTime || 0;
                const uniqueId = `${cleanSym}-${item.tf}-${item.direction}-${signalTime}`;
                
                if (item.fuseBlocked) {
                    // Log once per unique signal to avoid flooding, but informative enough
                    if (executionStatusRef.current.get(uniqueId + '-fused') !== 'SUCCESS') {
                        console.warn(`[List4 Auto] ${cleanSym} (${item.tf}) 突破确认! 但被熔断拦截: ${item.fuseReason}`);
                        executionStatusRef.current.set(uniqueId + '-fused', 'SUCCESS');
                    }
                    return;
                }
                
                // Check 1: Execution Status
                const status = executionStatusRef.current.get(uniqueId);
                if (status === 'SUCCESS') return; // Already success, skip forever

                // Check Cooldown: If it failed before, wait 10 seconds before retrying
                if (typeof status === 'number' && now - status < 10000) {
                    return;
                }
                
                // Check 2: Do we ALREADY have an open position for this symbol + direction?
                const alreadyHasPosition = activePositions.some(p => normalizeSymbol(p.symbol) === cleanSym && p.side === item.direction);

                if (!alreadyHasPosition) {
                    console.log(`[List4 Auto] 🚀 突破确认！立即开仓 ${cleanSym} @ ${item.price} Reason: ${item.tf} Momentum Breakout`);
                    
                    const signalCandle = item.structure ? {
                        high: item.structure.signalHigh,
                        low: item.structure.signalLow,
                        close: item.structure.signalPrice,
                        open: item.structure.signalPrice,
                        amplitude: (item.structure.signalHigh - item.structure.signalLow) / item.structure.signalLow
                    } : undefined;

                    const success = executeTradeSafe(
                        cleanSym, 
                        item.direction as PositionSide, 
                        item.price, 
                        `Auto L4 Breakout (${item.tf})`, 
                        item.tf,
                        signalCandle
                    );
                    
                    if (success) {
                        executionStatusRef.current.set(uniqueId, 'SUCCESS');
                        console.log(`[List4 Auto] ✅ ${cleanSym} 开仓指令已送达`);
                    } else {
                        // Mark as failed with current timestamp to allow retry later
                        executionStatusRef.current.set(uniqueId, now);
                        console.warn(`[List4 Auto] ❌ ${cleanSym} 开仓执行失败 (执行器拒绝)`);
                        // No need for onLog here as executeTradeSafe already logs the reason
                    }
                }
            }
        });
    }, [list4, config.autoExecute, executeTradeSafe, activePositions, actionConfig?.autoExecute, onLog]);

    return (
        <List4_Momentum 
            config={config} 
            setConfig={setConfig} 
            list4={list4} 
            list3Config={list3Config} // Pass through for UI filtering
            executeTradeSafe={executeTradeSafe}
            setChartData={setChartData}
            onRemoveItem={removeSymbol}
            onClearItems={clearItems}
        />
    );
};
