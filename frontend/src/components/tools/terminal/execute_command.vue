<script setup lang="ts">
/**
 * execute_command 工具的内容面板
 *
 * 显示：
 * - 命令执行状态
 * - 终端输出（实时更新）
 * - 杀掉终端按钮
 *
 * 使用 terminalStore 管理实时输出
 */

import { computed, ref, watch, onMounted, nextTick } from 'vue'
import { useTerminalStore } from '../../../stores/terminalStore'
import CustomScrollbar from '../../common/CustomScrollbar.vue'
import { useI18n } from '../../../composables/useI18n'
import { loadTerminalOutputWindow } from '../../../utils/vscode'

const { t } = useI18n()

const props = defineProps<{
  args: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
  status?: 'streaming' | 'queued' | 'awaiting_approval' | 'executing' | 'awaiting_apply' | 'success' | 'error' | 'warning'
  toolId?: string
}>()

const emit = defineEmits<{
  (e: 'update-result', result: Record<string, unknown>): void
}>()

// 终端 store
const terminalStore = useTerminalStore()

// 杀掉终端的加载状态
const killing = ref(false)
const loadingFullOutput = ref(false)
const expandedOutput = ref<string | null>(null)

// 滚动容器引用
const outputContainer = ref<HTMLElement | null>(null)

// 是否自动滚动到底部
const autoScroll = ref(true)

// 获取命令参数
const command = computed(() => props.args.command as string || '')
const cwd = computed(() => props.args.cwd as string || '')
const shell = computed(() => props.args.shell as string || 'default')

// 获取结果数据（来自工具执行结果）
const resultData = computed(() => {
  const result = props.result as Record<string, any> | undefined
  return result?.data || {}
})

// 终端 ID（来自工具执行结果）
const terminalId = computed(() => resultData.value.terminalId as string || '')

// 从 store 获取终端状态
// 优先通过 terminalId 获取，如果没有则尝试通过命令匹配
const terminalState = computed(() => {
  if (terminalId.value) {
    return terminalStore.getTerminal(terminalId.value)
  }
  
  if (command.value) {
    const matchedId = terminalStore.findTerminalByCommand(command.value, cwd.value || undefined)
    if (matchedId) {
      return terminalStore.getTerminal(matchedId)
    }
  }
  
  return null
})

// 输出内容 - 优先使用 store 中的实时输出，否则使用结果中的静态输出
const output = computed(() => {
  // 如果有实时终端状态，使用实时输出
  if (terminalState.value) {
    return terminalState.value.output
  }
  // 否则使用结果中的静态输出（历史记录）
  return resultData.value.output as string || ''
})

const outputRefs = computed(() => terminalState.value?.outputRefs || [])
const canLoadFullOutput = computed(() => outputRefs.value.length > 0 && !expandedOutput.value)
const displayedOutput = computed(() => expandedOutput.value ?? output.value)

// 执行状态
const exitCode = computed(() => {
  // 优先使用实时状态
  if (terminalState.value && terminalState.value.exitCode !== undefined) {
    return terminalState.value.exitCode
  }
  return resultData.value.exitCode as number | undefined
})

const killed = computed(() => {
  // 优先使用实时状态
  if (terminalState.value) {
    return terminalState.value.killed || false
  }
  return resultData.value.killed as boolean || false
})

// 是否被用户取消
const cancelled = computed(() => {
  const result = props.result as Record<string, any> | undefined
  return result?.cancelled as boolean || false
})

const duration = computed(() => {
  // 优先使用实时状态
  if (terminalState.value && terminalState.value.duration !== undefined) {
    return terminalState.value.duration
  }
  return resultData.value.duration as number | undefined
})

const truncated = computed(() => resultData.value.truncated as boolean || false)
const totalLines = computed(() => resultData.value.totalLines as number || 0)
const outputLines = computed(() => resultData.value.outputLines as number || 0)

// 是否正在运行
const isRunning = computed(() => {
  if (props.error) return false
  
  const result = props.result as Record<string, any> | undefined
  if (result?.error) return false
  
  if (
    props.status === 'streaming' ||
    props.status === 'queued' ||
    props.status === 'awaiting_approval' ||
    props.status === 'executing'
  ) {
    return true
  }
  
  if (terminalState.value) {
    return terminalState.value.running
  }
  
  if (killed.value) return false
  if (exitCode.value !== undefined) return false
  return !!terminalId.value
})

// 执行状态标签
const statusLabel = computed(() => {
  // 检查结果中的 error 字段
  const result = props.result as Record<string, any> | undefined
  const resultError = result?.error as string | undefined
  
  // 优先检测取消状态（用户点击了取消按钮）
  if (cancelled.value || killed.value) {
    return t('components.tools.terminal.executeCommandPanel.status.terminated')
  }
  if (props.error || resultError) return t('components.tools.terminal.executeCommandPanel.status.failed')
  if (exitCode.value === 0) return t('components.tools.terminal.executeCommandPanel.status.success')
  if (exitCode.value !== undefined) return t('components.tools.terminal.executeCommandPanel.status.exitCode', { code: exitCode.value })
  if (isRunning.value) return t('components.tools.terminal.executeCommandPanel.status.running')
  return t('components.tools.terminal.executeCommandPanel.status.pending')
})

// 状态颜色类
const statusClass = computed(() => {
  // 检查结果中的 error 字段
  const result = props.result as Record<string, any> | undefined
  const resultError = result?.error as string | undefined
  
  // 优先检测取消状态（用户点击了取消按钮）
  if (cancelled.value || killed.value) return 'warning'
  if (props.error || resultError) return 'error'
  if (exitCode.value !== undefined && exitCode.value !== 0) return 'error'
  if (exitCode.value === 0) return 'success'
  if (isRunning.value) return 'running'
  return 'pending'
})

// 格式化持续时间
function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return ''
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

// 实际的终端标识（用于注册和杀死）
// 优先使用 result 中的 terminalId，其次通过命令匹配
const effectiveTerminalId = computed(() => {
  if (terminalId.value) {
    return terminalId.value
  }
  
  if (command.value) {
    const matchedId = terminalStore.findTerminalByCommand(command.value, cwd.value || undefined)
    if (matchedId) {
      return matchedId
    }
  }
  
  if (terminalState.value) {
    return terminalState.value.id
  }
  
  return props.toolId || ''
})

// 杀掉终端
async function handleKillTerminal() {
  if (!effectiveTerminalId.value || killing.value) {
    return
  }
  
  killing.value = true
  
  try {
    const result = await terminalStore.killTerminal(effectiveTerminalId.value)
    
    if (result.success) {
      // 更新结果显示被杀掉
      emit('update-result', {
        ...props.result,
        data: {
          ...resultData.value,
          killed: true,
          output: result.output || resultData.value.output,
          endTime: Date.now()
        }
      })
    }
  } catch (err) {
    console.error('杀掉终端失败:', err)
  } finally {
    killing.value = false
  }
}

// 复制输出
const copied = ref(false)
async function copyOutput() {
  if (!displayedOutput.value) return
  
  try {
    await navigator.clipboard.writeText(displayedOutput.value)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 1000)
  } catch (err) {
    console.error('复制失败:', err)
  }
}

async function loadFullOutput() {
  if (!canLoadFullOutput.value || loadingFullOutput.value) return

  loadingFullOutput.value = true
  try {
    let nextOutput = output.value
    const previews = terminalState.value?.outputRefPreviews || {}
    for (const refId of outputRefs.value) {
      const full = await loadTerminalOutputWindow(refId, { includePayload: true })
      if (!full?.data) continue
      const preview = previews[refId]
      if (preview && nextOutput.includes(preview)) {
        nextOutput = nextOutput.replace(preview, full.data)
      } else if (!nextOutput.includes(full.data)) {
        nextOutput += `\n${full.data}`
      }
    }
    expandedOutput.value = nextOutput
  } finally {
    loadingFullOutput.value = false
  }
}

// 滚动到底部
function scrollToBottom() {
  if (outputContainer.value && autoScroll.value) {
    nextTick(() => {
      const container = outputContainer.value
      if (container) {
        container.scrollTop = container.scrollHeight
      }
    })
  }
}

// 监听输出变化，自动滚动
watch(displayedOutput, () => {
  scrollToBottom()
})

// 组件挂载时，如果正在运行，注册到 store
onMounted(() => {
  if (isRunning.value && effectiveTerminalId.value) {
    terminalStore.registerTerminal(effectiveTerminalId.value)
  }
})

// 监听终端 ID 变化
watch(effectiveTerminalId, (newId) => {
  if (newId && isRunning.value) {
    terminalStore.registerTerminal(newId)
  }
})

// 监听运行状态变化
watch(isRunning, (running) => {
  if (running && effectiveTerminalId.value) {
    terminalStore.registerTerminal(effectiveTerminalId.value)
  }
})
</script>

<template>
  <div class="execute-command-panel">
    <!-- 头部信息 -->
    <div class="panel-header">
      <div class="header-info">
        <span class="codicon codicon-terminal terminal-icon"></span>
        <span class="title">{{ t('components.tools.terminal.executeCommandPanel.title') }}</span>
        <span :class="['status-badge', statusClass]">{{ statusLabel }}</span>
      </div>
      <div class="header-actions">
        <span v-if="duration !== undefined" class="duration">
          {{ formatDuration(duration) }}
        </span>
        <button
          v-if="isRunning"
          class="action-btn kill-btn"
          :disabled="killing"
          :title="t('components.tools.terminal.executeCommandPanel.terminateTooltip')"
          @click="handleKillTerminal"
        >
          <span class="codicon codicon-debug-stop"></span>
          <span class="btn-text">{{ t('components.tools.terminal.executeCommandPanel.terminate') }}</span>
        </button>
        <button
          v-if="output"
          class="action-btn"
          :class="{ 'copied': copied }"
          :title="copied ? t('components.tools.terminal.executeCommandPanel.copied') : t('components.tools.terminal.executeCommandPanel.copyOutput')"
          @click="copyOutput"
        >
          <span :class="['codicon', copied ? 'codicon-check' : 'codicon-copy']"></span>
        </button>
      </div>
    </div>
    
    <!-- 命令信息 -->
    <div class="command-info">
      <div class="command-row">
        <span class="prompt">$</span>
        <code class="command-text">{{ command }}</code>
      </div>
      <div v-if="cwd" class="meta-row">
        <span class="codicon codicon-folder-opened"></span>
        <span class="meta-text">{{ cwd }}</span>
      </div>
      <div v-if="shell !== 'default'" class="meta-row">
        <span class="codicon codicon-terminal-bash"></span>
        <span class="meta-text">{{ shell }}</span>
      </div>
    </div>
    
    <!-- 错误信息 -->
    <div v-if="error || resultData.error" class="panel-error">
      <span class="codicon codicon-error error-icon"></span>
      <span class="error-text">{{ error || resultData.error }}</span>
    </div>
    
    <!-- 输出内容 -->
    <div v-else-if="output || isRunning" class="output-section">
      <div class="output-header">
        <span class="output-title">{{ t('components.tools.terminal.executeCommandPanel.output') }}</span>
        <div class="output-header-right">
          <span v-if="truncated && !isRunning" class="truncated-info">
            {{ t('components.tools.terminal.executeCommandPanel.truncatedInfo', { outputLines, totalLines }) }}
          </span>
          <button
            v-if="canLoadFullOutput"
            class="action-btn icon-only"
            :disabled="loadingFullOutput"
            :title="t('components.tools.terminal.executeCommandPanel.loadFullOutput')"
            @click="loadFullOutput"
          >
            <span :class="['codicon', loadingFullOutput ? 'codicon-loading codicon-modifier-spin' : 'codicon-unfold']"></span>
          </button>
          <label v-if="isRunning" class="auto-scroll-toggle">
            <input
              type="checkbox"
              v-model="autoScroll"
              class="auto-scroll-checkbox"
            />
            <span class="auto-scroll-label">{{ t('components.tools.terminal.executeCommandPanel.autoScroll') }}</span>
          </label>
        </div>
      </div>
      <div class="output-content">
        <div class="content-wrapper" ref="outputContainer">
          <CustomScrollbar :horizontal="true">
            <pre class="output-code"><code>{{ displayedOutput || t('components.tools.terminal.executeCommandPanel.waitingOutput') }}</code></pre>
          </CustomScrollbar>
        </div>
      </div>
    </div>
    
    <!-- 无输出 -->
    <div v-else-if="!isRunning && !error" class="no-output">
      <span class="codicon codicon-info"></span>
      <span>{{ t('components.tools.terminal.executeCommandPanel.noOutput') }}</span>
    </div>
    
    <!-- 运行中指示器 -->
    <div v-if="isRunning" class="running-indicator">
      <span class="spinner"></span>
      <span>{{ t('components.tools.terminal.executeCommandPanel.executing') }}</span>
    </div>
  </div>
</template>

<style scoped>
.execute-command-panel {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
}

/* 头部 */
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-xs, 4px) 0;
}

.header-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
}

.terminal-icon {
  color: var(--vscode-terminal-ansiGreen);
  font-size: 14px;
}

.title {
  font-weight: 600;
  font-size: 12px;
  color: var(--vscode-foreground);
}

.status-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 10px;
  font-weight: 500;
}

.status-badge.success {
  background: var(--vscode-testing-iconPassed);
  color: var(--vscode-editor-background);
}

.status-badge.error {
  background: var(--vscode-testing-iconFailed);
  color: var(--vscode-editor-background);
}

.status-badge.warning {
  background: var(--vscode-charts-yellow);
  color: var(--vscode-editor-background);
}

.status-badge.running {
  background: var(--vscode-charts-blue);
  color: var(--vscode-editor-background);
}

.status-badge.pending {
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
}

.duration {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  background: transparent;
  border: 1px solid var(--vscode-button-border, transparent);
  border-radius: var(--radius-sm, 2px);
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  font-size: 11px;
  transition: all var(--transition-fast, 0.1s);
}

.action-btn:hover {
  background: var(--vscode-toolbar-hoverBackground);
  color: var(--vscode-foreground);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn.copied {
  color: var(--vscode-testing-iconPassed);
}

.kill-btn {
  color: var(--vscode-testing-iconFailed);
  border-color: var(--vscode-testing-iconFailed);
}

.kill-btn:hover {
  background: var(--vscode-testing-iconFailed);
  color: var(--vscode-editor-background);
}

.btn-text {
  font-size: 10px;
}

/* 命令信息 */
.command-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--spacing-sm, 8px);
  background: var(--vscode-terminal-background, var(--vscode-editor-background));
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-sm, 2px);
}

.command-row {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm, 8px);
}

.prompt {
  color: var(--vscode-terminal-ansiGreen);
  font-family: var(--vscode-editor-font-family);
  font-weight: bold;
  flex-shrink: 0;
}

.command-text {
  font-family: var(--vscode-editor-font-family);
  font-size: 12px;
  color: var(--vscode-terminal-foreground, var(--vscode-foreground));
  word-break: break-all;
  white-space: pre-wrap;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  padding-left: 16px;
}

.meta-text {
  font-family: var(--vscode-editor-font-family);
}

/* 错误显示 */
.panel-error {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-sm, 8px);
  background: var(--vscode-inputValidation-errorBackground);
  border: 1px solid var(--vscode-inputValidation-errorBorder);
  border-radius: var(--radius-sm, 2px);
}

.error-icon {
  color: var(--vscode-inputValidation-errorForeground);
  font-size: 14px;
  flex-shrink: 0;
}

.error-text {
  font-size: 12px;
  color: var(--vscode-inputValidation-errorForeground);
  line-height: 1.4;
}

/* 输出区域 */
.output-section {
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-sm, 2px);
  overflow: hidden;
}

.output-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-bottom: 1px solid var(--vscode-panel-border);
}

.output-title {
  font-size: 11px;
  font-weight: 500;
  color: var(--vscode-foreground);
}

.output-header-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
}

.truncated-info {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
}

.auto-scroll-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  user-select: none;
}

.auto-scroll-checkbox {
  width: 12px;
  height: 12px;
  cursor: pointer;
}

.auto-scroll-label {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
}

.output-content {
  background: var(--vscode-terminal-background, var(--vscode-editor-background));
}

.content-wrapper {
  height: 200px;
  position: relative;
}

.output-code {
  margin: 0;
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  font-size: 11px;
  font-family: var(--vscode-editor-font-family);
  color: var(--vscode-terminal-foreground, var(--vscode-foreground));
  line-height: 1.4;
  white-space: pre;
}

.output-code code {
  font-family: inherit;
}

/* 无输出 */
.no-output {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-md, 16px);
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

/* 运行中指示器 */
.running-indicator {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-sm, 8px);
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-radius: var(--radius-sm, 2px);
  color: var(--vscode-foreground);
  font-size: 11px;
}

.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--vscode-charts-blue);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
