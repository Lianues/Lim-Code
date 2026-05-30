<script setup lang="ts">
/**
 * MessageRenderBlock 是渲染块纯展示子组件。
 * memo 边界由父组件 MessageItem.vue 放在 v-for 同一组件元素上；本组件内部不声明 memo，也不引入 display:contents 或额外 wrapper。
 */

import type { RenderBlock } from './renderBlocks'
import { hasContextBlocks } from '../../types/contextParser'
import { useI18n } from '../../i18n'
import ToolMessage from './ToolMessage.vue'
import InlineContextMessage from './InlineContextMessage.vue'
import { MarkdownRenderer } from '../common'

const { t } = useI18n()

defineProps<{
  block: RenderBlock
  /** 消息角色，决定 Markdown 是否仅渲染 LaTeX */
  messageRole: 'user' | 'assistant' | 'tool'
  /** 消息是否仍在流式输出 */
  isStreaming: boolean
  /** 思考块是否已展开（由父组件统一管理） */
  isThoughtExpanded: boolean
  /** 是否正在思考中（决定灯泡动画） */
  isThinking: boolean
  /** 思考时间显示文本 */
  thinkingTimeDisplay: string | null
  /** 后端消息索引，透传给 ToolMessage 保持 diff/action 语义 */
  messageBackendIndex?: number
  /** 思考块展开/收起切换，由父组件提供以避免本展示组件新增 emits */
  toggleThought: () => void
}>()
</script>

<template>
  <!-- 每个分支沿用原真实根，不用额外 wrapper 或 display:contents。 -->

  <!-- 思考块 -->
  <div v-if="block.type === 'thought'" class="thought-block">
    <div class="thought-header" @click="toggleThought">
      <i
        class="codicon"
        :class="isThoughtExpanded ? 'codicon-chevron-down' : 'codicon-chevron-right'"
      ></i>
      <i
        class="codicon codicon-lightbulb thought-icon"
        :class="{ 'thinking-pulse': isThinking }"
      ></i>
      <span class="thought-label">
        {{ isThinking ? t('components.message.thought.thinking') : t('components.message.thought.thoughtProcess') }}
      </span>
      <span
        v-if="thinkingTimeDisplay"
        class="thought-time"
        :class="{ 'thinking-active': isThinking }"
      >
        {{ thinkingTimeDisplay }}
      </span>
      <span v-if="!isThoughtExpanded" class="thought-preview">
        {{ (block.text || '').slice(0, 50) }}{{ (block.text || '').length > 50 ? '...' : '' }}
      </span>
    </div>
    <div v-if="isThoughtExpanded" class="thought-content">
      <MarkdownRenderer
        :content="block.text || ''"
        :latex-only="false"
        class="thought-text"
      />
    </div>
  </div>

  <!-- 文本块（用户消息带 context 块） -->
  <InlineContextMessage
    v-else-if="block.type === 'text' && messageRole === 'user' && hasContextBlocks(block.text || '')"
    :content="block.text || ''"
  />

  <!-- 文本块（Markdown 渲染） -->
  <MarkdownRenderer
    v-else-if="block.type === 'text'"
    :content="block.text || ''"
    :latex-only="messageRole === 'user'"
    :is-streaming="isStreaming"
    class="content-text"
  />

  <!-- 工具调用块 -->
  <ToolMessage
    v-else-if="block.type === 'tool'"
    class="tool-message-block"
    :tools="block.tools!"
    :message-backend-index="messageBackendIndex"
  />
</template>

<style scoped>
/* 思考块样式需与原 MessageItem 中的对应结构保持一致。 */
.thought-block {
  --lim-md-font-size: 12px;
  --lim-md-line-height: 1.5;
  --lim-md-color: var(--vscode-descriptionForeground);
  --lim-md-font-style: italic;

  margin: 8px 0;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  background: var(--vscode-textBlockQuote-background);
  overflow: hidden;
}

.thought-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s;
}

.thought-header:hover {
  background: var(--vscode-list-hoverBackground);
}

.thought-header .codicon {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.thought-icon {
  color: var(--vscode-descriptionForeground) !important;
}

.thought-icon.thinking-pulse {
  color: var(--vscode-charts-yellow, #ddb92f) !important;
  animation: lightbulb-pulse 1.2s ease-in-out infinite;
}

@keyframes lightbulb-pulse {
  0%, 100% {
    opacity: 0.4;
    text-shadow: none;
  }
  50% {
    opacity: 1;
    text-shadow: 0 0 8px var(--vscode-charts-yellow, #ddb92f);
  }
}

.thought-label {
  font-size: 12px;
  font-weight: 500;
  font-style: italic;
  color: var(--vscode-descriptionForeground);
}

.thought-time {
  font-size: 11px;
  font-weight: 500;
  color: var(--vscode-descriptionForeground);
  background: var(--vscode-badge-background);
  padding: 1px 6px;
  border-radius: 10px;
  margin-left: 4px;
  transition: all 0.2s ease;
}

.thought-time.thinking-active {
  color: var(--vscode-charts-yellow, #ddb92f);
  animation: time-pulse 1.5s ease-in-out infinite;
}

@keyframes time-pulse {
  0%, 100% { opacity: 0.8; }
  50% { opacity: 1; }
}

.thought-preview {
  flex: 1;
  font-size: 11px;
  font-style: italic;
  color: var(--vscode-descriptionForeground);
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thought-content {
  padding: 12px;
  border-top: none;
}

.thought-block :deep(.thought-text p) {
  margin: 0.5em 0;
}

.thought-block :deep(.thought-text p:first-child) {
  margin-top: 0;
}

.thought-block :deep(.thought-text p:last-child) {
  margin-bottom: 0;
}

/* 正文与工具调用块的垂直间距 */
.tool-message-block {
  margin: 8px 0;
}
</style>
