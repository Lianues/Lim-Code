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
import { storeToRefs } from 'pinia'
import type { ToolUsage } from '../../types'
import { getToolConfig } from '../../utils/toolRegistry'
import { ensureMcpToolRegistered } from '../../utils/tools'
import { useChatStore } from '../../stores'
import { sendToExtension, acceptDiff, rejectDiff, getPendingDiffs, onMessageFromExtension } from '../../utils/vscode'
import { useI18n } from '../../i18n'

const { t } = useI18n()

const props = defineProps<{
  tools: ToolUsage[]
}>()

const chatStore = useChatStore()

// 从 store 解构响应式状态（必须使用 storeToRefs 保持响应性）
const {
  processedDiffTools,
  isSendingDiffContinue
} = storeToRefs(chatStore)

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

      // 如果工具需要确认，保持 pending 状态
      // 已处理的工具跳过检查（防止状态回退到 pending）
      if ((tool.name === 'apply_diff' || tool.name === 'write_file') && status !== 'error') {
        const isAlreadyProcessed = processedDiffTools.value.has(tool.id)
        
        // 【修复】检查用户是否正在操作这个工具（已点击保存/拒绝按钮，等待后端响应）
        // 在此期间不应将状态设为 pending
        const isUserProcessing = diffLoadingIds.value.has(tool.id)

        // 【关键修复】判断对话是否已完成：
        // - 不在等待响应状态
        // - 工具 ID 不在后端告知的待确认列表中
        // 当对话完成后，即使工具结果中有 pendingDiffId，也不应将状态设为 pending
        // 这解决了 complete 时 processedDiffTools 被清空后 UI 状态回退的问题
        const isConversationComplete = !chatStore.isWaitingForResponse && 
                                        !chatStore.pendingDiffToolIds.includes(tool.id)

        if (!isAlreadyProcessed && !isUserProcessing && !isConversationComplete) {
          let hasPending = false

          // 检查 pendingDiffMap（轮询获取）
          const paths = getToolFilePaths(tool)
          for (const path of paths) {
            if (pendingDiffMap.value.has(path)) {
              hasPending = true
              break
            }
          }

          // 回退 1：检查后端的 pendingDiffToolIds（解决轮询返回空但后端确实有 pending 的情况）
          if (!hasPending && chatStore.pendingDiffToolIds.includes(tool.id)) {
            hasPending = true
          }

          // 回退 2：检查工具结果中的 pendingDiffId
          // 【关键修复】如果轮询还没开始或后端还没发送 pendingDiffToolIds，
          // 但工具结果中有 pendingDiffId，说明有待确认的 diff
          if (!hasPending) {
            const resultData = (response as any)?.data
            if (resultData?.pendingDiffId) {
              hasPending = true
            }
            // 对于 write_file，检查 results 中的 pendingDiffId
            if (!hasPending && tool.name === 'write_file' && resultData?.results) {
              for (const r of resultData.results) {
                if (r.pendingDiffId) {
                  hasPending = true
                  break
                }
              }
            }
          }

          if (hasPending) {
            status = 'pending'
          }
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

// 已处理的 diff 工具状态已移至 store 级别管理
// 解决多组件实例状态不同步问题

// diff 操作加载状态
const diffLoadingIds = ref<Set<string>>(new Set())

// 已处理的 diffId 集合（用于过滤 getDiffIds 返回的结果）
// 因为 resultData.results[].pendingDiffId 是固定的，不会因保存/拒绝而变化
const handledDiffIds = ref<Set<string>>(new Set())

// 已处理的文件路径集合（用于判断 write_file 多文件是否全部处理完）
// 因为后端是顺序创建 pending diff，不能依赖 getDiffIds 来判断
const handledFilePaths = ref<Set<string>>(new Set())

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
 * 显示条件：
 * 1. 工具已被用户处理（显示处理结果）
 * 2. 工具 ID 在 requiredDiffToolIds 中（后端告知需要确认）
 * 3. 工具结果中有 pendingDiffId 且正在等待确认
 *
 * 不显示条件：
 * - 工具状态是 error（diff 应用失败）
 * - 工具状态是 success 且不在待确认列表中（历史记录或已完成）
 * - 用户正在处理（diffLoadingIds 中）
 */
function shouldShowDiffArea(tool: ToolUsage): boolean {
  // 已处理的工具始终显示（显示处理结果）
  if (processedDiffTools.value.has(tool.id)) {
    return true
  }
  
  // 用户正在处理，显示按钮区域（会显示 loading 状态）
  if (diffLoadingIds.value.has(tool.id)) {
    return true
  }

  // 非文件修改工具不显示
  if (tool.name !== 'apply_diff' && tool.name !== 'write_file') {
    return false
  }

  // 错误状态不显示按钮
  if (tool.status === 'error') {
    return false
  }

  // 检查工具 ID 是否在后端告知的待确认列表中
  if (requiredDiffToolIds.value.has(tool.id)) {
    return true
  }

  // success 状态且不在待确认列表中，说明是历史记录或已完成对话
  if (tool.status === 'success') {
    return false
  }
  
  // 【关键修复】如果对话已完成（不在等待响应状态），不显示按钮
  // 这解决了 complete 后 processedDiffTools 被清空导致按钮重新出现的问题
  if (!chatStore.isWaitingForResponse && !chatStore.isStreaming) {
    return false
  }

  // 检查文件路径是否在 pendingDiffMap 中
  const paths = getToolFilePaths(tool)
  for (const path of paths) {
    if (pendingDiffMap.value.has(path)) {
      return true
    }
  }

  // 检查 result 中是否有 pendingDiffId
  const resultData = (tool.result as any)?.data
  if (resultData?.pendingDiffId) {
    return true
  }

  // 对于 write_file，检查 results 中是否有 pendingDiffId
  if (tool.name === 'write_file' && resultData?.results) {
    for (const r of resultData.results) {
      if (r.pendingDiffId) {
        return true
      }
    }
  }

  return false
}

// 获取工具所有未处理的 pending diff IDs
function getDiffIds(tool: ToolUsage): string[] {
  const diffIds: string[] = []
  const paths = getToolFilePaths(tool)

  // 从 pendingDiffMap 获取
  for (const path of paths) {
    const diffId = pendingDiffMap.value.get(path)
    if (diffId && !diffIds.includes(diffId) && !handledDiffIds.value.has(diffId)) {
      diffIds.push(diffId)
    }
  }

  // 也检查 result 中的 pendingDiffId（单文件工具如 apply_diff）
  const resultData = (tool.result as any)?.data
  if (resultData?.pendingDiffId && !diffIds.includes(resultData.pendingDiffId) && !handledDiffIds.value.has(resultData.pendingDiffId)) {
    diffIds.push(resultData.pendingDiffId)
  }

  // 对于 write_file，检查 results 数组中每个文件的 pendingDiffId
  if (tool.name === 'write_file' && resultData?.results) {
    for (const r of resultData.results) {
      if (r.pendingDiffId && !diffIds.includes(r.pendingDiffId) && !handledDiffIds.value.has(r.pendingDiffId)) {
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

// 检查 diff 工具是否已处理（使用 store 方法）
// 注意：一旦用户点击保存/拒绝，就认为工具已处理，不再根据 pendingDiffMap 判断
function isDiffProcessed(tool: ToolUsage): boolean {
  // 使用 store 方法检查
  return chatStore.isDiffToolProcessed(tool.id)
}

// 获取 diff 工具的处理结果（使用 store 方法）
function getDiffDecision(toolId: string): 'accept' | 'reject' | undefined {
  return chatStore.getDiffToolDecision(toolId)
}

/**
 * 检查是否所有 diff 工具都已处理
 *
 * 【重要】此函数已被废弃，改用 store 的 areAllRequiredDiffsProcessed()
 * 保留此函数仅为向后兼容（如果有其他地方调用）
 */
function areAllDiffsProcessed(): boolean {
  return chatStore.areAllRequiredDiffsProcessed()
}

/**
 * 检查是否还有未处理的 diff
 *
 * 【重要】此函数已被废弃，改用 store 的 hasRemainingRequiredDiffs()
 * 保留此函数仅为向后兼容
 */
function hasRemainingDiffs(): boolean {
  return chatStore.hasRemainingRequiredDiffs()
}

/**
 * 重置组件内 diff 相关状态（在继续对话后调用）
 */
function resetDiffState(): void {
  firstDiffAnnotation = ''
}

// 【已移除 watch】
// 原来的 watch(requiredDiffToolIds) 被移除，原因：
// 1. 存在竞态条件：fallback 发请求后，后端返回 pendingDiffToolIds，watch 触发导致重复请求
// 2. watch 的触发时机不可控，容易与用户直接操作（点击按钮）冲突
// 3. 现在统一由 markDiffAsAccepted/markDiffAsRejected 调用 tryToContinueDiff 处理

// 标记工具为已接受，并检查是否需要继续对话
async function markDiffAsAccepted(tool: ToolUsage): Promise<void> {
  const paths = getToolFilePaths(tool)
  for (const path of paths) {
    pendingDiffMap.value.delete(path)
  }
  chatStore.markDiffToolProcessed(tool.id, 'accept')
  await tryToContinueDiff()
}

/**
 * 尝试继续对话（统一入口）
 *
 * 处理两种情况：
 * 1. 后端发送了 pendingDiffToolIds：检查是否全部处理完毕
 * 2. 后端未发送 pendingDiffToolIds（为空）：自己判断是否还有未处理的工具
 *
 * 这是唯一的继续对话触发源，避免了 watch 和直接调用的竞态条件。
 */
async function tryToContinueDiff(): Promise<void> {
  console.log('[ToolMessage] tryToContinueDiff called:', {
    pendingDiffToolIds: chatStore.pendingDiffToolIds,
    processedDiffTools: Array.from(processedDiffTools.value.keys()),
    isSendingDiffContinue: isSendingDiffContinue.value
  })
  
  // 防止重复发送
  if (isSendingDiffContinue.value) {
    console.log('[ToolMessage] tryToContinueDiff: isSendingDiffContinue=true, skip')
    return
  }
  
  // 场景 1：后端发送了 pendingDiffToolIds
  if (chatStore.pendingDiffToolIds.length > 0) {
    console.log('[ToolMessage] tryToContinueDiff: using pendingDiffToolIds logic')
    if (!chatStore.areAllRequiredDiffsProcessed()) {
      console.log('[ToolMessage] tryToContinueDiff: not all required diffs processed, wait')
      return
    }
  } else {
    // 场景 2：pendingDiffToolIds 为空
    // 【关键】如果 pendingDiffToolIds 为空，说明后端的 toolIteration 还没到达
    // 此时不应该发送 continueWithAnnotation，应该等待 toolIteration
    // 因为后端的 handleChatStream 需要先添加 functionResponse 到历史，然后 yield toolIteration
    // 如果我们在 toolIteration 到达之前发送 continueWithAnnotation，历史中会缺少 tool result
    console.log('[ToolMessage] tryToContinueDiff: pendingDiffToolIds is empty, wait for backend toolIteration')
    return
  }
  
  // 所有工具都已处理，继续对话
  console.log('[ToolMessage] tryToContinueDiff: all processed, calling continueDiffWithAnnotation')
  const annotationToSend = firstDiffAnnotation
  resetDiffState()

  try {
    await chatStore.continueDiffWithAnnotation(annotationToSend)
  } catch (err) {
    console.error('continueDiffWithAnnotation failed:', err)
  }
}

// 保存 diff（点击按钮触发）
// 每次只处理一个文件，顺序处理
async function handleAcceptDiff(tool: ToolUsage) {
  const diffIds = getDiffIds(tool)
  const resultData = (tool.result as any)?.data
  console.log('[ToolMessage] handleAcceptDiff ENTRY:', {
    toolId: tool.id,
    toolName: tool.name,
    diffIds,
    handledDiffIds: Array.from(handledDiffIds.value),
    pendingDiffMapEntries: Array.from(pendingDiffMap.value.entries()),
    toolFilePaths: getToolFilePaths(tool),
    resultDataPendingDiffId: resultData?.pendingDiffId,
    resultDataResults: resultData?.results?.map((r: any) => ({ path: r.path, pendingDiffId: r.pendingDiffId }))
  })
  
  if (diffIds.length === 0 && !requiredDiffToolIds.value.has(tool.id)) return
  if (diffLoadingIds.value.has(tool.id)) return
  if (isDiffProcessed(tool)) return

  // 只处理第一个 diffId（顺序处理）
  const currentDiffId = diffIds[0]
  if (!currentDiffId) return

  diffLoadingIds.value.add(tool.id)
  try {
    const isFirst = processedDiffTools.value.size === 0 && !firstDiffAnnotation
    const annotation = isFirst ? chatStore.inputValue.trim() : ''

    if (isFirst && annotation) {
      chatStore.setInputValue('')
      firstDiffAnnotation = annotation
    }

    // 只处理当前这一个 diffId
    const result = await acceptDiff(currentDiffId, annotation || undefined)
    if (isFirst && result.fullAnnotation) {
      firstDiffAnnotation = result.fullAnnotation
    }

    // 标记此 diffId 为已处理
    handledDiffIds.value.add(currentDiffId)

    // 找到并标记对应的文件路径为已处理
    const allPaths = getToolFilePaths(tool)
    let foundPath = false
    
    // 方法1：从 pendingDiffMap 中找
    for (const path of allPaths) {
      const diffId = pendingDiffMap.value.get(path)
      if (diffId === currentDiffId) {
        pendingDiffMap.value.delete(path)
        handledFilePaths.value.add(path)
        foundPath = true
        break
      }
    }
    
    // 方法2：从 resultData.results 中找（用于 write_file 多文件情况）
    if (!foundPath && resultData?.results) {
      for (const r of resultData.results) {
        if (r.pendingDiffId === currentDiffId && r.path) {
          handledFilePaths.value.add(r.path)
          foundPath = true
          break
        }
      }
    }
    
    // 方法3：对于 apply_diff，直接从 tool.args.path 获取
    if (!foundPath && tool.name === 'apply_diff') {
      const argPath = tool.args?.path as string
      if (argPath) {
        handledFilePaths.value.add(argPath)
        foundPath = true
      }
    }

    // 检查是否所有文件都已处理
    // 不能依赖 getDiffIds，因为后端是顺序创建 pending diff 的
    const totalFiles = allPaths.length
    const handledFiles = allPaths.filter(p => handledFilePaths.value.has(p)).length
    console.log('[ToolMessage] handleAcceptDiff after processing:', {
      processedDiffId: currentDiffId,
      totalFiles,
      handledFiles,
      handledFilePaths: Array.from(handledFilePaths.value)
    })
    
    if (handledFiles >= totalFiles) {
      // 所有文件都已处理，标记工具为已处理
      chatStore.markDiffToolProcessed(tool.id, 'accept')
      await tryToContinueDiff()
    }
    // 否则，不标记为已处理，按钮继续显示（等待处理下一个文件）
  } finally {
    diffLoadingIds.value.delete(tool.id)
  }
}

// 标记工具为已拒绝，并检查是否需要继续对话
async function markDiffAsRejected(tool: ToolUsage): Promise<void> {
  const paths = getToolFilePaths(tool)
  for (const path of paths) {
    pendingDiffMap.value.delete(path)
  }
  chatStore.markDiffToolProcessed(tool.id, 'reject')
  await tryToContinueDiff()
}

// 拒绝 diff（点击按钮触发）
// 每次只处理一个文件，顺序处理
async function handleRejectDiff(tool: ToolUsage) {
  const diffIds = getDiffIds(tool)
  console.log('[ToolMessage] handleRejectDiff:', {
    toolId: tool.id,
    toolName: tool.name,
    diffIds,
    pendingDiffMapPaths: Array.from(pendingDiffMap.value.keys()),
    toolFilePaths: getToolFilePaths(tool)
  })
  
  if (diffIds.length === 0 && !requiredDiffToolIds.value.has(tool.id)) return
  if (diffLoadingIds.value.has(tool.id)) return
  if (isDiffProcessed(tool)) return

  // 只处理第一个 diffId（顺序处理）
  const currentDiffId = diffIds[0]
  if (!currentDiffId) return

  diffLoadingIds.value.add(tool.id)
  try {
    const isFirst = processedDiffTools.value.size === 0 && !firstDiffAnnotation
    const annotation = isFirst ? chatStore.inputValue.trim() : ''

    if (isFirst && annotation) {
      chatStore.setInputValue('')
      firstDiffAnnotation = annotation
    }

    // 只处理当前这一个 diffId
    const result = await rejectDiff(currentDiffId, annotation || undefined)
    if (isFirst && result.fullAnnotation) {
      firstDiffAnnotation = result.fullAnnotation
    }

    // 标记此 diffId 为已处理
    handledDiffIds.value.add(currentDiffId)

    // 找到并标记对应的文件路径为已处理
    const allPaths = getToolFilePaths(tool)
    let foundPath = false
    
    // 方法1：从 pendingDiffMap 中找
    for (const path of allPaths) {
      const diffId = pendingDiffMap.value.get(path)
      if (diffId === currentDiffId) {
        pendingDiffMap.value.delete(path)
        handledFilePaths.value.add(path)
        foundPath = true
        break
      }
    }
    
    // 方法2：从 resultData.results 中找（用于 write_file 多文件情况）
    const rejectResultData = (tool.result as any)?.data
    if (!foundPath && rejectResultData?.results) {
      for (const r of rejectResultData.results) {
        if (r.pendingDiffId === currentDiffId && r.path) {
          handledFilePaths.value.add(r.path)
          foundPath = true
          break
        }
      }
    }
    
    // 方法3：对于 apply_diff，直接从 tool.args.path 获取
    if (!foundPath && tool.name === 'apply_diff') {
      const argPath = tool.args?.path as string
      if (argPath) {
        handledFilePaths.value.add(argPath)
        foundPath = true
      }
    }

    // 检查是否所有文件都已处理
    // 不能依赖 getDiffIds，因为后端是顺序创建 pending diff 的
    const totalFiles = allPaths.length
    const handledFiles = allPaths.filter(p => handledFilePaths.value.has(p)).length
    console.log('[ToolMessage] handleRejectDiff after processing:', {
      processedDiffId: currentDiffId,
      totalFiles,
      handledFiles,
      handledFilePaths: Array.from(handledFilePaths.value)
    })
    
    if (handledFiles >= totalFiles) {
      // 所有文件都已处理，标记工具为已处理
      chatStore.markDiffToolProcessed(tool.id, 'reject')
      await tryToContinueDiff()
    }
    // 否则，不标记为已处理，按钮继续显示（等待处理下一个文件）
  } finally {
    diffLoadingIds.value.delete(tool.id)
  }
}

// 检查是否需要轮询 pending diffs
// 当有工具正在执行，或工具执行完成但有未处理的 pending diff 时，需要轮询
function shouldPollDiffs(): boolean {
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

  // 检查是否有未处理的工具需要轮询
  return enhancedTools.value.some(tool => {
    if (tool.name !== 'apply_diff' && tool.name !== 'write_file') return false

    if (processedDiffTools.value.has(tool.id)) return false
    if (tool.status === 'running' || tool.status === 'pending') return true

    // 检查是否有 pendingDiffId
    const resultData = (tool.result as any)?.data
    if (resultData?.pendingDiffId) return true
    if (tool.name === 'write_file' && resultData?.results) {
      for (const r of resultData.results) {
        if (r.pendingDiffId) return true
      }
    }
    return false
  })
}

async function startDiffPolling() {
  if (diffPollTimer) return

  const checkPending = async () => {
    if (!shouldPollDiffs()) {
      stopDiffPolling()
      return
    }

    try {
      const diffs = await getPendingDiffs()

      const newMap = new Map<string, string>()

      // 过滤掉已处理工具的路径
      const processedPaths = new Set<string>()
      for (const tool of enhancedTools.value) {
        if (processedDiffTools.value.has(tool.id)) {
          for (const path of getToolFilePaths(tool)) {
            processedPaths.add(path)
          }
        }
      }

      for (const diff of diffs) {
        if (!processedPaths.has(diff.filePath)) {
          newMap.set(diff.filePath, diff.id)
        }
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
  
  // 优先使用国际化翻译
  const i18nKeyMap: Record<string, string> = {
    'read_file': 'components.tools.file.readFile',
    'write_file': 'components.tools.file.writeFile',
    'delete_file': 'components.tools.file.deleteFile',
    'create_directory': 'components.tools.file.createDirectory',
    'list_files': 'components.tools.file.listFiles',
    'apply_diff': 'components.tools.file.applyDiff',
    'find_files': 'components.tools.search.findFiles',
    'search_in_files': 'components.tools.search.searchInFiles',
    'google_search': 'components.tools.search.googleSearch',
    'execute_command': 'components.tools.terminal.executeCommand',
    'generate_image': 'components.tools.media.generateImage',
    'resize_image': 'components.tools.media.resizeImage',
    'crop_image': 'components.tools.media.cropImage',
    'rotate_image': 'components.tools.media.rotateImage',
    'remove_background': 'components.tools.media.removeBackground'
  }
  
  const key = i18nKeyMap[tool.name]
  if (key) {
    const localized = t(key)
    if (localized && localized !== key) {
      return localized
    }
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

      <!-- apply_diff/write_file 底部操作按钮 -->
      <div v-if="shouldShowDiffArea(tool)" class="diff-action-footer">
        <template v-if="!isDiffProcessed(tool)">
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