<script setup lang="ts">
/**
 * AnnouncementModal - 版本更新公告弹窗
 *
 * 当用户更新版本后首次打开时显示更新内容
 */

import { ref, onMounted, computed } from 'vue'
import { useI18n } from '@/i18n'
import { sendToExtension } from '@/utils/vscode'

const { t } = useI18n()

// 是否显示弹窗
const visible = ref(false)

// 当前版本
const currentVersion = ref('')

// 更新内容（markdown 格式）
const changelog = ref('')

// 是否正在加载
const loading = ref(true)

// 检查是否需要显示公告
onMounted(async () => {
  try {
    const result = await sendToExtension<{
      shouldShow: boolean
      version: string
      changelog: string
    }>('checkAnnouncement', {})
    
    if (result.shouldShow) {
      currentVersion.value = result.version
      changelog.value = result.changelog
      visible.value = true
    }
  } catch (error) {
    console.error('Failed to check announcement:', error)
  } finally {
    loading.value = false
  }
})

// 关闭弹窗并标记已查看
async function close() {
  visible.value = false
  try {
    await sendToExtension('markAnnouncementRead', {
      version: currentVersion.value
    })
  } catch (error) {
    console.error('Failed to mark announcement as read:', error)
  }
}

// 解析 changelog 内容为 HTML
const formattedChangelog = computed(() => {
  if (!changelog.value) return ''
  
  // 简单的 markdown 解析
  return changelog.value
    // 处理标题
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    // 处理列表项
    .replace(/^\s*-\s+(.+)$/gm, '<li>$1</li>')
    // 包装列表
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    // 处理加粗
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // 处理代码
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // 处理换行
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '')
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="modal-overlay" @click.self="close">
        <div class="modal-container">
          <!-- 标题栏 -->
          <div class="modal-header">
            <div class="header-content">
              <i class="codicon codicon-megaphone"></i>
              <h2>{{ t('components.announcement.title') }}</h2>
              <span class="version-badge">v{{ currentVersion }}</span>
            </div>
            <button class="close-btn" @click="close" :title="t('common.close')">
              <i class="codicon codicon-close"></i>
            </button>
          </div>
          
          <!-- 内容区域 -->
          <div class="modal-body">
            <div class="changelog-content" v-html="formattedChangelog"></div>
          </div>
          
          <!-- 底部按钮 -->
          <div class="modal-footer">
            <button class="primary-btn" @click="close">
              {{ t('components.announcement.gotIt') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 20px;
}

.modal-container {
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  max-width: 500px;
  width: 100%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--vscode-panel-border);
  flex-shrink: 0;
}

.header-content {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-content .codicon {
  font-size: 20px;
  color: var(--vscode-textLink-foreground);
}

.header-content h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.version-badge {
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
}

.close-btn {
  background: transparent;
  border: none;
  color: var(--vscode-foreground);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.7;
  transition: opacity 0.15s, background 0.15s;
}

.close-btn:hover {
  opacity: 1;
  background: var(--vscode-toolbar-hoverBackground);
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  min-height: 0;
}

.changelog-content {
  font-size: 13px;
  line-height: 1.6;
  color: var(--vscode-foreground);
}

.changelog-content :deep(h3) {
  margin: 20px 0 12px;
  padding-top: 16px;
  font-size: 14px;
  font-weight: 600;
  color: var(--vscode-textLink-foreground);
  border-top: 1px solid var(--vscode-panel-border);
}

.changelog-content :deep(h3):first-child {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}

.changelog-content :deep(h4) {
  margin: 16px 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--vscode-textLink-foreground);
}

.changelog-content :deep(h4):first-child {
  margin-top: 0;
}

.changelog-content :deep(ul) {
  margin: 0 0 12px;
  padding-left: 20px;
}

.changelog-content :deep(li) {
  margin: 4px 0;
  color: var(--vscode-descriptionForeground);
}

.changelog-content :deep(code) {
  background: var(--vscode-textCodeBlock-background);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--vscode-editor-font-family);
  font-size: 12px;
}

.changelog-content :deep(strong) {
  color: var(--vscode-foreground);
  font-weight: 600;
}

.modal-footer {
  padding: 16px 20px;
  border-top: 1px solid var(--vscode-panel-border);
  display: flex;
  justify-content: flex-end;
  flex-shrink: 0;
}

.primary-btn {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  padding: 8px 20px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

.primary-btn:hover {
  background: var(--vscode-button-hoverBackground);
}

/* 动画 */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-active .modal-container,
.modal-leave-active .modal-container {
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-container,
.modal-leave-to .modal-container {
  transform: scale(0.95);
  opacity: 0;
}
</style>
