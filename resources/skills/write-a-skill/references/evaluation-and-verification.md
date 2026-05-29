# 评估与验证

在声明某个 Skill 可靠之前，读取本文件。

## 评估立场

评估属于【社区验证实践】，并得到官方最佳实践支持，但它不是每个本地 Skill 的绝对要求。先从小评估开始，再随风险提高门槛。评估本身也有注意力成本。

## 最小可用评估

对简单 Skill，创建 2-3 个高质量检查即可：

1. **正触发**：一个应该加载或使用该载体的真实提示。
2. **负触发**：一个相似但不应该使用它的提示。
3. **可用性检查**：这个 Skill 是否让 agent 更聚焦，而不是让它先处理模板、清单和维护字段？

对高风险或共享 Skill，再增加：

- A/B 行为：比较有 Skill 与无 Skill 的输出或行动。
- 逻辑模拟：让 fresh agent 走完整工作流，并指出哪里必须猜测。
- 边界环境审查：个人/小团队、研究搜索、大型项目、生产合规分别看是否适用。
- 跨模型测试：记录测试过的模型家族。
- 跨 surface（交互面）测试：交互式聊天、CLI/headless、IDE 或 API surface。

## 检查什么

不要只检查 Skill 是否被提到。应检查：

- 完整 assistant 消息，而不是截断的流式片段。
- Agent 是否聚焦在任务本身，还是被无关清单和目录分散。
- 能证明正确载体已加载的工具调用或读取操作。
- 真实执行证据：文件变更、命令运行、校验器通过、输出产物。
- Agent 是否绕过 Skill，只读取引用文件并临时重写逻辑。
- Agent 是否伪造合规声明。

## 建议的 `evals/evals.json` 字段

只有当 eval 会被维护时，才创建 `evals/evals.json`。

推荐顶层字段：

- `skill`、`version`、`change_date`、`target_platform`、`surface`、`model`、`owner`、`review_cadence`。
- `fallback`、`deprecation_conditions`、`last_run`、`regression_result`、`cases`。

推荐用例字段：

- `id`、`prompt`、`should_use_skill`、`expected_evidence`。
- `status`: `not-run`、`pass`、`fail` 或 `mixed`。
- `evidence`: transcript 链接或简短审查证据。
- `regression`: `none`、`improved`、`worse` 或 `unknown`。

## 评估框架（harness）警告【本设计扩展】

真实用户反馈显示，一些触发评估框架（harness）可能出现假阳性或假阴性。如果评估框架结果与直接审查冲突，先相信完整 transcript 和执行证据，再调试评估框架。

## 回归规则

Skill 变更后，把新结果与已保存基线比较。如果新 Skill 提高了触发率，却降低了真实任务完成质量或注意力聚焦程度，这不是改进。
