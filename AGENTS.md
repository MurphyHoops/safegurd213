# Project Universal Constraints & Atomic Code Locks

## 🔒 通用约束与核心铁律 (Universal Constraints)
1. **说到做到铁律 (Absolute Execution Commitment)**: 必须对用户承诺说到做到，绝不说了不做到！对用户说的每一句话都必须是能够百分之百落实做到的！切记！切记！
2. **只修改提及的地方或功能 (Strict Scope Discipline)**: 没有特别下指令提及要修改的地方，绝对不准擅自修改现有功能或组件行为。只改单点、绝不动面！
3. **不准改其他功能 (Zero Side-Effects)**: 任何修改必须严格限制在指定范围内，绝不允许波及或修改未提及的其他功能。
4. **不准擅自重构 (No Unsolicited Refactoring)**: 绝对禁止擅自重构已稳定运行的代码结构或重写系统架构。
5. **不准加依赖 (No Unsolicited Dependencies)**: 严禁擅自安装或引入未经明确指令许可的外部 npm 包或依赖库。
6. **只改单点、绝不动面 (Single-Point Mutation Only)**: 严禁顺带修整、严禁联想式补全修改周边代码。
7. **修改确认制 (Mandatory Authorization Check)**: 如果有特别原因确实需要涉及或调整其他功能/核心模块，**必须先在对话中明确询问并等待用户确认授权后方可修改**。
8. **杠杆计算边界绝对铁律 (Leverage Calculation Boundary Rule)**: 除了财务统计“可用余额 / 杠杆可用额”的时候用上“杠杆”计算外，全系统其余所有盈亏比例（包括所有止盈止损、救世策略如断臂求生/对冲盈利/回调盈利的触发阈值、持仓监控等）一律严格基于【标的资产原始价格变动幅度】，绝对不得置入杠杆比例计算！

---

## 🔒 绝对修改授权铁律 (User Golden Directive)
> **"这些功能的失效是从来都没有下指令的，以后在没特别下指令的时候，你绝对不能乱修改程序里的功能；【如果有特别原因需要涉及其它功能修改的，必须要在询问，等待我确认后再修改】，把这段话置入你的程序修改内容里，每次修改都要先看看这段指令"**

---

## 🔒 永恒绝对执行三铁律 (Permanent Execution Iron Rules)
1. **绝对禁令**：凡是没有您明确指令的地方，一个字符都不准乱改，绝对不擅自“联想式调整”或擅自变动已有功能的触发时机。
2. **忠实遵照原设计规则**：任何策略的触发条件、执行阶段（如“断臂求生先砍仓回踩循环”、“解套后才允许清对冲/续航”）必须严格忠实于系统初始设计的生命周期，绝不允许跨阶段、提前或颠倒执行。
3. **严格执行授权确认制**：若排查中发现需要改动任何已有逻辑，必须完整陈述真实原因，等待您明确确认并下达指令后方可操作，绝不自作主张。

---

## 🔒 原子化全域代码锁定清单 (Atomic Module & Pipeline Locks)

### 0. 【全系统原子化最小拆分单元未授权绝不可动最高终极铁律 🔒】
- **全域最小单元绝对锁定**：全系统所有流水线（Lists 1-6）、八大核心功能模块（Modules 1-8）、扩展业务模块（Modules 9-13）以及基础服务引擎，现已全面完成原子化最小单元的拆分并形成权威清单。
- **没有下指令的地方绝对不准改**：**凡是用户在当前对话中没有特别下达明确指令提及的最小拆分单元、组件、函数、规则算子或配置文件，哪怕只有1个字符或1行，绝对严禁擅自动用或修改！严格做到“没有明确下指令，绝不动任何现有代码”！**
- **只改单点、绝不动面**：任何获得明确授权的修改，必须严格物理隔离在被指定的单一原子化组件或文件内，严禁联想式修改周边任何依赖项或未提及模块。

---

### 1. 全域初筛流水线 (Lists 1-6 Pipeline) - 【全域原子化最小单元绝对锁定 🔒】
- **List 1: 市场初筛 (`/modules/market-scanner/`, `/services/rules/list1_market.ts`)**: 
  - **UI 主面板与选择器容器**：`/modules/market-scanner/ScannerUI.tsx`、`/modules/market-scanner/components/List1_Selection.tsx`
  - **三级过滤池独立盒子单元**：`/modules/market-scanner/components/VolumePoolBox.tsx`（成交量底池 5m）、`/modules/market-scanner/components/StartTrendPoolBox.tsx`（启动趋势底池 3m）、`/modules/market-scanner/components/SidewaysPoolBox.tsx`（横盘蓄势/宏观底池 4m）
  - **参数控制与条件配置单元**：`/modules/market-scanner/components/Control.tsx`（头部自动/手动与刷新间隔）、`/modules/market-scanner/components/FilterSection.tsx`（基础过滤阈值）、`/modules/market-scanner/components/StartTrendSection.tsx`（启动趋势参数）、`/modules/market-scanner/components/MajorTrendSection.tsx`（横盘蓄势与回溯周期过滤参数）
  - **执行动作与单币渲染单元**：`/modules/market-scanner/components/ActionSection.tsx`（一键开仓与平仓后立即开仓闭环状态机）、`/modules/market-scanner/components/Item.tsx`（单币紧凑行与详情折叠极值/多周期面板）、`/modules/market-scanner/components/WatchlistSection.tsx`（自选关注池）、`/modules/market-scanner/components/RulesModal.tsx`（规则释义弹窗）
  - **底层扫描状态机与规则核心**：`/modules/market-scanner/useScannerLogic.ts`（多周期日K拉取、2秒单币节拍回溯极值判定、本地存储与缓存同步）、`/services/rules/list1_market.ts`（初筛数学过滤算法）、`/modules/market-scanner/types.ts`、`/modules/market-scanner/index.ts`
  - 【特别绝对锁定 🔒】**市场初筛永不清零·增量差量动态更新铁律**：初筛流水线全链路（包括成交量底池、行情启动趋势底池、横盘蓄势底池、回溯周期极值底池及列表1最终展示）在启动新扫描或例行轮询时，**绝对严禁将底池或列表清零（清空为 [] 或 0）**！必须保留当前既有符合币种，在逐币扫描过程中严格实行**增量与差量动态更新机制**——仅对新符合规则的币种执行“增加”、对不再符合规则的币种执行“删减”，杜绝任何形式的中途清空与闪烁；本铁律全域严格锁定，永不得更改！
  - 【特别绝对锁定 🔒】**回溯周期过滤即时呈现与完整保留一致性铁律**：在“回溯周期过滤”扫描期间，符合规则的币毫秒级即时加入候选池并在市场初筛展示，绝不清零，绝不提前拦截；扫描完成后候选币全部完好呈现在初筛列表中，绝不允许突然批量减少或刚进又删；且统计数字与初筛列表唯一币种行数100%绝对精准对应！

- **List 2: 均线穿越 (`/modules/grand-crossing/`, `/services/rules/list2_crossing.ts`)**: 
  - **UI 主面板与列表容器**：`/modules/grand-crossing/GrandCrossingUI.tsx`、`/modules/grand-crossing/components/List2_GrandCrossing.tsx`
  - **参数控制与时间粒度单元**：`/modules/grand-crossing/components/Control.tsx`、`/modules/grand-crossing/components/ConfigSection.tsx`、`/modules/grand-crossing/components/TimeframeSelector.tsx`
  - **单币渲染与状态单元**：`/modules/grand-crossing/components/Item.tsx`
  - **底层逻辑与穿越规则核心**：`/modules/grand-crossing/useGrandCrossing.ts`、`/services/rules/list2_crossing.ts`、`/modules/grand-crossing/types.ts`、`/modules/grand-crossing/index.ts`
  - 【特别绝对锁定 🔒】**列表2独立生命周期机制与访问过去信号K线锚定**：列表1币种进入列表2后立即物理切断与列表1依附关系，不受列表1退出连带清除；严格按【信号存续】“访问过去”设定根数回溯扫描，在回溯K线上符合穿越/发散规则即保留并精确标记该K线为信号K线；存留严格且仅由【信号存续】寿命根数及列表3/4反向清除指令唯一控制。

- **List 3: 结构审计 (`/modules/structure-audit/`, `/services/rules/list3_structure.ts`)**: 
  - **UI 主面板与列表容器**：`/modules/structure-audit/StructureAuditUI.tsx`、`/modules/structure-audit/components/List3_Structure.tsx`
  - **参数控制单元**：`/modules/structure-audit/components/Control.tsx`
  - **单币渲染与形态分析单元**：`/modules/structure-audit/components/Item.tsx`
  - **底层逻辑与结构审计核心**：`/modules/structure-audit/useStructureAudit.ts`、`/services/rules/list3_structure.ts`、`/modules/structure-audit/types.ts`、`/modules/structure-audit/index.ts`
  - 核心算法：K线实体形态、支撑阻力位、布林带挤压、ATR突破审计、7K推进力。

- **List 4: 动量审计 (`/modules/momentum-audit/`, `/services/rules/list4_momentum.ts`)**: 
  - **UI 主面板与列表容器**：`/modules/momentum-audit/MomentumAuditUI.tsx`、`/modules/momentum-audit/components/List4_Momentum.tsx`
  - **参数控制单元**：`/modules/momentum-audit/components/Control.tsx`
  - **单币渲染与状态单元**：`/modules/momentum-audit/components/Item.tsx`
  - **历史记录与释义弹窗单元**：`/modules/momentum-audit/components/ScannerHistoryModal.tsx`、`/modules/momentum-audit/components/RulesModal.tsx`
  - **底层逻辑与动量审计核心**：`/modules/momentum-audit/useMomentumAudit.ts`、`/services/rules/list4_momentum.ts`、`/modules/momentum-audit/types.ts`、`/modules/momentum-audit/index.ts`
  - 【特别锁定 🔒】防追高熔断 (Anti-Chase Fuse)、动态方向锁 (Dynamic Direction Lock)、高级过滤限制与震荡相交审计。

- **List 5: 最终审计与实时战场 (`/modules/live-battlefield/`)**: 
  - **UI 主面板与容器**：`/modules/live-battlefield/LiveBattlefieldUI.tsx`、`/modules/live-battlefield/components/List5_Live.tsx`
  - **单币高频行情行单元**：`/modules/live-battlefield/components/PositionRow.tsx`
  - **底层逻辑与状态机**：`/modules/live-battlefield/useLiveBattlefield.ts`、`/modules/live-battlefield/types.ts`、`/modules/live-battlefield/index.ts`
  - 【特别绝对锁定 🔒】**手动开仓模糊查询与高精度匹配引擎**：支持前缀匹配、子串匹配、1000倍币名衍生自动折算匹配、字符顺序子序列匹配及智能评分排序（完全匹配 > 衍生匹配 > 前缀匹配 > 包含匹配）；毫秒级从本地高频行情池与币安价格注册表极速定位币种，杜绝输入延迟与找币超时。
  - 【特别绝对锁定 🔒】**手动开仓毫秒级日志即时显示穿透引擎**：手动开仓时，向币安发送开仓指令、开仓响应结果（成功/失败/异常）、以及模拟/实盘开仓事件一律采用 `immediate: true` 穿透机制，绕过 500ms 缓冲队列，毫秒级直接同步至系统日志面板与屏幕提示，确保开仓动作绝对零感知延迟。

- **List 6: 战术面板与自动执行 (`/modules/tactical-command/`)**: 
  - **UI 主面板与容器**：`/modules/tactical-command/TacticalCommandUI.tsx`、`/modules/tactical-command/components/List6_Action.tsx`
  - **参数控制单元**：`/modules/tactical-command/components/Control.tsx`
  - **开平仓动作执行组单元**：`/modules/tactical-command/components/ActionGroup.tsx`
  - **底层逻辑与执行核心**：`/modules/tactical-command/useTacticalCommand.ts`、`/modules/tactical-command/types.ts`、`/modules/tactical-command/index.ts`
  - 战术指令下发、执行参数校验与自动开仓仲裁。

---

### 2. 核心交易与风控功能模块 (Modules 2-13) - 【全域原子化最小单元绝对锁定 🔒】
- **Mod 2: 持仓管理与实时对账 (`/modules/positions-list/`)**: 
  - **UI 主面板容器**：`/modules/positions-list/PositionsListUI.tsx`
  - **单币持仓行渲染单元**：`/modules/positions-list/components/PositionItem.tsx`（盈亏核算、多周期K线入口、主动刷新穿透、手动“砍/补/清”应急干预、独立时钟流水）
  - **单币独立风控设置弹窗单元**：`/modules/positions-list/components/PositionSettingsModal.tsx`（单币专属止盈止损、对冲触发阈值与托管规则）
  - **持仓同步频率与控制下拉单元**：`/modules/positions-list/components/SyncControlDropdown.tsx`
  - **空持仓占位单元**：`/modules/positions-list/components/EmptyPositions.tsx`
  - **底层持仓状态机与核算核心**：`/modules/positions-list/usePositionsListLogic.ts`、`/modules/positions-list/types.ts`、`/modules/positions-list/index.ts`
  - 【特别锁定 🔒】极速平仓响应通道 (`server.ts` `/api/binance/order` 并行取消挂单与持仓同步、前端批量清仓加速)
  - 【特别绝对锁定 🔒】**分时段批量清仓与防拥塞引擎**：一键清仓 / 全部清仓时严格实行分时段分批提交机制（每秒钟最多提交6个币，严格等待1秒间隔后再提交下一批6个币），彻底杜绝瞬时并发过载导致交易所拥塞或频控报错！
  - 【特别绝对锁定 🔒】**已启动防爆对冲触发条件右侧显示**：已启动防爆对冲的交易对/仓位，在右侧操作区原蓝色即将触发预警位置严格替换为实际已触发的对冲条件展示（如“亏损值（1.0）%启动防爆对冲”、“短期极值（0.5）%启动防爆对冲”等）。
  - 【特别绝对锁定 🔒】**单币刷新键主动读取币安实际持仓与成交流水铁律**：持仓列表中单币行右侧的刷新按钮严格且仅针对当前指定币种执行毫秒级定向穿透对账；实盘模式下并发查询币安实盘持仓与最新成交流水，毫秒级精准校准实际持仓量、开仓均价与浮动盈亏，自动对账补齐交易日志成交流水，并向系统日志实时输出以 USDT 为单位的详实对账反馈；绝不波及列表中其他币种持仓，绝不改变系统其他任何代码！
  - 【特别绝对锁定 🔒】**持仓单币手动“砍仓”、“补仓”、“清仓”应急干预铁律**：在持仓列表中单币行平仓按钮旁配置手动“砍仓”、“补仓”、“清仓”应急干预按钮；手动“砍仓”严格按止损削减比例市价平掉部分持仓，亏损全额记入负债池并开启回踩补仓状态机；手动“补仓”精准补回此前被砍数量，恢复双向持仓平衡；手动“清仓”同时市价全平主仓与对冲单（成对平仓），核算总负债出局，彻底杜绝孤儿单；三键与主动刷新键协同联动！

- **Mod 3: 预警防线与防爆对冲守护 (`/modules/hedge-guardian/`, `/services/rules/hedging_rules.ts`)**: 
  - **UI 主面板容器**：`/modules/hedge-guardian/HedgeGuardianUI.tsx`
  - **对冲触发条件与参数配置单元**：`/modules/hedge-guardian/components/HedgeTriggerMethods.tsx`
  - **安全清仓与防爆底线控制单元**：`/modules/hedge-guardian/components/SafeClearSection.tsx`
  - **底层对冲守护核心**：`/modules/hedge-guardian/useHedgeGuardian.ts`、`/services/rules/hedging_rules.ts`、`/modules/hedge-guardian/types.ts`、`/modules/hedge-guardian/index.ts`
  - 【特别绝对锁定 🔒】**防爆对冲开仓金额基准铁律**：防爆对冲仓位的开仓金额，严格基于【原仓位最初开仓时的原始金额】（`initialAmount * entryPrice`），绝对严禁使用启动防爆对冲开仓时的当前市价价值折算！
  - 【特别绝对锁定 🔒】**防爆对冲极速响应与新币/多触发方式开仓仲裁**：凡新开仓或未对冲币种，达到【持仓触发门槛】（名义价值/实际持仓）且达到任一所选【对冲触发方式】（亏损值/趋势防火墙/破位大K线/短期极值），严禁被历史残留冷却、过时在途锁或虚假极值阻拦，必须毫秒级立即启动防爆对冲开仓！

- **Mod 4: 救世策略库 1-8 (`/modules/rescue-tactics/`, `/services/rules/rescue/`)**: 
  - **UI 主面板容器**：`/modules/rescue-tactics/RescueTacticsUI.tsx`
  - **策略2: 对冲盈利解套单元**：`/modules/rescue-tactics/strategies/Strategy2_HedgeProfit.tsx`、`/services/rules/rescue/strategy2_hedgeProfit.ts`
  - **策略3: 回调盈利解套单元**：`/modules/rescue-tactics/strategies/Strategy3_CallbackProfit.tsx`、`/services/rules/rescue/strategy3_callbackProfit.ts`
  - **策略4: 断臂求生循环单元**：`/modules/rescue-tactics/strategies/Strategy4_Amputation.tsx`、`/services/rules/rescue/strategy4_amputation.ts`
  - **策略5: 震荡磨损熔断单元**：`/modules/rescue-tactics/strategies/Strategy5_OscillationGuard.tsx`、`/services/rules/rescue/strategy5_oscillationGuard.ts`
  - **策略6: AI自适应策略顾问单元**：`/modules/rescue-tactics/strategies/Strategy6_AIAdvisor.tsx`
  - **策略总线与类型系统**：`/services/rules/rescue/rescue_rules.ts`、`/modules/rescue-tactics/types.ts`、`/modules/rescue-tactics/index.ts`
  - 【特别绝对最高级全域锁定 🔒】**“断臂求生”与“防爆对冲”全套机制与所有代码绝对不可动铁律**：
    - **防爆对冲交易对常规止盈止损绝对失效与救世策略唯一接管铁律**：凡是启动了防爆对冲的交易对，常规“止盈止损”平仓规则（包括常规止盈、ATR止盈、智能止盈、AI止盈、智能跟踪止盈、单边止损及安全清仓）100% 物理失效，绝对严禁单平任何一方导致出现孤儿单！双向持仓与后续所有开平仓完全且唯一由【防爆对冲盈利出局（对冲盈利解套 / 回调盈利清仓 / 断臂求生 / 震荡磨损熔断）】接管，平仓必须成对清理（closePair）或遵循救世策略生命周期！
    - **止损砍仓开仓价值记录与精确补仓铁律**：断臂求生砍仓止损时，交易日志必须独立记录【止损砍仓】流水，开仓价值严格记录本次实际砍掉的金额（如10U砍90%记录9U），原/对冲仓位的开仓价值即时扣减为留存金额（1U）；回踩补仓时，直接读取该次砍仓扣减的准确数量全额补足，保证日志清晰明了且与实盘持仓完全对称！
    - **断臂求生原始价格变动幅度现场物理核算与对冲建仓保护期铁律**：断臂求生触发砍仓时，必须严格基于【基准开仓价】与【当前最新实时标记价】进行现场实时物理核算双方真实盈利率，严禁直接信任可能残留对冲前历史波峰的过时数据；对冲单刚开仓15秒内设立冷静保护期，杜绝在建仓与持仓对账过渡期草率发起砍仓；防爆对冲开仓成功时，100%物理清空主仓此前历史波峰盈利率与旧断臂触发标记！
    - **断臂求生负债继承与闭环记录**：断臂求生（Strategy 4）在启动防爆对冲砍仓时，亏损方的已实现亏损金额必须100%永久记入该币负债账户，并立即由该币留存的对手单（及单币负债池）全额继承，严禁因仓位移出列表或实盘轮询同步而丢失！
    - **原子化负债账单只记入一次与单币负债池权威核算引擎 (`/services/debtManager.ts`)**：
      1. 砍仓亏损只记入一次绝对铁律：砍仓过后的亏损金额记入“负债”账单，【只记入一次】，绝不得以任何形式重复记入！
      2. 去重幂等注册表绝对锁定：单笔砍仓/断臂减仓订单 ID 记入防重注册表后立即物理加锁，严禁重复叠加任何差额。
      3. 权威去重核算与防污染纠偏：以当前对冲生命周期内真实发生的平仓/砍仓流水为唯一依据，按 `orderId` 严格去重核算真实累计负债，自动识别并剔除任何历史残留的重复叠加脏数据。
      4. 最小代码结构完全锁定：`/services/debtManager.ts` 及其在各模块中的调用点全域锁定，严禁因后续任何修改破坏其原子化独立性！
    - **断臂求生砍仓亏损金额统一物理核算算法绝对锁定铁律**：
      1. 全链路统一核算公式：断臂求生/止损砍仓在所有分支（即时成交回调、极速探针对账分支、1秒定时主动抓取分支及超时兜底对账补偿分支等）核算砍仓实际亏损金额时，必须 100% 统一使用且仅使用物理核算公式：`priceDiff = position.side === 'LONG' ? currentMark - position.entryPrice : position.entryPrice - currentMark`，`cutAmount = customQty` (实际被削减数量)，`calculatedPnl = priceDiff * cutAmount`，`realizedPnL = tradePnl !== 0 ? tradePnl : calculatedPnl`。
      2. 绝对严禁多重折算与残余持仓污染：绝对严禁将 `priceDiff` 乘以全量持仓后再乘以 `(ratio / 100)`（避免异步扣减持仓量导致基数失真产生错误）；必须直接以实际砍仓削减数量 `cutAmount` 现场实时物理核算！
      3. 严格遵守杠杆计算边界铁律：计算砍仓亏损金额时绝对不计入任何杠杆倍数，严格基于标的资产原始价格变动幅度与实际砍仓数量；全链路算法绝对物理锁定，严禁擅自修改！
    - **断臂求生震荡循环砍仓与回踩补仓状态机**：断臂求生实行动态循环状态机，砍仓与补仓严格交替闭环；未补仓期间严禁重复连续砍仓！
    - **震荡磨损保护熔断机制 (Strategy 5)**：启动防爆对冲后，单币累计补仓/复开达到指定次数（默认3次）后立即触发熔断，停止该币种一切自动砍仓与补仓/复开。

- **Mod 5: 统计看板与财务监控 (`/modules/finance-monitor/`, `/components/StatsPanel.tsx`)**: 
  - **UI 主面板容器**：`/modules/finance-monitor/FinanceMonitorUI.tsx`
  - **财务核心指标面板单元**：`/modules/finance-monitor/components/FinanceStatsPanel.tsx`（保证金率、钱包余额、杠杆可用额、总盈亏统计）
  - **全域操作动作面板单元**：`/modules/finance-monitor/components/GlobalActionsPanel.tsx`（一键清仓、清除流水、重置本金、模拟切换）
  - **底层财务核算状态机**：`/modules/finance-monitor/useFinanceMonitorLogic.ts`、`/modules/finance-monitor/types.ts`、`/modules/finance-monitor/index.ts`

- **Mod 6: 系统日志与历史审计 (`/modules/log-center/`, `/components/TradeLogModal.tsx`, `/components/Logs.tsx`)**: 
  - **日志中心 UI 容器**：`/modules/log-center/LogCenterUI.tsx`、`/modules/log-center/types.ts`、`/modules/log-center/index.ts`
  - **交易日志弹窗独立单元**：`/components/TradeLogModal.tsx`（单币独立时钟流水隔离、USDT单位显式标注、清除流水时间戳拦截）
  - **系统日志抽屉单元**：`/components/Logs.tsx`（高信噪比静默巡检、毫秒级 `immediate` 穿透日志展示）
  - 【特别绝对锁定 🔒】**每笔开平仓独立记录与禁止篡改绝对铁律**：每一个币的每一次交易、每一次记录都是绝对独立的！开仓必须拥有永久独立的开仓记录 (`status: 'OPEN'`)；平仓必须生成独立的平仓记录 (`status: 'CLOSED'`)，绝对严禁将原有的开仓记录篡改为平仓记录；开仓 30 秒安全缓冲保护锁；活动持仓物理隔离与日志保全；官方成交流水时间窗严格锚定；交易流水彻底清除与双重前置拦截。
  - 【特别绝对锁定 🔒】**持仓与日志“时钟”按钮单币流水绝对隔离铁律**：持仓列表与交易日志中的“时钟”按钮，严格且仅用于查询当前指定币种的所有交易记录流水；底层采用精确标准化币名锚定过滤，严禁参杂任何其他币种！
  - 【特别绝对锁定 🔒】**开平仓订单秒级定向主动抓取与双通道保全铁律**：程序向交易所发出开仓/平仓请求后，在 0ms/150ms/500ms 快速探针基础上，启动每隔 1 秒主动向交易所抓取指定币种成交记录通道（持续 5 秒），直到 WebSocket 推送确认或主动抓取对账成功立即停止；双通道互补竞速，确保任何网络延迟或丢包下成交与持仓反馈 100% 不丢失！
  - 【特别绝对锁定 🔒】**系统日志开平仓与反馈USDT单位及全量同步铁律**：所有涉及数量与价值的日志均全量同步呈现，并一律严格标注以‘USDT’为单位的数量与金额！

- **Mod 7: 智能止盈止损策略体系 (`/modules/profit-manager/`, `/services/rules/profit/`)**: 
  - **止盈策略主面板容器**：`/modules/profit-manager/ProfitManagerUI.tsx`、`/modules/profit-manager/useProfitManager.ts`、`/modules/profit-manager/types.ts`、`/modules/profit-manager/index.ts`
  - **常规止盈止损算子**：`/services/rules/profit/conventional.ts`
  - **ATR 动态波动率止盈算子**：`/services/rules/profit/atr.ts`
  - **智能移动跟踪止盈算子**：`/services/rules/profit/smart.ts`
  - **AI 智能逃顶托管算子**：`/services/rules/profit/ai.ts`
  - **全域安全底线与清仓算子**：`/services/rules/profit/global.ts`
  - **综合止盈止损路由总线**：`/services/rules/profit_loss_rules.ts`

- **Mod 8: 自动驾驶模式 (`/modules/auto-pilot/`)**: 
  - **自动驾驶 UI 容器**：`/modules/auto-pilot/AutoPilotUI.tsx`
  - **实时状态仪表盘单元**：`/modules/auto-pilot/components/LiveDashboard.tsx`
  - **配置与类型系统**：`/modules/auto-pilot/types.ts`、`/modules/auto-pilot/index.ts`

- **Mod 9: 系统配置与全域护盾 (`/components/Settings/`, `/components/SettingsPanel.tsx`)**: 
  - **设置总面板**：`/components/SettingsPanel.tsx`
  - **自动模块配置单元**：`/components/Settings/AutoModule.tsx`
  - **救世策略配置单元**：`/components/Settings/RescueModule.tsx`
  - **系统基础参数配置单元**：`/components/Settings/SystemModule.tsx`
  - **全域进程与风控防护网单元**：`/components/Settings/GlobalProcessGuard.tsx`
  - **策略规则释义弹窗单元**：`/components/Settings/StrategyRulesModal.tsx`
  - **救世策略独立表单子目录**：`/components/Settings/RescueStrategies/`

- **Mod 10: 专业图表与分析 (`/components/KlineChartModal.tsx`, `/components/SaviorLab/`)**: 
  - **专业多周期K线图表弹窗**：`/components/KlineChartModal.tsx`（多通道竞速与代理降级获取、K线与指标实时渲染）
  - **策略实验室总控**：`/components/SaviorLab.tsx`
  - **回测引擎配置单元**：`/components/SaviorLab/BacktestEngineConfig.tsx`
  - **交易DNA基因序列单元**：`/components/SaviorLab/TradeDnaList.tsx`
  - **底层回测服务**：`/services/backtestService.ts`、`/services/backtest/`

- **Mod 11: 独立业务弹窗与人机交互容器 (Modals)**: 
  - **震荡熔断警报弹窗**：`/components/FuseAlertModal.tsx`
  - **对冲历史记录弹窗**：`/components/HedgeHistoryModal.tsx`
  - **初筛矩阵可视化弹窗**：`/components/ScannerVisualizerModal.tsx`
  - **激活码授权弹窗**：`/components/ActivationModal.tsx`
  - **会员订阅弹窗**：`/components/SubscriptionModal.tsx`
  - **操作手册使用指南**：`/components/UserManualModal.tsx`
  - **源代码审计展示弹窗**：`/components/SourceCodeModal.tsx`

- **Mod 12: 高性能微渲染部件 (DOM-Bypass Micro Spans)**: 
  - **实时价格微部件**：`/components/RealtimePriceSpan.tsx`（绕过 React 全量 Diff 树，直连 PriceRegistry 毫秒级原生 DOM 刷新）
  - **实时盈亏微部件**：`/components/RealtimePnlSpan.tsx`（直连 PriceRegistry 高频毫秒级浮盈计算与颜色渲染）
  - **高精度交易时钟微部件**：`/components/RealtimeClockSpan.tsx`
  - **交易所网络质量与延迟监控**：`/components/NetworkWidget.tsx`

- **Mod 13: 核心服务与实盘引擎 (Services Core) - 【全域最高级锁定 🔒】**: 
  - **WebSocket 极速直通通道**：`/services/binanceWs.ts`（全套连接、保活、UserDataStream、订单成交推送直通解析 - 严禁擅改！）
  - **价格极速注册表**：`/services/priceRegistry.ts`（高频行情共享与 Web Worker 解耦）
  - **权威单币负债池管理器**：`/services/debtManager.ts`（幂等去重、亏损只记入一次权威核算）
  - **网络与交易所 API 代理层**：`/services/apiService.ts`、`/server.ts`
  - **高保真语音播报引擎**：`/services/audioService.ts`
  - **币种标准化与数值计算工具**：`/services/symbolUtils.ts`
  - **全系统高频缓存管理器**：`/services/cacheManager.ts`
  - **交易与计算队列调度器**：`/services/pipelineQueue.ts`
  - **市场仿真器与行情枢纽**：`/services/marketSimulator.ts`

---

### 3. 数据流边界与原子化隔离约束 (State & Data Bridge Boundaries)
- 模块间数据流只通过明确定义的只读 Props、Context 或独立事件流传递。
- 严禁模块跨边界直接篡改或污染其他模块的私有状态。
- 每个模块与子组件独立封包，任何单一改动均处于隔离原子容器内，绝不影响系统其他部分的稳定运行。
