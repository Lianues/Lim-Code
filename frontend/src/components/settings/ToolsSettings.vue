<script setup lang="ts">
/**
 * ToolsSettings - 工具设置面板
 *
 * 功能：
 * 1. 显示所有可用工具列表
 * 2. 允许启用/禁用每个工具
 * 3. 持久化保存工具开关状态
 * 4. 支持展开工具配置面板
 * 5. 检查工具依赖并显示安装提示
 */

import { ref, computed, onMounted } from 'vue'
import { CustomCheckbox, DependencyWarning } from '../common'
import { sendToExtension } from '@/utils/vscode'
import { useDependency, TOOL_DEPENDENCIES, hasToolDependencies, getToolDependencies } from '@/composables/useDependency'
import { useI18n } from '@/composables'
import ListFilesConfig from './tools/files/list_files.vue'
import ApplyDiffConfig from './tools/files/apply_diff.vue'
import ExecuteCommandConfig from './tools/terminal/execute_command.vue'
import FindFilesConfig from './tools/search/find_files.vue'
import SearchInFilesConfig from './tools/search/search_in_files.vue'
import GenerateImageConfig from './tools/media/generate_image.vue'
import RemoveBackgroundConfig from './tools/media/remove_background.vue'
import CropImageConfig from './tools/media/crop_image.vue'
import ResizeImageConfig from './tools/media/resize_image.vue'
import RotateImageConfig from './tools/media/rotate_image.vue'

// 工具信息接口
interface ToolInfo {
  name: string
  description: string
  enabled: boolean
  category?: string
}

// 国际化
const { t } = useI18n()

// 最大工具调用次数配置（初始为0，从后端加载真实值）
const maxToolIterations = ref<number>(0)
const isLoadingMaxIterations = ref(false)
const isSavingMaxIterations = ref(false)

// 获取所有需要的依赖（从所有工具中）
const allDependencies = Object.values(TOOL_DEPENDENCIES).flat()
const uniqueDependencies = [...new Set(allDependencies)]

// 使用依赖检查 composable
const {
  dependencyStatus,
  checkDependencies: loadDependencies
} = useDependency({
  dependencies: uniqueDependencies,
  autoCheck: false // 手动控制，等工具加载后再检查
})

// 判断工具是否有配置面板
function hasConfigPanel(toolName: string): boolean {
  const toolsWithConfig = [
    'list_files',
    'apply_diff',
    'execute_command',
    'find_files',
    'search_in_files',
    'generate_image',
    'remove_background',
    'crop_image',
    'resize_image',
    'rotate_image'
  ]
  return toolsWithConfig.includes(toolName)
}

// 获取工具缺失的依赖
function getMissingDependencies(toolName: string): string[] {
  const required = getToolDependencies(toolName)
  return required.filter(dep => dependencyStatus.value.get(dep) !== true)
}

// 判断工具依赖是否都已安装
function areAllDependenciesInstalled(toolName: string): boolean {
  const required = getToolDependencies(toolName)
  return required.every(dep => dependencyStatus.value.get(dep) === true)
}

// 展开的工具配置面板
const expandedTools = ref<Set<string>>(new Set())

// 切换配置面板展开状态
function toggleConfigPanel(toolName: string) {
  if (expandedTools.value.has(toolName)) {
    expandedTools.value.delete(toolName)
  } else {
    expandedTools.value.add(toolName)
  }
}

// 检查配置面板是否展开
function isConfigExpanded(toolName: string): boolean {
  return expandedTools.value.has(toolName)
}

// 工具列表
const tools = ref<ToolInfo[]>([])

// 加载状态
const isLoading = ref(false)

// 是否正在保存
const savingTools = ref<Set<string>>(new Set())

// 按分类分组的工具
const toolsByCategory = computed(() => {
  const grouped: Record<string, ToolInfo[]> = {}
  
  for (const tool of tools.value) {
    const category = tool.category || '其他'
    if (!grouped[category]) {
      grouped[category] = []
    }
    grouped[category].push(tool)
  }
  
  return grouped
})

// 分类显示名称获取函数
function getCategoryName(category: string): string {
  const mapping: Record<string, string> = {
    'file': 'components.settings.toolsSettings.categories.file',
    'search': 'components.settings.toolsSettings.categories.search',
    'terminal': 'components.settings.toolsSettings.categories.terminal',
    'lsp': 'components.settings.toolsSettings.categories.lsp',
    'media': 'components.settings.toolsSettings.categories.media',
    'todo': 'components.settings.toolsSettings.categories.todo',
    '其他': 'components.settings.toolsSettings.categories.other'
  }
  return t(mapping[category] || mapping['其他'])
}

// 分类图标映射
const categoryIcons: Record<string, string> = {
  'file': 'codicon-file',
  'search': 'codicon-search',
  'terminal': 'codicon-terminal',
  'lsp': 'codicon-symbol-class',
  'media': 'codicon-file-media',
  'todo': 'codicon-checklist',
  '其他': 'codicon-extensions'
}

// 加载工具列表
async function loadTools() {
  isLoading.value = true
  
  try {
    const response = await sendToExtension<{ tools: ToolInfo[] }>('tools.getTools', {})
    if (response?.tools) {
      tools.value = response.tools
    }
  } catch (error) {
    console.error('Failed to load tools:', error)
  } finally {
    isLoading.value = false
  }
}

// 切换工具开关
async function toggleTool(toolName: string, enabled: boolean) {
  savingTools.value.add(toolName)
  
  try {
    await sendToExtension('tools.setToolEnabled', {
      toolName,
      enabled
    })
    
    // 更新本地状态
    const tool = tools.value.find(t => t.name === toolName)
    if (tool) {
      tool.enabled = enabled
    }
  } catch (error) {
    console.error(`Failed to toggle tool ${toolName}:`, error)
    // 恢复原状态
    const tool = tools.value.find(t => t.name === toolName)
    if (tool) {
      tool.enabled = !enabled
    }
  } finally {
    savingTools.value.delete(toolName)
  }
}

// 全部启用
async function enableAll() {
  const disabledTools = tools.value.filter(t => !t.enabled)
  for (const tool of disabledTools) {
    await toggleTool(tool.name, true)
  }
}

// 全部禁用
async function disableAll() {
  const enabledTools = tools.value.filter(t => t.enabled)
  for (const tool of enabledTools) {
    await toggleTool(tool.name, false)
  }
}

// 获取工具显示名称
function getToolDisplayName(name: string): string {
  // 将 snake_case 转换为可读格式
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// 获取分类显示名称
function getCategoryDisplayName(category: string): string {
  return getCategoryName(category)
}

// 获取分类图标
function getCategoryIcon(category: string): string {
  return categoryIcons[category] || 'codicon-extensions'
}

// 加载最大工具调用次数配置
async function loadMaxToolIterations() {
  isLoadingMaxIterations.value = true
  try {
    const response = await sendToExtension<{ maxIterations: number }>('tools.getMaxToolIterations', {})
    if (response?.maxIterations !== undefined) {
      maxToolIterations.value = response.maxIterations
    }
  } catch (error) {
    console.error('Failed to load maxToolIterations:', error)
  } finally {
    isLoadingMaxIterations.value = false
  }
}

// 保存最大工具调用次数配置
async function saveMaxToolIterations(value: number) {
  isSavingMaxIterations.value = true
  try {
    await sendToExtension('tools.updateMaxToolIterations', { maxIterations: value })
    maxToolIterations.value = value
  } catch (error) {
    console.error('Failed to save maxToolIterations:', error)
  } finally {
    isSavingMaxIterations.value = false
  }
}

// 处理最大工具调用次数变化
function handleMaxIterationsChange(event: Event) {
  const target = event.target as HTMLInputElement
  const value = parseInt(target.value, 10)
  // -1 表示无限制，正整数表示具体次数
  if (!isNaN(value) && (value === -1 || value >= 1)) {
    saveMaxToolIterations(value)
  }
}

// 组件挂载
onMounted(() => {
  loadTools()
  loadDependencies()
  loadMaxToolIterations()
})
</script>

<template>
  <div class="tools-settings">
    <!-- 全局配置 -->
    <div class="global-config">
      <div class="config-item">
        <div class="config-label">
          <span class="label-text">{{ t('components.settings.toolsSettings.maxIterations.label') }}</span>
          <span class="label-hint">{{ t('components.settings.toolsSettings.maxIterations.hint') }}</span>
        </div>
        <div class="config-control">
          <input
            type="number"
            class="iterations-input"
            :value="maxToolIterations"
            min="-1"
            :disabled="isLoadingMaxIterations || isSavingMaxIterations"
            @input="handleMaxIterationsChange"
          />
          <span class="unit">{{ t('components.settings.toolsSettings.maxIterations.unit') }}</span>
          <i
            v-if="isSavingMaxIterations"
            class="codicon codicon-loading codicon-modifier-spin saving-indicator"
          ></i>
        </div>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="tools-actions">
      <button class="action-btn" @click="loadTools" :disabled="isLoading">
        <i class="codicon" :class="isLoading ? 'codicon-loading codicon-modifier-spin' : 'codicon-refresh'"></i>
        {{ t('components.settings.toolsSettings.actions.refresh') }}
      </button>
      <button class="action-btn" @click="enableAll">
        <i class="codicon codicon-check-all"></i>
        {{ t('components.settings.toolsSettings.actions.enableAll') }}
      </button>
      <button class="action-btn" @click="disableAll">
        <i class="codicon codicon-close-all"></i>
        {{ t('components.settings.toolsSettings.actions.disableAll') }}
      </button>
    </div>
    
    <!-- 加载状态 -->
    <div v-if="isLoading" class="loading-state">
      <i class="codicon codicon-loading codicon-modifier-spin"></i>
      <span>{{ t('components.settings.toolsSettings.loading') }}</span>
    </div>
    
    <!-- 空状态 -->
    <div v-else-if="tools.length === 0" class="empty-state">
      <i class="codicon codicon-tools"></i>
      <span>{{ t('components.settings.toolsSettings.empty') }}</span>
    </div>
    
    <!-- 工具列表 -->
    <div v-else class="tools-list">
      <div 
        v-for="(categoryTools, category) in toolsByCategory" 
        :key="category"
        class="tool-category"
      >
        <div class="category-header">
          <i :class="['codicon', getCategoryIcon(category)]"></i>
          <span>{{ getCategoryDisplayName(category) }}</span>
          <span class="category-count">{{ categoryTools.length }}</span>
        </div>
        
        <div class="category-tools">
          <div
            v-for="tool in categoryTools"
            :key="tool.name"
            class="tool-wrapper"
          >
            <div class="tool-item" :class="{ 'tool-disabled': hasToolDependencies(tool.name) && !areAllDependenciesInstalled(tool.name) }">
              <div class="tool-info">
                <div class="tool-name-row">
                  <span class="tool-name">{{ getToolDisplayName(tool.name) }}</span>
                  <!-- 依赖缺失标记 -->
                  <span
                    v-if="hasToolDependencies(tool.name) && !areAllDependenciesInstalled(tool.name)"
                    class="dependency-badge"
                    :title="t('components.settings.toolsSettings.dependency.requiredTooltip')"
                  >
                    <i class="codicon codicon-warning"></i>
                    {{ t('components.settings.toolsSettings.dependency.required') }}
                  </span>
                </div>
                <div class="tool-description">{{ tool.description }}</div>
              </div>
              
              <div class="tool-actions">
                <!-- 配置按钮 -->
                <button
                  v-if="hasConfigPanel(tool.name)"
                  class="config-btn"
                  :class="{ active: isConfigExpanded(tool.name) }"
                  @click="toggleConfigPanel(tool.name)"
                  :title="t('components.settings.toolsSettings.config.tooltip')"
                >
                  <i class="codicon" :class="isConfigExpanded(tool.name) ? 'codicon-chevron-up' : 'codicon-settings-gear'"></i>
                </button>
                
                <!-- 开关 -->
                <div
                  class="tool-toggle"
                  :class="{
                    saving: savingTools.has(tool.name),
                    disabled: hasToolDependencies(tool.name) && !areAllDependenciesInstalled(tool.name)
                  }"
                  :title="hasToolDependencies(tool.name) && !areAllDependenciesInstalled(tool.name) ? t('components.settings.toolsSettings.dependency.disabledTooltip') : ''"
                >
                  <CustomCheckbox
                    :modelValue="tool.enabled"
                    :disabled="savingTools.has(tool.name) || (hasToolDependencies(tool.name) && !areAllDependenciesInstalled(tool.name))"
                    @update:modelValue="(val: boolean) => toggleTool(tool.name, val)"
                  />
                </div>
              </div>
            </div>
            
            <!-- 依赖缺失提示 -->
            <DependencyWarning
              v-if="hasToolDependencies(tool.name) && !areAllDependenciesInstalled(tool.name)"
              :dependencies="getMissingDependencies(tool.name)"
              class="tool-dependency-warning"
            />
            
            <!-- 配置面板 -->
            <ListFilesConfig
              v-if="tool.name === 'list_files' && isConfigExpanded(tool.name)"
              :tool-name="tool.name"
            />
            <ApplyDiffConfig
              v-if="tool.name === 'apply_diff' && isConfigExpanded(tool.name)"
              :tool-name="tool.name"
            />
            <ExecuteCommandConfig
              v-if="tool.name === 'execute_command' && isConfigExpanded(tool.name)"
              :tool-name="tool.name"
            />
            <FindFilesConfig
              v-if="tool.name === 'find_files' && isConfigExpanded(tool.name)"
            />
            <SearchInFilesConfig
              v-if="tool.name === 'search_in_files' && isConfigExpanded(tool.name)"
            />
            <GenerateImageConfig
              v-if="tool.name === 'generate_image' && isConfigExpanded(tool.name)"
            />
            <RemoveBackgroundConfig
              v-if="tool.name === 'remove_background' && isConfigExpanded(tool.name)"
            />
            <CropImageConfig
              v-if="tool.name === 'crop_image' && isConfigExpanded(tool.name)"
            />
            <ResizeImageConfig
              v-if="tool.name === 'resize_image' && isConfigExpanded(tool.name)"
            />
            <RotateImageConfig
              v-if="tool.name === 'rotate_image' && isConfigExpanded(tool.name)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tools-settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 全局配置 */
.global-config {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
}

.config-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
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
  gap: 8px;
  flex-shrink: 0;
}

.iterations-input {
  width: 70px;
  padding: 4px 8px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  border-radius: 4px;
  font-size: 13px;
  text-align: center;
  appearance: textfield;
  -moz-appearance: textfield;
}

/* 隐藏数字输入框的上下箭头 */
.iterations-input::-webkit-outer-spin-button,
.iterations-input::-webkit-inner-spin-button {
  appearance: none;
  -webkit-appearance: none;
  margin: 0;
}

.iterations-input:focus {
  outline: none;
  border-color: var(--vscode-focusBorder);
}

.iterations-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.unit {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.saving-indicator {
  font-size: 14px;
  color: var(--vscode-foreground);
}

/* 操作按钮 */
.tools-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: none;
  border-radius: 4px;
  font-size: 12px;
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

.action-btn .codicon {
  font-size: 14px;
}

/* 加载和空状态 */
.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px;
  color: var(--vscode-descriptionForeground);
}

.loading-state .codicon,
.empty-state .codicon {
  font-size: 24px;
}

/* 工具列表 */
.tools-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 分类 */
.tool-category {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.category-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
}

.category-header .codicon {
  font-size: 14px;
  color: var(--vscode-foreground);
}

.category-count {
  margin-left: auto;
  padding: 2px 8px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
}

/* 工具项 */
.category-tools {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-left: 12px;
}

.tool-wrapper {
  display: flex;
  flex-direction: column;
}

.tool-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  transition: background-color 0.15s;
}

.tool-item:hover {
  background: var(--vscode-list-hoverBackground);
}

.tool-item.tool-disabled {
  opacity: 0.7;
  border-color: var(--vscode-inputValidation-warningBorder);
}

.tool-info {
  flex: 1;
  min-width: 0;
}

.tool-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.tool-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--vscode-foreground);
}

.tool-description {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 工具操作区 */
.tool-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* 配置按钮 */
.config-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  transition: all 0.15s;
}

.config-btn:hover {
  background: var(--vscode-toolbar-hoverBackground);
  color: var(--vscode-foreground);
}

.config-btn.active {
  background: var(--vscode-button-secondaryBackground);
  border-color: var(--vscode-focusBorder);
  color: var(--vscode-foreground);
}

.config-btn .codicon {
  font-size: 14px;
}

/* 开关样式 */
.tool-toggle {
  flex-shrink: 0;
}

.tool-toggle.saving {
  opacity: 0.6;
  pointer-events: none;
}

.tool-toggle.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 依赖相关样式 */
.dependency-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: var(--vscode-inputValidation-warningBackground);
  border: 1px solid var(--vscode-inputValidation-warningBorder);
  border-radius: 10px;
  font-size: 10px;
  color: var(--vscode-inputValidation-warningForeground);
}

.dependency-badge .codicon {
  font-size: 10px;
}

.tool-dependency-warning {
  margin-top: 4px;
  margin-left: 12px;
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