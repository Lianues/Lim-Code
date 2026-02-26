/**
 * Webview 声音提醒（Web Audio API）
 *
 * 设计目标：
 * - 默认优先使用扩展内置音效文件（resources/sound）；若不可用则回退到 Oscillator 生成提示音
 * - 支持导入本地音效覆盖
 * - 受控于 UI 设置（enabled/volume/cues/cooldownMs）
 * - 任何播放失败都必须被吞掉（不能影响主流程）
 */

// 自定义音效大小上限（与设置页导入限制保持一致）
const MAX_SOUND_ASSET_BYTES = 10 * 1024 * 1024
const MAX_SOUND_ASSET_BASE64_LENGTH = Math.ceil((MAX_SOUND_ASSET_BYTES * 4) / 3) + 4

export type SoundCue = 'warning' | 'error' | 'taskComplete' | 'taskError'

export type BuiltinSoundAsset = {
  url: string
  name: string
}

let builtinSoundAssets: Partial<Record<SoundCue, BuiltinSoundAsset>> = {}

function loadBuiltinSoundAssetsFromWindow(): void {
  try {
    if (typeof window === 'undefined') return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (window as any).__LIMCODE_BUILTIN_SOUND_ASSETS
    if (!raw || typeof raw !== 'object') return

    const out: Partial<Record<SoundCue, BuiltinSoundAsset>> = {}
    const cues: SoundCue[] = ['warning', 'error', 'taskComplete', 'taskError']
    for (const cue of cues) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entry = (raw as any)[cue]
      if (!entry || typeof entry !== 'object') continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyEntry = entry as any

      const url = typeof anyEntry.url === 'string' ? anyEntry.url : ''
      const name = typeof anyEntry.name === 'string' ? anyEntry.name : cue
      if (!url) continue

      out[cue] = { url, name }
    }

    builtinSoundAssets = out
  } catch {
    // ignore
  }
}

loadBuiltinSoundAssetsFromWindow()

export function getBuiltinSoundAssets(): Partial<Record<SoundCue, BuiltinSoundAsset>> {
  // 兜底：防止极端情况下脚本加载顺序导致未初始化
  if (Object.keys(builtinSoundAssets).length === 0) {
    loadBuiltinSoundAssetsFromWindow()
  }
  return builtinSoundAssets
}

function getBuiltinSoundAsset(cue: SoundCue): BuiltinSoundAsset | undefined {
  const assets = getBuiltinSoundAssets()
  return assets[cue]
}

export interface UISoundAsset {
  /** 文件名（展示用） */
  name: string
  /** mime 类型（展示用，可为空字符串） */
  mime: string
  /** base64 内容（不含 data: 前缀） */
  dataBase64: string
}

export interface UISoundSettings {
  /** 总开关（默认关闭，避免打扰） */
  enabled?: boolean

  /** 音量（0-100） */
  volume?: number

  /** 最小播放间隔（毫秒），用于限流 */
  cooldownMs?: number

  /** 各类提示音开关 */
  cues?: {
    warning?: boolean
    error?: boolean
    taskComplete?: boolean
    /** 任务失败提示音（可与 error 分开控制） */
    taskError?: boolean
  }

  /**
   * 自定义音效（可选）：为各类提示音导入本地音频文件。
   *
   * 注意：为支持“清除已导入音效”，这里允许显式写入 null。
   */
  assets?: {
    warning?: UISoundAsset | null
    error?: UISoundAsset | null
    taskComplete?: UISoundAsset | null
    taskError?: UISoundAsset | null
  }

  /** 提示音风格 */
  theme?: 'beep' | 'soft'
}

export interface NormalizedUISoundSettings {
  enabled: boolean
  volume: number
  cooldownMs: number
  cues: {
    warning: boolean
    error: boolean
    taskComplete: boolean
    taskError: boolean
  }
  assets: {
    warning?: UISoundAsset
    error?: UISoundAsset
    taskComplete?: UISoundAsset
    taskError?: UISoundAsset
  }
  theme: 'beep' | 'soft'
}

export const DEFAULT_UI_SOUND_SETTINGS: NormalizedUISoundSettings = {
  enabled: false,
  volume: 60,
  cooldownMs: 800,
  cues: {
    warning: true,
    error: true,
    taskComplete: true,
    taskError: true
  },
  assets: {},
  theme: 'beep'
}

let currentSettings: NormalizedUISoundSettings = { ...DEFAULT_UI_SOUND_SETTINGS }

let audioContext: AudioContext | null = null
let masterGain: GainNode | null = null
// 活跃播放节点（用于页面切换/卸载时中止试听）
const activeBufferSources = new Set<AudioBufferSourceNode>()
const activeOscillators = new Set<OscillatorNode>()


// base64/url -> AudioBuffer 缓存（避免重复 decode）
const decodedAudioBufferCache = new Map<string, AudioBuffer>()
const decodingPromises = new Map<string, Promise<AudioBuffer>>()

// 冷却按 key 维度隔离（默认全局；可按 conversation 分组）
const lastPlayedAtByKey = new Map<string, number>()

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, n))
}

function normalizeSoundAsset(input: unknown): UISoundAsset | undefined {
  if (!input || typeof input !== 'object') return undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyInput = input as any

  const name = typeof anyInput.name === 'string' ? anyInput.name : ''
  const mime = typeof anyInput.mime === 'string' ? anyInput.mime : ''
  const dataBase64 = typeof anyInput.dataBase64 === 'string' ? anyInput.dataBase64 : ''

  if (!dataBase64 || !dataBase64.trim()) return undefined
  // 基础安全限制：避免极端大对象导致 webview 卡顿/内存暴涨
  if (dataBase64.length > MAX_SOUND_ASSET_BASE64_LENGTH) return undefined

  return {
    name: name || 'sound',
    mime,
    dataBase64
  }
}

function pruneDecodedAudioCache(assets: NormalizedUISoundSettings['assets']): void {
  const keep = new Set<string>()
  for (const asset of Object.values(assets)) {
    if (asset?.dataBase64) {
      keep.add(asset.dataBase64)
    }
  }

  for (const key of Array.from(decodedAudioBufferCache.keys())) {
    // url:* 属于内置默认音效的缓存，不做清理
    if (key.startsWith('url:')) continue
    if (!keep.has(key)) {
      decodedAudioBufferCache.delete(key)
    }
  }
}

export function normalizeUISoundSettings(input?: UISoundSettings | null): NormalizedUISoundSettings {
  const enabled = typeof input?.enabled === 'boolean' ? input.enabled : DEFAULT_UI_SOUND_SETTINGS.enabled
  const volume = clampNumber(input?.volume, 0, 100, DEFAULT_UI_SOUND_SETTINGS.volume)
  const cooldownMs = clampNumber(input?.cooldownMs, 0, 60_000, DEFAULT_UI_SOUND_SETTINGS.cooldownMs)

  const cues = {
    warning: typeof input?.cues?.warning === 'boolean' ? input.cues.warning : DEFAULT_UI_SOUND_SETTINGS.cues.warning,
    error: typeof input?.cues?.error === 'boolean' ? input.cues.error : DEFAULT_UI_SOUND_SETTINGS.cues.error,
    taskComplete: typeof input?.cues?.taskComplete === 'boolean' ? input.cues.taskComplete : DEFAULT_UI_SOUND_SETTINGS.cues.taskComplete,
    taskError: typeof input?.cues?.taskError === 'boolean' ? input.cues.taskError : DEFAULT_UI_SOUND_SETTINGS.cues.taskError
  }

  const theme = input?.theme === 'soft' || input?.theme === 'beep'
    ? input.theme
    : DEFAULT_UI_SOUND_SETTINGS.theme

  const assets = {
    warning: normalizeSoundAsset(input?.assets?.warning),
    error: normalizeSoundAsset(input?.assets?.error),
    taskComplete: normalizeSoundAsset(input?.assets?.taskComplete),
    taskError: normalizeSoundAsset(input?.assets?.taskError)
  }

  return {
    enabled,
    volume,
    cooldownMs,
    cues,
    assets,
    theme
  }
}

export function configureSoundSettings(settings?: UISoundSettings | null): void {
  currentSettings = normalizeUISoundSettings(settings)
  updateMasterGain()
  pruneDecodedAudioCache(currentSettings.assets)
}

export function getSoundSettings(): NormalizedUISoundSettings {
  return currentSettings
}

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window.AudioContext || (window as any).webkitAudioContext || null) as typeof AudioContext | null
}

function computeMasterGainValue(volume: number): number {
  // 将 0-100 映射到 0-0.2，避免 100% 时过于刺耳
  const maxGain = 0.2
  return (clampNumber(volume, 0, 100, DEFAULT_UI_SOUND_SETTINGS.volume) / 100) * maxGain
}

function updateMasterGain(): void {
  if (!masterGain) return
  masterGain.gain.value = computeMasterGainValue(currentSettings.volume)
}

function getOrCreateAudioGraph(): AudioContext | null {
  const Ctor = getAudioContextCtor()
  if (!Ctor) return null

  if (audioContext && audioContext.state !== 'closed') {
    return audioContext
  }

  audioContext = new Ctor()
  masterGain = audioContext.createGain()
  updateMasterGain()
  masterGain.connect(audioContext.destination)
  return audioContext
}

export async function unlockAudio(): Promise<{ success: boolean; error?: string }> {
  try {
    const ctx = getOrCreateAudioGraph()
    if (!ctx) {
      return { success: false, error: 'AudioContext not available' }
    }

    if (ctx.state === 'suspended') {
      await ctx.resume()
    }

    return { success: ctx.state === 'running' }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/**
 * 停止当前所有正在播放的声音（不关闭 AudioContext，避免后续需要重新解锁）
 */
export function stopAllSounds(): void {
  for (const source of Array.from(activeBufferSources)) {
    try {
      source.stop()
    } catch {
      // ignore
    }
    try {
      source.disconnect()
    } catch {
      // ignore
    }
  }
  activeBufferSources.clear()

  for (const osc of Array.from(activeOscillators)) {
    try {
      osc.stop()
    } catch {
      // ignore
    }
    try {
      osc.disconnect()
    } catch {
      // ignore
    }
  }
  activeOscillators.clear()
}

type Beep = {
  freq: number
  durationMs: number
  gapMs?: number
}

function getOscillatorType(theme: NormalizedUISoundSettings['theme']): OscillatorType {
  return theme === 'soft' ? 'sine' : 'square'
}

function getPatternForCue(cue: SoundCue): Beep[] {
  switch (cue) {
    case 'warning':
      return [{ freq: 440, durationMs: 150 }]
    case 'error':
      return [
        { freq: 220, durationMs: 120, gapMs: 80 },
        { freq: 220, durationMs: 120 }
      ]
    case 'taskComplete':
      return [
        { freq: 660, durationMs: 100, gapMs: 50 },
        { freq: 880, durationMs: 120 }
      ]
    case 'taskError':
      return [
        { freq: 196, durationMs: 120, gapMs: 80 },
        { freq: 196, durationMs: 120 }
      ]
    default:
      return []
  }
}


function base64ToArrayBuffer(base64: string): ArrayBuffer {
  // 移除可能的换行/空格
  const clean = base64.replace(/\s+/g, '')
  const binary = atob(clean)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

async function decodeAudioBuffer(ctx: AudioContext, asset: UISoundAsset): Promise<AudioBuffer> {
  const key = asset.dataBase64
  const cached = decodedAudioBufferCache.get(key)
  if (cached) return cached

  const inFlight = decodingPromises.get(key)
  if (inFlight) return inFlight

  const promise = (async () => {
    const arr = base64ToArrayBuffer(asset.dataBase64)
    const buffer = await ctx.decodeAudioData(arr)
    decodedAudioBufferCache.set(key, buffer)
    return buffer
  })()

  decodingPromises.set(key, promise)
  try {
    return await promise
  } finally {
    decodingPromises.delete(key)
  }
}

async function playSoundAsset(ctx: AudioContext, asset: UISoundAsset, abortSignal?: AbortSignal): Promise<boolean> {
  try {
    if (!masterGain) return false
    if (abortSignal?.aborted) return false

    const buffer = await decodeAudioBuffer(ctx, asset)
    if (abortSignal?.aborted) return false

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(masterGain)
    activeBufferSources.add(source)

    // decode 可能较慢：在 start 前再取一次 currentTime，避免 startAt 过期
    const startAt = ctx.currentTime + 0.01
    source.start(startAt)

    source.onended = () => {
      try {
        activeBufferSources.delete(source)
        source.disconnect()
      } catch {
        // ignore
      }
    }

    return true
  } catch (err) {
    console.warn('[soundCues] playSoundAsset failed:', err)
    return false
  }
}


async function decodeAudioBufferFromUrl(ctx: AudioContext, url: string): Promise<AudioBuffer> {
  const key = `url:${url}`
  const cached = decodedAudioBufferCache.get(key)
  if (cached) return cached

  const inFlight = decodingPromises.get(key)
  if (inFlight) return inFlight

  const promise = (async () => {
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`Failed to fetch sound: ${res.status}`)
    }
    const arr = await res.arrayBuffer()
    const buffer = await ctx.decodeAudioData(arr)
    decodedAudioBufferCache.set(key, buffer)
    return buffer
  })()

  decodingPromises.set(key, promise)
  try {
    return await promise
  } finally {
    decodingPromises.delete(key)
  }
}

async function playSoundUrl(ctx: AudioContext, url: string, abortSignal?: AbortSignal): Promise<boolean> {
  try {
    if (!masterGain) return false
    if (abortSignal?.aborted) return false

    const buffer = await decodeAudioBufferFromUrl(ctx, url)
    if (abortSignal?.aborted) return false

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(masterGain)
    activeBufferSources.add(source)

    const startAt = ctx.currentTime + 0.01
    source.start(startAt)

    source.onended = () => {
      try {
        activeBufferSources.delete(source)
        source.disconnect()
      } catch {
        // ignore
      }
    }

    return true
  } catch (err) {
    console.warn('[soundCues] playSoundUrl failed:', err)
    return false
  }
}

function isCueEnabled(cue: SoundCue): boolean {
  switch (cue) {
    case 'warning':
      return currentSettings.cues.warning
    case 'error':
      return currentSettings.cues.error
    case 'taskComplete':
      return currentSettings.cues.taskComplete
    case 'taskError':
      return currentSettings.cues.taskError
    default:
      return false
  }
}

function getCooldownKey(options: { cooldownKey?: string }): string {
  return options.cooldownKey || '__global__'
}

function setLastPlayedAt(cooldownKey: string, timestamp: number): void {
  lastPlayedAtByKey.set(cooldownKey, timestamp)

  // 简单上限控制，避免极端场景下 key 无限增长
  if (lastPlayedAtByKey.size > 200) {
    const firstKey = lastPlayedAtByKey.keys().next().value
    if (firstKey) lastPlayedAtByKey.delete(firstKey)
  }
}

export async function playCue(
  cue: SoundCue,
  options: { ignoreEnabled?: boolean; bypassCooldown?: boolean; cooldownKey?: string; abortSignal?: AbortSignal } = {}
): Promise<boolean> {
  try {
    if (options.abortSignal?.aborted) return false

    if (!options.ignoreEnabled) {
      if (!currentSettings.enabled) return false
      if (!isCueEnabled(cue)) return false
    }

    const now = Date.now()
    const cooldownKey = getCooldownKey(options)
    if (!options.bypassCooldown) {
      const cooldown = currentSettings.cooldownMs
      const lastPlayedAt = lastPlayedAtByKey.get(cooldownKey) || 0
      if (cooldown > 0 && now - lastPlayedAt < cooldown) {
        return false
      }
    }

    const ctx = getOrCreateAudioGraph()
    if (!ctx || !masterGain) return false

    // 尝试自动恢复（可能会因 autoplay 策略失败）
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume()
      } catch {
        // ignore
      }
    }
    if (options.abortSignal?.aborted) return false
    if (ctx.state !== 'running') return false

    // 优先播放自定义音效
    const asset = currentSettings.assets[cue]
    if (asset) {
      const ok = await playSoundAsset(ctx, asset, options.abortSignal)
      if (ok) {
        setLastPlayedAt(cooldownKey, now)
        return true
      }
    }

    // 默认内置提示音（resources/sound）
    const builtin = getBuiltinSoundAsset(cue)
    if (builtin?.url) {
      const ok = await playSoundUrl(ctx, builtin.url, options.abortSignal)
      if (ok) {
        setLastPlayedAt(cooldownKey, now)
        return true
      }
    }

    const pattern = getPatternForCue(cue)
    if (pattern.length === 0) return false

    const oscType = getOscillatorType(currentSettings.theme)

    // 留一点点时间给调度，避免 currentTime 太接近导致 start/stop 报错
    let t = ctx.currentTime + 0.01

    for (const beep of pattern) {
      if (options.abortSignal?.aborted) return false
      const durationSec = Math.max(0.01, beep.durationMs / 1000)

      const osc = ctx.createOscillator()
      osc.type = oscType
      osc.frequency.setValueAtTime(beep.freq, t)

      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0, t)

      // 简单包络，避免“咔哒”声
      const attack = Math.min(0.01, durationSec / 3)
      const release = Math.min(0.02, durationSec / 2)
      const sustainEnd = Math.max(t + attack, t + durationSec - release)

      gain.gain.linearRampToValueAtTime(1, t + attack)
      gain.gain.setValueAtTime(1, sustainEnd)
      gain.gain.linearRampToValueAtTime(0, t + durationSec)

      osc.connect(gain)
      gain.connect(masterGain)

      activeOscillators.add(osc)
      osc.start(t)
      osc.stop(t + durationSec + 0.03)

      osc.onended = () => {
        try {
          activeOscillators.delete(osc)
          osc.disconnect()
          gain.disconnect()
        } catch {
          // ignore
        }
      }

      t = t + durationSec + (beep.gapMs ? beep.gapMs / 1000 : 0)
    }

    setLastPlayedAt(cooldownKey, now)
    return true
  } catch (err) {
    // 绝不能影响主流程
    console.warn('[soundCues] playCue failed:', err)
    return false
  }
}
