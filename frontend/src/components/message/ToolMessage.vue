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
import { sendToExtension, onExtensionCommand } from '../../utils/vscode'
import { useI18n } from '../../i18n'
import { generateId } from '../../utils/format'

const { t } = useI18n()

const props = defineProps<{
  tools: ToolUsage[]
}>()

const chatStore = useChatStore()


// --- Apply Diff 确认逻辑 ---
// 支持 apply_diff, write_file, search_in_files(替换模式) 共用 diff 确认流程

// 支持 diff 确认的工具名称列表
const DIFF_SUPPORTED_TOOLS = ['apply_diff', 'write_file', 'search_in_files']

// 每个工具的自动确认配置
const applyDiffConfigs = ref<Map<string, { autoSave: boolean; autoSaveDelay: number }>>(new Map())
const applyDiffTimeLeft = ref<Map<string, number>>(new Map())
const applyDiffProgress = ref<Map<string, number>>(new Map())
const applyDiffTimers = new Map<string, ReturnType<typeof setInterval>>()

// 工具 ID 到 Pending Diff ID 的映射
const toolIdToPendingId = ref<Map<string, string>>(new Map())

// 记录曾经出现过的 diff 工具（避免在 diff 刚开始、映射尚未同步前误判为错误）
const seenDiffToolIds = ref<Set<string>>(new Set())

// 检查是否是支持 diff 的工具且处于 pending 状态
function isDiffToolPending(tool: ToolUsage) {
  // 检查工具是否支持 diff 确认
  if (!DIFF_SUPPORTED_TOOLS.includes(tool.name)) return false
  
  // 对于 search_in_files，只有替换模式才需要确认
  if (tool.name === 'search_in_files') {
    const args = tool.args as Record<string, unknown>
    const mode = args?.mode as string
    if (mode !== 'replace') return false
  }
  
  // 情况 1: 检查工具是否在后端活跃的 Pending Diff 列表中
  if (toolIdToPendingId.value.has(tool.id)) return true
  
  // 情况 2: 结果中已有状态 (已返回)，且后端报告它是活跃的
  const resultData = tool.result?.data as any
  if (resultData) {
    // apply_diff: pendingDiffId 直接在 data 上
    if (resultData.pendingDiffId) {
      if (Array.from(toolIdToPendingId.value.values()).includes(resultData.pendingDiffId)) {
        return true
      }
    }
    
    // write_file: pendingDiffId 在 data.results 数组的每个元素上
    if (Array.isArray(resultData.results)) {
      for (const r of resultData.results) {
        if (r.pendingDiffId && Array.from(toolIdToPendingId.value.values()).includes(r.pendingDiffId)) {
          return true
        }
      }
    }
    
    // search_in_files: pendingDiffId 在 data.replacements 数组的每个元素上
    if (Array.isArray(resultData.replacements)) {
      for (const r of resultData.replacements) {
        if (r.pendingDiffId && Array.from(toolIdToPendingId.value.values()).includes(r.pendingDiffId)) {
          return true
        }
      }
    }
  }
  
  return false
}

// 启动自动确认计时器
function startDiffTimer(toolId: string, delay: number) {
  if (applyDiffTimers.has(toolId)) return
  
  applyDiffTimeLeft.value.set(toolId, delay)
  applyDiffProgress.value.set(toolId, 100)
  const startTime = Date.now()
  
  const timer = setInterval(() => {
    const elapsed = Date.now() - startTime
    const remaining = Math.max(0, delay - elapsed)
    applyDiffTimeLeft.value.set(toolId, remaining)
    applyDiffProgress.value.set(toolId, (remaining / delay) * 100)
    
    if (remaining <= 0) {
      stopDiffTimer(toolId)
      confirmDiff(toolId)
    }
  }, 50)
  
  applyDiffTimers.set(toolId, timer)
}

function stopDiffTimer(toolId: string) {
  const timer = applyDiffTimers.get(toolId)
  if (timer) {
    clearInterval(timer)
    applyDiffTimers.delete(toolId)
  }
}

// 确认执行 diff
async function confirmDiff(toolId: string) {
  stopDiffTimer(toolId)
  const tool = enhancedTools.value.find(t => t.id === toolId)
  let sessionId = (tool?.result as any)?.data?.pendingDiffId
  
  // 如果结果中还没有，从映射中找
  if (!sessionId) {
    sessionId = toolIdToPendingId.value.get(toolId)
  }
  
  if (!sessionId) return
  
  try {
    await sendToExtension('diff.accept', { sessionId })
  } catch (err) {
    console.error('Failed to accept diff:', err)
  }
}

// 拒绝执行 diff
async function rejectDiff(toolId: string) {
  stopDiffTimer(toolId)
  const tool = enhancedTools.value.find(t => t.id === toolId)
  let sessionId = (tool?.result as any)?.data?.pendingDiffId
  
  // 如果结果中还没有，从映射中找
  if (!sessionId) {
    sessionId = toolIdToPendingId.value.get(toolId)
  }
  
  if (!sessionId) return
  
  try {
    const result = await sendToExtension<{ success: boolean }>('diff.reject', { 
      sessionId,
      toolId,
      conversationId: chatStore.currentConversationId
    })
    
    // 拒绝成功后直接更新前端工具状态，而不是重新加载历史
    if (result?.success && tool) {
      tool.status = 'error'
      // 从映射中移除
      toolIdToPendingId.value.delete(toolId)
    }
  } catch (err) {
    console.error('Failed to reject diff:', err)
  }
}

onMounted(async () => {
  // 获取 diff 工具配置（apply_diff 的配置应用到所有支持 diff 的工具）
  try {
    const response = await sendToExtension<{ config: { autoSave: boolean; autoSaveDelay: number } }>('tools.getToolConfig', {
      toolName: 'apply_diff'
    })
    
    if (response?.config) {
      // 监听 enhancedTools 的变化，为新出现的 pending 工具启动计时器
      watchEffect(() => {
        for (const tool of enhancedTools.value) {
          if (isDiffToolPending(tool) && !applyDiffTimers.has(tool.id)) {
            applyDiffConfigs.value.set(tool.id, response.config)
            if (response.config.autoSave) {
              startDiffTimer(tool.id, response.config.autoSaveDelay)
            }
          }
        }
      })
    }
  } catch (err) {
    console.error('Failed to get diff tool config:', err)
  }
  
  // 监听状态变化同步
  const unregister = onExtensionCommand('diff.statusChanged', (data: any) => {
    // 更新工具 ID 映射
    const newMapping = new Map<string, string>()
    for (const d of data.pendingDiffs) {
      if (d.toolId) {
        newMapping.set(d.toolId, d.id)
      }
    }
    toolIdToPendingId.value = newMapping

    // 记录已出现过的 diff 工具 ID
    const nextSeen = new Set(seenDiffToolIds.value)
    for (const toolId of newMapping.keys()) {
      nextSeen.add(toolId)
    }
    seenDiffToolIds.value = nextSeen

    // 检查是否有新的 pending 工具需要启动计时器
    if (applyDiffConfigs.value.size > 0) {
      const globalConfig = Array.from(applyDiffConfigs.value.values())[0]
      if (globalConfig?.autoSave) {
        for (const tool of enhancedTools.value) {
          if (isDiffToolPending(tool) && !applyDiffTimers.has(tool.id)) {
            startDiffTimer(tool.id, globalConfig.autoSaveDelay)
          }
        }
      }
    }

    // 清理已完成工具的计时器
    for (const toolId of applyDiffTimers.keys()) {
      const isStillPending = data.pendingDiffs.some((d: any) => d.toolId === toolId)
      if (!isStillPending) {
        stopDiffTimer(toolId)
      }
    }
  })
  
  onBeforeUnmount(() => {
    unregister()
    for (const timer of applyDiffTimers.values()) {
      clearInterval(timer)
    }
    applyDiffTimers.clear()
  })
})

// ---------------------------

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
      
      // 检查是否是待审阅状态
      const data = (response as any).data
      const isPending = data?.status === 'pending'
      
      // 检查是否为部分成功 (针对 apply_diff 等工具)
      let status: 'success' | 'error' | 'warning' | 'pending' = success ? 'success' : 'error'
      let awaitingConfirmation = isPending

      if (isPending) {
        // 检查是否是支持 diff 的工具
        const isDiffTool = DIFF_SUPPORTED_TOOLS.includes(tool.name)
        
        // 对于 search_in_files，只有替换模式才需要确认
        let isSearchReplaceMode = true
        if (tool.name === 'search_in_files') {
          const args = tool.args as Record<string, unknown>
          const mode = args?.mode as string
          isSearchReplaceMode = mode === 'replace'
        }
        
        if (isDiffTool && isSearchReplaceMode) {
          if (!toolIdToPendingId.value.has(tool.id)) {
            // 不在活跃列表，说明已经过期或被外部处理（接受/拒绝）
            status = 'error' // 显示为错误/已取消状态
            awaitingConfirmation = false
          } else {
            status = 'pending'
            // diff 工具有专用的操作栏，不显示通用的确认按钮
            awaitingConfirmation = false
          }
        } else {
          status = 'pending'
        }
      } else if (success && data && data.appliedCount > 0 && data.failedCount > 0) {
        status = 'warning'
      }
      
      return { 
        ...tool, 
        result: response || undefined,
        error, 
        status, 
        awaitingConfirmation 
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

    // 重要：diff 工具在后端被 cancel/reject 后，可能不会立刻返回 functionResponse（例如流被中断）。
    // 此时如果我们已经“见过”这个 diff 工具进入 pendingDiffs 列表，但现在列表里没有它，
    // 则说明 diff 已结束（多半是被取消），需要将 UI 状态从 running/pending 纠正为 error。
    const isDiffTool = DIFF_SUPPORTED_TOOLS.includes(tool.name)
    let isDiffApplicable = true
    if (tool.name === 'search_in_files') {
      const args = tool.args as Record<string, unknown>
      const mode = args?.mode as string
      isDiffApplicable = mode === 'replace'
    }

    if (
      isDiffTool &&
      isDiffApplicable &&
      seenDiffToolIds.value.has(tool.id) &&
      !toolIdToPendingId.value.has(tool.id) &&
      (effectiveStatus === 'running' || effectiveStatus === 'pending')
    ) {
      return {
        ...tool,
        status: 'error' as const,
        error: tool.error || t('components.tools.cancelled'),
        awaitingConfirmation: false
      }
    }

    return { ...tool, status: effectiveStatus, awaitingConfirmation: awaitingConfirm }
  })
})

// 正在处理确认的工具 ID 集合
// eslint-disable-next-line no-undef
const processingToolIds = ref<Set<string>>(new Set())

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

  // 获取输入栏的批注内容
  const annotation = chatStore.inputValue.trim()

  // 清空用户决定状态
  userDecisions.value.clear()

  // 清空输入栏
  if (annotation) {
    chatStore.clearInputValue()

    // 先在聊天流中添加用户的批注消息（确保显示顺序正确）
    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: annotation,
      timestamp: Date.now(),
      parts: [{ text: annotation }]
    }
    chatStore.allMessages.push(userMessage)
  }

  // 发送到后端（带批注）
  await sendToolConfirmation(toolResponses, annotation)
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
  // 优先使用动态 labelFormatter
  if (config?.labelFormatter) {
    return config.labelFormatter(tool.args)
  }
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

      <!-- Diff 工具确认操作栏 (位于外层，不随展开面板隐藏) -->
      <div v-if="isDiffToolPending(tool)" class="diff-action-footer">
        <div class="footer-top" v-if="applyDiffConfigs.get(tool.id)?.autoSave">
          <div class="timer-container">
            <div class="timer-bar" :style="{ width: (applyDiffProgress.get(tool.id) || 0) + '%' }"></div>
          </div>
          <span class="timer-text">{{ ((applyDiffTimeLeft.get(tool.id) || 0) / 1000).toFixed(1) }}s</span>
        </div>
        <div class="footer-buttons">
          <button class="confirm-btn-primary" @click.stop="confirmDiff(tool.id)">
            <span class="codicon codicon-check"></span>
            {{ t('components.message.tool.saveAll') }}
          </button>
          <button class="reject-btn-secondary" @click.stop="rejectDiff(tool.id)">
            <span class="codicon codicon-close"></span>
            {{ t('components.message.tool.rejectAll') }}
          </button>
        </div>
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
  padding: 4px var(--spacing-sm, 8px);
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
  padding: 4px var(--spacing-sm, 8px);
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

/* Diff 工具操作栏样式 */
.diff-action-footer {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px;
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-top: 1px solid var(--vscode-panel-border);
}

.footer-top {
  display: flex;
  align-items: center;
  gap: 4px;
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
  gap: 4px;
  width: 100%;
}

.footer-buttons button {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 2px;
  border: none;
  transition: opacity 0.12s ease;
}

.confirm-btn-primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.confirm-btn-primary:hover {
  background: var(--vscode-button-hoverBackground);
}

.reject-btn-secondary {
  background: transparent;
  color: var(--vscode-foreground);
  border: 1px solid var(--vscode-panel-border);
}

.reject-btn-secondary:hover {
  background: var(--vscode-toolbar-hoverBackground);
}
</style>