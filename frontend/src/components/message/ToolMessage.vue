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

import { ref, computed, h, watchEffect, watch, nextTick, onMounted, onBeforeUnmount, type Component, type ComponentPublicInstance } from 'vue'
import type { ToolUsage, Message } from '../../types'
import { getToolConfig, type ToolActionConfig, type ToolActionContext } from '../../utils/toolRegistry'
import { ensureMcpToolRegistered } from '../../utils/tools'
import { useChatStore } from '../../stores'
import { sendToExtension, onExtensionCommand, showNotification } from '../../utils/vscode'
import { useI18n } from '../../i18n'
import { generateId } from '../../utils/format'
import { isPerfEnabled } from '../../utils/perf'

const { t } = useI18n()

const props = defineProps<{
  tools: ToolUsage[]
  messageBackendIndex?: number
}>()

const chatStore = useChatStore()


const todoDebugPrinted = new Set<string>()
function debugToolOnce(key: string, data: Record<string, unknown>) {
  if (!isPerfEnabled()) return
  if (todoDebugPrinted.has(key)) return
  todoDebugPrinted.add(key)
  console.debug('[todo-debug][ToolMessage]', data)
}


// --- Apply Diff 确认逻辑 ---
// 支持 apply_diff, write_file, search_in_files(替换模式) 共用 diff 确认流程

// 支持 diff 确认的工具名称列表
const DIFF_SUPPORTED_TOOLS = ['apply_diff', 'write_file', 'search_in_files', 'insert_code', 'delete_code']

type ApplyDiffAutoSaveConfig = { autoSave: boolean; autoSaveDelay: number }

type PendingDiffSession = {
  id: string
  toolId?: string
  filePath: string
  diffGuardWarning?: string
  diffGuardDeletePercent?: number
}

const applyDiffTimeLeft = ref<Map<string, number>>(new Map())
const applyDiffProgress = ref<Map<string, number>>(new Map())
const applyDiffTimers = new Map<string, ReturnType<typeof setInterval>>()

// apply_diff 的全局配置（应用到所有支持 diff 的工具）
const globalApplyDiffConfig = ref<ApplyDiffAutoSaveConfig>({ autoSave: false, autoSaveDelay: 3000 })

// 工具 ID 到 Pending Diff 列表的映射
const toolIdToPendingDiffs = ref<Map<string, PendingDiffSession[]>>(new Map())

// 工具 ID 到 diff 警戒值警告的映射
const diffGuardWarnings = ref<Map<string, { warning: string; deletePercent: number }>>(new Map())
// 持久警戒值缓存：一旦出现过警戒，工具结束后仍保留在消息上显示
// （避免 pending 结束后 diff.statusChanged 把临时映射清空）
const persistedDiffGuardWarnings = ref<Map<string, { warning: string; deletePercent: number }>>(new Map())

// 记录曾经出现过的 diff 工具（避免在 diff 刚开始、映射尚未同步前误判为错误）
const seenDiffToolIds = ref<Set<string>>(new Set())

// diff 工具从 pendingDiffs 列表消失到收到最终 functionResponse 之间，可能会出现短暂的空窗。
// 为避免 UI 闪烁（先 error 再 success），这里给一个宽限期。
const pendingDiffOrphanedAt = ref<Map<string, number>>(new Map())
const DIFF_ORPHAN_GRACE_MS = 800

const processingDiffSessionIds = ref<Set<string>>(new Set())
const diffActionErrors = ref<Map<string, string>>(new Map())

function addProcessingDiffSessionId(sessionId: string) {
  if (!sessionId || processingDiffSessionIds.value.has(sessionId)) return
  const next = new Set(processingDiffSessionIds.value)
  next.add(sessionId)
  processingDiffSessionIds.value = next
}

function removeProcessingDiffSessionId(sessionId: string) {
  if (!sessionId || !processingDiffSessionIds.value.has(sessionId)) return
  const next = new Set(processingDiffSessionIds.value)
  next.delete(sessionId)
  processingDiffSessionIds.value = next
}

function clearDiffActionError(sessionId: string) {
  if (!sessionId || !diffActionErrors.value.has(sessionId)) return
  const next = new Map(diffActionErrors.value)
  next.delete(sessionId)
  diffActionErrors.value = next
}

function setDiffActionError(sessionId: string, message: string) {
  const next = new Map(diffActionErrors.value)
  next.set(sessionId, message)
  diffActionErrors.value = next
}

function getDiffActionError(sessionId: string): string | undefined {
  return diffActionErrors.value.get(sessionId)
}

function getAllPendingDiffSessions(): PendingDiffSession[] {
  return Array.from(toolIdToPendingDiffs.value.values()).flatMap((sessions) => sessions)
}

function getPendingDiffSessions(toolOrId: ToolUsage | string): PendingDiffSession[] {
  const toolId = typeof toolOrId === 'string' ? toolOrId : toolOrId.id
  return toolIdToPendingDiffs.value.get(toolId) ?? []
}

function hasPendingDiffSession(sessionId: string): boolean {
  return getAllPendingDiffSessions().some((session) => session.id === sessionId)
}

function extractPendingDiffIdsFromResultData(data: any): string[] {
  const pendingDiffIds = new Set<string>()

  if (typeof data?.pendingDiffId === 'string' && data.pendingDiffId) {
    pendingDiffIds.add(data.pendingDiffId)
  }

  if (Array.isArray(data?.results)) {
    for (const item of data.results) {
      if (typeof item?.pendingDiffId === 'string' && item.pendingDiffId) {
        pendingDiffIds.add(item.pendingDiffId)
      }
    }
  }

  if (Array.isArray(data?.replacements)) {
    for (const item of data.replacements) {
      if (typeof item?.pendingDiffId === 'string' && item.pendingDiffId) {
        pendingDiffIds.add(item.pendingDiffId)
      }
    }
  }

  return Array.from(pendingDiffIds)
}

function getActionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
    return error.message
  }

  if (typeof error === 'string' && error.trim()) {
    return error
  }

  const maybeMessage = (error as any)?.message
  if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
    return maybeMessage
  }

  return fallback
}

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
  if (getPendingDiffSessions(tool).length > 0) return true
  
  // 情况 2: 结果中已有状态 (已返回)，且后端报告它是活跃的
  const resultData = tool.result?.data as any
  if (resultData) {
    return extractPendingDiffIdsFromResultData(resultData).some((pendingDiffId) => hasPendingDiffSession(pendingDiffId))
  }
  
  return false
}

function normalizeApplyDiffConfig(raw: any): ApplyDiffAutoSaveConfig {
  const autoSave = !!raw?.autoSave
  const delay = Number(raw?.autoSaveDelay)
  const autoSaveDelay = Number.isFinite(delay) ? Math.max(0, delay) : 3000
  return { autoSave, autoSaveDelay }
}

function clearAllDiffTimers() {
  for (const sessionId of Array.from(applyDiffTimers.keys())) {
    stopDiffTimer(sessionId)
  }
  applyDiffTimeLeft.value = new Map()
  applyDiffProgress.value = new Map()
}

function applyGlobalApplyDiffConfig(config: ApplyDiffAutoSaveConfig, opts?: { restartTimers?: boolean }) {
  const restartTimers = opts?.restartTimers ?? false
  globalApplyDiffConfig.value = config

  if (!restartTimers) return

  // 配置变更时，重置所有倒计时并按新配置重新开始
  clearAllDiffTimers()

  if (config.autoSave) {
    for (const session of getAllPendingDiffSessions()) {
      if (!applyDiffTimers.has(session.id) && !processingDiffSessionIds.value.has(session.id) && !diffActionErrors.value.has(session.id)) {
        startDiffTimer(session.id, config.autoSaveDelay)
      }
    }
  }
}

// 启动自动确认计时器
function startDiffTimer(sessionId: string, delay: number) {
  if (applyDiffTimers.has(sessionId)) return
  if (processingDiffSessionIds.value.has(sessionId)) return
  if (diffActionErrors.value.has(sessionId)) return
  if (delay <= 0) return

  
  applyDiffTimeLeft.value.set(sessionId, delay)
  applyDiffProgress.value.set(sessionId, 100)
  const startTime = Date.now()
  
  const timer = setInterval(() => {
    const elapsed = Date.now() - startTime
    const remaining = Math.max(0, delay - elapsed)
    applyDiffTimeLeft.value.set(sessionId, remaining)
    applyDiffProgress.value.set(sessionId, (remaining / delay) * 100)
    
    if (remaining <= 0) {
      // autoSave=true 时，后端 DiffManager 是自动确认的唯一权威。
      // 为什么不再从前端调用 confirmDiff：前后端同时 accept 同一个 pending diff 会触发 isDiffActionInProgress 竞态，导致一方失败并可能让工具等待链路卡住。
      // 怎么改：前端倒计时只负责视觉展示，时间到后停止本地计时，等待后端 diff.statusChanged 同步最终状态。
      // 目的：消除双重自动确认来源，让自动保存流程由后端串行收敛。
      stopDiffTimer(sessionId)
    }
  }, 50)
  
  applyDiffTimers.set(sessionId, timer)
}

function stopDiffTimer(sessionId: string) {
  const timer = applyDiffTimers.get(sessionId)
  if (timer) {
    clearInterval(timer)
    applyDiffTimers.delete(sessionId)
  }
  applyDiffTimeLeft.value.delete(sessionId)
  applyDiffProgress.value.delete(sessionId)
}

// 确认执行 diff
async function confirmDiff(sessionId: string) {
  if (processingDiffSessionIds.value.has(sessionId)) return

  stopDiffTimer(sessionId)
  clearDiffActionError(sessionId)

  if (!hasPendingDiffSession(sessionId)) {
    const message = 'Pending diff not found. Please retry after status sync.'
    setDiffActionError(sessionId, message)
    await showNotification(message, 'error')
    return
  }

  addProcessingDiffSessionId(sessionId)
  
  try {
    await sendToExtension('diff.accept', { sessionId })
  } catch (err) {
    removeProcessingDiffSessionId(sessionId)
    const message = getActionErrorMessage(err, 'Failed to accept diff. Please retry.')
    setDiffActionError(sessionId, message)
    await showNotification(message, 'error')
    console.error('Failed to accept diff:', err)
  }
}

// 拒绝执行 diff
async function rejectDiff(sessionId: string) {
  if (processingDiffSessionIds.value.has(sessionId)) return

  stopDiffTimer(sessionId)
  clearDiffActionError(sessionId)

  if (!hasPendingDiffSession(sessionId)) {
    const message = 'Pending diff not found. Please retry after status sync.'
    setDiffActionError(sessionId, message)
    await showNotification(message, 'error')
    return
  }

  addProcessingDiffSessionId(sessionId)
  
  try {
    await sendToExtension('diff.reject', { sessionId })
  } catch (err) {
    removeProcessingDiffSessionId(sessionId)
    const message = getActionErrorMessage(err, 'Failed to reject diff. Please retry.')
    setDiffActionError(sessionId, message)
    await showNotification(message, 'error')
    console.error('Failed to reject diff:', err)
  }
}

onMounted(async () => {
  // 获取 diff 工具配置（apply_diff 的配置应用到所有支持 diff 的工具）
  try {
    const response = await sendToExtension<{ config: ApplyDiffAutoSaveConfig }>('tools.getToolConfig', {
      toolName: 'apply_diff'
    })
    if (response?.config) {
      applyGlobalApplyDiffConfig(normalizeApplyDiffConfig(response.config), { restartTimers: true })
    }
  } catch (err) {
    console.error('Failed to get diff tool config:', err)
  }

  // 监听后端推送的配置变更（无需刷新页面即可生效）
  const unregisterApplyDiffConfigChanged = onExtensionCommand('tools.applyDiffConfigChanged', (data: any) => {
    applyGlobalApplyDiffConfig(normalizeApplyDiffConfig(data?.config), { restartTimers: true })
  })
  onBeforeUnmount(unregisterApplyDiffConfigChanged)

  // 监听 enhancedTools 的变化，为新出现的 pending 工具启动计时器
  watchEffect(() => {
    const cfg = globalApplyDiffConfig.value
    if (!cfg.autoSave) {
      return
    }

    for (const session of getAllPendingDiffSessions()) {
      if (!applyDiffTimers.has(session.id) && !processingDiffSessionIds.value.has(session.id) && !diffActionErrors.value.has(session.id)) {
        startDiffTimer(session.id, cfg.autoSaveDelay)
      }
    }
  })
  
  // 监听状态变化同步
  const unregister = onExtensionCommand('diff.statusChanged', (data: any) => {
    // 更新工具 ID 映射
    const newMapping = new Map<string, PendingDiffSession[]>()
    for (const d of data.pendingDiffs) {
      if (d.toolId) {
        const existing = newMapping.get(d.toolId) || []
        existing.push({
          id: d.id,
          toolId: d.toolId,
          filePath: d.filePath,
          diffGuardWarning: d.diffGuardWarning,
          diffGuardDeletePercent: d.diffGuardDeletePercent
        })
        newMapping.set(d.toolId, existing)
      }
    }
    toolIdToPendingDiffs.value = newMapping

    // 更新 diff 警戒值警告映射
    const newWarnings = new Map<string, { warning: string; deletePercent: number }>()
    for (const d of data.pendingDiffs) {
      if (d.toolId && d.diffGuardWarning) {
        const nextWarning = {
          warning: d.diffGuardWarning,
          deletePercent: d.diffGuardDeletePercent ?? 0
        }
        const currentWarning = newWarnings.get(d.toolId)
        if (!currentWarning || nextWarning.deletePercent >= currentWarning.deletePercent) {
          newWarnings.set(d.toolId, nextWarning)
        }
      }
    }

    // 实时警告（仅当前 pending）
    diffGuardWarnings.value = newWarnings

    // 持久化警告（工具结束后继续显示在消息上）
    if (newWarnings.size > 0) {
      const nextPersisted = new Map(persistedDiffGuardWarnings.value)
      for (const [toolId, warning] of newWarnings.entries()) {
        nextPersisted.set(toolId, warning)
      }
      persistedDiffGuardWarnings.value = nextPersisted
    }

    // 记录已出现过的 diff 工具 ID
    const nextSeen = new Set(seenDiffToolIds.value)
    for (const toolId of newMapping.keys()) {
      nextSeen.add(toolId)
    }
    seenDiffToolIds.value = nextSeen

    const activeSessionIds = new Set<string>(data.pendingDiffs.map((d: any) => d.id))

    const nextProcessingDiffs = new Set(processingDiffSessionIds.value)
    let processingChanged = false
    for (const sessionId of Array.from(nextProcessingDiffs)) {
      if (!activeSessionIds.has(sessionId)) {
        nextProcessingDiffs.delete(sessionId)
        processingChanged = true
      }
    }
    if (processingChanged) {
      processingDiffSessionIds.value = nextProcessingDiffs
    }

    const nextDiffErrors = new Map(diffActionErrors.value)
    let errorsChanged = false
    for (const sessionId of Array.from(nextDiffErrors.keys())) {
      if (!activeSessionIds.has(sessionId)) {
        nextDiffErrors.delete(sessionId)
        errorsChanged = true
      }
    }
    if (errorsChanged) {
      diffActionErrors.value = nextDiffErrors
    }

    // 清理已完成工具的计时器
    for (const sessionId of Array.from(applyDiffTimers.keys())) {
      if (!activeSessionIds.has(sessionId)) {
        stopDiffTimer(sessionId)
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
  // TODO 排查：检测同一 ToolMessage 内是否出现重复 toolId
  const toolIds = props.tools.map(t => t.id).filter(id => typeof id === 'string' && id.trim())
  const duplicateToolIds = toolIds.filter((id, idx) => toolIds.indexOf(id) !== idx)
  if (duplicateToolIds.length > 0) {
    const key = `dup-${duplicateToolIds.join('|')}-${props.tools.map(t => t.name).join('|')}`
    debugToolOnce(key, {
      message: 'Duplicate tool ids found in ToolMessage props.tools',
      duplicateToolIds,
      toolNames: props.tools.map(t => t.name),
      toolStatuses: props.tools.map(t => t.status || null)
    })
    if (isPerfEnabled()) {
      console.warn('[todo-debug][ToolMessage] duplicate tool ids in props.tools', {
        duplicateToolIds,
        tools: props.tools.map(t => ({ id: t.id, name: t.name, status: t.status }))
      })
    }
  }

  debugToolOnce(`tools-${props.tools.map(t => `${t.id}:${t.name}`).join('|')}`, {
    message: 'Render tools in ToolMessage',
    toolCount: props.tools.length,
    tools: props.tools.map(t => ({ id: t.id, name: t.name, status: t.status || null }))
  })

  return props.tools.map((tool) => {
    const isDiffTool = DIFF_SUPPORTED_TOOLS.includes(tool.name)
    let isDiffApplicable = true
    if (tool.name === 'search_in_files') {
      const args = tool.args as Record<string, unknown>
      const mode = args?.mode as string
      isDiffApplicable = mode === 'replace'
    }

    const activePendingDiff = isDiffTool && isDiffApplicable && isDiffToolPending(tool)

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
      
      const data = (response as any).data

      if (activePendingDiff) {
        const isAnyDiffProcessing = getPendingDiffSessions(tool).some((pendingDiff) => processingDiffSessionIds.value.has(pendingDiff.id))

        return {
          ...tool,
          result: response || undefined,
          error: undefined,
          status: isAnyDiffProcessing ? ('executing' as const) : ('awaiting_apply' as const),
          awaitingConfirmation: false
        }
      }

      // 根据工具响应确定最终状态
      let status: ToolUsage['status'] = success ? 'success' : 'error'

      // 兼容：少数工具可能在 response.data.status 里返回 pending（一般用于“等待应用/审阅”）
      if (data?.status === 'pending') {
        status = 'awaiting_apply'
      }

      // 检查是否为部分成功 (针对 apply_diff 等工具)
      if (success && data && data.appliedCount > 0 && data.failedCount > 0) {
        status = 'warning'
      }

      return {
        ...tool,
        result: response || undefined,
        error,
        status,
        // 向后兼容字段：尽量不用它来驱动 UI
        awaitingConfirmation: false
      }
    }
    
    // 如果正在处理确认/执行中的过渡态
    if (processingToolIds.value.has(tool.id)) {
      return { ...tool, status: 'executing' as const, awaitingConfirmation: false }
    }
    
    // 等待用户批准
    const awaitingConfirm = tool.status === 'awaiting_approval'

    // 没有找到响应，使用当前状态
    const effectiveStatus: ToolUsage['status'] = tool.status || 'queued'

    // 重要：diff 工具在后端被 cancel/reject 后，可能不会立刻返回 functionResponse（例如流被中断）。
    // 此时如果我们已经“见过”这个 diff 工具进入 pendingDiffs 列表，但现在列表里没有它，
    // 则说明 diff 已结束（多半是被取消），需要将 UI 状态从 running/pending 纠正为 error。
    if (
      isDiffTool &&
      isDiffApplicable &&
      seenDiffToolIds.value.has(tool.id) &&
      getPendingDiffSessions(tool.id).length === 0 &&
      (effectiveStatus === 'executing' || effectiveStatus === 'awaiting_apply')
    ) {
      const now = Date.now()
      const existed = pendingDiffOrphanedAt.value.get(tool.id)
      const since = existed ?? now
      if (!existed) {
        pendingDiffOrphanedAt.value.set(tool.id, now)
        pendingDiffOrphanedAt.value = new Map(pendingDiffOrphanedAt.value)
      }

      // 宽限期内保持原状态，避免 UI 闪烁（先 error 再 success）。
      if (now - since < DIFF_ORPHAN_GRACE_MS) {
        return { ...tool, status: effectiveStatus, awaitingConfirmation: false }
      }

      return {
        ...tool,
        status: 'error' as const,
        error: tool.error || t('components.tools.cancelled'),
        awaitingConfirmation: false
      }
    }

    // 非 executing/awaiting_apply 场景，清理 orphan 记录
    if (pendingDiffOrphanedAt.value.has(tool.id) && effectiveStatus !== 'executing' && effectiveStatus !== 'awaiting_apply') {
      pendingDiffOrphanedAt.value.delete(tool.id)
      pendingDiffOrphanedAt.value = new Map(pendingDiffOrphanedAt.value)
    }

    // diff 工具：如果 diff 处于 pending（等待应用/审阅），将状态映射为 awaiting_apply
    if (activePendingDiff) {
      const isAnyDiffProcessing = getPendingDiffSessions(tool).some((pendingDiff) => processingDiffSessionIds.value.has(pendingDiff.id))
      if (isAnyDiffProcessing) {
        return { ...tool, status: 'executing' as const, awaitingConfirmation: false }
      }

      return { ...tool, status: 'awaiting_apply' as const, awaitingConfirmation: false }
    }

    return { ...tool, status: effectiveStatus, awaitingConfirmation: awaitingConfirm }
  })
})

// 正在处理确认的工具 ID 集合
// eslint-disable-next-line no-undef
const processingToolIds = ref<Set<string>>(new Set())

function addProcessingToolId(toolId: string) {
  if (!toolId || processingToolIds.value.has(toolId)) return
  const next = new Set(processingToolIds.value)
  next.add(toolId)
  processingToolIds.value = next
}

function removeProcessingToolId(toolId: string) {
  if (!toolId || !processingToolIds.value.has(toolId)) return
  const next = new Set(processingToolIds.value)
  next.delete(toolId)
  processingToolIds.value = next
}

// 当后端把工具从 awaiting_approval 推进到 executing/success/error 后，清理本地“处理中”标记
watchEffect(() => {
  if (processingToolIds.value.size === 0) return

  const current = new Set(processingToolIds.value)
  let changed = false

  for (const id of current) {
    // 这里读取“原始工具状态”（props.tools），避免被 enhancedTools 的乐观 executing 状态误清理
    const rawTool = props.tools.find(x => x.id === id)
    const hasResponse = Boolean(rawTool?.result || rawTool?.error || chatStore.getToolResponseById(id))
    const stillAwaitingApproval = rawTool?.status === 'awaiting_approval'

    if (!rawTool || !stillAwaitingApproval || hasResponse) {
      current.delete(id)
      changed = true
    }
  }

  if (changed) {
    processingToolIds.value = current
  }
})

watchEffect(() => {
  if (processingDiffSessionIds.value.size === 0) return

  const activeSessionIds = new Set(getAllPendingDiffSessions().map((session) => session.id))
  const current = new Set(processingDiffSessionIds.value)
  let changed = false

  for (const sessionId of current) {
    if (!activeSessionIds.has(sessionId)) {
      current.delete(sessionId)
      changed = true
    }
  }

  if (changed) {
    processingDiffSessionIds.value = current
  }
})

watchEffect(() => {
  if (diffActionErrors.value.size === 0) return

  const activeSessionIds = new Set(getAllPendingDiffSessions().map((session) => session.id))
  const next = new Map(diffActionErrors.value)
  let changed = false

  for (const sessionId of Array.from(next.keys())) {
    if (!activeSessionIds.has(sessionId)) {
      next.delete(sessionId)
      changed = true
    }
  }

  if (changed) {
    diffActionErrors.value = next
  }
})

// 确认工具执行（立即提交到后端）
async function confirmToolExecution(toolId: string, toolName: string) {
  await submitToolDecision(toolId, toolName, true)
}

// 拒绝工具执行（立即提交到后端）
async function rejectToolExecution(toolId: string, toolName: string) {
  await submitToolDecision(toolId, toolName, false)
}

async function submitToolDecision(toolId: string, toolName: string, confirmed: boolean) {
  if (!toolId || processingToolIds.value.has(toolId)) return
  const currentTool = props.tools.find(t => t.id === toolId)
  if (!currentTool || currentTool.status !== 'awaiting_approval') return

  // 标记为正在处理（注意：Set 变更需替换引用才能触发响应式更新）
  addProcessingToolId(toolId)

  // 获取输入栏的批注内容（可选）
  const annotation = chatStore.inputValue.trim()

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

  const sent = await sendToolConfirmation(
    [{ id: toolId, name: toolName, confirmed }],
    annotation
  )
  if (!sent) {
    removeProcessingToolId(toolId)
  }
}

// 发送工具确认响应到后端
async function sendToolConfirmation(
  toolResponses: Array<{ id: string; name: string; confirmed: boolean }>,
  annotation?: string
): Promise<boolean> {
  try {
    const currentConversationId = chatStore.currentConversationId
    const currentConfig = chatStore.currentConfig

    if (!currentConversationId || !currentConfig?.id) {
      console.error('No conversation or config ID')
      return false
    }

    // 为本次工具确认流绑定 streamId，避免流式过滤器把后端返回的 chunk 当作“未知流”丢弃
    const streamId = generateId()
    chatStore.activeStreamId = streamId
    chatStore.isWaitingForResponse = true

    await sendToExtension('toolConfirmation', {
      conversationId: currentConversationId,
      configId: currentConfig.id,
      modelOverride: chatStore.pendingModelOverride || undefined,
      toolResponses,
      annotation,
      streamId,
      promptModeId: chatStore.currentPromptModeId
    })
    return true
  } catch (error) {
    console.error('Failed to send tool confirmation:', error)

    // 请求未发出时回滚 stream 绑定，避免阻塞后续有效流
    chatStore.activeStreamId = null
    chatStore.isWaitingForResponse = false
    return false
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

  // 流式状态：如果 args 有数据（partialArgs 已成功解析），仍尝试用 formatter
  // 否则显示 "正在生成参数..."
  if (tool.status === 'streaming') {
    const hasArgs = tool.args && Object.keys(tool.args).length > 0
    if (hasArgs && config?.descriptionFormatter) {
      try {
        return config.descriptionFormatter(tool.args)
      } catch {
        // formatter 崩溃时降级显示，避免整个工具块渲染失败
      }
    }
    return t('components.message.tool.streamingArgs')
  }

  if (config?.descriptionFormatter) {
    try {
      return config.descriptionFormatter(tool.args)
    } catch {
      // formatter 崩溃时降级到默认描述
    }
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

function canToggleExpand(tool: ToolUsage): boolean {
  return isExpandable(tool)
}

function shouldShowToolContent(tool: ToolUsage): boolean {
  return isExpandable(tool) && isExpanded(tool.id)
}

function getToolActionContext(): ToolActionContext {
  // 修改原因：工具 action 需要知道当前 conversationId，例如历史 SubAgent 卡片打开 Monitor 时要用它恢复 metadata 子记录。
  // 修改方式：由 ToolMessage 统一从 chatStore 注入上下文，而不是让每个工具 action 自己读取 UI 状态。
  // 修改目的：保持 ToolConfig action 是通用声明，同时避免各工具重复依赖 chatStore。
  return { conversationId: chatStore.currentConversationId }
}

function resolveToolActionText(
  value: ToolActionConfig['label'] | ToolActionConfig['title'] | undefined,
  tool: ToolUsage,
  fallback = ''
): string {
  if (!value) return fallback
  return typeof value === 'function' ? value(tool, getToolActionContext()) : value
}

function getVisibleToolActions(tool: ToolUsage): ToolActionConfig[] {
  const config = getToolConfig(tool.name)
  const actions = config?.actions || []
  const context = getToolActionContext()
  // 修改原因：不同工具 action 的显示条件不同，subagents 在 pending 阶段会用 tool.id 推导 runId。
  // 修改方式：ToolMessage 统一执行 visible 谓词过滤，默认显示未声明 visible 的 action。
  // 修改目的：避免在模板里为具体工具写条件分支，同时让“执行中打开详情”由工具配置自行决定。
  return actions.filter(action => {
    try {
      return action.visible ? action.visible(tool, context) : true
    } catch {
      return false
    }
  })
}

async function runToolAction(action: ToolActionConfig, tool: ToolUsage) {
  try {
    // 修改原因：显眼操作按钮可能打开 VS Code 面板或触发后端 handler，需要统一阻止事件冒泡并处理错误。
    // 修改方式：ToolMessage 调用 action.run，并传入同一份 ToolActionContext。
    // 修改目的：所有工具 action 共用执行入口，避免每个按钮都复制 sendToExtension 错误处理。
    await action.run(tool, getToolActionContext())
  } catch (err) {
    console.error(`Failed to run tool action ${action.id}:`, err)
  }
}

// 获取 diff 警戒值警告（优先使用实时 pending 数据，其次使用工具结果中的兜底数据）
function getDiffGuardWarning(tool: ToolUsage): { warning: string; deletePercent: number } | null {
  const realtime = diffGuardWarnings.value.get(tool.id)
  if (realtime?.warning) {
    return realtime
  }
  const persisted = persistedDiffGuardWarnings.value.get(tool.id)
  if (persisted?.warning) {
    return persisted
  }


  const data = (tool.result as any)?.data
  if (data?.diffGuardWarning) {
    return {
      warning: String(data.diffGuardWarning),
      deletePercent: Number(data.diffGuardDeletePercent ?? 0)
    }
  }
  return null
}

// 获取状态图标
function getStatusIcon(status?: string, awaitingConfirmation?: boolean): string {
  // 向后兼容：awaitingConfirmation 逐步迁移到 status = awaiting_approval
  if (awaitingConfirmation || status === 'awaiting_approval') {
    return 'codicon-shield'
  }

  switch (status) {
    case 'streaming':
      return 'codicon-loading'
    case 'queued':
      return 'codicon-clock'
    case 'executing':
      return 'codicon-loading'
    case 'awaiting_apply':
      return 'codicon-diff'
    case 'success':
      return 'codicon-check'
    case 'warning':
      return 'codicon-warning'
    case 'error':
      return 'codicon-error'
    default:
      return ''
  }
}

// 获取状态类名
function getStatusClass(status?: string, awaitingConfirmation?: boolean): string {
  if (awaitingConfirmation || status === 'awaiting_approval') {
    return 'status-warning'
  }

  switch (status) {
    case 'success':
      return 'status-success'
    case 'error':
      return 'status-error'
    case 'warning':
      return 'status-warning'
    case 'executing':
    case 'streaming':
      return 'status-running'
    case 'queued':
    case 'awaiting_apply':
      return 'status-pending'
    default:
      return ''
  }
}

// --- 流式预览 ---

// 判断是否应显示流式参数预览
function shouldShowStreamingPreview(tool: ToolUsage): boolean {
  return tool.status === 'streaming' && !!tool.partialArgs && tool.partialArgs.length > 0
}

// 流式预览元素引用（用于自动滚动到底部）
const streamingPreviewRefs = new Map<string, HTMLElement>()

function setStreamingPreviewRef(toolId: string) {
  return (ref: Element | ComponentPublicInstance | null) => {
    if (ref && ref instanceof HTMLElement) {
      streamingPreviewRefs.set(toolId, ref)
    } else {
      streamingPreviewRefs.delete(toolId)
    }
  }
}

// 监听 partialArgs 变化，自动滚动流式预览到底部
watch(
  () => props.tools.map(t => t.partialArgs?.length ?? 0),
  () => {
    nextTick(() => {
      for (const tool of enhancedTools.value) {
        if (shouldShowStreamingPreview(tool)) {
          const el = streamingPreviewRefs.get(tool.id)
          if (el) {
            el.scrollTop = el.scrollHeight
          }
        }
      }
    })
  },
  { deep: true }
)

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
      toolId: tool.id,
      toolName: tool.name,
      messageBackendIndex: props.messageBackendIndex,
      pendingDiffs: getPendingDiffSessions(tool),
      diffActionController: {
        autoSaveEnabled: globalApplyDiffConfig.value.autoSave,
        getTimeLeft: (sessionId: string) => applyDiffTimeLeft.value.get(sessionId) || 0,
        getProgress: (sessionId: string) => applyDiffProgress.value.get(sessionId) || 0,
        isProcessing: (sessionId: string) => processingDiffSessionIds.value.has(sessionId),
        getError: (sessionId: string) => getDiffActionError(sessionId),
        confirm: (sessionId: string) => confirmDiff(sessionId),
        reject: (sessionId: string) => rejectDiff(sessionId)
      }
    })
  }
  
  // 如果有内容格式化器，使用格式化器
  if (config?.contentFormatter) {
    const content = config.contentFormatter(tool.args, tool.result)
    const children: any[] = []

    if (content) {
      children.push(h('div', { class: 'tool-content-text' }, content))
    }

    if (tool.error) {
      children.push(
        h('div', { class: 'content-section error-section' }, [
          h('div', { class: 'section-label' }, t('components.message.tool.error') + ':'),
          h('div', { class: 'error-message' }, tool.error)
        ])
      )
    }

    if (children.length === 0) {
      return h('div', { class: 'tool-content-text' }, '')
    }

    return h('div', { class: 'tool-content-default' }, children)
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
        :class="['tool-header', { 'not-expandable': !canToggleExpand(tool) }]"
        @click="canToggleExpand(tool) && toggleExpand(tool.id)"
      >
        <div class="tool-info">
          <!-- 展开/收起图标（仅当可展开时显示） -->
          <span
            v-if="canToggleExpand(tool)"
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
            <!-- 确认按钮：当工具等待用户批准时显示 -->
            <button
              v-if="tool.status === 'awaiting_approval' && !processingToolIds.has(tool.id)"
              class="confirm-btn"
              :title="t('components.message.tool.confirmExecution')"
              :disabled="processingToolIds.has(tool.id)"
              @click.stop="confirmToolExecution(tool.id, tool.name)"
            >
              <span class="confirm-btn-icon codicon codicon-check"></span>
              <span class="confirm-btn-text">{{ t('components.message.tool.confirm') }}</span>
            </button>
            
            <!-- 拒绝按钮：当工具等待用户批准时显示 -->
            <button
              v-if="tool.status === 'awaiting_approval' && !processingToolIds.has(tool.id)"
              class="reject-btn"
              :title="t('components.message.tool.reject')"
              :disabled="processingToolIds.has(tool.id)"
              @click.stop="rejectToolExecution(tool.id, tool.name)"
            >
              <span class="reject-btn-icon codicon codicon-close"></span>
              <span class="reject-btn-text">{{ t('components.message.tool.reject') }}</span>
            </button>
            
            <!-- 通用工具显眼操作按钮 -->
            <button
              v-for="action in getVisibleToolActions(tool)"
              :key="action.id"
              class="tool-action-btn"
              :class="action.variant ? `tool-action-${action.variant}` : ''"
              :title="resolveToolActionText(action.title, tool, resolveToolActionText(action.label, tool))"
              @click.stop="runToolAction(action, tool)"
            >
              <span v-if="action.icon" :class="['tool-action-icon', 'codicon', action.icon]"></span>
              <span class="tool-action-text">{{ resolveToolActionText(action.label, tool) }}</span>
              <span class="tool-action-arrow codicon codicon-arrow-right"></span>
            </button>

          </div>
        </div>
      </div>

      <!-- 流式参数预览 - streaming 状态时自动显示 -->
      <div
        v-if="shouldShowStreamingPreview(tool)"
        class="streaming-preview"
        :ref="setStreamingPreviewRef(tool.id)"
      >
        <pre class="streaming-preview-content">{{ tool.partialArgs }}</pre>
      </div>

      <!-- 工具详细内容 - 展开时显示（仅当可展开时） -->
      <div v-if="shouldShowToolContent(tool)" class="tool-content">
        <component :is="() => renderToolContent(tool)" />
      </div>

      <!-- Diff 警戒值警告（pending 或已结束都可展示） -->
      <div v-if="getDiffGuardWarning(tool)" class="diff-guard-warning">
        <i class="codicon codicon-warning"></i>
        <span class="diff-guard-text">
          {{ getDiffGuardWarning(tool)!.warning }}
        </span>
      </div>

      <!-- Diff 工具确认操作栏（按独立 pending diff 渲染，不随展开面板隐藏） -->
      <div v-if="getPendingDiffSessions(tool).length > 0" class="diff-action-list">
        <div v-for="pendingDiff in getPendingDiffSessions(tool)" :key="pendingDiff.id" class="diff-action-footer">
          <div class="diff-action-file">
            <span class="codicon codicon-file-code"></span>
            <span class="diff-action-file-path">{{ pendingDiff.filePath }}</span>
          </div>
          <div class="footer-top" v-if="globalApplyDiffConfig.autoSave">
            <div class="timer-container">
              <div class="timer-bar" :style="{ width: (applyDiffProgress.get(pendingDiff.id) || 0) + '%' }"></div>
            </div>
            <span class="timer-text">{{ ((applyDiffTimeLeft.get(pendingDiff.id) || 0) / 1000).toFixed(1) }}s</span>
          </div>
          <div class="footer-buttons">
            <button
              class="confirm-btn-primary"
              :disabled="processingDiffSessionIds.has(pendingDiff.id)"
              @click.stop="confirmDiff(pendingDiff.id)"
            >
              <span class="codicon codicon-check"></span>
              {{ t('common.save') }}
            </button>
            <button
              class="reject-btn-secondary"
              :disabled="processingDiffSessionIds.has(pendingDiff.id)"
              @click.stop="rejectDiff(pendingDiff.id)"
            >
              <span class="codicon codicon-close"></span>
              {{ t('components.message.tool.reject') }}
            </button>
          </div>
          <div v-if="processingDiffSessionIds.has(pendingDiff.id)" class="diff-action-state">
            <span class="codicon codicon-loading codicon-modifier-spin"></span>
            <span>{{ t('tools.executing') }}</span>
          </div>
          <div v-else-if="getDiffActionError(pendingDiff.id)" class="diff-action-error">
            <span class="codicon codicon-error"></span>
            <span>{{ getDiffActionError(pendingDiff.id) }}</span>
          </div>
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
  /* 修改原因：通用 action 按钮放在描述行右侧，flex-start 会让 Open details 贴到描述顶部而不是上下居中。
     修改方式：把交叉轴对齐改为 center，保留旧描述行结构和右侧按钮位置。
     修改目的：让 pending 与完成态的详情按钮都与描述文本纵向居中，同时不破坏旧 Diff 预览按钮布局。 */
  align-items: center;
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

.confirm-btn:disabled {
  opacity: 0.6;
  cursor: default;
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

.reject-btn:disabled {
  opacity: 0.6;
  cursor: default;
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

/* 修改原因：Open details 和 View Diff 是同一层级的工具头部显眼操作，不能再使用展开区的新按钮样式。
   修改方式：通用 action 按钮完整沿用旧 Diff 预览按钮的灰白描边、尺寸和 hover 反馈。
   修改目的：恢复修改前老按钮的视觉体系，并让新增的 SubAgent 详情入口与现有工具操作一致。 */
.tool-action-btn {
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
  line-height: 1;
  cursor: pointer;
  transition: all 0.12s ease;
  flex-shrink: 0;
}

.tool-action-btn:hover {
  background: rgba(128, 128, 128, 0.1);
  border-color: #777777;
}

.tool-action-btn:active {
  background: rgba(128, 128, 128, 0.2);
}

.tool-action-danger {
  border-color: var(--vscode-errorForeground);
  color: var(--vscode-errorForeground);
}

.tool-action-icon {
  font-size: 12px;
  opacity: 0.85;
}

.tool-action-text {
  white-space: nowrap;
}

.tool-action-arrow {
  font-size: 10px;
  opacity: 0.5;
  transition: transform 0.12s ease, opacity 0.12s ease;
}

.tool-action-btn:hover .tool-action-arrow {
  transform: translateX(2px);
  opacity: 0.8;
}

/* 流式参数预览 */
.streaming-preview {
  max-height: 150px;
  overflow-y: auto;
  border-top: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-inactiveSelectionBackground);
  padding: 4px var(--spacing-sm, 8px);
}

.streaming-preview-content {
  margin: 0;
  font-size: 11px;
  font-family: var(--vscode-editor-font-family);
  color: var(--vscode-foreground);
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.4;
  opacity: 0.85;
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
.diff-action-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.diff-action-footer {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  background: var(--vscode-editor-inactiveSelectionBackground);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 2px;
}

.diff-action-file {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.diff-action-file .codicon {
  color: var(--vscode-charts-blue);
}

.diff-action-file-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.footer-buttons button:disabled {
  opacity: 0.65;
  cursor: default;
}

.diff-action-state {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.diff-action-error {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 2px;
  background: var(--vscode-inputValidation-errorBackground);
  border: 1px solid var(--vscode-inputValidation-errorBorder);
  color: var(--vscode-inputValidation-errorForeground);
  font-size: 11px;
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

/* Diff 警戒值警告 */
.diff-guard-warning {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 10px;
  background: var(--vscode-inputValidation-warningBackground, rgba(255, 170, 0, 0.1));
  border: 1px solid var(--vscode-inputValidation-warningBorder, #ffaa00);
  border-radius: 4px;
  margin-bottom: 4px;
}

.diff-guard-warning .codicon {
  font-size: 13px;
  color: var(--vscode-editorWarning-foreground, #ffaa00);
  flex-shrink: 0;
  margin-top: 1px;
}

.diff-guard-text {
  font-size: 11px;
  line-height: 1.4;
  color: var(--vscode-foreground);
  word-break: break-word;
}
</style>
