<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { JsonViewerDialog, MarkdownRenderer, Modal } from '../common'
import { useI18n } from '../../i18n'
import { copyToClipboard, formatTime } from '../../utils/format'
import { showNotification } from '../../utils/vscode'
import type {
  ResponseViewerData,
  ResponseViewerMode,
  ResponseViewerPartPreview,
  ResponseViewerResolvedFunctionResponse,
  ResponseViewerToolPreview
} from './responseViewer/buildResponseViewerData'

interface Props {
  modelValue?: boolean
  title?: string
  value: ResponseViewerData
  width?: string
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  title: '',
  width: '960px'
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const { t } = useI18n()
const MODE_STORAGE_KEY = 'limcode.responseViewer.mode'

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})

const mode = ref<ResponseViewerMode>('common')
const showRawJsonDialog = ref(false)
const expandedBlocks = ref<Record<string, boolean>>({})

watch(
  () => props.modelValue,
  isOpen => {
    if (isOpen) {
      mode.value = readStoredMode()
      showRawJsonDialog.value = false
      expandedBlocks.value = {}
      return
    }

    showRawJsonDialog.value = false
  }
)

watch(mode, nextMode => {
  persistMode(nextMode)
})

const answerText = computed(() => props.value.common.answerText || '')
const thoughtText = computed(() => props.value.common.thoughtText || '')
const tools = computed(() => props.value.common.tools)
const parts = computed(() => props.value.advanced.parts)
const attachments = computed(() => props.value.advanced.attachments)
const metadata = computed(() => props.value.advanced.metadata)

const responseInfoItems = computed(() => {
  const items: Array<{ label: string; value: string }> = []
  const usage = props.value.common.usage
  const timing = props.value.common.timing

  if (props.value.basic.modelVersion) {
    items.push({
      label: t('components.message.responseViewer.modelVersion'),
      value: props.value.basic.modelVersion
    })
  }

  if (typeof usage?.totalTokenCount === 'number' && usage.totalTokenCount > 0) {
    items.push({
      label: t('components.message.responseViewer.totalTokens'),
      value: formatInteger(usage.totalTokenCount)
    })
  }

  if (typeof usage?.promptTokenCount === 'number' && usage.promptTokenCount > 0) {
    items.push({
      label: t('components.message.responseViewer.promptTokens'),
      value: formatInteger(usage.promptTokenCount)
    })
  }

  if (typeof usage?.candidatesTokenCount === 'number' && usage.candidatesTokenCount > 0) {
    items.push({
      label: t('components.message.responseViewer.outputTokens'),
      value: formatInteger(usage.candidatesTokenCount)
    })
  }

  if (typeof usage?.thoughtsTokenCount === 'number' && usage.thoughtsTokenCount > 0) {
    items.push({
      label: t('components.message.responseViewer.thoughtTokens'),
      value: formatInteger(usage.thoughtsTokenCount)
    })
  }

  if (typeof timing.thinkingDuration === 'number' && timing.thinkingDuration > 0) {
    items.push({
      label: t('components.message.responseViewer.thinkingDuration'),
      value: formatDuration(timing.thinkingDuration)
    })
  }

  if (typeof timing.responseDuration === 'number' && timing.responseDuration > 0) {
    items.push({
      label: t('components.message.responseViewer.responseDuration'),
      value: formatDuration(timing.responseDuration)
    })
  }

  if (typeof timing.streamDuration === 'number' && timing.streamDuration > 0) {
    items.push({
      label: t('components.message.responseViewer.streamDuration'),
      value: formatDuration(timing.streamDuration)
    })
  }

  if (typeof timing.chunkCount === 'number' && timing.chunkCount > 0) {
    items.push({
      label: t('components.message.responseViewer.chunkCount'),
      value: formatInteger(timing.chunkCount)
    })
  }

  if (typeof timing.tokenRate === 'number' && timing.tokenRate > 0) {
    items.push({
      label: t('components.message.responseViewer.tokenRate'),
      value: `${timing.tokenRate.toFixed(1)} t/s`
    })
  }

  return items
})

const basicInfoItems = computed(() => {
  const items: Array<{ label: string; value: string }> = [
    {
      label: t('components.message.responseViewer.id'),
      value: props.value.basic.id
    },
    {
      label: t('components.message.responseViewer.role'),
      value: getRoleLabel(props.value.basic.role)
    }
  ]

  if (typeof props.value.basic.timestamp === 'number' && props.value.basic.timestamp > 0) {
    items.push({
      label: t('components.message.responseViewer.timestamp'),
      value: formatTime(props.value.basic.timestamp)
    })
  }

  if (typeof props.value.basic.backendIndex === 'number') {
    items.push({
      label: t('components.message.responseViewer.backendIndex'),
      value: formatInteger(props.value.basic.backendIndex)
    })
  }

  if (props.value.basic.modelVersion) {
    items.push({
      label: t('components.message.responseViewer.modelVersion'),
      value: props.value.basic.modelVersion
    })
  }

  if (props.value.basic.isFunctionResponse) {
    items.push({
      label: t('components.message.responseViewer.flags'),
      value: t('components.message.responseViewer.functionResponseMessage')
    })
  }

  if (props.value.basic.isSummary) {
    items.push({
      label: t('components.message.responseViewer.flags'),
      value: t('components.message.responseViewer.summaryMessage')
    })
  }

  return items
})

const metadataKnownItems = computed(() => {
  const items: Array<{ label: string; value: string }> = []
  const data = metadata.value
  const usage = props.value.common.usage

  if (data?.model) {
    items.push({
      label: t('components.message.responseViewer.model'),
      value: data.model
    })
  }

  if (typeof data?.tokens === 'number' && data.tokens > 0) {
    items.push({
      label: t('components.message.responseViewer.legacyTotalTokens'),
      value: formatInteger(data.tokens)
    })
  }

  if (typeof data?.latency === 'number' && data.latency > 0) {
    items.push({
      label: t('components.message.responseViewer.latency'),
      value: formatDuration(data.latency)
    })
  }

  if (typeof data?.firstChunkTime === 'number' && data.firstChunkTime > 0) {
    items.push({
      label: t('components.message.responseViewer.firstChunkTime'),
      value: formatTime(data.firstChunkTime)
    })
  }

  if (usage?.promptTokensDetails?.length) {
    items.push({
      label: t('components.message.responseViewer.promptTokenDetails'),
      value: formatJsonInline(usage.promptTokensDetails)
    })
  }

  if (usage?.candidatesTokensDetails?.length) {
    items.push({
      label: t('components.message.responseViewer.outputTokenDetails'),
      value: formatJsonInline(usage.candidatesTokensDetails)
    })
  }

  return items
})

const metadataExtra = computed(() => {
  const data = metadata.value
  if (!data) {
    return null
  }

  const {
    modelVersion: _modelVersion,
    model: _model,
    usageMetadata: _usageMetadata,
    thinkingStartTime: _thinkingStartTime,
    thinkingDuration: _thinkingDuration,
    responseDuration: _responseDuration,
    firstChunkTime: _firstChunkTime,
    streamDuration: _streamDuration,
    chunkCount: _chunkCount,
    thoughtsTokenCount: _thoughtsTokenCount,
    candidatesTokenCount: _candidatesTokenCount,
    tokens: _tokens,
    latency: _latency,
    ...rest
  } = data

  return Object.keys(rest).length > 0 ? rest : null
})

const hasMetadata = computed(() => {
  return responseInfoItems.value.length > 0 || metadataKnownItems.value.length > 0 || Boolean(metadataExtra.value)
})

function readStoredMode(): ResponseViewerMode {
  try {
    return localStorage.getItem(MODE_STORAGE_KEY) === 'advanced' ? 'advanced' : 'common'
  } catch {
    return 'common'
  }
}

function persistMode(nextMode: ResponseViewerMode): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, nextMode)
  } catch {
    // 忽略存储失败
  }
}

function handleSelectMode(nextMode: ResponseViewerMode): void {
  mode.value = nextMode
}

function toggleExpanded(key: string): void {
  expandedBlocks.value = {
    ...expandedBlocks.value,
    [key]: !expandedBlocks.value[key]
  }
}

function isExpanded(key: string): boolean {
  return expandedBlocks.value[key] === true
}

function getExpandedLabel(key: string): string {
  return isExpanded(key) ? t('common.collapse') : t('common.expand')
}

async function handleCopyBody(text: string): Promise<void> {
  const success = await copyToClipboard(text)

  await showNotification(
    success
      ? t('components.message.responseViewer.copySuccess')
      : t('components.message.responseViewer.copyFailed'),
    success ? 'info' : 'error'
  )
}

function getRoleLabel(role: string): string {
  if (role === 'user') return t('components.message.roles.user')
  if (role === 'tool') return t('components.message.roles.tool')
  return t('components.message.roles.assistant')
}

function getPartTypeLabel(type: ResponseViewerPartPreview['type']): string {
  switch (type) {
    case 'text':
      return t('components.message.responseViewer.partTypes.text')
    case 'thought':
      return t('components.message.responseViewer.partTypes.thought')
    case 'functionCall':
      return t('components.message.responseViewer.partTypes.functionCall')
    case 'functionResponse':
      return t('components.message.responseViewer.partTypes.functionResponse')
    case 'inlineData':
      return t('components.message.responseViewer.partTypes.inlineData')
    case 'fileData':
      return t('components.message.responseViewer.partTypes.fileData')
    default:
      return t('components.message.responseViewer.partTypes.unknown')
  }
}

function getToolStatusLabel(status?: ResponseViewerToolPreview['status']): string {
  switch (status) {
    case 'streaming':
      return t('components.message.responseViewer.toolStatuses.streaming')
    case 'queued':
      return t('components.message.responseViewer.toolStatuses.queued')
    case 'awaiting_approval':
      return t('components.message.responseViewer.toolStatuses.awaitingApproval')
    case 'executing':
      return t('components.message.responseViewer.toolStatuses.executing')
    case 'awaiting_apply':
      return t('components.message.responseViewer.toolStatuses.awaitingApply')
    case 'success':
      return t('components.message.responseViewer.toolStatuses.success')
    case 'error':
      return t('components.message.responseViewer.toolStatuses.error')
    case 'warning':
      return t('components.message.responseViewer.toolStatuses.warning')
    default:
      return t('components.message.responseViewer.toolStatuses.unknown')
  }
}

function getToolStatusClass(status?: ResponseViewerToolPreview['status']): string {
  return status ? `status-${status}` : 'status-unknown'
}

function getResultSourceLabel(
  source?: ResponseViewerToolPreview['resultSource'] | ResponseViewerResolvedFunctionResponse['source']
): string {
  switch (source) {
    case 'tool':
      return t('components.message.responseViewer.responseSources.tool')
    case 'partFunctionResponse':
      return t('components.message.responseViewer.responseSources.partFunctionResponse')
    case 'hiddenFunctionResponse':
      return t('components.message.responseViewer.responseSources.hiddenFunctionResponse')
    default:
      return t('components.message.responseViewer.empty')
  }
}

function formatSourceMessage(messageId?: string, backendIndex?: number): string {
  const parts: string[] = []

  if (messageId) {
    parts.push(messageId)
  }

  if (typeof backendIndex === 'number') {
    parts.push(`#${formatInteger(backendIndex)}`)
  }

  return parts.join(' · ')
}

function getToolArgsValue(tool: ResponseViewerToolPreview): unknown {
  return tool.partialArgs && tool.status === 'streaming'
    ? tool.partialArgs
    : tool.args
}

function getPartFunctionCallArgs(part: ResponseViewerPartPreview): unknown {
  if (!part.functionCall) {
    return {}
  }

  return part.functionCall.partialArgs || part.functionCall.args || {}
}

function getCollapsedText(text?: string): string {
  return text || t('components.message.responseViewer.empty')
}

function formatStructuredValue(value: unknown): string {
  return typeof value === 'string' ? value : formatJson(value)
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function formatBytes(size: number): string {
  if (!size) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  let value = size
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function formatBoolean(value: boolean): string {
  return value ? t('components.message.responseViewer.yes') : t('components.message.responseViewer.no')
}

function formatInteger(value: number): string {
  return value.toLocaleString()
}

function formatJson(value: unknown): string {
  const seen = new WeakSet<object>()
  const MAX_STRING = 12_000

  try {
    return JSON.stringify(value, (_key, currentValue) => {
      if (typeof currentValue === 'bigint') {
        return currentValue.toString()
      }

      if (typeof currentValue === 'string' && currentValue.length > MAX_STRING) {
        return `${currentValue.slice(0, MAX_STRING)}\n... (truncated, total=${currentValue.length})`
      }

      if (currentValue && typeof currentValue === 'object') {
        if (seen.has(currentValue)) {
          return '[Circular]'
        }
        seen.add(currentValue)
      }

      return currentValue
    }, 2)
  } catch {
    try {
      return String(value)
    } catch {
      return '[Unserializable]'
    }
  }
}

function formatJsonInline(value: unknown): string {
  const text = formatJson(value).replace(/\s+/g, ' ').trim()
  if (text.length <= 240) {
    return text
  }
  return `${text.slice(0, 240)}...`
}
</script>

<template>
  <Modal
    v-model="visible"
    :title="title || t('components.message.actions.viewResponse')"
    :width="width"
  >
    <div class="response-viewer">
      <div class="mode-switch">
        <button
          type="button"
          class="mode-btn"
          :class="{ active: mode === 'common' }"
          @click="handleSelectMode('common')"
        >
          {{ t('components.message.responseViewer.commonMode') }}
        </button>
        <button
          type="button"
          class="mode-btn"
          :class="{ active: mode === 'advanced' }"
          @click="handleSelectMode('advanced')"
        >
          {{ t('components.message.responseViewer.advancedMode') }}
        </button>
      </div>

      <div v-if="mode === 'common'" class="viewer-mode">
        <section class="viewer-section">
          <div class="section-title">{{ t('components.message.responseViewer.body') }}</div>
          <div v-if="answerText" class="section-content">
            <div class="section-actions">
              <button class="section-action-btn" type="button" @click="handleCopyBody(answerText)">
                {{ t('components.message.responseViewer.copyBody') }}
              </button>
            </div>
            <MarkdownRenderer :content="answerText" class="viewer-markdown" />
          </div>
          <div v-else class="empty-block">{{ t('components.message.emptyResponse') }}</div>
        </section>

        <details v-if="thoughtText" class="viewer-details">
          <summary class="viewer-details-summary">
            <span>{{ t('components.message.responseViewer.thought') }}</span>
            <span
              v-if="typeof props.value.common.timing.thinkingDuration === 'number' && props.value.common.timing.thinkingDuration > 0"
              class="summary-badge"
            >
              {{ formatDuration(props.value.common.timing.thinkingDuration) }}
            </span>
          </summary>
          <div class="details-body">
            <MarkdownRenderer :content="thoughtText" class="viewer-markdown thought-markdown" />
          </div>
        </details>

        <section class="viewer-section">
          <div class="section-title">{{ t('components.message.responseViewer.toolCalls') }}</div>
          <div v-if="tools.length > 0" class="tool-list">
            <div
              v-for="(tool, index) in tools"
              :key="tool.id || `${tool.name}-${index}`"
              class="tool-card"
            >
              <div class="tool-card-header">
                <div class="tool-name">{{ tool.name }}</div>
                <span class="status-badge" :class="getToolStatusClass(tool.status)">
                  {{ getToolStatusLabel(tool.status) }}
                </span>
              </div>

              <div v-if="tool.argsSummary" class="tool-summary-row">
                <span class="summary-label">{{ t('components.message.tool.parameters') }}</span>
                <span class="summary-value">{{ tool.argsSummary }}</span>
              </div>

              <div v-if="tool.resultSource && tool.resultSource !== 'tool'" class="tool-summary-row">
                <span class="summary-label">{{ t('components.message.responseViewer.responseSource') }}</span>
                <span class="summary-value">{{ getResultSourceLabel(tool.resultSource) }}</span>
              </div>

              <div
                v-if="tool.resultSource === 'hiddenFunctionResponse' && (tool.sourceMessageId || typeof tool.sourceBackendIndex === 'number')"
                class="tool-summary-row"
              >
                <span class="summary-label">{{ t('components.message.responseViewer.sourceMessage') }}</span>
                <span class="summary-value">{{ formatSourceMessage(tool.sourceMessageId, tool.sourceBackendIndex) }}</span>
              </div>

              <div v-if="tool.error" class="tool-summary-row error-row">
                <span class="summary-label">{{ t('components.message.tool.error') }}</span>
                <span class="summary-value">{{ tool.error }}</span>
              </div>
              <div v-else-if="tool.resultSummary" class="tool-summary-row">
                <span class="summary-label">{{ t('components.message.tool.result') }}</span>
                <span class="summary-value">{{ tool.resultSummary }}</span>
              </div>
            </div>
          </div>
          <div v-else class="empty-block">{{ t('components.message.responseViewer.noTools') }}</div>
        </section>

        <section class="viewer-section">
          <div class="section-title">{{ t('components.message.responseViewer.responseInfo') }}</div>
          <div v-if="responseInfoItems.length > 0" class="info-grid section-body-grid">
            <div v-for="item in responseInfoItems" :key="`${item.label}-${item.value}`" class="info-item">
              <div class="info-label">{{ item.label }}</div>
              <div class="info-value">{{ item.value }}</div>
            </div>
          </div>
          <div v-else class="empty-block">{{ t('components.message.responseViewer.empty') }}</div>
        </section>
      </div>

      <div v-else class="viewer-mode advanced-mode">
        <section class="viewer-section">
          <div class="section-title">{{ t('components.message.responseViewer.basicInfo') }}</div>
          <div class="section-content">
            <div class="info-grid">
              <div v-for="item in basicInfoItems" :key="`${item.label}-${item.value}`" class="info-item">
                <div class="info-label">{{ item.label }}</div>
                <div class="info-value">{{ item.value }}</div>
              </div>
            </div>
          </div>
        </section>

        <section class="viewer-section">
          <div class="section-title">{{ t('components.message.responseViewer.body') }}</div>
          <div v-if="props.value.advanced.answerText" class="section-content">
            <div class="section-actions">
              <button class="section-action-btn" type="button" @click="handleCopyBody(props.value.advanced.answerText)">
                {{ t('components.message.responseViewer.copyBody') }}
              </button>
            </div>
            <MarkdownRenderer :content="props.value.advanced.answerText" class="viewer-markdown" />
          </div>
          <div v-else class="empty-block">{{ t('components.message.emptyResponse') }}</div>
        </section>

        <section class="viewer-section">
          <div class="section-title">{{ t('components.message.responseViewer.thought') }}</div>
          <div v-if="props.value.advanced.thoughtText" class="section-content">
            <MarkdownRenderer :content="props.value.advanced.thoughtText" class="viewer-markdown thought-markdown" />
          </div>
          <div v-else class="empty-block">{{ t('components.message.responseViewer.noThought') }}</div>
        </section>

        <section class="viewer-section">
          <div class="section-title">{{ t('components.message.responseViewer.parts') }}</div>
          <div v-if="parts.length > 0" class="detail-list">
            <details
              v-for="part in parts"
              :key="`${part.type}-${part.index}`"
              class="detail-card"
            >
              <summary class="detail-summary">
                <div class="detail-summary-main">
                  <span class="detail-index">#{{ part.index + 1 }}</span>
                  <span class="detail-type">{{ getPartTypeLabel(part.type) }}</span>
                  <span v-if="part.title" class="detail-title">{{ part.title }}</span>
                </div>
                <span v-if="part.preview" class="detail-preview">{{ part.preview }}</span>
              </summary>

              <div class="detail-body">
                <MarkdownRenderer v-if="part.text" :content="part.text" class="viewer-markdown" />

                <template v-if="part.functionCall">
                  <div class="info-grid compact-grid">
                    <div class="info-item">
                      <div class="info-label">{{ t('components.message.responseViewer.name') }}</div>
                      <div class="info-value">{{ part.functionCall.name }}</div>
                    </div>
                    <div v-if="part.functionCall.id" class="info-item">
                      <div class="info-label">{{ t('components.message.responseViewer.id') }}</div>
                      <div class="info-value">{{ part.functionCall.id }}</div>
                    </div>
                  </div>
                  <div class="json-section">
                    <div class="json-title">{{ t('components.message.tool.parameters') }}</div>
                    <pre class="json-block">{{ formatStructuredValue(getPartFunctionCallArgs(part)) }}</pre>
                  </div>

                  <div v-if="part.pairedFunctionResponse" class="json-section">
                    <div class="json-header">
                      <div class="json-title">{{ t('components.message.responseViewer.pairedFunctionResponse') }}</div>
                      <button
                        v-if="part.pairedFunctionResponse.hasLargeResponse"
                        class="inline-link-btn"
                        type="button"
                        @click="toggleExpanded(`part-paired-response-${part.index}`)"
                      >
                        {{ getExpandedLabel(`part-paired-response-${part.index}`) }}
                      </button>
                    </div>

                    <div class="info-grid compact-grid section-meta-grid">
                      <div class="info-item">
                        <div class="info-label">{{ t('components.message.responseViewer.name') }}</div>
                        <div class="info-value">{{ part.pairedFunctionResponse.name }}</div>
                      </div>
                      <div v-if="part.pairedFunctionResponse.id" class="info-item">
                        <div class="info-label">{{ t('components.message.responseViewer.id') }}</div>
                        <div class="info-value">{{ part.pairedFunctionResponse.id }}</div>
                      </div>
                      <div class="info-item">
                        <div class="info-label">{{ t('components.message.responseViewer.responseSource') }}</div>
                        <div class="info-value">{{ getResultSourceLabel(part.pairedFunctionResponse.source) }}</div>
                      </div>
                      <div
                        v-if="part.pairedFunctionResponse.sourceMessageId || typeof part.pairedFunctionResponse.sourceBackendIndex === 'number'"
                        class="info-item info-item-wide"
                      >
                        <div class="info-label">{{ t('components.message.responseViewer.sourceMessage') }}</div>
                        <div class="info-value">
                          {{ formatSourceMessage(part.pairedFunctionResponse.sourceMessageId, part.pairedFunctionResponse.sourceBackendIndex) }}
                        </div>
                      </div>
                    </div>

                    <pre
                      v-if="!part.pairedFunctionResponse.hasLargeResponse || isExpanded(`part-paired-response-${part.index}`)"
                      class="json-block"
                    >{{ formatStructuredValue(part.pairedFunctionResponse.response) }}</pre>
                    <pre v-else class="json-block json-preview-block">{{ getCollapsedText(part.pairedFunctionResponse.preview) }}</pre>
                  </div>
                </template>

                <template v-if="part.functionResponse">
                  <div class="info-grid compact-grid">
                    <div class="info-item">
                      <div class="info-label">{{ t('components.message.responseViewer.name') }}</div>
                      <div class="info-value">{{ part.functionResponse.name }}</div>
                    </div>
                    <div v-if="part.functionResponse.id" class="info-item">
                      <div class="info-label">{{ t('components.message.responseViewer.id') }}</div>
                      <div class="info-value">{{ part.functionResponse.id }}</div>
                    </div>
                  </div>
                  <div class="json-section">
                    <div class="json-header">
                      <div class="json-title">{{ t('components.message.tool.result') }}</div>
                      <button
                        v-if="part.hasLargeResponse"
                        class="inline-link-btn"
                        type="button"
                        @click="toggleExpanded(`part-response-${part.index}`)"
                      >
                        {{ getExpandedLabel(`part-response-${part.index}`) }}
                      </button>
                    </div>
                    <pre
                      v-if="!part.hasLargeResponse || isExpanded(`part-response-${part.index}`)"
                      class="json-block"
                    >{{ formatStructuredValue(part.functionResponse.response || {}) }}</pre>
                    <pre v-else class="json-block json-preview-block">{{ getCollapsedText(part.responseSummary || part.preview) }}</pre>
                  </div>
                </template>

                <template v-if="part.inlineData">
                  <div class="info-grid compact-grid">
                    <div class="info-item">
                      <div class="info-label">{{ t('components.message.responseViewer.mimeType') }}</div>
                      <div class="info-value">{{ part.inlineData.mimeType }}</div>
                    </div>
                    <div class="info-item">
                      <div class="info-label">{{ t('components.message.responseViewer.size') }}</div>
                      <div class="info-value">{{ formatInteger(part.inlineData.dataSize) }}</div>
                    </div>
                  </div>
                </template>

                <template v-if="part.fileData">
                  <div class="info-grid compact-grid">
                    <div v-if="part.fileData.displayName" class="info-item">
                      <div class="info-label">{{ t('components.message.responseViewer.name') }}</div>
                      <div class="info-value">{{ part.fileData.displayName }}</div>
                    </div>
                    <div class="info-item">
                      <div class="info-label">{{ t('components.message.responseViewer.mimeType') }}</div>
                      <div class="info-value">{{ part.fileData.mimeType }}</div>
                    </div>
                    <div class="info-item info-item-wide">
                      <div class="info-label">{{ t('components.message.responseViewer.fileUri') }}</div>
                      <div class="info-value">{{ part.fileData.fileUri }}</div>
                    </div>
                  </div>
                </template>

                <details class="nested-raw">
                  <summary>{{ t('components.message.responseViewer.rawJson') }}</summary>
                  <pre class="json-block">{{ formatJson(part.raw) }}</pre>
                </details>
              </div>
            </details>
          </div>
          <div v-else class="empty-block">{{ t('components.message.responseViewer.noParts') }}</div>
        </section>

        <section class="viewer-section">
          <div class="section-title">{{ t('components.message.responseViewer.toolCalls') }}</div>
          <div v-if="tools.length > 0" class="detail-list">
            <details
              v-for="(tool, index) in tools"
              :key="tool.id || `${tool.name}-${index}`"
              class="detail-card"
            >
              <summary class="detail-summary">
                <div class="detail-summary-main">
                  <span class="detail-type">{{ tool.name }}</span>
                  <span class="status-badge" :class="getToolStatusClass(tool.status)">
                    {{ getToolStatusLabel(tool.status) }}
                  </span>
                </div>
                <span v-if="tool.argsSummary" class="detail-preview">{{ tool.argsSummary }}</span>
              </summary>

              <div class="detail-body">
                <div class="info-grid compact-grid">
                  <div class="info-item">
                    <div class="info-label">{{ t('components.message.responseViewer.name') }}</div>
                    <div class="info-value">{{ tool.name }}</div>
                  </div>
                  <div class="info-item">
                    <div class="info-label">{{ t('components.message.responseViewer.status') }}</div>
                    <div class="info-value">{{ getToolStatusLabel(tool.status) }}</div>
                  </div>
                  <div v-if="tool.duration" class="info-item">
                    <div class="info-label">{{ t('components.message.responseViewer.duration') }}</div>
                    <div class="info-value">{{ formatDuration(tool.duration) }}</div>
                  </div>
                </div>

                <div class="json-section">
                  <div class="json-header">
                    <div class="json-title">{{ t('components.message.tool.parameters') }}</div>
                    <button
                      v-if="tool.hasLargeArgs"
                      class="inline-link-btn"
                      type="button"
                      @click="toggleExpanded(`tool-args-${tool.id || index}`)"
                    >
                      {{ getExpandedLabel(`tool-args-${tool.id || index}`) }}
                    </button>
                  </div>
                  <pre
                    v-if="!tool.hasLargeArgs || isExpanded(`tool-args-${tool.id || index}`)"
                    class="json-block"
                  >{{ formatStructuredValue(getToolArgsValue(tool)) }}</pre>
                  <pre v-else class="json-block json-preview-block">{{ getCollapsedText(tool.argsSummary) }}</pre>
                </div>

                <div v-if="tool.error" class="json-section">
                  <div class="json-header">
                    <div class="json-title">{{ t('components.message.tool.error') }}</div>
                    <button
                      v-if="tool.hasLargeResult"
                      class="inline-link-btn"
                      type="button"
                      @click="toggleExpanded(`tool-result-${tool.id || index}`)"
                    >
                      {{ getExpandedLabel(`tool-result-${tool.id || index}`) }}
                    </button>
                  </div>
                  <pre
                    v-if="!tool.hasLargeResult || isExpanded(`tool-result-${tool.id || index}`)"
                    class="json-block error-json"
                  >{{ tool.error }}</pre>
                  <pre v-else class="json-block json-preview-block error-json">{{ getCollapsedText(tool.resultSummary || tool.error) }}</pre>
                </div>
                <div v-else-if="tool.result !== undefined" class="json-section">
                  <div class="json-header">
                    <div class="json-title">{{ t('components.message.tool.result') }}</div>
                    <button
                      v-if="tool.hasLargeResult"
                      class="inline-link-btn"
                      type="button"
                      @click="toggleExpanded(`tool-result-${tool.id || index}`)"
                    >
                      {{ getExpandedLabel(`tool-result-${tool.id || index}`) }}
                    </button>
                  </div>

                  <div v-if="tool.resultSource" class="info-grid compact-grid section-meta-grid">
                    <div class="info-item">
                      <div class="info-label">{{ t('components.message.responseViewer.responseSource') }}</div>
                      <div class="info-value">{{ getResultSourceLabel(tool.resultSource) }}</div>
                    </div>
                    <div
                      v-if="tool.resultSource === 'hiddenFunctionResponse' && (tool.sourceMessageId || typeof tool.sourceBackendIndex === 'number')"
                      class="info-item info-item-wide"
                    >
                      <div class="info-label">{{ t('components.message.responseViewer.sourceMessage') }}</div>
                      <div class="info-value">{{ formatSourceMessage(tool.sourceMessageId, tool.sourceBackendIndex) }}</div>
                    </div>
                  </div>

                  <pre
                    v-if="!tool.hasLargeResult || isExpanded(`tool-result-${tool.id || index}`)"
                    class="json-block"
                  >{{ formatStructuredValue(tool.result) }}</pre>
                  <pre v-else class="json-block json-preview-block">{{ getCollapsedText(tool.resultSummary) }}</pre>
                </div>
              </div>
            </details>
          </div>
          <div v-else class="empty-block">{{ t('components.message.responseViewer.noTools') }}</div>
        </section>

        <section class="viewer-section">
          <div class="section-title">{{ t('components.message.responseViewer.metadata') }}</div>
          <div v-if="hasMetadata" class="section-content metadata-section">
            <div v-if="responseInfoItems.length > 0" class="info-grid">
              <div v-for="item in responseInfoItems" :key="`${item.label}-${item.value}`" class="info-item">
                <div class="info-label">{{ item.label }}</div>
                <div class="info-value">{{ item.value }}</div>
              </div>
            </div>

            <div v-if="metadataKnownItems.length > 0" class="info-grid extra-info-grid">
              <div v-for="item in metadataKnownItems" :key="`${item.label}-${item.value}`" class="info-item">
                <div class="info-label">{{ item.label }}</div>
                <div class="info-value">{{ item.value }}</div>
              </div>
            </div>

            <details v-if="metadataExtra" class="nested-raw">
              <summary>{{ t('components.message.responseViewer.moreMetadata') }}</summary>
              <pre class="json-block">{{ formatJson(metadataExtra) }}</pre>
            </details>
          </div>
          <div v-else class="empty-block">{{ t('components.message.responseViewer.noMetadata') }}</div>
        </section>

        <section class="viewer-section">
          <div class="section-title">{{ t('components.message.responseViewer.attachments') }}</div>
          <div v-if="attachments.length > 0" class="attachment-list">
            <div
              v-for="attachment in attachments"
              :key="attachment.id"
              class="attachment-card"
            >
              <div class="attachment-name">{{ attachment.name }}</div>
              <div class="info-grid compact-grid attachment-info-grid">
                <div class="info-item">
                  <div class="info-label">{{ t('components.message.responseViewer.attachmentType') }}</div>
                  <div class="info-value">{{ attachment.type }}</div>
                </div>
                <div class="info-item">
                  <div class="info-label">{{ t('components.message.responseViewer.size') }}</div>
                  <div class="info-value">{{ formatBytes(attachment.size) }}</div>
                </div>
                <div class="info-item">
                  <div class="info-label">{{ t('components.message.responseViewer.mimeType') }}</div>
                  <div class="info-value">{{ attachment.mimeType }}</div>
                </div>
                <div class="info-item">
                  <div class="info-label">{{ t('components.message.responseViewer.hasData') }}</div>
                  <div class="info-value">{{ formatBoolean(attachment.hasData) }}</div>
                </div>
                <div class="info-item">
                  <div class="info-label">{{ t('components.message.responseViewer.hasThumbnail') }}</div>
                  <div class="info-value">{{ formatBoolean(attachment.hasThumbnail) }}</div>
                </div>
              </div>

              <div v-if="attachment.metadata" class="json-section">
                <div class="json-header">
                  <div class="json-title">{{ t('components.message.responseViewer.metadata') }}</div>
                  <button
                    v-if="attachment.hasLargeMetadata"
                    class="inline-link-btn"
                    type="button"
                    @click="toggleExpanded(`attachment-metadata-${attachment.id}`)"
                  >
                    {{ getExpandedLabel(`attachment-metadata-${attachment.id}`) }}
                  </button>
                </div>
                <pre
                  v-if="!attachment.hasLargeMetadata || isExpanded(`attachment-metadata-${attachment.id}`)"
                  class="json-block"
                >{{ formatStructuredValue(attachment.metadata) }}</pre>
                <pre v-else class="json-block json-preview-block">{{ getCollapsedText(attachment.metadataSummary) }}</pre>
              </div>
            </div>
          </div>
          <div v-else class="empty-block">{{ t('components.message.responseViewer.noAttachments') }}</div>
        </section>

        <section class="viewer-section">
          <div class="section-title">{{ t('components.message.responseViewer.rawJson') }}</div>
          <div class="section-content raw-json-actions">
            <span class="raw-json-hint">{{ t('components.message.responseViewer.rawJsonHint') }}</span>
            <button class="dialog-btn confirm" type="button" @click="showRawJsonDialog = true">
              {{ t('components.message.responseViewer.openRawJson') }}
            </button>
          </div>
        </section>
      </div>
    </div>

    <template #footer>
      <button class="dialog-btn cancel" type="button" @click="visible = false">
        {{ t('common.close') }}
      </button>
    </template>
  </Modal>

  <JsonViewerDialog
    v-model="showRawJsonDialog"
    :value="props.value.rawJson"
    :title="t('components.message.responseViewer.rawJson')"
    width="860px"
  />
</template>

<style scoped>
.response-viewer {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 6px 8px 12px;
  box-sizing: border-box;
}

.mode-switch {
  display: inline-flex;
  gap: 8px;
  padding: 4px;
  border-radius: 8px;
  background: var(--vscode-editor-inactiveSelectionBackground, rgba(128, 128, 128, 0.12));
  align-self: flex-start;
  margin-left: 2px;
}

.mode-btn {
  border: none;
  background: transparent;
  color: var(--vscode-foreground);
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.mode-btn:hover {
  background: var(--vscode-list-hoverBackground);
}

.mode-btn.active {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.viewer-mode {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.viewer-section,
.viewer-details,
.detail-card,
.attachment-card {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  background: var(--vscode-editor-background);
}
.attachment-card {
  padding: 16px 18px;
}



.section-title {
  padding: 14px 18px;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.section-content,
.details-body,
.detail-body {
  padding: 16px 18px;
}

.empty-block {
  padding: 16px 18px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

.viewer-details {
  overflow: hidden;
}

.viewer-details-summary,
.detail-summary,
.nested-raw summary {
  cursor: pointer;
  list-style: none;
}

.viewer-details-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  font-size: 13px;
  font-weight: 600;
}

.viewer-details-summary::-webkit-details-marker,
.detail-summary::-webkit-details-marker,
.nested-raw summary::-webkit-details-marker {
  display: none;
}

.summary-badge,
.status-badge,
.detail-index,
.detail-type {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 500;
}

.summary-badge,
.detail-index {
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
}

.status-badge,
.detail-type {
  background: var(--vscode-editor-inactiveSelectionBackground, rgba(128, 128, 128, 0.16));
  color: var(--vscode-foreground);
}

.status-streaming,
.status-queued,
.status-awaiting_approval,
.status-executing,
.status-awaiting_apply {
  background: color-mix(in srgb, var(--vscode-textLink-foreground) 14%, transparent);
  color: var(--vscode-textLink-foreground);
}

.status-success {
  background: color-mix(in srgb, var(--vscode-terminal-ansiGreen) 16%, transparent);
  color: var(--vscode-terminal-ansiGreen);
}

.status-error {
  background: color-mix(in srgb, var(--vscode-errorForeground) 16%, transparent);
  color: var(--vscode-errorForeground);
}

.status-warning {
  background: color-mix(in srgb, var(--vscode-editorWarning-foreground) 16%, transparent);
  color: var(--vscode-editorWarning-foreground);
}

.status-unknown {
  background: var(--vscode-editor-inactiveSelectionBackground, rgba(128, 128, 128, 0.16));
  color: var(--vscode-descriptionForeground);
}

.tool-list,
.detail-list,
.attachment-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 18px;
}

.tool-card {
  padding: 14px;
  border-radius: 6px;
  background: var(--vscode-editorWidget-background, rgba(128, 128, 128, 0.08));
  border: 1px solid var(--vscode-panel-border);
}

.tool-card-header,
.detail-summary-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.tool-card-header {
  justify-content: space-between;
  margin-bottom: 10px;
}

.tool-name,
.attachment-name,
.detail-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.tool-summary-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  line-height: 1.5;
  margin-top: 8px;
}

.summary-label {
  color: var(--vscode-descriptionForeground);
  min-width: 84px;
  flex-shrink: 0;
}

.summary-value,
.detail-preview,
.raw-json-hint {
  color: var(--vscode-foreground);
  font-size: 12px;
  line-height: 1.5;
}

.error-row .summary-value,
.error-json {
  color: var(--vscode-errorForeground);
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.section-body-grid {
  padding: 16px 18px;
}

.compact-grid {
  margin-bottom: 12px;
}

.extra-info-grid {
  margin-top: 12px;
}

.section-meta-grid {
  margin-top: 0;
}

.attachment-info-grid {
  margin-top: 12px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.info-item-wide {
  grid-column: 1 / -1;
}

.info-label {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.info-value {
  font-size: 12px;
  color: var(--vscode-foreground);
  word-break: break-word;
}

.detail-summary {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
}

.detail-preview {
  flex: 1;
  text-align: right;
  color: var(--vscode-descriptionForeground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}

.section-action-btn {
  padding: 5px 12px;
  border-radius: 4px;
  border: 1px solid var(--vscode-panel-border);
  background: transparent;
  color: var(--vscode-foreground);
  font-size: 12px;
  cursor: pointer;
}

.section-action-btn:hover {
  background: var(--vscode-toolbar-hoverBackground);
}

.json-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}

.json-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.json-title {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.inline-link-btn {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--vscode-textLink-foreground);
  font-size: 12px;
  cursor: pointer;
}

.inline-link-btn:hover {
  text-decoration: underline;
}

.json-block {
  margin: 0;
  padding: 12px;
  border-radius: 6px;
  border: 1px solid var(--vscode-panel-border);
  background: rgba(0, 0, 0, 0.15);
  color: var(--vscode-foreground);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
}

.json-preview-block {
  color: var(--vscode-descriptionForeground);
}

.nested-raw {
  margin-top: 12px;
}

.nested-raw summary {
  color: var(--vscode-textLink-foreground);
  font-size: 12px;
}

.raw-json-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
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

.response-viewer :deep(.viewer-markdown p:first-child),
.response-viewer :deep(.thought-markdown p:first-child) {
  margin-top: 0;
}

.response-viewer :deep(.viewer-markdown p:last-child),
.response-viewer :deep(.thought-markdown p:last-child) {
  margin-bottom: 0;
}

.thought-markdown {
  --lim-md-font-style: italic;
  --lim-md-color: var(--vscode-descriptionForeground);
}

@media (max-width: 768px) {
  .detail-summary,
  .raw-json-actions,
  .tool-card-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .detail-preview {
    width: 100%;
    text-align: left;
    white-space: normal;
  }

  .section-actions {
    justify-content: flex-start;
  }

  .json-header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
