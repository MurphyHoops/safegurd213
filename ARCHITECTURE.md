# Savior Architecture Blueprint

## 原子化模块分布 (Atomic Modules Layout)

为了确保修改各个功能时绝不互相牵连爆错，但又完全不改变现有的极速运行逻辑，整个系统已被零耦合物理切割为 14 个独立模块域。

### 核心雷达库 (Scanner Engine - Lists 1-6)
- **List 1 [全域底边扫描]** ➔ `/modules/market-scanner/`  + (逻辑算法：`/services/rules/list1_market.ts`)
- **List 2 [大十字星监控]** ➔ `/modules/grand-crossing/` + (逻辑算法：`/services/rules/list2_crossing.ts`)
- **List 3 [结构深度审计]** ➔ `/modules/structure-audit/` + (逻辑算法：`/services/rules/list3_structure.ts`)
- **List 4 [动能趋势审计]** ➔ `/modules/momentum-audit/` + (逻辑算法：`/services/rules/list4_momentum.ts`)
- **List 5 [实况战场监控]** ➔ `/modules/live-battlefield/`
- **List 6 [终极战术台]**    ➔ `/modules/tactical-command/`

### 自动防护及设置系统 (Settings & Protection - Modules 1-8)
- **模块 1 [止盈止损]**       ➔ `/modules/profit-manager/` + (执行：`/services/rules/profit_loss_rules.ts`)
- **模块 2 [防爆对冲]**       ➔ `/modules/hedge-guardian/` + (执行：`/services/rules/hedging_rules.ts`)
- **模块 3 [盈亏平衡出局]**   ➔ `/modules/rescue-tactics/` + (执行：`/services/rules/rescue_rules.ts`)
- **模块 4 [自动智能挂机]**   ➔ `/modules/auto-pilot/`
- **模块 5 [系统全局控制]**   ➔ `/modules/system-core/`
- **模块 6 [新手入门指引]**   ➔ `/modules/user-guide/`
- **模块 7 [过去历史回测]**   ➔ `/modules/backtester/`
- **模块 8 [云端日志监控]**   ➔ `/modules/system-monitor/`

### 资金面及仓位面系统
- **[财务显示总览]**          ➔ `/modules/finance-monitor/`
- **[独立持仓监控]**          ➔ `/modules/positions-list/`

---
*注：各个模块均拥有自己的隔离沙箱（View 控制器、状态处理器），并且逻辑层面均由 React Context / Event Emitter 下发，修改其中任何一个UI或独立规则引擎，都不会让其它系统崩溃。*
