<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { CustomSelect, ConfirmDialog, type SelectOption } from '../common'
import ModelManager from './ModelManager.vue'
import {
  GeminiOptions,
  OpenAIOptions,
  OpenAIResponsesOptions,
  AnthropicOptions,
  CustomBodySettings,
  CustomHeadersSettings,
  ToolOptionsSettings,
  TokenCountMethodSettings
} from './channels'
import { sendToExtension } from '@/utils/vscode'
import { useChatStore } from '@/stores'
import type { ModelInfo } from '@/types'
import { t } from '@/i18n'

// Chat Store - 用于同步配置状态
const chatStore = useChatStore()

// 配置列表
const configs = ref<any[]>([])
const currentConfigId = ref<string>('')
const isLoading = ref(false)

// 编辑模式
const isEditing = ref(false)
const editingName = ref('')
const editInput = ref<HTMLInputElement>()

// 新建配置对话框
const showNewDialog = ref(false)
const newConfigName = ref('')
const newConfigType = ref<'gemini' | 'openai' | 'openai-responses' | 'anthropic'>('gemini')

// API Key 显示
const showApiKey = ref(false)

// 高级选项展开状态
const showAdvancedOptions = ref(false)

// 自定义标头展开状态
const showCustomHeaders = ref(false)

// 自定义 body 展开状态
const showCustomBody = ref(false)

// 自动重试展开状态
const showRetryOptions = ref(false)

// 上下文阈值展开状态
const showContextThreshold = ref(false)

// 工具配置展开状态
const showToolOptions = ref(false)

// Token 计数方式展开状态
const showTokenCountMethod = ref(false)

// 确认对话框
const showConfirmDialog = ref(false)
const confirmDialogTitle = ref('')
const confirmDialogMessage = ref('')
const confirmDialogAction = ref<() => void>(() => {})

// 获取类型显示名称
function getTypeName(type: string): string {
  const key = `components.settings.channelSettings.form.channelType.${type}` as const
  return t(key)
}

// 更新options字段
async function updateOption(optionKey: string, value: any) {
  if (!currentConfig.value) return
  
  const currentOptions = currentConfig.value.options || {}
  const updatedOptions = {
    ...currentOptions,
    [optionKey]: value
  }
  
  await updateConfigField('options', updatedOptions)
}

// 更新配置项启用状态（可选同时更新 option 值，避免竞态条件）
async function updateOptionEnabled(optionKey: string, enabled: boolean, optionValue?: any) {
  if (!currentConfig.value) return
  
  const currentOptionsEnabled = currentConfig.value.optionsEnabled || {}
  const updatedOptionsEnabled = {
    ...currentOptionsEnabled,
    [optionKey]: enabled
  }
  
  if (optionValue !== undefined) {
    // 同时更新 optionsEnabled 和 options，避免竞态条件
    const currentOptions = currentConfig.value.options || {}
    const updatedOptions = {
      ...currentOptions,
      [optionKey]: optionValue
    }
    
    // 合并为单个更新，避免两个请求相互覆盖
    await updateConfigFields({
      optionsEnabled: updatedOptionsEnabled,
      options: updatedOptions
    })
  } else {
    await updateConfigField('optionsEnabled', updatedOptionsEnabled)
  }
}

// 当前配置
const currentConfig = computed(() => 
  configs.value.find(c => c.id === currentConfigId.value)
)

// 配置选项
const configOptions = computed<SelectOption[]>(() =>
  configs.value.map(config => ({
    value: config.id,
    label: config.name,
    description: config.type
  }))
)

// 类型选项
const typeOptions = computed<SelectOption[]>(() => [
  { value: 'gemini', label: t('components.settings.channelSettings.form.channelType.gemini'), description: 'Google Gemini' },
  { value: 'openai', label: t('components.settings.channelSettings.form.channelType.openai'), description: 'OpenAI Compatible' },
  { value: 'openai-responses', label: t('components.settings.channelSettings.form.channelType.openai-responses'), description: 'OpenAI Responses API' },
  { value: 'anthropic', label: t('components.settings.channelSettings.form.channelType.anthropic'), description: 'Anthropic Claude' }
])

// 工具调用格式选项
const toolModeOptions = computed<SelectOption[]>(() => [
  {
    value: 'function_call',
    label: t('components.settings.channelSettings.form.toolMode.functionCall.label'),
    description: t('components.settings.channelSettings.form.toolMode.functionCall.description')
  },
  {
    value: 'xml',
    label: t('components.settings.channelSettings.form.toolMode.xml.label'),
    description: t('components.settings.channelSettings.form.toolMode.xml.description')
  },
  {
    value: 'json',
    label: t('components.settings.channelSettings.form.toolMode.json.label'),
    description: t('components.settings.channelSettings.form.toolMode.json.description')
  }
])

// 自定义标头类型
interface CustomHeader {
  key: string
  value: string
  enabled: boolean
}

// 获取当前自定义标头
const customHeaders = computed<CustomHeader[]>(() => {
  return currentConfig.value?.customHeaders || []
})

// 自定义标头功能是否启用
const customHeadersEnabled = computed(() => {
  return currentConfig.value?.customHeadersEnabled ?? false
})

// 更新自定义标头启用状态
async function updateCustomHeadersEnabled(enabled: boolean) {
  await updateConfigField('customHeadersEnabled', enabled)
}

// 更新自定义标头列表
async function updateCustomHeaders(headers: CustomHeader[]) {
  await updateConfigField('customHeaders', headers)
}

// ==================== 自定义 Body ====================

// 自定义 body 项类型
interface CustomBodyItem {
  key: string
  value: string
  enabled: boolean
}

// 自定义 body 配置类型
interface CustomBodyConfig {
  mode: 'simple' | 'advanced'
  items?: CustomBodyItem[]
  json?: string
}

// 获取当前自定义 body 配置
const customBody = computed<CustomBodyConfig>(() => {
  return currentConfig.value?.customBody || { mode: 'simple', items: [], json: '' }
})

// 自定义 body 功能是否启用
const customBodyEnabled = computed(() => {
  return currentConfig.value?.customBodyEnabled ?? false
})

// 更新自定义 body 启用状态
async function updateCustomBodyEnabled(enabled: boolean) {
  await updateConfigField('customBodyEnabled', enabled)
}

// 更新自定义 body 配置
async function updateCustomBodyConfig(config: CustomBodyConfig) {
  await updateConfigField('customBody', config)
}

// ==================== 自动重试 ====================

// 重试功能是否启用（默认启用）
const retryEnabled = computed(() => {
  return currentConfig.value?.retryEnabled ?? true
})

// 重试次数
const retryCount = computed(() => {
  return currentConfig.value?.retryCount ?? 3
})

// 重试间隔
const retryInterval = computed(() => {
  return currentConfig.value?.retryInterval ?? 3000
})

// 更新重试启用状态
async function updateRetryEnabled(enabled: boolean) {
  await updateConfigField('retryEnabled', enabled)
}

// 更新重试次数
async function updateRetryCount(count: number) {
  await updateConfigField('retryCount', count)
}

// 更新重试间隔
async function updateRetryInterval(interval: number) {
  await updateConfigField('retryInterval', interval)
}

// ==================== 工具配置 ====================

// 工具配置类型
interface CropImageToolOptions {
  useNormalizedCoordinates?: boolean
}

interface ToolOptions {
  cropImage?: CropImageToolOptions
}

// 获取当前工具配置
const toolOptions = computed<ToolOptions>(() => {
  return currentConfig.value?.toolOptions || {}
})

// 更新工具配置
async function updateToolOptions(config: ToolOptions) {
  await updateConfigField('toolOptions', config)
}

// ==================== 上下文阈值 ====================

// 上下文阈值是否启用
const contextThresholdEnabled = computed(() => {
  return currentConfig.value?.contextThresholdEnabled ?? false
})

// 上下文阈值值
const contextThreshold = computed(() => {
  return currentConfig.value?.contextThreshold ?? '80%'
})

// 自动总结是否启用
const autoSummarizeEnabled = computed(() => {
  return currentConfig.value?.autoSummarizeEnabled ?? false
})

// 裁剪时额外裁剪量
const contextTrimExtraCut = computed(() => {
  return currentConfig.value?.contextTrimExtraCut ?? 0
})

// 更新上下文阈值启用状态
async function updateContextThresholdEnabled(enabled: boolean) {
  await updateConfigField('contextThresholdEnabled', enabled)
}

// 更新上下文阈值
async function updateContextThreshold(value: string) {
  // 验证格式：数值 或 百分比
  const numValue = parseFloat(value)
  if (value.endsWith('%')) {
    const percent = parseFloat(value.replace('%', ''))
    if (!isNaN(percent) && percent > 0 && percent <= 100) {
      await updateConfigField('contextThreshold', value)
    }
  } else if (!isNaN(numValue) && numValue > 0) {
    await updateConfigField('contextThreshold', numValue)
  }
}

// 更新自动总结启用状态
async function updateAutoSummarizeEnabled(enabled: boolean) {
  await updateConfigField('autoSummarizeEnabled', enabled)
}

// 更新裁剪时额外裁剪量
async function updateContextTrimExtraCut(value: string | number) {
  // 验证格式：数值 或 百分比
  if (typeof value === 'string') {
    if (value === '' || value === '0') {
      await updateConfigField('contextTrimExtraCut', 0)
    } else if (value.endsWith('%')) {
      const percent = parseFloat(value.replace('%', ''))
      if (!isNaN(percent) && percent >= 0 && percent <= 100) {
        await updateConfigField('contextTrimExtraCut', value)
      }
    } else {
      const numValue = parseFloat(value)
      if (!isNaN(numValue) && numValue >= 0) {
        await updateConfigField('contextTrimExtraCut', numValue)
      }
    }
  } else if (typeof value === 'number' && value >= 0) {
    await updateConfigField('contextTrimExtraCut', value)
  }
}


// 加载配置列表
async function loadConfigs() {
  isLoading.value = true
  try {
    const ids = await sendToExtension<string[]>('config.listConfigs', {})
    configs.value = []
    
    for (const id of ids) {
      const config = await sendToExtension('config.getConfig', { configId: id })
      if (config) {
        configs.value.push(config)
      }
    }
    
    // 不在这里自动选择配置，让 onMounted 统一处理
  } catch (error) {
    console.error('Failed to load configs:', error)
  } finally {
    isLoading.value = false
  }
}

// 创建新配置
async function createConfig() {
  if (!newConfigName.value.trim()) return
  
  try {
    // 只传递必要参数，其他由后端提供默认值
    const configId = await sendToExtension<string>('config.createConfig', {
      type: newConfigType.value,
      name: newConfigName.value.trim()
    })
    
    await loadConfigs()
    currentConfigId.value = configId
    showNewDialog.value = false
    newConfigName.value = ''
  } catch (error) {
    console.error('Failed to create config:', error)
  }
}

// 显示确认对话框
function showConfirm(title: string, message: string, action: () => void) {
  confirmDialogTitle.value = title
  confirmDialogMessage.value = message
  confirmDialogAction.value = action
  showConfirmDialog.value = true
}

// 格式化确认消息（支持变量替换）
function formatMessage(message: string, name: string): string {
  return message.replace('{name}', name)
}

// 确认对话框确认回调
function onConfirmDialogConfirm() {
  confirmDialogAction.value()
}

// 删除当前配置
async function deleteCurrentConfig() {
  if (!currentConfig.value) return
  if (configs.value.length <= 1) {
    showConfirm(
      t('components.settings.channelSettings.dialog.delete.title'),
      t('components.settings.channelSettings.dialog.delete.atLeastOne'),
      () => {}
    )
    return
  }
  
  showConfirm(
    t('components.settings.channelSettings.dialog.delete.title'),
    formatMessage(t('components.settings.channelSettings.dialog.delete.message'), currentConfig.value.name),
    async () => {
      try {
        await sendToExtension('config.deleteConfig', {
          configId: currentConfig.value!.id
        })
        await loadConfigs()
      } catch (error) {
        console.error('Failed to delete config:', error)
      }
    }
  )
}

// 开始编辑
async function startEditing() {
  if (!currentConfig.value) return
  editingName.value = currentConfig.value.name
  isEditing.value = true
  await nextTick()
  editInput.value?.focus()
  editInput.value?.select()
}

// 保存编辑
async function saveEditing() {
  if (!editingName.value.trim() || !currentConfig.value) {
    isEditing.value = false
    return
  }
  
  try {
    await sendToExtension('config.updateConfig', {
      configId: currentConfig.value.id,
      updates: { name: editingName.value.trim() }
    })
    await loadConfigs()
  } catch (error) {
    console.error('Failed to update config:', error)
  }
  
  isEditing.value = false
}

// 取消编辑
function cancelEditing() {
  isEditing.value = false
  editingName.value = ''
}

// 处理键盘事件
function handleEditKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    saveEditing()
  } else if (e.key === 'Escape') {
    cancelEditing()
  }
}

// 取消新建
function cancelNew() {
  showNewDialog.value = false
  newConfigName.value = ''
}

// 更新多个配置字段（单个请求，避免竞态条件）
async function updateConfigFields(updates: Record<string, any>) {
  if (!currentConfig.value) return
  
  try {
    // 确保数据可序列化（深拷贝移除响应式代理）
    const serializableUpdates: Record<string, any> = {}
    for (const [field, value] of Object.entries(updates)) {
      serializableUpdates[field] = JSON.parse(JSON.stringify(value))
    }
    
    await sendToExtension('config.updateConfig', {
      configId: currentConfig.value.id,
      updates: serializableUpdates
    })
    
    // 直接在本地更新配置值
    const configIndex = configs.value.findIndex(c => c.id === currentConfig.value!.id)
    if (configIndex !== -1) {
      configs.value[configIndex] = {
        ...configs.value[configIndex],
        ...serializableUpdates
      }
    }
    
    // 如果修改的是当前使用的配置，同步到 chatStore
    if (currentConfig.value.id === chatStore.configId) {
      await chatStore.loadCurrentConfig()
    }
  } catch (error) {
    console.error('Failed to update config fields:', error)
  }
}

// 更新配置字段
async function updateConfigField(field: string, value: any) {
  if (!currentConfig.value) return
  
  try {
    // 确保数据可序列化（深拷贝移除响应式代理）
    let serializableValue = JSON.parse(JSON.stringify(value))
    
    // 特殊处理 models 字段
    if (field === 'models' && Array.isArray(serializableValue)) {
      serializableValue = serializableValue.map((m: any) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        contextWindow: m.contextWindow,
        maxOutputTokens: m.maxOutputTokens
      }))
    }
    
    await sendToExtension('config.updateConfig', {
      configId: currentConfig.value.id,
      updates: { [field]: serializableValue }
    })
    
    // 直接在本地更新配置值，避免重新加载导致滚动位置丢失
    const configIndex = configs.value.findIndex(c => c.id === currentConfig.value!.id)
    if (configIndex !== -1) {
      configs.value[configIndex] = {
        ...configs.value[configIndex],
        [field]: serializableValue
      }
    }
    
    // 如果修改的是当前使用的配置，同步到 chatStore
    if (currentConfig.value.id === chatStore.configId) {
      await chatStore.loadCurrentConfig()
    }
  } catch (error) {
    console.error('Failed to update config:', error)
  }
}

// 更新模型列表
async function handleUpdateModels(models: ModelInfo[]) {
  await updateConfigField('models', models)
}

// 更新当前选择的模型
async function handleUpdateSelectedModel(modelId: string) {
  await updateConfigField('model', modelId)
}

// 是否已完成初始化（防止初始化时的 watch 触发同步）
const isInitialized = ref(false)

// 监听 currentConfigId 变化，同步到 chatStore（仅在初始化完成后）
watch(currentConfigId, (newId) => {
  if (isInitialized.value && newId && newId !== chatStore.configId) {
    chatStore.setConfigId(newId)
  }
})

// 监听 chatStore.configId 变化，同步到本地
watch(() => chatStore.configId, (newId) => {
  if (newId && newId !== currentConfigId.value && configs.value.some(c => c.id === newId)) {
    currentConfigId.value = newId
  }
})

// 初始化
onMounted(async () => {
  await loadConfigs()
  
  // 优先使用 chatStore 的配置 ID
  if (chatStore.configId && configs.value.some(c => c.id === chatStore.configId)) {
    currentConfigId.value = chatStore.configId
  } else if (configs.value.length > 0 && !currentConfigId.value) {
    // 如果 chatStore 没有配置或配置不存在，才选择第一个
    currentConfigId.value = configs.value[0].id
  }
  
  // 标记初始化完成
  isInitialized.value = true
})
</script>

<template>
  <div class="channel-settings">
    <!-- 确认对话框 -->
    <ConfirmDialog
      v-model="showConfirmDialog"
      :title="confirmDialogTitle"
      :message="confirmDialogMessage"
      :is-danger="confirmDialogTitle === t('components.settings.channelSettings.dialog.delete.title')"
      :confirm-text="t('components.settings.channelSettings.dialog.delete.confirm')"
      :cancel-text="t('components.settings.channelSettings.dialog.delete.cancel')"
      @confirm="onConfirmDialogConfirm"
    />
    <!-- 配置选择器 -->
    <div class="config-selector">
      <!-- 编辑模式：输入框 + 确认/取消按钮 -->
      <template v-if="isEditing">
        <input
          ref="editInput"
          v-model="editingName"
          type="text"
          class="config-input"
          :placeholder="t('components.settings.channelSettings.selector.inputPlaceholder')"
          @keydown="handleEditKeydown"
        />
        <button class="icon-btn confirm" :title="t('components.settings.channelSettings.selector.confirm')" @click="saveEditing">
          <i class="codicon codicon-check"></i>
        </button>
        <button class="icon-btn cancel" :title="t('components.settings.channelSettings.selector.cancel')" @click="cancelEditing">
          <i class="codicon codicon-close"></i>
        </button>
      </template>
      
      <!-- 正常模式：自定义下拉框 -->
      <div v-else class="config-select-wrapper">
        <CustomSelect
          v-model="currentConfigId"
          :options="configOptions"
          :placeholder="t('components.settings.channelSettings.selector.placeholder')"
        />
      </div>
      
      <button v-if="!isEditing" class="icon-btn" :title="t('components.settings.channelSettings.selector.rename')" @click="startEditing">
        <i class="codicon codicon-edit"></i>
      </button>
      
      <button v-if="!isEditing" class="icon-btn" :title="t('components.settings.channelSettings.selector.add')" @click="showNewDialog = true">
        <i class="codicon codicon-add"></i>
      </button>
      
      <button
        v-if="!isEditing"
        class="icon-btn danger"
        :title="t('components.settings.channelSettings.selector.delete')"
        :disabled="configs.length <= 1"
        @click="deleteCurrentConfig"
      >
        <i class="codicon codicon-trash"></i>
      </button>
    </div>
    
    <!-- 新建对话框 -->
    <div v-if="showNewDialog" class="config-dialog">
      <div class="dialog-content">
        <h4>{{ t('components.settings.channelSettings.dialog.new.title') }}</h4>
        
        <div class="form-group">
          <label>{{ t('components.settings.channelSettings.dialog.new.nameLabel') }}</label>
          <input
            v-model="newConfigName"
            type="text"
            :placeholder="t('components.settings.channelSettings.dialog.new.namePlaceholder')"
            @keyup.enter="createConfig"
          />
        </div>
        
        <div class="form-group">
          <label>{{ t('components.settings.channelSettings.dialog.new.typeLabel') }}</label>
          <CustomSelect
            v-model="newConfigType"
            :options="typeOptions"
            :placeholder="t('components.settings.channelSettings.dialog.new.typePlaceholder')"
          />
        </div>
        
        <div class="dialog-actions">
          <button class="btn secondary" @click="cancelNew">{{ t('components.settings.channelSettings.dialog.new.cancel') }}</button>
          <button class="btn primary" @click="createConfig">{{ t('components.settings.channelSettings.dialog.new.create') }}</button>
        </div>
      </div>
    </div>
    
    <!-- 配置表单 -->
    <div v-if="currentConfig" class="config-form">
      <div class="form-group">
        <label>{{ t('components.settings.channelSettings.form.apiUrl.label') }}</label>
        <input
          :value="currentConfig.url"
          type="text"
          :placeholder="currentConfig.type === 'openai-responses' 
            ? t('components.settings.channelSettings.form.apiUrl.placeholderResponses') 
            : t('components.settings.channelSettings.form.apiUrl.placeholder')"
          @input="(e: any) => updateConfigField('url', e.target.value)"
        />
      </div>
      
      <div class="form-group">
        <label>{{ t('components.settings.channelSettings.form.apiKey.label') }}</label>
        <div class="input-with-action">
          <input
            :type="showApiKey ? 'text' : 'password'"
            :value="currentConfig.apiKey"
            :placeholder="t('components.settings.channelSettings.form.apiKey.placeholder')"
            @input="(e: any) => updateConfigField('apiKey', e.target.value)"
          />
          <button
            class="input-action-btn"
            :title="showApiKey ? t('components.settings.channelSettings.form.apiKey.hide') : t('components.settings.channelSettings.form.apiKey.show')"
            @click="showApiKey = !showApiKey"
          >
            <i :class="['codicon', showApiKey ? 'codicon-eye-closed' : 'codicon-eye']"></i>
          </button>
        </div>
        
        <!-- 使用 Authorization 格式（仅 Gemini 和 Anthropic） -->
        <div v-if="currentConfig.type === 'gemini' || currentConfig.type === 'anthropic'" class="checkbox-group api-key-option">
          <label class="custom-checkbox">
            <input
              type="checkbox"
              :checked="currentConfig.useAuthorizationHeader ?? false"
              @change="(e: any) => updateConfigField('useAuthorizationHeader', e.target.checked)"
            />
            <span class="checkmark"></span>
            <span class="checkbox-text">{{ t('components.settings.channelSettings.form.apiKey.useAuthorization') }}</span>
          </label>
          <span class="field-hint api-key-hint">
            {{ currentConfig.type === 'gemini'
              ? t('components.settings.channelSettings.form.apiKey.useAuthorizationHintGemini')
              : t('components.settings.channelSettings.form.apiKey.useAuthorizationHintAnthropic')
            }}
          </span>
        </div>
      </div>
      
      <!-- 模型管理器 -->
      <div class="form-group">
        <ModelManager
          :config-id="currentConfig.id"
          :models="currentConfig.models || []"
          :selected-model="currentConfig.model || ''"
          @update:models="handleUpdateModels"
          @update:selected-model="handleUpdateSelectedModel"
        />
      </div>
      
      <!-- 流式输出 -->
      <div class="form-group checkbox-group">
        <label class="custom-checkbox">
          <input
            type="checkbox"
            :checked="currentConfig.options?.stream ?? false"
            @change="(e: any) => updateOption('stream', e.target.checked)"
          />
          <span class="checkmark"></span>
          <span class="checkbox-text">{{ t('components.settings.channelSettings.form.stream.label') }}</span>
        </label>
      </div>
      
      <!-- 渠道类型显示 -->
      <div class="form-group">
        <label>{{ t('components.settings.channelSettings.form.channelType.label') }}</label>
        <div class="type-display">
          <span class="type-badge">{{ getTypeName(currentConfig.type) }}</span>
        </div>
      </div>
      
      <!-- 工具调用格式 -->
      <div class="form-group">
        <label>{{ t('components.settings.channelSettings.form.toolMode.label') }}</label>
        <CustomSelect
          :model-value="currentConfig.toolMode || 'function_call'"
          :options="toolModeOptions"
          :placeholder="t('components.settings.channelSettings.form.toolMode.placeholder')"
          @update:model-value="(v: string) => updateConfigField('toolMode', v)"
        />
        <span class="field-hint">
          {{ t('components.settings.channelSettings.form.toolMode.hint.functionCall') }}<br>
          {{ t('components.settings.channelSettings.form.toolMode.hint.xml') }}<br>
          {{ t('components.settings.channelSettings.form.toolMode.hint.json') }}
        </span>
        <!-- OpenAI Function Call 模式警告 -->
        <div v-if="currentConfig.type === 'openai' && (currentConfig.toolMode === 'function_call' || !currentConfig.toolMode)" class="tool-mode-warning">
          <i class="codicon codicon-warning"></i>
          <span>{{ t('components.settings.channelSettings.form.toolMode.openaiWarning') }}</span>
        </div>
      </div>
      
      <!-- 多模态工具 -->
      <div class="form-group">
        <div class="checkbox-with-hint">
          <label class="custom-checkbox">
            <input
              type="checkbox"
              :checked="currentConfig.multimodalToolsEnabled ?? false"
              @change="(e: any) => updateConfigField('multimodalToolsEnabled', e.target.checked)"
            />
            <span class="checkmark"></span>
            <span class="checkbox-text">{{ t('components.settings.channelSettings.form.multimodal.label') }}</span>
          </label>
          <div class="multimodal-support-info">
            <div class="support-header">{{ t('components.settings.channelSettings.form.multimodal.supportedTypes') }}</div>
            <div class="support-list">
              <div class="support-item">
                <span class="type-label">{{ t('components.settings.channelSettings.form.multimodal.image') }}</span>
                <span class="type-formats">{{ t('components.settings.channelSettings.form.multimodal.imageFormats') }}</span>
              </div>
              <div class="support-item">
                <span class="type-label">{{ t('components.settings.channelSettings.form.multimodal.document') }}</span>
                <span class="type-formats">{{ t('components.settings.channelSettings.form.multimodal.documentFormats') }}</span>
              </div>
            </div>
            
            <div class="support-header" style="margin-top: 8px;">{{ t('components.settings.channelSettings.form.multimodal.capabilities') }}</div>
            <div class="channel-support-table detailed">
              <div class="channel-row header-row">
                <span class="channel-name">{{ t('components.settings.channelSettings.form.multimodal.table.channel') }}</span>
                <span class="channel-feature">{{ t('components.settings.channelSettings.form.multimodal.table.readImage') }}</span>
                <span class="channel-feature">{{ t('components.settings.channelSettings.form.multimodal.table.readDocument') }}</span>
                <span class="channel-feature">{{ t('components.settings.channelSettings.form.multimodal.table.generateImage') }}</span>
                <span class="channel-feature">{{ t('components.settings.channelSettings.form.multimodal.table.historyMultimodal') }}</span>
              </div>
              <div class="channel-row" :class="{ current: currentConfig.type === 'gemini' }">
                <span class="channel-name">{{ t('components.settings.channelSettings.form.multimodal.channels.geminiAll') }}</span>
                <span class="channel-feature support-yes">✓</span>
                <span class="channel-feature support-yes">✓</span>
                <span class="channel-feature support-yes">✓</span>
                <span class="channel-feature support-yes">✓</span>
              </div>
              <div class="channel-row" :class="{ current: currentConfig.type === 'anthropic' }">
                <span class="channel-name">{{ t('components.settings.channelSettings.form.multimodal.channels.anthropicAll') }}</span>
                <span class="channel-feature support-yes">✓</span>
                <span class="channel-feature support-yes">✓</span>
                <span class="channel-feature support-yes">✓</span>
                <span class="channel-feature support-yes">✓</span>
              </div>
              <div class="channel-row" :class="{ current: currentConfig.type === 'openai-responses' }">
                <span class="channel-name">{{ t('components.settings.channelSettings.form.multimodal.channels.openaiResponses') }}</span>
                <span class="channel-feature support-yes">✓</span>
                <span class="channel-feature support-yes">✓</span>
                <span class="channel-feature support-no">✗</span>
                <span class="channel-feature support-yes">✓</span>
              </div>
              <div class="channel-row" :class="{ current: currentConfig.type === 'openai' && currentConfig.toolMode !== 'function_call' }">
                <span class="channel-name">{{ t('components.settings.channelSettings.form.multimodal.channels.openaiXmlJson') }}</span>
                <span class="channel-feature support-yes">✓</span>
                <span class="channel-feature support-no">✗</span>
                <span class="channel-feature support-yes">✓</span>
                <span class="channel-feature support-yes">✓</span>
              </div>
              <div class="channel-row" :class="{ current: currentConfig.type === 'openai' && currentConfig.toolMode === 'function_call' }">
                <span class="channel-name">{{ t('components.settings.channelSettings.form.multimodal.channels.openaiFunction') }}</span>
                <span class="channel-feature support-no">✗</span>
                <span class="channel-feature support-no">✗</span>
                <span class="channel-feature support-no">✗</span>
                <span class="channel-feature support-no">✗</span>
              </div>
            </div>
            
            <div class="support-legend">
              <span class="legend-item">
                <span class="legend-symbol support-yes">✓</span>
                <span class="legend-text">{{ t('components.settings.channelSettings.form.multimodal.legend.supported') }}</span>
              </span>
              <span class="legend-item">
                <span class="legend-symbol support-no">✗</span>
                <span class="legend-text">{{ t('components.settings.channelSettings.form.multimodal.legend.notSupported') }}</span>
              </span>
            </div>
            
            <div class="support-notes">
              <div class="note-item highlight">
                <i class="codicon codicon-lightbulb note-icon"></i>
                <span class="note-text">{{ t('components.settings.channelSettings.form.multimodal.notes.requireEnable') }}</span>
              </div>
              <div class="note-item">
                <i class="codicon codicon-info note-icon"></i>
                <span class="note-text">{{ t('components.settings.channelSettings.form.multimodal.notes.userAttachment') }}</span>
              </div>
              <div class="note-item">
                <i class="codicon codicon-info note-icon"></i>
                <span class="note-text">{{ t('components.settings.channelSettings.form.multimodal.notes.geminiAnthropic') }}</span>
              </div>
              <div class="note-item">
                <i class="codicon codicon-info note-icon"></i>
                <span class="note-text">{{ t('components.settings.channelSettings.form.multimodal.notes.openaiResponses') }}</span>
              </div>
              <div class="note-item">
                <i class="codicon codicon-info note-icon"></i>
                <span class="note-text">{{ t('components.settings.channelSettings.form.multimodal.notes.openaiXmlJson') }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div class="form-group">
        <label>{{ t('components.settings.channelSettings.form.timeout.label') }}</label>
        <input
          :value="currentConfig.timeout"
          type="number"
          :placeholder="t('components.settings.channelSettings.form.timeout.placeholder')"
          @input="(e: any) => updateConfigField('timeout', Number(e.target.value))"
        />
      </div>
      
      <div class="form-group">
        <label>{{ t('components.settings.channelSettings.form.maxContextTokens.label') }}</label>
        <input
          :value="currentConfig.maxContextTokens || 128000"
          type="number"
          :placeholder="t('components.settings.channelSettings.form.maxContextTokens.placeholder')"
          @input="(e: any) => updateConfigField('maxContextTokens', Number(e.target.value))"
        />
        <span class="field-hint">{{ t('components.settings.channelSettings.form.maxContextTokens.hint') }}</span>
      </div>
      
      <!-- 上下文阈值设置 -->
      <div class="form-group">
        <button
          class="advanced-toggle"
          @click="showContextThreshold = !showContextThreshold"
        >
          <i :class="['codicon', showContextThreshold ? 'codicon-chevron-down' : 'codicon-chevron-right']"></i>
          <span>{{ t('components.settings.channelSettings.form.contextManagement.title') }}</span>
          <label class="toggle-switch header-toggle" :title="t('components.settings.channelSettings.form.contextManagement.enableTitle')" @click.stop>
            <input
              type="checkbox"
              :checked="contextThresholdEnabled"
              @change="(e: any) => updateContextThresholdEnabled(e.target.checked)"
            />
            <span class="toggle-slider"></span>
          </label>
        </button>
        
        <div v-if="showContextThreshold" class="custom-panel-wrapper">
          <div class="context-threshold-options">
            <div class="option-item option-with-toggle">
              <div class="option-header">
                <label>{{ t('components.settings.channelSettings.form.contextManagement.threshold.label') }}</label>
              </div>
              <input
                type="text"
                :value="contextThreshold"
                :placeholder="t('components.settings.channelSettings.form.contextManagement.threshold.placeholder')"
                :disabled="!contextThresholdEnabled"
                :class="{ disabled: !contextThresholdEnabled }"
                @input="(e: any) => updateContextThreshold(e.target.value)"
              />
              <span class="option-hint">
                {{ t('components.settings.channelSettings.form.contextManagement.threshold.hint') }}
              </span>
            </div>
            
            <div class="option-item option-with-toggle">
              <div class="option-header">
                <label>{{ t('components.settings.channelSettings.form.contextManagement.extraCut.label') }}</label>
              </div>
              <input
                type="text"
                :value="contextTrimExtraCut"
                :placeholder="t('components.settings.channelSettings.form.contextManagement.extraCut.placeholder')"
                :disabled="!contextThresholdEnabled"
                :class="{ disabled: !contextThresholdEnabled }"
                @input="(e: any) => updateContextTrimExtraCut(e.target.value)"
              />
              <span class="option-hint">
                {{ t('components.settings.channelSettings.form.contextManagement.extraCut.hint') }}
              </span>
            </div>
            
            <div class="option-item option-with-toggle">
              <div class="option-header">
                <label>{{ t('components.settings.channelSettings.form.contextManagement.autoSummarize.label') }}</label>
                <label class="toggle-switch" :title="t('components.settings.channelSettings.form.contextManagement.autoSummarize.enableTitle')" @click.stop>
                  <input
                    type="checkbox"
                    :checked="autoSummarizeEnabled"
                    disabled
                    @change="(e: any) => updateAutoSummarizeEnabled(e.target.checked)"
                  />
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <span class="option-hint">
                {{ t('components.settings.channelSettings.form.contextManagement.autoSummarize.hint') }}
              </span>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 工具配置 -->
      <div class="form-group">
        <button
          class="advanced-toggle"
          @click="showToolOptions = !showToolOptions"
        >
          <i :class="['codicon', showToolOptions ? 'codicon-chevron-down' : 'codicon-chevron-right']"></i>
          <span>{{ t('components.settings.channelSettings.form.toolOptions.title') }}</span>
        </button>
        
        <div v-if="showToolOptions" class="custom-panel-wrapper">
          <ToolOptionsSettings
            :tool-options="toolOptions"
            @update:config="updateToolOptions"
          />
        </div>
      </div>
      
      <!-- Token 计数方式 -->
      <div class="form-group">
        <button
          class="advanced-toggle"
          @click="showTokenCountMethod = !showTokenCountMethod"
        >
          <i :class="['codicon', showTokenCountMethod ? 'codicon-chevron-down' : 'codicon-chevron-right']"></i>
          <span>{{ t('components.channels.tokenCountMethod.title') }}</span>
        </button>
        
        <div v-if="showTokenCountMethod" class="custom-panel-wrapper">
          <TokenCountMethodSettings
            :token-count-method="currentConfig.tokenCountMethod || 'channel_default'"
            :token-count-api-config="currentConfig.tokenCountApiConfig || {}"
            :channel-type="currentConfig.type"
            @update:token-count-method="(v: string) => updateConfigField('tokenCountMethod', v)"
            @update:token-count-api-config="(v: any) => updateConfigField('tokenCountApiConfig', v)"
          />
        </div>
      </div>
      
      <!-- 高级选项 -->
      <div class="form-group">
        <button
          class="advanced-toggle"
          @click="showAdvancedOptions = !showAdvancedOptions"
        >
          <i :class="['codicon', showAdvancedOptions ? 'codicon-chevron-down' : 'codicon-chevron-right']"></i>
          <span>{{ t('components.settings.channelSettings.form.advancedOptions.title') }}</span>
        </button>
        
        <div v-if="showAdvancedOptions" class="advanced-options">
          <!-- Gemini 选项 -->
          <GeminiOptions
            v-if="currentConfig.type === 'gemini'"
            :config="currentConfig"
            @update:option="updateOption"
            @update:option-enabled="updateOptionEnabled"
            @update:field="updateConfigField"
          />
          
          <!-- OpenAI 选项 -->
          <OpenAIOptions
            v-if="currentConfig.type === 'openai'"
            :config="currentConfig"
            @update:option="updateOption"
            @update:option-enabled="updateOptionEnabled"
            @update:field="updateConfigField"
          />
          
          <!-- OpenAI Responses 选项 -->
          <OpenAIResponsesOptions
            v-if="currentConfig.type === 'openai-responses'"
            :config="currentConfig"
            @update:option="updateOption"
            @update:option-enabled="updateOptionEnabled"
            @update:field="updateConfigField"
          />
          
          <!-- Anthropic 选项 -->
          <AnthropicOptions
            v-if="currentConfig.type === 'anthropic'"
            :config="currentConfig"
            @update:option="updateOption"
            @update:option-enabled="updateOptionEnabled"
            @update:field="updateConfigField"
          />
        </div>
      </div>
      
      <!-- 自定义 Body -->
      <div class="form-group">
        <button
          class="advanced-toggle"
          @click="showCustomBody = !showCustomBody"
        >
          <i :class="['codicon', showCustomBody ? 'codicon-chevron-down' : 'codicon-chevron-right']"></i>
          <span>{{ t('components.settings.channelSettings.form.customBody.title') }}</span>
          <label class="toggle-switch header-toggle" :title="t('components.settings.channelSettings.form.customBody.enableTitle')" @click.stop>
            <input
              type="checkbox"
              :checked="customBodyEnabled"
              @change="(e: any) => updateCustomBodyEnabled(e.target.checked)"
            />
            <span class="toggle-slider"></span>
          </label>
        </button>
        
        <div v-if="showCustomBody" class="custom-panel-wrapper">
          <CustomBodySettings
            :custom-body="customBody"
            :enabled="customBodyEnabled"
            @update:enabled="updateCustomBodyEnabled"
            @update:config="updateCustomBodyConfig"
          />
        </div>
      </div>
      
      <!-- 自定义标头 -->
      <div class="form-group">
        <button
          class="advanced-toggle"
          @click="showCustomHeaders = !showCustomHeaders"
        >
          <i :class="['codicon', showCustomHeaders ? 'codicon-chevron-down' : 'codicon-chevron-right']"></i>
          <span>{{ t('components.settings.channelSettings.form.customHeaders.title') }}</span>
          <label class="toggle-switch header-toggle" :title="t('components.settings.channelSettings.form.customHeaders.enableTitle')" @click.stop>
            <input
              type="checkbox"
              :checked="customHeadersEnabled"
              @change="(e: any) => updateCustomHeadersEnabled(e.target.checked)"
            />
            <span class="toggle-slider"></span>
          </label>
        </button>
        
        <div v-if="showCustomHeaders" class="custom-panel-wrapper">
          <CustomHeadersSettings
            :headers="customHeaders"
            :enabled="customHeadersEnabled"
            @update:enabled="updateCustomHeadersEnabled"
            @update:headers="updateCustomHeaders"
          />
        </div>
      </div>
      
      <!-- 自动重试 -->
      <div class="form-group">
        <button
          class="advanced-toggle"
          @click="showRetryOptions = !showRetryOptions"
        >
          <i :class="['codicon', showRetryOptions ? 'codicon-chevron-down' : 'codicon-chevron-right']"></i>
          <span>{{ t('components.settings.channelSettings.form.autoRetry.title') }}</span>
          <label class="toggle-switch header-toggle" :title="t('components.settings.channelSettings.form.autoRetry.enableTitle')" @click.stop>
            <input
              type="checkbox"
              :checked="retryEnabled"
              @change="(e: any) => updateRetryEnabled(e.target.checked)"
            />
            <span class="toggle-slider"></span>
          </label>
        </button>
        
        <div v-if="showRetryOptions" class="custom-panel-wrapper">
          <div class="retry-options">
            <div class="option-item option-with-toggle">
              <div class="option-header">
                <label>{{ t('components.settings.channelSettings.form.autoRetry.retryCount.label') }}</label>
              </div>
              <input
                type="number"
                :value="retryCount"
                min="1"
                max="10"
                :disabled="!retryEnabled"
                :class="{ disabled: !retryEnabled }"
                @input="(e: any) => updateRetryCount(Number(e.target.value))"
              />
              <span class="option-hint">{{ t('components.settings.channelSettings.form.autoRetry.retryCount.hint') }}</span>
            </div>
            
            <div class="option-item option-with-toggle">
              <div class="option-header">
                <label>{{ t('components.settings.channelSettings.form.autoRetry.retryInterval.label') }}</label>
              </div>
              <input
                type="number"
                :value="retryInterval"
                min="1000"
                max="60000"
                step="1000"
                :disabled="!retryEnabled"
                :class="{ disabled: !retryEnabled }"
                @input="(e: any) => updateRetryInterval(Number(e.target.value))"
              />
              <span class="option-hint">{{ t('components.settings.channelSettings.form.autoRetry.retryInterval.hint') }}</span>
            </div>
          </div>
        </div>
      </div>
      
      <div class="form-group checkbox-group">
        <label class="custom-checkbox">
          <input
            type="checkbox"
            :checked="currentConfig.enabled"
            @change="(e: any) => updateConfigField('enabled', e.target.checked)"
          />
          <span class="checkmark"></span>
          <span class="checkbox-text">{{ t('components.settings.channelSettings.form.enabled.label') }}</span>
        </label>
      </div>
    </div>
  </div>
</template>

<style scoped>
.channel-settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 配置选择器 */
.config-selector {
  display: flex;
  gap: 8px;
  align-items: center;
}

.config-select-wrapper {
  flex: 1;
  min-width: 0;
}

.config-input {
  flex: 1;
  padding: 6px 10px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  border-radius: 2px;
  font-size: 13px;
}

.config-input:focus {
  outline: none;
  border-color: var(--vscode-focusBorder);
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 2px;
  color: var(--vscode-foreground);
  cursor: pointer;
}

.icon-btn:hover {
  background: var(--vscode-toolbar-hoverBackground);
}

.icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.icon-btn.danger:hover:not(:disabled) {
  color: var(--vscode-errorForeground);
}

.icon-btn.confirm:hover {
  color: var(--vscode-charts-green, #89d185);
}

.icon-btn.cancel:hover {
  color: var(--vscode-errorForeground, #f48771);
}

/* 对话框 */
.config-dialog {
  padding: 16px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 2px;
}

.dialog-content h4 {
  margin: 0 0 16px 0;
  font-size: 13px;
  font-weight: 500;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.btn {
  padding: 6px 12px;
  border: none;
  border-radius: 2px;
  font-size: 12px;
  cursor: pointer;
}

.btn.primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.btn.primary:hover {
  background: var(--vscode-button-hoverBackground);
}

.btn.secondary {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}

.btn.secondary:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}

/* 表单 */
.config-form {
  padding-top: 8px;
  border-top: 1px solid var(--vscode-panel-border);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-group label {
  font-size: 12px;
  font-weight: 500;
  color: var(--vscode-foreground);
}

.form-group input[type="text"],
.form-group input[type="password"],
.form-group input[type="number"] {
  padding: 6px 10px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  border-radius: 2px;
  font-size: 13px;
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

.form-group input:focus {
  outline: none;
  border-color: var(--vscode-focusBorder);
}

/* 带操作按钮的输入框 */
.input-with-action {
  display: flex;
  gap: 4px;
}

.input-with-action input {
  flex: 1;
}

.input-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  padding: 0;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: none;
  border-radius: 2px;
  cursor: pointer;
}

.input-action-btn:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}

/* 自定义勾选框 */
.checkbox-group {
  flex-direction: row;
  align-items: center;
}

.custom-checkbox {
  display: flex;
  align-items: center;
  cursor: pointer;
  font-size: 13px;
  font-weight: normal;
  position: relative;
  padding-left: 26px;
  user-select: none;
}

.custom-checkbox input {
  position: absolute;
  opacity: 0;
  cursor: pointer;
  height: 0;
  width: 0;
}

.custom-checkbox .checkmark {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  height: 16px;
  width: 16px;
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
  border-radius: 3px;
  transition: all 0.15s;
}

.custom-checkbox:hover .checkmark {
  border-color: var(--vscode-focusBorder);
}

.custom-checkbox input:checked ~ .checkmark {
  background: var(--vscode-button-background);
  border-color: var(--vscode-button-background);
}

.custom-checkbox .checkmark::after {
  content: '';
  position: absolute;
  display: none;
  left: 5px;
  top: 2px;
  width: 4px;
  height: 8px;
  border: solid var(--vscode-button-foreground);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.custom-checkbox input:checked ~ .checkmark::after {
  display: block;
}

.checkbox-text {
  margin-left: 4px;
}

/* 类型显示 */
.type-display {
  padding: 6px 10px;
  background: var(--vscode-textBlockQuote-background);
  border-radius: 2px;
}

.type-badge {
  font-size: 12px;
  font-family: var(--vscode-editor-font-family);
  color: var(--vscode-foreground);
  opacity: 0.8;
}

/* 高级选项 */
.advanced-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: none;
  border-radius: 2px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s;
}

.advanced-toggle:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}

.advanced-toggle .codicon {
  font-size: 14px;
}

.advanced-options {
  margin-top: 12px;
  padding: 12px;
  background: var(--vscode-textBlockQuote-background);
  border-radius: 2px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.option-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.option-item label {
  font-size: 11px;
  font-weight: 500;
  color: var(--vscode-foreground);
  opacity: 0.9;
}

.option-item input[type="number"] {
  padding: 5px 8px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  border-radius: 2px;
  font-size: 12px;
  appearance: textfield;
  -moz-appearance: textfield; /* Firefox */
}

/* 隐藏数字输入框的上下箭头 */
.option-item input[type="number"]::-webkit-outer-spin-button,
.option-item input[type="number"]::-webkit-inner-spin-button {
  appearance: none;
  -webkit-appearance: none;
  margin: 0;
}

.option-item input[type="number"]:focus {
  outline: none;
  border-color: var(--vscode-focusBorder);
}

.option-hint {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  opacity: 0.8;
}

.option-item.checkbox-option {
  flex-direction: row;
  align-items: center;
}

.option-item.checkbox-option .custom-checkbox {
  padding-left: 22px;
}

.option-item.checkbox-option .checkmark {
  width: 14px;
  height: 14px;
}

.option-item.checkbox-option .checkbox-text {
  font-size: 11px;
}

/* 带开关的配置项 */
.option-item.option-with-toggle {
  position: relative;
}

.option-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.option-header label:first-child {
  font-size: 11px;
  font-weight: 500;
  color: var(--vscode-foreground);
  opacity: 0.9;
}

/* 开关样式 */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 32px;
  height: 16px;
  cursor: pointer;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
  border-radius: 8px;
  transition: all 0.2s;
}

.toggle-slider::before {
  position: absolute;
  content: "";
  height: 10px;
  width: 10px;
  left: 2px;
  bottom: 2px;
  background-color: var(--vscode-foreground);
  opacity: 0.6;
  border-radius: 50%;
  transition: all 0.2s;
}

.toggle-switch input:checked + .toggle-slider {
  background-color: var(--vscode-button-background);
  border-color: var(--vscode-button-background);
}

.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(16px);
  background-color: var(--vscode-button-foreground);
  opacity: 1;
}

.toggle-switch:hover .toggle-slider {
  border-color: var(--vscode-focusBorder);
}

/* 禁用状态的输入框 */
.option-item input.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 字段提示文字 */
.field-hint {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.5;
  opacity: 0.8;
}

/* 选项分组 */
.option-section {
  margin-top: 8px;
  padding: 12px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
}

.option-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.option-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--vscode-foreground);
}

.option-section-title .codicon {
  font-size: 14px;
  color: var(--vscode-charts-yellow, #ddb92f);
}

.option-section-title .codicon-history {
  color: var(--vscode-charts-blue, #3794ff);
}

.history-thought-section {
  margin-top: 12px;
}

.option-section-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.option-section-content.disabled {
  opacity: 0.5;
  pointer-events: none;
}

/* 单选按钮组 */
.radio-group {
  display: flex;
  gap: 16px;
}

.radio-option {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 12px;
}

.radio-option.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.radio-option input {
  display: none;
}

.radio-mark {
  width: 14px;
  height: 14px;
  border: 1px solid var(--vscode-input-border);
  border-radius: 50%;
  background: var(--vscode-input-background);
  position: relative;
  transition: all 0.15s;
}

.radio-option:hover:not(.disabled) .radio-mark {
  border-color: var(--vscode-focusBorder);
}

.radio-option input:checked + .radio-mark {
  border-color: var(--vscode-button-background);
}

.radio-option input:checked + .radio-mark::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vscode-button-background);
}

.radio-text {
  color: var(--vscode-foreground);
}

/* 标头面板的开关放在按钮右侧 */
.advanced-toggle .header-toggle {
  margin-left: auto;
}

/* 通用面板包装器 */
.custom-panel-wrapper {
  margin-top: 12px;
  padding: 12px;
  background: var(--vscode-textBlockQuote-background);
  border-radius: 2px;
}

/* 带提示的勾选框容器 */
.checkbox-with-hint {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.checkbox-with-hint .custom-checkbox {
  padding-left: 26px;
}

.checkbox-with-hint .field-hint {
  margin-left: 26px;
}

/* 多模态支持信息 */
.multimodal-support-info {
  margin-left: 26px;
  margin-top: 8px;
  padding: 10px 12px;
  background: var(--vscode-textBlockQuote-background);
  border-radius: 4px;
  font-size: 11px;
}

.multimodal-support-info .support-header {
  font-weight: 500;
  color: var(--vscode-foreground);
  margin-bottom: 6px;
}

.multimodal-support-info .support-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.multimodal-support-info .support-item {
  display: flex;
  gap: 8px;
}

.multimodal-support-info .type-label {
  color: var(--vscode-descriptionForeground);
  min-width: 40px;
}

.multimodal-support-info .type-formats {
  color: var(--vscode-foreground);
}

/* 渠道支持表格 */
.channel-support-table {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 10px;
}

.channel-support-table.detailed {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  overflow: hidden;
}

.channel-row {
  display: grid;
  grid-template-columns: 120px repeat(4, 1fr);
  gap: 4px;
  padding: 4px 6px;
  border-radius: 2px;
}

.channel-support-table.detailed .channel-row {
  border-radius: 0;
}

.channel-row.header-row {
  background: var(--vscode-editor-background);
  font-weight: 500;
  color: var(--vscode-foreground);
  opacity: 0.8;
}

.channel-row.current {
  background: rgba(0, 122, 204, 0.15);
}

.channel-row .channel-name {
  font-weight: 500;
}

.channel-row .channel-feature {
  text-align: center;
}

.channel-feature.support-yes {
  color: var(--vscode-charts-green, #89d185);
}

.channel-feature.support-no {
  color: var(--vscode-errorForeground, #f48771);
}

.channel-feature.support-partial {
  color: var(--vscode-charts-yellow, #ddb92f);
}

/* 图例 */
.support-legend {
  display: flex;
  gap: 16px;
  margin-top: 8px;
  font-size: 10px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.legend-symbol {
  font-weight: bold;
}

.legend-text {
  color: var(--vscode-descriptionForeground);
}

/* 支持说明 */
.support-notes {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.note-item {
  display: flex;
  gap: 6px;
  align-items: flex-start;
}

.note-item.warning {
  color: var(--vscode-charts-yellow, #ddb92f);
}

.note-icon {
  font-size: 14px;
  flex-shrink: 0;
  color: var(--vscode-charts-blue, #3794ff);
}

.note-item.warning .note-icon {
  color: var(--vscode-charts-yellow, #ddb92f);
}

.note-text {
  color: var(--vscode-descriptionForeground);
  line-height: 1.4;
}

.note-item.warning .note-text {
  color: var(--vscode-charts-yellow, #ddb92f);
}

/* 工具模式警告 */
.tool-mode-warning {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 8px;
  padding: 8px 10px;
  background: rgba(221, 185, 47, 0.1);
  border: 1px solid var(--vscode-charts-yellow, #ddb92f);
  border-radius: 4px;
  font-size: 11px;
  color: var(--vscode-charts-yellow, #ddb92f);
  line-height: 1.5;
}

.tool-mode-warning .codicon {
  flex-shrink: 0;
  font-size: 14px;
  margin-top: 1px;
}

/* 高亮提示 */
.note-item.highlight {
  background: rgba(0, 122, 204, 0.1);
  padding: 6px 8px;
  border-radius: 4px;
  margin-bottom: 4px;
}

.note-item.highlight .note-icon {
  color: var(--vscode-button-background, #007acc);
}

.note-item.highlight .note-text {
  color: var(--vscode-foreground);
}
</style>