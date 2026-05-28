/**
 * WP15: SubAgent Monitor Content[] delta reducer。
 *
 * 为什么需要这个文件：SubAgent Monitor 不能直接使用主聊天的 handleFunctionCallPart（它耦合了 Message 类型和
 * Pinia store 状态），但需要相同的 functionCall 合并语义（itemId > index > id > freshPlaceholder > legacyPartial）。
 *
 * 怎么改：合并逻辑（normalizeNonEmptyString、hasNonEmptyArgs、tryParseArgs、getFunctionCallMergeReason、
 * mergeFunctionCall）已收敛到 utils/functionCallMerge.ts。本文件只保留 Monitor 特有的 Content[] 投影逻辑：
 * cloneContent、appendContentPart、ensureLastModelContent、applyStreamChunkToContents。
 *
 * 目的：Main Chat 和 SubAgent Monitor 共享同一套 functionCall 合并规则，后续 WP20 统一 reducer 可直接依赖。
 */

import type { Content, ContentPart } from '../../types'
// WP15: 统一 functionCall merge 纯函数入口。
// 为什么从独立模块导入：消除与 streamHelpers.ts / parsers.ts 的三份重复。
// 怎么改：getFunctionCallMergeReason 和 mergeFunctionCall 直接引用统一模块。
// 目的：Monitor 实时工具卡合并行为与主聊天完全一致。
import {
  type StreamFunctionCall,
  normalizeNonEmptyString,
  hasNonEmptyArgs,
  getFunctionCallMergeReason,
  mergeFunctionCall as unifiedMergeFunctionCall
} from '../../utils/functionCallMerge'

function cloneContent(content: Content): Content {
  // 修改原因：只有即将被替换或被 delta 更新的 Content 需要深拷贝 parts，未变化的历史楼层应保持引用共享。
  // 修改方式：保留单 Content 深拷贝工具，但不再在 applyStreamChunkToContents 中对整个 contents 全量 map 调用。
  // 目的：大输出流式阶段避免每个 delta clone 所有旧消息对象，降低 Monitor 本地 reducer 的 O(n²) 风险。
  return {
    ...content,
    parts: (content.parts || []).map(part => {
      const cloned: ContentPart = { ...part }
      if (part.functionCall) cloned.functionCall = { ...(part.functionCall as StreamFunctionCall) } as ContentPart['functionCall']
      if (part.functionResponse) cloned.functionResponse = { ...part.functionResponse }
      return cloned
    })
  }
}

/**
 * WP15: Monitor 专用的 mergeFunctionCall 薄包装。
 * 
 * 为什么需要这个包装：Monitor 的 live delta 不需要 Main Chat 的 JSON.parse 节流策略，
 * 只在 finalArgs=true（流式完成事件）时解析 partialArgs。
 * 怎么改：不传 shouldParseArgs，让统一模块使用默认的 finalArgs-only 解析策略。
 * 目的：Monitor 大工具参数不跑不必要的 JSON.parse 循环，同时共享同一合并语义。
 */
function mergeFunctionCall(target: StreamFunctionCall, incoming: StreamFunctionCall): void {
  unifiedMergeFunctionCall(target, incoming)
}

function appendFunctionCallPart(parts: ContentPart[], incomingPart: ContentPart): void {
  const incoming = incomingPart.functionCall as StreamFunctionCall | undefined
  if (!incoming) return

  let isLastFunctionCall = true
  for (let i = parts.length - 1; i >= 0; i--) {
    const existing = parts[i].functionCall as StreamFunctionCall | undefined
    if (!existing) continue

    const reason = getFunctionCallMergeReason(incoming, existing, isLastFunctionCall)
    if (reason) {
      mergeFunctionCall(existing, incoming)
      return
    }

    isLastFunctionCall = false
  }

  const newFunctionCall: StreamFunctionCall = {
    ...(incoming as any),
    name: incoming.name || '',
    args: hasNonEmptyArgs(incoming.args) ? incoming.args : {}
  }
  mergeFunctionCall(newFunctionCall, incoming)
  parts.push({ functionCall: newFunctionCall as ContentPart['functionCall'] })
}

function appendContentPart(target: Content, part: ContentPart): void {
  if (part.text !== undefined) {
    const lastPart = target.parts[target.parts.length - 1]
    const isThought = part.thought === true
    const lastIsThought = lastPart?.thought === true
    if (lastPart && lastPart.text !== undefined && !lastPart.functionCall && lastIsThought === isThought) {
      lastPart.text += part.text
    } else {
      target.parts.push(isThought ? { text: part.text, thought: true } : { text: part.text })
    }
    return
  }

  if (part.functionCall) {
    appendFunctionCallPart(target.parts, part)
    return
  }

  target.parts.push({ ...part })
}

function ensureLastModelContent(contents: Content[], timestamp: number, baseIndex: number): Content {
  const last = contents[contents.length - 1]
  if (last?.role === 'model') {
    return last
  }

  // 修改原因：SubAgent Monitor 可能先收到 llm_delta，再收到最终 content_snapshot；没有 model 楼层时必须先创建一个本地 live baseline。
  // 修改方式：在 contents 末尾补一个 role=model 的空 Content，并只作为前端实时投影使用。
  // 目的：让 Monitor 能像主聊天一样边收边渲染，而不是等 run 完成后才显示 AI 输出。
  const created = {
    role: 'model' as const,
    parts: [],
    timestamp,
    // 修改原因：Monitor window 可能不是从 0 开始；新建 live model 楼层必须保留完整 transcript 的绝对 index。
    // 修改方式：由调用方传入 window.startIndex 作为 baseIndex，默认 0 兼容单元测试和旧调用。
    // 目的：delete/retry/backendIndex 不因实时 delta 在分页窗口内生成局部 index 而错位。
    index: baseIndex + contents.length
  } as Content
  contents.push(created)
  return created
}

export function applyStreamChunkToContents(contents: Content[], chunk: any, timestamp: number = Date.now(), baseIndex: number = 0): Content[] {
  // 修改原因：SubAgent Monitor 不能继续依赖每个 llm_delta 附带完整 snapshot，否则 events 和 contents 都会随输出长度 O(n²) 膨胀。
  // 修改方式：把主聊天流式 reducer 的核心语义收敛为 Content[] delta reducer，支持 text、thought、functionCall、contentSnapshot 和 usage。
  // 目的：Monitor 实时显示 SubAgent 输出，同时保持后端只发送轻量 delta。
  const source = contents || []
  const next = [...source]
  const snapshot = chunk?.contentSnapshot as Content | undefined
  if (snapshot?.parts) {
    // 修改原因：contentSnapshot 是结构边界校准，只需要替换最后一个 model content，不应 clone 其它未变化楼层。
    // 修改方式：复制 contents 数组并深拷贝 replacement，旧 Content 对象引用保持共享。
    // 目的：保持快照语义正确，同时避免低频校准也退化成全量 clone。
    const replacement = cloneContent({
      ...snapshot,
      timestamp: snapshot.timestamp || timestamp,
      index: typeof snapshot.index === 'number' ? snapshot.index : baseIndex + Math.max(0, next.length - 1)
    } as Content)
    let lastModelIndex = -1
    for (let index = next.length - 1; index >= 0; index--) {
      if (next[index]?.role === 'model') {
        lastModelIndex = index
        break
      }
    }
    if (lastModelIndex >= 0) {
      next[lastModelIndex] = replacement
    } else {
      replacement.index = baseIndex + next.length
      next.push(replacement)
    }
    return next
  }

  const lastIndex = next.length - 1
  let modelContent: Content
  if (lastIndex >= 0 && next[lastIndex]?.role === 'model') {
    // 修改原因：delta 只会改最后一个 model Content，旧实现每次克隆所有 Content 会让大 transcript 本地处理成本随历史长度增长。
    // 修改方式：只深拷贝最后一个 model Content/parts，再原地追加 delta 到这个新对象。
    // 目的：未被更新的旧 content 对象引用保持不变，Vue 也只需要追踪真正变化的尾部消息。
    modelContent = cloneContent(next[lastIndex])
    next[lastIndex] = modelContent
  } else {
    modelContent = ensureLastModelContent(next, timestamp, baseIndex)
  }

  for (const part of chunk?.delta || []) {
    appendContentPart(modelContent, part)
  }

  if (chunk?.usage) {
    modelContent.usageMetadata = chunk.usage
  }
  if (chunk?.modelVersion) {
    modelContent.modelVersion = chunk.modelVersion
  }
  if (chunk?.thinkingStartTime) {
    modelContent.thinkingStartTime = chunk.thinkingStartTime
  }

  return next
}
