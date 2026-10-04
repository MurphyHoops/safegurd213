# System Protection & Atomic Code Lock Directive

> **STRICT COMPLIANCE FOR ALL FUTURE TURNS**:
> 1. **未授权绝不触碰**：没有用户下达明确指令要修改或增加的地方，绝对不触碰、不篡改、不优化、不重构。
> 2. **跨模块/联动修改先请示确认**：如果因为代码或业务逻辑需要涉及其它地方增加或修改内容的，**必须先明确向用户提示说明原因与影响，待用户明确确认后，方可进行修改**。严禁擅自做主！
> 3. All functional modules are decoupled into atomic units. 
> DO NOT touch, refactor, reorganize, or alter any module, service, rule, or UI unless explicitly instructed by the user in the prompt.
> Unrequested modifications are strictly prohibited.
> 
> 🔒 **Special Permanent Lock - List 1 & Market Selection List & Rescue Tactics**:
> 1. **List 1 过滤规则**（包含：行情启动趋势底池扫描、横盘蓄势过滤、回溯周期过滤的计算逻辑与流转链条）已完全固化锁定。
> 2. **市场初筛列表删减/差量更新规则**（包含：根据最后一项开启规则执行对比、永不清零、纯差量对比增删 Diff 机制）已完全固化锁定。
> 3. **断臂求生与对冲解套清仓/续航/复开规则 (Strategy 2 & Strategy 4)**：
>    - 必须且仅当【原主仓自身盈利解套 (mainPnL > 0 且 mainPnL >= hedgePnL)】时，才执行“只清对冲、主仓续航”；
>    - 若为【对冲单盈利解套 (hedgePnL > 0)】，必须强制执行双向同时全平清仓（closePair），并在开启原仓复开时执行原仓位初始方向完全复开；
>    - 该多空双向对冲解套核心流转逻辑已完全固化锁定。
> 4. **网络功能与资源泄露自检铁律 (Network Resource Leak Defense)**：
>    - 凡涉及网络连接、WebSocket 推流、K线静默预热、Web Worker 消息通道、定时轮询或事件监听器的修改，**修改后必须强制自检资源生命周期**；
>    - 必须具备：严格的订阅与预热去重锁（杜绝高频重复发起网络请求）、跨线程消息合并节流（杜绝海量对象深拷贝）、及时的连接/定时器/监听器清理注销机制，确保内存常驻平稳，彻底杜绝任何资源与内存泄漏！
> 5. **执行铁律**：后续任何对话或任务中，若没有用户针对这些部分下达明确的专属修改指令，绝对严禁擅自修改、重构或变动其任何代码与逻辑！
