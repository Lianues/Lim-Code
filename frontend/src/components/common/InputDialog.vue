<script setup lang="ts">
/**
 * 输入对话框组件
 * 用于获取用户文本输入（替代原生 prompt）
 */

import { ref, computed, watch, nextTick } from 'vue'
import { t } from '../../i18n'

interface Props {
  modelValue?: boolean
  title?: string
  placeholder?: string
  defaultValue?: string
  confirmText?: string
  cancelText?: string
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  title: '',
  placeholder: '',
  defaultValue: '',
  confirmText: '',
  cancelText: ''
})

// 使用 i18n 默认值
const displayTitle = computed(() => props.title || t('components.common.inputDialog.title'))
const displayConfirmText = computed(() => props.confirmText || t('components.common.inputDialog.confirm'))
const displayCancelText = computed(() => props.cancelText || t('components.common.inputDialog.cancel'))

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [value: string]
  cancel: []
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})

const inputValue = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

// 当对话框打开时，初始化输入值并聚焦
watch(visible, (newValue) => {
  if (newValue) {
    inputValue.value = props.defaultValue
    nextTick(() => {
      inputRef.value?.focus()
      inputRef.value?.select()
    })
  }
})

function handleCancel() {
  visible.value = false
  emit('cancel')
}

function handleConfirm() {
  if (inputValue.value.trim()) {
    visible.value = false
    emit('confirm', inputValue.value.trim())
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    handleConfirm()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    handleCancel()
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog-fade">
      <div v-if="visible" class="dialog-overlay" @click.self="handleCancel">
        <div class="dialog input-dialog">
          <div class="dialog-header">
            <i class="codicon codicon-edit dialog-icon"></i>
            <span class="dialog-title">{{ displayTitle }}</span>
          </div>
          <div class="dialog-body">
            <input
              ref="inputRef"
              v-model="inputValue"
              type="text"
              class="dialog-input"
              :placeholder="placeholder"
              @keydown="handleKeydown"
            />
          </div>
          <div class="dialog-footer">
            <button class="dialog-btn cancel" @click="handleCancel">
              {{ displayCancelText }}
            </button>
            <button
              class="dialog-btn confirm"
              :disabled="!inputValue.trim()"
              @click="handleConfirm"
            >
              {{ displayConfirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog {
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  min-width: 300px;
  max-width: 400px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.dialog-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.dialog-icon {
  font-size: 16px;
  color: var(--vscode-editorInfo-foreground);
}

.dialog-title {
  font-weight: 500;
  font-size: 14px;
}

.dialog-body {
  padding: 16px;
}

.dialog-input {
  width: 100%;
  padding: 8px 10px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  border-radius: 4px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
}

.dialog-input:focus {
  border-color: var(--vscode-focusBorder);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--vscode-panel-border);
}

.dialog-btn {
  padding: 6px 14px;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  border: none;
  transition: background-color 0.15s, opacity 0.15s;
}

.dialog-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dialog-btn.cancel {
  background: transparent;
  color: var(--vscode-foreground);
  border: 1px solid var(--vscode-panel-border);
}

.dialog-btn.cancel:hover:not(:disabled) {
  background: var(--vscode-toolbar-hoverBackground);
}

.dialog-btn.confirm {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.dialog-btn.confirm:hover:not(:disabled) {
  background: var(--vscode-button-hoverBackground);
}

/* 动画 */
.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 0.15s ease;
}

.dialog-fade-enter-active .dialog,
.dialog-fade-leave-active .dialog {
  transition: transform 0.15s ease;
}

.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}

.dialog-fade-enter-from .dialog,
.dialog-fade-leave-to .dialog {
  transform: scale(0.95);
}
</style>
