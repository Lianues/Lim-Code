<script setup lang="ts">
/**
 * GoogleSearchConfig - Google 搜索工具配置面板
 * 
 * 功能：
 * 1. 控制是否使用专门的搜索渠道和模型
 * 2. 选择搜索时使用的渠道和模型
 * 
 * 注意：
 * - 仅支持 Gemini 渠道，因为 Google Search 工具依赖 Gemini 的 grounding 功能
 */

import { ref, computed, onMounted, reactive } from 'vue'
import { CustomCheckbox, CustomSelect, type SelectOption } from '../../../common'
import { sendToExtension } from '@/utils/vscode'
import { useI18n } from '@/composables'
import type { ModelInfo } from '@/types'

// 国际化
const { t } = useI18n()

// 渠道配置类型
interface ChannelConfig {
  id: string
  name: string
  type: string
  enabled: boolean
  model: string
  models: ModelInfo[]
}

// 配置接口
interface GoogleSearchConfig {
  useDedicatedModel: boolean
  dedicatedChannelId: string
  dedicatedModelId: string
}

// 渠道列表
const channels = ref<ChannelConfig[]>([])
const isLoadingChannels = ref(false)

// 状态
const config = reactive<GoogleSearchConfig>({
  useDedicatedModel: false,
  dedicatedChannelId: '',
  dedicatedModelId: ''
})

const isLoading = ref(false)
const isSaving = ref(false)

// 已启用的 Gemini 渠道选项（仅支持 Gemini 渠道）
const enabledGeminiChannelOptions = computed<SelectOption[]>(() => {
  return channels.value
    .filter(c => c.enabled && c.type === 'gemini')
    .map(c => ({
      value: c.id,
      label: c.name,
      description: c.type
    }))
})

// 检查是否有可用的 Gemini 渠道
const hasGeminiChannels = computed(() => enabledGeminiChannelOptions.value.length > 0)

// 检查当前选中的渠道是否有效（是 Gemini 类型）
const isSelectedChannelValid = computed(() => {
  if (!config.dedicatedChannelId) return true
  const channel = channels.value.find(c => c.id === config.dedicatedChannelId)
  return channel?.type === 'gemini'
})

// 当前选择的渠道
const selectedChannel = computed(() => {
  return channels.value.find(c => c.id === config.dedicatedChannelId)
})

// 当前渠道的模型选项
const modelOptions = computed<SelectOption[]>(() => {
  if (!selectedChannel.value || !selectedChannel.value.models) {
    return []
  }
  return selectedChannel.value.models.map(m => ({
    value: m.id,
    label: m.name || m.id,
    description: m.description
  }))
})

// 加载渠道列表
async function loadChannels() {
  isLoadingChannels.value = true
  try {
    const ids = await sendToExtension<string[]>('config.listConfigs', {})
    const loadedChannels: ChannelConfig[] = []
    
    for (const id of ids) {
      const channelConfig = await sendToExtension<ChannelConfig>('config.getConfig', { configId: id })
      if (channelConfig) {
        loadedChannels.push(channelConfig)
      }
    }
    
    channels.value = loadedChannels
  } catch (error) {
    console.error('Failed to load channels:', error)
  } finally {
    isLoadingChannels.value = false
  }
}

// 加载配置
async function loadConfig() {
  isLoading.value = true
  try {
    const response = await sendToExtension<GoogleSearchConfig>('getGoogleSearchConfig', {})
    if (response) {
      Object.assign(config, response)
    }
  } catch (error) {
    console.error('Failed to load Google Search config:', error)
  } finally {
    isLoading.value = false
  }
}

// 保存配置
async function saveConfig() {
  isSaving.value = true
  try {
    await sendToExtension('updateGoogleSearchConfig', { config: { ...config } })
  } catch (error) {
    console.error('Failed to save Google Search config:', error)
  } finally {
    isSaving.value = false
  }
}

// 处理开关变更
function handleUseDedicatedModelChange(val: boolean) {
  config.useDedicatedModel = val
  if (!val) {
    // 关闭时清空渠道和模型选择
    config.dedicatedChannelId = ''
    config.dedicatedModelId = ''
  }
  saveConfig()
}

// 更新渠道选择
function updateChannelId(channelId: string) {
  config.dedicatedChannelId = channelId
  // 切换渠道时，清空模型选择
  config.dedicatedModelId = ''
  saveConfig()
}

// 更新模型选择
function updateModelId(modelId: string) {
  config.dedicatedModelId = modelId
  saveConfig()
}

onMounted(async () => {
  await Promise.all([loadConfig(), loadChannels()])
})
</script>

<template>
  <div class="google-search-config">
    <!-- 加载状态 -->
    <div v-if="isLoading" class="loading-overlay">
      <i class="codicon codicon-loading codicon-modifier-spin"></i>
    </div>

    <!-- 配置表单 -->
    <div class="config-form">
      <!-- 使用专用模型开关 -->
      <div class="config-item">
        <div class="config-label">
          <span class="label-text">{{ t('components.settings.googleSearch.useDedicatedModel.label') }}</span>
          <span class="label-hint">{{ t('components.settings.googleSearch.useDedicatedModel.hint') }}</span>
        </div>
        <div class="config-control">
          <CustomCheckbox
            :modelValue="config.useDedicatedModel"
            :disabled="isSaving"
            @update:modelValue="handleUseDedicatedModelChange"
          />
        </div>
      </div>

      <!-- 默认提示 -->
      <div v-if="!config.useDedicatedModel" class="default-hint">
        <i class="codicon codicon-info"></i>
        <span>{{ t('components.settings.googleSearch.currentModelHint') }}</span>
      </div>

      <!-- 渠道和模型选择 -->
      <template v-if="config.useDedicatedModel">
        <!-- 渠道选择 -->
        <div class="config-item vertical">
          <div class="config-label">
            <span class="label-text">{{ t('components.settings.googleSearch.selectChannel.label') }}</span>
            <span class="label-hint">{{ t('components.settings.googleSearch.selectChannel.hint') }}</span>
          </div>
          <div class="config-control full-width">
            <CustomSelect
              :model-value="config.dedicatedChannelId"
              :options="enabledGeminiChannelOptions"
              :placeholder="t('components.settings.googleSearch.selectChannel.placeholder')"
              :disabled="isSaving || isLoadingChannels"
              @update:model-value="updateChannelId"
            />
          </div>
        </div>

        <!-- 模型选择 -->
        <div class="config-item vertical">
          <div class="config-label">
            <span class="label-text">{{ t('components.settings.googleSearch.selectModel.label') }}</span>
            <span class="label-hint">{{ t('components.settings.googleSearch.selectModel.hint') }}</span>
          </div>
          <div class="config-control full-width">
            <CustomSelect
              :model-value="config.dedicatedModelId"
              :options="modelOptions"
              :disabled="!config.dedicatedChannelId || isSaving"
              :placeholder="t('components.settings.googleSearch.selectModel.placeholder')"
              @update:model-value="updateModelId"
            />
          </div>
        </div>

        <!-- 无 Gemini 渠道警告 -->
        <div v-if="!hasGeminiChannels" class="error-hint">
          <i class="codicon codicon-error"></i>
          <span>{{ t('components.settings.googleSearch.noGeminiChannelError') }}</span>
        </div>

        <!-- 选中的渠道不是 Gemini 警告 -->
        <div v-else-if="config.dedicatedChannelId && !isSelectedChannelValid" class="error-hint">
          <i class="codicon codicon-error"></i>
          <span>{{ t('components.settings.googleSearch.invalidChannelError') }}</span>
        </div>

        <!-- 未完成配置警告 -->
        <div v-else-if="!config.dedicatedChannelId || !config.dedicatedModelId" class="warning-hint">
          <i class="codicon codicon-warning"></i>
          <span>{{ t('components.settings.googleSearch.warningHint') }}</span>
        </div>
      </template>
      
      <div v-if="isSaving" class="saving-indicator">
        <i class="codicon codicon-loading codicon-modifier-spin"></i>
        <span>{{ t('components.settings.googleSearch.saving') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.google-search-config {
  position: relative;
  padding: 12px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-top: none;
  border-bottom-left-radius: 4px;
  border-bottom-right-radius: 4px;
}

.config-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.config-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.config-item.vertical {
  flex-direction: column;
  gap: 8px;
}

.config-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.label-text {
  font-size: 13px;
  font-weight: 500;
  color: var(--vscode-foreground);
}

.label-hint {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.config-control {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.config-control.full-width {
  width: 100%;
}

/* 默认提示 */
.default-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: var(--vscode-textBlockQuote-background);
  border-radius: 4px;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.default-hint .codicon {
  font-size: 14px;
  color: var(--vscode-textLink-foreground);
}

/* 警告提示 */
.warning-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: var(--vscode-inputValidation-warningBackground);
  border: 1px solid var(--vscode-inputValidation-warningBorder);
  border-radius: 4px;
  font-size: 12px;
  color: var(--vscode-foreground);
}

.warning-hint .codicon {
  font-size: 14px;
  color: var(--vscode-list-warningForeground);
}

/* 错误提示 */
.error-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: var(--vscode-inputValidation-errorBackground);
  border: 1px solid var(--vscode-inputValidation-errorBorder);
  border-radius: 4px;
  font-size: 12px;
  color: var(--vscode-foreground);
}

.error-hint .codicon {
  font-size: 14px;
  color: var(--vscode-errorForeground);
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.1);
  z-index: 1;
}

.saving-indicator {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.codicon-modifier-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
