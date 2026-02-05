<script setup lang="ts">
/**
 * apply_diff 工具的内容面板
 *
 * 显示差异对比：
 * - 被删除的代码（红色背景）
 * - 新增的代码（绿色背景）
 * - 每个 diff 块独立显示
 */

import { computed, ref, onBeforeUnmount, onMounted } from 'vue'
import CustomScrollbar from '../../common/CustomScrollbar.vue'
import { useI18n } from '@/composables'
import { onExtensionCommand } from '../../../utils/vscode'

const props = defineProps<{
  args: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
  toolId?: string
}>()

const { t } = useI18n()

// 加载配置
onMounted(async () => {
  // 监听后端状态变化
  const unregister = onExtensionCommand('diff.statusChanged', (data: any) => {
    const myPendingDiffId = (props.result?.data as any)?.pendingDiffId
    if (myPendingDiffId) {
      // 检查我的这个 diff 是否在 pending 列表中
      const isStillPending = data.pendingDiffs.some((d: any) => d.id === myPendingDiffId)
      
      // 如果不在 pending 列表了，说明被处理了（接受或拒绝）
      if (!isStillPending) {
        // 不需要操作
      }
    }
  })

  onBeforeUnmount(unregister)
})

// 展开状态
const expanded = ref<Set<number>>(new Set())

// 复制状态
const copiedDiffs = ref<Set<number>>(new Set())
const copyTimeouts = new Map<number, ReturnType<typeof setTimeout>>()

// 单个 diff 块
interface DiffBlock {
  search: string
  replace: string
  /** 原文件起始行（1-based） */
  start_line?: number
  /** 新文件起始行（1-based）。仅 unified diff hunks 需要（old/new 起始行可能不同） */
  new_start_line?: number
  success?: boolean
  error?: string
}

function parseUnifiedPatchToDiffBlocks(patch: string): DiffBlock[] {
  const normalized = patch.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')

  const blocks: DiffBlock[] = []

  let oldStart = 1
  let newStart = 1
  let searchLines: string[] | null = null
  let replaceLines: string[] | null = null

  const flush = () => {
    if (!searchLines || !replaceLines) return
    blocks.push({
      search: searchLines.join('\n'),
      replace: replaceLines.join('\n'),
      start_line: oldStart,
      new_start_line: newStart
    })
    searchLines = null
    replaceLines = null
  }

  for (const line of lines) {
    if (line.startsWith('@@')) {
      flush()
      const m = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/)
      if (!m) {
        continue
      }
      oldStart = parseInt(m[1], 10) || 1
      newStart = parseInt(m[3], 10) || oldStart
      searchLines = []
      replaceLines = []
      continue
    }

    if (!searchLines || !replaceLines) {
      continue
    }

    if (!line) {
      continue
    }

    if (line.startsWith('\\')) {
      // "\\ No newline at end of file"
      continue
    }

    const prefix = line[0]
    const content = line.slice(1)

    if (prefix === ' ') {
      searchLines.push(content)
      replaceLines.push(content)
    } else if (prefix === '-') {
      searchLines.push(content)
    } else if (prefix === '+') {
      replaceLines.push(content)
    }
  }

  flush()
  return blocks
}

// 获取文件路径
const filePath = computed(() => {
  return (props.args.path as string) || ''
})

// 获取 diff 列表
// - 新格式：优先读取 args.patch（unified diff）并按 hunk 转换为可展示的 DiffBlock
// - 旧格式：兼容 args.diffs
const diffList = computed((): DiffBlock[] => {
  const patch = props.args.patch as string | undefined
  if (patch && typeof patch === 'string' && patch.trim()) {
    const blocks = parseUnifiedPatchToDiffBlocks(patch)
    const data = props.result?.data as Record<string, any> | undefined
    const results = (data?.results as Array<{ index: number; success?: boolean; error?: string; startLine?: number }> | undefined) || []

    // 将后端 best-effort 的逐 hunk 结果叠加到展示块上
    return blocks.map((b, i) => {
      const r = results.find(x => x.index === i)
      if (!r) {
        return { ...b }
      }
      return {
        ...b,
        success: r.success,
        error: r.error,
        // 统一使用后端返回的 startLine（更接近真实应用位置）；没有则退回参数
        start_line: (r.startLine as any) ?? b.start_line
      }
    })
  }

  const argsDiffs = (props.args.diffs as DiffBlock[] | undefined) || []
  const failedDiffs = (props.result?.data as Record<string, any>)?.failedDiffs as any[] | undefined
  
  // 向后兼容旧格式（带有 results 或 diffs 的情况）
  const data = props.result?.data as Record<string, any> | undefined
  if (data?.results || data?.diffs) {
    const results = data.results || data.diffs
    return argsDiffs.map((diff, i) => {
      const res = results.find((r: any) => r.index === i) || {}
      return {
        ...diff,
        success: res.success,
        error: res.error,
        // 不要默认填充为 1：start_line 仅在“参数中提供/后端返回匹配行号”时才展示
        start_line: res.matchedLine ?? res.start_line ?? diff.start_line
      }
    })
  }

  // 新格式：仅使用 failedDiffs 判断
  return argsDiffs.map((diff, i) => {
    const failure = failedDiffs?.find(f => f.index === i)
    return {
      ...diff,
      success: !failure,
      error: failure?.error,
      // start_line 允许为空；为空时前端不显示“line xx”标记，但内部行号仍会从 1 开始计算
      start_line: diff.start_line
    }
  })
})

// 获取结果信息
const resultData = computed(() => {
  const result = props.result as Record<string, any> | undefined
  return result?.data || null
})

// 变更数量
// 优先使用可渲染的 diffList（用于展示），否则回退到后端统计字段（避免 patch 过大未透传导致显示 0）
const changesCount = computed(() => {
  if (diffList.value.length > 0) return diffList.value.length

  const data: any = resultData.value || {}
  const fromDiffCount = Number(data?.diffCount)
  if (Number.isFinite(fromDiffCount) && fromDiffCount > 0) return fromDiffCount

  const fromTotalCount = Number(data?.totalCount)
  if (Number.isFinite(fromTotalCount) && fromTotalCount > 0) return fromTotalCount

  const fromApplied = Number(data?.appliedCount)
  if (Number.isFinite(fromApplied) && fromApplied > 0) return fromApplied

  return 0
})

// 获取用户编辑摘要（如果用户在保存前修改了 AI 建议）
// 每行格式：`op | line | content`，多行用 `\n` 分隔
// - 插入：`+ | newLine | content`
// - 替换：`~ | newLine | content`
// - 删除：`- | baseLine | content`
// 空行内容为空字符串
const userEditedContent = computed(() => {
  return resultData.value?.userEditedContent as string | undefined
})

// 是否为全失败
const isFailed = computed(() => {
  return !!props.error || (resultData.value && resultData.value.appliedCount === 0)
})

// 是否为部分成功（有成功也有失败）
const isPartial = computed(() => {
  const data = resultData.value
  return !props.error && data && data.appliedCount > 0 && data.failedCount > 0
})

// 获取文件名
function getFileName(filePath: string): string {
  const parts = filePath.split(/[/\\]/)
  return parts[parts.length - 1] || filePath
}

// 获取文件扩展名
function getFileExtension(filePath: string): string {
  const fileName = getFileName(filePath)
  const lastDotIndex = fileName.lastIndexOf('.')
  if (lastDotIndex > 0) {
    return fileName.substring(lastDotIndex + 1)
  }
  return ''
}

// 获取不含扩展名的文件名
function getFileNameWithoutExt(filePath: string): string {
  const fileName = getFileName(filePath)
  const lastDotIndex = fileName.lastIndexOf('.')
  if (lastDotIndex > 0) {
    return fileName.substring(0, lastDotIndex)
  }
  return fileName
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
 * @param search 搜索内容
 * @param replace 替换内容
 * @param startLine 原文件起始行号（1-based），默认为 1
 * @param newStartLine 新文件起始行号（1-based）。unified diff hunks 的 old/new 起始行可能不同。
 */
function computeDiffLines(search: string, replace: string, startLine: number = 1, newStartLine: number = startLine): DiffLine[] {
  const searchLines = search.split('\n')
  const replaceLines = replace.split('\n')
  const result: DiffLine[] = []
  
  // 使用简单的最长公共子序列算法找出差异
  const lcs = computeLCS(searchLines, replaceLines)
  
  let oldIdx = 0
  let newIdx = 0
  // 使用文件中的实际起始行号
  let oldLineNum = startLine
  let newLineNum = newStartLine
  
  for (const match of lcs) {
    // 添加删除的行（在 search 中但不在 LCS 中）
    while (oldIdx < match.oldIndex) {
      result.push({
        type: 'deleted',
        content: searchLines[oldIdx],
        oldLineNum: oldLineNum++
      })
      oldIdx++
    }
    
    // 添加新增的行（在 replace 中但不在 LCS 中）
    while (newIdx < match.newIndex) {
      result.push({
        type: 'added',
        content: replaceLines[newIdx],
        newLineNum: newLineNum++
      })
      newIdx++
    }
    
    // 添加未更改的行
    result.push({
      type: 'unchanged',
      content: searchLines[oldIdx],
      oldLineNum: oldLineNum++,
      newLineNum: newLineNum++
    })
    oldIdx++
    newIdx++
  }
  
  // 处理剩余的删除行
  while (oldIdx < searchLines.length) {
    result.push({
      type: 'deleted',
      content: searchLines[oldIdx],
      oldLineNum: oldLineNum++
    })
    oldIdx++
  }
  
  // 处理剩余的新增行
  while (newIdx < replaceLines.length) {
    result.push({
      type: 'added',
      content: replaceLines[newIdx],
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
function getLineNumWidth(diff: DiffBlock): number {
  const startLine = diff.start_line || 1
  const newStartLine = diff.new_start_line ?? startLine
  const searchLines = diff.search.split('\n').length
  const replaceLines = diff.replace.split('\n').length
  // 计算实际的最大行号（起始行号 + 行数 - 1）
  const maxOldLineNum = startLine + searchLines - 1
  const maxNewLineNum = newStartLine + replaceLines - 1
  const maxLineNum = Math.max(maxOldLineNum, maxNewLineNum)
  return String(maxLineNum).length
}

// 格式化行号
function formatLineNum(num: number | undefined, width: number): string {
  if (num === undefined) return ' '.repeat(width)
  return String(num).padStart(width)
}

// 预览行数
const previewLineCount = 20

// 检查是否需要展开按钮
function needsExpand(diffLines: DiffLine[]): boolean {
  return diffLines.length > previewLineCount
}

// 获取显示的 diff 行
function getDisplayLines(diffLines: DiffLine[], index: number): DiffLine[] {
  if (expanded.value.has(index) || diffLines.length <= previewLineCount) {
    return diffLines
  }
  return diffLines.slice(0, previewLineCount)
}

// 切换展开状态
function toggleExpand(index: number) {
  if (expanded.value.has(index)) {
    expanded.value.delete(index)
  } else {
    expanded.value.add(index)
  }
}

// 检查是否已展开
function isExpanded(index: number): boolean {
  return expanded.value.has(index)
}

// 检查是否已复制
function isCopied(index: number): boolean {
  return copiedDiffs.value.has(index)
}

// 复制替换后的内容
async function copyReplace(diff: DiffBlock, index: number) {
  try {
    await navigator.clipboard.writeText(diff.replace)
    
    copiedDiffs.value.add(index)
    
    const existingTimeout = copyTimeouts.get(index)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }
    
    const timeout = setTimeout(() => {
      copiedDiffs.value.delete(index)
      copyTimeouts.delete(index)
    }, 1000)
    copyTimeouts.set(index, timeout)
  } catch (err) {
    console.error('复制失败:', err)
  }
}

// 获取统计信息
function getDiffStats(diffLines: DiffLine[]) {
  const deleted = diffLines.filter(l => l.type === 'deleted').length
  const added = diffLines.filter(l => l.type === 'added').length
  return { deleted, added }
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
  <div class="apply-diff-panel">
    <!-- 头部信息 -->
    <div class="panel-header">
      <div class="header-info">
        <span class="codicon codicon-diff diff-icon"></span>
        <span class="title">{{ t('components.tools.file.applyDiffPanel.title') }}</span>
      </div>
      <div class="header-stats">
        <span class="stat">
          <span class="codicon codicon-file"></span>
          {{ getFileNameWithoutExt(filePath) }}<span v-if="getFileExtension(filePath)" class="file-ext">.{{ getFileExtension(filePath) }}</span>
        </span>
        <span class="stat">{{ changesCount }} {{ t('components.tools.file.applyDiffPanel.changes') }}</span>
      </div>
    </div>
    
    <!-- 文件路径 -->
    <div class="file-path-bar">
      <span class="codicon codicon-file-code"></span>
      <span class="path">{{ filePath }}</span>
    </div>
    
    <!-- 结果状态 -->
    <div v-if="resultData" class="result-status" :class="{ 'is-error': isFailed && !isPartial, 'is-partial': isPartial }">
      <span v-if="!isFailed && !isPartial" class="codicon codicon-check status-icon success"></span>
      <span v-else-if="isPartial" class="codicon codicon-check status-icon partial"></span>
      <span v-else class="codicon codicon-error status-icon error"></span>
      <span class="status-text">
        <template v-if="error">{{ error }}</template>
        <template v-else-if="resultData.message">{{ resultData.message }}</template>
        <template v-else-if="isPartial">{{ t('components.tools.file.applyDiffPanel.diffApplied') }} ({{ resultData.appliedCount }}/{{ resultData.totalCount }})</template>
        <template v-else-if="isFailed">{{ t('common.failed') }}</template>
        <template v-else>{{ t('components.tools.file.applyDiffPanel.diffApplied') }}</template>
      </span>
      <span v-if="resultData.status === 'pending'" class="status-badge pending">{{ t('components.tools.file.applyDiffPanel.pending') }}</span>
      <span v-else-if="resultData.status === 'accepted'" class="status-badge accepted">{{ t('components.tools.file.applyDiffPanel.accepted') }}</span>
      <span v-else-if="resultData.status === 'rejected'" class="status-badge rejected">{{ t('components.tools.file.applyDiffPanel.rejected') }}</span>
    </div>

    <!-- 用户编辑提示（仅展示摘要，避免完整文件内容） -->
    <div v-if="userEditedContent" class="user-edit-section">
      <div class="user-edit-header">
        <span class="codicon codicon-edit user-edit-icon"></span>
        <span class="user-edit-title" :title="t('components.tools.file.applyDiffPanel.userEditedContent')">{{
          t('components.tools.file.applyDiffPanel.userEdited')
        }}</span>
      </div>
      <div class="user-edit-content">
        <CustomScrollbar :horizontal="true" :max-height="240">
          <pre class="user-edit-code">{{ userEditedContent }}</pre>
        </CustomScrollbar>
      </div>
    </div>
    
    <!-- 全局错误 -->
    <div v-if="error && !resultData" class="panel-error">
      <span class="codicon codicon-error error-icon"></span>
      <span class="error-text">{{ error }}</span>
    </div>
    
        <!-- Diff 列表 -->
    <div class="diff-list">
      <div
        v-for="(diff, index) in diffList"
        :key="index"
        class="diff-block"
        :class="{ 'is-failed': diff.success === false }"
      >
        <!-- Diff 头部 -->
        <div class="diff-header" :class="{ 'is-failed': diff.success === false }">
          <div class="diff-info">
            <span class="diff-number">{{ t('components.tools.file.applyDiffPanel.diffNumber') }}{{ index + 1 }}</span>
            
            <!-- 状态图标 -->
            <span v-if="diff.success === true" class="status-icon success" :title="t('common.success')">
              <span class="codicon codicon-check"></span>
            </span>
            <span v-else-if="diff.success === false" class="status-icon error" :title="diff.error || t('common.failed')">
              <span class="codicon codicon-error"></span>
              <span class="error-msg">{{ diff.error || t('common.failed') }}</span>
            </span>

            <span v-if="diff.start_line" class="start-line">
              <span class="codicon codicon-location"></span>
              {{ t('components.tools.file.applyDiffPanel.line') }} {{ diff.start_line }}
            </span>
            <!-- 统计信息 -->
            <span v-if="diff.success !== false" class="diff-stats">
              <span class="stat deleted">
                <span class="codicon codicon-remove"></span>
                {{ getDiffStats(computeDiffLines(diff.search, diff.replace, diff.start_line || 1, diff.new_start_line || diff.start_line || 1)).deleted }}
              </span>
              <span class="stat added">
                <span class="codicon codicon-add"></span>
                {{ getDiffStats(computeDiffLines(diff.search, diff.replace, diff.start_line || 1, diff.new_start_line || diff.start_line || 1)).added }}
              </span>
            </span>
          </div>
          <div class="diff-actions">
            <button
              class="action-btn"
              :class="{ 'copied': isCopied(index) }"
              :title="isCopied(index) ? t('components.tools.file.applyDiffPanel.copied') : t('components.tools.file.applyDiffPanel.copyNew')"
              @click.stop="copyReplace(diff, index)"
            >
              <span :class="['codicon', isCopied(index) ? 'codicon-check' : 'codicon-copy']"></span>
            </button>
          </div>
        </div>
        
        <!-- Diff 内容 -->
        <div class="diff-content" v-if="diff.success !== false">
          <CustomScrollbar :horizontal="true" :max-height="300">
            <div class="diff-lines">
              <div
                v-for="(line, lineIndex) in getDisplayLines(computeDiffLines(diff.search, diff.replace, diff.start_line || 1, diff.new_start_line || diff.start_line || 1), index)"
                :key="lineIndex"
                :class="['diff-line', `line-${line.type}`]"
              >
                <!-- 行号列 -->
                <span class="line-nums">
                  <span class="old-num">{{ formatLineNum(line.oldLineNum, getLineNumWidth(diff)) }}</span>
                  <span class="new-num">{{ formatLineNum(line.newLineNum, getLineNumWidth(diff)) }}</span>
                </span>
                <!-- 差异标记 -->
                <span class="line-marker">
                  <span v-if="line.type === 'deleted'" class="marker deleted">-</span>
                  <span v-else-if="line.type === 'added'" class="marker added">+</span>
                  <span v-else class="marker unchanged">&nbsp;</span>
                </span>
                <!-- 内容 -->
                <span class="line-content">{{ line.content || ' ' }}</span>
              </div>
            </div>
          </CustomScrollbar>
          
          <!-- 展开/收起按钮 -->
          <div v-if="needsExpand(computeDiffLines(diff.search, diff.replace, diff.start_line || 1, diff.new_start_line || diff.start_line || 1))" class="expand-section">
            <button class="expand-btn" @click="toggleExpand(index)">
              <span :class="['codicon', isExpanded(index) ? 'codicon-chevron-up' : 'codicon-chevron-down']"></span>
              {{ isExpanded(index) ? t('components.tools.file.applyDiffPanel.collapse') : t('components.tools.file.applyDiffPanel.expandRemaining', { count: computeDiffLines(diff.search, diff.replace, diff.start_line || 1, diff.new_start_line || diff.start_line || 1).length - previewLineCount }) }}
            </button>
          </div>
        </div>

        <!-- 失败时的内容预览 -->
        <div v-if="diff.success === false" class="diff-content-failed">
          <div class="failed-section">
            <div class="failed-label">{{ t('components.message.tool.parameters') }} (search):</div>
            <CustomScrollbar :horizontal="true" :max-height="150">
              <pre class="failed-code search">{{ diff.search }}</pre>
            </CustomScrollbar>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.apply-diff-panel {
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

.diff-icon {
  color: var(--vscode-charts-purple, #a855f7);
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

.file-ext {
  opacity: 0.7;
}

/* 文件路径栏 */
.file-path-bar {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-radius: var(--radius-sm, 2px);
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  font-family: var(--vscode-editor-font-family);
}

.file-path-bar .codicon {
  color: var(--vscode-charts-blue);
}

.file-path-bar .path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 结果状态 */
.result-status {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  background: var(--vscode-testing-iconPassed);
  background: rgba(0, 200, 83, 0.1);
  border: 1px solid var(--vscode-testing-iconPassed);
  border-radius: var(--radius-sm, 2px);
}

.result-status.is-error {
  background: rgba(255, 82, 82, 0.1);
  border-color: var(--vscode-testing-iconFailed);
}

.result-status.is-partial {
  background: rgba(230, 149, 0, 0.1);
  border-color: var(--vscode-charts-orange);
}

.status-icon {
  font-size: 12px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.status-icon.success {
  color: var(--vscode-testing-iconPassed);
}

.status-icon.error {
  color: var(--vscode-testing-iconFailed);
}

.status-icon.partial {
  color: var(--vscode-charts-yellow);
}

.status-text {
  flex: 1;
  font-size: 11px;
  color: var(--vscode-foreground);
}

.status-badge {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 2px;
  font-weight: 500;
}

.status-badge.pending {
  background: var(--vscode-charts-orange, #e69500);
  color: var(--vscode-editor-background);
}

.status-badge.accepted {
  background: var(--vscode-testing-iconPassed);
  color: var(--vscode-editor-background);
}

.status-badge.rejected {
  background: var(--vscode-testing-iconFailed);
  color: var(--vscode-editor-background);
}

/* 用户编辑区块 */
.user-edit-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs, 4px);
  padding: var(--spacing-sm, 8px);
  background: rgba(0, 122, 204, 0.08);
  border: 1px solid var(--vscode-charts-blue, #007acc);
  border-radius: var(--radius-sm, 2px);
}

.user-edit-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
}

.user-edit-icon {
  color: var(--vscode-charts-blue, #007acc);
  font-size: 12px;
}

.user-edit-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--vscode-charts-blue, #007acc);
}

.user-edit-content {
  background: var(--vscode-editor-background);
  border-radius: var(--radius-sm, 2px);
  overflow: hidden;
}

.user-edit-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-sm, 8px);
}

.user-edit-hunk {
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-sm, 2px);
  overflow: hidden;
}

.user-edit-hunk-title {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  padding: 4px 8px;
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-bottom: 1px solid var(--vscode-panel-border);
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.user-edit-hunk-title .badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  height: 16px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--vscode-editor-background);
  background: var(--vscode-charts-blue, #007acc);
}

.user-edit-hunk-title .range {
  font-family: var(--vscode-editor-font-family);
}

.user-edit-code {
  margin: 0;
  padding: 6px 8px;
  font-family: var(--vscode-editor-font-family);
  font-size: 11px;
  line-height: 1.5;
  color: var(--vscode-foreground);
  white-space: pre;
  overflow-x: auto;
}

.user-edit-code.old {
  background: rgba(255, 82, 82, 0.08);
  border-bottom: 1px solid var(--vscode-panel-border);
}

.user-edit-code.new {
  background: rgba(0, 200, 83, 0.08);
}

/* 操作页脚 */
.action-footer {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
  margin-top: var(--spacing-xs, 4px);
  padding: var(--spacing-sm, 8px);
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-radius: var(--radius-sm, 2px);
  border: 1px solid var(--vscode-panel-border);
}

.footer-top {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
}

.timer-container {
  flex: 1;
  position: relative;
  height: 4px;
  background: rgba(128, 128, 128, 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.timer-bar {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: var(--vscode-charts-blue);
  transition: width 0.05s linear;
}

.timer-text {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  min-width: 24px;
  text-align: right;
}

.footer-buttons {
  display: flex;
  gap: var(--spacing-sm, 8px);
  justify-content: flex-end;
}

.footer-buttons button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 2px;
  border: none;
  transition: opacity 0.12s ease;
}

.footer-buttons .confirm-btn {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.footer-buttons .confirm-btn:hover {
  background: var(--vscode-button-hoverBackground);
}

.footer-buttons .reject-btn {
  background: transparent;
  color: var(--vscode-foreground);
  border: 1px solid var(--vscode-panel-border);
}

.footer-buttons .reject-btn:hover {
  background: var(--vscode-toolbar-hoverBackground);
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

/* Diff 列表 */
.diff-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
}

/* 单个 Diff 块 */
.diff-block {
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-sm, 2px);
  overflow: hidden;
  transition: border-color var(--transition-fast, 0.1s);
}

.diff-block.is-failed {
  border-color: var(--vscode-errorForeground);
  opacity: 0.8;
}

/* Diff 头部 */
.diff-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-bottom: 1px solid var(--vscode-panel-border);
}

.diff-header.is-failed {
  background: rgba(255, 82, 82, 0.05);
}

.diff-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
}

.status-icon {
  display: flex;
  align-items: center;
  gap: 4px;
}

.status-icon.success {
  color: var(--vscode-testing-iconPassed);
}

.status-icon.error {
  color: var(--vscode-testing-iconFailed);
}

.error-msg {
  font-size: 10px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-number {
  font-size: 11px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.start-line {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
}

.diff-stats {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
}

.diff-stats .stat {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
}

.diff-stats .stat.deleted {
  color: var(--vscode-gitDecoration-deletedResourceForeground, #f85149);
}

.diff-stats .stat.added {
  color: var(--vscode-gitDecoration-addedResourceForeground, #3fb950);
}

.diff-actions {
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

/* Diff 内容 */
.diff-content {
  display: flex;
  flex-direction: column;
  background: var(--vscode-editor-background);
}

.diff-content-failed {
  padding: var(--spacing-sm, 8px);
  background: var(--vscode-editor-background);
  font-size: 11px;
}

.failed-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.failed-label {
  color: var(--vscode-descriptionForeground);
  font-weight: 600;
  font-size: 10px;
}

.failed-code {
  margin: 0;
  padding: var(--spacing-xs, 4px);
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-radius: var(--radius-sm, 2px);
  font-family: var(--vscode-editor-font-family);
  white-space: pre;
}

.failed-code.search {
  border-left: 2px solid var(--vscode-testing-iconFailed);
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
  background: var(--vscode-editorLineNumber-foreground);
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