# Skill 结构剖析

编写或审查 Skill 结构时，读取本文件。

## Frontmatter 要求

```yaml
---
name: example-skill
description: 创建一个精确的可复用工作流。Use when the user asks for the exact workflow this Skill owns.
---
```

### LimCode 当前硬规则

- 【LimCode 当前行为】: 每个 Skill 目录下必须有 `SKILL.md`，否则扫描时跳过该目录。
- 【LimCode 当前行为】: `SKILL.md` 必须以合法 YAML frontmatter 开头；frontmatter 不是 mapping、未闭合或 YAML 解析失败时，Skill 会产生 fatal 诊断并跳过加载。
- 【LimCode 当前行为】: `name` 必须存在、必须是字符串、必须精确匹配父目录名。
- 【LimCode 当前行为】: `name` 只能使用小写字母、数字和连字符，长度 1-64 字符，不能以连字符开头或结尾，不能包含连续连字符 `--`。
- 【LimCode 当前行为】: `description` 必须存在且非空。LimCode 本地代码当前不强制 1024 字符上限，但工具声明会折叠空白并截断展示。
- 【LimCode 当前行为】: `version`、`allowed-tools`、`triggers`、`scripts`、`user-invokable`、`disable-model-invocation`、`argument-hint`、`context` 等额外 frontmatter 字段会作为 metadata 保留，不控制 discovery、tool permissions 或 script execution。
- 【跨平台参考】: Agent Skills / VS Code 可能支持更多 frontmatter 字段；写 LimCode Skill 时必须把这些字段标为兼容 metadata，不能写成 LimCode 当前运行时能力。

## 推荐的 SKILL.md 章节

```md
# Skill 名称

## 操作原则
[一句话定义不变量。]

## 工作流
1. [步骤]
2. [步骤]
3. [步骤]

## 验证
- [证明成功的证据]

## 反合理化
| 借口 | 修正 |
| --- | --- |
| ... | ... |

## 资源
- `references/example.md`: 何时读取它。
```

## 渐进披露规则

### 官方基线

- 保持 `SKILL.md` 简洁。
- 把详细、条件性或低频材料移到支持文件。
- 从 `SKILL.md` 引用支持文件，让 agent 知道何时加载。

### 本地更严格质量门槛

- 默认保持 `SKILL.md <= 100 行`。
- 引用文件从 `SKILL.md` 一跳直达。
- 本地引用文件超过 100 行时添加目录。
- 不要“以防万一”创建空目录。

## 资源目录

| 目录 | 来源层级 | 何时创建 | 不要用于 |
| --- | --- | --- | --- |
| `references/` | LimCode 当前行为 / 官方基线 | 深层指南、示例、schema、故障排查 | 泛泛的人类 README 内容 |
| `scripts/` | LimCode 当前行为 / 官方基线 | 确定性、脆弱或重复工作 | 长期应用库代码 |
| `assets/` | LimCode 当前行为 / 官方基线 | 模板和静态输出资源 | agent 永远不会使用的材料 |
| `evals/` | 本设计扩展 / 开发期材料 | 需要维护的开发期评估 | 运行时指令或官方必需 Skill 内容 |

### LimCode 资源清单行为

- 【LimCode 当前行为】: 资源 manifest 会自动包含 `SKILL.md` 正文中的 Markdown 链接，并自动扫描 `scripts/`、`references/`、`assets/` 三个目录。
- 【LimCode 当前行为】: manifest 最多 200 项，单个资源最大 5 MB。
- 【LimCode 当前行为】: dotfile、敏感文件、超限文件和不安全路径会被排除。
- 【LimCode 当前行为】: `read_skill_resource` 只能读取 manifest 中 `textReadable=true` 的文本资源。
- 【LimCode 当前行为】: `execute_skill_script` 只能执行 manifest 中 `kind=script` 且 `maybeExecutable=true` 的脚本候选；执行权限不来自 frontmatter。

## 写作风格

- 写给正在执行任务的 agent，不是写给随便浏览的人。
- 优先使用直接动词：运行、读取、比较、验证。
- 提供默认路径；除非区别重要，不要列出许多等价选项。
- 禁止事项后面必须给出替代做法。
- 用可观察检查替代模糊质量词。

## 常见反模式

- 模糊描述：“Helps with coding.”
- 触发规则只写在正文里，模型加载前看不到。
- 把大型内联示例塞进正文，而不是放入引用文件。
- 隐式依赖另一个 Skill 先加载。
- 会修改文件、执行命令或产生用户可见输出的工作流没有验证步骤。
- 把外部平台字段写成 LimCode 当前运行时能力，例如声称 `allowed-tools` 会限制 LimCode 工具权限。
