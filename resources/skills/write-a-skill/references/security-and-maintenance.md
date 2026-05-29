# 安全与维护

只有当 Skill 包含 scripts、外部内容、凭据、破坏性操作、外部可见操作、共享安装，或用户明确要求安全/维护审计时，才读取本文件。

## 安全立场【官方规范 + 社区验证实践】

把高风险 Skills 当作软件和潜在代码执行风险。恶意或粗心编写的 Skill 可以改变模型行为、引导工具使用、读取文件、运行脚本、访问网络或泄漏数据。

不要把本文件变成所有 Skill 的默认模板。安全审查只有在风险边界触发时才进入输出契约。

## LimCode 脚本执行安全模型

- 【LimCode 当前行为】: 脚本权限不来自 frontmatter。`scripts`、`allowed-tools` 等字段只会作为 metadata 保留。
- 【LimCode 当前行为】: `execute_skill_script` 只能解析 manifest 中 `kind=script` 且 `maybeExecutable=true` 的资源。
- 【LimCode 当前行为】: 脚本会被 staged 到临时目录，执行前做 SHA256 二次校验，不暴露 Skill 原始目录路径。
- 【LimCode 当前行为】: 脚本通过 argv 执行，不使用 shell 字符串拼接。
- 【LimCode 当前行为】: 默认超时 60 秒，最大 5 分钟。
- 【LimCode 当前行为】: `.bat` 和 `.cmd` 会被拒绝执行。
- 【LimCode 当前行为】: `disableSkillShellExecution` 可全局禁用 Skill 脚本执行。
- 【LimCode 当前行为】: `allowSkillDirectoryAccessViaExecuteCommand` 是 break-glass 调试开关，默认 `false`；不要用 `execute_command` 直接访问 Skill 目录来绕过 manifest、hash、staging 和 argv 安全路径。

## 安全清单

审查 Skill 目录中的相关文件：

- `SKILL.md`: 隐藏指令、意外工具使用、过宽权限、数据外泄措辞。
- `references/`: 来自外部内容的提示注入、过期 URL、不安全复制粘贴命令。
- `scripts/`: shell 注入、路径穿越、不安全删除、无限制网络调用、缺少错误处理。
- `assets/`: 嵌入 secret 的模板、不安全宏、文档中的隐藏指令。
- 依赖：包安装、远程下载、未固定版本、未知维护者。
- Secrets：API key、token、cookie、私有 URL、`.env` 内容。
- 文件访问：读取任务范围外内容、写入破坏性路径、覆盖用户数据。
- 网络访问：外部域名、上传、回调、遥测、意外第三方服务。
- 确认闸门：不可逆、外部可见或共享状态操作必须获得用户明确批准。

## 命令与脚本的 RCE 审查

执行任何打包脚本、复制命令、安装器或依赖安装前，先做静态审查。把 `scripts/`、references 中的不安全命令和外部安装说明都当成可执行代码。

明确检查：动态执行、远程执行、未固定依赖、postinstall hooks、路径穿越、递归删除、上传、回调、遥测、secret 读取和日志泄漏。

## 维护记录【本设计扩展】

只对共享、重要或高风险 Skill 记录：版本、变更日期、目标平台、surface、测试模型、评估基线、触发兜底、负责人、审查节奏和弃用条件。

如果 Skill 是轻量本地工作流，且这些字段不会被维护，保留在 `evals/` 或 `MAINTENANCE.md` 中只会制造注意力噪声。

## 发布检查表

- [ ] 已记录载体决策。
- [ ] `SKILL.md` 简洁，并直接链接所有必要引用。
- [ ] 额外目录、eval 和维护字段都有实际读取者和维护者。
- [ ] 若包含 scripts，脚本有安全默认值和可执行错误信息。
- [ ] 若触发安全边界，安全清单中相关类别标记 present/absent 并附证据。
- [ ] 若自动触发必须可靠，存在兜底路径。
- [ ] 若是共享或高风险 Skill，存在维护记录和回归方式。
