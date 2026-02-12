<script setup lang="ts">
/**
 * SummarizeSettings - 总结设置面板
 * 配置上下文总结功能
 */

import { reactive, ref, computed, onMounted, watch } from 'vue'
import { CustomCheckbox, CustomSelect, type SelectOption } from '../common'
import { sendToExtension } from '@/utils/vscode'
import { useI18n } from '@/i18n'
import type { ModelInfo } from '@/types'

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

// 渠道列表
const channels = ref<ChannelConfig[]>([])
const isLoadingChannels = ref(false)

// 总结配置
const summarizeConfig = reactive({
  // 手动总结提示词
  summarizePrompt: '请将以上对话内容进行总结，保留关键信息和上下文要点，去除冗余内容。',
  // 自动总结提示词
  autoSummarizePrompt: '',
  // 保留最近 N 轮不总结
  keepRecentRounds: 2,
  // 使用专门的总结模型
  useSeparateModel: false,
  // 总结用的渠道 ID
  summarizeChannelId: '',
  // 总结用的模型 ID
  summarizeModelId: ''
})

// 内置默认总结配置（用于“恢复内置默认”）
const defaultSummarizeConfig = ref({
  summarizePrompt: summarizeConfig.summarizePrompt,
  autoSummarizePrompt: summarizeConfig.autoSummarizePrompt
})

const hasManualDefaultPrompt = computed(() =>
  !!defaultSummarizeConfig.value.summarizePrompt?.trim()
)

const hasAutoDefaultPrompt = computed(() =>
  !!defaultSummarizeConfig.value.autoSummarizePrompt?.trim()
)

async function restorePromptToDefault(kind: 'manual' | 'auto') {
  const field = kind === 'manual' ? 'summarizePrompt' : 'autoSummarizePrompt'
  const value = kind === 'manual' ? defaultSummarizeConfig.value.summarizePrompt : defaultSummarizeConfig.value.autoSummarizePrompt
  await updateConfigField(field, value)
}

// 已启用的渠道选项
const enabledChannelOptions = computed<SelectOption[]>(() => {
  return channels.value
    .filter(c => c.enabled)
    .map(c => ({
      value: c.id,
      label: c.name,
      description: c.type
    }))
})

// 当前选择的渠道
const selectedChannel = computed(() => {
  return channels.value.find(c => c.id === summarizeConfig.summarizeChannelId)
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
      const config = await sendToExtension<ChannelConfig>('config.getConfig', { configId: id })
      if (config) {
        loadedChannels.push(config)
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
  try {
    const response = await sendToExtension<any>('getSummarizeConfig', {})
    if (response) {
      const merged = { ...response }

      // 历史配置兼容：如果提示词为空，前端展示内置默认值（避免显示空白）
      if (typeof merged.summarizePrompt !== 'string' || !merged.summarizePrompt.trim()) {
        merged.summarizePrompt = defaultSummarizeConfig.value.summarizePrompt
      }
      if (typeof merged.autoSummarizePrompt !== 'string' || !merged.autoSummarizePrompt.trim()) {
        merged.autoSummarizePrompt = defaultSummarizeConfig.value.autoSummarizePrompt
      }

      Object.assign(summarizeConfig, merged)
    }
  } catch (error) {
    console.error('Failed to load summarize config:', error)
  }
}

// 加载内置默认配置（用于恢复按钮）
async function loadDefaultConfig() {
  try {
    const response = await sendToExtension<any>('getDefaultSummarizeConfig', {})
    if (response) {
      defaultSummarizeConfig.value = {
        summarizePrompt:
          typeof response.summarizePrompt === 'string'
            ? response.summarizePrompt
            : summarizeConfig.summarizePrompt,
        autoSummarizePrompt:
          typeof response.autoSummarizePrompt === 'string'
            ? response.autoSummarizePrompt
            : summarizeConfig.autoSummarizePrompt
      }
    }
  } catch (error) {
    console.error('Failed to load default summarize config:', error)
  }
}

// 更新配置字段（即时保存）
async function updateConfigField(field: string, value: any) {
  // 先更新本地值
  (summarizeConfig as any)[field] = value
  
  // 保存到后端
  try {
    await sendToExtension('updateSummarizeConfig', {
      config: { ...summarizeConfig }
    })
  } catch (error) {
    console.error('Failed to save summarize config:', error)
  }
}

// 更新渠道选择
async function updateChannelId(channelId: string) {
  summarizeConfig.summarizeChannelId = channelId
  // 切换渠道时，清空模型选择
  summarizeConfig.summarizeModelId = ''
  
  // 保存到后端
  try {
    await sendToExtension('updateSummarizeConfig', {
      config: { ...summarizeConfig }
    })
  } catch (error) {
    console.error('Failed to save summarize config:', error)
  }
}

// 更新模型选择
async function updateModelId(modelId: string) {
  summarizeConfig.summarizeModelId = modelId
  
  // 保存到后端
  try {
    await sendToExtension('updateSummarizeConfig', {
      config: { ...summarizeConfig }
    })
  } catch (error) {
    console.error('Failed to save summarize config:', error)
  }
}

// 监听专用模型开关
watch(() => summarizeConfig.useSeparateModel, (enabled) => {
  if (!enabled) {
    // 关闭时清空渠道和模型选择
    summarizeConfig.summarizeChannelId = ''
    summarizeConfig.summarizeModelId = ''
  }
})

// 初始化
onMounted(async () => {
  await loadDefaultConfig()
  await Promise.all([loadConfig(), loadChannels()])
})
</script>

<template>
  <div class="summarize-settings">
    <!-- 功能说明 -->
    <div class="feature-description">
      <i class="codicon codicon-info"></i>
      <p>
        {{ t('components.settings.summarizeSettings.description') }}
      </p>
    </div>
    
    <!-- 手动总结说明 -->
    <div class="section">
      <h5 class="section-title">
        <i class="codicon codicon-fold"></i>
        {{ t('components.settings.summarizeSettings.manualSection.title') }}
      </h5>
      <p class="section-description">
        {{ t('components.settings.summarizeSettings.manualSection.description') }}
      </p>
    </div>
    
    <!-- 总结选项 -->
    <div class="section">
      <h5 class="section-title">
        <i class="codicon codicon-settings"></i>
        {{ t('components.settings.summarizeSettings.optionsSection.title') }}
      </h5>
      
      <div class="form-group">
        <label>{{ t('components.settings.summarizeSettings.optionsSection.keepRounds') }}</label>
        <div class="rounds-input">
          <input
            type="number"
            :value="summarizeConfig.keepRecentRounds"
            min="0"
            max="10"
            @input="(e: any) => updateConfigField('keepRecentRounds', Number(e.target.value))"
          />
          <span class="unit">{{ t('components.settings.summarizeSettings.optionsSection.keepRoundsUnit') }}</span>
        </div>
        <p class="field-hint">{{ t('components.settings.summarizeSettings.optionsSection.keepRoundsHint') }}</p>
      </div>
      
      <div class="form-group">
        <div class="prompt-label-row">
          <label>{{ t('components.settings.summarizeSettings.optionsSection.manualPrompt') }}</label>
          <button
            type="button"
            class="restore-default-btn"
            :disabled="!hasManualDefaultPrompt"
            @click="restorePromptToDefault('manual')"
          >{{ t('components.settings.summarizeSettings.optionsSection.restoreBuiltin') }}</button>
        </div>
        <textarea
          :value="summarizeConfig.summarizePrompt"
          rows="3"
          :placeholder="t('components.settings.summarizeSettings.optionsSection.manualPromptPlaceholder')"
          @input="(e: any) => updateConfigField('summarizePrompt', e.target.value)"
        ></textarea>
        <p class="field-hint">{{ t('components.settings.summarizeSettings.optionsSection.manualPromptHint') }}</p>
      </div>

      <div class="form-group">
        <div class="prompt-label-row">
          <label>{{ t('components.settings.summarizeSettings.optionsSection.autoPrompt') }}</label>
          <button
            type="button"
            class="restore-default-btn"
            :disabled="!hasAutoDefaultPrompt"
            @click="restorePromptToDefault('auto')"
          >{{ t('components.settings.summarizeSettings.optionsSection.restoreBuiltin') }}</button>
        </div>
        <textarea
          :value="summarizeConfig.autoSummarizePrompt"
          rows="5"
          :placeholder="t('components.settings.summarizeSettings.optionsSection.autoPromptPlaceholder')"
          @input="(e: any) => updateConfigField('autoSummarizePrompt', e.target.value)"
        ></textarea>
        <p class="field-hint">{{ t('components.settings.summarizeSettings.optionsSection.autoPromptHint') }}</p>
      </div>
    </div>
    
    <!-- 专用总结模型 -->
    <div class="section">
      <h5 class="section-title">
        <i class="codicon codicon-beaker"></i>
        {{ t('components.settings.summarizeSettings.modelSection.title') }}
      </h5>
      
      <div class="form-group">
        <CustomCheckbox
          :model-value="summarizeConfig.useSeparateModel"
          :label="t('components.settings.summarizeSettings.modelSection.useSeparate')"
          @update:model-value="(v: boolean) => updateConfigField('useSeparateModel', v)"
        />
        <p class="field-hint">
          {{ t('components.settings.summarizeSettings.modelSection.useSeparateHint') }}
        </p>
      </div>
      
      <div class="default-model-hint" v-if="!summarizeConfig.useSeparateModel">
        <i class="codicon codicon-info"></i>
        <span>{{ t('components.settings.summarizeSettings.modelSection.currentModelHint') }}</span>
      </div>
      
      <template v-if="summarizeConfig.useSeparateModel">
        <!-- 渠道选择 -->
        <div class="form-group">
          <label>{{ t('components.settings.summarizeSettings.modelSection.selectChannel') }}</label>
          <CustomSelect
            :model-value="summarizeConfig.summarizeChannelId"
            :options="enabledChannelOptions"
            :placeholder="t('components.settings.summarizeSettings.modelSection.selectChannelPlaceholder')"
            @update:model-value="updateChannelId"
          />
          <p class="field-hint">{{ t('components.settings.summarizeSettings.modelSection.selectChannelHint') }}</p>
        </div>
        
        <!-- 模型选择 -->
        <div class="form-group">
          <label>{{ t('components.settings.summarizeSettings.modelSection.selectModel') }}</label>
          <CustomSelect
            :model-value="summarizeConfig.summarizeModelId"
            :options="modelOptions"
            :disabled="!summarizeConfig.summarizeChannelId"
            :placeholder="t('components.settings.summarizeSettings.modelSection.selectModelPlaceholder')"
            @update:model-value="updateModelId"
          />
          <p class="field-hint">
            {{ t('components.settings.summarizeSettings.modelSection.selectModelHint') }}
          </p>
        </div>
        
        <!-- 选择状态提示 -->
        <div v-if="!summarizeConfig.summarizeChannelId || !summarizeConfig.summarizeModelId" class="warning-hint">
          <i class="codicon codicon-warning"></i>
          <span>{{ t('components.settings.summarizeSettings.modelSection.warningHint') }}</span>
        </div>
      </template>
    </div>
    
  </div>
</template>

<style scoped>
.summarize-settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 功能说明 */
.feature-description {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  background: var(--vscode-textBlockQuote-background);
  border-left: 3px solid var(--vscode-textLink-foreground);
  border-radius: 0 4px 4px 0;
}

.feature-description .codicon {
  flex-shrink: 0;
  color: var(--vscode-textLink-foreground);
}

.feature-description p {
  margin: 0;
  font-size: 12px;
  color: var(--vscode-foreground);
  line-height: 1.5;
}

/* 分区 */
.section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--vscode-foreground);
}

.section-title .codicon {
  font-size: 14px;
}

.section-description {
  margin: 0;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.5;
}

/* 徽章 */
.badge {
  padding: 2px 6px;
  font-size: 10px;
  font-weight: normal;
  border-radius: 10px;
  margin-left: auto;
}

.badge.coming-soon {
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
}

/* 表单组 */
.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-group.disabled {
  opacity: 0.5;
  pointer-events: none;
}

.form-group label {
  font-size: 12px;
  color: var(--vscode-foreground);
}

.prompt-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.restore-default-btn {
  padding: 2px 8px;
  font-size: 11px;
  color: var(--vscode-textLink-foreground);
  background: transparent;
  border: 1px solid var(--vscode-textLink-foreground);
  border-radius: 4px;
  cursor: pointer;
  line-height: 1.4;
  transition: opacity 0.15s, background-color 0.15s;
}

.restore-default-btn:hover:not(:disabled) {
  background: var(--vscode-list-hoverBackground);
}

.restore-default-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  border-color: var(--vscode-disabledForeground);
  color: var(--vscode-disabledForeground);
}

.form-group input[type="number"],
.form-group textarea {
  padding: 6px 10px;
  font-size: 13px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  border-radius: 4px;
  outline: none;
  transition: border-color 0.15s;
}

/* 隐藏数字输入框的上下箭头 */
.form-group input[type="number"] {
  appearance: textfield;
  -moz-appearance: textfield; /* Firefox */
}

.form-group input[type="number"]::-webkit-outer-spin-button,
.form-group input[type="number"]::-webkit-inner-spin-button {
  appearance: none;
  -webkit-appearance: none;
  margin: 0;
}

.form-group input[type="number"]:focus,
.form-group textarea:focus {
  border-color: var(--vscode-focusBorder);
}

.form-group textarea {
  resize: vertical;
  min-height: 60px;
  font-family: inherit;
}

.field-hint {
  margin: 0;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

/* 阈值输入 */
.threshold-input,
.rounds-input {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 120px;
}

.threshold-input input,
.rounds-input input {
  flex: 1;
  min-width: 0;
}

.unit {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

/* 默认模型提示 */
.default-model-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: var(--vscode-textBlockQuote-background);
  border-radius: 4px;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.default-model-hint .codicon {
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
  margin-top: 8px;
}

.warning-hint .codicon {
  font-size: 14px;
  color: var(--vscode-list-warningForeground);
}

</style>