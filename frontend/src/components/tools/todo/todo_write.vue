<script setup lang="ts">
/**
 * todo_write 工具的内容面板
 * 
 * 风格完全继承自 write_file.vue
 */

import { computed, ref, onBeforeUnmount } from 'vue'
import CustomScrollbar from '../../common/CustomScrollbar.vue'
import { useI18n } from '@/composables'

type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

interface TodoItem {
  id: string
  content: string
  status: TodoStatus
}

const { t } = useI18n()

const props = defineProps<{
  args: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
}>()

// 复制状态
const copiedMarkdown = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null

function normalizeTodos(input: unknown): TodoItem[] {
  if (!Array.isArray(input)) return []
  const out: TodoItem[] = []
  for (const item of input) {
    const id = (item as any)?.id
    const content = (item as any)?.content
    const status = (item as any)?.status
    if (typeof id !== 'string' || typeof content !== 'string') continue
    if (status !== 'pending' && status !== 'in_progress' && status !== 'completed' && status !== 'cancelled') continue
    out.push({ id, content, status })
  }
  return out
}

const resultData = computed(() => (props.result as any)?.data || {})

const todos = computed<TodoItem[]>(() => {
  const fromResult = normalizeTodos(resultData.value?.todos || resultData.value?.todoList)
  if (fromResult.length > 0) return fromResult
  return normalizeTodos((props.args as any)?.todos)
})

const sortedTodos = computed(() => {
  const order: Record<TodoStatus, number> = {
    in_progress: 0,
    pending: 1,
    completed: 2,
    cancelled: 3
  }
  return [...todos.value].sort((a, b) => {
    const oa = order[a.status] ?? 9
    const ob = order[b.status] ?? 9
    if (oa !== ob) return oa - ob
    return a.id.localeCompare(b.id)
  })
})

const counts = computed(() => {
  const c: Record<TodoStatus, number> = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    cancelled: 0
  }
  for (const item of todos.value) c[item.status]++
  return c
})

const total = computed(() => todos.value.length)

const modeLabel = computed(() => {
  const merge = (props.args as any)?.merge
  if (merge === true) return 'merge'
  return ''
})

function getStatusIcon(status: TodoStatus): string {
  switch (status) {
    case 'pending':
      return 'codicon-circle-outline'
    case 'in_progress':
      return 'codicon-loading codicon-modifier-spin'
    case 'completed':
      return 'codicon-pass-filled'
    case 'cancelled':
      return 'codicon-circle-slash'
  }
}

function getStatusLabel(status: TodoStatus): string {
  switch (status) {
    case 'pending':
      return '待做'
    case 'in_progress':
      return '进行中'
    case 'completed':
      return '完成'
    case 'cancelled':
      return '取消'
  }
}

function toMarkdownList(items: TodoItem[]): string {
  return items
    .map(i => {
      const box = i.status === 'completed' ? '[x]' : '[ ]'
      const suffix = i.status === 'cancelled' ? ' (cancelled)' : (i.status === 'in_progress' ? ' (in progress)' : '')
      return `- ${box} ${i.content}${suffix}  \`#${i.id}\``
    })
    .join('\n')
}

async function copyMarkdown() {
  try {
    const text = toMarkdownList(sortedTodos.value)
    if (!text) return
    await navigator.clipboard.writeText(text)
    copiedMarkdown.value = true
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copiedMarkdown.value = false
      copyTimer = null
    }, 1000)
  } catch (e) {
    console.error('复制失败:', e)
  }
}

onBeforeUnmount(() => {
  if (copyTimer) clearTimeout(copyTimer)
})
</script>

<template>
  <div class="todo-panel">
    <!-- 总体统计头部 -->
    <div class="panel-header">
      <div class="header-info">
        <span class="codicon codicon-checklist todo-icon"></span>
        <span class="title">TODO 列表</span>
        <span v-if="modeLabel" class="mode-badge">{{ modeLabel }}</span>
      </div>
      <div class="header-stats">
        <span v-if="counts.in_progress > 0" class="stat progress">
          <span class="codicon codicon-sync"></span>
          {{ counts.in_progress }}
        </span>
        <span v-if="counts.completed > 0" class="stat success">
          <span class="codicon codicon-check"></span>
          {{ counts.completed }}
        </span>
        <span v-if="counts.cancelled > 0" class="stat error">
          <span class="codicon codicon-close"></span>
          {{ counts.cancelled }}
        </span>
        <span class="stat total">共 {{ total }} 项</span>
      </div>
    </div>

    <!-- 全局错误 -->
    <div v-if="props.error || (props.result as any)?.error" class="panel-error">
      <span class="codicon codicon-error error-icon"></span>
      <span class="error-text">{{ props.error || (props.result as any)?.error }}</span>
    </div>

    <!-- TODO 列表 -->
    <div v-else-if="total > 0" class="todo-list">
      <CustomScrollbar :max-height="300">
        <div class="todo-items">
          <div
            v-for="item in sortedTodos"
            :key="item.id"
            :class="['todo-item', item.status]"
          >
            <!-- TODO 头部 -->
            <div class="item-header">
              <div class="item-info">
                <span :class="['item-icon', 'codicon', getStatusIcon(item.status)]"></span>
                <span class="item-content">{{ item.content }}</span>
              </div>
              <div class="item-actions">
                <span :class="['status-badge', item.status]">{{ getStatusLabel(item.status) }}</span>
              </div>
            </div>
            <!-- TODO ID -->
            <div class="item-id">#{{ item.id }}</div>
          </div>
        </div>
      </CustomScrollbar>

      <!-- 底部操作 -->
      <div class="panel-footer">
        <button
          class="action-btn"
          :class="{ 'copied': copiedMarkdown }"
          :title="copiedMarkdown ? '已复制' : '复制为 Markdown'"
          @click="copyMarkdown"
        >
          <span :class="['codicon', copiedMarkdown ? 'codicon-check' : 'codicon-copy']"></span>
          <span class="btn-text">{{ copiedMarkdown ? '已复制' : '复制 Markdown' }}</span>
        </button>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="panel-empty">
      <span class="codicon codicon-info"></span>
      <span>暂无 TODO</span>
    </div>
  </div>
</template>

<style scoped>
.todo-panel {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
}

/* 总体头部 - 继承 write_file 风格 */
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-xs, 4px) 0;
}

.header-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
}

.todo-icon {
  color: var(--vscode-charts-blue, #3794ff);
  font-size: 14px;
}

.title {
  font-weight: 600;
  font-size: 12px;
  color: var(--vscode-foreground);
}

.mode-badge {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 2px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  margin-left: var(--spacing-xs, 4px);
  font-weight: 500;
}

.header-stats {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
}

.stat {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.stat.progress {
  color: var(--vscode-charts-blue);
}

.stat.success {
  color: var(--vscode-testing-iconPassed);
}

.stat.error {
  color: var(--vscode-testing-iconFailed);
}

/* 全局错误 - 继承 write_file 风格 */
.panel-error {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-sm, 8px);
  background: var(--vscode-inputValidation-errorBackground);
  border: 1px solid var(--vscode-inputValidation-errorBorder);
  border-radius: var(--radius-sm, 2px);
}

.error-icon {
  color: var(--vscode-inputValidation-errorForeground);
  font-size: 14px;
  flex-shrink: 0;
}

.error-text {
  font-size: 12px;
  color: var(--vscode-inputValidation-errorForeground);
  line-height: 1.4;
}

/* TODO 列表 */
.todo-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs, 4px);
}

.todo-items {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs, 4px);
}

/* 单个 TODO 项 - 继承 file-panel 风格 */
.todo-item {
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-sm, 2px);
  overflow: hidden;
}

.todo-item.completed {
  opacity: 0.7;
}

.todo-item.cancelled {
  opacity: 0.5;
}

/* TODO 头部 - 继承 file-header 风格 */
.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-bottom: 1px solid var(--vscode-panel-border);
}

.item-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  flex: 1;
  min-width: 0;
}

.item-icon {
  font-size: 12px;
  flex-shrink: 0;
}

.todo-item.pending .item-icon {
  color: var(--vscode-descriptionForeground);
}

.todo-item.in_progress .item-icon {
  color: var(--vscode-charts-blue);
}

.todo-item.completed .item-icon {
  color: var(--vscode-testing-iconPassed);
}

.todo-item.cancelled .item-icon {
  color: var(--vscode-testing-iconFailed);
}

.item-content {
  font-size: 11px;
  color: var(--vscode-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.todo-item.completed .item-content,
.todo-item.cancelled .item-content {
  text-decoration: line-through;
}

.item-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
}

.status-badge {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 2px;
  font-weight: 500;
}

.status-badge.pending {
  background: var(--vscode-descriptionForeground);
  color: var(--vscode-editor-background);
}

.status-badge.in_progress {
  background: var(--vscode-charts-blue);
  color: #fff;
}

.status-badge.completed {
  background: var(--vscode-testing-iconPassed);
  color: #fff;
}

.status-badge.cancelled {
  background: var(--vscode-testing-iconFailed);
  color: #fff;
}

/* TODO ID - 继承 file-path 风格 */
.item-id {
  padding: 2px var(--spacing-sm, 8px);
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  font-family: var(--vscode-editor-font-family);
  background: var(--vscode-editor-background);
}

/* 底部操作 */
.panel-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: var(--spacing-xs, 4px);
}

.action-btn {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  padding: 2px var(--spacing-sm, 8px);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm, 2px);
  font-size: 10px;
  color: var(--vscode-textLink-foreground);
  cursor: pointer;
  transition: opacity var(--transition-fast, 0.1s);
}

.action-btn:hover {
  opacity: 0.8;
}

.action-btn.copied {
  color: var(--vscode-testing-iconPassed);
}

.btn-text {
  font-size: 10px;
}

/* 空状态 - 继承 file-empty 风格 */
.panel-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-sm, 8px);
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
}
</style>
