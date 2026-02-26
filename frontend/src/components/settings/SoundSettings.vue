<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { sendToExtension } from '@/utils/vscode'
import { useI18n } from '@/i18n'
import { CustomCheckbox } from '../common'
import { formatFileSize } from '@/utils/file'
import {
  DEFAULT_UI_SOUND_SETTINGS,
  normalizeUISoundSettings,
  configureSoundSettings,
  getSoundSettings,
  getBuiltinSoundAssets,
  unlockAudio,
  stopAllSounds,
  playCue,
  type SoundCue,
  type UISoundAsset,
  type UISoundSettings
} from '@/services/soundCues'

const { t } = useI18n()

const isLoading = ref(true)
const isSaving = ref(false)

const saveMessage = ref('')
const saveMessageType = ref<'success' | 'error'>('success')

const testMessage = ref('')
const testMessageType = ref<'success' | 'error'>('success')

const builtinAssets = getBuiltinSoundAssets()

const assetMessage = ref('')
const assetMessageType = ref<'success' | 'error'>('success')

// ============ 表单状态 ============
const enabled = ref(DEFAULT_UI_SOUND_SETTINGS.enabled)
const volume = ref(DEFAULT_UI_SOUND_SETTINGS.volume)
const cooldownMs = ref(DEFAULT_UI_SOUND_SETTINGS.cooldownMs)

const cueWarning = ref(DEFAULT_UI_SOUND_SETTINGS.cues.warning)
const cueError = ref(DEFAULT_UI_SOUND_SETTINGS.cues.error)
const cueTaskComplete = ref(DEFAULT_UI_SOUND_SETTINGS.cues.taskComplete)
const cueTaskError = ref(DEFAULT_UI_SOUND_SETTINGS.cues.taskError)

const assetWarning = ref<UISoundAsset | null>(null)
const assetError = ref<UISoundAsset | null>(null)
const assetTaskComplete = ref<UISoundAsset | null>(null)
const assetTaskError = ref<UISoundAsset | null>(null)

// 用于在保存时判断“清除音效”是否需要显式写入 null
const originalAssets = ref<{
  warning?: UISoundAsset
  error?: UISoundAsset
  taskComplete?: UISoundAsset
  taskError?: UISoundAsset
}>({})

const assetFileInputRef = ref<HTMLInputElement | null>(null)
const selectingAssetCue = ref<SoundCue | null>(null)
const MAX_ASSET_BYTES = 10 * 1024 * 1024

const theme = ref<UISoundSettings['theme']>(DEFAULT_UI_SOUND_SETTINGS.theme)

// 试听恢复保护：避免旧的 setTimeout 在用户保存/再次试听后回滚最新配置
const testRestoreVersion = ref(0)
let pendingRestoreTimer: ReturnType<typeof setTimeout> | null = null

function clearPendingTestRestore() {
  if (pendingRestoreTimer) {
    clearTimeout(pendingRestoreTimer)
    pendingRestoreTimer = null
  }
}

function toPlainAsset(asset: UISoundAsset | null | undefined): UISoundAsset | undefined {
  if (!asset) return undefined
  return {
    // 显式构造纯对象，避免把 Vue Proxy 直接 postMessage 导致 DataCloneError
    name: String(asset.name || ''),
    mime: String(asset.mime || ''),
    dataBase64: String(asset.dataBase64 || '')
  }
}

const activeTestControllers = new Set<AbortController>()

function cancelActiveTests() {
  for (const controller of Array.from(activeTestControllers)) {
    controller.abort()
  }
  activeTestControllers.clear()
}

const volumeText = computed(() => `${volume.value}%`)

function buildCurrentSettings(): UISoundSettings {
  const assets: NonNullable<UISoundSettings['assets']> = {}

  const warningAsset = toPlainAsset(assetWarning.value)
  const errorAsset = toPlainAsset(assetError.value)
  const taskCompleteAsset = toPlainAsset(assetTaskComplete.value)
  const taskErrorAsset = toPlainAsset(assetTaskError.value)

  if (warningAsset) assets.warning = warningAsset
  else if (originalAssets.value.warning) assets.warning = null

  if (errorAsset) assets.error = errorAsset
  else if (originalAssets.value.error) assets.error = null

  if (taskCompleteAsset) assets.taskComplete = taskCompleteAsset
  else if (originalAssets.value.taskComplete) assets.taskComplete = null

  if (taskErrorAsset) assets.taskError = taskErrorAsset
  else if (originalAssets.value.taskError) assets.taskError = null

  return {
    enabled: enabled.value,
    volume: Math.min(100, Math.max(0, Number(volume.value) || 0)),
    cooldownMs: Math.min(60_000, Math.max(0, Number(cooldownMs.value) || 0)),
    cues: {
      warning: cueWarning.value,
      error: cueError.value,
      taskComplete: cueTaskComplete.value,
      taskError: cueTaskError.value
    },
    assets: Object.keys(assets).length > 0 ? assets : undefined,
    theme: theme.value
  }
}

function showAssetMessage(message: string, type: 'success' | 'error') {
  assetMessage.value = message
  assetMessageType.value = type
  setTimeout(() => {
    assetMessage.value = ''
  }, 2500)
}

function triggerSelectAsset(cue: SoundCue) {
  selectingAssetCue.value = cue
  assetFileInputRef.value?.click()
}

function setAssetForCue(cue: SoundCue, asset: UISoundAsset | null) {
  switch (cue) {
    case 'warning':
      assetWarning.value = asset
      break
    case 'error':
      assetError.value = asset
      break
    case 'taskComplete':
      assetTaskComplete.value = asset
      break
    case 'taskError':
      assetTaskError.value = asset
      break
  }
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

async function handleAssetFileChange(e: Event) {
  const cue = selectingAssetCue.value
  selectingAssetCue.value = null

  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  // reset: 允许重复选择同一文件也触发 change
  input.value = ''

  if (!cue || !file) return

  if (file.size > MAX_ASSET_BYTES) {
    showAssetMessage(
      t('components.settings.soundSettings.assets.fileTooLarge', { size: formatFileSize(MAX_ASSET_BYTES) }),
      'error'
    )
    return
  }

  try {
    const dataUrl = await readFileAsDataUrl(file)
    const match = dataUrl.match(/^data:(.*?);base64,(.*)$/)
    const mime = (match?.[1] || file.type || '').trim()
    const dataBase64 = match?.[2] || ''

    if (!dataBase64) {
      showAssetMessage(t('components.settings.soundSettings.assets.invalidFile'), 'error')
      return
    }

    setAssetForCue(cue, {
      name: file.name,
      mime,
      dataBase64
    })

    showAssetMessage(
      t('components.settings.soundSettings.assets.importSuccess', { name: file.name }),
      'success'
    )
  } catch (err) {
    console.error('Failed to import sound asset:', err)
    showAssetMessage(t('components.settings.soundSettings.assets.invalidFile'), 'error')
  }
}

function clearAsset(cue: SoundCue) {
  setAssetForCue(cue, null)
  showAssetMessage(t('components.settings.soundSettings.assets.clearSuccess'), 'success')
}

async function loadConfig() {
  isLoading.value = true
  try {
    const response = await sendToExtension<any>('getSettings', {})
    const normalized = normalizeUISoundSettings(response?.settings?.ui?.sound)

    enabled.value = normalized.enabled
    volume.value = normalized.volume
    cooldownMs.value = normalized.cooldownMs

    cueWarning.value = normalized.cues.warning
    cueError.value = normalized.cues.error
    cueTaskComplete.value = normalized.cues.taskComplete
    cueTaskError.value = normalized.cues.taskError

    assetWarning.value = normalized.assets.warning ?? null
    assetError.value = normalized.assets.error ?? null
    assetTaskComplete.value = normalized.assets.taskComplete ?? null
    assetTaskError.value = normalized.assets.taskError ?? null

    originalAssets.value = {
      warning: normalized.assets.warning,
      error: normalized.assets.error,
      taskComplete: normalized.assets.taskComplete,
      taskError: normalized.assets.taskError
    }

    theme.value = normalized.theme

    // 同步到运行时（即使用户不点击保存，也保证显示与运行时一致）
    configureSoundSettings(normalized)
  } catch (error) {
    console.error('Failed to load sound settings:', error)
  } finally {
    isLoading.value = false
  }
}

async function saveConfig() {
  isSaving.value = true
  saveMessage.value = ''

  try {
    const settings = buildCurrentSettings()

    await sendToExtension('updateUISettings', {
      ui: {
        sound: settings
      }
    })

    // 立即生效
    configureSoundSettings(settings)

    // 若之前存在试听恢复定时器，取消并提升版本，避免旧回调回滚最新保存配置
    testRestoreVersion.value += 1
    clearPendingTestRestore()

    // 保存按钮属于用户手势：尝试解锁音频上下文，提升后续自动播放成功率
    if (settings.enabled) {
      void unlockAudio()
    }

    saveMessage.value = t('components.settings.soundSettings.saveSuccess')
    saveMessageType.value = 'success'

    // 更新“原始值快照”，确保后续保存/清除逻辑正确
    originalAssets.value = {
      warning: assetWarning.value ?? undefined,
      error: assetError.value ?? undefined,
      taskComplete: assetTaskComplete.value ?? undefined,
      taskError: assetTaskError.value ?? undefined
    }

    setTimeout(() => {
      saveMessage.value = ''
    }, 2000)
  } catch (error) {
    console.error('Failed to save sound settings:', error)
    saveMessage.value = t('components.settings.soundSettings.saveFailed')
    saveMessageType.value = 'error'
  } finally {
    isSaving.value = false
  }
}

async function resetToDefault() {
  enabled.value = DEFAULT_UI_SOUND_SETTINGS.enabled
  volume.value = DEFAULT_UI_SOUND_SETTINGS.volume
  cooldownMs.value = DEFAULT_UI_SOUND_SETTINGS.cooldownMs

  cueWarning.value = DEFAULT_UI_SOUND_SETTINGS.cues.warning
  cueError.value = DEFAULT_UI_SOUND_SETTINGS.cues.error
  cueTaskComplete.value = DEFAULT_UI_SOUND_SETTINGS.cues.taskComplete
  cueTaskError.value = DEFAULT_UI_SOUND_SETTINGS.cues.taskError

  assetWarning.value = null
  assetError.value = null
  assetTaskComplete.value = null
  assetTaskError.value = null

  theme.value = DEFAULT_UI_SOUND_SETTINGS.theme

  await saveConfig()
}

async function testCue(cue: SoundCue) {
  testMessage.value = ''

  // 试听应使用当前表单音量，但不应把“未保存”的 enabled/cues 等设置带到运行时。
  // 因此这里临时覆盖运行时音量，播放后再恢复。
  const prev = getSoundSettings()
  const restoreVersion = ++testRestoreVersion.value
  clearPendingTestRestore()
  const tempVolume = Math.min(100, Math.max(0, Number(volume.value) || 0))
  configureSoundSettings({
    ...prev,
    volume: tempVolume,
    assets: {
      warning: assetWarning.value ?? undefined,
      error: assetError.value ?? undefined,
      taskComplete: assetTaskComplete.value ?? undefined,
      taskError: assetTaskError.value ?? undefined
    }
  })
  const controller = new AbortController()
  activeTestControllers.add(controller)

  try {
    if (controller.signal.aborted) return
    const unlocked = await unlockAudio()
    if (!unlocked.success) {
      testMessage.value = t('components.settings.soundSettings.testBlocked')
      testMessageType.value = 'error'
      return
    }

    const ok = await playCue(cue, { ignoreEnabled: true, bypassCooldown: true, abortSignal: controller.signal })
    if (ok) {
      testMessage.value = t('components.settings.soundSettings.testPlayed')
      testMessageType.value = 'success'
    } else {
      testMessage.value = t('components.settings.soundSettings.testFailed')
      testMessageType.value = 'error'
    }
    if (controller.signal.aborted) return
  } finally {
    activeTestControllers.delete(controller)
    // 给音频调度留一点时间，避免恢复音量影响当前试听
    pendingRestoreTimer = setTimeout(() => {
      if (testRestoreVersion.value !== restoreVersion) {
        pendingRestoreTimer = null
        return
      }
      configureSoundSettings(prev)
      pendingRestoreTimer = null
    }, 800)
  }

  setTimeout(() => {
    testMessage.value = ''
  }, 2500)
}

onMounted(() => {
  loadConfig()
})

onBeforeUnmount(() => {
  // 离开设置页时中止试听并停止当前播放，避免切页后声音继续
  testRestoreVersion.value += 1
  clearPendingTestRestore()
  cancelActiveTests()
  stopAllSounds()
})
</script>

<template>
  <div class="sound-settings">
    <div v-if="isLoading" class="loading">
      <i class="codicon codicon-loading codicon-modifier-spin"></i>
      <span>{{ t('common.loading') }}</span>
    </div>

    <template v-else>
      <div class="form-group">
        <label class="group-label">
          <i class="codicon codicon-bell"></i>
          {{ t('components.settings.soundSettings.enabled.title') }}
        </label>
        <p class="field-description">{{ t('components.settings.soundSettings.enabled.description') }}</p>

        <CustomCheckbox v-model="enabled" :label="t('components.settings.soundSettings.enabled.label')" />
      </div>

      <div class="form-group">
        <label class="group-label">
          <i class="codicon codicon-unmute"></i>
          {{ t('components.settings.soundSettings.volume.title') }}
        </label>
        <p class="field-description">{{ t('components.settings.soundSettings.volume.description') }}</p>

        <div class="slider-row">
          <input
            v-model.number="volume"
            class="range"
            type="range"
            min="0"
            max="100"
            step="1"
          />
          <div class="range-value">{{ volumeText }}</div>
        </div>
      </div>

      <div class="form-group">
        <label class="group-label">
          <i class="codicon codicon-clock"></i>
          {{ t('components.settings.soundSettings.cooldown.title') }}
        </label>
        <p class="field-description">{{ t('components.settings.soundSettings.cooldown.description') }}</p>

        <div class="slider-row">
          <input
            v-model.number="cooldownMs"
            class="range"
            type="range"
            min="0"
            max="5000"
            step="100"
          />
          <div class="range-value">{{ cooldownMs }}ms</div>
        </div>
      </div>

      <div class="form-group">
        <label class="group-label">
          <i class="codicon codicon-symbol-event"></i>
          {{ t('components.settings.soundSettings.cues.title') }}
        </label>
        <p class="field-description">{{ t('components.settings.soundSettings.cues.description') }}</p>

        <div class="cues-grid">
          <CustomCheckbox v-model="cueWarning" :label="t('components.settings.soundSettings.cues.warning')" />
          <CustomCheckbox v-model="cueError" :label="t('components.settings.soundSettings.cues.error')" />
          <CustomCheckbox v-model="cueTaskComplete" :label="t('components.settings.soundSettings.cues.taskComplete')" />
          <CustomCheckbox v-model="cueTaskError" :label="t('components.settings.soundSettings.cues.taskError')" />
        </div>
      </div>

      <div class="form-group">
        <label class="group-label">
          <i class="codicon codicon-file-media"></i>
          {{ t('components.settings.soundSettings.assets.title') }}
        </label>
        <p class="field-description">
          {{
            t('components.settings.soundSettings.assets.description', {
              size: formatFileSize(MAX_ASSET_BYTES)
            })
          }}
        </p>

        <input
          ref="assetFileInputRef"
          type="file"
          accept="audio/*"
          style="display: none"
          @change="handleAssetFileChange"
        />

        <div class="assets-list">
          <div class="asset-row">
            <div class="asset-row-left">
              <div class="asset-row-title">{{ t('components.settings.soundSettings.cues.warning') }}</div>
              <div class="asset-row-value">
                {{ assetWarning?.name || builtinAssets.warning?.name || t('components.settings.soundSettings.assets.none') }}
              </div>
            </div>
            <div class="asset-row-actions">
              <button class="action-btn" @click="triggerSelectAsset('warning')">
                <i class="codicon codicon-folder-opened"></i>
                {{ t('components.settings.soundSettings.assets.choose') }}
              </button>
              <button v-if="assetWarning" class="action-btn" @click="clearAsset('warning')">
                <i class="codicon codicon-trash"></i>
                {{ t('components.settings.soundSettings.assets.clear') }}
              </button>
            </div>
          </div>

          <div class="asset-row">
            <div class="asset-row-left">
              <div class="asset-row-title">{{ t('components.settings.soundSettings.cues.error') }}</div>
              <div class="asset-row-value">
                {{ assetError?.name || builtinAssets.error?.name || t('components.settings.soundSettings.assets.none') }}
              </div>
            </div>
            <div class="asset-row-actions">
              <button class="action-btn" @click="triggerSelectAsset('error')">
                <i class="codicon codicon-folder-opened"></i>
                {{ t('components.settings.soundSettings.assets.choose') }}
              </button>
              <button v-if="assetError" class="action-btn" @click="clearAsset('error')">
                <i class="codicon codicon-trash"></i>
                {{ t('components.settings.soundSettings.assets.clear') }}
              </button>
            </div>
          </div>

          <div class="asset-row">
            <div class="asset-row-left">
              <div class="asset-row-title">{{ t('components.settings.soundSettings.cues.taskComplete') }}</div>
              <div class="asset-row-value">
                {{ assetTaskComplete?.name || builtinAssets.taskComplete?.name || t('components.settings.soundSettings.assets.none') }}
              </div>
            </div>
            <div class="asset-row-actions">
              <button class="action-btn" @click="triggerSelectAsset('taskComplete')">
                <i class="codicon codicon-folder-opened"></i>
                {{ t('components.settings.soundSettings.assets.choose') }}
              </button>
              <button v-if="assetTaskComplete" class="action-btn" @click="clearAsset('taskComplete')">
                <i class="codicon codicon-trash"></i>
                {{ t('components.settings.soundSettings.assets.clear') }}
              </button>
            </div>
          </div>

          <div class="asset-row">
            <div class="asset-row-left">
              <div class="asset-row-title">{{ t('components.settings.soundSettings.cues.taskError') }}</div>
              <div class="asset-row-value">
                {{ assetTaskError?.name || builtinAssets.taskError?.name || builtinAssets.error?.name || t('components.settings.soundSettings.assets.none') }}
              </div>
            </div>
            <div class="asset-row-actions">
              <button class="action-btn" @click="triggerSelectAsset('taskError')">
                <i class="codicon codicon-folder-opened"></i>
                {{ t('components.settings.soundSettings.assets.choose') }}
              </button>
              <button v-if="assetTaskError" class="action-btn" @click="clearAsset('taskError')">
                <i class="codicon codicon-trash"></i>
                {{ t('components.settings.soundSettings.assets.clear') }}
              </button>
            </div>
          </div>
        </div>

        <span v-if="assetMessage" class="test-message" :class="assetMessageType">
          {{ assetMessage }}
        </span>
      </div>

      <div class="form-group">
        <label class="group-label">
          <i class="codicon codicon-play"></i>
          {{ t('components.settings.soundSettings.test.title') }}
        </label>
        <p class="field-description">{{ t('components.settings.soundSettings.test.description') }}</p>

        <div class="test-buttons">
          <button class="action-btn" @click="testCue('warning')">
            {{ t('components.settings.soundSettings.test.warning') }}
          </button>
          <button class="action-btn" @click="testCue('error')">
            {{ t('components.settings.soundSettings.test.error') }}
          </button>
          <button class="action-btn" @click="testCue('taskComplete')">
            {{ t('components.settings.soundSettings.test.taskComplete') }}
          </button>
          <button class="action-btn" @click="testCue('taskError')">
            {{ t('components.settings.soundSettings.test.taskError') }}
          </button>
        </div>

        <span v-if="testMessage" class="test-message" :class="testMessageType">
          {{ testMessage }}
        </span>
      </div>

      <div class="actions">
        <button class="action-btn primary" @click="saveConfig" :disabled="isSaving">
          <i v-if="isSaving" class="codicon codicon-loading codicon-modifier-spin"></i>
          <span v-else>{{ t('common.save') }}</span>
        </button>

        <button class="action-btn" @click="resetToDefault" :disabled="isSaving">
          <i class="codicon codicon-discard"></i>
          {{ t('common.reset') }}
        </button>

        <span v-if="saveMessage" class="save-message" :class="saveMessageType">
          {{ saveMessage }}
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sound-settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.loading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--vscode-descriptionForeground);
  padding: 16px 0;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
}

.group-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
}

.group-label .codicon {
  font-size: 14px;
}

.field-description {
  margin: 0 0 8px 0;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.range {
  flex: 1;
}

.range-value {
  min-width: 70px;
  text-align: right;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.cues-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.assets-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.asset-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  background: var(--vscode-editorWidget-background);
}

.asset-row-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.asset-row-title {
  font-size: 12px;
  font-weight: 500;
}

.asset-row-value {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 360px;
}

.asset-row-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.asset-row .action-btn {
  padding: 4px 10px;
}

.test-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.action-btn:hover:not(:disabled) {
  background: var(--vscode-button-secondaryHoverBackground);
}

.action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.action-btn.primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.save-message,
.test-message {
  font-size: 12px;
}

.save-message.success,
.test-message.success {
  color: var(--vscode-testing-iconPassed);
}

.save-message.error,
.test-message.error {
  color: var(--vscode-testing-iconFailed);
}
</style>
