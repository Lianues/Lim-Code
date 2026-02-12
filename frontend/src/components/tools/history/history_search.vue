<script setup lang="ts">
/**
 * history_search 工具的内容面板
 *
 * 显示被上下文总结压缩的历史对话内容，支持两种模式：
 * - search: 显示搜索结果（匹配行 + 上下文）
 * - read:   显示指定行号范围的内容
 *
 * 后端返回的 data 是带行号的纯文本，类似 read_file 的输出格式。
 */

import { computed, ref, onBeforeUnmount } from 'vue'
import CustomScrollbar from '../../common/CustomScrollbar.vue'
import { useI18n } from '@/composables'

const props = defineProps<{
  args: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
}>()

const { t } = useI18n()

// 展开状态
const expanded = ref(false)

// 复制状态
const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null

// 获取模式
const mode = computed(() => (props.args.mode as string) || 'search')

// 获取搜索关键词
const query = computed(() => (props.args.query as string) || '')
const isRegex = computed(() => (props.args.is_regex as boolean) || false)

// 获取行号范围
const startLine = computed(() => props.args.start_line as number | undefined)
const endLine = computed(() => props.args.end_line as number | undefined)

// 获取结果文本
const resultText = computed(() => {
  if (!props.result) return ''
  const data = (props.result as any)?.data
  if (typeof data === 'string') return data
  return ''
})

// 将结果按行分割
const resultLines = computed(() => {
  if (!resultText.value) return []
  return resultText.value.split('\n')
})

// 预览行数
const previewLineCount = 20

// 获取显示的内容
const displayContent = computed(() => {
  if (expanded.value || resultLines.value.length <= previewLineCount) {
    return resultText.value
  }
  return resultLines.value.slice(0, previewLineCount).join('\n')
})

// 是否需要展开按钮
const needsExpand = computed(() => resultLines.value.length > previewLineCount)

// 获取模式图标
const modeIcon = computed(() => {
  return mode.value === 'read' ? 'codicon-file-text' : 'codicon-search'
})

// 获取模式标题
const modeTitle = computed(() => {
  return mode.value === 'read'
    ? t('components.tools.history.panel.readTitle')
    : t('components.tools.history.panel.searchTitle')
})

// 获取行号范围显示文本
const lineRangeText = computed(() => {
  if (mode.value !== 'read') return ''
  if (startLine.value !== undefined && endLine.value !== undefined) {
    return `L${startLine.value}-${endLine.value}`
  }
  if (startLine.value !== undefined) {
    return `L${startLine.value}+`
  }
  return ''
})

// 切换展开
function toggleExpand() {
  expanded.value = !expanded.value
}

// 复制内容
async function copyContent() {
  if (!resultText.value) return
  try {
    await navigator.clipboard.writeText(resultText.value)
    copied.value = true
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copied.value = false
      copyTimer = null
    }, 1000)
  } catch (e) {
    console.error('Copy failed:', e)
  }
}

onBeforeUnmount(() => {
  if (copyTimer) clearTimeout(copyTimer)
})
</script>

<template>
  <div class="history-search-panel">
    <!-- 头部 -->
    <div class="panel-header">
      <div class="header-info">
        <span :class="['codicon', modeIcon, 'mode-icon']"></span>
    <span class="title">{{ modeTitle }}</span>
        <span v-if="isRegex && mode === 'search'" class="regex-badge">{{ t('components.tools.history.panel.regex') }}</span>
      </div>
      <div class="header-actions">
        <button
          v-if="resultText"
          class="action-btn"
          :class="{ copied }"
          :title="copied ? t('components.tools.history.panel.copied') : t('components.tools.history.panel.copyContent')"
          @click.stop="copyContent"
        >
          <span :class="['codicon', copied ? 'codicon-check' : 'codicon-copy']"></span>
        </button>
      </div>
    </div>

    <!-- 搜索信息 -->
    <div v-if="mode === 'search' && query" class="search-info">
      <div class="query-row">
        <span class="label">{{ t('components.tools.history.panel.keywords') }}</span>
        <code class="query-text">{{ query }}</code>
      </div>
    </div>

    <!-- 行号范围信息 -->
    <div v-if="mode === 'read' && lineRangeText" class="search-info">
      <div class="query-row">
        <span class="label">{{ t('components.tools.history.panel.lineRange') }}</span>
        <code class="query-text">{{ lineRangeText }}</code>
      </div>
    </div>

    <!-- 全局错误 -->
    <div v-if="error" class="panel-error">
      <span class="codicon codicon-error error-icon"></span>
      <span class="error-text">{{ error }}</span>
    </div>

    <!-- 无结果 -->
    <div v-else-if="!resultText" class="panel-empty">
      <span class="codicon codicon-info"></span>
      <span>{{ t('components.tools.history.panel.noContent') }}</span>
    </div>

    <!-- 结果内容 -->
    <div v-else class="result-content" :class="{ expanded }">
      <div class="content-wrapper">
        <CustomScrollbar :horizontal="true">
          <pre class="content-code"><code>{{ displayContent }}</code></pre>
        </CustomScrollbar>
      </div>

      <!-- 展开/收起按钮 -->
      <div v-if="needsExpand" class="expand-section">
        <button class="expand-btn" @click="toggleExpand">
          <span :class="['codicon', expanded ? 'codicon-chevron-up' : 'codicon-chevron-down']"></span>
          {{ expanded
            ? t('components.tools.history.panel.collapse')
            : t('components.tools.history.panel.expandRemaining', { count: resultLines.length - previewLineCount })
          }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-search-panel {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
}

/* 头部 */
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

.mode-icon {
  color: var(--vscode-charts-purple);
  font-size: 14px;
}

.title {
  font-weight: 600;
  font-size: 12px;
  color: var(--vscode-foreground);
}

.regex-badge {
  font-size: 9px;
  padding: 1px 4px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: 2px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm, 2px);
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  transition: all var(--transition-fast, 0.1s);
}

.action-btn:hover {
  background: var(--vscode-toolbar-hoverBackground);
  color: var(--vscode-foreground);
}

.action-btn.copied {
  color: var(--vscode-testing-iconPassed);
}

/* 搜索信息 */
.search-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-radius: var(--radius-sm, 2px);
}

.query-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  font-size: 11px;
}

.label {
  color: var(--vscode-descriptionForeground);
  flex-shrink: 0;
}

.query-text {
  font-family: var(--vscode-editor-font-family);
  font-weight: 600;
  color: var(--vscode-foreground);
  background: rgba(230, 149, 0, 0.18);
  border: 1px solid rgba(230, 149, 0, 0.35);
  padding: 0 6px;
  border-radius: 2px;
}

/* 错误显示 */
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

/* 空状态 */
.panel-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-md, 16px);
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

/* 结果内容 */
.result-content {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-sm, 2px);
  overflow: hidden;
  background: var(--vscode-editor-background);
}

.content-wrapper {
  height: 200px;
  position: relative;
}

.result-content.expanded .content-wrapper {
  height: 400px;
}

.content-code {
  margin: 0;
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  font-size: 11px;
  font-family: var(--vscode-editor-font-family);
  color: var(--vscode-foreground);
  line-height: 1.4;
  white-space: pre;
}

.content-code code {
  font-family: inherit;
}

/* 展开区域 */
.expand-section {
  display: flex;
  justify-content: center;
  padding: 2px;
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-top: 1px solid var(--vscode-panel-border);
}

.expand-btn {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  padding: 2px var(--spacing-sm, 8px);
  background: transparent;
  border: none;
  font-size: 10px;
  color: var(--vscode-textLink-foreground);
  cursor: pointer;
  transition: opacity var(--transition-fast, 0.1s);
}

.expand-btn:hover {
  opacity: 0.8;
}
</style>
