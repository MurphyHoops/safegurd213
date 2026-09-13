# Repository Agent Guide

This file contains only the global rules that should apply to every coding task. Detailed business invariants live under `docs/invariants/` and should be read only when the task touches the corresponding subsystem.

## Scope discipline
- Modify only what is required by the user's request.
- Do not perform unrelated refactors, formatting sweeps, dependency upgrades, or behavioral changes.
- Preserve existing public APIs, configuration semantics, thresholds, and state-machine behavior unless the user explicitly requests a change.
- If a requested change necessarily affects another high-risk subsystem, explain the dependency before changing that subsystem.

## High-risk trading behavior
Treat the following as high-risk: real Binance order execution, position opening/closing, hedge lifecycle, rescue/amputation/refill logic, debt accounting, PnL semantics, leverage semantics, WebSocket/order-confirmation paths, and persistence of trading state.

For tasks touching those areas, first read the relevant file under `docs/invariants/` and preserve its invariants unless the user explicitly requests otherwise.

## Financial semantics
- Strategy trigger percentages and PnL percentages are based on the underlying asset's raw price movement unless a specific financial-display calculation explicitly requires leverage.
- Do not silently multiply strategy thresholds, stop conditions, rescue conditions, or position PnL percentages by leverage.

## Change safety
- Prefer the smallest coherent change that solves the requested problem.
- Do not add new dependencies unless they are necessary for the requested task.
- Do not expose or hard-code credentials, API secrets, passwords, identity numbers, or other personal data.
- Do not weaken existing safety, deduplication, reconciliation, or idempotency guards as a side effect of another change.

## Validation
After code changes, run the relevant available checks (TypeScript/build/tests) when practical. Report:
1. files changed;
2. behavior intentionally changed;
3. checks run and their result;
4. any unresolved risk.

## Invariant references
- Trading execution and PnL: `docs/invariants/trading-core.md`
- Hedge, rescue, refill, and debt: `docs/invariants/hedge-rescue.md`
- Scanner/list lifecycle: `docs/invariants/scanner.md`
- Binance connectivity, reconciliation, and logs: `docs/invariants/network-logging.md`
