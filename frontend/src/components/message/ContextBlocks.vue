<script setup lang="ts">
/**
 * ContextBlocks - 上下文块显示组件
 * 用于在用户消息中显示解析出的 context 块为小标签
 */

import { ref } from 'vue'
import type { PromptContextItem } from '../../types/promptContext'
import { sendToExtension } from '../../utils/vscode'
import { useI18n } from '../../i18n'
import { getFileIcon } from '../../utils/fileIcons'
import { languageFromPath } from '../../utils/languageFromPath'

const { t } = useI18n()

const props = defineProps<{
  contexts: PromptContextItem[]
}>()

// 当前悬浮的上下文项 ID
const hoveredId = ref<string | null>(null)
// 悬浮延迟定时器
let hoverTimer: ReturnType<typeof setTimeout> | null = null
// 当前显示预览的上下文项
const previewItem = ref<PromptContextItem | null>(null)

// 获取上下文徽章图标配置
function getTypeIcon(ctx: PromptContextItem): { class: string; isFileIcon: boolean } {
  // 文件类型：根据文件路径获取对应图标
  if (ctx.type === 'file' && ctx.filePath) {
    return { class: getFileIcon(ctx.filePath), isFileIcon: true }
  }
  // 其他类型使用 codicon
  switch (ctx.type) {
    case 'snippet':
      return { class: 'codicon codicon-code', isFileIcon: false }
    case 'text':
    default:
      return { class: 'codicon codicon-note', isFileIcon: false }
  }
}

// 获取类型标签
function getTypeLabel(type: string): string {
  switch (type) {
    case 'file': return t('components.input.promptContext.typeFile')
    case 'text': return t('components.input.promptContext.typeText')
    case 'snippet': return t('components.input.promptContext.typeSnippet')
    default: return type
  }
}

// 处理鼠标进入
function handleMouseEnter(item: PromptContextItem) {
  hoveredId.value = item.id
  
  // 清除之前的定时器
  if (hoverTimer) {
    clearTimeout(hoverTimer)
  }
  
  // 延迟 300ms 显示预览
  hoverTimer = setTimeout(() => {
    previewItem.value = item
  }, 300)
}

// 处理鼠标离开
function handleMouseLeave() {
  hoveredId.value = null
  
  if (hoverTimer) {
    clearTimeout(hoverTimer)
    hoverTimer = null
  }
  
  // 延迟隐藏预览，让用户可以移动到预览框
  setTimeout(() => {
    if (!hoveredId.value) {
      previewItem.value = null
    }
  }, 100)
}

// 处理点击 - 在 VSCode 中打开内容预览
async function handleClick(item: PromptContextItem) {
  try {
    // 使用 VSCode 的虚拟文档显示内容
    await sendToExtension('showContextContent', {
      title: item.title,
      content: item.content,
      language: item.language || languageFromPath(item.filePath)
    })
  } catch (error) {
    console.error('Failed to show context content:', error)
  }
}

// 截断内容用于预览
function truncateContent(content: string, maxLines: number = 10, maxChars: number = 500): string {
  const lines = content.split('\n').slice(0, maxLines)
  let result = lines.join('\n')
  
  if (result.length > maxChars) {
    result = result.slice(0, maxChars) + '...'
  } else if (content.split('\n').length > maxLines) {
    result += '\n...'
  }
  
  return result
}
</script>

<template>
  <div class="context-blocks">
    <div
      v-for="item in contexts"
      :key="item.id"
      class="context-tag"
      :class="{ 'hovered': hoveredId === item.id }"
      @mouseenter="handleMouseEnter(item)"
      @mouseleave="handleMouseLeave"
      @click="handleClick(item)"
    >
      <i :class="getTypeIcon(item).class"></i>
      <span class="context-title">{{ item.title }}</span>
      <span class="context-type">{{ getTypeLabel(item.type) }}</span>
    </div>
    
    <!-- 预览弹窗 -->
    <Transition name="fade">
      <div
        v-if="previewItem"
        class="context-preview"
        @mouseenter="hoveredId = previewItem.id"
        @mouseleave="handleMouseLeave"
      >
        <div class="preview-header">
          <i :class="getTypeIcon(previewItem).class"></i>
          <span class="preview-title">{{ previewItem.title }}</span>
          <span class="preview-hint">{{ t('components.message.contextBlocks.clickToView') }}</span>
        </div>
        <pre class="preview-content">{{ truncateContent(previewItem.content) }}</pre>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.context-blocks {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
  position: relative;
}

/* 内联徽章样式：浅蓝色背景 */
.context-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: rgba(0, 122, 204, 0.16);
  border: 1px solid rgba(0, 122, 204, 0.28);
  color: var(--vscode-foreground);
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
  max-width: 200px;
  user-select: none;
}

.context-tag:hover,
.context-tag.hovered {
  background: rgba(0, 122, 204, 0.28);
  border-color: rgba(0, 122, 204, 0.45);
}

.context-tag .codicon {
  font-size: 12px;
  color: var(--vscode-textLink-foreground);
  flex-shrink: 0;
}

.context-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.context-type {
  font-size: 9px;
  opacity: 0.7;
  padding: 1px 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  flex-shrink: 0;
}

/* 预览弹窗 */
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
  max-height: 300px;
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

.preview-hint {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
}

.preview-content {
  margin: 0;
  padding: 12px;
  font-size: 11px;
  font-family: var(--vscode-editor-font-family);
  line-height: 1.5;
  overflow-y: auto;
  max-height: 220px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--vscode-foreground);
  background: var(--vscode-textBlockQuote-background);
}

/* 淡入淡出动画 */
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
