<script setup lang="ts">
/**
 * MessageTaskCards - 在消息正文里显示 Plan 卡片
 * 
 * 风格和 write_file 工具面板保持一致
 */
import { computed, ref, onMounted, watch } from 'vue'
import { sendToExtension } from '@/utils/vscode'
import type { ToolUsage } from '../../types'
import { MarkdownRenderer, CustomScrollbar } from '../common'
import ChannelSelector, { type ChannelOption } from '../input/ChannelSelector.vue'
import ModelSelector, { type ModelInfo } from '../input/ModelSelector.vue'
import { extractPreviewText, isPlanDocPath } from '../../utils/taskCards'
import { generateId } from '../../utils/format'
import { useChatStore } from '@/stores'
import * as configService from '@/services/config'
import { useI18n } from '../../i18n'

const props = defineProps<{
  tools: ToolUsage[]
  messageModelVersion?: string
}>()

const chatStore = useChatStore()

const { t } = useI18n()

type CardStatus = 'pending' | 'running' | 'success' | 'error'

type PlanEntry = {
  path: string
  content: string
  success?: boolean
  executionPrompt?: string
}

type PlanCardItem = {
  key: string
  status: CardStatus
  title: string
  path: string
  content: string
  badge?: string
  toolId: string
  toolName: string
  isExecuted: boolean
}

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
    console.error(t('components.message.tool.planCard.loadChannelsFailed'), error)
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
    console.error(t('components.message.tool.planCard.loadModelsFailed'), error)
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
    return file.replace(/\.md$/i, '') || t('components.message.tool.planCard.title')
  }

  return t('components.message.tool.planCard.title')
}

async function executePlan(card: PlanCardItem) {
  if (isExecutingPlan.value || card.isExecuted || !card.content.trim()) return
  isExecutingPlan.value = true
  let latestPlanContent = card.content
  
  const originalConfigId = chatStore.configId
  const switchedConfig = !!selectedChannelId.value && selectedChannelId.value !== originalConfigId

  try {
    // one-off：仅本次执行使用所选渠道，不永久切换当前渠道
    if (switchedConfig) {
      chatStore.setConfigId(selectedChannelId.value)
    }
    
    // 后端对比计划文件内容，返回确认/修改 prompt
    const confirmResult = await sendToExtension<{
      success: boolean
      prompt: string
      planContent: string
    }>('plan.confirmExecution', {
      path: card.path,
      originalContent: card.content
    })

    const prompt = confirmResult.prompt
    latestPlanContent = confirmResult.planContent || card.content

    // 启动 Build 顶部卡片（Cursor-like）
    await chatStore.setActiveBuild({
      id: generateId(),
      conversationId: chatStore.currentConversationId || '',
      title: getPlanTitle(latestPlanContent, card.path),
      planContent: latestPlanContent,
      planPath: card.path,
      channelId: selectedChannelId.value || undefined,
      modelId: selectedModelId.value || undefined,
      startedAt: Date.now(),
      status: 'running'
    })

    // 不创建新的可见 user 消息：把确认信息追加到 create_plan 的 functionResponse 字段里再继续对话
    await chatStore.sendMessage('', undefined, {
      modelOverride: selectedModelId.value || undefined,
      hidden: {
        functionResponse: {
          id: card.toolId,
          name: card.toolName,
          response: {
            planExecutionPrompt: prompt
          }
        }
      }
    })
  } catch (error) {
    console.error(t('components.message.tool.planCard.executePlanFailed'), error)
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
function getToolResult(tool: ToolUsage): any {
  const fromTool = tool.result && typeof tool.result === 'object'
    ? tool.result as any
    : undefined

  const fromResponse = tool.id
    ? chatStore.getToolResponseById(tool.id) as any
    : undefined

  // 优先融合 functionResponse（包含 reload 后的真实结果、以及执行计划确认字段）
  if (fromTool && fromResponse && typeof fromResponse === 'object') {
    return { ...fromTool, ...fromResponse }
  }
  if (fromResponse && typeof fromResponse === 'object') {
    return fromResponse
  }
  return fromTool
}

function mapToolStatus(tool: ToolUsage): CardStatus {
  if (tool.status === 'executing' || tool.status === 'streaming' || tool.status === 'queued') return 'running'
  if (tool.status === 'success') return 'success'
  if (tool.status === 'error') return 'error'

  const r = getToolResult(tool)
  if (!r) return 'pending'
  if (r.success === true) return 'success'
  if (r.success === false) return 'error'
  return 'pending'
}

// ============ Plan 数据提取 ============
function getWriteFilePlanEntries(tool: ToolUsage): PlanEntry[] {
  const args = tool.args as any
  const files = Array.isArray(args?.files) ? args.files : []

  const result = getToolResult(tool)
  const resultList = Array.isArray(result?.data?.results) ? result.data.results : []
  const successByPath = new Map<string, boolean>()
  for (const r of resultList) {
    if (r?.path && typeof r.path === 'string' && typeof r.success === 'boolean') {
      successByPath.set(r.path, r.success)
    }
  }

  const entries: PlanEntry[] = []
  for (const f of files) {
    const path = f?.path
    const content = f?.content
    if (typeof path !== 'string' || typeof content !== 'string') continue
    if (!isPlanDocPath(path)) continue
    entries.push({ path, content, success: successByPath.get(path) })
  }
  return entries
}

function getCreatePlanEntries(tool: ToolUsage): PlanEntry[] {
  const args = tool.args as any
  const result = getToolResult(tool)

  const path = (result?.data?.path || args?.path) as string | undefined
  const content = (result?.data?.content || args?.plan) as string | undefined

  if (typeof path !== 'string' || typeof content !== 'string') return []
  if (!isPlanDocPath(path)) return []

  const success = typeof result?.success === 'boolean' ? result.success : undefined
  const executionPrompt = typeof result?.planExecutionPrompt === 'string' && result.planExecutionPrompt.trim()
    ? result.planExecutionPrompt
    : undefined
  return [{ path, content, success, executionPrompt }]
}

const planCards = computed<PlanCardItem[]>(() => {
  const cards: PlanCardItem[] = []

  for (const tool of props.tools) {
    const entries = tool.name === 'write_file'
      ? getWriteFilePlanEntries(tool)
      : tool.name === 'create_plan'
        ? getCreatePlanEntries(tool)
        : []
    if (entries.length === 0) continue

    for (const entry of entries) {
      const status: CardStatus = entry.executionPrompt
        ? 'success'
        : typeof entry.success === 'boolean'
        ? (entry.success ? 'success' : 'error')
        : mapToolStatus(tool)

      cards.push({
        key: `plan:${tool.id}:${entry.path}`,
        status,
        title: t('components.message.tool.planCard.title'),
        path: entry.path,
        content: entry.content,
        badge: props.messageModelVersion || '',
        toolId: tool.id,
        toolName: tool.name,
        isExecuted: !!entry.executionPrompt
      })
    }
  }
  return cards
})

const hasAny = computed(() => planCards.value.length > 0)
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
            :title="isPlanExpanded(c.key) ? t('common.collapse') : t('common.expand')"
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
          <span class="execute-label">{{ t('components.message.tool.planCard.executeLabel') }}</span>
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
          :class="{ done: c.isExecuted }"
          :disabled="isExecutingPlan || c.isExecuted || !selectedChannelId || !selectedModelId"
          @click="executePlan(c)"
        >
          <span v-if="c.isExecuted" class="codicon codicon-check"></span>
          <span v-else-if="isExecutingPlan" class="codicon codicon-loading codicon-modifier-spin"></span>
          <span v-else class="codicon codicon-play"></span>
          <span class="btn-text">{{ c.isExecuted ? t('components.message.tool.planCard.executed') : (isExecutingPlan ? t('components.message.tool.planCard.executing') : t('components.message.tool.planCard.executePlan')) }}</span>
        </button>
      </div>
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

.execute-btn.done {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  opacity: 0.85;
}

.execute-btn.done:hover:not(:disabled) {
  background: var(--vscode-button-secondaryBackground);
}

.execute-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.execute-btn.done:disabled {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  opacity: 0.7;
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

</style>
