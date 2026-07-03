# Savior Architecture Blueprint & Atomic Code Locks (原子化代码锁定蓝图)

为了确保修改各个功能时绝不互相牵连爆错，但又完全不改变现有的极速运行逻辑，整个系统已被零耦合物理切割为 14 个独立模块域，并且正式激活 **「原子化代码锁 (Atomic Code Lock)」**。

---

## 1. 核心雷达与扫描审计 (Lists 1-6) - 🔴 已锁定

每个扫描列表均采用完全独立的视图渲染器与专属状态挂钩，确保其底层过滤与状态监控互不干扰：

- **List 1 [全域底边扫描]** ➔ `/modules/market-scanner/`  + (规则：`/services/rules/list1_market.ts`)
- **List 2 [大十字星监控]** ➔ `/modules/grand-crossing/` + (规则：`/services/rules/list2_crossing.ts`)
- **List 3 [结构深度审计]** ➔ `/modules/structure-audit/` + (规则：`/services/rules/list3_structure.ts`)
- **List 4 [动能趋势审计]** ➔ `/modules/momentum-audit/` + (规则：`/services/rules/list4_momentum.ts`)
  - *高级过滤多重升级 (EMA Intersection Lock)*：已正式升级为 **「5组独立多周期降采样高级过滤限制引擎」**。该引擎自动根据用户选择的时间周期（1h/4h/1d/1w/1M/1Q）对历史1小时高低点进行科学降采样合并，并在该特定降采样K线周期上执行EMA基线交叉次数的精确物理测算与防追高限制，完美杜绝了传统单周期计算产生的横盘震荡干扰。
- **List 5 [实况战场监控]** ➔ `/modules/live-battlefield/`
- **List 6 [终极战术终端]** ➔ `/modules/tactical-command/`

---

## 2. 自动防护与智能交易模块 (Modules 1-8) - 🔴 已锁定

负责对冲挂机、止盈止损及回测环境的最小核心策略代码，逻辑层面通过消息总线与底层交易接口单向交互：

- **模块 1 [多维止盈止损]** ➔ `/modules/profit-manager/` + (执行：`/services/rules/profit_loss_rules.ts`)
- **模块 2 [强力防爆对冲]** ➔ `/modules/hedge-guardian/` + (执行：`/services/rules/hedging_rules.ts`)
- **模块 3 [盈亏平衡救赎]** ➔ `/modules/rescue-tactics/` + (执行：`/services/rules/rescue_rules.ts`)
- **模块 4 [智能挂机总控]** ➔ `/modules/auto-pilot/`
- **模块 5 [系统核心控制]** ➔ `/modules/system-core/`
- **模块 6 [新手入门引导]** ➔ `/modules/user-guide/`
- **模块 7 [高保真模拟回测]** ➔ `/modules/backtester/` + `/services/backtestService.ts`
- **模块 8 [系统性能监视]** ➔ `/modules/system-monitor/`

---

## 3. 核心账户、持仓与日志系统 - 🔴 已锁定

- **[财务显示总览]** ➔ `/modules/finance-monitor/`
  - *丝滑流线优化*：全账务统计指标采用 React `useMemo` 对多空仓位和WebSocket实时盘口数据进行按需派生，消除冗余重渲染。
- **[独立持仓监控]** ➔ `/modules/positions-list/`
  - *极致无损微更*：通过整合 `RealtimePriceSpan` 与 `RealtimePnlSpan` 采用 **「DOM Bypass」** 机制，直连 `priceRegistry` 高频更新盘面价格和盈亏，完全避开 React 虚拟 DOM 树差分比对计算，令高频更新极度丝滑。
- **[交易日志流水]** ➔ `/modules/log-center/` 与 `/components/TradeLogModal.tsx`
  - *持久沙箱化*：交易历史数据在本地存储、回测引擎与主控制器中通过事件流解耦，不影响实时监控面板。

---

## 4. 辅助高频应用模块 (K线图、网络与故障抗扰) - 🔴 已锁定

- **[K线图表模块]** ➔ `/components/KlineChartModal.tsx`
  - 拥有独立的容错机制、周期控制器与 Binance Kline 获取通道，自动剔除无效代码与黑名单币种。
- **[网络长连接核心]** ➔ `/services/binanceWs.ts` 与 `/services/priceRegistry.ts`
  - 核心行情总线。对异常符号断线重连、延迟预警和分发机制进行了全原子化隔离。
- **[故障热自愈防蓝屏拦截]** ➔ `/components/ErrorBoundary.tsx`
  - 内置顶级和局部 **ErrorBoundary 抗扰自愈层**，对偶发组件异常进行自动局部隔离和 3 秒热重启，异常日志异步持久化至 `SAVIOR_SYSTEM_MONITOR_LOGS`，确保整个前端绝不发生“蓝屏/白屏”死锁崩溃。

---

*注：原子化代码锁已经全面部署，修改其中任何一个UI模块或独立规则引擎，都不会对其它系统造成任何影响或引入级联崩溃。*
