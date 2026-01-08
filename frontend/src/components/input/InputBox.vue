<script setup lang="ts">
/**
 * InputBox - 文本输入框
 * 扁平化设计，支持多行输入、自动高度、快捷键
 * 自定义悬浮滚动条
 */

import { ref, watch, nextTick, onMounted, onBeforeUnmount, computed } from 'vue'
import { sendToExtension } from '../../utils/vscode'
import { useI18n } from '../../i18n'

const { t } = useI18n()

const props = defineProps<{
  value: string
  disabled?: boolean
  placeholder?: string
  maxLength?: number
  minRows?: number
  maxRows?: number
}>()

const emit = defineEmits<{
  'update:value': [value: string]
  send: []
  'composition-start': []
  'composition-end': []
  paste: [files: File[]]
  'file-path-drop': [paths: string[]]
  'trigger-at-picker': [query: string, triggerPosition: number]
  'close-at-picker': []
  'at-query-change': [query: string]
  'at-picker-keydown': [key: string]  // 专门用于文件选择器的键盘事件
}>()

const textareaRef = ref<HTMLTextAreaElement>()
const currentRows = ref(props.minRows || 2)

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

// 调整高度
function adjustHeight() {
  if (!textareaRef.value) return
  
  const textarea = textareaRef.value
  const minRows = props.minRows || 2  // 默认最少两行
  const maxRows = props.maxRows || 6
  
  // 获取并缓存行高，避免频繁读取 DOM
  if (!cachedLineHeight.value) {
    cachedLineHeight.value = parseInt(getComputedStyle(textarea).lineHeight) || 20
  }
  
  const lineHeight = cachedLineHeight.value
  const minHeight = minRows * lineHeight
  
  // 核心优化：增加高度变化检测
  // 在固定高度模式下，scrollHeight 代表内容真实高度（即使被 height 限制）
  // 如果它没变，说明行数没变，不需要重设 height='auto'（这会强制重排）
  if (textarea.scrollHeight === lastScrollHeight.value && lastScrollHeight.value !== 0) {
    return
  }

  // 重置高度以获取正确的 scrollHeight
  const oldHeight = textarea.style.height
  textarea.style.height = 'auto'
  
  // 获取实际内容高度
  const contentHeight = textarea.scrollHeight
  
  // 计算目标高度，确保不低于最小高度
  const targetHeight = Math.max(contentHeight, minHeight)
  
  // 计算实际行数
  const rows = Math.min(
    Math.max(
      Math.ceil(targetHeight / lineHeight),
      minRows
    ),
    maxRows
  )
  
  const finalHeight = `${rows * lineHeight}px`
  
  // 只有当高度真正改变时才更新 DOM
  if (oldHeight !== finalHeight) {
    textarea.style.height = finalHeight
    currentRows.value = rows
  } else {
    // 如果没变，恢复原状
    textarea.style.height = oldHeight
  }
  
  // 记录本次的内容高度，用于下次对比
  lastScrollHeight.value = contentHeight
  
  // 更新滚动条
  nextTick(() => updateScrollbar())
}

// 更新滚动条状态
function updateScrollbar() {
  if (!textareaRef.value) return
  
  const textarea = textareaRef.value
  const scrollHeight = textarea.scrollHeight
  const clientHeight = textarea.clientHeight
  const scrollTop = textarea.scrollTop
  
  // 判断是否需要显示滚动条
  showScrollbar.value = scrollHeight > clientHeight
  
  if (!showScrollbar.value) return
  
  // 计算滑块高度（最小24px）
  const ratio = clientHeight / Math.max(1, scrollHeight)
  thumbHeight.value = Math.max(24, clientHeight * ratio)
  
  // 计算滑块位置
  const maxScrollTop = Math.max(1, scrollHeight - clientHeight)
  const maxThumbTop = Math.max(1, clientHeight - thumbHeight.value)
  thumbTop.value = (scrollTop / maxScrollTop) * maxThumbTop
}

// 滚动事件处理
function handleScroll() {
  updateScrollbar()
}

// 鼠标按下滑块
function handleThumbMouseDown(e: MouseEvent) {
  if (!textareaRef.value) return
  
  isDragging = true
  startY = e.clientY
  startScrollTop = textareaRef.value.scrollTop
  
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
  
  e.preventDefault()
}

// 鼠标移动
function handleMouseMove(e: MouseEvent) {
  if (!isDragging || !textareaRef.value) return
  
  const textarea = textareaRef.value
  const deltaY = e.clientY - startY
  const scrollHeight = textarea.scrollHeight
  const clientHeight = textarea.clientHeight
  const maxScrollTop = scrollHeight - clientHeight
  const maxThumbTop = clientHeight - thumbHeight.value
  
  // 计算新的滚动位置
  const scrollDelta = (deltaY / maxThumbTop) * maxScrollTop
  textarea.scrollTop = startScrollTop + scrollDelta
}

// 鼠标释放
function handleMouseUp() {
  isDragging = false
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
}

// 监听值变化
watch(() => props.value, () => {
  nextTick(() => adjustHeight())
})

// @ 触发状态
const atTriggerPosition = ref<number | null>(null)

// 处理输入
function handleInput(e: Event) {
  const target = e.target as HTMLTextAreaElement
  const value = target.value
  const cursorPos = target.selectionStart
  
  // 检测 @ 触发
  if (atTriggerPosition.value !== null) {
    // 已经在 @ 模式中，更新查询
    const query = value.substring(atTriggerPosition.value + 1, cursorPos)
    
    // 检查是否应该关闭（遇到空格或删除了 @）
    if (cursorPos <= atTriggerPosition.value || query.includes(' ') || query.includes('\n')) {
      atTriggerPosition.value = null
      emit('close-at-picker')
    } else {
      emit('at-query-change', query)
    }
  } else {
    // 检测是否刚输入了 @
    const charBefore = value[cursorPos - 2] || ''
    const currentChar = value[cursorPos - 1]
    
    if (currentChar === '@' && (charBefore === '' || charBefore === ' ' || charBefore === '\n')) {
      atTriggerPosition.value = cursorPos - 1
      emit('trigger-at-picker', '', cursorPos - 1)
    }
  }
  
  emit('update:value', value)
}

// 处理按键
function handleKeydown(e: KeyboardEvent) {
  // 如果在 @ 模式中，某些按键需要传递给父组件处理
  if (atTriggerPosition.value !== null) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      // 导航按键传递给父组件
      e.preventDefault()
      emit('at-picker-keydown', e.key)
      return
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      // Tab 或 Enter 选择当前文件
      e.preventDefault()
      emit('at-picker-keydown', 'Enter')
      return
    }
    if (e.key === 'Escape') {
      // 关闭面板
      e.preventDefault()
      atTriggerPosition.value = null
      emit('close-at-picker')
      return
    }
  }
  
  // Enter 发送（Shift+Enter 换行）
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault()
    emit('send')
  }
  
  // Ctrl+Enter 也可以发送
  if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault()
    emit('send')
  }
}

// 处理输入法
function handleCompositionStart() {
  emit('composition-start')
}

function handleCompositionEnd() {
  emit('composition-end')
}

// 处理粘贴事件
function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  
  const files: File[] = []
  
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    // 处理文件类型（图片、文件等）
    if (item.kind === 'file') {
      const file = item.getAsFile()
      if (file) {
        files.push(file)
      }
    }
  }
  
  // 如果有文件，触发 paste 事件
  if (files.length > 0) {
    e.preventDefault()  // 阻止默认粘贴行为
    emit('paste', files)
  }
  // 如果是纯文本，让浏览器默认处理
}

// 处理拖拽进入
function handleDragEnter(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  isDragOver.value = true
}

// 处理拖拽离开
function handleDragLeave(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  // 检查是否真的离开了元素
  const rect = textareaRef.value?.getBoundingClientRect()
  if (rect) {
    const x = e.clientX
    const y = e.clientY
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      isDragOver.value = false
    }
  }
}

// 处理拖拽悬停
function handleDragOver(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  // 设置 dropEffect 告诉浏览器这是一个复制操作
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'copy'
  }
  isDragOver.value = true
}

// 处理拖拽放置
async function handleDrop(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  isDragOver.value = false
  
  // 检查是否有文件或 URI 列表
  const dt = e.dataTransfer
  if (!dt) return
  
  // VSCode 使用自定义的数据类型
  // 1. application/vnd.code.uri-list - VSCode 的 URI 列表
  // 2. resourceurls - JSON 数组格式的文件 URI
  // 3. text/uri-list - 标准 URI 列表（可能为空）
  
  // 优先使用 VSCode 的 application/vnd.code.uri-list
  const vscodeUriList = dt.getData('application/vnd.code.uri-list')
  
  if (vscodeUriList) {
    const uris = vscodeUriList.split('\n').filter(uri => uri.trim() && !uri.startsWith('#'))
    if (uris.length > 0) {
      await insertFilePathsFromUris(uris)
      return
    }
  }
  
  // 尝试 resourceurls（JSON 数组格式）
  const resourceUrls = dt.getData('resourceurls')
  
  if (resourceUrls) {
    try {
      const urls = JSON.parse(resourceUrls) as string[]
      if (urls.length > 0) {
        await insertFilePathsFromUris(urls)
        return
      }
    } catch {
      // 忽略解析错误
    }
  }
  
  // 尝试标准的 text/uri-list
  const uriList = dt.getData('text/uri-list')
  
  if (uriList) {
    const uris = uriList.split('\n').filter(uri => uri.trim() && !uri.startsWith('#'))
    if (uris.length > 0) {
      await insertFilePathsFromUris(uris)
      return
    }
  }
  
  // 尝试 text/plain
  const plainText = dt.getData('text/plain')
  
  if (plainText) {
    const lines = plainText.split('\n').filter(line => line.trim())
    const fileUris = lines.filter(line =>
      line.startsWith('file://') ||
      line.match(/^[a-zA-Z]:[\/\\]/) ||
      line.startsWith('/')
    )
    
    if (fileUris.length > 0) {
      await insertFilePathsFromUris(fileUris)
      return
    }
  }
  
  // 如果没有 URI 列表，尝试从 Files 获取
  if (dt.files && dt.files.length > 0) {
    const paths: string[] = []
    for (let i = 0; i < dt.files.length; i++) {
      const file = dt.files[i]
      const filePath = (file as any).path || file.name
      if (filePath) {
        paths.push(filePath)
      }
    }
    
    if (paths.length > 0) {
      await insertFilePathsFromPaths(paths)
    }
  }
}

// 从 URI 列表插入文件路径
async function insertFilePathsFromUris(uris: string[]) {
  const relativePaths: string[] = []
  
  for (const uri of uris) {
    try {
      // 调用后端 API 将 URI 转换为相对路径
      const result = await sendToExtension<{ relativePath: string; isDirectory?: boolean }>('getRelativePath', {
        absolutePath: uri.trim()
      })
      if (result.relativePath) {
        // 文件夹末尾添加 /
        const path = result.isDirectory ? `${result.relativePath}/` : result.relativePath
        relativePaths.push(path)
      }
    } catch (err) {
      console.error('获取相对路径失败:', err)
      // 如果获取失败，尝试直接使用 URI 中的文件名
      try {
        const url = new URL(uri)
        const pathName = decodeURIComponent(url.pathname)
        const fileName = pathName.split('/').pop()
        if (fileName) {
          relativePaths.push(fileName)
        }
      } catch {
        // 忽略无效 URI
      }
    }
  }
  
  if (relativePaths.length > 0) {
    insertPathsToTextarea(relativePaths)
    emit('file-path-drop', relativePaths)
  }
}

// 从本地路径插入文件路径
async function insertFilePathsFromPaths(paths: string[]) {
  const relativePaths: string[] = []
  
  for (const absolutePath of paths) {
    try {
      // 调用后端 API 将绝对路径转换为相对路径
      const result = await sendToExtension<{ relativePath: string; isDirectory?: boolean }>('getRelativePath', {
        absolutePath
      })
      if (result.relativePath) {
        // 文件夹末尾添加 /
        const path = result.isDirectory ? `${result.relativePath}/` : result.relativePath
        relativePaths.push(path)
      }
    } catch (err) {
      console.error('获取相对路径失败:', err)
      // 如果获取失败，使用文件名
      const fileName = absolutePath.split(/[/\\]/).pop()
      if (fileName) {
        relativePaths.push(fileName)
      }
    }
  }
  
  if (relativePaths.length > 0) {
    insertPathsToTextarea(relativePaths)
    emit('file-path-drop', relativePaths)
  }
}

// 在光标位置插入文件路径
function insertPathsToTextarea(paths: string[]) {
  if (!textareaRef.value) return
  
  const textarea = textareaRef.value
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const text = props.value
  
  // 格式化路径为 @path 格式，前后都加空格方便继续输入
  const pathText = paths.map(p => `@${p}`).join(' ')
  
  // 在光标位置插入路径
  const beforeCursor = text.substring(0, start)
  const afterCursor = text.substring(end)
  
  // 前后都加空格，方便用户编辑
  const insertText = ' ' + pathText + ' '
  
  const newValue = beforeCursor + insertText + afterCursor
  emit('update:value', newValue)
  
  // 设置光标位置到插入内容之后（包括末尾的空格）
  nextTick(() => {
    if (textareaRef.value) {
      const newCursorPos = start + insertText.length
      textareaRef.value.setSelectionRange(newCursorPos, newCursorPos)
      textareaRef.value.focus()
    }
  })
}

// 聚焦
function focus() {
  textareaRef.value?.focus()
}

// 滑块样式
const thumbStyle = computed(() => ({
  height: `${thumbHeight.value}px`,
  top: `${thumbTop.value}px`
}))

// 挂载
onMounted(() => {
  nextTick(() => {
    adjustHeight()
  })
})

// 卸载
onBeforeUnmount(() => {
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
})

// 关闭 @ 面板
function closeAtPicker() {
  atTriggerPosition.value = null
}

// 插入选中的文件路径（替换 @ 和查询文本）
function insertFilePath(path: string) {
  if (!textareaRef.value || atTriggerPosition.value === null) return
  
  const textarea = textareaRef.value
  const value = props.value
  const triggerPos = atTriggerPosition.value
  const cursorPos = textarea.selectionStart
  
  // 构建新值：@ 之前的内容 + @path + 空格 + 原光标之后的内容
  const beforeAt = value.substring(0, triggerPos)
  const afterCursor = value.substring(cursorPos)
  const insertText = `@${path} `
  
  const newValue = beforeAt + insertText + afterCursor
  emit('update:value', newValue)
  
  // 关闭面板
  atTriggerPosition.value = null
  emit('close-at-picker')
  
  // 设置光标位置到插入内容之后
  nextTick(() => {
    if (textareaRef.value) {
      const newCursorPos = triggerPos + insertText.length
      textareaRef.value.setSelectionRange(newCursorPos, newCursorPos)
      textareaRef.value.focus()
    }
  })
}

// 获取当前触发位置
function getAtTriggerPosition(): number | null {
  return atTriggerPosition.value
}

// 暴露方法
defineExpose({
  focus,
  closeAtPicker,
  insertFilePath,
  getAtTriggerPosition
})
</script>

<template>
  <div class="input-box" :class="{ 'drag-over': isDragOver }">
    <textarea
      ref="textareaRef"
      :value="value"
      :disabled="disabled"
      :placeholder="placeholder || t('components.input.placeholderHint')"
      :maxlength="maxLength"
      class="input-textarea"
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
    />
    
    <!-- 自定义滚动条 -->
    <div
      v-show="showScrollbar"
      class="scroll-track"
    >
      <div
        class="scroll-thumb"
        :style="thumbStyle"
        @mousedown="handleThumbMouseDown"
      />
    </div>
    
    <!-- 字符计数 -->
    <div v-if="maxLength" class="char-count">
      {{ value.length }} / {{ maxLength }}
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

.input-textarea {
  width: 100%;
  min-height: 56px;  /* 确保至少两行高度 */
  max-height: 160px;
  padding: var(--spacing-sm, 8px);
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  border-radius: var(--radius-sm, 2px);
  font-family: var(--vscode-font-family);
  font-size: 13px;
  line-height: 1.5;
  resize: none;
  outline: none;
  transition: border-color var(--transition-fast, 0.1s);
  overflow-y: auto;
  /* 隐藏原生滚动条 */
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.input-textarea::-webkit-scrollbar {
  display: none;
}

.input-textarea:focus {
  border-color: var(--vscode-focusBorder);
}

.input-textarea:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 拖拽悬停状态 */
.input-box.drag-over .input-textarea {
  border-color: var(--vscode-focusBorder);
  background: var(--vscode-list-hoverBackground);
}

.input-textarea::placeholder {
  color: var(--vscode-input-placeholderForeground);
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
</style>