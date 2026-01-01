<script setup lang="ts">
/**
 * google_search 工具的内容面板
 * 
 * 显示：
 * - 搜索查询
 * - 搜索结果文本
 * - 错误信息
 */

import { computed } from 'vue'
import { useI18n } from '../../../composables/useI18n'

const { t } = useI18n()

const props = defineProps<{
  args: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
}>()

// 获取查询词
const query = computed(() => {
  return props.args.query as string || ''
})

// 获取搜索结果
const searchResult = computed(() => {
  const result = props.result as Record<string, any> | undefined
  if (result?.success && result?.data) {
    return result.data as string
  }
  return null
})

// 获取错误信息
const errorMessage = computed(() => {
  if (props.error) return props.error
  const result = props.result as Record<string, any> | undefined
  if (result && !result.success && result.error) {
    return result.error as string
  }
  return null
})

// 是否正在加载（没有结果也没有错误）
const isLoading = computed(() => {
  return !searchResult.value && !errorMessage.value
})
</script>

<template>
  <div class="google-search-panel">
    <!-- 头部 -->
    <div class="panel-header">
      <div class="header-info">
        <span class="codicon codicon-search search-icon"></span>
        <span class="title">Google Search</span>
      </div>
      <div v-if="query" class="query-text">{{ query }}</div>
    </div>
    
    <!-- 加载状态 -->
    <div v-if="isLoading" class="loading-state">
      <span class="codicon codicon-loading codicon-modifier-spin"></span>
      <span>{{ t('common.loading') }}</span>
    </div>
    
    <!-- 错误信息 -->
    <div v-else-if="errorMessage" class="panel-error">
      <span class="codicon codicon-error error-icon"></span>
      <span class="error-text">{{ errorMessage }}</span>
    </div>
    
    <!-- 搜索结果 -->
    <div v-else-if="searchResult" class="search-result">
      <div class="result-content">{{ searchResult }}</div>
    </div>
    
    <!-- 无结果 -->
    <div v-else class="no-results">
      <span class="codicon codicon-info"></span>
      <span>{{ t('components.tools.search.searchInFilesPanel.noResults') }}</span>
    </div>
  </div>
</template>

<style scoped>
.google-search-panel {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
}

/* 头部 */
.panel-header {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs, 4px);
}

.header-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
}

.search-icon {
  color: var(--vscode-charts-blue);
  font-size: 14px;
}

.title {
  font-weight: 600;
  font-size: 12px;
  color: var(--vscode-foreground);
}

.query-text {
  font-size: 11px;
  font-family: var(--vscode-editor-font-family);
  color: var(--vscode-descriptionForeground);
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-radius: var(--radius-sm, 2px);
  word-break: break-word;
}

/* 加载状态 */
.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-md, 16px);
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

/* codicon loading spin 动画 */
@keyframes codicon-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.codicon-modifier-spin {
  animation: codicon-spin 1s linear infinite;
}

/* 错误状态 */
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
  word-break: break-word;
}

/* 搜索结果 */
.search-result {
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-sm, 2px);
  overflow: hidden;
}

.result-content {
  padding: var(--spacing-sm, 8px);
  font-size: 12px;
  color: var(--vscode-foreground);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--vscode-editor-background);
}

/* 无结果 */
.no-results {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-sm, 8px);
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
}
</style>
