<script setup lang="ts">
/**
 * list_files 工具的内容面板
 *
 * 显示：
 * - 多个目录的文件列表（每个目录一个小面板）
 * - 每个目录可独立展开/收起
 * - 文件数量统计
 */

import { computed, ref } from 'vue'
import { useI18n } from '@/composables'

const props = defineProps<{
  args: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
}>()

const { t } = useI18n()

// 每个目录的展开状态
const expandedDirs = ref<Set<string>>(new Set())

// 是否递归
const isRecursive = computed(() => props.args.recursive as boolean || false)

// 获取路径列表
const pathList = computed(() => {
  if (props.args.paths && Array.isArray(props.args.paths)) {
    return props.args.paths as string[]
  }
  if (props.args.path && typeof props.args.path === 'string') {
    return [props.args.path]
  }
  return ['.']
})

// 条目类型
interface Entry {
  name: string
  type: 'file' | 'directory'
  /**
   * 文本文件行数；目录、二进制文件或旧结果中可能不存在。
   *
   * 修改原因：后端 list_files 已开始返回 lineCount，前端卡片需要直接展示文件规模，帮助用户和模型决定是否范围读取。
   * 修改方式：在 Entry 类型中加入可选 lineCount，并在模板中以轻量 badge 展示。
   * 修改目的：主聊天和 SubAgent Monitor 复用同一工具组件后，都能同步看到文件行数。
   */
  lineCount?: number
}

// 单个目录的结果
interface ListResult {
  path: string
  entries: Entry[]
  fileCount: number
  dirCount: number
  success: boolean
  error?: string
}

// 获取列出结果
const listResults = computed((): ListResult[] => {
  const result = props.result as Record<string, any> | undefined
  
  // 新格式：批量结果（包含 entries）
  if (result?.data?.results) {
    return (result.data.results as any[]).map(r => {
      // 兼容旧格式的 files 数组
      if (r.files && !r.entries) {
        const entries: Entry[] = (r.files as string[]).map(f => ({
          name: f,
          type: 'file' as const
        }))
        return {
          path: r.path,
          entries,
          fileCount: entries.length,
          dirCount: 0,
          success: r.success,
          error: r.error
        }
      }
      return r as ListResult
    })
  }
  
  // 旧格式：单个结果
  if (result?.data?.files) {
    const files = result.data.files as string[]
    const entries: Entry[] = files.map(f => ({
      name: f,
      type: 'file' as const
    }))
    return [{
      path: result.data.path || pathList.value[0] || '.',
      entries,
      fileCount: entries.length,
      dirCount: 0,
      success: true
    }]
  }
  
  // 兼容直接返回 files 的情况
  if (result?.files) {
    const files = result.files as string[]
    const entries: Entry[] = files.map(f => ({
      name: f,
      type: 'file' as const
    }))
    return [{
      path: pathList.value[0] || '.',
      entries,
      fileCount: entries.length,
      dirCount: 0,
      success: true
    }]
  }
  
  // 如果没有结果，为每个路径创建空结果
  return pathList.value.map(p => ({
    path: p,
    entries: [],
    fileCount: 0,
    dirCount: 0,
    success: !props.error,
    error: props.error
  }))
})

// 总文件数
const totalFiles = computed(() => {
  const result = props.result as Record<string, any> | undefined
  if (result?.data?.totalFiles !== undefined) {
    return result.data.totalFiles as number
  }
  return listResults.value.reduce((sum, r) => sum + r.fileCount, 0)
})

// 总目录数
const totalDirs = computed(() => {
  const result = props.result as Record<string, any> | undefined
  if (result?.data?.totalDirs !== undefined) {
    return result.data.totalDirs as number
  }
  return listResults.value.reduce((sum, r) => sum + r.dirCount, 0)
})

// 预览数量
const previewCount = 15

// 切换目录展开状态
function toggleDir(path: string) {
  if (expandedDirs.value.has(path)) {
    expandedDirs.value.delete(path)
  } else {
    expandedDirs.value.add(path)
  }
}

// 检查目录是否已展开
function isDirExpanded(path: string): boolean {
  return expandedDirs.value.has(path)
}

// 获取显示的条目列表
function getDisplayEntries(result: ListResult): Entry[] {
  if (isDirExpanded(result.path) || result.entries.length <= previewCount) {
    return result.entries
  }
  return result.entries.slice(0, previewCount)
}

// 检查是否需要展开按钮
function needsExpand(result: ListResult): boolean {
  return result.entries.length > previewCount
}

// 获取条目图标
function getEntryIcon(entry: Entry): string {
  if (entry.type === 'directory') {
    return 'codicon-folder'
  }
  
  const ext = entry.name.split('.').pop()?.toLowerCase() || ''
  
  const iconMap: Record<string, string> = {
    'ts': 'codicon-symbol-namespace',
    'tsx': 'codicon-symbol-namespace',
    'js': 'codicon-symbol-method',
    'jsx': 'codicon-symbol-method',
    'vue': 'codicon-symbol-color',
    'html': 'codicon-symbol-misc',
    'css': 'codicon-symbol-color',
    'scss': 'codicon-symbol-color',
    'less': 'codicon-symbol-color',
    'json': 'codicon-symbol-key',
    'md': 'codicon-markdown',
    'py': 'codicon-symbol-method',
    'go': 'codicon-symbol-method',
    'rs': 'codicon-symbol-method',
    'java': 'codicon-symbol-class',
    'yml': 'codicon-settings-gear',
    'yaml': 'codicon-settings-gear',
    'toml': 'codicon-settings-gear',
    'ini': 'codicon-settings-gear',
    'env': 'codicon-settings-gear',
    'png': 'codicon-file-media',
    'jpg': 'codicon-file-media',
    'jpeg': 'codicon-file-media',
    'gif': 'codicon-file-media',
    'svg': 'codicon-file-media',
    'webp': 'codicon-file-media',
    'pdf': 'codicon-file-pdf',
    'zip': 'codicon-file-zip',
    'tar': 'codicon-file-zip',
    'gz': 'codicon-file-zip',
  }
  
  return iconMap[ext] || 'codicon-file'
}

function formatEntryLineCount(entry: Entry): string {
  // 修改原因：lineCount 是后端新增的可选元数据，模板和复制逻辑都需要同一种展示文案。
  // 修改方式：集中通过 i18n 格式化，缺失时返回空字符串。
  // 修改目的：避免主界面和 Monitor 的工具卡片在行数字段上出现不同格式。
  return typeof entry.lineCount === 'number'
    ? t('components.tools.file.listFilesPanel.lines', { count: entry.lineCount })
    : ''
}

function formatEntryForCopy(entry: Entry): string {
  // 修改原因：用户复制 list_files 结果时也应该保留行数信息，否则复制内容与卡片可见信息不一致。
  // 修改方式：目录仍只复制路径；文件有 lineCount 时追加括号说明。
  // 修改目的：让工具卡片展示和复制结果共享同一文件规模信息。
  const lineCount = formatEntryLineCount(entry)
  return lineCount ? `${entry.name} (${lineCount})` : entry.name
}

// 复制单个目录的条目列表
async function copyDirEntries(result: ListResult) {
  try {
    await navigator.clipboard.writeText(result.entries.map(formatEntryForCopy).join('\n'))
  } catch (err) {
    console.error('复制失败:', err)
  }
}

// 复制所有条目列表
async function copyAllEntries() {
  try {
    const allEntries = listResults.value.flatMap(r => r.entries.map(formatEntryForCopy))
    await navigator.clipboard.writeText(allEntries.join('\n'))
  } catch (err) {
    console.error('复制失败:', err)
  }
}
</script>

<template>
  <div class="list-files-panel">
    <!-- 总体统计头部 -->
    <div class="panel-header">
      <div class="header-info">
        <span class="codicon codicon-folder-library folder-icon"></span>
        <span class="title">{{ t('components.tools.file.listFilesPanel.title') }}</span>
        <span v-if="isRecursive" class="recursive-badge">{{ t('components.tools.file.listFilesPanel.recursive') }}</span>
      </div>
      <div class="header-meta">
        <span class="total-count">{{ t('components.tools.file.listFilesPanel.totalStat', { dirCount: listResults.length, folderCount: totalDirs, fileCount: totalFiles }) }}</span>
        <button class="action-btn" :title="t('components.tools.file.listFilesPanel.copyAll')" @click="copyAllEntries">
          <span class="codicon codicon-copy"></span>
        </button>
      </div>
    </div>
    
    <!-- 全局错误 -->
    <div v-if="error && listResults.length === 0" class="panel-error">
      <span class="codicon codicon-error error-icon"></span>
      <span class="error-text">{{ error }}</span>
    </div>
    
    <!-- 目录列表 -->
    <div v-else class="dir-list">
      <div
        v-for="result in listResults"
        :key="result.path"
        :class="['dir-panel', { 'is-error': !result.success }]"
      >
        <!-- 目录头部 -->
        <div class="dir-header">
          <div class="dir-info">
            <span :class="[
              'dir-icon',
              'codicon',
              result.success ? 'codicon-folder' : 'codicon-error'
            ]"></span>
            <span class="dir-path">{{ result.path }}</span>
            <span class="dir-count">{{ t('components.tools.file.listFilesPanel.dirStat', { folderCount: result.dirCount, fileCount: result.fileCount }) }}</span>
          </div>
          <div class="dir-actions">
            <button class="action-btn" :title="t('components.tools.file.listFilesPanel.copyList')" @click.stop="copyDirEntries(result)">
              <span class="codicon codicon-copy"></span>
            </button>
          </div>
        </div>
        
        <!-- 错误信息 -->
        <div v-if="!result.success && result.error" class="dir-error">
          {{ result.error }}
        </div>
        
        <!-- 条目列表 -->
        <div v-else-if="result.entries.length > 0" class="file-list">
          <div
            v-for="entry in getDisplayEntries(result)"
            :key="entry.name"
            :class="['file-item', { 'is-directory': entry.type === 'directory' }]"
          >
            <span :class="['file-icon', 'codicon', getEntryIcon(entry)]"></span>
            <span class="file-path">{{ entry.name }}</span>
            <!-- 修改原因：后端 list_files 为文本文件返回 lineCount；工具卡片需要把该信息露出给主界面和 SubAgent Monitor。
                 修改方式：仅当 lineCount 为数字时显示右侧 badge，目录和二进制文件保持旧样式。
                 修改目的：用户看到目录列表即可判断是否需要 read_file 范围读取，避免直接读取大文件。 -->
            <span v-if="formatEntryLineCount(entry)" class="line-count-badge">{{ formatEntryLineCount(entry) }}</span>
          </div>
          
          <!-- 展开/收起按钮 -->
          <div v-if="needsExpand(result)" class="expand-section">
            <button class="expand-btn" @click="toggleDir(result.path)">
              <span :class="['codicon', isDirExpanded(result.path) ? 'codicon-chevron-up' : 'codicon-chevron-down']"></span>
              {{ isDirExpanded(result.path) ? t('components.tools.file.listFilesPanel.collapse') : t('components.tools.file.listFilesPanel.expandRemaining', { count: result.entries.length - previewCount }) }}
            </button>
          </div>
        </div>
        
        <!-- 空目录 -->
        <div v-else-if="result.success" class="empty-dir">
          <span class="codicon codicon-folder-opened"></span>
          <span>{{ t('components.tools.file.listFilesPanel.emptyDirectory') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.list-files-panel {
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

.folder-icon {
  color: var(--vscode-charts-yellow);
  font-size: 14px;
}

.title {
  font-weight: 600;
  font-size: 12px;
  color: var(--vscode-foreground);
}

.recursive-badge {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 2px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
}

.header-meta {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
}

.total-count {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
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

/* 目录列表 */
.dir-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
}

/* 单个目录面板 */
.dir-panel {
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-sm, 2px);
  overflow: hidden;
}

.dir-panel.is-error {
  border-color: var(--vscode-inputValidation-errorBorder);
}

/* 目录头部 */
.dir-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-bottom: 1px solid var(--vscode-panel-border);
}

.dir-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  flex: 1;
  min-width: 0;
}

.dir-icon {
  font-size: 12px;
  color: var(--vscode-charts-yellow);
  flex-shrink: 0;
}

.dir-panel.is-error .dir-icon {
  color: var(--vscode-inputValidation-errorForeground);
}

.dir-path {
  font-size: 11px;
  font-weight: 500;
  color: var(--vscode-foreground);
  font-family: var(--vscode-editor-font-family);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dir-count {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  flex-shrink: 0;
}

.dir-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
}

/* 目录错误 */
.dir-error {
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  font-size: 11px;
  color: var(--vscode-inputValidation-errorForeground);
  background: var(--vscode-inputValidation-errorBackground);
}

/* 文件列表 */
.file-list {
  display: flex;
  flex-direction: column;
  max-height: 200px;
  overflow-y: auto;
}

.file-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  padding: 2px var(--spacing-sm, 8px);
  background: var(--vscode-editor-background);
  transition: background-color var(--transition-fast, 0.1s);
  min-width: 0;
}

.file-item:hover {
  background: var(--vscode-list-hoverBackground);
}

.file-item:not(:last-child) {
  border-bottom: 1px solid var(--vscode-panel-border);
}

.file-item .file-icon {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  flex-shrink: 0;
}

.file-item.is-directory .file-icon {
  color: var(--vscode-charts-yellow);
}

.file-path {
  font-size: 10px;
  color: var(--vscode-foreground);
  font-family: var(--vscode-editor-font-family);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.line-count-badge {
  /* 修改原因：行数是辅助元数据，不能和文件名抢主视觉，也不能导致长路径换行。
     修改方式：使用右侧胶囊 badge，固定不收缩，沿用 VS Code badge 颜色变量。
     修改目的：在主聊天和 Monitor 中保持紧凑一致的工具卡片布局。 */
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

/* 空目录 */
.empty-dir {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-sm, 8px);
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
}
</style>