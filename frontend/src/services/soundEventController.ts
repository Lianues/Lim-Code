import { playCue, unlockAudio, type SoundCue } from './soundCues'

export type SoundEventSource =
  | 'taskEvent'
  | 'retryStatus'
  | 'streamChunk'
  | 'notification'
  | 'chatError'
  | 'visibilityRestore'

export interface SoundEventPayload {
  cue: SoundCue
  source: SoundEventSource
  createdAt?: number
  conversationId?: string
}

interface HiddenSoundAggregate {
  cue: SoundCue
  createdAt: number
  count: number
  conversationId?: string
}

const MAX_SOUND_EVENT_AGE_MS = 3000

const CUE_PRIORITY: Record<SoundCue, number> = {
  error: 4,
  taskError: 3,
  warning: 2,
  taskComplete: 1
}

let hiddenAggregate: HiddenSoundAggregate | null = null
let audioUnlockedThisSession = false
let unlockInFlight: Promise<boolean> | null = null
let unlockHooksCleanup: (() => void) | null = null
let visibilityHooksCleanup: (() => void) | null = null

function canUseDocument(): boolean {
  return typeof document !== 'undefined'
}

function normalizeCreatedAt(createdAt?: number): number {
  return typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : Date.now()
}

function isEventExpired(createdAt: number, now: number = Date.now()): boolean {
  return now - createdAt > MAX_SOUND_EVENT_AGE_MS
}

function isDocumentHidden(): boolean {
  if (!canUseDocument()) return false
  return document.hidden || document.visibilityState === 'hidden'
}

function getCuePriority(cue: SoundCue): number {
  return CUE_PRIORITY[cue] || 0
}

function clearUnlockHooks(): void {
  if (unlockHooksCleanup) {
    const cleanup = unlockHooksCleanup
    unlockHooksCleanup = null
    cleanup()
  }
}

async function attemptUnlockAudio(): Promise<boolean> {
  if (audioUnlockedThisSession) return true

  if (!unlockInFlight) {
    unlockInFlight = (async () => {
      const result = await unlockAudio()
      if (result.success) {
        audioUnlockedThisSession = true
        clearUnlockHooks()
      }
      return result.success
    })().finally(() => {
      unlockInFlight = null
    })
  }

  return unlockInFlight
}

function updateHiddenAggregate(event: Required<Pick<SoundEventPayload, 'cue' | 'source' | 'createdAt'>> & Pick<SoundEventPayload, 'conversationId'>): void {
  if (!hiddenAggregate) {
    hiddenAggregate = {
      cue: event.cue,
      createdAt: event.createdAt,
      count: 1,
      conversationId: event.conversationId
    }
    return
  }

  const currentPriority = getCuePriority(hiddenAggregate.cue)
  const nextPriority = getCuePriority(event.cue)

  if (nextPriority > currentPriority) {
    hiddenAggregate = {
      cue: event.cue,
      createdAt: event.createdAt,
      count: hiddenAggregate.count + 1,
      conversationId: event.conversationId
    }
    return
  }

  if (nextPriority === currentPriority) {
    hiddenAggregate = {
      cue: hiddenAggregate.cue,
      createdAt: event.createdAt,
      count: hiddenAggregate.count + 1,
      conversationId: event.conversationId ?? hiddenAggregate.conversationId
    }
    return
  }

  hiddenAggregate = {
    ...hiddenAggregate,
    count: hiddenAggregate.count + 1
  }
}

async function playSoundEvent(event: SoundEventPayload & { createdAt: number }): Promise<void> {
  if (isEventExpired(event.createdAt)) return

  const unlocked = await attemptUnlockAudio()
  if (!unlocked) return

  await playCue(event.cue, {
    cooldownKey: event.conversationId ? `conv:${event.conversationId}` : undefined
  })
}

export async function handleSoundEvent(event: SoundEventPayload): Promise<void> {
  const createdAt = normalizeCreatedAt(event.createdAt)
  if (isEventExpired(createdAt)) return

  const normalizedEvent = {
    ...event,
    createdAt
  }

  if (isDocumentHidden()) {
    updateHiddenAggregate(normalizedEvent)
    return
  }

  await playSoundEvent(normalizedEvent)
}

export async function flushHiddenSoundEvent(): Promise<void> {
  const pending = hiddenAggregate
  hiddenAggregate = null

  if (!pending) return
  if (isEventExpired(pending.createdAt)) return

  await playSoundEvent({
    cue: pending.cue,
    source: 'visibilityRestore',
    createdAt: pending.createdAt,
    conversationId: pending.conversationId
  })
}

function handleVisibilityChange(): void {
  if (!isDocumentHidden()) {
    void flushHiddenSoundEvent()
  }
}

export function registerGlobalAudioUnlockHooks(): () => void {
  if (!canUseDocument() || audioUnlockedThisSession) {
    return () => {}
  }

  if (unlockHooksCleanup) {
    return unlockHooksCleanup
  }

  const onUserGesture = () => {
    void attemptUnlockAudio()
  }

  document.addEventListener('pointerdown', onUserGesture, true)
  document.addEventListener('keydown', onUserGesture, true)

  const cleanup = () => {
    document.removeEventListener('pointerdown', onUserGesture, true)
    document.removeEventListener('keydown', onUserGesture, true)
    if (unlockHooksCleanup === cleanup) {
      unlockHooksCleanup = null
    }
  }

  unlockHooksCleanup = cleanup
  return cleanup
}

export function registerVisibilityChangeHooks(): () => void {
  if (!canUseDocument()) {
    return () => {}
  }

  if (visibilityHooksCleanup) {
    return visibilityHooksCleanup
  }

  document.addEventListener('visibilitychange', handleVisibilityChange)

  const cleanup = () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    if (visibilityHooksCleanup === cleanup) {
      visibilityHooksCleanup = null
    }
  }

  visibilityHooksCleanup = cleanup
  return cleanup
}

export function resetSoundEventControllerForTests(): void {
  hiddenAggregate = null
  audioUnlockedThisSession = false
  unlockInFlight = null
  clearUnlockHooks()

  if (visibilityHooksCleanup) {
    const cleanup = visibilityHooksCleanup
    visibilityHooksCleanup = null
    cleanup()
  }
}

export const soundEventControllerTesting = {
  MAX_SOUND_EVENT_AGE_MS,
  getHiddenAggregate: (): HiddenSoundAggregate | null => hiddenAggregate
}
