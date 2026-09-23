# AI Agent 运行与代码安全准则 (Code Lock & Atomic Discipline)

> ⚠️ **最高执行指令 (Strict Directive)**:
> 严禁在未被用户明确要求修改的任何文件、函数、算法或界面中进行无授权重构、优化、删除或篡改。
> 整个系统已完成原子化解耦与锁定，每个原子模块均为独立责任单元。

---

## 1. 原子化单元与代码锁定机制 (Code Lock Boundaries)

所有功能模块、底层策略规则与服务均具备严格的原子边界。修改其中任何一个单元时，**严禁越界改动其他单元**：

| 模块单元 (Atomic Unit) | 物理路径 (Path) | 锁定级别 | 责任范围 |
| :--- | :--- | :--- | :--- |
| **List 1 [全域底边扫描 & 过滤规则]** | `modules/market-scanner/`<br>`services/rules/list1_market.ts`<br>`modules/market-scanner/components/StartTrendPoolBox.tsx` | 🔴 LOCKED | 行情启动趋势、横盘蓄势、回溯周期等全部过滤算法与流转规则（严禁擅自修改） |
| **市场初筛列表 [增删/差量更新机制]** | `modules/market-scanner/components/List1_Selection.tsx`<br>`modules/market-scanner/useScannerLogic.ts` | 🔴 LOCKED | 最后一项过滤完成后的差量对比、永不清零、精准增删同步机制（严禁擅自修改） |
| **List 2 [大十字星监控]** | `modules/grand-crossing/`<br>`services/rules/list2_crossing.ts` | 🔴 LOCKED | 大十字星 K 线特征与极值监控 |
| **List 3 [结构深度审计]** | `modules/structure-audit/`<br>`services/rules/list3_structure.ts` | 🔴 LOCKED | 支撑阻力与市场结构多周期审计 |
| **List 4 [动能趋势审计]** | `modules/momentum-audit/`<br>`services/rules/list4_momentum.ts` | 🔴 LOCKED | EMA交叉过滤与多周期动能趋势算法 |
| **List 5 [实况战场监控]** | `modules/live-battlefield/` | 🔴 LOCKED | 盘面持仓雷达与多空强弱实况看板 |
| **List 6 [终极战术终端]** | `modules/tactical-command/` | 🔴 LOCKED | 战术执行与手动策略指令控制 |
| **模块 1 [多维止盈止损]** | `modules/profit-manager/`<br>`services/rules/profit_loss_rules.ts` | 🔴 LOCKED | 智能止盈、ATR追踪止盈、常规止损 |
| **模块 2 [强力防爆对冲]** | `modules/hedge-guardian/`<br>`services/rules/hedging_rules.ts` | 🔴 LOCKED | 双向防爆对冲触发、开平对冲单核心算法 |
| **模块 3 [盈亏平衡救赎]** | `modules/rescue-tactics/`<br>`services/rules/rescue_rules.ts` | 🔴 LOCKED | 浮亏救赎、断臂求生、对冲盈利清仓算法 |
| **模块 4 [智能挂机总控]** | `modules/auto-pilot/` | 🔴 LOCKED | 全自动策略调度与启停总开关 |
| **模块 5 [系统核心控制]** | `modules/system-core/` | 🔴 LOCKED | API Key、网络代理、全局语音与黑名单配置 |
| **模块 6 [新手入门引导]** | `modules/user-guide/` | 🔴 LOCKED | 操作指南、指标术语说明与新手帮助 |
| **模块 7 [高保真模拟回测]** | `modules/backtester/`<br>`services/backtestService.ts` | 🔴 LOCKED | 历史K线下载与多策略历史回测引擎 |
| **模块 8 [系统性能监视]** | `modules/system-monitor/` | 🔴 LOCKED | 实时内存、吞吐率、WS连接延迟与健康监控 |
| **持仓管理中心** | `modules/positions-list/` | 🔴 LOCKED | 实时持仓列表、对冲状态展示、快捷平仓操作 |
| **行情分发与注册中心** | `services/binanceWs.ts`<br>`services/priceRegistry.ts` | 🔴 LOCKED | WebSocket行情长连接、DOM Bypass价格高速订阅 |
| **模拟器与实盘内核** | `services/marketSimulator.ts`<br>`server.ts` | 🔴 LOCKED | 交易撮合、对冲补仓配对、币安实盘API桥接 |

---

## 2. 变更行为法则 (Rules of Engagement)

1. **精准定位 (Surgical Scope)**: 每次仅针对用户在 Prompt 中明确指出的功能或文件进行针对性变更，绝对禁止对未提及的代码进行“顺带重构”或“清理优化”。
2. **锁标记识别 (@LOCKED)**: 遇到带有 `// @LOCKED` 或 `// 🔒 LOCKED_MODULE` 标记的类、函数或文件时，在未获用户直接指令前，原样保留其既有业务逻辑与数据流。
3. **回归验证 (Compile Check)**: 任何编辑必须通过 `compile_applet` 静态编译检查，确保系统整体一致性与稳定性。
