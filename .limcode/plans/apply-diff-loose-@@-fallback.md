## 背景与目标
当前 `apply_diff` 的 unified 模式严格要求每个 hunk 头必须是：

```
@@ -oldStart,oldCount +newStart,newCount @@
```

当 AI 输出如下“裸 @@”形式时会直接失败：

```
@@
 import 'a'
+import 'b'
```

目标：**在 unified 模式下兼容这种裸 `@@`**，将其解释为“全局搜索配对”的兜底 diff：
- 以 hunk 内的 `context(' ')` + `del('-')` 行拼出 `search`
- 以 hunk 内的 `context(' ')` + `add('+')` 行拼出 `replace`
- 然后对整文件执行精确 `search/replace`（若多处匹配则要求用户/AI 提供更多上下文；保持与 legacy 行为一致）

> 该兜底只在 unified patch 解析失败（或检测到裸 @@）时触发，不影响标准 unified diff 的严格行为。

---

## 改动范围（文件）
- 后端：
  - `backend/tools/file/apply_diff.ts`（核心：在 unified 流程中加入 fallback）
  - （可选）`backend/tools/file/unifiedDiff.ts`（不强改接口，尽量不动；仅在需要更清晰错误分类时才改）
- 前端（工具面板展示）：
  - `frontend/src/components/tools/file/apply_diff.vue`（让 patch->DiffBlock 解析也支持裸 @@，否则面板会显示空 diff）
- Webview 预览（可选增强）：
  - `webview/handlers/DiffHandlers.ts`（对“无前缀的行”按 context 兜底展示，避免预览缺行）
- 文档：
  - `CHANGELOG.md`（记录兼容性增强）

---

## 设计细节
### 1) 裸 @@ patch 的“全局搜索配对”语义
将每个 hunk 视作一块 search/replace：
- `searchLines`：按顺序收集
  - `' '` context 行：加入
  - `'-'` del 行：加入
  - `'+'` add 行：忽略
- `replaceLines`：按顺序收集
  - `' '` context 行：加入
  - `'+'` add 行：加入
  - `'-'` del 行：忽略
- `search = searchLines.join('\n')`
- `replace = replaceLines.join('\n')`

约束：
- `search` 不能为空（否则会造成无限匹配/不可控替换）
- 若文件中 `search` 匹配次数 > 1，则保持与 legacy 相同策略：报错提示需要提供更多上下文/使用 start_line（兜底模式下无法从裸 @@ 得到 start_line，因此应提示“补全更多上下文或改用标准 @@ 行号头”）。

### 2) 后端实现方案（推荐：仅在 apply_diff.ts 做 fallback）
在 unified 模式 handler 中：
1. 先尝试 `parseUnifiedDiff(patch)` + `applyUnifiedDiffBestEffort`（保持现有行为）
2. 若抛错且错误是 `Invalid hunk header`（或检测到 patch 存在 `@@` 行但不含数字范围），则：
   - 调用新函数 `parseLooseUnifiedPatchToLegacyDiffs(patch)`：把 patch 解析为 `LegacyDiffBlock[]`
   - 复用现有 legacy 的逐块 best-effort 应用逻辑（`applyDiffToContent`），得到：
     - `newContent`
     - `results: [{index, success, error, startLine, endLine}]`（startLine/endLine 来自 `matchedLine` + replace 行数）
     - `blocks`（用于 CodeLens）
   - 使用 `diffManager.createPendingDiff(...)` 创建 pending diff：
     - `rawDiffs` 传入 legacy diffs（确保 DiffManager 能走 legacy 分支进行块级 accept/reject）

注意：
- 兜底模式仍在 unified 配置下运行，因此 args 依旧是 `{path, patch}`；但内部 rawDiffs 会是 legacy diffs。
- 对用户而言是“同一次 apply_diff 调用成功了”，只是应用策略从“基于行号”退化成“基于精确片段匹配”。

### 3) 前端工具面板展示适配
`frontend/src/components/tools/file/apply_diff.vue` 中 `parseUnifiedPatchToDiffBlocks(patch)` 当前只接受带数字的 header；裸 @@ 会被跳过导致 diffList 为空。

修改策略：
- `if (line.startsWith('@@')) { flush(); inHunk=true; ... }`：无论是否匹配到数字，都开启新的 block
- 若匹配不到数字：
  - 不设置 `oldStart/newStart`，让 `start_line` 保持 `undefined`
- hunk 内行解析：保持对 `' ' | '+' | '-'` 的支持；（可选）遇到无前缀行时按 context 处理以增强鲁棒性。

这样：
- 面板可展示 search/replace 块
- 实际应用位置由后端返回的 `results[].startLine` 覆盖显示

### 4) （可选）Webview Diff 预览增强
`webview/handlers/DiffHandlers.ts` 的 `buildPreviewContentsFromUnifiedPatch` 目前仅处理 `' ' | '+' | '-'` 前缀行。
可选增强：当在 hunk 中遇到非空且非 `\\` 开头、且不以三种前缀开头的行，将其视作 context 行（加入 old/new），提升“AI 输出缺前缀”时的预览效果。

### 5) 更新 tool declaration 文案
`backend/tools/file/apply_diff.ts` unified 描述中目前写了：
> Do NOT include bare "@@" lines.

需要更新为：
- 仍推荐标准 header
- 但允许裸 `@@` 作为 fallback（会使用全局 search/replace，可能因多处匹配而失败）

---

## 验收与测试用例（手动）
1. **标准 unified diff**：含完整 `@@ -a,b +c,d @@` 头的 patch 行为不变。
2. **裸 @@ 单 hunk**：使用你提供的示例 patch：
   - 能成功生成 pending diff
   - `results` 中该块 success=true，且 startLine/endLine 合理
3. **裸 @@ 多处匹配**：构造文件里同一段 `search` 出现两次：
   - 应返回失败并提示多处匹配，需要更多上下文/改用标准 header
4. **块级拒绝/接受**：在 diff 视图中拒绝单个块，确保 DiffManager 能用 legacy 分支正确重算内容。

---

## 风险与回滚
- 风险：兜底模式是精确 search/replace，若上下文不够或重复出现会失败；但这是可预期行为，并且不会影响标准 unified diff。
- 回滚：fallback 逻辑集中在 `apply_diff.ts` 的 catch 分支，删除即可恢复严格模式。