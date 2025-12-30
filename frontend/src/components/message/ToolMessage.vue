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

import { ref, computed, Component, h, watchEffect, watch, onMounted, onBeforeUnmount } from 'vue'
import type { ToolUsage, Message } from '../../types'
import { getToolConfig } from '../../utils/toolRegistry'
import { ensureMcpToolRegistered } from '../../utils/tools'
import { useChatStore } from '../../stores'
import { sendToExtension, acceptDiff, rejectDiff, getPendingDiffs, onMessageFromExtension } from '../../utils/vscode'
import { useI18n } from '../../i18n'
import { generateId } from '../../utils/format'

const { t } = useI18n()

const props = defineProps<{
  tools: ToolUsage[]
}>()

const chatStore = useChatStore()

// 从 store 解构响应式状态，确保在函数中使用时能正确追踪依赖
const { isDiffProcessingStarted } = chatStore

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
      let status: 'success' | 'error' | 'warning' | 'pending' = success ? 'success' : 'error'
      const data = (response as any).data
      if (success && data && data.appliedCount > 0 && data.failedCount > 0) {
        status = 'warning'
      }

      // 关键修复：如果工具需要确认，保持 pending 状态
      // 同时检查 pendingDiffMap 和 chatStore.pendingDiffToolIds（后者作为回退）
      // 【重要】用户已开始处理 diff 时，不再将状态设为 pending
      if ((tool.name === 'apply_diff' || tool.name === 'write_file') && status !== 'error' && !isDiffProcessingStarted) {
        let hasPending = false

        // 检查 pendingDiffMap（轮询获取）
        const paths = getToolFilePaths(tool)
        for (const path of paths) {
          if (pendingDiffMap.value.has(path)) {
            hasPending = true
            break
          }
        }

        // 回退：检查后端的 pendingDiffToolIds（解决轮询返回空但后端确实有 pending 的情况）
        if (!hasPending && chatStore.pendingDiffToolIds.includes(tool.id)) {
          hasPending = true
        }

        if (hasPending) {
          status = 'pending'
        }
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

// ========== apply_diff 保存/拒绝按钮相关 ==========

// 轮询获取的 pending diff 映射：filePath -> diffId
const pendingDiffMap = ref<Map<string, string>>(new Map())

// 轮询定时器
let diffPollTimer: ReturnType<typeof setInterval> | null = null

// 已处理的 diff 工具：toolId -> 'accept' | 'reject'
const processedDiffTools = ref<Map<string, 'accept' | 'reject'>>(new Map())

// diff 操作加载状态
const diffLoadingIds = ref<Set<string>>(new Set())

// 第一个操作的批注（用于最终继续对话）
let firstDiffAnnotation = ''

/**
 * 需要确认的工具 ID 集合（从 store 获取，后端直接告知）
 * 用于 areAllDiffsProcessed 等逻辑判断
 */
const requiredDiffToolIds = computed(() => {
  const ids = chatStore.pendingDiffToolIds
  return new Set(ids)
})

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

/**
 * 检查是否应该显示 diff 操作区域（保存/拒绝按钮）
 *
 * 【重要】此函数与后端 hasFileModificationToolInResults 配合工作
 *
 * 显示条件（满足任一）：
 * 1. 工具已被用户处理（在 processedDiffTools 中）- 显示处理结果
 * 2. 工具 ID 在 requiredDiffToolIds 中（后端直接告知）- 需要用户确认
 * 3. 工具文件路径在 pendingDiffMap 中（轮询获取）- 有待处理的 diff
 * 4. 工具结果中有 pending 状态 - 结果表明需要确认
 *
 * 不显示条件：
 * - 工具状态是 error（diff 应用失败，无需用户确认）
 * - 工具状态是 success 且不在 processedDiffTools 中（说明是历史记录，已处理完毕）
 *
 * 【历史问题 - 两条消息 bug】
 * 之前后端 hasFileModificationToolInResults 只检查工具名称，不检查 pendingDiffId
 * 导致工具执行失败时：
 * - 后端返回 needAnnotation: true（等待用户确认）
 * - 但 pendingDiffToolIds 为空，前端 _createAnnotationMessagesAndSend 被触发
 * - 同时用户可能点击了按钮触发 continueDiffWithAnnotation
 * - 结果：两条 continueWithAnnotation 请求
 *
 * 【当前设计】
 * - 后端只在有 pendingDiffId 时返回 needAnnotation: true
 * - 前端 error 状态不显示按钮
 * - 两端逻辑一致，避免竞态
 *
 * 【历史问题 - 并发 AI 请求 bug】
 * 轮询 pendingDiffMap 可能比后端发送 toolIteration 更快
 * 导致按钮提前显示，用户点击时 isStreaming 仍为 true
 * 解决方案：
 * - 必须等待后端发送 pendingDiffToolIds（通过 requiredDiffToolIds 检查）
 * - 仅依赖轮询显示按钮不够安全，必须结合后端确认
 */
function shouldShowDiffArea(tool: ToolUsage): boolean {
  // 已处理的工具始终显示（显示处理结果）
  if (processedDiffTools.value.has(tool.id)) {
    return true
  }

  // 非文件修改工具不显示
  if (tool.name !== 'apply_diff' && tool.name !== 'write_file') {
    return false
  }

  // 【关键检查】用户已开始处理 diff 时，不显示按钮
  // isDiffProcessingStarted 在用户点击保存/拒绝按钮时立即设置为 true
  // 这解决了时序问题：用户点击按钮后，后端 toolIteration 到达时不应重新显示按钮
  // 注意：从 Pinia store 解构后自动解包，直接访问即可
  if (isDiffProcessingStarted) {
    return false
  }

  // 【关键检查】错误状态的工具不显示按钮
  // diff 应用失败时没有 pending diff 需要确认
  // 后端 hasFileModificationToolInResults 也会返回 false，直接继续 AI 对话
  // 如果这里显示按钮，用户点击后会发送 continueDiffWithAnnotation
  // 同时后端已经在继续对话，导致两条消息
  if (tool.status === 'error') {
    return false
  }

  // 【关键】必须等待后端确认（通过 pendingDiffToolIds）
  // 仅依赖轮询 pendingDiffMap 不安全，可能导致按钮提前显示
  // 用户点击时后端还没发送 toolIteration，isStreaming 仍为 true，导致并发请求
  // 检查工具 ID 是否在后端告知的待确认列表中
  if (requiredDiffToolIds.value.has(tool.id)) {
    return true
  }

  // 如果工具状态已经是 success 且不在待确认列表中，说明是历史记录或已完成的工具
  // 不应该显示按钮（避免重新进入会话时显示已完成工具的按钮）
  if (tool.status === 'success') {
    return false
  }

  // 检查文件路径是否在 pendingDiffMap 中
  const paths = getToolFilePaths(tool)
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

  // 也检查 result 中的 pendingDiffId（单文件工具如 apply_diff）
  const resultData = (tool.result as any)?.data
  if (resultData?.pendingDiffId && !diffIds.includes(resultData.pendingDiffId)) {
    diffIds.push(resultData.pendingDiffId)
  }

  // 对于 write_file，检查 results 数组中每个文件的 pendingDiffId
  if (tool.name === 'write_file' && resultData?.results) {
    for (const r of resultData.results) {
      if (r.pendingDiffId && !diffIds.includes(r.pendingDiffId)) {
        diffIds.push(r.pendingDiffId)
      }
    }
  }

  return diffIds
}

// 检查 diff 工具是否正在加载
function isDiffLoading(toolId: string): boolean {
  return diffLoadingIds.value.has(toolId)
}

// 检查 diff 工具是否已处理
// 对于多文件工具，需要检查是否还有 pending diff
function isDiffProcessed(tool: ToolUsage): boolean {
  // 如果工具已被标记为已处理
  if (processedDiffTools.value.has(tool.id)) {
    // 对于 write_file 多文件情况，即使已处理也要检查是否还有 pending
    if (tool.name === 'write_file') {
      const diffIds = getDiffIds(tool)
      // 如果还有 pending diff，说明还没处理完
      if (diffIds.length > 0) {
        return false
      }
    }
    return true
  }
  return false
}

// 获取 diff 工具的处理结果
function getDiffDecision(toolId: string): 'accept' | 'reject' | undefined {
  return processedDiffTools.value.get(toolId)
}

/**
 * 检查是否所有 diff 工具都已处理
 *
 * 判断逻辑：
 * 1. 必须有已处理的工具
 * 2. 必须等待后端发送 pendingDiffToolIds（通过 toolIteration 的 needAnnotation）
 * 3. 所有 requiredDiffToolIds 都已处理才返回 true
 *
 * 【关键】必须等待 requiredDiffToolIds 被设置后才能继续
 * 否则用户点击按钮太快（后端还没发送 toolIteration），会导致：
 * - 前端发送 continueWithAnnotation
 * - 后端同时也在处理，发送 toolIteration
 * - 两条并发请求
 */
function areAllDiffsProcessed(): boolean {
  // 必须有已处理的工具
  if (processedDiffTools.value.size === 0) {
    return false
  }

  // 检查是否还有未处理的 pending diff（通过 pendingDiffMap 轮询获取）
  // 如果还有 pending diff，不允许继续
  if (pendingDiffMap.value.size > 0) {
    return false
  }

  // 【关键检查】必须等待后端发送 pendingDiffToolIds
  // 如果 requiredDiffToolIds 为空，说明后端还没发送 toolIteration，必须等待
  // 这解决了用户点击按钮太快导致的两条并发请求问题
  if (requiredDiffToolIds.value.size === 0) {
    return false
  }

  // 后端已发送 pendingDiffToolIds，检查是否都已处理
  for (const id of requiredDiffToolIds.value) {
    if (!processedDiffTools.value.has(id)) {
      return false
    }
  }

  return true
}

/**
 * 检查是否还有未处理的 diff
 */
function hasRemainingDiffs(): boolean {
  // 如果没有已处理的工具，不显示等待提示
  if (processedDiffTools.value.size === 0) return false
  // 如果 pendingDiffMap 还有内容，说明还有未处理的
  return pendingDiffMap.value.size > 0
}

/**
 * 重置组件内 diff 相关状态（在继续对话后调用）
 * 注意：requiredDiffToolIds 由 store 管理，会在 continueDiffWithAnnotation 中清除
 */
function resetDiffState(): void {
  processedDiffTools.value = new Map()
  firstDiffAnnotation = ''
}

// 是否正在发送继续对话请求（防止重复发送）
let isSendingContinue = false

/**
 * 监听 requiredDiffToolIds 变化
 * 当后端发送 pendingDiffToolIds 后，如果用户已经处理完所有 diff，自动触发继续对话
 * 这解决了用户先点击保存/CTRL+S，后端后发送 toolIteration 的时序问题
 *
 * 注意：后端在 StreamAccumulator 中统一生成工具 ID，
 * 前端工具 ID 与后端 pendingDiffToolIds 应该一致，无需路径匹配
 */
watch(requiredDiffToolIds, (newIds) => {
  if (newIds.size > 0 && processedDiffTools.value.size > 0) {
    checkAndContinueConversation()
  }
})

/**
 * 标记工具为已接受，并检查是否需要继续对话
 * 这是核心状态更新逻辑，被按钮点击和 CTRL+S 保存共用
 */
async function markDiffAsAccepted(tool: ToolUsage): Promise<void> {
  // 清除 pending 状态
  const paths = getToolFilePaths(tool)
  for (const path of paths) {
    pendingDiffMap.value.delete(path)
  }

  // 记录已处理
  // 注意：后端在 StreamAccumulator 中统一生成工具 ID，
  // 前端工具 ID 与后端 pendingDiffToolIds 应该一致，无需路径匹配
  processedDiffTools.value.set(tool.id, 'accept')
  processedDiffTools.value = new Map(processedDiffTools.value)

  // 检查是否所有 diff 工具都已处理，是则继续对话
  await checkAndContinueConversation()
}

/**
 * 检查是否所有 diff 都已处理，是则继续对话
 */
async function checkAndContinueConversation(): Promise<void> {
  if (!areAllDiffsProcessed()) return
  if (isSendingContinue) return

  isSendingContinue = true
  const annotationToSend = firstDiffAnnotation
  resetDiffState()

  try {
    await chatStore.continueDiffWithAnnotation(annotationToSend)
  } catch (err) {
    console.error('continueDiffWithAnnotation failed:', err)
  } finally {
    isSendingContinue = false
  }
}

// 保存 diff（点击按钮触发）
async function handleAcceptDiff(tool: ToolUsage) {
  const diffIds = getDiffIds(tool)
  // 即使 diffIds 为空，如果工具在 requiredDiffToolIds 中，仍需要处理
  // 否则会导致批注丢失和对话无法继续
  if (diffIds.length === 0 && !requiredDiffToolIds.value.has(tool.id)) {
    return
  }
  if (diffLoadingIds.value.has(tool.id)) {
    return
  }
  // 使用 isDiffProcessed 检查，支持多文件工具的重复处理
  if (isDiffProcessed(tool)) {
    return
  }

  // 【关键】立即标记用户已开始处理 diff
  // 这会阻止后端发送的 toolIteration 重新设置 pendingDiffToolIds
  // 从而避免按钮重新显示的问题
  chatStore.markDiffProcessingStarted()

  diffLoadingIds.value.add(tool.id)
  try {
    // 第一个操作携带批注
    const isFirst = diffLoadingIds.value.size === 1 && processedDiffTools.value.size === 0
    const annotation = isFirst ? chatStore.inputValue.trim() : ''

    if (isFirst && annotation) {
      chatStore.setInputValue('')
      // 即使没有 diffId 可调用，也要保存批注以便后续发送
      firstDiffAnnotation = annotation
    }

    // 调用后端 API 执行保存（如果有 diffId）
    let isFirstDiff = true
    for (const diffId of diffIds) {
      const result = await acceptDiff(diffId, isFirstDiff ? annotation : undefined)
      if (isFirst && isFirstDiff && result.fullAnnotation) {
        firstDiffAnnotation = result.fullAnnotation
      }
      isFirstDiff = false
    }

    // 更新状态并检查是否继续对话
    await markDiffAsAccepted(tool)
  } finally {
    diffLoadingIds.value.delete(tool.id)
  }
}

/**
 * 标记工具为已拒绝，并检查是否需要继续对话
 */
async function markDiffAsRejected(tool: ToolUsage): Promise<void> {
  const paths = getToolFilePaths(tool)
  for (const path of paths) {
    pendingDiffMap.value.delete(path)
  }

  // 记录已处理
  // 注意：后端在 StreamAccumulator 中统一生成工具 ID，
  // 前端工具 ID 与后端 pendingDiffToolIds 应该一致，无需路径匹配
  processedDiffTools.value.set(tool.id, 'reject')
  processedDiffTools.value = new Map(processedDiffTools.value)

  await checkAndContinueConversation()
}

// 拒绝 diff（点击按钮触发）
async function handleRejectDiff(tool: ToolUsage) {
  const diffIds = getDiffIds(tool)
  // 即使 diffIds 为空，如果工具在 requiredDiffToolIds 中，仍需要处理
  // 否则会导致批注丢失和对话无法继续
  if (diffIds.length === 0 && !requiredDiffToolIds.value.has(tool.id)) {
    return
  }
  if (diffLoadingIds.value.has(tool.id)) {
    return
  }
  // 使用 isDiffProcessed 检查，支持多文件工具的重复处理
  if (isDiffProcessed(tool)) {
    return
  }

  // 【关键】立即标记用户已开始处理 diff
  // 这会阻止后端发送的 toolIteration 重新设置 pendingDiffToolIds
  // 从而避免按钮重新显示的问题
  chatStore.markDiffProcessingStarted()

  diffLoadingIds.value.add(tool.id)
  try {
    // 第一个操作携带批注（与 handleAcceptDiff 逻辑一致）
    const isFirst = diffLoadingIds.value.size === 1 && processedDiffTools.value.size === 0
    const annotation = isFirst ? chatStore.inputValue.trim() : ''

    if (isFirst && annotation) {
      chatStore.setInputValue('')
      // 即使没有 diffId 可调用，也要保存批注以便后续发送
      firstDiffAnnotation = annotation
    }

    // 调用后端 API 执行拒绝（如果有 diffId）
    let isFirstDiff = true
    for (const diffId of diffIds) {
      const result = await rejectDiff(diffId, isFirstDiff ? annotation : undefined)
      if (isFirst && isFirstDiff && result.fullAnnotation) {
        firstDiffAnnotation = result.fullAnnotation
      }
      isFirstDiff = false
    }

    // 更新状态并检查是否继续对话
    await markDiffAsRejected(tool)
  } finally {
    diffLoadingIds.value.delete(tool.id)
  }
}

// 检查是否需要轮询 pending diffs
// 当有工具正在执行，或工具执行完成但有未处理的 pending diff 时，需要轮询
function shouldPollDiffs(): boolean {
  // 【关键】用户已开始处理 diff 时，停止轮询
  // 防止轮询返回的数据覆盖用户操作，导致按钮重新出现
  if (isDiffProcessingStarted) {
    return false
  }

  // 如果所有 diff 都已处理完成，停止轮询
  if (processedDiffTools.value.size > 0 && areAllDiffsProcessed()) {
    return false
  }

  // 如果后端告知有待确认的 diff 工具，且尚未全部处理，则需要轮询
  if (requiredDiffToolIds.value.size > 0) {
    for (const id of requiredDiffToolIds.value) {
      if (!processedDiffTools.value.has(id)) {
        return true
      }
    }
  }

  return enhancedTools.value.some(tool => {
    if (tool.name !== 'apply_diff' && tool.name !== 'write_file') return false

    // 工具正在执行中
    if (tool.status === 'running' || tool.status === 'pending') return true

    // 工具执行完成但有 pending diff（尚未被用户处理）
    // 这种情况下也需要轮询，以便 pendingDiffMap 能获取到最新数据
    if (!processedDiffTools.value.has(tool.id)) {
      const resultData = (tool.result as any)?.data
      if (resultData?.status === 'pending' && resultData?.pendingDiffId) {
        return true
      }
      // 对于 write_file，检查 results 中是否有 pending
      if (tool.name === 'write_file' && resultData?.results) {
        for (const r of resultData.results) {
          if (r.status === 'pending') {
            return true
          }
        }
      }
    }

    return false
  })
}

// 开始轮询 pending diffs
async function startDiffPolling() {
  if (diffPollTimer) return

  const checkPending = async () => {
    // 使用统一的条件检查
    if (!shouldPollDiffs()) {
      stopDiffPolling()
      return
    }

    try {
      const diffs = await getPendingDiffs()
      const newMap = new Map<string, string>()
      for (const diff of diffs) {
        newMap.set(diff.filePath, diff.id)
      }
      pendingDiffMap.value = newMap
    } catch (err) {
      console.error('Failed to poll pending diffs:', err)
    }
  }

  await checkPending()
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
  if (shouldPollDiffs()) {
    startDiffPolling()
  }
})

// 监听后端的手动保存通知（用户 CTRL+S 保存时）
// 直接调用状态更新逻辑，无需再调用后端 API（文件已保存）
let manualSaveUnsubscribe: (() => void) | null = null

onMounted(() => {
  manualSaveUnsubscribe = onMessageFromExtension((message) => {
    if (message.type === 'diffManualSaved') {
      const { filePath } = message.data as { diffId: string; filePath: string; absolutePath: string }
      // 根据 filePath 找到对应的工具
      const tool = enhancedTools.value.find(t => {
        if (t.name !== 'apply_diff' && t.name !== 'write_file') return false
        const paths = getToolFilePaths(t)
        return paths.includes(filePath)
      })

      if (tool && !processedDiffTools.value.has(tool.id)) {
        // 【关键】立即标记用户已开始处理 diff
        chatStore.markDiffProcessingStarted()
        // 直接更新状态，无需调用 API（后端 saveListener 已确认文件已保存）
        markDiffAsAccepted(tool)
      }
    }
  })
})

// 组件卸载时停止轮询和取消监听
onBeforeUnmount(() => {
  stopDiffPolling()
  if (manualSaveUnsubscribe) {
    manualSaveUnsubscribe()
    manualSaveUnsubscribe = null
  }
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

// 保存用于工具确认的批注（在提交决定时捕获）
let toolConfirmationAnnotation = ''

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

  // 捕获当前输入框中的批注（在发送前保存）
  // 注意：这里只发送批注到后端，不清空输入框也不显示消息
  // 因为我们不知道后端是否会使用批注（如果有 diff 工具需要确认，批注不会被使用）
  // 后端会在响应中通过 annotationUsed 告诉前端是否已使用批注
  // 前端根据这个标志在 chatStore.handleStreamChunk 中决定是否清空输入框和显示消息
  toolConfirmationAnnotation = chatStore.inputValue.trim()

  // 清空用户决定状态
  userDecisions.value.clear()

  // 发送到后端（带批注）
  await sendToolConfirmation(toolResponses, toolConfirmationAnnotation)

  // 重置批注
  toolConfirmationAnnotation = ''
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
      <div v-if="shouldShowDiffArea(tool)" class="diff-action-footer">
        <!-- 未处理状态：显示保存/拒绝按钮 -->
        <!-- 关键：模板中直接检查 isDiffProcessingStarted 确保响应式更新，防止按钮重新显示 -->
        <template v-if="!isDiffProcessed(tool) && !isDiffProcessingStarted">
          <button
            class="diff-action-btn accept"
            :disabled="isDiffLoading(tool.id)"
            @click.stop="handleAcceptDiff(tool)"
          >
            <span v-if="isDiffLoading(tool.id)" class="codicon codicon-loading codicon-modifier-spin"></span>
            <span v-else class="codicon codicon-check"></span>
            <span class="btn-text">{{ t('components.tools.file.applyDiffPanel.save') }}</span>
          </button>
          <button
            class="diff-action-btn reject"
            :disabled="isDiffLoading(tool.id)"
            @click.stop="handleRejectDiff(tool)"
          >
            <span v-if="isDiffLoading(tool.id)" class="codicon codicon-loading codicon-modifier-spin"></span>
            <span v-else class="codicon codicon-close"></span>
            <span class="btn-text">{{ t('components.tools.file.applyDiffPanel.reject') }}</span>
          </button>
        </template>
        <!-- 已处理状态：显示决定标记 + 等待提示 -->
        <template v-else>
          <span
            v-if="getDiffDecision(tool.id) === 'accept'"
            class="diff-decision-badge diff-accepted"
          >
            <span class="codicon codicon-check"></span>
            <span class="decision-text">{{ t('components.tools.file.applyDiffPanel.saved') }}</span>
          </span>
          <span
            v-else
            class="diff-decision-badge diff-rejected"
          >
            <span class="codicon codicon-close"></span>
            <span class="decision-text">{{ t('components.tools.file.applyDiffPanel.rejected') }}</span>
          </span>
          <!-- 等待其他 diff 工具完成的提示 -->
          <span v-if="hasRemainingDiffs()" class="diff-waiting-hint">
            <span class="codicon codicon-loading codicon-modifier-spin"></span>
            <span class="hint-text">{{ t('components.tools.file.applyDiffPanel.waitingOthers') }}</span>
          </span>
        </template>
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

/* diff 已处理状态标记 */
.diff-decision-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border-radius: 2px;
  font-size: 11px;
  font-weight: 500;
  flex-shrink: 0;
}

.diff-accepted {
  background: rgba(40, 167, 69, 0.15);
  color: var(--vscode-testing-iconPassed);
  border: 1px solid rgba(40, 167, 69, 0.3);
}

.diff-rejected {
  background: rgba(220, 53, 69, 0.15);
  color: var(--vscode-testing-iconFailed);
  border: 1px solid rgba(220, 53, 69, 0.3);
}

/* 等待其他 diff 工具完成的提示 */
.diff-waiting-hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  margin-left: auto;
}

.diff-waiting-hint .hint-text {
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