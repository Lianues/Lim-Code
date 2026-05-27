import type { Content, ContentPart } from '@/types'

type StreamFunctionCall = NonNullable<ContentPart['functionCall']> & {
  itemId?: string
  finalArgs?: boolean
  partialArgs?: string
}

function cloneContent(content: Content): Content {
  return {
    ...content,
    parts: (content.parts || []).map(part => {
      const cloned: ContentPart = { ...part }
      if (part.functionCall) cloned.functionCall = { ...(part.functionCall as StreamFunctionCall) }
      if (part.functionResponse) cloned.functionResponse = { ...part.functionResponse }
      return cloned
    })
  }
}

function normalizeNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function hasNonEmptyArgs(args: unknown): args is Record<string, unknown> {
  return !!(args && typeof args === 'object' && Object.keys(args as Record<string, unknown>).length > 0)
}

function tryParseArgs(argsText: string | undefined): Record<string, unknown> | null {
  if (typeof argsText !== 'string' || !argsText.trim()) return null
  try {
    const parsed = JSON.parse(argsText)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function getMergeReason(
  incoming: StreamFunctionCall,
  existing: StreamFunctionCall,
  isLastFunctionCall: boolean
): 'sameItemId' | 'sameIndex' | 'sameId' | 'freshPlaceholder' | 'legacyPartial' | null {
  const incomingItemId = normalizeNonEmptyString(incoming.itemId)
  const existingItemId = normalizeNonEmptyString(existing.itemId)
  if (incomingItemId && existingItemId && incomingItemId === existingItemId) return 'sameItemId'

  // 修改原因：OpenAI Responses 的 output_index 可以是 0，truthy 判断会把第一个工具误判为无 index。
  // 修改方式：统一用 typeof number 判断双方 index 是否有效。
  // 目的：让 Monitor 的 live delta reducer 与主聊天工具合并规则一致，不产生“参数 0”占位卡。
  if (typeof incoming.index === 'number' && typeof existing.index === 'number' && incoming.index === existing.index) {
    return 'sameIndex'
  }

  const incomingId = normalizeNonEmptyString(incoming.id)
  const existingId = normalizeNonEmptyString(existing.id)
  if (incomingId && existingId && incomingId === existingId) return 'sameId'

  const incomingHasPartial = typeof incoming.partialArgs === 'string'
  const incomingHasLocator = !!incomingId || typeof incoming.index === 'number' || !!incomingItemId
  const existingIsFreshPlaceholder =
    isLastFunctionCall &&
    !hasNonEmptyArgs(existing.args) &&
    (existing.partialArgs === undefined || existing.partialArgs === '')

  if (!incomingHasLocator && incomingHasPartial && existingIsFreshPlaceholder) return 'freshPlaceholder'
  if (!incomingHasLocator && incomingHasPartial && isLastFunctionCall) return 'legacyPartial'

  return null
}

function mergeFunctionCall(target: StreamFunctionCall, incoming: StreamFunctionCall): void {
  if (incoming.name && !target.name) target.name = incoming.name
  if (incoming.id) target.id = incoming.id
  if (incoming.itemId && !target.itemId) target.itemId = incoming.itemId
  if (typeof incoming.index === 'number' && typeof target.index !== 'number') target.index = incoming.index

  if (typeof incoming.partialArgs === 'string') {
    // 修改原因：arguments.delta 是增量片段，而 arguments.done/output_item.done 是完整 JSON，两者不能用同一种拼接方式。
    // 修改方式：finalArgs=true 时覆盖已有 partialArgs 并立即尝试解析；普通 delta 只追加到当前 preview 字符串。
    // 目的：Monitor 实时工具卡可以流式预览大参数，最终又能收束为 queued 工具而不残留重复 JSON。
    target.partialArgs = incoming.finalArgs === true
      ? incoming.partialArgs
      : (target.partialArgs || '') + incoming.partialArgs

    const parsed = incoming.finalArgs === true ? tryParseArgs(target.partialArgs) : null
    if (parsed) {
      target.args = parsed
      delete target.partialArgs
    }
    return
  }

  if (hasNonEmptyArgs(incoming.args)) {
    target.args = incoming.args
    delete target.partialArgs
  }
}

function appendFunctionCallPart(parts: ContentPart[], incomingPart: ContentPart): void {
  const incoming = incomingPart.functionCall as StreamFunctionCall | undefined
  if (!incoming) return

  let isLastFunctionCall = true
  for (let i = parts.length - 1; i >= 0; i--) {
    const existing = parts[i].functionCall as StreamFunctionCall | undefined
    if (!existing) continue

    const reason = getMergeReason(incoming, existing, isLastFunctionCall)
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

function ensureLastModelContent(contents: Content[], timestamp: number): Content {
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
    index: contents.length
  } as Content
  contents.push(created)
  return created
}

export function applyStreamChunkToContents(contents: Content[], chunk: any, timestamp: number = Date.now()): Content[] {
  // 修改原因：SubAgent Monitor 不能继续依赖每个 llm_delta 附带完整 snapshot，否则 events 和 contents 都会随输出长度 O(n²) 膨胀。
  // 修改方式：把主聊天流式 reducer 的核心语义收敛为 Content[] delta reducer，支持 text、thought、functionCall、contentSnapshot 和 usage。
  // 目的：Monitor 实时显示 SubAgent 输出，同时保持后端只发送轻量 delta。
  const next = (contents || []).map(cloneContent)
  const snapshot = chunk?.contentSnapshot as Content | undefined
  if (snapshot?.parts) {
    const replacement = cloneContent({
      ...snapshot,
      timestamp: snapshot.timestamp || timestamp,
      index: typeof snapshot.index === 'number' ? snapshot.index : Math.max(0, next.length - 1)
    } as Content)
    const lastModelIndex = next.length > 0 ? next.map(content => content.role).lastIndexOf('model') : -1
    if (lastModelIndex >= 0) {
      next[lastModelIndex] = replacement
    } else {
      replacement.index = next.length
      next.push(replacement)
    }
    return next
  }

  const modelContent = ensureLastModelContent(next, timestamp)
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
