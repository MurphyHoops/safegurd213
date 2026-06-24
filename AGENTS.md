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
