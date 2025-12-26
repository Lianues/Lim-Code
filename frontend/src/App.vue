<script setup lang="ts">
/**
 * App.vue - 主应用组件
 * 使用Pinia store管理状态
 */

import { onMounted, ref } from 'vue'
import { MessageList } from './components/message'
import { InputArea } from './components/input'
import { WelcomePanel } from './components/home'
import { HistoryPage } from './components/history'
import { SettingsPanel } from './components/settings'
import { CustomScrollbar } from './components/common'
import { useChatStore, useSettingsStore, useTerminalStore } from './stores'
import { useAttachments } from './composables'
import { useI18n, setLanguage } from './i18n'
import { copyToClipboard } from './utils'
import { sendToExtension, onMessageFromExtension } from './utils/vscode'
import type { Attachment, Message } from './types'

// i18n
const { t } = useI18n()

// 语言是否已加载
const languageLoaded = ref(false)

// 使用 Pinia Store
const chatStore = useChatStore()
const settingsStore = useSettingsStore()
const terminalStore = useTerminalStore()

// 附件管理（仍使用composable）
const {
  attachments,
  uploading,
  addAttachments,
  removeAttachment,
  clearAttachments
} = useAttachments()

// 处理新建对话
function handleNewChat() {
  chatStore.createNewConversation()
  settingsStore.showChat()
}

// 处理发送消息
async function handleSend(content: string, messageAttachments: Attachment[]) {
  if (!content.trim() && messageAttachments.length === 0) return

  // 先立即清除附件，不需要等待响应完成
  clearAttachments()

  try {
    // 检查是否有待确认的工具调用
    // 如果有，则发送内容作为批注并拒绝所有待确认工具
    if (chatStore.hasPendingToolConfirmation) {
      await chatStore.rejectPendingToolsWithAnnotation(content)
      return
    }

    // 正常发送消息（传递附件）
    await chatStore.sendMessage(content, messageAttachments)
  } catch (err) {
    console.error('发送失败:', err)
  }
}

// 处理取消请求
async function handleCancel() {
  try {
    await chatStore.cancelStream()
  } catch (err) {
    console.error('取消失败:', err)
  }
}

// 处理编辑消息 - 使用 allMessages 索引
async function handleEdit(messageId: string, newContent: string, editAttachments: Attachment[]) {
  const index = chatStore.allMessages.findIndex((m: Message) => m.id === messageId)
  if (index !== -1) {
    try {
      await chatStore.editAndRetry(index, newContent, editAttachments)
    } catch (err) {
      console.error('编辑失败:', err)
    }
  }
}

// 处理删除消息 - 使用 allMessages 索引（由 MessageList 直接调用 store）
async function handleDelete(messageId: string) {
  const index = chatStore.allMessages.findIndex((m: Message) => m.id === messageId)
  if (index !== -1) {
    try {
      await chatStore.deleteMessage(index)
    } catch (err) {
      console.error('删除失败:', err)
    }
  }
}

// 处理重试 - 使用 allMessages 索引（由 MessageList 直接调用 store）
async function handleRetry(messageId: string) {
  const index = chatStore.allMessages.findIndex((m: Message) => m.id === messageId)
  if (index !== -1) {
    try {
      await chatStore.retryFromMessage(index)
    } catch (err) {
      console.error('重试失败:', err)
    }
  }
}

// 处理复制
async function handleCopy(content: string) {
  const success = await copyToClipboard(content)
  if (success) {
    console.log('已复制到剪贴板')
  }
}

// 处理附件上传
async function handleAttachFile() {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.txt'
  
  input.onchange = async (e) => {
    const files = Array.from((e.target as HTMLInputElement).files || [])
    if (files.length > 0) {
      try {
        await addAttachments(files)
      } catch (err) {
        console.error('上传附件失败:', err)
      }
    }
  }
  
  input.click()
}

// 处理移除附件
function handleRemoveAttachment(id: string) {
  removeAttachment(id)
}

// 格式化错误详情
function formatErrorDetails(details: any): string {
  if (typeof details === 'string') {
    // 如果是字符串，尝试解析为 JSON
    try {
      const parsed = JSON.parse(details)
      return JSON.stringify(parsed, null, 2)
    } catch {
      return details
    }
  }
  return JSON.stringify(details, null, 2)
}

// 处理粘贴文件
async function handlePasteFiles(files: File[]) {
  if (files.length > 0) {
    try {
      await addAttachments(files)
    } catch (err) {
      console.error('粘贴附件失败:', err)
    }
  }
}

// 显示设置
function handleShowSettings() {
  settingsStore.showSettings()
}

// 显示历史
function handleShowHistory() {
  settingsStore.showHistory()
}

// 加载语言设置
async function loadLanguageSettings() {
  try {
    const response = await sendToExtension<any>('getSettings', {})
    if (response?.settings?.ui?.language) {
      settingsStore.setLanguage(response.settings.ui.language)
      setLanguage(response.settings.ui.language)
    }
  } catch (error) {
    console.error('Failed to load language settings:', error)
  } finally {
    languageLoaded.value = true
  }
}

// 组件挂载
onMounted(async () => {
  console.log('LimCode Chat 已加载')
  
  // 初始化终端 store（监听终端输出事件）
  terminalStore.initialize()
  
  // 先加载语言设置，确保 UI 语言正确
  await loadLanguageSettings()
  
  await chatStore.initialize()
  
  // 默认显示聊天视图（初始状态无消息时会显示欢迎面板）
  
  // 监听来自扩展的命令
  onMessageFromExtension((message: any) => {
    if (message.type === 'command') {
      switch (message.command) {
        case 'newChat':
          handleNewChat()
          break
        case 'showHistory':
          handleShowHistory()
          break
        case 'showSettings':
          handleShowSettings()
          break
      }
    }
  })
})
</script>

<template>
  <div class="app-container">
    <!-- 等待语言加载完成 -->
    <template v-if="!languageLoaded">
      <div class="loading-container">
        <i class="codicon codicon-loading spin"></i>
      </div>
    </template>
    
    <!-- 聊天视图 - 使用 v-show 避免销毁组件，保持滚动位置 -->
    <div v-show="languageLoaded && settingsStore.currentView === 'chat'" class="chat-view">
      <!-- 主聊天区域 -->
      <div class="chat-area">
        <!-- 初始状态：显示欢迎面板+历史对话列表 -->
        <WelcomePanel
          v-if="chatStore.showEmptyState"
        />

        <!-- 有消息时：显示消息列表 -->
        <!-- 使用 v-show 保持组件挂载状态，避免切换对话时 watch 失效 -->
        <MessageList
          v-show="!chatStore.showEmptyState"
          :messages="chatStore.messages"
          @edit="handleEdit"
          @delete="handleDelete"
          @retry="handleRetry"
          @copy="handleCopy"
        />
        
        <!-- 重试状态提示面板 -->
        <div
          v-if="chatStore.retryStatus && chatStore.retryStatus.isRetrying"
          class="retry-panel"
        >
          <div class="retry-header">
            <i class="codicon codicon-warning warning-icon"></i>
            <span class="retry-title">{{ t('app.retryPanel.title') }}</span>
            <div class="retry-progress-inline">
              <i class="codicon codicon-sync spin"></i>
              <span>{{ chatStore.retryStatus.attempt }}/{{ chatStore.retryStatus.maxAttempts }}</span>
              <span v-if="chatStore.retryStatus.nextRetryIn" class="retry-countdown">
                ({{ Math.ceil((chatStore.retryStatus.nextRetryIn || 0) / 1000) }}s)
              </span>
            </div>
            <button class="retry-cancel-btn" @click="handleCancel" :title="t('app.retryPanel.cancelTooltip')">
              <i class="codicon codicon-close"></i>
            </button>
          </div>
          <div class="retry-body">
            <!-- 错误信息显示在内容开头 -->
            <CustomScrollbar :max-height="120" :width="4">
              <pre class="retry-error-json">{{ chatStore.retryStatus.error || t('app.retryPanel.defaultError') }}{{ chatStore.retryStatus.errorDetails ? '\n\n' + formatErrorDetails(chatStore.retryStatus.errorDetails) : '' }}</pre>
            </CustomScrollbar>
          </div>
        </div>
      </div>

      <!-- 输入区域（始终显示） -->
      <InputArea
        :attachments="attachments"
        :uploading="uploading"
        @send="handleSend"
        @cancel="handleCancel"
        @attach-file="handleAttachFile"
        @remove-attachment="handleRemoveAttachment"
        @paste-files="handlePasteFiles"
      />
    </div>

    <!-- 历史页面 -->
    <HistoryPage v-if="languageLoaded && settingsStore.currentView === 'history'" />

    <!-- 设置面板 -->
    <SettingsPanel v-if="languageLoaded && settingsStore.currentView === 'settings'" />
  </div>
</template>

<style scoped>
/* 主容器 - 扁平化设计 */
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--vscode-editor-background);
  color: var(--vscode-foreground);
}

/* 聊天视图容器 */
.chat-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.chat-area {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

/* 重试状态面板（黑白灰配色，只有图标用黄色） */
.retry-panel {
  position: absolute;
  bottom: 12px;
  left: 12px;
  right: 12px;
  z-index: 100;
  background: var(--vscode-textBlockQuote-background, rgba(127, 127, 127, 0.1));
  border: 1px solid var(--vscode-panel-border, rgba(127, 127, 127, 0.3));
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  overflow: hidden;
  max-height: 200px;
}

.retry-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.1);
  border-bottom: 1px solid var(--vscode-panel-border, rgba(127, 127, 127, 0.2));
}

.warning-icon {
  font-size: 16px;
  color: var(--vscode-charts-yellow, #f0c674);
}

.retry-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--vscode-foreground);
}

.retry-progress-inline {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  margin-left: auto;
  margin-right: 8px;
}

.retry-progress-inline .codicon {
  font-size: 12px;
  color: var(--vscode-charts-yellow, #f0c674);
}

.retry-cancel-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--vscode-foreground);
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.15s, background 0.15s;
}

.retry-cancel-btn:hover {
  opacity: 1;
  background: var(--vscode-toolbar-hoverBackground);
}

.retry-body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.retry-error-json {
  font-size: 11px;
  color: var(--vscode-foreground);
  line-height: 1.4;
  word-break: break-word;
  white-space: pre-wrap;
  font-family: var(--vscode-editor-font-family, monospace);
  background: rgba(0, 0, 0, 0.15);
  padding: 8px;
  border-radius: 4px;
  margin: 0;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.retry-countdown {
  color: var(--vscode-descriptionForeground);
}

/* 加载容器 */
.loading-container {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  color: var(--vscode-foreground);
}

.loading-container .codicon {
  font-size: 24px;
  opacity: 0.6;
}
</style>