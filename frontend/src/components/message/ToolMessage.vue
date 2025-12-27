<script setup lang="ts">
/**
 * ToolMessage - 工具调用消息组件（重新设计）
 *
 * 功能：
 * 1. 显示工具名称在标题栏
 * 2. 显示描述（参数摘要）
 * 3. 可展开/收起详细内容
 * 4. 支持自定义内容面板组件
 * 5. 通过工具 ID 从 store 获取响应结果
 */

import { ref, computed, Component, h, watchEffect, onMounted, onBeforeUnmount } from 'vue'
import type { ToolUsage, Message } from '../../types'
import { getToolConfig } from '../../utils/toolRegistry'
import { ensureMcpToolRegistered } from '../../utils/tools'
import { useChatStore } from '../../stores'
import { sendToExtension, acceptDiff, rejectDiff, getPendingDiffs } from '../../utils/vscode'
import { useI18n } from '../../i18n'
import { generateId } from '../../utils/format'

const { t } = useI18n()

const props = defineProps<{
  tools: ToolUsage[]
}>()

const chatStore = useChatStore()


// 确保 MCP 工具已注册
watchEffect(() => {
  for (const tool of props.tools) {
    ensureMcpToolRegistered(tool.name)
  }
})

// 增强后的工具列表，包含从 store 获取的响应
const enhancedTools = computed<ToolUsage[]>(() => {
  return props.tools.map((tool) => {
    // 获取响应结果
    let response: Record<string, unknown> | null | undefined = tool.result
    if (!response && tool.id) {
      response = chatStore.getToolResponseById(tool.id) as Record<string, unknown> | null
    }

    // 如果工具已经有结果或响应
    if (response) {
      // 优先从响应中获取错误
      const error = tool.error || (response as any).error
      let success = (response as any).success !== false && !error
      
      // 检查是否为部分成功 (针对 apply_diff 等工具)
      let status: 'success' | 'error' | 'warning' = success ? 'success' : 'error'
      const data = (response as any).data
      if (success && data && data.appliedCount > 0 && data.failedCount > 0) {
        status = 'warning'
      }
      
      return { 
        ...tool, 
        result: response || undefined,
        error, 
        status, 
        awaitingConfirmation: false 
      }
    }
    
    // 如果正在处理确认，显示 running 状态
    if (processingToolIds.value.has(tool.id)) {
      return { ...tool, status: 'running' as const, awaitingConfirmation: false }
    }
    
    // 检查是否等待确认：后端发送 awaitingConfirmation 时会设置 status = 'pending'
    const awaitingConfirm = tool.status === 'pending'
    
    // 没有找到响应，使用当前状态
    const effectiveStatus = tool.status || 'running'
    return { ...tool, status: effectiveStatus, awaitingConfirmation: awaitingConfirm }
  })
})

// 正在处理确认的工具 ID 集合
// eslint-disable-next-line no-undef
const processingToolIds = ref<Set<string>>(new Set())

// ========== apply_diff 保存/拒绝按钮相关状态 ==========

// 轮询获取的 pending diff 映射：filePath -> diffId
const pendingDiffMap = ref<Map<string, string>>(new Map())

// 轮询定时器
let diffPollTimer: ReturnType<typeof setInterval> | null = null

// 按钮加载状态
const diffAcceptingIds = ref<Set<string>>(new Set())
const diffRejectingIds = ref<Set<string>>(new Set())

// 获取工具涉及的文件路径列表
function getToolFilePaths(tool: ToolUsage): string[] {
  if (tool.name === 'apply_diff') {
    const path = tool.args?.path as string
    return path ? [path] : []
  }
  if (tool.name === 'write_file') {
    const files = tool.args?.files as Array<{ path: string }> | undefined
    return files ? files.map(f => f.path) : []
  }
  return []
}

// 检查文件修改工具是否应该显示保存/拒绝按钮
function shouldShowDiffButtons(tool: ToolUsage): boolean {
  if (tool.name !== 'apply_diff' && tool.name !== 'write_file') return false

  const paths = getToolFilePaths(tool)
  
  // 检查是否有任何文件在 pendingDiffMap 中
  for (const path of paths) {
    if (pendingDiffMap.value.has(path)) {
      return true
    }
  }

  // 检查 result 中是否有 pending 状态
  const resultData = (tool.result as any)?.data
  if (resultData?.status === 'pending' && resultData?.pendingDiffId) {
    return true
  }
  
  // 对于 write_file，检查 results 中是否有任何 pending
  if (tool.name === 'write_file' && resultData?.results) {
    for (const r of resultData.results) {
      if (r.status === 'pending') {
        return true
      }
    }
  }

  return false
}

// 获取工具所有的 pending diff IDs
function getDiffIds(tool: ToolUsage): string[] {
  const diffIds: string[] = []
  const paths = getToolFilePaths(tool)
  
  // 从 pendingDiffMap 获取
  for (const path of paths) {
    const diffId = pendingDiffMap.value.get(path)
    if (diffId && !diffIds.includes(diffId)) {
      diffIds.push(diffId)
    }
  }
  
  // 也检查 result 中的 pendingDiffId
  const resultData = (tool.result as any)?.data
  if (resultData?.pendingDiffId && !diffIds.includes(resultData.pendingDiffId)) {
    diffIds.push(resultData.pendingDiffId)
  }

  return diffIds
}

// 保存 diff（支持多个 diff）
async function handleAcceptDiff(tool: ToolUsage) {
  const diffIds = getDiffIds(tool)
  if (diffIds.length === 0 || diffAcceptingIds.value.has(tool.id) || diffRejectingIds.value.has(tool.id)) return

  diffAcceptingIds.value.add(tool.id)
  try {
    // 获取输入框内容作为批注（仅第一个 diff 携带批注，避免重复发送）
    const annotation = chatStore.inputValue.trim()
    let isFirstDiff = true
    let fullAnnotation = ''

    // 处理所有 pending 的 diff
    for (const diffId of diffIds) {
      // 只有第一个 diff 携带批注
      const result = await acceptDiff(diffId, isFirstDiff ? annotation : undefined)

      // 保存第一个 diff 返回的完整批注（用于发送给 AI）
      if (isFirstDiff && result.hasAnnotation && result.fullAnnotation) {
        fullAnnotation = result.fullAnnotation
      }
      isFirstDiff = false
    }

    // 如果有批注，清空输入框并发送批注给 AI
    if (annotation) {
      chatStore.setInputValue('')

      // 如果后端返回了完整批注，使用 chatStore 发送给 AI
      if (fullAnnotation) {
        await chatStore.sendDiffAnnotation(fullAnnotation)
      }
    }

    // 保存成功后清除对应的 pending 状态
    const paths = getToolFilePaths(tool)
    for (const path of paths) {
      pendingDiffMap.value.delete(path)
    }
  } finally {
    diffAcceptingIds.value.delete(tool.id)
  }
}

// 拒绝 diff（支持多个 diff）
async function handleRejectDiff(tool: ToolUsage) {
  const diffIds = getDiffIds(tool)
  if (diffIds.length === 0 || diffAcceptingIds.value.has(tool.id) || diffRejectingIds.value.has(tool.id)) return

  diffRejectingIds.value.add(tool.id)
  try {
    // 获取输入框内容作为批注（仅第一个 diff 携带批注，避免重复发送）
    const annotation = chatStore.inputValue.trim()
    let isFirstDiff = true
    let fullAnnotation = ''

    // 处理所有 pending 的 diff
    for (const diffId of diffIds) {
      // 只有第一个 diff 携带批注
      const result = await rejectDiff(diffId, isFirstDiff ? annotation : undefined)

      // 保存第一个 diff 返回的完整批注（用于发送给 AI）
      if (isFirstDiff && result.hasAnnotation && result.fullAnnotation) {
        fullAnnotation = result.fullAnnotation
      }
      isFirstDiff = false
    }

    // 如果有批注，清空输入框并发送批注给 AI
    if (annotation) {
      chatStore.setInputValue('')

      // 如果后端返回了完整批注，使用 chatStore 发送给 AI
      if (fullAnnotation) {
        await chatStore.sendDiffAnnotation(fullAnnotation)
      }
    }

    // 拒绝成功后清除对应的 pending 状态
    const paths = getToolFilePaths(tool)
    for (const path of paths) {
      pendingDiffMap.value.delete(path)
    }
  } finally {
    diffRejectingIds.value.delete(tool.id)
  }
}

// 检查是否正在保存
function isDiffAccepting(toolId: string): boolean {
  return diffAcceptingIds.value.has(toolId)
}

// 检查是否正在拒绝
function isDiffRejecting(toolId: string): boolean {
  return diffRejectingIds.value.has(toolId)
}

// 开始轮询 pending diffs
async function startDiffPolling() {
  if (diffPollTimer) return

  const checkPending = async () => {
    // 检查是否有正在运行的文件修改工具
    const hasRunningFileTool = enhancedTools.value.some(
      tool => (tool.name === 'apply_diff' || tool.name === 'write_file') &&
              (tool.status === 'running' || tool.status === 'pending')
    )

    if (!hasRunningFileTool) {
      stopDiffPolling()
      return
    }

    try {
      const diffs = await getPendingDiffs()
      // 更新映射
      const newMap = new Map<string, string>()
      for (const diff of diffs) {
        newMap.set(diff.filePath, diff.id)
      }
      pendingDiffMap.value = newMap
    } catch (err) {
      console.error('Failed to poll pending diffs:', err)
    }
  }

  // 立即检查一次
  await checkPending()

  // 每 500ms 检查一次
  diffPollTimer = setInterval(checkPending, 500)
}

// 停止轮询
function stopDiffPolling() {
  if (diffPollTimer) {
    clearInterval(diffPollTimer)
    diffPollTimer = null
  }
}

// 监听工具状态变化，启动/停止轮询
watchEffect(() => {
  const hasRunningFileTool = enhancedTools.value.some(
    tool => (tool.name === 'apply_diff' || tool.name === 'write_file') &&
            (tool.status === 'running' || tool.status === 'pending')
  )

  if (hasRunningFileTool) {
    startDiffPolling()
  }
})

// 组件卸载时停止轮询
onBeforeUnmount(() => {
  stopDiffPolling()
})

// 用户决定状态：记录每个工具的用户决定（true=确认，false=拒绝，undefined=未决定）
// eslint-disable-next-line no-undef
const userDecisions = ref<Map<string, boolean>>(new Map())

// 计算等待确认的工具 ID 列表
const pendingToolIds = computed(() => {
  return enhancedTools.value
    .filter(tool => tool.awaitingConfirmation)
    .map(tool => tool.id)
})

// 计算是否所有等待确认的工具都已有用户决定
const allDecisionsMade = computed(() => {
  if (pendingToolIds.value.length === 0) return false
  return pendingToolIds.value.every(id => userDecisions.value.has(id))
})

// 确认工具执行（只更新本地状态）
function confirmToolExecution(toolId: string, _toolName: string) {
  userDecisions.value.set(toolId, true)
  // 触发响应式更新
  userDecisions.value = new Map(userDecisions.value)
  
  // 检查是否所有决定都已做出，自动提交
  if (allDecisionsMade.value) {
    submitAllDecisions()
  }
}

// 拒绝工具执行（只更新本地状态）
function rejectToolExecution(toolId: string, _toolName: string) {
  userDecisions.value.set(toolId, false)
  // 触发响应式更新
  userDecisions.value = new Map(userDecisions.value)
  
  // 检查是否所有决定都已做出，自动提交
  if (allDecisionsMade.value) {
    submitAllDecisions()
  }
}

// 获取工具的用户决定状态
function getToolDecision(toolId: string): boolean | undefined {
  return userDecisions.value.get(toolId)
}

// 检查工具是否已有用户决定
function hasUserDecision(toolId: string): boolean {
  return userDecisions.value.has(toolId)
}

// 提交所有用户决定到后端
async function submitAllDecisions() {
  const toolResponses: Array<{ id: string; name: string; confirmed: boolean }> = []

  for (const tool of enhancedTools.value) {
    if (tool.awaitingConfirmation) {
      const decision = userDecisions.value.get(tool.id)
      // 如果用户没有做出决定，默认为拒绝
      const confirmed = decision === true

      toolResponses.push({
        id: tool.id,
        name: tool.name,
        confirmed
      })

      // 标记为正在处理
      processingToolIds.value.add(tool.id)
    }
  }

  if (toolResponses.length === 0) return

  // 清空用户决定状态
  userDecisions.value.clear()

  // 发送到后端（不带批注，批注在工具执行完成后由 chatStore 发送）
  await sendToolConfirmation(toolResponses)
}

// 发送工具确认响应到后端
async function sendToolConfirmation(toolResponses: Array<{ id: string; name: string; confirmed: boolean }>, annotation?: string) {
  try {
    const currentConversationId = chatStore.currentConversationId
    const currentConfig = chatStore.currentConfig

    if (!currentConversationId || !currentConfig?.id) {
      console.error('No conversation or config ID')
      return
    }

    await sendToExtension('toolConfirmation', {
      conversationId: currentConversationId,
      configId: currentConfig.id,
      toolResponses,
      annotation
    })
  } catch (error) {
    console.error('Failed to send tool confirmation:', error)
  }
}

// 展开状态
// eslint-disable-next-line no-undef
const expandedTools = ref<Set<string>>(new Set())

// 切换展开/收起
function toggleExpand(toolId: string) {
  if (expandedTools.value.has(toolId)) {
    expandedTools.value.delete(toolId)
  } else {
    expandedTools.value.add(toolId)
  }
}

// 检查是否已展开
function isExpanded(toolId: string): boolean {
  return expandedTools.value.has(toolId)
}

// 获取工具显示名称
function getToolLabel(tool: ToolUsage): string {
  const config = getToolConfig(tool.name)
  return config?.label || tool.name
}

// 获取工具图标
function getToolIcon(tool: ToolUsage): string {
  const config = getToolConfig(tool.name)
  return config?.icon || 'codicon-tools'
}

// 获取工具描述
function getToolDescription(tool: ToolUsage): string {
  const config = getToolConfig(tool.name)
  if (config?.descriptionFormatter) {
    return config.descriptionFormatter(tool.args)
  }
  // 默认描述：显示参数数量
  const argCount = Object.keys(tool.args || {}).length
  return t('components.message.tool.paramCount', { count: argCount })
}

// 检查工具是否可展开
function isExpandable(tool: ToolUsage): boolean {
  const config = getToolConfig(tool.name)
  // 默认可展开，除非显式设置为 false
  return config?.expandable !== false
}

// 检查工具是否支持 diff 预览
function hasDiffPreview(tool: ToolUsage): boolean {
  const config = getToolConfig(tool.name)
  return config?.hasDiffPreview === true
}

// 获取 diff 预览的文件路径
function getDiffFilePaths(tool: ToolUsage): string[] {
  const config = getToolConfig(tool.name)
  if (!config?.getDiffFilePath) return []
  
  const result = config.getDiffFilePath(tool.args, tool.result as Record<string, unknown> | undefined)
  if (Array.isArray(result)) return result
  return result ? [result] : []
}

// 打开 diff 预览（在 VSCode 中）
async function openDiffPreview(tool: ToolUsage) {
  const paths = getDiffFilePaths(tool)
  if (paths.length === 0) return
  
  try {
    // 使用 JSON 序列化确保数据可克隆
    const serializedArgs = JSON.parse(JSON.stringify(tool.args || {}))
    const serializedResult = tool.result ? JSON.parse(JSON.stringify(tool.result)) : undefined
    
    await sendToExtension('diff.openPreview', {
      toolId: tool.id,
      toolName: tool.name,
      filePaths: paths,
      args: serializedArgs,
      result: serializedResult
    })
  } catch (err) {
    console.error(t('components.message.tool.openDiffFailed'), err)
  }
}

// 获取状态图标
function getStatusIcon(status?: string, awaitingConfirmation?: boolean): string {
  if (awaitingConfirmation) {
    return 'codicon-shield'
  }
  switch (status) {
    case 'pending':
      return 'codicon-clock'
    case 'running':
      return 'codicon-loading'
    case 'success':
    case 'warning':
      return 'codicon-check'
    case 'error':
      return 'codicon-error'
    default:
      return ''
  }
}

// 获取状态类名
function getStatusClass(status?: string, awaitingConfirmation?: boolean): string {
  if (awaitingConfirmation) {
    return 'status-warning'
  }
  switch (status) {
    case 'success':
      return 'status-success'
    case 'error':
      return 'status-error'
    case 'warning':
      return 'status-warning'
    case 'running':
      return 'status-running'
    case 'pending':
      return 'status-pending'
    default:
      return ''
  }
}

// 渲染工具内容
function renderToolContent(tool: ToolUsage) {
  const config = getToolConfig(tool.name)
  
  // 如果有自定义组件，使用自定义组件
  if (config?.contentComponent) {
    return h(config.contentComponent as Component, {
      args: tool.args,
      result: tool.result,
      error: tool.error,
      status: tool.status,
      toolId: tool.id
    })
  }
  
  // 如果有内容格式化器，使用格式化器
  if (config?.contentFormatter) {
    const content = config.contentFormatter(tool.args, tool.result)
    return h('div', { class: 'tool-content-text' }, content)
  }
  
  // 默认显示：参数和结果的 JSON
  return h('div', { class: 'tool-content-default' }, [
    tool.args && h('div', { class: 'content-section' }, [
      h('div', { class: 'section-label' }, t('components.message.tool.parameters') + ':'),
      h('pre', { class: 'section-data' }, JSON.stringify(tool.args, null, 2))
    ]),
    tool.result && h('div', { class: 'content-section' }, [
      h('div', { class: 'section-label' }, t('components.message.tool.result') + ':'),
      h('pre', { class: 'section-data' }, JSON.stringify(tool.result, null, 2))
    ]),
    tool.error && h('div', { class: 'content-section error-section' }, [
      h('div', { class: 'section-label' }, t('components.message.tool.error') + ':'),
      h('div', { class: 'error-message' }, tool.error)
    ])
  ])
}
</script>

<template>
  <div class="tool-message">
    <div
      v-for="tool in enhancedTools"
      :key="tool.id"
      class="tool-item"
    >
      <!-- 工具头部 - 可点击展开/收起（如果可展开） -->
      <div
        :class="['tool-header', { 'not-expandable': !isExpandable(tool) }]"
        @click="isExpandable(tool) && toggleExpand(tool.id)"
      >
        <div class="tool-info">
          <!-- 展开/收起图标（仅当可展开时显示） -->
          <span
            v-if="isExpandable(tool)"
            :class="[
              'expand-icon',
              'codicon',
              isExpanded(tool.id) ? 'codicon-chevron-down' : 'codicon-chevron-right'
            ]"
          ></span>
          
          <!-- 工具图标 -->
          <span :class="['tool-icon', 'codicon', getToolIcon(tool)]"></span>
          
          <!-- 工具名称 -->
          <span class="tool-name">{{ getToolLabel(tool) }}</span>
          
          <!-- 状态图标 -->
          <div v-if="tool.status || tool.awaitingConfirmation" class="status-icon-wrapper">
            <span
              :class="[
                'status-icon',
                'codicon',
                getStatusIcon(tool.status, tool.awaitingConfirmation),
                getStatusClass(tool.status, tool.awaitingConfirmation)
              ]"
            ></span>
          </div>
          
          <!-- 执行时间 -->
          <span v-if="tool.duration" class="tool-duration">
            {{ tool.duration }}ms
          </span>
        </div>
        
        <!-- 工具描述和操作按钮 -->
        <div class="tool-description-row">
          <div class="tool-description">
            {{ getToolDescription(tool) }}
          </div>
          
          <div class="tool-action-buttons">
            <!-- 确认按钮：当工具等待确认且未做决定时显示 -->
            <button
              v-if="tool.awaitingConfirmation && !hasUserDecision(tool.id)"
              class="confirm-btn"
              :title="t('components.message.tool.confirmExecution')"
              @click.stop="confirmToolExecution(tool.id, tool.name)"
            >
              <span class="confirm-btn-icon codicon codicon-check"></span>
              <span class="confirm-btn-text">{{ t('components.message.tool.confirm') }}</span>
            </button>
            
            <!-- 拒绝按钮：当工具等待确认且未做决定时显示 -->
            <button
              v-if="tool.awaitingConfirmation && !hasUserDecision(tool.id)"
              class="reject-btn"
              :title="t('components.message.tool.reject')"
              @click.stop="rejectToolExecution(tool.id, tool.name)"
            >
              <span class="reject-btn-icon codicon codicon-close"></span>
              <span class="reject-btn-text">{{ t('components.message.tool.reject') }}</span>
            </button>
            
            <!-- 已确认标记 -->
            <span
              v-if="tool.awaitingConfirmation && getToolDecision(tool.id) === true"
              class="decision-badge decision-confirmed"
              :title="t('components.message.tool.confirmed')"
              @click.stop="confirmToolExecution(tool.id, tool.name)"
            >
              <span class="codicon codicon-check"></span>
              <span class="decision-text">{{ t('components.message.tool.confirmed') }}</span>
            </span>
            
            <!-- 已拒绝标记 -->
            <span
              v-if="tool.awaitingConfirmation && getToolDecision(tool.id) === false"
              class="decision-badge decision-rejected"
              :title="t('components.message.tool.rejected')"
              @click.stop="rejectToolExecution(tool.id, tool.name)"
            >
              <span class="codicon codicon-close"></span>
              <span class="decision-text">{{ t('components.message.tool.rejected') }}</span>
            </span>
            
            <!-- diff 预览按钮 -->
            <button
              v-if="hasDiffPreview(tool) && getDiffFilePaths(tool).length > 0"
              class="diff-preview-btn"
              :title="t('components.message.tool.viewDiffInVSCode')"
              @click.stop="openDiffPreview(tool)"
            >
              <span class="diff-btn-icon codicon codicon-diff"></span>
              <span class="diff-btn-text">{{ t('components.message.tool.viewDiff') }}</span>
              <span class="diff-btn-arrow codicon codicon-arrow-right"></span>
            </button>
          </div>
        </div>
      </div>

      <!-- 工具详细内容 - 展开时显示（仅当可展开时） -->
      <div v-if="isExpandable(tool) && isExpanded(tool.id)" class="tool-content">
        <component :is="() => renderToolContent(tool)" />
      </div>

      <!-- apply_diff 底部操作按钮 -->
      <div v-if="shouldShowDiffButtons(tool)" class="diff-action-footer">
        <button
          class="diff-action-btn accept"
          :disabled="isDiffAccepting(tool.id) || isDiffRejecting(tool.id)"
          @click.stop="handleAcceptDiff(tool)"
        >
          <span v-if="isDiffAccepting(tool.id)" class="codicon codicon-loading codicon-modifier-spin"></span>
          <span v-else class="codicon codicon-check"></span>
          <span class="btn-text">{{ t('components.tools.file.applyDiffPanel.save') }}</span>
        </button>
        <button
          class="diff-action-btn reject"
          :disabled="isDiffAccepting(tool.id) || isDiffRejecting(tool.id)"
          @click.stop="handleRejectDiff(tool)"
        >
          <span v-if="isDiffRejecting(tool.id)" class="codicon codicon-loading codicon-modifier-spin"></span>
          <span v-else class="codicon codicon-close"></span>
          <span class="btn-text">{{ t('components.tools.file.applyDiffPanel.reject') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-message {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
}

.tool-item {
  display: flex;
  flex-direction: column;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-sm, 2px);
  overflow: hidden;
}

.tool-header {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs, 4px);
  padding: var(--spacing-sm, 8px);
  cursor: pointer;
  transition: background-color var(--transition-fast, 0.1s);
}

.tool-header:hover {
  background: var(--vscode-list-hoverBackground);
}

.tool-header.not-expandable {
  cursor: default;
}

.tool-header.not-expandable:hover {
  background: transparent;
}

.tool-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
}

.expand-icon {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  transition: transform var(--transition-fast, 0.1s);
}

.tool-icon {
  font-size: 14px;
  color: var(--vscode-charts-blue);
}

.tool-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--vscode-foreground);
  font-family: var(--vscode-font-family);
}

.status-icon {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  margin-left: var(--spacing-xs, 4px);
}

.status-icon.status-success {
  color: var(--vscode-testing-iconPassed);
}

.status-icon.status-error {
  color: var(--vscode-testing-iconFailed);
}

.status-icon.status-running {
  color: var(--vscode-testing-runAction);
  animation: spin 1s linear infinite;
}

.status-icon.status-warning {
  color: var(--vscode-charts-yellow);
}

.status-icon.status-pending {
  color: var(--vscode-inputValidation-warningForeground);
}

.status-icon-wrapper {
  display: flex;
  align-items: center;
  margin-left: var(--spacing-xs, 4px);
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.tool-duration {
  margin-left: auto;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.tool-description-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-sm, 8px);
  margin-left: 28px; /* 对齐图标 */
}

.tool-action-buttons {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  flex-shrink: 0;
}

.tool-description {
  flex: 1;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.4;
  font-family: var(--vscode-editor-font-family);
}

/* 确认按钮 - 极简无边框设计 */
.confirm-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  background: transparent;
  border: none;
  border-radius: 2px;
  color: var(--vscode-foreground);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s ease;
  flex-shrink: 0;
}

.confirm-btn:hover {
  background: rgba(128, 128, 128, 0.15);
}

.confirm-btn:active {
  background: rgba(128, 128, 128, 0.2);
}

.confirm-btn-icon {
  font-size: 12px;
}

.confirm-btn-text {
  white-space: nowrap;
}

/* 拒绝按钮 - 无边框设计 */
.reject-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  background: transparent;
  border: none;
  border-radius: 2px;
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s ease;
  flex-shrink: 0;
}

.reject-btn:hover {
  background: rgba(128, 128, 128, 0.1);
  color: var(--vscode-foreground);
}

.reject-btn:active {
  background: rgba(128, 128, 128, 0.15);
}

.reject-btn-icon {
  font-size: 12px;
}

.reject-btn-text {
  white-space: nowrap;
}

/* 已做决定的标记 */
.decision-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border-radius: 2px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s ease;
  flex-shrink: 0;
}

.decision-badge:hover {
  opacity: 0.8;
}

.decision-confirmed {
  background: rgba(40, 167, 69, 0.15);
  color: var(--vscode-testing-iconPassed);
  border: 1px solid rgba(40, 167, 69, 0.3);
}

.decision-rejected {
  background: rgba(220, 53, 69, 0.15);
  color: var(--vscode-testing-iconFailed);
  border: 1px solid rgba(220, 53, 69, 0.3);
}

.decision-text {
  white-space: nowrap;
}

/* 文件修改底部操作按钮区域 */
.diff-action-footer {
  display: flex;
  gap: var(--spacing-xs, 4px);
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  border-top: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-inactiveSelectionBackground);
}

.diff-action-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: 2px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s ease;
  background: transparent;
}

.diff-action-btn.accept {
  color: var(--vscode-testing-iconPassed);
  border-color: var(--vscode-testing-iconPassed);
}

.diff-action-btn.accept:hover:not(:disabled) {
  background: rgba(40, 167, 69, 0.15);
}

.diff-action-btn.reject {
  color: var(--vscode-testing-iconFailed);
  border-color: var(--vscode-testing-iconFailed);
}

.diff-action-btn.reject:hover:not(:disabled) {
  background: rgba(220, 53, 69, 0.15);
}

.diff-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.diff-action-btn .codicon {
  font-size: 12px;
}

.btn-text {
  white-space: nowrap;
}

/* codicon loading spin 动画 */
@keyframes codicon-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.codicon-modifier-spin {
  animation: codicon-spin 1s linear infinite;
}

/* Diff 预览按钮 - 极简灰白设计 */
.diff-preview-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  background: transparent;
  border: 1px solid #555555;
  border-radius: 2px;
  color: var(--vscode-foreground);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s ease;
  flex-shrink: 0;
}

.diff-preview-btn:hover {
  background: rgba(128, 128, 128, 0.1);
  border-color: #777777;
}

.diff-preview-btn:active {
  background: rgba(128, 128, 128, 0.2);
}

.diff-btn-icon {
  font-size: 12px;
  opacity: 0.85;
}

.diff-btn-text {
  white-space: nowrap;
}

.diff-btn-arrow {
  font-size: 10px;
  opacity: 0.5;
  transition: transform 0.12s ease, opacity 0.12s ease;
}

.diff-preview-btn:hover .diff-btn-arrow {
  transform: translateX(2px);
  opacity: 0.8;
}

.tool-content {
  padding: var(--spacing-sm, 8px);
  border-top: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-inactiveSelectionBackground);
}

/* 默认内容样式 */
.tool-content-default {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
}

.content-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs, 4px);
}

.section-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--vscode-descriptionForeground);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.section-data {
  padding: var(--spacing-xs, 4px);
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-sm, 2px);
  font-size: 11px;
  font-family: var(--vscode-editor-font-family);
  color: var(--vscode-foreground);
  white-space: pre;
  overflow-x: auto;
  margin: 0;
}

.error-section {
  padding: var(--spacing-sm, 8px);
  background: var(--vscode-inputValidation-errorBackground);
  border: 1px solid var(--vscode-inputValidation-errorBorder);
  border-radius: var(--radius-sm, 2px);
}

.error-message {
  font-size: 12px;
  color: var(--vscode-inputValidation-errorForeground);
  font-family: var(--vscode-editor-font-family);
}

.tool-content-text {
  font-size: 12px;
  color: var(--vscode-foreground);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>