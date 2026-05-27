<script setup lang="ts">
/**
 * history_search 工具的内容面板
 *
 * 显示被上下文总结压缩的历史对话内容，支持两种模式：
 * - search: 显示搜索结果（匹配行 + 上下文）
 * - read:   显示指定行号范围的内容
 *
 * 后端为了让模型继续拿到稳定、可复制的虚拟文档文本，仍然返回 data:string。
 * 本组件在前端把该文本解析成结构化行块，目的在于避免 UI 退化成一整个大 <pre>，
 * 并让 history_search 的视觉层级与 search_in_files、read_file 等工具面板保持一致。
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

interface HistoryResultLine {
  lineNumber: number
  content: string
  isMatch: boolean
  raw: string
}

interface HistoryResultBlock {
  id: string
  index: number
  startLine: number
  endLine: number
  hasMatch: boolean
  lines: HistoryResultLine[]
}

interface ParsedHistoryResult {
  summaryLines: string[]
  footerLines: string[]
  blocks: HistoryResultBlock[]
  lineCount: number
  matchCount: number
  isStructured: boolean
}

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

// 获取结果文本；保留后端 data:string 契约，避免影响模型侧历史读取语义。
const resultText = computed(() => {
  if (!props.result) return ''
  const data = (props.result as any)?.data
  if (typeof data === 'string') return data
  return ''
})

const rawResultLines = computed(() => resultText.value ? resultText.value.split('\n') : [])

const previewLineCount = 40

/**
 * 将 history_search 的虚拟文档文本解析为可渲染的行块。
 * 为什么这样做：后端返回纯文本是给模型看的稳定契约，前端直接渲染纯文本会变成大块输出。
 * 怎么做：识别 “> 12 | 内容” / “12 | 内容” 行号格式，把相邻行合并为片段，并保留摘要与尾注。
 * 目的：在不改后端协议的前提下，获得与其它工具一致的卡片、行号、匹配高亮和展开体验。
 */
function parseHistoryResult(text: string): ParsedHistoryResult {
  const summaryLines: string[] = []
  const footerLines: string[] = []
  const blocks: HistoryResultBlock[] = []
  const lines = text.split('\n')
  const numberedLinePattern = /^(>?)[\t ]*(\d+)\s\|\s?(.*)$/
  const separatorPattern = /^[\t ]*\.\.\.[\t ]*$/
  let currentLines: HistoryResultLine[] = []
  let hasSeenNumberedLine = false

  function closeCurrentBlock() {
    if (currentLines.length === 0) return
    const index = blocks.length + 1
    const start = currentLines[0].lineNumber
    const end = currentLines[currentLines.length - 1].lineNumber
    blocks.push({
      id: `history-block-${index}-${start}-${end}`,
      index,
      startLine: start,
      endLine: end,
      hasMatch: currentLines.some(line => line.isMatch),
      lines: currentLines
    })
    currentLines = []
  }

  for (const rawLine of lines) {
    const numberedMatch = rawLine.match(numberedLinePattern)

    if (numberedMatch) {
      hasSeenNumberedLine = true
      currentLines.push({
        lineNumber: Number(numberedMatch[2]),
        content: numberedMatch[3] ?? '',
        isMatch: numberedMatch[1] === '>',
        raw: rawLine
      })
      continue
    }

    if (separatorPattern.test(rawLine)) {
      closeCurrentBlock()
      continue
    }

    if (!hasSeenNumberedLine) {
      if (rawLine.trim()) summaryLines.push(rawLine)
      continue
    }

    closeCurrentBlock()
    if (rawLine.trim()) footerLines.push(rawLine)
  }

  closeCurrentBlock()

  const lineCount = blocks.reduce((count, block) => count + block.lines.length, 0)
  const matchCount = blocks.reduce(
    (count, block) => count + block.lines.filter(line => line.isMatch).length,
    0
  )

  return {
    summaryLines,
    footerLines,
    blocks,
    lineCount,
    matchCount,
    isStructured: blocks.length > 0
  }
}

const parsedResult = computed(() => parseHistoryResult(resultText.value))

const headerStats = computed(() => {
  if (!resultText.value) return []

  if (!parsedResult.value.isStructured) {
    return [t('components.tools.history.panel.lineCount', { count: rawResultLines.value.length })]
  }

  const stats: string[] = []
  if (mode.value === 'search') {
    stats.push(t('components.tools.history.panel.matchLineCount', { count: parsedResult.value.matchCount }))
  }
  stats.push(t('components.tools.history.panel.lineCount', { count: parsedResult.value.lineCount }))
  if (parsedResult.value.blocks.length > 1) {
    stats.push(t('components.tools.history.panel.blockCount', { count: parsedResult.value.blocks.length }))
  }
  return stats
})

const displayBlocks = computed(() => {
  if (expanded.value || parsedResult.value.lineCount <= previewLineCount) {
    return parsedResult.value.blocks
  }

  let remaining = previewLineCount
  const visibleBlocks: HistoryResultBlock[] = []

  for (const block of parsedResult.value.blocks) {
    if (remaining <= 0) break
    const visibleLines = block.lines.slice(0, remaining)
    visibleBlocks.push({
      ...block,
      endLine: visibleLines[visibleLines.length - 1]?.lineNumber ?? block.endLine,
      hasMatch: visibleLines.some(line => line.isMatch),
      lines: visibleLines
    })
    remaining -= visibleLines.length
  }

  return visibleBlocks
})

const needsExpand = computed(() => {
  if (parsedResult.value.isStructured) {
    return parsedResult.value.lineCount > previewLineCount
  }
  return rawResultLines.value.length > previewLineCount
})

const remainingLineCount = computed(() => {
  if (parsedResult.value.isStructured) {
    return Math.max(0, parsedResult.value.lineCount - previewLineCount)
  }
  return Math.max(0, rawResultLines.value.length - previewLineCount)
})

const rawDisplayContent = computed(() => {
  if (expanded.value || rawResultLines.value.length <= previewLineCount) {
    return resultText.value
  }
  return rawResultLines.value.slice(0, previewLineCount).join('\n')
})

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function splitKeywordQuery(value: string): string[] {
  // 前端高亮必须复用后端的多关键词兜底语义。
  // 为什么这里也要切词：后端在完整短语无结果时会按空格分隔关键词命中行，若前端仍只高亮完整短语，用户会看到“命中了但没有高亮”。
  // 怎么做：仅在非正则模式下按空白切词并去重。目的：保持 history_search 结果展示与实际搜索语义一致。
  return Array.from(new Set(value.trim().split(/\s+/).filter(Boolean)))
}

function buildHighlightPatterns(content: string): RegExp[] {
  if (mode.value !== 'search' || !query.value) return []

  try {
    if (isRegex.value) {
      return [new RegExp(query.value, 'gi')]
    }

    const exactPattern = new RegExp(escapeRegex(query.value), 'gi')
    exactPattern.lastIndex = 0
    if (exactPattern.test(content)) {
      return [new RegExp(escapeRegex(query.value), 'gi')]
    }

    const keywordTerms = splitKeywordQuery(query.value)
    if (keywordTerms.length > 1) {
      return keywordTerms.map(term => new RegExp(escapeRegex(term), 'gi'))
    }

    return [new RegExp(escapeRegex(query.value), 'gi')]
  } catch {
    return []
  }
}

/**
 * 高亮匹配文本。
 * 为什么单独实现：结构化行渲染不再使用整段 <pre>，需要在每一行中保留安全转义与匹配高亮。
 * 怎么做：先按原始字符串定位匹配，再分别 HTML 转义普通片段与 mark 片段；非正则多词查询和后端一样支持完整短语优先、关键词兜底。
 * 目的：既避免注入风险，也让 history_search 的匹配表现接近 search_in_files。
 */
function highlightLineContent(content: string): string {
  const patterns = buildHighlightPatterns(content)
  if (patterns.length === 0) {
    return escapeHtml(content || ' ')
  }

  const ranges: Array<{ start: number; end: number }> = []
  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(content)) !== null) {
      if (match[0] === '') {
        return escapeHtml(content || ' ')
      }
      ranges.push({ start: match.index, end: match.index + match[0].length })
    }
  }

  if (ranges.length === 0) {
    return escapeHtml(content || ' ')
  }

  const mergedRanges = ranges
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .reduce<Array<{ start: number; end: number }>>((merged, range) => {
      const last = merged[merged.length - 1]
      if (!last || range.start > last.end) {
        merged.push({ ...range })
      } else {
        last.end = Math.max(last.end, range.end)
      }
      return merged
    }, [])

  let cursor = 0
  let output = ''
  for (const range of mergedRanges) {
    output += escapeHtml(content.slice(cursor, range.start))
    output += `<mark>${escapeHtml(content.slice(range.start, range.end))}</mark>`
    cursor = range.end
  }

  output += escapeHtml(content.slice(cursor))
  return output || ' '
}

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
    <!-- 头部统计：本次修复把历史结果作为结构化面板展示，避免退回默认大块文本输出。 -->
    <div class="panel-header">
      <div class="header-info">
        <span :class="['codicon', modeIcon, 'mode-icon']"></span>
        <span class="title">{{ modeTitle }}</span>
        <span v-if="isRegex && mode === 'search'" class="regex-badge">{{ t('components.tools.history.panel.regex') }}</span>
      </div>
      <div class="header-right">
        <div v-if="headerStats.length" class="header-stats">
          <span v-for="stat in headerStats" :key="stat" class="stat">{{ stat }}</span>
        </div>
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

    <!-- 后端摘要行：保留原始工具输出中的统计描述，但以信息条呈现而不是塞进代码块。 -->
    <div v-if="parsedResult.summaryLines.length" class="summary-info">
      <span class="codicon codicon-info summary-icon"></span>
      <div class="summary-lines">
        <div v-for="(line, index) in parsedResult.summaryLines" :key="`summary-${index}`" class="summary-line">
          {{ line }}
        </div>
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

    <!-- 结构化结果：按片段和行号渲染，替代历史上的整段 pre 输出。 -->
    <div v-else-if="parsedResult.isStructured" class="history-results">
      <CustomScrollbar :max-height="expanded ? 420 : 300" :horizontal="true">
        <div class="history-blocks">
          <div
            v-for="block in displayBlocks"
            :key="block.id"
            class="history-block"
          >
            <div class="block-header">
              <div class="block-info">
                <span class="codicon codicon-list-tree block-icon"></span>
                <span class="block-title">{{ t('components.tools.history.panel.contextBlock', { index: block.index }) }}</span>
                <span class="block-range">L{{ block.startLine }}-L{{ block.endLine }}</span>
              </div>
              <span v-if="block.hasMatch" class="block-match-badge">
                {{ t('components.tools.history.panel.match') }}
              </span>
            </div>

            <div class="history-lines">
              <div
                v-for="line in block.lines"
                :key="`${block.id}-${line.lineNumber}`"
                :class="['history-line', { 'is-match': line.isMatch }]"
              >
                <span class="line-number">{{ line.lineNumber }}</span>
                <span class="line-marker">{{ line.isMatch ? '›' : '' }}</span>
                <code class="line-content" v-html="highlightLineContent(line.content)"></code>
              </div>
            </div>
          </div>
        </div>
      </CustomScrollbar>

      <div v-if="parsedResult.footerLines.length" class="footer-info">
        <div v-for="(line, index) in parsedResult.footerLines" :key="`footer-${index}`" class="footer-line">
          {{ line }}
        </div>
      </div>

      <!-- 展开/收起按钮 -->
      <div v-if="needsExpand" class="expand-section">
        <button class="expand-btn" @click="toggleExpand">
          <span :class="['codicon', expanded ? 'codicon-chevron-up' : 'codicon-chevron-down']"></span>
          {{ expanded
            ? t('components.tools.history.panel.collapse')
            : t('components.tools.history.panel.expandRemaining', { count: remainingLineCount })
          }}
        </button>
      </div>
    </div>

    <!-- 兼容兜底：无法识别行号格式时仍提供紧凑预览，但不再让面板无边界膨胀。 -->
    <div v-else class="raw-result-content">
      <CustomScrollbar :horizontal="true" :max-height="expanded ? 420 : 240">
        <pre class="content-code"><code>{{ rawDisplayContent }}</code></pre>
      </CustomScrollbar>

      <div v-if="needsExpand" class="expand-section">
        <button class="expand-btn" @click="toggleExpand">
          <span :class="['codicon', expanded ? 'codicon-chevron-up' : 'codicon-chevron-down']"></span>
          {{ expanded
            ? t('components.tools.history.panel.collapse')
            : t('components.tools.history.panel.expandRemaining', { count: remainingLineCount })
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
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-xs, 4px) 0;
}

.header-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  min-width: 0;
}

.mode-icon {
  color: var(--vscode-charts-purple);
  font-size: 14px;
  flex-shrink: 0;
}

.title {
  font-weight: 600;
  font-size: 12px;
  color: var(--vscode-foreground);
  white-space: nowrap;
}

.regex-badge,
.block-match-badge {
  font-size: 9px;
  padding: 1px 4px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: 2px;
  white-space: nowrap;
}

.header-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  min-width: 0;
}

.header-stats {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  min-width: 0;
}

.stat {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
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
  flex-shrink: 0;
}

.action-btn:hover {
  background: var(--vscode-toolbar-hoverBackground);
  color: var(--vscode-foreground);
}

.action-btn.copied {
  color: var(--vscode-testing-iconPassed);
}

/* 搜索信息 */
.search-info,
.summary-info {
  display: flex;
  gap: var(--spacing-xs, 4px);
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-radius: var(--radius-sm, 2px);
}

.search-info {
  flex-direction: column;
}

.summary-info {
  align-items: flex-start;
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

.summary-icon {
  color: var(--vscode-charts-purple);
  font-size: 12px;
  margin-top: 1px;
  flex-shrink: 0;
}

.summary-lines {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.summary-line,
.footer-line {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.4;
  word-break: break-word;
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

/* 结构化结果 */
.history-results,
.raw-result-content {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-sm, 2px);
  overflow: hidden;
  background: var(--vscode-editor-background);
}

.history-blocks {
  display: flex;
  flex-direction: column;
  min-width: 100%;
}

.history-block {
  border-bottom: 1px solid var(--vscode-panel-border);
}

.history-block:last-child {
  border-bottom: none;
}

.block-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-bottom: 1px solid var(--vscode-panel-border);
}

.block-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  min-width: 0;
}

.block-icon {
  color: var(--vscode-charts-purple);
  font-size: 12px;
  flex-shrink: 0;
}

.block-title {
  font-size: 11px;
  font-weight: 500;
  color: var(--vscode-foreground);
  white-space: nowrap;
}

.block-range {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  font-family: var(--vscode-editor-font-family);
  white-space: nowrap;
}

.history-lines {
  display: flex;
  flex-direction: column;
  font-family: var(--vscode-editor-font-family);
  font-size: 11px;
  line-height: 1.5;
}

.history-line {
  display: flex;
  align-items: flex-start;
  min-height: 1.5em;
  border-bottom: 1px solid rgba(128, 128, 128, 0.08);
}

.history-line:last-child {
  border-bottom: none;
}

.history-line.is-match {
  background: rgba(230, 149, 0, 0.14);
}

.line-number {
  min-width: 40px;
  padding: 0 var(--spacing-xs, 4px);
  color: var(--vscode-editorLineNumber-foreground);
  background: rgba(128, 128, 128, 0.1);
  border-right: 1px solid var(--vscode-panel-border);
  text-align: right;
  flex-shrink: 0;
  user-select: text;
}

.history-line.is-match .line-number {
  color: var(--vscode-charts-orange);
}

.line-marker {
  width: 16px;
  padding: 0 2px;
  color: var(--vscode-charts-orange);
  font-weight: 700;
  text-align: center;
  flex-shrink: 0;
}

.line-content {
  flex: 1;
  min-width: 0;
  padding: 0 var(--spacing-sm, 8px);
  color: var(--vscode-foreground);
  font-family: var(--vscode-editor-font-family);
  white-space: pre-wrap;
  word-break: break-word;
}

.line-content :deep(mark),
.line-content mark {
  background: var(--vscode-editor-findMatchHighlightBackground);
  color: inherit;
  padding: 0 2px;
  border-radius: 2px;
}

.footer-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-top: 1px solid var(--vscode-panel-border);
}

.content-code {
  margin: 0;
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  font-size: 11px;
  font-family: var(--vscode-editor-font-family);
  color: var(--vscode-foreground);
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
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
