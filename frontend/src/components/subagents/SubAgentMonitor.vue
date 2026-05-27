<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { CustomScrollbar } from '../common'
import MessageItem from '../message/MessageItem.vue'
import { contentToMessageEnhanced } from '@/stores/chat/parsers'
import { onMessageFromExtension, sendToExtension } from '@/utils/vscode'
import type { Content, ContentPart, Message, ToolUsage } from '@/types'

type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled'

interface SubAgentRunEvent {
  runId: string
  agentName?: string
  type: string
  timestamp: number
  toolId?: string
  toolName?: string
  payload?: any
}

interface SubAgentRunSnapshot {
  runId: string
  agentName?: string
  status: RunStatus
  createdAt: number
  updatedAt: number
  contents: Content[]
  events: SubAgentRunEvent[]
}

const snapshots = ref<SubAgentRunSnapshot[]>([])
const focusedRunId = ref<string | undefined>((window as any).__LIMCODE_INITIAL_RUN_ID || undefined)
let disposeMessageListener: (() => void) | undefined

const orderedRuns = computed(() => {
  return [...snapshots.value].sort((a, b) => b.updatedAt - a.updatedAt)
})

const focusedRun = computed(() => {
  if (focusedRunId.value) {
    const found = orderedRuns.value.find(run => run.runId === focusedRunId.value)
    if (found) return found
  }
  return orderedRuns.value[0]
})

function upsertSnapshot(snapshot: SubAgentRunSnapshot) {
  const index = snapshots.value.findIndex(item => item.runId === snapshot.runId)
  if (index >= 0) {
    const next = [...snapshots.value]
    next[index] = snapshot
    snapshots.value = next
  } else {
    snapshots.value = [snapshot, ...snapshots.value]
  }
}

function getFunctionResponseMap(contents: Content[]): Map<string, NonNullable<ContentPart['functionResponse']>> {
  const map = new Map<string, NonNullable<ContentPart['functionResponse']>>()
  for (const content of contents) {
    const parts = content.parts || []
    for (const part of parts) {
      const response = part.functionResponse
      if (response?.id) {
        map.set(response.id, response)
      }
    }
  }
  return map
}

function deriveToolStatus(result: unknown): ToolUsage['status'] {
  const r = result as any
  if (r?.success === false || r?.error || r?.cancelled || r?.rejected) return 'error'
  if (r?.data && r.data.appliedCount > 0 && r.data.failedCount > 0) return 'warning'
  return 'success'
}

function toRenderableMessages(run: SubAgentRunSnapshot | undefined): Message[] {
  if (!run) return []
  const responseMap = getFunctionResponseMap(run.contents || [])

  return (run.contents || [])
    .filter(content => content.isFunctionResponse !== true)
    .map((content, index) => {
      const message = contentToMessageEnhanced(content, `${run.runId}_${index}`)
      message.backendIndex = index

      if (message.tools && message.tools.length > 0) {
        message.tools = message.tools.map(tool => {
          const response = responseMap.get(tool.id)
          if (!response) return tool
          const result = response.response as Record<string, unknown>
          return {
            ...tool,
            result,
            status: deriveToolStatus(result)
          }
        })
      }

      return message
    })
}

const renderMessages = computed(() => toRenderableMessages(focusedRun.value))

function formatTime(ms?: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleTimeString()
}

function selectRun(runId: string) {
  focusedRunId.value = runId
}

function noop() {
  // 修改原因：MessageItem 复用主聊天 UI，但 Monitor 是只读审计视图，不应该编辑、删除或重试内部消息。
  // 修改方式：所有 MessageItem 操作事件接入空处理器。
  // 修改目的：最大化复用主聊天视觉和元信息展示，同时避免 Monitor 改写主对话或子记录。
}

onMounted(async () => {
  // 修改原因：Monitor 应渲染 SubAgent 子对话 Content[]，而不是自定义事件面板。
  // 修改方式：挂载后请求后端内存/metadata 快照，并订阅后续 snapshot 事件。
  // 修改目的：像主聊天窗口一样展示 System/Context/Prompt、AI 输出、思维过程和工具卡片。
  disposeMessageListener = onMessageFromExtension((message: any) => {
    if (message.type === 'subagentMonitor.event') {
      if (message.data?.snapshot) upsertSnapshot(message.data.snapshot)
      if (message.data?.focusRunId) focusedRunId.value = message.data.focusRunId
    }
    if (message.type === 'subagentMonitor.snapshot') {
      snapshots.value = Array.isArray(message.data?.snapshots) ? message.data.snapshots : []
      if (message.data?.focusRunId) focusedRunId.value = message.data.focusRunId
    }
  })

  const initial = await sendToExtension<{ snapshots: SubAgentRunSnapshot[]; focusRunId?: string }>('subagents.monitorReady', {})
  snapshots.value = Array.isArray(initial?.snapshots) ? initial.snapshots : []
  if (initial?.focusRunId) focusedRunId.value = initial.focusRunId
})

onBeforeUnmount(() => {
  disposeMessageListener?.()
})
</script>

<template>
  <div class="monitor-root">
    <header class="monitor-header">
      <div>
        <h1>SubAgent Monitor</h1>
        <p>以聊天窗口形式展示 SubAgent 的 System、Context、Prompt、AI 输出、思维过程和工具调用。</p>
      </div>
      <span class="run-count">{{ orderedRuns.length }} runs</span>
    </header>

    <div v-if="orderedRuns.length > 1" class="run-tabs">
      <button
        v-for="run in orderedRuns"
        :key="run.runId"
        class="run-tab"
        :class="{ active: focusedRun?.runId === run.runId }"
        type="button"
        @click="selectRun(run.runId)"
      >
        <span class="run-name">{{ run.agentName || 'Sub-Agent' }}</span>
        <span class="run-meta">{{ run.status }} · {{ formatTime(run.updatedAt) }}</span>
      </button>
    </div>

    <CustomScrollbar class="message-scroll" :max-height="'calc(100vh - 96px)'">
      <div v-if="!focusedRun" class="empty">
        <i class="codicon codicon-hubot"></i>
        <span>暂无 SubAgent 子对话记录。</span>
      </div>

      <div v-else class="message-shell">
        <div class="run-title-row">
          <div>
            <div class="run-title">{{ focusedRun.agentName || 'Sub-Agent' }}</div>
            <div class="run-subtitle">{{ focusedRun.runId }} · {{ focusedRun.status }} · {{ formatTime(focusedRun.updatedAt) }}</div>
          </div>
        </div>

        <MessageItem
          v-for="(message, index) in renderMessages"
          :key="message.id"
          :message="message"
          :message-index="index"
          @edit="noop"
          @restore-and-edit="noop"
          @delete="noop"
          @retry="noop"
          @restore-and-retry="noop"
          @copy="noop"
        />
      </div>
    </CustomScrollbar>
  </div>
</template>

<style scoped>
.monitor-root {
  height: 100vh;
  box-sizing: border-box;
  background: var(--vscode-editor-background);
  color: var(--vscode-foreground);
  display: flex;
  flex-direction: column;
}

.monitor-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.monitor-header h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.monitor-header p {
  margin: 4px 0 0;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

.run-count {
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  font-size: 11px;
  white-space: nowrap;
}

.run-tabs {
  display: flex;
  gap: 6px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--vscode-panel-border);
  overflow-x: auto;
}

.run-tab {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 180px;
  padding: 6px 10px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 7px;
  background: var(--vscode-sideBar-background);
  color: var(--vscode-foreground);
  cursor: pointer;
}

.run-tab.active {
  border-color: var(--vscode-focusBorder);
  background: var(--vscode-list-activeSelectionBackground);
}

.run-name {
  font-size: 12px;
  font-weight: 600;
}

.run-meta,
.run-subtitle {
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
}

.message-scroll {
  flex: 1;
  min-height: 0;
}

.message-shell {
  min-height: 100%;
}

.run-title-row {
  padding: 12px 16px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
}

.run-title {
  font-size: 13px;
  font-weight: 700;
}

.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 260px;
  color: var(--vscode-descriptionForeground);
}
</style>
