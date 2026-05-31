export interface CachePruneContext {
  reason: string
  maxEntries?: number
  maxBytes?: number
  now: number
}

export interface CacheRegistration {
  id: string
  owner: string
  scope: string
  getEntryCount: () => number
  estimateBytes: () => number
  prune: (context: CachePruneContext) => number
  maxEntries?: number
  maxBytes?: number
  ttlMs?: number
}

export interface CacheDiagnostics {
  id: string
  owner: string
  scope: string
  entries: number
  estimatedBytes: number
  maxEntries?: number
  maxBytes?: number
  ttlMs?: number
  lastPrunedAt?: number
  lastPruneReason?: string
  lastPrunedEntries?: number
}

interface RegisteredCache {
  registration: CacheRegistration
  lastPrunedAt?: number
  lastPruneReason?: string
  lastPrunedEntries?: number
}

export class CacheLifecycleGovernor {
  private readonly caches = new Map<string, RegisteredCache>()

  register(registration: CacheRegistration): () => void {
    if (!registration.id.trim()) {
      throw new Error('cache registration id is required')
    }

    this.caches.set(registration.id, { registration })
    return () => {
      const current = this.caches.get(registration.id)
      if (current?.registration === registration) {
        this.caches.delete(registration.id)
      }
    }
  }

  getDiagnostics(): CacheDiagnostics[] {
    return Array.from(this.caches.values()).map(cache => {
      const { registration } = cache
      return {
        id: registration.id,
        owner: registration.owner,
        scope: registration.scope,
        entries: registration.getEntryCount(),
        estimatedBytes: registration.estimateBytes(),
        maxEntries: registration.maxEntries,
        maxBytes: registration.maxBytes,
        ttlMs: registration.ttlMs,
        lastPrunedAt: cache.lastPrunedAt,
        lastPruneReason: cache.lastPruneReason,
        lastPrunedEntries: cache.lastPrunedEntries
      }
    })
  }

  prune(reason: string, ids?: string[]): number {
    const selected = ids
      ? ids.map(id => this.caches.get(id)).filter((cache): cache is RegisteredCache => !!cache)
      : Array.from(this.caches.values())
    const now = Date.now()
    let totalPruned = 0

    for (const cache of selected) {
      const { registration } = cache
      const pruned = registration.prune({
        reason,
        maxEntries: registration.maxEntries,
        maxBytes: registration.maxBytes,
        now
      })
      cache.lastPrunedAt = now
      cache.lastPruneReason = reason
      cache.lastPrunedEntries = pruned
      totalPruned += pruned
    }

    return totalPruned
  }

  enforceBudgets(reason: string): number {
    const overBudget = Array.from(this.caches.values())
      .filter(cache => {
        const { registration } = cache
        const entries = registration.getEntryCount()
        const bytes = registration.estimateBytes()
        return (
          (typeof registration.maxEntries === 'number' && entries > registration.maxEntries) ||
          (typeof registration.maxBytes === 'number' && bytes > registration.maxBytes)
        )
      })
      .map(cache => cache.registration.id)

    return this.prune(reason, overBudget)
  }

  clearForTests(): void {
    this.caches.clear()
  }
}

export const frontendCacheLifecycleGovernor = new CacheLifecycleGovernor()

export function estimateUtf8Bytes(text: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).byteLength
  }

  let bytes = 0
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0
    if (codePoint <= 0x7f) bytes += 1
    else if (codePoint <= 0x7ff) bytes += 2
    else if (codePoint <= 0xffff) bytes += 3
    else bytes += 4
  }
  return bytes
}

export function estimateJsonBytes(value: unknown): number {
  try {
    return estimateUtf8Bytes(JSON.stringify(value) ?? '')
  } catch {
    return estimateUtf8Bytes(String(value))
  }
}

export function estimateMapJsonBytes(map: Map<unknown, unknown>): number {
  let total = 0
  for (const [key, value] of map) {
    total += estimateJsonBytes(key)
    total += estimateJsonBytes(value)
  }
  return total
}

export function pruneMapToMaxEntries<K, V>(map: Map<K, V>, maxEntries: number): number {
  if (!Number.isFinite(maxEntries) || maxEntries < 0) return 0

  let removed = 0
  while (map.size > maxEntries) {
    const next = map.keys().next()
    if (next.done) break
    map.delete(next.value)
    removed += 1
  }
  return removed
}
