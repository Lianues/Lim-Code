<script setup lang="ts">
/**
 * find_files 工具的内容面板
 * 
 * 显示：
 * - 每个模式的查找结果
 * - 找到的文件列表
 * - 统计信息
 */

import { computed, ref } from 'vue'
import CustomScrollbar from '../../common/CustomScrollbar.vue'
import { useI18n } from '../../../composables/useI18n'

const { t } = useI18n()

const props = defineProps<{
  args: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
}>()

// 每个模式的展开状态
const expandedPatterns = ref<Set<string>>(new Set())

// 获取模式列表
const patternList = computed(() => {
  if (props.args.patterns && Array.isArray(props.args.patterns)) {
    return props.args.patterns as string[]
  }
  if (props.args.pattern && typeof props.args.pattern === 'string') {
    return [props.args.pattern]
  }
  return []
})

interface FoundFileDetail {
  path: string
  /**
   * 文本文件行数；二进制文件、读取失败或旧结果中可能不存在。
   *
   * 修改原因：后端 find_files 新增 fileDetails.lineCount，前端需要在文件搜索结果中直接展示文件规模。
   * 修改方式：保留旧 files 字符串数组，同时读取可选 fileDetails 作为增强展示数据。
   * 修改目的：主界面和 SubAgent Monitor 都能在搜索卡片里看到行数，减少盲目 read_file 整文件。
   */
  lineCount?: number
}

// 单个模式的查找结果
interface FindResult {
  pattern: string
  success: boolean
  files?: string[]
  fileDetails?: FoundFileDetail[]
  count?: number
  truncated?: boolean
  error?: string
}

// 获取查找结果列表
const findResults = computed((): FindResult[] => {
  const result = props.result as Record<string, any> | undefined
  
  // 新格式：批量结果
  if (result?.data?.results) {
    return result.data.results as FindResult[]
  }
  
  // 旧格式：单个结果
  if (result?.data?.files) {
    return [{
      pattern: result.data.pattern || patternList.value[0] || '',
      success: true,
      files: result.data.files,
      count: result.data.count,
      truncated: result.data.truncated
    }]
  }
  
  // 如果没有结果，为每个模式创建空结果
  return patternList.value.map(p => ({
    pattern: p,
    success: !props.error,
    error: props.error
  }))
})

// 总统计
const successCount = computed(() => {
  const result = props.result as Record<string, any> | undefined
  if (result?.data?.successCount !== undefined) {
    return result.data.successCount as number
  }
  return findResults.value.filter(r => r.success).length
})

const failCount = computed(() => {
  const result = props.result as Record<string, any> | undefined
  if (result?.data?.failCount !== undefined) {
    return result.data.failCount as number
  }
  return findResults.value.filter(r => !r.success).length
})

const totalFiles = computed(() => {
  const result = props.result as Record<string, any> | undefined
  if (result?.data?.totalFiles !== undefined) {
    return result.data.totalFiles as number
  }
  return findResults.value.reduce((sum, r) => sum + (r.count || 0), 0)
})

// 预览文件数
const previewFileCount = 10

// 切换模式展开状态
function togglePattern(pattern: string) {
  if (expandedPatterns.value.has(pattern)) {
    expandedPatterns.value.delete(pattern)
  } else {
    expandedPatterns.value.add(pattern)
  }
}

// 检查模式是否展开
function isPatternExpanded(pattern: string): boolean {
  return expandedPatterns.value.has(pattern)
}

function getFileDetails(result: FindResult): FoundFileDetail[] {
  // 修改原因：旧结果只有 files，新结果同时有 fileDetails；模板不应该关心两种协议差异。
  // 修改方式：优先使用 fileDetails；缺失时从 files 构造只有 path 的详情对象。
  // 修改目的：让行数显示是渐进增强，不破坏历史记录和旧工具结果。
  if (Array.isArray(result.fileDetails) && result.fileDetails.length > 0) {
    return result.fileDetails
  }
  return (result.files || []).map(path => ({ path }))
}

// 获取显示的文件列表
function getDisplayFiles(result: FindResult): FoundFileDetail[] {
  const files = getFileDetails(result)
  if (isPatternExpanded(result.pattern) || files.length <= previewFileCount) {
    return files
  }
  return files.slice(0, previewFileCount)
}

// 检查是否需要展开按钮
function needsExpand(result: FindResult): boolean {
  // 修改原因：新协议可能通过 fileDetails 提供增强文件列表；只看旧 files 数组会让展开按钮数量判断不完整。
  // 修改方式：统一通过 getFileDetails 计算真实可展示条目数量。
  // 修改目的：旧结果和带 lineCount 的新结果使用同一展开逻辑。
  return getFileDetails(result).length > previewFileCount
}

// 获取文件名
function getFileName(filePath: string): string {
  const parts = filePath.split(/[/\\]/)
  return parts[parts.length - 1] || filePath
}

// 获取文件夹路径
function getDirPath(filePath: string): string {
  const parts = filePath.split(/[/\\]/)
  parts.pop()
  return parts.join('/')
}

function formatLineCount(file: FoundFileDetail): string {
  // 修改原因：lineCount 是可选增强字段，不能在缺失时显示 undefined 或破坏旧历史卡片。
  // 修改方式：仅数字行数通过 find_files 专属 i18n 文案格式化。
  // 修改目的：主窗口与 Monitor 复用同一工具组件时拥有完全一致的行数展示。
  return typeof file.lineCount === 'number'
    ? t('components.tools.search.findFilesPanel.lines', { count: file.lineCount })
    : ''
}
</script>

<template>
  <div class="find-files-panel">
    <!-- 头部统计 -->
    <div class="panel-header">
      <div class="header-info">
        <span class="codicon codicon-search search-icon"></span>
        <span class="title">{{ t('components.tools.search.findFilesPanel.title') }}</span>
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
        <span class="stat total">{{ t('components.tools.search.findFilesPanel.totalFiles', { count: totalFiles }) }}</span>
      </div>
    </div>
    
    <!-- 全局错误 -->
    <div v-if="error && findResults.length === 0" class="panel-error">
      <span class="codicon codicon-error error-icon"></span>
      <span class="error-text">{{ error }}</span>
    </div>
    
    <!-- 结果列表 -->
    <div v-else class="results-list">
      <div
        v-for="result in findResults"
        :key="result.pattern"
        :class="['pattern-panel', { 'is-error': !result.success }]"
      >
        <!-- 模式头部 -->
        <div class="pattern-header">
          <div class="pattern-info">
            <span :class="[
              'pattern-icon',
              'codicon',
              result.success ? 'codicon-file-submodule' : 'codicon-error'
            ]"></span>
            <span class="pattern-text">{{ result.pattern }}</span>
            <span v-if="result.count !== undefined" class="file-count">{{ t('components.tools.search.findFilesPanel.fileCount', { count: result.count }) }}</span>
            <span v-if="result.truncated" class="truncated-badge">{{ t('components.tools.search.findFilesPanel.truncated') }}</span>
          </div>
        </div>
        
        <!-- 错误信息 -->
        <div v-if="!result.success && result.error" class="pattern-error">
          {{ result.error }}
        </div>
        
        <!-- 文件列表 -->
        <div v-else-if="getFileDetails(result).length > 0" class="file-list">
          <CustomScrollbar :max-height="200">
            <div class="file-items">
              <div
                v-for="file in getDisplayFiles(result)"
                :key="file.path"
                class="file-item"
              >
                <span class="codicon codicon-file file-icon"></span>
                <span class="file-name">{{ getFileName(file.path) }}</span>
                <span class="file-dir">{{ getDirPath(file.path) }}</span>
                <!-- 修改原因：find_files 现在能返回 fileDetails.lineCount；搜索结果卡片应和 list_files 一样显示文本文件行数。
                     修改方式：在文件行右侧显示可选 badge，旧结果没有 lineCount 时不渲染。
                     修改目的：SubAgent Monitor 和主界面都能直接看到文件规模，决定是否范围读取。 -->
                <span v-if="formatLineCount(file)" class="line-count-badge">{{ formatLineCount(file) }}</span>
              </div>
            </div>
          </CustomScrollbar>
          
          <!-- 展开/收起按钮 -->
          <div v-if="needsExpand(result)" class="expand-section">
            <button class="expand-btn" @click="togglePattern(result.pattern)">
              <span :class="['codicon', isPatternExpanded(result.pattern) ? 'codicon-chevron-up' : 'codicon-chevron-down']"></span>
              {{ isPatternExpanded(result.pattern) ? t('components.tools.search.findFilesPanel.collapse') : t('components.tools.search.findFilesPanel.expandRemaining', { count: getFileDetails(result).length - previewFileCount }) }}
            </button>
          </div>
        </div>
        
        <!-- 无结果 -->
        <div v-else-if="result.success" class="no-files">
          <span class="codicon codicon-info"></span>
          <span>{{ t('components.tools.search.findFilesPanel.noFiles') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.find-files-panel {
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

.search-icon {
  color: var(--vscode-charts-blue);
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

/* 结果列表 */
.results-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
}

/* 单个模式面板 */
.pattern-panel {
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-sm, 2px);
  overflow: hidden;
}

.pattern-panel.is-error {
  border-color: var(--vscode-inputValidation-errorBorder);
}

/* 模式头部 */
.pattern-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-bottom: 1px solid var(--vscode-panel-border);
}

.pattern-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  flex: 1;
  min-width: 0;
}

.pattern-icon {
  font-size: 12px;
  color: var(--vscode-charts-blue);
  flex-shrink: 0;
}

.pattern-panel.is-error .pattern-icon {
  color: var(--vscode-inputValidation-errorForeground);
}

.pattern-text {
  font-size: 11px;
  font-family: var(--vscode-editor-font-family);
  color: var(--vscode-foreground);
}

.file-count {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  margin-left: auto;
  flex-shrink: 0;
}

.truncated-badge {
  font-size: 9px;
  padding: 1px 4px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: 2px;
  margin-left: var(--spacing-xs, 4px);
}

/* 模式错误 */
.pattern-error {
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  font-size: 11px;
  color: var(--vscode-inputValidation-errorForeground);
  background: var(--vscode-inputValidation-errorBackground);
}

/* 文件列表 */
.file-list {
  background: var(--vscode-editor-background);
}

.file-items {
  display: flex;
  flex-direction: column;
}

.file-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  padding: 2px var(--spacing-sm, 8px);
  font-size: 11px;
  border-bottom: 1px solid var(--vscode-panel-border);
  min-width: 0;
}

.file-item:last-child {
  border-bottom: none;
}

.file-icon {
  font-size: 12px;
  color: var(--vscode-charts-blue);
  flex-shrink: 0;
}

.file-name {
  font-weight: 500;
  color: var(--vscode-foreground);
  flex-shrink: 0;
}

.file-dir {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  font-family: var(--vscode-editor-font-family);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.line-count-badge {
  /* 修改原因：行数是辅助信息，需要在不挤压文件名的情况下稳定显示。
     修改方式：使用右侧紧凑 badge，并让目录路径承担可压缩空间。
     修改目的：和 list_files 卡片保持一致视觉语言。 */
  flex-shrink: 0;
  font-size: 9px;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 999px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
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

/* 无结果 */
.no-files {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-sm, 8px);
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
}
</style>