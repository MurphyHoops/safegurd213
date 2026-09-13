# Repository Agent Guide

Keep this file short. It contains only rules that should apply to every coding task.

## Scope discipline
- Modify only what is required by the user's request.
- Do not perform unrelated refactors, formatting sweeps, dependency upgrades, or behavioral changes.
- Preserve existing public APIs, configuration semantics, thresholds, and state-machine behavior unless the user explicitly requests a change.
- Prefer the smallest coherent change that solves the requested problem.

## High-risk trading behavior
Treat these areas as high-risk: real Binance order execution, position opening/closing, hedge lifecycle, rescue/amputation/refill logic, debt accounting, PnL semantics, leverage semantics, WebSocket/order-confirmation paths, and persistence of trading state.

When a task touches these areas:
- preserve existing safety, deduplication, reconciliation, and idempotency guards;
- do not create duplicate order paths or orphan hedge legs as a side effect;
- do not alter lifecycle order or trigger semantics unless explicitly requested.

## Financial semantics
- Strategy trigger percentages and PnL percentages are based on the underlying asset's raw price movement unless a specific financial-display calculation explicitly requires leverage.
- Do not silently multiply strategy thresholds, stop conditions, rescue conditions, or position PnL percentages by leverage.

## Security
- Do not expose or hard-code credentials, API secrets, passwords, identity numbers, or other personal data.
- Do not weaken authentication, authorization, or exchange-safety checks as an unrelated side effect.

## Validation
After code changes, run relevant available checks (TypeScript/build/tests) when practical and report:
1. files changed;
2. behavior intentionally changed;
3. checks run and their result;
4. any unresolved risk.
