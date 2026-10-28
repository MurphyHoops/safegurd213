# List 3 Independent Rule Mode [Hard Filter vs. Star Rating] Implementation Plan

## 1. Goal Overview
Upgrade List 3 (Structure Audit) so that each of the 5 core structural audit rules can be **independently configured** in either:
1. **【强拦截 (HARD FILTER)】**: Drops coins from List 3 if they do not pass the rule (legacy behavior).
2. **【仅星标 (STAR AUDIT)】**: Keeps coins in List 3 regardless, but awards a **⭐ Star Point & Badge** if satisfied.

---

## 2. Five Independent Structural Audit Dimensions

| # | Rule Name | Field Key | Hard Filter Behavior | Star Audit Behavior |
|---|---|---|---|---|
| 1 | **同色交叉** | `checkCandleColor` / `checkCandleColorMode` | Drop coin if candle color is wrong | Award **⭐色** badge if candle color is correct |
| 2 | **严格趋势** | `strictTrend` / `strictTrendMode` | Drop coin if EMAs are not strictly fan-shaped | Award **⭐势** badge if trend is strictly fan-shaped |
| 3 | **时空共振** | `enableMultiResonance` / `multiResonanceMode` | Drop coin if sub-2-timeframes aren't aligned | Award **⭐共** badge if sub-2-timeframes aligned |
| 4 | **高级过滤 (EMA80)** | `enableAdvancedFilter` / `advancedFilterMode` | Drop coin if EMA80 intersections > threshold | Award **⭐审** badge if EMA80 intersections <= threshold |
| 5 | **前置洗盘 V 反** | `enablePriorReverseDivergence` / `priorReverseMode` | Drop coin if no prior reverse divergence found | Award **⭐反** badge if prior reverse divergence found |

---

## 3. Data Structure & Config Enhancements

### A. Config Extensions (`components/Scanner/scannerTypes.ts`)
Add mode properties to `List3Config`:
```typescript
export interface List3Config {
    // Rule Mode Selections ('FILTER' = Hard Filter, 'STAR' = Soft Star Audit)
    checkCandleColorMode?: 'FILTER' | 'STAR';
    strictTrendMode?: 'FILTER' | 'STAR';
    multiResonanceMode?: 'FILTER' | 'STAR';
    advancedFilterMode?: 'FILTER' | 'STAR';
    priorReverseMode?: 'FILTER' | 'STAR' | 'BOTH' | 'BADGE';
    
    // Sort option
    sortModeList3?: 'LATEST' | 'STARS' | 'TIMEFRAME';
}
```

### B. Signal Result & Item Extensions
Add star tracking to `List3SignalResult['structure']` and `ScannerItem`:
```typescript
export interface List3SignalResult {
    structure: {
        // ... existing fields
        starScore?: number;        // 0 to 5 stars
        starBadges?: string[];     // ['色', '势', '共', '审', '反']
        colorPassed?: boolean;
        strictTrendPassed?: boolean;
        resonancePassed?: boolean;
        advFilterPassed?: boolean;
        priorReversePassed?: boolean;
    }
}
```

---

## 4. Evaluation Engine (`services/rules/list3_structure.ts`)

1. **Calculate All 5 Statuses**:
   Compute `colorPassed`, `strictTrendPassed`, `resonancePassed`, `advFilterPassed`, `priorReversePassed` regardless of filter modes.
2. **Calculate Stars & Badges**:
   - Count how many satisfied rules exist for this coin.
   - Attach `starScore` (0~5) and `starBadges` array.
3. **Hard Filter Check**:
   - Only return a rejection reason (`getList3SignalRejectReason`) if a rule is:
     - Enabled (`true`), AND
     - Set to `'FILTER'` (Hard Filter), AND
     - Not satisfied.
   - Rules set to `'STAR'` (Soft Audit) will **NEVER** trigger rejection.

---

## 5. UI & Control Panel Updates (`modules/structure-audit/`)

1. **`Control.tsx`**:
   - For each of the 5 rules, render an intuitive toggle pill next to the switch:
     - `[强拦截]` (Red/Purple border)
     - `[仅星标]` (Gold/Amber border)
2. **`Item.tsx` / `List3_Structure.tsx`**:
   - Display prominent **⭐ Star Rating** (e.g. `⭐⭐⭐⭐⭐ 5星` / `⭐⭐3星`).
   - Display illuminated badges (`[色] [势] [共] [审] [反]`).
   - Add sorting button: Sort by **Star Rating (⭐星级优先置顶)**.

---

## 6. Execution & Verification Plan
1. Update `scannerTypes.ts` with mode types and star rating fields.
2. Update `list3_structure.ts` with 5-dimension star evaluation and mode-aware filtering logic.
3. Update `useStructureAudit.ts` to preserve star scores and badges.
4. Update `Control.tsx` with individual `[强拦截 / 仅星标]` pill controls for all 5 rules.
5. Update `List3_Structure.tsx` and `Item.tsx` to render star ratings, illuminated badges, and star-sorting option.
6. Verify via `compile_applet` and test with simulated signals.
