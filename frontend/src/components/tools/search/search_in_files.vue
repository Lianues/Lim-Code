<script setup lang="ts">
/**
 * search_in_files 工具的内容面板
 * 
 * 显示：
 * - 搜索结果列表（仅搜索模式）
 * - 替换结果和 diff 视图（替换模式）
 * - 匹配的文件、行号、上下文
 * - 统计信息
 */

import { computed, ref, watch } from 'vue'
import CustomScrollbar from '../../common/CustomScrollbar.vue'
import { useI18n } from '../../../composables/useI18n'
import { loadDiffContent as loadDiffContentFromBackend } from '@/utils/vscode'

const { t } = useI18n()

const props = defineProps<{
  args: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
}>()

// 展开状态
const expanded = ref(false)

// 获取搜索参数
const searchQuery = computed(() => props.args.query as string || '')
const searchPath = computed(() => props.args.path as string || '.')
const filePattern = computed(() => props.args.pattern as string || '**/*')
const isRegex = computed(() => props.args.isRegex as boolean || false)
const replacement = computed(() => props.args.replace as string | undefined)
const dryRun = computed(() => props.args.dryRun as boolean || false)

// 是否是替换模式
const isReplaceMode = computed(() => !!props.args.replace)

// 搜索结果
interface SearchMatch {
  file: string
  workspace?: string
  line: number
  column: number
  match: string
  context: string
}

interface ReplaceResult {
  file: string
  workspace?: string
  replacements: number
  diffContentId?: string
}

// 获取搜索匹配结果
const searchResults = computed((): SearchMatch[] => {
  const result = props.result as Record<string, any> | undefined
  if (isReplaceMode.value) {
    // 替换模式下，matches 包含匹配信息
    return result?.data?.matches as SearchMatch[] || []
  } else {
    // 仅搜索模式
    return result?.data?.results as SearchMatch[] || []
  }
})

// 获取替换结果
const replaceResults = computed((): ReplaceResult[] => {
  const result = props.result as Record<string, any> | undefined
  if (isReplaceMode.value) {
    return result?.data?.results as ReplaceResult[] || []
  }
  return []
})

// 统计信息
const matchCount = computed(() => {
  const result = props.result as Record<string, any> | undefined
  if (isReplaceMode.value) {
    return result?.data?.totalReplacements as number || 0
  }
  if (result?.data?.count !== undefined) {
    return result.data.count as number
  }
  return searchResults.value.length
})

const filesModified = computed(() => {
  const result = props.result as Record<string, any> | undefined
  return result?.data?.filesModified as number || 0
})

const truncated = computed(() => {
  const result = props.result as Record<string, any> | undefined
  return result?.data?.truncated as boolean || false
})

// 按文件分组
const groupedResults = computed(() => {
  const groups: Record<string, SearchMatch[]> = {}
  for (const match of searchResults.value) {
    if (!groups[match.file]) {
      groups[match.file] = []
    }
    groups[match.file].push(match)
  }
  return groups
})

// 文件数量
const fileCount = computed(() => Object.keys(groupedResults.value).length)

// 预览匹配数
const previewMatchCount = 10

// 获取显示的结果
const displayResults = computed(() => {
  if (expanded.value || searchResults.value.length <= previewMatchCount) {
    return searchResults.value
  }
  return searchResults.value.slice(0, previewMatchCount)
})

// 检查是否需要展开按钮
const needsExpand = computed(() => searchResults.value.length > previewMatchCount)

// 切换展开状态
function toggleExpand() {
  expanded.value = !expanded.value
}

// 获取文件名
function getFileName(filePath: string | undefined): string {
  if (!filePath) return ''
  const parts = filePath.split(/[/\\]/)
  return parts[parts.length - 1] || filePath
}

// 高亮匹配文本
function highlightMatch(context: string | undefined, match: string | undefined): string {
  // 安全检查
  if (!context) return ''
  if (!match) return context
  
  // 简单的转义处理
  const escaped = match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return context.replace(new RegExp(escaped, 'gi'), `<mark>${match}</mark>`)
}

// ============ Diff 相关 ============

// Diff 内容（从后端加载）
interface DiffContent {
  originalContent: string
  newContent: string
  filePath: string
}

// 加载状态
const diffContents = ref<Map<string, DiffContent>>(new Map())
const loadingDiffs = ref<Set<string>>(new Set())
const diffLoadErrors = ref<Map<string, string>>(new Map())

// 显示模式：'matches' | 'diff'
const viewModes = ref<Map<string, 'matches' | 'diff'>>(new Map())

// 监听结果变化，自动加载 diff 内容
watch(replaceResults, async (results) => {
  for (const result of results) {
    if (result.diffContentId && !diffContents.value.has(result.file) && !loadingDiffs.value.has(result.file)) {
      await loadDiffContent(result.file, result.diffContentId)
    }
  }
}, { immediate: true })

// 加载 diff 内容
async function loadDiffContent(filePath: string, diffContentId: string) {
  if (loadingDiffs.value.has(filePath)) return
  
  loadingDiffs.value.add(filePath)
  diffLoadErrors.value.delete(filePath)
  
  try {
    const response = await loadDiffContentFromBackend(diffContentId)
    
    if (response) {
      diffContents.value.set(filePath, response)
      // 自动切换到 diff 视图
      viewModes.value.set(filePath, 'diff')
    } else {
      throw new Error('Failed to load diff content')
    }
  } catch (err) {
    diffLoadErrors.value.set(filePath, err instanceof Error ? err.message : String(err))
    console.error('Failed to load diff content:', err)
  } finally {
    loadingDiffs.value.delete(filePath)
  }
}

// 获取视图模式
function getViewMode(path: string): 'matches' | 'diff' {
  return viewModes.value.get(path) || 'matches'
}

// 是否有 diff 内容可显示
function hasDiffContent(path: string): boolean {
  return diffContents.value.has(path)
}

// 获取 diff 内容
function getDiffContent(path: string): DiffContent | undefined {
  return diffContents.value.get(path)
}

// 是否正在加载
function isLoadingDiff(path: string): boolean {
  return loadingDiffs.value.has(path)
}

// 计算差异行
interface DiffLine {
  type: 'unchanged' | 'deleted' | 'added'
  content: string
  oldLineNum?: number
  newLineNum?: number
}

/**
 * 计算 diff 行
 */
function computeDiffLines(originalContent: string, newContent: string): DiffLine[] {
  const oldLines = originalContent.split('\n')
  const newLines = newContent.split('\n')
  const result: DiffLine[] = []
  
  // 使用简单的最长公共子序列算法找出差异
  const lcs = computeLCS(oldLines, newLines)
  
  let oldIdx = 0
  let newIdx = 0
  let oldLineNum = 1
  let newLineNum = 1
  
  for (const match of lcs) {
    // 添加删除的行
    while (oldIdx < match.oldIndex) {
      result.push({
        type: 'deleted',
        content: oldLines[oldIdx],
        oldLineNum: oldLineNum++
      })
      oldIdx++
    }
    
    // 添加新增的行
    while (newIdx < match.newIndex) {
      result.push({
        type: 'added',
        content: newLines[newIdx],
        newLineNum: newLineNum++
      })
      newIdx++
    }
    
    // 添加未更改的行
    result.push({
      type: 'unchanged',
      content: oldLines[oldIdx],
      oldLineNum: oldLineNum++,
      newLineNum: newLineNum++
    })
    oldIdx++
    newIdx++
  }
  
  // 处理剩余的删除行
  while (oldIdx < oldLines.length) {
    result.push({
      type: 'deleted',
      content: oldLines[oldIdx],
      oldLineNum: oldLineNum++
    })
    oldIdx++
  }
  
  // 处理剩余的新增行
  while (newIdx < newLines.length) {
    result.push({
      type: 'added',
      content: newLines[newIdx],
      newLineNum: newLineNum++
    })
    newIdx++
  }
  
  return result
}

// 计算最长公共子序列
interface LCSMatch {
  oldIndex: number
  newIndex: number
}

function computeLCS(oldLines: string[], newLines: string[]): LCSMatch[] {
  const m = oldLines.length
  const n = newLines.length
  
  // 创建 DP 表
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }
  
  // 回溯找出匹配的行
  const result: LCSMatch[] = []
  let i = m, j = n
  
  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ oldIndex: i - 1, newIndex: j - 1 })
      i--
      j--
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }
  
  return result
}

// 获取行号宽度
function getDiffLineNumWidth(diffContent: DiffContent): number {
  const oldLines = diffContent.originalContent.split('\n').length
  const newLines = diffContent.newContent.split('\n').length
  return String(Math.max(oldLines, newLines)).length
}

// 格式化行号
function formatLineNum(num: number | undefined, width: number): string {
  if (num === undefined) return ' '.repeat(width)
  return String(num).padStart(width)
}

// 获取统计信息
function getDiffStats(diffLines: DiffLine[]) {
  const deleted = diffLines.filter(l => l.type === 'deleted').length
  const added = diffLines.filter(l => l.type === 'added').length
  return { deleted, added }
}

// 预览 diff 行数
const previewDiffLineCount = 20

// Diff 展开状态
const expandedDiffs = ref<Set<string>>(new Set())

// 检查 diff 是否需要展开
function needsDiffExpand(diffLines: DiffLine[]): boolean {
  return diffLines.length > previewDiffLineCount
}

// 获取显示的 diff 行
function getDisplayDiffLines(diffLines: DiffLine[], path: string): DiffLine[] {
  if (expandedDiffs.value.has(path) || diffLines.length <= previewDiffLineCount) {
    return diffLines
  }
  return diffLines.slice(0, previewDiffLineCount)
}

// 切换 diff 展开状态
function toggleDiffExpand(path: string) {
  if (expandedDiffs.value.has(path)) {
    expandedDiffs.value.delete(path)
  } else {
    expandedDiffs.value.add(path)
  }
}

// 检查 diff 是否已展开
function isDiffExpanded(path: string): boolean {
  return expandedDiffs.value.has(path)
}
</script>

<template>
  <div class="search-in-files-panel">
    <!-- 头部统计 -->
    <div class="panel-header">
      <div class="header-info">
        <span :class="['codicon', isReplaceMode ? 'codicon-replace-all' : 'codicon-search', 'search-icon']"></span>
        <span class="title">{{ isReplaceMode ? t('components.tools.search.searchInFilesPanel.replaceTitle') : t('components.tools.search.searchInFilesPanel.title') }}</span>
        <span v-if="isRegex" class="regex-badge">{{ t('components.tools.search.searchInFilesPanel.regex') }}</span>
        <span v-if="isReplaceMode && dryRun" class="dryrun-badge">{{ t('components.tools.search.searchInFilesPanel.dryRun') }}</span>
      </div>
      <div class="header-stats">
        <span v-if="isReplaceMode" class="stat success">
          <span class="codicon codicon-check"></span>
          {{ t('components.tools.search.searchInFilesPanel.replacements', { count: matchCount }) }}
        </span>
        <span v-if="isReplaceMode" class="stat">{{ t('components.tools.search.searchInFilesPanel.filesModified', { count: filesModified }) }}</span>
        <span v-else class="stat">{{ t('components.tools.search.searchInFilesPanel.matchCount', { count: matchCount }) }}</span>
        <span v-if="!isReplaceMode" class="stat">{{ t('components.tools.search.searchInFilesPanel.fileCount', { count: fileCount }) }}</span>
        <span v-if="truncated" class="stat truncated">{{ t('components.tools.search.searchInFilesPanel.truncated') }}</span>
      </div>
    </div>
    
    <!-- 搜索信息 -->
    <div class="search-info">
      <div class="query-row">
        <span class="label">{{ t('components.tools.search.searchInFilesPanel.keywords') }}</span>
        <code class="query-text">{{ searchQuery }}</code>
      </div>
      <div v-if="isReplaceMode && replacement !== undefined" class="replace-row">
        <span class="label">{{ t('components.tools.search.searchInFilesPanel.replaceWith') }}</span>
        <code class="replace-text">{{ replacement || t('components.tools.search.searchInFilesPanel.emptyString') }}</code>
      </div>
      <div v-if="searchPath !== '.'" class="path-row">
        <span class="label">{{ t('components.tools.search.searchInFilesPanel.path') }}</span>
        <span class="path-text">{{ searchPath }}</span>
      </div>
      <div v-if="filePattern !== '**/*'" class="pattern-row">
        <span class="label">{{ t('components.tools.search.searchInFilesPanel.pattern') }}</span>
        <span class="pattern-text">{{ filePattern }}</span>
      </div>
    </div>
    
    <!-- 全局错误 -->
    <div v-if="error" class="panel-error">
      <span class="codicon codicon-error error-icon"></span>
      <span class="error-text">{{ error }}</span>
    </div>
    
    <!-- 无结果 -->
    <div v-else-if="searchResults.length === 0 && !error" class="no-results">
      <span class="codicon codicon-info"></span>
      <span>{{ t('components.tools.search.searchInFilesPanel.noResults') }}</span>
    </div>
    
    <!-- 替换模式：按文件显示结果 -->
    <div v-else-if="isReplaceMode" class="replace-results">
      <div
        v-for="replaceResult in replaceResults"
        :key="replaceResult.file"
        class="replace-file-panel"
      >
        <!-- 文件头部 -->
        <div class="file-header">
          <div class="file-info">
            <span class="codicon codicon-file file-icon"></span>
            <span class="file-name">{{ getFileName(replaceResult.file) }}</span>
            <span class="file-path">{{ replaceResult.file }}</span>
            <span class="replace-count">{{ t('components.tools.search.searchInFilesPanel.replacementsInFile', { count: replaceResult.replacements }) }}</span>
          </div>
        </div>
        
        <!-- 视图切换按钮 -->
        <div v-if="hasDiffContent(replaceResult.file)" class="view-toggle">
          <button
            :class="['toggle-btn', { active: getViewMode(replaceResult.file) === 'matches' }]"
            @click="viewModes.set(replaceResult.file, 'matches')"
          >
            <span class="codicon codicon-list-flat"></span>
            {{ t('components.tools.search.searchInFilesPanel.viewMatches') }}
          </button>
          <button
            :class="['toggle-btn', { active: getViewMode(replaceResult.file) === 'diff' }]"
            @click="viewModes.set(replaceResult.file, 'diff')"
          >
            <span class="codicon codicon-diff"></span>
            {{ t('components.tools.search.searchInFilesPanel.viewDiff') }}
          </button>
        </div>
        
        <!-- 加载中 -->
        <div v-if="isLoadingDiff(replaceResult.file)" class="loading-diff">
          <span class="codicon codicon-loading codicon-modifier-spin"></span>
          {{ t('components.tools.search.searchInFilesPanel.loadingDiff') }}
        </div>
        
        <!-- Diff 视图 -->
        <div v-else-if="hasDiffContent(replaceResult.file) && getViewMode(replaceResult.file) === 'diff'" class="diff-view">
          <div class="diff-stats-bar">
            <span class="stat deleted">
              <span class="codicon codicon-remove"></span>
              {{ getDiffStats(computeDiffLines(getDiffContent(replaceResult.file)!.originalContent, getDiffContent(replaceResult.file)!.newContent)).deleted }}
            </span>
            <span class="stat added">
              <span class="codicon codicon-add"></span>
              {{ getDiffStats(computeDiffLines(getDiffContent(replaceResult.file)!.originalContent, getDiffContent(replaceResult.file)!.newContent)).added }}
            </span>
          </div>
          <CustomScrollbar :horizontal="true" :max-height="300">
            <div class="diff-lines">
              <div
                v-for="(line, lineIndex) in getDisplayDiffLines(computeDiffLines(getDiffContent(replaceResult.file)!.originalContent, getDiffContent(replaceResult.file)!.newContent), replaceResult.file)"
                :key="lineIndex"
                :class="['diff-line', `line-${line.type}`]"
              >
                <span class="line-nums">
                  <span class="old-num">{{ formatLineNum(line.oldLineNum, getDiffLineNumWidth(getDiffContent(replaceResult.file)!)) }}</span>
                  <span class="new-num">{{ formatLineNum(line.newLineNum, getDiffLineNumWidth(getDiffContent(replaceResult.file)!)) }}</span>
                </span>
                <span class="line-marker">
                  <span v-if="line.type === 'deleted'" class="marker deleted">-</span>
                  <span v-else-if="line.type === 'added'" class="marker added">+</span>
                  <span v-else class="marker unchanged">&nbsp;</span>
                </span>
                <span class="line-content">{{ line.content || ' ' }}</span>
              </div>
            </div>
          </CustomScrollbar>
          
          <!-- 展开/收起按钮 -->
          <div v-if="needsDiffExpand(computeDiffLines(getDiffContent(replaceResult.file)!.originalContent, getDiffContent(replaceResult.file)!.newContent))" class="expand-section">
            <button class="expand-btn" @click="toggleDiffExpand(replaceResult.file)">
              <span :class="['codicon', isDiffExpanded(replaceResult.file) ? 'codicon-chevron-up' : 'codicon-chevron-down']"></span>
              {{ isDiffExpanded(replaceResult.file) ? t('components.tools.search.searchInFilesPanel.collapse') : t('components.tools.search.searchInFilesPanel.expandRemaining', { count: computeDiffLines(getDiffContent(replaceResult.file)!.originalContent, getDiffContent(replaceResult.file)!.newContent).length - previewDiffLineCount }) }}
            </button>
          </div>
        </div>
        
        <!-- 匹配列表视图 -->
        <div v-else class="matches-view">
          <CustomScrollbar :max-height="200">
            <div class="match-items">
              <div
                v-for="(match, index) in searchResults.filter(m => m.file === replaceResult.file)"
                :key="`${match.line}-${index}`"
                class="match-item-compact"
              >
                <span class="line-info">:{{ match.line }}:{{ match.column }}</span>
                <code class="match-text">{{ match.match }}</code>
              </div>
            </div>
          </CustomScrollbar>
        </div>
      </div>
    </div>
    
    <!-- 仅搜索模式：结果列表 -->
    <div v-else class="results-list">
      <CustomScrollbar :max-height="300">
        <div class="match-items">
          <div
            v-for="(match, index) in displayResults"
            :key="`${match?.file || ''}-${match?.line || 0}-${index}`"
            class="match-item"
          >
            <div class="match-header">
              <span class="codicon codicon-file file-icon"></span>
              <span class="file-name">{{ getFileName(match?.file) }}</span>
              <span class="file-path">{{ match?.file || '' }}</span>
              <span class="line-info">:{{ match?.line || 0 }}:{{ match?.column || 0 }}</span>
            </div>
            <div class="match-context">
              <pre><code v-html="highlightMatch(match?.context, match?.match)"></code></pre>
            </div>
          </div>
        </div>
      </CustomScrollbar>
      
      <!-- 展开/收起按钮 -->
      <div v-if="needsExpand" class="expand-section">
        <button class="expand-btn" @click="toggleExpand">
          <span :class="['codicon', expanded ? 'codicon-chevron-up' : 'codicon-chevron-down']"></span>
          {{ expanded ? t('components.tools.search.searchInFilesPanel.collapse') : t('components.tools.search.searchInFilesPanel.expandRemaining', { count: searchResults.length - previewMatchCount }) }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-in-files-panel {
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
  color: var(--vscode-charts-orange);
  font-size: 14px;
}

.title {
  font-weight: 600;
  font-size: 12px;
  color: var(--vscode-foreground);
}

.regex-badge,
.dryrun-badge {
  font-size: 9px;
  padding: 1px 4px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: 2px;
}

.dryrun-badge {
  background: var(--vscode-charts-yellow);
  color: var(--vscode-editor-background);
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

.stat.truncated {
  color: var(--vscode-charts-yellow);
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

.query-row,
.replace-row,
.path-row,
.pattern-row {
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
  color: var(--vscode-charts-orange);
  background: var(--vscode-textCodeBlock-background);
  padding: 0 4px;
  border-radius: 2px;
}

.replace-text {
  font-family: var(--vscode-editor-font-family);
  color: var(--vscode-testing-iconPassed);
  background: var(--vscode-textCodeBlock-background);
  padding: 0 4px;
  border-radius: 2px;
}

.path-text,
.pattern-text {
  font-family: var(--vscode-editor-font-family);
  color: var(--vscode-foreground);
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

/* 无结果 */
.no-results {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-md, 16px);
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

/* 替换结果 */
.replace-results {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
}

.replace-file-panel {
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-sm, 2px);
  overflow: hidden;
}

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

.file-name {
  font-size: 11px;
  font-weight: 500;
  color: var(--vscode-foreground);
  flex-shrink: 0;
}

.file-path {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  font-family: var(--vscode-editor-font-family);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.replace-count {
  font-size: 10px;
  color: var(--vscode-testing-iconPassed);
  margin-left: auto;
  flex-shrink: 0;
}

/* 视图切换 */
.view-toggle {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-bottom: 1px solid var(--vscode-panel-border);
}

.toggle-btn {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  padding: 2px var(--spacing-sm, 8px);
  background: transparent;
  border: none;
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  border-radius: var(--radius-sm, 2px);
  transition: all var(--transition-fast, 0.1s);
}

.toggle-btn:hover {
  background: var(--vscode-toolbar-hoverBackground);
  color: var(--vscode-foreground);
}

.toggle-btn.active {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

/* 加载中 */
.loading-diff {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-sm, 8px);
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
}

/* Diff 视图 */
.diff-view {
  display: flex;
  flex-direction: column;
  background: var(--vscode-editor-background);
}

.diff-stats-bar {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  padding: 2px var(--spacing-sm, 8px);
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-bottom: 1px solid var(--vscode-panel-border);
}

.diff-stats-bar .stat {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
}

.diff-stats-bar .stat.deleted {
  color: var(--vscode-gitDecoration-deletedResourceForeground, #f85149);
}

.diff-stats-bar .stat.added {
  color: var(--vscode-gitDecoration-addedResourceForeground, #3fb950);
}

.diff-lines {
  display: flex;
  flex-direction: column;
  font-family: var(--vscode-editor-font-family);
  font-size: 11px;
  line-height: 1.5;
}

/* Diff 行样式 */
.diff-line {
  display: flex;
  white-space: pre;
  min-height: 1.5em;
}

.diff-line.line-unchanged {
  background: transparent;
}

.diff-line.line-deleted {
  background: rgba(255, 82, 82, 0.15);
}

.diff-line.line-added {
  background: rgba(0, 200, 83, 0.15);
}

/* 行号 */
.line-nums {
  display: flex;
  flex-shrink: 0;
  padding: 0 var(--spacing-xs, 4px);
  background: rgba(128, 128, 128, 0.1);
  border-right: 1px solid var(--vscode-panel-border);
}

.old-num,
.new-num {
  min-width: 24px;
  text-align: right;
  color: var(--vscode-editorLineNumber-foreground);
  padding: 0 2px;
}

.line-deleted .old-num {
  color: var(--vscode-gitDecoration-deletedResourceForeground, #f85149);
}

.line-added .new-num {
  color: var(--vscode-gitDecoration-addedResourceForeground, #3fb950);
}

/* 差异标记 */
.line-marker {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  flex-shrink: 0;
}

.marker {
  font-weight: bold;
}

.marker.deleted {
  color: var(--vscode-gitDecoration-deletedResourceForeground, #f85149);
}

.marker.added {
  color: var(--vscode-gitDecoration-addedResourceForeground, #3fb950);
}

.marker.unchanged {
  color: transparent;
}

/* 行内容 */
.line-content {
  flex: 1;
  padding: 0 var(--spacing-sm, 8px);
}

/* 匹配列表视图 */
.matches-view {
  background: var(--vscode-editor-background);
}

.match-items {
  display: flex;
  flex-direction: column;
}

.match-item-compact {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  border-bottom: 1px solid var(--vscode-panel-border);
  font-size: 11px;
}

.match-item-compact:last-child {
  border-bottom: none;
}

.match-item-compact .line-info {
  color: var(--vscode-charts-orange);
  font-family: var(--vscode-editor-font-family);
  flex-shrink: 0;
}

.match-item-compact .match-text {
  font-family: var(--vscode-editor-font-family);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-findMatchHighlightBackground);
  padding: 0 4px;
  border-radius: 2px;
}

/* 结果列表 */
.results-list {
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-sm, 2px);
  overflow: hidden;
  /* 确保容器有最小高度，避免内容为空时高度坍塌 */
  min-height: 0;
}

/* 确保滚动容器能正确显示 */
.results-list :deep(.custom-scrollbar-wrapper) {
  height: auto !important;
  min-height: 0;
}

.results-list :deep(.scroll-container) {
  height: auto !important;
  min-height: 0;
}

.match-item {
  border-bottom: 1px solid var(--vscode-panel-border);
}

.match-item:last-child {
  border-bottom: none;
}

.match-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  background: var(--vscode-editor-inactiveSelectionBackground);
  font-size: 11px;
}

.line-info {
  color: var(--vscode-charts-orange);
  font-family: var(--vscode-editor-font-family);
  margin-left: auto;
  flex-shrink: 0;
}

.match-context {
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  background: var(--vscode-editor-background);
}

.match-context pre {
  margin: 0;
  font-size: 11px;
  font-family: var(--vscode-editor-font-family);
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-all;
}

.match-context code {
  font-family: inherit;
}

.match-context :deep(mark) {
  background: var(--vscode-editor-findMatchHighlightBackground);
  color: inherit;
  padding: 0 2px;
  border-radius: 2px;
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