<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '@/composables'
import { TaskCard, MarkdownRenderer, CustomScrollbar } from '../../common'
import { extractPreviewText, formatSubAgentRuntimeBadge } from '../../../utils/taskCards'
import { buildSubAgentRunDisplayModel } from '../../../utils/subAgentDisplayModel'

const { t } = useI18n()

const props = defineProps<{
  args: Record<string, unknown>
  result?: Record<string, unknown>
}>()

const resultData = computed(() => ((props.result as any)?.data || {}) as any)
const responseText = computed(() => (resultData.value.response || resultData.value.partialResponse || '') as string)
const errorMessage = computed(() => (props.result as any)?.error as string | undefined)

const runtimeBadge = computed(() => {
  const channelName = resultData.value.channelName as string | undefined
  const modelId = resultData.value.modelId as string | undefined
  if (!channelName) return ''
  return formatSubAgentRuntimeBadge({ channelName, modelId })
})

const displayModel = computed(() => buildSubAgentRunDisplayModel({
  args: props.args,
  result: props.result,
  runtimeBadge: runtimeBadge.value
}))

const cardStatus = computed<'pending' | 'running' | 'success' | 'error'>(() => {
  /**
   * 修改原因：SubAgent 卡片的视觉状态应来自 SubAgentRunDisplayModel，而不是直接在模板里根据 raw result 分叉。
   * 修改方式：保留 TaskCard 需要的状态枚举，但由 displayModel.status 映射。
   * 修改目的：运行中与完成后使用同一组展示字段，只改变状态标记。
   */
  if (displayModel.value.status === 'running') return 'running'
  return displayModel.value.status === 'success' ? 'success' : 'error'
})

const preview = computed(() => {
  // 修改原因：运行中 preview 不能再 fallback 完整 prompt，否则 Bug 4 会继续在主卡片泄漏内部任务文本。
  // 修改方式：只使用 displayModel.preview 的用户可读摘要，再交给现有 extractPreviewText 控制长度。
  // 修改目的：长 prompt/context 只进入调试折叠区，主卡片保持紧凑一致。
  return extractPreviewText(displayModel.value.preview, { maxLines: 4, maxChars: 360 })
})

const runId = computed(() => displayModel.value.runId)
</script>

<template>
  <TaskCard
    :title="displayModel.title"
    icon="codicon-hubot"
    :status="cardStatus"
    :subtitle="displayModel.taskSummary"
    :preview="preview"
    :preview-is-markdown="true"
    :meta-chips="displayModel.chips"
    :footer-right="displayModel.footerRight"
  >
    <template #expanded>
      <div class="expanded">
        <div class="block">
          <div class="label">{{ t('components.tools.subagents.task') }}</div>
          <div class="summary-box">{{ displayModel.taskSummary }}</div>
        </div>

        <details v-if="displayModel.promptDebug" class="debug-details">
          <summary>原始任务输入（调试）</summary>
          <CustomScrollbar :max-height="200">
            <pre class="pre">{{ displayModel.promptDebug }}</pre>
          </CustomScrollbar>
        </details>

        <details v-if="displayModel.contextDebug" class="debug-details">
          <summary>{{ t('components.tools.subagents.context') }}（调试）</summary>
          <CustomScrollbar :max-height="200">
            <pre class="pre">{{ displayModel.contextDebug }}</pre>
          </CustomScrollbar>
        </details>

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

.summary-box {
  padding: 8px 10px;
  background: var(--vscode-sideBar-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  font-size: 12px;
  color: var(--vscode-foreground);
  line-height: 1.5;
}

.debug-details {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--vscode-sideBar-background) 78%, transparent);
  overflow: hidden;
}

.debug-details > summary {
  padding: 8px 10px;
  cursor: pointer;
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
  user-select: none;
}

.pre {
  margin: 0;
  padding: 8px 10px;
  background: var(--vscode-sideBar-background);
  border-top: 1px solid var(--vscode-panel-border);
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
