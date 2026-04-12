
import React, { useEffect, useRef } from 'react';
import { useMomentumAudit } from './useMomentumAudit';
import { ScannerItem, List4Config, List3Config } from '../../components/Scanner/scannerTypes';
import { PositionSide, Position } from '../../types';
import List4_Momentum from '../../components/Scanner/List4_Momentum';

interface Props {
    candidates: ScannerItem[]; // From List 3
    setChartData: (data: any) => void;
    executeTradeSafe: (symbol: string, side: PositionSide, price: number, reason: string, signalTf?: string, signalCandle?: any, entryEmas?: any) => void;
    list3Config: List3Config; 
    realPrices: Record<string, number>;
    activePositions: Position[];
    onRemoveSignal?: (uniqueId: string) => void;
}

const DEFAULT_CONFIG: List4Config = { 
    autoExecute: true, 
    midlineThreshold: 90, 
    breakoutThreshold: 30, 
    directionFilter: 'BOTH', 
    enableThresholds: true, 
    enableAntiChase: false, 
    invalidRetentionMinutes: 10, 
    removeInvalidCandles: 0,
    removeTradedCandles: 0,
    antiChaseConfig: { maxChange24h: 30, maxRsi: 85, minRsi: 15, maxDeviation: 20, enableRev3K: false, enableStrictMAs: false }
};

export const MomentumAuditModule: React.FC<Props> = ({ candidates, setChartData, executeTradeSafe, list3Config, realPrices, activePositions, onRemoveSignal }) => {
    
    // PASS list3Config TO HOOK
    const { config, setConfig, list4 } = useMomentumAudit(candidates, DEFAULT_CONFIG, list3Config, realPrices, activePositions, onRemoveSignal);
    
    // Track executed signals to prevent duplicate orders for the same signal event
    const executedRef = useRef<Set<string>>(new Set());

    // --- AUTO EXECUTION EFFECT ---
    useEffect(() => {
        if (!config.autoExecute) return;

        list4.forEach(item => {
            // Logic: Must be TRIGGERED and NOT blocked by Anti-Chase Fuse
            if (item.momentum?.status === 'TRIGGERED' && !item.fuseBlocked) {
                
                // Construct Unique Signal ID
                const signalTime = item.structure?.signalTime || 0;
                const uniqueId = `${item.symbol}-${item.tf}-${item.direction}-${signalTime}`;
                
                // Check 1: Have we executed this specific signal ID in this session?
                const alreadyExecutedSession = executedRef.current.has(uniqueId);
                
                // Check 2: Do we ALREADY have an open position for this symbol + direction?
                // This prevents spamming if the user refreshes the page (clearing executedRef) but positions remain.
                const alreadyHasPosition = activePositions.some(p => p.symbol === item.symbol && p.side === item.direction);

                if (!alreadyExecutedSession && !alreadyHasPosition) {
                    console.log(`[List4 Auto] Executing: ${uniqueId} @ ${item.price}`);
                    
                    const signalCandle = item.structure ? {
                        high: item.structure.signalHigh,
                        low: item.structure.signalLow,
                        close: item.structure.signalPrice,
                        open: item.structure.signalPrice, // Approximate
                        amplitude: (item.structure.signalHigh - item.structure.signalLow) / item.structure.signalLow
                    } : undefined;

                    executeTradeSafe(
                        item.symbol, 
                        item.direction as PositionSide, 
                        item.price, 
                        `Auto L4 Breakout (${item.tf})`, 
                        item.tf,
                        signalCandle
                    );
                    
                    executedRef.current.add(uniqueId);
                }
            }
        });
    }, [list4, config.autoExecute, executeTradeSafe, activePositions]);

    return (
        <List4_Momentum 
            config={config} 
            setConfig={setConfig} 
            list4={list4} 
            list3Config={list3Config} // Pass through for UI filtering
            executeTradeSafe={executeTradeSafe}
            setChartData={setChartData}
        />
    );
};
