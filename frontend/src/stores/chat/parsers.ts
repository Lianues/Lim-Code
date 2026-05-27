/**
 * Chat Store 解析器
 * 
 * 包含工具调用解析和 Content 到 Message 的转换
 */

import type { Message, Content, Attachment, ToolUsage } from '../../types'
import { generateId } from '../../utils/format'

/**
 * 解析 XML 工具调用
 */
export function parseXMLToolCall(xmlContent: string): { name: string; args: Record<string, unknown> } | null {
  try {
    const nameMatch = xmlContent.match(/<name>([\s\S]*?)<\/name>/)
    const argsMatch = xmlContent.match(/<args>([\s\S]*?)<\/args>/)
    
    if (nameMatch && argsMatch) {
      return {
        name: nameMatch[1].trim(),
        args: JSON.parse(argsMatch[1].trim())
      }
    }
  } catch {
    // 解析失败
  }
  return null
}

/**
 * 解析 JSON 工具调用
 */
export function parseJSONToolCall(jsonContent: string): { name: string; args: Record<string, unknown> } | null {
  try {
    const parsed = JSON.parse(jsonContent.trim())
    if (parsed.tool && parsed.parameters) {
      return {
        name: parsed.tool,
        args: parsed.parameters
      }
    }
  } catch {
    // 解析失败
  }
  return null
}

/**
 * 从 MIME 类型获取附件类型
 */
export function getAttachmentTypeFromMime(mimeType: string): 'image' | 'video' | 'audio' | 'document' | 'code' {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.includes('javascript') || mimeType.includes('json') ||
      mimeType.includes('xml') || mimeType.includes('html') ||
      mimeType.includes('css') || mimeType.includes('typescript')) return 'code'
  return 'document'
}

/**
 * 从 MIME 类型获取文件扩展名
 */
export function getExtensionFromMime(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'audio/mp3': '.mp3',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
    'application/pdf': '.pdf',
    'text/plain': '.txt',
    'application/json': '.json'
  }
  return mimeToExt[mimeType] || ''
}

/**
 * 检查 Content 是否只包含 functionResponse（工具执行结果）
 */
export function isOnlyFunctionResponse(content: Content): boolean {
  return content.parts.length > 0 && content.parts.every(p => p.functionResponse !== undefined)
}

type FunctionCallPart = NonNullable<Content['parts'][number]['functionCall']> & {
  itemId?: string
  finalArgs?: boolean
}

function hasNonEmptyArgs(args: unknown): args is Record<string, unknown> {
  return !!(args && typeof args === 'object' && Object.keys(args as Record<string, unknown>).length > 0)
}

function normalizeNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function parseFinalArgs(part: FunctionCallPart): Record<string, unknown> | null {
  if (part.finalArgs !== true || typeof part.partialArgs !== 'string' || !part.partialArgs.trim()) return null
  try {
    const parsed = JSON.parse(part.partialArgs)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function getFunctionCallSnapshotKey(part: FunctionCallPart, ordinal: number): string {
  const itemId = normalizeNonEmptyString(part.itemId)
  if (itemId) return `item:${itemId}`

  const id = normalizeNonEmptyString(part.id)
  if (id) return `id:${id}`

  // 为什么 index 使用 typeof number：OpenAI Responses 的 output_index 可以是 0，不能用 truthy 判断。
  // 怎么改：在快照层把 index=0 当成有效合并键。
  // 目的：防止“参数 0”占位工具在 contentSnapshot 转 Message 时被保留下来。
  if (typeof part.index === 'number') return `index:${part.index}`

  return `ordinal:${ordinal}`
}

function mergeFunctionCallSnapshot(target: FunctionCallPart, incoming: FunctionCallPart): void {
  if (incoming.name && !target.name) target.name = incoming.name
  if (incoming.id) target.id = incoming.id
  if (incoming.itemId && !target.itemId) target.itemId = incoming.itemId
  if (typeof incoming.index === 'number' && typeof target.index !== 'number') target.index = incoming.index

  const parsedFinalArgs = parseFinalArgs(incoming)
  if (parsedFinalArgs) {
    target.args = parsedFinalArgs
    delete target.partialArgs
    return
  }

  if (hasNonEmptyArgs(incoming.args)) {
    target.args = incoming.args
    delete target.partialArgs
    return
  }

  if (typeof incoming.partialArgs === 'string') {
    // 为什么这里不盲目追加：后端快照已经是累积状态，前端只负责选择最新、更完整的片段。
    // 怎么改：用更长的 partialArgs 替换较短的旧片段。
    // 目的：避免快照二次拼接参数，保持 UI 预览和后端累加器一致。
    if (typeof target.partialArgs !== 'string' || incoming.partialArgs.length >= target.partialArgs.length) {
      target.partialArgs = incoming.partialArgs
    }
  }
}

function normalizeFunctionCallParts(parts: Content['parts']): Content['parts'] {
  const normalized: Content['parts'] = []
  const callIndexByKey = new Map<string, number>()
  let functionCallOrdinal = 0

  for (const part of parts) {
    if (!part.functionCall) {
      normalized.push(part)
      continue
    }

    const functionCall = part.functionCall as FunctionCallPart
    const key = getFunctionCallSnapshotKey(functionCall, functionCallOrdinal)
    functionCallOrdinal += 1

    const existingIndex = callIndexByKey.get(key)
    if (existingIndex !== undefined) {
      const existing = normalized[existingIndex].functionCall as FunctionCallPart
      mergeFunctionCallSnapshot(existing, functionCall)
      continue
    }

    const clonedPart = {
      ...part,
      functionCall: { ...functionCall }
    }
    const parsedFinalArgs = parseFinalArgs(clonedPart.functionCall as FunctionCallPart)
    if (parsedFinalArgs) {
      clonedPart.functionCall.args = parsedFinalArgs
      delete (clonedPart.functionCall as FunctionCallPart).partialArgs
    }

    callIndexByKey.set(key, normalized.length)
    normalized.push(clonedPart)
  }

  return normalized
}

function extractToolUsages(parts: Content['parts']): ToolUsage[] {
  const toolUsages: ToolUsage[] = []

  for (const part of parts) {
    if (!part.functionCall) continue

    const functionCall = part.functionCall as FunctionCallPart
    const partialArgs = functionCall.partialArgs
    toolUsages.push({
      id: functionCall.id || generateId(),
      name: functionCall.name,
      args: functionCall.args,
      // 为什么把 itemId/index 带到 ToolUsage：MessageItem 和 ToolMessage 都可能从不同投影读取工具状态。
      // 怎么改：让 tools 数组与 parts 数组共享同一流式合并键。
      // 目的：快照覆盖时能替换占位工具，而不是把最后一个 MCP 工具显示两次。
      itemId: functionCall.itemId,
      index: functionCall.index,
      partialArgs,
      status: typeof partialArgs === 'string' ? 'streaming' : 'queued'
    })
  }

  return toolUsages
}

/**
 * 将 Content 转换为 Message
 */
export function contentToMessage(content: Content, id?: string): Message {
  const normalizedParts = normalizeFunctionCallParts(content.parts)
  const textParts = normalizedParts.filter(p => p.text && !p.thought)
  const text = textParts.map(p => p.text).join('')
  
  // 提取工具调用信息
  const toolUsages = extractToolUsages(normalizedParts)
  
  // 确定消息角色：有工具调用时角色仍为 assistant
  const role = content.role === 'model' ? 'assistant' : 'user'
  
  const msg: Message = {
    id: id || generateId(),
    role,
    content: text,
    timestamp: Date.now(),
    parts: normalizedParts,
    tools: toolUsages.length > 0 ? toolUsages : undefined,
    // 总结消息标记（通常由 contentToMessageEnhanced 处理，这里保持一致）
    isSummary: content.isSummary,
    isAutoSummary: content.isAutoSummary,
    metadata: {
      // 存储模型版本（仅 model 消息有值）
      modelVersion: content.modelVersion,
      // 存储完整的 usageMetadata（仅 model 消息有值）
      usageMetadata: content.usageMetadata,
      // 计时信息（从后端获取）
      thinkingDuration: content.thinkingDuration,
      responseDuration: content.responseDuration,
      streamDuration: content.streamDuration,
      firstChunkTime: content.firstChunkTime,
      chunkCount: content.chunkCount,
      // 保留向后兼容
      thoughtsTokenCount: content.usageMetadata?.thoughtsTokenCount ?? content.thoughtsTokenCount,
      candidatesTokenCount: content.usageMetadata?.candidatesTokenCount ?? content.candidatesTokenCount
    }
  }
  if (typeof content.index === 'number') {
    msg.backendIndex = content.index
  }
  return msg
}

/**
 * 将 Content 转换为 Message（增强版）
 *
 * 现在不再预先匹配工具响应，而是在显示时通过 getToolResponseMessage 获取
 * 同时会从 inlineData 中提取附件信息
 */
export function contentToMessageEnhanced(content: Content, id?: string): Message {
  const normalizedParts = normalizeFunctionCallParts(content.parts)
  const textParts = normalizedParts.filter(p => p.text && !p.thought)
  const text = textParts.map(p => p.text).join('')
  
  // 提取工具调用信息（不预先匹配响应）
  const toolUsages = extractToolUsages(normalizedParts)
  for (const toolUsage of toolUsages) {
    const part = normalizedParts.find(p => {
      const functionCall = p.functionCall as FunctionCallPart | undefined
      // 为什么 itemId 需要先判断存在：undefined === undefined 会让无 itemId 的普通工具误匹配第一条 functionCall。
      // 怎么改：优先按最终 id 匹配，只有 toolUsage.itemId 存在时才用内部流式键兜底。
      // 目的：保留 rejected 状态同步能力，同时不污染普通工具的状态。
      return functionCall?.id === toolUsage.id || (!!toolUsage.itemId && functionCall?.itemId === toolUsage.itemId)
    })
    if (part?.functionCall?.rejected === true) {
      toolUsage.status = 'error'
    }
  }

  // 提取附件信息（从 inlineData）
  const attachments: Attachment[] = []
  
  for (const part of normalizedParts) {
    // 从 inlineData 提取附件
    if (part.inlineData) {
      const attType = getAttachmentTypeFromMime(part.inlineData.mimeType)
      const ext = getExtensionFromMime(part.inlineData.mimeType)
      
      // 优先使用存储的 id 和 name，否则使用默认值
      const inlineData = part.inlineData as { mimeType: string; data: string; id?: string; name?: string }
      const attId = inlineData.id || generateId()
      const attName = inlineData.name || `attachment${ext || ''}`
      
      // 计算大小（Base64 字符串解码后的大约大小）
      const base64Length = part.inlineData.data.length
      const size = Math.floor(base64Length * 0.75)
      
      // 生成缩略图（对于图片，直接使用 data URL）
      let thumbnail: string | undefined
      if (attType === 'image') {
        thumbnail = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
      }
      
      attachments.push({
        id: attId,
        name: attName,
        type: attType,
        size,
        mimeType: part.inlineData.mimeType,
        data: part.inlineData.data,
        thumbnail
      })
    }
  }
  
  const role = content.role === 'model' ? 'assistant' : 'user'
  // 优先使用后端传递的 isFunctionResponse 标志，否则通过 parts 判断
  // 这样可以正确处理包含多模态附件的函数响应消息
  const isFunctionResponse = content.isFunctionResponse === true || isOnlyFunctionResponse(content)
  
  const msg: Message = {
    id: id || generateId(),
    role,
    content: text,
    // 使用后端存储的时间戳，如果没有则为 0（前端会判断不显示）
    timestamp: content.timestamp || 0,
    parts: normalizedParts,
    tools: toolUsages.length > 0 ? toolUsages : undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
    isFunctionResponse,  // 标记是否为纯 functionResponse 消息
    isSummary: content.isSummary,  // 标记是否为总结消息
    isAutoSummary: content.isAutoSummary,  // 标记是否为自动触发的总结消息
    summarizedMessageCount: content.summarizedMessageCount,  // 总结消息覆盖的消息数量
    metadata: {
      modelVersion: content.modelVersion,
      usageMetadata: content.usageMetadata,
      // 从后端加载的思考持续时间
      thinkingDuration: content.thinkingDuration,
      // 从后端加载的计时信息
      responseDuration: content.responseDuration,
      firstChunkTime: content.firstChunkTime,
      streamDuration: content.streamDuration,
      chunkCount: content.chunkCount,
      thoughtsTokenCount: content.usageMetadata?.thoughtsTokenCount ?? content.thoughtsTokenCount,
      candidatesTokenCount: content.usageMetadata?.candidatesTokenCount ?? content.candidatesTokenCount
    }
  }
  if (typeof content.index === 'number') {
    msg.backendIndex = content.index
  }
  return msg
}
