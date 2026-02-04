<script setup lang="ts">
/**
 * JsonViewerDialog - 通用 JSON 查看器
 *
 * 用于在 UI 中查看“原始返回/调试信息”等结构化数据。
 */

import { computed, ref, onUnmounted } from 'vue'
import Modal from './Modal.vue'
import { t } from '../../i18n'
import { copyToClipboard } from '../../utils/format'

interface Props {
  modelValue?: boolean
  title?: string
  value: unknown
  width?: string
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  title: '',
  width: '760px'
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})

function safeStringify(value: unknown): string {
  // 防止超大对象/循环引用导致 UI 卡死
  const seen = new WeakSet<object>()
  const MAX_STRING = 12_000

  const replacer = (_key: string, v: any) => {
    if (typeof v === 'bigint') return v.toString()

    if (typeof v === 'string') {
      if (v.length > MAX_STRING) {
        return `${v.slice(0, MAX_STRING)}\n... (truncated, total=${v.length})`
      }
      return v
    }

    if (v && typeof v === 'object') {
      if (seen.has(v)) return '[Circular]'
      seen.add(v)
    }

    return v
  }

  try {
    return JSON.stringify(value, replacer, 2)
  } catch (e: any) {
    try {
      return String(value)
    } catch {
      return '[Unserializable]'
    }
  }
}

const jsonText = computed(() => safeStringify(props.value))

const copied = ref(false)
let copiedTimer: number | undefined

onUnmounted(() => {
  if (copiedTimer) {
    window.clearTimeout(copiedTimer)
    copiedTimer = undefined
  }
})

async function handleCopy() {
  const ok = await copyToClipboard(jsonText.value)
  if (!ok) return

  copied.value = true
  if (copiedTimer) window.clearTimeout(copiedTimer)
  copiedTimer = window.setTimeout(() => {
    copied.value = false
    copiedTimer = undefined
  }, 1000)
}
</script>

<template>
  <Modal v-model="visible" :title="title || t('components.message.actions.viewRaw')" :width="width">
    <pre class="json-viewer">{{ jsonText }}</pre>

    <template #footer>
      <button class="dialog-btn cancel" type="button" @click="visible = false">
        {{ t('common.close') }}
      </button>
      <button class="dialog-btn confirm" type="button" @click="handleCopy">
        {{ copied ? t('components.common.tooltip.copied') : t('common.copy') }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.json-viewer {
  margin: 0;
  padding: 12px;
  border-radius: 6px;
  border: 1px solid var(--vscode-panel-border);
  background: rgba(0, 0, 0, 0.15);
  color: var(--vscode-foreground);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre;
  overflow: auto;
  max-height: 70vh;
}

.dialog-btn {
  padding: 6px 14px;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  border: none;
  transition: background-color 0.15s, opacity 0.15s;
}

.dialog-btn.cancel {
  background: transparent;
  color: var(--vscode-foreground);
  border: 1px solid var(--vscode-panel-border);
}

.dialog-btn.cancel:hover {
  background: var(--vscode-toolbar-hoverBackground);
}

.dialog-btn.confirm {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.dialog-btn.confirm:hover {
  background: var(--vscode-button-hoverBackground);
}
</style>
