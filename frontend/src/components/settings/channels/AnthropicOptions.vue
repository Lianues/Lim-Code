<script setup lang="ts">
import { computed } from 'vue'
import { CustomSelect, type SelectOption } from '../../common'
import { useI18n } from '../../../i18n'

const { t } = useI18n()

const props = defineProps<{
  config: any
}>()

const emit = defineEmits<{
  (e: 'update:option', optionKey: string, value: any): void
  (e: 'update:optionEnabled', optionKey: string, enabled: boolean, optionValue?: any): void
  (e: 'update:field', field: string, value: any): void
}>()

// 默认配置值
const DEFAULT_VALUES: Record<string, any> = {
  temperature: 1.0,
  max_tokens: 8192,
  top_p: 0.9,
  top_k: 40,
  thinking: {
    type: 'adaptive',
    budget_tokens: 10000,
    effort: 'high'
  }
}

// 思考类型选项
const thinkingTypeOptions = computed<SelectOption[]>(() => [
  {
    value: 'adaptive',
    label: t('components.channels.anthropic.thinking.typeAdaptive'),
    description: t('components.channels.anthropic.thinking.typeAdaptiveHint')
  },
  {
    value: 'enabled',
    label: t('components.channels.anthropic.thinking.typeEnabled'),
    description: t('components.channels.anthropic.thinking.typeEnabledHint')
  }
])

// Effort 级别选项
const effortOptions = computed<SelectOption[]>(() => [
  {
    value: 'max',
    label: 'max',
    description: t('components.channels.anthropic.thinking.effortMax')
  },
  {
    value: 'high',
    label: 'high',
    description: t('components.channels.anthropic.thinking.effortHigh')
  },
  {
    value: 'medium',
    label: 'medium',
    description: t('components.channels.anthropic.thinking.effortMedium')
  },
  {
    value: 'low',
    label: 'low',
    description: t('components.channels.anthropic.thinking.effortLow')
  }
])

// 检查配置项是否启用
function isOptionEnabled(optionKey: string): boolean {
  const enabled = props.config?.optionsEnabled?.[optionKey]
  return enabled ?? false
}

// 获取思考配置字段值
function getThinkingValue(field: string, defaultValue: any = undefined): any {
  return props.config?.options?.thinking?.[field] ?? defaultValue
}

// 获取当前思考类型
function getThinkingType(): string {
  return getThinkingValue('type', 'adaptive')
}

// 处理选项启用状态变更
function handleOptionEnabledChange(optionKey: string, enabled: boolean) {
  // 当开启选项时，确保写入默认值（合并已有值和默认值）
  if (enabled && optionKey in DEFAULT_VALUES) {
    const currentValue = props.config?.options?.[optionKey]
    const defaultValue = DEFAULT_VALUES[optionKey]
    
    let optionValue: any
    if (typeof defaultValue === 'object' && defaultValue !== null) {
      // 对象类型：合并默认值和当前值，确保所有默认字段都存在
      optionValue = {
        ...defaultValue,
        ...(currentValue || {})
      }
    } else if (currentValue === undefined || currentValue === null) {
      // 非对象类型：仅当当前值为空时写入默认值
      optionValue = defaultValue
    } else {
      optionValue = currentValue
    }
    
    // 同时发送 optionEnabled 和 option 更新，避免竞态条件
    emit('update:optionEnabled', optionKey, enabled, optionValue)
  } else {
    // 仅更新启用状态
    emit('update:optionEnabled', optionKey, enabled)
  }
}

// 更新思考配置字段
function updateThinking(field: string, value: any) {
  const currentOptions = props.config?.options || {}
  const currentThinking = currentOptions.thinking || {}
  // 确保始终包含默认值，防止某些字段丢失
  const updatedThinking = {
    ...DEFAULT_VALUES.thinking,  // 首先应用默认值
    ...currentThinking,          // 然后应用当前值
    [field]: value                // 最后应用新值
  }
  
  emit('update:option', 'thinking', updatedThinking)
}

// 处理数字输入变更，允许空值
function handleNumberChange(optionKey: string, event: any) {
  const value = event.target.value
  if (value === '' || value === null || value === undefined) {
    emit('update:option', optionKey, undefined)
  } else {
    emit('update:option', optionKey, Number(value))
  }
}

// 处理思考预算数字输入变更，允许空值
function handleThinkingNumberChange(field: string, event: any) {
  const value = event.target.value
  if (value === '' || value === null || value === undefined) {
    updateThinking(field, undefined)
  } else {
    updateThinking(field, Number(value))
  }
}
</script>

<template>
  <div class="anthropic-options">
    <!-- 温度 -->
    <div class="option-item option-with-toggle">
      <div class="option-header">
        <label>{{ t('components.channels.common.temperature.label') }}</label>
        <label class="toggle-switch" :title="t('components.channels.common.temperature.toggleHint')">
          <input
            type="checkbox"
            :checked="isOptionEnabled('temperature')"
            @change="(e: any) => handleOptionEnabledChange('temperature', e.target.checked)"
          />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <input
        type="number"
        step="0.1"
        min="0"
        max="1"
        :value="config.options?.temperature"
        placeholder="1.0"
        :disabled="!isOptionEnabled('temperature')"
        :class="{ disabled: !isOptionEnabled('temperature') }"
        @input="(e: any) => handleNumberChange('temperature', e)"
      />
      <span class="option-hint">{{ t('components.channels.common.temperature.hint') }}</span>
    </div>
    
    <!-- 最大输出 Tokens -->
    <div class="option-item option-with-toggle">
      <div class="option-header">
        <label>{{ t('components.channels.common.maxTokens.label') }}</label>
        <label class="toggle-switch" :title="t('components.channels.common.maxTokens.toggleHint')">
          <input
            type="checkbox"
           :checked="isOptionEnabled('max_tokens')"
            @change="(e: any) => handleOptionEnabledChange('max_tokens', e.target.checked)"
          />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <input
        type="number"
        :value="config.options?.max_tokens"
        :placeholder="t('components.channels.common.maxTokens.placeholder')"
        :disabled="!isOptionEnabled('max_tokens')"
        :class="{ disabled: !isOptionEnabled('max_tokens') }"
        @input="(e: any) => handleNumberChange('max_tokens', e)"
      />
    </div>
    
    <!-- Top-P -->
    <div class="option-item option-with-toggle">
      <div class="option-header">
        <label>{{ t('components.channels.common.topP.label') }}</label>
        <label class="toggle-switch" :title="t('components.channels.common.topP.toggleHint')">
          <input
            type="checkbox"
            :checked="isOptionEnabled('top_p')"
            @change="(e: any) => handleOptionEnabledChange('top_p', e.target.checked)"
          />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <input
        type="number"
        step="0.1"
        min="0"
        max="1"
        :value="config.options?.top_p"
        placeholder="0.9"
        :disabled="!isOptionEnabled('top_p')"
        :class="{ disabled: !isOptionEnabled('top_p') }"
        @input="(e: any) => handleNumberChange('top_p', e)"
      />
      <span class="option-hint">{{ t('components.channels.common.topP.hint') }}</span>
    </div>
    
    <!-- Top-K -->
    <div class="option-item option-with-toggle">
      <div class="option-header">
        <label>{{ t('components.channels.common.topK.label') }}</label>
        <label class="toggle-switch" :title="t('components.channels.common.topK.toggleHint')">
          <input
            type="checkbox"
            :checked="isOptionEnabled('top_k')"
            @change="(e: any) => handleOptionEnabledChange('top_k', e.target.checked)"
          />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <input
        type="number"
        :value="config.options?.top_k"
        placeholder="40"
        :disabled="!isOptionEnabled('top_k')"
        :class="{ disabled: !isOptionEnabled('top_k') }"
        @input="(e: any) => handleNumberChange('top_k', e)"
      />
    </div>
    
    <!-- 思考配置 -->
    <div class="option-section">
      <div class="option-section-header">
        <span class="option-section-title">
          <i class="codicon codicon-lightbulb"></i>
          {{ t('components.channels.common.thinking.title') }}
        </span>
        <label class="toggle-switch" :title="t('components.channels.common.thinking.toggleHint')">
          <input
            type="checkbox"
            :checked="isOptionEnabled('thinking')"
            @change="(e: any) => handleOptionEnabledChange('thinking', e.target.checked)"
          />
          <span class="toggle-slider"></span>
        </label>
      </div>
      
      <div class="option-section-content" :class="{ disabled: !isOptionEnabled('thinking') }">
        <!-- 思考类型 -->
        <div class="option-item">
          <label>{{ t('components.channels.anthropic.thinking.typeLabel') }}</label>
          <CustomSelect
            :model-value="getThinkingType()"
            :options="thinkingTypeOptions"
            :disabled="!isOptionEnabled('thinking')"
            @update:model-value="(v: string) => updateThinking('type', v)"
          />
        </div>
        
        <!-- Effort 级别（仅 adaptive 模式） -->
        <div v-if="getThinkingType() === 'adaptive'" class="option-item">
          <label>{{ t('components.channels.anthropic.thinking.effortLabel') }}</label>
          <CustomSelect
            :model-value="getThinkingValue('effort', 'high')"
            :options="effortOptions"
            :disabled="!isOptionEnabled('thinking')"
            @update:model-value="(v: string) => updateThinking('effort', v)"
          />
          <span class="option-hint">
            {{ t('components.channels.anthropic.thinking.effortHint') }}
          </span>
        </div>
        
        <!-- 思考预算（仅 enabled 模式） -->
        <div v-if="getThinkingType() === 'enabled'" class="option-item">
          <label>{{ t('components.channels.anthropic.thinking.budgetLabel') }}</label>
          <input
            type="number"
            :value="getThinkingValue('budget_tokens')"
            :disabled="!isOptionEnabled('thinking')"
            :placeholder="t('components.channels.anthropic.thinking.budgetPlaceholder')"
            @input="(e: any) => handleThinkingNumberChange('budget_tokens', e)"
          />
          <span class="option-hint">
            {{ t('components.channels.anthropic.thinking.budgetHint') }}
          </span>
        </div>
      </div>
    </div>
    
    <!-- 当前轮次思考配置 -->
    <div class="option-section">
      <div class="option-section-header">
        <span class="option-section-title">
          <i class="codicon codicon-zap"></i>
          {{ t('components.channels.common.currentThinking.title') }}
        </span>
      </div>
      
      <div class="option-section-content">
        <div class="option-item checkbox-option">
          <label class="custom-checkbox">
            <input
              type="checkbox"
              :checked="config.sendCurrentThoughtSignatures ?? true"
              @change="(e: any) => emit('update:field', 'sendCurrentThoughtSignatures', e.target.checked)"
            />
            <span class="checkmark"></span>
            <span class="checkbox-text">{{ t('components.channels.common.currentThinking.sendSignatures') }}</span>
          </label>
          <span class="option-hint">{{ t('components.channels.common.currentThinking.sendSignaturesHint') }}</span>
        </div>
        
        <div class="option-item checkbox-option">
          <label class="custom-checkbox">
            <input
              type="checkbox"
              :checked="config.sendCurrentThoughts ?? true"
              @change="(e: any) => emit('update:field', 'sendCurrentThoughts', e.target.checked)"
            />
            <span class="checkmark"></span>
            <span class="checkbox-text">{{ t('components.channels.common.currentThinking.sendContent') }}</span>
          </label>
          <span class="option-hint">{{ t('components.channels.common.currentThinking.sendContentHint') }}</span>
        </div>
      </div>
    </div>

    <!-- 历史思考配置 -->
    <div class="option-section history-thought-section">
      <div class="option-section-header">
        <span class="option-section-title">
          <i class="codicon codicon-history"></i>
          {{ t('components.channels.common.historyThinking.title') }}
        </span>
      </div>
      
      <div class="option-section-content">
        <div class="option-item checkbox-option">
          <label class="custom-checkbox">
            <input
              type="checkbox"
              :checked="config.sendHistoryThoughtSignatures ?? false"
              @change="(e: any) => emit('update:field', 'sendHistoryThoughtSignatures', e.target.checked)"
            />
            <span class="checkmark"></span>
            <span class="checkbox-text">{{ t('components.channels.common.historyThinking.sendSignatures') }}</span>
          </label>
          <span class="option-hint">{{ t('components.channels.common.historyThinking.sendSignaturesHint') }}</span>
        </div>
        
        <div class="option-item checkbox-option">
          <label class="custom-checkbox">
            <input
              type="checkbox"
              :checked="config.sendHistoryThoughts ?? false"
              @change="(e: any) => emit('update:field', 'sendHistoryThoughts', e.target.checked)"
            />
            <span class="checkmark"></span>
            <span class="checkbox-text">{{ t('components.channels.common.historyThinking.sendContent') }}</span>
          </label>
          <span class="option-hint">{{ t('components.channels.common.historyThinking.sendContentHint') }}</span>
        </div>
        
        <!-- 历史思考回合数配置 - 条件展开 -->
        <div
          v-if="(config.sendHistoryThoughtSignatures ?? false) || (config.sendHistoryThoughts ?? false)"
          class="option-item history-rounds-config"
        >
          <label>{{ t('components.channels.common.historyThinking.roundsLabel') }}</label>
          <input
            type="number"
            :value="config.historyThinkingRounds ?? -1"
            placeholder="-1"
            min="-1"
            @input="(e: any) => emit('update:field', 'historyThinkingRounds', Number(e.target.value))"
          />
          <span class="option-hint">{{ t('components.channels.common.historyThinking.roundsHint') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.anthropic-options {
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
  -moz-appearance: textfield;
}

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

.option-item input.disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
  color: var(--vscode-charts-blue, #3794ff);
}

.option-section-title .codicon-lightbulb {
  color: var(--vscode-charts-yellow, #ddb92f);
}

.history-thought-section {
  margin-top: 12px;
}

.option-section-content.disabled {
  opacity: 0.5;
  pointer-events: none;
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

.option-section-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 自定义勾选框 */
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
</style>
