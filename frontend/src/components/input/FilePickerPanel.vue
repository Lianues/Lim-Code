<script setup lang="ts">
/**
 * FilePickerPanel - @ 文件选择面板
 * 输入 @ 时显示，支持搜索和键盘导航选择工作区文件
 */

import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import { sendToExtension } from '../../utils/vscode'
import { useI18n } from '../../i18n'
import CustomScrollbar from '../common/CustomScrollbar.vue'

const { t } = useI18n()

interface FileItem {
  path: string
  name: string
  isDirectory: boolean
  isOpen?: boolean
}

const props = defineProps<{
  visible: boolean
  query: string
}>()

const emit = defineEmits<{
  'select': [path: string]
  'close': []
  'update:query': [query: string]
  'navigate': [direction: 'up' | 'down']
}>()

const files = ref<FileItem[]>([])
const selectedIndex = ref(0)
const isLoading = ref(false)
const scrollbarRef = ref<InstanceType<typeof CustomScrollbar>>()
const activeFilePath = ref<string | null>(null)

// 防抖定时器
let debounceTimer: ReturnType<typeof setTimeout> | null = null

// 搜索文件
async function searchFiles(query: string, scrollToActive = false) {
  isLoading.value = true
  try {
    const result = await sendToExtension<{ files: FileItem[]; activeFilePath: string | null }>('searchWorkspaceFiles', {
      query: query.trim(),
      limit: 50
    })
    files.value = result?.files || []
    activeFilePath.value = result?.activeFilePath || null
    
    // 如果需要滚动到活跃文件
    if (scrollToActive && activeFilePath.value && !query.trim()) {
      // 查找活跃文件在列表中的索引
      const activeIndex = files.value.findIndex(f => f.path === activeFilePath.value)
      if (activeIndex >= 0) {
        selectedIndex.value = activeIndex
        // 等待渲染完成后滚动
        nextTick(() => scrollToSelected())
      } else {
        // 活跃文件不在列表中（可能不在工作区），选中第一个
        selectedIndex.value = 0
      }
    } else {
      selectedIndex.value = 0
    }
  } catch (error) {
    console.error('搜索文件失败:', error)
    files.value = []
  } finally {
    isLoading.value = false
  }
}

// 防抖搜索
function debouncedSearch(query: string) {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
  debounceTimer = setTimeout(() => {
    searchFiles(query)
  }, 150)
}

// 选择文件
function selectFile(file: FileItem) {
  // 文件夹末尾添加 /
  const path = file.isDirectory ? `${file.path}/` : file.path
  emit('select', path)
}

// 选择当前高亮的文件
function selectCurrent() {
  if (files.value[selectedIndex.value]) {
    selectFile(files.value[selectedIndex.value])
  }
}

// 获取文件图标
function getFileIcon(file: FileItem): string {
  if (file.isDirectory) {
    return 'codicon-folder'
  }
  
  // 根据扩展名返回不同图标
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  
  const iconMap: Record<string, string> = {
    // 代码文件
    'ts': 'codicon-file-code',
    'tsx': 'codicon-file-code',
    'js': 'codicon-file-code',
    'jsx': 'codicon-file-code',
    'vue': 'codicon-file-code',
    'py': 'codicon-file-code',
    'go': 'codicon-file-code',
    'rs': 'codicon-file-code',
    'java': 'codicon-file-code',
    'c': 'codicon-file-code',
    'cpp': 'codicon-file-code',
    'h': 'codicon-file-code',
    'hpp': 'codicon-file-code',
    'cs': 'codicon-file-code',
    'rb': 'codicon-file-code',
    'php': 'codicon-file-code',
    'swift': 'codicon-file-code',
    'kt': 'codicon-file-code',
    // 配置文件
    'json': 'codicon-json',
    'yaml': 'codicon-file-code',
    'yml': 'codicon-file-code',
    'toml': 'codicon-file-code',
    'xml': 'codicon-file-code',
    // 样式文件
    'css': 'codicon-file-code',
    'scss': 'codicon-file-code',
    'less': 'codicon-file-code',
    'sass': 'codicon-file-code',
    // 文档
    'md': 'codicon-markdown',
    'markdown': 'codicon-markdown',
    'txt': 'codicon-file-text',
    // 图片
    'png': 'codicon-file-media',
    'jpg': 'codicon-file-media',
    'jpeg': 'codicon-file-media',
    'gif': 'codicon-file-media',
    'svg': 'codicon-file-media',
    'webp': 'codicon-file-media',
  }
  
  return iconMap[ext] || 'codicon-file'
}

// 高亮匹配文本
function highlightMatch(text: string, query: string): string {
  if (!query.trim()) return text
  
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  return text.replace(regex, '<mark>$1</mark>')
}

// 计算高亮显示的路径
const highlightedPaths = computed(() => {
  return files.value.map(file => {
    // 文件夹末尾添加 /
    const displayPath = file.isDirectory ? `${file.path}/` : file.path
    return {
      ...file,
      displayPath,
      highlightedPath: highlightMatch(displayPath, props.query)
    }
  })
})

// 键盘事件处理
function handleKeydown(e: KeyboardEvent | { key: string, preventDefault?: Function, stopPropagation?: Function }) {
  if (!props.visible) return
  
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault?.()
      e.stopPropagation?.()
      selectedIndex.value = Math.min(selectedIndex.value + 1, files.value.length - 1)
      scrollToSelected()
      break
    case 'ArrowUp':
      e.preventDefault?.()
      e.stopPropagation?.()
      selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
      scrollToSelected()
      break
    case 'Enter':
      e.preventDefault?.()
      e.stopPropagation?.()
      selectCurrent()
      break
    case 'Escape':
      e.preventDefault?.()
      e.stopPropagation?.()
      emit('close')
      break
    case 'Tab':
      e.preventDefault?.()
      e.stopPropagation?.()
      selectCurrent()
      break
  }
}

// 滚动到选中项
function scrollToSelected() {
  nextTick(() => {
    const container = scrollbarRef.value?.getContainer()
    if (!container) return
    
    const selectedItem = container.querySelector('.file-item.selected') as HTMLElement
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest', behavior: 'auto' })
    }
  })
}

// 监听查询变化
watch(() => props.query, (newQuery) => {
  debouncedSearch(newQuery)
})

// 监听可见性变化
watch(() => props.visible, (visible) => {
  if (visible) {
    // 打开时立即搜索，并滚动到活跃文件
    searchFiles(props.query, true)
    // 聚焦到列表以便键盘导航
    nextTick(() => {
      // 不需要聚焦搜索框，保持原输入框焦点
    })
  } else {
    // 关闭时清理
    files.value = []
    selectedIndex.value = 0
    activeFilePath.value = null
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }
})

// 清理
onBeforeUnmount(() => {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
})

// 暴露方法
defineExpose({
  handleKeydown,
  selectCurrent
})
</script>

<template>
  <Transition name="slide-up">
    <div v-if="visible" class="file-picker-panel">
      <!-- 头部 -->
      <div class="panel-header">
        <i class="codicon codicon-search"></i>
        <span class="header-title">{{ t('components.input.filePicker.title') }}</span>
        <span class="header-subtitle">{{ t('components.input.filePicker.subtitle') }}</span>
        <span v-if="query" class="query-badge">{{ query }}</span>
      </div>
      
      <!-- 文件列表 -->
      <CustomScrollbar ref="scrollbarRef" class="file-list">
        <!-- 加载中 -->
        <div v-if="isLoading" class="loading-state">
          <i class="codicon codicon-loading codicon-modifier-spin"></i>
          <span>{{ t('components.input.filePicker.loading') }}</span>
        </div>
        
        <!-- 空状态 -->
        <div v-else-if="files.length === 0" class="empty-state">
          <i class="codicon codicon-info"></i>
          <span>{{ t('components.input.filePicker.empty') }}</span>
        </div>
        
        <!-- 文件列表 -->
        <div
          v-else
          v-for="(file, index) in highlightedPaths"
          :key="file.path"
          class="file-item"
          :class="{ selected: index === selectedIndex, 'is-open': file.isOpen }"
          @click="selectFile(file)"
          @mouseenter="selectedIndex = index"
        >
          <i :class="['codicon', getFileIcon(file)]"></i>
          <span class="file-path" v-html="file.highlightedPath"></span>
          <span v-if="file.isOpen" class="open-badge">•</span>
        </div>
      </CustomScrollbar>
      
      <!-- 底部提示 -->
      <div class="panel-footer">
        <span class="hint">
          <kbd>↑</kbd><kbd>↓</kbd> {{ t('components.input.filePicker.navigate') }}
          <kbd>Enter</kbd> {{ t('components.input.filePicker.select') }}
          <kbd>Esc</kbd> {{ t('components.input.filePicker.close') }}
        </span>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.file-picker-panel {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  margin-bottom: 4px;
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-editorWidget-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 100;
  max-height: 300px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 头部 */
.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vscode-panel-border);
  flex-shrink: 0;
}

.panel-header .codicon-search {
  font-size: 14px;
  opacity: 0.7;
}

.header-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--vscode-foreground);
}

.header-subtitle {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  flex: 1;
}

.query-badge {
  padding: 2px 6px;
  font-size: 11px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: 3px;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 文件列表 */
.file-list {
  flex: 1;
  min-height: 0;
  padding: 4px;
}

/* 加载和空状态 */
.loading-state,
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 16px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

.loading-state .codicon {
  font-size: 14px;
}

/* 文件项 */
.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.1s;
}

.file-item:hover {
  background: var(--vscode-list-hoverBackground);
}

.file-item.selected {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
}

.file-item .codicon {
  font-size: 14px;
  flex-shrink: 0;
  opacity: 0.8;
}

.file-item.selected .codicon {
  opacity: 1;
}

/* 已打开的文件 - 浅蓝色背景 */
.file-item.is-open {
  background: rgba(30, 144, 255, 0.08);
}

.file-item.is-open:hover {
  background: rgba(30, 144, 255, 0.15);
}

.file-item.is-open.selected {
  background: var(--vscode-list-activeSelectionBackground);
}

.open-badge {
  color: var(--vscode-textLink-foreground, #3794ff);
  font-size: 16px;
  flex-shrink: 0;
  margin-left: auto;
}

.file-path {
  flex: 1;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-path :deep(mark) {
  background: var(--vscode-editor-findMatchHighlightBackground);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
}

/* 底部提示 */
.panel-footer {
  padding: 6px 12px;
  border-top: 1px solid var(--vscode-panel-border);
  flex-shrink: 0;
}

.hint {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

kbd {
  display: inline-block;
  padding: 1px 4px;
  margin: 0 2px;
  font-size: 10px;
  font-family: var(--vscode-editor-font-family);
  background: var(--vscode-keybindingLabel-background);
  border: 1px solid var(--vscode-keybindingLabel-border);
  border-radius: 3px;
  box-shadow: 0 1px 0 var(--vscode-keybindingLabel-bottomBorder);
}

/* 动画 */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.15s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

/* 加载动画 */
.codicon-modifier-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

</style>
