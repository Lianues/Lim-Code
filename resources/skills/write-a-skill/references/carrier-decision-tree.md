# 载体决策树

当需要判断用户到底需要 Skill 还是更窄的指令载体时，读取本文件。

## 为什么需要这个文件

这是【社区验证实践】和【本设计扩展】层。真实用户反馈表明，Skill 自动触发可能不稳定，且重型模板会污染所有下游 Skill。可靠设计不是“所有东西都是 Skill”，也不是“所有 Skill 都配安全清单、评估套件和维护记录”，而是选择足够小、足够聚焦的载体。

## 决策树

1. **这条指令是否对仓库或团队长期成立？**
   - 使用 `AGENTS.md`、`CLAUDE.md` import 或 Cursor Rule。
   - 例：测试命令、包管理器、代码风格、生成文件警告。
   - 不要为一行约定创建 Skill。

2. **用户是否应该以名称手动触发它？**
   - 使用 slash command 或 saved command。
   - 例：`/release-check`、`/write-pr`、`/audit-secrets`。
   - 当用户显式调用本身就是期望的交互方式时，command 通常优于 Skill。

3. **成功是否确定且可机器验证？**
   - 使用 script、CLI、hook、linter、formatter、CI job 或权限门。
   - 例：验证 JSON schema、阻止危险 shell 命令、运行迁移校验器。
   - 如果某个命令绝不能被跳过，就把约束放在模型之外强制执行。

4. **Agent 是否需要可复用多步骤工作流和可选深层上下文？**
   - 使用 Skill。
   - 例：转换文档格式、执行领域调试流程、带引用和校验器的框架迁移。
   - 只有当引用和脚本能显著减少重复解释或幻觉时才打包它们。

5. **自动触发是否需要高可靠性？**
   - 使用 Skill，并至少配一个兜底：手动 command、hook matcher、AGENTS.md reminder 或 CLI entrypoint。
   - 兜底不是补丁，而是显式可靠性层。

6. **是否真的需要 eval、MAINTENANCE 或安全清单？**
   - 本地个人工作流：通常不需要，除非用户要求或已经出现真实失败。
   - 共享团队 Skill：建议记录版本、owner、回归方式。
   - 含 scripts、外部内容、secrets、破坏性操作或共享安装：需要安全与维护检查。
   - 如果这些材料不会在执行中被读取或维护，不要创建。

## 输出映射

| 需求 | 首选载体 | 原因 |
| --- | --- | --- |
| 短的长期规则 | AGENTS.md / Cursor Rule | 低上下文成本，无触发歧义。 |
| 显式重复提示 | Command | 用户调用是确定性的。 |
| 脆弱操作 | Script / CLI / hook | 确定且可测试。 |
| 复杂可复用工作流 | Skill | 支持渐进披露。 |
| 高风险自动化 | Skill + deterministic guardrail | 概率性指导叠加确定性护栏。 |

## 危险信号

- Skill 正文只有一两条规则。
- 用户期望显式控制时，却把 command 藏进自动触发 Skill。
- 为了“完整”创建不会被读取或维护的目录。
- “God Skill” 覆盖多个无关领域并与所有 Skill 竞争触发。
