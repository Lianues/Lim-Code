---
name: using-subagents
description: 指导如何可靠使用 subagents、多个 Agents、并行 Agent 审查、集群搜索和项目分片处理。当用户要求使用 Agents/SubAgents、并行 Agent、对抗审查、多角色审查、集群搜索、项目分片处理，或明确说出“进入agents approve迭代模式”时使用。
---

# 使用 Subagents

## 背景知识

SubAgent 是无状态的：每一次调用的 SubAgent 都是无状态且独立的。它不会继承主 Agent 的聊天记录、主 Agent 已读过的 Skill、其他 Agent 的输出、上一轮结论，也不会知道主 Agent 脑中的计划。

中央数据库 / 共享信息库是同一概念：使用多个 SubAgents、多轮复核、审批、阻断项收敛或任何需要共享状态的任务时，公共事实、决策、阻断项、修订结果、审批结论必须写进外部位置，不能只留在聊天里。例如 `docs/pm/{对应session主题名}/`。

Skill 资源遵循渐进披露：先读取 Skill 主体；当 Skill 主体或任务需要引用附属资料时，再按 `read_skill` 返回的 resources manifest，用 `read_skill_resource` 按需读取 `textReadable=true` 的相关资源。不要无条件读取所有 resources。

集群并行调用 SubAgents 的方法：并行应该在单轮输出中同时调用多次 SubAgents 工具，禁止分轮次调用，除非一个 SubAgent 的输入信息依赖另一个 SubAgent 的输出。

## 调用前门禁

调用任何 SubAgent 之前，主 Agent 必须先判断任务类型。

### 一次性简单任务

如果任务不依赖上一轮结论、不依赖其他 SubAgent 输出、不需要审批收敛，也不需要后续复核，可以直接在 prompt/context 中完整写入目标、背景、约束、范围、输出格式和成功标准。

### 必须使用中央数据库的任务

只要满足以下任一条件，必须先建立或引用中央数据库 / 共享信息库，不允许只靠 prompt 摘要：

- 用户要求使用多个 Agents、SubAgents、并行 Agent、对抗性审查、多角色审查或集群处理。
- 任务出现“第一轮”“第二轮”“上一轮”“复核”“审批”“阻断项”“修订后”“Approve/Blocker 收敛”等语义。
- 需要多个 SubAgents 共享事实或接力。
- 需要后续 SubAgent 继承前一轮结论。
- 需要记录采纳、拒绝、阻断项、验证结果或最终决策。
- 任务会跨多次工具调用、多个 Agent 或多次对话轮次。

中央数据库推荐放在 `docs/pm/{task-name}/`，至少包含：

- `README.md`：索引和文件用途。
- `MASTER_CONTEXT.md`：长期背景、目标、术语、边界和硬约束。
- `STATUS.md`：当前阶段、已完成项、阻断项和下一步。
- `DECISIONS.md`：已采纳/拒绝的关键决策和理由。
- `reports/`：每个 SubAgent 的调研、审查、审批、复核报告。

### Agents Approve 迭代模式

当用户明确说出 `进入agents approve迭代模式`、`进入 agents approve 迭代模式` 或等价表达时，主 Agent 必须进入多 Agent 审批迭代流程。该模式不是普通并行审查，而是一个以 `APPROVE` / `BLOCKER` / `CONCERN` / `NEEDS_INFO` 为结论类型的闭环。

进入该模式后，主 Agent 必须：

1. 建立或引用中央数据库 / 共享信息库。
2. 将目标、长期背景、被审对象、通过标准、阻断标准、当前阶段和报告写入位置写入共享信息库。
3. 并行派发多个 SubAgent 进行独立审查；每个 SubAgent 的 prompt 都必须自包含，或明确要求读取共享信息库中的指定文件。
4. 汇总每个 SubAgent 的结论、证据、阻断项、关注项和缺失信息。
5. 对确认采纳的阻断项进行修订，并把采纳 / 拒绝理由、修订摘要和验证结果回写共享信息库。
6. 再次派发定向复核 SubAgent，直到没有阻断项、用户停止，或主 Agent 判断必须由用户作出产品、架构、安全或取舍决策。

本模式必须强制执行“SubAgent 无状态”这一全局不变量。当然，无论是否进入该模式，SubAgent 都不会自动继承聊天记录、主 Agent 记忆、上一轮结论或其他 SubAgent 输出；本模式只是把这条全局规则用于审批迭代场景，并要求每一轮的阻断项、修订摘要、审批结论和证据路径都回写到中央数据库 / 共享信息库。

### 复核和审批强制字段

二轮或后续复核、审批、阻断项收敛的 prompt 必须包含或引用以下内容；缺一项时不得派发 SubAgent：

1. 中央数据库 / 共享信息库路径。
2. SubAgent 开始前必须读取的文件列表。
3. 上一轮报告路径。
4. 上一轮完整问题清单，每个问题都要有证据路径、行号或来源。
5. 本轮修订摘要，并逐条对应上一轮问题。
6. 被复核对象路径。
7. 期望验证点。
8. 通过标准和仍然阻断的判定标准。
9. 输出格式和报告写入位置。
10. 缺失检查规则：如果无法读取中央数据库、上一轮报告或修订摘要，必须输出 `REJECT: 缺少复核上下文`，不得猜测。

### Skill 驱动任务强制规则

如果 SubAgent 任务依赖某个 Skill，主 Agent 必须执行以下二选一：

1. 主 Agent 先调用 `read_skill`，再按需调用 `read_skill_resource` 读取相关资源，并把必要 Skill 规则和资源摘要写入 SubAgent prompt/context。
2. 在 SubAgent prompt 中明确要求 SubAgent 自己调用 `read_skill`，再按 resources manifest 按需调用 `read_skill_resource`。

禁止只写“参考某 Skill”“继续 Skill 的要求”或“按上面的 Skill 做”。SubAgent 不会自动继承主 Agent 已读过的 Skill。

## 不变量

**硬约束：所有 SubAgents 都必须被视为无状态、独立上下文的执行单元。** 除当前 prompt 明确写入的内容，或 prompt 明确要求读取的共享信息库文件外，SubAgent 看不到主 Agent 聊天记录、上一轮结果、其他 SubAgent 输出、主 Agent 已读 Skill、隐含项目背景或主 Agent 脑中的计划。

SubAgent 无状态不是 `Agents Approve 迭代模式` 的特殊规则，而是所有 SubAgent 调用的不变量。凡是需要跨 Agent、跨轮次、跨复核阶段或跨对话继承的信息，都必须写入 prompt 或中央数据库 / 共享信息库，禁止依赖聊天记录、主 Agent 记忆或上一轮隐含上下文。

主 Agent 的职责不是给 SubAgent 做权限管理，而是分配注意力：让每个 SubAgent 聚焦什么、忽略什么、产出什么，并把结论汇总成可执行决策。

## 工作流

1. **判断是否值得并行**。
   - 适合：多方向搜索、大项目分片、独立复核、对抗性审查、多角色视角、长任务并行产出。
   - 不适合：单文件小改、明确答案、普通单 Agent 代码审查、需要一个连续状态机的任务。
   - 说清切分维度：按来源、模块、文件集合、角色、风险面还是任务阶段。

2. **显式外化共享上下文，并维护中央数据库 / 共享信息库**。
   - 多个 SubAgent 共用的事实，必须写进中央数据库，例如 `docs/pm/` 模式的信息库、设计文档、任务清单、状态文件或报告目录。
   - 中央数据库是外部输入源，不是 SubAgent 记忆；prompt 必须明确要求 SubAgent 读取哪些文件。
   - 主 Agent 负责维护这套信息库：新事实、决策、阻断项、修订结果和复核结论都要回写，不能只留在聊天记录里。
   - 一次性简单任务可以不写文件，但必须在每个 prompt 中完整写入目标、背景、约束、范围、输出格式和成功标准。
   - 如果任务提到“第一轮”“上一轮”“阻断项”“修订后”“复核”，必须列出上一轮结论、阻断项、修订内容和被审文件路径，或指向包含这些内容的上下文文件。
   - 禁止在 SubAgent prompt 中使用相对指代，包括但不限于：“如上”“继续刚才”“上一轮问题”“参考另一个 Agent 的结论”“只审查第一轮阻断问题”。
   - 共享信息库组织方式见 `references/shared-context-store.md`。

3. **选择注意力切分模式**。
   - 集群搜索：按来源、关键词、语言、证据类型或立场拆分。见 `references/cluster-search.md`。
   - 集群处理项目：按模块、文件集合、架构层、风险面或任务阶段拆分。见 `references/cluster-project-work.md`。
   - 对抗性审查：让 SubAgent 独立寻找反例、阻断点、证据缺口和替代设计。见 `references/adversarial-review.md`。
   - 多角色视角：产品、架构、安全、测试、性能、维护者等角色分别审查。见 `references/multi-role-review.md`。

4. **写自包含 prompt**。
   - 因为 SubAgent 没有任何外部记忆，每个 prompt 是它唯一的信息来源。
   - 每个 prompt 包含：任务、背景、输入范围、输出产物、证据要求、完成标准。
   - 若涉及修改，写清文件边界、预期行为、测试要求和冲突规则。
   - 若涉及搜索，写清问题域、关键词、技术约束、排除范围和判断标准。
   - 若涉及复核，必须包含或引用：被复核对象路径、上一轮完整问题清单、每个问题的修订摘要、期望验证点、通过/阻断标准和输出格式；缺少任一项时不得派发 SubAgent。
   - 需要模板时读取 `references/prompt-patterns.md`。

5. **并行隔离，汇总复核**。
   - 第一轮保持独立：不要让一个 SubAgent 的输出污染另一个。
   - 第二轮可以共享阻断点和修正内容，用于定向复核；必须由主 Agent 把上一轮结论、阻断点、修订摘要和证据路径逐条写入新 prompt，SubAgent 不会自动记得上一轮。
   - 主 Agent 负责汇总共识、冲突、证据强度、采纳/拒绝理由、最终修改和验证。

## 输出契约

使用 SubAgents 后，主 Agent 汇报：切分维度、每个 SubAgent 获得上下文的方式（prompt 内嵌 / 引用文件 / 共享信息库路径）、共享信息库更新位置、每个 SubAgent 的任务和结论、证据、冲突点、采纳/拒绝理由、最终修改、验证结果、未验证点。

## 反合理化

| 借口 | 修正 |
| --- | --- |
| “SubAgent 会知道上下文。” | 不会。把上下文写进 prompt 或文件。 |
| “主 Agent 聊天记录里有方案，SubAgent 自然看得见。” | 看不见。每个 SubAgent 只看到自己的 prompt、context、工具结果和被要求读取的文件；主 Agent 脑中的计划不写出来就等于不存在。 |
| “主 Agent 已经读过 Skill，SubAgent 会照着做。” | 不会。把必要 Skill 规则写进 prompt/context，或要求 SubAgent 自己调用 `read_skill` 和 `read_skill_resource`。 |
| “第二轮/复核 Agent 会自动知道第一轮。” | 不会。必须逐条提供上一轮结论、阻断项、修订摘要和证据路径。 |
| “多叫几个 Agent 就更可靠。” | 只有独立切分、证据要求和复核闭环才提高可靠性。 |
| “一个 Agent 已经 Approve。” | 关键结论至少需要独立视角复核。 |
| “让 SubAgent 直接改就快。” | 可以，但要明确文件边界、预期行为、测试要求、合并协议和复核方式。 |
