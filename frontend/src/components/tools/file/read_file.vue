<script setup lang="ts">
/**
 * read_file 工具的内容面板
 *
 * 读取单个文件，并以小面板显示
 * 显示：
 * - 文件路径
 * - 文件内容（后端已带行号，格式如 "   1 | content"）
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

// 每个文件的展开状态
const expandedFiles = ref<Set<string>>(new Set())

// 复制状态（按文件路径）
const copiedFiles = ref<Set<string>>(new Set())
const copyTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

// 单个文件读取请求
interface FileRequest {
  path: string
  startLine?: number
  endLine?: number
}

// 获取文件请求列表
const fileRequests = computed((): FileRequest[] => {
  const path = props.args.path
  const startLine = toPositiveInteger(props.args.startLine)
  const endLine = toPositiveInteger(props.args.endLine)
  if (typeof path !== 'string' || path.length === 0) return []
  return [{
    path,
    startLine,
    endLine
  }]
})

function toPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
    ? value
    : undefined
}

// 获取路径列表
const pathList = computed(() => {
  return fileRequests.value.map(f => f.path)
})

// 单个文件读取结果
interface ReadResult {
  path: string
  success: boolean
  type?: 'text' | 'multimodal' | 'binary'
  content?: string
  lineCount?: number
  totalLines?: number    // 文件总行数（使用行范围时返回）
  startLine?: number     // 起始行号（使用行范围时返回）
  endLine?: number       // 结束行号（使用行范围时返回）
  mimeType?: string
  size?: number
  error?: string
  debug?: Record<string, unknown>
}

// 获取读取结果列表
const readResults = computed((): ReadResult[] => {
  const result = props.result as Record<string, any> | undefined
  
  // 批量结果
  if (result?.data?.results) {
    return result.data.results as ReadResult[]
  }
  
  // 如果没有结果，为每个路径创建空结果
  return pathList.value.map(p => ({
    path: p,
    success: !props.error,
    error: props.error
  }))
})

// 总文件数统计
const successCount = computed(() => {
  const result = props.result as Record<string, any> | undefined
  if (result?.data?.successCount !== undefined) {
    return result.data.successCount as number
  }
  return readResults.value.filter(r => r.success).length
})

const failCount = computed(() => {
  const result = props.result as Record<string, any> | undefined
  if (result?.data?.failCount !== undefined) {
    return result.data.failCount as number
  }
  return readResults.value.filter(r => !r.success).length
})

// 获取行范围摘要文本
function getLineRangeSummary(result: ReadResult): string | null {
  if (result.startLine === undefined && result.endLine === undefined) {
    return null
  }
  
  const start = result.startLine ?? 1
  const end = result.endLine ?? result.totalLines ?? '?'
  const total = result.totalLines ?? '?'
  
  return `L${start}-${end} / ${total}`
}

// 检查是否是部分读取
function isPartialRead(result: ReadResult): boolean {
  if (result.totalLines === undefined) return false
  if (result.startLine === undefined && result.endLine === undefined) return false
  
  const start = result.startLine ?? 1
  const end = result.endLine ?? result.totalLines
  
  return start > 1 || end < result.totalLines
}

// 预览行数
const previewLineCount = 15

// 获取文件名
function getFileName(filePath: string): string {
  const parts = filePath.split(/[/\\]/)
  return parts[parts.length - 1] || filePath
}

// 获取文件扩展名
function getFileExtension(filePath: string): string {
  const fileName = getFileName(filePath)
  const parts = fileName.split('.')
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

// 获取内容行数组
function getContentLines(content: string | undefined): string[] {
  return content ? content.split('\n') : []
}

// 获取显示的内容
function getDisplayContent(result: ReadResult): string {
  if (!result.content) return ''
  const lines = getContentLines(result.content)
  if (isFileExpanded(result.path) || lines.length <= previewLineCount) {
    return result.content
  }
  return lines.slice(0, previewLineCount).join('\n')
}

// 检查是否需要展开按钮
function needsExpand(result: ReadResult): boolean {
  const lines = getContentLines(result.content)
  return lines.length > previewLineCount
}

// 切换文件展开状态
function toggleFile(path: string) {
  if (expandedFiles.value.has(path)) {
    expandedFiles.value.delete(path)
  } else {
    expandedFiles.value.add(path)
  }
}

// 检查文件是否展开
function isFileExpanded(path: string): boolean {
  return expandedFiles.value.has(path)
}

// 检查是否已复制
function isCopied(path: string): boolean {
  return copiedFiles.value.has(path)
}

// 复制单个文件内容
async function copyFileContent(result: ReadResult) {
  if (!result.content) return
  
  try {
    // 移除行号前缀（格式如 "   1 | "）
    const lines = getContentLines(result.content)
    const rawContent = lines
      .map(line => {
        const match = line.match(/^\s*\d+\s*\|\s?(.*)$/)
        return match ? match[1] : line
      })
      .join('\n')
    await navigator.clipboard.writeText(rawContent)
    
    // 显示对钩状态
    copiedFiles.value.add(result.path)
    
    // 清除之前的定时器
    const existingTimeout = copyTimeouts.get(result.path)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }
    
    // 1秒后恢复
    const timeout = setTimeout(() => {
      copiedFiles.value.delete(result.path)
      copyTimeouts.delete(result.path)
    }, 1000)
    copyTimeouts.set(result.path, timeout)
  } catch (err) {
    console.error('复制失败:', err)
  }
}

function formatDebugValue(value: unknown): string {
  // 调试原因：后端会把 read_file 的多模态判定快照放在 result.debug，前端需要稳定展示嵌套对象。
  // 调试方式：对象用缩进 JSON 展示，普通值转成字符串，避免用户只能在开发者工具里查看。
  // 调试目的：复现“界面已开启但后台判断关闭”时，可以直接截图看到 config、capability 和 handler 收到的值。
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value, null, 2)
  }
  return String(value)
}

// 清理定时器
onBeforeUnmount(() => {
  for (const timeout of copyTimeouts.values()) {
    clearTimeout(timeout)
  }
  copyTimeouts.clear()
})
</script>

<template>
  <div class="read-file-panel">
    <!-- 总体统计头部 -->
    <div class="panel-header">
      <div class="header-info">
        <span class="codicon codicon-files files-icon"></span>
        <span class="title">{{ t('components.tools.file.readFilePanel.title') }}</span>
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
        <span class="stat total">{{ t('components.tools.file.readFilePanel.total', { count: readResults.length }) }}</span>
      </div>
    </div>
    
    <!-- 全局错误 -->
    <div v-if="error && readResults.length === 0" class="panel-error">
      <span class="codicon codicon-error error-icon"></span>
      <span class="error-text">{{ error }}</span>
    </div>
    
    <!-- 文件列表 -->
    <div v-else class="file-list">
      <div
        v-for="result in readResults"
        :key="result.path"
        :class="['file-panel', { 'is-error': !result.success }]"
      >
        <!-- 文件头部 -->
        <div class="file-header">
          <div class="file-info">
            <span :class="[
              'file-icon',
              'codicon',
              result.success ? 'codicon-file-text' : 'codicon-error'
            ]"></span>
            <span class="file-name">{{ getFileName(result.path) }}</span>
            <span v-if="getFileExtension(result.path)" class="file-ext">.{{ getFileExtension(result.path) }}</span>
            <span v-if="result.lineCount" class="line-count">{{ t('components.tools.file.readFilePanel.lines', { count: result.lineCount }) }}</span>
          </div>
          <div class="file-actions">
            <button
              v-if="result.content"
              class="action-btn"
              :class="{ 'copied': isCopied(result.path) }"
              :title="isCopied(result.path) ? t('components.tools.file.readFilePanel.copied') : t('components.tools.file.readFilePanel.copyContent')"
              @click.stop="copyFileContent(result)"
            >
              <span :class="['codicon', isCopied(result.path) ? 'codicon-check' : 'codicon-copy']"></span>
            </button>
          </div>
        </div>
        
        <!-- 文件路径 -->
        <div class="file-path">{{ result.path }}</div>
        
        <!-- 行范围信息（仅当使用行范围时显示） -->
        <div v-if="getLineRangeSummary(result)" class="line-range-info">
          <span class="codicon codicon-list-selection"></span>
          <span class="range-text">{{ getLineRangeSummary(result) }}</span>
          <span v-if="isPartialRead(result)" class="partial-badge">partial</span>
        </div>
        
        <!-- 错误信息 -->
        <div v-if="!result.success && result.error" class="file-error">
          {{ result.error }}
        </div>

        <!-- 调试信息：只在后端提供 result.debug 时显示，用于定位多模态配置传递链路。 -->
        <details v-if="result.debug" class="file-debug">
          <summary>调试信息</summary>
          <div
            v-for="([key, value]) in Object.entries(result.debug)"
            :key="key"
            class="debug-row"
          >
            <span class="debug-key">{{ key }}</span>
            <pre class="debug-value">{{ formatDebugValue(value) }}</pre>
          </div>
        </details>
        
        <!-- 二进制文件提示 -->
        <div v-else-if="result.type === 'binary'" class="file-binary">
          <span class="codicon codicon-file-binary"></span>
          <span>{{ t('components.tools.file.readFilePanel.binaryFile') }} ({{ result.size ? Math.round(result.size / 1024) + ' KB' : t('components.tools.file.readFilePanel.unknownSize') }})</span>
        </div>
        
        <!-- 多模态文件提示 -->
        <div v-else-if="result.type === 'multimodal'" class="file-multimodal">
          <span class="codicon codicon-file-media"></span>
          <span>{{ result.mimeType }} ({{ result.size ? Math.round(result.size / 1024) + ' KB' : '' }})</span>
        </div>
        
        <!-- 文本内容 -->
        <div v-else-if="result.content" class="file-content" :class="{ 'expanded': isFileExpanded(result.path) }">
          <div class="content-wrapper">
            <CustomScrollbar :horizontal="true">
              <pre class="content-code"><code>{{ getDisplayContent(result) }}</code></pre>
            </CustomScrollbar>
          </div>
          
          <!-- 展开/收起按钮 -->
          <div v-if="needsExpand(result)" class="expand-section">
            <button class="expand-btn" @click="toggleFile(result.path)">
              <span :class="['codicon', isFileExpanded(result.path) ? 'codicon-chevron-up' : 'codicon-chevron-down']"></span>
              {{ isFileExpanded(result.path) ? t('components.tools.file.readFilePanel.collapse') : t('components.tools.file.readFilePanel.expandRemaining', { count: getContentLines(result.content).length - previewLineCount }) }}
            </button>
          </div>
        </div>
        
        <!-- 空文件 -->
        <div v-else-if="result.success" class="file-empty">
          <span class="codicon codicon-file"></span>
          <span>{{ t('components.tools.file.readFilePanel.emptyFile') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.read-file-panel {
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
  color: var(--vscode-charts-blue);
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

/* 行范围信息 */
.line-range-info {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px var(--spacing-sm, 8px);
  font-size: 11px;
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-bottom: 1px solid var(--vscode-panel-border);
}

.line-range-info .codicon {
  font-size: 12px;
  color: var(--vscode-charts-blue);
}

.line-range-info .range-text {
  color: var(--vscode-foreground);
  font-family: var(--vscode-editor-font-family);
}

.line-range-info .partial-badge {
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.95);
  background: var(--vscode-charts-orange, #e69500);
  border-radius: 2px;
}

/* 文件错误 */
.file-error {
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  font-size: 11px;
  color: var(--vscode-inputValidation-errorForeground);
  background: var(--vscode-inputValidation-errorBackground);
}

/* 调试信息面板。
 * 添加原因：多模态读取失败需要显示后端真实收到的开关和能力，单独错误文案不够定位问题。
 * 添加方式：使用 details/summary 让默认界面保持简洁，展开后逐项显示 result.debug。
 * 添加目的：用户可以直接从工具面板截图排查配置传递链路，无需打开开发者工具。 */
.file-debug {
  padding: var(--spacing-sm, 8px);
  background: var(--vscode-editor-background);
  border-top: 1px solid var(--vscode-inputValidation-errorBorder);
  font-size: 11px;
}

.file-debug summary {
  cursor: pointer;
  color: var(--vscode-descriptionForeground);
  user-select: none;
}

.debug-row {
  display: grid;
  grid-template-columns: minmax(120px, 180px) 1fr;
  gap: var(--spacing-sm, 8px);
  margin-top: var(--spacing-xs, 4px);
}

.debug-key {
  color: var(--vscode-symbolIcon-variableForeground, var(--vscode-descriptionForeground));
  word-break: break-word;
}

.debug-value {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--vscode-foreground);
  font-family: var(--vscode-editor-font-family);
}

/* 二进制文件 */
.file-binary,
.file-multimodal {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-sm, 8px);
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
  background: var(--vscode-editor-background);
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

/* 空文件 */
.file-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-sm, 8px);
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
}
</style>