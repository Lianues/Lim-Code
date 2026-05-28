/**
 * MessageItem 渲染块类型与 v-memo 依赖辅助。
 * v-memo 必须与 v-for 位于同一组件元素；这里集中 key/deps 计算，MessageRenderBlock 只负责展示。
 */

import type { ToolUsage } from '../../types'

/**
 * 渲染块类型：与 MessageItem 中 parts 合并后的一致结构。
 */
export interface RenderBlock {
  type: 'text' | 'tool' | 'thought'
  text?: string
  tools?: ToolUsage[]
  key?: string
}

/**
 * 为渲染块生成稳定 key，避免 v-memo 缓存跨元素错位。
 *
 * 修改原因：流式 text/thought 的内容会持续增长，key 若包含 text.length 或正文片段，Vue 会把同一段输出误判为新块并重建 MarkdownRenderer。
 * 修改方式：调用方优先提供结构 key；兜底也只使用类型/工具身份，不再从正文内容派生身份。
 * 修改目的：把“块是谁”和“块显示什么”分开，主聊天与 SubAgent Monitor 共享同一流式块身份契约。
 */
export function getRenderBlockKey(block: RenderBlock): string {
  if (block.key) {
    return block.key
  }

  if (block.type === 'tool') {
    return `tool:${(block.tools ?? []).map(tool => tool.id).join('|') || 'tool'}`
  }

  return `${block.type}:unkeyed`
}

/** 为 MessageRenderBlock 生成 v-memo 依赖数组；只放真正影响渲染输出的值。 */
export function getRenderBlockMemoDeps(
  block: RenderBlock,
  isStreaming: boolean,
  isUser: boolean,
  isThoughtExpanded: boolean,
  isThinking: boolean,
  thinkingTimeDisplay: string | null,
): unknown[] {
  if (block.type === 'tool') {
    return [block.type, block.tools, isStreaming, isUser]
  }

  if (block.type === 'thought') {
    return [block.type, block.text ?? '', isStreaming, isUser, isThoughtExpanded, isThinking, thinkingTimeDisplay]
  }

  return [block.type, block.text ?? '', isStreaming, isUser]
}
