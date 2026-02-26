/**
 * 提示词上下文解析器
 * 用于从消息内容中提取 <lim-context> 块
 */

import type { PromptContextItem } from './promptContext'
import type { EditorNode } from './editorNode'
import { createTextNode, createContextNode, normalizeNodes } from './editorNode'

/**
 * 解析结果
 */
export interface ParsedMessageContent {
  /** 提取出的上下文块 */
  contexts: PromptContextItem[]
  /** 剩余的用户消息内容（移除 <lim-context> 块后的纯文本） */
  userContent: string
}

/**
 * 解析结果（保留原始顺序的节点）
 */
export interface ParsedMessageNodes {
  nodes: EditorNode[]
  contexts: PromptContextItem[]
}

/**
 * 从消息内容中解析 <lim-context> 块（支持出现在任意位置）
 */
export function parseMessageToNodes(content: string): ParsedMessageNodes {
  const contexts: PromptContextItem[] = []
  const nodes: EditorNode[] = []

  if (!content) {
    return { nodes, contexts }
  }

  // 匹配 <lim-context ...>...</lim-context>
  // 支持属性：type, path, title, language, binary
  const contextRegex = /<lim-context\s+([^>]*)>([\s\S]*?)<\/lim-context>/gi

  let match: RegExpExecArray | null
  let lastIndex = 0
  let idCounter = 0

  while ((match = contextRegex.exec(content)) !== null) {
    const idx = match.index
    if (idx > lastIndex) {
      nodes.push(createTextNode(content.slice(lastIndex, idx)))
    }

    const attrsStr = match[1]
    const innerContent = match[2]
    const attrs = parseAttributes(attrsStr)

    const contextItem: PromptContextItem = {
      id: `parsed-${idCounter++}`,
      type: (attrs.type as PromptContextItem['type']) || 'text',
      title: attrs.title || attrs.path || 'Context',
      content: attrs.binary === 'true' ? '' : (innerContent || '').trim(),
      filePath: attrs.path,
      language: attrs.language,
      isTextContent: attrs.binary === 'true' ? false : true,
      enabled: true,
      addedAt: Date.now()
    }

    contexts.push(contextItem)
    nodes.push(createContextNode(contextItem))

    lastIndex = idx + match[0].length
  }

  if (lastIndex < content.length) {
    nodes.push(createTextNode(content.slice(lastIndex)))
  }

  return {
    nodes: normalizeNodes(nodes),
    contexts
  }
}

/**
 * 从消息内容中解析上下文块
 * - 支持出现在任意位置
 * - 返回移除 <lim-context> 块后的文本（用于编辑/显示）
 */
export function parseMessageContexts(content: string): ParsedMessageContent {
  const parsed = parseMessageToNodes(content)
  const userContent = parsed.nodes
    .filter((n): n is { type: 'text'; text: string } => n.type === 'text')
    .map(n => n.text)
    .join('')

  return {
    contexts: parsed.contexts,
    userContent
  }
}

/**
 * 解析属性字符串
 * 支持 key="value" 格式
 */
function parseAttributes(attrsStr: string): Record<string, string> {
  const attrs: Record<string, string> = {}

  // 匹配 key="value" 或 key='value'
  const attrRegex = /(\w+)=["']([^"']*)["']/g
  let match: RegExpExecArray | null

  while ((match = attrRegex.exec(attrsStr)) !== null) {
    attrs[match[1]] = match[2]
  }

  return attrs
}

/**
 * 检查消息是否包含上下文块
 */
export function hasContextBlocks(content: string): boolean {
  return /<lim-context\s+/i.test(content || '')
}
