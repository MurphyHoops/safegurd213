# System Protection & Atomic Code Lock Directive

> **STRICT COMPLIANCE FOR ALL FUTURE TURNS**:
> 1. **未授权绝不触碰**：没有用户下达明确指令要修改或增加的地方，绝对不触碰、不篡改、不优化、不重构。
> 2. **跨模块/联动修改先请示确认**：如果因为代码或业务逻辑需要涉及其它地方增加或修改内容的，**必须先明确向用户提示说明原因与影响，待用户明确确认后，方可进行修改**。严禁擅自做主！
> 3. All functional modules are decoupled into atomic units. 
> DO NOT touch, refactor, reorganize, or alter any module, service, rule, or UI unless explicitly instructed by the user in the prompt.
> Unrequested modifications are strictly prohibited.
> 
> 🔒 **Special Permanent Lock - List 1 & Market Selection List & List 2 Divergence Rules & List 3 & List 4 (5K 爆发推进) & Rescue Tactics & Variable Trailing Retention & List 1 Config A**:
> 1. **List 1 过滤规则**（包含：行情启动趋势底池扫描、横盘蓄势过滤、回溯周期过滤的计算逻辑与流转链条）已完全固化锁定。
> 2. **List 1 [配置 A 常规模式] 全套规则与代码**（包含：`modules/market-scanner/components/FilterSection.tsx`、`modules/market-scanner/components/VolumePoolBox.tsx`、`services/volume8amService.ts`、`services/rules/list1_market.ts` 中 24H 交易额区间过滤、早上8点起交易额独立开关门禁校验、无上限 0 及超大数值防呆识别、涨跌幅与方向筛选、常规模式候选池极速流转等全部运行规则、算法与 UI 代码）已完全固化锁定。没有用户下达明确指令，绝对不得触碰、修改、重构或变动配置 A 常规模式的任何一个功能和代码！
> 3. **市场初筛列表删减/差量更新规则**（包含：根据最后一项开启规则执行对比、永不清零、纯差量对比增删 Diff 机制）已完全固化锁定。
> 4. **List 2 [大十字星监控 - 均线发散规则与列表3流转门禁] 所有功能与代码**（包含：`modules/grand-crossing/` 下所有组件/Hooks与 `services/rules/list2_crossing.ts` 中 EMA10/20/30/40 均线发散形态判定、同向K线收盘确立为信号K线、信号存续访问过去K线范围核验、发散回溯穿越、发散起爆原点 Genesis 锁定与老旧发散淘汰门禁、先穿越后等待发散模式、列表2至列表3方向过滤强行门禁与内部周期信号原子净化等全部发散计算逻辑、流转机制与UI配置）已完全固化锁定。没有用户下达明确指令，绝对不得触碰、修改、重构或变动关于“发散”规则与流转门禁的所有代码和任何规则！
> 5. **List 3 [结构深度审计] 所有功能与代码**（包含：`modules/structure-audit/` 下所有文件及 `services/rules/list3_structure.ts` 结构深度审计、周期过滤、严格趋势、同色交叉、波幅审计、RSI动能过滤、时空共振算法与流转链条）已完全固化锁定。没有用户下达明确指令，绝对不得修改、重构或变动列表3的任何一个功能和代码！
> 6. **List 4 [动能趋势审计 & 高级过滤] 与 5K 爆发推进 所有功能与代码**（包含：`modules/momentum-audit/` 下所有组件/Hooks与 `services/rules/list4_momentum.ts`、`services/rules/list3_structure.ts` 中进攻突破线、中轴防守清除、前NK实体收盘突破门禁、突破偏离过大拦截、**5K 爆发推进**【以信号K为中心左右各2根共5根K线覆盖窗口、仅保留234/345/456连续3根组合、做多净涨幅≥阈值/做空净跌幅≥阈值、振幅阈值自定义输入与步进调节、熔断拦截】、防追高熔断、动态方向锁、5组高级过滤EMA穿透与交叉距离计算等全部算法、状态机流转与UI面板）已全部固化锁定。没有用户下达明确指令，绝对不能修改、增加、删减或变动列表4与5K推进的任何一个功能和代码！
> 7. **多级阶梯式保底平仓规则 (Variable Trailing Retention Tiers)**：包含 `modules/profit-manager/components/ConventionalMode.tsx` 中变量阶梯配置面板、激活起征点、区间范围、保底留存率、以及 `services/rules/profit/conventional.ts` 变量托底动态计算与平仓触发算法均已完全固化锁定。没有用户下达明确指令，绝对不得修改、重构或变动其任何一个功能和代码！
> 8. **断臂求生与对冲解套清仓/续航/复开规则 (Strategy 2 & Strategy 4)**：
>    - 必须且仅当【原主仓自身盈利解套 (mainPnL > 0 且 mainPnL >= hedgePnL)】时，才执行“只清对冲、主仓续航”；
>    - 若为【对冲单盈利解套 (hedgePnL > 0)】，必须强制执行双向同时全平清仓（closePair），并在开启原仓复开时执行原仓位初始方向完全复开；
>    - 该多空双向对冲解套核心流转逻辑已完全固化锁定。
> 9. **执行铁律**：后续任何对话或任务中，若没有用户针对这些部分下达明确的专属修改指令，绝对严禁擅自修改、增加、删减、重构或变动其任何代码与逻辑！
