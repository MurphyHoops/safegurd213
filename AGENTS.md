# AI Agent 运行与代码安全准则 (Code Lock & Atomic Discipline)

> ⚠️ **最高执行铁律 (Supreme Operational Rule)**:
> 1. **未授权绝不触碰**：没有用户下达明确指令要修改或增加的地方，绝对不触碰、不篡改、不优化、不重构。
> 2. **跨模块/联动修改先请示确认**：如果因为代码或业务逻辑需要涉及其它地方增加或修改内容的，**必须先明确向用户提示说明原因与影响，待用户明确确认后，方可进行修改**。严禁擅自做主！
> 3. **杠杆倍数计算铁律**：整个系统在计算关于杠杆倍数时，除了几条统计栏里可用余额要接入杠杆倍数计算，其它任何盈亏比例，止盈止损算法，按实际比例（价格真实变动百分比）计算，一律不接入杠杆倍数计算。
> 4. 整个系统已完成原子化解耦与锁定，每个原子模块均为独立责任单元。

---

## 1. 原子化单元与代码锁定机制 (Code Lock Boundaries)

所有功能模块、底层策略规则与服务均具备严格的原子边界。修改其中任何一个单元时，**严禁越界改动其他单元**：

| 模块单元 (Atomic Unit) | 物理路径 (Path) | 锁定级别 | 责任范围 |
| :--- | :--- | :--- | :--- |
| **List 1 [全域底边扫描 & 过滤规则]** | `modules/market-scanner/`<br>`services/rules/list1_market.ts`<br>`modules/market-scanner/components/StartTrendPoolBox.tsx` | 🔴 LOCKED | 行情启动趋势、横盘蓄势、回溯周期等全部过滤算法与流转规则（严禁擅自修改） |
| **List 1 [配置A 常规模式全套规则与代码]** | `modules/market-scanner/components/FilterSection.tsx`<br>`modules/market-scanner/components/VolumePoolBox.tsx`<br>`services/volume8amService.ts`<br>`services/rules/list1_market.ts` | 🔴 LOCKED | 24H成交额区间校验、早上8点起成交额独立开关门禁判定、超大数值防呆容错、涨跌幅过滤、常规模式放行底池等所有运行规则与代码（绝对固化锁定，无指令严禁触碰修改） |
| **市场初筛列表 [增删/差量更新机制]** | `modules/market-scanner/components/List1_Selection.tsx`<br>`modules/market-scanner/useScannerLogic.ts` | 🔴 LOCKED | 最后一项过滤完成后的差量对比、永不清零、精准增删同步机制（严禁擅自修改） |
| **List 2 [大十字星监控 & 均线发散规则]** | `modules/grand-crossing/`<br>`services/rules/list2_crossing.ts` | 🔴 LOCKED | 大十字星 K 线特征与极值监控、EMA10/20/30/40均线发散形态、同向K线收盘确立信号K线、信号存续访问过去K线范围核验、发散回溯穿越、发散起爆原点锁定与老旧发散淘汰门禁、列表2至列表3方向过滤强行门禁与周期信号原子净化等全部发散规则与代码（严禁擅自修改） |
| **List 3 [结构深度审计 & 过滤规则]** | `modules/structure-audit/`<br>`services/rules/list3_structure.ts` | 🔴 LOCKED | 支撑阻力、严格趋势、同色交叉、波幅审计、RSI动能、时空共振等全部结构深度审计功能与代码（严禁擅自修改） |
| **List 4 [动能趋势审计 & 高级过滤]** | `modules/momentum-audit/`<br>`services/rules/list4_momentum.ts`<br>`services/rules/list3_structure.ts` | 🔴 LOCKED | 进攻突破线、中轴防守、前NK突破门禁、突破偏离拦截、5K爆发推进（234/345/456连续3根组合、做多涨幅/做空跌幅阈值调节与熔断）、防追高熔断、动态方向锁、5组多周期EMA高级过滤（已全面固化锁定，严禁擅自修改/增删） |
| **List 5 [实况战场监控]** | `modules/live-battlefield/` | 🔴 LOCKED | 盘面持仓雷达与多空强弱实况看板 |
| **List 6 [终极战术终端]** | `modules/tactical-command/` | 🔴 LOCKED | 战术执行与手动策略指令控制 |
| **模块 1 [多维止盈止损]** | `modules/profit-manager/`<br>`services/rules/profit_loss_rules.ts`<br>`services/rules/profit/conventional.ts` | 🔴 LOCKED | 智能止盈、ATR追踪止盈、常规止损、多级阶梯式变量保底平仓算法与配置（严禁擅自修改） |
| **模块 2 [强力防爆对冲]** | `modules/hedge-guardian/`<br>`services/rules/hedging_rules.ts` | 🔴 LOCKED | 双向防爆对冲触发、开平对冲单核心算法 |
| **模块 3 [盈亏平衡救赎]** | `modules/rescue-tactics/`<br>`services/rules/rescue_rules.ts`<br>`services/rules/rescue/strategy2_hedgeProfit.ts`<br>`services/rules/rescue/strategy4_amputation.ts` | 🔴 LOCKED | 浮亏救赎、断臂求生、对冲盈利清仓算法、主仓盈利续航与对冲盈利双向全平完全复开流转铁律（严禁擅自修改） |
| **模块 4 [智能挂机总控]** | `modules/auto-pilot/` | 🔴 LOCKED | 全自动策略调度与启停总开关 |
| **模块 5 [系统核心控制]** | `modules/system-core/` | 🔴 LOCKED | API Key、网络代理、全局语音与黑名单配置 |
| **模块 6 [新手入门引导]** | `modules/user-guide/` | 🔴 LOCKED | 操作指南、指标术语说明与新手帮助 |
| **模块 7 [高保真模拟回测]** | `modules/backtester/`<br>`services/backtestService.ts` | 🔴 LOCKED | 历史K线下载与多策略历史回测引擎 |
| **模块 8 [系统性能监视]** | `modules/system-monitor/` | 🔴 LOCKED | 实时内存、吞吐率、WS连接延迟与健康监控 |
| **持仓管理中心** | `modules/positions-list/` | 🔴 LOCKED | 实时持仓列表、对冲状态展示、快捷平仓操作 |
| **行情分发与注册中心** | `services/binanceWs.ts`<br>`services/priceRegistry.ts` | 🔴 LOCKED | WebSocket行情长连接、DOM Bypass价格高速订阅 |
| **网络请求限速与熔断引擎** | `services/apiService.ts`<br>`services/binanceRateLimiter.ts` | 🔴 LOCKED | 全局并发信号量、令牌桶限速器、LRU缓存、Inflight去重、429全局熔断与权重监控引擎（绝对固化锁定，无指令严禁触碰修改） |
| **模拟器与实盘内核** | `services/marketSimulator.ts`<br>`server.ts` | 🔴 LOCKED | 交易撮合、对冲补仓配对、币安实盘API桥接 |

---

## 2. 变更行为法则 (Rules of Engagement)

1. **精准定位 (Surgical Scope)**: 每次仅针对用户在 Prompt 中明确指出的功能或文件进行针对性变更，绝对禁止对未提及的代码进行“顺带重构”或“清理优化”。
2. **锁标记识别 (@LOCKED)**: 遇到带有 `// @LOCKED` 或 `// 🔒 LOCKED_MODULE` 标记的类、函数或文件时，在未获用户直接指令前，原样保留其既有业务逻辑与数据流。
3. **回归验证 (Compile Check)**: 任何编辑必须通过 `compile_applet` 静态编译检查，确保系统整体一致性与稳定性。

---

# AI 核心工程与重构执行契约 (AI Engineering & Refactoring Protocol)

在进行任何代码修改、Bug 修复或功能迭代时，必须无条件遵循以下工程准则：

## 一、 根因定位准则（严禁“治标不治本”）

1. **禁止打创可贴式补丁**：
   - 严禁使用 `try-catch` 直接生吞未知异常来伪造“程序正常”。
   - 严禁通过 `setTimeout` / `nextTick` 强行掩盖状态竞争或异步生命周期缺陷。
   - 严禁使用 `any`、类型断言 (`as unknown`)、`@ts-ignore` 规避类型检查。
   - 严禁在界面上用硬编码偏移量（如随机加 `margin-top: -12px`）掩盖父级容器布局紊乱。
2. **溯源分析（Root Cause Analysis）**：
   - 在给出代码前，必须深入至底层生命周期、状态机流转、网络套接字状态或数据结构层面，指出问题发生的最底层物理节点与逻辑断点。
   - 必须解释：**为什么之前的状态会导致异常？本次修复从哪个系统层级（架构/生命周期/契约定义）将其彻底根治？**

---

## 二、 全链路联动修改契约（严禁“改头不顾尾”）

任何模块的改动都不得作为孤立事件处理，必须执行**“涟漪效应分析（Ripple Effect Analysis）”**：

1. **接口与签名契约**：
   - 修改函数签名、入参、返回值或异步属性（Promise）时，必须同步检索并修改**全项目内所有的调用方（Callers）**。
2. **数据流与类型同步**：
   - 更改后端返回结构、数据模型（Schema/Interface）或状态定义时，必须同步更新：
     - TypeScript 接口定义 (`types.ts`)
     - 校验逻辑（Zod / Joi / 业务校验器）
     - 前端消费此字段的所有组件与 Hook
     - 持久化落盘/数据库结构或迁移脚本
3. **Electron / 多进程 IPC 边界**：
   - 修改主进程（Main Process）逻辑时，必须同步检查渲染进程（Renderer）的 `preload.js` 暴露接口、IPC 通信信道命名（`ipcMain.handle` / `ipcRenderer.invoke`）与上下文隔离配置。
4. **副作用与生命周期销毁**：
   - 新增或修改任何定时器、事件监听器、WebSocket 订阅或系统句柄时，必须在对应销毁生命周期（`useEffect` cleanup / `destroy()` / `app.on('will-quit')`）中显式释放，杜绝内存泄漏与僵尸回调。

---

## 三、 功能完备与防退化规范（严禁“破坏既有能力”）

1. **现有功能零破损（Zero Regression）**：
   - 解决当前问题的同时，严禁删除、绕过或弱化系统已有的兜底防护、日志埋点、超时重试与风控检查。
2. **完整交付，拒绝假代码**：
   - 交付的代码必须是**语法完整、逻辑闭环的可运行代码**。
   - 严禁出现 `// ... 原有代码保持不变`、`// ... 其余逻辑自行补充` 等截断占位符，若文件较长，必须精准指明替换的具体函数上下文和完整的代码段。
3. **保持既有架构风格**：
   - 严格延续当前项目的命名规范、代码风格、错误码标准与目录规范，禁止随意引入风格冲突的设计模式。

---

## 四、 强制回复格式模板

每次在执行修改前，你的回复必须严格包含以下 3 个结构化步骤：

### 1. 深度根因诊断与方案声明
- **根本原因**：[指出导致该问题的最底层设计缺陷/生命周期冲突/逻辑断点]
- **彻底根治方案**：[说明本次从哪个层级彻底重构/修正该机制]

### 2. 联动影响面清单（Impact & Linkage Checklist）
- **直接修改文件**：`路径/文件名` -> [核心修改点]
- **受影响且必须同步修改的依赖**：
  - `调用方或类型文件路径` -> [同步调整方案]
  - `前端/后端/IPC 关联点` -> [契约对齐方案]
- **潜在副作用评估**：[说明是否引入额外资源占用、网络消耗或时序变动]

### 3. 完整交付代码
[输出修改后可直接编译/运行的代码，附带清晰的关键逻辑注释]
