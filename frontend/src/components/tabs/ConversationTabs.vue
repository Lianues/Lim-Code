<script setup lang="ts">
/**
 * ConversationTabs - 多对话标签页组件
 *
 * 在聊天区域顶部显示横向标签页栏，支持：
 * - 切换标签页
 * - 关闭标签页
 * - 新建标签页
 * - 流式响应指示器
 * - 使用 CustomScrollbar 实现底部横向滚动条
 */

import { ref, computed, nextTick, watch } from 'vue'
import { useI18n } from '../../i18n'
import { CustomScrollbar } from '../common'

const { t } = useI18n()

interface TabInfo {
  id: string
  conversationId: string | null
  title: string
  isStreaming: boolean
}

const props = defineProps<{
  tabs: TabInfo[]
  activeTabId: string | null
}>()

const emit = defineEmits<{
  switchTab: [tabId: string]
  closeTab: [tabId: string]
  newTab: []
}>()

/** CustomScrollbar 组件 ref */
const scrollbarRef = ref<InstanceType<typeof CustomScrollbar> | null>(null)

/** 是否显示标签栏（至少 1 个标签页时显示） */
const showTabs = computed(() => props.tabs.length >= 1)

/** 处理滚轮事件 - 将纵向滚轮转为横向滚动 */
function handleWheel(e: WheelEvent) {
  const container = scrollbarRef.value?.getContainer?.()
  if (!container) return
  e.preventDefault()
  container.scrollLeft += e.deltaY || e.deltaX
  scrollbarRef.value?.update?.()
}

/** 滚动到活跃标签页可见 */
function scrollToActiveTab() {
  nextTick(() => {
    const container = scrollbarRef.value?.getContainer?.()
    if (!container) return
    const activeEl = container.querySelector('.tab-item.active') as HTMLElement
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }
    scrollbarRef.value?.update?.()
  })
}

/** 截断标题 */
function truncateTitle(title: string, maxLen = 18): string {
  if (title.length <= maxLen) return title
  return title.slice(0, maxLen) + '...'
}

/** 处理关闭按钮点击（阻止冒泡） */
function handleClose(e: MouseEvent, tabId: string) {
  e.stopPropagation()
  emit('closeTab', tabId)
}

/** 处理鼠标中键关闭 */
function handleMouseDown(e: MouseEvent, tabId: string) {
  if (e.button === 1) {
    e.preventDefault()
    emit('closeTab', tabId)
  }
}

// 当活跃标签页变化时滚动到可见
watch(() => props.activeTabId, () => {
  scrollToActiveTab()
})

// 当标签页数量变化时更新滚动条
watch(() => props.tabs.length, () => {
  nextTick(() => {
    scrollbarRef.value?.update?.()
  })
})
</script>

<template>
  <div v-if="showTabs" class="tabs-bar" @wheel="handleWheel">
    <CustomScrollbar
      ref="scrollbarRef"
      :horizontal="true"
      :width="3"
      :offset="0"
      :min-thumb-height="20"
      class="tabs-scrollbar"
    >
      <div class="tabs-container">
        <div
          v-for="tab in tabs"
          :key="tab.id"
          class="tab-item"
          :class="{ active: tab.id === activeTabId, streaming: tab.isStreaming }"
          @click="emit('switchTab', tab.id)"
          @mousedown="handleMouseDown($event, tab.id)"
          :title="tab.title || t('components.tabs.newChat')"
        >
          <!-- 流式指示器 -->
          <i v-if="tab.isStreaming" class="codicon codicon-loading spin tab-spinner"></i>

          <!-- 标题 -->
          <span class="tab-title">
            {{ truncateTitle(tab.title || t('components.tabs.newChat')) }}
          </span>

          <!-- 关闭按钮 -->
          <button
            class="tab-close-btn"
            @click="handleClose($event, tab.id)"
            :title="t('components.tabs.closeTab')"
          >
            <i class="codicon codicon-close"></i>
          </button>
        </div>
      </div>
    </CustomScrollbar>

    <!-- 新建标签页按钮 -->
    <button
      class="tab-new-btn"
      @click="emit('newTab')"
      :title="t('components.tabs.newTab')"
    >
      <i class="codicon codicon-add"></i>
    </button>
  </div>
</template>

<style scoped>
.tabs-bar {
  display: flex;
  align-items: stretch;
  height: 26px;
  min-height: 26px;
  background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-editor-background));
  border-bottom: 1px solid var(--vscode-panel-border, rgba(127, 127, 127, 0.2));
  flex-shrink: 0;
  overflow: hidden;
}

.tabs-scrollbar {
  flex: 1;
  min-width: 0;
  height: 100%;
}

/* CustomScrollbar 内部滚动容器需要横向排列 */
.tabs-scrollbar :deep(.scroll-container) {
  display: flex;
  align-items: stretch;
  overflow-y: hidden !important;
}

/* 横向滚动条贴在标签栏底部，默认隐藏 */
.tabs-scrollbar :deep(.scroll-track-h) {
  bottom: 0 !important;
  opacity: 0;
  transition: opacity 0.2s ease;
}

/* 鼠标进入标签页区域时显示滚动条 */
.tabs-bar:hover .tabs-scrollbar :deep(.scroll-track-h) {
  opacity: 1;
}

.tabs-container {
  display: flex;
  align-items: stretch;
  height: 100%;
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 0 4px 0 8px;
  min-width: 0;
  max-width: 160px;
  height: 100%;
  cursor: pointer;
  white-space: nowrap;
  border-right: 1px solid var(--vscode-panel-border, rgba(127, 127, 127, 0.15));
  background: transparent;
  color: var(--vscode-tab-inactiveForeground, var(--vscode-foreground));
  opacity: 0.7;
  transition: opacity var(--transition-fast, 0.1s ease),
              background var(--transition-fast, 0.1s ease);
  position: relative;
  flex-shrink: 0;
}

.tab-item:hover {
  opacity: 1;
  background: var(--vscode-tab-hoverBackground, rgba(127, 127, 127, 0.1));
}

.tab-item.active {
  opacity: 1;
  color: var(--vscode-tab-activeForeground, var(--vscode-foreground));
  background: var(--vscode-tab-activeBackground, var(--vscode-editor-background));
}

.tab-item.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--vscode-tab-activeBorderTop, var(--vscode-focusBorder, #007fd4));
}

.tab-spinner {
  font-size: 11px;
  flex-shrink: 0;
  color: var(--vscode-progressBar-background, #0e70c0);
}

.tab-title {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
  user-select: none;
}

.tab-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm, 2px);
  background: transparent;
  color: var(--vscode-foreground);
  cursor: pointer;
  opacity: 0;
  flex-shrink: 0;
  transition: opacity var(--transition-fast, 0.1s ease),
              background var(--transition-fast, 0.1s ease);
}

.tab-close-btn .codicon {
  font-size: 11px;
}

.tab-item:hover .tab-close-btn,
.tab-item.active .tab-close-btn {
  opacity: 0.5;
}

.tab-close-btn:hover {
  opacity: 1 !important;
  background: var(--vscode-toolbar-hoverBackground, rgba(127, 127, 127, 0.2));
}

/* 流式中的标签页 - 始终显示关闭按钮 */
.tab-item.streaming .tab-close-btn {
  opacity: 0.5;
}

.tab-new-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  min-width: 26px;
  height: 100%;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--vscode-foreground);
  cursor: pointer;
  opacity: 0.6;
  transition: opacity var(--transition-fast, 0.1s ease),
              background var(--transition-fast, 0.1s ease);
}

.tab-new-btn:hover {
  opacity: 1;
  background: var(--vscode-toolbar-hoverBackground, rgba(127, 127, 127, 0.1));
}

.tab-new-btn .codicon {
  font-size: 12px;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
