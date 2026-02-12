/**
 * Chat Store 解析器
 * 
 * 包含工具调用解析和 Content 到 Message 的转换
 */

import type { Message, Content, Attachment } from '../../types'
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
  return content.parts.every(p => p.functionResponse !== undefined)
}

/**
 * 将 Content 转换为 Message
 */
export function contentToMessage(content: Content, id?: string): Message {
  const textParts = content.parts.filter(p => p.text && !p.thought)
  const text = textParts.map(p => p.text).join('\n')
  
  // 提取工具调用信息
  const toolUsages: import('../../types').ToolUsage[] = []
  for (const part of content.parts) {
    if (part.functionCall) {
      toolUsages.push({
        id: part.functionCall.id || generateId(),
        name: part.functionCall.name,
        args: part.functionCall.args,
        // functionCall 表示“工具调用已完整出现”，但尚未开始执行。
        // 后续状态由 toolsExecuting / awaitingConfirmation / toolIteration / diff 状态等更新。
        status: 'queued'
      })
    }
  }
  
  // 确定消息角色：有工具调用时角色仍为 assistant
  const role = content.role === 'model' ? 'assistant' : 'user'
  
  const msg: Message = {
    id: id || generateId(),
    role,
    content: text,
    timestamp: Date.now(),
    parts: content.parts,
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
  const textParts = content.parts.filter(p => p.text && !p.thought)
  const text = textParts.map(p => p.text).join('\n')
  
  // 提取工具调用信息（不预先匹配响应）
  const toolUsages: import('../../types').ToolUsage[] = []
  // 提取附件信息（从 inlineData）
  const attachments: Attachment[] = []
  
  for (const part of content.parts) {
    if (part.functionCall) {
      // 检查是否被拒绝（用户在等待确认时点击了终止按钮）
      const isRejected = part.functionCall.rejected === true
      toolUsages.push({
        id: part.functionCall.id || generateId(),
        name: part.functionCall.name,
        args: part.functionCall.args,
        status: isRejected ? 'error' : 'queued'  // 默认视为已排队
      })
    }
    
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
    parts: content.parts,
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
