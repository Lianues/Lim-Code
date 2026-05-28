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

/** 为渲染块生成稳定 key，避免 v-memo 缓存跨元素错位。 */
export function getRenderBlockKey(block: RenderBlock): string {
  if (block.key) {
    return block.key
  }

  const suffix =
    block.type === 'tool'
      ? (block.tools ?? []).map(tool => tool.id).join('|') || 'tool'
      : `${(block.text ?? '').length}:${(block.text ?? '').slice(0, 80)}`
  return `${block.type}:${suffix}`
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
