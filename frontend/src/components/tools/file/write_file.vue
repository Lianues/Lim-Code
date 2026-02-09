<script setup lang="ts">
/**
 * write_file 工具的内容面板
 *
 * 支持批量写入，每个文件一个小面板显示
 * 显示：
 * - 文件名（标题）
 * - 文件路径（副标题）
 * - 写入的内容（带行号）或 diff 对比视图
 */

import { computed, ref, onBeforeUnmount, watch, onMounted } from 'vue'
import CustomScrollbar from '../../common/CustomScrollbar.vue'
import { MarkdownRenderer } from '../../common'
import ChannelSelector from '../../input/ChannelSelector.vue'
import ModelSelector from '../../input/ModelSelector.vue'
import type { ChannelOption, ModelInfo } from '../../input/types'
import { useI18n } from '@/composables'
import { loadDiffContent as loadDiffContentFromBackend } from '@/utils/vscode'
import { extractPreviewText, isPlanDocPath } from '../../../utils/taskCards'
import { generateId } from '@/utils/format'
import { useChatStore } from '@/stores'
import * as configService from '@/services/config'

const props = defineProps<{
  args: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
}>()

const { t } = useI18n()
const chatStore = useChatStore()

// ============ Plan 执行相关 ============
const channelConfigs = ref<any[]>([])
const selectedChannelId = ref('')
const selectedModelId = ref('')
const modelOptions = ref<ModelInfo[]>([])
const isLoadingChannels = ref(false)
const isLoadingModels = ref(false)
const expandedPlanFiles = ref<Set<string>>(new Set())
const isExecutingPlan = ref(false)

const channelOptions = computed<ChannelOption[]>(() =>
  channelConfigs.value
    .filter(config => config.enabled !== false)
    .map(config => ({
      id: config.id,
      name: config.name,
      model: config.model || config.id,
      type: config.type
    }))
)

async function loadChannels() {
  isLoadingChannels.value = true
  try {
    const ids = await configService.listConfigIds()
    const loaded: any[] = []
    for (const id of ids) {
      const config = await configService.getConfig(id)
      if (config) loaded.push(config)
    }
    channelConfigs.value = loaded
    // 默认选择当前渠道
    if (chatStore.configId && !selectedChannelId.value) {
      selectedChannelId.value = chatStore.configId
    } else if (loaded.length > 0 && !selectedChannelId.value) {
      selectedChannelId.value = loaded[0].id
    }
  } catch (error) {
    console.error(t('components.message.tool.planCard.loadChannelsFailed'), error)
  } finally {
    isLoadingChannels.value = false
  }
}

function getSelectedChannelConfig() {
  return channelConfigs.value.find(c => c.id === selectedChannelId.value)
}

async function loadModelsForChannel(configId: string) {
  if (!configId) {
    modelOptions.value = []
    selectedModelId.value = ''
    return
  }

  isLoadingModels.value = true
  try {
    const cfg = channelConfigs.value.find(c => c.id === configId)
    const localModels = Array.isArray((cfg as any)?.models) ? ((cfg as any).models as ModelInfo[]) : []
    let models = localModels.length > 0 ? localModels : await configService.getChannelModels(configId)

    const current = (cfg?.model || '').trim()
    if (current && !models.some(m => m.id === current)) {
      models = [{ id: current, name: current }, ...models]
    }

    modelOptions.value = models
    if (!selectedModelId.value) {
      selectedModelId.value = current || models[0]?.id || ''
    }
  } catch (error) {
    console.error(t('components.message.tool.planCard.loadModelsFailed'), error)
    const current = (getSelectedChannelConfig()?.model || '').trim()
    modelOptions.value = current ? [{ id: current, name: current }] : []
    if (!selectedModelId.value) selectedModelId.value = current
  } finally {
    isLoadingModels.value = false
  }
}

function togglePlanExpand(path: string) {
  if (expandedPlanFiles.value.has(path)) {
    expandedPlanFiles.value.delete(path)
  } else {
    expandedPlanFiles.value.add(path)
  }
}

function isPlanExpanded(path: string): boolean {
  return expandedPlanFiles.value.has(path)
}

function getPlanTitle(planContent: string, planPath?: string): string {
  const m = (planContent || '').match(/^\s*#\s+(.+)\s*$/m)
  if (m && m[1] && m[1].trim()) return m[1].trim()

  if (planPath) {
    const parts = planPath.replace(/\\/g, '/').split('/')
    const file = parts[parts.length - 1] || planPath
    return file.replace(/\.md$/i, '') || t('components.message.tool.planCard.title')
  }

  return t('components.message.tool.planCard.title')
}

async function executePlan(planContent: string, planPath?: string) {
  if (isExecutingPlan.value || !planContent.trim()) return
  isExecutingPlan.value = true
  
  try {
    // 临时切换到选定的渠道
    const originalConfigId = chatStore.configId
    if (selectedChannelId.value && selectedChannelId.value !== originalConfigId) {
      chatStore.setConfigId(selectedChannelId.value)
    }
    
    // 启动 Build 顶部卡片（Cursor-like）
    await chatStore.setActiveBuild({
      id: generateId(),
      conversationId: chatStore.currentConversationId || '',
      title: getPlanTitle(planContent, planPath),
      planContent,
      planPath,
      channelId: selectedChannelId.value || undefined,
      modelId: selectedModelId.value || undefined,
      startedAt: Date.now(),
      status: 'running'
    })

    // 发送 Plan 内容作为新消息
    const prompt = t('components.message.tool.planCard.promptPrefix', { plan: planContent })
    await chatStore.sendMessage(prompt, undefined, {
      modelOverride: selectedModelId.value || undefined
    })
  } catch (error) {
    console.error(t('components.message.tool.planCard.executePlanFailed'), error)
  } finally {
    isExecutingPlan.value = false
  }
}

onMounted(() => {
  loadChannels()
})

watch(
  () => selectedChannelId.value,
  async (id) => {
    const cfg = channelConfigs.value.find(c => c.id === id)
    selectedModelId.value = (cfg?.model || '').trim()
    await loadModelsForChannel(id)
  }
)

// 每个文件的展开状态
const expandedFiles = ref<Set<string>>(new Set())

// 复制状态（按文件路径）
const copiedFiles = ref<Set<string>>(new Set())
const copyTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

// 单个文件写入配置
interface WriteFileEntry {
  path: string
  content: string
}

// 单个文件写入结果
interface WriteResult {
  path: string
  success: boolean
  action?: 'created' | 'modified' | 'unchanged'
  status?: string
  error?: string
  diffContentId?: string
}

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

// 显示模式：'content' | 'diff'
const viewModes = ref<Map<string, 'content' | 'diff'>>(new Map())

// 获取文件列表（从参数中）
const fileList = computed((): WriteFileEntry[] => {
  const files = props.args.files as WriteFileEntry[] | undefined
  return files && Array.isArray(files) ? files : []
})

// 获取写入结果列表（从结果中）
const writeResults = computed((): WriteResult[] => {
  const result = props.result as Record<string, any> | undefined
  
  // 批量结果
  if (result?.data?.results) {
    return result.data.results as WriteResult[]
  }
  
  // 如果没有结果，为每个文件创建空结果
  return fileList.value.map(f => ({
    path: f.path,
    success: !props.error,
    lineCount: f.content?.split('\n').length,
    error: props.error
  }))
})

// 合并文件列表和结果，方便显示
interface MergedFile {
  path: string
  content: string
  result: WriteResult | undefined
}

const mergedFiles = computed((): MergedFile[] => {
  return fileList.value.map(entry => {
    const result = writeResults.value.find(r => r.path === entry.path)
    return {
      path: entry.path,
      content: entry.content,
      result
    }
  })
})

// 计划文档预览（.limcode/plans/**/*.md）
const planFiles = computed((): MergedFile[] => mergedFiles.value.filter(f => isPlanDocPath(f.path)))

function getPlanCardStatus(file: MergedFile): 'pending' | 'running' | 'success' | 'error' {
  // 还没收到 tool result：视为 running
  if (!props.result) return 'running'
  if (file.result && file.result.success === false) return 'error'
  if (props.error) return 'error'
  return 'success'
}

// 监听结果变化，自动加载 diff 内容
watch(writeResults, async (results) => {
  for (const result of results) {
    if (result.diffContentId && !diffContents.value.has(result.path) && !loadingDiffs.value.has(result.path)) {
      await loadDiffContent(result.path, result.diffContentId)
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
function getViewMode(path: string): 'content' | 'diff' {
  return viewModes.value.get(path) || 'content'
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

// 总文件数统计
const successCount = computed(() => {
  const result = props.result as Record<string, any> | undefined
  if (result?.data?.successCount !== undefined) {
    return result.data.successCount as number
  }
  return writeResults.value.filter(r => r.success).length
})

const failCount = computed(() => {
  const result = props.result as Record<string, any> | undefined
  if (result?.data?.failCount !== undefined) {
    return result.data.failCount as number
  }
  return writeResults.value.filter(r => !r.success).length
})

// 预览行数
const previewLineCount = 15

// 获取文件名
function getFileName(filePath: string): string {
  const parts = filePath.split(/[/\\]/)
  return parts[parts.length - 1] || filePath
}

// 获取文件扩展名（不含点号）
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

// 获取内容行数组
function getContentLines(content: string | undefined): string[] {
  return content ? content.split('\n') : []
}

// 获取显示的内容（带行号）
function getDisplayContent(file: MergedFile): string {
  if (!file.content) return ''
  const lines = getContentLines(file.content)
  const maxLineNum = lines.length
  const padWidth = String(maxLineNum).length
  
  const displayLines = isFileExpanded(file.path) || lines.length <= previewLineCount
    ? lines
    : lines.slice(0, previewLineCount)
  
  return displayLines.map((line, index) =>
    `${String(index + 1).padStart(padWidth)} | ${line}`
  ).join('\n')
}

// 检查是否需要展开按钮
function needsExpand(file: MergedFile): boolean {
  const lines = getContentLines(file.content)
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
async function copyFileContent(file: MergedFile) {
  if (!file.content) return
  
  try {
    await navigator.clipboard.writeText(file.content)
    
    // 显示对钩状态
    copiedFiles.value.add(file.path)
    
    // 清除之前的定时器
    const existingTimeout = copyTimeouts.get(file.path)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }
    
    // 1秒后恢复
    const timeout = setTimeout(() => {
      copiedFiles.value.delete(file.path)
      copyTimeouts.delete(file.path)
    }, 1000)
    copyTimeouts.set(file.path, timeout)
  } catch (err) {
    console.error('复制失败:', err)
  }
}

// 获取操作图标
function getActionIcon(action?: string): string {
  switch (action) {
    case 'created':
      return 'codicon-new-file'
    case 'modified':
      return 'codicon-edit'
    case 'unchanged':
      return 'codicon-file'
    default:
      return 'codicon-save'
  }
}

// 获取操作标签
function getActionLabel(action?: string): string {
  switch (action) {
    case 'created':
      return t('components.tools.file.writeFilePanel.actions.created')
    case 'modified':
      return t('components.tools.file.writeFilePanel.actions.modified')
    case 'unchanged':
      return t('components.tools.file.writeFilePanel.actions.unchanged')
    default:
      return t('components.tools.file.writeFilePanel.actions.write')
  }
}

// ============ Diff 对比相关 ============

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

// 检查 diff 是否需要展开
function needsDiffExpand(diffLines: DiffLine[]): boolean {
  return diffLines.length > previewDiffLineCount
}

// 获取显示的 diff 行
function getDisplayDiffLines(diffLines: DiffLine[], path: string): DiffLine[] {
  if (expandedFiles.value.has(path + '_diff') || diffLines.length <= previewDiffLineCount) {
    return diffLines
  }
  return diffLines.slice(0, previewDiffLineCount)
}

// 切换 diff 展开状态
function toggleDiffExpand(path: string) {
  const key = path + '_diff'
  if (expandedFiles.value.has(key)) {
    expandedFiles.value.delete(key)
  } else {
    expandedFiles.value.add(key)
  }
}

// 检查 diff 是否已展开
function isDiffExpanded(path: string): boolean {
  return expandedFiles.value.has(path + '_diff')
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
  <div class="write-file-panel">
    <!-- 总体统计头部 -->
    <div class="panel-header">
      <div class="header-info">
        <span class="codicon codicon-save files-icon"></span>
        <span class="title">{{ t('components.tools.file.writeFilePanel.title') }}</span>
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
        <span class="stat total">{{ t('components.tools.file.writeFilePanel.total', { count: mergedFiles.length }) }}</span>
      </div>
    </div>

    <!-- Plan 预览面板（仅当写入 .limcode/plans/**.md 时展示） -->
    <div v-if="planFiles.length > 0" class="plan-preview-section">
      <div v-for="file in planFiles" :key="file.path" class="plan-panel">
        <!-- Plan 头部 -->
        <div class="plan-header">
          <div class="plan-info">
            <span class="codicon codicon-list-unordered plan-icon"></span>
            <span class="plan-title">Plan</span>
            <span v-if="getPlanCardStatus(file) === 'success'" class="plan-status success">
              <span class="codicon codicon-check"></span>
            </span>
            <span v-else-if="getPlanCardStatus(file) === 'running'" class="plan-status running">
              <span class="codicon codicon-loading codicon-modifier-spin"></span>
            </span>
            <span v-else-if="getPlanCardStatus(file) === 'error'" class="plan-status error">
              <span class="codicon codicon-error"></span>
            </span>
          </div>
          <div class="plan-actions">
            <button
              class="action-btn"
              :title="isPlanExpanded(file.path) ? t('common.collapse') : t('common.expand')"
              @click="togglePlanExpand(file.path)"
            >
              <span :class="['codicon', isPlanExpanded(file.path) ? 'codicon-chevron-up' : 'codicon-chevron-down']"></span>
            </button>
          </div>
        </div>
        
        <!-- Plan 路径 -->
        <div class="plan-path">{{ file.path }}</div>
        
        <!-- Plan 预览内容 -->
        <div class="plan-content">
          <CustomScrollbar :max-height="isPlanExpanded(file.path) ? 500 : 200">
            <div class="plan-preview">
              <MarkdownRenderer :content="isPlanExpanded(file.path) ? file.content : extractPreviewText(file.content, { maxLines: 12, maxChars: 1600 })" />
            </div>
          </CustomScrollbar>
        </div>
        
        <!-- Plan 执行区域 -->
        <div class="plan-execute">
          <div class="execute-selector">
            <span class="execute-label">{{ t('components.message.tool.planCard.executeLabel') }}</span>
            <ChannelSelector
              v-model="selectedChannelId"
              :options="channelOptions"
              :disabled="isLoadingChannels || isExecutingPlan"
              class="channel-select"
            />
            <ModelSelector
              v-model="selectedModelId"
              :models="modelOptions"
              :disabled="isLoadingChannels || isLoadingModels || isExecutingPlan || !selectedChannelId"
              class="model-select"
            />
          </div>
          <button
            class="execute-btn"
            :disabled="isExecutingPlan || !selectedChannelId || !selectedModelId"
            @click="executePlan(file.content, file.path)"
          >
            <span v-if="isExecutingPlan" class="codicon codicon-loading codicon-modifier-spin"></span>
            <span v-else class="codicon codicon-play"></span>
            <span class="btn-text">{{ isExecutingPlan ? t('components.message.tool.planCard.executing') : t('components.message.tool.planCard.executePlan') }}</span>
          </button>
        </div>
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
            <span :class="[
              'file-icon',
              'codicon',
              file.result?.success === false ? 'codicon-error' : getActionIcon(file.result?.action)
            ]"></span>
            <span class="file-name">{{ getFileNameWithoutExt(file.path) }}</span>
            <span v-if="getFileExtension(file.path)" class="file-ext">.{{ getFileExtension(file.path) }}</span>
            <span v-if="file.result?.action" :class="['action-badge', file.result.action]">
              {{ getActionLabel(file.result.action) }}
            </span>
            <span v-if="getContentLines(file.content).length" class="line-count">
              {{ t('components.tools.file.writeFilePanel.lines', { count: getContentLines(file.content).length }) }}
            </span>
          </div>
          <div class="file-actions">
            <button
              v-if="file.content"
              class="action-btn"
              :class="{ 'copied': isCopied(file.path) }"
              :title="isCopied(file.path) ? t('components.tools.file.writeFilePanel.copied') : t('components.tools.file.writeFilePanel.copyContent')"
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
        
        <!-- 视图切换按钮 -->
        <div v-if="hasDiffContent(file.path)" class="view-toggle">
          <button
            :class="['toggle-btn', { active: getViewMode(file.path) === 'content' }]"
            @click="viewModes.set(file.path, 'content')"
          >
            <span class="codicon codicon-file-code"></span>
            {{ t('components.tools.file.writeFilePanel.viewContent') }}
          </button>
          <button
            :class="['toggle-btn', { active: getViewMode(file.path) === 'diff' }]"
            @click="viewModes.set(file.path, 'diff')"
          >
            <span class="codicon codicon-diff"></span>
            {{ t('components.tools.file.writeFilePanel.viewDiff') }}
          </button>
        </div>
        
        <!-- 加载中 -->
        <div v-if="isLoadingDiff(file.path)" class="loading-diff">
          <span class="codicon codicon-loading codicon-modifier-spin"></span>
          {{ t('components.tools.file.writeFilePanel.loadingDiff') }}
        </div>
        
        <!-- Diff 视图 -->
        <div v-else-if="hasDiffContent(file.path) && getViewMode(file.path) === 'diff'" class="diff-view">
          <div class="diff-stats-bar">
            <span class="stat deleted">
              <span class="codicon codicon-remove"></span>
              {{ getDiffStats(computeDiffLines(getDiffContent(file.path)!.originalContent, getDiffContent(file.path)!.newContent)).deleted }}
            </span>
            <span class="stat added">
              <span class="codicon codicon-add"></span>
              {{ getDiffStats(computeDiffLines(getDiffContent(file.path)!.originalContent, getDiffContent(file.path)!.newContent)).added }}
            </span>
          </div>
          <CustomScrollbar :horizontal="true" :max-height="300">
            <div class="diff-lines">
              <div
                v-for="(line, lineIndex) in getDisplayDiffLines(computeDiffLines(getDiffContent(file.path)!.originalContent, getDiffContent(file.path)!.newContent), file.path)"
                :key="lineIndex"
                :class="['diff-line', `line-${line.type}`]"
              >
                <span class="line-nums">
                  <span class="old-num">{{ formatLineNum(line.oldLineNum, getDiffLineNumWidth(getDiffContent(file.path)!)) }}</span>
                  <span class="new-num">{{ formatLineNum(line.newLineNum, getDiffLineNumWidth(getDiffContent(file.path)!)) }}</span>
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
          <div v-if="needsDiffExpand(computeDiffLines(getDiffContent(file.path)!.originalContent, getDiffContent(file.path)!.newContent))" class="expand-section">
            <button class="expand-btn" @click="toggleDiffExpand(file.path)">
              <span :class="['codicon', isDiffExpanded(file.path) ? 'codicon-chevron-up' : 'codicon-chevron-down']"></span>
              {{ isDiffExpanded(file.path) ? t('components.tools.file.writeFilePanel.collapse') : t('components.tools.file.writeFilePanel.expandRemaining', { count: computeDiffLines(getDiffContent(file.path)!.originalContent, getDiffContent(file.path)!.newContent).length - previewDiffLineCount }) }}
            </button>
          </div>
        </div>
        
        <!-- 原内容视图 -->
        <div v-else-if="file.content" class="file-content" :class="{ 'expanded': isFileExpanded(file.path) }">
          <div class="content-wrapper">
            <CustomScrollbar :horizontal="true">
              <pre class="content-code"><code>{{ getDisplayContent(file) }}</code></pre>
            </CustomScrollbar>
          </div>
          
          <!-- 展开/收起按钮 -->
          <div v-if="needsExpand(file)" class="expand-section">
            <button class="expand-btn" @click="toggleFile(file.path)">
              <span :class="['codicon', isFileExpanded(file.path) ? 'codicon-chevron-up' : 'codicon-chevron-down']"></span>
              {{ isFileExpanded(file.path) ? t('components.tools.file.writeFilePanel.collapse') : t('components.tools.file.writeFilePanel.expandRemaining', { count: getContentLines(file.content).length - previewLineCount }) }}
            </button>
          </div>
        </div>
        
        <!-- 空文件 -->
        <div v-else class="file-empty">
          <span class="codicon codicon-file"></span>
          <span>{{ t('components.tools.file.writeFilePanel.noContent') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.write-file-panel {
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

/* Plan 预览面板 - 继承 file-panel 风格 */
.plan-preview-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
}

.plan-panel {
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-sm, 2px);
  overflow: hidden;
}

.plan-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-bottom: 1px solid var(--vscode-panel-border);
}

.plan-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  flex: 1;
  min-width: 0;
}

.plan-icon {
  font-size: 12px;
  color: var(--vscode-charts-blue, #3794ff);
  flex-shrink: 0;
}

.plan-title {
  font-size: 11px;
  font-weight: 500;
  color: var(--vscode-foreground);
}

.plan-status {
  font-size: 12px;
  margin-left: var(--spacing-xs, 4px);
}

.plan-status.success {
  color: var(--vscode-testing-iconPassed);
}

.plan-status.running {
  color: var(--vscode-charts-blue);
}

.plan-status.error {
  color: var(--vscode-testing-iconFailed);
}

.plan-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
}

.plan-path {
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

.plan-content {
  background: var(--vscode-editor-background);
}

.plan-preview {
  padding: var(--spacing-sm, 8px);
}

.plan-execute {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-top: 1px solid var(--vscode-panel-border);
}

.execute-selector {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  flex: 1;
  min-width: 0;
}

.execute-label {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
}

.channel-select {
  flex: 1;
  min-width: 120px;
  max-width: 180px;
}

.model-select {
  flex: 1;
  min-width: 120px;
  max-width: 220px;
}

.execute-btn {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  padding: 4px 10px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  border-radius: var(--radius-sm, 2px);
  font-size: 11px;
  cursor: pointer;
  transition: background-color 0.1s;
  white-space: nowrap;
}

.execute-btn:hover:not(:disabled) {
  background: var(--vscode-button-hoverBackground);
}

.execute-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-text {
  font-size: 11px;
}

/* 让 ModelSelector 在 Plan 面板里看起来像输入框（与 ChannelSelector 对齐） */
.plan-execute :deep(.model-trigger) {
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  border-radius: 4px;
  padding: 4px 8px;
}

.plan-execute :deep(.model-trigger:hover:not(:disabled)) {
  border-color: var(--vscode-focusBorder);
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
}

.plan-execute :deep(.model-selector.open .model-trigger) {
  border-color: var(--vscode-focusBorder);
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
}

.header-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
}

.files-icon {
  color: var(--vscode-charts-orange, #e69500);
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
  color: var(--vscode-charts-orange, #e69500);
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

.action-badge {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 2px;
  margin-left: var(--spacing-xs, 4px);
  font-weight: 500;
}

.action-badge.created {
  background: var(--vscode-testing-iconPassed);
  color: var(--vscode-editor-background);
}

.action-badge.modified {
  background: var(--vscode-charts-orange, #e69500);
  color: var(--vscode-editor-background);
}

.action-badge.unchanged {
  background: var(--vscode-descriptionForeground);
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
</style>