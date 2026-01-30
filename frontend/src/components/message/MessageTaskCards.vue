<script setup lang="ts">
/**
 * MessageTaskCards - 在消息正文里显示 Plan/SubAgent 卡片
 * 
 * 风格和 write_file 工具面板保持一致
 */
import { computed, ref, onMounted, watch } from 'vue'
import type { ToolUsage } from '../../types'
import { MarkdownRenderer, CustomScrollbar } from '../common'
import ChannelSelector, { type ChannelOption } from '../input/ChannelSelector.vue'
import ModelSelector, { type ModelInfo } from '../input/ModelSelector.vue'
import { extractPreviewText, formatSubAgentRuntimeBadge, isPlanDocPath } from '../../utils/taskCards'
import { generateId } from '../../utils/format'
import { useChatStore } from '@/stores'
import * as configService from '@/services/config'

const props = defineProps<{
  tools: ToolUsage[]
  messageModelVersion?: string
}>()

const chatStore = useChatStore()

type CardStatus = 'pending' | 'running' | 'success' | 'error'

// ============ 渠道选择相关 ============
const channelConfigs = ref<any[]>([])
const selectedChannelId = ref('')
const selectedModelId = ref('')
const modelOptions = ref<ModelInfo[]>([])
const isLoadingChannels = ref(false)
const isLoadingModels = ref(false)
const isExecutingPlan = ref(false)
const expandedPlans = ref<Set<string>>(new Set())

const channelOptions = computed<ChannelOption[]>(() =>
  channelConfigs.value
    .filter(config => config.enabled !== false)
    .map(config => ({
      id: config.id,
      name: config.name,
      model: config.model || config.id,
      type: config.type
    }))
)

async function loadChannels() {
  isLoadingChannels.value = true
  try {
    const ids = await configService.listConfigIds()
    const loaded: any[] = []
    for (const id of ids) {
      const config = await configService.getConfig(id)
      if (config) loaded.push(config)
    }
    channelConfigs.value = loaded
    if (chatStore.configId && !selectedChannelId.value) {
      selectedChannelId.value = chatStore.configId
    } else if (loaded.length > 0 && !selectedChannelId.value) {
      selectedChannelId.value = loaded[0].id
    }
  } catch (error) {
    console.error('Failed to load channels:', error)
  } finally {
    isLoadingChannels.value = false
  }
}

function getSelectedChannelConfig() {
  return channelConfigs.value.find(c => c.id === selectedChannelId.value)
}

async function loadModelsForChannel(configId: string) {
  if (!configId) {
    modelOptions.value = []
    selectedModelId.value = ''
    return
  }

  isLoadingModels.value = true
  try {
    const cfg = channelConfigs.value.find(c => c.id === configId)

    // 1) 优先使用本地配置里已保存的 models（来自“模型管理”）
    const localModels = Array.isArray((cfg as any)?.models) ? ((cfg as any).models as ModelInfo[]) : []
    let models = localModels.length > 0 ? localModels : await configService.getChannelModels(configId)

    // 2) 确保当前配置的 model 一定能显示/被选中
    const current = (cfg?.model || '').trim()
    if (current && !models.some(m => m.id === current)) {
      models = [{ id: current, name: current }, ...models]
    }

    modelOptions.value = models

    // 3) 默认选中：当前 config.model -> 第一项
    if (!selectedModelId.value) {
      selectedModelId.value = current || models[0]?.id || ''
    }
  } catch (error) {
    console.error('Failed to load models:', error)
    const current = (getSelectedChannelConfig()?.model || '').trim()
    modelOptions.value = current ? [{ id: current, name: current }] : []
    if (!selectedModelId.value) selectedModelId.value = current
  } finally {
    isLoadingModels.value = false
  }
}

function togglePlanExpand(key: string) {
  if (expandedPlans.value.has(key)) {
    expandedPlans.value.delete(key)
  } else {
    expandedPlans.value.add(key)
  }
}

function isPlanExpanded(key: string): boolean {
  return expandedPlans.value.has(key)
}

function getPlanTitle(planContent: string, planPath?: string): string {
  const m = (planContent || '').match(/^\s*#\s+(.+)\s*$/m)
  if (m && m[1] && m[1].trim()) return m[1].trim()

  if (planPath) {
    const parts = planPath.replace(/\\/g, '/').split('/')
    const file = parts[parts.length - 1] || planPath
    return file.replace(/\.md$/i, '') || 'Plan'
  }

  return 'Plan'
}

async function executePlan(planContent: string, planPath?: string) {
  if (isExecutingPlan.value || !planContent.trim()) return
  isExecutingPlan.value = true
  
  const originalConfigId = chatStore.configId
  const switchedConfig = !!selectedChannelId.value && selectedChannelId.value !== originalConfigId

  try {
    // one-off：仅本次执行使用所选渠道，不永久切换当前渠道
    if (switchedConfig) {
      chatStore.setConfigId(selectedChannelId.value)
    }
    
    // 启动 Build 顶部卡片（Cursor-like）
    chatStore.activeBuild = {
      id: generateId(),
      title: getPlanTitle(planContent, planPath),
      planContent,
      planPath,
      channelId: selectedChannelId.value || undefined,
      modelId: selectedModelId.value || undefined,
      startedAt: Date.now(),
      status: 'running'
    }

    const prompt = `请按照以下计划执行：\n\n${planContent}`
    await chatStore.sendMessage(prompt, undefined, {
      modelOverride: selectedModelId.value || undefined
    })
  } catch (error) {
    console.error('Failed to execute plan:', error)
  } finally {
    if (switchedConfig) {
      chatStore.setConfigId(originalConfigId)
    }
    isExecutingPlan.value = false
  }
}

onMounted(() => {
  loadChannels()
})

watch(
  () => selectedChannelId.value,
  async (id) => {
    const cfg = channelConfigs.value.find(c => c.id === id)
    selectedModelId.value = (cfg?.model || '').trim()
    await loadModelsForChannel(id)
  }
)

// ============ 工具状态映射 ============
function mapToolStatus(tool: ToolUsage): CardStatus {
  if (tool.status === 'executing' || tool.status === 'streaming' || tool.status === 'queued') return 'running'
  if (tool.status === 'success') return 'success'
  if (tool.status === 'error') return 'error'

  const r = tool.result as any
  if (!r) return 'pending'
  if (r.success === true) return 'success'
  if (r.success === false) return 'error'
  return 'pending'
}

// ============ SubAgent 数据提取 ============
function getSubAgentData(tool: ToolUsage) {
  const args = tool.args as any
  const result = tool.result as any
  const data = result?.data || {}

  return {
    agentName: (args?.agentName || data?.agentName || 'Sub-Agent') as string,
    prompt: (args?.prompt || '') as string,
    context: (args?.context || '') as string,
    response: (data?.response || data?.partialResponse || '') as string,
    error: (result?.error || tool.error || '') as string,
    channelId: (data?.channelId || '') as string,
    modelId: (data?.modelId || '') as string,
    modelVersion: (data?.modelVersion || '') as string,
    steps: typeof data?.steps === 'number' ? (data.steps as number) : undefined,
    toolCallsCount: Array.isArray(data?.toolCalls) ? data.toolCalls.length : undefined
  }
}

// ============ Plan 数据提取 ============
function getWriteFilePlanEntries(tool: ToolUsage): Array<{ path: string; content: string; success?: boolean }> {
  const args = tool.args as any
  const files = Array.isArray(args?.files) ? args.files : []

  const result = tool.result as any
  const resultList = Array.isArray(result?.data?.results) ? result.data.results : []
  const successByPath = new Map<string, boolean>()
  for (const r of resultList) {
    if (r?.path && typeof r.path === 'string' && typeof r.success === 'boolean') {
      successByPath.set(r.path, r.success)
    }
  }

  const entries: Array<{ path: string; content: string; success?: boolean }> = []
  for (const f of files) {
    const path = f?.path
    const content = f?.content
    if (typeof path !== 'string' || typeof content !== 'string') continue
    if (!isPlanDocPath(path)) continue
    entries.push({ path, content, success: successByPath.get(path) })
  }
  return entries
}

// ============ 计算卡片数据 ============
const subAgentCards = computed(() => {
  return props.tools
    .filter(t => t.name === 'subagents')
    .map(tool => {
      const meta = getSubAgentData(tool)
      const badge = meta.channelId
        ? formatSubAgentRuntimeBadge({
            channelId: meta.channelId,
            modelId: meta.modelId || undefined,
            modelVersion: meta.modelVersion || undefined
          })
        : ''

      const chips: string[] = []
      if (typeof meta.steps === 'number') chips.push(`Steps: ${meta.steps}`)
      if (typeof meta.toolCallsCount === 'number') chips.push(`Tools: ${meta.toolCallsCount}`)

      return {
        key: `subagents:${tool.id}`,
        status: mapToolStatus(tool),
        title: `Sub-Agent · ${meta.agentName}`,
        subtitle: meta.prompt ? meta.prompt : undefined,
        badge,
        chips,
        prompt: meta.prompt,
        context: meta.context,
        response: meta.response,
        error: meta.error,
        modelVersion: meta.modelVersion
      }
    })
})

const planCards = computed(() => {
  const cards: Array<{
    key: string
    status: CardStatus
    title: string
    path: string
    content: string
    badge?: string
  }> = []

  for (const tool of props.tools) {
    if (tool.name !== 'write_file') continue
    const entries = getWriteFilePlanEntries(tool)
    for (const entry of entries) {
      const status: CardStatus = typeof entry.success === 'boolean'
        ? (entry.success ? 'success' : 'error')
        : mapToolStatus(tool)

      cards.push({
        key: `plan:${tool.id}:${entry.path}`,
        status,
        title: 'Plan',
        path: entry.path,
        content: entry.content,
        badge: props.messageModelVersion || ''
      })
    }
  }
  return cards
})

const hasAny = computed(() => subAgentCards.value.length > 0 || planCards.value.length > 0)
</script>

<template>
  <div v-if="hasAny" class="message-taskcards">
    <!-- Plan 卡片（面板风格） -->
    <div v-for="c in planCards" :key="c.key" class="plan-panel">
      <div class="plan-header">
        <div class="plan-info">
          <span class="codicon codicon-list-unordered plan-icon"></span>
          <span class="plan-title">{{ c.title }}</span>
          <span v-if="c.status === 'success'" class="plan-status success">
            <span class="codicon codicon-check"></span>
          </span>
          <span v-else-if="c.status === 'running'" class="plan-status running">
            <span class="codicon codicon-loading codicon-modifier-spin"></span>
          </span>
          <span v-else-if="c.status === 'error'" class="plan-status error">
            <span class="codicon codicon-error"></span>
          </span>
        </div>
        <div class="plan-actions">
          <button
            class="action-btn"
            :title="isPlanExpanded(c.key) ? '收起' : '展开'"
            @click="togglePlanExpand(c.key)"
          >
            <span :class="['codicon', isPlanExpanded(c.key) ? 'codicon-chevron-up' : 'codicon-chevron-down']"></span>
          </button>
        </div>
      </div>
      
      <div class="plan-path">{{ c.path }}</div>
      
      <div class="plan-content">
        <CustomScrollbar :max-height="isPlanExpanded(c.key) ? 500 : 200">
          <div class="plan-preview">
            <MarkdownRenderer :content="isPlanExpanded(c.key) ? c.content : extractPreviewText(c.content, { maxLines: 12, maxChars: 1600 })" />
          </div>
        </CustomScrollbar>
      </div>
      
      <div class="plan-execute">
        <div class="execute-selector">
          <span class="execute-label">执行：</span>
          <ChannelSelector
            v-model="selectedChannelId"
            :options="channelOptions"
            :disabled="isLoadingChannels || isExecutingPlan"
            class="channel-select"
          />
          <ModelSelector
            v-model="selectedModelId"
            :models="modelOptions"
            :disabled="isLoadingChannels || isLoadingModels || isExecutingPlan || !selectedChannelId"
            class="model-select"
          />
        </div>
        <button
          class="execute-btn"
          :disabled="isExecutingPlan || !selectedChannelId || !selectedModelId"
          @click="executePlan(c.content, c.path)"
        >
          <span v-if="isExecutingPlan" class="codicon codicon-loading codicon-modifier-spin"></span>
          <span v-else class="codicon codicon-play"></span>
          <span class="btn-text">{{ isExecutingPlan ? '执行中...' : '执行计划' }}</span>
        </button>
      </div>
    </div>

    <!-- SubAgent 卡片（面板风格） -->
    <div v-for="c in subAgentCards" :key="c.key" class="subagent-panel">
      <div class="subagent-header">
        <div class="subagent-info">
          <span class="codicon codicon-hubot subagent-icon"></span>
          <span class="subagent-title">{{ c.title }}</span>
          <span v-if="c.status === 'success'" class="subagent-status success">
            <span class="codicon codicon-check"></span>
          </span>
          <span v-else-if="c.status === 'running'" class="subagent-status running">
            <span class="codicon codicon-loading codicon-modifier-spin"></span>
          </span>
          <span v-else-if="c.status === 'error'" class="subagent-status error">
            <span class="codicon codicon-error"></span>
          </span>
        </div>
        <div class="subagent-meta">
          <span v-for="(chip, idx) in c.chips" :key="idx" class="meta-chip">{{ chip }}</span>
        </div>
      </div>
      
      <div v-if="c.subtitle" class="subagent-subtitle">{{ c.subtitle }}</div>
      
      <div v-if="c.response || c.error" class="subagent-content">
        <CustomScrollbar :max-height="200">
          <div class="subagent-preview">
            <div v-if="c.error" class="subagent-error">{{ c.error }}</div>
            <MarkdownRenderer v-else-if="c.response" :content="extractPreviewText(c.response, { maxLines: 10, maxChars: 1200 })" />
          </div>
        </CustomScrollbar>
      </div>
      
      <div v-if="c.badge" class="subagent-footer">{{ c.badge }}</div>
    </div>
  </div>
</template>

<style scoped>
.message-taskcards {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
  margin: 8px 0 10px;
}

/* ============ Plan 面板（继承 write_file 风格） ============ */
.plan-panel {
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-sm, 2px);
  overflow: hidden;
  background: var(--vscode-editor-background);
}

.plan-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-bottom: 1px solid var(--vscode-panel-border);
}

.plan-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  flex: 1;
  min-width: 0;
}

.plan-icon {
  font-size: 12px;
  color: var(--vscode-charts-blue, #3794ff);
  flex-shrink: 0;
}

.plan-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.plan-status {
  font-size: 12px;
  margin-left: var(--spacing-xs, 4px);
}

.plan-status.success { color: var(--vscode-testing-iconPassed); }
.plan-status.running { color: var(--vscode-charts-blue); }
.plan-status.error { color: var(--vscode-testing-iconFailed); }

.plan-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm, 2px);
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  transition: all var(--transition-fast, 0.1s);
}

.action-btn:hover {
  background: var(--vscode-toolbar-hoverBackground);
  color: var(--vscode-foreground);
}

.plan-path {
  padding: 2px var(--spacing-sm, 8px);
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  font-family: var(--vscode-editor-font-family);
  background: var(--vscode-editor-background);
  border-bottom: 1px solid var(--vscode-panel-border);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-content {
  background: var(--vscode-editor-background);
}

.plan-preview {
  padding: var(--spacing-sm, 8px);
}

.plan-execute {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-top: 1px solid var(--vscode-panel-border);
}

.execute-selector {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  flex: 1;
  min-width: 0;
}

.execute-label {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
}

.channel-select {
  flex: 1;
  min-width: 120px;
  max-width: 180px;
}

.model-select {
  flex: 1;
  min-width: 120px;
  max-width: 220px;
}

.execute-btn {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  padding: 4px 10px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  border-radius: var(--radius-sm, 2px);
  font-size: 11px;
  cursor: pointer;
  transition: background-color 0.1s;
  white-space: nowrap;
}

.execute-btn:hover:not(:disabled) {
  background: var(--vscode-button-hoverBackground);
}

.execute-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-text {
  font-size: 11px;
}

/* 让 ModelSelector 在 Plan 面板里看起来像输入框（与 ChannelSelector 对齐） */
.plan-execute :deep(.model-trigger) {
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  border-radius: 4px;
  padding: 4px 8px;
}

.plan-execute :deep(.model-trigger:hover:not(:disabled)) {
  border-color: var(--vscode-focusBorder);
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
}

.plan-execute :deep(.model-selector.open .model-trigger) {
  border-color: var(--vscode-focusBorder);
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
}

/* ============ SubAgent 面板（继承 write_file 风格） ============ */
.subagent-panel {
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-sm, 2px);
  overflow: hidden;
  background: var(--vscode-editor-background);
}

.subagent-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-bottom: 1px solid var(--vscode-panel-border);
}

.subagent-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  flex: 1;
  min-width: 0;
}

.subagent-icon {
  font-size: 12px;
  color: var(--vscode-charts-purple, #b180d7);
  flex-shrink: 0;
}

.subagent-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--vscode-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.subagent-status {
  font-size: 12px;
  margin-left: var(--spacing-xs, 4px);
}

.subagent-status.success { color: var(--vscode-testing-iconPassed); }
.subagent-status.running { color: var(--vscode-charts-blue); }
.subagent-status.error { color: var(--vscode-testing-iconFailed); }

.subagent-meta {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
}

.meta-chip {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 2px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
}

.subagent-subtitle {
  padding: 2px var(--spacing-sm, 8px);
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  background: var(--vscode-editor-background);
  border-bottom: 1px solid var(--vscode-panel-border);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subagent-content {
  background: var(--vscode-editor-background);
}

.subagent-preview {
  padding: var(--spacing-sm, 8px);
}

.subagent-error {
  padding: var(--spacing-sm, 8px);
  background: var(--vscode-inputValidation-errorBackground);
  border: 1px solid var(--vscode-inputValidation-errorBorder);
  border-radius: var(--radius-sm, 2px);
  color: var(--vscode-errorForeground);
  font-size: 12px;
  word-break: break-word;
}

.subagent-footer {
  padding: 2px var(--spacing-sm, 8px);
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-top: 1px solid var(--vscode-panel-border);
  text-align: right;
}
</style>
