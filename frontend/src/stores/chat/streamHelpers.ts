/**
 * 流式处理辅助函数
 * 
 * 包含消息操作、工具调用解析等辅助函数
 */

import type { Message } from '../../types'
import type { ChatStoreState } from './types'
import { generateId } from '../../utils/format'
import {
  XML_TOOL_START,
  XML_TOOL_END,
  JSON_TOOL_START,
  JSON_TOOL_END
} from './types'
import { parseXMLToolCall, parseJSONToolCall } from './parsers'


const todoDebugPrinted = new Set<string>()
function debugTodoOnce(key: string, data: Record<string, unknown>) {
  if (todoDebugPrinted.has(key)) return
  todoDebugPrinted.add(key)
  console.debug('[todo-debug][streamHelpers]', data)
}

function isTodoToolName(name: unknown): boolean {
  return name === 'todo_write' || name === 'todo_update' || name === 'create_plan'
}

/**
 * 添加 functionCall 到消息
 */
export function addFunctionCallToMessage(
  message: Message,
  call: { 
    id: string; 
    name: string; 
    args: Record<string, unknown>; 
    partialArgs?: string; 
    index?: number 
  }
): void {
  // 更新 tools 数组
  if (!message.tools) {
    message.tools = []
  }
  message.tools.push({
    id: call.id,
    name: call.name,
    args: call.args,
    // 传递 partialArgs 以便 ToolMessage 组件显示流式预览
    partialArgs: call.partialArgs,
    // 刚从流式内容里解析/拼接出来的工具调用，视为“AI 还在输出/完善工具内容”
    // 有 partialArgs 说明参数仍在流式累积中；无 partialArgs 说明已拿到完整参数
    status: typeof call.partialArgs === 'string' ? 'streaming' : 'queued'
  })
  
  // 更新 parts（用于渲染）
  if (!message.parts) {
    message.parts = []
  }
  message.parts.push({
    functionCall: {
      id: call.id,
      name: call.name,
      args: call.args,
      partialArgs: call.partialArgs,
      index: call.index
    }
  })
}

/**
 * 添加文本到消息（合并连续的文本 part）
 */
export function addTextToMessage(message: Message, text: string, isThought: boolean = false): void {
  // 普通文本才累加到 content
  if (!isThought) {
    message.content += text
  }
  
  if (!message.parts) {
    message.parts = []
  }
  
  const lastPart = message.parts[message.parts.length - 1]
  // 只有相同类型（都是思考或都不是思考）才合并
  const lastIsThought = lastPart?.thought === true
  if (lastPart && lastPart.text !== undefined && !lastPart.functionCall && lastIsThought === isThought) {
    lastPart.text += text
  } else {
    message.parts.push(isThought ? { text, thought: true } : { text })
  }
}

/**
 * 处理流式文本，检测 XML/JSON 工具调用标记
 */
export function processStreamingText(
  message: Message,
  text: string,
  state: ChatStoreState
): void {
  let remainingText = text
  
  while (remainingText.length > 0) {
    if (state.inToolCall.value === null) {
      // 不在工具调用中，检测开始标记
      const xmlStartIdx = remainingText.indexOf(XML_TOOL_START)
      const jsonStartIdx = remainingText.indexOf(JSON_TOOL_START)
      
      let startIdx = -1
      let startType: 'xml' | 'json' | null = null
      let startMarker = ''
      
      if (xmlStartIdx !== -1 && (jsonStartIdx === -1 || xmlStartIdx < jsonStartIdx)) {
        startIdx = xmlStartIdx
        startType = 'xml'
        startMarker = XML_TOOL_START
      } else if (jsonStartIdx !== -1) {
        startIdx = jsonStartIdx
        startType = 'json'
        startMarker = JSON_TOOL_START
      }
      
      if (startIdx !== -1 && startType) {
        // 找到开始标记，输出标记前的文本
        const textBefore = remainingText.substring(0, startIdx)
        if (textBefore) {
          addTextToMessage(message, textBefore)
        }
        
        // 进入工具调用状态
        state.inToolCall.value = startType
        state.toolCallBuffer.value = startMarker
        remainingText = remainingText.substring(startIdx + startMarker.length)
      } else {
        // 没有找到开始标记，检查是否有部分匹配
        // 为了简化，如果文本末尾可能是开始标记的前缀，暂存
        const possiblePrefixes = [
          XML_TOOL_START.substring(0, Math.min(remainingText.length, XML_TOOL_START.length - 1)),
          JSON_TOOL_START.substring(0, Math.min(remainingText.length, JSON_TOOL_START.length - 1))
        ]
        
        let foundPartial = false
        for (const prefix of possiblePrefixes) {
          if (prefix && remainingText.endsWith(prefix.substring(0, remainingText.length))) {
            // 可能是部分匹配，但为简化处理，直接输出全部文本
            // 完整的部分匹配检测会很复杂
          }
        }
        
        if (!foundPartial) {
          // 输出全部文本
          addTextToMessage(message, remainingText)
          remainingText = ''
        }
      }
    } else {
      // 在工具调用中，查找结束标记
      const endMarker = state.inToolCall.value === 'xml' ? XML_TOOL_END : JSON_TOOL_END
      state.toolCallBuffer.value += remainingText
      
      const endIdx = state.toolCallBuffer.value.indexOf(endMarker)
      if (endIdx !== -1) {
        // 找到结束标记，解析工具调用
        const toolContent = state.toolCallBuffer.value.substring(
          state.inToolCall.value === 'xml' ? XML_TOOL_START.length : JSON_TOOL_START.length,
          endIdx
        )
        
        const parsed = state.inToolCall.value === 'xml'
          ? parseXMLToolCall(toolContent)
          : parseJSONToolCall(toolContent)
        
        if (parsed) {
          // 成功解析，添加 functionCall
          addFunctionCallToMessage(message, {
            id: generateId(),
            name: parsed.name,
            args: parsed.args
          })
        } else {
          // 解析失败，作为普通文本输出
          addTextToMessage(message, state.toolCallBuffer.value.substring(0, endIdx + endMarker.length))
        }
        
        // 重置状态，处理剩余文本
        const afterEnd = state.toolCallBuffer.value.substring(endIdx + endMarker.length)
        state.inToolCall.value = null
        state.toolCallBuffer.value = ''
        remainingText = afterEnd
      } else {
        // 未找到结束标记，继续累积
        remainingText = ''
      }
    }
  }
}

/**
 * 完成流式时清理工具调用缓冲区
 */
export function flushToolCallBuffer(message: Message, state: ChatStoreState): void {
  if (state.toolCallBuffer.value) {
    // 如果有未完成的工具调用内容，作为普通文本输出
    addTextToMessage(message, state.toolCallBuffer.value)
    state.toolCallBuffer.value = ''
    state.inToolCall.value = null
  }
}

/**
 * 处理工具调用 part（原生 function call format）
 */
export function handleFunctionCallPart(part: any, message: Message): void {
  const fc = part.functionCall
  const lastPart = message.parts![message.parts!.length - 1]

  const incomingId = typeof fc.id === 'string' && fc.id.trim() ? fc.id.trim() : ''
  const incomingHasPartial = typeof fc.partialArgs === 'string'
  const incomingHasArgs = !!(fc.args && Object.keys(fc.args).length > 0)
  
  // 尝试合并到最后一个工具调用块
  let merged = false
  if (lastPart && lastPart.functionCall) {
    const lastFc = lastPart.functionCall
    const lastId = typeof lastFc.id === 'string' && lastFc.id.trim() ? lastFc.id.trim() : ''
    const lastHasPartial = typeof lastFc.partialArgs === 'string'
    
    // 只在“明显仍是同一次工具调用增量”时合并，避免把后续独立工具调用误并到上一条。
    const sameId = incomingId && lastId && incomingId === lastId
    const sameIndex = fc.index !== undefined && lastFc.index === fc.index

    const canMergeByIndex =
      !sameId &&
      sameIndex &&
      lastHasPartial &&
      (incomingHasPartial || incomingHasArgs)

    const canMergeLegacyPartial =
      !sameId &&
      !incomingId &&
      fc.index === undefined &&
      incomingHasPartial

    // OpenAI Responses API 模式：初始 chunk { name, id, index: null } 后跟
    // 数据 chunk { index: N, partialArgs }。初始 chunk 无 partialArgs 也无 args，
    // 需要特殊处理把首个数据 chunk 合并到刚创建的工具上。
    const lastIsFreshTool = !lastHasPartial && (!lastFc.args || Object.keys(lastFc.args).length === 0)
    const canMergeAsFreshToolData =
      !sameId &&
      !incomingId &&
      incomingHasPartial &&
      lastIsFreshTool

    const canMerge = !!(sameId || canMergeByIndex || canMergeLegacyPartial || canMergeAsFreshToolData)
    
    if (canMerge) {
      if (isTodoToolName(fc.name) || isTodoToolName(lastFc.name)) {
        debugTodoOnce(`merge-${message.id}-${lastFc.id || 'no-last-id'}-${fc.id || 'no-id'}-${String(fc.name || lastFc.name)}`, {
          messageId: message.id,
          action: 'merge_function_call_part',
          incomingName: fc.name || null,
          incomingId: incomingId || null,
          incomingIndex: fc.index ?? null,
          incomingHasPartial,
          incomingHasArgs,
          lastName: lastFc.name || null,
          lastId: lastId || null,
          lastIndex: lastFc.index ?? null,
          canMerge,
          canMergeReason: sameId ? 'sameId' : (canMergeByIndex ? 'sameIndexWithPartial' : (canMergeLegacyPartial ? 'legacyPartial' : 'none'))
        })
      }

      // 合并名称、ID 和 index
      if (fc.name && !lastFc.name) lastFc.name = fc.name
      if (fc.id && !lastFc.id) lastFc.id = fc.id
      if (typeof fc.index === 'number' && (lastFc.index === undefined || lastFc.index === null)) {
        lastFc.index = fc.index
      }
      
      // 合并参数
      if (incomingHasPartial) {
        lastFc.partialArgs = (lastFc.partialArgs || '') + fc.partialArgs
        // 尝试更新解析后的 args 用于预览
        if (lastFc.partialArgs.trim()) {
          try {
            lastFc.args = JSON.parse(lastFc.partialArgs)
          } catch (e) { /* 继续累积 */ }
        }

        // ★ 同步更新 message.tools 中对应工具的流式状态和 partialArgs
        const toolId = lastFc.id
        if (toolId) {
          const toolEntry = message.tools?.find(t => t.id === toolId)
          if (toolEntry) {
            toolEntry.status = 'streaming'
            toolEntry.partialArgs = lastFc.partialArgs
            // 同步已解析的 args（用于描述格式化器预览）
            if (lastFc.args && Object.keys(lastFc.args).length > 0) {
              toolEntry.args = lastFc.args
            }
          }
        }
      } else if (fc.args && Object.keys(fc.args).length > 0) {
        lastFc.args = { ...lastFc.args, ...fc.args }

        // 收到完整 args 后，认为该次增量拼接已收束，
        // 清理残留 partialArgs，避免后续相同 index 的新工具调用被误合并。
        if (lastFc.partialArgs) {
          delete lastFc.partialArgs
        }
      }

      // 工具参数接收完毕：同步 message.tools 状态和 args
      const resolvedId = lastFc.id
      if (resolvedId && !lastFc.partialArgs && lastFc.args && Object.keys(lastFc.args).length > 0) {
        const toolEntry = message.tools?.find(t => t.id === resolvedId)
        if (toolEntry && toolEntry.status === 'streaming') {
          toolEntry.status = 'queued'
          toolEntry.args = lastFc.args
          delete toolEntry.partialArgs
        }
      }
      
      merged = true
    }
  }
  
  if (!merged) {
    if (isTodoToolName(fc.name)) {
      debugTodoOnce(`append-${message.id}-${fc.id || 'no-id'}-${String(fc.name)}`, {
        messageId: message.id,
        action: 'append_new_function_call_part',
        incomingName: fc.name,
        incomingId: typeof fc.id === 'string' ? fc.id : null,
        incomingIndex: fc.index ?? null,
        hasPartial: typeof fc.partialArgs === 'string',
        hasArgs: !!(fc.args && Object.keys(fc.args).length > 0)
      })
    }

    // 找不到可合并的，添加新块
    addFunctionCallToMessage(message, {
      id: fc.id || generateId(),
      name: fc.name || '',
      args: fc.args || {},
      partialArgs: fc.partialArgs,
      index: fc.index
    })
  }
}
