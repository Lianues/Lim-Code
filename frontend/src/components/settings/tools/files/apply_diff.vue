<script setup lang="ts">
/**
 * Apply Diff 工具配置面板
 *
 * 功能：
 * 1. 配置自动应用修改开关
 * 2. 配置自动应用延迟时间
 * 3. 配置自动应用时是否跳过 diff 视图
 * 4. 配置 diff 警戒值（删除行数阈值警告）
 */

import { ref, onMounted, computed } from 'vue'
import { sendToExtension } from '@/utils/vscode'
import { CustomCheckbox } from '../../../common'
import { t } from '@/i18n'

// 配置数据
const format = ref<'unified' | 'search_replace'>('unified')
const autoSave = ref(false)
const autoSaveDelay = ref(3000)
const autoApplyWithoutDiffView = ref(false)
const diffGuardEnabled = ref(true)
const diffGuardThreshold = ref(50)

// 保存状态
const isSaving = ref(false)

// 加载状态
const isLoading = ref(false)

// 延迟选项（毫秒）
const delayOptions = computed(() => [
  { value: 1000, label: t('components.settings.toolSettings.files.applyDiff.delay1s') },
  { value: 2000, label: t('components.settings.toolSettings.files.applyDiff.delay2s') },
  { value: 3000, label: t('components.settings.toolSettings.files.applyDiff.delay3s') },
  { value: 5000, label: t('components.settings.toolSettings.files.applyDiff.delay5s') },
  { value: 10000, label: t('components.settings.toolSettings.files.applyDiff.delay10s') }
])

// 计算当前选中的延迟标签
const currentDelayLabel = computed(() => {
  const option = delayOptions.value.find(o => o.value === autoSaveDelay.value)
  return option?.label || `${autoSaveDelay.value / 1000} ${t('components.settings.toolSettings.files.applyDiff.delay1s').replace('1 ', '')}`
})

// 加载配置
async function loadConfig() {
  isLoading.value = true
  try {
    const response = await sendToExtension<{ config: {
      format?: 'unified' | 'search_replace';
      autoSave: boolean;
      autoSaveDelay: number;
      autoApplyWithoutDiffView?: boolean;
      diffGuardEnabled?: boolean;
      diffGuardThreshold?: number;
    } }>(
      'tools.getToolConfig',
      {
        toolName: 'apply_diff'
      }
    )
    if (response?.config) {
      format.value = response.config.format ?? 'unified'
      autoSave.value = response.config.autoSave ?? false
      autoSaveDelay.value = response.config.autoSaveDelay ?? 3000
      autoApplyWithoutDiffView.value = response.config.autoApplyWithoutDiffView ?? false
      diffGuardEnabled.value = response.config.diffGuardEnabled ?? true
      diffGuardThreshold.value = response.config.diffGuardThreshold ?? 50
    }
  } catch (error) {
    console.error('Failed to load apply_diff config:', error)
  } finally {
    isLoading.value = false
  }
}

// 保存配置
async function saveConfig() {
  isSaving.value = true
  try {
    await sendToExtension('tools.updateApplyDiffConfig', {
      config: {
        format: format.value,
        autoSave: autoSave.value,
        autoSaveDelay: autoSaveDelay.value,
        autoApplyWithoutDiffView: autoApplyWithoutDiffView.value,
        diffGuardEnabled: diffGuardEnabled.value,
        diffGuardThreshold: diffGuardThreshold.value
      }
    })
  } catch (error) {
    console.error('Failed to save apply_diff config:', error)
  } finally {
    isSaving.value = false
  }
}

function updateFormat(newFormat: 'unified' | 'search_replace') {
  format.value = newFormat
  saveConfig()
}

// 切换自动保存开关
function toggleAutoSave(enabled: boolean) {
  autoSave.value = enabled
  saveConfig()
}

// 切换跳过 diff 视图
function toggleAutoApplyWithoutDiffView(enabled: boolean) {
  autoApplyWithoutDiffView.value = enabled
  saveConfig()
}

// 切换 diff 警戒值开关
function toggleDiffGuard(enabled: boolean) {
  diffGuardEnabled.value = enabled
  saveConfig()
}

// 更新 diff 警戒值阈值
function updateDiffGuardThreshold(event: Event) {
  const target = event.target as HTMLInputElement
  let value = parseInt(target.value, 10)
  if (isNaN(value)) value = 50
  if (value < 1) value = 1
  if (value > 100) value = 100
  diffGuardThreshold.value = value
  saveConfig()
}

// 更新延迟时间
function updateDelay(delay: number) {
  autoSaveDelay.value = delay
  saveConfig()
}

// 组件挂载时加载配置
onMounted(() => {
  loadConfig()
})
</script>

<template>
  <div class="apply-diff-config">
    <!-- 加载状态 -->
    <div v-if="isLoading" class="loading-state">
      <i class="codicon codicon-loading codicon-modifier-spin"></i>
      <span>{{ t('components.settings.toolSettings.common.loading') }}</span>
    </div>
    
    <template v-else>
      <!-- 参数格式 -->
      <div class="config-section">
        <div class="section-header">
          <i class="codicon codicon-diff"></i>
          <span>{{ t('components.settings.toolSettings.files.applyDiff.format') }}</span>
        </div>

        <div class="section-content">
          <div class="config-item">
            <div class="item-info">
              <span class="item-label">{{ t('components.settings.toolSettings.files.applyDiff.format') }}</span>
              <span class="item-description">{{ t('components.settings.toolSettings.files.applyDiff.formatDesc') }}</span>
            </div>
            <div class="delay-selector">
              <button
                :class="['delay-btn', { active: format === 'unified' }]"
                :disabled="isSaving"
                @click="updateFormat('unified')"
              >
                {{ t('components.settings.toolSettings.files.applyDiff.formatUnified') }}
              </button>
              <button
                :class="['delay-btn', { active: format === 'search_replace' }]"
                :disabled="isSaving"
                @click="updateFormat('search_replace')"
              >
                {{ t('components.settings.toolSettings.files.applyDiff.formatSearchReplace') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 自动应用开关 -->
      <div class="config-section">
        <div class="section-header">
          <i class="codicon codicon-play-circle"></i>
          <span>{{ t('components.settings.toolSettings.files.applyDiff.autoApply') }}</span>
        </div>
        
        <div class="section-content">
          <div class="config-item">
            <div class="item-info">
              <span class="item-label">{{ t('components.settings.toolSettings.files.applyDiff.enableAutoApply') }}</span>
              <span class="item-description">{{ t('components.settings.toolSettings.files.applyDiff.enableAutoApplyDesc') }}</span>
            </div>
            <CustomCheckbox
              :modelValue="autoSave"
              :disabled="isSaving"
              @update:modelValue="toggleAutoSave"
            />
          </div>
        </div>
      </div>
      
      <!-- 自动保存延迟配置 -->
      <div v-if="autoSave" class="config-section">
        <div class="section-header">
          <i class="codicon codicon-clock"></i>
          <span>{{ t('components.settings.toolSettings.files.applyDiff.autoSaveDelay') }}</span>
        </div>
        
        <div class="section-content">
          <div class="config-item">
            <div class="item-info">
              <span class="item-label">{{ t('components.settings.toolSettings.files.applyDiff.delayTime') }}</span>
              <span class="item-description">{{ t('components.settings.toolSettings.files.applyDiff.delayTimeDesc') }}</span>
            </div>
            <div class="delay-selector">
              <button
                v-for="option in delayOptions"
                :key="option.value"
                :class="['delay-btn', { active: autoSaveDelay === option.value }]"
                :disabled="isSaving"
                @click="updateDelay(option.value)"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 跳过 diff 视图 -->
      <div v-if="autoSave" class="config-section">
        <div class="section-header">
          <i class="codicon codicon-eye-closed"></i>
          <span>{{ t('components.settings.toolSettings.files.applyDiff.skipDiffView') }}</span>
        </div>
        
        <div class="section-content">
          <div class="config-item">
            <div class="item-info">
              <span class="item-label">{{ t('components.settings.toolSettings.files.applyDiff.enableSkipDiffView') }}</span>
              <span class="item-description">{{ t('components.settings.toolSettings.files.applyDiff.enableSkipDiffViewDesc') }}</span>
            </div>
            <CustomCheckbox
              :modelValue="autoApplyWithoutDiffView"
              :disabled="isSaving"
              @update:modelValue="toggleAutoApplyWithoutDiffView"
            />
          </div>
        </div>
      </div>

      <!-- Diff 警戒值配置 -->
      <div v-if="autoSave" class="config-section">
        <div class="section-header">
          <i class="codicon codicon-warning"></i>
          <span>{{ t('components.settings.toolSettings.files.applyDiff.diffGuard') }}</span>
        </div>
        
        <div class="section-content">
          <div class="config-item">
            <div class="item-info">
              <span class="item-label">{{ t('components.settings.toolSettings.files.applyDiff.enableDiffGuard') }}</span>
              <span class="item-description">{{ t('components.settings.toolSettings.files.applyDiff.enableDiffGuardDesc') }}</span>
            </div>
            <CustomCheckbox
              :modelValue="diffGuardEnabled"
              :disabled="isSaving"
              @update:modelValue="toggleDiffGuard"
            />
          </div>

          <div v-if="diffGuardEnabled" class="config-item">
            <div class="item-info">
              <span class="item-label">{{ t('components.settings.toolSettings.files.applyDiff.diffGuardThreshold') }}</span>
              <span class="item-description">{{ t('components.settings.toolSettings.files.applyDiff.diffGuardThresholdDesc') }}</span>
            </div>
            <div class="threshold-input">
              <input
                type="number"
                :value="diffGuardThreshold"
                min="1"
                max="100"
                :disabled="isSaving"
                class="threshold-number-input"
                @change="updateDiffGuardThreshold"
              />
              <span class="threshold-unit">%</span>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 说明信息 -->
      <div class="info-box">
        <i class="codicon codicon-info"></i>
        <div class="info-content">
          <p v-if="autoSave">
            {{ t('components.settings.toolSettings.files.applyDiff.infoEnabled', { delay: currentDelayLabel }) }}
          </p>
          <p v-else>
            {{ t('components.settings.toolSettings.files.applyDiff.infoDisabled') }}
          </p>
        </div>
      </div>
      
      <!-- 保存状态 -->
      <div v-if="isSaving" class="save-status">
        <i class="codicon codicon-loading codicon-modifier-spin"></i>
        <span>{{ t('components.settings.toolSettings.common.saving') }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.apply-diff-config {
  padding: 12px;
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-radius: 4px;
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 加载状态 */
.loading-state {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

/* 配置区域 */
.config-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--vscode-foreground);
}

.section-header .codicon {
  font-size: 14px;
  color: var(--vscode-charts-purple, #a855f7);
}

.section-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-left: 20px;
}

/* 配置项 */
.config-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
}

.item-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.item-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--vscode-foreground);
}

.item-description {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

/* 延迟选择器 */
.delay-selector {
  display: flex;
  gap: 4px;
}

.delay-btn {
  padding: 4px 10px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}

.delay-btn:hover:not(:disabled) {
  background: var(--vscode-button-secondaryHoverBackground);
}

.delay-btn.active {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border-color: var(--vscode-button-background);
}

.delay-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 阈值输入 */
.threshold-input {
  display: flex;
  align-items: center;
  gap: 4px;
}

.threshold-number-input {
  width: 60px;
  padding: 4px 8px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: 4px;
  font-size: 12px;
  text-align: center;
  outline: none;
}

.threshold-number-input:focus {
  border-color: var(--vscode-focusBorder);
}

.threshold-number-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.threshold-unit {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  font-weight: 500;
}

/* 信息框 */
.info-box {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  background: var(--vscode-inputValidation-infoBackground, rgba(0, 120, 212, 0.1));
  border: 1px solid var(--vscode-inputValidation-infoBorder, #007fd4);
  border-radius: 4px;
}

.info-box .codicon {
  font-size: 14px;
  color: var(--vscode-inputValidation-infoForeground, #007fd4);
  flex-shrink: 0;
  margin-top: 2px;
}

.info-content {
  flex: 1;
}

.info-content p {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--vscode-foreground);
}

.info-content strong {
  font-weight: 600;
  color: var(--vscode-charts-purple, #a855f7);
}

/* 保存状态 */
.save-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

/* Loading 动画 */
.codicon-modifier-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>