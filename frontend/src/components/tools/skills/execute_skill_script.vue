<script setup lang="ts">
/**
 * execute_skill_script 工具结果展示组件。
 *
 * 为什么要加：Skill 脚本执行结果包含 runner、退出码、终止状态和日志；通用 JSON 回退
 * 无法形成可审计的执行视图。
 * 怎么改：组件只展示白名单字段，并复用现有 ToolUsage 状态协议派生 UI 状态。
 * 目的：让用户能快速判断脚本是否已获批、是否正在运行、是否失败，同时避免泄露
 * staging 目录或 Skill 本地真实路径。
 */
import { computed, ref } from 'vue'
import { useI18n } from '../../../i18n'
import type { ToolUsage } from '../../../types'
import {
  asBoolean,
  asNumber,
  asString,
  asStringArray,
  getRelativePath,
  getResultData,
  getSkillName,
  isPendingStatus,
  previewText
} from '../../../utils/tools/skills/skillToolDisplay'

const props = defineProps<{
  args: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
  status?: ToolUsage['status']
  toolId?: string
  toolName?: string
}>()

const { t } = useI18n()

const expanded = ref(false)
const copied = ref(false)

const data = computed(() => getResultData(props.result))
const skillName = computed(() => getSkillName(props.args, data.value))
const relativePath = computed(() => getRelativePath(props.args, data.value))
const runner = computed(() => asString(data.value?.runner, 'runner'))
const scriptArgs = computed(() => asStringArray(data.value?.args).length > 0 ? asStringArray(data.value?.args) : asStringArray(props.args.args))
const exitCode = computed(() => asNumber(data.value?.exitCode))
const killed = computed(() => asBoolean(data.value?.killed))
const outputPreview = computed(() => previewText(data.value?.output, expanded.value ? 30000 : 8000))
const output = computed(() => outputPreview.value.text)
const errorMessage = computed(() => props.error || asString(props.result?.error))
const isPending = computed(() => isPendingStatus(props.status, props.result, props.error))
const isAwaitingApproval = computed(() => props.status === 'awaiting_approval')
const hasFailed = computed(() => !!errorMessage.value || killed.value || (exitCode.value !== undefined && exitCode.value !== 0))
const hasSucceeded = computed(() => props.result?.success === true && exitCode.value === 0 && !killed.value)

const statusClass = computed(() => {
  if (hasFailed.value) return 'error'
  if (hasSucceeded.value) return 'success'
  if (isAwaitingApproval.value) return 'awaiting'
  if (isPending.value) return 'running'
  return 'pending'
})

const statusLabel = computed(() => {
  if (killed.value) return t('components.tools.skills.executeScript.statusKilled')
  if (errorMessage.value) return t('components.tools.skills.executeScript.statusFailed')
  if (exitCode.value !== undefined) return exitCode.value === 0 ? t('components.tools.skills.executeScript.statusSuccess') : t('components.tools.skills.executeScript.statusExitCode', { code: exitCode.value })
  if (isAwaitingApproval.value) return t('components.tools.skills.executeScript.statusAwaitingApproval')
  if (isPending.value) return t('components.tools.skills.executeScript.statusRunning')
  return t('components.tools.skills.executeScript.statusPending')
})

async function copyOutput() {
  if (!output.value) return
  try {
    await navigator.clipboard.writeText(output.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1000)
  } catch (error) {
    console.error('Copy skill script output failed:', error)
  }
}
</script>

<template>
  <div class="skill-script-card" :class="statusClass">
    <div class="script-header">
      <div class="script-title" :title="relativePath">
        <i class="codicon codicon-terminal"></i>
        <span class="script-path">{{ relativePath }}</span>
      </div>
      <div class="script-meta">
        <span class="runner-tag" :title="runner">{{ runner }}</span>
        <span class="status-badge" :class="statusClass">
          <i v-if="statusClass === 'running'" class="codicon codicon-loading codicon-modifier-spin"></i>
          {{ statusLabel }}
        </span>
      </div>
    </div>

    <div class="script-summary">
      <div class="summary-row">
        <span class="summary-label">{{ t('components.tools.skills.executeScript.labelSkill') }}</span>
        <span class="summary-value" :title="skillName">{{ skillName }}</span>
      </div>
      <div v-if="scriptArgs.length > 0" class="summary-row">
        <span class="summary-label">{{ t('components.tools.skills.executeScript.labelArgs') }}</span>
        <span class="summary-value args-value" :title="scriptArgs.join(' ')">{{ scriptArgs.join(' ') }}</span>
      </div>
      <div v-if="exitCode !== undefined || killed" class="summary-row">
        <span class="summary-label">{{ t('components.tools.skills.executeScript.labelResult') }}</span>
        <span class="summary-value">
          <span v-if="exitCode !== undefined">{{ t('components.tools.skills.executeScript.statusExitCode', { code: exitCode }) }}</span>
          <span v-if="killed"> {{ t('components.tools.skills.executeScript.statusKilled') }}</span>
        </span>
      </div>
    </div>

    <div v-if="isAwaitingApproval" class="state-panel awaiting-panel">
      <i class="codicon codicon-shield"></i>
      <span>{{ t('components.tools.skills.executeScript.awaitingApprovalHint') }}</span>
    </div>

    <div v-else-if="isPending" class="state-panel running-panel">
      <i class="codicon codicon-loading codicon-modifier-spin"></i>
      <span>{{ t('components.tools.skills.executeScript.executing') }}</span>
    </div>

    <div v-if="errorMessage" class="state-panel error-panel">
      <i class="codicon codicon-error"></i>
      <span>{{ errorMessage }}</span>
    </div>

    <div class="script-output" :class="{ expanded }">
      <pre v-if="output" class="output-content">{{ output }}</pre>
      <div v-else class="empty-output">{{ t('components.tools.skills.executeScript.noOutput') }}</div>
      <div v-if="!expanded && outputPreview.clipped" class="fade-overlay"></div>
    </div>

    <div class="script-actions">
      <button class="action-button" type="button" @click.stop="expanded = !expanded">
        <i class="codicon" :class="expanded ? 'codicon-chevron-up' : 'codicon-chevron-down'"></i>
        {{ expanded ? t('common.collapse') : t('common.expand') }}
      </button>
      <button class="action-button" type="button" :class="{ copied }" @click.stop="copyOutput">
        <i class="codicon" :class="copied ? 'codicon-check' : 'codicon-copy'"></i>
        {{ copied ? t('common.copied') : t('components.tools.skills.executeScript.copyOutput') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.skill-script-card {
  display: flex;
  flex-direction: column;
  margin: 8px 0;
  overflow: hidden;
  border: 1px solid var(--vscode-panel-border);
  border-left: 3px solid var(--vscode-descriptionForeground);
  border-radius: 4px;
  background: var(--vscode-terminal-background, var(--vscode-editor-background));
}

.skill-script-card.running {
  border-left-color: var(--vscode-charts-blue, var(--vscode-textLink-foreground));
}

.skill-script-card.success {
  border-left-color: var(--vscode-terminal-ansiGreen, var(--vscode-testing-iconPassed));
}

.skill-script-card.error {
  border-left-color: var(--vscode-errorForeground, var(--vscode-testing-iconFailed));
}

.script-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-inactiveSelectionBackground);
}

.script-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--vscode-foreground);
  font-size: 12px;
  font-weight: 500;
}

.script-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--vscode-editor-font-family), monospace;
}

.script-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.runner-tag,
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 6px;
  border-radius: 3px;
  font-family: var(--vscode-editor-font-family), monospace;
  font-size: 10px;
}

.runner-tag {
  color: var(--vscode-descriptionForeground);
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
}

.status-badge {
  color: var(--vscode-descriptionForeground);
  background: var(--vscode-editor-background);
}

.status-badge.running {
  color: var(--vscode-charts-blue, var(--vscode-textLink-foreground));
}

.status-badge.success {
  color: var(--vscode-terminal-ansiGreen, var(--vscode-testing-iconPassed));
}

.status-badge.error {
  color: var(--vscode-errorForeground, var(--vscode-testing-iconFailed));
}

.status-badge.awaiting {
  color: var(--vscode-charts-yellow, var(--vscode-descriptionForeground));
}

.script-summary {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-background);
}

.summary-row {
  display: flex;
  gap: 8px;
  min-width: 0;
  font-size: 11px;
}

.summary-label {
  width: 46px;
  flex-shrink: 0;
  color: var(--vscode-descriptionForeground);
}

.summary-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--vscode-foreground);
  font-family: var(--vscode-editor-font-family), monospace;
}

.args-value {
  color: var(--vscode-descriptionForeground);
}

.state-panel {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--vscode-panel-border);
  font-size: 12px;
}

.awaiting-panel {
  color: var(--vscode-charts-yellow, var(--vscode-descriptionForeground));
}

.running-panel {
  color: var(--vscode-charts-blue, var(--vscode-textLink-foreground));
}

.error-panel {
  color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
  background: var(--vscode-inputValidation-errorBackground, var(--vscode-editor-background));
}

.script-output {
  position: relative;
  max-height: 220px;
  overflow: hidden;
  background: var(--vscode-terminal-background, var(--vscode-editor-background));
}

.script-output.expanded {
  max-height: 560px;
  overflow: auto;
}

.output-content {
  margin: 0;
  padding: 10px;
  color: var(--vscode-terminal-foreground, var(--vscode-foreground));
  font-family: var(--vscode-editor-font-family), monospace;
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.empty-output {
  padding: 10px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

.fade-overlay {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 28px;
  pointer-events: none;
  background: linear-gradient(to bottom, transparent, var(--vscode-terminal-background, var(--vscode-editor-background)));
}

.script-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding: 5px 8px;
  border-top: 1px dashed var(--vscode-panel-border);
  background: var(--vscode-editor-inactiveSelectionBackground);
}

.action-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border: none;
  border-radius: 3px;
  color: var(--vscode-descriptionForeground);
  background: transparent;
  font-size: 11px;
  cursor: pointer;
}

.action-button:hover {
  color: var(--vscode-foreground);
  background: var(--vscode-toolbar-hoverBackground);
}

.action-button.copied {
  color: var(--vscode-terminal-ansiGreen, var(--vscode-testing-iconPassed));
}
</style>
