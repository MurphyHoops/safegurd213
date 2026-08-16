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

## List 1 Big Market Trend Discovery - Modified
**NOTE**: The core logic, parameters, and UI controls for the List 1 "大行情发现模式" (Big Market Trend Discovery Mode) were unlocked and modified on 2026-08-01 per user request to change the "Sideways Consolidation" (横盘蓄势) logic.
- `/modules/market-scanner/useScannerLogic.ts` (Specifically `runMajorTrendDiscovery` filter logic) - **MODIFIED**
- `/modules/market-scanner/components/MajorTrendSection.tsx` (Specifically the custom core and sideways UI switches) - **MODIFIED**
- `/components/Scanner/scannerTypes.ts` (Specifically the `MajorTrendConfig` switches definition) - **UNLOCKED**
Do NOT modify this logic or settings unless explicitly instructed to fix a critical regression.

## Real-time Price Push & Position Sync Engine - Code Lock
**CRITICAL**: The core real-time high-performance price push, Web-Worker-based WebSocket subscription, and DOM-bypass UI updates are now strictly locked to ensure 100% safety, security, and millisecond-level synchronization with the Binance exchange.
- `/services/binanceWs.ts` - **STRICTLY LOCKED**
- `/services/priceRegistry.ts` - **STRICTLY LOCKED**
- `/components/RealtimePriceSpan.tsx` - **LOCKED**
- `/components/RealtimePnlSpan.tsx` - **LOCKED**
- `/modules/live-battlefield/components/PositionRow.tsx` - **LOCKED**
- `/modules/positions-list/components/PositionItem.tsx` - **LOCKED**
Do NOT modify this logic, subscriptions, or rendering pipelines unless explicitly instructed to fix a critical regression.

## WebSocket Real-time Ticking Thread Safety - Code Lock
**CRITICAL**: The high-frequency WebSocket tick throttling mechanism in `App.tsx` is strictly locked. 
- In `/App.tsx` (Specifically the `binanceWs.subscribe` callback logic and `lastInstantTickTimeRef` checks) - **STRICTLY LOCKED**
This prevents event loop starvation, browser freezes, and subsequent unhandled rendering crashes ("blue/white screens"). The tick frequency MUST remain throttled to >= 150ms. Do NOT remove this throttling layer!

## Real-trading Automated Execution & Auto-Reopen - Code Lock
**CRITICAL**: The core logic, callbacks, and safety parameters for the Binance real-trading automated execution, partial amputation callbacks, and automatic reopening mechanisms are now strictly locked.
- `/services/marketSimulator.ts` (Specifically real-trading execution hooks `onRealClose`, `onRealReopen`, `handleRealAmputationSuccess`, and reopen limit checks in `reopenPosition`) - **STRICTLY LOCKED**
- `/App.tsx` (Specifically the setup callbacks `sim.onRealClose`/`sim.onRealReopen`, real-trading position opening rules bypass logic `extraProps?.isReopened`, and delayed execution handlers `handleAutoReopen`) - **STRICTLY LOCKED**
Do NOT modify this logic, timing delays, or synchronization rules unless explicitly requested with a specific confirmation directive.

## 🔒 Strict Modification & Authorization Directive (绝对修改授权铁律)
**CRITICAL USER DIRECTIVE**: 
"这些功能的失效是从来都没有下指令的，以后在没特别下指令的时候，你绝对不能乱修改程序里的功能；【如果有特别原因需要涉及其它功能修改的，必须要在询问，等待我确认后再修改】，把这段话置入你的程序修改内容里，每次修改都要先看看这段指令"
- WITHOUT EXPLICIT ORDERS, YOU MUST ABSOLUTELY NOT MODIFY EXISTING FEATURES OR COMPONENT BEHAVIORS.
- IF A PROPOSAL REQUIRES REWRITING OR MODIFYING OTHER CORES/FUNCTIONS, YOU **MUST** EXPLICITLY ASK AND WAIT FOR USER CONFIRMATION BEFORE PROCEEDING!




