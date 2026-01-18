<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '@/composables'
import MarkdownRenderer from '../../common/MarkdownRenderer.vue'

const { t } = useI18n()

const props = defineProps<{
  args: Record<string, unknown>
  result?: Record<string, unknown>
}>()

// 获取任务提示词
const prompt = computed(() => {
  const p = props.args.prompt as string || ''
  return p
})

// 获取上下文（如果有）
const context = computed(() => props.args.context as string | undefined)

// 检查是否成功
const isSuccess = computed(() => props.result?.success === true)

// 获取响应内容
const response = computed(() => {
  const data = props.result?.data as Record<string, unknown> | undefined
  return data?.response as string || data?.partialResponse as string || ''
})

// 获取错误信息
const errorMessage = computed(() => props.result?.error as string | undefined)
</script>

<template>
  <div class="subagents-content">
    <!-- 任务提示 -->
    <div class="task-section">
      <div class="task-label">{{ t('components.tools.subagents.task') }}</div>
      <div class="task-prompt">{{ prompt }}</div>
    </div>
    
    <!-- 上下文（如果有） -->
    <div v-if="context" class="context-section">
      <div class="context-label">{{ t('components.tools.subagents.context') }}</div>
      <div class="context-text">{{ context }}</div>
    </div>
    
    <!-- 结果 -->
    <template v-if="result">
      <!-- 成功 -->
      <div v-if="isSuccess" class="result-section success">
        <div class="result-header">
          <i class="codicon codicon-pass"></i>
          <span>{{ t('components.tools.subagents.completed') }}</span>
        </div>
        <div v-if="response" class="result-content">
          <MarkdownRenderer :content="response" />
        </div>
      </div>
      
      <!-- 失败 -->
      <div v-else class="result-section error">
        <div class="result-header">
          <i class="codicon codicon-error"></i>
          <span>{{ t('components.tools.subagents.failed') }}</span>
        </div>
        <div v-if="errorMessage" class="error-message">{{ errorMessage }}</div>
        <div v-if="response" class="result-content partial">
          <div class="partial-label">{{ t('components.tools.subagents.partialResponse') }}:</div>
          <MarkdownRenderer :content="response" />
        </div>
      </div>
    </template>
    
    <!-- 执行中 -->
    <div v-else class="result-section pending">
      <div class="result-header">
        <i class="codicon codicon-loading codicon-modifier-spin"></i>
        <span>{{ t('components.tools.subagents.executing') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.subagents-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 0;
}

.task-section,
.context-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.task-label,
.context-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--vscode-descriptionForeground);
  text-transform: uppercase;
}

.task-prompt {
  font-size: 12px;
  color: var(--vscode-foreground);
  padding: 8px 10px;
  background: var(--vscode-editor-background);
  border-radius: 4px;
  border-left: 3px solid var(--vscode-textLink-foreground);
  white-space: pre-wrap;
  word-break: break-word;
}

.context-text {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  padding: 6px 10px;
  background: var(--vscode-editor-background);
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 100px;
  overflow-y: auto;
}

.result-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 6px;
  background: var(--vscode-editor-background);
}

.result-section.success {
  border-left: 3px solid var(--vscode-terminal-ansiGreen);
}

.result-section.error {
  border-left: 3px solid var(--vscode-errorForeground);
}

.result-section.pending {
  border-left: 3px solid var(--vscode-textLink-foreground);
}

.result-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 500;
}

.result-section.success .result-header {
  color: var(--vscode-terminal-ansiGreen);
}

.result-section.error .result-header {
  color: var(--vscode-errorForeground);
}

.result-section.pending .result-header {
  color: var(--vscode-textLink-foreground);
}

.result-content {
  font-size: 13px;
  line-height: 1.5;
  color: var(--vscode-foreground);
}

.result-content.partial {
  opacity: 0.8;
}

.partial-label {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 4px;
}

.error-message {
  font-size: 12px;
  color: var(--vscode-errorForeground);
  padding: 6px 8px;
  background: var(--vscode-inputValidation-errorBackground);
  border-radius: 4px;
}

.codicon-modifier-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
