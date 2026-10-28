# 强力防爆对冲新增「4. EMA10破EMA20」触发条件实施报告

## 一、需求回顾与实现定义
用户要求在系统 **模块 2 [强力防爆对冲 (Hedge Guardian)]** 的对冲触发方式中，紧跟在「3. 破位大K线」下方新增 **「4. EMA10破EMA20」** 条件：
1. **基准价格捕获**：以开仓信号形成过程中 **EMA10 穿越 EMA20 时的价格**（即第一原点基准价 `ema10Cross20Price`）作为关键防守底线；
2. **多空双向破位判定**：
   - 多单主仓（LONG）：当实时标记价格跌破该基准价（`markPrice <= ema10Cross20Price`）时触发；
   - 空单主仓（SHORT）：当实时标记价格涨破该基准价（`markPrice >= ema10Cross20Price`）时触发；
3. **并联与门禁原则**：
   - 与（2. 趋势防火墙）和（3. 破位大K线）完全并联使用，支持单选或多选；
   - 严格遵循先到先得原则；
   - 严格服从【亏损触发限制】（如浮亏达到设定阈值才允许启动对冲）；
   - 严格遵守对冲必须处于浮亏状态（`pnlPercent < 0`）的基本原则。

## 二、代码修改清单
1. **类型定义 (`types.ts`)**：
   - `Position` 接口新增 `ema10Cross20Price?: number;` 字段；
   - `HedgingSettings` 接口新增 `ema10Cross20BreakEnabled?: boolean;` 开关。
2. **默认配置 (`config/defaultSettings.ts`)**：
   - 默认防爆对冲设置中加入 `ema10Cross20BreakEnabled: false`。
3. **前端交互界面 (`modules/hedge-guardian/components/HedgeTriggerMethods.tsx`)**：
   - 在「3. 破位大K线」正下方新增「4. EMA10破EMA20」卡片，包含开关切换与精准中文说明。
4. **对冲撮合判定核心 (`services/rules/hedging_rules.ts`)**：
   - 在 `checkHedgingRules` 中新增「D. 4. EMA10破EMA20」判定分支；
   - 接入 `combinedLossLimitMet`（亏损触发限制）门禁与先到先得并联队列；
   - 生成清晰明确的触发原因标签 `[EMA10破EMA20] 价格跌破/突破开仓基准防线(...)`。
5. **模拟撮合与生命周期 (`services/marketSimulator.ts`)**：
   - `openPosition` 挂接 `ema10Cross20Price`，确保所有持仓具备该基准防线；
   - `reopenPosition` 完整继承基准防线价；
   - 二次防爆检测看门狗中同步接入该条件并校验亏损门禁。

## 三、编译与验证
- `lint_applet` (`tsc --noEmit`) 验证通过，0 错误。
- `compile_applet` (`vite build`) 验证通过，0 错误。
