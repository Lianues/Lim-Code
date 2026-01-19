<script setup lang="ts">
/**
 * HistoryPage - 对话历史页面
 * 作为独立页面展示
 */

import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { CustomScrollbar, CustomSelect, type SelectOption } from '../common'
import ConversationList from './ConversationList.vue'
import { useChatStore, useSettingsStore } from '@/stores'
import type { WorkspaceFilter } from '@/stores/chatStore'
import { t } from '../../i18n'

const chatStore = useChatStore()
const settingsStore = useSettingsStore()

// 滚动容器（用于分页加载）
const scrollbarRef = ref<any>(null)
let scrollEl: HTMLElement | null = null
let scrollTicking = false

function checkShouldLoadMore() {
  if (!scrollEl) return
  if (!chatStore.hasMoreConversations || chatStore.isLoadingMoreConversations) return

  const remaining = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight
  // 提前 400px 触发预加载，做到无感
  if (remaining <= 400) {
    chatStore.loadMoreConversations().then(() => {
      // 如果加载后仍然不足以产生滚动条，继续补齐下一页（直到有足够内容或没有更多）
      requestAnimationFrame(() => checkShouldLoadMore())
    })
  }
}

function handleScroll() {
  if (scrollTicking) return
  scrollTicking = true
  requestAnimationFrame(() => {
    scrollTicking = false
    checkShouldLoadMore()
  })
}

onMounted(async () => {
  await nextTick()
  scrollEl = scrollbarRef.value?.getContainer?.() || null
  if (scrollEl) {
    scrollEl.addEventListener('scroll', handleScroll, { passive: true })
    // 如果列表不足以撑满容器，立即补齐下一页
    checkShouldLoadMore()
  }
})

onBeforeUnmount(() => {
  if (scrollEl) {
    scrollEl.removeEventListener('scroll', handleScroll)
    scrollEl = null
  }
})

// 搜索关键词
const searchKeyword = ref('')

// 工作区筛选选项（响应式）
const workspaceFilterOptions = computed<SelectOption[]>(() => [
  { value: 'current', label: t('components.history.currentWorkspace') },
  { value: 'all', label: t('components.history.allWorkspaces') }
])

// 筛选后的对话列表（搜索 + 工作区筛选）
const filteredConversations = computed(() => {
  let conversations = chatStore.filteredConversations
  if (searchKeyword.value.trim()) {
    const keyword = searchKeyword.value.toLowerCase().trim()
    conversations = conversations.filter(conversation =>
      conversation.title.toLowerCase().includes(keyword)
    )
  }
  return conversations
})

// 处理筛选变更
function handleFilterChange(value: string) {
  chatStore.setWorkspaceFilter(value as WorkspaceFilter)
}

// 处理选择对话
async function handleSelect(id: string) {
  await chatStore.switchConversation(id)
  settingsStore.showChat()
}

// 处理删除对话
async function handleDelete(id: string) {
  await chatStore.deleteConversation(id)
}
</script>

<template>
  <div class="history-page">
    <!-- 页面标题栏 -->
    <div class="page-header">
      <h3>{{ t('components.history.title') }}</h3>
      <button class="close-btn" :title="t('components.history.backToChat')" @click="settingsStore.showChat">
        <i class="codicon codicon-close"></i>
      </button>
    </div>
    
    <!-- 搜索输入框 -->
    <div class="search-bar">
      <div class="search-input-container">
        <i class="codicon codicon-search"></i>
        <input
          v-model="searchKeyword"
          type="text"
          :placeholder="t('components.history.searchPlaceholder')"
          class="search-input"
        />
        <button
          v-if="searchKeyword"
          class="search-clear-btn"
          :title="t('components.history.clearSearch')"
          @click="searchKeyword = ''"
        >
          <i class="codicon codicon-close"></i>
        </button>
      </div>
    </div>
    
    <!-- 工作区筛选 -->
    <div class="filter-bar">
      <span class="filter-label">{{ t('components.history.showHistory') }}</span>
      <CustomSelect
        :model-value="chatStore.workspaceFilter"
        :options="workspaceFilterOptions"
        class="filter-select"
        @update:model-value="handleFilterChange"
      />
    </div>

    <!-- 对话列表 -->
    <CustomScrollbar ref="scrollbarRef" class="page-content">
      <!-- 搜索无结果提示 -->
      <div v-if="filteredConversations.length === 0 && searchKeyword && !chatStore.isLoadingConversations" class="no-results">
        <i class="codicon codicon-search"></i>
        <span>{{ t('components.history.noSearchResults') }}</span>
      </div>
      
      <ConversationList
        v-else
        :conversations="filteredConversations"
        :current-id="chatStore.currentConversationId"
        :loading="chatStore.isLoadingConversations"
        :loading-more="chatStore.isLoadingMoreConversations"
        :format-time="chatStore.formatTime"
        @select="handleSelect"
        @delete="handleDelete"
      />
    </CustomScrollbar>
  </div>
</template>

<style scoped>
.history-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--vscode-sideBar-background);
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.page-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
}

/* 筛选栏 */
.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--vscode-panel-border);
  flex-shrink: 0;
}

.filter-label {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
}

.filter-select {
  width: 120px;
}

/* 搜索栏 */
.search-bar {
  padding: 8px 16px;
  border-bottom: 1px solid var(--vscode-panel-border);
  flex-shrink: 0;
}

.search-input-container {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--vscode-input-border);
  border-radius: 2px;
  background: var(--vscode-input-background);
}

.search-input-container .codicon-search {
  font-size: 14px;
  color: var(--vscode-descriptionForeground);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  min-width: 0;
  padding: 0;
  background: transparent;
  color: var(--vscode-input-foreground);
  border: none;
  font-size: 12px;
  outline: none;
}

.search-input::placeholder {
  color: var(--vscode-input-placeholderForeground);
}

.search-clear-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 2px;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  flex-shrink: 0;
}

.search-clear-btn:hover {
  color: var(--vscode-foreground);
}

.search-clear-btn .codicon {
  font-size: 12px;
}

/* 无结果提示 */
.no-results {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 16px;
  text-align: center;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.no-results .codicon {
  font-size: 24px;
  opacity: 0.5;
}

.close-btn {
  background: transparent;
  border: none;
  color: var(--vscode-foreground);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.close-btn:hover {
  background: var(--vscode-toolbar-hoverBackground);
}

.page-content {
  flex: 1;
  min-height: 0;
}
</style>