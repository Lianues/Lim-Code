<script setup lang="ts">
/**
 * insert_code 工具的内容面板
 *
 * 支持批量插入，每个文件一个小面板显示
 * 显示：
 * - 文件名（标题）+ 插入位置
 * - 文件路径
 * - 插入的代码内容（带行号）
 * - 操作结果状态
 */

import { computed, ref, onBeforeUnmount } from 'vue'
import CustomScrollbar from '../../common/CustomScrollbar.vue'

const props = defineProps<{
  args: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
}>()

// 每个文件的展开状态
const expandedFiles = ref<Set<string>>(new Set())

// 复制状态（按文件路径）
const copiedFiles = ref<Set<string>>(new Set())
const copyTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

// 单个插入条目
interface InsertEntry {
  path: string
  line: number
  content: string
}

// 单个插入结果
interface InsertResult {
  path: string
  success: boolean
  line?: number
  insertedLines?: number
  status?: string
  error?: string
  diffContentId?: string
}

// 获取文件列表（从参数中）
const fileList = computed((): InsertEntry[] => {
  const files = props.args.files as InsertEntry[] | undefined
  return files && Array.isArray(files) ? files : []
})

// 获取插入结果列表（从结果中）
const insertResults = computed((): InsertResult[] => {
  const result = props.result as Record<string, any> | undefined
  if (result?.data?.results) {
    return result.data.results as InsertResult[]
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
  line: number
  content: string
  result: InsertResult | undefined
}

const mergedFiles = computed((): MergedFile[] => {
  return fileList.value.map(entry => {
    const result = insertResults.value.find(r => r.path === entry.path)
    return {
      path: entry.path,
      line: entry.line,
      content: entry.content,
      result
    }
  })
})

// 统计
const successCount = computed(() => {
  const result = props.result as Record<string, any> | undefined
  if (result?.data?.successCount !== undefined) return result.data.successCount as number
  return insertResults.value.filter(r => r.success).length
})

const failCount = computed(() => {
  const result = props.result as Record<string, any> | undefined
  if (result?.data?.failCount !== undefined) return result.data.failCount as number
  return insertResults.value.filter(r => !r.success).length
})

// 预览行数
const previewLineCount = 15

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

// 获取内容行数组
function getContentLines(content: string | undefined): string[] {
  return content ? content.split('\n') : []
}

// 是否需要展开按钮
function needsExpand(file: MergedFile): boolean {
  return getContentLines(file.content).length > previewLineCount
}

// 切换展开状态
function toggleFile(path: string) {
  if (expandedFiles.value.has(path)) {
    expandedFiles.value.delete(path)
  } else {
    expandedFiles.value.add(path)
  }
}

function isFileExpanded(path: string): boolean {
  return expandedFiles.value.has(path)
}

// 获取显示内容（带行号）
function getDisplayContent(file: MergedFile): string {
  if (!file.content) return ''
  const lines = getContentLines(file.content)
  const startNum = file.line
  const padWidth = String(startNum + lines.length - 1).length

  const displayLines = isFileExpanded(file.path) || lines.length <= previewLineCount
    ? lines
    : lines.slice(0, previewLineCount)

  return displayLines.map((line, i) =>
    `${String(startNum + i).padStart(padWidth)} | ${line}`
  ).join('\n')
}

// 复制单个文件内容
async function copyFileContent(file: MergedFile) {
  if (!file.content) return
  try {
    await navigator.clipboard.writeText(file.content)
    copiedFiles.value.add(file.path)
    const existing = copyTimeouts.get(file.path)
    if (existing) clearTimeout(existing)
    const timeout = setTimeout(() => {
      copiedFiles.value.delete(file.path)
      copyTimeouts.delete(file.path)
    }, 1000)
    copyTimeouts.set(file.path, timeout)
  } catch (err) {
    console.error('复制失败:', err)
  }
}

function isCopied(path: string): boolean {
  return copiedFiles.value.has(path)
}

onBeforeUnmount(() => {
  for (const timeout of copyTimeouts.values()) {
    clearTimeout(timeout)
  }
  copyTimeouts.clear()
})
</script>

<template>
  <div class="insert-code-panel">
    <!-- 总体统计头部 -->
    <div class="panel-header">
      <div class="header-info">
        <span class="codicon codicon-diff-added files-icon"></span>
        <span class="title">插入代码</span>
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
            <span class="codicon codicon-diff-added file-icon"></span>
            <span class="file-name">{{ getFileNameWithoutExt(file.path) }}</span>
            <span v-if="getFileExtension(file.path)" class="file-ext">.{{ getFileExtension(file.path) }}</span>
            <span class="insert-badge">第 {{ file.line }} 行前插入</span>
            <span class="line-count">{{ getContentLines(file.content).length }} 行</span>
          </div>
          <div class="file-actions">
            <button
              v-if="file.content"
              class="action-btn"
              :class="{ copied: isCopied(file.path) }"
              :title="isCopied(file.path) ? '已复制' : '复制内容'"
              @click.stop="copyFileContent(file)"
            >
              <span :class="['codicon', isCopied(file.path) ? 'codicon-check' : 'codicon-copy']"></span>
            </button>
          </div>
        </div>

     <!-- 文件路径 -->
        <div class="file-path">{{ file.path }}</div>

        <!-- 错误信息 -->
        <div v-if="file.result && !file.result.success && file.result.error" class="file-error">
          {{ file.result.error }}
        </div>

        <!-- 插入的代码内容 -->
        <div v-if="file.content" class="file-content" :class="{ expanded: isFileExpanded(file.path) }">
          <div class="content-wrapper">
            <CustomScrollbar :horizontal="true">
              <pre class="content-code inserted"><code>{{ getDisplayContent(file) }}</code></pre>
            </CustomScrollbar>
          </div>

          <!-- 展开/收起按钮 -->
          <div v-if="needsExpand(file)" class="expand-section">
            <button class="expand-btn" @click="toggleFile(file.path)">
              <span :class="['codicon', isFileExpanded(file.path) ? 'codicon-chevron-up' : 'codicon-chevron-down']"></span>
              {{ isFileExpanded(file.path) ? '收起' : `展开剩余 ${getContentLines(file.content).length - previewLineCount} 行` }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.insert-code-panel {
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
  color: var(--vscode-gitDecoration-addedResourceForeground, #3fb950);
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
  color: var(--vscode-gitDecoration-addedResourceForeground, #3fb950);
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

.insert-badge {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 2px;
  margin-left: var(--spacing-xs, 4px);
  font-weight: 500;
  background: var(--vscode-gitDecoration-addedResourceForeground, #3fb950);
  color: var(--vscode-editor-background);
}

.line-count {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  margin-left: auto;
  flex-shrink: 0;
}

.file-actions {
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

/* 文件错误 */
.file-error {
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  font-size: 11px;
  color: var(--vscode-inputValidation-errorForeground);
  background: var(--vscode-inputValidation-errorBackground);
}

/* 文件内容 */
.file-content {
  display: flex;
  flex-direction: column;
  background: var(--vscode-editor-background);
}

.content-wrapper {
  height: 200px;
  position: relative;
}

.file-content.expanded .content-wrapper {
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

.content-code.inserted {
  background: rgba(0, 200, 83, 0.08);
  border-left: 3px solid var(--vscode-gitDecoration-addedResourceForeground, #3fb950);
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
