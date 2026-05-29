<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Modal from '../common/Modal.vue'
import type { ContextStatusSnapshot } from '../../types'
import { getContextStatus } from '../../services/context'

const props = defineProps<{
  modelValue: boolean
  conversationId: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})

const loading = ref(false)
const error = ref<string | null>(null)
const status = ref<ContextStatusSnapshot | null>(null)
let refreshSequence = 0

const healthTone = computed<'ok' | 'warning'>(() => status.value?.degradedReason || status.value?.readonlyLegacy ? 'warning' : 'ok')
const healthLabel = computed(() => healthTone.value === 'warning' ? 'Needs attention' : 'Healthy')

function boolLabel(value?: boolean): string {
  if (typeof value !== 'boolean') return 'Unknown'
  return value ? 'Yes' : 'No'
}

function statusDescription(snapshot: ContextStatusSnapshot | null): string {
  if (!snapshot) return 'No context status has been loaded yet.'
  if (snapshot.degradedReason) {
    return `The context state is degraded: ${snapshot.degradedReason}`
  }
  if (!snapshot.projection) {
    return `No compressed working projection is active. The conversation currently uses full history with ${snapshot.historyLength ?? 0} messages.`
  }
  return `Working projection ${snapshot.projection.mode} starts at message ${snapshot.projection.startIndex}.`
}

async function refresh() {
  const sequence = ++refreshSequence
  if (!props.conversationId) {
    loading.value = false
    error.value = 'Open or create a conversation before checking context status.'
    status.value = null
    return
  }

  const conversationId = props.conversationId
  loading.value = true
  error.value = null
  try {
    // 修改原因：context status 是纯诊断窗口，刷新时必须只读取后端快照，不能通过 chatStore.sendMessage 触发 ChatFlow。
    // 修改方式：调用 context service 的 `getContextStatus` request/response 接口，并把结果保存在本地组件状态。
    // 修改目的：用户打开或刷新窗口不会创建用户消息、不会创建 assistant 占位、不会影响模型上下文。
    const nextStatus = await getContextStatus(conversationId)
    if (sequence !== refreshSequence || props.conversationId !== conversationId) return
    status.value = nextStatus
  } catch (err: any) {
    if (sequence !== refreshSequence || props.conversationId !== conversationId) return
    status.value = null
    error.value = err?.message || 'Failed to load context status.'
  } finally {
    if (sequence === refreshSequence && props.conversationId === conversationId) {
      loading.value = false
    }
  }
}

watch(
  () => [props.modelValue, props.conversationId] as const,
  ([open]) => {
    // 修改原因：状态窗口打开时切换会话会让旧请求变成 stale；如果不监听 conversationId，新会话不会自动刷新且 loading 可能保持旧状态。
    // 修改方式：窗口打开期间 modelValue 或 conversationId 任一变化都重新发起 refresh，旧请求由 refreshSequence 丢弃。
    // 修改目的：ContextStatusDialog 始终展示当前会话状态，不需要关闭重开恢复。
    if (open) {
      void refresh()
    }
  }
)
</script>

<template>
  <Modal v-model="visible" title="Context status" width="640px">
    <div class="context-status-dialog">
      <div class="status-toolbar">
        <div class="status-heading">
          <span class="status-icon" :class="`status-icon--${healthTone}`">
            <i class="codicon" :class="healthTone === 'warning' ? 'codicon-warning' : 'codicon-pass'" />
          </span>
          <div>
            <div class="status-title">{{ healthLabel }}</div>
            <div class="status-subtitle">{{ statusDescription(status) }}</div>
          </div>
        </div>
        <button type="button" class="refresh-button" :disabled="loading" @click="refresh">
          <i class="codicon" :class="loading ? 'codicon-loading codicon-modifier-spin' : 'codicon-refresh'" />
          <span>{{ loading ? 'Loading' : 'Refresh' }}</span>
        </button>
      </div>

      <div v-if="error" class="status-error" role="alert">
        <i class="codicon codicon-error" />
        <span>{{ error }}</span>
      </div>

      <div v-else-if="status" class="status-grid">
        <section class="status-card">
          <div class="card-label">Conversation</div>
          <code>{{ status.conversationId }}</code>
        </section>

        <section class="status-card">
          <div class="card-label">History messages</div>
          <strong>{{ status.historyLength ?? 'Unknown' }}</strong>
        </section>

        <section class="status-card">
          <div class="card-label">Ledger entries</div>
          <strong>{{ status.ledgerEntryCount }}</strong>
        </section>

        <section class="status-card">
          <div class="card-label">Readonly legacy</div>
          <strong>{{ boolLabel(status.readonlyLegacy) }}</strong>
        </section>

        <section class="status-card status-card--wide">
          <div class="card-label">Projection</div>
          <template v-if="status.projection">
            <div class="projection-row">
              <span>Mode</span>
              <strong>{{ status.projection.mode }}</strong>
            </div>
            <div class="projection-row">
              <span>Projection id</span>
              <code>{{ status.projection.projectionId }}</code>
            </div>
            <div class="projection-row">
              <span>Start index</span>
              <strong>{{ status.projection.startIndex }}</strong>
            </div>
            <div class="projection-row">
              <span>Lossy</span>
              <strong>{{ boolLabel(status.projection.lossy) }}</strong>
            </div>
            <div class="projection-row">
              <span>Reversible</span>
              <strong>{{ boolLabel(status.projection.reversible) }}</strong>
            </div>
            <div v-if="status.projection.tokenEstimate?.after" class="projection-row">
              <span>Estimated tokens</span>
              <strong>{{ status.projection.tokenEstimate.after }}</strong>
            </div>
          </template>
          <p v-else class="empty-note">No active working projection. Full history is currently used.</p>
        </section>

        <section class="status-card status-card--wide">
          <div class="card-label">Last ledger operation</div>
          <template v-if="status.lastOperation">
            <div class="projection-row">
              <span>Operation</span>
              <strong>{{ status.lastOperation.operation }}</strong>
            </div>
            <div class="projection-row">
              <span>Status</span>
              <strong>{{ status.lastOperation.status }}</strong>
            </div>
            <div class="projection-row">
              <span>Ledger id</span>
              <code>{{ status.lastOperation.ledgerEntryId }}</code>
            </div>
          </template>
          <p v-else class="empty-note">No ledger operation has been recorded yet.</p>
        </section>

        <section v-if="status.nextActions?.length" class="status-card status-card--wide">
          <div class="card-label">Suggested actions</div>
          <div class="action-list">
            <code v-for="action in status.nextActions" :key="action">{{ action }}</code>
          </div>
          <p class="empty-note">Actions are shown for diagnosis only in this window. Run mutating operations deliberately from the chat command flow.</p>
        </section>
      </div>

      <div v-else class="status-empty">
        <i class="codicon codicon-loading codicon-modifier-spin" />
        <span>Loading context status...</span>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.context-status-dialog {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.status-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.status-heading {
  display: flex;
  align-items: flex-start;
  min-width: 0;
  gap: 10px;
}

.status-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  flex-shrink: 0;
  background: color-mix(in srgb, var(--vscode-editorWidget-background) 85%, var(--vscode-textLink-foreground));
}

.status-icon--ok {
  color: var(--vscode-charts-green, #388a34);
}

.status-icon--warning {
  color: var(--vscode-editorWarning-foreground, #b8860b);
}

.status-title {
  font-weight: 600;
  color: var(--vscode-foreground);
}

.status-subtitle {
  margin-top: 3px;
  line-height: 1.45;
  color: var(--vscode-descriptionForeground);
}

.refresh-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
  border-radius: 4px;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  cursor: pointer;
}

.refresh-button:hover:not(:disabled) {
  background: var(--vscode-button-hoverBackground);
}

.refresh-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.status-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--vscode-errorForeground);
  border-radius: 6px;
  color: var(--vscode-errorForeground);
  background: color-mix(in srgb, var(--vscode-errorForeground) 8%, transparent);
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.status-card {
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  background: color-mix(in srgb, var(--vscode-editorWidget-background) 86%, transparent);
}

.status-card--wide {
  grid-column: 1 / -1;
}

.card-label {
  margin-bottom: 6px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.projection-row {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 10px;
  padding: 4px 0;
  color: var(--vscode-descriptionForeground);
}

.projection-row strong,
.status-card strong {
  color: var(--vscode-foreground);
}

code {
  font-family: var(--vscode-editor-font-family), monospace;
  overflow-wrap: anywhere;
  color: var(--vscode-textLink-foreground);
}

.empty-note {
  margin: 0;
  line-height: 1.45;
  color: var(--vscode-descriptionForeground);
}

.action-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.action-list code {
  padding: 2px 6px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  background: var(--vscode-textCodeBlock-background);
}

.status-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--vscode-descriptionForeground);
}

@media (max-width: 520px) {
  .status-toolbar {
    flex-direction: column;
  }

  .status-grid {
    grid-template-columns: 1fr;
  }

  .projection-row {
    grid-template-columns: 1fr;
    gap: 2px;
  }
}
</style>
