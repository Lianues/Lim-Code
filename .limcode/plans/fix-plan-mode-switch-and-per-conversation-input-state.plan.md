
# 修复计划执行模式切换 & 输入框对话级隔离

## 问题分析

### 问题一：执行计划后左下角模式未切换

**根因**：`MessageTaskCards.vue` 中的 `executePlan` 函数通过 `configService.setCurrentPromptMode(targetModeId)` 更新了后端的全局模式，但 `InputArea.vue` 中的 `currentModeId` 是一个本地 `ref`，只在以下时机刷新：
1. 组件挂载时 (`onMounted -> loadPromptModes`)
2. `settingsStore.promptModesVersion` 变化时（仅在设置面板修改模式后触发）

执行计划时，**没有任何机制通知 `InputArea` 重新拉取后端模式状态**，导致左下角模式指示器不变。

**修复方案**：在 `MessageTaskCards.vue` 执行计划切换模式成功后，调用 `settingsStore.refreshPromptModes()` 递增 `promptModesVersion`，从而触发 `InputArea.vue` 的 `watch` 自动调用 `loadPromptModes()` 刷新模式。

### 问题二：输入框状态跨对话共享

**根因**：`editorNodes`（富文本编辑器节点，包含文本和@上下文徽章）仅存在于 `InputArea.vue` 的本地 `ref` 中。切换对话时：
- `inputValue`（纯文本）通过 `tabActions.ts` 的 snapshot/restore 正确保存和恢复
- 但 `editorNodes`（包含徽章的富文本状态）**没有被快照/恢复**
- 附件 (`useAttachments`) 在 `App.vue` 顶层调用，**跨所有对话共享**
- 消息队列 (`messageQueue`) 也**没有被快照/恢复**

**修复方案**：
1. 将 `editorNodes` 纳入 `ConversationSessionSnapshot`，在切换对话时保存和恢复
2. 将附件状态纳入 `ConversationSessionSnapshot`，在切换对话时保存和恢复
3. 将消息队列纳入 `ConversationSessionSnapshot`，在切换对话时保存和恢复

---

## 修改计划

### 修改 1：修复执行计划后模式指示器不刷新

**文件**：`frontend/src/components/message/MessageTaskCards.vue`

在 `executePlan` 函数中，`configService.setCurrentPromptMode(targetModeId)` 成功后，增加调用 `settingsStore.refreshPromptModes()`：

```typescript
// 已有代码：
const settingsStore = useSettingsStore()

// executePlan 函数内，setCurrentPromptMode 成功后增加：
try {
  const targetModeId = String(selectedModeId.value || 'code').trim() || 'code'
  await configService.setCurrentPromptMode(targetModeId)
  saveState(PLAN_EXECUTION_MODE_STATE_KEY, targetModeId)
  // ★ 新增：通知 InputArea 刷新模式指示器
  settingsStore.refreshPromptModes()
} catch (modeError) {
  console.error('[plan] Failed to switch prompt mode before execution:', modeError)
}
```

**原理**：`InputArea.vue` 已经有 `watch(() => settingsStore.promptModesVersion, () => { loadPromptModes() })`，递增版本号即可触发刷新。

---

### 修改 2：实现输入框状态对话级隔离

#### 2.1 扩展 ConversationSessionSnapshot 类型

**文件**：`frontend/src/stores/chat/types.ts`

在 `ConversationSessionSnapshot` 接口中添加新字段：

```typescript
import type { EditorNode } from '../../types/editorNode'
import type { Attachment } from '../../types'

export interface ConversationSessionSnapshot {
  // ... 已有字段 ...
  
  /** 编辑器节点（富文本状态，包含上下文徽章） */
  editorNodes: EditorNode[]
  /** 附件列表 */
  attachments: Attachment[]
  /** 消息排队队列 */
  messageQueue: QueuedMessage[]
}
```

#### 2.2 修改 ChatStoreState 添加 editorNodes 和 attachments

**文件**：`frontend/src/stores/chat/state.ts`

在 `createChatState` 中新增 `editorNodes` 和 `attachments` 状态字段：

```typescript
import type { EditorNode } from '../../types/editorNode'
import type { Attachment } from '../../types'

// 在 createChatState 中新增：
/** 编辑器节点数组（包含文本和上下文徽章） */
const editorNodes = ref<EditorNode[]>([])

/** 当前对话的附件列表 */
const attachments = ref<Attachment[]>([])

// 在返回对象中添加这两个字段
return {
  // ... 已有字段 ...
  editorNodes,
  attachments,
}
```

同时在 `ChatStoreState` 接口中添加对应声明。

#### 2.3 修改 snapshot/restore 逻辑

**文件**：`frontend/src/stores/chat/tabActions.ts`

在 `snapshotCurrentSession` 中保存新字段：

```typescript
export function snapshotCurrentSession(state: ChatStoreState): ConversationSessionSnapshot {
  return {
    // ... 已有字段 ...
    editorNodes: [...state.editorNodes.value],
    attachments: [...state.attachments.value],
    messageQueue: [...state.messageQueue.value],
  }
}
```

在 `restoreSessionFromSnapshot` 中恢复新字段：

```typescript
export function restoreSessionFromSnapshot(
  state: ChatStoreState,
  snapshot: ConversationSessionSnapshot
): void {
  // ... 已有字段 ...
  state.editorNodes.value = [...snapshot.editorNodes]
  state.attachments.value = [...snapshot.attachments]
  state.messageQueue.value = [...snapshot.messageQueue]
}
```

在 `resetConversationState` 中重置新字段：

```typescript
export function resetConversationState(state: ChatStoreState): void {
  // ... 已有字段 ...
  state.editorNodes.value = []
  state.attachments.value = []
  state.messageQueue.value = []
}
```

#### 2.4 在 Store 中暴露 editorNodes 和 attachments 的操作方法

**文件**：`frontend/src/stores/chat/index.ts`（或主 store 文件）

确保 store 暴露了 `editorNodes` 和 `attachments` 的 getter/setter：

```typescript
// getter
const editorNodes = computed(() => state.editorNodes.value)
const attachments = computed(() => state.attachments.value)

// setter
function setEditorNodes(nodes: EditorNode[]) {
  state.editorNodes.value = nodes
}
function setAttachments(atts: Attachment[]) {
  state.attachments.value = atts
}
function addAttachment(att: Attachment) {
  state.attachments.value = [...state.attachments.value, att]
}
function removeAttachmentById(id: string) {
  state.attachments.value = state.attachments.value.filter(a => a.id !== id)
}
function clearAttachmentsList() {
  state.attachments.value = []
}
```

#### 2.5 重构 InputArea.vue 和 App.vue

**文件**：`frontend/src/components/input/InputArea.vue`

将 `editorNodes` 从本地 `ref` 改为与 store 双向绑定：

```typescript
// 移除本地 editorNodes ref，改为从 store 读写
const editorNodes = computed({
  get: () => chatStore.editorNodes,
  set: (nodes) => chatStore.setEditorNodes(nodes)
})

// watch 保持不变，只是数据源变了
```

**文件**：`frontend/src/App.vue`

将 `useAttachments` 改为使用 store 中的 `attachments`：

- `useAttachments` composable 仍然负责文件处理逻辑（验证、缩略图、base64 编码等）
- 但最终存储附件的数组改为 `chatStore.attachments`
- `addAttachment` 成功后调用 `chatStore.addAttachment(att)` 而不是推入本地数组
- `removeAttachment` 调用 `chatStore.removeAttachmentById(id)`
- `clearAttachments` 调用 `chatStore.clearAttachmentsList()`

或者更简单的做法：不修改 `useAttachments` 的内部实现，而是在 `App.vue` 中添加切换对话时的同步逻辑——在 tab 切换前保存当前附件到 snapshot，切换后从 snapshot 恢复附件。

**推荐方案**：将 `attachments` 数组从 `useAttachments` composable 移到 store 中管理。`useAttachments` 只保留文件处理方法（`addAttachment`、`addAttachments` 等），但操作的数组改为 store 中的。

具体做法：
1. 修改 `useAttachments` 接受一个外部 `attachments` ref 参数
2. 在 `App.vue` 中传入 `chatStore.attachments` 的 ref
3. `useAttachments` 内部操作该 ref 而非创建自己的本地 ref

---

## 影响范围

| 文件 | 修改内容 |
|------|---------|
| `MessageTaskCards.vue` | 执行计划后调用 `settingsStore.refreshPromptModes()` |
| `types.ts` (stores/chat) | `ConversationSessionSnapshot` 和 `ChatStoreState` 新增字段 |
| `state.ts` (stores/chat) | `createChatState` 新增 `editorNodes`, `attachments` |
| `tabActions.ts` (stores/chat) | snapshot/restore/reset 增加新字段 |
| `stores/chat/index.ts` | 暴露 `editorNodes`, `attachments` 操作方法 |
| `InputArea.vue` | `editorNodes` 改为 store 驱动 |
| `App.vue` | 附件管理改为 store 驱动 |
| `useAttachments.ts` | 支持外部传入 attachments ref（或直接引用 store） |

## 风险点

1. `editorNodes` 包含 DOM 相关状态（上下文徽章），需要确保序列化/反序列化不丢失信息
2. `InputBox.vue` 依赖 `props.nodes` 进行 DOM 渲染，需确保 store 变化后 DOM 能正确重新渲染
3. 附件可能包含 base64 数据，快照内存占用需注意（但通常附件数量不多，可接受）

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] 修复执行计划后模式指示器不刷新：在 MessageTaskCards.vue 的 executePlan 中调用 settingsStore.refreshPromptModes()  `#1`
- [ ] 扩展 ConversationSessionSnapshot 和 ChatStoreState 类型，新增 editorNodes、attachments、messageQueue 字段  `#2`
- [ ] 修改 createChatState 新增 editorNodes 和 attachments 状态字段  `#3`
- [ ] 修改 tabActions.ts 的 snapshot/restore/reset 函数支持新字段  `#4`
- [ ] 在 chat store 中暴露 editorNodes 和 attachments 的操作方法  `#5`
- [ ] 重构 InputArea.vue 将 editorNodes 改为 store 驱动  `#6`
- [ ] 重构 App.vue 和 useAttachments 将附件管理改为 store 驱动  `#7`
- [ ] 测试：验证执行计划后左下角模式正确切换  `#8`
- [ ] 测试：验证切换对话时输入框文本、上下文徽章、附件正确隔离  `#9`
<!-- LIMCODE_TODO_LIST_END -->
