# Project-Specific Instructions

## Global Scanner (List 1-6) - Real-time Mode Code Lock
**CRITICAL**: The core logic and UI for the All-Domain Scanner (Lists 1-6) in **Real-time Mode** are now locked. 
Do NOT modify any code in the following directories/files unless explicitly instructed to fix a critical regression:
- `/modules/market-scanner/` (List 1) - **LOCKED**
- `/modules/grand-crossing/` (List 2) - **STRICTLY LOCKED** (Do not modify rules without explicit instruction)
- `/modules/structure-audit/` (List 3)
- `/modules/momentum-audit/` (List 4)
- `/modules/final-audit/` (List 5)
- `/modules/terminal-dashboard/` (List 6)
- `/components/Scanner/` (Scanner-related components)
- `/services/rules/` (Core algorithmic files for L1-L6)
- `/services/scanner/` (Scanner orchestration logic)
- `/services/apiService.ts` (Network core)

This lock ensures stability while development shifts to the **Backtest Mode (Simulation Terminal)**.

## Momentum Audit (List 4) - Special Rule Lock
**CRITICAL**: The core running rules, logic, and configuration for the following features in List 4 (Momentum Audit) are now locked and **MUST NOT** be modified unless explicitly instructed by a special directive:
1. **防追高熔断 (Anti-Chase Fuse)**: Features that prevent chasing extreme price movements away from reference baseline lows/highs.
2. **动态方向锁 (Dynamic Direction Lock)**: Features that dynamically restrict trade directions (e.g., locking Long/Short) to prevent entering trades against dominant momentum trends.

## K-Line Data Fetching - Code Lock
**CRITICAL**: The core K-line data fetching mechanism, including the tiered proxy fallback strategy in `raceFetchKlines`, is now locked to maintain stability.
- `/components/KlineChartModal.tsx` (Specifically `raceFetchKlines` function) - **LOCKED**
- `/services/realtime/BinanceRealtimeService.ts` - **LOCKED**
- `/components/ScannerDashboard.tsx` (Specifically real-time price handling logic) - **LOCKED**
- `/components/TradeLogModal.tsx` (Specifically logic for transaction log navigation and filtering) - **LOCKED**
Do NOT modify this logic unless explicitly instructed to fix a critical regression.

## Strategy 4 Amputation (Only Clear Hedge) - Code Lock
**CRITICAL**: The core logic, interface settings, and rules for Strategy 4 "断臂求生" (including the "只清对冲、主仓续航" feature and switch) are now locked to maintain stability.
- `/services/rules/rescue/strategy4_amputation.ts` - **STRICTLY LOCKED**
- `/services/rules/rescue_rules.ts` (specifically Strategy 4 invocations) - **STRICTLY LOCKED**
- `/components/Settings/RescueStrategies/Strategy4_Amputation.tsx` - **LOCKED**
- `/modules/rescue-tactics/strategies/Strategy4_Amputation.tsx` - **LOCKED**
Do NOT modify this logic or settings unless explicitly instructed to fix a critical regression.

## List 1 Instant Open & Reopen - Code Lock
**CRITICAL**: The core automation logic and UI controls for List 1 "立即开仓" (Instant Open) and "平仓后立即开仓" (Instant Reopen) are now locked to maintain stability.
- `/modules/market-scanner/components/List1_Selection.tsx` (Specifically the inline header switch controls) - **STRICTLY LOCKED**
- `/components/ScannerDashboard.tsx` (Specifically the `useEffect` instant open hook, refs, and closed-loop execution triggers) - **STRICTLY LOCKED**
Do NOT modify this logic or settings unless explicitly instructed to fix a critical regression.

## List 1 Big Market Trend Discovery - Code Lock
**CRITICAL**: The core logic, parameters, and UI controls for the List 1 "大行情发现模式" (Big Market Trend Discovery Mode), including direction switches (enableLong, enableShort) and sideways switch (enableSideways), are now strictly locked.
- `/modules/market-scanner/useScannerLogic.ts` (Specifically `runMajorTrendDiscovery` filter logic) - **STRICTLY LOCKED**
- `/modules/market-scanner/components/MajorTrendSection.tsx` (Specifically the custom core and sideways UI switches) - **STRICTLY LOCKED**
- `/components/Scanner/scannerTypes.ts` (Specifically the `MajorTrendConfig` switches definition) - **STRICTLY LOCKED**
Do NOT modify this logic or settings unless explicitly instructed to fix a critical regression.

