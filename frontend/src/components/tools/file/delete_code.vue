<script setup lang="ts">
/**
 * delete_code 工具的内容面板
 *
 * 支持批量删除，每个文件一个小面板显示
 * 显示：
 * - 文件名（标题）+ 删除范围
 * - 文件路径
 * - 操作结果状态
 */

import { computed } from 'vue'

const props = defineProps<{
  args: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
}>()

// 单个删除条目
interface DeleteEntry {
  path: string
  start_line: number
  end_line: number
}

// 单个删除结果
interface DeleteResult {
  path: string
  success: boolean
  start_line?: number
  end_line?: number
  deletedLines?: number
  status?: string
  error?: string
}

// 获取文件列表（从参数中）
const fileList = computed((): DeleteEntry[] => {
  const files = props.args.files as DeleteEntry[] | undefined
  return files && Array.isArray(files) ? files : []
})

// 获取删除结果列表（从结果中）
const deleteResults = computed((): DeleteResult[] => {
  const result = props.result as Record<string, any> | undefined
  if (result?.data?.results) {
    return result.data.results as DeleteResult[]
  }
  return fileList.value.map(f => ({
    path: f.path,
    success: !props.error,
    error: props.error
  }))
})

// 合并文件列表和结果
interface MergedFile {
  path: string
  start_line: number
  end_line: number
  deletedCount: number
  result: DeleteResult | undefined
}

const mergedFiles = computed((): MergedFile[] => {
  return fileList.value.map(entry => {
    const result = deleteResults.value.find(r => r.path === entry.path)
    return {
      path: entry.path,
      start_line: entry.start_line,
      end_line: entry.end_line,
      deletedCount: entry.end_line - entry.start_line + 1,
      result
    }
  })
})

// 统计
const successCount = computed(() => {
  const result = props.result as Record<string, any> | undefined
  if (result?.data?.successCount !== undefined) return result.data.successCount as number
  return deleteResults.value.filter(r => r.success).length
})

const failCount = computed(() => {
  const result = props.result as Record<string, any> | undefined
  if (result?.data?.failCount !== undefined) return result.data.failCount as number
  return deleteResults.value.filter(r => !r.success).length
})

// 获取文件名
function getFileName(fp: string): string {
  const parts = fp.split(/[/\\]/)
  return parts[parts.length - 1] || fp
}

function getFileExtension(fp: string): string {
  const name = getFileName(fp)
  const idx = name.lastIndexOf('.')
  return idx > 0 ? name.substring(idx + 1) : ''
}

function getFileNameWithoutExt(fp: string): string {
  const name = getFileName(fp)
  const idx = name.lastIndexOf('.')
  return idx > 0 ? name.substring(0, idx) : name
}
</script>

<template>
  <div class="delete-code-panel">
    <!-- 总体统计头部 -->
    <div class="panel-header">
      <div class="header-info">
        <span class="codicon codicon-diff-removed files-icon"></span>
        <span class="title">删除代码</span>
      </div>
      <div class="header-stats">
        <span v-if="successCount > 0" class="stat success">
          <span class="codicon codicon-check"></span>
          {{ successCount }}
        </span>
        <span v-if="failCount > 0" class="stat error">
          <span class="codicon codicon-error"></span>
          {{ failCount }}
        </span>
        <span class="stat total">共 {{ mergedFiles.length }} 个文件</span>
      </div>
    </div>

    <!-- 全局错误 -->
    <div v-if="error && mergedFiles.length === 0" class="panel-error">
      <span class="codicon codicon-error error-icon"></span>
      <span class="error-text">{{ error }}</span>
    </div>

    <!-- 文件列表 -->
    <div v-else class="file-list">
      <div
        v-for="file in mergedFiles"
        :key="file.path"
        :class="['file-panel', { 'is-error': file.result && !file.result.success }]"
      >
        <!-- 文件头部 -->
        <div class="file-header">
          <div class="file-info">
            <span class="codicon codicon-diff-removed file-icon"></span>
            <span class="file-name">{{ getFileNameWithoutExt(file.path) }}</span>
            <span v-if="getFileExtension(file.path)" class="file-ext">.{{ getFileExtension(file.path) }}</span>
            <span class="delete-badge">删除第 {{ file.start_line }}~{{ file.end_line }} 行</span>
            <span class="line-count">{{ file.deletedCount }} 行</span>
          </div>
        </div>

        <!-- 文件路径 -->
        <div class="file-path">{{ file.path }}</div>

        <!-- 状态显示 -->
        <div v-if="file.result && !file.result.success && file.result.error" class="file-error">
          <span class="codicon codicon-error"></span>
          {{ file.result.error }}
        </div>
        <div v-else-if="file.result?.status === 'accepted'" class="file-success">
          <span class="codicon codicon-check"></span>
          已删除 {{ file.deletedCount }} 行
        </div>
        <div v-else-if="!props.result" class="file-info-bar">
          <span class="codicon codicon-info"></span>
          将删除第 {{ file.start_line }} 行到第 {{ file.end_line }} 行（共 {{ file.deletedCount }} 行）
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.delete-code-panel {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
}

/* 总体头部 */
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

.files-icon {
  color: var(--vscode-gitDecoration-deletedResourceForeground, #f85149);
  font-size: 14px;
}

.title {
  font-weight: 600;
  font-size: 12px;
  color: var(--vscode-foreground);
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

.stat.success {
  color: var(--vscode-testing-iconPassed);
}

.stat.error {
  color: var(--vscode-testing-iconFailed);
}

/* 全局错误 */
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

/* 文件列表 */
.file-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
}

/* 单个文件面板 */
.file-panel {
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-sm, 2px);
  overflow: hidden;
}

.file-panel.is-error {
  border-color: var(--vscode-inputValidation-errorBorder);
}

/* 文件头部 */
.file-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-bottom: 1px solid var(--vscode-panel-border);
}

.file-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  flex: 1;
  min-width: 0;
}

.file-icon {
  font-size: 12px;
  color: var(--vscode-gitDecoration-deletedResourceForeground, #f85149);
  flex-shrink: 0;
}

.file-panel.is-error .file-icon {
  color: var(--vscode-inputValidation-errorForeground);
}

.file-name {
  font-size: 11px;
  font-weight: 500;
  color: var(--vscode-foreground);
}

.file-ext {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
}

.delete-badge {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 2px;
  margin-left: var(--spacing-xs, 4px);
  font-weight: 500;
  background: var(--vscode-gitDecoration-deletedResourceForeground, #f85149);
  color: var(--vscode-editor-background);
}

.line-count {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  margin-left: auto;
  flex-shrink: 0;
}

/* 文件路径 */
.file-path {
  padding: 2px var(--spacing-sm, 8px);
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  font-family: var(--vscode-editor-font-family);
  background: var(--vscode-editor-background);
  border-bottom: 1px solid var(--vscode-panel-border);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 错误信息 */
.file-error {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  font-size: 11px;
  color: var(--vscode-inputValidation-errorForeground);
  background: var(--vscode-inputValidation-errorBackground);
}

/* 成功信息 */
.file-success {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  font-size: 11px;
  color: var(--vscode-testing-iconPassed);
  background: var(--vscode-editor-background);
}

/* 信息栏 */
.file-info-bar {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  background: var(--vscode-editor-background);
}
</style>
