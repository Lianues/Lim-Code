<script setup lang="ts">
/**
 * execute_command 工具配置面板
 * 
 * 功能：
 * 1. 配置可用的 Shell 环境
 * 2. 设置默认 Shell
 * 3. 配置 Shell 路径
 * 4. 设置默认超时时间
 */

import { ref, onMounted, computed } from 'vue'
import { sendToExtension } from '@/utils/vscode'
import { CustomCheckbox, CustomSelect, type SelectOption } from '../../../common'
import { t } from '@/i18n'

// 定义 props
defineProps<{
  toolName: string
}>()

// Shell 配置接口
interface ShellConfig {
  type: string
  enabled: boolean
  path?: string
  displayName: string
  available?: boolean
  unavailableReason?: string
}

// 工具配置接口
interface ExecuteCommandConfig {
  defaultShell: string
  shells: ShellConfig[]
  defaultTimeout: number
  maxOutputLines: number
}

interface ExecuteCommandSecurityConfig {
  allowSkillDirectoryAccessViaExecuteCommand: boolean
}

// 配置状态
const config = ref<ExecuteCommandConfig | null>(null)
const securityConfig = ref<ExecuteCommandSecurityConfig>({
  // 为什么要改：Skill 目录 break-glass 必须默认关闭，且不能从可同步 toolsConfig 推断。
  // 怎么改：前端先以 fail-closed 默认值渲染，再从机器级 security handler 读取真实值。
  // 目的：设置页加载失败或旧配置缺失时不会误显示为已开启。
  allowSkillDirectoryAccessViaExecuteCommand: false
})
const isLoading = ref(false)
const isSaving = ref(false)
const error = ref<string | null>(null)

// 默认超时时间选项（毫秒）
const timeoutOptions = computed<SelectOption[]>(() => [
  { value: '30000', label: t('components.settings.toolSettings.terminal.executeCommand.timeout30s') },
  { value: '60000', label: t('components.settings.toolSettings.terminal.executeCommand.timeout1m') },
  { value: '120000', label: t('components.settings.toolSettings.terminal.executeCommand.timeout2m') },
  { value: '300000', label: t('components.settings.toolSettings.terminal.executeCommand.timeout5m') },
  { value: '600000', label: t('components.settings.toolSettings.terminal.executeCommand.timeout10m') },
  { value: '0', label: t('components.settings.toolSettings.terminal.executeCommand.timeoutUnlimited') }
])

// 最大输出行数选项
const maxOutputLinesOptions = computed<SelectOption[]>(() => [
  { value: '20', label: '20' },
  { value: '50', label: '50' },
  { value: '100', label: '100' },
  { value: '200', label: '200' },
  { value: '500', label: '500' },
  { value: '-1', label: t('components.settings.toolSettings.terminal.executeCommand.unlimitedLines') }
])

// 加载配置
async function loadConfig() {
  isLoading.value = true
  error.value = null
  
  try {
    const [response, securityResponse] = await Promise.all([
      sendToExtension<{ config: ExecuteCommandConfig }>('tools.getExecuteCommandConfig', {}),
      sendToExtension<{ config: ExecuteCommandSecurityConfig }>('tools.getExecuteCommandSecuritySettings', {})
    ])
    if (response?.config) {
      config.value = response.config
    }
    if (securityResponse?.config) {
      // 为什么要改：机器级安全开关必须独立于普通 execute_command 配置读取。
      // 怎么改：只接受后端专用 handler 返回的布尔字段。
      // 目的：普通 toolsConfig 中的同名字段即使存在，也不会影响 UI 状态或运行时行为。
      securityConfig.value = {
        allowSkillDirectoryAccessViaExecuteCommand: securityResponse.config.allowSkillDirectoryAccessViaExecuteCommand === true
      }
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('components.settings.toolSettings.common.error')
    console.error('Failed to load execute_command config:', err)
  } finally {
    isLoading.value = false
  }
}

// 保存配置
async function saveConfig() {
  if (!config.value) return
  
  isSaving.value = true
  error.value = null
  
  try {
    // 将 Vue 响应式对象转换为纯 JSON 对象，避免 DataCloneError
    const plainConfig = JSON.parse(JSON.stringify(config.value))
    await sendToExtension('tools.updateExecuteCommandConfig', {
      config: plainConfig
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('components.settings.toolSettings.common.error')
    console.error('Failed to save execute_command config:', err)
  } finally {
    isSaving.value = false
  }
}

// 切换 Shell 启用状态
async function toggleShell(shellType: string, enabled: boolean) {
  if (!config.value) return
  
  const shell = config.value.shells.find(s => s.type === shellType)
  if (shell) {
    shell.enabled = enabled
    await saveConfig()
  }
}

// 更新 Shell 路径并重新检测可用性
async function updateShellPath(shellType: string, path: string) {
  if (!config.value) return
  
  const shell = config.value.shells.find(s => s.type === shellType)
  if (shell) {
    shell.path = path || undefined
    await saveConfig()
    // 保存后重新加载以获取最新的可用性状态
    await loadConfig()
  }
}

// 设置默认 Shell
async function setDefaultShell(shellType: string) {
  if (!config.value) return
  
  config.value.defaultShell = shellType
  await saveConfig()
}

// 更新超时时间
async function updateTimeout(timeout: number) {
  if (!config.value) return
  
  config.value.defaultTimeout = timeout
  await saveConfig()
}

// 更新最大输出行数
async function updateMaxOutputLines(lines: number) {
  if (!config.value) return
  
  config.value.maxOutputLines = lines
  await saveConfig()
}

// 更新 Skill 目录 break-glass 安全开关
async function updateSkillAccessBreakGlass(enabled: boolean) {
  securityConfig.value.allowSkillDirectoryAccessViaExecuteCommand = enabled === true
  isSaving.value = true
  error.value = null

  try {
    // 为什么要改：该开关是机器级高危设置，不能随普通 execute_command config 保存。
    // 怎么改：调用专用后端 handler，由 SettingsManager.updateSecuritySettings 严格 boolean 归一化后写入 machine scope。
    // 目的：避免 Settings Sync、通用工具配置 API 或 truthy 注入打开 Skill 目录 shell 访问。
    await sendToExtension('tools.updateExecuteCommandSecuritySettings', {
      config: {
        allowSkillDirectoryAccessViaExecuteCommand: securityConfig.value.allowSkillDirectoryAccessViaExecuteCommand
      }
    })
  } catch (err) {
    securityConfig.value.allowSkillDirectoryAccessViaExecuteCommand = !enabled
    error.value = err instanceof Error ? err.message : t('components.settings.toolSettings.common.error')
    console.error('Failed to save execute_command security config:', err)
  } finally {
    isSaving.value = false
  }
}

// 获取 Shell 图标
function getShellIcon(type: string): string {
  const icons: Record<string, string> = {
    powershell: 'codicon-terminal-powershell',
    cmd: 'codicon-terminal-cmd',
    bash: 'codicon-terminal-bash',
    zsh: 'codicon-terminal-bash',
    sh: 'codicon-terminal',
    gitbash: 'codicon-terminal-bash',
    wsl: 'codicon-terminal-linux'
  }
  return icons[type] || 'codicon-terminal'
}

// 挂载时加载配置
onMounted(() => {
  loadConfig()
})
</script>

<template>
  <div class="execute-command-config">
    <!-- 加载状态 -->
    <div v-if="isLoading" class="loading-state">
      <i class="codicon codicon-loading codicon-modifier-spin"></i>
      <span>{{ t('components.settings.toolSettings.common.loadingConfig') }}</span>
    </div>
    
    <!-- 错误状态 -->
    <div v-else-if="error" class="error-state">
      <i class="codicon codicon-error"></i>
      <span>{{ error }}</span>
      <button class="retry-btn" @click="loadConfig">{{ t('components.settings.toolSettings.common.retry') }}</button>
    </div>
    
    <!-- 配置内容 -->
    <div v-else-if="config" class="config-content">
      <!-- Shell 环境配置 -->
      <div class="config-section">
        <div class="section-header">
          <i class="codicon codicon-terminal"></i>
          <span>{{ t('components.settings.toolSettings.terminal.executeCommand.shellEnv') }}</span>
          <span v-if="isSaving" class="saving-indicator">
            <i class="codicon codicon-loading codicon-modifier-spin"></i>
          </span>
        </div>
        
        <div class="shell-list">
          <div
            v-for="shell in config.shells"
            :key="shell.type"
            class="shell-item"
            :class="{
              disabled: !shell.enabled,
              'is-default': config.defaultShell === shell.type,
              'unavailable': shell.available === false
            }"
          >
            <div class="shell-main">
              <div class="shell-info">
                <i :class="['shell-icon', 'codicon', getShellIcon(shell.type)]"></i>
                <span class="shell-name">{{ shell.displayName }}</span>
                <span v-if="config.defaultShell === shell.type" class="default-badge">{{ t('components.settings.toolSettings.terminal.executeCommand.defaultBadge') }}</span>
                <!-- 可用性状态标识 -->
                <span v-if="shell.available === true" class="status-badge available" :title="t('components.settings.toolSettings.terminal.executeCommand.available')">
                  <i class="codicon codicon-check"></i>
                </span>
                <span v-else-if="shell.available === false" class="status-badge unavailable" :title="shell.unavailableReason || t('components.settings.toolSettings.terminal.executeCommand.unavailable')">
                  <i class="codicon codicon-close"></i>
                </span>
              </div>
              
              <div class="shell-actions">
                <!-- 设为默认按钮 -->
                <button
                  v-if="shell.enabled && config.defaultShell !== shell.type"
                  class="set-default-btn"
                  :title="t('components.settings.toolSettings.terminal.executeCommand.setDefaultTooltip')"
                  @click="setDefaultShell(shell.type)"
                >
                  <i class="codicon codicon-star-empty"></i>
                </button>
                
                <!-- 启用/禁用开关 -->
                <CustomCheckbox
                  :modelValue="shell.enabled"
                  @update:modelValue="(val: boolean) => toggleShell(shell.type, val)"
                />
              </div>
            </div>
            
            <!-- 路径配置（始终显示，方便用户配置） -->
            <div class="shell-path">
              <label class="path-label">
                <span>{{ t('components.settings.toolSettings.terminal.executeCommand.executablePath') }}</span>
                <input
                  type="text"
                  class="path-input"
                  :class="{ 'path-error': shell.available === false }"
                  :value="shell.path || ''"
                  :placeholder="t('components.settings.toolSettings.terminal.executeCommand.executablePathPlaceholder')"
                  @input="(e) => updateShellPath(shell.type, (e.target as HTMLInputElement).value)"
                />
              </label>
              <!-- 显示不可用原因 -->
              <div v-if="shell.available === false && shell.unavailableReason" class="path-error-hint">
                <i class="codicon codicon-warning"></i>
                <span>{{ shell.unavailableReason }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 超时配置 -->
      <div class="config-section">
        <div class="section-header">
          <i class="codicon codicon-clock"></i>
          <span>{{ t('components.settings.toolSettings.terminal.executeCommand.execTimeout') }}</span>
        </div>
        
        <div class="timeout-config">
          <CustomSelect
            class="timeout-select"
            :model-value="String(config.defaultTimeout)"
            :options="timeoutOptions"
            @update:model-value="(val: string) => updateTimeout(Number(val))"
          />
          <span class="timeout-hint">{{ t('components.settings.toolSettings.terminal.executeCommand.timeoutHint') }}</span>
        </div>
      </div>
      
      <!-- 最大输出行数配置 -->
      <div class="config-section">
        <div class="section-header">
          <i class="codicon codicon-list-ordered"></i>
          <span>{{ t('components.settings.toolSettings.terminal.executeCommand.maxOutputLines') }}</span>
        </div>
        
        <div class="output-lines-config">
          <CustomSelect
            class="output-lines-select"
            :model-value="String(config.maxOutputLines ?? 50)"
            :options="maxOutputLinesOptions"
            @update:model-value="(val: string) => updateMaxOutputLines(Number(val))"
          />
          <span class="output-lines-hint">{{ t('components.settings.toolSettings.terminal.executeCommand.maxOutputLinesHint') }}</span>
        </div>
      </div>
      
      <!-- Skill 目录 break-glass 安全配置 -->
      <div class="config-section danger-section">
        <div class="section-header danger-header">
          <i class="codicon codicon-warning"></i>
          <span>{{ t('components.settings.toolSettings.terminal.executeCommand.skillAccessBreakGlass') }}</span>
        </div>
        <div class="security-option">
          <div class="security-option-text">
            <p class="security-desc">{{ t('components.settings.toolSettings.terminal.executeCommand.skillAccessBreakGlassDesc') }}</p>
            <p class="security-warning">{{ t('components.settings.toolSettings.terminal.executeCommand.skillAccessBreakGlassWarning') }}</p>
          </div>
          <CustomCheckbox
            :modelValue="securityConfig.allowSkillDirectoryAccessViaExecuteCommand"
            @update:modelValue="(val: boolean) => updateSkillAccessBreakGlass(val)"
          />
        </div>
      </div>
      
      <!-- 提示信息 -->
      <div class="config-tips">
        <i class="codicon codicon-info"></i>
        <div class="tips-content">
          <p>{{ t('components.settings.toolSettings.terminal.executeCommand.tips.onlyEnabledUsed') }}</p>
          <p>{{ t('components.settings.toolSettings.terminal.executeCommand.tips.statusMeaning') }}</p>
          <p>{{ t('components.settings.toolSettings.terminal.executeCommand.tips.windowsRecommend') }}</p>
          <p>{{ t('components.settings.toolSettings.terminal.executeCommand.tips.gitBashRequire') }}</p>
          <p>{{ t('components.settings.toolSettings.terminal.executeCommand.tips.wslRequire') }}</p>
          <p>{{ t('components.settings.toolSettings.terminal.executeCommand.tips.confirmSettings') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.execute-command-config {
  padding: 12px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-top: none;
  border-radius: 0 0 4px 4px;
}

/* 加载和错误状态 */
.loading-state,
.error-state {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

.error-state {
  color: var(--vscode-errorForeground);
}

.retry-btn {
  margin-left: auto;
  padding: 4px 8px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: none;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
}

.retry-btn:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}

/* 配置内容 */
.config-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 配置区块 */
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
}

.saving-indicator {
  margin-left: auto;
  color: var(--vscode-descriptionForeground);
}

/* Shell 列表 */
.shell-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.shell-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
  border-radius: 4px;
  transition: all 0.15s;
}

.shell-item.disabled {
  opacity: 0.8;
}

.shell-item.disabled .shell-path {
  opacity: 0.7;
}

.shell-item.unavailable {
  border-color: var(--vscode-inputValidation-warningBorder);
}

.shell-item.is-default {
  border-color: var(--vscode-focusBorder);
}

.shell-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.shell-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.shell-icon {
  font-size: 14px;
  color: var(--vscode-terminal-ansiGreen);
}

.shell-name {
  font-size: 12px;
  font-weight: 500;
}

.default-badge {
  padding: 1px 6px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: 10px;
  font-size: 10px;
}

/* 可用性状态标识 */
.status-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  font-size: 10px;
}

.status-badge.available {
  color: var(--vscode-testing-iconPassed);
}

.status-badge.unavailable {
  color: var(--vscode-testing-iconFailed);
}

.available-icon {
  color: var(--vscode-testing-iconPassed);
}

.unavailable-icon {
  color: var(--vscode-testing-iconFailed);
}

.shell-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.set-default-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  transition: all 0.15s;
}

.set-default-btn:hover {
  background: var(--vscode-toolbar-hoverBackground);
  color: var(--vscode-foreground);
}

/* 路径配置 */
.shell-path {
  padding-top: 4px;
  border-top: 1px solid var(--vscode-panel-border);
}

.path-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.path-input {
  width: 100%;
  padding: 4px 8px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  border-radius: 4px;
  font-size: 11px;
  font-family: var(--vscode-editor-font-family);
}

.path-input:focus {
  outline: none;
  border-color: var(--vscode-focusBorder);
}

.path-input.path-error {
  border-color: var(--vscode-inputValidation-warningBorder);
}

.path-error-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  font-size: 10px;
  color: var(--vscode-inputValidation-warningForeground);
}

.path-error-hint .codicon {
  font-size: 12px;
}

/* 超时配置 */
.timeout-config {
  display: flex;
  align-items: center;
  gap: 12px;
}

.timeout-select {
  min-width: 100px;
}

.timeout-hint {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

/* 最大输出行数配置 */
.output-lines-config {
  display: flex;
  align-items: center;
  gap: 12px;
}

.output-lines-select {
  min-width: 100px;
}

.output-lines-hint {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

/* Skill 目录 break-glass 安全配置 */
.danger-section {
  padding: 8px 10px;
  background: var(--vscode-inputValidation-warningBackground, var(--vscode-textBlockQuote-background));
  border: 1px solid var(--vscode-inputValidation-warningBorder);
  border-radius: 4px;
}

.danger-header {
  color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
}

.security-option {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.security-option-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.security-desc,
.security-warning {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
}

.security-desc {
  color: var(--vscode-foreground);
}

.security-warning {
  color: var(--vscode-inputValidation-warningForeground, var(--vscode-descriptionForeground));
}

/* 提示信息 */
.config-tips {
  display: flex;
  gap: 8px;
  padding: 8px 10px;
  background: var(--vscode-textBlockQuote-background);
  border-left: 3px solid var(--vscode-textLink-foreground);
  border-radius: 0 4px 4px 0;
}

.config-tips .codicon {
  flex-shrink: 0;
  color: var(--vscode-textLink-foreground);
  font-size: 14px;
}

.tips-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tips-content p {
  margin: 0;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.4;
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