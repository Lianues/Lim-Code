<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { CustomScrollbar } from '../common'
import MessageItem from '../message/MessageItem.vue'
import { contentToMessageEnhanced } from '@/stores/chat/parsers'
import { applyStreamChunkToContents } from '@/stores/agentRun/contentDelta'
import { onMessageFromExtension, sendToExtension } from '@/utils/vscode'
import { shouldApplyEventFocus } from './monitorFocusPolicy'
import { compareMonitorRunsByStableCreationOrder } from './monitorRunOrdering'
import type { Content, ContentPart, Message, ToolUsage } from '@/types'

// 修改原因：Monitor 需要区分暂停、等待用户处理和扩展重载中断，不能把它们都展示成失败。
// 修改方式：与后端 SubAgentRunStatus 保持同构的前端状态联合类型。
// 修改目的：后续顶部控制按钮可以根据状态判断是否允许继续、退出或仅查看历史。
type RunStatus = 'running' | 'paused' | 'awaiting_monitor_action' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

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
  conversationId?: string
}

const snapshots = ref<SubAgentRunSnapshot[]>([])
const focusedRunId = ref<string | undefined>((window as any).__LIMCODE_INITIAL_RUN_ID || undefined)
// 修改原因：顶部控制按钮只能作用于后端仍持有活跃主工具 Promise 的 run。
// 修改方式：由 SubAgentMonitorPanel 随 ready/snapshot/event 消息下发 activeRunIds，前端只按该集合决定按钮可见性。
// 修改目的：历史 run 不会错误显示“中止/退出”等会影响主工具的操作。
const activeRunIds = ref<Set<string>>(new Set())
// 修改原因：实时事件会反复携带打开面板时的 focusRunId，并发 run 更新时会覆盖用户在 tab 上的手动选择。
// 修改方式：记录用户是否已经在 Monitor 内主动选中过 run，实时 event 只在用户未选择前应用后端焦点。
// 修改目的：从主窗口打开详情仍能自动定位，但 Monitor 内部切换不会被后续事件拉回旧 run。
const hasUserSelectedRun = ref(false)
let disposeMessageListener: (() => void) | undefined

const orderedRuns = computed(() => {
  // 修改原因：updatedAt 会被每个 llm_delta 和工具事件刷新，并发 run 按 updatedAt 排序会导致 tab 顺序不停跳动。
  // 修改方式：Run tab 改用创建时间的稳定顺序；updatedAt 仍只用于展示最近更新时间。
  // 修改目的：Monitor 在流式提前执行和多 SubAgent 并发时不再出现“跑马灯”式重排。
  return [...snapshots.value].sort(compareMonitorRunsByStableCreationOrder)
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

function applyLiveDeltaEvent(event: SubAgentRunEvent) {
  if (event.type !== 'llm_delta' || !event.runId) return

  const timestamp = event.timestamp || Date.now()
  const index = snapshots.value.findIndex(item => item.runId === event.runId)
  const baseRun = index >= 0
    ? snapshots.value[index]
    : {
        runId: event.runId,
        agentName: event.agentName,
        status: 'running' as RunStatus,
        createdAt: timestamp,
        updatedAt: timestamp,
        contents: [],
        events: []
      }

  // 修改原因：后端不再为每个 SubAgent llm_delta 附带完整 snapshot，否则大输出会造成 postMessage 与事件数组 O(n²) 膨胀。
  // 修改方式：Monitor 前端用共享 Content[] delta reducer 本地更新当前 run 的 model 消息，非 llm_delta 仍由后端 snapshot 校准。
  // 目的：SubAgent AI 输出实时可见，同时保持 transcript 持久化仍以后端最终 content_snapshot/run_completed 为准。
  const nextRun: SubAgentRunSnapshot = {
    ...baseRun,
    agentName: event.agentName || baseRun.agentName,
    updatedAt: timestamp,
    contents: applyStreamChunkToContents(baseRun.contents || [], event.payload, timestamp)
  }

  upsertSnapshot(nextRun)
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
    .map((content, contentIndex) => ({ content, contentIndex }))
    .filter(item => item.content.isFunctionResponse !== true)
    .map(({ content, contentIndex }) => {
      // 修改原因：run.contents 中包含不可见 functionResponse，Monitor 可见楼层索引不等于真实 Content[] 索引。
      // 修改方式：渲染 Message 时把真实 contentIndex 写入 backendIndex，并用它生成稳定 id。
      // 修改目的：删除/重试时传给后端的索引与持久化子对话一致，避免误删相邻楼层。
      const message = contentToMessageEnhanced(content, `${run.runId}_${contentIndex}`)
      message.backendIndex = contentIndex

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
const focusedRunIsActive = computed(() => !!focusedRun.value && activeRunIds.value.has(focusedRun.value.runId))
const latestRetryEvent = computed(() => {
  const events = focusedRun.value?.events || []
  // 修改原因：SubAgent 自动重试状态已通过 runEventBus 路由到 Monitor，需要在聊天视图顶部给用户可见反馈。
  // 修改方式：从当前 run 的事件列表倒序查找 retrying/retrySuccess/retryFailed 最新事件。
  // 修改目的：不把内部重试推到主窗口，同时让 Monitor 能审计自动重试过程。
  return [...events].reverse().find(event => event.type === 'retrying' || event.type === 'retrySuccess' || event.type === 'retryFailed')
})

function formatTime(ms?: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleTimeString()
}

function selectRun(runId: string) {
  // 修改原因：用户在 Monitor 内点击 run tab 是显式选择，后续 run 事件不应再用旧 focusRunId 覆盖它。
  // 修改方式：除更新 focusedRunId 外，同步标记 hasUserSelectedRun。
  // 修改目的：并发多个 SubAgent 时，用户可以稳定查看任意一个 run。
  hasUserSelectedRun.value = true
  focusedRunId.value = runId
}

function updateActiveRunIds(raw: unknown) {
  // 修改原因：activeRunIds 来自后端运行控制器，是判断顶部控制按钮是否可用的权威来源。
  // 修改方式：只接受字符串数组并转换为 Set，非法载荷回退为空集合。
  // 修改目的：避免前端根据历史状态猜测可控制性。
  activeRunIds.value = new Set(Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [])
}

async function controlFocusedRun(action: 'pause' | 'resume' | 'exit') {
  const run = focusedRun.value
  if (!run || !focusedRunIsActive.value) return
  const type = action === 'pause'
    ? 'subagents.pauseRun'
    : action === 'resume'
      ? 'subagents.resumeRun'
      : 'subagents.exitRun'

  // 修改原因：Monitor 顶部按钮要控制当前活跃 run，而不是改前端本地状态。
  // 修改方式：把 pause/resume/exit 意图发送给后端 runController handler，等待事件总线回推新状态。
  // 修改目的：保持后端为控制语义的 source of truth，避免主工具 Promise 与 UI 状态不一致。
  await sendToExtension(type, {
    runId: run.runId,
    reason: action === 'exit' ? '用户主动终止 SubAgent 执行' : undefined
  })
}

function pauseFocusedRun() {
  void controlFocusedRun('pause')
}

function resumeFocusedRun() {
  void controlFocusedRun('resume')
}

function exitFocusedRun() {
  void controlFocusedRun('exit')
}

function findContentIndexByMessageId(messageId: string): number | null {
  const message = renderMessages.value.find(item => item.id === messageId)
  return typeof message?.backendIndex === 'number' ? message.backendIndex : null
}

async function handleCopy(content: string) {
  // 修改原因：Monitor 复用 MessageItem 的复制按钮，但没有主窗口 MessageList 的上层 copy handler。
  // 修改方式：在 Monitor 内部直接调用 Clipboard API。
  // 修改目的：让子聊天窗口每一楼的复制按钮和主窗口一样可用，同时不依赖主聊天 store。
  if (!content) return
  await navigator.clipboard?.writeText(content)
}

async function mutateRunMessage(messageId: string, messageType: 'delete' | 'retry') {
  const run = focusedRun.value
  const contentIndex = findContentIndexByMessageId(messageId)
  if (!run || contentIndex === null) return

  // 修改原因：Monitor 的删除/重试只应该改 SubAgent 子对话，不影响主聊天历史。
  // 修改方式：向后端发送 runId、真实 contentIndex 和 conversationId，由后端基于 TranscriptMutation 更新 subAgentRuns 子记录。
  // 修改目的：保持子对话持久化记录为 source of truth，并复用后端配对删除规则。
  const type = messageType === 'delete' ? 'subagents.deleteRunMessage' : 'subagents.retryRunFromMessage'
  const response = await sendToExtension<{ snapshot?: SubAgentRunSnapshot }>(type, {
    runId: run.runId,
    contentIndex,
    conversationId: run.conversationId
  })
  if (response?.snapshot) upsertSnapshot(response.snapshot)
}

function handleDelete(messageId: string) {
  void mutateRunMessage(messageId, 'delete')
}

function handleRetry(messageId: string) {
  void mutateRunMessage(messageId, 'retry')
}

function noop() {
  // 修改原因：Monitor 当前阶段仍不支持编辑或回档编辑，避免误改主聊天历史或检查点。
  // 修改方式：仅保留 edit/restore edit/restore retry 的空处理，删除、复制、重试已接入子对话专用 handler。
  // 修改目的：逐步复用主窗口消息操作，同时不引入未设计好的编辑语义。
}

onMounted(async () => {
  // 修改原因：Monitor 应渲染 SubAgent 子对话 Content[]，而不是自定义事件面板。
  // 修改方式：挂载后请求后端内存/metadata 快照，并订阅后续 snapshot 事件。
  // 修改目的：像主聊天窗口一样展示 System/Context/Prompt、AI 输出、思维过程和工具卡片。
  disposeMessageListener = onMessageFromExtension((message: any) => {
    if (message.type === 'subagentMonitor.event') {
      if (message.data?.snapshot) upsertSnapshot(message.data.snapshot)
      if (message.data?.event) applyLiveDeltaEvent(message.data.event)
      if (shouldApplyEventFocus({
        currentFocusRunId: focusedRunId.value,
        incomingFocusRunId: message.data?.focusRunId,
        hasUserSelectedRun: hasUserSelectedRun.value
      })) {
        focusedRunId.value = message.data.focusRunId
      }
      updateActiveRunIds(message.data?.activeRunIds)
    }
    if (message.type === 'subagentMonitor.snapshot') {
      snapshots.value = Array.isArray(message.data?.snapshots) ? message.data.snapshots : []
      if (message.data?.focusRunId) {
        // 修改原因：snapshot/monitorReady 代表打开详情或重新同步，是显式导航事件，应该能覆盖旧选择。
        // 修改方式：应用后端 focusRunId，同时清除“用户已手动选择”标记，让新的显式入口成为默认焦点。
        // 修改目的：用户从主聊天再次打开另一个 run 时，Monitor 能正确跳转到新 run。
        focusedRunId.value = message.data.focusRunId
        hasUserSelectedRun.value = false
      }
      updateActiveRunIds(message.data?.activeRunIds)
    }
  })

  const initial = await sendToExtension<{ snapshots: SubAgentRunSnapshot[]; focusRunId?: string; activeRunIds?: string[] }>('subagents.monitorReady', {})
  snapshots.value = Array.isArray(initial?.snapshots) ? initial.snapshots : []
  if (initial?.focusRunId) {
    // 修改原因：初次 monitorReady 是面板启动时的默认焦点来源，不属于用户手动选择。
    // 修改方式：应用初始 focusRunId，并保持 hasUserSelectedRun=false。
    // 修改目的：后续用户没有手动切换前，实时事件仍可补齐初始聚焦。
    focusedRunId.value = initial.focusRunId
    hasUserSelectedRun.value = false
  }
  updateActiveRunIds(initial?.activeRunIds)
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
            <div v-if="latestRetryEvent" class="run-retry-status" :class="`retry-${latestRetryEvent.type}`">
              <span class="codicon" :class="latestRetryEvent.type === 'retrying' ? 'codicon-sync codicon-modifier-spin' : latestRetryEvent.type === 'retrySuccess' ? 'codicon-check' : 'codicon-warning'"></span>
              <span>
                {{ latestRetryEvent.type === 'retrying'
                  ? `自动重试 ${latestRetryEvent.payload?.attempt ?? ''}/${latestRetryEvent.payload?.maxAttempts ?? ''}`
                  : latestRetryEvent.type === 'retrySuccess'
                    ? '自动重试成功'
                    : `自动重试失败：${latestRetryEvent.payload?.error || ''}` }}
              </span>
            </div>
          </div>
          <div v-if="focusedRunIsActive" class="run-control-buttons">
            <!--
              修改原因：活跃 SubAgent run 需要能从 Monitor 顶部暂停、继续或退出。
              修改方式：按钮只在 activeRunIds 包含当前 run 时显示，并把操作发送给后端 runController。
              修改目的：历史 run 只可查看，活跃 run 才能影响主窗口工具调用。
            -->
            <button v-if="focusedRun.status === 'running'" class="control-btn" type="button" @click="pauseFocusedRun">
              <span class="codicon codicon-debug-pause"></span>
              中止
            </button>
            <button v-if="focusedRun.status === 'paused' || focusedRun.status === 'awaiting_monitor_action'" class="control-btn primary" type="button" @click="resumeFocusedRun">
              <span class="codicon codicon-debug-continue"></span>
              重试
            </button>
            <button class="control-btn danger" type="button" @click="exitFocusedRun">
              <span class="codicon codicon-debug-stop"></span>
              退出并让主工具失败
            </button>
          </div>
        </div>

        <MessageItem
          v-for="(message, index) in renderMessages"
          :key="message.id"
          :message="message"
          :message-index="message.backendIndex ?? index"
          @edit="noop"
          @restore-and-edit="noop"
          @delete="handleDelete"
          @retry="handleRetry"
          @restore-and-retry="noop"
          @copy="handleCopy"
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

.run-retry-status {
  /* 修改原因：Monitor 需要展示 SubAgent 内部自动重试状态，但不能像主窗口一样弹全局 retry 提示。
     修改方式：在 run 标题区添加紧凑状态行，并按 retry 类型调整颜色。
     修改目的：让内部 API 抖动和恢复过程在 Monitor 中可审计。 */
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.run-retry-status.retry-retrySuccess {
  color: var(--vscode-testing-iconPassed);
}

.run-retry-status.retry-retryFailed {
  color: var(--vscode-testing-iconFailed);
}

.message-scroll {
  flex: 1;
  min-height: 0;
}

.message-shell {
  min-height: 100%;
}

.run-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
}

.run-control-buttons {
  /* 修改原因：Monitor 顶部控制按钮需要醒目但仍保持 VS Code 工具栏风格。
     修改方式：使用紧凑 inline-flex 按钮组，并通过 primary/danger 变体区分继续和退出。
     修改目的：避免误触“退出并让主工具失败”，同时不引入与主窗口不一致的视觉组件。 */
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex-wrap: wrap;
}

.control-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 3px;
  background: transparent;
  color: var(--vscode-foreground);
  font-size: 11px;
  cursor: pointer;
}

.control-btn:hover {
  background: var(--vscode-toolbar-hoverBackground);
}

.control-btn.primary {
  border-color: var(--vscode-button-background);
}

.control-btn.danger {
  border-color: var(--vscode-errorForeground);
  color: var(--vscode-errorForeground);
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
