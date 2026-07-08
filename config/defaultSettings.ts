import { AppSettings } from '../types';

export const DEFAULT_SETTINGS: AppSettings = {
    profit: {
        enabled: true,
        profitMode: 'SMART',
        conventional: { minPosition: 100, profitPercent: 5, callbackPercent: 1, closePercent: 100 },
        atr: { 
            multiplier: 3.0, 
            volatilityPercent: 1.0,
            chandelierEnabled: true,
            emaEnabled: false,
            emaPeriod: 80,
            emaTimeframe: 'AUTO'
        },
        smart: { 
            minPosition: 100,
            activationProfit: 60, 
            conventionalEnabled: false, 
            tiers: [
                { threshold: 2, callback: 0.5, expiry: 5 },
                { threshold: 5, callback: 1, expiry: 10 },
                { threshold: 10, callback: 2, expiry: 20 },
                { threshold: 20, callback: 4, expiry: 40 },
                { threshold: 40, callback: 8, expiry: 60 }
            ]
        },
        ai: { sensitivity: 5, aggressiveness: 5, minPosition: 100, activationProfit: 60 },
        global: { 
            profitPercent: 0, 
            lossPercent: 0, 
            profitAmount: 0, 
            lossAmount: 0,
            conventionalEnabled: false,
            tiers: [
                { threshold: 2, callback: 0.5, expiry: 5 },
                { threshold: 5, callback: 1, expiry: 10 },
                { threshold: 10, callback: 2, expiry: 20 },
                { threshold: 20, callback: 4, expiry: 40 },
                { threshold: 40, callback: 8, expiry: 60 }
            ]
        },
        stopLoss: { enabled: false, minPosition: 100, lossPercent: 5, closePercent: 100 }
    },
    hedging: {
        enabled: true,
        triggerLossPercent: 1,
        triggerLossEnabled: true,
        hedgeRatio: 100,
        minPosition: 10,
        safeClearEnabled: false,
        safeClearProfit: 10,
        safeClearLoss: 10,
        oscillationCheck: false,
        oscillationTimeWindow: 60,
        boxThreshold: 1,
        touchCount: 3,
        trendHedgeEnabled: false,
        trendHedgeEmaPeriod: 80,
        breakKLineEnabled: false,
        breakKLineRatio: 20
    },
    stopLoss: {
        hedgeProfitClear: false,
        hedgeOpenRatio: 150,
        hedgeCoverPercent: 10,
        hedgeProfitClearStopLoss: 2,
        autoOpenAfterHedgeProfit: false,
        autoOpenPullbackPercent: 1,
        callbackProfitClear: true,
        callbackHedgeRatio: 150,
        callbackCoverPercent: 10,
        callbackTargetProfit: 10,
        callbackRate: 2,
        callbackStopLoss: 2,
        amputationEnabled: false,
        amputationTriggerProfit: 2,
        amputationRatio: 50,
        amputationVictoryBuffer: 10,
        amputationBreathingSpace: 1,
        fuseEnabled: false,
        maxHedgeRetries: 3,
        fuseFailStopPercent: 30,
        advisor: { enabled: true, autoSwitch: false, minConfidence: 70 }
    },
    martingale: { enabled: false },
    system: { binanceApiKey: '', binanceApiSecret: '', directMode: true, realTrading: false },
    scanner: {
        minVolume: 1, 
        maxVolume: 0,
        minChange: 1, 
        source: 'BOTH',
        timeBasis: '24H',
        limit: 520,   
        customSymbols: '',
        useCustomOnly: false,
        batchSize: 40
    },
    trendHunter: { enabled: false }
};
