<script setup lang="ts">
import { computed, ref } from 'vue'
import MarkdownRenderer from '../common/MarkdownRenderer.vue'
import type { EditorNode } from '../../types/editorNode'
import type { PromptContextItem } from '../../types/promptContext'
import { parseMessageToNodes } from '../../types/contextParser'
import { getFileIcon } from '../../utils/fileIcons'
import { sendToExtension } from '../../utils/vscode'
import { languageFromPath } from '../../utils/languageFromPath'

const props = defineProps<{
  content: string
}>()

const parsed = computed(() => parseMessageToNodes(props.content || ''))
const nodes = computed<EditorNode[]>(() => parsed.value.nodes)

// Hover preview state (kept minimal and layout-independent)
const hoveredContextId = ref<string | null>(null)
const previewContext = ref<PromptContextItem | null>(null)
let hoverTimer: ReturnType<typeof setTimeout> | null = null

function getContextIcon(ctx: PromptContextItem): { class: string; isFileIcon: boolean } {
  if (ctx.type === 'file' && ctx.filePath) {
    return { class: getFileIcon(ctx.filePath), isFileIcon: true }
  }
  switch (ctx.type) {
    case 'snippet':
      return { class: 'codicon codicon-code', isFileIcon: false }
    case 'text':
    default:
      return { class: 'codicon codicon-note', isFileIcon: false }
  }
}

function handleContextMouseEnter(ctx: PromptContextItem) {
  if (ctx.isTextContent === false) {
    hoveredContextId.value = null
    previewContext.value = null
    if (hoverTimer) {
      clearTimeout(hoverTimer)
      hoverTimer = null
    }
    return
  }
  hoveredContextId.value = ctx.id
  if (hoverTimer) clearTimeout(hoverTimer)
  hoverTimer = setTimeout(() => {
    previewContext.value = ctx
  }, 300)
}

function handleContextMouseLeave() {
  hoveredContextId.value = null
  if (hoverTimer) {
    clearTimeout(hoverTimer)
    hoverTimer = null
  }
  setTimeout(() => {
    if (!hoveredContextId.value) {
      previewContext.value = null
    }
  }, 100)
}

function truncatePreview(content: string, maxLines = 10, maxChars = 500): string {
  const lines = content.split('\n').slice(0, maxLines)
  let result = lines.join('\n')
  if (result.length > maxChars) {
    result = result.slice(0, maxChars) + '...'
  } else if (content.split('\n').length > maxLines) {
    result += '\n...'
  }
  return result
}

// Click chip: open in VSCode virtual doc
async function handleContextClick(ctx: PromptContextItem) {
  if (ctx.isTextContent === false && ctx.filePath) {
    try {
      await sendToExtension('openWorkspaceFile', { path: ctx.filePath })
    } catch (error) {
      console.error('Failed to open workspace file:', error)
    }
    return
  }

  try {
    await sendToExtension('showContextContent', {
      title: ctx.title,
      content: ctx.content,
      language: ctx.language || languageFromPath(ctx.filePath)
    })
  } catch (error) {
    console.error('Failed to show context content:', error)
  }
}
</script>

<template>
  <div class="inline-context-message">
    <template v-for="(node, idx) in nodes" :key="idx">
      <MarkdownRenderer
        v-if="node.type === 'text'"
        class="inline-text"
        :content="node.text"
        :latex-only="true"
      />

      <span
        v-else
        class="context-chip"
        :class="{ hovered: hoveredContextId === node.context.id }"
        @click.stop="handleContextClick(node.context)"
        @mouseenter="handleContextMouseEnter(node.context)"
        @mouseleave="handleContextMouseLeave"
      >
        <i :class="getContextIcon(node.context).class"></i>
        <span class="context-chip__text">{{ node.context.title }}</span>
      </span>
    </template>

    <!-- Hover preview (floating, does not occupy layout) -->
    <Transition name="fade">
      <div
        v-if="previewContext"
        class="context-preview"
        @mouseenter="hoveredContextId = previewContext.id"
        @mouseleave="handleContextMouseLeave"
      >
        <div class="preview-header">
          <i :class="getContextIcon(previewContext).class"></i>
          <span class="preview-title">{{ previewContext.title }}</span>
        </div>
        <pre class="preview-content">{{ truncatePreview(previewContext.content) }}</pre>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.inline-context-message {
  position: relative;
}

/* Make MarkdownRenderer behave like inline text when we stitch segments around chips */
.inline-context-message :deep(.markdown-content) {
  display: inline;
}

.inline-text {
  display: inline;
}

.context-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 240px;
  vertical-align: middle;

  padding: 2px 8px;
  margin: 0 2px;
  border-radius: 4px;

  background: rgba(0, 122, 204, 0.16);
  border: 1px solid rgba(0, 122, 204, 0.28);
  color: var(--vscode-foreground);

  user-select: none;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.context-chip:hover,
.context-chip.hovered {
  background: rgba(0, 122, 204, 0.24);
  border-color: rgba(0, 122, 204, 0.4);
}

.context-chip .codicon,
.context-chip .icon {
  font-size: 12px;
  color: var(--vscode-textLink-foreground);
  flex-shrink: 0;
}

.context-chip__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

/* Floating preview */
.context-preview {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  margin-bottom: 8px;
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-editorWidget-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  z-index: 100;
  max-height: 240px;
  overflow: hidden;
}

.preview-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-background);
}

.preview-header .codicon {
  font-size: 14px;
  color: var(--vscode-textLink-foreground);
}

.preview-title {
  flex: 1;
  font-weight: 500;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-content {
  margin: 0;
  padding: 10px 12px;
  font-size: 11px;
  font-family: var(--vscode-editor-font-family);
  line-height: 1.5;
  overflow-y: auto;
  max-height: 180px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--vscode-foreground);
  background: var(--vscode-textBlockQuote-background);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
