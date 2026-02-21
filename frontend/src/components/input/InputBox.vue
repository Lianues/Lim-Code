<script setup lang="ts">
/**
 * InputBox - 文本输入框
 * 支持文本和上下文徽章穿插的混合输入
 * 使用 contenteditable div 实现
 */

import { ref, watch, nextTick, onMounted, onBeforeUnmount, computed } from 'vue'
import { useI18n } from '../../i18n'
import type { PromptContextItem } from '../../types/promptContext'
import type { EditorNode } from '../../types/editorNode'
import { getPlainText } from '../../types/editorNode'
import { getFileIcon } from '../../utils/fileIcons'
import { extractVscodeDropItems } from '../../utils/vscodeDragDrop'
import { createContextChipElement } from './inputBox/ContextChipFactory'
import { extractNodesFromEditor, renderNodesToDOM } from './inputBox/useEditorNodesDom'
import {
  getCaretTextOffset,
  insertLineBreakAtCaret,
  insertPlainTextWithLineBreaksAtCaret,
  insertTextAtCaret,
  getRangeInEditor,
  replaceTextRangeByOffsets
} from './inputBox/useEditorCaret'
import {
  removeContextBackward,
  removeContextForward,
  removeLineBreakBackward,
  removeLineBreakForward
} from './inputBox/useEditorDeletion'
import { useAtTrigger } from './inputBox/useAtTrigger'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  /** 编辑器节点数组（文本和上下文徽章混合） */
  nodes: EditorNode[]
  disabled?: boolean
  placeholder?: string
  maxLength?: number
  minRows?: number
  maxRows?: number
  /** Enter 键行为：true=Enter 发送（Shift+Enter 换行）；false=Enter 换行 */
  submitOnEnter?: boolean
}>(), {
  submitOnEnter: true
})

const emit = defineEmits<{
  /** 节点数组更新 */
  'update:nodes': [nodes: EditorNode[]]
  /** 删除一个上下文徽章（点击 chip 上的删除按钮） */
  'remove-context': [id: string]
  send: []
  'composition-start': []
  'composition-end': []
  paste: [files: File[]]
  /** contenteditable 内部拖拽文件/URI：交给父层解析为工作区相对路径 */
  'drop-file-items': [items: string[], insertAsTextPath: boolean]
  'trigger-at-picker': [query: string, triggerPosition: number]
  'close-at-picker': []
  'at-query-change': [query: string]
  'at-picker-keydown': [key: string]
  /** 点击徽章：交给父层决定如何打开预览 */
  'open-context': [ctx: PromptContextItem]
}>()

const editorRef = ref<HTMLDivElement>()
const currentRows = ref(props.minRows || 4)

// 调整高度时的检测状态
const cachedLineHeight = ref(0)
const lastScrollHeight = ref(0)

// 拖拽状态
const isDragOver = ref(false)

// 滚动条状态
const thumbHeight = ref(0)
const thumbTop = ref(0)
const showScrollbar = ref(false)
let isDragging = false
let startY = 0
let startScrollTop = 0

// @ 触发状态
const atTrigger = useAtTrigger({
  onOpen: (query, triggerPosition) => emit('trigger-at-picker', query, triggerPosition),
  onClose: () => emit('close-at-picker'),
  onQueryChange: (query) => emit('at-query-change', query),
  onPickerKeydown: (key) => emit('at-picker-keydown', key)
})

// Some contexts may be inserted imperatively (e.g. after async file read).
// During that brief window, the chip exists in DOM but not yet in props.nodes.
const transientContexts = new Map<string, PromptContextItem>()

// 输入状态标记
let isInputting = false

// ========== height + overlay scrollbar ==========

function ensureCaretVisible(editor: HTMLElement, paddingPx: number = 8) {
  // Only adjust scroll when the editor is actively focused; avoid surprising jumps.
  if (document.activeElement !== editor) return

  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return

  const range = selection.getRangeAt(0)
  if (!range.collapsed) return
  if (!editor.contains(range.startContainer)) return

  // If the editor doesn't overflow, nothing to do.
  if (editor.scrollHeight <= editor.clientHeight) return

  let caretRect = range.getBoundingClientRect()
  // Some browsers may return an empty rect for a collapsed range; fall back to client rects.
  if (
    caretRect.width === 0 &&
    caretRect.height === 0 &&
    caretRect.top === 0 &&
    caretRect.left === 0
  ) {
    const rects = range.getClientRects()
    if (rects.length === 0) return
    caretRect = rects[0]
  }

  const editorRect = editor.getBoundingClientRect()
  const visibleTop = editorRect.top + paddingPx
  const visibleBottom = editorRect.bottom - paddingPx

  let nextScrollTop = editor.scrollTop
  if (caretRect.top < visibleTop) {
    nextScrollTop -= (visibleTop - caretRect.top)
  } else if (caretRect.bottom > visibleBottom) {
    nextScrollTop += (caretRect.bottom - visibleBottom)
  } else {
    return
  }

  const maxScrollTop = Math.max(0, editor.scrollHeight - editor.clientHeight)
  nextScrollTop = Math.min(Math.max(0, nextScrollTop), maxScrollTop)

  if (Math.abs(nextScrollTop - editor.scrollTop) >= 1) {
    editor.scrollTop = nextScrollTop
  }
}

function adjustHeight() {
  if (!editorRef.value) return

  const editor = editorRef.value
  const minRows = props.minRows || 4
  const maxRows = props.maxRows || 8

  if (!cachedLineHeight.value) {
    cachedLineHeight.value = parseInt(getComputedStyle(editor).lineHeight) || 20
  }

  const lineHeight = cachedLineHeight.value
  const minHeight = minRows * lineHeight

  const prevScrollTop = editor.scrollTop
  const prevWasAtBottom = editor.scrollTop + editor.clientHeight >= editor.scrollHeight - 2

  if (editor.scrollHeight === lastScrollHeight.value && lastScrollHeight.value !== 0) {
    nextTick(() => {
      updateScrollbar()
      ensureCaretVisible(editor)
    })
    return
  }

  const oldHeight = editor.style.height
  editor.style.height = 'auto'

  const contentHeight = editor.scrollHeight
  const targetHeight = Math.max(contentHeight, minHeight)

  const rows = Math.min(Math.max(Math.ceil(targetHeight / lineHeight), minRows), maxRows)
  const finalHeight = `${rows * lineHeight}px`

  if (oldHeight !== finalHeight) {
    editor.style.height = finalHeight
    currentRows.value = rows
  } else {
    editor.style.height = oldHeight
  }

  lastScrollHeight.value = contentHeight
  // Preserve internal scroll position; without this, changing height can reset scrollTop and make
  // the caret appear to jump upward when the editor is overflowing (maxRows reached).
  const maxScrollTop = Math.max(0, editor.scrollHeight - editor.clientHeight)
  if (prevWasAtBottom) {
    editor.scrollTop = editor.scrollHeight
  } else {
    editor.scrollTop = Math.min(prevScrollTop, maxScrollTop)
  }

  nextTick(() => {
    updateScrollbar()
    ensureCaretVisible(editor)
  })
}

function updateScrollbar() {
  if (!editorRef.value) return

  const editor = editorRef.value
  const scrollHeight = editor.scrollHeight
  const clientHeight = editor.clientHeight
  const scrollTop = editor.scrollTop

  showScrollbar.value = scrollHeight > clientHeight
  if (!showScrollbar.value) return

  const ratio = clientHeight / Math.max(1, scrollHeight)
  thumbHeight.value = Math.max(24, clientHeight * ratio)

  const maxScrollTop = Math.max(1, scrollHeight - clientHeight)
  const maxThumbTop = Math.max(1, clientHeight - thumbHeight.value)
  thumbTop.value = (scrollTop / maxScrollTop) * maxThumbTop
}

function handleScroll() {
  updateScrollbar()
}

function handleThumbMouseDown(e: MouseEvent) {
  if (!editorRef.value) return

  isDragging = true
  startY = e.clientY
  startScrollTop = editorRef.value.scrollTop

  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)

  e.preventDefault()
}

function handleMouseMove(e: MouseEvent) {
  if (!isDragging || !editorRef.value) return

  const editor = editorRef.value
  const deltaY = e.clientY - startY
  const scrollHeight = editor.scrollHeight
  const clientHeight = editor.clientHeight
  const maxScrollTop = scrollHeight - clientHeight
  const maxThumbTop = clientHeight - thumbHeight.value

  const scrollDelta = (deltaY / maxThumbTop) * maxScrollTop
  editor.scrollTop = startScrollTop + scrollDelta
}

function handleMouseUp() {
  isDragging = false
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
}

const thumbStyle = computed(() => ({
  height: `${thumbHeight.value}px`,
  top: `${thumbTop.value}px`
}))

// ========== nodes <-> DOM ==========

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

function handleContextClick(ctx: PromptContextItem) {
  emit('open-context', ctx)
}

function handleContextMouseEnter(ctx: PromptContextItem) {
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

function handleRemoveContext(id: string) {
  if (previewContext.value?.id === id) previewContext.value = null
  if (hoveredContextId.value === id) hoveredContextId.value = null
  if (hoverTimer) {
    clearTimeout(hoverTimer)
    hoverTimer = null
  }

  emit('remove-context', id)
}

function renderNodesToDom() {
  if (!editorRef.value) return

  renderNodesToDOM(editorRef.value, props.nodes, {
    getContextIcon,
    chipHandlers: {
      onRemove: handleRemoveContext,
      onMouseEnter: handleContextMouseEnter,
      onMouseLeave: handleContextMouseLeave,
      onClick: handleContextClick
    }
  })
}

// ========== input / key / IME ==========

function handleInput() {
  const editor = editorRef.value
  if (!editor) return

  isInputting = true

  const newNodes = extractNodesFromEditor(editor, {
    knownNodes: props.nodes,
    transientContexts
  })

  const textContent = getPlainText(newNodes)
  const cursorPos = getCaretTextOffset(editor)

  atTrigger.onTextChanged(textContent, cursorPos)

  emit('update:nodes', newNodes)

  nextTick(() => {
    isInputting = false

    if (newNodes.length === 0) {
      renderNodesToDom()
    }

    adjustHeight()
  })
}

function handleKeydown(e: KeyboardEvent) {
  const editor = editorRef.value
  if (!editor) return

  if (atTrigger.handleKeydown(e)) return

  const onContextRemoved = (removedId: string) => {
    if (previewContext.value?.id === removedId) previewContext.value = null
    if (hoveredContextId.value === removedId) hoveredContextId.value = null
  }

  if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && !e.metaKey) {
    const handled = e.key === 'Backspace'
      ? (removeContextBackward(editor, onContextRemoved) || removeLineBreakBackward(editor))
      : (removeContextForward(editor, onContextRemoved) || removeLineBreakForward(editor))

    if (handled) {
      e.preventDefault()
      handleInput()
      return
    }
  }

  if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault()
    if (insertLineBreakAtCaret(editor)) {
      handleInput()
    }
    return
  }

  if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
    if (props.submitOnEnter) {
      e.preventDefault()
      emit('send')
      return
    }

    e.preventDefault()
    if (insertLineBreakAtCaret(editor)) {
      handleInput()
    }
    return
  }
}

function handleCompositionStart() {
  emit('composition-start')
}

function handleCompositionEnd() {
  emit('composition-end')
}

function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  const editor = editorRef.value

  const files: File[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.kind === 'file') {
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }

  if (files.length > 0) {
    e.preventDefault()
    emit('paste', files)
    return
  }

  const text = e.clipboardData?.getData('text/plain')
  if (text && editor) {
    // Force plain-text paste to avoid bringing rich-text styles (from web pages,
    // docs, etc.) into contenteditable.
    e.preventDefault()
    insertPlainTextWithLineBreaksAtCaret(editor, text)
    handleInput()

    nextTick(() => {
      if (editor) {
        editor.scrollTop = editor.scrollHeight
      }
    })
  }
}

// ========== drag & drop ==========

function handleDragEnter(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  isDragOver.value = true
}

function handleDragLeave(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()

  const rect = editorRef.value?.getBoundingClientRect()
  if (rect) {
    const x = e.clientX
    const y = e.clientY
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      isDragOver.value = false
    }
  }
}

function handleDragOver(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  isDragOver.value = true
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  isDragOver.value = false

  const dt = e.dataTransfer
  if (!dt) return

  const insertAsTextPath = e.ctrlKey && e.shiftKey
  const items = extractVscodeDropItems(dt).map(i => i.uriOrPath)
  if (items.length > 0) {
    emit('drop-file-items', items, insertAsTextPath)
  }
}

// ========== public methods ==========

function focus() {
  editorRef.value?.focus()
}

function closeAtPicker() {
  atTrigger.reset()
}

function insertFilePath(_path: string) {
  replaceAtTriggerWithText('')
}

function replaceAtTriggerWithText(replacement: string = '') {
  if (!editorRef.value) return

  const replaced = atTrigger.replaceAtTrigger(editorRef.value, replacement, {
    getCaretTextOffset,
    replaceTextRangeByOffsets
  })

  if (!replaced) return

  handleInput()
}

function getAtTriggerPosition(): number | null {
  return atTrigger.getAtTriggerPosition()
}

function insertPathsAsAtText(files: { path: string; isDirectory: boolean }[]) {
  if (!files || files.length === 0 || !editorRef.value) return

  const ensureTrailingSlash = (p: string) => (p.endsWith('/') ? p : `${p}/`)
  const text = files
    .map(f => {
      const p = f.isDirectory ? ensureTrailingSlash(f.path) : f.path
      return ` @${p} `
    })
    .join('')

  if (text) {
    insertTextAtCaret(editorRef.value, text)
    handleInput()
  }
}

function insertContextAtCaret(context: PromptContextItem): boolean {
  if (!editorRef.value) return false

  transientContexts.set(context.id, context)

  const range = getRangeInEditor(editorRef.value)
  const selection = window.getSelection()
  if (!range || !selection) return false

  range.deleteContents()

  const chip = createContextChipElement(context, getContextIcon(context).class, {
    onRemove: handleRemoveContext,
    onMouseEnter: handleContextMouseEnter,
    onMouseLeave: handleContextMouseLeave,
    onClick: handleContextClick
  })

  range.insertNode(chip)

  const after = document.createTextNode('\u200B')
  chip.after(after)

  const prev = chip.previousSibling
  if (!prev || prev.nodeType === Node.ELEMENT_NODE) {
    chip.before(document.createTextNode('\u200B'))
  }

  const newRange = document.createRange()
  newRange.setStart(after, 1)
  newRange.collapse(true)
  selection.removeAllRanges()
  selection.addRange(newRange)

  handleInput()
  return true
}

// 输入框占位符：有内容时不显示 placeholder
const placeholderText = computed(() => {
  const hasContent = props.nodes.length > 0 && (
    props.nodes.some(n => n.type === 'context') ||
    props.nodes.some(n => n.type === 'text' && n.text.trim())
  )
  if (hasContent) return ''
  return props.placeholder || t('components.input.placeholderHint')
})

// 悬浮预览状态
const hoveredContextId = ref<string | null>(null)
const previewContext = ref<PromptContextItem | null>(null)
let hoverTimer: ReturnType<typeof setTimeout> | null = null

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

watch(() => props.nodes, () => {
  if (previewContext.value) {
    const stillExists = props.nodes.some(n => n.type === 'context' && n.context.id === previewContext.value!.id)
    if (!stillExists) previewContext.value = null
  }
  if (hoveredContextId.value) {
    const stillHoveredExists = props.nodes.some(n => n.type === 'context' && n.context.id === hoveredContextId.value)
    if (!stillHoveredExists) hoveredContextId.value = null
  }

  for (const id of Array.from(transientContexts.keys())) {
    if (props.nodes.some(n => n.type === 'context' && n.context.id === id)) {
      transientContexts.delete(id)
    }
  }

  if (!isInputting || props.nodes.length === 0) {
    renderNodesToDom()
  }

  nextTick(() => adjustHeight())
}, { deep: true })

onMounted(() => {
  nextTick(() => {
    renderNodesToDom()
    adjustHeight()
  })
})

onBeforeUnmount(() => {
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
})

defineExpose({
  focus,
  closeAtPicker,
  insertFilePath,
  replaceAtTriggerWithText,
  insertContextAtCaret,
  insertPathsAsAtText,
  getAtTriggerPosition
})
</script>

<template>
  <div class="input-box" :class="{ 'drag-over': isDragOver }">
    <!-- 编辑器区域（contenteditable） -->
    <div
      ref="editorRef"
      class="input-editor"
      :class="{ disabled: !!disabled, 'is-empty': props.nodes.length === 0 }"
      contenteditable="true"
      :data-placeholder="placeholderText"
      @input="handleInput"
      @keydown="handleKeydown"
      @scroll="handleScroll"
      @compositionstart="handleCompositionStart"
      @compositionend="handleCompositionEnd"
      @paste="handlePaste"
      @dragenter="handleDragEnter"
      @dragleave="handleDragLeave"
      @dragover="handleDragOver"
      @drop="handleDrop"
    ></div>

    <!-- 悬浮预览弹窗 -->
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

    <!-- 自定义滚动条 -->
    <div v-show="showScrollbar" class="scroll-track">
      <div
        class="scroll-thumb"
        :style="thumbStyle"
        @mousedown="handleThumbMouseDown"
      />
    </div>

    <!-- 字符计数 -->
    <div v-if="maxLength" class="char-count">
      {{ getPlainText(props.nodes).length }} / {{ maxLength }}
    </div>
  </div>
</template>

<style scoped>
.input-box {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
}

/* contenteditable 编辑器 */
.input-editor {
  width: 100%;
  min-height: 80px; /* 至少四行视觉高度 */
  max-height: 160px;
  padding: var(--spacing-sm, 8px);
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  border-radius: var(--radius-sm, 2px);
  font-family: var(--vscode-font-family);
  font-size: 13px;
  line-height: 1.5;
  transition: border-color var(--transition-fast, 0.1s);
  outline: none;
  overflow-y: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
  cursor: text;

  /* 隐藏原生滚动条 */
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.input-editor::-webkit-scrollbar {
  display: none;
}

.input-editor:focus {
  border-color: var(--vscode-focusBorder);
}

.input-editor.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

/* 占位符 */
.input-editor.is-empty::before {
  content: attr(data-placeholder);
  color: var(--vscode-input-placeholderForeground);
  pointer-events: none;
}

/* 拖拽悬停状态 */
.input-box.drag-over .input-editor {
  border-color: var(--vscode-focusBorder);
  background: var(--vscode-list-hoverBackground);
}

/* 内联徽章样式：浅蓝色背景（使用 :deep 以应用到动态创建的元素） */
.input-editor :deep(.context-chip) {
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

.input-editor :deep(.context-chip:hover) {
  background: rgba(0, 122, 204, 0.24);
  border-color: rgba(0, 122, 204, 0.4);
}

.input-editor :deep(.context-chip .codicon),
.input-editor :deep(.context-chip .icon) {
  font-size: 12px;
  color: var(--vscode-textLink-foreground);
  flex-shrink: 0;
}

.input-editor :deep(.context-chip__text) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.input-editor :deep(.context-chip__remove) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: 2px;
  padding: 0;

  border: none;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;

  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}

.input-editor :deep(.context-chip:hover .context-chip__remove),
.input-editor :deep(.context-chip.hovered .context-chip__remove) {
  opacity: 1;
  pointer-events: auto;
}

.input-editor :deep(.context-chip__remove:hover) {
  color: var(--vscode-errorForeground);
}

/* 自定义滚动条 - 悬浮设计，不占用布局 */
.scroll-track {
  position: absolute;
  top: 1px;
  right: 3px;
  width: 6px;
  height: calc(100% - 2px);
  border-radius: 0;
  cursor: pointer;
  background: transparent;
  z-index: 10;
  opacity: 1;
}

.scroll-thumb {
  position: absolute;
  left: 0;
  width: 100%;
  border-radius: 0;
  cursor: grab;
  transition: background 0.18s ease, top 0.06s linear;
  will-change: top;
  background: var(--vscode-scrollbarSlider-background, rgba(100, 100, 100, 0.4));
}

.scroll-thumb:hover {
  background: var(--vscode-scrollbarSlider-hoverBackground, rgba(100, 100, 100, 0.55));
}

.scroll-thumb:active {
  cursor: grabbing;
  background: var(--vscode-scrollbarSlider-activeBackground, rgba(100, 100, 100, 0.7));
}

.char-count {
  position: absolute;
  right: var(--spacing-sm, 8px);
  bottom: var(--spacing-xs, 4px);
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .scroll-track,
  .scroll-thumb {
    transition: none !important;
  }
}

/* 悬浮预览弹窗 */
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
