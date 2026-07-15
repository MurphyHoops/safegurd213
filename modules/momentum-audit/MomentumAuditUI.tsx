
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
    strategyId?: string;
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
        longThresholds: { "2160": 0, "720": 0, "168": 0, "24": 0, "1": 0 },
        shortThresholds: { "2160": 0, "720": 0, "168": 0, "24": 0, "1": 0 },
    },
    enableAutoDirGuard: false,
    autoDirConfig: {
        limit1Q: 0,
        limit1M: 0,
        limit1W: 0,
        limit1D: 0,
        limit1H: 0
    }
};

export const MomentumAuditModule: React.FC<Props> = ({ candidates, setChartData, executeTradeSafe, list3Config, realPrices, activePositions, onRemoveSignal, actionConfig, onLog, strategyId }) => {
    
    // PASS list3Config TO HOOK
    const { config, setConfig, list4, removeSymbol, clearItems } = useMomentumAudit(candidates, DEFAULT_CONFIG, list3Config, realPrices, activePositions, onRemoveSignal, strategyId);
    
    // Track executed signals to prevent duplicate orders for the same signal event
    // Map stores signalId -> status ('SUCCESS' | lastFailureTime)
    const executionStatusRef = useRef<Map<string, 'SUCCESS' | number>>(new Map());
    const list4Ref = useRef(list4);
    const activePositionsRef = useRef(activePositions);
    const executeTradeSafeRef = useRef(executeTradeSafe);
    const onLogRef = useRef(onLog);
    
    useEffect(() => { list4Ref.current = list4; }, [list4]);
    useEffect(() => { activePositionsRef.current = activePositions; }, [activePositions]);
    useEffect(() => { executeTradeSafeRef.current = executeTradeSafe; }, [executeTradeSafe]);
    useEffect(() => { onLogRef.current = onLog; }, [onLog]);

    // --- AUTO EXECUTION EFFECT ---
    useEffect(() => {
        // MUST have local auto-ON AND Master Switch ON
        const isMasterAutoOn = actionConfig?.autoExecute;
        
        if (!config.autoExecute || !isMasterAutoOn) {
            return;
        }

        const now = Date.now();
        const currentList4 = list4Ref.current;
        const currentPositions = activePositionsRef.current;

        currentList4.forEach(item => {
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
                const alreadyHasPosition = currentPositions.some(p => normalizeSymbol(p.symbol) === cleanSym && p.side === item.direction);

                if (!alreadyHasPosition) {
                    console.log(`[List4 Auto] 🚀 突破确认！立即开仓 ${cleanSym} @ ${item.price} Reason: ${item.tf} Momentum Breakout`);
                    
                    const signalCandle = item.structure ? {
                        high: item.structure.signalHigh,
                        low: item.structure.signalLow,
                        close: item.structure.signalPrice,
                        open: item.structure.signalPrice,
                        amplitude: (item.structure.signalHigh - item.structure.signalLow) / item.structure.signalLow
                    } : undefined;

                    const success = executeTradeSafeRef.current(
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
                    }
                }
            }
        });
    }, [list4, activePositions, config.autoExecute, actionConfig?.autoExecute]);

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
