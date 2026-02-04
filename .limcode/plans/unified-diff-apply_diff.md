## 需求澄清（以本次为准）
1. **AI 输出 / 工具参数**：必须是 unified diff format（`---/+++/@ @/+/-`），并且 **聊天历史里应当保留 AI 原始输出的 unified diff**（不再把工具参数转回旧的 `diffs[{search,replace,start_line}]`）。
2. **前端展示**：仍然沿用现在的“逐行红/绿对比”体验（可以复用现有组件/样式/交互）。
3. **存储**：DiffStorageManager 如何存由我们决定，但需要满足 (1)(2)，并避免历史过大。
4. **工具能力**：不再受限于 `search/replace/start_line` 精确替换结构；需要适配 unified diff，天然支持 **新增/删除/替换**。

---

## 总体方案（核心：patch 作为唯一输入，展示时解析，应用时打补丁）

### A. apply_diff 新接口（对 AI）
将 `apply_diff` 工具的输入改为：
```ts
{ path: string; patch: string }
```
- `path`：目标文件（仍以工作区相对路径为准，multi-root 仍用 `workspace_name/path`）
- `patch`：unified diff 文本（允许包含 `diff --git`、`index` 行；必须包含至少一个 `@@` hunk）

> 兼容策略：可以临时保留旧参数 `diffs` 一段时间，但主路径以 `patch` 为准；最终可废弃 `diffs`。（不需要旧参数了，请你直接删除，我们要求ai直接按新格式输出工具调用，不再使用旧格式）

### B. 聊天历史如何保持 unified diff
- 不再在“保存历史前”改写 functionCall.args。
- 也不需要把 patch 转成旧 diffs 存入历史。
- 历史中看到的工具调用参数应仍是 `{path, patch}`。

### C. 后端如何执行（从 patch 计算 newContent）
在 `backend/tools/file/apply_diff.ts` 的 handler 中：
1. 读取 `path` 文件得到 `originalContent`
2. 解析 `patch` 得到 hunks
3. **在内存中对原文件逐行应用 hunks**，生成 `newContent`
   - 逐行校验 context 行（` `）与删除行（`-`）必须匹配，否则报错并提示 AI patch 与文件不一致
   - `+` 行执行插入
   - 支持纯新增/纯删除/替换混合
4. 调用现有 `DiffManager.createPendingDiff(filePath, absolutePath, originalContent, newContent, ...)` 进入待确认流程

> 这样即便历史只存 patch，仍可维持现有“pending diff → accept/reject → 保存”的完整链路。

### D. 前端如何继续“原本的逐行对比显示”
现状：`frontend/src/components/tools/file/apply_diff.vue` 依赖 `args.diffs` 逐块生成对比行。

改造策略：
- 让组件同时支持两种输入：
  1) 新：`args.patch`（优先）
  2) 旧：`args.diffs`（兼容）
- 当存在 `patch` 时：
  - 解析 patch → 按 hunk 生成 `DiffLine[]`（deleted/added/unchanged）并带 old/new 行号
  - 复用现有渲染样式（红/绿/灰）、折叠/复制等交互
- 当不存在 `patch` 时：继续走原 `search/replace` 的 LCS 逻辑。

这样可以保证：**展示体验不变**，但数据源从“搜索替换块”切换为“unified diff hunks”。

### E. VS Code Diff 预览（diff.openPreview）
`webview/handlers/DiffHandlers.ts` 目前对 apply_diff：
- 优先用 `result.data.originalContent/newContent` 或通过 `diffContentId` 从 DiffStorageManager 加载
- 否则 fallback 使用 `args.diffs` 拼接历史预览

需要改为：
- 若能拿到 full original/new：**保持不变**（仍能打开真实文件 diff）
- 否则如果只有 `args.patch`：
  - 做一个 fallback：
    - “原文”由 `context( ) + 删除(-)` 组成
    - “新文”由 `context( ) + 新增(+)` 组成
  - 仍可打开一个近似的 diff 视图（至少让用户看见改动内容）

### F. DiffStorageManager 的存储策略（建议）
- 继续让 DiffStorageManager 存 `{originalContent, newContent, filePath}`（现有机制），用于：
  - VSCode diff 预览
  - 历史回放时按需加载大内容
- patch 本身通常较小，直接保存在历史的 functionCall.args 中即可。
- （可选增强）若担心 patch 也过大，可增加 `patchContentId` 走 DiffStorageManager，但这不是必需。

---

## 关键模块改动清单

### 1) 后端：新增 unified diff 解析与应用
新增文件：`backend/tools/file/unifiedDiff.ts`（或 `unifiedDiffParser.ts`）
- `parseUnifiedDiff(patch: string): ParsedUnifiedDiff`
  - 支持读取 hunks：`@@ -a,b +c,d @@`
  - hunk lines 支持：` `、`+`、`-`、`\\ No newline at end of file`
  - 检测并拒绝：
    - multi-file patch（一次 patch 修改多个文件）
    - `/dev/null` 新建/删除文件（引导用 write_file/delete_file）
- `applyUnifiedDiff(originalContent: string, parsed: ParsedUnifiedDiff): { newContent: string; changedRanges?: ... }`
  - 顺序应用 hunk，严格校验 context

### 2) 后端：改造 apply_diff 工具
文件：`backend/tools/file/apply_diff.ts`
- 修改 Tool declaration：
  - `parameters` 改为 `{path, patch}`（可临时保留 diffs 兼容）
  - 更新 description：明确要求 unified diff，给出示例
- 修改 handler：
  - 若 `patch` 存在：走“解析 + 应用 patch”生成 newContent
  - 再走现有 pending diff 流程
  - 失败时返回明确错误：哪个 hunk、哪一行不匹配（便于模型修复 patch）

### 3) 后端：DiffManager（可选增强）
文件：`backend/tools/file/diffManager.ts`
- 现有 `blocks` 主要用于 CodeLens 定位。
- 对 unified diff 可新增：根据 hunk 的 newStart/newCount 计算变更范围，提供更准确 CodeLens。
- 不是硬性要求（不影响核心功能），可作为增强。

### 4) 前端：apply_diff.vue 支持 patch
文件：`frontend/src/components/tools/file/apply_diff.vue`
- 新增 patch 解析（或复用后端解析逻辑的 TS 版本，建议前端单独实现一个轻量 parser）
- 渲染层不大改动：仍输出 DiffLine[]，保持现有样式
- 复制功能：
  - 复制 patch 原文（新增一个“复制 patch”入口）或继续复制分块内容

### 5) Webview：DiffHandlers 支持 patch fallback
文件：`webview/handlers/DiffHandlers.ts`
- `handleApplyDiffPreview` 在 `args.diffs` 不存在时读取 `args.patch`
- 优先 full file diff（来自 diffContentId）；patch 仅作为 fallback

---

## 验收标准（AC）
1. AI 调用 `apply_diff({path, patch})`：
   - 工具能应用 patch 并创建 pending diff
   - 用户 accept/reject 流程正常
2. 聊天历史里该 tool call 的 args 仍是 unified diff patch（不被转换/改写）
3. 前端 apply_diff 面板仍是现有逐行红/绿对比体验（只是数据来自 patch hunks）
4. VSCode diff 预览正常（优先 full original/new；fallback 可显示 patch 级别对比）

---

## 风险与对策
- **patch 与真实文件不一致**：严格校验会失败
  - 对策：错误信息要定位到 hunk + 期望/实际行内容，便于模型自动修复
- **不同生成器 patch header 风格不同**（带/不带 diff --git）
  - 对策：parser 宽松处理 header，只强依赖 @@ hunks
- **换行符 CRLF/LF**
  - 对策：与现有 apply_diff 一样统一用 LF 处理；或记录原换行风格并回写（可选增强）

---

## 实施步骤（建议顺序）
1. 实现并单测 unified diff 解析 + apply（纯后端函数）
2. 改造 apply_diff 工具输入为 patch，并接入 pending diff
3. 改造前端 apply_diff.vue：patch → DiffLine[] 渲染
4. 改造 webview DiffHandlers：patch fallback
5. 做端到端手工回归：多 hunk、插入/删除/替换、reject/accept、历史回放
