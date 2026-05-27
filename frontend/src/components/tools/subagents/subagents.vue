<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '@/composables'
import { TaskCard, MarkdownRenderer, CustomScrollbar } from '../../common'
import { extractPreviewText, formatSubAgentRuntimeBadge } from '../../../utils/taskCards'

const { t } = useI18n()

const props = defineProps<{
  args: Record<string, unknown>
  result?: Record<string, unknown>
}>()

const agentName = computed(() => (props.args.agentName as string) || ((props.result as any)?.data?.agentName as string) || 'Sub-Agent')
const prompt = computed(() => (props.args.prompt as string) || '')
const context = computed(() => (props.args.context as string) || '')

const resultData = computed(() => ((props.result as any)?.data || {}) as any)
const responseText = computed(() => (resultData.value.response || resultData.value.partialResponse || '') as string)
const errorMessage = computed(() => (props.result as any)?.error as string | undefined)
// 修改原因：展开区不再提供独立“打开详情”按钮，runId 只作为完成后的诊断信息展示。
// 修改方式：按钮能力已合并到 ToolMessage 的通用 Open details action，这里保留 runId 文本辅助定位。
// 修改目的：避免同一功能出现两个入口，同时让 pending 阶段也能通过顶部按钮打开 Monitor。
const runId = computed(() => resultData.value.runId as string | undefined)

const cardStatus = computed<'pending' | 'running' | 'success' | 'error'>(() => {
  const r = props.result as any
  if (!r) return 'running'
  return r.success === true ? 'success' : 'error'
})

const runtimeBadge = computed(() => {
  const channelName = resultData.value.channelName as string | undefined
  const modelId = resultData.value.modelId as string | undefined
  if (!channelName) return ''
  return formatSubAgentRuntimeBadge({ channelName, modelId })
})

const chips = computed(() => {
  const list: string[] = []
  const steps = resultData.value.steps
  if (typeof steps === 'number') list.push(`Steps: ${steps}`)
  return list
})

const preview = computed(() => {
  const src = responseText.value || prompt.value
  return extractPreviewText(src, { maxLines: 10, maxChars: 1200 })
})
</script>

<template>
  <TaskCard
    :title="`Sub-Agent · ${agentName}`"
    icon="codicon-hubot"
    :status="cardStatus"
    :subtitle="prompt ? prompt : undefined"
    :preview="preview"
    :preview-is-markdown="true"
    :meta-chips="chips"
    :footer-right="runtimeBadge"
  >
    <template #expanded>
      <div class="expanded">
        <div class="block">
          <div class="label">{{ t('components.tools.subagents.task') }}</div>
          <CustomScrollbar :max-height="200">
            <pre class="pre">{{ prompt }}</pre>
          </CustomScrollbar>
        </div>

        <div v-if="context" class="block">
          <div class="label">{{ t('components.tools.subagents.context') }}</div>
          <CustomScrollbar :max-height="200">
            <pre class="pre">{{ context }}</pre>
          </CustomScrollbar>
        </div>

        <!-- 修改原因：详情入口已合并到工具头部 Open details，展开区不能再保留重复的“打开详情”按钮。
             修改方式：这里只在最终结果返回 runId 后展示文本，pending 阶段由顶部 action 负责打开 Monitor。
             修改目的：统一入口、统一 i18n 和统一旧版按钮样式。 -->
        <div v-if="runId" class="actions">
          <span class="run-id">{{ runId }}</span>
        </div>

        <div v-if="errorMessage" class="error">{{ errorMessage }}</div>
        <div v-if="responseText" class="response-block">
          <CustomScrollbar :max-height="500">
            <MarkdownRenderer :content="responseText" />
          </CustomScrollbar>
        </div>
      </div>
    </template>
  </TaskCard>
</template>

<style scoped>
.expanded {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground);
}

.pre {
  margin: 0;
  padding: 8px 10px;
  background: var(--vscode-sideBar-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  font-size: 12px;
  color: var(--vscode-foreground);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--vscode-editor-font-family), monospace;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.run-id {
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
  font-family: var(--vscode-editor-font-family), monospace;
}

.response-block {
  background: var(--vscode-sideBar-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  overflow: hidden;
}

.response-block :deep(.markdown-content) {
  padding: 8px 10px;
}

.error {
  padding: 8px 10px;
  background: var(--vscode-inputValidation-errorBackground);
  border: 1px solid var(--vscode-inputValidation-errorBorder);
  border-radius: 8px;
  color: var(--vscode-errorForeground);
  font-size: 12px;
  word-break: break-word;
}
</style>
