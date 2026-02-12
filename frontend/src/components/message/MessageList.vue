<script setup lang="ts">
/**
 * MessageList - 消息列表容器
 * 扁平化设计，简洁加载动画
 */

import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { CustomScrollbar, DeleteDialog, Tooltip, ConfirmDialog } from '../common'
import MessageItem from './MessageItem.vue'
import SummaryMessage from './SummaryMessage.vue'
import { useChatStore } from '../../stores'
import { formatTime } from '../../utils/format'
import { useI18n } from '../../i18n'
import type { Message, CheckpointRecord, Attachment } from '../../types'
import { extractTodosFromPlan } from '../../utils/taskCards'
import {
  normalizeTodoStatus,
  replayTodoStateFromMessages,

  type TodoStatus as BuildTodoStatus
} from '../../utils/todoList'

const { t } = useI18n()

const props = defineProps<{
  messages: Message[]
  /** 标签页 ID，标识此 MessageList 实例所属的标签页 */
  tabId: string
  /** 当前是否为活跃（可见）标签页 */
  isActive: boolean
}>()

// 从 store 读取等待状态
const chatStore = useChatStore()

// ============ Build（Plan 执行）顶部卡片 ============
type BuildTodoItem = { id: string; text: string; status: BuildTodoStatus }
const isBuildExpanded = ref(false)



const replayedBuildTodoState = computed(() => {
  return replayTodoStateFromMessages(chatStore.allMessages, {
    resolveToolResponseById: (toolCallId) => chatStore.getToolResponseById(toolCallId)
  })
})

const replayedBuildTodoList = computed(() => {
  return replayedBuildTodoState.value.todos
})

const todoBarItems = computed<BuildTodoItem[]>(() => {
  const list = replayedBuildTodoList.value
  if (!list || list.length === 0) return []

  return list
    .map(t => ({
      id: String(t.id),
      text: String(t.content || '').trim(),
      status: normalizeTodoStatus(t.status)
    }))
    .filter(t => t.text.length > 0)
})

// 每个对话独立记忆 TODO 展开状态；key = conversationId, value = 用户最后设定的展开/折叠
// undefined 表示该对话从未手动设置过（首次出现 TODO 时自动展开）
const todoExpandedMap = new Map<string, boolean>()
const isTodoExpanded = ref(false)


function isExecutedCreatePlanTool(tool: any): boolean {
  if (!tool || tool.name !== 'create_plan') return false

  const fromTool = tool.result && typeof tool.result === 'object' ? tool.result as Record<string, unknown> : undefined
  const fromResponseRaw = typeof tool.id === 'string' && tool.id
    ? chatStore.getToolResponseById(tool.id)
    : undefined
  const fromResponse = fromResponseRaw && typeof fromResponseRaw === 'object'
    ? fromResponseRaw as Record<string, unknown>
    : undefined
  const merged = {
    ...(fromTool || {}),
    ...(fromResponse || {})
  }

  const prompt = (merged as any)?.planExecutionPrompt
  return typeof prompt === 'string' && prompt.trim().length > 0
}

function isTodoInitToolForSticky(tool: any): boolean {
  if (!tool) return false
  if (tool.name === 'todo_write') return true
  if (tool.name === 'create_plan') return isExecutedCreatePlanTool(tool)
  return false
}

const hasTodoInitTool = computed(() => {
  return chatStore.allMessages.some(msg =>
    msg.role === 'assistant' &&
    Array.isArray(msg.tools) &&
    msg.tools.some(tool => isTodoInitToolForSticky(tool))
  )
})

// 仅保留一个会话级 TODO 条；有 activeBuild 时沿用 Build 条展示，避免双条重叠。
const showTodoBar = computed(() => {
  return (
    !showBuildBar.value &&
    hasTodoInitTool.value &&
    todoBarItems.value.length > 0
  )
})

const todoInitAnchorBackendIndex = computed<number | null>(() => {
  // 使用“最新一次初始化（create_plan / todo_write）”作为锚点，
  // 避免新建 TODO 列表时仍覆盖在旧锚点位置。
  for (let i = chatStore.allMessages.length - 1; i >= 0; i--) {
    const msg = chatStore.allMessages[i]
    if (msg.role !== 'assistant' || !Array.isArray(msg.tools)) continue
    const hasInitTool = msg.tools.some(tool => isTodoInitToolForSticky(tool))
    if (!hasInitTool) continue

    if (typeof msg.backendIndex === 'number' && Number.isFinite(msg.backendIndex)) {
      return msg.backendIndex + 1
    }
  }

  return null
})

const todoAnchorBackendIndex = computed<number | null>(() => {
  if (!showTodoBar.value) return null

  if (todoInitAnchorBackendIndex.value !== null) {
    return todoInitAnchorBackendIndex.value
  }

  const anchor = replayedBuildTodoState.value.anchorBackendIndex
  if (typeof anchor === 'number' && Number.isFinite(anchor)) return anchor

  const firstIndexed = chatStore.allMessages.find(m => typeof m.backendIndex === 'number')
  if (typeof firstIndexed?.backendIndex === 'number') return firstIndexed.backendIndex

  const lastIndexed = [...chatStore.allMessages].reverse().find(m => typeof m.backendIndex === 'number')
  if (typeof lastIndexed?.backendIndex === 'number') return lastIndexed.backendIndex + 1

  return chatStore.windowStartIndex + chatStore.allMessages.length
})

const todoPanelName = computed(() => {
  // 名称跟随“最新一次初始化工具”
  for (let i = chatStore.allMessages.length - 1; i >= 0; i--) {
    const msg = chatStore.allMessages[i]
    if (msg.role !== 'assistant' || !Array.isArray(msg.tools)) continue
    const initTool = msg.tools.find(tool => isTodoInitToolForSticky(tool))
    if (!initTool) continue

    if (initTool.name === 'create_plan') {
      const title = typeof (initTool.args as any)?.title === 'string' ? (initTool.args as any).title.trim() : ''
      if (title) return title
      const path = typeof (initTool.args as any)?.path === 'string' ? (initTool.args as any).path.trim() : ''
      if (path) {
        const normalized = path.replace(/\\/g, '/')
        const name = normalized.split('/').filter(Boolean).pop() || path
        return name.replace(/\.md$/i, '')
      }
      return t('components.message.tool.createPlan.fallbackTitle')
    }

    return t('components.message.tool.todoWrite.label')
  }

  return t('components.message.tool.todoWrite.label')
})

const todoTotal = computed(() => todoBarItems.value.filter(t => t.status !== 'cancelled').length)
const todoCompleted = computed(() => todoBarItems.value.filter(t => t.status === 'completed').length)
const todoCurrentText = computed(() => {
  const inProgress = todoBarItems.value.find(t => t.status === 'in_progress')
  if (inProgress) return inProgress.text
  const next = todoBarItems.value.find(t => t.status === 'pending')
  if (next) return next.text
  return ''
})

const buildTodoItems = computed<BuildTodoItem[]>(() => {
  // 1) 优先显示“重放后”的 todo 列表（兼容 todo_write 精简 result + todo_update 增量更新）
  if (replayedBuildTodoList.value && replayedBuildTodoList.value.length > 0) {
    return replayedBuildTodoList.value
      .map(t => ({
        id: String(t.id),
        text: String(t.content || '').trim(),
        status: normalizeTodoStatus(t.status)
      }))
      .filter(t => t.text.length > 0)
  }

  // 2) 若确实没有任何 todo 工具轨迹，且仍处于 Build 运行中，则临时 fallback 到计划 markdown
  // （避免刚启动执行时列表短暂为空）
  if (chatStore.activeBuild?.status !== 'running') {
    return []
  }

  const planContent = chatStore.activeBuild?.planContent || ''
  const planTodos = extractTodosFromPlan(planContent)

  return planTodos.map((t, idx) => ({
    id: `plan:${idx}`,
    text: t.text,
    status: t.completed ? 'completed' : 'pending'
  }))
})

const showBuildBar = computed(() => {
  const build = chatStore.activeBuild
  if (!build) return false

  // 运行中始终展示；已结束时仅在存在可展示 TODO 时展示，
  // 避免回退后出现“暂无 TODO”的空 Build 壳。
  if (build.status === 'running') return true
  return buildTodoItems.value.length > 0
})

const buildAnchorBackendIndex = computed<number | null>(() => {
  const build = chatStore.activeBuild

  if (!build) return null

  if (typeof build.anchorBackendIndex === 'number' && Number.isFinite(build.anchorBackendIndex)) {
    return build.anchorBackendIndex
  }

  const startedAt = typeof build.startedAt === 'number' ? build.startedAt : 0
  const firstAfterStart = chatStore.allMessages.find(m =>
    typeof m.backendIndex === 'number' &&
    (startedAt <= 0 || (typeof m.timestamp === 'number' && m.timestamp >= startedAt))
  )
  if (typeof firstAfterStart?.backendIndex === 'number') return firstAfterStart.backendIndex

  const lastIndexed = [...chatStore.allMessages].reverse().find(m => typeof m.backendIndex === 'number')
  if (typeof lastIndexed?.backendIndex === 'number') return lastIndexed.backendIndex + 1
  return chatStore.windowStartIndex + chatStore.allMessages.length
})

const buildPanelLabel = computed(() => 'Build')
const buildPanelName = computed(() => chatStore.activeBuild?.title || '')

const buildTotal = computed(() => buildTodoItems.value.filter(t => t.status !== 'cancelled').length)
const buildCompleted = computed(() => buildTodoItems.value.filter(t => t.status === 'completed').length)
const buildCurrentText = computed(() => {
  const list = buildTodoItems.value
  const inProgress = list.find(t => t.status === 'in_progress')
  if (inProgress) return inProgress.text
  const next = list.find(t => t.status === 'pending')
  if (next) return next.text
  return ''
})

watch(
  () => chatStore.activeBuild?.id,
  (id, prev) => {
    if (id && id !== prev) {
      isBuildExpanded.value = true
    }
  }
)

watch(
  () => chatStore.isWaitingForResponse,
  (waiting) => {
    if (!waiting && chatStore.activeBuild && chatStore.activeBuild.status === 'running') {
      void chatStore.setActiveBuild({ ...chatStore.activeBuild, status: 'done' })
    }
  }
)

watch(showBuildBar, (visible) => {
  if (!visible) isBuildExpanded.value = false
})


/** 根据当前对话恢复 TODO 展开状态 */
function restoreTodoExpandedState() {
  if (!showTodoBar.value) return
  const convId = chatStore.currentConversationId
  if (convId && todoExpandedMap.has(convId)) {
    isTodoExpanded.value = todoExpandedMap.get(convId)!
  } else {
    isTodoExpanded.value = true
    if (convId) todoExpandedMap.set(convId, true)
  }
}

// showTodoBar 变为可见时，恢复该对话记忆的展开状态
watch(showTodoBar, (visible) => {
  if (!visible) return
  restoreTodoExpandedState()
})

/** 切换 TODO 展开/折叠，同时记忆到当前对话 */
function toggleTodoExpanded() {
  isTodoExpanded.value = !isTodoExpanded.value
  const convId = chatStore.currentConversationId
  if (convId) {
    todoExpandedMap.set(convId, isTodoExpanded.value)
  }
}

// 消息分页显示逻辑：解决消息过多导致的输入卡顿
const VISIBLE_INCREMENT = 40
const visibleCount = ref(VISIBLE_INCREMENT)

// 是否还有更多“已加载但未展示”的消息
const hasMoreVisible = computed(() => props.messages.length > visibleCount.value)
// 是否还有更多“未加载到窗口”的历史消息（真分页）
const hasMoreHistory = computed(() => chatStore.windowStartIndex > 0)
// 顶部加载指示器：任一维度有更多都显示
const hasMore = computed(() => hasMoreVisible.value || hasMoreHistory.value)

// 增强的消息对象接口
interface EnhancedMessage {
  message: Message
  backendIndex: number
  beforeCheckpoints: CheckpointRecord[]
  afterCheckpoints: CheckpointRecord[]
}

// 预计算可见消息的增强信息，避免在模板中进行昂贵的计算
const enhancedVisibleMessages = computed<EnhancedMessage[]>(() => {
  const count = visibleCount.value
  const total = props.messages.length
  const startIndex = Math.max(0, total - count)
  
  // 仅对可见的消息进行切片
  const visibleSlice = props.messages.slice(startIndex)

  // 预先按消息索引对检查点进行分组
  const checkpointsByMsgIndex = new Map<number, { before: CheckpointRecord[], after: CheckpointRecord[] }>()
  chatStore.checkpoints.forEach(cp => {
    if (!checkpointsByMsgIndex.has(cp.messageIndex)) {
      checkpointsByMsgIndex.set(cp.messageIndex, { before: [], after: [] })
    }
    const group = checkpointsByMsgIndex.get(cp.messageIndex)!
    if (cp.phase === 'before') group.before.push(cp)
    else group.after.push(cp)
  })

  return visibleSlice.map(message => {
    const backendIndex = typeof message.backendIndex === 'number' ? message.backendIndex : -1
    const cpGroup = backendIndex !== -1 ? checkpointsByMsgIndex.get(backendIndex) : null
    
    return {
      message,
      backendIndex,
      beforeCheckpoints: cpGroup?.before || [],
      afterCheckpoints: cpGroup?.after || []
    }
  })
})


type RenderRow =
  | { kind: 'build'; key: 'build-bar' }
  | { kind: 'message'; key: string; item: EnhancedMessage }
  | { kind: 'todo'; key: 'todo-bar' }

function shouldInsertSticky(anchor: number | null, idx: number): boolean {
  return anchor === null || (typeof idx === 'number' && idx >= 0 && idx >= anchor)
}

const messageRenderRows = computed<RenderRow[]>(() => {
  const visible = enhancedVisibleMessages.value
  const rows: RenderRow[] = []
  const buildAnchor = buildAnchorBackendIndex.value
  const todoAnchor = todoAnchorBackendIndex.value

  let buildInserted = !showBuildBar.value
  let todoInserted = !showTodoBar.value

  for (const item of visible) {
    const idx = item.backendIndex
    if (!buildInserted && shouldInsertSticky(buildAnchor, idx)) {
      rows.push({ kind: 'build', key: 'build-bar' })
      buildInserted = true
    }

    if (!todoInserted && shouldInsertSticky(todoAnchor, idx)) {
      rows.push({ kind: 'todo', key: 'todo-bar' })
      todoInserted = true
    }

    rows.push({ kind: 'message', key: item.message.id, item })
  }

  if (!buildInserted && showBuildBar.value) {
    rows.push({ kind: 'build', key: 'build-bar' })
  }

  if (!todoInserted && showTodoBar.value) {
    rows.push({ kind: 'todo', key: 'todo-bar' })
  }

  return rows
})

// 是否正在加载更多（用于节流）
const isLoadingMore = ref(false)

// 加载更多历史消息（先展示已加载的，再按需从后端拉更早一页）
async function loadMore() {
  if (isLoadingMore.value || !hasMore.value) return
  if (!scrollbarRef.value) return
  const container = scrollbarRef.value.getContainer()
  if (!container) return

  isLoadingMore.value = true
  const oldScrollHeight = container.scrollHeight
  const oldScrollTop = container.scrollTop
  
  try {
    if (hasMoreVisible.value) {
      // 仅展示更多“已加载到窗口”的消息
      visibleCount.value += VISIBLE_INCREMENT
      await nextTick()
    } else if (hasMoreHistory.value) {
      // 窗口已经展示到头了：向后端拉取更早一页
      const prevLen = props.messages.length
      await chatStore.loadOlderMessagesPage()
      await nextTick()
      const added = props.messages.length - prevLen
      if (added > 0) {
        // 让新拉取到的更早消息立刻可见
        visibleCount.value += added
        await nextTick()
      }
    }
  } finally {
    // 保持滚动位置：顶部插入内容会导致滚动跳动，这里手动修正
    const newScrollHeight = container.scrollHeight
    container.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight)
    isLoadingMore.value = false
  }
}

// 滚动事件处理：实现自动加载
function handleScroll(e: Event) {
  const container = e.target as HTMLElement
  if (!container) return
  
  // 当滚动到距离顶部 100px 以内时自动加载
  if (hasMore.value && !isLoadingMore.value && container.scrollTop < 100) {
    loadMore()
  }
}

// CustomScrollbar 引用
const scrollbarRef = ref<InstanceType<typeof CustomScrollbar> | null>(null)

// 标记是否需要滚动到底部（切换对话时设置）
const needsScrollToBottom = ref(false)

// ResizeObserver 引用
let resizeObserver: ResizeObserver | null = null

// 多实例模式下：当此标签页变为活跃时，滚动到底部并恢复 TODO 展开状态
// （不再重置 visibleCount，因为每个实例独立维护自己的分页状态）
watch(() => props.isActive, (active, wasActive) => {
  if (active && !wasActive) {
    // 刚切换到此标签页，标记需要滚动到底部
    needsScrollToBottom.value = true
    restoreTodoExpandedState()
    // 尝试滚动（如果容器已就绪）
    nextTick(() => tryScrollToBottom())
  }
})

// 监听消息变化，当消息加载完成时尝试滚动
watch(() => props.messages, (newMessages) => {
  // 当消息加载完成时，尝试滚动
  // 如果容器还没有尺寸（display: none），ResizeObserver 会在可见时触发
  if (needsScrollToBottom.value && newMessages.length > 0) {
    tryScrollToBottom()
  }
}, { deep: false })

// 尝试滚动到底部（会检查容器是否准备好）
function tryScrollToBottom() {
  if (!scrollbarRef.value) return
  
  const container = scrollbarRef.value.getContainer()
  if (!container) return
  
  // 检查容器是否有尺寸（可见状态）
  if (container.scrollHeight > 0 && container.clientHeight > 0) {
    if (needsScrollToBottom.value) {
      needsScrollToBottom.value = false
      scrollbarRef.value.scrollToBottom()
    }
  }
  // 如果容器还没有尺寸，ResizeObserver 会在可见时触发
}

// 设置 ResizeObserver 监听容器尺寸变化
onMounted(() => {
  // 使用 nextTick 确保 scrollbarRef 已经绑定
  nextTick(() => {
    if (!scrollbarRef.value) return
    
    const container = scrollbarRef.value.getContainer()
    if (!container) return
    
    // 添加滚动事件监听以支持自动加载
    container.addEventListener('scroll', handleScroll, { passive: true })
    
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { height } = entry.contentRect
        
        // 当容器从 0 高度变为有高度时，尝试滚动
        if (height > 0 && needsScrollToBottom.value) {
          // 使用 requestAnimationFrame 确保布局完成
          requestAnimationFrame(() => {
            tryScrollToBottom()
          })
        }
      }
    })
    
    resizeObserver.observe(container)
  })
})

// 清理监听器
onBeforeUnmount(() => {
  if (scrollbarRef.value) {
    const container = scrollbarRef.value.getContainer()
    if (container) {
      container.removeEventListener('scroll', handleScroll)
    }
  }

  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
})

const emit = defineEmits<{
  edit: [messageId: string, newContent: string, attachments: Attachment[]]
  delete: [messageId: string]
  retry: [messageId: string]
  copy: [content: string]
  restoreCheckpoint: [checkpointId: string]
  restoreAndRetry: [messageId: string, checkpointId: string]
  restoreAndEdit: [messageId: string, newContent: string, attachments: Attachment[], checkpointId: string]
}>()

// 删除确认对话框状态
const showDeleteConfirm = ref(false)
const pendingDeleteMessageId = ref<string | null>(null)
const pendingDeleteBackendIndex = ref<number | null>(null)

// 恢复检查点确认对话框状态
const showRestoreConfirm = ref(false)
const pendingCheckpoint = ref<CheckpointRecord | null>(null)


// 计算要删除的消息数量（使用 allMessages）
const deleteCount = computed(() => {
  if (pendingDeleteBackendIndex.value === null) return 0
  // backendIndex 为绝对索引：删除数量 = total - index
  const total = chatStore.totalMessages || 0
  const idx = pendingDeleteBackendIndex.value
  if (idx < 0) return 0
  return Math.max(0, total - idx)
})


// 处理编辑
function handleEdit(messageId: string, newContent: string, attachments: Attachment[]) {
  emit('edit', messageId, newContent, attachments)
}

// 处理删除 - 显示确认对话框
function handleDelete(messageId: string) {
  pendingDeleteMessageId.value = messageId
  const msg = chatStore.allMessages.find(m => m.id === messageId)
  pendingDeleteBackendIndex.value = typeof msg?.backendIndex === 'number' ? msg.backendIndex : null
  showDeleteConfirm.value = true
}

// 确认删除 - 使用 allMessages 中的真实索引
function confirmDelete() {
  if (!pendingDeleteMessageId.value) return
  const actualIndex = chatStore.allMessages.findIndex(m => m.id === pendingDeleteMessageId.value)
  if (actualIndex !== -1) {
    chatStore.deleteMessage(actualIndex)
  }
  pendingDeleteMessageId.value = null
  pendingDeleteBackendIndex.value = null
}

// 取消删除
function cancelDelete() {
  pendingDeleteMessageId.value = null
  pendingDeleteBackendIndex.value = null
}

// 获取用于删除消息的最新检查点
// 之前消息的存档点：包含所有阶段（before/after），因为这些代表已完成的操作状态
// 当前消息的存档点：只包含 before 阶段，因为用户要撤销的是这条消息的效果
// 与重试使用相同的策略
const deleteCheckpoints = computed<CheckpointRecord[]>(() => {
  if (pendingDeleteBackendIndex.value === null) return []
  const messageIndex = pendingDeleteBackendIndex.value
  
  return chatStore.checkpoints
    .filter(cp => {
      if (cp.messageIndex < messageIndex) return true          // 之前的消息：包含所有阶段
      if (cp.messageIndex === messageIndex && cp.phase === 'before') return true  // 当前消息：只包含 before
      return false
    })
})

// 处理回档并删除
async function handleRestoreAndDelete(checkpointId: string) {
  if (!pendingDeleteMessageId.value) return
  
  const actualIndex = chatStore.allMessages.findIndex(m => m.id === pendingDeleteMessageId.value)
  if (actualIndex === -1) return
  
  // 调用 restoreAndDelete 方法
  await chatStore.restoreAndDelete(actualIndex, checkpointId)
  pendingDeleteMessageId.value = null
  pendingDeleteBackendIndex.value = null
}

// 处理重试 - 直接调用 store 方法（确认已在 MessageItem 的 RetryDialog 中完成）
function handleRetry(messageId: string) {
  const actualIndex = chatStore.allMessages.findIndex(m => m.id === messageId)
  if (actualIndex !== -1) chatStore.retryFromMessage(actualIndex)
}

// 处理复制
function handleCopy(content: string) {
  emit('copy', content)
}

// 处理错误后重试
function handleErrorRetry() {
  chatStore.retryAfterError()
}

// 处理继续对话（工具执行后中断时）
function handleContinue() {
  chatStore.retryAfterError()
}

// 处理恢复检查点
function handleRestoreCheckpoint(checkpointId: string) {
  const checkpoint = chatStore.checkpoints.find(cp => cp.id === checkpointId)
  if (checkpoint) {
    restoreCheckpoint(checkpoint)
  }
}

// 处理回档并重试
async function handleRestoreAndRetry(messageId: string, checkpointId: string) {
  // 找到消息在 allMessages 中的索引
  const actualIndex = chatStore.allMessages.findIndex(m => m.id === messageId)
  if (actualIndex === -1) return
  
  // 调用 restoreAndRetry 方法
  await chatStore.restoreAndRetry(actualIndex, checkpointId)
}

// 处理回档并编辑
async function handleRestoreAndEdit(messageId: string, newContent: string, attachments: Attachment[], checkpointId: string) {
  // 找到消息在 allMessages 中的索引
  const actualIndex = chatStore.allMessages.findIndex(m => m.id === messageId)
  if (actualIndex === -1) return
  
  // 调用 restoreAndEdit 方法
  await chatStore.restoreAndEdit(actualIndex, newContent, attachments, checkpointId)
}

// 检查特定工具的检查点是否需要合并显示（前后内容一致时合并）
function shouldMergeForTool(messageIndex: number, toolName: string): boolean {
  // 如果设置为不合并，直接返回 false（从 chatStore 读取配置）
  if (!chatStore.mergeUnchangedCheckpoints) {
    return false
  }
  
  // 查找该工具名称的 before 和 after 检查点
  const beforeCp = chatStore.checkpoints.find(cp =>
    cp.messageIndex === messageIndex && cp.phase === 'before' && cp.toolName === toolName
  )
  const afterCp = chatStore.checkpoints.find(cp =>
    cp.messageIndex === messageIndex && cp.phase === 'after' && cp.toolName === toolName
  )
  
  // 必须同时存在 before 和 after 才能合并
  if (!beforeCp || !afterCp) return false
  
  return Boolean(beforeCp.contentHash && afterCp.contentHash && beforeCp.contentHash === afterCp.contentHash)
}

// 恢复检查点 - 显示确认对话框
async function restoreCheckpoint(checkpoint: CheckpointRecord) {
  pendingCheckpoint.value = checkpoint
  showRestoreConfirm.value = true
}

// 确认恢复检查点
async function confirmRestore() {
  if (pendingCheckpoint.value) {
    await chatStore.restoreCheckpoint(pendingCheckpoint.value.id)
    pendingCheckpoint.value = null
  }
}

// 获取检查点标签
function getCheckpointLabel(cp: CheckpointRecord, phase: 'before' | 'after'): string {
  if (cp.toolName === 'user_message') {
    return phase === 'before' ? t('components.message.checkpoint.userMessageBefore') : t('components.message.checkpoint.userMessageAfter')
  }
  if (cp.toolName === 'model_message') {
    return phase === 'before' ? t('components.message.checkpoint.assistantMessageBefore') : t('components.message.checkpoint.assistantMessageAfter')
  }
  if (cp.toolName === 'tool_batch') {
    return phase === 'before' ? t('components.message.checkpoint.toolBatchBefore') : t('components.message.checkpoint.toolBatchAfter')
  }
  return phase === 'before' ? t('components.message.checkpoint.toolBatchBefore') : t('components.message.checkpoint.toolBatchAfter')
}

// 获取合并后的标签文案
function getMergedLabel(cp: CheckpointRecord): string {
  if (cp.toolName === 'user_message') {
    return t('components.message.checkpoint.userMessageUnchanged')
  }
  if (cp.toolName === 'model_message') {
    return t('components.message.checkpoint.assistantMessageUnchanged')
  }
  if (cp.toolName === 'tool_batch') {
    return t('components.message.checkpoint.toolBatchUnchanged')
  }
  return t('components.message.checkpoint.toolExecutionUnchanged')
}

// 格式化检查点时间（精确到秒，支持友好显示）
function formatCheckpointTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  
  // 判断是否是今天
  const isToday = date.toDateString() === now.toDateString()
  
  // 时间部分 HH:mm:ss
  const timeStr = formatTime(timestamp, 'HH:mm:ss')
  
  if (isToday) {
    // 今天：只显示时间
    return timeStr
  }
  
  // 计算天数差
  const daysDiff = Math.floor(diff / (1000 * 60 * 60 * 24))
  
  if (daysDiff === 1) {
    // 昨天
    return `${t('components.message.checkpoint.yesterday')} ${timeStr}`
  }
  
  if (daysDiff < 7) {
    // 一周内
    return `${t('components.message.checkpoint.daysAgo', { days: daysDiff })} ${timeStr}`
  }
  
  // 超过一周：显示完整日期
  return formatTime(timestamp, 'YYYY-MM-DD HH:mm:ss')
}
</script>

<template>
  <div class="message-list">
    <div class="message-scroll-area">
      <CustomScrollbar ref="scrollbarRef" sticky-bottom show-jump-buttons marker-selector=".user-message" :width="10" :marker-height="10">
      <div class="messages-container">
        <!-- 自动加载更多指示器 -->
        <div v-if="hasMore" class="load-more-container">
          <i class="codicon codicon-loading codicon-modifier-spin"></i>
          <span v-if="chatStore.historyFolded" class="load-more-text">
            更早消息已折叠（已丢弃 {{ chatStore.foldedMessageCount }} 条），继续上拉可加载
          </span>
        </div>

        <template v-for="row in messageRenderRows" :key="row.key">
          <div v-if="row.kind === 'build'" class="build-sticky-shell">
            <div class="build-bar" :class="{ expanded: isBuildExpanded }">
              <div class="build-header" @click="isBuildExpanded = !isBuildExpanded">
                <div class="build-title">
                  <i class="codicon codicon-tools build-icon"></i>
                  <span class="build-label">{{ buildPanelLabel }}</span>
                  <span class="build-sep">·</span>
                  <span class="build-name">{{ buildPanelName }}</span>
                </div>

                <div class="build-actions">
                  <span v-if="buildTotal > 0" class="build-progress">{{ buildCompleted }}/{{ buildTotal }}</span>
                  <span v-else class="build-progress">—</span>

                  <button
                    class="build-btn"
                    :title="isBuildExpanded ? t('common.collapse') : t('common.expand')"
                    @click.stop="isBuildExpanded = !isBuildExpanded"
                  >
                    <i class="codicon" :class="isBuildExpanded ? 'codicon-chevron-up' : 'codicon-chevron-down'"></i>
                  </button>
                </div>
              </div>

              <div v-if="!isBuildExpanded && buildCurrentText" class="build-current">
                {{ buildCurrentText }}
              </div>

              <div v-if="isBuildExpanded" class="build-body">
                <div v-if="buildTodoItems.length === 0" class="build-empty">
                  <i class="codicon codicon-info"></i>
                  <span>{{ t('components.message.tool.todoPanel.empty') }}</span>
                </div>

                <div v-else class="build-todos">
                  <div
                    v-for="t in buildTodoItems"
                    :key="t.id"
                    class="build-todo"
                    :class="`status-${t.status}`"
                  >
                    <span class="todo-dot" :class="t.status"></span>
                    <span class="todo-text">{{ t.text }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <template v-else-if="row.kind === 'message'">
            <!-- 消息前的检查点（或合并显示） -->
            <template v-if="row.item.beforeCheckpoints.length > 0">
              <div
                v-for="cp in row.item.beforeCheckpoints"
                :key="cp.id"
                class="checkpoint-bar"
                :class="shouldMergeForTool(row.item.backendIndex, cp.toolName) ? 'checkpoint-merged' : 'checkpoint-before'"
              >
                <div class="checkpoint-icon">
                  <i class="codicon" :class="shouldMergeForTool(row.item.backendIndex, cp.toolName) ? 'codicon-check' : 'codicon-archive'"></i>
                </div>
                <div class="checkpoint-info">
                  <span class="checkpoint-label">
                    {{ shouldMergeForTool(row.item.backendIndex, cp.toolName) ? getMergedLabel(cp) : getCheckpointLabel(cp, 'before') }}
                  </span>
                  <span class="checkpoint-meta">{{ t('components.message.checkpoint.fileCount', { count: cp.fileCount }) }}</span>
                </div>
                <span class="checkpoint-time">{{ formatCheckpointTime(cp.timestamp) }}</span>
                <Tooltip :text="t('components.message.checkpoint.restoreTooltip')">
                  <button class="checkpoint-action" @click="restoreCheckpoint(cp)">
                    <i class="codicon codicon-discard"></i>
                  </button>
                </Tooltip>
              </div>
            </template>
            
            <!-- 总结消息使用专用组件 -->
            <SummaryMessage
              v-if="row.item.message.isSummary"
              :message="row.item.message"
            :message-index="row.item.backendIndex"
            />
            
            <!-- 普通消息使用 MessageItem -->
            <MessageItem
              v-else
              :message="row.item.message"
            :message-index="row.item.backendIndex"
              @edit="handleEdit"
              @delete="handleDelete"
              @retry="handleRetry"
              @copy="handleCopy"
              @restore-checkpoint="handleRestoreCheckpoint"
              @restore-and-retry="handleRestoreAndRetry"
              @restore-and-edit="handleRestoreAndEdit"
            />
            
            <!-- 消息后的检查点（仅当该工具的内容有变化时显示） -->
            <template v-if="row.item.afterCheckpoints.length > 0">
              <template v-for="cp in row.item.afterCheckpoints" :key="cp.id">
                <!-- 只有当该工具没有被合并时才显示 after 检查点 -->
                <div
                  v-if="!shouldMergeForTool(row.item.backendIndex, cp.toolName)"
                  class="checkpoint-bar checkpoint-after"
                >
                  <div class="checkpoint-icon">
                    <i class="codicon codicon-archive"></i>
                  </div>
                  <div class="checkpoint-info">
                    <span class="checkpoint-label">{{ getCheckpointLabel(cp, 'after') }}</span>
                    <span class="checkpoint-meta">{{ t('components.message.checkpoint.fileCount', { count: cp.fileCount }) }}</span>
                  </div>
                  <span class="checkpoint-time">{{ formatCheckpointTime(cp.timestamp) }}</span>
                  <Tooltip :text="t('components.message.checkpoint.restoreTooltip')">
                    <button class="checkpoint-action" @click="restoreCheckpoint(cp)">
                      <i class="codicon codicon-discard"></i>
                    </button>
                  </Tooltip>
                </div>
              </template>
            </template>
          </template>

          <div v-else-if="row.kind === 'todo'" class="todo-sticky-shell">
            <div class="build-bar todo-snapshot-bar" :class="{ expanded: isTodoExpanded }">
              <div class="build-header" @click="toggleTodoExpanded()">
                <div class="build-title">
                  <i class="codicon codicon-checklist build-icon todo-snapshot-icon"></i>
                  <span class="build-label">{{ t('components.message.tool.todoWrite.label') }}</span>
                  <span class="build-sep">·</span>
                  <span class="build-name">{{ todoPanelName }}</span>
                </div>

                <div class="build-actions">
                  <span v-if="todoTotal > 0" class="build-progress">{{ todoCompleted }}/{{ todoTotal }}</span>
                  <span v-else class="build-progress">—</span>

                  <button
                    class="build-btn"
                    :title="isTodoExpanded ? t('common.collapse') : t('common.expand')"
                    @click.stop="toggleTodoExpanded()"
                  >
                    <i class="codicon" :class="isTodoExpanded ? 'codicon-chevron-up' : 'codicon-chevron-down'"></i>
                  </button>
                </div>
              </div>

              <div v-if="!isTodoExpanded && todoCurrentText" class="build-current">
                {{ todoCurrentText }}
              </div>

              <div v-if="isTodoExpanded" class="build-body">
                <div v-if="todoBarItems.length === 0" class="build-empty">
                  <i class="codicon codicon-info"></i>
                  <span>{{ t('components.message.tool.todoPanel.empty') }}</span>
                </div>

                <div v-else class="build-todos">
                  <div v-for="t in todoBarItems" :key="t.id" class="build-todo" :class="`status-${t.status}`">
                    <span class="todo-dot" :class="t.status"></span>
                    <span class="todo-text">{{ t.text }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
        
        <!-- 继续对话提示 - 当最后一条是工具响应时显示 -->
        <div v-if="chatStore.needsContinueButton" class="continue-message">
          <div class="continue-icon">
            <i class="codicon codicon-debug-pause"></i>
          </div>
          <div class="continue-content">
            <div class="continue-title">{{ t('components.message.continue.title') }}</div>
            <div class="continue-text">{{ t('components.message.continue.description') }}</div>
          </div>
          <div class="continue-actions">
            <button class="continue-btn" @click="handleContinue">
              <span class="codicon codicon-play"></span>
              <span class="btn-text">{{ t('components.message.continue.button') }}</span>
            </button>
          </div>
        </div>
        
        <!-- 错误提示 - 显示在消息末尾 -->
        <div v-if="chatStore.error" class="error-message">
          <div class="error-header">
            <div class="error-icon">⚠</div>
            <div class="error-title">{{ t('components.message.error.title') }}</div>
            <div class="error-actions">
              <button class="error-retry" @click="handleErrorRetry" :title="t('components.message.error.retry')">
                <span class="codicon codicon-refresh"></span>
              </button>
              <button class="error-dismiss" @click="chatStore.error = null" :title="t('components.message.error.dismiss')">
                ✕
              </button>
            </div>
          </div>
          <div class="error-body">
            <CustomScrollbar :max-height="120" :width="4">
              <pre class="error-text-code">{{ chatStore.error.code }}: {{ chatStore.error.message }}</pre>
            </CustomScrollbar>
          </div>
        </div>
      </div>
      </CustomScrollbar>
    </div>
    
    <!-- 删除确认对话框 -->
    <DeleteDialog
      v-model="showDeleteConfirm"
      :checkpoints="deleteCheckpoints"
      :delete-count="deleteCount"
      @delete="confirmDelete"
      @restore-and-delete="handleRestoreAndDelete"
      @cancel="cancelDelete"
    />
    
    <!-- 恢复检查点确认对话框 -->
    <ConfirmDialog
      v-model="showRestoreConfirm"
      :title="t('components.message.checkpoint.restoreConfirmTitle')"
      :message="t('components.message.checkpoint.restoreConfirmMessage')"
      :confirm-text="t('components.message.checkpoint.restoreConfirmBtn')"
      is-danger
      @confirm="confirmRestore"
    />
    
  </div>
</template>

<style scoped>
.message-list {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: var(--vscode-editor-background);
}

.message-scroll-area {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* ============ Build 顶部卡片（Cursor-like，保持 LimCode 面板风格） ============ */
.build-sticky-shell {
  position: sticky;
  top: 0;
  z-index: 6;
  padding: 8px var(--spacing-md, 16px) 0;
  background: var(--vscode-editor-background);
}


.todo-sticky-shell {
  position: sticky;
  top: 0;
  z-index: 5;
  padding: 8px var(--spacing-md, 16px) 0;
  background: var(--vscode-editor-background);
}

.todo-snapshot-icon {
  color: var(--vscode-charts-blue, #3794ff);
}

.build-bar {
  margin: 0;
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-sm, 2px);
  overflow: hidden;
  background: var(--vscode-editor-background);
  flex-shrink: 0;
}

.build-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm, 8px);
  padding: 6px 10px;
  background: var(--vscode-editor-inactiveSelectionBackground);
  cursor: pointer;
  user-select: none;
}

.build-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.build-icon {
  font-size: 12px;
  color: var(--vscode-charts-orange, #e69500);
  flex-shrink: 0;
}

.build-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--vscode-foreground);
  flex-shrink: 0;
}

.build-sep {
  color: var(--vscode-descriptionForeground);
  opacity: 0.7;
  flex-shrink: 0;
}

.build-name {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.build-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.build-progress {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  opacity: 0.8;
  min-width: 42px;
  text-align: right;
}

.build-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.build-btn:hover {
  background: var(--vscode-toolbar-hoverBackground);
  color: var(--vscode-foreground);
}

.build-current {
  padding: 4px 10px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  background: var(--vscode-editor-background);
  border-top: 1px solid var(--vscode-panel-border);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.build-body {
  padding: 8px 10px 10px;
  background: var(--vscode-editor-background);
  border-top: 1px solid var(--vscode-panel-border);
}

.build-empty {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  opacity: 0.85;
  padding: 6px 2px;
}

.build-todos {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.build-todo {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  color: var(--vscode-foreground);
}

.todo-dot {
  width: 8px;
  height: 8px;
  margin-top: 4px;
  border-radius: 999px;
  background: var(--vscode-panel-border);
  flex-shrink: 0;
}

.todo-dot.pending {
  background: color-mix(in srgb, var(--vscode-foreground) 25%, transparent);
}

.todo-dot.in_progress {
  background: var(--vscode-charts-blue, #3794ff);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--vscode-charts-blue) 18%, transparent);
}

.todo-dot.completed {
  background: var(--vscode-testing-iconPassed);
}

.todo-dot.cancelled {
  background: var(--vscode-testing-iconFailed);
}

.build-todo.status-completed .todo-text {
  color: var(--vscode-descriptionForeground);
  text-decoration: line-through;
  opacity: 0.85;
}

.build-todo.status-cancelled .todo-text {
  color: var(--vscode-descriptionForeground);
  text-decoration: line-through;
  opacity: 0.6;
}

.todo-text {
  line-height: 1.35;
  word-break: break-word;
}

.messages-container {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

/* 加载更多指示器 */
.load-more-container {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  padding: 12px;
  color: var(--vscode-descriptionForeground);
  opacity: 0.7;
}

.load-more-container .codicon {
  font-size: 16px;
}

.load-more-text {
  font-size: 11px;
  line-height: 1.3;
  max-width: 90%;
  text-align: center;
  white-space: normal;
}

/* 错误提示 - 扁平化设计，类似重试面板样式 */
.error-message {
  display: flex;
  flex-direction: column;
  margin: 0 var(--spacing-md, 16px) var(--spacing-md, 16px);
  background: var(--vscode-textBlockQuote-background, rgba(127, 127, 127, 0.1));
  border: 1px solid var(--vscode-panel-border, rgba(127, 127, 127, 0.3));
  border-radius: 6px;
  flex-shrink: 0;
  overflow: hidden;
}

.error-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.1);
  border-bottom: 1px solid var(--vscode-panel-border, rgba(127, 127, 127, 0.2));
}

.error-icon {
  flex-shrink: 0;
  font-size: 14px;
  color: var(--vscode-errorForeground, #f48771);
}

.error-title {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--vscode-foreground);
}

.error-body {
  padding: 12px;
}

.error-text-code {
  font-size: 11px;
  color: var(--vscode-foreground);
  line-height: 1.4;
  word-break: break-word;
  white-space: pre-wrap;
  font-family: var(--vscode-editor-font-family, monospace);
  background: rgba(0, 0, 0, 0.15);
  padding: 8px;
  border-radius: 4px;
  margin: 0;
}

.error-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.error-retry,
.error-dismiss {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--vscode-foreground);
  opacity: 0.6;
  cursor: pointer;
  font-size: 14px;
  border-radius: 4px;
  transition: opacity 0.2s, background 0.2s;
}

.error-retry:hover,
.error-dismiss:hover {
  opacity: 1;
  background: var(--vscode-toolbar-hoverBackground);
}

.error-retry .codicon {
  font-size: 14px;
}

/* 继续对话提示 */
.continue-message {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-md, 16px);
  margin: 0 var(--spacing-md, 16px) var(--spacing-md, 16px);
  background: var(--vscode-textBlockQuote-background, rgba(127, 127, 127, 0.1));
  border: 1px solid var(--vscode-panel-border, rgba(127, 127, 127, 0.3));
  border-radius: 2px;
  flex-shrink: 0;
}

.continue-icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--vscode-descriptionForeground);
}

.continue-icon .codicon {
  font-size: 16px;
}

.continue-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.continue-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.continue-text {
  font-size: 11px;
  line-height: 1.4;
  color: var(--vscode-descriptionForeground);
}

.continue-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.continue-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--vscode-toolbar-activeBackground, rgba(127, 127, 127, 0.2));
  color: var(--vscode-foreground);
  border: 1px solid var(--vscode-panel-border, rgba(127, 127, 127, 0.3));
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s;
}

.continue-btn:hover {
  background: var(--vscode-toolbar-hoverBackground, rgba(127, 127, 127, 0.3));
}

.continue-btn .codicon {
  font-size: 12px;
}

.btn-text {
  font-weight: 500;
}

/* 检查点条 */
.checkpoint-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  margin: 0;
  background: var(--vscode-editor-background);
  border-left: 2px solid var(--vscode-charts-yellow, #ddb92f);
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.checkpoint-bar.checkpoint-before {
  border-left-color: var(--vscode-charts-yellow, #ddb92f);
}

.checkpoint-bar.checkpoint-after {
  border-left-color: var(--vscode-charts-green, #89d185);
}

.checkpoint-bar.checkpoint-merged {
  border-left-color: var(--vscode-charts-blue, #75beff);
}

.checkpoint-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.checkpoint-before .checkpoint-icon {
  color: var(--vscode-charts-yellow, #ddb92f);
}

.checkpoint-after .checkpoint-icon {
  color: var(--vscode-charts-green, #89d185);
}

.checkpoint-merged .checkpoint-icon {
  color: var(--vscode-charts-blue, #75beff);
}

.checkpoint-icon .codicon {
  font-size: 14px;
}

.checkpoint-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.checkpoint-label {
  font-weight: 500;
}

.checkpoint-before .checkpoint-label {
  color: var(--vscode-charts-yellow, #ddb92f);
}

.checkpoint-after .checkpoint-label {
  color: var(--vscode-charts-green, #89d185);
}

.checkpoint-merged .checkpoint-label {
  color: var(--vscode-charts-blue, #75beff);
}

.checkpoint-meta {
  color: var(--vscode-descriptionForeground);
  opacity: 0.8;
}

.checkpoint-time {
  color: var(--vscode-descriptionForeground);
  opacity: 0.7;
  font-size: 11px;
  flex-shrink: 0;
  margin-left: auto;
}

.checkpoint-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  border-radius: 4px;
  opacity: 0.6;
  transition: opacity 0.15s, background 0.15s;
}

.checkpoint-action:hover {
  opacity: 1;
  background: var(--vscode-list-hoverBackground);
}

.checkpoint-action .codicon {
  font-size: 14px;
}
</style>