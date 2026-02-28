<script setup lang="ts">
/**
 * History Search 工具配置面板
 *
 * 配置项：
 * 1. 搜索最大匹配数 (maxSearchMatches)
 * 2. 搜索上下文行数 (searchContextLines)
 * 3. 最大读取行数 (maxReadLines)
 * 4. 结果最大字符数 (maxResultChars)
 * 5. 单行显示字符限制 (lineDisplayLimit)
 */

import { ref, onMounted } from 'vue'
import { sendToExtension } from '@/utils/vscode'
import { t } from '@/i18n'

// 配置数据
const searchScope = ref<'all' | 'summarized'>('all')
const maxSearchMatches = ref(30)
const searchContextLines = ref(3)
const maxReadLines = ref(300)
const maxResultChars = ref(30000)
const lineDisplayLimit = ref(500)

// 状态
const isSaving = ref(false)
const isLoading = ref(false)

// 加载配置
async function loadConfig() {
  isLoading.value = true
  try {
    const response = await sendToExtension<{ config: any }>(
      'tools.getHistorySearchConfig',
      {}
    )
    if (response?.config) {
      searchScope.value = response.config.searchScope ?? 'all'
      maxSearchMatches.value = response.config.maxSearchMatches ?? 30
      searchContextLines.value = response.config.searchContextLines ?? 3
      maxReadLines.value = response.config.maxReadLines ?? 300
      maxResultChars.value = response.config.maxResultChars ?? 30000
      lineDisplayLimit.value = response.config.lineDisplayLimit ?? 500
    }
  } catch (error) {
    console.error('Failed to load history_search config:', error)
  } finally {
    isLoading.value = false
  }
}

// 保存配置
async function saveConfig() {
  isSaving.value = true
  try {
    await sendToExtension('tools.updateHistorySearchConfig', {
      config: {
        searchScope: searchScope.value,
        maxSearchMatches: maxSearchMatches.value,
        searchContextLines: searchContextLines.value,
        maxReadLines: maxReadLines.value,
        maxResultChars: maxResultChars.value,
        lineDisplayLimit: lineDisplayLimit.value
      }
    })
  } catch (error) {
    console.error('Failed to save history_search config:', error)
  } finally {
    isSaving.value = false
  }
}

// 数值更新（含边界校正）
function updateNumber(event: Event, field: 'maxSearchMatches' | 'searchContextLines' | 'maxReadLines' | 'maxResultChars' | 'lineDisplayLimit') {
  const target = event.target as HTMLInputElement
  let value = parseInt(target.value, 10)
  if (isNaN(value)) return

  const constraints: Record<string, { min: number; max: number }> = {
    maxSearchMatches: { min: 1, max: 200 },
    searchContextLines: { min: 0, max: 20 },
    maxReadLines: { min: 10, max: 2000 },
    maxResultChars: { min: 1000, max: 200000 },
    lineDisplayLimit: { min: 100, max: 5000 }
  }

  const c = constraints[field]
  if (value < c.min) value = c.min
  if (value > c.max) value = c.max

  switch (field) {
    case 'maxSearchMatches': maxSearchMatches.value = value; break
    case 'searchContextLines': searchContextLines.value = value; break
    case 'maxReadLines': maxReadLines.value = value; break
    case 'maxResultChars': maxResultChars.value = value; break
    case 'lineDisplayLimit': lineDisplayLimit.value = value; break
  }
  saveConfig()
}

// 选择框更新
function updateSelect(event: Event) {
  searchScope.value = (event.target as HTMLSelectElement).value as 'all' | 'summarized'
  saveConfig()
}

onMounted(() => {
  loadConfig()
})
</script>

<template>
  <div class="history-search-config">
    <!-- 加载状态 -->
    <div v-if="isLoading" class="loading-state">
      <i class="codicon codicon-loading codicon-modifier-spin"></i>
      <span>{{ t('components.settings.toolSettings.common.loading') }}</span>
    </div>

    <template v-else>
      <!-- search 模式 -->
      <div class="config-section">
        <div class="section-header">
          <i class="codicon codicon-search"></i>
          <span>{{ t('components.settings.toolSettings.history.searchSection') }}</span>
        </div>

        <div class="section-content">
          <div class="config-item">
            <div class="item-info">
              <span class="item-label">{{ t('components.settings.toolSettings.history.searchScope') }}</span>
              <span class="item-description">{{ t('components.settings.toolSettings.history.searchScopeDesc') }}</span>
            </div>
            <div class="select-wrapper">
              <select
                :value="searchScope"
                :disabled="isSaving"
                class="config-select"
                @change="updateSelect($event)"
              >
                <option value="all">{{ t('components.settings.toolSettings.history.scopeAll') }}</option>
                <option value="summarized">{{ t('components.settings.toolSettings.history.scopeSummarized') }}</option>
              </select>
            </div>
          </div>

          <div class="config-item">
            <div class="item-info">
              <span class="item-label">{{ t('components.settings.toolSettings.history.maxSearchMatches') }}</span>
              <span class="item-description">{{ t('components.settings.toolSettings.history.maxSearchMatchesDesc') }}</span>
            </div>
            <div class="number-input-wrapper">
              <input
                type="number"
                :value="maxSearchMatches"
                min="1" max="200"
                :disabled="isSaving"
                class="number-input"
                @change="updateNumber($event, 'maxSearchMatches')"
              />
            </div>
          </div>

          <div class="config-item">
            <div class="item-info">
              <span class="item-label">{{ t('components.settings.toolSettings.history.searchContextLines') }}</span>
              <span class="item-description">{{ t('components.settings.toolSettings.history.searchContextLinesDesc') }}</span>
            </div>
            <div class="number-input-wrapper">
              <input
                type="number"
                :value="searchContextLines"
                min="0" max="20"
                :disabled="isSaving"
        class="number-input"
                @change="updateNumber($event, 'searchContextLines')"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- read 模式 -->
      <div class="config-section">
        <div class="section-header">
          <i class="codicon codicon-file-text"></i>
          <span>{{ t('components.settings.toolSettings.history.readSection') }}</span>
        </div>

        <div class="section-content">
          <div class="config-item">
            <div class="item-info">
              <span class="item-label">{{ t('components.settings.toolSettings.history.maxReadLines') }}</span>
              <span class="item-description">{{ t('components.settings.toolSettings.history.maxReadLinesDesc') }}</span>
            </div>
            <div class="number-input-wrapper">
              <input
                type="number"
                :value="maxReadLines"
                min="10" max="2000"
                :disabled="isSaving"
                class="number-input"
                @change="updateNumber($event, 'maxReadLines')"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 输出限制 -->
      <div class="config-section">
        <div class="section-header">
          <i class="codicon codicon-text-size"></i>
          <span>{{ t('components.settings.toolSettings.history.outputSection') }}</span>
        </div>

        <div class="section-content">
          <div class="config-item">
            <div class="item-info">
              <span class="item-label">{{ t('components.settings.toolSettings.history.maxResultChars') }}</span>
              <span class="item-description">{{ t('components.settings.toolSettings.history.maxResultCharsDesc') }}</span>
            </div>
            <div class="number-input-wrapper">
              <input
                type="number"
                :value="maxResultChars"
                min="1000" max="200000" step="1000"
                :disabled="isSaving"
                class="number-input wide"
                @change="updateNumber($event, 'maxResultChars')"
              />
            </div>
          </div>

          <div class="config-item">
            <div class="item-info">
              <span class="item-label">{{ t('components.settings.toolSettings.history.lineDisplayLimit') }}</span>
              <span class="item-description">{{ t('components.settings.toolSettings.history.lineDisplayLimitDesc') }}</span>
            </div>
            <div class="number-input-wrapper">
              <input
                type="number"
                :value="lineDisplayLimit"
                min="100" max="5000" step="100"
                :disabled="isSaving"
                class="number-input"
                @change="updateNumber($event, 'lineDisplayLimit')"
              />
            </div>
          </div>
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
.history-search-config {
  padding: 12px;
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-radius: 4px;
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.loading-state {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

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

.number-input-wrapper {
  display: flex;
  align-items: center;
  gap: 4px;
}

.number-input {
  width: 60px;
  padding: 4px 8px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: 4px;
  font-size: 12px;
  text-align: center;
  outline: none;
  appearance: textfield;
  -moz-appearance: textfield;
}

.number-input::-webkit-outer-spin-button,
.number-input::-webkit-inner-spin-button {
  appearance: none;
  -webkit-appearance: none;
  margin: 0;
}

.number-input.wide {
  width: 80px;
}

.number-input:focus {
  border-color: var(--vscode-focusBorder);
}

.number-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.save-status {
  display: flex;
  align-items: center;
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

.select-wrapper {
  display: flex;
  align-items: center;
}

.config-select {
  padding: 4px 8px;
  background: var(--vscode-dropdown-background);
  color: var(--vscode-dropdown-foreground);
  border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border));
  border-radius: 4px;
  font-size: 12px;
  outline: none;
}
</style>
