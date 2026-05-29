# AGENTS.md

## Skill 编写兜底入口

这个文件用于弥补 Skill 自动触发可能不稳定的问题。它只为 Skill 编写任务提供窄范围兜底，不改变普通仓库工作流。

当用户要求创建、改进、审查、测试、打包或维护 agent Skill，或可复用 agent 工作流时，先读取 `.limcode/skills/write-a-skill/SKILL.md`。如果项目级内容不存在，再询问用户是否使用用户级 `write-a-skill` Skill。

除非用户明确在处理 agent Skills、commands、hooks、rules、AGENTS.md 指南或可复用 agent 工作流，否则不要把这个兜底规则用于普通编码任务、文档编辑或仓库维护。

## Subagents 使用兜底入口

当用户要求“使用 Agents / subagents / 多个 Agent / 并行 Agent / 让多个 Agent 分别审查 / 对抗性审查 / 集群搜索 / 集群处理项目”时，先读取 `.limcode/skills/using-subagents/SKILL.md`。如果项目级内容不存在，再询问用户是否使用用户级 `using-subagents` Skill。

不要把这个兜底规则用于简单单步任务、普通代码审查或单 Agent 可完成的审查。只有当任务需要独立上下文、并行调查、对抗性审查、多角色视角或大范围项目分片处理时，才使用 subagents。
