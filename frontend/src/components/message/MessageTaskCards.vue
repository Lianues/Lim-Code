<script setup lang="ts">
/**
 * MessageTaskCards - 在消息正文里显示 Design / Plan 文档卡片
 *
 * 第一版复用现有 Plan 卡片结构，同时承载 design 与 plan 的文档交互。
 */
import { computed, ref, onMounted, watch } from 'vue'
import { sendToExtension, loadState, saveState } from '@/utils/vscode'
import type { ToolUsage } from '../../types'
import { MarkdownRenderer, CustomScrollbar } from '../common'
import ModeSelector from '../input/ModeSelector.vue'
import ChannelSelector from '../input/ChannelSelector.vue'
import ModelSelector from '../input/ModelSelector.vue'
import type { PromptMode, ChannelOption, ModelInfo } from '../input/types'
import { isDesignDocPath, isPlanDocPath } from '../../utils/taskCards'
import { getPlanExecutionPrompt, getPlanGenerationPrompt } from '../../utils/toolContinuations'
import { generateId } from '../../utils/format'
import { useChatStore, useSettingsStore } from '@/stores'
import * as configService from '@/services/config'
import { useI18n } from '../../i18n'

const props = defineProps<{
  tools: ToolUsage[]
  messageModelVersion?: string
}>()

const chatStore = useChatStore()
const settingsStore = useSettingsStore()

const { t } = useI18n()

type CardStatus = 'pending' | 'running' | 'success' | 'error'
type TaskCardKind = 'design' | 'plan'

type TaskEntry = {
  kind: TaskCardKind
  path: string
  content: string
  success?: boolean
  continuationPrompt?: string
}

type TaskCardItem = {
  key: string
  kind: TaskCardKind
  status: CardStatus
  title: string
  path: string
  content: string
  toolId: string
  toolName: string
  isActionCompleted: boolean
}

const PLAN_EXECUTION_MODE_STATE_KEY = 'planExecution.preferredModeId'
const PLAN_GENERATION_MODE_STATE_KEY = 'planGeneration.preferredModeId'

// ============ 渠道选择相关 ============
const channelConfigs = ref<any[]>([])
const selectedChannelId = ref('')
const selectedPlanExecutionModeId = ref('code')
const selectedPlanGenerationModeId = ref('plan')
const selectedModelId = ref('')
const modelOptions = ref<ModelInfo[]>([])
const isLoadingChannels = ref(false)
const isLoadingModes = ref(false)
const promptModeOptions = ref<PromptMode[]>([])
const isLoadingModels = ref(false)
const isExecutingPlan = ref(false)
const isGeneratingPlan = ref(false)
const expandedCards = ref<Set<string>>(new Set())
const autoOpenedCardKeys = ref<Set<string>>(new Set())

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

const isAnyTaskActionRunning = computed(() => isExecutingPlan.value || isGeneratingPlan.value)

function openModeSettings() {
  settingsStore.showSettings('prompt')
}

function resolvePreferredModeId(
  modes: PromptMode[],
  storageKey: string,
  fallbackModeId: string,
  currentModeId?: string
): string {
  const persisted = String(loadState<string>(storageKey, '') || '').trim()
  if (persisted && modes.some(mode => mode.id === persisted)) return persisted

  if (fallbackModeId && modes.some(mode => mode.id === fallbackModeId)) return fallbackModeId

  const current = String(currentModeId || '').trim()
  if (current && modes.some(mode => mode.id === current)) return current

  return modes[0]?.id || fallbackModeId || 'code'
}

function getModeIdForKind(kind: TaskCardKind): string {
  return kind === 'plan'
    ? selectedPlanExecutionModeId.value
    : selectedPlanGenerationModeId.value
}

function handleModeChange(kind: TaskCardKind, modeId: string) {
  const normalized = String(modeId || '').trim()
  if (!normalized) return

  if (kind === 'plan') {
    selectedPlanExecutionModeId.value = normalized
    saveState(PLAN_EXECUTION_MODE_STATE_KEY, normalized)
    return
  }

  selectedPlanGenerationModeId.value = normalized
  saveState(PLAN_GENERATION_MODE_STATE_KEY, normalized)
}

async function loadPromptModes() {
  isLoadingModes.value = true
  try {
    const result = await configService.getPromptModes()
    const modes = Array.isArray(result?.modes) ? result.modes : []
    promptModeOptions.value = modes

    const preferredExecutionModeId = resolvePreferredModeId(
      modes,
      PLAN_EXECUTION_MODE_STATE_KEY,
      'code',
      result?.currentModeId
    )
    const preferredGenerationModeId = resolvePreferredModeId(
      modes,
      PLAN_GENERATION_MODE_STATE_KEY,
      'plan',
      result?.currentModeId
    )

    selectedPlanExecutionModeId.value = preferredExecutionModeId
    selectedPlanGenerationModeId.value = preferredGenerationModeId
    saveState(PLAN_EXECUTION_MODE_STATE_KEY, preferredExecutionModeId)
    saveState(PLAN_GENERATION_MODE_STATE_KEY, preferredGenerationModeId)
  } catch (error) {
    console.error('[task-cards] Failed to load prompt modes:', error)
    selectedPlanExecutionModeId.value = 'code'
    selectedPlanGenerationModeId.value = 'plan'
  } finally {
    isLoadingModes.value = false
  }
}

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

function toggleCardExpand(key: string) {
  if (expandedCards.value.has(key)) {
    expandedCards.value.delete(key)
  } else {
    expandedCards.value.add(key)
  }
}

function isCardExpanded(key: string): boolean {
  return expandedCards.value.has(key)
}

function getCreateFallbackTitle(kind: TaskCardKind): string {
  return kind === 'plan'
    ? t('components.message.tool.createPlan.fallbackTitle')
    : t('components.message.tool.createDesign.fallbackTitle')
}

function getDocumentTitle(docContent: string, docPath: string, kind: TaskCardKind): string {
  const m = (docContent || '').match(/^\s*#\s+(.+)\s*$/m)
  if (m && m[1] && m[1].trim()) return m[1].trim()

  if (docPath) {
    const parts = docPath.replace(/\\/g, '/').split('/')
    const file = parts[parts.length - 1] || docPath
    return file.replace(/\.md$/i, '') || getCreateFallbackTitle(kind)
  }

  return getCreateFallbackTitle(kind)
}

function getOpenFileLabel(kind: TaskCardKind): string {
  return kind === 'plan'
    ? t('components.message.tool.planCard.openFile')
    : t('components.message.tool.designCard.openFile')
}

function getOpenFileFailedMessage(kind: TaskCardKind): string {
  return kind === 'plan'
    ? t('components.message.tool.planCard.openFileFailed')
    : t('components.message.tool.designCard.openFileFailed')
}

async function openDocFile(card: TaskCardItem) {
  if (!card?.path) return
  try {
    await sendToExtension('openWorkspaceFileAt', {
      path: card.path,
      highlight: false,
      preview: false
    })
  } catch (error) {
    console.error(getOpenFileFailedMessage(card.kind), error)
  }
}

async function withSelectedChannel<T>(runner: () => Promise<T>): Promise<T> {
  const originalConfigId = chatStore.configId
  const nextConfigId = selectedChannelId.value
  const switchedConfig = !!nextConfigId && nextConfigId !== originalConfigId

  try {
    // one-off：仅本次操作使用所选渠道，不永久切换当前渠道
    if (switchedConfig) {
      chatStore.setConfigId(nextConfigId)
    }

    return await runner()
  } finally {
    if (switchedConfig) {
      chatStore.setConfigId(originalConfigId)
    }
  }
}

function isCardActionRunning(kind: TaskCardKind): boolean {
  return kind === 'plan' ? isExecutingPlan.value : isGeneratingPlan.value
}

function getActionLabel(kind: TaskCardKind): string {
  return kind === 'plan'
    ? t('components.message.tool.planCard.executeLabel')
    : t('components.message.tool.designCard.generateLabel')
}

function getActionText(card: TaskCardItem): string {
  if (card.kind === 'plan') {
    if (card.isActionCompleted) return t('components.message.tool.planCard.executed')
    if (isExecutingPlan.value) return t('components.message.tool.planCard.executing')
    return t('components.message.tool.planCard.executePlan')
  }

  if (card.isActionCompleted) return t('components.message.tool.designCard.generated')
  if (isGeneratingPlan.value) return t('components.message.tool.designCard.generating')
  return t('components.message.tool.designCard.generatePlan')
}

function getActionIconClass(card: TaskCardItem): string {
  if (card.isActionCompleted) return 'codicon-check'
  if (isCardActionRunning(card.kind)) return 'codicon-loading codicon-modifier-spin'
  return card.kind === 'plan' ? 'codicon-play' : 'codicon-arrow-right'
}

function isActionDisabled(card: TaskCardItem): boolean {
  const modeId = getModeIdForKind(card.kind)
  return (
    isAnyTaskActionRunning.value ||
    card.isActionCompleted ||
    !modeId ||
    !selectedChannelId.value ||
    !selectedModelId.value
  )
}

async function executePlan(card: TaskCardItem) {
  if (card.kind !== 'plan') return
  if (isExecutingPlan.value || card.isActionCompleted || !card.content.trim()) return

  isExecutingPlan.value = true
  try {
    await withSelectedChannel(async () => {
      const confirmResult = await sendToExtension<{
        success: boolean
        prompt: string
        planContent: string
        todos?: Array<{
          id: string
          content: string
          status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
        }>
      }>('plan.confirmExecution', {
        path: card.path,
        originalContent: card.content,
        conversationId: chatStore.currentConversationId
      })

      const prompt = String(confirmResult?.prompt || '')
      const latestPlanContent = confirmResult?.planContent || card.content
      const todosFromPlan = Array.isArray(confirmResult?.todos) ? confirmResult.todos : []

      // 确认执行后，切换到用户选择的模式，确保后续请求按目标模式运行
      try {
        const targetModeId = String(selectedPlanExecutionModeId.value || 'code').trim() || 'code'
        await chatStore.setCurrentPromptModeId(targetModeId)
        saveState(PLAN_EXECUTION_MODE_STATE_KEY, targetModeId)
      } catch (modeError) {
        // 模式切换失败不阻塞执行
        console.error('[plan] Failed to switch prompt mode before execution:', modeError)
      }

      // 启动 Build 顶部卡片（Cursor-like）
      await chatStore.setActiveBuild({
        id: generateId(),
        conversationId: chatStore.currentConversationId || '',
        title: getDocumentTitle(latestPlanContent, card.path, 'plan'),
        planContent: latestPlanContent,
        planPath: card.path,
        channelId: selectedChannelId.value || undefined,
        modelId: selectedModelId.value || undefined,
        startedAt: Date.now(),
        status: 'running'
      })

      // 不创建新的可见 user 消息：把确认信息追加到对应工具的 functionResponse 字段里再继续对话
      await chatStore.sendMessage('', undefined, {
        modelOverride: selectedModelId.value || undefined,
        hidden: {
          functionResponse: {
            id: card.toolId,
            name: card.toolName,
            response: {
              planExecutionPrompt: prompt,
              todos: todosFromPlan
            }
          }
        }
      })
    })
  } catch (error) {
    console.error(t('components.message.tool.planCard.executePlanFailed'), error)
  } finally {
    isExecutingPlan.value = false
  }
}

async function generatePlan(card: TaskCardItem) {
  if (card.kind !== 'design') return
  if (isGeneratingPlan.value || card.isActionCompleted || !card.content.trim()) return

  isGeneratingPlan.value = true
  try {
    await withSelectedChannel(async () => {
      const confirmResult = await sendToExtension<{
        success: boolean
        prompt: string
        designContent: string
        designPath: string
      }>('design.confirmPlanGeneration', {
        path: card.path,
        originalContent: card.content,
        conversationId: chatStore.currentConversationId
      })

      const prompt = String(confirmResult?.prompt || '')
      const latestDesignContent = confirmResult?.designContent || card.content
      const latestDesignPath = String(confirmResult?.designPath || card.path || '')

      // 生成计划前，切换到用户选择的目标模式，默认优先 plan
      try {
        const targetModeId = String(selectedPlanGenerationModeId.value || 'plan').trim() || 'plan'
        await chatStore.setCurrentPromptModeId(targetModeId)
        saveState(PLAN_GENERATION_MODE_STATE_KEY, targetModeId)
      } catch (modeError) {
        // 模式切换失败不阻塞继续对话
        console.error('[design] Failed to switch prompt mode before plan generation:', modeError)
      }

      // 不创建新的可见 user 消息：把确认信息追加到对应工具的 functionResponse 字段里再继续对话
      await chatStore.sendMessage('', undefined, {
        modelOverride: selectedModelId.value || undefined,
        hidden: {
          functionResponse: {
            id: card.toolId,
            name: card.toolName,
            response: {
              planGenerationPrompt: prompt,
              designPath: latestDesignPath,
              designContent: latestDesignContent
            }
          }
        }
      })
    })
  } catch (error) {
    console.error(t('components.message.tool.designCard.generatePlanFailed'), error)
  } finally {
    isGeneratingPlan.value = false
  }
}

function handleCardAction(card: TaskCardItem) {
  if (card.kind === 'plan') {
    void executePlan(card)
    return
  }

  void generatePlan(card)
}

async function autoOpenPendingCardTabs(cards: TaskCardItem[]) {
  for (const card of cards) {
    if (!card?.path) continue
    if (card.isActionCompleted) continue
    if (card.status === 'error') continue
    if (autoOpenedCardKeys.value.has(card.key)) continue

    autoOpenedCardKeys.value.add(card.key)
    try {
      await sendToExtension('openWorkspaceFileAt', {
        path: card.path,
        highlight: false
      })
    } catch (error) {
      console.error(getOpenFileFailedMessage(card.kind), error)
    }
  }
}

onMounted(() => {
  loadChannels()
  void loadPromptModes()
  void autoOpenPendingCardTabs(taskCards.value)
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

  // 优先融合 functionResponse（包含 reload 后的真实结果、以及后续确认字段）
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

// ============ 文档数据提取 ============
function getWriteFileTaskEntries(tool: ToolUsage): TaskEntry[] {
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

  const planExecutionPrompt = getPlanExecutionPrompt(result)
  const planGenerationPrompt = getPlanGenerationPrompt(result)

  const entries: TaskEntry[] = []
  for (const f of files) {
    const path = f?.path
    const content = f?.content
    if (typeof path !== 'string' || typeof content !== 'string') continue

    if (isDesignDocPath(path)) {
      entries.push({
        kind: 'design',
        path,
        content,
        success: successByPath.get(path),
        continuationPrompt: planGenerationPrompt || undefined
      })
      continue
    }

    if (isPlanDocPath(path)) {
      entries.push({
        kind: 'plan',
        path,
        content,
        success: successByPath.get(path),
        continuationPrompt: planExecutionPrompt || undefined
      })
    }
  }

  return entries
}

function getCreatePlanEntries(tool: ToolUsage): TaskEntry[] {
  const args = tool.args as any
  const result = getToolResult(tool)

  const path = (result?.data?.path || args?.path) as string | undefined
  const content = (result?.data?.content || args?.plan) as string | undefined

  if (typeof path !== 'string' || typeof content !== 'string') return []
  if (!isPlanDocPath(path)) return []

  const success = typeof result?.success === 'boolean' ? result.success : undefined
  const continuationPrompt = getPlanExecutionPrompt(result) || undefined

  return [{
    kind: 'plan',
    path,
    content,
    success,
    continuationPrompt
  }]
}

function getCreateDesignEntries(tool: ToolUsage): TaskEntry[] {
  const args = tool.args as any
  const result = getToolResult(tool)

  const path = (result?.data?.path || args?.path) as string | undefined
  const content = (result?.data?.content || args?.design) as string | undefined

  if (typeof path !== 'string' || typeof content !== 'string') return []
  if (!isDesignDocPath(path)) return []

  const success = typeof result?.success === 'boolean' ? result.success : undefined
  const continuationPrompt = getPlanGenerationPrompt(result) || undefined

  return [{
    kind: 'design',
    path,
    content,
    success,
    continuationPrompt
  }]
}

function getTaskEntries(tool: ToolUsage): TaskEntry[] {
  if (tool.name === 'write_file') return getWriteFileTaskEntries(tool)
  if (tool.name === 'create_plan') return getCreatePlanEntries(tool)
  if (tool.name === 'create_design') return getCreateDesignEntries(tool)
  return []
}

const taskCards = computed<TaskCardItem[]>(() => {
  const cards: TaskCardItem[] = []

  for (const tool of props.tools) {
    const entries = getTaskEntries(tool)
    if (entries.length === 0) continue

    for (const entry of entries) {
      const status: CardStatus = entry.continuationPrompt
        ? 'success'
        : typeof entry.success === 'boolean'
          ? (entry.success ? 'success' : 'error')
          : mapToolStatus(tool)

      cards.push({
        key: `${entry.kind}:${tool.id}:${entry.path}`,
        kind: entry.kind,
        status,
        title: getDocumentTitle(entry.content, entry.path, entry.kind),
        path: entry.path,
        content: entry.content,
        toolId: tool.id,
        toolName: tool.name,
        isActionCompleted: !!entry.continuationPrompt
      })
    }
  }

  return cards
})

watch(
  () => taskCards.value,
  (cards) => {
    void autoOpenPendingCardTabs(cards)
  }
)

const hasAny = computed(() => taskCards.value.length > 0)
</script>

<template>
  <div v-if="hasAny" class="message-taskcards">
    <div v-for="c in taskCards" :key="c.key" class="task-panel">
      <div class="task-header">
        <div class="task-info">
          <span
            :class="[
              'codicon',
              c.kind === 'plan' ? 'codicon-list-unordered' : 'codicon-lightbulb',
              'task-icon',
              c.kind
            ]"
          ></span>
          <span class="task-title">{{ c.title }}</span>
          <span v-if="c.status === 'success'" class="task-status success">
            <span class="codicon codicon-check"></span>
          </span>
          <span v-else-if="c.status === 'running'" class="task-status running">
            <span class="codicon codicon-loading codicon-modifier-spin"></span>
          </span>
          <span v-else-if="c.status === 'error'" class="task-status error">
            <span class="codicon codicon-error"></span>
          </span>
        </div>
        <div class="task-actions">
          <button
            class="action-btn"
            :title="getOpenFileLabel(c.kind)"
            :disabled="!c.path"
            @click="openDocFile(c)"
          >
            <span class="codicon codicon-go-to-file"></span>
          </button>
          <button
            class="action-btn"
            :title="isCardExpanded(c.key) ? t('common.collapse') : t('common.expand')"
            @click="toggleCardExpand(c.key)"
          >
            <span :class="['codicon', isCardExpanded(c.key) ? 'codicon-chevron-up' : 'codicon-chevron-down']"></span>
          </button>
        </div>
      </div>

      <div class="task-path">{{ c.path }}</div>

      <div class="task-content">
        <CustomScrollbar :max-height="isCardExpanded(c.key) ? 500 : 200">
          <div class="task-preview">
            <MarkdownRenderer :content="c.content" />
          </div>
        </CustomScrollbar>
      </div>

      <div class="task-footer">
        <div class="task-selector">
          <span class="task-label">{{ getActionLabel(c.kind) }}</span>
          <ModeSelector
            :model-value="getModeIdForKind(c.kind)"
            :options="promptModeOptions"
            :drop-up="true"
            :disabled="isLoadingModes || isAnyTaskActionRunning"
            class="mode-select"
            @update:model-value="(value) => handleModeChange(c.kind, value)"
            @open-settings="openModeSettings"
          />
          <ChannelSelector
            v-model="selectedChannelId"
            :options="channelOptions"
            :disabled="isLoadingChannels || isAnyTaskActionRunning"
            class="channel-select"
          />
          <ModelSelector
            v-model="selectedModelId"
            :models="modelOptions"
            :disabled="isLoadingChannels || isLoadingModels || isAnyTaskActionRunning || !selectedChannelId"
            class="model-select"
          />
        </div>
        <button
          class="task-btn"
          :class="{ done: c.isActionCompleted }"
          :disabled="isActionDisabled(c)"
          @click="handleCardAction(c)"
        >
          <span :class="['codicon', getActionIconClass(c)]"></span>
          <span class="btn-text">{{ getActionText(c) }}</span>
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

.task-panel {
  border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
  border-radius: var(--radius-sm, 2px);
  overflow: hidden;
  background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
}

.task-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  background: var(--vscode-sideBarSectionHeader-background, var(--vscode-editor-background));
  border-bottom: 1px solid var(--vscode-panel-border);
}

.task-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  flex: 1;
  min-width: 0;
}

.task-icon {
  font-size: 12px;
  flex-shrink: 0;
}

.task-icon.plan {
  color: var(--vscode-charts-blue, #3794ff);
}

.task-icon.design {
  color: var(--vscode-charts-yellow, #d7ba7d);
}

.task-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--vscode-foreground);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-status {
  font-size: 12px;
  margin-left: var(--spacing-xs, 4px);
}

.task-status.success { color: var(--vscode-testing-iconPassed); }
.task-status.running { color: var(--vscode-charts-blue); }
.task-status.error { color: var(--vscode-testing-iconFailed); }

.task-actions {
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

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn:disabled:hover {
  background: transparent;
  color: var(--vscode-descriptionForeground);
}

.task-path {
  padding: 2px var(--spacing-sm, 8px);
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  font-family: var(--vscode-editor-font-family);
  background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  border-bottom: 1px solid var(--vscode-panel-border);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-content {
  background: var(--vscode-editor-background);
}

.task-preview {
  padding: var(--spacing-sm, 8px);
}

.task-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  background: var(--vscode-sideBarSectionHeader-background, var(--vscode-editor-background));
  border-top: 1px solid var(--vscode-panel-border);
}

.task-selector {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  flex: 1;
  min-width: 0;
}

.task-label {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
}

.mode-select {
  flex: 0 0 auto;
  min-width: 100px;
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

.task-btn {
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

.task-btn:hover:not(:disabled) {
  background: var(--vscode-button-hoverBackground);
}

.task-btn.done {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  opacity: 0.85;
}

.task-btn.done:hover:not(:disabled) {
  background: var(--vscode-button-secondaryBackground);
}

.task-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.task-btn.done:disabled {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  opacity: 0.7;
}

.btn-text {
  font-size: 11px;
}

.task-footer :deep(.model-trigger) {
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  border-radius: 4px;
  padding: 4px 8px;
}

.task-footer :deep(.model-trigger:hover:not(:disabled)) {
  border-color: var(--vscode-focusBorder);
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
}

.task-footer :deep(.model-selector.open .model-trigger) {
  border-color: var(--vscode-focusBorder);
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
}
</style>
